import type { AttendanceRecord } from '../types';

export type AttendanceCompleteness =
  | 'empty'
  | 'complete'
  | 'missing-in'
  | 'missing-out'
  | 'invalid-sequence'
  | 'invalid';

/**
 * Fail closed: a day is complete only when every record has a recognized type,
 * the first recognized event is an IN and the final event is an OUT.
 */
export const analyzeAttendanceCompleteness = (
  chronologicalRecords: AttendanceRecord[]
): AttendanceCompleteness => {
  if (chronologicalRecords.length === 0) return 'empty';
  if (chronologicalRecords.some(record => record.type !== 'in' && record.type !== 'out')) {
    return 'invalid';
  }

  const records = [...chronologicalRecords].sort((a, b) => {
    const left = `${a.date || ''} ${a.time || ''}`;
    const right = `${b.date || ''} ${b.time || ''}`;
    return left.localeCompare(right);
  });
  const hasIn = records.some(record => record.type === 'in');
  const hasOut = records.some(record => record.type === 'out');
  if (!hasIn || records[0].type === 'out') return 'missing-in';
  if (!hasOut || records[records.length - 1].type === 'in') return 'missing-out';

  // A valid day alternates IN -> OUT. Duplicate consecutive punches are
  // reported separately instead of being silently treated as normal.
  let expected: AttendanceRecord['type'] = 'in';
  for (const record of records) {
    if (record.type !== expected) return 'invalid-sequence';
    expected = expected === 'in' ? 'out' : 'in';
  }
  return 'complete';
};

export const getAttendanceCompletenessLabel = (status: AttendanceCompleteness): string => {
  switch (status) {
    case 'missing-in': return '缺上班卡';
    case 'missing-out': return '缺下班卡';
    case 'invalid-sequence': return '打卡順序異常';
    case 'invalid': return '無法辨識的打卡紀錄';
    case 'empty': return '曠職/未打卡';
    default: return '正常';
  }
};
