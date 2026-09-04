// Proxies Arcscan's (Blockscout-style) explorer API. Calling testnet.arcscan.app/api
// directly from the browser is unreliable — other Arc Testnet projects have hit the
// same CORS wall and solved it the same way: fetch server-side instead.
const ARCSCAN_ORIGIN = 'https://testnet.arcscan.app';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const query = req.query || {};
    const params = new URLSearchParams();
    for (const key of Object.keys(query)) {
      const value = query[key];
      if (Array.isArray(value)) {
        params.set(key, value[0]);
      } else if (value !== undefined) {
        params.set(key, value);
      }
    }

    const response = await fetch(`${ARCSCAN_ORIGIN}/api?${params.toString()}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
