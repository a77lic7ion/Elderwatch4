import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccount = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'service-account.json'), 'utf-8'));

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}

const firestore = getFirestore();

async function check() {
  const staffSnap = await firestore.collection('staff').get();
  console.log('=== ALL STAFF IN FIRESTORE ===');
  staffSnap.forEach(doc => {
    console.log(doc.id, '->', JSON.stringify(doc.data()));
  });
}

check().catch(console.error);
