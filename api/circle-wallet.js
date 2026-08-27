const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const BRIDGE_CHAINS = ['ARC-TESTNET', 'ETH-SEPOLIA', 'BASE-SEPOLIA', 'ARB-SEPOLIA'];

// Every contract FlowFi's Circle Wallet integration is ever meant to call —
// checked before any contractCall is forwarded to Circle. This closes an
// open gap where a client could otherwise ask the backend to execute an
// arbitrary contract/function using a known walletId. Addresses are the
// same case-insensitively; compare in lowercase.
const ALLOWED_CONTRACTS = new Set([
  // USDC, per chain
  '0x3600000000000000000000000000000000000000', // Arc Testnet
  '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', // Ethereum Sepolia
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e', // Base Sepolia
  '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', // Arbitrum Sepolia
  // EURC (Arc)
  '0x89b50855aa3be2f677cd6303cec089b5f319d72a',
  // FlowFi's own contracts (Arc)
  '0x13bd5d32509bc5d03811b3e5f86952a8c2bd0521', // ArcSwap v2
  // Circle CCTP V2 (same address on every supported chain)
  '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', // TokenMessengerV2
  '0xe737e5cebeeba77efe34d4aa090756590b1ce275', // MessageTransmitterV2
  // Circle Gateway (same address on every supported chain)
  '0x0077777d7eba4688bdef3e311b846f25870a19b9', // Gateway Wallet
  '0x0022222abe238cc2c7bb1f21003f0a260052475b', // Gateway Minter
].map((a) => a.toLowerCase()));

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

      if (!ALLOWED_CONTRACTS.has(String(contractAddress).toLowerCase())) {
        return res.status(403).json({ error: 'This contract is not on FlowFi\'s allowlist for Circle Wallet execution.' });
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

    // ---- List all previously created wallets (for recovering a lost/overwritten one) ----
    if (action === 'listWallets') {
      const response = await client.listWallets({ pageSize: 50 });
      const wallets = response.data?.wallets ?? [];

      // Group by address since EVM wallets in the same set share one address
      const byAddress = {};
      for (const w of wallets) {
        if (!byAddress[w.address]) byAddress[w.address] = { address: w.address, walletsByChain: {}, createDate: w.createDate };
        byAddress[w.address].walletsByChain[w.blockchain] = { walletId: w.id, address: w.address };
      }

      const grouped = Object.values(byAddress).sort((a, b) => new Date(b.createDate) - new Date(a.createDate));
      return res.status(200).json({ success: true, wallets: grouped });
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
