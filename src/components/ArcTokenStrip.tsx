import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export interface ArcToken { address: string; symbol: string; logoURI?: string; }

// Tokens that exist on Arc, from LI.FI's public token list (the app already talks to li.quest).
// Looked up once per chain and cached. This is a list of what's available on Arc, not a popularity ranking.
const cache = new Map<number, Promise<ArcToken[]>>();
function loadArcTokens(chainId: number): Promise<ArcToken[]> {
  let p = cache.get(chainId);
  if (!p) {
    p = fetch(`https://li.quest/v1/tokens?chains=${chainId}`)
      .then((r) => r.json())
      .then((d) => {
        const raw: ArcToken[] = d?.tokens?.[chainId] ?? d?.tokens?.[String(chainId)] ?? [];
        const seen = new Set<string>();
        const list = raw.filter((t) => {
          if (!t?.symbol || !t.logoURI || seen.has(t.symbol)) return false;
          seen.add(t.symbol);
          return true;
        });
        // USDC first (Arc's native asset), then EURC, the rest in LI.FI's order.
        const rank = (t: ArcToken) => (t.symbol === "USDC" ? 0 : t.symbol === "EURC" ? 1 : 2);
        list.sort((a, b) => rank(a) - rank(b));
        return list.slice(0, 12);
      })
      .catch(() => []);
    cache.set(chainId, p);
  }
  return p;
}

// Live strip: the tokens drift slowly to the left in an endless loop (the list is drawn twice and the track
// moves by exactly one copy, so the loop has no visible jump). It stops while the pointer is over it, or for a
// few seconds after a touch, so a token can still be picked. With "reduce motion" on, it's a plain scrollable row.
const STRIP_CSS = `
@keyframes ff-strip-drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.ff-strip-view { overflow: hidden; flex: 1; min-width: 0;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%);
          mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%); }
.ff-strip-track { display: flex; width: max-content; animation: ff-strip-drift var(--ff-strip-dur, 30s) linear infinite; }
.ff-strip-view:hover .ff-strip-track, .ff-strip-view[data-paused="true"] .ff-strip-track { animation-play-state: paused; }
.ff-strip-copy { display: flex; gap: 8px; padding-right: 8px; }
@media (prefers-reduced-motion: reduce) {
  .ff-strip-view { overflow-x: auto; scrollbar-width: none; -webkit-mask-image: none; mask-image: none; }
  .ff-strip-track { animation: none; }
  .ff-strip-copy[aria-hidden="true"] { display: none; }
}
`;

export default function ArcTokenStrip({ chainId, label = "On Arc", onPick, initialSelected }: { chainId: number; label?: string; onPick: (t: ArcToken) => void; initialSelected?: string }) {
  const [tokens, setTokens] = useState<ArcToken[]>([]);
  const [selected, setSelected] = useState<string | null>(initialSelected?.toLowerCase() ?? null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadArcTokens(chainId).then((t) => { if (!cancelled) setTokens(t); });
    return () => { cancelled = true; };
  }, [chainId]);

  // After a touch, stay still for a moment so the user can tap a token, then drift again.
  useEffect(() => {
    if (!paused) return;
    const t = setTimeout(() => setPaused(false), 3500);
    return () => clearTimeout(t);
  }, [paused]);

  if (tokens.length === 0) return null;

  const renderCopy = (copy: number) => (
    <div className="ff-strip-copy" aria-hidden={copy === 1 ? true : undefined}>
      {tokens.map((t) => {
        const on = selected === t.address.toLowerCase();
        return (
          <button key={`${copy}-${t.address}`} type="button" tabIndex={copy === 1 ? -1 : undefined}
            onClick={() => { setSelected(t.address.toLowerCase()); onPick(t); }}
            style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, padding: "4px 12px 4px 5px", borderRadius: 999, background: "#fff", border: on ? "1.5px solid #3D5AF1" : "1px solid #D5DCF9", boxShadow: on ? "0 0 0 3px rgba(61,90,241,0.12)" : "none", cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s" }}>
            <img src={t.logoURI} alt="" width={24} height={24} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{t.symbol}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EEF1FE", borderRadius: 16, padding: "9px 10px 9px 14px", marginBottom: 10 }}>
      <style>{STRIP_CSS}</style>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#4B5563", flexShrink: 0 }}>
        <Sparkles size={14} color="#3D5AF1" /> {label}
      </span>
      <div className="ff-strip-view" data-paused={paused ? "true" : "false"} onTouchStart={() => setPaused(true)}>
        {/* About 3 seconds per token, so the speed stays the same however many tokens there are. */}
        <div className="ff-strip-track" style={{ ["--ff-strip-dur" as string]: `${Math.max(tokens.length * 3, 18)}s` }}>
          {renderCopy(0)}
          {renderCopy(1)}
        </div>
      </div>
    </div>
  );
}
