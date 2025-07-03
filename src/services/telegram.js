const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Add your chat or channel ID to .env

async function sendTelegramNotification(grants) {
    if (!CHAT_ID) {
        console.log("TELEGRAM_CHAT_ID not set. Skipping notification.");
        return;
    }
    if (!grants || grants.length === 0) {
        await bot.telegram.sendMessage(CHAT_ID, "Щотижнева перевірка грантів завершена. Нових можливостей не знайдено.");
        return;
    }

    let message = `<b>Знайдено нові гранти (${grants.length}):</b>\n\n`;
    grants.forEach(grant => {
        message += `<b>Назва:</b> ${grant.title}\n`;
        message += `<b>Категорія:</b> ${grant.category}\n`;
        message += `<b>Дедлайн:</b> ${grant.deadline}\n`;
        message += `<a href="${grant.url}">Посилання</a>\n\n`;
    });

    try {
        // Split message into chunks if it's too long
        const MAX_LENGTH = 4096;
        if (message.length > MAX_LENGTH) {
            const messageChunks = message.match(new RegExp(`(.|\n){1,${MAX_LENGTH}}`, 'g'));
            for (const chunk of messageChunks) {
                await bot.telegram.sendMessage(CHAT_ID, chunk, { parse_mode: 'HTML' });
            }
        } else {
            await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' });
        }
        console.log('Telegram notification sent.');
    } catch (error) {
        console.error('Error sending Telegram notification:', error);
    }
}

module.exports = { sendTelegramNotification };
