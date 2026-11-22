import { expect, test } from 'vitest';
import { coincidentPointOffset, resolveChartSelection } from '../../client/src/pace-chart-selection.js';

const points = [
  { activity: { activityId: 1 }, day: 0, pace: 300 },
  { activity: { activityId: 2 }, day: 0, pace: 300 },
];

test('selects each run by its ID even when date and pace match', () => {
  expect(resolveChartSelection(points, undefined)).toBeUndefined();
  expect(resolveChartSelection(points, { points, activityId: 1 })).toBe(points[0]);
  expect(resolveChartSelection(points, { points, activityId: 2 })).toBe(points[1]);
});

test('does not carry selection into replacement results even when an ID repeats', () => {
  const selection = { points, activityId: 2 };
  expect(resolveChartSelection([], selection)).toBeUndefined();
  expect(resolveChartSelection([...points], selection)).toBeUndefined();
  expect(resolveChartSelection(points, { points, activityId: 3 })).toBeUndefined();
});

test.each([{ x: 0, y: 100 }, { x: 50, y: 50 }, { x: 100, y: 0 }])(
  'gives coincident markers separate 24px targets at $x%, $y%',
  ({ x, y }) => {
    const offsets = Array.from({ length: 10 }, (_, index) => coincidentPointOffset(index, 10, x, y));
    for (const [index, offset] of offsets.entries()) {
      for (const other of offsets.slice(index + 1)) {
        expect(Math.max(Math.abs(offset.horizontal - other.horizontal), Math.abs(offset.vertical - other.vertical)))
          .toBeGreaterThanOrEqual(24);
      }
    }
  },
);
