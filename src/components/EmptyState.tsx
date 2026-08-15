interface Props {
  icon: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
}

export default function EmptyState({ icon, title, subtitle, actionLabel, actionHref }: Props) {
  return (
    <div style={{ textAlign: "center", padding: "2.5rem 1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 32, opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 13, color: "#4B5563", fontWeight: 600 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#6B7280" }}>{subtitle}</div>}
      {actionLabel && actionHref && (
        <a href={actionHref} target="_blank" rel="noopener noreferrer"
          style={{ marginTop: 6, padding: "0.5rem 1rem", borderRadius: 10, background: "#6D5EF7", color: "#ffffff", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
          {actionLabel}
        </a>
      )}
    </div>
  );
}
