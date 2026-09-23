import EmptyState from "./EmptyState";
import { HelpCircle, Copy, ExternalLink, RefreshCw, Check, CheckCircle2, Clock, XCircle, ListFilter } from "lucide-react";
import { useState, useEffect } from "react";
import { getCircleWallet, type CircleWalletInfo } from "../circleWalletHelpers";
import { TYPE_ICON, loadLifiDiamond, shortHash, metaFor, describeTx, amountCell, fetchActivity, type Tx } from "./txUtils";

interface Props {
  address: string;
  network?: "testnet" | "mainnet";
}

const GRID = "108px minmax(220px, 1fr) 130px 108px 74px 78px";

export default function TxHistory({ address, network = "testnet" }: Props) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [diamond, setDiamond] = useState<string | null>(null);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);

  useEffect(() => {
    setCircleWallet(getCircleWallet());
  }, []);

  const isMainnet = network === "mainnet";
  const explorer = isMainnet ? "https://arc.etherscan.io" : "https://testnet.arcscan.app";
  // Circle Wallet only exists on testnet.
  const effectiveAddress = !isMainnet && useCircle && circleWallet ? circleWallet.address : address;

  useEffect(() => {
    if (!isMainnet) return;
    let cancelled = false;
    loadLifiDiamond().then((d) => { if (!cancelled) setDiamond(d); });
    return () => { cancelled = true; };
  }, [isMainnet]);

  async function load() {
    if (!effectiveAddress) return;
    setLoading(true); setError(null);
    try {
      setTxs(await fetchActivity(effectiveAddress, network, 30));
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes("Arcscan returned")) {
        setError(`Explorer API error (${err.message.replace("Arcscan returned ", "")}) — try again in a moment.`);
      } else if (err.message === "Failed to fetch" || err.message?.toLowerCase().includes("network")) {
        setError("Network error reaching Arc's explorer — check your connection and try again.");
      } else {
        setError("Could not load transactions — Arc RPC or explorer may be temporarily unavailable.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (effectiveAddress) load(); }, [effectiveAddress, network]);

  function copyHash(hash: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  const filterOptions = isMainnet
    ? ["all", "Send", "Receive", "Swap", "Route", "Bridge", "Approve"]
    : ["all", "Send", "Receive", "Swap", "Bridge", "Approve"];
  const filteredTxs = filter === "all" ? txs : txs.filter((tx) => metaFor(tx, effectiveAddress, diamond).label === filter);

  const statusOf = (s: string) => ({
    ok: { label: "Success", color: "#15803D", icon: <CheckCircle2 size={15} /> },
    pending: { label: "Pending", color: "#B45309", icon: <Clock size={15} /> },
    error: { label: "Failed", color: "#DC2626", icon: <XCircle size={15} /> },
  }[s] ?? { label: "Pending", color: "#B45309", icon: <Clock size={15} /> });

  const card = { background: "#ffffff", border: "1px solid #E7E4DD", borderRadius: 18, boxShadow: "0 8px 30px -12px rgba(61,90,241,0.18)" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <style>{`
        .ff-tx-row { transition: background 0.15s; }
        .ff-tx-row:hover { background: rgba(61,90,241,0.06); }
        .ff-icon-btn { transition: all 0.15s; }
        .ff-icon-btn:hover { background: #E3E8FD; border-color: #C3CCF8; }
        .ff-tx-scroll { scrollbar-width: thin; scrollbar-color: #D5DCF9 transparent; }
        .ff-tx-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .ff-tx-scroll::-webkit-scrollbar-thumb { background: #D5DCF9; border-radius: 8px; }
        .ff-tx-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {!isMainnet && circleWallet && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setUseCircle(false)}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: !useCircle ? "#E3E8FD" : "#EEF1FE", color: !useCircle ? "#2B45C9" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Browser Wallet
          </button>
          <button onClick={() => setUseCircle(true)}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: useCircle ? "#E3E8FD" : "#EEF1FE", color: useCircle ? "#2B45C9" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Circle Wallet
          </button>
        </div>
      )}

      <div style={{ fontSize: 12.5, color: "#6B7280" }}>
        Recent transactions on Arc{isMainnet ? " Mainnet" : " Testnet"} · sourced from{" "}
        <a href={explorer} target="_blank" rel="noopener noreferrer" style={{ color: "#3D5AF1", fontWeight: 600, textDecoration: "none" }}>{explorer.replace("https://", "")}</a>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {filterOptions.map((f) => {
            const on = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 12, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  border: on ? "1px solid transparent" : "1px solid #E7E4DD",
                  background: on ? "#3D5AF1" : "#ffffff",
                  color: on ? "#ffffff" : "#4B5563",
                  boxShadow: on ? "0 6px 16px rgba(61,90,241,0.35)" : "none",
                  transition: "all 0.15s",
                }}>
                {f === "all" ? <ListFilter size={13} /> : TYPE_ICON[f]}
                {f === "all" ? "All" : f}
              </button>
            );
          })}
        </div>
        <button onClick={load} className="ff-icon-btn"
          style={{ display: "flex", alignItems: "center", gap: 6, background: "#ffffff", border: "1px solid #E7E4DD", borderRadius: 12, padding: "7px 14px", color: "#4B5563", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {loading && (
        <div style={{ ...card, overflow: "hidden" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "1rem 1.1rem", borderTop: i > 0 ? "1px solid #EEF1FE" : "none" }}>
              <div style={{ width: 70, height: 22, borderRadius: 8, background: "#EEF1FE" }} />
              <div style={{ flex: 1, height: 12, borderRadius: 6, background: "#EEF1FE" }} />
              <div style={{ width: 60, height: 12, borderRadius: 6, background: "#EEF1FE" }} />
            </div>
          ))}
        </div>
      )}
      {!loading && error && (
        <div style={{ ...card, padding: "2.5rem 1.5rem", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(61,90,241,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <HelpCircle size={22} color="#3D5AF1" />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Could not load transactions</div>
          <div style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 16 }}>{error}</div>
          <button onClick={load} style={{ background: "#3D5AF1", border: "none", borderRadius: 10, padding: "0.6rem 1.4rem", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", marginRight: 10 }}>↻ Try again</button>
          {effectiveAddress && (
            <a href={`${explorer}/address/${effectiveAddress}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#3D5AF1", fontWeight: 600, textDecoration: "none" }}>Open explorer ↗</a>
          )}
        </div>
      )}
      {!loading && !error && filteredTxs.length === 0 && (
        <EmptyState icon="📭" title="No transactions yet" subtitle="Your activity will show up here once you start using FlowFi" />
      )}

      {!loading && filteredTxs.length > 0 && (
        <div style={{ ...card, overflow: "hidden" }}>
          <div className="ff-tx-scroll" style={{ overflow: "auto", maxHeight: "70vh" }}>
            <div style={{ minWidth: 720 }}>
              <div style={{ position: "sticky", top: 0, zIndex: 2, display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "0.75rem 1.1rem", background: "#F5F7FF", borderBottom: "1px solid #E7E4DD", fontSize: 10.5, color: "#6B7280", fontWeight: 700, letterSpacing: "0.6px" }}>
                <span>TYPE</span>
                <span>DETAILS</span>
                <span style={{ textAlign: "right" }}>AMOUNT</span>
                <span>STATUS</span>
                <span style={{ textAlign: "right" }}>AGE</span>
                <span style={{ textAlign: "right" }}>ACTIONS</span>
              </div>
              {filteredTxs.map((tx) => {
                const meta = metaFor(tx, effectiveAddress, diamond);
                const st = statusOf(tx.status);
                const amt = amountCell(tx, effectiveAddress);
                const amtColor = amt?.tone === "in" ? "#15803D" : "#111827";
                return (
                  <div key={tx.hash} className="ff-tx-row"
                    style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center", padding: "0.85rem 1.1rem", borderTop: "1px solid #EEF1FE" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: meta.color, background: `${meta.color}1a`, border: `1px solid ${meta.color}33`, padding: "4px 10px", borderRadius: 8, width: "fit-content" }}>
                      {TYPE_ICON[meta.label]}{meta.label}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, color: "#111827", fontWeight: 500, lineHeight: 1.4 }}>{describeTx(tx, effectiveAddress, network, diamond)}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "#9CA3AF", marginTop: 2, fontFamily: "ui-monospace, 'JetBrains Mono', monospace" }}>{shortHash(tx.hash)} · {tx.age}</span>
                    </span>
                    <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: amt ? amtColor : "#9CA3AF", fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, 'JetBrains Mono', monospace" }}>
                      {amt ? amt.text : "—"}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: st.color }}>
                      {st.icon}{st.label}
                    </span>
                    <span style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{tx.age}</span>
                    <span style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <button onClick={(e) => copyHash(tx.hash, e)} title="Copy hash" className="ff-icon-btn"
                        style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #E7E4DD", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: copiedHash === tx.hash ? "#16A34A" : "#4B5563" }}>
                        {copiedHash === tx.hash ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" title="Open in explorer" className="ff-icon-btn"
                        style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #E7E4DD", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#4B5563" }}>
                        <ExternalLink size={14} />
                      </a>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!loading && txs.length > 0 && (
        <a href={`${explorer}/address/${effectiveAddress}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#4B5563", fontSize: 12, textDecoration: "none", padding: "0.25rem" }}>
          View all on Explorer ↗
        </a>
      )}
      {!loading && isMainnet && (
        <div style={{ borderLeft: "3px solid #F59E0B", paddingLeft: 10, color: "#6B7280", fontSize: 12 }}>
          The source-chain leg of a bridge appears on that chain's explorer.
        </div>
      )}
    </div>
  );
}
