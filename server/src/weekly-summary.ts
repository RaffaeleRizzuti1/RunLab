import { romeDate, type Week } from './rome-calendar.js';
import { heartRateZoneKeys, type HeartRateZones } from './heart-rate-zones.js';

type WeeklyActivity = {
  isRunning: boolean;
  startTimeGmt?: string;
  distance?: number;
  duration?: number;
  heartRateZoneSeconds?: Partial<Record<typeof heartRateZoneKeys[number], unknown>>;
};

function nonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function summarizeWeek(week: Week, activities: readonly WeeklyActivity[]) {
  let distanceMeters = 0;
  let durationSeconds = 0;
  let activityCount = 0;
  const heartRateZones: HeartRateZones = {
    seconds: { z1: null, z2: null, z3: null, z4: null, z5: null },
    coverage: { activitiesWithZoneData: 0, activitiesWithCompleteZoneData: 0 },
  };

  for (const activity of activities) {
    if (!activity.isRunning || !activity.startTimeGmt) {
      continue;
    }

    // Garmin returns GMT as YYYY-MM-DD HH:mm:ss without an offset suffix.
    const start = new Date(activity.startTimeGmt.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(start.getTime())) {
      continue;
    }
    const date = romeDate(start);
    if (date < week.weekStart || date > week.weekEnd) {
      continue;
    }

    activityCount += 1;
    distanceMeters += nonNegative(activity.distance);
    durationSeconds += nonNegative(activity.duration);

    let reportedZones = 0;
    for (const zone of heartRateZoneKeys) {
      const seconds = activity.heartRateZoneSeconds?.[zone];
      if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
        heartRateZones.seconds[zone] = (heartRateZones.seconds[zone] ?? 0) + seconds;
        reportedZones += 1;
      }
    }
    if (reportedZones > 0) {
      heartRateZones.coverage.activitiesWithZoneData += 1;
    }
    if (reportedZones === heartRateZoneKeys.length) {
      heartRateZones.coverage.activitiesWithCompleteZoneData += 1;
    }
  }

  const totalDistanceKm = distanceMeters / 1_000;
  return {
    ...week,
    totalDistanceKm,
    totalDurationMinutes: durationSeconds / 60,
    activityCount,
    heartRateZones,
    averagePaceSecondsPerKm: totalDistanceKm > 0 && durationSeconds > 0
      ? durationSeconds / totalDistanceKm
      : null,
  };
}

type WeeklySummary = ReturnType<typeof summarizeWeek>;

function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous * 100;
}

export function compareWeeks(current: WeeklySummary, previous: WeeklySummary) {
  const currentPace = current.averagePaceSecondsPerKm;
  const previousPace = previous.averagePaceSecondsPerKm;

  return {
    distanceChangePercent: percentChange(current.totalDistanceKm, previous.totalDistanceKm),
    durationChangePercent: percentChange(current.totalDurationMinutes, previous.totalDurationMinutes),
    activityCountChange: current.activityCount - previous.activityCount,
    paceChangeSecondsPerKm: currentPace === null || previousPace === null
      ? null
      : currentPace - previousPace,
  };
}
