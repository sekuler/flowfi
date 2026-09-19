import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import type { EIP1193Provider } from "viem";
import NetworkGuard from "./NetworkGuard";
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

export default function MainnetBridge({ provider }: { provider?: EIP1193Provider }) {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EDE9FE", color: "#6D5EF7", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
      </div>

      <NetworkGuard provider={provider} />

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
    </div>
  );
}
