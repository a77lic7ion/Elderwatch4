import express from 'express';
import path from 'path';
import fs from 'fs';
import * as dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  firestore,
  FieldValue,
  homesRef,
  staffRef,
  residentsRef,
  checkinsRef,
  jobLogsRef,
  pushLogsRef,
  getDocById,
  setDocById,
  deleteDocById,
  getDocsByQuery,
  getDocsByField,
  getAllDocs,
  buildQuery,
} from './lib/firebase-admin';

const app = express();
const PORT = 3000;

// --- Reminder push credentials -------------------------------------------
// The shared sender (api/cron/reminder-push.js) reads plain env vars, which
// Vercel provides in production. Locally those come from service-account.json
// plus .env.local, so bridge them once at boot.
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
try {
  const saPath = path.join(process.cwd(), 'service-account.json');
  if (fs.existsSync(saPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    if (!process.env.FIREBASE_PROJECT_ID) process.env.FIREBASE_PROJECT_ID = serviceAccount.project_id;
    if (!process.env.FIREBASE_CLIENT_EMAIL) process.env.FIREBASE_CLIENT_EMAIL = serviceAccount.client_email;
    if (!process.env.FIREBASE_PRIVATE_KEY) process.env.FIREBASE_PRIVATE_KEY = serviceAccount.private_key;
  }
} catch {
  // Graceful fallback if service account cannot be read.
}

app.use(express.json());

// --- Firestore-backed database helpers ---

export function getTodaySAST(): string {
  const now = new Date();
  const sastDate = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  return sastDate.toISOString().split('T')[0];
}

export function getCurrentTimeSAST(): string {
  const now = new Date();
  const sastDate = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  return sastDate.toISOString().substring(11, 16);
}

// Check if a resident is currently away based on their away date range
function isResidentAway(resident: any, today: string): boolean {
  if (!resident.isAway) return false;
  if (!resident.awayStartDate) return false;
  const start = resident.awayStartDate;
  const end = resident.awayEndDate || '9999-12-31';
  return today >= start && today <= end;
}

// Seed Firestore with initial data if empty
async function seedFirestore() {
  const homesSnap = await getAllDocs('homes');
  if (homesSnap.length > 0) {
    console.log('[SEED] Firestore already seeded, skipping.');
    return;
  }

  console.log('[SEED] Seeding Firestore with initial data...');
  const nowISO = new Date().toISOString();

  // Create default home
  const homeId = 'home-methodist-1';
  await setDocById('homes', homeId, {
    id: homeId,
    name: 'Methodist Home 1',
    cutoffTime: '09:15',
    timezone: 'Africa/Johannesburg',
    createdAt: nowISO,
  });

  // Create default admin
  await setDocById('staff', 'admin-shaun', {
    id: 'admin-shaun',
    homeId,
    name: 'Shaun Gordon',
    email: 'shaunwgordon@gmail.com',
    passwordHash: 'B33tl3sL1lly@123',
    role: 'admin',
  });

  // Create default nurse
  await setDocById('staff', 'staff-mary', {
    id: 'staff-mary',
    homeId,
    name: 'Mary Nurse',
    email: 'marynurse@methodist.care',
    passwordHash: 'Marynurse@123',
    role: 'nurse',
  });

  console.log('[SEED] Seeded home, admin, and nurse.');
}

// Ensure today's check-in records exist for all residents in a home
async function ensureTodayCheckins(homeId: string) {
  const today = getTodaySAST();
  const residents = await getDocsByField('residents', 'homeId', homeId);
  let createdCount = 0;

  for (const resident of residents) {
    const checkinId = `${homeId}_${resident.id}_${today}`;
    const existing = await getDocById('checkins', checkinId);
    if (!existing) {
      await setDocById('checkins', checkinId, {
        id: checkinId,
        homeId,
        residentId: resident.id,
        date: today,
        status: 'awaiting',
        timestamp: new Date().toISOString(),
        updatedBy: 'morning_job',
      });
      createdCount++;
    }
  }

  if (createdCount > 0) {
    console.log(`[SEED] Created ${createdCount} checkins for today.`);
  }
}

// --- Scheduled Jobs Engine ---

export async function runMorningResetJob(homeId?: string) {
  const today = getTodaySAST();
  const targetHomes = homeId
    ? [await getDocById('homes', homeId)].filter(Boolean)
    : await getAllDocs('homes');

  let totalResidentsReset = 0;

  for (const home of targetHomes) {
    if (!home) continue;
    const residents = await getDocsByField('residents', 'homeId', home.id);
    let awayCount = 0;
    for (const resident of residents) {
      const checkinId = `${home.id}_${resident.id}_${today}`;
      if (isResidentAway(resident, today)) {
        await setDocById('checkins', checkinId, {
          id: checkinId,
          homeId: home.id,
          residentId: resident.id,
          date: today,
          status: 'ok',
          timestamp: new Date().toISOString(),
          updatedBy: 'auto_away',
        });
        awayCount++;
      } else {
        await setDocById('checkins', checkinId, {
          id: checkinId,
          homeId: home.id,
          residentId: resident.id,
          date: today,
          status: 'awaiting',
          timestamp: new Date().toISOString(),
          updatedBy: 'morning_job',
        });
      }
      totalResidentsReset++;
    }

    const jobLogId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await setDocById('jobLogs', jobLogId, {
      id: jobLogId,
      homeId: home.id,
      jobType: 'morning_reset',
      description: `07:00 SAST Morning Reset: ${residents.length - awayCount} residents reset to "awaiting", ${awayCount} auto-checked (away)`,
      residentsAffected: residents.length,
      timestamp: new Date().toISOString(),
    });

    const pushLogId = `push-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await setDocById('pushLogs', pushLogId, {
      id: pushLogId,
      homeId: home.id,
      targetType: 'all_awaiting',
      recipientName: `All ${home.name} Residents`,
      title: 'ElderWatch Morning Check-in',
      body: 'Good morning! Please tap your screen to confirm you are safe and well.',
      timestamp: new Date().toISOString(),
      status: 'delivered',
    });

    broadcastToHome(home.id, 'checkin_updated', {
      type: 'morning_reset',
      message: 'Morning reset executed.',
    });
  }

  return totalResidentsReset;
}

export async function runReminderPushJob(homeId?: string) {
  const today = getTodaySAST();
  const targetHomes = homeId
    ? [await getDocById('homes', homeId)].filter(Boolean)
    : await getAllDocs('homes');

  let totalReminded = 0;

  // Who still needs a nudge — read-only, keeps the job log accurate.
  const awaitingByHome: Record<string, number> = {};
  for (const home of targetHomes) {
    if (!home) continue;
    const residents = await getDocsByField('residents', 'homeId', home.id);
    let awaitingCount = 0;
    for (const resident of residents) {
      if (isResidentAway(resident, today)) continue;
      const checkin = await getDocById('checkins', `${home.id}_${resident.id}_${today}`);
      if (!checkin || checkin.status === 'awaiting') awaitingCount++;
    }
    awaitingByHome[home.id] = awaitingCount;
    totalReminded += awaitingCount;
  }

  // Deliver for real — the SAME code path the production Vercel cron uses, so
  // what we test locally is exactly what runs at 08:00 SAST in production.
  let pushResult: any = null;
  try {
    const { sendReminderPushes } = await import('./api/cron/reminder-push.js');
    pushResult = await sendReminderPushes({
      dryRun: process.env.REMINDER_DRY_RUN === '1',
    });
    console.log(
      '[REMINDER] push result:',
      JSON.stringify({ ...pushResult, targets: pushResult?.targets?.length })
    );
  } catch (e: any) {
    console.error('[REMINDER] push send failed:', e?.message || e);
  }

  for (const home of targetHomes) {
    if (!home) continue;
    const awaitingCount = awaitingByHome[home.id] ?? 0;

    const jobLogId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const homeStats = pushResult?.perHome?.[home.id] || { targets: 0, sent: 0, failed: 0, removedDeadSubscriptions: 0 };
    await setDocById('jobLogs', jobLogId, {
      id: jobLogId,
      homeId: home.id,
      jobType: 'reminder_push',
      description:
        `08:00 SAST Reminder: ${awaitingCount} resident(s) awaiting check-in, ` +
        `${homeStats.sent} phone reminder(s) delivered` +
        (homeStats.failed ? `, ${homeStats.failed} failed` : '') +
        (homeStats.removedDeadSubscriptions ? `, ${homeStats.removedDeadSubscriptions} stale device(s) cleared` : ''),
      residentsAffected: homeStats.sent,
      timestamp: new Date().toISOString(),
    });

    broadcastToHome(home.id, 'reminder_sent', {
      type: 'reminder_push',
      count: awaitingCount,
    });
  }

  return totalReminded;
}

export async function runCutoffSweepJob(homeId?: string) {
  const today = getTodaySAST();
  const targetHomes = homeId
    ? [await getDocById('homes', homeId)].filter(Boolean)
    : await getAllDocs('homes');

  let totalMarkedNoResponse = 0;

  for (const home of targetHomes) {
    if (!home) continue;
    const residents = await getDocsByField('residents', 'homeId', home.id);
    let homeCount = 0;

    for (const resident of residents) {
      if (isResidentAway(resident, today)) continue;
      const checkinId = `${home.id}_${resident.id}_${today}`;
      const checkin = await getDocById('checkins', checkinId);
      if (checkin && checkin.status === 'awaiting') {
        await setDocById('checkins', checkinId, {
          ...checkin,
          status: 'no_response',
          timestamp: new Date().toISOString(),
          updatedBy: 'cutoff_job',
          notes: `Passed cutoff time (${home.cutoffTime} SAST). Automatically marked as no_response.`,
        });
        homeCount++;
        totalMarkedNoResponse++;
      }
    }

    if (homeCount > 0) {
      const jobLogId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      await setDocById('jobLogs', jobLogId, {
        id: jobLogId,
        homeId: home.id,
        jobType: 'cutoff_sweep',
        description: `Cutoff Sweep (${home.cutoffTime} SAST): ${homeCount} residents marked as "no_response"`,
        residentsAffected: homeCount,
        timestamp: new Date().toISOString(),
      });

      broadcastToHome(home.id, 'checkin_updated', {
        type: 'cutoff_sweep',
        message: `${homeCount} residents transitioned to no_response.`,
      });
    }
  }

  return totalMarkedNoResponse;
}

// Trigger emergency alert on "not_ok"
async function triggerEmergencyAlert(homeId: string, residentId: string) {
  const resident = await getDocById('residents', residentId);
  const home = await getDocById('homes', homeId);
  if (!resident || !home) return;

  const jobLogId = `alert-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  await setDocById('jobLogs', jobLogId, {
    id: jobLogId,
    homeId,
    jobType: 'emergency_alert',
    description: `URGENT: ${resident.name} (Room ${resident.roomNumber}) tapped "I need help"!`,
    residentsAffected: 1,
    timestamp: new Date().toISOString(),
    details: `Immediate dispatch broadcasted to all active nursing staff. Room: ${resident.roomNumber}, Phone: ${resident.phone}`,
  });

  const pushLogId = `push-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  await setDocById('pushLogs', pushLogId, {
    id: pushLogId,
    homeId,
    targetType: 'staff',
    recipientName: `${home.name} Staff On-Duty`,
    title: `EMERGENCY: Room ${resident.roomNumber}`,
    body: `${resident.name} has pressed "I need help". Please check Room ${resident.roomNumber} immediately!`,
    timestamp: new Date().toISOString(),
    status: 'delivered',
  });

  broadcastToHome(homeId, 'urgent_alert', {
    residentId: resident.id,
    residentName: resident.name,
    roomNumber: resident.roomNumber,
    phone: resident.phone,
    timestamp: new Date().toISOString(),
    alertText: `${resident.name} in Room ${resident.roomNumber} tapped "I need help"`,
  });
}

// Background Interval for SAST cron triggers
let lastExecutedMinute = '';
setInterval(async () => {
  const currentTime = getCurrentTimeSAST();
  if (currentTime === lastExecutedMinute) return;
  lastExecutedMinute = currentTime;

  if (currentTime === '07:00') {
    console.log('[CRON SAST] 07:00 SAST reached: executing morning reset job');
    await runMorningResetJob();
  }

  if (currentTime === '08:00') {
    console.log('[CRON SAST] 08:00 SAST reached: executing reminder push job');
    await runReminderPushJob();
  }

  const homes = await getAllDocs('homes');
  for (const home of homes) {
    if ((home as any).cutoffTime === currentTime) {
      console.log(`[CRON SAST] Cutoff time ${currentTime} reached for ${(home as any).name}`);
      await runCutoffSweepJob((home as any).id);
    }
  }
}, 30000);

// --- SSE Clients ---
const sseClients: Map<string, Set<express.Response>> = new Map();

function broadcastToHome(homeId: string, event: string, payload: unknown) {
  const clients = sseClients.get(homeId);
  if (!clients || clients.size === 0) return;

  const dataStr = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(dataStr);
    } catch {
      clients.delete(client);
    }
  }
}

// --- REST API ROUTES ---

app.get('/api/health', async (req, res) => {
  const homes = await getAllDocs('homes');
  const residents = await getAllDocs('residents');
  res.json({
    status: 'ok',
    currentTimeSAST: getCurrentTimeSAST(),
    todaySAST: getTodaySAST(),
    homesCount: homes.length,
    residentsCount: residents.length,
  });
});

// Staff Authentication
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const queryLower = email.toLowerCase().trim();
  const allStaff = await getAllDocs('staff');
  const staff = allStaff.find((s: any) => {
    const sEmail = s.email.toLowerCase().trim();
    const sName = s.name.toLowerCase().trim();
    const sNameClean = sName.replace(/\s+/g, '');
    const queryClean = queryLower.replace(/\s+/g, '');
    return sEmail === queryLower || sName === queryLower || sNameClean === queryClean;
  });

  if (!staff || (staff as any).passwordHash !== password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const home = await getDocById('homes', (staff as any).homeId);
  const token = Buffer.from(
    JSON.stringify({ staffId: staff.id, homeId: home?.id || (staff as any).homeId, role: (staff as any).role, time: Date.now() })
  ).toString('base64');

  res.json({
    token,
    user: {
      id: staff.id,
      homeId: (staff as any).homeId,
      name: (staff as any).name,
      email: (staff as any).email,
      role: (staff as any).role,
    },
    home: home || null,
  });
});

// Helper to authenticate staff
function authenticateStaff(req: express.Request, res: express.Response): { staffId: string; homeId: string; role?: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized. Staff login token required.' });
    return null;
  }

  try {
    const raw = Buffer.from(authHeader.substring(7), 'base64').toString('utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.homeId || !parsed.staffId) {
      res.status(401).json({ error: 'Invalid token structure.' });
      return null;
    }
    const requestedHome = (req.headers['x-home-id'] as string) || (req.query.homeId as string);
    if (parsed.role === 'admin' && requestedHome) {
      return { staffId: parsed.staffId, homeId: requestedHome, role: parsed.role };
    }
    return parsed;
  } catch {
    res.status(401).json({ error: 'Failed to decode token.' });
    return null;
  }
}

function authenticateAdmin(req: express.Request, res: express.Response): { staffId: string; homeId: string } | null {
  const auth = authenticateStaff(req, res);
  if (!auth) return null;
  if (auth.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden. Administrator privileges required.' });
    return null;
  }
  return auth;
}

// --- ENTERPRISE ADMIN API ROUTES ---

app.get('/api/admin/overview', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const homes = await getAllDocs('homes');
  const allStaff = await getAllDocs('staff');
  const allResidents = await getAllDocs('residents');
  const today = getTodaySAST();

  const homesList = await Promise.all(homes.map(async (h: any) => {
    const staffCount = allStaff.filter((s: any) => s.homeId === h.id).length;
    const residentsCount = allResidents.filter((r: any) => r.homeId === h.id).length;
    return { ...h, staffCount, residentsCount };
  }));

  const staffList = allStaff.map((s: any) => ({
    id: s.id,
    homeId: s.homeId,
    homeName: homes.find((h: any) => h.id === s.homeId)?.name || 'Unassigned',
    name: s.name,
    email: s.email,
    password: s.passwordHash,
    role: s.role,
  }));

  const residentsList = await Promise.all(allResidents.map(async (r: any) => {
    const checkin = await getDocById('checkins', `${r.homeId}_${r.id}_${today}`);
    return {
      ...r,
      homeName: homes.find((h: any) => h.id === r.homeId)?.name || 'Unknown Home',
      todayStatus: checkin ? checkin.status : 'awaiting',
    };
  }));

  res.json({
    homes: homesList,
    staff: staffList,
    residents: residentsList,
    stats: {
      totalHomes: homesList.length,
      totalStaff: staffList.length,
      totalResidents: residentsList.length,
    },
  });
});

app.post('/api/admin/homes', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const { name, cutoffTime, timezone } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Home name is required' });
  }

  const id = `home-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const newHome = {
    id,
    name: name.trim(),
    cutoffTime: (cutoffTime || '09:15').trim(),
    timezone: (timezone || 'Africa/Johannesburg').trim(),
    createdAt: new Date().toISOString(),
  };

  await setDocById('homes', id, newHome);
  res.json({ success: true, home: newHome });
});

app.patch('/api/admin/homes/:id', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const home = await getDocById('homes', req.params.id);
  if (!home) return res.status(404).json({ error: 'Home not found' });

  const { name, cutoffTime, timezone } = req.body;
  const updated: any = { ...home };
  if (name) updated.name = name.trim();
  if (cutoffTime) updated.cutoffTime = cutoffTime.trim();
  if (timezone) updated.timezone = timezone.trim();

  await setDocById('homes', req.params.id, updated);
  res.json({ success: true, home: updated });
});

app.delete('/api/admin/homes/:id', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const homeId = req.params.id;
  const homes = await getAllDocs('homes');
  if (homes.length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the only remaining home.' });
  }

  await deleteDocById('homes', homeId);

  const staff = await getDocsByField('staff', 'homeId', homeId);
  for (const s of staff) {
    await deleteDocById('staff', s.id);
  }

  const residents = await getDocsByField('residents', 'homeId', homeId);
  for (const r of residents) {
    await deleteDocById('residents', r.id);
  }

  res.json({ success: true });
});

app.post('/api/admin/staff', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const { name, email, password, role, homeId } = req.body;
  if (!name || !email || !password || !homeId) {
    return res.status(400).json({ error: 'Name, email, password, and home assignment are required' });
  }

  const home = await getDocById('homes', homeId);
  if (!home) {
    return res.status(400).json({ error: 'Selected care home does not exist' });
  }

  const id = `staff-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const newStaff = {
    id,
    homeId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: password.trim(),
    role: (role || 'nurse') as 'nurse' | 'admin' | 'caregiver',
  };

  await setDocById('staff', id, newStaff);
  res.json({ success: true, staff: newStaff });
});

app.patch('/api/admin/staff/:id', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const staff = await getDocById('staff', req.params.id);
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });

  const { name, email, password, role, homeId } = req.body;
  const updated: any = { ...staff };
  if (name) updated.name = name.trim();
  if (email) updated.email = email.trim().toLowerCase();
  if (password) updated.passwordHash = password.trim();
  if (role) updated.role = role;
  if (homeId) {
    const home = await getDocById('homes', homeId);
    if (home) updated.homeId = homeId;
  }

  await setDocById('staff', req.params.id, updated);
  res.json({ success: true, staff: updated });
});

app.delete('/api/admin/staff/:id', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const staff = await getDocById('staff', req.params.id);
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });
  if ((staff as any).email === 'shaunwgordon@gmail.com') {
    return res.status(400).json({ error: 'Cannot delete primary enterprise administrator.' });
  }

  await deleteDocById('staff', req.params.id);
  res.json({ success: true });
});

// --- Direct Staff & Home API endpoints (used by frontend client SDK helpers) ---

app.post('/api/create-staff', async (req, res) => {
  try {
    const { email, password, name, role, homeId } = req.body;
    if (!email || !name || !role || !homeId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const id = `staff-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newStaff = {
      id,
      homeId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: password ? password.trim() : 'Password123!',
      role: role || 'nurse',
      createdAt: new Date().toISOString(),
    };
    await setDocById('staff', id, newStaff);
    res.status(200).json({ success: true, user: newStaff, staff: newStaff });
  } catch (err: any) {
    console.error('Error creating staff:', err);
    res.status(500).json({ error: err.message || 'Failed to create staff' });
  }
});

app.post('/api/update-staff', async (req, res) => {
  try {
    const { staffId, email, password, name, role, homeId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'Missing staffId' });
    const staff = await getDocById('staff', staffId);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    const updated: any = { ...staff };
    if (name !== undefined) updated.name = name.trim();
    if (email !== undefined) updated.email = email.trim().toLowerCase();
    if (password) updated.passwordHash = password.trim();
    if (role !== undefined) updated.role = role;
    if (homeId !== undefined) updated.homeId = homeId;
    await setDocById('staff', staffId, updated);
    res.json({ success: true, user: updated, staff: updated });
  } catch (err: any) {
    console.error('Error updating staff:', err);
    res.status(500).json({ error: err.message || 'Failed to update staff' });
  }
});

app.post('/api/delete-staff', async (req, res) => {
  try {
    const { staffId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'Missing staffId' });
    const staff = await getDocById('staff', staffId);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    if ((staff as any).email === 'shaunwgordon@gmail.com') {
      return res.status(400).json({ error: 'Cannot delete primary enterprise administrator.' });
    }
    await deleteDocById('staff', staffId);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting staff:', err);
    res.status(500).json({ error: err.message || 'Failed to delete staff' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { staffId, newPassword } = req.body;
    if (!staffId || !newPassword) {
      return res.status(400).json({ error: 'Missing staffId or newPassword' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const staff = await getDocById('staff', staffId);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    const updated = { ...staff, passwordHash: newPassword.trim() };
    await setDocById('staff', staffId, updated);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err: any) {
    console.error('Error resetting password:', err);
    res.status(500).json({ error: err.message || 'Failed to reset password' });
  }
});

app.post('/api/create-home', async (req, res) => {
  try {
    const { id, name, address, phone, email, cutoffTime, timezone } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing required fields' });
    const homeId = id || `home-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const home = {
      id: homeId,
      name: name.trim(),
      address: address || '',
      phone: phone || '',
      email: email || '',
      cutoffTime: (cutoffTime || '09:15').trim(),
      timezone: (timezone || 'Africa/Johannesburg').trim(),
      createdAt: new Date().toISOString(),
    };
    await setDocById('homes', homeId, home);
    res.json({ success: true, home });
  } catch (err: any) {
    console.error('Error creating home:', err);
    res.status(500).json({ error: err.message || 'Failed to create home' });
  }
});

app.post('/api/delete-home', async (req, res) => {
  try {
    const { homeId } = req.body;
    if (!homeId) return res.status(400).json({ error: 'Missing homeId' });
    await deleteDocById('homes', homeId);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting home:', err);
    res.status(500).json({ error: err.message || 'Failed to delete home' });
  }
});

app.post('/api/admin/residents', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const { homeId, name, roomNumber, phone, emergencyContact, notes } = req.body;
  if (!homeId || !name || !roomNumber) {
    return res.status(400).json({ error: 'Home, name, and room number are required' });
  }

  const id = `res-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const cleanCode = `LINK-${roomNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

  const newResident = {
    id,
    homeId,
    name: name.trim(),
    roomNumber: roomNumber.trim(),
    phone: (phone || '').trim(),
    emergencyContact: (emergencyContact || '').trim(),
    notes: (notes || '').trim(),
    isDeviceLinked: false,
    linkedAt: null,
    oneTimeLinkCode: cleanCode,
    pushToken: null,
    createdAt: new Date().toISOString(),
  };

  await setDocById('residents', id, newResident);
  res.json({ success: true, resident: newResident });
});

app.delete('/api/admin/residents/:id', async (req, res) => {
  const admin = authenticateAdmin(req, res);
  if (!admin) return;

  const resident = await getDocById('residents', req.params.id);
  if (!resident) return res.status(404).json({ error: 'Resident not found' });

  await deleteDocById('residents', req.params.id);

  const checkins = await getDocsByQuery(
    buildQuery('checkins', [{field: 'residentId', op: '==', value: req.params.id}])
  );
  for (const c of checkins) {
    await deleteDocById('checkins', c.id);
  }

  res.json({ success: true });
});

// SSE Endpoint
app.get('/api/realtime', (req, res) => {
  const homeId = req.query.homeId as string;
  if (!homeId) {
    return res.status(400).json({ error: 'homeId is required for SSE stream' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(homeId)) {
    sseClients.set(homeId, new Set());
  }
  sseClients.get(homeId)!.add(res);

  res.write(`event: connected\ndata: ${JSON.stringify({ homeId, time: new Date().toISOString() })}\n\n`);

  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAliveInterval);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
    const clients = sseClients.get(homeId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(homeId);
      }
    }
  });
});

// Home endpoints
app.get('/api/home', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const home = await getDocById('homes', auth.homeId);
  if (!home) return res.status(404).json({ error: 'Home not found' });
  res.json({ home });
});

app.patch('/api/home/settings', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const home = await getDocById('homes', auth.homeId);
  if (!home) return res.status(404).json({ error: 'Home not found' });

  const { name, cutoffTime } = req.body;
  const updated: any = { ...home };
  if (name && typeof name === 'string') updated.name = name.trim();
  if (cutoffTime && typeof cutoffTime === 'string') updated.cutoffTime = cutoffTime.trim();

  await setDocById('homes', auth.homeId, updated);
  broadcastToHome(auth.homeId, 'home_updated', { home: updated });
  res.json({ success: true, home: updated });
});

// Residents endpoints
app.get('/api/residents', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  await ensureTodayCheckins(auth.homeId);
  const today = getTodaySAST();

  const residents = await getDocsByField('residents', 'homeId', auth.homeId);
  const residentsList = await Promise.all(residents.map(async (r: any) => {
    const checkin = await getDocById('checkins', `${auth.homeId}_${r.id}_${today}`);
    return {
      ...r,
      todayStatus: checkin ? checkin.status : 'awaiting',
      todayTimestamp: checkin ? checkin.timestamp : null,
      todayUpdatedBy: checkin ? checkin.updatedBy : null,
      notes: r.notes || '',
    };
  }));

  res.json({ residents: residentsList });
});

app.post('/api/residents', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const { name, phone, roomNumber, emergencyContact, notes } = req.body;
  if (!name || !roomNumber) {
    return res.status(400).json({ error: 'Name and room number are required.' });
  }

  const newId = `res-${Date.now().toString(36)}`;
  const linkCode = `LINK-${roomNumber.replace(/[^a-zA-Z0-9]/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const newResident = {
    id: newId,
    homeId: auth.homeId,
    name: name.trim(),
    phone: phone ? phone.trim() : '',
    roomNumber: roomNumber.trim(),
    isDeviceLinked: false,
    linkedAt: null,
    oneTimeLinkCode: linkCode,
    linkCodeGeneratedAt: new Date().toISOString(),
    pushToken: null,
    emergencyContact: emergencyContact ? emergencyContact.trim() : '',
    notes: notes ? notes.trim() : '',
    createdAt: new Date().toISOString(),
  };

  await setDocById('residents', newId, newResident);

  const today = getTodaySAST();
  const checkinId = `${auth.homeId}_${newId}_${today}`;
  await setDocById('checkins', checkinId, {
    id: checkinId,
    homeId: auth.homeId,
    residentId: newId,
    date: today,
    status: 'awaiting',
    timestamp: new Date().toISOString(),
    updatedBy: 'morning_job',
  });

  broadcastToHome(auth.homeId, 'resident_added', { resident: newResident });
  res.status(201).json({ resident: newResident });
});

app.put('/api/residents/:id', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const resident = await getDocById('residents', req.params.id);
  if (!resident || (resident as any).homeId !== auth.homeId) {
    return res.status(404).json({ error: 'Resident not found in this home' });
  }

  const { name, phone, roomNumber, emergencyContact, notes } = req.body;
  const updated: any = { ...resident };
  if (name) updated.name = name.trim();
  if (phone !== undefined) updated.phone = phone.trim();
  if (roomNumber) updated.roomNumber = roomNumber.trim();
  if (emergencyContact !== undefined) updated.emergencyContact = emergencyContact.trim();
  if (notes !== undefined) updated.notes = notes.trim();

  await setDocById('residents', req.params.id, updated);
  broadcastToHome(auth.homeId, 'resident_updated', { resident: updated });
  res.json({ resident: updated });
});

app.delete('/api/residents/:id', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const resident = await getDocById('residents', req.params.id);
  if (!resident || (resident as any).homeId !== auth.homeId) {
    return res.status(404).json({ error: 'Resident not found in this home' });
  }

  await deleteDocById('residents', req.params.id);

  const checkins = await getDocsByQuery(
    buildQuery('checkins', [{field: 'residentId', op: '==', value: req.params.id}])
  );
  for (const c of checkins) {
    await deleteDocById('checkins', c.id);
  }

  broadcastToHome(auth.homeId, 'resident_deleted', { residentId: req.params.id });
  res.json({ success: true });
});

// Mark resident as away / mark as back
app.patch('/api/residents/:id/away', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const resident = await getDocById('residents', req.params.id);
  if (!resident || (resident as any).homeId !== auth.homeId) {
    return res.status(404).json({ error: 'Resident not found in this home' });
  }

  const { isAway, awayStartDate, awayEndDate, awayNote } = req.body;

  const updated: any = { ...resident };
  if (typeof isAway === 'boolean') {
    updated.isAway = isAway;
  }
  if (awayStartDate !== undefined) {
    updated.awayStartDate = awayStartDate || null;
  }
  if (awayEndDate !== undefined) {
    updated.awayEndDate = awayEndDate || null;
  }
  if (awayNote !== undefined) {
    updated.awayNote = awayNote || '';
  }

  // Clear away dates when marking as back
  if (isAway === false) {
    updated.awayStartDate = null;
    updated.awayEndDate = null;
    updated.awayNote = '';
  }

  await setDocById('residents', req.params.id, updated);
  broadcastToHome(auth.homeId, 'resident_updated', { resident: updated });
  res.json({ resident: updated });
});

app.post('/api/residents/:id/link-code', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const resident = await getDocById('residents', req.params.id);
  if (!resident || (resident as any).homeId !== auth.homeId) {
    return res.status(404).json({ error: 'Resident not found in this home' });
  }

  const linkCode = `LINK-${(resident as any).roomNumber.replace(/[^a-zA-Z0-9]/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const updated = {
    ...resident,
    oneTimeLinkCode: linkCode,
    linkCodeGeneratedAt: new Date().toISOString(),
    isDeviceLinked: false,
    linkedAt: null,
  };

  await setDocById('residents', req.params.id, updated);
  broadcastToHome(auth.homeId, 'resident_updated', { resident: updated });
  res.json({ linkCode, resident: updated });
});

// Device Linking
app.get('/api/link/verify', async (req, res) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).json({ error: 'Link code is required' });

  const residents = await getAllDocs('residents');
  const resident = residents.find((r: any) => r.oneTimeLinkCode && r.oneTimeLinkCode.toUpperCase() === code.trim().toUpperCase());

  if (!resident) {
    return res.status(404).json({ error: 'Invalid, expired, or already used linking code.' });
  }

  const home = await getDocById('homes', (resident as any).homeId);
  res.json({
    valid: true,
    resident: {
      id: resident.id,
      name: (resident as any).name,
      roomNumber: (resident as any).roomNumber,
      homeId: (resident as any).homeId,
      linkCodeGeneratedAt: (resident as any).linkCodeGeneratedAt || null,
    },
    home: home ? { id: home.id, name: home.name } : null,
  });
});

app.post('/api/link/bind', async (req, res) => {
  const { code, pushToken, linkCodeGeneratedAt } = req.body;
  if (!code) return res.status(400).json({ error: 'Link code is required' });

  const residents = await getAllDocs('residents');
  const resident = residents.find((r: any) => r.oneTimeLinkCode && r.oneTimeLinkCode.toUpperCase() === code.trim().toUpperCase());

  if (!resident) {
    return res.status(404).json({ error: 'Invalid, expired, or already used linking code.' });
  }

  // Reject if code was regenerated since this client verified it
  if (linkCodeGeneratedAt && (resident as any).linkCodeGeneratedAt !== linkCodeGeneratedAt) {
    return res.status(410).json({ error: 'This pairing link has been revoked. Please scan the new QR code.' });
  }

  const updated: any = {
    ...resident,
    isDeviceLinked: true,
    linkedAt: new Date().toISOString(),
    oneTimeLinkCode: null,
  };
  if (pushToken) updated.pushToken = pushToken;

  await setDocById('residents', resident.id, updated);
  broadcastToHome((resident as any).homeId, 'resident_linked', { resident: updated });

  const home = await getDocById('homes', (resident as any).homeId);
  res.json({
    success: true,
    binding: {
      residentId: resident.id,
      homeId: (resident as any).homeId,
      residentName: (resident as any).name,
      roomNumber: (resident as any).roomNumber,
      homeName: home ? home.name : 'Care Home',
      linkedAt: updated.linkedAt,
    },
  });
});

// Check-in endpoints
app.post('/api/checkin', async (req, res) => {
  const { residentId, homeId, status, offlineSynced } = req.body;
  if (!residentId || !homeId || !status) {
    return res.status(400).json({ error: 'residentId, homeId, and status are required' });
  }

  if (status !== 'ok' && status !== 'not_ok') {
    return res.status(400).json({ error: 'Invalid status value. Must be "ok" or "not_ok"' });
  }

  const resident = await getDocById('residents', residentId);
  if (!resident || (resident as any).homeId !== homeId) {
    return res.status(404).json({ error: 'Resident not found in this home' });
  }

  const today = getTodaySAST();
  const checkinId = `${homeId}_${residentId}_${today}`;
  const nowISO = new Date().toISOString();

  const checkinRecord = {
    id: checkinId,
    homeId,
    residentId,
    date: today,
    status,
    timestamp: nowISO,
    offlineSynced: !!offlineSynced,
    updatedBy: 'resident',
  };

  await setDocById('checkins', checkinId, checkinRecord);

  broadcastToHome(homeId, 'checkin_updated', {
    residentId,
    status,
    timestamp: nowISO,
    residentName: (resident as any).name,
    roomNumber: (resident as any).roomNumber,
  });

  if (status === 'not_ok') {
    await triggerEmergencyAlert(homeId, residentId);
  }

  res.json({
    success: true,
    checkin: checkinRecord,
    residentName: (resident as any).name,
    roomNumber: (resident as any).roomNumber,
    timestamp: nowISO,
  });
});

app.post('/api/checkin/undo', async (req, res) => {
  const { residentId, homeId } = req.body;
  if (!residentId || !homeId) {
    return res.status(400).json({ error: 'residentId and homeId are required' });
  }

  const resident = await getDocById('residents', residentId);
  if (!resident || (resident as any).homeId !== homeId) {
    return res.status(404).json({ error: 'Resident not found in this home' });
  }

  const today = getTodaySAST();
  const checkinId = `${homeId}_${residentId}_${today}`;
  const nowISO = new Date().toISOString();

  const checkinRecord = {
    id: checkinId,
    homeId,
    residentId,
    date: today,
    status: 'awaiting',
    timestamp: nowISO,
    updatedBy: 'resident',
    notes: 'Check-in undone by resident',
  };

  await setDocById('checkins', checkinId, checkinRecord);

  broadcastToHome(homeId, 'checkin_updated', {
    residentId,
    status: 'awaiting',
    timestamp: nowISO,
    residentName: (resident as any).name,
    roomNumber: (resident as any).roomNumber,
  });

  res.json({ success: true, status: 'awaiting', timestamp: nowISO });
});

app.post('/api/checkins/staff-override', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const { residentId, status, notes } = req.body;
  if (!residentId || !status) {
    return res.status(400).json({ error: 'residentId and status are required' });
  }

  const resident = await getDocById('residents', residentId);
  if (!resident || (resident as any).homeId !== auth.homeId) {
    return res.status(404).json({ error: 'Resident not found in this home' });
  }

  const today = getTodaySAST();
  const checkinId = `${auth.homeId}_${residentId}_${today}`;
  const nowISO = new Date().toISOString();

  const record = {
    id: checkinId,
    homeId: auth.homeId,
    residentId,
    date: today,
    status,
    timestamp: nowISO,
    updatedBy: 'staff_override',
    notes: notes || 'Updated manually by staff',
  };

  await setDocById('checkins', checkinId, record);

  broadcastToHome(auth.homeId, 'checkin_updated', {
    residentId,
    status,
    timestamp: nowISO,
    updatedBy: 'staff_override',
  });

  if (status === 'not_ok') {
    await triggerEmergencyAlert(auth.homeId, residentId);
  }

  res.json({ success: true, checkin: record });
});

// Resident History
app.get('/api/residents/:id/history', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const resident = await getDocById('residents', req.params.id);
  if (!resident || (resident as any).homeId !== auth.homeId) {
    return res.status(404).json({ error: 'Resident not found' });
  }

  const allCheckins = await getDocsByQuery(
    buildQuery('checkins', [{field: 'residentId', op: '==', value: resident.id}, {field: 'homeId', op: '==', value: auth.homeId}])
  );
  const history = allCheckins
    .sort((a: any, b: any) => (a.date > b.date ? -1 : 1))
    .slice(0, 14);

  res.json({ resident, history });
});

// Job triggers
app.post('/api/jobs/trigger-morning-reset', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;
  const count = await runMorningResetJob(auth.homeId);
  res.json({ success: true, message: `07:00 Morning Reset executed for ${count} residents.` });
});

app.post('/api/jobs/trigger-reminder-push', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;
  const count = await runReminderPushJob(auth.homeId);
  res.json({ success: true, message: `08:00 Reminders dispatched to ${count} awaiting residents.` });
});

app.post('/api/jobs/trigger-cutoff-sweep', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;
  const count = await runCutoffSweepJob(auth.homeId);
  res.json({ success: true, message: `Cutoff sweep executed. ${count} residents marked no_response.` });
});

app.post('/api/jobs/simulate-emergency', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const residents = await getDocsByField('residents', 'homeId', auth.homeId);
  if (residents.length === 0) {
    return res.status(400).json({ error: 'No residents available in home' });
  }

  const targetResident = residents[0];
  const today = getTodaySAST();
  const checkinId = `${auth.homeId}_${targetResident.id}_${today}`;
  const nowISO = new Date().toISOString();

  await setDocById('checkins', checkinId, {
    id: checkinId,
    homeId: auth.homeId,
    residentId: targetResident.id,
    date: today,
    status: 'not_ok',
    timestamp: nowISO,
    updatedBy: 'resident',
    notes: 'Simulated emergency "No" tap for demonstration.',
  });

  await triggerEmergencyAlert(auth.homeId, targetResident.id);
  res.json({
    success: true,
    message: `Emergency alert triggered for ${(targetResident as any).name} (Room ${(targetResident as any).roomNumber}).`,
  });
});

// Logs
app.get('/api/jobs/logs', async (req, res) => {
  const auth = authenticateStaff(req, res);
  if (!auth) return;

  const allJobLogs = await getDocsByQuery(
    buildQuery('jobLogs', [{field: 'homeId', op: '==', value: auth.homeId}])
  );
  const allPushLogs = await getDocsByQuery(
    buildQuery('pushLogs', [{field: 'homeId', op: '==', value: auth.homeId}])
  );

  const logs = allJobLogs.sort((a: any, b: any) => (a.timestamp > b.timestamp ? -1 : 1)).slice(0, 30);
  const pushes = allPushLogs.sort((a: any, b: any) => (a.timestamp > b.timestamp ? -1 : 1)).slice(0, 30);

  res.json({ jobLogs: logs, pushLogs: pushes });
});

// System endpoints
app.get('/api/system/evaluation', (req, res) => {
  res.json({
    backendChoice: 'Unified Node.js / Express Container Service (Cloud Run / VPS)',
    comparisons: [
      {
        platform: 'Firebase (Firestore + Auth + Functions)',
        costAt10kScale: 'Exceeds free tier daily limits ($20-$50/mo minimum)',
        verdict: 'Spark plan strictly caps writes at 20k/day. 10,000 residents generate 20k-30k writes/day.',
      },
      {
        platform: 'Supabase (PostgreSQL + Realtime)',
        costAt10kScale: 'Free tier limits concurrent realtime clients to 200 ($25/mo Pro required)',
        verdict: 'Free tier automatically sleeps projects after 7 days of inactivity.',
      },
      {
        platform: 'Cloudflare Workers + D1',
        costAt10kScale: 'Realtime requires Paid Workers with Durable Objects ($5/mo)',
        verdict: 'Workers free tier has 100k requests/day, but real-time SSE/WebSockets requires Durable Objects.',
      },
      {
        platform: 'Unified Node.js / Express on Container (Selected)',
        costAt10kScale: '$0.00 / month (Cloud Run Free Tier or $4/mo VPS)',
        verdict: '2,000,000 requests/mo and 360k vCPU-secs free.',
      },
    ],
  });
});

app.get('/api/system/homes', async (req, res) => {
  const homes = await getAllDocs('homes');
  res.json({ homes });
});

async function startServer() {
  await seedFirestore();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ElderWatch server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
