 // LABV2 Bot — CA / Chart / Price / Links (robust fallbacks + safe debug)
// ENV: BOT_TOKEN, CA (0x...), optional: PAIR, WEBSITE_URL, TWITTER_URL, TELEGRAM_URL, DEBUG=1
import { Telegraf } from "telegraf";
import fetch from "node-fetch";

/* ========= ENV ========= */
const BOT_TOKEN    = process.env.BOT_TOKEN;
const CA           = (process.env.CA || "").trim();
const PAIR_ENV     = (process.env.PAIR || "").trim();
const WEBSITE_URL  = (process.env.WEBSITE_URL  || "#").trim();
const TWITTER_URL  = (process.env.TWITTER_URL  || "#").trim();
const TELEGRAM_URL = (process.env.TELEGRAM_URL || "#").trim();
const DEBUG        = (process.env.DEBUG || "").trim() === "1";

if (!BOT_TOKEN || !CA) { console.error("❌ Missing BOT_TOKEN or CA"); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

/* ========= Links ========= */
const bscLink  = `https://bscscan.com/token/${CA}`;
const pcsLink  = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
const pooLink  = `https://poocoin.app/tokens/${CA}`;
const dexToolsPair = (pair) => `https://www.dextools.io/app/en/bnb/pair-explorer/${pair}`;

/* ========= Formatting ========= */
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

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
function esc(s = "") {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* ========= Fetch helper ========= */
const UA = "LABV2-TelegramBot/1.0 (+https://t.me/) NodeFetch";
async function safeFetchJson(url, opts = {}) {
  const res = await fetch(url, {
    timeout: 15000,
    headers: { "user-agent": UA, accept: "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let snippet = "";
    try { snippet = await res.text(); } catch {}
    // keep the thrown message SHORT and text-only; we'll escape it before showing
    throw new Error(`HTTP ${res.status} ${url} :: ${snippet.slice(0,200)}`);
  }
  return res.json();
}

/* ========= DexScreener (token, search, pair) ========= */
async function dsBestTokenPair(ca) {
  // token endpoint
  const t = await safeFetchJson(`https://api.dexscreener.com/latest/dex/tokens/bsc/${ca}`);
  const arr = Array.isArray(t?.pairs) ? t.pairs : [];
  if (arr.length) {
    arr.sort((a,b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    return { pair: arr[0], source: "dexscreener-token" };
  }
  // search endpoint
  const s = await safeFetchJson(`https://api.dexscreener.com/latest/dex/search?q=${ca}`);
  const sArr = Array.isArray(s?.pairs) ? s.pairs.filter(p => (p?.chainId||"").toLowerCase()==="bsc") : [];
  if (sArr.length) {
    sArr.sort((a,b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    return { pair: sArr[0], source: "dexscreener-search" };
  }
  throw new Error("DexScreener: no token pairs found");
}

// explicit pair endpoint (extra fallback if PAIR provided)
async function dsPair(pairAddress) {
  const j = await safeFetchJson(`https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddress}`);
  const p = j?.pair || (Array.isArray(j?.pairs) ? j.pairs[0] : null);
  if (!p) throw new Error("DexScreener pair not found");
  return { pair: p, source: "dexscreener-pair" };
}

/* ========= PancakeSwap Info ========= */
async function psPriceUsd(ca) {
  const j = await safeFetchJson(`https://api.pancakeswap.info/api/v2/tokens/${ca}`);
  const v = Number(j?.data?.price);
  return (v > 0 && isFinite(v)) ? v : null;
}

/* ========= GeckoTerminal ========= */
async function gtPriceUsd(ca) {
  const j = await safeFetchJson(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${ca}`);
  const v = Number(j?.data?.attributes?.price_usd);
  return (v > 0 && isFinite(v)) ? v : null;
}

/* ========= Resolve price & stats ========= */
async function resolvePriceAndStats() {
  const notes = [];
  let p = null, dsSource = "", priceUsd = null;

  // 1) DexScreener token/search
  try {
    const { pair, source } = await dsBestTokenPair(CA);
    p = pair; dsSource = source;
    if (Number(p?.priceUsd) > 0) priceUsd = Number(p.priceUsd);
    notes.push(`${source}: ok`);
  } catch (e) {
    notes.push(`ds-token/search: ${e.message}`);
  }

  // 2) Pair endpoint if we still don't have stats or price and PAIR is set
  if ((!p || !priceUsd) && PAIR_ENV) {
    try {
      const { pair, source } = await dsPair(PAIR_ENV);
      // prefer highest-liq stats; if we already had p, keep the one with more liq
      if (!p || (pair?.liquidity?.usd || 0) > (p?.liquidity?.usd || 0)) {
        p = pair; dsSource = source;
      }
      if (!priceUsd && Number(pair?.priceUsd) > 0) priceUsd = Number(pair.priceUsd);
      notes.push(`${source}: ok`);
    } catch (e) {
      notes.push(`ds-pair: ${e.message}`);
    }
  }

  // 3) PancakeSwap Info for price
  if (!priceUsd) {
    try {
      const v = await psPriceUsd(CA);
      if (v) { priceUsd = v; notes.push("pancakeswap: ok"); }
      else notes.push("pancakeswap: null");
    } catch (e) { notes.push(`pancakeswap: ${e.message}`); }
  }

  // 4) GeckoTerminal for price
  if (!priceUsd) {
    try {
      const v = await gtPriceUsd(CA);
      if (v) { priceUsd = v; notes.push("geckoterminal: ok"); }
      else notes.push("geckoterminal: null");
    } catch (e) { notes.push(`geckoterminal: ${e.message}`); }
  }

  return { pair: p, dsSource, priceUsd, notes };
}

/* ========= Replies ========= */
async function replyPrice(ctx) {
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
    const linkPair = p?.pairAddress || PAIR_ENV || "";

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
      `📊 <a href="${dexToolsPair(linkPair)}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a> | 🥞 <a href="${pcsLink}">Trade</a>`,
      DEBUG ? `\n(debug) source=${esc(dsSource)}\n<code>${esc(notes.join(" | "))}</code>` : ""
    ];

    await ctx.replyWithHTML(lines.filter(Boolean).join("\n"), { disable_web_page_preview: true });
  } catch (err) {
    console.error("Price error:", err);
    const dbg = DEBUG ? `\n\n<code>${esc(String(err.message))}</code>` : "";
    await ctx.replyWithHTML(`❌ Unable to fetch price right now.${dbg}`);
  }
}

async function replyCA(ctx) {
  const parts = [
    "🪙 <b>LABV2 Contract Address</b>",
    `<code>${CA}</code>`,
    "",
    `🔎 <a href="${bscLink}">BscScan</a> | 🥞 <a href="${pcsLink}">PancakeSwap</a>`,
  ];
  try {
    const { pair: p } = await resolvePriceAndStats();
    const linkPair = p?.pairAddress || PAIR_ENV || "";
    if (linkPair) parts.push(`📊 <a href="${dexToolsPair(linkPair)}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a>`);
  } catch {
    if (PAIR_ENV) parts.push(`📊 <a href="${dexToolsPair(PAIR_ENV)}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a>`);
  }
  return ctx.replyWithHTML(parts.join("\n"), { disable_web_page_preview: true });
}

async function replyChart(ctx) {
  const lines = ["📊 <b>LABV2 Charts & Trade</b>"];
  try {
    const { pair: p } = await resolvePriceAndStats();
    const linkPair = p?.pairAddress || PAIR_ENV || "";
    if (linkPair) lines.push(`• <a href="${dexToolsPair(linkPair)}">DexTools</a>`);
  } catch {}
  lines.push(`• <a href="${pooLink}">PooCoin</a>`);
  lines.push(`• <a href="${pcsLink}">PancakeSwap</a>`);
  return ctx.replyWithHTML(lines.join("\n"), { disable_web_page_preview: true });
}

function replyLinks(ctx) {
  return ctx.replyWithHTML(
    [
      "🔗 <b>LABV2 Official Links</b>",
      `• 🌐 <a href="${WEBSITE_URL}">Website</a>`,
      `• 🐦 <a href="${TWITTER_URL}">Twitter/X</a>`,
      `• 💬 <a href="${TELEGRAM_URL}">Telegram</a>`
    ].join("\n"),
    { disable_web_page_preview: true }
  );
}

/* ========= Commands ========= */
bot.start((ctx) => ctx.reply("Hi! Use /ca, /chart, /price, or /links.\n/help for all commands."));
bot.help((ctx) => ctx.reply("Commands:\n/ca – Contract & links\n/chart – Charts & trade\n/price – Live price + conversions\n/links – Official links"));

bot.command(["price","prices"], replyPrice);
bot.command(["ca","CA"], replyCA);
bot.command(["chart","charts"], replyChart);
bot.command(["links","link"], replyLinks);

/* Optional keyword triggers (groups) */
bot.hears(/(^|\s)(ca|contract|address)(\?|!|\.|$)/i, replyCA);
bot.hears(/(^|\s)(price|chart)(\?|!|\.|$)/i, replyPrice);

/* ========= Launch ========= */
bot.catch((e)=>console.error("Bot error:", e));
bot.launch();
console.log("✅ LABV2 bot running with robust price fallbacks and safe debug.");
