import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load service account
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

// Initialize Firebase Admin
if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const auth = getAuth();
const firestore = getFirestore();

async function setup() {
  const email = 'shaunwgordon@gmail.com';
  const password = 'B33tl3sL1lly@123';

  console.log('Setting up Firebase Authentication...');

  // Check if user already exists
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`User ${email} already exists with UID: ${userRecord.uid}`);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      // Create new user
      userRecord = await auth.createUser({
        email,
        password,
        displayName: 'Shaun Gordon',
        emailVerified: true,
      });
      console.log(`Created new user with UID: ${userRecord.uid}`);
    } else {
      throw error;
    }
  }

  // Set custom claims for admin role
  await auth.setCustomUserClaims(userRecord.uid, {
    role: 'admin',
    homeId: 'home-methodist-1',
  });
  console.log('Set custom claims: role=admin, homeId=home-methodist-1');

  // Ensure staff document exists in Firestore
  await firestore.collection('staff').doc(userRecord.uid).set({
    id: userRecord.uid,
    homeId: 'home-methodist-1',
    name: 'Shaun Gordon',
    email: email,
    role: 'admin',
    createdAt: new Date().toISOString(),
  }, { merge: true });
  console.log('Staff document created/updated in Firestore');

  // Also ensure Mary Nurse exists
  let maryRecord;
  const maryEmail = 'marynurse@methodist.care';
  try {
    maryRecord = await auth.getUserByEmail(maryEmail);
    console.log(`User ${maryEmail} already exists with UID: ${maryRecord.uid}`);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      maryRecord = await auth.createUser({
        email: maryEmail,
        password: 'Marynurse@123',
        displayName: 'Mary Nurse',
        emailVerified: true,
      });
      console.log(`Created nurse user with UID: ${maryRecord.uid}`);
    } else {
      throw error;
    }
  }

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
  console.log('Nurse document created/updated in Firestore');

  console.log('\n=== SETUP COMPLETE ===');
  console.log('Admin login: shaunwgordon@gmail.com / B33tl3sL1lly@123');
  console.log('Nurse login: marynurse@methodist.care / Marynurse@123');
}

setup().catch(console.error);
