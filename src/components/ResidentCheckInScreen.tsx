import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DeviceBinding } from '../types';
import { saveCheckinToFirestore } from '../lib/firebase';
import {
  ReminderState,
  REMINDER_TIME_SAST,
  enableReminders,
  getReminderState,
  refreshReminderSubscription,
} from '../lib/push';
import { LEGAL_LINE_1 } from './LegalFooter';

interface ResidentCheckInScreenProps {
  onNavigateToAdmin?: () => void;
  onNavigateToLink?: (code?: string) => void;
  permanentResidentId?: string | null;
}

type ViewState = 'morning' | 'ok' | 'help' | 'linked' | 'lang_select' | 'unpaired';
type LangCode = 'en' | 'af';

interface ResidentProfile {
  name: string;
  room: string;
  unit?: string;
  wing: string;
  sister: string;
  sisterInitials: string;
  phone: string;
}

const DEFAULT_RESIDENT: ResidentProfile = {
  name: 'Resident',
  room: 'Room --',
  wing: 'Village',
  sister: 'Sister',
  sisterInitials: 'SS',
  phone: '',
};

const CUTOFF_TIME = '9:00';

const T = {
  en: {
    hello: (h: number) => (h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,'),
    okLabel: "I'm OK",
    okSub: 'Tap once. Sister will know.',
    helpLabel: 'I need help',
    helpSub: 'Sister will come to you.',
    okTitle: (name: string) => `Thank you, ${name}.`,
    okBody: "Sister knows you're up. Have a lovely day.",
    okTime: (t: string) => `Checked in at ${t}`,
    undo: 'Undo',
    helpTitle: 'Help is on its way.',
    helpBody: () => 'Sister has been told.',
    helpTime: (t: string) => `Sent at ${t}`,
    cancel: "I'm fine after all",
    call: () => 'Call Sister',
    callSub: 'On duty',
    late: `It's after ${CUTOFF_TIME}. Please tap I'm OK.`,
    linkedTitle: (name: string) => `Welcome, ${name}.`,
    linkedBody: 'Tap the green button every morning.',
    go: 'Continue',
    langTitle: 'Choose your language',
    langSub: 'Kies jou taal',
    locale: 'en-ZA',
  },
  af: {
    hello: (h: number) => (h < 12 ? 'Goeie môre,' : h < 17 ? 'Goeie middag,' : 'Goeienaand,'),
    okLabel: 'Ek is reg',
    okSub: 'Tik een keer. Suster sal weet.',
    helpLabel: 'Ek het hulp nodig',
    helpSub: 'Suster sal kom.',
    okTitle: (name: string) => `Dankie, ${name}.`,
    okBody: 'Suster weet jy is op. Geniet jou dag.',
    okTime: (t: string) => `Ingeteken om ${t}`,
    undo: 'Herstel',
    helpTitle: 'Hulp is oppad.',
    helpBody: () => 'Suster is in kennis gestel.',
    helpTime: (t: string) => `Gestuur om ${t}`,
    cancel: 'Ek is tog reg',
    call: () => 'Bel Suster',
    callSub: 'Aan diens',
    late: `Dit is na ${CUTOFF_TIME}. Tik Ek is reg.`,
    linkedTitle: (name: string) => `Welkom, ${name}.`,
    linkedBody: 'Tik elke oggend die groen knoppie.',
    go: 'Gaan voort',
    langTitle: 'Kies jou taal',
    langSub: 'Choose your language',
    locale: 'af-ZA',
  },
};

function pad(n: number) {
  return (n < 10 ? '0' : '') + n;
}

function formatHHMM(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const ResidentCheckInScreen: React.FC<ResidentCheckInScreenProps> = ({
  onNavigateToAdmin,
  onNavigateToLink,
  permanentResidentId,
}) => {
  const [deviceBinding, setDeviceBinding] = useState<DeviceBinding | null>(null);
  const [residentProfile, setResidentProfile] = useState<ResidentProfile>(DEFAULT_RESIDENT);
  const [view, setView] = useState<ViewState>('morning');
  const [loading, setLoading] = useState(true);
  const savedLang = (() => {
    try { const s = localStorage.getItem('ew_lang'); return (s === 'af' || s === 'en') ? s : 'en'; } catch { return 'en'; }
  })();
  // true once the user has explicitly chosen a language (or it was previously saved)
  const langChosenRef = useRef(localStorage.getItem('ew_lang') !== null);
  const [lang, setLang] = useState<LangCode>(savedLang);
  const [isLate, setIsLate] = useState(false);
  const [checkInTime, setCheckInTime] = useState<Date | null>(null);
  const [helpTime, setHelpTime] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [flashKind, setFlashKind] = useState<'ok' | 'help' | null>(null);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [reminderState, setReminderState] = useState<ReminderState>('unknown');
  const [reminderBusy, setReminderBusy] = useState(false);

  const playTone = useCallback((good: boolean) => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.connect(g);
      g.connect(ac.destination);
      o.type = 'sine';
      if (good) {
        o.frequency.setValueAtTime(523, ac.currentTime);
        o.frequency.setValueAtTime(784, ac.currentTime + 0.18);
        g.gain.setValueAtTime(0.0001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.7);
        o.start();
        o.stop(ac.currentTime + 0.72);
      } else {
        o.frequency.setValueAtTime(440, ac.currentTime);
        o.frequency.setValueAtTime(330, ac.currentTime + 0.25);
        g.gain.setValueAtTime(0.0001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.9);
        o.start();
        o.stop(ac.currentTime + 0.92);
      }
    } catch {}
  }, []);

  const buzz = useCallback((pattern: number | number[]) => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
    } catch {}
  }, []);

  const triggerFlash = useCallback((kind: 'ok' | 'help') => {
    setFlashKind(kind);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashKind(null), 1100);
  }, []);

  // Load device binding — verify against server FIRST, then render
  useEffect(() => {
    const load = async () => {
      try {
        const saved = localStorage.getItem('elderwatch_device_binding');
        if (!saved) {
          // No binding — go to link screen
          if (onNavigateToLink) onNavigateToLink();
          return;
        }

        const parsed: DeviceBinding = JSON.parse(saved);

        // Verify pairing is still valid on the server BEFORE rendering anything
        // Use { source: 'server' } to avoid Firestore cache returning stale isDeviceLinked:true
        const { db } = await import('../lib/firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        const residentSnap = await getDoc(doc(db, 'residents', parsed.residentId));
        if (!residentSnap.exists() || !residentSnap.data().isDeviceLinked) {
          console.warn('[ElderWatch] Device unpaired on server — showing unpaired screen');
          // Don't clear localStorage — keep the binding so we can re-check on refresh.
          // The unpaired screen instructs the user to clear cache, which wipes localStorage.
          setView('unpaired');
          return;
        }

        // Pairing is valid — set up resident data
        setDeviceBinding(parsed);
        const nameParts = parsed.residentName.split(' ');
        const initials = nameParts.length > 1 ? `${nameParts[0][0]}${nameParts[1][0]}` : nameParts[0].substring(0, 2);
        const firstName = parsed.residentName.split(' ')[0] || parsed.residentName;
        setResidentProfile({
          name: firstName,
          room: `Room ${parsed.roomNumber}`,
          unit: parsed.unitNumber,
          wing: parsed.homeName || 'Village',
          sister: 'Sister',
          sisterInitials: initials.toUpperCase(),
          phone: '',
        });

        document.title = `${firstName} - Room ${parsed.roomNumber}`;

        // Check today's check-in status from localStorage first
        const todayStr = new Date(new Date().getTime() + 2 * 60 * 60 * 1000).toISOString().split('T')[0];
        const existingCheckin = localStorage.getItem(`elderwatch_checkin_${parsed.residentId}_${todayStr}`);
        if (existingCheckin) {
          const pc = JSON.parse(existingCheckin);
          if (pc.status === 'ok') { setView('ok'); setCheckInTime(new Date(pc.timestamp)); langChosenRef.current = true; }
          else if (pc.status === 'not_ok') { setView('help'); setHelpTime(new Date(pc.timestamp)); langChosenRef.current = true; }
        }

        // Fallback: read from Firestore if localStorage didn't have it
        try {
          const sastNow = new Date(new Date().getTime() + 2 * 60 * 60 * 1000);
          const today = sastNow.toISOString().split('T')[0];
          const docId = `${parsed.homeId}_${parsed.residentId}_${today}`;
          const snap = await getDoc(doc(db, 'checkins', docId));
          if (snap.exists()) {
            const data = snap.data();
            localStorage.setItem(
              `elderwatch_checkin_${parsed.residentId}_${today}`,
              JSON.stringify({ status: data.status, timestamp: data.timestamp })
            );
            if (data.status === 'ok') { setView('ok'); setCheckInTime(new Date(data.timestamp)); langChosenRef.current = true; }
            else if (data.status === 'not_ok') { setView('help'); setHelpTime(new Date(data.timestamp)); langChosenRef.current = true; }
          }
        } catch (e) { console.error('[ElderWatch] Firestore fallback failed:', e); }

        // If no language has been chosen yet, prompt for it now
        const alreadyCheckedIn = existingCheckin && (JSON.parse(existingCheckin).status === 'ok' || JSON.parse(existingCheckin).status === 'not_ok');
        if (!localStorage.getItem('ew_lang') && !alreadyCheckedIn) {
          setView('lang_select');
        }
      } catch (e) {
        console.error('Error loading device state:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Real-time listener for Firestore checkin updates (morning reset, staff override, etc.)
  useEffect(() => {
    if (!deviceBinding) return;

    const setupListener = async () => {
      try {
        const { db } = await import('../lib/firebase');
        const { doc, onSnapshot } = await import('firebase/firestore');

        // Get today's date in SAST
        const now = new Date();
        const sastNow = new Date(now.getTime() + (2 * 60 * 60 * 1000));
        const today = sastNow.toISOString().split('T')[0];
        const docId = `${deviceBinding.homeId}_${deviceBinding.residentId}_${today}`;

        console.log('[ElderWatch] Setting up real-time listener for:', docId);

        const unsubscribe = onSnapshot(doc(db, 'checkins', docId), (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            const status = data.status;
            const timestamp = data.timestamp;

            console.log('[ElderWatch] Real-time update received:', status);

            // Update localStorage
            localStorage.setItem(`elderwatch_checkin_${deviceBinding.residentId}_${today}`, JSON.stringify({ status, timestamp }));

            // Don't override view until language has been chosen
            if (!langChosenRef.current) return;

            // Update view based on Firestore status
            if (status === 'awaiting') {
              // Morning reset - go back to main screen
              setView('morning');
              setCheckInTime(null);
              setHelpTime(null);
            } else if (status === 'ok') {
              setView('ok');
              setCheckInTime(new Date(timestamp));
            } else if (status === 'not_ok') {
              setView('help');
              setHelpTime(new Date(timestamp));
            }
          } else {
            // Document deleted - go back to morning
            console.log('[ElderWatch] Checkin document deleted, resetting to morning');
            setView('morning');
            setCheckInTime(null);
            setHelpTime(null);
          }
        }, (error) => {
          console.error('[ElderWatch] Real-time listener error:', error);
        });

        return unsubscribe;
      } catch (e) {
        console.error('[ElderWatch] Failed to setup listener:', e);
        return () => {};
      }
    };

    let unsubscribeFn: (() => void) | undefined;

    setupListener().then((unsub) => {
      unsubscribeFn = unsub;
    });

    return () => {
      if (unsubscribeFn) unsubscribeFn();
    };
  }, [deviceBinding]);

  // Periodic revocation check — if admin rotates link code mid-session, kick the device
  useEffect(() => {
    if (!deviceBinding) return;
    const interval = setInterval(async () => {
      try {
        const { db } = await import('../lib/firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'residents', deviceBinding.residentId));
        if (!snap.exists() || !snap.data().isDeviceLinked) {
          console.warn('[ElderWatch] Device unpaired during session — showing unpaired screen');
          setView('unpaired');
        }
      } catch {}
    }, 60000); // check every 60 seconds
    return () => clearInterval(interval);
  }, [deviceBinding]);

  // Reminder (push notification) state — read it once the phone is paired, and
  // re-assert the subscription so iOS browsers that rotate it don't silently
  // stop delivering the 08:00 reminder.
  useEffect(() => {
    if (!deviceBinding) return;
    let cancelled = false;
    (async () => {
      const state = await refreshReminderSubscription(deviceBinding.residentId);
      if (!cancelled) setReminderState(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceBinding]);

  const handleEnableReminders = async () => {
    if (!deviceBinding || reminderBusy) return;
    setReminderBusy(true);
    try {
      const { state } = await enableReminders(deviceBinding.residentId);
      setReminderState(state);
      if (state === 'on') {
        playTone(true);
        buzz(60);
      }
    } finally {
      setReminderBusy(false);
    }
  };

  const handleDisableReminders = async () => {
    if (!deviceBinding || reminderBusy) return;
    setReminderBusy(true);
    try {
      const { disableReminders } = await import('../lib/push');
      await disableReminders(deviceBinding.residentId);
      setReminderState('off');
    } finally {
      setReminderBusy(false);
    }
  };

  // Shown only when reminders can still be switched on from this screen.
  const reminderHint =
    reminderState === 'off'
      ? 'Daily reminders are OFF — tap to turn on'
      : reminderState === 'needs-install'
      ? 'Add ElderWatch to the Home Screen, then turn reminders on'
      : reminderState === 'denied'
      ? 'Notifications are blocked in this phone\'s settings'
      : '';

  const reminderCanBeEnabled = reminderState === 'off' || reminderState === 'needs-install';

  // Auto-bind from permanent URL or pairing code (?pair=CODE)
  useEffect(() => {
    if (!permanentResidentId) return;
    console.log('[ElderWatch] Auto-bind triggered for:', permanentResidentId);
    const autoBind = async () => {
      try {
        const { db } = await import('../lib/firebase');
        const { doc, getDoc, setDoc, collection, query, where, getDocs } = await import('firebase/firestore');

        // If the URL contains a ?pair=CODE parameter, validate the code first
        // before binding the device. This is what makes the pairing code do
        // link + pair in a single step.
        const urlParams = new URLSearchParams(window.location.search);
        const pairCode = urlParams.get('pair');
        let codeGeneratedAt: string | null = null;
        if (pairCode) {
          console.log('[ElderWatch] Pairing code detected:', pairCode);
          const normalized = pairCode.trim().toUpperCase();
          // Verify the code belongs to this resident
          const r = await getDoc(doc(db, 'residents', permanentResidentId));
          if (!r.exists()) {
            console.error('[ElderWatch] Resident not found for QR pair:', permanentResidentId);
            return;
          }
          const rDataCheck = r.data();
          if (!rDataCheck.oneTimeLinkCode || rDataCheck.oneTimeLinkCode.toUpperCase() !== normalized) {
            console.warn('[ElderWatch] QR pair code does not match this resident');
            return;
          }
          // Store linkCodeGeneratedAt so we can reject stale codes at bind time
          const codeGeneratedAt = rDataCheck.linkCodeGeneratedAt || null;
          // Clean the URL so a refresh doesn't re-trigger the pair flow
          window.history.replaceState({}, '', `/checkin/${permanentResidentId}`);
        }

        const residentDoc = await getDoc(doc(db, 'residents', permanentResidentId));
        if (!residentDoc.exists()) {
          console.error('[ElderWatch] Resident not found:', permanentResidentId);
          return;
        }

        const rData = residentDoc.data();
        console.log('[ElderWatch] Resident data:', rData);

        const homeDoc = await getDoc(doc(db, 'homes', rData.homeId));
        const homeName = homeDoc.exists() ? (homeDoc.data() as any).name : 'Village';

        const binding: DeviceBinding = {
          residentId: permanentResidentId,
          homeId: rData.homeId,
          residentName: rData.name,
          roomNumber: rData.roomNumber,
          unitNumber: rData.unitNumber,
          homeName,
          linkedAt: new Date().toISOString(),
        };

        console.log('[ElderWatch] Created binding:', JSON.stringify(binding));

        // Reject if code was regenerated since this client verified it
        if (codeGeneratedAt && rData.linkCodeGeneratedAt && rData.linkCodeGeneratedAt !== codeGeneratedAt) {
          console.warn('[ElderWatch] Pairing code was revoked — a new code was generated. Please ask staff for the latest code.');
          return;
        }

        // Mark as linked AND clear the one-time code (it's been used)
        // Only link if a valid oneTimeLinkCode exists — don't re-link devices
        // that were deliberately unlinked by staff (code set to null)
        if (rData.oneTimeLinkCode) {
          await setDoc(doc(db, 'residents', permanentResidentId), {
            isDeviceLinked: true,
            linkedAt: new Date().toISOString(),
            oneTimeLinkCode: null,
          }, { merge: true });
        } else if (!rData.isDeviceLinked) {
          // No code and not linked — staff unlinked this device, don't re-pair
          console.warn('[ElderWatch] Resident has no link code and is not linked — refusing to auto-repair');
          return;
        }

        localStorage.setItem('elderwatch_device_binding', JSON.stringify(binding));
        setDeviceBinding(binding);
        console.log('[ElderWatch] Device binding SET in state');

        const nameParts = binding.residentName.split(' ');
        const initials = nameParts.length > 1 ? `${nameParts[0][0]}${nameParts[1][0]}` : nameParts[0].substring(0, 2);
        const firstName = binding.residentName.split(' ')[0] || binding.residentName;
        setResidentProfile({
          name: firstName,
          room: `Room ${binding.roomNumber}`,
          unit: binding.unitNumber,
          wing: homeName,
          sister: 'Sister',
          sisterInitials: initials.toUpperCase(),
          phone: '',
        });

        // Update document title for PWA home screen shortcut
        document.title = `${firstName} - Room ${binding.roomNumber}`;

        // Check if language is already set
        const savedLang = localStorage.getItem('ew_lang');
        if (savedLang === 'af' || savedLang === 'en') {
          setLang(savedLang);
          langChosenRef.current = true;
          setView('linked');
          setTimeout(() => setView('morning'), 2000);
        } else if (rData.language === 'af' || rData.language === 'en') {
          const firebaseLang = rData.language as LangCode;
          setLang(firebaseLang);
          localStorage.setItem('ew_lang', firebaseLang);
          langChosenRef.current = true;
          setView('linked');
          setTimeout(() => setView('morning'), 2000);
        } else {
          setView('lang_select');
        }
      } catch (e) {
        console.error('[ElderWatch] Error auto-binding:', e);
      }
    };

    const existing = localStorage.getItem('elderwatch_device_binding');
    const urlParams = new URLSearchParams(window.location.search);
    const hasPairCode = !!urlParams.get('pair');
    if (!existing || JSON.parse(existing).residentId !== permanentResidentId || hasPairCode) {
      // Always run when there's a ?pair= code, even if already bound,
      // to make sure the new device gets linked properly.
      autoBind();
    } else {
      // Already bound, check language
      const savedLang = localStorage.getItem('ew_lang');
      if (!savedLang) setView('lang_select');
    }
  }, [permanentResidentId]);

  // Cutoff check - 9:00 AM SAST
  useEffect(() => {
    const check = () => {
      const now = new Date();
      // Convert to SAST (UTC+2)
      const sastHour = (now.getUTCHours() + 2) % 24;
      const sastMin = now.getUTCMinutes();
      setIsLate(sastHour > 9 || (sastHour === 9 && sastMin >= 0));
    };
    check();
    const i = setInterval(check, 30000);
    return () => clearInterval(i);
  }, []);

  const handleLangSelect = (newLang: LangCode) => {
    setLang(newLang);
    langChosenRef.current = true;
    localStorage.setItem('ew_lang', newLang);

    // Persist language preference to Firestore if a device binding exists
    const saveLanguageToFirestore = async () => {
      try {
        const { db } = await import('../lib/firebase');
        const { doc, setDoc } = await import('firebase/firestore');
        const bindingRaw = localStorage.getItem('elderwatch_device_binding');
        if (!bindingRaw) return;
        const binding: DeviceBinding = JSON.parse(bindingRaw);
        await setDoc(doc(db, 'residents', binding.residentId), { language: newLang }, { merge: true });
      } catch (e) {
        console.error('[ElderWatch] Failed to save language preference:', e);
      }
    };

    saveLanguageToFirestore();

    if (deviceBinding) {
      setView('linked');
      setTimeout(() => setView('morning'), 2000);
    } else {
      setView('morning');
    }
  };

  const handleOkClick = async () => {
    if (submitting) return;
    const now = new Date();
    setCheckInTime(now);
    playTone(true);
    buzz(60);
    triggerFlash('ok');
    setView('ok');

    const resId = deviceBinding?.residentId || 'demo';
    const hId = deviceBinding?.homeId || 'demo';

    console.log('[ElderWatch] handleOkClick - deviceBinding:', JSON.stringify(deviceBinding));
    console.log('[ElderWatch] handleOkClick - resId:', resId, 'hId:', hId);

    try {
      setSubmitting(true);
      const sastNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const todayStr = sastNow.toISOString().split('T')[0];
      localStorage.setItem(`elderwatch_checkin_${resId}_${todayStr}`, JSON.stringify({ status: 'ok', timestamp: now.toISOString() }));

      // Direct Firestore write - bypass any abstraction
      const { db } = await import('../lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');

      // SAST date
      const sastNow2 = new Date(now.getTime() + (2 * 60 * 60 * 1000));
      const today = sastNow2.toISOString().split('T')[0];
      const docId = `${hId}_${resId}_${today}`;

      console.log('[ElderWatch] Writing to Firestore doc:', docId);

      await setDoc(doc(db, 'checkins', docId), {
        id: docId,
        homeId: hId,
        residentId: resId,
        date: today,
        status: 'ok',
        timestamp: now.toISOString(),
        updatedBy: 'resident',
      }, { merge: true });

      console.log('[ElderWatch] Firestore write COMPLETE for doc:', docId);
    } catch (err) {
      console.error('[ElderWatch] FAILED:', err);
    } finally { setSubmitting(false); }
  };

  const handleHelpClick = async () => {
    if (submitting) return;
    const now = new Date();
    setHelpTime(now);
    playTone(false);
    buzz([120, 60, 120]);
    triggerFlash('help');
    setView('help');

    const resId = deviceBinding?.residentId || 'demo';
    const hId = deviceBinding?.homeId || 'demo';

    console.log('[ElderWatch] handleHelpClick - resId:', resId, 'hId:', hId);

    try {
      setSubmitting(true);
      const sastNowHelp = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const todayStrHelp = sastNowHelp.toISOString().split('T')[0];
      localStorage.setItem(`elderwatch_checkin_${resId}_${todayStrHelp}`, JSON.stringify({ status: 'not_ok', timestamp: now.toISOString() }));

      // Direct Firestore write
      const { db } = await import('../lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');

      const sastNowHelp2 = new Date(now.getTime() + (2 * 60 * 60 * 1000));
      const today = sastNowHelp2.toISOString().split('T')[0];
      const docId = `${hId}_${resId}_${today}`;

      await setDoc(doc(db, 'checkins', docId), {
        id: docId,
        homeId: hId,
        residentId: resId,
        date: today,
        status: 'not_ok',
        timestamp: now.toISOString(),
        updatedBy: 'resident',
      }, { merge: true });

      console.log('[ElderWatch] Help check-in SAVED:', docId);
    } catch (err) {
      console.error('[ElderWatch] FAILED:', err);
    } finally { setSubmitting(false); }
  };

  const handleImFine = async () => {
    if (submitting) return;
    const now = new Date();
    setCheckInTime(now);
    playTone(true);
    buzz(60);
    triggerFlash('ok');
    setView('ok');

    const resId = deviceBinding?.residentId || 'demo';
    const hId = deviceBinding?.homeId || 'demo';

    try {
      setSubmitting(true);
      const sastNowFine = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const todayStrFine = sastNowFine.toISOString().split('T')[0];
      localStorage.setItem(`elderwatch_checkin_${resId}_${todayStrFine}`, JSON.stringify({ status: 'ok', timestamp: now.toISOString() }));

      // Direct Firestore write - update to OK status
      const { db } = await import('../lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');

      // SAST date
      const sastNowFine2 = new Date(now.getTime() + (2 * 60 * 60 * 1000));
      const today = sastNowFine2.toISOString().split('T')[0];
      const docId = `${hId}_${resId}_${today}`;

      await setDoc(doc(db, 'checkins', docId), {
        id: docId,
        homeId: hId,
        residentId: resId,
        date: today,
        status: 'ok',
        timestamp: now.toISOString(),
        updatedBy: 'resident',
      }, { merge: true });

      console.log('[ElderWatch] "I\'m Fine" - updated to OK:', docId);
    } catch (err) {
      console.error('[ElderWatch] FAILED:', err);
    } finally { setSubmitting(false); }
  };

  const t = T[lang];
  const now = new Date();
  let dateText = '';
  try {
    const wd = new Intl.DateTimeFormat(t.locale, { weekday: 'long' }).format(now);
    const mo = new Intl.DateTimeFormat(t.locale, { month: 'long' }).format(now);
    dateText = `${wd} ${now.getDate()} ${mo}`;
  } catch { dateText = now.toDateString(); }

  // Show nothing while verifying binding against the server
  if (loading) return null;

  // Device unpaired screen — persists until user clears app cache
  if (view === 'unpaired') {
    return (
      <div style={{
        width: '100vw', height: '100dvh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px', fontFamily: '"Atkinson Hyperlegible", sans-serif',
        background: '#1A221E', color: '#F7FAFC'
      }}>
        <div style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '24px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <img src="/elderwatch-logo.svg" alt="ElderWatch" style={{ width: '48px', height: '48px' }} />
            <span style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>ElderWatch</span>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>This Phone Needs Re-Pairing</h1>
            <p style={{ margin: '16px 0 0', fontSize: '16px', opacity: 0.7 }}>
              Your pairing code has been changed by staff.
            </p>
          </div>
          <div style={{
            padding: '20px', borderRadius: '16px',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            textAlign: 'left', fontSize: '15px', lineHeight: 1.6
          }}>
            <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: '16px' }}>To re-pair this phone:</p>
            <ol style={{ margin: 0, paddingLeft: '20px' }}>
              <li style={{ marginBottom: '8px' }}>Close this app</li>
              <li style={{ marginBottom: '8px' }}>Go to <strong>Settings → Apps → ElderWatch → Storage → Clear Cache</strong></li>
              <li style={{ marginBottom: '8px' }}>Open ElderWatch again</li>
              <li>Enter the new pairing code from staff</li>
            </ol>
          </div>
          <p style={{ fontSize: '13px', opacity: 0.4, margin: 0 }}>
            This screen will appear until the app cache is cleared.
          </p>
          <div style={{
            padding: '16px', borderRadius: '16px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            fontSize: '13px', opacity: 0.6
          }}>
            ElderWatch
            <br />
            <span style={{ fontSize: '10.5px', opacity: 0.85 }}>{LEGAL_LINE_1}</span>
          </div>
        </div>
      </div>
    );
  }

  // Language selection screen
  if (view === 'lang_select') {
    return (
      <div style={{ 
        width: '100vw', height: '100dvh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px', fontFamily: '"Atkinson Hyperlegible", sans-serif',
        background: '#1A221E', color: '#F7FAFC'
      }}>
        <div style={{ width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '32px', textAlign: 'center' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <img src="/elderwatch-logo.svg" alt="ElderWatch" style={{ width: '48px', height: '48px' }} />
            <span style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>ElderWatch</span>
          </div>
          
          <div>
            <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700 }}>{t.linkedTitle(residentProfile.name)}</h1>
            <p style={{ margin: '12px 0 0', fontSize: '18px', opacity: 0.7 }}>{t.linkedBody}</p>
            <p style={{ margin: '24px 0 0', fontSize: '20px', fontWeight: 600 }}>{t.langTitle}</p>
            <p style={{ margin: '4px 0 0', fontSize: '16px', opacity: 0.6 }}>{t.langSub}</p>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button onClick={() => handleLangSelect('en')} style={{ 
              width: '100%', padding: '20px', borderRadius: '16px',
              background: '#157A4C', color: 'white', border: 'none',
              fontSize: '22px', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(21,122,76,0.4)'
            }}>
              English
            </button>
            <button onClick={() => handleLangSelect('af')} style={{ 
              width: '100%', padding: '20px', borderRadius: '16px',
              background: 'transparent', color: 'white', border: '2px solid rgba(255,255,255,0.3)',
              fontSize: '22px', fontWeight: 700, cursor: 'pointer'
            }}>
              Afrikaans
            </button>
          </div>

          <p style={{ margin: 0, fontSize: '10.5px', opacity: 0.5, lineHeight: 1.5 }}>{LEGAL_LINE_1}</p>
        </div>
      </div>
    );
  }

  // Main check-in screen
  return (
    <div style={{ 
      width: '100vw', height: '100dvh',
      display: 'flex', flexDirection: 'column',
      fontFamily: '"Atkinson Hyperlegible", sans-serif',
      background: '#1A221E', color: '#F7FAFC',
      overflow: 'hidden', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9999
    }}>
      {/* Top bar - minimal */}
      <div style={{ 
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', flexShrink: 0
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src="/elderwatch-logo.svg" alt="ElderWatch" style={{ width: '32px', height: '32px' }} />
          <span style={{ fontSize: '16px', fontWeight: 700 }}>ElderWatch</span>
        </div>
        
        {/* Reminder bell + language toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={reminderState === 'on' ? handleDisableReminders : (reminderCanBeEnabled ? handleEnableReminders : undefined)}
            aria-label={`Daily reminders ${reminderState === 'on' ? 'on' : 'off'}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              border: 0, borderRadius: '8px', padding: '6px 10px',
              background: reminderState === 'on' ? '#157A4C' : 'rgba(255,255,255,0.1)',
              color: reminderState === 'on' ? 'white' : 'rgba(255,255,255,0.7)',
              fontSize: '13px', fontWeight: 700,
              cursor: (reminderState === 'on' || reminderCanBeEnabled) ? 'pointer' : 'default',
              opacity: reminderBusy ? 0.6 : 1
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px' }}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span>{reminderState === 'on' ? REMINDER_TIME_SAST : 'OFF'}</span>
          </button>
          <div style={{ display: 'inline-flex', borderRadius: '8px', padding: '2px', background: 'rgba(255,255,255,0.1)' }}>
          <button onClick={() => { setLang('en'); localStorage.setItem('ew_lang', 'en'); }} style={{ 
            border: 0, borderRadius: '6px', padding: '6px 12px',
            background: lang === 'en' ? '#157A4C' : 'transparent',
            color: lang === 'en' ? 'white' : 'rgba(255,255,255,0.6)',
            fontSize: '14px', fontWeight: 700, cursor: 'pointer'
          }}>EN</button>
          <button onClick={() => { setLang('af'); localStorage.setItem('ew_lang', 'af'); }} style={{ 
            border: 0, borderRadius: '6px', padding: '6px 12px',
            background: lang === 'af' ? '#157A4C' : 'transparent',
            color: lang === 'af' ? 'white' : 'rgba(255,255,255,0.6)',
            fontSize: '14px', fontWeight: 700, cursor: 'pointer'
          }}>AF</button>
          </div>
        </div>
      </div>

      {/* Main content - takes all available space */}
      <div style={{ 
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: '0 20px 20px', overflow: 'hidden'
      }}>
        {/* Linked view */}
        {view === 'linked' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '24px', textAlign: 'center' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#157A4C', display: 'grid', placeItems: 'center' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '48px', height: '48px' }}>
                <rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M9 18h6" /><path d="M9.5 10.5l2 2 3.5-4" />
              </svg>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 700 }}>{t.linkedTitle(residentProfile.name)}</h1>
              <p style={{ margin: '12px 0 0', fontSize: '18px', opacity: 0.7 }}>{t.linkedBody}</p>
            </div>
            <button onClick={() => setView('morning')} style={{ 
              width: '100%', maxWidth: '280px', padding: '20px', borderRadius: '16px',
              background: '#157A4C', color: 'white', border: 'none',
              fontSize: '20px', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(21,122,76,0.4)'
            }}>{t.go}</button>
          </div>
        )}

        {/* Main screens */}
        {view !== 'linked' && view !== 'lang_select' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* Greeting - compact */}
            <div style={{ marginBottom: '16px' }}>
              <h1 style={{ 
                margin: 0, fontSize: '28px', lineHeight: 1.1, fontWeight: 700 
              }}>
                {t.hello(now.getHours())} {residentProfile.name}
              </h1>
            </div>

            {/* Late warning */}
            {isLate && view === 'morning' && (
              <div style={{ 
                padding: '12px 16px', borderRadius: '12px',
                background: 'rgba(236,201,75,0.2)', border: '2px solid #ECC94B',
                fontSize: '14px', marginBottom: '12px', color: '#ECC94B'
              }}>
                {t.late}
              </div>
            )}

            {/* Reminder status — disappears once reminders are switched on */}
            {reminderHint && view !== 'linked' && (
              <button
                onClick={reminderCanBeEnabled ? handleEnableReminders : undefined}
                disabled={!reminderCanBeEnabled || reminderBusy}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left',
                  padding: '10px 14px', borderRadius: '12px',
                  background: reminderCanBeEnabled ? 'rgba(236,201,75,0.2)' : 'rgba(255,255,255,0.06)',
                  border: reminderCanBeEnabled ? '2px solid #ECC94B' : '1px solid rgba(255,255,255,0.15)',
                  color: reminderCanBeEnabled ? '#ECC94B' : 'rgba(255,255,255,0.6)',
                  fontSize: '14px', fontWeight: 600,
                  cursor: reminderCanBeEnabled ? 'pointer' : 'default',
                  marginBottom: '12px', flexShrink: 0,
                  opacity: reminderBusy ? 0.6 : 1
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px', flexShrink: 0 }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span>{reminderBusy ? 'Turning on…' : reminderHint}</span>
              </button>
            )}

            {/* Buttons - take up most of the screen */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
              {view === 'morning' && (
                <>
                  <button onClick={handleOkClick} style={{ 
                    flex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    border: 0, borderRadius: '20px', cursor: 'pointer',
                    background: '#157A4C', color: 'white',
                    boxShadow: '0 4px 20px rgba(21,122,76,0.4)',
                    minHeight: '120px'
                  }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: '56px', height: '56px' }}>
                      <circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-7" />
                    </svg>
                    <span style={{ fontSize: '36px', fontWeight: 700 }}>{t.okLabel}</span>
                    <span style={{ fontSize: '16px', opacity: 0.9 }}>{t.okSub}</span>
                  </button>
                  <button onClick={handleHelpClick} style={{ 
                    flex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    border: 0, borderRadius: '20px', cursor: 'pointer',
                    background: '#C53030', color: 'white',
                    boxShadow: '0 4px 20px rgba(197,48,48,0.4)',
                    minHeight: '100px'
                  }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ width: '44px', height: '44px' }}>
                      <path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M10 10V4.5a1.5 1.5 0 0 1 3 0V10" />
                      <path d="M13 10.5V5.5a1.5 1.5 0 0 1 3 0v6" /><path d="M16 12.5V8a1.5 1.5 0 0 1 3 0v6.5A6.5 6.5 0 0 1 12.5 21H11a5 5 0 0 1-4.2-2.3L4 14.5a1.6 1.6 0 0 1 2.6-1.9L7 13.5" />
                    </svg>
                    <span style={{ fontSize: '32px', fontWeight: 700 }}>{t.helpLabel}</span>
                    <span style={{ fontSize: '14px', opacity: 0.9 }}>{t.helpSub}</span>
                  </button>
                </>
              )}

              {view === 'ok' && (
                <div style={{ 
                  flex: 1, display: 'flex', flexDirection: 'column', gap: '12px',
                  borderRadius: '20px', padding: '20px',
                  background: 'rgba(21,122,76,0.15)', border: '2px solid #157A4C'
                }}>
                  <h2 style={{ margin: 0, fontSize: '28px', lineHeight: 1.1, fontWeight: 700, color: '#157A4C' }}>{t.okTitle(residentProfile.name)}</h2>
                  <p style={{ margin: 0, fontSize: '18px', opacity: 0.9 }}>{t.okBody}</p>
                  <p style={{ margin: 0, fontSize: '16px', opacity: 0.7 }}>{t.okTime(formatHHMM(checkInTime || now))}</p>
                </div>
              )}

              {view === 'ok' && (
                <button onClick={handleHelpClick} style={{ 
                  flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  border: 0, borderRadius: '20px', cursor: 'pointer',
                  background: '#C53030', color: 'white',
                  boxShadow: '0 4px 20px rgba(197,48,48,0.4)',
                  padding: '20px', minHeight: '80px'
                }}>
                  <span style={{ fontSize: '24px', fontWeight: 700 }}>{t.helpLabel}</span>
                </button>
              )}

              {view === 'help' && (
                <div style={{ 
                  flex: 1, display: 'flex', flexDirection: 'column', gap: '12px',
                  borderRadius: '20px', padding: '20px',
                  background: 'rgba(197,48,48,0.15)', border: '2px solid #C53030'
                }}>
                  <h2 style={{ margin: 0, fontSize: '28px', lineHeight: 1.1, fontWeight: 700, color: '#C53030' }}>{t.helpTitle}</h2>
                  <p style={{ margin: 0, fontSize: '18px', opacity: 0.9 }}>{t.helpBody()}</p>
                  <p style={{ margin: 0, fontSize: '16px', opacity: 0.7 }}>{t.helpTime(formatHHMM(helpTime || now))}</p>
                  <button onClick={handleImFine} disabled={submitting} style={{ 
                    marginTop: 'auto', alignSelf: 'flex-start',
                    background: '#157A4C', border: 'none',
                    borderRadius: '999px', padding: '12px 24px',
                    fontSize: '18px', fontWeight: 700, cursor: 'pointer', color: 'white',
                    boxShadow: '0 4px 20px rgba(21,122,76,0.4)',
                    opacity: submitting ? 0.6 : 1
                  }}>{submitting ? 'Updating...' : t.cancel}</button>
                </div>
              )}
            </div>

            {/* Call Sister - only if phone number exists */}
            {residentProfile.phone && (
              <a href={`tel:${residentProfile.phone}`} style={{ 
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '14px 16px', borderRadius: '16px',
                border: '2px solid rgba(255,255,255,0.2)',
                background: view === 'help' ? 'rgba(197,48,48,0.2)' : 'transparent',
                color: 'white', textDecoration: 'none',
                fontSize: '18px', fontWeight: 700,
                marginTop: '12px', flexShrink: 0
              }}>
                <span style={{ 
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: '#157A4C', display: 'grid', placeItems: 'center',
                  fontSize: '14px', fontWeight: 700, flexShrink: 0
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px' }}>
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </span>
                <span style={{ flex: 1 }}>
                  <span>{t.call()}</span>
                  <small style={{ display: 'block', fontSize: '14px', opacity: 0.7, fontWeight: 400 }}>{t.callSub}</small>
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '24px', height: '24px', flexShrink: 0 }}>
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </a>
            )}
          </div>
        )}
      </div>

      {/* Flash overlay */}
      {flashKind && (
        <div style={{ 
          position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
          pointerEvents: 'none', zIndex: 99999,
          background: flashKind === 'ok' ? '#157A4C' : '#C53030',
          color: '#FFF'
        }}>
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" style={{ width: '190px', height: '190px' }}>
            <path d={flashKind === 'ok' ? 'M10 25l10 10 18-22' : 'M24 10v18M24 36v2'} />
          </svg>
        </div>
      )}
    </div>
  );
};
