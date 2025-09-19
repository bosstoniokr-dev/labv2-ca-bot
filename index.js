 // index.js — LABV2 Bot (CA / Chart / Price / Links)
import { Telegraf } from "telegraf";
import fetch from "node-fetch";

/* ========= ENV VARS ========= */
const BOT_TOKEN    = process.env.BOT_TOKEN;
const CA           = (process.env.CA || "").trim();                       // token address
const PAIR         = (process.env.PAIR || "").trim();                     // pair address (optional but recommended)
const WEBSITE_URL  = (process.env.WEBSITE_URL  || "#").trim();
const TWITTER_URL  = (process.env.TWITTER_URL  || "#").trim();
const TELEGRAM_URL = (process.env.TELEGRAM_URL || "#").trim();

if (!BOT_TOKEN) { console.error("❌ Missing BOT_TOKEN"); process.exit(1); }
if (!CA)        { console.error("❌ Missing CA (token address)"); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

/* ========= CONSTANT LINKS ========= */
const bscLink  = `https://bscscan.com/token/${CA}`;
const pcsLink  = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
const pooLink  = `https://poocoin.app/tokens/${CA}`;
const dexToolsFromPair = (pair) => `https://www.dextools.io/app/en/bnb/pair-explorer/${pair}`;

/* ========= FORMAT HELPERS ========= */
const nf0  = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2  = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtUsd(x) {
  if (x == null || !isFinite(x)) return "—";
  if (x >= 1) return `$${nf2.format(+x)}`;
  // show very small prices with trimmed trailing zeros
  const s = (+x).toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s}`;
}
function fmtBnb(x) {
  if (x == null || !isFinite(x)) return "—";
  const s = (+x >= 1) ? (+x).toFixed(6) : (+x).toFixed(10);
  return `${s.replace(/0+$/, "").replace(/\.$/, "")} BNB`;
}
function fmtQty(x) {
  if (x == null || !isFinite(x)) return "—";
  if (x >= 1) return nf0.format(x);
  return (+x).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
function ago(tsMs) {
  if (!tsMs) return "just now";
  const diff = Date.now() - tsMs;
  const m = Math.max(1, Math.round(diff / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* ========= DEXSCREENER FETCHERS ========= */
/** Get pair data by explicit PAIR (preferred) */
async function fetchPairByAddress(pairAddr) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddr}`;
  const res = await fetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`Dexscreener pairs HTTP ${res.status}`);
  const json = await res.json();
  const p = Array.isArray(json?.pairs) ? json.pairs[0] : null;
  if (!p) throw new Error("Pair not found on Dexscreener");
  return p;
}

/** If PAIR is not provided, choose best BSC pair for CA (highest liquidity) */
async function fetchBestPairForToken(tokenAddr) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/bsc/${tokenAddr}`;
  const res = await fetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`Dexscreener tokens HTTP ${res.status}`);
  const json = await res.json();
  const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
  if (!pairs.length) throw new Error("No pairs found for token");
  const bscPairs = pairs.filter(p => (p?.chainId || "").toLowerCase() === "bsc");
  if (!bscPairs.length) throw new Error("No BSC pairs found for token");
  bscPairs.sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
  return bscPairs[0];
}

/** Unified: get a pair either by PAIR env or best for CA */
async function getPair() {
  if (PAIR) return fetchPairByAddress(PAIR);
  return fetchBestPairForToken(CA);
}

/* ========= REPLIES ========= */
const replyCA = async (ctx) => {
  const parts = [
    "🪙 <b>LABV2 Contract Address</b>",
    `<code>${CA}</code>`,
    "",
    `🔎 <a href="${bscLink}">BscScan</a> | 🥞 <a href="${pcsLink}">PancakeSwap</a>`
  ];

  // Add DexTools if we have or can resolve the pair
  try {
    const p = await getPair();
    const dexLink = dexToolsFromPair(p.pairAddress);
    parts.push(`📊 <a href="${dexLink}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a>`);
  } catch {
    // fallback without dextools
    parts.push(`💩 <a href="${pooLink}">PooCoin</a>`);
  }

  return ctx.replyWithHTML(parts.join("\n"), { disable_web_page_preview: true });
};

const replyChart = async (ctx) => {
  const lines = ["📊 <b>LABV2 Charts & Trade</b>"];
  try {
    const p = await getPair();
    const dexLink = dexToolsFromPair(p.pairAddress);
    lines.push(`• <a href="${dexLink}">DexTools</a>`);
  } catch {
    // ignore if cannot resolve pair
  }
  lines.push(`• <a href="${pooLink}">PooCoin</a>`);
  lines.push(`• <a href="${pcsLink}">PancakeSwap</a>`);

  return ctx.replyWithHTML(lines.join("\n"), { disable_web_page_preview: true });
};

const replyLinks = (ctx) =>
  ctx.replyWithHTML(
    [
      "🔗 <b>LABV2 Official Links</b>",
      `• 🌐 <a href="${WEBSITE_URL}">Website</a>`,
      `• 🐦 <a href="${TWITTER_URL}">Twitter/X</a>`,
      `• 💬 <a href="${TELEGRAM_URL}">Telegram</a>`
    ].join("\n"),
    { disable_web_page_preview: true }
  );

async function replyPrice(ctx) {
  try {
    const p = await getPair();

    // Determine if baseToken is our token
    const isBase = (p?.baseToken?.address || "").toLowerCase() === CA.toLowerCase();

    // USD price of LABV2
    const rawUsd = p?.priceUsd ? Number(p.priceUsd) : null;
    const priceUsd = rawUsd
      ? (isBase ? rawUsd : (1 / rawUsd))
      : null;

    // Native price (BNB)
    const rawNative = p?.priceNative ? Number(p.priceNative) : null;
    const priceBnb = rawNative
      ? (isBase ? rawNative : (1 / rawNative))
      : null;

    // Conversions
    const per1   = priceUsd ? (1   / priceUsd) : null;
    const per10  = priceUsd ? (10  / priceUsd) : null;
    const per100 = priceUsd ? (100 / priceUsd) : null;

    // 24h change
    const ch24 = (p?.priceChange?.h24 ?? null);
    const chTxt = (ch24 === null)
      ? "—"
      : (ch24 >= 0 ? `🟢 +${(+ch24).toFixed(2)}%` : `🔴 ${(+ch24).toFixed(2)}%`);

    // Liquidity / Volume / MC
    const liqUsd = (p?.liquidity?.usd != null) ? `$${nf0.format(+p.liquidity.usd)}` : "—";
    const vol24  = (p?.volume?.h24   != null) ? `$${nf0.format(+p.volume.h24)}`     : "—";

    const mcap = (p?.fdv != null)
      ? `$${nf0.format(+p.fdv)}`
      : ((p?.marketCap != null)
          ? `$${nf0.format(+p.marketCap)}`
          : "—");

    const updated = p?.updatedAt ? ago(p.updatedAt) : "just now";

    const dexLink = dexToolsFromPair(p.pairAddress);

    const lines = [
      `💹 <b>LABV2 Price</b> — ${fmtUsd(priceUsd)}`,
      `• Price: <b>${fmtUsd(priceUsd)}</b> (${fmtBnb(priceBnb)})`,
      `• $1 ≈ <b>${fmtQty(per1)}</b> LABV2`,
      `• $10 ≈ <b>${fmtQty(per10)}</b> LABV2`,
      `• $100 ≈ <b>${fmtQty(per100)}</b> LABV2`,
      `• 24h Change: <b>${chTxt}</b>`,
      `• 24h Volume: <b>${vol24}</b>`,
      `• Liquidity: <b>${liqUsd}</b>`,
      `• FDV/MC: <b>${mcap}</b>`,
      `• Updated: <i>${updated}</i>`,
      "",
      `📊 <a href="${dexLink}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a> | 🥞 <a href="${pcsLink}">Trade</a>`
    ];

    await ctx.replyWithHTML(lines.join("\n"), { disable_web_page_preview: true });
  } catch (err) {
    console.error("Price fetch error:", err);
    await ctx.reply("❌ Unable to fetch price right now. Please try again shortly.");
  }
}

/* ========= COMMANDS ========= */
bot.start((ctx) =>
  ctx.reply(
    "Hi! Use /ca, /chart, /price, or /links for LABV2 info.\n/help to see all commands."
  )
);

bot.help((ctx) =>
  ctx.reply(
    "🤖 Commands:\n" +
    "/ca – Contract + links\n" +
    "/chart – Charts & trade\n" +
    "/price – Live price + $1/$10/$100\n" +
    "/links – Website, Twitter/X, Telegram\n" +
    "/help – This menu"
  )
);

bot.command(["ca", "CA"], replyCA);
bot.command(["chart", "charts"], replyChart);
bot.command(["price", "prices"], replyPrice);
bot.command(["links", "link"], replyLinks);

/* ========= KEYWORD TRIGGERS (for groups) ========= */
bot.hears(/(^|\s)(ca|contract|address)(\?|!|\.|$)/i, replyCA);
bot.hears(/(^|\s)(price|chart)(\?|!|\.|$)/i, replyPrice);

/* ========= LAUNCH ========= */
bot.catch((err) => console.error("Bot error:", err));
bot.launch();
console.log("✅ LABV2 bot is running (CA/Chart/Price/Links).");
