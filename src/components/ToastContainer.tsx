import { useEffect, useState } from "react";
import { subscribeToasts, type ToastMessage } from "../toast";

const TYPE_STYLE: Record<string, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: "rgba(34,197,94,0.12)", border: "#E8E3FF", color: "#16A34A", icon: "✓" },
  error: { bg: "rgba(239,68,68,0.12)", border: "#E8E3FF", color: "#DC2626", icon: "✕" },
  info: { bg: "rgba(109,94,247,0.12)", border: "#E8E3FF", color: "#6D5EF7", icon: "ℹ" },
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
              background: "#ffffff", border: `1px solid ${style.border}`, borderRadius: 14,
              padding: "0.75rem 1.1rem", minWidth: 220, maxWidth: 340,
              boxShadow: "0 8px 24px rgba(109,94,247,0.15)",
              animation: "flowfi-toast-in 0.25s ease-out",
            }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: style.bg, color: style.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
              {style.icon}
            </div>
            <span style={{ fontSize: 13, color: "#1e293b", fontWeight: 600 }}>{t.message}</span>
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
