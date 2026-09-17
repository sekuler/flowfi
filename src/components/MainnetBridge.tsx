import { useState } from "react";
import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import RelaySwap from "./RelaySwap";

const ARC_MAINNET_CHAIN_ID = 5042;
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";
const BASE_CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

// No FlowFi feeConfig -- bridging is free for the user on both LI.FI and
// Relay. Monetization is Token Launch / Liquidity Pools instead.
const lifiWidgetConfig: WidgetConfig = {
  integrator: "flowfi",
  apiKey: import.meta.env.VITE_LIFI_API_KEY,
  providers: [EthereumProvider()],
  fromChain: BASE_CHAIN_ID,
  fromToken: NATIVE_TOKEN_ADDRESS,
  toChain: ARC_MAINNET_CHAIN_ID,
  toToken: ARC_MAINNET_USDC,
  routePriority: "FASTEST",
  // 'wide' variant shows the full route comparison panel (Across / Polymer
  // / Relay / LI.FI Intents side by side) once an amount is entered.
  variant: "wide",
  // Arc isn't selectable as a source chain inside LI.FI -- LI.FI doesn't
  // reliably support routes OUT of Arc yet (confirmed live: false
  // "insufficient funds" errors even with a funded wallet). Arc-outbound
  // goes through the Relay card below instead, which we've tested working.
  chains: {
    types: { allow: [ChainType.EVM] },
    from: { deny: [ARC_MAINNET_CHAIN_ID] },
  },
  theme: {
    container: {
      border: "1px solid #E5E7EB",
      borderRadius: 16,
      boxShadow: "none",
    },
  },
  appearance: "light",
};

type Engine = "lifi" | "relay";

export default function MainnetBridge() {
  const [engine, setEngine] = useState<Engine>("lifi");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
      </div>

      <div
        style={{
          display: "flex",
          background: "#F3F4F6",
          borderRadius: 12,
          padding: 4,
          gap: 4,
          marginBottom: 14,
          maxWidth: 320,
        }}
      >
        <button
          type="button"
          onClick={() => setEngine("lifi")}
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 9, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 700,
            background: engine === "lifi" ? "#FFFFFF" : "transparent",
            color: engine === "lifi" ? "#111827" : "#6B7280",
            boxShadow: engine === "lifi" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
          }}
        >
          LI.FI
        </button>
        <button
          type="button"
          onClick={() => setEngine("relay")}
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 9, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 700,
            background: engine === "relay" ? "#FFFFFF" : "transparent",
            color: engine === "relay" ? "#111827" : "#6B7280",
            boxShadow: engine === "relay" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
          }}
        >
          Relay
        </button>
      </div>

      {engine === "lifi" ? (
        <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} />
      ) : (
        <RelaySwap
          defaultSell={{ chainId: 5042, token: { symbol: "USDC", address: ARC_MAINNET_USDC, decimals: 6 } }}
          defaultBuy={{ chainId: 8453, token: { symbol: "USDC", address: BASE_USDC, decimals: 6 } }}
        />
      )}
    </div>
  );
}
