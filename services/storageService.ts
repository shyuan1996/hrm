
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
      StorageService.saveData(init);
      return init;
    }
    try {
      const parsed = JSON.parse(stored);
      return { ...getInitialData(), ...parsed };
    } catch (e) {
      return getInitialData();
    }
  },

  saveData: async (data: AppData) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (data.settings.gasUrl) {
      try {
        await fetch(data.settings.gasUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      } catch (err) {
        console.warn("Cloud Sync Failed", err);
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
    // because a new holiday might affect existing requests
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
    // removing a holiday might increase leave hours
    data.leaves.forEach(leave => {
        if (leave.status !== 'cancelled' && leave.status !== 'rejected') {
            leave.hours = TimeService.calculateLeaveHours(leave.start, leave.end, data.holidays);
        }
    });

    StorageService.saveData(data);
  }
};
