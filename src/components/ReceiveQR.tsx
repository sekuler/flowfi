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
      color: { dark: "#111827", light: "#ffffff" },
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
      <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 20, padding: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
        <div style={{ fontSize: 13, color: "#4B5563", fontWeight: 600, textAlign: "center" }}>
          Scan to send USDC or EURC to this wallet
        </div>

        {qrDataUrl ? (
          <div style={{ background: "#ffffff", border: "1px solid #D4C9FA", borderRadius: 12, padding: 12 }}>
            <img src={qrDataUrl} alt="Wallet address QR code" width={220} height={220} style={{ display: "block" }} />
          </div>
        ) : (
          <div style={{ width: 220, height: 220, borderRadius: 12, background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7280", fontSize: 12 }}>
            Generating QR code...
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: "100%" }}>
          <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "1px" }}>YOUR ADDRESS</div>
          <div className="flowfi-mono" style={{ fontSize: 13, color: "#111827", wordBreak: "break-all", textAlign: "center" }}>
  {address}
</div>
        </div>

        <button onClick={copyAddress}
          style={{ width: "100%", padding: "0.75rem", borderRadius: 12, border: "none", background: copied ? "rgba(34,197,94,0.1)" : "rgba(109,94,247,0.1)", color: copied ? "#16A34A" : "#6D5EF7", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {copied ? "Copied!" : "Copy Address"}
        </button>
      </div>

      <div style={{ fontSize: 11, color: "#6B7280", textAlign: "center" }}>
        This address works on Arc Testnet only.
      </div>
    </div>
  );
}
