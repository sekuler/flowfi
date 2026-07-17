import { useState, useEffect } from "react";

interface Tx {
  hash: string;
  method: string;
  age: string;
  from: string;
  to: string;
  status: string;
}

interface Props {
  address: string;
}

export default function TxHistory({ address }: Props) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const items = (data.items ?? []).map((tx: any) => ({
        hash: tx.hash,
        method: tx.method ?? "Transfer",
        age: tx.timestamp ? timeAgo(tx.timestamp) : "—",
        from: tx.from?.hash ?? "—",
        to: tx.to?.hash ?? "—",
        status: tx.status ?? "ok",
      }));
      setTxs(items);
    } catch {
      setError("Could not load transactions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (address) load(); }, [address]);

  function timeAgo(timestamp: string) {
    const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function shortAddr(addr: string) {
    if (!addr || addr === "—") return "—";
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={load} style={{ background: "none", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "6px 12px", color: "#334155", fontSize: 12, cursor: "pointer" }}>Refresh</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "3rem", color: "#334155", fontSize: 13 }}>Loading transactions...</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "1rem", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
      {!loading && !error && txs.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#334155", fontSize: 13 }}>No transactions found.</div>}

      {!loading && txs.map((tx) => (
        <div key={tx.hash} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: tx.status === "ok" ? "#10b981" : "#ef4444" }} />
              <span style={{ fontSize: 12, color: "#64748b", background: "rgba(255,255,255,0.04)", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{tx.method}</span>
            </div>
            <span style={{ fontSize: 11, color: "#334155" }}>{tx.age}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: "#475569" }}>
              <span style={{ fontFamily: "monospace" }}>{shortAddr(tx.from)}</span>
              <span style={{ color: "#334155" }}>→</span>
              <span style={{ fontFamily: "monospace" }}>{shortAddr(tx.to)}</span>
            </div>
            <a href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#4f46e5", textDecoration: "none", fontFamily: "monospace" }}>
              {tx.hash.slice(0, 10)}... ↗
            </a>
          </div>
        </div>
      ))}

      {!loading && txs.length > 0 && (
        <a href={`https://testnet.arcscan.app/address/${address}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#334155", fontSize: 12, textDecoration: "none", padding: "0.5rem" }}>
          View all on Explorer ↗
        </a>
      )}
    </div>
  );
}