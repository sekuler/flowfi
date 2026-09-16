import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";

// Arc mainnet -- chain ID and USDC address confirmed against Circle's own
// docs.arc.io on 2026-09-16 (mainnet launch day), and Arc's presence on
// LI.FI independently confirmed via a live call to LI.FI's own
// GET https://li.quest/v1/chains (returns "arc", id: 5042, mainnet: true).
const ARC_MAINNET_CHAIN_ID = 5042;
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";

// Base mainnet -- default source chain, matches the "get to Arc" onboarding
// flow (most users' USDC/ETH sits on Base). Native ETH is represented by
// LI.FI's own convention: the zero address (confirmed via LI.FI's API docs,
// not the 0xEeee... placeholder some other aggregators use).
const BASE_CHAIN_ID = 8453;
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

// FlowFi's own registration on portal.li.fi ("FlowFi Mainnet", integration
// string "flowfi"). The API key is intentionally read from a client-exposed
// Vite env var, not hardcoded -- this is the correct, LI.FI-documented way
// to supply it for a browser widget (unlike FlowFi's other API keys, which
// stay server-side; this one is meant to travel with the client bundle,
// same as e.g. a Stripe publishable key).
//
// The fee receiver wallet is configured on LI.FI's side (portal.li.fi ->
// Wallets tab -> Default EVM), not in this file -- there's no recipient
// address field in WidgetFeeConfig at all. The number below only controls
// FlowFi's own cut of the percentage; LI.FI separately adds its own
// platform fee (visible in the portal's Fees tab) on top of this, so the
// actual total a user pays is higher than just this number.
//
// Relay is NOT integrated separately -- LI.FI already aggregates it
// (confirmed live: a Base -> Arc USDC quote surfaced "Relay" as one of the
// listed routes alongside AcrossV4, Polymer, and LI.FI's own Intents).
// Running our own parallel Relay widget just duplicated a route LI.FI
// already offers, so it's been removed.
const lifiWidgetConfig: WidgetConfig = {
  integrator: "flowfi",
  apiKey: import.meta.env.VITE_LIFI_API_KEY,
  providers: [EthereumProvider()],
  fromChain: BASE_CHAIN_ID,
  fromToken: NATIVE_TOKEN_ADDRESS,
  toChain: ARC_MAINNET_CHAIN_ID,
  toToken: ARC_MAINNET_USDC,
  // Default route ranking is CHEAPEST, not fastest -- on a brand-new chain
  // like Arc, the cheapest available route can be a much slower bridge
  // when a faster one exists but costs slightly more. FASTEST prioritizes
  // speed instead -- more in line with what a "move USDC to Arc" flow
  // should feel like. Users can still open the full route list and pick a
  // cheaper/slower one themselves via the 'wide' variant below.
  routePriority: "FASTEST",
  // 'wide' variant shows the full route comparison panel next to the main
  // form once an amount is entered (Across / Polymer / Relay / LI.FI
  // Intents side by side) -- this replaces the old manual LI.FI/Relay tab
  // switcher entirely.
  variant: "wide",
  subvariant: "default",
  // FlowFi is EVM-only -- restricting the widget's own chain/token fetch to
  // EVM avoids it also pulling Solana/Bitcoin/Sui/etc. data it will never
  // use. This also meaningfully shrinks a very large default request
  // (chainTypes=EVM,SVM,UTXO,MVM,TVM,CSTL&limit=1000) that was timing out
  // in testing on Arc's mainnet-launch-day token list.
  chains: {
    types: { allow: [ChainType.EVM] },
  },
  feeConfig: {
    name: "FlowFi fee",
    fee: 0.001, // 0.10% -- kept low at launch to encourage early usage; can raise later once there's real volume
    showFeePercentage: true,
    showFeeTooltip: true,
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
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, marginBottom: 10 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: "0 0 4px 0" }}>Bridge to Arc</h2>
      </div>

      <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} />
    </div>
  );
}
