
export enum UserRole {
  ADMIN = 'admin',
  EMPLOYEE = 'employee'
}

export interface User {
  id: string; // Username (e.g. 'admin')
  uid?: string; // Firebase Auth UID (Critical for Security Rules)
  pass: string;
  name: string;
  role: UserRole;
  dept: string;
  deleted?: boolean;
  onboard_date?: string;
  quota_annual: number;
  quota_birthday: number;
  quota_comp: number;
}

export interface AttendanceRecord {
  id: number;
  userId: string; // "john"
  uid?: string;   // "firebase_auth_uid_123" (Security Check)
  userName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  type: 'in' | 'out';
  status: string;
  lat: number;
  lng: number;
  dist: number;
  photo?: string; // Base64 string of the selfie
}

export interface LeaveRequest {
  id: number;
  userId: string;
  uid?: string; // Security Check
  userName: string;
  type: string;
  start: string; // YYYY-MM-DD HH:mm
  end: string;
  hours: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejectReason?: string;
  created_at: string;
}

export interface OvertimeRequest {
  id: number;
  userId: string;
  uid?: string; // Security Check
  userName: string;
  start: string;
  end: string;
  hours: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejectReason?: string;
  adminNote?: string; // Reason for admin modification
  created_at: string;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  category: 'general' | 'urgent' | 'system';
  date: string;
  author: string;
}

export interface Holiday {
  id: number;
  date: string;
  note: string;
}

export interface AppSettings {
  gasUrl: string;
  companyLat: number;
  companyLng: number;
  allowedRadius: number;
}
