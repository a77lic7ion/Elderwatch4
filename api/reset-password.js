import { GoogleAuth } from 'google-auth-library';

const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: process.env.FIREBASE_PRIVATE_KEY,
};

async function getAccessToken() {
  const auth = new GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { staffId, newPassword } = req.body;

    if (!staffId || !newPassword) {
      return res.status(400).json({ error: 'Missing staffId or newPassword' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const accessToken = await getAccessToken();
    const projectId = SERVICE_ACCOUNT.project_id;

    // Update password in Firebase Auth
    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          localId: staffId,
          password: newPassword,
          returnSecureToken: true,
        }),
      }
    );

    if (!authResponse.ok) {
      const authError = await authResponse.json();
      console.error('Auth update error:', authError);
      return res.status(500).json({ error: 'Failed to update password in authentication' });
    }

    // Read current Firestore document to preserve all fields
    const getUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/staff/${staffId}`;
    const getResponse = await fetch(getUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!getResponse.ok) {
      const getError = await getResponse.json();
      console.error('Firestore read error:', getError);
      return res.status(500).json({ error: 'Failed to read staff document' });
    }

    const docData = await getResponse.json();

    // Update only the passwordHash field
    const updatedFields = docData.fields || {};
    updatedFields.passwordHash = { stringValue: newPassword };

    // Write back the complete document
    const patchUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/staff/${staffId}`;
    const patchResponse = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: updatedFields }),
    });

    if (!patchResponse.ok) {
      const patchError = await patchResponse.json();
      console.error('Firestore update error:', patchError);
      return res.status(500).json({ error: 'Failed to update password in database' });
    }

    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    return res.status(500).json({ error: error.message || 'Failed to reset password' });
  }
}
