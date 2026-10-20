import { ArrowUpRight, Check, FileText, MapPin } from 'lucide-react';
import type { CampusLocationCandidate, CampusPhotoAnalysis, VisualPlan } from '../types';

export function PlanRegion({
  plan,
  candidate,
}: {
  plan: VisualPlan;
  candidate?: CampusLocationCandidate | null;
}) {
  const box = candidate?.bounds;
  return (
    <div
      className="plan-region"
      aria-label={`${plan.building} floor ${plan.floor} source plan${box ? ' with an estimated region highlighted' : ''}`}
    >
      <img
        src={plan.overview.url}
        alt={`Official BCIT ${plan.building} floor ${plan.floor}, page ${plan.page}`}
      />
      {box && (
        <div
          className="estimated-region"
          style={{
            left: `${box[0] * 100}%`,
            top: `${box[1] * 100}%`,
            width: `${(box[2] - box[0]) * 100}%`,
            height: `${(box[3] - box[1]) * 100}%`,
          }}
        >
          <span>Possible region</span>
        </div>
      )}
    </div>
  );
}

export function CampusLocationResults({
  analysis,
  plans,
  selectedId,
  onConfirm,
  busy,
}: {
  analysis: CampusPhotoAnalysis;
  plans: VisualPlan[];
  selectedId?: string;
  onConfirm: (id: string) => void;
  busy: boolean;
}) {
  return (
    <section className="campus-results" aria-label="Photo comparison results">
      <h3>{analysis.candidates.length ? 'Best match' : 'No clear match'}</h3>
      <p>{analysis.summary}</p>
      {analysis.usedFallbackModel && <p className="helper">Backup Gemini model used.</p>}
      {analysis.candidates.map((candidate) => {
        const plan = plans.find((plan) => plan.id === candidate.planId);
        if (!plan) return null;
        return (
          <article className="campus-candidate" key={candidate.id}>
            <div className="section-heading">
              <h3>
                <MapPin size={18} />
                {candidate.building} · Floor {candidate.floor}
              </h3>
              <span className="pill">Unverified estimate</span>
            </div>
            <PlanRegion plan={plan} candidate={candidate} />
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
            <button
              className="primary full-width"
              disabled={busy || selectedId === candidate.id}
              onClick={() => onConfirm(candidate.id)}
            >
              <Check size={17} />
              {selectedId === candidate.id ? 'Region selected' : 'Confirm this possible region'}
            </button>
          </article>
        );
      })}
      {analysis.clarification && <p className="clarification-note">{analysis.clarification}</p>}
      <p className="helper">
        AI estimate only. Confirm it against your surroundings; walking routes are not available.
      </p>
    </section>
  );
}
