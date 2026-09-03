/**
 * Calculate the billable overtime hours for a new request.
 *
 * Weekdays exclude the regular 08:30-17:30 working interval. Weekends and
 * configured holidays are fully eligible. Existing requests are merged with
 * the new request so an employee cannot claim the same minutes twice.
 * Every continuous four-hour block requires a 30-minute rest; an already
 * separated gap shorter than one hour is treated as that rest and is not
 * deducted a second time.
 */
export const calculateOTWithDeduction = (
  currentOtStart: Date,
  currentOtEnd: Date,
  existingOts: { start: string, end: string, hours: number }[],
  holidayDates: string[] = []
): number => {
  type Interval = { start: number, end: number, isExisting: boolean };
  const allIntervals: Interval[] = [];
  const ONE_HOUR = 60 * 60 * 1000;

  const dateKey = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const holidaySet = new Set(
    holidayDates
      .map(value => String(value || '').replace('T', ' ').slice(0, 10))
      .filter(Boolean)
  );

  const parseDate = (value: string): Date | null => {
    const parsed = new Date(String(value || '').replace(' ', 'T'));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };

  const eligibleSegments = (start: Date, end: Date): { start: number, end: number }[] => {
    const startMs = start.getTime();
    const endMs = end.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

    const segments: { start: number, end: number }[] = [];
    let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    while (day <= lastDay) {
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);
      const segmentStart = Math.max(startMs, day.getTime());
      const segmentEnd = Math.min(endMs, nextDay.getTime());
      const weekday = day.getDay() >= 1 && day.getDay() <= 5;
      const isRegularWorkday = weekday && !holidaySet.has(dateKey(day));

      if (segmentEnd > segmentStart) {
        if (!isRegularWorkday) {
          segments.push({ start: segmentStart, end: segmentEnd });
        } else {
          // Keep only the portions outside the regular daytime schedule.
          const normalStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8, 30, 0, 0).getTime();
          const normalEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17, 30, 0, 0).getTime();
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

    // A short gap can be the legally required rest between two requests. A
    // long gap (for example the regular daytime schedule) starts a new block.
    const clusters: { start: number, end: number, rest: number }[] = [];
    for (const span of merged) {
      const last = clusters[clusters.length - 1];
      if (!last || span.start - last.end >= ONE_HOUR) {
        clusters.push({ start: span.start, end: span.end, rest: 0 });
      } else {
        last.rest += Math.max(0, span.start - last.end);
        last.end = span.end;
      }
    }

    let total = 0;
    for (const cluster of clusters) {
      const grossHours = (cluster.end - cluster.start) / ONE_HOUR - cluster.rest / ONE_HOUR;
      // Every completed four hours requires a 30-minute rest.  Thus a
      // continuous four-hour request is billed as 3.5 hours, while an
      // eight-hour request carries two 30-minute breaks.
      const requiredBreaks = grossHours >= 4 ? Math.floor(grossHours / 4) : 0;
      const requiredRestHours = requiredBreaks * 0.5;
      const alreadyRestedHours = cluster.rest / ONE_HOUR;
      total += Math.max(0, grossHours - Math.max(0, requiredRestHours - alreadyRestedHours));
    }
    return total;
  };

  const totalNet = computeNetHours(allIntervals);
  const previousNet = computeNetHours(allIntervals.filter(interval => interval.isExisting));
  const marginal = Math.max(0, totalNet - previousNet);
  return parseFloat((Math.round(marginal * 2) / 2).toFixed(1));
};
