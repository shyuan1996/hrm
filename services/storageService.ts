
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
      return getInitialData();
    }
    try {
      const parsed = JSON.parse(stored);
      // Merge with initial structure to ensure all fields exist
      const data = { ...getInitialData(), ...parsed };
      
      // SAFETY NET: If for some reason (bad sync/corruption) users are empty, restore defaults
      if (!data.users || data.users.length === 0) {
          data.users = [INITIAL_ADMIN as User, DEFAULT_EMPLOYEE as User];
      }
      
      // Ensure settings exist and fallback to defaults if URL is missing
      if (!data.settings) {
          data.settings = DEFAULT_SETTINGS;
      } else if (!data.settings.gasUrl) {
          data.settings.gasUrl = DEFAULT_SETTINGS.gasUrl;
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
    // 使用本地設定的 URL，如果沒有則使用預設常數，確保第一次載入能連線
    const gasUrl = localData.settings?.gasUrl || DEFAULT_SETTINGS.gasUrl;

    if (!gasUrl) {
      console.warn("No GAS URL configured, skipping cloud fetch.");
      return null;
    }

    try {
      const response = await fetch(gasUrl);
      if (!response.ok) throw new Error('Cloud fetch failed');
      
      const cloudData = await response.json();
      
      // 驗證回傳的資料結構
      if (cloudData && typeof cloudData === 'object') {
        // 如果雲端回傳的是空的或者使用者列表為空 (新建立的Sheet)
        if (!cloudData.users || !Array.isArray(cloudData.users) || cloudData.users.length === 0) {
             console.log("Cloud seems empty. Initializing with default data...");
             // 保持原本的資料結構，不被空資料覆蓋，但標記為同步成功
             // 如果是全新部屬，可以考慮將本地初始資料推送到雲端
             const initData = getInitialData();
             // 保留設定
             if (localData.settings) initData.settings = localData.settings;
             
             await StorageService.saveData(initData);
             return initData;
        }

        // 更新本地儲存
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
    // 優先使用資料內的設定，若無則使用預設
    const gasUrl = data.settings?.gasUrl || DEFAULT_SETTINGS.gasUrl;

    if (gasUrl) {
      try {
        await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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
    if (idx !== -1) data.announcements[idx] = ann;
    else data.announcements.unshift(ann);
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
    data.leaves.forEach(leave => {
        if (leave.status !== 'cancelled' && leave.status !== 'rejected') {
            leave.hours = TimeService.calculateLeaveHours(leave.start, leave.end, data.holidays);
        }
    });
    StorageService.saveData(data);
  }
};
