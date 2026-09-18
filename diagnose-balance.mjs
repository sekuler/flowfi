// One-off diagnostic script -- NOT part of the app, just run once to see
// the real error our try/catch has been silently swallowing as "0.00".
// Run with: node diagnose-balance.mjs
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { arc } from "viem/chains";

const ADDRESS = "0x000077D4cAd5a94A505CAeA8d5A5c4C4Eff969Da";
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";

const client = createPublicClient({ chain: arc, transport: http() });

console.log("Chain RPC URLs:", arc.rpcUrls.default.http);

try {
  const blockNumber = await client.getBlockNumber();
  console.log("✅ RPC connectivity OK — current block:", blockNumber.toString());
} catch (e) {
  console.log("❌ RPC connectivity FAILED:", e.message);
}

try {
  const native = await client.getBalance({ address: ADDRESS });
  console.log("✅ Native balance (raw wei, 18 decimals):", native.toString());
  console.log("   Formatted:", formatUnits(native, 18));
} catch (e) {
  console.log("❌ getBalance FAILED:", e.shortMessage || e.message);
}

try {
  const erc20 = await client.readContract({
    address: ARC_MAINNET_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [ADDRESS],
  });
  console.log("✅ ERC-20 USDC balance (raw, 6 decimals):", erc20.toString());
  console.log("   Formatted:", formatUnits(erc20, 6));
} catch (e) {
  console.log("❌ ERC-20 balanceOf FAILED:", e.shortMessage || e.message);
}
