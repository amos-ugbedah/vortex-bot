const admin = require('firebase-admin');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const serviceAccount = require("./serviceAccountKey.json");

// 1. INITIALIZE FIREBASE
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// 2. CONFIGURATION
const BOT_TOKEN = "8126112394:AAH7-da80z0C7tLco-ZBoZryH_6hhZBKfhE";
const CHAT_ID = "-1003687297299";
const SITE_URL = "https://vortexlive.online";

// API KEYS (Ensure these are valid)
const KEY_API_SPORTS = '0131b99f8e87a724c92f8b455cc6781d'; 

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- SYNC FUNCTION: Daily Match Creation ---
async function syncMatches() {
    try {
        const res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            params: { date: new Date().toISOString().split('T')[0] }, // Get today's matches
            headers: { 'x-apisports-key': KEY_API_SPORTS }
        });

        const matches = res.data.response;
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
                // Default slots for Triple Servers
                streamUrl1: "", 
                streamUrl2: "", 
                streamUrl3: "", 
                activeServer: 1
            }, { merge: true });
        });

        await batch.commit();
        console.log(`✅ Database Synced: ${matches.length} matches added.`);
    } catch (err) { console.error("Sync Error:", err.message); }
}

// --- COMMANDS FOR MANUAL UPDATES (Your Phone) ---

// 1. Update Server 3 (Your "Gold" Link)
// Usage: /gold [fixtureId] [url]
bot.onText(/\/gold (\d+) (.+)/, async (msg, match) => {
    const id = match[1];
    const url = match[2];
    try {
        await db.collection('matches').doc(id).update({ 
            streamUrl3: url, 
            status: 'LIVE',
            activeServer: 3 
        });
        bot.sendMessage(msg.chat.id, `🏆 GOLD LINK ACTIVE!\nMatch: ${id}\nServer 3 is now primary.`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Match ID not found."); }
});

// 2. Update Server 1 or 2
// Usage: /stream1 [fixtureId] [url]
bot.onText(/\/stream(\d) (\d+) (.+)/, async (msg, match) => {
    const serverNum = match[1];
    const id = match[2];
    const url = match[3];
    const field = `streamUrl${serverNum}`;

    try {
        await db.collection('matches').doc(id).update({ [field]: url });
        bot.sendMessage(msg.chat.id, `✅ Server ${serverNum} updated for Match ${id}`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Error updating server."); }
});

// Run Sync daily at 6AM
cron.schedule('0 6 * * *', syncMatches);

console.log("🚀 Vortex Manager Bot Online...");