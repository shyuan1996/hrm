
import { Holiday } from '../types';

export const TimeService = {
  /**
   * 取得網路標準時間與本地時間的差值（毫秒）
   * 使用 timeapi.io
   */
  getNetworkTimeOffset: async (): Promise<number> => {
    try {
      // 使用 timeapi.io 取得台北時間
      const response = await fetch('https://www.timeapi.io/api/Time/current/zone?timeZone=Asia/Taipei');
      if (!response.ok) throw new Error('Time API failed');
      const data = await response.json();
      const serverTime = new Date(data.dateTime).getTime();
      const localTime = Date.now();
      return serverTime - localTime;
    } catch (e) {
      console.warn("無法從 timeapi.io 取得時間，回退至本地時間", e);
      return 0;
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
