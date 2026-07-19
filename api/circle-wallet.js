import pkg from '@circle-fin/developer-controlled-wallets';
const { initiateDeveloperControlledWalletsClient } = pkg;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Step 1: Checking env vars');
    console.log('Has API key:', !!process.env.CIRCLE_API_KEY);
    console.log('Has entity secret:', !!process.env.CIRCLE_ENTITY_SECRET);

    const client = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });
    console.log('Step 2: Client initialized');

    const { action } = req.body;
    console.log('Step 3: Action is', action);

    if (action === 'create') {
      console.log('Step 4: Creating wallet set');
      const walletSetResponse = await client.createWalletSet({
        name: 'FlowFi WalletSet ' + Date.now(),
      });
      console.log('Step 5: Wallet set created', JSON.stringify(walletSetResponse.data));
      const walletSetId = walletSetResponse.data?.walletSet?.id;

      console.log('Step 6: Creating wallet with walletSetId', walletSetId);
      const walletsResponse = await client.createWallets({
        blockchains: ['ARC-TESTNET'],
        count: 1,
        walletSetId,
      });
      console.log('Step 7: Wallets created', JSON.stringify(walletsResponse.data));

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
    console.error('CAUGHT ERROR:', error.message);
    console.error('ERROR STACK:', error.stack);
    return res.status(500).json({ error: error.message ?? 'Internal error' });
  }
}