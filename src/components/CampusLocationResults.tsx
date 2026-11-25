import { ArrowUpRight, FileText, MapPin } from 'lucide-react';
import type {
  CampusLocationCandidate,
  CampusPhotoAnalysis,
  PlanLabelReference,
  PhotoLabelReading,
  VisualPlan,
} from '../types';
import { buildingLabel, planLabel } from '../topology';

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
  const corridor = !!candidate?.corridorOrigin;
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
          <span>{vicinity || corridor ? 'Possible starting corridor' : 'Possible region'}</span>
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
  readings = [],
  showSummary = true,
  gpsFallbackUsed = false,
  selectedId,
}: {
  analysis: CampusPhotoAnalysis;
  readings?: PhotoLabelReading[];
  showSummary?: boolean;
  gpsFallbackUsed?: boolean;
  plans: VisualPlan[];
  selectedId?: string;
}) {
  const references = analysis.referenceLabels ?? [];
  const labelBased = analysis.method === 'photo-label-retrieval';
  const selected =
    analysis.candidates.find((candidate) => candidate.id === selectedId) ?? analysis.candidates[0];
  const visibleCandidates = selected ? [selected] : analysis.candidates;
  return (
    <section className="campus-results" aria-label="Photo comparison results">
      <h3>
        {selected
          ? 'Likely starting place'
          : labelBased
            ? analysis.candidates.length
              ? 'Estimated starting place'
              : 'Couldn’t match the photo to a source location'
            : analysis.candidates.length
              ? analysis.candidates[0].doorwayVicinity
                ? 'Possible starting corridor'
                : 'Best match'
              : references.length
                ? 'Camera position unresolved'
                : 'No clear match'}
      </h3>
      {showSummary && <p>{analysis.summary}</p>}
      {analysis.gpsStatus === 'used' && (
        <p className="helper">Device building matches were checked against the extracted labels.</p>
      )}
      {analysis.gpsStatus === 'not-used' && gpsFallbackUsed && (
        <p className="helper">
          {analysis.candidates.length > 0
            ? 'GPS was unavailable; matched using photo signs only.'
            : 'GPS was unavailable; searched using photo signs only.'}
        </p>
      )}
      {labelBased && (readings.length > 0 || analysis.observations.length > 0) && (
        <details>
          <summary>Extracted photo features</summary>
          <ul>
            {readings.map((reading, index) => (
              <li key={'reading-' + index}>
                <strong>{reading.text}</strong> ·{' '}
                {reading.placement === 'door'
                  ? 'door sign'
                  : reading.placement === 'directional-sign'
                    ? 'direction sign'
                    : (reading.kind ?? 'sign')}{' '}
                · read as {reading.clarity}
                {reading.directionCue === 'arrow'
                  ? ' · visible arrow'
                  : reading.directionCue === 'directional-words'
                    ? ' · direction wording'
                    : ''}
                {analysis.labelRetrieval.unmatchedLabels?.includes(
                  reading.text.normalize('NFKC').trim().toUpperCase(),
                )
                  ? ' · no floor-plan match'
                  : ''}
              </li>
            ))}
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
      {visibleCandidates.map((candidate) => {
        const plan = plans.find((plan) => plan.id === candidate.planId);
        if (!plan) return null;
        return (
          <article className="campus-candidate" key={candidate.id}>
            <div className="section-heading">
              <h3>
                <MapPin size={18} />
                {buildingLabel(candidate.building)} · Floor {candidate.floor}
                {selected?.anchorLabel && ' · ' + selected.anchorLabel}
              </h3>
              <span className="pill">
                {candidate.doorwayVicinity || candidate.corridorOrigin
                  ? 'Approximate vicinity'
                  : 'Estimated location'}
              </span>
            </div>
            <PlanRegion plan={plan} candidate={candidate} />
            {!!candidate.sourceLabels?.length && (
              <p className="plan-label-legend">
                {candidate.corridorOrigin
                  ? 'The shaded strip marks the shared corridor. Blue marks identify the printed room numbers.'
                  : candidate.doorwayVicinity
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
      {!selected && analysis.clarification && (
        <p className="clarification-note">{analysis.clarification}</p>
      )}
    </section>
  );
}
