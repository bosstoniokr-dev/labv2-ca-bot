 // index.js — LABV2 Bot (CA / Chart / Price / Links) using DexScreener TOKEN endpoint
import { Telegraf } from "telegraf";
import fetch from "node-fetch";

/* ========= ENV ========= */
const BOT_TOKEN    = process.env.BOT_TOKEN;
const CA           = (process.env.CA || "").trim();           // token address (required)
const PAIR_ENV     = (process.env.PAIR || "").trim();         // optional pair address for links
const WEBSITE_URL  = (process.env.WEBSITE_URL  || "#").trim();
const TWITTER_URL  = (process.env.TWITTER_URL  || "#").trim();
const TELEGRAM_URL = (process.env.TELEGRAM_URL || "#").trim();

if (!BOT_TOKEN || !CA) { console.error("❌ Missing BOT_TOKEN or CA"); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

/* ========= Links ========= */
const bscLink  = `https://bscscan.com/token/${CA}`;
const pcsLink  = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
const pooLink  = `https://poocoin.app/tokens/${CA}`;
const dexToolsPair = (pair) => `https://www.dextools.io/app/en/bnb/pair-explorer/${pair}`;

/* ========= Formatters ========= */
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

/* ========= External fetchers ========= */
// DexScreener TOKEN endpoint (price is for OUR token)
async function getBestTokenPair(ca) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/bsc/${ca}`;
  const res = await fetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`Dexscreener tokens HTTP ${res.status}`);
  const j = await res.json();
  const arr = Array.isArray(j?.pairs) ? j.pairs : [];
  if (!arr.length) throw new Error("No pairs for token");
  // Prefer highest USD liquidity
  arr.sort((a,b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
  return arr[0];
}
async function getPancakeUsd(ca) {
  try {
    const r = await fetch(`https://api.pancakeswap.info/api/v2/tokens/${ca}`, { timeout: 15000 });
    if (!r.ok) return null;
    const j = await r.json();
    const v = Number(j?.data?.price);
    return v > 0 ? v : null;
  } catch { return null; }
}
async function getGeckoUsd(ca) {
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${ca}`, {
      timeout: 15000, headers: { accept: "application/json" }
    });
    if (!r.ok) return null;
    const j = await r.json();
    const v = Number(j?.data?.attributes?.price_usd);
    return v > 0 ? v : null;
  } catch { return null; }
}

/* ========= Replies ========= */
async function replyCA(ctx) {
  const parts = [
    "🪙 <b>LABV2 Contract Address</b>",
    `<code>${CA}</code>`,
    "",
    `🔎 <a href="${bscLink}">BscScan</a> | 🥞 <a href="${pcsLink}">PancakeSwap</a>`
  ];
  try {
    const p = await getBestTokenPair(CA);
    parts.push(`📊 <a href="${dexToolsPair(p?.pairAddress || PAIR_ENV || "")}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a>`);
  } catch {
    if (PAIR_ENV) parts.push(`📊 <a href="${dexToolsPair(PAIR_ENV)}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a>`);
    else parts.push(`💩 <a href="${pooLink}">PooCoin</a>`);
  }
  return ctx.replyWithHTML(parts.join("\n"), { disable_web_page_preview: true });
}

async function replyChart(ctx) {
  const lines = ["📊 <b>LABV2 Charts & Trade</b>"];
  try {
    const p = await getBestTokenPair(CA);
    if (p?.pairAddress) lines.push(`• <a href="${dexToolsPair(p.pairAddress)}">DexTools</a>`);
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

async function replyPrice(ctx) {
  try {
    const p = await getBestTokenPair(CA); // ← gives OUR token priceUsd
    let usd = Number(p?.priceUsd) > 0 ? Number(p.priceUsd) : null;

    // Fallbacks if DexScreener doesn't return price
    if (!usd) usd = await getPancakeUsd(CA);
    if (!usd) usd = await getGeckoUsd(CA);

    const per1   = usd ? (1   / usd) : null;
    const per10  = usd ? (10  / usd) : null;
    const per100 = usd ? (100 / usd) : null;

    const ch24 = (p?.priceChange?.h24 ?? null);
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
      `📊 <a href="${dexToolsPair(linkPair)}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a> | 🥞 <a href="${pcsLink}">Trade</a>`
    ];

    await ctx.replyWithHTML(lines.join("\n"), { disable_web_page_preview: true });
  } catch (err) {
    console.error("Price error:", err);
    await ctx.reply("❌ Unable to fetch price right now. Please try again soon.");
  }
}

/* ========= Commands ========= */
bot.start((ctx) => ctx.reply("Hi! Use /ca, /chart, /price, or /links.\n/help for all commands."));
bot.help((ctx) => ctx.reply("Commands:\n/ca\n/chart\n/price\n/links"));

bot.command(["ca","CA"], replyCA);
bot.command(["chart","charts"], replyChart);
bot.command(["price","prices"], replyPrice);
bot.command(["links","link"], replyLinks);

// group keywords
bot.hears(/(^|\s)(ca|contract|address)(\?|!|\.|$)/i, replyCA);
bot.hears(/(^|\s)(price|chart)(\?|!|\.|$)/i, replyPrice);

/* ========= Launch ========= */
bot.catch((e)=>console.error("Bot error:", e));
bot.launch();
console.log("✅ LABV2 bot running with token-price source (DexScreener tokens endpoint).");
