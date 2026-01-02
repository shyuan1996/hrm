
import { User, AttendanceRecord, LeaveRequest, OvertimeRequest, Announcement, Holiday, AppSettings, UserRole } from '../types';
import { STORAGE_KEY, DEFAULT_SETTINGS } from '../constants';
import { TimeService } from './timeService';
import { db, auth, createAuthUser } from './firebase'; // Import createAuthUser
import { 
  collection, doc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, 
  onSnapshot, query, orderBy, where, Timestamp, limit 
} from 'firebase/firestore';

export interface AppData {
  users: User[];
  records: AttendanceRecord[];
  leaves: LeaveRequest[];
  overtimes: OvertimeRequest[];
  announcements: Announcement[];
  holidays: Holiday[];
  settings: AppSettings;
}

const getInitialData = (): AppData => ({
  users: [],
  records: [],
  leaves: [],
  overtimes: [],
  announcements: [],
  holidays: [],
  settings: DEFAULT_SETTINGS
});

// Cache for synchronous access (critical for UI responsiveness)
let _memoryCache: AppData = getInitialData();
let _listeners: Function[] = [];

export const StorageService = {
  
  /**
   * 初始化 Firestore 監聽器 (Realtime Sync)
   * 這會自動將後端資料同步到本地記憶體與 LocalStorage
   */
  initRealtimeSync: (userId?: string, role?: string) => {
    // Clear existing listeners
    _listeners.forEach(unsubscribe => unsubscribe());
    _listeners = [];

    // --- Public Data (Announcements, Holidays) ---
    // Assuming Firestore Security Rules allow public read for these
    
    // Announcements Sync
    const annQ = query(collection(db, 'announcements'), orderBy('date', 'desc'));
    _listeners.push(onSnapshot(annQ, (snapshot) => {
        _memoryCache.announcements = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as any));
        StorageService._saveToLocal();
    }, (error) => {
        console.warn("Announcements sync paused (permission/network):", error.code);
    }));

    // Holidays Sync
    const holQ = query(collection(db, 'holidays'));
    _listeners.push(onSnapshot(holQ, (snapshot) => {
        _memoryCache.holidays = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as any));
        StorageService._saveToLocal();
    }, (error) => {
        console.warn("Holidays sync paused (permission/network):", error.code);
    }));

    // --- Protected Data (Users, Settings, Personal Records) ---
    // Only subscribe if we are logged in (userId is provided)
    if (userId) {
        // Users Sync
        const usersQ = query(collection(db, 'users'));
        _listeners.push(onSnapshot(usersQ, (snapshot) => {
            _memoryCache.users = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as User));
            StorageService._saveToLocal();
        }, (error) => console.error("Users sync error:", error.message)));

        // Settings Sync
        _listeners.push(onSnapshot(doc(db, 'system', 'settings'), (docSnap) => {
            if (docSnap.exists()) {
                _memoryCache.settings = { ...DEFAULT_SETTINGS, ...docSnap.data() };
            } else {
                // First run or missing settings
                _memoryCache.settings = DEFAULT_SETTINGS;
                // Only admin usually writes this, but safe to set default in memory
            }
            StorageService._saveToLocal();
        }, (error) => console.error("Settings sync error:", error.message)));

        // Personal Data or Admin Data
        let recordsQ, leavesQ, overtimesQ;

        if (role === 'admin') {
            // Admin sees all (Admin query does not use 'where', so orderBy is safe without composite index)
            recordsQ = query(collection(db, 'records'), orderBy('id', 'desc'), limit(500));
            leavesQ = query(collection(db, 'leaves'), orderBy('id', 'desc'), limit(200));
            overtimesQ = query(collection(db, 'overtimes'), orderBy('id', 'desc'), limit(200));
        } else {
            // Employee sees own
            // FIX: Remove orderBy and limit in Firestore Query to avoid "Missing Index" errors.
            // We will sort the data in memory inside the snapshot callback.
            recordsQ = query(collection(db, 'records'), where('userId', '==', userId));
            leavesQ = query(collection(db, 'leaves'), where('userId', '==', userId));
            overtimesQ = query(collection(db, 'overtimes'), where('userId', '==', userId));
        }

        _listeners.push(onSnapshot(recordsQ, (snapshot) => {
            const list = snapshot.docs.map(d => ({ ...d.data() } as AttendanceRecord));
            if (role !== 'admin') {
                list.sort((a, b) => b.id - a.id); // In-memory sort for employees
            }
            _memoryCache.records = list;
            StorageService._saveToLocal();
        }, (e) => console.warn("Records sync error:", e.code)));

        _listeners.push(onSnapshot(leavesQ, (snapshot) => {
            const list = snapshot.docs.map(d => ({ ...d.data() } as LeaveRequest));
            if (role !== 'admin') {
                list.sort((a, b) => b.id - a.id);
            }
            _memoryCache.leaves = list;
            StorageService._saveToLocal();
        }, (e) => console.warn("Leaves sync error:", e.code)));

        _listeners.push(onSnapshot(overtimesQ, (snapshot) => {
            const list = snapshot.docs.map(d => ({ ...d.data() } as OvertimeRequest));
            if (role !== 'admin') {
                list.sort((a, b) => b.id - a.id);
            }
            _memoryCache.overtimes = list;
            StorageService._saveToLocal();
        }, (e) => console.warn("Overtimes sync error:", e.code)));
    }
  },

  /**
   * 停止所有 Realtime Sync 監聽
   * 用於登出或清理資源時
   */
  stopRealtimeSync: () => {
    _listeners.forEach(unsubscribe => unsubscribe());
    _listeners = [];
  },

  // Helper: Save memory cache to localStorage
  _saveToLocal: () => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_memoryCache));
    } catch (e) {
        console.warn("Failed to save cache to local storage (possibly circular ref or quota exceeded):", e);
    }
    // Trigger a custom event so React components can re-render if they listen to it
    window.dispatchEvent(new Event('storage-update'));
  },

  loadData: (): AppData => {
    // Return memory cache if populated, otherwise try local storage
    if (_memoryCache.users.length > 0) return _memoryCache;
    
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            _memoryCache = { ...getInitialData(), ...JSON.parse(stored) };
        } catch { }
    }
    return _memoryCache;
  },

  /**
   * Dummy fetch for backward compatibility
   */
  fetchCloudData: async (): Promise<AppData | null> => {
    return _memoryCache;
  },

  // --- Write Operations (Direct to Firestore) ---

  addUser: async (user: User) => {
    // 1. 呼叫 Firebase Auth 建立真實的登入帳號
    const authUser = await createAuthUser(user.id, user.pass);

    // 2. 建立成功後，將使用者資料寫入 Firestore
    await setDoc(doc(db, 'users', user.id), {
        ...user,
        uid: authUser.uid, // Save UID here
        pass: 'PROTECTED' 
    });
  },

  updateUser: async (userId: string, updates: Partial<User>) => {
    await updateDoc(doc(db, 'users', userId), updates);
  },

  archiveUser: async (userId: string) => {
    await updateDoc(doc(db, 'users', userId), { deleted: true });
  },

  restoreUser: async (userId: string) => {
    await updateDoc(doc(db, 'users', userId), { deleted: false });
  },

  permanentDeleteUser: async (userId: string) => {
    await deleteDoc(doc(db, 'users', userId));
  },

  addRecord: async (record: AttendanceRecord) => {
    // Optimistic Update: Update local cache immediately for instant UI feedback
    // Creating a new array reference ensures React detects the change
    _memoryCache.records = [record, ..._memoryCache.records];
    StorageService._saveToLocal();

    try {
        await addDoc(collection(db, 'records'), record);
    } catch (e) {
        // Rollback on failure
        console.error("Add Record Failed, rolling back optimistic update", e);
        _memoryCache.records = _memoryCache.records.filter(r => r.id !== record.id);
        StorageService._saveToLocal();
        throw e;
    }
  },

  addLeave: async (leave: LeaveRequest) => {
    await addDoc(collection(db, 'leaves'), leave);
  },

  updateLeaveStatus: async (id: number, status: LeaveRequest['status'], rejectReason?: string) => {
    const q = query(collection(db, 'leaves'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await updateDoc(doc(db, 'leaves', d.id), { status, rejectReason: rejectReason || null });
    });
  },

  cancelLeave: async (id: number) => {
    const q = query(collection(db, 'leaves'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await updateDoc(doc(db, 'leaves', d.id), { status: 'cancelled' });
    });
  },

  deleteLeave: async (id: number) => {
    const q = query(collection(db, 'leaves'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await deleteDoc(doc(db, 'leaves', d.id));
    });
  },

  addOvertime: async (ot: OvertimeRequest) => {
    await addDoc(collection(db, 'overtimes'), ot);
  },

  updateOvertime: async (id: number, updates: Partial<OvertimeRequest>) => {
    const q = query(collection(db, 'overtimes'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await updateDoc(doc(db, 'overtimes', d.id), updates);
    });
  },

  updateOvertimeStatus: async (id: number, status: OvertimeRequest['status'], rejectReason?: string) => {
    const q = query(collection(db, 'overtimes'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await updateDoc(doc(db, 'overtimes', d.id), { status, rejectReason: rejectReason || null });
    });
  },

  cancelOvertime: async (id: number) => {
    const q = query(collection(db, 'overtimes'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await updateDoc(doc(db, 'overtimes', d.id), { status: 'cancelled' });
    });
  },

  deleteOvertime: async (id: number) => {
    const q = query(collection(db, 'overtimes'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await deleteDoc(doc(db, 'overtimes', d.id));
    });
  },

  addAnnouncement: async (ann: Announcement) => {
    if (ann.id) {
       const q = query(collection(db, 'announcements'), where('id', '==', ann.id));
       const snapshot = await getDocs(q);
       if (!snapshot.empty) {
           snapshot.forEach(async (d) => {
               await updateDoc(doc(db, 'announcements', d.id), ann as any);
           });
           return;
       }
    }
    await addDoc(collection(db, 'announcements'), ann);
  },

  removeAnnouncement: async (id: number) => {
    const q = query(collection(db, 'announcements'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await deleteDoc(doc(db, 'announcements', d.id));
    });
  },

  addHoliday: async (h: Holiday) => {
    await addDoc(collection(db, 'holidays'), h);
  },

  removeHoliday: async (id: number) => {
    const q = query(collection(db, 'holidays'), where('id', '==', id));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (d) => {
        await deleteDoc(doc(db, 'holidays', d.id));
    });
  },

  updateSettings: async (settings: AppSettings) => {
    const safeSettings = {
        gasUrl: settings.gasUrl || "disabled",
        companyLat: Number(settings.companyLat) || 0,
        companyLng: Number(settings.companyLng) || 0,
        allowedRadius: Number(settings.allowedRadius) || 100
    };
    await setDoc(doc(db, 'system', 'settings'), safeSettings);
  }
};
