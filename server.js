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
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// List of "Important" League IDs (Premier League, UCL, La Liga, Serie A, Bundesliga, Ligue 1, etc.)
const TOP_LEAGUES = [39, 140, 135, 78, 61, 2, 3, 848, 143]; 

// --- 3. SMART SYNC FUNCTION ---
async function syncMatches(chatId = null) {
    try {
        if (chatId) bot.sendMessage(chatId, "⚽ Fetching top 40 important matches...");
        
        const res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            params: { 
                date: new Date().toISOString().split('T')[0],
                status: 'NS-1H-HT-2H-LIVE' 
            }, 
            headers: { 'x-apisports-key': KEY_API_SPORTS }
        });

        let matches = res.data.response;
        if (!matches || matches.length === 0) {
            if (chatId) bot.sendMessage(chatId, "⚠️ No matches found for today.");
            return;
        }

        // FILTER: Only keep matches from Top Leagues OR matches involving major teams
        // SORT: Move matches from Top Leagues to the top of the list
        matches = matches.filter(m => TOP_LEAGUES.includes(m.league.id))
                         .slice(0, 40); // Limit to top 40 for performance and clarity

        const batch = db.batch();
        matches.forEach(m => {
            const docRef = db.collection('matches').doc(String(m.fixture.id));
            batch.set(docRef, {
                fixtureId: m.fixture.id,
                homeTeam: { name: m.teams.home.name, logo: m.teams.home.logo },
                awayTeam: { name: m.teams.away.name, logo: m.teams.away.logo },
                status: m.fixture.status.short,
                league: m.league.name,
                leagueId: m.league.id,
                kickOffTime: m.fixture.date,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                streamUrl1: "", 
                streamUrl2: "", 
                streamUrl3: "", 
                activeServer: 1
            }, { merge: true });
        });

        await batch.commit();
        const successMsg = `✅ Sync Complete! ${matches.length} top-tier matches added to website.`;
        console.log(successMsg);
        if (chatId) bot.sendMessage(chatId, successMsg);

    } catch (err) { 
        console.error("Sync Error:", err.message); 
        if (chatId) bot.sendMessage(chatId, "❌ Sync failed: " + err.message);
    }
}

// --- 4. TELEGRAM COMMANDS ---

// List IDs (Crucial for managing links)
bot.onText(/\/list/, async (msg) => {
    try {
        const snapshot = await db.collection('matches').orderBy('kickOffTime', 'asc').limit(20).get();
        if (snapshot.empty) return bot.sendMessage(msg.chat.id, "📭 No matches in database. Run /sync first.");

        let message = "📅 **Match IDs (Next 20 Games):**\n\n";
        snapshot.forEach(doc => {
            const m = doc.data();
            const time = new Date(m.kickOffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            message += `⏰ ${time} | ${m.homeTeam.name} vs ${m.awayTeam.name}\n🆔 ID: \`${doc.id}\`\n\n`;
        });
        bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(msg.chat.id, "❌ Error fetching list.");
    }
});

// Update Gold Server (Server 3)
bot.onText(/\/gold (\d+) (.+)/, async (msg, match) => {
    const id = match[1];
    const url = match[2];
    try {
        await db.collection('matches').doc(id).update({ 
            streamUrl3: url, 
            status: 'LIVE',
            activeServer: 3 
        });
        bot.sendMessage(msg.chat.id, `🏆 **GOLD LINK ACTIVE**\nMatch: ${id}\nServer 3 is now primary.`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Match ID not found."); }
});

// Update Server 1 or 2
bot.onText(/\/stream(\d) (\d+) (.+)/, async (msg, match) => {
    const serverNum = match[1];
    const id = match[2];
    const url = match[3];
    try {
        await db.collection('matches').doc(id).update({ [`streamUrl${serverNum}`]: url });
        bot.sendMessage(msg.chat.id, `✅ Server ${serverNum} updated for ID ${id}`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Update failed."); }
});

// Sync Command
bot.onText(/\/sync/, (msg) => syncMatches(msg.chat.id));

// Auto-run sync daily at 6AM
cron.schedule('0 6 * * *', () => syncMatches());

console.log("🚀 Vortex Manager Bot Online (Top 40 Mode)...");