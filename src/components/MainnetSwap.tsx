import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";

// Same-chain counterpart to MainnetBridge.tsx: fromChain and toChain are
// both Arc, so LI.FI's widget renders as a same-chain swap (routed
// through whatever DEX liquidity it finds on Arc -- e.g. the Uniswap v4
// PoolManager already live there) instead of a cross-chain bridge. No new
// FlowFi contract involved, same zero-risk aggregator model as the
// Bridge page -- this is deliberately the same widget/config shape, not
// a separate build, per the "one place already does both" reasoning
// behind adding this as its own nav entry.
const ARC_MAINNET_CHAIN_ID = 5042;
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";

const lifiWidgetConfig: WidgetConfig = {
  integrator: "flowfi",
  apiKey: import.meta.env.VITE_LIFI_API_KEY,
  providers: [EthereumProvider()],
  fromChain: ARC_MAINNET_CHAIN_ID,
  fromToken: ARC_MAINNET_USDC,
  toChain: ARC_MAINNET_CHAIN_ID,
  // toToken deliberately left unset -- Arc's on-chain token set is still
  // very new, so instead of guessing a second default asset, the token
  // picker opens for the user to choose what's actually available.
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

export default function MainnetSwap() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
      </div>

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
