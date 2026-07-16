export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch('https://api.circle.com/v1/stablecoinKits/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-agent': req.headers['x-user-agent'] || 'arc-defi-app',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
} 
