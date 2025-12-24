
import { Holiday } from '../types';

export const TimeService = {
  /**
   * 取得網路標準時間與本地時間的差值（毫秒）
   * 優化：同時請求多個來源，取最快回應者。
   * 嚴格模式：若全失敗，回傳 null (禁止使用本地時間)。
   */
  getNetworkTimeOffset: async (): Promise<number | null> => {
    const fetchWithTimeout = async (url: string, timeout = 5000) => {
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
            // timeapi.io: dateTime
            // worldtimeapi.org: datetime
            // general: utc_datetime, iso
            const dateTimeStr = data.dateTime || data.datetime || data.utc_datetime || data.iso;
            if (dateTimeStr) {
                serverTime = new Date(dateTimeStr).getTime();
            }
        } catch (e) {
            // Ignore JSON parse error, try text
        }

        // If JSON parsing failed or didn't find time, try parsing text directly (e.g. Adafruit returns raw ISO string)
        if (!serverTime) {
            const trimmed = text.trim().replace(/^"|"$/g, ''); // Remove surrounding quotes if present
            const d = new Date(trimmed);
            if (!isNaN(d.getTime())) {
                serverTime = d.getTime();
            }
        }

        if (!serverTime) throw new Error('Invalid Data Format');
        
        const localTime = Date.now();
        return serverTime - localTime;
      } catch (e) {
        clearTimeout(id);
        throw e;
      }
    };

    // Helper to simulate Promise.any behavior for older environments/TS configs
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
              reject(new Error('All promises rejected: ' + e?.message));
            }
          });
        });
      });
    };

    try {
      // Race 模式：誰先回來就用誰，大幅縮短體感等待時間
      // Added Adafruit IO as a fallback source
      const offset = await promiseAny([
        fetchWithTimeout('https://timeapi.io/api/Time/current/zone?timeZone=Asia/Taipei'),
        fetchWithTimeout('https://worldtimeapi.org/api/timezone/Asia/Taipei'),
        fetchWithTimeout('https://io.adafruit.com/api/v2/time/ISO-8601')
      ]);
      return offset;
    } catch (e) {
      console.error("無法取得網路時間 (嚴格模式: 禁止使用本地時間)", e);
      // 回傳 null 表示校正失敗，UI 應保持鎖定
      return null;
    }
  },

  /**
   * 取得校正後的目前 Date 物件
   */
  getCorrectedNow: (offset: number): Date => {
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
   * @param dateStr 原始時間字串
   * @param withSeconds 是否包含秒數 (預設 false)
   */
  formatDateTime: (dateStr: string, withSeconds = false): string => {
    if (!dateStr) return '--';
    
    // 嘗試解析
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) {
            // 如果解析失敗，且字串看起來像簡單格式，則直接返回
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
   * @param rawTime 原始時間字串
   * @param withSeconds 是否包含秒數 (預設 false)
   */
  formatTimeOnly: (rawTime: string, withSeconds = false): string => {
    if (!rawTime) return '--';
    
    // 如果包含 T，通常是 ISO 格式，先轉 Date 再取時間
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
        } catch { /* ignore */ }
    }
    
    // 處理純時間字串 HH:mm:ss
    let timePart = rawTime;
    // 去除 .000Z 等可能的後綴
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
   * 格式化民國日期字串
   */
  toROCDateString: (date: Date): string => {
    const twDateStr = date.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' });
    const parts = twDateStr.split('/');
    if (parts.length < 3) return twDateStr;
    
    const y = parseInt(parts[0]) - 1911;
    const m = parseInt(parts[1]);
    const d = parseInt(parts[2]);
    const w = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return `民國 ${y} 年 ${m} 月 ${d} 日 (星期${w})`;
  },

  /**
   * 計算請假時數 (核心邏輯)
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
