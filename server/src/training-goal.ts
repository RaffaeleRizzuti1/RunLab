import { isCalendarDate, romeDate } from './rome-calendar.js';

export const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Weekday = typeof weekdays[number];

export type TrainingGoal = {
  targetDistanceKm: number;
  targetPaceSecondsPerKm: number;
  targetDate: string;
  runsPerWeek: number;
  preferredDays: Weekday[];
};

export type TrainingGoalDraft = {
  targetDistanceKm: string;
  targetPace: string;
  targetDate: string;
  runsPerWeek: string;
  preferredDays: string[];
};

export type GoalErrors = Partial<Record<keyof TrainingGoalDraft, string>>;

function isWeekday(value: unknown): value is Weekday {
  return weekdays.some((day) => day === value);
}

export function validateTrainingGoal(value: unknown, now: Date): GoalErrors {
  const candidate = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const { targetDistanceKm, targetPaceSecondsPerKm, targetDate, runsPerWeek, preferredDays } = candidate;
  const errors: GoalErrors = {};
  if (typeof targetDistanceKm !== 'number' || !Number.isFinite(targetDistanceKm) || targetDistanceKm <= 0) {
    errors.targetDistanceKm = 'Enter a distance greater than zero in kilometers.';
  }
  if (typeof targetPaceSecondsPerKm !== 'number' || !Number.isSafeInteger(targetPaceSecondsPerKm)
    || targetPaceSecondsPerKm <= 0 || targetPaceSecondsPerKm > 99 * 60 + 59) {
    errors.targetPace = 'Enter a positive pace in MM:SS format with seconds from 00 to 59.';
  }
  if (!isCalendarDate(targetDate) || targetDate <= romeDate(now)) {
    errors.targetDate = 'Choose a valid target date after today in Europe/Rome.';
  }
  if (typeof runsPerWeek !== 'number' || !Number.isInteger(runsPerWeek) || runsPerWeek < 2 || runsPerWeek > 5) {
    errors.runsPerWeek = 'Choose between 2 and 5 runs per week.';
  }
  if (!Array.isArray(preferredDays) || !preferredDays.every(isWeekday) || new Set(preferredDays).size !== preferredDays.length) {
    errors.preferredDays = 'Choose valid training days without duplicates.';
  }
  return errors;
}
