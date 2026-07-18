import { useState, useEffect } from "react";

interface Props {
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
}

interface Stats {
  txCount: number;
  weeklyVolume: number;
  weeklyTxCount: number;
}

export default function Dashboard({ address, balances }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

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

        setStats({
          txCount: txs.length,
          weeklyVolume,
          weeklyTxCount: weeklyTxs.length,
        });
      } catch {
        setStats(null);
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

  const distribution = [
    { label: "USDC", value: usdcVal, color: "#2563eb" },
    { label: "EURC", value: eurcVal, color: "#7c3aed" },
    { label: "USYC", value: usycVal, color: "#f59e0b" },
  ].filter(d => d.value > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "rgba(79,70,229,0.06)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 14, padding: "1.25rem" }}>
          <div style={{ fontSize: 11, color: "#818cf8", fontWeight: 600, letterSpacing: "1px", marginBottom: 8 }}>TOTAL PORTFOLIO</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#a5b4fc" }}>{total.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>Combined stablecoin value</div>
        </div>
        <div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: "1.25rem" }}>
          <div style={{ fontSize: 11, color: "#6ee7b7", fontWeight: 600, letterSpacing: "1px", marginBottom: 8 }}>TOTAL TRANSACTIONS</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#6ee7b7" }}>{loading ? "..." : stats?.txCount ?? 0}</div>
          <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>All-time on Arc Testnet</div>
        </div>
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

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1.25rem" }}>
        <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 12 }}>LAST 7 DAYS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9" }}>{loading ? "..." : (stats?.weeklyVolume ?? 0).toFixed(2)}</div>
            <div style={{ fontSize: 11, color: "#475569" }}>Volume sent</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9" }}>{loading ? "..." : stats?.weeklyTxCount ?? 0}</div>
            <div style={{ fontSize: 11, color: "#475569" }}>Transactions</div>
          </div>
        </div>
      </div>
    </div>
  );
}