import * as THREE from 'three';
import { WATER_LEVEL } from '../constants.ts';
import { PHYSICS_CONFIG } from './physicsConfig.ts';
import type { CustomRigidBody } from './customRigidBody.ts';
import type { SampledCollisionPoint } from './collisionPoints.ts';

export interface WavePhysicsSample {
  rawH: number;
  terracedH: number;
  slopeX: number;
  slopeZ: number;
  orbitalVx: number;
  orbitalVy: number;
  orbitalVz: number;
  foam?: number;
  colorIndex?: number;
}

export interface WaveSampleWorldLike {
  isWaterAt?: (wx: number, wy: number, wz: number) => boolean;
  sampleWavePhysicsAt: (
    wx: number,
    wz: number,
    out?: any,
  ) => WavePhysicsSample;
}

export interface BasicBuoyancyStepResult {
  submergedPointCount: number;
  maxDepthMeters: number;
  totalUpwardBuoyancyForce: number;
}

const _worldUp = new THREE.Vector3(0, 1, 0);
const _relPos = new THREE.Vector3();
const _pointWorld = new THREE.Vector3();
const _pointVel = new THREE.Vector3();
const _pointForce = new THREE.Vector3();
const _thrustVec = new THREE.Vector3();
const _verticalComponent = new THREE.Vector3();
const _horizontalComponent = new THREE.Vector3();
const _reactionTorque = new THREE.Vector3();
const _waveSampleScratch: WavePhysicsSample = {
  rawH: 0,
  terracedH: 0,
  slopeX: 0,
  slopeZ: 0,
  orbitalVx: 0,
  orbitalVy: 0,
  orbitalVz: 0,
  foam: 0,
};

interface SubmergedContactScratch {
  worldX: number;
  worldY: number;
  worldZ: number;
  velX: number;
  velY: number;
  velZ: number;
  depth: number;
  rawUpwardForce: number;
}

const _submergedScratch: SubmergedContactScratch[] = [];

/**
 * STEP 3a.1 — BASIC BUOYANCY (float on Gerstner waves)
 *
 * For each vehicle collision point that's at or below the wave height at its XZ position:
 * 1. Compute wave height using existing `sampleWavePhysicsAt(worldX, worldZ)` from the Gerstner wave system
 * 2. Compute `depth = waveHeight - pointWorldY`
 * 3. If `depth > 0`: apply upward force proportional to depth (`F = 1000 * depth * 9.81`, water density)
 * 4. Apply small drag force opposing the point's velocity through water (`coefficient 0.5`)
 * 5. Boats naturally bob on waves and pitch/roll across waves; cars without buoyancy (`hasBuoyancy = false`) sink slowly.
 */
export function stepVehicleBasicBuoyancy(
  body: CustomRigidBody,
  world: WaveSampleWorldLike,
  options?: {
    hasBuoyancy?: boolean;
    waterLevel?: number;
    isSubmarine?: boolean;
    ballastTrim?: number; // -1.0 = Flooded/Dive, 0.0 = Neutral Hover, +1.0 = Blown/Surface
  },
): BasicBuoyancyStepResult {
  const result: BasicBuoyancyStepResult = {
    submergedPointCount: 0,
    maxDepthMeters: 0,
    totalUpwardBuoyancyForce: 0,
  };

  const points = body.collisionPoints;
  const numPoints = points.length;
  if (numPoints === 0) {
    return result;
  }

  const cfg = PHYSICS_CONFIG.buoyancy;
  const hasBuoyancy = options?.hasBuoyancy ?? true;
  const baseWaterLevel = options?.waterLevel ?? WATER_LEVEL;
  const isSubmarine = options?.isSubmarine ?? false;
  const ballastTrim = options?.ballastTrim ?? 1.0;

  // Fast body-level early exit when the entire rigid body is high above maximum ocean wave crests
  if (body.position.y > baseWaterLevel + 16.0) {
    return result;
  }

  _submergedScratch.length = 0;
  let rawTotalUpward = 0;

  for (let i = 0; i < numPoints; i++) {
    const pt = points[i] as SampledCollisionPoint;
    _relPos.copy(pt.localPos).applyQuaternion(body.quaternion);
    _pointWorld.addVectors(body.position, _relPos);

    // Fast point-level early exit before any voxel chunk lookup
    if (_pointWorld.y > baseWaterLevel + 6.5) {
      continue;
    }

    if (
      world.isWaterAt &&
      !world.isWaterAt(_pointWorld.x, baseWaterLevel - 0.15, _pointWorld.z)
    ) {
      continue;
    }

    // 1. Compute wave height using existing sampleWavePhysicsAt(worldX, worldZ) from the Gerstner wave system
    const waveSample = world.sampleWavePhysicsAt(
      _pointWorld.x,
      _pointWorld.z,
      _waveSampleScratch,
    );
    const waveHeight =
      baseWaterLevel + Math.max(waveSample.rawH, waveSample.terracedH);

    // 2. Compute depth = waveHeight - pointWorldY
    const depth = waveHeight - _pointWorld.y;
    if (depth <= 0) {
      continue;
    }

    result.submergedPointCount++;
    if (depth > result.maxDepthMeters) {
      result.maxDepthMeters = depth;
    }

    // 3. Upward force proportional to depth: F = 1000 * depth * 9.81 (water density)
    // For active submarines diving/hovering underwater, clamp per-point displacement depth
    // so deep ocean dives maintain true Archimedes constant-volume displacement!
    const effectiveDepth =
      isSubmarine && ballastTrim <= 0.15 ? Math.min(depth, 0.9) : depth;
    const rawUpwardForce = cfg.waterDensityKgM3 * effectiveDepth * cfg.gravityMPS2;
    rawTotalUpward += rawUpwardForce;

    body.velocityAtPoint(_pointWorld, _pointVel);
    // Relative velocity of point through oscillating water (attenuates exponentially with depth)
    const orbitalAtten = Math.exp(-Math.max(0, depth - 1.5) * 0.25) * 0.35;
    const relVx = _pointVel.x - waveSample.orbitalVx * orbitalAtten;
    const relVy = _pointVel.y - waveSample.orbitalVy * orbitalAtten;
    const relVz = _pointVel.z - waveSample.orbitalVz * orbitalAtten;

    _submergedScratch.push({
      worldX: _pointWorld.x,
      worldY: _pointWorld.y,
      worldZ: _pointWorld.z,
      velX: relVx,
      velY: relVy,
      velZ: relVz,
      depth,
      rawUpwardForce,
    });
  }

  if (_submergedScratch.length === 0) {
    return result;
  }

  if (body.isSleeping) {
    body.wake();
  }

  // 5. If vehicle has no buoyancy (e.g., land car without float/boat hull), cap total upward force
  // below vehicle weight (0.65 * mass * g) so it slowly sinks instead of floating like a boat!
  let upwardScale = 1.0;
  if (!hasBuoyancy) {
    const maxNonBuoyantUpward =
      body.mass * cfg.gravityMPS2 * cfg.nonBuoyantSinkScale;
    if (rawTotalUpward > maxNonBuoyantUpward && rawTotalUpward > 1e-6) {
      upwardScale = maxNonBuoyantUpward / rawTotalUpward;
    }
  } else if (isSubmarine && ballastTrim <= 0.15 && rawTotalUpward > 1e-6) {
    // Submarine active ballast control:
    // ballastTrim === 0.0 -> Exact neutral buoyancy (totalUpwardForce = 1.0 * mass * g) so submarine hovers at any depth!
    // ballastTrim < 0.0   -> Flooded ballast tanks (negative buoyancy) so submarine dives smoothly into the abyss!
    const targetSubUpward =
      body.mass * cfg.gravityMPS2 * Math.max(0.25, 1.0 + ballastTrim * 0.65);
    upwardScale = targetSubUpward / rawTotalUpward;
  } else {
    // Normalize excessive multi-point hydrostatic force when a hull has many sampled points (> 8)
    // while keeping standard 4-8 point hulls at full F = 1000 * depth * 9.81
    const pointNorm = _submergedScratch.length > 6 ? 6 / _submergedScratch.length : 1.0;
    upwardScale = pointNorm;
  }

  // 4. Apply upward force + water drag force opposing the point's velocity through water (coefficient 0.5)
  const dragCoeff = cfg.waterDragCoefficient; // 0.5
  const dragScale = hasBuoyancy
    ? dragCoeff * Math.max(body.mass / Math.max(2, _submergedScratch.length), cfg.waterDensityKgM3 * 0.55)
    : dragCoeff * Math.max(15.0, body.mass / Math.max(4, _submergedScratch.length));

  for (let i = 0; i < _submergedScratch.length; i++) {
    const sc = _submergedScratch[i];
    const fUp = sc.rawUpwardForce * upwardScale;

    // Small drag force opposing the point's velocity through water (coefficient 0.5)
    const dragFx = -dragScale * sc.velX * 0.35;
    const dragFy = -dragScale * sc.velY * (isSubmarine && ballastTrim === 0 ? 1.65 : 1.0);
    const dragFz = -dragScale * sc.velZ * 0.35;

    _pointForce.set(dragFx, fUp + dragFy, dragFz);
    _pointWorld.set(sc.worldX, sc.worldY, sc.worldZ);
    body.applyForceAtPoint(_pointForce, _pointWorld);

    result.totalUpwardBuoyancyForce += fUp;
  }

  return result;
}

export interface RotorPhysicsStepOutput {
  thrustVector: THREE.Vector3;
  verticalComponent: THREE.Vector3;
  horizontalComponent: THREE.Vector3;
  reactionTorque: THREE.Vector3;
}

/**
 * STEP 3a.2 — BASIC ROTOR PHYSICS (thrust + torque + sideways force)
 *
 * For each rotor module on a vehicle:
 * 1. Compute rotor normal (rotor's UP axis in world space, transformed by rotor's yaw/pitch/roll)
 * 2. Thrust force = `rotorNormal * throttle * rotorPower` (default 8000 N per rotor)
 * 3. Apply thrust at the rotor's world position (creates both force AND torque — high-mounted rotors cause pitch)
 * 4. Apply reaction torque: opposite of rotor spin axis `* throttle * rotorPower * 0.3`
 *    (this is what makes helis spin without tail rotor)
 * 5. DECOMPOSE THRUST INTO COMPONENTS:
 *    - `vertical = thrust . world_up_axis`
 *    - `horizontal = thrust - (vertical * world_up_axis)`
 *    - Apply BOTH components to the vehicle body at the rotor position.
 */
export function stepRotorModulePhysics(
  body: CustomRigidBody,
  rotorWorldPos: THREE.Vector3,
  rotorNormalWorld: THREE.Vector3,
  throttle: number,
  rotorPowerNewtons = PHYSICS_CONFIG.rotor.defaultPowerNewtons,
): RotorPhysicsStepOutput {
  if (Math.abs(throttle) > 1e-5 && body.isSleeping) {
    body.wake();
  }

  // 1 & 2. Thrust force = rotor normal * throttle * rotor power (default 8000 N per rotor)
  _thrustVec
    .copy(rotorNormalWorld)
    .normalize()
    .multiplyScalar(throttle * rotorPowerNewtons);

  // 5. Decompose thrust into vertical and horizontal components:
  // vertical = (thrust . world_up_axis) * world_up_axis
  // horizontal = thrust - (vertical * world_up_axis)
  const verticalScalar = _thrustVec.dot(_worldUp);
  _verticalComponent.copy(_worldUp).multiplyScalar(verticalScalar);
  _horizontalComponent.copy(_thrustVec).sub(_verticalComponent);

  // 3 & 5. Apply BOTH components to the vehicle body at the rotor's world position
  body.applyForceAtPoint(_verticalComponent, rotorWorldPos);
  body.applyForceAtPoint(_horizontalComponent, rotorWorldPos);

  // 4. Apply reaction torque: opposite of rotor spin axis * throttle * rotor power * 0.3
  const reactionMag =
    throttle * rotorPowerNewtons * PHYSICS_CONFIG.rotor.reactionTorqueFactor;
  _reactionTorque
    .copy(rotorNormalWorld)
    .normalize()
    .multiplyScalar(-reactionMag);
  body.applyTorque(_reactionTorque);

  return {
    thrustVector: _thrustVec.clone(),
    verticalComponent: _verticalComponent.clone(),
    horizontalComponent: _horizontalComponent.clone(),
    reactionTorque: _reactionTorque.clone(),
  };
}

/**
 * STEP 3a.3 — JET PHYSICS (verify)
 *
 * Each jet module produces thrust along the jet's forward axis `* throttle * power` (default 15000 N per jet),
 * applied at the jet's world position (back jets push forward, front jets flip backward), with NO reaction torque.
 */
export function stepJetModulePhysics(
  body: CustomRigidBody,
  jetWorldPos: THREE.Vector3,
  jetForwardWorld: THREE.Vector3,
  throttle: number,
  jetPowerNewtons = PHYSICS_CONFIG.jet.defaultPowerNewtons,
): THREE.Vector3 {
  if (Math.abs(throttle) > 1e-5 && body.isSleeping) {
    body.wake();
  }

  _thrustVec
    .copy(jetForwardWorld)
    .normalize()
    .multiplyScalar(throttle * jetPowerNewtons);

  // Apply at the jet's world position (no reaction torque from jets)
  body.applyForceAtPoint(_thrustVec, jetWorldPos);
  return _thrustVec.clone();
}
