import { useState } from "react";
import type { EIP1193Provider } from "viem";
import { Wallet, CircleDollarSign } from "lucide-react";
import WalletConnect from "./WalletConnect";

// The "Circle Wallet" tab signs in to the MAINNET Circle Wallet (api/circle-wallet-mainnet.js,
// LIVE key). The testnet Circle Wallet is still available from its own page in the Testnet menu.
const LIVE_API = "/api/circle-wallet-mainnet";
export const LIVE_STORAGE_KEY = "flowfi_circle_wallet_live";

export interface LiveCircleWallet {
  address: string;
  walletsByChain: Record<string, { walletId: string; address: string }>;
  email: string;
}

interface Props {
  onClose: () => void;
  onConnected: (provider: EIP1193Provider, address: string, walletName: string) => void;
  onCircleConnected: (info: LiveCircleWallet) => void;
}

const BLUE = "#3D5AF1";
const INK = "#16151C";
const MUTED = "#5E5B6B";
const LINE = "#E7E4DD";

async function post(body: Record<string, unknown>) {
  const res = await fetch(LIVE_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

export default function ConnectModal({ onClose, onConnected, onCircleConnected }: Props) {
  const [tab, setTab] = useState<"browser" | "circle">("browser");
  const [circleStep, setCircleStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [circleError, setCircleError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true); setCircleError(null);
    try { await post({ action: "requestCode", email: email.trim() }); setCircleStep("code"); }
    catch (e) { setCircleError(e instanceof Error ? e.message : "Unexpected error."); }
    finally { setBusy(false); }
  }

  async function confirmCode() {
    setBusy(true); setCircleError(null);
    try {
      const d = await post({ action: "verifyCode", email: email.trim(), code: code.trim() });
      const info: LiveCircleWallet = { address: d.address, walletsByChain: d.walletsByChain, email: d.email };
      localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(info));
      window.dispatchEvent(new Event("circle-live-changed"));
      onCircleConnected(info);
    } catch (e) { setCircleError(e instanceof Error ? e.message : "Unexpected error."); }
    finally { setBusy(false); }
  }

  const tabBtn = (on: boolean) => ({
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 38, borderRadius: 10, border: "none",
    background: on ? "#FFFFFF" : "transparent", color: on ? INK : MUTED, fontSize: 13, fontWeight: 600, cursor: "pointer",
    boxShadow: on ? "0 1px 2px rgba(22,21,28,0.12)" : "none",
  } as const);
  const input = { width: "100%", boxSizing: "border-box" as const, height: 48, padding: "0 14px", borderRadius: 12, border: `1px solid ${LINE}`, fontSize: 14, color: INK };
  const primary = (on: boolean) => ({ width: "100%", height: 48, borderRadius: 12, border: "none", background: on ? BLUE : "#EEEDF5", color: on ? "#FFFFFF" : "#8A8798", fontSize: 15, fontWeight: 600, cursor: on ? "pointer" : "not-allowed" });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(17,24,39,0.45)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div role="dialog" aria-modal="true" aria-label="Connect to FlowFi" onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 440, background: "#FFFFFF", borderRadius: 24, padding: "1.75rem", boxShadow: "0 24px 60px rgba(17,24,39,0.25)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>Connect to FlowFi</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>Use your own wallet, or sign in with email.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "#F3F4F6", border: "none", borderRadius: 999, width: 32, height: 32, fontSize: 16, color: "#4B5563", cursor: "pointer", flexShrink: 0 }}>×</button>
        </div>

        <div role="group" aria-label="Sign-in method" style={{ display: "flex", gap: 2, background: "#ECEAE4", borderRadius: 12, padding: 3, marginBottom: 18 }}>
          <button onClick={() => setTab("browser")} aria-pressed={tab === "browser"} style={tabBtn(tab === "browser")}><Wallet size={14} /> Browser Wallet</button>
          <button onClick={() => setTab("circle")} aria-pressed={tab === "circle"} style={tabBtn(tab === "circle")}><CircleDollarSign size={14} /> Circle Wallet</button>
        </div>

        {tab === "browser" ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <WalletConnect onConnected={onConnected} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
              No extension, no seed phrase. Sign in with your email and Circle creates the wallet for you on Arc Mainnet.
            </p>
            {circleError && <div style={{ background: "#FDECEC", borderRadius: 10, padding: "10px 12px", color: "#B91C1C", fontSize: 12.5, wordBreak: "break-word" }}>{circleError}</div>}

            {circleStep === "email" ? (
              <>
                <label htmlFor="cm-email" style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Email</label>
                <input id="cm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={input}
                  onKeyDown={(e) => { if (e.key === "Enter" && email.trim() && !busy) sendCode(); }} />
                <button onClick={sendCode} disabled={busy || !email.trim()} style={primary(!busy && !!email.trim())}>{busy ? "Sending code..." : "Send code"}</button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label htmlFor="cm-code" style={{ fontSize: 12.5, color: MUTED }}>Code sent to <strong style={{ color: INK }}>{email.trim()}</strong></label>
                  <button onClick={() => { setCircleStep("email"); setCircleError(null); }} style={{ background: "none", border: "none", color: MUTED, fontSize: 12.5, cursor: "pointer" }}>Back</button>
                </div>
                <input id="cm-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456"
                  style={{ ...input, fontSize: 20, letterSpacing: 6, textAlign: "center" }}
                  onKeyDown={(e) => { if (e.key === "Enter" && code.trim() && !busy) confirmCode(); }} />
                <button onClick={confirmCode} disabled={busy || !code.trim()} style={primary(!busy && !!code.trim())}>{busy ? "Verifying..." : "Verify & continue"}</button>
              </>
            )}

            <p style={{ fontSize: 11.5, color: MUTED, margin: 0, textAlign: "center", lineHeight: 1.5 }}>
              Real funds. Holds up to $100 and you can withdraw anytime. Bridge and Swap still need a browser wallet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
