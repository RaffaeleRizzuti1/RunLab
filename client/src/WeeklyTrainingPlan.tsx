import { useEffect, useId, useRef, useState } from 'react';
import { romeDate } from '../../server/src/rome-calendar';
import { formatTime } from './format-run-time';
import { WorkoutPhases } from './WorkoutPhases';
import { validateTrainingGoal, type TrainingGoal } from './training-goal';
import {
  fingerprintGoal, getPlanAssociation, goalPayload, loadWeeklyPlan, nextPlanWeek, requestWeeklyPlan, saveWeeklyPlan,
  type SavedPlan,
} from './weekly-training-plan';

const browserStorage = () => window.localStorage;
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'Europe/Rome' });
const sessionDateFormat = new Intl.DateTimeFormat('en', {
  weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Rome',
});
const distanceFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

function dateLabel(date: string, formatter = dateFormat): string {
  return formatter.format(new Date(`${date}T12:00:00Z`));
}

type Feedback = { scope: string; kind: 'loading' | 'error' | 'notice'; message: string };

function PlanDetails({ plan }: { plan: SavedPlan['plan'] }) {
  const totalDistance = plan.sessions.reduce((total, session) => total + session.distanceKm, 0);
  return (
    <div className="weekly-plan__details">
      <h3>Week of {dateLabel(plan.weekStart)} – {dateLabel(plan.weekEnd)}</h3>
      <p>{plan.sessions.length} sessions · {distanceFormat.format(totalDistance)} km planned</p>
      <h4>Weekly strategy</h4>
      <p>{plan.message}</p>
      {plan.sessions.some((session) => !('phases' in session)) && (
        <p>Saved in the earlier plan format. Regenerate to get structured workout phases.</p>
      )}
      <ol className="weekly-plan__sessions">
        {plan.sessions.map((session) => (
          <li className="data-card" key={session.date}>
            <time dateTime={session.date}>{dateLabel(session.date, sessionDateFormat)}</time>
            <h4 className="weekly-plan__workout-type">{'title' in session ? session.title : session.workoutType}</h4>
            {'title' in session && <p className="weekly-plan__workout-type">{session.workoutType}</p>}
            <dl className="activity-metrics">
              <div><dt>Distance</dt><dd>{distanceFormat.format(session.distanceKm)} km</dd></div>
              {session.estimatedDurationSeconds !== null && (
                <div><dt>Estimated duration</dt><dd>{formatTime(session.estimatedDurationSeconds, true)}</dd></div>
              )}
              {session.targetPaceSecondsPerKm !== null && (
                <div><dt>Target pace</dt><dd>{formatTime(session.targetPaceSecondsPerKm)} min/km</dd></div>
              )}
              {'heartRateBpm' in session && session.heartRateBpm && (
                <div><dt>Target heart rate</dt><dd>{session.heartRateBpm.min}–{session.heartRateBpm.max} bpm</dd></div>
              )}
              <div><dt>Intensity</dt><dd className="weekly-plan__workout-type">{session.intensity}</dd></div>
            </dl>
            {'phases' in session && <WorkoutPhases phases={session.phases} />}
            <p><strong>Execution</strong> {session.description}</p>
            {'purpose' in session && <p><strong>Purpose</strong> {session.purpose}</p>}
            <p><strong>Rationale</strong> {session.rationale}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WeeklyTrainingPlan({ goal }: { goal?: TrainingGoal }) {
  const id = useId();
  const [now, setNow] = useState(() => new Date());
  const [cache, setCache] = useState(() => loadWeeklyPlan(browserStorage));
  const [identity, setIdentity] = useState<{ goalKey: string; fingerprint?: string }>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [confirmScope, setConfirmScope] = useState<string>();
  const request = useRef<{ scope: string; controller: AbortController } | null>(null);
  const goalKey = goal ? JSON.stringify(goalPayload(goal)) : '';
  const week = nextPlanWeek(now);
  const scope = `${week.weekStart}:${goalKey}`;
  const fingerprint = identity?.goalKey === goalKey ? identity.fingerprint : undefined;
  const valid = !!goal && Object.keys(validateTrainingGoal(goal, now)).length === 0;
  const association = cache.saved && fingerprint && goal
    ? getPlanAssociation(cache.saved, fingerprint, week.weekStart, goal) : undefined;
  const currentPlan = valid && association === 'current' ? cache.saved?.plan : undefined;
  const activeFeedback = feedback?.scope === scope ? feedback : undefined;
  const pending = activeFeedback?.kind === 'loading';

  useEffect(() => {
    const update = () => setNow(new Date());
    const interval = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (goalKey) {
      void fingerprintGoal(JSON.parse(goalKey) as TrainingGoal).then(
        (value) => { if (active) setIdentity({ goalKey, fingerprint: value }); },
        () => { if (active) setIdentity({ goalKey }); },
      );
    }
    return () => { active = false; };
  }, [goalKey]);

  useEffect(() => {
    setConfirmScope((previous) => previous === scope ? previous : undefined);
    setFeedback((previous) => previous?.scope === scope ? previous : undefined);
    return () => {
      if (request.current?.scope === scope) {
        request.current.controller.abort();
        request.current = null;
      }
    };
  }, [scope]);

  async function generate() {
    const started = new Date();
    setNow(started);
    if (!goal || !fingerprint || request.current || Object.keys(validateTrainingGoal(goal, started)).length > 0
      || nextPlanWeek(started).weekStart !== week.weekStart) return;

    const controller = new AbortController();
    request.current = { scope, controller };
    setConfirmScope(undefined);
    setFeedback({ scope, kind: 'loading', message: 'Generating your weekly plan…' });

    try {
      const result = await requestWeeklyPlan(goal, week.weekStart, controller.signal);
      const finished = new Date();
      if (controller.signal.aborted) return;
      setNow(finished);
      if (nextPlanWeek(finished).weekStart !== week.weekStart || goal.targetDate <= romeDate(finished)) {
        setFeedback(undefined);
        return;
      }
      if ('error' in result) {
        setFeedback({ scope, kind: 'error', message: result.error });
      } else if (result.plan.status === 'cannot_generate') {
        setFeedback({ scope, kind: 'notice', message: `AI could not generate a plan: ${result.plan.message}` });
      } else {
        const saved = { goalFingerprint: fingerprint, plan: result.plan };
        const persisted = saveWeeklyPlan(browserStorage, saved);
        setCache({ saved, warning: persisted ? undefined : 'This plan could not be saved. It will be lost on reload.' });
        setFeedback({ scope, kind: 'notice', message: persisted ? 'Plan saved in this browser.' : 'Plan generated.' });
      }
    } finally {
      if (request.current?.controller === controller) request.current = null;
    }
  }

  return (
    <section className="data-card weekly-plan" aria-labelledby={id}>
      <h2 id={id}>AI Weekly Training Plan</h2>
      <p>AI-generated recommendations use your saved goal and recent Garmin training summaries.</p>
      <p className="weekly-plan__disclaimer">For information only. Adjust the plan for fatigue, pain or injury.</p>
      {!valid && <p>Save a valid training goal to generate a plan.</p>}
      {valid && identity?.goalKey === goalKey && !fingerprint && (
        <p role="alert">Plan storage requires a browser with secure context support. Use localhost or HTTPS.</p>
      )}
      {association === 'outdated' && cache.saved && (
        <p className="message-warning">Saved plan is outdated. It covers {dateLabel(cache.saved.plan.weekStart)} – {dateLabel(cache.saved.plan.weekEnd)}.</p>
      )}
      {association === 'different_goal' && <p className="message-warning">The saved plan belongs to a different goal.</p>}
      {cache.warning && <p className="message-warning">{cache.warning}</p>}
      <button className="button-primary" type="button" disabled={!valid || !fingerprint || pending || confirmScope === scope}
        onClick={() => { if (currentPlan) setConfirmScope(scope); else void generate(); }}>
        {pending ? 'Generating…' : currentPlan ? 'Regenerate Plan' : 'Generate Weekly Plan'}
      </button>
      {confirmScope === scope && (
        <div className="weekly-plan__confirm" role="group" aria-label="Confirm regeneration">
          <p>Regeneration uses another AI API request. Your current plan stays until a new plan passes validation.</p>
          <button type="button" className="button-primary" onClick={() => void generate()}>Confirm Regeneration</button>
          <button type="button" onClick={() => setConfirmScope(undefined)}>Cancel</button>
        </div>
      )}
      {activeFeedback && <p role={activeFeedback.kind === 'error' ? 'alert' : 'status'}>{activeFeedback.message}</p>}
      {currentPlan && <PlanDetails plan={currentPlan} />}
    </section>
  );
}
