export type Activity = {
  id: string;
  at: string;
  tool: string;
  summary: string;
  sourceRefs: string[];
  durationMs?: number;
};
export type PlanImage = {
  file: string;
  url: string;
  width: number;
  height: number;
  sha256: string;
};
export type PlanBounds = [number, number, number, number];
export type VisualPlan = {
  id: string;
  sourceId: string;
  building: string;
  floor: string;
  page: number;
  width: number;
  height: number;
  sourceUrl: string;
  sourceSha256: string;
  sourceRef: string;
  attribution: string;
  full: PlanImage;
  overview: PlanImage;
  tiles: (PlanImage & { id: string; bounds: PlanBounds })[];
  geometry: { file: string; url: string; sha256: string };
  primitiveCount: number;
  longSegmentCount: number;
  labelCount: number;
};
export type PhotoDetailCrop = {
  id: 'nw' | 'ne' | 'sw' | 'se';
  bounds: PlanBounds;
  image: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };
};
export type PhotoLabelReading = {
  text: string;
  clarity: 'clear' | 'uncertain';
  viewId: 'full' | PhotoDetailCrop['id'];
};
export type PhotoEvidence = {
  id: string;
  requestId: string;
  labels: PhotoLabelReading[];
  observations: string[];
  readAt: string;
  expiresAt: string;
  usedFallbackModel: boolean;
};
export type LabelMatch = { observedLabel: string; planLabel: string };
export type VisualFeatureMatch = {
  photoFeature: string;
  planFeature: string;
  kind?: 'architecture' | 'printed-label';
};
export type PlanLabelReference = {
  id: string;
  planId: string;
  sourceSha256: string;
  label: string;
  bounds: PlanBounds;
};
export type CameraRegionIssue =
  | 'label-mismatch'
  | 'region-mismatch'
  | 'appearance-unverified'
  | 'region-too-broad'
  | 'unsupported-identifier'
  | 'no-camera-proposal';
export type CampusLocationCandidate = {
  id: string;
  planId: string;
  sourceRef: string;
  building: string;
  floor: string;
  page: number;
  confidence: 'low' | 'medium' | 'high';
  matches: VisualFeatureMatch[];
  limitations: string[];
  labelMatches: LabelMatch[];
  sourceLabels?: PlanLabelReference[];
  verification: 'unverified-ai-hypothesis';
} & (
  | { bounds: PlanBounds; doorwayVicinity?: undefined }
  | {
      bounds: PlanBounds | null;
      doorwayVicinity: {
        doorId: string;
        room: string;
        point: { x: number; y: number };
        sourceSha256: string;
      };
    }
);
export type CampusPhotoAnalysis = {
  requestId: string;
  outcome: 'candidates' | 'insufficient_evidence';
  observations: string[];
  summary: string;
  clarification: string;
  candidates: CampusLocationCandidate[];
  /** Printed labels can be shown as reference even when no camera region is defensible. */
  referenceLabels?: PlanLabelReference[];
  /** Session-only diagnostics; never includes photo bytes or generated coordinates rejected by grounding. */
  localizationDecision?: {
    cameraIssues: CameraRegionIssue[];
    doorwayOutcome: 'not-offered' | 'no-assessment' | 'no-unique-match' | 'supported';
  };
  atlasPlanCount: number;
  detailedPlanIds: string[];
  buildingHint: string | null;
  method: 'gemini-photo-floorplan';
  evidenceId: string;
  labelRetrieval: { indexedLabels: number; exactMatchPlanIds: string[]; clearLabels: string[] };
  usedFallbackModel: boolean;
  generatedAt: string;
};
export type Session = {
  id: string;
  revision: number;
  mode: 'live';
  activity: Activity[];
  notice: string;
  agentStatus: string;
  providerCalls: number;
  lastTouched: number;
  appliedActions: string[];
  photoEvidence: PhotoEvidence | null;
  campusAnalysis: CampusPhotoAnalysis | null;
  campusLocation: CampusLocationCandidate | null;
};
export type CatalogueRecord = {
  id: string;
  kind: string;
  building: string | null;
  floor: string | null;
  title: string;
  url: string;
  localUrl: string;
  attribution: string;
  sourceRef: string;
  text: string;
  labelCount: number;
  routingSupported: boolean;
};
export type Bootstrap = {
  liveAvailable: boolean;
  model: string;
  setupNotice?: string | null;
  coverage: { floorPlans: number; buildings: string[]; extractedLabelCandidates: number };
  visualPlans: VisualPlan[];
  photoLocalizationAvailable: boolean;
};
