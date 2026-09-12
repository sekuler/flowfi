import { useState, useEffect } from "react";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { arcTestnet } from "../chains";
import { getCircleWallet, saveCircleWallet, forgetCircleWallet, requestCircleWalletCode, verifyCircleWalletCode, type CircleWalletInfo } from "../circleWalletHelpers";
import { useIsMobile } from "../useIsMobile";
import { USDC_ADDRESS, EURC_ADDRESS, CIRBTC_ADDRESS } from "../contracts";

export default function CircleWallet() {
  const isMobile = useIsMobile();
  const [wallet, setWallet] = useState<CircleWalletInfo | null>(null);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ usdc: string; eurc: string; cirbtc: string } | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);

  useEffect(() => {
    setWallet(getCircleWallet());
  }, []);

  useEffect(() => {
    if (!wallet) { setBalances(null); return; }
    loadBalances(wallet.address);
    const interval = setInterval(() => loadBalances(wallet.address), 15000);
    return () => clearInterval(interval);
  }, [wallet]);

  async function loadBalances(address: string) {
    setLoadingBalances(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [usdc, eurc, cirbtc] = await Promise.all([
        client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }),
        client.readContract({ address: EURC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }),
        client.readContract({ address: CIRBTC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }),
      ]);
      setBalances({
        usdc: Number(formatUnits(usdc, 6)).toFixed(2),
        eurc: Number(formatUnits(eurc, 6)).toFixed(2),
        cirbtc: Number(formatUnits(cirbtc, 8)).toFixed(6),
      });
    } catch {
      setBalances({ usdc: "—", eurc: "—", cirbtc: "—" });
    } finally {
      setLoadingBalances(false);
    }
  }

  async function sendCode() {
    setLoading(true);
    setError(null);
    try {
      await requestCircleWalletCode(email.trim());
      setStep("code");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode() {
    setLoading(true);
    setError(null);
    try {
      const newWallet = await verifyCircleWalletCode(email.trim(), code.trim());
      setWallet(newWallet);
      saveCircleWallet(newWallet);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  function forgetWallet() {
    forgetCircleWallet();
    setWallet(null);
    setError(null);
    setBalances(null);
    setStep("email");
    setEmail("");
    setCode("");
  }

  const chainList = wallet ? Object.keys(wallet.walletsByChain) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%", maxWidth: 460 }}>
      <div style={{ background: "rgba(52,211,153,0.1)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#16A34A", margin: 0 }}>
          Powered by Circle Developer-Controlled Wallets — no seed phrase, no browser extension. One address works across Arc, Ethereum Sepolia, Base Sepolia, and Arbitrum Sepolia.
        </p>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        {!wallet && step === "email" && (
          <>
            <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>
              Sign in with your email — no extension, no private key to store. We'll send a 6-digit code; your wallet is tied to your email, not just this browser, so signing in again from anywhere gets you back to the same one.
            </p>
            {error && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 12, wordBreak: "break-word" }}>{error}</div>}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              onKeyDown={(e) => { if (e.key === "Enter" && email.trim() && !loading) sendCode(); }}
              style={{ width: "100%", padding: "0.9rem 1rem", borderRadius: 14, border: "1px solid #E5E7EB", fontSize: 14, color: "#111827", boxSizing: "border-box" }} />
            <button onClick={sendCode} disabled={loading || !email.trim()}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#16A34A", color: "#ffffff", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 24px rgba(22,163,74,0.35)", cursor: loading || !email.trim() ? "not-allowed" : "pointer", opacity: loading || !email.trim() ? 0.6 : 1 }}>
              {loading ? "Sending code..." : "Send verification code"}
            </button>
          </>
        )}

        {!wallet && step === "code" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>Enter the code sent to <strong>{email.trim()}</strong>:</p>
              <button onClick={() => { setStep("email"); setError(null); }} style={{ background: "none", border: "none", color: "#4B5563", fontSize: 12, cursor: "pointer" }}>Back</button>
            </div>
            {error && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 12, wordBreak: "break-word" }}>{error}</div>}
            <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6}
              onKeyDown={(e) => { if (e.key === "Enter" && code.trim() && !loading) confirmCode(); }}
              style={{ width: "100%", padding: "0.9rem 1rem", borderRadius: 14, border: "1px solid #E5E7EB", fontSize: 20, letterSpacing: 6, textAlign: "center", color: "#111827", fontFamily: "ui-monospace, monospace", boxSizing: "border-box" }} />
            <button onClick={confirmCode} disabled={loading || !code.trim()}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#16A34A", color: "#ffffff", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 24px rgba(22,163,74,0.35)", cursor: loading || !code.trim() ? "not-allowed" : "pointer", opacity: loading || !code.trim() ? 0.6 : 1 }}>
              {loading ? "Verifying..." : "Verify & continue"}
            </button>
            <button onClick={sendCode} disabled={loading} style={{ background: "none", border: "none", color: "#5B21B6", fontSize: 12, cursor: "pointer", padding: 0, alignSelf: "center" }}>
              Resend code
            </button>
          </>
        )}

        {wallet && (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <p style={{ fontSize: 14, color: "#16A34A", fontWeight: 700, margin: 0 }}>Signed in as {wallet.email}</p>
              <p style={{ fontSize: 12, color: "#4B5563", margin: 0, textAlign: "center" }}>Same address on every supported chain — sign in with this email from anywhere to get it back.</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 8 }}>
              <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 10, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#5B21B6", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>USDC</div>
                <div style={{ fontSize: 16, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {loadingBalances && !balances ? "..." : balances?.usdc ?? "0.00"}
                </div>
              </div>
              <div style={{ background: "rgba(168,85,247,0.1)", borderRadius: 10, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#7C3AED", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>EURC</div>
                <div style={{ fontSize: 16, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {loadingBalances && !balances ? "..." : balances?.eurc ?? "0.00"}
                </div>
              </div>
              <div style={{ background: "rgba(249,115,22,0.1)", borderRadius: 10, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#C2410C", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>cirBTC</div>
                <div style={{ fontSize: 16, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {loadingBalances && !balances ? "..." : balances?.cirbtc ?? "0.000000"}
                </div>
              </div>
            </div>

            <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "1rem" }}>
              <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 6 }}>ADDRESS (SAME ON ALL CHAINS)</div>
              <div style={{ fontSize: 13, color: "#111827", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>{wallet.address}</div>
            </div>

            <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "1rem" }}>
              <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 8 }}>AVAILABLE ON</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {chainList.map((chain) => (
                  <div key={chain} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: "#6B7280" }}>{chain.replace("-", " ")}</span>
                    <span style={{ color: "#5B21B6", fontWeight: 600 }}>✓ Ready</span>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ fontSize: 11, color: "#4B5563", textAlign: "center", margin: 0 }}>
              Send testnet USDC from the Faucet to this address on any of the chains above — your balance will update automatically.
            </p>

            <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "0.75rem", borderRadius: 12, border: "none", background: "rgba(168,85,247,0.1)", color: "#7C3AED", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
              View on Explorer ↗
            </a>
            <button onClick={forgetWallet}
              style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#4B5563", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
