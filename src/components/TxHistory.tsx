import EmptyState from "./EmptyState";
import { useState, useEffect } from "react";
import { getCircleWallet, type CircleWalletInfo } from "../circleWalletHelpers";

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

const METHOD_META: Record<string, { label: string; color: string }> = {
  "0xa9059cbb": { label: "Send", color: "#34d399" },
  "0x095ea7b3": { label: "Approve", color: "#f59e0b" },
  "0x74b30078": { label: "Swap", color: "#22d3ee" },
  "0x9cd441da": { label: "Swap", color: "#22d3ee" },
  "0xe334e8dd": { label: "Escrow", color: "#6366f1" },
  "0x6a627842": { label: "Bridge", color: "#6366f1" },
  "0x0ba469bc": { label: "Bridge", color: "#6366f1" },
  "0x": { label: "Deploy", color: "#64748b" },
};

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  ok: { label: "Success", color: "#6ee7b7", dot: "#34d399" },
  pending: { label: "Pending", color: "#fcd34d", dot: "#f59e0b" },
  error: { label: "Failed", color: "#fca5a5", dot: "#ef4444" },
};

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function methodMeta(methodId: string) {
  return METHOD_META[methodId] ?? { label: "Transfer", color: "#94a3b8" };
}

export default function TxHistory({ address }: Props) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);

  useEffect(() => {
    setCircleWallet(getCircleWallet());
  }, []);

  const effectiveAddress = useCircle && circleWallet ? circleWallet.address : address;

  async function load() {
    if (!effectiveAddress) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${effectiveAddress}&limit=30`);
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

  useEffect(() => { if (effectiveAddress) load(); }, [effectiveAddress]);

  function copyHash(hash: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  const filterOptions = ["all", "Send", "Swap", "Bridge", "Approve", "Escrow"];
  const filteredTxs = filter === "all" ? txs : txs.filter(tx => methodMeta(tx.method).label === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {circleWallet && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setUseCircle(false)}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: !useCircle ? "#1b2740" : "#111a2c", color: !useCircle ? "#67e8f9" : "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Browser Wallet
          </button>
          <button onClick={() => setUseCircle(true)}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: useCircle ? "#1b2740" : "#111a2c", color: useCircle ? "#67e8f9" : "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Circle Wallet
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {filterOptions.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "none",
                background: filter === f ? "#1b2740" : "#111a2c",
                color: filter === f ? "#67e8f9" : "#64748b",
              }}>
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
        <button onClick={load} style={{ background: "#111a2c", border: "none", borderRadius: 8, padding: "6px 12px", color: "#64748b", fontSize: 12, cursor: "pointer" }}>↻ Refresh</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "3rem", color: "#475569", fontSize: 13 }}>Loading transactions...</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "1rem", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
      {!loading && !error && filteredTxs.length === 0 && (
  <EmptyState icon="📭" title="No transactions found" subtitle="Your activity will show up here once you start using FlowFi" />
)}
      

      {!loading && filteredTxs.length > 0 && (
        <div style={{ background: "#0b1220", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 60px 70px", gap: 8, padding: "0.6rem 1rem", background: "#111a2c", fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: "0.5px" }}>
            <span>TYPE</span>
            <span>TX HASH</span>
            <span>STATUS</span>
            <span></span>
            <span style={{ textAlign: "right" }}>AGE</span>
          </div>
          {filteredTxs.map((tx) => {
            const meta = methodMeta(tx.method);
            const statusMeta = STATUS_META[tx.status] ?? STATUS_META.pending;
            return (
              <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "grid", gridTemplateColumns: "80px 1fr 90px 60px 70px", gap: 8, alignItems: "center",
                  padding: "0.75rem 1rem", textDecoration: "none",
                }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: `${meta.color}1a`, padding: "3px 8px", borderRadius: 6, textAlign: "center", width: "fit-content" }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>{tx.hash.slice(0, 14)}...</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: statusMeta.color, background: `${statusMeta.dot}1a`, padding: "3px 8px", borderRadius: 6, width: "fit-content" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.dot }} />
                  {statusMeta.label}
                </span>
                <button onClick={(e) => copyHash(tx.hash, e)} title="Copy hash"
                  style={{ background: "#111a2c", border: "none", borderRadius: 6, padding: "3px 8px", color: copiedHash === tx.hash ? "#6ee7b7" : "#64748b", fontSize: 11, cursor: "pointer", width: "fit-content" }}>
                  {copiedHash === tx.hash ? "✓" : "⧉"}
                </button>
                <span style={{ fontSize: 11, color: "#475569", textAlign: "right" }}>{tx.age}</span>
              </a>
            );
          })}
        </div>
      )}

      {!loading && txs.length > 0 && (
        <a href={`https://testnet.arcscan.app/address/${effectiveAddress}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#64748b", fontSize: 12, textDecoration: "none", padding: "0.5rem" }}>
          View all on Explorer ↗
        </a>
      )}
    </div>
  );
}
