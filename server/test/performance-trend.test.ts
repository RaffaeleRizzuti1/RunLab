import { expect, test } from 'vitest';
import { calculatePerformanceTrend } from '../../client/src/performance-trend.js';

const run = (date: string, averagePaceSecondsPerKm: number) => ({ date, averagePaceSecondsPerKm });

test.each([
  { paces: [300, 290, 280], change: -30, direction: 'improving' },
  { paces: [280, 290, 300], change: 30, direction: 'declining' },
  { paces: [300, 299.75, 299.5], change: -0.75, direction: 'stable' },
  { paces: [300, 300.25, 300.5], change: 0.75, direction: 'stable' },
])('reports a $direction trend at $change seconds per kilometer per 30 days', ({ paces, change, direction }) => {
  const dates = ['2026-01-01', '2026-01-11', '2026-01-21'];
  const trend = calculatePerformanceTrend(paces.map((pace, index) => run(dates[index], pace)));
  expect(trend).toMatchObject({
    activityCount: 3, paceTrendSecondsPerKmPer30Days: change, trendDirection: direction,
  });
  expect(trend.rSquared).toBeCloseTo(1);
});

test('uses elapsed calendar days through irregular intervals, DST and unsorted input', () => {
  const trend = calculatePerformanceTrend([
    run('2026-11-03', 280), run('2026-10-24', 300), run('2026-10-26', 296),
  ]);
  expect(trend.paceTrendSecondsPerKmPer30Days).toBeCloseTo(-60);
  expect(trend.rSquared).toBeCloseTo(1);
});

test('retains each same-day run as a separate observation', () => {
  const trend = calculatePerformanceTrend([
    run('2026-01-01', 320), run('2026-01-01', 300), run('2026-01-11', 290),
  ]);
  expect(trend.activityCount).toBe(3);
  expect(trend.trendDirection).toBe('improving');
  expect(trend.paceTrendSecondsPerKmPer30Days).toBeCloseTo(-60);
  expect(trend.rSquared).toBeCloseTo(4 / 7);
});

test.each([
  { activities: [] },
  { activities: [run('2026-01-01', 300), run('2026-01-02', 310)] },
  { activities: [run('2026-01-01', 300), run('2026-01-01', 310), run('2026-01-01', 320)] },
])('reports insufficient data for too few activities or only one date ($activities)', ({ activities }) => {
  expect(calculatePerformanceTrend(activities)).toEqual({
    activityCount: activities.length,
    paceTrendSecondsPerKmPer30Days: null,
    trendDirection: 'insufficient_data',
    rSquared: null,
  });
});

test('classifies constant pace as stable with undefined R-squared', () => {
  expect(calculatePerformanceTrend([
    run('2026-01-01', 300.1), run('2026-01-02', 300.1), run('2026-01-09', 300.1),
  ])).toEqual({
    activityCount: 3, paceTrendSecondsPerKmPer30Days: 0, trendDirection: 'stable', rSquared: null,
  });
});

test('skips invalid dates and invalid paces before counting activities', () => {
  const valid = [run('2026-01-01', 300), run('2026-01-02', 304)];
  const invalid = [
    run('2026-02-30', 310), run('2026-01-02T00:00:00Z', 310),
    run('2026-01-03', NaN), run('2026-01-04', Infinity), run('2026-01-05', -1), run('2026-01-06', 0),
  ];
  expect(calculatePerformanceTrend([...valid, ...invalid])).toMatchObject({
    activityCount: 2, trendDirection: 'insufficient_data',
  });
  const trend = calculatePerformanceTrend([...valid, ...invalid, run('2026-01-03', 302)]);
  expect(trend).toMatchObject({ activityCount: 3, paceTrendSecondsPerKmPer30Days: 30 });
  expect(trend.rSquared).toBeCloseTo(0.25);
});
