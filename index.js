  // index.js — LABV2 Bot with correct USD price from PancakeSwap/GeckoTerminal
import { Telegraf } from "telegraf";
import fetch from "node-fetch";

const BOT_TOKEN    = process.env.BOT_TOKEN;
const CA           = (process.env.CA || "").trim();
const PAIR         = (process.env.PAIR || "").trim();
const WEBSITE_URL  = (process.env.WEBSITE_URL  || "#").trim();
const TWITTER_URL  = (process.env.TWITTER_URL  || "#").trim();
const TELEGRAM_URL = (process.env.TELEGRAM_URL || "#").trim();

if (!BOT_TOKEN || !CA) {
  console.error("❌ Missing BOT_TOKEN or CA");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 8, maximumFractionDigits: 12 });

function fmtUsd(x) {
  if (!x || x <= 0) return "$—";
  if (x >= 0.01) return `$${nf2.format(x)}`;
  return `$${x.toExponential(6)}`;
}
function fmtQty(x) {
  if (!x || x <= 0) return "—";
  return nf0.format(x);
}
function ago(tsMs) {
  if (!tsMs) return "just now";
  const diff = Date.now() - tsMs;
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

/* === Dexscreener === */
async function getPair() {
  try {
    const url = `https://api.dexscreener.com/latest/dex/pairs/bsc/${PAIR || CA}`;
    const res = await fetch(url);
    const json = await res.json();
    return json?.pairs?.[0] || null;
  } catch {
    return null;
  }
}

/* === PancakeSwap Info === */
async function getPancakeUsd(ca) {
  try {
    const url = `https://api.pancakeswap.info/api/v2/tokens/${ca}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const val = Number(j?.data?.price);
    return val > 0 ? val : null;
  } catch {
    return null;
  }
}

/* === GeckoTerminal === */
async function getGeckoUsd(ca) {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${ca}`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const val = Number(j?.data?.attributes?.price_usd);
    return val > 0 ? val : null;
  } catch {
    return null;
  }
}

/* === Price Handler === */
async function replyPrice(ctx) {
  try {
    const p = await getPair();
    let usd = await getPancakeUsd(CA);
    if (!usd) usd = await getGeckoUsd(CA);

    const per1   = usd ? (1   / usd) : null;
    const per10  = usd ? (10  / usd) : null;
    const per100 = usd ? (100 / usd) : null;

    const ch24  = p?.priceChange?.h24 ?? "—";
    const vol24 = p?.volume?.h24 ? `$${nf0.format(p.volume.h24)}` : "—";
    const liq   = p?.liquidity?.usd ? `$${nf0.format(p.liquidity.usd)}` : "—";
    const mcap  = p?.fdv ? `$${nf0.format(p.fdv)}` : "—";
    const updated = p?.updatedAt ? ago(p.updatedAt) : "just now";

    const msg = [
      `💹 <b>LABV2 Price</b> — ${fmtUsd(usd)}`,
      `• $1 ≈ ${fmtQty(per1)} LABV2`,
      `• $10 ≈ ${fmtQty(per10)} LABV2`,
      `• $100 ≈ ${fmtQty(per100)} LABV2`,
      `• 24h Change: ${ch24}%`,
      `• 24h Volume: ${vol24}`,
      `• Liquidity: ${liq}`,
      `• FDV/MC: ${mcap}`,
      `• Updated: ${updated}`
    ];

    await ctx.replyWithHTML(msg.join("\n"), { disable_web_page_preview: true });
  } catch (e) {
    console.error(e);
    ctx.reply("❌ Could not fetch price right now.");
  }
}

/* === Commands === */
bot.command("price", replyPrice);
bot.start((ctx) => ctx.reply("Hi! Use /price, /ca, /chart, /links"));
bot.launch();
