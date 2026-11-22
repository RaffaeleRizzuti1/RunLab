import { useId } from 'react';
import { formatTime } from './format-run-time';
import { calculatePerformanceInsights, type PerformanceActivity } from './performance-insights';

const signedNumber = new Intl.NumberFormat('en', {
  signDisplay: 'always',
  maximumFractionDigits: 2,
});

export function PerformanceInsights({ activities }: { activities: readonly PerformanceActivity[] }) {
  const headingId = useId();
  const insights = calculatePerformanceInsights(activities);
  const { totalComparedRuns, averagePaceSecondsPerKm, paceChangeSecondsPerKm, averageHeartRateChangeBpm } = insights;

  return (
    <section className="comparison-lab__insights" aria-labelledby={headingId}>
      <h3 id={headingId}>Performance Insights</h3>
      {totalComparedRuns === 0 ? (
        <p>Performance insights are available when at least one run matches your filters.</p>
      ) : (
        <>
          <dl className="comparison-lab__insight-grid">
            <div className="data-card">
              <dt>Compared runs</dt>
              <dd>{totalComparedRuns}</dd>
            </div>
            <div className="data-card">
              <dt>Distance-weighted average pace</dt>
              <dd>{averagePaceSecondsPerKm === null ? 'Unavailable' : `${formatTime(averagePaceSecondsPerKm)}/km`}</dd>
            </div>
            {paceChangeSecondsPerKm !== null && averageHeartRateChangeBpm !== null && (
              <>
                <div className="data-card">
                  <dt>Pace change</dt>
                  <dd>{signedNumber.format(paceChangeSecondsPerKm)} s/km</dd>
                </div>
                <div className="data-card">
                  <dt>Average heart rate change</dt>
                  <dd>{signedNumber.format(averageHeartRateChangeBpm)} bpm</dd>
                </div>
              </>
            )}
          </dl>
          <p>{totalComparedRuns < 2
            ? 'At least two matching runs are needed to show changes.'
            : 'Changes compare the earliest and latest matching runs. Negative values indicate faster pace or lower average heart rate.'}</p>
        </>
      )}
    </section>
  );
}
