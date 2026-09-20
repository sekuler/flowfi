import { useState, useEffect, type ReactNode } from "react";
import type { EIP1193Provider } from "viem";
import { ExternalLink, ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import EmptyState from "./EmptyState";
import NetworkGuard from "./NetworkGuard";
import { useIsMobile } from "../useIsMobile";
import { USDC_LOGO } from "./tokenLogos";
import { TYPE_ICON, loadLifiDiamond, metaFor, amountCell, assetOf, counterpartOf, shortHash, toTx, type Tx } from "./txUtils";

// Mainnet counterpart to Dashboard.tsx. Differences from the testnet
// version, and why:
//   - Fetches tx history with `network=mainnet` (arcscan-proxy.js routes
//     this to Etherscan's arc.etherscan.io V2 API instead of the testnet
//     Blockscout API) -- a different service entirely, confirmed
//     2026-09-18.
//   - Recent-activity links point at arc.etherscan.io, not
//     testnet.arcscan.app.
//   - The empty-state no longer offers "Get Testnet USDC" from
//     faucet.circle.com -- there is no mainnet faucet (real USDC has to
//     be bridged or bought), so that button is gone rather than pointing
//     at something that doesn't exist for real funds.
//   - Activity is classified with the same logic as the History page
//     (txUtils.tsx), so both pages label a transaction the same way.
//   - The net-worth chart and the 7-day change are built from daily
//     snapshots this browser records each time the dashboard is opened
//     (there is no historical balance API). Until enough days have
//     accumulated they say "Not enough history" instead of drawing
//     anything.
interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; cirbtc: string | null; native: string | null };
  provider?: EIP1193Provider;
  onNavigate?: (tab: string) => void;
}

type Snap = { date: string; value: number };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function money(n: number, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function Donut({ segments, size = 132, thickness = 14, children }: { segments: { value: number; color: string }[]; size?: number; thickness?: number; children?: ReactNode }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1EEFF" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${Math.max(len - (segments.length > 1 ? 2 : 0), 0)} ${c}`} strokeDashoffset={-offset} strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 160, h = 44, pad = 3;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [pad + (i / (points.length - 1)) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)]);
  const line = xy.map((p) => p.join(",")).join(" ");
  const area = `${pad},${h} ${line} ${w - pad},${h}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="ffspark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6D5EF7" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#6D5EF7" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#ffspark)" />
      <polyline points={line} fill="none" stroke="#6D5EF7" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const card = { background: "#ffffff", border: "1px solid #E4DDFB", borderRadius: 20, boxShadow: "0 8px 30px -14px rgba(109,94,247,0.2)" } as const;
const kpiLabel = { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#6B7280", fontWeight: 600 } as const;
const bigNum = { fontSize: 28, fontWeight: 800, color: "#111827", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px" } as const;

export default function DashboardMainnet({ address, balances, provider, onNavigate }: Props) {
  const isMobile = useIsMobile();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [txCount, setTxCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [diamond, setDiamond] = useState<string | null>(null);
  const [series, setSeries] = useState<Snap[]>([]);
  const [btcUsd, setBtcUsd] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLifiDiamond().then((d) => { if (!cancelled) setDiamond(d); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/arcscan-proxy?network=mainnet&module=account&action=txlist&address=${address}&limit=100`);
        const data = await res.json();
        const raw = data.result ?? [];
        setTxCount(raw.length);
        setTxs(raw.slice(0, 20).map(toTx));
        setUpdatedAt(Date.now());
      } catch {
        setTxCount(null);
        setTxs([]);
      } finally {
        setLoading(false);
      }
    }
    if (address) load();
  }, [address, reloadKey]);

  useEffect(() => {
    fetch("/api/coingecko-proxy?path=" + encodeURIComponent("/simple/price?ids=bitcoin&vs_currencies=usd"))
      .then((r) => r.json())
      .then((d) => setBtcUsd(d?.bitcoin?.usd ?? null))
      .catch(() => setBtcUsd(null));
  }, []);

  const usdcVal = Number(balances.usdc ?? 0);
  const eurcVal = Number(balances.eurc ?? 0);
  const usycVal = Number(balances.usyc ?? 0);
  const cirbtcAmt = Number(balances.cirbtc ?? 0);
  const cirbtcVal = btcUsd !== null ? cirbtcAmt * btcUsd : 0;
  // Arc's native (gas) balance and the ERC-20 USDC balance are the SAME
  // underlying USDC shown two ways, not separate money -- confirmed live
  // (both read 5.11 for the same address). Only usdcVal (ERC-20) counts
  // toward net worth; balances.native is kept around for display only.
  const total = usdcVal + eurcVal + usycVal + cirbtcVal;

  // Daily snapshots of net worth, recorded in this browser (no historical balance API exists).
  const seriesKey = `flowfi-portfolio-series-mainnet-${address}`;
  useEffect(() => {
    if (!address) return;
    let saved: Snap[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(seriesKey) ?? "[]");
      if (Array.isArray(parsed)) saved = parsed.filter((p) => p && typeof p.date === "string" && typeof p.value === "number");
    } catch { /* ignore */ }
    if (total > 0) {
      const today = todayKey();
      const last = saved[saved.length - 1];
      if (last && last.date === today) last.value = total;
      else saved.push({ date: today, value: total });
      saved = saved.slice(-60);
      try { localStorage.setItem(seriesKey, JSON.stringify(saved)); } catch { /* ignore */ }
    }
    setSeries(saved);
  }, [address, total]);

  const chartPoints = series.slice(-30).map((p) => p.value);
  const hasChart = chartPoints.length >= 2;
  // "7-day change" compares against the newest snapshot that is at least 7 days old. It is a balance
  // change, so deposits and withdrawals count too, not only price movement.
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const ref = [...series].reverse().find((p) => p.date <= cutoff);
  const change = ref && ref.value > 0 && total > 0 ? { abs: total - ref.value, pct: ((total - ref.value) / ref.value) * 100 } : null;

  const distribution = [
    { label: "USDC", value: usdcVal, color: "#3B82F6" },
    { label: "EURC", value: eurcVal, color: "#22C55E" },
    { label: "USYC", value: usycVal, color: "#F59E0B" },
    { label: "cirBTC", value: cirbtcVal, color: "#C2410C" },
  ].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const top = distribution[0];
  const topPct = top && total > 0 ? (top.value / total) * 100 : 0;

  // Activity mix: last 20 transactions, labelled the same way as the History page.
  const mixCounts: Record<string, { count: number; color: string }> = {};
  for (const tx of txs) {
    const m = metaFor(tx, address, diamond);
    mixCounts[m.label] = { count: (mixCounts[m.label]?.count ?? 0) + 1, color: m.color };
  }
  const mix = Object.entries(mixCounts).map(([label, v]) => ({ label, value: v.count, color: v.color, pct: (v.count / (txs.length || 1)) * 100 })).sort((a, b) => b.value - a.value);

  let incoming = 0, sent = 0;
  for (const tx of txs) {
    const label = metaFor(tx, address, diamond).label;
    if (label === "Receive") incoming++;
    if (label === "Send") sent++;
  }

  const recent = txs.slice(0, 6);
  const updatedText = updatedAt === null ? "—" : Math.floor((Date.now() - updatedAt) / 60000) < 1 ? "just now" : `${Math.floor((Date.now() - updatedAt) / 60000)}m ago`;

  const assetChip = (sym: string | null) => {
    if (!sym) return <span style={{ color: "#9CA3AF" }}>—</span>;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 700, color: "#111827" }}>
        {sym === "USDC"
          ? <img src={USDC_LOGO} alt="" width={20} height={20} style={{ width: 20, height: 20, borderRadius: "50%" }} />
          : <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#EDE9FE", color: "#6D5EF7", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{sym.slice(0, 1)}</span>}
        {sym}
      </span>
    );
  };

  const TABLE_GRID = "112px 110px 120px minmax(150px, 1fr) 84px 60px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <NetworkGuard provider={provider} />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1.25fr 1fr 1fr 1fr", gap: "0.75rem" }}>
        <div style={{ ...card, padding: "1.1rem 1.2rem", gridColumn: isMobile ? "1 / -1" : undefined }}>
          <div style={kpiLabel}>Net worth</div>
          <div className="flowfi-mono" style={{ ...bigNum, fontSize: 32, marginTop: 6 }}>${money(total)}</div>
          <div style={{ marginTop: 8, minHeight: 44 }}>
            {hasChart ? <Sparkline points={chartPoints} /> : <div style={{ fontSize: 11.5, color: "#9CA3AF", paddingTop: 10 }}>Chart builds as you visit. Not enough history yet.</div>}
          </div>
          {hasChart && <div style={{ fontSize: 10.5, color: "#9CA3AF", textAlign: "right", marginTop: 2 }}>{chartPoints.length} days</div>}
        </div>

        <div style={{ ...card, padding: "1.1rem 1.2rem" }}>
          <div style={kpiLabel}>Available USDC</div>
          <div className="flowfi-mono" style={{ ...bigNum, marginTop: 6 }}>{balances.usdc ?? "…"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, fontWeight: 700, color: "#374151" }}>
            <img src={USDC_LOGO} alt="" width={26} height={26} style={{ width: 26, height: 26, borderRadius: "50%" }} /> USDC
          </div>
        </div>

        <div style={{ ...card, padding: "1.1rem 1.2rem" }}>
          <div style={kpiLabel}>Available cirBTC</div>
          <div className="flowfi-mono" style={{ ...bigNum, marginTop: 6 }}>{balances.cirbtc === null ? "…" : cirbtcAmt > 0 ? balances.cirbtc : "—"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, fontWeight: 700, color: "#374151" }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#F7931A", color: "#fff", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>₿</span> cirBTC
          </div>
        </div>

        <div style={{ ...card, padding: "1.1rem 1.2rem", gridColumn: isMobile ? "1 / -1" : undefined }}>
          <div style={kpiLabel}>7-day change</div>
          {change ? (
            <>
              <div className="flowfi-mono" style={{ ...bigNum, marginTop: 6, color: change.abs >= 0 ? "#15803D" : "#DC2626" }}>
                {change.abs >= 0 ? "+" : "−"}${money(Math.abs(change.abs))}
              </div>
              <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: change.abs >= 0 ? "#15803D" : "#DC2626" }}>
                {change.abs >= 0 ? "▲" : "▼"} {Math.abs(change.pct).toFixed(1)}%
              </div>
            </>
          ) : (
            <>
              <div className="flowfi-mono" style={{ ...bigNum, marginTop: 6, color: "#9CA3AF" }}>—</div>
              <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: "#B45309" }}>Not enough history</div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ ...card, padding: "1.2rem" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", marginBottom: 14 }}>Portfolio</div>
          {total === 0 ? (
            <EmptyState icon="💰" title="No balances yet" subtitle="Bridge USDC to Arc or buy with a card to get started" />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <Donut segments={distribution.map((d) => ({ value: d.value, color: d.color }))}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#111827", fontVariantNumeric: "tabular-nums" }}>{Math.round(topPct)}%</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280" }}>{top?.label}</div>
                </Donut>
                <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 10 }}>
                  {distribution.map((d) => (
                    <div key={d.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#374151", fontWeight: 600 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: d.color }} />{d.label}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        <span style={{ display: "block", fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums" }}>${money(d.value)}</span>
                        <span style={{ display: "block", fontSize: 11, color: "#9CA3AF", fontVariantNumeric: "tabular-nums" }}>{((d.value / total) * 100).toFixed(1)}%</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #F1EEFF", fontSize: 12, color: "#6B7280" }}>
                {distribution.length === 1 || topPct >= 80 ? `Concentrated in ${top?.label}` : `Spread across ${distribution.length} assets`}
              </div>
            </>
          )}
        </div>

        <div style={{ ...card, padding: "1.2rem" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", marginBottom: 14 }}>Activity mix</div>
          {mix.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#9CA3AF", padding: "1.5rem 0" }}>{loading ? "Loading..." : "No transactions yet."}</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <Donut segments={mix.map((m) => ({ value: m.value, color: m.color }))}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#111827", fontVariantNumeric: "tabular-nums" }}>{txs.length}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280" }}>recent tx</div>
                </Donut>
                <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 10 }}>
                  {mix.map((m) => (
                    <div key={m.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#374151", fontWeight: 600 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.color }} />{m.label}
                      </span>
                      <span style={{ fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums" }}>{m.pct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #F1EEFF", fontSize: 12, color: "#6B7280" }}>
                Based on your last {txs.length} transactions.
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "1rem 1.2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>Recent activity</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0D9488" }}>{loading ? "…" : incoming} incoming</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#16A34A" }}>{loading ? "…" : sent} sent</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#D97706" }}>{loading ? "…" : txCount === null ? "—" : txCount >= 100 ? "100+" : txCount} all-time tx</span>
          </div>
          {onNavigate && (
            <button onClick={() => onNavigate("mainnethistory")}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#6D5EF7", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              View all activity <ArrowRight size={15} />
            </button>
          )}
        </div>

        {loading && <div style={{ fontSize: 12.5, color: "#6B7280", padding: "0 1.2rem 1.2rem" }}>Loading...</div>}
        {!loading && recent.length === 0 && <div style={{ padding: "0 1.2rem 1.2rem" }}><EmptyState icon="📭" title="No transactions yet" subtitle="Your recent activity will show up here" /></div>}

        {recent.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 640 }}>
              <div style={{ display: "grid", gridTemplateColumns: TABLE_GRID, gap: 10, padding: "0.6rem 1.2rem", background: "#F8F7FF", borderTop: "1px solid #E4DDFB", borderBottom: "1px solid #E4DDFB", fontSize: 10.5, color: "#6B7280", fontWeight: 800, letterSpacing: "0.6px" }}>
                <span>TYPE</span><span>ASSET</span><span style={{ textAlign: "right" }}>AMOUNT</span><span>FROM / TO</span><span>TIME</span><span style={{ textAlign: "right" }}>TX</span>
              </div>
              {recent.map((tx) => {
                const meta = metaFor(tx, address, diamond);
                const amt = amountCell(tx, address);
                return (
                  <div key={tx.hash} style={{ display: "grid", gridTemplateColumns: TABLE_GRID, gap: 10, alignItems: "center", padding: "0.7rem 1.2rem", borderBottom: "1px solid #F5F3FF", fontSize: 13 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, color: meta.color, background: `${meta.color}1a`, border: `1px solid ${meta.color}33`, padding: "4px 10px", borderRadius: 8, width: "fit-content" }}>
                      {TYPE_ICON[meta.label]}{meta.label}
                    </span>
                    {assetChip(assetOf(tx))}
                    <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, 'JetBrains Mono', monospace", color: amt ? (amt.tone === "in" ? "#15803D" : "#111827") : "#9CA3AF" }}>{amt ? amt.text.replace(/ [A-Z]+$/, "") : "—"}</span>
                    <span style={{ color: "#6B7280", fontFamily: "ui-monospace, 'JetBrains Mono', monospace", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{counterpartOf(tx, address)}</span>
                    <span style={{ color: "#6B7280", fontSize: 12 }}>{tx.age}</span>
                    <a href={`https://arc.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" title={shortHash(tx.hash)}
                      style={{ display: "flex", justifyContent: "flex-end", color: "#4B5563" }}><ExternalLink size={15} /></a>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "0.75rem 1.2rem", background: "#FBFAFF", borderTop: recent.length > 0 ? "none" : "1px solid #E4DDFB", fontSize: 12, color: "#6B7280" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><ShieldCheck size={14} color="#6D5EF7" /> All data sourced from Arc Mainnet explorer</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Last updated: {updatedText}
            <button onClick={() => setReloadKey((k) => k + 1)} title="Refresh" style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2, color: "#6D5EF7" }}><RefreshCw size={14} /></button>
          </span>
        </div>
      </div>
    </div>
  );
}
