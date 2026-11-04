import { ArrowLeftRight, Zap, BarChart3 } from "lucide-react";
import type { ComponentType } from "react";

type Dest = "swap" | "bridge" | "earn";
const BADGES: { dest: Dest; label: string; Icon: ComponentType<{ size?: number; color?: string }>; pos: string }[] = [
  { dest: "swap", label: "Swap", Icon: ArrowLeftRight, pos: "ff-hv-a" },
  { dest: "bridge", label: "Bridge", Icon: Zap, pos: "ff-hv-b" },
  { dest: "earn", label: "Earn", Icon: BarChart3, pos: "ff-hv-c" },
];

const CSS = `
.ff-hv { position: relative; width: 100%; max-width: 640px; }
.ff-hv img { display: block; width: 100%; height: auto; }
.ff-hv-badge { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 84px; padding: 13px 6px 10px; border-radius: 20px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; color: #0F1B3D;
  background: rgba(255,255,255,.82); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid #fff; box-shadow: 0 18px 34px -18px rgba(36,58,150,.6); animation: ff-hv-bob 5s ease-in-out infinite; transition: box-shadow .2s, color .2s; }
.ff-hv-badge:hover, .ff-hv-badge:focus-visible { animation-play-state: paused; color: #3D5AF1; box-shadow: 0 20px 38px -14px rgba(61,90,241,.8); }
.ff-hv-a { top: 4%; left: 8%; }
.ff-hv-b { top: 20%; right: 0; animation-delay: -1.7s; }
.ff-hv-c { bottom: 24%; left: 0; animation-delay: -3.3s; }
@keyframes ff-hv-bob { 50% { transform: translateY(-9px); } }
@media (max-width: 520px) { .ff-hv-badge { width: 68px; padding: 9px 4px 7px; font-size: 11.5px; border-radius: 16px; } }
@media (prefers-reduced-motion: reduce) { .ff-hv-badge { animation: none; } }
`;

export default function HeroVisual({ onOpen }: { onOpen: (dest: Dest) => void }) {
  return (
    <div className="ff-hv">
      <style>{CSS}</style>
      <img src="/usdc-hero.webp" alt="USDC on Arc" className="flowfi-float" />
      {BADGES.map(({ dest, label, Icon, pos }) => (
        <button key={dest} type="button" className={`ff-hv-badge ${pos}`} onClick={() => onOpen(dest)}>
          <Icon size={22} color="#3D5AF1" />
          {label}
        </button>
      ))}
    </div>
  );
}
