import React, { useState } from 'react';
import { X, CalendarOff, Calendar } from 'lucide-react';
import { ResidentTodayView } from '../types';
import { useAppTheme } from './ThemeToggle';

interface MarkAwayModalProps {
  resident: ResidentTodayView;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}

export const MarkAwayModal: React.FC<MarkAwayModalProps> = ({
  resident,
  token,
  onClose,
  onSaved,
}) => {
  const [isNight] = useAppTheme();
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(resident.awayStartDate || today);
  const [endDate, setEndDate] = useState(resident.awayEndDate || '');
  const [note, setNote] = useState(resident.awayNote || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMarkAway = async () => {
    if (!startDate) {
      setError('Start date is required.');
      return;
    }
    if (endDate && endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/residents/${resident.id}/away`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isAway: true,
          awayStartDate: startDate,
          awayEndDate: endDate || null,
          awayNote: note.trim(),
        }),
      });

      // If server endpoint returned HTML or non-JSON (Vercel 404), fall back to Firestore
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!res.ok && data) {
        throw new Error(data.error || 'Failed to mark resident as away');
      }

      if (!data) {
        // Server endpoint doesn't exist — fall back to Firestore
        const { db } = await import('../lib/firebase');
        const { doc, updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'residents', resident.id), {
          isAway: true,
          awayStartDate: startDate,
          awayEndDate: endDate || null,
          awayNote: note.trim(),
        });
      }

      onSaved();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkBack = async () => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/residents/${resident.id}/away`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isAway: false }),
      });

      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!res.ok && data) {
        throw new Error(data.error || 'Failed to mark resident as back');
      }

      if (!data) {
        const { db } = await import('../lib/firebase');
        const { doc, updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'residents', resident.id), {
          isAway: false,
          awayStartDate: null,
          awayEndDate: null,
          awayNote: '',
        });
      }

      onSaved();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className={`w-full max-w-md rounded-3xl shadow-2xl border overflow-hidden ${
        isNight ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        {/* Header */}
        <div className="bg-indigo-900 text-white p-5 flex items-start justify-between">
          <div>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              ROOM {resident.roomNumber}{resident.unitNumber ? ` / ${resident.unitNumber}` : ''}
            </span>
            <h3 className="font-bold text-lg mt-1">
              {resident.isAway ? 'Edit Away Period for' : 'Mark as Away:'} {resident.name}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-indigo-300 hover:text-white hover:bg-indigo-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="text-rose-400 text-xs bg-rose-950/50 border border-rose-800 rounded-xl p-3">
              {error}
            </div>
          )}

          {/* Currently Away Status */}
          {resident.isAway && (
            <div className={`rounded-xl p-4 border ${
              isNight ? 'bg-indigo-950/50 border-indigo-800' : 'bg-indigo-50 border-indigo-200'
            }`}>
              <p className={`text-xs font-bold flex items-center gap-1.5 ${
                isNight ? 'text-indigo-300' : 'text-indigo-800'
              }`}>
                <CalendarOff className="w-3.5 h-3.5" />
                CURRENTLY AWAY
              </p>
              <p className={`text-xs mt-1 ${
                isNight ? 'text-indigo-400' : 'text-indigo-700'
              }`}>
                {resident.awayStartDate && (
                  <>From: <strong>{resident.awayStartDate}</strong></>
                )}
                {resident.awayEndDate && (
                  <> — To: <strong>{resident.awayEndDate}</strong></>
                )}
                {!resident.awayEndDate && (
                  <> — <strong>No return date set</strong></>
                )}
              </p>
              {resident.awayNote && (
                <p className={`text-[11px] mt-1 italic ${
                  isNight ? 'text-indigo-500' : 'text-indigo-600'
                }`}>
                  "{resident.awayNote}"
                </p>
              )}
              <button
                onClick={handleMarkBack}
                disabled={saving}
                className="mt-3 w-full py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <Calendar className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Mark as Back (Return from Away)'}
              </button>
            </div>
          )}

          {/* Date Range */}
          <div className="space-y-3">
            <div>
              <label className={`block text-xs font-bold uppercase tracking-wider mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                Start Date *
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`w-full px-3 py-2.5 rounded-xl border text-sm ${
                  isNight ? 'bg-slate-800 border-slate-600 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <div>
              <label className={`block text-xs font-bold uppercase tracking-wider mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                End Date <span className="font-normal text-slate-400">(optional — leave blank for indefinite)</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className={`w-full px-3 py-2.5 rounded-xl border text-sm ${
                  isNight ? 'bg-slate-800 border-slate-600 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <div>
              <label className={`block text-xs font-bold uppercase tracking-wider mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                Reason <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Hospital stay, family visit, holiday"
                className={`w-full px-3 py-2.5 rounded-xl border text-sm ${
                  isNight ? 'bg-slate-800 border-slate-600 text-white placeholder-slate-500' : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
                }`}
              />
            </div>
          </div>

          <p className={`text-[11px] rounded-xl p-3 border ${
            isNight ? 'text-slate-400 bg-slate-800 border-slate-700' : 'text-slate-500 bg-slate-50 border-slate-100'
          }`}>
            Away residents are automatically checked in as <strong>safe</strong> each morning and excluded from the daily check-in cycle. They will not receive push notifications until they are marked as back.
          </p>
        </div>

        {/* Footer */}
        <div className={`p-4 border-t flex justify-end gap-2 ${
          isNight ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-100'
        }`}>
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-xl border font-semibold text-xs transition ${
              isNight ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Cancel
          </button>
          {!resident.isAway && (
            <button
              onClick={handleMarkAway}
              disabled={saving || !startDate}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <CalendarOff className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Mark as Away'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
