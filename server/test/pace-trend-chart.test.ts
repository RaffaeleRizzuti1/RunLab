import { expect, test } from 'vitest';
import { analyzePerformanceTrend, calculatePerformanceTrend } from '../../client/src/performance-trend.js';

const run = (activityId: number, date: string, averagePaceSecondsPerKm: number) =>
  ({ activityId, date, averagePaceSecondsPerKm });

test('keeps input activity identities and uses elapsed calendar days for the chart', () => {
  const activities = [
    run(1, '2026-12-29', 310),
    run(2, '2027-01-08', 300),
    run(3, '2026-12-29', 310),
    run(4, '2027-03-28', 290),
    run(5, '2027-02-30', 100),
    run(6, '2027-01-01', NaN),
  ];
  const model = analyzePerformanceTrend(activities);

  expect(model.firstDate).toBe('2026-12-29');
  expect(model.dateSpanDays).toBe(89);
  expect(model.points.map(({ activity, day, pace }) => [activity.activityId, day, pace])).toEqual([
    [1, 0, 310], [2, 10, 300], [3, 0, 310], [4, 89, 290],
  ]);
  const { line, trend } = model;
  expect(trend).toEqual(calculatePerformanceTrend(activities));
  expect(line).not.toBeNull();
  if (!line) throw new Error('Expected a fitted line');
  expect((line.endPace - line.startPace) * 30 / model.dateSpanDays)
    .toBeCloseTo(trend.paceTrendSecondsPerKmPer30Days!);
});

test('plots fitted endpoints instead of connecting the first and last observations', () => {
  const model = analyzePerformanceTrend([
    run(1, '2026-01-01', 300), run(2, '2026-01-02', 304), run(3, '2026-01-03', 302),
  ]);

  expect(model.line).toEqual({ startPace: 301, endPace: 303 });
  expect(model.trend.rSquared).toBeCloseTo(0.25);
});

test('supports a horizontal fit for constant pace', () => {
  const model = analyzePerformanceTrend([
    run(1, '2026-01-01', 300), run(2, '2026-01-02', 300), run(3, '2026-01-03', 300),
  ]);

  expect(model.line).toEqual({ startPace: 300, endPace: 300 });
  expect(model.trend.rSquared).toBeNull();
});

test.each([
  { activities: [], count: 0 },
  { activities: [run(1, '2026-01-01', 300), run(2, '2026-01-02', 310)], count: 2 },
  { activities: [run(1, '2026-01-01', 300), run(2, '2026-01-01', 310), run(3, '2026-01-01', 320)], count: 3 },
])('keeps $count observations without a fitted line when data is insufficient', ({ activities, count }) => {
  const model = analyzePerformanceTrend(activities);
  expect(model.points).toHaveLength(count);
  expect(model.line).toBeNull();
  expect(model.trend.trendDirection).toBe('insufficient_data');
});
