const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const BRIDGE_CHAINS = ['ARC-TESTNET', 'ETH-SEPOLIA', 'BASE-SEPOLIA', 'ARB-SEPOLIA'];

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

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Circle wallet error:', error.message);
    return res.status(500).json({ error: error.message ?? 'Internal error' });
  }
};
