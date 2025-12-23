
export const STORAGE_KEY = 'attendance_system_v3';
export const SESSION_KEY = 'attendance_session_v3';

// 移除敏感座標資訊，預設為 0 或空，強迫使用者自行設定
export const DEFAULT_SETTINGS = {
  gasUrl: '',
  companyLat: 0, 
  companyLng: 0,
  allowedRadius: 50 
};

export const LEAVE_TYPES = [
  "特休", "補休", "生日假", "事假", "病假", "公假", "婚假", "喪假", "產假", "陪產假", "生理假", "家庭照顧假", "工傷病假", "其他"
];

// 移除預設管理員密碼，實際專案應強制首次登入修改或由後端驗證
export const INITIAL_ADMIN = { 
  id: 'admin', 
  pass: 'admin', // 預設密碼，建議更改
  name: '系統管理員', 
  role: 'admin', 
  dept: '管理層', 
  quota_annual: 0, 
  quota_birthday: 0, 
  quota_comp: 0 
};

// 移除測試員工密碼
export const DEFAULT_EMPLOYEE = {
  id: 'user',
  pass: '1234', // 預設密碼，建議更改
  name: '測試員工',
  role: 'employee',
  dept: '測試部',
  quota_annual: 7,
  quota_birthday: 1,
  quota_comp: 0
};
