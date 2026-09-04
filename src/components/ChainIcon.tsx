import { useState } from "react";

// Real chain logos from DefiLlama's public icon CDN, by chain-brand slug. Arc has no
// confirmed DefiLlama entry (too new), so it always uses the hand-drawn fallback below.
// A couple of these slugs (world_chain, plume, optimism) aren't independently confirmed —
// if a slug is wrong the <img> below fails to load and we fall back automatically, so a
// wrong guess never shows a broken image, just the hand-drawn version.
const DEFILLAMA_SLUG: Record<string, string> = {
  "Ethereum Sepolia": "ethereum",
  "Base Sepolia": "base",
  "Arbitrum Sepolia": "arbitrum",
  "Linea Sepolia": "linea",
  "Optimism Sepolia": "optimism",
  "Polygon Amoy": "polygon",
  "Avalanche Fuji": "avalanche",
  "Sonic Testnet": "sonic",
  "Unichain Sepolia": "unichain",
  "World Chain Sepolia": "world_chain",
  "Ink Sepolia": "ink",
  "Plume Testnet": "plume",
  "Sei Testnet": "sei",
  "HyperEVM Testnet": "hyperliquid",
};

export function ChainIcon({ name, size = 22 }: { name: string; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const slug = DEFILLAMA_SLUG[name];
  if (slug && !imgFailed) {
    return (
      <img
        src={`https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg`}
        width={size} height={size} alt={name}
        style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, display: "block" }}
        onError={() => setImgFailed(true)}
      />
    );
  }
  return <ChainIconFallback name={name} size={size} />;
}

function ChainIconFallback({ name, size = 22 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24" };
  switch (name) {
    case "Arc Testnet":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#0E1E3D" />
          <path d="M6.3 19.5 C6.3 9.5 8.3 3.3 12 3.3 C15.7 3.3 17.7 9.3 17.7 14.3" stroke="#E7EBF3" strokeWidth="2.9" fill="none" strokeLinecap="round" />
          <path d="M11 13.2 L15 13.2" stroke="#E7EBF3" strokeWidth="2.7" strokeLinecap="round" />
          <path d="M17.7 14.3 C17.7 17.6 15.6 19.3 12.8 18.7" stroke="#E7EBF3" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "Ethereum Sepolia":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#627eea" />
          <path d="M12 3l5.5 9.2L12 15.5 6.5 12.2 12 3z" fill="#fff" fillOpacity="0.9" />
          <path d="M12 16.8l5.5-3.9L12 21l-5.5-8.1 5.5 3.9z" fill="#fff" fillOpacity="0.7" />
        </svg>
      );
    case "Base Sepolia":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#0052ff" />
          <rect x="7.2" y="11.2" width="9.6" height="1.6" rx="0.8" fill="#fff" />
        </svg>
      );
    case "Arbitrum Sepolia":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#213147" />
          <path d="M12 4.5l6 3.4v8.2l-6 3.4-6-3.4V7.9l6-3.4z" fill="none" stroke="#28a0f0" strokeWidth="1.3" />
          <path d="M9.5 15.5l2-6.5 1 3-1.6 4.4-1.4-.9z" fill="#28a0f0" />
          <path d="M13.2 8.8L15.5 15.5l-1.5.9-1.8-5.1 1-2.5z" fill="#fff" />
        </svg>
      );
    case "Linea Sepolia":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#121212" />
          <path d="M8.5 7.5v7.6h5.4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="7.5" r="1.3" fill="#fff" />
        </svg>
      );
    case "Optimism Sepolia":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#FF0420" />
          <circle cx="12" cy="12" r="5.2" fill="none" stroke="#fff" strokeWidth="2.1" />
        </svg>
      );
    case "Polygon Amoy":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#7B3FE4" />
          <path d="M15.5 8.5l2.3 1.3v2.6l-2.3 1.3-2.3-1.3v-1.3l1.2-.7v1.3l1.1.6 1.1-.6V10l-1.1-.6-1.1.6-1.2-.7 2.3-1.3z" fill="#fff" />
          <path d="M8.5 15.5l-2.3-1.3v-2.6l2.3-1.3 2.3 1.3v1.3l-1.2.7v-1.3l-1.1-.6-1.1.6V14l1.1.6 1.1-.6 1.2.7-2.3 1.3z" fill="#fff" />
        </svg>
      );
    case "Avalanche Fuji":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#E84142" />
          <path d="M9.3 16h-2l3.4-6 1 1.8-2.4 4.2z" fill="#fff" />
          <path d="M12.6 8l3.8 8h-2.2l-1-2h-2.9l1-1.8h1l-1-2 1.3-2.2z" fill="#fff" />
        </svg>
      );
    case "Sonic Testnet":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#fff" />
          <path d="M6 13c2-4 4.5-6 8-4.5-3 .5-4.5 2-5.5 4.5-1.5 3.5-3.5 2.5-2.5 0z" fill="#111" />
          <path d="M18 11c-2 4-4.5 6-8 4.5 3-.5 4.5-2 5.5-4.5 1.5-3.5 3.5-2.5 2.5 0z" fill="#111" />
        </svg>
      );
    case "Unichain Sepolia":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#F50DB4" />
          <path d="M12 5l1.4 5.6L19 12l-5.6 1.4L12 19l-1.4-5.6L5 12l5.6-1.4L12 5z" fill="#fff" />
        </svg>
      );
    case "World Chain Sepolia":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#fff" />
          <ellipse cx="12" cy="12" rx="7" ry="3.4" fill="none" stroke="#111" strokeWidth="1.3" />
          <circle cx="12" cy="12" r="3" fill="none" stroke="#111" strokeWidth="1.3" />
        </svg>
      );
    case "Ink Sepolia":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#7132F5" />
          <path d="M9 8c0 2 3 2 3 4s-3 2-3 4M15 8c0 2-3 2-3 4s3 2 3 4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "Plume Testnet":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#FF6B35" />
          <rect x="6.5" y="9" width="7" height="7" rx="1.6" fill="none" stroke="#fff" strokeWidth="1.5" transform="rotate(-10 10 12.5)" />
          <rect x="10.5" y="8" width="7" height="7" rx="1.6" fill="none" stroke="#fff" strokeWidth="1.5" transform="rotate(10 14 11.5)" />
        </svg>
      );
    case "Sei Testnet":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#8B1A2B" />
          <path d="M5.5 9c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M5.5 12.8c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M5.5 16.6c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "HyperEVM Testnet":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#0A2E2C" />
          <path d="M9 7c-2.5 1.5-3.5 4-2.5 6.5C7.5 16 10 17 12.5 16c2-.8 3-2.5 2-4-1-1.6-3-1.4-3.5.3-.4 1.5.7 2.7 2 2.2" fill="none" stroke="#7EF5D6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#9CA3AF" />
        </svg>
      );
  }
}
