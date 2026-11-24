import * as THREE from 'three';
import { VOXEL_SIZE } from '../constants.ts';
import { PHYSICS_CONFIG } from './physicsConfig.ts';

export interface BroadphaseVehicleLike {
  vehicleId: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  comLocal: THREE.Vector3;
  minVX: number;
  maxVX: number;
  minVY: number;
  maxVY: number;
  minVZ: number;
  maxVZ: number;
  inBuildMode?: boolean;
  voxelCount?: number;
  modules?: Array<{
    kind: string;
    vx: number;
    vy: number;
    vz: number;
    health?: number;
  }>;
  aabbMin?: THREE.Vector3;
  aabbMax?: THREE.Vector3;
}

export interface BroadphasePair<T extends BroadphaseVehicleLike = BroadphaseVehicleLike> {
  vehicleA: T;
  vehicleB: T;
}

// Pre-allocated scratch vectors for zero-GC AABB updates
const _localCenter = new THREE.Vector3();
const _localHalf = new THREE.Vector3();
const _worldCenter = new THREE.Vector3();
const _rotX = new THREE.Vector3();
const _rotY = new THREE.Vector3();
const _rotZ = new THREE.Vector3();

/**
 * Packs a 2D spatial hash grid cell coordinate (cx, cz) into a 32-bit integer key.
 */
export function packSpatialCellKey(cx: number, cz: number): number {
  const bx = (cx + 32768) & 0xffff;
  const bz = (cz + 32768) & 0xffff;
  return (bx << 16) | bz;
}

/**
 * Computes and updates a vehicle's world-space AABB (min/max Vector3) from its local voxel bounds,
 * Center of Mass, world position, and quaternion rotation.
 */
export function updateVehicleWorldAABB(
  vehicle: BroadphaseVehicleLike,
  outMin?: THREE.Vector3,
  outMax?: THREE.Vector3,
): { min: THREE.Vector3; max: THREE.Vector3 } {
  const minVec = outMin || (vehicle.aabbMin ??= new THREE.Vector3());
  const maxVec = outMax || (vehicle.aabbMax ??= new THREE.Vector3());

  const pad = PHYSICS_CONFIG.broadphase.aabbPaddingMeters;
  const minLocalX = vehicle.minVX * VOXEL_SIZE - vehicle.comLocal.x;
  const maxLocalX = (vehicle.maxVX + 1) * VOXEL_SIZE - vehicle.comLocal.x;
  const minLocalY = vehicle.minVY * VOXEL_SIZE - vehicle.comLocal.y;
  const maxLocalY = (vehicle.maxVY + 1) * VOXEL_SIZE - vehicle.comLocal.y;
  const minLocalZ = vehicle.minVZ * VOXEL_SIZE - vehicle.comLocal.z;
  const maxLocalZ = (vehicle.maxVZ + 1) * VOXEL_SIZE - vehicle.comLocal.z;

  _localCenter.set(
    0.5 * (minLocalX + maxLocalX),
    0.5 * (minLocalY + maxLocalY),
    0.5 * (minLocalZ + maxLocalZ),
  );
  _localHalf.set(
    Math.max(0.4, 0.5 * (maxLocalX - minLocalX)) + pad,
    Math.max(0.4, 0.5 * (maxLocalY - minLocalY)) + pad,
    Math.max(0.4, 0.5 * (maxLocalZ - minLocalZ)) + pad,
  );

  // Transform local bounding box center to world space
  _worldCenter
    .copy(_localCenter)
    .applyQuaternion(vehicle.quaternion)
    .add(vehicle.position);

  // Rotate basis axes to compute exact world-space AABB half-extents without iterating 8 corners
  _rotX.set(1, 0, 0).applyQuaternion(vehicle.quaternion);
  _rotY.set(0, 1, 0).applyQuaternion(vehicle.quaternion);
  _rotZ.set(0, 0, 1).applyQuaternion(vehicle.quaternion);

  const worldHalfX =
    Math.abs(_rotX.x) * _localHalf.x +
    Math.abs(_rotY.x) * _localHalf.y +
    Math.abs(_rotZ.x) * _localHalf.z;
  const worldHalfY =
    Math.abs(_rotX.y) * _localHalf.x +
    Math.abs(_rotY.y) * _localHalf.y +
    Math.abs(_rotZ.y) * _localHalf.z;
  const worldHalfZ =
    Math.abs(_rotX.z) * _localHalf.x +
    Math.abs(_rotY.z) * _localHalf.y +
    Math.abs(_rotZ.z) * _localHalf.z;

  minVec.set(
    _worldCenter.x - worldHalfX,
    _worldCenter.y - worldHalfY,
    _worldCenter.z - worldHalfZ,
  );
  maxVec.set(
    _worldCenter.x + worldHalfX,
    _worldCenter.y + worldHalfY,
    _worldCenter.z + worldHalfZ,
  );

  return { min: minVec, max: maxVec };
}

/**
 * Tests whether two 3D world-space AABBs overlap on all three axes.
 */
export function testAABBOverlap(
  minA: THREE.Vector3,
  maxA: THREE.Vector3,
  minB: THREE.Vector3,
  maxB: THREE.Vector3,
): boolean {
  return (
    minA.x <= maxB.x &&
    maxA.x >= minB.x &&
    minA.y <= maxB.y &&
    maxA.y >= minB.y &&
    minA.z <= maxB.z &&
    maxA.z >= minB.z
  );
}

/**
 * Step 2.1: Spatial Hash Grid Broadphase (16m cells) + World-Space AABB Overlap Test.
 * Reduces vehicle-vehicle collision checks from O(N^2) to O(N) for typical scenes.
 */
export class SpatialHashBroadphase<
  T extends BroadphaseVehicleLike = BroadphaseVehicleLike,
> {
  public cellSize: number;
  /** Map<cellKey, vehicleIndices[]> with pooled arrays to avoid per-frame GC */
  private cells = new Map<number, number[]>();
  private activeCellKeys: number[] = [];
  private aabbMins: THREE.Vector3[] = [];
  private aabbMaxs: THREE.Vector3[] = [];
  private cellCoordsX: number[] = [];
  private cellCoordsZ: number[] = [];
  private overlappingPairs: Array<BroadphasePair<T>> = [];

  constructor(cellSize = PHYSICS_CONFIG.broadphase.cellSizeMeters) {
    this.cellSize = Math.max(1.0, cellSize);
  }

  /**
   * Updates world-space AABBs for all vehicles, populates the 16m spatial hash grid,
   * tests pairs in the same or adjacent cells for AABB overlap, and returns overlapping pairs.
   */
  public findOverlappingPairs(vehicles: readonly T[]): Array<BroadphasePair<T>> {
    this.overlappingPairs.length = 0;
    const n = vehicles.length;
    if (n < 2) {
      return this.overlappingPairs;
    }

    const invCellSize = 1.0 / Math.max(1.0, this.cellSize);

    // Clear active cells from previous frame without discarding pooled bucket arrays
    for (let i = 0; i < this.activeCellKeys.length; i++) {
      const bucket = this.cells.get(this.activeCellKeys[i]);
      if (bucket) {
        bucket.length = 0;
      }
    }
    this.activeCellKeys.length = 0;

    // Ensure scratch AABB arrays have sufficient capacity
    while (this.aabbMins.length < n) {
      this.aabbMins.push(new THREE.Vector3());
      this.aabbMaxs.push(new THREE.Vector3());
    }

    // 1 & 2. Update each vehicle's world-space AABB and insert into spatial hash cell based on position
    for (let i = 0; i < n; i++) {
      const v = vehicles[i];
      if (
        v.inBuildMode ||
        ((v.voxelCount ?? 1) === 0 && (!v.modules || v.modules.length === 0))
      ) {
        this.cellCoordsX[i] = Number.NaN;
        this.cellCoordsZ[i] = Number.NaN;
        continue;
      }

      updateVehicleWorldAABB(v, this.aabbMins[i], this.aabbMaxs[i]);
      v.aabbMin = this.aabbMins[i];
      v.aabbMax = this.aabbMaxs[i];

      const cx = Math.floor(v.position.x * invCellSize);
      const cz = Math.floor(v.position.z * invCellSize);
      this.cellCoordsX[i] = cx;
      this.cellCoordsZ[i] = cz;

      const key = packSpatialCellKey(cx, cz);
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      if (bucket.length === 0) {
        this.activeCellKeys.push(key);
      }
      bucket.push(i);
    }

    // 3, 4 & 5. For each pair of vehicles (A, B) in the same cell or adjacent 3x3 cells, do AABB overlap test
    for (let i = 0; i < n; i++) {
      const cx = this.cellCoordsX[i];
      const cz = this.cellCoordsZ[i];
      if (Number.isNaN(cx) || Number.isNaN(cz)) {
        continue;
      }

      const minA = this.aabbMins[i];
      const maxA = this.aabbMaxs[i];

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const neighborKey = packSpatialCellKey(cx + dx, cz + dz);
          const bucket = this.cells.get(neighborKey);
          if (!bucket || bucket.length === 0) {
            continue;
          }

          for (let bIdx = 0; bIdx < bucket.length; bIdx++) {
            const j = bucket[bIdx];
            // Only test each unordered pair once (j > i)
            if (j <= i) {
              continue;
            }

            if (testAABBOverlap(minA, maxA, this.aabbMins[j], this.aabbMaxs[j])) {
              this.overlappingPairs.push({
                vehicleA: vehicles[i],
                vehicleB: vehicles[j],
              });
            }
          }
        }
      }
    }

    return this.overlappingPairs;
  }
}
