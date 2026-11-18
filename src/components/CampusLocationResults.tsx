import { ArrowUpRight, FileText, MapPin } from 'lucide-react';
import type {
  CampusLocationCandidate,
  CampusPhotoAnalysis,
  PlanLabelReference,
  VisualPlan,
} from '../types';
import { buildingLabel, planLabel } from '../topology';
import { RouteMapImage } from './RouteMap';

export function PlanRegion({
  plan,
  candidate,
  labels = candidate?.sourceLabels ?? [],
}: {
  plan: VisualPlan;
  candidate?: CampusLocationCandidate | null;
  labels?: PlanLabelReference[];
}) {
  const vicinity = candidate?.doorwayVicinity;
  const box = candidate?.bounds;
  return (
    <div
      className="plan-region"
      role="group"
      aria-label={`${plan.building} floor ${plan.floor} source plan${box ? ' with an estimated region highlighted' : ''}`}
    >
      <img
        src={plan.overview.url}
        alt={`Official BCIT ${plan.building} floor ${plan.floor}, page ${plan.page}`}
      />
      {box && (
        <div
          className={vicinity ? 'estimated-region corridor-vicinity' : 'estimated-region'}
          style={{
            left: `${box[0] * 100}%`,
            top: `${box[1] * 100}%`,
            width: `${(box[2] - box[0]) * 100}%`,
            height: `${(box[3] - box[1]) * 100}%`,
          }}
        >
          <span>{vicinity ? 'Possible starting corridor' : 'Possible region'}</span>
        </div>
      )}
      {vicinity && !box && (
        <span
          role="img"
          aria-label={`Reference doorway for room ${vicinity.room}`}
          className="doorway-reference"
          style={{ left: `${vicinity.point.x * 100}%`, top: `${vicinity.point.y * 100}%` }}
        />
      )}
      {labels
        .filter((ref) => ref.planId === plan.id && ref.sourceSha256 === plan.sourceSha256)
        .map((ref) => (
          <span
            className="plan-print-marker"
            role="img"
            key={ref.id}
            aria-label={`Printed plan label ${ref.label}`}
            style={{
              left: `${(ref.bounds[0] + ref.bounds[2]) * 50}%`,
              top: `${(ref.bounds[1] + ref.bounds[3]) * 50}%`,
            }}
          >
            <span>{ref.label}</span>
          </span>
        ))}
    </div>
  );
}

export function CampusLocationResults({
  analysis,
  plans,
}: {
  analysis: CampusPhotoAnalysis;
  plans: VisualPlan[];
  /** Legacy props accepted for old render fixtures; location confirmation is no longer shown. */
  selectedId?: string;
  onConfirm?: (id: string) => void;
  busy?: boolean;
}) {
  const references = analysis.referenceLabels ?? [];
  const labelBased = analysis.method === 'photo-label-retrieval';
  return (
    <section className="campus-results" aria-label="Photo comparison results">
      <h3>
        {labelBased
          ? analysis.candidates.length
            ? 'Estimated starting place'
            : 'Location needs more evidence'
          : analysis.candidates.length
            ? analysis.candidates[0].doorwayVicinity
              ? 'Possible starting corridor'
              : 'Best match'
            : references.length
              ? 'Camera position unresolved'
              : 'No clear match'}
      </h3>
      <p>{analysis.summary}</p>
      {analysis.gpsStatus === 'used' && (
        <p className="helper">Device building matches were checked against the extracted labels.</p>
      )}
      {labelBased && analysis.observations.length > 0 && (
        <details>
          <summary>Extracted photo features</summary>
          <ul>
            {analysis.observations.map((observation, index) => (
              <li key={index}>{observation}</li>
            ))}
          </ul>
        </details>
      )}
      {analysis.usedFallbackModel && <p className="helper">Backup AI model used.</p>}
      {!analysis.candidates.length &&
        plans
          .filter((p) =>
            references.some((r) => r.planId === p.id && r.sourceSha256 === p.sourceSha256),
          )
          .map((plan) => (
            <article className="campus-candidate" key={plan.id}>
              <h3>{planLabel(plan)}</h3>
              <PlanRegion plan={plan} labels={references} />
              <p className="plan-label-legend">
                Blue marks show where the labels are printed on the plan.
              </p>
              <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
                Source PDF ↗
              </a>
            </article>
          ))}
      {analysis.candidates.map((candidate) => {
        const plan = plans.find((plan) => plan.id === candidate.planId);
        if (!plan) return null;
        return (
          <article className="campus-candidate" key={candidate.id}>
            <div className="section-heading">
              <h3>
                <MapPin size={18} />
                {buildingLabel(candidate.building)} · Floor {candidate.floor}
              </h3>
              <span className="pill">
                {candidate.doorwayVicinity ? 'Approximate vicinity' : 'Unverified estimate'}
              </span>
            </div>
            <PlanRegion plan={plan} candidate={candidate} />
            {!!candidate.sourceLabels?.length && (
              <p className="plan-label-legend">
                {candidate.doorwayVicinity
                  ? candidate.bounds
                    ? 'The shaded strip follows the corridor outside the room. The blue mark shows the printed room number.'
                    : 'The orange marker shows the doorway on the plan. The blue mark shows the printed room number.'
                  : labelBased
                    ? 'Blue marks show the matching source labels.'
                    : 'Blue marks show the printed labels. The orange box shows the estimated camera area.'}
              </p>
            )}
            <details>
              <summary>Why this match?</summary>
              <ul className="visual-matches">
                {candidate.matches.map((match, i) => (
                  <li key={i}>
                    <strong>Photo:</strong> {match.photoFeature}
                    <br />
                    <strong>Plan:</strong> {match.planFeature}
                  </li>
                ))}
              </ul>
              <p className="helper">{candidate.limitations.join(' ')}</p>
            </details>
            <details>
              <summary>Source files</summary>
              <div className="plan-source-links">
                <a href={plan.full.url} target="_blank" rel="noreferrer">
                  View full plan
                  <ArrowUpRight size={14} />
                </a>
                <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
                  <FileText size={14} />
                  Source PDF
                </a>
              </div>
              <p className="helper">
                {plan.attribution} · {plan.sourceRef}
              </p>
            </details>
          </article>
        );
      })}
      {analysis.clarification && <p className="clarification-note">{analysis.clarification}</p>}
    </section>
  );
}

/** A repeated sign can be resolved using the same evidence receipt. */
export function StartingPlaceChoices({
  candidates,
  plans,
  onSelect,
  busy,
}: {
  candidates: CampusLocationCandidate[];
  plans: VisualPlan[];
  onSelect: (id: string) => void;
  busy: boolean;
}) {
  return (
    <section className="journey-panel" aria-label="Starting location choices">
      <h2>Which place are you at?</h2>
      {plans.flatMap((plan) => {
        const choices = candidates.filter((c) => c.planId === plan.id);
        if (!choices.length) return [];
        const markers = choices.flatMap((c, i) => {
          const box = c.sourceLabels?.find((ref) => ref.id === c.sourcePlaceId)?.bounds;
          return box
            ? [
                {
                  point: { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 },
                  symbol: String(i + 1),
                  label: c.anchorLabel ?? 'Place',
                },
              ]
            : [];
        });
        return (
          <div key={plan.id}>
            {choices.length > 1 && (
              <RouteMapImage
                plan={plan}
                markers={markers}
                label={'Matching signs on ' + planLabel(plan)}
              />
            )}
            {choices.map((choice, i) => (
              <button
                key={choice.id}
                className="secondary"
                disabled={busy}
                onClick={() => onSelect(choice.id)}
              >
                {planLabel(plan)} · {choice.anchorLabel}
                {choices.length > 1 ? ' · Mark ' + (i + 1) : ''}
              </button>
            ))}
          </div>
        );
      })}
    </section>
  );
}
