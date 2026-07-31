interface Props {
  icon: string;
  title: string;
  subtitle?: string;
}

export default function EmptyState({ icon, title, subtitle }: Props) {
  return (
    <div style={{ textAlign: "center", padding: "2.5rem 1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 32, opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 13, color: "#4B5563", fontWeight: 600 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#6B7280" }}>{subtitle}</div>}
    </div>
  );
}
