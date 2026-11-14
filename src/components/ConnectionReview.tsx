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
  unanswered: '미답변',
  confirmed: '사용자 확인 완료',
  rejected: 'F · 후보 기각',
  deferred: '모름 · 보류',
  'needs-review': '변경됨 · 다시 확인',
  'needs-direction': '통행 방향 미확인',
  'needs-points': '정차 제보 · 승강장 위치 미확인',
};
const directionLabels = {
  both: '양방향 A ↔ B',
  'a-to-b': 'A → B만',
  'b-to-a': 'B → A만',
  unknown: '모름',
};
const answerLabels = { true: 'T · 연결됨', false: 'F · 연결 안 됨', unknown: '모름 · 보류' };
const floorAnswerLabels = {
  true: 'T · 두 층에 정차',
  false: 'F · 해당 없음',
  unknown: '모름 · 보류',
};

function savedAnswerLabel(entry: CandidateAnswer | FloorObservation): string {
  if (!('direction' in entry)) return `${floorAnswerLabels[entry.answer]} · 층 단위 응답`;
  const label = answerLabels[entry.answer];
  return entry.direction ? `${label} · ${directionLabels[entry.direction]}` : label;
}

const questionByKind = {
  stairs: { title: '계단 후보', question: '표시된 A와 B 사이를 같은 계단으로 오갈 수 있나요?' },
  elevator: {
    title: '엘리베이터 후보',
    question: '같은 엘리베이터가 A와 B 두 층에 모두 정차하나요?',
  },
  outdoor: {
    title: '실외 이동 후보',
    question: '표시된 A·B 출입문 사이를 실외로 걸어갈 수 있나요?',
  },
  corridor: { title: '복도 후보', question: '표시된 A와 B가 같은 층의 복도로 이어져 있나요?' },
  'building-link': { title: '연결 후보', question: '표시된 A와 B가 이 연결통로로 이어져 있나요?' },
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
  if (!plan || !a || !b) return <p role="alert">복도 양 끝의 도면을 읽을 수 없습니다.</p>;
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
      aria-label="복도 양 끝이 표시된 도면"
    >
      <div className="candidate-plan-heading">
        <h3>{planLabel(plan)}</h3>
        <button
          type="button"
          className="topology-button"
          onClick={() => setFullPage((current) => !current)}
        >
          {fullPage ? '복도 확대' : '전체 도면'}
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
        aria-label={`${candidate.from.label}에서 ${candidate.to.label}까지의 복도 검수`}
      >
        <image href={plan.full.url} x={0} y={0} width={plan.width} height={plan.height} />
        {trace && (
          <polyline
            aria-label="검수할 복도 구간"
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
        <p>표시 위치가 바뀌었습니다. 변경된 지점의 경로선을 다시 검수해야 합니다.</p>
      )}
      <div className="topology-plan-footer">
        <span>{plan.attribution}</span>
        <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
          원본 BCIT PDF ↗
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
  if (!plan) return <p role="alert">이 지점의 공식 도면을 찾을 수 없습니다.</p>;
  const bounds = candidateFocusBounds(value.point, fullPage);
  const width = (bounds[2] - bounds[0]) * plan.width,
    height = (bounds[3] - bounds[1]) * plan.height;
  return (
    <section className="candidate-plan" aria-label={`${marker} 지점 도면`}>
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
          {fullPage && value.point ? '지점 확대' : '전체 도면'}
        </button>
      </div>
      <p className="candidate-point-name">{original.label}</p>
      <svg
        viewBox={`${bounds[0] * plan.width} ${bounds[1] * plan.height} ${width} ${height}`}
        width={width}
        height={height}
        className={`candidate-drawing ${editing ? 'is-editing' : ''}`}
        role="img"
        aria-label={`${planLabel(plan)}의 ${marker} 후보 지점`}
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
          : '원래 후보와 다른 층입니다. 수정한 도면에서 실제 통행 지점을 새로 확인해주세요.'}
      </p>
      <div className="topology-actions">
        <button
          type="button"
          className="topology-button"
          disabled={disabled}
          aria-expanded={editing}
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? '위치 수정 닫기' : `${marker} 위치·층 수정`}
        </button>
        <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
          원본 BCIT PDF ↗
        </a>
      </div>
      {editing && (
        <fieldset disabled={disabled} className="candidate-position-fields">
          <legend>{marker} 표시가 틀린 경우 수정</legend>
          <label>
            실제 층
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
            도면의 실제 지점을 눌러주세요. 층을 바꾸면 위치를 새로 지정해야 합니다.
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
        both: `양방향 ${floorPair.from}층 ↔ ${floorPair.to}층`,
        'a-to-b': `A → B만 (${floorPair.from}층 → ${floorPair.to}층)`,
        'b-to-a': `B → A만 (${floorPair.to}층 → ${floorPair.from}층)`,
        unknown: '모름',
      }
    : directionLabels;
  return (
    <div className="candidate-question">
      <h3>어느 방향으로 통과할 수 있나요?</h3>
      <p>직접 알고 있는 방향을 선택하세요. 모름은 연결 기록만 남기고 경로에서 제외합니다.</p>
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
    if (busy || (modified && !window.confirm('저장하지 않은 위치 수정이나 답변을 버릴까요?')))
      return;
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
        '답변이 저장되지 않았습니다. 위 오류를 확인하고, 충돌이 있으면 새로고침 후 다시 답해주세요.',
      );
  }
  if (!candidate || !from || !to)
    return (
      <section className="candidate-workspace">
        <h2>확인할 후보가 없습니다.</h2>
        <p>
          공식 도면에서 근거가 있는 후보를 준비하면 여기에 표시됩니다. 임의의 연결을 생성하지
          않습니다.
        </p>
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
    <section className="candidate-workspace" aria-label="연결 후보 확인">
      <div className="candidate-introduction">
        <h2>두 지점을 보고 T · F · 모름으로 답해주세요.</h2>
        <p>
          사진은 필요 없습니다. 표시된 건물·층·위치가 맞는지 확인한 뒤 연결 여부를 답하면 됩니다.
        </p>
      </div>
      <div className="candidate-toolbar">
        <label>
          확인할 연결 ({index + 1}/{candidates.length})
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
          확인자 이름 또는 별명 — 한 번 입력
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
        <p role="status">먼저 이 복도 양 끝의 출입문과 승강장 지점을 확인해주세요.</p>
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
          <summary>각 지점 확대 및 위치·층 수정</summary>
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
          <p className="topology-help">답변을 남길 이름 또는 별명을 먼저 입력하세요.</p>
        )}
        {pointsMissing && (
          <p role="status">
            {floorQuestion
              ? '여기서는 두 층에 정차하는지만 답할 수 있습니다. 승강문 위치를 아시면 두 도면에 찍고 통행 방향까지 확인해주세요.'
              : '답변하기 전에 두 도면의 실제 지점을 표시해주세요.'}
          </p>
        )}
        {stage === 'connection' ? (
          <div className="candidate-question">
            <h3>
              {floorQuestion
                ? '이 건물 안에서 두 층에 모두 정차하는 엘리베이터가 있나요?'
                : copy.question}
            </h3>
            {!floorQuestion && (
              <p>
                {candidate.endpointRefs?.from && candidate.endpointRefs.to ? (
                  '두 표시는 이미 확인한 지점입니다. 그 사이의 복도 전체를 통과할 수 있는지 답해주세요.'
                ) : (
                  <>
                    T는 양쪽 표시 위치도 맞다는 확인입니다. 틀린 위치는 위의 ‘위치·층 수정’에서
                    고쳐주세요.
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
                모름 · 보류
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
              연결 여부 질문으로 돌아가기
            </button>
          </>
        )}
        <details className="candidate-note">
          <summary>메모 추가 (선택)</summary>
          <textarea
            rows={2}
            maxLength={2000}
            value={note}
            disabled={busy}
            onChange={(event) => {
              setNote(event.target.value);
              markModified();
            }}
            aria-label="후보 확인 메모"
          />
        </details>
        <p className="topology-help">
          답변과 표시 위치·확인자를 함께 저장합니다. T와 확인된 통행 방향만 경로에 반영됩니다.
          ‘사용자 확인’으로 기록하며 현장 방문이나 거리 측정을 자동으로 주장하지 않습니다.
        </p>
        {localError && (
          <p role="alert" className="topology-error">
            {localError}
          </p>
        )}
        {latest && (
          <p className="candidate-saved" role="status">
            저장된 답변 · {savedAnswerLabel(latest)} · {latest.reviewer} ·{' '}
            {new Date(latest.answeredAt).toLocaleString()}
          </p>
        )}
        {modified && (
          <p className="topology-unsaved" role="status">
            아직 저장되지 않은 선택이 있습니다. 답변을 마치면 함께 저장됩니다.
          </p>
        )}
        <div className="topology-actions">
          <button
            className="topology-button"
            type="button"
            disabled={busy || index === 0}
            onClick={() => chooseCandidate(candidates[index - 1].id)}
          >
            이전 후보
          </button>
          <button
            className="topology-button"
            type="button"
            disabled={busy || index === candidates.length - 1}
            onClick={() => chooseCandidate(candidates[index + 1].id)}
          >
            다음 후보
          </button>
          {candidate.state === 'confirmed' && candidate.latestAnswer && (
            <button
              className="topology-button"
              type="button"
              disabled={busy || modified}
              onClick={() => onRoute(candidate.latestAnswer!)}
            >
              이 연결의 경로 확인
            </button>
          )}
        </div>
      </div>
      {!candidate.drawingTrace && !(candidate.endpointRefs?.from && candidate.endpointRefs.to) && (
        <details className="candidate-source-note">
          <summary>왜 이 두 지점을 후보로 제안했나요?</summary>
          <p>{candidate.rationale}</p>
          {candidate.supportingSource && (
            <p>
              <a href={candidate.supportingSource.url} target="_blank" rel="noreferrer">
                {candidate.supportingSource.title} ↗
              </a>
            </p>
          )}
          <p className="topology-help">
            공식 도면을 읽고 준비한 미검수 후보입니다. 후보 제안일: {candidate.preparedOn}. 사진
            분석이나 자동 건물 연결은 사용하지 않았습니다.
          </p>
        </details>
      )}
      {history.length > 0 && (
        <details className="candidate-source-note">
          <summary>답변 이력 ({history.length})</summary>
          <ol className="topology-history">
            {history.map((item) => (
              <li key={item.id}>
                <strong>{savedAnswerLabel(item)}</strong> · {item.reviewer}
                <time dateTime={item.answeredAt}>{new Date(item.answeredAt).toLocaleString()}</time>
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
