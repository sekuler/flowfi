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

    // ---- Create a new wallet ----
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

    // ---- Execute a contract call (approve, swap, bridge, addLiquidity, etc.) ----
    // Body: { action: "contractCall", walletId, contractAddress, abiFunctionSignature, abiParameters, feeLevel? }
    // abiFunctionSignature example: "approve(address,uint256)"
    // abiParameters example: ["0xSpenderAddress", "1000000"]
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
