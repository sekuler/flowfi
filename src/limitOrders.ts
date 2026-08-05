// Price alerts are reminder-based, not background orders — same honesty note
// as DCA: there's no server-side executor, so this checks the live price
// whenever the app is open and lets you execute in one click when triggered.
const LIMIT_ORDERS_KEY = "flowfi-limit-orders";

export interface LimitOrder {
  id: number;
  market: "BTC" | "ETH";
  direction: "above" | "below";
  triggerPrice: number;
  isLong: boolean;
  margin: number;
  leverage: number;
  createdAt: number;
}

export function getLimitOrders(): LimitOrder[] {
  try {
    return JSON.parse(localStorage.getItem(LIMIT_ORDERS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addLimitOrder(order: Omit<LimitOrder, "id" | "createdAt">): LimitOrder {
  const orders = getLimitOrders();
  const newOrder: LimitOrder = { ...order, id: Date.now(), createdAt: Date.now() };
  localStorage.setItem(LIMIT_ORDERS_KEY, JSON.stringify([...orders, newOrder]));
  return newOrder;
}

export function removeLimitOrder(id: number) {
  const orders = getLimitOrders().filter((o) => o.id !== id);
  localStorage.setItem(LIMIT_ORDERS_KEY, JSON.stringify(orders));
}

export function isOrderTriggered(order: LimitOrder, currentPrice: number): boolean {
  return order.direction === "below" ? currentPrice <= order.triggerPrice : currentPrice >= order.triggerPrice;
}
