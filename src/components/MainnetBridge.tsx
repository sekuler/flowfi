import { useState } from "react";
import { LiFiWidget, ChainType, type WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";
import RelaySwap from "./RelaySwap";

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
  // Intents side by side).
  variant: "wide",
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

// LI.FI aggregates Across, Polymer, Relay, and its own Intents for routes
// INTO Arc, so the 'wide' widget above covers that direction well. But as
// of Arc's mainnet launch day, LI.FI does not yet surface ANY route OUT of
// Arc (confirmed live: Arc -> Base returns no routes via LI.FI, Gaszip, or
// any aggregator we tried -- except Relay's own SDK/site, which supports
// it directly). So instead of a brand-based LI.FI-vs-Relay switcher, this
// is a direction-based one: LI.FI handles "To Arc" (it has more routes
// there), Relay's own SDK handles "From Arc" (it's the only one that
// currently works). Revisit once LI.FI indexes Arc-outbound routes -- at
// that point "From Arc" can likely move to the LI.FI widget too.
type Direction = "toArc" | "fromArc";

export default function MainnetBridge() {
  const [direction, setDirection] = useState<Direction>("toArc");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, marginBottom: 10 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: "0 0 4px 0" }}>Bridge to Arc</h2>
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
          onClick={() => setDirection("toArc")}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 9,
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
            background: direction === "toArc" ? "#FFFFFF" : "transparent",
            color: direction === "toArc" ? "#111827" : "#6B7280",
            boxShadow: direction === "toArc" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            transition: "all 0.15s ease",
          }}
        >
          To Arc
        </button>
        <button
          type="button"
          onClick={() => setDirection("fromArc")}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 9,
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
            background: direction === "fromArc" ? "#FFFFFF" : "transparent",
            color: direction === "fromArc" ? "#111827" : "#6B7280",
            boxShadow: direction === "fromArc" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            transition: "all 0.15s ease",
          }}
        >
          From Arc
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#B91C1C", fontWeight: 600, margin: "0 2px 8px" }}>
        ⚠ Real funds — transactions go to Arc Mainnet and can't be reversed.
      </div>

      {direction === "toArc" ? (
        <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} />
      ) : (
        <RelaySwap direction="fromArc" />
      )}
    </div>
  );
}
