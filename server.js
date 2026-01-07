const admin = require('firebase-admin');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const express = require('express');

// --- RENDER HEALTH CHECK SERVER ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Vortex Bot Status: Active'));
app.listen(PORT, () => console.log(`✅ Health check on port ${PORT}`));

// --- 1. INITIALIZE FIREBASE ---
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log("✅ Firebase Admin Initialized");
    } catch (error) {
        console.error("❌ Firebase Init Error:", error.message);
    }
}
const db = admin.firestore();

// --- 2. CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN || "8126112394:AAH7-da80z0C7tLco-ZBoZryH_6hhZBKfhE";
const KEY_API_SPORTS = process.env.KEY_API_SPORTS || '0131b99f8e87a724c92f8b455cc6781d'; 
const CHANNEL_ID = "-1003687297299"; // Your Telegram Channel ID

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/**
 * PRIORITY LEAGUE IDS:
 * 1: AFCON, 2: UCL, 3: Europa League, 39: Premier League, 45: FA Cup, 
 * 140: La Liga, 135: Serie A, 78: Bundesliga, 61: Ligue 1
 */
const PRIORITY_LEAGUES = [1, 2, 3, 39, 45, 140, 135, 78, 61, 848];

// --- 3. SMART SYNC FUNCTION ---
async function syncMatches(chatId = null) {
    try {
        if (chatId) bot.sendMessage(chatId, "⚽ Syncing Top Matches (AFCON, FA Cup, Big Leagues)...");
        
        const today = new Date().toISOString().split('T')[0];
        const res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            params: { date: today }, 
            headers: { 'x-apisports-key': KEY_API_SPORTS }
        });

        let allMatches = res.data.response;
        if (!allMatches || allMatches.length === 0) {
            if (chatId) bot.sendMessage(chatId, "⚠️ No matches found for today.");
            return;
        }

        // FILTER: Keep only matches from Priority Leagues
        // SORT: Order by Kickoff Time
        let filteredMatches = allMatches
            .filter(m => PRIORITY_LEAGUES.includes(m.league.id))
            .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
            .slice(0, 40);

        if (filteredMatches.length === 0) {
            if (chatId) bot.sendMessage(chatId, "⚠️ No priority matches found today. Website list remains unchanged.");
            return;
        }

        const batch = db.batch();
        let channelText = `📅 *TODAY'S TOP FIXTURES* (${today})\n\n`;

        filteredMatches.forEach(m => {
            const matchId = String(m.fixture.id);
            const kickOffTime = new Date(m.fixture.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const docRef = db.collection('matches').doc(matchId);
            batch.set(docRef, {
                fixtureId: m.fixture.id,
                homeTeam: { name: m.teams.home.name, logo: m.teams.home.logo },
                awayTeam: { name: m.teams.away.name, logo: m.teams.away.logo },
                status: m.fixture.status.short,
                league: m.league.name,
                kickOffTime: m.fixture.date, // This sends the full ISO string for the website
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                streamUrl1: "", 
                streamUrl2: "", 
                streamUrl3: "", 
                activeServer: 1
            }, { merge: true });

            channelText += `⏰ ${kickOffTime} | ${m.teams.home.name} vs ${m.teams.away.name}\n`;
            channelText += `🆔 Match ID: \`${matchId}\`\n🔗 Watch: vortexlive.online\n\n`;
        });

        await batch.commit();

        // Auto-Post to Channel
        await bot.sendMessage(CHANNEL_ID, channelText, { parse_mode: 'Markdown' });

        const successMsg = `✅ Sync Complete! ${filteredMatches.length} matches updated and posted to Channel.`;
        if (chatId) bot.sendMessage(chatId, successMsg);

    } catch (err) { 
        console.error("Sync Error:", err.message); 
        if (chatId) bot.sendMessage(chatId, "❌ Sync failed: " + err.message);
    }
}

// --- 4. TELEGRAM COMMANDS ---

// List IDs (Next 20 Games)
bot.onText(/\/list/, async (msg) => {
    try {
        const snapshot = await db.collection('matches').orderBy('kickOffTime', 'asc').limit(20).get();
        if (snapshot.empty) return bot.sendMessage(msg.chat.id, "📭 No matches found. Run /sync first.");

        let message = "📅 **Active Match IDs:**\n\n";
        snapshot.forEach(doc => {
            const m = doc.data();
            const time = new Date(m.kickOffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            message += `⚽ ${m.homeTeam.name} vs ${m.awayTeam.name}\n🆔 ID: \`${doc.id}\` | ⏰ ${time}\n\n`;
        });
        bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Error fetching list."); }
});

// Update Link & Make Button Clickable
bot.onText(/\/stream(\d) (\d+) (.+)/, async (msg, match) => {
    const serverNum = match[1];
    const id = match[2];
    const url = match[3];
    try {
        await db.collection('matches').doc(id).update({ 
            [`streamUrl${serverNum}`]: url,
            status: 'LIVE' // Sets status to LIVE to ensure button shows up
        });
        bot.sendMessage(msg.chat.id, `✅ Server ${serverNum} Link Added!\nMatch ${id} is now clickable on the site.`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Error: ID not found."); }
});

bot.onText(/\/sync/, (msg) => syncMatches(msg.chat.id));

// Auto-run at 6AM daily
cron.schedule('0 6 * * *', () => syncMatches());

console.log("🚀 Vortex Elite Bot Online...");

// Add this temporary command to clear the junk
bot.onText(/\/clearall/, async (msg) => {
    try {
        bot.sendMessage(msg.chat.id, "🧹 Cleaning up matches... please wait.");
        
        const snapshot = await db.collection('matches').get();
        if (snapshot.empty) {
            return bot.sendMessage(msg.chat.id, "✅ Database is already empty.");
        }

        const batch = db.batch();
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        bot.sendMessage(msg.chat.id, `🗑️ Deleted ${snapshot.size} matches. Your database is now fresh!`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, "❌ Error during cleanup: " + e.message);
    }
});