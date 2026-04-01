const allowed = ['api.sx.bet', 'gamma-api.polymarket.com', 'clob.polymarket.com'];

module.exports = async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

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
};
