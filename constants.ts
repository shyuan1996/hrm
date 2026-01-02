
export const STORAGE_KEY = 'attendance_system_v3';
export const SESSION_KEY = 'attendance_session_v3';
export const REMEMBER_USER_KEY = 'attendance_remember_user_v3';

// 系統版本號：每次發布更新時，請修改此版本號 (例如 1.0.0 -> 1.0.1)
// 系統偵測到版本變更時，會自動清除使用者的 LocalStorage 快取並強制重新整理
export const APP_VERSION = '1.0.1'; 
export const VERSION_KEY = 'sas_app_version';

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
