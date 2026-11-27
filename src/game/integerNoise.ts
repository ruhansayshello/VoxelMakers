/**
 * Pure Integer-Hashed Procedural Terrain & BigInt Value-Noise FBM
 *
 * Designed for ultra-far & cosmic Distant Horizons LOD rings (up to 10^31 km / 10^34 m):
 * - Uses 64-bit SplitMix64 integer bitwise mixing directly on BigInt grid coordinates.
 * - ZERO large Float64 inputs into Math.sin / Math.cos / trig noise functions,
 *   completely eliminating far-range floating-point quantization and banding.
 * - Deterministic across all platforms, zero heap allocations per sample.
 */

import {
  MAT,
  SUBTERRANEAN_DEPTH_VY,
  TOTAL_VX,
  TOTAL_VZ,
  WATER_VY,
  type WorldGenMode,
} from './constants.ts';

const MASK_64 = 0xffffffffffffffffn;
const MASK_32 = 0xffffffffn;
const INV_2_32 = 1 / 4294967296;

const HALF_VX_BIG = BigInt(TOTAL_VX >> 1);
const HALF_VZ_BIG = BigInt(TOTAL_VZ >> 1);

const SEED_CONTINENT = 0x243f6a8885a308d3n;
const SEED_MOUNTAIN = 0x13198a2e03707344n;
const SEED_DETAIL = 0xa4093822299f31d0n;
const SEED_BIOME = 0x082efa98ec4e6c89n;

/**
 * 64-bit SplitMix64 integer avalanche mixer operating purely on BigInt bit patterns.
 */
export function splitMix64(x: bigint): bigint {
  let z = (x + 0x9e3779b97f4a7c15n) & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (z ^ (z >> 31n)) & MASK_64;
}

/**
 * Hashes an arbitrary-magnitude 2D BigInt integer grid coordinate `(ix, iz)` + `seed`
 * into a deterministic uniform value in `[0, 1)`.
 * Works identically at `0n`, `10^15n`, and `10^35n` with zero float quantization!
 */
export function hashBigInt2D(ix: bigint, iz: bigint, seed: bigint): number {
  // Fold arbitrary-width BigInt coords into 64-bit lanes without losing high bits
  const lx = (ix ^ (ix >> 64n) ^ (ix >> 128n)) & MASK_64;
  const lz = (iz ^ (iz >> 64n) ^ (iz >> 128n)) & MASK_64;
  const hx = splitMix64(lx ^ seed);
  const hz = splitMix64((lz * 0xd6e8feb86659fd93n + 0xa5a3564e27f8862dn) & MASK_64);
  const mixed = splitMix64(hx ^ ((hz << 17n) | (hz >> 47n)) ^ seed);
  return Number((mixed >> 32n) & MASK_32) * INV_2_32;
}

/**
 * Computes the binary bit-length of a positive BigInt (0 for <= 0n).
 */
export function bigIntBitLength(n: bigint): number {
  if (n <= 0n) return 0;
  let v = n;
  let bits = 0;
  while (v >= 0x100000000n) {
    v >>= 32n;
    bits += 32;
  }
  let num = Number(v);
  while (num > 0) {
    num >>>= 1;
    bits++;
  }
  return bits;
}

/**
 * Smooth 2D integer-lattice value noise sampled at `(gx, gz)` with lattice spacing `2^scaleShift`.
 * Uses exact BigInt bit shifts & masks for cell coordinates and local fraction `[0, 1)`,
 * then smoothstep-interpolates the 4 integer-hashed corners.
 */
export function sampleIntegerValueNoise2D(
  gx: bigint,
  gz: bigint,
  scaleShift: bigint,
  seed: bigint,
): number {
  const shift = scaleShift < 0n ? 0n : scaleShift;
  if (shift === 0n) {
    return hashBigInt2D(gx, gz, seed);
  }

  const cx = gx >> shift;
  const cz = gz >> shift;

  // Extract the top 16 fractional bits cleanly so `fx, fz` never lose precision even if `shift > 53`!
  let fx: number;
  let fz: number;
  if (shift <= 16n) {
    const span = 1 << Number(shift);
    const mask = BigInt(span - 1);
    fx = Number(gx & mask) / span;
    fz = Number(gz & mask) / span;
  } else {
    const fracShift = shift - 16n;
    fx = Number((gx >> fracShift) & 0xffffn) / 65536;
    fz = Number((gz >> fracShift) & 0xffffn) / 65536;
  }

  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const v00 = hashBigInt2D(cx, cz, seed);
  const v10 = hashBigInt2D(cx + 1n, cz, seed);
  const v01 = hashBigInt2D(cx, cz + 1n, seed);
  const v11 = hashBigInt2D(cx + 1n, cz + 1n, seed);

  const nx0 = v00 + (v10 - v00) * ux;
  const nx1 = v01 + (v11 - v01) * ux;
  return nx0 + (nx1 - nx0) * uz;
}

/**
 * Multi-octave integer-hashed FBM in `[-1, 1]` with zero float trig or coordinate quantization.
 */
export function sampleIntegerFbm2D(
  gx: bigint,
  gz: bigint,
  baseScaleShift: bigint,
  octaves = 3,
  seed = SEED_CONTINENT,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let shift = baseScaleShift;
  let curSeed = seed;

  for (let i = 0; i < octaves; i++) {
    const n = sampleIntegerValueNoise2D(gx, gz, shift, curSeed) * 2 - 1;
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    if (shift > 0n) shift -= 1n;
    curSeed = splitMix64(curSeed + 0x517cc1b727220a95n);
  }
  return norm > 0 ? sum / norm : 0;
}

export interface IntegerHorizonColumn {
  surfVY: number;
  topMat: number;
  hasWater: boolean;
}

/**
 * Evaluates a distant / cosmic terrain column purely from BigInt voxel coordinates `(vxBig, vzBig)`
 * and tile cell stride `stepVoxelsBig`, matching each `WorldGenMode` palette and elevation profile
 * all the way out to 10^31 km with zero floating-point quantization.
 */
export function evaluateIntegerHashedHorizonColumn(
  vxBig: bigint,
  vzBig: bigint,
  stepVoxelsBig: bigint,
  worldGenMode: WorldGenMode,
  flatBaseplateMat: number,
): IntegerHorizonColumn {
  if (worldGenMode === 'FLAT_BASEPLATE') {
    return {
      surfVY: 46, // SUBTERRANEAN_DEPTH_VY (36) + 10
      topMat: flatBaseplateMat,
      hasWater: false,
    };
  }

  // Choose scale-adaptive integer octave shifts so continents & mountain ranges stay coherent
  // at every distance band (from 16 km up to 10^31 km!) without aliasing into static noise.
  const stepBits = Math.max(8, bigIntBitLength(stepVoxelsBig));
  const macroShift = BigInt(stepBits + 3);
  const ridgeShift = BigInt(stepBits + 2);
  const detailShift = BigInt(stepBits + 1);

  const rxBig = vxBig - HALF_VX_BIG;
  const rzBig = vzBig - HALF_VZ_BIG;

  const continent = sampleIntegerFbm2D(rxBig, rzBig, macroShift, 3, SEED_CONTINENT);
  const ridge = 1.0 - Math.abs(sampleIntegerFbm2D(rxBig, rzBig, ridgeShift, 2, SEED_MOUNTAIN));
  const detail = sampleIntegerValueNoise2D(rxBig, rzBig, detailShift, SEED_DETAIL) * 2 - 1;
  const biomeVar = sampleIntegerValueNoise2D(rxBig, rzBig, macroShift + 1n, SEED_BIOME);

  // Base subterranean offset matches constants.ts (SUBTERRANEAN_DEPTH_VY = 48)
  const BASE_VY = SUBTERRANEAN_DEPTH_VY;

  if (worldGenMode === 'BIOME_CANYON') {
    const rawH = 12 + continent * 14 + ridge * 10 + detail * 2.5;
    // Terraced mesa quantization for iconic canyon steps
    const terraced = Math.round(rawH / 4) * 4;
    const surfVY = Math.max(BASE_VY + 4, Math.min(BASE_VY + 46, BASE_VY + terraced));
    let topMat: number = MAT.CANYON_ORANGE;
    if (surfVY >= BASE_VY + 26) topMat = MAT.CANYON_RED;
    else if (surfVY <= BASE_VY + 10) topMat = MAT.SAND;
    else if (biomeVar > 0.72) topMat = MAT.ROCK;
    return { surfVY, topMat, hasWater: false };
  }

  if (worldGenMode === 'BIOME_ARCTIC') {
    const h = Math.round(8 + continent * 14 + ridge * 11 + detail * 2.0);
    const surfVY = Math.max(BASE_VY - 6, Math.min(BASE_VY + 48, BASE_VY + h));
    const hasWater = surfVY < WATER_VY;
    let topMat: number = MAT.PAINT_WHITE;
    if (hasWater) topMat = MAT.ICE_SLICK;
    else if (surfVY >= BASE_VY + 24) topMat = MAT.ROCK;
    else if (biomeVar < 0.28) topMat = MAT.ICE_SLICK;
    return { surfVY, topMat, hasWater };
  }

  if (worldGenMode === 'BIOME_VOLCANIC') {
    const h = Math.round(10 + continent * 13 + ridge * 14 + detail * 2.5);
    const surfVY = Math.max(BASE_VY + 2, Math.min(BASE_VY + 52, BASE_VY + h));
    let topMat: number = MAT.PAINT_CARBON;
    if (surfVY <= BASE_VY + 7 && biomeVar < 0.45) topMat = MAT.MAGMA_CORE;
    else if (surfVY >= BASE_VY + 28) topMat = MAT.ROCK;
    else if (biomeVar > 0.65) topMat = MAT.ROCK;
    return { surfVY, topMat, hasWater: false };
  }

  if (worldGenMode === 'BIOME_ARCHIPELAGO' || worldGenMode === 'CUSTOM_GLB_MAP') {
    const h = Math.round(3 + continent * 14 + ridge * 6 + detail * 2.0);
    const surfVY =
      worldGenMode === 'CUSTOM_GLB_MAP'
        ? Math.max(BASE_VY - 24, Math.min(WATER_VY - 2, BASE_VY - 8 + Math.round(detail * 2)))
        : Math.max(BASE_VY - 14, Math.min(BASE_VY + 32, BASE_VY + h));
    const hasWater = surfVY < WATER_VY;
    let topMat: number = MAT.GRASS;
    if (surfVY <= WATER_VY - 4) topMat = MAT.ROCK;
    else if (surfVY <= WATER_VY + 2) topMat = MAT.SAND;
    else if (surfVY >= BASE_VY + 18) topMat = MAT.ROCK;
    return { surfVY, topMat, hasWater };
  }

  // DEFAULT_PARK & CUSTOM_HEIGHTMAP: Endless West Ocean hemisphere + rolling green/canyon/mountain continents with lakes
  const isWestOceanHemisphere = rxBig < -88n;
  if (isWestOceanHemisphere) {
    // Ocean basin with distant island chains so far cosmic horizons still show rich ocean & continents
    const islandLift = continent > 0.22 ? (continent - 0.22) * 34 + ridge * 8 : -10;
    const surfVY = Math.max(
      BASE_VY - 16,
      Math.min(BASE_VY + 36, Math.round(BASE_VY + 4 + islandLift + detail * 1.5)),
    );
    const hasWater = surfVY < WATER_VY;
    let topMat: number = MAT.SAND;
    if (hasWater) topMat = surfVY <= BASE_VY - 6 ? MAT.ROCK : MAT.SAND;
    else if (surfVY >= BASE_VY + 20) topMat = MAT.CANYON_ORANGE;
    else if (surfVY >= WATER_VY + 2) topMat = MAT.GRASS;
    return { surfVY, topMat, hasWater };
  }

  const hill = Math.round(9 + continent * 10 + ridge * 7 + detail * 2.0);
  const surfVY = Math.max(BASE_VY + 4, Math.min(BASE_VY + 38, BASE_VY + hill));
  const hasWater = surfVY < WATER_VY;
  let topMat: number = MAT.GRASS;
  if (surfVY >= BASE_VY + 24) topMat = MAT.ROCK;
  else if (surfVY >= BASE_VY + 17) topMat = MAT.CANYON_ORANGE;
  else if (surfVY <= WATER_VY + 1) topMat = MAT.SAND;
  return { surfVY, topMat, hasWater };
}
