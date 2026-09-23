import { useState } from "react";

const STORAGE_KEY = "flowfi-onboarding-seen";

const STEPS = [
  {
    icon: "✦",
    title: "Welcome to FlowFi",
    body: "A self-custodial interface for USDC on Arc Mainnet — connect your own wallet, no seed phrase ever leaves it. Bridge, swap, and track your portfolio, all in one place. Real funds, real fees.",
  },
  {
    icon: "🌉",
    title: "Bridge USDC onto Arc",
    body: "Native USDC via Circle's CCTP V2 — burned on the source chain, minted fresh on Arc, no wrapped tokens. Need a different asset? The Any token tab routes it in via LI.FI.",
  },
  {
    icon: "🤖",
    title: "Ask your wallet",
    body: "The Copilot on Home can answer questions about your balances and activity, and take you straight to the right screen — like \"how much USDC do I have\" or \"find my last transaction\".",
  },
  {
    icon: "🧭",
    title: "Explore at your own pace",
    body: "Bridge, Swap, Dashboard, History — everything's in the sidebar. No rush, explore whenever you're ready.",
  },
];

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true; // if localStorage is unavailable, don't block the user with a modal that can't be dismissed-and-remembered
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function finish() {
    markOnboardingSeen();
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "#ffffff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 64px rgba(17,24,39,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
            {current.icon}
          </div>
        </div>

        <h2 style={{ fontSize: 19, fontWeight: 800, color: "#111827", textAlign: "center", margin: "0 0 10px" }}>{current.title}</h2>
        <p style={{ fontSize: 13.5, color: "#4B5563", textAlign: "center", lineHeight: 1.6, margin: "0 0 22px" }}>{current.body}</p>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 22 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 999, background: i === step ? "#6D5EF7" : "#E5E0FA", transition: "width 0.2s" }} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={finish} style={{ padding: "0.7rem 1rem", borderRadius: 12, border: "none", background: "#f5f3ff", color: "#6B7280", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Skip
          </button>
          <button
            onClick={() => (isLast ? finish() : setStep(step + 1))}
            style={{ flex: 1, padding: "0.7rem", borderRadius: 12, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 24px rgba(109,94,247,0.35)" }}>
            {isLast ? "Let's go" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
