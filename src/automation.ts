// Same honesty note as DCA/Limit Orders: no backend cron exists, so these
// rules are checked whenever the app has your balances loaded (on open and
// on refresh), not truly in the background. You still confirm the action.
const AUTOMATION_RULES_KEY = "flowfi-automation-rules";

export interface AutomationRule {
  id: number;
  condition: "usdc_above";
  conditionValue: number;
  action: "lend";
  actionAmount: number;
  createdAt: number;
  lastTriggeredAt: number | null;
}

export function getRules(): AutomationRule[] {
  try {
    return JSON.parse(localStorage.getItem(AUTOMATION_RULES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addRule(rule: Omit<AutomationRule, "id" | "createdAt" | "lastTriggeredAt">): AutomationRule {
  const rules = getRules();
  const newRule: AutomationRule = { ...rule, id: Date.now(), createdAt: Date.now(), lastTriggeredAt: null };
  localStorage.setItem(AUTOMATION_RULES_KEY, JSON.stringify([...rules, newRule]));
  return newRule;
}

export function removeRule(id: number) {
  const rules = getRules().filter((r) => r.id !== id);
  localStorage.setItem(AUTOMATION_RULES_KEY, JSON.stringify(rules));
}

export function markRuleTriggered(id: number) {
  const rules = getRules().map((r) => r.id === id ? { ...r, lastTriggeredAt: Date.now() } : r);
  localStorage.setItem(AUTOMATION_RULES_KEY, JSON.stringify(rules));
}

// A rule only re-fires once per 24h even if the condition stays true, so it
// doesn't nag on every single balance refresh.
export function isRuleDue(rule: AutomationRule, usdcBalance: number): boolean {
  const conditionMet = rule.condition === "usdc_above" && usdcBalance > rule.conditionValue;
  if (!conditionMet) return false;
  if (!rule.lastTriggeredAt) return true;
  return Date.now() - rule.lastTriggeredAt > 24 * 60 * 60 * 1000;
}
