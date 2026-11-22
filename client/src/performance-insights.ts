export type PerformanceActivity = {
  distanceKm: number;
  durationSeconds: number;
  averageHeartRate: number;
  averagePaceSecondsPerKm: number;
};

// The comparison endpoint returns runs in chronological order.
export function calculatePerformanceInsights(activities: readonly PerformanceActivity[]) {
  const totalComparedRuns = activities.length;
  let totalDuration = 0;
  let totalDistance = 0;

  for (const activity of activities) {
    totalDuration += activity.durationSeconds;
    totalDistance += activity.distanceKm;
  }

  const first = activities[0];
  const last = activities[totalComparedRuns - 1];

  return {
    totalComparedRuns,
    averagePaceSecondsPerKm: totalDistance > 0 ? totalDuration / totalDistance : null,
    paceChangeSecondsPerKm: totalComparedRuns >= 2
      ? last.averagePaceSecondsPerKm - first.averagePaceSecondsPerKm
      : null,
    averageHeartRateChangeBpm: totalComparedRuns >= 2
      ? last.averageHeartRate - first.averageHeartRate
      : null,
  };
}
