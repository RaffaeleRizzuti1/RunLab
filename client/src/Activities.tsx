import { useEffect, useId, useState } from 'react';
import { isCalendarDate } from '../../server/src/rome-calendar';
import { ActivityMetrics } from './ActivityMetrics';
import { recentActivityMetrics, resolveRecentActivitySelection, type RecentActivity } from './activity-metrics';
import './Activities.css';

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

function ActivityCard({ activity, expanded, onToggle }: {
  activity: RecentActivity;
  expanded: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  const name = activity.name || 'Unnamed activity';
  const date = isCalendarDate(activity.date) ? activity.date : undefined;
  const metrics = recentActivityMetrics(activity);

  return (
    <li className="activity-card data-card" data-expanded={expanded}>
      <h3>
        <button className="activity-card__toggle" type="button" aria-expanded={expanded}
          aria-controls={panelId} onClick={onToggle}>
          <span className="activity-card__heading">
            <span className="activity-card__name">{name}</span>
            <span className="activity-card__metadata">
              {date && <time dateTime={date}>{dateFormatter.format(new Date(date))}</time>}
              {activity.activityType && <span>{activity.activityType.replaceAll('_', ' ')}</span>}
            </span>
          </span>
          <span className="activity-card__indicator" aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
      </h3>
      {!expanded && <ActivityMetrics values={metrics} />}
      <div className="activity-card__details" id={panelId} hidden={!expanded}>
        <h4>Activity details</h4>
        {expanded && <ActivityMetrics values={metrics} showMissing />}
      </div>
    </li>
  );
}

export function Activities() {
  const [activities, setActivities] = useState<RecentActivity[]>();
  const [error, setError] = useState<string>();
  const [selection, setSelection] = useState<RecentActivity>();
  const selected = resolveRecentActivitySelection(activities, selection);

  useEffect(() => {
    const controller = new AbortController();

    async function loadActivities() {
      try {
        const response = await fetch('/api/activities', { signal: controller.signal });
        if (response.status === 429 || response.status === 503) {
          if (!controller.signal.aborted) {
            setError(response.status === 429
              ? 'Garmin rate limit reached. Try again later.'
              : 'Garmin is not configured on the RunLab server.');
          }
          return;
        }
        if (!response.ok) {
          throw new Error('Activity request failed');
        }

        const data: RecentActivity[] = await response.json();
        if (!Array.isArray(data)) {
          throw new Error('Unexpected activity response');
        }
        if (!controller.signal.aborted) {
          setSelection(undefined);
          setActivities(data);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError('Could not load Garmin activities. Reload the page to try again.');
        }
      }
    }

    void loadActivities();
    return () => controller.abort();
  }, []);

  return (
    <section aria-labelledby="activities-heading">
      <h2 id="activities-heading">Recent Garmin activities</h2>
      {!activities && <p role={error ? 'alert' : 'status'}>{error ?? 'Loading Garmin activities…'}</p>}
      {activities?.length === 0 && <p>No Garmin activities found.</p>}
      {activities && activities.length > 0 && (
        <ul className="activity-list">
          {activities.map((activity, index) => (
            <ActivityCard key={index} activity={activity} expanded={selected === activity}
              onToggle={() => setSelection(selected === activity ? undefined : activity)} />
          ))}
        </ul>
      )}
    </section>
  );
}
