import React, { useState, useEffect } from 'react';
import { StaffLoginScreen } from './components/StaffLoginScreen';
import { AdminPanel } from './components/AdminPanel';
import { ResidentCheckInScreen } from './components/ResidentCheckInScreen';
import { DeviceLinkScreen } from './components/DeviceLinkScreen';
import { OfflineIndicator } from './components/PWAInstallButton';
import { ThemeToggle, useAppTheme } from './components/ThemeToggle';
import { StaffUser, Home, DeviceBinding } from './types';
import { auth, logout, onAuthChange } from './lib/firebase';

export default function App() {
  const isPWA = typeof window !== 'undefined' && 
    (window.matchMedia('(display-mode: standalone)').matches || 
     (window.navigator as any).standalone === true);

  // Simple route from localStorage — no async, no server checks.
  // ResidentCheckInScreen handles server verification internally.
  const [currentRoute, setCurrentRoute] = useState<'admin' | 'checkin' | 'link'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;

      // Explicit routes
      if (path.startsWith('/checkin')) return 'checkin';
      if (path.startsWith('/link')) return 'link';

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
        } catch { /* corrupt binding — fall through to link */ }
      }

      // Also check sessionStorage (backup for TWA localStorage clearing)
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

      // Resident APK (PWA/TWA): NEVER show admin — always go to link or checkin.
      // Only the web browser at /admin should show the admin panel.
      if (path === '/admin') {
        // If there's a staff session in sessionStorage, allow admin (browser login).
        // Otherwise redirect to link (resident APK should never see admin).
        if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('elderwatch_staff_auth')) {
          return 'admin';
        }
        return 'link';
      }

      // Restore saved check-in URL if binding exists
      const savedUrl = localStorage.getItem('ew_pwa_checkin_url');
      if (savedUrl && localStorage.getItem('elderwatch_device_binding')) {
        window.history.replaceState({}, '', savedUrl);
        return 'checkin';
      }
    }
    return 'link';
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

  const [staffToken, setStaffToken] = useState<string | null>(null);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [staffHome, setStaffHome] = useState<Home | null>(null);

  // Restore staff session
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedAuth = sessionStorage.getItem('elderwatch_staff_auth');
      if (savedAuth) {
        const { token, user, home } = JSON.parse(savedAuth);
        setStaffToken(token);
        setStaffUser(user);
        setStaffHome(home);
      }
    } catch (e) {
      console.error('Failed to restore session:', e);
    }

    const unsubscribe = onAuthChange((firebaseUser) => {
      if (!firebaseUser) {
        setStaffToken(null);
        setStaffUser(null);
        setStaffHome(null);
        sessionStorage.removeItem('elderwatch_staff_auth');
      }
    });

    return () => unsubscribe();
  }, []);

  // Listen for browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      if (path.startsWith('/link')) {
        setCurrentRoute('link');
        setLinkCodeParam(params.get('code') || '');
      } else if (path.startsWith('/checkin')) {
        setCurrentRoute('checkin');
        const match = path.match(/^\/checkin\/(.+)$/);
        setPermanentResidentId(match ? match[1] : null);
        if (match) localStorage.setItem('ew_pwa_checkin_url', path);
      } else if (path === '/admin' && !isPWA) {
        setCurrentRoute('admin');
      } else {
        // Default: check binding
        const binding = localStorage.getItem('elderwatch_device_binding');
        if (binding) {
          try {
            const parsed = JSON.parse(binding);
            if (parsed.residentId) {
              const checkinUrl = `/checkin/${parsed.residentId}`;
              window.history.replaceState({}, '', checkinUrl);
              setPermanentResidentId(parsed.residentId);
              setCurrentRoute('checkin');
              return;
            }
          } catch {}
        }
        setCurrentRoute('link');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isPWA]);

  const navigate = (route: 'admin' | 'checkin' | 'link', code?: string) => {
    setCurrentRoute(route);
    let path = '/admin';
    if (route === 'checkin') path = '/checkin';
    if (route === 'link') {
      path = code ? `/link?code=${encodeURIComponent(code)}` : '/link';
      if (code) setLinkCodeParam(code);
    }
    window.history.pushState({}, '', path);
  };

  const handleLoginSuccess = (token: string, user: StaffUser, home: Home) => {
    setStaffToken(token);
    setStaffUser(user);
    setStaffHome(home);
    sessionStorage.setItem('elderwatch_staff_auth', JSON.stringify({ token, user, home }));
  };

  const handleLogout = async () => {
    await logout();
    setStaffToken(null);
    setStaffUser(null);
    setStaffHome(null);
    sessionStorage.removeItem('elderwatch_staff_auth');
  };

  const handleLinkedSuccess = (binding: DeviceBinding) => {
    console.log('Successfully paired device for:', binding.residentName);
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
