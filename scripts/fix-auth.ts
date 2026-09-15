import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const auth = getAuth();
const firestore = getFirestore();

async function fixAuth() {
  const email = 'shaunwgordon@gmail.com';
  const password = 'B33tl3sL1lly@123';

  console.log('Fixing Firebase Auth...');

  // Delete existing user if exists
  try {
    const existingUser = await auth.getUserByEmail(email);
    await auth.deleteUser(existingUser.uid);
    console.log(`Deleted existing user: ${existingUser.uid}`);
  } catch (e) {
    // User doesn't exist, that's fine
  }

  // Create user with proper password
  const userRecord = await auth.createUser({
    email,
    password,
    displayName: 'Shaun Gordon',
    emailVerified: true,
    disabled: false,
  });
  console.log(`Created user with UID: ${userRecord.uid}`);

  // Set custom claims
  await auth.setCustomUserClaims(userRecord.uid, {
    role: 'admin',
    homeId: 'home-methodist-1',
  });
  console.log('Set custom claims');

  // Update Firestore staff document with the new UID
  await firestore.collection('staff').doc(userRecord.uid).set({
    id: userRecord.uid,
    homeId: 'home-methodist-1',
    name: 'Shaun Gordon',
    email: email,
    role: 'admin',
    createdAt: new Date().toISOString(),
  }, { merge: true });
  console.log('Updated Firestore staff document');

  // Also fix Mary Nurse
  const maryEmail = 'marynurse@methodist.care';
  const maryPassword = 'Marynurse@123';

  try {
    const existingMary = await auth.getUserByEmail(maryEmail);
    await auth.deleteUser(existingMary.uid);
    console.log(`Deleted existing nurse: ${existingMary.uid}`);
  } catch (e) {}

  const maryRecord = await auth.createUser({
    email: maryEmail,
    password: maryPassword,
    displayName: 'Mary Nurse',
    emailVerified: true,
    disabled: false,
  });

  await auth.setCustomUserClaims(maryRecord.uid, {
    role: 'nurse',
    homeId: 'home-methodist-1',
  });

  await firestore.collection('staff').doc(maryRecord.uid).set({
    id: maryRecord.uid,
    homeId: 'home-methodist-1',
    name: 'Mary Nurse',
    email: maryEmail,
    role: 'nurse',
    createdAt: new Date().toISOString(),
  }, { merge: true });

  console.log('\n=== DONE ===');
  console.log('Admin: shaunwgordon@gmail.com / B33tl3sL1lly@123');
  console.log('Nurse: marynurse@methodist.care / Marynurse@123');
}

fixAuth().catch(console.error);
