import * as THREE from 'three';
import {
  VOXEL_SIZE,
  TOTAL_VX,
  TOTAL_VZ,
  WATER_VY,
  STATIC_WATER_TOP_VY,
  MAT,
  MAT_INFO,
} from './constants.ts';
import { greedyMeshBoundedArrays } from './physicsMath.ts';
import { SoundFX } from './sound.ts';
import {
  updateOrCreateDynamicMeshBuffer,
  type MicroVoxelWorld,
  type MicroVoxelChunk,
} from './world.ts';
import type { ModularVehicleRig } from './vehicle.ts';
import { VoxelDebrisSystem } from './physics/debris.ts';
import { TerrainEntity, terrainEntityManager } from './physics/terrainEntity.ts';
import {
  applyDamageToVoxel,
  beginDestructionBatch,
  flushDestructionBatch,
} from './physics/destruction.ts';
import { packVoxelKey } from './physics/collisionPoints.ts';
import { areAITeamsHostile, type VehicleAITeam } from './aiPilot.ts';

interface DebrisParticle {
  active: boolean;
  smoke: boolean;
  fullVoxel: boolean;
  popOut: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  color: number;
  scale: number;
  life: number;
}

export type WeaponProjectileKind = 'PLASMA' | 'MINIGUN' | 'ROCKET' | 'BOMB';

interface PlasmaShell {
  mesh: THREE.Object3D;
  prevPos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  initialLife: number;
  canHitRig: boolean;
  sourceRig?: any;
  kind: WeaponProjectileKind;
  craterRadius: number;
  gravity: number;
  smokeTimer: number;
}

interface StickyBomb {
  mesh: THREE.Mesh;
  prevPos: THREE.Vector3;
  vel: THREE.Vector3;
  stuck: boolean;
  stuckToRig: boolean;
  stuckRig?: ModularVehicleRig | null;
  stuckTerrainEntity?: TerrainEntity | null;
  rigLocalPos: THREE.Vector3;
  timer: number;
}

export interface BulletSegmentRayHit {
  target: 'vehicle' | 'world' | 'terrainEntity';
  rig?: ModularVehicleRig;
  terrainEntity?: TerrainEntity;
  vx: number;
  vy: number;
  vz: number;
  mat: number;
  distance: number;
  worldPos: THREE.Vector3;
}

const _bulletSegVec = new THREE.Vector3();
const _bulletSegDir = new THREE.Vector3();
const _bulletImpulse = new THREE.Vector3();

/**
 * BUG 1 Fix: Performs an exact 3D Amanatides & Woo DDA voxel raycast along a bullet's step
 * segment from `prevPos` to `currPos` against all candidate vehicles and the voxel world.
 * Returns the VERY FIRST voxel the ray hits along the segment so fast-moving projectiles
 * (58 - 92 m/s) never tunnel through thin walls or vehicle hulls between physics steps.
 */
export function raycastBulletSegmentDDA(
  prevPos: THREE.Vector3,
  currPos: THREE.Vector3,
  world: {
    raycastWorldVoxels?: (
      origin: THREE.Vector3,
      dir: THREE.Vector3,
      maxDist?: number,
      startOffset?: number,
    ) => {
      vx: number;
      vy: number;
      vz: number;
      mat: number;
      distance: number;
      worldPos: THREE.Vector3;
    } | null;
    isSolidAtWorld?: (wx: number, wy: number, wz: number) => boolean;
  } | null,
  rigs: ReadonlyArray<ModularVehicleRig>,
  canHitRig: boolean,
  sourceRig?: any,
  allowHitSourceRig = false,
): BulletSegmentRayHit | null {
  _bulletSegVec.subVectors(currPos, prevPos);
  const segLen = _bulletSegVec.length();
  if (segLen < 1e-6) {
    return null;
  }
  _bulletSegDir.copy(_bulletSegVec).divideScalar(segLen);

  let bestHit: BulletSegmentRayHit | null = null;

  if (canHitRig && rigs.length > 0) {
    for (let i = 0; i < rigs.length; i++) {
      const r = rigs[i];
      if (!r || r.inBuildMode) continue;
      if (r === sourceRig && !allowHitSourceRig) continue;
      if (sourceRig?.aiConfig?.enabled && !r.isVoxelEntity) {
        const srcTeam: VehicleAITeam = sourceRig.aiConfig.team || 'RED';
        const hitTeam: VehicleAITeam = r.isLocalPlayerOccupied
          ? 'PLAYER'
          : r.aiConfig?.enabled
            ? r.aiConfig.team
            : 'PLAYER';
        if (!areAITeamsHostile(srcTeam, hitTeam)) continue;
      }

      if (typeof r.raycastVehicle === 'function') {
        const vHit = r.raycastVehicle(prevPos, _bulletSegDir, segLen);
        if (vHit && vHit.distance <= segLen + 1e-4) {
          if (!bestHit || vHit.distance < bestHit.distance) {
            bestHit = {
              target: 'vehicle',
              rig: r,
              vx: vHit.vx,
              vy: vHit.vy,
              vz: vHit.vz,
              mat: vHit.mat,
              distance: vHit.distance,
              worldPos: vHit.worldPos.clone(),
            };
          }
        }
      } else if (
        typeof r.isWorldPointSolid === 'function' &&
        r.isWorldPointSolid(currPos.x, currPos.y, currPos.z)
      ) {
        if (!bestHit || segLen < bestHit.distance) {
          bestHit = {
            target: 'vehicle',
            rig: r,
            vx: 0,
            vy: 0,
            vz: 0,
            mat: MAT.ALLOY_BLUE,
            distance: segLen,
            worldPos: currPos.clone(),
          };
        }
      }
    }
  }

  if (world) {
    if (typeof world.raycastWorldVoxels === 'function') {
      const wHit = world.raycastWorldVoxels(prevPos, _bulletSegDir, segLen, 0);
      if (wHit && wHit.distance <= segLen + 1e-4) {
        if (!bestHit || wHit.distance < bestHit.distance) {
          bestHit = {
            target: 'world',
            vx: wHit.vx,
            vy: wHit.vy,
            vz: wHit.vz,
            mat: wHit.mat,
            distance: wHit.distance,
            worldPos: wHit.worldPos.clone(),
          };
        }
      }
    } else if (
      typeof world.isSolidAtWorld === 'function' &&
      world.isSolidAtWorld(currPos.x, currPos.y, currPos.z)
    ) {
      if (!bestHit) {
        bestHit = {
          target: 'world',
          vx: Math.floor(currPos.x / VOXEL_SIZE),
          vy: Math.floor(currPos.y / VOXEL_SIZE),
          vz: Math.floor(currPos.z / VOXEL_SIZE),
          mat: MAT.ROCK,
          distance: segLen,
          worldPos: currPos.clone(),
        };
      }
    }
  }

  // Also collide bullets/rockets/bombs against active falling & resting TerrainEntity structures
  const maxEntDist = bestHit ? bestHit.distance : segLen;
  const entHit = TerrainEntity.raycastSegment(prevPos, _bulletSegDir, maxEntDist);
  if (entHit && entHit.distance <= maxEntDist + 1e-4) {
    bestHit = {
      target: 'terrainEntity',
      terrainEntity: entHit.entity,
      vx: Math.floor(entHit.worldPos.x / VOXEL_SIZE),
      vy: Math.floor(entHit.worldPos.y / VOXEL_SIZE),
      vz: Math.floor(entHit.worldPos.z / VOXEL_SIZE),
      mat: entHit.mat,
      distance: entHit.distance,
      worldPos: entHit.worldPos,
    };
  }

  return bestHit;
}

export interface DetachedModuleAttachment {
  group: THREE.Group;
  localOffset: THREE.Vector3;
}

interface DetachedIslandChunk {
  group: THREE.Group;
  voxelMesh: THREE.Mesh | null;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  lowSpeedTimer: number;
  sleeping: boolean;
  sampleColor: number;
}

export interface DebrisThrottleEvaluation {
  shouldDespawn: boolean;
  sleeping: boolean;
  nextLowSpeedTimer: number;
}

export const DEBRIS_MAX_DIST_METERS = 75.0;
export const DEBRIS_MAX_DIST_SQ = DEBRIS_MAX_DIST_METERS * DEBRIS_MAX_DIST_METERS;
export const DEBRIS_SLEEP_SPEED_MPS = 0.1;
export const DEBRIS_SLEEP_DURATION_SEC = 1.5;

/**
 * Pure helper evaluating distance-based despawning (>75m from active player/camera)
 * and rigid-body sleep freezing (linear speed < 0.1 m/s for 1.5 seconds).
 */
export function evaluateDebrisChunkThrottling(
  speedMPS: number,
  lowSpeedTimer: number,
  distSqToCamera: number,
  dt: number,
): DebrisThrottleEvaluation {
  if (distSqToCamera > DEBRIS_MAX_DIST_SQ) {
    return {
      shouldDespawn: true,
      sleeping: true,
      nextLowSpeedTimer: lowSpeedTimer,
    };
  }
  const nextTimer = speedMPS < DEBRIS_SLEEP_SPEED_MPS ? lowSpeedTimer + dt : 0;
  const sleeping = nextTimer >= DEBRIS_SLEEP_DURATION_SEC;
  return {
    shouldDespawn: false,
    sleeping,
    nextLowSpeedTimer: nextTimer,
  };
}

interface SpeedStreak {
  offsetX: number;
  offsetY: number;
  phaseZ: number;
  speedMult: number;
}

const _dummy = new THREE.Object3D();
const _colorTmp = new THREE.Color();
const _nextPos = new THREE.Vector3();
const _velDir = new THREE.Vector3();
const _streakRight = new THREE.Vector3();
const _streakUp = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

function clearDetachedModuleAttachments(
  group: THREE.Group,
  keepVoxelMesh: THREE.Mesh | null,
): void {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const child = group.children[i];
    if (child === keepVoxelMesh) continue;
    group.remove(child);
    child.traverse((sub: any) => {
      if (sub.isMesh && sub.geometry && !sub.geometry.userData?.isSharedPrimitive) {
        sub.geometry.dispose();
      }
    });
  }
}

export class VoxelFXSystem {
  public scene: THREE.Scene;
  public world: MicroVoxelWorld;
  public rig: ModularVehicleRig | null = null;
  public rigs: ModularVehicleRig[] = [];
  public mapHazards: any[] = [];
  public onCraterCarved:
    | ((wx: number, wy: number, wz: number, radiusVoxels: number) => void)
    | null = null;
  public onCraterDamageHazards:
    | ((wx: number, wy: number, wz: number, radiusVoxels: number) => void)
    | null = null;
  public raycastAndDamageHazards:
    | ((
        prevPos: THREE.Vector3,
        nextPos: THREE.Vector3,
        craterRadius: number,
        forceExplode: boolean,
      ) => { worldPos: THREE.Vector3 } | null)
    | null = null;
  // #4 — Pre-allocated 1000-instance InstancedMesh debris pool (zero per-impact Mesh allocations, 1 draw call)
  public maxDebris = 1000;
  public userParticleMultiplier = 1.0;
  public instanced: THREE.InstancedMesh;
  public voxelDebrisSystem: VoxelDebrisSystem;
  public debrisPool: DebrisParticle[];
  public debrisCursor = 0;
  private debrisColorDirty = false;
  public shells: PlasmaShell[] = [];
  public bombs: StickyBomb[] = [];
  public detachedChunks: DetachedIslandChunk[] = [];
  private shellMeshPool: Record<WeaponProjectileKind, THREE.Object3D[]> = {
    PLASMA: [],
    MINIGUN: [],
    ROCKET: [],
    BOMB: [],
  };
  private bombMeshPool: THREE.Mesh[] = [];
  private detachedChunkPool: DetachedIslandChunk[] = [];
  public trauma = 0;
  public hitstopTimer = 0;
  public voxelsDestroyedCount = 0;

  // High-Speed 3D Aerodynamic Wind Streaks
  private streakCount = 54;
  private streaks: SpeedStreak[];
  private speedLinePositions: Float32Array;
  private speedLinesGeo: THREE.BufferGeometry;
  private speedLinesMat: THREE.LineBasicMaterial;
  public speedLinesMesh: THREE.LineSegments;

  private shellGeo: THREE.BoxGeometry;
  private tracerGeo: THREE.BoxGeometry;
  private rocketBodyGeo: THREE.CylinderGeometry;
  private rocketNoseGeo: THREE.ConeGeometry;
  private bombBodyGeo: THREE.CylinderGeometry;
  private playerShellMat: THREE.MeshStandardMaterial;
  private tracerShellMat: THREE.MeshStandardMaterial;
  private rocketBodyMat: THREE.MeshStandardMaterial;
  private rocketNoseMat: THREE.MeshStandardMaterial;
  private bombShellMat: THREE.MeshStandardMaterial;
  private stickyBombMat: THREE.MeshStandardMaterial;
  private bombGeo: THREE.BoxGeometry;

  // 512-Quad Ring-Buffer Surface Decals (Skidmarks, Tank Tread Imprints & Explosion Scorches)
  public maxDecals = 512;
  public decalInstanced: THREE.InstancedMesh;
  private decalGeo: THREE.PlaneGeometry;
  private decalMat: THREE.MeshBasicMaterial;
  public decalCursor = 0;

  // Active Thermal Flare Decoys (attract AI bot turrets & target drones)
  public activeFlares: Array<{
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
  }> = [];

  constructor(scene: THREE.Scene, world: MicroVoxelWorld) {
    this.scene = scene;
    this.world = world;
    this.voxelDebrisSystem = new VoxelDebrisSystem(
      scene,
      undefined,
      world.voxelWorld,
    );
    TerrainEntity.attachToScene(scene);

    const geo = new THREE.BoxGeometry(
      VOXEL_SIZE,
      VOXEL_SIZE,
      VOXEL_SIZE,
    );
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0.1,
    });
    this.instanced = new THREE.InstancedMesh(geo, mat, this.maxDebris);
    this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanced.castShadow = false;
    this.instanced.receiveShadow = false;
    this.instanced.frustumCulled = false;

    // Pre-initialize all 1000 debris instances to scale 0 and pre-allocate instanceColor buffer
    // so the very first bullet impact never triggers a lazy GPU buffer allocation (#4)
    _dummy.position.set(0, -1000, 0);
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    _colorTmp.setHex(0xffffff);
    for (let i = 0; i < this.maxDebris; i++) {
      this.instanced.setMatrixAt(i, _dummy.matrix);
      this.instanced.setColorAt(i, _colorTmp);
    }
    this.instanced.instanceMatrix.needsUpdate = true;
    if (this.instanced.instanceColor) {
      this.instanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.instanced.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.instanced);

    this.debrisPool = Array.from({ length: this.maxDebris }, () => ({
      active: false,
      smoke: false,
      fullVoxel: false,
      popOut: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rx: 0,
      ry: 0,
      color: 0xffffff,
      scale: 1,
      life: 0,
    }));

    // Initialize zero-GC 3D Speed Streaks around a cylindrical tunnel
    this.streaks = Array.from({ length: this.streakCount }, (_, i) => {
      const ang = (i / this.streakCount) * Math.PI * 2 + (i % 3) * 0.4;
      const rad = 2.6 + (i % 5) * 1.15;
      return {
        offsetX: Math.cos(ang) * rad,
        offsetY: Math.sin(ang) * rad * 0.68,
        phaseZ: (i / this.streakCount) * 24.0 - 12.0,
        speedMult: 0.85 + (i % 4) * 0.15,
      };
    });

    this.speedLinePositions = new Float32Array(this.streakCount * 2 * 3);
    this.speedLinesGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.speedLinePositions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.speedLinesGeo.setAttribute('position', posAttr);

    this.speedLinesMat = new THREE.LineBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.speedLinesMesh = new THREE.LineSegments(
      this.speedLinesGeo,
      this.speedLinesMat,
    );
    this.speedLinesMesh.frustumCulled = false;
    this.speedLinesMesh.visible = false;
    this.scene.add(this.speedLinesMesh);

    this.shellGeo = new THREE.BoxGeometry(0.24, 0.24, 0.72);
    this.shellGeo.computeBoundingSphere();
    (this.shellGeo.userData as any).isSharedPrimitive = true;
    this.tracerGeo = new THREE.BoxGeometry(0.11, 0.11, 0.88);
    this.tracerGeo.computeBoundingSphere();
    (this.tracerGeo.userData as any).isSharedPrimitive = true;
    this.rocketBodyGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.68, 8);
    this.rocketBodyGeo.rotateX(Math.PI / 2);
    this.rocketBodyGeo.computeBoundingSphere();
    (this.rocketBodyGeo.userData as any).isSharedPrimitive = true;
    this.rocketNoseGeo = new THREE.ConeGeometry(0.11, 0.24, 8);
    this.rocketNoseGeo.rotateX(Math.PI / 2);
    this.rocketNoseGeo.computeBoundingSphere();
    (this.rocketNoseGeo.userData as any).isSharedPrimitive = true;
    this.bombBodyGeo = new THREE.CylinderGeometry(0.18, 0.16, 0.56, 10);
    this.bombBodyGeo.rotateX(Math.PI / 2);
    this.bombBodyGeo.computeBoundingSphere();
    (this.bombBodyGeo.userData as any).isSharedPrimitive = true;

    this.playerShellMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });
    this.tracerShellMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    this.rocketBodyMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.35,
      metalness: 0.45,
    });
    this.rocketNoseMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    this.bombShellMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.55,
    });
    this.stickyBombMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.4,
      roughness: 0.4,
    });
    this.bombGeo = new THREE.BoxGeometry(0.28, 0.28, 0.38);
    this.bombGeo.computeBoundingSphere();
    (this.bombGeo.userData as any).isSharedPrimitive = true;

    // Initialize 512-capacity Ring-Buffer Surface Decal InstancedMesh (1 draw call, zero per-frame allocations)
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalGeo.rotateX(-Math.PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.decalInstanced = new THREE.InstancedMesh(
      this.decalGeo,
      this.decalMat,
      this.maxDecals,
    );
    this.decalInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decalInstanced.frustumCulled = false;
    this.decalInstanced.renderOrder = 1;
    _dummy.position.set(0, -1000, 0);
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    _colorTmp.setHex(0x0f172a);
    for (let i = 0; i < this.maxDecals; i++) {
      this.decalInstanced.setMatrixAt(i, _dummy.matrix);
      this.decalInstanced.setColorAt(i, _colorTmp);
    }
    this.decalInstanced.instanceMatrix.needsUpdate = true;
    if (this.decalInstanced.instanceColor) {
      this.decalInstanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.decalInstanced.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.decalInstanced);
  }

  private acquireProjectileMesh(kind: WeaponProjectileKind): THREE.Object3D {
    const pool = this.shellMeshPool[kind];
    if (pool && pool.length > 0) {
      return pool.pop()!;
    }
    if (kind === 'MINIGUN') {
      return new THREE.Mesh(this.tracerGeo, this.tracerShellMat);
    }
    if (kind === 'ROCKET') {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(this.rocketBodyGeo, this.rocketBodyMat);
      const nose = new THREE.Mesh(this.rocketNoseGeo, this.rocketNoseMat);
      nose.position.z = 0.44;
      grp.add(body, nose);
      return grp;
    }
    if (kind === 'BOMB') {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(this.bombBodyGeo, this.bombShellMat);
      const nose = new THREE.Mesh(this.rocketNoseGeo, this.rocketNoseMat);
      nose.position.z = 0.34;
      grp.add(body, nose);
      return grp;
    }
    return new THREE.Mesh(this.shellGeo, this.playerShellMat);
  }

  private releaseProjectileMesh(kind: WeaponProjectileKind, mesh: THREE.Object3D): void {
    this.scene.remove(mesh);
    const pool = this.shellMeshPool[kind];
    if (pool && pool.length < 48) {
      pool.push(mesh);
    }
  }

  private releaseDetachedChunk(chunk: DetachedIslandChunk): void {
    this.scene.remove(chunk.group);
    clearDetachedModuleAttachments(chunk.group, chunk.voxelMesh);
    if (chunk.voxelMesh) {
      chunk.voxelMesh.visible = false;
    }
    if (this.detachedChunkPool.length < 16) {
      this.detachedChunkPool.push(chunk);
    } else if (chunk.voxelMesh) {
      chunk.voxelMesh.geometry.dispose();
      chunk.voxelMesh = null;
    }
  }

  /**
   * Updates the 3D Wind Speed Lines streaming past the active vehicle/camera at high speeds!
   */
  updateSpeedLines(
    dt: number,
    anchorPos: THREE.Vector3,
    velocity: THREE.Vector3,
    isBoosting: boolean,
  ): void {
    const speedMPS = velocity.length();
    const speedKmh = speedMPS * 3.6;
    const minSpeedKmh = isBoosting ? 24 : 38;

    if (speedKmh < minSpeedKmh) {
      this.speedLinesMesh.visible = false;
      return;
    }

    this.speedLinesMesh.visible = true;
    const intensity = Math.min(
      1.0,
      (speedKmh - minSpeedKmh) / (isBoosting ? 55 : 85),
    );
    this.speedLinesMat.opacity = intensity * (isBoosting ? 0.68 : 0.45);
    this.speedLinesMat.color.setHex(isBoosting ? 0x7dd3fc : 0xe2e8f0);

    _velDir.copy(velocity).normalize();
    if (Math.abs(_velDir.y) > 0.92) {
      _streakRight.set(1, 0, 0);
    } else {
      _streakRight.crossVectors(_velDir, _worldUp).normalize();
    }
    _streakUp.crossVectors(_streakRight, _velDir).normalize();

    const streakLen = Math.min(5.5, 1.4 + speedMPS * 0.12 + (isBoosting ? 1.6 : 0));

    for (let i = 0; i < this.streakCount; i++) {
      const st = this.streaks[i];
      st.phaseZ -= dt * (speedMPS * 1.65 + 18.0) * st.speedMult;
      if (st.phaseZ < -12.0) {
        st.phaseZ += 24.0;
      }

      const baseX =
        anchorPos.x +
        _streakRight.x * st.offsetX +
        _streakUp.x * st.offsetY +
        _velDir.x * st.phaseZ;
      const baseY =
        anchorPos.y +
        _streakRight.y * st.offsetX +
        _streakUp.y * st.offsetY +
        _velDir.y * st.phaseZ;
      const baseZ =
        anchorPos.z +
        _streakRight.z * st.offsetX +
        _streakUp.z * st.offsetY +
        _velDir.z * st.phaseZ;

      const idx = i * 6;
      this.speedLinePositions[idx] = baseX;
      this.speedLinePositions[idx + 1] = baseY;
      this.speedLinePositions[idx + 2] = baseZ;

      this.speedLinePositions[idx + 3] = baseX - _velDir.x * streakLen;
      this.speedLinePositions[idx + 4] = baseY - _velDir.y * streakLen;
      this.speedLinePositions[idx + 5] = baseZ - _velDir.z * streakLen;
    }

    (
      this.speedLinesGeo.attributes.position as THREE.BufferAttribute
    ).needsUpdate = true;
  }

  spawnDebris(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    speed = 6.5,
    scale = 1.0,
  ): void {
    const idx = this.debrisCursor;
    const p = this.debrisPool[idx];
    this.debrisCursor = (idx + 1) % this.maxDebris;

    const isFullVoxelDebris = scale >= 0.8;
    p.active = true;
    p.smoke = false;
    p.fullVoxel = isFullVoxelDebris;
    p.popOut = false;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = (Math.random() - 0.5) * speed * 2.0;
    p.vy = (0.28 + Math.random() * 0.85) * speed;
    p.vz = (Math.random() - 0.5) * speed * 2.0;
    p.rx = Math.random() * 6.28;
    p.ry = Math.random() * 6.28;
    p.color = colorHex;
    // Item 5B1: Full-size 0.25m voxel debris stays visible for 3.0s then fades out over 1.0s (4.0s total)
    p.scale = isFullVoxelDebris ? scale : scale * (0.85 + Math.random() * 0.3);
    p.life = isFullVoxelDebris ? 4.0 : 1.1 + Math.random() * 0.8;
    _colorTmp.setHex(colorHex);
    this.instanced.setColorAt(idx, _colorTmp);
    this.debrisColorDirty = true;
  }

  /**
   * Item 5B3: Build Mode voxel removal animation — scales the removed cube 1.0x -> 0.0x over 100ms
   * accompanied by a brief outward particle burst.
   */
  spawnEditPopOut(x: number, y: number, z: number, colorHex: number): void {
    const idx = this.debrisCursor;
    const p = this.debrisPool[idx];
    this.debrisCursor = (idx + 1) % this.maxDebris;

    p.active = true;
    p.smoke = false;
    p.fullVoxel = false;
    p.popOut = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.rx = 0;
    p.ry = 0;
    p.color = colorHex;
    p.scale = 1.0;
    p.life = 0.1;
    _colorTmp.setHex(colorHex);
    this.instanced.setColorAt(idx, _colorTmp);
    this.debrisColorDirty = true;

    const burstCount = Math.max(2, Math.round(5 * this.userParticleMultiplier));
    for (let i = 0; i < burstCount; i++) {
      this.spawnDebris(x, y, z, colorHex, 2.8, 0.38);
    }
  }

  /**
   * Spawns rising dark smoke & ember puffs from vehicle blocks whose structural integrity dropped below 50%!
   */
  spawnStructuralSmoke(x: number, y: number, z: number): void {
    const idx = this.debrisCursor;
    const p = this.debrisPool[idx];
    this.debrisCursor = (idx + 1) % this.maxDebris;

    const isEmber = Math.random() < 0.24;
    p.active = true;
    p.smoke = true;
    p.fullVoxel = false;
    p.popOut = false;
    p.x = x + (Math.random() - 0.5) * 0.18;
    p.y = y + 0.12;
    p.z = z + (Math.random() - 0.5) * 0.18;
    p.vx = (Math.random() - 0.5) * 0.85;
    p.vy = 1.45 + Math.random() * 1.35;
    p.vz = (Math.random() - 0.5) * 0.85;
    p.rx = Math.random() * 6.28;
    p.ry = Math.random() * 6.28;
    p.color = isEmber
      ? 0xf97316
      : Math.random() < 0.5
      ? 0x1e293b
      : 0x334155;
    p.scale = isEmber ? 0.52 : 1.15 + Math.random() * 0.55;
    p.life = isEmber ? 0.65 + Math.random() * 0.35 : 1.15 + Math.random() * 0.65;
    _colorTmp.setHex(p.color);
    this.instanced.setColorAt(idx, _colorTmp);
    this.debrisColorDirty = true;
  }

  /**
   * Spawns billowing white/grey tire-slip smoke particles when vehicle wheels break traction or drift!
   */
  spawnTireSmoke(x: number, y: number, z: number, intensity = 1.0): void {
    const count = Math.min(
      8,
      Math.max(1, Math.round(intensity * 2.2 * this.userParticleMultiplier)),
    );
    for (let i = 0; i < count; i++) {
      const idx = this.debrisCursor;
      const p = this.debrisPool[idx];
      this.debrisCursor = (idx + 1) % this.maxDebris;

      p.active = true;
      p.smoke = true;
      p.fullVoxel = false;
      p.popOut = false;
      p.x = x + (Math.random() - 0.5) * 0.28;
      p.y = y + 0.04 + Math.random() * 0.08;
      p.z = z + (Math.random() - 0.5) * 0.28;
      p.vx = (Math.random() - 0.5) * 0.75;
      p.vy = 0.85 + Math.random() * 0.85;
      p.vz = (Math.random() - 0.5) * 0.75;
      p.rx = Math.random() * 6.28;
      p.ry = Math.random() * 6.28;
      p.color = Math.random() < 0.65 ? 0xf1f5f9 : 0xcbd5e1;
      p.scale = (0.85 + Math.random() * 0.55) * Math.min(1.8, Math.max(0.6, intensity));
      p.life = 0.85 + Math.random() * 0.55;
      _colorTmp.setHex(p.color);
      this.instanced.setColorAt(idx, _colorTmp);
      this.debrisColorDirty = true;
    }
  }

  /**
   * Spawns a Trailmakers-style weld spark burst when attaching blocks or modules in Build Mode!
   */
  spawnWeldSparks(x: number, y: number, z: number): void {
    const sparkCount = Math.max(2, Math.round(8 * this.userParticleMultiplier));
    for (let i = 0; i < sparkCount; i++) {
      this.spawnDebris(
        x,
        y,
        z,
        i % 2 === 0 ? 0xfef08a : 0x38bdf8,
        3.2,
        0.48,
      );
    }
  }

  /**
   * Stamps a persistent tire skidmark or tank tread imprint into the 512-quad ring-buffer InstancedMesh.
   */
  spawnTireDecal(
    wx: number,
    wy: number,
    wz: number,
    yawRad: number,
    width = 0.34,
    length = 0.58,
    colorHex = 0x0f172a,
  ): void {
    const idx = this.decalCursor;
    this.decalCursor = (this.decalCursor + 1) % this.maxDecals;

    _dummy.position.set(wx, wy + 0.025, wz);
    _dummy.rotation.set(0, yawRad, 0);
    _dummy.scale.set(width, 1, length);
    _dummy.updateMatrix();
    this.decalInstanced.setMatrixAt(idx, _dummy.matrix);
    _colorTmp.setHex(colorHex);
    this.decalInstanced.setColorAt(idx, _colorTmp);
    this.decalInstanced.instanceMatrix.needsUpdate = true;
    if (this.decalInstanced.instanceColor) {
      this.decalInstanced.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Legacy hook retained as a no-op (flat black square decals over craters obscured voxel destruction).
   */
  spawnScorchDecal(_wx: number, _wy: number, _wz: number, _radiusMeters = 2.2): void {
    // Intentionally disabled: flat plane scorch decals appeared as hovering black squares over broken voxels.
  }

  /**
   * Deploys a dense Smoke Screen cloud and high-intensity Thermal Flares that break AI target locks.
   */
  spawnSmokeScreenAndFlares(
    wx: number,
    wy: number,
    wz: number,
    baseVel: THREE.Vector3,
  ): void {
    SoundFX.countermeasurePop();
    // 1. Dense billowing tactical smoke cloud
    const smokeCount = Math.max(12, Math.round(28 * this.userParticleMultiplier));
    for (let i = 0; i < smokeCount; i++) {
      const p = this.debrisPool[this.debrisCursor];
      this.debrisCursor = (this.debrisCursor + 1) % this.maxDebris;
      p.active = true;
      p.smoke = true;
      const ang = (i / smokeCount) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 2.5 + Math.random() * 4.5;
      p.x = wx + Math.cos(ang) * 0.6;
      p.y = wy + 0.4 + Math.random() * 0.6;
      p.z = wz + Math.sin(ang) * 0.6;
      p.vx = Math.cos(ang) * spd + baseVel.x * 0.25;
      p.vy = 1.2 + Math.random() * 2.2;
      p.vz = Math.sin(ang) * spd + baseVel.z * 0.25;
      p.rx = Math.random() * 6.28;
      p.ry = Math.random() * 6.28;
      p.color = i % 3 === 0 ? 0xe2e8f0 : 0x94a3b8;
      p.scale = 2.2 + Math.random() * 1.4;
      p.life = 3.2 + Math.random() * 1.8;
    }

    // 2. Eject 4 bright thermal decoy flares
    for (let f = 0; f < 4; f++) {
      const fAng = (f / 4) * Math.PI * 2 + Math.random() * 0.5;
      if (this.activeFlares.length >= 16) {
        this.activeFlares.shift();
      }
      this.activeFlares.push({
        pos: new THREE.Vector3(wx, wy + 0.8, wz),
        vel: new THREE.Vector3(
          baseVel.x * 0.5 + Math.cos(fAng) * 9.5,
          10.5 + Math.random() * 4.0,
          baseVel.z * 0.5 + Math.sin(fAng) * 9.5,
        ),
        life: 4.5,
      });
    }
  }

  /**
   * Spawns a severed, disconnected section of the vehicle as a separate tumbling 3D rigid-body assembly
   * carrying both greedy-meshed hull voxels AND any severed modules (wheels, wings, thrusters)!
   */
  spawnDetachedIslandFragment(
    worldCenter: THREE.Vector3,
    quat: THREE.Quaternion,
    islandVoxels: Array<[number, number, number, number]>,
    baseVel: THREE.Vector3,
    severedModules?: DetachedModuleAttachment[],
    blastImpulse?: THREE.Vector3,
  ): void {
    if (islandVoxels.length === 0 && (!severedModules || severedModules.length === 0)) {
      return;
    }

    // Limit active detached rigid-body chunks to 12 for peak performance, recycling into pool (#4)
    while (this.detachedChunks.length >= 12) {
      const oldest = this.detachedChunks.shift()!;
      this.releaseDetachedChunk(oldest);
    }

    const pooled = this.detachedChunkPool.pop();
    const chunkGroup = pooled ? pooled.group : new THREE.Group();
    chunkGroup.matrixAutoUpdate = true;
    chunkGroup.position.copy(worldCenter);
    chunkGroup.quaternion.copy(quat);

    let voxelMesh: THREE.Mesh | null = pooled ? pooled.voxelMesh : null;
    let sampleColor = 0x38bdf8;

    if (islandVoxels.length > 0) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      const localMap = new Map<string, number>();

      for (const [vx, vy, vz, mat] of islandVoxels) {
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
        if (vz < minZ) minZ = vz;
        if (vz > maxZ) maxZ = vz;
        localMap.set(`${vx},${vy},${vz}`, mat);
      }

      const spanX = Math.max(1, maxX - minX + 1);
      const spanY = Math.max(1, maxY - minY + 1);
      const spanZ = Math.max(1, maxZ - minZ + 1);

      const res = greedyMeshBoundedArrays(
        spanX,
        spanY,
        spanZ,
        0,
        spanY - 1,
        (lx, ly, lz) => localMap.get(`${minX + lx},${minY + ly},${minZ + lz}`) || 0,
        (-spanX * 0.5) * VOXEL_SIZE,
        (-spanY * 0.5) * VOXEL_SIZE,
        (-spanZ * 0.5) * VOXEL_SIZE,
        VOXEL_SIZE,
        VOXEL_SIZE,
        'ALL',
        null,
        true,
      );

      // #1 — Update existing detached fragment BufferGeometry in-place instead of allocating new BufferGeometry
      const updated = updateOrCreateDynamicMeshBuffer(
        voxelMesh,
        res,
        this.world.sharedVoxelMaterial,
        chunkGroup,
        false,
        1024,
      );
      voxelMesh = updated.mesh;

      const firstMat = islandVoxels[0][3];
      sampleColor = MAT_INFO[firstMat]?.color ?? 0x38bdf8;
    } else if (voxelMesh) {
      voxelMesh.visible = false;
    }

    if (severedModules && severedModules.length > 0) {
      for (const att of severedModules) {
        att.group.position.copy(att.localOffset);
        att.group.frustumCulled = true;
        att.group.matrixAutoUpdate = false;
        att.group.updateMatrix();
        chunkGroup.add(att.group);
      }
    }

    if (chunkGroup.children.length === 0) return;

    chunkGroup.frustumCulled = true;
    this.scene.add(chunkGroup);

    if (pooled) {
      pooled.voxelMesh = voxelMesh;
      pooled.vel.copy(baseVel);
      if (blastImpulse) {
        pooled.vel.add(blastImpulse);
      } else {
        pooled.vel.x += (Math.random() - 0.5) * 7.5;
        pooled.vel.y += 4.2 + Math.random() * 4.2;
        pooled.vel.z += (Math.random() - 0.5) * 7.5;
      }
      pooled.angVel.set(
        (Math.random() - 0.5) * 8.2,
        (Math.random() - 0.5) * 8.2,
        (Math.random() - 0.5) * 8.2,
      );
      pooled.life = 12.0;
      pooled.lowSpeedTimer = 0;
      pooled.sleeping = false;
      pooled.sampleColor = sampleColor;
      this.detachedChunks.push(pooled);
    } else {
      const launchVel = baseVel.clone();
      if (blastImpulse) {
        launchVel.add(blastImpulse);
      } else {
        launchVel.x += (Math.random() - 0.5) * 7.5;
        launchVel.y += 4.2 + Math.random() * 4.2;
        launchVel.z += (Math.random() - 0.5) * 7.5;
      }
      this.detachedChunks.push({
        group: chunkGroup,
        voxelMesh,
        vel: launchVel,
        angVel: new THREE.Vector3(
          (Math.random() - 0.5) * 8.2,
          (Math.random() - 0.5) * 8.2,
          (Math.random() - 0.5) * 8.2,
        ),
        life: 12.0,
        lowSpeedTimer: 0,
        sleeping: false,
        sampleColor,
      });
    }
  }

  /**
   * Fires a specialized weapon projectile ('PLASMA' | 'MINIGUN' | 'ROCKET' | 'BOMB')
   * with tailored mesh, velocity, gravity, smoke trail, and voxel crater radius!
   */
  fireWeaponProjectile(
    kind: WeaponProjectileKind,
    worldPos: THREE.Vector3,
    worldDir: THREE.Vector3,
    inheritVel: THREE.Vector3,
    canHitRig = true,
    playAudio = true,
    sourceRig?: any,
  ): void {
    while (this.shells.length >= 44) {
      const oldest = this.shells.shift()!;
      this.releaseProjectileMesh(oldest.kind, oldest.mesh);
    }

    const projMesh = this.acquireProjectileMesh(kind);
    let speed = 58.0;
    let life = 2.6;
    let craterRadius = 6;
    let gravity = 8.5;

    if (kind === 'MINIGUN') {
      speed = 92.0;
      life = 1.65;
      craterRadius = 3;
      gravity = 3.5;
    } else if (kind === 'ROCKET') {
      speed = 46.0;
      life = 3.4;
      craterRadius = 9;
      gravity = 2.2;
    } else if (kind === 'BOMB') {
      speed = 11.0;
      life = 4.5;
      craterRadius = 10;
      gravity = 24.0;
    } else {
      speed = 58.0;
      life = 2.6;
      craterRadius = 7;
      gravity = 8.5;
    }

    projMesh.position.copy(worldPos);
    _nextPos.copy(worldPos).add(worldDir);
    projMesh.lookAt(_nextPos);
    this.scene.add(projMesh);

    this.shells.push({
      mesh: projMesh,
      prevPos: worldPos.clone(),
      vel: worldDir.clone().multiplyScalar(speed).add(inheritVel),
      life,
      initialLife: life,
      canHitRig,
      sourceRig,
      kind,
      craterRadius,
      gravity,
      smokeTimer: 0,
    });

    if (playAudio) {
      SoundFX.cannon(kind);
    }
  }

  firePlasmaShell(
    worldPos: THREE.Vector3,
    worldDir: THREE.Vector3,
    inheritVel: THREE.Vector3,
    canHitRig = false,
    playAudio = true,
    sourceRig?: any,
  ): void {
    this.fireWeaponProjectile(
      'PLASMA',
      worldPos,
      worldDir,
      inheritVel,
      canHitRig,
      playAudio,
      sourceRig,
    );
  }

  throwBomb(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const mesh =
      this.bombMeshPool.pop() ||
      new THREE.Mesh(this.bombGeo, this.stickyBombMat);
    mesh.position.copy(origin).addScaledVector(dir, 0.9);
    mesh.rotation.set(0, 0, 0);
    this.scene.add(mesh);
    this.bombs.push({
      mesh,
      prevPos: mesh.position.clone(),
      vel: dir.clone().multiplyScalar(19.5).add(new THREE.Vector3(0, 4.0, 0)),
      stuck: false,
      stuckToRig: false,
      stuckRig: null,
      rigLocalPos: new THREE.Vector3(),
      timer: 0,
    });
    SoundFX.snap();
  }

  public pendingExplosions: Array<{
    wx: number;
    wy: number;
    wz: number;
    radiusVoxels: number;
    depth: number;
    damageVehicle: boolean;
  }> = [];
  public debrisSpawnMultiplier = 1.0;

  detonateBombs(): void {
    let immediateCount = 0;
    while (this.bombs.length > 0) {
      const b = this.bombs.pop()!;
      const p = b.mesh.position.clone();
      this.scene.remove(b.mesh);
      if (this.bombMeshPool.length < 32) {
        this.bombMeshPool.push(b.mesh);
      }
      if (immediateCount < 6) {
        this.carveWorldCrater(p.x, p.y, p.z, 9, 0, true);
        immediateCount++;
      } else if (this.pendingExplosions.length < 24) {
        this.pendingExplosions.push({
          wx: p.x,
          wy: p.y,
          wz: p.z,
          radiusVoxels: 9,
          depth: 0,
          damageVehicle: true,
        });
      }
    }
  }

  triggerHitstop(durationSec = 0.042): void {
    this.hitstopTimer = Math.max(this.hitstopTimer, durationSec);
  }

  public drainVoxelWorldExplosionEvents(): number {
    const events = this.world.voxelWorld.drainExplosionEvents();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      SoundFX.explode();
      this.trauma = Math.min(1.0, this.trauma + 0.36);
      if (ev.depth === 0 && ev.radiusVoxels >= 6) {
        this.triggerHitstop(0.045);
      }
    }
    return events.length;
  }

  carveWorldCrater(
    wx: number,
    wy: number,
    wz: number,
    radiusVoxels = 7,
    depth = 0,
    damageVehicle = true,
  ): void {
    // Hard-cap crater radius at 14 voxels so O(R^3) voxel carving never stalls the main thread
    const safeRadius = Math.max(1, Math.min(14, Math.round(radiusVoxels)));

    // Queue explosion event in VoxelWorld (drained in FXSystem.update for audio, trauma, hitstop)
    this.world.voxelWorld.queueExplosion(
      wx,
      wy,
      wz,
      safeRadius * VOXEL_SIZE,
      safeRadius * 450,
      depth,
      safeRadius,
    );

    if (depth === 0 && this.onCraterCarved) {
      this.onCraterCarved(wx, wy, wz, safeRadius);
    }

    // Also destroy vehicle voxels & modules caught within the blast/smash radius across ALL spawned vehicles!
    if (damageVehicle && depth === 0) {
      const targetRigs =
        this.rigs.length > 0 ? this.rigs : this.rig ? [this.rig] : [];
      for (const r of targetRigs) {
        if (!r.inBuildMode) {
          r.carveVehicleCrater(
            wx,
            wy,
            wz,
            Math.max(3, safeRadius - 1),
            safeRadius * 1.9,
          );
        }
      }
      if (this.onCraterDamageHazards) {
        this.onCraterDamageHazards(wx, wy, wz, safeRadius);
      }
    }

    const { vx: cvx, vy: cvy, vz: cvz } = this.world.worldToVoxelCoords(wx, wy, wz);
    const rSq = safeRadius * safeRadius;
    const chainC4: Array<{ x: number; y: number; z: number }> = [];
    const effectiveMult = this.debrisSpawnMultiplier * this.userParticleMultiplier;

    const isSmallDestruction = safeRadius <= 2;
    const touchedChunks = new Set<MicroVoxelChunk>();
    const carveTrenchChannel = cvy - safeRadius <= WATER_VY + 3 && cvy + safeRadius >= WATER_VY - 2;
    const horizTrenchR = Math.max(1, safeRadius - 1);
    const horizTrenchRSq = horizTrenchR * horizTrenchR;

    const carvedTerrainVoxels: Array<{ wx: number; wy: number; wz: number; color: number }> = [];
    const maxBlastScatter = Math.max(
      4,
      Math.min(24, Math.round(24 * Math.max(0.25, effectiveMult))),
    );

    // Carve top-to-bottom (dy from +safeRadius down to -safeRadius) so the surface crust
    // is always broken first and surfaceHeightMap stays 100% accurate at every step!
    const minDY = carveTrenchChannel ? Math.min(-safeRadius, WATER_VY - 1 - cvy) : -safeRadius;
    for (let dy = safeRadius; dy >= minDY; dy--) {
      for (let dz = -safeRadius; dz <= safeRadius; dz++) {
        for (let dx = -safeRadius; dx <= safeRadius; dx++) {
          const horizSq = dx * dx + dz * dz;
          const ty = cvy + dy;
          const inSphere = horizSq + dy * dy <= rSq;
          const inTrenchFloor =
            carveTrenchChannel &&
            horizSq <= horizTrenchRSq &&
            ty >= WATER_VY - 1 &&
            ty <= cvy;
          if (!inSphere && !inTrenchFloor) continue;
          if (ty <= 1) continue;
          const tx = cvx + dx;
          const tz = cvz + dz;

          if (this.world.isVoxelPendingRemoval(tx, ty, tz)) continue;
          const mat = this.world.getVoxel(tx, ty, tz);
          if (mat === MAT.AIR || mat === MAT.WATER_VOX || mat === MAT.BEDROCK) continue;

          const info = MAT_INFO[mat & 63];
          const fillMat = MAT.AIR;

          if (isSmallDestruction) {
            // SMALL destruction (radius <= 2): update voxel array immediately and rebuild chunk synchronously
            this.world.setVoxel(tx, ty, tz, fillMat);
            const c = this.world.chunkMap.get(`${tx >> 6},${tz >> 6}`);
            if (c) touchedChunks.add(c);
          } else {
            // LARGE destruction (radius > 2): mark voxel as pending removal (do not remove from chunk.voxels yet!)
            // so physics and visual mesh stay 100% in sync until the worker returns the new mesh!
            const c = this.world.markVoxelPendingRemoval(tx, ty, tz, fillMat, touchedChunks);
            if (c) touchedChunks.add(c);
          }
          this.voxelsDestroyedCount++;

          const vwx = (tx - TOTAL_VX / 2 + 0.5) * VOXEL_SIZE;
          const vwy = (ty + 0.5) * VOXEL_SIZE;
          const vwz = (tz - TOTAL_VZ / 2 + 0.5) * VOXEL_SIZE;

          if (info?.explosive && depth < 2 && Math.random() < 0.35) {
            chainC4.push({ x: vwx, y: vwy, z: vwz });
          }

          carvedTerrainVoxels.push({
            wx: vwx,
            wy: vwy,
            wz: vwz,
            color: info ? info.color : 0x94a3b8,
          });
        }
      }
    }

    // Apply radial explosion blast impulse to nearby active TerrainEntity structures & rubble
    TerrainEntity.applyExplosionImpulse(wx, wy, wz, safeRadius * VOXEL_SIZE + 2.0, safeRadius * 480);

    // Spawn TerrainEntity physics cubes for destroyed terrain voxels (never fading fx.spawnDebris particles),
    // synchronized with chunk mesh swap on async large craters so debris appears as static blocks disappear
    if (carvedTerrainVoxels.length > 0) {
      const totalCarved = carvedTerrainVoxels.length;
      const spawnCount = Math.min(totalCarved, maxBlastScatter);
      const stride = totalCarved / spawnCount;
      const debrisBatch: Array<{
        wx: number;
        wy: number;
        wz: number;
        color: number;
        blastX: number;
        blastY: number;
        blastZ: number;
      }> = [];
      for (let i = 0; i < spawnCount; i++) {
        const item = carvedTerrainVoxels[Math.min(totalCarved - 1, Math.floor(i * stride))];
        debrisBatch.push({
          wx: item.wx,
          wy: item.wy,
          wz: item.wz,
          color: item.color,
          blastX: wx,
          blastY: wy,
          blastZ: wz,
        });
      }
      if (!isSmallDestruction && this.world.workerPool.hasDedicatedWorkers && touchedChunks.size > 0) {
        this.world.queuePendingCarvedDebris(debrisBatch, new Set(touchedChunks));
      } else {
        for (let i = 0; i < debrisBatch.length; i++) {
          const d = debrisBatch[i];
          terrainEntityManager.spawnTerrainVoxelDebris(
            d.wx,
            d.wy,
            d.wz,
            d.color,
            d.blastX,
            d.blastY,
            d.blastZ,
            this.scene,
          );
        }
      }
    }

    // Collapse any static world structures, columns, arches, or bridges that lost ground support
    // as ONE unified rigid-body TerrainEntity per disconnected component
    const collapsedCount = this.world.collapseUnsupportedWorldVoxels(
      cvx,
      cvy,
      cvz,
      safeRadius,
      isSmallDestruction,
      touchedChunks,
      (cwx, cwy, cwz, cMat) => {
        const cInfo = MAT_INFO[cMat & 63];
        if (cInfo?.explosive && depth < 2 && Math.random() < 0.25) {
          chainC4.push({ x: cwx, y: cwy, z: cwz });
        }
      },
    );
    this.voxelsDestroyedCount += collapsedCount;

    // If the crater reaches at or below water level (vy <= STATIC_WATER_TOP_VY) and is connected to a water body,
    // flood all connected MAT.AIR cavities with MAT.WATER_VOX!
    const lowestCarvedVY = Math.max(1, cvy + minDY);
    if (lowestCarvedVY <= STATIC_WATER_TOP_VY) {
      this.world.floodConnectedWaterIntoRegion(
        cvx - safeRadius,
        cvx + safeRadius,
        lowestCarvedVY,
        Math.min(STATIC_WATER_TOP_VY, cvy + safeRadius),
        cvz - safeRadius,
        cvz + safeRadius,
        !isSmallDestruction,
        touchedChunks,
      );
    }

    if (isSmallDestruction) {
      // SMALL destruction (single block, radius <= 2): rebuild chunk mesh SYNCHRONOUSLY on main thread
      touchedChunks.forEach((chunk) => {
        this.world.rebuildChunkSync(chunk);
      });
    } else {
      // LARGE destruction (explosions, radius > 2): queue worker; on worker completion remove voxel + swap mesh together
      touchedChunks.forEach((chunk) => {
        this.world.rebuildChunkAsync(chunk);
      });
    }

    TerrainEntity.flushGpuBuffers();

    const triggeredBarrels =
      depth < 2
        ? this.world.consumeTriggeredExplosiveBarrels(
            wx,
            wy,
            wz,
            safeRadius * VOXEL_SIZE + 1.8,
          )
        : [];
    for (const tb of triggeredBarrels) {
      chainC4.unshift({ x: tb.wx, y: tb.wy, z: tb.wz });
    }

    // Queue secondary chain explosions across subsequent frames instead of synchronous recursion!
    const maxChain = Math.min(3, chainC4.length);
    for (let i = 0; i < maxChain; i++) {
      if (this.pendingExplosions.length < 24) {
        this.pendingExplosions.push({
          wx: chainC4[i].x,
          wy: chainC4[i].y,
          wz: chainC4[i].z,
          radiusVoxels: 8,
          depth: depth + 1,
          damageVehicle: true,
        });
      }
    }
  }

  update(
    dt: number,
    activeObserverPos?: THREE.Vector3,
    maxExplosionsThisFrame = 2,
    debrisSpawnMultiplier = 1.0,
  ): void {
    this.debrisSpawnMultiplier = debrisSpawnMultiplier;

    // Drain deferred chain explosions with a strict per-frame count & time budget
    if (this.pendingExplosions.length > 0) {
      const expStartMs =
        typeof performance !== 'undefined' ? performance.now() : 0;
      let processed = 0;
      while (
        this.pendingExplosions.length > 0 &&
        processed < maxExplosionsThisFrame
      ) {
        if (
          typeof performance !== 'undefined' &&
          performance.now() - expStartMs > 5.5
        ) {
          break;
        }
        const nextExp = this.pendingExplosions.shift()!;
        this.carveWorldCrater(
          nextExp.wx,
          nextExp.wy,
          nextExp.wz,
          nextExp.radiusVoxels,
          nextExp.depth,
          nextExp.damageVehicle,
        );
        processed++;
      }
    }

    this.drainVoxelWorldExplosionEvents();

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.75);
    }
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    }

    const observerPos =
      activeObserverPos || (this.rig ? this.rig.position : null);

    const allRigs =
      this.rigs.length > 0 ? this.rigs : this.rig ? [this.rig] : [];

    // Step 2.6 & BUG A.1: Update free-falling vehicle voxel debris rigid-body InstancedMesh (capped at 200, sleeps after 0.5s, wakes on vehicle proximity)
    this.voxelDebrisSystem.update(dt, this.world, allRigs);
    // Lightweight falling terrain blocks (200-capacity single shared InstancedMesh, ground+vehicle collision only)
    TerrainEntity.updateAll(dt, allRigs, this.world);

    beginDestructionBatch();
    try {
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const s = this.shells[i];
        s.life -= dt;
        s.vel.y -= s.gravity * dt;
        _nextPos.copy(s.mesh.position).addScaledVector(s.vel, dt);

        if (s.kind === 'ROCKET') {
          s.smokeTimer += dt;
          if (s.smokeTimer >= 0.022) {
            s.smokeTimer = 0;
            this.spawnStructuralSmoke(
              s.mesh.position.x,
              s.mesh.position.y,
              s.mesh.position.z,
            );
          }
        }

        const allowSelfHit = s.initialLife - s.life > 0.25;
        const hazHit = this.raycastAndDamageHazards
          ? this.raycastAndDamageHazards(
              s.prevPos,
              _nextPos,
              s.craterRadius,
              s.kind !== 'MINIGUN',
            )
          : null;
        if (hazHit) {
          this.releaseProjectileMesh(s.kind, s.mesh);
          this.shells.splice(i, 1);
          continue;
        }
        if (s.sourceRig?.isDisposed) {
          s.sourceRig = null;
        }
        const segHit = raycastBulletSegmentDDA(
          s.prevPos,
          _nextPos,
          this.world,
          allRigs,
          s.canHitRig,
          s.sourceRig,
          allowSelfHit,
        );

        if (segHit || s.life <= 0) {
          if (segHit) {
            const hitPos = segHit.worldPos;
            if (segHit.target === 'vehicle' && segHit.rig) {
              const directDamage =
                s.kind === 'MINIGUN'
                  ? 75
                  : s.kind === 'ROCKET' || s.kind === 'BOMB'
                    ? 260
                    : 150;
              // Damage the exact first voxel hit by the DDA raycast
              applyDamageToVoxel(
                segHit.rig,
                packVoxelKey(segHit.vx, segHit.vy, segHit.vz),
                directDamage,
                hitPos,
                this.voxelDebrisSystem,
              );
              // Apply kinetic impact impulse at the hit point
              _bulletImpulse
                .copy(s.vel)
                .normalize()
                .multiplyScalar(
                  s.kind === 'MINIGUN' ? 420 : s.kind === 'ROCKET' ? 2400 : 1250,
                );
              segHit.rig.rigidBody.applyImpulseAtPoint(_bulletImpulse, hitPos);
            } else if (segHit.target === 'terrainEntity' && segHit.terrainEntity) {
              _bulletImpulse
                .copy(s.vel)
                .normalize()
                .multiplyScalar(
                  s.kind === 'MINIGUN' ? 420 : s.kind === 'ROCKET' ? 2400 : 1250,
                );
              segHit.terrainEntity.applyImpulseAtPoint(_bulletImpulse, hitPos);
            }
            this.carveWorldCrater(
              hitPos.x,
              hitPos.y,
              hitPos.z,
              s.craterRadius,
              0,
              true,
            );
          } else if (s.life > 0) {
            this.carveWorldCrater(
              _nextPos.x,
              _nextPos.y,
              _nextPos.z,
              s.craterRadius,
              0,
              true,
            );
          }
          this.releaseProjectileMesh(s.kind, s.mesh);
          this.shells.splice(i, 1);
        } else {
          s.prevPos.copy(_nextPos);
          s.mesh.position.copy(_nextPos);
          _velDir.copy(_nextPos).add(s.vel);
          s.mesh.lookAt(_velDir);
        }
      }
    } finally {
      flushDestructionBatch();
    }
    this.drainVoxelWorldExplosionEvents();

    for (let i = 0; i < this.bombs.length; i++) {
      const b = this.bombs[i];
      b.timer += dt;
      if (!b.stuck) {
        b.vel.y -= 21.0 * dt;
        _nextPos.copy(b.mesh.position).addScaledVector(b.vel, dt);
        const allRigs =
          this.rigs.length > 0 ? this.rigs : this.rig ? [this.rig] : [];
        const bombHit = raycastBulletSegmentDDA(
          b.prevPos,
          _nextPos,
          this.world,
          allRigs,
          true,
          undefined,
          true,
        );
        if (bombHit && bombHit.target === 'vehicle' && bombHit.rig) {
          b.stuck = true;
          b.stuckToRig = true;
          b.stuckRig = bombHit.rig;
          b.mesh.position.copy(bombHit.worldPos);
          b.rigLocalPos.copy(
            bombHit.rig.worldToLocalMetric(
              bombHit.worldPos.x,
              bombHit.worldPos.y,
              bombHit.worldPos.z,
            ),
          );
        } else if (bombHit && bombHit.target === 'terrainEntity' && bombHit.terrainEntity) {
          b.stuck = true;
          b.stuckToRig = false;
          b.stuckRig = null;
          b.stuckTerrainEntity = bombHit.terrainEntity;
          b.mesh.position.copy(bombHit.worldPos);
          const invQ = bombHit.terrainEntity.quaternion.clone().invert();
          b.rigLocalPos
            .copy(bombHit.worldPos)
            .sub(bombHit.terrainEntity.position)
            .applyQuaternion(invQ);
        } else if (bombHit && bombHit.target === 'world') {
          b.stuck = true;
          b.stuckToRig = false;
          b.stuckRig = null;
          b.stuckTerrainEntity = null;
          b.mesh.position.copy(bombHit.worldPos);
        } else {
          b.prevPos.copy(_nextPos);
          b.mesh.position.copy(_nextPos);
          b.mesh.rotation.x += dt * 9;
        }
      } else if (b.stuckTerrainEntity) {
        if (TerrainEntity.active.includes(b.stuckTerrainEntity)) {
          b.mesh.position
            .copy(b.rigLocalPos)
            .applyQuaternion(b.stuckTerrainEntity.quaternion)
            .add(b.stuckTerrainEntity.position);
        } else {
          b.stuckTerrainEntity = null;
          b.stuck = false;
        }
      } else if (b.stuckToRig && (b.stuckRig || this.rig)) {
        if (b.stuckRig?.isDisposed) {
          b.stuckRig = null;
          b.stuckToRig = false;
          b.stuck = false;
        } else {
          const targetRig = b.stuckRig || this.rig!;
          b.mesh.position.copy(targetRig.localMetricToWorld(b.rigLocalPos));
        }
      }
    }

    // Update tumbling detached fracture islands ("real break-offs") with >75m despawn & <0.1m/s for 1.5s sleep
    for (let i = this.detachedChunks.length - 1; i >= 0; i--) {
      const ch = this.detachedChunks[i];
      const distSq = observerPos
        ? ch.group.position.distanceToSquared(observerPos)
        : 0;
      const curSpeed = ch.sleeping ? 0 : ch.vel.length();
      const throttleEval = evaluateDebrisChunkThrottling(
        curSpeed,
        ch.lowSpeedTimer,
        distSq,
        dt,
      );

      ch.life -= dt;
      if (throttleEval.shouldDespawn || ch.life <= 0) {
        if (!throttleEval.shouldDespawn) {
          for (let k = 0; k < 6; k++) {
            this.spawnDebris(
              ch.group.position.x,
              ch.group.position.y,
              ch.group.position.z,
              ch.sampleColor,
              5.0,
            );
          }
        }
        this.releaseDetachedChunk(ch);
        this.detachedChunks.splice(i, 1);
        continue;
      }

      ch.lowSpeedTimer = throttleEval.nextLowSpeedTimer;
      if (throttleEval.sleeping) {
        if (!ch.sleeping) {
          ch.sleeping = true;
          ch.vel.set(0, 0, 0);
          ch.angVel.set(0, 0, 0);
          ch.group.matrixAutoUpdate = false;
          ch.group.updateMatrix();
        }
        continue;
      }

      ch.vel.y -= 17.5 * dt;
      _nextPos.copy(ch.group.position).addScaledVector(ch.vel, dt);
      const ground = this.world.probeGroundBelow(
        _nextPos.x,
        _nextPos.y,
        _nextPos.z,
        0.5,
      );
      if (_nextPos.y < ground.y + 0.35) {
        _nextPos.y = ground.y + 0.35;
        ch.vel.y = Math.abs(ch.vel.y) * 0.38;
        if (ch.vel.y < 0.45) ch.vel.y = 0;
        ch.vel.x *= 0.72;
        ch.vel.z *= 0.72;
        ch.angVel.multiplyScalar(0.75);
      }
      ch.group.position.copy(_nextPos);
      ch.group.rotation.x += ch.angVel.x * dt;
      ch.group.rotation.y += ch.angVel.y * dt;
      ch.group.rotation.z += ch.angVel.z * dt;
    }

    let anyUpdated = false;
    for (let i = 0; i < this.maxDebris; i++) {
      const p = this.debrisPool[i];
      if (!p.active) continue;
      anyUpdated = true;
      p.life -= dt;

      let outOfRange = false;
      if (observerPos) {
        const dx = p.x - observerPos.x;
        const dy = p.y - observerPos.y;
        const dz = p.z - observerPos.z;
        if (dx * dx + dy * dy + dz * dz > DEBRIS_MAX_DIST_SQ) {
          outOfRange = true;
        }
      }

      if (p.life <= 0 || outOfRange) {
        p.active = false;
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.instanced.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      if (p.popOut) {
        const s = Math.max(0, p.life / 0.1) * p.scale;
        _dummy.position.set(p.x, p.y, p.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(s, s, s);
        _dummy.updateMatrix();
        this.instanced.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      if (p.smoke) {
        // Rising buoyant smoke plume
        p.vy += 0.95 * dt;
        p.vx *= 0.98;
        p.vz *= 0.98;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      } else {
        p.vy -= 21.0 * dt;
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        const nz = p.z + p.vz * dt;

        if (this.world.isSolidAtWorld(nx, ny, nz)) {
          p.vy = -p.vy * 0.35;
          p.vx *= 0.65;
          p.vz *= 0.65;
          p.y += 0.04;
        } else {
          p.x = nx;
          p.y = ny;
          p.z = nz;
        }
      }

      p.rx += dt * (p.smoke ? 1.8 : 5.0);
      p.ry += dt * (p.smoke ? 1.5 : 4.0);

      const s = p.smoke
        ? Math.min(1.6, (0.6 + (1.5 - Math.min(1.2, p.life)) * 0.65) * p.scale)
        : p.fullVoxel
          ? (p.life > 1.0 ? p.scale : Math.max(0, p.life) * p.scale)
          : Math.min(1, p.life * 1.4) * p.scale;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(p.rx, p.ry, 0);
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      this.instanced.setMatrixAt(i, _dummy.matrix);
    }

    if (anyUpdated) {
      this.instanced.instanceMatrix.needsUpdate = true;
    }
    if (this.debrisColorDirty && this.instanced.instanceColor) {
      this.instanced.instanceColor.needsUpdate = true;
      this.debrisColorDirty = false;
    }

    // Step active thermal decoy flares and emit bright magnesium sparks
    for (let i = this.activeFlares.length - 1; i >= 0; i--) {
      const fl = this.activeFlares[i];
      fl.life -= dt;
      if (fl.life <= 0) {
        this.activeFlares.splice(i, 1);
        continue;
      }
      fl.vel.y -= 9.5 * dt;
      fl.vel.x *= 0.985;
      fl.vel.z *= 0.985;
      fl.pos.addScaledVector(fl.vel, dt);
      const groundY = this.world.getSurfaceHeightAt(fl.pos.x, fl.pos.z);
      if (fl.pos.y < groundY + 0.15) {
        fl.pos.y = groundY + 0.15;
        fl.vel.y = Math.abs(fl.vel.y) * 0.35;
      }
      if (Math.random() < 0.65) {
        this.spawnDebris(
          fl.pos.x,
          fl.pos.y,
          fl.pos.z,
          Math.random() < 0.5 ? 0xf43f5e : 0xfef08a,
          3.8,
          0.65,
        );
      }
    }
  }

  /**
   * Resets all active projectiles, bombs, queued explosions, detached island chunks, and debris particles
   * when restarting a session or switching maps so no physics/FX state accumulates across runs.
   */
  public reset(): void {
    while (this.shells.length > 0) {
      const s = this.shells.pop()!;
      this.releaseProjectileMesh(s.kind, s.mesh);
    }
    while (this.bombs.length > 0) {
      const b = this.bombs.pop()!;
      this.scene.remove(b.mesh);
      if (this.bombMeshPool.length < 32) {
        this.bombMeshPool.push(b.mesh);
      }
    }
    this.pendingExplosions.length = 0;
    while (this.detachedChunks.length > 0) {
      const ch = this.detachedChunks.pop()!;
      this.releaseDetachedChunk(ch);
    }
    _dummy.position.set(0, -1000, 0);
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    for (let i = 0; i < this.maxDebris; i++) {
      this.debrisPool[i].active = false;
      this.instanced.setMatrixAt(i, _dummy.matrix);
    }
    this.instanced.instanceMatrix.needsUpdate = true;
    this.debrisCursor = 0;
    for (let i = 0; i < this.maxDecals; i++) {
      this.decalInstanced.setMatrixAt(i, _dummy.matrix);
    }
    this.decalInstanced.instanceMatrix.needsUpdate = true;
    this.decalCursor = 0;
    this.activeFlares.length = 0;
    this.trauma = 0;
    this.hitstopTimer = 0;
    this.speedLinesMesh.visible = false;
    this.voxelDebrisSystem.clearAll();
    TerrainEntity.clearAll();
  }

  public dispose(): void {
    this.reset();
    for (const ch of this.detachedChunkPool) {
      if (ch.voxelMesh) {
        ch.voxelMesh.geometry.dispose();
        ch.voxelMesh = null;
      }
    }
    this.detachedChunkPool.length = 0;
    for (const kind of Object.keys(this.shellMeshPool) as WeaponProjectileKind[]) {
      for (const obj of this.shellMeshPool[kind]) {
        this.scene.remove(obj);
      }
    }
    this.shellMeshPool = { PLASMA: [], MINIGUN: [], ROCKET: [], BOMB: [] };
    for (const b of this.bombMeshPool) {
      this.scene.remove(b);
    }
    this.bombMeshPool.length = 0;

    this.scene.remove(this.instanced);
    this.instanced.geometry.dispose();
    if (this.instanced.material instanceof THREE.Material) {
      this.instanced.material.dispose();
    }
    this.instanced.dispose();

    this.scene.remove(this.decalInstanced);
    this.decalGeo.dispose();
    this.decalMat.dispose();
    this.decalInstanced.dispose();

    this.scene.remove(this.speedLinesMesh);
    this.speedLinesGeo.dispose();
    this.speedLinesMat.dispose();

    this.voxelDebrisSystem.dispose();
    TerrainEntity.dispose(this.scene);

    this.shellGeo.dispose();
    this.tracerGeo.dispose();
    this.rocketBodyGeo.dispose();
    this.rocketNoseGeo.dispose();
    this.bombBodyGeo.dispose();
    this.bombGeo.dispose();
    this.playerShellMat.dispose();
    this.tracerShellMat.dispose();
    this.rocketBodyMat.dispose();
    this.rocketNoseMat.dispose();
    this.bombShellMat.dispose();
    this.stickyBombMat.dispose();
  }
}
