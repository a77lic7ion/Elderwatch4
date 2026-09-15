import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync('../service-account.json', 'utf8'));
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);

(async () => {
  const now = new Date();
  const sastDate = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  const today = sastDate.toISOString().split('T')[0];
  console.log('Today SAST:', today);

  const snap = await db.collection('checkins').where('date', '==', today).get();
  console.log('Today checkins:', snap.size);
  snap.forEach(doc => console.log(' ', doc.id, JSON.stringify(doc.data())));

  const all = await db.collection('checkins').limit(20).get();
  console.log('\nAll checkins (limit 20):', all.size);
  all.forEach(doc => console.log(' ', doc.id, JSON.stringify(doc.data())));

  // Check Vaughn
  const vaughnSnap = await db.collection('residents').where('name', '==', 'Vaughn').get();
  vaughnSnap.forEach(doc => console.log('\nVaughn:', doc.id, JSON.stringify(doc.data())));

  process.exit(0);
})();
