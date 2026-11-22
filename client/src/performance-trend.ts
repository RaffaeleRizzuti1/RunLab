import { isCalendarDate } from '../../server/src/rome-calendar.js';

type TrendActivity = {
  date: string;
  averagePaceSecondsPerKm: number;
};

type PerformanceTrend = {
  activityCount: number;
  paceTrendSecondsPerKmPer30Days: number | null;
  trendDirection: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  rSquared: number | null;
};

const millisecondsPerDay = 86_400_000;

// A display classification in seconds/km per 30 days, with no significance test.
export const stablePaceTrendThreshold = 1;

export function analyzePerformanceTrend<T extends TrendActivity>(activities: readonly T[]) {
  const observations = activities.flatMap((activity) => {
    if (!isCalendarDate(activity?.date) || !Number.isFinite(activity.averagePaceSecondsPerKm)
      || activity.averagePaceSecondsPerKm <= 0) {
      return [];
    }

    // These are Rome calendar date labels. UTC parsing gives consecutive dates a one-day step through DST.
    return [{ activity, day: Date.parse(activity.date) / millisecondsPerDay, pace: activity.averagePaceSecondsPerKm }];
  });
  const earliestDay = observations.reduce((earliest, point) => Math.min(earliest, point.day), Infinity);
  const points = observations.map((point) => ({ ...point, day: point.day - earliestDay }));
  const dateSpanDays = points.reduce((latest, point) => Math.max(latest, point.day), 0);
  const firstDate = points.find((point) => point.day === 0)?.activity.date;
  const chartData = { points, firstDate, dateSpanDays };
  const activityCount = points.length;
  const insufficientData: PerformanceTrend = {
    activityCount,
    paceTrendSecondsPerKmPer30Days: null,
    trendDirection: 'insufficient_data',
    rSquared: null,
  };
  if (activityCount < 3 || dateSpanDays === 0) {
    return { ...chartData, trend: insufficientData, line: null };
  }

  const meanDay = points.reduce((sum, point) => sum + point.day, 0) / activityCount;
  const referencePace = points[0].pace;
  const meanPaceOffset = points.reduce((sum, point) => sum + (point.pace - referencePace), 0) / activityCount;

  let daySumSquares = 0;
  let paceSumSquares = 0;
  let sumCrossProducts = 0;
  for (const point of points) {
    const dayDifference = point.day - meanDay;
    const paceDifference = point.pace - referencePace - meanPaceOffset;
    daySumSquares += dayDifference ** 2;
    paceSumSquares += paceDifference ** 2;
    sumCrossProducts += dayDifference * paceDifference;
  }

  const slopePerDay = sumCrossProducts / daySumSquares;
  const slope = slopePerDay * 30;
  const startPace = referencePace + meanPaceOffset - slopePerDay * meanDay;
  const endPace = startPace + slopePerDay * dateSpanDays;
  if (![slope, paceSumSquares, startPace, endPace].every(Number.isFinite)) {
    return { ...chartData, trend: insufficientData, line: null };
  }

  // R² is undefined when the observed pace has no variance.
  const correlation = paceSumSquares > 0
    ? sumCrossProducts / Math.sqrt(daySumSquares) / Math.sqrt(paceSumSquares)
    : null;

  const trend: PerformanceTrend = {
    activityCount,
    paceTrendSecondsPerKmPer30Days: slope,
    trendDirection: Math.abs(slope) < stablePaceTrendThreshold ? 'stable' : slope < 0 ? 'improving' : 'declining',
    rSquared: correlation === null ? null : Math.min(1, correlation ** 2),
  };
  return { ...chartData, trend, line: { startPace, endPace } };
}

export function calculatePerformanceTrend(activities: readonly TrendActivity[]): PerformanceTrend {
  return analyzePerformanceTrend(activities).trend;
}
