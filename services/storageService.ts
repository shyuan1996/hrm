
import { User, AttendanceRecord, LeaveRequest, OvertimeRequest, Announcement, Holiday, AppSettings, LeaveAttachment } from '../types';
import { STORAGE_KEY, DEFAULT_SETTINGS } from '../constants';
import { TimeService } from './timeService';
import { db, auth, createAuthUser, storage, functions } from './firebase'; // Import storage
import { 
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, 
  onSnapshot, query, orderBy, where, limit, serverTimestamp, Timestamp, getDocsFromServer, runTransaction, Query
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { safeAttachments } from '../functions/src/domain';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';


type RequestId = number | string;
const invoke = async (action: string, data: Record<string, unknown>) => {
  try {
    const result = await httpsCallable(functions, 'secureAttendance')({action, ...data});
    return result.data as any;
  } catch (error: any) {
    if(error?.code==='functions/not-found')throw new Error('伺服器尚未部署新版功能，請聯絡管理員；未送出本次操作');
    throw error;
  }
};
// New reads carry actual document IDs. Ambiguous legacy IDs fail closed.
async function resolveRequest(collectionName: string, id: RequestId, userId?: string) {
  if (typeof id === 'string') {
    if (!id || id.includes('/')) throw new Error('文件識別碼不正確');
    return doc(db, collectionName, id);
  }
  const constraints = [where('id','==',id)];
  if (userId) {
    if (!auth.currentUser) throw new Error('請重新登入');
    constraints.push(where('userId','==',userId), where('uid','==',auth.currentUser.uid));
  }
  const snapshot = await getDocs(query(collection(db,collectionName),...constraints,limit(2)));
  if (snapshot.size !== 1) throw new Error('資料不存在或識別碼重複，請重新整理後再操作');
  return snapshot.docs[0].ref;
}
function cleanLeave(data: any): LeaveRequest {
  let attachments: LeaveAttachment[] = [];
  try { attachments = safeAttachments(data.attachments, data.uid, data.userId); } catch { attachments=[]; }
  return {...data,attachments};
}
const requestTime = (r: any) => r.createdAt?.toMillis?.() ?? (Number(r.legacyId ?? r.id) || 0);

export interface AppData {
  syncReady: {users:boolean; leaves:boolean; holidays:boolean; settings:boolean};
  users: User[];
  records: AttendanceRecord[];
  leaves: LeaveRequest[];
  overtimes: OvertimeRequest[];
  announcements: Announcement[];
  holidays: Holiday[];
  settings: AppSettings;
}

const getInitialData = (): AppData => ({
  syncReady: {users:false,leaves:false,holidays:false,settings:false},
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
   * Resolve the Firestore profile from the authenticated Firebase UID.
   * Account IDs are only a legacy fallback because their casing was not
   * historically normalized when an administrator created an employee.
   */
  getUserProfileForAuth: async (uid: string, email?: string | null, preferredId?: string): Promise<User | null> => {
    const byUid = query(collection(db, 'users'), where('uid', '==', uid), limit(2));
    try {
      const snapshot = await getDocs(byUid);
      if (snapshot.size > 1) {
        throw new Error('DUPLICATE_USER_PROFILE');
      }
      if (snapshot.size === 1) {
        const profileDoc = snapshot.docs[0];
        return { ...profileDoc.data(), id: profileDoc.id } as User;
      }
    } catch (error: any) {
      if (error?.message === 'DUPLICATE_USER_PROFILE') throw error;
      // Older rule deployments may reject UID collection queries. The
      // document-ID fallback below remains safe and never creates a profile.
      console.warn('UID profile lookup failed; trying legacy document ID.', error?.code || error);
    }

    const emailId = email?.split('@')[0]?.trim().toLowerCase();
    const candidateIds = Array.from(new Set([preferredId, emailId].filter(Boolean) as string[]));

    for (const candidateId of candidateIds) {
      const profileRef = doc(db, 'users', candidateId);
      try {
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          const profile = profileSnap.data() as User;
          if (profile.uid && profile.uid !== uid) throw new Error('PROFILE_UID_MISMATCH');
          return { ...profile, id: profileSnap.id, uid } as User;
        }
      } catch (error: any) {
        if (error?.message === 'PROFILE_UID_MISMATCH') throw error;
        if (error?.code !== 'permission-denied') throw error;
      }

      // Legacy profiles without a UID cannot be read by current rules. Use
      // updateDoc (never setDoc) so a missing profile cannot become a new,
      // empty employee account by accident.
      if (candidateId === emailId && candidateId !== 'admin') {
        try {
          await updateDoc(profileRef, { uid });
          const claimedSnap = await getDoc(profileRef);
          if (claimedSnap.exists()) {
            return { ...claimedSnap.data(), id: claimedSnap.id, uid } as User;
          }
        } catch (error: any) {
          if (error?.code !== 'not-found' && error?.code !== 'permission-denied') throw error;
        }
      }
    }

    return null;
  },

  stopRealtimeSync: () => {
    _listeners.forEach(unsubscribe => unsubscribe());
    _listeners = [];
  },

  clearPrivateCache: () => {
    _memoryCache = {
      ..._memoryCache,
      users: [],
      records: [],
      leaves: [],
      overtimes: [],
      // Geofence coordinates/radius are protected system data; do not keep
      // the previous account's copy when logging out or switching accounts.
      settings: DEFAULT_SETTINGS
    };
    StorageService._saveToLocal();
  },
  
  /**
   * 初始化 Firestore 監聽器 (Realtime Sync)
   * 這會自動將後端資料同步到本地記憶體與 LocalStorage
   */
  initRealtimeSync: (userId?: string, role?: string) => {
    // Clear existing listeners
    StorageService.stopRealtimeSync();
    _memoryCache.syncReady={users:false,leaves:false,holidays:false,settings:false};

    // Never expose the previous account's protected cache while listeners for
    // another account are still loading (especially on shared browsers).
    if (!userId || !_memoryCache.users.some(user => user.id === userId)) {
      StorageService.clearPrivateCache();
    }

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
    _listeners.push(onSnapshot(holQ, {includeMetadataChanges:true}, (snapshot) => {
        _memoryCache.syncReady.holidays=!snapshot.metadata.fromCache;
        _memoryCache.holidays = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as any));
        StorageService._saveToLocal();
    }, (error) => {
        _memoryCache.syncReady.holidays=false;
        StorageService._saveToLocal();
        console.warn("Holidays sync paused:", error.code);
    }));

    // --- Protected Data (Users, Settings, Personal Records) ---
    // Only subscribe if we are logged in (userId is provided)
    if (userId) {
        // Users Sync: Security Enhancement
        // Admin gets all users; Employee gets only self.
        if (role === 'admin') {
            const usersQ = query(collection(db, 'users'));
            _listeners.push(onSnapshot(usersQ, {includeMetadataChanges:true}, (snapshot) => {
                _memoryCache.syncReady.users=!snapshot.metadata.fromCache;
                _memoryCache.users = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as User));
                StorageService._saveToLocal();
            }, (error) => { _memoryCache.syncReady.users=false; StorageService._saveToLocal(); console.error("Users sync error (Admin):", error.message); }));
        } else {
            _listeners.push(onSnapshot(doc(db, 'users', userId), {includeMetadataChanges:true}, (docSnap) => {
                _memoryCache.syncReady.users=!docSnap.metadata.fromCache && docSnap.exists();
                if (docSnap.exists()) {
                    const u = { ...docSnap.data(), id: docSnap.id } as User;
                    // Replace/Set users array to contain only self
                    _memoryCache.users = [u];
                } else {
                    _memoryCache.users=[];
                }
                window.dispatchEvent(new CustomEvent('profile-update',{detail:docSnap.exists()?{...docSnap.data(),id:docSnap.id}:null}));
                StorageService._saveToLocal();
            }, (error) => { console.error('User sync error (Self):',error.code); window.dispatchEvent(new CustomEvent('profile-update',{detail:null})); }));
        }

        // Settings Sync
        _listeners.push(onSnapshot(doc(db, 'system', 'settings'), {includeMetadataChanges:true}, (docSnap) => {
            _memoryCache.syncReady.settings=!docSnap.metadata.fromCache && docSnap.exists();
            if (docSnap.exists()) {
                _memoryCache.settings = { ...DEFAULT_SETTINGS, ...docSnap.data() };
            } else {
                // First run or missing settings
                _memoryCache.settings = DEFAULT_SETTINGS;
                // Only admin usually writes this, but safe to set default in memory
            }
            StorageService._saveToLocal();
        }, (error) => { _memoryCache.syncReady.settings=false; StorageService._saveToLocal(); console.error("Settings sync error:", error.message); }));

        // Personal Data or Admin Data
        let recordsQ: Query, leavesQ: Query, overtimesQ: Query;

        if (role === 'admin') {
            // Admin sees all (Admin query does not use 'where', so orderBy is safe without composite index)
            recordsQ = query(collection(db, 'records'), orderBy('id', 'desc'), limit(500));
            // Keep the complete leave/overtime history in the admin cache;
            // the dashboard applies a small, predictable ten-row page in the
            // UI so older records remain reachable without a second query.
            leavesQ = query(collection(db, 'leaves'), orderBy('id', 'desc'));
            overtimesQ = query(collection(db, 'overtimes'), orderBy('id', 'desc'));
        } else {
            // Employee queries must include the immutable Firebase UID. The
            // Firestore rules authorize a resource by its `uid`; querying only
            // by the legacy account ID (`userId`) cannot be proven safe for a
            // collection query and is rejected by the rules, leaving the
            // dashboard empty even though the documents still exist.
            const authenticatedUid = auth.currentUser?.uid;
            if (!authenticatedUid) {
                console.error('Protected data sync skipped: Firebase user is not available.');
                return;
            }
            recordsQ = query(
                collection(db, 'records'),
                where('uid', '==', authenticatedUid),
                where('userId', '==', userId)
            );
            leavesQ = query(
                collection(db, 'leaves'),
                where('uid', '==', authenticatedUid),
                where('userId', '==', userId)
            );
            overtimesQ = query(
                collection(db, 'overtimes'),
                where('uid', '==', authenticatedUid),
                where('userId', '==', userId)
            );
        }

        _listeners.push(onSnapshot(recordsQ, (snapshot) => {
            const list = snapshot.docs
                .map(d => ({ ...d.data(), firestoreId:d.id } as AttendanceRecord))
                // Keep the account ID check as defence in depth for profiles
                // whose Auth UID was accidentally reused in old data.
                .filter(record => role === 'admin' || record.userId === userId);
            if (role !== 'admin') {
                list.sort((a, b) => requestTime(b) - requestTime(a)); // In-memory sort for employees
            }
            _memoryCache.records = list;
            StorageService._saveToLocal();
        }, (e) => console.warn("Records sync error:", e.code)));

        _listeners.push(onSnapshot(leavesQ, {includeMetadataChanges:true}, (snapshot) => {
            _memoryCache.syncReady.leaves=!snapshot.metadata.fromCache;
            const list = snapshot.docs
                .map(d => cleanLeave({ ...d.data(), legacyId:d.data().id, id:d.id }))
                .filter(leave => role === 'admin' || leave.userId === userId);
            if (role !== 'admin') {
                list.sort((a, b) => requestTime(b) - requestTime(a));
            }
            _memoryCache.leaves = list;
            StorageService._saveToLocal();
        }, (e) => { _memoryCache.syncReady.leaves=false; StorageService._saveToLocal(); console.warn("Leaves sync error:", e.code); }));

        _listeners.push(onSnapshot(overtimesQ, (snapshot) => {
            const list = snapshot.docs
                .map(d => ({ ...d.data(), legacyId:d.data().id, id:d.id } as OvertimeRequest))
                .filter(overtime => role === 'admin' || overtime.userId === userId);
            if (role !== 'admin') {
                list.sort((a, b) => requestTime(b) - requestTime(a));
            }
            _memoryCache.overtimes = list;
            StorageService._saveToLocal();
        }, (e) => console.warn("Overtimes sync error:", e.code)));
    }
  },

  // Helper: Save memory cache to localStorage
  _saveToLocal: () => {
    try {
        // Persist public configuration only. Employee profiles, attendance,
        // leave and overtime data remain in memory and disappear on logout or
        // browser close instead of being left readable on a shared device.
        const publicCache: AppData = {
          ...getInitialData(),
          announcements: _memoryCache.announcements,
          holidays: _memoryCache.holidays
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(publicCache));
    } catch (e) {
        console.warn("Failed to save cache to local storage:", e);
    }
    // Trigger a custom event so React components can re-render if they listen to it
    window.dispatchEvent(new Event('storage-update'));
  },

  loadData: (): AppData => _memoryCache,

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
                timestamp: serverTimestamp(),
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
    if(files.length>3)throw new Error('附件最多三份');
    // Validate the complete selection before uploading the first file.
    for(const file of files) {
      if(file.size>5*1024*1024 || !(file.type.startsWith('image/') || file.type==='application/pdf'))throw new Error('附件須為每份 5MB 以內的圖片或 PDF');
    }

    for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
            throw new Error(`檔案 ${file.name} 超過 5MB 上限。`);
        }
        if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) {
            throw new Error(`檔案 ${file.name} 不是允許的圖片或 PDF。`);
        }

        // Store new files under the immutable Firebase Auth UID. Legacy files
        // may still use the account ID; the Storage Rules support both paths.
        const timestamp = crypto.randomUUID();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_'); // Sanitize filename
        const authenticatedUid = auth.currentUser?.uid;
        if (!authenticatedUid) {
          throw new Error('請重新登入後再上傳附件。');
        }
        const storagePath = `leave_attachments/${authenticatedUid}/${timestamp}_${safeName}`;
        const storageRef = ref(storage, storagePath);
        const contentType = file.type || (
          file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
        );

        try {
            // Set metadata explicitly. Some mobile browsers provide an empty
            // File.type even for a valid image, which can make a Storage rule
            // that checks request.resource.contentType reject the upload.
            const snapshot = await uploadBytes(storageRef, file, { contentType, customMetadata:{userId} });
            const url = await getDownloadURL(snapshot.ref);
            uploaded.push({
                name: file.name,
                url: url,
                path: storagePath
            });
        } catch (e: any) {
            // These paths were generated for this attempt; never delete a
            // client-provided path or an attachment from an existing leave.
            await Promise.all([...uploaded.map(a=>a.path),storagePath].map(path=>deleteObject(ref(storage,path)).catch(()=>{})));
            console.error("Upload failed for " + file.name, {
              code: e?.code,
              message: e?.message,
              path: storagePath,
              contentType
            });
            if (typeof e?.code === 'string') {
              throw new Error(`檔案 ${file.name} 上傳失敗 (${e.code})，請稍後再試。`);
            }
            throw new Error(`檔案 ${file.name} 上傳失敗，請稍後再試。`);
        }
    }
    return uploaded;
  },

  deleteLeaveAttachment: async (leaveId: RequestId, attachment: LeaveAttachment) => {
    const target = await resolveRequest('leaves',leaveId);
    await invoke('leaveAction',{id:target.id,operation:'removeAttachment',path:attachment.path});
  },

  // --- Write Operations (Direct to Firestore) ---

  addUser: async (user: User & { pass: string }) => {
    // 1. 呼叫 Firebase Auth 建立真實的登入帳號
    // 注意：createAuthUser 已經在內部處理了小寫化
    const { pass, ...profile } = user;
    const authUser = await createAuthUser(user.id, pass);

    // 2. 建立成功後，將使用者資料寫入 Firestore
    // 這裡同樣確保寫入 Firestore 的 ID 是小寫
    const userIdLower = user.id.trim().toLowerCase();
    await setDoc(doc(db, 'users', userIdLower), {
        ...profile,
        id: userIdLower,
        uid: authUser.uid,
        mustChangePassword: true
    });
  },

  updateUser: async (userId: string, updates: Partial<User>, expectedUser?: User) => {
    try {
        const target=doc(db,'users',userId);
        if (updates.quotas !== undefined) {
          if(!expectedUser)throw new Error('請重新開啟員工設定後再調整額度');
          await runTransaction(db,async tx=>{
            const snapshot=await tx.get(target);
            if(!snapshot.exists())throw new Error('員工不存在');
            const fresh=snapshot.data();
            for(const key of ['quotas','quota_annual','quota_comp','quota_birthday'] as const) {
              if(JSON.stringify(fresh[key]??(key==='quotas'?[]:0))!==JSON.stringify(expectedUser[key]??(key==='quotas'?[]:0)))throw new Error('額度已被其他操作更新，請重新開啟員工設定，未覆蓋最新額度');
            }
            tx.update(target,updates);
          });
        } else await updateDoc(target,updates);
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
        await invoke('archiveEmployee',{userId});
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_ARCHIVE_USER', `Attempted to archive user ${userId}`);
        }
        throw e;
    }
  },

  restoreUser: async (userId: string) => {
    try {
        await invoke('restoreEmployee',{userId});
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_RESTORE_USER', `Attempted to restore user ${userId}`);
        }
        throw e;
    }
  },

  permanentDeleteUser: async (userId: string) => {
    try {
        throw new Error('為保留歷史打卡與請假資料，請改用封存員工；永久刪除暫停使用');
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_DELETE_USER', `Attempted to permanently delete user ${userId}`);
        }
        throw e;
    }
  },

  addRecord: async (record: AttendanceRecord) => {
    const result = await invoke('punch',{requestId:String(record.id),type:record.type,lat:record.lat,lng:record.lng});
    _memoryCache.records=[{...result.record,firestoreId:result.id},..._memoryCache.records.filter(r=>r.firestoreId!==result.id)];
    StorageService._saveToLocal();
  },

  addAdminRecord: async (record: AttendanceRecord, _adminName: string) => {
    const result = await invoke('manualPunch',{requestId:String(record.id),userId:record.userId,type:record.type,date:record.date,time:record.time});
    _memoryCache.records=[{...result.record,firestoreId:result.id},..._memoryCache.records.filter(r=>r.firestoreId!==result.id)];
    StorageService._saveToLocal();
  },

  fetchAttendanceRecords: async (startDate: string, endDate: string): Promise<AttendanceRecord[]> => {
    const recordsQ = query(
      collection(db, 'records'),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    );
    const timestampQuery=query(collection(db,'records'),where('createdAt','>=',Timestamp.fromDate(new Date(startDate+'T00:00:00+08:00'))),where('createdAt','<=',Timestamp.fromDate(new Date(endDate+'T23:59:59.999+08:00'))));
    const snapshots=await Promise.all([getDocsFromServer(recordsQ),getDocsFromServer(timestampQuery)]);
    const records=new Map<string,AttendanceRecord>();
    for(const snapshot of snapshots)for(const d of snapshot.docs)records.set(d.id,{...d.data(),firestoreId:d.id} as AttendanceRecord);
    return [...records.values()].filter(r=>TimeService.getAttendanceDate(r)>=startDate && TimeService.getAttendanceDate(r)<=endDate);
  },

  watchAttendanceDate: (date: string, onData: (records: AttendanceRecord[])=>void, onError: ()=>void) => {
    const queries=[query(collection(db,'records'),where('date','==',date)),query(collection(db,'records'),where('createdAt','>=',Timestamp.fromDate(new Date(date+'T00:00:00+08:00'))),where('createdAt','<=',Timestamp.fromDate(new Date(date+'T23:59:59.999+08:00'))))];
    const parts: (AttendanceRecord[]|null)[]=[null,null];
    let active=true,failed=false;
    const listeners=queries.map((q,i)=>onSnapshot(q,{includeMetadataChanges:true},snapshot=>{
      if(!active||failed||snapshot.metadata.fromCache)return;
      parts[i]=snapshot.docs.map(d=>({...d.data(),firestoreId:d.id} as AttendanceRecord));
      if(parts.every(Boolean)) {
        const all=new Map<string,AttendanceRecord>();
        parts.flat().forEach(r=>{if(r && TimeService.getAttendanceDate(r)===date)all.set(r.firestoreId!,r);});
        onData([...all.values()]);
      }
    },()=>{failed=true;if(active)onError();}));
    return ()=>{active=false;listeners.forEach(stop=>stop());};
  },

  addLeave: async (leave: LeaveRequest) => {
    await invoke('submitLeave',{...leave,requestId:String(leave.id)});
  },
  updateLeaveStatus: async (id: RequestId, status: LeaveRequest['status'], rejectReason?: string) => {
    const target=await resolveRequest('leaves',id);
    const operation=status==='approved'?'approve':status==='rejected'?'reject':status==='cancelled'?'cancel':'';
    if(!operation)throw new Error('不支援此狀態');
    await invoke('leaveAction',{id:target.id,operation,reason:rejectReason||''});
  },
  updateApprovedLeaveType: async (id: RequestId, _adminName: string, newType: string, newHours: number) => {
    const target=await resolveRequest('leaves',id);
    await invoke('leaveAction',{id:target.id,operation:'edit',type:newType,hours:newHours});
  },
  cancelLeave: async (id: RequestId, userId?: string) => {
    const target=await resolveRequest('leaves',id,userId);
    await invoke('leaveAction',{id:target.id,operation:'cancel'});
  },
  deleteLeave: async (id: RequestId, userId?: string) => {
    const target=await resolveRequest('leaves',id,userId);
    await invoke('leaveAction',{id:target.id,operation:'delete'});
  },
  addOvertime: async (ot: OvertimeRequest) => {
    await invoke('submitOvertime',{...ot,requestId:String(ot.id)});
  },
  updateOvertime: async (id: RequestId, updates: Partial<OvertimeRequest>) => {
    const target=await resolveRequest('overtimes',id);
    await invoke('overtimeAction',{id:target.id,operation:'edit',updates});
  },
  updateOvertimeStatus: async (id: RequestId, status: OvertimeRequest['status'], rejectReason?: string) => {
    const target=await resolveRequest('overtimes',id);
    const operation=status==='approved'?'approve':status==='rejected'?'reject':status==='cancelled'?'cancel':'';
    if(!operation)throw new Error('不支援此狀態');
    await invoke('overtimeAction',{id:target.id,operation,reason:rejectReason||''});
  },
  cancelOvertime: async (id: RequestId, userId?: string) => {
    const target=await resolveRequest('overtimes',id,userId);
    await invoke('overtimeAction',{id:target.id,operation:'cancel'});
  },
  deleteOvertime: async (id: RequestId, userId?: string) => {
    const target=await resolveRequest('overtimes',id,userId);
    await invoke('overtimeAction',{id:target.id,operation:'delete'});
  },

  addAnnouncement: async (ann: Announcement) => {
    if(typeof ann.id==='string') {
      await updateDoc(await resolveRequest('announcements',ann.id),{title:ann.title,content:ann.content,category:ann.category,author:ann.author,date:ann.date});
    } else {
      await addDoc(collection(db,'announcements'),{...ann,createdAt:serverTimestamp()});
    }
  },
  removeAnnouncement: async (id: RequestId) => {
    await deleteDoc(await resolveRequest('announcements',id));
  },

  addHoliday: async (h: Holiday) => {
    try {
        await addDoc(collection(db, 'holidays'), {
          ...h,
          createdAt: serverTimestamp()
        });
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            StorageService.logSecurityEvent('UNAUTHORIZED_HOLIDAY_ADD', `Attempted to add holiday`);
        }
        throw e;
    }
  },

  removeHoliday: async (id: RequestId) => {
    await deleteDoc(await resolveRequest('holidays',id));
  },

  updateSettings: async (settings: AppSettings) => {
    try {
        const safeSettings = {
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
