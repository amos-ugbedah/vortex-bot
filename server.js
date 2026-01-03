const admin = require('firebase-admin');
const fetch = require('node-fetch');
const cron = require('node-cron');
const OneSignal = require('onesignal-node');

// 1. DATABASE CONFIGURATION
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// 2. CONFIGURATION
const BOT_TOKEN = "8126112394:AAH7-da80z0C7tLco-ZBoZryH_6hhZBKfhE";
const CHAT_ID = "@LivefootballVortex"; 
const SITE_URL = "https://vortexlive.online";
const GROUP_LINK = "https://t.me/+ZAygoaZr9VA2NGE0";

const pushClient = new OneSignal.Client(
  "83500a13-673b-486c-8d52-41e1b16d01a5", 
  "os_v2_app_qniaue3hhnegzdksihq3c3ibuvycu6iikawe5pv4vnrhcvj57uicm5t4254eshiwukdbzast6b6ekcnh6woskgovlchrq7gvtnrydhi"
);

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
    console.error("❌ Connection Error:", err);
  }
}

async function sendWebPush(title, message) {
  try {
    await pushClient.createNotification({
      contents: { 'en': message },
      headings: { 'en': title },
      included_segments: ['Subscribed Users'],
      url: SITE_URL
    });
  } catch (e) { console.error("❌ Push Error"); }
}

// --- 4. REAL-TIME WATCHER ---

db.collection('fixtures').onSnapshot((snapshot) => {
  snapshot.docChanges().forEach((change) => {
    const data = change.doc.data();
    const matchId = change.doc.id;
    const scoreKey = `${matchId}_score`;
    const statusKey = `${matchId}_status`;
    const currentScore = `${data.homeScore || 0}-${data.awayScore || 0}`;
    const currentStatus = data.status;

    if (!lastKnownData[statusKey]) {
      lastKnownData[scoreKey] = currentScore;
      lastKnownData[statusKey] = currentStatus;
      return;
    }

    // A. GOAL DETECTION
    if (lastKnownData[scoreKey] !== currentScore) {
      const msg = `⚽ *GOAL ALERT!* \n\n🏆 ${data.league}\n🔥 *${data.home} ${data.homeScore} - ${data.awayScore} ${data.away}*\n\n🔗 [WATCH LIVE](${SITE_URL})`;
      sendTelegram(msg);
      sendWebPush("⚽ GOAL!", `${data.home} ${currentScore} ${data.away}`);
    }

    // B. STATUS DETECTION
    if (lastKnownData[statusKey] !== currentStatus) {
      let statusUpdate = "";
      if (currentStatus === '1H' || currentStatus === 'LIVE') {
        statusUpdate = `🎬 *KICK OFF!* \n\n*${data.home} vs ${data.away}* is LIVE!`;
      } else if (currentStatus === 'HT') {
        statusUpdate = `⏸ *HALF TIME* \n\n*${data.home} ${currentScore} ${data.away}*`;
      } else if (currentStatus === '2H') {
        statusUpdate = `▶️ *SECOND HALF* \n\n*${data.home} vs ${data.away}* is back!`;
      } else if (currentStatus === 'FT') {
        statusUpdate = `🏁 *FULL TIME* \n\n*${data.home} ${currentScore} ${data.away}*\n\n💬 [JOIN DISCUSSION](${GROUP_LINK})`;
      }

      if (statusUpdate) {
        sendTelegram(`${statusUpdate}\n👉 [WATCH](${SITE_URL})`);
      }
    }

    lastKnownData[scoreKey] = currentScore;
    lastKnownData[statusKey] = currentStatus;
  });
});

// STARTUP TEST
sendTelegram(`🤖 *Vortex Live Bot:* Connected to ${SITE_URL}`);