import type { WorkoutEffort, WorkoutPhase } from '../../server/src/workout-structure';
import { formatTime } from './format-run-time';

const phaseLabels = { warm_up: 'Warm-up', main: 'Main effort', repeats: 'Intervals', cool_down: 'Cool-down' };
const distanceFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

function effortDetails(effort: WorkoutEffort) {
  const { paceSecondsPerKm: pace, heartRateBpm: hr } = effort;
  return [
    effort.distanceKm === null ? null : `${distanceFormat.format(effort.distanceKm)} km`,
    effort.durationSeconds === null ? null : formatTime(effort.durationSeconds, true),
    pace === null ? null : `${formatTime(pace.min)}–${formatTime(pace.max)} min/km`,
    hr === null ? null : `${hr.min}–${hr.max} bpm`,
  ].filter((part) => part !== null).join(' · ');
}

export function WorkoutPhases({ phases }: { phases: readonly WorkoutPhase[] }) {
  const repeated = phases.some(({ kind }) => kind === 'repeats');
  return (
    <div className="workout-phases">
      <h5>Workout phases</h5>
      {repeated && (
        <div className="workout-phases__timeline" aria-hidden="true">
          {phases.flatMap(({ kind, repetitions }, index) => kind === 'repeats'
            ? Array.from({ length: repetitions }, (_, repeat) => (
              <span className="workout-phases__pair" key={`${index}-${repeat}`}><i data-phase="work" /><i data-phase="recovery" /></span>
            ))
            : <i key={index} data-phase={kind} />)}
        </div>
      )}
      <ol>
        {phases.map((phase, index) => (
          <li key={index}>
            <strong>{phase.kind === 'repeats' ? `${phase.repetitions} repetitions` : phaseLabels[phase.kind]}</strong>
            <span>{phase.kind === 'repeats' && 'Work: '}{effortDetails(phase.effort)}</span>
            {phase.recovery && <span>Recovery: {effortDetails(phase.recovery)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
