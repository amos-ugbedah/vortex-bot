const admin = require('firebase-admin');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const express = require('express');

// --- RENDER HEALTH CHECK SERVER ---
// Render requires a web server to stay active on the free tier
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Vortex Bot Status: Active and Running');
});

app.listen(PORT, () => {
    console.log(`✅ Health check listening on port ${PORT}`);
});

// --- 1. INITIALIZE FIREBASE (Render-Safe Version) ---
if (!admin.apps.length) {
    try {
        // Parse the JSON from the 'FIREBASE_CONFIG' environment variable
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ 
            credential: admin.credential.cert(serviceAccount) 
        });
        console.log("✅ Firebase Admin Initialized");
    } catch (error) {
        console.error("❌ Firebase Init Error. Check Environment Variables:", error.message);
    }
}
const db = admin.firestore();

// --- 2. CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN || "8126112394:AAH7-da80z0C7tLco-ZBoZryH_6hhZBKfhE";
const KEY_API_SPORTS = process.env.KEY_API_SPORTS || '0131b99f8e87a724c92f8b455cc6781d'; 

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- SYNC FUNCTION: Daily Match Creation ---
async function syncMatches() {
    try {
        console.log("⚽ Fetching daily fixtures...");
        const res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            params: { 
                date: new Date().toISOString().split('T')[0],
                status: 'NS-1H-HT-2H-LIVE' 
            }, 
            headers: { 'x-apisports-key': KEY_API_SPORTS }
        });

        const matches = res.data.response;
        if (!matches || matches.length === 0) return console.log("⚠️ No matches found today.");

        const batch = db.batch();

        matches.forEach(m => {
            const docRef = db.collection('matches').doc(String(m.fixture.id));
            batch.set(docRef, {
                fixtureId: m.fixture.id,
                homeTeam: { name: m.teams.home.name, logo: m.teams.home.logo },
                awayTeam: { name: m.teams.away.name, logo: m.teams.away.logo },
                status: m.fixture.status.short,
                league: m.league.name,
                kickOffTime: m.fixture.date,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                streamUrl1: "", 
                streamUrl2: "", 
                streamUrl3: "", 
                activeServer: 1
            }, { merge: true });
        });

        await batch.commit();
        console.log(`✅ Database Synced: ${matches.length} matches updated.`);
    } catch (err) { 
        console.error("Sync Error:", err.message); 
    }
}


// Add this to your server.js and push to GitHub
bot.onText(/\/list/, async (msg) => {
    const snapshot = await db.collection('matches').limit(10).get();
    let message = "📅 **Today's Match IDs:**\n\n";
    snapshot.forEach(doc => {
        const m = doc.data();
        message += `⚽ ${m.homeTeam.name} vs ${m.awayTeam.name}\n🆔 ID: \`${doc.id}\`\n\n`;
    });
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});


// --- TELEGRAM COMMANDS ---

// 1. Update Server 3 (Your "Gold" Link)
bot.onText(/\/gold (\d+) (.+)/, async (msg, match) => {
    const id = match[1];
    const url = match[2];
    try {
        await db.collection('matches').doc(id).update({ 
            streamUrl3: url, 
            status: 'LIVE',
            activeServer: 3 
        });
        bot.sendMessage(msg.chat.id, `🏆 GOLD LINK ACTIVE!\nMatch ID: ${id}\nServer 3 is now primary.`);
    } catch (e) { 
        bot.sendMessage(msg.chat.id, "❌ Match ID not found in database."); 
    }
});

// 2. Update Server 1 or 2
bot.onText(/\/stream(\d) (\d+) (.+)/, async (msg, match) => {
    const serverNum = match[1];
    const id = match[2];
    const url = match[3];
    const field = `streamUrl${serverNum}`;

    try {
        await db.collection('matches').doc(id).update({ [field]: url });
        bot.sendMessage(msg.chat.id, `✅ Server ${serverNum} updated for Match ${id}`);
    } catch (e) { 
        bot.sendMessage(msg.chat.id, "❌ Error updating server."); 
    }
});

// Run Sync daily at 6AM
cron.schedule('0 6 * * *', syncMatches);

// Manual trigger command
bot.onText(/\/sync/, (msg) => {
    bot.sendMessage(msg.chat.id, "🔄 Manual sync started...");
    syncMatches();
});

console.log("🚀 Vortex Manager Bot Online with Render Health Checks...");