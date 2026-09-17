import RelaySwap from "./RelaySwap";

// LI.FI's own widget was dropped from this page. Two problems with it, both
// pointing the same direction: (1) its default/recommended route for Base
// -> Arc was sometimes NOT the fastest one despite routePriority:
// "FASTEST" in config -- users hitting "Exchange" could end up on an
// 18-minute route without realizing it. (2) LI.FI still doesn't surface
// any route OUT of Arc at all (see RelaySwap.tsx for details), which is
// why a Relay-direct integration existed here already. Since Relay's own
// SDK is fast and reliable in BOTH directions, and having two separate
// widgets/tabs for "which provider" was confusing, this page is now just
// the one Relay-backed card, with a flip arrow (inside RelaySwap) to
// switch Base<->Arc direction instead of a tab switcher.
export default function MainnetBridge() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, marginBottom: 10 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: "0 0 4px 0" }}>Bridge to Arc</h2>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#B91C1C", fontWeight: 600, margin: "0 2px 12px" }}>
        ⚠ Real funds — transactions go to Arc Mainnet and can't be reversed.
      </div>

      <RelaySwap />
    </div>
  );
}
