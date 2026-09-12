import { defineChain } from "viem";

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

// Note: token/contract addresses live in src/contracts.ts, not here — this
// file is chain *definitions* only. USDC_ADDRESS_SEPOLIA and
// ARC_USDC_ADDRESS used to live here too but were dead exports (nothing
// imported them; every component just redeclared its own local copy
// instead), which is exactly the kind of drift src/contracts.ts now exists
// to prevent.

export const SEPOLIA_CHAIN_ID = 11155111;
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_CHAIN_ID_HEX = "0x4CEF52"; 
