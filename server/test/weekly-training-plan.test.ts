import { expect, test, vi } from 'vitest';
import {
  fingerprintGoal, getPlanAssociation, loadWeeklyPlan, nextPlanWeek, parsePlanResponse, requestWeeklyPlan,
  saveWeeklyPlan, weeklyPlanStorageKey, type SavedPlan,
} from '../../client/src/weekly-training-plan.js';
import type { TrainingGoal } from '../src/training-goal.js';

const goal: TrainingGoal = {
  targetDistanceKm: 10, targetPaceSecondsPerKm: 330, targetDate: '2027-02-01',
  runsPerWeek: 2, preferredDays: ['Monday', 'Thursday'],
};

const response = {
  status: 'generated', weekStart: '2026-12-28', weekEnd: '2027-01-03', message: 'Keep the week easy.',
  sessions: ['2026-12-31', '2026-12-28'].map((date) => ({
    date, workoutType: 'easy', intensity: 'easy', distanceKm: 4,
    estimatedDurationSeconds: null, targetPaceSecondsPerKm: null, description: 'Run easy.', rationale: 'Build consistency.',
    title: 'Aerobic run', purpose: 'Aerobic endurance', heartRateBpm: null,
    phases: [{ kind: 'main', repetitions: 1, recovery: null, effort: { distanceKm: 4, durationSeconds: null, paceSecondsPerKm: null, heartRateBpm: null } }],
  })),
};
const abstention = { ...response, status: 'cannot_generate', sessions: [], message: 'Insufficient data.' };

function memoryStorage(initial: string | null = null) {
  let raw = initial;
  return () => ({
    getItem: (key: string) => key === weeklyPlanStorageKey ? raw : null,
    setItem: (key: string, value: string) => { expect(key).toBe(weeklyPlanStorageKey); raw = value; },
  });
}

async function savedPlan(): Promise<SavedPlan> {
  const plan = parsePlanResponse(response);
  if (plan?.status !== 'generated') throw new Error('Invalid fixture');
  return { plan, goalFingerprint: await fingerprintGoal(goal) };
}

test('parses both response types, orders sessions and preserves missing optional values', () => {
  const plan = parsePlanResponse(response);
  expect(plan?.sessions.map(({ date }) => date)).toEqual(['2026-12-28', '2026-12-31']);
  expect(plan?.sessions[0]).toMatchObject({ estimatedDurationSeconds: null, targetPaceSecondsPerKm: null });
  expect(parsePlanResponse(abstention)).toEqual(abstention);
  expect(parsePlanResponse({ ...response, weekEnd: '2027-01-04' })).toBeUndefined();
  expect(parsePlanResponse({ ...response, sessions: [response.sessions[0], response.sessions[0]] })).toBeUndefined();
  expect(parsePlanResponse({ ...response, sessions: [response.sessions[0], { ...response.sessions[1], distanceKm: Infinity }] }))
    .toBeUndefined();
});

test('posts only the saved goal, with an abort signal, and validates the response association', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(response))
    .mockResolvedValueOnce(Response.json(abstention)).mockResolvedValueOnce(Response.json(response));
  const signal = new AbortController().signal;
  await expect(requestWeeklyPlan({ ...goal, history: 'ignored' } as TrainingGoal, response.weekStart, signal, request))
    .resolves.toMatchObject({ plan: { status: 'generated' } });
  expect(request).toHaveBeenCalledWith('/api/training-plan/generate', expect.objectContaining({
    method: 'POST', body: JSON.stringify(goal), signal,
  }));
  await expect(requestWeeklyPlan(goal, response.weekStart, signal, request)).resolves.toEqual({ plan: abstention });
  await expect(requestWeeklyPlan(goal, '2027-01-04', signal, request)).resolves.toHaveProperty('error');
});

test.each([400, 409, 429, 502, 503, 504])('sanitizes HTTP %d errors', async (status) => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'private upstream contents' }, { status }));
  const result = await requestWeeklyPlan(goal, response.weekStart, new AbortController().signal, request);
  expect(result).toHaveProperty('error');
  expect(JSON.stringify(result)).not.toContain('private upstream contents');
});

test('handles network failures and malformed success bodies', async () => {
  const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('private network detail'))
    .mockResolvedValueOnce(new Response('not JSON'));
  const signal = new AbortController().signal;
  await expect(requestWeeklyPlan(goal, response.weekStart, signal, request)).resolves.toMatchObject({
    error: 'Could not reach RunLab. Check your connection and try again.',
  });
  await expect(requestWeeklyPlan(goal, response.weekStart, signal, request)).resolves.toHaveProperty('error');
});

test('restores saved plans without requesting generation and handles corrupted or blocked storage', async () => {
  const storage = memoryStorage();
  const saved = await savedPlan();
  expect(saveWeeklyPlan(storage, saved)).toBe(true);
  expect(loadWeeklyPlan(storage)).toEqual({ saved });
  expect(storage().getItem(weeklyPlanStorageKey)).not.toContain('preferredDays');
  for (const value of ['{', '{}', JSON.stringify({ ...saved, plan: abstention })]) {
    expect(loadWeeklyPlan(memoryStorage(value))).toHaveProperty('warning');
  }
  const blocked = () => { throw new Error('Storage unavailable'); };
  expect(saveWeeklyPlan(blocked, saved)).toBe(false);
  expect(loadWeeklyPlan(blocked)).toHaveProperty('warning');
});

test('uses stable goal identity and marks the plan outdated at Rome week rollover', async () => {
  const saved = await savedPlan();
  const reordered = await fingerprintGoal({ ...goal, preferredDays: ['Thursday', 'Monday'] });
  const changed = await fingerprintGoal({ ...goal, targetDistanceKm: 12 });
  const before = nextPlanWeek(new Date('2026-12-27T22:59:59Z'));
  const after = nextPlanWeek(new Date('2026-12-27T23:00:00Z'));
  expect(before).toEqual({ weekStart: '2026-12-28', weekEnd: '2027-01-03' });
  expect(after).toEqual({ weekStart: '2027-01-04', weekEnd: '2027-01-10' });
  expect(getPlanAssociation(saved, reordered, before.weekStart, goal)).toBe('current');
  expect(getPlanAssociation(saved, changed, before.weekStart, goal)).toBe('different_goal');
  expect(getPlanAssociation(saved, reordered, after.weekStart, goal)).toBe('outdated');
});

test('shows the fixed AI unavailable message only for its distinct 503 code', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    code: 'GEMINI_TEMPORARILY_UNAVAILABLE', error: 'private upstream message',
  }, { status: 503 })).mockResolvedValueOnce(Response.json({ error: 'Missing configuration' }, { status: 503 }));
  const signal = new AbortController().signal;
  await expect(requestWeeklyPlan(goal, response.weekStart, signal, request)).resolves.toEqual({
    error: 'The AI provider is temporarily unavailable. Please try again later.',
  });
  await expect(requestWeeklyPlan(goal, response.weekStart, signal, request)).resolves.toEqual({
    error: 'Plan generation is unavailable. Check the server configuration for Garmin and the selected AI provider.',
  });
});

test('uses provider-neutral messages for Groq errors and ignores raw error text', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    code: 'AI_TEMPORARILY_UNAVAILABLE', error: 'private upstream detail',
  }, { status: 503 })).mockResolvedValueOnce(Response.json({
    code: 'AI_UNSUPPORTED_MODEL', error: 'private model detail',
  }, { status: 502 }));
  const signal = new AbortController().signal;
  await expect(requestWeeklyPlan(goal, response.weekStart, signal, request)).resolves.toEqual({
    error: 'The AI provider is temporarily unavailable. Please try again later.',
  });
  await expect(requestWeeklyPlan(goal, response.weekStart, signal, request)).resolves.toEqual({
    error: 'The configured AI model is unavailable or unsupported. Check the server model setting.',
  });
});

test('restores legacy v1 without fabricating phases and writes replacement to v2', async () => {
  const entries = new Map<string, string>();
  const goalFingerprint = await fingerprintGoal(goal);
  const legacy = { ...response, sessions: response.sessions.map(({ title: _title, purpose: _purpose,
    heartRateBpm: _heartRate, phases: _phases, ...session }) => session) };
  entries.set('runlab.weekly-training-plan.v1', JSON.stringify({ plan: legacy, goalFingerprint }));
  const storage = () => ({
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  });
  expect(loadWeeklyPlan(storage).saved?.plan.sessions[0]).not.toHaveProperty('phases');
  expect(parsePlanResponse(legacy)).toBeUndefined();
  const structured = await savedPlan();
  expect(saveWeeklyPlan(storage, structured)).toBe(true);
  expect(loadWeeklyPlan(storage)).toEqual({ saved: structured });
});
