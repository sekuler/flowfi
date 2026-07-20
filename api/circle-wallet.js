console.log('API_KEY length:', (process.env.CIRCLE_API_KEY || '').length);
console.log('ENTITY_SECRET length:', (process.env.CIRCLE_ENTITY_SECRET || '').length);
console.log('ENTITY_SECRET first/last chars:', JSON.stringify((process.env.CIRCLE_ENTITY_SECRET || '').slice(0,3)), JSON.stringify((process.env.CIRCLE_ENTITY_SECRET || '').slice(-3)));

const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });

    const { action } = req.body;

    if (action === 'create') {
      const walletSetResponse = await client.createWalletSet({
        name: 'FlowFi WalletSet ' + Date.now(),
      });
      const walletSetId = walletSetResponse.data?.walletSet?.id;

      const walletsResponse = await client.createWallets({
        blockchains: ['ARC-TESTNET'],
        count: 1,
        walletSetId,
      });

      const wallet = walletsResponse.data?.wallets?.[0];
      return res.status(200).json({
        success: true,
        walletId: wallet?.id,
        address: wallet?.address,
        blockchain: wallet?.blockchain,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Circle wallet error:', error.message);
    return res.status(500).json({ error: error.message ?? 'Internal error' });
  }
};