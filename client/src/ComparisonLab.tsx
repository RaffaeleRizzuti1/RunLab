import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { isCalendarDate, romeDate, shiftCalendarDate } from '../../server/src/rome-calendar';
import { formatTime } from './format-run-time';
import { PerformanceInsights } from './PerformanceInsights';
import { PerformanceTrend } from './PerformanceTrend';
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

const metricGroups = [
  {
    legend: 'Distance',
    fields: [
      { name: 'distanceKm', label: 'Target (km)', min: 0, step: 'any' },
      { name: 'distanceTolerancePercent', label: 'Tolerance (±%)', min: 0, max: 30, step: 'any' },
    ],
  },
  {
    legend: 'Average heart rate',
    fields: [
      { name: 'targetHeartRate', label: 'Target (bpm)', min: 1, step: 1 },
      { name: 'heartRateToleranceBpm', label: 'Tolerance (±bpm)', min: 0, max: 30, step: 1 },
    ],
  },
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

  const rows = activities.map((run) => ({
    ...run,
    formattedDate: dateFormatter.format(new Date(run.date)),
    metrics: [
      { label: 'Distance', value: `${distanceFormatter.format(run.distanceKm)} km` },
      { label: 'Duration', value: formatTime(run.durationSeconds, true) },
      { label: 'Average HR', value: `${Math.round(run.averageHeartRate)} bpm` },
      { label: 'Average pace', value: `${formatTime(run.averagePaceSecondsPerKm)} /km` },
    ],
  }));

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
            {rows.map((run) => (
              <tr key={run.activityId}>
                <td><time dateTime={run.date}>{run.formattedDate}</time></td>
                <th scope="row">{run.name}</th>
                {run.metrics.map(({ label, value }) => <td key={label}>{value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="comparison-lab__mobile-results" aria-label="Matching runs, earliest first">
        {rows.map((run) => (
          <li className="data-card" key={run.activityId}>
            <time dateTime={run.date}>{run.formattedDate}</time>
            <h4>{run.name}</h4>
            <dl>
              {run.metrics.map(({ label, value }) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
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
      <h2 id={headingId}>Find comparable runs</h2>
      <form className="data-card" onSubmit={compareRuns}>
        <div className="comparison-lab__filters">
          <fieldset>
            <legend>Date range</legend>
            <div className="comparison-lab__field-pair">
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
            </div>
            <p id={dateHelpId}>Up to 90 days, including both dates. Europe/Rome.</p>
          </fieldset>
          {metricGroups.map(({ legend, fields }) => (
            <fieldset key={legend}>
              <legend>{legend}</legend>
              <div className="comparison-lab__field-pair">
                {fields.map(({ name, label, ...constraints }) => (
                  <label key={name}>
                    {label}
                    <input type="number" name={name} {...constraints} value={filters[name]} required
                      onChange={(event) => updateFilter(name, event.target.value)} />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <button className="button-primary" type="submit" disabled={state.status === 'loading'}>Compare Runs</button>
      </form>

      {state.status === 'loading' && <p role="status">Finding comparable runs…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          {state.results.totalMatchingCount === 0 && <ComparisonResults results={state.results} />}
          <PerformanceInsights activities={state.results.activities} />
          <PerformanceTrend activities={state.results.activities} />
          {state.results.totalMatchingCount > 0 && (
            <section className="comparison-lab__insights" aria-label="Matched activities">
              <h3>Matched activities</h3>
              <ComparisonResults results={state.results} />
            </section>
          )}
        </>
      )}
    </section>
  );
}
