import { getRomeWeek, isCalendarDate, shiftCalendarDate } from '../../server/src/rome-calendar.js';
import { hasWorkoutStructure, intensities, workoutConsistency, workoutTypes,
  type Session, type StructuredSession } from '../../server/src/workout-structure.js';
import { weekdays, type TrainingGoal } from './training-goal.js';

export type PlanResponse = { weekStart: string; weekEnd: string; message: string } &
  ({ status: 'generated'; sessions: (Session | StructuredSession)[] } | { status: 'cannot_generate'; sessions: [] });
export type SavedPlan = {
  goalFingerprint: string;
  plan: Extract<PlanResponse, { status: 'generated' }>;
};

export const weeklyPlanStorageKey = 'runlab.weekly-training-plan.v2';
const legacyStorageKey = 'runlab.weekly-training-plan.v1';
type StorageAccess = () => { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function nextPlanWeek(now: Date) {
  const weekStart = shiftCalendarDate(getRomeWeek(now).weekStart, 7);
  return { weekStart, weekEnd: shiftCalendarDate(weekStart, 6) };
}

export function goalPayload(goal: TrainingGoal): TrainingGoal {
  const { targetDistanceKm, targetPaceSecondsPerKm, targetDate, runsPerWeek, preferredDays } = goal;
  return { targetDistanceKm, targetPaceSecondsPerKm, targetDate, runsPerWeek,
    preferredDays: weekdays.filter((day) => preferredDays.includes(day)) };
}

export async function fingerprintGoal(goal: TrainingGoal): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(goalPayload(goal))));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_000;
}

function isChoice<T>(value: unknown, choices: readonly T[]): value is T {
  return choices.some((choice) => choice === value);
}

function optionalInteger(value: unknown, min: number, max: number): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max);
}

export function parsePlanResponse(value: unknown, allowLegacy = false): PlanResponse | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 5) return undefined;
  const { weekStart, weekEnd, status, message, sessions } = value;
  if (!isCalendarDate(weekStart) || !isCalendarDate(weekEnd) || new Date(weekStart).getUTCDay() !== 1
    || weekEnd !== shiftCalendarDate(weekStart, 6) || !isText(message) || !Array.isArray(sessions)) return undefined;

  if (status === 'cannot_generate' && sessions.length === 0) {
    return { status, weekStart, weekEnd, message, sessions: [] };
  }
  if (status !== 'generated' || sessions.length < 2 || sessions.length > 5) return undefined;

  const parsed: (Session | StructuredSession)[] = [];
  const dates = new Set<string>();
  for (const entry of sessions) {
    if (!isRecord(entry)) return undefined;
    const legacy = allowLegacy && Object.keys(entry).length === 8;
    const structure = hasWorkoutStructure(entry) ? entry : undefined;
    if (!legacy && !structure) return undefined;
    const { date, workoutType, distanceKm, estimatedDurationSeconds, targetPaceSecondsPerKm,
      intensity, description, rationale } = entry;
    if (!isCalendarDate(date) || date < weekStart || date > weekEnd || dates.has(date)
      || !isChoice(workoutType, workoutTypes) || !isChoice(intensity, intensities)
      || typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm <= 0
      || !optionalInteger(estimatedDurationSeconds, 1, 21_600)
      || !optionalInteger(targetPaceSecondsPerKm, 150, 1_800) || !isText(description) || !isText(rationale)) return undefined;
    dates.add(date);
    const session = { date, workoutType, distanceKm, estimatedDurationSeconds, targetPaceSecondsPerKm,
      intensity, description, rationale };
    if (legacy) {
      if (workoutType === 'progressive' || workoutType === 'fartlek') return undefined;
      parsed.push(session);
    } else if (structure) {
      const structured = { ...session, title: structure.title, purpose: structure.purpose,
        heartRateBpm: structure.heartRateBpm, phases: structure.phases };
      if ('rule' in workoutConsistency(structured, 150)) return undefined;
      parsed.push(structured);
    }
  }
  if (!Number.isFinite(parsed.reduce((sum, session) => sum + session.distanceKm, 0))) return undefined;
  parsed.sort((left, right) => left.date.localeCompare(right.date));
  return { status, weekStart, weekEnd, message, sessions: parsed };
}

export function loadWeeklyPlan(storage: StorageAccess): { saved?: SavedPlan; warning?: string } {
  try {
    const store = storage();
    const current = store.getItem(weeklyPlanStorageKey);
    const raw = current ?? store.getItem(legacyStorageKey);
    if (raw === null) return {};
    const record: unknown = JSON.parse(raw);
    if (isRecord(record) && typeof record.goalFingerprint === 'string' && /^[a-f0-9]{64}$/.test(record.goalFingerprint)) {
      const plan = parsePlanResponse(record.plan, current === null);
      if (plan?.status === 'generated') return { saved: { goalFingerprint: record.goalFingerprint, plan } };
    }
  } catch {
    // An unreadable cache does not prevent generating a new plan.
  }
  return { warning: 'The saved plan could not be restored. Generate a new plan when you are ready.' };
}

export function saveWeeklyPlan(storage: StorageAccess, saved: SavedPlan): boolean {
  try {
    storage().setItem(weeklyPlanStorageKey, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

export function getPlanAssociation(saved: SavedPlan, fingerprint: string, weekStart: string, goal: TrainingGoal) {
  if (saved.goalFingerprint !== fingerprint || saved.plan.sessions.length !== goal.runsPerWeek
    || saved.plan.sessions.some(({ date }) => date > goal.targetDate)) return 'different_goal';
  return saved.plan.weekStart === weekStart ? 'current' : 'outdated';
}

const requestErrors: Partial<Record<number, string>> = {
  400: 'The saved goal is invalid. Edit and save your goal, then try again.',
  409: 'Another plan is being generated. Wait for it to finish, then try again.',
  429: 'A service rate limit or AI quota was reached. Wait before trying again.',
  502: 'The service could not return a valid plan. Check that Garmin history loads and try again later.',
  503: 'Plan generation is unavailable. Check the server configuration for Garmin and the selected AI provider.',
  504: 'Plan generation timed out. Try again later.',
};

export async function requestWeeklyPlan(
  goal: TrainingGoal, weekStart: string, signal: AbortSignal, request = fetch,
): Promise<{ plan: PlanResponse } | { error: string }> {
  let response: Response;
  try {
    response = await request('/api/training-plan/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(goalPayload(goal)), signal,
    });
  } catch {
    return { error: 'Could not reach RunLab. Check your connection and try again.' };
  }
  if (!response.ok) {
    if (response.status === 503 || response.status === 502) {
      const body: unknown = await response.json().catch(() => null);
      const code = isRecord(body) ? body.code : undefined;
      if (response.status === 503 && (code === 'AI_TEMPORARILY_UNAVAILABLE' || code === 'GEMINI_TEMPORARILY_UNAVAILABLE')) {
        return { error: 'The AI provider is temporarily unavailable. Please try again later.' };
      }
      if (response.status === 502 && code === 'AI_AUTHENTICATION_FAILED') {
        return { error: 'The AI provider rejected the server credentials or permissions. Check the provider configuration.' };
      }
      if (response.status === 502 && code === 'AI_UNSUPPORTED_MODEL') {
        return { error: 'The configured AI model is unavailable or unsupported. Check the server model setting.' };
      }
    }
    return { error: requestErrors[response.status] ?? 'Could not generate a plan. Try again later.' };
  }

  const plan = parsePlanResponse(await response.json().catch(() => null));
  if (!plan || plan.weekStart !== weekStart
    || (plan.status === 'generated' && (plan.sessions.length !== goal.runsPerWeek
      || plan.sessions.some(({ date }) => date > goal.targetDate)))) {
    return { error: 'RunLab received an invalid plan for this goal and week. Try again later.' };
  }
  return { plan };
}
