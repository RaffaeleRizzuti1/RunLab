export const workoutTypes = ['easy', 'recovery', 'long', 'tempo', 'intervals', 'progressive', 'fartlek'] as const;
export const intensities = ['easy', 'moderate', 'hard'] as const;
export const phaseKinds = ['warm_up', 'main', 'repeats', 'cool_down'] as const;
type Range = { min: number; max: number };
export type WorkoutEffort = {
  distanceKm: number | null;
  durationSeconds: number | null;
  paceSecondsPerKm: Range | null;
  heartRateBpm: Range | null;
};
export type WorkoutPhase = {
  kind: typeof phaseKinds[number];
  repetitions: number;
  effort: WorkoutEffort;
  recovery: WorkoutEffort | null;
};
export type Session = {
  date: string;
  workoutType: typeof workoutTypes[number];
  distanceKm: number;
  estimatedDurationSeconds: number | null;
  targetPaceSecondsPerKm: number | null;
  intensity: typeof intensities[number];
  description: string;
  rationale: string;
};
export type StructuredSession = Session & {
  title: string;
  purpose: string;
  heartRateBpm: Range | null;
  phases: WorkoutPhase[];
};

function objectSchema<T extends Record<string, unknown>>(properties: T) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const rangeSchema = nullable(objectSchema({ min: { type: 'integer' }, max: { type: 'integer' } }));
const effortSchema = objectSchema({
  distanceKm: { type: ['number', 'null'] },
  durationSeconds: { type: ['integer', 'null'] },
  paceSecondsPerKm: rangeSchema,
  heartRateBpm: rangeSchema,
});

export const workoutSessionSchema = objectSchema({
  date: { type: 'string', description: 'YYYY-MM-DD calendar date' },
  workoutType: { type: 'string', enum: workoutTypes },
  distanceKm: { type: 'number' },
  estimatedDurationSeconds: { type: ['integer', 'null'] },
  targetPaceSecondsPerKm: { type: ['integer', 'null'] },
  intensity: { type: 'string', enum: intensities },
  description: { type: 'string' },
  rationale: { type: 'string' },
  title: { type: 'string' },
  purpose: { type: 'string' },
  heartRateBpm: rangeSchema,
  phases: { type: 'array', items: objectSchema({
    kind: { type: 'string', enum: phaseKinds },
    repetitions: { type: 'integer' },
    effort: effortSchema,
    recovery: nullable(effortSchema),
  }) },
});

function record(value: unknown, size: number): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === size;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_000;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function range(value: unknown, min: number, max: number): value is Range | null {
  if (value === null) return true;
  return record(value, 2) && typeof value.min === 'number' && typeof value.max === 'number'
    && Number.isInteger(value.min) && Number.isInteger(value.max)
    && value.min >= min && value.max <= max && value.min <= value.max;
}

function effort(value: unknown): value is WorkoutEffort {
  if (!record(value, 4)) return false;
  const { distanceKm, durationSeconds, paceSecondsPerKm, heartRateBpm } = value;
  return (distanceKm === null || positive(distanceKm))
    && (durationSeconds === null || (positive(durationSeconds) && Number.isInteger(durationSeconds) && durationSeconds <= 21_600))
    && (distanceKm !== null || (durationSeconds !== null && paceSecondsPerKm !== null))
    && range(paceSecondsPerKm, 150, 1_800) && range(heartRateBpm, 1, 300);
}

export function hasWorkoutStructure(value: Record<string, unknown>):
  value is Record<string, unknown> & Pick<StructuredSession, 'title' | 'purpose' | 'heartRateBpm' | 'phases'> {
  if (Object.keys(value).length !== 12 || !text(value.title) || !text(value.purpose)
    || !range(value.heartRateBpm, 1, 300) || !Array.isArray(value.phases)
    || value.phases.length < 1 || value.phases.length > 8) return false;

  let last = -1;
  let main = false;
  for (const phase of value.phases) {
    if (!record(phase, 4) || !effort(phase.effort)) return false;
    const kind = phaseKinds.findIndex((option) => option === phase.kind);
    if (kind < 0 || kind < last || (kind === last && (kind === 0 || kind === 3))) return false;
    if (phase.kind === 'repeats') {
      if (typeof phase.repetitions !== 'number' || !Number.isInteger(phase.repetitions)
        || phase.repetitions < 2 || phase.repetitions > 20 || !effort(phase.recovery)) return false;
    } else if (phase.repetitions !== 1 || phase.recovery !== null) return false;
    last = kind;
    main ||= phase.kind === 'main' || phase.kind === 'repeats';
  }
  return main;
}

export function workoutConsistency(
  session: StructuredSession,
  minPace: number,
  observedHeartRate?: Range | null,
): { rule: string; values?: Record<string, number> } | { maxDistanceKm: number } {
  const supportedHr = (target: Range | null) => target === null || observedHeartRate === undefined
    || (observedHeartRate !== null && target.min >= observedHeartRate.min && target.max <= observedHeartRate.max);
  if (!supportedHr(session.heartRateBpm)) return { rule: 'unsupported_session_heart_rate' };
  const hasRepeats = session.phases.some(({ kind }) => kind === 'repeats');
  if (hasRepeats !== (session.workoutType === 'intervals' || session.workoutType === 'fartlek')) {
    return { rule: 'repeat_blocks_must_match_workout_type' };
  }
  let minDistance = 0;
  let maxDistance = 0;
  let minDuration = 0;
  let maxDuration = 0;
  let durationKnown = true;
  for (const phase of session.phases) {
    for (const block of [phase.effort, phase.recovery]) {
      if (block === null) continue;
      const { distanceKm, durationSeconds, paceSecondsPerKm: pace, heartRateBpm } = block;
      if (!supportedHr(heartRateBpm)) return { rule: 'unsupported_phase_heart_rate' };
      if (pace && pace.min < minPace) return { rule: 'phase_pace_bounds', values: { minPace, pace: pace.min } };
      if (distanceKm !== null && durationSeconds !== null) {
        const implied = durationSeconds / distanceKm;
        if (implied < minPace || implied > 1_800 || (pace && (implied < pace.min - 5 || implied > pace.max + 5))) {
          return { rule: 'phase_implied_pace', values: { implied, minPace } };
        }
      }
      minDistance += phase.repetitions * (distanceKm ?? durationSeconds! / pace!.max);
      maxDistance += phase.repetitions * (distanceKm ?? durationSeconds! / pace!.min);
      if (durationSeconds === null && pace === null) durationKnown = false;
      else {
        minDuration += phase.repetitions * (durationSeconds ?? distanceKm! * pace!.min);
        maxDuration += phase.repetitions * (durationSeconds ?? distanceKm! * pace!.max);
      }
    }
  }
  if (session.distanceKm < minDistance - 0.1 || session.distanceKm > maxDistance + 0.1) {
    return { rule: 'phase_distance_total', values: { minDistance, maxDistance, sessionDistanceKm: session.distanceKm } };
  }
  const duration = session.estimatedDurationSeconds;
  if (duration !== null && (!durationKnown || duration < minDuration - 30 || duration > maxDuration + 30)) {
    return { rule: 'phase_duration_total', values: { minDuration, maxDuration, duration } };
  }
  if (session.targetPaceSecondsPerKm !== null && durationKnown
    && (session.targetPaceSecondsPerKm < minDuration / maxDistance - 5
      || session.targetPaceSecondsPerKm > maxDuration / minDistance + 5)) {
    return { rule: 'session_pace_conflicts_with_phases' };
  }
  return { maxDistanceKm: maxDistance };
}
