import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let app;

function getFirebaseAdmin() {
  if (app) return app;
  
  const apps = getApps();
  if (apps.length > 0) {
    app = apps[0];
    return app;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase admin credentials');
  }

  app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  
  return app;
}

export default async function handler(req, res) {
  // Support PUT for editing and DELETE for removing
  if (req.method !== 'DELETE' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing resident ID' });
  }

  try {
    const adminApp = getFirebaseAdmin();
    const db = getFirestore(adminApp);

    // Handle PUT - Update resident
    if (req.method === 'PUT') {
      const updates = req.body;
      
      // Remove undefined fields
      const cleanedUpdates = {};
      Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined) {
          cleanedUpdates[key] = updates[key];
        }
      });

      await db.collection('residents').doc(id).update(cleanedUpdates);
      return res.status(200).json({ success: true, message: 'Resident updated successfully' });
    }

    // Handle DELETE - Remove resident
    if (req.method === 'DELETE') {
      // Delete the resident document
      await db.collection('residents').doc(id).delete();

      // Also delete any checkins for this resident
      const checkinsSnapshot = await db.collection('checkins')
        .where('residentId', '==', id)
        .get();
      
      const batch = db.batch();
      checkinsSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      return res.status(200).json({ success: true, message: 'Resident deleted successfully' });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
