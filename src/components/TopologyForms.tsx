import { useState, type FormEvent } from 'react';
import type { VisualPlan } from '../types';
import {
  pointKinds,
  pointKindLabels,
  connectionKinds,
  connectionKindLabels,
  planLabel,
  reviewStatus,
  type NodeDraft,
  type EdgeDraft,
  type TopologyEvidence,
  type TopologyRecord,
  type TopologyNode,
  type TopologyCommand,
} from '../topology';

function submit(event: FormEvent, action: () => void) {
  event.preventDefault();
  action();
}

export function EvidenceFields({
  value,
  onChange,
}: {
  value: TopologyEvidence;
  onChange: (value: TopologyEvidence) => void;
}) {
  return (
    <fieldset className="topology-evidence">
      <legend>Connection or point evidence</legend>
      <label>
        Evidence basis
        <select
          value={value.basis}
          onChange={(event) =>
            onChange({ ...value, basis: event.target.value as TopologyEvidence['basis'] })
          }
        >
          <option value="plan">Official plan review</option>
          <option value="field">Field observation</option>
          <option value="plan-and-field">Plan and field observation</option>
          <option value="user-confirmation">User confirmation — no field visit asserted</option>
        </select>
      </label>
      {['field', 'plan-and-field'].includes(value.basis) && (
        <label>
          Observed on
          <input
            type="date"
            value={value.observedOn ?? ''}
            onChange={(event) => onChange({ ...value, observedOn: event.target.value || null })}
          />
        </label>
      )}
      <label>
        What supports this record?
        <textarea
          rows={4}
          maxLength={3000}
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
          placeholder="Identify the doorway or passage, the actual arrival floor, and what you checked. For a two-way connection, check both directions."
        />
      </label>
      <p className="topology-help">
        Official source references are attached to the points. Record field observations in text; no
        photos are stored.
      </p>
    </fieldset>
  );
}

export function NodeForm({
  value,
  busy,
  onChange,
  onSave,
  onMove,
  onDelete,
}: {
  value: NodeDraft;
  busy: boolean;
  onChange: (value: NodeDraft) => void;
  onSave: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <form onSubmit={(event) => submit(event, onSave)}>
      <fieldset disabled={busy}>
        <legend>{value.id ? 'Edit point' : 'New point'}</legend>
        <label>
          Point label
          <input
            required
            maxLength={120}
            value={value.label}
            onChange={(event) => onChange({ ...value, label: event.target.value })}
            placeholder="Exact room label or a descriptive doorway name"
          />
        </label>
        <label>
          Point type
          <select
            value={value.kind}
            onChange={(event) =>
              onChange({ ...value, kind: event.target.value as NodeDraft['kind'] })
            }
          >
            {pointKinds.map((kind) => (
              <option key={kind} value={kind}>
                {pointKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <div className="topology-two-fields">
          {(['x', 'y'] as const).map((axis) => (
            <label key={axis}>
              {axis.toUpperCase()} (% of page)
              <input
                type="number"
                min={0}
                max={100}
                step="any"
                required
                value={Number((value.point[axis] * 100).toFixed(4))}
                onChange={(event) =>
                  onChange({
                    ...value,
                    point: { ...value.point, [axis]: Number(event.target.value) / 100 },
                  })
                }
              />
            </label>
          ))}
        </div>
        <button className="topology-button" type="button" onClick={onMove}>
          Reposition on plan
        </button>
        <label>
          Point notes
          <textarea
            rows={2}
            maxLength={2000}
            value={value.notes}
            onChange={(event) => onChange({ ...value, notes: event.target.value })}
          />
        </label>
        <EvidenceFields
          value={value.evidence}
          onChange={(evidence) => onChange({ ...value, evidence })}
        />
        <p className="topology-help">
          Saving returns this point and its connected passages to draft. Review them again before
          routing.
        </p>
        <div className="topology-actions">
          <button className="topology-button primary" type="submit">
            Save point as draft
          </button>
          {value.id && (
            <button className="topology-button danger" type="button" onClick={onDelete}>
              Delete point
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function pointDescription(node: TopologyNode, plans: VisualPlan[]) {
  const plan = plans.find((item) => item.id === node.planId);
  return `${plan ? planLabel(plan) : node.planId} / ${node.label} · ${node.id.slice(0, 6)}`;
}
export function EdgeForm({
  value,
  nodes,
  plans,
  busy,
  picking,
  onChange,
  onSave,
  onDelete,
  onPick,
  onShow,
}: {
  value: EdgeDraft;
  nodes: TopologyNode[];
  plans: VisualPlan[];
  busy: boolean;
  picking: 'from' | 'to' | null;
  onChange: (value: EdgeDraft) => void;
  onSave: () => void;
  onDelete: () => void;
  onPick: (endpoint: 'from' | 'to') => void;
  onShow: (nodeId: string) => void;
}) {
  return (
    <form onSubmit={(event) => submit(event, onSave)}>
      <fieldset disabled={busy}>
        <legend>{value.id ? 'Edit connection' : 'New connection'}</legend>
        {(['from', 'to'] as const).map((endpoint) => {
          const field = endpoint === 'from' ? 'fromNodeId' : 'toNodeId';
          return (
            <div key={endpoint} className="topology-endpoint">
              <label>
                {endpoint === 'from' ? 'From point' : 'To point'}
                <select
                  required
                  value={value[field]}
                  onChange={(event) => onChange({ ...value, [field]: event.target.value })}
                >
                  <option value="">Select a saved point</option>
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {pointDescription(node, plans)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="topology-actions">
                <button
                  type="button"
                  className="topology-button"
                  aria-pressed={picking === endpoint}
                  onClick={() => onPick(endpoint)}
                >
                  Pick {endpoint} on plan
                </button>
                <button
                  type="button"
                  className="topology-button"
                  disabled={!value[field]}
                  onClick={() => onShow(value[field])}
                >
                  Show point
                </button>
              </div>
            </div>
          );
        })}
        <label>
          Passage type
          <select
            value={value.kind}
            onChange={(event) =>
              onChange({ ...value, kind: event.target.value as EdgeDraft['kind'] })
            }
          >
            {connectionKinds.map((kind) => (
              <option key={kind} value={kind}>
                {connectionKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Permitted direction
          <select
            value={value.direction}
            onChange={(event) =>
              onChange({ ...value, direction: event.target.value as EdgeDraft['direction'] })
            }
          >
            <option value="both">Both directions — verify both</option>
            <option value="forward">From → To only</option>
          </select>
        </label>
        <label>
          Passage notes
          <textarea
            rows={3}
            maxLength={2000}
            value={value.notes}
            onChange={(event) => onChange({ ...value, notes: event.target.value })}
            placeholder="Describe the passage between these points and any known restrictions."
          />
        </label>
        <EvidenceFields
          value={value.evidence}
          onChange={(evidence) => onChange({ ...value, evidence })}
        />
        <details className="topology-distance">
          <summary>Optional measured distance</summary>
          <label>
            Passage distance (m)
            <input
              type="number"
              min={0.01}
              max={10000}
              step="any"
              value={value.distanceMeters ?? ''}
              onChange={(event) =>
                onChange({
                  ...value,
                  distanceMeters: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Measurement method and source
            <textarea
              rows={2}
              maxLength={1000}
              value={value.distanceEvidence}
              onChange={(event) => onChange({ ...value, distanceEvidence: event.target.value })}
              placeholder="Leave distance empty until measured. Page pixels are not metres."
            />
          </label>
        </details>
        <p className="topology-help">
          Saving clears the current connection approval. No accessibility or live opening status is
          inferred.
        </p>
        <div className="topology-actions">
          <button type="submit" className="topology-button primary" disabled={nodes.length < 2}>
            Save connection as draft
          </button>
          {value.id && (
            <button type="button" className="topology-button danger" onClick={onDelete}>
              Delete connection
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function ReviewPanel({
  record,
  target,
  issue,
  disabled,
  reviewer,
  onReviewer,
  onReview,
}: {
  record: TopologyRecord;
  target: 'node' | 'edge';
  issue?: string;
  disabled: boolean;
  reviewer: string;
  onReviewer: (value: string) => void;
  onReview: (command: Extract<TopologyCommand, { type: 'review' }>) => void;
}) {
  const [note, setNote] = useState('');
  const ready = !disabled && reviewer.trim().length > 0 && note.trim().length > 0;
  function review(status: 'draft' | 'verified' | 'rejected') {
    if (ready) onReview({ type: 'review', target, id: record.id, status, reviewer, note });
  }
  return (
    <section className="topology-review" aria-label="Record review">
      <h3>
        Review{' '}
        <span className={`topology-badge ${reviewStatus(record)}`}>{reviewStatus(record)}</span>
      </h3>
      {issue && <p className="topology-help">Excluded from routing: {issue}</p>}
      {disabled && (
        <p className="topology-help">Save or discard edits before reviewing the saved record.</p>
      )}
      <label>
        Reviewer name
        <input
          maxLength={100}
          value={reviewer}
          onChange={(event) => onReviewer(event.target.value)}
          disabled={disabled}
        />
      </label>
      <label>
        Review decision and checks
        <textarea
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={disabled}
          placeholder="Confirm the exact endpoints, arrival floors and permitted direction. State any remaining limitations."
        />
      </label>
      <div className="topology-actions">
        <button
          type="button"
          className="topology-button primary"
          disabled={!ready}
          onClick={() => review('verified')}
        >
          Approve for routing
        </button>
        <button
          type="button"
          className="topology-button"
          disabled={!ready}
          onClick={() => review('draft')}
        >
          Return to draft
        </button>
        <button
          type="button"
          className="topology-button danger"
          disabled={!ready}
          onClick={() => review('rejected')}
        >
          Reject
        </button>
      </div>
      <p className="topology-help">
        Approval records your review. A plan review does not claim that the passage was checked on
        campus.
      </p>
      {record.reviewHistory.length > 0 && (
        <details>
          <summary>Review history ({record.reviewHistory.length})</summary>
          <ol className="topology-history">
            {[...record.reviewHistory].reverse().map((review, index) => (
              <li key={index}>
                <strong>{review.status}</strong> · {review.reviewer} · record v
                {review.recordVersion}
                <time dateTime={review.reviewedAt}>
                  {new Date(review.reviewedAt).toLocaleString()}
                </time>
                <p>{review.note}</p>
                <p className="topology-help">
                  Evidence ({review.evidence.basis}): {review.evidence.note}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
