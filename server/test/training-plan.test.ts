import request from 'supertest';
import { expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { trainingPlanInstructions } from '../src/ai-provider.js';
import { getTrainingHistoryWeeks } from '../src/training-history.js';
import { shiftCalendarDate } from '../src/rome-calendar.js';
import { selectAiProvider } from '../src/ai-provider-config.js';
import { createGroqProvider, defaultGroqModel } from '../src/groq.js';
import { createGeminiProvider, defaultGeminiModel } from '../src/gemini.js';
import { createGarminClient } from '../src/garmin.js';
import { buildTrainingPlanContext, planSchema, validateGeneratedPlan } from '../src/training-plan.js';
import type { TrainingGoal } from '../src/training-goal.js';

const now = new Date('2026-11-23T12:00:00Z');
const goal: TrainingGoal = {
  targetDistanceKm: 10, targetPaceSecondsPerKm: 330, targetDate: '2027-01-10',
  runsPerWeek: 2, preferredDays: ['Monday', 'Thursday'],
};
const runs = ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-23'].map((date, index) => ({
  activityId: index + 1, startTimeGMT: `${date} 09:00:00`, activityType: { typeKey: 'running' },
  distance: 10_000, duration: 3_600, averageHR: index === 3 ? undefined : 150,
  hrTimeInZone_1: 0, activityName: 'Private name', gps: 'private fields',
}));
function mainPhase(distanceKm: number, durationSeconds: number | null) {
  return { kind: 'main', repetitions: 1,
    effort: { distanceKm, durationSeconds, paceSecondsPerKm: null, heartRateBpm: null }, recovery: null };
}

const generated = {
  status: 'generated', message: 'A conservative week.',
  sessions: ['2026-11-30', '2026-12-03'].map((date) => ({
    date, workoutType: 'easy', intensity: 'easy', distanceKm: 5, estimatedDurationSeconds: 1_800,
    targetPaceSecondsPerKm: null, description: 'Run comfortably.', rationale: 'Uses recent weekly distance.',
    title: 'Comfortable aerobic run', purpose: 'Aerobic endurance', heartRateBpm: null, phases: [mainPhase(5, 1_800)],
  })),
};

function mockedGarmin(page = Response.json(runs)) {
  const exp = Math.floor(now.getTime() / 1_000) + 90 * 86_400;
  const token = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const fetchGarmin = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(`header.${token}.signature`)).mockResolvedValueOnce(page);
  return { garmin: createGarminClient('test-only-key', fetchGarmin), fetchGarmin };
}

async function withDate<T>(runTest: () => Promise<T>) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  try { return await runTest(); } finally { vi.useRealTimers(); }
}

test.each([
  ['2026-10-25T23:00:00Z', '2026-11-02', '2026-11-08'],
  ['2026-12-27T23:00:00Z', '2027-01-04', '2027-01-10'],
])('calculates the next Rome week from %s', async (instant, weekStart, weekEnd) => {
  const context = await buildTrainingPlanContext({ getActivitiesInDateRange: async () => [] }, goal, new Date(instant));
  expect(context.nextWeek).toEqual({ weekStart, weekEnd });
  expect(context.history.weeks).toHaveLength(6);
  expect(context.limits.maxWeeklyDistanceKm).toBe(0);
});

test('requests one combined history window and sends only aggregate context with structured output', async () => withDate(async () => {
  const { garmin, fetchGarmin } = mockedGarmin();
  const ai = vi.fn().mockResolvedValue({ text: JSON.stringify(generated) });
  const app = createApp(garmin, createGeminiProvider('test-gemini-key', undefined, ai));
  await request(app).post('/api/training-plan/generate').send({ ...goal, history: 'untrusted' }).expect(200, {
    ...generated, weekStart: '2026-11-30', weekEnd: '2026-12-06',
  });
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
  expect(Object.fromEntries(new URL(String(fetchGarmin.mock.calls[1][0])).searchParams)).toEqual({
    start: '0', limit: '99', startDate: '2026-10-11', endDate: '2026-11-24',
  });
  expect(ai).toHaveBeenCalledTimes(1);
  const [input] = ai.mock.calls[0];
  expect(input.model).toBe(defaultGeminiModel);
  expect(input.config).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: planSchema,
    httpOptions: { timeout: expect.any(Number), retryOptions: { attempts: 1 } } });
  expect(input.config.httpOptions.timeout).toBeLessThanOrEqual(30_000);
  expect(input.contents).not.toMatch(/Private name|untrusted|activityId|private fields|test-gemini-key/);
  const context = JSON.parse(input.contents);
  expect(context.history.weeks).toHaveLength(6);
  expect(context.currentWeek).toMatchObject({ throughDate: '2026-11-23', activityCount: 1,
    averageHeartRateBpm: null, heartRateZones: { seconds: { z1: 0, z2: null } } });
  expect(context.daysUntilTarget).toBe(48);
}));

test('rejects malformed output and accepts a structured abstention', async () => withDate(async () => {
  const { garmin } = mockedGarmin();
  const context = await buildTrainingPlanContext(garmin, goal, now);
  const abstention = { status: 'cannot_generate', message: 'Insufficient history.', sessions: [] };
  expect(validateGeneratedPlan(JSON.stringify(abstention), context)).toEqual(abstention);
  expect(validateGeneratedPlan('{bad json', context)).toBeUndefined();
  const [first, second] = generated.sessions;
  for (const sessions of [
    [first],
    [first, { ...second, date: first.date }],
    [first, { ...second, date: '2026-12-07' }],
    [first, { ...second, date: '2026-11-31' }],
    [first, { ...second, distanceKm: 0 }],
    [first, { ...second, distanceKm: 7 }],
    [first, { ...second, estimatedDurationSeconds: -1 }],
    [first, { ...second, targetPaceSecondsPerKm: 1 }],
    [first, { ...second, workoutType: 'invented' }],
    [{ ...first, intensity: 'hard' }, { ...second, workoutType: 'tempo' }],
  ]) {
    expect(validateGeneratedPlan(JSON.stringify({ ...generated, sessions }), context)).toBeUndefined();
  }
}));

test('rejects invalid goals and missing configuration before Garmin or Gemini calls', async () => withDate(async () => {
  const { garmin, fetchGarmin } = mockedGarmin();
  const ai = vi.fn();
  const app = createApp(garmin, { name: 'gemini', generate: ai });
  await request(app).post('/api/training-plan/generate').send({ ...goal, runsPerWeek: '2' }).expect(400);
  await request(app).post('/api/training-plan/generate').set('Content-Type', 'application/json').send('{').expect(400);
  await request(createApp(garmin)).post('/api/training-plan/generate').send(goal).expect(503);
  expect(fetchGarmin).not.toHaveBeenCalled();
  expect(ai).not.toHaveBeenCalled();
}));

test.each([
  [429, 429, 'Gemini quota or rate limit reached. Try again later.'],
  [504, 504, 'Gemini did not respond in time. Try again later.'],
  [500, 502, 'Gemini could not generate a training plan.'],
])('sanitizes Gemini %d failures', async (upstreamStatus, status, error) => withDate(async () => {
  const { garmin } = mockedGarmin();
  const ai = vi.fn().mockRejectedValue({ status: upstreamStatus, message: 'private upstream content' });
  await request(createApp(garmin, createGeminiProvider('test-key', undefined, ai)))
    .post('/api/training-plan/generate').send(goal).expect(status, { error });
  expect(ai).toHaveBeenCalledTimes(1);
}));

test('returns a timeout when Gemini hits the local deadline', async () => withDate(async () => {
  const { garmin } = mockedGarmin();
  const generate = createGeminiProvider('test-key', undefined, ({ config }) => new Promise((_resolve, reject) => {
    config?.abortSignal?.addEventListener('abort', () => reject(config.abortSignal?.reason), { once: true });
  }), 10);
  await request(createApp(garmin, generate)).post('/api/training-plan/generate').send(goal).expect(504);
}));

test('preserves Garmin errors and never calls Gemini on partial pagination', async () => withDate(async () => {
  const ai = vi.fn();
  const { garmin } = mockedGarmin(new Response('private', { status: 206 }));
  await request(createApp(garmin, { name: 'gemini', generate: ai })).post('/api/training-plan/generate').send(goal)
    .expect(502, { error: 'Could not load activities from Garmin.' });
  expect(ai).not.toHaveBeenCalled();
}));

test('rejects model output that does not pass validation', async () => withDate(async () => {
  const { garmin } = mockedGarmin();
  const ai = vi.fn().mockResolvedValue({ text: '{"status":"generated","message":"Invalid","sessions":[]}' });
  await request(createApp(garmin, createGeminiProvider('test-key', undefined, ai)))
    .post('/api/training-plan/generate').send(goal)
    .expect(502, { error: 'Gemini returned a plan that did not pass validation.' });
  expect(ai).toHaveBeenCalledTimes(1);
}));

test('shares identical concurrent requests and rejects conflicting generation', async () => withDate(async () => {
  const { garmin, fetchGarmin } = mockedGarmin();
  let complete!: (result: string) => void;
  const ai = vi.fn(() => new Promise<{ text: string }>((resolve) => {
    complete = (text) => resolve({ text });
  })).mockRejectedValueOnce({ status: 503 });
  const app = createApp(garmin, createGeminiProvider('test-key', undefined, ai));
  const first = request(app).post('/api/training-plan/generate').send(goal).then((response) => response);
  await vi.waitFor(() => expect(ai).toHaveBeenCalledTimes(1));
  const duplicate = request(app).post('/api/training-plan/generate')
    .send({ ...goal, preferredDays: [...goal.preferredDays].reverse() }).then((response) => response);
  await request(app).post('/api/training-plan/generate').send({ ...goal, targetDistanceKm: 15 }).expect(409);
  await vi.waitFor(() => expect(ai).toHaveBeenCalledTimes(2));
  complete(JSON.stringify(generated));
  expect((await first).status).toBe(200);
  expect((await duplicate).status).toBe(200);
  expect(ai).toHaveBeenCalledTimes(2);
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
}));

test('logs exact structured-output and safety rules without logging the model text', async () => withDate(async () => {
  const { garmin } = mockedGarmin();
  const context = await buildTrainingPlanContext(garmin, goal, now);
  const diagnostics = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv('NODE_ENV', 'development');
  try {
    expect(validateGeneratedPlan('private invalid AI output', context)).toBeUndefined();
    expect(diagnostics).toHaveBeenLastCalledWith('[RunLab training plan]', {
      stage: 'structured_output', rule: 'invalid_json',
    });
    const sessions = generated.sessions.map((session) => ({ ...session, distanceKm: 7, estimatedDurationSeconds: 2_520, phases: [mainPhase(7, 2_520)] }));
    expect(validateGeneratedPlan(JSON.stringify({ ...generated, message: 'Private content', sessions }), context))
      .toBeUndefined();
    expect(diagnostics).toHaveBeenLastCalledWith('[RunLab training plan]', {
      stage: 'safety_validation', rule: 'weekly_distance_cap', totalDistanceKm: 14,
      maxWeeklyDistanceKm: context.limits.maxWeeklyDistanceKm,
    });
    const short = { ...generated.sessions[0], estimatedDurationSeconds: 100 };
    expect(validateGeneratedPlan(JSON.stringify({ ...generated, sessions: [short, generated.sessions[1]] }), context))
      .toBeUndefined();
    expect(diagnostics).toHaveBeenLastCalledWith('[RunLab training plan]', expect.objectContaining({
      stage: 'safety_validation', rule: 'implied_pace_bounds', sessionIndex: 1, impliedPace: 20,
    }));
    expect(JSON.stringify(diagnostics.mock.calls)).not.toMatch(/private/i);

    vi.stubEnv('NODE_ENV', 'production');
    diagnostics.mockClear();
    expect(validateGeneratedPlan('{bad json', context)).toBeUndefined();
    expect(diagnostics).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    diagnostics.mockRestore();
  }
}));

test('distinguishes Gemini API errors from history and empty model responses in development', async () => withDate(async () => {
  const diagnostics = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv('NODE_ENV', 'development');
  try {
    const failed = vi.fn().mockRejectedValue({ status: 400, message: 'private SDK error' });
    await request(createApp(mockedGarmin().garmin, createGeminiProvider('test-key', undefined, failed)))
      .post('/api/training-plan/generate').send(goal).expect(502, { error: 'Gemini could not generate a training plan.' });
    expect(diagnostics).toHaveBeenLastCalledWith('[RunLab training plan]', {
      provider: 'gemini', stage: 'provider_request', rule: 'request_failed', upstreamStatus: 400,
    });

    const empty = vi.fn().mockResolvedValue({ candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await request(createApp(mockedGarmin().garmin, createGeminiProvider('test-key', undefined, empty)))
      .post('/api/training-plan/generate').send(goal)
      .expect(502, { error: 'Gemini returned a plan that did not pass validation.' });
    expect(diagnostics).toHaveBeenCalledWith('[RunLab training plan]', {
      provider: 'gemini', stage: 'structured_output', rule: 'model_reached_output_token_limit', maxOutputTokens: 6_144,
    });
    expect(diagnostics).toHaveBeenLastCalledWith('[RunLab training plan]', {
      provider: 'gemini', stage: 'structured_output', rule: 'empty_model_text',
    });

    const brokenHistory = mockedGarmin(new Response('private Garmin response', { status: 500 })).garmin;
    await request(createApp(brokenHistory, { name: 'gemini', generate: vi.fn() })).post('/api/training-plan/generate').send(goal)
      .expect(502, { error: 'Could not load activities from Garmin.' });
    expect(diagnostics).toHaveBeenLastCalledWith('[RunLab training plan]', {
      provider: 'gemini', stage: 'history_context', rule: 'garmin_history_or_aggregation_failed',
    });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toMatch(/private|test-key/i);
  } finally {
    vi.unstubAllEnvs();
    diagnostics.mockRestore();
  }
}));

test('retries 503 and returns a successful validated plan from the same Garmin context', async () => withDate(async () => {
  const { garmin, fetchGarmin } = mockedGarmin();
  const ai = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce({ text: JSON.stringify(generated) });
  const app = createApp(garmin, createGeminiProvider('test-key', undefined, ai));
  await request(app).post('/api/training-plan/generate').send(goal).expect(200);
  expect(ai).toHaveBeenCalledTimes(2);
  expect(ai.mock.calls[1][0].config.abortSignal).toBe(ai.mock.calls[0][0].config.abortSignal);
  expect(ai.mock.calls[1][0].config.httpOptions.timeout).toBeLessThan(ai.mock.calls[0][0].config.httpOptions.timeout);
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
}));

test('returns coded 503 after three failed calls, without retrying a 502', async () => withDate(async () => {
  const ai = vi.fn().mockRejectedValue({ status: 503, message: 'private' });
  await request(createApp(mockedGarmin().garmin, createGeminiProvider('test-key', undefined, ai)))
    .post('/api/training-plan/generate').send(goal).expect(503, {
      code: 'GEMINI_TEMPORARILY_UNAVAILABLE', error: 'Gemini is temporarily unavailable. Please try again later.',
    });
  expect(ai).toHaveBeenCalledTimes(3);
  ai.mockReset().mockRejectedValue({ status: 502 });
  await request(createApp(mockedGarmin().garmin, createGeminiProvider('test-key', undefined, ai)))
    .post('/api/training-plan/generate').send(goal).expect(502);
  expect(ai).toHaveBeenCalledTimes(1);
}));

test.each([400, 401, 403, 404])('does not retry Gemini HTTP %d', async (status) => withDate(async () => {
  const ai = vi.fn().mockRejectedValue({ status });
  await request(createApp(mockedGarmin().garmin, createGeminiProvider('test-key', undefined, ai)))
    .post('/api/training-plan/generate').send(goal).expect(502);
  expect(ai).toHaveBeenCalledTimes(1);
}));

test('reads Retry-After from the SDK transport and honors it only when it fits the budget', async () => withDate(async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: 503 } }, {
    status: 503, headers: { 'Retry-After': '1' },
  })).mockResolvedValueOnce(Response.json({
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(generated) }] } }],
  }));
  vi.stubGlobal('fetch', transport);
  try {
    const started = performance.now();
    await request(createApp(mockedGarmin().garmin, createGeminiProvider('test-key')))
      .post('/api/training-plan/generate').send(goal).expect(200);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(performance.now() - started).toBeGreaterThanOrEqual(990);

    transport.mockReset().mockResolvedValueOnce(Response.json({ error: { code: 503 } }, {
      status: 503, headers: { 'Retry-After': new Date(now.getTime() + 60_000).toUTCString() },
    }));
    await request(createApp(mockedGarmin().garmin, createGeminiProvider('test-key', undefined, undefined, 500)))
      .post('/api/training-plan/generate').send(goal).expect(503);
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
}));

test('uses the remaining budget rather than giving a retry its own deadline', async () => withDate(async () => {
  const ai = vi.fn<NonNullable<Parameters<typeof createGeminiProvider>[2]>>()
    .mockRejectedValueOnce({ status: 503 })
    .mockImplementationOnce(({ config }) => new Promise((_resolve, reject) => {
      config?.abortSignal?.addEventListener('abort', () => reject(config.abortSignal?.reason), { once: true });
    }));
  await request(createApp(mockedGarmin().garmin, createGeminiProvider('test-key', undefined, ai, 500)))
    .post('/api/training-plan/generate').send(goal).expect(504);
  expect(ai).toHaveBeenCalledTimes(2);
  expect(ai.mock.calls[1][0].config?.httpOptions?.timeout).toBeLessThanOrEqual(250);
}));

test('selects only the configured provider and defaults to Groq without falling back', () => {
  expect(selectAiProvider({ GROQ_API_KEY: 'test-key' })?.name).toBe('groq');
  expect(selectAiProvider({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'test-key' })?.name).toBe('groq');
  expect(selectAiProvider({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key' })?.name).toBe('gemini');
  expect(selectAiProvider({ AI_PROVIDER: 'groq', GEMINI_API_KEY: 'test-key' })).toBeUndefined();
  expect(selectAiProvider({ AI_PROVIDER: 'gemini', GROQ_API_KEY: 'test-key' })).toBeUndefined();
  expect(selectAiProvider({ AI_PROVIDER: 'unknown', GROQ_API_KEY: 'test-key' })).toBeUndefined();
  expect(selectAiProvider({ GROQ_API_KEY: 'your_groq_api_key_here' })).toBeUndefined();
});

function groqCompletion(value: unknown) {
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
}

test('Groq sends strict schema and the shared prompt and returns the same endpoint response', async () => withDate(async () => {
  const { garmin, fetchGarmin } = mockedGarmin();
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(groqCompletion(generated));
  await request(createApp(garmin, createGroqProvider('test-groq-key', undefined, transport)))
    .post('/api/training-plan/generate').send({ ...goal, history: 'untrusted' }).expect(200, {
      ...generated, weekStart: '2026-11-30', weekEnd: '2026-12-06',
    });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
  const [url, options] = transport.mock.calls[0];
  expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
  expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-groq-key' });
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  const payload = JSON.parse(String(options?.body));
  expect(payload.model).toBe(defaultGroqModel);
  expect(payload.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
  const schema = payload.response_format.json_schema.schema;
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(Object.keys(schema.properties));
  expect(schema.properties.sessions.items.additionalProperties).toBe(false);
  expect(schema.properties.sessions.items.required).toEqual(Object.keys(schema.properties.sessions.items.properties));
  expect(schema.properties.sessions.items.properties.targetPaceSecondsPerKm.type).toEqual(['integer', 'null']);
  expect(payload.messages[0].content).toContain('cautious running training planning assistant');
  expect(payload.messages[1].content).not.toMatch(/Private name|untrusted|activityId|private fields|test-groq-key/);
}));

test('Groq missing keys and models without strict output support never call the AI API', async () => withDate(async () => {
  const transport = vi.fn<typeof fetch>();
  const missing = mockedGarmin();
  await request(createApp(missing.garmin, createGroqProvider(undefined, undefined, transport)))
    .post('/api/training-plan/generate').send(goal).expect(503);
  expect(missing.fetchGarmin).not.toHaveBeenCalled();
  await request(createApp(mockedGarmin().garmin, createGroqProvider('test-key', 'unsupported', transport)))
    .post('/api/training-plan/generate').send(goal).expect(502, {
      code: 'AI_UNSUPPORTED_MODEL', error: 'The configured AI model is unavailable or does not support strict output.',
    });
  expect(transport).not.toHaveBeenCalled();
}));

test.each([
  [401, 502, 'AI_AUTHENTICATION_FAILED'],
  [403, 502, 'AI_AUTHENTICATION_FAILED'],
  [404, 502, 'AI_UNSUPPORTED_MODEL'],
  [429, 429, undefined],
  [500, 502, undefined],
  [502, 503, 'AI_TEMPORARILY_UNAVAILABLE'],
  [503, 503, 'AI_TEMPORARILY_UNAVAILABLE'],
  [504, 504, undefined],
])('maps Groq HTTP %d safely without retries or fallback', async (upstream, status, code) => withDate(async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: 'private upstream details' }, { status: upstream }));
  const response = await request(createApp(mockedGarmin().garmin, createGroqProvider('test-key', undefined, transport)))
    .post('/api/training-plan/generate').send(goal).expect(status);
  expect(response.body.code).toBe(code);
  expect(response.text).not.toContain('private');
  expect(transport).toHaveBeenCalledTimes(1);
}));

test('times out a pending Groq request', async () => withDate(async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation((_input, options) => new Promise((_resolve, reject) => {
    const signal = options?.signal;
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await request(createApp(mockedGarmin().garmin, createGroqProvider('test-key', undefined, transport, 10)))
    .post('/api/training-plan/generate').send(goal).expect(504);
  expect(transport).toHaveBeenCalledTimes(1);
}));

test('Groq rejects malformed output and runs the shared safety rules on schema-shaped plans', async () => withDate(async () => {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv('NODE_ENV', 'development');
  try {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ choices: [] }))
      .mockResolvedValueOnce(groqCompletion({
        ...generated, sessions: generated.sessions.map((session) => ({ ...session, distanceKm: 7, estimatedDurationSeconds: 2_520, phases: [mainPhase(7, 2_520)] })),
      }));
    const provider = createGroqProvider('test-key', 'openai/gpt-oss-20b', transport);
    for (const example of [mockedGarmin(), mockedGarmin()]) {
      await request(createApp(example.garmin, provider)).post('/api/training-plan/generate').send(goal)
        .expect(502, { error: 'The AI provider returned a plan that did not pass validation.' });
    }
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).model).toBe('openai/gpt-oss-20b');
    expect(log).toHaveBeenCalledWith('[RunLab training plan]', {
      provider: 'groq', stage: 'structured_output', rule: 'empty_model_text',
    });
    expect(log).toHaveBeenLastCalledWith('[RunLab training plan]', expect.objectContaining({
      provider: 'groq', stage: 'safety_validation', rule: 'weekly_distance_cap', totalDistanceKm: 14,
    }));
  } finally {
    vi.unstubAllEnvs();
    log.mockRestore();
  }
}));

function historyFixture(distances: number[]) {
  return getTrainingHistoryWeeks(now).flatMap(({ weekStart }, index) => {
    const distance = distances[index];
    return distance === 0 ? [] : [0, 3].map((offset) => ({
      activityId: index * 10 + offset + 1,
      activityType: { typeKey: 'running' },
      startTimeGMT: `${shiftCalendarDate(weekStart, offset)} 09:00:00`,
      distance: distance * 500,
      duration: distance * 180,
    }));
  });
}

test.each([
  { label: 'stable', weeks: [20, 20, 20, 20, 20, 20], pattern: 'within_comparison_band', cap: 22, longest: 10, streak: 6 },
  { label: 'gradual progression', weeks: [0, 12, 15, 17, 19, 21], pattern: 'within_comparison_band', cap: 23.1, longest: 10.5, streak: 5 },
  { label: 'isolated return', weeks: [24, 0, 0, 0, 0, 18], pattern: 'resumed_after_zero_distance', cap: 6.6, longest: 9, streak: 1 },
  { label: 'unusually high latest week', weeks: [18, 18, 18, 20, 20, 40], pattern: 'spike', cap: 22, longest: 20, streak: 6 },
  { label: 'unusually low latest week', weeks: [18, 18, 18, 20, 20, 6], pattern: 'sharp_drop', cap: 6, longest: 10, streak: 6 },
])('builds recency context and caps for $label', ({ weeks, pattern, cap, longest, streak }) => withDate(async () => {
  const { garmin, fetchGarmin } = mockedGarmin(Response.json(historyFixture(weeks)));
  const context = await buildTrainingPlanContext(garmin, goal, now);
  const recent = context.recency;
  expect(recent.latestCompletedWeek).toMatchObject({ totalDistanceKm: weeks[5], activityCount: 2 });
  expect(recent.previousCompletedWeek.totalDistanceKm).toBe(weeks[4]);
  expect(recent.lastTwoCompletedWeeks).toEqual({
    recordedDistanceKm: weeks[4] + weeks[5], activityCount: weeks[4] ? 4 : 2,
    longestRecordedRunDistanceKm: longest, distanceCoverageComplete: true,
  });
  expect(recent.mileageProgression).toMatchObject({ pattern, distanceChangeKm: weeks[5] - weeks[4] });
  expect(recent.mileageProgression.distanceChangePercent).toBe(weeks[4] ? (weeks[5] - weeks[4]) / weeks[4] * 100 : null);
  expect(recent.consecutiveActiveCompletedWeeks).toBe(streak);
  expect(recent.sixWeekAverageRecordedDistanceKm).toBeCloseTo(weeks.reduce((sum, week) => sum + week, 0) / 6);
  expect(context.limits.maxWeeklyDistanceKm).toBeCloseTo(cap);
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
}));

test('keeps partial current-week distance out of the caps and reports sparse intensity data', async () => withDate(async () => {
  const history = historyFixture([0, 0, 0, 20, 20, 20]);
  const latest = history[history.length - 1];
  const partial = { ...latest, activityId: 999, startTimeGMT: '2026-11-23 08:00:00', distance: 1_000 };
  const { garmin } = mockedGarmin(Response.json([
    ...history.slice(0, -1), { ...latest, averageHR: 142, hrTimeInZone_1: 0, hrTimeInZone_2: 300, hrTimeInZone_3: 100 }, partial,
  ]));
  const context = await buildTrainingPlanContext(garmin, goal, now);
  expect(context.currentWeek).toMatchObject({
    isPartial: true, throughDate: '2026-11-23', totalDistanceKm: 1, activityCount: 1,
    intensityDistribution: { recordedSeconds: null },
  });
  expect(context.recency.daysSinceMostRecentRecordedRun).toBe(0);
  expect(context.recency.latestCompletedWeek).toMatchObject({
    intensityDistribution: { recordedSeconds: 400, shareOfRecordedSecondsByZone: { z1: 0, z2: 0.75, z3: 0.25, z4: null, z5: null } },
    averageHeartRateBpm: 142,
    coverage: { activitiesWithHeartRate: 1 },
    heartRateZones: { coverage: { activitiesWithZoneData: 1, activitiesWithCompleteZoneData: 0 } },
  });
  expect(context.recency.previousCompletedWeek.intensityDistribution.recordedSeconds).toBeNull();
  expect(context.limits.maxWeeklyDistanceKm).toBeCloseTo(22);
}));

test('tracks inactive completed weeks separately and does not use partial week volume as a fallback cap', async () => withDate(async () => {
  const activities = historyFixture([0, 18, 22, 16, 0, 0]);
  const partial = { ...activities[0], activityId: 999, startTimeGMT: '2026-11-23 09:00:00', distance: 4_000 };
  const context = await buildTrainingPlanContext(mockedGarmin(Response.json([...activities, partial])).garmin, goal, now);
  expect(context.currentWeek.totalDistanceKm).toBe(4);
  expect(context.recency).toMatchObject({ consecutiveActiveCompletedWeeks: 0, consecutiveInactiveCompletedWeeks: 2 });
  expect(context.limits).toMatchObject({ maxWeeklyDistanceKm: 0, maxSessionDistanceKm: 0 });
}));

test('safety rejects weekly spikes and unusually long sessions even with valid JSON', async () => withDate(async () => {
  const history = historyFixture([20, 20, 20, 20, 20, 40]);
  const context = await buildTrainingPlanContext(mockedGarmin(Response.json(history)).garmin, goal, now);
  expect(context.limits).toMatchObject({ maxWeeklyDistanceKm: 22, maxSessionDistanceKm: 11 });
  const session = (date: string, distanceKm: number) => ({ ...generated.sessions[0], date, distanceKm,
    estimatedDurationSeconds: null, phases: [mainPhase(distanceKm, null)] });
  expect(validateGeneratedPlan(JSON.stringify({ ...generated, sessions: [
    session('2026-11-30', 12), session('2026-12-03', 9),
  ] }), context)).toBeUndefined();
  expect(validateGeneratedPlan(JSON.stringify({ ...generated, sessions: [
    session('2026-11-30', 11), session('2026-12-03', 11),
  ] }), context)?.status).toBe('generated');
  const progression = await buildTrainingPlanContext(mockedGarmin(Response.json(historyFixture([0, 8, 11, 14, 20, 21]))).garmin, goal, now);
  expect(validateGeneratedPlan(JSON.stringify({ ...generated, sessions: [
    session('2026-11-30', 11), session('2026-12-03', 11.6),
  ] }), progression)).toBeUndefined();
}));

test('does not use incomplete recorded distance or unclassified runs as reliable evidence', async () => withDate(async () => {
  const history = historyFixture([0, 0, 0, 20, 20, 20]);
  const latest = history[history.length - 1];
  const { garmin } = mockedGarmin(Response.json([
    ...history.slice(0, -1), { ...latest, distance: undefined, activityType: {} },
  ]));
  const context = await buildTrainingPlanContext(garmin, goal, now);
  expect(context.recency).toMatchObject({
    mileageProgression: { distanceChangeKm: null, distanceChangePercent: null, pattern: 'unknown' },
    consecutiveActiveCompletedWeeks: null,
  });
  expect(context.limits.maxWeeklyDistanceKm).toBe(0);
}));

test('the shared prompt prioritizes recency and requests specific evidence-grounded workouts', () => {
  expect(trainingPlanInstructions).toMatch(/latest completed week as the primary reference/i);
  expect(trainingPlanInstructions).toMatch(/check it against the preceding week/i);
  expect(trainingPlanInstructions).toMatch(/six-week arithmetic mean is secondary/i);
  expect(trainingPlanInstructions).toMatch(/never treat the current incomplete week/i);
  expect(trainingPlanInstructions).toMatch(/mileage spikes or drops, possible races, inactivity, and return-to-running/i);
  expect(trainingPlanInstructions).toMatch(/prefer easy aerobic long runs/i);
  expect(trainingPlanInstructions).toMatch(/target distance, target pace and daysUntilTarget/i);
  expect(trainingPlanInstructions).toMatch(/specific, actionable workout descriptions/i);
  expect(trainingPlanInstructions).toMatch(/explain proposed total distance/i);
  expect(trainingPlanInstructions).toMatch(/explain each workout's purpose/i);
  expect(trainingPlanInstructions).toMatch(/communicate uncertainty/i);
});

test('coaching context uses bounded, de-identified Garmin run summaries and paired observations', async () => withDate(async () => {
  const page = runs.map((run, index) => ({
    ...run,
    averageHR: index === 3 ? undefined : 145 + index,
    maxHR: index === 2 ? 172 : undefined,
    averageRunningCadenceInStepsPerMinute: index === 2 ? 170 : undefined,
    hrTimeInZone_2: index === 2 ? 1_200 : undefined,
  }));
  const { garmin, fetchGarmin } = mockedGarmin(Response.json(page));
  const context = await buildTrainingPlanContext(garmin, goal, now);
  expect(context.athlete.recentRuns).toEqual([
    { daysAgo: 0, distanceKm: 10, durationSeconds: 3_600, averagePaceSecondsPerKm: 360,
      averageHeartRateBpm: null, maxHeartRateBpm: null, averageCadenceStepsPerMinute: null,
      recordedZoneSeconds: { z1: 0, z2: null, z3: null, z4: null, z5: null } },
    { daysAgo: 6, distanceKm: 10, durationSeconds: 3_600, averagePaceSecondsPerKm: 360,
      averageHeartRateBpm: 147, maxHeartRateBpm: 172, averageCadenceStepsPerMinute: 170,
      recordedZoneSeconds: { z1: 0, z2: 1_200, z3: null, z4: null, z5: null } },
    { daysAgo: 13, distanceKm: 10, durationSeconds: 3_600, averagePaceSecondsPerKm: 360,
      averageHeartRateBpm: 146, maxHeartRateBpm: null, averageCadenceStepsPerMinute: null,
      recordedZoneSeconds: { z1: 0, z2: null, z3: null, z4: null, z5: null } },
  ]);
  expect(context.athlete.observedHeartRateBpm).toEqual({ min: 146, max: 172 });
  expect(context.athlete.longestRecentRuns).toHaveLength(2);
  expect(JSON.stringify(context.athlete)).not.toMatch(/Private name|activityId|private fields|startTime/);
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
}));

test('validates repeat phase arithmetic, duration, target pace and observed HR', async () => withDate(async () => {
  const { garmin } = mockedGarmin(Response.json(runs.map((run) => ({ ...run, averageHR: 146, maxHR: 172 }))));
  const context = await buildTrainingPlanContext(garmin, goal, now);
  const threshold = {
    ...generated.sessions[0], workoutType: 'fartlek', intensity: 'moderate', distanceKm: 5,
    estimatedDurationSeconds: 1_780, heartRateBpm: { min: 146, max: 155 },
    phases: [
      { ...mainPhase(2, 760), kind: 'warm_up' },
      { kind: 'repeats', repetitions: 4,
        effort: { distanceKm: null, durationSeconds: 80, paceSecondsPerKm: { min: 320, max: 320 }, heartRateBpm: null },
        recovery: { distanceKm: null, durationSeconds: 100, paceSecondsPerKm: { min: 400, max: 400 }, heartRateBpm: null } },
      { ...mainPhase(1, 300), kind: 'cool_down' },
    ],
  };
  const validate = (session: unknown, active = context) => validateGeneratedPlan(
    JSON.stringify({ ...generated, sessions: [session, generated.sessions[1]] }), active,
  );
  expect(validate(threshold)?.status).toBe('generated');
  expect(validate({ ...threshold, distanceKm: 4.6 })).toBeUndefined();
  expect(validate({ ...threshold, estimatedDurationSeconds: 1_680 })).toBeUndefined();
  expect(validate({ ...threshold, targetPaceSecondsPerKm: 300 })).toBeUndefined();
  expect(validate({ ...threshold, heartRateBpm: { min: 140, max: 155 } })).toBeUndefined();
  expect(validate(threshold, { ...context, athlete: { ...context.athlete, observedHeartRateBpm: null } })).toBeUndefined();
  expect(validate({ ...threshold, workoutType: 'easy' })).toBeUndefined();
  expect(validate({ ...threshold, phases: [threshold.phases[0], { ...threshold.phases[1], recovery: null }] })).toBeUndefined();
  expect(validate({ ...threshold, phases: [threshold.phases[2], threshold.phases[1], threshold.phases[0]] })).toBeUndefined();
}));

test('uses the upper distance implied by timed phases against the weekly maximum', async () => withDate(async () => {
  const context = await buildTrainingPlanContext(mockedGarmin().garmin, goal, now);
  const sessions = generated.sessions.map((session) => ({
    ...session, distanceKm: 5, estimatedDurationSeconds: 1_800, phases: [{
      kind: 'main', repetitions: 1, recovery: null,
      effort: { distanceKm: null, durationSeconds: 1_800, paceSecondsPerKm: { min: 300, max: 360 }, heartRateBpm: null },
    }],
  }));
  expect(validateGeneratedPlan(JSON.stringify({ ...generated, sessions }), context)).toBeUndefined();
}));
