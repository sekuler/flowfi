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
      http: ["https://rpc.testnet.arc.network"],
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

export const USDC_ADDRESS_SEPOLIA =
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;

export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

export const SEPOLIA_CHAIN_ID = 11155111;
export const ARC_TESTNET_CHAIN_ID = 5042002;
