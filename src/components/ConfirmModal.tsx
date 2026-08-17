interface ConfirmRow {
  label: string;
  value: string;
  highlight?: boolean; // e.g. for the amount or a risk warning
}

interface Props {
  title: string;
  rows: ConfirmRow[];
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  warning?: string; // optional extra warning line shown in red
}

export default function ConfirmModal({ title, rows, confirmLabel = "Confirm", onConfirm, onCancel, warning }: Props) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onCancel}>
      <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(17,24,39,0.25)" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#111827", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 18 }}>Review before you sign in your wallet.</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: warning ? 14 : 20 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 8, borderBottom: i < rows.length - 1 ? "1px solid #F5F3FF" : "none" }}>
              <span style={{ fontSize: 12.5, color: "#6B7280" }}>{row.label}</span>
              <span style={{ fontSize: row.highlight ? 15 : 13, fontWeight: row.highlight ? 800 : 600, color: row.highlight ? "#6D5EF7" : "#111827", fontFamily: "ui-monospace, monospace" }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {warning && (
          <div style={{ background: "rgba(239,68,68,0.08)", borderRadius: 10, padding: "0.65rem 0.8rem", marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, color: "#DC2626", margin: 0, lineHeight: 1.4 }}>{warning}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel}
            style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "none", background: "#f5f3ff", color: "#6B7280", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ flex: 1, padding: "0.75rem", borderRadius: 12, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 24px rgba(109,94,247,0.35)" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
