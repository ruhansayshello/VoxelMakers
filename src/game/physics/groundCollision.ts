import * as THREE from 'three';
import { MAT } from '../constants.ts';
import {
  MaterialType,
  PHYSICS_CONFIG,
  getMaterialFrictionProfile,
  mapVoxelMatToMaterialType,
} from './physicsConfig.ts';
import type { CustomRigidBody } from './customRigidBody.ts';
import type { SampledCollisionPoint } from './collisionPoints.ts';
import { TerrainEntity } from './terrainEntity.ts';

export interface GroundProbeWorld {
  probeGroundBelow: (
    wx: number,
    startY: number,
    wz: number,
    maxDist?: number,
  ) => { y: number; mat: number } | null;
  probeCeilingAbove?: (
    wx: number,
    wy: number,
    wz: number,
    maxDist?: number,
  ) => { y: number; mat: number } | null;
  getVoxelAtWorld?: (wx: number, wy: number, wz: number) => number;
}

export interface GroundCollisionStepResult {
  contactCount: number;
  ceilingContactCount: number;
  maxPenetration: number;
  maxImpactSpeed: number;
  /** Total upward ground normal force applied across all contact points this step (BUG B) */
  totalUpwardForce: number;
  /** Voxel keys of CRUNCHY collision points that exceeded impact threshold and should break */
  brokenCrunchyVoxelKeys: number[];
  /** Whether any STICKY voxel latched onto terrain this step */
  hasStickyLatch: boolean;
  /** Whether resting contacts snapped to rest this step (BUG 2) */
  snappedToRest?: boolean;
}

interface ActiveGroundContact {
  pt: SampledCollisionPoint;
  worldPointX: number;
  worldPointY: number;
  worldPointZ: number;
  pointVelX: number;
  pointVelY: number;
  pointVelZ: number;
  penetration: number;
  downwardSpeed: number;
  rawNormalForceY: number;
  matProfile: ReturnType<typeof getMaterialFrictionProfile>;
  terrainMatType: MaterialType;
  snapped: boolean;
}

// Pre-allocated scratch vectors for zero-GC ground collision evaluation
const _worldPoint = new THREE.Vector3();
const _relPos = new THREE.Vector3();
const _pointVel = new THREE.Vector3();
const _omegaCrossR = new THREE.Vector3();
const _forwardDir = new THREE.Vector3();
const _rightDir = new THREE.Vector3();
const _pointForce = new THREE.Vector3();
const _activeContactsScratch: ActiveGroundContact[] = [];
const _contactObjPool: ActiveGroundContact[] = [];

/**
 * Per-point voxel-tuned ground collision solver (Step 1.3 + BUG 2 + BUG 3 + BUG B).
 *
 * BUG B Fix:
 * - Normalizes total ground spring force by the number of active contact points:
 *   `normalizedPointForce = rawPerPointSpringForce / activeContactCount`
 * - Caps the total upward ground spring force per vehicle to `mass * gravity * 1.5`
 *   (unless bouncing from a high-speed fall), so small wheel-less vehicles (e.g. 1-voxel or 100-voxel cubes)
 *   never float above the ground and rest cleanly ON the ground at the exact same resting height.
 */
export function resolveVehicleGroundCollisions(
  body: CustomRigidBody,
  world: GroundProbeWorld,
  subDt: number,
  options?: {
    forwardFrictionScale?: number;
    lateralFrictionScale?: number;
    springStiffnessScale?: number;
    throttleInput?: number;
  },
): GroundCollisionStepResult {
  const result: GroundCollisionStepResult = {
    contactCount: 0,
    ceilingContactCount: 0,
    maxPenetration: 0,
    maxImpactSpeed: 0,
    totalUpwardForce: 0,
    brokenCrunchyVoxelKeys: [],
    hasStickyLatch: false,
    snappedToRest: false,
  };

  const points = body.collisionPoints;
  const numPoints = points.length;
  if (numPoints === 0 || subDt <= 0 || body.isSleeping) {
    return result;
  }

  // Compute vehicle horizontal forward and right basis vectors for anisotropic friction
  _forwardDir.set(0, 0, 1).applyQuaternion(body.quaternion);
  _forwardDir.y = 0;
  if (_forwardDir.lengthSq() < 1e-6) {
    _forwardDir.set(0, 0, 1);
  } else {
    _forwardDir.normalize();
  }

  _rightDir.set(1, 0, 0).applyQuaternion(body.quaternion);
  _rightDir.y = 0;
  if (_rightDir.lengthSq() < 1e-6) {
    _rightDir.set(1, 0, 0);
  } else {
    _rightDir.normalize();
  }

  const cfg = PHYSICS_CONFIG.groundCollision;
  const G = Math.abs(PHYSICS_CONFIG.gravity.y); // 9.81
  // Verify spring rest length is strictly 0 so the spring is never compressed at rest (BUG 2)
  const restLength = cfg.restLength; // 0
  const springScale = options?.springStiffnessScale ?? 1.0;

  // Mass-proportional stiffness scaled to PHYSICS_CONFIG.groundCollision.springStiffnessPerPoint
  // so after dividing by activeForceContactCount, a 1-voxel cube and a 100-voxel cube both settle
  // with ~4mm resting compression (< 0.01m snap-to-rest threshold) right on the ground surface!
  const stiffnessCfgScale = cfg.springStiffnessPerPoint / 6160.0;
  const damperCfgScale = cfg.damperCoefficientPerPoint / 1170.0;
  const kSpring =
    body.mass * G * 250.0 * stiffnessCfgScale * springScale;
  const kDamper =
    2.0 * Math.sqrt(kSpring * body.mass) * 0.85 * damperCfgScale;

  const hasExplicitZeroThrottle =
    options?.throttleInput !== undefined &&
    Math.abs(options.throttleInput) < 1e-4;
  const throttleAbs = Math.abs(options?.throttleInput ?? 0);
  const idleRollingBoost = hasExplicitZeroThrottle
    ? cfg.idleRollingFrictionMultiplier
    : 1.0;
  const fwdScale = (options?.forwardFrictionScale ?? 1.0) * idleRollingBoost;
  const latScale = (options?.lateralFrictionScale ?? 1.0) * idleRollingBoost;

  const linSpeed = body.velocity.length();
  const hasRecentCollision =
    body.timeSinceLastCollision < cfg.recentCollisionWindowSec;

  let maxPosCorrectionY = 0;
  let snappedPointsCount = 0;
  let activeForceContactCount = 0;
  let grippyContactCount = 0;
  let rawTotalUpwardForce = 0;
  _activeContactsScratch.length = 0;

  // PASS 1: Gather all contacting ground points and compute raw per-point spring-damper force
  for (let i = 0; i < numPoints; i++) {
    const pt = points[i] as SampledCollisionPoint;

    // 1. Transform localPos (relative to CoM) to world space
    _relPos.copy(pt.localPos).applyQuaternion(body.quaternion);
    _worldPoint.addVectors(body.position, _relPos);

    // 2. Probe ground height at (worldPoint.x, worldPoint.z) against both static terrain AND active TerrainEntities
    const probeStartY = _worldPoint.y;
    let groundHit = world.probeGroundBelow(
      _worldPoint.x,
      probeStartY,
      _worldPoint.z,
      0.45,
    );
    const terrainEntHit = TerrainEntity.probeSurfaceBelow(
      _worldPoint.x,
      probeStartY,
      _worldPoint.z,
      0.45,
    );
    if (terrainEntHit && (!groundHit || terrainEntHit.y > groundHit.y)) {
      groundHit = terrainEntHit;
    }
    if (!groundHit || groundHit.mat === MAT.WATER_VOX) {
      continue;
    }

    // Round ground height query to nearest 0.01m to avoid floating-point false slope bugs (BUG 3)
    const groundY = Math.round(groundHit.y * 100) / 100;
    const restSurfaceY = groundY + restLength;
    // 3. Check if point's world Y is below restSurfaceY
    if (_worldPoint.y >= restSurfaceY) {
      continue;
    }

    // 4. Compute penetration depth = (groundY + restLength) - pointY
    const rawPenetration = restSurfaceY - _worldPoint.y;
    // Ignore walls or overhangs > 0.5m above the point (treated as wall/ceiling, not floor)
    if (rawPenetration > 0.5) {
      continue;
    }

    const penetration = Math.min(cfg.maxPenetrationMeters, rawPenetration);
    result.contactCount++;
    if (pt.material === MaterialType.GRIPPY) {
      grippyContactCount++;
    }
    if (penetration > result.maxPenetration) {
      result.maxPenetration = penetration;
    }

    // BUG 2 "Snap to rest" threshold:
    // When penetration < 0.01m AND linear velocity < 0.05 m/s AND no recent collision,
    // set velocity to zero and skip spring force!
    if (
      penetration < cfg.snapToRestPenetration &&
      linSpeed < cfg.snapToRestSpeedMPS &&
      !hasRecentCollision &&
      throttleAbs < 1e-4
    ) {
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      snappedPointsCount++;
      result.snappedToRest = true;
      continue;
    }

    // Compute velocity at contact point: v_point = v + ω × r
    _omegaCrossR.crossVectors(body.angularVelocity, _relPos);
    _pointVel.addVectors(body.velocity, _omegaCrossR);

    const downwardSpeed = Math.max(0, -_pointVel.y);
    if (downwardSpeed > result.maxImpactSpeed) {
      result.maxImpactSpeed = downwardSpeed;
    }

    const matProfile = getMaterialFrictionProfile(
      pt.material || MaterialType.DEFAULT,
    );
    const terrainMatType = mapVoxelMatToMaterialType(groundHit.mat);
    const terrainProfile = getMaterialFrictionProfile(terrainMatType);

    const restitution = Math.max(
      matProfile.restitution,
      terrainProfile.restitution * 0.5,
    );

    // 5. Raw per-point upward spring-damper force proportional to penetration depth (restLength === 0)
    let rawNormalForceY = kSpring * penetration;
    if (_pointVel.y < 0) {
      rawNormalForceY += kDamper * -_pointVel.y * (1.0 + restitution);
    } else {
      rawNormalForceY -= kDamper * 0.65 * (1.0 - restitution) * _pointVel.y;
    }
    rawNormalForceY = Math.max(0, rawNormalForceY);

    activeForceContactCount++;
    rawTotalUpwardForce += rawNormalForceY;

    const contactIdx = _activeContactsScratch.length;
    let contactObj = _contactObjPool[contactIdx];
    if (!contactObj) {
      contactObj = {
        pt,
        worldPointX: _worldPoint.x,
        worldPointY: _worldPoint.y,
        worldPointZ: _worldPoint.z,
        pointVelX: _pointVel.x,
        pointVelY: _pointVel.y,
        pointVelZ: _pointVel.z,
        penetration,
        downwardSpeed,
        rawNormalForceY,
        matProfile,
        terrainMatType,
        snapped: false,
      };
      _contactObjPool[contactIdx] = contactObj;
    } else {
      contactObj.pt = pt;
      contactObj.worldPointX = _worldPoint.x;
      contactObj.worldPointY = _worldPoint.y;
      contactObj.worldPointZ = _worldPoint.z;
      contactObj.pointVelX = _pointVel.x;
      contactObj.pointVelY = _pointVel.y;
      contactObj.pointVelZ = _pointVel.z;
      contactObj.penetration = penetration;
      contactObj.downwardSpeed = downwardSpeed;
      contactObj.rawNormalForceY = rawNormalForceY;
      contactObj.matProfile = matProfile;
      contactObj.terrainMatType = terrainMatType;
      contactObj.snapped = false;
    }
    _activeContactsScratch.push(contactObj);

    // Track position Baumgarte-style slop correction to prevent deep sinking
    if (penetration > cfg.positionCorrectionSlop) {
      const corr =
        (penetration - cfg.positionCorrectionSlop) *
        cfg.positionCorrectionPercent;
      if (corr > maxPosCorrectionY) {
        maxPosCorrectionY = corr;
      }
    }
  }

  // FIX 2: Update active wheel contact count on the rigid body for cavity detection (3+ simultaneous contacts -> 5.0x rolling friction)
  const wheelRollingFrictionMult = body.setWheelActiveContacts(
    0,
    grippyContactCount,
  );

  // PASS 2 (BUG B): Normalize per-point spring force by activeForceContactCount
  // and cap total upward ground force per vehicle to `mass * gravity * 1.5` (unless bouncing from a fall)
  // FIX 2: When a wheel is in a cavity (3+ contacts), cap upward normal force to 1.0 * mass * G so it cannot climb cavity walls!
  if (activeForceContactCount > 0) {
    const normalizedTotalUpward = rawTotalUpwardForce / activeForceContactCount;
    const isBouncingFromFall =
      wheelRollingFrictionMult <= 1.0 &&
      result.maxImpactSpeed > 1.75 &&
      body.velocity.y < -1.5;
    const maxAllowedUpwardForce =
      wheelRollingFrictionMult > 1.0
        ? body.mass * G * 1.0
        : isBouncingFromFall
          ? body.mass * G * Math.max(3.5, result.maxImpactSpeed * 1.2)
          : body.mass * G * cfg.maxUpwardForceGravityMult;

    const capScale =
      normalizedTotalUpward > maxAllowedUpwardForce && normalizedTotalUpward > 1e-6
        ? maxAllowedUpwardForce / normalizedTotalUpward
        : 1.0;

    for (let i = 0; i < _activeContactsScratch.length; i++) {
      const c = _activeContactsScratch[i];
      // BUG B formula: (per-point spring force) / (number of contact points), capped at 1.5 * mass * g
      let normalForceY =
        (c.rawNormalForceY / activeForceContactCount) * capScale;

      // 6. Anisotropic friction force in horizontal XZ plane (+ FIX 2: 5x rolling friction boost when wheel is in a cavity)
      const vForward =
        c.pointVelX * _forwardDir.x + c.pointVelZ * _forwardDir.z;
      const vLateral =
        c.pointVelX * _rightDir.x + c.pointVelZ * _rightDir.z;

      const cavityBoost =
        c.pt.material === MaterialType.GRIPPY ? wheelRollingFrictionMult : 1.0;

      const muForward =
        c.matProfile.forwardFriction *
        (c.terrainMatType === MaterialType.SLIPPERY ? 0.35 : 1.0) *
        fwdScale *
        cavityBoost;
      const muLateral =
        c.matProfile.lateralFriction *
        (c.terrainMatType === MaterialType.SLIPPERY ? 0.35 : 1.0) *
        latScale;

      const slipSmoothFwd = Math.max(-1, Math.min(1, vForward * 4.5));
      const slipSmoothLat = Math.max(-1, Math.min(1, vLateral * 6.0));

      const fForward = -slipSmoothFwd * muForward * normalForceY;
      const fLateral = -slipSmoothLat * muLateral * normalForceY;

      // 7a. Special handling: CRUNCHY material breaks on hard impact while absorbing kinetic energy
      if (
        c.matProfile.breaksOnImpact &&
        c.downwardSpeed >= cfg.crunchyImpactSpeedThreshold &&
        typeof c.pt.voxelKey === 'number' &&
        !body.isEjecting
      ) {
        result.brokenCrunchyVoxelKeys.push(c.pt.voxelKey);
        normalForceY *= 0.65;
      }

      _pointForce.set(
        _forwardDir.x * fForward + _rightDir.x * fLateral,
        normalForceY,
        _forwardDir.z * fForward + _rightDir.z * fLateral,
      );

      // 7b. Special handling: STICKY material latches onto surface when slow or unthrottled
      if (c.matProfile.latchesOnContact) {
        const speedSq =
          c.pointVelX * c.pointVelX +
          c.pointVelY * c.pointVelY +
          c.pointVelZ * c.pointVelZ;
        const isDriverTryingToBreakFree =
          Math.abs(options?.throttleInput ?? 0) > 0.65;
        if (
          speedSq <
            cfg.stickyLatchSpeedThreshold * cfg.stickyLatchSpeedThreshold &&
          !isDriverTryingToBreakFree
        ) {
          result.hasStickyLatch = true;
          _pointForce.x -= c.pointVelX * cfg.stickyAdhesionForce * 0.15;
          _pointForce.z -= c.pointVelZ * cfg.stickyAdhesionForce * 0.15;
        }
      }

      _worldPoint.set(c.worldPointX, c.worldPointY, c.worldPointZ);
      body.applyForceAtPoint(_pointForce, _worldPoint);
      result.totalUpwardForce += normalForceY;
    }
  }

  // Ceiling pass: apply downward spring + damper when points penetrate the underside of a ceiling
  if (world.probeCeilingAbove && body.velocity.y >= -0.5) {
    for (let i = 0; i < numPoints; i++) {
      const pt = points[i] as SampledCollisionPoint;
      _relPos.copy(pt.localPos).applyQuaternion(body.quaternion);
      _worldPoint.addVectors(body.position, _relPos);

      const ceilingHit = world.probeCeilingAbove(
        _worldPoint.x,
        _worldPoint.y,
        _worldPoint.z,
        0.3,
      );
      if (!ceilingHit || ceilingHit.mat === MAT.WATER_VOX) {
        continue;
      }

      const ceilingBottomY = ceilingHit.y;
      const penetration = _worldPoint.y - ceilingBottomY;
      if (penetration > 0 && penetration < 0.5) {
        _omegaCrossR.crossVectors(body.angularVelocity, _relPos);
        _pointVel.addVectors(body.velocity, _omegaCrossR);

        const matProfile = getMaterialFrictionProfile(
          pt.material || MaterialType.DEFAULT,
        );
        const terrainMatType = mapVoxelMatToMaterialType(ceilingHit.mat);
        const terrainProfile = getMaterialFrictionProfile(terrainMatType);
        const restitution = Math.max(
          matProfile.restitution,
          terrainProfile.restitution * 0.5,
        );

        let forceY = -(kSpring * penetration);
        forceY -= kDamper * Math.max(0, _pointVel.y) * (1.0 + restitution);

        _pointForce.set(0, forceY, 0);
        body.applyForceAtPoint(_pointForce, _worldPoint);
        result.ceilingContactCount++;
      }
    }
  }

  // If all contacting points snapped to rest (< 0.01m penetration & < 0.05 m/s speed),
  // cancel downward gravity accumulation so the resting body does not re-accelerate into the floor!
  if (
    snappedPointsCount > 0 &&
    snappedPointsCount === result.contactCount &&
    throttleAbs < 1e-4
  ) {
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    if (body.accumulatedForce.y < 0) {
      body.accumulatedForce.y = 0;
    }
    body.accumulatedForce.x = 0;
    body.accumulatedForce.z = 0;
    body.accumulatedTorque.set(0, 0, 0);
  }

  if (maxPosCorrectionY > 0 && wheelRollingFrictionMult <= 1.0) {
    body.position.y += maxPosCorrectionY;
    if (body.velocity.y < -0.5 && result.maxPenetration > 0.08) {
      body.velocity.y *= 0.6;
    }
  } else if (wheelRollingFrictionMult > 1.0 && body.velocity.y > 0) {
    body.velocity.y = 0;
  }

  return result;
}

/**
 * Step 2.7: Hybrid Wheel State (Sphere Physics + Voxel Break-Off Visual & Shot-Out Corner Dragging).
 */
export interface HybridWheelModuleLike {
  kind: string;
  vx: number;
  vy: number;
  vz: number;
  health?: number;
  wheelMesh?: THREE.Group | null;
  mesh?: THREE.Group | null;
  lastCompression?: number;
  /** Remaining voxels on the wheel (default 12) */
  wheelVoxelsRemaining?: number;
  /** Maximum voxels on an intact wheel (default 12) */
  wheelMaxVoxels?: number;
  /** Base sphere radius in meters */
  baseRadiusMeters?: number;
  /** Current effective sphere radius (shrinks as wheel loses voxels) */
  currentRadiusMeters?: number;
  /** Current grip multiplier (reduces as wheel loses voxels) */
  gripScale?: number;
  /** Computed sphere angular velocity (rad/s) = v_linear / radius */
  sphereAngularVelocity?: number;
  /** True when all wheel voxels are destroyed ("shot out") */
  isShotOut?: boolean;
  /** FIX 2: Active simultaneous contact points on this wheel (3+ means inside a cavity) */
  activeContactCount?: number;
  /** FIX 2: True when this wheel has 3+ simultaneous collision points (inside a cavity) */
  isInCavity?: boolean;
  /** FIX 2: Rolling friction multiplier (5.0x when inside a cavity, 1.0x otherwise) */
  rollingFrictionMultiplier?: number;
}

export interface HybridWheelStepOutput {
  effectiveRadiusMeters: number;
  gripMultiplier: number;
  forwardRollingResistance: number;
  lateralGripFriction: number;
  angularVelocityRadPS: number;
  isRollingWithoutSlip: boolean;
  isShotOut: boolean;
  cornerDragFriction: number;
  /** FIX 2: True when this wheel has 3+ simultaneous contacts (inside a cavity) */
  isInCavity: boolean;
  /** FIX 2: Rolling friction multiplier (5.0 when in cavity, 1.0 when 1-2 contacts) */
  rollingFrictionMultiplier: number;
}

/**
 * Resolves the default sphere radius for a wheel module archetype.
 */
export function getBaseWheelSphereRadius(kind: string): number {
  switch (kind) {
    case 'WHEEL_MONSTER':
      return 0.72;
    case 'WHEEL_DRAG':
    case 'WHEEL_SPIKED':
      return 0.56;
    case 'WHEEL_KART':
      return 0.36;
    case 'WHEEL_RACING':
      return 0.44;
    default:
      return 0.48;
  }
}

/**
 * Initializes or returns the hybrid sphere-physics + voxel-damage state on a wheel module.
 */
export function ensureHybridWheelState(
  wheel: HybridWheelModuleLike,
): HybridWheelModuleLike {
  const cfg = PHYSICS_CONFIG.hybridWheels;
  if (typeof wheel.wheelMaxVoxels !== 'number') {
    wheel.wheelMaxVoxels = cfg.defaultVoxelsPerWheel;
  }
  if (typeof wheel.wheelVoxelsRemaining !== 'number') {
    const initialRatio = Math.max(0, Math.min(1, wheel.health ?? 1.0));
    wheel.wheelVoxelsRemaining = Math.round(
      wheel.wheelMaxVoxels * initialRatio,
    );
  }
  if (typeof wheel.baseRadiusMeters !== 'number') {
    wheel.baseRadiusMeters = getBaseWheelSphereRadius(wheel.kind);
  }
  const voxRatio =
    wheel.wheelMaxVoxels > 0
      ? Math.max(0, wheel.wheelVoxelsRemaining / wheel.wheelMaxVoxels)
      : 0;

  wheel.isShotOut = wheel.wheelVoxelsRemaining <= 0;
  wheel.currentRadiusMeters = wheel.isShotOut
    ? wheel.baseRadiusMeters * cfg.minRadiusScale * 0.5
    : wheel.baseRadiusMeters *
      (cfg.minRadiusScale + (1.0 - cfg.minRadiusScale) * voxRatio);
  wheel.gripScale = wheel.isShotOut
    ? 0.0
    : cfg.minGripScale + (1.0 - cfg.minGripScale) * voxRatio;
  if (typeof wheel.sphereAngularVelocity !== 'number') {
    wheel.sphereAngularVelocity = 0;
  }
  if (typeof wheel.activeContactCount !== 'number') {
    wheel.activeContactCount = 0;
  }
  wheel.isInCavity = wheel.activeContactCount >= cfg.cavityContactThreshold;
  wheel.rollingFrictionMultiplier = wheel.isInCavity
    ? cfg.cavityRollingFrictionMultiplier
    : 1.0;
  return wheel;
}

const _wheelBreakWorld = new THREE.Vector3();

/**
 * Step 2.7: Applies impact or weapon damage to a hybrid wheel:
 * - Voxels fall off the visual mesh and spawn as debris cubes
 * - Sphere radius shrinks slightly with each lost voxel (visual scale matches physics radius)
 * - Friction coefficient reduces as voxels are lost
 * - When all wheel voxels are destroyed, the wheel is "shot out", spawns a free debris body,
 *   and that corner of the vehicle drags on the ground with high metal-on-ground skidding friction.
 */
export function damageWheelFromCollision(
  vehicle: {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    localVoxelToWorld: (
      vx: number,
      vy: number,
      vz: number,
      out?: THREE.Vector3,
    ) => THREE.Vector3;
    fx?: {
      spawnDebris?: (
        wx: number,
        wy: number,
        wz: number,
        color: number,
        speed?: number,
        scale?: number,
      ) => void;
    };
  },
  wheel: HybridWheelModuleLike,
  voxelsLostCount: number,
  impactOriginWorld?: THREE.Vector3,
  debrisSystem?: {
    spawnDebrisVoxel: (
      worldPos: THREE.Vector3,
      parentVelocity: THREE.Vector3,
      impactOrigin: THREE.Vector3 | null,
      colorHex: number,
      matId?: number,
    ) => unknown;
  } | null,
): {
  voxelsRemaining: number;
  currentRadiusMeters: number;
  gripScale: number;
  justShotOut: boolean;
} {
  ensureHybridWheelState(wheel);
  if (wheel.isShotOut || voxelsLostCount <= 0) {
    return {
      voxelsRemaining: wheel.wheelVoxelsRemaining ?? 0,
      currentRadiusMeters: wheel.currentRadiusMeters ?? 0.2,
      gripScale: wheel.gripScale ?? 0,
      justShotOut: false,
    };
  }

  const prevRemaining = wheel.wheelVoxelsRemaining!;
  const actualLost = Math.min(prevRemaining, Math.max(1, Math.round(voxelsLostCount)));
  wheel.wheelVoxelsRemaining = Math.max(0, prevRemaining - actualLost);
  wheel.health = wheel.wheelVoxelsRemaining / Math.max(1, wheel.wheelMaxVoxels!);

  // Recompute shrunk sphere radius and reduced grip
  ensureHybridWheelState(wheel);
  const justShotOut = Boolean(wheel.isShotOut && prevRemaining > 0);

  vehicle.localVoxelToWorld(wheel.vx, wheel.vy, wheel.vz, _wheelBreakWorld);

  // Spawn tire tread / rim voxel debris particles for each lost wheel voxel
  const spawnCount = justShotOut ? actualLost + 3 : actualLost;
  for (let i = 0; i < spawnCount; i++) {
    const colorHex = i % 2 === 0 ? 0x1e293b : 0x94a3b8;
    if (debrisSystem) {
      debrisSystem.spawnDebrisVoxel(
        _wheelBreakWorld,
        vehicle.velocity,
        impactOriginWorld || vehicle.position,
        colorHex,
        MAT.ASPHALT,
      );
    }
    if (vehicle.fx?.spawnDebris) {
      vehicle.fx.spawnDebris(
        _wheelBreakWorld.x,
        _wheelBreakWorld.y,
        _wheelBreakWorld.z,
        colorHex,
        justShotOut ? 9.5 : 6.0,
        justShotOut ? 1.3 : 0.9,
      );
    }
  }

  // Update visual wheel mesh scale to match the shrunk sphere radius, or hide when shot out
  const radiusRatio =
    wheel.currentRadiusMeters! / Math.max(0.1, wheel.baseRadiusMeters!);
  if (wheel.wheelMesh) {
    if (wheel.isShotOut) {
      wheel.wheelMesh.visible = false;
    } else {
      wheel.wheelMesh.visible = true;
      wheel.wheelMesh.scale.set(1.0, radiusRatio, radiusRatio);
    }
  }

  return {
    voxelsRemaining: wheel.wheelVoxelsRemaining,
    currentRadiusMeters: wheel.currentRadiusMeters!,
    gripScale: wheel.gripScale!,
    justShotOut,
  };
}

/**
 * Step 2.7: Evaluates hybrid sphere-physics wheel rolling, angular velocity, anisotropic grip,
 * cavity rolling resistance boost (FIX 2), and shot-out corner dragging for a wheel contact step.
 */
export function evaluateHybridWheelStep(
  wheel: HybridWheelModuleLike,
  vLongMPS: number,
  vLatMPS: number,
  dt: number,
): HybridWheelStepOutput {
  ensureHybridWheelState(wheel);
  const cfg = PHYSICS_CONFIG.hybridWheels;
  const grippyProfile = getMaterialFrictionProfile(MaterialType.GRIPPY);

  const activeContacts = Math.max(0, wheel.activeContactCount ?? 0);
  const isInCavity = activeContacts >= cfg.cavityContactThreshold;
  const rollingFrictionMultiplier = isInCavity
    ? cfg.cavityRollingFrictionMultiplier
    : 1.0;
  wheel.isInCavity = isInCavity;
  wheel.rollingFrictionMultiplier = rollingFrictionMultiplier;

  if (wheel.isShotOut) {
    wheel.sphereAngularVelocity = 0;
    return {
      effectiveRadiusMeters: wheel.currentRadiusMeters!,
      gripMultiplier: 0,
      forwardRollingResistance: cfg.shotOutCornerDragFriction,
      lateralGripFriction: cfg.shotOutCornerDragFriction,
      angularVelocityRadPS: 0,
      isRollingWithoutSlip: false,
      isShotOut: true,
      cornerDragFriction: cfg.shotOutCornerDragFriction,
      isInCavity,
      rollingFrictionMultiplier,
    };
  }

  const radius = Math.max(0.15, wheel.currentRadiusMeters!);
  const grip = wheel.gripScale!;

  // Angular velocity of sphere = vehicle linear velocity at contact point / wheel radius
  // FIX 2: When inside a cavity (3+ simultaneous contacts), 5x rolling resistance damps wheel spin so it slides instead of climbing!
  const omega = (vLongMPS / radius) / rollingFrictionMultiplier;
  wheel.sphereAngularVelocity = omega;

  const slipRatio =
    Math.abs(vLatMPS) / Math.max(1.0, Math.abs(vLongMPS) + 0.5);
  const isRollingWithoutSlip =
    !isInCavity && grip > cfg.slipRollingThreshold && slipRatio < 0.45;

  // Animate visual wheel mesh rotation based on sphere's computed angular velocity
  if (wheel.wheelMesh && dt > 0) {
    const deltaAngle = omega * dt;
    const rollGroup = (wheel.wheelMesh.userData?.rollGroup ||
      wheel.mesh?.userData?.rollGroup) as THREE.Object3D | undefined;
    if (rollGroup) {
      rollGroup.rotation.x += deltaAngle;
    } else {
      for (let i = 0; i < wheel.wheelMesh.children.length; i++) {
        wheel.wheelMesh.children[i].rotation.x += deltaAngle;
      }
    }
  }

  const baseRollingResistance = (1.0 - grippyProfile.forwardFriction) * 0.5;

  return {
    effectiveRadiusMeters: radius,
    gripMultiplier: grip,
    forwardRollingResistance: baseRollingResistance * rollingFrictionMultiplier,
    lateralGripFriction: grippyProfile.lateralFriction * grip,
    angularVelocityRadPS: omega,
    isRollingWithoutSlip,
    isShotOut: false,
    cornerDragFriction: 0,
    isInCavity,
    rollingFrictionMultiplier,
  };
}

