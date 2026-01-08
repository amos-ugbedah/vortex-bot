const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cron = require('node-cron'); // Ensure you run: npm install node-cron

const app = express();
const PORT = process.env.PORT || 3001;

// 1. INITIALIZATION
const serviceAccount = require('./serviceAccountKey.json');
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// 2. CONFIGURATION (Direct API-Sports)
const APISPORTS_KEY = "0131b99f8e87a724c92f8b455cc6781d";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // Set in Render
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHANNEL_ID; // Set in Render

// --- UTILITY: TELEGRAM SENDER ---
const sendTelegram = async (message) => {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error("❌ Telegram Notify Failed"); }
};

// --- CORE ENGINE: SYNC MATCHES ---
const syncMatches = async (isMorningUpdate = false) => {
    const today = new Date().toISOString().split('T')[0];
    const logTime = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos' });
    
    console.log(`[${logTime} WAT] 🔄 Fetching Live Data...`);

    try {
        const res = await axios.get('https://v3.football.api-sports.io/fixtures', {
            params: { date: today },
            headers: {
                'x-apisports-key': APISPORTS_KEY,
                'x-apisports-host': 'v3.football.api-sports.io'
            }
        });

        const matches = res.data.response || [];
        if (matches.length === 0) return;

        const batch = db.batch();
        let morningSchedule = `📅 *TODAY'S FIXTURES (${today})*\n\n`;

        for (const item of matches) {
            const id = `match_${item.fixture.id}`;
            const docRef = db.collection('matches').doc(id);
            const snap = await docRef.get();
            const old = snap.exists ? snap.data() : {};

            const current = {
                id,
                home: { name: item.teams.home.name, logo: item.teams.home.logo, score: item.goals.home || 0 },
                away: { name: item.teams.away.name, logo: item.teams.away.logo, score: item.goals.away || 0 },
                status: item.fixture.status.short, // NS, 1H, HT, 2H, FT
                minute: item.fixture.status.elapsed || 0,
                kickoff: new Date(item.fixture.date).toLocaleTimeString('en-GB', { 
                    timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' 
                }),
                stream1: `https://www.google.com/search?q=${encodeURIComponent(item.teams.home.name + " vs " + item.teams.away.name + " live stream free")}`
            };

            // 1. LIVE GOAL ALERTS (Check if score changed)
            if (snap.exists && current.status !== 'NS') {
                if (current.home.score > old.home.score || current.away.score > old.away.score) {
                    await sendTelegram(`⚽ *GOAL ALERT!!*\n\n${current.home.name} ${current.home.score} - ${current.away.score} ${current.away.name}\n⏱ Minute: ${current.minute}'`);
                }
            }

            // 2. BUILD MORNING LIST
            if (isMorningUpdate) {
                morningSchedule += `⏰ ${current.kickoff} | ${current.home.name} vs ${current.away.name}\n`;
            }

            batch.set(docRef, current, { merge: true });
        }

        await batch.commit();
        console.log(`✅ Database Updated: ${matches.length} matches.`);

        if (isMorningUpdate) {
            await sendTelegram(morningSchedule + `\n🔗 Watch Live: https://vortexlive.online`);
        }

    } catch (err) {
        console.error("❌ Sync Error:", err.message);
    }
};

// --- AUTOMATION SCHEDULES ---

// A. Every 2 Minutes: Update Scores & Check for Goals
setInterval(() => syncMatches(false), 120000);

// B. Every Morning at 7:30 AM WAT: Post Full Schedule to Telegram
// '30 7 * * *' = 07:30 AM
cron.schedule('30 7 * * *', () => {
    syncMatches(true);
}, {
    scheduled: true,
    timezone: "Africa/Lagos"
});

// --- API ENDPOINTS ---
app.get('/api/matches', async (req, res) => {
    const snap = await db.collection('matches').get();
    let list = snap.docs.map(doc => doc.data());
    // Sort: Live matches first, then by kickoff time
    list.sort((a, b) => {
        const live = ['1H','2H','HT','ET','P'];
        const aL = live.includes(a.status) ? 0 : 1;
        const bL = live.includes(b.status) ? 0 : 1;
        return aL - bL;
    });
    res.json(list);
});

app.listen(PORT, () => {
    console.log(`🚀 Vortex Pro-Server Active (Lagos Time)`);
    syncMatches(false); // Run once on startup
});