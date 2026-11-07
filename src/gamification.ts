// FlowFi Points: a lightweight, purely local gamification counter. This is
// NOT a real token, NOT backed by a contract, and never claimed to be —
// it just gives the user a small sense of progress for using the app.
const POINTS_KEY = "flowfi-points";
const NICKNAME_KEY = "flowfi-nickname";

export function getPoints(): number {
  return Number(localStorage.getItem(POINTS_KEY) ?? "0");
}

export function addPoints(amount: number): number {
  const next = getPoints() + amount;
  localStorage.setItem(POINTS_KEY, String(next));
  return next;
}

// Local display nickname, shown only in this browser — not a global username
// registry. Stored per address, so switching wallets never shows another wallet's name.
function nicknameKey(address: string) {
  return `${NICKNAME_KEY}-${address.toLowerCase()}`;
}

export function getNickname(address: string): string | null {
  return localStorage.getItem(nicknameKey(address));
}

export function setNickname(address: string, name: string) {
  localStorage.setItem(nicknameKey(address), name.trim());
}

export function clearNickname(address: string) {
  localStorage.removeItem(nicknameKey(address));
}
