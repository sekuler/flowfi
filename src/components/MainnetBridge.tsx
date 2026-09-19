import { useState } from "react";
import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import type { EIP1193Provider } from "viem";
import NetworkGuard from "./NetworkGuard";
import NativeCctpBridge from "./NativeCctpBridge";
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

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EDE9FE", color: "#6D5EF7", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setMode("lifi")}
          style={{ flex: 1, padding: "0.9rem", borderRadius: 14, border: mode === "lifi" ? "2px solid #6D5EF7" : "1px solid #E5E7EB", background: mode === "lifi" ? "#F5F3FF" : "#fff", cursor: "pointer", textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Any token · LI.FI</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Swap + bridge in one route</div>
        </button>
        <button onClick={() => setMode("cctp")}
          style={{ flex: 1, padding: "0.9rem", borderRadius: 14, border: mode === "cctp" ? "2px solid #6D5EF7" : "1px solid #E5E7EB", background: mode === "cctp" ? "#F5F3FF" : "#fff", cursor: "pointer", textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>USDC · Circle CCTP</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Native USDC, burn and mint</div>
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
