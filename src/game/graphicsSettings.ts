/**
 * Graphics & Post-Processing Settings, Presets, and Pure Math Helpers for TerraSmash
 *
 * Covers all 15 graphics features:
 *  1. Dynamic Shadow Maps (PCFSoft)
 *  2. Screen-Space Ambient Occlusion (SSAO)
 *  3. Screen-Space Reflections (SSR)
 *  4. HDR Bloom & Emissive Glow
 *  5. Resolution Scale / Super-Sampling (0.5x – 2.0x)
 *  6. Volumetric God Rays & Light Shafts
 *  7. Motion Blur
 *  8. Depth of Field (Bokeh DOF)
 *  9. Volumetric Smoke & Dust Raymarching
 * 10. Screen-Space Contact Shadows
 * 11. Temporal Anti-Aliasing (TAA)
 * 12. Chromatic Aberration & Lens Distortion
 * 13. Particle & Spark Count Multiplier
 * 14. Real-Time Planar Mirror Reflections
 * 15. Voxel Draw Distance / Uncapped Chunk LOD
 */

import {
  sanitizeFrameRateCap,
  type FrameRateCapOption,
  type HardwareTier,
} from './frameRateCap';

export type { FrameRateCapOption, HardwareTier };

export type GraphicsPresetId =
  | 'PENTIUM'
  | 'CARTOON'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'ULTRA'
  | 'CUSTOM';

export type ShadowMapResolution = 512 | 1024 | 2048 | 4096;
export type PlanarReflectionResolution = 256 | 512 | 1024;

export interface GraphicsSettings {
  preset: GraphicsPresetId;

  // Adaptive Render Frame Rate Cap (default 'AUTO' — never uncapped by default)
  frameRateCap: FrameRateCapOption;

  // 1. Dynamic Shadow Maps (PCFSoft) & Vehicle Blob Shadows
  dynamicShadows: boolean;
  shadowMapSize: ShadowMapResolution;
  shadowSoftness: number; // 0.5 .. 2.5
  blobShadows: boolean;

  // Potato Mode (PENTIUM) Cel + Rim Shader / Cartoon Mode (Comic Cel + Outline) vs. Standard PBR/Lambert Materials
  usePBR: boolean;
  usePotatoShader: boolean;
  useCartoonShader: boolean;

  // 2. Screen-Space Ambient Occlusion (SSAO)
  ssaoEnabled: boolean;
  ssaoIntensity: number; // 0.1 .. 2.0
  ssaoRadius: number; // 0.2 .. 2.0

  // 3. Screen-Space Reflections (SSR)
  ssrEnabled: boolean;
  ssrIntensity: number; // 0.1 .. 1.5

  // 4. HDR Bloom & Emissive Glow (plus Single-Pass Cheap Bloom for PENTIUM)
  bloomEnabled: boolean;
  cheapBloom: boolean;
  bloomStrength: number; // 0.1 .. 2.5
  bloomThreshold: number; // 0.3 .. 0.95

  // 5. Resolution Scale / Super-Sampling (0.5x – 2.0x)
  resolutionScale: number; // 0.5 .. 2.0

  // 6. Volumetric God Rays & Light Shafts
  godRaysEnabled: boolean;
  godRaysIntensity: number; // 0.1 .. 1.5

  // 7. Motion Blur
  motionBlurEnabled: boolean;
  motionBlurStrength: number; // 0.1 .. 1.5

  // 8. Depth of Field (Bokeh DOF)
  dofEnabled: boolean;
  dofFocusDistance: number; // 4 .. 160 meters
  dofAperture: number; // 0.1 .. 2.0

  // 9. Volumetric Smoke & Dust Raymarching
  volumetricSmokeEnabled: boolean;
  volumetricSmokeDensity: number; // 0.1 .. 2.0

  // 10. Screen-Space Contact Shadows
  contactShadowsEnabled: boolean;
  contactShadowsIntensity: number; // 0.1 .. 1.5

  // 11. Temporal Anti-Aliasing (TAA)
  taaEnabled: boolean;
  taaBlendFactor: number; // 0.5 .. 0.94

  // 12. Chromatic Aberration & Lens Distortion
  chromaticAberrationEnabled: boolean;
  chromaticAberrationIntensity: number; // 0.0 .. 2.0
  lensDistortion: number; // -0.4 .. 0.4

  // 13. Particle & Spark Count Multiplier
  particleMultiplier: number; // 0.25 .. 3.0

  // 14. Real-Time Planar Mirror Reflections
  planarReflectionsEnabled: boolean;
  planarReflectionResolution: PlanarReflectionResolution;

  // 15. Voxel Draw Distance / Uncapped Chunk LOD
  voxelDrawDistance: number; // 2 .. 16 chunks
  uncappedChunkLod: boolean;

  // 16. Animated 3D Voxel Ocean Waves (GPU Shader + CPU Buoyancy)
  waveQuality: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

  // 17. Atmospheric Distance Fog
  fog: boolean;
}

const STORAGE_KEY_GRAPHICS = 'terrasmash_graphics_settings_v1';

export function clampNum(val: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

export function sanitizeShadowMapSize(val: number): ShadowMapResolution {
  if (val >= 3072) return 4096;
  if (val >= 1536) return 2048;
  if (val >= 768) return 1024;
  return 512;
}

export function sanitizePlanarResolution(val: number): PlanarReflectionResolution {
  if (val >= 768) return 1024;
  if (val >= 384) return 512;
  return 256;
}

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPresetId, 'CUSTOM'>, GraphicsSettings> = {
  PENTIUM: {
    preset: 'PENTIUM',
    dynamicShadows: false,
    shadowMapSize: 512,
    shadowSoftness: 1.0,
    blobShadows: true,
    usePBR: false,
    usePotatoShader: true,
    useCartoonShader: false,
    ssaoEnabled: false,
    ssaoIntensity: 0.6,
    ssaoRadius: 0.8,
    ssrEnabled: false,
    ssrIntensity: 0.4,
    bloomEnabled: false,
    cheapBloom: false,
    bloomStrength: 0.55,
    bloomThreshold: 0.72,
    resolutionScale: 0.6,
    godRaysEnabled: false,
    godRaysIntensity: 0.4,
    motionBlurEnabled: false,
    motionBlurStrength: 0.35,
    dofEnabled: false,
    dofFocusDistance: 24,
    dofAperture: 0.5,
    volumetricSmokeEnabled: false,
    volumetricSmokeDensity: 0.5,
    contactShadowsEnabled: false,
    contactShadowsIntensity: 0.5,
    taaEnabled: false,
    taaBlendFactor: 0.8,
    chromaticAberrationEnabled: false,
    chromaticAberrationIntensity: 0.25,
    lensDistortion: 0.0,
    particleMultiplier: 0.4,
    planarReflectionsEnabled: false,
    planarReflectionResolution: 256,
    voxelDrawDistance: 3,
    uncappedChunkLod: false,
    waveQuality: 'OFF',
    fog: true,
    frameRateCap: 'AUTO',
  },
  CARTOON: {
    preset: 'CARTOON',
    dynamicShadows: true,
    shadowMapSize: 1024,
    shadowSoftness: 0.9,
    blobShadows: true,
    usePBR: false,
    usePotatoShader: false,
    useCartoonShader: true,
    ssaoEnabled: false,
    ssaoIntensity: 0.6,
    ssaoRadius: 0.8,
    ssrEnabled: false,
    ssrIntensity: 0.4,
    bloomEnabled: true,
    cheapBloom: true,
    bloomStrength: 0.65,
    bloomThreshold: 0.72,
    resolutionScale: 0.85,
    godRaysEnabled: false,
    godRaysIntensity: 0.4,
    motionBlurEnabled: false,
    motionBlurStrength: 0.35,
    dofEnabled: false,
    dofFocusDistance: 24,
    dofAperture: 0.5,
    volumetricSmokeEnabled: false,
    volumetricSmokeDensity: 0.5,
    contactShadowsEnabled: false,
    contactShadowsIntensity: 0.5,
    taaEnabled: false,
    taaBlendFactor: 0.8,
    chromaticAberrationEnabled: false,
    chromaticAberrationIntensity: 0.25,
    lensDistortion: 0.0,
    particleMultiplier: 0.85,
    planarReflectionsEnabled: false,
    planarReflectionResolution: 256,
    voxelDrawDistance: 4,
    uncappedChunkLod: false,
    waveQuality: 'MEDIUM',
    fog: true,
    frameRateCap: 'AUTO',
  },
  LOW: {
    preset: 'LOW',
    dynamicShadows: false,
    shadowMapSize: 512,
    shadowSoftness: 1.0,
    blobShadows: true,
    usePBR: true,
    usePotatoShader: false,
    useCartoonShader: false,
    ssaoEnabled: false,
    ssaoIntensity: 0.6,
    ssaoRadius: 0.8,
    ssrEnabled: false,
    ssrIntensity: 0.4,
    bloomEnabled: false,
    cheapBloom: false,
    bloomStrength: 0.5,
    bloomThreshold: 0.75,
    resolutionScale: 0.55,
    godRaysEnabled: false,
    godRaysIntensity: 0.4,
    motionBlurEnabled: false,
    motionBlurStrength: 0.35,
    dofEnabled: false,
    dofFocusDistance: 24,
    dofAperture: 0.5,
    volumetricSmokeEnabled: false,
    volumetricSmokeDensity: 0.5,
    contactShadowsEnabled: false,
    contactShadowsIntensity: 0.5,
    taaEnabled: false,
    taaBlendFactor: 0.8,
    chromaticAberrationEnabled: false,
    chromaticAberrationIntensity: 0.25,
    lensDistortion: 0.0,
    particleMultiplier: 0.5,
    planarReflectionsEnabled: false,
    planarReflectionResolution: 256,
    voxelDrawDistance: 3,
    uncappedChunkLod: false,
    waveQuality: 'LOW',
    fog: true,
    frameRateCap: 'AUTO',
  },
  MEDIUM: {
    preset: 'MEDIUM',
    dynamicShadows: true,
    shadowMapSize: 1024,
    shadowSoftness: 1.1,
    blobShadows: true,
    usePBR: true,
    usePotatoShader: false,
    useCartoonShader: false,
    ssaoEnabled: true,
    ssaoIntensity: 0.7,
    ssaoRadius: 0.85,
    ssrEnabled: false,
    ssrIntensity: 0.45,
    bloomEnabled: true,
    cheapBloom: true,
    bloomStrength: 0.55,
    bloomThreshold: 0.7,
    resolutionScale: 0.9,
    godRaysEnabled: false,
    godRaysIntensity: 0.5,
    motionBlurEnabled: false,
    motionBlurStrength: 0.4,
    dofEnabled: false,
    dofFocusDistance: 26,
    dofAperture: 0.55,
    volumetricSmokeEnabled: false,
    volumetricSmokeDensity: 0.65,
    contactShadowsEnabled: false,
    contactShadowsIntensity: 0.6,
    taaEnabled: false,
    taaBlendFactor: 0.82,
    chromaticAberrationEnabled: false,
    chromaticAberrationIntensity: 0.3,
    lensDistortion: 0.0,
    particleMultiplier: 1.0,
    planarReflectionsEnabled: false,
    planarReflectionResolution: 256,
    voxelDrawDistance: 5,
    uncappedChunkLod: false,
    waveQuality: 'LOW',
    fog: true,
    frameRateCap: 'AUTO',
  },
  HIGH: {
    preset: 'HIGH',
    dynamicShadows: true,
    shadowMapSize: 2048,
    shadowSoftness: 1.3,
    blobShadows: true,
    usePBR: true,
    usePotatoShader: false,
    useCartoonShader: false,
    ssaoEnabled: true,
    ssaoIntensity: 1.05,
    ssaoRadius: 1.0,
    ssrEnabled: true,
    ssrIntensity: 0.72,
    bloomEnabled: true,
    cheapBloom: false,
    bloomStrength: 0.92,
    bloomThreshold: 0.62,
    resolutionScale: 1.0,
    godRaysEnabled: true,
    godRaysIntensity: 0.75,
    motionBlurEnabled: true,
    motionBlurStrength: 0.45,
    dofEnabled: false,
    dofFocusDistance: 28,
    dofAperture: 0.65,
    volumetricSmokeEnabled: true,
    volumetricSmokeDensity: 0.8,
    contactShadowsEnabled: true,
    contactShadowsIntensity: 0.85,
    taaEnabled: true,
    taaBlendFactor: 0.84,
    chromaticAberrationEnabled: false,
    chromaticAberrationIntensity: 0.35,
    lensDistortion: 0.03,
    particleMultiplier: 1.4,
    planarReflectionsEnabled: false,
    planarReflectionResolution: 512,
    voxelDrawDistance: 6,
    uncappedChunkLod: false,
    waveQuality: 'MEDIUM',
    fog: true,
    frameRateCap: 'AUTO',
  },
  ULTRA: {
    preset: 'ULTRA',
    dynamicShadows: true,
    shadowMapSize: 2048,
    shadowSoftness: 1.55,
    blobShadows: true,
    usePBR: true,
    usePotatoShader: false,
    useCartoonShader: false,
    ssaoEnabled: true,
    ssaoIntensity: 1.35,
    ssaoRadius: 1.15,
    ssrEnabled: true,
    ssrIntensity: 0.98,
    bloomEnabled: true,
    cheapBloom: false,
    bloomStrength: 1.22,
    bloomThreshold: 0.54,
    resolutionScale: 1.25,
    godRaysEnabled: true,
    godRaysIntensity: 0.98,
    motionBlurEnabled: true,
    motionBlurStrength: 0.55,
    dofEnabled: true,
    dofFocusDistance: 38,
    dofAperture: 0.68,
    volumetricSmokeEnabled: true,
    volumetricSmokeDensity: 1.1,
    contactShadowsEnabled: true,
    contactShadowsIntensity: 1.1,
    taaEnabled: true,
    taaBlendFactor: 0.88,
    chromaticAberrationEnabled: true,
    chromaticAberrationIntensity: 0.42,
    lensDistortion: 0.06,
    particleMultiplier: 2.0,
    planarReflectionsEnabled: true,
    planarReflectionResolution: 512,
    voxelDrawDistance: 8,
    uncappedChunkLod: true,
    waveQuality: 'HIGH',
    fog: true,
    frameRateCap: 'AUTO',
  },
};

/**
 * Resolves the active visual quality tier [0..3] used by the composite shader and scene lighting:
 * 0 = LOW / PENTIUM / CARTOON (raw / stylized pass)
 * 1 = MEDIUM (Crisp Balanced Daylight)
 * 2 = HIGH (Cinematic HD, ACES contrast, sun shafts, voxel-edge specular sheen)
 * 3 = ULTRA (Photorealistic Next-Gen Showcase, golden-hour HDR grade, micro-bevel highlights, planar mirror water)
 */
export function resolveVisualQualityTier(settings: GraphicsSettings): 0 | 1 | 2 | 3 {
  if (settings.usePotatoShader || settings.useCartoonShader || settings.preset === 'LOW' || settings.preset === 'PENTIUM' || settings.preset === 'CARTOON') {
    return 0;
  }
  if (settings.preset === 'ULTRA') return 3;
  if (settings.preset === 'HIGH') return 2;
  if (settings.preset === 'MEDIUM') return 1;
  // For CUSTOM preset, infer visual tier from enabled features
  if (settings.planarReflectionsEnabled || (settings.godRaysEnabled && settings.dofEnabled)) {
    return 3;
  }
  if (settings.godRaysEnabled || settings.ssrEnabled || settings.contactShadowsEnabled) {
    return 2;
  }
  if (settings.ssaoEnabled || settings.bloomEnabled) {
    return 1;
  }
  return 0;
}

export function createDefaultGraphicsSettings(
  isMobileOrHeadless = false,
  isLowEndGpu = false,
): GraphicsSettings {
  if (isLowEndGpu) {
    return { ...GRAPHICS_PRESETS.PENTIUM };
  }
  if (isMobileOrHeadless) {
    return { ...GRAPHICS_PRESETS.LOW, dynamicShadows: true, shadowMapSize: 1024, resolutionScale: 0.65, voxelDrawDistance: 4 };
  }
  return { ...GRAPHICS_PRESETS.MEDIUM };
}

export function sanitizeGraphicsSettings(
  partial: Partial<GraphicsSettings>,
  fallback: GraphicsSettings = GRAPHICS_PRESETS.MEDIUM,
): GraphicsSettings {
  const preset: GraphicsPresetId =
    partial.preset === 'PENTIUM' ||
    partial.preset === 'CARTOON' ||
    partial.preset === 'LOW' ||
    partial.preset === 'MEDIUM' ||
    partial.preset === 'HIGH' ||
    partial.preset === 'ULTRA' ||
    partial.preset === 'CUSTOM'
      ? partial.preset
      : fallback.preset;

  let useCartoonShader =
    typeof partial.useCartoonShader === 'boolean'
      ? partial.useCartoonShader
      : fallback.useCartoonShader ?? false;

  let usePotatoShader =
    typeof partial.usePotatoShader === 'boolean'
      ? partial.usePotatoShader
      : typeof partial.usePBR === 'boolean' && !useCartoonShader
        ? !partial.usePBR
        : fallback.usePotatoShader;

  if (partial.useCartoonShader === true) {
    usePotatoShader = false;
  } else if (partial.usePotatoShader === true) {
    useCartoonShader = false;
  } else if (partial.usePBR === true) {
    usePotatoShader = false;
    useCartoonShader = false;
  }

  const usePBR = !usePotatoShader && !useCartoonShader;

  return {
    preset,
    usePBR,
    usePotatoShader,
    useCartoonShader,
    blobShadows:
      typeof partial.blobShadows === 'boolean'
        ? partial.blobShadows
        : fallback.blobShadows,
    cheapBloom:
      typeof partial.cheapBloom === 'boolean'
        ? partial.cheapBloom
        : fallback.cheapBloom,
    fog:
      typeof partial.fog === 'boolean'
        ? partial.fog
        : fallback.fog,
    dynamicShadows:
      typeof partial.dynamicShadows === 'boolean'
        ? partial.dynamicShadows
        : fallback.dynamicShadows,
    shadowMapSize: sanitizeShadowMapSize(
      partial.shadowMapSize ?? fallback.shadowMapSize,
    ),
    shadowSoftness: Number(
      clampNum(
        partial.shadowSoftness ?? fallback.shadowSoftness,
        0.5,
        2.5,
        fallback.shadowSoftness,
      ).toFixed(2),
    ),
    ssaoEnabled:
      typeof partial.ssaoEnabled === 'boolean'
        ? partial.ssaoEnabled
        : fallback.ssaoEnabled,
    ssaoIntensity: Number(
      clampNum(
        partial.ssaoIntensity ?? fallback.ssaoIntensity,
        0.1,
        2.0,
        fallback.ssaoIntensity,
      ).toFixed(2),
    ),
    ssaoRadius: Number(
      clampNum(
        partial.ssaoRadius ?? fallback.ssaoRadius,
        0.2,
        2.0,
        fallback.ssaoRadius,
      ).toFixed(2),
    ),
    ssrEnabled:
      typeof partial.ssrEnabled === 'boolean'
        ? partial.ssrEnabled
        : fallback.ssrEnabled,
    ssrIntensity: Number(
      clampNum(
        partial.ssrIntensity ?? fallback.ssrIntensity,
        0.1,
        1.5,
        fallback.ssrIntensity,
      ).toFixed(2),
    ),
    bloomEnabled:
      typeof partial.bloomEnabled === 'boolean'
        ? partial.bloomEnabled
        : fallback.bloomEnabled,
    bloomStrength: Number(
      clampNum(
        partial.bloomStrength ?? fallback.bloomStrength,
        0.1,
        2.5,
        fallback.bloomStrength,
      ).toFixed(2),
    ),
    bloomThreshold: Number(
      clampNum(
        partial.bloomThreshold ?? fallback.bloomThreshold,
        0.3,
        0.95,
        fallback.bloomThreshold,
      ).toFixed(2),
    ),
    resolutionScale: Number(
      clampNum(
        partial.resolutionScale ?? fallback.resolutionScale,
        0.5,
        2.0,
        fallback.resolutionScale,
      ).toFixed(2),
    ),
    godRaysEnabled:
      typeof partial.godRaysEnabled === 'boolean'
        ? partial.godRaysEnabled
        : fallback.godRaysEnabled,
    godRaysIntensity: Number(
      clampNum(
        partial.godRaysIntensity ?? fallback.godRaysIntensity,
        0.1,
        1.5,
        fallback.godRaysIntensity,
      ).toFixed(2),
    ),
    motionBlurEnabled:
      typeof partial.motionBlurEnabled === 'boolean'
        ? partial.motionBlurEnabled
        : fallback.motionBlurEnabled,
    motionBlurStrength: Number(
      clampNum(
        partial.motionBlurStrength ?? fallback.motionBlurStrength,
        0.1,
        1.5,
        fallback.motionBlurStrength,
      ).toFixed(2),
    ),
    dofEnabled:
      typeof partial.dofEnabled === 'boolean'
        ? partial.dofEnabled
        : fallback.dofEnabled,
    dofFocusDistance: Math.round(
      clampNum(
        partial.dofFocusDistance ?? fallback.dofFocusDistance,
        4,
        160,
        fallback.dofFocusDistance,
      ),
    ),
    dofAperture: Number(
      clampNum(
        partial.dofAperture ?? fallback.dofAperture,
        0.1,
        2.0,
        fallback.dofAperture,
      ).toFixed(2),
    ),
    volumetricSmokeEnabled:
      typeof partial.volumetricSmokeEnabled === 'boolean'
        ? partial.volumetricSmokeEnabled
        : fallback.volumetricSmokeEnabled,
    volumetricSmokeDensity: Number(
      clampNum(
        partial.volumetricSmokeDensity ?? fallback.volumetricSmokeDensity,
        0.1,
        2.0,
        fallback.volumetricSmokeDensity,
      ).toFixed(2),
    ),
    contactShadowsEnabled:
      typeof partial.contactShadowsEnabled === 'boolean'
        ? partial.contactShadowsEnabled
        : fallback.contactShadowsEnabled,
    contactShadowsIntensity: Number(
      clampNum(
        partial.contactShadowsIntensity ?? fallback.contactShadowsIntensity,
        0.1,
        1.5,
        fallback.contactShadowsIntensity,
      ).toFixed(2),
    ),
    taaEnabled:
      typeof partial.taaEnabled === 'boolean'
        ? partial.taaEnabled
        : fallback.taaEnabled,
    taaBlendFactor: Number(
      clampNum(
        partial.taaBlendFactor ?? fallback.taaBlendFactor,
        0.5,
        0.94,
        fallback.taaBlendFactor,
      ).toFixed(2),
    ),
    chromaticAberrationEnabled:
      typeof partial.chromaticAberrationEnabled === 'boolean'
        ? partial.chromaticAberrationEnabled
        : fallback.chromaticAberrationEnabled,
    chromaticAberrationIntensity: Number(
      clampNum(
        partial.chromaticAberrationIntensity ??
          fallback.chromaticAberrationIntensity,
        0.0,
        2.0,
        fallback.chromaticAberrationIntensity,
      ).toFixed(2),
    ),
    lensDistortion: Number(
      clampNum(
        partial.lensDistortion ?? fallback.lensDistortion,
        -0.4,
        0.4,
        fallback.lensDistortion,
      ).toFixed(2),
    ),
    particleMultiplier: Number(
      clampNum(
        partial.particleMultiplier ?? fallback.particleMultiplier,
        0.25,
        3.0,
        fallback.particleMultiplier,
      ).toFixed(2),
    ),
    planarReflectionsEnabled:
      typeof partial.planarReflectionsEnabled === 'boolean'
        ? partial.planarReflectionsEnabled
        : fallback.planarReflectionsEnabled,
    planarReflectionResolution: sanitizePlanarResolution(
      partial.planarReflectionResolution ?? fallback.planarReflectionResolution,
    ),
    voxelDrawDistance: Math.round(
      clampNum(
        partial.voxelDrawDistance ?? fallback.voxelDrawDistance,
        2,
        16,
        fallback.voxelDrawDistance,
      ),
    ),
    uncappedChunkLod:
      typeof partial.uncappedChunkLod === 'boolean'
        ? partial.uncappedChunkLod
        : fallback.uncappedChunkLod,
    waveQuality:
      partial.waveQuality === 'OFF' ||
      partial.waveQuality === 'LOW' ||
      partial.waveQuality === 'MEDIUM' ||
      partial.waveQuality === 'HIGH'
        ? partial.waveQuality
        : fallback.waveQuality,
    frameRateCap: sanitizeFrameRateCap(
      partial.frameRateCap,
      fallback.frameRateCap ?? 'AUTO',
    ),
  };
}

export function loadStoredGraphicsSettings(
  isMobileOrHeadless = false,
  isLowEndGpu = false,
): GraphicsSettings {
  const fallback = createDefaultGraphicsSettings(isMobileOrHeadless, isLowEndGpu);
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_GRAPHICS);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const preservedCap = sanitizeFrameRateCap(parsed.frameRateCap, 'AUTO');
      // If user is on a detected low-end GPU (or selected PENTIUM preset), ensure old cached bloom/waves
      // from previous versions do not force the offscreen FBO post-processing pass!
      if (parsed.preset === 'PENTIUM') {
        return { ...GRAPHICS_PRESETS.PENTIUM, frameRateCap: preservedCap };
      }
      if (isLowEndGpu && parsed.preset === 'MEDIUM' && !parsed.userExplicitlySelectedPreset) {
        return { ...GRAPHICS_PRESETS.PENTIUM, frameRateCap: preservedCap };
      }
      return sanitizeGraphicsSettings(parsed, fallback);
    }
  } catch {
    // Ignore storage read errors
  }
  return fallback;
}

export function saveStoredGraphicsSettings(settings: GraphicsSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(STORAGE_KEY_GRAPHICS, JSON.stringify(settings));
  } catch {
    // Ignore storage write errors
  }
}

/**
 * Returns true if any screen-space post-processing effect is currently enabled.
 */
export function hasActivePostProcessing(s: GraphicsSettings): boolean {
  return (
    s.ssaoEnabled ||
    s.ssrEnabled ||
    s.bloomEnabled ||
    s.godRaysEnabled ||
    s.motionBlurEnabled ||
    s.dofEnabled ||
    s.volumetricSmokeEnabled ||
    s.contactShadowsEnabled ||
    s.taaEnabled ||
    s.chromaticAberrationEnabled ||
    Math.abs(s.lensDistortion) > 0.005
  );
}

/**
 * Counts how many of the 15 graphics features are currently active/enhanced.
 */
export function countActiveGraphicsFeatures(s: GraphicsSettings): number {
  let count = 0;
  if (s.dynamicShadows) count++;
  if (s.ssaoEnabled) count++;
  if (s.ssrEnabled) count++;
  if (s.bloomEnabled) count++;
  if (s.resolutionScale >= 1.0) count++;
  if (s.godRaysEnabled) count++;
  if (s.motionBlurEnabled) count++;
  if (s.dofEnabled) count++;
  if (s.volumetricSmokeEnabled) count++;
  if (s.contactShadowsEnabled) count++;
  if (s.taaEnabled) count++;
  if (s.chromaticAberrationEnabled || Math.abs(s.lensDistortion) > 0.005) count++;
  if (s.particleMultiplier >= 1.0) count++;
  if (s.planarReflectionsEnabled) count++;
  if (s.voxelDrawDistance >= 6 || s.uncappedChunkLod) count++;
  return count;
}

/**
 * Computes Van der Corput / Halton (base 2, base 3) sub-pixel jitter offset in [-0.5, +0.5]
 * for Temporal Anti-Aliasing (TAA).
 */
export function computeHaltonJitter(frameIndex: number): { jx: number; jy: number } {
  const idx = (Math.max(0, Math.floor(frameIndex)) % 16) + 1;
  const halton = (index: number, base: number): number => {
    let result = 0;
    let f = 1 / base;
    let i = index;
    while (i > 0) {
      result += f * (i % base);
      i = Math.floor(i / base);
      f /= base;
    }
    return result;
  };
  return {
    jx: halton(idx, 2) - 0.5,
    jy: halton(idx, 3) - 0.5,
  };
}

/**
 * Returns true when #14 (Real-Time Planar Mirror Reflections) or #3 (Screen-Space Reflections)
 * is enabled, switching the ocean shader from voxel-stepped waves to ultra-realistic smooth water.
 */
export function shouldUseRealisticWater(
  settings: Pick<GraphicsSettings, 'planarReflectionsEnabled' | 'ssrEnabled'>,
): boolean {
  return Boolean(settings.planarReflectionsEnabled || settings.ssrEnabled);
}

/**
 * Computes linear THREE.Fog near/far distances scaled with Voxel Draw Distance (2..16 chunks)
 * so increasing draw distance genuinely pushes out the atmospheric horizon fog instead of capping at 60m.
 */
export function computeLinearFogBounds(
  voxelDrawDistance: number,
  fogEnabled = true,
  isPlaying = true,
  isMapMode = false,
): { near: number; far: number } {
  if (isMapMode) {
    return { near: 650, far: 1300 };
  }
  if (!fogEnabled) {
    return { near: 2000, far: 4000 };
  }
  const clampedChunks = Math.max(2, Math.min(16, Math.round(voxelDrawDistance)));
  const radiusMeters = clampedChunks * 16;
  if (!isPlaying) {
    return {
      near: Math.max(18, Math.round(radiusMeters * 0.35)),
      far: Math.max(42, Math.round(radiusMeters * 0.72)),
    };
  }
  return {
    near: Math.max(28, Math.round(radiusMeters * 0.62)),
    far: Math.max(60, Math.round(radiusMeters * 1.28)),
  };
}

/**
 * Combines hardware devicePixelRatio (capped at 2x) with user resolutionScale (0.5x..2.0x)
 * while keeping headless software-WebGL captures fast at 0.65x.
 */
export function resolveEffectivePixelRatio(
  resolutionScale: number,
  devicePixelRatio = 1,
  isHeadless = false,
): number {
  if (isHeadless) return 0.65;
  const baseDpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, Math.min(2, devicePixelRatio))
    : 1;
  return Number(clampNum(baseDpr * resolutionScale, 0.5, 2.5, 1.0).toFixed(3));
}

/**
 * Maps WorldGenMode strings to integer shader IDs for water basin detection in GPU shaders.
 */
export function worldGenModeToShaderId(mode: string): number {
  switch (mode) {
    case 'BIOME_CANYON':
      return 1;
    case 'BIOME_ARCTIC':
      return 2;
    case 'BIOME_VOLCANIC':
      return 3;
    case 'BIOME_ARCHIPELAGO':
    case 'CUSTOM_GLB_MAP':
      return 4;
    case 'FLAT_BASEPLATE':
      return 5;
    case 'CUSTOM_HEIGHTMAP':
      return 6;
    case 'DEFAULT_PARK':
    default:
      return 0;
  }
}

