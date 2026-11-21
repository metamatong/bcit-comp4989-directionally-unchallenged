/** Transient device evidence and source-bound drawing alignment. */
export type GeoPoint = { latitude: number; longitude: number };
export type DeviceReading = GeoPoint & {
  accuracy: number;
  timestamp: number;
  receivedAt: number;
};
export type CalibrationControl = GeoPoint & { label: string; x: number; y: number };
export type FloorCalibration = {
  planId: string;
  sourceSha256: string;
  status: 'approximate' | 'unavailable';
  method?: 'manual-corners' | 'stacked-features';
  reason: string;
  version: string;
  controls: CalibrationControl[];
  residualsMetres: number[];
  heldOutMetres: number | null;
};
export type LocationCatalogue = {
  geographicSource: { url: string; retrievedAt: string; file: string; sha256: string };
  buildings: { building: string; rings: number[][][] }[];
  floors: FloorCalibration[];
};
export type PhotoReading = { submission: number; reading: DeviceReading };
export type GpsBuildingHint = {
  buildings: string[];
  sourceSha256: string;
  capturedAt: number;
  accuracy: number;
};
export type DeviceOverlay = {
  point: { x: number; y: number };
  radiusX: number;
  radiusY: number;
  /** Set when indoor map-matching pulled the raw reading onto a nearby corridor. */
  snapDistanceMetres?: number;
};
