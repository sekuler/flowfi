import { useState, useEffect } from "react";
import EmptyState from "./EmptyState";

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onNavigate: (tab: "swap" | "bridge" | "send" | "perps") => void;
}

interface ActivityItem {
  hash: string;
  age: string;
  amount: string;
  category: "income" | "expense" | "bridge" | "swap" | "supply" | "withdraw" | "deposit" | "borrow" | "repay" | "position" | "pool" | "token" | "other";
}

const METHOD_CATEGORY: Record<string, "income" | "expense" | "bridge" | "swap" | "supply" | "withdraw" | "deposit" | "borrow" | "repay" | "position" | "pool" | "token" | "other"> = {
  "0xa9059cbb": "expense",  // transfer
  "0x095ea7b3": "other",    // approve
  "0x74b30078": "swap",     // swapUsdcToEurc
  "0x3eb4812c": "swap",     // swapEurcToUsdc
  "0x08c84c21": "swap",     // Pool V2 swap(bool,uint256,uint256)
  "0x9cd441da": "swap",     // legacy AMM swap variant
  "0x35403023": "supply",   // supply(uint256)
  "0x2e1a7d4d": "withdraw", // withdraw(uint256)
  "0xbad4a01f": "deposit",  // depositCollateral(uint256)
  "0xc5ebeaec": "borrow",   // borrow(uint256)
  "0x371fd8e6": "repay",    // repay(uint256)
  "0x5e1a7dde": "position", // openPosition(...)
  "0x2d6ce61d": "position", // closePosition(uint256,uint256)
  "0x884db063": "pool",     // createPool(...)
  "0x5b060530": "token",    // createToken(...)
  "0x6fd3504e": "bridge",   // depositForBurn (CCTP)
  "0xe334e8dd": "other",    // escrow
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
  const [activityBreakdown, setActivityBreakdown] = useState<{ label: string; pct: number; color: string }[]>([]);
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

        // Activity breakdown by type, using the fuller 20-tx sample rather
        // than just the 6 shown in "Recent Activity" — a more representative slice.
        const breakdownCounts: Record<string, number> = {};
        for (const tx of txs.slice(0, 20)) {
          let label = "Other";
          if (tx.methodId === "0x74b30078" || tx.methodId === "0x9cd441da") label = "Swap";
          else if (tx.methodId === "0x8e0250ee" || tx.methodId === "0x57ecfd28") label = "Bridge";
          else if (tx.methodId === "0xa9059cbb") label = "Send";
          else if (tx.methodId === "0x095ea7b3") label = "Approve";
          breakdownCounts[label] = (breakdownCounts[label] ?? 0) + 1;
        }
        const total20 = txs.slice(0, 20).length;
        const colors: Record<string, string> = { Swap: "#6D5EF7", Bridge: "#3B82F6", Send: "#22C55E", Approve: "#F59E0B", Other: "#9CA3AF" };
        const breakdown = Object.entries(breakdownCounts)
          .map(([label, count]) => ({ label, pct: total20 > 0 ? (count / total20) * 100 : 0, color: colors[label] ?? "#9CA3AF" }))
          .sort((a, b) => b.pct - a.pct);
        setActivityBreakdown(breakdown);
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
    { label: "USDC", value: usdcVal, color: "#3B82F6" },
    { label: "EURC", value: eurcVal, color: "#22C55E" },
    { label: "USYC", value: usycVal, color: "#F59E0B" },
  ].filter(d => d.value > 0);

  const quickActions = [
    { key: "swap" as const, label: "Swap", emoji: "⇄", color: "#6D5EF7" },
    { key: "bridge" as const, label: "Bridge", emoji: "⬡", color: "#3B82F6" },
    { key: "send" as const, label: "Send", emoji: "↗", color: "#22C55E" },
    { key: "perps" as const, label: "Trade", emoji: "▲", color: "#F43F5E" },
  ];

  const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
    income: { label: "Income", color: "#16A34A", bg: "rgba(34,197,94,0.1)" },
    expense: { label: "Sent", color: "#DC2626", bg: "rgba(239,68,68,0.1)" },
    bridge: { label: "Bridge", color: "#2563EB", bg: "rgba(59,130,246,0.1)" },
    swap: { label: "Swap", color: "#6D5EF7", bg: "rgba(109,94,247,0.1)" },
    supply: { label: "Supply", color: "#16A34A", bg: "rgba(34,197,94,0.1)" },
    withdraw: { label: "Withdraw", color: "#B45309", bg: "rgba(245,158,11,0.1)" },
    deposit: { label: "Deposit Collateral", color: "#16A34A", bg: "rgba(34,197,94,0.1)" },
    borrow: { label: "Borrow", color: "#DC2626", bg: "rgba(239,68,68,0.1)" },
    repay: { label: "Repay", color: "#16A34A", bg: "rgba(34,197,94,0.1)" },
    position: { label: "Perps", color: "#7C3AED", bg: "rgba(124,58,237,0.1)" },
    pool: { label: "Liquidity Pool", color: "#0EA5E9", bg: "rgba(14,165,233,0.1)" },
    token: { label: "Token Launch", color: "#DB2777", bg: "rgba(219,39,119,0.1)" },
    other: { label: "Activity", color: "#6D5EF7", bg: "rgba(109,94,247,0.1)" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Hero: net worth */}
      <div style={{ background: "linear-gradient(135deg, #F5F3FF, #EDE9FE)", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.75rem" }}>
        <div style={{ fontSize: 11, color: "#6D5EF7", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 8 }}>NET WORTH</div>
        <div className="flowfi-mono" style={{ fontSize: 42, fontWeight: 800, color: "#111827", marginBottom: 8 }}>${total.toFixed(2)}</div>

        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, color: "#5B21B6" }}>Today</span>
            {dailyChange.hasData ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: dailyChange.pct >= 0 ? "#16A34A" : "#DC2626" }}>
                {dailyChange.pct >= 0 ? "▲" : "▼"} {Math.abs(dailyChange.pct).toFixed(1)}%
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#6B7280" }}>tracking...</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, color: "#5B21B6" }}>This Week</span>
            {weeklyChange.hasData ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: weeklyChange.pct >= 0 ? "#16A34A" : "#DC2626" }}>
                {weeklyChange.pct >= 0 ? "▲" : "▼"} {Math.abs(weeklyChange.pct).toFixed(1)}%
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#6B7280" }}>tracking...</span>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: 10, color: "#3B82F6", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>AVAILABLE USDC</div>
            <div className="flowfi-mono" style={{ fontSize: 18, color: "#111827", fontWeight: 800 }}>{balances.usdc ?? "..."}</div>
          </div>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: 10, color: "#22C55E", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>AVAILABLE EURC</div>
            <div className="flowfi-mono" style={{ fontSize: 18, color: "#111827", fontWeight: 800 }}>{balances.eurc ?? "..."}</div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        {quickActions.map((a) => (
          <button key={a.key} onClick={() => onNavigate(a.key)}
            style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, padding: "1.1rem 0.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: `${a.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: a.color }}>{a.emoji}</div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* Portfolio allocation */}
      <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
        <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>PORTFOLIO ALLOCATION</div>
        {total === 0 ? (
          <EmptyState icon="💰" title="No balances yet" subtitle="Get free testnet USDC and EURC to get started" actionLabel="Get Testnet USDC" actionHref="https://faucet.circle.com" />
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
                    <span style={{ color: "#4B5563" }}>{d.label}</span>
                  </div>
                  <span style={{ color: "#111827", fontWeight: 700 }}>{((d.value / total) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Activity breakdown by transaction type */}
      {activityBreakdown.length > 0 && (
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>ACTIVITY BREAKDOWN</div>
          <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
            {activityBreakdown.map((b) => (
              <div key={b.label} style={{ width: `${b.pct}%`, background: b.color }} />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activityBreakdown.map((b) => (
              <div key={b.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: b.color }} />
                  <span style={{ color: "#4B5563" }}>{b.label}</span>
                </div>
                <span style={{ color: "#111827", fontWeight: 700 }}>{b.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 10, marginBottom: 0 }}>Based on your last {Math.min(20, txCount ?? 0)} transactions.</p>
        </div>
      )}

      {/* Activity stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, padding: "1rem 1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div className="flowfi-mono" style={{ fontSize: 19, fontWeight: 800, color: "#16A34A" }}>{loading ? "..." : incomingCount}</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Incoming (recent)</div>
        </div>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, padding: "1rem 1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div className="flowfi-mono" style={{ fontSize: 19, fontWeight: 800, color: "#DC2626" }}>{loading ? "..." : outgoingCount}</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Sent (recent)</div>
        </div>
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, padding: "1rem 1.1rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          <div className="flowfi-mono" style={{ fontSize: 19, fontWeight: 800, color: "#111827" }}>{loading ? "..." : txCount ?? 0}</div>
          <div style={{ fontSize: 11, color: "#6B7280" }}>All-time transactions</div>
        </div>
      </div>

      {/* Recent activity, categorized */}
      <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
        <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginBottom: 12 }}>RECENT ACTIVITY</div>
        {loading && <div style={{ fontSize: 12, color: "#6B7280" }}>Loading...</div>}
        {!loading && recentActivity.length === 0 && <EmptyState icon="📭" title="No transactions yet" subtitle="Your recent activity will show up here" />}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {recentActivity.map((tx) => {
            const meta = CATEGORY_META[tx.category];
            return (
              <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.8rem", borderRadius: 12, background: "#f5f3ff", textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 8px", borderRadius: 6 }}>{meta.label}</span>
                  {tx.amount && <span style={{ fontSize: 12, color: "#374151" }}>${tx.amount}</span>}
                </div>
                <span style={{ fontSize: 11, color: "#6B7280" }}>{tx.age}</span>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
