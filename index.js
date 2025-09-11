 import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply("🚀 LABV2 Contract Bot is online! Ask me for the CA."));
bot.help((ctx) => ctx.reply("Type 'CA' to get the LABV2 contract address."));

bot.hears(/ca/i, (ctx) => {
  ctx.reply(`🔑 LABV2 Contract Address:\n${process.env.CA}`);
});

bot.launch();

