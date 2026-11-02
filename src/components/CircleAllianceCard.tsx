import { BadgeCheck, ArrowUpRight } from "lucide-react";

// Circle Alliance membership strip. The Circle wordmark and the certificate image are Circle's own
// official artwork (taken from the "Certified Member" graphic Circle provided), shown without recoloring.
const CERT = "/logos/circle-alliance-certified.jpg";
const WORDMARK = "/logos/circle-wordmark.png";
const INK = "#0F1B3D";
const MUTED = "#5B6478";
const BLUE = "#3D5AF1";

export default function CircleAllianceCard({ variant = "home", isMobile }: { variant?: "home" | "landing"; isMobile?: boolean }) {
  const big = variant === "landing";
  const stack = !!isMobile;

  return (
    <section
      aria-label="Circle Alliance Program certified member"
      style={{
        position: "relative", overflow: "hidden", fontFamily: "'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
        display: "flex", flexDirection: stack ? "column" : "row", alignItems: stack ? "flex-start" : "center",
        gap: stack ? 14 : big ? 32 : 24,
        padding: stack ? "1.1rem 1.25rem" : big ? "26px 40px" : "16px 28px",
        borderRadius: big ? 28 : 22,
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(18px) saturate(160%)", WebkitBackdropFilter: "blur(18px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.95)",
        boxShadow: "0 18px 40px -26px rgba(36,58,150,0.35), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
    >
      {/* soft decorative arc in FlowFi blues */}
      <span aria-hidden="true" style={{ position: "absolute", right: stack ? -160 : big ? 180 : 140, top: big ? -170 : -150, width: 340, height: 340, borderRadius: "50%",
        border: "34px solid rgba(91,120,255,0.10)", pointerEvents: "none" }} />

      <img src={WORDMARK} alt="Circle" style={{ height: big ? 44 : 30, width: "auto", flexShrink: 0, position: "relative" }} />

      {!stack && <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "rgba(15,27,61,0.12)", flexShrink: 0 }} />}

      <div style={{ minWidth: 0, flex: 1, position: "relative" }}>
        <div style={{ fontSize: big ? 15 : 12.5, color: MUTED, fontWeight: 500 }}>Circle Alliance Program</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: big ? 28 : 19, fontWeight: 800, color: INK, letterSpacing: "-0.02em", margin: big ? "2px 0 4px" : "1px 0 2px" }}>
          Certified Member <BadgeCheck size={big ? 24 : 18} color="#fff" fill={BLUE} />
        </div>
        <div style={{ fontSize: big ? 15 : 13, color: MUTED }}>FlowFi is a certified member of the Circle Alliance Program.</div>
      </div>

      <a href={CERT} target="_blank" rel="noopener noreferrer"
        style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, textDecoration: "none", color: BLUE, fontWeight: 700,
          fontSize: big ? 16 : 14, padding: big ? 0 : "9px 16px", borderRadius: 999,
          border: big ? "none" : "1px solid rgba(61,90,241,0.25)", background: big ? "transparent" : "rgba(255,255,255,0.85)" }}>
        View certificate <ArrowUpRight size={big ? 18 : 16} />
      </a>
    </section>
  );
}
