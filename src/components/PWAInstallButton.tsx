import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="p-2 rounded-xl border bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition cursor-pointer border-emerald-600"
        title="Install ElderWatch PWA to Home Screen"
      >
        <Download className="w-4 h-4" />
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="p-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 transition shadow-xs cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
          title="Add to iOS Home Screen"
        >
          <Share className="w-4 h-4 text-emerald-600" />
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-slate-900">Install ElderWatch on iPhone</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-slate-600 space-y-2 leading-relaxed">
                To lock this device as a dedicated resident check-in terminal:
                <br /><br />
                1. Tap the <strong>Share</strong> icon in Safari toolbar.<br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.<br />
                3. ElderWatch will launch full-screen without address bars.
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition"
              >
                Understood
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-white shadow-xl">
      <span className="h-2 w-2 rounded-full bg-white animate-ping" />
      <span>Offline Mode — Taps will sync automatically upon reconnecting</span>
    </div>
  );
};
