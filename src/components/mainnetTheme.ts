import type { CSSProperties } from "react";

// Shared look for the mainnet Home, Dashboard and History pages:
// frosted-glass cards on the page's white -> lilac-blue wash, big bold numbers, green/blue accents.
export const T = {
  ink: "#0F1B3D",
  text: "#1F2A44",
  muted: "#5B6478",
  faint: "#8A93A8",
  blue: "#3D5AF1",
  blueDeep: "#2448DD",
  green: "#16A34A",
  greenSoft: "#E3F6EA",
  line: "rgba(15,27,61,0.07)",
  display: "'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
};

export const glass: CSSProperties = {
  background: "rgba(255,255,255,0.62)",
  backdropFilter: "blur(18px) saturate(160%)",
  WebkitBackdropFilter: "blur(18px) saturate(160%)",
  border: "1px solid rgba(255,255,255,0.92)",
  borderRadius: 24,
  boxShadow: "0 12px 32px -20px rgba(36,58,150,0.28), inset 0 1px 0 rgba(255,255,255,0.9)",
};

// A single row inside a list, a little lighter than the card behind it.
export const glassRow: CSSProperties = {
  background: "rgba(255,255,255,0.7)",
  border: "1px solid rgba(255,255,255,0.95)",
  borderRadius: 16,
  boxShadow: "0 4px 14px -10px rgba(36,58,150,0.25)",
};

export const heroBlue: CSSProperties = {
  background: "linear-gradient(135deg, #4169F2 0%, #2B50E3 45%, #1F40D2 100%)",
  border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: 28,
  boxShadow: "0 28px 60px -30px rgba(31,64,210,0.75), inset 0 1px 0 rgba(255,255,255,0.35)",
  color: "#FFFFFF",
};

export const pill = (color: string): CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
  padding: "6px 18px", borderRadius: 999, fontSize: 15, fontWeight: 500, color: "#FFFFFF",
  background: `linear-gradient(180deg, ${color}B3 0%, ${color} 100%)`,
  boxShadow: `0 4px 10px -4px ${color}99, inset 0 1px 0 rgba(255,255,255,0.35)`,
  whiteSpace: "nowrap",
});

export const iconBtn: CSSProperties = {
  width: 38, height: 38, borderRadius: 11, border: "1px solid rgba(255,255,255,0.95)",
  background: "rgba(255,255,255,0.8)", color: "#4B5570", display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", boxShadow: "0 3px 10px -6px rgba(36,58,150,0.35)", flexShrink: 0,
};
