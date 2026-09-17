import React, { useState, useEffect } from 'react';
import { StaffLoginScreen } from './components/StaffLoginScreen';
import { AdminPanel } from './components/AdminPanel';
import { ResidentCheckInScreen } from './components/ResidentCheckInScreen';
import { DeviceLinkScreen } from './components/DeviceLinkScreen';
import { OfflineIndicator } from './components/PWAInstallButton';
import { ThemeToggle, useAppTheme } from './components/ThemeToggle';
import { StaffUser, Home, DeviceBinding } from './types';
import { auth, logout, onAuthChange } from './lib/firebase';
import { loadBinding } from './lib/device-storage';

export default function App() {
  const isPWA = typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
     (window.navigator as any).standalone === true);

  const [currentRoute, setCurrentRoute] = useState<'admin' | 'checkin' | 'link'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;

      // ---- STAFF WEB APP (browser, not PWA) ----
      // The admin panel lives at /admin. The browser root / also goes to admin.
      // The staff web app NEVER checks device bindings or resident state.
      if (!isPWA) {
        return 'admin';
      }

      // ---- RESIDENT APP (PWA/TWA only) ----
      // Explicit routes
      if (path.startsWith('/checkin')) return 'checkin';
      if (path.startsWith('/link')) return 'link';

      // /admin in a PWA context = redirect to link (resident app should never show admin)
      if (path === '/admin') return 'link';

      // If device is paired, go to check-in
      const binding = localStorage.getItem('elderwatch_device_binding');
      if (binding) {
        try {
          const parsed = JSON.parse(binding);
          if (parsed.residentId) {
            const checkinUrl = `/checkin/${parsed.residentId}`;
            window.history.replaceState({}, '', checkinUrl);
            localStorage.setItem('ew_pwa_checkin_url', checkinUrl);
            return 'checkin';
          }
        } catch {}
      }

      // Check sessionStorage backup
      const sessionBinding = sessionStorage.getItem('elderwatch_device_binding');
      if (sessionBinding) {
        try {
          const parsed = JSON.parse(sessionBinding);
          if (parsed.residentId) {
            const checkinUrl = `/checkin/${parsed.residentId}`;
            window.history.replaceState({}, '', checkinUrl);
            localStorage.setItem('ew_pwa_checkin_url', checkinUrl);
            localStorage.setItem('elderwatch_device_binding', sessionBinding);
            return 'checkin';
          }
        } catch {}
      }

      // Restore saved check-in URL if binding exists
      const savedUrl = localStorage.getItem('ew_pwa_checkin_url');
      if (savedUrl && localStorage.getItem('elderwatch_device_binding')) {
        window.history.replaceState({}, '', savedUrl);
        return 'checkin';
      }

      // No binding found — show pairing screen
      return 'link';
    }
    // SSR fallback
    return isPWA ? 'link' : 'admin';
  });

  const [linkCodeParam, setLinkCodeParam] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('code') || '';
    }
    return '';
  });

  const [permanentResidentId, setPermanentResidentId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const match = path.match(/^\/checkin\/(.+)$/);
      if (match) {
        localStorage.setItem('ew_pwa_checkin_url', path);
        return match[1];
      }
      const savedUrl = localStorage.getItem('ew_pwa_checkin_url');
      if (savedUrl) {
        const savedMatch = savedUrl.match(/^\/checkin\/(.+)$/);
        if (savedMatch) return savedMatch[1];
      }
    }
    return null;
  });

  // If localStorage was cleared by TWA, restore binding from IndexedDB
  useEffect(() => {
    if (isPWA && currentRoute === 'link' && !localStorage.getItem('elderwatch_device_binding')) {
      loadBinding().then((binding) => {
        if (binding && binding.residentId) {
          localStorage.setItem('elderwatch_device_binding', JSON.stringify(binding));
          const checkinUrl = `/checkin/${binding.residentId}`;
          localStorage.setItem('ew_pwa_checkin_url', checkinUrl);
          window.history.replaceState({}, '', checkinUrl);
          setCurrentRoute('checkin');
        }
      });
    }
  }, []);

  const [staffToken, setStaffToken] = useState<string | null>(null);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [staffHome, setStaffHome] = useState<Home | null>(null);

  // Restore staff session
  useEffect(() => {
    const saved = sessionStorage.getItem('elderwatch_staff_auth');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.token && parsed.user && parsed.home) {
          setStaffToken(parsed.token);
          setStaffUser(parsed.user);
          setStaffHome(parsed.home);
        }
      } catch {}
    }
  }, []);

  // Popstate handler — browser back/forward buttons
  useEffect(() => {
    const handler = () => {
      if (!isPWA) {
        // Staff web app: always stay on admin
        setCurrentRoute('admin');
        return;
      }
      // Resident app: read from localStorage
      const binding = localStorage.getItem('elderwatch_device_binding');
      if (binding) {
        try {
          const parsed = JSON.parse(binding);
          if (parsed.residentId) {
            setCurrentRoute('checkin');
            return;
          }
        } catch {}
      }
      setCurrentRoute('link');
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [isPWA]);

  const navigate = (route: 'admin' | 'checkin' | 'link', code?: string) => {
    let path = '/';
    if (route === 'admin') path = '/admin';
    else if (route === 'checkin') {
      const id = permanentResidentId || 'new';
      path = `/checkin/${id}`;
    } else if (route === 'link') {
      path = code ? `/link?code=${encodeURIComponent(code)}` : '/link';
    }
    window.history.pushState({}, '', path);
    setCurrentRoute(route);
    if (code) setLinkCodeParam(code);
  };

  const handleLoginSuccess = (token: string, user: StaffUser, home: Home) => {
    setStaffToken(token);
    setStaffUser(user);
    setStaffHome(home);
    sessionStorage.setItem('elderwatch_staff_auth', JSON.stringify({ token, user, home }));
  };

  const handleLogout = async () => {
    try { await logout(); } catch {}
    setStaffToken(null);
    setStaffUser(null);
    setStaffHome(null);
    sessionStorage.removeItem('elderwatch_staff_auth');
    navigate('admin');
  };

  const handleLinkedSuccess = (binding: DeviceBinding) => {
    const checkinUrl = `/checkin/${binding.residentId}`;
    window.history.replaceState({}, '', checkinUrl);
    localStorage.setItem('ew_pwa_checkin_url', checkinUrl);
    localStorage.setItem('ew_lang', 'en');
    sessionStorage.setItem('elderwatch_device_binding', JSON.stringify(binding));
    setPermanentResidentId(binding.residentId);
    setCurrentRoute('checkin');
  };

  const [isNight] = useAppTheme();

  return (
    <div
      className={`min-h-screen antialiased select-none transition-colors duration-200 ${
        isNight
          ? currentRoute === 'checkin'
            ? 'bg-[#1A221E] text-[#F2EEE5]'
            : 'bg-slate-950 text-slate-100'
          : currentRoute === 'checkin'
          ? 'bg-[#FAF7F2] text-stone-900'
          : 'bg-slate-100 text-slate-900'
      }`}
      style={{
        fontFamily: '"Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif',
      }}
    >
      <OfflineIndicator />

      {currentRoute === 'checkin' && (
        <ResidentCheckInScreen
          onNavigateToAdmin={() => navigate('admin')}
          onNavigateToLink={(code) => navigate('link', code)}
          permanentResidentId={permanentResidentId}
        />
      )}

      {currentRoute === 'link' && (
        <DeviceLinkScreen
          initialCode={linkCodeParam}
          onLinkedSuccess={handleLinkedSuccess}
          onCancel={() => navigate('admin')}
        />
      )}

      {currentRoute === 'admin' && (
        <>
          {staffToken && staffUser && staffHome ? (
            <AdminPanel
              token={staffToken}
              user={staffUser}
              initialHome={staffHome}
              onLogout={handleLogout}
            />
          ) : (
            <StaffLoginScreen
              onLoginSuccess={handleLoginSuccess}
            />
          )}
        </>
      )}
    </div>
  );
}