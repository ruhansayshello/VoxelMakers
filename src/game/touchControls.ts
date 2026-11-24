/**
 * Touch Controls, Mobile Device Detection & Camera/Input Math for VoxelMakers
 *
 * Ensures:
 * 1. Clean detection of mobile/touch devices + manual Touch UI override ('AUTO' | 'ON' | 'OFF').
 * 2. Smooth proportional analog steering & throttle math for mobile driving (Pedals + Steer or Virtual Stick).
 * 3. True 3D spherical orbit + pinch-to-zoom camera math around buildOrbitPivot in Build Mode.
 * 4. Cohesive Render Distance, LOD ring, Camera Far Plane, and Fog Density tuning math.
 */

export type TouchModeOverride = 'AUTO' | 'ON' | 'OFF';
export type MobileDriveControlScheme = 'PEDALS_STEER' | 'JOYSTICK';

const STORAGE_KEY_TOUCH_OVERRIDE = 'voxelmakers_touch_override_v1';
const STORAGE_KEY_DRIVE_SCHEME = 'voxelmakers_mobile_drive_scheme_v2';

let memoryTouchOverride: TouchModeOverride = 'AUTO';

export function getTouchModeOverride(): TouchModeOverride {
  if (typeof window === 'undefined') return memoryTouchOverride;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_TOUCH_OVERRIDE);
    if (raw === 'ON' || raw === 'OFF' || raw === 'AUTO') {
      memoryTouchOverride = raw;
      return raw;
    }
  } catch {
    // Ignore storage access errors
  }
  return memoryTouchOverride;
}

export function setTouchModeOverride(mode: TouchModeOverride): void {
  memoryTouchOverride = mode;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(STORAGE_KEY_TOUCH_OVERRIDE, mode);
      window.dispatchEvent(new Event('voxelmakers-touch-mode-change'));
    } catch {
      // Ignore storage access errors
    }
  }
}

export function getMobileDriveScheme(): MobileDriveControlScheme {
  if (typeof window === 'undefined') return 'JOYSTICK';
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_DRIVE_SCHEME);
    if (raw === 'PEDALS_STEER' || raw === 'JOYSTICK') return raw;
  } catch {
    // Ignore
  }
  return 'JOYSTICK';
}

export function setMobileDriveScheme(scheme: MobileDriveControlScheme): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(STORAGE_KEY_DRIVE_SCHEME, scheme);
    } catch {
      // Ignore
    }
  }
}

export interface DeviceEnv {
  search?: string;
  hasTouchStart?: boolean;
  maxTouchPoints?: number;
  matchesCoarse?: boolean;
  innerWidth?: number;
  override?: TouchModeOverride;
}

export const checkIsMobileDevice = (env?: DeviceEnv): boolean => {
  if (env) {
    if (env.override === 'ON') return true;
    if (env.override === 'OFF') return false;
    if (env.search?.includes('mobile=1') || env.search?.includes('touch=1')) return true;
    if (env.search?.includes('desktop=1')) return false;
    const hasTouch = Boolean(
      env.hasTouchStart ||
        (typeof env.maxTouchPoints === 'number' && env.maxTouchPoints > 0),
    );
    const isCoarse = Boolean(env.matchesCoarse);
    const isSmall = (env.innerWidth ?? 1024) <= 768;
    return (hasTouch && isCoarse) || (hasTouch && isSmall);
  }

  if (typeof window === 'undefined') return false;

  const override = getTouchModeOverride();
  if (override === 'ON') return true;
  if (override === 'OFF') return false;

  // Explicit override for debug / testing / emulation in headless browsers or Playwright
  if (typeof window.location !== 'undefined') {
    const search = window.location.search;
    if (search.includes('mobile=1') || search.includes('touch=1')) {
      return true;
    }
    if (search.includes('desktop=1')) {
      return false;
    }
  }

  const hasTouch =
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  const isCoarse =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const isSmallScreen = window.innerWidth <= 768 || window.innerHeight <= 500;

  // Strict check: On desktop with mouse/keyboard, pointer is fine and window > 768x500,
  // so this strictly returns false unless user explicitly toggles Touch UI ON.
  return (hasTouch && isCoarse) || (hasTouch && isSmallScreen);
};

export const isMobileDevice = (): boolean => checkIsMobileDevice();

export interface PopupLayoutEnv {
  isMobileHud?: boolean;
  innerWidth?: number;
  innerHeight?: number;
  override?: TouchModeOverride;
}

/**
 * Determines whether popups, modals, and HUD toasts should use the compact
 * mobile/landscape-phone layout vs. the spacious laptop/desktop layout.
 */
export function isMobilePopupLayout(env?: PopupLayoutEnv): boolean {
  const override = env?.override ?? getTouchModeOverride();
  if (override === 'ON') return true;
  if (override === 'OFF') return false;

  const isMob = env?.isMobileHud ?? isMobileDevice();
  if (isMob) return true;

  const w =
    env?.innerWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const h =
    env?.innerHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 720);

  // Mobile portrait (<= 768px wide) or mobile landscape (<= 520px tall)
  return w <= 768 || h <= 520;
}

/**
 * Converts normalized thumbstick or slider displacement [-1..1] into smooth analog
 * steering [-1..1] (where +1 is left / KeyA and -1 is right / KeyD) and throttle [-1..1],
 * with deadzone remapping so slight vertical thumb drift while steering doesn't kill gas.
 */
export function computeAnalogTouchDriveInput(
  normX: number,
  normY: number,
  deadzone = 0.16,
): { steer: number; throttle: number } {
  const remapAxis = (val: number, dz: number): number => {
    const abs = Math.abs(val);
    if (abs <= dz) return 0;
    const sign = val < 0 ? -1 : 1;
    const linear = Math.min(1, (abs - dz) / Math.max(0.01, 1 - dz));
    // Blend 65% linear + 35% cubic so small thumb movements give fine steering precision
    return sign * (linear * 0.65 + linear * linear * linear * 0.35);
  };

  // In vehicle.ts: KeyA adds +1 to steerInput, KeyD adds -1 to steerInput
  const steer = -remapAxis(normX, deadzone);
  // Upward thumb (normY < 0) = forward throttle (+1), downward thumb (normY > 0) = reverse (-1)
  const throttle = -remapAxis(normY, deadzone);

  return {
    steer: Math.abs(steer) < 1e-4 ? 0 : Math.max(-1, Math.min(1, steer)),
    throttle: Math.abs(throttle) < 1e-4 ? 0 : Math.max(-1, Math.min(1, throttle)),
  };
}

/**
 * Converts a horizontal touch position on an analog steering bar [rectLeft .. rectLeft + rectWidth]
 * into smooth proportional steering [-1..1] (+1 = Left / KeyA, -1 = Right / KeyD).
 */
export function computeAnalogSliderSteer(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  deadzone = 0.08,
): number {
  if (rectWidth <= 1) return 0;
  const normX = Math.max(-1, Math.min(1, ((clientX - rectLeft) / rectWidth) * 2 - 1));
  return computeAnalogTouchDriveInput(normX, 0, deadzone).steer;
}

/**
 * Triggers a light tactile vibration pulse on mobile devices that support the Vibration API.
 */
export function triggerTouchHaptic(durationMs = 8): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(durationMs);
    } catch {
      // Ignore if vibration is blocked by browser permissions
    }
  }
}

/**
 * Computes true 3D spherical orbit camera position around `pivot` for Build Mode touch dragging
 * and 2-finger pinch-to-zoom, ensuring the camera always looks directly at `pivot` instead of turning away.
 */
export function computeTouchOrbitCameraState(
  pivot: { x: number; y: number; z: number },
  currentYaw: number,
  currentPitch: number,
  currentDist: number,
  dragDx: number,
  dragDy: number,
  pinchZoomDeltaMeters = 0,
  sensitivity = 0.0055,
): {
  camYaw: number;
  camPitch: number;
  buildOrbitDist: number;
  camFreePos: { x: number; y: number; z: number };
} {
  const camYaw = currentYaw - dragDx * sensitivity;
  const camPitch = Math.max(
    -1.42,
    Math.min(1.42, currentPitch - dragDy * sensitivity),
  );
  const buildOrbitDist = Math.max(
    1.6,
    Math.min(65.0, currentDist + pinchZoomDeltaMeters),
  );

  const cosPitch = Math.cos(camPitch);
  const backX = Math.sin(camYaw) * cosPitch;
  const backY = -Math.sin(camPitch);
  const backZ = Math.cos(camYaw) * cosPitch;
  const len = Math.hypot(backX, backY, backZ) || 1;

  const camFreePos = {
    x: pivot.x + (backX / len) * buildOrbitDist,
    y: Math.max(1.0, pivot.y + (backY / len) * buildOrbitDist),
    z: pivot.z + (backZ / len) * buildOrbitDist,
  };

  return {
    camYaw,
    camPitch,
    buildOrbitDist,
    camFreePos,
  };
}

/**
 * Computes cohesive Render Distance parameters (chunk radius, meters, LOD0/LOD1/LOD2 thresholds,
 * camera far plane, and exponential fog density) from a chunk radius setting [2..16].
 */
export function computeRenderDistanceTuning(
  chunks: number,
  uncappedChunkLod = false,
): {
  clampedChunks: number;
  radiusMeters: number;
  diameterMeters: number;
  lod0MaxCheb: number;
  lod0MaxMeters: number;
  lod1MaxCheb: number;
  lod1MaxMeters: number;
  cameraFar: number;
  baseFogDensity: number;
  skyDomeScale: number;
  uncappedChunkLod: boolean;
} {
  const clampedChunks = Math.max(2, Math.min(16, Math.round(chunks)));
  const chunkSizeMeters = 16; // 64 voxels * 0.25m = 16m per chunk
  const radiusMeters = clampedChunks * chunkSizeMeters;
  const diameterMeters = radiusMeters * 2;

  const lod0MaxCheb = uncappedChunkLod
    ? clampedChunks + 2
    : Math.max(2, Math.round(clampedChunks * 0.55));
  const lod0MaxMeters = uncappedChunkLod
    ? radiusMeters * 2.0 + 64
    : Math.max(36, (lod0MaxCheb + 0.5) * chunkSizeMeters);

  const lod1MaxCheb = uncappedChunkLod
    ? clampedChunks + 4
    : Math.max(lod0MaxCheb + 1, Math.round(clampedChunks * 0.82));
  const lod1MaxMeters = uncappedChunkLod
    ? radiusMeters * 2.5 + 96
    : Math.max(64, (lod1MaxCheb + 0.5) * chunkSizeMeters);

  // Scale camera far plane and sky dome so high render distances never clip at the horizon
  const cameraFar = Math.max(360, radiusMeters * 3.2 + 160);
  const skyDomeScale = Math.max(1.0, (radiusMeters * 2.4) / 360);

  // Scale exponential fog density inversely with render distance so distant islands stay crisp at high settings
  const baseFogDensity = Number((0.0115 / Math.max(2.5, clampedChunks)).toFixed(5));

  return {
    clampedChunks,
    radiusMeters,
    diameterMeters,
    lod0MaxCheb,
    lod0MaxMeters,
    lod1MaxCheb,
    lod1MaxMeters,
    cameraFar,
    baseFogDensity,
    skyDomeScale,
    uncappedChunkLod,
  };
}

/**
 * Dynamically scales the Tactical Map chunk render radius based on camera zoom altitude
 * and 2.5D perspective tilt so zooming out expands the loaded chunk horizon and prevents
 * unloaded sky gaps at the sides of the viewport.
 */
export function computeTacticalMapRenderRadiusChunks(
  altitudeMeters: number,
  baseRenderDistanceChunks = 4,
  isTopDown = false,
  aspect = 1.78,
): number {
  const safeAlt = Math.max(16, Math.min(360, altitudeMeters));
  const clampedAspect = Math.max(1.0, Math.min(2.6, aspect));
  // In 2.5D tilted perspective (tiltRad = 1.22), the far half of the frustum fans out wider horizontally
  const perspectiveSpread = isTopDown ? 1.25 : 1.75;
  const visibleHalfSpanMeters = safeAlt * perspectiveSpread * Math.max(1.0, clampedAspect / 1.55);
  const requiredChunks = Math.ceil(visibleHalfSpanMeters / 16) + 3;
  return Math.max(6, Math.min(26, Math.max(baseRenderDistanceChunks, requiredChunks)));
}

export interface MobileBuildUiRestState {
  viewportWidth: number;
  viewportHeight: number;
  isBuildMode: boolean;
  tapToPlaceMode: boolean;
  partsDrawerOpen: boolean;
  menuPopupOpen: boolean;
  placementDropdownOpen: boolean;
  editPopupOpen: boolean;
}

export const MOBILE_BUILD_QUICK_ACTIONS = [
  'UNDO',
  'SYM',
  'ROT Y',
  'ROT X',
  'ROT Z',
  'TAP',
] as const;
export type MobileBuildQuickAction = (typeof MOBILE_BUILD_QUICK_ACTIONS)[number];

/**
 * Rule 6: Hide reticle when in build mode with TAP PLACE off (it's redundant with the 3D cursor).
 * In fact, in Build Mode we keep the center reticle hidden whenever tapToPlaceMode is false.
 */
export function shouldShowMobileCenterReticle(
  isBuildMode: boolean,
  isWorldEditMode: boolean,
  isSeatedInRig: boolean,
  tapToPlaceMode: boolean,
): boolean {
  if (isBuildMode) {
    return false;
  }
  if (isWorldEditMode) {
    return !tapToPlaceMode;
  }
  return !isSeatedInRig;
}

/**
 * Computes the resting button breakdown and unobstructed 3D viewport visibility ratio
 * on a mobile screen (e.g. 360x640px).
 */
export function computeMobileBuildUiMetrics(state: MobileBuildUiRestState): {
  topBarButtons: number;
  placementModeButtons: number;
  editPopupTriggerButtons: number;
  placeDeleteButtons: number;
  leftCameraButtons: number;
  bottomPartsDrawerButtons: number;
  totalVisibleButtonsAtRest: number;
  visibleViewportRatio: number;
  reticleVisible: boolean;
} {
  const topBarButtons = 3; // DRIVE, Menu, Pause
  const placementModeButtons = 1; // "1x1 Single ▾" dropdown trigger
  const editPopupTriggerButtons = 1; // "Edit ▾" (groups ROT Y, ROT X, ROT Z, MIRROR, UNDO)
  const placeDeleteButtons = 2; // DELETE, PLACE
  const leftCameraButtons = 2; // UP, DOWN
  const bottomPartsDrawerButtons = 1; // "Parts ▾"

  const totalVisibleButtonsAtRest =
    topBarButtons +
    placementModeButtons +
    editPopupTriggerButtons +
    placeDeleteButtons +
    leftCameraButtons +
    bottomPartsDrawerButtons;

  const totalArea = Math.max(1, state.viewportWidth * state.viewportHeight);
  // Sum of bounding box areas of the 10 resting controls on a 360x640 screen:
  // Top bar 3 buttons (~360 * 40 * 0.45 = 6480 px^2)
  // Left 2 buttons (2 * 44 * 42 = 3696 px^2)
  // Right 4 buttons (dropdown 110*34 + edit 68*34 + delete/place 2*56*52 = 11876 px^2)
  // Bottom 1 button (140 * 38 = 5320 px^2)
  const restingUiAreaPx = 6480 + 3696 + 11876 + 5320;
  const drawerAreaPx = state.partsDrawerOpen
    ? state.viewportWidth * state.viewportHeight * 0.35
    : 0;

  const obstructedArea = Math.min(totalArea, restingUiAreaPx + drawerAreaPx);
  const visibleViewportRatio = Math.max(0, (totalArea - obstructedArea) / totalArea);

  return {
    topBarButtons,
    placementModeButtons,
    editPopupTriggerButtons,
    placeDeleteButtons,
    leftCameraButtons,
    bottomPartsDrawerButtons,
    totalVisibleButtonsAtRest,
    visibleViewportRatio,
    reticleVisible: shouldShowMobileCenterReticle(
      state.isBuildMode,
      false,
      true,
      state.tapToPlaceMode,
    ),
  };
}


