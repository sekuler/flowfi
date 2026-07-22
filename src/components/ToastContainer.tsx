import { useEffect, useState } from "react";
import { subscribeToasts, type ToastMessage } from "../toast";

const TYPE_STYLE: Record<string, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.4)", color: "#6ee7b7", icon: "✓" },
  error: { bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.4)", color: "#fca5a5", icon: "✕" },
  info: { bg: "rgba(79,70,229,0.15)", border: "rgba(79,70,229,0.4)", color: "#a5b4fc", icon: "ℹ" },
};

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map((t) => {
        const style = TYPE_STYLE[t.type] ?? TYPE_STYLE.success;
        return (
          <div key={t.id}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "#0d1b2f", border: `1px solid ${style.border}`, borderRadius: 12,
              padding: "0.75rem 1.1rem", minWidth: 220, maxWidth: 340,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              animation: "flowfi-toast-in 0.25s ease-out",
            }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: style.bg, color: style.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
              {style.icon}
            </div>
            <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{t.message}</span>
          </div>
        );
      })}
      <style>{`
        @keyframes flowfi-toast-in {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}