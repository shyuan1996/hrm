
import { User, AttendanceRecord, LeaveRequest, OvertimeRequest, Announcement, Holiday, AppSettings, UserRole, LeaveAttachment } from '../types';
import { STORAGE_KEY, DEFAULT_SETTINGS } from '../constants';
import { TimeService } from './timeService';
import { db, auth, createAuthUser, storage } from './firebase'; // Import storage
import { 
  collection, doc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, 
  onSnapshot, query, orderBy, where, Timestamp, limit 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

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
        console.warn("Announcements sync paused:", error.code);
    }));

    // Holidays Sync
    const holQ = query(collection(db, 'holidays'));
    _listeners.push(onSnapshot(holQ, (snapshot) => {
        _memoryCache.holidays = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as any));
        StorageService._saveToLocal();
    }, (error) => {
        console.warn("Holidays sync paused:", error.code);
    }));

    // --- Protected Data (Users, Settings, Personal Records) ---
    // Only subscribe if we are logged in (userId is provided)
    if (userId) {
        // Users Sync: Security Enhancement
        // Admin gets all users; Employee gets only self.
        if (role === 'admin') {
            const usersQ = query(collection(db, 'users'));
            _listeners.push(onSnapshot(usersQ, (snapshot) => {
                _memoryCache.users = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as User));
                StorageService._saveToLocal();
            }, (error) => console.error("Users sync error (Admin):", error.message)));
        } else {
            _listeners.push(onSnapshot(doc(db, 'users', userId), (docSnap) => {
                if (docSnap.exists()) {
                    const u = { ...docSnap.data(), id: docSnap.id } as User;
                    // Replace/Set users array to contain only self
                    _memoryCache.users = [u];
                    StorageService._saveToLocal();
                }
            }, (error) => console.error("User sync error (Self):", error.message)));
        }

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

  // Helper: Save memory cache to localStorage
  _saveToLocal: () => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_memoryCache));
    } catch (e) {
        console.warn("Failed to save cache to local storage:", e);
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

  // --- Security Logger ---
  logSecurityEvent: async (action: string, details: string) => {
    const user = auth.currentUser;
    if (user) {
        try {
            await addDoc(collection(db, 'security_logs'), {
                uid: user.uid,
                email: user.email,
                action,
                details,
                timestamp: Timestamp.now(),
                userAgent: navigator.userAgent
            });
        } catch (e) {
            console.error("Failed to write security log", e);
        }
    }
  },

  // --- File Storage Operations ---

  uploadLeaveAttachments: async (files: File[], userId: string): Promise<LeaveAttachment[]> => {
    if (!storage) throw new Error("File Storage Service is currently unavailable.");
    if (!files || files.length === 0) return [];

    const uploaded: LeaveAttachment[] = [];

    for (const file of files) {
        // Path: leave_attachments/{userId}/{timestamp}_{filename}
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_'); // Sanitize filename
        const storagePath = `leave_attachments/${userId}/${timestamp}_${safeName}`;
        const storageRef = ref(storage, storagePath);

        try {
            const snapshot = await uploadBytes(storageRef, file);
            const url = await getDownloadURL(snapshot.ref);
            uploaded.push({
                name: file.name,
                url: url,
                path: storagePath
            });
        } catch (e: any) {
            console.error("Upload failed for " + file.name, e);
            throw new Error(`檔案 ${file.name} 上傳失敗，請稍後再試。`);
        }
    }
    return uploaded;
  },

  deleteLeaveAttachment: async (leaveId: number, attachment: LeaveAttachment) => {
    if (!storage) throw new Error("Storage unavailable");

    // 1. Delete physical file from Storage
    if (attachment.path) {
        try {
            const fileRef = ref(storage, attachment.path);
            await deleteObject(fileRef);
        } catch (e: any) {
            // Ignore if file not found (already deleted), but warn on other errors
            if (e.code !== 'storage/object-not-found') {
                 console.warn("Storage file deletion failed:", e);
            }
        }
    }

    // 2. Update Firestore Document
    try {
        const q = query(collection(db, 'leaves'), where('id', '==', leaveId));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const docRef = snapshot.docs[0].ref;
            const currentData = snapshot.docs[0].data();
            const currentAttachments = currentData.attachments || [];
            // Remove the specific attachment by path
            const updatedAttachments = currentAttachments.filter((a: any) => a.path !== attachment.path);
            
            await updateDoc(docRef, { attachments: updatedAttachments });
        }
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_DELETE_ATTACHMENT', `Attempted to delete attachment for leave ${leaveId}`);
        }
        throw e;
    }
  },

  // --- Write Operations (Direct to Firestore) ---

  addUser: async (user: User) => {
    // 1. 呼叫 Firebase Auth 建立真實的登入帳號
    // 注意：createAuthUser 已經在內部處理了小寫化
    const authUser = await createAuthUser(user.id, user.pass);

    // 2. 建立成功後，將使用者資料寫入 Firestore
    // 這裡同樣確保寫入 Firestore 的 ID 是小寫
    const userIdLower = user.id.toLowerCase();
    await setDoc(doc(db, 'users', userIdLower), {
        ...user,
        id: userIdLower,
        uid: authUser.uid, // Save UID here
        pass: 'PROTECTED' 
    });
  },

  updateUser: async (userId: string, updates: Partial<User>) => {
    try {
        await updateDoc(doc(db, 'users', userId), updates);
    } catch (e: any) {
        // 如果非管理員嘗試更新他人資料或鎖定欄位
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_UPDATE_USER', `Attempted to update user ${userId} with keys: ${Object.keys(updates).join(', ')}`);
        }
        throw e;
    }
  },

  archiveUser: async (userId: string) => {
    try {
        await updateDoc(doc(db, 'users', userId), { deleted: true });
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_ARCHIVE_USER', `Attempted to archive user ${userId}`);
        }
        throw e;
    }
  },

  restoreUser: async (userId: string) => {
    try {
        await updateDoc(doc(db, 'users', userId), { deleted: false });
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_RESTORE_USER', `Attempted to restore user ${userId}`);
        }
        throw e;
    }
  },

  permanentDeleteUser: async (userId: string) => {
    try {
        await deleteDoc(doc(db, 'users', userId));
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_DELETE_USER', `Attempted to permanently delete user ${userId}`);
        }
        throw e;
    }
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
    try {
        const q = query(collection(db, 'leaves'), where('id', '==', id));
        const snapshot = await getDocs(q);
        const promises = snapshot.docs.map(d => 
            updateDoc(doc(db, 'leaves', d.id), { status, rejectReason: rejectReason || null })
        );
        await Promise.all(promises);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_LEAVE_STATUS', `Attempted to set leave ${id} to ${status}`);
        }
        throw e;
    }
  },

  // Cancel/Delete operations now support userId for restrictive filtering
  cancelLeave: async (id: number, userId?: string) => {
    let constraints = [where('id', '==', id)];
    if (userId) constraints.push(where('userId', '==', userId));

    const q = query(collection(db, 'leaves'), ...constraints);
    const snapshot = await getDocs(q);
    const promises = snapshot.docs.map(d => 
        updateDoc(doc(db, 'leaves', d.id), { status: 'cancelled' })
    );
    await Promise.all(promises);
  },

  deleteLeave: async (id: number, userId?: string) => {
    try {
        let constraints = [where('id', '==', id)];
        if (userId) constraints.push(where('userId', '==', userId));

        const q = query(collection(db, 'leaves'), ...constraints);
        const snapshot = await getDocs(q);
        
        // Use map to create an array of promises for deleting both files and documents
        const deleteOperations = snapshot.docs.map(async (docSnap) => {
            const data = docSnap.data();
            
            // 1. Cascading Delete: Remove attachments from Storage first
            if (data.attachments && Array.isArray(data.attachments)) {
                const attachmentDeletions = data.attachments.map((att: LeaveAttachment) => {
                    if (att.path && storage) {
                        const fileRef = ref(storage, att.path);
                        return deleteObject(fileRef).catch(err => {
                             // Suppress 'not found' errors to allow partial cleanup
                             if (err.code !== 'storage/object-not-found') {
                                 console.warn(`Failed to delete attached file ${att.path}`, err);
                             }
                        });
                    }
                    return Promise.resolve();
                });
                await Promise.all(attachmentDeletions);
            }

            // 2. Delete the Firestore document
            return deleteDoc(doc(db, 'leaves', docSnap.id));
        });

        await Promise.all(deleteOperations);

    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_DELETE_LEAVE', `Attempted to delete leave ${id}`);
        }
        throw e;
    }
  },

  addOvertime: async (ot: OvertimeRequest) => {
    await addDoc(collection(db, 'overtimes'), ot);
  },

  updateOvertime: async (id: number, updates: Partial<OvertimeRequest>) => {
    const q = query(collection(db, 'overtimes'), where('id', '==', id));
    const snapshot = await getDocs(q);
    const promises = snapshot.docs.map(d => updateDoc(doc(db, 'overtimes', d.id), updates));
    await Promise.all(promises);
  },

  updateOvertimeStatus: async (id: number, status: OvertimeRequest['status'], rejectReason?: string) => {
    try {
        const q = query(collection(db, 'overtimes'), where('id', '==', id));
        const snapshot = await getDocs(q);
        const promises = snapshot.docs.map(d => 
            updateDoc(doc(db, 'overtimes', d.id), { status, rejectReason: rejectReason || null })
        );
        await Promise.all(promises);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_OT_STATUS', `Attempted to set overtime ${id} to ${status}`);
        }
        throw e;
    }
  },

  cancelOvertime: async (id: number, userId?: string) => {
    let constraints = [where('id', '==', id)];
    if (userId) constraints.push(where('userId', '==', userId));

    const q = query(collection(db, 'overtimes'), ...constraints);
    const snapshot = await getDocs(q);
    const promises = snapshot.docs.map(d => 
        updateDoc(doc(db, 'overtimes', d.id), { status: 'cancelled' })
    );
    await Promise.all(promises);
  },

  deleteOvertime: async (id: number, userId?: string) => {
    try {
        let constraints = [where('id', '==', id)];
        if (userId) constraints.push(where('userId', '==', userId));

        const q = query(collection(db, 'overtimes'), ...constraints);
        const snapshot = await getDocs(q);
        
        const promises = snapshot.docs.map(d => deleteDoc(doc(db, 'overtimes', d.id)));
        await Promise.all(promises);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_DELETE_OT', `Attempted to delete overtime ${id}`);
        }
        throw e;
    }
  },

  addAnnouncement: async (ann: Announcement) => {
    try {
        if (ann.id) {
           const q = query(collection(db, 'announcements'), where('id', '==', ann.id));
           const snapshot = await getDocs(q);
           if (!snapshot.empty) {
               const promises = snapshot.docs.map(d => updateDoc(doc(db, 'announcements', d.id), ann as any));
               await Promise.all(promises);
               return;
           }
        }
        await addDoc(collection(db, 'announcements'), ann);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_ANNOUNCEMENT_WRITE', `Attempted to write announcement`);
        }
        throw e;
    }
  },

  removeAnnouncement: async (id: number) => {
    try {
        const q = query(collection(db, 'announcements'), where('id', '==', id));
        const snapshot = await getDocs(q);
        const promises = snapshot.docs.map(d => deleteDoc(doc(db, 'announcements', d.id)));
        await Promise.all(promises);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_ANNOUNCEMENT_DELETE', `Attempted to delete announcement ${id}`);
        }
        throw e;
    }
  },

  addHoliday: async (h: Holiday) => {
    try {
        await addDoc(collection(db, 'holidays'), h);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_HOLIDAY_ADD', `Attempted to add holiday`);
        }
        throw e;
    }
  },

  removeHoliday: async (id: number) => {
    try {
        const q = query(collection(db, 'holidays'), where('id', '==', id));
        const snapshot = await getDocs(q);
        const promises = snapshot.docs.map(d => deleteDoc(doc(db, 'holidays', d.id)));
        await Promise.all(promises);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_HOLIDAY_DELETE', `Attempted to delete holiday ${id}`);
        }
        throw e;
    }
  },

  updateSettings: async (settings: AppSettings) => {
    try {
        const safeSettings = {
            gasUrl: settings.gasUrl || "disabled",
            companyLat: Number(settings.companyLat) || 0,
            companyLng: Number(settings.companyLng) || 0,
            allowedRadius: Number(settings.allowedRadius) || 100
        };
        await setDoc(doc(db, 'system', 'settings'), safeSettings);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_SETTINGS_UPDATE', `Attempted to update system settings`);
        }
        throw e;
    }
  }
};
