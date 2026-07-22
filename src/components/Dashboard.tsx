import { useState, useEffect } from "react";

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onNavigate: (tab: "swap" | "bridge" | "send" | "perps") => void;
}

interface Stats {
  txCount: number;
  weeklyVolume: number;
  weeklyTxCount: number;
}

interface RecentTx {
  hash: string;
  method: string;
  age: string;
  status: string;
}

const METHOD_LABELS: Record<string, string> = {
  "0xa9059cbb": "Send",
  "0x095ea7b3": "Approve",
  "0x74b30078": "Swap",
  "0x9cd441da": "Swap",
  "0xe334e8dd": "Escrow",
  "0x": "Contract Deploy",
};

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadSnapshot(address: string): { date: string; value: number } | null {
  try {
    const raw = localStorage.getItem(`flowfi-portfolio-snapshot-${address}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSnapshot(address: string, date: string, value: number) {
  try {
    localStorage.setItem(`flowfi-portfolio-snapshot-${address}`, JSON.stringify({ date, value }));
  } catch {
    /* ignore storage errors */
  }
}

export default function Dashboard({ address, balances, onNavigate }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyChange, setDailyChange] = useState<{ pct: number; hasData: boolean }>({ pct: 0, hasData: false });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=100`);
        const data = await res.json();
        const txs = data.result ?? [];
        const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
        const weeklyTxs = txs.filter((tx: any) => Number(tx.timeStamp) >= weekAgo);

        let weeklyVolume = 0;
        weeklyTxs.forEach((tx: any) => {
          if (tx.methodId === "0xa9059cbb" && tx.input && tx.input.length >= 138) {
            const amountHex = tx.input.slice(-64);
            const amount = parseInt(amountHex, 16) / 1e6;
            if (!isNaN(amount) && amount < 1e9) weeklyVolume += amount;
          }
        });

        setStats({ txCount: txs.length, weeklyVolume, weeklyTxCount: weeklyTxs.length });

        const recent: RecentTx[] = txs.slice(0, 6).map((tx: any) => ({
          hash: tx.hash,
          method: METHOD_LABELS[tx.methodId] ?? (tx.methodId === "0x" ? "Transfer" : "Transaction"),
          age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
          status: tx.txreceipt_status === "1" ? "ok" : "error",
        }));
        setRecentTxs(recent);
      } catch {
        setStats(null);
        setRecentTxs([]);
      } finally {
        setLoading(false);
      }
    }
    if (address) load();
  }, [address]);

  const usdcVal = Number(balances.usdc ?? 0);
  const eurcVal = Number(balances.eurc ?? 0);
  const usycVal = Number(balances.usyc ?? 0);
  const total = usdcVal + eurcVal + usycVal;

  useEffect(() => {
    if (!address || total === 0) return;
    const today = todayKey();
    const snap = loadSnapshot(address);
    if (!snap) {
      saveSnapshot(address, today, total);
      setDailyChange({ pct: 0, hasData: false });
    } else if (snap.date === today) {
      setDailyChange({ pct: 0, hasData: false });
    } else {
      const pct = snap.value > 0 ? ((total - snap.value) / snap.value) * 100 : 0;
      setDailyChange({ pct, hasData: true });
      saveSnapshot(address, today, total);
    }
  }, [address, total]);

  const distribution = [
    { label: "USDC", value: usdcVal, color: "#2563eb" },
    { label: "EURC", value: eurcVal, color: "#7c3aed" },
    { label: "USYC", value: usycVal, color: "#f59e0b" },
  ].filter(d => d.value > 0);

  const quickActions = [
    { key: "swap" as const, label: "Swap", emoji: "⇄", color: "#8b5cf6" },
    { key: "bridge" as const, label: "Bridge", emoji: "⬡", color: "#3b82f6" },
    { key: "send" as const, label: "Send", emoji: "↗", color: "#10b981" },
    { key: "perps" as const, label: "Trade", emoji: "▲", color: "#f43f5e" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "linear-gradient(135deg, rgba(79,70,229,0.12), rgba(124,58,237,0.08))", border: "1px solid rgba(79,70,229,0.25)", borderRadius: 18, padding: "1.75rem" }}>
        <div style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 8 }}>PORTFOLIO</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 42, fontWeight: 800, color: "#f8fafc" }}>${total.toFixed(2)}</div>
          {dailyChange.hasData && (
            <div style={{ fontSize: 14, fontWeight: 700, color: dailyChange.pct >= 0 ? "#6ee7b7" : "#fca5a5" }}>
              {dailyChange.pct >= 0 ? "▲" : "▼"} {Math.abs(dailyChange.pct).toFixed(1)}%
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#818cf8", marginTop: 4 }}>
          {dailyChange.hasData ? "vs. yesterday" : "Tracking starts today — check back tomorrow for daily change"}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: 10, color: "#93c5fd", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>AVAILABLE USDC</div>
            <div style={{ fontSize: 18, color: "#f1f5f9", fontWeight: 800 }}>{balances.usdc ?? "..."}</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: 10, color: "#c4b5fd", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>AVAILABLE EURC</div>
            <div style={{ fontSize: 18, color: "#f1f5f9", fontWeight: 800 }}>{balances.eurc ?? "..."}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        {quickActions.map((a) => (
          <button key={a.key} onClick={() => onNavigate(a.key)}
            style={{ background: `${a.color}14`, border: `1px solid ${a.color}30`, borderRadius: 14, padding: "1.1rem 0.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: `${a.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: a.color }}>{a.emoji}</div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9" }}>{a.label}</span>
          </button>
        ))}
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.25rem" }}>
        <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 12 }}>TOKEN DISTRIBUTION</div>
        {total === 0 ? (
          <div style={{ fontSize: 12, color: "#334155" }}>No balances yet.</div>
        ) : (
          <>
            <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
              {distribution.map((d) => (
                <div key={d.label} style={{ width: `${(d.value / total) * 100}%`, background: d.color }} />
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {distribution.map((d) => (
                <div key={d.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color }} />
                    <span style={{ color: "#94a3b8" }}>{d.label}</span>
                  </div>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{((d.value / total) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1rem 1.25rem" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9" }}>{loading ? "..." : (stats?.weeklyVolume ?? 0).toFixed(2)}</div>
          <div style={{ fontSize: 11, color: "#475569" }}>Sent this week</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1rem 1.25rem" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9" }}>{loading ? "..." : stats?.txCount ?? 0}</div>
          <div style={{ fontSize: 11, color: "#475569" }}>All-time transactions</div>
        </div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.25rem" }}>
        <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 12 }}>RECENT TRANSACTIONS</div>
        {loading && <div style={{ fontSize: 12, color: "#334155" }}>Loading...</div>}
        {!loading && recentTxs.length === 0 && <div style={{ fontSize: 12, color: "#334155" }}>No transactions yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {recentTxs.map((tx) => (
            <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.8rem", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: tx.status === "ok" ? "#10b981" : "#ef4444" }} />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{tx.method}</span>
              </div>
              <span style={{ fontSize: 11, color: "#334155" }}>{tx.age}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}