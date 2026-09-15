import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Users,
  Activity,
  Settings,
  AlertTriangle,
  CheckCircle,
  Clock,
  HelpCircle,
  Search,
  Plus,
  Trash2,
  Edit2,
  Volume2,
  VolumeX,
  RefreshCw,
  LogOut,
  Smartphone,
  ExternalLink,
  Shield,
  Bell,
  Play,
  FileText,
  Info,
  Check,
  Building,
  Upload,
  Menu,
  X,
  Download,
  CalendarOff,
  Calendar,
  Key,
} from 'lucide-react';
import { ResidentTodayView, Home, StaffUser, JobExecutionLog, PushNotificationRecord } from '../types';
import { playEmergencyAlertSound } from '../utils/audioAlert';
import { AddEditResidentModal } from './AddEditResidentModal';
import { ResidentDetailModal } from './ResidentDetailModal';
import { DeviceLinkQRModal } from './DeviceLinkQRModal';
import { LegalFooter } from './LegalFooter';
import { MarkAwayModal } from './MarkAwayModal';

import { PWAInstallButton } from './PWAInstallButton';
import { AdminOverviewView } from './AdminOverviewView';
import { ThemeToggle, useAppTheme } from './ThemeToggle';
import {
  subscribeToTodayCheckins,
  validateFirestoreConnection,
  firebaseConfig,
} from '../lib/firebase';
import { fetchResidents as fetchFirebaseResidents, fetchAllHomes as fetchFirebaseAllHomes, updateHomeSettings, fetchCheckinsForHomeInRange } from '../lib/firebase-api';

interface AdminPanelProps {
  token: string;
  user: StaffUser;
  initialHome: Home;
  onLogout: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  token,
  user,
  initialHome,
  onLogout,
  onSimulateDeviceBind,
}) => {
  const [isNight] = useAppTheme();
  const [activeTab, setActiveTab] = useState<'overview' | 'dashboard' | 'residents' | 'settings' | 'reports'>(
    user.role === 'admin' ? 'overview' : 'dashboard'
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [home, setHome] = useState<Home>(initialHome);
  const [residents, setResidents] = useState<ResidentTodayView[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_ok' | 'awaiting' | 'no_response' | 'ok' | 'away'>('all');

  // Modals
  const [selectedResidentForDetail, setSelectedResidentForDetail] = useState<ResidentTodayView | null>(null);
  const [selectedResidentForQR, setSelectedResidentForQR] = useState<ResidentTodayView | null>(null);
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [editingResident, setEditingResident] = useState<ResidentTodayView | null>(null);
  const [selectedResidentForAway, setSelectedResidentForAway] = useState<ResidentTodayView | null>(null);
  const [awaySectionOpen, setAwaySectionOpen] = useState(false);


  // Settings state
  const [homeNameInput, setHomeNameInput] = useState(initialHome.name);
  const [cutoffTimeInput, setCutoffTimeInput] = useState(initialHome.cutoffTime);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccessMsg, setSettingsSuccessMsg] = useState('');

  // Reports state
  const [reportPeriod, setReportPeriod] = useState<'weekly' | 'monthly'>('monthly');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportRows, setReportRows] = useState<any[] | null>(null);
  const [reportRange, setReportRange] = useState<{ start: string; end: string } | null>(null);
  // Daily report (today only)
  const [dailyReportBusy, setDailyReportBusy] = useState(false);
  const [dailyReportMsg, setDailyReportMsg] = useState<string | null>(null);

  // Audio and Realtime State
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [urgentAlertBanner, setUrgentAlertBanner] = useState<{
    text: string;
    room: string;
    residentName: string;
    time: string;
  } | null>(null);

  // Job and Push Logs
  const [jobLogs, setJobLogs] = useState<JobExecutionLog[]>([]);
  const [pushLogs, setPushLogs] = useState<PushNotificationRecord[]>([]);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [jobFeedbackMsg, setJobFeedbackMsg] = useState('');

  // Multi-tenant testing: list of all homes
  const [allHomes, setAllHomes] = useState<Home[]>([]);
  const [firestoreConnected, setFirestoreConnected] = useState<boolean | null>(null);

  // Fetch all residents and data (using Firebase direct)
  const fetchResidents = useCallback(async () => {
    try {
      const data = await fetchFirebaseResidents(home.id);
      setResidents(data || []);
    } catch (err) {
      console.error('Failed to fetch residents:', err);
    } finally {
      setLoading(false);
    }
  }, [home.id]);

  const fetchLogs = useCallback(async () => {
    // Logs are read from Firestore directly via subscribeToTodayCheckins
    // No REST API needed - the realtime listener handles updates
  }, []);

  const fetchAllHomes = useCallback(async () => {
    try {
      const homes = await fetchFirebaseAllHomes();
      setAllHomes(homes || []);
    } catch (err) {
      console.error('Failed to fetch homes list:', err);
    }
  }, []);

  useEffect(() => {
    fetchResidents();
    fetchLogs();
    fetchAllHomes();
  }, [fetchResidents, fetchLogs, fetchAllHomes]);

  // Firestore Real-Time Listener (Direct Firebase Sync for frailcare-checkin)
  useEffect(() => {
    validateFirestoreConnection().then((res) => {
      setFirestoreConnected(res.connected);
      setRealtimeConnected(res.connected);
    });

    const todayStr = new Date().toISOString().split('T')[0];
    const unsubscribe = subscribeToTodayCheckins(home.id, todayStr, () => {
      fetchResidents();
      fetchLogs();
    });

    return () => {
      unsubscribe();
    };
  }, [home.id, fetchResidents, fetchLogs]);

  // Statistics Calculation
  const stats = useMemo(() => {
    const activeResidents = residents.filter((r) => !r.isAway);
    const awayResidents = residents.filter((r) => r.isAway);
    const total = activeResidents.length;
    const ok = activeResidents.filter((r) => r.todayStatus === 'ok').length;
    const notOk = activeResidents.filter((r) => r.todayStatus === 'not_ok').length;
    const noResponse = activeResidents.filter((r) => r.todayStatus === 'no_response').length;
    const awaiting = activeResidents.filter((r) => r.todayStatus === 'awaiting').length;
    const linked = residents.filter((r) => r.isDeviceLinked).length;
    const away = awayResidents.length;

    return { total, ok, notOk, noResponse, awaiting, linked, away, urgentTotal: notOk + noResponse, activeTotal: activeResidents.length };
  }, [residents]);

  // Alert sound when a resident presses Help (not_ok status appears)
  const prevNotOkRef = useRef(stats.notOk);
  useEffect(() => {
    // If notOk count increased, a new help alert came in
    if (stats.notOk > prevNotOkRef.current && soundEnabled) {
      console.log('[ElderWatch] New help alert detected - playing sound');
      playEmergencyAlertSound();
      // Also vibrate if available
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }
    }
    prevNotOkRef.current = stats.notOk;
  }, [stats.notOk, soundEnabled]);

  // SORT WORST-FIRST RULE:
  // 1. Red (not_ok) at TOP
  // 2. Grey (no_response & awaiting) in MIDDLE
  // 3. Green (ok) at BOTTOM
  const sortedAndFilteredResidents = useMemo(() => {
    const priorityWeight: Record<string, number> = {
      not_ok: 1,       // Highest priority: top
      no_response: 2,  // Missed cutoff: high attention
      awaiting: 3,     // Still pending
      ok: 4,           // Checked in safe: bottom
    };

    return residents
      .filter((r) => {
        if (statusFilter === 'away') return !!r.isAway;
        if (r.isAway) return false;
        if (statusFilter !== 'all' && r.todayStatus !== statusFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            r.name.toLowerCase().includes(q) ||
            r.roomNumber.toLowerCase().includes(q) ||
            (r.phone && r.phone.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => {
        const weightA = priorityWeight[a.todayStatus] || 5;
        const weightB = priorityWeight[b.todayStatus] || 5;
        if (weightA !== weightB) {
          return weightA - weightB;
        }
        // Secondary sort: Room number ascending
        return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
      });
  }, [residents, statusFilter, searchQuery]);

  // Handlers
  const handleSaveResident = async (data: Partial<ResidentTodayView>) => {
    const url = editingResident ? `/api/residents/${editingResident.id}` : '/api/residents';
    const method = editingResident ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to save resident');
    }

    await fetchResidents();
  };

  const handleDeleteResident = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove resident ${name}?`)) return;

    const res = await fetch(`/api/residents/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      fetchResidents();
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSuccessMsg('');

    try {
      const updated = await updateHomeSettings(home.id, homeNameInput, cutoffTimeInput);
      if (updated) {
        setHome(updated);
        setSettingsSuccessMsg('Facility settings updated successfully!');
        setTimeout(() => setSettingsSuccessMsg(''), 4000);
      }
    } catch (err) {
      console.error('Failed to update settings:', err);
    } finally {
      setSavingSettings(false);
    }
  };

  const getDateRangeForPeriod = (period: 'weekly' | 'monthly') => {
    const now = new Date();
    const sastNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const end = sastNow.toISOString().split('T')[0];

    const startDate = new Date(sastNow);
    if (period === 'weekly') {
      startDate.setDate(sastNow.getDate() - 7);
    } else {
      startDate.setDate(sastNow.getDate() - 30);
    }
    const start = startDate.toISOString().split('T')[0];
    return { start, end };
  };

  const handleGenerateReport = async () => {
    setReportLoading(true);
    setReportError(null);
    setReportRows(null);
    setReportRange(null);

    try {
      const { start, end } = getDateRangeForPeriod(reportPeriod);
      const rows = await fetchCheckinsForHomeInRange(home.id, start, end);

      if (!rows.length) {
        setReportError('No check-ins found for this period.');
        setReportLoading(false);
        return;
      }

      const residents = await fetchFirebaseResidents(home.id);
      const residentMap = new Map(residents.map((r: any) => [r.id, r]));

      const enriched = rows.map((r: any) => {
        const resident = residentMap.get(r.residentId);
        const roomNumber = resident?.roomNumber || r.roomNumber || '';
        const unitNumber = resident?.unitNumber || r.unitNumber || '';
        const roomDisplay = unitNumber ? `${roomNumber} / ${unitNumber}` : roomNumber;
        return {
          ...r,
          residentName: resident?.name || r.residentId,
          roomNumber: roomDisplay,
        };
      });

      setReportRows(enriched);
      setReportRange({ start, end });
    } catch (err) {
      console.error('Report generation failed:', err);
      setReportError('Failed to generate report. Please try again.');
    } finally {
      setReportLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!reportRows || !reportRange) return;

    const { start, end } = reportRange;
    const periodLabel = reportPeriod === 'weekly' ? '7 Day' : '30 Day';

    try {
      // Same renderer as the daily report, so both exports look identical:
      // emerald header, home name, period heading, summary, coloured Yes/No
      // verdict cells, page numbers and legend.
      const { buildPeriodReportPdf, periodReportFileName } = await import('../lib/checkInReport');
      const doc = await buildPeriodReportPdf({
        homeName: home.name,
        startDate: start,
        endDate: end,
        periodLabel,
        records: reportRows.map((r: any) => ({
          residentName: r.residentName || r.residentId || '',
          roomNumber: r.roomNumber || '',
          unitNumber: r.unitNumber || '',
          date: r.date || '',
          status: r.status || '',
          timestamp: r.timestamp || '',
        })),
      });

      doc.save(periodReportFileName(home.name, periodLabel, start, end));
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Failed to generate PDF. Please try again.');
    }
  };

  // Daily report: today only, one row per resident, Yes/No with coloured cells.
  // Reads the residents already held in state, so it needs no extra fetch.
  const handleGenerateDailyReport = async () => {
    if (dailyReportBusy) return;
    setDailyReportBusy(true);
    setDailyReportMsg(null);

    try {
      const sastNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const today = sastNow.toISOString().split('T')[0];

      const { buildDailyReportPdf, dailyReportFileName } = await import('../lib/checkInReport');
      const doc = await buildDailyReportPdf({
        homeName: home.name,
        date: today,
        residents: residents.map((r) => ({
          name: r.name,
          roomNumber: r.roomNumber,
          unitNumber: r.unitNumber,
          todayStatus: r.todayStatus,
          isAway: r.isAway,
        })),
      });

      doc.save(dailyReportFileName(home.name, today));

      const yes = residents.filter((r) => r.todayStatus === 'ok').length;
      setDailyReportMsg(
        `Daily report for ${today} downloaded — ${yes} checked in, ${residents.length - yes} not, out of ${residents.length} residents.`
      );
    } catch (err) {
      console.error('Daily report generation failed:', err);
      setDailyReportMsg('Could not generate the daily report. Please try again.');
    } finally {
      setDailyReportBusy(false);
    }
  };

  // Trigger morning reset - resets all residents to 'awaiting'
  const handleMorningReset = async () => {
    setRunningJob('Morning Reset');
    setJobFeedbackMsg('');

    try {
      const { db } = await import('../lib/firebase');
      const { collection, query, where, getDocs, writeBatch } = await import('firebase/firestore');

      // Get today's date in SAST
      const now = new Date();
      const sastDate = new Date(now.getTime() + (2 * 60 * 60 * 1000));
      const today = sastDate.toISOString().split('T')[0];

      // Get all check-ins for today for this home
      const checkinsQuery = query(
        collection(db, 'checkins'),
        where('homeId', '==', home.id),
        where('date', '==', today)
      );
      const snapshot = await getDocs(checkinsQuery);

      // Reset all to awaiting
      const batch = writeBatch(db);
      snapshot.forEach((doc) => {
        batch.update(doc.ref, { status: 'awaiting', updatedBy: 'morning_reset', timestamp: now.toISOString() });
      });

      if (snapshot.size > 0) {
        await batch.commit();
        setJobFeedbackMsg(`Morning Reset complete: ${snapshot.size} residents reset to awaiting.`);
      } else {
        setJobFeedbackMsg('Morning Reset: No check-ins found for today.');
      }

      fetchResidents();
    } catch (err) {
      console.error('Morning reset failed:', err);
      setJobFeedbackMsg('Failed to trigger Morning Reset');
    } finally {
      setRunningJob(null);
      setTimeout(() => setJobFeedbackMsg(''), 5000);
    }
  };

  // CSV Import Handler
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      alert('CSV must have a header row and at least one data row.');
      return;
    }

    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const nameIdx = header.findIndex(h => h === 'name' || h.includes('full name') || h.includes('resident name'));
    const roomIdx = header.findIndex(h => h === 'room' || h.includes('room number') || h.includes('room #'));
    const unitIdx = header.findIndex(h => h === 'unit' || h.includes('unit number') || h.includes('unit #'));
    const phoneIdx = header.findIndex(h => h === 'phone' || h.includes('phone number'));
    const ecNameIdx = header.findIndex(h => h.includes('contact name') || h.includes('family name') || h.includes('ec name'));
    const ecRelIdx = header.findIndex(h => h.includes('relation') || h.includes('relationship'));
    const ecNumIdx = header.findIndex(h => h.includes('contact number') || h.includes('contact phone') || h.includes('ec number') || h.includes('ec phone'));
    const notesIdx = header.findIndex(h => h.includes('note') || h.includes('care'));

    if (nameIdx === -1 || roomIdx === -1) {
      alert('CSV must have "Name" and "Room" columns. Download the Example CSV for the correct format.');
      return;
    }

    const residents = lines.slice(1).map(line => {
      // Parse CSV line - handle quoted fields with commas
      const cols: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          cols.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cols.push(cur.trim());
      return {
        name: cols[nameIdx] || '',
        roomNumber: cols[roomIdx] || '',
        unitNumber: unitIdx >= 0 ? cols[unitIdx] || '' : '',
        phone: phoneIdx >= 0 ? cols[phoneIdx] || '' : '',
        emergencyContactName: ecNameIdx >= 0 ? cols[ecNameIdx] || '' : '',
        emergencyContactRelation: ecRelIdx >= 0 ? cols[ecRelIdx] || '' : '',
        emergencyContactNumber: ecNumIdx >= 0 ? cols[ecNumIdx] || '' : '',
        notes: notesIdx >= 0 ? cols[notesIdx] || '' : '',
      };
    }).filter(r => r.name && r.roomNumber);

    if (residents.length === 0) {
      alert('No valid residents found in CSV.');
      return;
    }

    if (!confirm(`Import ${residents.length} residents into ${home.name}?`)) return;

    try {
      const { batchImportResidents } = await import('../lib/firebase-api');
      const results = await batchImportResidents(home.id, residents);
      alert(`Successfully imported ${results.length} residents.`);
      fetchResidents();
    } catch (err) {
      alert('Failed to import residents: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }

    e.target.value = '';
  };

  // Batch Link Code Export
  const handleBatchLinkCodes = () => {
    const origin = window.location.origin;
    // Header now exposes a single Auto-Pair URL (residents open it on the phone
    // to link + pair in one step), plus the permanent check-in URL for those
    // who are already paired. We keep the raw Link Code column for reference.
    const lines = ['Room,Name,Unit,Link Code,Auto-Pair URL,Check-in URL'];
    residents.forEach(r => {
      const autoPairUrl = r.oneTimeLinkCode
        ? `${origin}/checkin/${r.id}?pair=${encodeURIComponent(r.oneTimeLinkCode)}`
        : 'N/A';
      const checkinUrl = `${origin}/checkin/${r.id}`;
      const unit = r.unitNumber || '';
      lines.push(`"${r.roomNumber}","${r.name}","${unit}","${r.oneTimeLinkCode || 'N/A'}","${autoPairUrl}","${checkinUrl}"`);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `elderwatch-pairing-qr-${home.name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Open the QR pairing modal — the modal auto-generates a code on open
  // and exposes a "Rotate Pairing URL" action inside the modal itself.
  const handleOpenPairModal = (resident: ResidentTodayView) => {
    setSelectedResidentForQR(resident);
  };

  // Manual rotation (kept for compatibility with batch operations)
  const handleRotateLinkCode = async (residentId: string, roomNumber: string, residentName: string) => {
    if (!confirm(`Rotate pairing code for "${residentName}"? The old code will stop working immediately.`)) return;
    try {
      const { regenerateLinkCode } = await import('../lib/firebase-api');
      await regenerateLinkCode(residentId, roomNumber);
      fetchResidents();
    } catch (err) {
       alert('Failed to rotate pairing code: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors duration-200 ${
        isNight ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* URGENT ALARM BANNER (if any not_ok resident) */}
      {urgentAlertBanner && (
        <div className="bg-rose-600 text-white px-4 py-3 shadow-lg flex items-center justify-between animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center animate-bounce">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-extrabold text-sm sm:text-base tracking-tight">
                EMERGENCY ALERT: {urgentAlertBanner.residentName} (Room {urgentAlertBanner.room})
              </p>
              <p className="text-xs text-rose-100">
                Resident pressed RED "I need help" at {urgentAlertBanner.time} SAST. Please dispatch nursing staff immediately.
              </p>
            </div>
          </div>
          <button
            onClick={() => setUrgentAlertBanner(null)}
            className="text-xs bg-white text-rose-700 font-bold px-3 py-1.5 rounded-lg shadow-sm hover:bg-rose-50 transition cursor-pointer"
          >
            Acknowledge Alert
          </button>
        </div>
      )}

      {/* TOP APPLICATION BAR */}
      <header
        className={`border-b sticky top-0 z-30 shadow-xs transition-colors duration-200 ${
          isNight ? 'bg-slate-900/95 backdrop-blur-md border-slate-800' : 'bg-white border-slate-200'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Home Scope */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <img src="/elderwatch-logo.png" alt="ElderWatch" className="w-10 h-10 rounded-2xl shadow-md shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={`font-extrabold text-base sm:text-lg tracking-tight ${isNight ? 'text-white' : 'text-slate-900'}`}>
                  ElderWatch
                </h1>
                <span className="hidden sm:inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  STAFF PORTAL
                </span>
                {realtimeConnected ? (
                  <span className="hidden sm:flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                ) : (
                  <span className="hidden sm:flex items-center gap-1 text-[11px] text-slate-400">
                    <span className="w-2 h-2 rounded-full bg-slate-300" />
                    Connecting...
                  </span>
                )}
                <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-200/80">
                  <span className="hidden md:inline font-mono text-[10px]">
                    {firebaseConfig.projectId}
                  </span>
                </span>
              </div>
              {user.role === 'admin' && allHomes.length > 1 ? (
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <Building className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <select
                    value={home.id}
                    onChange={(e) => {
                      const selected = allHomes.find((h) => h.id === e.target.value);
                      if (selected) {
                        setHome(selected);
                        setHomeNameInput(selected.name);
                        setCutoffTimeInput(selected.cutoffTime);
                      }
                    }}
                    className={`text-xs font-bold py-0.5 px-2 rounded-lg border focus:outline-hidden cursor-pointer max-w-[180px] ${
                      isNight
                        ? 'bg-slate-900 border-slate-700 text-emerald-300'
                        : 'bg-white border-slate-300 text-emerald-800'
                    }`}
                  >
                    {allHomes.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.cutoffTime})
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">Cutoff: {home.cutoffTime} SAST</span>
                </div>
              ) : (
                <p className={`text-xs font-medium flex items-center gap-1 truncate ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  <Building className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">{home.name}</span>
                  <span className="text-slate-300 hidden sm:inline">•</span>
                  <span className="hidden sm:inline">Cutoff: {home.cutoffTime} SAST</span>
                </p>
              )}
            </div>
          </div>

          {/* Quick Actions & Navigation Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Dark Theme Switcher Icon */}
            <ThemeToggle />

            {/* Audio Alert Toggle */}
            <button
              onClick={() => {
                setSoundEnabled(!soundEnabled);
                if (!soundEnabled) playEmergencyAlertSound();
              }}
              title={soundEnabled ? 'Emergency siren audio enabled' : 'Emergency siren audio muted'}
              className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                soundEnabled
                  ? isNight
                    ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : isNight
                  ? 'border-slate-800 bg-slate-800 text-slate-400'
                  : 'border-slate-200 bg-slate-100 text-slate-500'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="hidden md:inline">{soundEnabled ? 'Audio On' : 'Muted'}</span>
            </button>

            {/* PWA Install Button */}
            <PWAInstallButton />

            {/* User & Logout */}
            <div className={`h-6 w-px mx-1 hidden sm:block ${isNight ? 'bg-slate-800' : 'bg-slate-200'}`} />
            <div className="hidden lg:flex flex-col text-right">
              <span className={`text-xs font-bold ${isNight ? 'text-slate-200' : 'text-slate-800'}`}>{user.name}</span>
              <span className="text-[10px] text-slate-400 capitalize">{user.role}</span>
            </div>

            <button
              onClick={onLogout}
              title="Sign Out"
              className={`p-2 rounded-xl border transition cursor-pointer ${
                isNight
                  ? 'border-slate-800 hover:bg-rose-950/60 hover:border-rose-800 text-slate-400 hover:text-rose-400'
                  : 'border-slate-200 hover:bg-rose-50 hover:border-rose-200 text-slate-500 hover:text-rose-600'
              }`}
            >
              <LogOut className="w-4 h-4" />
            </button>

            {/* Hamburger Menu - Mobile only */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              title="Menu"
              className={`md:hidden p-2 rounded-xl border transition cursor-pointer ${
                isNight
                  ? 'border-slate-800 hover:bg-slate-800 text-slate-300'
                  : 'border-slate-200 hover:bg-slate-100 text-slate-600'
              }`}
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* PRIMARY TAB NAVIGATION - Desktop horizontal tabs */}
        <div
          className={`hidden md:flex max-w-7xl mx-auto px-4 sm:px-6 items-center gap-1 border-t overflow-x-auto ${
            isNight ? 'border-slate-800' : 'border-slate-100'
          }`}
        >
          {/* Admin-Only Enterprise Overview Tab */}
          {user.role === 'admin' && (
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-3 text-xs font-bold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
                activeTab === 'overview'
                  ? 'border-purple-500 text-purple-400 font-extrabold'
                  : isNight
                  ? 'border-transparent text-slate-400 hover:text-slate-200'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Shield className="w-4 h-4 text-purple-400" />
              <span>All Homes & Staff Overview</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-3 text-xs font-bold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'dashboard'
                ? isNight
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-emerald-600 text-emerald-700'
                : isNight
                ? 'border-transparent text-slate-400 hover:text-slate-200'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Live Status Dashboard</span>
            {stats.notOk > 0 && (
              <span className="bg-rose-600 text-white font-bold text-[10px] px-1.5 py-0.2 rounded-full animate-pulse">
                {stats.notOk}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('residents')}
            className={`px-4 py-3 text-xs font-bold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'residents'
                ? isNight
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-emerald-600 text-emerald-700'
                : isNight
                ? 'border-transparent text-slate-400 hover:text-slate-200'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Resident Management</span>
            <span
              className={`text-[10px] px-2 py-0.2 rounded-full font-mono ${
                isNight ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {stats.total}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-3 text-xs font-bold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'settings'
                ? isNight
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-emerald-600 text-emerald-700'
                : isNight
                ? 'border-transparent text-slate-400 hover:text-slate-200'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Home Settings & Daily Cycle</span>
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-3 text-xs font-bold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'reports'
                ? isNight
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-emerald-600 text-emerald-700'
                : isNight
                ? 'border-transparent text-slate-400 hover:text-slate-200'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Reports & Exports</span>
          </button>
        </div>

        {/* PRIMARY TAB NAVIGATION - Mobile current tab indicator + dropdown */}
        <div
          className={`md:hidden max-w-7xl mx-auto px-4 border-t ${
            isNight ? 'border-slate-800' : 'border-slate-100'
          }`}
        >
          <div
            className={`flex items-center justify-between py-3 ${
              isNight ? 'text-white' : 'text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {activeTab === 'overview' && <Shield className="w-4 h-4 text-purple-400" />}
              {activeTab === 'dashboard' && <Activity className="w-4 h-4 text-emerald-500" />}
              {activeTab === 'residents' && <Users className="w-4 h-4 text-emerald-500" />}
              {activeTab === 'settings' && <Settings className="w-4 h-4 text-emerald-500" />}
              {activeTab === 'reports' && <FileText className="w-4 h-4 text-emerald-500" />}
              <span className="text-sm font-bold">
                {activeTab === 'overview' && 'All Homes & Staff Overview'}
                {activeTab === 'dashboard' && 'Live Status Dashboard'}
                {activeTab === 'residents' && 'Resident Management'}
                {activeTab === 'settings' && 'Home Settings & Daily Cycle'}
                {activeTab === 'reports' && 'Reports & Exports'}
              </span>
              {activeTab === 'dashboard' && stats.notOk > 0 && (
                <span className="bg-rose-600 text-white font-bold text-[10px] px-1.5 py-0.2 rounded-full animate-pulse">
                  {stats.notOk}
                </span>
              )}
              {activeTab === 'residents' && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  isNight ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'
                }`}>
                  {stats.total}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div
          className={`md:hidden border-b shadow-lg sticky top-[64px] z-20 ${
            isNight ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="max-w-7xl mx-auto px-4 py-2 space-y-1">
            {user.role === 'admin' && (
              <button
                onClick={() => { setActiveTab('overview'); setMobileMenuOpen(false); }}
                className={`w-full px-4 py-3 text-sm font-bold rounded-xl flex items-center gap-3 transition cursor-pointer ${
                  activeTab === 'overview'
                    ? isNight
                      ? 'bg-purple-950/60 text-purple-300'
                      : 'bg-purple-50 text-purple-700'
                    : isNight
                    ? 'text-slate-300 hover:bg-slate-800'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Shield className="w-4 h-4 text-purple-400" />
                <span>All Homes & Staff Overview</span>
              </button>
            )}

            <button
              onClick={() => { setActiveTab('dashboard'); setMobileMenuOpen(false); }}
              className={`w-full px-4 py-3 text-sm font-bold rounded-xl flex items-center justify-between transition cursor-pointer ${
                activeTab === 'dashboard'
                  ? isNight
                    ? 'bg-emerald-950/60 text-emerald-300'
                    : 'bg-emerald-50 text-emerald-700'
                  : isNight
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <Activity className="w-4 h-4 text-emerald-500" />
                <span>Live Status Dashboard</span>
              </div>
              {stats.notOk > 0 && (
                <span className="bg-rose-600 text-white font-bold text-[10px] px-1.5 py-0.2 rounded-full animate-pulse">
                  {stats.notOk}
                </span>
              )}
            </button>

            <button
              onClick={() => { setActiveTab('residents'); setMobileMenuOpen(false); }}
              className={`w-full px-4 py-3 text-sm font-bold rounded-xl flex items-center justify-between transition cursor-pointer ${
                activeTab === 'residents'
                  ? isNight
                    ? 'bg-emerald-950/60 text-emerald-300'
                    : 'bg-emerald-50 text-emerald-700'
                  : isNight
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-emerald-500" />
                <span>Resident Management</span>
              </div>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                isNight ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'
              }`}>
                {stats.total}
              </span>
            </button>

            <button
              onClick={() => { setActiveTab('settings'); setMobileMenuOpen(false); }}
              className={`w-full px-4 py-3 text-sm font-bold rounded-xl flex items-center gap-3 transition cursor-pointer ${
                activeTab === 'settings'
                  ? isNight
                    ? 'bg-emerald-950/60 text-emerald-300'
                    : 'bg-emerald-50 text-emerald-700'
                  : isNight
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Settings className="w-4 h-4 text-emerald-500" />
              <span>Home Settings & Daily Cycle</span>
            </button>

            <button
              onClick={() => { setActiveTab('reports'); setMobileMenuOpen(false); }}
              className={`w-full px-4 py-3 text-sm font-bold rounded-xl flex items-center gap-3 transition cursor-pointer ${
                activeTab === 'reports'
                  ? isNight
                    ? 'bg-emerald-950/60 text-emerald-300'
                    : 'bg-emerald-50 text-emerald-700'
                  : isNight
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4 text-emerald-500" />
              <span>Reports & Exports</span>
            </button>

            {/* Resident View button in mobile menu */}
            <div className={`h-px my-1 ${isNight ? 'bg-slate-800' : 'bg-slate-200'}`} />

            <div className={`px-4 py-2 text-xs ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
              Signed in as <span className={`font-bold ${isNight ? 'text-slate-200' : 'text-slate-800'}`}>{user.name}</span>
              <span className="ml-1 capitalize">({user.role})</span>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT CONTAINER */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 space-y-6">
        {/* =================================================================== */}
        {/* 0. ENTERPRISE ADMIN OVERVIEW TAB (Visible to admin role) */}
        {/* =================================================================== */}
        {activeTab === 'overview' && user.role === 'admin' && (
          <AdminOverviewView
            token={token}
            onSelectHome={(selectedHome) => {
              setHome(selectedHome);
              setActiveTab('dashboard');
            }}
            activeHomeId={home.id}
          />
        )}
        {/* =================================================================== */}
        {/* 1. LIVE STATUS DASHBOARD TAB */}
        {/* =================================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Stat Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              {/* Emergency Alert Card (Red) */}
              <button
                onClick={() => setStatusFilter(statusFilter === 'not_ok' ? 'all' : 'not_ok')}
                className={`p-4 rounded-2xl border text-left transition cursor-pointer ${
                  stats.notOk > 0
                    ? isNight
                      ? 'bg-rose-950/50 border-rose-800 ring-2 ring-rose-600/20 shadow-sm'
                      : 'bg-rose-50 border-rose-300 ring-2 ring-rose-500/20 shadow-sm'
                    : isNight
                      ? 'bg-slate-900 border-slate-700'
                      : 'bg-white border-slate-200'
                }`}
              >
                <div className={`flex items-center justify-between text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-300' : 'text-slate-500'}`}>
                  <span>Emergency (No)</span>
                  <AlertTriangle className={`w-4 h-4 ${stats.notOk > 0 ? 'text-rose-600 animate-bounce' : 'text-slate-400'}`} />
                </div>
                <div className={`text-3xl font-black mt-2 ${stats.notOk > 0 ? 'text-rose-700' : isNight ? 'text-white' : 'text-slate-700'}`}>
                  {stats.notOk}
                </div>
                <p className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  {stats.notOk > 0 ? 'Urgent attention required' : 'No emergency alerts'}
                </p>
              </button>

              {/* No Response / Missed Cutoff Card (Amber) */}
              <button
                onClick={() => setStatusFilter(statusFilter === 'no_response' ? 'all' : 'no_response')}
                className={`p-4 rounded-2xl border shadow-xs text-left hover:border-amber-400 transition cursor-pointer ${
                  isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
                }`}
              >
                <div className={`flex items-center justify-between text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-300' : 'text-slate-500'}`}>
                  <span>Missed Cutoff</span>
                  <Clock className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-3xl font-black mt-2 text-amber-600">
                  {stats.noResponse}
                </div>
                <p className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  No response by {home.cutoffTime} SAST
                </p>
              </button>

              {/* Awaiting Checkin Card (Grey) */}
              <button
                onClick={() => setStatusFilter(statusFilter === 'awaiting' ? 'all' : 'awaiting')}
                className={`p-4 rounded-2xl border shadow-xs text-left hover:border-slate-400 transition cursor-pointer ${
                  isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
                }`}
              >
                <div className={`flex items-center justify-between text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-300' : 'text-slate-500'}`}>
                  <span>Awaiting Check-in</span>
                  <HelpCircle className="w-4 h-4 text-slate-400" />
                </div>
                <div className={`text-3xl font-black mt-2 ${isNight ? 'text-white' : 'text-slate-700'}`}>
                  {stats.awaiting}
                </div>
                <p className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  Pending resident tap
                </p>
              </button>

              {/* Checked in OK Card (Green) */}
              <button
                onClick={() => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok')}
                className={`p-4 rounded-2xl border shadow-xs text-left hover:border-emerald-400 transition cursor-pointer ${
                  isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
                }`}
              >
                <div className={`flex items-center justify-between text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-300' : 'text-slate-500'}`}>
                  <span>Checked In OK</span>
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-3xl font-black mt-2 text-emerald-600">
                  {stats.ok}
                </div>
                <p className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  Confirmed safe today
                </p>
              </button>

              {/* Away Card (Indigo) */}
              <button
                onClick={() => setAwaySectionOpen(!awaySectionOpen)}
                className={`p-4 rounded-2xl border shadow-xs text-left transition cursor-pointer ${
                  stats.away > 0
                    ? isNight
                      ? 'bg-indigo-950/50 border-indigo-800'
                      : 'bg-indigo-50 border-indigo-300'
                    : isNight
                      ? 'bg-slate-900 border-slate-700'
                      : 'bg-white border-slate-200'
                }`}
              >
                <div className={`flex items-center justify-between text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-300' : 'text-slate-500'}`}>
                  <span>Away</span>
                  <CalendarOff className={`w-4 h-4 ${stats.away > 0 ? 'text-indigo-600' : 'text-slate-400'}`} />
                </div>
                <div className={`text-3xl font-black mt-2 ${stats.away > 0 ? 'text-indigo-700' : isNight ? 'text-white' : 'text-slate-700'}`}>
                  {stats.away}
                </div>
                <p className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  Excluded from check-in
                </p>
              </button>
            </div>

            {/* Filter & Search Bar */}
            <div className={`p-4 rounded-2xl border shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 ${
              isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
            }`}>
              {/* Search */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Search resident by name or room (e.g. 104, Arthur)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full pl-10 pr-4 py-2 rounded-xl border text-xs focus:outline-hidden focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 ${
                    isNight ? 'bg-slate-800 border-slate-700 text-white' : 'border-slate-200'
                  }`}
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-semibold">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    statusFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : isNight
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({stats.activeTotal})
                </button>
                <button
                  onClick={() => setStatusFilter('not_ok')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    statusFilter === 'not_ok'
                      ? 'bg-rose-600 text-white'
                      : isNight
                        ? 'bg-rose-950/50 text-rose-300 hover:bg-rose-900/50'
                        : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  Red "No" ({stats.notOk})
                </button>
                <button
                  onClick={() => setStatusFilter('no_response')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    statusFilter === 'no_response'
                      ? 'bg-amber-600 text-white'
                      : isNight
                        ? 'bg-amber-950/50 text-amber-300 hover:bg-amber-900/50'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  Missed ({stats.noResponse})
                </button>
                <button
                  onClick={() => setStatusFilter('awaiting')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    statusFilter === 'awaiting'
                      ? 'bg-slate-700 text-white'
                      : isNight
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Awaiting ({stats.awaiting})
                </button>
                <button
                  onClick={() => setStatusFilter('ok')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    statusFilter === 'ok'
                      ? 'bg-emerald-600 text-white'
                      : isNight
                        ? 'bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  Green "Yes" ({stats.ok})
                </button>
                <button
                  onClick={() => setStatusFilter(statusFilter === 'away' ? 'all' : 'away')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    statusFilter === 'away'
                      ? 'bg-indigo-600 text-white'
                      : isNight
                        ? 'bg-indigo-950/50 text-indigo-300 hover:bg-indigo-900/50'
                        : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`}
                >
                  Away ({stats.away})
                </button>
              </div>
            </div>

            {/* Live Triage Residents Grid (WORST-FIRST ORDER) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className={`font-bold text-sm flex items-center gap-2 ${isNight ? 'text-white' : 'text-slate-700'}`}>
                  <span>Resident Status Triage</span>
                  <span className={`text-xs font-normal ${isNight ? 'text-slate-400' : 'text-slate-400'}`}>
                    (Sorted worst-first: Red alerts at top, green safe at bottom)
                  </span>
                </h3>
                <span className={`text-xs ${isNight ? 'text-slate-400' : 'text-slate-400'}`}>
                  Showing {sortedAndFilteredResidents.length} residents
                </span>
              </div>

              {loading ? (
                <div className={`p-12 rounded-2xl border text-center ${
                  isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
                }`}>
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-600 mx-auto mb-2" />
                  <p className={`text-xs ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>Loading resident wellness records...</p>
                </div>
              ) : sortedAndFilteredResidents.length === 0 ? (
                <div className={`p-12 rounded-2xl border text-center text-xs ${
                  isNight ? 'bg-slate-900 border-slate-700 text-slate-400' : 'bg-white border-slate-200 text-slate-500'
                }`}>
                  No residents match the active filter.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {sortedAndFilteredResidents.map((resident) => {
                    const isNotOk = resident.todayStatus === 'not_ok';
                    const isNoResponse = resident.todayStatus === 'no_response';
                    const isAwaiting = resident.todayStatus === 'awaiting';
                    const isOk = resident.todayStatus === 'ok';

                    return (
                      <div
                        key={resident.id}
                        onClick={() => setSelectedResidentForDetail(resident)}
                        className={`rounded-2xl p-4 sm:p-5 border transition-all cursor-pointer relative group ${
                          isNotOk
                            ? isNight
                              ? 'bg-rose-950/50 border-rose-800 ring-2 ring-rose-600 shadow-md hover:bg-rose-950/70'
                              : 'bg-rose-50/90 border-rose-300 ring-2 ring-rose-500 shadow-md hover:bg-rose-50'
                            : isNoResponse
                            ? isNight
                              ? 'bg-amber-950/50 border-amber-800 hover:border-amber-700 shadow-xs'
                              : 'bg-amber-50/70 border-amber-300 hover:border-amber-400 shadow-xs'
                            : isAwaiting
                            ? isNight
                              ? 'bg-slate-900 border-slate-700 hover:border-slate-600 shadow-xs'
                              : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                            : isNight
                              ? 'bg-emerald-950/50 border-emerald-800 hover:border-emerald-700 shadow-xs'
                              : 'bg-emerald-50/40 border-emerald-200 hover:border-emerald-300 shadow-xs'
                        }`}
                      >
                        {/* Top card bar */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg ${
                                isNotOk
                                  ? 'bg-rose-600 text-white shadow-xs'
                                  : isNoResponse
                                  ? 'bg-amber-600 text-white'
                                  : isAwaiting
                                  ? 'bg-slate-200 text-slate-800'
                                  : 'bg-emerald-600 text-white'
                              }`}
                            >
                              {resident.roomNumber}{resident.unitNumber ? ` / ${resident.unitNumber}` : ''}
                            </span>

                            {resident.isDeviceLinked ? (
                              <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                                <Smartphone className="w-3 h-3 text-emerald-600" />
                                Linked
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-700 font-semibold flex items-center gap-1 bg-amber-100/80 px-2 py-0.5 rounded-full">
                                Not Linked
                              </span>
                            )}
                          </div>

                          {/* Status Pill */}
                          <div>
                            {isNotOk && (
                              <span className="inline-flex items-center gap-1 text-xs font-extrabold text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-300 animate-pulse">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                NEED HELP
                              </span>
                            )}
                            {isNoResponse && (
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300">
                                <Clock className="w-3 h-3" />
                                NO RESPONSE
                              </span>
                            )}
                            {isAwaiting && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                                <HelpCircle className="w-3 h-3" />
                                AWAITING
                              </span>
                            )}
                            {isOk && (
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
                                <CheckCircle className="w-3.5 h-3.5" />
                                OK
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Resident Name */}
                        <div className="mt-3">
                          <h4 className={`font-bold text-base leading-tight ${isNight ? 'text-white' : 'text-slate-900'}`}>
                            {resident.name}
                          </h4>
                          <p className={`text-xs mt-0.5 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                            {resident.phone || 'No phone recorded'}
                          </p>
                          {resident.notes && (
                            <p className={`text-[11px] mt-1 line-clamp-2 italic ${isNight ? 'text-slate-500' : 'text-slate-400'}`}>
                              {resident.notes}
                            </p>
                          )}
                        </div>

                        {/* Check-in time / Notes */}
                        <div className={`mt-3 pt-3 border-t flex items-center justify-between text-[11px] ${isNight ? 'border-slate-700 text-slate-400' : 'border-slate-200/60 text-slate-500'}`}>
                          <span>
                            {resident.todayTimestamp
                              ? `At ${new Date(resident.todayTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} SAST`
                              : 'No check-in today'}
                          </span>
                          <span className={`font-semibold group-hover:underline ${isNight ? 'text-emerald-400' : 'text-emerald-700'}`}>
                            View Details →
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Currently Away Section */}
              {stats.away > 0 && statusFilter !== 'away' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <h3 className={`font-bold text-sm flex items-center gap-2 ${isNight ? 'text-indigo-400' : 'text-indigo-700'}`}>
                      <CalendarOff className="w-4 h-4" />
                      <span>Currently Away</span>
                      <span className={`text-xs font-normal ${isNight ? 'text-slate-400' : 'text-slate-400'}`}>
                        ({stats.away} excluded from check-in)
                      </span>
                    </h3>
                    <button
                      onClick={() => setStatusFilter('away')}
                      className={`text-xs font-semibold transition cursor-pointer ${
                        isNight ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'
                      }`}
                    >
                      View All →
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {residents.filter((r) => r.isAway).map((resident) => (
                      <div
                        key={resident.id}
                        onClick={() => setSelectedResidentForAway(resident)}
                        className={`rounded-2xl p-4 sm:p-5 border transition-all cursor-pointer relative group ${
                          isNight
                            ? 'bg-indigo-950/30 border-indigo-800 hover:border-indigo-700 shadow-xs'
                            : 'bg-indigo-50/50 border-indigo-200 hover:border-indigo-300 shadow-xs'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-indigo-600 text-white">
                              {resident.roomNumber}{resident.unitNumber ? ` / ${resident.unitNumber}` : ''}
                            </span>
                            {resident.isDeviceLinked && (
                              <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                                <Smartphone className="w-3 h-3 text-emerald-600" />
                                Linked
                              </span>
                            )}
                          </div>
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 bg-indigo-100 px-2.5 py-0.5 rounded-full border border-indigo-300">
                            <CalendarOff className="w-3.5 h-3.5" />
                            AWAY
                          </span>
                        </div>
                        <div className="mt-3">
                          <p className={`font-bold text-base ${isNight ? 'text-white' : 'text-slate-900'}`}>
                            {resident.name}
                          </p>
                          <p className={`text-xs mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                            {resident.awayStartDate && (
                              <>From {resident.awayStartDate}{resident.awayEndDate ? ` to ${resident.awayEndDate}` : ' — indefinite'}</>
                            )}
                          </p>
                          {resident.awayNote && (
                            <p className={`text-[11px] italic mt-1 ${isNight ? 'text-slate-500' : 'text-slate-400'}`}>
                              "{resident.awayNote}"
                            </p>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className={`text-[11px] font-semibold group-hover:underline ${isNight ? 'text-indigo-400' : 'text-indigo-700'}`}>
                            Edit Away Period →
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 2. RESIDENT MANAGEMENT TAB */}
        {/* =================================================================== */}
        {activeTab === 'residents' && (
          <div className="space-y-4">
            {/* Header with Add Button */}
            <div className={`p-5 rounded-2xl border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className={`text-lg font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>Resident Directory</h2>
                <p className={`text-xs ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  Manage resident profiles, emergency contacts, and device-linking status for {home.name}.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className={`px-3 py-2.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition cursor-pointer ${isNight ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'}`}>
                  <Upload className="w-4 h-4" />
                  <span>CSV Import</span>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvImport}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={() => {
                    const csv = `Name,Room,Unit,Phone,Contact Name,Relation,Contact Number,Notes
"Jane Smith","101","A1","082-555-1234","John Smith","Son","082-555-5678","Diabetic, needs morning medication"
"Arthur Johnson","102","A1","071-333-4444","Mary Johnson","Wife","083-222-1111","Walker user, fall risk"
"Grace Williams","103","A2","","Peter Williams","Son","084-888-9999","Hard of hearing, use visual cues"
"David Brown","104","A2","072-777-8888","Sarah Brown","Daughter","081-666-3333","Needs assistance with meals"
"Elsie Taylor","105","A3","083-999-0000","James Taylor","Son","082-111-2222","Night wanderer, check frequently"`;
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'elderwatch-resident-import-example.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className={`px-3 py-2.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition cursor-pointer ${isNight ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'}`}
                >
                  <FileText className="w-4 h-4" />
                  <span>Example CSV</span>
                </button>
                <button
                  onClick={handleBatchLinkCodes}
                  className={`px-3 py-2.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition cursor-pointer ${isNight ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'}`}
                >
                  <Key className="w-4 h-4" />
                  <span>Export Pairing Codes</span>
                </button>
                <button
                  onClick={() => {
                    setEditingResident(null);
                    setIsAddEditModalOpen(true);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 transition cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Resident</span>
                </button>
              </div>
            </div>

            {/* Residents Table */}
            <div className={`rounded-2xl border shadow-xs overflow-hidden ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`uppercase text-[10px] font-bold tracking-wider border-b ${isNight ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-slate-100/80 text-slate-600 border-slate-200'}`}>
                    <tr>
                      <th className="py-3 px-4">Room</th>
                      <th className="py-3 px-4">Resident Name</th>
                      <th className="py-3 px-4 hidden md:table-cell">Phone</th>
                      <th className="py-3 px-4">Device Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y font-medium ${isNight ? 'divide-slate-800' : 'divide-slate-100'}`}>
                    {residents.map((r) => (
                      <tr key={r.id} className={`transition ${isNight ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50/80'}`}>
                        <td className={`py-3.5 px-4 font-mono font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>
                          <div className="flex flex-col">
                            <span>{r.roomNumber}</span>
                            {r.unitNumber && (
                              <span className={`text-[10px] font-mono font-normal ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                                Unit {r.unitNumber}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`py-3.5 px-4 font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>
                          {r.name}
                          {r.emergencyContactName && (
                            <div className={`text-[10px] font-normal ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                              EC: {r.emergencyContactName}
                              {r.emergencyContactRelation && ` (${r.emergencyContactRelation})`}
                              {r.emergencyContactNumber && ` — ${r.emergencyContactNumber}`}
                            </div>
                          )}
                          {r.notes && !r.emergencyContactName && (
                            <div className={`text-[10px] font-normal italic ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                              {r.notes}
                            </div>
                          )}
                        </td>
                        <td className={`py-3.5 px-4 hidden md:table-cell ${isNight ? 'text-slate-300' : 'text-slate-600'}`}>
                          {r.phone || '—'}
                        </td>
                        <td className="py-3.5 px-4">
                          {r.isAway ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800">
                              <CalendarOff className="w-3 h-3 text-indigo-600" /> Away
                            </span>
                          ) : r.isDeviceLinked ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                              <Check className="w-3 h-3 text-emerald-600" /> Linked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                              Unlinked
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right space-x-1">
                          <button
                            onClick={() => setSelectedResidentForAway(r)}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${isNight ? 'border-indigo-700 hover:bg-indigo-950/50 text-indigo-400' : 'border-indigo-200 hover:bg-indigo-50 text-indigo-600'}`}
                            title={r.isAway ? 'Edit Away Period' : 'Mark as Away'}
                          >
                            {r.isAway ? <Calendar className="w-3.5 h-3.5" /> : <CalendarOff className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => setSelectedResidentForQR(r)}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${isNight ? 'border-slate-700 hover:bg-emerald-950/50 text-emerald-400' : 'border-slate-200 hover:bg-emerald-50 text-emerald-600'}`}
                            title="Show Pairing Code"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRotateLinkCode(r.id, r.roomNumber, r.name)}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${isNight ? 'border-slate-700 hover:bg-amber-950/50 text-amber-400' : 'border-slate-200 hover:bg-amber-50 text-amber-600'}`}
                            title="Rotate Pairing Code (invalidates old code)"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingResident(r);
                              setIsAddEditModalOpen(true);
                            }}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${isNight ? 'border-slate-700 hover:bg-slate-700 text-slate-400' : 'border-slate-200 hover:bg-slate-100 text-slate-600'}`}
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteResident(r.id, r.name)}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${isNight ? 'border-rose-900 hover:bg-rose-950/50 text-rose-400' : 'border-rose-200 hover:bg-rose-50 text-rose-600'}`}
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}


        {/* =================================================================== */}
        {/* 3. HOME SETTINGS & DAILY CYCLE SCHEDULER TAB */}
        {/* =================================================================== */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            {/* Multi-Tenant Facility Details Form */}
            <div className={`p-6 rounded-3xl border shadow-xs ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-5 h-5 text-emerald-600" />
                <h3 className={`text-lg font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>Facility Configuration</h3>
              </div>

              {settingsSuccessMsg && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>{settingsSuccessMsg}</span>
                </div>
              )}

              <form onSubmit={handleSaveSettings} className="space-y-4 max-w-xl text-xs">
                <div>
                  <label className={`block font-bold uppercase tracking-wider mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                    Village Name
                  </label>
                  <input
                    type="text"
                    value={homeNameInput}
                    onChange={(e) => setHomeNameInput(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border text-sm font-semibold ${isNight ? 'bg-slate-800 border-slate-700 text-white' : 'border-slate-300 text-slate-900'}`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block font-bold uppercase tracking-wider mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                      Daily Check-in Cutoff Time (SAST)
                    </label>
                    <input
                      type="time"
                      value={cutoffTimeInput}
                      onChange={(e) => setCutoffTimeInput(e.target.value)}
                      className={`w-full p-2.5 rounded-xl border text-sm font-semibold ${isNight ? 'bg-slate-800 border-slate-700 text-white' : 'border-slate-300 text-slate-900'}`}
                    />
                    <p className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-400'}`}>
                      Unanswered residents auto-marked "no_response" at this cutoff.
                    </p>
                  </div>

                  <div>
                    <label className={`block font-bold uppercase tracking-wider mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                      Timezone
                    </label>
                    <input
                      type="text"
                      disabled
                      value="Africa/Johannesburg (SAST, UTC+2)"
                      className={`w-full p-2.5 rounded-xl text-xs font-medium ${isNight ? 'bg-slate-800 border border-slate-700 text-slate-400' : 'bg-slate-100 border border-slate-200 text-slate-500'}`}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition cursor-pointer"
                >
                  {savingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </form>
            </div>

            {/* Daily Cycle Test Engine (Interactive Triggers) */}
            <div className={`p-6 rounded-3xl border shadow-xs space-y-4 ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-emerald-600" />
                  <h3 className={`text-lg font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>Daily Cycle Scheduled Jobs</h3>
                </div>
                <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full ${isNight ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                  Automated Interval: Every 30s
                </span>
              </div>

              <p className={`text-xs leading-relaxed ${isNight ? 'text-slate-400' : 'text-slate-600'}`}>
                Reset all residents to "awaiting" status for a new day. This clears today's check-ins.
              </p>

              {jobFeedbackMsg && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl text-xs font-bold flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-600" />
                  <span>{jobFeedbackMsg}</span>
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={handleMorningReset}
                  disabled={!!runningJob}
                  className={`p-4 rounded-2xl text-left transition cursor-pointer ${isNight ? 'bg-emerald-950/50 hover:bg-emerald-900/50 border border-emerald-800' : 'bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'}`}
                >
                  <span className="text-[11px] font-bold text-emerald-700 uppercase block mb-1">
                    Manual Reset
                  </span>
                  <span className={`font-bold text-sm block ${isNight ? 'text-white' : 'text-slate-900'}`}>
                    Morning Reset
                  </span>
                  <span className={`text-[11px] block mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                    Resets all residents to "awaiting" for a new day.
                  </span>
                </button>
              </div>
            </div>

            {/* Audit Logs Table */}
            <div className={`p-6 rounded-3xl border shadow-xs space-y-3 ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
              <h3 className={`text-base font-bold flex items-center gap-2 ${isNight ? 'text-white' : 'text-slate-900'}`}>
                <FileText className="w-4 h-4 text-slate-500" />
                <span>Recent Scheduled Job & Push Notification Logs</span>
              </h3>

              <div className={`rounded-2xl overflow-hidden text-xs ${isNight ? 'bg-slate-800 border border-slate-700 divide-slate-700' : 'border border-slate-200 divide-slate-100'} divide-y`}>
                {jobLogs.length === 0 ? (
                  <p className={`p-4 text-center ${isNight ? 'text-slate-400' : 'text-slate-400'}`}>No execution logs yet.</p>
                ) : (
                  jobLogs.slice(0, 8).map((log) => (
                    <div key={log.id} className="p-3.5 flex items-start justify-between gap-3">
                      <div>
                        <span className={`font-bold block ${isNight ? 'text-white' : 'text-slate-800'}`}>{log.description}</span>
                        {log.details && (
                          <span className={`text-[11px] block mt-0.5 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>{log.details}</span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} SAST
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 4. REPORTS & EXPORTS TAB */}
        {/* =================================================================== */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            {/* DAILY REPORT — today only, one row per resident */}
            <div className={`p-6 rounded-3xl border shadow-xs ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-emerald-600" />
                <h3 className={`text-lg font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>Daily Report (Today)</h3>
              </div>

              <p className={`text-xs leading-relaxed mb-4 ${isNight ? 'text-slate-400' : 'text-slate-600'}`}>
                One-page PDF of today's check-ins: every resident, their room/unit, and whether they have checked in
                today — <span className="text-emerald-600 font-bold">Yes</span> in green,{' '}
                <span className="text-rose-600 font-bold">No</span> in red. Use it for sister rounds, handover or the
                daily file.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleGenerateDailyReport}
                  disabled={dailyReportBusy}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {dailyReportBusy ? 'Generating...' : "Generate Today's PDF"}
                </button>
                <span className={`text-xs ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  {residents.length} resident{residents.length === 1 ? '' : 's'} in {home.name}
                </span>
              </div>

              {dailyReportMsg && (
                <div className={`mt-4 p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                  dailyReportMsg.startsWith('Could not')
                    ? 'bg-rose-50 border border-rose-200 text-rose-800'
                    : isNight ? 'bg-emerald-950 border border-emerald-800 text-emerald-200' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                }`}>
                  {dailyReportMsg.startsWith('Could not')
                    ? <AlertTriangle className="w-4 h-4 text-rose-600" />
                    : <CheckCircle className="w-4 h-4 text-emerald-600" />}
                  <span>{dailyReportMsg}</span>
                </div>
              )}
            </div>

            <div className={`p-6 rounded-3xl border shadow-xs ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-emerald-600" />
                <h3 className={`text-lg font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>Check-In Report Export</h3>
              </div>

              <p className={`text-xs leading-relaxed mb-4 ${isNight ? 'text-slate-400' : 'text-slate-600'}`}>
                Generate a PDF report of check-ins for this home. You can email this file directly to staff or keep it for records.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <label className={`text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>Period</label>
                <select
                  value={reportPeriod}
                  onChange={(e) => setReportPeriod(e.target.value as 'weekly' | 'monthly')}
                  className={`p-2.5 rounded-xl border text-sm font-semibold ${isNight ? 'bg-slate-800 border-slate-700 text-white' : 'border-slate-300 text-slate-900'}`}
                >
                  <option value="weekly">Last 7 days</option>
                  <option value="monthly">Last 30 days</option>
                </select>

                <button
                  onClick={handleGenerateReport}
                  disabled={reportLoading}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  {reportLoading ? 'Generating...' : 'Generate PDF Report'}
                </button>
              </div>

              {reportError && (
                <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>{reportError}</span>
                </div>
              )}

              {reportRows && !reportError && (
                <div className="mt-5 space-y-3">
                  <div className={`p-4 rounded-2xl border text-xs ${isNight ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                    <p className="font-bold mb-1">Report ready</p>
                    <p>Records: <span className="font-mono">{reportRows.length}</span></p>
                    <p className="mt-1 opacity-75">Contains resident check-ins from the selected period.</p>
                  </div>
                  <button
                    onClick={handleDownloadReport}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-sm transition cursor-pointer flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <LegalFooter />
      </main>

      {/* MODALS */}
      {selectedResidentForDetail && (
        <ResidentDetailModal
          resident={selectedResidentForDetail}
          token={token}
          onClose={() => setSelectedResidentForDetail(null)}
          onOpenQR={(r) => {
            setSelectedResidentForDetail(null);
            setSelectedResidentForQR(r);
          }}
          onStatusUpdated={() => {
            fetchResidents();
            fetchLogs();
          }}
        />
      )}

      {selectedResidentForQR && (
        <DeviceLinkQRModal
          resident={selectedResidentForQR}
          token={token}
          onClose={() => setSelectedResidentForQR(null)}
          onCodeRegenerated={fetchResidents}
          onSimulateDeviceBind={(code) => {
            setSelectedResidentForQR(null);
            onSimulateDeviceBind(code);
          }}
        />
      )}

      {selectedResidentForAway && (
        <MarkAwayModal
          resident={selectedResidentForAway}
          token={token}
          onClose={() => setSelectedResidentForAway(null)}
          onSaved={() => {
            setSelectedResidentForAway(null);
            fetchResidents();
          }}
        />
      )}

      {isAddEditModalOpen && (
        <AddEditResidentModal
          resident={editingResident}
          onClose={() => setIsAddEditModalOpen(false)}
          onSave={handleSaveResident}
        />
      )}
    </div>
  );
};
