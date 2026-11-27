/**
 * Pure math, BigInt Sector Coordinates, Scale-Space Banding & Dynamic O(log R) Ring Layout
 * for the Distant Horizons mega-tile LOD system — supporting render distances from 32 m up to
 * 10000000000000000000000000000001 km (10^31 + 1 km ≈ 6.25 × 10^32 chunks)!
 *
 * Three Core Architectural Pillars:
 * 1. BigInt Sector Coordinates:
 *    - Camera & tile world origins are stored with exact BigInt coordinates + local Float64 offset.
 *    - Camera-relative offsets are computed via BigInt subtraction & band-scale division BEFORE
 *      converting to Float64/Float32 — eliminating JS 2^53 (~9e15) precision loss completely.
 * 2. Scale-Space Multi-Pass Bands:
 *    - Rings are partitioned into exponential scale bands (stepping by 2^12 = 4096× per band).
 *    - Every band divides local tile vertices and camera-relative translations by `bandScaleMetersBig`
 *      on the CPU so every Float32 sent to WebGL stays safely inside [-20000, +20000] with full
 *      24-bit depth precision and zero Float32 overflow or z-fighting.
 * 3. Watertight Nested BigInt Ring Boxes:
 *    - Every ring's outer box snaps to exact multiples of the next ring's `tileChunksBig` (2^L),
 *      guaranteeing zero overlaps and zero gaps with compact O(log R) tile counts for weak iGPUs.
 */

export const MIN_RENDER_DISTANCE_CHUNKS = 2;
export const SLIDER_MAX_RENDER_DISTANCE_CHUNKS = 64;
export const MAX_RENDER_DISTANCE_CHUNKS = 62500; // Legacy numeric cap (1,000 km) for backwards-compat number callers

// Cosmic BigInt Render Distance Ceiling: 10000000000000000000000000000001 km (10^31 + 1 km)
export const MIN_RENDER_DISTANCE_CHUNKS_BIGINT = 2n;
export const MAX_RENDER_DISTANCE_KM_BIGINT = 10000000000000000000000000000001n;
export const MAX_RENDER_DISTANCE_METERS_BIGINT = MAX_RENDER_DISTANCE_KM_BIGINT * 1000n;
export const CHUNK_SIZE_METERS_BIGINT = 16n;
// ceil((10^34 + 1000) / 16) = 625000000000000000000000000000063n chunks
export const MAX_RENDER_DISTANCE_CHUNKS_BIGINT =
  (MAX_RENDER_DISTANCE_METERS_BIGINT + CHUNK_SIZE_METERS_BIGINT - 1n) /
  CHUNK_SIZE_METERS_BIGINT;

export const MIN_LOD_SPACING = 0.5;
export const MAX_LOD_SPACING = 2.5;
export const DEFAULT_LOD_SPACING = 1.0;

export const CHUNK_SIZE_METERS = 16;
export const HORIZON_TILE_GRID_CELLS = 64;
export const COSMIC_TILE_GRID_CELLS = 16; // Ultra-low RAM & vertex count for cosmic rings (> 1,000 km)
export const MAX_HORIZON_RING_LEVEL = 15; // Local/continental 64x64 rings (up to 1,000 km)
export const MAX_COSMIC_RING_LEVEL = 110; // Up to 2^110 chunks (~2.07 × 10^31 km)

/**
 * Scale-Space Banding constants:
 * - Band 0 (Local): LOD0 + rings 1..9 (0 m .. ~16 km), scale = 1 m
 * - Band b (b >= 1): rings [10 + (b-1)*12 .. 10 + b*12 - 1], scale = 2^(12*b) m
 *   Inside every band b >= 1:
 *   - Smallest tile width = 4.0 Float32 units
 *   - Largest tile width = 8,192.0 Float32 units
 *   - All camera-relative coordinates & vertices sit cleanly inside [-25000, +25000] Float32!
 */
export const LOCAL_BAND_MAX_RING_LEVEL = 9;
export const SCALE_BAND_LEVEL_STRIDE = 12;
export const SCALE_BAND_NEAR = 0.25;
export const SCALE_BAND_FAR = 65536;

/** Macro-sector size in meters for BigInt camera/world coordinates (1024 m = 64 chunks). */
export const BIG_SECTOR_SIZE_METERS = 1024n;
const BIG_SECTOR_SIZE_FLOAT = 1024;

/**
 * Exact world/camera position split into a BigInt macro-sector `(sectorX, sectorZ)`
 * (in multiples of `BIG_SECTOR_SIZE_METERS = 1024n` meters) plus a local Float64 offset
 * `(localX, localY, localZ)` inside `[0, 1024)`.
 */
export interface BigSectorPosition {
  sectorX: bigint;
  sectorZ: bigint;
  localX: number;
  localY: number;
  localZ: number;
}

export interface BigIntVec3 {
  x: bigint;
  y: bigint;
  z: bigint;
}

/**
 * Normalizes a `BigSectorPosition` so `localX` and `localZ` stay bounded inside `[0, 1024)`,
 * shifting any overflow into `sectorX` / `sectorZ` with exact BigInt integer precision.
 */
export function normalizeBigSectorPosition(pos: BigSectorPosition): BigSectorPosition {
  const safeX = Number.isFinite(pos.localX) ? pos.localX : 0;
  const safeY = Number.isFinite(pos.localY) ? pos.localY : 0;
  const safeZ = Number.isFinite(pos.localZ) ? pos.localZ : 0;
  const shiftX = Math.floor(safeX / BIG_SECTOR_SIZE_FLOAT);
  const shiftZ = Math.floor(safeZ / BIG_SECTOR_SIZE_FLOAT);
  return {
    sectorX: pos.sectorX + BigInt(shiftX),
    sectorZ: pos.sectorZ + BigInt(shiftZ),
    localX: safeX - shiftX * BIG_SECTOR_SIZE_FLOAT,
    localY: safeY,
    localZ: safeZ - shiftZ * BIG_SECTOR_SIZE_FLOAT,
  };
}

/**
 * Creates a normalized `BigSectorPosition` from a local Float64 camera/world coordinate
 * and optional base BigInt macro-sector.
 */
export function createBigSectorPosition(
  worldX: number,
  worldY: number,
  worldZ: number,
  baseSectorX = 0n,
  baseSectorZ = 0n,
): BigSectorPosition {
  return normalizeBigSectorPosition({
    sectorX: baseSectorX,
    sectorZ: baseSectorZ,
    localX: worldX,
    localY: worldY,
    localZ: worldZ,
  });
}

/**
 * Computes the exact camera-relative translation `(tileOriginBig - camPos) / bandScaleMetersBig`
 * using BigInt subtraction & quotient/remainder division BEFORE converting to floats.
 *
 * Guarantees zero JS Float64 `2^53` cancellation error and keeps all Float32 GPU uniforms
 * bounded within safe range even at `10^31 km` (`10^34 m`).
 */
export function computeBigCameraRelativeScaledOffset(
  tileOriginMetersBig: BigIntVec3,
  camPos: BigSectorPosition,
  bandScaleMetersBig: bigint,
  extraYOffsetMeters = 0,
): { x: number; y: number; z: number } {
  const camOriginXBig = camPos.sectorX * BIG_SECTOR_SIZE_METERS;
  const camOriginZBig = camPos.sectorZ * BIG_SECTOR_SIZE_METERS;
  const diffXBig = tileOriginMetersBig.x - camOriginXBig;
  const diffZBig = tileOriginMetersBig.z - camOriginZBig;
  const diffYFloat = Number(tileOriginMetersBig.y) + extraYOffsetMeters - camPos.localY;

  if (bandScaleMetersBig <= 1n) {
    return {
      x: Number(diffXBig) - camPos.localX,
      y: diffYFloat,
      z: Number(diffZBig) - camPos.localZ,
    };
  }

  // Split exact BigInt difference into quotient + remainder BEFORE touching floats
  const qX = diffXBig / bandScaleMetersBig;
  const rX = diffXBig % bandScaleMetersBig;
  const qZ = diffZBig / bandScaleMetersBig;
  const rZ = diffZBig % bandScaleMetersBig;

  const invScale = 1 / Number(bandScaleMetersBig);
  return {
    x: Number(qX) + (Number(rX) - camPos.localX) * invScale,
    y: diffYFloat * invScale,
    z: Number(qZ) + (Number(rZ) - camPos.localZ) * invScale,
  };
}

/**
 * Maps a ring LOD level to its Scale-Space Band index (`0` = local, `1..9` = planetary -> cosmic)
 * and exact power-of-2 BigInt scale factor in meters (`1n`, `4096n`, `16777216n`, ...).
 */
export function resolveRingScaleBand(level: number): {
  scaleBand: number;
  bandScaleShift: number;
  bandScaleMetersBig: bigint;
  bandScaleFloat: number;
} {
  if (level <= LOCAL_BAND_MAX_RING_LEVEL) {
    return {
      scaleBand: 0,
      bandScaleShift: 0,
      bandScaleMetersBig: 1n,
      bandScaleFloat: 1,
    };
  }
  const scaleBand =
    1 + Math.floor((level - (LOCAL_BAND_MAX_RING_LEVEL + 1)) / SCALE_BAND_LEVEL_STRIDE);
  const bandScaleShift = scaleBand * SCALE_BAND_LEVEL_STRIDE;
  const bandScaleMetersBig = 1n << BigInt(bandScaleShift);
  return {
    scaleBand,
    bandScaleShift,
    bandScaleMetersBig,
    bandScaleFloat: Number(bandScaleMetersBig),
  };
}

/**
 * Formats a metric horizon distance cleanly for UI badges (`256m`, `1.02 km`, `8.2 km`, `1,000 km`).
 */
export function formatHorizonDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0m';
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  if (km >= 100) return `${Math.round(km).toLocaleString('en-US')} km`;
  if (km >= 10) return `${km.toFixed(1)} km`;
  return `${km.toFixed(2)} km`;
}

/**
 * Formats an arbitrary-precision BigInt distance in meters cleanly for UI badges:
 * `256m`, `1.02 km`, `1,000 km`, `1.00M km`, `1.00B km`, `1.00 × 10^18 km`, `10^31 + 1 km`.
 */
export function formatHorizonDistanceBigInt(metersBig: bigint): string {
  if (metersBig <= 0n) return '0m';
  if (metersBig < 1_000_000_000n) {
    return formatHorizonDistance(Number(metersBig));
  }
  const kmBig = metersBig / 1000n;
  if (kmBig === MAX_RENDER_DISTANCE_KM_BIGINT) {
    return '10^31 + 1 km';
  }
  if (kmBig < 1_000_000n) {
    return `${Number(kmBig).toLocaleString('en-US')} km`;
  }
  if (kmBig < 1_000_000_000n) {
    const val = Number(kmBig) / 1_000_000;
    return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)}M km`;
  }
  if (kmBig < 1_000_000_000_000n) {
    const val = Number(kmBig) / 1_000_000_000;
    return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)}B km`;
  }
  const digits = kmBig.toString();
  const exp = digits.length - 1;
  const lead = digits[0];
  const frac = digits.slice(1, 3);
  return `${lead}.${frac} × 10^${exp} km`;
}

/**
 * Formats an arbitrary-precision BigInt chunk count cleanly for UI headers.
 */
export function formatChunksBigInt(chunksBig: bigint): string {
  if (chunksBig <= 0n) return '0';
  if (chunksBig < 1_000_000_000n) {
    return Number(chunksBig).toLocaleString('en-US');
  }
  const digits = chunksBig.toString();
  const exp = digits.length - 1;
  return `${digits[0]}.${digits.slice(1, 3)} × 10^${exp}`;
}

export interface DynamicHorizonRing {
  /** Ring LOD level (1 = 0.5m, ..., 15 = 8,192m, ..., 110 = cosmic) */
  level: number;
  /** Voxel stride per mega-tile cell: 2^level (Number approximation for <= 15) */
  stepVoxels: number;
  /** Exact BigInt voxel stride per mega-tile cell: 2^level */
  stepVoxelsBig: bigint;
  /** Horizontal cell width in meters: 0.25 * 2^level */
  stepMeters: number;
  /** Width of one mega-tile in chunks: 2^level (Number approximation for <= 15) */
  tileChunks: number;
  /** Exact BigInt width of one mega-tile in chunks: 2^level */
  tileChunksBig: bigint;
  /** Width of one mega-tile in meters: 16 * 2^level */
  tileWorldMeters: number;
  /** Exact BigInt width of one mega-tile in meters: 16 * 2^level */
  tileWorldMetersBig: bigint;
  /** Grid cells along X/Z (64 for LOD1..15, 16 for cosmic LOD16..110 to keep RAM/draw-calls tiny) */
  gridCells: number;
  /** Scale-Space Band index (`0` = local, `1..9` = planetary..cosmic) */
  scaleBand: number;
  /** Exact BigInt scale divisor in meters for this band (`1n`, `4096n`, `16777216n`, ...) */
  bandScaleMetersBig: bigint;
  innerRadiusChunks: number;
  outerRadiusChunks: number;
  innerRadiusChunksBig: bigint;
  outerRadiusChunksBig: bigint;
  innerRadiusMeters: number;
  outerRadiusMeters: number;
}

export interface DynamicLodPlan {
  /** Clamped legacy numeric chunk count (capped at MAX_RENDER_DISTANCE_CHUNKS for numeric UI/fog helpers) */
  renderDistanceChunks: number;
  /** Exact BigInt chunk radius up to MAX_RENDER_DISTANCE_CHUNKS_BIGINT (~6.25 × 10^32 chunks) */
  renderDistanceChunksBig: bigint;
  /** Exact BigInt metric radius in meters (renderDistanceChunksBig * 16n) */
  renderDistanceMetersBig: bigint;
  lodSpacing: number;
  /** Radius in chunks of the crisp LOD0 real-chunk bubble around the focus point */
  realChunkRadiusChunks: number;
  realChunkRadiusMeters: number;
  /** Dynamically generated outer mega-tile rings (0..110 depending on renderDistanceChunks & lodSpacing) */
  rings: DynamicHorizonRing[];
  /** Total active LOD layers (1 for LOD0 + rings.length) */
  totalLodLayers: number;
  /** Total active scale-space rendering bands (1 = Band 0 only, up to 10 for 10^31 km) */
  activeScaleBands: number;
  cameraNear: number;
  cameraFar: number;
  skyDomeScale: number;
  baseFogDensity: number;
}

/** Exclusive chunk-coordinate rectangle [minCX, maxCXExcl) x [minCZ, maxCZExcl). */
export interface ChunkBox {
  minCX: number;
  maxCXExcl: number;
  minCZ: number;
  maxCZExcl: number;
}

/** Exact BigInt exclusive chunk-coordinate rectangle [minCX, maxCXExcl) x [minCZ, maxCZExcl). */
export interface ChunkBoxBigInt {
  minCX: bigint;
  maxCXExcl: bigint;
  minCZ: bigint;
  maxCZExcl: bigint;
}

export interface NestedRingBoxes {
  /** Axis-aligned box of crisp LOD0 real chunks */
  lod0Box: ChunkBox;
  /** One outer box per ring in `plan.rings` (same index order) */
  ringOuterBoxes: ChunkBox[];
}

export interface NestedRingBoxesBigInt {
  /** Axis-aligned box of crisp LOD0 real chunks (exact BigInt) */
  lod0Box: ChunkBoxBigInt;
  /** One exact BigInt outer box per ring in `plan.rings` (same index order) */
  ringOuterBoxes: ChunkBoxBigInt[];
}

export interface HorizonTileCoord {
  level: number;
  tx: number;
  tz: number;
  tileChunks: number;
  minCX: number;
  maxCXExcl: number;
  minCZ: number;
  maxCZExcl: number;
  key: string;
}

export interface HorizonTileCoordBigInt {
  level: number;
  txBig: bigint;
  tzBig: bigint;
  tileChunksBig: bigint;
  minCXBig: bigint;
  maxCXExclBig: bigint;
  minCZBig: bigint;
  maxCZExclBig: bigint;
  scaleBand: number;
  bandScaleMetersBig: bigint;
  key: string;
}

/**
 * Parses and sanitizes a positive-only render distance (in chunks) as a safe JS `number`
 * clamped to `[MIN_RENDER_DISTANCE_CHUNKS, MAX_RENDER_DISTANCE_CHUNKS]` for backwards compatibility.
 */
export function sanitizePositiveRenderDistance(
  input: number | string | null | undefined,
  fallback = 6,
): number {
  const safeFallback = Math.max(
    MIN_RENDER_DISTANCE_CHUNKS,
    Math.min(MAX_RENDER_DISTANCE_CHUNKS, Math.round(fallback)),
  );
  if (input === null || input === undefined) {
    return safeFallback;
  }
  const parsed = typeof input === 'string' ? Number(input.trim()) : input;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return safeFallback;
  }
  return Math.max(
    MIN_RENDER_DISTANCE_CHUNKS,
    Math.min(MAX_RENDER_DISTANCE_CHUNKS, Math.round(parsed)),
  );
}

/**
 * Parses a positive decimal string or scientific notation string (e.g. `"1e31"`, `"10^31"`, `"10000000000000000000000000000001"`)
 * into a positive `BigInt`. Returns `null` for negative, zero, or malformed inputs.
 */
function parsePositiveDecimalOrSciBigInt(raw: string): bigint | null {
  const cleaned = raw.trim().replace(/[_, ]+/g, '');
  if (!cleaned || cleaned.startsWith('-') || cleaned.startsWith('+')) return null;

  // Plain integer digits: e.g. "625000000000000000000000000000063"
  if (/^\d+$/.test(cleaned)) {
    const v = BigInt(cleaned);
    return v > 0n ? v : null;
  }

  // Scientific notation: e.g. "1e31", "6.25e32", "10^31", "10^31+1"
  const powMatch = cleaned.match(/^10\^(\d+)(?:\+(\d+))?$/i);
  if (powMatch) {
    const exp = Number(powMatch[1]);
    if (!Number.isFinite(exp) || exp > 40) return null;
    const base = 10n ** BigInt(exp);
    const add = powMatch[2] ? BigInt(powMatch[2]) : 0n;
    const total = base + add;
    return total > 0n ? total : null;
  }

  const sciMatch = cleaned.match(/^(\d+)(?:\.(\d+))?e(\d+)$/i);
  if (sciMatch) {
    const intPart = sciMatch[1];
    const fracPart = sciMatch[2] ?? '';
    const exp = Number(sciMatch[3]);
    if (!Number.isFinite(exp) || exp > 40) return null;
    const digits = intPart + fracPart;
    const shift = exp - fracPart.length;
    if (shift >= 0) {
      const v = BigInt(digits) * 10n ** BigInt(shift);
      return v > 0n ? v : null;
    }
    // Truncate fractional part for negative shift
    const keepLen = digits.length + shift;
    if (keepLen <= 0) return null;
    const v = BigInt(digits.slice(0, keepLen));
    return v > 0n ? v : null;
  }

  return null;
}

/**
 * Parses user input representing EITHER chunks (`"512"`, `"625000000000000000000000000000063"`)
 * OR kilometers (`"1000 km"`, `"10000000000000000000000000000001 km"`, `"1e31 km"`, `"10^31 km"`)
 * into a clamped positive `BigInt` chunk radius `[2n .. MAX_RENDER_DISTANCE_CHUNKS_BIGINT]`.
 * Returns `null` if invalid/negative/zero.
 */
export function parseRenderDistanceInputToChunksBigInt(rawInput: string): bigint | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const isKm = /km$/i.test(trimmed);
  const numericPart = isKm ? trimmed.slice(0, -2).trim() : trimmed;
  const parsed = parsePositiveDecimalOrSciBigInt(numericPart);
  if (parsed === null) return null;

  const rawChunks = isKm
    ? (parsed * 1000n + CHUNK_SIZE_METERS_BIGINT - 1n) / CHUNK_SIZE_METERS_BIGINT
    : parsed;

  if (rawChunks < MIN_RENDER_DISTANCE_CHUNKS_BIGINT) {
    return MIN_RENDER_DISTANCE_CHUNKS_BIGINT;
  }
  if (rawChunks > MAX_RENDER_DISTANCE_CHUNKS_BIGINT) {
    return MAX_RENDER_DISTANCE_CHUNKS_BIGINT;
  }
  return rawChunks;
}

/**
 * Sanitizes any `bigint | number | string` chunk render distance into an exact clamped BigInt
 * in `[MIN_RENDER_DISTANCE_CHUNKS_BIGINT, MAX_RENDER_DISTANCE_CHUNKS_BIGINT]`.
 */
export function sanitizePositiveRenderDistanceBigInt(
  input: bigint | number | string | null | undefined,
  fallback: bigint = 6n,
): bigint {
  const clampedFallback =
    fallback < MIN_RENDER_DISTANCE_CHUNKS_BIGINT
      ? MIN_RENDER_DISTANCE_CHUNKS_BIGINT
      : fallback > MAX_RENDER_DISTANCE_CHUNKS_BIGINT
        ? MAX_RENDER_DISTANCE_CHUNKS_BIGINT
        : fallback;

  if (input === null || input === undefined) {
    return clampedFallback;
  }
  if (typeof input === 'bigint') {
    if (input <= 0n) return clampedFallback;
    if (input < MIN_RENDER_DISTANCE_CHUNKS_BIGINT) return MIN_RENDER_DISTANCE_CHUNKS_BIGINT;
    if (input > MAX_RENDER_DISTANCE_CHUNKS_BIGINT) return MAX_RENDER_DISTANCE_CHUNKS_BIGINT;
    return input;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return clampedFallback;
    const bi = BigInt(Math.round(input));
    if (bi < MIN_RENDER_DISTANCE_CHUNKS_BIGINT) return MIN_RENDER_DISTANCE_CHUNKS_BIGINT;
    if (bi > MAX_RENDER_DISTANCE_CHUNKS_BIGINT) return MAX_RENDER_DISTANCE_CHUNKS_BIGINT;
    return bi;
  }
  const parsed = parseRenderDistanceInputToChunksBigInt(input);
  return parsed ?? clampedFallback;
}

/**
 * Sanitizes the LOD Transition Spacing multiplier [0.5 .. 2.5].
 * Higher values push every LOD ring further from the player (great for powerful PCs).
 */
export function sanitizeLodSpacing(
  val: number | null | undefined,
  fallback = DEFAULT_LOD_SPACING,
): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return Number(
      Math.max(MIN_LOD_SPACING, Math.min(MAX_LOD_SPACING, fallback)).toFixed(2),
    );
  }
  return Number(
    Math.max(MIN_LOD_SPACING, Math.min(MAX_LOD_SPACING, val)).toFixed(2),
  );
}

/**
 * Computes the complete dynamic O(log R) LOD plan + Scale-Space Banding for any render distance
 * from 2 chunks (32 m) all the way to `MAX_RENDER_DISTANCE_CHUNKS_BIGINT` (`10^31 + 1 km`)!
 */
export function computeDynamicLodPlan(params: {
  renderDistanceChunks: number | bigint | string;
  lodSpacing?: number;
  isLowEndMode?: boolean;
  uncappedChunkLod?: boolean;
  supportsHorizonTiles?: boolean;
}): DynamicLodPlan {
  const renderDistanceChunksBig = sanitizePositiveRenderDistanceBigInt(
    params.renderDistanceChunks,
    6n,
  );
  const renderDistanceChunks =
    renderDistanceChunksBig > BigInt(MAX_RENDER_DISTANCE_CHUNKS)
      ? MAX_RENDER_DISTANCE_CHUNKS
      : Number(renderDistanceChunksBig);
  const renderDistanceMetersBig = renderDistanceChunksBig * CHUNK_SIZE_METERS_BIGINT;
  const lodSpacing = sanitizeLodSpacing(params.lodSpacing, DEFAULT_LOD_SPACING);
  const isLowEndMode = Boolean(params.isLowEndMode);
  const uncappedChunkLod = Boolean(params.uncappedChunkLod);
  const supportsHorizonTiles = params.supportsHorizonTiles !== false;

  // Determine the crisp LOD0 real-chunk bubble radius (always small integer <= 16)
  let realChunkRadiusChunks: number;
  if (!supportsHorizonTiles) {
    realChunkRadiusChunks = Math.min(renderDistanceChunks, 16);
  } else if (uncappedChunkLod) {
    realChunkRadiusChunks = Math.min(renderDistanceChunks, 16);
  } else {
    const baseRealR = isLowEndMode
      ? Math.round(2.0 * lodSpacing)
      : Math.round(3.0 * lodSpacing);
    const maxRealR = isLowEndMode ? 5 : 8;
    const minRealR = 2;
    realChunkRadiusChunks = Math.min(
      renderDistanceChunks,
      Math.max(minRealR, Math.min(maxRealR, baseRealR)),
    );
  }

  const rings: DynamicHorizonRing[] = [];
  const realChunkRadiusBig = BigInt(realChunkRadiusChunks);
  let maxScaleBand = 0;

  if (supportsHorizonTiles && renderDistanceChunksBig > realChunkRadiusBig) {
    let cursorChunksBig = realChunkRadiusBig;
    for (let level = 1; level <= MAX_COSMIC_RING_LEVEL; level++) {
      if (cursorChunksBig >= renderDistanceChunksBig) break;
      const tileChunksBig = 1n << BigInt(level); // 2n, 4n, ..., 2^110
      const stepVoxelsBig = tileChunksBig;
      const tileWorldMetersBig = CHUNK_SIZE_METERS_BIGINT * tileChunksBig;
      const { scaleBand, bandScaleMetersBig } = resolveRingScaleBand(level);
      if (scaleBand > maxScaleBand) maxScaleBand = scaleBand;

      const gridCells =
        level <= LOCAL_BAND_MAX_RING_LEVEL
          ? HORIZON_TILE_GRID_CELLS
          : level <= MAX_HORIZON_RING_LEVEL
            ? 32
            : COSMIC_TILE_GRID_CELLS;

      let ringDepthChunksBig: bigint;
      if (level <= 3) {
        const mult = BigInt(Math.max(200, Math.round(250 * lodSpacing)));
        ringDepthChunksBig = (tileChunksBig * mult) / 100n;
        if (ringDepthChunksBig < tileChunksBig * 2n) ringDepthChunksBig = tileChunksBig * 2n;
      } else if (level <= 5) {
        const mult = BigInt(Math.max(100, Math.round(150 * lodSpacing)));
        ringDepthChunksBig = (tileChunksBig * mult) / 100n;
        if (ringDepthChunksBig < tileChunksBig) ringDepthChunksBig = tileChunksBig;
      } else if (level <= MAX_HORIZON_RING_LEVEL) {
        const mult = BigInt(Math.max(100, Math.round(100 * lodSpacing)));
        ringDepthChunksBig = (tileChunksBig * mult) / 100n;
        if (ringDepthChunksBig < tileChunksBig) ringDepthChunksBig = tileChunksBig;
      } else {
        // Cosmic rings (LOD16..LOD110): exact 1x collar so every ring adds only ~12 tiles!
        ringDepthChunksBig = tileChunksBig;
      }

      const candidateOuterBig = cursorChunksBig + ringDepthChunksBig;
      const outerChunksBig =
        level === MAX_COSMIC_RING_LEVEL
          ? renderDistanceChunksBig
          : candidateOuterBig > renderDistanceChunksBig
            ? renderDistanceChunksBig
            : candidateOuterBig;

      const tileChunksNum = Number(tileChunksBig);
      const tileWorldMetersNum = Number(tileWorldMetersBig);

      rings.push({
        level,
        stepVoxels: tileChunksNum,
        stepVoxelsBig,
        stepMeters: 0.25 * tileChunksNum,
        tileChunks: tileChunksNum,
        tileChunksBig,
        tileWorldMeters: tileWorldMetersNum,
        tileWorldMetersBig,
        gridCells,
        scaleBand,
        bandScaleMetersBig,
        innerRadiusChunks: Number(cursorChunksBig),
        outerRadiusChunks: Number(outerChunksBig),
        innerRadiusChunksBig: cursorChunksBig,
        outerRadiusChunksBig: outerChunksBig,
        innerRadiusMeters: Number(cursorChunksBig * CHUNK_SIZE_METERS_BIGINT),
        outerRadiusMeters: Number(outerChunksBig * CHUNK_SIZE_METERS_BIGINT),
      });

      cursorChunksBig = outerChunksBig;
    }
  }

  const activeScaleBands = 1 + maxScaleBand;
  const radiusMetersNum = renderDistanceChunks * CHUNK_SIZE_METERS;
  // When multi-pass scale bands (Band 1..9) are active, Band 0 ONLY renders local geometry out to
  // ring 9 (~16 km, diagonal ~35 km), so Band 0 keeps a razor-tight far plane (65,536 m) with full
  // 24-bit depth precision! Outer bands each run their own Scale-Space pass with [0.25 .. 65536].
  const cameraFar =
    activeScaleBands > 1
      ? SCALE_BAND_FAR
      : Math.max(420, Math.min(SCALE_BAND_FAR, Math.round(radiusMetersNum * 2.1 + 240)));
  const cameraNear =
    cameraFar > 20_000 ? 0.35 : cameraFar > 4000 ? 0.28 : cameraFar > 1600 ? 0.22 : 0.15;
  const skyDomeScale = Number(
    Math.max(1.0, Math.min(40.0, (cameraFar * 0.78) / 360)).toFixed(3),
  );
  const baseFogDensity = Number(
    (0.0115 / Math.max(2.5, renderDistanceChunks)).toFixed(8),
  );

  return {
    renderDistanceChunks,
    renderDistanceChunksBig,
    renderDistanceMetersBig,
    lodSpacing,
    realChunkRadiusChunks,
    realChunkRadiusMeters: realChunkRadiusChunks * CHUNK_SIZE_METERS,
    rings,
    totalLodLayers: 1 + rings.length,
    activeScaleBands,
    cameraNear,
    cameraFar,
    skyDomeScale,
    baseFogDensity,
  };
}

function floorDivBigInt(a: bigint, b: bigint): bigint {
  // b is always positive here
  const q = a / b;
  const r = a % b;
  return r < 0n ? q - 1n : q;
}

function ceilDivBigInt(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  return r > 0n ? q + 1n : q;
}

function snapBoxOutwardToMultipleBigInt(
  centerCX: bigint,
  centerCZ: bigint,
  radiusChunks: bigint,
  multiple: bigint,
): ChunkBoxBigInt {
  const m = multiple > 1n ? multiple : 1n;
  return {
    minCX: floorDivBigInt(centerCX - radiusChunks, m) * m,
    maxCXExcl: ceilDivBigInt(centerCX + radiusChunks + 1n, m) * m,
    minCZ: floorDivBigInt(centerCZ - radiusChunks, m) * m,
    maxCZExcl: ceilDivBigInt(centerCZ + radiusChunks + 1n, m) * m,
  };
}

/**
 * Computes strictly nested, tile-aligned BigInt chunk boxes around `(centerCX, centerCZ)`.
 * - Every box `B[k]` is snapped to exact multiples of the NEXT ring's `tileChunksBig` (`2^(k+1)`),
 *   and strictly encloses `B[k-1]`.
 * - For cosmic rings (`level >= 16`), expands tightly around `prevBox` snapped to `snapMult`
 *   so every cosmic ring uses only ~12–20 tiles while staying 100% watertight (zero overlaps, zero gaps)!
 */
export function computeNestedRingBoxesBigInt(
  centerCXInput: number | bigint,
  centerCZInput: number | bigint,
  plan: DynamicLodPlan,
): NestedRingBoxesBigInt {
  const centerCX = typeof centerCXInput === 'bigint' ? centerCXInput : BigInt(Math.floor(centerCXInput));
  const centerCZ = typeof centerCZInput === 'bigint' ? centerCZInput : BigInt(Math.floor(centerCZInput));

  if (plan.rings.length === 0) {
    const r = BigInt(plan.realChunkRadiusChunks);
    return {
      lod0Box: {
        minCX: centerCX - r,
        maxCXExcl: centerCX + r + 1n,
        minCZ: centerCZ - r,
        maxCZExcl: centerCZ + r + 1n,
      },
      ringOuterBoxes: [],
    };
  }

  const lod0Box = snapBoxOutwardToMultipleBigInt(
    centerCX,
    centerCZ,
    BigInt(plan.realChunkRadiusChunks),
    plan.rings[0].tileChunksBig,
  );

  const ringOuterBoxes: ChunkBoxBigInt[] = [];
  let prevBox = lod0Box;

  for (let i = 0; i < plan.rings.length; i++) {
    const ring = plan.rings[i];
    const snapMult =
      i + 1 < plan.rings.length
        ? plan.rings[i + 1].tileChunksBig
        : ring.tileChunksBig;

    let box: ChunkBoxBigInt;
    if (ring.level > MAX_HORIZON_RING_LEVEL && i + 1 < plan.rings.length) {
      // Compact 12-to-20-tile cosmic collar: anchor around (centerCX, centerCZ) with radius 1.5*T
      // snapped to snapMult = 2*T so ring widths converge to the 2->4 fixed point (12 tiles/ring)
      // instead of drifting to 4->8 (48 tiles/ring).
      const targetRadius = (3n * ring.tileChunksBig) / 2n;
      box = {
        minCX: floorDivBigInt(centerCX - targetRadius, snapMult) * snapMult,
        maxCXExcl: ceilDivBigInt(centerCX + targetRadius, snapMult) * snapMult,
        minCZ: floorDivBigInt(centerCZ - targetRadius, snapMult) * snapMult,
        maxCZExcl: ceilDivBigInt(centerCZ + targetRadius, snapMult) * snapMult,
      };
    } else {
      box = snapBoxOutwardToMultipleBigInt(
        centerCX,
        centerCZ,
        ring.outerRadiusChunksBig,
        snapMult,
      );
    }

    // Guarantee the outer box encloses prevBox AND remains an exact multiple of snapMult
    if (box.minCX > prevBox.minCX) {
      box.minCX = floorDivBigInt(prevBox.minCX, snapMult) * snapMult;
    }
    if (box.maxCXExcl < prevBox.maxCXExcl) {
      box.maxCXExcl = ceilDivBigInt(prevBox.maxCXExcl, snapMult) * snapMult;
    }
    if (box.minCZ > prevBox.minCZ) {
      box.minCZ = floorDivBigInt(prevBox.minCZ, snapMult) * snapMult;
    }
    if (box.maxCZExcl < prevBox.maxCZExcl) {
      box.maxCZExcl = ceilDivBigInt(prevBox.maxCZExcl, snapMult) * snapMult;
    }

    if (
      ring.level <= MAX_HORIZON_RING_LEVEL &&
      box.minCX === prevBox.minCX &&
      box.maxCXExcl === prevBox.maxCXExcl &&
      box.minCZ === prevBox.minCZ &&
      box.maxCZExcl === prevBox.maxCZExcl
    ) {
      box = {
        minCX: box.minCX - snapMult,
        maxCXExcl: box.maxCXExcl + snapMult,
        minCZ: box.minCZ - snapMult,
        maxCZExcl: box.maxCZExcl + snapMult,
      };
    }

    ringOuterBoxes.push(box);
    prevBox = box;
  }

  return { lod0Box, ringOuterBoxes };
}

/**
 * Legacy numeric wrapper around `computeNestedRingBoxesBigInt` for local/continental callers & tests.
 */
export function computeNestedRingBoxes(
  centerCX: number,
  centerCZ: number,
  plan: DynamicLodPlan,
): NestedRingBoxes {
  const big = computeNestedRingBoxesBigInt(centerCX, centerCZ, plan);
  return {
    lod0Box: {
      minCX: Number(big.lod0Box.minCX),
      maxCXExcl: Number(big.lod0Box.maxCXExcl),
      minCZ: Number(big.lod0Box.minCZ),
      maxCZExcl: Number(big.lod0Box.maxCZExcl),
    },
    ringOuterBoxes: big.ringOuterBoxes.map((b) => ({
      minCX: Number(b.minCX),
      maxCXExcl: Number(b.maxCXExcl),
      minCZ: Number(b.minCZ),
      maxCZExcl: Number(b.maxCZExcl),
    })),
  };
}

export function isChunkInsideBox(cx: number, cz: number, box: ChunkBox): boolean {
  return (
    cx >= box.minCX &&
    cx < box.maxCXExcl &&
    cz >= box.minCZ &&
    cz < box.maxCZExcl
  );
}

export function isChunkInsideBoxBigInt(
  cx: bigint,
  cz: bigint,
  box: ChunkBoxBigInt,
): boolean {
  return (
    cx >= box.minCX &&
    cx < box.maxCXExcl &&
    cz >= box.minCZ &&
    cz < box.maxCZExcl
  );
}

export function isTileInsideBox(
  minCX: number,
  maxCXExcl: number,
  minCZ: number,
  maxCZExcl: number,
  box: ChunkBox,
): boolean {
  return (
    minCX >= box.minCX &&
    maxCXExcl <= box.maxCXExcl &&
    minCZ >= box.minCZ &&
    maxCZExcl <= box.maxCZExcl
  );
}

export function isTileInsideBoxBigInt(
  minCX: bigint,
  maxCXExcl: bigint,
  minCZ: bigint,
  maxCZExcl: bigint,
  box: ChunkBoxBigInt,
): boolean {
  return (
    minCX >= box.minCX &&
    maxCXExcl <= box.maxCXExcl &&
    minCZ >= box.minCZ &&
    maxCZExcl <= box.maxCZExcl
  );
}

export interface OpticalZoomTargetInput {
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  groundY?: number;
  maxDistanceMeters?: number;
  sampleSurfaceY?: (wx: number, wz: number) => number;
}

export interface OpticalZoomTargetResult {
  targetX: number;
  targetY: number;
  targetZ: number;
  distanceMeters: number;
  centerCX: number;
  centerCZ: number;
}

/**
 * Computes the world-space focal point `(targetX, targetY, targetZ)` and chunk coordinates `(centerCX, centerCZ)`
 * that the camera is looking at during an optical zoom, using a fast coarse-to-fine ray march against
 * the procedural/loaded terrain height sampler (or plane intersection fallback).
 */
export function computeOpticalZoomTargetPoint(
  input: OpticalZoomTargetInput,
): OpticalZoomTargetResult {
  const {
    eyeX,
    eyeY,
    eyeZ,
    dirX,
    dirY,
    dirZ,
    groundY = 14.5,
    maxDistanceMeters = 360,
    sampleSurfaceY,
  } = input;

  const dirLen = Math.hypot(dirX, dirY, dirZ) || 1;
  const nx = dirX / dirLen;
  const ny = dirY / dirLen;
  const nz = dirZ / dirLen;
  const clampedMaxDist = Math.max(24, maxDistanceMeters);

  let hitDist = clampedMaxDist;

  if (sampleSurfaceY) {
    const nearLimit = Math.min(480, clampedMaxDist);
    const coarseStep = 8;
    let prevDist = 12;
    let foundBracket = false;
    let bracketLo = 12;
    let bracketHi = 12;

    for (let d = 12; d <= nearLimit; d += coarseStep) {
      const wx = eyeX + nx * d;
      const wy = eyeY + ny * d;
      const wz = eyeZ + nz * d;
      const surfY = sampleSurfaceY(wx, wz);
      if (wy <= surfY) {
        bracketLo = prevDist;
        bracketHi = d;
        foundBracket = true;
        break;
      }
      prevDist = d;
    }

    if (!foundBracket && clampedMaxDist > nearLimit) {
      const farSpan = clampedMaxDist - nearLimit;
      const farStep = Math.max(12, farSpan / 64);
      for (let d = nearLimit + farStep; d <= clampedMaxDist + 0.01; d += farStep) {
        const curD = Math.min(clampedMaxDist, d);
        const wx = eyeX + nx * curD;
        const wy = eyeY + ny * curD;
        const wz = eyeZ + nz * curD;
        const surfY = sampleSurfaceY(wx, wz);
        if (wy <= surfY) {
          bracketLo = prevDist;
          bracketHi = curD;
          foundBracket = true;
          break;
        }
        prevDist = curD;
      }
    }

    if (foundBracket) {
      let lo = bracketLo;
      let hi = bracketHi;
      for (let iter = 0; iter < 6; iter++) {
        const mid = 0.5 * (lo + hi);
        const mY = eyeY + ny * mid;
        const sY = sampleSurfaceY(eyeX + nx * mid, eyeZ + nz * mid);
        if (mY <= sY) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      hitDist = hi;
    } else {
      if (ny < -0.005 && eyeY > groundY) {
        const planeDist = (eyeY - groundY) / -ny;
        hitDist = Math.max(16, Math.min(clampedMaxDist, planeDist));
      } else {
        hitDist = Math.min(clampedMaxDist, Math.max(140, clampedMaxDist * 0.65));
      }
    }
  } else if (ny < -0.005 && eyeY > groundY) {
    const planeDist = (eyeY - groundY) / -ny;
    hitDist = Math.max(16, Math.min(clampedMaxDist, planeDist));
  } else {
    hitDist = Math.min(clampedMaxDist, Math.max(140, clampedMaxDist * 0.65));
  }

  const targetX = eyeX + nx * hitDist;
  const targetZ = eyeZ + nz * hitDist;
  const targetY = sampleSurfaceY
    ? sampleSurfaceY(targetX, targetZ)
    : eyeY + ny * hitDist;

  const centerCX = Math.floor(targetX / CHUNK_SIZE_METERS + 8);
  const centerCZ = Math.floor(targetZ / CHUNK_SIZE_METERS + 8);

  return {
    targetX,
    targetY,
    targetZ,
    distanceMeters: hitDist,
    centerCX,
    centerCZ,
  };
}

/**
 * Computes a compact, tile-aligned `ChunkBoxBigInt` (snapped to LOD1's 2-chunk grid) around a zoomed
 * focal chunk `(zoomCX, zoomCZ)` so the zoomed area renders in full crisp `LOD0` and seamlessly punches
 * out overlapping `LOD1` horizon mega-tiles with zero z-fighting or gaps!
 */
export function computeZoomedLod0BoxBigInt(
  zoomCXInput: number | bigint,
  zoomCZInput: number | bigint,
  radiusChunksInput: number = 2,
  snapMultiple: bigint = 2n,
): ChunkBoxBigInt {
  const zoomCX =
    typeof zoomCXInput === 'bigint' ? zoomCXInput : BigInt(Math.floor(zoomCXInput));
  const zoomCZ =
    typeof zoomCZInput === 'bigint' ? zoomCZInput : BigInt(Math.floor(zoomCZInput));
  const rad = BigInt(Math.max(1, Math.min(4, Math.round(radiusChunksInput))));
  return snapBoxOutwardToMultipleBigInt(zoomCX, zoomCZ, rad, snapMultiple);
}

/**
 * Enumerates all mega-tiles in `ring` using exact BigInt tile coordinates (works up to 10^31 km!).
 * Optionally excludes any tile fully contained inside `secondaryInnerBoxes` (such as an active
 * Optical Zoom LOD0 focus box) when `ring.level === 1` so LOD1 tiles never overlap zoomed LOD0 chunks.
 */
export function enumerateRingTilesBigInt(
  ring: DynamicHorizonRing,
  innerBox: ChunkBoxBigInt,
  outerBox: ChunkBoxBigInt,
  secondaryInnerBoxes?: readonly ChunkBoxBigInt[],
): HorizonTileCoordBigInt[] {
  const tc = ring.tileChunksBig;
  const minTX = floorDivBigInt(outerBox.minCX, tc);
  const maxTXExcl = ceilDivBigInt(outerBox.maxCXExcl, tc);
  const minTZ = floorDivBigInt(outerBox.minCZ, tc);
  const maxTZExcl = ceilDivBigInt(outerBox.maxCZExcl, tc);

  const out: HorizonTileCoordBigInt[] = [];
  for (let tz = minTZ; tz < maxTZExcl; tz++) {
    const minCZBig = tz * tc;
    const maxCZExclBig = minCZBig + tc;
    for (let tx = minTX; tx < maxTXExcl; tx++) {
      const minCXBig = tx * tc;
      const maxCXExclBig = minCXBig + tc;
      if (isTileInsideBoxBigInt(minCXBig, maxCXExclBig, minCZBig, maxCZExclBig, innerBox)) {
        continue;
      }
      if (secondaryInnerBoxes && secondaryInnerBoxes.length > 0) {
        let insideSecondary = false;
        for (let s = 0; s < secondaryInnerBoxes.length; s++) {
          if (
            isTileInsideBoxBigInt(
              minCXBig,
              maxCXExclBig,
              minCZBig,
              maxCZExclBig,
              secondaryInnerBoxes[s],
            )
          ) {
            insideSecondary = true;
            break;
          }
        }
        if (insideSecondary) continue;
      }
      out.push({
        level: ring.level,
        txBig: tx,
        tzBig: tz,
        tileChunksBig: tc,
        minCXBig,
        maxCXExclBig,
        minCZBig,
        maxCZExclBig,
        scaleBand: ring.scaleBand,
        bandScaleMetersBig: ring.bandScaleMetersBig,
        key: `${ring.level}:${tx.toString()},${tz.toString()}`,
      });
    }
  }
  return out;
}

/**
 * Legacy numeric wrapper around `enumerateRingTilesBigInt` for backwards-compatible callers/tests.
 */
export function enumerateRingTiles(
  ring: DynamicHorizonRing,
  innerBox: ChunkBox,
  outerBox: ChunkBox,
): HorizonTileCoord[] {
  const bigTiles = enumerateRingTilesBigInt(
    ring,
    {
      minCX: BigInt(Math.round(innerBox.minCX)),
      maxCXExcl: BigInt(Math.round(innerBox.maxCXExcl)),
      minCZ: BigInt(Math.round(innerBox.minCZ)),
      maxCZExcl: BigInt(Math.round(innerBox.maxCZExcl)),
    },
    {
      minCX: BigInt(Math.round(outerBox.minCX)),
      maxCXExcl: BigInt(Math.round(outerBox.maxCXExcl)),
      minCZ: BigInt(Math.round(outerBox.minCZ)),
      maxCZExcl: BigInt(Math.round(outerBox.maxCZExcl)),
    },
  );
  return bigTiles.map((t) => ({
    level: t.level,
    tx: Number(t.txBig),
    tz: Number(t.tzBig),
    tileChunks: Number(t.tileChunksBig),
    minCX: Number(t.minCXBig),
    maxCXExcl: Number(t.maxCXExclBig),
    minCZ: Number(t.minCZBig),
    maxCZExcl: Number(t.maxCZExclBig),
    key: t.key,
  }));
}

export function doesTileContainChunk(
  tile: Pick<HorizonTileCoord, 'minCX' | 'maxCXExcl' | 'minCZ' | 'maxCZExcl'>,
  cx: number,
  cz: number,
): boolean {
  return (
    cx >= tile.minCX &&
    cx < tile.maxCXExcl &&
    cz >= tile.minCZ &&
    cz < tile.maxCZExcl
  );
}

export function doesTileContainChunkBigInt(
  tile: Pick<HorizonTileCoordBigInt, 'minCXBig' | 'maxCXExclBig' | 'minCZBig' | 'maxCZExclBig'>,
  cx: bigint,
  cz: bigint,
): boolean {
  return (
    cx >= tile.minCXBig &&
    cx < tile.maxCXExclBig &&
    cz >= tile.minCZBig &&
    cz < tile.maxCZExclBig
  );
}
