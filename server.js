const admin = require('firebase-admin');
const fetch = require('node-fetch');

// 1. DATABASE CONFIGURATION
const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

// 2. SETTINGS
const BOT_TOKEN = "8126112394:AAH7-da80z0C7tLco-ZBoZryH_6hhZBKfhE";
const CHAT_ID = "@LivefootballVortex";
const SITE_URL = "https://vortexlive.online";

// Memory to track changes and prevent duplicate alerts
let lastKnownData = {};

// 3. TELEGRAM SENDER
async function sendTelegram(text) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: text,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            })
        });
        const res = await response.json();
        if (res.ok) {
            console.log("✅ Telegram Alert Sent Successfully");
        } else {
            console.log("⚠️ Telegram API Error:", res.description);
        }
    } catch (err) {
        console.error("❌ Network Error:", err.message);
    }
}

// 4. SMART POLLING ENGINE
async function pollVortexEngine() {
    try {
        const snapshot = await db.collection('fixtures').get();
        
        if (snapshot.empty) return;

        snapshot.forEach(doc => {
            const data = doc.data();
            const matchId = doc.id;
            
            // Current match states
            const hScore = data.homeScore || 0;
            const aScore = data.awayScore || 0;
            const currentScore = `${hScore}-${aScore}`;
            const currentStatus = (data.status || 'NS').toUpperCase();
            
            // Event states from Admin HQ
            const lastEvent = data.lastEvent;
            const eventTime = data.eventTime || 0;

            const scoreKey = `${matchId}_score`;
            const statusKey = `${matchId}_status`;
            const eventKey = `${matchId}_event_${eventTime}`; // Unique key per event timestamp

            // 1. Initialize match in memory if new to avoid spamming existing data
            if (lastKnownData[scoreKey] === undefined) {
                lastKnownData[scoreKey] = currentScore;
                lastKnownData[statusKey] = currentStatus;
                lastKnownData[eventKey] = true; 
                console.log(`📥 Initialized: ${data.home} vs ${data.away}`);
                return;
            }

            // 2. Detect Score Changes (Goal vs VAR Cancellation)
            if (lastKnownData[scoreKey] !== currentScore) {
                const [oldH, oldA] = lastKnownData[scoreKey].split('-').map(Number);
                const isVAR = (hScore < oldH || aScore < oldA);
                
                const header = isVAR ? "🖥 *VAR: GOAL CANCELLED*" : "⚽ *GOAL ALERT!*";
                const message = `${header}\n\n🏆 ${data.league || 'Football'}\n🔥 *${data.home} ${hScore} \\- ${aScore} ${data.away}*\n\n🔗 [WATCH LIVE](${SITE_URL})`;
                
                sendTelegram(message);
                lastKnownData[scoreKey] = currentScore;
            }

            // 3. Detect Status Changes (Kickoff, HT, FT)
            if (lastKnownData[statusKey] !== currentStatus) {
                let statusMsg = "";
                if (currentStatus === '1H' || currentStatus === 'LIVE') {
                    statusMsg = `🎬 *KICK OFF!*\n\n*${data.home} vs ${data.away}* is now LIVE!`;
                } else if (currentStatus === 'HT') {
                    statusMsg = `⏸ *HALF TIME*\n\n*${data.home} ${currentScore} ${data.away}*`;
                } else if (currentStatus === 'FT') {
                    statusMsg = `🏁 *FULL TIME*\n\n*${data.home} ${currentScore} ${data.away}*`;
                }

                if (statusMsg) {
                    sendTelegram(`${statusMsg}\n👉 [WATCH](${SITE_URL})`);
                }
                lastKnownData[statusKey] = currentStatus;
            }

            // 4. NEW: Detect HQ Event Triggers (Red Cards, Penalties, VAR Checks)
            if (lastEvent && !lastKnownData[eventKey]) {
                let eventMsg = "";
                
                switch(lastEvent) {
                    case 'RED_CARD':
                        eventMsg = `🟥 *RED CARD!* \n\nDrama in *${data.home} vs ${data.away}*! A player has been sent off!`;
                        break;
                    case 'PENALTY':
                        eventMsg = `🎯 *PENALTY!* \n\nRef points to the spot in *${data.home} vs ${data.away}*! Huge moment!`;
                        break;
                    case 'VAR':
                        eventMsg = `🖥 *VAR CHECK!* \n\nThe ref is checking the screen in *${data.home} vs ${data.away}*... Hold your breath.`;
                        break;
                }

                if (eventMsg) {
                    sendTelegram(`${eventMsg}\n\n🔗 [WATCH LIVE](${SITE_URL})`);
                }
                // Mark this specific event (by time) as sent
                lastKnownData[eventKey] = true;
            }
        });
    } catch (err) {
        console.error("🔥 Firebase Engine Error:", err.message);
    }
}

// --- START SERVER ---
console.log("🚀 Vortex Live Server Starting...");
console.log("📡 Mode: Smart Polling (Anti-Crash enabled)");

// Run poll every 3 seconds
setInterval(pollVortexEngine, 3000);

// Initial startup notification
sendTelegram("🤖 *Vortex Live Bot:* Engine Online & Monitoring 🌍");