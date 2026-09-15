import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  url: string;
  size?: number;
}

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ url, size = 220 }) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, {
      width: size,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((res) => {
        setDataUrl(res);
        setError(null);
      })
      .catch((err) => {
        console.error('Failed to generate QR code', err);
        setError('Could not generate QR code');
      });
  }, [url, size]);

  if (error) {
    return <div className="text-rose-500 text-sm">{error}</div>;
  }

  if (!dataUrl) {
    return (
      <div
        className="animate-pulse bg-slate-100 rounded-xl flex items-center justify-center border border-slate-200"
        style={{ width: size, height: size }}
      >
        <span className="text-xs text-slate-400">Generating QR...</span>
      </div>
    );
  }

  return (
    <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 inline-block">
      <img
        src={dataUrl}
        alt="ElderWatch Resident Setup QR Code"
        width={size}
        height={size}
        className="rounded-lg"
      />
    </div>
  );
};
