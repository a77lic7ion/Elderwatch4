import { GoogleAuth } from 'google-auth-library';
import { randomUUID } from 'crypto';

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

function getTodaySAST() {
  const now = new Date();
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return sast.toISOString().split('T')[0];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { homeId, name, roomNumber, phone, notes, unitNumber, emergencyContactName, emergencyContactRelation, emergencyContactNumber } = req.body || {};

    if (!homeId || !name || !roomNumber) {
      return res.status(400).json({ error: 'homeId, name, and roomNumber are required' });
    }

    const accessToken = await getAccessToken();
    const projectId = SERVICE_ACCOUNT.project_id;

    const id = `res-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const linkCode = `LINK-${roomNumber.replace(/[^a-zA-Z0-9]/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const newResident = {
      id,
      homeId,
      name: name.trim(),
      roomNumber: roomNumber.trim(),
      phone: (phone || '').trim(),
      notes: (notes || '').trim(),
      isDeviceLinked: false,
      linkedAt: null,
      oneTimeLinkCode: linkCode,
      linkCodeGeneratedAt: new Date().toISOString(),
      pushToken: null,
      createdAt: new Date().toISOString(),
    };

    if (unitNumber) newResident.unitNumber = unitNumber.trim();
    if (emergencyContactName) newResident.emergencyContactName = emergencyContactName.trim();
    if (emergencyContactRelation) newResident.emergencyContactRelation = emergencyContactRelation.trim();
    if (emergencyContactNumber) newResident.emergencyContactNumber = emergencyContactNumber.trim();

    // Write resident document
    const fsRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/residents/${id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: objectToFirestoreFields(newResident) }),
      }
    );

    if (!fsRes.ok) {
      const err = await fsRes.text();
      console.error('Firestore write error:', err);
      return res.status(500).json({ error: 'Failed to create resident' });
    }

    // Initialize today's checkin
    const today = getTodaySAST();
    const checkinId = `${homeId}_${id}_${today}`;
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/checkins/${checkinId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: objectToFirestoreFields({
            id: checkinId,
            homeId,
            residentId: id,
            date: today,
            status: 'awaiting',
            timestamp: new Date().toISOString(),
            updatedBy: 'morning_job',
          }),
        }),
      }
    );

    return res.status(200).json({ success: true, resident: { ...newResident, linkCode } });
  } catch (err) {
    console.error('Add resident error:', err);
    return res.status(500).json({ error: err.message || 'Failed to add resident' });
  }
}

// Convert plain JS object to Firestore REST API fields format
function objectToFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof value === 'string') {
      fields[key] = { stringValue: value };
    } else if (typeof value === 'number') {
      fields[key] = { integerValue: String(value) };
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (value instanceof Date) {
      fields[key] = { timestampValue: value.toISOString() };
    } else {
      fields[key] = { stringValue: String(value) };
    }
  }
  return fields;
}
