import { useRef } from "react";
import { LiFiWidget, ChainType, type WidgetConfig, type FormState } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import type { EIP1193Provider } from "viem";
import NetworkGuard from "./NetworkGuard";
import { ARC_MAINNET_CHAIN_ID } from "../chains";
import ArcTokenStrip from "./ArcTokenStrip";

// Same-chain counterpart to MainnetBridge.tsx: fromChain and toChain are
// both Arc, so LI.FI's widget renders as a same-chain swap (routed
// through whatever DEX liquidity it finds on Arc -- e.g. the Uniswap v4
// PoolManager already live there) instead of a cross-chain bridge. No new
// FlowFi contract involved, same zero-risk aggregator model as the
// Bridge page -- this is deliberately the same widget/config shape, not
// a separate build, per the "one place already does both" reasoning
// behind adding this as its own nav entry.
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";
// EURC on Arc Mainnet, from Circle's official EURC contract address list. It is the default target, so the To
// field opens filled in (USDC to EURC) instead of empty.
const ARC_MAINNET_EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";

const lifiWidgetConfig: WidgetConfig = {
  integrator: "flowfi",
  apiKey: import.meta.env.VITE_LIFI_API_KEY,
  providers: [EthereumProvider()],
  fromChain: ARC_MAINNET_CHAIN_ID,
  fromToken: ARC_MAINNET_USDC,
  toChain: ARC_MAINNET_CHAIN_ID,
  toToken: ARC_MAINNET_EURC,
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

export default function MainnetSwap({ provider }: { provider?: EIP1193Provider }) {
  const formRef = useRef<FormState | null>(null);

  return (
    <div style={{ position: "relative", maxWidth: 900, margin: "0 auto", padding: "1.75rem 0.75rem 2.5rem" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, borderRadius: 32, overflow: "hidden", background: "linear-gradient(180deg,#FBFAFF 0%,#F3F0FF 100%)", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: -140, left: "50%", transform: "translateX(-50%)", width: 620, height: 380, background: "radial-gradient(closest-side, rgba(124,58,237,0.20), rgba(96,165,250,0.12) 60%, transparent)", filter: "blur(30px)" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,0.85)", border: "1px solid #E4DDFB", padding: "5px 13px", borderRadius: 999 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,0.18)" }} />
            <span style={{ fontSize: 11.5, color: "#5B21B6", fontWeight: 700 }}>Arc Mainnet · real funds, real fees</span>
          </div>
        </div>

        <NetworkGuard provider={provider}>
          <style>{`
            .lifi-widget-wrap input:focus {
              outline: none !important;
              box-shadow: none !important;
            }
          `}</style>
          <div className="lifi-widget-wrap" style={{ maxWidth: 480, margin: "0 auto" }}>
            <ArcTokenStrip chainId={ARC_MAINNET_CHAIN_ID} label="Swap to" initialSelected={ARC_MAINNET_EURC}
              onPick={(t) => {
                // Picking USDC means "swap into USDC", so the source becomes EURC; anything else swaps from USDC.
                const opts = { setUrlSearchParam: false };
                const intoUsdc = t.address.toLowerCase() === ARC_MAINNET_USDC.toLowerCase();
                formRef.current?.setFieldValue("fromToken", intoUsdc ? ARC_MAINNET_EURC : ARC_MAINNET_USDC, opts);
                formRef.current?.setFieldValue("toToken", t.address, opts);
              }} />
            <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} formRef={formRef} />
          </div>
        </NetworkGuard>
      </div>
    </div>
  );
}
