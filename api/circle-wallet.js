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
