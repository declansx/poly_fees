const express = require('express');
const path = require('path');

const app = express();
const PORT = 4000;

const DIR = '/Users/declan-workcomputer/Desktop/Devrel/sx_v_poly_fees';

// Serve static files
app.use(express.static(DIR));

// Explicit root
app.get('/', (req, res) => {
  res.sendFile(path.join(DIR, 'index.html'));
});

// Proxy endpoint — forwards requests to external APIs to avoid CORS
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

  // Only allow known API hosts
  const allowed = ['api.sx.bet', 'gamma-api.polymarket.com', 'clob.polymarket.com'];
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (!allowed.includes(parsed.hostname)) {
    return res.status(403).json({ error: 'Host not allowed' });
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: { 'Accept': 'application/json' },
    });
    const data = await resp.text();
    res.status(resp.status).set('Content-Type', 'application/json').send(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
