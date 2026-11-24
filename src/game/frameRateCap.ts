import type * as THREE from 'three';
import { getWebGLRendererString, isLowEndRendererString } from './potatoShader';

export type HardwareTier = 'LOW' | 'MEDIUM' | 'HIGH';

export type FrameRateCapOption = 'AUTO' | 30 | 60 | 120 | 144 | 'UNCAPPED';

export const HARDWARE_TIER_DEFAULT_FPS: Record<HardwareTier, 30 | 60 | 144> = {
  LOW: 30,
  MEDIUM: 60,
  HIGH: 144,
};

export interface FrameRateCapDropdownItem {
  value: FrameRateCapOption;
  selectValue: string;
  label: string;
}

export const FRAME_RATE_CAP_OPTIONS: readonly FrameRateCapDropdownItem[] = [
  { value: 'AUTO', selectValue: 'AUTO', label: 'Auto (recommended)' },
  { value: 30, selectValue: '30', label: '30 FPS' },
  { value: 60, selectValue: '60', label: '60 FPS' },
  { value: 120, selectValue: '120', label: '120 FPS' },
  { value: 144, selectValue: '144', label: '144 FPS' },
  { value: 'UNCAPPED', selectValue: 'UNCAPPED', label: 'Uncapped' },
] as const;

export interface HardwareProfile {
  /** True when existing PENTIUM / low-end GPU detection triggers */
  isLowEndGpu?: boolean;
  /** Raw WebGL RENDERER / UNMASKED_RENDERER_WEBGL string */
  gpuRenderer?: string;
  /** navigator.hardwareConcurrency */
  hardwareConcurrency?: number;
  /** navigator.deviceMemory in GB (Chromium/Android) */
  deviceMemoryGB?: number;
  /** True on mobile/tablet touch devices */
  isMobile?: boolean;
  /** Optional user-agent string for mobile/CPU hints */
  userAgent?: string;
}

export interface HardwareTierDetectionResult {
  tier: HardwareTier;
  defaultFpsCap: 30 | 60 | 144;
  reason: string;
  gpuRenderer: string;
}

const DISCRETE_GPU_PATTERNS: readonly RegExp[] = [
  // NVIDIA GeForce / RTX / GTX / Quadro / Titan (discrete desktop & laptop dGPU)
  /\b(nvidia|geforce|rtx|gtx|quadro|titan)\b/i,
  // AMD Radeon discrete GPUs (RX series, R7/R9, Radeon Pro, Vega 56/64/Frontier, Radeon VII, HD 7xxx-9xxx)
  /\bradeon\s*(rx|r9|r7|pro|vii|hd\s*[789]\d{3})\b/i,
  /\bamd\s+radeon\s+rx\b/i,
  /\bvega\s*(56|64|frontier)\b/i,
  // Intel Arc discrete GPUs (A-series / B-series, e.g. "Intel(R) Arc(TM) A770 Graphics")
  /\bintel.*arc(?:\s*\(tm\))?\s+[ab]\d{3}\b/i,
  // Apple Silicon desktop/laptop M-series GPUs
  /\bapple\s+m[1-9]\b/i,
];

const FLAGSHIP_MOBILE_GPU_PATTERNS: readonly RegExp[] = [
  // Qualcomm Adreno 7xx / 8xx (Snapdragon 8 Gen 1/2/3/Elite)
  /\badreno\s*(\(tm\)\s*)?[78]\d{2}\b/i,
  // ARM Immortalis (Dimensity 9200 / 9300 / 9400 flagships)
  /\bimmortalis\b/i,
  // ARM Mali-G710 / G715 / G720 (flagship SoCs; explicitly excludes mid-range Mali-G57 / G68 / G77)
  /\bmali-g7[12]\d\b/i,
  // Samsung Xclipse 9xx (Exynos flagship)
  /\bxclipse\s*9\d{2}\b/i,
  // Apple A15+ flagship mobile chips
  /\bapple\s+a(1[5-9]|[2-9]\d)\b/i,
];

const LOW_END_MOBILE_GPU_PATTERNS: readonly RegExp[] = [
  /\bmali-4\d{2}\b/i,
  /\bmali-t[678]\d{2}\b/i,
  /\badreno\s*(\(tm\)\s*)?[34]\d{2}\b/i,
  /\bpowervr\s+(sgx|ge8[123]\d{2})\b/i,
];

/**
 * Returns true if the WebGL renderer string identifies a discrete desktop/laptop GPU
 * or Apple M-series GPU (excluding software/low-end renderers).
 */
export function isDiscreteGpuRenderer(rendererStr: string): boolean {
  if (!rendererStr || isLowEndRendererString(rendererStr)) return false;
  for (let i = 0; i < DISCRETE_GPU_PATTERNS.length; i++) {
    if (DISCRETE_GPU_PATTERNS[i].test(rendererStr)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the WebGL renderer string identifies a flagship mobile GPU
 * (e.g. Adreno 7xx/8xx, Immortalis, Mali-G715/G720, Xclipse 9xx, Apple A15+).
 * Mid-range mobile GPUs such as Dimensity 6300 (Mali-G57 MC2), Mali-G68, and Adreno 6xx return false.
 */
export function isFlagshipMobileGpuRenderer(rendererStr: string): boolean {
  if (!rendererStr || isLowEndRendererString(rendererStr)) return false;
  for (let i = 0; i < FLAGSHIP_MOBILE_GPU_PATTERNS.length; i++) {
    if (FLAGSHIP_MOBILE_GPU_PATTERNS[i].test(rendererStr)) {
      return true;
    }
  }
  return false;
}

function isLowEndMobileGpuRenderer(rendererStr: string): boolean {
  if (!rendererStr) return false;
  for (let i = 0; i < LOW_END_MOBILE_GPU_PATTERNS.length; i++) {
    if (LOW_END_MOBILE_GPU_PATTERNS[i].test(rendererStr)) {
      return true;
    }
  }
  return false;
}

/**
 * Pure, deterministic hardware tier classifier.
 *
 * Tiers:
 * - LOW (30 FPS): PENTIUM/Celeron/Intel HD/software GPU, <= 2 CPU cores, or mobile/integrated device with < 4GB RAM.
 * - HIGH (144 FPS): Discrete GPU, or flagship mobile GPU (with >= 8GB RAM or unspecified Safari memory).
 * - MEDIUM (60 FPS): Mid-range desktop & mid-range mobile (e.g. Dimensity 6300 / Mali-G57 / Intel Iris / AMD iGPU).
 */
export function detectHardwareTierFromProfile(
  profile: HardwareProfile,
): HardwareTierDetectionResult {
  const gpuRenderer = (profile.gpuRenderer ?? '').trim();
  const cores =
    typeof profile.hardwareConcurrency === 'number' && Number.isFinite(profile.hardwareConcurrency) && profile.hardwareConcurrency > 0
      ? profile.hardwareConcurrency
      : undefined;
  const memGB =
    typeof profile.deviceMemoryGB === 'number' && Number.isFinite(profile.deviceMemoryGB) && profile.deviceMemoryGB > 0
      ? profile.deviceMemoryGB
      : undefined;
  const ua = (profile.userAgent ?? '').toLowerCase();
  const isMobile =
    profile.isMobile === true ||
    /android|iphone|ipad|ipod|mobile/i.test(ua);

  const lowEndGpu =
    profile.isLowEndGpu === true ||
    isLowEndRendererString(gpuRenderer) ||
    isLowEndMobileGpuRenderer(gpuRenderer);

  const discreteGpu = !lowEndGpu && isDiscreteGpuRenderer(gpuRenderer);

  // 1. LOW tier (30 FPS): PENTIUM mode trigger, low-end GPU, <= 2 cores, or < 4GB RAM (mobile or non-discrete)
  if (lowEndGpu) {
    return {
      tier: 'LOW',
      defaultFpsCap: HARDWARE_TIER_DEFAULT_FPS.LOW,
      reason: 'Low-end / Intel HD / software GPU detected (PENTIUM tier)',
      gpuRenderer,
    };
  }
  if (cores !== undefined && cores <= 2) {
    return {
      tier: 'LOW',
      defaultFpsCap: HARDWARE_TIER_DEFAULT_FPS.LOW,
      reason: `Low CPU core count (${cores} cores)`,
      gpuRenderer,
    };
  }
  if (memGB !== undefined && memGB < 4 && (isMobile || !discreteGpu)) {
    return {
      tier: 'LOW',
      defaultFpsCap: HARDWARE_TIER_DEFAULT_FPS.LOW,
      reason: `${isMobile ? 'Mobile' : 'System'} RAM below 4GB (${memGB}GB)`,
      gpuRenderer,
    };
  }

  // 2. HIGH tier (144 FPS): Discrete GPU, or flagship mobile GPU with 8GB+ RAM (or iOS where deviceMemory is omitted)
  if (discreteGpu) {
    return {
      tier: 'HIGH',
      defaultFpsCap: HARDWARE_TIER_DEFAULT_FPS.HIGH,
      reason: 'Discrete GPU detected',
      gpuRenderer,
    };
  }
  if (isFlagshipMobileGpuRenderer(gpuRenderer) && (memGB === undefined || memGB >= 8)) {
    return {
      tier: 'HIGH',
      defaultFpsCap: HARDWARE_TIER_DEFAULT_FPS.HIGH,
      reason: 'Flagship mobile GPU detected',
      gpuRenderer,
    };
  }

  // 3. MEDIUM tier (60 FPS): Mid-range desktop & mid-range mobile (e.g. Dimensity 6300)
  return {
    tier: 'MEDIUM',
    defaultFpsCap: HARDWARE_TIER_DEFAULT_FPS.MEDIUM,
    reason: isMobile ? 'Mid-range mobile hardware' : 'Mid-range integrated / desktop hardware',
    gpuRenderer,
  };
}

let cachedHardwareTier: HardwareTierDetectionResult | null = null;
let cachedHardwareTierWithRenderer: HardwareTierDetectionResult | null = null;

/**
 * Detects the current browser's hardware tier once at startup using the existing
 * WebGL renderer / PENTIUM detection plus navigator.hardwareConcurrency & deviceMemory.
 */
export function detectHardwareTier(
  glOrRenderer?: WebGLRenderingContext | WebGL2RenderingContext | THREE.WebGLRenderer | string | null,
  options?: { isMobile?: boolean; isLowEndGpu?: boolean; forceRefresh?: boolean },
): HardwareTierDetectionResult {
  if (!options?.forceRefresh) {
    if (glOrRenderer && cachedHardwareTierWithRenderer) {
      return cachedHardwareTierWithRenderer;
    }
    if (!glOrRenderer && cachedHardwareTier) {
      return cachedHardwareTier;
    }
  }

  const gpuRenderer = getWebGLRendererString(glOrRenderer);
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const hardwareConcurrency =
    nav && typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined;
  const deviceMemoryGB =
    nav && typeof (nav as Navigator & { deviceMemory?: number }).deviceMemory === 'number'
      ? (nav as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined;
  const userAgent = nav?.userAgent ?? '';

  const result = detectHardwareTierFromProfile({
    isLowEndGpu: options?.isLowEndGpu,
    gpuRenderer,
    hardwareConcurrency,
    deviceMemoryGB,
    isMobile: options?.isMobile,
    userAgent,
  });

  if (glOrRenderer) {
    cachedHardwareTierWithRenderer = result;
  }
  cachedHardwareTier = result;
  return result;
}

export function sanitizeFrameRateCap(
  val: unknown,
  fallback: FrameRateCapOption = 'AUTO',
): FrameRateCapOption {
  if (val === 'AUTO' || val === 'auto') return 'AUTO';
  if (val === 'UNCAPPED' || val === 'uncapped' || val === 0 || val === '0') return 'UNCAPPED';
  const num = typeof val === 'number' ? val : typeof val === 'string' ? Number(val) : NaN;
  if (num === 30 || num === 60 || num === 120 || num === 144) {
    return num;
  }
  return fallback;
}

export function parseFrameRateCapInput(raw: string): FrameRateCapOption {
  return sanitizeFrameRateCap(raw, 'AUTO');
}

/**
 * Resolves the effective numeric render FPS cap (0 = uncapped).
 */
export function resolveTargetFps(
  cap: FrameRateCapOption,
  tier: HardwareTier,
): number {
  if (cap === 'UNCAPPED') return 0;
  if (cap === 'AUTO') return HARDWARE_TIER_DEFAULT_FPS[tier] ?? 60;
  return cap;
}

/**
 * Returns the minimum frame interval in milliseconds for the given target FPS (0 = uncapped).
 */
export function computeFrameCapTargetMs(targetFps: number): number {
  if (!Number.isFinite(targetFps) || targetFps <= 0) return 0;
  return 1000 / targetFps;
}

/**
 * Returns true if enough time has elapsed since `lastRenderMs` to render the next frame
 * under `targetFps` (0 = uncapped). Includes a small vsync jitter margin (0.75–1.5ms / 12%)
 * so 60Hz/120Hz/144Hz browser rAF ticks that arrive slightly early do not halve the FPS.
 */
export function shouldRenderCappedFrame(
  nowMs: number,
  lastRenderMs: number,
  targetFps: number,
): boolean {
  const targetMs = computeFrameCapTargetMs(targetFps);
  if (targetMs <= 0) return true;
  const elapsedMs = nowMs - lastRenderMs;
  if (elapsedMs < 0) return true;
  const jitterMarginMs = Math.min(1.5, Math.max(0.75, targetMs * 0.12));
  return elapsedMs >= targetMs - jitterMarginMs;
}

export function formatFrameRateCapSummary(
  cap: FrameRateCapOption,
  tier: HardwareTier,
): string {
  const targetFps = resolveTargetFps(cap, tier);
  if (cap === 'UNCAPPED' || targetFps <= 0) {
    return 'Uncapped (Unlimited)';
  }
  if (cap === 'AUTO') {
    return `Auto · ${tier} Tier (${targetFps} FPS)`;
  }
  return `${targetFps} FPS (Manual)`;
}
