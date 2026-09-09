import { useState } from "react";

// Real official token logos, hosted on Circle's own documentation site.
const TOKEN_LOGO: Record<string, string> = {
  USDC: "https://mintcdn.com/circle-167b8d39/K2XWSLhaeRomzNa1/images/assets/USDC_Token.svg?fit=max&auto=format&n=K2XWSLhaeRomzNa1&q=85&s=c89754c1e0dd17b3e1e1b0f32e256c9a",
  EURC: "https://mintcdn.com/circle-167b8d39/K2XWSLhaeRomzNa1/images/assets/EURC_Token.svg?fit=max&auto=format&n=K2XWSLhaeRomzNa1&q=85&s=aae9cb36a2c95fb27b5b6ace4bfd2b3c",
  USYC: "https://mintcdn.com/circle-167b8d39/aiB-bUrkHkvhZQyE/images/assets/USYC_Token.png?fit=max&auto=format&n=aiB-bUrkHkvhZQyE&q=85&s=bcff561a269ee14bdc298ea324250f8f",
  CIRBTC: "https://mintcdn.com/circle-167b8d39/VmGNa1qFYaZh1eRy/images/assets/cirBTC_Token.svg?fit=max&auto=format&n=VmGNa1qFYaZh1eRy&q=85&s=bd0b164706c925a022fc620e9088a7e1",
};

const TOKEN_FALLBACK: Record<string, { letter: string; color: string }> = {
  USDC: { letter: "$", color: "#2775CA" },
  EURC: { letter: "€", color: "#22C55E" },
  USYC: { letter: "Y", color: "#F59E0B" },
  CIRBTC: { letter: "₿", color: "#C2410C" },
};

export function TokenIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const key = symbol.toUpperCase();
  const logo = TOKEN_LOGO[key];
  const fallback = TOKEN_FALLBACK[key] ?? { letter: symbol.charAt(0), color: "#6D5EF7" };

  if (logo && !imgFailed) {
    return (
      <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img
          src={logo}
          width={size} height={size} alt={symbol}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: fallback.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", fontWeight: 700, fontSize: size * 0.45 }}>
      {fallback.letter}
    </div>
  );
}
