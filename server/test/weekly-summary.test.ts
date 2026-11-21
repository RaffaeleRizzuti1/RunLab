import request from 'supertest';
import { expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createGarminClient } from '../src/garmin.js';
import { getRomeWeek, summarizeWeek } from '../src/weekly-summary.js';

const week = { weekStart: '2026-10-19', weekEnd: '2026-10-25' };
const emptySummary = {
  ...week,
  totalDistanceKm: 0,
  totalDurationMinutes: 0,
  activityCount: 0,
  averagePaceSecondsPerKm: null,
};

test('uses Monday through Sunday in Rome, even when UTC is still on Sunday', () => {
  expect(getRomeWeek(new Date('2026-10-18T21:59:59Z'))).toEqual({
    weekStart: '2026-10-12', weekEnd: '2026-10-18',
  });
  expect(getRomeWeek(new Date('2026-10-18T22:00:00Z'))).toEqual(week);
  expect(getRomeWeek(new Date('2026-10-25T23:00:00Z'))).toEqual({
    weekStart: '2026-10-26', weekEnd: '2026-11-01',
  });
});

test('returns zeros and no pace for empty weeks or non-running activities', () => {
  expect(summarizeWeek(week, [])).toEqual(emptySummary);
  expect(summarizeWeek(week, [
    { startTimeGmt: '2026-10-21 12:00:00', isRunning: false, distance: 15_000, duration: 3_000 },
  ])).toEqual(emptySummary);
});

test('assigns runs by start time across both week boundaries and the DST change', () => {
  const run = { isRunning: true, distance: 5_000, duration: 1_500 };
  expect(summarizeWeek(week, [
    { ...run, startTimeGmt: '2026-10-18 21:59:59' },
    { ...run, startTimeGmt: '2026-10-18 22:00:00' },
    { ...run, startTimeGmt: '2026-10-25 22:59:59', distance: 10_000, duration: 3_300 },
    { ...run, startTimeGmt: '2026-10-25 23:00:00' },
    { ...run, startTimeGmt: 'invalid' },
  ])).toEqual({
    ...week,
    totalDistanceKm: 15,
    totalDurationMinutes: 80,
    activityCount: 2,
    averagePaceSecondsPerKm: 320,
  });
});

test('paginates Garmin date filters and includes running subtypes from later pages', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  try {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() / 1_000 + 3_600 })).toString('base64url');
    const cycling = {
      activityType: { typeKey: 'cycling', parentTypeId: 17 },
      startTimeGMT: '2026-10-21 12:00:00',
      distance: 30_000,
      duration: 3_600,
    };
    const run = {
      activityType: { typeKey: 'trail_running', parentTypeId: 1 },
      startTimeGMT: '2026-10-18 22:05:00',
      startTimeLocal: '2026-10-18 18:05:00',
      distance: 4_000,
      duration: 1_200,
    };
    const fetchGarmin = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`header.${payload}.signature`))
      .mockResolvedValueOnce(Response.json(Array.from({ length: 99 }, () => cycling)))
      .mockResolvedValueOnce(Response.json([run]));
    const app = createApp(createGarminClient('test-only-key', fetchGarmin));

    const result = await request(app).get('/api/weekly-summary').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toEqual({
      ...week,
      totalDistanceKm: 4,
      totalDurationMinutes: 20,
      activityCount: 1,
      averagePaceSecondsPerKm: 300,
    });

    const queries = fetchGarmin.mock.calls.slice(1).map(([url]) =>
      Object.fromEntries(new URL(String(url)).searchParams));
    expect(queries).toEqual([
      { start: '0', limit: '99', startDate: '2026-10-18', endDate: '2026-10-26' },
      { start: '99', limit: '99', startDate: '2026-10-18', endDate: '2026-10-26' },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test('returns a sanitized error if Garmin rate-limits the summary request', async () => {
  const fetchGarmin = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('Upstream details', { status: 429 }));
  const app = createApp(createGarminClient('test-only-key', fetchGarmin));

  await request(app).get('/api/weekly-summary').expect(429, {
    error: 'Garmin rate limit reached. Try again later.',
  });
});
