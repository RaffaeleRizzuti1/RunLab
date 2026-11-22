import { isCalendarDate, romeDate } from './rome-calendar.js';

const maximumRangeDays = 90;

type ComparisonFilters = {
  from: string;
  to: string;
  distanceKm: number;
  distanceTolerancePercent: number;
  targetHeartRate: number;
  heartRateToleranceBpm: number;
};

type ComparisonActivity = {
  activityId?: number;
  name?: string;
  startTimeGmt?: string;
  isRunning: boolean;
  distance?: number;
  duration?: number;
  averageHeartRate?: number;
};

function queryNumber(value: unknown): number {
  return typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
    ? Number(value)
    : NaN;
}

function isPositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function isTolerance(value: number): boolean {
  return value >= 0 && value <= 30;
}

export function parseComparisonFilters(query: Record<string, unknown>):
  { filters: ComparisonFilters } | { error: string } {
  const { from, to } = query;
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
    return { error: 'Provide valid from and to dates in YYYY-MM-DD format, with from on or before to.' };
  }
  if (Date.parse(to) - Date.parse(from) >= maximumRangeDays * 86_400_000) {
    return { error: `The date range must be at most ${maximumRangeDays} calendar days, inclusive.` };
  }

  const distanceKm = queryNumber(query.distanceKm);
  const targetHeartRate = queryNumber(query.targetHeartRate);
  const distanceTolerancePercent = query.distanceTolerancePercent === undefined
    ? 10 : queryNumber(query.distanceTolerancePercent);
  const heartRateToleranceBpm = query.heartRateToleranceBpm === undefined
    ? 10 : queryNumber(query.heartRateToleranceBpm);

  if (!isPositive(distanceKm)) {
    return { error: 'distanceKm must be a positive number.' };
  }
  if (!Number.isSafeInteger(targetHeartRate) || targetHeartRate <= 0) {
    return { error: 'targetHeartRate must be a positive integer in bpm.' };
  }
  if (!isTolerance(distanceTolerancePercent)) {
    return { error: 'distanceTolerancePercent must be between 0 and 30.' };
  }
  if (!Number.isInteger(heartRateToleranceBpm) || !isTolerance(heartRateToleranceBpm)) {
    return { error: 'heartRateToleranceBpm must be an integer between 0 and 30.' };
  }

  return { filters: { from, to, distanceKm, distanceTolerancePercent, targetHeartRate, heartRateToleranceBpm } };
}

export function findComparableActivities(filters: ComparisonFilters, activities: readonly ComparisonActivity[]) {
  const tolerance = filters.distanceTolerancePercent / 100;
  const minimumDistanceKm = filters.distanceKm * (1 - tolerance);
  const maximumDistanceKm = filters.distanceKm * (1 + tolerance);
  // Absorb floating-point rounding at inclusive nonzero tolerance boundaries.
  const roundingAllowance = tolerance === 0 ? 0 : filters.distanceKm * Number.EPSILON;
  const matches = activities.flatMap((activity) => {
    const { activityId, name, startTimeGmt, isRunning, distance, duration, averageHeartRate } = activity;
    if (!isRunning || !startTimeGmt || !activityId || !Number.isSafeInteger(activityId) || activityId < 0
      || !isPositive(distance) || !isPositive(duration) || !isPositive(averageHeartRate)) {
      return [];
    }

    const distanceKm = distance / 1_000;
    if (distanceKm === 0 || distanceKm < minimumDistanceKm - roundingAllowance
      || distanceKm > maximumDistanceKm + roundingAllowance
      || Math.abs(averageHeartRate - filters.targetHeartRate) > filters.heartRateToleranceBpm) {
      return [];
    }

    const start = new Date(startTimeGmt.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(start.getTime())) {
      return [];
    }
    const date = romeDate(start);
    const averagePaceSecondsPerKm = duration / distanceKm;
    if (date < filters.from || date > filters.to || !Number.isFinite(averagePaceSecondsPerKm)) {
      return [];
    }

    return [{
      timestamp: start.getTime(),
      activity: {
        activityId,
        date,
        name: name?.trim() || 'Unnamed activity',
        distanceKm,
        durationSeconds: duration,
        averageHeartRate,
        averagePaceSecondsPerKm,
      },
    }];
  });

  return matches.sort((left, right) => left.timestamp - right.timestamp).map(({ activity }) => activity);
}
