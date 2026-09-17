/**
 * Calculate the billable overtime hours for a new request.
 *
 * Weekdays exclude the regular 08:30-17:30 working interval. Weekends and
 * configured holidays are fully eligible. Existing requests are merged with
 * the new request so an employee cannot claim the same minutes twice.
 * Count four hours of work first, then reserve the NEXT 30 minutes for rest.
 * A request ending at the four-hour boundary retains all four hours. Gaps
 * during a due rest period satisfy that rest instead of being deducted twice.
 */
export const calculateOTWithDeduction = (
  currentOtStart: Date,
  currentOtEnd: Date,
  existingOts: { start: string, end: string, hours: number }[],
  holidayDates: string[] = []
): number => {
  // All arithmetic is on a UTC representation of Taiwan wall time.
  currentOtStart = new Date(currentOtStart.getTime() + 8 * 3600000);
  currentOtEnd = new Date(currentOtEnd.getTime() + 8 * 3600000);
  type Interval = { start: number, end: number, isExisting: boolean };
  const allIntervals: Interval[] = [];
  const ONE_HOUR = 60 * 60 * 1000;

  const dateKey = (date: Date): string => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const holidaySet = new Set(
    holidayDates
      .map(value => String(value || '').replace('T', ' ').slice(0, 10))
      .filter(Boolean)
  );

  const parseDate = (value: string): Date | null => {
    const parsed = new Date(String(value || '').replace(' ', 'T') + 'Z');
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };

  const eligibleSegments = (start: Date, end: Date): { start: number, end: number }[] => {
    const startMs = start.getTime();
    const endMs = end.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

    const segments: { start: number, end: number }[] = [];
    let day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

    while (day <= lastDay) {
      const nextDay = new Date(day);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const segmentStart = Math.max(startMs, day.getTime());
      const segmentEnd = Math.min(endMs, nextDay.getTime());
      const weekday = day.getUTCDay() >= 1 && day.getUTCDay() <= 5;
      const isRegularWorkday = weekday && !holidaySet.has(dateKey(day));

      if (segmentEnd > segmentStart) {
        if (!isRegularWorkday) {
          segments.push({ start: segmentStart, end: segmentEnd });
        } else {
          // Keep only the portions outside the regular daytime schedule.
          const normalStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 8, 30, 0, 0)).getTime();
          const normalEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17, 30, 0, 0)).getTime();
          if (segmentStart < normalStart) {
            segments.push({ start: segmentStart, end: Math.min(segmentEnd, normalStart) });
          }
          if (segmentEnd > normalEnd) {
            segments.push({ start: Math.max(segmentStart, normalEnd), end: segmentEnd });
          }
        }
      }
      day = nextDay;
    }
    return segments.filter(segment => segment.end > segment.start);
  };

  existingOts.forEach(ot => {
    const start = parseDate(ot.start);
    const end = parseDate(ot.end);
    if (!start || !end) return;
    eligibleSegments(start, end).forEach(segment => {
      allIntervals.push({ ...segment, isExisting: true });
    });
  });

  const newStartMs = currentOtStart.getTime();
  const newEndMs = currentOtEnd.getTime();
  if (!Number.isFinite(newStartMs) || !Number.isFinite(newEndMs) || newEndMs <= newStartMs) return 0;

  eligibleSegments(currentOtStart, currentOtEnd).forEach(segment => {
    allIntervals.push({ ...segment, isExisting: false });
  });

  const computeNetHours = (intervals: Interval[]): number => {
    if (intervals.length === 0) return 0;

    // Merge overlapping intervals first, otherwise duplicated requests would
    // inflate both the gross hours and the rest calculation.
    const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: { start: number, end: number }[] = [];
    for (const interval of sorted) {
      const last = merged[merged.length - 1];
      if (!last || interval.start > last.end) {
        merged.push({ start: interval.start, end: interval.end });
      } else {
        last.end = Math.max(last.end, interval.end);
      }
    }

    const WORK_BLOCK = 4 * ONE_HOUR;
    const REST_BLOCK = ONE_HOUR / 2;
    let worked = 0;
    let restRemaining = 0;
    let total = 0;
    let previousEnd: number | undefined;
    for (const span of merged) {
      if (previousEnd !== undefined) {
        const gap = span.start - previousEnd;
        // Preserve the existing long-gap reset (including normal office hours).
        if (gap >= ONE_HOUR) {
          worked = 0;
          restRemaining = 0;
        } else if (restRemaining > 0) {
          // Only a gap AFTER four hours can satisfy the rest now due.
          restRemaining = Math.max(0, restRemaining - gap);
          if (restRemaining === 0) worked = 0;
        }
      }
      let remaining = span.end - span.start;
      while (remaining > 0) {
        if (restRemaining > 0) {
          const rest = Math.min(remaining, restRemaining);
          remaining -= rest;
          restRemaining -= rest;
          if (restRemaining === 0) worked = 0;
        } else {
          const work = Math.min(remaining, WORK_BLOCK - worked);
          remaining -= work;
          worked += work;
          total += work;
          // Mark future rest; never subtract from work already counted.
          if (worked === WORK_BLOCK) restRemaining = REST_BLOCK;
        }
      }
      previousEnd = span.end;
    }
    return total / ONE_HOUR;
  };

  const totalNet = computeNetHours(allIntervals);
  const previousNet = computeNetHours(allIntervals.filter(interval => interval.isExisting));
  const marginal = Math.max(0, totalNet - previousNet);
  return parseFloat((Math.round(marginal * 2) / 2).toFixed(1));
};
