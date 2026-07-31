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
  "0xa9059cbb": { label: "Send", color: "#16A34A" },
  "0x095ea7b3": { label: "Approve", color: "#f59e0b" },
  "0x74b30078": { label: "Swap", color: "#7c3aed" },
  "0x9cd441da": { label: "Swap", color: "#7c3aed" },
  "0xe334e8dd": { label: "Escrow", color: "#5B21B6" },
  "0x6a627842": { label: "Bridge", color: "#5B21B6" },
  "0x0ba469bc": { label: "Bridge", color: "#5B21B6" },
  "0x": { label: "Deploy", color: "#4B5563" },
};

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  ok: { label: "Success", color: "#16A34A", dot: "#16A34A" },
  pending: { label: "Pending", color: "#B45309", dot: "#f59e0b" },
  error: { label: "Failed", color: "#DC2626", dot: "#ef4444" },
};

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function methodMeta(methodId: string) {
  return METHOD_META[methodId] ?? { label: "Transfer", color: "#6B7280" };
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
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: !useCircle ? "#ede9fe" : "#f5f3ff", color: !useCircle ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Browser Wallet
          </button>
          <button onClick={() => setUseCircle(true)}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: useCircle ? "#ede9fe" : "#f5f3ff", color: useCircle ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
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
                background: filter === f ? "#ede9fe" : "#f5f3ff",
                color: filter === f ? "#5B21B6" : "#4B5563",
              }}>
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
        <button onClick={load} style={{ background: "#f5f3ff", border: "none", borderRadius: 8, padding: "6px 12px", color: "#4B5563", fontSize: 12, cursor: "pointer" }}>↻ Refresh</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "3rem", color: "#374151", fontSize: 13 }}>Loading transactions...</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "1rem", color: "#DC2626", fontSize: 13 }}>{error}</div>}
      {!loading && !error && filteredTxs.length === 0 && (
  <EmptyState icon="📭" title="No transactions found" subtitle="Your activity will show up here once you start using FlowFi" />
)}
      

      {!loading && filteredTxs.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 16, overflow: "hidden" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 60px 70px", gap: 8, padding: "0.6rem 1rem", background: "#f5f3ff", fontSize: 10, color: "#374151", fontWeight: 700, letterSpacing: "0.5px" }}>
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
                <span style={{ fontSize: 12, color: "#6B7280", fontFamily: "ui-monospace, monospace" }}>{tx.hash.slice(0, 14)}...</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: statusMeta.color, background: `${statusMeta.dot}1a`, padding: "3px 8px", borderRadius: 6, width: "fit-content" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.dot }} />
                  {statusMeta.label}
                </span>
                <button onClick={(e) => copyHash(tx.hash, e)} title="Copy hash"
                  style={{ background: "#f5f3ff", border: "none", borderRadius: 6, padding: "3px 8px", color: copiedHash === tx.hash ? "#16A34A" : "#4B5563", fontSize: 11, cursor: "pointer", width: "fit-content" }}>
                  {copiedHash === tx.hash ? "✓" : "⧉"}
                </button>
                <span style={{ fontSize: 11, color: "#374151", textAlign: "right" }}>{tx.age}</span>
              </a>
            );
          })}
        </div>
      )}

      {!loading && txs.length > 0 && (
        <a href={`https://testnet.arcscan.app/address/${effectiveAddress}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#4B5563", fontSize: 12, textDecoration: "none", padding: "0.5rem" }}>
          View all on Explorer ↗
        </a>
      )}
    </div>
  );
}
