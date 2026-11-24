import express, { type Response } from 'express';
import { findComparableActivities, parseComparisonFilters } from './comparison.js';
import { AiProviderError, type AiProvider, type AiProviderName } from './ai-provider.js';
import { createGarminClient, GarminError } from './garmin.js';
import { getRomeWeek, shiftCalendarDate, weekFromMonday } from './rome-calendar.js';
import { getTrainingHistoryWeeks, summarizeTrainingHistory } from './training-history.js';
import { validateTrainingGoal, weekdays, type TrainingGoal } from './training-goal.js';
import { buildTrainingPlanContext, validateGeneratedPlan, type GeneratedPlan } from './training-plan.js';
import { logTrainingPlanDiagnostic } from './training-plan-diagnostics.js';
import { summarizeWeek, compareWeeks } from './weekly-summary.js';

function sendGarminError(response: Response, error: unknown) {
  if (error instanceof GarminError && error.kind === 'not-configured') {
    response.status(503).json({ error: 'Garmin is not configured on the RunLab server.' });
  } else if (error instanceof GarminError && error.kind === 'rate-limited') {
    response.status(429).json({ error: 'Garmin rate limit reached. Try again later.' });
  } else {
    response.status(502).json({ error: 'Could not load activities from Garmin.' });
  }
}

const parsePlanBody = express.json({ limit: '8kb' });

function sendPlanError(response: Response, error: AiProviderError, provider: AiProviderName) {
  const gemini = provider === 'gemini';
  if (error.kind === 'unavailable') {
    response.status(503).json({
      code: gemini ? 'GEMINI_TEMPORARILY_UNAVAILABLE' : 'AI_TEMPORARILY_UNAVAILABLE',
      error: gemini ? 'Gemini is temporarily unavailable. Please try again later.'
        : 'The AI provider is temporarily unavailable. Please try again later.',
    });
    return;
  }
  if (error.kind === 'authentication' || error.kind === 'unsupported-model') {
    response.status(502).json(error.kind === 'authentication'
      ? { code: 'AI_AUTHENTICATION_FAILED', error: 'The AI provider rejected its server credentials or permissions.' }
      : { code: 'AI_UNSUPPORTED_MODEL', error: 'The configured AI model is unavailable or does not support strict output.' });
    return;
  }
  const errors = {
    'rate-limited': [429, gemini ? 'Gemini quota or rate limit reached. Try again later.' : 'AI quota or rate limit reached. Try again later.'],
    timeout: [504, gemini ? 'Gemini did not respond in time. Try again later.' : 'The AI provider did not respond in time. Try again later.'],
    upstream: [502, gemini ? 'Gemini could not generate a training plan.' : 'The AI provider could not generate a training plan.'],
    'invalid-plan': [502, gemini ? 'Gemini returned a plan that did not pass validation.' : 'The AI provider returned a plan that did not pass validation.'],
  } as const;
  const [status, message] = errors[error.kind];
  response.status(status).json({ error: message });
}

export function createApp(garmin = createGarminClient(), aiProvider?: AiProvider) {
  const app = express();

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', app: 'RunLab' });
  });

  app.get('/api/activities', async (_request, response) => {
    response.set('Cache-Control', 'no-store');

    try {
      response.json(await garmin.getActivities());
    } catch (error) {
      sendGarminError(response, error);
    }
  });

  app.get('/api/weekly-summary', async (request, response) => {
    response.set('Cache-Control', 'no-store');

    const { weekStart } = request.query;
    const week = weekStart === undefined ? getRomeWeek(new Date()) : weekFromMonday(weekStart);
    if (!week) {
      response.status(400).json({ error: 'weekStart must be a Monday in YYYY-MM-DD format.' });
      return;
    }

    try {
      const previousWeek = {
        weekStart: shiftCalendarDate(week.weekStart, -7),
        weekEnd: shiftCalendarDate(week.weekStart, -1),
      };
      // Garmin filters by the activity's local date, which can differ from Rome's.
      const activities = await garmin.getActivitiesInDateRange(
        shiftCalendarDate(previousWeek.weekStart, -1),
        shiftCalendarDate(week.weekEnd, 1),
      );
      const current = summarizeWeek(week, activities);
      const previous = summarizeWeek(previousWeek, activities);
      response.json({ ...current, previousWeek: previous, comparison: compareWeeks(current, previous) });
    } catch (error) {
      sendGarminError(response, error);
    }
  });

  app.get('/api/comparison', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const result = parseComparisonFilters(request.query);
    if ('error' in result) {
      response.status(400).json({ error: result.error });
      return;
    }

    const { filters } = result;
    try {
      // Garmin filters by activity-local dates. The matcher enforces the exact Rome dates.
      const candidates = await garmin.getActivitiesInDateRange(
        shiftCalendarDate(filters.from, -1),
        shiftCalendarDate(filters.to, 1),
      );
      const activities = findComparableActivities(filters, candidates);
      response.json({ filters, totalMatchingCount: activities.length, activities });
    } catch (error) {
      sendGarminError(response, error);
    }
  });

  app.get('/api/training-history', async (_request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      const weeks = getTrainingHistoryWeeks(new Date());
      const activities = await garmin.getActivitiesInDateRange(
        shiftCalendarDate(weeks[0].weekStart, -1),
        shiftCalendarDate(weeks[weeks.length - 1].weekEnd, 1),
        true,
      );
      response.json(summarizeTrainingHistory(weeks, activities));
    } catch (error) {
      sendGarminError(response, error);
    }
  });

  let pending: { key: string; result: Promise<GeneratedPlan & { weekStart: string; weekEnd: string }> } | undefined;
  app.post('/api/training-plan/generate', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    parsePlanBody(request, response, (error?: unknown) => {
      if (error) {
        response.status(400).json({ error: 'Provide a valid JSON training goal.' });
        return;
      }
      next();
    });
  }, async (request, response) => {
    const now = new Date();
    const errors = validateTrainingGoal(request.body, now);
    if (Object.keys(errors).length > 0) {
      response.status(400).json({ error: 'Invalid training goal.', fields: errors });
      return;
    }
    if (!aiProvider) {
      response.status(503).json({ error: 'An AI provider is not configured on the RunLab server.' });
      return;
    }

    const { targetDistanceKm, targetPaceSecondsPerKm, targetDate, runsPerWeek, preferredDays } = request.body as TrainingGoal;
    const goal = { targetDistanceKm, targetPaceSecondsPerKm, targetDate, runsPerWeek,
      preferredDays: weekdays.filter((day) => preferredDays.includes(day)) };
    const key = JSON.stringify([getRomeWeek(now).weekStart, goal]);
    if (pending && pending.key !== key) {
      response.status(409).json({ error: 'Another training plan is being generated. Try again when it finishes.' });
      return;
    }
    if (!pending) {
      const result = (async () => {
        const context = await buildTrainingPlanContext(garmin, goal, now).catch((error: unknown) => {
          if (!(error instanceof GarminError)) {
            logTrainingPlanDiagnostic('history_context', 'garmin_history_or_aggregation_failed', undefined, aiProvider.name);
          }
          throw error;
        });
        try {
          const generated = await aiProvider.generate(context);
          const plan = validateGeneratedPlan(generated, context, aiProvider.name);
          if (!plan) throw new AiProviderError('invalid-plan');
          return { ...context.nextWeek, ...plan };
        } catch (error) {
          if (!(error instanceof AiProviderError)) {
            logTrainingPlanDiagnostic('backend', 'unexpected_generation_or_validation_error', undefined, aiProvider.name);
          }
          throw error;
        }
      })().finally(() => { pending = undefined; });
      pending = { key, result };
    }
    try {
      response.json(await pending.result);
    } catch (error) {
      if (error instanceof AiProviderError) sendPlanError(response, error, aiProvider.name);
      else sendGarminError(response, error);
    }
  });

  return app;
}
