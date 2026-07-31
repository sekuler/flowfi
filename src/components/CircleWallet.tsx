import { useState, useEffect } from "react";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { arcTestnet } from "../chains";
import { getCircleWallet, saveCircleWallet, forgetCircleWallet, type CircleWalletInfo } from "../circleWalletHelpers";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const CIRBTC_ADDRESS = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" as `0x${string}`;

export default function CircleWallet() {
  const [wallet, setWallet] = useState<CircleWalletInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ usdc: string; eurc: string; cirbtc: string } | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [showRestore, setShowRestore] = useState(false);
  const [pastWallets, setPastWallets] = useState<CircleWalletInfo[]>([]);
  const [loadingPast, setLoadingPast] = useState(false);
  const [hiddenAddresses, setHiddenAddresses] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("flowfi_circle_hidden_wallets") ?? "[]");
    } catch {
      return [];
    }
  });
  const [showHidden, setShowHidden] = useState(false);

  function hideWallet(addr: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = [...hiddenAddresses, addr.toLowerCase()];
    setHiddenAddresses(updated);
    localStorage.setItem("flowfi_circle_hidden_wallets", JSON.stringify(updated));
  }

  function unhideWallet(addr: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = hiddenAddresses.filter((a) => a !== addr.toLowerCase());
    setHiddenAddresses(updated);
    localStorage.setItem("flowfi_circle_hidden_wallets", JSON.stringify(updated));
  }

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
      const newWallet: CircleWalletInfo = { address: data.address, walletsByChain: data.walletsByChain };
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
  }

  async function loadPastWallets() {
    setLoadingPast(true);
    setError(null);
    try {
      const res = await fetch("/api/circle-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listWallets" }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Failed to load past wallets.");
      setPastWallets(data.wallets);
      setShowRestore(true);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Failed to load past wallets.");
    } finally {
      setLoadingPast(false);
    }
  }

  function restoreWallet(w: CircleWalletInfo) {
    setWallet(w);
    saveCircleWallet(w);
    setShowRestore(false);
  }

  const chainList = wallet ? Object.keys(wallet.walletsByChain) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%", maxWidth: 460 }}>
      <div style={{ background: "rgba(52,211,153,0.1)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#6ee7b7", margin: 0 }}>
          Powered by Circle Developer-Controlled Wallets — no seed phrase, no browser extension. One address works across Arc, Ethereum Sepolia, Base Sepolia, and Arbitrum Sepolia.
        </p>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
        {!wallet && !showRestore && (
          <>
            <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>
              Create a Circle-managed wallet in one click. No extension, no private key to store. This wallet is yours — it stays linked to your browser, works across four testnets, and holds real testnet balances.
            </p>
            {error && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 12, wordBreak: "break-word" }}>{error}</div>}
            <button onClick={createWallet} disabled={loading}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#34d399", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Creating wallet..." : "Create Circle Wallet"}
            </button>
            <button onClick={loadPastWallets} disabled={loadingPast}
              style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "#f5f3ff", color: "#a855f7", fontSize: 13, fontWeight: 600, cursor: loadingPast ? "not-allowed" : "pointer" }}>
              {loadingPast ? "Loading..." : "Restore a previous wallet"}
            </button>
          </>
        )}

        {showRestore && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>Pick a wallet to restore:</p>
              <button onClick={() => setShowRestore(false)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 12, cursor: "pointer" }}>Cancel</button>
            </div>
            {error && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 12, wordBreak: "break-word" }}>{error}</div>}
            {pastWallets.length === 0 && <p style={{ fontSize: 12, color: "#475569" }}>No previous wallets found.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {pastWallets.filter((w) => showHidden || !hiddenAddresses.includes(w.address.toLowerCase())).map((w) => {
                const isHidden = hiddenAddresses.includes(w.address.toLowerCase());
                return (
                  <div key={w.address} style={{ display: "flex", alignItems: "center", gap: 6, opacity: isHidden ? 0.4 : 1 }}>
                    <button onClick={() => restoreWallet(w)}
                      style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, textAlign: "left", padding: "0.75rem 0.9rem", borderRadius: 12, border: "none", background: "#f5f3ff", cursor: "pointer" }}>
                      <span style={{ fontSize: 12, color: "#1e293b", fontFamily: "ui-monospace, monospace" }}>{w.address}</span>
                      <span style={{ fontSize: 11, color: "#64748b" }}>{Object.keys(w.walletsByChain).length} chain(s){isHidden ? " · hidden" : ""}</span>
                    </button>
                    {isHidden ? (
                      <button onClick={(e) => unhideWallet(w.address, e)} title="Unhide"
                        style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: "none", background: "#f5f3ff", color: "#a855f7", fontSize: 13, cursor: "pointer" }}>
                        ↺
                      </button>
                    ) : (
                      <button onClick={(e) => hideWallet(w.address, e)} title="Hide from this list"
                        style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: "none", background: "#f5f3ff", color: "#64748b", fontSize: 14, cursor: "pointer" }}>
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {hiddenAddresses.length > 0 && (
              <button onClick={() => setShowHidden(!showHidden)}
                style={{ background: "none", border: "none", color: "#64748b", fontSize: 11, cursor: "pointer", padding: 0, alignSelf: "flex-start" }}>
                {showHidden ? "Hide hidden wallets" : `Show ${hiddenAddresses.length} hidden wallet(s)`}
              </button>
            )}
          </>
        )}

        {wallet && !showRestore && (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <p style={{ fontSize: 14, color: "#6ee7b7", fontWeight: 700, margin: 0 }}>This is your wallet</p>
              <p style={{ fontSize: 12, color: "#64748b", margin: 0, textAlign: "center" }}>Saved in this browser — same address on every supported chain.</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 10, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#a855f7", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>USDC</div>
                <div style={{ fontSize: 16, color: "#1e293b", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {loadingBalances && !balances ? "..." : balances?.usdc ?? "0.00"}
                </div>
              </div>
              <div style={{ background: "rgba(168,85,247,0.1)", borderRadius: 10, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#c4b5fd", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>EURC</div>
                <div style={{ fontSize: 16, color: "#1e293b", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {loadingBalances && !balances ? "..." : balances?.eurc ?? "0.00"}
                </div>
              </div>
              <div style={{ background: "rgba(249,115,22,0.1)", borderRadius: 10, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#fdba74", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>cirBTC</div>
                <div style={{ fontSize: 16, color: "#1e293b", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                  {loadingBalances && !balances ? "..." : balances?.cirbtc ?? "0.000000"}
                </div>
              </div>
            </div>

            <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "1rem" }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 6 }}>ADDRESS (SAME ON ALL CHAINS)</div>
              <div style={{ fontSize: 13, color: "#1e293b", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>{wallet.address}</div>
            </div>

            <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "1rem" }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 8 }}>AVAILABLE ON</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {chainList.map((chain) => (
                  <div key={chain} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: "#94a3b8" }}>{chain.replace("-", " ")}</span>
                    <span style={{ color: "#a855f7", fontWeight: 600 }}>✓ Ready</span>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ fontSize: 11, color: "#64748b", textAlign: "center", margin: 0 }}>
              Send testnet USDC from the Faucet to this address on any of the chains above — your balance will update automatically.
            </p>

            <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "0.75rem", borderRadius: 12, border: "none", background: "rgba(168,85,247,0.1)", color: "#c4b5fd", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
              View on Explorer ↗
            </a>
            <button onClick={forgetWallet}
              style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: "transparent", color: "#64748b", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Create Another
            </button>
            <button onClick={loadPastWallets} disabled={loadingPast}
              style={{ width: "100%", padding: "0.6rem", borderRadius: 10, border: "none", background: "transparent", color: "#a855f7", fontSize: 12, fontWeight: 600, cursor: loadingPast ? "not-allowed" : "pointer" }}>
              {loadingPast ? "Loading..." : "Switch to a previous wallet"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
