import { buildAthleteContext } from './coach-athlete-context.js';
import type { AiProviderName } from './ai-provider.js';
import { logTrainingPlanDiagnostic } from './training-plan-diagnostics.js';
import { getRomeWeek, isCalendarDate, romeDate, shiftCalendarDate } from './rome-calendar.js';
import { getTrainingHistoryWeeks, summarizeTrainingHistory } from './training-history.js';
import type { createGarminClient } from './garmin.js';
import type { TrainingGoal } from './training-goal.js';

import { hasWorkoutStructure, intensities, workoutConsistency, workoutSessionSchema, workoutTypes,
  type StructuredSession } from './workout-structure.js';

export type GeneratedPlan =
  | { status: 'generated'; message: string; sessions: StructuredSession[] }
  | { status: 'cannot_generate'; message: string; sessions: [] };

export const planSchema = {
  type: 'object', additionalProperties: false,
  required: ['status', 'message', 'sessions'],
  properties: {
    status: { type: 'string', enum: ['generated', 'cannot_generate'] },
    message: { type: 'string' },
    sessions: {
      type: 'array', items: workoutSessionSchema,
    },
  },
};

type HistoryWeek = ReturnType<typeof summarizeTrainingHistory>['weeks'][number];

function distanceReported(week: HistoryWeek): boolean {
  return week.coverage.activitiesWithDistance === week.activityCount;
}

function intensityDistribution(week: HistoryWeek) {
  const zoneSeconds = week.heartRateZones.seconds;
  const reported = Object.values(zoneSeconds).filter((seconds): seconds is number => seconds !== null);
  const recordedSeconds = reported.length ? reported.reduce((sum, seconds) => sum + seconds, 0) : null;
  return {
    recordedSeconds,
    shareOfRecordedSecondsByZone: Object.fromEntries(Object.entries(zoneSeconds).map(([zone, seconds]) => [
      zone, seconds === null || !recordedSeconds ? null : seconds / recordedSeconds,
    ])),
  };
}

function mileagePattern(previousDistance: number, latestDistance: number) {
  if (previousDistance === 0) return latestDistance === 0 ? 'no_recorded_distance' : 'resumed_after_zero_distance';
  if (latestDistance > previousDistance * 1.2) return 'spike';
  if (latestDistance < previousDistance * 0.8) return 'sharp_drop';
  return 'within_comparison_band';
}

function getRecencyContext(history: ReturnType<typeof summarizeTrainingHistory>,
  current: ReturnType<typeof summarizeTrainingHistory>, today: string) {
  const [previous, latest] = history.weeks.slice(-2);
  const classified = history.summary.dataQuality.status === 'complete';
  const recentDistanceKnown = classified && distanceReported(previous) && distanceReported(latest);
  const distanceChangeKm = recentDistanceKnown ? latest.totalDistanceKm - previous.totalDistanceKm : null;
  const distanceChangePercent = distanceChangeKm !== null && previous.totalDistanceKm > 0
    ? distanceChangeKm / previous.totalDistanceKm * 100 : null;
  const lastRun = current.summary.mostRecentRunningActivityDate ?? history.summary.mostRecentRunningActivityDate;
  let consecutiveActiveWeeks = 0;
  let consecutiveInactiveWeeks = 0;
  for (const week of history.weeks.slice().reverse()) {
    if (week.activityCount > 0 && consecutiveInactiveWeeks === 0) consecutiveActiveWeeks++;
    else if (week.activityCount === 0 && consecutiveActiveWeeks === 0) consecutiveInactiveWeeks++;
    else break;
  }

  const longestRuns = [previous.longestRunDistanceKm, latest.longestRunDistanceKm]
    .filter((distance): distance is number => distance !== null);
  return {
    latestCompletedWeek: { ...latest, intensityDistribution: intensityDistribution(latest) },
    previousCompletedWeek: { ...previous, intensityDistribution: intensityDistribution(previous) },
    lastTwoCompletedWeeks: {
      recordedDistanceKm: previous.totalDistanceKm + latest.totalDistanceKm,
      activityCount: previous.activityCount + latest.activityCount,
      longestRecordedRunDistanceKm: longestRuns.length ? Math.max(...longestRuns) : null,
      distanceCoverageComplete: recentDistanceKnown,
    },
    mileageProgression: {
      distanceChangeKm,
      distanceChangePercent: distanceChangePercent !== null && Number.isFinite(distanceChangePercent) ? distanceChangePercent : null,
      pattern: recentDistanceKnown ? mileagePattern(previous.totalDistanceKm, latest.totalDistanceKm) : 'unknown',
    },
    daysSinceMostRecentRecordedRun: lastRun ? (Date.parse(today) - Date.parse(lastRun)) / 86_400_000 : null,
    consecutiveActiveCompletedWeeks: classified ? consecutiveActiveWeeks : null,
    consecutiveInactiveCompletedWeeks: classified ? consecutiveInactiveWeeks : null,
    sixWeekAverageRecordedDistanceKm: history.summary.averageWeeklyDistanceKm,
  };
}

function distanceLimits(recent: readonly HistoryWeek[], distanceReliable: boolean) {
  if (!distanceReliable) return { maxWeeklyDistanceKm: 0, maxSessionDistanceKm: 0 };
  const [previous, latest] = recent.slice(-2);
  const latestDistance = latest.totalDistanceKm;
  const previousDistance = previous.totalDistanceKm;
  const recentAverage = recent.reduce((sum, week) => sum + week.totalDistanceKm, 0) / recent.length;
  // These are rejection limits, never workout prescriptions. A swing beyond 20% is unconfirmed.
  const pattern = mileagePattern(previousDistance, latestDistance);
  const spike = pattern === 'spike';
  const weeklyCap = previousDistance === 0
    ? Math.min(latestDistance, recentAverage * 1.1)
    : spike ? previousDistance * 1.1 : pattern === 'sharp_drop' ? latestDistance : latestDistance * 1.1;
  const longest = spike
    ? previous.longestRunDistanceKm ?? 0
    : Math.max(previous.longestRunDistanceKm ?? 0, latest.longestRunDistanceKm ?? 0);
  return { maxWeeklyDistanceKm: weeklyCap, maxSessionDistanceKm: Math.min(weeklyCap, longest * 1.1) };
}

export async function buildTrainingPlanContext(
  garmin: Pick<ReturnType<typeof createGarminClient>, 'getActivitiesInDateRange'>, goal: TrainingGoal, now: Date,
) {
  const today = romeDate(now);
  const currentWeek = getRomeWeek(now);
  const weekStart = shiftCalendarDate(currentWeek.weekStart, 7);
  const nextWeek = { weekStart, weekEnd: shiftCalendarDate(weekStart, 6) };
  const completedWeeks = getTrainingHistoryWeeks(now);
  const activities = await garmin.getActivitiesInDateRange(
    shiftCalendarDate(completedWeeks[0].weekStart, -1), shiftCalendarDate(today, 1), true,
  );
  const history = summarizeTrainingHistory(completedWeeks, activities);
  const current = summarizeTrainingHistory([{ weekStart: currentWeek.weekStart, weekEnd: today }], activities);
  const recent = history.weeks.slice(-3);
  const distanceReliable = history.summary.dataQuality.status === 'complete' && current.summary.dataQuality.status === 'complete'
    && recent.every(distanceReported);
  const observedPaces = recent.flatMap((week) => week.averagePaceSecondsPerKm === null ? [] : [week.averagePaceSecondsPerKm]);
  const fastestObservedPace = observedPaces.length ? Math.min(...observedPaces) : null;
  return {
    goal,
    daysUntilTarget: (Date.parse(goal.targetDate) - Date.parse(today)) / 86_400_000,
    nextWeek,
    history,
    recency: getRecencyContext(history, current, today),
    athlete: buildAthleteContext(activities, today, shiftCalendarDate(currentWeek.weekStart, -14)),
    currentWeek: {
      ...current.weeks[0], weekEnd: currentWeek.weekEnd, throughDate: today, isPartial: true,
      dataQuality: current.summary.dataQuality, intensityDistribution: intensityDistribution(current.weeks[0]),
    },
    limits: {
      ...distanceLimits(recent, distanceReliable),
      minPaceSecondsPerKm: Math.max(150, (fastestObservedPace ?? 0) * 0.8),
    },
  };
}

export type TrainingPlanContext = Awaited<ReturnType<typeof buildTrainingPlanContext>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_000;
}

function isChoice<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return choices.some((choice) => choice === value);
}

function optionalInteger(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum);
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function validateGeneratedPlan(text: string, context: TrainingPlanContext, provider?: AiProviderName): GeneratedPlan | undefined {
  function rejectPlan(stage: 'structured_output' | 'safety_validation', rule: string,
    values?: Record<string, number | undefined>): undefined {
    logTrainingPlanDiagnostic(stage, rule, values, provider);
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return rejectPlan('structured_output', 'invalid_json');
  }
  if (!isRecord(data) || Object.keys(data).length !== 3) return rejectPlan('structured_output', 'plan_shape');
  if (!isText(data.message)) return rejectPlan('structured_output', 'plan_message');
  if (!Array.isArray(data.sessions)) return rejectPlan('structured_output', 'sessions_not_array');
  if (data.status === 'cannot_generate' && data.sessions.length === 0) {
    return { status: 'cannot_generate', message: data.message, sessions: [] };
  }
  if (data.status === 'cannot_generate') {
    return rejectPlan('structured_output', 'abstention_requires_empty_sessions', { actualCount: data.sessions.length });
  }
  if (data.status !== 'generated') return rejectPlan('structured_output', 'invalid_status');
  if (data.sessions.length !== context.goal.runsPerWeek) {
    return rejectPlan('structured_output', 'session_count', {
      actualCount: data.sessions.length, expectedCount: context.goal.runsPerWeek,
    });
  }

  const sessions: StructuredSession[] = [];
  const dates = new Set<string>();
  let totalDistance = 0;
  let strenuousSessions = 0;
  for (const [index, value] of data.sessions.entries()) {
    const sessionIndex = index + 1;
    if (!isRecord(value) || !hasWorkoutStructure(value)) {
      return rejectPlan('structured_output', 'session_shape', { sessionIndex });
    }
    const { date, workoutType, distanceKm, estimatedDurationSeconds, targetPaceSecondsPerKm,
      intensity, description, rationale } = value;
    if (!isCalendarDate(date)) return rejectPlan('structured_output', 'session_date_format', { sessionIndex });
    if (date < context.nextWeek.weekStart || date > context.nextWeek.weekEnd) {
      const dayOffset = (Date.parse(date) - Date.parse(context.nextWeek.weekStart)) / 86_400_000;
      return rejectPlan('safety_validation', 'session_outside_next_week', { sessionIndex, dayOffset, min: 0, max: 6 });
    }
    if (date > context.goal.targetDate) {
      const daysAfterGoal = (Date.parse(date) - Date.parse(context.goal.targetDate)) / 86_400_000;
      return rejectPlan('safety_validation', 'session_after_goal_date', { sessionIndex, daysAfterGoal });
    }
    if (dates.has(date)) return rejectPlan('safety_validation', 'duplicate_session_date', { sessionIndex });
    if (!isChoice(workoutType, workoutTypes)) return rejectPlan('structured_output', 'invalid_workout_type', { sessionIndex });
    if (!isChoice(intensity, intensities)) return rejectPlan('structured_output', 'invalid_intensity', { sessionIndex });
    if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm <= 0) {
      return rejectPlan('structured_output', 'invalid_distance', { sessionIndex, distanceKm: numericValue(distanceKm) });
    }
    if (distanceKm > context.limits.maxSessionDistanceKm) {
      return rejectPlan('safety_validation', 'session_distance_cap', {
        sessionIndex, distanceKm, maxSessionDistanceKm: context.limits.maxSessionDistanceKm,
      });
    }
    if (!optionalInteger(estimatedDurationSeconds, 1, 21_600)) {
      return rejectPlan('structured_output', 'invalid_duration', {
        sessionIndex, durationSeconds: numericValue(estimatedDurationSeconds), min: 1, max: 21_600,
      });
    }
    if (targetPaceSecondsPerKm !== null
      && (typeof targetPaceSecondsPerKm !== 'number' || !Number.isInteger(targetPaceSecondsPerKm))) {
      return rejectPlan('structured_output', 'invalid_target_pace_type', { sessionIndex });
    }
    if (!optionalInteger(targetPaceSecondsPerKm, context.limits.minPaceSecondsPerKm, 1_800)) {
      return rejectPlan('safety_validation', 'target_pace_bounds', {
        sessionIndex, paceSecondsPerKm: numericValue(targetPaceSecondsPerKm), min: context.limits.minPaceSecondsPerKm, max: 1_800,
      });
    }
    if (!isText(description)) return rejectPlan('structured_output', 'invalid_description', { sessionIndex });
    if (!isText(rationale)) return rejectPlan('structured_output', 'invalid_rationale', { sessionIndex });
    if (estimatedDurationSeconds !== null) {
      const impliedPace = estimatedDurationSeconds / distanceKm;
      if (impliedPace < context.limits.minPaceSecondsPerKm || impliedPace > 1_800) {
        return rejectPlan('safety_validation', 'implied_pace_bounds', {
          sessionIndex, impliedPace, estimatedDurationSeconds, distanceKm, min: context.limits.minPaceSecondsPerKm, max: 1_800,
        });
      }
    }
    dates.add(date);
    if (intensity === 'hard' || ['tempo', 'intervals', 'fartlek', 'progressive'].includes(workoutType)) strenuousSessions++;
    const session = { date, workoutType, distanceKm, estimatedDurationSeconds, targetPaceSecondsPerKm, intensity,
      description, rationale, title: value.title, purpose: value.purpose, heartRateBpm: value.heartRateBpm, phases: value.phases };
    const consistency = workoutConsistency(session, context.limits.minPaceSecondsPerKm, context.athlete.observedHeartRateBpm);
    if ('rule' in consistency) return rejectPlan('safety_validation', consistency.rule, { sessionIndex, ...consistency.values });
    const plannedDistanceKm = Math.max(distanceKm, consistency.maxDistanceKm);
    if (plannedDistanceKm > context.limits.maxSessionDistanceKm) {
      return rejectPlan('safety_validation', 'phase_session_distance_cap', {
        sessionIndex, plannedDistanceKm, maxSessionDistanceKm: context.limits.maxSessionDistanceKm,
      });
    }
    totalDistance += plannedDistanceKm;
    sessions.push(session);
  }
  if (totalDistance > context.limits.maxWeeklyDistanceKm) {
    return rejectPlan('safety_validation', 'weekly_distance_cap', {
      totalDistanceKm: totalDistance, maxWeeklyDistanceKm: context.limits.maxWeeklyDistanceKm,
    });
  }
  if (strenuousSessions > 1) return rejectPlan('safety_validation', 'strenuous_session_cap', { strenuousSessions, max: 1 });
  return { status: 'generated', message: data.message, sessions };
}
