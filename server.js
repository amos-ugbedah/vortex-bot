const express = require('express');
const CryptoJS = require('crypto-js');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3001;

// 1. INITIALIZE FIREBASE
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. CONFIGURATION
const SECRET_KEY = process.env.STREAM_SECRET_KEY || 'Vortex_Secure_2026';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const API_KEYS = [
  "3671908177msh066f984698c094ap1c8360jsndb2bc44e1c65",
  "0e3ac987340e582eb85a41758dc7c33a5dfcec72f940e836d960fe68a28fe904",
  "0e3ac987340e582eb85a41758dc7c33a5dfcec72f940e836d960fe68a28fe904"
];
let currentKeyIndex = 0;

const getActiveKey = () => {
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return API_KEYS[currentKeyIndex];
};

// --- ENCRYPTION LOGIC ---
const encryptStreamUrl = (url) => {
  if (!url) return null;
  const data = { url, expires: Date.now() + (2 * 60 * 60 * 1000) };
  return CryptoJS.AES.encrypt(JSON.stringify(data), SECRET_KEY).toString();
};

// --- TELEGRAM NOTIFIER ---
const sendTelegram = async (text) => {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHANNEL_ID,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    });
  } catch (err) { console.error("❌ Telegram Notify Error"); }
};

// --- SMART TRIPLE-STREAM RESOLVER ---
const resolveStream = (home, away, slot, existingUrl) => {
  // If you manually pasted a link in Firebase for this slot, keep it!
  if (existingUrl && existingUrl.includes('http')) return existingUrl;
  
  const query = encodeURIComponent(`${home} vs ${away} live stream`);
  
  // Provide different fallback search engines for each slot
  const fallbacks = {
    1: `https://www.google.com/search?q=${query}`,
    2: `https://www.bing.com/search?q=${query}`,
    3: `https://duckduckgo.com/?q=${query}`
  };
  
  return fallbacks[slot] || fallbacks[1];
};

// --- CORE SYNC & SORTING ---
const syncMatches = async () => {
  console.log(`🔄 Syncing Nigeria/WAT Schedule (Key #${currentKeyIndex + 1})...`);
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures', {
      params: { date: today }, 
      headers: { 
        'X-RapidAPI-Key': getActiveKey(), 
        'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com' 
      }
    });

    const allMatches = res.data.response || [];

    for (const item of allMatches) {
      const matchId = `match_${item.fixture.id}`;
      const matchRef = db.collection('matches').doc(matchId);
      const snap = await matchRef.get();
      
      let existingData = snap.exists ? snap.data() : {};

      const current = {
        id: matchId,
        homeTeam: item.teams.home.name,
        awayTeam: item.teams.away.name,
        homeLogo: item.teams.home.logo,
        awayLogo: item.teams.away.logo,
        homeScore: item.goals.home || 0,
        awayScore: item.goals.away || 0,
        status: item.fixture.status.short, 
        elapsed: item.fixture.status.elapsed || 0,
        timestamp: item.fixture.timestamp,
        // TRIPLE STREAM SLOTS
        streamUrl1: resolveStream(current.homeTeam, current.awayTeam, 1, existingData.streamUrl1),
        streamUrl2: resolveStream(current.homeTeam, current.awayTeam, 2, existingData.streamUrl2),
        streamUrl3: resolveStream(current.homeTeam, current.awayTeam, 3, existingData.streamUrl3),
        kickoffTime: new Date(item.fixture.date).toLocaleTimeString('en-GB', { 
          timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: true 
        })
      };

      if (snap.exists) {
        if (existingData.status === 'NS' && current.status === '1H') {
          await sendTelegram(`🏁 **KICK OFF!**\n\n**${current.homeTeam} vs ${current.awayTeam}** is now LIVE!\n\n👉 [WATCH NOW](https://vortexlive.online/match/${matchId})`);
        }
        if (current.homeScore > (existingData.homeScore || 0) || current.awayScore > (existingData.awayScore || 0)) {
          await sendTelegram(`⚽ **GOAL!!**\n\n**${current.homeTeam} ${current.homeScore} - ${current.awayScore} ${current.awayTeam}**\n⏱ ${current.elapsed}' mins\n\n👉 [WATCH LIVE](https://vortexlive.online/match/${matchId})\n🎁 Code: **VORTEXLIVE**`);
        }
      }

      await matchRef.set(current, { merge: true });
    }
    console.log(`✅ Successfully synced ${allMatches.length} matches.`);
  } catch (error) { console.error("❌ Global Sync Error:", error.message); }
};

setInterval(syncMatches, 60000);

// --- ENDPOINTS ---

app.get('/api/matches', async (req, res) => {
  try {
    const snapshot = await db.collection('matches').get();
    let matches = [];
    snapshot.forEach(doc => matches.push(doc.data()));

    matches.sort((a, b) => {
      const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P'];
      const isALive = liveStatuses.includes(a.status);
      const isBLive = liveStatuses.includes(b.status);
      if (isALive && !isBLive) return -1;
      if (!isALive && isBLive) return 1;
      return a.timestamp - b.timestamp;
    });

    res.json(matches);
  } catch (err) { res.status(500).json({ error: "DB Error" }); }
});

app.get('/api/stream/:matchId/:serverNum', async (req, res) => {
  const { matchId, serverNum } = req.params;
  try {
    const doc = await db.collection('matches').doc(matchId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Match not found' });

    const url = doc.data()[`streamUrl${serverNum}`];
    res.json({ encryptedUrl: encryptStreamUrl(url) });
  } catch (error) { res.status(500).json({ error: "Server Error" }); }
});

app.listen(PORT, () => {
  console.log(`🚀 Vortex Holistic Triple-Server Active on Port ${PORT}`);
  syncMatches();
});