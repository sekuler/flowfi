interface Step {
  name: string;
  state: "pending" | "success" | "error";
  explorerUrl?: string;
  txHash?: string;
}

interface Props {
  steps: Step[];
  isComplete: boolean;
  isFailed: boolean;
}

const STEP_LABELS: Record<string, string> = {
  approve: "USDC Approval",
  burn: "Burning on source chain",
  fetchAttestation: "Waiting for attestation",
  mint: "Minting on Arc Testnet",
};

const STEP_DESC: Record<string, string> = {
  approve: "Approving USDC spend in wallet",
  burn: "Burning USDC on Sepolia (CCTP v2)",
  fetchAttestation: "Fetching Circle attestation — this may take a moment",
  mint: "Minting USDC on Arc Testnet",
};

export default function BridgeStatus({ steps, isComplete, isFailed }: Props) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "1.5rem", width: "100%" }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9", marginBottom: "1.25rem" }}>
        {isComplete ? "Bridge complete!" : isFailed ? "An error occurred" : "Bridging in progress..."}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", marginTop: 4, flexShrink: 0, background: step.state === "success" ? "#22c55e" : step.state === "error" ? "#ef4444" : "#3b82f6" }} />
              {i < steps.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 24, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />}
            </div>
            <div style={{ paddingBottom: "1rem", flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{step.state === "success" ? "✓ " : ""}{STEP_LABELS[step.name] ?? step.name}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{STEP_DESC[step.name] ?? "Processing..."}</div>
              {step.explorerUrl && <a href={step.explorerUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 4, fontSize: 12, color: "#60a5fa", textDecoration: "none" }}>View on Explorer</a>}
            </div>
          </div>
        ))}
      </div>
      {isComplete && (
        <div style={{ marginTop: "1rem", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "1rem" }}>
          <p style={{ color: "#6ee7b7", marginBottom: 8, fontWeight: 600 }}>USDC successfully bridged to Arc Testnet!</p>
          <a href="https://testnet.arcscan.app" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}>Open Arc Testnet Explorer</a>
        </div>
      )}
    </div>
  );
}
