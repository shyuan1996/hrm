import type { AttendanceRecord } from '../types';

export type AttendanceCompleteness =
  | 'empty'
  | 'complete'
  | 'missing-in'
  | 'missing-out'
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

  const hasIn = chronologicalRecords.some(record => record.type === 'in');
  const hasOut = chronologicalRecords.some(record => record.type === 'out');
  if (!hasIn || chronologicalRecords[0].type === 'out') return 'missing-in';
  if (!hasOut || chronologicalRecords[chronologicalRecords.length - 1].type === 'in') return 'missing-out';
  return 'complete';
};
