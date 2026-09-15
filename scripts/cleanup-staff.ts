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

async function cleanup() {
  // Delete old staff records (non-Firebase Auth UIDs)
  const oldIds = [
    'staff-1788483785925',
    'staff-1788772874962-n2jr',
    'wpthOCi4ylTzMi6jlSrpuQfCkN92',
    'UaXLE9BHxJRfTsTAJ600yuwsDAw2',
  ];

  for (const id of oldIds) {
    try {
      await firestore.collection('staff').doc(id).delete();
      console.log(`Deleted old staff: ${id}`);
    } catch (e) {
      console.log(`Already deleted or not found: ${id}`);
    }
  }

  // Verify remaining staff
  const staffSnap = await firestore.collection('staff').get();
  console.log('\n=== REMAINING STAFF ===');
  staffSnap.forEach(doc => {
    console.log(doc.id, '->', doc.data().name, '(' + doc.data().email + ')');
  });
}

cleanup().catch(console.error);
