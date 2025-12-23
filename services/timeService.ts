
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
   * 檢查時間偏移是否在容許範圍內（例如 3 分鐘）
   */
  isTimeIntegrityValid: (offset: number): boolean => {
    return Math.abs(offset) < 180000; // 3 minutes
  },

  /**
   * 格式化 24 小時制日期時間字串
   */
  formatFullDateTime: (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
  },

  /**
   * 格式化民國日期字串
   */
  toROCDateString: (date: Date): string => {
    const y = date.getFullYear() - 1911;
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const w = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return `民國 ${y} 年 ${m} 月 ${d} 日 (星期${w})`;
  },

  /**
   * 計算請假時數 (核心邏輯)
   * 排除假期、週末、午休(12:00-13:00)
   * 工作時間: 08:30 - 17:30
   */
  calculateLeaveHours: (startStr: string, endStr: string, holidays: Holiday[]): number => {
    if (!startStr || !endStr) return 0;
    
    // Replace space with T for Safari/iOS compatibility
    const startDateTime = new Date(startStr.replace(' ', 'T'));
    const endDateTime = new Date(endStr.replace(' ', 'T'));
    
    if (endDateTime <= startDateTime) return 0;

    let totalHours = 0;
    
    // Create a cursor date starting at midnight of the start date
    let current = new Date(startDateTime);
    current.setHours(0, 0, 0, 0);
    
    const endDay = new Date(endDateTime);
    endDay.setHours(0, 0, 0, 0);

    // Loop through each day from start date to end date
    while (current <= endDay) {
        // Construct YYYY-MM-DD using local time explicitly to avoid UTC shift issues
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');
        const dStr = `${year}-${month}-${day}`;

        // Check against holidays using the local date string
        const isHoli = holidays.some(h => h.date === dStr) || current.getDay() === 0 || current.getDay() === 6;

        if (!isHoli) {
            // Work hours: 08:30 - 17:30 (Construct dates using the current cursor day string)
            const workStart = new Date(`${dStr}T08:30:00`);
            const workEnd = new Date(`${dStr}T17:30:00`);
            
            // Lunch break: 12:00 - 13:00
            const lunchStart = new Date(`${dStr}T12:00:00`);
            const lunchEnd = new Date(`${dStr}T13:00:00`);

            // Determine actual start/end for this specific day
            // If the leave starts on this day, use the leave start time, otherwise use work start time
            let dayReqStart = (dStr === startDateTime.toISOString().split('T')[0]) ? startDateTime : workStart;
            // Note: Use simple string comparison for day equality to be safe or rely on logic flow
            if (current.getTime() === new Date(startDateTime).setHours(0,0,0,0)) {
                 dayReqStart = startDateTime;
            }

            let dayReqEnd = (dStr === endDateTime.toISOString().split('T')[0]) ? endDateTime : workEnd;
            if (current.getTime() === new Date(endDateTime).setHours(0,0,0,0)) {
                 dayReqEnd = endDateTime;
            }

            // Clamp request times to work hours boundaries
            if (dayReqStart < workStart) dayReqStart = workStart;
            if (dayReqEnd > workEnd) dayReqEnd = workEnd;

            // Only calculate if there's a valid interval within work hours
            if (dayReqEnd > dayReqStart) {
                let durationMs = dayReqEnd.getTime() - dayReqStart.getTime();

                // Check lunch overlap logic
                const overlapStart = dayReqStart < lunchStart ? lunchStart : dayReqStart;
                const overlapEnd = dayReqEnd > lunchEnd ? lunchEnd : dayReqEnd;

                if (overlapEnd > overlapStart) {
                    // There is an overlap with lunch time
                    // Ensure we are strictly within lunch bounds to deduct
                    const actualOverlapStart = overlapStart < lunchStart ? lunchStart : overlapStart;
                    const actualOverlapEnd = overlapEnd > lunchEnd ? lunchEnd : overlapEnd;
                    
                    const deduction = actualOverlapEnd.getTime() - actualOverlapStart.getTime();
                    if(deduction > 0) durationMs -= deduction;
                }
                
                totalHours += durationMs / (1000 * 60 * 60);
            }
        }
        // Move to next day
        current.setDate(current.getDate() + 1);
    }

    // Round to nearest 0.5
    return parseFloat((Math.round(totalHours * 2) / 2).toFixed(1));
  }
};
