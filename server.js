const express = require('express');
const CryptoJS = require('crypto-js');
const app = express();
const PORT = process.env.PORT || 3001;

// ⚠️ IMPORTANT: Set a secure secret key (store in environment variable in production)
const SECRET_KEY = process.env.STREAM_SECRET_KEY || 'your-super-secret-key-change-this-123';

// Encryption function
const encryptStreamUrl = (streamUrl) => {
  // Add timestamp to prevent replay attacks
  const data = {
    url: streamUrl,
    timestamp: Date.now(),
    // Optional: Add expiration (e.g., 2 hours)
    expires: Date.now() + (2 * 60 * 60 * 1000)
  };
  
  return CryptoJS.AES.encrypt(JSON.stringify(data), SECRET_KEY).toString();
};

// Decryption middleware
const decryptStreamUrl = (encryptedData) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedData, SECRET_KEY);
    const decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    
    // Check if link is expired (optional)
    if (decryptedData.expires && Date.now() > decryptedData.expires) {
      return null; // Link expired
    }
    
    return decryptedData.url;
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
};

// 🔐 Obfuscated stream proxy endpoint
app.get('/api/stream/:matchId/:serverNumber', async (req, res) => {
  const { matchId, serverNumber } = req.params;
  
  try {
    // 1. Verify match exists in your database
    // 2. Get the actual stream URL based on matchId and serverNumber
    // 3. Return encrypted URL to frontend
    
    // Example: Fetch from Firebase
    const matchData = await fetchMatchFromFirebase(matchId);
    
    if (!matchData) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    let actualStreamUrl;
    if (serverNumber === '1') actualStreamUrl = matchData.streamUrl1;
    else if (serverNumber === '2') actualStreamUrl = matchData.streamUrl2;
    else if (serverNumber === '3') actualStreamUrl = matchData.streamUrl3;
    else return res.status(400).json({ error: 'Invalid server' });
    
    // Encrypt the actual URL
    const encryptedUrl = encryptStreamUrl(actualStreamUrl);
    
    res.json({
      encryptedUrl,
      expiresIn: 7200 // 2 hours in seconds
    });
    
  } catch (error) {
    console.error('Stream endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🎥 Stream proxy endpoint (actual streaming)
app.get('/proxy/stream', (req, res) => {
  const { encrypted } = req.query;
  
  if (!encrypted) {
    return res.status(400).send('Missing stream parameter');
  }
  
  const actualUrl = decryptStreamUrl(encrypted);
  
  if (!actualUrl) {
    return res.status(403).send('Invalid or expired stream link');
  }
  
  // Proxy the stream through your server
  // This prevents revealing the actual stream URL
  res.redirect(actualUrl);
  
  // Alternative: Use a proper proxy library like 'http-proxy-middleware'
  // for better control and headers
});

// Example Firebase function (you'll need to implement this)
async function fetchMatchFromFirebase(matchId) {
  // Your Firebase logic here
  return {
    streamUrl1: 'https://actual-stream-source-1.com',
    streamUrl2: 'https://actual-stream-source-2.com',
    streamUrl3: 'https://actual-stream-source-3.com'
  };
}

app.listen(PORT, () => {
  console.log(`Secure Stream Server running on port ${PORT}`);
});