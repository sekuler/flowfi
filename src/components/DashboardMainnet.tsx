import { useState, useEffect, type ReactNode } from "react";
import type { EIP1193Provider } from "viem";
import { ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import EmptyState from "./EmptyState";
import NetworkGuard from "./NetworkGuard";
import { useIsMobile } from "../useIsMobile";
import { USDC_LOGO, EURC_LOGO } from "./tokenLogos";
import { loadLifiDiamond, metaFor, amountCell, assetOf, counterpartOf, fetchActivity, type Tx } from "./txUtils";
import { T, glass, glassRow, pill } from "./mainnetTheme";
import Sparkline from "./Sparkline";
import { usePortfolio, money, type MainnetBalances } from "./usePortfolio";

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
  balances: MainnetBalances;
  provider?: EIP1193Provider;
  onNavigate?: (tab: string) => void;
}

function Donut({ segments, size = 172, thickness = 22, children }: { segments: { value: number; color: string }[]; size?: number; thickness?: number; children?: ReactNode }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const glow = segments.slice().sort((a, b) => b.value - a.value)[0]?.color ?? T.blue;
  // Each segment starts where the previous ones end (precomputed, not mutated during render).
  const lens = segments.map((s) => (s.value / total) * c);
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0, filter: `drop-shadow(0 8px 16px ${glow}40)` }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(61,90,241,0.08)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = lens[i];
          return (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${Math.max(len - (segments.length > 1 ? 3 : 0), 0)} ${c}`} strokeDashoffset={-offsets[i]} strokeLinecap="butt" />
          );
        })}
      </svg>
      <div style={{ position: "absolute", inset: thickness, borderRadius: "50%", background: "rgba(255,255,255,0.75)", boxShadow: "inset 0 2px 8px rgba(36,58,150,0.08)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
}

const card = glass;
const kpiLabel = { fontSize: 17, color: T.text, fontWeight: 500 } as const;
const bigNum = { fontFamily: T.display, fontSize: 42, fontWeight: 600, color: T.ink, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", lineHeight: 1.1 } as const;
const cardTitle = { fontSize: 21, fontWeight: 600, color: T.ink, letterSpacing: "-0.01em" } as const;

export default function DashboardMainnet({ address, balances, provider, onNavigate }: Props) {
  const isMobile = useIsMobile();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [txCount, setTxCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Clock for the "updated Xm ago" label, ticking every 30s so it keeps counting up on its own.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const [reloadKey, setReloadKey] = useState(0);
  const [diamond, setDiamond] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLifiDiamond().then((d) => { if (!cancelled) setDiamond(d); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const all = await fetchActivity(address, "mainnet", 100);
        setTxCount(all.length);
        setTxs(all.slice(0, 20));
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

  const { total, gross, debt, distribution, top, topPct, chartPoints, hasChart, change } = usePortfolio(address, balances);

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
  const agoMin = updatedAt === null ? 0 : Math.max(0, Math.floor((nowMs - updatedAt) / 60000));
  const updatedText = updatedAt === null ? "—" : agoMin < 1 ? "just now" : `${agoMin}m ago`;


  const kpiPad = isMobile ? "1.1rem 1.2rem" : "1.5rem 1.6rem";
  const tokenRow = (logo: string, sym: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, fontSize: 18, fontWeight: 500, color: T.text }}>
      <img src={logo} alt="" width={34} height={34} style={{ width: 34, height: 34, borderRadius: "50%", boxShadow: "0 4px 10px -4px rgba(39,117,202,0.55)" }} /> {sym}
    </div>
  );
  const up = !change || change.abs >= 0;
  const legendRow = (color: string, label: string, right: ReactNode) => (
    <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 17, color: T.text }}>
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: color, boxShadow: `0 0 0 3px ${color}22` }} />{label}
      </span>
      {right}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <NetworkGuard provider={provider} />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1.2fr 1fr 1fr 1fr", gap: "1rem" }}>
        <div style={{ ...card, padding: kpiPad, gridColumn: isMobile ? "1 / -1" : undefined, background: "linear-gradient(160deg, rgba(246,249,255,0.9) 0%, rgba(214,225,255,0.8) 100%)", border: "1.5px solid rgba(93,125,245,0.45)", boxShadow: "0 16px 36px -20px rgba(61,90,241,0.55), inset 0 1px 0 rgba(255,255,255,0.95)" }}>
          <div style={kpiLabel}>Net worth</div>
          <div style={{ ...bigNum, fontSize: 46, fontWeight: 700, marginTop: 10 }}>${money(total)}</div>
          <div style={{ marginTop: 10, minHeight: 60 }}>
            {hasChart ? <Sparkline points={chartPoints} height={64} color="#4F6BF6" /> : <div style={{ fontSize: 13, color: T.faint, paddingTop: 12 }}>Chart builds as you visit. Not enough history yet.</div>}
          </div>
        </div>

        <div style={{ ...card, padding: kpiPad }}>
          <div style={kpiLabel}>Available USDC</div>
          <div style={{ ...bigNum, marginTop: 10 }}>{balances.usdc ?? "…"}</div>
          {tokenRow(USDC_LOGO, "USDC")}
        </div>

        <div style={{ ...card, padding: kpiPad }}>
          <div style={kpiLabel}>Available EURC</div>
          <div style={{ ...bigNum, marginTop: 10 }}>{balances.eurc ?? "…"}</div>
          {tokenRow(EURC_LOGO, "EURC")}
        </div>

        <div style={{ ...card, padding: kpiPad, gridColumn: isMobile ? "1 / -1" : undefined, ...(change ? (up
          ? { background: "linear-gradient(160deg, rgba(246,252,248,0.9) 0%, rgba(214,244,226,0.85) 100%)", border: "1.5px solid rgba(34,197,94,0.35)", boxShadow: "0 16px 36px -20px rgba(22,163,74,0.5), inset 0 1px 0 rgba(255,255,255,0.95)" }
          : { background: "linear-gradient(160deg, rgba(255,248,248,0.9) 0%, rgba(252,224,224,0.85) 100%)", border: "1.5px solid rgba(220,38,38,0.3)" }) : {}) }}>
          <div style={kpiLabel}>7-day change</div>
          {change ? (
            <>
              <div style={{ ...bigNum, marginTop: 10, color: up ? "#15803D" : "#DC2626" }}>
                {up ? "+" : "−"}${money(Math.abs(change.abs))}
              </div>
              <div style={{ marginTop: 20, fontSize: 18, fontWeight: 600, color: up ? "#15803D" : "#DC2626" }}>
                {up ? "▲" : "▼"} {Math.abs(change.pct).toFixed(1)}%
              </div>
            </>
          ) : (
            <>
              <div style={{ ...bigNum, marginTop: 10, color: T.faint }}>—</div>
              <div style={{ marginTop: 20, fontSize: 15, fontWeight: 600, color: "#B45309" }}>Not enough history</div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "1rem" }}>
        <div style={{ ...card, padding: isMobile ? "1.2rem" : "1.6rem 1.75rem" }}>
          <div style={{ ...cardTitle, marginBottom: 18 }}>Portfolio</div>
          {total === 0 ? (
            <EmptyState icon="💰" title="No balances yet" subtitle="Bridge USDC to Arc or buy with a card to get started" />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
              <Donut segments={distribution.map((d) => ({ value: d.value, color: d.color }))}>
                <div style={{ fontFamily: T.display, fontSize: 34, fontWeight: 600, color: T.ink, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{Math.round(topPct)}%</div>
                <div style={{ fontSize: 16, color: T.muted, marginTop: 4 }}>{top?.label}</div>
              </Donut>
              <div style={{ flex: 1, minWidth: 170, display: "flex", flexDirection: "column", gap: 16 }}>
                {distribution.map((d) => legendRow(d.color, d.label, (
                  <span style={{ textAlign: "right" }}>
                    <span style={{ display: "block", fontSize: 17, fontWeight: 600, color: T.ink, fontVariantNumeric: "tabular-nums" }}>${money(d.value)}</span>
                    <span style={{ display: "block", fontSize: 13.5, color: T.faint, fontVariantNumeric: "tabular-nums" }}>{((d.value / gross) * 100).toFixed(1)}%</span>
                  </span>
                )))}
                {debt > 0 && legendRow("#DC2626", "Borrowed (Morpho)", (
                  <span style={{ textAlign: "right", fontSize: 17, fontWeight: 600, color: "#DC2626", fontVariantNumeric: "tabular-nums" }}>−${money(debt)}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ ...card, padding: isMobile ? "1.2rem" : "1.6rem 1.75rem" }}>
          <div style={{ ...cardTitle, marginBottom: 18 }}>Activity mix</div>
          {mix.length === 0 ? (
            <div style={{ fontSize: 14, color: T.faint, padding: "1.5rem 0" }}>{loading ? "Loading..." : "No transactions yet."}</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
              <Donut segments={mix.map((m) => ({ value: m.value, color: m.color }))}>
                <div style={{ fontFamily: T.display, fontSize: 34, fontWeight: 600, color: T.ink, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{txs.length}</div>
                <div style={{ fontSize: 15, color: T.muted, marginTop: 4 }}>recent tx</div>
              </Donut>
              <div style={{ flex: 1, minWidth: 170, display: "flex", flexDirection: "column", gap: 18 }}>
                {mix.map((m) => legendRow(m.color, m.label, (
                  <span style={{ fontSize: 17, fontWeight: 500, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{m.pct.toFixed(0)}%</span>
                )))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "0.5rem 0.4rem 0.25rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 22, flexWrap: "wrap" }}>
            <span style={{ fontSize: 25, fontWeight: 600, color: T.ink, letterSpacing: "-0.01em" }}>Recent activity</span>
            <span style={{ fontSize: 17, fontWeight: 500, color: "#16A34A" }}>{loading ? "…" : incoming} incoming</span>
            <span style={{ fontSize: 17, fontWeight: 500, color: T.muted }}>{loading ? "…" : sent} sent</span>
            <span style={{ fontSize: 17, fontWeight: 500, color: "#E07A10" }}>{loading ? "…" : txCount === null ? "—" : txCount >= 100 ? "100+" : txCount} all-time</span>
          </div>
          {onNavigate && (
            <button onClick={() => onNavigate("mainnethistory")}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: T.blue, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
              View all <ArrowRight size={16} />
            </button>
          )}
        </div>

        {loading && <div style={{ ...card, padding: "1.2rem", fontSize: 14, color: T.muted }}>Loading...</div>}
        {!loading && recent.length === 0 && <div style={{ ...card, padding: "1.2rem" }}><EmptyState icon="📭" title="No transactions yet" subtitle="Your recent activity will show up here" /></div>}

        {recent.map((tx) => {
          const meta = metaFor(tx, address, diamond);
          const amt = amountCell(tx, address);
          const sym = assetOf(tx);
          return (
            <a key={tx.hash} href={`https://arc.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="ffd-row"
              style={{ ...glassRow, display: "grid", gridTemplateColumns: isMobile ? "auto 1fr auto" : "130px 150px 150px minmax(0, 1fr) 90px", alignItems: "center", gap: 14, padding: isMobile ? "10px 14px" : "10px 22px", textDecoration: "none", color: T.ink }}>
              <span style={{ ...pill(meta.color), minWidth: 84, justifySelf: "start" }}>{meta.label}</span>
              {!isMobile && (
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17, color: T.text }}>
                  {sym === "USDC" || sym === "EURC"
                    ? <img src={sym === "USDC" ? USDC_LOGO : EURC_LOGO} alt="" width={28} height={28} style={{ width: 28, height: 28, borderRadius: "50%" }} />
                    : <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#E6EBFF", color: T.blue, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{(sym ?? "?").slice(0, 1)}</span>}
                  {sym ?? "—"}
                </span>
              )}
              <span style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: amt ? (amt.tone === "in" ? "#15803D" : T.ink) : T.faint, whiteSpace: "nowrap" }}>{amt ? amt.text : "—"}</span>
              {!isMobile && <span style={{ fontSize: 15, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: T.mono }}>{counterpartOf(tx, address)}</span>}
              <span style={{ fontSize: 15, color: T.muted, textAlign: "right", whiteSpace: "nowrap" }}>{tx.age}</span>
            </a>
          );
        })}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "0.4rem 0.5rem", fontSize: 13, color: T.muted }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><ShieldCheck size={15} color={T.blue} /> All data sourced from Arc Mainnet explorer</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Last updated: {updatedText}
            <button onClick={() => setReloadKey((k) => k + 1)} title="Refresh" style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2, color: T.blue }}><RefreshCw size={15} /></button>
          </span>
        </div>
      </div>
      <style>{`.ffd-row { transition: transform 0.15s ease, background 0.15s ease; } .ffd-row:hover { background: rgba(255,255,255,0.9) !important; transform: translateY(-1px); }`}</style>
    </div>
  );
}
