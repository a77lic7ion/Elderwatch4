import React, { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

export function getIsNightMode(): boolean {
  if (typeof document === 'undefined') return true;
  const attr = document.documentElement.getAttribute('data-night');
  if (attr !== null) return attr === 'on';
  try {
    const saved = localStorage.getItem('ew_night');
    if (saved !== null) return saved === 'on';
  } catch {
    // ignore
  }
  return true;
}

export function setAppTheme(isNight: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-night', isNight ? 'on' : 'off');
  if (isNight) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  try {
    localStorage.setItem('ew_night', isNight ? 'on' : 'off');
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('elderwatch-theme-change', { detail: { isNight } }));
}

// Auto-run on load
if (typeof document !== 'undefined') {
  const initial = getIsNightMode();
  document.documentElement.setAttribute('data-night', initial ? 'on' : 'off');
  if (initial) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function useAppTheme(): [boolean, (val: boolean | ((prev: boolean) => boolean)) => void] {
  const [isNight, setIsNightState] = useState<boolean>(getIsNightMode);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ isNight: boolean }>;
      if (custom.detail && typeof custom.detail.isNight === 'boolean') {
        setIsNightState(custom.detail.isNight);
      } else {
        setIsNightState(getIsNightMode());
      }
    };
    window.addEventListener('elderwatch-theme-change', handler);
    return () => window.removeEventListener('elderwatch-theme-change', handler);
  }, []);

  const setIsNight = (val: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof val === 'function' ? val(isNight) : val;
    setIsNightState(nextVal);
    setAppTheme(nextVal);
  };

  return [isNight, setIsNight];
}

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', showLabel = false }) => {
  const [isNight, setIsNight] = useAppTheme();

  return (
    <button
      type="button"
      onClick={() => setIsNight((prev) => !prev)}
      title={isNight ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer select-none border shadow-xs ${
        isNight
          ? 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/40 ring-1 ring-amber-500/20'
          : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300 ring-1 ring-slate-200'
      } ${className}`}
      aria-label={isNight ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
    >
      {isNight ? (
        <>
          <Sun className="w-4 h-4 text-amber-400 shrink-0" />
          {showLabel && <span className="text-xs font-bold text-amber-200 whitespace-nowrap">Light Mode</span>}
        </>
      ) : (
        <>
          <Moon className="w-4 h-4 text-indigo-600 shrink-0" />
          {showLabel && <span className="text-xs font-bold text-slate-800 whitespace-nowrap">Dark Mode</span>}
        </>
      )}
    </button>
  );
};
