import { defineChain } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
  default: { http: ["https://5042002.rpc.thirdweb.com"] },
},
  
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
export const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
export const ARC_CHAIN_ID_HEX = "0x4CEF52";
export const ESCROW_CONTRACT_ADDRESS = "0xb1CC6EEE3Ff88ED7F6adde1418455F7DE650Ab75" as `0x${string}`;