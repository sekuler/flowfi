const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const SWAP_CONTRACT = '0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1';
const ADMIN_WALLET_ADDRESS = '0x5e434b565c737ddf2a7a9392b29a329e08692241';

module.exports = async function handler(req, res) {
  // Vercel Cron sends a GET request with this header — reject anything else
  // so this endpoint can't be triggered by a random outside request.
  if (req.headers['x-vercel-cron'] !== '1' && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Fetch the live rate.
    const rateRes = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR');
    const rateData = await rateRes.json();
    const liveRate = rateData.rates?.EUR;

    if (!liveRate) {
      return res.status(502).json({ error: 'Could not fetch live rate.' });
    }

    const client = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });

    // 2. Find the Arc Testnet wallet for our admin address.
    const walletsResponse = await client.listWallets({ pageSize: 50 });
    const adminWallet = (walletsResponse.data?.wallets ?? []).find(
      (w) => w.address.toLowerCase() === ADMIN_WALLET_ADDRESS.toLowerCase() && w.blockchain === 'ARC-TESTNET'
    );

    if (!adminWallet) {
      return res.status(500).json({ error: 'Admin wallet not found on ARC-TESTNET.' });
    }

    // 3. Push the new rate on-chain.
    const newRateScaled = Math.round(liveRate * 1e6).toString();
    const txResponse = await client.createContractExecutionTransaction({
      walletId: adminWallet.id,
      contractAddress: SWAP_CONTRACT,
      abiFunctionSignature: 'setRate(uint256)',
      abiParameters: [newRateScaled],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    return res.status(200).json({
      success: true,
      rate: liveRate,
      transactionId: txResponse.data?.id,
      state: txResponse.data?.state,
    });
  } catch (error) {
    console.error('Rate update error:', error.message);
    return res.status(500).json({ error: error.message ?? 'Internal error' });
  }
};
