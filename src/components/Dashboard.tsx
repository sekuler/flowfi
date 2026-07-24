import { useState, useEffect } from "react";

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onNavigate: (tab: "swap" | "bridge" | "send" | "perps") => void;
}

interface ActivityItem {
  hash: string;
  age: string;
  amount: string;
  category: "income" | "expense" | "bridge" | "other";
}

const METHOD_CATEGORY: Record<string, "income" | "expense" | "bridge" | "other"> = {
  "0xa9059cbb": "expense", // transfer (outgoing from user's perspective when they call it)
  "0x095ea7b3": "other",   // approve
  "0x74b30078": "other",   // swap
  "0x9cd441da": "other",   // swap
  "0xe334e8dd": "other",   // escrow
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

function loadSnapshot(key: string): { date: string; value: number } | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSnapshot(key: string, date: string, value: number) {
  try {
    localStorage.setItem(key, JSON.stringify({ date, value }));
  } catch {
    /* ignore */
  }
}

function loadWeekSnapshot(address: string): { weekStart: string; value: number } | null {
  try {
    const raw = localStorage.getItem(`flowfi-portfolio-week-${address}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Dashboard({ address, balances, onNavigate }: Props) {
  const [txCount, setTxCount] = useState<number | null>(null);
  const [incomingCount, setIncomingCount] = useState(0);
  const [outgoingCount, setOutgoingCount] = useState(0);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyChange, setDailyChange] = useState<{ pct: number; hasData: boolean }>({ pct: 0, hasData: false });
  const [weeklyChange, setWeeklyChange] = useState<{ pct: number; hasData: boolean }>({ pct: 0, hasData: false });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=100`);
        const data = await res.json();
        const txs = data.result ?? [];
        setTxCount(txs.length);

        let inCount = 0, outCount = 0;
        const activity: ActivityItem[] = txs.slice(0, 20).map((tx: any) => {
          const isIncoming = tx.to?.toLowerCase() === address.toLowerCase() && tx.from?.toLowerCase() !== address.toLowerCase();
          const isOutgoing = tx.from?.toLowerCase() === address.toLowerCase();
          let category: ActivityItem["category"] = METHOD_CATEGORY[tx.methodId] ?? "other";
          if (category === "expense" && isIncoming) category = "income";
          if (isIncoming) inCount++;
          if (isOutgoing && tx.methodId === "0xa9059cbb") outCount++;

          let amount = "";
          if (tx.methodId === "0xa9059cbb" && tx.input && tx.input.length >= 138) {
            const amountHex = tx.input.slice(-64);
            const val = parseInt(amountHex, 16) / 1e6;
            if (!isNaN(val) && val < 1e9) amount = val.toFixed(2);
          }

          return {
            hash: tx.hash,
            age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
            amount,
            category,
          };
        });
        setIncomingCount(inCount);
        setOutgoingCount(outCount);
        setRecentActivity(activity.slice(0, 6));
      } catch {
        setTxCount(null);
        setRecentActivity([]);
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

  // Track daily + weekly portfolio snapshots in localStorage — real data, accumulates from today onward.
  useEffect(() => {
    if (!address || total === 0) return;
    const today = todayKey();
    const dayKey = `flowfi-portfolio-snapshot-${address}`;
    const snap = loadSnapshot(dayKey);
    if (!snap) {
      saveSnapshot(dayKey, today, total);
      setDailyChange({ pct: 0, hasData: false });
    } else if (snap.date === today) {
      setDailyChange({ pct: 0, hasData: false });
    } else {
      const pct = snap.value > 0 ? ((total - snap.value) / snap.value) * 100 : 0;
      setDailyChange({ pct, hasData: true });
      saveSnapshot(dayKey, today, total);
    }

    // Weekly snapshot: store a value once per calendar week (ISO week start = Monday)
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    const weekKey = monday.toISOString().slice(0, 10);

    const weekSnap = loadWeekSnapshot(address);
    if (!weekSnap) {
      localStorage.setItem(`flowfi-portfolio-week-${address}`, JSON.stringify({ weekStart: weekKey, value: total }));
      setWeeklyChange({ pct: 0, hasData: false });
    } else if (weekSnap.weekStart === weekKey) {
      const pct = weekSnap.value > 0 ? ((total - weekSnap.value) / weekSnap.value) * 100 : 0;
      setWeeklyChange({ pct, hasData: weekSnap.value !== total });
    } else {
      localStorage.setItem(`flowfi-portfolio-week-${address}`, JSON.stringify({ weekStart: weekKey, value: total }));
      setWeeklyChange({ pct: 0, hasData: false });
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

  const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
    income: { label: "Income", color: "#6ee7b7", bg: "rgba(16,185,129,0.1)" },
    expense: { label: "Sent", color: "#fca5a5", bg: "rgba(239,68,68,0.1)" },
    bridge: { label: "Bridge", color: "#93c5fd", bg: "rgba(59,130,246,0.1)" },
    other: { label: "Activity", color: "#c4b5fd", bg: "rgba(139,92,246,0.1)" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Hero: net worth */}
      <div style={{ background: "linear-gradient(135deg, rgba(79,70,229,0.12), rgba(124,58,237,0.08))", border: "1px solid rgba(79,70,229,0.25)", borderRadius: 18, padding: "1.75rem" }}>
        <div style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 8 }}>NET WORTH</div>
        <div style={{ fontSize: 42, fontWeight: 800, color: "#f8fafc", marginBottom: 8 }}>${total.toFixed(2)}</div>

        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, color: "#818cf8" }}>Today</span>
            {dailyChange.hasData ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: dailyChange.pct >= 0 ? "#6ee7b7" : "#fca5a5" }}>
                {dailyChange.pct >= 0 ? "▲" : "▼"} {Math.abs(dailyChange.pct).toFixed(1)}%
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#475569" }}>tracking...</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, color: "#818cf8" }}>This Week</span>
            {weeklyChange.hasData ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: weeklyChange.pct >= 0 ? "#6ee7b7" : "#fca5a5" }}>
                {weeklyChange.pct >= 0 ? "▲" : "▼"} {Math.abs(weeklyChange.pct).toFixed(1)}%
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#475569" }}>tracking...</span>
            )}
          </div>
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

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        {quickActions.map((a) => (
          <button key={a.key} onClick={() => onNavigate(a.key)}
            style={{ background: `${a.color}14`, border: `1px solid ${a.color}30`, borderRadius: 14, padding: "1.1rem 0.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: `${a.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: a.color }}>{a.emoji}</div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9" }}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* Portfolio allocation */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.25rem" }}>
        <div style={{ fontSize: 11, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>PORTFOLIO ALLOCATION</div>
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
                  <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{((d.value / total) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Activity stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 14, padding: "1rem 1.1rem" }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#6ee7b7" }}>{loading ? "..." : incomingCount}</div>
          <div style={{ fontSize: 11, color: "#475569" }}>Incoming (recent)</div>
        </div>
        <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 14, padding: "1rem 1.1rem" }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#fca5a5" }}>{loading ? "..." : outgoingCount}</div>
          <div style={{ fontSize: 11, color: "#475569" }}>Sent (recent)</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1rem 1.1rem" }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#f1f5f9" }}>{loading ? "..." : txCount ?? 0}</div>
          <div style={{ fontSize: 11, color: "#475569" }}>All-time transactions</div>
        </div>
      </div>

      {/* Recent activity, categorized */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.25rem" }}>
        <div style={{ fontSize: 11, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>RECENT ACTIVITY</div>
        {loading && <div style={{ fontSize: 12, color: "#334155" }}>Loading...</div>}
        {!loading && recentActivity.length === 0 && <div style={{ fontSize: 12, color: "#334155" }}>No transactions yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {recentActivity.map((tx) => {
            const meta = CATEGORY_META[tx.category];
            return (
              <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.8rem", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 8px", borderRadius: 6 }}>{meta.label}</span>
                  {tx.amount && <span style={{ fontSize: 12, color: "#94a3b8" }}>${tx.amount}</span>}
                </div>
                <span style={{ fontSize: 11, color: "#334155" }}>{tx.age}</span>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
