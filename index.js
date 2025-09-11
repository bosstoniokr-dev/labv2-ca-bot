 import { Telegraf } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CA = process.env.CA || "0x07f5ceded6b3dba557b3663edc8941fb37b63945";
if (!BOT_TOKEN) { console.error("Missing BOT_TOKEN"); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// Links
const bsc  = `https://bscscan.com/token/${CA}`;
const pcs  = `https://pancakeswap.finance/swap?outputCurrency=${CA}`;
const dext = `https://www.dextools.io/app/en/bnb/pair-explorer?query=${CA}`;
const poo  = `https://poocoin.app/tokens/${CA}`;

// Single place to reply with CA (HTML avoids Markdown escaping issues)
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

// Commands
bot.start((ctx) => ctx.reply("Hi! Use /ca to get the LABV2 contract address."));
bot.help((ctx) => ctx.reply("Commands:\n/ca – show LABV2 contract address"));
bot.command(["ca", "CA"], replyCA); // handle /ca and /CA

// Keyword triggers in groups (needs privacy DISABLED)
bot.hears(/(^|\s)ca(\?|!|\.|$)/i, replyCA);

bot.catch((err) => console.error("Bot error:", err));
bot.launch();
console.log("LABV2 CA bot is running.");
