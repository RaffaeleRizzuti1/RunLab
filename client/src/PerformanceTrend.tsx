import { useId, useMemo } from 'react';
import { PaceTrendChart, type PaceChartActivity } from './PaceTrendChart';
import { analyzePerformanceTrend, stablePaceTrendThreshold } from './performance-trend';

const directionLabels = {
  improving: 'Improving',
  declining: 'Declining',
  stable: 'Stable',
  insufficient_data: 'Insufficient data',
};

const signedNumber = new Intl.NumberFormat('en', {
  signDisplay: 'exceptZero',
  maximumFractionDigits: 2,
});

export function PerformanceTrend({ activities }: { activities: readonly PaceChartActivity[] }) {
  const headingId = useId();
  const model = useMemo(() => analyzePerformanceTrend(activities), [activities]);
  const { activityCount, paceTrendSecondsPerKmPer30Days, trendDirection, rSquared } =
    model.trend;

  return (
    <section className="comparison-lab__insights" aria-labelledby={headingId}>
      <h3 id={headingId}>Performance Trend</h3>
      <dl className="comparison-lab__insight-grid">
        <div className="data-card">
          <dt>Activities used</dt>
          <dd>{activityCount}</dd>
        </div>
        <div className="data-card">
          <dt>Direction</dt>
          <dd>{directionLabels[trendDirection]}</dd>
        </div>
        {paceTrendSecondsPerKmPer30Days !== null && (
          <>
            <div className="data-card">
              <dt>Estimated change per 30 days</dt>
              <dd>{signedNumber.format(paceTrendSecondsPerKmPer30Days)} s/km</dd>
            </div>
            <div className="data-card">
              <dt>Fit (R²)</dt>
              <dd>{rSquared === null ? 'Unavailable' : rSquared.toFixed(2)}</dd>
            </div>
          </>
        )}
      </dl>
      {model.points.length > 0 && <PaceTrendChart model={model} />}
      {trendDirection === 'insufficient_data' ? (
        <p>A pace trend needs at least three valid runs on at least two distinct dates.</p>
      ) : (
        <>
          {(activityCount < 5 || model.dateSpanDays < 30) && (
            <p className="message-warning">
              {activityCount < 5 && 'Small sample. '}
              {model.dateSpanDays < 30
                ? `The 30-day estimate scales a fit observed over only ${model.dateSpanDays} days. `
                : ''}
              Interpret the estimate with caution.
            </p>
          )}
          <p>
            Negative values indicate faster pace over time. Changes smaller than {stablePaceTrendThreshold} s/km
            per 30 days in either direction are labeled stable. This descriptive trend cannot establish improved aerobic fitness.
          </p>
          <p>
            R² measures the share of observed pace variation explained by the fitted line. It does not indicate
            statistical significance. R² is unavailable when pace is constant.
          </p>
        </>
      )}
    </section>
  );
}
