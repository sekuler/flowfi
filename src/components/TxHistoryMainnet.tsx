import { useState, useEffect, type ReactNode } from "react";
import { ArrowUp, ArrowDown, Copy, ExternalLink, RefreshCw, Check, ListFilter, HelpCircle, ArrowUpRight, ArrowDownLeft, Repeat, Route as RouteIcon, Link2, ShieldCheck } from "lucide-react";
import EmptyState from "./EmptyState";
import { useIsMobile } from "../useIsMobile";
import { loadLifiDiamond, shortHash, metaFor, describeTx, amountCell, fetchActivity, type Tx } from "./txUtils";
import { T, glass, pill, iconBtn } from "./mainnetTheme";

// Arc MAINNET history (the testnet page keeps using TxHistory.tsx, untouched).
// Same data and labelling as before (txUtils), new look: filter pills, one glass panel,
// a round direction icon per row, green "Success" pill, copy + explorer buttons.
const EXPLORER = "https://arc.etherscan.io";
const FILTERS: { key: string; label: string; icon: ReactNode }[] = [
  { key: "all", label: "All", icon: <ListFilter size={16} /> },
  { key: "Send", label: "Send", icon: <ArrowUpRight size={16} /> },
  { key: "Receive", label: "Receive", icon: <ArrowDownLeft size={16} /> },
  { key: "Swap", label: "Swap", icon: <Repeat size={16} /> },
  { key: "Route", label: "Route", icon: <RouteIcon size={16} /> },
  { key: "Bridge", label: "Bridge", icon: <Link2 size={16} /> },
  { key: "Approve", label: "Approve", icon: <ShieldCheck size={16} /> },
];

// Round icon: green arrow up for money going out, blue arrow down for money coming in, the type's own icon otherwise.
function DirIcon({ label, tone, color }: { label: string; tone: "in" | "out" | "neutral" | null; color: string }) {
  const out = label === "Send" || (tone === "out" && label !== "Approve");
  const inn = label === "Receive" || tone === "in";
  const c = out ? "#22B573" : inn ? "#3D6AF2" : color;
  const icon = out ? <ArrowUp size={22} strokeWidth={2.6} /> : inn ? <ArrowDown size={22} strokeWidth={2.6} />
    : label === "Swap" ? <Repeat size={20} strokeWidth={2.4} /> : label === "Bridge" ? <Link2 size={20} strokeWidth={2.4} />
    : label === "Approve" ? <ShieldCheck size={20} strokeWidth={2.4} /> : label === "Route" ? <RouteIcon size={20} strokeWidth={2.4} /> : <ArrowUpRight size={20} strokeWidth={2.4} />;
  return (
    <span style={{ width: 46, height: 46, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", background: `radial-gradient(circle at 35% 30%, ${c}CC 0%, ${c} 70%)`, boxShadow: `0 8px 16px -8px ${c}, inset 0 1px 0 rgba(255,255,255,0.4)` }}>
      {icon}
    </span>
  );
}

export default function TxHistoryMainnet({ address }: { address: string }) {
  const isMobile = useIsMobile();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [diamond, setDiamond] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLifiDiamond().then((d) => { if (!cancelled) setDiamond(d); });
    return () => { cancelled = true; };
  }, []);

  async function load() {
    if (!address) return;
    setLoading(true); setError(null);
    try {
      setTxs(await fetchActivity(address, "mainnet", 30));
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes("Arcscan returned")) setError(`Explorer API error (${err.message.replace("Arcscan returned ", "")}), try again in a moment.`);
      else if (err.message === "Failed to fetch" || err.message?.toLowerCase().includes("network")) setError("Network error reaching Arc's explorer. Check your connection and try again.");
      else setError("Could not load transactions. Arc's explorer may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [address]);

  function copyHash(hash: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  const shown = filter === "all" ? txs : txs.filter((tx) => metaFor(tx, address, diamond).label === filter);
  const status = (s: string) => (s === "ok" ? { label: "Success", color: "#22B573" } : s === "error" ? { label: "Failed", color: "#E5484D" } : { label: "Pending", color: "#E0A100" });

  const filterBtn = (on: boolean) => ({
    display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 18px", borderRadius: 14, fontSize: 16, fontWeight: 500, cursor: "pointer",
    border: on ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.95)",
    background: on ? "linear-gradient(180deg, #4A6DF5 0%, #2F52E6 100%)" : "rgba(255,255,255,0.75)",
    color: on ? "#FFFFFF" : T.text,
    boxShadow: on ? "0 10px 20px -10px rgba(47,82,230,0.8), inset 0 1px 0 rgba(255,255,255,0.35)" : "0 4px 12px -8px rgba(36,58,150,0.35)",
    transition: "all 0.15s",
  } as const);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <style>{`
        .ffh2-row { transition: background 0.15s; }
        .ffh2-row:hover { background: rgba(255,255,255,0.55); }
        .ffh2-icon:hover { background: #FFFFFF !important; color: ${T.blue} !important; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} style={filterBtn(filter === f.key)}>
              {f.icon}{f.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={load} style={filterBtn(false)}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {loading && (
        <div style={{ ...glass, overflow: "hidden" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "1.1rem 1.4rem", borderTop: i ? `1px solid ${T.line}` : "none" }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(61,90,241,0.08)" }} />
              <div style={{ flex: 1, height: 14, borderRadius: 7, background: "rgba(61,90,241,0.08)" }} />
              <div style={{ width: 80, height: 14, borderRadius: 7, background: "rgba(61,90,241,0.08)" }} />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div style={{ ...glass, padding: "2.5rem 1.5rem", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(61,90,241,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <HelpCircle size={24} color={T.blue} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 4 }}>Could not load transactions</div>
          <div style={{ fontSize: 14, color: T.muted, marginBottom: 16 }}>{error}</div>
          <button type="button" onClick={load} style={{ ...filterBtn(true), display: "inline-flex" }}><RefreshCw size={16} /> Try again</button>
        </div>
      )}

      {!loading && !error && shown.length === 0 && (
        <EmptyState icon="📭" title="No transactions yet" subtitle="Your activity will show up here once you start using FlowFi" />
      )}

      {!loading && !error && shown.length > 0 && (
        <div style={{ ...glass, overflow: "hidden" }}>
          {shown.map((tx, i) => {
            const meta = metaFor(tx, address, diamond);
            const amt = amountCell(tx, address);
            const st = status(tx.status);
            return (
              <div key={tx.hash} className="ffh2-row"
                style={{ display: "grid", gridTemplateColumns: isMobile ? "auto minmax(0, 1fr) auto" : "auto minmax(0, 1fr) 140px 110px 90px auto", alignItems: "center", gap: isMobile ? 12 : 18, padding: isMobile ? "0.9rem 1rem" : "1rem 1.4rem", borderTop: i ? `1px solid ${T.line}` : "none" }}>
                <DirIcon label={meta.label} tone={amt?.tone ?? null} color={meta.color} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: isMobile ? 15 : 18, color: T.ink, fontWeight: 500, lineHeight: 1.35 }}>{describeTx(tx, address, "mainnet", diamond)}</span>
                  <span style={{ display: "block", fontSize: 14, color: T.muted, marginTop: 3, fontFamily: T.mono }}>{shortHash(tx.hash)} · {tx.age}</span>
                  {isMobile && <span style={{ ...pill(st.color), marginTop: 6, fontSize: 12, padding: "3px 10px" }}>{st.label}</span>}
                </span>
                <span style={{ textAlign: "right", fontSize: isMobile ? 16 : 22, fontWeight: 600, color: amt ? (amt.tone === "in" ? "#15803D" : T.ink) : T.faint, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {amt ? amt.text : "—"}
                </span>
                {!isMobile && <span><span style={pill(st.color)}>{st.label}</span></span>}
                {!isMobile && <span style={{ fontSize: 16, color: T.muted, textAlign: "right", whiteSpace: "nowrap" }}>{tx.age}</span>}
                {!isMobile && (
                  <span style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={(e) => copyHash(tx.hash, e)} title="Copy hash" aria-label="Copy hash" className="ffh2-icon" style={{ ...iconBtn, color: copiedHash === tx.hash ? "#16A34A" : iconBtn.color }}>
                      {copiedHash === tx.hash ? <Check size={17} /> : <Copy size={17} />}
                    </button>
                    <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" title="Open in explorer" aria-label="Open in explorer" className="ffh2-icon" style={iconBtn}>
                      <ExternalLink size={17} />
                    </a>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && txs.length > 0 && (
        <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: T.muted, fontSize: 14, textDecoration: "none", padding: "0.25rem" }}>
          View all on Explorer ↗
        </a>
      )}
      {!loading && (
        <div style={{ textAlign: "center", color: T.faint, fontSize: 13 }}>
          The source-chain leg of a bridge appears on that chain's explorer.
        </div>
      )}
    </div>
  );
}
