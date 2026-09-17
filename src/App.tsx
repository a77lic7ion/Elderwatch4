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
  // Check if we're in PWA mode (standalone display)
  const isPWA = typeof window !== 'undefined' && 
    (window.matchMedia('(display-mode: standalone)').matches || 
     (window.navigator as any).standalone === true);

  // Routes: 'admin' | 'checkin' | 'link'
  const [currentRoute, setCurrentRoute] = useState<'admin' | 'checkin' | 'link'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path.startsWith('/checkin')) return 'checkin';
      if (path.startsWith('/link')) return 'link';

      // If the device is already paired, go straight to check-in
      const binding = localStorage.getItem('elderwatch_device_binding');
      if (binding) {
        try {
          const parsed = JSON.parse(binding);
          if (parsed.residentId) {
            const checkinUrl = `/checkin/${parsed.residentId}`;
            window.history.replaceState({}, '', checkinUrl);
            return 'checkin';
          }
        } catch { /* ignore corrupt binding */ }
      }

      // Resident APK (PWA/TWA): NEVER show admin — always go to link or checkin
      // Only the web browser at /admin should show the admin panel.
      if (path === '/admin') {
        if (isPWA) return 'link';
        return 'admin';
      }

      // PWA launch: check if we have a saved resident check-in URL
      // Only restore if the binding still exists — otherwise the device was unpaired
      // and we should stay on the link screen.
      const savedResidentUrl = localStorage.getItem('ew_pwa_checkin_url');
      const hasBinding = !!localStorage.getItem('elderwatch_device_binding');
      if (savedResidentUrl && hasBinding) {
        if (isPWA || window.location.pathname === '/') {
          window.history.replaceState({}, '', savedResidentUrl);
          return 'checkin';
        }
      }
      // PWA/APK launch: if we're in standalone mode and have no binding yet,
      // go straight to the pairing-code screen — never land on the admin panel.
      // NOTE: '/' is the RESIDENT entry point. Staff open /admin explicitly.
      if (isPWA) return 'link';
    }
    // No binding, not PWA, path is '/' — resident flow (pairing screen)
    // Staff who want the admin panel must navigate to /admin or log in.
    return 'link';
  });

  // Link code parameter if navigating to /link?code=XYZ
  const [linkCodeParam, setLinkCodeParam] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('code') || '';
    }
    return '';
  });

  // Permanent resident ID from /checkin/:residentId
  const [permanentResidentId, setPermanentResidentId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const match = path.match(/^\/checkin\/(.+)$/);
      if (match) {
        // Save this URL for PWA home screen restore
        localStorage.setItem('ew_pwa_checkin_url', path);
        return match[1];
      }
      // PWA launch: restore from saved URL
      const savedUrl = localStorage.getItem('ew_pwa_checkin_url');
      if (savedUrl) {
        const savedMatch = savedUrl.match(/^\/checkin\/(.+)$/);
        if (savedMatch) {
          return savedMatch[1];
        }
      }
    }
    return null;
  });

  // Staff Authentication State
  const [staffToken, setStaffToken] = useState<string | null>(null);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [staffHome, setStaffHome] = useState<Home | null>(null);

  // Tracks whether we're still verifying the device binding against the server.
  // While true, nothing renders — prevents a flash of the check-in screen for
  // devices whose pairing code was rotated by staff.
  const [bindingVerified, setBindingVerified] = useState(() => {
    // If there's no binding, nothing to verify — go ahead immediately.
    return !localStorage.getItem('elderwatch_device_binding');
  });

  // Restore staff session if present (sessionStorage = per-tab sessions)
  // Each browser tab has its own isolated Firebase Auth instance (inMemoryPersistence)
  // so multiple users can be signed in simultaneously in different tabs.
  // If no staff session and no device binding exists, default to the link (pairing code) route
  // — this is what makes the APK show the code-entry screen on first open.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Verify device binding against the server BEFORE rendering anything.
    // If admin rotated the pairing code (isDeviceLinked: false), clear all
    // local state and go straight to the link screen.
    const verifyBinding = async () => {
      const bindingRaw = localStorage.getItem('elderwatch_device_binding');
      if (bindingRaw) {
        try {
          const binding = JSON.parse(bindingRaw);
          if (binding.residentId) {
            const { db } = await import('./lib/firebase');
            const { doc, getDoc } = await import('firebase/firestore');
            const snap = await getDoc(doc(db, 'residents', binding.residentId));
            if (!snap.exists() || !snap.data().isDeviceLinked) {
              console.warn('[ElderWatch] Binding invalid on server — resident screen will show unpaired');
              // Don't clear localStorage here — keep the binding so ResidentCheckInScreen
              // can show the unpaired screen with cache-clear instructions.
              // localStorage will be cleared when the user clears the app cache.
              setBindingVerified(true);
              return;
            }
          }
        } catch (e) {
          console.error('[ElderWatch] Binding verification failed:', e);
        }
      }
      setBindingVerified(true);
    };
    verifyBinding();
    // Restore staff session on mount
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

    // Listen for Firebase Auth state changes — only valid in this tab (in-memory).
    // If the user signs out elsewhere or reloads, the auth state in this tab goes null,
    // so we clear sessionStorage to match.
    const unsubscribe = onAuthChange((firebaseUser) => {
      if (!firebaseUser) {
        setStaffToken(null);
        setStaffUser(null);
        setStaffHome(null);
        sessionStorage.removeItem('elderwatch_staff_auth');
      }
    });

  // Auto-route to pairing code screen if no staff and no device binding.
  // In TWA / standalone (APK) mode we always force the pairing screen on first
  // open — a staff session restored from a shared browser origin must not skip it.
  if (!sessionStorage.getItem('elderwatch_staff_auth')) {
      const binding = localStorage.getItem('elderwatch_device_binding');
      if (!binding) {
        window.history.replaceState({}, '', '/link');
        setCurrentRoute('link');
      }
  } else if (isPWA) {
      // APK opened with a stale staff session (shared with Chrome) and no device
      // binding yet — push it to the pairing screen instead of the admin panel.
      const binding = localStorage.getItem('elderwatch_device_binding');
      if (!binding) {
        window.history.replaceState({}, '', '/link');
        setCurrentRoute('link');
      }
  }

    return () => unsubscribe();
  }, []);  // eslint-disable-linereact-hooks/exhaustive-deps

  // Handle PWA mode - ensure saved URL is restored ONLY if binding is still valid
  useEffect(() => {
    if (isPWA && bindingVerified) {
      const savedUrl = localStorage.getItem('ew_pwa_checkin_url');
      const hasBinding = !!localStorage.getItem('elderwatch_device_binding');
      if (savedUrl && hasBinding && window.location.pathname === '/') {
        console.log('[ElderWatch] PWA mode - restoring URL:', savedUrl);
        window.history.replaceState({}, '', savedUrl);
        const match = savedUrl.match(/^\/checkin\/(.+)$/);
        if (match) {
          setPermanentResidentId(match[1]);
          setCurrentRoute('checkin');
        }
      }
    }
  }, [isPWA, bindingVerified]);

  // Listen for browser URL back/forward
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
        // Save for PWA restore
        localStorage.setItem('ew_pwa_checkin_url', path);
      } else if (path === '/admin') {
        // /admin is staff-only — show login or admin panel depending on session
        setCurrentRoute('admin');
      } else {
        // Any other path (including '/'): resident flow.
        // Check device binding — if bound, go to check-in; otherwise pairing screen.
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
          } catch { /* ignore corrupt binding */ }
        }
        setCurrentRoute('link');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
    // Use sessionStorage so each browser tab has its own independent session.
    // This allows multiple users to be signed in simultaneously in different tabs.
    // Each tab's Firebase Auth instance is isolated via inMemoryPersistence.
    sessionStorage.setItem(
      'elderwatch_staff_auth',
      JSON.stringify({ token, user, home })
    );
  };

  const handleLogout = async () => {
    // Sign out from THIS tab's Firebase Auth (in-memory only, doesn't affect other tabs)
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
    setPermanentResidentId(binding.residentId);
    setCurrentRoute('checkin');
  };

  const [isNight] = useAppTheme();

  // While binding is being verified against the server, render nothing.
  // This prevents a flash of the check-in screen for devices whose
  // pairing code was rotated by staff.
  if (!bindingVerified) return null;

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
      {/* Offline sync indicator */}
      <OfflineIndicator />

      {/* ROUTE 1: RESIDENT CHECK-IN SCREEN */}
      {currentRoute === 'checkin' && (
        <ResidentCheckInScreen
          onNavigateToAdmin={() => navigate('admin')}
          onNavigateToLink={(code) => navigate('link', code)}
          permanentResidentId={permanentResidentId}
        />
      )}

      {/* ROUTE 2: DEVICE LINK SCREEN */}
      {currentRoute === 'link' && (
        <DeviceLinkScreen
          initialCode={linkCodeParam}
          onLinkedSuccess={handleLinkedSuccess}
          onCancel={() => navigate('admin')}
        />
      )}

      {/* ROUTE 3: STAFF PORTAL (Admin Panel or Login) */}
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
