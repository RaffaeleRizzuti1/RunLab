type PointWithActivity = { activity: { activityId: number } };

export type ChartSelection<T> = { points: readonly T[]; activityId: number };

export function resolveChartSelection<T extends PointWithActivity>(
  points: readonly T[],
  selection: ChartSelection<T> | undefined,
): T | undefined {
  if (selection?.points === points) {
    return points.find(({ activity }) => activity.activityId === selection.activityId);
  }
}

export function coincidentPointOffset(index: number, count: number, x: number, y: number) {
  const lastColumn = Math.min(count - 1, 2);
  const columnOrigin = x < 25 ? 0 : x > 75 ? lastColumn : lastColumn / 2;
  return {
    horizontal: (index % 3 - columnOrigin) * 26,
    vertical: Math.floor(index / 3) * (y > 50 ? -26 : 26),
  };
}
