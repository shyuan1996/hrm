
export const STORAGE_KEY = 'attendance_system_v3';
export const SESSION_KEY = 'attendance_session_v3';

// 預設系統參數
// gasUrl: 已填入您的 Google Sheet API 網址，讓系統上線即連線
// companyLat, companyLng: 預設為 0，由管理員登入後設定
export const DEFAULT_SETTINGS = {
  gasUrl: 'https://script.google.com/macros/s/AKfycbyGuWxWuv61c67Adsd48ABkhUSAiiNd0dPaOcXnORRAZ_5BaJ4QsNOydCos92vCRn7DoQ/exec',
  companyLat: 0, 
  companyLng: 0,
  allowedRadius: 100 
};

export const LEAVE_TYPES = [
  "特休", "補休", "生日假", "事假", "病假", "公假", "婚假", "喪假", "產假", "陪產假", "生理假", "家庭照顧假", "工傷病假", "其他"
];

// 預設管理員帳號 (Admin/admin)
export const INITIAL_ADMIN = { 
  id: 'admin', 
  pass: 'admin', 
  name: '系統管理員', 
  role: 'admin', 
  dept: '管理層', 
  quota_annual: 0, 
  quota_birthday: 0, 
  quota_comp: 0 
};

// 預設測試員工帳號
export const DEFAULT_EMPLOYEE = {
  id: 'user',
  pass: '1234', 
  name: '測試員工',
  role: 'employee',
  dept: '測試部',
  quota_annual: 7,
  quota_birthday: 1,
  quota_comp: 0
};
