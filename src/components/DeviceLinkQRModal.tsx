import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, Link2, Smartphone, RefreshCw, QrCode, Download, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { ResidentTodayView } from '../types';

interface DeviceLinkQRModalProps {
  resident: ResidentTodayView;
  onClose: () => void;
  onCodeRegenerated: () => void;
  onSimulateDeviceBind: (code: string) => void;
}

export const DeviceLinkQRModal: React.FC<DeviceLinkQRModalProps> = ({
  resident,
  onClose,
  onCodeRegenerated,
  onSimulateDeviceBind,
}) => {
  const [copiedPermanent, setCopiedPermanent] = useState(false);
  const [copiedAuto, setCopiedAuto] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [currentCode, setCurrentCode] = useState(resident.oneTimeLinkCode || '');
  const [autoGenerating, setAutoGenerating] = useState(!resident.oneTimeLinkCode);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const permanentUrl = `${origin}/checkin/${resident.id}`;

  // The auto-pair URL embeds the one-time link code as a single-use token.
  // Scanning the QR and opening the link completes link + pair in one step.
  const autoPairUrl = currentCode
    ? `${origin}/checkin/${resident.id}?pair=${encodeURIComponent(currentCode)}`
    : '';

  // Auto-generate a code immediately if the resident doesn't have one yet,
  // so the QR code is ready the moment the modal opens — no manual
  // "Regenerate" click required.
  useEffect(() => {
    if (currentCode) return;
    let cancelled = false;
    setAutoGenerating(true);
    (async () => {
      try {
        const { regenerateLinkCode } = await import('../lib/firebase-api');
        const newCode = await regenerateLinkCode(resident.id, resident.roomNumber);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate QR code whenever the autoPairUrl changes
  useEffect(() => {
    let cancelled = false;
    if (autoPairUrl) {
      QRCode.toDataURL(autoPairUrl, {
        width: 320,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
        errorCorrectionLevel: 'H',
      })
        .then((url) => { if (!cancelled) setQrDataUrl(url); })
        .catch(() => { if (!cancelled) setQrDataUrl(''); });
    } else {
      setQrDataUrl('');
    }
    return () => { cancelled = true; };
  }, [autoPairUrl]);

  const handleCopyAutoPairUrl = () => {
    if (!autoPairUrl) return;
    navigator.clipboard.writeText(autoPairUrl);
    setCopiedAuto(true);
    setTimeout(() => setCopiedAuto(false), 2500);
  };

  const handleCopyPermanentUrl = () => {
    navigator.clipboard.writeText(permanentUrl);
    setCopiedPermanent(true);
    setTimeout(() => setCopiedPermanent(false), 2500);
  };

  // Manual rotation of the URL — old QR codes immediately stop working.
  const handleRotateCode = async () => {
    setRegenerating(true);
    try {
      const { regenerateLinkCode } = await import('../lib/firebase-api');
      const newCode = await regenerateLinkCode(resident.id, resident.roomNumber);
      setCurrentCode(newCode);
      onCodeRegenerated();
    } catch (err) {
      console.error('Failed to rotate code:', err);
    } finally {
      setRegenerating(false);
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `elderwatch-qr-${resident.name.replace(/\s+/g, '-')}-room-${resident.roomNumber}.png`;
    a.click();
  };

  const handlePrint = () => {
    if (typeof window === 'undefined') return;
    const printWindow = window.open('', '_blank', 'width=600,height=800');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Pairing Card — ${resident.name} (Room ${resident.roomNumber})</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 24px; }
            .card { border: 2px dashed #94a3b8; border-radius: 16px; padding: 24px; max-width: 480px; margin: 0 auto; }
            h1 { font-size: 28px; margin: 0 0 4px; }
            h2 { font-size: 18px; color: #475569; margin: 0 0 16px; }
            img { width: 320px; height: 320px; }
            .url { font-family: monospace; font-size: 12px; word-break: break-all; background: #f1f5f9; padding: 8px; border-radius: 8px; margin-top: 12px; }
            .footer { color: #64748b; font-size: 12px; margin-top: 16px; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>${resident.name}</h1>
            <h2>Room ${resident.roomNumber}${resident.unitNumber ? ' / Unit ' + resident.unitNumber : ''}</h2>
            <img src="${qrDataUrl}" alt="Pairing QR Code" />
            <p>Scan with the phone's camera to lock this device to ${resident.name} for daily check-ins.</p>
            <div class="url">${autoPairUrl}</div>
            <p class="footer">ElderWatch — Daily Wellness Check-in</p>
          </div>
          <div class="no-print" style="margin-top: 20px;">
            <button onclick="window.print()" style="padding: 10px 24px; background: #157A4C; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer;">Print Card</button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
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
          {/* QR Code - Main pairing method */}
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
              <QrCode className="w-4 h-4" />
              SCAN QR CODE TO LINK &amp; PAIR IN ONE STEP
            </p>
            <p className="text-xs text-emerald-700">
              Open the phone's camera, point at this QR code, and tap the link. The phone will be locked to this resident automatically — no code entry required.
            </p>
            <div className="flex flex-col items-center gap-3">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Pairing QR code"
                  className="w-56 h-56 rounded-xl border-4 border-white shadow-md bg-white"
                />
              ) : (
                <div className="w-56 h-56 rounded-xl border-2 border-dashed border-emerald-300 flex flex-col items-center justify-center text-emerald-600 text-xs gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                  <span className="font-semibold">
                    {autoGenerating ? 'Generating pairing URL...' : 'Preparing QR...'}
                  </span>
                </div>
              )}
              <div className="flex gap-2 w-full">
                <button
                  onClick={handleDownloadQr}
                  disabled={!qrDataUrl}
                  className="flex-1 py-2 px-3 rounded-xl bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                <button
                  onClick={handlePrint}
                  disabled={!qrDataUrl}
                  className="flex-1 py-2 px-3 rounded-xl bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Card
                </button>
              </div>
            </div>
          </div>

          {/* Auto-Pair URL */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" />
              Or send this link via WhatsApp/SMS
            </p>
            <p className="text-[11px] text-slate-500">
              Opening this link on any phone automatically pairs it to {resident.name}.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={autoPairUrl || (autoGenerating ? 'Generating...' : '')}
                className="flex-1 text-[10px] px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 select-all font-mono truncate"
              />
              <button
                onClick={handleCopyAutoPairUrl}
                disabled={!autoPairUrl}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs flex items-center gap-1.5 transition shrink-0 cursor-pointer disabled:opacity-50"
              >
                {copiedAuto ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Permanent check-in URL (after pairing) */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5" />
              Already paired? Bookmark this URL
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={permanentUrl}
                className="flex-1 text-[10px] px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 select-all font-mono truncate"
              />
              <button
                onClick={handleCopyPermanentUrl}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs flex items-center gap-1.5 transition shrink-0 cursor-pointer"
              >
                {copiedPermanent ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <button
              onClick={() => onSimulateDeviceBind(currentCode)}
              disabled={!currentCode}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Smartphone className="w-4 h-4" />
              <span>Test: Open Resident View in This Browser</span>
            </button>

            <button
              onClick={handleRotateCode}
              disabled={regenerating || autoGenerating}
              className="text-xs text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1 mx-auto pt-1 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} />
              <span>
                {regenerating
                  ? 'Rotating...'
                  : 'Rotate Pairing URL (invalidates old QR)'}
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
