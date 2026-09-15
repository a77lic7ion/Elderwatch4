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
      
      // PWA launch: check if we have a saved resident check-in URL
      const savedResidentUrl = localStorage.getItem('ew_pwa_checkin_url');
      if (savedResidentUrl) {
        // In PWA mode, always restore the saved URL
        if (isPWA || window.location.pathname === '/') {
          window.history.replaceState({}, '', savedResidentUrl);
          return 'checkin';
        }
      }
    }
    return 'admin';
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

  // Restore staff session if present (sessionStorage = per-tab sessions)
  // Each browser tab has its own isolated Firebase Auth instance (inMemoryPersistence)
  // so multiple users can be signed in simultaneously in different tabs.
  useEffect(() => {
    // On mount, restore from sessionStorage if present
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
        // No user in this tab's in-memory auth — clear this tab's session
        setStaffToken(null);
        setStaffUser(null);
        setStaffHome(null);
        sessionStorage.removeItem('elderwatch_staff_auth');
      }
    });

    return () => unsubscribe();
  }, []);

  // Handle PWA mode - ensure saved URL is restored
  useEffect(() => {
    if (isPWA) {
      const savedUrl = localStorage.getItem('ew_pwa_checkin_url');
      if (savedUrl && window.location.pathname === '/') {
        console.log('[ElderWatch] PWA mode - restoring URL:', savedUrl);
        window.history.replaceState({}, '', savedUrl);
        const match = savedUrl.match(/^\/checkin\/(.+)$/);
        if (match) {
          setPermanentResidentId(match[1]);
          setCurrentRoute('checkin');
        }
      }
    }
  }, [isPWA]);

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
      } else {
        setCurrentRoute('admin');
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
    navigate('checkin');
  };

  const handleSimulateDeviceBind = (code: string) => {
    navigate('link', code);
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
              onSimulateDeviceBind={handleSimulateDeviceBind}
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
