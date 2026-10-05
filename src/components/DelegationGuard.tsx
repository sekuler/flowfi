import { useEffect, useState } from "react";
import type { EIP1193Provider } from "viem";
import { ShieldAlert, X } from "lucide-react";

// EIP-7702 lets a normal wallet address hand its code over to a contract.
// Drainer sites trick people into signing that delegation, after which a
// "sweeper" contract empties anything sent to the address. On-chain, a
// delegated address's code is 0xef0100 + the 20-byte delegate address.
// We check the connected address and warn if it points to a contract that
// isn't one of the major wallets' own official delegators.

// Official wallet delegators (same address on every chain, CREATE2).
// Verified 2026-10-05 against Etherscan labels / official GitHub repos.
const KNOWN_DELEGATES: Record<string, string> = {
  "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b": "MetaMask", // Etherscan: "MetaMask: EIP-7702 Delegator"
  "0x7702cb554e6bfb442cb743a7df23154544a7176c": "Coinbase", // base/eip-7702-proxy: EIP7702Proxy
  "0x80296ff8d1ed46f8e3c7992664d13b833504c2bb": "OKX", // Etherscan: "OKX: EIP-7702 Delegator"
  "0xe40ccb2d94975c51bff0c004efdfd9b3a5796fa4": "OKX", // okxlabs/okx-smart-wallet-evm: SmartWalletEntry
};

const CHAINS: { id: number; name: string; rpc: string; explorer: string }[] = [
  { id: 5042, name: "Arc", rpc: "/api/rpc-proxy?network=mainnet", explorer: "https://arc.etherscan.io" },
  { id: 1, name: "Ethereum", rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io" },
  { id: 8453, name: "Base", rpc: "https://base-rpc.publicnode.com", explorer: "https://basescan.org" },
  { id: 42161, name: "Arbitrum", rpc: "https://arbitrum-one-rpc.publicnode.com", explorer: "https://arbiscan.io" },
  { id: 10, name: "Optimism", rpc: "https://optimism-rpc.publicnode.com", explorer: "https://optimistic.etherscan.io" },
  { id: 56, name: "BNB Chain", rpc: "https://bsc-rpc.publicnode.com", explorer: "https://bscscan.com" },
];

interface Finding { chain: string; delegate: string; explorer?: string }

function delegateFromCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const c = code.toLowerCase();
  if (!c.startsWith("0xef0100") || c.length !== 48) return null;
  return "0x" + c.slice(8);
}

async function getCode(rpc: string, address: string): Promise<string | null> {
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    return delegateFromCode(d?.result);
  } catch {
    return null; // a chain that can't be reached just isn't checked
  }
}

export default function DelegationGuard({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  // Closing only hides it until the wallet is connected again (or the page reloads).
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFindings([]);
    setDismissed(false);

    (async () => {
      const results: Finding[] = [];
      const checked = new Set<number>();
      await Promise.all(CHAINS.map(async (c) => {
        const d = await getCode(c.rpc, address);
        checked.add(c.id);
        if (d && !KNOWN_DELEGATES[d]) results.push({ chain: c.name, delegate: d, explorer: c.explorer });
      }));
      // Also check whatever chain the wallet itself is on, through the wallet's own RPC,
      // so chains not in the list above are covered too.
      if (provider) {
        try {
          const idHex = (await provider.request({ method: "eth_chainId" })) as string;
          const id = parseInt(idHex, 16);
          if (!checked.has(id)) {
            const code = await provider.request({ method: "eth_getCode", params: [address as `0x${string}`, "latest"] });
            const d = delegateFromCode(code);
            if (d && !KNOWN_DELEGATES[d]) results.push({ chain: `chain ${id}`, delegate: d });
          }
        } catch { /* wallet refused or doesn't support it: skip */ }
      }
      if (!cancelled) setFindings(results);
    })();

    return () => { cancelled = true; };
  }, [address, provider]);

  if (findings.length === 0 || dismissed) return null;

  const chains = findings.map((f) => f.chain).join(", ");
  const first = findings[0];

  return (
    <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "0.9rem 1.25rem", margin: "1rem auto 0", maxWidth: 1200, background: "#FDECEC", border: "1px solid #F5B5B5", borderRadius: 14, color: "#7A1414", fontSize: 13.5, lineHeight: 1.5 }}>
      <ShieldAlert size={20} style={{ flexShrink: 0, marginTop: 1, color: "#C62828" }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Your wallet is linked to an unknown contract</div>
        On {chains}, this address has handed control to a contract that isn't a known wallet provider
        {" "}(
        {first.explorer
          ? <a href={`${first.explorer}/address/${first.delegate}`} target="_blank" rel="noopener noreferrer" style={{ color: "#7A1414", fontWeight: 600 }}>{first.delegate.slice(0, 6)}…{first.delegate.slice(-4)}</a>
          : <span style={{ fontWeight: 600 }}>{first.delegate.slice(0, 6)}…{first.delegate.slice(-4)}</span>}
        ). If you didn't turn on a smart account yourself, this is how many wallet drainers work: anything you send to this address can be taken right away. Don't send funds here, and move to a new wallet.
      </div>
      <button onClick={() => setDismissed(true)}
        aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "#7A1414", padding: 2 }}>
        <X size={16} />
      </button>
    </div>
  );
}
