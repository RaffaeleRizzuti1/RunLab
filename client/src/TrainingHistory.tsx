import { useEffect, useId, useState } from 'react';
import type { TrainingHistory as HistoryData } from '../../server/src/training-history.js';

type HistoryState = { history: HistoryData } | { error: string } | null;
const formatDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
const formatNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const kilometers = (value: number | null) => value === null ? 'Not reported' : `${formatNumber.format(value)} km`;

function dateLabel(date: string) {
  return formatDate.format(new Date(date));
}

export function TrainingHistory() {
  const id = useId();
  const [state, setState] = useState<HistoryState>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadHistory() {
      const fallback = 'Training history is unavailable. Reload the page to try again.';
      try {
        const response = await fetch('/api/training-history', { signal: controller.signal });
        if (!response.ok) {
          const error = response.status === 429 ? 'Garmin rate limit reached. Try again later.'
            : response.status === 503 ? 'Garmin is not configured on the RunLab server.' : fallback;
          if (!controller.signal.aborted) setState({ error });
          return;
        }
        const history: HistoryData = await response.json();
        if (!Array.isArray(history?.weeks) || history.weeks.length !== 6 || !history.summary) {
          throw new Error('Unexpected training history response');
        }
        if (!controller.signal.aborted) setState({ history });
      } catch {
        if (!controller.signal.aborted) setState({ error: fallback });
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, []);

  const history = state && 'history' in state ? state.history : undefined;
  const summary = history?.summary;

  return (
    <section className="data-card training-history" aria-labelledby={id}>
      <h2 id={id}>Training History</h2>
      <p>Last six completed weeks in Europe/Rome.</p>
      {!state && <p role="status">Loading Garmin training history…</p>}
      {state && 'error' in state && <p role="alert">{state.error}</p>}
      {history && summary && (
        <>
          {summary.dataQuality.status === 'partial' && (
            <p className="message-warning">Some Garmin activities could not be dated or classified. Counts and totals may be incomplete.</p>
          )}
          {summary.totalActivities === 0 && summary.dataQuality.status === 'complete' && <p>No runs in these six weeks.</p>}
          <dl className="activity-metrics">
            <div><dt>Runs</dt><dd>{summary.totalActivities}</dd></div>
            <div><dt>Total distance</dt><dd>{kilometers(summary.totalActivities > 0 && !summary.coverage.activitiesWithDistance ? null : summary.totalDistanceKm)}</dd></div>
            <div><dt>Runs per week</dt><dd>{formatNumber.format(summary.averageRunsPerWeek)}</dd></div>
            <div><dt>Distance per week</dt><dd>{kilometers(summary.totalActivities > 0 && !summary.coverage.activitiesWithDistance ? null : summary.averageWeeklyDistanceKm)}</dd></div>
            <div><dt>Longest run</dt><dd>{kilometers(summary.longestRunDistanceKm)}</dd></div>
            <div><dt>Weeks without recorded runs</dt><dd>{summary.weeksWithNoRunningActivities}</dd></div>
            <div><dt>Most recent run</dt><dd>{summary.mostRecentRunningActivityDate ? dateLabel(summary.mostRecentRunningActivityDate) : 'Unavailable'}</dd></div>
          </dl>
          {summary.totalActivities > 0 && (
            <p className="training-history__coverage">
              Distance reported for {summary.coverage.activitiesWithDistance} of {summary.totalActivities} runs.
              {' '}Duration-weighted heart rate available for {summary.coverage.activitiesWithHeartRate}.
              {' '}Heart-rate zones reported for {summary.coverage.activitiesWithZoneData}, with all five
              zones reported for {summary.coverage.activitiesWithCompleteZoneData}.
            </p>
          )}
          <ol className="training-history__weeks">
            {history.weeks.map((week) => (
              <li key={week.weekStart}>
                <h3>{dateLabel(week.weekStart)} – {dateLabel(week.weekEnd)}</h3>
                <dl className="activity-metrics">
                  <div><dt>Runs</dt><dd>{week.activityCount}</dd></div>
                  <div><dt>Distance</dt><dd>{kilometers(week.activityCount > 0 && !week.coverage.activitiesWithDistance ? null : week.totalDistanceKm)}</dd></div>
                  <div><dt>Longest run</dt><dd>{kilometers(week.longestRunDistanceKm)}</dd></div>
                </dl>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
