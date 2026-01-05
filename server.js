const admin = require('firebase-admin');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api'); // New
const cron = require('node-cron'); // New
const serviceAccount = require("./serviceAccountKey.json");

// 1. INITIALIZE FIREBASE
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// 2. CONFIGURATION
const BOT_TOKEN = "8126112394:AAH7-da80z0C7tLco-ZBoZryH_6hhZBKfhE";
const CHAT_ID = "-1003687297299"; // Your verified numeric ID
const SITE_URL = "https://vortexlive.online";

// Initialize the Bot for "Listening"
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let lastKnownData = {};

// --- EXISTING FUNCTION: Send Telegram Alerts (Firebase) ---
async function sendTelegram(text) {
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: text, parse_mode: 'Markdown', disable_web_page_preview: true })
        });
        console.log("✅ Telegram Alert Sent");
    } catch (err) { console.error("❌ Error:", err.message); }
}

// --- NEW FEATURE 1: AUTO-ENGAGEMENT MESSAGES (Every 4 Hours) ---
cron.schedule('0 */4 * * *', () => {
    const promoMessages = [
        "⚽ Don't miss the action! Live streams are active now on Vortex Arena.",
        "🔥 New match stats have been updated. Check the site!",
        "🎯 Looking for today's best odds? Check the latest games on our site."
    ];
    const randomMsg = promoMessages[Math.floor(Math.random() * promoMessages.length)];
    sendTelegram(randomMsg);
    console.log("⏰ Scheduled promo sent.");
});

// --- NEW FEATURE 2: BETTING CODE FORWARDER ---
bot.on('message', (msg) => {
    // Regex to detect codes: 6 to 12 characters, uppercase and numbers
    const betCodeRegex = /\b[A-Z0-9]{6,12}\b/g;
    
    // Ignore messages from your own channel to avoid loops
    if (msg.text && msg.chat.id.toString() !== CHAT_ID) {
        const foundCodes = msg.text.match(betCodeRegex);
        
        if (foundCodes) {
            const forwardText = `🎯 **New Bet Code Detected**\n\n` +
                                `Code: \`${foundCodes[0]}\` \n` +
                                `Source: ${msg.chat.title || "External Group"}\n\n` +
                                `👉 [Watch Live Matches](${SITE_URL})`;

            bot.sendMessage(CHAT_ID, forwardText, { parse_mode: 'Markdown' });
            console.log(`➡️ Forwarded code ${foundCodes[0]} to channel.`);
        }
    }
});

// --- EXISTING LOGIC: Firebase Polling ---
async function pollVortexEngine() {
    try {
        const snapshot = await db.collection('fixtures').get();
        snapshot.forEach(doc => {
            const data = doc.data();
            const matchId = doc.id;
            const currentScore = `${data.homeScore || 0}-${data.awayScore || 0}`;
            const currentStatus = (data.status || 'NS').toUpperCase();
            const lastEvent = data.lastEvent;
            const eventTeam = data.eventTeam || "a team";
            const eventTime = data.eventTime || 0;

            const scoreKey = `${matchId}_score`;
            const statusKey = `${matchId}_status`;
            const eventKey = `${matchId}_event_${eventTime}`;

            if (lastKnownData[scoreKey] === undefined) {
                lastKnownData[scoreKey] = currentScore;
                lastKnownData[statusKey] = currentStatus;
                lastKnownData[eventKey] = true;
                return;
            }

            if (lastKnownData[scoreKey] !== currentScore) {
                const [oldH, oldA] = lastKnownData[scoreKey].split('-').map(Number);
                const isVAR = ((data.homeScore || 0) < oldH || (data.awayScore || 0) < oldA);
                const header = isVAR ? "🖥 *VAR: GOAL CANCELLED*" : "⚽ *GOAL ALERT!*";
                sendTelegram(`${header}\n\n🏆 ${data.league || 'Football'}\n🔥 *${data.home} ${currentScore} ${data.away}*\n\n🔗 [WATCH LIVE](${SITE_URL})`);
                lastKnownData[scoreKey] = currentScore;
            }

            if (lastKnownData[statusKey] !== currentStatus) {
                let msg = "";
                if (currentStatus === '1H') msg = `🎬 *KICK OFF!* \n*${data.home} vs ${data.away}* is LIVE!`;
                if (currentStatus === 'HT') msg = `⏸ *HALF TIME* \n*${data.home} ${currentScore} ${data.away}*`;
                if (currentStatus === 'FT') msg = `🏁 *FULL TIME* \n*${data.home} ${currentScore} ${data.away}*`;
                if (msg) sendTelegram(`${msg}\n🔗 [WATCH](${SITE_URL})`);
                lastKnownData[statusKey] = currentStatus;
            }

            if (lastEvent && !lastKnownData[eventKey]) {
                let eventMsg = "";
                if (lastEvent === 'RED_CARD') eventMsg = `🟥 *RED CARD!* \nDrama! *${eventTeam}* has been sent off in *${data.home} vs ${data.away}*!`;
                if (lastEvent === 'PENALTY') eventMsg = `🎯 *PENALTY!* \nReferee points to the spot for *${eventTeam}* in *${data.home} vs ${data.away}*!`;
                if (lastEvent === 'VAR') eventMsg = `🖥 *VAR CHECK!* \nRef is consulting the screen in *${data.home} vs ${data.away}*...`;
                
                if (eventMsg) sendTelegram(`${eventMsg}\n🔗 [WATCH](${SITE_URL})`);
                lastKnownData[eventKey] = true;
            }
        });
    } catch (err) { console.error("🔥 Error:", err.message); }
}

setInterval(pollVortexEngine, 3000);
console.log("🚀 Vortex Engine Online with Telegram Bot Listening...");