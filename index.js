import { Telegraf } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CA = process.env.CA || "0x07f5ceded6b3dba557b3663edc8941fb37b63945";

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN"); process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// helpers
const replyCA = (ctx) =>
  ctx.reply(
    [
      "🪙 LABV2 Contract Address",
      "```",
      CA,
      "```",
      `🔎 BscScan: https://bscscan.com/token/${CA}`,
      `🥞 PancakeSwap: https://pancakeswap.finance/swap?outputCurrency=${CA}`,
    ].join("\n"),
    { parse_mode: "MarkdownV2", disable_web_page_preview: true }
  );

// commands
bot.start((ctx) => ctx.reply("Hi! Use /ca to get the LABV2 contract address."));
bot.help((ctx) => ctx.reply("Commands:\n/ca – show LABV2 contract address"));
bot.command("ca", replyCA);

// keyword triggers (privacy must be DISABLED in BotFather)
bot.hears(/(^|\s)ca(\?|!|\.|$)/i, replyCA);

bot.catch((err) => console.error("Bot error:", err));
bot.launch();
console.log("LABV2 CA bot is running.");
 

