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
const BASE_CHAIN_ID = 8453;
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

// No FlowFi feeConfig here -- bridging is free for the user on both
// LI.FI and Relay. Monetization moved to Token Launch / Liquidity Pools
// instead of competing on bridge pricing.
const lifiWidgetConfig: WidgetConfig = {
  integrator: "flowfi",
  apiKey: import.meta.env.VITE_LIFI_API_KEY,
  providers: [EthereumProvider()],
  fromChain: BASE_CHAIN_ID,
  fromToken: NATIVE_TOKEN_ADDRESS,
  toChain: ARC_MAINNET_CHAIN_ID,
  toToken: ARC_MAINNET_USDC,
  // Default route ranking is CHEAPEST, not fastest -- FASTEST prioritizes
  // speed instead. Users can still open the full route list ('wide'
  // variant below) and pick a different one themselves.
  routePriority: "FASTEST",
  // 'wide' variant shows the full route comparison panel next to the main
  // form once an amount is entered (Across / Polymer / Relay / LI.FI
  // Intents side by side) -- this is the reason LI.FI stays for this
  // direction specifically.
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
  },
  appearance: "light",
};

// Not a brand choice (LI.FI vs Relay) and not two separate tabs anymore --
// just one bridge with a direction flip, same interaction as relay.link's
// own swap arrow. Which ENGINE renders underneath is an implementation
// detail the user never has to think about:
//   - Base -> Arc: LI.FI ('wide' variant), because it genuinely offers
//     route choice here (Across, Polymer, Relay, LI.FI Intents).
//   - Arc -> Base: Relay's own SDK, because LI.FI does not yet surface ANY
//     route out of Arc (confirmed live, Arc's mainnet launch day) --
//     Relay is the only thing that works in this direction right now,
//     not a design choice. Revisit once LI.FI indexes Arc-outbound routes;
//     at that point this direction can show a route panel too.
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

      {/* Single direction control -- not a tab pair. A label plus one
          small arrow button that flips it, same as relay.link's own UI. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>
          {direction === "toArc" ? "Base" : "Arc"}
        </span>
        <button
          type="button"
          onClick={() => setDirection((d) => (d === "toArc" ? "fromArc" : "toArc"))}
          aria-label="Reverse direction"
          style={{ width: 26, height: 26, borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7280", fontSize: 13, cursor: "pointer" }}
        >
          &#8646;
        </button>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>
          {direction === "toArc" ? "Arc" : "Base"}
        </span>
      </div>

      {direction === "toArc" ? (
        <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} />
      ) : (
        <RelaySwap fixedDirection="fromArc" />
      )}
    </div>
  );
}
