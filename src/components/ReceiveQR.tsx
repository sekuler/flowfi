import { useState, useEffect } from "react";
import QRCode from "qrcode";

interface Props {
  address: string;
}

export default function ReceiveQR({ address }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(address, {
      width: 220,
      margin: 1,
      color: { dark: "#0c0f1d", light: "#f8fafc" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [address]);

  function copyAddress() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", maxWidth: 360, margin: "0 auto" }}>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%" }}>
        <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, textAlign: "center" }}>
          Scan to send USDC, EURC, or ARC to this wallet
        </div>

        {qrDataUrl ? (
          <div style={{ background: "#f8fafc", borderRadius: 12, padding: 12 }}>
            <img src={qrDataUrl} alt="Wallet address QR code" width={220} height={220} style={{ display: "block" }} />
          </div>
        ) : (
          <div style={{ width: 220, height: 220, borderRadius: 12, background: "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 12 }}>
            Generating QR code...
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: "100%" }}>
          <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px" }}>YOUR ADDRESS</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontFamily: "monospace", wordBreak: "break-all", textAlign: "center" }}>
            {address}
          </div>
        </div>

        <button onClick={copyAddress}
          style={{ width: "100%", padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(79,70,229,0.25)", background: copied ? "rgba(16,185,129,0.1)" : "rgba(79,70,229,0.08)", color: copied ? "#6ee7b7" : "#818cf8", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {copied ? "Copied!" : "Copy Address"}
        </button>
      </div>

      <div style={{ fontSize: 11, color: "#334155", textAlign: "center" }}>
        This address works on Arc Testnet only.
      </div>
    </div>
  );
}