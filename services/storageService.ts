
import { User, AttendanceRecord, LeaveRequest, OvertimeRequest, Announcement, Holiday, AppSettings, UserRole } from '../types';
import { STORAGE_KEY, DEFAULT_SETTINGS, INITIAL_ADMIN, DEFAULT_EMPLOYEE } from '../constants';
import { TimeService } from './timeService';

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
  users: [INITIAL_ADMIN as User, DEFAULT_EMPLOYEE as User],
  records: [],
  leaves: [],
  overtimes: [],
  announcements: [],
  holidays: [],
  settings: DEFAULT_SETTINGS
});

export const StorageService = {
  loadData: (): AppData => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const init = getInitialData();
      return init;
    }
    try {
      const parsed = JSON.parse(stored);
      // Merge with initial structure to ensure all fields exist
      const data = { ...getInitialData(), ...parsed };
      
      // SAFETY NET: If for some reason (bad sync/corruption) users are empty, restore defaults
      // This prevents the "cannot log in" issue if cloud overwrites with empty list
      if (!data.users || data.users.length === 0) {
          data.users = [INITIAL_ADMIN as User, DEFAULT_EMPLOYEE as User];
      }
      
      return data;
    } catch (e) {
      return getInitialData();
    }
  },

  /**
   * 嘗試從雲端 (Google Apps Script) 獲取最新資料
   * 成功後會更新 LocalStorage
   */
  fetchCloudData: async (): Promise<AppData | null> => {
    const localData = StorageService.loadData();
    const gasUrl = localData.settings?.gasUrl;

    if (!gasUrl) {
      console.warn("No GAS URL configured, skipping cloud fetch.");
      return null;
    }

    try {
      // 假設 GAS 部署為 Web App，GET 請求會回傳 JSON 資料
      const response = await fetch(gasUrl);
      if (!response.ok) throw new Error('Cloud fetch failed');
      
      const cloudData = await response.json();
      
      // 驗證回傳的資料結構是否包含必要的欄位，簡單驗證
      if (cloudData && Array.isArray(cloudData.users)) {
        // Prevent overwriting local with empty user list from cloud if cloud is fresh/empty
        if (cloudData.users.length === 0) {
             cloudData.users = [INITIAL_ADMIN as User, DEFAULT_EMPLOYEE as User];
        }

        // 更新本地儲存，確保它是最新的
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudData));
        return cloudData as AppData;
      }
    } catch (err) {
      console.error("Cloud Sync Error (GET):", err);
    }
    return null;
  },

  saveData: async (data: AppData) => {
    // 1. Save locally (as cache/fallback)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    // 2. Push to Cloud
    if (data.settings.gasUrl) {
      try {
        // 使用 no-cors 模式或是標準 cors，視 GAS 設定而定
        // 通常 GAS 需要正確設定回傳 headers 才能用標準 cors
        // 這裡為了簡單起見，發送 POST 請求
        await fetch(data.settings.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // GAS 有時對 application/json 處理較嚴格，text/plain 較穩
          body: JSON.stringify(data)
        });
      } catch (err) {
        console.warn("Cloud Sync Failed (POST)", err);
      }
    }
  },

  updateUser: (userId: string, updates: Partial<User>) => {
    const data = StorageService.loadData();
    const idx = data.users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      data.users[idx] = { ...data.users[idx], ...updates };
      StorageService.saveData(data);
    }
  },

  archiveUser: (userId: string) => {
    const data = StorageService.loadData();
    const idx = data.users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      data.users[idx].deleted = true;
      StorageService.saveData(data);
    }
  },

  restoreUser: (userId: string) => {
    const data = StorageService.loadData();
    const idx = data.users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      data.users[idx].deleted = false;
      StorageService.saveData(data);
    }
  },

  permanentDeleteUser: (userId: string) => {
    const data = StorageService.loadData();
    data.users = data.users.filter(u => u.id !== userId);
    StorageService.saveData(data);
  },

  updateSettings: (settings: AppSettings) => {
    const data = StorageService.loadData();
    data.settings = settings;
    StorageService.saveData(data);
  },

  addUser: (user: User) => {
    const data = StorageService.loadData();
    data.users.push(user);
    StorageService.saveData(data);
  },

  addRecord: (record: AttendanceRecord) => {
    const data = StorageService.loadData();
    data.records.unshift(record);
    StorageService.saveData(data);
  },

  addLeave: (leave: LeaveRequest) => {
    const data = StorageService.loadData();
    data.leaves.unshift(leave);
    StorageService.saveData(data);
  },

  updateLeaveStatus: (id: number, status: LeaveRequest['status'], rejectReason?: string) => {
    const data = StorageService.loadData();
    const idx = data.leaves.findIndex(l => l.id === id);
    if (idx !== -1) {
      data.leaves[idx].status = status;
      if (rejectReason) data.leaves[idx].rejectReason = rejectReason;
      StorageService.saveData(data);
    }
  },

  cancelLeave: (id: number) => {
    const data = StorageService.loadData();
    const idx = data.leaves.findIndex(l => l.id === id);
    if (idx !== -1) {
      data.leaves[idx].status = 'cancelled';
      StorageService.saveData(data);
    }
  },

  deleteLeave: (id: number) => {
    const data = StorageService.loadData();
    data.leaves = data.leaves.filter(l => l.id !== id);
    StorageService.saveData(data);
  },

  addOvertime: (ot: OvertimeRequest) => {
    const data = StorageService.loadData();
    data.overtimes.unshift(ot);
    StorageService.saveData(data);
  },

  updateOvertime: (id: number, updates: Partial<OvertimeRequest>) => {
    const data = StorageService.loadData();
    const idx = data.overtimes.findIndex(o => o.id === id);
    if (idx !== -1) {
      data.overtimes[idx] = { ...data.overtimes[idx], ...updates };
      StorageService.saveData(data);
    }
  },

  updateOvertimeStatus: (id: number, status: OvertimeRequest['status'], rejectReason?: string) => {
    const data = StorageService.loadData();
    const idx = data.overtimes.findIndex(o => o.id === id);
    if (idx !== -1) {
      data.overtimes[idx].status = status;
      if (rejectReason) data.overtimes[idx].rejectReason = rejectReason;
      StorageService.saveData(data);
    }
  },

  cancelOvertime: (id: number) => {
    const data = StorageService.loadData();
    const idx = data.overtimes.findIndex(o => o.id === id);
    if (idx !== -1) {
      data.overtimes[idx].status = 'cancelled';
      StorageService.saveData(data);
    }
  },

  deleteOvertime: (id: number) => {
    const data = StorageService.loadData();
    data.overtimes = data.overtimes.filter(o => o.id !== id);
    StorageService.saveData(data);
  },

  addAnnouncement: (ann: Announcement) => {
    const data = StorageService.loadData();
    const idx = data.announcements.findIndex(a => a.id === ann.id);
    if (idx !== -1) data.announcements[idx] = ann; // Edit
    else data.announcements.unshift(ann); // Add
    StorageService.saveData(data);
  },

  removeAnnouncement: (id: number) => {
    const data = StorageService.loadData();
    data.announcements = data.announcements.filter(a => a.id !== id);
    StorageService.saveData(data);
  },

  addHoliday: (h: Holiday) => {
    const data = StorageService.loadData();
    data.holidays.push(h);
    
    // Recalculate hours for ALL leaves (pending, approved, etc.)
    data.leaves.forEach(leave => {
        if (leave.status !== 'cancelled' && leave.status !== 'rejected') {
            leave.hours = TimeService.calculateLeaveHours(leave.start, leave.end, data.holidays);
        }
    });

    StorageService.saveData(data);
  },

  removeHoliday: (id: number) => {
    const data = StorageService.loadData();
    data.holidays = data.holidays.filter(h => h.id !== id);

    // Recalculate hours for ALL leaves
    data.leaves.forEach(leave => {
        if (leave.status !== 'cancelled' && leave.status !== 'rejected') {
            leave.hours = TimeService.calculateLeaveHours(leave.start, leave.end, data.holidays);
        }
    });

    StorageService.saveData(data);
  }
};
