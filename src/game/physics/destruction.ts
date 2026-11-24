import * as THREE from 'three';
import { MAT, MAT_INFO } from '../constants.ts';
import { SoundFX } from '../sound.ts';
import {
  MaterialType,
  PHYSICS_CONFIG,
  mapVoxelMatToMaterialType,
} from './physicsConfig.ts';
import {
  packVoxelKey,
  unpackVoxelKey,
  normalizeVoxelKey,
} from './collisionPoints.ts';
import {
  getExisting10Neighbors,
  checkStructuralIntegrityAfterDestruction,
  checkStructuralIntegrityAfterDestructionBatch,
  invalidateConnectivityCache,
  type StructuralVehicleTarget,
} from './structuralIntegrity.ts';
import type { VoxelDebrisSystem } from './debris.ts';

export interface VoxelHpRecord {
  hp: number;
  maxHp: number;
  materialType: MaterialType;
  voxelKey: number;
  neighbors: number[];
}

export interface DestructibleVehicle extends StructuralVehicleTarget {
  voxelDestructionMap?: Map<number, VoxelHpRecord>;
  isLocalPlayerOccupied?: boolean;
  fx?: {
    trauma?: number;
    voxelsDestroyedCount?: number;
    spawnDebris?: (
      wx: number,
      wy: number,
      wz: number,
      color: number,
      speed?: number,
      scale?: number,
    ) => void;
  };
}

interface PendingVehicleDestructionBatch {
  destroyedKeys: number[];
  damagedBelow50: boolean;
  lastImpactOrigin?: THREE.Vector3;
}

let _destructionBatchDepth = 0;
const _pendingBatchByVehicle = new Map<
  DestructibleVehicle,
  PendingVehicleDestructionBatch
>();

/**
 * BUG A.2 & BUG A.3: Begins a frame/step destruction batch.
 * While a batch is active, `destroyVoxel()` and `applyDamageToVoxel()` immediately remove
 * voxels from `voxelMap`, remove collision points, and spawn debris, but defer
 * `recalculateMassAndCenters()`, `checkStructuralIntegrityAfterDestructionBatch()`, and
 * `rebuildVehicleGeometry(true)` until `flushDestructionBatch()` is called once at the end of the frame/step.
 */
export function beginDestructionBatch(): void {
  _destructionBatchDepth++;
}

export function isDestructionBatchActive(): boolean {
  return _destructionBatchDepth > 0;
}

export function markVehicleHullDirtyInBatch(vehicle: DestructibleVehicle): void {
  vehicle.hullDirty = true;
  if (_destructionBatchDepth > 0) {
    let entry = _pendingBatchByVehicle.get(vehicle);
    if (!entry) {
      entry = { destroyedKeys: [], damagedBelow50: true };
      _pendingBatchByVehicle.set(vehicle, entry);
    } else {
      entry.damagedBelow50 = true;
    }
  } else if (vehicle.rebuildVehicleGeometry) {
    vehicle.rebuildVehicleGeometry(true);
  }
}

/**
 * BUG A.2 & BUG A.3: Flushes all deferred structural integrity BFS checks, mass recalculations,
 * and geometry rebuilds ONCE per affected vehicle.
 */
export function flushDestructionBatch(): {
  vehiclesUpdated: number;
  totalCascadingScheduledKeys: number[];
} {
  if (_destructionBatchDepth > 0) {
    _destructionBatchDepth--;
  }
  if (_destructionBatchDepth > 0 || _pendingBatchByVehicle.size === 0) {
    return { vehiclesUpdated: 0, totalCascadingScheduledKeys: [] };
  }

  let vehiclesUpdated = 0;
  const totalCascadingScheduledKeys: number[] = [];

  for (const [vehicle, batch] of _pendingBatchByVehicle.entries()) {
    vehiclesUpdated++;
    if (batch.destroyedKeys.length > 0) {
      // 1. Run 10-neighbor BFS connectivity check ONCE for all voxels destroyed on this vehicle this frame
      const cascading = checkStructuralIntegrityAfterDestructionBatch(
        vehicle,
        batch.destroyedKeys,
        batch.lastImpactOrigin,
        true,
      );
      for (let i = 0; i < cascading.length; i++) {
        totalCascadingScheduledKeys.push(cascading[i]);
      }

      // 2. Recompute mass, center of mass, and inertia ONCE for this vehicle
      if (vehicle.recalculateMassAndCenters) {
        vehicle.recalculateMassAndCenters();
      }

      // 3. Rebuild vehicle geometry ONCE for this vehicle
      vehicle.hullDirty = true;
      if (vehicle.rebuildVehicleGeometry) {
        vehicle.rebuildVehicleGeometry(true);
      }

      // 4. Play impact sound once for the batch
      SoundFX.clank();
    } else if (batch.damagedBelow50) {
      vehicle.hullDirty = true;
      if (vehicle.rebuildVehicleGeometry) {
        vehicle.rebuildVehicleGeometry(true);
      }
    }
  }

  _pendingBatchByVehicle.clear();
  return { vehiclesUpdated, totalCascadingScheduledKeys };
}

/**
 * Returns default initial HP for a given raw voxel material ID.
 * High-HP structural blocks (ARMOR_SLATE, STEEL, CONCRETE, ROCK) have 180 HP so they survive
 * a single 80-damage C4 blast, whereas standard voxels (75 HP) and crunchy voxels (55 HP) are destroyed in one hit.
 */
export function getInitialVoxelHp(rawMat: number): number {
  const cleanMat = rawMat & 63;
  if (
    cleanMat === MAT.ARMOR_SLATE ||
    cleanMat === MAT.STEEL ||
    cleanMat === MAT.CONCRETE ||
    cleanMat === MAT.ROCK
  ) {
    return PHYSICS_CONFIG.destruction.armorVoxelHp;
  }
  const matType = mapVoxelMatToMaterialType(cleanMat);
  if (matType === MaterialType.CRUNCHY) {
    return PHYSICS_CONFIG.destruction.crunchyVoxelHp;
  }
  return PHYSICS_CONFIG.destruction.defaultVoxelHp;
}

/**
 * Ensures the vehicle's `voxelDestructionMap` contains an up-to-date `VoxelHpRecord`
 * (with `hp`, `materialType`, `voxelKey`, and 10-connectivity `neighbors`) for `voxelKey`.
 */
export function getOrCreateVoxelHpRecord(
  vehicle: DestructibleVehicle,
  voxelKey: number,
): VoxelHpRecord | null {
  const [vx, vy, vz] = unpackVoxelKey(voxelKey);
  const rawMat = vehicle.getVoxel(vx, vy, vz);
  if (rawMat === MAT.AIR) {
    return null;
  }

  const map = (vehicle.voxelDestructionMap ??= new Map<number, VoxelHpRecord>());
  let rec = map.get(voxelKey);
  if (!rec) {
    const maxHp = getInitialVoxelHp(rawMat);
    const existingNormHp =
      vehicle.voxelHealthMap?.get(voxelKey) ??
      vehicle.voxelHealthMap?.get(`${vx},${vy},${vz}`) ??
      1.0;
    rec = {
      hp: Math.max(1, Math.min(maxHp, existingNormHp * maxHp)),
      maxHp,
      materialType: mapVoxelMatToMaterialType(rawMat),
      voxelKey,
      neighbors: getExisting10Neighbors(vehicle, vx, vy, vz, false),
    };
    map.set(voxelKey, rec);
  }
  return rec;
}

/**
 * Step 2.4: Computes voxel damage from collision impact:
 * - Scales with impulse magnitude (j_n)
 * - Material multiplier: crunchy takes 1.5x, bouncy takes 0.5x, default 1.0x
 * - Impact direction: head-on (aligned with vehicle forward) does 1.2x, glancing (perpendicular) does 0.7x
 */
export function computeCollisionVoxelDamage(
  impulseMagnitude: number,
  targetMaterial: MaterialType,
  impactDirectionWorld: THREE.Vector3,
  vehicleForwardWorld: THREE.Vector3,
  attackerMaterial: MaterialType = MaterialType.DEFAULT,
): number {
  const cfg = PHYSICS_CONFIG.collisionResponse;
  if (
    impulseMagnitude < cfg.minDamageImpulseThreshold &&
    attackerMaterial !== MaterialType.CRUNCHY &&
    targetMaterial !== MaterialType.CRUNCHY
  ) {
    return 0;
  }

  let matMult = cfg.defaultDamageMultiplier;
  if (targetMaterial === MaterialType.CRUNCHY) {
    matMult = cfg.crunchyDamageMultiplier;
  } else if (targetMaterial === MaterialType.BOUNCY) {
    matMult = cfg.bouncyDamageMultiplier;
  }

  if (attackerMaterial === MaterialType.CRUNCHY) {
    matMult *= 1.35;
  }

  // Alignment between impact direction and vehicle's forward axis: 1 = head-on, 0 = glancing
  const align = Math.min(
    1.0,
    Math.abs(impactDirectionWorld.dot(vehicleForwardWorld)),
  );
  const dirMult =
    cfg.glancingDamageMultiplier +
    align * (cfg.headOnDamageMultiplier - cfg.glancingDamageMultiplier);

  const rawDamage = impulseMagnitude * cfg.damagePerImpulse * matMult * dirMult;
  return Math.max(0, rawDamage);
}

const _worldVoxelPos = new THREE.Vector3();

/**
 * Step 2.4: Destroys a single voxel on `vehicle` at `voxelKey`:
 * 1. Spawns debris particle (cube with voxel's color, free-falling rigid body with vehicle velocity + outward impulse)
 * 2. Removes voxel from vehicle's voxelMap (sets to AIR)
 * 3. Removes any collision point in vehicle.rigidBody.collisionPoints whose voxelKey === destroyed voxel's key
 * 4. Recomputes vehicle mass and inertia (or defers to end-of-frame batch when batching is active — BUG A.3)
 * 5. Triggers 10-neighbor structural integrity check (or defers to end-of-frame batch when batching is active — BUG A.2)
 * 6. Wakes the vehicle if it was sleeping
 * 7. Spawns impact sound
 * 8. Applies brief 0.1s small screen shake if player-occupied
 */
export function destroyVoxel(
  vehicle: DestructibleVehicle,
  voxelKey: number,
  impactOriginWorld?: THREE.Vector3,
  debrisSystem?: VoxelDebrisSystem | null,
  deferBatch = false,
  customSpeedRange?: { minMPS: number; maxMPS: number },
): { destroyed: boolean; cascadingScheduledKeys: number[] } {
  const normKey = normalizeVoxelKey(voxelKey);
  const [vx, vy, vz] = unpackVoxelKey(normKey);
  const rawMat = vehicle.getVoxel(vx, vy, vz);
  if (rawMat === MAT.AIR) {
    return { destroyed: false, cascadingScheduledKeys: [] };
  }

  // 1. Spawn debris particle with the voxel's color and initial velocity from vehicle + outward impulse
  vehicle.localVoxelToWorld(vx, vy, vz, _worldVoxelPos);
  const cleanMat = rawMat & 63;
  const colorHex = MAT_INFO[cleanMat]?.color ?? 0x38bdf8;

  if (debrisSystem) {
    debrisSystem.spawnDebrisVoxel(
      _worldVoxelPos,
      vehicle.velocity,
      impactOriginWorld || vehicle.position,
      colorHex,
      cleanMat,
      customSpeedRange,
    );
  }
  if (vehicle.fx?.spawnDebris) {
    const fxSpeed = customSpeedRange
      ? customSpeedRange.minMPS +
        Math.random() * (customSpeedRange.maxMPS - customSpeedRange.minMPS)
      : 7.5;
    vehicle.fx.spawnDebris(
      _worldVoxelPos.x,
      _worldVoxelPos.y,
      _worldVoxelPos.z,
      colorHex,
      fxSpeed,
      1.1,
    );
  }
  if (vehicle.fx && typeof vehicle.fx.voxelsDestroyedCount === 'number') {
    vehicle.fx.voxelsDestroyedCount++;
  }

  // 2. Remove voxel from vehicle's voxelMap (set to AIR) and clear HP records
  vehicle.setVoxel(vx, vy, vz, MAT.AIR);
  vehicle.voxelDestructionMap?.delete(normKey);
  vehicle.voxelHealthMap?.delete(normKey);
  vehicle.fallingOffVoxels?.delete(normKey);
  (vehicle as { ignitedC4Voxels?: Map<number, number> }).ignitedC4Voxels?.delete(
    normKey,
  );

  // 3. Remove any collision point in vehicle.collisionPoints whose voxelKey === destroyed voxel's key
  vehicle.rigidBody.removeCollisionPointByKey(normKey);

  // 6. Wake the vehicle if it was sleeping
  vehicle.rigidBody.wake();

  // 8. Brief screen shake for player-occupied vehicle (0.1 second, small magnitude)
  if (vehicle.isLocalPlayerOccupied && vehicle.fx) {
    vehicle.fx.trauma = Math.min(
      0.45,
      (vehicle.fx.trauma || 0) + PHYSICS_CONFIG.destruction.screenShakeMagnitude,
    );
  }

  // BUG A.2 & BUG A.3: If inside a destruction batch, record this vehicle and defer BFS + mass recalculation to end of batch!
  if (_destructionBatchDepth > 0 || deferBatch) {
    let entry = _pendingBatchByVehicle.get(vehicle);
    if (!entry) {
      entry = { destroyedKeys: [], damagedBelow50: false };
      _pendingBatchByVehicle.set(vehicle, entry);
    }
    entry.destroyedKeys.push(normKey);
    (entry.lastImpactOrigin ??= new THREE.Vector3()).copy(
      impactOriginWorld || _worldVoxelPos,
    );
    invalidateConnectivityCache(vehicle);
    return {
      destroyed: true,
      cascadingScheduledKeys: [],
    };
  }

  // 4. Recompute vehicle mass and inertia (calls syncMassProperties on rigidBody)
  if (vehicle.recalculateMassAndCenters) {
    vehicle.recalculateMassAndCenters();
  }
  if (vehicle.rebuildVehicleGeometry) {
    vehicle.rebuildVehicleGeometry(true);
  }

  // 5. Trigger 10-neighbor structural integrity check (Step 2.5)
  const cascadingScheduledKeys = checkStructuralIntegrityAfterDestruction(
    vehicle,
    normKey,
    impactOriginWorld || _worldVoxelPos,
  );

  // 7. Spawn impact sound
  SoundFX.clank();

  return {
    destroyed: true,
    cascadingScheduledKeys,
  };
}

/**
 * Applies `damage` to the voxel at `voxelKey`.
 * - If the voxel is `MAT.C4_EXPLOSIVE`, hitting it ignites its 200ms C4 fuse instead of destroying it immediately.
 * - Otherwise, if its HP drops to <= 0, calls `destroyVoxel()`.
 */
export function applyDamageToVoxel(
  vehicle: DestructibleVehicle,
  voxelKey: number,
  damage: number,
  impactOriginWorld?: THREE.Vector3,
  debrisSystem?: VoxelDebrisSystem | null,
  deferBatch = false,
  customSpeedRange?: { minMPS: number; maxMPS: number },
): {
  remainingHp: number;
  destroyed: boolean;
  cascadingScheduledKeys: number[];
} {
  const normKey = normalizeVoxelKey(voxelKey);
  const [vx, vy, vz] = unpackVoxelKey(normKey);
  const rawMat = vehicle.getVoxel(vx, vy, vz);
  if (rawMat === MAT.AIR) {
    return { remainingHp: 0, destroyed: false, cascadingScheduledKeys: [] };
  }

  // When a C4 voxel is hit by meaningful damage (bullet, collision impact >= ~20 N*s, or explosion), ignite its 200ms fuse!
  if ((rawMat & 63) === MAT.C4_EXPLOSIVE && damage >= 1.2) {
    const c4Veh = vehicle as DestructibleVehicle & {
      inBuildMode?: boolean;
      ignitedC4Voxels?: Map<number, number>;
    };
    if (!c4Veh.inBuildMode) {
      const ignitedMap = (c4Veh.ignitedC4Voxels ??= new Map<number, number>());
      if (!ignitedMap.has(normKey)) {
        const nowMs =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        ignitedMap.set(normKey, nowMs);
        if (_destructionBatchDepth > 0 || deferBatch) {
          markVehicleHullDirtyInBatch(vehicle);
        } else {
          vehicle.hullDirty = true;
          if (vehicle.rebuildVehicleGeometry) {
            vehicle.rebuildVehicleGeometry(true);
          }
        }
        vehicle.rigidBody?.wake();
        vehicle.localVoxelToWorld(vx, vy, vz, _worldVoxelPos);
        if (vehicle.fx?.spawnDebris) {
          vehicle.fx.spawnDebris(
            _worldVoxelPos.x,
            _worldVoxelPos.y,
            _worldVoxelPos.z,
            0xfef08a,
            4.5,
            0.55,
          );
        }
        SoundFX.fuse();
      }
      return {
        remainingHp: PHYSICS_CONFIG.destruction.crunchyVoxelHp,
        destroyed: false,
        cascadingScheduledKeys: [],
      };
    }
  }

  const rec = getOrCreateVoxelHpRecord(vehicle, normKey);
  if (!rec) {
    return { remainingHp: 0, destroyed: false, cascadingScheduledKeys: [] };
  }

  if (damage <= 0) {
    return {
      remainingHp: rec.hp,
      destroyed: false,
      cascadingScheduledKeys: [],
    };
  }

  rec.hp = Math.max(0, rec.hp - damage);
  const normRatio = rec.hp / Math.max(1, rec.maxHp);

  if (vehicle.voxelHealthMap) {
    vehicle.voxelHealthMap.set(normKey, normRatio);
  }

  if (rec.hp <= 0) {
    const res = destroyVoxel(
      vehicle,
      normKey,
      impactOriginWorld,
      debrisSystem,
      deferBatch,
      customSpeedRange,
    );
    return {
      remainingHp: 0,
      destroyed: res.destroyed,
      cascadingScheduledKeys: res.cascadingScheduledKeys,
    };
  }

  // If health crossed below 50%, mark hull dirty so charred darkening updates
  if (normRatio < 0.5) {
    vehicle.hullDirty = true;
    if (_destructionBatchDepth > 0 || deferBatch) {
      let entry = _pendingBatchByVehicle.get(vehicle);
      if (!entry) {
        entry = { destroyedKeys: [], damagedBelow50: true };
        _pendingBatchByVehicle.set(vehicle, entry);
      } else {
        entry.damagedBelow50 = true;
      }
    } else if (vehicle.rebuildVehicleGeometry) {
      vehicle.rebuildVehicleGeometry(true);
    }
  }
  invalidateConnectivityCache(vehicle);

  return {
    remainingHp: rec.hp,
    destroyed: false,
    cascadingScheduledKeys: [],
  };
}

