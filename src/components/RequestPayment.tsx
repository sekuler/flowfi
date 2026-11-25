import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Check } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import { buildPayLink } from "../payLink";

// Payment request on Arc: the user picks a token and (optionally) an amount, and gets a link + QR.
// Whoever opens it lands on FlowFi's Send screen with this address, token and amount filled in.

const LINE = "#E7E4DD";
const MUTED = "#6B7280";
const INK = "#111827";
const BLUE = "#3D5AF1";

const TOKENS = [
  { symbol: "USDC", address: "0x3600000000000000000000000000000000000000" },
  { symbol: "EURC", address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" },
  { symbol: "cirBTC", address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0" },
] as const;

export default function RequestPayment({ address }: { address: string }) {
  const [sym, setSym] = useState<(typeof TOKENS)[number]["symbol"]>("USDC");
  const [amount, setAmount] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const tok = TOKENS.find((t) => t.symbol === sym)!;
  const amt = amount.trim();
  const amountOk = amt === "" || (/^\d+(\.\d+)?$/.test(amt) && Number(amt) > 0);
  const link = amountOk ? buildPayLink({ to: address as `0x${string}`, token: tok.address, amount: amt, chain: "arc" }) : "";

  useEffect(() => {
    if (!link) { setQr(null); return; }
    let cancelled = false;
    QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: INK, light: "#FFFFFF" } })
      .then((d) => { if (!cancelled) setQr(d); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [link]);

  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }

  const card: React.CSSProperties = { maxWidth: 480, margin: "0 auto", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 28, padding: "1.25rem", boxShadow: "0 24px 60px -16px rgba(61,90,241,0.18)" };
  const box: React.CSSProperties = { background: "#F7F8FF", border: `1px solid ${LINE}`, borderRadius: 18, padding: "0.85rem 1rem" };

  return (
    <div style={card}>
      <style>{`.ff-req-in, .ff-req-in:focus { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; }`}</style>
      <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 2 }}>Request on Arc</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>Share a link or QR code. It opens FlowFi with your address, the token and the amount filled in.</div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {TOKENS.map((t) => {
          const on = t.symbol === sym;
          return (
            <button key={t.symbol} onClick={() => setSym(t.symbol)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.8rem", borderRadius: 999, border: `1px solid ${on ? BLUE : LINE}`, background: on ? BLUE : "#fff", color: on ? "#fff" : INK, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
              <TokenIcon symbol={t.symbol} size={16} /> {t.symbol}
            </button>
          );
        })}
      </div>

      <div style={{ ...box, marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 700, marginBottom: 6 }}>Amount (optional)</div>
        <input className="ff-req-in" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(",", "."))} placeholder="0.00"
          style={{ width: "100%", fontSize: 24, fontWeight: 800, color: INK }} />
      </div>

      {!amountOk && <div style={{ fontSize: 12.5, color: "#B91C1C", marginBottom: 12 }}>Enter a valid amount.</div>}

      {link && (
        <>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            {qr ? <img src={qr} alt="Payment request QR code" width={200} height={200} style={{ borderRadius: 16, border: `1px solid ${LINE}` }} />
              : <div style={{ width: 200, height: 200, borderRadius: 16, background: "#F3F4F6" }} />}
          </div>
          <div style={{ ...box, fontSize: 12, color: MUTED, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", wordBreak: "break-all", marginBottom: 10 }}>{link}</div>
          <button onClick={copy}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0.85rem", borderRadius: 16, border: "none", background: BLUE, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy link</>}
          </button>
        </>
      )}
    </div>
  );
}
