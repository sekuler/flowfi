// Payment request links: flowfi.finance/?pay=<address>&token=<token contract>&amount=<number>&chain=arc
// Opening one stores the request and cleans the URL; Home then opens Send with the form filled in.
// Nothing is signed automatically — the payer still reviews and confirms in their own wallet.
import { isAddress, getAddress } from "viem";

export type PayLink = { to: `0x${string}`; token: `0x${string}`; amount: string; chain: string };

const KEY = "flowfi-pay-link";
const CHAINS = ["arc", "ethereum", "base", "arbitrum", "avalanche", "worldchain"];

export function buildPayLink(p: PayLink): string {
  const u = new URL(window.location.origin + "/");
  u.searchParams.set("pay", p.to);
  u.searchParams.set("token", p.token);
  if (p.amount) u.searchParams.set("amount", p.amount);
  u.searchParams.set("chain", p.chain);
  return u.toString();
}

// Returns "invalid" when the URL had a pay link that failed validation, so the app can warn.
export function capturePayLink(): "none" | "ok" | "invalid" {
  if (typeof window === "undefined") return "none";
  const q = new URLSearchParams(window.location.search);
  if (!q.has("pay")) return "none";
  const to = (q.get("pay") ?? "").trim();
  const token = (q.get("token") ?? "").trim();
  const amount = (q.get("amount") ?? "").trim();
  const chain = (q.get("chain") ?? "arc").trim().toLowerCase();
  ["pay", "token", "amount", "chain"].forEach((k) => q.delete(k));
  const rest = q.toString();
  window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
  const amountOk = amount === "" || (/^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0);
  if (!isAddress(to) || !isAddress(token) || !CHAINS.includes(chain) || !amountOk) return "invalid";
  const p: PayLink = { to: getAddress(to), token: getAddress(token), amount, chain };
  try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
  return "ok";
}

export function hasPayLink(): boolean {
  try { return !!sessionStorage.getItem(KEY); } catch { return false; }
}

// Used once: reading it clears it.
export function takePayLink(): PayLink | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as PayLink;
  } catch { return null; }
}
