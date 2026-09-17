import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Key, RefreshCw } from 'lucide-react';
import { ResidentTodayView } from '../types';

interface DeviceLinkCodeModalProps {
  resident: ResidentTodayView;
  onClose: () => void;
  onCodeRegenerated: () => void;
}

export const DeviceLinkCodeModal: React.FC<DeviceLinkCodeModalProps> = ({
  resident,
  onClose,
  onCodeRegenerated,
}) => {
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [currentCode, setCurrentCode] = useState(resident.oneTimeLinkCode || '');
  const [autoGenerating, setAutoGenerating] = useState(!resident.oneTimeLinkCode);

  // Auto-generate a code immediately if the resident doesn't have one yet
  useEffect(() => {
    if (currentCode) return;
    let cancelled = false;
    setAutoGenerating(true);
    (async () => {
      try {
        const { regenerateLinkCode } = await import('../lib/firebase-api');
        const newCode = await regenerateLinkCode(resident.id, resident.roomNumber, resident.homeId);
        if (cancelled) return;
        setCurrentCode(newCode);
        onCodeRegenerated();
      } catch (err) {
        console.error('Failed to auto-generate link code:', err);
      } finally {
        if (!cancelled) setAutoGenerating(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCopyCode = () => {
    if (!currentCode) return;
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Rotate the code — old codes immediately stop working.
  const handleRotateCode = async () => {
    setRegenerating(true);
    try {
      const { regenerateLinkCode } = await import('../lib/firebase-api');
      const newCode = await regenerateLinkCode(resident.id, resident.roomNumber, resident.homeId);
      setCurrentCode(newCode);
      onCodeRegenerated();
    } catch (err) {
      console.error('Failed to rotate code:', err);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-slate-900 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-start justify-between">
          <div>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              ROOM {resident.roomNumber}{resident.unitNumber ? ` / ${resident.unitNumber}` : ''}
            </span>
            <h3 className="font-bold text-lg mt-1">
              {resident.isDeviceLinked ? 'Re-Pair Device for' : 'Pair Device for'} {resident.name}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Pairing Code — only thing shown, no QR */}
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
              <Key className="w-4 h-4" />
              LINK CODE — ENTER ON THE RESIDENT'S PHONE
            </p>
            <p className="text-xs text-emerald-700">
              Type this code on the resident's phone to pair it to {resident.name}. The code stays valid until you rotate it.
            </p>
            <div className="flex flex-col items-center gap-3">
              {currentCode ? (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-emerald-600 font-semibold">Link Code</span>
                  <code className="text-3xl font-mono font-black text-emerald-900 tracking-widest bg-white border-2 border-emerald-300 rounded-xl px-5 py-4 shadow-inner">
                    {currentCode}
                  </code>
                  <button
                    onClick={handleCopyCode}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy Code'}
                  </button>
                </div>
              ) : (
                <div className="w-56 h-28 rounded-xl border-2 border-dashed border-emerald-300 flex flex-col items-center justify-center text-emerald-600 text-xs gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                  <span className="font-semibold">
                    {autoGenerating ? 'Generating link code...' : 'Preparing...'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Rotate Pairing Code button */}
          <div className="pt-2 border-t border-slate-100">
            <button
              onClick={handleRotateCode}
              disabled={regenerating || autoGenerating || !currentCode}
              className="text-xs text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1 mx-auto pt-1 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} />
              <span>
                {regenerating
                  ? 'Rotating...'
                  : 'Rotate Pairing Link Code (reset the APK Pair)'}
              </span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
