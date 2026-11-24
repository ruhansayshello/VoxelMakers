import * as THREE from 'three';
import { MAT, VOXEL_SIZE } from '../constants.ts';
import type { Vec3 } from '../physicsMath.ts';
import {
  MaterialType,
  PHYSICS_CONFIG,
  mapVoxelMatToMaterialType,
} from './physicsConfig.ts';

/**
 * Bit-packed int32 voxel coordinate helpers.
 * Packs (vx, vy, vz) ∈ [-512, 511] into a non-negative 30-bit integer (SMI):
 * bits 20..29: (vx + 512) & 0x3FF
 * bits 10..19: (vy + 512) & 0x3FF
 * bits  0..9 : (vz + 512) & 0x3FF
 */
export const VOXEL_KEY_BIAS = 512;
export const VOXEL_KEY_MASK = 0x3ff;

export function packVoxelKey(vx: number, vy: number, vz: number): number {
  const bx = (Math.trunc(vx) + VOXEL_KEY_BIAS) & VOXEL_KEY_MASK;
  const by = (Math.trunc(vy) + VOXEL_KEY_BIAS) & VOXEL_KEY_MASK;
  const bz = (Math.trunc(vz) + VOXEL_KEY_BIAS) & VOXEL_KEY_MASK;
  return (bx << 20) | (by << 10) | bz;
}

export function unpackVoxelKey(key: number): [number, number, number] {
  const k = key | 0;
  const vx = ((k >>> 20) & VOXEL_KEY_MASK) - VOXEL_KEY_BIAS;
  const vy = ((k >>> 10) & VOXEL_KEY_MASK) - VOXEL_KEY_BIAS;
  const vz = (k & VOXEL_KEY_MASK) - VOXEL_KEY_BIAS;
  return [vx, vy, vz];
}

export function normalizeVoxelKey(key: number | string): number {
  if (typeof key === 'number') {
    return key | 0;
  }
  const c1 = key.indexOf(',');
  if (c1 === -1) {
    const parsed = Number(key);
    return Number.isFinite(parsed) ? parsed | 0 : 0;
  }
  const c2 = key.indexOf(',', c1 + 1);
  const vx = parseInt(key.slice(0, c1), 10) || 0;
  const vy = parseInt(key.slice(c1 + 1, c2), 10) || 0;
  const vz = parseInt(key.slice(c2 + 1), 10) || 0;
  return packVoxelKey(vx, vy, vz);
}

/**
 * VoxelInt32Map stores bit-packed int32 keys internally (zero string allocations on hot paths),
 * while remaining backwards-compatible if a caller passes a legacy "vx,vy,vz" string key.
 */
export class VoxelInt32Map<V = number> extends Map<any, V> {
  override get(key: number | string): V | undefined {
    return super.get(typeof key === 'number' ? key : normalizeVoxelKey(key));
  }

  override set(key: number | string, value: V): this {
    return super.set(
      typeof key === 'number' ? key : normalizeVoxelKey(key),
      value,
    );
  }

  override has(key: number | string): boolean {
    return super.has(typeof key === 'number' ? key : normalizeVoxelKey(key));
  }

  override delete(key: number | string): boolean {
    return super.delete(typeof key === 'number' ? key : normalizeVoxelKey(key));
  }
}

export interface SampledCollisionPoint {
  /** Position in vehicle-local space relative to Center of Mass (meters) */
  localPos: THREE.Vector3;
  /** Position in vehicle metric space (vx + 0.5) * VOXEL_SIZE for legacy rig consumers */
  metricPos: Vec3;
  /** Voxel material archetype (default, grippy, slippery, bouncy, crunchy, sticky) */
  material: MaterialType;
  /** Bit-packed int32 hash key of the source voxel */
  voxelKey: number;
  /** Source voxel coordinates */
  vx: number;
  vy: number;
  vz: number;
  /** Raw voxel material ID */
  rawMat: number;
  /** Step 2.3: Sticky material latch state */
  welded?: boolean;
  weldedTargetVehicleId?: string;
  weldedTargetVoxelKey?: number;
}

interface SurfaceVoxelCandidate {
  vx: number;
  vy: number;
  vz: number;
  voxelKey: number;
  rawMat: number;
  material: MaterialType;
  exposedFaces: number;
}

/**
 * Computes the target collision point count based on total vehicle voxels:
 * - Small/simple vehicles (<100 voxels): target 16 points
 * - Medium vehicles (100-300 voxels): target 32 points
 * - Large vehicles (300+ voxels): target 64 points
 */
export function getTargetCollisionPointCount(totalVoxels: number): number {
  const cfg = PHYSICS_CONFIG.collisionSampling;
  if (totalVoxels < cfg.smallVehicleMaxVoxels) {
    return cfg.smallTargetPoints;
  }
  if (totalVoxels <= cfg.mediumVehicleMaxVoxels) {
    return cfg.mediumTargetPoints;
  }
  return cfg.largeTargetPoints;
}

/**
 * Groups surface voxels into a 3D grid of cells of size `cellSize` (in voxels)
 * and picks one representative voxel per non-empty cell (the one closest to the cell center).
 */
function sampleSurfaceVoxelsWithCellSize(
  surfaceVoxels: SurfaceVoxelCandidate[],
  cellSize: number,
): SurfaceVoxelCandidate[] {
  const safeCellSize = Math.max(1, cellSize);
  const bestPerCell = new Map<
    string,
    { candidate: SurfaceVoxelCandidate; distSq: number }
  >();

  for (let i = 0; i < surfaceVoxels.length; i++) {
    const sv = surfaceVoxels[i];
    const cx = Math.floor(sv.vx / safeCellSize);
    const cy = Math.floor(sv.vy / safeCellSize);
    const cz = Math.floor(sv.vz / safeCellSize);
    const cellKey = `${cx},${cy},${cz}`;

    const centerX = (cx + 0.5) * safeCellSize;
    const centerY = (cy + 0.5) * safeCellSize;
    const centerZ = (cz + 0.5) * safeCellSize;

    const dx = sv.vx + 0.5 - centerX;
    const dy = sv.vy + 0.5 - centerY;
    const dz = sv.vz + 0.5 - centerZ;
    // Slight preference for more-exposed corner/edge voxels when equidistant
    const distSq = dx * dx + dy * dy + dz * dz - sv.exposedFaces * 0.01;

    const existing = bestPerCell.get(cellKey);
    if (!existing || distSq < existing.distSq) {
      bestPerCell.set(cellKey, { candidate: sv, distSq });
    }
  }

  const picked: SurfaceVoxelCandidate[] = [];
  for (const entry of bestPerCell.values()) {
    picked.push(entry.candidate);
  }
  return picked;
}

/**
 * Samples the vehicle's actual 3D voxel hull into a representative set of surface collision points.
 *
 * Algorithm:
 * 1. Iterate all surface voxels in the vehicle (voxels with at least one air neighbor).
 * 2. Group them into a 3D grid of cells (starting at cell size = 2 voxels, auto-adjusted to hit target).
 * 3. For each non-empty cell, pick one representative voxel (the one closest to the cell center).
 * 4. Store localPos (relative to CoM), material (MaterialType), and voxelKey (int32 hash key).
 */
export function sampleVehicleCollisionPoints(
  voxelMap: Map<number | string, number>,
  comMetric: Vec3,
  getVoxelFn?: (vx: number, vy: number, vz: number) => number,
): SampledCollisionPoint[] {
  const totalVoxels = voxelMap.size;
  if (totalVoxels === 0) {
    return [];
  }

  const hasAirNeighbor = (vx: number, vy: number, vz: number): number => {
    let airCount = 0;
    if (getVoxelFn) {
      if (getVoxelFn(vx + 1, vy, vz) === MAT.AIR) airCount++;
      if (getVoxelFn(vx - 1, vy, vz) === MAT.AIR) airCount++;
      if (getVoxelFn(vx, vy + 1, vz) === MAT.AIR) airCount++;
      if (getVoxelFn(vx, vy - 1, vz) === MAT.AIR) airCount++;
      if (getVoxelFn(vx, vy, vz + 1) === MAT.AIR) airCount++;
      if (getVoxelFn(vx, vy, vz - 1) === MAT.AIR) airCount++;
      return airCount;
    }
    if (!voxelMap.has(packVoxelKey(vx + 1, vy, vz))) airCount++;
    if (!voxelMap.has(packVoxelKey(vx - 1, vy, vz))) airCount++;
    if (!voxelMap.has(packVoxelKey(vx, vy + 1, vz))) airCount++;
    if (!voxelMap.has(packVoxelKey(vx, vy - 1, vz))) airCount++;
    if (!voxelMap.has(packVoxelKey(vx, vy, vz + 1))) airCount++;
    if (!voxelMap.has(packVoxelKey(vx, vy, vz - 1))) airCount++;
    return airCount;
  };

  const surfaceVoxels: SurfaceVoxelCandidate[] = [];
  for (const [rawKey, mat] of voxelMap.entries()) {
    if (mat === MAT.AIR) continue;
    let vx: number;
    let vy: number;
    let vz: number;
    let voxelKey: number;
    if (typeof rawKey === 'number') {
      voxelKey = rawKey;
      [vx, vy, vz] = unpackVoxelKey(rawKey);
    } else {
      voxelKey = normalizeVoxelKey(rawKey);
      [vx, vy, vz] = unpackVoxelKey(voxelKey);
    }

    const exposedFaces = hasAirNeighbor(vx, vy, vz);
    if (exposedFaces > 0) {
      surfaceVoxels.push({
        vx,
        vy,
        vz,
        voxelKey,
        rawMat: mat,
        material: mapVoxelMatToMaterialType(mat),
        exposedFaces,
      });
    }
  }

  if (surfaceVoxels.length === 0) {
    return [];
  }

  const targetPoints = getTargetCollisionPointCount(totalVoxels);
  const maxPoints = PHYSICS_CONFIG.collisionSampling.maxCollisionPoints;

  // Start at default cell size = 2 voxels, then auto-adjust cell size to hit targetPoints
  let bestSample = sampleSurfaceVoxelsWithCellSize(
    surfaceVoxels,
    PHYSICS_CONFIG.collisionSampling.defaultCellSizeVoxels,
  );
  let bestDiff = Math.abs(bestSample.length - targetPoints);

  const candidateCellSizes = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 8];
  for (let i = 0; i < candidateCellSizes.length; i++) {
    const cs = candidateCellSizes[i];
    const sample = sampleSurfaceVoxelsWithCellSize(surfaceVoxels, cs);
    const diff = Math.abs(sample.length - targetPoints);
    if (
      sample.length <= maxPoints &&
      (diff < bestDiff || bestSample.length > maxPoints)
    ) {
      bestSample = sample;
      bestDiff = diff;
    }
  }

  // If still above maxCollisionPoints (64), sort by distance from CoM + exposure so hull extremities stay represented
  if (bestSample.length > maxPoints) {
    bestSample.sort((a, b) => {
      const ax = (a.vx + 0.5) * VOXEL_SIZE - comMetric.x;
      const ay = (a.vy + 0.5) * VOXEL_SIZE - comMetric.y;
      const az = (a.vz + 0.5) * VOXEL_SIZE - comMetric.z;
      const bx = (b.vx + 0.5) * VOXEL_SIZE - comMetric.x;
      const by = (b.vy + 0.5) * VOXEL_SIZE - comMetric.y;
      const bz = (b.vz + 0.5) * VOXEL_SIZE - comMetric.z;
      const da = ax * ax + ay * ay + az * az + a.exposedFaces * 0.1;
      const db = bx * bx + by * by + bz * bz + b.exposedFaces * 0.1;
      return db - da;
    });
    bestSample = bestSample.slice(0, maxPoints);
  }

  const result: SampledCollisionPoint[] = new Array(bestSample.length);
  for (let i = 0; i < bestSample.length; i++) {
    const sv = bestSample[i];
    const mx = (sv.vx + 0.5) * VOXEL_SIZE;
    const my = (sv.vy + 0.5) * VOXEL_SIZE;
    const mz = (sv.vz + 0.5) * VOXEL_SIZE;
    result[i] = {
      localPos: new THREE.Vector3(
        mx - comMetric.x,
        my - comMetric.y,
        mz - comMetric.z,
      ),
      metricPos: { x: mx, y: my, z: mz },
      material: sv.material,
      voxelKey: sv.voxelKey,
      vx: sv.vx,
      vy: sv.vy,
      vz: sv.vz,
      rawMat: sv.rawMat,
    };
  }

  return result;
}
