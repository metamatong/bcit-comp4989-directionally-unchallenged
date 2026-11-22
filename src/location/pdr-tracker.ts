/**
 * Hybrid indoor localization tracker fusing browser GPS/Wi-Fi, verified public floor corridors,
 * and transient inertial motion estimates across three automatic hardware tiers:
 *   Tier 1: GPS-only corridor map-matching (or raw outdoor footprint gating)
 *   Tier 2 (Stage 1): Accel-only hard stationary anchor + step-budgeted walking continuity
 *   Tier 3 (Stage 2, gated): 120-particle corridor-constrained PDR + GPS filter
 *
 * All state stays strictly in active browser memory.
 */
import type { VisualPlan } from '../types';
import type { PagePoint, WalkingStep, WalkingSurface } from '../wayfinding';
import { LOCATION_FRESH_MS } from './browser-location';
import { fitCalibration } from './geometry';
import {
  MAP_MATCH_CONFIG,
  matchDeviceToFloor,
  type MapMatchResult,
  type PreviousMatch,
} from './map-matching';
import type {
  DetectedStep,
  DeviceOverlay,
  DeviceReading,
  FloorCalibration,
  MotionActivityState,
  MotionSnapshot,
  TrackingMode,
} from './types';
import { getWalkableGrid, type WalkableGrid } from './walkable-grid';

/**
 * Explicit Stage 2 rollout gate.
 * Keep false in the live app until physical Android Chrome + iOS Safari turn tests confirm
 * raw rotationRate axis order and gravity polarity; unit tests and benchmarks enable it explicitly.
 */
export const PARTICLE_PDR_ENABLED = false;

export const PDR_TRACKER_CONFIG = Object.freeze({
  particleCount: 120,
  gpsSigmaFloorMetres: 10.0,
  stationaryGpsSigmaFloorMetres: 16.0,
  stationaryGpsSigmaScale: 2.0,
  stepLengthNoiseFrac: 0.16,
  baseHeadingNoiseRad: 0.12,
  turnProportionalNoise: 0.15,
  maxStepHeadingNoiseRad: 0.55,
  /** Sharp single-step yaw threshold above which a small straight-ahead hedge protects against phone-only twists. */
  phoneTwistThresholdRad: (40 * Math.PI) / 180,
  phoneTwistHedgeFraction: 0.15,
  phoneTwistHedgeNoiseRad: 0.25,
  wallClearWeight: 1.0,
  wallSlideWeight: 0.55,
  wallBlockedWeight: 0.02,
  resampleNeffRatio: 0.5,
  resamplePosJitterMetres: 0.15,
  resampleHeadingJitterRad: (3 * Math.PI) / 180,
  maxBridgeMs: 15_000,
  maxBridgeSteps: 20,
  bridgeStepGrowthMetres: 0.35,
  bridgeTimeGrowthMetresPerSec: 0.25,
  stationaryDivergenceMetres: 12.0,
  stationaryDivergenceFixes: 3,
  stationaryAgreementMetres: 5.0,
  particleDivergenceMetres: 14.0,
  particleDivergenceFixes: 3,
  particleReseedFraction: 0.35,
  particleHardResetMetres: 26.0,
  clusterRadiusMetres: 6.0,
  minResolvedWeightShare: 0.65,
  /** Circular resultant length of particle headings; ~0 on 50/50 opposite hallway splits, ~0.85+ when converged. */
  minResolvedHeadingResultant: 0.55,
  maxResolvedModeSeparationMetres: 8.0,
  plausibleModeWeightThreshold: 0.2,
  anchorStepSeedMaxDistMetres: 12.0,
  anchorSeedFraction: 0.25,
  corridorProbeMetres: 3.0,
  routeTieBreakWeight: MAP_MATCH_CONFIG.routeTieBreakWeight,
  routeTieBreakCapMetres: MAP_MATCH_CONFIG.routeTieBreakCapMetres,
});

export type TrackerContext = {
  plan: VisualPlan;
  calibration?: FloorCalibration;
  surface?: WalkingSurface | null;
  stepKind?: WalkingStep['kind'];
  transferStepIndex?: number;
  /** True only for single-floor corridor steps (step.from.planId === step.to.planId). */
  isSamePlanStep: boolean;
  routePath?: PagePoint[];
  stepStartPoint?: PagePoint;
};

export type TrackerEvaluation =
  | { status: 'waiting' | 'unavailable' | 'low-accuracy' | 'outside-page' | 'too-far' }
  | { status: 'raw' | 'matched' | 'bridged'; overlay: DeviceOverlay; directionResolved?: boolean };

type Particle = {
  xPx: number;
  yPx: number;
  headingPx: number;
  weight: number;
};

type ClusterSummary = {
  centroidPx: PagePoint;
  dominantWeightShare: number;
  cloudSpreadMetres: number;
  modeSeparationMetres: number;
  directionResolved: boolean;
};

/** Deterministic Mulberry32 PRNG so offline simulations and unit tests are 100% reproducible. */
function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRandom(rand: () => number): number {
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function wrapAngle(rad: number): number {
  let a = rad % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

function distanceToPolylinePx(pointPx: PagePoint, polylinePx: PagePoint[]): number {
  if (polylinePx.length === 1) {
    return Math.hypot(pointPx.x - polylinePx[0].x, pointPx.y - polylinePx[0].y);
  }
  let bestSq = Infinity;
  for (let i = 0; i < polylinePx.length - 1; i++) {
    const a = polylinePx[i];
    const b = polylinePx[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq > 0
        ? Math.max(0, Math.min(1, ((pointPx.x - a.x) * dx + (pointPx.y - a.y) * dy) / lenSq))
        : 0;
    const dSq = (pointPx.x - (a.x + t * dx)) ** 2 + (pointPx.y - (a.y + t * dy)) ** 2;
    if (dSq < bestSq) bestSq = dSq;
  }
  return Math.sqrt(bestSq);
}

function onPage(point: PagePoint): boolean {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export class IndoorPdrTracker {
  private readonly enableParticleFilter: boolean;
  private readonly rand: () => number;

  private context: TrackerContext | null = null;
  private fit: ReturnType<typeof fitCalibration> | null = null;
  private grid: WalkableGrid | null = null;
  private routePx: PagePoint[] | null = null;

  // Transition & deduplication guards
  private minAcceptedGpsTimestamp = -Infinity;
  private lastProcessedGpsTimestamp = -Infinity;
  private lastGpsResult: MapMatchResult | null = null;
  private sawRawBeforeSurface = false;

  // Tier 1 / Tier 2 continuity & stationary anchor state
  private previousMatch: PreviousMatch | null = null;
  private lastMatchStepDistanceMetres = 0;
  private stationaryAnchor: PagePoint | null = null;
  private stationaryCandidates: PreviousMatch[] = [];

  // Tier 3 particle filter state
  private particles: Particle[] = [];
  private particleInitialized = false;
  private gyroStreamStart: number | null = null;
  private gyroNeedsNewFix = false;
  private particleDivergentCount = 0;
  private lastAcceptedGpsAt: number | null = null;
  private lastAcceptedGpsAccuracy = 0;
  private lastAcceptedAnchorRadiusMetres = 0;
  private lastAcceptedCorridorPoint: PagePoint | null = null;
  private lastRawGpsPx: PagePoint | null = null;
  private stepsSinceLastAcceptedGps = 0;
  private cachedSummary: ClusterSummary | null = null;

  constructor(options?: { enableParticleFilter?: boolean; seed?: number }) {
    this.enableParticleFilter = options?.enableParticleFilter ?? PARTICLE_PDR_ENABLED;
    this.rand = createRng(options?.seed ?? 0x51c3a92d);
  }

  /** Whether the current floor/step context allows indoor PDR prediction or motion gating. */
  isPdrEligible(): boolean {
    const ctx = this.context;
    return Boolean(
      ctx &&
        ctx.stepKind === 'corridor' &&
        ctx.isSamePlanStep &&
        this.fit &&
        this.grid &&
        ctx.calibration?.status === 'approximate' &&
        ctx.calibration.planId === ctx.plan.id &&
        ctx.calibration.sourceSha256 === ctx.plan.sourceSha256 &&
        ctx.surface &&
        ctx.surface.planId === ctx.plan.id &&
        ctx.surface.sourceSha256 === ctx.plan.sourceSha256 &&
        ctx.surface.runs.length > 0,
    );
  }

  /**
   * Update active floor/step context. Resets filter state on floor changes, transfer steps,
   * calibration/surface invalidation, and requires a post-transition GPS fix before re-seeding.
   */
  configureContext(next: TrackerContext, transitionTimestamp?: number) {
    const prev = this.context;
    const planChanged = !prev || prev.plan.id !== next.plan.id;
    const sourceChanged =
      !prev ||
      prev.plan.sourceSha256 !== next.plan.sourceSha256 ||
      prev.calibration?.sourceSha256 !== next.calibration?.sourceSha256;
    const enteringOrLeavingTransfer =
      !!prev &&
      (prev.stepKind !== next.stepKind || prev.isSamePlanStep !== next.isSamePlanStep) &&
      (prev.stepKind !== 'corridor' ||
        !prev.isSamePlanStep ||
        next.stepKind !== 'corridor' ||
        !next.isSamePlanStep);
    const surfaceJustLoaded = !prev?.surface && !!next.surface;
    const surfaceLost = !!prev?.surface && !next.surface;

    this.context = next;
    this.routePx = next.routePath?.length
      ? next.routePath.map((p) => ({ x: p.x * next.plan.width, y: p.y * next.plan.height }))
      : null;

    const validCal =
      next.calibration &&
      next.calibration.status === 'approximate' &&
      next.calibration.planId === next.plan.id &&
      next.calibration.sourceSha256 === next.plan.sourceSha256;
    if (validCal) {
      try {
        this.fit = fitCalibration(next.calibration!.controls, next.plan.width, next.plan.height);
      } catch {
        this.fit = null;
      }
    } else {
      this.fit = null;
    }

    const validSurface =
      next.surface &&
      next.surface.planId === next.plan.id &&
      next.surface.sourceSha256 === next.plan.sourceSha256 &&
      Number.isFinite(next.surface.step) &&
      next.surface.step > 0 &&
      next.surface.runs.length > 0;
    this.grid = validSurface
      ? getWalkableGrid(next.surface!, next.plan.width, next.plan.height)
      : null;

    if (
      prev &&
      (planChanged ||
        sourceChanged ||
        enteringOrLeavingTransfer ||
        prev.transferStepIndex !== next.transferStepIndex ||
        surfaceLost ||
        (surfaceJustLoaded && this.sawRawBeforeSurface))
    ) {
      this.reset(Math.max(transitionTimestamp ?? -Infinity, this.lastProcessedGpsTimestamp));
    }
  }

  /** Reset all estimation state (on floor transfer, backgrounding, permission loss, or stop). */
  reset(minAcceptedGpsTimestamp?: number) {
    if (minAcceptedGpsTimestamp !== undefined && Number.isFinite(minAcceptedGpsTimestamp)) {
      this.minAcceptedGpsTimestamp = Math.max(
        this.minAcceptedGpsTimestamp,
        minAcceptedGpsTimestamp,
      );
    }
    this.lastGpsResult = null;
    this.sawRawBeforeSurface = false;
    this.previousMatch = null;
    this.lastMatchStepDistanceMetres = 0;
    this.stationaryAnchor = null;
    this.stationaryCandidates = [];
    this.gyroStreamStart = null;
    this.gyroNeedsNewFix = false;
    this.clearParticleEstimate();
  }

  private clearParticleEstimate() {
    this.particles = [];
    this.particleInitialized = false;
    this.particleDivergentCount = 0;
    this.lastAcceptedGpsAt = null;
    this.lastAcceptedGpsAccuracy = 0;
    this.lastAcceptedAnchorRadiusMetres = 0;
    this.lastAcceptedCorridorPoint = null;
    this.lastRawGpsPx = null;
    this.stepsSinceLastAcceptedGps = 0;
    this.cachedSummary = null;
  }

  updateMotion(motion?: MotionSnapshot | null) {
    if (!motion?.active || motion.activity !== 'stationary') {
      this.stationaryAnchor = null;
      this.stationaryCandidates = [];
    }
    if (!this.enableParticleFilter) return;
    const streamStart = motion?.active && motion.gyroFresh ? motion.gyroFreshSince : null;
    // The stream's start also identifies a restart if the browser batches loss and recovery.
    if (this.gyroStreamStart !== null && streamStart !== this.gyroStreamStart) {
      if (this.lastAcceptedCorridorPoint && this.lastAcceptedGpsAt !== null) {
        this.previousMatch = {
          point: this.lastAcceptedCorridorPoint,
          timestamp: this.lastAcceptedGpsAt,
        };
      }
      this.clearParticleEstimate();
      this.gyroNeedsNewFix = true;
    }
    this.gyroStreamStart = streamStart;
  }

  /**
   * Process a single fresh GPS reading strictly once per unique timestamp.
   * Repeated calls with the same timestamp (e.g. from 500 ms freshness ticks) are idempotent no-ops.
   */
  ingestGpsReading(reading: DeviceReading, motion?: MotionSnapshot | null): TrackerEvaluation {
    if (!this.context) return { status: 'waiting' };
    this.updateMotion(motion);

    // Reject stale pre-transition fixes (e.g. still-fresh reading from the previous floor).
    if (reading.timestamp <= this.minAcceptedGpsTimestamp) {
      return { status: 'waiting' };
    }

    // Deduplicate: never double-count the same GPS timestamp across 500 ms freshness ticks.
    if (reading.timestamp <= this.lastProcessedGpsTimestamp) {
      return this.evaluateAt(reading.receivedAt, true, motion?.activity ?? 'unknown');
    }
    this.lastProcessedGpsTimestamp = reading.timestamp;

    const ctx = this.context;
    const pdrEligible = this.isPdrEligible();
    const activity: MotionActivityState =
      pdrEligible && motion?.active && motion.hasAccel ? motion.activity : 'unknown';

    // Non-corridor steps, unaligned floors, missing surface, or silent/unavailable motion -> Tier 1.
    if (!pdrEligible || activity === 'unknown') {
      if (activity === 'unknown') {
        this.stationaryAnchor = null;
        this.stationaryCandidates = [];
        this.clearParticleEstimate();
      }
      const baseResult = matchDeviceToFloor({
        reading,
        plan: ctx.plan,
        calibration: ctx.calibration,
        surface: ctx.surface,
        routePath: ctx.stepKind === 'corridor' ? ctx.routePath : undefined,
        stepKind: ctx.stepKind,
        previous: ctx.stepKind === 'corridor' && ctx.isSamePlanStep ? this.previousMatch : null,
      });
      this.lastGpsResult = baseResult;
      if (baseResult.status === 'raw' && !ctx.surface) {
        this.sawRawBeforeSurface = true;
      }
      if (baseResult.status === 'matched') {
        this.previousMatch = { point: baseResult.overlay.point, timestamp: reading.timestamp };
        this.lastMatchStepDistanceMetres = motion?.estimatedDistanceMetres ?? 0;
      }
      return this.toEvaluation(baseResult);
    }

    // Stage 2 (Tier 3): Corridor-constrained 120-particle filter when enabled and gyro is live.
    if (
      this.enableParticleFilter &&
      motion &&
      this.gyroStreamStart !== null &&
      (!this.gyroNeedsNewFix || reading.timestamp > this.gyroStreamStart)
    ) {
      return this.updateParticleFilterWithGps(reading, motion);
    }

    // Stage 1 (Tier 2): Accelerometer-only hard stationary anchor + step-budgeted continuity.
    return this.updateMotionGatedMatcher(reading, motion!);
  }

  /**
   * Process a single detected footstep.
   * Releases Tier 2 stationary hold immediately, and propagates Tier 3 particles when active.
   */
  ingestStep(step: DetectedStep): boolean {
    if (!this.isPdrEligible()) return false;

    // Any real detected step immediately releases the Tier 2 stationary anchor.
    this.stationaryAnchor = null;
    this.stationaryCandidates = [];

    if (!this.enableParticleFilter || !this.particleInitialized || !this.fit || !this.grid) {
      return false;
    }
    if (!step.hasGyro || this.bridgeExpired(step.timestamp)) {
      return false;
    }

    const scale = this.fit.scale;
    // Physical CCW left turn (> 0) decreases Y-down floor-plan pixel angle.
    const deltaHeadingPx = -step.deltaYawRad;
    const isSharpTurn = Math.abs(deltaHeadingPx) > PDR_TRACKER_CONFIG.phoneTwistThresholdRad;
    const stepHeadingNoise = Math.min(
      PDR_TRACKER_CONFIG.maxStepHeadingNoiseRad,
      Math.max(
        PDR_TRACKER_CONFIG.baseHeadingNoiseRad,
        PDR_TRACKER_CONFIG.baseHeadingNoiseRad +
          PDR_TRACKER_CONFIG.turnProportionalNoise * Math.abs(deltaHeadingPx) +
          step.turnNoiseRad,
      ),
    );

    const n = this.particles.length;
    const hedgeCount = isSharpTurn
      ? Math.max(1, Math.round(n * PDR_TRACKER_CONFIG.phoneTwistHedgeFraction))
      : 0;

    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      // During a sharp single-step turn, keep a small straight-ahead hedge so a phone-only
      // 90 deg horizontal twist in a straight corridor survives wall collisions.
      const applyTurn = !isSharpTurn || i >= hedgeCount;
      const noiseSigma = applyTurn
        ? stepHeadingNoise
        : Math.max(stepHeadingNoise, PDR_TRACKER_CONFIG.phoneTwistHedgeNoiseRad);
      const nextHeading = wrapAngle(
        p.headingPx + (applyTurn ? deltaHeadingPx : 0) + gaussianRandom(this.rand) * noiseSigma,
      );
      const stepMetres = Math.max(
        0.35,
        Math.min(
          1.15,
          step.stepLengthMetres * (1 + gaussianRandom(this.rand) * PDR_TRACKER_CONFIG.stepLengthNoiseFrac),
        ),
      );
      const traced = this.grid.traceStep({ x: p.xPx, y: p.yPx }, nextHeading, stepMetres * scale);
      p.xPx = traced.pointPx.x;
      p.yPx = traced.pointPx.y;
      p.headingPx = wrapAngle(traced.headingPx);
      const wallMult =
        traced.outcome === 'clear'
          ? PDR_TRACKER_CONFIG.wallClearWeight
          : traced.outcome === 'slide'
            ? PDR_TRACKER_CONFIG.wallSlideWeight
            : PDR_TRACKER_CONFIG.wallBlockedWeight;
      p.weight *= wallMult;
    }

    this.stepsSinceLastAcceptedGps += 1;
    this.normalizeAndResampleIfNeeded();
    this.cachedSummary = this.summarizeCloud();
    return true;
  }

  /**
   * Pure read-only evaluation for UI renders and 500 ms freshness ticks.
   * Never modifies particle weights or divergence counters; enforces stale-bridge expiry even with 0 steps.
   */
  evaluateAt(
    now: number,
    freshGps: boolean,
    motionActivity: MotionActivityState,
  ): TrackerEvaluation {
    if (!this.context) return { status: 'waiting' };

    if (
      motionActivity !== 'unknown' &&
      this.enableParticleFilter &&
      this.particleInitialized &&
      this.isPdrEligible() &&
      this.fit &&
      this.grid &&
      this.cachedSummary &&
      this.lastAcceptedGpsAt !== null
    ) {
      if (freshGps) {
        if (this.lastGpsResult && this.lastGpsResult.status !== 'matched') {
          return this.toEvaluation(this.lastGpsResult);
        }
        return this.buildParticleEvaluation(now, false);
      }

      // Bounded stale-GPS bridging: only when direction is resolved and both limits hold.
      if (!this.bridgeExpired(now) && this.cachedSummary.directionResolved) {
        return this.buildParticleEvaluation(now, true);
      }

      return { status: 'waiting' };
    }

    if (!freshGps || !this.lastGpsResult) {
      return { status: 'waiting' };
    }
    return this.toEvaluation(this.lastGpsResult);
  }

  private bridgeExpired(now: number): boolean {
    return (
      this.lastAcceptedGpsAt === null ||
      now - this.lastAcceptedGpsAt >= PDR_TRACKER_CONFIG.maxBridgeMs ||
      this.stepsSinceLastAcceptedGps >= PDR_TRACKER_CONFIG.maxBridgeSteps
    );
  }

  private updateMotionGatedMatcher(reading: DeviceReading, motion: MotionSnapshot): TrackerEvaluation {
    const ctx = this.context!;
    const scale = this.fit!.scale;

    if (motion.activity === 'stationary') {
      if (!this.stationaryAnchor && this.previousMatch) {
        this.stationaryAnchor = this.previousMatch.point;
        this.stationaryCandidates = [];
      }
    } else {
      this.stationaryAnchor = null;
      this.stationaryCandidates = [];
    }

    const deltaStepsMetres = Math.max(
      0,
      motion.estimatedDistanceMetres - this.lastMatchStepDistanceMetres,
    );

    const probeResult = matchDeviceToFloor({
      reading,
      plan: ctx.plan,
      calibration: ctx.calibration,
      surface: ctx.surface,
      routePath: ctx.routePath,
      stepKind: ctx.stepKind,
      previous: this.previousMatch,
      motion: {
        activity: motion.activity,
        stationaryAnchor: this.stationaryAnchor,
        deltaStepDistanceMetres: deltaStepsMetres,
        stationaryAnchorReleased: false,
      },
    });

    if (probeResult.status !== 'matched') {
      this.stationaryCandidates = [];
      this.lastGpsResult = probeResult;
      return this.toEvaluation(probeResult);
    }

    // Independent per-unique-timestamp divergence check for hard stationary anchor release.
    if (motion.activity === 'stationary' && this.stationaryAnchor) {
      const divergenceMetres =
        Math.hypot(
          (probeResult.unanchoredPoint.x - this.stationaryAnchor.x) * ctx.plan.width,
          (probeResult.unanchoredPoint.y - this.stationaryAnchor.y) * ctx.plan.height,
        ) / scale;
      if (divergenceMetres > PDR_TRACKER_CONFIG.stationaryDivergenceMetres) {
        const point = probeResult.unanchoredPoint;
        const previous = this.stationaryCandidates.at(-1);
        const gapTooLong =
          previous && reading.timestamp - previous.timestamp > MAP_MATCH_CONFIG.continuityGapMs;
        const disagrees = this.stationaryCandidates.some(
          (candidate) =>
            Math.hypot(
              (candidate.point.x - point.x) * ctx.plan.width,
              (candidate.point.y - point.y) * ctx.plan.height,
            ) / scale > PDR_TRACKER_CONFIG.stationaryAgreementMetres,
        );
        if (gapTooLong || disagrees) this.stationaryCandidates = [];
        this.stationaryCandidates.push({ point, timestamp: reading.timestamp });
      } else {
        this.stationaryCandidates = [];
      }

      if (this.stationaryCandidates.length >= PDR_TRACKER_CONFIG.stationaryDivergenceFixes) {
        this.stationaryAnchor = null;
        this.stationaryCandidates = [];
        const released = matchDeviceToFloor({
          reading,
          plan: ctx.plan,
          calibration: ctx.calibration,
          surface: ctx.surface,
          routePath: ctx.routePath,
          stepKind: ctx.stepKind,
          previous: null,
          motion: {
            activity: 'stationary',
            stationaryAnchor: null,
            stationaryAnchorReleased: true,
          },
        });
        this.lastGpsResult = released;
        if (released.status === 'matched') {
          this.stationaryAnchor = released.overlay.point;
          this.previousMatch = { point: released.overlay.point, timestamp: reading.timestamp };
          this.lastMatchStepDistanceMetres = motion.estimatedDistanceMetres;
        }
        return this.toEvaluation(released);
      }
    } else if (motion.activity === 'stationary' && !this.stationaryAnchor) {
      this.stationaryAnchor = probeResult.overlay.point;
      this.stationaryCandidates = [];
    }

    this.lastGpsResult = probeResult;
    this.previousMatch = { point: probeResult.overlay.point, timestamp: reading.timestamp };
    this.lastMatchStepDistanceMetres = motion.estimatedDistanceMetres;
    return this.toEvaluation(probeResult);
  }

  private updateParticleFilterWithGps(
    reading: DeviceReading,
    motion: MotionSnapshot,
  ): TrackerEvaluation {
    const ctx = this.context!;
    const fit = this.fit!;
    const grid = this.grid!;
    const scale = fit.scale;

    // Validate fix and compute corridor-matched recovery anchor via existing map-matcher rules.
    const gpsMatch = matchDeviceToFloor({
      reading,
      plan: ctx.plan,
      calibration: ctx.calibration,
      surface: ctx.surface,
      routePath: ctx.routePath,
      stepKind: ctx.stepKind,
      previous: null,
    });
    this.lastGpsResult = gpsMatch;
    if (gpsMatch.status !== 'matched') {
      return this.toEvaluation(gpsMatch);
    }

    if (this.bridgeExpired(reading.receivedAt)) this.clearParticleEstimate();
    this.gyroNeedsNewFix = false;
    this.lastMatchStepDistanceMetres = motion.estimatedDistanceMetres;
    const rawPoint = fit.project(reading);
    const rawPx = { x: rawPoint.x * ctx.plan.width, y: rawPoint.y * ctx.plan.height };
    const matchedPx = {
      x: gpsMatch.overlay.point.x * ctx.plan.width,
      y: gpsMatch.overlay.point.y * ctx.plan.height,
    };
    this.lastRawGpsPx = rawPx;
    this.lastAcceptedCorridorPoint = gpsMatch.overlay.point;

    if (!this.particleInitialized) {
      this.seedParticles(matchedPx, rawPx, reading.accuracy, ctx.stepStartPoint);
      this.particleInitialized = true;
      this.particleDivergentCount = 0;
      this.lastAcceptedGpsAt = reading.timestamp;
      this.lastAcceptedGpsAccuracy = reading.accuracy;
      this.stepsSinceLastAcceptedGps = 0;
      this.cachedSummary = this.summarizeCloud();
      this.updateAnchorRadius(rawPx);
      this.previousMatch = { point: gpsMatch.overlay.point, timestamp: reading.timestamp };
      return this.buildParticleEvaluation(reading.receivedAt, false);
    }

    // Conservative indoor GPS sigma prevents overconfident exterior-biased fixes from dragging particles into walls.
    const stationaryNoSteps =
      motion.activity === 'stationary' && this.stepsSinceLastAcceptedGps === 0;
    const sigmaGpsMetres = stationaryNoSteps
      ? Math.max(
          reading.accuracy * PDR_TRACKER_CONFIG.stationaryGpsSigmaScale,
          PDR_TRACKER_CONFIG.stationaryGpsSigmaFloorMetres,
        )
      : Math.max(reading.accuracy, PDR_TRACKER_CONFIG.gpsSigmaFloorMetres);
    const twoSigmaPxSq = 2 * (sigmaGpsMetres * scale) ** 2;

    let totalWeight = 0;
    for (const p of this.particles) {
      const distRawSq = (p.xPx - rawPx.x) ** 2 + (p.yPx - rawPx.y) ** 2;
      let likelihood = Math.exp(-distRawSq / twoSigmaPxSq);
      if (this.routePx) {
        const routeDistMetres = distanceToPolylinePx({ x: p.xPx, y: p.yPx }, this.routePx) / scale;
        const routePen = Math.min(
          PDR_TRACKER_CONFIG.routeTieBreakCapMetres,
          PDR_TRACKER_CONFIG.routeTieBreakWeight * routeDistMetres,
        );
        likelihood *= Math.exp(-routePen / sigmaGpsMetres);
      }
      p.weight *= likelihood;
      totalWeight += p.weight;
    }

    const preReseedSummary = totalWeight > 1e-12 ? this.summarizeCloud(totalWeight) : null;
    const divergenceMetres = preReseedSummary
      ? Math.hypot(
          preReseedSummary.centroidPx.x - matchedPx.x,
          preReseedSummary.centroidPx.y - matchedPx.y,
        ) / scale
      : Infinity;

    if (divergenceMetres > PDR_TRACKER_CONFIG.particleDivergenceMetres) {
      this.particleDivergentCount += 1;
    } else {
      this.particleDivergentCount = 0;
    }

    // Kidnapped-robot / divergence recovery (requires 3 unique timestamps or numerical underflow).
    if (
      totalWeight <= 1e-12 ||
      (this.particleDivergentCount >= PDR_TRACKER_CONFIG.particleDivergenceFixes &&
        divergenceMetres > PDR_TRACKER_CONFIG.particleHardResetMetres)
    ) {
      this.seedParticles(matchedPx, rawPx, reading.accuracy, undefined);
      this.particleDivergentCount = 0;
    } else {
      this.normalizeAndResampleIfNeeded();
      if (this.particleDivergentCount >= PDR_TRACKER_CONFIG.particleDivergenceFixes) {
        this.reseedFractionAround(matchedPx, reading.accuracy, PDR_TRACKER_CONFIG.particleReseedFraction);
        this.particleDivergentCount = 0;
      }
    }

    this.lastAcceptedGpsAt = reading.timestamp;
    this.lastAcceptedGpsAccuracy = reading.accuracy;
    this.stepsSinceLastAcceptedGps = 0;
    this.cachedSummary = this.summarizeCloud();
    this.updateAnchorRadius(rawPx);
    this.previousMatch = {
      point: this.toNormalizedWalkable(this.cachedSummary.centroidPx, grid),
      timestamp: reading.timestamp,
    };
    return this.buildParticleEvaluation(reading.receivedAt, false);
  }

  private seedParticles(
    matchedPx: PagePoint,
    rawPx: PagePoint,
    accuracyMetres: number,
    stepStartPoint?: PagePoint,
  ) {
    const ctx = this.context!;
    const grid = this.grid!;
    const scale = this.fit!.scale;
    const n = PDR_TRACKER_CONFIG.particleCount;
    // W3C coords.accuracy is a 95% confidence radius (~2.45 sigma); keep initial particles inside it.
    const spreadMetres = Math.max(2.5, Math.min(6.0, accuracyMetres * 0.55));
    const probePx = PDR_TRACKER_CONFIG.corridorProbeMetres * scale;

    let anchorPx: PagePoint | null = null;
    if (stepStartPoint) {
      const candidatePx = {
        x: stepStartPoint.x * ctx.plan.width,
        y: stepStartPoint.y * ctx.plan.height,
      };
      const distToRawMetres = Math.hypot(candidatePx.x - rawPx.x, candidatePx.y - rawPx.y) / scale;
      const limitMetres = Math.max(accuracyMetres, PDR_TRACKER_CONFIG.anchorStepSeedMaxDistMetres);
      if (distToRawMetres <= limitMetres) {
        const snapped = grid.nearestWalkablePx(candidatePx, 2.0 * scale);
        if (snapped) anchorPx = snapped.pointPx;
      }
    }

    const anchorCount = anchorPx ? Math.round(n * PDR_TRACKER_CONFIG.anchorSeedFraction) : 0;
    const snappedMatched = grid.nearestWalkablePx(matchedPx, 3.0 * scale)?.pointPx ?? matchedPx;

    this.particles = [];
    for (let i = 0; i < n; i++) {
      const useAnchor = i < anchorCount && anchorPx !== null;
      const center = useAnchor ? anchorPx! : snappedMatched;
      const sigmaPx = (useAnchor ? 1.5 : spreadMetres) * scale;
      const sampled = {
        x: center.x + gaussianRandom(this.rand) * sigmaPx,
        y: center.y + gaussianRandom(this.rand) * sigmaPx,
      };
      const walkable = grid.nearestWalkablePx(sampled, spreadMetres * 2 * scale)?.pointPx ?? center;
      const headingPx = this.sampleCorridorHeading(walkable, probePx);
      this.particles.push({
        xPx: walkable.x,
        yPx: walkable.y,
        headingPx,
        weight: 1 / n,
      });
    }
  }

  private reseedFractionAround(matchedPx: PagePoint, accuracyMetres: number, fraction: number) {
    const grid = this.grid!;
    const scale = this.fit!.scale;
    const n = this.particles.length;
    const count = Math.max(1, Math.round(n * fraction));
    const spreadMetres = Math.max(3.0, Math.min(8.0, accuracyMetres));
    const probePx = PDR_TRACKER_CONFIG.corridorProbeMetres * scale;
    const center = grid.nearestWalkablePx(matchedPx, 3.0 * scale)?.pointPx ?? matchedPx;

    // Replace lowest-weight particles so strong surviving hypotheses remain intact.
    this.particles.sort((a, b) => a.weight - b.weight);
    for (let i = 0; i < count; i++) {
      const sampled = {
        x: center.x + gaussianRandom(this.rand) * spreadMetres * scale,
        y: center.y + gaussianRandom(this.rand) * spreadMetres * scale,
      };
      const walkable = grid.nearestWalkablePx(sampled, spreadMetres * 2 * scale)?.pointPx ?? center;
      this.particles[i] = {
        xPx: walkable.x,
        yPx: walkable.y,
        headingPx: this.sampleCorridorHeading(walkable, probePx),
        weight: 1 / n,
      };
    }
    this.normalizeWeights();
  }

  private sampleCorridorHeading(pointPx: PagePoint, probePx: number): number {
    const open = this.grid!.probeOpenHeadings(pointPx, probePx);
    if (open.length > 0 && this.rand() < 0.7) {
      const chosen = open[Math.floor(this.rand() * open.length)];
      return wrapAngle(chosen + gaussianRandom(this.rand) * ((12 * Math.PI) / 180));
    }
    return wrapAngle(this.rand() * 2 * Math.PI);
  }

  private normalizeWeights(): number {
    let sum = 0;
    for (const p of this.particles) sum += p.weight;
    if (sum <= 1e-15 || !Number.isFinite(sum)) {
      const uniform = 1 / this.particles.length;
      for (const p of this.particles) p.weight = uniform;
      return 0;
    }
    for (const p of this.particles) p.weight /= sum;
    return sum;
  }

  private normalizeAndResampleIfNeeded() {
    this.normalizeWeights();
    let sumSq = 0;
    for (const p of this.particles) sumSq += p.weight * p.weight;
    const nEff = sumSq > 0 ? 1 / sumSq : 0;
    const n = this.particles.length;
    if (nEff >= n * PDR_TRACKER_CONFIG.resampleNeffRatio) return;

    // Low-variance systematic resampling with strictly grid-connected roughening jitter.
    const step = 1 / n;
    let r = this.rand() * step;
    let cumulative = this.particles[0].weight;
    let idx = 0;
    const jitterPx = PDR_TRACKER_CONFIG.resamplePosJitterMetres * this.fit!.scale;
    const next: Particle[] = new Array(n);

    for (let m = 0; m < n; m++) {
      const u = r + m * step;
      while (u > cumulative && idx < n - 1) {
        idx += 1;
        cumulative += this.particles[idx].weight;
      }
      const parent = this.particles[idx];
      const jittered = this.grid!.jitterConnected(
        { x: parent.xPx, y: parent.yPx },
        gaussianRandom(this.rand) * jitterPx,
        gaussianRandom(this.rand) * jitterPx,
      );
      next[m] = {
        xPx: jittered.x,
        yPx: jittered.y,
        headingPx: wrapAngle(
          parent.headingPx +
            gaussianRandom(this.rand) * PDR_TRACKER_CONFIG.resampleHeadingJitterRad,
        ),
        weight: step,
      };
    }
    this.particles = next;
  }

  /**
   * Identify the dominant spatial mode and measure separation between plausible hypotheses.
   * Prevents advancing a single dot from a weakly dominant 55/45 split in a straight hallway.
   */
  private summarizeCloud(knownWeightSum?: number): ClusterSummary {
    const scale = this.fit!.scale;
    const clusterRadiusPx = PDR_TRACKER_CONFIG.clusterRadiusMetres * scale;
    const clusterRadiusSq = clusterRadiusPx * clusterRadiusPx;
    const norm = knownWeightSum ?? 1;

    // Greedy mode extraction over normalized particles (N=120 -> <0.1 ms).
    const remaining = this.particles.map((p, i) => ({
      i,
      xPx: p.xPx,
      yPx: p.yPx,
      w: p.weight / (norm > 0 ? norm : 1),
      used: false,
    }));

    const modes: { centroidPx: PagePoint; weight: number; spreadMetres: number }[] = [];
    while (true) {
      let bestSeed = -1;
      let bestSeedWeight = -1;
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].used) continue;
        let localW = 0;
        for (let j = 0; j < remaining.length; j++) {
          if (remaining[j].used) continue;
          const dSq =
            (remaining[j].xPx - remaining[i].xPx) ** 2 + (remaining[j].yPx - remaining[i].yPx) ** 2;
          if (dSq <= clusterRadiusSq) localW += remaining[j].w;
        }
        if (localW > bestSeedWeight) {
          bestSeedWeight = localW;
          bestSeed = i;
        }
      }
      if (bestSeed < 0 || bestSeedWeight <= 1e-6) break;

      const seed = remaining[bestSeed];
      let sumW = 0;
      let sumX = 0;
      let sumY = 0;
      const members: number[] = [];
      for (let j = 0; j < remaining.length; j++) {
        if (remaining[j].used) continue;
        const dSq = (remaining[j].xPx - seed.xPx) ** 2 + (remaining[j].yPx - seed.yPx) ** 2;
        if (dSq <= clusterRadiusSq) {
          remaining[j].used = true;
          members.push(j);
          sumW += remaining[j].w;
          sumX += remaining[j].xPx * remaining[j].w;
          sumY += remaining[j].yPx * remaining[j].w;
        }
      }
      const cx = sumW > 0 ? sumX / sumW : seed.xPx;
      const cy = sumW > 0 ? sumY / sumW : seed.yPx;
      let varSq = 0;
      for (const m of members) {
        const dSq = (remaining[m].xPx - cx) ** 2 + (remaining[m].yPx - cy) ** 2;
        varSq += remaining[m].w * dSq;
      }
      modes.push({
        centroidPx: { x: cx, y: cy },
        weight: sumW,
        spreadMetres: sumW > 0 ? Math.sqrt(varSq / sumW) / scale : 0,
      });
      if (modes.length >= 6) break;
    }

    modes.sort((a, b) => b.weight - a.weight);
    const top = modes[0] ?? {
      centroidPx: { x: this.particles[0].xPx, y: this.particles[0].yPx },
      weight: 1,
      spreadMetres: 0,
    };

    const plausible = modes.filter(
      (m) => m.weight >= PDR_TRACKER_CONFIG.plausibleModeWeightThreshold,
    );
    let modeSeparationMetres = 0;
    for (let i = 0; i < plausible.length; i++) {
      for (let j = i + 1; j < plausible.length; j++) {
        const d =
          Math.hypot(
            plausible[i].centroidPx.x - plausible[j].centroidPx.x,
            plausible[i].centroidPx.y - plausible[j].centroidPx.y,
          ) / scale;
        if (d > modeSeparationMetres) modeSeparationMetres = d;
      }
    }

    // Compute circular heading resultant length R in [0, 1] directly over normalized weights.
    let sumCos = 0;
    let sumSin = 0;
    let totalW = 0;
    for (const p of this.particles) {
      const w = p.weight / (norm > 0 ? norm : 1);
      sumCos += w * Math.cos(p.headingPx);
      sumSin += w * Math.sin(p.headingPx);
      totalW += w;
    }
    const headingResultant = totalW > 0 ? Math.hypot(sumCos, sumSin) / totalW : 0;

    const directionResolved =
      headingResultant >= PDR_TRACKER_CONFIG.minResolvedHeadingResultant &&
      top.weight >= PDR_TRACKER_CONFIG.minResolvedWeightShare &&
      modeSeparationMetres <= PDR_TRACKER_CONFIG.maxResolvedModeSeparationMetres;

    return {
      centroidPx: top.centroidPx,
      dominantWeightShare: top.weight,
      cloudSpreadMetres: top.spreadMetres,
      modeSeparationMetres,
      directionResolved,
    };
  }

  private updateAnchorRadius(rawPx: PagePoint) {
    const summary = this.cachedSummary!;
    const scale = this.fit!.scale;
    const snapMetres =
      Math.hypot(summary.centroidPx.x - rawPx.x, summary.centroidPx.y - rawPx.y) / scale;
    this.lastAcceptedAnchorRadiusMetres = Math.max(
      this.lastAcceptedGpsAccuracy,
      snapMetres,
      2 * summary.cloudSpreadMetres,
      0.5 * summary.modeSeparationMetres,
    );
  }

  private toNormalizedWalkable(pointPx: PagePoint, grid: WalkableGrid): PagePoint {
    const ctx = this.context!;
    const snapped = grid.nearestWalkablePx(pointPx, 5 * this.fit!.scale)?.pointPx ?? pointPx;
    return {
      x: snapped.x / ctx.plan.width,
      y: snapped.y / ctx.plan.height,
    };
  }

  private buildParticleEvaluation(now: number, bridged: boolean): TrackerEvaluation {
    const ctx = this.context!;
    const fit = this.fit!;
    const grid = this.grid!;
    const summary = this.cachedSummary!;

    // When direction is unresolved, hold the conservative corridor GPS anchor rather than
    // advancing the dot down a weakly dominant branch.
    const point =
      summary.directionResolved || !this.lastAcceptedCorridorPoint
        ? this.toNormalizedWalkable(summary.centroidPx, grid)
        : this.lastAcceptedCorridorPoint;

    if (!onPage(point)) return { status: 'outside-page' };

    const elapsedPastFreshSec =
      this.lastAcceptedGpsAt !== null
        ? Math.max(0, (now - this.lastAcceptedGpsAt - LOCATION_FRESH_MS) / 1000)
        : 0;
    const bridgeGrowthMetres =
      PDR_TRACKER_CONFIG.bridgeStepGrowthMetres * this.stepsSinceLastAcceptedGps +
      PDR_TRACKER_CONFIG.bridgeTimeGrowthMetresPerSec * elapsedPastFreshSec;

    const radiusMetres = Math.max(
      this.lastAcceptedAnchorRadiusMetres + bridgeGrowthMetres,
      2 * summary.cloudSpreadMetres,
      0.5 * summary.modeSeparationMetres,
    );

    const pointPx = { x: point.x * ctx.plan.width, y: point.y * ctx.plan.height };
    const snapOffsetMetres = this.lastRawGpsPx
      ? Math.hypot(pointPx.x - this.lastRawGpsPx.x, pointPx.y - this.lastRawGpsPx.y) / fit.scale
      : undefined;
    const snapDistanceMetres =
      snapOffsetMetres !== undefined &&
      snapOffsetMetres >= MAP_MATCH_CONFIG.snapNoticeThresholdMetres
        ? snapOffsetMetres
        : undefined;

    const trackingMode: TrackingMode = bridged ? 'pdr-bridged' : 'pdr';
    return {
      status: bridged ? 'bridged' : 'matched',
      directionResolved: summary.directionResolved,
      overlay: {
        point,
        radiusX: (radiusMetres * fit.scale) / ctx.plan.width,
        radiusY: (radiusMetres * fit.scale) / ctx.plan.height,
        ...(snapDistanceMetres !== undefined ? { snapDistanceMetres } : {}),
        trackingMode,
      },
    };
  }

  private toEvaluation(result: MapMatchResult): TrackerEvaluation {
    if (result.status === 'matched') {
      return { status: 'matched', overlay: result.overlay };
    }
    if (result.status === 'raw') {
      return { status: 'raw', overlay: result.overlay };
    }
    return { status: result.status };
  }
}
