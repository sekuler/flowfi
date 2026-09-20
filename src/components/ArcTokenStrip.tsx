import { useEffect, useRef, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";

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
        // USDC first (it's Arc's native asset), the rest in LI.FI's order.
        list.sort((a, b) => Number(b.symbol === "USDC") - Number(a.symbol === "USDC"));
        return list.slice(0, 12);
      })
      .catch(() => []);
    cache.set(chainId, p);
  }
  return p;
}

export default function ArcTokenStrip({ chainId, label = "On Arc", onPick }: { chainId: number; label?: string; onPick: (t: ArcToken) => void }) {
  const [tokens, setTokens] = useState<ArcToken[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadArcTokens(chainId).then((t) => { if (!cancelled) setTokens(t); });
    return () => { cancelled = true; };
  }, [chainId]);

  if (tokens.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EEF0FF", borderRadius: 16, padding: "9px 10px 9px 14px", marginBottom: 10 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#4B5563", flexShrink: 0 }}>
        <Sparkles size={14} color="#6D5EF7" /> {label}
      </span>
      <div ref={scroller} style={{ display: "flex", gap: 8, overflowX: "auto", flex: 1, scrollbarWidth: "none" }}>
        {tokens.map((t) => {
          const on = selected === t.address;
          return (
            <button key={t.address} type="button" onClick={() => { setSelected(t.address); onPick(t); }}
              style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, padding: "4px 12px 4px 5px", borderRadius: 999, background: "#fff", border: on ? "1.5px solid #6D5EF7" : "1px solid #DDD6FA", boxShadow: on ? "0 0 0 3px rgba(109,94,247,0.12)" : "none", cursor: "pointer", transition: "all 0.15s" }}>
              <img src={t.logoURI} alt="" width={24} height={24} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{t.symbol}</span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Scroll tokens" onClick={() => scroller.current?.scrollBy({ left: 180, behavior: "smooth" })}
        style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", padding: 2, flexShrink: 0 }}>
        <ChevronRight size={18} color="#6D5EF7" />
      </button>
    </div>
  );
}
