import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { isCalendarDate, romeDate, shiftCalendarDate } from '../../server/src/rome-calendar';
import { formatTime } from './format-run-time';
import { PerformanceInsights } from './PerformanceInsights';
import type { PerformanceActivity } from './performance-insights';
import './ComparisonLab.css';

type Filters = {
  from: string;
  to: string;
  distanceKm: string;
  distanceTolerancePercent: string;
  targetHeartRate: string;
  heartRateToleranceBpm: string;
};

type Run = PerformanceActivity & {
  activityId: number;
  date: string;
  name: string;
};

type Results = { totalMatchingCount: number; activities: Run[] };

type SearchState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; results: Results };

const maxDays = 90;
const requestError = 'Could not compare runs. Try again.';
const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
const distanceFormatter = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const numberFields = [
  { name: 'distanceKm', label: 'Target distance (km)', min: 0, step: 'any' },
  { name: 'distanceTolerancePercent', label: 'Distance tolerance (%)', min: 0, max: 30, step: 'any' },
  { name: 'targetHeartRate', label: 'Target average heart rate (bpm)', min: 1, step: 1 },
  { name: 'heartRateToleranceBpm', label: 'Heart rate tolerance (bpm)', min: 0, max: 30, step: 1 },
] as const;

function initialFilters(): Filters {
  const to = romeDate(new Date());
  return {
    from: shiftCalendarDate(to, 1 - maxDays),
    to,
    distanceKm: '6',
    distanceTolerancePercent: '10',
    targetHeartRate: '155',
    heartRateToleranceBpm: '10',
  };
}

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const run = value as Record<string, unknown>;
  return Number.isSafeInteger(run.activityId)
    && isCalendarDate(run.date)
    && typeof run.name === 'string'
    && [run.distanceKm, run.durationSeconds, run.averageHeartRate, run.averagePaceSecondsPerKm]
      .every((metric) => typeof metric === 'number' && Number.isFinite(metric) && metric > 0);
}

function isResults(value: unknown): value is Results {
  return typeof value === 'object' && value !== null
    && 'activities' in value && Array.isArray(value.activities)
    && 'totalMatchingCount' in value && value.totalMatchingCount === value.activities.length
    && value.activities.every(isRun);
}

async function responseError(response: Response): Promise<string> {
  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    if (typeof body === 'object' && body !== null && 'error' in body
      && typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
    return 'Check the dates and filter values, then try again.';
  }
  if (response.status === 429) {
    return 'Garmin rate limit reached. Try again later.';
  }
  if (response.status === 503) {
    return 'Garmin is not configured on the RunLab server.';
  }
  return requestError;
}

function ComparisonResults({ results }: { results: Results }) {
  const countId = useId();
  const { totalMatchingCount, activities } = results;
  if (totalMatchingCount === 0) {
    return <p role="status">0 matching runs. Try changing the filters or date range.</p>;
  }

  return (
    <>
      <p id={countId} role="status">{totalMatchingCount} matching {totalMatchingCount === 1 ? 'run' : 'runs'}</p>
      <div className="comparison-lab__results" role="region" aria-labelledby={countId} tabIndex={0}>
        <table>
          <caption>Matching runs, earliest first</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Name</th>
              <th scope="col">Distance</th>
              <th scope="col">Duration</th>
              <th scope="col">Average HR</th>
              <th scope="col">Average pace</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((run) => (
              <tr key={run.activityId}>
                <td><time dateTime={run.date}>{dateFormatter.format(new Date(run.date))}</time></td>
                <td>{run.name}</td>
                <td>{distanceFormatter.format(run.distanceKm)} km</td>
                <td>{formatTime(run.durationSeconds, true)}</td>
                <td>{Math.round(run.averageHeartRate)} bpm</td>
                <td>{formatTime(run.averagePaceSecondsPerKm)} /km</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ComparisonLab() {
  const headingId = useId();
  const dateHelpId = useId();
  const [filters, setFilters] = useState(initialFilters);
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const pendingRequest = useRef<AbortController | null>(null);

  useEffect(() => () => pendingRequest.current?.abort(), []);

  function updateFilter(name: keyof Filters, value: string) {
    pendingRequest.current?.abort();
    setFilters((previous) => ({ ...previous, [name]: value }));
    setState({ status: 'idle' });
  }

  async function compareRuns(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pendingRequest.current?.abort();

    const { from, to, distanceKm } = filters;
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
      setState({ status: 'error', message: 'Choose a start date on or before the end date.' });
      return;
    }
    if (Date.parse(to) - Date.parse(from) >= maxDays * 86_400_000) {
      setState({ status: 'error', message: 'Choose a date range of 90 calendar days or fewer, including both dates.' });
      return;
    }
    if (!(Number(distanceKm) > 0)) {
      setState({ status: 'error', message: 'Enter a target distance greater than zero.' });
      return;
    }

    const controller = new AbortController();
    pendingRequest.current = controller;
    setState({ status: 'loading' });

    try {
      const query = new URLSearchParams(filters);
      const response = await fetch(`/api/comparison?${query}`, { signal: controller.signal });
      if (!response.ok) {
        const message = await responseError(response);
        if (!controller.signal.aborted) {
          setState({ status: 'error', message });
        }
        return;
      }

      const data: unknown = await response.json();
      if (!isResults(data)) {
        throw new Error('Unexpected comparison response');
      }
      if (!controller.signal.aborted) {
        setState({ status: 'ready', results: data });
      }
    } catch {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: requestError });
      }
    } finally {
      if (pendingRequest.current === controller) {
        pendingRequest.current = null;
      }
    }
  }

  return (
    <section className="comparison-lab" aria-labelledby={headingId}>
      <h2 id={headingId}>Comparison Lab</h2>
      <form onSubmit={compareRuns}>
        <p id={dateHelpId}>Rome calendar dates. Include up to 90 days, counting both dates.</p>
        <div className="comparison-lab__filters">
          <label>
            Start date
            <input type="date" name="from" value={filters.from} required aria-describedby={dateHelpId}
              onChange={(event) => updateFilter('from', event.target.value)} />
          </label>
          <label>
            End date
            <input type="date" name="to" value={filters.to} required aria-describedby={dateHelpId}
              onChange={(event) => updateFilter('to', event.target.value)} />
          </label>
          {numberFields.map(({ name, label, ...constraints }) => (
            <label key={name}>
              {label}
              <input type="number" name={name} {...constraints} value={filters[name]} required
                onChange={(event) => updateFilter(name, event.target.value)} />
            </label>
          ))}
        </div>
        <button type="submit" disabled={state.status === 'loading'}>Compare Runs</button>
      </form>

      {state.status === 'loading' && <p role="status">Finding comparable runs…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          <ComparisonResults results={state.results} />
          <PerformanceInsights activities={state.results.activities} />
        </>
      )}
    </section>
  );
}
