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

// 2. CONFIGURATION
const BOT_TOKEN = "8126112394:AAH7-da80z0C7tLco-ZBoZryH_6hhZBKfhE";
const CHAT_ID = "@LivefootballVortex"; 
const SITE_URL = "https://vortexlive.online";
const GROUP_LINK = "https://t.me/+ZAygoaZr9VA2NGE0";

let lastKnownData = {}; 

// --- 3. NOTIFICATION HELPERS ---

async function sendTelegram(text) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });
    const res = await response.json();
    if (res.ok) console.log("✅ Telegram Sent");
    else console.log("⚠️ TG Error:", res.description);
  } catch (err) {
    console.error("❌ TG Connection Error:", err.message);
  }
}

// --- 4. REAL-TIME WATCHER (FIXED RESTART LOOP) ---

function startListening() {
  console.log("📡 Vortex Brain: Connecting to Firebase...");

  // Attach the snapshot listener
  const unsub = db.collection('fixtures').onSnapshot((snapshot) => {
    // If we reach here, connection is successful
    console.log(`🟢 Live: Monitoring ${snapshot.size} matches.`);

    snapshot.docChanges().forEach((change) => {
      const data = change.doc.data();
      const matchId = change.doc.id;
      
      const currentScore = `${data.homeScore || 0}-${data.awayScore || 0}`;
      const currentStatus = (data.status || 'NS').toUpperCase();
      
      const scoreKey = `${matchId}_score`;
      const statusKey = `${matchId}_status`;

      // 1. First time seeing the match? Store and move on.
      if (lastKnownData[statusKey] === undefined) {
        lastKnownData[scoreKey] = currentScore;
        lastKnownData[statusKey] = currentStatus;
        return;
      }

      // 2. GOAL OR VAR ALERT (Works for both +1 and -1)
      if (lastKnownData[scoreKey] !== currentScore) {
        const [oldH, oldA] = lastKnownData[scoreKey].split('-').map(Number);
        const isVAR = (data.homeScore < oldH || data.awayScore < oldA);
        
        const header = isVAR ? "🖥 *VAR: GOAL CANCELLED*" : "⚽ *GOAL ALERT!*";
        sendTelegram(`${header}\n\n🏆 ${data.league}\n🔥 *${data.home} ${data.homeScore} - ${data.awayScore} ${data.away}*\n\n🔗 [WATCH LIVE](${SITE_URL})`);
      }

      // 3. STATUS ALERT
      if (lastKnownData[statusKey] !== currentStatus) {
        let msg = "";
        if (currentStatus === '1H' || currentStatus === 'LIVE') {
          msg = `🎬 *KICK OFF!* \n\n*${data.home} vs ${data.away}* is LIVE!`;
        } else if (currentStatus === 'HT') {
          msg = `⏸ *HALF TIME* \n\n*${data.home} ${currentScore} ${data.away}*`;
        } else if (currentStatus === '2H') {
          msg = `▶️ *SECOND HALF* \n\n*${data.home} vs ${data.away}* is back underway!`;
        } else if (currentStatus === 'FT') {
          msg = `🏁 *FULL TIME* \n\n*${data.home} ${currentScore} ${data.away}*\n\n💬 [JOIN DISCUSSION](${GROUP_LINK})`;
        }
        
        if (msg) sendTelegram(`${msg}\n👉 [WATCH](${SITE_URL})`);
      }

      // Update memory
      lastKnownData[scoreKey] = currentScore;
      lastKnownData[statusKey] = currentStatus;
    });
  }, (err) => {
    // CRITICAL: Stop the crash loop by logging the actual error
    console.error("❌ FIREBASE ERROR:", err.code, "-", err.message);
    
    // If it's a permission issue, don't restart too fast
    const delay = err.code === 'permission-denied' ? 30000 : 5000;
    console.log(`🔄 Restarting in ${delay/1000}s...`);
    
    unsub(); 
    setTimeout(startListening, delay);
  });
}

// Initial Bot Start Message
startListening();
sendTelegram(`🤖 *Vortex Live Bot:* System Online 🌍`);