const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

const BRIDGE_CHAINS = ['ARC-TESTNET', 'ETH-SEPOLIA', 'BASE-SEPOLIA', 'ARB-SEPOLIA'];

// Every contract + function FlowFi's Circle Wallet integration is ever
// meant to call, checked before any contractCall is forwarded to Circle.
// This is stricter than an address-only allowlist: a leaked/enumerated
// walletId still can't be used to call an unexpected function on an
// otherwise-trusted contract (e.g. transfer() on a token where only
// approve() should ever be reachable through this endpoint). Audited
// against every circleContractCallAndWait(...) call site in src/ — this
// list is exactly what's reachable today, nothing more.
// Addresses are compared case-insensitively; keys stored lowercase.
const ALLOWED_CALLS = new Map([
  // USDC, per chain — approve() feeds the pool/bridge/gateway contracts
  // below, transfer() is used by SendForm for direct sends.
  ['0x3600000000000000000000000000000000000000', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])], // Arc Testnet USDC
  ['0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])], // Ethereum Sepolia USDC
  ['0x036cbd53842c5426634e7929541ec2318f3dcf7e', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])], // Base Sepolia USDC
  ['0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])], // Arbitrum Sepolia USDC
  // EURC (Arc)
  ['0x89b50855aa3be2f677cd6303cec089b5f319d72a', new Set(['approve(address,uint256)', 'transfer(address,uint256)'])],
  // ArcFactoryV2 v4c pool (USDC/EURC) — the only pool SwapForm's Circle
  // Wallet path actually calls (contractAddress: POOL_ADDRESS). If a new
  // curated pool goes live, its address needs adding here too, or Circle
  // Wallet swaps against it will 403.
  ['0x3f0b83e551e272181e2a42144bb07e68d14bd497', new Set(['swap(bool,uint256,uint256,uint256)'])],
  // Circle CCTP V2 (same address on every supported chain)
  ['0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', new Set(['depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)'])], // TokenMessengerV2
  ['0xe737e5cebeeba77efe34d4aa090756590b1ce275', new Set(['receiveMessage(bytes,bytes)'])], // MessageTransmitterV2
  // Circle Gateway (same address on every supported chain)
  ['0x0077777d7eba4688bdef3e311b846f25870a19b9', new Set(['deposit(address,uint256)'])], // Gateway Wallet
  ['0x0022222abe238cc2c7bb1f21003f0a260052475b', new Set(['gatewayMint(bytes,bytes)'])], // Gateway Minter
  // NOTE: the old Token Factory (0x481E8919...) is intentionally not
  // listed — TokenLaunch.tsx only ever executes via a connected browser
  // wallet (viem's custom(provider) transport), never through Circle
  // Wallet, so it was never actually reachable through this endpoint.
  // ArcSwap v5, ArcFactoryV2 v2/v3, and ArcEscrow v4 are likewise not
  // listed for the same reason: nothing in src/ calls them through
  // circleContractCallAndWait today. Add an entry here (with the exact
  // function signature) the day something actually needs to.
]);

// Wallet-set creation is meant to happen once per real user. A per-IP
// limit here isn't identity — it's just a brake on scripted spam (each
// call creates a real Circle wallet set, which has a cost).
let createRatelimit = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  createRatelimit = new Ratelimit({
    redis: new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }),
    limiter: Ratelimit.slidingWindow(5, '3600 s'), // 5 wallet-set creations per IP per hour
    prefix: 'ratelimit:circle-create',
  });
} else {
  console.warn('api/circle-wallet.js: UPSTASH_REDIS_REST_URL/TOKEN not set — wallet-creation rate limiting is OFF.');
}

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

    // ---- Create a new wallet across all bridge-supported chains ----
    // EVM wallets in the same wallet set share the same address across chains.
    if (action === 'create') {
      if (createRatelimit) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const { success } = await createRatelimit.limit(ip);
        if (!success) {
          return res.status(429).json({ error: 'Too many wallets created from this network — please wait a bit and try again.' });
        }
      }

      const walletSetResponse = await client.createWalletSet({
        name: 'FlowFi WalletSet ' + Date.now(),
      });
      const walletSetId = walletSetResponse.data?.walletSet?.id;

      const walletsResponse = await client.createWallets({
        blockchains: BRIDGE_CHAINS,
        count: 1,
        walletSetId,
      });

      const wallets = walletsResponse.data?.wallets ?? [];
      const walletsByChain = {};
      for (const w of wallets) {
        walletsByChain[w.blockchain] = { walletId: w.id, address: w.address };
      }

      const address = wallets[0]?.address ?? null;

      return res.status(200).json({
        success: true,
        address,
        walletsByChain,
      });
    }

    // ---- Execute a contract call (approve, swap, bridge burn/mint, transfer, etc.) ----
    // Body: { action: "contractCall", walletId, contractAddress, abiFunctionSignature, abiParameters, feeLevel? }
    if (action === 'contractCall') {
      const { walletId, contractAddress, abiFunctionSignature, abiParameters, feeLevel } = req.body;

      if (!walletId || !contractAddress || !abiFunctionSignature) {
        return res.status(400).json({ error: 'walletId, contractAddress, and abiFunctionSignature are required.' });
      }

      const allowedFunctions = ALLOWED_CALLS.get(String(contractAddress).toLowerCase());
      if (!allowedFunctions || !allowedFunctions.has(abiFunctionSignature)) {
        return res.status(403).json({ error: 'This contract/function is not on FlowFi\'s allowlist for Circle Wallet execution.' });
      }

      const response = await client.createContractExecutionTransaction({
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters: abiParameters || [],
        fee: { type: 'level', config: { feeLevel: feeLevel || 'MEDIUM' } },
      });

      return res.status(200).json({
        success: true,
        transactionId: response.data?.id,
        state: response.data?.state,
      });
    }

    // ---- Wallet "restore by browsing" has been removed ----
    // This used to list EVERY wallet ever created by ANYONE, with no
    // ownership check at all — a client could pick any wallet in the
    // response and the app would treat it as its own from then on, with
    // full contractCall access to it. There is no safe way to keep a
    // browse-and-pick recovery flow without proving ownership first, so
    // it's disabled rather than patched. A real recovery flow (e.g.
    // email-based, tying a wallet to a verified identity before it can be
    // reattached) is planned separately, later, not a quick fix here.
    if (action === 'listWallets') {
      return res.status(410).json({
        error: 'Wallet recovery by browsing has been disabled for security reasons. It previously exposed every wallet in the system with no ownership check.',
      });
    }

    // ---- Poll a transaction's status until it's mined ----
    // Body: { action: "getTransaction", transactionId }
    if (action === 'getTransaction') {
      const { transactionId } = req.body;
      if (!transactionId) {
        return res.status(400).json({ error: 'transactionId is required.' });
      }

      const response = await client.getTransaction({ id: transactionId });
      const tx = response.data?.transaction;

      return res.status(200).json({
        success: true,
        state: tx?.state,
        txHash: tx?.txHash,
        errorReason: tx?.errorReason,
      });
    }

    // ---- Sign EIP-712 typed data (e.g. a Circle Gateway burn intent) ----
    // Body: { action: "signTypedData", walletId, data }
    // `data` must be the full { domain, types, primaryType, message } object —
    // it's JSON.stringify'd here since Circle's API expects a JSON string, not
    // a raw object. entitySecretCiphertext is generated fresh by the SDK
    // internally, same as every other authenticated call on this client.
    if (action === 'signTypedData') {
      const { walletId, data } = req.body;
      if (!walletId || !data) {
        return res.status(400).json({ error: 'walletId and data are required.' });
      }

      const response = await client.signTypedData({
        walletId,
        data: JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
      });

      return res.status(200).json({
        success: true,
        signature: response.data?.signature,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Circle wallet error:', error.message);
    return res.status(500).json({ error: error.message ?? 'Internal error' });
  }
};
