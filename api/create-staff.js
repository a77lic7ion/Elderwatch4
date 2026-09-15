import { GoogleAuth } from 'google-auth-library';

const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: process.env.FIREBASE_PRIVATE_KEY,
};

const API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAQb0poaNUJVv6ND4MfbzWcyxgjyBCBJyI';

async function getAccessToken() {
  const auth = new GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ['https://www.googleapis.com/auth/identitytoolkit', 'https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

async function generateCustomToken(uid) {
  const crypto = await import('crypto');
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    sub: SERVICE_ACCOUNT.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(SERVICE_ACCOUNT.private_key, 'base64url');
  return `${signingInput}.${signature}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, password, name, role, homeId } = req.body;
    if (!email || !name || !role || !homeId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check env vars
    if (!SERVICE_ACCOUNT.project_id || !SERVICE_ACCOUNT.client_email || !SERVICE_ACCOUNT.private_key) {
      return res.status(500).json({ error: 'Server config missing', debug: { pid: !!SERVICE_ACCOUNT.project_id, ce: !!SERVICE_ACCOUNT.client_email, pk: !!SERVICE_ACCOUNT.private_key } });
    }

    const accessToken = await getAccessToken();

    // 1. Look up existing user
    let uid;
    const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const lookupData = await lookupRes.json();

    if (lookupData.users && lookupData.users.length > 0) {
      uid = lookupData.users[0].localId;
      // Update password if provided
      if (password) {
        const customToken = await generateCustomToken(uid);
        const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        });
        const signInData = await signInRes.json();
        if (signInData.idToken) {
          await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${signInData.idToken}` },
            body: JSON.stringify({ password, returnSecureToken: true }),
          });
        }
      }
    } else {
      // Create new user
      const createRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: password || 'TempPassword123!', returnSecureToken: true }),
      });
      const createData = await createRes.json();
      if (createData.error) throw new Error(createData.error.message);
      uid = createData.localId;
    }

    // 2. Set custom claims
    try {
      const customToken = await generateCustomToken(uid);
      const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      });
      const signInData = await signInRes.json();
      if (signInData.idToken) {
        await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${signInData.idToken}` },
          body: JSON.stringify({ customAttributes: JSON.stringify({ role, homeId }), returnSecureToken: true }),
        });
      }
    } catch (e) {
      console.warn('Could not set custom claims:', e.message);
    }

    // 3. Write Firestore staff document
    const staffDoc = {
      fields: {
        id: { stringValue: uid },
        homeId: { stringValue: homeId },
        name: { stringValue: name },
        email: { stringValue: email.toLowerCase() },
        role: { stringValue: role },
        passwordHash: { stringValue: password || '' },
        createdAt: { stringValue: new Date().toISOString() },
      }
    };

    const fsRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${SERVICE_ACCOUNT.project_id}/databases/(default)/documents/staff/${uid}?updateMask.fieldPaths=id&updateMask.fieldPaths=homeId&updateMask.fieldPaths=name&updateMask.fieldPaths=email&updateMask.fieldPaths=role&updateMask.fieldPaths=passwordHash&updateMask.fieldPaths=createdAt`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify(staffDoc),
      }
    );

    return res.status(200).json({ success: true, user: { id: uid, email, name, role, homeId } });
  } catch (error) {
    console.error('Error creating staff:', error);
    return res.status(500).json({ error: error.message || 'Failed to create staff' });
  }
}
