export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

export interface Notification {
  id: number;
  message: string;
  type: ToastType;
  timestamp: number;
  read: boolean;
}

type Listener = (toasts: ToastMessage[]) => void;
type NotificationListener = (notifications: Notification[]) => void;

let toasts: ToastMessage[] = [];
let listeners: Listener[] = [];
let nextId = 1;

const NOTIFICATIONS_KEY = "flowfi-notifications";
const MAX_NOTIFICATIONS = 50;

let notificationListeners: NotificationListener[] = [];

function loadNotifications(): Notification[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveNotifications(items: Notification[]) {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(items));
}

function notifyToasts() {
  listeners.forEach((l) => l([...toasts]));
}

function notifyNotifications(items: Notification[]) {
  notificationListeners.forEach((l) => l(items));
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function subscribeNotifications(listener: NotificationListener): () => void {
  notificationListeners.push(listener);
  listener(loadNotifications()); // send current state immediately on subscribe
  return () => {
    notificationListeners = notificationListeners.filter((l) => l !== listener);
  };
}

export function markAllNotificationsRead() {
  const items = loadNotifications().map((n) => ({ ...n, read: true }));
  saveNotifications(items);
  notifyNotifications(items);
}

export function clearNotifications() {
  saveNotifications([]);
  notifyNotifications([]);
}

export function unreadNotificationCount(): number {
  return loadNotifications().filter((n) => !n.read).length;
}

export function showToast(message: string, type: ToastType = "success") {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  notifyToasts();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notifyToasts();
  }, 3500);

  // Every toast also becomes a persistent notification, so the bell icon
  // shows a real history even after the pop-up itself has faded.
  const items = [{ id, message, type, timestamp: Date.now(), read: false }, ...loadNotifications()].slice(0, MAX_NOTIFICATIONS);
  saveNotifications(items);
  notifyNotifications(items);
}
