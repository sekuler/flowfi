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

const METHOD_META: Record<string, { label: string; color: string; bg: string }> = {
  "0xa9059cbb": { label: "Send", color: "#10b981", bg: "rgba(16,185,129,0.1)" },
  "0x095ea7b3": { label: "Approve", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  "0x74b30078": { label: "Swap", color: "#8b5cf6", bg: "rgba(139,92,246,0.1)" },
  "0x9cd441da": { label: "Swap", color: "#8b5cf6", bg: "rgba(139,92,246,0.1)" },
  "0xe334e8dd": { label: "Escrow", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
  "0x": { label: "Deploy", color: "#64748b", bg: "rgba(100,116,139,0.1)" },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  ok: { label: "Success", color: "#6ee7b7", bg: "rgba(16,185,129,0.1)", dot: "#10b981" },
  pending: { label: "Pending", color: "#fcd34d", bg: "rgba(245,158,11,0.1)", dot: "#f59e0b" },
  error: { label: "Failed", color: "#fca5a5", bg: "rgba(239,68,68,0.1)", dot: "#ef4444" },
};

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function methodMeta(methodId: string) {
  return METHOD_META[methodId] ?? { label: "Transfer", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };
}

export default function TxHistory({ address }: Props) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=30`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const items: Tx[] = (data.result ?? []).map((tx: any) => ({
        hash: tx.hash,
        method: tx.methodId ?? "0x",
        age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
        from: tx.from ?? "—",
        to: tx.to ?? "—",
        status: tx.txreceipt_status === "1" ? "ok" : tx.txreceipt_status === "0" ? "error" : "pending",
      }));
      setTxs(items);
    } catch {
      setError("Could not load transactions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (address) load(); }, [address]);

  function copyHash(hash: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  const filterOptions = ["all", "Send", "Swap", "Approve", "Escrow"];
  const filteredTxs = filter === "all" ? txs : txs.filter(tx => methodMeta(tx.method).label === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {filterOptions.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: filter === f ? "1px solid rgba(79,70,229,0.4)" : "1px solid rgba(255,255,255,0.08)",
                background: filter === f ? "rgba(79,70,229,0.15)" : "transparent",
                color: filter === f ? "#a5b4fc" : "#64748b",
              }}>
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
        <button onClick={load} style={{ background: "none", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "6px 12px", color: "#334155", fontSize: 12, cursor: "pointer" }}>↻ Refresh</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "3rem", color: "#334155", fontSize: 13 }}>Loading transactions...</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "1rem", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
      {!loading && !error && filteredTxs.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#334155", fontSize: 13 }}>No transactions found.</div>
      )}

      {!loading && filteredTxs.length > 0 && (
        <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 60px 70px", gap: 8, padding: "0.6rem 1rem", background: "rgba(255,255,255,0.03)", fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "0.5px" }}>
            <span>TYPE</span>
            <span>TX HASH</span>
            <span>STATUS</span>
            <span></span>
            <span style={{ textAlign: "right" }}>AGE</span>
          </div>
          {filteredTxs.map((tx, i) => {
            const meta = methodMeta(tx.method);
            const statusMeta = STATUS_META[tx.status] ?? STATUS_META.pending;
            return (
              <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "grid", gridTemplateColumns: "80px 1fr 90px 60px 70px", gap: 8, alignItems: "center",
                  padding: "0.75rem 1rem", textDecoration: "none",
                  borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)",
                  background: "rgba(255,255,255,0.01)",
                }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, padding: "3px 8px", borderRadius: 6, textAlign: "center", width: "fit-content" }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 12, color: "#4f46e5", fontFamily: "monospace" }}>{tx.hash.slice(0, 14)}...</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: statusMeta.color, background: statusMeta.bg, padding: "3px 8px", borderRadius: 6, width: "fit-content" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.dot }} />
                  {statusMeta.label}
                </span>
                <button onClick={(e) => copyHash(tx.hash, e)} title="Copy hash"
                  style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "3px 8px", color: copiedHash === tx.hash ? "#6ee7b7" : "#64748b", fontSize: 11, cursor: "pointer", width: "fit-content" }}>
                  {copiedHash === tx.hash ? "✓" : "⧉"}
                </button>
                <span style={{ fontSize: 11, color: "#334155", textAlign: "right" }}>{tx.age}</span>
              </a>
            );
          })}
        </div>
      )}

      {!loading && txs.length > 0 && (
        <a href={`https://testnet.arcscan.app/address/${address}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#334155", fontSize: 12, textDecoration: "none", padding: "0.5rem" }}>
          View all on Explorer ↗
        </a>
      )}
    </div>
  );
}