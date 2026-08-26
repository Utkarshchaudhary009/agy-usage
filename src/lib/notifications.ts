/**
 * Thin wrappers over the Web Notification API so feature code never touches
 * browser globals directly. Deliberately isomorphic (no server-only marker):
 * both server and client bundles import it, and every call is a no-op outside
 * the browser or when the API is unavailable.
 */

type NotificationPermissionState = "granted" | "denied" | "default" | null;

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermissionState {
  if (!notificationsSupported()) return null;
  return Notification.permission;
}

/**
 * Requests permission when still undecided. Returns the resulting state so UI
 * can reflect denied/granted accurately.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!notificationsSupported()) return null;
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    // Safari throws NotAllowedError when called outside a user gesture.
    return Notification.permission;
  }
}

function show(title: string, options?: NotificationOptions): void {
  if (!notificationsSupported() || Notification.permission !== "granted")
    return;
  try {
    new Notification(title, options);
  } catch {
    // Some engines require the ServiceWorkerRegistration path; silently skip
    // rather than break the calling interaction.
  }
}

export function notifyModelExhausted(
  modelName: string,
  resetTime?: string,
): void {
  show(`${modelName} quota exhausted`, {
    body: resetTime
      ? `Resets ${new Date(resetTime).toLocaleString()}`
      : "You've used up this model's quota.",
    tag: `exhausted-${modelName}`,
  });
}

export function notifyModelReset(modelName: string): void {
  show(`${modelName} quota reset`, {
    body: "Back to 100% — full quota available again.",
    tag: `reset-${modelName}`,
  });
}

export function notifyWakeupComplete(title: string, body: string): void {
  show(title, { body, tag: "wakeup-complete" });
}
