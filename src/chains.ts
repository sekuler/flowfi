import { defineChain, formatUnits } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["/api/rpc-proxy"],
      webSocket: ["wss://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arcscan Testnet",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});

// Deliberately NOT a re-export of viem's own built-in `arc` chain
// (`import { arc } from "viem/chains"`). Its default RPC
// (rpc.mainnet.arc.io) doesn't return CORS headers for browser calls --
// confirmed live 2026-09-18, a Node script reading a balance worked
// instantly while the exact same call from the browser silently returned
// 0. Routing through our own rpc-proxy by default here means anyone who
// imports `arcMainnet` from this file gets the working setup automatically,
// instead of needing to remember to override the transport URL every time
// (which is exactly how that bug happened the first time).
export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["/api/rpc-proxy?network=mainnet"],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://arc.etherscan.io",
    },
  },
});

// Note: token/contract addresses live in src/contracts.ts, not here — this
// file is chain *definitions* only. USDC_ADDRESS_SEPOLIA and
// ARC_USDC_ADDRESS used to live here too but were dead exports (nothing
// imported them; every component just redeclared its own local copy
// instead), which is exactly the kind of drift src/contracts.ts now exists
// to prevent.

export const SEPOLIA_CHAIN_ID = 11155111;
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_CHAIN_ID_HEX = "0x4CEF52";

export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_MAINNET_CHAIN_ID_HEX = "0x13B2";

// ---- USDC decimal helpers ----
//
// Arc represents "USDC" two genuinely different ways, and mixing them up
// has caused two separate real bugs already (a Dashboard double-count, and
// a Circle Wallet false "insufficient gas" error):
//   - Native/protocol balance (what a plain wallet-to-wallet send moves,
//     since USDC is Arc's gas token) -- 18 decimals, "wei-style".
//   - The ERC-20 USDC contract's own balanceOf() -- 6 decimals, standard
//     USDC precision, what dApp/contract interactions actually use.
// These are two VIEWS of value, not necessarily two separate pots of
// money to add together -- check which one a given balance actually came
// from before combining anything.
export const USDC_ERC20_DECIMALS = 6;
export const ARC_NATIVE_DECIMALS = 18;

export function formatUsdcErc20(raw: bigint): number {
  return Number(formatUnits(raw, USDC_ERC20_DECIMALS));
}

export function formatArcNative(raw: bigint): number {
  return Number(formatUnits(raw, ARC_NATIVE_DECIMALS));
}
