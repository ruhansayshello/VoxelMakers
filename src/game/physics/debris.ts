import * as THREE from 'three';
import {
  VoxelWorld,
  getActiveVoxelWorld,
} from '../../engine/world/VoxelWorld';
import { MAT, VOXEL_SIZE } from '../constants.ts';
import { PHYSICS_CONFIG } from './physicsConfig.ts';
import {
  unifiedEngineTelemetry,
  writeInstanceMatrixEulerXYZFast,
} from '../unifiedVoxelEngine.ts';

export interface DebrisWorldInterface {
  probeGroundBelow: (
    wx: number,
    startY: number,
    wz: number,
    maxDist?: number,
  ) => { y: number; mat: number } | null;
  sampleSurfaceHeightFast?: (wx: number, wz: number) => number;
  setVoxelAtWorld?: (wx: number, wy: number, wz: number, matId: number) => void;
}

export interface VoxelDebrisParticle {
  slotIndex: number;
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  angularVelocity: THREE.Vector3;
  mass: number;
  colorHex: number;
  matId: number;
  grounded: boolean;
  sleeping: boolean;
  staticContactTimer: number;
  fadeTimer: number;
  opacity: number;
  ageSec: number;
}

export interface DebrisWakeVehicleLike {
  position: THREE.Vector3;
  velocity?: THREE.Vector3;
  inBuildMode?: boolean;
}

const _dummyObj = new THREE.Object3D();
const _tmpColor = new THREE.Color();
const _outwardDir = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

/**
 * Step 2.6 & BUG A.1: Voxel Break-Off as Debris Particles with 0.5s Sleep Mode.
 * - Uses a single shared THREE.InstancedMesh allocated once with capacity 200 (zero per-frame allocations)
 * - Simulates each debris cube (1x1x1 voxel size) as a 1kg free-falling rigid body with gravity, drag, and ground contact
 * - Caps total active debris at 200 per session, recycling the oldest slot when exceeded
 * - BUG A.1: When a debris particle has been stationary on the ground for 0.5 seconds, freezes it (sleeping = true)
 *   and skips active physics & matrix updates (just renders it), waking only if another vehicle collides with it
 * - After 5 seconds of static ground contact, fades out over 1 second and removes the particle
 */
export class VoxelDebrisSystem {
  public readonly voxelWorld: VoxelWorld;
  public readonly capacity: number;
  public readonly instancedMesh: THREE.InstancedMesh;
  public readonly particles: VoxelDebrisParticle[];
  public cursor: number = 0;
  public activeCount: number = 0;
  public sleepingCount: number = 0;
  public convertToStaticWorldVoxel: boolean;

  constructor(
    scene?: THREE.Scene | null,
    capacity = PHYSICS_CONFIG.debris.maxActiveDebris,
    voxelWorld: VoxelWorld = getActiveVoxelWorld(),
  ) {
    this.voxelWorld = voxelWorld;
    this.capacity = Math.max(1, capacity);
    this.convertToStaticWorldVoxel =
      PHYSICS_CONFIG.debris.convertToWorldVoxelOnStop;

    const geo = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0.12,
    });

    this.instancedMesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.castShadow = false;
    this.instancedMesh.receiveShadow = false;
    this.instancedMesh.frustumCulled = false;

    _dummyObj.position.set(0, -1000, 0);
    _dummyObj.scale.set(0, 0, 0);
    _dummyObj.updateMatrix();
    _tmpColor.setHex(0xffffff);

    this.particles = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      this.instancedMesh.setMatrixAt(i, _dummyObj.matrix);
      this.instancedMesh.setColorAt(i, _tmpColor);
      this.particles[i] = {
        slotIndex: -1,
        active: false,
        position: new THREE.Vector3(0, -1000, 0),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        angularVelocity: new THREE.Vector3(),
        mass: PHYSICS_CONFIG.debris.debrisMassKg,
        colorHex: 0xffffff,
        matId: MAT.ALLOY_BLUE,
        grounded: false,
        sleeping: false,
        staticContactTimer: 0,
        fadeTimer: 0,
        opacity: 1.0,
        ageSec: 0,
      };
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    if (scene) {
      scene.add(this.instancedMesh);
    }
  }

  /**
   * Spawns a 1x1x1 voxel debris cube at `worldPos` with parent vehicle velocity + outward impulse.
   * Recycles the oldest debris slot when total active debris exceeds `capacity` (200).
   */
  public spawnDebrisVoxel(
    worldPos: THREE.Vector3,
    parentVelocity: THREE.Vector3,
    impactOrigin: THREE.Vector3 | null,
    colorHex: number,
    matId: number = MAT.ALLOY_BLUE,
    customSpeedRange?: { minMPS: number; maxMPS: number },
  ): VoxelDebrisParticle {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;

    const p = this.particles[idx];
    if (!p.active) {
      this.activeCount++;
    } else if (p.sleeping) {
      this.sleepingCount = Math.max(0, this.sleepingCount - 1);
    }

    p.active = true;
    p.position.copy(worldPos);
    p.mass = PHYSICS_CONFIG.debris.debrisMassKg;
    p.colorHex = colorHex;
    p.matId = matId;
    p.grounded = false;
    p.sleeping = false;
    p.staticContactTimer = 0;
    p.fadeTimer = 0;
    p.opacity = 1.0;
    p.ageSec = 0;

    if (impactOrigin) {
      _outwardDir.subVectors(worldPos, impactOrigin);
      if (_outwardDir.lengthSq() < 1e-4) {
        _outwardDir.set(
          Math.random() - 0.5,
          0.5 + Math.random() * 0.5,
          Math.random() - 0.5,
        );
      }
      _outwardDir.normalize();
      _outwardDir.y = Math.max(0.25, _outwardDir.y + 0.25);
      _outwardDir.normalize();
    } else {
      _outwardDir
        .set(
          Math.random() - 0.5,
          0.35 + Math.random() * 0.65,
          Math.random() - 0.5,
        )
        .normalize();
    }

    const cfg = PHYSICS_CONFIG.debris;
    const minSpeed = customSpeedRange
      ? customSpeedRange.minMPS
      : cfg.outwardImpulseMin;
    const maxSpeed = customSpeedRange
      ? customSpeedRange.maxMPS
      : cfg.outwardImpulseMax;
    const impulseMag = minSpeed + Math.random() * (maxSpeed - minSpeed);

    // Initial velocity = parent vehicle's velocity + outward impulse
    p.velocity
      .copy(parentVelocity)
      .addScaledVector(
        _outwardDir,
        customSpeedRange ? impulseMag : impulseMag / Math.max(0.1, p.mass),
      );

    // Random small spin
    p.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    p.angularVelocity.set(
      (Math.random() - 0.5) * 8.0,
      (Math.random() - 0.5) * 8.0,
      (Math.random() - 0.5) * 8.0,
    );

    if (p.slotIndex >= 0) {
      this.voxelWorld.releaseDebris(p.slotIndex);
    }
    const maxLife =
      PHYSICS_CONFIG.debris.staticFadeDelaySec +
      PHYSICS_CONFIG.debris.fadeDurationSec;
    p.slotIndex = this.voxelWorld.spawnDebris(
      p.position.x,
      p.position.y,
      p.position.z,
      p.velocity.x,
      p.velocity.y,
      p.velocity.z,
      colorHex,
      VOXEL_SIZE,
      maxLife,
    );
    this.syncParticleToVoxelWorld(p);

    _tmpColor.setHex(colorHex);
    this.instancedMesh.setColorAt(idx, _tmpColor);
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    const instArray = this.instancedMesh.instanceMatrix.array as Float32Array;
    writeInstanceMatrixEulerXYZFast(
      instArray,
      idx,
      p.position.x,
      p.position.y,
      p.position.z,
      p.rotation.x,
      p.rotation.y,
      p.rotation.z,
      1.0,
    );
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    return p;
  }

  private syncParticleToVoxelWorld(p: VoxelDebrisParticle): void {
    const slot = p.slotIndex;
    if (slot < 0) return;
    const vw = this.voxelWorld;
    const o3 = slot * 3;
    const o4 = slot * 4;
    vw.debrisPositions[o3] = p.position.x;
    vw.debrisPositions[o3 + 1] = p.position.y;
    vw.debrisPositions[o3 + 2] = p.position.z;
    vw.debrisVelocities[o3] = p.velocity.x;
    vw.debrisVelocities[o3 + 1] = p.velocity.y;
    vw.debrisVelocities[o3 + 2] = p.velocity.z;
    _tmpQuat.setFromEuler(p.rotation);
    vw.debrisQuaternions[o4] = _tmpQuat.x;
    vw.debrisQuaternions[o4 + 1] = _tmpQuat.y;
    vw.debrisQuaternions[o4 + 2] = _tmpQuat.z;
    vw.debrisQuaternions[o4 + 3] = _tmpQuat.w;
    vw.debrisAngularVelocities[o3] = p.angularVelocity.x;
    vw.debrisAngularVelocities[o3 + 1] = p.angularVelocity.y;
    vw.debrisAngularVelocities[o3 + 2] = p.angularVelocity.z;
    vw.debrisResting[slot] = p.sleeping ? 1 : 0;
    const totalLife =
      PHYSICS_CONFIG.debris.staticFadeDelaySec +
      PHYSICS_CONFIG.debris.fadeDurationSec;
    vw.debrisLifetimes[slot] = Math.max(0, totalLife - p.staticContactTimer);
  }

  /**
   * BUG A.1: Wakes any sleeping debris particles within `radiusMeters` of `colliderWorldPos`
   * (e.g. when a vehicle collides with or drives through settled debris).
   */
  public wakeSleepingDebrisNear(
    colliderWorldPos: THREE.Vector3,
    radiusMeters = PHYSICS_CONFIG.debris.wakeRadiusMeters,
    colliderVelocity?: THREE.Vector3,
  ): number {
    if (this.sleepingCount === 0) return 0;
    const radSq = radiusMeters * radiusMeters;
    let woken = 0;

    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.active || !p.sleeping) continue;
      const distSq = p.position.distanceToSquared(colliderWorldPos);
      if (distSq <= radSq) {
        p.sleeping = false;
        p.grounded = false;
        p.staticContactTimer = 0;
        p.fadeTimer = 0;
        p.opacity = 1.0;
        _outwardDir.subVectors(p.position, colliderWorldPos);
        if (_outwardDir.lengthSq() < 1e-4) {
          _outwardDir.set(0, 1, 0);
        } else {
          _outwardDir.normalize();
        }
        _outwardDir.y = Math.max(0.35, _outwardDir.y + 0.35);
        _outwardDir.normalize();
        p.velocity.copy(_outwardDir).multiplyScalar(4.2);
        if (colliderVelocity) {
          p.velocity.addScaledVector(colliderVelocity, 0.45);
        }
        p.angularVelocity.set(
          (Math.random() - 0.5) * 6.0,
          (Math.random() - 0.5) * 6.0,
          (Math.random() - 0.5) * 6.0,
        );
        this.syncParticleToVoxelWorld(p);
        woken++;
        this.sleepingCount = Math.max(0, this.sleepingCount - 1);
      }
    }
    return woken;
  }

  /**
   * Steps all active debris particles each frame:
   * - Applies voxel-scale gravity and air drag to awake, ungrounded particles
   * - Raycasts down for ground contact
   * - BUG A.1: Freezes stationary grounded debris into `sleeping = true` after 0.5s (`sleepDelaySec`),
   *   skipping physics & matrix updates until woken by a vehicle collision or until the 5s fade-out begins
   */
  public update(
    dt: number,
    world?: DebrisWorldInterface | null,
    vehicles?: readonly DebrisWakeVehicleLike[] | null,
  ): void {
    if (dt <= 0 || this.activeCount === 0) {
      return;
    }

    const cfg = PHYSICS_CONFIG.debris;
    const halfVoxel = VOXEL_SIZE * 0.5;
    let matrixDirty = false;
    let colorDirty = false;
    let currentActive = 0;
    let currentSleeping = 0;

    // Wake sleeping debris if any moving vehicle collides with / drives into them (skip lightweight props)
    if (this.sleepingCount > 0 && vehicles && vehicles.length > 0) {
      for (let v = 0; v < vehicles.length; v++) {
        const veh = vehicles[v];
        if (!veh || veh.inBuildMode || (veh as any).isVoxelEntity) continue;
        if (!veh.velocity || veh.velocity.lengthSq() > 0.25) {
          this.wakeSleepingDebrisNear(
            veh.position,
            cfg.wakeRadiusMeters,
            veh.velocity,
          );
        }
      }
    }

    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.active) {
        continue;
      }

      p.ageSec += dt;

      if (!p.grounded) {
        // Apply gravity and linear drag
        p.velocity.y -= cfg.gravityMPS2 * dt;
        const dragFactor = Math.max(0, 1.0 - cfg.linearDrag * dt);
        p.velocity.multiplyScalar(dragFactor);

        // Advance position and spin
        p.position.addScaledVector(p.velocity, dt);
        p.rotation.x += p.angularVelocity.x * dt;
        p.rotation.y += p.angularVelocity.y * dt;
        p.rotation.z += p.angularVelocity.z * dt;

        // Ground contact check: use O(1) non-allocating surface height query when available
        // so 30 m/s C4 debris flying over distant horizon chunks never allocates 512KB full-3D chunks!
        let groundY: number | null = null;
        if (world) {
          if (typeof world.sampleSurfaceHeightFast === 'function') {
            groundY = world.sampleSurfaceHeightFast(p.position.x, p.position.z);
            unifiedEngineTelemetry.fastHeightmapDebrisProbes++;
          } else {
            const hit = world.probeGroundBelow(
              p.position.x,
              p.position.y + 0.3,
              p.position.z,
              1.5,
            );
            groundY = hit ? hit.y : null;
          }
        } else {
          groundY = 0;
        }

        if (groundY !== null && p.position.y - halfVoxel <= groundY) {
          p.position.y = groundY + halfVoxel;

          if (this.convertToStaticWorldVoxel && world?.setVoxelAtWorld) {
            world.setVoxelAtWorld(
              p.position.x,
              p.position.y,
              p.position.z,
              p.matId,
            );
            this.deactivateIndex(i);
            matrixDirty = true;
            continue;
          }

          if (Math.abs(p.velocity.y) > 1.35) {
            p.velocity.y = -p.velocity.y * cfg.bounceRestitution;
            p.velocity.x *= cfg.groundFriction;
            p.velocity.z *= cfg.groundFriction;
            p.angularVelocity.multiplyScalar(0.65);
          } else {
            p.velocity.set(0, 0, 0);
            p.angularVelocity.set(0, 0, 0);
            p.grounded = true;
            p.staticContactTimer = 0;
          }
        }

        currentActive++;
        this.syncParticleToVoxelWorld(p);
        const instArray = this.instancedMesh.instanceMatrix.array as Float32Array;
        const s = Math.max(0.01, p.opacity);
        writeInstanceMatrixEulerXYZFast(
          instArray,
          i,
          p.position.x,
          p.position.y,
          p.position.z,
          p.rotation.x,
          p.rotation.y,
          p.rotation.z,
          s,
        );
        matrixDirty = true;
      } else {
        // Grounded particle: increment static timer, enter sleep mode at 0.5s, and skip matrix updates until 5.0s fade!
        p.staticContactTimer += dt;
        if (!p.sleeping && p.staticContactTimer >= cfg.sleepDelaySec) {
          p.sleeping = true;
          if (p.slotIndex >= 0) {
            this.voxelWorld.setDebrisResting(p.slotIndex, true);
          }
        }
        if (p.slotIndex >= 0) {
          const totalLife = cfg.staticFadeDelaySec + cfg.fadeDurationSec;
          this.voxelWorld.debrisLifetimes[p.slotIndex] = Math.max(
            0,
            totalLife - p.staticContactTimer,
          );
        }

        if (p.staticContactTimer >= cfg.staticFadeDelaySec) {
          p.fadeTimer += dt;
          const fadeProgress = Math.min(
            1.0,
            p.fadeTimer / Math.max(0.05, cfg.fadeDurationSec),
          );
          p.opacity = 1.0 - fadeProgress;

          if (fadeProgress >= 1.0) {
            this.deactivateIndex(i);
            matrixDirty = true;
            continue;
          }

          // Darken color and shrink scale during final 1s fade-out
          _tmpColor.setHex(p.colorHex).multiplyScalar(Math.max(0.15, p.opacity));
          this.instancedMesh.setColorAt(i, _tmpColor);
          colorDirty = true;

          const instArray = this.instancedMesh.instanceMatrix.array as Float32Array;
          const s = Math.max(0.01, p.opacity);
          writeInstanceMatrixEulerXYZFast(
            instArray,
            i,
            p.position.x,
            p.position.y,
            p.position.z,
            p.rotation.x,
            p.rotation.y,
            p.rotation.z,
            s,
          );
          matrixDirty = true;
        }

        currentActive++;
        if (p.sleeping) {
          currentSleeping++;
        }
      }
    }

    this.activeCount = currentActive;
    this.sleepingCount = currentSleeping;
    if (matrixDirty) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (colorDirty && this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  private deactivateIndex(index: number): void {
    const p = this.particles[index];
    if (p.slotIndex >= 0) {
      this.voxelWorld.releaseDebris(p.slotIndex);
      p.slotIndex = -1;
    }
    p.active = false;
    p.sleeping = false;
    p.grounded = false;
    p.opacity = 0;
    p.position.set(0, -1000, 0);
    const instArray = this.instancedMesh.instanceMatrix.array as Float32Array;
    writeInstanceMatrixEulerXYZFast(
      instArray,
      index,
      0,
      -1000,
      0,
      0,
      0,
      0,
      0,
    );
  }

  public clearAll(): void {
    _dummyObj.position.set(0, -1000, 0);
    _dummyObj.scale.set(0, 0, 0);
    _dummyObj.updateMatrix();
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.slotIndex >= 0) {
        this.voxelWorld.releaseDebris(p.slotIndex);
        p.slotIndex = -1;
      }
      p.active = false;
      p.sleeping = false;
      p.grounded = false;
      this.instancedMesh.setMatrixAt(i, _dummyObj.matrix);
    }
    this.activeCount = 0;
    this.sleepingCount = 0;
    this.cursor = 0;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    this.clearAll();
    if (this.instancedMesh.parent) {
      this.instancedMesh.parent.remove(this.instancedMesh);
    }
    this.instancedMesh.geometry.dispose();
    if (this.instancedMesh.material instanceof THREE.Material) {
      this.instancedMesh.material.dispose();
    }
  }
}

