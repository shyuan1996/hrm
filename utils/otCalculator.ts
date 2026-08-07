export const calculateOTWithDeduction = (
    currentOtStart: Date,
    currentOtEnd: Date,
    existingOts: { start: string, end: string, hours: number }[]
): number => {
    type Interval = { start: number, end: number, isExisting: boolean };
    const allIntervals: Interval[] = [];

    /**
     * Weekday overtime is eligible from 18:00.  The 17:30-18:00 period is
     * the regular break, so an interval that starts before 18:00 is clipped
     * instead of trusting a client-provided duration.  Splitting at midnight
     * also keeps a multi-day request deterministic.
     */
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
            const weekdayCutoff = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0, 0, 0).getTime();
            const eligibleStart = weekday ? Math.max(segmentStart, weekdayCutoff) : segmentStart;

            if (segmentEnd > eligibleStart) {
                segments.push({ start: eligibleStart, end: segmentEnd });
            }
            day = nextDay;
        }
        return segments;
    };
    
    existingOts.forEach(ot => {
        const start = new Date(ot.start.replace(' ', 'T'));
        const end = new Date(ot.end.replace(' ', 'T'));
        eligibleSegments(start, end).forEach(segment => {
            allIntervals.push({ ...segment, isExisting: true });
        });
    });
    
    const newStartMs = currentOtStart.getTime();
    const newEndMs = currentOtEnd.getTime();
    
    if (newEndMs <= newStartMs) return 0;
    
    eligibleSegments(currentOtStart, currentOtEnd).forEach(segment => {
        allIntervals.push({ ...segment, isExisting: false });
    });
    
    // Helper to compute net hours for a set of intervals
    const computeNetHours = (intervals: Interval[]) => {
        if (intervals.length === 0) return 0;
        
        // 1. Sort and merge overlapping intervals
        intervals.sort((a, b) => a.start - b.start);
        const merged: {start: number, end: number}[] = [];
        for (const inter of intervals) {
            if (merged.length === 0) {
                merged.push({ start: inter.start, end: inter.end });
            } else {
                const last = merged[merged.length - 1];
                if (inter.start <= last.end) {
                    last.end = Math.max(last.end, inter.end);
                } else {
                    merged.push({ start: inter.start, end: inter.end });
                }
            }
        }
        
        // 2. Cluster merged intervals by gap < 1 hour
        const ONE_HOUR = 3600000;
        const clusters: { spans: {start: number, end: number}[] }[] = [];
        
        for (const span of merged) {
            if (clusters.length === 0) {
                clusters.push({ spans: [span] });
            } else {
                const lastCluster = clusters[clusters.length - 1];
                const lastSpan = lastCluster.spans[lastCluster.spans.length - 1];
                const gap = span.start - lastSpan.end;
                
                if (gap < ONE_HOUR) {
                    lastCluster.spans.push(span);
                } else {
                    clusters.push({ spans: [span] });
                }
            }
        }
        
        // 3. Compute net time for each cluster
        let totalNet = 0;
        for (const cluster of clusters) {
            let clusterGross = 0;
            for (const s of cluster.spans) {
                clusterGross += (s.end - s.start) / ONE_HOUR;
            }
            
            let clusterRest = 0;
            for (let i = 0; i < cluster.spans.length - 1; i++) {
                clusterRest += (cluster.spans[i+1].start - cluster.spans[i].end) / ONE_HOUR;
            }
            
            let clusterNet = clusterGross;
            if (clusterGross > 4) { // "連續超過四小時"
                let requiredRest = 1; // Default to 1 hour
                if (clusterGross < 5) {
                    requiredRest = clusterGross - 4; // Auto deduct excess over 4 as rest
                }
                const deduction = Math.max(0, requiredRest - clusterRest);
                clusterNet -= deduction;
            }
            totalNet += clusterNet;
        }
        
        return totalNet;
    };
    
    const totalNet = computeNetHours(allIntervals);
    const prevNet = computeNetHours(allIntervals.filter(i => i.isExisting));
    
    let newCalculated = totalNet - prevNet;
    if (newCalculated < 0) newCalculated = 0;
    
    return parseFloat(newCalculated.toFixed(1));
};
