import { ArrowUpRight, Camera, FileText, MapPin } from 'lucide-react';
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
}: {
  analysis: CampusPhotoAnalysis;
  plans: VisualPlan[];
}) {
  return (
    <section className="campus-results" aria-label="Photo comparison results">
      <h2>{analysis.candidates.length ? 'Estimated location' : 'No clear match'}</h2>
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
              <span className="pill">AI estimate</span>
            </div>
            <PlanRegion plan={plan} candidate={candidate} />
            <a className="directions-source" href={plan.sourceUrl} target="_blank" rel="noreferrer">
              <FileText size={14} />
              Source plan
              <ArrowUpRight size={14} />
            </a>
          </article>
        );
      })}
      {!analysis.candidates.length && <p>{analysis.clarification || analysis.summary}</p>}
    </section>
  );
}

export function PhotoEmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="photo-empty-state">
      <Camera size={29} />
      <h2>Location result</h2>
      <p>Upload a photo to get a location estimate.</p>
      <button className="primary" onClick={onUpload}>
        <Camera size={18} />
        Find my location
      </button>
    </div>
  );
}
