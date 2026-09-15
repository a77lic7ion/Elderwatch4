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

  // Reset Vaughn
  const vaughnId = 'home-1788774841437-xpt5_res-1788779141285-yo8e_' + today;
  await db.collection('checkins').doc(vaughnId).update({ status: 'awaiting', updatedBy: 'manual_reset' });
  console.log('Reset Vaughn:', vaughnId);

  // Reset Jay
  const jayId = 'home-1788774841437-xpt5_res-1788779521839-xnjs_' + today;
  await db.collection('checkins').doc(jayId).update({ status: 'awaiting', updatedBy: 'manual_reset' });
  console.log('Reset Jay:', jayId);

  process.exit(0);
})();
