import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Users,
  UserCheck,
  Plus,
  RefreshCw,
  Trash2,
  Clock,
  Shield,
  Key,
  Smartphone,
  Phone,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Filter,
  Eye,
  EyeOff,
  Activity,
  Search,
} from 'lucide-react';
import { AdminOverview, Home } from '../types';
import { useAppTheme } from './ThemeToggle';
import {
  fetchAdminOverview,
  addHome as apiAddHome,
  deleteHome as apiDeleteHome,
  addStaff as apiAddStaff,
  deleteStaff as apiDeleteStaff,
  addResident as apiAddResident,
  deleteResident as apiDeleteResident,
} from '../lib/firebase-api';

interface AdminOverviewViewProps {
  token: string;
  onSelectHome: (home: Home) => void;
  activeHomeId: string;
}

export const AdminOverviewView: React.FC<AdminOverviewViewProps> = ({
  token,
  onSelectHome,
  activeHomeId,
}) => {
  const [isNight] = useAppTheme();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'homes' | 'staff' | 'residents'>('homes');

  // Filters
  const [selectedHomeFilter, setSelectedHomeFilter] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState('');

  // Password visibility map for staff list
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  // Modals
  const [isAddHomeOpen, setIsAddHomeOpen] = useState(false);
  const [newHomeName, setNewHomeName] = useState('');
  const [newHomeCutoff, setNewHomeCutoff] = useState('09:15');

  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'admin' | 'home_admin'>('home_admin');
  const [newStaffHomeId, setNewStaffHomeId] = useState('');

  const [isAddResidentOpen, setIsAddResidentOpen] = useState(false);
  const [newResName, setNewResName] = useState('');
  const [newResRoom, setNewResRoom] = useState('');
  const [newResUnit, setNewResUnit] = useState('');
  const [newResHomeId, setNewResHomeId] = useState('');
  const [newResPhone, setNewResPhone] = useState('');
  const [newResContact, setNewResContact] = useState('');
  const [newResNotes, setNewResNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json: AdminOverview = await fetchAdminOverview();
      setData(json);
      if (json.homes.length > 0 && !newStaffHomeId) {
        setNewStaffHomeId(json.homes[0].id);
        setNewResHomeId(json.homes[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching overview');
    } finally {
      setLoading(false);
    }
  }, [newStaffHomeId]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const showNotification = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  // Add Home
  const handleAddHome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHomeName.trim()) return;
    setSubmitting(true);
    try {
      const home = await apiAddHome(newHomeName.trim(), newHomeCutoff.trim() || '09:15');
      setIsAddHomeOpen(false);
      setNewHomeName('');
      showNotification(`Care home "${home.name}" created successfully.`);
      await fetchOverview();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to add home');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Home
  const handleDeleteHome = async (homeId: string, homeName: string) => {
    if (!confirm(`Are you sure you want to delete "${homeName}"? Staff and residents will become Unassigned.`)) return;
    try {
      await apiDeleteHome(homeId);
      // Reset filter if it was set to the deleted home
      if (selectedHomeFilter === homeId) {
        setSelectedHomeFilter('all');
      }
      showNotification(`Home "${homeName}" deleted.`);
      await fetchOverview();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not delete home');
    }
  };

  // Add Staff
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffName || !newStaffEmail || !newStaffPassword || !newStaffHomeId) return;
    setSubmitting(true);
    try {
      await apiAddStaff(newStaffName.trim(), newStaffEmail.trim(), newStaffPassword.trim(), newStaffRole, newStaffHomeId);
      setIsAddStaffOpen(false);
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
      showNotification(`Staff member "${newStaffName}" assigned successfully.`);
      await fetchOverview();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to add staff');
    } finally {
      setSubmitting(false);
    }
  };

  // Quick Reassign Staff
  const handleReassignStaff = async (staffId: string, staffName: string, targetHomeId: string) => {
    try {
      const { updateStaff } = await import('../lib/firebase-api');
      await updateStaff(staffId, { homeId: targetHomeId });
      showNotification(`Staff member "${staffName}" reassigned.`);
      await fetchOverview();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to reassign staff');
    }
  };

  // Reset Staff Password
  const handleResetPassword = async (staffId: string, staffName: string) => {
    const newPassword = prompt(`Enter new password for ${staffName}:`);
    if (!newPassword) return;
    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(`Password updated for "${staffName}".`);
        await fetchOverview();
      } else {
        alert(data.error || 'Failed to reset password');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to reset password');
    }
  };

  // Delete Staff
  const handleDeleteStaff = async (staffId: string, staffName: string) => {
    if (!confirm(`Are you sure you want to remove staff member "${staffName}"?`)) return;
    try {
      await apiDeleteStaff(staffId);
      showNotification(`Staff member "${staffName}" removed.`);
      await fetchOverview();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not remove staff');
    }
  };

  // Add Resident
  const handleAddResident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResName || !newResRoom || !newResHomeId) return;
    setSubmitting(true);
    try {
      await apiAddResident(
        newResHomeId,
        newResName.trim(),
        newResRoom.trim(),
        newResPhone.trim(),
        newResContact.trim(),
        newResNotes.trim(),
        newResUnit.trim() || undefined
      );
      setIsAddResidentOpen(false);
      setNewResName('');
      setNewResRoom('');
      setNewResUnit('');
      setNewResPhone('');
      setNewResContact('');
      setNewResNotes('');
      showNotification(`Resident "${newResName}" enrolled.`);
      await fetchOverview();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to enroll resident');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Resident
  const handleDeleteResident = async (resId: string, resName: string) => {
    if (!confirm(`Are you sure you want to delete resident record for "${resName}"?`)) return;
    try {
      await apiDeleteResident(resId);
      showNotification(`Resident "${resName}" deleted.`);
      await fetchOverview();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete resident');
    }
  };

  // Filtered lists
  const filteredStaff = (data?.staff || []).filter((s) => {
    const matchesHome = selectedHomeFilter === 'all' || s.homeId === selectedHomeFilter;
    const matchesQuery =
      !searchFilter ||
      s.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      s.email.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (s.homeName && s.homeName.toLowerCase().includes(searchFilter.toLowerCase()));
    return matchesHome && matchesQuery;
  });

  const filteredResidents = (data?.residents || []).filter((r) => {
    const matchesHome = selectedHomeFilter === 'all' || r.homeId === selectedHomeFilter;
    const matchesQuery =
      !searchFilter ||
      r.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      r.roomNumber.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (r.homeName && r.homeName.toLowerCase().includes(searchFilter.toLowerCase()));
    return matchesHome && matchesQuery;
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {actionFeedback && (
        <div className="p-3.5 bg-emerald-600 text-white rounded-2xl text-xs font-bold flex items-center gap-2 shadow-xl animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Top Banner & Primary Admin Actions */}
      <div
        className={`p-6 rounded-3xl border shadow-sm transition-colors ${
          isNight
            ? 'bg-slate-900/80 border-slate-800'
            : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-purple-500/20 text-purple-400">
                <Shield className="w-5 h-5" />
              </span>
              <h2 className={`text-xl font-black tracking-tight ${isNight ? 'text-white' : 'text-slate-900'}`}>
                Enterprise Administrator Control
              </h2>
            </div>
            <p className={`text-xs mt-1 ${isNight ? 'text-slate-400' : 'text-slate-600'}`}>
              Logged in as <strong className={isNight ? 'text-white' : 'text-slate-900'}>Shaun Gordon</strong> (shaunwgordon@gmail.com) &bull; Full multi-tenant governance across all homes, staff accounts, and residents.
            </p>
          </div>

          {/* 3 Prominent High-Impact Actions Always Visible */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setIsAddHomeOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white text-xs font-bold flex items-center gap-2 transition shadow-md shadow-emerald-950/30 cursor-pointer"
            >
              <Building2 className="w-4 h-4" />
              <span>+ Create Village</span>
            </button>

            <button
              onClick={() => {
                if (data?.homes?.length) setNewStaffHomeId(data.homes[0].id);
                setIsAddStaffOpen(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white text-xs font-bold flex items-center gap-2 transition shadow-md shadow-indigo-950/30 cursor-pointer"
            >
              <Users className="w-4 h-4" />
              <span>+ Create Staff & Assign</span>
            </button>

            <button
              onClick={() => {
                if (data?.homes?.length) setNewResHomeId(data.homes[0].id);
                setIsAddResidentOpen(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-98 text-white text-xs font-bold flex items-center gap-2 transition shadow-md shadow-amber-950/30 cursor-pointer"
            >
              <UserCheck className="w-4 h-4" />
              <span>+ Enroll Resident</span>
            </button>

            <button
              onClick={fetchOverview}
              disabled={loading}
              title="Refresh overview data"
              className={`p-2.5 rounded-xl border transition cursor-pointer ${
                isNight
                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          onClick={() => setActiveSection('homes')}
          className={`p-5 rounded-2xl border transition cursor-pointer ${
            activeSection === 'homes'
              ? isNight
                ? 'bg-emerald-950/40 border-emerald-500/60 ring-1 ring-emerald-500/30'
                : 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-300'
              : isNight
              ? 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-400' : 'text-slate-600'}`}>
              Villages
            </span>
            <Building2 className="w-5 h-5 text-emerald-500" />
          </div>
          <div className={`text-3xl font-black mt-2 ${isNight ? 'text-white' : 'text-slate-900'}`}>
            {loading ? '...' : data?.stats.totalHomes ?? 0}
          </div>
          <div className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
            Registered facilities with distinct morning cutoffs
          </div>
        </div>

        <div
          onClick={() => setActiveSection('staff')}
          className={`p-5 rounded-2xl border transition cursor-pointer ${
            activeSection === 'staff'
              ? isNight
                ? 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500/30'
                : 'bg-indigo-50 border-indigo-400 ring-1 ring-indigo-300'
              : isNight
              ? 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-400' : 'text-slate-600'}`}>
              Assigned Staff
            </span>
            <Users className="w-5 h-5 text-indigo-500" />
          </div>
          <div className={`text-3xl font-black mt-2 ${isNight ? 'text-white' : 'text-slate-900'}`}>
            {loading ? '...' : data?.stats.totalStaff ?? 0}
          </div>
          <div className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
            Nurses, caregivers & administrators
          </div>
        </div>

        <div
          onClick={() => setActiveSection('residents')}
          className={`p-5 rounded-2xl border transition cursor-pointer ${
            activeSection === 'residents'
              ? isNight
                ? 'bg-amber-950/40 border-amber-500/60 ring-1 ring-amber-500/30'
                : 'bg-amber-50 border-amber-400 ring-1 ring-amber-300'
              : isNight
              ? 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold uppercase tracking-wider ${isNight ? 'text-slate-400' : 'text-slate-600'}`}>
              Residents Enrolled
            </span>
            <UserCheck className="w-5 h-5 text-amber-500" />
          </div>
          <div className={`text-3xl font-black mt-2 ${isNight ? 'text-white' : 'text-slate-900'}`}>
            {loading ? '...' : data?.stats.totalResidents ?? 0}
          </div>
          <div className={`text-[11px] mt-1 ${isNight ? 'text-slate-400' : 'text-slate-500'}`}>
            Frailcare residents monitored across all facilities
          </div>
        </div>
      </div>

      {/* Section Sub-Navigation Tabs */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b pb-3 ${
          isNight ? 'border-slate-800' : 'border-slate-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSection('homes')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSection === 'homes'
                ? 'bg-emerald-600 text-white shadow-sm'
                : isNight
                ? 'bg-slate-900 text-slate-400 hover:text-slate-200'
                : 'bg-slate-100 text-slate-700 hover:text-slate-900'
            }`}
          >
            1. All Villages ({data?.homes.length || 0})
          </button>

          <button
            onClick={() => setActiveSection('staff')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSection === 'staff'
                ? 'bg-indigo-600 text-white shadow-sm'
                : isNight
                ? 'bg-slate-900 text-slate-400 hover:text-slate-200'
                : 'bg-slate-100 text-slate-700 hover:text-slate-900'
            }`}
          >
            2. Staff Assigned to Homes ({data?.staff.length || 0})
          </button>

          <button
            onClick={() => setActiveSection('residents')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSection === 'residents'
                ? 'bg-amber-600 text-white shadow-sm'
                : isNight
                ? 'bg-slate-900 text-slate-400 hover:text-slate-200'
                : 'bg-slate-100 text-slate-700 hover:text-slate-900'
            }`}
          >
            3. Residents per Home ({data?.residents.length || 0})
          </button>
        </div>

        {/* Action Button tailored to active section */}
        <div>
          {activeSection === 'homes' && (
            <button
              onClick={() => setIsAddHomeOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Home</span>
            </button>
          )}
          {activeSection === 'staff' && (
            <button
              onClick={() => {
                if (data?.homes?.length) setNewStaffHomeId(data.homes[0].id);
                setIsAddStaffOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Staff User</span>
            </button>
          )}
          {activeSection === 'residents' && (
            <button
              onClick={() => {
                if (data?.homes?.length) setNewResHomeId(data.homes[0].id);
                setIsAddResidentOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Enroll Resident</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Home Filter Bar (for staff and residents) */}
      {activeSection !== 'homes' && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl border transition-colors ${
            isNight
              ? 'bg-slate-900/60 border-slate-800'
              : 'bg-white border-slate-200 shadow-xs'
          }`}
        >
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className={`text-xs font-bold ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
              Filter by Home:
            </span>
            <select
              value={selectedHomeFilter}
              onChange={(e) => setSelectedHomeFilter(e.target.value)}
              className={`text-xs rounded-xl px-3 py-1.5 border focus:outline-hidden font-medium cursor-pointer ${
                isNight
                  ? 'bg-slate-800 border-slate-700 text-white'
                  : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            >
              <option value="all">All Villages ({data?.homes.length || 0})</option>
              {(data?.homes || []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-64 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder={`Search ${activeSection}...`}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className={`w-full text-xs rounded-xl pl-8 pr-3 py-2 border focus:outline-hidden ${
                isNight
                  ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-500'
                  : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
              }`}
            />
          </div>
        </div>
      )}

      {/* SECTION 1: ALL CARE HOMES */}
      {activeSection === 'homes' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(data?.homes || []).map((h) => {
              const isActive = h.id === activeHomeId;
              return (
                <div
                  key={h.id}
                  className={`rounded-2xl p-5 border flex flex-col justify-between transition-all ${
                    isActive
                      ? isNight
                        ? 'bg-slate-900/95 border-emerald-500/70 ring-1 ring-emerald-500/40 shadow-lg'
                        : 'bg-white border-emerald-400 ring-1 ring-emerald-300 shadow-md'
                      : isNight
                      ? 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className={`text-lg font-bold ${isNight ? 'text-white' : 'text-slate-900'}`}>
                            {h.name}
                          </h3>
                          {isActive && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500 text-[10px] font-bold border border-emerald-500/30">
                              Active Daily Board
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 font-mono">ID: {h.id}</p>
                      </div>

                      <button
                        onClick={() => handleDeleteHome(h.id, h.name)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                        title="Delete village"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                      <div
                        className={`p-2.5 rounded-xl border ${
                          isNight ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Cutoff Time</span>
                        <span className={`font-semibold flex items-center gap-1 mt-0.5 ${isNight ? 'text-white' : 'text-slate-900'}`}>
                          <Clock className="w-3.5 h-3.5 text-emerald-500" />
                          {h.cutoffTime} SAST
                        </span>
                      </div>
                      <div
                        className={`p-2.5 rounded-xl border ${
                          isNight ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Timezone</span>
                        <span className={`font-semibold mt-0.5 block truncate ${isNight ? 'text-white' : 'text-slate-900'}`}>
                          {h.timezone}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mt-3.5 text-xs">
                      <span className={`flex items-center gap-1 font-medium ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                        <Users className="w-3.5 h-3.5 text-indigo-500" />
                        <strong className={isNight ? 'text-white' : 'text-slate-900'}>{h.staffCount}</strong> staff assigned
                      </span>
                      <span className={`flex items-center gap-1 font-medium ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                        <UserCheck className="w-3.5 h-3.5 text-amber-500" />
                        <strong className={isNight ? 'text-white' : 'text-slate-900'}>{h.residentsCount}</strong> residents enrolled
                      </span>
                    </div>
                  </div>

                  {/* Actions for this village */}
                  <div
                    className={`mt-5 pt-3.5 border-t space-y-2 ${
                      isNight ? 'border-slate-800' : 'border-slate-200'
                    }`}
                  >
                    <button
                      onClick={() => onSelectHome(h)}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs ${
                        isActive
                          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                          : isNight
                          ? 'bg-slate-800 hover:bg-slate-700 text-white'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                      }`}
                    >
                      <Activity className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{isActive ? 'Currently Viewing Live Board' : 'Open Live Daily Board'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <button
                        onClick={() => {
                          setNewStaffHomeId(h.id);
                          setIsAddStaffOpen(true);
                        }}
                        className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                          isNight
                            ? 'border-indigo-900/60 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-950/70'
                            : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        }`}
                      >
                        <Plus className="w-3 h-3 text-indigo-500" />
                        <span>+ Add Staff</span>
                      </button>

                      <button
                        onClick={() => {
                          setNewResHomeId(h.id);
                          setIsAddResidentOpen(true);
                        }}
                        className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                          isNight
                            ? 'border-amber-900/60 bg-amber-950/40 text-amber-300 hover:bg-amber-950/70'
                            : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                        }`}
                      >
                        <Plus className="w-3 h-3 text-amber-500" />
                        <span>+ Add Resident</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 2: STAFF ASSIGNED TO HOMES */}
      {activeSection === 'staff' && (
        <div className="space-y-4">
          <div
            className={`rounded-2xl border overflow-hidden transition-colors ${
              isNight
                ? 'bg-slate-900/80 border-slate-800'
                : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead
                  className={`text-[11px] font-bold uppercase tracking-wider border-b ${
                    isNight
                      ? 'bg-slate-950/80 text-slate-400 border-slate-800'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  <tr>
                    <th className="p-4">Staff Member</th>
                    <th className="p-4">Assigned Village (Quick Reassign)</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Email / Login</th>
                    <th className="p-4">Password</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isNight ? 'divide-slate-800/60' : 'divide-slate-100'}`}>
                  {filteredStaff.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No staff members match the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredStaff.map((s) => {
                      const isRevealed = !!showPasswords[s.id];
                      return (
                        <tr
                          key={s.id}
                          className={`transition ${
                            isNight ? 'hover:bg-slate-800/40 text-slate-300' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <td className="p-4">
                            <div className={`font-bold text-sm ${isNight ? 'text-white' : 'text-slate-900'}`}>
                              {s.name}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">ID: {s.id}</div>
                          </td>

                          <td className="p-4">
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <select
                                value={s.homeId}
                                onChange={(e) => handleReassignStaff(s.id, s.name, e.target.value)}
                                className={`text-xs font-semibold py-1 px-2 rounded-lg border focus:outline-hidden cursor-pointer ${
                                  isNight
                                    ? 'bg-slate-800 border-slate-700 text-white'
                                    : 'bg-slate-50 border-slate-300 text-slate-900'
                                }`}
                              >
                                {(data?.homes || []).map((h) => (
                                  <option key={h.id} value={h.id}>
                                    {h.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>

                          <td className="p-4">
                            <span
                              className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase tracking-wider ${
                                s.role === 'admin'
                                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              }`}
                            >
                              {s.role === 'admin' ? 'Administrator' : 'Home Admin'}
                            </span>
                          </td>

                          <td className="p-4 font-mono text-xs">{s.email}</td>

                          <td className="p-4 font-mono text-xs">
                            <div className="flex items-center gap-1.5">
                              <span>{isRevealed ? s.password || '••••••••' : '••••••••'}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setShowPasswords((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                                }
                                className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                                title={isRevealed ? 'Hide password' : 'Show password'}
                              >
                                {isRevealed ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>

                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleResetPassword(s.id, s.name)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition cursor-pointer"
                                title="Reset password"
                              >
                                <Key className="w-3.5 h-3.5" />
                              </button>
                              {s.email !== 'shaunwgordon@gmail.com' ? (
                                <button
                                  onClick={() => handleDeleteStaff(s.id, s.name)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                                  title="Remove staff member"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              ) : (
                                <span className="text-[10px] text-purple-400 font-bold">Primary Admin</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: RESIDENTS PER HOME */}
      {activeSection === 'residents' && (
        <div className="space-y-4">
          <div
            className={`rounded-2xl border overflow-hidden transition-colors ${
              isNight
                ? 'bg-slate-900/80 border-slate-800'
                : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead
                  className={`text-[11px] font-bold uppercase tracking-wider border-b ${
                    isNight
                      ? 'bg-slate-950/80 text-slate-400 border-slate-800'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  <tr>
                    <th className="p-4">Resident</th>
                    <th className="p-4">Room #</th>
                    <th className="p-4">Village</th>
                    <th className="p-4">Today Status</th>
                    <th className="p-4">Emergency Contact</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isNight ? 'divide-slate-800/60' : 'divide-slate-100'}`}>
                  {filteredResidents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No residents enrolled yet for this view.
                      </td>
                    </tr>
                  ) : (
                    filteredResidents.map((r) => (
                      <tr
                        key={r.id}
                        className={`transition ${
                          isNight ? 'hover:bg-slate-800/40 text-slate-300' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <td className="p-4">
                          <div className={`font-bold text-sm ${isNight ? 'text-white' : 'text-slate-900'}`}>
                            {r.name}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">ID: {r.id}</div>
                        </td>

                        <td className="p-4">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold font-mono text-xs ${
                              isNight ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            Room {r.roomNumber}{r.unitNumber ? ` / ${r.unitNumber}` : ''}
                          </span>
                        </td>

                        <td className="p-4 font-semibold text-emerald-500">
                          {r.homeName || 'Village'}
                        </td>

                        <td className="p-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase ${
                              r.todayStatus === 'ok'
                                ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                                : r.todayStatus === 'not_ok'
                                ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30'
                                : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                            }`}
                          >
                            {r.todayStatus || 'Awaiting Check-in'}
                          </span>
                        </td>

                        <td className="p-4 text-slate-400 text-xs truncate max-w-xs">
                          {r.emergencyContact || '—'}
                        </td>

                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleDeleteResident(r.id, r.name)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                            title="Delete resident"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE CARE HOME */}
      {isAddHomeOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 transition-colors ${
              isNight ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <h3 className={`text-lg font-bold flex items-center gap-2 ${isNight ? 'text-white' : 'text-slate-900'}`}>
              <Building2 className="w-5 h-5 text-emerald-500" />
              <span>Create New Village</span>
            </h3>
            <form onSubmit={handleAddHome} className="space-y-3.5 text-xs">
              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Village Facility Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Methodist Home 2"
                  value={newHomeName}
                  onChange={(e) => setNewHomeName(e.target.value)}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                  }`}
                />
              </div>

              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Daily Morning Attendance Cutoff Time (SAST)
                </label>
                <input
                  type="time"
                  required
                  value={newHomeCutoff}
                  onChange={(e) => setNewHomeCutoff(e.target.value)}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                  }`}
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Residents who do not tap "I'm OK" by this cutoff time trigger staff attendance alarms.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddHomeOpen(false)}
                  className={`px-4 py-2 rounded-xl cursor-pointer font-bold ${
                    isNight ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer transition shadow-sm"
                >
                  {submitting ? 'Creating...' : 'Create Village'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CREATE STAFF & ASSIGN TO HOME */}
      {isAddStaffOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 transition-colors ${
              isNight ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <h3 className={`text-lg font-bold flex items-center gap-2 ${isNight ? 'text-white' : 'text-slate-900'}`}>
              <Users className="w-5 h-5 text-indigo-500" />
              <span>Create Staff User & Assign Home</span>
            </h3>
            <form onSubmit={handleAddStaff} className="space-y-3.5 text-xs">
              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Assign to Village
                </label>
                <select
                  value={newStaffHomeId}
                  onChange={(e) => setNewStaffHomeId(e.target.value)}
                  required
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  {(data?.homes || []).map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} (ID: {h.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Staff Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sister Grace"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-indigo-600'
                  }`}
                />
              </div>

              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Email Address / Username (For Login)
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. grace@methodist.care"
                  value={newStaffEmail}
                  onChange={(e) => setNewStaffEmail(e.target.value)}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-indigo-600'
                  }`}
                />
              </div>

              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Password (For Login)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Grace123@!"
                  value={newStaffPassword}
                  onChange={(e) => setNewStaffPassword(e.target.value)}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-indigo-600'
                  }`}
                />
                <p className="text-[10px] text-slate-500 mt-0.5">The user will sign in with this email and password.</p>
              </div>

              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Role
                </label>
                <select
                  value={newStaffRole}
                  onChange={(e) => setNewStaffRole(e.target.value as 'admin' | 'home_admin')}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  <option value="home_admin">Home Administrator (Sees Assigned Home Only)</option>
                  <option value="admin">Administrator (Sees All Homes & Overview)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddStaffOpen(false)}
                  className={`px-4 py-2 rounded-xl cursor-pointer font-bold ${
                    isNight ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer transition shadow-sm"
                >
                  {submitting ? 'Creating Staff...' : 'Create Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ENROLL RESIDENT */}
      {isAddResidentOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 transition-colors ${
              isNight ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <h3 className={`text-lg font-bold flex items-center gap-2 ${isNight ? 'text-white' : 'text-slate-900'}`}>
              <UserCheck className="w-5 h-5 text-amber-500" />
              <span>Enroll Resident in Village</span>
            </h3>
            <form onSubmit={handleAddResident} className="space-y-3.5 text-xs">
              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Select Village
                </label>
                <select
                  value={newResHomeId}
                  onChange={(e) => setNewResHomeId(e.target.value)}
                  required
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  {(data?.homes || []).map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                    Resident Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Full name"
                    value={newResName}
                    onChange={(e) => setNewResName(e.target.value)}
                    className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                      isNight
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                    Room Number
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Room 14"
                    value={newResRoom}
                    onChange={(e) => setNewResRoom(e.target.value)}
                    className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                      isNight
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                    Unit Number (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Unit A"
                    value={newResUnit || ''}
                    onChange={(e) => setNewResUnit(e.target.value)}
                    className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                      isNight
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Phone Number (Optional)
                </label>
                <input
                  type="text"
                  placeholder="+27 82 123 4567"
                  value={newResPhone}
                  onChange={(e) => setNewResPhone(e.target.value)}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Emergency Contact & Next of Kin
                </label>
                <input
                  type="text"
                  placeholder="e.g. Daughter: Claire (+27 82 555 4321)"
                  value={newResContact}
                  onChange={(e) => setNewResContact(e.target.value)}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className={`block font-bold mb-1 ${isNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Medical & Mobility Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Mobility aid, hearing assistance, morning routine notes"
                  value={newResNotes}
                  onChange={(e) => setNewResNotes(e.target.value)}
                  className={`w-full rounded-xl p-2.5 text-sm border focus:outline-hidden ${
                    isNight
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddResidentOpen(false)}
                  className={`px-4 py-2 rounded-xl cursor-pointer font-bold ${
                    isNight ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold cursor-pointer transition shadow-sm"
                >
                  {submitting ? 'Enrolling...' : 'Enroll Resident'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
