import { heartRateZoneKeys, type HeartRateZones } from './heart-rate-zones.js';
import { getRomeWeek, isCalendarDate, romeDate, shiftCalendarDate, type Week } from './rome-calendar.js';
import { summarizeWeek } from './weekly-summary.js';

const completedWeeks = 6;

type HistoryActivity = Parameters<typeof summarizeWeek>[1][number] & {
  hasActivityType?: boolean;
  averageHeartRate?: number;
};

export function getTrainingHistoryWeeks(now: Date): Week[] {
  const currentMonday = getRomeWeek(now).weekStart;
  return Array.from({ length: completedWeeks }, (_, index) => {
    const weekStart = shiftCalendarDate(currentMonday, (index - completedWeeks) * 7);
    return { weekStart, weekEnd: shiftCalendarDate(weekStart, 6) };
  });
}

function usableMeasurement(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

export function activityDate(timestamp: string | undefined): string | undefined {
  if (!timestamp || !/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(timestamp)
    || !isCalendarDate(timestamp.slice(0, 10))) {
    return undefined;
  }
  return romeDate(new Date(timestamp.replace(' ', 'T') + 'Z'));
}

function summarizeHistoryWeek(week: Week, activities: readonly HistoryActivity[]) {
  const normalized = activities.map((activity) => ({
    ...activity,
    distance: usableMeasurement(activity.distance) ? activity.distance : undefined,
    duration: usableMeasurement(activity.duration) ? activity.duration : undefined,
    heartRateZoneSeconds: Object.fromEntries(heartRateZoneKeys.map((zone) => {
      const seconds = activity.heartRateZoneSeconds?.[zone];
      return [zone, usableMeasurement(seconds) ? seconds : undefined];
    })),
  }));
  const summary = summarizeWeek(week, normalized);

  let totalDurationSeconds = 0;
  let paceDurationSeconds = 0;
  let paceDistanceKm = 0;
  let longestRunDistanceKm: number | null = null;
  let hrDurationSeconds = 0;
  let weightedHeartRate = 0;
  const coverage = {
    activitiesWithDistance: 0,
    activitiesWithDuration: 0,
    activitiesWithPace: 0,
    activitiesWithHeartRate: 0,
  };

  for (const run of normalized) {
    if (run.distance !== undefined) {
      coverage.activitiesWithDistance++;
      longestRunDistanceKm = Math.max(longestRunDistanceKm ?? 0, run.distance / 1_000);
    }
    if (run.duration !== undefined) {
      coverage.activitiesWithDuration++;
      totalDurationSeconds += run.duration;
    }
    if (run.distance && run.duration) {
      coverage.activitiesWithPace++;
      paceDistanceKm += run.distance / 1_000;
      paceDurationSeconds += run.duration;
    }
    if (usableMeasurement(run.averageHeartRate) && run.averageHeartRate > 0 && run.duration) {
      coverage.activitiesWithHeartRate++;
      hrDurationSeconds += run.duration;
      weightedHeartRate += run.averageHeartRate * run.duration;
    }
  }
  const pace = paceDurationSeconds / paceDistanceKm;

  return {
    ...week,
    activityCount: summary.activityCount,
    totalDistanceKm: summary.totalDistanceKm,
    totalDurationSeconds,
    averagePaceSecondsPerKm: Number.isFinite(pace) ? pace : null,
    longestRunDistanceKm,
    averageHeartRateBpm: hrDurationSeconds > 0 ? weightedHeartRate / hrDurationSeconds : null,
    heartRateZones: summary.heartRateZones,
    coverage,
  };
}

export function summarizeTrainingHistory(weeks: readonly Week[], activities: readonly HistoryActivity[]) {
  const buckets = weeks.map((): HistoryActivity[] => []);
  let unclassifiedActivities = 0;
  let runningActivitiesWithoutDate = 0;
  let mostRecentRunningActivityDate: string | null = null;

  for (const activity of activities) {
    const date = activityDate(activity.startTimeGmt);
    const weekIndex = date === undefined ? -1 : weeks.findIndex((week) => date >= week.weekStart && date <= week.weekEnd);
    if (!activity.isRunning) {
      if (activity.hasActivityType === false && (date === undefined || weekIndex >= 0)) unclassifiedActivities++;
      continue;
    }
    if (!date) {
      runningActivitiesWithoutDate++;
    } else if (weekIndex >= 0) {
      buckets[weekIndex].push(activity);
      if (mostRecentRunningActivityDate === null || date > mostRecentRunningActivityDate) {
        mostRecentRunningActivityDate = date;
      }
    }
  }

  const weekly = weeks.map((week, index) => summarizeHistoryWeek(week, buckets[index]));
  const totals = weekly.reduce((result, week) => {
    result.totalActivities += week.activityCount;
    result.totalDistanceKm += week.totalDistanceKm;
    result.weeksWithNoRunningActivities += Number(week.activityCount === 0);
    if (week.longestRunDistanceKm !== null) {
      result.longestRunDistanceKm = Math.max(result.longestRunDistanceKm ?? 0, week.longestRunDistanceKm);
    }
    for (const key of Object.keys(week.coverage) as (keyof typeof week.coverage)[]) {
      result.coverage[key] += week.coverage[key];
    }
    result.coverage.activitiesWithZoneData += week.heartRateZones.coverage.activitiesWithZoneData;
    result.coverage.activitiesWithCompleteZoneData += week.heartRateZones.coverage.activitiesWithCompleteZoneData;
    return result;
  }, {
    totalActivities: 0,
    totalDistanceKm: 0,
    weeksWithNoRunningActivities: 0,
    longestRunDistanceKm: null as number | null,
    coverage: {
      activitiesWithDistance: 0, activitiesWithDuration: 0, activitiesWithPace: 0, activitiesWithHeartRate: 0,
      activitiesWithZoneData: 0, activitiesWithCompleteZoneData: 0,
    } satisfies Record<string, number> & HeartRateZones['coverage'],
  });

  return {
    weeks: weekly,
    summary: {
      ...totals,
      completedWeeksAnalyzed: weeks.length,
      averageWeeklyDistanceKm: weeks.length ? totals.totalDistanceKm / weeks.length : 0,
      averageRunsPerWeek: weeks.length ? totals.totalActivities / weeks.length : 0,
      mostRecentRunningActivityDate,
      dataQuality: {
        status: unclassifiedActivities || runningActivitiesWithoutDate ? 'partial' as const : 'complete' as const,
        unclassifiedActivities,
        runningActivitiesWithoutDate,
      },
    },
  };
}

export type TrainingHistory = ReturnType<typeof summarizeTrainingHistory>;
