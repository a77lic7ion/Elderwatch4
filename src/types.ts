export type CheckInStatus = 'awaiting' | 'ok' | 'not_ok' | 'no_response';

export interface Home {
  id: string;
  name: string;
  cutoffTime: string; // e.g. "09:15" (SAST)
  timezone: string;   // "Africa/Johannesburg" (SAST, UTC+2)
  createdAt: string;
}

export interface StaffUser {
  id: string;
  homeId: string;
  name: string;
  email: string;
  role: 'admin' | 'home_admin';
}

export interface Resident {
  id: string;
  homeId: string;
  name: string;
  phone: string;
  roomNumber: string;
  unitNumber?: string;
  isDeviceLinked: boolean;
  linkedAt: string | null;
  oneTimeLinkCode: string | null;
  linkCodeGeneratedAt?: string | null;
  pushToken?: string | null;
  pushSubscription?: {
    endpoint: string;
    keys: { p256dh?: string; auth?: string };
    userAgent?: string;
    enabledAt?: string;
  } | null;
  reminderEnabledAt?: string | null;
  reminderTimeSAST?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactNumber?: string;
  notes?: string;
  createdAt: string;
  language?: string;
  isAway?: boolean;
  awayStartDate?: string | null;
  awayEndDate?: string | null;
  awayNote?: string;
}

export interface CheckIn {
  id: string;
  homeId: string;
  residentId: string;
  date: string; // YYYY-MM-DD
  status: CheckInStatus;
  timestamp: string; // ISO string
  offlineSynced?: boolean;
  updatedBy: 'resident' | 'staff_override' | 'cutoff_job' | 'morning_job' | 'auto_away';
  notes?: string;
}

export interface ResidentTodayView extends Resident {
  todayStatus: CheckInStatus;
  todayTimestamp: string | null;
  todayUpdatedBy: string | null;
}

export interface JobExecutionLog {
  id: string;
  homeId: string;
  jobType: 'morning_reset' | 'reminder_push' | 'cutoff_sweep' | 'emergency_alert';
  description: string;
  residentsAffected: number;
  timestamp: string;
  details?: string;
}

export interface PushNotificationRecord {
  id: string;
  homeId: string;
  targetType: 'resident' | 'staff' | 'all_awaiting';
  recipientName: string;
  title: string;
  body: string;
  timestamp: string;
  status: 'delivered' | 'queued' | 'simulated';
}

export interface DeviceBinding {
  residentId: string;
  homeId: string;
  residentName: string;
  roomNumber: string;
  unitNumber?: string;
  homeName?: string;
  linkedAt: string;
}

export interface StaffWithHome extends StaffUser {
  homeName?: string;
  password?: string;
}

export interface ResidentWithHome extends Resident {
  homeName?: string;
  todayStatus?: CheckInStatus;
}

export interface AdminOverview {
  homes: Array<Home & { staffCount: number; residentsCount: number }>;
  staff: StaffWithHome[];
  residents: ResidentWithHome[];
  stats: {
    totalHomes: number;
    totalStaff: number;
    totalResidents: number;
  };
}
