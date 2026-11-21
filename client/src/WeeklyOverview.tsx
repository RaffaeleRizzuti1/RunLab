import { useEffect, useId, useState } from 'react';
import './WeeklyOverview.css';

type WeeklySummary = {
  weekStart: string;
  weekEnd: string;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  activityCount: number;
  averagePaceSecondsPerKm: number | null;
};

type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: WeeklySummary };

const calendarDate = /^\d{4}-\d{2}-\d{2}$/;
const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const loadError = 'Could not load the weekly overview. Reload the page to try again.';

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && calendarDate.test(value) && Number.isFinite(Date.parse(value));
}

function isWeeklySummary(value: unknown): value is WeeklySummary {
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
    && (summary.averagePaceSecondsPerKm === null
      || isNonNegativeNumber(summary.averagePaceSecondsPerKm));
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

export function WeeklyOverview() {
  const headingId = useId();
  const [state, setState] = useState<OverviewState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    async function loadSummary() {
      try {
        const response = await fetch('/api/weekly-summary', { signal: controller.signal });
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
        if (!isWeeklySummary(data)) {
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
  }, []);

  const summary = state.status === 'ready' ? state.summary : undefined;
  const stats = summary && [
    { label: 'Total distance', value: `${summary.totalDistanceKm.toFixed(2)} km` },
    { label: 'Running duration', value: formatDuration(summary.totalDurationMinutes) },
    { label: 'Running activities', value: summary.activityCount },
    { label: 'Average pace', value: formatPace(summary.averagePaceSecondsPerKm) },
  ];

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Weekly Overview</h2>
      {state.status === 'loading' && <p role="status">Loading weekly running statistics…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {summary && stats && (
        <>
          <p>
            <time dateTime={summary.weekStart}>{dateFormatter.format(new Date(summary.weekStart))}</time>
            {' – '}
            <time dateTime={summary.weekEnd}>{dateFormatter.format(new Date(summary.weekEnd))}</time>
          </p>
          {summary.activityCount === 0 && <p role="status">No running activities this week.</p>}
          <dl className="weekly-overview__stats">
            {stats.map(({ label, value }) => (
              <div className="weekly-overview__card" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
