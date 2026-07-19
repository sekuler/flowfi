export default function CircleWallet() {
  return (
    <div style={{ maxWidth: 460, width: "100%" }}>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "2rem", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>◎</div>
        <h3 style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Circle Wallet — Coming Soon</h3>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 6 }}>
          Seed-phrase-free wallets powered by Circle Developer-Controlled Wallets.
        </p>
        <p style={{ color: "#475569", fontSize: 12 }}>
          Backend integration is complete; finalizing serverless runtime compatibility.
        </p>
      </div>
    </div>
  );
}