import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

async function fixPassword() {
  const user = await auth.getUserByEmail('Neeri@gmail.com');
  await auth.updateUser(user.uid, { password: 'Neeri@123' });
  console.log(`Updated password for Neeri@gmail.com (UID: ${user.uid})`);
}

fixPassword().then(() => console.log('Done!')).catch(console.error);
