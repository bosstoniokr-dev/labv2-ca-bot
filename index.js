 // index.js  —  LABV2 Contract Bot (single-file, no self-imports)

import { Telegraf } from "telegraf";

/* ========== ENV ========== */
const BOT_TOKEN = process.env.BOT_TOKEN?.trim();
const CA        = process.env.CA?.trim();
const PAIR_ENV  = process.env.PAIR?.trim() || "";
const DEBUG     = (process.env.DEBUG || "") === "1";

if (!BOT_TOKEN || !CA) {
  console.error("Missing BOT_TOKEN or CA env.");
  process.exit(1);
}

/* ========== BOT ========== */
const bot = new Telegraf(BOT_TOKEN);

/* ========== UTILS ========== */
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

const UA = "LABV2-TelegramBot/1.0 (+https://t.me/)";
async function safeFetchJson(url, opts = {}) {
  const res = await fetch(url, {
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

/* ========== PRICE RESOLUTION ========== */
// DexScreener: token endpoint (correct, no /bsc/)
async function dsBestTokenPair(contract) {
  const t = await safeFetchJson(`https://api.dexscreener.com/latest/dex/tokens/${contract}`);
  const arr = Array.isArray(t?.pairs) ? t.pairs : [];
  if (arr.length) {
    arr.sort((a,b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    return { pair: arr[0], source: "dexscreener-token" };
  }
  // search (filter BSC)
  const s = await safeFetchJson(`https://api.dexscreener.com/latest/dex/search?q=${contract}`);
  const sArr = Array.isArray(s?.pairs) ? s.pairs.filter(p => (p?.chainId||"").toLowerCase()==="bsc") : [];
  if (sArr.length) {
    sArr.sort((a,b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    return { pair: sArr[0], source: "dexscreener-search" };
  }
  throw new Error("DexScreener: no token pairs found");
}

// DexScreener: explicit pair (if provided)
async function dsPair(pairAddress) {
  const j = await safeFetchJson(`https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddress}`);
  const p = j?.pair || (Array.isArray(j?.pairs) ? j.pairs[0] : null);
  if (!p) throw new Error("DexScreener pair not found");
  return { pair: p, source: "dexscreener-pair" };
}

// PancakeSwap info (price-only fallback)
async function psPriceUsd(contract) {
  const j = await safeFetchJson(`https://api.pancakeswap.info/api/v2/tokens/${contract}`);
  const v = Number(j?.data?.price);
  return (v > 0 && isFinite(v)) ? v : null;
}

// GeckoTerminal (price-only fallback)
async function gtPriceUsd(contract) {
  const j = await safeFetchJson(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${contract}`);
  const v = Number(j?.data?.attributes?.price_usd);
  return (v > 0 && isFinite(v)) ? v : null;
}

async function resolvePriceAndStats() {
  const notes = [];
  let p = null, dsSource = "", priceUsd = null;

  // A) DexScreener token/search
  try {
    const { pair, source } = await dsBestTokenPair(CA);
    p = pair; dsSource = source;
    if (Number(p?.priceUsd) > 0) priceUsd = Number(p.priceUsd);
    notes.push(`${source}: ok`);
  } catch (e) { notes.push(`ds-token/search: ${e.message}`); }

  // B) DexScreener pair (if PAIR set)
  if ((!p || !priceUsd) && PAIR_ENV) {
    try {
      const { pair, source } = await dsPair(PAIR_ENV);
      if (!p || (pair?.liquidity?.usd || 0) > (p?.liquidity?.usd || 0)) {
        p = pair; dsSource = source;
      }
      if (!priceUsd && Number(pair?.priceUsd) > 0) priceUsd = Number(pair.priceUsd);
      notes.push(`${source}: ok`);
    } catch (e) { notes.push(`ds-pair: ${e.message}`); }
  }

  // C) PancakeSwap
  if (!priceUsd) {
    try {
      const v = await psPriceUsd(CA);
      if (v) { priceUsd = v; notes.push("pancakeswap: ok"); }
      else notes.push("pancakeswap: null");
    } catch (e) { notes.push(`pancakeswap: ${e.message}`); }
  }

  // D) GeckoTerminal
  if (!priceUsd) {
    try {
      const v = await gtPriceUsd(CA);
      if (v) { priceUsd = v; notes.push("geckoterminal: ok"); }
      else notes.push("geckoterminal: null");
    } catch (e) { notes.push(`geckoterminal: ${e.message}`); }
  }

  return { pair: p, dsSource, priceUsd, notes };
}

/* ========== COMMANDS ========== */
bot.start((ctx) =>
  ctx.reply("Hi! Use /ca, /price, /links")
);

bot.command(["ca"], async (ctx) => {
  const bsc = `https://bscscan.com/token/${CA}`;
  const pcs = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
  const poo = `https://poocoin.app/tokens/${CA}`;
  const dex = PAIR_ENV
    ? `https://www.dextools.io/app/en/bnb/pair-explorer/${PAIR_ENV}`
    : `https://www.dextools.io/app/en/bnb/search?q=${CA}`;
  const msg = [
    "<b>LABV2 Contract Address</b>",
    `<code>${esc(CA)}</code>`,
    "",
    `📄 <a href="${bsc}">BscScan</a> | 🥞 <a href="${pcs}">PancakeSwap</a>`,
    `💩 <a href="${poo}">PooCoin</a> | 📊 <a href="${dex}">DexTools</a>`,
  ].join("\n");
  await ctx.replyWithHTML(msg, { disable_web_page_preview: true });
});

bot.command(["links"], async (ctx) => {
  // Replace with your real socials
  const site = "https://your-website.example/";
  const x    = "https://twitter.com/your_x_handle";
  const tg   = "https://t.me/your_group";
  const msg = [
    "<b>LABV2 Official Links</b>",
    `🌐 <a href="${site}">Website</a>`,
    `𝕏 <a href="${x}">Twitter/X</a>`,
    `🗣️ <a href="${tg}">Telegram</a>`,
  ].join("\n");
  await ctx.replyWithHTML(msg, { disable_web_page_preview: true });
});

bot.command(["price","prices"], async (ctx) => {
  console.log("Received /price from", ctx.chat?.id); // visibility in logs
  try {
    const { pair: p, priceUsd: usd, dsSource, notes } = await resolvePriceAndStats();

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
});

/* ========== START ========== */
bot.launch();
console.log("LABV2 bot is running…");

/* graceful stop */
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
