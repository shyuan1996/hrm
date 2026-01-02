
export const STORAGE_KEY = 'attendance_system_v3';
export const SESSION_KEY = 'attendance_session_v3';
export const REMEMBER_USER_KEY = 'attendance_remember_user_v3';

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

// 已移除 INITIAL_ADMIN 與 DEFAULT_EMPLOYEE 常數
// 原因：為了資訊安全，不應將預設帳號密碼硬編碼於前端程式碼中。
// 請透過系統登入介面或 Firebase Console 直接建立帳號。
