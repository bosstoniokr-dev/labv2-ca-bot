 /* =====================  /price handler (no node-fetch)  ===================== */
// Uses built-in fetch from Node 18+
// Make sure env has: BOT_TOKEN, CA, (optional) PAIR, (optional) DEBUG=1

// --- env & small utils ---
const CA           = (process.env.CA || "").trim();
const PAIR_ENV     = (process.env.PAIR || "").trim();
const DEBUG        = (process.env.DEBUG || "").trim() === "1";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function esc(s = "") {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function fmtUsd(x) {
  if (!x || !isFinite(x) || x <= 0) return "$—";
  if (x >= 0.01) return `$${(+x).toFixed(8).replace(/0+$/,"").replace(/\.$/,"")}`;
  return `$${(+x).toFixed(18).replace(/0+$/,"").replace(/\.$/,"")}`;
}
function fmtQty(x) {
  if (!x || !isFinite(x) || x <= 0) return "—";
  return nf0.format(x);
}
function ago(ms) {
  if (!ms) return "just now";
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

// --- safe fetch helper ---
const UA = "LABV2-TelegramBot/1.0 (+https://t.me/)";
async function safeFetchJson(url, opts = {}) {
  const res = await fetch(url, {
    // Node 18 global fetch supports AbortSignal timeout via controller pattern.
    // We'll just rely on sane endpoints; if you want hard timeout, add AbortController.
    headers: { "user-agent": UA, accept: "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let snippet = "";
    try { snippet = await res.text(); } catch {}
    throw new Error(`HTTP ${res.status} ${url} :: ${snippet.slice(0,200)}`);
  }
  return res.json();
}

/* ----------------  DexScreener (correct endpoints)  ---------------- */
// 1) Correct token endpoint: NO /bsc/, pass the contract directly
async function dsBestTokenPair(contract) {
  const t = await safeFetchJson(`https://api.dexscreener.com/latest/dex/tokens/${contract}`);
  const arr = Array.isArray(t?.pairs) ? t.pairs : [];
  if (arr.length) {
    arr.sort((a,b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    return { pair: arr[0], source: "dexscreener-token" };
  }
  // 2) Search endpoint (filter BSC)
  const s = await safeFetchJson(`https://api.dexscreener.com/latest/dex/search?q=${contract}`);
  const sArr = Array.isArray(s?.pairs) ? s.pairs.filter(p => (p?.chainId||"").toLowerCase()==="bsc") : [];
  if (sArr.length) {
    sArr.sort((a,b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    return { pair: sArr[0], source: "dexscreener-search" };
  }
  throw new Error("DexScreener: no token pairs found");
}

// 3) Explicit pair endpoint (if you provide PAIR)
async function dsPair(pairAddress) {
  const j = await safeFetchJson(`https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddress}`);
  const p = j?.pair || (Array.isArray(j?.pairs) ? j.pairs[0] : null);
  if (!p) throw new Error("DexScreener pair not found");
  return { pair: p, source: "dexscreener-pair" };
}

/* ----------------  Extra price fallbacks  ---------------- */
async function psPriceUsd(contract) {
  const j = await safeFetchJson(`https://api.pancakeswap.info/api/v2/tokens/${contract}`);
  const v = Number(j?.data?.price);
  return (v > 0 && isFinite(v)) ? v : null;
}
async function gtPriceUsd(contract) {
  const j = await safeFetchJson(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${contract}`);
  const v = Number(j?.data?.attributes?.price_usd);
  return (v > 0 && isFinite(v)) ? v : null;
}

/* ----------------  Resolve price & stats  ---------------- */
async function resolvePriceAndStats_FIXED() {
  const notes = [];
  let p = null, dsSource = "", priceUsd = null;

  // A) DexScreener (token/search)
  try {
    const { pair, source } = await dsBestTokenPair(CA);
    p = pair; dsSource = source;
    if (Number(p?.priceUsd) > 0) priceUsd = Number(p.priceUsd);
    notes.push(`${source}: ok`);
  } catch (e) {
    notes.push(`ds-token/search: ${e.message}`);
  }

  // B) DexScreener pair (if PAIR is set)
  if ((!p || !priceUsd) && PAIR_ENV) {
    try {
      const { pair, source } = await dsPair(PAIR_ENV);
      if (!p || (pair?.liquidity?.usd || 0) > (p?.liquidity?.usd || 0)) {
        p = pair; dsSource = source;
      }
      if (!priceUsd && Number(pair?.priceUsd) > 0) priceUsd = Number(pair.priceUsd);
      notes.push(`${source}: ok`);
    } catch (e) {
      notes.push(`ds-pair: ${e.message}`);
    }
  }

  // C) PancakeSwap Info (price only)
  if (!priceUsd) {
    try {
      const v = await psPriceUsd(CA);
      if (v) { priceUsd = v; notes.push("pancakeswap: ok"); }
      else notes.push("pancakeswap: null");
    } catch (e) { notes.push(`pancakeswap: ${e.message}`); }
  }

  // D) GeckoTerminal (price only)
  if (!priceUsd) {
    try {
      const v = await gtPriceUsd(CA);
      if (v) { priceUsd = v; notes.push("geckoterminal: ok"); }
      else notes.push("geckoterminal: null");
    } catch (e) { notes.push(`geckoterminal: ${e.message}`); }
  }

  return { pair: p, dsSource, priceUsd, notes };
}

/* ----------------  /price reply  ---------------- */
export async function replyPrice(ctx) {
  try {
    const { pair: p, priceUsd: usd, dsSource, notes } = await resolvePriceAndStats_FIXED();

    if (!usd) {
      const dbg = DEBUG ? `\n\n<code>${esc(notes.join(" | "))}</code>` : "";
      await ctx.replyWithHTML(`❌ Unable to fetch price right now.${dbg}`);
      return;
    }

    const per1   = 1   / usd;
    const per10  = 10  / usd;
    const per100 = 100 / usd;

    const ch24 = p?.priceChange?.h24 ?? null;
    const chTxt = ch24 == null ? "—" : (ch24 >= 0 ? `🟢 +${(+ch24).toFixed(2)}%` : `🔴 ${(+ch24).toFixed(2)}%`);
    const vol24  = p?.volume?.h24   != null ? `$${nf0.format(+p.volume.h24)}`     : "—";
    const liqUsd = p?.liquidity?.usd != null ? `$${nf0.format(+p.liquidity.usd)}` : "—";
    const mcap   = p?.fdv != null ? `$${nf0.format(+p.fdv)}`
                  : (p?.marketCap != null ? `$${nf0.format(+p.marketCap)}` : "—");
    const updated = p?.updatedAt ? ago(p.updatedAt) : "just now";

    const pooLink = `https://poocoin.app/tokens/${CA}`;
    const pcsLink = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
    const pairAddr = p?.pairAddress || PAIR_ENV || "";
    const dexTools = pairAddr
      ? `https://www.dextools.io/app/en/bnb/pair-explorer/${pairAddr}`
      : `https://www.dextools.io/app/en/bnb/search?q=${CA}`;

    const lines = [
      `💹 <b>LABV2 Price</b> — ${fmtUsd(usd)}`,
      `• $1 ≈ ${fmtQty(per1)} LABV2`,
      `• $10 ≈ ${fmtQty(per10)} LABV2`,
      `• $100 ≈ ${fmtQty(per100)} LABV2`,
      `• 24h Change: <b>${chTxt}</b>`,
      `• 24h Volume: <b>${vol24}</b>`,
      `• Liquidity: <b>${liqUsd}</b>`,
      `• FDV/MC: <b>${mcap}</b>`,
      `• Updated: <i>${updated}</i>`,
      "",
      `📊 <a href="${dexTools}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a> | 🥞 <a href="${pcsLink}">Trade</a>`,
      DEBUG ? `\n(debug) source=${esc(dsSource)}\n<code>${esc(notes.join(" | "))}</code>` : ""
    ];

    await ctx.replyWithHTML(lines.filter(Boolean).join("\n"), { disable_web_page_preview: true });
  } catch (err) {
    const dbg = DEBUG ? `\n\n<code>${esc(String(err.message))}</code>` : "";
    await ctx.replyWithHTML(`❌ Unable to fetch price right now.${dbg}`);
  }
}
/* =====================  end /price handler  ===================== */
