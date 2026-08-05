// DCA is reminder-based, not a background cron job — this app has no persistent
// server-side scheduler. The plan is stored locally, and FlowFi checks whether
// it's due every time you open the app, then lets you execute it in one click.
const DCA_PLAN_KEY = "flowfi-dca-plan";

export type DCAFrequency = "daily" | "weekly" | "monthly";

export interface DCAPlan {
  amount: number;
  fromToken: "USDC";
  toToken: "EURC";
  frequency: DCAFrequency;
  lastExecuted: number | null; // epoch ms
  createdAt: number;
}

const FREQUENCY_MS: Record<DCAFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function getDCAPlan(): DCAPlan | null {
  try {
    return JSON.parse(localStorage.getItem(DCA_PLAN_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function setDCAPlan(amount: number, frequency: DCAFrequency) {
  const plan: DCAPlan = { amount, fromToken: "USDC", toToken: "EURC", frequency, lastExecuted: null, createdAt: Date.now() };
  localStorage.setItem(DCA_PLAN_KEY, JSON.stringify(plan));
}

export function clearDCAPlan() {
  localStorage.removeItem(DCA_PLAN_KEY);
}

export function markDCAExecuted() {
  const plan = getDCAPlan();
  if (!plan) return;
  plan.lastExecuted = Date.now();
  localStorage.setItem(DCA_PLAN_KEY, JSON.stringify(plan));
}

export function isDCADue(plan: DCAPlan): boolean {
  const reference = plan.lastExecuted ?? plan.createdAt;
  return Date.now() - reference >= FREQUENCY_MS[plan.frequency];
}
