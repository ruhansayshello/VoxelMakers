import * as THREE from 'three';
import { RigidBodyCore, VehicleRigidBody } from './customRigidBody.ts';
import { BAUMGARTE_MIN_PENETRATION_METERS, applyBaumgartePositionCorrection } from './collisionResponse.ts';
import { createPrebuiltPlaceableObjects, type VoxelObjectPrefab } from '../worldObjects.ts';
import { VOXEL_SIZE } from '../constants.ts';

export type PropShapeType = 'box' | 'sphere' | 'cone';

/** Maximum active dynamic props stepped per frame (v1.0 performance cap) */
export const MAX_ACTIVE_DYNAMIC_PROPS = 200;

export interface PropRigidBodyOptions {
  propId?: string;
  shape?: PropShapeType;
  /** Full extents (width, height, depth) in meters. Default: (1, 1, 1) */
  size?: THREE.Vector3 | { x: number; y: number; z: number };
  /** Mass in kg. Default: 5 kg for small props (cones/spheres), 50 kg for box crates */
  mass?: number;
  /** Bounce restitution [0..1]. Default: 0.3 */
  restitution?: number;
  /** Surface friction [0..1]. Default: 0.5 */
  friction?: number;
  /** Static flag for ramps and permanent structures — skips physics integration entirely */
  isStatic?: boolean;
  /** Optional visual mesh to keep synchronized with this prop's rigid body transform */
  mesh?: THREE.Object3D | null;
  /** Optional prefab/preset identifier */
  prefabId?: string;
  /** Optional parent RigidBodyCore to share VoxelWorld slot & transform vectors (zero mirroring) */
  sharedRigidBody?: RigidBodyCore;
}

export interface VehiclePropCollisionResult {
  prop: PropRigidBody;
  contactCount: number;
  maxImpulse: number;
}

// Pre-allocated scratch variables for zero-GC prop physics & vehicle-vs-prop collision
const _gravityForce = new THREE.Vector3();
const _localPt = new THREE.Vector3();
const _worldPt = new THREE.Vector3();
const _relPos = new THREE.Vector3();
const _invPropQuat = new THREE.Quaternion();
const _localNormal = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const _vehNormal = new THREE.Vector3();
const _velVeh = new THREE.Vector3();
const _velProp = new THREE.Vector3();
const _vRel = new THREE.Vector3();
const _vTan = new THREE.Vector3();
const _impulse = new THREE.Vector3();
const _propImpulse = new THREE.Vector3();
const _posCorr = new THREE.Vector3();
const _propPosCorr = new THREE.Vector3();
const _rotMat = new THREE.Matrix4();

let _nextPropAutoId = 1;

/**
 * Lightweight 6-DOF Rigid Body for world props (`PropRigidBody extends RigidBodyCore`):
 * - Supports analytic bounding shapes (`'box' | 'sphere' | 'cone'`)
 * - Supports dynamic props (cones = 5 kg, crates = 50 kg) and immovable static props (`isStatic = true` for ramps/structures)
 * - Fast O(1) lowest-point ground collision + 1.0s sleep mode
 * - Fast analytic vehicle-point vs prop-shape collision without vehicle launch bugs
 */
export class PropRigidBody extends RigidBodyCore {
  public propId: string;
  public shape: PropShapeType;
  /** Full dimensions (width, height, depth) in meters */
  public size = new THREE.Vector3(1, 1, 1);
  /** Half dimensions (hx, hy, hz) in meters */
  public halfExtents = new THREE.Vector3(0.5, 0.5, 0.5);
  /** Bounding sphere radius in meters for fast broadphase rejection */
  public boundingRadius: number = Math.hypot(0.5, 0.5, 0.5);

  public restitution: number = 0.3;
  public friction: number = 0.5;
  public isStatic: boolean = false;
  public prefabId: string = '';
  public mesh: THREE.Object3D | null = null;

  constructor(options: PropRigidBodyOptions = {}) {
    super(undefined, undefined, options.sharedRigidBody);
    this.propId = options.propId ?? `prop_${_nextPropAutoId++}`;
    this.shape = options.shape ?? 'box';
    this.prefabId = options.prefabId ?? '';
    this.mesh = options.mesh ?? null;

    if (options.size) {
      this.setSize(options.size.x, options.size.y, options.size.z);
    } else if (this.shape === 'cone') {
      this.setSize(0.9, 1.2, 0.9);
    } else if (this.shape === 'sphere') {
      this.setSize(1.2, 1.2, 1.2);
    } else {
      this.setSize(1.0, 1.0, 1.0);
    }

    this.restitution = options.restitution ?? 0.3;
    this.friction = options.friction ?? 0.5;
    this.isStatic = Boolean(options.isStatic);
    this.isSmallObject = true;

    const defaultMass =
      options.mass !== undefined
        ? options.mass
        : this.shape === 'box'
          ? 50
          : 5;

    this.configureMassAndStatic(defaultMass, this.isStatic);
    this.linearDamping = 0.25;
    this.angularDamping = 0.45;
  }

  public setSize(width: number, height: number, depth: number): void {
    const sx = Math.max(0.1, width);
    const sy = Math.max(0.1, height);
    const sz = Math.max(0.1, depth);
    this.size.set(sx, sy, sz);
    this.halfExtents.set(sx * 0.5, sy * 0.5, sz * 0.5);
    this.boundingRadius = this.halfExtents.length();
  }

  public configureMassAndStatic(massKg: number, isStatic: boolean): void {
    this.isStatic = isStatic;
    if (isStatic) {
      this.mass = Infinity;
      this.invMass = 0;
      this.inertiaTensor.set(Infinity, Infinity, Infinity);
      this.invInertiaTensor.set(0, 0, 0);
      this.isSleeping = true;
      return;
    }

    const safeMass = Math.max(1.0, Number.isFinite(massKg) ? massKg : 5.0);
    const wx = this.size.x;
    const wy = this.size.y;
    const wz = this.size.z;
    // Solid box/cylinder inertia tensor approximation with generous floor so props rotate smoothly without numerical explosion
    const ix = Math.max(0.8, (safeMass / 12) * (wy * wy + wz * wz));
    const iy = Math.max(0.8, (safeMass / 12) * (wx * wx + wz * wz));
    const iz = Math.max(0.8, (safeMass / 12) * (wx * wx + wy * wy));
    this.syncMassProperties(safeMass, { x: ix, y: iy, z: iz }, 1.0, 0.8);
  }

  /**
   * Computes the world-space Y coordinate of the prop's lowest point in O(1) time.
   */
  public getLowestWorldY(): number {
    if (this.shape === 'sphere') {
      return this.position.y - this.halfExtents.y;
    }
    // OBB vertical projection: |R_10|*hx + |R_11|*hy + |R_12|*hz
    _rotMat.makeRotationFromQuaternion(this.quaternion);
    const e = _rotMat.elements;
    const hx = this.halfExtents.x;
    const hy = this.halfExtents.y;
    const hz = this.halfExtents.z;
    const verticalHalfSpan =
      Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
    return this.position.y - verticalHalfSpan;
  }

  /**
   * Computes the world-space Y coordinate of the prop's highest point in O(1) time.
   */
  public getHighestWorldY(): number {
    if (this.shape === 'sphere') {
      return this.position.y + this.halfExtents.y;
    }
    _rotMat.makeRotationFromQuaternion(this.quaternion);
    const e = _rotMat.elements;
    const hx = this.halfExtents.x;
    const hy = this.halfExtents.y;
    const hz = this.halfExtents.z;
    const verticalHalfSpan =
      Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
    return this.position.y + verticalHalfSpan;
  }

  public syncVisualMesh(): void {
    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.quaternion);
    }
  }
}

/**
 * Steps a single non-static `PropRigidBody` (gravity, semi-implicit Euler integration,
 * lowest-point ground height collision + friction, overhead ceiling/archway collision, and 1.0-second sleep mode).
 */
export function stepPropRigidBody(
  prop: PropRigidBody,
  dt: number,
  sampleGroundHeight: (wx: number, wy: number, wz: number) => number,
  sampleCeilingHeight?: (wx: number, wy: number, wz: number) => number | null,
): void {
  if (prop.isStatic || prop.invMass <= 0) {
    return;
  }
  if (prop.isSleeping) {
    return;
  }

  // 1. Apply gravity
  _gravityForce.set(0, -9.81 * prop.mass, 0);
  prop.applyForce(_gravityForce);

  // 2. Integrate linear & angular motion
  prop.integrateSubstep(dt);

  // 3. Prop-vs-Ground: probe floor directly beneath the prop's current height (never roof of archway!)
  const lowestY = prop.getLowestWorldY();
  const groundY = sampleGroundHeight(
    prop.position.x,
    lowestY,
    prop.position.z,
  );
  const penetration = groundY - lowestY;

  if (penetration > 0) {
    // Push prop up so its lowest point sits on the ground
    prop.position.y += penetration;

    // Bounce / stop downward velocity
    if (prop.velocity.y < 0) {
      if (prop.velocity.y < -2.2) {
        prop.velocity.y = -prop.velocity.y * prop.restitution;
      } else {
        prop.velocity.y = 0;
      }
    }

    // Apply horizontal ground friction and rolling/sliding angular damping
    const frictionKeep = Math.max(0, 1.0 - prop.friction * 10.5 * dt);
    prop.velocity.x *= frictionKeep;
    prop.velocity.z *= frictionKeep;
    prop.angularVelocity.multiplyScalar(Math.max(0, 1.0 - prop.friction * 8.0 * dt));
  }

  // 3B. Prop-vs-Ceiling: prevent bouncing/flying props from clipping into or teleporting above archways/tunnels
  if (sampleCeilingHeight) {
    const highestY = prop.getHighestWorldY();
    const ceilY = sampleCeilingHeight(
      prop.position.x,
      highestY,
      prop.position.z,
    );
    if (ceilY !== null && ceilY > groundY + 0.3 && highestY > ceilY) {
      const ceilPen = highestY - ceilY;
      prop.position.y -= ceilPen;
      if (prop.velocity.y > 0) {
        prop.velocity.y = -prop.velocity.y * prop.restitution * 0.5;
      }
    }
  }

  // 4. Sleep mode for props that haven't moved for 1.0 second
  const speedSq = prop.velocity.lengthSq();
  const angSq = prop.angularVelocity.lengthSq();
  const nearGround = Math.abs(penetration) <= 0.08;
  if (nearGround && speedSq < 0.04 && angSq < 0.06) {
    prop.sleepTimer += dt;
    if (prop.sleepTimer >= 1.0) {
      prop.sleep();
    }
  } else {
    prop.sleepTimer = 0;
  }

  prop.syncVisualMesh();
}

/**
 * Tests whether a local-space point `(lx, ly, lz)` is inside `prop`'s bounding shape
 * (`'box' | 'sphere' | 'cone'`) and outputs the local outward normal and penetration depth.
 */
export function testLocalPointInPropShape(
  prop: PropRigidBody,
  lx: number,
  ly: number,
  lz: number,
  outLocalNormal: THREE.Vector3,
): number {
  const hx = prop.halfExtents.x;
  const hy = prop.halfExtents.y;
  const hz = prop.halfExtents.z;

  if (prop.shape === 'sphere') {
    const r = Math.max(hx, hy, hz);
    const distSq = lx * lx + ly * ly + lz * lz;
    if (distSq > r * r) return 0;
    const dist = Math.sqrt(distSq);
    if (dist > 1e-5) {
      outLocalNormal.set(lx / dist, ly / dist, lz / dist);
    } else {
      outLocalNormal.set(0, 1, 0);
    }
    return Math.max(0.01, r - dist);
  }

  if (prop.shape === 'cone') {
    if (Math.abs(ly) > hy) return 0;
    const baseR = Math.max(hx, hz);
    // Taper from 100% radius at bottom (-hy) to 30% radius at top (+hy)
    const t = Math.max(0, Math.min(1, (ly + hy) / Math.max(0.1, 2 * hy)));
    const rAtY = baseR * (1.0 - 0.7 * t);
    const radDistSq = lx * lx + lz * lz;
    if (radDistSq > rAtY * rAtY) return 0;

    const radDist = Math.sqrt(radDistSq);
    const penRadial = rAtY - radDist;
    const penTop = hy - ly;
    const penBottom = hy + ly;

    if (penTop < penRadial && penTop < penBottom) {
      outLocalNormal.set(0, 1, 0);
      return Math.max(0.01, penTop);
    }
    if (radDist > 1e-5) {
      outLocalNormal.set(lx / radDist, 0.2, lz / radDist).normalize();
    } else {
      outLocalNormal.set(1, 0.2, 0).normalize();
    }
    return Math.max(0.01, penRadial);
  }

  // Default: 'box'
  const dx = hx - Math.abs(lx);
  if (dx < 0) return 0;
  const dy = hy - Math.abs(ly);
  if (dy < 0) return 0;
  const dz = hz - Math.abs(lz);
  if (dz < 0) return 0;

  if (dx <= dy && dx <= dz) {
    outLocalNormal.set(lx >= 0 ? 1 : -1, 0, 0);
    return Math.max(0.01, dx);
  }
  if (dz <= dx && dz <= dy) {
    outLocalNormal.set(0, 0, lz >= 0 ? 1 : -1);
    return Math.max(0.01, dz);
  }
  outLocalNormal.set(0, ly >= 0 ? 1 : -1, 0);
  return Math.max(0.01, dy);
}

/**
 * Resolves collision between a `VehicleRigidBody` and a single `PropRigidBody`:
 * - Checks each vehicle collision point against the prop's bounding shape.
 * - Applies mass-weighted impulses and Baumgarte position corrections.
 * - Prevents dynamic props from launching vehicles upward while knocking props away realistically.
 */
export function resolveVehicleVsPropCollision(
  vehicleBody: VehicleRigidBody,
  prop: PropRigidBody,
  vehiclePositionSync?: THREE.Vector3,
  vehicleVelocitySync?: THREE.Vector3,
  vehicleAngularVelocitySync?: THREE.Vector3,
): VehiclePropCollisionResult {
  const result: VehiclePropCollisionResult = {
    prop,
    contactCount: 0,
    maxImpulse: 0,
  };

  if (vehicleBody.isSleeping && (prop.isSleeping || prop.isStatic)) {
    return result;
  }

  const points = vehicleBody.collisionPoints;
  if (!points || points.length === 0) {
    return result;
  }

  // Fast bounding-sphere broadphase check
  const distSqCenters = vehicleBody.position.distanceToSquared(prop.position);
  const maxReach = prop.boundingRadius + 6.5;
  if (distSqCenters > maxReach * maxReach) {
    return result;
  }

  _invPropQuat.copy(prop.quaternion).invert();

  // First pass: collect penetrating points so multi-point impacts are averaged cleanly
  let hitCount = 0;
  let sumPenetration = 0;
  let sumNormalX = 0;
  let sumNormalY = 0;
  let sumNormalZ = 0;
  let sumWorldX = 0;
  let sumWorldY = 0;
  let sumWorldZ = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    _relPos.copy(pt.localPos).applyQuaternion(vehicleBody.quaternion);
    _worldPt.addVectors(vehicleBody.position, _relPos);

    // Transform world point into prop local space
    _localPt.subVectors(_worldPt, prop.position).applyQuaternion(_invPropQuat);

    const pen = testLocalPointInPropShape(
      prop,
      _localPt.x,
      _localPt.y,
      _localPt.z,
      _localNormal,
    );
    if (pen <= 0) continue;

    _worldNormal.copy(_localNormal).applyQuaternion(prop.quaternion).normalize();
    hitCount++;
    if (pen > sumPenetration) {
      sumPenetration = pen;
    }
    sumNormalX += _worldNormal.x;
    sumNormalY += _worldNormal.y;
    sumNormalZ += _worldNormal.z;
    sumWorldX += _worldPt.x;
    sumWorldY += _worldPt.y;
    sumWorldZ += _worldPt.z;
  }

  if (hitCount === 0) {
    return result;
  }

  result.contactCount = hitCount;
  const invHits = 1.0 / hitCount;
  _worldPt.set(sumWorldX * invHits, sumWorldY * invHits, sumWorldZ * invHits);
  _worldNormal.set(sumNormalX * invHits, sumNormalY * invHits, sumNormalZ * invHits);
  if (_worldNormal.lengthSq() < 1e-6) {
    _worldNormal.subVectors(vehicleBody.position, prop.position);
    if (_worldNormal.lengthSq() < 1e-6) _worldNormal.set(0, 0, 1);
  }
  _worldNormal.normalize();

  // Ensure normal points from prop toward vehicle
  _relPos.subVectors(vehicleBody.position, prop.position);
  if (_worldNormal.dot(_relPos) < 0) {
    _worldNormal.negate();
  }

  // CRITICAL FIX: For dynamic props (!prop.isStatic), prevent upward normal components from launching the car!
  _vehNormal.copy(_worldNormal);
  if (!prop.isStatic) {
    if (_vehNormal.y > 0.12) {
      _vehNormal.y = 0.0;
      if (_vehNormal.lengthSq() < 1e-5) {
        _vehNormal.set(_relPos.x, 0, _relPos.z);
        if (_vehNormal.lengthSq() < 1e-5) _vehNormal.set(0, 0, 1);
      }
      _vehNormal.normalize();
    }
  }

  const totalInvMass = Math.max(1e-6, vehicleBody.invMass + prop.invMass);

  vehicleBody.velocityAtPoint(_worldPt, _velVeh);
  prop.velocityAtPoint(_worldPt, _velProp);
  _vRel.subVectors(_velVeh, _velProp);

  const vNormal = _vRel.dot(_vehNormal);
  const restitution = Math.max(0.15, prop.restitution);

  let jN = 0;
  if (vNormal < 0) {
    jN = (-(1.0 + restitution) * vNormal) / totalInvMass;
  } else if (!prop.isStatic && sumPenetration > 0.01) {
    // Gentle separation impulse if deeply overlapping
    jN = (sumPenetration * 4.0) / totalInvMass;
  }

  if (jN > 0) {
    vehicleBody.wake();
    if (!prop.isStatic) {
      prop.wake();
    }
    vehicleBody.recordCollisionEvent();
    prop.recordCollisionEvent();

    // Tangential friction impulse
    _vTan.copy(_vRel).addScaledVector(_vehNormal, -vNormal);
    const vTanLen = _vTan.length();
    let jT = 0;
    if (vTanLen > 1e-5) {
      _vTan.divideScalar(vTanLen);
      const maxStop = vTanLen / totalInvMass;
      jT = Math.max(-maxStop, Math.min(maxStop, -prop.friction * jN));
    }

    // Apply impulse to vehicle (strictly horizontal for dynamic props so vehicle never launches into the sky)
    _impulse.copy(_vehNormal).multiplyScalar(jN);
    if (jT !== 0) {
      _impulse.addScaledVector(_vTan, jT);
    }
    if (!prop.isStatic && _impulse.y > 0) {
      _impulse.y = 0;
    }
    vehicleBody.applyImpulseAtPoint(_impulse, _worldPt);

    // Apply equal-and-opposite impulse to dynamic prop with natural upward tumble kick
    if (!prop.isStatic && prop.invMass > 0) {
      _propImpulse.copy(_impulse).negate();
      const horizImpactSpeed = Math.hypot(_velVeh.x - _velProp.x, _velVeh.z - _velProp.z);
      const upwardKick = Math.min(prop.mass * 4.5, jN * 0.28 + horizImpactSpeed * prop.mass * 0.18);
      _propImpulse.y = Math.max(_propImpulse.y, upwardKick);
      prop.applyImpulseAtPoint(_propImpulse, _worldPt);

      // Add a tipping angular kick when hit by a moving vehicle so cones and crates tumble dramatically
      if (horizImpactSpeed > 0.5) {
        const tipAxisX = -(_vehNormal.z);
        const tipAxisZ = _vehNormal.x;
        const tipSpin = Math.min(8.5, horizImpactSpeed * 0.65);
        prop.angularVelocity.x += tipAxisX * tipSpin;
        prop.angularVelocity.z += tipAxisZ * tipSpin;
      }
      prop.syncVisualMesh();
    }

    if (vehicleVelocitySync && vehicleVelocitySync !== vehicleBody.velocity) {
      vehicleVelocitySync.copy(vehicleBody.velocity);
    }
    if (vehicleAngularVelocitySync && vehicleAngularVelocitySync !== vehicleBody.angularVelocity) {
      vehicleAngularVelocitySync.copy(vehicleBody.angularVelocity);
    }

    result.maxImpulse = jN;
  }

  // Mass-weighted Baumgarte position stabilization
  if (sumPenetration > BAUMGARTE_MIN_PENETRATION_METERS) {
    const vehWeight = prop.isStatic || prop.invMass <= 1e-8
      ? 1.0
      : vehicleBody.invMass / totalInvMass;
    const propWeight = prop.isStatic || prop.invMass <= 1e-8
      ? 0.0
      : prop.invMass / totalInvMass;

    if (vehWeight > 0) {
      applyBaumgartePositionCorrection(
        vehicleBody,
        vehiclePositionSync,
        _vehNormal,
        sumPenetration,
        vehWeight,
        _posCorr,
      );
    }

    if (propWeight > 0 && !prop.isStatic) {
      _propPosCorr.copy(_vehNormal).negate();
      applyBaumgartePositionCorrection(
        prop,
        undefined,
        _propPosCorr,
        sumPenetration,
        propWeight,
        _posCorr,
      );
      prop.syncVisualMesh();
    }
  }

  return result;
}

export interface PropPropCollisionResult {
  propA: PropRigidBody;
  propB: PropRigidBody;
  contactCount: number;
  maxImpulse: number;
  contactPoint: THREE.Vector3;
}

const _sampleDirs: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 0, 0],
];

const _invQuatA = new THREE.Quaternion();
const _invQuatB = new THREE.Quaternion();
const _sampleWorld = new THREE.Vector3();

/**
 * Resolves 3D rigid-body collision between two `PropRigidBody` instances (`propA` and `propB`):
 * - Supports all combinations of `'box' | 'sphere' | 'cone'` shapes
 * - Wakes sleeping props when hit by a moving prop
 * - Applies mass-weighted normal + tangential friction impulses and Baumgarte position separation
 * - Stabilizes vertically stacked props (e.g. crate pyramids) while knocking bowling pins/cones spinning on impact
 */
export function resolvePropVsPropCollision(
  propA: PropRigidBody,
  propB: PropRigidBody,
): PropPropCollisionResult {
  const result: PropPropCollisionResult = {
    propA,
    propB,
    contactCount: 0,
    maxImpulse: 0,
    contactPoint: new THREE.Vector3(),
  };

  if (propA === propB) return result;
  if ((propA.isSleeping || propA.isStatic) && (propB.isSleeping || propB.isStatic)) {
    return result;
  }

  const distSq = propA.position.distanceToSquared(propB.position);
  const maxReach = propA.boundingRadius + propB.boundingRadius;
  if (distSq > maxReach * maxReach) {
    return result;
  }

  let hitCount = 0;
  let maxPenetration = 0;
  let sumNormalX = 0;
  let sumNormalY = 0;
  let sumNormalZ = 0;
  let sumWorldX = 0;
  let sumWorldY = 0;
  let sumWorldZ = 0;

  // Fast analytical sphere-vs-sphere path when both props are spheres
  if (propA.shape === 'sphere' && propB.shape === 'sphere') {
    const rA = Math.max(propA.halfExtents.x, propA.halfExtents.y, propA.halfExtents.z);
    const rB = Math.max(propB.halfExtents.x, propB.halfExtents.y, propB.halfExtents.z);
    const dist = Math.sqrt(distSq);
    if (dist >= rA + rB) return result;
    hitCount = 1;
    maxPenetration = Math.max(0.01, rA + rB - dist);
    if (dist > 1e-5) {
      sumNormalX = (propA.position.x - propB.position.x) / dist;
      sumNormalY = (propA.position.y - propB.position.y) / dist;
      sumNormalZ = (propA.position.z - propB.position.z) / dist;
    } else {
      sumNormalX = 0;
      sumNormalY = 1;
      sumNormalZ = 0;
    }
    const midRatio = rB / Math.max(0.1, rA + rB);
    sumWorldX = propB.position.x + (propA.position.x - propB.position.x) * midRatio;
    sumWorldY = propB.position.y + (propA.position.y - propB.position.y) * midRatio;
    sumWorldZ = propB.position.z + (propA.position.z - propB.position.z) * midRatio;
  } else {
    _invQuatA.copy(propA.quaternion).invert();
    _invQuatB.copy(propB.quaternion).invert();

    // 1. Sample key surface points of propA inside propB's local bounding shape
    const hxA = propA.halfExtents.x;
    const hyA = propA.halfExtents.y;
    const hzA = propA.halfExtents.z;
    for (let i = 0; i < _sampleDirs.length; i++) {
      const [sx, sy, sz] = _sampleDirs[i];
      _sampleWorld
        .set(sx * hxA, sy * hyA, sz * hzA)
        .applyQuaternion(propA.quaternion)
        .add(propA.position);
      _localPt.subVectors(_sampleWorld, propB.position).applyQuaternion(_invQuatB);
      const pen = testLocalPointInPropShape(
        propB,
        _localPt.x,
        _localPt.y,
        _localPt.z,
        _localNormal,
      );
      if (pen <= 0) continue;
      // _localNormal points outward from B (so from B toward A)
      _worldNormal.copy(_localNormal).applyQuaternion(propB.quaternion).normalize();
      hitCount++;
      if (pen > maxPenetration) maxPenetration = pen;
      sumNormalX += _worldNormal.x;
      sumNormalY += _worldNormal.y;
      sumNormalZ += _worldNormal.z;
      sumWorldX += _sampleWorld.x;
      sumWorldY += _sampleWorld.y;
      sumWorldZ += _sampleWorld.z;
    }

    // 2. Sample key surface points of propB inside propA's local bounding shape
    const hxB = propB.halfExtents.x;
    const hyB = propB.halfExtents.y;
    const hzB = propB.halfExtents.z;
    for (let i = 0; i < _sampleDirs.length; i++) {
      const [sx, sy, sz] = _sampleDirs[i];
      _sampleWorld
        .set(sx * hxB, sy * hyB, sz * hzB)
        .applyQuaternion(propB.quaternion)
        .add(propB.position);
      _localPt.subVectors(_sampleWorld, propA.position).applyQuaternion(_invQuatA);
      const pen = testLocalPointInPropShape(
        propA,
        _localPt.x,
        _localPt.y,
        _localPt.z,
        _localNormal,
      );
      if (pen <= 0) continue;
      // _localNormal points outward from A (so negate it to point from B toward A)
      _worldNormal.copy(_localNormal).applyQuaternion(propA.quaternion).negate().normalize();
      hitCount++;
      if (pen > maxPenetration) maxPenetration = pen;
      sumNormalX += _worldNormal.x;
      sumNormalY += _worldNormal.y;
      sumNormalZ += _worldNormal.z;
      sumWorldX += _sampleWorld.x;
      sumWorldY += _sampleWorld.y;
      sumWorldZ += _sampleWorld.z;
    }
  }

  if (hitCount === 0) {
    return result;
  }

  result.contactCount = hitCount;
  const invHits = 1.0 / hitCount;
  _worldPt.set(sumWorldX * invHits, sumWorldY * invHits, sumWorldZ * invHits);
  result.contactPoint.copy(_worldPt);

  _worldNormal.set(sumNormalX * invHits, sumNormalY * invHits, sumNormalZ * invHits);
  if (_worldNormal.lengthSq() < 1e-6) {
    _worldNormal.subVectors(propA.position, propB.position);
    if (_worldNormal.lengthSq() < 1e-6) _worldNormal.set(0, 1, 0);
  }
  _worldNormal.normalize();

  // Ensure normal points from propB toward propA
  _relPos.subVectors(propA.position, propB.position);
  if (_worldNormal.dot(_relPos) < 0) {
    _worldNormal.negate();
  }

  const totalInvMass = Math.max(1e-6, propA.invMass + propB.invMass);

  propA.velocityAtPoint(_worldPt, _velVeh);
  propB.velocityAtPoint(_worldPt, _velProp);
  _vRel.subVectors(_velVeh, _velProp);

  const vNormal = _vRel.dot(_worldNormal);
  const combinedRestitution =
    -vNormal < 0.85 ? 0.0 : Math.max(propA.restitution, propB.restitution);
  const combinedFriction = Math.sqrt(propA.friction * propB.friction);

  let jN = 0;
  if (vNormal < 0) {
    jN = (-(1.0 + combinedRestitution) * vNormal) / totalInvMass;
  } else if (maxPenetration > 0.015) {
    jN = (maxPenetration * 3.2) / totalInvMass;
  }

  if (jN > 0) {
    if (!propA.isStatic && (jN * propA.invMass > 0.15 || !propB.isSleeping)) {
      propA.wake();
    }
    if (!propB.isStatic && (jN * propB.invMass > 0.15 || !propA.isSleeping)) {
      propB.wake();
    }
    propA.recordCollisionEvent();
    propB.recordCollisionEvent();

    // Tangential friction impulse
    _vTan.copy(_vRel).addScaledVector(_worldNormal, -vNormal);
    const vTanLen = _vTan.length();
    let jT = 0;
    if (vTanLen > 1e-5) {
      _vTan.divideScalar(vTanLen);
      const maxStop = vTanLen / totalInvMass;
      jT = Math.max(-maxStop, Math.min(maxStop, -combinedFriction * jN));
    }

    _impulse.copy(_worldNormal).multiplyScalar(jN);
    if (jT !== 0) {
      _impulse.addScaledVector(_vTan, jT);
    }

    const horizImpactSpeed = Math.hypot(_velVeh.x - _velProp.x, _velVeh.z - _velProp.z);

    if (!propA.isStatic && propA.invMass > 0) {
      propA.applyImpulseAtPoint(_impulse, _worldPt);
      if (horizImpactSpeed > 1.0 && Math.abs(_worldNormal.y) < 0.6) {
        const tipSpin = Math.min(6.0, horizImpactSpeed * 0.45);
        propA.angularVelocity.x += -_worldNormal.z * tipSpin;
        propA.angularVelocity.z += _worldNormal.x * tipSpin;
      }
      propA.syncVisualMesh();
    }

    if (!propB.isStatic && propB.invMass > 0) {
      _propImpulse.copy(_impulse).negate();
      propB.applyImpulseAtPoint(_propImpulse, _worldPt);
      if (horizImpactSpeed > 1.0 && Math.abs(_worldNormal.y) < 0.6) {
        const tipSpin = Math.min(6.0, horizImpactSpeed * 0.45);
        propB.angularVelocity.x += _worldNormal.z * tipSpin;
        propB.angularVelocity.z += -_worldNormal.x * tipSpin;
      }
      propB.syncVisualMesh();
    }

    result.maxImpulse = jN;
  }

  // Mass-weighted Baumgarte positional separation
  if (maxPenetration > BAUMGARTE_MIN_PENETRATION_METERS) {
    const weightA =
      propB.isStatic || propB.invMass <= 1e-8
        ? 1.0
        : propA.isStatic || propA.invMass <= 1e-8
          ? 0.0
          : propA.invMass / totalInvMass;
    const weightB =
      propA.isStatic || propA.invMass <= 1e-8
        ? 1.0
        : propB.isStatic || propB.invMass <= 1e-8
          ? 0.0
          : propB.invMass / totalInvMass;

    if (weightA > 0 && !propA.isStatic) {
      applyBaumgartePositionCorrection(
        propA,
        undefined,
        _worldNormal,
        maxPenetration,
        weightA,
        _posCorr,
      );
      if (_worldNormal.y > 0.72 && propA.velocity.y < 0) {
        propA.velocity.y = Math.max(propA.velocity.y, Math.min(0, propB.velocity.y));
      }
      propA.syncVisualMesh();
    }

    if (weightB > 0 && !propB.isStatic) {
      _propPosCorr.copy(_worldNormal).negate();
      applyBaumgartePositionCorrection(
        propB,
        undefined,
        _propPosCorr,
        maxPenetration,
        weightB,
        _posCorr,
      );
      if (_worldNormal.y < -0.72 && propB.velocity.y < 0) {
        propB.velocity.y = Math.max(propB.velocity.y, Math.min(0, propA.velocity.y));
      }
      propB.syncVisualMesh();
    }
  }

  return result;
}

/**
 * Wakes any sleeping dynamic props that are resting directly above or adjacent to a prop that just got hit,
 * so driving into the base of a crate stack causes the entire stack to collapse and scatter!
 */
function wakeStackedNeighbors(hitProp: PropRigidBody, allProps: readonly PropRigidBody[]): void {
  const hx = hitProp.position.x;
  const hy = hitProp.position.y;
  const hz = hitProp.position.z;
  const wakeRadXZ = Math.max(1.8, hitProp.boundingRadius * 2.2);

  for (let i = 0; i < allProps.length; i++) {
    const other = allProps[i];
    if (other === hitProp || other.isStatic || !other.isSleeping) continue;
    const dx = Math.abs(other.position.x - hx);
    const dz = Math.abs(other.position.z - hz);
    const dy = other.position.y - hy;
    if (dx <= wakeRadXZ && dz <= wakeRadXZ && dy >= -0.5 && dy <= 4.5) {
      other.wake();
    }
  }
}

/**
 * Steps all dynamic `PropRigidBody` instances (capped at `MAX_ACTIVE_DYNAMIC_PROPS = 200`)
 * and resolves all vehicle-vs-prop AND prop-vs-prop collisions.
 */
export function stepAllPropsAndVehicleCollisions(
  vehicles: ReadonlyArray<{
    rigidBody: VehicleRigidBody;
    position?: THREE.Vector3;
    velocity?: THREE.Vector3;
    angularVelocity?: THREE.Vector3;
    inBuildMode?: boolean;
  }>,
  props: readonly PropRigidBody[],
  dt: number,
  sampleGroundHeight: (wx: number, wy: number, wz: number) => number,
): VehiclePropCollisionResult[] {
  const collisionResults: VehiclePropCollisionResult[] = [];

  // 1. Resolve Vehicle-vs-Prop collisions first so any sleeping props hit by a car wake up this frame
  for (let vIdx = 0; vIdx < vehicles.length; vIdx++) {
    const veh = vehicles[vIdx];
    if (veh.inBuildMode) continue;
    const vehBody = veh.rigidBody;

    for (let pIdx = 0; pIdx < props.length; pIdx++) {
      const prop = props[pIdx];
      const wasSleeping = prop.isSleeping;
      const res = resolveVehicleVsPropCollision(
        vehBody,
        prop,
        veh.position,
        veh.velocity,
        veh.angularVelocity,
      );
      if (res.contactCount > 0) {
        if (wasSleeping && !prop.isStatic) {
          wakeStackedNeighbors(prop, props);
        }
        collisionResults.push(res);
      }
    }
  }

  // 2. Step up to MAX_ACTIVE_DYNAMIC_PROPS non-static props
  let activeDynamicStepped = 0;
  for (let pIdx = 0; pIdx < props.length; pIdx++) {
    const prop = props[pIdx];
    if (prop.isStatic || prop.isSleeping) continue;
    if (activeDynamicStepped >= MAX_ACTIVE_DYNAMIC_PROPS) {
      prop.sleep();
      continue;
    }
    activeDynamicStepped++;
    stepPropRigidBody(prop, dt, sampleGroundHeight);
  }

  // 3. Resolve pairwise Prop-vs-Prop collisions so moving props knock into other props and stacked crates support each other
  for (let i = 0; i < props.length; i++) {
    const propA = props[i];
    for (let j = i + 1; j < props.length; j++) {
      const propB = props[j];
      if ((propA.isSleeping || propA.isStatic) && (propB.isSleeping || propB.isStatic)) {
        continue;
      }
      const wasSleepingA = propA.isSleeping;
      const wasSleepingB = propB.isSleeping;
      const pairRes = resolvePropVsPropCollision(propA, propB);
      if (pairRes.contactCount > 0) {
        if (wasSleepingA && !propA.isStatic && !propA.isSleeping) {
          wakeStackedNeighbors(propA, props);
        }
        if (wasSleepingB && !propB.isStatic && !propB.isSleeping) {
          wakeStackedNeighbors(propB, props);
        }
      }
    }
  }

  return collisionResults;
}

/**
 * Helper to create a `PropRigidBody` from a `worldObjects.ts` `VoxelObjectPrefab`
 * (cones, crates, barrels spawn as dynamic props; ramps, arches, buildings spawn with `isStatic = true`).
 */
export function createPropRigidBodyFromPrefab(
  prefab: VoxelObjectPrefab | string,
  wx: number,
  wy: number,
  wz: number,
  yawRad = 0,
  mesh: THREE.Object3D | null = null,
): PropRigidBody {
  const resolvedPrefab: VoxelObjectPrefab | undefined =
    typeof prefab === 'string'
      ? createPrebuiltPlaceableObjects().find((p) => p.id === prefab)
      : prefab;

  const id = resolvedPrefab?.id ?? (typeof prefab === 'string' ? prefab : 'custom_prop');
  const lowerId = id.toLowerCase();

  const isStaticStructure =
    resolvedPrefab?.category === 'STUNT' ||
    resolvedPrefab?.category === 'BUILDING' ||
    lowerId.includes('ramp') ||
    lowerId.includes('arch') ||
    lowerId.includes('watchtower') ||
    lowerId.includes('building') ||
    lowerId.includes('wall') ||
    lowerId.includes('tower');

  let shape: PropShapeType = 'box';
  let mass = 50;
  if (lowerId.includes('cone') || lowerId.includes('pin')) {
    shape = 'cone';
    mass = 5;
  } else if (lowerId.includes('ball') || lowerId.includes('sphere') || lowerId.includes('boulder')) {
    shape = 'sphere';
    mass = 15;
  } else if (lowerId.includes('crate') || lowerId.includes('barrel')) {
    shape = 'box';
    mass = 50;
  }

  const sizeX = (resolvedPrefab ? resolvedPrefab.sizeX : 4) * VOXEL_SIZE;
  const sizeY = (resolvedPrefab ? resolvedPrefab.sizeY : 4) * VOXEL_SIZE;
  const sizeZ = (resolvedPrefab ? resolvedPrefab.sizeZ : 4) * VOXEL_SIZE;

  const prop = new PropRigidBody({
    propId: `${id}_${_nextPropAutoId++}`,
    prefabId: id,
    shape,
    size: { x: sizeX, y: sizeY, z: sizeZ },
    mass,
    restitution: shape === 'sphere' ? 0.65 : 0.3,
    friction: 0.5,
    isStatic: isStaticStructure,
    mesh,
  });

  prop.position.set(wx, wy + sizeY * 0.5, wz);
  prop.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
  prop.syncVisualMesh();
  return prop;
}
