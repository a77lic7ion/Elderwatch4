// ============================================================================
// Web Push reminders for the resident terminal
// ============================================================================
// The resident's phone subscribes to web push here; the sender lives in
// `api/cron/reminder-push.js` (Vercel cron at 06:00 UTC = 08:00 SAST) and in
// `server.ts` for local dev.
//
// VAPID public key is safe to ship in the client bundle. The matching PRIVATE
// key must NEVER be in this file - it lives in .env.local locally and in the
// Vercel project's environment variables (VAPID_PRIVATE_KEY) in production.

import { db } from './firebase';
import { doc, setDoc } from 'firebase/firestore';

const env = ((import.meta as any).env || {}) as Record<string, string | undefined>;

export const VAPID_PUBLIC_KEY =
  env.VITE_VAPID_PUBLIC_KEY || 'BK9t_gSFfc90DYOFwD2ZaWbjBid7xxUkNuq6g19-8hz7VfIdKm-KymQ8YBGzaXUQHGjfPw4fJY5F0r5spb2MyGw';

export const REMINDER_TIME_SAST = '08:00';

export type ReminderState =
  | 'unknown'
  | 'on'            // permission granted + subscription stored with the server
  | 'off'           // supported, just needs one tap
  | 'denied'        // user (or an earlier tap) blocked notifications
  | 'needs-install' // iPhone/iPad: only works once added to the Home Screen
  | 'unsupported';  // browser can't do web push at all

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
  );
}

/** True when the app is running from the installed icon, not a browser tab. */
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) return existing;
    await navigator.serviceWorker.register('/sw.js');
    return await navigator.serviceWorker.ready;
  } catch (e) {
    console.warn('[ElderWatch] Service worker unavailable for push:', e);
    return null;
  }
}

/** Current reminder state for this phone, without prompting for anything. */
export async function getReminderState(): Promise<ReminderState> {
  if (!pushSupported()) return 'unsupported';
  if (isIOS() && !isStandalonePWA()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) return Notification.permission === 'granted' ? 'off' : 'off';
  const sub = await reg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') return 'on';
  return 'off';
}

/**
 * Ask permission and register this phone for reminders.
 * MUST be called from a user gesture (a tap) - both iOS and Android require it.
 */
export async function enableReminders(residentId: string): Promise<{ ok: boolean; state: ReminderState }> {
  if (!pushSupported()) return { ok: false, state: 'unsupported' };
  if (isIOS() && !isStandalonePWA()) return { ok: false, state: 'needs-install' };

  try {
    if (Notification.permission === 'default') {
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') return { ok: false, state: 'denied' };
    }
    if (Notification.permission !== 'granted') return { ok: false, state: 'denied' };

    const reg = await getRegistration();
    if (!reg) return { ok: false, state: 'unsupported' };

    // Wait for the worker to actually control the page - iOS silently fails
    // to create a subscription when the SW isn't active yet.
    if (!reg.active) await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json: any = typeof sub.toJSON === 'function' ? sub.toJSON() : {};
    const payload: Record<string, any> = {
      endpoint: sub.endpoint,
      keys: { p256dh: json?.keys?.p256dh || '', auth: json?.keys?.auth || '' },
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      enabledAt: new Date().toISOString(),
    };

    await setDoc(
      doc(db, 'residents', residentId),
      {
        pushSubscription: payload,
        pushToken: sub.endpoint, // kept for the existing schema / admin views
        reminderEnabledAt: payload.enabledAt,
        reminderTimeSAST: REMINDER_TIME_SAST,
      },
      { merge: true }
    );

    return { ok: true, state: 'on' };
  } catch (e) {
    console.error('[ElderWatch] Failed to enable reminders:', e);
    const state = Notification.permission === 'denied' ? 'denied' : 'off';
    return { ok: false, state };
  }
}

/** Turn reminders off for this phone and forget the subscription server-side. */
export async function disableReminders(residentId: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) {
    console.warn('[ElderWatch] Failed to unsubscribe:', e);
  }
  try {
    await setDoc(
      doc(db, 'residents', residentId),
      { pushSubscription: null, pushToken: null, reminderEnabledAt: null },
      { merge: true }
    );
  } catch (e) {
    console.warn('[ElderWatch] Failed to clear push subscription record:', e);
  }
}

/**
 * Re-assert this phone's subscription if the browser rotated it
 * (happens on iOS after long idle periods). Cheap, safe to call on load.
 */
export async function refreshReminderSubscription(residentId: string): Promise<ReminderState> {
  const state = await getReminderState();
  if (state !== 'on') return state;
  try {
    const reg = await getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const json: any = sub.toJSON();
      await setDoc(
        doc(db, 'residents', residentId),
        {
          pushToken: sub.endpoint,
          pushSubscription: { endpoint: sub.endpoint, keys: json?.keys || {}, userAgent: navigator.userAgent },
        },
        { merge: true }
      );
    }
  } catch {
    /* non-fatal */
  }
  return state;
}
