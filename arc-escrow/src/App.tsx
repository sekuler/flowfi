import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import WalletConnect from "./components/WalletConnect";
import EscrowCreate, { type EscrowItem } from "./components/EscrowCreate";
import EscrowList from "./components/EscrowList";

interface WalletInfo {
  provider: EIP1193Provider;
  address: string;
  walletName: string;
}

type Tab = "create" | "list";

export default function App() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [tab, setTab] = useState<Tab>("list");
  const [escrows, setEscrows] = useState<EscrowItem[]>([]);

  function handleConnected(provider: EIP1193Provider, address: string, walletName: string) {
    setWallet({ provider, address, walletName });
  }

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("arc-escrows") ?? "[]");
    setEscrows(saved);
  }, []);

  function handleCreated(escrow: EscrowItem) {
    setEscrows(prev => [escrow, ...prev]);
    setTab("list");
  }

  const shortAddr = wallet ? wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4) : "";

  if (!wallet) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#080b14", padding: "2rem", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ position: "fixed", top: "20%", left: "30%", width: 600, height: 600, background: "radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "2rem", maxWidth: 440, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: "0 0 40px rgba(79,70,229,0.3)" }}>🔒</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc" }}>Arc Escrow</div>
              <div style={{ fontSize: 11, color: "#4f46e5", fontWeight: 700, letterSpacing: "3px", marginTop: 2 }}>TESTNET</div>
            </div>
            <p style={{ fontSize: 14, color: "#64748b", textAlign: "center", maxWidth: 340 }}>
              Secure freelance payments on Arc. Lock USDC in escrow, release when work is delivered.
            </p>
          </div>
          <WalletConnect onConnected={handleConnected} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#080b14", fontFamily: "'Inter', system-ui, sans-serif", color: "#f8fafc" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 2rem", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "sticky", top: 0, background: "rgba(8,11,20,0.9)", backdropFilter: "blur(10px)", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🔒</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Arc Escrow</div>
            <div style={{ fontSize: 9, color: "#4f46e5", fontWeight: 700, letterSpacing: "2px" }}>TESTNET</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>{shortAddr}</div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 6, marginBottom: "1.5rem", border: "1px solid rgba(255,255,255,0.07)" }}>
          {[
            { id: "list" as Tab, label: "My Escrows" },
            { id: "create" as Tab, label: "New Escrow" },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ flex: 1, padding: "0.6rem", borderRadius: 10, border: "none", background: tab === id ? "#4f46e5" : "transparent", color: tab === id ? "#fff" : "#64748b", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>

        {tab === "list" && <EscrowList provider={wallet.provider} currentAddress={wallet.address} />}
        {tab === "create" && <EscrowCreate provider={wallet.provider} address={wallet.address} onCreated={handleCreated} />}
      </main>
    </div>
  );
}
function handleUpdate(id: string, status: EscrowItem["status"]) {
  setEscrows(prev => {
    const updated = prev.map(e => e.id === id ? { ...e, status } : e);
    localStorage.setItem("arc-escrows", JSON.stringify(updated));
    return updated;
  });
}