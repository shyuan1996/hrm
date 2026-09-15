export function creationTime(item: any): number {
  const raw=item?.createdAt;
  if(raw?.toMillis)return raw.toMillis();
  if(raw?.toDate)return raw.toDate().getTime();
  if(raw instanceof Date)return raw.getTime();
  if(typeof raw==='string' && Number.isFinite(Date.parse(raw)))return Date.parse(raw);
  return Number(item?.legacyId ?? item?.id) || 0;
}
