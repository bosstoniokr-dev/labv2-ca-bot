 import { Telegraf } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CA = process.env.CA || "0x07f5ceded6b3dba557b3663edc8941fb37b63945";
const PAIR = process.env.PAIR; // LABV2/WBNB pair
if (!BOT_TOKEN) { console.error("Missing BOT_TOKEN"); process.exit(1); }
if (!PAIR) { console.error("Missing PAIR env var"); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// ---- Links
const bsc  = `https://bscscan.com/token/${CA}`;
const pcs  = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
const dext = `https://www.dextools.io/app/en/bnb/pair-explorer/${PAIR}`;
const poo  = `https://poocoin.app/tokens/${CA}`;

// ---- Helpers
const replyCA = (ctx) =>
  ctx.replyWithHTML(
    [
      "🪙 <b>LABV2 Contract Address</b>",
      `<code>${CA}</code>`,
      "",
      `🔎 <a href="${bsc}">BscScan</a> | 🥞 <a href="${pcs}">PancakeSwap</a>`,
      `📊 <a href="${dext}">DexTools</a> | 💩 <a href="${poo}">PooCoin</a>`
    ].join("\n"),
    { disable_web_page_preview: true }
  );

const replyChart = (ctx) =>
  ctx.replyWithHTML(
    [
      "📊 <b>LABV2 Charts & Trade</b>",
      `• <a href="${dext}">DexTools (pair)</a>`,
      `• <a href="${poo}">PooCoin (token)</a>`,
      `• <a href="${pcs}">PancakeSwap (trade)</a>`
    ].join("\n"),
    { disable_web_page_preview: true }
  );

// Format big numbers nicely
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// Fetch price/metrics from Dexscreener
async function fetchDexscreener() {
  const url = `https://api.dexscreener.com/latest/dex/pairs/bsc/${PAIR}`;
  const res = await fetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`Dexscreener HTTP ${res.status}`);
  const data = await res.json();
  const pair = data?.pairs?.[0];
  if (!pair) throw new Error("Pair not found in Dexscreener");
  return pair; // contains priceUsd, priceNative, volume, liquidity, priceChange, fdv, etc.
}

function ago(tsMs) {
  const diff = Date.now() - tsMs;
  const m = Math.max(1, Math.round(diff / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

async function replyPrice(ctx) {
  try {
    const p = await fetchDexscreener();

    const priceUsd = p.priceUsd ? `$${nf.format(+p.priceUsd)}` : "—";
    const priceBnb = p.priceNative ? `${nf.format(+p.priceNative)} BNB` : "—";
    const ch24 = p.priceChange?.h24 ?? null;
    const chTxt = ch24 === null ? "—"
      : (ch24 >= 0 ? `🟢 +${nf.format(ch24)}%` : `🔴 ${nf.format(ch24)}%`);

    const vol24 = p.volume?.h24 ? `$${nf0.format(+p.volume.h24)}` : "—";
    const liqUsd = p.liquidity?.usd ? `$${nf0.format(+p.liquidity.usd)}` : "—";
    const mcap = p.fdv ? `$${nf0.format(+p.fdv)}` : (p.marketCap ? `$${nf0.format(+p.marketCap)}` : "—");
    const lastTs = p.txns?.h24?.buys || p.txns?.h24?.sells ? p.updatedAt : Date.now();
    const updated = p.updatedAt ? ago(p.updatedAt) : "just now";

    const lines = [
      "💹 <b>LABV2 Price</b>",
      `• Price: <b>${priceUsd}</b> (${priceBnb})`,
      `• 24h Change: <b>${chTxt}</b>`,
      `• 24h Volume: <b>${vol24}</b>`,
      `• Liquidity: <b>${liqUsd}</b>`,
      `• FDV/MC: <b>${mcap}</b>`,
      `• Updated: <i>${updated}</i>`,
      "",
      `📊 <a href="${dext}">DexTools</a> | 💩 <a href="${poo}">PooCoin</a> | 🥞 <a href="${pcs}">Trade</a>`
    ];

    await ctx.replyWithHTML(lines.join("\n"), { disable_web_page_preview: true });
  } catch (e) {
    console.error("Price fetch error:", e);
    await ctx.reply("❌ Unable to fetch price right now. Try again shortly.");
  }
}

// ---- Commands
bot.start((ctx) => ctx.reply("Hi! Use /ca for the contract, /chart for charts, /price for live price."));
bot.help((ctx) => ctx.reply("Commands:\n/ca – Contract & links\n/chart – Charts & trade links\n/price – Live price & metrics"));

bot.command(["ca", "CA"], replyCA);
bot.command(["chart", "charts"], replyChart);
bot.command(["price", "prices"], replyPrice);

// ---- Keyword triggers in groups (privacy DISABLED)
bot.hears(/(^|\s)(ca|contract|address)(\?|!|\.|$)/i, replyCA);
bot.hears(/(^|\s)(chart|price)(\?|!|\.|$)/i, replyPrice);

bot.catch((err) => console.error("Bot error:", err));
bot.launch();
console.log("LABV2 CA/Chart/Price bot is running.");

