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

// Base mainnet -- default source chain for the "To Arc" side.
const BASE_CHAIN_ID = 8453;
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

// FlowFi's own registration on portal.li.fi ("FlowFi Mainnet", integration
// string "flowfi"). The API key is read from a client-exposed Vite env var
// (LI.FI's documented way to supply it for a browser widget).
//
// No FlowFi feeConfig here anymore -- bridging is free for the user on
// both LI.FI and Relay now (see RelaySwap.tsx). Monetization moved to
// Token Launch / Liquidity Pools instead of competing on bridge pricing.
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
  // speed instead. Users can still open the full route list ('wide'
  // variant below) and pick a different one themselves if they want.
  routePriority: "FASTEST",
  // 'wide' variant shows the full route comparison panel next to the main
  // form once an amount is entered (Across / Polymer / Relay / LI.FI
  // Intents side by side).
  variant: "wide",
  // FlowFi is EVM-only -- restricting the widget's own chain/token fetch to
  // EVM avoids it also pulling Solana/Bitcoin/Sui/etc. data it will never
  // use.
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

// LI.FI aggregates Across, Polymer, Relay, and its own Intents for routes
// INTO Arc, so the 'wide' widget below is worth keeping for that direction
// -- it genuinely offers more choice. But as of Arc's mainnet launch day,
// LI.FI does not yet surface ANY route OUT of Arc (confirmed live: Arc ->
// Base returns no routes via LI.FI or any aggregator tried, except
// Relay's own SDK/site, which supports it directly). So this is a
// direction-based split, not a brand-based one: LI.FI handles "To Arc"
// (more routes, real choice), Relay's own SDK handles "From Arc" (the
// only thing that currently works). Revisit once LI.FI indexes
// Arc-outbound routes.
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

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#B91C1C", fontWeight: 600, margin: "0 2px 12px" }}>
        ⚠ Real funds — transactions go to Arc Mainnet and can't be reversed.
      </div>

      {direction === "toArc" ? (
        <LiFiWidget integrator="flowfi" config={lifiWidgetConfig} />
      ) : (
        <RelaySwap fixedDirection="fromArc" />
      )}
    </div>
  );
}
