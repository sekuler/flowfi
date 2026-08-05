import { useState, useEffect, useRef } from "react";
import { Bell, Check, Trash2 } from "lucide-react";
import { subscribeNotifications, markAllNotificationsRead, clearNotifications, type Notification } from "../toast";

const TYPE_DOT: Record<string, string> = {
  success: "#16A34A",
  error: "#DC2626",
  info: "#6D5EF7",
};

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribeNotifications(setNotifications);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) markAllNotificationsRead();
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button onClick={toggleOpen} title="Notifications"
        style={{ position: "relative", background: "rgba(109,94,247,0.08)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6D5EF7" }}>
        <Bell size={16} />
        {unreadCount > 0 && (
          <span style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 999, background: "#EF4444", color: "#fff", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340, maxHeight: 420, background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, boxShadow: "0 16px 40px rgba(109,94,247,0.2)", zIndex: 50, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1rem", borderBottom: "1px solid #EDE9FE" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Notifications</span>
            {notifications.length > 0 && (
              <button onClick={clearNotifications} title="Clear all"
                style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {notifications.length === 0 && (
              <div style={{ padding: "2.5rem 1rem", textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>
                No notifications yet. Actions like swaps, sends, and bridges will show up here.
              </div>
            )}
            {notifications.map((n) => (
              <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "0.75rem 1rem", borderBottom: "1px solid #F5F3FF" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: TYPE_DOT[n.type] ?? "#6D5EF7", marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: "#111827" }}>{n.message}</div>
                  <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 2 }}>{timeAgo(n.timestamp)}</div>
                </div>
                {!n.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#EF4444", marginTop: 6, flexShrink: 0 }} />}
              </div>
            ))}
          </div>

          {notifications.length > 0 && (
            <div style={{ padding: "0.6rem 1rem", borderTop: "1px solid #EDE9FE", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11, color: "#6B7280" }}>
              <Check size={12} /> All caught up
            </div>
          )}
        </div>
      )}
    </div>
  );
}
