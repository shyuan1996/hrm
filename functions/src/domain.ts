// Pure business validation, shared by the server, browser and regression tests.
export const LEAVE_TYPES = ['特休', '補休', '生日假', '事假', '病假', '公假', '婚假', '喪假', '產假', '陪產假', '生理假', '家庭照顧假', '工傷病假', '其他'];
export const DAY = 86400000;
export const TAIPEI_OFFSET = 8 * 3600000;
export function taipeiParts(ms: number) {
  const iso = new Date(ms + TAIPEI_OFFSET).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}
export function parseTaipei(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('日期時間格式不正確');
  const normalized = value.replace('T', ' ');
  const ms = Date.parse(normalized.replace(' ', 'T') + '+08:00');
  if (!Number.isFinite(ms) || (taipeiParts(ms).date + ' ' + taipeiParts(ms).time).slice(0, normalized.length) !== normalized) throw new Error('日期時間不存在');
  return ms;
}
export function interval(start: string, end: string) {
  const s = parseTaipei(start), e = parseTaipei(end);
  if (e <= s || e - s > 366 * DAY) throw new Error('結束時間須晚於開始時間，區間不得超過一年');
  return [s, e] as const;
}
export function workSegments(date: string, holidays: string[] = []): [number, number][] {
  const midnight = parseTaipei(date + ' 00:00');
  const weekday = new Date(midnight + TAIPEI_OFFSET).getUTCDay();
  if (weekday === 0 || weekday === 6 || holidays.includes(date)) return [];
  return [[parseTaipei(date + ' 08:30'), parseTaipei(date + ' 12:00')], [parseTaipei(date + ' 13:00'), parseTaipei(date + ' 17:30')]];
}
export function leaveHours(start: string, end: string, holidays: string[] = []): number {
  const [s, e] = interval(start, end);
  let minutes = 0;
  for (let day = parseTaipei(taipeiParts(s).date + ' 00:00'); day < e; day += DAY) {
    for (const [a, b] of workSegments(taipeiParts(day).date, holidays)) minutes += Math.max(0, Math.min(e, b) - Math.max(s, a)) / 60000;
  }
  return Math.round(minutes / 30) / 2;
}
export function validHours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 744 || value * 2 !== Math.round(value * 2)) throw new Error('時數須為 0.5 至 744 小時，並以半小時為單位');
  return value;
}
export function distanceMeters(lat: number, lng: number, settings: any): number {
  const a = Number(settings?.companyLat), b = Number(settings?.companyLng), radius = Number(settings?.allowedRadius);
  if (![lat, lng, a, b, radius].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0) || radius <= 0 || radius > 20000000) throw new Error('定位或公司打卡範圍設定無效，請聯絡管理員');
  const rad = (n: number) => n * Math.PI / 180;
  const h = Math.sin(rad(lat-a)/2)**2 + Math.cos(rad(a))*Math.cos(rad(lat))*Math.sin(rad(lng-b)/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1-h)));
}
export function safeAttachments(input: unknown, uid: string, userId: string): {name: string; path: string; url: string}[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 3) throw new Error('附件最多三份');
  const seen = new Set<string>();
  return input.map(a => {
    if (!a || typeof a !== 'object' || typeof a.name !== 'string' || !a.name || a.name.length > 255 || typeof a.path !== 'string' || typeof a.url !== 'string' || a.url.length > 4096) throw new Error('附件資料格式不正確');
    const parts = a.path.split('/');
    if (parts.length !== 3 || parts[0] !== 'leave_attachments' || ![uid, userId].includes(parts[1]) || !parts[2] || parts[2] === '.' || parts[2] === '..' || seen.has(a.path)) throw new Error('附件不屬於此員工或路徑重複');
    const url = new URL(a.url);
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || decodeURIComponent(url.pathname.split('/o/')[1] || '') !== a.path) throw new Error('附件下載網址不正確');
    seen.add(a.path);
    return {name:a.name, path:a.path, url:a.url};
  });
}
const fields: Record<string, string> = { '特休':'quota_annual', '補休':'quota_comp', '生日假':'quota_birthday' };
// Do not migrate or add legacy and bucket balances together. For each leave
// type, existing buckets are authoritative; legacy-only types stay legacy.
export function quotaTransition(profile: any, previous: any | null, next: any | null, today: string) {
  const p = JSON.parse(JSON.stringify(profile));
  const updates: Record<string, any> = {};
  const buckets: any[] = p.quotas || [];
  if (!Array.isArray(buckets)) throw new Error('員工額度格式錯誤，請先核對');
  const usedBuckets: {bucketId: string; hours: number}[] = [];
  const amount = (n: unknown): number => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error('額度資料異常，請先核對');
    return n;
  };
  if (previous?.status === 'approved' && fields[previous.type]) {
    const field = fields[previous.type], hours = validHours(previous.hours);
    if (Array.isArray(previous.usedBuckets) && previous.usedBuckets.length) {
      let refunded = 0;
      for (const used of previous.usedBuckets) {
        const bucket = buckets.find(b => b.id === used.bucketId && b.type === previous.type);
        if (!bucket || amount(bucket.remainingHours) + amount(used.hours) > amount(bucket.originalHours) + 0.000001) throw new Error('原扣抵額度已變動，請先核對，未自動增加額度');
        bucket.remainingHours += used.hours; refunded += used.hours;
      }
      if (Math.abs(refunded - hours) > 0.000001) throw new Error('原假單扣抵明細不完整，請先核對');
    } else if (buckets.some(b => b.type === previous.type)) {
      throw new Error('舊假單沒有扣抵明細，請先核對額度，避免重複歸還');
    }
    p[field] = amount(p[field] ?? 0) + hours;
    updates[field] = p[field];
  }
  if (next?.status === 'approved' && fields[next.type]) {
    const hours = validHours(next.hours), field = fields[next.type];
    const sameType = buckets.filter(b => b.type === next.type);
    if (sameType.length) {
      // Preserve the existing approval-date expiry policy in this patch.
      // Future grants and data migration require a separately reviewed policy.
      const valid = sameType.filter(b => b.expireDate >= today).sort((a,b) => a.expireDate.localeCompare(b.expireDate) || a.addedDate.localeCompare(b.addedDate));
      if (valid.reduce((sum,b) => sum + amount(b.remainingHours), 0) < hours) throw new Error('此假別剩餘時數不足，未核准也未扣額度');
      let remaining = hours;
      for (const b of valid) { const used = Math.min(amount(b.remainingHours), remaining); if (used > 0) { b.remainingHours -= used; remaining -= used; usedBuckets.push({bucketId:b.id, hours:used}); } }
      p[field] = Math.max(0, amount(p[field] ?? 0) - hours);
    } else {
      if (amount(p[field] ?? 0) < hours) throw new Error('此假別剩餘時數不足，未核准也未扣額度');
      p[field] -= hours;
    }
    updates[field] = p[field];
  }
  if (buckets.length) updates.quotas = buckets;
  return {updates, usedBuckets};
}
