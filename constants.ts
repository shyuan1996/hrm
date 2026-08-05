
export const STORAGE_KEY = 'attendance_system_v3';
export const SESSION_KEY = 'attendance_session_v3';

// 預設系統參數
// companyLat, companyLng: 預設為 0，由管理員登入後設定
export const DEFAULT_SETTINGS = {
  companyLat: 0, 
  companyLng: 0,
  allowedRadius: 100 
};

export const LEAVE_TYPES = [
  "特休", "補休", "生日假", "事假", "病假", "公假", "婚假", "喪假", "產假", "陪產假", "生理假", "家庭照顧假", "工傷病假", "其他"
];
// 請透過系統登入介面或 Firebase Console 直接建立帳號。
