import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccount = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'service-account.json'), 'utf-8'));

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}

const auth = getAuth();
const firestore = getFirestore();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>(r => rl.question(q, r));

async function main() {
  console.log('\n=== ElderWatch Staff Creator ===\n');

  const name = await ask('Staff name: ');
  const email = await ask('Email: ');
  const password = await ask('Password: ');
  const role = await ask('Role (admin/home_admin): ');
  const homeId = await ask('Home ID (e.g. home-methodist-1): ');

  // Create in Firebase Auth
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    await auth.updateUser(userRecord.uid, { password, displayName: name });
    console.log(`Updated existing Auth user: ${userRecord.uid}`);
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') {
      userRecord = await auth.createUser({ email, password, displayName: name, emailVerified: true });
      console.log(`Created Auth user: ${userRecord.uid}`);
    } else {
      throw e;
    }
  }

  await auth.setCustomUserClaims(userRecord.uid, { role, homeId });

  // Create Firestore staff document
  await firestore.collection('staff').doc(userRecord.uid).set({
    id: userRecord.uid, homeId, name, email, role,
    createdAt: new Date().toISOString(),
  }, { merge: true });

  console.log(`\n✅ Staff "${name}" created! Login: ${email} / ${password}\n`);
  rl.close();
}

main().catch(e => { console.error(e); rl.close(); });
