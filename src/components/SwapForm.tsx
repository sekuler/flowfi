interface Props { provider: unknown; address: string; kitKey: string; }

export default function SwapForm({ address }: Props) {
  return (
    <div style={{ maxWidth: 460, width: "100%" }}>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "2rem", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔄</div>
        <h3 style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Swap</h3>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 6 }}>Swap USDC and EURC on Arc Testnet via Arfi Finance.</p>
        <p style={{ color: "#475569", fontSize: 12, marginBottom: 24 }}>{"Connected: " + address.slice(0,6) + "..." + address.slice(-4)}</p>
        <a href="https://arfi.finance/swap" target="_blank" rel="noopener noreferrer"
          style={{ display: "block", padding: "0.9rem", borderRadius: 12, background: "linear-gradient(135deg, #7c3aed, #6366f1)", color: "#fff", fontSize: 16, fontWeight: 700, textDecoration: "none", boxShadow: "0 0 24px rgba(139,92,246,0.4)" }}>
          Open Arfi Finance
        </a>
        <p style={{ color: "#334155", fontSize: 11, marginTop: 12 }}>arfi.finance/swap</p>
      </div>
    </div>
  );
}