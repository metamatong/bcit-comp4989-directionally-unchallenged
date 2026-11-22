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
  kind?: 'room' | 'building' | 'floor' | 'landmark';
  placement?: 'door' | 'directional-sign' | 'other' | 'unknown';
  directionCue?: 'arrow' | 'directional-words' | 'none' | 'unclear';
};
export type PhotoFeatures = {
  visibleDoorCount: number | null;
  windowsSide: 'left' | 'right' | 'both' | 'not-visible' | 'unknown';
  corridorShape: 'straight' | 'turn' | 'junction' | 'unknown';
};
export type PhotoEvidence = {
  id: string;
  requestId: string;
  labels: PhotoLabelReading[];
  observations: string[];
  features?: PhotoFeatures;
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
  /** Exact source label used to identify this place; it is not a doorway or camera position. */
  anchorLabel?: string;
  sourcePlaceId?: string;
  /** Public corridor reference derived from these exact source occurrences. The reference is not a camera pose. */
  corridorOrigin?: {
    bandId: string;
    roomPlaceIds: string[];
    roomLabels: string[];
    needsConfirmation: boolean;
  };
  verification: 'unverified-ai-hypothesis';
} & (
  | { bounds: PlanBounds | null; doorwayVicinity?: undefined }
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
  method:
    | 'gemini-photo-floorplan'
    | 'openai-photo-floorplan'
    | 'groq-photo-floorplan'
    | 'photo-label-retrieval';
  gpsStatus?: 'used' | 'conflict' | 'outside-pilot' | 'not-used' | 'building-only';
  deviceBuildings?: string[];
  evidenceId: string;
  labelRetrieval: {
    indexedLabels: number;
    exactMatchPlanIds: string[];
    clearLabels: string[];
    unmatchedLabels?: string[];
    partial?: boolean;
  };
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
export type DestinationSuggestion = {
  value: string;
  building: string;
  floor: string;
  label: string;
  kind: string;
};
export type Bootstrap = {
  provider?: import('./ai-provider').AiProviderName;
  gpsTestMode?: boolean;
  locationCatalogue?: import('./location/types').LocationCatalogue;
  locationNotice?: string;
  liveAvailable: boolean;
  model: string;
  setupNotice?: string | null;
  coverage: { floorPlans: number; buildings: string[]; extractedLabelCandidates: number };
  visualPlans: VisualPlan[];
  destinations?: DestinationSuggestion[];
  photoLocalizationAvailable: boolean;
};
