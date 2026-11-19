/**
 * Lock screen and home screen notifications for this device (Web Push), sent by your Bridge
 * through your Glidepath account: top of descent, landed, and your flight review.
 * iPhone and iPad: Apple allows these only for apps added to the Home Screen (iOS/iPadOS 16.4+).
 */
import { authed } from "./cloud";

export type PushState = "unsupported" | "needs-home-screen" | "blocked" | "off" | "on";

const isApple = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4);
  const r = atob(s); const u = new Uint8Array(new ArrayBuffer(r.length)); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u;
}
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]); } catch { return null; }
}

export async function pushState(): Promise<PushState> {
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) return isApple() && !standalone() ? "needs-home-screen" : "unsupported";
  if (isApple() && !standalone()) return "needs-home-screen";
  if (Notification.permission === "denied") return "blocked";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  return /iPad/.test(ua) || (isApple() && navigator.maxTouchPoints > 1 && !/iPhone/.test(ua)) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "Device";
}

/** Ask permission, subscribe, and register this device with the account. Returns an error to show, or null. */
export async function enablePush(): Promise<string | null> {
  const st = await pushState();
  if (st === "unsupported") return "This browser can't show notifications from websites.";
  if (st === "needs-home-screen") return "On iPhone and iPad, add Glidepath to your Home Screen first (Share › Add to Home Screen), open it from there, then turn this on.";
  const perm = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  if (perm !== "granted") return "Notifications are blocked for Glidepath. Allow them in your device or browser settings, then try again.";
  const reg = await registration();
  if (!reg) return "Glidepath's background service isn't ready yet. Reload the app and try again.";
  try {
    const { key } = await authed<{ key: string }>("/push/key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    await authed("/push/subscribe", "POST", { endpoint: j.endpoint, keys: j.keys, label: deviceLabel() });
    return null;
  } catch (e) { return (e as Error).message || "Couldn't turn on notifications. Try again in a minute."; }
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  try { await authed("/push/unsubscribe", "POST", { endpoint: sub.endpoint }); } catch { /* the account forgets it when it bounces */ }
  await sub.unsubscribe().catch(() => undefined);
}

export async function testPush(): Promise<string | null> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return "Turn notifications on first.";
  try { await authed("/push/test", "POST", { endpoint: sub.endpoint }); return null; } catch (e) { return (e as Error).message; }
}

/** Which kinds of notification the pilot wants (saved on the account, so every device follows). */
export type PushPrefs = { tod: boolean; checklist: boolean; landed: boolean; review: boolean };
export async function getPushPrefs(): Promise<PushPrefs | null> {
  try { return await authed<PushPrefs>("/push/prefs"); } catch { return null; }
}
export async function setPushPrefs(p: Partial<PushPrefs>): Promise<PushPrefs | null> {
  try { return await authed<PushPrefs>("/push/prefs", "PUT", p); } catch { return null; }
}
