
import { Holiday } from '../types';

// 使用模組級變數作為 Singleton 狀態儲存
// 這是為了確保時間計算基準點 (Anchor) 唯一且不受元件重繪影響
let _anchorServerTime: number | null = null; // 基準網路時間 (毫秒)
let _anchorPerfTime: number = 0;             // 取得基準時的 performance.now() (毫秒)

export const TimeService = {
  /**
   * 取得網路標準時間與本地時間的差值（毫秒）
   * 並且建立單調計時器錨點 (Monotonic Anchor)，防止使用者修改系統時間作弊。
   * 若所有 API 請求都失敗，回傳 null (代表時間驗證失敗，禁止操作)。
   */
  getNetworkTimeOffset: async (): Promise<number | null> => {
    const fetchWithTimeout = async (url: string, timeout = 3000) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
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
            const dateTimeStr = data.dateTime || data.datetime || data.utc_datetime || data.iso;
            if (dateTimeStr) {
                serverTime = new Date(dateTimeStr).getTime();
            }
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

        if (!serverTime) throw new Error('Invalid Data Format');
        
        // 核心邏輯：建立時間錨點
        _anchorServerTime = serverTime;
        _anchorPerfTime = performance.now();

        const localTime = Date.now();
        return serverTime - localTime;
      } catch (e) {
        clearTimeout(id);
        throw e;
      }
    };

    // Helper to simulate Promise.any behavior
    const promiseAny = <T>(promises: Promise<T>[]): Promise<T> => {
      return new Promise((resolve, reject) => {
        let rejectedCount = 0;
        if (promises.length === 0) {
          return reject(new Error('No promises passed'));
        }
        promises.forEach(p => {
          Promise.resolve(p).then(resolve).catch((e) => {
            rejectedCount++;
            if (rejectedCount === promises.length) {
              reject(new Error('All promises rejected'));
            }
          });
        });
      });
    };

    try {
      // Race 模式：嘗試多個來源
      const offset = await promiseAny([
        fetchWithTimeout('https://timeapi.io/api/Time/current/zone?timeZone=Asia/Taipei'),
        fetchWithTimeout('https://worldtimeapi.org/api/timezone/Asia/Taipei'),
        fetchWithTimeout('https://io.adafruit.com/api/v2/time/ISO-8601')
      ]);
      return offset;
    } catch (e) {
      // 網路時間獲取失敗，嚴格禁止使用本機時間
      console.error("Time sync failed completely."); 
      return null;
    }
  },

  /**
   * 取得校正後的目前 Date 物件
   * 優先使用 performance.now() 進行推算，完全忽略系統本地時間的變化
   */
  getCorrectedNow: (offset: number): Date => {
    // 如果曾經成功對時過，使用「單調時鐘」算法
    if (_anchorServerTime !== null) {
        const elapsed = performance.now() - _anchorPerfTime;
        return new Date(_anchorServerTime + elapsed);
    }
    // 降級方案：如果尚未對時成功，只能依賴本地時間 + 偏移量
    return new Date(Date.now() + offset);
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
