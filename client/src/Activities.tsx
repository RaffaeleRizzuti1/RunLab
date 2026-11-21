import { useEffect, useState } from 'react';

type Activity = {
  name?: string;
  date?: string;
  activityType?: string;
  distance?: number;
  duration?: number;
  averageHeartRate?: number;
};

export function Activities() {
  const [activities, setActivities] = useState<Activity[]>();
  const [error, setError] = useState<string>();

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

        const data: Activity[] = await response.json();
        if (!Array.isArray(data)) {
          throw new Error('Unexpected activity response');
        }
        if (!controller.signal.aborted) {
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
      {!activities && <p role="status">{error ?? 'Loading Garmin activities…'}</p>}
      {activities?.length === 0 && <p>No Garmin activities found.</p>}
      {activities && activities.length > 0 && (
        <ul>
          {activities.map((activity, index) => (
            <li key={index}>
              <strong>{activity.name || 'Unnamed activity'}</strong>
              {activity.date && <> · {activity.date}</>}
              {activity.activityType && <> · {activity.activityType.replaceAll('_', ' ')}</>}
              {activity.distance !== undefined && <> · {(activity.distance / 1_000).toFixed(2)} km</>}
              {activity.duration !== undefined && <> · {(activity.duration / 60).toFixed(1)} min</>}
              {activity.averageHeartRate !== undefined && <> · {Math.round(activity.averageHeartRate)} bpm</>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
