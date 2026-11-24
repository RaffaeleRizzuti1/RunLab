import { expect, test } from 'vitest';
import { parseTrainingGoal } from '../../client/src/training-goal.js';
import { loadTrainingGoal, saveTrainingGoal, trainingGoalStorageKey } from '../../client/src/training-goal-storage.js';

const now = new Date('2026-11-22T23:30:00Z');
const draft = {
  targetDistanceKm: '21.1', targetPace: '05:30', targetDate: '2026-11-24',
  runsPerWeek: '3', preferredDays: ['Sunday', 'Monday'],
};
const goal = {
  targetDistanceKm: 21.1, targetPaceSecondsPerKm: 330, targetDate: '2026-11-24',
  runsPerWeek: 3, preferredDays: ['Monday', 'Sunday'] as ('Monday' | 'Sunday')[],
};

test('parses a valid goal and orders preferred days by weekday', () => {
  expect(parseTrainingGoal(draft, now)).toEqual({ goal });
});

test.each([
  ['targetDistanceKm', ['0', '-3', 'Infinity', 'NaN', '12km', '', ' 6', '0xA', '1e999']],
  ['targetPace', ['00:00', '05:60', '5:30', '05:3', '05:30x', ' 05:30', '']],
  ['targetDate', ['2026-11-22', '2026-11-23', '2027-02-29', '2026-11-31', '2026-11-24T00:00:00Z']],
  ['runsPerWeek', ['1', '6', '2.5', '3x', '03', '']],
] as const)('rejects malformed or out-of-range %s', (field, inputs) => {
  for (const input of inputs) {
    expect(parseTrainingGoal({ ...draft, [field]: input }, now)).toHaveProperty(`errors.${field}`);
  }
});

test('accepts pace and runs-per-week boundaries and optional empty days', () => {
  expect(parseTrainingGoal({ ...draft, targetDistanceKm: '.5', targetPace: '00:01', runsPerWeek: '2', preferredDays: [] }, now))
    .toEqual({ goal: { ...goal, targetDistanceKm: 0.5, targetPaceSecondsPerKm: 1, runsPerWeek: 2, preferredDays: [] } });
  expect(parseTrainingGoal({ ...draft, targetPace: '99:59', runsPerWeek: '5' }, now))
    .toEqual({ goal: { ...goal, targetPaceSecondsPerKm: 5_999, runsPerWeek: 5 } });
});

test('rejects unknown or repeated preferred days', () => {
  for (const preferredDays of [['Funday'], ['Monday', 'Monday'], ['monday']]) {
    expect(parseTrainingGoal({ ...draft, preferredDays }, now)).toHaveProperty('errors.preferredDays');
  }
});

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(trainingGoalStorageKey, initial);
  return () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
}

test('persists validated goals and restores the latest saved edit from the versioned key', () => {
  const storage = memoryStorage();
  expect(loadTrainingGoal(storage, now)).toBeNull();
  expect(saveTrainingGoal(storage, goal, now)).toBe(true);
  expect(JSON.parse(storage().getItem(trainingGoalStorageKey)!)).toEqual(goal);
  const edited = { ...goal, runsPerWeek: 5 };
  expect(saveTrainingGoal(storage, edited, now)).toBe(true);
  expect(loadTrainingGoal(storage, now)).toEqual({ goal: edited });
  expect(saveTrainingGoal(storage, { ...goal, targetDistanceKm: 0 }, now)).toBe(false);
  expect(loadTrainingGoal(storage, now)).toEqual({ goal: edited });
});

test('handles corrupted, incompatible, expired and unavailable storage', () => {
  for (const saved of ['{', 'null', '{}', JSON.stringify({ ...goal, runsPerWeek: '3' }),
    JSON.stringify({ ...goal, targetDate: '2026-11-23' })]) {
    expect(loadTrainingGoal(memoryStorage(saved), now)).toEqual({ issue: 'invalid' });
  }
  const blocked = () => { throw new Error('Storage unavailable'); };
  expect(loadTrainingGoal(blocked, now)).toEqual({ issue: 'unavailable' });
  expect(saveTrainingGoal(blocked, goal, now)).toBe(false);
});
