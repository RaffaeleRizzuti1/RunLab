import type { createGarminClient } from './garmin.js';
import { heartRateZoneKeys } from './heart-rate-zones.js';
import { activityDate } from './training-history.js';

type Run = Awaited<ReturnType<ReturnType<typeof createGarminClient>['getActivitiesInDateRange']>>[number];

function measurement(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function buildAthleteContext(activities: readonly Run[], today: string, since: string) {
  const runs = activities.flatMap((activity) => {
    if (!activity.isRunning) return [];
    const date = activityDate(activity.startTimeGmt);
    if (!date || date < since || date > today) return [];
    const meters = measurement(activity.distance, 0);
    const distanceKm = meters === null ? null : meters / 1_000;
    const durationSeconds = measurement(activity.duration, 0);
    const averageHeartRateBpm = measurement(activity.averageHeartRate, 1, 300);
    const maxHeartRate = measurement(activity.maxHeartRate, 1, 300);
    return [{
      daysAgo: (Date.parse(today) - Date.parse(date)) / 86_400_000,
      distanceKm,
      durationSeconds,
      averagePaceSecondsPerKm: distanceKm && durationSeconds ? measurement(durationSeconds / distanceKm, 1) : null,
      averageHeartRateBpm,
      maxHeartRateBpm: maxHeartRate !== null && maxHeartRate >= (averageHeartRateBpm ?? 0) ? maxHeartRate : null,
      averageCadenceStepsPerMinute: measurement(activity.averageCadence, 1),
      recordedZoneSeconds: Object.fromEntries(heartRateZoneKeys.map((zone) => [
        zone, measurement(activity.heartRateZoneSeconds?.[zone], 0),
      ])),
    }];
  }).sort((left, right) => left.daysAgo - right.daysAgo);

  const recentRuns = runs.slice(0, 12);
  const paired = recentRuns.filter(({ averagePaceSecondsPerKm, averageHeartRateBpm }) =>
    averagePaceSecondsPerKm !== null && averageHeartRateBpm !== null);
  const longestRecentRuns = runs.filter(({ distanceKm }) => distanceKm !== null && distanceKm > 0)
    .sort((left, right) => right.distanceKm! - left.distanceKm!)
    .slice(0, 2).map(({ daysAgo, distanceKm, durationSeconds }) => ({ daysAgo, distanceKm, durationSeconds }));
  let observedHeartRateBpm = null;
  if (paired.length >= 2) {
    const min = Math.ceil(Math.min(...paired.map((run) => run.averageHeartRateBpm!)));
    const max = Math.floor(Math.max(...paired.map((run) => run.maxHeartRateBpm ?? run.averageHeartRateBpm!)));
    if (min <= max) observedHeartRateBpm = { min, max };
  }
  return { recentRuns, longestRecentRuns, paceHeartRateSampleCount: paired.length, observedHeartRateBpm };
}
