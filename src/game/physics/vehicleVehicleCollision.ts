import * as THREE from 'three';
import { MAT, VOXEL_SIZE } from '../constants.ts';
import { packVoxelKey, unpackVoxelKey } from './collisionPoints.ts';
import { PHYSICS_CONFIG } from './physicsConfig.ts';
import {
  SpatialHashBroadphase,
  type BroadphaseVehicleLike,
} from './broadphase.ts';
import {
  resolvePointVoxelCollision,
  type CollisionResponseResult,
} from './collisionResponse.ts';
import {
  beginDestructionBatch,
  flushDestructionBatch,
  type DestructibleVehicle,
} from './destruction.ts';
import type { VoxelDebrisSystem } from './debris.ts';
import { damageWheelFromCollision, type HybridWheelModuleLike } from './groundCollision.ts';
import {
  resolveVehicleVsPropCollision,
  resolvePropVsPropCollision,
  type PropRigidBody,
} from './propRigidBody.ts';
import {
  shouldCullCollisionPointByDirection,
  unifiedEngineTelemetry,
} from '../unifiedVoxelEngine.ts';

export interface VehicleCollisionRuntimeTarget
  extends BroadphaseVehicleLike,
    DestructibleVehicle {
  vehicleId: string;
  networkId?: string;
  isVoxelEntity?: boolean;
  propRigidBody?: PropRigidBody | null;
  lastDamageImpactWorld?: THREE.Vector3 | null;
  cachedWheelMods?: HybridWheelModuleLike[];
  worldToLocalMetric: (
    wx: number,
    wy: number,
    wz: number,
    out?: THREE.Vector3,
  ) => THREE.Vector3;
}

export interface VehiclePairNarrowphaseResult {
  vehicleA: VehicleCollisionRuntimeTarget;
  vehicleB: VehicleCollisionRuntimeTarget;
  contactCount: number;
  maxImpulse: number;
  voxelsDestroyedOnA: number;
  voxelsDestroyedOnB: number;
  stickyWeldsActive: number;
  lastContactWorldPos: THREE.Vector3 | null;
  responses: CollisionResponseResult[];
}

const _worldPoint = new THREE.Vector3();
const _relPos = new THREE.Vector3();
const _localMetricB = new THREE.Vector3();
const _voxelCenterWorldB = new THREE.Vector3();
const _stickyTargetWorld = new THREE.Vector3();
const _stickyDelta = new THREE.Vector3();
const _stickyForce = new THREE.Vector3();
const _invQuatA = new THREE.Quaternion();
const _dirToDefenderLocalA = new THREE.Vector3();

/**
 * Checks if a world-space impact point is near any wheel on `vehicle` and applies hybrid wheel voxel damage (Step 2.7).
 */
function checkAndApplyWheelCollisionDamage(
  vehicle: VehicleCollisionRuntimeTarget,
  impactWorldPos: THREE.Vector3,
  impulseMagnitude: number,
  debrisSystem?: VoxelDebrisSystem | null,
): void {
  const wheels = vehicle.cachedWheelMods;
  if (!wheels || wheels.length === 0) return;
  if (impulseMagnitude < PHYSICS_CONFIG.collisionResponse.minDamageImpulseThreshold) {
    return;
  }

  for (let i = 0; i < wheels.length; i++) {
    const w = wheels[i];
    if (w.isShotOut) continue;
    vehicle.localVoxelToWorld(w.vx, w.vy, w.vz, _voxelCenterWorldB);
    const distSq = _voxelCenterWorldB.distanceToSquared(impactWorldPos);
    if (distSq <= 1.15 * 1.15) {
      const voxLost = Math.max(1, Math.min(4, Math.floor(impulseMagnitude / 650)));
      damageWheelFromCollision(
        vehicle as any,
        w,
        voxLost,
        impactWorldPos,
        debrisSystem,
      );
    }
  }
}

/**
 * Maintains active `sticky` welded connections (`P.welded === true`) between `vehicleA` and `vehicleB`,
 * applying a continuous holding force until separation exceeds `stickyBreakDistanceMeters` or the target voxel breaks.
 */
function maintainStickyWeldedConnections(
  vehicleA: VehicleCollisionRuntimeTarget,
  vehicleB: VehicleCollisionRuntimeTarget,
): number {
  let activeWelds = 0;
  const pointsA = vehicleA.rigidBody.collisionPoints;
  const cfg = PHYSICS_CONFIG.collisionResponse;

  for (let i = 0; i < pointsA.length; i++) {
    const pt = pointsA[i];
    if (!pt.welded || pt.weldedTargetVehicleId !== vehicleB.vehicleId) {
      continue;
    }

    const targetKey = pt.weldedTargetVoxelKey;
    if (typeof targetKey !== 'number') {
      pt.welded = false;
      continue;
    }

    const [bvx, bvy, bvz] = unpackVoxelKey(targetKey);
    if (vehicleB.getVoxel(bvx, bvy, bvz) === MAT.AIR) {
      pt.welded = false;
      pt.weldedTargetVehicleId = undefined;
      pt.weldedTargetVoxelKey = undefined;
      continue;
    }

    _relPos.copy(pt.localPos).applyQuaternion(vehicleA.rigidBody.quaternion);
    _worldPoint.addVectors(vehicleA.rigidBody.position, _relPos);
    vehicleB.localVoxelToWorld(bvx, bvy, bvz, _stickyTargetWorld);

    _stickyDelta.subVectors(_stickyTargetWorld, _worldPoint);
    const dist = _stickyDelta.length();
    if (dist > cfg.stickyBreakDistanceMeters) {
      // Connection snapped apart!
      pt.welded = false;
      pt.weldedTargetVehicleId = undefined;
      pt.weldedTargetVoxelKey = undefined;
      continue;
    }

    activeWelds++;
    if (dist > 1e-4) {
      const pullMag = dist * cfg.stickyHoldingForce;
      _stickyForce
        .copy(_stickyDelta)
        .divideScalar(dist)
        .multiplyScalar(pullMag);
      vehicleA.rigidBody.applyForceAtPoint(_stickyForce, _worldPoint);
      _stickyForce.negate();
      vehicleB.rigidBody.applyForceAtPoint(_stickyForce, _stickyTargetWorld);
    }
  }

  return activeWelds;
}

const _localNormalB = new THREE.Vector3();
const _worldNormalB = new THREE.Vector3();
const _attackerCoMLocalB = new THREE.Vector3();
const _escapeDirLocalB = new THREE.Vector3();

const CARDINAL_DIRS: ReadonlyArray< readonly [number, number, number] > = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Computes the true outward collision normal and metric penetration depth to the exterior surface
 * of `defender`'s voxel hull when `_localMetricB` is inside voxel `(hitVX, hitVY, hitVZ)`.
 * Prevents collision normals from flipping inward when a wheel or bumper point crosses the center
 * of a voxel, and accurately measures multi-voxel penetration depth (> 0.5m) for Hard Ejection (FIX 1).
 */
function computeHullPenetrationAndOutwardNormal(
  attacker: VehicleCollisionRuntimeTarget,
  defender: VehicleCollisionRuntimeTarget,
  hitVX: number,
  hitVY: number,
  hitVZ: number,
  localMetricB: THREE.Vector3,
  worldPoint: THREE.Vector3,
  voxelCenterWorldB: THREE.Vector3,
  outWorldNormal: THREE.Vector3,
): { penetrationDepth: number; hasExplicitNormal: boolean } {
  defender.worldToLocalMetric(
    attacker.rigidBody.position.x,
    attacker.rigidBody.position.y,
    attacker.rigidBody.position.z,
    _attackerCoMLocalB,
  );
  _escapeDirLocalB.subVectors(_attackerCoMLocalB, localMetricB);
  if (_escapeDirLocalB.lengthSq() < 1e-6) {
    _escapeDirLocalB.copy(_attackerCoMLocalB);
  }
  if (_escapeDirLocalB.lengthSq() < 1e-6) {
    _escapeDirLocalB.set(0, 0, 1);
  } else {
    _escapeDirLocalB.normalize();
  }

  let bestScore = Infinity;
  let bestDepth = 0;
  let bestDX = 0;
  let bestDY = 0;
  let bestDZ = 0;

  const maxMarchVoxels = 6;
  for (let d = 0; d < CARDINAL_DIRS.length; d++) {
    const [dx, dy, dz] = CARDINAL_DIRS[d];
    const align =
      dx * _escapeDirLocalB.x +
      dy * _escapeDirLocalB.y +
      dz * _escapeDirLocalB.z;
    // Only consider outward directions that do not point against the attacker's CoM escape direction
    if (align < -0.15) {
      continue;
    }

    let stepsToAir = 0;
    for (let s = 1; s <= maxMarchVoxels; s++) {
      if (
        defender.getVoxel(hitVX + dx * s, hitVY + dy * s, hitVZ + dz * s) ===
        MAT.AIR
      ) {
        stepsToAir = s;
        break;
      }
    }
    if (stepsToAir === 0) {
      continue;
    }

    let depthMeters = VOXEL_SIZE * stepsToAir;
    if (dx === 1) {
      depthMeters = (hitVX + stepsToAir) * VOXEL_SIZE - localMetricB.x;
    } else if (dx === -1) {
      depthMeters = localMetricB.x - (hitVX - stepsToAir + 1) * VOXEL_SIZE;
    } else if (dy === 1) {
      depthMeters = (hitVY + stepsToAir) * VOXEL_SIZE - localMetricB.y;
    } else if (dy === -1) {
      depthMeters = localMetricB.y - (hitVY - stepsToAir + 1) * VOXEL_SIZE;
    } else if (dz === 1) {
      depthMeters = (hitVZ + stepsToAir) * VOXEL_SIZE - localMetricB.z;
    } else if (dz === -1) {
      depthMeters = localMetricB.z - (hitVZ - stepsToAir + 1) * VOXEL_SIZE;
    }

    depthMeters = Math.max(0.015, depthMeters);
    const weight = Math.max(0.2, align + 0.35);
    const score = depthMeters / weight;
    if (score < bestScore) {
      bestScore = score;
      bestDepth = depthMeters;
      bestDX = dx;
      bestDY = dy;
      bestDZ = dz;
    }
  }

  if (bestScore < Infinity) {
    _localNormalB.set(bestDX, bestDY, bestDZ).normalize();
    outWorldNormal
      .copy(_localNormalB)
      .applyQuaternion(defender.rigidBody.quaternion)
      .normalize();
    // For single-voxel surface contact (bestDepth <= VOXEL_SIZE), clamp to center-based overlap so grazing hits stay gentle
    if (bestDepth <= VOXEL_SIZE) {
      const distCenters = worldPoint.distanceTo(voxelCenterWorldB);
      const centerPen = Math.max(0.015, VOXEL_SIZE - distCenters);
      return {
        penetrationDepth: Math.min(bestDepth, Math.max(centerPen, bestDepth * 0.65)),
        hasExplicitNormal: true,
      };
    }
    return {
      penetrationDepth: bestDepth,
      hasExplicitNormal: true,
    };
  }

  const distCenters = worldPoint.distanceTo(voxelCenterWorldB);
  return {
    penetrationDepth: Math.max(0.015, VOXEL_SIZE - distCenters),
    hasExplicitNormal: false,
  };
}

/**
 * Tests all sampled collision points of `attacker` against `defender`'s O(1) int32 voxelMap.
 */
function runOneWayPointVsVoxelGrid(
  attacker: VehicleCollisionRuntimeTarget,
  defender: VehicleCollisionRuntimeTarget,
  debrisSystem: VoxelDebrisSystem | null | undefined,
  result: VehiclePairNarrowphaseResult,
  isForwardDirection: boolean,
): void {
  const points = attacker.rigidBody.collisionPoints;
  // Snapshot array since destroying a voxel splices its collision point out
  const snapshotPoints = points.slice();

  // FIX 2: Pre-count simultaneous wheel (GRIPPY) contact points on `attacker` against `defender`
  // so cavity detection (3+ contacts -> 5.0x rolling friction boost) is active before resolving impulses!
  let grippyContactsOnAttacker = 0;
  const wheels = attacker.cachedWheelMods;
  if (wheels && wheels.length > 0) {
    for (let w = 0; w < wheels.length; w++) {
      wheels[w].activeContactCount = 0;
    }
  }

  for (let i = 0; i < snapshotPoints.length; i++) {
    const pt = snapshotPoints[i];
    _relPos.copy(pt.localPos).applyQuaternion(attacker.rigidBody.quaternion);
    _worldPoint.addVectors(attacker.rigidBody.position, _relPos);
    defender.worldToLocalMetric(
      _worldPoint.x,
      _worldPoint.y,
      _worldPoint.z,
      _localMetricB,
    );
    const bvx = Math.round(_localMetricB.x / VOXEL_SIZE - 0.5);
    const bvy = Math.round(_localMetricB.y / VOXEL_SIZE - 0.5);
    const bvz = Math.round(_localMetricB.z / VOXEL_SIZE - 0.5);
    let hitMat = defender.getVoxel(bvx, bvy, bvz);
    if (hitMat === MAT.AIR) {
      const fvx = Math.floor(_localMetricB.x / VOXEL_SIZE);
      const fvy = Math.floor(_localMetricB.y / VOXEL_SIZE);
      const fvz = Math.floor(_localMetricB.z / VOXEL_SIZE);
      hitMat = defender.getVoxel(fvx, fvy, fvz);
    }
    if (hitMat !== MAT.AIR) {
      if (pt.material === 'grippy') {
        grippyContactsOnAttacker++;
      }
      if (wheels && wheels.length > 0) {
        for (let w = 0; w < wheels.length; w++) {
          const wh = wheels[w];
          attacker.localVoxelToWorld(wh.vx, wh.vy, wh.vz, _voxelCenterWorldB);
          if (_voxelCenterWorldB.distanceToSquared(_worldPoint) <= 1.25 * 1.25) {
            wh.activeContactCount = (wh.activeContactCount ?? 0) + 1;
            if ((wh.activeContactCount ?? 0) > grippyContactsOnAttacker) {
              grippyContactsOnAttacker = wh.activeContactCount!;
            }
          }
        }
      }
    }
  }

  attacker.rigidBody.setWheelActiveContacts(0, grippyContactsOnAttacker);
  if (wheels && wheels.length > 0) {
    for (let w = 0; w < wheels.length; w++) {
      const count = wheels[w].activeContactCount ?? 0;
      attacker.rigidBody.setWheelActiveContacts(w, count);
      wheels[w].isInCavity =
        count >= (PHYSICS_CONFIG.hybridWheels.cavityContactThreshold ?? 3);
      wheels[w].rollingFrictionMultiplier = wheels[w].isInCavity
        ? (PHYSICS_CONFIG.hybridWheels.cavityRollingFrictionMultiplier ?? 5.0)
        : 1.0;
    }
  }

  // Compute direction from attacker CoM toward defender CoM in attacker's local frame for 6-bit exposed-face culling
  _invQuatA.copy(attacker.rigidBody.quaternion).invert();
  _dirToDefenderLocalA
    .subVectors(defender.rigidBody.position, attacker.rigidBody.position)
    .applyQuaternion(_invQuatA);
  const centerDistSq = _dirToDefenderLocalA.lengthSq();
  const canUseDirectionalHullCull = centerDistSq > 0.36; // > 0.6m CoM separation
  if (canUseDirectionalHullCull) {
    _dirToDefenderLocalA.divideScalar(Math.sqrt(centerDistSq));
  }

  for (let i = 0; i < snapshotPoints.length; i++) {
    const pt = snapshotPoints[i] as {
      localPos: THREE.Vector3;
      exposedFaceMask?: number;
      localOutwardNormal?: { x: number; y: number; z: number };
    } & (typeof snapshotPoints)[number];

    // Fast 6-bit exposed-face back-face cull: if point sits on the far side of attacker away from defender
    // and its exposed faces all point away from defender, skip transforming & probing defender's voxel grid
    if (
      canUseDirectionalHullCull &&
      pt.exposedFaceMask !== undefined &&
      pt.localOutwardNormal !== undefined &&
      pt.localPos.dot(_dirToDefenderLocalA) < -0.35 &&
      shouldCullCollisionPointByDirection(
        pt.exposedFaceMask,
        pt.localOutwardNormal.x,
        pt.localOutwardNormal.y,
        pt.localOutwardNormal.z,
        _dirToDefenderLocalA.x,
        _dirToDefenderLocalA.y,
        _dirToDefenderLocalA.z,
        -0.5,
      )
    ) {
      unifiedEngineTelemetry.cullSkippedCollisionPoints++;
      continue;
    }

    // 1a. Transform P.localPos to world space using attacker's position + quaternion
    _relPos.copy(pt.localPos).applyQuaternion(attacker.rigidBody.quaternion);
    _worldPoint.addVectors(attacker.rigidBody.position, _relPos);

    // 1b. Transform that world position to defender's local space (using defender's inverse transform)
    defender.worldToLocalMetric(
      _worldPoint.x,
      _worldPoint.y,
      _worldPoint.z,
      _localMetricB,
    );

    // 1c. Round to nearest voxel coordinates (vx, vy, vz)
    const bvx = Math.round(_localMetricB.x / VOXEL_SIZE - 0.5);
    const bvy = Math.round(_localMetricB.y / VOXEL_SIZE - 0.5);
    const bvz = Math.round(_localMetricB.z / VOXEL_SIZE - 0.5);

    // 1d. Check if defender's voxelMap has a voxel at (bvx, bvy, bvz) that is not AIR (O(1) int32 lookup)
    let hitMat = defender.getVoxel(bvx, bvy, bvz);
    let hitVX = bvx;
    let hitVY = bvy;
    let hitVZ = bvz;

    // Also check the immediate floor-quantized cell in case the point grazed a voxel face
    if (hitMat === MAT.AIR) {
      const fvx = Math.floor(_localMetricB.x / VOXEL_SIZE);
      const fvy = Math.floor(_localMetricB.y / VOXEL_SIZE);
      const fvz = Math.floor(_localMetricB.z / VOXEL_SIZE);
      const fMat = defender.getVoxel(fvx, fvy, fvz);
      if (fMat !== MAT.AIR) {
        hitMat = fMat;
        hitVX = fvx;
        hitVY = fvy;
        hitVZ = fvz;
      }
    }

    if (hitMat === MAT.AIR) {
      continue;
    }

    // 1e. Collision detected! Check whether the hit voxel on defender is an exposed top surface / ramp step
    // (where the 2 voxels above it in defender's local Y are AIR) vs. a vertical wall.
    const voxelBKey = packVoxelKey(hitVX, hitVY, hitVZ);
    defender.localVoxelToWorld(hitVX, hitVY, hitVZ, _voxelCenterWorldB);

    const above1Air = defender.getVoxel(hitVX, hitVY + 1, hitVZ) === MAT.AIR;
    const above2Air = defender.getVoxel(hitVX, hitVY + 2, hitVZ) === MAT.AIR;
    const topFaceLocalY = (hitVY + 1) * VOXEL_SIZE;
    const stepDepthLocal = topFaceLocalY - _localMetricB.y;

    let surfaceNormalOverride: THREE.Vector3 | null = null;
    let penetrationDepth: number;

    if (
      !defender.isVoxelEntity &&
      !attacker.isVoxelEntity &&
      above1Air &&
      above2Air &&
      stepDepthLocal >= -0.05 &&
      stepDepthLocal <= 0.42
    ) {
      // Exposed top deck or 1-voxel ramp stair step!
      // Compute a seam-free upward normal (with a smooth bevel if approaching a ramp step edge)
      // so vehicles can drive smoothly up ramps and across flatbeds without snagging on internal voxel seams.
      let nx = 0;
      let nz = 0;
      if (stepDepthLocal > VOXEL_SIZE * 0.35) {
        if (defender.getVoxel(hitVX + 1, hitVY, hitVZ) === MAT.AIR) nx += 0.32;
        if (defender.getVoxel(hitVX - 1, hitVY, hitVZ) === MAT.AIR) nx -= 0.32;
        if (defender.getVoxel(hitVX, hitVY, hitVZ + 1) === MAT.AIR) nz += 0.32;
        if (defender.getVoxel(hitVX, hitVY, hitVZ - 1) === MAT.AIR) nz -= 0.32;
      }
      _localNormalB.set(nx, 1.0, nz).normalize();
      _worldNormalB
        .copy(_localNormalB)
        .applyQuaternion(defender.rigidBody.quaternion)
        .normalize();
      surfaceNormalOverride = _worldNormalB;
      penetrationDepth = Math.max(0.012, Math.min(0.16, stepDepthLocal * 0.7));
    } else {
      const hullPen = computeHullPenetrationAndOutwardNormal(
        attacker,
        defender,
        hitVX,
        hitVY,
        hitVZ,
        _localMetricB,
        _worldPoint,
        _voxelCenterWorldB,
        _worldNormalB,
      );
      penetrationDepth = hullPen.penetrationDepth;
      if (hullPen.hasExplicitNormal) {
        surfaceNormalOverride = _worldNormalB;
      }
    }

    const colRes = resolvePointVoxelCollision({
      vehicleA: attacker,
      vehicleB: defender,
      pointA: pt,
      pointWorldPos: _worldPoint,
      voxelBKey,
      voxelBWorldCenter: _voxelCenterWorldB,
      voxelBRawMat: hitMat,
      penetrationDepth,
      surfaceNormalOverride,
      debrisSystem,
    });

    result.contactCount++;
    result.responses.push(colRes);
    if (colRes.normalImpulseMagnitude > result.maxImpulse) {
      result.maxImpulse = colRes.normalImpulseMagnitude;
    }
    if (!result.lastContactWorldPos) {
      result.lastContactWorldPos = _worldPoint.clone();
    } else {
      result.lastContactWorldPos.copy(_worldPoint);
    }

    if (isForwardDirection) {
      if (colRes.voxelADestroyed) result.voxelsDestroyedOnA++;
      if (colRes.voxelBDestroyed) result.voxelsDestroyedOnB++;
    } else {
      if (colRes.voxelADestroyed) result.voxelsDestroyedOnB++;
      if (colRes.voxelBDestroyed) result.voxelsDestroyedOnA++;
    }
    if (colRes.stickyLatched) {
      result.stickyWeldsActive++;
    }

    // Step 2.7 & FIX 3: Only apply wheel collision damage when NOT in hard ejection!
    if (
      !colRes.hardEjected &&
      !colRes.damageSuppressed &&
      !attacker.rigidBody.isEjecting &&
      !defender.rigidBody.isEjecting
    ) {
      checkAndApplyWheelCollisionDamage(
        defender,
        _worldPoint,
        colRes.normalImpulseMagnitude,
        debrisSystem,
      );
      checkAndApplyWheelCollisionDamage(
        attacker,
        _worldPoint,
        colRes.normalImpulseMagnitude,
        debrisSystem,
      );
    }
  }
}

function syncRigToPropBody(rig: VehicleCollisionRuntimeTarget, prop: PropRigidBody): void {
  if (prop.position === rig.rigidBody.position) {
    prop.sleepTimer = rig.rigidBody.sleepTimer;
    return;
  }
  prop.position.copy(rig.position);
  prop.quaternion.copy(rig.rigidBody.quaternion);
  prop.velocity.copy(rig.rigidBody.velocity);
  prop.angularVelocity.copy(rig.rigidBody.angularVelocity);
  prop.isSleeping = rig.rigidBody.isSleeping;
}

function syncPropBodyToRig(prop: PropRigidBody, rig: VehicleCollisionRuntimeTarget): void {
  if (prop.position === rig.rigidBody.position) {
    rig.rigidBody.sleepTimer = prop.sleepTimer;
    rig.rigidBody.syncToVoxelWorld();
    return;
  }
  rig.position.copy(prop.position);
  rig.rigidBody.position.copy(prop.position);
  rig.rigidBody.quaternion.copy(prop.quaternion);
  if ((rig as any).quaternion) {
    (rig as any).quaternion.copy(prop.quaternion);
  }
  rig.velocity.copy(prop.velocity);
  rig.rigidBody.velocity.copy(prop.velocity);
  if (rig.angularVelocity) {
    rig.angularVelocity.copy(prop.angularVelocity);
  }
  rig.rigidBody.angularVelocity.copy(prop.angularVelocity);
  rig.rigidBody.isSleeping = prop.isSleeping;
  rig.rigidBody.sleepTimer = prop.sleepTimer;
  rig.rigidBody.syncToVoxelWorld();
}

/**
 * Step 2.2: Narrowphase Per-Point vs Voxel-Grid Collision Solver for a pair of vehicles (A, B).
 * Tests A's collisionPoints against B's voxelMap, and B's collisionPoints against A's voxelMap.
 * O(collisionPoints × 1) per pair using int32 voxel keys.
 */
export function resolveVehiclePairNarrowphase(
  vehicleA: VehicleCollisionRuntimeTarget,
  vehicleB: VehicleCollisionRuntimeTarget,
  debrisSystem?: VoxelDebrisSystem | null,
): VehiclePairNarrowphaseResult {
  const result: VehiclePairNarrowphaseResult = {
    vehicleA,
    vehicleB,
    contactCount: 0,
    maxImpulse: 0,
    voxelsDestroyedOnA: 0,
    voxelsDestroyedOnB: 0,
    stickyWeldsActive: 0,
    lastContactWorldPos: null,
    responses: [],
  };

  // Skip if both vehicles are sleeping
  if (vehicleA.rigidBody.isSleeping && vehicleB.rigidBody.isSleeping) {
    return result;
  }

  // Fast Prop-vs-Prop collision path when both bodies are Voxel Entities with PropRigidBody
  if (vehicleA.isVoxelEntity && vehicleB.isVoxelEntity) {
    if (vehicleA.propRigidBody && vehicleB.propRigidBody) {
      syncRigToPropBody(vehicleA, vehicleA.propRigidBody);
      syncRigToPropBody(vehicleB, vehicleB.propRigidBody);
      const pairRes = resolvePropVsPropCollision(
        vehicleA.propRigidBody,
        vehicleB.propRigidBody,
      );
      if (pairRes.contactCount > 0) {
        syncPropBodyToRig(vehicleA.propRigidBody, vehicleA);
        syncPropBodyToRig(vehicleB.propRigidBody, vehicleB);
        result.contactCount = pairRes.contactCount;
        result.maxImpulse = pairRes.maxImpulse;
        result.lastContactWorldPos = pairRes.contactPoint.clone();
      }
      return result;
    }
    // If either custom voxel entity lacks a PropRigidBody, fall through to exact voxel-grid narrowphase below!
  }

  // Fast lightweight PropRigidBody path when one body is a vehicle and the other is a prop entity
  if (!vehicleA.isVoxelEntity && vehicleB.isVoxelEntity && vehicleB.propRigidBody) {
    syncRigToPropBody(vehicleB, vehicleB.propRigidBody);
    const propRes = resolveVehicleVsPropCollision(
      vehicleA.rigidBody,
      vehicleB.propRigidBody,
      vehicleA.position,
      vehicleA.velocity,
      vehicleA.angularVelocity,
    );
    if (propRes.contactCount > 0) {
      syncPropBodyToRig(vehicleB.propRigidBody, vehicleB);
      result.contactCount = propRes.contactCount;
      result.maxImpulse = propRes.maxImpulse;
      result.lastContactWorldPos = vehicleB.position.clone();
    }
    return result;
  }

  if (vehicleA.isVoxelEntity && vehicleA.propRigidBody && !vehicleB.isVoxelEntity) {
    syncRigToPropBody(vehicleA, vehicleA.propRigidBody);
    const propRes = resolveVehicleVsPropCollision(
      vehicleB.rigidBody,
      vehicleA.propRigidBody,
      vehicleB.position,
      vehicleB.velocity,
      vehicleB.angularVelocity,
    );
    if (propRes.contactCount > 0) {
      syncPropBodyToRig(vehicleA.propRigidBody, vehicleA);
      result.contactCount = propRes.contactCount;
      result.maxImpulse = propRes.maxImpulse;
      result.lastContactWorldPos = vehicleA.position.clone();
    }
    return result;
  }

  // Reset per-step penetration tracking before evaluating the pair
  vehicleA.rigidBody.maxStepPenetration = 0;
  vehicleB.rigidBody.maxStepPenetration = 0;
  vehicleA.rigidBody.hardEjectionImpulseAppliedThisStep = false;
  vehicleB.rigidBody.hardEjectionImpulseAppliedThisStep = false;

  // Maintain any active sticky welds from previous frames
  result.stickyWeldsActive += maintainStickyWeldedConnections(vehicleA, vehicleB);
  result.stickyWeldsActive += maintainStickyWeldedConnections(vehicleB, vehicleA);

  // BUG A.2 & BUG A.3: Batch all voxel destruction across the pair so BFS connectivity and mass recalculation run at most ONCE per vehicle!
  beginDestructionBatch();
  try {
    // 1. Test A's collision points vs B's voxelMap
    runOneWayPointVsVoxelGrid(vehicleA, vehicleB, debrisSystem, result, true);

    // 2. Test B's collision points vs A's voxelMap
    runOneWayPointVsVoxelGrid(vehicleB, vehicleA, debrisSystem, result, false);
  } finally {
    flushDestructionBatch();
  }

  // FIX 3: If either vehicle was in `isEjecting` state and its max penetration this step has now dropped below < 0.1m,
  // clear `isEjecting = false` so normal surface damage resumes on subsequent frames!
  vehicleA.rigidBody.updateEjectionStateAfterStep();
  vehicleB.rigidBody.updateEjectionStateAfterStep();

  if (result.contactCount > 0 && debrisSystem && result.lastContactWorldPos) {
    debrisSystem.wakeSleepingDebrisNear(
      result.lastContactWorldPos,
      PHYSICS_CONFIG.debris.wakeRadiusMeters,
      vehicleA.velocity,
    );
  }

  return result;
}

/**
 * Runs the full Step 2.1 Broadphase + Step 2.2 Narrowphase + Step 2.3/2.4 Impulse & Destruction pipeline
 * across all vehicles in the scene, with end-of-frame batched BFS structural integrity and mass recalculation (BUG A).
 */
export function stepAllVehicleCollisions(
  vehicles: readonly VehicleCollisionRuntimeTarget[],
  broadphase: SpatialHashBroadphase<any>,
  debrisSystem?: VoxelDebrisSystem | null,
): VehiclePairNarrowphaseResult[] {
  const candidatePairs = broadphase.findOverlappingPairs(
    vehicles,
  ) as Array<{
    vehicleA: VehicleCollisionRuntimeTarget;
    vehicleB: VehicleCollisionRuntimeTarget;
  }>;
  const results: VehiclePairNarrowphaseResult[] = [];

  if (candidatePairs.length === 0) {
    return results;
  }

  beginDestructionBatch();
  try {
    for (let i = 0; i < candidatePairs.length; i++) {
      const pair = candidatePairs[i];
      const res = resolveVehiclePairNarrowphase(
        pair.vehicleA,
        pair.vehicleB,
        debrisSystem,
      );
      if (res.contactCount > 0 || res.stickyWeldsActive > 0) {
        const hitEntity = pair.vehicleA.isVoxelEntity
          ? pair.vehicleA
          : pair.vehicleB.isVoxelEntity
            ? pair.vehicleB
            : null;
        if (hitEntity) {
          // Wake any sleeping props stacked above or adjacent to the impacted prop so crate stacks scatter!
          const hx = hitEntity.position.x;
          const hy = hitEntity.position.y;
          const hz = hitEntity.position.z;
          for (let j = 0; j < vehicles.length; j++) {
            const other = vehicles[j];
            if (other === hitEntity || !other.isVoxelEntity || !other.rigidBody.isSleeping) {
              continue;
            }
            if (
              Math.abs(other.position.x - hx) <= 2.2 &&
              Math.abs(other.position.z - hz) <= 2.2 &&
              other.position.y - hy >= -0.5 &&
              other.position.y - hy <= 4.5
            ) {
              other.rigidBody.wake();
              if (other.propRigidBody) {
                other.propRigidBody.wake();
              }
            }
          }
        }
        if (res.lastContactWorldPos) {
          if (res.voxelsDestroyedOnA > 0) {
            pair.vehicleA.lastDamageImpactWorld = res.lastContactWorldPos.clone();
          }
          if (res.voxelsDestroyedOnB > 0) {
            pair.vehicleB.lastDamageImpactWorld = res.lastContactWorldPos.clone();
          }
        }
        results.push(res);
      }
    }
  } finally {
    flushDestructionBatch();
  }

  return results;
}
