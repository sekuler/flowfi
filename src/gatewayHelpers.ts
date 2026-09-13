// Circle Gateway helpers — unified USDC balance across chains.
// Verified live and working on Arc Testnet (domain 26) as of today: a real
// deposit + balance check round-tripped successfully via the public Gateway
// testnet API and the official Gateway Wallet contract.
//
// Gateway Wallet + Minter contracts share the SAME address across every
// supported EVM testnet (Arc, Ethereum Sepolia, Base Sepolia, Arbitrum
// Sepolia, etc.) — confirmed via GET /v1/info.

import { GATEWAY_WALLET_ADDRESS, GATEWAY_MINTER_ADDRESS } from "./contracts";
export { GATEWAY_WALLET_ADDRESS, GATEWAY_MINTER_ADDRESS };

export const GATEWAY_API_BASE = "https://gateway-api-testnet.circle.com";

// Same domain IDs as CCTP — Gateway reuses them.
export const GATEWAY_DOMAINS = {
  "Arc Testnet": 26,
  "Ethereum Sepolia": 0,
  "Base Sepolia": 6,
  "Arbitrum Sepolia": 3,
} as const;

export type GatewayChainKey = keyof typeof GATEWAY_DOMAINS;

export const GATEWAY_WALLET_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export interface GatewayBalanceResult {
  domain: number;
  depositor: string;
  balance: string; // human-readable, e.g. "5.000000"
  pendingBatch: string;
}

/**
 * Reads the current unified Gateway balance for an address on a given domain.
 * This is a public, unauthenticated endpoint — safe to call directly from
 * the browser, no backend proxy needed.
 */
export async function getGatewayBalance(address: string, domain: number): Promise<GatewayBalanceResult | null> {
  try {
    const res = await fetch(`${GATEWAY_API_BASE}/v1/balances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        token: "USDC",
        sources: [{ domain, depositor: address }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data?.balances?.[0];
    if (!entry) return null;
    return {
      domain: entry.domain,
      depositor: entry.depositor,
      balance: String(entry.balance ?? "0"),
      pendingBatch: String(entry.pendingBatch ?? "0"),
    };
  } catch {
    return null;
  }
}

/**
 * Reads the unified balance across ALL supported FlowFi chains at once,
 * summed — this is what "one balance across 4 chains" actually looks like
 * in practice, not just a marketing line.
 */
export async function getUnifiedGatewayBalance(address: string): Promise<{ total: number; byChain: Record<string, number>; pendingByChain: Record<string, number> }> {
  const entries = await Promise.all(
    (Object.entries(GATEWAY_DOMAINS) as [GatewayChainKey, number][]).map(async ([chainName, domain]) => {
      const result = await getGatewayBalance(address, domain);
      if (!result) return [chainName, 0, 0] as const;
      const pending = parseFloat(result.pendingBatch);
      // `balance` alone includes any amount currently tied up in an
      // in-flight/unresolved burn intent (`pendingBatch`) — every failed
      // transfer attempt can leave some USDC stuck there until it clears.
      // Subtracting it is what actually matches what Circle's attestation
      // endpoint will accept for a NEW burn. Showing raw `balance` (as this
      // used to) let the UI claim more was spendable than Circle would
      // actually honor — which is exactly why "Only 2.99 USDC available"
      // still got rejected as insufficient for a 1 USDC transfer: the real
      // spendable amount, net of a stuck pendingBatch, was lower.
      const available = Math.max(0, parseFloat(result.balance) - pending);
      return [chainName, available, pending] as const;
    })
  );
  const byChain = Object.fromEntries(entries.map(([c, a]) => [c, a]));
  const pendingByChain = Object.fromEntries(entries.map(([c, , p]) => [c, p]));
  const total = entries.reduce((sum, [, val]) => sum + val, 0);
  return { total, byChain, pendingByChain };
}
