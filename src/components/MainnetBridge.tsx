import { useState, useEffect, useRef } from "react";
import { LiFiWidget, ChainType, type WidgetConfig, type FormState } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import type { EIP1193Provider } from "viem";
import NativeCctpBridge, { SOURCE_CHAINS } from "./NativeCctpBridge";
import ArcTokenStrip from "./ArcTokenStrip";
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
    colorSchemes: {
      light: { palette: { primary: { main: "#6D5EF7" } } },
    },
    shape: {
      borderRadius: 16,
    },
    container: {
      border: "1px solid rgba(212,201,250,0.7)",
      borderRadius: 24,
      boxShadow: "0 24px 60px -16px rgba(109,94,247,0.28)",
      maxHeight: "none",
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
  const formRef = useRef<FormState | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setRotatingIdx((i) => (i + 1) % SOURCE_CHAINS.length), 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ position: "relative", maxWidth: 900, margin: "0 auto", padding: "1.75rem 0.75rem 2.5rem" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, borderRadius: 32, overflow: "hidden", background: "linear-gradient(180deg,#FBFAFF 0%,#F3F0FF 100%)", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: -140, left: "50%", transform: "translateX(-50%)", width: 620, height: 380, background: "radial-gradient(closest-side, rgba(124,58,237,0.20), rgba(96,165,250,0.12) 60%, transparent)", filter: "blur(30px)" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: mode === "cctp" ? 0 : 18 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,0.85)", border: "1px solid #E4DDFB", padding: "5px 13px", borderRadius: 999 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,0.18)" }} />
            <span style={{ fontSize: 11.5, color: "#5B21B6", fontWeight: 700 }}>Arc Mainnet · real funds, real fees</span>
          </div>
        </div>

        {mode === "cctp" && (
          <div key="native-hero" style={{ animation: "flowfi-fade-in 0.35s ease" }}>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: "#111827", margin: "16px 0 8px", lineHeight: 1.15, textAlign: "center" }}>
              Send USDC from{" "}
              <span key={rotatingIdx} className="flowfi-mono" style={{ color: "#6D5EF7", display: "inline-block" }}>{SOURCE_CHAINS[rotatingIdx].name}</span>{" "}
              to Arc
            </h1>
            <p style={{ fontSize: 13.5, color: "#6B7280", margin: "0 auto 20px", maxWidth: 470, textAlign: "center", lineHeight: 1.55 }}>
              Native USDC over Circle CCTP V2: it's burned on the source chain and minted fresh on Arc, with no wrapped tokens. Need a different asset? Switch to the Any token tab.
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: 4, padding: 4, background: "rgba(255,255,255,0.85)", border: "1px solid #E4DDFB", borderRadius: 999, width: "fit-content", maxWidth: "100%", margin: "0 auto 20px" }}>
          {([
            { k: "lifi", t: "Any token", sub: "Swap and bridge via LI.FI" },
            { k: "cctp", t: "Native USDC", sub: "1:1 via Circle CCTP" },
          ] as const).map((tab) => {
            const on = mode === tab.k;
            return (
              <button key={tab.k} onClick={() => setMode(tab.k)}
                style={{ padding: "0.55rem 1.1rem", borderRadius: 999, border: "none", cursor: "pointer", textAlign: "left", background: on ? "linear-gradient(135deg,#4F46E5,#7C3AED)" : "transparent", boxShadow: on ? "0 6px 16px rgba(109,94,247,0.35)" : "none", transition: "all 0.2s" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: on ? "#fff" : "#111827" }}>{tab.t}</div>
                <div style={{ fontSize: 10.5, color: on ? "rgba(255,255,255,0.8)" : "#6B7280" }}>{tab.sub}</div>
              </button>
            );
          })}
        </div>

        <>
          {mode === "cctp" && address && <NativeCctpBridge address={address} provider={provider} />}
          {mode === "cctp" && !address && (
            <div style={{ maxWidth: 480, margin: "0 auto", background: "#fff", border: "1px solid #D4C9FA", borderRadius: 24, padding: "2rem", textAlign: "center", color: "#6B7280", fontSize: 13 }}>
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
              <div className="lifi-widget-wrap" style={{ maxWidth: 480, margin: "0 auto" }}>
                <ArcTokenStrip chainId={ARC_MAINNET_CHAIN_ID} label="Bridge into"
                  onPick={(t) => formRef.current?.setFieldValue("toToken", t.address, { setUrlSearchParam: false })} />
                <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} formRef={formRef} />
              </div>
            </>
          )}
        </>
      </div>
    </div>
  );
}
