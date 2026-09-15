import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory mock store
const inMemoryStore: Record<string, Map<string, any>> = {
  homes: new Map(),
  staff: new Map(),
  residents: new Map(),
  checkins: new Map(),
  jobLogs: new Map(),
  pushLogs: new Map(),
};

function getMockCollection(name: string): Map<string, any> {
  if (!inMemoryStore[name]) {
    inMemoryStore[name] = new Map();
  }
  return inMemoryStore[name];
}

// Seed mock store from data/elderwatch-data.json if present
try {
  const seedPath = path.join(process.cwd(), 'data', 'elderwatch-data.json');
  if (fs.existsSync(seedPath)) {
    const raw = fs.readFileSync(seedPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.homes && typeof parsed.homes === 'object') {
      for (const [id, val] of Object.entries(parsed.homes)) {
        inMemoryStore.homes.set(id, { ...(val as any), id });
      }
    }
    if (parsed.staff && typeof parsed.staff === 'object') {
      for (const [id, val] of Object.entries(parsed.staff)) {
        inMemoryStore.staff.set(id, { ...(val as any), id });
      }
    }
    if (parsed.residents && typeof parsed.residents === 'object') {
      for (const [id, val] of Object.entries(parsed.residents)) {
        inMemoryStore.residents.set(id, { ...(val as any), id });
      }
    }
    if (parsed.checkins && typeof parsed.checkins === 'object') {
      for (const [id, val] of Object.entries(parsed.checkins)) {
        inMemoryStore.checkins.set(id, { ...(val as any), id });
      }
    }
    if (Array.isArray(parsed.jobLogs)) {
      for (const item of parsed.jobLogs) {
        if (item.id) inMemoryStore.jobLogs.set(item.id, item);
      }
    }
    if (Array.isArray(parsed.pushLogs)) {
      for (const item of parsed.pushLogs) {
        if (item.id) inMemoryStore.pushLogs.set(item.id, item);
      }
    }
  }
} catch (e) {
  console.warn('[ElderWatch] Note: could not seed from elderwatch-data.json:', (e as Error).message);
}

// Initialize Firebase Admin if credentials exist
let isRealFirestore = false;
let realFirestore: any = null;

try {
  let credential: any = null;
  const serviceAccountPath = path.join(process.cwd(), 'service-account.json');
  const relativeServiceAccount = path.join(__dirname, '..', 'service-account.json');

  if (fs.existsSync(serviceAccountPath)) {
    credential = cert(JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8')));
  } else if (fs.existsSync(relativeServiceAccount)) {
    credential = cert(JSON.parse(fs.readFileSync(relativeServiceAccount, 'utf-8')));
  } else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    credential = cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }

  if (credential) {
    let app: App;
    if (getApps().length === 0) {
      app = initializeApp({ credential });
    } else {
      app = getApps()[0];
    }
    realFirestore = getFirestore(app);
    isRealFirestore = true;
    console.log('[ElderWatch] Connected to live Firebase Admin / Firestore.');
  } else {
    console.log('[ElderWatch] No Firebase service account or credentials found. Running in-memory database mode.');
  }
} catch (err: any) {
  console.warn('[ElderWatch] Firebase Admin init failed, falling back to in-memory mode:', err?.message || err);
  isRealFirestore = false;
  realFirestore = null;
}

function createCollectionRef(name: string) {
  if (isRealFirestore && realFirestore) {
    return realFirestore.collection(name);
  }
  return {
    doc: (id: string) => ({
      get: async () => {
        const d = getMockCollection(name).get(id);
        return { exists: !!d, id, data: () => (d ? { ...d } : undefined) };
      },
      set: async (data: any, opt?: any) => {
        const col = getMockCollection(name);
        const existing = col.get(id) || {};
        const merged = opt?.merge ? { ...existing, ...data, id } : { ...data, id };
        col.set(id, merged);
      },
      delete: async () => {
        getMockCollection(name).delete(id);
      },
    }),
    where: (field: string, op: string, value: any) => ({
      get: async () => {
        const all = Array.from(getMockCollection(name).values());
        const matched = all.filter((d: any) => {
          if (op === '==') return d[field] === value;
          if (op === '!=') return d[field] !== value;
          return true;
        });
        return {
          docs: matched.map((m: any) => ({ id: m.id, data: () => ({ ...m }) })),
        };
      },
    }),
    get: async () => {
      const all = Array.from(getMockCollection(name).values());
      return {
        docs: all.map((m: any) => ({ id: m.id, data: () => ({ ...m }) })),
      };
    },
  };
}

export const firestore: any = isRealFirestore && realFirestore ? realFirestore : {
  collection: (name: string) => createCollectionRef(name),
};

export { FieldValue };

// Collection references
export const homesRef = firestore.collection('homes');
export const staffRef = firestore.collection('staff');
export const residentsRef = firestore.collection('residents');
export const checkinsRef = firestore.collection('checkins');
export const jobLogsRef = firestore.collection('jobLogs');
export const pushLogsRef = firestore.collection('pushLogs');

// Helper to get document by ID
export async function getDocById(collectionName: string, id: string): Promise<any | null> {
  if (isRealFirestore && realFirestore) {
    try {
      const docSnap = await realFirestore.collection(collectionName).doc(id).get();
      if (!docSnap.exists) return null;
      return { id: docSnap.id, ...docSnap.data() };
    } catch (e) {
      console.warn(`[Firestore] getDocById error on ${collectionName}/${id}:`, e);
    }
  }
  const item = getMockCollection(collectionName).get(id);
  return item ? { ...item } : null;
}

// Helper to set document by ID
export async function setDocById(collectionName: string, id: string, data: any): Promise<void> {
  // Always update in-memory store so it reflects immediately
  const col = getMockCollection(collectionName);
  const existing = col.get(id) || {};
  col.set(id, { ...existing, ...data, id });

  if (isRealFirestore && realFirestore) {
    try {
      await realFirestore.collection(collectionName).doc(id).set(data, { merge: true });
    } catch (e) {
      console.warn(`[Firestore] setDocById error on ${collectionName}/${id}:`, e);
    }
  }
}

// Helper to delete document by ID
export async function deleteDocById(collectionName: string, id: string): Promise<void> {
  getMockCollection(collectionName).delete(id);

  if (isRealFirestore && realFirestore) {
    try {
      await realFirestore.collection(collectionName).doc(id).delete();
    } catch (e) {
      console.warn(`[Firestore] deleteDocById error on ${collectionName}/${id}:`, e);
    }
  }
}

// Helper to get all docs in a collection
export async function getAllDocs(collectionName: string): Promise<any[]> {
  if (isRealFirestore && realFirestore) {
    try {
      const snapshot = await realFirestore.collection(collectionName).get();
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() }));
    } catch (e) {
      console.warn(`[Firestore] getAllDocs error on ${collectionName}:`, e);
    }
  }
  return Array.from(getMockCollection(collectionName).values()).map((d: any) => ({ ...d }));
}

// Helper to query by field
export async function getDocsByField(collectionName: string, fieldName: string, fieldValue: string): Promise<any[]> {
  if (isRealFirestore && realFirestore) {
    try {
      const snapshot = await realFirestore.collection(collectionName).where(fieldName, '==', fieldValue).get();
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() }));
    } catch (e) {
      console.warn(`[Firestore] getDocsByField error on ${collectionName}:`, e);
    }
  }
  return Array.from(getMockCollection(collectionName).values())
    .filter((d: any) => d[fieldName] === fieldValue)
    .map((d: any) => ({ ...d }));
}

// Helper to query with conditions
export async function getDocsByQuery(queryObj: any): Promise<any[]> {
  if (isRealFirestore && realFirestore && !queryObj?._isMockQuery) {
    try {
      const snapshot = await queryObj.get();
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() }));
    } catch (e) {
      console.warn('[Firestore] getDocsByQuery error:', e);
    }
  }

  if (queryObj?._isMockQuery) {
    const col = getMockCollection(queryObj.collectionName);
    const conditions: Array<{ field: string; op: string; value: any }> = queryObj.conditions || [];
    return Array.from(col.values())
      .filter((d: any) => {
        return conditions.every((cond) => {
          if (cond.op === '==') return d[cond.field] === cond.value;
          if (cond.op === '!=') return d[cond.field] !== cond.value;
          if (cond.op === '>') return d[cond.field] > cond.value;
          if (cond.op === '>=') return d[cond.field] >= cond.value;
          if (cond.op === '<') return d[cond.field] < cond.value;
          if (cond.op === '<=') return d[cond.field] <= cond.value;
          if (cond.op === 'in') return Array.isArray(cond.value) && cond.value.includes(d[cond.field]);
          return true;
        });
      })
      .map((d: any) => ({ ...d }));
  }

  return [];
}

// Build a query with where conditions
export function buildQuery(collectionName: string, conditions: Array<{field: string, op: string, value: any}>): any {
  if (isRealFirestore && realFirestore) {
    let q: any = realFirestore.collection(collectionName);
    for (const cond of conditions) {
      q = q.where(cond.field, cond.op, cond.value);
    }
    return q;
  }
  return {
    _isMockQuery: true,
    collectionName,
    conditions,
  };
}

