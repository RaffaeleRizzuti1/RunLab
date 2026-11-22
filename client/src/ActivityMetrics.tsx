import { formatActivityMetrics, type ActivityMetricValues } from './activity-metrics';
import './ActivityMetrics.css';

export function ActivityMetrics({ values, showMissing = false }: {
  values: ActivityMetricValues;
  showMissing?: boolean;
}) {
  const metrics = formatActivityMetrics(values).filter(({ value }) => showMissing || value !== undefined);
  if (metrics.length === 0) {
    return null;
  }

  return (
    <dl className="activity-metrics">
      {metrics.map(({ label, value }) => (
        <div key={label}><dt>{label}</dt><dd>{value ?? 'Not reported'}</dd></div>
      ))}
    </dl>
  );
}
