// ============================================================================
// ElderWatch — daily reminder web push (08:00 SAST)
// ============================================================================
// Vercel cron: `0 6 * * *` (06:00 UTC = 08:00 SAST), see vercel.json.
//
// Scheduled for 08:00 rather than 08:55 because Vercel's Hobby cron precision
// is ±59 minutes — an 08:00 job can land up to 08:59, which is still before the
// 09:15 cutoff. An 08:55 job could land after the sweep it is meant to prevent.
//
// Sends ONLY to residents who are still 'awaiting' today, so anyone who has
// already tapped "I'm OK" is never woken up by a reminder.
//
// Local parity: `server.ts` calls sendReminderPushes() from here too, so the
// dev server and production run the exact same code path.
//
// Required environment variables (Vercel project settings):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
//   CRON_SECRET (optional - lets you trigger it by hand with ?key=...)

import { GoogleAuth } from 'google-auth-library';
import webpush from 'web-push';

const PROJECT_ID = () => process.env.FIREBASE_PROJECT_ID;
const FIRESTORE = () => `https://firestore.googleapis.com/v1/projects/${PROJECT_ID()}/databases/(default)/documents`;

export function getTodaySAST() {
  const now = new Date();
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return sast.toISOString().split('T')[0];
}

function getSastClock() {
  const now = new Date();
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const hh = String(sast.getUTCHours()).padStart(2, '0');
  const mm = String(sast.getUTCMinutes()).padStart(2, '0');
  return { hh, mm };
}

async function getAccessToken() {
  const auth = new GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel env vars cannot hold real newlines - restore them if escaped.
      private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

function parseValue(value) {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return parseFloat(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.mapValue !== undefined) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) out[k] = parseValue(v);
    return out;
  }
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(parseValue);
  return null;
}

export function parseFirestoreDoc(doc) {
  const data = { id: doc.name.split('/').pop() };
  for (const [key, value] of Object.entries(doc.fields || {})) data[key] = parseValue(value);
  return data;
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) fields[key] = { nullValue: null };
    else if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') fields[key] = { doubleValue: value };
    else if (typeof value === 'object') fields[key] = { mapValue: { fields: toFirestoreFields(value) } };
  }
  return fields;
}

async function fetchAll(token, collection, pageSize = 300) {
  const out = [];
  let pageToken = null;
  for (let page = 0; page < 20; page++) {
    const url = `${FIRESTORE()}/${collection}?pageSize=${pageSize}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to list ${collection}: ${res.status}`);
    const body = await res.json();
    for (const d of body.documents || []) out.push(parseFirestoreDoc(d));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Today's check-ins. Uses runQuery with a date filter rather than a full
 *  collection scan (the collection grows ~130 docs per day). */
async function fetchTodayCheckins(token, today) {
  const res = await fetch(`${FIRESTORE()}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'checkins' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'date' },
            op: 'EQUAL',
            value: { stringValue: today },
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`runQuery on checkins failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => parseFirestoreDoc(r.document));
}

async function patchDoc(token, collection, id, fields, updateMask) {
  const mask = updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const res = await fetch(`${FIRESTORE()}/${collection}/${id}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) throw new Error(`PATCH ${collection}/${id} failed: ${res.status}`);
  return res.json();
}

async function logPush(token, entry) {
  const id = `push-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  try {
    await patchDoc(token, 'pushLogs', id, { id, ...entry }, Object.keys({ id, ...entry }));
  } catch (e) {
    console.warn('[reminder-push] Could not write pushLog:', e.message);
  }
  return id;
}

function messageFor(resident) {
  const firstName = (resident.name || 'there').split(' ')[0];
  if (resident.language === 'af') {
    return {
      title: 'ElderWatch — Onthou om in te teken',
      body: `Goeie môre ${firstName}. Tik asseblief die groen knoppie om te laat weet jy is reg.`,
    };
  }
  return {
    title: 'ElderWatch — Reminder',
    body: `Good morning ${firstName}. Please tap the green button to let the sisters know you are OK.`,
  };
}

function isAwayToday(resident, today) {
  if (!resident.isAway) return false;
  const start = resident.awayStartDate || null;
  const end = resident.awayEndDate || null;
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

/**
 * Send today's reminders.
 * @param {{dryRun?: boolean, onlyResidentIds?: string[], limit?: number}} options
 */
export async function sendReminderPushes(options = {}) {
  const { dryRun = false, onlyResidentIds = null, limit = 0 } = options;
  const started = Date.now();
  const today = getTodaySAST();

  if (!PROJECT_ID() || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return { ok: false, error: 'Firebase service account env vars are not set' };
  }
  if (!dryRun && (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY)) {
    return { ok: false, error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set' };
  }

  if (!dryRun) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:shaunwgordon@gmail.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }

  const token = await getAccessToken();
  const [checkins, residents] = await Promise.all([
    fetchTodayCheckins(token, today),
    fetchAll(token, 'residents'),
  ]);

  const byId = new Map(residents.map((r) => [r.id, r]));
  const awaiting = checkins.filter((c) => c.status === 'awaiting');
  const clock = getSastClock();

  const targets = [];
  const skipped = { notLinked: 0, noSubscription: 0, away: 0, missingResident: 0, noCheckin: 0 };

  for (const checkin of awaiting) {
    const resident = byId.get(checkin.residentId);
    if (!resident) {
      skipped.missingResident++;
      continue;
    }
    if (onlyResidentIds && !onlyResidentIds.includes(resident.id)) continue;
    if (isAwayToday(resident, today)) {
      skipped.away++;
      continue;
    }
    if (!resident.isDeviceLinked) {
      skipped.notLinked++;
      continue;
    }
    const sub = resident.pushSubscription;
    if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      skipped.noSubscription++;
      continue;
    }
    targets.push({ resident, checkin, sub });
    if (limit && targets.length >= limit) break;
  }

  const summary = {
    ok: true,
    dryRun,
    date: today,
    sastTime: `${clock.hh}:${clock.mm}`,
    awaitingCount: awaiting.length,
    targetCount: targets.length,
    skipped,
    sent: 0,
    failed: 0,
    removedDeadSubscriptions: 0,
    perHome: {},
    targets: targets.map((t) => ({
      residentId: t.resident.id,
      name: t.resident.name,
      room: t.resident.roomNumber,
      homeId: t.resident.homeId,
      language: t.resident.language || 'en',
    })),
  };

  for (const t of targets) {
    const key = t.resident.homeId;
    summary.perHome[key] = summary.perHome[key] || { targets: 0, sent: 0, failed: 0, removedDeadSubscriptions: 0 };
    summary.perHome[key].targets++;
  }

  if (dryRun || targets.length === 0) {
    summary.durationMs = Date.now() - started;
    return summary;
  }

  const CONCURRENCY = 15;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ resident, sub }) => {
        const message = messageFor(resident);
        const payload = JSON.stringify({
          title: message.title,
          body: message.body,
          url: `/checkin/${resident.id}`,
          tag: `elderwatch-reminder-${today}`,
        });

        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
            payload,
            { TTL: 3600, urgency: 'high' }
          );
          summary.sent++;
          if (summary.perHome[resident.homeId]) summary.perHome[resident.homeId].sent++;
          await patchDoc(token, 'residents', resident.id, { lastReminderSentAt: new Date().toISOString() }, ['lastReminderSentAt']);
          await logPush(token, {
            homeId: resident.homeId,
            residentId: resident.id,
            targetType: 'resident',
            recipientName: `${resident.name} (Room ${resident.roomNumber})`,
            title: message.title,
            body: message.body,
            channel: 'webpush',
            timestamp: new Date().toISOString(),
            status: 'delivered',
          });
        } catch (err) {
          summary.failed++;
          if (summary.perHome[resident.homeId]) summary.perHome[resident.homeId].failed++;
          const code = err?.statusCode;
          // 404/410 = the push service has forgotten this phone (app removed,
          // permission revoked, or iOS dropped the subscription). Clear it.
          if (code === 404 || code === 410) {
            summary.removedDeadSubscriptions++;
            if (summary.perHome[resident.homeId]) summary.perHome[resident.homeId].removedDeadSubscriptions++;
            try {
              await patchDoc(token, 'residents', resident.id, { pushSubscription: null, pushToken: null }, ['pushSubscription', 'pushToken']);
            } catch (e) {
              console.warn('[reminder-push] Could not clear dead subscription:', e.message);
            }
          }
          await logPush(token, {
            homeId: resident.homeId,
            residentId: resident.id,
            targetType: 'resident',
            recipientName: `${resident.name} (Room ${resident.roomNumber})`,
            title: message.title,
            body: message.body,
            channel: 'webpush',
            timestamp: new Date().toISOString(),
            status: 'failed',
            error: `${code || ''} ${err?.body || err?.message || 'send failed'}`.trim().slice(0, 300),
          });
        }
      })
    );
  }

  summary.durationMs = Date.now() - started;
  return summary;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isVercelCron =
    (req.headers['user-agent'] || '').includes('vercel-cron') || !!req.headers['x-vercel-cron'];
  const manualKey = req.query?.key;
  if (!isVercelCron && (!process.env.CRON_SECRET || manualKey !== process.env.CRON_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await sendReminderPushes({
      dryRun: req.query?.dry === '1' || req.query?.dry === 'true',
      limit: req.query?.limit ? parseInt(req.query.limit, 10) : 0,
      onlyResidentIds: req.query?.residentId ? [req.query.residentId] : null,
    });
    console.log('[reminder-push]', JSON.stringify({ ...result, targets: result.targets?.length }));
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    console.error('[reminder-push] Fatal error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Reminder push failed' });
  }
}
