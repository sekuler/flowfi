import { useState } from "react";

interface CircleWalletData {
  walletId: string;
  address: string;
  blockchain: string;
}

export default function CircleWallet() {
  const [wallet, setWallet] = useState<CircleWalletData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createWallet() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/circle-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Failed to create wallet.");
      setWallet({ walletId: data.walletId, address: data.address, blockchain: data.blockchain });
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "100%", maxWidth: 460 }}>
      <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#6ee7b7", margin: 0 }}>
          Powered by Circle Developer-Controlled Wallets — no seed phrase, no browser extension. Circle's MPC infrastructure secures the private key.
        </p>
      </div>

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        {!wallet && (
          <>
            <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>
              Create a Circle-managed wallet on Arc Testnet in one click. No extension, no private key to store.
            </p>
            {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
            <button onClick={createWallet} disabled={loading}
              style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #059669, #10b981)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Creating wallet..." : "Create Circle Wallet"}
            </button>
          </>
        )}

        {wallet && (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <p style={{ fontSize: 14, color: "#6ee7b7", fontWeight: 700, margin: 0 }}>Wallet created!</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 4 }}>ADDRESS</div>
                <div style={{ fontSize: 13, color: "#e2e8f0", fontFamily: "monospace", wordBreak: "break-all" }}>{wallet.address}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 4 }}>BLOCKCHAIN</div>
                <div style={{ fontSize: 13, color: "#e2e8f0" }}>{wallet.blockchain}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 4 }}>WALLET ID</div>
                <div style={{ fontSize: 11, color: "#475569", fontFamily: "monospace" }}>{wallet.walletId}</div>
              </div>
            </div>
            <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(79,70,229,0.25)", background: "rgba(79,70,229,0.06)", color: "#818cf8", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
              View on Explorer ↗
            </a>
            <button onClick={() => { setWallet(null); setError(null); }}
              style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Create Another
            </button>
          </>
        )}
      </div>
    </div>
  );
}