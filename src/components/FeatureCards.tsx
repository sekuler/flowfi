import { ArrowRight } from "lucide-react";
import type { ComponentType } from "react";

type Feature = { title: string; desc: string };
type IconType = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const CSS = `
.ff-feat { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; padding: 24px 32px 48px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; font-family: 'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; }
.ff-feat-card { display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 18px 14px 14px; cursor: pointer; font: inherit; text-align: left; background: #fff; border: 1px solid rgba(61,90,241,.13); border-radius: 18px; box-shadow: 0 14px 30px -26px rgba(36,58,150,.6); transition: transform .2s, border-color .2s, box-shadow .2s; }
.ff-feat-card:hover, .ff-feat-card:focus-visible { transform: translateY(-2px); border-color: rgba(61,90,241,.42); box-shadow: 0 18px 34px -22px rgba(61,90,241,.65); }
.ff-feat-icon { flex: none; width: 52px; height: 52px; border-radius: 15px; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #fff, #EDF1FF); border: 1px solid rgba(61,90,241,.12); box-shadow: 0 8px 18px -12px rgba(61,90,241,.6); }
.ff-feat-text { flex: 1; min-width: 0; }
.ff-feat-title { display: block; margin: 0 0 3px; font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-size: 19px; font-weight: 600; color: #0F1B3D; }
.ff-feat-desc { display: block; font-size: 13.5px; line-height: 1.4; color: #5B6478; }
.ff-feat-arrow { flex: none; color: #3D5AF1; transition: transform .2s; }
.ff-feat-card:hover .ff-feat-arrow, .ff-feat-card:focus-visible .ff-feat-arrow { transform: translateX(4px); }
@media (max-width: 860px) { .ff-feat { padding: 20px 16px 36px; grid-template-columns: 1fr; } }
`;

export default function FeatureCards({ items, icons, onOpen }: { items: Feature[]; icons: IconType[]; onOpen: (title: string) => void }) {
  return (
    <div className="ff-feat">
      <style>{CSS}</style>
      {items.map((f, i) => {
        const Icon = icons[i];
        return (
          <button key={f.title} type="button" className="ff-feat-card" onClick={() => onOpen(f.title)}>
            <span className="ff-feat-icon"><Icon size={23} color="#3D5AF1" strokeWidth={1.9} /></span>
            <span className="ff-feat-text">
              <strong className="ff-feat-title">{f.title}</strong>
              <span className="ff-feat-desc">{f.desc}</span>
            </span>
            <ArrowRight className="ff-feat-arrow" size={18} />
          </button>
        );
      })}
    </div>
  );
}
