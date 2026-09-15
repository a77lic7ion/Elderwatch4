import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, Clock, HelpCircle, QrCode, Phone, User, Calendar, ShieldAlert } from 'lucide-react';
import { ResidentTodayView, CheckIn } from '../types';
import { useAppTheme } from './ThemeToggle';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, limit, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';

interface ResidentDetailModalProps {
  resident: ResidentTodayView;
  token: string;
  onClose: () => void;
  onOpenQR: (resident: ResidentTodayView) => void;
  onStatusUpdated: () => void;
}

export const ResidentDetailModal: React.FC<ResidentDetailModalProps> = ({
  resident,
  token,
  onClose,
  onOpenQR,
  onStatusUpdated,
}) => {
  const [isNight] = useAppTheme();
  const [history, setHistory] = useState<CheckIn[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState('');
  const [showOverrideForm, setShowOverrideForm] = useState(false);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        // Get today's date in SAST (UTC+2)
        const now = new Date();
        const sastDate = new Date(now.getTime() + (2 * 60 * 60 * 1000));
        const today = sastDate.toISOString().split('T')[0];

        // Fetch last 7 days of check-ins for this resident
        const checkinsRef = collection(db, 'checkins');
        const q = query(
          checkinsRef,
          where('residentId', '==', resident.id),
          orderBy('date', 'desc'),
          limit(7)
        );
        const snapshot = await getDocs(q);
        const items: CheckIn[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          items.push({
            id: doc.id,
            residentId: data.residentId,
            homeId: data.homeId,
            date: data.date,
            status: data.status,
            timestamp: data.timestamp,
            notes: data.notes,
            updatedBy: data.updatedBy,
          });
        });
        setHistory(items);
      } catch (err) {
        console.error('Failed to fetch resident history:', err);
      } finally {
        setLoadingHistory(false);
      }
    };
    fetchHistory();
  }, [resident.id, token]);

  const handleOverrideStatus = async (newStatus: 'ok' | 'not_ok' | 'awaiting') => {
    setOverrideLoading(true);
    try {
      // Get today's date in SAST (UTC+2)
      const now = new Date();
      const sastDate = new Date(now.getTime() + (2 * 60 * 60 * 1000));
      const today = sastDate.toISOString().split('T')[0];

      // Use the same document ID format as saveCheckinToFirestore: ${homeId}_${residentId}_${today}
      const checkinId = `${resident.homeId}_${resident.id}_${today}`;
      const checkinRef = doc(db, 'checkins', checkinId);
      
      const payload = {
        id: checkinId,
        residentId: resident.id,
        homeId: resident.homeId,
        date: today,
        status: newStatus,
        timestamp: now.toISOString(),
        notes: overrideNotes || `Staff manual check-in: ${newStatus.toUpperCase()}`,
        updatedBy: 'staff_override',
      };

      await setDoc(checkinRef, payload, { merge: true });

      console.log(`[ElderWatch] Staff override: ${resident.name} -> ${newStatus}`, payload);
      onStatusUpdated();
      setShowOverrideForm(false);
      setOverrideNotes('');
    } catch (err) {
      console.error('Staff override failed:', err);
      alert('Failed to update status. Please try again.');
    } finally {
      setOverrideLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'not_ok':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            Needs Attention (Red "No")
          </span>
        );
      case 'no_response':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            No Response (Missed Cutoff)
          </span>
        );
      case 'awaiting':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            Awaiting Check-in
          </span>
        );
      case 'ok':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            Checked In OK (Green "Yes")
          </span>
        );
    }
  };

  const getModalBg = () => isNight ? 'bg-slate-900' : 'bg-white';
  const getContentBg = () => isNight ? 'bg-slate-800' : 'bg-slate-50';
  const getBorderColor = () => isNight ? 'border-slate-700' : 'border-slate-200';
  const getTextColor = () => isNight ? 'text-white' : 'text-slate-900';
  const getSubtextColor = () => isNight ? 'text-slate-400' : 'text-slate-500';
  const getMutedColor = () => isNight ? 'text-slate-500' : 'text-slate-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-xs">
      <div className={`w-full max-w-lg h-full shadow-2xl flex flex-col justify-between overflow-hidden animate-in slide-in-from-right duration-200 ${getModalBg()}`}>
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="bg-emerald-500/20 text-emerald-300 font-mono text-xs px-2 py-0.5 rounded-md border border-emerald-500/30">
                ROOM {resident.roomNumber}
              </span>
              {resident.isDeviceLinked ? (
                <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                  ● Device Linked
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-amber-400 flex items-center gap-1">
                  ○ Device Unlinked
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold">{resident.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
          {/* Today's Triage Status Card */}
          <div
            className={`p-4 rounded-2xl border ${
              resident.todayStatus === 'not_ok'
                ? isNight ? 'bg-rose-950/50 border-rose-800' : 'bg-rose-50 border-rose-300'
                : resident.todayStatus === 'no_response'
                ? isNight ? 'bg-amber-950/50 border-amber-800' : 'bg-amber-50 border-amber-300'
                : resident.todayStatus === 'awaiting'
                ? isNight ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'
                : isNight ? 'bg-emerald-950/50 border-emerald-800' : 'bg-emerald-50 border-emerald-200'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-bold uppercase tracking-wider ${getSubtextColor()}`}>
                Today's Wellness Status
              </span>
              {getStatusBadge(resident.todayStatus)}
            </div>

            <div className={`text-xs space-y-1 pt-1 ${isNight ? 'text-slate-300' : 'text-slate-600'}`}>
              {resident.todayTimestamp ? (
                <p>
                  Logged at: <strong>{new Date(resident.todayTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} SAST</strong> ({resident.todayUpdatedBy === 'resident' ? 'Tapped by resident' : resident.todayUpdatedBy})
                </p>
              ) : (
                <p>No check-in received yet today.</p>
              )}
            </div>

            {/* Quick Action Button */}
            <div className={`mt-3 pt-3 border-t flex items-center justify-between ${isNight ? 'border-slate-700' : 'border-slate-200/80'}`}>
              <button
                onClick={() => setShowOverrideForm(!showOverrideForm)}
                className={`text-xs font-semibold underline ${isNight ? 'text-slate-300 hover:text-white' : 'text-slate-700 hover:text-slate-900'}`}
              >
                {showOverrideForm ? 'Hide Staff Override' : 'Staff Override / In-Person Visit'}
              </button>
              <button
                onClick={() => onOpenQR(resident)}
                className={`text-xs font-semibold flex items-center gap-1 ${isNight ? 'text-emerald-400 hover:text-emerald-300' : 'text-emerald-700 hover:text-emerald-800'}`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Pairing QR</span>
              </button>
            </div>

            {/* In-Person Staff Override Form */}
            {showOverrideForm && (
              <div className={`mt-3 p-3 rounded-xl border space-y-2.5 ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
                <p className={`text-xs font-bold ${isNight ? 'text-white' : 'text-slate-800'}`}>
                  Update status following nurse room inspection:
                </p>
                <input
                  type="text"
                  placeholder="Notes (e.g. Sister visited room, resident safe and having tea)"
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  className={`w-full text-xs p-2 rounded-lg border ${isNight ? 'bg-slate-800 border-slate-600 text-white placeholder-slate-400' : 'border-slate-300'}`}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOverrideStatus('ok')}
                    disabled={overrideLoading}
                    className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {overrideLoading ? 'Saving...' : 'Mark OK'}
                  </button>
                  <button
                    onClick={() => handleOverrideStatus('not_ok')}
                    disabled={overrideLoading}
                    className="flex-1 py-1.5 rounded-lg bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 disabled:opacity-50"
                  >
                    {overrideLoading ? 'Saving...' : 'Mark Alert'}
                  </button>
                  <button
                    onClick={() => handleOverrideStatus('awaiting')}
                    disabled={overrideLoading}
                    className={`flex-1 py-1.5 rounded-lg font-semibold text-xs disabled:opacity-50 ${isNight ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                  >
                    {overrideLoading ? 'Saving...' : 'Reset'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Resident Details */}
          <div className={`p-4 rounded-2xl border space-y-3 ${getContentBg()} ${getBorderColor()}`}>
            <h4 className={`font-bold text-xs uppercase tracking-wider ${getSubtextColor()}`}>Resident Information</h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className={`${getMutedColor()} block`}>Phone Number</span>
                <span className={`font-semibold flex items-center gap-1 mt-0.5 ${getTextColor()}`}>
                  <Phone className={`w-3 h-3 ${getMutedColor()}`} />
                  {resident.phone || 'None registered'}
                </span>
              </div>
              <div>
                <span className={`${getMutedColor()} block`}>Emergency Contact</span>
                <span className={`font-semibold flex items-center gap-1 mt-0.5 ${getTextColor()}`}>
                  <User className={`w-3 h-3 ${getMutedColor()}`} />
                  {resident.emergencyContact || 'None on file'}
                </span>
              </div>
            </div>
            {resident.notes && (
              <div className={`pt-2 border-t text-xs ${getBorderColor()}`}>
                <span className={`${getMutedColor()} block`}>Care & Mobility Notes</span>
                <p className={`mt-0.5 leading-relaxed ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>{resident.notes}</p>
              </div>
            )}
          </div>

          {/* 7-Day Check-in History */}
          <div className="space-y-2">
            <h4 className={`font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 ${getSubtextColor()}`}>
              <Calendar className="w-3.5 h-3.5" />
              <span>Recent Check-in History</span>
            </h4>

            {loadingHistory ? (
              <p className={`text-xs ${getMutedColor()}`}>Loading history...</p>
            ) : history.length === 0 ? (
              <p className={`text-xs italic ${getMutedColor()}`}>No previous check-in records found.</p>
            ) : (
              <div className={`rounded-xl divide-y overflow-hidden text-xs ${isNight ? 'bg-slate-800 border border-slate-700 divide-slate-700' : 'border border-slate-200 divide-slate-100'}`}>
                {history.map((item) => (
                  <div key={item.id} className="p-3 flex items-center justify-between">
                    <div>
                      <span className={`font-bold ${getTextColor()}`}>{item.date}</span>
                      <p className={`text-[11px] ${getMutedColor()}`}>
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} SAST
                      </p>
                    </div>
                    <div>{getStatusBadge(item.status)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={`p-4 border-t flex items-center justify-between ${isNight ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
          <button
            onClick={() => onOpenQR(resident)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition"
          >
            <QrCode className="w-4 h-4" />
            <span>Generate Phone Setup QR</span>
          </button>
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-xl border font-semibold text-xs transition ${isNight ? 'border-slate-700 text-slate-300 hover:bg-slate-700' : 'border-slate-200 text-slate-700 hover:bg-slate-100'}`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
