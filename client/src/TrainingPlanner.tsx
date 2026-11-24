import { useId, useState, type FormEvent } from 'react';
import { romeDate, shiftCalendarDate } from '../../server/src/rome-calendar';
import { formatTime } from './format-run-time';
import { parseTrainingGoal, weekdays, type GoalErrors, type TrainingGoal, type TrainingGoalDraft, type Weekday } from './training-goal';
import { loadTrainingGoal, saveTrainingGoal } from './training-goal-storage';
import { TrainingHistory } from './TrainingHistory';
import { WeeklyTrainingPlan } from './WeeklyTrainingPlan';
import './TrainingPlanner.css';

const browserStorage = () => window.localStorage;
const emptyDraft: TrainingGoalDraft = {
  targetDistanceKm: '',
  targetPace: '',
  targetDate: '',
  runsPerWeek: '',
  preferredDays: [],
};

function toDraft(goal: TrainingGoal): TrainingGoalDraft {
  return {
    targetDistanceKm: String(goal.targetDistanceKm),
    targetPace: formatTime(goal.targetPaceSecondsPerKm).padStart(5, '0'),
    targetDate: goal.targetDate,
    runsPerWeek: String(goal.runsPerWeek),
    preferredDays: goal.preferredDays,
  };
}

export function TrainingPlanner() {
  const id = useId();
  const [restored] = useState(() => loadTrainingGoal(browserStorage, new Date()));
  const restoredGoal = restored && 'goal' in restored ? restored.goal : undefined;
  const [draft, setDraft] = useState(() => restoredGoal ? toDraft(restoredGoal) : emptyDraft);
  const [savedGoal, setSavedGoal] = useState(restoredGoal);
  const [editing, setEditing] = useState(!restoredGoal);
  const [errors, setErrors] = useState<GoalErrors>({});
  const [feedback, setFeedback] = useState(restoredGoal ? 'Saved goal loaded from this browser.' : '');
  const [storageError, setStorageError] = useState(
    restored && 'issue' in restored
      ? restored.issue === 'invalid'
        ? 'The saved goal is invalid or expired. Enter a new goal to replace it.'
        : 'Browser storage is unavailable.'
      : '',
  );

  function update<K extends keyof TrainingGoalDraft>(field: K, value: TrainingGoalDraft[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function toggleDay(day: Weekday) {
    update('preferredDays', draft.preferredDays.includes(day)
      ? draft.preferredDays.filter((preferred) => preferred !== day)
      : [...draft.preferredDays, day]);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const now = new Date();
    const result = parseTrainingGoal(draft, now);
    if ('errors' in result) {
      setErrors(result.errors);
      setFeedback('');
      return;
    }
    if (!saveTrainingGoal(browserStorage, result.goal, now)) {
      setFeedback('');
      setStorageError('Could not save the goal. Check that this browser allows local storage and try again.');
      return;
    }
    setErrors({});
    setStorageError('');
    setDraft(toDraft(result.goal));
    setSavedGoal(result.goal);
    setEditing(false);
    setFeedback('Goal saved in this browser.');
  }

  const fields = [
    { name: 'targetDistanceKm', label: 'Target distance (km)', type: 'text', inputMode: 'decimal' },
    { name: 'targetPace', label: 'Target pace (MM:SS min/km)', type: 'text', placeholder: '05:30' },
    { name: 'targetDate', label: 'Target date', type: 'date', min: shiftCalendarDate(romeDate(new Date()), 1) },
  ] as const;

  return (
    <div className="training-planner">
      <section className="data-card" aria-labelledby={`${id}-goal`}>
        <h2 id={`${id}-goal`}>Training goal</h2>
        <p>Your goal is stored locally in this browser.</p>
        <form onSubmit={save} noValidate>
          <fieldset className="training-planner__fields" disabled={!editing} aria-label="Goal settings">
            {fields.map(({ name, label, ...attributes }) => (
              <div className="training-planner__field" key={name}>
                <label htmlFor={`${id}-${name}`}>{label}</label>
                <input {...attributes} id={`${id}-${name}`} name={name} value={draft[name]} required
                  aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
                  onChange={(event) => update(name, event.target.value)} />
                {errors[name] && <p role="alert" id={`${id}-${name}-error`}>{errors[name]}</p>}
              </div>
            ))}
            <div className="training-planner__field">
              <label htmlFor={`${id}-runs`}>Runs per week</label>
              <select id={`${id}-runs`} name="runsPerWeek" required value={draft.runsPerWeek}
                aria-invalid={Boolean(errors.runsPerWeek)} aria-describedby={errors.runsPerWeek ? `${id}-runs-error` : undefined}
                onChange={(event) => update('runsPerWeek', event.target.value)}>
                <option value="">Select runs per week</option>
                {[2, 3, 4, 5].map((runs) => <option key={runs} value={runs}>{runs}</option>)}
              </select>
              {errors.runsPerWeek && <p id={`${id}-runs-error`} role="alert">{errors.runsPerWeek}</p>}
            </div>
            <fieldset className="training-planner__days">
              <legend>Preferred training days (optional)</legend>
              <div>
                {weekdays.map((day) => (
                  <label key={day}>
                    <input type="checkbox" name="preferredDays" value={day} checked={draft.preferredDays.includes(day)}
                      onChange={() => toggleDay(day)} />
                    {day}
                  </label>
                ))}
              </div>
              {errors.preferredDays && <p role="alert">{errors.preferredDays}</p>}
            </fieldset>
          </fieldset>
          {editing
            ? <button type="submit" className="button-primary">Save Goal</button>
            : <button type="button" onClick={() => {
              setEditing(true);
              setFeedback('Editing your goal. Save to apply changes.');
            }}>Edit Goal</button>}
          {feedback && <p role="status">{feedback}</p>}
          {storageError && <p role="alert">{storageError}</p>}
        </form>
      </section>
      <TrainingHistory />
      <WeeklyTrainingPlan goal={editing ? undefined : savedGoal} />
    </div>
  );
}
