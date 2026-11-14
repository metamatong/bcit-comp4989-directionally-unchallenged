import { useEffect, useState } from 'react';
import type { PlanBounds, VisualPlan } from '../types';
import {
  planLabel,
  pointOnPlan,
  type CandidateAnswer,
  type FloorObservation,
  type CandidateEndpoint,
  type CandidateView,
  type TopologyBootstrap,
  type TopologyCommand,
} from '../topology';

type Position = { planId: string; sourceSha256: string; point: CandidateEndpoint['point'] | null };
type AnswerCommand = Extract<
  TopologyCommand,
  { type: 'answer-candidate' | 'record-floor-observation' }
>;
export const candidateStateLabels: Record<CandidateView['state'], string> = {
  unanswered: 'Unanswered',
  confirmed: 'Confirmed by reviewer',
  rejected: 'F · Rejected',
  deferred: 'Unknown · Defer',
  'needs-review': 'Changed · Review again',
  'needs-direction': 'Direction needed',
  'needs-points': 'Service reported · Mark landings',
};
const directionLabels = {
  both: 'Both directions A ↔ B',
  'a-to-b': 'A → B only',
  'b-to-a': 'B → A only',
  unknown: 'Unknown',
};
const answerLabels = {
  true: 'T · Connected',
  false: 'F · Disconnected',
  unknown: 'Unknown · Defer',
};
const floorAnswerLabels = {
  true: 'T · Serves both floors',
  false: 'F · No service between floors',
  unknown: 'Unknown · Defer',
};

function savedAnswerLabel(entry: CandidateAnswer | FloorObservation): string {
  if (!('direction' in entry)) return `${floorAnswerLabels[entry.answer]} · floor-service report`;
  const label = answerLabels[entry.answer];
  return entry.direction ? `${label} · ${directionLabels[entry.direction]}` : label;
}

const questionByKind = {
  stairs: { title: 'stair connection', question: 'Does the same stairway connect A and B?' },
  elevator: {
    title: 'elevator connection',
    question: 'Does the same elevator serve both marked landings?',
  },
  outdoor: {
    title: 'outdoor passage',
    question: 'Can you walk outside between doors A and B?',
  },
  corridor: {
    title: 'corridor connection',
    question: 'Can you walk along the corridor between A and B on this floor?',
  },
  'building-link': { title: 'building passage', question: 'Does this passage connect A and B?' },
} satisfies Record<CandidateView['kind'], { title: string; question: string }>;

export function candidateFocusBounds(
  point: CandidateEndpoint['point'] | null,
  fullPage: boolean,
): PlanBounds {
  if (!point || fullPage) return [0, 0, 1, 1];
  const left = Math.max(0, Math.min(0.72, point.x - 0.14));
  const top = Math.max(0, Math.min(0.64, point.y - 0.18));
  return [left, top, left + 0.28, top + 0.36];
}
export function pointInCandidateView(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  bounds: PlanBounds,
) {
  const point = pointOnPlan(clientX, clientY, rect);
  return point
    ? {
        x: bounds[0] + point.x * (bounds[2] - bounds[0]),
        y: bounds[1] + point.y * (bounds[3] - bounds[1]),
      }
    : null;
}

function PlanPin({
  marker,
  point,
  plan,
  size,
}: {
  marker: 'A' | 'B';
  point: NonNullable<CandidateEndpoint['point']>;
  plan: VisualPlan;
  size: number;
}) {
  return (
    <g
      className={`candidate-pin point-${marker.toLowerCase()}`}
      transform={`translate(${point.x * plan.width} ${point.y * plan.height})`}
    >
      <circle r={size} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <text textAnchor="middle" dominantBaseline="central" fontSize={size * 1.12}>
        {marker}
      </text>
    </g>
  );
}

function CorridorPlan({
  candidate,
  plans,
  from,
  to,
}: {
  candidate: CandidateView;
  plans: VisualPlan[];
  from: Position;
  to: Position;
}) {
  const [fullPage, setFullPage] = useState(false);
  const plan = plans.find((item) => item.id === from.planId && item.id === to.planId);
  const a = from.point,
    b = to.point;
  if (!plan || !a || !b)
    return <p role="alert">The plan for these corridor endpoints is unavailable.</p>;
  const trace =
    candidate.drawingTrace &&
    (['from', 'to'] as const).every((side) => {
      const mark = side === 'from' ? from : to,
        original = candidate[side];
      return (
        mark.planId === original.planId &&
        mark.sourceSha256 === original.sourceSha256 &&
        mark.point?.x === original.point?.x &&
        mark.point?.y === original.point?.y
      );
    })
      ? candidate.drawingTrace
      : undefined;
  const points = [a, ...(trace?.bends ?? []), b];
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const left = fullPage ? 0 : Math.max(0, Math.min(...xs) - 0.045);
  const top = fullPage ? 0 : Math.max(0, Math.min(...ys) - 0.06);
  const right = fullPage ? 1 : Math.min(1, Math.max(...xs) + 0.045);
  const bottom = fullPage ? 1 : Math.min(1, Math.max(...ys) + 0.045);
  const width = (right - left) * plan.width,
    height = (bottom - top) * plan.height;
  return (
    <section
      className="candidate-plan candidate-corridor-plan"
      aria-label="Floor plan with both corridor endpoints"
    >
      <div className="candidate-plan-heading">
        <h3>{planLabel(plan)}</h3>
        <button
          type="button"
          className="topology-button"
          onClick={() => setFullPage((current) => !current)}
        >
          {fullPage ? 'Zoom to corridor' : 'Show full plan'}
        </button>
      </div>
      <div className="topology-actions">
        <span className="candidate-letter point-a">A</span>
        {candidate.from.label}
        <span className="candidate-letter point-b">B</span>
        {candidate.to.label}
      </div>
      <svg
        className="candidate-drawing"
        viewBox={`${left * plan.width} ${top * plan.height} ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Review the corridor from ${candidate.from.label} to ${candidate.to.label}`}
      >
        <image href={plan.full.url} x={0} y={0} width={plan.width} height={plan.height} />
        {trace && (
          <polyline
            aria-label="Corridor segment under review"
            points={points.map((p) => `${p.x * plan.width},${p.y * plan.height}`).join(' ')}
            fill="none"
            stroke="#a04a10"
            strokeWidth="3"
            strokeDasharray="7 4"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <PlanPin marker="A" point={a} plan={plan} size={width * 0.015} />
        <PlanPin marker="B" point={b} plan={plan} size={width * 0.015} />
      </svg>
      {(!candidate.drawingTrace || trace) && <p>{candidate.rationale}</p>}
      {candidate.drawingTrace && !trace && (
        <p>A marker moved. Review the corridor line between the updated points.</p>
      )}
      <div className="topology-plan-footer">
        <span>{plan.attribution}</span>
        <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
          Original BCIT PDF ↗
        </a>
      </div>
    </section>
  );
}

function CandidatePlan({
  marker,
  original,
  value,
  plans,
  disabled,
  onChange,
}: {
  marker: 'A' | 'B';
  original: CandidateEndpoint;
  value: Position;
  plans: VisualPlan[];
  disabled: boolean;
  onChange: (value: Position) => void;
}) {
  const [fullPage, setFullPage] = useState(false);
  const [editing, setEditing] = useState(original.point === null);
  const plan = plans.find((item) => item.id === value.planId);
  const building = plans.find((item) => item.id === original.planId)?.building;
  if (!plan) return <p role="alert">The official plan for this point is unavailable.</p>;
  const bounds = candidateFocusBounds(value.point, fullPage);
  const width = (bounds[2] - bounds[0]) * plan.width,
    height = (bounds[3] - bounds[1]) * plan.height;
  return (
    <section className="candidate-plan" aria-label={`Plan for point ${marker}`}>
      <div className="candidate-plan-heading">
        <h3>
          <span className={`candidate-letter point-${marker.toLowerCase()}`}>{marker}</span>{' '}
          {planLabel(plan)}
        </h3>
        <button
          type="button"
          className="topology-button"
          disabled={disabled || !value.point}
          onClick={() => setFullPage((current) => !current)}
        >
          {fullPage && value.point ? 'Zoom to point' : 'Show full plan'}
        </button>
      </div>
      <p className="candidate-point-name">{original.label}</p>
      <svg
        viewBox={`${bounds[0] * plan.width} ${bounds[1] * plan.height} ${width} ${height}`}
        width={width}
        height={height}
        className={`candidate-drawing ${editing ? 'is-editing' : ''}`}
        role="img"
        aria-label={`Candidate point ${marker} on ${planLabel(plan)}`}
        onClick={(event) => {
          if (!editing || disabled) return;
          const point = pointInCandidateView(
            event.clientX,
            event.clientY,
            event.currentTarget.getBoundingClientRect(),
            bounds,
          );
          if (point) onChange({ ...value, point });
        }}
      >
        <image href={plan.full.url} x={0} y={0} width={plan.width} height={plan.height} />
        {value.point && (
          <PlanPin marker={marker} point={value.point} plan={plan} size={width * 0.033} />
        )}
      </svg>
      <p className="topology-help">
        {value.planId === original.planId
          ? original.description
          : 'The floor has changed. Mark the passage on the new plan.'}
      </p>
      <div className="topology-actions">
        <button
          type="button"
          className="topology-button"
          disabled={disabled}
          aria-expanded={editing}
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? 'Finish editing point' : `Edit ${marker} location or floor`}
        </button>
        <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
          Original BCIT PDF ↗
        </a>
      </div>
      {editing && (
        <fieldset disabled={disabled} className="candidate-position-fields">
          <legend>Correct marker {marker}</legend>
          <label>
            Floor
            <select
              value={value.planId}
              onChange={(event) => {
                const next = plans.find((item) => item.id === event.target.value)!;
                // A different page has a different coordinate system. Never transfer the old point.
                onChange({ planId: next.id, sourceSha256: next.sourceSha256, point: null });
                setFullPage(true);
              }}
            >
              {plans
                .filter((item) => item.building === building)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {planLabel(item)}
                  </option>
                ))}
            </select>
          </label>
          <p className="topology-help">
            Select the point on the plan. If you change floors, place a new marker.
          </p>
          <CoordinateFields
            key={value.planId}
            point={value.point}
            onChange={(point) => onChange({ ...value, point })}
          />
        </fieldset>
      )}
      <p className="topology-help">
        {plan.attribution} · page {plan.page}
      </p>
    </section>
  );
}

function CoordinateFields({
  point,
  onChange,
}: {
  point: Position['point'];
  onChange: (point: Position['point']) => void;
}) {
  const [partial, setPartial] = useState({ x: '', y: '' });
  const values = point
    ? {
        x: String(Number((point.x * 100).toFixed(4))),
        y: String(Number((point.y * 100).toFixed(4))),
      }
    : partial;
  return (
    <div className="topology-two-fields">
      {(['x', 'y'] as const).map((axis) => (
        <label key={axis}>
          {axis.toUpperCase()} (% of page)
          <input
            type="number"
            min={0}
            max={100}
            step="any"
            value={values[axis]}
            onChange={(event) => {
              const next = { ...values, [axis]: event.target.value };
              setPartial(next);
              const valid = [next.x, next.y].every(
                (value) =>
                  value !== '' &&
                  Number.isFinite(Number(value)) &&
                  Number(value) >= 0 &&
                  Number(value) <= 100,
              );
              onChange(valid ? { x: Number(next.x) / 100, y: Number(next.y) / 100 } : null);
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function DirectionQuestion({
  disabled,
  onAnswer,
  floorPair,
}: {
  disabled: boolean;
  onAnswer: (direction: NonNullable<CandidateAnswer['direction']>) => void;
  floorPair?: { from: string; to: string };
}) {
  const labels = floorPair
    ? {
        both: `Both directions (floor ${floorPair.from} ↔ floor ${floorPair.to})`,
        'a-to-b': `A → B only (floor ${floorPair.from} → floor ${floorPair.to})`,
        'b-to-a': `B → A only (floor ${floorPair.to} → floor ${floorPair.from})`,
        unknown: 'Unknown',
      }
    : directionLabels;
  return (
    <div className="candidate-question">
      <h3>Which directions can you travel?</h3>
      <p>Choose the direction you can confirm. Choosing Unknown keeps the connection pending.</p>
      <div className="candidate-direction-answers">
        {(['both', 'a-to-b', 'b-to-a', 'unknown'] as const).map((direction) => (
          <button
            type="button"
            key={direction}
            className="topology-button"
            disabled={disabled}
            onClick={() => onAnswer(direction)}
          >
            {labels[direction]}
          </button>
        ))}
      </div>
    </div>
  );
}

function candidatePosition(endpoint: CandidateEndpoint): Position {
  return {
    planId: endpoint.planId,
    sourceSha256: endpoint.sourceSha256,
    point: endpoint.point && { ...endpoint.point },
  };
}
function positionTitle(position: Position, plans: VisualPlan[]) {
  const plan = plans.find((item) => item.id === position.planId);
  return plan ? planLabel(plan) : position.planId;
}

export function ConnectionReview({
  data,
  reviewer,
  busy,
  onReviewer,
  onDirty,
  onAnswer,
  onRoute,
}: {
  data: TopologyBootstrap;
  reviewer: string;
  busy: boolean;
  onReviewer: (name: string) => void;
  onDirty: (dirty: boolean) => void;
  onAnswer: (command: AnswerCommand) => Promise<TopologyBootstrap | undefined>;
  onRoute: (answer: CandidateAnswer) => void;
}) {
  const candidates = data.candidates ?? [];
  const [selectedId, setSelectedId] = useState(() => {
    const requestedId =
      typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('candidate');
    return (
      candidates.find((item) => item.id === requestedId)?.id ??
      candidates.find(
        (candidate) =>
          candidate.state === 'unanswered' &&
          !candidate.waitingForPoints &&
          !candidate.blockedReason,
      )?.id ??
      candidates[0]?.id ??
      ''
    );
  });
  const candidate = candidates.find((item) => item.id === selectedId) ?? candidates[0];
  const [from, setFrom] = useState<Position | null>(() =>
    candidate ? candidatePosition(candidate.from) : null,
  );
  const [to, setTo] = useState<Position | null>(() =>
    candidate ? candidatePosition(candidate.to) : null,
  );
  const [note, setNote] = useState(
    candidate?.latestAnswer?.note ?? candidate?.latestFloorObservation?.note ?? '',
  );
  const [stage, setStage] = useState<'connection' | 'direction'>('connection');
  const [modified, setModified] = useState(false);
  const [localError, setLocalError] = useState('');
  const [draftForHash, setDraftForHash] = useState(candidate?.presentedHash);
  useEffect(() => {
    if (!candidate) return;
    setDraftForHash(candidate.presentedHash);
    setFrom(candidatePosition(candidate.from));
    setTo(candidatePosition(candidate.to));
    setNote(candidate.latestAnswer?.note ?? candidate.latestFloorObservation?.note ?? '');
    setStage('connection');
    setModified(false);
    setLocalError('');
    onDirty(false);
  }, [candidate?.presentedHash, onDirty]);
  const markModified = () => {
    setModified(true);
    onDirty(true);
  };
  function chooseCandidate(id: string) {
    if (busy || (modified && !window.confirm('Discard unsaved marker changes or answers?'))) return;
    setSelectedId(id);
  }
  async function answer(value: CandidateAnswer['answer'], direction: CandidateAnswer['direction']) {
    if (
      !candidate ||
      draftForHash !== candidate.presentedHash ||
      !from ||
      !to ||
      !reviewer.trim() ||
      busy
    )
      return;
    setLocalError('');
    const fields = {
      candidateId: candidate.id,
      presentedHash: candidate.presentedHash,
      reviewer: reviewer.trim(),
      note,
    };
    let submission: AnswerCommand;
    if (from.point && to.point) {
      submission = {
        ...fields,
        type: 'answer-candidate',
        answer: value,
        direction,
        from: { ...from, point: from.point },
        to: { ...to, point: to.point },
      };
    } else {
      if (!candidate.allowsFloorOnlyAnswer) return;
      submission = { ...fields, type: 'record-floor-observation', answer: value, from, to };
    }
    const next = await onAnswer(submission);
    if (!next)
      setLocalError(
        'Could not save the answer. Check the error above. If another edit was saved, reload and try again.',
      );
  }
  if (!candidate || !from || !to)
    return (
      <section className="candidate-workspace">
        <h2>No candidates to review</h2>
        <p>Candidates appear here once they have been marked on the official plans.</p>
      </section>
    );
  const index = candidates.indexOf(candidate);
  const disabled =
    busy ||
    draftForHash !== candidate.presentedHash ||
    !!candidate.blockedReason ||
    !!candidate.waitingForPoints ||
    !reviewer.trim();
  const pointsMissing = !from.point || !to.point;
  const floorQuestion = pointsMissing && candidate.allowsFloorOnlyAnswer;
  const copy = questionByKind[candidate.kind];
  const fromFloor = data.plans.find((plan) => plan.id === from.planId)?.floor;
  const toFloor = data.plans.find((plan) => plan.id === to.planId)?.floor;
  const verticalFloors =
    (candidate.kind === 'stairs' || candidate.kind === 'elevator') && fromFloor && toFloor
      ? { from: fromFloor, to: toFloor }
      : undefined;
  const history = [...data.document.candidateAnswers, ...data.document.floorObservations]
    .filter((item) => item.candidateId === candidate.id)
    .reverse()
    .sort((a, b) => b.answeredAt.localeCompare(a.answeredAt));
  const latest = candidate.latestAnswer ?? candidate.latestFloorObservation;
  return (
    <section className="candidate-workspace" aria-label="Review connection candidates">
      <div className="candidate-introduction">
        <h2>Review both points and choose T, F or Unknown.</h2>
        <p>
          Check the building, floor and marker on each plan, then confirm whether the points
          connect.
        </p>
      </div>
      <div className="candidate-toolbar">
        <label>
          Connection to review ({index + 1}/{candidates.length})
          <select
            disabled={busy}
            value={candidate.id}
            onChange={(event) => chooseCandidate(event.target.value)}
          >
            {candidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {candidateStateLabels[item.state]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reviewer name or nickname
          <input
            maxLength={100}
            value={reviewer}
            disabled={busy}
            onChange={(event) => onReviewer(event.target.value)}
            autoComplete="off"
          />
        </label>
      </div>
      <div className="candidate-heading">
        <h2>
          {candidate.endpointRefs ? (
            candidate.title
          ) : (
            <>
              {positionTitle(from, data.plans)} ↔ {positionTitle(to, data.plans)} {copy.title}
            </>
          )}
        </h2>
        <span
          className={`topology-badge ${candidate.state === 'confirmed' ? 'verified' : candidate.state === 'rejected' ? 'rejected' : ''}`}
        >
          {candidateStateLabels[candidate.state]}
        </span>
      </div>
      {candidate.blockedReason && (
        <p className="topology-error" role="alert">
          {candidate.blockedReason}
        </p>
      )}
      {candidate.waitingForPoints && (
        <p role="status">First confirm the door and landing at the ends of this corridor.</p>
      )}
      {(candidate.drawingTrace || (candidate.endpointRefs?.from && candidate.endpointRefs.to)) && (
        <CorridorPlan
          key={candidate.presentedHash}
          candidate={candidate}
          plans={data.plans}
          from={from}
          to={to}
        />
      )}
      {!(candidate.endpointRefs?.from && candidate.endpointRefs.to) && (
        <details
          key={candidate.presentedHash}
          className="candidate-position-details"
          open={candidate.drawingTrace ? undefined : true}
        >
          <summary>Inspect markers or change their location or floor</summary>
          <div className="candidate-plan-pair">
            <CandidatePlan
              key={`${candidate.presentedHash}-A`}
              marker="A"
              original={candidate.from}
              value={from}
              plans={data.plans}
              disabled={
                !!candidate.endpointRefs?.from ||
                busy ||
                draftForHash !== candidate.presentedHash ||
                !!candidate.blockedReason
              }
              onChange={(value) => {
                setFrom(value);
                setStage('connection');
                markModified();
              }}
            />
            <CandidatePlan
              key={`${candidate.presentedHash}-B`}
              marker="B"
              original={candidate.to}
              value={to}
              plans={data.plans}
              disabled={
                !!candidate.endpointRefs?.to ||
                busy ||
                draftForHash !== candidate.presentedHash ||
                !!candidate.blockedReason
              }
              onChange={(value) => {
                setTo(value);
                setStage('connection');
                markModified();
              }}
            />
          </div>
        </details>
      )}
      <div className="candidate-decision">
        {!reviewer.trim() && (
          <p className="topology-help">Enter your name or nickname to record an answer.</p>
        )}
        {pointsMissing && (
          <p role="status">
            {floorQuestion
              ? 'You can report whether the elevator serves both floors. To review a route, mark both landings and confirm the direction of travel.'
              : 'Mark the passage on both plans before answering.'}
          </p>
        )}
        {stage === 'connection' ? (
          <div className="candidate-question">
            <h3>
              {floorQuestion
                ? 'Does an elevator in this building serve both floors?'
                : copy.question}
            </h3>
            {!floorQuestion && (
              <p>
                {candidate.endpointRefs?.from && candidate.endpointRefs.to ? (
                  'Both endpoints have been reviewed. Can you walk the entire marked corridor between them?'
                ) : (
                  <>
                    Choosing T also confirms both markers. Edit either location or floor above if
                    necessary.
                  </>
                )}
              </p>
            )}
            <div className="candidate-main-answers">
              <button
                type="button"
                className="topology-button primary"
                disabled={disabled || (pointsMissing && !floorQuestion)}
                onClick={() => {
                  if (floorQuestion) {
                    void answer('true', null);
                    return;
                  }
                  setStage('direction');
                  markModified();
                }}
              >
                {floorQuestion ? floorAnswerLabels.true : answerLabels.true}
              </button>
              <button
                type="button"
                className="topology-button"
                disabled={disabled || (pointsMissing && !floorQuestion)}
                onClick={() => void answer('false', null)}
              >
                {floorQuestion ? floorAnswerLabels.false : answerLabels.false}
              </button>
              <button
                type="button"
                className="topology-button"
                disabled={disabled || (pointsMissing && !floorQuestion)}
                onClick={() => void answer('unknown', null)}
              >
                Unknown · Defer
              </button>
            </div>
          </div>
        ) : (
          <>
            <DirectionQuestion
              disabled={disabled || pointsMissing}
              floorPair={verticalFloors}
              onAnswer={(direction) => void answer('true', direction)}
            />
            <button
              type="button"
              className="topology-button"
              disabled={busy}
              onClick={() => setStage('connection')}
            >
              Back to connection question
            </button>
          </>
        )}
        <details className="candidate-note">
          <summary>Add a note (optional)</summary>
          <textarea
            rows={2}
            maxLength={2000}
            value={note}
            disabled={busy}
            onChange={(event) => {
              setNote(event.target.value);
              markModified();
            }}
            aria-label="Connection review note"
          />
        </details>
        <p className="topology-help">
          Your answer is saved with the markers and reviewer name. Only T with a known direction
          enables routing. This records a user confirmation.
        </p>
        {localError && (
          <p role="alert" className="topology-error">
            {localError}
          </p>
        )}
        {latest && (
          <p className="candidate-saved" role="status">
            Saved answer · {savedAnswerLabel(latest)} · {latest.reviewer} ·{' '}
            {new Date(latest.answeredAt).toLocaleString('en-CA')}
          </p>
        )}
        {modified && (
          <p className="topology-unsaved" role="status">
            You have unsaved changes. Finish answering to save them.
          </p>
        )}
        <div className="topology-actions">
          <button
            className="topology-button"
            type="button"
            disabled={busy || index === 0}
            onClick={() => chooseCandidate(candidates[index - 1].id)}
          >
            Previous candidate
          </button>
          <button
            className="topology-button"
            type="button"
            disabled={busy || index === candidates.length - 1}
            onClick={() => chooseCandidate(candidates[index + 1].id)}
          >
            Next candidate
          </button>
          {candidate.state === 'confirmed' && candidate.latestAnswer && (
            <button
              className="topology-button"
              type="button"
              disabled={busy || modified}
              onClick={() => onRoute(candidate.latestAnswer!)}
            >
              Check this route
            </button>
          )}
        </div>
      </div>
      {!candidate.drawingTrace && !(candidate.endpointRefs?.from && candidate.endpointRefs.to) && (
        <details className="candidate-source-note">
          <summary>Why were these points proposed?</summary>
          <p>{candidate.rationale}</p>
          {candidate.supportingSource && (
            <p>
              <a href={candidate.supportingSource.url} target="_blank" rel="noreferrer">
                {candidate.supportingSource.title} ↗
              </a>
            </p>
          )}
          <p className="topology-help">
            This candidate was prepared from the official plans on {candidate.preparedOn}.
          </p>
        </details>
      )}
      {history.length > 0 && (
        <details className="candidate-source-note">
          <summary>Review history ({history.length})</summary>
          <ol className="topology-history">
            {history.map((item) => (
              <li key={item.id}>
                <strong>{savedAnswerLabel(item)}</strong> · {item.reviewer}
                <time dateTime={item.answeredAt}>
                  {new Date(item.answeredAt).toLocaleString('en-CA')}
                </time>
                <p>
                  {item.from.planId} A → {item.to.planId} B
                </p>
                <p>{item.note}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
