import { useState } from "react";

// Delivers USDC to Base mainnet via MoonPay's "usdc_base" currency.
//
// Deliberately NOT "usdc_arc", even though MoonPay supports it directly:
// Circle's Developer-Controlled Wallets API doesn't support signing
// transactions on Arc mainnet (only ARC-TESTNET is in their supported
// blockchain list) -- USDC landing straight on Arc would sit in the
// wallet with no way to move it again, since Circle can't sign there and
// this wallet type never exposes a private key to fall back on. Base is
// fully supported, so funds land somewhere this wallet can actually act
// on. Moving Base -> Arc is a separate bridge-execution step.
const MOONPAY_WIDGET_BASE = "https://buy.moonpay.com"; // sandbox: https://buy-sandbox.moonpay.com

export default function MoonPayBuyButton({ walletAddress }: { walletAddress: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openMoonPay() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        apiKey: import.meta.env.VITE_MOONPAY_PUBLISHABLE_KEY,
        currencyCode: "usdc_base",
        walletAddress,
        baseCurrencyCode: "try",
        redirectURL: window.location.href,
      });
      const unsignedUrl = `${MOONPAY_WIDGET_BASE}?${params.toString()}`;

      const res = await fetch("/api/moonpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign", url: unsignedUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Couldn't prepare the checkout link.");
      }

      const signedUrl = `${unsignedUrl}&signature=${encodeURIComponent(data.signature)}`;
      window.open(signedUrl, "_blank", "noopener,noreferrer,width=480,height=720");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={openMoonPay}
        disabled={loading}
        style={{
          width: "100%", padding: "0.9rem", borderRadius: 14, border: "none",
          background: loading ? "#93C5FD" : "#7B3FE4", color: "#fff", fontSize: 15, fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Opening..." : "Buy USDC with card"}
      </button>
      {error && <div style={{ fontSize: 11.5, color: "#DC2626", marginTop: 8 }}>{error}</div>}
    </div>
  );
}
