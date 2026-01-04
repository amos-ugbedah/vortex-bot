const admin = require('firebase-admin');
const fetch = require('node-fetch');
const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const BOT_TOKEN = "8126112394:AAH7-da80z0C7tLco-ZBoZryH_6hhZBKfhE";
const CHAT_ID = "@LivefootballVortex";
const SITE_URL = "https://vortexlive.online";

let lastKnownData = {};

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

            // Detect Score Changes
            if (lastKnownData[scoreKey] !== currentScore) {
                const [oldH, oldA] = lastKnownData[scoreKey].split('-').map(Number);
                const isVAR = ((data.homeScore || 0) < oldH || (data.awayScore || 0) < oldA);
                const header = isVAR ? "🖥 *VAR: GOAL CANCELLED*" : "⚽ *GOAL ALERT!*";
                sendTelegram(`${header}\n\n🏆 ${data.league || 'Football'}\n🔥 *${data.home} ${currentScore} ${data.away}*\n\n🔗 [WATCH LIVE](${SITE_URL})`);
                lastKnownData[scoreKey] = currentScore;
            }

            // Detect Status Changes
            if (lastKnownData[statusKey] !== currentStatus) {
                let msg = "";
                if (currentStatus === '1H') msg = `🎬 *KICK OFF!* \n*${data.home} vs ${data.away}* is LIVE!`;
                if (currentStatus === 'HT') msg = `⏸ *HALF TIME* \n*${data.home} ${currentScore} ${data.away}*`;
                if (currentStatus === 'FT') msg = `🏁 *FULL TIME* \n*${data.home} ${currentScore} ${data.away}*`;
                if (msg) sendTelegram(`${msg}\n🔗 [WATCH](${SITE_URL})`);
                lastKnownData[statusKey] = currentStatus;
            }

            // Detect Event Triggers (Red Card/Penalty)
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
console.log("🚀 Vortex Engine Online");