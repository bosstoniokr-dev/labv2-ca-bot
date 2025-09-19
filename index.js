 import { Telegraf } from "telegraf";
import fetch from "node-fetch";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CA = process.env.CA || "0x07f5ceded6b3dba557b3663edc8941fb37b63945";
if (!BOT_TOKEN) { console.error("Missing BOT_TOKEN"); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// ---- Links
const bsc  = `https://bscscan.com/token/${CA}`;
const pcs  = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
const poo  = `https://poocoin.app/tokens/${CA}`;

// ---- Format helpers
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtUsd(x) {
  if (x == null || isNaN(x)) return "—";
  if (x >= 1) return `$${nf2.format(+x)}`;
  return `$${(+x).toFixed(10).replace(/0+$/, "").replace(/\.$/, "")}`;
}
function fmtBnb(x) {
  if (x == null || isNaN(x)) return "—";
  if (x >= 1) return `${(+x).toFixed(6)} BNB`;
  return `${(+x).toFixed(10).replace(/0+$/, "").replace(/\.$/, "")} BNB`;
}
function fmtQty(x) {
  if (x == null || !isFinite(x)) return "—";
  if (x >= 1) return nf0.format(x);
  return (+x).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

// ---- Get best pair from Dexscreener
async function getBestPair() {
  const url = `https://api.dexscreener.com/latest/dex/tokens/bsc/${CA}`;
  const res = await fetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`Dexscreener HTTP ${res.status}`);
  const data = await res.json();
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  if (!pairs.length) throw new Error("No pairs found on Dexscreener");

  // Pick the highest liquidity BSC pair
  const bscPairs = pairs.filter(p => (p?.chainId || "").toLowerCase() === "bsc");
  const chosen = bscPairs.sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))[0];
  if (!chosen) throw new Error("No BSC pair found");
  return chosen;
}

function ago(tsMs) {
  const diff = Date.now() - tsMs;
  const m = Math.max(1, Math.round(diff / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ---- Command replies
const replyCA = (ctx) =>
  ctx.replyWithHTML(
    [
      "🪙 <b>LABV2 Contract Address</b>",
      `<code>${CA}</code>`,
      "",
      `🔎 <a href="${bsc}">BscScan</a> | 🥞 <a href="${pcs}">PancakeSwap</a>`,
      `📊 <a href="https://www.dextools.io/app/en/bnb/pair-explorer/0xe5d1a819a22d16cc34fad3d2d8f7f553bd474407">DexTools</a> | 💩 <a href="${poo}">PooCoin</a>`
    ].join("\n"),
    { disable_web_page_preview: true }
  );

const replyChart = (ctx) =>
  ctx.replyWithHTML(
    [
      "📊 <b>LABV2 Charts & Trade</b>",
      `• <a href="https://www.dextools.io/app/en/bnb/pair-explorer/0xe5d1a819a22d16cc34fad3d2d8f7f553bd474407">DexTools</a>`,
      `• <a href="${poo}">PooCoin</a>`,
      `• <a href="${pcs}">PancakeSwap</a>`
    ].join("\n"),
    { disable_web_page_preview: true }
  );

async function replyPrice(ctx) {
  try {
    const p = await getBestPair();

    const isBase = (p?.baseToken?.address || "").toLowerCase() === CA.toLowerCase();
    const rawPriceUsd = p?.priceUsd ? Number(p.priceUsd) : null;
    const tokenPriceUsd = rawPriceUsd ? (isBase ? rawPriceUsd : (1 / rawPriceUsd)) : null;

    const priceUsd = tokenPriceUsd;
    const priceBnb = p?.priceNative ? (isBase ? Number(p.priceNative) : (1 / Number(p.priceNative))) : null;

    // Conversions
    const perUsd = priceUsd ? (1 / priceUsd) : null;
    const per10Usd = priceUsd ? (10 / priceUsd) : null;
    const per100Usd = priceUsd ? (100 / priceUsd) : null;

    const ch24 = (p?.priceChange?.h24 ?? null);
    const chTxt = ch24 === null ? "—" : (ch24 >= 0 ? `🟢 +${ch24.toFixed(2)}%` : `🔴 ${ch24.toFixed(2)}%`);
    const vol24 = p?.volume?.h24 ? `$${nf0.format(+p.volume.h24)}` : "—";
    const liqUsd = p?.liquidity?.usd ? `$${nf0.format(+p.liquidity.usd)}` : "—";
    const mcap = p?.fdv ? `$${nf0.format(+p.fdv)}` : (p?.marketCap ? `$${nf0.format(+p.marketCap)}` : "—");
    const updated = p?.updatedAt ? ago(p.updatedAt) : "just now";

    const dextLink = `https://www.dextools.io/app/en/bnb/pair-explorer/${p.pairAddress}`;
    const pcsLink  = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
    const pooLink  = `https://poocoin.app/tokens/${CA}`;

    const lines = [
      `💹 <b>LABV2 Price</b> — ${fmtUsd(priceUsd)}`,
      `• Price: <b>${fmtUsd(priceUsd)}</b> (${fmtBnb(priceBnb)})`,
      `• $1 ≈ <b>${fmtQty(perUsd)}</b> LABV2`,
      `• $10 ≈ <b>${fmtQty(per10Usd)}</b> LABV2`,
      `• $100 ≈ <b>${fmtQty(per100Usd)}</b> LABV2`,
      `• 24h Change: <b>${chTxt}</b>`,
      `• 24h Volume: <b>${vol24}</b>`,
      `• Liquidity: <b>${liqUsd}</b>`,
      `• FDV/MC: <b>${mcap}</b>`,
      `• Updated: <i>${updated}</i>`,
      "",
      `📊 <a href="${dextLink}">DexTools</a> | 💩 <a href="${pooLink}">PooCoin</a> | 🥞 <a href="${pcsLink}">Trade</a>`
    ];

    await ctx.replyWithHTML(lines.join("\n"), { disable_web_page_preview: true });
  } catch (e) {
    console.error("Price fetch error:", e);
    await ctx.reply("❌ Unable to fetch price right now. Try again shortly.");
  }
}

// ---- Commands
bot.start((ctx) => ctx.reply("Hi! Use /ca, /chart, or /price for LABV2 info."));
bot.help((ctx) => ctx.reply("🤖 Commands:\n/ca – Contract + links\n/chart – Charts & trade\n/price – Live price & conversions\n/help – This menu"));

bot.command(["ca", "CA"], replyCA);
bot.command(["chart", "charts"], replyChart);
bot.command(["price", "prices"], replyPrice);

// ---- Keyword triggers in groups
bot.hears(/(^|\s)(ca|contract|address)(\?|!|\.|$)/i, replyCA);
bot.hears(/(^|\s)(chart|price)(\?|!|\.|$)/i, replyPrice);

bot.catch((err) => console.error("Bot error:", err));
bot.launch();
console.log("LABV2 CA/Chart/Price bot is running.");
