const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const { createPublicClient, http } = require('viem');

const SWAP_CONTRACT = '0x3CD201DA3DdDF2d0E9fcBC606a32E821099dEAC1'; // ArcSwap v5
const ADMIN_WALLET_ADDRESS = '0x5e434b565c737ddf2a7a9392b29a329e08692241';
const ARC_TESTNET = { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } };

const RATE_ABI = [
  { type: 'function', name: 'usdcToEurcRate', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
];

module.exports = async function handler(req, res) {
  // Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on every
  // real cron invocation, once CRON_SECRET is set as an env var — this is
  // the actual documented verification mechanism. (The previous check here
  // looked for an `x-vercel-cron` header instead, which isn't it — that
  // check would never reliably confirm a request came from Vercel's
  // scheduler.) CRON_SECRET must be added in Vercel's project settings
  // (Environment Variables) for this check to do anything; Vercel does not
  // generate it automatically.
  const authHeader = req.headers['authorization'];
  if (process.env.NODE_ENV === 'production' && (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`)) {
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

    const desiredRateScaled = BigInt(Math.round(liveRate * 1e6));

    // v5's setRate() caps any single call to a 10% move from the current
    // on-chain rate (a security fix — previously one call could set an
    // absurd rate with no limit at all). Read the current rate and clamp
    // the target so this call can never revert on that cap. If the real
    // rate ever drifts more than 10% between cron runs, this closes the
    // gap by 10% per run rather than failing outright — it'll fully catch
    // up over a few runs instead of jumping there in one.
    const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http() });
    const currentRateScaled = await publicClient.readContract({
      address: SWAP_CONTRACT, abi: RATE_ABI, functionName: 'usdcToEurcRate',
    });

    const maxDelta = (currentRateScaled * 1000n) / 10000n; // 10%, in basis points
    let newRateScaled = desiredRateScaled;
    if (newRateScaled > currentRateScaled + maxDelta) newRateScaled = currentRateScaled + maxDelta;
    if (newRateScaled < currentRateScaled - maxDelta) newRateScaled = currentRateScaled - maxDelta;

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

    // 3. Push the (possibly clamped) new rate on-chain.
    const txResponse = await client.createContractExecutionTransaction({
      walletId: adminWallet.id,
      contractAddress: SWAP_CONTRACT,
      abiFunctionSignature: 'setRate(uint256)',
      abiParameters: [newRateScaled.toString()],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    return res.status(200).json({
      success: true,
      liveRate,
      appliedRateScaled: newRateScaled.toString(),
      clamped: newRateScaled !== desiredRateScaled,
      transactionId: txResponse.data?.id,
      state: txResponse.data?.state,
    });
  } catch (error) {
    console.error('Rate update error:', error.message);
    return res.status(500).json({ error: error.message ?? 'Internal error' });
  }
};
