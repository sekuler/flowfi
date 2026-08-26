// Stores a single "what to do after this bridge completes" intent, so
// Copilot can queue a chained request (e.g. "bridge 50 USDC to Arc and
// swap it to EURC") without trying to fragile-orchestrate a multi-minute
// CCTP settlement itself. BridgeForm checks this once it reaches its own
// "done" state and acts on it — the user still lands on a real tab with
// a real confirm step, nothing is silently auto-signed.

export type PendingFollowUp =
  | { action: "swap"; toToken: string }
  | { action: "lending" };

const KEY = "flowfi-pending-followup";

export function setPendingFollowUp(followUp: PendingFollowUp) {
  try {
    localStorage.setItem(KEY, JSON.stringify(followUp));
  } catch {
    /* ignore */
  }
}

export function getPendingFollowUp(): PendingFollowUp | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingFollowUp) : null;
  } catch {
    return null;
  }
}

export function clearPendingFollowUp() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
