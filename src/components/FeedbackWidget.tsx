import { useState } from "react";
import { showToast } from "../toast";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, page: window.location.pathname }),
      });
      if (!res.ok) throw new Error("Failed to send");
      showToast("Thanks! Your feedback was sent.", "success");
      setMessage("");
      setOpen(false);
    } catch {
      showToast("Couldn't send feedback — please try again.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: "fixed", bottom: 24, left: 24, zIndex: 997, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
      {open && (
        <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 16, padding: "1rem", width: 280, boxShadow: "0 16px 48px rgba(17,24,39,0.16)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Send Feedback</div>
          <p style={{ fontSize: 11.5, color: "#6B7280", margin: 0, lineHeight: 1.4 }}>
            Spotted something off, or have an idea? This goes straight to the team.
          </p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What's on your mind?"
            rows={4}
            style={{ resize: "none", border: "1px solid #E5E0FA", borderRadius: 10, padding: "0.6rem", fontSize: 12.5, color: "#111827", outline: "none", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={submit} disabled={sending || !message.trim()}
              style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12, fontWeight: 700, cursor: sending || !message.trim() ? "not-allowed" : "pointer", opacity: sending || !message.trim() ? 0.5 : 1 }}>
              {sending ? "Sending..." : "Send"}
            </button>
            <button onClick={() => setOpen(false)}
              style={{ padding: "0.55rem 0.9rem", borderRadius: 10, border: "none", background: "#f5f3ff", color: "#6B7280", fontSize: 12, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setOpen(!open)} title="Send feedback"
          style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid #D4C9FA", background: "#ffffff", color: "#6D5EF7", fontSize: 18, cursor: "pointer", boxShadow: "0 8px 24px rgba(109,94,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          💬
        </button>
        <a href="https://x.com/flowfiarc" target="_blank" rel="noopener noreferrer" title="Follow FlowFi on X"
          style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid #D4C9FA", background: "#ffffff", color: "#111827", fontSize: 16, cursor: "pointer", boxShadow: "0 8px 24px rgba(17,24,39,0.12)", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          𝕏
        </a>
      </div>
    </div>
  );
}
