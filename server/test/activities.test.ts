import request from 'supertest';
import { expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createGarminClient } from '../src/garmin.js';

const tokenUrl = 'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token';
const searchUrl = 'https://personal.connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=5';
const mockKey = 'test-only-api-key';

function tokenExpiringIn(seconds: number) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + seconds })).toString('base64url');
  return `header.${payload}.signature`;
}

test('returns only activity summaries and reuses the Garmin token', async () => {
  const token = tokenExpiringIn(3_600);
  const activity = {
    activityName: 'Morning run',
    startTimeLocal: '2026-11-21 08:00:00',
    activityType: { typeKey: 'running' },
    distance: 5_000,
    duration: 1_800,
    averageHR: 140,
    userProfileId: 123,
  };
  const fetchGarmin = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(token))
    .mockImplementation(async () => Response.json([activity, { activityName: 'Walk' }]));
  const app = createApp(createGarminClient(mockKey, fetchGarmin));

  const response = await request(app).get('/api/activities').expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual([
    { name: 'Morning run', date: '2026-11-21', activityType: 'running', distance: 5_000, duration: 1_800, averageHeartRate: 140 },
    { name: 'Walk' },
  ]);
  await request(app).get('/api/activities').expect(200);

  expect(fetchGarmin).toHaveBeenCalledTimes(3);
  expect(fetchGarmin).toHaveBeenNthCalledWith(1, tokenUrl, expect.objectContaining({
    method: 'POST', headers: { Authorization: `ApiKey ${mockKey}` },
  }));
  expect(fetchGarmin).toHaveBeenNthCalledWith(2, searchUrl, expect.objectContaining({
    method: 'GET', headers: { Authorization: `Bearer ${token}` },
  }));
});

test('refreshes a token with less than one minute of validity remaining', async () => {
  const replacement = tokenExpiringIn(3_600);
  const fetchGarmin = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(tokenExpiringIn(30)))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response(replacement))
    .mockResolvedValueOnce(Response.json([]));
  const app = createApp(createGarminClient(mockKey, fetchGarmin));

  await request(app).get('/api/activities').expect(200, []);
  await request(app).get('/api/activities').expect(200, []);

  expect(fetchGarmin).toHaveBeenNthCalledWith(3, tokenUrl, expect.objectContaining({ method: 'POST' }));
  expect(fetchGarmin).toHaveBeenNthCalledWith(4, searchUrl, expect.objectContaining({
    headers: { Authorization: `Bearer ${replacement}` },
  }));
});

test('reports missing configuration without contacting Garmin', async () => {
  const fetchGarmin = vi.fn<typeof fetch>();
  const app = createApp(createGarminClient(undefined, fetchGarmin));

  await request(app).get('/api/activities').expect(503, {
    error: 'Garmin is not configured on the RunLab server.',
  });
  expect(fetchGarmin).not.toHaveBeenCalled();
});

test('reports rate limits without retrying or forwarding the upstream body', async () => {
  const token = tokenExpiringIn(3_600);
  const fetchGarmin = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(token))
    .mockResolvedValueOnce(new Response(token, { status: 429 }));
  const app = createApp(createGarminClient(mockKey, fetchGarmin));

  await request(app).get('/api/activities').expect(429, { error: 'Garmin rate limit reached. Try again later.' });
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
});

test('returns a generic error when Garmin rejects the key', async () => {
  const fetchGarmin = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(mockKey, { status: 401 }));
  const app = createApp(createGarminClient(mockKey, fetchGarmin));

  await request(app).get('/api/activities').expect(502, { error: 'Could not load activities from Garmin.' });
  expect(fetchGarmin).toHaveBeenCalledTimes(1);
});
