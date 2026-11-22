import { expect, test } from 'vitest';
import {
  formatActivityMetrics,
  recentActivityMetrics,
  resolveRecentActivitySelection,
} from '../../client/src/activity-metrics.js';

function formatted(activity: Parameters<typeof recentActivityMetrics>[0]) {
  return formatActivityMetrics(recentActivityMetrics(activity)).map(({ value }) => value);
}

test('converts Garmin meters and seconds and derives pace for the activity cards', () => {
  expect(formatted({ distance: 5_500, duration: 1_650, averageHeartRate: 151.6 })).toEqual([
    '5.50 km', '27:30', '5:00 min/km', '152 bpm',
  ]);
});

test('keeps unavailable metrics missing and does not compute pace from only one value', () => {
  expect(formatted({})).toEqual([undefined, undefined, undefined, undefined]);
  expect(formatted({ duration: 3_660 })).toEqual([undefined, '1:01:00', undefined, undefined]);
  expect(formatted({ distance: 3_250 })).toEqual(['3.25 km', undefined, undefined, undefined]);
  expect(formatted({ distance: -1, duration: Infinity, averageHeartRate: NaN })).toEqual([
    undefined, undefined, undefined, undefined,
  ]);
});

test('preserves recorded zero totals while leaving pace and zero heart rate unavailable', () => {
  expect(formatted({ distance: 0, duration: 0, averageHeartRate: 0 })).toEqual([
    '0.00 km', '0:00', undefined, undefined,
  ]);
});

test('keeps the exact selected row across reordering and clears it when replaced', () => {
  const first = { name: 'Morning run', date: '2026-11-22' };
  const second = { ...first };
  expect(resolveRecentActivitySelection([first, second], second)).toBe(second);
  expect(resolveRecentActivitySelection([second, first], second)).toBe(second);
  expect(resolveRecentActivitySelection([first], second)).toBeUndefined();
  expect(resolveRecentActivitySelection([{ ...second }], second)).toBeUndefined();
  expect(resolveRecentActivitySelection([first, second], undefined)).toBeUndefined();
});
