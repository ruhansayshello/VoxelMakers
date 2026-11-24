/**
 * Adaptive Low-FPS Slow-Motion Governor & Anti-Freeze Main-Thread Watchdog
 *
 * Solves two critical browser game engineering problems:
 * 1. Low-FPS Stutter & Physics "Spiral of Death":
 *    When frame rates drop (e.g., during massive voxel explosions or multi-vehicle collisions),
 *    instead of jumping in large choppy physics steps or running unbounded catch-up substeps,
 *    the governor smoothly dilates simulation time (`timeScale` down to 0.28x).
 *    Physics steps stay 1:1 with rendered frames at a stabilized step size, turning lag spikes
 *    into smooth cinematic "Bullet-Time" slow-motion that automatically recovers to 1.0x.
 *
 * 2. Browser "Page Unresponsive" Dialog Prevention:
 *    Browsers trigger the "Page Unresponsive" popup when the main JS thread does not yield
 *    to the event loop for several seconds. The Watchdog enforces strict per-frame millisecond
 *    deadlines for chunk generation/meshing, queues chain explosions across frames, clamps
 *    background-tab delta spikes, and sheds non-essential per-frame work (waves/debris/sync meshes)
 *    whenever frame times spike.
 */

export interface FrameGovernorConfig {
  autoSlowMoEnabled: boolean;
  manualSlowMoActive: boolean;
  antiFreezeWatchdogEnabled: boolean;
  /** FPS below which automatic slow-motion begins to engage (default: 42 FPS) */
  targetMinFps: number;
  /** Minimum simulation speed multiplier during heavy load (default: 0.28x) */
  minTimeScale: number;
  /** Simulation speed multiplier when manual slow-mo [V] is active (default: 0.35x) */
  manualTimeScale: number;
  /** Optional intentional render FPS cap (0 or undefined = uncapped). Prevents false slow-mo at 30 FPS cap. */
  targetFpsCap?: number;
}

export interface FrameGovernorState {
  emaFrameMs: number;
  smoothedFps: number;
  currentTimeScale: number;
  consecutiveHeavyFrames: number;
  watchdogTrippedCount: number;
  frameCount: number;
}

export interface FrameWatchdogDirectives {
  /** True when the anti-freeze watchdog is actively shedding load to protect the main thread */
  isProtecting: boolean;
  /** Maximum milliseconds allowed for chunk streaming/meshing this frame before yielding */
  chunkBudgetMs: number;
  /** Maximum synchronous main-thread chunk rebuilds allowed this frame (0 = worker async only) */
  maxSyncChunkRebuilds: number;
  /** Whether to skip expensive CPU water wave matrix updates on this frame */
  shouldSkipWaveUpdate: boolean;
  /** Multiplier [0.25 .. 1.0] for particle debris spawning during explosions */
  debrisSpawnMultiplier: number;
  /** Maximum queued chain explosions to process on this frame */
  maxExplosionsThisFrame: number;
}

export interface FrameGovernorStepResult {
  /** Stabilized, time-dilated delta time (seconds) to feed into vehicle & world physics */
  simDt: number;
  /** Clamped visual delta time (seconds) for camera & UI animations */
  visualDt: number;
  /** Current active simulation speed multiplier [minTimeScale .. 1.0] */
  timeScale: number;
  /** True if either automatic low-FPS slow-mo or manual slow-mo is currently slowing time */
  isSlowMoActive: boolean;
  /** Reason slow-mo is active: 'NONE' | 'AUTO_FPS' | 'MANUAL' */
  slowMoReason: 'NONE' | 'AUTO_FPS' | 'MANUAL';
  /** Smoothed FPS reading */
  smoothedFps: number;
  /** Smoothed frame duration in milliseconds */
  emaFrameMs: number;
  /** Anti-freeze main-thread budget directives for this frame */
  watchdog: FrameWatchdogDirectives;
}

const STORAGE_KEY_AUTO_SLOWMO = 'voxelmakers_auto_slowmo_v1';
const STORAGE_KEY_ANTIFREEZE = 'voxelmakers_antifreeze_v1';
const STORAGE_KEY_CRASH_SLOWMO = 'voxelmakers_crash_slowmo_v1';

export function getStoredCrashSlowMo(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_CRASH_SLOWMO);
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
  } catch {
    // Ignore storage errors
  }
  return true;
}

export function setStoredCrashSlowMo(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(STORAGE_KEY_CRASH_SLOWMO, enabled ? '1' : '0');
  } catch {
    // Ignore storage errors
  }
}

export function getStoredAutoSlowMo(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_AUTO_SLOWMO);
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
  } catch {
    // Ignore storage errors
  }
  return true;
}

export function setStoredAutoSlowMo(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(STORAGE_KEY_AUTO_SLOWMO, enabled ? '1' : '0');
  } catch {
    // Ignore storage errors
  }
}

export function getStoredAntiFreezeWatchdog(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_ANTIFREEZE);
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
  } catch {
    // Ignore storage errors
  }
  return true;
}

export function setStoredAntiFreezeWatchdog(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(STORAGE_KEY_ANTIFREEZE, enabled ? '1' : '0');
  } catch {
    // Ignore storage errors
  }
}

export function createInitialFrameGovernorState(): FrameGovernorState {
  return {
    emaFrameMs: 16.67,
    smoothedFps: 60,
    currentTimeScale: 1.0,
    consecutiveHeavyFrames: 0,
    watchdogTrippedCount: 0,
    frameCount: 0,
  };
}

export function createDefaultFrameGovernorConfig(): FrameGovernorConfig {
  return {
    autoSlowMoEnabled: getStoredAutoSlowMo(),
    manualSlowMoActive: false,
    antiFreezeWatchdogEnabled: getStoredAntiFreezeWatchdog(),
    targetMinFps: 42,
    minTimeScale: 0.28,
    manualTimeScale: 0.35,
  };
}

/**
 * Advances the Frame Governor by one animation frame and returns the stabilized `simDt`,
 * `timeScale`, and Anti-Freeze Watchdog directives.
 */
export function stepFrameGovernor(
  state: FrameGovernorState,
  rawDeltaSec: number,
  config: FrameGovernorConfig,
): FrameGovernorStepResult {
  state.frameCount++;

  // 1. Detect tab-switch / window-minimize hibernation spikes (> 250ms).
  // Never accumulate or penalize a backgrounded tab; treat resumption as a clean 60Hz tick.
  const isTabResumeSpike = !Number.isFinite(rawDeltaSec) || rawDeltaSec > 0.25 || rawDeltaSec <= 0;
  const effectiveRawSec = isTabResumeSpike
    ? 1 / 60
    : Math.max(0.0005, rawDeltaSec);
  const rawFrameMs = effectiveRawSec * 1000;

  // 2. Update Exponential Moving Average (EMA) of frame time.
  // Use faster alpha (0.28) when frame time spikes so slow-mo & watchdog react immediately,
  // and smoother alpha (0.12) when recovering.
  const emaAlpha = rawFrameMs > state.emaFrameMs ? 0.28 : 0.12;
  state.emaFrameMs = state.emaFrameMs + (rawFrameMs - state.emaFrameMs) * emaAlpha;
  state.smoothedFps = Math.max(1, Math.min(240, Math.round(1000 / state.emaFrameMs)));

  // Track consecutive heavy frames (> 45ms / < 22 FPS)
  if (!isTabResumeSpike && rawFrameMs > 45.0) {
    state.consecutiveHeavyFrames++;
  } else {
    state.consecutiveHeavyFrames = Math.max(0, state.consecutiveHeavyFrames - 1);
  }

  // 3. Compute Adaptive Slow-Motion Time Scale
  let targetTimeScale = 1.0;
  let slowMoReason: 'NONE' | 'AUTO_FPS' | 'MANUAL' = 'NONE';

  // Adjust slow-mo floor when an intentional render FPS cap is active (e.g. 30 FPS on LOW tier)
  const activeFpsCap =
    typeof config.targetFpsCap === 'number' && Number.isFinite(config.targetFpsCap) && config.targetFpsCap > 0
      ? config.targetFpsCap
      : 0;
  const effectiveTargetMinFps =
    activeFpsCap > 0
      ? Math.min(config.targetMinFps, Math.max(12, Math.floor(activeFpsCap * 0.72)))
      : config.targetMinFps;

  if (config.autoSlowMoEnabled) {
    // Use the worse of instantaneous frame time vs smoothed EMA frame time
    // so a sudden heavy frame immediately cushions the physics step
    const blendedFrameMs = Math.max(state.emaFrameMs, rawFrameMs * 0.85);
    const effectiveFps = 1000 / Math.max(1, blendedFrameMs);

    if (effectiveFps < effectiveTargetMinFps) {
      const ratio = effectiveFps / Math.max(10, effectiveTargetMinFps);
      targetTimeScale = Math.max(
        config.minTimeScale,
        Math.min(1.0, ratio),
      );
      if (targetTimeScale < 0.94) {
        slowMoReason = 'AUTO_FPS';
      }
    }
  }

  if (config.manualSlowMoActive) {
    targetTimeScale = Math.min(targetTimeScale, config.manualTimeScale);
    slowMoReason = 'MANUAL';
  }

  // Asymmetric attack/release interpolation:
  // Fast attack (engages immediately on lag spike) + gentle release (smooth recovery to 1.0x)
  const interpDt = Math.min(0.05, effectiveRawSec);
  const rate = targetTimeScale < state.currentTimeScale ? 16.0 : 3.2;
  const blend = Math.min(1.0, rate * interpDt);
  state.currentTimeScale =
    state.currentTimeScale + (targetTimeScale - state.currentTimeScale) * blend;

  if (state.currentTimeScale > 0.97 && targetTimeScale === 1.0) {
    state.currentTimeScale = 1.0;
  }
  const timeScale = Number(
    Math.max(config.minTimeScale, Math.min(1.0, state.currentTimeScale)).toFixed(3),
  );

  const isSlowMoActive = timeScale < 0.93 || config.manualSlowMoActive;
  if (!isSlowMoActive) {
    slowMoReason = 'NONE';
  } else if (slowMoReason === 'NONE') {
    slowMoReason = config.manualSlowMoActive ? 'MANUAL' : 'AUTO_FPS';
  }

  // 4. Compute stabilized physics step `simDt`:
  // When adaptive slow-mo is active during low FPS, we lock the base reference step
  // to at most 1/45s (22.2ms) scaled by `timeScale`. This guarantees physics never takes
  // a huge spatial leap on a slow frame, eliminating micro-stutter and rocket-launch instabilities.
  const visualDt = Math.min(0.05, effectiveRawSec);
  const basePhysicsStep = config.autoSlowMoEnabled
    ? Math.min(effectiveRawSec, 1 / 45)
    : visualDt;
  const simDt = basePhysicsStep * timeScale;

  // 5. Compute Anti-Freeze Main-Thread Watchdog Directives
  let watchdog: FrameWatchdogDirectives;
  if (!config.antiFreezeWatchdogEnabled) {
    watchdog = {
      isProtecting: false,
      chunkBudgetMs: 10.0,
      maxSyncChunkRebuilds: 2,
      shouldSkipWaveUpdate: false,
      debrisSpawnMultiplier: 1.0,
      maxExplosionsThisFrame: 3,
    };
  } else {
    const capFrameMs = activeFpsCap > 0 ? 1000 / activeFpsCap : 0;
    const severeRawThresholdMs = Math.max(55.0, capFrameMs * 1.85);
    const severeEmaThresholdMs = Math.max(42.0, capFrameMs * 1.55);
    const moderateRawThresholdMs = Math.max(30.0, capFrameMs * 1.35);
    const moderateEmaThresholdMs = Math.max(28.0, capFrameMs * 1.25);
    const isSevereSpike =
      rawFrameMs > severeRawThresholdMs ||
      state.emaFrameMs > severeEmaThresholdMs ||
      state.consecutiveHeavyFrames >= 2;
    const isModerateSpike =
      rawFrameMs > moderateRawThresholdMs || state.emaFrameMs > moderateEmaThresholdMs;

    if (isSevereSpike) {
      state.watchdogTrippedCount++;
    }

    watchdog = {
      isProtecting: isSevereSpike,
      chunkBudgetMs: isSevereSpike ? 1.5 : isModerateSpike ? 4.0 : 8.5,
      maxSyncChunkRebuilds: isSevereSpike ? 0 : isModerateSpike ? 1 : 2,
      // Skip CPU water wave instanced matrix loop on alternate frames during heavy stalls
      shouldSkipWaveUpdate: isSevereSpike && state.frameCount % 2 === 1,
      debrisSpawnMultiplier: isSevereSpike ? 0.3 : isModerateSpike ? 0.65 : 1.0,
      maxExplosionsThisFrame: isSevereSpike ? 1 : 2,
    };
  }

  return {
    simDt,
    visualDt,
    timeScale,
    isSlowMoActive,
    slowMoReason,
    smoothedFps: state.smoothedFps,
    emaFrameMs: Number(state.emaFrameMs.toFixed(1)),
    watchdog,
  };
}
