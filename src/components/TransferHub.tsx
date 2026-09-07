import { useState } from "react";
import type { EIP1193Provider } from "viem";
import BridgeForm from "./BridgeForm";
import GatewayPanel from "./GatewayPanel";
import { useIsMobile } from "../useIsMobile";

interface Props {
  provider: EIP1193Provider;
  address: string;
  walletName: string;
  onNavigate?: (tab: "swap") => void;
}

export default function TransferHub({ provider, address, walletName, onNavigate }: Props) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<"bridge" | "gateway">("bridge");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", gap: 8, maxWidth: isMobile ? undefined : 420 }}>
        <button onClick={() => setMode("bridge")}
          style={{ flex: 1, padding: "0.7rem", borderRadius: 12, border: "none", background: mode === "bridge" ? "#ede9fe" : "#ffffff", color: mode === "bridge" ? "#5B21B6" : "#4B5563", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          Bridge
          <div style={{ fontSize: 10.5, fontWeight: 500, color: mode === "bridge" ? "#7C3AED" : "#9CA3AF", marginTop: 1 }}>One-off transfer, any chain pair</div>
        </button>
        <button onClick={() => setMode("gateway")}
          style={{ flex: 1, padding: "0.7rem", borderRadius: 12, border: "none", background: mode === "gateway" ? "#ede9fe" : "#ffffff", color: mode === "gateway" ? "#5B21B6" : "#4B5563", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
          Gateway
          <div style={{ fontSize: 10.5, fontWeight: 500, color: mode === "gateway" ? "#7C3AED" : "#9CA3AF", marginTop: 1 }}>Deposit once, move instantly &lt;500ms</div>
        </button>
      </div>

      {mode === "bridge"
        ? <BridgeForm provider={provider} address={address} walletName={walletName} onNavigate={onNavigate} />
        : <GatewayPanel provider={provider} address={address} />}
    </div>
  );
}
