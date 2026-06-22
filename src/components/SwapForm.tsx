export default function SwapForm({ address }: { provider: unknown; address: string; kitKey: string }) {
  return (
    <div style={{ maxWidth: 460, width: "100%" }}>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "2rem", textAlign: "center", backdropFilter: "blur(10px)" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{"🔄"}</div>
        <h3 style={{ color: "#f1f5f9", marginBottom: 8, fontSize: 20, fontWeight: 700 }}>{"Swap Tokens"}</h3>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 8, lineHeight: 1.6 }}>{"Swap USDC and EURC on Arc Testnet via Curve Finance."}</p>
        <p style={{ color: "#475569", fontSize: 12, marginBottom: 24 }}>{"Connected: " + address.slice(0,6) + "..." + address.slice(-4)}</p>
        <a href="https://www.curve.finance/dex/arc/swap" target="_blank" rel="noopener noreferrer"
          style={{ display: "block", padding: "0.9rem", borderRadius: 12, background: "linear-gradient(135deg, #7c3aed, #6366f1)", color: "#fff", fontSize: 16, fontWeight: 700, textDecoration: "none", boxShadow: "0 0 24px rgba(139,92,246,0.4)" }}>
          {"Open Curve Finance"}
        </a>
        <p style={{ color: "#334155", fontSize: 11, marginTop: 12 }}>{"curve.finance/dex/arc/swap"}</p>
      </div>
    </div>
  );
}
