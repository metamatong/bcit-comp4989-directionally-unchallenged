import { ArrowUpRight, Camera, Check, FileJson, FileText, MapPin } from 'lucide-react';
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
      <p className="eyebrow">PHOTO + OFFICIAL BCIT FLOOR PLANS</p>
      <h3>
        {analysis.candidates.length
          ? 'Possible locations to review'
          : 'More visual evidence is needed'}
      </h3>
      <p>{analysis.summary}</p>
      <p className="helper">
        {analysis.atlasPlanCount} plan previews considered · {analysis.detailedPlanIds.length} plans
        inspected in detail. The shortlist is not an exhaustive detailed comparison.
      </p>
      <details>
        <summary>What Gemini observed in the photo</summary>
        <ul>
          {analysis.observations.map((observation, i) => (
            <li key={i}>{observation}</li>
          ))}
        </ul>
      </details>
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
              <span className="pill">{candidate.confidence} confidence*</span>
            </div>
            <PlanRegion plan={plan} candidate={candidate} />
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
            <div className="plan-source-links">
              <a href={plan.full.url} target="_blank" rel="noreferrer">
                Full PNG
                <ArrowUpRight size={14} />
              </a>
              <a href={plan.geometry.url} target="_blank" rel="noreferrer">
                <FileJson size={14} />
                Geometry JSON
              </a>
              <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
                <FileText size={14} />
                Original PDF
              </a>
            </div>
            <p className="helper">
              {plan.attribution} · {plan.sourceRef}
            </p>
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
      {analysis.clarification && (
        <div className="clarification-note">
          <Camera size={19} />
          <p>{analysis.clarification}</p>
        </div>
      )}
      <p className="helper">
        *Model confidence is qualitative and uncalibrated. These are unverified location hypotheses,
        not measured camera positions. Real campus walking routes are not yet supported.
      </p>
    </section>
  );
}

export function CampusPhotoWelcome({
  planCount,
  onUpload,
}: {
  planCount: number;
  onUpload: () => void;
}) {
  return (
    <div className="campus-photo-welcome">
      <span className="modal-icon">
        <Camera size={29} />
      </span>
      <p className="eyebrow">FIND YOUR PLACE ON CAMPUS</p>
      <h2>Let the photo tell the story.</h2>
      <p>
        Gemini compares your actual photo with official BCIT Burnaby floor plans and their extracted
        geometry. Readable signs are optional.
      </p>
      <div className="visual-flow">
        <span>1 · Your photo</span>
        <span>2 · {planCount} real plans</span>
        <span>3 · Possible regions</span>
      </div>
      <button className="primary" onClick={onUpload}>
        <Camera size={18} />
        Upload a campus photo
      </button>
      <p className="helper">
        You choose when to send the photo to Google. If the scene is ambiguous, the app will ask for
        another view.
      </p>
    </div>
  );
}
