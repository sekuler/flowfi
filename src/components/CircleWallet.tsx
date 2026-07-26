import { useState, useEffect } from "react";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { arcTestnet } from "../chains";

interface CircleWalletData {
  walletId: string;
  address: string;
  blockchain: string;
}

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const STORAGE_KEY = "flowfi_circle_wallet";

export default function CircleWallet() {
  const [wallet, setWallet] = useState<CircleWalletData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ usdc: string; eurc: string } | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setWallet(JSON.parse(saved));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
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
      const [usdc, eurc] = await Promise.all([
        client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }),
        client.readContract({ address: EURC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }),
      ]);
      setBalances({
        usdc: Number(formatUnits(usdc, 6)).toFixed(2),
        eurc: Number(formatUnits(eurc, 6)).toFixed(2),
      });
    } catch {
      setBalances({ usdc: "—", eurc: "—" });
    } finally {
      setLoadingBalances(false);
    }
  }

  async function createWallet() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/circle-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Failed to create wallet.");
      const newWallet = { walletId: data.walletId, address: data.address, blockchain: data.blockchain };
      setWallet(newWallet);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newWallet));
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  function forgetWallet() {
    localStorage.removeItem(STORAGE_KEY);
    setWallet(null);
    setError(null);
    setBalances(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "100%", maxWidth: 460 }}>
      <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#6ee7b7", margin: 0 }}>
          Powered by Circle Developer-Controlled Wallets — no seed phrase, no browser extension. Circle's MPC infrastructure secures the private key.
        </p>
      </div>

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        {!wallet && (
          <>
            <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>
              Create a Circle-managed wallet on Arc Testnet in one click. No extension, no private key to store. This wallet is yours — it stays linked to your browser and holds real testnet balances.
            </p>
            {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 12, wordBreak: "break-word" }}>{error}</div>}
            <button onClick={createWallet} disabled={loading}
              style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #059669, #10b981)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Creating wallet..." : "Create Circle Wallet"}
            </button>
          </>
        )}

        {wallet && (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <p style={{ fontSize: 14, color: "#6ee7b7", fontWeight: 700, margin: 0 }}>This is your wallet</p>
              <p style={{ fontSize: 12, color: "#64748b", margin: 0, textAlign: "center" }}>It's saved in this browser — come back anytime and it'll still be here.</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 10, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#93c5fd", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>USDC BALANCE</div>
                <div style={{ fontSize: 18, color: "#e2e8f0", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {loadingBalances && !balances ? "..." : balances?.usdc ?? "0.00"}
                </div>
              </div>
              <div style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: 10, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#c4b5fd", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>EURC BALANCE</div>
                <div style={{ fontSize: 18, color: "#e2e8f0", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {loadingBalances && !balances ? "..." : balances?.eurc ?? "0.00"}
                </div>
              </div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 4 }}>ADDRESS</div>
                <div style={{ fontSize: 13, color: "#e2e8f0", fontFamily: "monospace", wordBreak: "break-all" }}>{wallet.address}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 4 }}>BLOCKCHAIN</div>
                <div style={{ fontSize: 13, color: "#e2e8f0" }}>{wallet.blockchain}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 4 }}>WALLET ID</div>
                <div style={{ fontSize: 11, color: "#475569", fontFamily: "monospace" }}>{wallet.walletId}</div>
              </div>
            </div>

            <p style={{ fontSize: 11, color: "#64748b", textAlign: "center", margin: 0 }}>
              Send testnet USDC or EURC to this address from the Faucet or another wallet — your balance above will update automatically.
            </p>

            <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(79,70,229,0.25)", background: "rgba(79,70,229,0.06)", color: "#818cf8", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
              View on Explorer ↗
            </a>
            <button onClick={forgetWallet}
              style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Create Another
            </button>
          </>
        )}
      </div>
    </div>
  );
}
