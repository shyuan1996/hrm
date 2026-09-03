
export enum UserRole {
  ADMIN = 'admin',
  EMPLOYEE = 'employee'
}

export interface User {
  id: string; // Username (e.g. 'admin')
  uid?: string; // Firebase Auth UID (Critical for Security Rules)
  name: string;
  role: UserRole;
  dept: string;
  deleted?: boolean;
  mustChangePassword?: boolean;
  onboard_date?: string;
  quota_annual: number;
  quota_birthday: number;
  quota_comp: number;
  quotas?: QuotaBucket[];
}

export interface QuotaBucket {
  id: string; // Uniquely identifies this bucket (uuid/timestamp)
  type: string; // '特休' | '補休' | '生日假'
  originalHours: number;
  remainingHours: number;
  addedDate: string; // YYYY-MM-DD
  expireDate: string; // YYYY-MM-DD
  note?: string; 
}

export interface LeaveChangeHistory {
  date: string;
  adminName: string;
  oldType: string;
  newType: string;
  oldHours?: number;
  newHours?: number;
}

export interface AttendanceRecord {
  id: number;
  firestoreId?: string;
  userId: string;
  userName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  type: 'in' | 'out';
  status: string;
  lat: number;
  lng: number;
  dist: number;
  photo?: string; // Base64 string of the selfie
  uid?: string; // Added for robust security rules
  /** Identifies a record entered by an administrator for audit purposes. */
  source?: 'employee' | 'admin';
  createdByUid?: string;
  createdByName?: string;
  createdAt?: { toDate: () => Date } | Date | string; // Trusted Firestore server timestamp for new records
}

export interface LeaveAttachment {
  name: string;
  url: string;
  path: string; // Storage path for deletion reference
}

export interface LeaveRequest {
  id: number;
  userId: string;
  uid?: string; // Added for robust security rules
  userName: string;
  type: string;
  start: string; // YYYY-MM-DD HH:mm
  end: string;
  hours: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejectReason?: string;
  created_at: string;
  /** Firestore/server creation time for stable administrator sorting. */
  createdAt?: { toDate: () => Date } | Date | string;
  attachments?: LeaveAttachment[]; // New field for file uploads
  usedBuckets?: { bucketId: string, hours: number }[];
  changeHistory?: LeaveChangeHistory[];
}

export interface OvertimeRequest {
  id: number;
  userId: string;
  uid?: string; // Added for robust security rules
  userName: string;
  start: string;
  end: string;
  hours: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejectReason?: string;
  adminNote?: string; // Reason for admin modification
  created_at: string;
  /** Firestore/server creation time for stable administrator sorting. */
  createdAt?: { toDate: () => Date } | Date | string;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  category: 'general' | 'urgent' | 'system';
  date: string;
  author: string;
  /** Optional precise creation time; legacy documents only have date. */
  createdAt?: { toDate: () => Date } | Date | string;
}

export interface Holiday {
  id: number;
  date: string;
  note: string;
  /** Optional precise creation time; legacy documents only have date. */
  createdAt?: { toDate: () => Date } | Date | string;
}

export interface AppSettings {
  companyLat: number;
  companyLng: number;
  allowedRadius: number;
}
