import * as THREE from 'three';
import { MAT, MAT_INFO, VOXEL_SIZE } from '../constants.ts';
import { isSeatModuleKind } from '../physicsMath.ts';
import {
  packVoxelKey,
  unpackVoxelKey,
  normalizeVoxelKey,
} from './collisionPoints.ts';
import { PHYSICS_CONFIG } from './physicsConfig.ts';
import type { VoxelDebrisSystem } from './debris.ts';
import type { CustomRigidBody } from './customRigidBody.ts';

/**
 * Direct RGB render color code for red `falling_off` / build-mode disconnected voxel tint.
 * Uses greedyMeshBoundedArrays custom color flag `0x40000000 | (r << 16) | (g << 8) | b`.
 */
export const FALLING_OFF_RENDER_COLOR_CODE =
  0x40000000 | (PHYSICS_CONFIG.structuralIntegrity.fallOffTintHex & 0xffffff);

/**
 * Step 2.5: The 10 connectivity neighbors (C-Simple):
 * Up, Down, N, S, E, W, NE, NW, SE, SW.
 */
export const TEN_NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 0], // Up
  [0, -1, 0], // Down
  [0, 0, 1], // N (+Z)
  [0, 0, -1], // S (-Z)
  [1, 0, 0], // E (+X)
  [-1, 0, 0], // W (-X)
  [1, 0, 1], // NE
  [-1, 0, 1], // NW
  [1, 0, -1], // SE
  [-1, 0, -1], // SW
];

export interface FallingOffVoxelEntry {
  voxelKey: number;
  vx: number;
  vy: number;
  vz: number;
  mat: number;
  remainingSec: number;
  totalDelaySec: number;
  impactOrigin?: THREE.Vector3;
  /** True when marked disconnected during Build Mode preview (tinted red, falls off on exiting Build Mode) */
  isBuildModePreview?: boolean;
}

export interface VehicleConnectivityCache {
  dirty: boolean;
  /** Adjacency list mapping int32 voxelKey -> array of existing 10-neighbor int32 voxelKeys */
  neighborsByKey: Map<number, number[]>;
  /** Set of int32 voxelKeys considered structural "core" anchors (cockpit, engine, seat, or marked core) */
  coreVoxelKeys: Set<number>;
  /** Invalidates the connectivity cache so the next structural integrity check recomputes from scratch */
  invalidate: () => void;
}

export function createVehicleConnectivityCache(): VehicleConnectivityCache {
  const neighborsByKey = new Map<number, number[]>();
  const coreVoxelKeys = new Set<number>();
  const cache: VehicleConnectivityCache = {
    dirty: true,
    neighborsByKey,
    coreVoxelKeys,
    invalidate() {
      cache.dirty = true;
      neighborsByKey.clear();
      coreVoxelKeys.clear();
    },
  };
  return cache;
}

export interface StructuralVehicleTarget {
  vehicleId?: string;
  inBuildMode?: boolean;
  voxelMap: Map<number | string, number>;
  voxelHealthMap?: Map<number | string, number>;
  modules?: Array<{
    kind: string;
    vx: number;
    vy: number;
    vz: number;
    health?: number;
  }>;
  coreVoxelKeys?: Set<number>;
  fallingOffVoxels?: Map<number, FallingOffVoxelEntry>;
  connectivityCache?: VehicleConnectivityCache | null;
  rigidBody: CustomRigidBody;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity?: THREE.Vector3;
  comLocal: THREE.Vector3;
  hullDirty?: boolean;
  pendingPhysicsHullRebuild?: boolean;
  detachedIslandsCount?: number;
  getVoxel: (vx: number, vy: number, vz: number) => number;
  setVoxel: (vx: number, vy: number, vz: number, mat: number) => void;
  localVoxelToWorld: (
    vx: number,
    vy: number,
    vz: number,
    out?: THREE.Vector3,
  ) => THREE.Vector3;
  recalculateMassAndCenters?: () => void;
  rebuildVehicleGeometry?: (deferPhysicsHull?: boolean) => void;
  fx?: {
    spawnDebris?: (
      wx: number,
      wy: number,
      wz: number,
      color: number,
      speed?: number,
      scale?: number,
    ) => void;
    voxelsDestroyedCount?: number;
  };
}

/**
 * Returns the 10-neighbor int32 voxel keys that currently exist (not AIR and not already falling off)
 * in the vehicle's voxelMap.
 */
export function getExisting10Neighbors(
  vehicle: Pick<StructuralVehicleTarget, 'getVoxel' | 'fallingOffVoxels'>,
  vx: number,
  vy: number,
  vz: number,
  includeFallingOff = false,
): number[] {
  const neighbors: number[] = [];
  const fallingMap = vehicle.fallingOffVoxels;
  for (let i = 0; i < TEN_NEIGHBOR_OFFSETS.length; i++) {
    const [dx, dy, dz] = TEN_NEIGHBOR_OFFSETS[i];
    const nx = vx + dx;
    const ny = vy + dy;
    const nz = vz + dz;
    const mat = vehicle.getVoxel(nx, ny, nz);
    if (mat !== MAT.AIR) {
      const nKey = packVoxelKey(nx, ny, nz);
      if (!includeFallingOff && fallingMap && fallingMap.has(nKey)) {
        continue;
      }
      neighbors.push(nKey);
    }
  }
  return neighbors;
}

/**
 * Invalidates the vehicle's cached 10-neighbor connectivity graph on any voxel change.
 */
export function invalidateConnectivityCache(
  vehicle: Pick<StructuralVehicleTarget, 'connectivityCache'>,
): void {
  if (vehicle.connectivityCache) {
    if (typeof vehicle.connectivityCache.invalidate === 'function') {
      vehicle.connectivityCache.invalidate();
    } else {
      vehicle.connectivityCache.dirty = true;
      vehicle.connectivityCache.neighborsByKey?.clear();
      vehicle.connectivityCache.coreVoxelKeys?.clear();
    }
  }
}

function isCoreModuleKind(kind: string): boolean {
  return (
    isSeatModuleKind(kind as any) ||
    kind === 'ENGINE_V8' ||
    kind === 'ENGINE_DIESEL' ||
    kind === 'ENGINE_ELECTRIC' ||
    kind === 'ENGINE_TURBO' ||
    kind === 'GYRO'
  );
}

/**
 * Builds or returns the cached 10-neighbor connectivity graph and core voxel set for a vehicle.
 */
export function ensureConnectivityCache(
  vehicle: StructuralVehicleTarget,
): VehicleConnectivityCache {
  let cache = vehicle.connectivityCache;
  if (!cache) {
    cache = createVehicleConnectivityCache();
    vehicle.connectivityCache = cache;
  } else if (typeof cache.invalidate !== 'function') {
    const ref = cache;
    ref.invalidate = () => {
      ref.dirty = true;
      ref.neighborsByKey.clear();
      ref.coreVoxelKeys.clear();
    };
  }

  if (!cache.dirty) {
    return cache;
  }

  cache.neighborsByKey.clear();
  cache.coreVoxelKeys.clear();

  const fallingMap = vehicle.fallingOffVoxels;

  // 1. Collect all active (non-AIR, non-falling-off) voxels and their 10-neighbors
  for (const [rawKey, mat] of vehicle.voxelMap.entries()) {
    if (mat === MAT.AIR) continue;
    const key = normalizeVoxelKey(rawKey);
    if (fallingMap && fallingMap.has(key)) continue;

    const [vx, vy, vz] = unpackVoxelKey(key);
    cache.neighborsByKey.set(key, getExisting10Neighbors(vehicle, vx, vy, vz, false));
  }

  // 2. Identify core voxels from explicit coreVoxelKeys + cockpit/seat/engine modules
  if (vehicle.coreVoxelKeys && vehicle.coreVoxelKeys.size > 0) {
    for (const k of vehicle.coreVoxelKeys) {
      if (cache.neighborsByKey.has(k)) {
        cache.coreVoxelKeys.add(k);
      }
    }
  }

  if (vehicle.modules && vehicle.modules.length > 0) {
    for (let i = 0; i < vehicle.modules.length; i++) {
      const m = vehicle.modules[i];
      if ((m.health ?? 1.0) <= 0 || !isCoreModuleKind(m.kind)) {
        continue;
      }
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const k = packVoxelKey(m.vx + dx, m.vy + dy, m.vz + dz);
            if (cache.neighborsByKey.has(k)) {
              cache.coreVoxelKeys.add(k);
            }
          }
        }
      }
    }
  }

  // 3. Fallback if no module-anchored core voxels exist yet: pick the voxel closest to CoM
  if (cache.coreVoxelKeys.size === 0 && cache.neighborsByKey.size > 0) {
    const comVX = vehicle.comLocal.x / VOXEL_SIZE - 0.5;
    const comVY = vehicle.comLocal.y / VOXEL_SIZE - 0.5;
    const comVZ = vehicle.comLocal.z / VOXEL_SIZE - 0.5;
    let bestKey = -1;
    let bestDistSq = Infinity;
    for (const k of cache.neighborsByKey.keys()) {
      const [vx, vy, vz] = unpackVoxelKey(k);
      const dx = vx - comVX;
      const dy = vy - comVY;
      const dz = vz - comVZ;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestKey = k;
      }
    }
    if (bestKey !== -1) {
      cache.coreVoxelKeys.add(bestKey);
    }
  }

  cache.dirty = false;
  return cache;
}

/**
 * Local 5-voxel radius optimization check:
 * Tests whether all surviving 10-neighbors of `destroyedKey` can mutually reach a core voxel
 * (or all reconnect to each other + at least one boundary voxel outside the 5-voxel radius)
 * within `localCheckRadiusVoxels` (5 voxels).
 */
function canVerifyLocalConnectivity(
  cache: VehicleConnectivityCache,
  startNeighborKeys: number[],
  destroyedKey: number,
  radiusVoxels: number,
): boolean {
  if (startNeighborKeys.length === 0) {
    return true;
  }

  const [dvx, dvy, dvz] = unpackVoxelKey(destroyedKey);
  const radSq = radiusVoxels * radiusVoxels;

  // Check if each neighbor of the destroyed voxel can reach a core voxel within the local radius
  for (let i = 0; i < startNeighborKeys.length; i++) {
    const startKey = startNeighborKeys[i];
    if (!cache.neighborsByKey.has(startKey)) continue;
    if (cache.coreVoxelKeys.has(startKey)) continue;

    const visited = new Set<number>([startKey]);
    const queue: number[] = [startKey];
    let foundCoreInLocalRadius = false;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (cache.coreVoxelKeys.has(curr)) {
        foundCoreInLocalRadius = true;
        break;
      }

      const adj = cache.neighborsByKey.get(curr);
      if (!adj) continue;
      for (let j = 0; j < adj.length; j++) {
        const nxt = adj[j];
        if (visited.has(nxt)) continue;
        const [nx, ny, nz] = unpackVoxelKey(nxt);
        const dx = nx - dvx;
        const dy = ny - dvy;
        const dz = nz - dvz;
        if (dx * dx + dy * dy + dz * dz <= radSq) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }

    if (!foundCoreInLocalRadius) {
      return false;
    }
  }

  return true;
}

/**
 * Trailmakers / Stormworks Build-Mode Disconnection Preview:
 * - Recomputes 10-neighbor connectivity across ALL voxels currently on the vehicle
 * - Clears any stale preview entries so reconnected parts immediately return to normal color
 * - Marks any voxels that cannot reach a core voxel in `fallingOffVoxels` with `isBuildModePreview: true`
 *   so they immediately render with the red `falling_off` tint in Build Mode WITHOUT falling off until exiting Build Mode.
 */
export function previewBuildModeDisconnections(
  vehicle: StructuralVehicleTarget,
): number[] {
  const fallingMap = (vehicle.fallingOffVoxels ??= new Map<
    number,
    FallingOffVoxelEntry
  >());

  // 1. Clear previous build-mode preview entries so re-bridged parts immediately recover
  for (const [key, entry] of Array.from(fallingMap.entries())) {
    if (entry.isBuildModePreview) {
      fallingMap.delete(key);
      if (vehicle.voxelHealthMap) {
        const curHp = vehicle.voxelHealthMap.get(key);
        if (curHp !== undefined && Math.abs(curHp - 0.12) < 1e-4) {
          vehicle.voxelHealthMap.delete(key);
        }
      }
    }
  }

  invalidateConnectivityCache(vehicle);
  const cache = ensureConnectivityCache(vehicle);
  if (cache.neighborsByKey.size <= 1 || cache.coreVoxelKeys.size === 0) {
    return [];
  }

  // 2. Run BFS from all core voxels
  const reachable = new Set<number>();
  const queue: number[] = [];
  for (const coreKey of cache.coreVoxelKeys) {
    if (cache.neighborsByKey.has(coreKey)) {
      reachable.add(coreKey);
      queue.push(coreKey);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const adj = cache.neighborsByKey.get(curr);
    if (!adj) continue;
    for (let i = 0; i < adj.length; i++) {
      const nxt = adj[i];
      if (!reachable.has(nxt) && cache.neighborsByKey.has(nxt)) {
        reachable.add(nxt);
        queue.push(nxt);
      }
    }
  }

  // 3. Mark any unreachable voxel as `isBuildModePreview: true` in `fallingOffVoxels` (red tint)
  const disconnectedKeys: number[] = [];
  const delaySec = PHYSICS_CONFIG.structuralIntegrity.fallOffDelayMinMs * 0.001;

  for (const key of cache.neighborsByKey.keys()) {
    if (!reachable.has(key) && !fallingMap.has(key)) {
      const [vx, vy, vz] = unpackVoxelKey(key);
      const mat = vehicle.getVoxel(vx, vy, vz);
      if (mat === MAT.AIR) continue;

      fallingMap.set(key, {
        voxelKey: key,
        vx,
        vy,
        vz,
        mat,
        remainingSec: delaySec,
        totalDelaySec: delaySec,
        isBuildModePreview: true,
      });

      if (vehicle.voxelHealthMap) {
        vehicle.voxelHealthMap.set(key, 0.12);
      }
      disconnectedKeys.push(key);
    }
  }

  return disconnectedKeys;
}

/**
 * Runs on exiting Build Mode (`setHoverBuildMode(false)`):
 * - Recomputes connectivity from scratch
 * - Immediately detaches all red-tinted disconnected voxels as physics debris!
 */
export function detachDisconnectedVoxelsOnExitBuildMode(
  vehicle: StructuralVehicleTarget,
  debrisSystem?: VoxelDebrisSystem | null,
): number[] {
  previewBuildModeDisconnections(vehicle);
  const fallingMap = vehicle.fallingOffVoxels;
  if (!fallingMap || fallingMap.size === 0) {
    return [];
  }

  for (const entry of fallingMap.values()) {
    entry.remainingSec = 0;
    entry.isBuildModePreview = false;
  }

  return updateFallingOffVoxels(vehicle, 1.0, debrisSystem);
}

/**
 * Step 2.5 & BUG A.2: Runs a single batched 10-neighbor C-Simple structural integrity check
 * after one or more voxels (`destroyedVoxelKeys`) are removed on `vehicle` in the same frame/batch.
 * - Rebuilds the connectivity graph ONCE
 * - If only 1 voxel was destroyed, tries the fast 5-voxel local radius check first
 * - Otherwise (or if local check fails), runs a SINGLE BFS from all core voxels across the vehicle
 * - Any voxel that cannot reach a core is scheduled to fall off after 100-200ms (marked `falling_off` and tinted red)
 */
export function checkStructuralIntegrityAfterDestructionBatch(
  vehicle: StructuralVehicleTarget,
  destroyedVoxelKeys: readonly number[],
  impactOrigin?: THREE.Vector3,
  deferGeometryRebuild = false,
): number[] {
  if (vehicle.inBuildMode) {
    const disconnected = previewBuildModeDisconnections(vehicle);
    if (disconnected.length > 0) {
      vehicle.hullDirty = true;
      if (!deferGeometryRebuild && vehicle.rebuildVehicleGeometry) {
        vehicle.rebuildVehicleGeometry(true);
      }
    }
    return disconnected;
  }

  invalidateConnectivityCache(vehicle);
  const cache = ensureConnectivityCache(vehicle);
  if (cache.neighborsByKey.size === 0 || cache.coreVoxelKeys.size === 0) {
    return [];
  }

  let dvx = 0;
  let dvy = 0;
  let dvz = 0;

  if (destroyedVoxelKeys.length > 0) {
    const firstKey = destroyedVoxelKeys[0];
    [dvx, dvy, dvz] = unpackVoxelKey(firstKey);

    // Fast path when only 1 voxel broke: try local 5-voxel radius connectivity check first
    if (destroyedVoxelKeys.length === 1) {
      const destroyedNeighbors = getExisting10Neighbors(
        vehicle,
        dvx,
        dvy,
        dvz,
        false,
      );
      if (destroyedNeighbors.length === 0) {
        return [];
      }
      const localRadius = PHYSICS_CONFIG.structuralIntegrity.localCheckRadiusVoxels;
      if (
        canVerifyLocalConnectivity(
          cache,
          destroyedNeighbors,
          firstKey,
          localRadius,
        )
      ) {
        return [];
      }
    } else {
      // Check if any destroyed voxel actually had surviving neighbors before running full BFS
      let anyNeighbor = false;
      for (let i = 0; i < destroyedVoxelKeys.length; i++) {
        const [bx, by, bz] = unpackVoxelKey(destroyedVoxelKeys[i]);
        if (getExisting10Neighbors(vehicle, bx, by, bz, false).length > 0) {
          anyNeighbor = true;
          break;
        }
      }
      if (!anyNeighbor) {
        return [];
      }
    }
  }

  // Expand a SINGLE BFS from all core voxels to find all core-connected voxels
  const reachable = new Set<number>();
  const queue: number[] = [];

  for (const coreKey of cache.coreVoxelKeys) {
    if (cache.neighborsByKey.has(coreKey)) {
      reachable.add(coreKey);
      queue.push(coreKey);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const adj = cache.neighborsByKey.get(curr);
    if (!adj) continue;
    for (let i = 0; i < adj.length; i++) {
      const nxt = adj[i];
      if (!reachable.has(nxt) && cache.neighborsByKey.has(nxt)) {
        reachable.add(nxt);
        queue.push(nxt);
      }
    }
  }

  // Any active voxel not in `reachable` is structurally disconnected -> schedule to fall off in 100-200ms
  const newlyDisconnected: number[] = [];
  const fallingMap = (vehicle.fallingOffVoxels ??= new Map<
    number,
    FallingOffVoxelEntry
  >());
  const minMs = PHYSICS_CONFIG.structuralIntegrity.fallOffDelayMinMs;
  const maxMs = PHYSICS_CONFIG.structuralIntegrity.fallOffDelayMaxMs;

  for (const key of cache.neighborsByKey.keys()) {
    if (!reachable.has(key) && !fallingMap.has(key)) {
      const [vx, vy, vz] = unpackVoxelKey(key);
      const mat = vehicle.getVoxel(vx, vy, vz);
      if (mat === MAT.AIR) continue;

      // Cascade delay slightly outward from the destroyed voxel so collapse ripples naturally within 100-200ms
      const distFromBreak = Math.hypot(vx - dvx, vy - dvy, vz - dvz);
      const delayMs = Math.min(
        maxMs,
        minMs + Math.min(1.0, distFromBreak * 0.12) * (maxMs - minMs),
      );
      const delaySec = delayMs * 0.001;

      fallingMap.set(key, {
        voxelKey: key,
        vx,
        vy,
        vz,
        mat,
        remainingSec: delaySec,
        totalDelaySec: delaySec,
        impactOrigin: impactOrigin ? impactOrigin.clone() : undefined,
      });

      // Tint red / mark critical health during the 100-200ms falling_off delay
      if (vehicle.voxelHealthMap) {
        vehicle.voxelHealthMap.set(key, 0.12);
      }
      newlyDisconnected.push(key);
    }
  }

  if (newlyDisconnected.length > 0) {
    vehicle.hullDirty = true;
    invalidateConnectivityCache(vehicle);
    if (!deferGeometryRebuild && vehicle.rebuildVehicleGeometry) {
      vehicle.rebuildVehicleGeometry(true);
    }
  }

  return newlyDisconnected;
}

/**
 * Step 2.5: Runs the 10-neighbor C-Simple structural integrity check after `destroyedVoxelKey` is removed.
 */
export function checkStructuralIntegrityAfterDestruction(
  vehicle: StructuralVehicleTarget,
  destroyedVoxelKey: number,
  impactOrigin?: THREE.Vector3,
): number[] {
  return checkStructuralIntegrityAfterDestructionBatch(
    vehicle,
    [destroyedVoxelKey],
    impactOrigin,
    false,
  );
}

const _wpTmp = new THREE.Vector3();

/**
 * Advances timers for all voxels marked `falling_off`.
 * Once the 100-200ms delay expires, converts the voxel to a free debris particle,
 * removes it from `voxelMap` and `collisionPoints`, and runs a SINGLE batched structural check
 * + SINGLE mass recalculation at the end of the frame (BUG A.2 & BUG A.3).
 */
export function updateFallingOffVoxels(
  vehicle: StructuralVehicleTarget,
  dt: number,
  debrisSystem?: VoxelDebrisSystem | null,
): number[] {
  if (vehicle.inBuildMode) {
    return [];
  }

  const fallingMap = vehicle.fallingOffVoxels;
  if (!fallingMap || fallingMap.size === 0 || dt <= 0) {
    return [];
  }

  const detachedNow: number[] = [];
  let lastDetachedOrigin: THREE.Vector3 | undefined;

  for (const [key, entry] of Array.from(fallingMap.entries())) {
    entry.remainingSec -= dt;
    if (entry.remainingSec <= 0) {
      fallingMap.delete(key);
      const currentMat = vehicle.getVoxel(entry.vx, entry.vy, entry.vz);
      if (currentMat !== MAT.AIR) {
        vehicle.localVoxelToWorld(entry.vx, entry.vy, entry.vz, _wpTmp);
        const colorHex =
          MAT_INFO[currentMat]?.color ??
          PHYSICS_CONFIG.structuralIntegrity.fallOffTintHex;

        if (debrisSystem) {
          debrisSystem.spawnDebrisVoxel(
            _wpTmp,
            vehicle.velocity,
            entry.impactOrigin || vehicle.position,
            colorHex,
            currentMat,
          );
        }
        if (vehicle.fx?.spawnDebris) {
          vehicle.fx.spawnDebris(_wpTmp.x, _wpTmp.y, _wpTmp.z, colorHex, 6.5, 1.0);
        }
        if (vehicle.fx && typeof vehicle.fx.voxelsDestroyedCount === 'number') {
          vehicle.fx.voxelsDestroyedCount++;
        }

        vehicle.setVoxel(entry.vx, entry.vy, entry.vz, MAT.AIR);
        vehicle.rigidBody.removeCollisionPointByKey(key);
        detachedNow.push(key);
        lastDetachedOrigin = entry.impactOrigin;
      }
    }
  }

  if (detachedNow.length > 0) {
    vehicle.detachedIslandsCount = (vehicle.detachedIslandsCount || 0) + 1;
    vehicle.rigidBody.wake();
    invalidateConnectivityCache(vehicle);

    // BUG A.2: Run a SINGLE batched BFS connectivity check across all voxels detached this frame
    checkStructuralIntegrityAfterDestructionBatch(
      vehicle,
      detachedNow,
      lastDetachedOrigin,
      true,
    );

    // BUG A.3: Run mass recalculation and geometry rebuild ONCE at the end of the batch
    if (vehicle.recalculateMassAndCenters) {
      vehicle.recalculateMassAndCenters();
    }
    if (vehicle.rebuildVehicleGeometry) {
      vehicle.rebuildVehicleGeometry(true);
    }
  }

  return detachedNow;
}
