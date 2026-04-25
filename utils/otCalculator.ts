export const calculateOTWithDeduction = (
    currentOtStart: Date,
    currentOtEnd: Date,
    existingOts: { start: string, end: string, hours: number }[]
): number => {
    type Interval = { start: number, end: number, isExisting: boolean };
    const allIntervals: Interval[] = [];
    
    existingOts.forEach(ot => {
        allIntervals.push({
            start: new Date(ot.start.replace(' ', 'T')).getTime(),
            end: new Date(ot.end.replace(' ', 'T')).getTime(),
            isExisting: true
        });
    });
    
    const newStartMs = currentOtStart.getTime();
    const newEndMs = currentOtEnd.getTime();
    
    if (newEndMs <= newStartMs) return 0;
    
    allIntervals.push({ start: newStartMs, end: newEndMs, isExisting: false });
    
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
                const deduction = Math.max(0, 1 - clusterRest);
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
