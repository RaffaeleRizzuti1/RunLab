import { formatTime } from './format-run-time.js';

export type ActivityMetricValues = {
  distanceKm?: number;
  durationSeconds?: number;
  averagePaceSecondsPerKm?: number;
  averageHeartRate?: number;
};

export type RecentActivity = {
  name?: string;
  date?: string;
  activityType?: string;
  distance?: number;
  duration?: number;
  averageHeartRate?: number;
};

const distanceFormatter = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isNonNegative(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositive(value: number | undefined): value is number {
  return isNonNegative(value) && value > 0;
}

export function recentActivityMetrics(activity: RecentActivity): ActivityMetricValues {
  const distanceKm = isNonNegative(activity.distance) ? activity.distance / 1_000 : undefined;
  const durationSeconds = isNonNegative(activity.duration) ? activity.duration : undefined;
  return {
    distanceKm,
    durationSeconds,
    averagePaceSecondsPerKm: isPositive(distanceKm) && isPositive(durationSeconds)
      ? durationSeconds / distanceKm
      : undefined,
    averageHeartRate: activity.averageHeartRate,
  };
}

export function formatActivityMetrics(values: ActivityMetricValues) {
  const { distanceKm, durationSeconds, averagePaceSecondsPerKm, averageHeartRate } = values;
  return [
    { label: 'Distance', value: isNonNegative(distanceKm) ? `${distanceFormatter.format(distanceKm)} km` : undefined },
    { label: 'Duration', value: isNonNegative(durationSeconds) ? formatTime(durationSeconds, true) : undefined },
    { label: 'Average pace', value: isPositive(averagePaceSecondsPerKm) ? `${formatTime(averagePaceSecondsPerKm)} min/km` : undefined },
    { label: 'Average heart rate', value: isPositive(averageHeartRate) ? `${Math.round(averageHeartRate)} bpm` : undefined },
  ];
}

export function resolveRecentActivitySelection(
  activities: readonly RecentActivity[] | undefined,
  selected: RecentActivity | undefined,
) {
  return selected && activities?.includes(selected) ? selected : undefined;
}
