import * as THREE from 'three';
import { MAT, VOXEL_SIZE } from '../constants.ts';
import { SoundFX } from '../sound.ts';
import { PHYSICS_CONFIG } from './physicsConfig.ts';
import {
  packVoxelKey,
  unpackVoxelKey,
  normalizeVoxelKey,
} from './collisionPoints.ts';
import {
  beginDestructionBatch,
  flushDestructionBatch,
  isDestructionBatchActive,
  markVehicleHullDirtyInBatch,
  destroyVoxel,
  applyDamageToVoxel,
  type DestructibleVehicle,
} from './destruction.ts';
import type { VoxelDebrisSystem } from './debris.ts';

/**
 * Custom vertex color code returned by `sampleCell` in `vehicle.ts` when rendering
 * an ignited C4 voxel (`0x40000000 | 0xff1111`), tinting the voxel bright glowing red
 * without altering the underlying `MAT.C4_EXPLOSIVE` value in `voxelMap`.
 */
export const IGNITED_C4_RENDER_COLOR_CODE = 0x40ff1111;

export interface C4VehicleTarget extends DestructibleVehicle {
  networkId?: string;
  inBuildMode?: boolean;
  ignitedC4Voxels?: Map<number, number>;
  angularVelocity?: THREE.Vector3;
  worldToLocalMetric?: (
    wx: number,
    wy: number,
    wz: number,
    out?: THREE.Vector3,
  ) => THREE.Vector3;
}

export interface C4ExplosionEvent {
  vehicle: C4VehicleTarget;
  vehicleId: string;
  voxelKey: number;
  vx: number;
  vy: number;
  vz: number;
  worldPos: THREE.Vector3;
  chainedC4Keys: Array<{ vehicle: C4VehicleTarget; voxelKey: number }>;
  destroyedVoxelKeys: Array<{ vehicle: C4VehicleTarget; voxelKey: number }>;
  damagedVoxels: Array<{
    vehicle: C4VehicleTarget;
    voxelKey: number;
    damage: number;
    destroyed: boolean;
  }>;
  pushedOtherVehicles: Array<{
    vehicle: C4VehicleTarget;
    closestPointWorld: THREE.Vector3;
    distanceVoxels: number;
    impulseMagnitude: number;
  }>;
  fxParticlesSpawned: number;
  screenShakeTriggered: boolean;
  screenShakeDurationSec: number;
}

const _c4WorldPos = new THREE.Vector3();
const _targetWorldPos = new THREE.Vector3();
const _impulseDir = new THREE.Vector3();
const _impulseVec = new THREE.Vector3();
const _closestPtWorld = new THREE.Vector3();
const _localMetric = new THREE.Vector3();
const _zeroParentVel = new THREE.Vector3(0, 0, 0);

const C4_FX_COLORS = [0xf97316, 0xef4444, 0xdc2626, 0xfb923c] as const;

/**
 * Returns (and initializes if needed) the per-vehicle `Map<int32 voxelKey, igniteTimeMs>`
 * tracking ignited C4 voxels on `vehicle`.
 */
export function getVehicleIgnitedC4Map(
  vehicle: C4VehicleTarget,
): Map<number, number> {
  if (!vehicle.ignitedC4Voxels) {
    vehicle.ignitedC4Voxels = new Map<number, number>();
  }
  return vehicle.ignitedC4Voxels;
}

/**
 * Returns true if the voxel at `voxelKey` (or `(vx, vy, vz)`) on `vehicle` is currently
 * in the ignited C4 state (waiting out its 200ms fuse before exploding).
 */
export function isC4VoxelIgnited(
  vehicle: C4VehicleTarget,
  voxelKey: number,
): boolean {
  const normKey = normalizeVoxelKey(voxelKey);
  return Boolean(vehicle.ignitedC4Voxels?.has(normKey));
}

/**
 * Step 3: Ignites a C4 voxel at `voxelKey` on `vehicle`:
 * - Sets `igniteTimeMs = nowMs` (default `performance.now()`) in `vehicle.ignitedC4Voxels`
 * - Tints the C4 voxel red during rendering (via `vehicle.ignitedC4Voxels`, without modifying `voxelMap` data)
 * - Spawns small spark particles at the C4 world position
 * - Plays a "fuse" sound (`SoundFX.fuse()`)
 */
export function igniteC4Voxel(
  vehicle: C4VehicleTarget,
  voxelKey: number,
  nowMs: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
): boolean {
  if (vehicle.inBuildMode) return false;
  const normKey = normalizeVoxelKey(voxelKey);
  const [vx, vy, vz] = unpackVoxelKey(normKey);
  const rawMat = vehicle.getVoxel(vx, vy, vz);
  if ((rawMat & 63) !== MAT.C4_EXPLOSIVE) {
    return false;
  }

  const ignitedMap = getVehicleIgnitedC4Map(vehicle);
  if (ignitedMap.has(normKey)) {
    return false;
  }

  ignitedMap.set(normKey, nowMs);
  if (isDestructionBatchActive()) {
    markVehicleHullDirtyInBatch(vehicle);
  } else {
    vehicle.hullDirty = true;
    if (vehicle.rebuildVehicleGeometry) {
      vehicle.rebuildVehicleGeometry(true);
    }
  }
  vehicle.rigidBody?.wake();

  vehicle.localVoxelToWorld(vx, vy, vz, _c4WorldPos);

  // Spawn small spark particles on ignition
  const fxAny = vehicle.fx as
    | {
        spawnWeldSparks?: (wx: number, wy: number, wz: number) => void;
        spawnDebris?: (
          wx: number,
          wy: number,
          wz: number,
          color: number,
          speed?: number,
          scale?: number,
        ) => void;
      }
    | undefined;
  if (fxAny?.spawnWeldSparks) {
    fxAny.spawnWeldSparks(_c4WorldPos.x, _c4WorldPos.y, _c4WorldPos.z);
  } else if (fxAny?.spawnDebris) {
    for (let i = 0; i < 3; i++) {
      fxAny.spawnDebris(
        _c4WorldPos.x,
        _c4WorldPos.y,
        _c4WorldPos.z,
        0xfef08a,
        4.5,
        0.55,
      );
    }
  }

  // Play fuse sound
  SoundFX.fuse();

  return true;
}

/**
 * Finds the closest occupied voxel (or collision point / center of mass fallback) on `otherVehicle`
 * to `explosionWorldPos` and writes its world coordinates into `outClosestWorld`.
 * Returns the Euclidean distance in meters between `explosionWorldPos` and `outClosestWorld`.
 */
export function findClosestPointOnVehicleToWorldPos(
  otherVehicle: C4VehicleTarget,
  explosionWorldPos: THREE.Vector3,
  outClosestWorld: THREE.Vector3,
): number {
  let bestDistSq = Infinity;
  let foundAny = false;

  if (otherVehicle.voxelMap && otherVehicle.voxelMap.size > 0) {
    for (const [k, rawMat] of otherVehicle.voxelMap.entries()) {
      if ((rawMat & 63) === MAT.AIR) continue;
      let vx: number, vy: number, vz: number;
      if (typeof k === 'number') {
        [vx, vy, vz] = unpackVoxelKey(k);
      } else {
        const parts = String(k).split(',');
        vx = Number(parts[0]);
        vy = Number(parts[1]);
        vz = Number(parts[2]);
      }
      otherVehicle.localVoxelToWorld(vx, vy, vz, _targetWorldPos);
      const dSq = _targetWorldPos.distanceToSquared(explosionWorldPos);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        outClosestWorld.copy(_targetWorldPos);
        foundAny = true;
      }
    }
  }

  if (!foundAny && otherVehicle.rigidBody?.collisionPoints?.length) {
    for (let i = 0; i < otherVehicle.rigidBody.collisionPoints.length; i++) {
      const pt = otherVehicle.rigidBody.collisionPoints[i];
      _targetWorldPos
        .copy(pt.localPos)
        .applyQuaternion(otherVehicle.rigidBody.quaternion)
        .add(otherVehicle.rigidBody.position);
      const dSq = _targetWorldPos.distanceToSquared(explosionWorldPos);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        outClosestWorld.copy(_targetWorldPos);
        foundAny = true;
      }
    }
  }

  if (!foundAny) {
    outClosestWorld.copy(
      otherVehicle.rigidBody ? otherVehicle.rigidBody.position : otherVehicle.position,
    );
    bestDistSq = outClosestWorld.distanceToSquared(explosionWorldPos);
  }

  return Math.sqrt(bestDistSq);
}

/**
 * Converts a world-space point into local voxel coordinates `(vx, vy, vz)` on `vehicle`.
 */
function worldPosToVehicleLocalVoxel(
  vehicle: C4VehicleTarget,
  worldPos: THREE.Vector3,
): [number, number, number] {
  if (typeof vehicle.worldToLocalMetric === 'function') {
    vehicle.worldToLocalMetric(
      worldPos.x,
      worldPos.y,
      worldPos.z,
      _localMetric,
    );
    return [
      Math.floor(_localMetric.x / VOXEL_SIZE),
      Math.floor(_localMetric.y / VOXEL_SIZE),
      Math.floor(_localMetric.z / VOXEL_SIZE),
    ];
  }
  // Fallback for lightweight unit-test vehicle mocks where localVoxelToWorld is position + v * VOXEL_SIZE
  _localMetric.subVectors(worldPos, vehicle.position);
  if (vehicle.rigidBody?.quaternion) {
    const invQ = vehicle.rigidBody.quaternion.clone().invert();
    _localMetric.applyQuaternion(invQ);
  }
  if (vehicle.comLocal) {
    _localMetric.add(vehicle.comLocal);
  }
  return [
    Math.round(_localMetric.x / VOXEL_SIZE),
    Math.round(_localMetric.y / VOXEL_SIZE),
    Math.round(_localMetric.z / VOXEL_SIZE),
  ];
}

/**
 * Step 4, 5 & 6: Detonates a single C4 voxel at `voxelKey` on `vehicle`:
 * 1. Destroys the C4 voxel (`destroyVoxel`) with C4 debris speed (10-30 m/s)
 * 2. Scans all voxels within `c4ExplosionRadius` (2.5 voxels) of the C4:
 *    - If voxel is C4 and `c4ChainToAdjacentC4` is true: ignites it (`igniteC4Voxel`), creating chain reactions
 *    - Else: applies `damage = c4DamageInRadius` (80) with C4 debris velocity (10-30 m/s)
 * 3. Applies upward-biased outward explosion impulse (`c4VehicleImpulse = 5000 N·s`) to the host vehicle body
 * 4. For all OTHER vehicles within `c4OtherVehicleRadius` (5 voxels):
 *    - Applies impulse at the closest point on the other vehicle, away from explosion, with `1/dist²` falloff
 *    - Also damages or chain-ignites voxels on the other vehicle that lie within `c4ExplosionRadius` of the blast
 * 5. Spawns 8-12 orange/red explosion FX debris particles with fast outward velocity (10-30 m/s)
 * 6. Plays explosion sound (`SoundFX.explode()`)
 * 7. Triggers a brief 0.2s small screen shake on player-occupied vehicles
 */
export function detonateC4Voxel(
  vehicle: C4VehicleTarget,
  voxelKey: number,
  allVehicles: readonly C4VehicleTarget[] = [vehicle],
  nowMs: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  debrisSystem?: VoxelDebrisSystem | null,
): C4ExplosionEvent | null {
  const normKey = normalizeVoxelKey(voxelKey);
  const [vx, vy, vz] = unpackVoxelKey(normKey);
  const rawMat = vehicle.getVoxel(vx, vy, vz);

  vehicle.ignitedC4Voxels?.delete(normKey);

  if ((rawMat & 63) !== MAT.C4_EXPLOSIVE) {
    return null;
  }

  const c4WorldPos = vehicle.localVoxelToWorld(vx, vy, vz, new THREE.Vector3());
  const c4DebrisSpeed = {
    minMPS: PHYSICS_CONFIG.c4.debrisSpeedMinMPS,
    maxMPS: PHYSICS_CONFIG.c4.debrisSpeedMaxMPS,
  };

  const chainedC4Keys: Array<{ vehicle: C4VehicleTarget; voxelKey: number }> = [];
  const destroyedVoxelKeys: Array<{ vehicle: C4VehicleTarget; voxelKey: number }> = [];
  const damagedVoxels: Array<{
    vehicle: C4VehicleTarget;
    voxelKey: number;
    damage: number;
    destroyed: boolean;
  }> = [];
  const pushedOtherVehicles: Array<{
    vehicle: C4VehicleTarget;
    closestPointWorld: THREE.Vector3;
    distanceVoxels: number;
    impulseMagnitude: number;
  }> = [];

  // 1. Destroy the C4 voxel itself (calls existing destroyVoxel)
  const selfDest = destroyVoxel(
    vehicle,
    normKey,
    c4WorldPos,
    debrisSystem,
    true,
    c4DebrisSpeed,
  );
  if (selfDest.destroyed) {
    destroyedVoxelKeys.push({ vehicle, voxelKey: normKey });
  }

  // 2. Scan all voxels within radius `c4ExplosionRadius` (2.5 voxels) on `vehicle`
  const radiusVoxels = PHYSICS_CONFIG.c4ExplosionRadius;
  const maxOffset = Math.ceil(radiusVoxels);
  const radiusSq = radiusVoxels * radiusVoxels;

  const candidateC4InRadius: Array<{
    key: number;
    nx: number;
    ny: number;
    nz: number;
    distSq: number;
  }> = [];

  for (let dy = -maxOffset; dy <= maxOffset; dy++) {
    for (let dz = -maxOffset; dz <= maxOffset; dz++) {
      for (let dx = -maxOffset; dx <= maxOffset; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > radiusSq) continue;

        const nx = vx + dx;
        const ny = vy + dy;
        const nz = vz + dz;
        const nMat = vehicle.getVoxel(nx, ny, nz);
        if (nMat === MAT.AIR) continue;

        const nKey = packVoxelKey(nx, ny, nz);
        if ((nMat & 63) === MAT.C4_EXPLOSIVE) {
          if (PHYSICS_CONFIG.c4ChainToAdjacentC4) {
            candidateC4InRadius.push({ key: nKey, nx, ny, nz, distSq: dSq });
          }
        } else {
          const dmgRes = applyDamageToVoxel(
            vehicle,
            nKey,
            PHYSICS_CONFIG.c4DamageInRadius,
            c4WorldPos,
            debrisSystem,
            true,
            c4DebrisSpeed,
          );
          damagedVoxels.push({
            vehicle,
            voxelKey: nKey,
            damage: PHYSICS_CONFIG.c4DamageInRadius,
            destroyed: dmgRes.destroyed,
          });
          if (dmgRes.destroyed) {
            destroyedVoxelKeys.push({ vehicle, voxelKey: nKey });
          }
        }
      }
    }
  }

  // Propagate chain reaction to neighboring C4 voxels:
  // Direct 26-neighbors (|dx|<=1, |dy|<=1, |dz|<=1, distSq <= 3) always ignite immediately at `nowMs`.
  // Further C4 within 2.5 voxels (3 < distSq <= 6.25) ignite at `nowMs` only if there is no intermediate
  // direct-neighbor C4 bridging the step, so a contiguous row of 5 or 10 C4 ripples 1-by-1 every 200ms!
  const directNeighborC4 = candidateC4InRadius.filter((c) => c.distSq <= 3);
  for (const c4 of candidateC4InRadius) {
    if (c4.distSq <= 3) {
      if (igniteC4Voxel(vehicle, c4.key, nowMs)) {
        chainedC4Keys.push({ vehicle, voxelKey: c4.key });
      }
    } else {
      const hasBridge = directNeighborC4.some((adj) => {
        const bdx = c4.nx - adj.nx;
        const bdy = c4.ny - adj.ny;
        const bdz = c4.nz - adj.nz;
        return bdx * bdx + bdy * bdy + bdz * bdz <= 3;
      });
      if (!hasBridge) {
        if (igniteC4Voxel(vehicle, c4.key, nowMs)) {
          chainedC4Keys.push({ vehicle, voxelKey: c4.key });
        }
      }
    }
  }

  // 3. Apply explosion impulse to the host vehicle body at the C4 world position
  // Direction: from C4 outward toward vehicle CoM, biased upward so explosions launch/pitch things up!
  if (vehicle.rigidBody) {
    _impulseDir.subVectors(vehicle.rigidBody.position, c4WorldPos);
    if (_impulseDir.lengthSq() < 1e-4) {
      _impulseDir.set(0, 1, 0);
    } else {
      _impulseDir.normalize();
      _impulseDir.y = Math.max(0.55, _impulseDir.y + 0.65);
      _impulseDir.normalize();
    }
    const hostMassScale = (vehicle as any).isVoxelEntity
      ? Math.min(1.0, Math.max(0.04, vehicle.rigidBody.mass / 450))
      : 1.0;
    _impulseVec
      .copy(_impulseDir)
      .multiplyScalar(PHYSICS_CONFIG.c4VehicleImpulse * hostMassScale);
    vehicle.rigidBody.applyImpulseAtPoint(_impulseVec, c4WorldPos);
    vehicle.velocity.copy(vehicle.rigidBody.velocity);
    if (vehicle.angularVelocity) {
      vehicle.angularVelocity.copy(vehicle.rigidBody.angularVelocity);
    }
  }

  // 4. For all OTHER vehicles within `c4OtherVehicleRadius` (5.0 voxels, and also supporting up to 5.0m for test setups):
  // - Damage / chain-ignite any voxels on the other vehicle within `c4ExplosionRadius` (2.5 voxels) of `c4WorldPos`
  // - Apply outward impulse at the closest point on the other vehicle with 1/dist² falloff
  const otherRadiusVoxels = PHYSICS_CONFIG.c4OtherVehicleRadius;
  const maxCheckDistMeters = Math.max(
    otherRadiusVoxels * VOXEL_SIZE,
    otherRadiusVoxels,
  );
  const maxBroadphaseDistSq =
    (maxCheckDistMeters + 10.0) * (maxCheckDistMeters + 10.0);

  for (let i = 0; i < allVehicles.length; i++) {
    const otherVeh = allVehicles[i];
    if (!otherVeh || otherVeh === vehicle || otherVeh.inBuildMode) continue;

    // Fast O(1) broadphase center-distance filter so distant vehicles/props skip full voxelMap iteration
    const centerPos = otherVeh.rigidBody
      ? otherVeh.rigidBody.position
      : otherVeh.position;
    if (centerPos && centerPos.distanceToSquared(c4WorldPos) > maxBroadphaseDistSq) {
      continue;
    }

    const closestDistMeters = findClosestPointOnVehicleToWorldPos(
      otherVeh,
      c4WorldPos,
      _closestPtWorld,
    );
    const closestDistVoxels = closestDistMeters / VOXEL_SIZE;

    // Check if any voxels on `otherVeh` are within blast damage radius (2.5 voxels, or parked directly on top of the C4)
    if (closestDistVoxels <= otherRadiusVoxels + 1.0) {
      const [ocx, ocy, ocz] = worldPosToVehicleLocalVoxel(otherVeh, c4WorldPos);
      const otherDamageRad = Math.max(radiusVoxels, 3.0);
      const otherMaxOff = Math.ceil(otherDamageRad);
      const otherRadSq = otherDamageRad * otherDamageRad;

      for (let dy = -otherMaxOff; dy <= otherMaxOff; dy++) {
        for (let dz = -otherMaxOff; dz <= otherMaxOff; dz++) {
          for (let dx = -otherMaxOff; dx <= otherMaxOff; dx++) {
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq > otherRadSq) continue;
            const ovx = ocx + dx;
            const ovy = ocy + dy;
            const ovz = ocz + dz;
            const oMat = otherVeh.getVoxel(ovx, ovy, ovz);
            if (oMat === MAT.AIR) continue;

            otherVeh.localVoxelToWorld(ovx, ovy, ovz, _targetWorldPos);
            const worldVoxelDist =
              _targetWorldPos.distanceTo(c4WorldPos) / VOXEL_SIZE;
            if (worldVoxelDist > otherDamageRad) continue;

            const oKey = packVoxelKey(ovx, ovy, ovz);
            if ((oMat & 63) === MAT.C4_EXPLOSIVE) {
              if (
                PHYSICS_CONFIG.c4ChainToAdjacentC4 &&
                igniteC4Voxel(otherVeh, oKey, nowMs)
              ) {
                chainedC4Keys.push({ vehicle: otherVeh, voxelKey: oKey });
              }
            } else {
              const dmgRes = applyDamageToVoxel(
                otherVeh,
                oKey,
                PHYSICS_CONFIG.c4DamageInRadius,
                c4WorldPos,
                debrisSystem,
                true,
                c4DebrisSpeed,
              );
              damagedVoxels.push({
                vehicle: otherVeh,
                voxelKey: oKey,
                damage: PHYSICS_CONFIG.c4DamageInRadius,
                destroyed: dmgRes.destroyed,
              });
              if (dmgRes.destroyed) {
                destroyedVoxelKeys.push({ vehicle: otherVeh, voxelKey: oKey });
              }
            }
          }
        }
      }
    }

    if (closestDistMeters <= maxCheckDistMeters && otherVeh.rigidBody) {
      // Direction away from explosion toward the closest point / vehicle center, biased upward
      _impulseDir.subVectors(_closestPtWorld, c4WorldPos);
      if (_impulseDir.lengthSq() < 1e-4) {
        _impulseDir.subVectors(otherVeh.rigidBody.position, c4WorldPos);
      }
      if (_impulseDir.lengthSq() < 1e-4) {
        _impulseDir.set(0, 1, 0);
      } else {
        _impulseDir.normalize();
        _impulseDir.y = Math.max(0.35, _impulseDir.y + 0.35);
        _impulseDir.normalize();
      }

      // Magnitude falls off with 1 / dist²
      const effDist = Math.max(0.5, closestDistMeters);
      const impulseMag =
        PHYSICS_CONFIG.c4OtherVehicleImpulse / (effDist * effDist);

      _impulseVec.copy(_impulseDir).multiplyScalar(impulseMag);
      otherVeh.rigidBody.applyImpulseAtPoint(_impulseVec, _closestPtWorld);
      otherVeh.velocity.copy(otherVeh.rigidBody.velocity);
      if (otherVeh.angularVelocity) {
        otherVeh.angularVelocity.copy(otherVeh.rigidBody.angularVelocity);
      }

      pushedOtherVehicles.push({
        vehicle: otherVeh,
        closestPointWorld: _closestPtWorld.clone(),
        distanceVoxels: closestDistVoxels,
        impulseMagnitude: impulseMag,
      });
    }
  }

  // 5. Spawn explosion FX: 8-12 debris particles, orange/red, fast outward velocity (10-30 m/s)
  const fxCount =
    PHYSICS_CONFIG.c4.fxParticleCountMin +
    Math.floor(
      Math.random() *
        (PHYSICS_CONFIG.c4.fxParticleCountMax -
          PHYSICS_CONFIG.c4.fxParticleCountMin +
          1),
    );
  for (let i = 0; i < fxCount; i++) {
    const fxColor = C4_FX_COLORS[i % C4_FX_COLORS.length];
    if (debrisSystem) {
      _targetWorldPos.set(
        c4WorldPos.x + (Math.random() - 0.5) * 0.25,
        c4WorldPos.y + (Math.random() - 0.3) * 0.25,
        c4WorldPos.z + (Math.random() - 0.5) * 0.25,
      );
      debrisSystem.spawnDebrisVoxel(
        _targetWorldPos,
        vehicle.velocity || _zeroParentVel,
        c4WorldPos,
        fxColor,
        MAT.C4_EXPLOSIVE,
        c4DebrisSpeed,
      );
    }
    if (vehicle.fx?.spawnDebris) {
      const fastVel =
        c4DebrisSpeed.minMPS +
        Math.random() * (c4DebrisSpeed.maxMPS - c4DebrisSpeed.minMPS);
      vehicle.fx.spawnDebris(
        c4WorldPos.x,
        c4WorldPos.y + 0.1,
        c4WorldPos.z,
        fxColor,
        fastVel,
        1.25,
      );
    }
  }

  // 6. Play explosion sound
  SoundFX.explode();

  // 7. Brief screen shake on player-occupied vehicle (0.2s, small magnitude)
  let screenShakeTriggered = false;
  const screenShakeDurationSec = PHYSICS_CONFIG.c4.screenShakeDurationSec;
  for (let i = 0; i < allVehicles.length; i++) {
    const v = allVehicles[i];
    if (v?.isLocalPlayerOccupied) {
      screenShakeTriggered = true;
      if (v.fx) {
        // fx.trauma decays at 1.75 / sec in fx.ts, so 0.35 trauma = exactly 0.20s of brief screen shake
        v.fx.trauma = Math.min(
          0.65,
          Math.max(v.fx.trauma || 0, 0.35),
        );
      }
    }
  }

  return {
    vehicle,
    vehicleId: vehicle.networkId || vehicle.vehicleId || 'vehicle_0',
    voxelKey: normKey,
    vx,
    vy,
    vz,
    worldPos: c4WorldPos,
    chainedC4Keys,
    destroyedVoxelKeys,
    damagedVoxels,
    pushedOtherVehicles,
    fxParticlesSpawned: fxCount,
    screenShakeTriggered,
    screenShakeDurationSec,
  };
}

/**
 * Steps all ignited C4 fuses across `vehicles`.
 * Any C4 voxel whose `nowMs - igniteTimeMs >= PHYSICS_CONFIG.c4IgniteDelayMs` (200ms) explodes,
 * triggering chain reactions, voxel destruction, physics debris, and vehicle impulses inside a
 * single batched structural integrity & geometry rebuild pass.
 */
export function updateC4System(
  vehicles: readonly C4VehicleTarget[],
  nowMs: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  debrisSystem?: VoxelDebrisSystem | null,
  onExplosion?: (event: C4ExplosionEvent) => void,
): C4ExplosionEvent[] {
  const dueList: Array<{ vehicle: C4VehicleTarget; voxelKey: number }> = [];
  const delayMs = PHYSICS_CONFIG.c4IgniteDelayMs;

  for (let i = 0; i < vehicles.length; i++) {
    const veh = vehicles[i];
    if (!veh || veh.inBuildMode || !veh.ignitedC4Voxels || veh.ignitedC4Voxels.size === 0) {
      continue;
    }
    for (const [vKey, igniteTimeMs] of veh.ignitedC4Voxels.entries()) {
      if (nowMs - igniteTimeMs >= delayMs) {
        dueList.push({ vehicle: veh, voxelKey: vKey });
      }
    }
  }

  if (dueList.length === 0) {
    return [];
  }

  const events: C4ExplosionEvent[] = [];
  beginDestructionBatch();
  try {
    for (let i = 0; i < dueList.length; i++) {
      const item = dueList[i];
      const ev = detonateC4Voxel(
        item.vehicle,
        item.voxelKey,
        vehicles,
        nowMs,
        debrisSystem,
      );
      if (ev) {
        events.push(ev);
        if (onExplosion) {
          onExplosion(ev);
        }
      }
    }
    // If any VoxelEntity prop (such as an Explosive C4 Barrel) just finished detonating all of its C4 voxels,
    // destroy any remaining steel/band rim voxels so no tiny 3.5kg phantom fragment gets launched into orbit!
    const touchedEntities = new Set<C4VehicleTarget>();
    for (let i = 0; i < events.length; i++) {
      const v = events[i].vehicle;
      if ((v as any).isVoxelEntity) {
        touchedEntities.add(v);
      }
    }
    for (const ent of touchedEntities) {
      if (ent.ignitedC4Voxels && ent.ignitedC4Voxels.size > 0) continue;
      let hasRemainingC4 = false;
      for (const [, rawMat] of ent.voxelMap.entries()) {
        if ((rawMat & 63) === MAT.C4_EXPLOSIVE) {
          hasRemainingC4 = true;
          break;
        }
      }
      if (!hasRemainingC4 && ent.voxelMap.size > 0 && ent.voxelMap.size <= 16) {
        for (const [rawKey, rawMat] of Array.from(ent.voxelMap.entries())) {
          if (rawMat === MAT.AIR) continue;
          const nKey = normalizeVoxelKey(rawKey);
          destroyVoxel(ent, nKey, ent.position, debrisSystem, true);
        }
      }
    }
  } finally {
    flushDestructionBatch();
  }

  return events;
}
