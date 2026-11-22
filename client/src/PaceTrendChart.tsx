import { useId, useState } from 'react';
import { shiftCalendarDate } from '../../server/src/rome-calendar';
import { ActivityMetrics } from './ActivityMetrics';
import { formatTime } from './format-run-time';
import { coincidentPointOffset, resolveChartSelection, type ChartSelection } from './pace-chart-selection';
import type { PerformanceActivity } from './performance-insights';
import type { analyzePerformanceTrend } from './performance-trend';

export type PaceChartActivity = PerformanceActivity & {
  activityId: number;
  date: string;
  name: string;
};

const tickDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const detailDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

export function PaceTrendChart({ model }: { model: ReturnType<typeof analyzePerformanceTrend<PaceChartActivity>> }) {
  const detailId = useId();
  const { points, line, dateSpanDays, firstDate } = model;
  const [selection, setSelection] = useState<ChartSelection<typeof points[number]>>();
  const [preview, setPreview] = useState<ChartSelection<typeof points[number]>>();
  if (!firstDate) {
    return null;
  }

  const selected = resolveChartSelection(points, selection);
  const previewed = resolveChartSelection(points, preview);
  const lowPace = points.reduce((lowest, point) => Math.min(lowest, point.pace), Infinity);
  const highPace = points.reduce((highest, point) => Math.max(highest, point.pace), 0);
  const minimum = Math.min(lowPace, line?.startPace ?? lowPace, line?.endPace ?? lowPace);
  const maximum = Math.max(highPace, line?.startPace ?? highPace, line?.endPace ?? highPace);
  const step = Math.max(5, Math.ceil((maximum - minimum) / 15) * 5);
  const top = Math.floor(minimum / step) * step;
  const bottom = Math.max(top + 2 * step, Math.ceil(maximum / step) * step);
  const paceTicks = [top, (top + bottom) / 2, bottom];
  const dayTicks = dateSpanDays < 2 ? [...new Set([0, dateSpanDays])] : [0, Math.round(dateSpanDays / 2), dateSpanDays];
  const x = (day: number) => dateSpanDays === 0 ? 50 : day / dateSpanDays * 100;
  const y = (pace: number) => (pace - top) / (bottom - top) * 100;

  const groups = new Map<string, number>();
  for (const point of points) {
    const key = `${point.day}:${point.pace}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const shown = new Map<string, number>();
  const largestGroup = [...groups.values()].reduce((largest, count) => Math.max(largest, count), 1);
  const { activity } = selected ?? {};
  const extraRows = Math.ceil(largestGroup / 3) - 1;

  return (
    <figure className="pace-chart data-card">
      <figcaption>Pace evolution</figcaption>
      <p className="pace-chart__axis-title">Average pace (min/km) · lower is faster</p>
      <div className="pace-chart__layout">
        <div className="pace-chart__pace-axis" aria-hidden="true">
          {paceTicks.map((pace) => (
            <span key={pace} style={{ top: `${y(pace)}%` }}>
              {pace < 0 ? '−' : ''}{formatTime(Math.abs(pace))}
            </span>
          ))}
        </div>
        <div className="pace-chart__plot" style={extraRows > 0 ? { minHeight: extraRows * 52 + 32 } : undefined}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {paceTicks.map((pace) => (
              <line className="pace-chart__gridline" key={pace} x1="0" x2="100" y1={y(pace)} y2={y(pace)}
                vectorEffect="non-scaling-stroke" />
            ))}
            {line && (
              <line className="pace-chart__trendline" x1="0" x2="100" y1={y(line.startPace)} y2={y(line.endPace)}
                vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {points.map(({ activity, day, pace }) => {
            const key = `${day}:${pace}`;
            const index = shown.get(key) ?? 0;
            const count = groups.get(key) ?? 1;
            shown.set(key, index + 1);
            const centerX = x(day);
            const centerY = y(pace);
            const offset = coincidentPointOffset(index, count, centerX, centerY);
            const label = `${activity.name}, ${detailDate.format(new Date(activity.date))}, ${formatTime(pace)} per kilometer`;
            const position = count > 1 ? `, overlapping run ${index + 1} of ${count}` : '';

            return (
              <button type="button" className="pace-chart__point" key={activity.activityId}
                style={{ top: `calc(${centerY}% + ${offset.vertical}px)`, left: `calc(${centerX}% + ${offset.horizontal}px)` }}
                aria-label={label + position} aria-pressed={activity.activityId === selected?.activity.activityId}
                aria-controls={detailId}
                onClick={() => setSelection({ points, activityId: activity.activityId })}
                onFocus={() => setPreview({ points, activityId: activity.activityId })}
                onBlur={() => setPreview(undefined)}
                onMouseEnter={() => setPreview({ points, activityId: activity.activityId })}
                onMouseLeave={() => setPreview(undefined)} />
            );
          })}
        </div>
        <div className="pace-chart__date-axis" aria-hidden="true">
          {dayTicks.map((day) => (
            <span key={day} style={{ left: `${x(day)}%` }}>
              {tickDate.format(new Date(shiftCalendarDate(firstDate, day)))}
            </span>
          ))}
        </div>
      </div>
      <p className="pace-chart__axis-title">Activity date (Europe/Rome){line && ' · dashed line shows the OLS fit'}</p>
      {largestGroup > 1 && (
        <p className="pace-chart__axis-title">Runs with identical date and pace are spread apart for selection.</p>
      )}
      <p className="pace-chart__preview" aria-hidden="true">
        {previewed
          ? `${previewed.activity.name} · ${detailDate.format(new Date(previewed.activity.date))} · ${formatTime(previewed.pace)} min/km`
          : 'Select a point to see run details.'}
      </p>
      <div id={detailId} aria-live="polite" aria-atomic="true">
        {activity && (
          <div className="pace-chart__selection data-card">
            <h4>{activity.name}</h4>
            <time dateTime={activity.date}>{detailDate.format(new Date(activity.date))}</time>
            <ActivityMetrics values={activity} />
          </div>
        )}
      </div>
    </figure>
  );
}
