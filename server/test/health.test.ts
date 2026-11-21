import request from 'supertest';
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';

test('GET /api/health returns the RunLab health status', async () => {
  const response = await request(createApp()).get('/api/health');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/^application\/json\b/);
  expect(response.body).toEqual({ status: 'ok', app: 'RunLab' });
});
