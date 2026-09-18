import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";

const ARC_MAINNET_CHAIN_ID = 5042;
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

export default function MainnetBridge() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
      </div>

      <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} />
    </div>
  );
}
