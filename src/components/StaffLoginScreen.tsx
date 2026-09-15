import React, { useState } from 'react';
import { Shield, Lock, Mail, AlertCircle, HelpCircle } from 'lucide-react';
import { StaffUser, Home } from '../types';
import { ThemeToggle, useAppTheme } from './ThemeToggle';
import { LegalFooter } from './LegalFooter';
import { loginWithEmail, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

interface StaffLoginScreenProps {
  onLoginSuccess: (token: string, user: StaffUser, home: Home) => void;
}

export const StaffLoginScreen: React.FC<StaffLoginScreenProps> = ({
  onLoginSuccess,
}) => {
  const [isNight] = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Try server auth first (local dev with server.ts)
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        const user: StaffUser = {
          id: data.user.id,
          homeId: data.user.homeId,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
        };
        const home: Home = data.home ? {
          id: data.home.id,
          name: data.home.name,
          cutoffTime: data.home.cutoffTime,
          timezone: data.home.timezone,
          createdAt: data.home.createdAt || new Date().toISOString(),
        } : {
          id: data.user.homeId,
          name: 'Village',
          cutoffTime: '09:15',
          timezone: 'Africa/Johannesburg',
          createdAt: new Date().toISOString(),
        };
        onLoginSuccess(data.token, user, home);
        return;
      }

      // Server auth failed — fall back to Firebase Auth (Vercel / production)
      const userCredential = await loginWithEmail(email.trim(), password.trim());
      const firebaseUser = userCredential.user;
      const token = await firebaseUser.getIdToken();

      const staffDoc = await getDoc(doc(db, 'staff', firebaseUser.uid));
      if (!staffDoc.exists()) {
        setError('Staff account not found. Please contact administrator.');
        setLoading(false);
        return;
      }

      const staffData = staffDoc.data();
      const homeDoc = await getDoc(doc(db, 'homes', staffData.homeId));
      const homeData = homeDoc.exists() ? homeDoc.data() : null;

      const user: StaffUser = {
        id: firebaseUser.uid,
        homeId: staffData.homeId,
        name: staffData.name,
        email: staffData.email,
        role: staffData.role,
      };

      const home: Home = homeData ? {
        id: homeDoc.id,
        name: homeData.name,
        cutoffTime: homeData.cutoffTime,
        timezone: homeData.timezone,
        createdAt: homeData.createdAt || new Date().toISOString(),
      } : {
        id: staffData.homeId,
        name: 'Village',
        cutoffTime: '09:15',
        timezone: 'Africa/Johannesburg',
        createdAt: new Date().toISOString(),
      };

      onLoginSuccess(token, user, home);
    } catch (err: any) {
      console.error('Login error:', err);
      if (err.code === 'auth/user-not-found') {
        setError('No account found with this email.');
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect password.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many failed attempts. Please try again later.');
      } else {
        setError('Login failed. Please check your credentials.');
      }
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    const userEmail = email || 'my email';
    const message = `Hi Shaun, please can you reset my password for ElderWatch. My login email is: ${userEmail}`;
    const whatsappUrl = `https://wa.me/27713162849?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div
      className={`min-h-screen flex flex-col justify-between p-6 sm:p-10 transition-colors duration-200 ${
        isNight ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/elderwatch-logo.png"
            alt="ElderWatch Logo"
            className="w-12 h-12 rounded-full shadow-lg"
          />
          <div>
            <h1 className={`text-xl font-bold tracking-tight ${isNight ? 'text-white' : 'text-slate-900'}`}>
              ElderWatch
            </h1>
            <p className={`text-xs ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
              Old-Age & Frailcare Wellness Protection
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </div>

      {/* Main Login Card */}
      <div className="max-w-md mx-auto my-auto w-full space-y-6">
        <div
          className={`rounded-3xl p-6 sm:p-8 border shadow-2xl space-y-6 transition-colors ${
            isNight
              ? 'bg-slate-900 border-slate-800'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex flex-col items-center space-y-3">
            <img
              src="/elderwatch-logo.png"
              alt="ElderWatch"
              className="w-20 h-20 rounded-full shadow-xl"
            />
            <div className="text-center space-y-1">
              <h2 className={`text-2xl font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>
                Staff & Admin Portal
              </h2>
              <p className={`text-xs sm:text-sm ${isNight ? 'text-slate-300' : 'text-slate-600'}`}>
                Sign in to manage villages, assign staff, and monitor live resident check-in statuses.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-rose-300 text-xs bg-rose-950/50 p-3 rounded-xl border border-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className={`block font-bold uppercase tracking-wider mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className={`w-full pl-9 pr-3 py-2.5 rounded-xl border focus:outline-hidden text-sm ${
                    isNight
                      ? 'bg-slate-950 border-slate-700 text-white focus:border-emerald-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                  }`}
                />
              </div>
            </div>

            <div>
              <label className={`block font-bold uppercase tracking-wider mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className={`w-full pl-9 pr-3 py-2.5 rounded-xl border focus:outline-hidden text-sm ${
                    isNight
                      ? 'bg-slate-950 border-slate-700 text-white focus:border-emerald-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                  }`}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 font-bold text-white text-sm shadow-lg shadow-emerald-950/50 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In to Dashboard'}</span>
            </button>
          </form>

          {/* Forgot Password */}
          <div className="text-center">
            <button
              onClick={handleForgotPassword}
              className={`text-xs font-semibold flex items-center justify-center gap-1.5 mx-auto transition cursor-pointer ${
                isNight ? 'text-emerald-400 hover:text-emerald-300' : 'text-emerald-600 hover:text-emerald-700'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Forgot Password?</span>
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={`text-center text-xs flex items-center justify-center gap-2 ${isNight ? 'text-slate-500' : 'text-slate-400'}`}>
        <Shield className="w-4 h-4 text-emerald-500" />
        <span>Multi-Tenant High-Security Frailcare System</span>
      </div>

      <LegalFooter className="pb-2" />
    </div>
  );
};
