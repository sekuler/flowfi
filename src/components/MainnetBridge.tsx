import RelaySwap from "./RelaySwap";

// LI.FI's widget and the "Base <-> Arc" direction toggle that used to sit
// above it are both gone. Two reasons, same root cause: trying to blend
// two different engines (LI.FI for one direction, Relay for the other)
// under one small toggle kept causing confusion -- and separately, LI.FI's
// own chain search doesn't list Arc mainnet as a selectable "from" chain
// yet (only "Arc Testnet" shows up), which isn't something fixable from
// our config. RelaySwap now handles ANY chain/token on both Sell and Buy
// sides on its own (see its Select Token modal), so it doesn't need a
// second engine sitting next to it anymore -- it defaults to Base -> Arc,
// but the user can change either side freely.
export default function MainnetBridge() {
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 0.5rem" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, marginBottom: 10 }}>
          ⚡ MAINNET — real funds, real fees
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: "0 0 4px 0" }}>Bridge to Arc</h2>
      </div>

      <RelaySwap
        defaultSell={{ chainId: 8453, token: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 } }}
        defaultBuy={{ chainId: 5042, token: { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 } }}
      />
    </div>
  );
}
