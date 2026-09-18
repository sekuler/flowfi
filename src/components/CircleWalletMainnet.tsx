import { useState, useEffect } from "react";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";
import { getCircleWallet, saveCircleWallet, forgetCircleWallet, requestCircleWalletCode, verifyCircleWalletCode, type CircleWalletInfo } from "../circleWalletHelpers";

// Mainnet counterpart to CircleWallet.tsx (which stays as-is, pointed at
// Arc Testnet). Shows the wallet's Base mainnet USDC balance and a
// "buy with card" link, powered by Circle Developer-Controlled Wallets
// for the email sign-in / no-seed-phrase part.
//
// Earlier version of this file gated everything behind a check for a
// "BASE" entry in wallet.walletsByChain, assuming Circle needed to have
// explicitly provisioned Base for the address to be usable there. That
// check was wrong and has been removed: the wallet's address is a
// standard EOA, valid on every EVM chain regardless of which chains
// Circle's backend was told to create it on (BRIDGE_CHAINS in
// api/circle-wallet.js is currently testnet-only, since adding 'BASE'
// there requires a Circle LIVE_API_KEY -- production access gated behind
// KYB, not available yet). Since nothing here asks Circle to SIGN a
// transaction on Base (reading the balance is a public RPC call, and the
// "buy with card" flow is an outbound Relay onramp link, not a
// Circle-signed action), none of that matters for this page -- the
// address just needs to be valid on Base, which it always is.
const BASE_MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // verified 2026-09-17 against Circle's own USDC contract list

export default function CircleWalletMainnet() {
  const [wallet, setWallet] = useState<CircleWalletInfo | null>(null);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  useEffect(() => {
    setWallet(getCircleWallet());
  }, []);

  useEffect(() => {
    if (!wallet) { setUsdcBalance(null); return; }
    loadBalance(wallet.address);
    const interval = setInterval(() => loadBalance(wallet.address), 15000);
    return () => clearInterval(interval);
  }, [wallet]);

  async function loadBalance(address: string) {
    setLoadingBalance(true);
    try {
      const client = createPublicClient({ chain: base, transport: http() });
      const usdc = await client.readContract({
        address: BASE_MAINNET_USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      setUsdcBalance(Number(formatUnits(usdc, 6)).toFixed(2));
    } catch {
      setUsdcBalance("—");
    } finally {
      setLoadingBalance(false);
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
    setUsdcBalance(null);
    setStep("email");
    setEmail("");
    setCode("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%", maxWidth: 460 }}>
      <div style={{ background: "#FEF3C7", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#92400E", margin: 0, fontWeight: 700 }}>
          ⚡ MAINNET — real funds. Powered by Circle Developer-Controlled Wallets — no seed phrase, no browser extension.
        </p>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        {!wallet && step === "email" && (
          <>
            <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>
              Sign in with your email — no extension, no private key to store. We'll send a 6-digit code.
            </p>
            {error && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 12, wordBreak: "break-word" }}>{error}</div>}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              onKeyDown={(e) => { if (e.key === "Enter" && email.trim() && !loading) sendCode(); }}
              style={{ width: "100%", padding: "0.9rem 1rem", borderRadius: 14, border: "1px solid #E5E7EB", fontSize: 14, color: "#111827", boxSizing: "border-box" }} />
            <button onClick={sendCode} disabled={loading || !email.trim()}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#7B3FE4", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: loading || !email.trim() ? "not-allowed" : "pointer", opacity: loading || !email.trim() ? 0.6 : 1 }}>
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
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#7B3FE4", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: loading || !code.trim() ? "not-allowed" : "pointer", opacity: loading || !code.trim() ? 0.6 : 1 }}>
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
              <p style={{ fontSize: 14, color: "#7B3FE4", fontWeight: 700, margin: 0 }}>Signed in as {wallet.email}</p>
            </div>

            <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 10, padding: "0.9rem", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#5B21B6", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>USDC (BASE)</div>
              <div style={{ fontSize: 22, color: "#111827", fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>
                {loadingBalance && !usdcBalance ? "..." : usdcBalance ?? "0.00"}
              </div>
            </div>

            <a
              href={`https://relay.link/onramp/base?toAddress=${wallet.address}&toCurrency=${BASE_MAINNET_USDC}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", width: "100%", padding: "0.9rem", borderRadius: 14, border: "none", background: "#7B3FE4", color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none", boxSizing: "border-box" }}
            >
              Buy USDC with card ↗
            </a>

            <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "1rem" }}>
              <div style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 6 }}>ADDRESS</div>
              <div style={{ fontSize: 13, color: "#111827", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>{wallet.address}</div>
            </div>

            <a href={`https://basescan.org/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "0.75rem", borderRadius: 12, border: "none", background: "rgba(168,85,247,0.1)", color: "#7C3AED", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
              View on Basescan ↗
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
