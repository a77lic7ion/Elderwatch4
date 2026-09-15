import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

const auth = getAuth();
const firestore = getFirestore();

async function addUser(email: string, password: string, name: string, role: string, homeId: string) {
  // Check if user already exists in Auth
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`User ${email} already exists in Auth with UID: ${userRecord.uid}`);
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') {
      userRecord = await auth.createUser({
        email,
        password,
        displayName: name,
        emailVerified: true,
        disabled: false,
      });
      console.log(`Created new user in Auth with UID: ${userRecord.uid}`);
    } else {
      throw e;
    }
  }

  // Set custom claims
  await auth.setCustomUserClaims(userRecord.uid, { role, homeId });
  console.log(`Set custom claims: role=${role}, homeId=${homeId}`);

  // Create staff document in Firestore
  await firestore.collection('staff').doc(userRecord.uid).set({
    id: userRecord.uid,
    homeId,
    name,
    email,
    role,
    createdAt: new Date().toISOString(),
  }, { merge: true });
  console.log(`Staff document created/updated in Firestore for ${email}`);
}

// Add Neeri
addUser('Neeri@gmail.com', 'B33tl3sL1lly@123', 'Neeri', 'nurse', 'home-methodist-1')
  .then(() => {
    console.log('\n=== DONE ===');
    console.log('Login: Neeri@gmail.com / B33tl3sL1lly@123');
  })
  .catch(console.error);
