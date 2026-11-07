// Mainnet Copilot hand-off: what the user typed ("bridge 2 USDC from Base to Arc",
// "swap 1 USDC to EURC") is passed to the Bridge / Swap page so the form opens
// already filled in. Nothing is signed here — the user still reviews and confirms
// in their own wallet. Kept in sessionStorage for a page that mounts after the
// navigation, and sent as an event for a page that is already open.

export type CopilotPrefill =
  | { kind: "swap"; fromToken: string; toToken: string; amount: string }
  | { kind: "bridge"; fromChain: string; amount: string };

const KEY = "flowfi-copilot-prefill";
export const COPILOT_PREFILL_EVENT = "flowfi-copilot-prefill";

export function setCopilotPrefill(p: CopilotPrefill) {
  try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent<CopilotPrefill>(COPILOT_PREFILL_EVENT, { detail: p }));
}

// Returns the stored prefill only if it is for this page, and clears it so it is used once.
export function takeCopilotPrefill<K extends CopilotPrefill["kind"]>(kind: K): Extract<CopilotPrefill, { kind: K }> | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as CopilotPrefill;
    if (p.kind !== kind) return null;
    sessionStorage.removeItem(KEY);
    return p as Extract<CopilotPrefill, { kind: K }>;
  } catch { return null; }
}

export function clearCopilotPrefill() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
