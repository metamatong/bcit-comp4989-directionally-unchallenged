/**
 * Pure, DOM-free inertial motion estimator for pedestrian dead reckoning (PDR).
 * Computes tilt-invariant step events, Weinberg stride estimates, verified
 * stationary/moving/unknown activity state, and gravity-projected relative yaw.
 * All sensor data remains transient in browser memory.
 */
import type {
  DetectedStep,
  MotionActivityState,
  MotionSnapshot,
  RawMotionSample,
  SensorConvention,
} from './types';

const DEG_TO_RAD = Math.PI / 180;

export const DEFAULT_SENSOR_CONVENTION: Readonly<SensorConvention> = Object.freeze({
  // W3C DeviceMotionEventRotationRate & Chromium device_motion_event_pump.cc map (alpha, beta, gamma) -> (X, Y, Z).
  rotationAxisOrder: 'xyz',
  gravitySign: 1,
});

export const PDR_MOTION_CONFIG = Object.freeze({
  gravityTauSec: 0.6,
  accelSmoothTauSec: 0.06,
  maxFrameGapMs: 500,
  sensorSilenceTimeoutMs: 1500,
  stationaryWindowMs: 1200,
  minStationaryWindowMs: 600,
  stationaryEnterVar: 0.14,
  stationaryExitVar: 0.3,
  /** Long enough that slow corridor strolling (~0.7-1.0 Hz) does not flip stationary between steps. */
  stationaryHoldAfterStepMs: 2200,
  minStepPeakMps2: 0.65,
  peakDropHysteresisMps2: 0.25,
  minStepValleyMps2: -0.45,
  valleyRiseHysteresisMps2: 0.2,
  minPeakToValleyMps2: 1.25,
  maxPeakToValleyMps2: 28.0,
  minStepIntervalMs: 300,
  maxPeakAgeMs: 1200,
  /** Physical lower bound for a real stride half-cycle; rejects 5-10 Hz hand tremor and taps. */
  minPeakToValleyMs: 130,
  maxPeakToValleyMs: 1000,
  weinbergK: 0.43,
  minStrideMetres: 0.45,
  maxStrideMetres: 0.9,
  gyroBiasTauSec: 4.0,
  maxGyroBiasRadPerSec: 0.1,
  stationaryGyroBiasGateRadPerSec: 0.15,
  stationaryYawDeadbandRadPerSec: 0.04,
  tiltNoiseGain: 0.25,
  maxStepDeltaYawRad: Math.PI,
  minValidAccelNormMps2: 2.0,
  maxValidAccelNormMps2: 40.0,
});

export type MotionIngestResult = {
  step: DetectedStep | null;
  activityChanged: boolean;
  capabilityChanged: boolean;
  gyroFreshnessChanged: boolean;
  /** Bias-corrected, tilt-invariant world CCW yaw rate (rad/s) for live heading fusion. */
  omegaCcwRadPerSec: number | null;
};

type StepFsmState = 'idle' | 'seeking-peak' | 'seeking-valley';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mapRotationRateRad(
  sample: RawMotionSample,
  axisOrder: SensorConvention['rotationAxisOrder'],
): { wx: number; wy: number; wz: number } | null {
  const { rotAlpha, rotBeta, rotGamma } = sample;
  if (
    typeof rotAlpha !== 'number' ||
    typeof rotBeta !== 'number' ||
    typeof rotGamma !== 'number' ||
    !Number.isFinite(rotAlpha) ||
    !Number.isFinite(rotBeta) ||
    !Number.isFinite(rotGamma)
  ) {
    return null;
  }
  if (axisOrder === 'zxy') {
    return {
      wx: rotBeta * DEG_TO_RAD,
      wy: rotGamma * DEG_TO_RAD,
      wz: rotAlpha * DEG_TO_RAD,
    };
  }
  return {
    wx: rotAlpha * DEG_TO_RAD,
    wy: rotBeta * DEG_TO_RAD,
    wz: rotGamma * DEG_TO_RAD,
  };
}

export class StepMotionEstimator {
  private readonly convention: SensorConvention;
  private hasAccel = false;
  private hasGyro = false;
  private activity: MotionActivityState = 'unknown';
  private stepCount = 0;
  private estimatedDistanceMetres = 0;
  private lastStepAt: number | null = null;
  private lastEventAt: number | null = null;
  private lastGyroAt: number | null = null;
  private gyroFreshSince: number | null = null;

  // Dynamic filter state (cleared across frame gaps > 500 ms or sensor silence).
  private gravX = 0;
  private gravY = 0;
  private gravZ = 0;
  private gravInitialized = false;
  private smoothedVert = 0;
  private window: { t: number; v: number }[] = [];

  private fsm: StepFsmState = 'idle';
  private peakVal = 0;
  private peakTime = 0;
  private valleyVal = 0;
  private valleyTime = 0;

  private biasX = 0;
  private biasY = 0;
  private biasZ = 0;
  private accumulatedYawRad = 0;
  private accumulatedTiltNoiseRad = 0;

  constructor(convention: Partial<SensorConvention> = {}) {
    this.convention = { ...DEFAULT_SENSOR_CONVENTION, ...convention };
  }

  /** Clear dynamic filters and yaw accumulators after backgrounding or frame gaps. */
  resetDynamicState() {
    this.gravInitialized = false;
    this.smoothedVert = 0;
    this.window = [];
    this.fsm = 'idle';
    this.peakVal = 0;
    this.peakTime = 0;
    this.valleyVal = 0;
    this.valleyTime = 0;
    this.accumulatedYawRad = 0;
    this.accumulatedTiltNoiseRad = 0;
  }

  resetAll() {
    this.resetDynamicState();
    this.hasAccel = false;
    this.hasGyro = false;
    this.activity = 'unknown';
    this.stepCount = 0;
    this.estimatedDistanceMetres = 0;
    this.lastStepAt = null;
    this.lastEventAt = null;
    this.lastGyroAt = null;
    this.gyroFreshSince = null;
    this.biasX = 0;
    this.biasY = 0;
    this.biasZ = 0;
  }

  /**
   * Drop activity to 'unknown' when the sensor stream goes silent (>1.5 s), so callers never
   * mistake a stalled or throttled sensor feed for verified standing still.
   */
  checkFreshness(now: number): boolean {
    const gyroExpired = this.expireGyro(now);
    if (
      this.lastEventAt === null ||
      now - this.lastEventAt > PDR_MOTION_CONFIG.sensorSilenceTimeoutMs
    ) {
      this.resetDynamicState();
      if (this.activity !== 'unknown') {
        this.activity = 'unknown';
        return true;
      }
    }
    return gyroExpired;
  }

  private expireGyro(now: number): boolean {
    if (this.lastGyroAt === null || now - this.lastGyroAt <= PDR_MOTION_CONFIG.maxFrameGapMs) {
      return false;
    }
    this.lastGyroAt = null;
    this.gyroFreshSince = null;
    this.accumulatedYawRad = 0;
    this.accumulatedTiltNoiseRad = 0;
    return true;
  }

  ingest(sample: RawMotionSample): MotionIngestResult {
    const { ax, ay, az, timestamp } = sample;
    const previousGyroFreshSince = this.gyroFreshSince;
    const gyroExpired = Number.isFinite(timestamp) && this.expireGyro(timestamp);
    if (
      !Number.isFinite(ax) ||
      !Number.isFinite(ay) ||
      !Number.isFinite(az) ||
      !Number.isFinite(timestamp)
    ) {
      return {
        step: null,
        activityChanged: false,
        capabilityChanged: false,
        gyroFreshnessChanged: gyroExpired,
        omegaCcwRadPerSec: null,
      };
    }
    const accelNorm = Math.hypot(ax, ay, az);
    if (
      accelNorm < PDR_MOTION_CONFIG.minValidAccelNormMps2 ||
      accelNorm > PDR_MOTION_CONFIG.maxValidAccelNormMps2
    ) {
      return {
        step: null,
        activityChanged: false,
        capabilityChanged: false,
        gyroFreshnessChanged: gyroExpired,
        omegaCcwRadPerSec: null,
      };
    }

    const prevActivity = this.activity;
    let capabilityChanged = false;
    if (!this.hasAccel) {
      this.hasAccel = true;
      capabilityChanged = true;
    }

    if (this.lastEventAt !== null && timestamp <= this.lastEventAt) {
      return {
        step: null,
        activityChanged: false,
        capabilityChanged,
        gyroFreshnessChanged: false,
        omegaCcwRadPerSec: null,
      };
    }

    const previousEventAt = this.lastEventAt;
    const dtMs = previousEventAt === null ? 0 : timestamp - previousEventAt;
    if (dtMs > PDR_MOTION_CONFIG.maxFrameGapMs) {
      this.resetDynamicState();
      this.activity = 'unknown';
    }
    this.lastEventAt = timestamp;
    const dtSec = dtMs > 0 && dtMs <= PDR_MOTION_CONFIG.maxFrameGapMs ? dtMs / 1000 : 0;

    // 1. Update low-pass gravity estimate (dt-aware for 15-100 Hz mobile streams).
    if (!this.gravInitialized) {
      this.gravX = ax;
      this.gravY = ay;
      this.gravZ = az;
      this.gravInitialized = true;
    } else if (dtSec > 0) {
      const alphaG = 1 - Math.exp(-dtSec / PDR_MOTION_CONFIG.gravityTauSec);
      this.gravX += alphaG * (ax - this.gravX);
      this.gravY += alphaG * (ay - this.gravY);
      this.gravZ += alphaG * (az - this.gravZ);
    }

    const gravNorm = Math.hypot(this.gravX, this.gravY, this.gravZ);
    if (gravNorm < PDR_MOTION_CONFIG.minValidAccelNormMps2) {
      return {
        step: null,
        activityChanged: this.activity !== prevActivity,
        capabilityChanged,
        gyroFreshnessChanged: this.gyroFreshSince !== previousGyroFreshSince,
        omegaCcwRadPerSec: null,
      };
    }

    // Unit vector pointing physically UP in device coordinates (invariant to phone tilt).
    const invGravNorm = this.convention.gravitySign / gravNorm;
    const ux = this.gravX * invGravNorm;
    const uy = this.gravY * invGravNorm;
    const uz = this.gravZ * invGravNorm;

    // 2. Tilt-invariant vertical linear acceleration (polarity-invariant step amplitude).
    const vertAccel = (ax - this.gravX) * ux + (ay - this.gravY) * uy + (az - this.gravZ) * uz;
    if (dtSec > 0) {
      const alphaS = 1 - Math.exp(-dtSec / PDR_MOTION_CONFIG.accelSmoothTauSec);
      this.smoothedVert += alphaS * (vertAccel - this.smoothedVert);
    } else {
      this.smoothedVert = vertAccel;
    }

    // 3. Integrate gravity-projected yaw & non-yaw handling tilt when live gyro is present.
    let omegaCcwRadPerSec: number | null = null;
    const omega = mapRotationRateRad(sample, this.convention.rotationAxisOrder);
    if (omega) {
      const omegaNorm = Math.hypot(omega.wx, omega.wy, omega.wz);
      if (!this.hasGyro && omegaNorm > 1e-6) {
        this.hasGyro = true;
        capabilityChanged = true;
      }
      // The expiry check above clears the previous timestamp across a sampling gap.
      const gyroDtSec = this.lastGyroAt === null ? 0 : (timestamp - this.lastGyroAt) / 1000;
      if (this.hasGyro) {
        this.lastGyroAt = timestamp;
        this.gyroFreshSince ??= timestamp;
      }
      if (this.hasGyro && gyroDtSec > 0) {
        if (
          this.activity === 'stationary' &&
          omegaNorm < PDR_MOTION_CONFIG.stationaryGyroBiasGateRadPerSec
        ) {
          const alphaB = 1 - Math.exp(-gyroDtSec / PDR_MOTION_CONFIG.gyroBiasTauSec);
          this.biasX = clamp(
            this.biasX + alphaB * (omega.wx - this.biasX),
            -PDR_MOTION_CONFIG.maxGyroBiasRadPerSec,
            PDR_MOTION_CONFIG.maxGyroBiasRadPerSec,
          );
          this.biasY = clamp(
            this.biasY + alphaB * (omega.wy - this.biasY),
            -PDR_MOTION_CONFIG.maxGyroBiasRadPerSec,
            PDR_MOTION_CONFIG.maxGyroBiasRadPerSec,
          );
          this.biasZ = clamp(
            this.biasZ + alphaB * (omega.wz - this.biasZ),
            -PDR_MOTION_CONFIG.maxGyroBiasRadPerSec,
            PDR_MOTION_CONFIG.maxGyroBiasRadPerSec,
          );
        }
        const cx = omega.wx - this.biasX;
        const cy = omega.wy - this.biasY;
        const cz = omega.wz - this.biasZ;
        // Projection onto physical UP axis yields counter-clockwise (left-turn positive) world yaw rate.
        const omegaCcw = cx * ux + cy * uy + cz * uz;
        const tiltX = cx - omegaCcw * ux;
        const tiltY = cy - omegaCcw * uy;
        const tiltZ = cz - omegaCcw * uz;
        const omegaTilt = Math.hypot(tiltX, tiltY, tiltZ);
        const effectiveCcw =
          this.activity === 'stationary' &&
          Math.abs(omegaCcw) < PDR_MOTION_CONFIG.stationaryYawDeadbandRadPerSec
            ? 0
            : omegaCcw;
        omegaCcwRadPerSec = effectiveCcw;
        this.accumulatedYawRad += effectiveCcw * gyroDtSec;
        this.accumulatedTiltNoiseRad += PDR_MOTION_CONFIG.tiltNoiseGain * omegaTilt * gyroDtSec;
      }
    }

    // 4. Rolling variance window for verified stationary vs. moving classification.
    this.window.push({ t: timestamp, v: this.smoothedVert });
    const cutoff = timestamp - PDR_MOTION_CONFIG.stationaryWindowMs;
    while (this.window.length > 0 && this.window[0].t < cutoff) {
      this.window.shift();
    }

    // 5. Peak-valley step detection FSM.
    const step = this.advanceStepFsm(this.smoothedVert, timestamp);

    // 6. Update activity classification (requires populated live window).
    this.updateActivity(timestamp, step !== null);

    return {
      step,
      activityChanged: this.activity !== prevActivity,
      capabilityChanged,
      gyroFreshnessChanged: this.gyroFreshSince !== previousGyroFreshSince,
      omegaCcwRadPerSec,
    };
  }

  private advanceStepFsm(f: number, timestamp: number): DetectedStep | null {
    if (this.fsm === 'idle') {
      if (f >= PDR_MOTION_CONFIG.minStepPeakMps2) {
        this.fsm = 'seeking-peak';
        this.peakVal = f;
        this.peakTime = timestamp;
        this.valleyVal = f;
        this.valleyTime = timestamp;
      }
      return null;
    }

    if (this.fsm === 'seeking-peak') {
      if (f > this.peakVal) {
        this.peakVal = f;
        this.peakTime = timestamp;
        return null;
      }
      if (f <= this.peakVal - PDR_MOTION_CONFIG.peakDropHysteresisMps2 || f <= 0) {
        this.fsm = 'seeking-valley';
        this.valleyVal = f;
        this.valleyTime = timestamp;
        return null;
      }
      if (timestamp - this.peakTime > PDR_MOTION_CONFIG.maxPeakAgeMs) {
        this.fsm = 'idle';
      }
      return null;
    }

    // seeking-valley
    if (f < this.valleyVal) {
      this.valleyVal = f;
      this.valleyTime = timestamp;
      return null;
    }

    if (timestamp - this.peakTime > PDR_MOTION_CONFIG.maxPeakToValleyMs + 400) {
      this.fsm = 'idle';
      return null;
    }

    if (
      this.valleyVal <= PDR_MOTION_CONFIG.minStepValleyMps2 &&
      f >= this.valleyVal + PDR_MOTION_CONFIG.valleyRiseHysteresisMps2
    ) {
      const span = this.peakVal - this.valleyVal;
      const peakToValleyMs = this.valleyTime - this.peakTime;
      const sinceLast = this.lastStepAt === null ? Infinity : timestamp - this.lastStepAt;
      this.fsm = f >= PDR_MOTION_CONFIG.minStepPeakMps2 ? 'seeking-peak' : 'idle';
      if (this.fsm === 'seeking-peak') {
        this.peakVal = f;
        this.peakTime = timestamp;
        this.valleyVal = f;
        this.valleyTime = timestamp;
      }

      if (
        span >= PDR_MOTION_CONFIG.minPeakToValleyMps2 &&
        span <= PDR_MOTION_CONFIG.maxPeakToValleyMps2 &&
        peakToValleyMs >= PDR_MOTION_CONFIG.minPeakToValleyMs &&
        peakToValleyMs <= PDR_MOTION_CONFIG.maxPeakToValleyMs &&
        sinceLast >= PDR_MOTION_CONFIG.minStepIntervalMs
      ) {
        const stepLengthMetres = clamp(
          PDR_MOTION_CONFIG.weinbergK * Math.pow(span, 0.25),
          PDR_MOTION_CONFIG.minStrideMetres,
          PDR_MOTION_CONFIG.maxStrideMetres,
        );
        const deltaYawRad = clamp(
          this.accumulatedYawRad,
          -PDR_MOTION_CONFIG.maxStepDeltaYawRad,
          PDR_MOTION_CONFIG.maxStepDeltaYawRad,
        );
        const turnNoiseRad = clamp(this.accumulatedTiltNoiseRad, 0, 1.0);
        this.accumulatedYawRad = 0;
        this.accumulatedTiltNoiseRad = 0;
        this.stepCount += 1;
        this.estimatedDistanceMetres += stepLengthMetres;
        this.lastStepAt = timestamp;
        const stepHasFreshGyro = this.gyroFreshSince !== null;
        return {
          stepIndex: this.stepCount,
          stepLengthMetres,
          deltaYawRad: stepHasFreshGyro ? deltaYawRad : 0,
          hasGyro: stepHasFreshGyro,
          turnNoiseRad: stepHasFreshGyro ? turnNoiseRad : 0,
          timestamp,
        };
      }
    }

    return null;
  }

  private updateActivity(timestamp: number, stepDetected: boolean) {
    if (stepDetected) {
      this.activity = 'moving';
      return;
    }
    if (this.window.length < 4) return;
    const spanMs = this.window[this.window.length - 1].t - this.window[0].t;
    if (spanMs < PDR_MOTION_CONFIG.minStationaryWindowMs) return;

    let sum = 0;
    for (const item of this.window) sum += item.v;
    const mean = sum / this.window.length;
    let sq = 0;
    for (const item of this.window) {
      const diff = item.v - mean;
      sq += diff * diff;
    }
    const variance = sq / this.window.length;
    const sinceStep = this.lastStepAt === null ? Infinity : timestamp - this.lastStepAt;

    if (this.activity === 'stationary') {
      if (variance > PDR_MOTION_CONFIG.stationaryExitVar) {
        this.activity = 'moving';
      }
    } else if (
      variance < PDR_MOTION_CONFIG.stationaryEnterVar &&
      sinceStep > PDR_MOTION_CONFIG.stationaryHoldAfterStepMs
    ) {
      this.activity = 'stationary';
    } else if (this.activity === 'unknown') {
      this.activity = 'moving';
    }
  }

  snapshot(): Omit<MotionSnapshot, 'supported' | 'permission' | 'active'> {
    return {
      hasAccel: this.hasAccel,
      hasGyro: this.hasGyro,
      gyroFresh: this.gyroFreshSince !== null,
      gyroFreshSince: this.gyroFreshSince,
      activity: this.activity,
      stepCount: this.stepCount,
      estimatedDistanceMetres: this.estimatedDistanceMetres,
      lastStepAt: this.lastStepAt,
      lastEventAt: this.lastEventAt,
    };
  }
}
