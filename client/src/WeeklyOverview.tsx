import { useEffect, useId, useState } from 'react';
import { heartRateZoneKeys, type HeartRateZones as ZoneSummary } from '../../server/src/heart-rate-zones';
import { getRomeWeek, isCalendarDate, shiftCalendarDate } from '../../server/src/rome-calendar';
import { HeartRateZones } from './HeartRateZones';
import './WeeklyOverview.css';

type WeekStats = {
  weekStart: string;
  weekEnd: string;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  activityCount: number;
  averagePaceSecondsPerKm: number | null;
  heartRateZones: ZoneSummary;
};

type WeekComparison = {
  distanceChangePercent: number | null;
  durationChangePercent: number | null;
  activityCountChange: number;
  paceChangeSecondsPerKm: number | null;
};

type WeeklySummary = WeekStats & {
  previousWeek: WeekStats;
  comparison: WeekComparison;
};

type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: WeeklySummary };

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const loadError = 'Could not load the weekly overview. Reload the page to try again.';

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isZoneSummary(value: unknown, activityCount: number): value is ZoneSummary {
  if (typeof value !== 'object' || value === null
    || !('seconds' in value) || typeof value.seconds !== 'object' || value.seconds === null
    || !('coverage' in value) || typeof value.coverage !== 'object' || value.coverage === null) {
    return false;
  }

  const seconds = value.seconds as Record<string, unknown>;
  const { activitiesWithZoneData, activitiesWithCompleteZoneData } = value.coverage as Record<string, unknown>;
  return heartRateZoneKeys.every((zone) => seconds[zone] === null || isNonNegativeNumber(seconds[zone]))
    && isNonNegativeNumber(activitiesWithZoneData) && Number.isInteger(activitiesWithZoneData)
    && isNonNegativeNumber(activitiesWithCompleteZoneData) && Number.isInteger(activitiesWithCompleteZoneData)
    && activitiesWithCompleteZoneData <= activitiesWithZoneData && activitiesWithZoneData <= activityCount;
}

function isWeekStats(value: unknown): value is WeekStats {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const summary = value as Record<string, unknown>;
  return isCalendarDate(summary.weekStart)
    && isCalendarDate(summary.weekEnd)
    && isNonNegativeNumber(summary.totalDistanceKm)
    && isNonNegativeNumber(summary.totalDurationMinutes)
    && isNonNegativeNumber(summary.activityCount)
    && Number.isInteger(summary.activityCount)
    && isZoneSummary(summary.heartRateZones, summary.activityCount)
    && (summary.averagePaceSecondsPerKm === null
      || isNonNegativeNumber(summary.averagePaceSecondsPerKm));
}

function isNullableChange(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isWeeklySummary(value: unknown): value is WeeklySummary {
  if (!isWeekStats(value) || !('previousWeek' in value) || !isWeekStats(value.previousWeek)
    || !('comparison' in value) || typeof value.comparison !== 'object' || !value.comparison) {
    return false;
  }

  const comparison = value.comparison as Record<string, unknown>;
  return isNullableChange(comparison.distanceChangePercent)
    && isNullableChange(comparison.durationChangePercent)
    && Number.isInteger(comparison.activityCountChange)
    && isNullableChange(comparison.paceChangeSecondsPerKm);
}

function formatDuration(totalMinutes: number): string {
  const minutes = Math.round(totalMinutes);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm === null) {
    return 'Unavailable';
  }

  const seconds = Math.round(secondsPerKm);
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secondsPart = String(seconds % 60).padStart(2, '0');
  return `${minutesPart}:${secondsPart} /km`;
}

function formatPercentChange(value: number | null): string {
  if (value === null) {
    return 'Unavailable';
  }
  return `${value < 0 ? '' : '+'}${value.toFixed(1)}%`;
}

const signedChange = new Intl.NumberFormat('en', {
  signDisplay: 'exceptZero',
  maximumFractionDigits: 1,
});

function WeeklyComparison({ previousWeek, comparison }: Pick<WeeklySummary, 'previousWeek' | 'comparison'>) {
  const changes = [
    { label: 'Distance change', value: formatPercentChange(comparison.distanceChangePercent) },
    { label: 'Duration change', value: formatPercentChange(comparison.durationChangePercent) },
    { label: 'Running activity change', value: signedChange.format(comparison.activityCountChange) },
    {
      label: 'Average pace change',
      value: comparison.paceChangeSecondsPerKm === null
        ? 'Unavailable'
        : `${signedChange.format(comparison.paceChangeSecondsPerKm)} s/km`,
    },
  ];

  return (
    <section className="weekly-overview__comparison">
      <h3>Weekly Comparison</h3>
      <p>
        Previous week{' '}
        <time dateTime={previousWeek.weekStart}>{dateFormatter.format(new Date(previousWeek.weekStart))}</time>
        {' – '}
        <time dateTime={previousWeek.weekEnd}>{dateFormatter.format(new Date(previousWeek.weekEnd))}</time>
      </p>
      <dl className="weekly-overview__stats">
        {changes.map(({ label, value }) => (
          <div className="weekly-overview__card" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function WeeklyOverview() {
  const headingId = useId();
  const currentWeekStart = getRomeWeek(new Date()).weekStart;
  const [pastWeekStart, setPastWeekStart] = useState<string>();
  const weekStart = pastWeekStart ?? currentWeekStart;
  const weekEnd = shiftCalendarDate(weekStart, 6);
  const isCurrentWeek = weekStart >= currentWeekStart;

  function selectNextWeek() {
    const nextWeekStart = shiftCalendarDate(weekStart, 7);
    setPastWeekStart(nextWeekStart < currentWeekStart ? nextWeekStart : undefined);
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Weekly Overview</h2>
      <p>
        <time dateTime={weekStart}>{dateFormatter.format(new Date(weekStart))}</time>
        {' – '}
        <time dateTime={weekEnd}>{dateFormatter.format(new Date(weekEnd))}</time>
      </p>
      <div className="weekly-overview__navigation" role="group" aria-label="Week navigation">
        <button type="button" onClick={() => setPastWeekStart(shiftCalendarDate(weekStart, -7))}>
          Previous Week
        </button>
        <button type="button" onClick={selectNextWeek} disabled={isCurrentWeek}>
          Next Week
        </button>
        <button type="button" onClick={() => setPastWeekStart(undefined)} disabled={isCurrentWeek}>
          Back to Current Week
        </button>
      </div>
      <WeeklyStats key={weekStart} weekStart={weekStart} />
    </section>
  );
}

function WeeklyStats({ weekStart }: { weekStart: string }) {
  const [state, setState] = useState<OverviewState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    async function loadSummary() {
      try {
        const query = new URLSearchParams({ weekStart });
        const response = await fetch(`/api/weekly-summary?${query}`, { signal: controller.signal });
        if (!response.ok) {
          const message = response.status === 429
            ? 'Garmin rate limit reached. Try again later.'
            : response.status === 503
              ? 'Garmin is not configured on the RunLab server.'
              : loadError;
          if (!controller.signal.aborted) {
            setState({ status: 'error', message });
          }
          return;
        }

        const data: unknown = await response.json();
        if (!isWeeklySummary(data) || data.weekStart !== weekStart) {
          throw new Error('Unexpected weekly summary response');
        }
        if (!controller.signal.aborted) {
          setState({ status: 'ready', summary: data });
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: loadError });
        }
      }
    }

    void loadSummary();
    return () => controller.abort();
  }, [weekStart]);

  const summary = state.status === 'ready' ? state.summary : undefined;
  const stats = summary && [
    { label: 'Total distance', value: `${summary.totalDistanceKm.toFixed(2)} km` },
    { label: 'Running duration', value: formatDuration(summary.totalDurationMinutes) },
    { label: 'Running activities', value: summary.activityCount },
    { label: 'Average pace', value: formatPace(summary.averagePaceSecondsPerKm) },
  ];

  return (
    <>
      {state.status === 'loading' && <p role="status">Loading weekly running statistics…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {summary && stats && (
        <>
          {summary.activityCount === 0 && <p role="status">No running activities this week.</p>}
          <dl className="weekly-overview__stats">
            {stats.map(({ label, value }) => (
              <div className="weekly-overview__card" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <HeartRateZones zones={summary.heartRateZones} activityCount={summary.activityCount} />
          <WeeklyComparison previousWeek={summary.previousWeek} comparison={summary.comparison} />
        </>
      )}
    </>
  );
}
