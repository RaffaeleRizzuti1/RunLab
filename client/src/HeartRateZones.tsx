import { useId } from 'react';
import { heartRateZoneKeys, type HeartRateZones as ZoneSummary } from '../../server/src/heart-rate-zones';
import './HeartRateZones.css';

const secondsFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });

function formatDuration(seconds: number): string {
  const roundedSeconds = Math.round(seconds * 1_000) / 1_000;
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = secondsFormatter.format(roundedSeconds % 60);
  return minutes > 0 ? `${minutes} min ${remainder} sec` : `${remainder} sec`;
}

export function HeartRateZones({ zones, activityCount }: { zones: ZoneSummary; activityCount: number }) {
  const headingId = useId();
  const { activitiesWithZoneData, activitiesWithCompleteZoneData } = zones.coverage;
  const totalSeconds = heartRateZoneKeys.reduce((sum, zone) => sum + (zones.seconds[zone] ?? 0), 0);

  return (
    <section className="heart-rate-zones" aria-labelledby={headingId}>
      <h3 id={headingId}>Heart Rate Zones</h3>
      {activitiesWithZoneData === 0 ? (
        <p>{activityCount === 0
          ? 'No running activities this week to show heart rate zones for.'
          : 'Garmin did not report heart rate zone data for this week’s runs.'}</p>
      ) : (
        <>
          {activitiesWithCompleteZoneData < activityCount && (
            <p>Incomplete coverage. {activitiesWithZoneData} of {activityCount} runs reported zone data.
              {' '}{activitiesWithCompleteZoneData} reported all five zones.</p>
          )}
          <p>{totalSeconds > 0
            ? 'Percentages are shares of reported zone time.'
            : 'Percentages are unavailable because the reported zone time totals zero.'}</p>
          <dl className="heart-rate-zones__list">
            {heartRateZoneKeys.map((zone) => {
              const seconds = zones.seconds[zone];
              const percent = seconds !== null && totalSeconds > 0 ? seconds / totalSeconds * 100 : null;

              return (
                <div className="heart-rate-zones__row" key={zone}>
                  <dt><abbr title={`Heart rate zone ${zone[1]}`}>{zone.toUpperCase()}</abbr></dt>
                  <dd>
                    <div className="heart-rate-zones__track" aria-hidden="true">
                      {percent !== null && <span style={{ width: `${percent}%` }} />}
                    </div>
                    <span>{seconds === null ? 'Not reported' : formatDuration(seconds)}</span>
                    {percent !== null && <span> · {percent.toFixed(1)}%</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
    </section>
  );
}
