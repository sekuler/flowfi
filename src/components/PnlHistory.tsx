interface ClosedTrade {
  id: number;
  market: string;
  isLong: boolean;
  pnl: number;
  status: number;
}

interface Props {
  trades: ClosedTrade[];
}

export default function PnlHistory({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "#334155", textAlign: "center", padding: "1.5rem" }}>
        No closed trades yet. Your PNL history will appear here.
      </div>
    );
  }

  let running = 0;
  const points = trades.map((t) => {
    running += t.pnl;
    return running;
  });
  const max = Math.max(...points, 0);
  const min = Math.min(...points, 0);
  const range = max - min || 1;

  const width = 100;
  const height = 40;
  const stepX = trades.length > 1 ? width / (trades.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = trades.length > 1 ? i * stepX : width / 2;
    const y = height - ((p - min) / range) * height;
    return `${x},${y}`;
  });

  const pathD = "M " + coords.join(" L ");
  const finalPnl = points[points.length - 1];
  const wins = trades.filter(t => t.pnl > 0).length;
  const winRate = ((wins / trades.length) * 100).toFixed(0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.7rem" }}>
          <div style={{ fontSize: 10, color: "#334155", marginBottom: 3 }}>CUMULATIVE PNL</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: finalPnl >= 0 ? "#6ee7b7" : "#fca5a5" }}>
            {finalPnl >= 0 ? "+" : ""}${finalPnl.toFixed(2)}
          </div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.7rem" }}>
          <div style={{ fontSize: 10, color: "#334155", marginBottom: 3 }}>WIN RATE</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{winRate}%</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.7rem" }}>
          <div style={{ fontSize: 10, color: "#334155", marginBottom: 3 }}>CLOSED TRADES</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{trades.length}</div>
        </div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "1rem" }}>
        <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 8 }}>PNL OVER TIME</div>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 100, overflow: "visible" }} preserveAspectRatio="none">
          <line x1="0" y1={height - ((0 - min) / range) * height} x2={width} y2={height - ((0 - min) / range) * height}
            stroke="#334155" strokeWidth="0.3" strokeDasharray="1,1" />
          <path d={pathD} fill="none" stroke={finalPnl >= 0 ? "#10b981" : "#ef4444"} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {coords.map((c, i) => {
            const [x, y] = c.split(",");
            return <circle key={i} cx={x} cy={y} r="0.8" fill={finalPnl >= 0 ? "#10b981" : "#ef4444"} />;
          })}
        </svg>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {trades.slice().reverse().map((t) => (
          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.8rem", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: t.isLong ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: t.isLong ? "#6ee7b7" : "#fca5a5" }}>
                {t.isLong ? "LONG" : "SHORT"}
              </span>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{t.market}-PERP</span>
              {t.status === 2 && <span style={{ fontSize: 10, color: "#ef4444" }}>Liquidated</span>}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: t.pnl >= 0 ? "#6ee7b7" : "#fca5a5" }}>
              {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}