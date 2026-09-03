
import type { AttendanceRecord, Holiday } from '../types';

// 使用模組級變數作為 Singleton 狀態儲存。
// 每次成功校時都會重新建立錨點，避免頁面長時間開啟後因裝置時鐘漂移而越來越慢。
let _anchorServerTime: number | null = null; // 錨點當下的標準時間 (毫秒)
let _anchorPerfTime = 0;                     // 錨點當下的單調計時器 (毫秒)
let _lastOffset = 0;
let _lastSyncAt = 0;
let _syncPromise: Promise<number | null> | null = null;

const getMonotonicTime = (): number => {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
};

type NetworkTimeSample = {
  offset: number;
  serverTime: number;
};

export const TimeService = {
  /**
   * 取得網路標準時間與本地時間的差值（毫秒）
   * 並且建立單調計時器錨點 (Monotonic Anchor)，防止使用者修改系統時間作弊。
   * 若所有 API 請求都失敗，回傳 null (代表時間驗證失敗，禁止操作)。
   */
  getNetworkTimeOffset: async (): Promise<number | null> => {
    // Prevent the initial load, background refresh and punch action from
    // launching competing requests and overwriting one another's anchor.
    if (_syncPromise) return _syncPromise;

    const fetchWithTimeout = async (url: string, timeout = 5000): Promise<NetworkTimeSample> => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const requestStartedAt = Date.now();
      try {
        const response = await fetch(url, { 
            signal: controller.signal,
            cache: 'no-store',
            headers: { 'Accept': 'application/json, text/plain, */*' }
        });
        clearTimeout(id);
        if (!response.ok) throw new Error(`API Error ${response.status}`);
        
        const text = await response.text();
        let serverTime = 0;

        // Try parsing as JSON first
        try {
            const data = JSON.parse(text);
            // Support multiple API formats
            const dateTimeValue = data.dateTime || data.datetime || data.utc_datetime ||
              data.iso || data.iso8601 || data.currentDateTime || data.currentDateTimeUtc;
            if (dateTimeValue) serverTime = new Date(dateTimeValue).getTime();
            if (!serverTime && typeof data.unixtime === 'number') serverTime = data.unixtime * 1000;
        } catch (e) {
            // Ignore JSON parse error, try text
        }

        // If JSON parsing failed or didn't find time, try parsing text directly
        if (!serverTime) {
            const trimmed = text.trim().replace(/^"|"$/g, '');
            const d = new Date(trimmed);
            if (!isNaN(d.getTime())) {
                serverTime = d.getTime();
            }
        }

        if (!Number.isFinite(serverTime) || serverTime <= 0) throw new Error('Invalid Data Format');
        
        const responseReceivedAt = Date.now();
        const localMidpoint = requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
        const offset = serverTime - localMidpoint;
        // Reject malformed responses instead of treating them as a valid clock.
        if (!Number.isFinite(offset) || Math.abs(offset) > 24 * 60 * 60 * 1000) {
          throw new Error('Invalid time offset');
        }
        return { offset, serverTime };
      } catch (e) {
        clearTimeout(id);
        throw e;
      }
    };

    const syncTask = (async (): Promise<number | null> => {
      try {
        // 同時嘗試多個來源；Promise.any 只採用第一個有效回應。
        const sample = await Promise.any([
          fetchWithTimeout('https://worldtimeapi.org/api/timezone/Asia/Taipei'),
          fetchWithTimeout('https://io.adafruit.com/api/v2/time/ISO-8601'),
          fetchWithTimeout('https://timeapi.io/api/time/current/zone?timeZone=Asia%2FTaipei')
        ]);

        const offset = sample.offset;
        _lastOffset = offset;
        _lastSyncAt = Date.now();
        // Re-anchor on every successful sync. This is the missing step that
        // caused an old tab to keep displaying a stale time indefinitely.
        _anchorServerTime = Date.now() + offset;
        _anchorPerfTime = getMonotonicTime();
        return offset;
      } catch (e) {
        // 網路時間獲取完全失敗，嚴格禁止使用本機時間進行打卡。
        console.error('Time sync failed completely. API unavailable.', e);
        return null;
      }
    })();

    _syncPromise = syncTask;
    try {
      return await syncTask;
    } finally {
      if (_syncPromise === syncTask) _syncPromise = null;
    }
  },

  /**
   * 取得校正後的目前 Date 物件
   * 優先使用 performance.now() 進行推算，完全忽略系統本地時間的變化
   */
  getCorrectedNow: (offset: number): Date => {
    // 如果曾經成功對時過，使用「單調時鐘」算法
    if (_anchorServerTime !== null) {
        const elapsed = getMonotonicTime() - _anchorPerfTime;
        return new Date(_anchorServerTime + elapsed);
    }
    // 降級方案：如果尚未對時成功，只能依賴本地時間 + 偏移量
    // (注意：打卡功能會強制要求 getNetworkTimeOffset() 成功，此處僅供 UI 顯示)
    const safeOffset = Number.isFinite(offset) ? offset : _lastOffset;
    return new Date(Date.now() + safeOffset);
  },

  getLastSyncAt: (): number => _lastSyncAt,

  isSyncFresh: (maxAgeMs = 10 * 60 * 1000): boolean => {
    return _anchorServerTime !== null && _lastSyncAt > 0 && Date.now() - _lastSyncAt <= maxAgeMs;
  },

  getAttendanceDate: (record: AttendanceRecord): string => {
    // Administrator補打卡的 date/time 是指定的實際打卡時間；createdAt
    // 僅代表管理員執行補登的時間，不能拿來取代打卡日期。
    if (record.source === 'admin') return TimeService.getTaiwanDate(record.date);
    const timestamp = record.createdAt as any;
    if (timestamp?.toDate instanceof Function) {
      return TimeService.getTaiwanDate(timestamp.toDate());
    }
    return TimeService.getTaiwanDate(record.date);
  },

  getAttendanceTime: (record: AttendanceRecord, withSeconds = true): string => {
    if (record.source === 'admin') return TimeService.formatTimeOnly(record.time, withSeconds);
    const timestamp = record.createdAt as any;
    if (timestamp?.toDate instanceof Function) {
      return TimeService.getTaiwanTime(timestamp.toDate()).substring(0, withSeconds ? 8 : 5);
    }
    return TimeService.formatTimeOnly(record.time, withSeconds);
  },

  /**
   * 取得台灣時區的日期字串 (YYYY-MM-DD)
   */
  getTaiwanDate: (dateInput: Date | string | number): string => {
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return String(dateInput);
      return d.toLocaleDateString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).replace(/\//g, '-');
    } catch {
      return String(dateInput);
    }
  },

  /**
   * 取得台灣時區的時間字串 (HH:mm:ss)
   */
  getTaiwanTime: (dateInput: Date | string | number): string => {
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('zh-TW', {
        timeZone: 'Asia/Taipei',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '';
    }
  },

  /**
   * 格式化完整的日期時間字串 (YYYY-MM-DD HH:mm[:ss])
   */
  formatDateTime: (dateStr: string, withSeconds = false): string => {
    if (!dateStr) return '--';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) {
            return dateStr.replace('T', ' ').replace('Z', '');
        }
        const datePart = d.toLocaleDateString('zh-TW', {
            timeZone: 'Asia/Taipei',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).replace(/\//g, '-');
        const timePart = d.toLocaleTimeString('zh-TW', {
            timeZone: 'Asia/Taipei',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: withSeconds ? '2-digit' : undefined
        });
        return `${datePart} ${timePart}`;
    } catch {
        return dateStr;
    }
  },

  /**
   * 僅取出時間部分 (HH:mm[:ss])
   */
  formatTimeOnly: (rawTime: string, withSeconds = false): string => {
    if (!rawTime) return '--';
    if (rawTime.includes('T') || rawTime.includes('-')) {
        try {
            const d = new Date(rawTime);
            if (!isNaN(d.getTime())) {
                return d.toLocaleTimeString('zh-TW', {
                    timeZone: 'Asia/Taipei',
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: withSeconds ? '2-digit' : undefined
                });
            }
        } catch { }
    }
    let timePart = rawTime;
    if (timePart.includes('.')) {
        timePart = timePart.split('.')[0];
    }
    const parts = timePart.split(':');
    if (parts.length >= 2) {
        if (withSeconds && parts.length === 3) {
            return `${parts[0]}:${parts[1]}:${parts[2]}`;
        }
        return `${parts[0]}:${parts[1]}`;
    }
    return timePart;
  },

  /**
   * 格式化民國日期字串 (移除民國二字)
   */
  toROCDateString: (date: Date): string => {
    const twDateStr = date.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' });
    const parts = twDateStr.split('/');
    if (parts.length < 3) return twDateStr;
    
    const y = parseInt(parts[0]) - 1911;
    const m = parseInt(parts[1]);
    const d = parseInt(parts[2]);
    const w = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    // 更新：移除 "民國" 兩字
    return `${y} 年 ${m} 月 ${d} 日 (星期${w})`;
  },

  /**
   * 計算請假時數
   */
  calculateLeaveHours: (startStr: string, endStr: string, holidays: Holiday[]): number => {
    if (!startStr || !endStr) return 0;
    const s = new Date(startStr.replace(' ', 'T'));
    const e = new Date(endStr.replace(' ', 'T'));
    if (e <= s) return 0;

    let totalHours = 0;
    let current = new Date(s);
    
    while (current < e) {
        const currentDateStr = TimeService.getTaiwanDate(current);
        const checkDay = new Date(currentDateStr); 
        const dayOfWeek = checkDay.getDay();
        
        const isHoli = holidays.some(h => TimeService.getTaiwanDate(h.date) === currentDateStr) || dayOfWeek === 0 || dayOfWeek === 6;

        if (!isHoli) {
            const workStart = new Date(`${currentDateStr}T08:30:00`);
            const workEnd = new Date(`${currentDateStr}T17:30:00`);
            const lunchStart = new Date(`${currentDateStr}T12:00:00`);
            const lunchEnd = new Date(`${currentDateStr}T13:00:00`);

            const segmentStart = (s > workStart) ? s : workStart;
            const segmentEnd = (e < workEnd) ? e : workEnd;

            if (segmentEnd > segmentStart) {
                let duration = segmentEnd.getTime() - segmentStart.getTime();
                const lunchSegStart = (segmentStart > lunchStart) ? segmentStart : lunchStart;
                const lunchSegEnd = (segmentEnd < lunchEnd) ? segmentEnd : lunchEnd;

                if (lunchSegEnd > lunchSegStart) {
                    duration -= (lunchSegEnd.getTime() - lunchSegStart.getTime());
                }

                if (duration > 0) {
                    totalHours += duration;
                }
            }
        }
        current.setDate(current.getDate() + 1);
        current.setHours(0,0,0,0);
    }

    const h = totalHours / (1000 * 60 * 60);
    return parseFloat((Math.round(h * 2) / 2).toFixed(1));
  }
};
