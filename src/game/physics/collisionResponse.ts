import * as THREE from 'three';
import { MAT } from '../constants.ts';
import {
  MaterialType,
  PHYSICS_CONFIG,
  getMaterialFrictionProfile,
  mapVoxelMatToMaterialType,
} from './physicsConfig.ts';
import type {
  RigidBodyCore,
  CustomRigidBody,
  RigidBodyCollisionPoint,
} from './customRigidBody.ts';
import { unpackVoxelKey, type SampledCollisionPoint } from './collisionPoints.ts';
import {
  applyDamageToVoxel,
  computeCollisionVoxelDamage,
  destroyVoxel,
  type DestructibleVehicle,
} from './destruction.ts';
import type { VoxelDebrisSystem } from './debris.ts';

/** Baumgarte stabilization constants (80% per-frame position correction above 0.01m slop, capped at 0.5m per frame) */
export const BAUMGARTE_MIN_PENETRATION_METERS = 0.01;
export const BAUMGARTE_CORRECTION_FACTOR = 0.8;
export const BAUMGARTE_MAX_FRAME_CORRECTION_METERS = 0.5;

/** FIX 1 & FIX 3: Hard Ejection constants for deep penetration (> 0.5m) */
export const HARD_EJECTION_PENETRATION_METERS = 0.5;
export const HARD_EJECTION_CLEAR_PENETRATION_METERS = 0.1;
export const HARD_EJECTION_CORRECTION_FACTOR = 1.0;
export const HARD_EJECTION_BOUNCE_SPEED_MPS = 5.0;

export interface CollisionContactInput {
  vehicleA: DestructibleVehicle;
  vehicleB: DestructibleVehicle;
  pointA: RigidBodyCollisionPoint | SampledCollisionPoint;
  pointWorldPos: THREE.Vector3;
  voxelBKey: number;
  voxelBWorldCenter: THREE.Vector3;
  voxelBRawMat: number;
  penetrationDepth?: number;
  /** Optional ground/surface Y at the contact point's XZ position for computing vertical penetration depth */
  groundYAtPointXZ?: number;
  /** Optional explicit world-space surface normal (e.g. upward deck or ramp bevel normal on vehicleB's voxel grid) */
  surfaceNormalOverride?: THREE.Vector3 | null;
  debrisSystem?: VoxelDebrisSystem | null;
}

export interface CollisionResponseResult {
  normal: THREE.Vector3;
  normalImpulseMagnitude: number;
  tangentialImpulseMagnitude: number;
  totalImpulseOnA: THREE.Vector3;
  /** Position-based Baumgarte or Hard Ejection correction applied to vehicleA this contact (in meters) */
  positionCorrectionOnA: THREE.Vector3;
  damageAppliedToB: number;
  damageAppliedToA: number;
  voxelBDestroyed: boolean;
  voxelADestroyed: boolean;
  stickyLatched: boolean;
  /** FIX 1: True when penetration > 0.5m triggered a hard ejection on this contact */
  hardEjected?: boolean;
  /** FIX 3: True when damage & voxel destruction were suppressed due to active hard ejection */
  damageSuppressed?: boolean;
}

// Pre-allocated scratch vectors for zero-GC collision impulse & Baumgarte position resolution
const _normal = new THREE.Vector3();
const _velA = new THREE.Vector3();
const _velB = new THREE.Vector3();
const _vRel = new THREE.Vector3();
const _vTangential = new THREE.Vector3();
const _tangentDir = new THREE.Vector3();
const _forwardA = new THREE.Vector3();
const _forwardB = new THREE.Vector3();
const _rightA = new THREE.Vector3();
const _totalImpulse = new THREE.Vector3();
const _armA = new THREE.Vector3();
const _armB = new THREE.Vector3();
const _torqueImpulse = new THREE.Vector3();
const _localTorque = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _desiredPosCorr = new THREE.Vector3();
const _summedPosCorr = new THREE.Vector3();
const _appliedPosDelta = new THREE.Vector3();
const _defaultBaumgarteDelta = new THREE.Vector3();
const _defaultMultiPointDelta = new THREE.Vector3();
const _posCorrOnATmp = new THREE.Vector3();

function applyAngularImpulseFromTorque(
  body: RigidBodyCore,
  worldTorqueImpulse: THREE.Vector3,
): void {
  _invQuat.copy(body.quaternion).invert();
  _localTorque.copy(worldTorqueImpulse).applyQuaternion(_invQuat);
  _localTorque.multiply(body.invInertiaTensor);
  _localTorque.applyQuaternion(body.quaternion);
  body.angularVelocity.add(_localTorque);
}

/**
 * Applies Baumgarte position-based stabilization to a vehicle/rigid-body for a single penetrating contact:
 * - Only applies when `penetrationDepth > 0.01m`
 * - Moves position along `normal` by `penetrationDepth * 0.8 * weight`
 * - Sums corrections across multiple simultaneous contact points on `body` and caps total per-frame correction at `0.5m`
 *   so many disagreeing or simultaneously penetrating points never teleport the vehicle through a wall.
 */
export function applyBaumgartePositionCorrection(
  body: RigidBodyCore,
  syncPositionTarget: THREE.Vector3 | undefined,
  normal: THREE.Vector3,
  penetrationDepth: number,
  weight = 1.0,
  outDelta = _defaultBaumgarteDelta,
): THREE.Vector3 {
  outDelta.set(0, 0, 0);
  const slop =
    PHYSICS_CONFIG.collisionResponse.baumgarteSlopMeters ??
    BAUMGARTE_MIN_PENETRATION_METERS;
  if (penetrationDepth <= slop || weight <= 0) {
    return outDelta;
  }

  const factor =
    PHYSICS_CONFIG.collisionResponse.baumgarteFactor ??
    BAUMGARTE_CORRECTION_FACTOR;
  const maxCap =
    PHYSICS_CONFIG.collisionResponse.maxFramePositionCorrectionMeters ??
    BAUMGARTE_MAX_FRAME_CORRECTION_METERS;

  const corrMag = penetrationDepth * factor * weight;
  _desiredPosCorr.copy(normal).multiplyScalar(corrMag);

  const prevAccum = body.framePositionCorrection;
  _summedPosCorr.addVectors(prevAccum, _desiredPosCorr);
  const summedLen = _summedPosCorr.length();
  if (summedLen > maxCap && summedLen > 1e-6) {
    _summedPosCorr.multiplyScalar(maxCap / summedLen);
  }

  outDelta.subVectors(_summedPosCorr, prevAccum);
  prevAccum.copy(_summedPosCorr);

  body.position.add(outDelta);
  if (syncPositionTarget && syncPositionTarget !== body.position) {
    syncPositionTarget.copy(body.position);
  }
  return outDelta;
}

/**
 * Sums Baumgarte position corrections (`normal * penetration * 0.8`) across multiple simultaneously
 * penetrating contact points and caps the total per-frame position correction at `0.5m`.
 */
export function applyMultiPointBaumgarteCorrection(
  body: CustomRigidBody,
  syncPositionTarget: THREE.Vector3 | undefined,
  contacts: ReadonlyArray<{
    normal: { x: number; y: number; z: number };
    penetrationDepth: number;
  }>,
  outTotalDelta = _defaultMultiPointDelta,
): THREE.Vector3 {
  outTotalDelta.set(0, 0, 0);
  const slop =
    PHYSICS_CONFIG.collisionResponse.baumgarteSlopMeters ??
    BAUMGARTE_MIN_PENETRATION_METERS;
  const factor =
    PHYSICS_CONFIG.collisionResponse.baumgarteFactor ??
    BAUMGARTE_CORRECTION_FACTOR;
  const maxCap =
    PHYSICS_CONFIG.collisionResponse.maxFramePositionCorrectionMeters ??
    BAUMGARTE_MAX_FRAME_CORRECTION_METERS;

  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    if (c.penetrationDepth <= slop) continue;
    const stepMag = c.penetrationDepth * factor;
    outTotalDelta.x += c.normal.x * stepMag;
    outTotalDelta.y += c.normal.y * stepMag;
    outTotalDelta.z += c.normal.z * stepMag;
  }

  const prevAccum = body.framePositionCorrection;
  _summedPosCorr.addVectors(prevAccum, outTotalDelta);
  const summedLen = _summedPosCorr.length();
  if (summedLen > maxCap && summedLen > 1e-6) {
    _summedPosCorr.multiplyScalar(maxCap / summedLen);
  }

  outTotalDelta.subVectors(_summedPosCorr, prevAccum);
  prevAccum.copy(_summedPosCorr);

  body.position.add(outTotalDelta);
  if (syncPositionTarget && syncPositionTarget !== body.position) {
    syncPositionTarget.copy(body.position);
  }
  return outTotalDelta;
}

/**
 * Step 2.3: Impulse Resolution with Anisotropic Friction, Baumgarte Position Stabilization,
 * Hard Ejection for Deep Penetration (FIX 1), Cavity Rolling Friction Boost (FIX 2),
 * Damage Suppression During Ejection (FIX 3), Crunchy Destruction, and Sticky Latching.
 */
export function resolvePointVoxelCollision(
  input: CollisionContactInput,
): CollisionResponseResult {
  const {
    vehicleA,
    vehicleB,
    pointA,
    pointWorldPos,
    voxelBKey,
    voxelBWorldCenter,
    voxelBRawMat,
    penetrationDepth,
    groundYAtPointXZ,
    surfaceNormalOverride,
    debrisSystem = null,
  } = input;

  const bodyA = vehicleA.rigidBody;
  const bodyB = vehicleB.rigidBody;

  // 1. Compute collision normal: use explicit voxel surface/ramp bevel normal if provided, otherwise direction from B's voxel center to P's world position
  if (surfaceNormalOverride && surfaceNormalOverride.lengthSq() > 1e-6) {
    _normal.copy(surfaceNormalOverride).normalize();
  } else {
    _normal.subVectors(pointWorldPos, voxelBWorldCenter);
    if (_normal.lengthSq() < 1e-6) {
      _normal.subVectors(bodyA.position, bodyB.position);
      if (_normal.lengthSq() < 1e-6) {
        _normal.set(0, 0, 1);
      }
    }
    _normal.normalize();
  }

  // Compute penetration depth first so we can distinguish surface contact (<= 0.5m) from deep penetration (> 0.5m)
  let resolvedPenetration = 0;
  if (typeof groundYAtPointXZ === 'number' && Number.isFinite(groundYAtPointXZ)) {
    resolvedPenetration = Math.abs(pointWorldPos.y - groundYAtPointXZ);
  } else if (typeof penetrationDepth === 'number' && Number.isFinite(penetrationDepth)) {
    resolvedPenetration = penetrationDepth;
  } else {
    resolvedPenetration = Math.max(
      0,
      0.25 - pointWorldPos.distanceTo(voxelBWorldCenter),
    );
  }

  // Record contact penetration on both bodies to update `isEjecting` state (FIX 1 & FIX 3)
  bodyA.recordContactPenetration(resolvedPenetration);
  bodyB.recordContactPenetration(resolvedPenetration);

  const totalInvMass = Math.max(1e-6, bodyA.invMass + bodyB.invMass);
  const weightA = bodyB.invMass <= 1e-8 ? 1.0 : bodyA.invMass / totalInvMass;
  const weightB = bodyB.invMass <= 1e-8 ? 0.0 : bodyB.invMass / totalInvMass;

  const hardEjectThresh =
    PHYSICS_CONFIG.collisionResponse.hardEjectionPenetrationMeters ??
    HARD_EJECTION_PENETRATION_METERS;
  const posCorrOnA = _posCorrOnATmp.set(0, 0, 0);

  // ============================================================================
  // FIX 1: HARD EJECTION FOR DEEP PENETRATION (penetration > 0.5m)
  // 1. Do NOT use spring-damper / normal surface impulse or 0.8 Baumgarte factor.
  // 2. Move the vehicle out of the wall along the collision normal by penetration * 1.0 (full correction).
  // 3. Set the vehicle's inward velocity component to zero (kill the inward motion).
  // 4. Apply a one-time large outward impulse (mass * 5 m/s = "bounce out" velocity).
  // 5. FIX 3: Suppress all damage and voxel removal during hard ejection.
  // ============================================================================
  if (resolvedPenetration > hardEjectThresh) {
    const corrFactor =
      PHYSICS_CONFIG.collisionResponse.hardEjectionCorrectionFactor ??
      HARD_EJECTION_CORRECTION_FACTOR;
    const bounceSpeed =
      PHYSICS_CONFIG.collisionResponse.hardEjectionBounceSpeedMPS ??
      HARD_EJECTION_BOUNCE_SPEED_MPS;

    bodyA.wake();
    bodyB.wake();
    bodyA.recordCollisionEvent();
    bodyB.recordCollisionEvent();
    bodyA.isEjecting = true;
    if (bodyB.invMass > 1e-8) {
      bodyB.isEjecting = true;
    }

    // 1. Full 1.0x position correction along collision normal (accounting for any ejection shift already applied this frame along _normal)
    const targetShiftA = resolvedPenetration * corrFactor * weightA;
    const alreadyShiftedAlongNormalA = Math.max(
      0,
      bodyA.framePositionCorrection.dot(_normal),
    );
    const neededShiftA = Math.max(0, targetShiftA - alreadyShiftedAlongNormalA);
    posCorrOnA.copy(_normal).multiplyScalar(neededShiftA);
    bodyA.framePositionCorrection.add(posCorrOnA);
    bodyA.position.add(posCorrOnA);
    if (vehicleA.position && vehicleA.position !== bodyA.position) {
      vehicleA.position.copy(bodyA.position);
    }

    if (bodyB.invMass > 1e-8) {
      _desiredPosCorr.copy(_normal).negate();
      const targetShiftB = resolvedPenetration * corrFactor * weightB;
      const alreadyShiftedAlongNormalB = Math.max(
        0,
        bodyB.framePositionCorrection.dot(_desiredPosCorr),
      );
      const neededShiftB = Math.max(0, targetShiftB - alreadyShiftedAlongNormalB);
      _appliedPosDelta.copy(_desiredPosCorr).multiplyScalar(neededShiftB);
      bodyB.framePositionCorrection.add(_appliedPosDelta);
      bodyB.position.add(_appliedPosDelta);
      if (vehicleB.position && vehicleB.position !== bodyB.position) {
        vehicleB.position.copy(bodyB.position);
      }
    }

    // 2. Set the vehicle's inward velocity component to zero (kill the inward motion)
    const vInwardA = bodyA.velocity.dot(_normal);
    if (vInwardA < 0) {
      bodyA.velocity.addScaledVector(_normal, -vInwardA);
    }
    if (bodyB.invMass > 1e-8) {
      const vInwardB = bodyB.velocity.dot(_normal);
      if (vInwardB > 0) {
        bodyB.velocity.addScaledVector(_normal, -vInwardB);
      }
    }

    // 3. Apply a one-time large outward impulse (mass * 5 m/s = "bounce out" velocity)
    let jN = 0;
    _totalImpulse.set(0, 0, 0);
    if (!bodyA.hardEjectionImpulseAppliedThisStep && bodyA.invMass > 1e-8) {
      bodyA.hardEjectionImpulseAppliedThisStep = true;
      const bounceVelA = bounceSpeed * weightA;
      jN = bodyA.mass * bounceVelA;
      _totalImpulse.copy(_normal).multiplyScalar(jN);
      bodyA.velocity.addScaledVector(_normal, bounceVelA);
      bodyA.angularVelocity.multiplyScalar(0.35);
    }
    if (!bodyB.hardEjectionImpulseAppliedThisStep && bodyB.invMass > 1e-8) {
      bodyB.hardEjectionImpulseAppliedThisStep = true;
      const bounceVelB = bounceSpeed * weightB;
      if (jN === 0) {
        jN = bodyB.mass * bounceVelB;
        _totalImpulse.copy(_normal).multiplyScalar(jN);
      }
      bodyB.velocity.addScaledVector(_normal, -bounceVelB);
      bodyB.angularVelocity.multiplyScalar(0.35);
    }

    vehicleA.velocity.copy(bodyA.velocity);
    vehicleA.angularVelocity?.copy(bodyA.angularVelocity);
    vehicleB.velocity.copy(bodyB.velocity);
    vehicleB.angularVelocity?.copy(bodyB.angularVelocity);

    // FIX 3: Damage and voxel destruction are 100% suppressed during hard ejection!
    return {
      normal: _normal.clone(),
      normalImpulseMagnitude: jN,
      tangentialImpulseMagnitude: 0,
      totalImpulseOnA: _totalImpulse.clone(),
      positionCorrectionOnA: posCorrOnA,
      damageAppliedToB: 0,
      damageAppliedToA: 0,
      voxelBDestroyed: false,
      voxelADestroyed: false,
      stickyLatched: false,
      hardEjected: true,
      damageSuppressed: true,
    };
  }

  // ============================================================================
  // NORMAL SURFACE CONTACT (penetration <= 0.5m)
  // ============================================================================

  // 2. Compute relative velocity at the contact point:
  // v_rel = (A.velocityAtPoint(P) - B.velocityAtPoint(V))
  bodyA.velocityAtPoint(pointWorldPos, _velA);
  bodyB.velocityAtPoint(voxelBWorldCenter, _velB);
  _vRel.subVectors(_velA, _velB);

  // 3. Decompose v_rel into normal component (v_normal = v_rel · normal) and tangential component
  const vNormal = _vRel.dot(_normal);
  _vTangential.copy(_vRel).addScaledVector(_normal, -vNormal);

  const matA = pointA.material || MaterialType.DEFAULT;
  const matB = mapVoxelMatToMaterialType(voxelBRawMat);
  const profileA = getMaterialFrictionProfile(matA);
  const profileB = getMaterialFrictionProfile(matB);

  // Combined restitution (0 if either is sticky)
  const isSticky =
    matA === MaterialType.STICKY ||
    matB === MaterialType.STICKY ||
    Boolean(profileA.latchesOnContact) ||
    Boolean(profileB.latchesOnContact);
  const restitution = isSticky
    ? 0.0
    : Math.max(profileA.restitution, profileB.restitution);

  // 4. Apply normal impulse when approaching (v_normal < 0)
  // j_n = -(1 + restitution) * v_normal / (A.invMass + B.invMass)
  let jN = 0;
  if (vNormal < 0) {
    jN = (-(1.0 + restitution) * vNormal) / totalInvMass;
  }

  _totalImpulse.copy(_normal).multiplyScalar(jN);

  // 5. Apply tangential impulse with anisotropic friction (+ FIX 2: 5x rolling friction boost in wheel cavities)
  let jT = 0;
  const vTanLen = _vTangential.length();
  if (vTanLen > 1e-5 && jN > 0) {
    _tangentDir.copy(_vTangential).divideScalar(vTanLen);

    let mu: number;
    if (matA === MaterialType.GRIPPY) {
      // For wheels (P.material === 'grippy'): use lateral friction if tangential direction is sideways
      // relative to wheel's forward axis, otherwise use forward (rolling) friction.
      // FIX 2: When the wheel has 3+ simultaneous collision points (inside a cavity), multiply its
      // rolling friction coefficient by 5.0x so it stops climbing cavity walls and slides instead!
      const wheelRollingMult = bodyA.getWheelRollingFrictionMultiplier();
      _forwardA.set(0, 0, 1).applyQuaternion(bodyA.quaternion).normalize();
      _rightA.set(1, 0, 0).applyQuaternion(bodyA.quaternion).normalize();
      const fwdAlign = Math.abs(_tangentDir.dot(_forwardA));
      const latAlign = Math.abs(_tangentDir.dot(_rightA));
      mu =
        latAlign > fwdAlign
          ? profileA.lateralFriction
          : profileA.forwardFriction * wheelRollingMult;
    } else {
      // For other materials: use uniform friction
      mu = 0.5 * (profileA.forwardFriction + profileB.forwardFriction);
    }

    // Max tangential impulse that stops tangential slip without reversing it
    const maxStopImpulse = vTanLen / totalInvMass;
    jT = Math.max(
      -maxStopImpulse,
      Math.min(maxStopImpulse, -mu * Math.abs(jN)),
    );

    _totalImpulse.addScaledVector(_tangentDir, jT);
  }

  // Apply linear impulse:
  // A.velocity += impulse * A.invMass
  // B.velocity -= impulse * B.invMass
  if (jN > 0 || Math.abs(jT) > 0) {
    bodyA.wake();
    bodyB.wake();
    bodyA.recordCollisionEvent();
    bodyB.recordCollisionEvent();

    bodyA.velocity.addScaledVector(_totalImpulse, bodyA.invMass);
    bodyB.velocity.addScaledVector(_totalImpulse, -bodyB.invMass);

    // FIX 2: If a GRIPPY wheel is in a cavity (3+ contacts) and attempting to climb upward along a wall,
    // kill upward wall-climbing velocity so the wheel slides out horizontally instead of climbing!
    if (matA === MaterialType.GRIPPY && bodyA.isWheelInCavity() && bodyA.velocity.y > 0) {
      bodyA.velocity.y = 0;
    }

    // 6. Apply torques:
    // torque on A = (P.worldPos - A.centerOfMass) × impulse, same for B with V
    _armA.subVectors(pointWorldPos, bodyA.position);
    _torqueImpulse.crossVectors(_armA, _totalImpulse);
    applyAngularImpulseFromTorque(bodyA, _torqueImpulse);

    _armB.subVectors(voxelBWorldCenter, bodyB.position);
    _torqueImpulse.crossVectors(_armB, _totalImpulse).negate();
    applyAngularImpulseFromTorque(bodyB, _torqueImpulse);

    vehicleA.velocity.copy(bodyA.velocity);
    vehicleA.angularVelocity?.copy(bodyA.angularVelocity);
    vehicleB.velocity.copy(bodyB.velocity);
    vehicleB.angularVelocity?.copy(bodyB.angularVelocity);
  }

  // 6b. Baumgarte Position-Based Stabilization (applied AFTER normal impulse for surface contact <= 0.5m):
  // 1. If penetration > 0.01m: move vehicle position along collision normal by penetration * 0.8
  // 2. Sum corrections across multiple simultaneous contact points and cap total per-frame correction at 0.5m
  if (resolvedPenetration > BAUMGARTE_MIN_PENETRATION_METERS) {
    applyBaumgartePositionCorrection(
      bodyA,
      vehicleA.position,
      _normal,
      resolvedPenetration,
      weightA,
      posCorrOnA,
    );

    if (bodyB.invMass > 1e-8) {
      _desiredPosCorr.copy(_normal).negate();
      applyBaumgartePositionCorrection(
        bodyB,
        vehicleB.position,
        _desiredPosCorr,
        resolvedPenetration,
        weightB,
        _appliedPosDelta,
      );
    }
  }

  // ============================================================================
  // FIX 3: DAMAGE SUPPRESSION DURING EJECTION
  // While either vehicle is in the process of ejecting (`isEjecting === true`, until penetration < 0.1m),
  // do NOT apply damage to either vehicle and do NOT remove collision points (no destroyVoxel calls).
  // ============================================================================
  if (bodyA.isEjecting || bodyB.isEjecting) {
    return {
      normal: _normal.clone(),
      normalImpulseMagnitude: jN,
      tangentialImpulseMagnitude: Math.abs(jT),
      totalImpulseOnA: _totalImpulse.clone(),
      positionCorrectionOnA: posCorrOnA,
      damageAppliedToB: 0,
      damageAppliedToA: 0,
      voxelBDestroyed: false,
      voxelADestroyed: false,
      stickyLatched: false,
      hardEjected: false,
      damageSuppressed: true,
    };
  }

  // 7. Damage & Crunchy Destruction (Step 2.4):
  // If P.material === 'crunchy': trigger destruction on voxel V, plus compute impulse-based damage on both
  _forwardA.set(0, 0, 1).applyQuaternion(bodyA.quaternion).normalize();
  _forwardB.set(0, 0, 1).applyQuaternion(bodyB.quaternion).normalize();

  let damageToB = computeCollisionVoxelDamage(
    jN,
    matB,
    _normal,
    _forwardB,
    matA,
  );
  let damageToA = computeCollisionVoxelDamage(
    jN,
    matA,
    _normal,
    _forwardA,
    matB,
  );

  let voxelBDestroyed = false;
  let voxelADestroyed = false;

  const isVoxelBC4 = (voxelBRawMat & 63) === MAT.C4_EXPLOSIVE;
  if (isVoxelBC4 && jN > PHYSICS_CONFIG.collisionResponse.minDamageImpulseThreshold) {
    applyDamageToVoxel(
      vehicleB,
      voxelBKey,
      Math.max(damageToB, PHYSICS_CONFIG.c4DamageInRadius),
      pointWorldPos,
      debrisSystem,
    );
  } else if (matA === MaterialType.CRUNCHY) {
    const destB = destroyVoxel(
      vehicleB,
      voxelBKey,
      pointWorldPos,
      debrisSystem,
    );
    voxelBDestroyed = destB.destroyed;
    damageToB = Math.max(damageToB, PHYSICS_CONFIG.destruction.defaultVoxelHp);
  } else if (damageToB > 0) {
    const resB = applyDamageToVoxel(
      vehicleB,
      voxelBKey,
      damageToB,
      pointWorldPos,
      debrisSystem,
    );
    voxelBDestroyed = resB.destroyed;
  }

  if (typeof pointA.voxelKey === 'number') {
    const [avx, avy, avz] = unpackVoxelKey(pointA.voxelKey);
    const isVoxelAC4 = (vehicleA.getVoxel(avx, avy, avz) & 63) === MAT.C4_EXPLOSIVE;
    if (isVoxelAC4 && jN > PHYSICS_CONFIG.collisionResponse.minDamageImpulseThreshold) {
      applyDamageToVoxel(
        vehicleA,
        pointA.voxelKey,
        Math.max(damageToA, PHYSICS_CONFIG.c4DamageInRadius),
        voxelBWorldCenter,
        debrisSystem,
      );
    } else if (matB === MaterialType.CRUNCHY && jN > PHYSICS_CONFIG.collisionResponse.minDamageImpulseThreshold) {
      const destA = destroyVoxel(
        vehicleA,
        pointA.voxelKey,
        voxelBWorldCenter,
        debrisSystem,
      );
      voxelADestroyed = destA.destroyed;
      damageToA = Math.max(damageToA, PHYSICS_CONFIG.destruction.defaultVoxelHp);
    } else if (damageToA > 0) {
      const resA = applyDamageToVoxel(
        vehicleA,
        pointA.voxelKey,
        damageToA,
        voxelBWorldCenter,
        debrisSystem,
      );
      voxelADestroyed = resA.destroyed;
    }
  }

  // 8. If P.material === 'sticky' (or V is sticky): latch the point — set P.welded = true and store connection
  let stickyLatched = false;
  if (isSticky && !voxelADestroyed && !voxelBDestroyed) {
    pointA.welded = true;
    pointA.weldedTargetVehicleId = vehicleB.vehicleId || 'veh_b';
    pointA.weldedTargetVoxelKey = voxelBKey;
    stickyLatched = true;
  }

  return {
    normal: _normal.clone(),
    normalImpulseMagnitude: jN,
    tangentialImpulseMagnitude: Math.abs(jT),
    totalImpulseOnA: _totalImpulse.clone(),
    positionCorrectionOnA: posCorrOnA.clone(),
    damageAppliedToB: damageToB,
    damageAppliedToA: damageToA,
    voxelBDestroyed,
    voxelADestroyed,
    stickyLatched,
    hardEjected: false,
    damageSuppressed: false,
  };
}
