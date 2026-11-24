import { validateTrainingGoal, type TrainingGoal } from './training-goal.js';

export const trainingGoalStorageKey = 'runlab.training-goal.v1';
type StorageAccess = () => { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function loadTrainingGoal(storage: StorageAccess, now: Date):
  { goal: TrainingGoal } | { issue: 'invalid' | 'unavailable' } | null {
  let saved: string | null;
  try {
    saved = storage().getItem(trainingGoalStorageKey);
  } catch {
    return { issue: 'unavailable' };
  }
  if (saved === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(saved);
    if (Object.keys(validateTrainingGoal(value, now)).length === 0) {
      return { goal: value as TrainingGoal };
    }
  } catch {
    return { issue: 'invalid' };
  }
  return { issue: 'invalid' };
}

export function saveTrainingGoal(storage: StorageAccess, goal: TrainingGoal, now: Date): boolean {
  if (Object.keys(validateTrainingGoal(goal, now)).length > 0) {
    return false;
  }
  try {
    storage().setItem(trainingGoalStorageKey, JSON.stringify(goal));
    return true;
  } catch {
    return false;
  }
}
