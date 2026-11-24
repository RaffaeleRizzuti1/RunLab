import { validateTrainingGoal, weekdays, type GoalErrors, type TrainingGoal, type TrainingGoalDraft } from '../../server/src/training-goal.js';

export { validateTrainingGoal, weekdays } from '../../server/src/training-goal.js';
export type { GoalErrors, TrainingGoal, TrainingGoalDraft, Weekday } from '../../server/src/training-goal.js';

export function parseTrainingGoal(draft: TrainingGoalDraft, now: Date): { goal: TrainingGoal } | { errors: GoalErrors } {
  const pace = /^(\d{2}):([0-5]\d)$/.exec(draft.targetPace);
  const candidate = {
    targetDistanceKm: /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(draft.targetDistanceKm) ? Number(draft.targetDistanceKm) : NaN,
    targetPaceSecondsPerKm: pace ? Number(pace[1]) * 60 + Number(pace[2]) : NaN,
    targetDate: draft.targetDate,
    runsPerWeek: /^[2-5]$/.test(draft.runsPerWeek) ? Number(draft.runsPerWeek) : NaN,
    preferredDays: draft.preferredDays,
  };
  const errors = validateTrainingGoal(candidate, now);
  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { goal: { ...candidate, preferredDays: weekdays.filter((day) => draft.preferredDays.includes(day)) } };
}
