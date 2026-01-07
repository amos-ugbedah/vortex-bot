const express = require('express');
const CryptoJS = require('crypto-js');
const axios = require('axios');
const admin = require('firebase-admin');

// --- 1. CONFIGURATION & INITIALIZATION ---
const app = express();
const PORT = process.env.PORT || 3001;

// Use environment variables for security
const SECRET_KEY = process.env.STREAM_SECRET_KEY || 'Vortex_Secure_2026';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// API Keys - Rotating logic for load balancing
const API_KEYS = [
  "3671908177msh066f984698c094ap1c8360jsndb2bc44e1c65",
  "0e3ac987340e582eb85a41758dc7c33a5dfcec72f940e836d960fe68a28fe904",
  "0e3ac987340e582eb85a41758dc7c33a5dfcec72f940e836d960fe68a28fe904"
].map(k => k.trim());

let keyIndex = 0;
const getAuthHeaders = () => {
  keyIndex = (keyIndex + 1) % API_KEYS.length;
  return {
    'X-RapidAPI-Key': API_KEYS[keyIndex],
    'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
  };
};

// Initialize Firebase
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// --- 2. UTILITY FUNCTIONS ---

/**
 * Encrypts stream URLs to prevent scraping
 */
const encryptUrl = (url) => {
  if (!url) return null;
  const payload = JSON.stringify({ url, exp: Date.now() + (3 * 60 * 60 * 1000) });
  return CryptoJS.AES.encrypt(payload, SECRET_KEY).toString();
};

/**
 * Sends notifications to Telegram
 */
const notifyTelegram = async (message) => {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHANNEL_ID,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (err) { console.error("⚠️ Telegram failed"); }
};

/**
 * Generates dynamic stream links if no manual link is provided
 */
const getStreamFallback = (home, away, server) => {
  const query = encodeURIComponent(`${home} vs ${away} live stream free`);
  const sources = [
    `https://www.google.com/search?q=${query}`,
    `https://www.bing.com/search?q=${query}`,
    `https://duckduckgo.com/?q=${query}`
  ];
  return sources[server - 1] || sources[0];
};

// --- 3. CORE LOGIC (SYNC) ---

const syncMatches = async () => {
  console.log(`[${new Date().toLocaleTimeString()}] 🔄 Syncing matches...`);
  try {
    const today = new Date().toISOString().split('T')[0];
    const response = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures', {
      params: { date: today },
      headers: getAuthHeaders()
    });

    const fixtures = response.data.response || [];
    const batch = db.batch();

    for (const item of fixtures) {
      const id = `match_${item.fixture.id}`;
      const docRef = db.collection('matches').doc(id);
      const snap = await docRef.get();
      const existing = snap.exists ? snap.data() : {};

      const data = {
        id,
        home: { name: item.teams.home.name, logo: item.teams.home.logo, score: item.goals.home || 0 },
        away: { name: item.teams.away.name, logo: item.teams.away.logo, score: item.goals.away || 0 },
        status: item.fixture.status.short,
        minute: item.fixture.status.elapsed || 0,
        timestamp: item.fixture.timestamp,
        kickoff: new Date(item.fixture.date).toLocaleTimeString('en-GB', { 
          timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' 
        }),
        // Maintain manual links or use smart fallbacks
        stream1: existing.stream1 || getStreamFallback(item.teams.home.name, item.teams.away.name, 1),
        stream2: existing.stream2 || getStreamFallback(item.teams.home.name, item.teams.away.name, 2),
        stream3: existing.stream3 || getStreamFallback(item.teams.home.name, item.teams.away.name, 3)
      };

      // Smart Alerts
      if (snap.exists) {
        if (existing.status === 'NS' && data.status === '1H') {
          await notifyTelegram(`🎬 **LIVE NOW**\n⚽ ${data.home.name} vs ${data.away.name}\n🔗 [Watch Here](https://vortexlive.online/match/${id})`);
        }
        if (data.home.score > existing.home.score || data.away.score > existing.away.score) {
          await notifyTelegram(`⚽ **GOAL ALERT!**\n🏆 ${data.home.name} ${data.home.score} - ${data.away.score} ${data.away.name}\n⏱️ ${data.minute}'`);
        }
      }

      batch.set(docRef, data, { merge: true });
    }

    await batch.commit();
    console.log(`✅ Successfully updated ${fixtures.length} fixtures.`);
  } catch (err) {
    console.error("❌ Sync failed:", err.response?.data || err.message);
  }
};

// Sync every 60 seconds
setInterval(syncMatches, 60000);

// --- 4. API ENDPOINTS ---

/**
 * Get all matches sorted by "Live" status and then Time
 */
app.get('/api/matches', async (req, res) => {
  try {
    const snap = await db.collection('matches').get();
    const matches = snap.docs.map(doc => doc.data());

    matches.sort((a, b) => {
      const live = ['1H', '2H', 'HT', 'ET', 'P'];
      const aLive = live.includes(a.status) ? 0 : 1;
      const bLive = live.includes(b.status) ? 0 : 1;
      return aLive - bLive || a.timestamp - b.timestamp;
    });

    res.json(matches);
  } catch (err) { res.status(500).send("Database Error"); }
});

/**
 * Get encrypted stream link for a specific server
 */
app.get('/api/stream/:matchId/:server', async (req, res) => {
  try {
    const doc = await db.collection('matches').doc(req.params.matchId).get();
    if (!doc.exists) return res.status(404).send("Not found");
    
    const url = doc.data()[`stream${req.params.server}`];
    res.json({ token: encryptUrl(url) });
  } catch (err) { res.status(500).send("Encryption Error"); }
});

app.listen(PORT, () => {
  console.log(`🚀 Vortex Pro-Server running on port ${PORT}`);
  syncMatches();
});