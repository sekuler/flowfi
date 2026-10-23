// Testnet Circle Wallet API — retired.
// FlowFi now runs on Arc Mainnet only (see api/circle-wallet-mainnet.js). The testnet
// contracts stay onchain, but this backend no longer signs or sends anything.
module.exports = async function handler(req, res) {
  return res.status(410).json({ error: 'The FlowFi Testnet is retired. Please use FlowFi on Arc Mainnet.' });
};
