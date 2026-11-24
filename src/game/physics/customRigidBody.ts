import * as THREE from 'three';
import {
  VoxelWorld,
  getActiveVoxelWorld,
} from '../../engine/world/VoxelWorld';
import { MaterialType, PHYSICS_CONFIG } from './physicsConfig.ts';
import type { SampledCollisionPoint } from './collisionPoints.ts';

export interface RigidBodyCollisionPoint {
  localPos: THREE.Vector3;
  material: MaterialType;
  voxelKey?: number;
  welded?: boolean;
  weldedTargetVehicleId?: string;
  weldedTargetVoxelKey?: number;
}

/**
 * Core 6-DOF Rigid Body integration math (`RigidBodyCore`):
 * position, velocity, quaternion, angularVelocity, applyForce, applyImpulse,
 * semi-implicit Euler integrateSubstep, and sleep/wake management.
 * Shared by both `VehicleRigidBody` (`CustomRigidBody`) and lightweight `PropRigidBody`.
 */
export class RigidBodyCore {
  public readonly voxelWorld: VoxelWorld;
  public readonly slotIndex: number;
  private readonly _ownsSlot: boolean;
  private _slotReleased = false;

  public position: THREE.Vector3;
  public velocity: THREE.Vector3;
  public quaternion: THREE.Quaternion;
  /** Axis-angle angular velocity (rad/s in world space) */
  public angularVelocity: THREE.Vector3;

  /** Diagonal of local-space inertia matrix */
  public inertiaTensor: THREE.Vector3;
  /** Precomputed 1 / inertiaTensor */
  public invInertiaTensor: THREE.Vector3;

  /** Accumulated force and torque (plain Vector3, synced to VoxelWorld SoA on integration) */
  public accumulatedForce: THREE.Vector3;
  public accumulatedTorque: THREE.Vector3;

  public sleepTimer: number = 0;

  constructor(
    voxelWorld: VoxelWorld = getActiveVoxelWorld(),
    bodyId?: number,
    sharedBody?: RigidBodyCore,
  ) {
    if (sharedBody) {
      this.voxelWorld = sharedBody.voxelWorld;
      this.slotIndex = sharedBody.slotIndex;
      this._ownsSlot = false;
      this.position = sharedBody.position;
      this.velocity = sharedBody.velocity;
      this.quaternion = sharedBody.quaternion;
      this.angularVelocity = sharedBody.angularVelocity;
      this.inertiaTensor = sharedBody.inertiaTensor;
      this.invInertiaTensor = sharedBody.invInertiaTensor;
      this.accumulatedForce = sharedBody.accumulatedForce;
      this.accumulatedTorque = sharedBody.accumulatedTorque;
      return;
    }

    this.voxelWorld = voxelWorld;
    this.slotIndex = voxelWorld.acquireBodySlot(bodyId);
    this._ownsSlot = true;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3();
    this.inertiaTensor = new THREE.Vector3(
      PHYSICS_CONFIG.minInertia,
      PHYSICS_CONFIG.minInertia,
      PHYSICS_CONFIG.minInertia,
    );
    this.invInertiaTensor = new THREE.Vector3(
      1 / PHYSICS_CONFIG.minInertia,
      1 / PHYSICS_CONFIG.minInertia,
      1 / PHYSICS_CONFIG.minInertia,
    );
    this.accumulatedForce = new THREE.Vector3();
    this.accumulatedTorque = new THREE.Vector3();

    this.voxelWorld.bodyMasses[this.slotIndex] = PHYSICS_CONFIG.minVehicleMassKg;
    this.voxelWorld.bodyInvMasses[this.slotIndex] = 1 / PHYSICS_CONFIG.minVehicleMassKg;
    this.voxelWorld.bodyLinearDamping[this.slotIndex] = PHYSICS_CONFIG.defaultLinearDamping;
    this.voxelWorld.bodyAngularDamping[this.slotIndex] = PHYSICS_CONFIG.defaultAngularDamping;
    this.voxelWorld.bodyMaxLinearSpeed[this.slotIndex] = PHYSICS_CONFIG.maxLinearSpeedMPS;
    this.voxelWorld.bodyMaxAngularSpeed[this.slotIndex] = PHYSICS_CONFIG.maxAngularSpeedRadPS;
    this.syncToVoxelWorld();
  }

  /**
   * Writes plain Vector3/Quaternion fields into VoxelWorld flat Float32Arrays for this body slot.
   */
  public syncToVoxelWorld(): void {
    const vw = this.voxelWorld;
    const o3 = this.slotIndex * 3;
    const o4 = this.slotIndex * 4;

    vw.bodyPositions[o3] = this.position.x;
    vw.bodyPositions[o3 + 1] = this.position.y;
    vw.bodyPositions[o3 + 2] = this.position.z;

    vw.bodyVelocities[o3] = this.velocity.x;
    vw.bodyVelocities[o3 + 1] = this.velocity.y;
    vw.bodyVelocities[o3 + 2] = this.velocity.z;

    vw.bodyQuaternions[o4] = this.quaternion.x;
    vw.bodyQuaternions[o4 + 1] = this.quaternion.y;
    vw.bodyQuaternions[o4 + 2] = this.quaternion.z;
    vw.bodyQuaternions[o4 + 3] = this.quaternion.w;

    vw.bodyAngularVelocities[o3] = this.angularVelocity.x;
    vw.bodyAngularVelocities[o3 + 1] = this.angularVelocity.y;
    vw.bodyAngularVelocities[o3 + 2] = this.angularVelocity.z;

    vw.bodyInertiaLocal[o3] = this.inertiaTensor.x;
    vw.bodyInertiaLocal[o3 + 1] = this.inertiaTensor.y;
    vw.bodyInertiaLocal[o3 + 2] = this.inertiaTensor.z;

    vw.bodyInvInertiaLocal[o3] = this.invInertiaTensor.x;
    vw.bodyInvInertiaLocal[o3 + 1] = this.invInertiaTensor.y;
    vw.bodyInvInertiaLocal[o3 + 2] = this.invInertiaTensor.z;

    vw.bodyForces[o3] = this.accumulatedForce.x;
    vw.bodyForces[o3 + 1] = this.accumulatedForce.y;
    vw.bodyForces[o3 + 2] = this.accumulatedForce.z;

    vw.bodyTorques[o3] = this.accumulatedTorque.x;
    vw.bodyTorques[o3 + 1] = this.accumulatedTorque.y;
    vw.bodyTorques[o3 + 2] = this.accumulatedTorque.z;
  }

  /**
   * Reads integrated pose, velocity, and cleared force/torque accumulators from VoxelWorld flat Float32Arrays.
   */
  public syncFromVoxelWorld(): void {
    const vw = this.voxelWorld;
    const o3 = this.slotIndex * 3;
    const o4 = this.slotIndex * 4;

    this.position.set(
      vw.bodyPositions[o3],
      vw.bodyPositions[o3 + 1],
      vw.bodyPositions[o3 + 2],
    );
    this.velocity.set(
      vw.bodyVelocities[o3],
      vw.bodyVelocities[o3 + 1],
      vw.bodyVelocities[o3 + 2],
    );
    this.quaternion.set(
      vw.bodyQuaternions[o4],
      vw.bodyQuaternions[o4 + 1],
      vw.bodyQuaternions[o4 + 2],
      vw.bodyQuaternions[o4 + 3],
    );
    this.angularVelocity.set(
      vw.bodyAngularVelocities[o3],
      vw.bodyAngularVelocities[o3 + 1],
      vw.bodyAngularVelocities[o3 + 2],
    );
    this.accumulatedForce.set(
      vw.bodyForces[o3],
      vw.bodyForces[o3 + 1],
      vw.bodyForces[o3 + 2],
    );
    this.accumulatedTorque.set(
      vw.bodyTorques[o3],
      vw.bodyTorques[o3 + 1],
      vw.bodyTorques[o3 + 2],
    );
  }

  public get mass(): number {
    return this.voxelWorld.bodyMasses[this.slotIndex];
  }

  public set mass(value: number) {
    this.voxelWorld.bodyMasses[this.slotIndex] = value;
  }

  public get invMass(): number {
    return this.voxelWorld.bodyInvMasses[this.slotIndex];
  }

  public set invMass(value: number) {
    this.voxelWorld.bodyInvMasses[this.slotIndex] = value;
  }

  public get linearDamping(): number {
    return this.voxelWorld.bodyLinearDamping[this.slotIndex];
  }

  public set linearDamping(value: number) {
    this.voxelWorld.bodyLinearDamping[this.slotIndex] = value;
  }

  public get angularDamping(): number {
    return this.voxelWorld.bodyAngularDamping[this.slotIndex];
  }

  public set angularDamping(value: number) {
    this.voxelWorld.bodyAngularDamping[this.slotIndex] = value;
  }

  public get isSleeping(): boolean {
    return this.voxelWorld.getBodySleeping(this.slotIndex);
  }

  public set isSleeping(value: boolean) {
    this.voxelWorld.setBodySleeping(this.slotIndex, value);
  }

  /** Accumulated Baumgarte position correction for the current frame/step (capped at 0.5m) */
  public framePositionCorrection = new THREE.Vector3();

  /** True if this body represents a small object/prop or lightweight rig */
  public isSmallObject = false;

  /** Elapsed time (seconds) since the last non-trivial collision impulse */
  public timeSinceLastCollision = Infinity;

  /**
   * FIX 1 & FIX 3: True while the rigid body is undergoing hard ejection from deep penetration (> 0.5m)
   * until penetration drops back below 0.1m. Suppresses voxel damage and point removal during ejection.
   */
  public isEjecting = false;

  /** Maximum contact penetration depth (meters) recorded on the current collision step */
  public maxStepPenetration = 0;

  /** Guard so the one-time outward bounce impulse (mass * 5 m/s) only fires once per hard ejection step */
  public hardEjectionImpulseAppliedThisStep = false;

  /** Active simultaneous contact count per wheel index on the current step (FIX 2) */
  public wheelContactCounts = new Map<number, number>();

  /** Maximum simultaneous active contact count across wheels on the current step (FIX 2) */
  public activeWheelContactCount = 0;

  public resetFramePositionCorrection(): void {
    this.framePositionCorrection.set(0, 0, 0);
    this.hardEjectionImpulseAppliedThisStep = false;
    this.maxStepPenetration = 0;
  }

  /**
   * Records a contact penetration depth on this step and updates `isEjecting` state (FIX 1 & FIX 3):
   * - Enters `isEjecting = true` when penetration > 0.5m (for dynamic bodies with invMass > 0)
   * - Clears `isEjecting = false` when penetration drops back below < 0.1m
   */
  public recordContactPenetration(penetrationMeters: number): void {
    if (!Number.isFinite(penetrationMeters) || penetrationMeters < 0) {
      return;
    }
    if (this.invMass <= 1e-8) {
      this.isEjecting = false;
      this.maxStepPenetration = 0;
      return;
    }
    if (this.framePositionCorrection.lengthSq() === 0 && !this.hardEjectionImpulseAppliedThisStep) {
      this.maxStepPenetration = penetrationMeters;
    } else if (penetrationMeters > this.maxStepPenetration) {
      this.maxStepPenetration = penetrationMeters;
    }
    const ejectThresh =
      PHYSICS_CONFIG.collisionResponse.hardEjectionPenetrationMeters ?? 0.5;
    const clearThresh =
      PHYSICS_CONFIG.collisionResponse.hardEjectionClearPenetrationMeters ?? 0.1;
    if (penetrationMeters > ejectThresh) {
      this.isEjecting = true;
    } else if (
      this.isEjecting &&
      this.maxStepPenetration < clearThresh &&
      penetrationMeters < clearThresh
    ) {
      this.isEjecting = false;
    }
  }

  /**
   * Evaluates end-of-step ejection completion: once max penetration drops below 0.1m,
   * clears `isEjecting` so normal surface contact and damage resume on subsequent frames.
   */
  public updateEjectionStateAfterStep(): void {
    const clearThresh =
      PHYSICS_CONFIG.collisionResponse.hardEjectionClearPenetrationMeters ?? 0.1;
    if (this.isEjecting && this.maxStepPenetration < clearThresh) {
      this.isEjecting = false;
    }
    this.hardEjectionImpulseAppliedThisStep = false;
    this.maxStepPenetration = 0;
  }

  /**
   * FIX 2: Updates the active simultaneous contact point count for a wheel (`wheelIndex`)
   * and returns its rolling friction multiplier (`5.0` when >= 3 contacts in a cavity, `1.0` when 1-2 contacts).
   */
  public setWheelActiveContacts(
    wheelIndex: number,
    contactCount: number,
  ): number {
    const count = Math.max(0, Math.floor(contactCount));
    this.wheelContactCounts.set(wheelIndex, count);
    let maxCount = 0;
    for (const c of this.wheelContactCounts.values()) {
      if (c > maxCount) {
        maxCount = c;
      }
    }
    this.activeWheelContactCount = maxCount;
    return this.getWheelRollingFrictionMultiplier(wheelIndex);
  }

  /**
   * FIX 2: Returns the rolling friction multiplier for `wheelIndex` (or across the vehicle's wheels):
   * - 5.0x when the wheel has 3+ simultaneous collision points (inside a cavity)
   * - 1.0x when contacts drop back to 1-2
   */
  public getWheelRollingFrictionMultiplier(wheelIndex?: number): number {
    const threshold = PHYSICS_CONFIG.hybridWheels.cavityContactThreshold ?? 3;
    const boost =
      PHYSICS_CONFIG.hybridWheels.cavityRollingFrictionMultiplier ?? 5.0;
    const count =
      wheelIndex !== undefined && this.wheelContactCounts.has(wheelIndex)
        ? this.wheelContactCounts.get(wheelIndex)!
        : this.activeWheelContactCount;
    return count >= threshold ? boost : 1.0;
  }

  /**
   * FIX 2: Returns true when the specified wheel (or any wheel on this body) has 3+ simultaneous contacts.
   */
  public isWheelInCavity(wheelIndex?: number): boolean {
    const threshold = PHYSICS_CONFIG.hybridWheels.cavityContactThreshold ?? 3;
    const count =
      wheelIndex !== undefined && this.wheelContactCounts.has(wheelIndex)
        ? this.wheelContactCounts.get(wheelIndex)!
        : this.activeWheelContactCount;
    return count >= threshold;
  }

  // Reusable scratch objects to prevent per-substep GC allocations
  protected _scratchArm = new THREE.Vector3();
  protected _scratchTorque = new THREE.Vector3();
  protected _scratchLocalTorque = new THREE.Vector3();
  protected _scratchInvQuat = new THREE.Quaternion();
  protected _scratchDeltaQuat = new THREE.Quaternion();

  /**
   * Computes world-space velocity at a given world point:
   * v_point = velocity + angularVelocity × (worldPoint - position)
   */
  public velocityAtPoint(
    worldPoint: THREE.Vector3,
    out = new THREE.Vector3(),
  ): THREE.Vector3 {
    this._scratchArm.subVectors(worldPoint, this.position);
    out.crossVectors(this.angularVelocity, this._scratchArm);
    out.add(this.velocity);
    return out;
  }

  /**
   * Recomputes mass, invMass, inertiaTensor, and invInertiaTensor.
   */
  public syncMassProperties(
    totalMass: number,
    inertia: { x: number; y: number; z: number },
    minMassFloor = PHYSICS_CONFIG.minVehicleMassKg,
    minInertiaFloor = PHYSICS_CONFIG.minInertia,
  ): void {
    const safeMass = Math.max(
      minMassFloor,
      Number.isFinite(totalMass) ? totalMass : minMassFloor,
    );
    this.mass = safeMass;
    this.invMass = safeMass > 0 ? 1.0 / safeMass : 0;

    const ix = Math.max(
      minInertiaFloor,
      Number.isFinite(inertia.x) ? inertia.x : minInertiaFloor,
    );
    const iy = Math.max(
      minInertiaFloor,
      Number.isFinite(inertia.y) ? inertia.y : minInertiaFloor,
    );
    const iz = Math.max(
      minInertiaFloor,
      Number.isFinite(inertia.z) ? inertia.z : minInertiaFloor,
    );

    this.inertiaTensor.set(ix, iy, iz);
    this.invInertiaTensor.set(1.0 / ix, 1.0 / iy, 1.0 / iz);
    const o3 = this.slotIndex * 3;
    this.voxelWorld.bodyInertiaLocal[o3] = ix;
    this.voxelWorld.bodyInertiaLocal[o3 + 1] = iy;
    this.voxelWorld.bodyInertiaLocal[o3 + 2] = iz;
    this.voxelWorld.bodyInvInertiaLocal[o3] = 1.0 / ix;
    this.voxelWorld.bodyInvInertiaLocal[o3 + 1] = 1.0 / iy;
    this.voxelWorld.bodyInvInertiaLocal[o3 + 2] = 1.0 / iz;
  }

  /**
   * Applies a continuous linear force (N) at the rigid body's Center of Mass.
   */
  public applyForce(force: THREE.Vector3): void {
    const fx = force.x;
    const fy = force.y;
    const fz = force.z;
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) {
      return;
    }
    if (fx * fx + fy * fy + fz * fz > 1e-6 && this.isSleeping) {
      this.wake();
    }
    this.accumulatedForce.x += fx;
    this.accumulatedForce.y += fy;
    this.accumulatedForce.z += fz;
  }

  /**
   * Applies a continuous world-space torque (N·m) to the rigid body.
   */
  public applyTorque(torque: THREE.Vector3): void {
    const tx = torque.x;
    const ty = torque.y;
    const tz = torque.z;
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) {
      return;
    }
    if (tx * tx + ty * ty + tz * tz > 1e-6 && this.isSleeping) {
      this.wake();
    }
    this.accumulatedTorque.x += tx;
    this.accumulatedTorque.y += ty;
    this.accumulatedTorque.z += tz;
  }

  /**
   * Applies a continuous force (N) at a world-space point, accumulating both linear force
   * and torque = (worldPoint - centerOfMass) × force.
   */
  public applyForceAtPoint(
    force: THREE.Vector3,
    worldPoint: THREE.Vector3,
  ): void {
    const fx = force.x;
    const fy = force.y;
    const fz = force.z;
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) {
      return;
    }
    if (fx * fx + fy * fy + fz * fz > 1e-6 && this.isSleeping) {
      this.wake();
    }
    this.accumulatedForce.x += fx;
    this.accumulatedForce.y += fy;
    this.accumulatedForce.z += fz;

    const rx = worldPoint.x - this.position.x;
    const ry = worldPoint.y - this.position.y;
    const rz = worldPoint.z - this.position.z;
    this.accumulatedTorque.x += ry * fz - rz * fy;
    this.accumulatedTorque.y += rz * fx - rx * fz;
    this.accumulatedTorque.z += rx * fy - ry * fx;
  }

  /**
   * Applies an instantaneous impulse (N·s) at a world-space point:
   * velocity += impulse * invMass
   * angularVelocity += I_world^-1 * ((worldPoint - centerOfMass) × impulse)
   */
  public applyImpulseAtPoint(
    impulse: THREE.Vector3,
    worldPoint: THREE.Vector3,
  ): void {
    const ix = impulse.x;
    const iy = impulse.y;
    const iz = impulse.z;
    if (!Number.isFinite(ix) || !Number.isFinite(iy) || !Number.isFinite(iz)) {
      return;
    }
    const invM = this.invMass;
    if (invM <= 0) return;

    const impSq = ix * ix + iy * iy + iz * iz;
    if (impSq > 1e-4) {
      this.timeSinceLastCollision = 0;
    }
    if (impSq > 1e-8 && this.isSleeping) {
      this.wake();
    }

    this.velocity.x += ix * invM;
    this.velocity.y += iy * invM;
    this.velocity.z += iz * invM;

    const rx = worldPoint.x - this.position.x;
    const ry = worldPoint.y - this.position.y;
    const rz = worldPoint.z - this.position.z;
    const ax = ry * iz - rz * iy;
    const ay = rz * ix - rx * iz;
    const az = rx * iy - ry * ix;

    const qx = this.quaternion.x;
    const qy = this.quaternion.y;
    const qz = this.quaternion.z;
    const qw = this.quaternion.w;

    const iqx = -qx;
    const iqy = -qy;
    const iqz = -qz;
    const t1x = 2 * (iqy * az - iqz * ay);
    const t1y = 2 * (iqz * ax - iqx * az);
    const t1z = 2 * (iqx * ay - iqy * ax);
    const lx = (ax + qw * t1x + iqy * t1z - iqz * t1y) * this.invInertiaTensor.x;
    const ly = (ay + qw * t1y + iqz * t1x - iqx * t1z) * this.invInertiaTensor.y;
    const lz = (az + qw * t1z + iqx * t1y - iqy * t1x) * this.invInertiaTensor.z;

    const t2x = 2 * (qy * lz - qz * ly);
    const t2y = 2 * (qz * lx - qx * lz);
    const t2z = 2 * (qx * ly - qy * lx);
    this.angularVelocity.x += lx + qw * t2x + qy * t2z - qz * t2y;
    this.angularVelocity.y += ly + qw * t2y + qz * t2x - qx * t2z;
    this.angularVelocity.z += lz + qw * t2z + qx * t2y - qy * t2x;
  }

  /**
   * Marks that a collision occurred on this step so snap-to-rest waits for the impact to settle.
   */
  public recordCollisionEvent(): void {
    this.timeSinceLastCollision = 0;
  }

  /**
   * Enters sleep mode and zeroes out linear and angular velocities.
   */
  public sleep(): void {
    this.isSleeping = true;
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.accumulatedForce.set(0, 0, 0);
    this.accumulatedTorque.set(0, 0, 0);
    this.syncToVoxelWorld();
  }

  /**
   * Wakes the rigid body and resets sleepTimer.
   */
  public wake(): void {
    this.isSleeping = false;
    this.sleepTimer = 0;
  }

  protected isConsideredSmallObject(): boolean {
    return this.isSmallObject;
  }

  /**
   * Updates sleep state:
   * - Small objects (`isSmallObject` or mass < 250kg or <= 20 collision points):
   *   sleep when linear speed < 0.1 m/s for 0.5 seconds (faster than 1.0s for vehicles).
   * - Full vehicles / props:
   *   sleep when linear and angular velocity squared are below threshold for 1.0s.
   * Any non-trivial motion or external force wakes the body immediately.
   */
  public updateSleep(dt: number, customDurationSec?: number): void {
    const linVelSq = this.velocity.lengthSq();
    const angVelSq = this.angularVelocity.lengthSq();
    const hasActiveForce =
      this.accumulatedForce.lengthSq() > 1.0 ||
      this.accumulatedTorque.lengthSq() > 1.0;

    const isSmall = this.isConsideredSmallObject();

    const linThreshSq = isSmall
      ? PHYSICS_CONFIG.smallObjectSleepLinearVelSqThreshold
      : PHYSICS_CONFIG.sleepLinearVelSqThreshold;
    const angThreshSq = isSmall
      ? PHYSICS_CONFIG.smallObjectSleepAngularVelSqThreshold
      : PHYSICS_CONFIG.sleepAngularVelSqThreshold;
    const durationThresh =
      customDurationSec !== undefined
        ? customDurationSec
        : isSmall
          ? PHYSICS_CONFIG.smallObjectSleepTimeThresholdSec
          : PHYSICS_CONFIG.sleepTimeThresholdSec;

    if (
      linVelSq < linThreshSq &&
      angVelSq < angThreshSq &&
      !hasActiveForce
    ) {
      this.sleepTimer += dt;
      if (this.sleepTimer >= durationThresh) {
        this.sleep();
      }
    } else {
      if (this.isSleeping) {
        this.wake();
      } else {
        this.sleepTimer = 0;
      }
    }
  }

  /**
   * Semi-implicit Euler integration step syncing plain Vector3/Quaternion state to VoxelWorld,
   * running VoxelWorld.integrateBodySlot() on flat Float32Arrays, and syncing integrated results back.
   */
  public integrateSubstep(subDt: number): boolean {
    if (subDt <= 0 || !Number.isFinite(subDt)) {
      return false;
    }

    this.timeSinceLastCollision += subDt;
    this.framePositionCorrection.set(0, 0, 0);
    this.hardEjectionImpulseAppliedThisStep = false;
    this.maxStepPenetration = 0;

    const vw = this.voxelWorld;
    const slot = this.slotIndex;
    vw.bodyMaxLinearSpeed[slot] = PHYSICS_CONFIG.maxLinearSpeedMPS;
    vw.bodyMaxAngularSpeed[slot] = PHYSICS_CONFIG.maxAngularSpeedRadPS;

    this.syncToVoxelWorld();
    const ok = vw.integrateBodySlot(slot, subDt);
    this.syncFromVoxelWorld();
    // Mark integrated so VoxelWorld.integratePhysics() does not double-integrate this slot
    vw.bodyIntegratedThisStep[slot] = 1;
    return ok;
  }

  public dispose(): void {
    if (this._ownsSlot && !this._slotReleased) {
      this._slotReleased = true;
      this.voxelWorld.releaseBodySlot(this.slotIndex);
    }
  }
}

/**
 * Vehicle-specialized 6-DOF Rigid Body (`VehicleRigidBody extends RigidBodyCore`).
 * Adds sampled surface voxel `collisionPoints`, voxel destruction point removal,
 * structural integrity & mass recalculation hooks.
 */
export class VehicleRigidBody extends RigidBodyCore {
  public collisionPoints: Array<
    RigidBodyCollisionPoint | SampledCollisionPoint
  > = [];

  constructor(voxelWorld?: VoxelWorld, bodyId?: number) {
    super(voxelWorld, bodyId);
  }

  protected override isConsideredSmallObject(): boolean {
    return (
      this.isSmallObject ||
      (this.collisionPoints.length > 0 &&
        (this.mass < PHYSICS_CONFIG.smallObjectMaxMassKg ||
          this.collisionPoints.length <= 20))
    );
  }

  /**
   * Removes a collision point by its bit-packed voxelKey when a voxel is destroyed.
   * FIX 3: Suppressed while `isEjecting` is true so the collision point set stays 100% stable during hard ejection!
   */
  public removeCollisionPointByKey(voxelKey: number): void {
    if (this.isEjecting) {
      return;
    }
    for (let i = this.collisionPoints.length - 1; i >= 0; i--) {
      if (this.collisionPoints[i].voxelKey === voxelKey) {
        this.collisionPoints.splice(i, 1);
      }
    }
  }

  public override dispose(): void {
    this.collisionPoints.length = 0;
    this.wheelContactCounts.clear();
    this.activeWheelContactCount = 0;
    super.dispose();
  }
}

export { VehicleRigidBody as CustomRigidBody };
