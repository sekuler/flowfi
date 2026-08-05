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
// registry. For an address other people can actually resolve, use a .arc name.
export function getNickname(): string | null {
  return localStorage.getItem(NICKNAME_KEY);
}

export function setNickname(name: string) {
  localStorage.setItem(NICKNAME_KEY, name.trim());
}

export function clearNickname() {
  localStorage.removeItem(NICKNAME_KEY);
}
