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
export type TrackingMode = 'raw' | 'matched' | 'motion-gated' | 'pdr' | 'pdr-bridged';

export type DeviceOverlay = {
  point: { x: number; y: number };
  radiusX: number;
  radiusY: number;
  /** Set when indoor map-matching pulled the raw reading onto a nearby corridor. */
  snapDistanceMetres?: number;
  /** Fusion tier indicator for honest status labeling and tests; never persisted or transmitted. */
  trackingMode?: TrackingMode;
};

export type MotionPermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported';

/** Explicitly separates verified live stillness from a silent or paused sensor stream. */
export type MotionActivityState = 'unknown' | 'stationary' | 'moving';

/** Raw DeviceMotion sample preserving native rotationRate property names (deg/s) and accel (m/s^2). */
export type RawMotionSample = {
  ax: number;
  ay: number;
  az: number;
  /** Raw DeviceMotionEvent.rotationRate.alpha (W3C/Chromium: X axis, deg/s). */
  rotAlpha?: number | null;
  /** Raw DeviceMotionEvent.rotationRate.beta (W3C/Chromium: Y axis, deg/s). */
  rotBeta?: number | null;
  /** Raw DeviceMotionEvent.rotationRate.gamma (W3C/Chromium: Z axis, deg/s). */
  rotGamma?: number | null;
  timestamp: number;
};

/** Isolated platform sensor convention; never inferred solely from requestPermission() presence. */
export type SensorConvention = {
  /** W3C / Chromium standard is 'xyz' (alpha=X, beta=Y, gamma=Z). */
  rotationAxisOrder: 'xyz' | 'zxy';
  /** +1 when flat face-up accelIncludingGravity.z is +9.81 (W3C/Android); -1 when -9.81 (CoreMotion). */
  gravitySign: 1 | -1;
};

export type DetectedStep = {
  stepIndex: number;
  stepLengthMetres: number;
  /** World counter-clockwise yaw accumulated since the prior step (radians; left turn > 0). */
  deltaYawRad: number;
  hasGyro: boolean;
  /** Extra heading uncertainty (radians) from non-yaw phone tilting/handling between steps. */
  turnNoiseRad: number;
  timestamp: number;
};

export type MotionSnapshot = {
  supported: boolean;
  permission: MotionPermissionState;
  active: boolean;
  hasAccel: boolean;
  hasGyro: boolean;
  gyroFresh: boolean;
  /** Start of the current uninterrupted gyroscope stream. */
  gyroFreshSince: number | null;
  /** 'unknown' until fresh samples populate the window or whenever samples stall (>1.5 s). */
  activity: MotionActivityState;
  stepCount: number;
  estimatedDistanceMetres: number;
  lastStepAt: number | null;
  lastEventAt: number | null;
};
