import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";

// Arc mainnet — chain ID and USDC address confirmed against Circle's own
// docs.arc.io on 2026-09-16 (mainnet launch day), and Arc's presence on
// LI.FI independently confirmed via a live call to LI.FI's own
// GET https://li.quest/v1/chains (returns "arc", id: 5042, mainnet: true).
const ARC_MAINNET_CHAIN_ID = 5042;
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";

// FlowFi's own registration on portal.li.fi ("FlowFi Mainnet", integration
// string "flowfi"). The API key is intentionally read from a client-exposed
// Vite env var, not hardcoded — this is the correct, LI.FI-documented way
// to supply it for a browser widget (unlike FlowFi's other API keys, which
// stay server-side; this one is meant to travel with the client bundle,
// same as e.g. a Stripe publishable key).
//
// The fee receiver wallet is configured on LI.FI's side (portal.li.fi →
// Wallets tab → Default EVM), not in this file — there's no recipient
// address field in WidgetFeeConfig at all. The number below only controls
// FlowFi's own cut of the percentage; LI.FI separately adds its own
// platform fee (visible in the portal's Fees tab) on top of this, so the
// actual total a user pays is higher than just this number.
const widgetConfig: WidgetConfig = {
  integrator: "flowfi",
  apiKey: import.meta.env.VITE_LIFI_API_KEY,
  providers: [EthereumProvider()],
  toChain: ARC_MAINNET_CHAIN_ID,
  toToken: ARC_MAINNET_USDC,
  // FlowFi is EVM-only — restricting the widget's own chain/token fetch to
  // EVM avoids it also pulling Solana/Bitcoin/Sui/etc. data it will never
  // use. This also meaningfully shrinks a very large default request
  // (chainTypes=EVM,SVM,UTXO,MVM,TVM,CSTL&limit=1000) that was timing out
  // in testing on Arc's mainnet-launch-day token list.
  chains: {
    types: { allow: [ChainType.EVM] },
  },
  feeConfig: {
    name: "FlowFi fee",
    fee: 0.001, // 0.10% — kept low at launch to encourage early usage; can raise later once there's real volume
    showFeePercentage: true,
    showFeeTooltip: true,
  },
  // "split" mode gives two tabs (Bridge / Swap) in one widget instance —
  // matches the "Get to Arc" + "Swap on Arc" two-intent plan without
  // building two separate pages.
  mode: "split",
  modeOptions: {
    split: { defaultTab: "bridge" },
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

export default function MainnetBridge() {
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, marginBottom: 10 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: "0 0 4px 0" }}>Bridge &amp; Swap to Arc</h2>
        <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>
          Routed through LI.FI across 60+ chains and DEXs — not FlowFi's own contracts. FlowFi takes a small fee (shown before you confirm); everything else goes to network/bridge costs.
        </p>
      </div>
      <LiFiWidget integrator="flowfi" config={widgetConfig} />
    </div>
  );
}
