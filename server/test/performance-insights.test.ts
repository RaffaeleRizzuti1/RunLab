import { expect, test } from 'vitest';
import { calculatePerformanceInsights } from '../../client/src/performance-insights.js';

const first = { distanceKm: 5, durationSeconds: 1_500, averageHeartRate: 150, averagePaceSecondsPerKm: 300 };
const middle = { distanceKm: 5, durationSeconds: 1_750, averageHeartRate: 160, averagePaceSecondsPerKm: 350 };
const last = { distanceKm: 10, durationSeconds: 2_800, averageHeartRate: 145, averagePaceSecondsPerKm: 280 };

test('returns no pace or changes when no runs match', () => {
  expect(calculatePerformanceInsights([])).toEqual({
    totalComparedRuns: 0, averagePaceSecondsPerKm: null,
    paceChangeSecondsPerKm: null, averageHeartRateChangeBpm: null,
  });
});

test('reports a single run without first-to-last changes', () => {
  expect(calculatePerformanceInsights([first])).toEqual({
    totalComparedRuns: 1, averagePaceSecondsPerKm: 300,
    paceChangeSecondsPerKm: null, averageHeartRateChangeBpm: null,
  });
});

test('uses all runs for distance-weighted pace and only the endpoints for changes', () => {
  expect(calculatePerformanceInsights([first, middle, last])).toEqual({
    totalComparedRuns: 3, averagePaceSecondsPerKm: 302.5,
    paceChangeSecondsPerKm: -20, averageHeartRateChangeBpm: -5,
  });
  expect(calculatePerformanceInsights([last, middle, first])).toEqual({
    totalComparedRuns: 3, averagePaceSecondsPerKm: 302.5,
    paceChangeSecondsPerKm: 20, averageHeartRateChangeBpm: 5,
  });
});

test('preserves fractional values', () => {
  const result = calculatePerformanceInsights([
    { distanceKm: 2.5, durationSeconds: 751.25, averageHeartRate: 150.25, averagePaceSecondsPerKm: 300.5 },
    { distanceKm: 5.5, durationSeconds: 1_646.5625, averageHeartRate: 150.75, averagePaceSecondsPerKm: 299.375 },
  ]);
  expect(result.averagePaceSecondsPerKm).toBe((751.25 + 1_646.5625) / 8);
  expect(result.paceChangeSecondsPerKm).toBe(-1.125);
  expect(result.averageHeartRateChangeBpm).toBe(0.5);
});

test('returns explicit zero for identical first and last values', () => {
  expect(calculatePerformanceInsights([first, middle, first])).toMatchObject({
    totalComparedRuns: 3, paceChangeSecondsPerKm: 0, averageHeartRateChangeBpm: 0,
  });
});
