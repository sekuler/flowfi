// Small area chart for a series of numbers. Callers only render it when there are at least 2 real points.
export default function Sparkline({ points, height = 44 }: { points: number[]; height?: number }) {
  const w = 160, h = height, pad = 3;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [pad + (i / (points.length - 1)) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)]);
  const line = xy.map((p) => p.join(",")).join(" ");
  const area = `${pad},${h} ${line} ${w - pad},${h}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="ffspark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4F6BF6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#4F6BF6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#ffspark)" />
      <polyline points={line} fill="none" stroke="#4F6BF6" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
