import { useState, useEffect } from "react";
import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import type { EIP1193Provider } from "viem";
import NetworkGuard from "./NetworkGuard";
import NativeCctpBridge, { SOURCE_CHAINS } from "./NativeCctpBridge";
import { ARC_MAINNET_CHAIN_ID } from "../chains";

const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";
const BASE_CHAIN_ID = 8453;
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

const lifiWidgetConfig: WidgetConfig = {
  integrator: "flowfi",
  apiKey: import.meta.env.VITE_LIFI_API_KEY,
  providers: [EthereumProvider()],
  fromChain: BASE_CHAIN_ID,
  fromToken: NATIVE_TOKEN_ADDRESS,
  toChain: ARC_MAINNET_CHAIN_ID,
  toToken: ARC_MAINNET_USDC,
  routePriority: "FASTEST",
  variant: "wide",
  chains: {
    types: { allow: [ChainType.EVM] },
  },
  theme: {
    container: {
      border: "1px solid #E5E7EB",
      borderRadius: 16,
      boxShadow: "none",
    },
    components: {
      MuiInputCard: {
        styleOverrides: {
          root: {
            border: "none",
            boxShadow: "none",
          },
        },
      },
    },
  },
  appearance: "light",
};

export default function MainnetBridge({ address, provider }: { address?: string; provider?: EIP1193Provider }) {
  const [mode, setMode] = useState<"cctp" | "lifi">("lifi");
  const [rotatingIdx, setRotatingIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setRotatingIdx((i) => (i + 1) % SOURCE_CHAINS.length), 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EDE9FE", color: "#6D5EF7", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
      </div>

      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EDE9FE", padding: "5px 12px", borderRadius: 999, marginBottom: 14 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E" }} />
        <span style={{ fontSize: 11, color: "#6D5EF7", fontWeight: 700, letterSpacing: "0.3px" }}>Arc Mainnet · Circle CCTP V2 · LI.FI</span>
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: "#111827", margin: "0 0 6px", lineHeight: 1.15 }}>
        {mode === "cctp" ? "Send USDC from" : "Move any token from"}{" "}
        <span key={rotatingIdx} className="flowfi-mono" style={{ color: "#6D5EF7", display: "inline-block" }}>{SOURCE_CHAINS[rotatingIdx].name}</span>{" "}
        to Arc
      </h1>
      <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 20 }}>
        {mode === "cctp"
          ? "Native USDC over Circle CCTP V2: it's burned on the source chain and minted fresh on Arc, with no wrapped tokens. Need a different asset? Switch to the Any token tab."
          : "LI.FI finds the best route and handles the swap and the bridge in a single flow. If you're only moving USDC, the Native USDC tab is the more direct path."}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setMode("lifi")}
          style={{ flex: 1, padding: "0.9rem", borderRadius: 14, border: mode === "lifi" ? "2px solid #6D5EF7" : "1px solid #E5E7EB", background: mode === "lifi" ? "#F5F3FF" : "#fff", cursor: "pointer", textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Any token</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Swap and bridge via LI.FI</div>
        </button>
        <button onClick={() => setMode("cctp")}
          style={{ flex: 1, padding: "0.9rem", borderRadius: 14, border: mode === "cctp" ? "2px solid #6D5EF7" : "1px solid #E5E7EB", background: mode === "cctp" ? "#F5F3FF" : "#fff", cursor: "pointer", textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Native USDC</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>1:1 via Circle CCTP</div>
        </button>
      </div>

      <NetworkGuard provider={provider}>
        {mode === "cctp" && address && <NativeCctpBridge address={address} provider={provider} />}
        {mode === "cctp" && !address && (
          <div style={{ background: "#fff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "2rem", textAlign: "center", color: "#6B7280", fontSize: 13 }}>
            Connect your wallet to use the native CCTP bridge.
          </div>
        )}

        {mode === "lifi" && (
          <>
            {/* The amount input's focus outline turned out to be the browser's
                own default :focus ring, not a MUI component -- theme.components
                (MuiInputCard above) can't reach that, so it's force-removed here
                with plain CSS scoped to this wrapper only. */}
            <style>{`
              .lifi-widget-wrap input:focus {
                outline: none !important;
                box-shadow: none !important;
              }
            `}</style>
            <div className="lifi-widget-wrap">
              <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} />
            </div>
          </>
        )}
      </NetworkGuard>
    </div>
  );
}
