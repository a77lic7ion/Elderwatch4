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

function getTodaySAST() {
  const now = new Date();
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return sast.toISOString().split('T')[0];
}

/**
 * Daily reset cron job — runs at 00:00 SAST (22:00 UTC the previous day).
 * For every village, reset all of today's check-ins to 'awaiting'.
 * This guarantees a clean slate for the new day across all homes.
 */
export default async function handler(req, res) {
  // Vercel cron sends GET requests; allow both for safety.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple auth: Vercel cron includes this header, and we accept a manual
  // trigger with a secret query param too.
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron') || req.headers['x-vercel-cron'];
  const manualKey = req.query?.key;
  if (!isVercelCron && manualKey !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();
  const today = getTodaySAST();
  const projectId = SERVICE_ACCOUNT.project_id;

  console.log(`[daily-reset] Starting daily reset for ${today}`);

  try {
    const accessToken = await getAccessToken();

    // 1. Get all homes
    const homesRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/homes`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!homesRes.ok) {
      throw new Error(`Failed to fetch homes: ${homesRes.status}`);
    }

    const homesData = await homesRes.json();
    const homeIds = (homesData.documents || []).map((d) => d.name.split('/').pop());
    console.log(`[daily-reset] Found ${homeIds.length} homes`);

    let totalReset = 0;
    let totalCreated = 0;
    const perHome = [];

    for (const homeId of homeIds) {
      try {
        // 2. Get today's check-ins for this home
        const checkinsRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/checkins?pageSize=300`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (!checkinsRes.ok) continue;

        const allCheckins = await checkinsRes.json();
        const todayCheckins = (allCheckins.documents || []).filter((d) => {
          const data = parseFirestoreDoc(d);
          return data.homeId === homeId && data.date === today;
        });

        // Reset existing check-ins to 'awaiting'
        for (const checkinDoc of todayCheckins) {
          const docName = checkinDoc.name;
          await fetch(
            `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=status&updateMask.fieldPaths=timestamp&updateMask.fieldPaths=updatedBy`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fields: {
                  status: { stringValue: 'awaiting' },
                  timestamp: { timestampValue: new Date().toISOString() },
                  updatedBy: { stringValue: 'morning_job' },
                },
              }),
            }
          );
          totalReset++;
        }

        // 3. Get all residents for this home and ensure each has today's checkin
        const residentsRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/residents?pageSize=500`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (residentsRes.ok) {
          const allResidents = await residentsRes.json();
          const homeResidents = (allResidents.documents || []).filter((d) => {
            const data = parseFirestoreDoc(d);
            return data.homeId === homeId;
          });

          const existingIds = new Set(todayCheckins.map((c) => parseFirestoreDoc(c).residentId));

          for (const resDoc of homeResidents) {
            const residentData = parseFirestoreDoc(resDoc);
            if (existingIds.has(residentData.id)) continue;

            const checkinId = `${homeId}_${residentData.id}_${today}`;
            await fetch(
              `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/checkins/${checkinId}`,
              {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fields: {
                    id: { stringValue: checkinId },
                    homeId: { stringValue: homeId },
                    residentId: { stringValue: residentData.id },
                    date: { stringValue: today },
                    status: { stringValue: 'awaiting' },
                    timestamp: { timestampValue: new Date().toISOString() },
                    updatedBy: { stringValue: 'morning_job' },
                  },
                }),
              }
            );
            totalCreated++;
          }
        }

        perHome.push({ homeId, reset: todayCheckins.length });
      } catch (err) {
        console.error(`[daily-reset] Error processing home ${homeId}:`, err.message);
        perHome.push({ homeId, error: err.message });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[daily-reset] Complete in ${duration}ms. Reset: ${totalReset}, Created: ${totalCreated}`);

    return res.status(200).json({
      success: true,
      date: today,
      durationMs: duration,
      homesProcessed: homeIds.length,
      totalReset,
      totalCreated,
      perHome,
    });
  } catch (err) {
    console.error('[daily-reset] Fatal error:', err);
    return res.status(500).json({ error: err.message || 'Daily reset failed' });
  }
}

// Parse a Firestore REST API document into a plain object
function parseFirestoreDoc(doc) {
  const data = { id: doc.name.split('/').pop() };
  const fields = doc.fields || {};
  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) data[key] = value.stringValue;
    else if (value.integerValue !== undefined) data[key] = parseInt(value.integerValue, 10);
    else if (value.doubleValue !== undefined) data[key] = parseFloat(value.doubleValue);
    else if (value.booleanValue !== undefined) data[key] = value.booleanValue;
    else if (value.timestampValue !== undefined) data[key] = value.timestampValue;
    else if (value.nullValue !== undefined) data[key] = null;
  }
  return data;
}
