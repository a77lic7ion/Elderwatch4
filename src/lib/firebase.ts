import { initializeApp, getApps, getApp, FirebaseApp, deleteApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocFromServer,
  onSnapshot,
  query,
  where,
  Firestore,
  Unsubscribe,
} from 'firebase/firestore';
import {
  initializeAuth,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  onIdTokenChanged,
  User as FirebaseUser,
  Auth,
} from 'firebase/auth';
import { CheckIn, Resident } from '../types';

interface EnvMeta {
  env?: {
    VITE_FIREBASE_API_KEY?: string;
    VITE_FIREBASE_AUTH_DOMAIN?: string;
    VITE_FIREBASE_PROJECT_ID?: string;
    VITE_FIREBASE_STORAGE_BUCKET?: string;
    VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
    VITE_FIREBASE_APP_ID?: string;
    VITE_FIREBASE_MEASUREMENT_ID?: string;
  };
}

const meta = import.meta as unknown as EnvMeta;
const env = meta.env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyAQb0poaNUJVv6ND4MfbzWcyxgjyBCBJyI',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'elderwatch-14712.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'elderwatch-14712',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'elderwatch-14712.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '981482830351',
  appId: env.VITE_FIREBASE_APP_ID || '1:981482830351:web:4823b2f99f590cc269017a',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

// =================== PER-TAB FIREBASE APP ===================
// Each browser tab needs its own Firebase app instance with its own Auth instance
// using inMemoryPersistence so it doesn't sync across tabs via IndexedDB.
// This allows multiple staff to be signed in simultaneously in different tabs,
// while each tab still uses real Firebase Auth for security/validation.

const TAB_ID =
  (typeof window !== 'undefined' && window.name) ||
  `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

// Set a window name so we can identify this tab (used to scope the Firebase app name)
if (typeof window !== 'undefined' && !window.name) {
  try { window.name = TAB_ID; } catch { /* ignore */ }
}

const APP_NAME = `elderwatch-${TAB_ID}`;

let _app: FirebaseApp;
if (getApps().some((a) => a.name === APP_NAME)) {
  _app = getApps().find((a) => a.name === APP_NAME)!;
} else {
  // Delete any leftover apps with this name (paranoid cleanup)
  try {
    const existing = getApps().find((a) => a.name === APP_NAME);
    if (existing) deleteApp(existing);
  } catch { /* ignore */ }
  _app = initializeApp(firebaseConfig, APP_NAME);
}

export const app: FirebaseApp = _app;

// Initialize Firestore (Firestore can be shared via the default app's instance,
// but using our per-tab app keeps it isolated too — safer for multi-tenant data ops)
export const db: Firestore = getFirestore(_app);

// =================== PER-TAB FIREBASE AUTH ===================
// inMemoryPersistence means: this tab's auth state is held in memory only.
// It is NOT written to IndexedDB and NOT shared with other tabs.
// When the tab is closed, the auth state is gone. The user will need to
// sign in again next time. This is the key to allowing multiple users
// to be signed in simultaneously across different tabs/windows.

export const auth: Auth = initializeAuth(_app, {
  persistence: inMemoryPersistence,
});

// Auth helper functions
export async function loginWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  try {
    return signOut(auth);
  } catch {
    // If auth state is already gone (e.g. tab was duplicated), ignore.
    return;
  }
}

export function onAuthChange(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export function onTokenChange(callback: (user: FirebaseUser | null) => void) {
  return onIdTokenChanged(auth, callback);
}

// Connection state tracking
export interface FirebaseConnectionStatus {
  connected: boolean;
  projectId: string;
  lastChecked: string;
  error?: string;
}

let connectionStatus: FirebaseConnectionStatus = {
  connected: false,
  projectId: firebaseConfig.projectId,
  lastChecked: new Date().toISOString(),
};

/**
 * Validate connection to Firestore using getDocFromServer as required
 */
export async function validateFirestoreConnection(): Promise<FirebaseConnectionStatus> {
  try {
    // Attempt to read connection test document
    await getDocFromServer(doc(db, 'system', 'connection_test'));
    connectionStatus = {
      connected: true,
      projectId: firebaseConfig.projectId,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // If permissions deny read on 'system/connection_test' or not-found, that still means we reached the Firestore server
    const isServerReachable =
      msg.includes('permission-denied') ||
      msg.includes('not-found') ||
      !msg.includes('offline');

    connectionStatus = {
      connected: isServerReachable,
      projectId: firebaseConfig.projectId,
      lastChecked: new Date().toISOString(),
      error: isServerReachable ? undefined : msg,
    };
  }
  return connectionStatus;
}

export function getCachedConnectionStatus(): FirebaseConnectionStatus {
  return connectionStatus;
}

/**
 * Record a check-in in Firestore
 */
export async function saveCheckinToFirestore(
  homeId: string,
  residentId: string,
  status: 'ok' | 'not_ok' | 'awaiting',
  notes?: string
): Promise<void> {
  // Use SAST (UTC+2) date to match admin panel queries
  const now = new Date();
  const sastDate = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  const today = sastDate.toISOString().split('T')[0];
  const docId = `${homeId}_${residentId}_${today}`;
  const checkinRef = doc(db, 'checkins', docId);

  const payload: CheckIn = {
    id: docId,
    homeId,
    residentId,
    date: today,
    status,
    timestamp: new Date().toISOString(),
    updatedBy: 'resident',
    notes,
  };

  await setDoc(checkinRef, payload, { merge: true });
}

/**
 * Real-time subscription to today's check-ins for a home
 */
export function subscribeToTodayCheckins(
  homeId: string,
  date: string,
  onCheckins: (checkins: Record<string, CheckIn>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  try {
    const q = query(
      collection(db, 'checkins'),
      where('homeId', '==', homeId),
      where('date', '==', date)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const checkinsMap: Record<string, CheckIn> = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as CheckIn;
          checkinsMap[data.residentId] = data;
        });
        onCheckins(checkinsMap);
      },
      (error) => {
        console.warn('Firestore real-time subscription error:', error);
        if (onError) onError(error);
      }
    );
  } catch (err) {
    console.warn('Could not establish Firestore subscription:', err);
    return () => {};
  }
}

/**
 * Real-time subscription to residents roster in Firestore
 */
export function subscribeToResidents(
  homeId: string,
  onResidents: (residents: Resident[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  try {
    const q = query(collection(db, 'residents'), where('homeId', '==', homeId));

    return onSnapshot(
      q,
      (snapshot) => {
        const list: Resident[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as Resident);
        });
        onResidents(list);
      },
      (error) => {
        console.warn('Firestore residents subscription error:', error);
        if (onError) onError(error);
      }
    );
  } catch (err) {
    console.warn('Could not subscribe to residents:', err);
    return () => {};
  }
}
