import * as THREE from 'three';
import { perfProfiler } from '../engine/perf/PerfProfiler';
import {
  VOXEL_SIZE,
  WATER_LEVEL,
  VEH_DIM_X,
  VEH_DIM_Y,
  VEH_DIM_Z,
  SYMMETRY_CENTER_X,
  SUBTERRANEAN_DEPTH_VY,
  MAT,
  MAT_INFO,
  BUILD_SLOTS,
  VEHICLE_SKINS,
  type VehicleSkinId,
  type ModuleKind,
  type ModuleTuningConfig,
  type BuildSlotItem,
  type BuildPlacementMode,
  type SerializedVehicleBlueprint,
} from './constants.ts';
import {
  areAITeamsHostile,
  createDefaultAIBrainMemory,
  createDefaultVehicleAIConfig,
  type AIBrainMemory,
  type VehicleAIConfig,
  type VehicleAITeam,
} from './aiPilot.ts';
import { ModRegistry, type ExtendedMaterialSpec } from './modRegistry.ts';
import {
  type PlacedModuleData,
  type HullSample,
  type Vec3,
  type SelectableBuildObject,
  type RotationAxis,
  rotatePoint3D90,
  isSeatModuleKind,
  hasIntactSeatModule,
  computeRigidBodyProperties,
  computePlacementVoxelCoords,
  computeSphericalCraterOffsets,
  computeAckermannAngles,
  solveTireForces,
  computeWingAerodynamics,
  computeCollisionImpulse,
  raycastVoxelGridDDA,
  computeRayDragPlaneVoxel,
  greedyMeshBoundedArrays,
  computeHullPointBuoyancy,
  parseVoxelCoords,
  computeFloodFillPaintCoords,
  computeFaceExtrudeCoords,
} from './physicsMath.ts';
import { CustomRigidBody } from './physics/customRigidBody.ts';
import {
  PropRigidBody,
  stepPropRigidBody,
} from './physics/propRigidBody.ts';
import { terrainEntityManager } from './physics/terrainEntity.ts';
import {
  PHYSICS_CONFIG,
  getMaterialFrictionProfile,
  mapVoxelMatToMaterialType,
} from './physics/physicsConfig.ts';
import {
  VoxelInt32Map,
  packVoxelKey,
  unpackVoxelKey,
  sampleVehicleCollisionPoints,
  type SampledCollisionPoint,
} from './physics/collisionPoints.ts';
import {
  resolveVehicleGroundCollisions,
  ensureHybridWheelState,
  damageWheelFromCollision,
  evaluateHybridWheelStep,
  type HybridWheelModuleLike,
} from './physics/groundCollision.ts';
import {
  getVehicleTuningProfile,
  registerVehicleTuningPreset,
} from './physics/vehicleTuning.ts';
import { updateVehicleWorldAABB } from './physics/broadphase.ts';
import {
  applyDamageToVoxel,
  computeCollisionVoxelDamage,
  type VoxelHpRecord,
} from './physics/destruction.ts';
import {
  checkStructuralIntegrityAfterDestruction,
  updateFallingOffVoxels,
  invalidateConnectivityCache,
  createVehicleConnectivityCache,
  previewBuildModeDisconnections,
  detachDisconnectedVoxelsOnExitBuildMode,
  FALLING_OFF_RENDER_COLOR_CODE,
  type FallingOffVoxelEntry,
  type VehicleConnectivityCache,
} from './physics/structuralIntegrity.ts';
import {
  applyBaumgartePositionCorrection,
  BAUMGARTE_MIN_PENETRATION_METERS,
} from './physics/collisionResponse.ts';
import {
  IGNITED_C4_RENDER_COLOR_CODE,
  igniteC4Voxel,
} from './physics/c4System.ts';
import {
  stepVehicleBasicBuoyancy,
  stepRotorModulePhysics,
  stepJetModulePhysics,
} from './physics/waterAndAirPhysics.ts';
import {
  findDisconnectedVoxelIslands,
  normalizeVoxelObjectToOrigin,
  computePrefabDimensions,
  type VoxelObjectPrefab,
} from './worldObjects.ts';
import { SoundFX } from './sound.ts';
import { updateOrCreateDynamicMeshBuffer, type MicroVoxelWorld } from './world.ts';
import type { VoxelFXSystem } from './fx.ts';
import { createDetailedModuleMesh, updateEcuLedMatrixDisplay } from './models.ts';
import { VEHICLE_PRESETS } from './vehiclePresets.ts';
import {
  evaluateEcuProgram,
  createDefaultEcuOutputState,
  type EcuProgram,
  type HardwarePort,
  type SensorTelemetryContext,
  type EcuOutputState,
  ECU_STARTER_TEMPLATES,
} from './logicSystem.ts';
import {
  applyMeshMaterialPresetSwap,
  createVehicleBlobShadowMesh,
  updateVehicleBlobShadow,
  getSharedVehicleOutlineMaterial,
  getSmoothedOutlineGeometry,
  disposeSmoothedOutlineGeometry,
  type ActiveShaderMode,
} from './potatoShader.ts';

export interface SubAssemblyPrefab {
  id: string;
  name: string;
  createdAt: string;
  voxels: Array<[number, number, number, number]>;
  modules: PlacedModuleData[];
}

export interface ActiveModule
  extends PlacedModuleData,
    Omit<HybridWheelModuleLike, 'kind'> {
  mesh: THREE.Group | null;
  wheelMesh: THREE.Group | null;
  spinMesh: THREE.Object3D | null;
  turretPivot?: THREE.Object3D | null;
  lastCompression: number;
  health?: number;
  seatedPlayerId?: string | null;
}

export function generateVehicleNetworkId(peerId = 'local'): string {
  const safePeer = peerId || 'local';
  return `${safePeer}_veh_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
}

// Pre-allocated scratchpad pool for zero-GC physics and camera loops
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
void _m1;
const _waveTargetNormal = new THREE.Vector3(0, 1, 0);
const _worldUpVec = new THREE.Vector3(0, 1, 0);
const _cockpitEyeOut = new THREE.Vector3();
const _cockpitTargetOut = new THREE.Vector3();
const _cockpitUpOut = new THREE.Vector3();
const _wheelCamEyeOut = new THREE.Vector3();
const _wheelCamTargetOut = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _totalForce = new THREE.Vector3();
const _totalTorque = new THREE.Vector3();
const _rVec = new THREE.Vector3();
const _crossTmp = new THREE.Vector3();
const _localPos = new THREE.Vector3();
const _worldMount = new THREE.Vector3();
const _contactVel = new THREE.Vector3();
const _steerQ = new THREE.Quaternion();
const _modEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _wheelFwd = new THREE.Vector3();
const _wheelRight = new THREE.Vector3();
const _wheelForce = new THREE.Vector3();
const _wp = new THREE.Vector3();
const _invRot = new THREE.Quaternion();
const _localOrigin = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _solidCheckVec = new THREE.Vector3();
const _fxSmokeVec = new THREE.Vector3();
const _tireStepInput = {
  compression: 0,
  restLen: 0.84,
  kSpring: 10000,
  cDamperBump: 1000,
  cDamperRebound: 1500,
  relVelY: 0,
  vLong: 0,
  vLat: 0,
  throttle: 0,
  brake: false,
  isPowered: true,
  engineForcePerWheel: 0,
  topSpeedMPS: 48,
  surfaceMu: 1.15,
  wheelLoadCap: 50000,
  forwardTraction: 1.0,
  sidewaysTraction: 1.0,
};
const _tireStepOutput = {
  normalLoad: 0,
  fLong: 0,
  fLat: 0,
  slipRatio: 0,
};
const _waveSamplePhysics = {
  rawH: 0,
  terracedH: 0,
  slopeX: 0,
  slopeZ: 0,
  orbitalVx: 0,
  orbitalVy: 0,
  orbitalVz: 0,
  colorIndex: 4,
};
const _buoyancyResult = {
  isSubmerged: false,
  subDepth: 0,
  buoyUp: 0,
  waveSlopeFx: 0,
  waveSlopeFz: 0,
  dampingForceY: 0,
};

/**
 * Velocity-Scaled Adaptive Physics Substepping:
 * - Returns 1 substep in Build Mode.
 * - Uses base 2 substeps at rest/low speed, 4 when > 5.0 m/s, high angular velocity, or active collision.
 * - Scales with velocity via `Math.ceil((linearSpeedMPS * dt) / (VOXEL_SIZE * 0.25))` capped at 16,
 *   closing high-speed tunneling permanently even at 1000 km/h (278 m/s).
 */
export function computeAdaptivePhysicsSubsteps(
  linearSpeedMPS: number,
  angularSpeedRadPS: number,
  hasActiveCollision: boolean,
  inBuildMode = false,
  dt = 1 / 60,
): number {
  if (inBuildMode) return 1;
  const baseSteps =
    linearSpeedMPS > 5.0 || angularSpeedRadPS > 1.2 || hasActiveCollision
      ? 4
      : 2;
  const velSteps = Math.ceil((linearSpeedMPS * dt) / (VOXEL_SIZE * 0.25));
  return Math.min(16, Math.max(baseSteps, velSteps));
}

// Shared geometries for Build Mode Ghost Preview (prevents per-frame GC allocation!)
const _sharedPinGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.06, 8);
const _sharedUnitBoxGeo = new THREE.BoxGeometry(
  VOXEL_SIZE * 0.98,
  VOXEL_SIZE * 0.98,
  VOXEL_SIZE * 0.98,
);
const _sharedWeldMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
const _sharedGhostBoxMat = new THREE.MeshBasicMaterial({
  color: 0x38bdf8,
  transparent: true,
  opacity: 0.5,
});
const _sharedArrowConeGeo = new THREE.ConeGeometry(0.11, 0.26, 8);
const _sharedArrowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

const _sharedHeadlightBeamGeo = (() => {
  const g = new THREE.ConeGeometry(1.35, 5.2, 12, 1, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 2.75);
  (g.userData as any).isSharedPrimitive = true;
  return g;
})();
const _sharedHeadlightBeamMat = new THREE.MeshBasicMaterial({
  color: 0xfffbeb,
  transparent: true,
  opacity: 0.11,
  side: THREE.DoubleSide,
  depthWrite: false,
});

// Shared Material Cache so placing 50+ complex weapon/engine modules never duplicates WebGL shaders or leaks materials
const _moduleMatCache = new Map<string, THREE.Material>();

function getCachedModuleMat(
  hex: number,
  isGhost: boolean,
  isCharred: boolean,
  isGlow: boolean,
): THREE.Material {
  const key = `${hex}:${isGhost ? 1 : 0}:${isCharred ? 1 : 0}:${isGlow ? 1 : 0}`;
  let mat = _moduleMatCache.get(key);
  if (mat) return mat;

  if (isGhost) {
    mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: isGlow ? 0.68 : 0.55,
    });
  } else if (isGlow) {
    const c = new THREE.Color(hex);
    if (isCharred) c.multiplyScalar(0.45);
    mat = new THREE.MeshBasicMaterial({ color: c });
  } else {
    const c = new THREE.Color(hex);
    if (isCharred) c.multiplyScalar(0.38);
    mat = new THREE.MeshLambertMaterial({ color: c });
  }
  _moduleMatCache.set(key, mat);
  return mat;
}

function disposeModuleGroupGeometries(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      if (
        !child.geometry.userData?.isSharedPrimitive &&
        child.geometry !== _sharedPinGeo &&
        child.geometry !== _sharedUnitBoxGeo &&
        child.geometry !== _sharedArrowConeGeo
      ) {
        child.geometry.dispose();
      }
    }
  });
}

export class ModularVehicleRig {
  public scene: THREE.Scene;
  public world: MicroVoxelWorld;
  public fx: VoxelFXSystem;

  // Unbounded Sparse Voxel Storage: uses bit-packed int32 keys via VoxelInt32Map!
  public voxelMap = new VoxelInt32Map<number>();
  // Structural Integrity Health Map: 1.0 = pristine, < 0.5 = darkened charred + smoking
  public voxelHealthMap = new VoxelInt32Map<number>();
  // Step 2.4 & 2.5: Per-voxel HP records, 10-neighbor connectivity cache, and falling_off queue
  public voxelDestructionMap = new Map<number, VoxelHpRecord>();
  public fallingOffVoxels = new Map<number, FallingOffVoxelEntry>();
  public ignitedC4Voxels = new Map<number, number>();
  public coreVoxelKeys = new Set<number>();
  public connectivityCache: VehicleConnectivityCache = createVehicleConnectivityCache();
  private lastAppliedConfigMassScale = 1.0;
  public aabbMin = new THREE.Vector3();
  public aabbMax = new THREE.Vector3();
  public isLocalPlayerOccupied = false;
  public lastDamageImpactWorld: THREE.Vector3 | null = null;
  public damagedVoxelsList: Array<{ vx: number; vy: number; vz: number }> = [];
  public structuralIntegrityPct = 100;
  public damagedBlockCount = 0;
  public hullDirty = true;
  // #5 — Deferred physics collision-hull rebuild flag so bullet impacts update visuals immediately
  // and recompute collision hull / mass properties on the next physics frame!
  public pendingPhysicsHullRebuild = false;
  public inPlaceChassisBufferUpdates = 0;
  private pendingImpactOldRootWorld: THREE.Vector3 | null = null;
  public rigidBody = new CustomRigidBody();
  public get rapierBridge(): CustomRigidBody {
    return this.rigidBody;
  }
  private smokeEmitTimer = 0;

  public minVX = 0;
  public maxVX = VEH_DIM_X - 1;
  public minVY = 0;
  public maxVY = VEH_DIM_Y - 1;
  public minVZ = 0;
  public maxVZ = VEH_DIM_Z - 1;
  public boundingRadius = 2.6;

  public modules: ActiveModule[] = [];
  public cachedWheelMods: ActiveModule[] = [];
  public cachedWheelPairedSusp: Array<ActiveModule | null> = [];
  public cachedWheelPairedHinge: Array<ActiveModule | null> = [];
  public cachedSteeringHingeCount = 0;
  public cachedPrimarySeat: ActiveModule | null = null;
  public cachedHoverVoxels: Array<{
    vx: number;
    vy: number;
    vz: number;
    hoverForce: number;
  }> = [];
  public moduleVoxelLookup = new Map<string, number>();
  public smoothedSteerSignal = 0;
  private salvoCursor = 0;
  public hullSamples: HullSample[] = [];
  public collisionPoints: Vec3[] = [];
  public voxelSpawnTimes = new VoxelInt32Map<number>();

  markVoxelSpawnTime(vx: number, vy: number, vz: number, nowSec?: number): void {
    const t =
      nowSec !== undefined
        ? nowSec
        : typeof performance !== 'undefined'
          ? performance.now() * 0.001
          : 0;
    this.voxelSpawnTimes.set(packVoxelKey(vx, vy, vz), t > 0 ? t : 0.001);
  }

  public rootGroup: THREE.Group;
  public chassisMesh: THREE.Mesh | null = null;
  public chassisTransMesh: THREE.Mesh | null = null;
  public modulesGroup: THREE.Group;
  public ghostGroup: THREE.Group;
  public contactShadowMesh: THREE.Mesh;

  public comMarker: THREE.Group;
  public cobMarker: THREE.Group;
  public cotMarker: THREE.Group;
  public hoverRingGroup: THREE.Group;
  public symmetryPlane: THREE.Mesh;

  public position: THREE.Vector3 = this.rigidBody.position;
  public hoverAnchorPos = new THREE.Vector3(0, 3.2 + (10 + SUBTERRANEAN_DEPTH_VY + 1) * VOXEL_SIZE, -2);
  public hoverTime = 0;
  public velocity: THREE.Vector3 = this.rigidBody.velocity;
  public prevVelocity = new THREE.Vector3();
  public gForce = 1.0;
  public quaternion: THREE.Quaternion = this.rigidBody.quaternion;
  public angularVelocity: THREE.Vector3 = this.rigidBody.angularVelocity;
  private isSteppingPhysics = false;

  private lastShadowProbeX = Number.NaN;
  private lastShadowProbeZ = Number.NaN;
  private cachedShadowFloorY = 14.0;

  private resolveShadowFloorY(wx: number, wy: number, wz: number): number {
    if (
      Math.abs(wx - this.lastShadowProbeX) > 0.14 ||
      Math.abs(wz - this.lastShadowProbeZ) > 0.14
    ) {
      this.lastShadowProbeX = wx;
      this.lastShadowProbeZ = wz;
      const ground = this.world.probeGroundBelow(wx, wy, wz, 2.0);
      const hasWater = this.world.isWaterAt(wx, WATER_LEVEL - 0.1, wz);
      this.cachedShadowFloorY = hasWater ? Math.max(WATER_LEVEL, ground.y) : ground.y;
    }
    return this.cachedShadowFloorY;
  }

  private lastAuxX = Number.NaN;
  private lastAuxY = Number.NaN;
  private lastAuxZ = Number.NaN;
  private lastAuxQx = Number.NaN;
  private lastAuxQy = Number.NaN;
  private lastAuxQz = Number.NaN;
  private lastAuxQw = Number.NaN;
  private lastAuxFlags = -1;

  /**
   * Explicitly syncs plain Vector3/Quaternion physics state + comLocal into VoxelWorld flat Float32Arrays.
   */
  public syncToVoxelWorld(): void {
    this.rigidBody.syncToVoxelWorld();
    this.rigidBody.voxelWorld.setBodyComLocal(
      this.rigidBody.slotIndex,
      this.comLocal.x,
      this.comLocal.y,
      this.comLocal.z,
    );
    this.rootGroup.matrixWorldNeedsUpdate = true;
  }

  /**
   * Explicitly reads integrated pose & velocity from VoxelWorld flat Float32Arrays into plain Vector3/Quaternion fields.
   */
  public syncFromVoxelWorld(): void {
    this.rigidBody.syncFromVoxelWorld();
  }

  /**
   * Updates auxiliary visuals (contact blob shadow, headlights, AI badge) reading directly from VoxelWorld SoA pose.
   * Skips all work when pose and visual toggle flags are unchanged (e.g. sleeping entities).
   */
  public updateAuxiliaryVisuals(force = false): void {
    const vw = this.rigidBody.voxelWorld;
    const o3 = this.rigidBody.slotIndex * 3;
    const o4 = this.rigidBody.slotIndex * 4;
    const px = vw.bodyPositions[o3];
    const py = vw.bodyPositions[o3 + 1];
    const pz = vw.bodyPositions[o3 + 2];
    const qx = vw.bodyQuaternions[o4];
    const qy = vw.bodyQuaternions[o4 + 1];
    const qz = vw.bodyQuaternions[o4 + 2];
    const qw = vw.bodyQuaternions[o4 + 3];

    const flags =
      (this.inBuildMode ? 1 : 0) |
      (this.blobShadowsEnabled ? 2 : 0) |
      (this.headlightsOn ? 4 : 0) |
      (this.aiConfig.enabled ? 8 : 0);

    if (
      !force &&
      px === this.lastAuxX &&
      py === this.lastAuxY &&
      pz === this.lastAuxZ &&
      qx === this.lastAuxQx &&
      qy === this.lastAuxQy &&
      qz === this.lastAuxQz &&
      qw === this.lastAuxQw &&
      flags === this.lastAuxFlags &&
      !this.aiConfig.enabled
    ) {
      return;
    }

    this.lastAuxX = px;
    this.lastAuxY = py;
    this.lastAuxZ = pz;
    this.lastAuxQx = qx;
    this.lastAuxQy = qy;
    this.lastAuxQz = qz;
    this.lastAuxQw = qw;
    this.lastAuxFlags = flags;

    this.rootGroup.matrixWorldNeedsUpdate = true;

    // Fast quaternion-rotated forward (0,0,1) and up (0,1,0) without creating/mutating extra views
    const fx = 2 * (qx * qz + qw * qy);
    const fy = 2 * (qy * qz - qw * qx);
    const fz = 1 - 2 * (qx * qx + qy * qy);

    if (this.contactShadowMesh) {
      const floorY = this.resolveShadowFloorY(px, py, pz);
      const footX = Math.max(2.6, (this.maxVX - this.minVX + 2) * VOXEL_SIZE);
      const footZ = Math.max(3.4, (this.maxVZ - this.minVZ + 2) * VOXEL_SIZE);
      updateVehicleBlobShadow(
        this.contactShadowMesh,
        px,
        py,
        pz,
        floorY,
        footX,
        footZ,
        Math.atan2(fx, fz),
        this.blobShadowsEnabled && !this.inBuildMode,
      );
    }

    const showLights =
      this.headlightsOn &&
      !this.inBuildMode &&
      (this.voxelCount > 0 || this.modules.length > 0);
    if (this.headlightSpot) this.headlightSpot.visible = showLights;
    if (this.headlightCaveFill) this.headlightCaveFill.visible = showLights;
    if (showLights && this.headlightSpot && this.headlightCaveFill && this.headlightTarget) {
      const ux = 2 * (qx * qy - qw * qz);
      const uy = 1 - 2 * (qx * qx + qz * qz);
      const uz = 2 * (qy * qz + qw * qx);

      let headlightCount = 0;
      for (let i = 0; i < this.modules.length; i++) {
        if (this.modules[i].kind === 'HEADLIGHT') headlightCount++;
      }
      const boost = 1 + Math.min(4, headlightCount) * 0.35;
      this.headlightSpot.intensity = 5.5 * boost;
      this.headlightCaveFill.intensity = 3.4 * boost;

      this.headlightSpot.position.set(
        px + fx * 1.6 + ux * 0.45,
        py + fy * 1.6 + uy * 0.45,
        pz + fz * 1.6 + uz * 0.45,
      );
      this.headlightTarget.position.set(
        px + fx * 24.0 - ux,
        py + fy * 24.0 - uy,
        pz + fz * 24.0 - uz,
      );
      this.headlightCaveFill.position.set(
        px + fx * 7.5 + ux * 0.9,
        py + fy * 7.5 + uy * 0.9,
        pz + fz * 7.5 + uz * 0.9,
      );
    }

    if (this.aiConfig.enabled || this.aiBadgeSprite) {
      this.updateAiPersonalityBadge(px, py, pz);
    }
  }

  /**
   * Syncs plain Vector3/Quaternion pose into VoxelWorld and updates auxiliary visuals (shadows, headlights, AI badge).
   */
  syncVisualTransformWithPose(): void {
    this.syncToVoxelWorld();
    this.updateAuxiliaryVisuals(true);
  }

  syncVisualTransform(): void {
    this.syncToVoxelWorld();
    this.updateAuxiliaryVisuals(false);
  }

  syncPhysicsSnapshot(): void {
    this.syncToVoxelWorld();
    this.updateAuxiliaryVisuals(true);
  }

  private updateAiPersonalityBadge(wx: number, wy: number, wz: number): void {
    const shouldShow =
      this.aiConfig.enabled &&
      !this.isVoxelEntity &&
      !this.inBuildMode &&
      (this.voxelCount > 0 || this.modules.length > 0);
    if (!shouldShow) {
      if (this.aiBadgeSprite) this.aiBadgeSprite.visible = false;
      return;
    }
    if (typeof document === 'undefined') return;

    if (!this.aiBadgeSprite) {
      const canvas = document.createElement('canvas');
      canvas.width = 224;
      canvas.height = 56;
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(2.75, 0.68, 1);
      sprite.renderOrder = 998;
      this.scene.add(sprite);
      this.aiBadgeCanvas = canvas;
      this.aiBadgeTexture = texture;
      this.aiBadgeSprite = sprite;
      this.aiBadgeLastKey = '';
    }

    this.aiBadgeSprite.visible = true;
    const topOffset = Math.max(
      1.85,
      (this.maxVY - this.minVY + 2) * VOXEL_SIZE * 0.55 + 1.25,
    );
    this.aiBadgeSprite.position.set(wx, wy + topOffset, wz);

    const p = this.aiConfig.personality;
    const eff = this.aiConfig.effectivePersonality;
    const status = this.aiConfig.statusLabel || '';
    const key = `${p}|${eff}|${this.aiConfig.team}|${status}`;
    if (key === this.aiBadgeLastKey) return;
    this.aiBadgeLastKey = key;

    const ctx = this.aiBadgeCanvas?.getContext('2d');
    if (!ctx || !this.aiBadgeCanvas || !this.aiBadgeTexture) return;

    const w = this.aiBadgeCanvas.width;
    const h = this.aiBadgeCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const accent =
      p === 'AGGRESSIVE' ? '#ef4444' : p === 'CAUTIOUS' ? '#38bdf8' : '#facc15';
    const bgFill =
      p === 'AGGRESSIVE'
        ? 'rgba(28, 10, 12, 0.92)'
        : p === 'CAUTIOUS'
          ? 'rgba(10, 22, 34, 0.92)'
          : 'rgba(28, 22, 8, 0.92)';

    ctx.fillStyle = bgFill;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 3);
    ctx.fill();
    ctx.stroke();

    // Personality colored indicator square
    ctx.fillStyle = accent;
    ctx.fillRect(16, h / 2 - 7, 14, 14);

    const pShort =
      p === 'AGGRESSIVE' ? 'AGGR' : p === 'CAUTIOUS' ? 'CAUT' : 'MIX';
    ctx.font = 'bold 19px JetBrains Mono, monospace';
    ctx.fillStyle = accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pShort, 38, h / 2 + 1);

    const tag = status.slice(0, 10) || this.aiConfig.role;
    ctx.font = 'bold 13px JetBrains Mono, monospace';
    ctx.fillStyle = '#f5f5f5';
    ctx.fillText(tag, 98, h / 2 + 1);

    this.aiBadgeTexture.needsUpdate = true;
  }

  public totalMass = 600;
  public totalBuoyancy = 720;
  public voxelCount = 0;
  public comLocal = new THREE.Vector3(3.0, 1.0, 4.5);
  public cobLocal = new THREE.Vector3(3.0, 1.1, 4.5);
  public cotLocal = new THREE.Vector3(3.0, 1.0, 4.0);
  public inertia = new THREE.Vector3(1200, 1600, 950);

  public inBuildMode = false;
  public mirrorMode = true;
  public showForces = true;
  public static readonly MIN_BLOCKS_FOR_FORCE_MARKERS = 12;

  /**
   * Returns true only when in Build Mode, `showForces` is enabled, AND the vehicle
   * has at least `MIN_BLOCKS_FOR_FORCE_MARKERS` (12) total voxels + modules so tiny builds
   * (like 1-voxel scratch builds) are never hidden underneath the 0.38m CoM/CoL/CoT spheres.
   */
  public shouldShowForceMarkers(): boolean {
    return (
      this.inBuildMode &&
      this.showForces &&
      this.voxelCount + this.modules.length >=
        ModularVehicleRig.MIN_BLOCKS_FOR_FORCE_MARKERS
    );
  }

  public syncForceMarkersVisibility(): void {
    const vis = this.shouldShowForceMarkers();
    if (this.comMarker) this.comMarker.visible = vis;
    if (this.cobMarker) this.cobMarker.visible = vis;
    if (this.cotMarker) this.cotMarker.visible = vis;
  }

  public toggleForcesOverlay(): boolean {
    this.showForces = !this.showForces;
    this.syncForceMarkersVisibility();
    return this.showForces;
  }

  public gyroEnabled = false;
  public partYawIndex = 0;
  public partPitchIndex = 0;
  public partRollIndex = 0;
  public presetIndex = 0;
  public customBlueprintName: string | null = null;
  public steerAngle = 0;
  public touchSteerInput = 0;
  public touchThrottleInput = 0;
  public touchPitchInput = 0;
  public aiSteerInput = 0;
  public aiThrottleInput = 0;
  public aiPitchInput = 0;
  public aiRollInput = 0;
  public aiCollectiveInput = 0;
  public aiBrakeInput = false;
  private aiBadgeSprite: THREE.Sprite | null = null;
  private aiBadgeCanvas: HTMLCanvasElement | null = null;
  private aiBadgeTexture: THREE.CanvasTexture | null = null;
  private aiBadgeLastKey = '';
  public vtolCollective = 0;
  public cannonCooldown = 0;
  public meleeCooldown = 0;
  public skidCooldown = 0;
  public crashCooldown = 0;
  public isBoostingNow = false;
  public isDrifting = false;
  public intactBlueprintSnapshot: SerializedVehicleBlueprint | null = null;
  public undoStack: SerializedVehicleBlueprint[] = [];
  public static readonly MAX_UNDO_HISTORY = 32;

  public engineCount = 0;
  public thrusterCount = 0;
  public propCount = 0;
  public wingCount = 0;
  public vtolCount = 0;
  public gyroCount = 0;
  public cannonCount = 0;
  public wheelCount = 0;
  public pistonCount = 0;
  public winchCount = 0;
  public powerCores = 0;

  // Mechanical Actuators: Hydraulic Piston [X] & Grapple Tow Winch [G]/[T]
  public pistonExtended = false;
  public pistonExtRatio = 0;
  public winchAnchorWorld: THREE.Vector3 | null = null;
  public winchTargetRig: ModularVehicleRig | null = null;
  public winchTargetLocalPos = new THREE.Vector3();
  public winchRestLength = 4.0;
  public winchLineMesh: THREE.Line;
  public winchCableCylinderMesh: THREE.Mesh;
  public winchHookMesh: THREE.Group;
  public aimTargetWorld: THREE.Vector3 | null = null;
  public detachedIslandsCount = 0;
  public logicChannelSignals: boolean[] = new Array(9).fill(false);
  public engineHeatPct = 0;

  // Micro:bit ECU Programmable Logic & Hardware-Gated Wiring
  public ecuPrograms: Record<string, EcuProgram> = {};
  public activeEcuId: string | null = null;
  public hardwarePorts: HardwarePort[] = [];
  public hoveredPortId: string | null = null;
  public wiringLaserLine: THREE.Line;
  public lastEcuOutput: EcuOutputState = createDefaultEcuOutputState();

  // Tactical Modules & Builder Power-Tool State (101 - 107)
  public magnetActiveMode: 'OFF' | 'ATTRACT' | 'REPEL' = 'OFF';
  public parachuteDeployed = false;
  public outriggersExtended = false;
  public outriggerExtRatio = 0;
  public countermeasureCooldown = 0;
  public showWiringOverlay = false;
  public wiringLinesGroup: THREE.Group;
  public ghostBlueprintGroup: THREE.Group;
  public heading = 0;
  public get structuralHealth(): number {
    return this.structuralIntegrityPct / 100;
  }
  public get summary(): { voxelCount: number } {
    return { voxelCount: this.voxelCount };
  }
  public get magnetCouplerCount(): number {
    return this.modules.filter((m) => m.kind === 'MAGNET_COUPLER' && (m.health ?? 1) > 0).length;
  }
  public get magnetCouplerMode(): 'OFF' | 'ATTRACT' | 'REPEL' {
    return this.magnetActiveMode;
  }
  public get parachuteCount(): number {
    return this.modules.filter((m) => m.kind === 'PARACHUTE_AIRBRAKE' && (m.health ?? 1) > 0).length;
  }
  public get outriggerCount(): number {
    return this.modules.filter((m) => m.kind === 'OUTRIGGER_JACK' && (m.health ?? 1) > 0).length;
  }
  public get outriggersDeployed(): boolean {
    return this.outriggersExtended;
  }
  public get smokeFlareCount(): number {
    return this.modules.filter((m) => m.kind === 'SMOKE_FLARE' && (m.health ?? 1) > 0).length;
  }

  // High-Power Halogen Headlights & Seat Breakage Callback
  public headlightsOn = true;
  public headlightSpot: THREE.SpotLight;
  public headlightTarget: THREE.Object3D;
  public headlightCaveFill: THREE.PointLight;
  public headlightBeamMeshes: THREE.Object3D[] = [];
  public onSeatBroken: (() => void) | null = null;

  public rawFaces = 0;
  public mergedQuads = 0;
  public blobShadowsEnabled = true;
  public usePotatoShader = false;
  public useCartoonShader = false;
  public chassisOutlineMesh: THREE.Mesh | null = null;
  private chassisOutlineNeedsRefresh = false;

  public speedKmh = 0;
  public altitudeMeters = 0;
  public pitchDeg = 0;
  public rollDeg = 0;
  public statusLabel = 'GROUNDED';
  public engineRpm = 850;

  // Multi-Vehicle & P2P Multiplayer Authority Fields
  public networkId = generateVehicleNetworkId('local');
  public get vehicleId(): string {
    return this.networkId;
  }
  public set vehicleId(val: string) {
    this.networkId = val;
  }
  public ownerPeerId = 'local';
  public driverPeerId: string | null = null;
  public isRemoteControlled = false;
  public isVoxelEntity = false;
  public propRigidBody: PropRigidBody | null = null;
  public entityPresetId: string | null = null;
  public entityName: string | null = null;
  public entityMassMultiplier = 1.0;
  public smokeBurnRemainingSec = 0;
  public submarineBallastTrim = 0.25; // -1 = Dive, 0 = Neutral Hover, +1 = Surface
  public get hasSubmarineBallast(): boolean {
    for (let i = 0; i < this.modules.length; i++) {
      const k = this.modules[i].kind;
      if (k === 'BCD_TANK' || k === 'SEAT_DIVING') return true;
    }
    return false;
  }
  public turretCameraAimEnabled = true;
  public weatherGripMult = 1.0;
  public aiConfig: VehicleAIConfig = createDefaultVehicleAIConfig();
  public aiBrainMemory: AIBrainMemory = createDefaultAIBrainMemory();

  private lastGhostSignature = '';

  constructor(
    scene: THREE.Scene,
    world: MicroVoxelWorld,
    fx: VoxelFXSystem,
    ownerPeerId = 'local',
    skipInitialPreset = false,
    isVoxelEntity = false,
  ) {
    this.isVoxelEntity = isVoxelEntity;
    if (isVoxelEntity) {
      this.headlightsOn = false;
    }
    this.ownerPeerId = ownerPeerId || 'local';
    this.networkId = generateVehicleNetworkId(
      isVoxelEntity ? 'entity' : this.ownerPeerId,
    );
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    if (!isVoxelEntity && (!this.fx.rig || this.ownerPeerId === 'local')) {
      this.fx.rig = this;
    }
    if (!this.fx.rigs.includes(this)) {
      this.fx.rigs.push(this);
    }

    this.position.set(0, 1.35 + (10 + SUBTERRANEAN_DEPTH_VY + 1) * VOXEL_SIZE, -2);
    this.comLocal.set(3.0, 1.0, 4.5);
    this.rigidBody.syncToVoxelWorld();
    this.rigidBody.voxelWorld.setBodyComLocal(this.rigidBody.slotIndex, 3.0, 1.0, 4.5);

    this.rootGroup = new THREE.Group();
    (this.rootGroup as any).voxelWorldRef = this.rigidBody.voxelWorld;
    (this.rootGroup as any).voxelBodySlot = this.rigidBody.slotIndex;
    this.scene.add(this.rootGroup);
    this.rigidBody.voxelWorld.bodyRootGroups[this.rigidBody.slotIndex] = this.rootGroup;
    this.rigidBody.voxelWorld.bodyVoxelMaps[this.rigidBody.slotIndex] = this.voxelMap;

    this.modulesGroup = new THREE.Group();
    this.rootGroup.add(this.modulesGroup);

    this.ghostGroup = new THREE.Group();
    this.ghostGroup.visible = false;
    this.rootGroup.add(this.ghostGroup);

    // Trailmakers 3D Engineering Force Centers (CoM Yellow/Black Checkered, CoL Cyan Lift Arrow, CoT Orange Thrust Vector)
    this.comMarker = this.createMarker(0xfacc15, 0.38, 'com');
    this.cobMarker = this.createMarker(0x38bdf8, 0.34, 'lift');
    this.cotMarker = this.createMarker(0xff6600, 0.34, 'thrust');
    this.comMarker.visible = false;
    this.cobMarker.visible = false;
    this.cotMarker.visible = false;
    if (!isVoxelEntity) {
      this.rootGroup.add(this.comMarker, this.cobMarker, this.cotMarker);
    }

    // Trailmakers Blueprint Grid Floor & Holo-Tether Platform underneath the hovering vehicle
    this.hoverRingGroup = this.createHoverRingMesh();
    if (!isVoxelEntity) {
      this.scene.add(this.hoverRingGroup);
    }

    // Shared 64x64 Radial Gradient Blob Shadow Grounding Plane (1 draw call per vehicle, no shadow map pass needed)
    this.contactShadowMesh = createVehicleBlobShadowMesh();
    this.scene.add(this.contactShadowMesh);

    // Trailmakers Center Symmetry Plane (dynamically scales with unbounded vehicle length!)
    const symGeo = new THREE.PlaneGeometry(18.0, 8.0);
    const symMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.symmetryPlane = new THREE.Mesh(symGeo, symMat);
    this.symmetryPlane.rotation.y = Math.PI / 2;
    this.symmetryPlane.position.set(
      SYMMETRY_CENTER_X * VOXEL_SIZE,
      VEH_DIM_Y * 0.5 * VOXEL_SIZE,
      VEH_DIM_Z * 0.5 * VOXEL_SIZE,
    );
    this.symmetryPlane.visible = false;
    if (!isVoxelEntity) {
      this.rootGroup.add(this.symmetryPlane);
    }

    // Grappling Winch Cable Line + Taut 3D Cylindrical Steel Cable & Hook
    const winchGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const winchMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      linewidth: 2,
    });
    this.winchLineMesh = new THREE.Line(winchGeo, winchMat);
    this.winchLineMesh.frustumCulled = false;
    this.winchLineMesh.visible = false;
    if (!isVoxelEntity) {
      this.scene.add(this.winchLineMesh);
    }

    const cableCylGeo = new THREE.CylinderGeometry(0.038, 0.038, 1.0, 8);
    cableCylGeo.rotateX(Math.PI / 2);
    const cableCylMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.35,
      metalness: 0.8,
      roughness: 0.3,
    });
    this.winchCableCylinderMesh = new THREE.Mesh(cableCylGeo, cableCylMat);
    this.winchCableCylinderMesh.frustumCulled = false;
    this.winchCableCylinderMesh.visible = false;
    if (!isVoxelEntity) {
      this.scene.add(this.winchCableCylinderMesh);
    }

    this.winchHookMesh = new THREE.Group();
    const hookHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.07, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.6, roughness: 0.3 }),
    );
    hookHub.rotation.x = Math.PI / 2;
    this.winchHookMesh.add(hookHub);
    for (let c = 0; c < 3; c++) {
      const ang = (c * Math.PI * 2) / 3;
      const prong = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.18, 0.14),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.25 }),
      );
      prong.position.set(Math.cos(ang) * 0.1, Math.sin(ang) * 0.1, 0.05);
      this.winchHookMesh.add(prong);
    }
    this.winchHookMesh.visible = false;
    if (!isVoxelEntity) {
      this.scene.add(this.winchHookMesh);
    }

    // Vehicle Forward Halogen Headlight SpotLight + Subterranean Cave Fill PointLight
    this.headlightSpot = new THREE.SpotLight(0xfffbeb, 5.5, 68, Math.PI / 2.5, 0.55, 1.0);
    this.headlightTarget = new THREE.Object3D();
    this.headlightSpot.target = this.headlightTarget;
    this.headlightCaveFill = new THREE.PointLight(0xfff7ed, 3.2, 42, 1.1);
    if (!isVoxelEntity) {
      this.scene.add(this.headlightSpot);
      this.scene.add(this.headlightTarget);
      this.scene.add(this.headlightCaveFill);
    } else {
      this.headlightSpot.visible = false;
      this.headlightCaveFill.visible = false;
    }

    // Micro:bit ECU Visual 3D Laser Wire (links ECU to hovered hardware port)
    const laserMat = new THREE.LineBasicMaterial({
      color: 0x00f5ff,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const laserGeo = new THREE.BufferGeometry();
    laserGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.wiringLaserLine = new THREE.Line(laserGeo, laserMat);
    this.wiringLaserLine.renderOrder = 999;
    this.wiringLaserLine.visible = false;
    if (!isVoxelEntity) {
      this.rootGroup.add(this.wiringLaserLine);
    }

    this.wiringLinesGroup = new THREE.Group();
    this.wiringLinesGroup.visible = false;
    this.ghostBlueprintGroup = new THREE.Group();
    this.ghostBlueprintGroup.visible = false;
    if (!isVoxelEntity) {
      this.rootGroup.add(this.wiringLinesGroup);
      this.rootGroup.add(this.ghostBlueprintGroup);
    }

    if (!skipInitialPreset && !isVoxelEntity) {
      this.loadPreset(0);
    }
  }

  /**
   * Assigns a cryptographically unique networkId and ownerPeerId to this vehicle,
   * and optionally seats the creator in the primary seat (`seatIndex = 0`).
   */
  assignNetworkIdentity(
    peerId: string,
    customNetworkId?: string,
    autoSeatCreator = true,
  ): void {
    const resolvedPeer = peerId || 'local';
    this.ownerPeerId = resolvedPeer;
    this.networkId =
      customNetworkId ||
      `${resolvedPeer}_veh_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    if (autoSeatCreator) {
      this.claimSeat(0, resolvedPeer);
    }
  }

  /**
   * Returns true if `myPeerId` is the sole physics owner of this vehicle.
   */
  isLocalOwner(myPeerId: string): boolean {
    const effectiveMyId = myPeerId || 'local';
    if (this.ownerPeerId === effectiveMyId) return true;
    if (this.ownerPeerId === 'local' && !this.isRemoteControlled) return true;
    return false;
  }

  /**
   * Returns all intact seat modules installed on the vehicle.
   */
  getSeatModules(): ActiveModule[] {
    return this.modules.filter(
      (m) => isSeatModuleKind(m.kind) && (m.health ?? 1.0) > 0,
    );
  }

  /**
   * Returns the peerId currently seated in the primary driver seat (`seatIndex = 0`), or null if empty.
   */
  getPrimarySeatOccupant(): string | null {
    const seats = this.getSeatModules();
    if (seats.length > 0 && seats[0].seatedPlayerId !== undefined) {
      return seats[0].seatedPlayerId;
    }
    return this.driverPeerId;
  }

  /**
   * Locks or releases a specific seat on the vehicle (`seatedPlayerId = peerId | null`).
   */
  claimSeat(seatIndex: number, peerId: string | null): boolean {
    const seats = this.getSeatModules();
    if (peerId === null) {
      if (seatIndex >= 0 && seatIndex < seats.length) {
        seats[seatIndex].seatedPlayerId = null;
      } else {
        for (const s of seats) {
          s.seatedPlayerId = null;
        }
      }
      if (seatIndex <= 0) {
        this.driverPeerId = null;
      }
      return true;
    }

    const targetSeat = seats[seatIndex] || seats[0];
    if (targetSeat) {
      targetSeat.seatedPlayerId = peerId;
    }
    if (seatIndex === 0 || seats.length <= 1) {
      this.driverPeerId = peerId;
    }
    return true;
  }

  /**
   * Releases all seats on this vehicle currently occupied by `peerId`.
   */
  releasePlayerSeats(peerId: string): number {
    let released = 0;
    for (const m of this.modules) {
      if (m.seatedPlayerId === peerId) {
        m.seatedPlayerId = null;
        released++;
      }
    }
    if (this.driverPeerId === peerId) {
      this.driverPeerId = null;
    }
    return released;
  }

  /**
   * Returns true if any seat on this vehicle is currently occupied by a remote peer (`!== myPeerId`).
   */
  isAnySeatOccupiedByOther(myPeerId: string): boolean {
    const effectiveMyId = myPeerId || 'local';
    for (const s of this.getSeatModules()) {
      if (
        s.seatedPlayerId &&
        s.seatedPlayerId !== effectiveMyId &&
        s.seatedPlayerId !== 'local'
      ) {
        return true;
      }
    }
    if (
      this.driverPeerId &&
      this.driverPeerId !== effectiveMyId &&
      this.driverPeerId !== 'local'
    ) {
      return true;
    }
    return false;
  }

  /**
   * Finds the closest intact, EMPTY seat (`seatedPlayerId === null`) within `maxRangeMeters` (default `2.5m`).
   * Used when a player walks up to a vehicle and presses `[E]`.
   */
  findEmptySeatWithinRange(
    worldPos: THREE.Vector3,
    maxRangeMeters = 2.5,
  ): { seatIndex: number; seatMod: ActiveModule; distMeters: number } | null {
    const seats = this.getSeatModules();
    let best: { seatIndex: number; seatMod: ActiveModule; distMeters: number } | null = null;
    const hullHalfWidth = Math.max(
      0,
      ((this.maxVX - this.minVX + 1) * VOXEL_SIZE) * 0.5 - 0.85,
    );

    for (let i = 0; i < seats.length; i++) {
      const seatMod = seats[i];
      const occupant =
        seatMod.seatedPlayerId !== undefined
          ? seatMod.seatedPlayerId
          : i === 0
            ? this.driverPeerId
            : null;
      if (occupant !== null && occupant !== undefined) {
        continue; // Seat is locked/occupied!
      }
      const seatWorld = this.localVoxelToWorld(
        seatMod.vx,
        seatMod.vy,
        seatMod.vz,
      );
      const horizDist = Math.hypot(
        worldPos.x - seatWorld.x,
        worldPos.z - seatWorld.z,
      );
      const effectiveDoorDist = Math.max(0, horizDist - hullHalfWidth);
      const dist = Math.min(horizDist, effectiveDoorDist);
      if (dist <= maxRangeMeters && (!best || dist < best.distMeters)) {
        best = { seatIndex: i, seatMod, distMeters: dist };
      }
    }
    return best;
  }

  /**
   * Returns true if the vehicle currently has at least one intact pilot/driver seat module!
   */
  hasIntactSeat(): boolean {
    return hasIntactSeatModule(this.modules);
  }

  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    this.headlightSpot.visible = this.headlightsOn && !this.inBuildMode;
    this.headlightCaveFill.visible = this.headlightsOn && !this.inBuildMode;
    for (const b of this.headlightBeamMeshes) {
      b.visible = on;
    }
  }

  /**
   * Scans all installed modules and generates stable, order-indexed hardware ports
   * (e.g. DIST #1 (Front), IMU #1, SPEED #1, RADAR #1, THRUSTER #1, HINGE #1, PISTON #1, WEAPON #1).
   */
  computeHardwarePorts(): HardwarePort[] {
    const ports: HardwarePort[] = [];
    let distIdx = 1;
    let imuIdx = 1;
    let speedIdx = 1;
    let radarIdx = 1;
    let thrustIdx = 1;
    let hingeIdx = 1;
    let pistonIdx = 1;
    let weapIdx = 1;
    let lightIdx = 1;
    let ecuIdx = 1;

    for (let i = 0; i < this.modules.length; i++) {
      const mod = this.modules[i];
      const k = mod.kind;
      const hasSignal = (mod.health ?? 1.0) > 0;
      const isFront = mod.vz >= 18;
      const isLeft = mod.vx < SYMMETRY_CENTER_X;

      if (k === 'MICROBIT_ECU') {
        const id = `ECU_${ecuIdx}`;
        ports.push({
          id,
          tag: `MICROBIT #${ecuIdx}`,
          type: 'ECU',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        if (!this.activeEcuId) this.activeEcuId = id;
        ecuIdx++;
      } else if (k === 'SENSOR_DISTANCE') {
        const id = `DIST_${distIdx}`;
        const locTag = isFront ? 'Front' : 'Rear';
        ports.push({
          id,
          tag: `DIST #${distIdx} (${locTag})`,
          type: 'DIST',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        distIdx++;
      } else if (k === 'SENSOR_IMU_TILT' || k === 'SENSOR_ANGLE') {
        const id = `IMU_${imuIdx}`;
        ports.push({
          id,
          tag: `IMU #${imuIdx}`,
          type: 'IMU',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        imuIdx++;
      } else if (k === 'SENSOR_SPEEDO' || k === 'SENSOR_SPEED' || k === 'SENSOR_ALTIMETER') {
        const id = `SPEED_${speedIdx}`;
        ports.push({
          id,
          tag: `SPEED #${speedIdx}`,
          type: 'SPEED',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        speedIdx++;
      } else if (k === 'SENSOR_TARGET_RADAR') {
        const id = `RADAR_${radarIdx}`;
        ports.push({
          id,
          tag: `RADAR #${radarIdx}`,
          type: 'RADAR',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        radarIdx++;
      } else if (
        k === 'THRUSTER' ||
        k === 'THRUSTER_MINI' ||
        k === 'THRUSTER_ROCKET' ||
        k === 'JET_RAW' ||
        k === 'JET_GIMBAL'
      ) {
        const id = `THRUSTER_${thrustIdx}`;
        const loc = isLeft ? 'Left' : 'Right';
        ports.push({
          id,
          tag: `THRUSTER #${thrustIdx} (${loc})`,
          type: 'THRUSTER',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        thrustIdx++;
      } else if (
        k === 'STEERING_HINGE' ||
        k === 'HINGE_LARGE' ||
        k === 'SERVO_SMALL' ||
        k === 'SERVO_SPIN' ||
        k === 'JOINT_MECH'
      ) {
        const id = `HINGE_${hingeIdx}`;
        ports.push({
          id,
          tag: `HINGE #${hingeIdx}`,
          type: 'HINGE',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        hingeIdx++;
      } else if (k === 'PISTON') {
        const id = `PISTON_${pistonIdx}`;
        ports.push({
          id,
          tag: `PISTON #${pistonIdx}`,
          type: 'PISTON',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        pistonIdx++;
      } else if (
        k === 'PLASMA_CANNON' ||
        k === 'WEAPON_MINIGUN' ||
        k === 'WEAPON_ROCKET' ||
        k === 'WEAPON_BOMB_BAY'
      ) {
        const id = `WEAPON_${weapIdx}`;
        ports.push({
          id,
          tag: `WEAPON #${weapIdx}`,
          type: 'WEAPON',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        weapIdx++;
      } else if (k === 'HEADLIGHT') {
        const id = `HEADLIGHT_${lightIdx}`;
        ports.push({
          id,
          tag: `HEADLIGHT #${lightIdx}`,
          type: 'HEADLIGHT',
          modIndex: i,
          kind: k,
          vx: mod.vx,
          vy: mod.vy,
          vz: mod.vz,
          hasSignal,
        });
        lightIdx++;
      }
    }

    this.hardwarePorts = ports;
    return ports;
  }

  getHardwarePorts(): HardwarePort[] {
    return this.computeHardwarePorts();
  }

  /**
   * When hovering over a Scratch block or Inspector port, draws a glowing 3D laser wire
   * connecting the Micro:bit ECU block to that exact physical module on the vehicle!
   */
  setHoveredPort(portId: string | null): void {
    this.hoveredPortId = portId;
    if (!portId || !this.wiringLaserLine) {
      if (this.wiringLaserLine) this.wiringLaserLine.visible = false;
      return;
    }

    const ecuPort =
      this.hardwarePorts.find((p) => p.type === 'ECU') ||
      this.hardwarePorts.find((p) => p.kind === 'MICROBIT_ECU');
    const targetPort = this.hardwarePorts.find(
      (p) =>
        p.id === portId ||
        (portId === 'ALL_THRUSTERS' && p.type === 'THRUSTER') ||
        (portId === 'ALL_WEAPONS' && p.type === 'WEAPON') ||
        (portId === 'ALL_HEADLIGHTS' && p.type === 'HEADLIGHT'),
    );

    if (!ecuPort || !targetPort) {
      this.wiringLaserLine.visible = false;
      return;
    }

    const posAttr = this.wiringLaserLine.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    arr[0] = (ecuPort.vx + 0.5) * VOXEL_SIZE;
    arr[1] = (ecuPort.vy + 0.5) * VOXEL_SIZE;
    arr[2] = (ecuPort.vz + 0.5) * VOXEL_SIZE;
    arr[3] = (targetPort.vx + 0.5) * VOXEL_SIZE;
    arr[4] = (targetPort.vy + 0.5) * VOXEL_SIZE;
    arr[5] = (targetPort.vz + 0.5) * VOXEL_SIZE;
    posAttr.needsUpdate = true;
    this.wiringLaserLine.visible = true;
  }

  /**
   * Toggles the vehicle's forward Halogen Headlights [H]!
   */
  toggleHeadlights(): boolean {
    this.headlightsOn = !this.headlightsOn;
    this.headlightSpot.visible = this.headlightsOn && !this.inBuildMode;
    this.headlightCaveFill.visible = this.headlightsOn && !this.inBuildMode;
    for (const beam of this.headlightBeamMeshes) {
      beam.visible = this.headlightsOn;
    }
    SoundFX.snap();
    return this.headlightsOn;
  }

  private createMarker(
    hex: number,
    size: number,
    mode: 'com' | 'lift' | 'thrust',
  ): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: hex,
      depthTest: false,
      transparent: true,
      opacity: 0.92,
    });
    const darkMat = new THREE.MeshBasicMaterial({
      color: 0x090d16,
      depthTest: false,
      transparent: true,
      opacity: 0.94,
    });

    if (mode === 'com') {
      // High-visibility yellow/black checkered CoM sphere + 3-axis crosshairs
      const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.42, 14, 14), mat);
      core.renderOrder = 25;
      g.add(core);

      const bandXY = new THREE.Mesh(
        new THREE.TorusGeometry(size * 0.43, size * 0.055, 8, 20),
        darkMat,
      );
      const bandYZ = new THREE.Mesh(
        new THREE.TorusGeometry(size * 0.43, size * 0.055, 8, 20),
        darkMat,
      );
      bandYZ.rotation.y = Math.PI / 2;
      const bandXZ = new THREE.Mesh(
        new THREE.TorusGeometry(size * 0.43, size * 0.055, 8, 20),
        darkMat,
      );
      bandXZ.rotation.x = Math.PI / 2;
      bandXY.renderOrder = 26;
      bandYZ.renderOrder = 26;
      bandXZ.renderOrder = 26;
      g.add(bandXY, bandYZ, bandXZ);

      const rx = new THREE.Mesh(new THREE.BoxGeometry(size * 1.65, 0.032, 0.032), mat);
      const ry = new THREE.Mesh(new THREE.BoxGeometry(0.032, size * 1.65, 0.032), mat);
      const rz = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, size * 1.65), mat);
      rx.renderOrder = 25;
      ry.renderOrder = 25;
      rz.renderOrder = 25;
      g.add(rx, ry, rz);
    } else if (mode === 'lift') {
      // Cyan sphere (0x38bdf8) with upward aerodynamic lift vector arrow
      const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.38, 12, 12), mat);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(size * 0.48, 0.022, 8, 18),
        mat,
      );
      ring.rotation.x = Math.PI / 2;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.68, 8), mat);
      shaft.position.y = 0.36;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.24, 10), mat);
      cone.position.y = 0.76;
      core.renderOrder = 25;
      ring.renderOrder = 25;
      shaft.renderOrder = 25;
      cone.renderOrder = 25;
      g.add(core, ring, shaft, cone);
    } else if (mode === 'thrust') {
      // Orange sphere (0xff6600) with directional thrust vector arrow
      const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.38, 12, 12), mat);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(size * 0.46, 0.022, 8, 18),
        mat,
      );
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.68, 8), mat);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.z = 0.36;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.24, 10), mat);
      cone.rotation.x = Math.PI / 2;
      cone.position.z = 0.76;
      core.renderOrder = 25;
      ring.renderOrder = 25;
      shaft.renderOrder = 25;
      cone.renderOrder = 25;
      g.add(core, ring, shaft, cone);
    }
    return g;
  }

  private createHoverRingMesh(): THREE.Group {
    const g = new THREE.Group();
    const gridHelper = new THREE.GridHelper(16.0, 64, 0x38bdf8, 0x1e3a5f);
    gridHelper.position.y = 0.02;
    g.add(gridHelper);

    const outer = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(16.0, 0.16, 16.0)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8 }),
    );
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(16.0, 16.0),
      new THREE.MeshBasicMaterial({
        color: 0x0c243c,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    g.add(outer, pad);
    g.visible = false;
    return g;
  }

  /**
   * Unbounded vehicle grid: allows building vehicles of virtually any length, width, and height!
   */
  inBounds(vx: number, vy: number, vz: number): boolean {
    return (
      vx >= -256 &&
      vx <= 256 &&
      vy >= -64 &&
      vy <= 128 &&
      vz >= -256 &&
      vz <= 256
    );
  }

  getVoxel(vx: number, vy: number, vz: number): number {
    return this.voxelMap.get(packVoxelKey(vx, vy, vz)) || MAT.AIR;
  }

  getVoxelHealth(vx: number, vy: number, vz: number): number {
    return this.voxelHealthMap.get(packVoxelKey(vx, vy, vz)) ?? 1.0;
  }

  setVoxel(vx: number, vy: number, vz: number, mat: number): void {
    if (!this.inBounds(vx, vy, vz)) return;
    const key = packVoxelKey(vx, vy, vz);
    if (mat === MAT.AIR) {
      this.voxelMap.delete(key);
      this.voxelHealthMap.delete(key);
      this.voxelDestructionMap.delete(key);
      this.fallingOffVoxels.delete(key);
      this.ignitedC4Voxels.delete(key);
      this.rigidBody.removeCollisionPointByKey(key);
    } else {
      this.voxelMap.set(key, mat);
      this.voxelHealthMap.delete(key);
      this.voxelDestructionMap.delete(key);
      this.fallingOffVoxels.delete(key);
      this.ignitedC4Voxels.delete(key);
    }
    this.connectivityCache.invalidate();
    invalidateConnectivityCache(this);
    this.hullDirty = true;
    this.lastGhostSignature = '';
  }

  removeVoxel(vx: number, vy: number, vz: number): void {
    this.setVoxel(vx, vy, vz, MAT.AIR);
  }

  clearAll(): void {
    this.voxelMap.clear();
    this.voxelHealthMap.clear();
    this.voxelDestructionMap.clear();
    this.fallingOffVoxels.clear();
    this.ignitedC4Voxels.clear();
    this.coreVoxelKeys.clear();
    invalidateConnectivityCache(this);
    this.hullDirty = true;
    this.damagedVoxelsList = [];
    this.structuralIntegrityPct = 100;
    this.damagedBlockCount = 0;
    for (const m of this.modules) {
      if (m.mesh) {
        this.modulesGroup.remove(m.mesh);
        disposeModuleGroupGeometries(m.mesh);
        m.mesh = null;
      }
    }
    this.modules = [];
    this.moduleVoxelLookup.clear();
    this.minVX = 8;
    this.maxVX = 16;
    this.minVY = 4;
    this.maxVY = 10;
    this.minVZ = 12;
    this.maxVZ = 24;
    this.intactBlueprintSnapshot = null;
    this.lastGhostSignature = '';
  }

  private recomputeActiveBounds(): void {
    if (this.voxelMap.size === 0 && this.modules.length === 0) {
      this.minVX = 10;
      this.maxVX = 14;
      this.minVY = 4;
      this.maxVY = 8;
      this.minVZ = 16;
      this.maxVZ = 20;
      return;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    this.voxelMap.forEach((mat, key) => {
      if (mat === MAT.AIR) return;
      const [vx, vy, vz] = parseVoxelCoords(key);
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;
      if (vz < minZ) minZ = vz;
      if (vz > maxZ) maxZ = vz;
    });

    for (const m of this.modules) {
      if (m.vx - 2 < minX) minX = m.vx - 2;
      if (m.vx + 2 > maxX) maxX = m.vx + 2;
      if (m.vy - 2 < minY) minY = m.vy - 2;
      if (m.vy + 2 > maxY) maxY = m.vy + 2;
      if (m.vz - 2 < minZ) minZ = m.vz - 2;
      if (m.vz + 2 > maxZ) maxZ = m.vz + 2;
    }

    this.minVX = Number.isFinite(minX) ? minX : 0;
    this.maxVX = Number.isFinite(maxX) ? maxX : 23;
    this.minVY = Number.isFinite(minY) ? minY : 0;
    this.maxVY = Number.isFinite(maxY) ? maxY : 19;
    this.minVZ = Number.isFinite(minZ) ? minZ : 0;
    this.maxVZ = Number.isFinite(maxZ) ? maxZ : 35;
    const halfSpanX = Math.max(1, this.maxVX - this.minVX + 1) * VOXEL_SIZE * 0.5;
    const halfSpanY = Math.max(1, this.maxVY - this.minVY + 1) * VOXEL_SIZE * 0.5;
    const halfSpanZ = Math.max(1, this.maxVZ - this.minVZ + 1) * VOXEL_SIZE * 0.5;
    this.boundingRadius = Math.max(
      0.8,
      Math.hypot(halfSpanX, halfSpanY, halfSpanZ),
    );

    // Keep symmetry plane centered on the vehicle's Z/Y span
    const centerZ = (this.minVZ + this.maxVZ + 1) * 0.5 * VOXEL_SIZE;
    const centerY = (this.minVY + this.maxVY + 1) * 0.5 * VOXEL_SIZE;
    const spanZ = Math.max(12.0, (this.maxVZ - this.minVZ + 12) * VOXEL_SIZE);
    const spanY = Math.max(6.0, (this.maxVY - this.minVY + 8) * VOXEL_SIZE);
    this.symmetryPlane.position.set(SYMMETRY_CENTER_X * VOXEL_SIZE, centerY, centerZ);
    this.symmetryPlane.scale.set(spanZ / 18.0, spanY / 8.0, 1);
  }

  fillBox(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    mat: number,
  ): void {
    const sx = Math.min(x0, x1);
    const ex = Math.max(x0, x1);
    const sy = Math.min(y0, y1);
    const ey = Math.max(y0, y1);
    const sz = Math.min(z0, z1);
    const ez = Math.max(z0, z1);
    for (let z = sz; z <= ez; z++) {
      for (let y = sy; y <= ey; y++) {
        for (let x = sx; x <= ex; x++) {
          this.setVoxel(x, y, z, mat);
        }
      }
    }
  }

  addModule(
    kind: ModuleKind,
    vx: number,
    vy: number,
    vz: number,
    yawIdx = 0,
    config?: ModuleTuningConfig,
    pitchIdx = 0,
    rollIdx = 0,
  ): void {
    if (!this.inBounds(vx, vy, vz)) return;
    // Only remove a module if it occupies the exact same voxel coordinate so Suspensions, Hinges, and Wheels can stack directly adjacent!
    this.modules = this.modules.filter((m) => {
      if (m.vx === vx && m.vy === vy && m.vz === vz) {
        if (m.mesh) {
          this.modulesGroup.remove(m.mesh);
          disposeModuleGroupGeometries(m.mesh);
          m.mesh = null;
        }
        return false;
      }
      return true;
    });
    const defaultCfg = BUILD_SLOTS.find((s) => s.kind === kind)?.defaultConfig;
    const kindOverride = this.customKindConfig.get(kind);
    const resolvedConfig: ModuleTuningConfig = {
      ...(defaultCfg ? { ...defaultCfg } : {}),
      ...(kindOverride ? { ...kindOverride } : {}),
      ...(config ? { ...config } : {}),
    };
    this.modules.push({
      kind,
      vx,
      vy,
      vz,
      yawIdx: yawIdx & 3,
      pitchIdx: pitchIdx & 3,
      rollIdx: rollIdx & 3,
      config: resolvedConfig,
      mesh: null,
      wheelMesh: null,
      spinMesh: null,
      lastCompression: 0,
      health: 1.0,
      seatedPlayerId: null,
    });
    this.connectivityCache.invalidate();
    invalidateConnectivityCache(this);
    this.hullDirty = true;
    this.lastGhostSignature = '';
  }

  public customKindConfig = new Map<ModuleKind, ModuleTuningConfig>();

  getModuleAt(vx: number, vy: number, vz: number): ActiveModule | null {
    return (
      this.modules.find((m) => m.vx === vx && m.vy === vy && m.vz === vz) ||
      null
    );
  }

  removeModuleAt(vx: number, vy: number, vz: number): boolean {
    const before = this.modules.length;
    this.modules = this.modules.filter((m) => {
      if (m.vx === vx && m.vy === vy && m.vz === vz) {
        if (m.mesh) {
          this.modulesGroup.remove(m.mesh);
          disposeModuleGroupGeometries(m.mesh);
          m.mesh = null;
        }
        return false;
      }
      return true;
    });
    if (this.modules.length < before) {
      this.connectivityCache.invalidate();
      invalidateConnectivityCache(this);
      this.hullDirty = true;
      return true;
    }
    return false;
  }

  rotateModuleAt(
    vx: number,
    vy: number,
    vz: number,
    axis: RotationAxis = 'yaw',
    steps = 1,
  ): ActiveModule | null {
    const mod = this.getModuleAt(vx, vy, vz);
    if (!mod) return null;
    if (axis === 'pitch') {
      mod.pitchIdx = (((mod.pitchIdx || 0) + steps) % 4 + 4) % 4;
    } else if (axis === 'roll') {
      mod.rollIdx = (((mod.rollIdx || 0) + steps) % 4 + 4) % 4;
    } else {
      mod.yawIdx = (((mod.yawIdx || 0) + steps) % 4 + 4) % 4;
    }
    this.lastGhostSignature = '';
    this.rebuildVehicleGeometry();
    return mod;
  }

  /**
   * Rotates a selection of modules and/or voxels around any of the 3 axes (yaw, pitch, roll)!
   * - Single module: rotates its orientation on the requested axis.
   * - Multiple objects (voxels and/or modules): rotates their 3D voxel positions around the selection center AND rotates module orientations!
   */
  rotateSelectionGroupOnAxis(
    items: SelectableBuildObject[],
    axis: RotationAxis = 'yaw',
    steps = 1,
  ): SelectableBuildObject[] {
    if (items.length === 0) return [];
    const rotSteps = ((steps % 4) + 4) % 4;
    if (rotSteps === 0) return items;

    // Single module fast path
    if (items.length === 1 && items[0].kind === 'module') {
      const s = items[0];
      const mod = this.rotateModuleAt(s.vx, s.vy, s.vz, axis, rotSteps);
      if (!mod) return items;
      return [
        {
          ...s,
          yawIdx: mod.yawIdx,
          pitchIdx: mod.pitchIdx || 0,
          rollIdx: mod.rollIdx || 0,
        },
      ];
    }

    // Compute bounding box center of the selected items
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const it of items) {
      if (it.vx < minX) minX = it.vx;
      if (it.vx > maxX) maxX = it.vx;
      if (it.vy < minY) minY = it.vy;
      if (it.vy > maxY) maxY = it.vy;
      if (it.vz < minZ) minZ = it.vz;
      if (it.vz > maxZ) maxZ = it.vz;
    }
    const cx = Math.round((minX + maxX) * 0.5);
    const cy = Math.round((minY + maxY) * 0.5);
    const cz = Math.round((minZ + maxZ) * 0.5);

    // Snapshot & clear old voxels/modules in selection
    const snapVoxels: Array<{ vx: number; vy: number; vz: number; mat: number }> = [];
    const snapModules: Array<ActiveModule> = [];

    for (const it of items) {
      if (it.kind === 'voxel') {
        const m = this.getVoxel(it.vx, it.vy, it.vz) || it.mat || MAT.ALLOY_BLUE;
        if (m !== MAT.AIR) {
          snapVoxels.push({ vx: it.vx, vy: it.vy, vz: it.vz, mat: m });
          this.setVoxel(it.vx, it.vy, it.vz, MAT.AIR);
        }
      } else if (it.kind === 'module') {
        const mod = this.getModuleAt(it.vx, it.vy, it.vz);
        if (mod) {
          snapModules.push({ ...mod, config: mod.config ? { ...mod.config } : undefined });
          this.removeModuleAt(it.vx, it.vy, it.vz);
        }
      }
    }

    const nextSelection: SelectableBuildObject[] = [];

    for (const sv of snapVoxels) {
      const { x: rx, y: ry, z: rz } = rotatePoint3D90(
        sv.vx - cx,
        sv.vy - cy,
        sv.vz - cz,
        axis,
        rotSteps,
      );
      const nx = cx + rx;
      const ny = Math.max(1, cy + ry);
      const nz = cz + rz;
      if (this.inBounds(nx, ny, nz)) {
        this.setVoxel(nx, ny, nz, sv.mat);
        nextSelection.push({
          kind: 'voxel',
          vx: nx,
          vy: ny,
          vz: nz,
          mat: sv.mat,
        });
      }
    }

    for (const sm of snapModules) {
      const { x: rx, y: ry, z: rz } = rotatePoint3D90(
        sm.vx - cx,
        sm.vy - cy,
        sm.vz - cz,
        axis,
        rotSteps,
      );
      const nx = cx + rx;
      const ny = Math.max(1, cy + ry);
      const nz = cz + rz;
      const nextYaw =
        axis === 'yaw' ? ((sm.yawIdx || 0) + rotSteps) & 3 : sm.yawIdx || 0;
      const nextPitch =
        axis === 'pitch' ? ((sm.pitchIdx || 0) + rotSteps) & 3 : sm.pitchIdx || 0;
      const nextRoll =
        axis === 'roll' ? ((sm.rollIdx || 0) + rotSteps) & 3 : sm.rollIdx || 0;

      if (this.inBounds(nx, ny, nz)) {
        this.addModule(
          sm.kind,
          nx,
          ny,
          nz,
          nextYaw,
          sm.config,
          nextPitch,
          nextRoll,
        );
        nextSelection.push({
          kind: 'module',
          vx: nx,
          vy: ny,
          vz: nz,
          moduleKind: sm.kind,
          yawIdx: nextYaw,
          pitchIdx: nextPitch,
          rollIdx: nextRoll,
          config: sm.config ? { ...sm.config } : undefined,
        });
      }
    }

    this.lastGhostSignature = '';
    this.rebuildVehicleGeometry();
    return nextSelection;
  }

  /**
   * Translates (nudges) a single selected part/block or a multi-selection group of parts & blocks
   * by `(dx, dy, dz)` voxels while preserving all module orientations, custom configs, and voxel materials.
   */
  translateSelectionGroup(
    items: SelectableBuildObject[],
    dx: number,
    dy: number,
    dz: number,
  ): SelectableBuildObject[] {
    if (items.length === 0 || (dx === 0 && dy === 0 && dz === 0)) {
      return items;
    }

    // Verify every selected item stays inside valid grid bounds before moving
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const nx = it.vx + dx;
      const ny = it.vy + dy;
      const nz = it.vz + dz;
      if (ny < 1 || !this.inBounds(nx, ny, nz)) {
        return items;
      }
    }

    // Snapshot & clear old voxels/modules in selection
    const snapVoxels: Array<{ vx: number; vy: number; vz: number; mat: number }> = [];
    const snapModules: Array<ActiveModule> = [];

    for (const it of items) {
      if (it.kind === 'voxel') {
        const m = this.getVoxel(it.vx, it.vy, it.vz) || it.mat || MAT.ALLOY_BLUE;
        if (m !== MAT.AIR) {
          snapVoxels.push({ vx: it.vx, vy: it.vy, vz: it.vz, mat: m });
          this.setVoxel(it.vx, it.vy, it.vz, MAT.AIR);
        }
      } else if (it.kind === 'module') {
        const mod = this.getModuleAt(it.vx, it.vy, it.vz);
        if (mod) {
          snapModules.push({
            ...mod,
            config: mod.config ? { ...mod.config } : undefined,
          });
          this.removeModuleAt(it.vx, it.vy, it.vz);
        }
      }
    }

    const nextSelection: SelectableBuildObject[] = [];

    for (const sv of snapVoxels) {
      const nx = sv.vx + dx;
      const ny = sv.vy + dy;
      const nz = sv.vz + dz;
      if (this.inBounds(nx, ny, nz)) {
        this.setVoxel(nx, ny, nz, sv.mat);
        nextSelection.push({
          kind: 'voxel',
          vx: nx,
          vy: ny,
          vz: nz,
          mat: sv.mat,
        });
      }
    }

    for (const sm of snapModules) {
      const nx = sm.vx + dx;
      const ny = sm.vy + dy;
      const nz = sm.vz + dz;
      if (this.inBounds(nx, ny, nz)) {
        this.addModule(
          sm.kind,
          nx,
          ny,
          nz,
          sm.yawIdx || 0,
          sm.config,
          sm.pitchIdx || 0,
          sm.rollIdx || 0,
        );
        nextSelection.push({
          kind: 'module',
          vx: nx,
          vy: ny,
          vz: nz,
          moduleKind: sm.kind,
          yawIdx: sm.yawIdx || 0,
          pitchIdx: sm.pitchIdx || 0,
          rollIdx: sm.rollIdx || 0,
          config: sm.config ? { ...sm.config } : undefined,
        });
      }
    }

    this.lastGhostSignature = '';
    this.rebuildVehicleGeometry();
    return nextSelection;
  }

  /**
   * Rotates the entire vehicle / studio sculpture 90° around the requested axis ('yaw', 'pitch', 'roll')!
   */
  rotateEntireVehicle90(axis: RotationAxis = 'yaw', steps = 1): void {
    const all = this.getAllSelectableBuildObjects();
    if (all.length === 0) return;
    this.rotateSelectionGroupOnAxis(all, axis, steps);
  }

  duplicateModuleAt(vx: number, vy: number, vz: number): ActiveModule | null {
    const mod = this.getModuleAt(vx, vy, vz);
    if (!mod) return null;
    const candidateOffsets: Array<[number, number, number]> = [
      [2, 0, 0],
      [-2, 0, 0],
      [0, 0, 2],
      [0, 0, -2],
      [0, 2, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [3, 0, 0],
      [-3, 0, 0],
      [0, 0, 3],
      [0, 0, -3],
    ];
    for (const [dx, dy, dz] of candidateOffsets) {
      const nx = vx + dx;
      const ny = vy + dy;
      const nz = vz + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      if (!this.getModuleAt(nx, ny, nz)) {
        const clonedConfig = mod.config ? { ...mod.config } : undefined;
        this.addModule(
          mod.kind,
          nx,
          ny,
          nz,
          mod.yawIdx || 0,
          clonedConfig,
          mod.pitchIdx || 0,
          mod.rollIdx || 0,
        );
        this.rebuildVehicleGeometry();
        return this.getModuleAt(nx, ny, nz);
      }
    }
    return null;
  }

  duplicateVoxelAt(
    vx: number,
    vy: number,
    vz: number,
  ): { vx: number; vy: number; vz: number; mat: number } | null {
    const mat = this.getVoxel(vx, vy, vz);
    if (mat === MAT.AIR) return null;
    const candidateOffsets: Array<[number, number, number]> = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, -1, 0],
    ];
    for (const [dx, dy, dz] of candidateOffsets) {
      const nx = vx + dx;
      const ny = vy + dy;
      const nz = vz + dz;
      if (this.inBounds(nx, ny, nz) && this.getVoxel(nx, ny, nz) === MAT.AIR) {
        this.setVoxel(nx, ny, nz, mat);
        this.rebuildVehicleGeometry();
        return { vx: nx, vy: ny, vz: nz, mat };
      }
    }
    return null;
  }

  getAllSelectableBuildObjects(): SelectableBuildObject[] {
    const list: SelectableBuildObject[] = [];
    const modAnchorSet = new Set<number>();
    for (const m of this.modules) {
      modAnchorSet.add(packVoxelKey(m.vx, m.vy, m.vz));
      list.push({
        kind: 'module',
        vx: m.vx,
        vy: m.vy,
        vz: m.vz,
        moduleKind: m.kind,
        yawIdx: m.yawIdx,
        pitchIdx: m.pitchIdx || 0,
        rollIdx: m.rollIdx || 0,
        config: m.config ? { ...m.config } : undefined,
      });
    }
    this.voxelMap.forEach((mat, key) => {
      const [vx, vy, vz] = parseVoxelCoords(key);
      const packed = typeof key === 'number' ? key : packVoxelKey(vx, vy, vz);
      if (mat !== MAT.AIR && !modAnchorSet.has(packed)) {
        list.push({
          kind: 'voxel',
          vx,
          vy,
          vz,
          mat,
        });
      }
    });
    return list;
  }

  duplicateSelectionGroup(
    items: SelectableBuildObject[],
  ): SelectableBuildObject[] {
    if (items.length === 0) return [];
    if (items.length === 1) {
      const single = items[0];
      if (single.kind === 'module') {
        const cloned = this.duplicateModuleAt(single.vx, single.vy, single.vz);
        if (!cloned) return [];
        return [
          {
            kind: 'module',
            vx: cloned.vx,
            vy: cloned.vy,
            vz: cloned.vz,
            moduleKind: cloned.kind,
            yawIdx: cloned.yawIdx,
            pitchIdx: cloned.pitchIdx || 0,
            rollIdx: cloned.rollIdx || 0,
            config: cloned.config ? { ...cloned.config } : undefined,
          },
        ];
      } else {
        const clonedVox = this.duplicateVoxelAt(
          single.vx,
          single.vy,
          single.vz,
        );
        if (!clonedVox) return [];
        return [
          {
            kind: 'voxel',
            vx: clonedVox.vx,
            vy: clonedVox.vy,
            vz: clonedVox.vz,
            mat: clonedVox.mat,
          },
        ];
      }
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const it of items) {
      if (it.vx < minX) minX = it.vx;
      if (it.vx > maxX) maxX = it.vx;
      if (it.vy < minY) minY = it.vy;
      if (it.vy > maxY) maxY = it.vy;
      if (it.vz < minZ) minZ = it.vz;
      if (it.vz > maxZ) maxZ = it.vz;
    }
    const spanX = Math.max(1, maxX - minX + 1);
    const spanY = Math.max(1, maxY - minY + 1);
    const spanZ = Math.max(1, maxZ - minZ + 1);

    const groupOffsets: Array<[number, number, number]> = [
      [0, spanY, 0],
      [spanX, 0, 0],
      [-spanX, 0, 0],
      [0, 0, spanZ],
      [0, 0, -spanZ],
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    let chosenOffset: [number, number, number] = [0, spanY, 0];
    for (const [dx, dy, dz] of groupOffsets) {
      const hasOpenTarget = items.some((it) => {
        const nx = it.vx + dx;
        const ny = it.vy + dy;
        const nz = it.vz + dz;
        if (!this.inBounds(nx, ny, nz)) return false;
        if (it.kind === 'module') {
          return !this.getModuleAt(nx, ny, nz);
        }
        return this.getVoxel(nx, ny, nz) === MAT.AIR;
      });
      if (hasOpenTarget) {
        chosenOffset = [dx, dy, dz];
        break;
      }
    }

    const [dx, dy, dz] = chosenOffset;
    const duplicated: SelectableBuildObject[] = [];
    for (const it of items) {
      const nx = it.vx + dx;
      const ny = it.vy + dy;
      const nz = it.vz + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      if (it.kind === 'module' && it.moduleKind) {
        if (!this.getModuleAt(nx, ny, nz)) {
          const liveMod = this.getModuleAt(it.vx, it.vy, it.vz);
          const cfg = liveMod?.config
            ? { ...liveMod.config }
            : it.config
              ? { ...it.config }
              : undefined;
          const yaw = liveMod ? liveMod.yawIdx || 0 : it.yawIdx || 0;
          const pitch = liveMod ? liveMod.pitchIdx || 0 : it.pitchIdx || 0;
          const roll = liveMod ? liveMod.rollIdx || 0 : it.rollIdx || 0;
          this.addModule(it.moduleKind, nx, ny, nz, yaw, cfg, pitch, roll);
          duplicated.push({
            kind: 'module',
            vx: nx,
            vy: ny,
            vz: nz,
            moduleKind: it.moduleKind,
            yawIdx: yaw,
            pitchIdx: pitch,
            rollIdx: roll,
            config: cfg,
          });
        }
      } else if (it.kind === 'voxel') {
        const mat = this.getVoxel(it.vx, it.vy, it.vz) || it.mat || MAT.ALLOY_BLUE;
        if (mat !== MAT.AIR && this.getVoxel(nx, ny, nz) === MAT.AIR) {
          this.setVoxel(nx, ny, nz, mat);
          duplicated.push({
            kind: 'voxel',
            vx: nx,
            vy: ny,
            vz: nz,
            mat,
          });
        }
      }
    }

    if (duplicated.length > 0) {
      this.rebuildVehicleGeometry();
    }
    return duplicated;
  }

  updateModuleConfig(
    vx: number,
    vy: number,
    vz: number,
    patch: Partial<ModuleTuningConfig>,
  ): ActiveModule | null {
    const mod = this.modules.find(
      (m) => m.vx === vx && m.vy === vy && m.vz === vz,
    );
    if (!mod) return null;
    mod.config = { ...(mod.config || {}), ...patch };
    return mod;
  }

  setKindDefaultConfig(
    kind: ModuleKind,
    patch: Partial<ModuleTuningConfig>,
  ): ModuleTuningConfig {
    const defaultCfg = BUILD_SLOTS.find((s) => s.kind === kind)?.defaultConfig;
    const prev = this.customKindConfig.get(kind) || defaultCfg || {};
    const merged: ModuleTuningConfig = { ...prev, ...patch };
    this.customKindConfig.set(kind, merged);
    return merged;
  }

  updateModuleConfigByKind(
    kind: ModuleKind,
    patch: Partial<ModuleTuningConfig>,
  ): number {
    this.setKindDefaultConfig(kind, patch);
    let updated = 0;
    for (const m of this.modules) {
      if (m.kind === kind) {
        m.config = { ...(m.config || {}), ...patch };
        updated++;
      }
    }
    return updated;
  }

  getEffectiveConfigForKind(kind: ModuleKind): ModuleTuningConfig {
    const override = this.customKindConfig.get(kind);
    const defaultCfg = BUILD_SLOTS.find((s) => s.kind === kind)?.defaultConfig;
    return {
      ...(defaultCfg ? { ...defaultCfg } : {}),
      ...(override ? { ...override } : {}),
    };
  }

  /**
   * Serializes the entire unbounded vehicle (all blocks & modules) to a JSON-friendly blueprint object!
   */
  exportBlueprint(name: string): SerializedVehicleBlueprint {
    const voxels: Array<[number, number, number, number]> = [];
    this.voxelMap.forEach((mat, key) => {
      if (mat !== MAT.AIR) {
        const [vx, vy, vz] = parseVoxelCoords(key);
        voxels.push([vx, vy, vz, mat]);
      }
    });
    const modules = this.modules.map((m) => ({
      kind: m.kind,
      vx: m.vx,
      vy: m.vy,
      vz: m.vz,
      yawIdx: m.yawIdx,
      pitchIdx: m.pitchIdx || 0,
      rollIdx: m.rollIdx || 0,
      config: m.config ? { ...m.config } : undefined,
    }));
    return {
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || 'Custom Voxel Rig',
      createdAt: new Date().toLocaleDateString(),
      massKg: Math.round(this.totalMass),
      blockCount: this.voxelCount + this.modules.length,
      powerCores: this.powerCores,
      voxels,
      modules,
      ecuPrograms: Object.keys(this.ecuPrograms).length > 0 ? JSON.parse(JSON.stringify(this.ecuPrograms)) : undefined,
    };
  }

  /**
   * Exports the current studio voxel structure as a normalized VoxelObjectPrefab
   * ready to be stamped anywhere in the world!
   */
  exportAsObjectPrefab(customName: string): VoxelObjectPrefab {
    const raw: Array<[number, number, number, number]> = [];
    this.voxelMap.forEach((mat, key) => {
      if (mat !== MAT.AIR) {
        const [vx, vy, vz] = parseVoxelCoords(key);
        raw.push([vx, vy, vz, mat]);
      }
    });
    const norm = normalizeVoxelObjectToOrigin(raw);
    return {
      id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: customName.trim() || 'Custom Voxel Object',
      category: 'CUSTOM',
      tag: `Custom Object · ${norm.length} blocks`,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      blockCount: norm.length,
      ...computePrefabDimensions(norm),
      voxels: norm,
    };
  }

  exportAsPlaceableObjectPrefab(
    customName: string,
    _category: 'STUNT' | 'BUILDING' | 'HAZARD' | 'CUSTOM' = 'CUSTOM',
  ): VoxelObjectPrefab {
    return this.exportAsObjectPrefab(customName);
  }

  initObjectStudioPedestal(): void {
    this.undoStack = [];
    this.clearAll();
    this.customBlueprintName = 'Object Studio Canvas';
    this.fillBox(10, 5, 16, 14, 5, 20, MAT.CONCRETE);
    this.setVoxel(12, 6, 18, MAT.BRICK);
    this.rebuildVehicleGeometry();
    this.saveIntactSnapshot();
    this.syncVisualTransform();
  }

  /**
   * Loads a VoxelObjectPrefab onto the hovering builder grid for editing in the Object Studio!
   */
  loadObjectPrefabIntoStudio(prefab: VoxelObjectPrefab): void {
    this.undoStack = [];
    this.clearAll();
    this.customBlueprintName = prefab.name;
    for (const [dx, dy, dz, mat] of prefab.voxels) {
      this.setVoxel(12 + dx, 5 + dy, 18 + dz, mat);
    }
    if (this.voxelMap.size === 0) {
      this.setVoxel(12, 5, 18, MAT.BRICK);
    }
    this.rebuildVehicleGeometry();
    this.saveIntactSnapshot();
    this.syncVisualTransform();
  }

  loadPlaceableObjectPrefabIntoStudio(prefab: VoxelObjectPrefab): void {
    this.loadObjectPrefabIntoStudio(prefab);
  }

  loadPropTemplate(template: 'BLANK' | 'CRATE' | 'CONE' | 'RAMP' | 'BARRIER' | 'BARREL'): void {
    this.undoStack = [];
    this.clearAll();
    const cx = 12;
    const cy = 5;
    const cz = 18;
    if (template === 'CRATE') {
      this.customBlueprintName = 'Wooden Crate Prop';
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = -2; dx <= 1; dx++) {
          for (let dz = -2; dz <= 1; dz++) {
            const isX = dx === -2 || dx === 1;
            const isY = dy === 0 || dy === 3;
            const isZ = dz === -2 || dz === 1;
            if (!isX && !isY && !isZ) continue;
            const edgeCount = (isX ? 1 : 0) + (isY ? 1 : 0) + (isZ ? 1 : 0);
            this.setVoxel(cx + dx, cy + dy, cz + dz, edgeCount >= 2 ? MAT.DIRT : MAT.WOOD);
          }
        }
      }
    } else if (template === 'CONE') {
      this.customBlueprintName = 'Traffic Cone Prop';
      for (let dx = -2; dx <= 1; dx++) {
        for (let dz = -2; dz <= 1; dz++) {
          const isCorner = (dx === -2 || dx === 1) && (dz === -2 || dz === 1);
          this.setVoxel(cx + dx, cy, cz + dz, isCorner ? MAT.ASPHALT : MAT.RAMP_ORANGE);
        }
      }
      for (let dy = 1; dy <= 4; dy++) {
        const mat = dy === 2 ? MAT.PAINT_WHITE : MAT.RAMP_ORANGE;
        for (let dx = -1; dx <= 0; dx++) {
          for (let dz = -1; dz <= 0; dz++) {
            if (dy === 4 && !(dx === 0 && dz === 0)) continue;
            this.setVoxel(cx + dx, cy + dy, cz + dz, mat);
          }
        }
      }
    } else if (template === 'RAMP') {
      this.customBlueprintName = 'Kicker Ramp Prop';
      for (let s = 0; s < 8; s++) {
        const h = Math.floor(s / 2);
        for (let x = -3; x <= 3; x++) {
          for (let y = 0; y <= h; y++) {
            this.setVoxel(cx + x, cy + y, cz - 4 + s, y === h ? MAT.RAMP_ORANGE : MAT.STEEL);
          }
        }
      }
    } else if (template === 'BARRIER') {
      this.customBlueprintName = 'Jersey Barrier Prop';
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = -3; dx <= 2; dx++) {
          const zMin = dy === 0 ? -1 : 0;
          const zMax = dy === 0 ? 1 : 0;
          for (let dz = zMin; dz <= zMax; dz++) {
            const isReflector = dy === 2 && (dx === -3 || dx === 2 || dx === 0);
            const isStripe = dy === 1 && (dx === -3 || dx === 2);
            this.setVoxel(cx + dx, cy + dy, cz + dz, isReflector ? MAT.ROAD_LINE : isStripe ? MAT.RAMP_ORANGE : MAT.CONCRETE);
          }
        }
      }
    } else if (template === 'BARREL') {
      this.customBlueprintName = 'Explosive C4 Barrel Prop';
      for (let dy = 0; dy < 5; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const isRim = dy === 0 || dy === 4;
            const isYellowBand = dy === 2;
            const mat = isRim ? MAT.STEEL : isYellowBand ? MAT.FLOAT_YELLOW : MAT.C4_EXPLOSIVE;
            this.setVoxel(cx + dx, cy + dy, cz + dz, mat);
          }
        }
      }
    } else {
      // BLANK
      this.customBlueprintName = 'Custom Prop';
      this.fillBox(cx - 2, cy - 1, cz - 2, cx + 2, cy - 1, cz + 2, MAT.CONCRETE);
      this.setVoxel(cx, cy, cz, MAT.BRICK);
    }
    this.rebuildVehicleGeometry();
    this.saveIntactSnapshot();
    this.syncVisualTransform();
  }

  saveIntactSnapshot(): void {
    this.intactBlueprintSnapshot = this.exportBlueprint(
      this.customBlueprintName || 'Intact Rig',
    );
  }

  /**
   * Pushes the current vehicle rig state onto the Build Mode Undo History Stack!
   */
  pushUndoSnapshot(): void {
    const snap = this.exportBlueprint(this.customBlueprintName || 'Undo Step');
    this.undoStack.push(snap);
    if (this.undoStack.length > ModularVehicleRig.MAX_UNDO_HISTORY) {
      this.undoStack.shift();
    }
  }

  /**
   * Reverts the last voxel placement, removal, or paint operation in Build Mode!
   */
  undoBuildStep(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.importBlueprint(prev, true);
    return true;
  }

  /**
   * Paints all structural/paintable blocks on the vehicle (or currently selected blocks if any)
   * with the chosen material while preserving buoyant pontoons and C4 blocks.
   */
  paintAllChassisVoxels(
    targetMat: number,
    selectedVoxels?: SelectableBuildObject[],
  ): number {
    if (this.voxelMap.size === 0) return 0;
    this.pushUndoSnapshot();
    let count = 0;

    if (selectedVoxels && selectedVoxels.length > 0) {
      for (const item of selectedVoxels) {
        if (item.kind === 'voxel') {
          const cur = this.getVoxel(item.vx, item.vy, item.vz);
          if (cur !== MAT.AIR) {
            this.setVoxel(item.vx, item.vy, item.vz, targetMat);
            count++;
          }
        }
      }
    } else {
      const keys = Array.from(this.voxelMap.keys());
      for (const k of keys) {
        const cur = this.voxelMap.get(k) || MAT.AIR;
        if (
          cur === MAT.AIR ||
          cur === MAT.FLOAT_YELLOW ||
          cur === MAT.C4_EXPLOSIVE
        ) {
          continue;
        }
        if (cur === MAT.GLASS_SOLID && targetMat !== MAT.GLASS_SOLID && targetMat !== MAT.GLOW_CRYSTAL) {
          continue;
        }
        const [vx, vy, vz] = parseVoxelCoords(k);
        this.setVoxel(vx, vy, vz, targetMat);
        count++;
      }
    }

    if (count > 0) {
      this.rebuildVehicleGeometry();
      this.saveIntactSnapshot();
      SoundFX.snap();
    }
    return count;
  }

  /**
   * Applies a multi-tone Vehicle Skin theme across the entire chassis (Primary Hull, Secondary Trim,
   * Accent Racing Stripes/Edges, and Canopy Glass), with full Undo support.
   */
  applyVehicleSkin(skinId: VehicleSkinId): number {
    const spec = VEHICLE_SKINS.find((s) => s.id === skinId);
    if (!spec || this.voxelMap.size === 0) return 0;
    this.pushUndoSnapshot();
    this.recomputeActiveBounds();

    let painted = 0;
    const keys = Array.from(this.voxelMap.keys());
    for (const k of keys) {
      const cur = this.voxelMap.get(k) || MAT.AIR;
      if (
        cur === MAT.AIR ||
        cur === MAT.FLOAT_YELLOW ||
        cur === MAT.C4_EXPLOSIVE
      ) {
        continue;
      }
      const [vx, vy, vz] = parseVoxelCoords(k);
      if (cur === MAT.GLASS_SOLID || cur === MAT.GLOW_CRYSTAL) {
        this.setVoxel(
          vx,
          vy,
          vz,
          skinId === 'CYBERPUNK_NEON' ? MAT.GLOW_CRYSTAL : MAT.GLASS_SOLID,
        );
        painted++;
        continue;
      }

      const isCenterStripe =
        vy >= this.maxVY - 1 && Math.abs(vx - SYMMETRY_CENTER_X) <= 1.1;
      const isOuterTrim =
        (vx === this.minVX || vx === this.maxVX) && vy === this.minVY + 1;
      const isBumperEdge = vz === this.maxVZ || vz === this.minVZ;
      const isUnderbody = vy <= this.minVY;

      let nextMat = spec.primaryMat;
      if (isCenterStripe || isOuterTrim) {
        nextMat = spec.accentMat;
      } else if (isBumperEdge || isUnderbody) {
        nextMat = spec.secondaryMat;
      }

      this.setVoxel(vx, vy, vz, nextMat);
      painted++;
    }

    if (painted > 0) {
      this.rebuildVehicleGeometry();
      this.saveIntactSnapshot();
      SoundFX.snap();
    }
    return painted;
  }

  /**
   * Loads a serialized vehicle blueprint of any size into the rig!
   */
  importBlueprint(bp: SerializedVehicleBlueprint, preserveUndoStack = false): void {
    if (
      !bp ||
      typeof bp !== 'object' ||
      !Array.isArray(bp.voxels) ||
      !Array.isArray(bp.modules)
    ) {
      console.warn('[Vehicle] Rejected invalid blueprint payload');
      return;
    }
    const validVoxels = bp.voxels.filter(
      (v): v is [number, number, number, number] =>
        Array.isArray(v) &&
        v.length >= 4 &&
        typeof v[0] === 'number' &&
        Number.isFinite(v[0]) &&
        typeof v[1] === 'number' &&
        Number.isFinite(v[1]) &&
        typeof v[2] === 'number' &&
        Number.isFinite(v[2]) &&
        typeof v[3] === 'number' &&
        Number.isFinite(v[3]),
    );
    const validModules = bp.modules.filter(
      (m) =>
        Boolean(m) &&
        typeof m === 'object' &&
        typeof m.kind === 'string' &&
        typeof m.vx === 'number' &&
        Number.isFinite(m.vx) &&
        typeof m.vy === 'number' &&
        Number.isFinite(m.vy) &&
        typeof m.vz === 'number' &&
        Number.isFinite(m.vz),
    );
    const savedUndo = preserveUndoStack ? [...this.undoStack] : [];
    this.clearAll();
    this.undoStack = savedUndo;
    this.customBlueprintName = typeof bp.name === 'string' ? bp.name : 'Imported Rig';
    for (const [vx, vy, vz, mat] of validVoxels) {
      this.setVoxel(vx, vy, vz, mat);
    }
    for (const mod of validModules) {
      this.addModule(
        mod.kind,
        mod.vx,
        mod.vy,
        mod.vz,
        mod.yawIdx || 0,
        mod.config,
        mod.pitchIdx || 0,
        mod.rollIdx || 0,
      );
    }
    if (this.voxelMap.size === 0 && this.modules.length === 0) {
      this.setVoxel(12, 6, 18, MAT.ALLOY_BLUE);
    }
    if (bp.ecuPrograms) {
      this.ecuPrograms = JSON.parse(JSON.stringify(bp.ecuPrograms));
    } else {
      this.ecuPrograms = {};
    }
    this.computeHardwarePorts();
    this.rebuildVehicleGeometry();
    if (this.driverPeerId) {
      this.claimSeat(0, this.driverPeerId);
    }
    this.saveIntactSnapshot();
    this.syncVisualTransform();
  }

  loadPreset(idx: number): void {
    const numPresets = Math.max(1, VEHICLE_PRESETS.length);
    this.presetIndex = ((idx % numPresets) + numPresets) % numPresets;
    registerVehicleTuningPreset(this.vehicleId, this.presetIndex);
    const tuning = getVehicleTuningProfile(this.presetIndex);
    this.rigidBody.linearDamping = tuning.linearDamping;
    this.rigidBody.angularDamping = tuning.angularDamping;
    this.customBlueprintName = null;
    this.undoStack = [];
    const prevDriver = this.driverPeerId;
    this.clearAll();

    const preset = VEHICLE_PRESETS[this.presetIndex];
    if (preset) {
      for (const box of preset.boxes) {
        this.fillBox(box.x1, box.y1, box.z1, box.x2, box.y2, box.z2, box.mat);
      }
      for (const m of preset.modules) {
        this.addModule(m.kind, m.vx, m.vy, m.vz, m.yaw ?? 0, undefined, m.pitch ?? 0, m.roll ?? 0);
      }
    }

    this.intactBlueprintSnapshot = null;
    this.rebuildVehicleGeometry();
    if (prevDriver) {
      this.claimSeat(0, prevDriver);
    }
    this.saveIntactSnapshot();
  }

  public get propellerMeshes(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    for (const mod of this.modules) {
      if (mod.mesh) {
        const hub = mod.mesh.userData.propellerHub as THREE.Object3D | undefined;
        if (hub) {
          list.push(hub);
        } else if (
          mod.spinMesh &&
          (mod.kind === 'BOAT_PROP' ||
            mod.kind === 'BOAT_OUTBOARD' ||
            mod.kind === 'PROP_AERO' ||
            mod.kind === 'VTOL_ROTOR')
        ) {
          list.push(mod.spinMesh);
        }
      }
    }
    return list;
  }

  /**
   * Continuous dynamic animations:
   * 1. Propeller spinning proportional to throttle / forward motion
   * 2. Thruster flame / nozzle scaling along thrust axis during Shift boost
   */
  updateVehicleVisuals(dt: number, throttle = 0, isBoosting = false): void {
    dt = Math.min(0.05, Math.max(0.001, dt));

    // 1. Continuous Propeller Spin
    const absThrottle = Math.abs(throttle);
    const fwdVelocity = this.velocity.dot(_forward);
    const speedSpin = Math.abs(fwdVelocity) * 2.5;
    const baseThrottleSpin = absThrottle > 0.05 ? Math.sign(throttle) * 28.0 : 0;
    const idleSpin = 3.5;
    const spinRate = (baseThrottleSpin + Math.sign(fwdVelocity || 1) * speedSpin + idleSpin) * dt;

    const props = this.propellerMeshes;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p.parent?.name.includes('VTOL') || p.name.includes('Rotor')) {
        p.rotation.y += spinRate * 1.5;
      } else {
        p.rotation.z += spinRate;
      }
    }

    // 2. Dynamic Thruster Scaling on [Shift] Boost
    for (let i = 0; i < this.modules.length; i++) {
      const mod = this.modules[i];
      if (!mod.mesh) continue;
      const flame = (mod.mesh.userData.flameCore || mod.mesh.children[0]?.userData?.flameCore) as THREE.Mesh | undefined;
      if (flame) {
        const targetLen = isBoosting ? 2.4 : absThrottle > 0.1 ? 1.0 : 0.45;
        const targetThick = isBoosting ? 1.35 : absThrottle > 0.1 ? 0.9 : 0.55;
        const jitter = isBoosting ? (Math.random() - 0.5) * 0.18 : 0;
        flame.scale.y = THREE.MathUtils.lerp(flame.scale.y, targetLen + jitter, Math.min(1.0, 16.0 * dt));
        flame.scale.x = THREE.MathUtils.lerp(flame.scale.x, targetThick, Math.min(1.0, 16.0 * dt));
        flame.scale.z = THREE.MathUtils.lerp(flame.scale.z, targetThick, Math.min(1.0, 16.0 * dt));
      }
    }
  }

  createModuleMesh(mod: ActiveModule, isGhost = false): THREE.Group {
    const g = createDetailedModuleMesh(mod, isGhost);
    const isCharred = !isGhost && (mod.health ?? 1.0) < 0.5;
    g.userData.isCharred = isCharred;
    g.userData.kind = mod.kind;

    if (mod.kind === 'HEADLIGHT' && !isGhost) {
      // Volumetric translucent light beam cone extending forward from the headlight (uses shared singleton geo & mat)
      const beamMesh = new THREE.Mesh(_sharedHeadlightBeamGeo, _sharedHeadlightBeamMat);
      beamMesh.visible = this.headlightsOn;
      g.add(beamMesh);
      this.headlightBeamMeshes.push(beamMesh);
    }

    // Apply all 3 rotation axes: Y (Yaw), X (Pitch), Z (Roll)
    g.rotation.order = 'YXZ';
    g.rotation.set(
      ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
      ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
      ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
    );
    g.position.set(
      (mod.vx + 0.5) * VOXEL_SIZE,
      (mod.vy + 0.5) * VOXEL_SIZE,
      (mod.vz + 0.5) * VOXEL_SIZE,
    );
    if (!isGhost) {
      mod.mesh = g;
      const mode: ActiveShaderMode = this.useCartoonShader
        ? 'CARTOON'
        : this.usePotatoShader
          ? 'POTATO'
          : 'PBR';
      if (mode !== 'PBR') {
        this.applyShaderModeToModuleGroup(g, mode);
      }
    }
    return g;
  }

  private applyShaderModeToModuleGroup(
    group: THREE.Object3D,
    mode: ActiveShaderMode,
  ): void {
    const outlineMat = getSharedVehicleOutlineMaterial();
    const toAttachOutline: THREE.Mesh[] = [];

    group.traverse((ch) => {
      if (!(ch instanceof THREE.Mesh)) return;
      if (ch.userData?.isCartoonOutlineMesh) {
        ch.visible = mode === 'CARTOON';
        return;
      }
      applyMeshMaterialPresetSwap(ch, mode);

      const curMat = ch.material as THREE.Material & {
        transparent?: boolean;
        wireframe?: boolean;
        opacity?: number;
      };
      const isOpaqueSolid =
        curMat &&
        !curMat.transparent &&
        !curMat.wireframe &&
        (curMat.opacity === undefined || curMat.opacity >= 0.98);

      if (isOpaqueSolid) {
        const existingOutline = ch.userData.cartoonOutlineChild as THREE.Mesh | undefined;
        if (existingOutline) {
          if (mode === 'CARTOON') {
            const smoothGeo = getSmoothedOutlineGeometry(ch.geometry);
            if (existingOutline.geometry !== smoothGeo) {
              existingOutline.geometry = smoothGeo;
            }
          }
          existingOutline.visible = mode === 'CARTOON';
        } else if (mode === 'CARTOON') {
          toAttachOutline.push(ch);
        }
      }
    });

    for (const mesh of toAttachOutline) {
      const outlineChild = new THREE.Mesh(
        getSmoothedOutlineGeometry(mesh.geometry),
        outlineMat,
      );
      outlineChild.userData.isCartoonOutlineMesh = true;
      outlineChild.userData.isSharedPrimitive = true;
      outlineChild.frustumCulled = false;
      outlineChild.castShadow = false;
      outlineChild.receiveShadow = false;
      mesh.userData.cartoonOutlineChild = outlineChild;
      mesh.add(outlineChild);
    }
  }

  private syncChassisOutlineMesh(forceRefresh = false): void {
    if (!this.chassisMesh || !this.chassisMesh.visible) {
      if (this.chassisOutlineMesh) {
        this.chassisOutlineMesh.visible = false;
      }
      return;
    }
    if (!this.useCartoonShader) {
      if (this.chassisOutlineMesh) {
        this.chassisOutlineMesh.visible = false;
      }
      if (forceRefresh) {
        this.chassisOutlineNeedsRefresh = true;
      }
      return;
    }
    const shouldForce = forceRefresh || this.chassisOutlineNeedsRefresh;
    this.chassisOutlineNeedsRefresh = false;
    const smoothGeo = getSmoothedOutlineGeometry(this.chassisMesh.geometry, shouldForce);
    smoothGeo.setDrawRange(
      this.chassisMesh.geometry.drawRange.start,
      this.chassisMesh.geometry.drawRange.count,
    );
    if (!this.chassisOutlineMesh) {
      this.chassisOutlineMesh = new THREE.Mesh(
        smoothGeo,
        getSharedVehicleOutlineMaterial(),
      );
      this.chassisOutlineMesh.userData.isCartoonOutlineMesh = true;
      this.chassisOutlineMesh.frustumCulled = false;
      this.chassisOutlineMesh.castShadow = false;
      this.chassisOutlineMesh.receiveShadow = false;
      this.chassisOutlineMesh.matrixAutoUpdate = false;
      this.chassisOutlineMesh.updateMatrix();
      this.rootGroup.add(this.chassisOutlineMesh);
    } else if (this.chassisOutlineMesh.geometry !== smoothGeo) {
      this.chassisOutlineMesh.geometry = smoothGeo;
    }
    this.chassisOutlineMesh.visible = this.useCartoonShader && this.chassisMesh.visible;
  }

  /**
   * Swaps vehicle chassis and all attached module meshes between standard PBR/Lambert
   * materials (`usePBR`), Potato cel+rim shader (`usePotatoShader`), and Cartoon Mode
   * shader + GPU vehicle silhouette outline (`useCartoonShader`).
   */
  public setPotatoShaderMode(enabled: boolean): void {
    this.usePotatoShader = enabled;
    if (enabled) this.useCartoonShader = false;
    const mode: ActiveShaderMode = this.useCartoonShader
      ? 'CARTOON'
      : this.usePotatoShader
        ? 'POTATO'
        : 'PBR';
    if (this.chassisMesh) {
      applyMeshMaterialPresetSwap(
        this.chassisMesh,
        mode,
        this.world.sharedVoxelMaterial,
      );
    }
    this.syncChassisOutlineMesh(false);
    this.applyShaderModeToModuleGroup(this.modulesGroup, mode);
  }

  public setCartoonShaderMode(enabled: boolean): void {
    this.useCartoonShader = enabled;
    if (enabled) this.usePotatoShader = false;
    const mode: ActiveShaderMode = this.useCartoonShader
      ? 'CARTOON'
      : this.usePotatoShader
        ? 'POTATO'
        : 'PBR';
    if (this.chassisMesh) {
      applyMeshMaterialPresetSwap(
        this.chassisMesh,
        mode,
        this.world.sharedVoxelMaterial,
      );
    }
    this.syncChassisOutlineMesh(false);
    this.applyShaderModeToModuleGroup(this.modulesGroup, mode);
  }

  public setBlobShadowVisible(visible: boolean): void {
    this.blobShadowsEnabled = visible;
    if (this.contactShadowMesh) {
      this.contactShadowMesh.visible = visible && !this.inBuildMode;
    }
  }


  rebuildVehicleGeometry(deferPhysicsHull = false): void {
    this.recomputeActiveBounds();

    // Trailmakers/Stormworks Build Mode Disconnection Preview:
    // Whenever geometry is rebuilt in Build Mode, recompute connectivity from scratch and tint disconnected voxels red!
    if (this.inBuildMode && this.voxelMap.size > 0) {
      previewBuildModeDisconnections(this);
    }

    const needHullRebuild =
      this.hullDirty ||
      (!this.chassisMesh && !this.chassisTransMesh && this.voxelMap.size > 0);

    if (needHullRebuild) {
      this.hullDirty = false;

      if (this.voxelMap.size === 0) {
        if (this.chassisMesh) this.chassisMesh.visible = false;
        if (this.chassisOutlineMesh) this.chassisOutlineMesh.visible = false;
        if (this.chassisTransMesh) this.chassisTransMesh.visible = false;
        this.rawFaces = 0;
        this.mergedQuads = 0;
      } else {
        const spanX = Math.max(1, this.maxVX - this.minVX + 1);
        const spanY = Math.max(1, this.maxVY - this.minVY + 1);
        const spanZ = Math.max(1, this.maxVZ - this.minVZ + 1);

        const sampleCell = (lx: number, ly: number, lz: number) => {
          const vx = this.minVX + lx;
          const vy = this.minVY + ly;
          const vz = this.minVZ + lz;
          const mat = this.getVoxel(vx, vy, vz);
          if (mat === MAT.AIR) return MAT.AIR;
          const vKey = packVoxelKey(vx, vy, vz);
          if (this.ignitedC4Voxels.has(vKey)) {
            return IGNITED_C4_RENDER_COLOR_CODE;
          }
          if (this.fallingOffVoxels.has(vKey)) {
            return FALLING_OFF_RENDER_COLOR_CODE;
          }
          const hp = this.voxelHealthMap.get(vKey) ?? 1.0;
          // Bit 64 signals <50% health to greedyMeshBoundedArrays for charred darkening!
          return hp < 0.5 ? mat | 64 : mat;
        };

        // Prune completed Build Mode pop-in timestamps (> 0.35s old) so steady-state vehicles have zero overhead
        const nowSec = typeof performance !== 'undefined' ? performance.now() * 0.001 : 0;
        if (this.voxelSpawnTimes.size > 0) {
          this.voxelSpawnTimes.forEach((spawnT, key) => {
            if (nowSec - spawnT > 0.35) {
              this.voxelSpawnTimes.delete(key);
            }
          });
        }

        const sampleVoxelHp = (lx: number, ly: number, lz: number): number => {
          const vKey = packVoxelKey(this.minVX + lx, this.minVY + ly, this.minVZ + lz);
          return this.voxelHealthMap.get(vKey) ?? 1.0;
        };
        const sampleVoxelSpawnTime =
          this.voxelSpawnTimes.size > 0
            ? (lx: number, ly: number, lz: number): number => {
                const vKey = packVoxelKey(this.minVX + lx, this.minVY + ly, this.minVZ + lz);
                return this.voxelSpawnTimes.get(vKey) ?? 0;
              }
            : undefined;

        // #1 & #7 — Use zero-allocation subarray views and update chassis BufferGeometry in-place
        // Item 5: perVoxelDetail enables crisp per-voxel ±5% color jitter, baked AO, <50% HP red tint + 1.05x scale-up, and Build Mode pop-in!
        const res = greedyMeshBoundedArrays(
          spanX,
          spanY,
          spanZ,
          0,
          spanY - 1,
          sampleCell,
          this.minVX * VOXEL_SIZE,
          this.minVY * VOXEL_SIZE,
          this.minVZ * VOXEL_SIZE,
          VOXEL_SIZE,
          VOXEL_SIZE,
          'OPAQUE_ONLY',
          null,
          true,
          -1,
          undefined,
          {
            perVoxelDetail: true,
            getVoxelHp: sampleVoxelHp,
            getVoxelSpawnTime: sampleVoxelSpawnTime,
          },
        );
        const opUpd = updateOrCreateDynamicMeshBuffer(
          this.chassisMesh,
          res,
          this.world.getActiveOpaqueVoxelMaterial(),
          this.rootGroup,
          false,
          4096,
        );
        this.chassisMesh = opUpd.mesh;
        this.syncChassisOutlineMesh(true);
        if (opUpd.updatedInPlace) this.inPlaceChassisBufferUpdates++;

        const transRes = greedyMeshBoundedArrays(
          spanX,
          spanY,
          spanZ,
          0,
          spanY - 1,
          sampleCell,
          this.minVX * VOXEL_SIZE,
          this.minVY * VOXEL_SIZE,
          this.minVZ * VOXEL_SIZE,
          VOXEL_SIZE,
          VOXEL_SIZE,
          'TRANSLUCENT_ONLY',
          null,
          true,
        );
        const trUpd = updateOrCreateDynamicMeshBuffer(
          this.chassisTransMesh,
          transRes,
          this.world.sharedTranslucentMaterial,
          this.rootGroup,
          true,
          2048,
        );
        this.chassisTransMesh = trUpd.mesh;
        if (trUpd.updatedInPlace) this.inPlaceChassisBufferUpdates++;

        this.rawFaces = res.rawFaces + transRes.rawFaces;
        this.mergedQuads = res.mergedQuads + transRes.mergedQuads;
      }
    }

    // Reuse existing module meshes whenever possible and dispose any removed module meshes to prevent WebGL buffer leaks with 50+ guns!
    const activeMeshes = new Set<THREE.Object3D>();
    this.headlightBeamMeshes = [];
    for (const mod of this.modules) {
      const wantCharred = (mod.health ?? 1.0) < 0.5;
      if (
        mod.mesh &&
        mod.mesh.userData.isCharred === wantCharred &&
        mod.mesh.userData.kind === mod.kind
      ) {
        mod.mesh.rotation.order = 'YXZ';
        mod.mesh.rotation.set(
          ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
          ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
          ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
        );
        mod.mesh.position.set(
          (mod.vx + 0.5) * VOXEL_SIZE,
          (mod.vy + 0.5) * VOXEL_SIZE,
          (mod.vz + 0.5) * VOXEL_SIZE,
        );
        if (mod.mesh.parent !== this.modulesGroup) {
          this.modulesGroup.add(mod.mesh);
        }
        activeMeshes.add(mod.mesh);
        if (mod.kind === 'HEADLIGHT') {
          mod.mesh.traverse((ch) => {
            if (ch instanceof THREE.Mesh && ch.geometry instanceof THREE.ConeGeometry) {
              ch.visible = this.headlightsOn;
              this.headlightBeamMeshes.push(ch);
            }
          });
        }
      } else {
        if (mod.mesh) {
          this.modulesGroup.remove(mod.mesh);
          disposeModuleGroupGeometries(mod.mesh);
          mod.mesh = null;
        }
        const created = this.createModuleMesh(mod);
        this.modulesGroup.add(created);
        activeMeshes.add(created);
      }
    }
    for (let i = this.modulesGroup.children.length - 1; i >= 0; i--) {
      const child = this.modulesGroup.children[i];
      if (!activeMeshes.has(child)) {
        this.modulesGroup.remove(child);
        disposeModuleGroupGeometries(child);
      }
    }

    // #5 — Bullet impact: defer physics collision-hull & mass recomputation by 1 frame!
    if (deferPhysicsHull) {
      this.pendingPhysicsHullRebuild = true;
      return;
    }

    this.flushPendingPhysicsHullRebuild();
  }

  /**
   * Executes the physics collision-hull, module raycast lookup, structural integrity, and mass/CoM rebuild.
   * When deferred by 1 frame on bullet impact (#5), this runs at the start of the next frame's updatePhysics().
   */
  flushPendingPhysicsHullRebuild(): void {
    this.pendingPhysicsHullRebuild = false;

    // Build O(1) spatial hash map for module raycasting so 50+ modules never slow down DDA raycasts
    this.moduleVoxelLookup.clear();
    const distMap = new Map<string, number>();
    for (let i = 0; i < this.modules.length; i++) {
      const mod = this.modules[i];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const key = `${mod.vx + dx},${mod.vy + dy},${mod.vz + dz}`;
            const dSq = dx * dx + dy * dy + dz * dz;
            const prevD = distMap.get(key) ?? Infinity;
            if (dSq < prevD) {
              distMap.set(key, dSq);
              this.moduleVoxelLookup.set(key, 100 + i);
            }
          }
        }
      }
    }
    for (let i = 0; i < this.modules.length; i++) {
      const mod = this.modules[i];
      this.moduleVoxelLookup.set(`${mod.vx},${mod.vy},${mod.vz}`, 100 + i);
    }

    // Update structural integrity metrics and cache damaged smoking blocks (<50% health)
    this.damagedVoxelsList = [];
    let damagedCount = 0;
    let currentHealthSum = 0;

    this.voxelMap.forEach((mat, key) => {
      if (mat === MAT.AIR) return;
      const hp = this.voxelHealthMap.get(key) ?? 1.0;
      currentHealthSum += hp;
      if (hp < 0.5) {
        damagedCount++;
        const [vx, vy, vz] = parseVoxelCoords(key);
        // Only emit smoke from exposed/surface blocks for maximum optimization
        if (
          this.getVoxel(vx + 1, vy, vz) === MAT.AIR ||
          this.getVoxel(vx - 1, vy, vz) === MAT.AIR ||
          this.getVoxel(vx, vy + 1, vz) === MAT.AIR ||
          this.getVoxel(vx, vy - 1, vz) === MAT.AIR ||
          this.getVoxel(vx, vy, vz + 1) === MAT.AIR ||
          this.getVoxel(vx, vy, vz - 1) === MAT.AIR
        ) {
          this.damagedVoxelsList.push({ vx, vy, vz });
        }
      }
    });

    for (const mod of this.modules) {
      const hp = mod.health ?? 1.0;
      currentHealthSum += hp;
      if (hp < 0.5) {
        damagedCount++;
        this.damagedVoxelsList.push({ vx: mod.vx, vy: mod.vy, vz: mod.vz });
      }
    }

    this.damagedBlockCount = damagedCount;
    if (damagedCount > 0 && !this.isVoxelEntity) {
      this.smokeBurnRemainingSec = 10.0;
    } else if (damagedCount === 0) {
      this.smokeBurnRemainingSec = 0;
    }
    const baselineTotal = this.intactBlueprintSnapshot
      ? Math.max(
          1,
          this.intactBlueprintSnapshot.voxels.length +
            this.intactBlueprintSnapshot.modules.length,
        )
      : Math.max(1, this.voxelMap.size + this.modules.length);

    if (this.voxelMap.size === 0 && this.modules.length === 0) {
      this.structuralIntegrityPct = 0;
    } else {
      this.structuralIntegrityPct = Math.max(
        1,
        Math.min(100, Math.round((currentHealthSum / baselineTotal) * 100)),
      );
    }

    // Pre-cache hover voxels, wheel modules, and wheel-to-suspension/hinge pairings so updatePhysics does 0 allocations or O(N^2) searches per substep
    this.cachedHoverVoxels = [];
    this.voxelMap.forEach((matId, key) => {
      if (matId === MAT.AIR) return;
      const extSpec = (MAT_INFO as Record<number, ExtendedMaterialSpec>)[matId];
      if (extSpec && extSpec.hoverForce && extSpec.hoverForce > 0) {
        const [vx, vy, vz] = parseVoxelCoords(key);
        this.cachedHoverVoxels.push({
          vx,
          vy,
          vz,
          hoverForce: extSpec.hoverForce,
        });
      }
    });

    this.cachedWheelMods = [];
    const suspensionMods: ActiveModule[] = [];
    const steeringHingeMods: ActiveModule[] = [];
    this.cachedPrimarySeat = null;

    for (let i = 0; i < this.modules.length; i++) {
      const m = this.modules[i];
      if (
        m.kind === 'WHEEL_STEER' ||
        m.kind === 'WHEEL_DRIVE' ||
        m.kind === 'WHEEL_RACING' ||
        m.kind === 'WHEEL_MONSTER' ||
        m.kind === 'WHEEL_KART' ||
        m.kind === 'WHEEL_DRAG' ||
        m.kind === 'WHEEL_SPIKED' ||
        m.kind === 'TANK_TREAD' ||
        m.kind === 'SKI_SLIDER'
      ) {
        ensureHybridWheelState(m);
        this.cachedWheelMods.push(m);
      } else if (m.kind === 'SUSPENSION') {
        suspensionMods.push(m);
      } else if (
        m.kind === 'STEERING_HINGE' ||
        m.kind === 'SERVO_SMALL' ||
        m.kind === 'HINGE_LARGE'
      ) {
        steeringHingeMods.push(m);
      }
      if (
        !this.cachedPrimarySeat &&
        isSeatModuleKind(m.kind) &&
        (m.health ?? 1.0) > 0
      ) {
        this.cachedPrimarySeat = m;
      }
    }

    this.cachedSteeringHingeCount = steeringHingeMods.length;
    this.cachedWheelPairedSusp = new Array(this.cachedWheelMods.length).fill(null);
    this.cachedWheelPairedHinge = new Array(this.cachedWheelMods.length).fill(null);

    for (let wIdx = 0; wIdx < this.cachedWheelMods.length; wIdx++) {
      const mod = this.cachedWheelMods[wIdx];
      let pairedSusp: ActiveModule | null = null;
      let bestSuspDistSq = Infinity;
      for (let sIdx = 0; sIdx < suspensionMods.length; sIdx++) {
        const s = suspensionMods[sIdx];
        const dx = s.vx - mod.vx;
        const dy = s.vy - mod.vy;
        const dz = s.vz - mod.vz;
        if (Math.abs(dx) <= 3 && Math.abs(dy) <= 4 && Math.abs(dz) <= 3) {
          const dSq = dx * dx + dy * dy + dz * dz;
          if (dSq < bestSuspDistSq) {
            bestSuspDistSq = dSq;
            pairedSusp = s;
          }
        }
      }
      this.cachedWheelPairedSusp[wIdx] = pairedSusp;

      let pairedHinge: ActiveModule | null = null;
      let bestHingeDistSq = Infinity;
      for (let hIdx = 0; hIdx < steeringHingeMods.length; hIdx++) {
        const h = steeringHingeMods[hIdx];
        const dx = h.vx - mod.vx;
        const dy = h.vy - mod.vy;
        const dz = h.vz - mod.vz;
        if (Math.abs(dx) <= 3 && Math.abs(dy) <= 4 && Math.abs(dz) <= 3) {
          const dSq = dx * dx + dy * dy + dz * dz;
          if (dSq < bestHingeDistSq) {
            bestHingeDistSq = dSq;
            pairedHinge = h;
          }
        }
      }
      this.cachedWheelPairedHinge[wIdx] = pairedHinge;
    }

    this.recalculateMassAndCenters();

    if (this.pendingImpactOldRootWorld) {
      if (this.voxelCount > 0 || this.modules.length > 0) {
        this.rigidBody.position
          .copy(this.pendingImpactOldRootWorld)
          .add(_v1.copy(this.comLocal).applyQuaternion(this.rigidBody.quaternion));
        this.position.copy(this.rigidBody.position);
        this.quaternion.copy(this.rigidBody.quaternion);
      }
      this.pendingImpactOldRootWorld = null;
      this.syncVisualTransform();
    }
  }

  recalculateMassAndCenters(): void {
    const summary = computeRigidBodyProperties(
      {
        getVoxel: (vx, vy, vz) => this.getVoxel(vx, vy, vz),
        forEachVoxel: (cb) => {
          this.voxelMap.forEach((mat, key) => {
            if (mat !== MAT.AIR) {
              const [vx, vy, vz] = parseVoxelCoords(key);
              cb(vx, vy, vz, mat);
            }
          });
        },
      },
      this.modules,
    );

    const tuning = getVehicleTuningProfile(this.presetIndex);
    const entityBaseScale = this.isVoxelEntity ? 0.06 : 1.0;
    const configMassScale =
      (PHYSICS_CONFIG.defaultVoxelMassKg || 1.0) *
      (this.isVoxelEntity ? 1.0 : tuning.massScale) *
      entityBaseScale *
      (this.entityMassMultiplier || 1.0);
    this.lastAppliedConfigMassScale = configMassScale;

    const minMass = this.isVoxelEntity ? 3.5 : PHYSICS_CONFIG.minVehicleMassKg;
    const minInert = this.isVoxelEntity ? 1.2 : PHYSICS_CONFIG.minInertia;

    this.totalMass = Math.max(minMass, summary.totalMass * configMassScale);
    this.totalBuoyancy = summary.totalBuoyancy;
    this.voxelCount = summary.voxelCount;
    this.comLocal.set(summary.comLocal.x, summary.comLocal.y, summary.comLocal.z);
    this.rigidBody.voxelWorld.setBodyComLocal(
      this.rigidBody.slotIndex,
      this.comLocal.x,
      this.comLocal.y,
      this.comLocal.z,
    );
    this.cobLocal.set(summary.cobLocal.x, summary.cobLocal.y, summary.cobLocal.z);
    this.cotLocal.set(summary.cotLocal.x, summary.cotLocal.y, summary.cotLocal.z);
    this.inertia.set(
      Math.max(minInert, summary.inertia.x * configMassScale),
      Math.max(minInert, summary.inertia.y * configMassScale),
      Math.max(minInert, summary.inertia.z * configMassScale),
    );

    this.hullSamples = summary.hullSamples;

    // Sample surface voxels into voxel-tuned collision points (16 for <100 voxels, 32 for 100-300, 64 for 300+)
    const sampledPoints = sampleVehicleCollisionPoints(
      this.voxelMap,
      summary.comLocal,
      (vx, vy, vz) => this.getVoxel(vx, vy, vz),
    );
    this.rigidBody.collisionPoints = sampledPoints;
    this.collisionPoints =
      sampledPoints.length > 0
        ? [
            ...sampledPoints.map((pt) => pt.metricPos),
            {
              x: this.comLocal.x,
              y: Math.max(this.minVY * VOXEL_SIZE, this.comLocal.y - 0.2),
              z: this.comLocal.z,
            },
          ]
        : summary.collisionPoints;

    const prevGyroCount = this.gyroCount;
    this.engineCount = summary.engineCount;
    this.thrusterCount = summary.thrusterCount;
    this.propCount = summary.propCount;
    this.wingCount = summary.wingCount;
    this.vtolCount = summary.vtolCount;
    this.gyroCount = summary.gyroCount;
    this.cannonCount = summary.cannonCount;
    this.wheelCount = summary.wheelCount;
    this.pistonCount = summary.pistonCount;
    this.winchCount = summary.winchCount;
    if (this.gyroCount <= 0) {
      this.gyroEnabled = false;
    } else if (prevGyroCount === 0 && this.gyroCount > 0) {
      this.gyroEnabled = true;
    }
    if (this.pistonCount <= 0) {
      this.pistonExtended = false;
      this.pistonExtRatio = 0;
    }
    if (this.winchCount <= 0) {
      this.releaseGrappleWinch();
    }
    this.powerCores =
      this.engineCount * 2 +
      this.thrusterCount * 2 +
      this.propCount +
      this.vtolCount * 3 +
      this.cannonCount * 2 +
      this.pistonCount +
      this.winchCount;

    this.comMarker.position.copy(this.comLocal);
    this.cobMarker.position.copy(this.cobLocal);
    this.cotMarker.position.copy(this.cotLocal);
    this.syncForceMarkersVisibility();

    if (!this.isVoxelEntity) {
      this.rigidBody.linearDamping = tuning.linearDamping;
      this.rigidBody.angularDamping = tuning.angularDamping;
    }
    this.rigidBody.isSmallObject =
      this.isVoxelEntity ||
      this.voxelCount < 80 ||
      this.totalMass < PHYSICS_CONFIG.smallObjectMaxMassKg;
    this.rigidBody.syncMassProperties(this.totalMass, this.inertia);
    this.computeHardwarePorts();
    if (this.inBuildMode && this.showWiringOverlay) {
      this.rebuildQuickWiringLines();
    }
  }

  localVoxelToWorld(
    vx: number,
    vy: number,
    vz: number,
    out?: THREE.Vector3,
  ): THREE.Vector3 {
    const v = out || new THREE.Vector3();
    v.set(
      (vx + 0.5) * VOXEL_SIZE - this.comLocal.x,
      (vy + 0.5) * VOXEL_SIZE - this.comLocal.y,
      (vz + 0.5) * VOXEL_SIZE - this.comLocal.z,
    );
    v.applyQuaternion(this.quaternion).add(this.position);
    return v;
  }

  /**
   * Converts a world-space point into local metric coordinates relative to vehicle voxel (0,0,0).
   */
  worldToLocalMetric(
    wx: number,
    wy: number,
    wz: number,
    out?: THREE.Vector3,
  ): THREE.Vector3 {
    _invRot.copy(this.quaternion).invert();
    const v = out ? out.set(wx, wy, wz) : new THREE.Vector3(wx, wy, wz);
    return v
      .sub(this.position)
      .applyQuaternion(_invRot)
      .add(this.comLocal);
  }

  /**
   * Converts local metric coordinates relative to vehicle voxel (0,0,0) back into world space.
   */
  localMetricToWorld(localPos: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3 {
    const v = out ? out.copy(localPos) : localPos.clone();
    return v
      .sub(this.comLocal)
      .applyQuaternion(this.quaternion)
      .add(this.position);
  }

  /**
   * Exact per-voxel solidity check at world coordinates (wx, wy, wz) matching the vehicle's true 3D voxel shape.
   * Returns the solid material ID (!== MAT.AIR) or MAT.AIR (0) if the world point is empty air.
   */
  getSolidVoxelMaterialAtWorld(
    wx: number,
    wy: number,
    wz: number,
    includeSeatModules = false,
  ): number {
    if (this.inBuildMode || (this.voxelCount === 0 && this.modules.length === 0)) {
      return MAT.AIR;
    }
    const halfX = (this.maxVX - this.minVX + 3) * VOXEL_SIZE * 0.5;
    const halfY = (this.maxVY - this.minVY + 3) * VOXEL_SIZE * 0.5;
    const halfZ = (this.maxVZ - this.minVZ + 3) * VOXEL_SIZE * 0.5;
    const boundR = Math.hypot(halfX, halfY, halfZ) + 0.5;
    const dx = wx - this.position.x;
    const dy = wy - this.position.y;
    const dz = wz - this.position.z;
    if (dx * dx + dy * dy + dz * dz > boundR * boundR) {
      return MAT.AIR;
    }

    const loc = this.worldToLocalMetric(wx, wy, wz, _solidCheckVec);
    const vx = Math.floor(loc.x / VOXEL_SIZE);
    const vy = Math.floor(loc.y / VOXEL_SIZE);
    const vz = Math.floor(loc.z / VOXEL_SIZE);
    if (
      vx < this.minVX - 1 ||
      vx > this.maxVX + 1 ||
      vy < this.minVY - 1 ||
      vy > this.maxVY + 1 ||
      vz < this.minVZ - 1 ||
      vz > this.maxVZ + 1
    ) {
      return MAT.AIR;
    }
    const mat = this.getVoxel(vx, vy, vz);
    if (mat !== MAT.AIR) return mat;

    for (let i = 0; i < this.modules.length; i++) {
      const m = this.modules[i];
      if (!includeSeatModules && isSeatModuleKind(m.kind)) {
        continue;
      }
      if (m.vx === vx && m.vy === vy && m.vz === vz) {
        return MAT.STEEL;
      }
    }
    return MAT.AIR;
  }

  /**
   * Checks whether a world-space point hits any solid block or functional module on the vehicle!
   */
  isWorldPointSolid(wx: number, wy: number, wz: number): boolean {
    return this.getSolidVoxelMaterialAtWorld(wx, wy, wz, true) !== MAT.AIR;
  }

  /**
   * Probes vertically at world (wx, wz) from `startY + maxStepUp` downward to find the highest walkable/driveable
   * top voxel surface on this vehicle's true 3D voxel geometry (including ramps, stairs, flatbeds, and tilted hulls).
   * Never teleports onto tall vertical walls because it verifies open air above `startY + maxStepUp`.
   */
  probeVoxelSurfaceBelow(
    wx: number,
    startY: number,
    wz: number,
    maxStepUp = 0.45,
  ): { y: number; mat: number } | null {
    if (this.inBuildMode || (this.voxelCount === 0 && this.modules.length === 0)) {
      return null;
    }
    const halfX = (this.maxVX - this.minVX + 3) * VOXEL_SIZE * 0.5;
    const halfY = (this.maxVY - this.minVY + 3) * VOXEL_SIZE * 0.5;
    const halfZ = (this.maxVZ - this.minVZ + 3) * VOXEL_SIZE * 0.5;
    const boundR = Math.hypot(halfX, halfY, halfZ) + 0.5;
    const dx = wx - this.position.x;
    const dz = wz - this.position.z;
    if (dx * dx + dz * dz > boundR * boundR) {
      return null;
    }

    const minWorldY = this.position.y - boundR;
    const maxWorldY = this.position.y + boundR;
    if (startY + maxStepUp < minWorldY || startY - 3.5 > maxWorldY) {
      return null;
    }

    // If the column just above step-up height (`startY + maxStepUp + 0.08` and `+ 0.33`) is solid on this vehicle,
    // then `(wx, wz)` at `startY` is facing a tall vertical wall (> maxStepUp), so clamp top scan to `startY`!
    const blockedAboveStep =
      this.getSolidVoxelMaterialAtWorld(wx, startY + maxStepUp + 0.08, wz) !== MAT.AIR &&
      this.getSolidVoxelMaterialAtWorld(wx, startY + maxStepUp + 0.33, wz) !== MAT.AIR;

    const topY = Math.min(
      maxWorldY,
      blockedAboveStep ? startY + 0.05 : startY + maxStepUp,
    );
    const bottomY = Math.max(minWorldY, startY - 3.2);
    if (topY < bottomY) {
      return null;
    }

    const stepY = VOXEL_SIZE * 0.4; // 0.10m vertical scan resolution (< half a 0.25m voxel)
    const steps = Math.ceil((topY - bottomY) / stepY);

    for (let s = 0; s <= steps; s++) {
      const testY = Math.max(bottomY, topY - s * stepY);
      const mat = this.getSolidVoxelMaterialAtWorld(wx, testY, wz);
      if (mat !== MAT.AIR && mat !== MAT.WATER_VOX) {
        let lowY = testY;
        let highY = s === 0 ? topY + 0.04 : topY - (s - 1) * stepY;
        if (this.getSolidVoxelMaterialAtWorld(wx, highY, wz) !== MAT.AIR) {
          continue;
        }
        for (let iter = 0; iter < 5; iter++) {
          const midY = 0.5 * (lowY + highY);
          if (this.getSolidVoxelMaterialAtWorld(wx, midY, wz) !== MAT.AIR) {
            lowY = midY;
          } else {
            highY = midY;
          }
        }
        const surfaceY = highY;
        if (surfaceY <= startY + maxStepUp + 0.06) {
          return { y: surfaceY, mat };
        }
      }
    }
    return null;
  }

  /**
   * Probes both the static voxel terrain AND all other active vehicles' true 3D voxel geometry
   * so wheels and vehicle hulls can smoothly drive up ramps and across flatbeds built on other vehicles.
   */
  probeGroundAndVehiclesBelow(
    wx: number,
    startY: number,
    wz: number,
    maxStepUp = 0.45,
  ): { y: number; mat: number; supportVehicle: ModularVehicleRig | null } {
    const worldGnd = this.world.probeGroundBelow(wx, startY, wz, maxStepUp);
    let bestY = worldGnd.y;
    let bestMat = worldGnd.mat;
    let supportVehicle: ModularVehicleRig | null = null;

    const otherRigs = this.fx?.rigs;
    if (otherRigs && otherRigs.length > 1) {
      for (let i = 0; i < otherRigs.length; i++) {
        const other = otherRigs[i];
        if (!other || other === this || other.inBuildMode) continue;
        // Dynamic voxel entities (cones, crates, barrels, balls, pins) are knocked away by rigid-body collision, never treated as static ground cliffs
        if (other.isVoxelEntity && !other.propRigidBody?.isStatic) continue;
        if (
          Math.abs(wx - other.position.x) > 8.0 ||
          Math.abs(wz - other.position.z) > 8.0
        ) {
          continue;
        }
        const vHit = other.probeVoxelSurfaceBelow(wx, startY, wz, maxStepUp);
        if (vHit && vHit.y > bestY) {
          bestY = vHit.y;
          bestMat = vHit.mat;
          supportVehicle = other;
        }
      }
    }

    const mapHazards = this.fx?.mapHazards;
    if (mapHazards && mapHazards.length > 0) {
      for (let i = 0; i < mapHazards.length; i++) {
        const haz = mapHazards[i];
        if (!haz || typeof haz.probeVoxelSurfaceBelow !== 'function') continue;
        if (
          Math.abs(wx - haz.position.x) > 5.0 ||
          Math.abs(wz - haz.position.z) > 5.0
        ) {
          continue;
        }
        const hHit = haz.probeVoxelSurfaceBelow(wx, startY, wz, maxStepUp);
        if (hHit && hHit.y > bestY) {
          bestY = hHit.y;
          bestMat = hHit.mat;
          supportVehicle = null;
        }
      }
    }
    return { y: bestY, mat: bestMat, supportVehicle };
  }

  /**
   * Carves a 3D spherical destruction crater into the vehicle's blocks and functional modules
   * when hit by a Sledgehammer, Sticky C4 Charge, Plasma Shell, or high-speed crash,
   * and reduces adjacent blocks' health below 50% so they char/darken and emit smoke!
   */
  carveVehicleCrater(
    wx: number,
    wy: number,
    wz: number,
    radiusVoxels: number,
    impulseStrength = 5.0,
  ): number {
    if (this.inBuildMode) return 0;
    const activeMode = ModRegistry.getActiveGameMode();
    if (activeMode.indestructibleVehicles) {
      const pushDir = this.position
        .clone()
        .sub(new THREE.Vector3(wx, wy, wz));
      if (pushDir.lengthSq() < 0.001) pushDir.set(0, 1, 0);
      else pushDir.normalize();
      pushDir.y = Math.max(0.25, pushDir.y + 0.25);
      this.velocity.addScaledVector(pushDir, Math.min(14.0, impulseStrength * 0.65));
      this.syncVisualTransform();
      return 0;
    }

    const hadSeatBefore = this.hasIntactSeat();

    // Keep the vehicle center of mass anchored in world space when blocks break off!
    const oldRootWorld = this.position
      .clone()
      .add(this.comLocal.clone().negate().applyQuaternion(this.quaternion));

    const loc = this.worldToLocalMetric(wx, wy, wz);
    const cx = Math.floor(loc.x / VOXEL_SIZE);
    const cy = Math.floor(loc.y / VOXEL_SIZE);
    const cz = Math.floor(loc.z / VOXEL_SIZE);

    const outerShockRad = Math.ceil(radiusVoxels * 1.9 + 2);
    const offsets = computeSphericalCraterOffsets(outerShockRad);
    let brokenCount = 0;
    let damagedCount = 0;

    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      const vx = cx + off.dx;
      const vy = cy + off.dy;
      const vz = cz + off.dz;
      const mat = this.getVoxel(vx, vy, vz);
      if (mat === MAT.AIR) continue;
      if ((mat & 63) === MAT.C4_EXPLOSIVE) {
        igniteC4Voxel(this, packVoxelKey(vx, vy, vz));
        continue;
      }

      const dist = Math.hypot(off.dx, off.dy, off.dz);
      const key = `${vx},${vy},${vz}`;
      const oldHp = this.voxelHealthMap.get(key) ?? 1.0;

      if (dist <= radiusVoxels * 0.85) {
        // Heavy armor resists light outer hits by dropping below 50% health first
        if (
          mat === MAT.ARMOR_SLATE &&
          dist > radiusVoxels * 0.55 &&
          radiusVoxels <= 4 &&
          oldHp > 0.45
        ) {
          this.voxelHealthMap.set(key, 0.32);
          damagedCount++;
          continue;
        }
        this.setVoxel(vx, vy, vz, MAT.AIR);
        brokenCount++;
        if (brokenCount <= 42) {
          const wp = this.localVoxelToWorld(vx, vy, vz);
          const color = MAT_INFO[mat]?.color ?? 0x38bdf8;
          this.fx.spawnDebris(wp.x, wp.y, wp.z, color, 8.5, 1.35);
        }
      } else {
        // Outer structural shockwave zone: drop block health below 50% so it chars & smokes!
        const falloff = Math.max(
          0.18,
          1 - (dist - radiusVoxels * 0.8) / Math.max(1, outerShockRad - radiusVoxels * 0.8),
        );
        const hpLoss = Math.max(0.56, falloff * 0.78);
        const newHp = oldHp - hpLoss;
        if (newHp <= 0.05) {
          this.setVoxel(vx, vy, vz, MAT.AIR);
          brokenCount++;
        } else {
          this.voxelHealthMap.set(key, Math.min(0.42, Math.max(0.15, newHp)));
          this.hullDirty = true;
          damagedCount++;
        }
      }
    }

    const rModDestroySq = (radiusVoxels + 0.9) * (radiusVoxels + 0.9);
    const rModDamageSq = (outerShockRad + 1.2) * (outerShockRad + 1.2);
    const blastCenterWorld = new THREE.Vector3(wx, wy, wz);
    const beforeMods = this.modules.length;
    this.modules = this.modules.filter((m) => {
      const dx = m.vx - cx;
      const dy = m.vy - cy;
      const dz = m.vz - cz;
      const dSq = dx * dx + dy * dy + dz * dz;
      const isWheelKind =
        m.kind.startsWith('WHEEL_') || m.kind === 'SKI_SLIDER';

      if (isWheelKind && dSq <= rModDamageSq) {
        // Step 2.7: Hybrid wheel loses voxels, shrinks sphere radius, loses grip, and becomes "shot out" when 0 voxels remain!
        const lostVoxels = dSq <= rModDestroySq ? 6 : 3;
        damageWheelFromCollision(
          this,
          m,
          lostVoxels,
          blastCenterWorld,
          this.fx?.voxelDebrisSystem,
        );
        damagedCount++;
        return true; // Keep the module on the chassis so its shot-out corner drags on the ground!
      }

      if (dSq <= rModDestroySq) {
        const wp = this.localVoxelToWorld(m.vx, m.vy, m.vz);
        this.fx.spawnDebris(wp.x, wp.y, wp.z, 0xf59e0b, 10.5, 1.7);
        return false;
      }
      if (dSq <= rModDamageSq) {
        const nextHp = (m.health ?? 1.0) - 0.62;
        if (nextHp <= 0.05) {
          const wp = this.localVoxelToWorld(m.vx, m.vy, m.vz);
          this.fx.spawnDebris(wp.x, wp.y, wp.z, 0xf59e0b, 9.5, 1.4);
          return false;
        }
        m.health = Math.min(0.4, Math.max(0.18, nextHp));
        damagedCount++;
      }
      return true;
    });
    let brokenMods = beforeMods - this.modules.length;
    let totalBroken = brokenCount + brokenMods;

    // Step 2.5: Run 10-neighbor C-Simple structural integrity check so severed struts/wings turn red for 100-200ms and cascade off!
    if (brokenCount > 0 && this.voxelMap.size > 2) {
      checkStructuralIntegrityAfterDestruction(
        this,
        packVoxelKey(cx, cy, cz),
        blastCenterWorld,
      );
    }

    // 3D Connected-Components Fracture ("Real Break-Offs"):
    // Detect any floating islands of blocks severed from the main hull and spawn them as tumbling 3D rigid bodies carrying their attached modules!
    if (brokenCount > 0 && this.voxelMap.size > 2) {
      const cockpitMod = this.modules.find((m) => isSeatModuleKind(m.kind)) || null;
      const { detachedIslands } = findDisconnectedVoxelIslands(
        this.voxelMap,
        cockpitMod,
      );
      if (detachedIslands.length > 0) {
        for (const island of detachedIslands) {
          let sumX = 0, sumY = 0, sumZ = 0;
          const islandKeySet = new Set<number>();
          for (const [vx, vy, vz] of island) {
            this.setVoxel(vx, vy, vz, MAT.AIR);
            islandKeySet.add(packVoxelKey(vx, vy, vz));
            sumX += vx;
            sumY += vy;
            sumZ += vz;
          }
          totalBroken += island.length;
          this.detachedIslandsCount++;
          const avgVX = sumX / island.length;
          const avgVY = sumY / island.length;
          const avgVZ = sumZ / island.length;
          const islandCenterWorld = this.localVoxelToWorld(avgVX, avgVY, avgVZ);

          // Collect any modules attached to this severed voxel island!
          const severedModAttachments: Array<{ group: THREE.Group; localOffset: THREE.Vector3 }> = [];
          this.modules = this.modules.filter((m) => {
            let onMainHull = false;
            let onThisIsland = false;
            for (let dz = -2; dz <= 2; dz++) {
              for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                  const k = packVoxelKey(m.vx + dx, m.vy + dy, m.vz + dz);
                  if (this.getVoxel(m.vx + dx, m.vy + dy, m.vz + dz) !== MAT.AIR) {
                    onMainHull = true;
                  }
                  if (islandKeySet.has(k)) {
                    onThisIsland = true;
                  }
                }
              }
            }
            if (onThisIsland && !onMainHull) {
              const modMesh = m.mesh || this.createModuleMesh(m, false);
              if (modMesh.parent) modMesh.parent.remove(modMesh);
              m.mesh = null;
              severedModAttachments.push({
                group: modMesh,
                localOffset: new THREE.Vector3(
                  (m.vx - avgVX) * VOXEL_SIZE,
                  (m.vy - avgVY) * VOXEL_SIZE,
                  (m.vz - avgVZ) * VOXEL_SIZE,
                ),
              });
              brokenMods++;
              totalBroken++;
              return false;
            }
            return true;
          });

          // Inherit linear + rotational velocity (v + omega x r) + outward blast impulse
          const rArm = islandCenterWorld.clone().sub(this.position);
          const rotVel = new THREE.Vector3().crossVectors(this.angularVelocity, rArm);
          const islandVel = this.velocity.clone().add(rotVel);
          const outwardBlast = islandCenterWorld.clone().sub(blastCenterWorld);
          if (outwardBlast.lengthSq() < 0.01) outwardBlast.set(0, 1, 0);
          else outwardBlast.normalize();
          outwardBlast.y = Math.max(0.35, outwardBlast.y + 0.35);
          outwardBlast.multiplyScalar(Math.min(14.0, 4.5 + impulseStrength * 0.85));

          this.fx.spawnDetachedIslandFragment(
            islandCenterWorld,
            this.quaternion,
            island,
            islandVel,
            severedModAttachments,
            outwardBlast,
          );
        }
      }
    }

    // Also detach any functional module (wheels, wings, engines, seats!) whose underlying chassis blocks were completely destroyed
    if (brokenCount > 0 && this.modules.length > 0) {
      const beforeSupportCheck = this.modules.length;
      this.modules = this.modules.filter((m) => {
        if (this.voxelMap.size > 0) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) {
                if (this.getVoxel(m.vx + dx, m.vy + dy, m.vz + dz) !== MAT.AIR) {
                  return true;
                }
              }
            }
          }
        }
        const wp = this.localVoxelToWorld(m.vx, m.vy, m.vz);
        const modMesh = m.mesh || this.createModuleMesh(m, false);
        if (modMesh.parent) modMesh.parent.remove(modMesh);
        m.mesh = null;
        const outward = wp.clone().sub(blastCenterWorld);
        if (outward.lengthSq() < 0.01) outward.set(0, 1, 0);
        else outward.normalize();
        outward.y = Math.max(0.4, outward.y + 0.4);
        outward.multiplyScalar(6.5);
        this.fx.spawnDetachedIslandFragment(
          wp,
          this.quaternion,
          [],
          this.velocity,
          [{ group: modMesh, localOffset: new THREE.Vector3(0, 0, 0) }],
          outward,
        );
        return false;
      });
      const detachedUnsupported = beforeSupportCheck - this.modules.length;
      if (detachedUnsupported > 0) {
        brokenMods += detachedUnsupported;
        totalBroken += detachedUnsupported;
      }
    }

    if (totalBroken > 0 || damagedCount > 0) {
      this.fx.voxelsDestroyedCount += totalBroken;
      if (ModRegistry.getActiveGameMode().enableDemolitionScore) {
        ModRegistry.demolitionScore += totalBroken * 25 + damagedCount * 5;
      }
      this.voxelCount = this.voxelMap.size;
      if (!this.pendingImpactOldRootWorld) {
        this.pendingImpactOldRootWorld = oldRootWorld.clone();
      }
      // #5 — Update visual breakage immediately this frame, defer collision-hull & mass rebuild to next frame!
      this.rebuildVehicleGeometry(true);

      // Apply realistic suspension rock / knockback impulse only when impulseStrength > 0.05 (never stack on vehicle-to-vehicle collisions!)
      if (impulseStrength > 0.05) {
        const pushDir = this.position
          .clone()
          .sub(new THREE.Vector3(wx, wy, wz));
        if (pushDir.lengthSq() < 0.001) pushDir.set(0, 0.15, 0);
        else pushDir.normalize();
        pushDir.y = Math.max(0.05, Math.min(0.18, pushDir.y * 0.3));
        this.velocity.addScaledVector(pushDir, Math.min(5.5, impulseStrength * 0.35));
        this.angularVelocity.x += (Math.random() - 0.5) * Math.min(0.8, impulseStrength * 0.08);
        this.angularVelocity.y += (Math.random() - 0.5) * Math.min(0.8, impulseStrength * 0.08);
        this.angularVelocity.z += (Math.random() - 0.5) * Math.min(0.8, impulseStrength * 0.08);
      }

      this.syncVisualTransform();
    }

    // If the pilot seat broke during this impact/explosion, immediately trigger seat-breakage ejection!
    if (hadSeatBefore && !this.hasIntactSeat() && this.onSeatBroken) {
      this.onSeatBroken();
    }

    return totalBroken;
  }

  /**
   * Returns the world eye position and forward look target for the First-Person Cockpit Camera!
   */
  getCockpitCameraPose(): { eye: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 } {
    const seatMod = this.modules.find((m) => isSeatModuleKind(m.kind));
    const eyeVY = Math.max(
      seatMod ? seatMod.vy + 3.6 : 10,
      this.maxVY + 1.2,
    );
    const eyeVZ = seatMod
      ? Math.min(this.maxVZ, seatMod.vz + 4.0)
      : this.maxVZ - 1.5;
    _v1.set(
      seatMod ? (seatMod.vx + 0.5) * VOXEL_SIZE : this.comLocal.x,
      eyeVY * VOXEL_SIZE,
      eyeVZ * VOXEL_SIZE,
    );

    _cockpitEyeOut
      .copy(_v1)
      .sub(this.comLocal)
      .applyQuaternion(this.quaternion)
      .add(this.position);

    _v2.set(0, -0.05, 1).applyQuaternion(this.quaternion).normalize();
    _cockpitUpOut.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
    _cockpitTargetOut.copy(_cockpitEyeOut).addScaledVector(_v2, 14.0);
    return { eye: _cockpitEyeOut, target: _cockpitTargetOut, up: _cockpitUpOut };
  }

  /**
   * Returns the world camera position and target for the Low-Angle Wheel Action Camera!
   */
  getWheelActionCameraPose(): { eye: THREE.Vector3; target: THREE.Vector3 } {
    const rightSpan = (this.maxVX - SYMMETRY_CENTER_X + 6) * VOXEL_SIZE;
    _v1.set(1, 0, 0).applyQuaternion(this.quaternion);
    _v2.set(0, 0, 1).applyQuaternion(this.quaternion);
    _v3.set(0, 1, 0).applyQuaternion(this.quaternion);

    _wheelCamEyeOut
      .copy(this.position)
      .addScaledVector(_v1, Math.max(2.2, rightSpan))
      .addScaledVector(_v2, -2.4)
      .addScaledVector(_v3, 0.35);

    _wheelCamTargetOut
      .copy(this.position)
      .addScaledVector(_v2, 3.2)
      .addScaledVector(_v3, 0.15);

    return { eye: _wheelCamEyeOut, target: _wheelCamTargetOut };
  }

  /**
   * Toggle Hovering Anti-Gravity Build Mode right where the vehicle currently is!
   */
  setHoverBuildMode(enabled: boolean): void {
    const wasInBuildMode = this.inBuildMode;
    this.inBuildMode = enabled;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    const headingYaw = Math.atan2(fwd.x, fwd.z);
    const ground = this.world.probeGroundBelow(
      this.position.x,
      this.position.y,
      this.position.z,
      1.8,
    );
    const hasWater = this.world.isWaterAt(this.position.x, WATER_LEVEL - 0.1, this.position.z);
    const groundY = hasWater ? Math.max(WATER_LEVEL, ground.y) : ground.y;

    if (enabled) {
      this.hoverAnchorPos.set(this.position.x, groundY + 3.2, this.position.z);
      this.position.copy(this.hoverAnchorPos);
      this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingYaw);
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);

      this.hoverRingGroup.position.set(this.position.x, groundY + 0.18, this.position.z);
      this.hoverRingGroup.rotation.y = headingYaw;
      this.hoverRingGroup.visible = true;

      // Preview any disconnected parts in red immediately upon entering Build Mode
      this.hullDirty = true;
      this.rebuildVehicleGeometry(true);
    } else {
      this.position.y = Math.max(groundY + 1.15, this.position.y - 0.5);
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.hoverRingGroup.visible = false;
      this.ghostGroup.visible = false;
      this.lastGhostSignature = '';
      this.syncPhysicsSnapshot();

      // When exiting Build Mode, run structural integrity check so any red-tinted disconnected voxels immediately fall off as debris!
      if (wasInBuildMode || this.fallingOffVoxels.size > 0 || this.connectivityCache.dirty) {
        detachDisconnectedVoxelsOnExitBuildMode(this, this.fx?.voxelDebrisSystem);
      }

      // Save intact snapshot of the connected vehicle after detaching any unconnected build-mode debris
      this.saveIntactSnapshot();
    }

    this.syncForceMarkersVisibility();
    this.symmetryPlane.visible = enabled && this.mirrorMode;
    this.syncPhysicsSnapshot();
  }

  /**
   * Calls the vehicle to (wx, wz) and sets it 100% upright WITHOUT repairing any damage or missing blocks!
   * Used when pressing [R] while driving or on foot.
   */
  callAndUprightTo(wx: number, wz: number, yawRad?: number): void {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    const targetYaw = yawRad !== undefined ? yawRad : Math.atan2(fwd.x, fwd.z);
    const ground = this.world.probeGroundBelow(
      wx,
      Math.max(this.position.y + 3.5, WATER_LEVEL + 4.0),
      wz,
      3.5,
    );
    const hasWater = this.world.isWaterAt(wx, WATER_LEVEL - 0.1, wz);
    const surfY = hasWater ? Math.max(WATER_LEVEL, ground.y) : ground.y;
    this.position.set(wx, surfY + (this.inBuildMode ? 3.2 : 1.35), wz);
    this.hoverAnchorPos.copy(this.position);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.syncPhysicsSnapshot();
  }

  repairVehicle(): void {
    if (this.intactBlueprintSnapshot) {
      this.importBlueprint(this.intactBlueprintSnapshot);
    } else {
      for (const [key] of this.voxelMap) {
        this.voxelHealthMap.set(key, 1.0);
      }
      for (const mod of this.modules) {
        mod.health = 1.0;
      }
      this.rebuildVehicleGeometry();
    }
  }

  summonTo(wx: number, wz: number, yawRad: number): void {
    // Repair any smashed/crashed or smoking (<50% health) blocks from the intact blueprint snapshot when pressing [G]!
    if (this.intactBlueprintSnapshot) {
      const snap = this.intactBlueprintSnapshot;
      if (
        this.voxelMap.size !== snap.voxels.length ||
        this.modules.length !== snap.modules.length ||
        this.damagedBlockCount > 0
      ) {
        this.importBlueprint(snap);
      }
    }
    const probeStartY = Math.max(
      36.0,
      this.position.y + 6.0,
      WATER_LEVEL + 6.0,
    );
    const ground = this.world.probeGroundBelow(
      wx,
      probeStartY,
      wz,
      4.0,
    );
    const expectedSurfY = (10 + SUBTERRANEAN_DEPTH_VY + 1) * VOXEL_SIZE;
    let rawSurfY = ground.y;
    if (rawSurfY <= 0.5) {
      rawSurfY = expectedSurfY;
    }
    const hasWater = this.world.isWaterAt(wx, WATER_LEVEL - 0.1, wz);
    const surfY = hasWater ? Math.max(WATER_LEVEL, rawSurfY) : rawSurfY;
    this.position.set(wx, surfY + (this.inBuildMode ? 3.2 : 1.35), wz);
    this.hoverAnchorPos.copy(this.position);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.syncPhysicsSnapshot();
  }

  /**
   * Smoothly aims all mounted weapon turrets (PLASMA_CANNON, WEAPON_MINIGUN, WEAPON_ROCKET)
   * toward the camera crosshair raycast target in world space!
   */
  aimTurretsAt(
    targetWorld: THREE.Vector3 | null,
    dt = 0.016,
    bypassCameraCheck = false,
  ): void {
    if (!this.turretCameraAimEnabled && !bypassCameraCheck) {
      targetWorld = null;
    }
    if (targetWorld) {
      if (!this.aimTargetWorld) this.aimTargetWorld = new THREE.Vector3();
      this.aimTargetWorld.copy(targetWorld);
    } else {
      this.aimTargetWorld = null;
    }
    if (this.inBuildMode) return;

    const invRigQuat = _invRot.copy(this.quaternion).invert();
    for (const mod of this.modules) {
      const k = mod.kind;
      if (
        k !== 'PLASMA_CANNON' &&
        k !== 'WEAPON_MINIGUN' &&
        k !== 'WEAPON_ROCKET' &&
        k !== 'TURRET_RING' &&
        k !== 'SERVO_SPIN'
      ) {
        continue;
      }
      const pivot = (mod.mesh?.userData?.turretPivot ||
        (k === 'SERVO_SPIN' || k === 'TURRET_RING' ? mod.spinMesh : undefined)) as THREE.Object3D | undefined;
      if (!pivot || !mod.mesh) continue;

      if (!targetWorld) {
        pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, 0, Math.min(1, dt * 8));
        if (k !== 'SERVO_SPIN' && k !== 'TURRET_RING') {
          pivot.rotation.x = THREE.MathUtils.lerp(pivot.rotation.x, 0, Math.min(1, dt * 8));
        }
        mod.mesh.userData.aimWorldDir = null;
        continue;
      }

      _v1.set(
        (mod.vx + 0.5) * VOXEL_SIZE - this.comLocal.x,
        (mod.vy + 1.0) * VOXEL_SIZE - this.comLocal.y,
        (mod.vz + 0.5) * VOXEL_SIZE - this.comLocal.z,
      ).applyQuaternion(this.quaternion).add(this.position);
      _v2.copy(targetWorld).sub(_v1);
      if (_v2.lengthSq() < 0.25) continue;
      _v2.normalize();
      if (!mod.mesh.userData.aimWorldDir) {
        mod.mesh.userData.aimWorldDir = new THREE.Vector3();
      }
      (mod.mesh.userData.aimWorldDir as THREE.Vector3).copy(_v2);

      _q1
        .setFromEuler(
          _modEuler.set(
            ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
            ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
            ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
            'YXZ',
          ),
        )
        .invert();

      _v3
        .copy(_v2)
        .applyQuaternion(invRigQuat)
        .applyQuaternion(_q1)
        .normalize();

      const desiredYaw = Math.atan2(_v3.x, _v3.z);
      const horiz = Math.hypot(_v3.x, _v3.z);
      const desiredPitch = Math.max(
        -0.75,
        Math.min(0.55, -Math.atan2(_v3.y, Math.max(0.001, horiz))),
      );

      // Shortest angular step across +-PI wraparound for smooth 360-degree turret tracking
      let yawDiff = desiredYaw - pivot.rotation.y;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      pivot.rotation.y += yawDiff * Math.min(1, dt * 14.0);
      if (k !== 'SERVO_SPIN' && k !== 'TURRET_RING') {
        pivot.rotation.x = THREE.MathUtils.lerp(
          pivot.rotation.x,
          desiredPitch,
          Math.min(1, dt * 14.0),
        );
      }
    }
  }

  fireMountedCannons(_fx?: VoxelFXSystem): void {
    this.fireCannons();
  }

  fireCannons(): void {
    if (this.cannonCooldown > 0 || this.cannonCount === 0) return;
    const weaponMods = this.modules.filter(
      (m) =>
        m.kind === 'PLASMA_CANNON' ||
        m.kind === 'WEAPON_MINIGUN' ||
        m.kind === 'WEAPON_ROCKET' ||
        m.kind === 'WEAPON_BOMB_BAY',
    );
    if (weaponMods.length === 0) return;

    let minCooldown = 0.24;
    for (const mod of weaponMods) {
      if (mod.kind === 'WEAPON_MINIGUN') {
        minCooldown = Math.min(minCooldown, 0.08);
      } else if (mod.kind === 'WEAPON_ROCKET') {
        minCooldown = Math.min(minCooldown, 0.32);
      }
    }

    // Cap simultaneous projectiles per salvo to 14 (cycling round-robin when 50+ guns are mounted)
    // and play cannon audio ONCE per salvo so 50+ guns never overload AudioContext or frame time!
    const maxSalvoProjectiles = 14;
    const countToFire = Math.min(weaponMods.length, maxSalvoProjectiles);
    _v1.set(0, 0, 0);

    SoundFX.cannon();

    for (let s = 0; s < countToFire; s++) {
      const idx = (this.salvoCursor + s) % weaponMods.length;
      const mod = weaponMods[idx];
      const k = mod.kind;
      if (k === 'WEAPON_MINIGUN' && mod.spinMesh) {
        mod.spinMesh.rotation.z += 0.85;
      }

      _q1.setFromEuler(
        _modEuler.set(
          ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
          ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
          ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
          'YXZ',
        ),
      );
      const aimedDir = mod.mesh?.userData?.aimWorldDir as THREE.Vector3 | null | undefined;
      if (k === 'WEAPON_BOMB_BAY') {
        _v2.set(0, -1, 0.18).applyQuaternion(this.quaternion).normalize();
      } else if (aimedDir) {
        _v2.copy(aimedDir).normalize();
      } else {
        _v2.set(0, 0.035, 1)
          .applyQuaternion(_q1)
          .applyQuaternion(this.quaternion)
          .normalize();
      }

      this.localVoxelToWorld(
        mod.vx,
        mod.vy + (k === 'WEAPON_BOMB_BAY' ? -0.65 : 0.55),
        mod.vz + (k === 'WEAPON_BOMB_BAY' ? 0 : 1.2),
        _v3,
      ).addScaledVector(_v2, k === 'WEAPON_BOMB_BAY' ? 0.2 : 0.65);

      const projKind =
        k === 'WEAPON_MINIGUN'
          ? 'MINIGUN'
          : k === 'WEAPON_ROCKET'
            ? 'ROCKET'
            : k === 'WEAPON_BOMB_BAY'
              ? 'BOMB'
              : 'PLASMA';

      this.fx.fireWeaponProjectile(
        projKind,
        _v3,
        _v2,
        this.velocity,
        true,
        false,
        this,
      );

      const massScale = Math.min(1.0, 900 / Math.max(900, this.rigidBody.mass));
      const recoilStrength =
        (mod.config?.strength ?? 1.0) *
        massScale *
        (k === 'PLASMA_CANNON'
          ? 0.55
          : k === 'WEAPON_ROCKET'
            ? 0.48
            : k === 'WEAPON_MINIGUN'
              ? 0.14
              : 0.12);
      _v1.addScaledVector(_v2, -recoilStrength);
    }

    this.salvoCursor = (this.salvoCursor + countToFire) % weaponMods.length;
    _v1.clampLength(0, 6.0);
    this.velocity.add(_v1);
    this.cannonCooldown = weaponMods.length > maxSalvoProjectiles ? Math.min(minCooldown, 0.08) : minCooldown;
  }

  /**
   * Executes energy/mechanical melee strikes for all intact WEAPON_MELEE modules.
   * Transforms each blade's swing vector by its build rotation (pitchIdx, yawIdx, rollIdx)
   * so front, side, rear, or inverted blades all cleave enemy rigs and scatter lifeless props!
   */
  applyMeleeCombatStep(
    targets: readonly ModularVehicleRig[],
    forceStrike = false,
    friendlyTeam?: VehicleAITeam,
  ): number {
    if (this.inBuildMode || this.isVoxelEntity || this.meleeCooldown > 0) return 0;
    const speed = this.velocity.length();
    if (!forceStrike && speed < 3.2) return 0;

    let hits = 0;
    const activeMode = ModRegistry.getActiveGameMode();

    for (let mIdx = 0; mIdx < this.modules.length; mIdx++) {
      const mod = this.modules[mIdx];
      if (mod.kind !== 'WEAPON_MELEE' || (mod.health ?? 1.0) <= 0) continue;

      _q1.setFromEuler(
        _modEuler.set(
          ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
          ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
          ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
          'YXZ',
        ),
      );
      _v2
        .set(0, 0, 1)
        .applyQuaternion(_q1)
        .applyQuaternion(this.quaternion)
        .normalize();

      const baseWorld = this.localVoxelToWorld(mod.vx + 0.5, mod.vy + 0.5, mod.vz + 0.5, _v1);
      // Sample blade tip 1.15m forward along blade axis
      const tipX = baseWorld.x + _v2.x * 1.15;
      const tipY = baseWorld.y + _v2.y * 1.15;
      const tipZ = baseWorld.z + _v2.z * 1.15;
      const bladeRadius = forceStrike ? 1.85 : 1.45;
      const str = mod.config?.strength ?? 1.0;

      for (let tIdx = 0; tIdx < targets.length; tIdx++) {
        const other = targets[tIdx];
        if (!other || other === this || other.inBuildMode || other.voxelCount <= 0) continue;

        if (!other.isVoxelEntity && friendlyTeam) {
          const otherTeam: VehicleAITeam = other.isLocalPlayerOccupied
            ? 'PLAYER'
            : other.aiConfig.enabled
              ? other.aiConfig.team
              : 'PLAYER';
          if (!areAITeamsHostile(friendlyTeam, otherTeam)) continue;
        }

        // Broadphase radius around target rig
        const dx = other.position.x - tipX;
        const dy = other.position.y - tipY;
        const dz = other.position.z - tipZ;
        const reachBound =
          bladeRadius +
          Math.max(
            1.6,
            Math.hypot(
              ((other.maxVX - other.minVX) * VOXEL_SIZE) * 0.5,
              ((other.maxVZ - other.minVZ) * VOXEL_SIZE) * 0.5,
            ) + 0.8,
          );
        if (dx * dx + dy * dy + dz * dz > reachBound * reachBound) continue;

        // Verify narrowphase overlap against target voxel geometry or center proximity
        let hasSolidContact =
          other.getSolidVoxelMaterialAtWorld(tipX, tipY, tipZ) !== MAT.AIR ||
          other.getSolidVoxelMaterialAtWorld(
            tipX + _v2.x * 0.55,
            tipY + _v2.y * 0.55,
            tipZ + _v2.z * 0.55,
          ) !== MAT.AIR;
        if (!hasSolidContact) {
          const centerDistSq = dx * dx + dy * dy + dz * dz;
          const tightHitR = other.isVoxelEntity ? 1.6 : bladeRadius + 0.55;
          hasSolidContact = centerDistSq <= tightHitR * tightHitR;
        }
        if (!hasSolidContact) continue;

        const knockDir = _v3
          .set(
            other.position.x - this.position.x,
            0.35,
            other.position.z - this.position.z,
          );
        if (knockDir.lengthSq() < 0.01) knockDir.copy(_v2);
        knockDir.y = Math.max(0.25, knockDir.y);
        knockDir.normalize();

        if (other.isVoxelEntity) {
          const knockSpeed = Math.max(10.5, speed * 1.4) * str;
          other.velocity.addScaledVector(knockDir, knockSpeed);
          other.angularVelocity.x += (Math.random() - 0.5) * 8;
          other.angularVelocity.z += (Math.random() - 0.5) * 8;
          other.rigidBody.velocity.copy(other.velocity);
          other.rigidBody.angularVelocity.copy(other.angularVelocity);
          if (other.rigidBody.isSleeping) other.rigidBody.wake();
        } else {
          const craterRad = Math.max(2, Math.round((forceStrike ? 3 : 2) * activeMode.explosionMult));
          const impulseMag = Math.max(7.5, speed * 0.9) * str;
          other.carveVehicleCrater(tipX, tipY, tipZ, craterRad, impulseMag);
          other.velocity.addScaledVector(knockDir, Math.max(4.5, speed * 0.55) * str);
          other.rigidBody.velocity.copy(other.velocity);
          if (other.rigidBody.isSleeping) other.rigidBody.wake();
        }

        this.fx.spawnWeldSparks(tipX, tipY, tipZ);
        SoundFX.clank(Math.max(12, speed + 8));
        hits++;
      }
    }

    if (hits > 0 || forceStrike) {
      this.meleeCooldown = forceStrike ? 0.38 : 0.25;
      if (hits === 0 && forceStrike) {
        const fxPos = this.localVoxelToWorld(0, 1, 2, _v1);
        this.fx.spawnWeldSparks(fxPos.x, fxPos.y, fxPos.z);
        SoundFX.clank(10);
      }
    }
    return hits;
  }

  /**
   * Triggers Pyrotechnic Detachable Blocks [U] to cleave staging sections into independent physics fragments!
   */
  triggerDetachableBlocks(): number {
    const bolts = this.modules.filter((m) => m.kind === 'DETACHABLE_BLOCK');
    if (bolts.length === 0) return 0;
    const hadSeatBefore = this.hasIntactSeat();
    let cleaved = 0;
    const boltCenterWorld = new THREE.Vector3();
    for (const b of bolts) {
      const wp = this.localVoxelToWorld(b.vx, b.vy, b.vz);
      boltCenterWorld.add(wp);
      this.fx.spawnWeldSparks(wp.x, wp.y, wp.z);
      SoundFX.remove();
      // Clear adjacent bridge voxels around the pyrotechnic bolt so islands separate cleanly
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            this.setVoxel(b.vx + dx, b.vy + dy, b.vz + dz, MAT.AIR);
          }
        }
      }
      if (b.mesh) {
        this.modulesGroup.remove(b.mesh);
        disposeModuleGroupGeometries(b.mesh);
        b.mesh = null;
      }
      cleaved++;
    }
    boltCenterWorld.divideScalar(Math.max(1, bolts.length));
    this.modules = this.modules.filter((m) => m.kind !== 'DETACHABLE_BLOCK');

    const cockpitMod =
      this.modules.find((m) => isSeatModuleKind(m.kind)) || null;
    const { detachedIslands } = findDisconnectedVoxelIslands(
      this.voxelMap,
      cockpitMod,
    );
    for (const island of detachedIslands) {
      let sumX = 0,
        sumY = 0,
        sumZ = 0;
      const islandKeySet = new Set<string>();
      for (const [vx, vy, vz] of island) {
        this.setVoxel(vx, vy, vz, MAT.AIR);
        islandKeySet.add(`${vx},${vy},${vz}`);
        sumX += vx;
        sumY += vy;
        sumZ += vz;
      }
      this.detachedIslandsCount++;
      const avgVX = sumX / island.length;
      const avgVY = sumY / island.length;
      const avgVZ = sumZ / island.length;
      const islandCenterWorld = this.localVoxelToWorld(avgVX, avgVY, avgVZ);

      const severedModAttachments: Array<{ group: THREE.Group; localOffset: THREE.Vector3 }> = [];
      this.modules = this.modules.filter((m) => {
        let onMainHull = false;
        let onThisIsland = false;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const k = `${m.vx + dx},${m.vy + dy},${m.vz + dz}`;
              if (this.getVoxel(m.vx + dx, m.vy + dy, m.vz + dz) !== MAT.AIR) {
                onMainHull = true;
              }
              if (islandKeySet.has(k)) {
                onThisIsland = true;
              }
            }
          }
        }
        if (onThisIsland && !onMainHull) {
          const modMesh = m.mesh || this.createModuleMesh(m, false);
          if (modMesh.parent) modMesh.parent.remove(modMesh);
          m.mesh = null;
          severedModAttachments.push({
            group: modMesh,
            localOffset: new THREE.Vector3(
              (m.vx - avgVX) * VOXEL_SIZE,
              (m.vy - avgVY) * VOXEL_SIZE,
              (m.vz - avgVZ) * VOXEL_SIZE,
            ),
          });
          return false;
        }
        return true;
      });

      const rArm = islandCenterWorld.clone().sub(this.position);
      const rotVel = new THREE.Vector3().crossVectors(this.angularVelocity, rArm);
      const islandVel = this.velocity.clone().add(rotVel);
      const outward = islandCenterWorld.clone().sub(boltCenterWorld);
      if (outward.lengthSq() < 0.01) outward.set(0, 1, 0);
      else outward.normalize();
      outward.y = Math.max(0.35, outward.y + 0.35);
      outward.multiplyScalar(7.5);

      this.fx.spawnDetachedIslandFragment(
        islandCenterWorld,
        this.quaternion,
        island,
        islandVel,
        severedModAttachments,
        outward,
      );
    }
    this.rebuildVehicleGeometry();
    if (hadSeatBefore && !this.hasIntactSeat() && this.onSeatBroken) {
      this.onSeatBroken();
    }
    return cleaved;
  }

  /**
   * Toggles Hydraulic Pistons [X] to jack up the vehicle, jump obstacles, or self-right!
   * Strictly requires at least one intact PISTON module installed on the vehicle.
   */
  togglePistons(): boolean {
    const intactPistons = this.modules.filter(
      (m) => m.kind === 'PISTON' && (m.health ?? 1.0) > 0,
    ).length;
    if (this.pistonCount <= 0 || intactPistons <= 0) {
      this.pistonExtended = false;
      this.pistonExtRatio = 0;
      return false;
    }
    this.pistonExtended = !this.pistonExtended;
    SoundFX.hover();
    if (this.pistonExtended && !this.inBuildMode) {
      this.velocity.y += Math.min(8.5, 4.2 + intactPistons * 1.4);
      this.rigidBody.velocity.y = this.velocity.y;
    }
    return this.pistonExtended;
  }

  /**
   * Toggles Gyro Stabilizer [Y] ONLY if at least one intact GYRO or GYRO_REACTION module is installed.
   */
  toggleGyro(): boolean {
    const hasIntactGyro = this.modules.some(
      (m) =>
        (m.kind === 'GYRO' || m.kind === 'GYRO_REACTION') &&
        (m.health ?? 1.0) > 0,
    );
    if (this.gyroCount <= 0 || !hasIntactGyro) {
      this.gyroEnabled = false;
      return false;
    }
    this.gyroEnabled = !this.gyroEnabled;
    SoundFX.snap();
    return this.gyroEnabled;
  }

  /**
   * Detaches any active Grappling Winch cable and hides its 3D meshes.
   */
  releaseGrappleWinch(): void {
    this.winchAnchorWorld = null;
    this.winchTargetRig = null;
    if (this.winchLineMesh) this.winchLineMesh.visible = false;
    if (this.winchCableCylinderMesh) this.winchCableCylinderMesh.visible = false;
    if (this.winchHookMesh) this.winchHookMesh.visible = false;
  }

  /**
   * Returns the world position of the vehicle's primary Grappling Winch spool (or null if none installed).
   */
  getWinchSpoolWorldPos(): THREE.Vector3 {
    const winchMod = this.modules.find(
      (m) => m.kind === 'GRAPPLING_WINCH' && (m.health ?? 1.0) > 0,
    );
    if (winchMod) {
      return this.localVoxelToWorld(winchMod.vx, winchMod.vy + 0.2, winchMod.vz + 0.5);
    }
    return this.position.clone().add(new THREE.Vector3(0, 0.45, 0));
  }

  /**
   * Fires or releases the Grappling Tow Winch ([G] or [T] Key) to attach a taut 3D steel cable
   * to any terrain cliff OR another vehicle for spring-damper winching and towing!
   * Strictly requires at least one intact GRAPPLING_WINCH module installed on the vehicle.
   */
  toggleGrappleWinch(aimDir?: THREE.Vector3): boolean {
    if (this.winchAnchorWorld || this.winchTargetRig) {
      this.releaseGrappleWinch();
      SoundFX.snap();
      return false;
    }
    const winchMod = this.modules.find(
      (m) => m.kind === 'GRAPPLING_WINCH' && (m.health ?? 1.0) > 0,
    );
    if (this.winchCount <= 0 || !winchMod) {
      this.releaseGrappleWinch();
      return false;
    }
    const dir = aimDir
      ? aimDir.clone().normalize()
      : new THREE.Vector3(0, 0.15, 1).applyQuaternion(this.quaternion).normalize();
    const origin = this.localVoxelToWorld(
      winchMod.vx,
      winchMod.vy + 0.2,
      winchMod.vz + 0.5,
    );

    // Check if the grapple hook hits another vehicle first (for vehicle-to-vehicle towing!)
    let bestRigHit: { rig: ModularVehicleRig; worldPos: THREE.Vector3; dist: number } | null = null;
    for (const other of this.fx.rigs) {
      if (other === this || other.inBuildMode) continue;
      const rHit = other.raycastVehicle(origin, dir, 64);
      if (rHit && (!bestRigHit || rHit.distance < bestRigHit.dist)) {
        bestRigHit = { rig: other, worldPos: rHit.worldPos, dist: rHit.distance };
      }
    }

    const worldHit = this.world.raycastWorldVoxels(origin, dir, 64);

    if (bestRigHit && (!worldHit || bestRigHit.dist <= worldHit.distance)) {
      this.winchTargetRig = bestRigHit.rig;
      this.winchTargetLocalPos.copy(
        bestRigHit.rig.worldToLocalMetric(
          bestRigHit.worldPos.x,
          bestRigHit.worldPos.y,
          bestRigHit.worldPos.z,
        ),
      );
      this.winchAnchorWorld = bestRigHit.worldPos.clone();
      this.winchRestLength = Math.max(3.5, bestRigHit.dist * 0.45);
      this.winchLineMesh.visible = true;
      this.winchCableCylinderMesh.visible = true;
      this.winchHookMesh.visible = true;
      SoundFX.hover();
      this.fx.spawnWeldSparks(
        bestRigHit.worldPos.x,
        bestRigHit.worldPos.y,
        bestRigHit.worldPos.z,
      );
      return true;
    }

    if (worldHit) {
      this.winchTargetRig = null;
      this.winchAnchorWorld = worldHit.worldPos.clone();
      this.winchRestLength = Math.max(2.2, worldHit.distance * 0.25);
      this.winchLineMesh.visible = true;
      this.winchCableCylinderMesh.visible = true;
      this.winchHookMesh.visible = true;
      SoundFX.hover();
      this.fx.spawnWeldSparks(worldHit.worldPos.x, worldHit.worldPos.y, worldHit.worldPos.z);
      return true;
    }
    return false;
  }

  get winchActive(): boolean {
    return this.winchAnchorWorld !== null && this.winchCount > 0;
  }

  toggleWinch(_origin?: THREE.Vector3, aimDir?: THREE.Vector3): boolean {
    return this.toggleGrappleWinch(aimDir);
  }

  /**
   * Toggles Electromagnetic / Tractor-Beam Coupler (`MAGNET_COUPLER` [K] Attract / [L] Repel).
   */
  toggleMagnetCoupler(targetMode: 'ATTRACT' | 'REPEL' = 'ATTRACT'): 'OFF' | 'ATTRACT' | 'REPEL' {
    const hasMagnet = this.modules.some(
      (m) => m.kind === 'MAGNET_COUPLER' && (m.health ?? 1.0) > 0,
    );
    if (!hasMagnet) {
      this.magnetActiveMode = 'OFF';
      return 'OFF';
    }
    this.magnetActiveMode =
      this.magnetActiveMode === targetMode ? 'OFF' : targetMode;
    SoundFX.magnetPulse(this.magnetActiveMode === 'REPEL');
    return this.magnetActiveMode;
  }

  /**
   * Toggles Deployable Parachute & Airbrake (`PARACHUTE_AIRBRAKE` [U] Key).
   */
  toggleParachuteAirbrake(): boolean {
    const hasChute = this.modules.some(
      (m) => m.kind === 'PARACHUTE_AIRBRAKE' && (m.health ?? 1.0) > 0,
    );
    if (!hasChute) {
      this.parachuteDeployed = false;
      return false;
    }
    this.parachuteDeployed = !this.parachuteDeployed;
    SoundFX.parachuteDeploy();
    return this.parachuteDeployed;
  }

  /**
   * Toggles Hydraulic Outrigger Stabilizer Jacks (`OUTRIGGER_JACK` [J] Key).
   */
  toggleOutriggerJacks(): boolean {
    const hasJacks = this.modules.some(
      (m) => m.kind === 'OUTRIGGER_JACK' && (m.health ?? 1.0) > 0,
    );
    if (!hasJacks) {
      this.outriggersExtended = false;
      return false;
    }
    this.outriggersExtended = !this.outriggersExtended;
    SoundFX.hover();
    return this.outriggersExtended;
  }

  /**
   * Deploys Smoke Screen & Thermal Flare Countermeasures (`SMOKE_FLARE` [I] Key).
   */
  deploySmokeAndFlares(): boolean {
    if (this.countermeasureCooldown > 0) return false;
    const dispensers = this.modules.filter(
      (m) => m.kind === 'SMOKE_FLARE' && (m.health ?? 1.0) > 0,
    );
    if (dispensers.length === 0) return false;
    this.countermeasureCooldown = 2.8;
    const first = dispensers[0];
    const wp = this.localVoxelToWorld(first.vx, first.vy + 0.5, first.vz);
    this.fx.spawnSmokeScreenAndFlares(wp.x, wp.y, wp.z, this.velocity);
    return true;
  }

  /**
   * Renders a translucent cyan wireframe Ghost Reference Blueprint inside Build Mode so players can trace or compare builds.
   */
  setGhostReferenceBlueprint(bp: SerializedVehicleBlueprint | null): void {
    while (this.ghostBlueprintGroup.children.length > 0) {
      const ch = this.ghostBlueprintGroup.children[0];
      this.ghostBlueprintGroup.remove(ch);
      disposeModuleGroupGeometries(ch);
    }
    if (!bp) {
      this.ghostBlueprintGroup.visible = false;
      return;
    }
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    const maxBoxes = Math.min(800, bp.voxels.length);
    for (let i = 0; i < maxBoxes; i++) {
      const [vx, vy, vz] = bp.voxels[i];
      const m = new THREE.Mesh(_sharedUnitBoxGeo, wireMat);
      m.position.set(
        (vx + 0.5) * VOXEL_SIZE,
        (vy + 0.5) * VOXEL_SIZE,
        (vz + 0.5) * VOXEL_SIZE,
      );
      this.ghostBlueprintGroup.add(m);
    }
    this.ghostBlueprintGroup.visible = this.inBuildMode;
  }

  /**
   * Builds 3D Visual Quick-Wiring lines linking sensors/seats/logic gates to actuators sharing a channel or ECU port.
   */
  rebuildQuickWiringLines(): void {
    while (this.wiringLinesGroup.children.length > 0) {
      const ch = this.wiringLinesGroup.children[0];
      this.wiringLinesGroup.remove(ch);
      disposeModuleGroupGeometries(ch);
    }
    if (!this.showWiringOverlay || !this.inBuildMode) {
      this.wiringLinesGroup.visible = false;
      return;
    }

    const seats = this.modules.filter((m) => isSeatModuleKind(m.kind));
    const primarySeat = seats[0] || this.modules[0];
    if (!primarySeat) {
      this.wiringLinesGroup.visible = false;
      return;
    }

    const lineColors = [
      0x38bdf8, 0xf59e0b, 0x10b981, 0xf43f5e, 0xa855f7, 0xfacc15, 0xec4899, 0x06b6d4,
    ];

    for (let i = 0; i < this.modules.length; i++) {
      const mod = this.modules[i];
      if (mod === primarySeat) continue;
      const ch = mod.config?.channel ?? 0;
      const sourceMod =
        ch > 0
          ? this.modules.find(
              (s) =>
                s !== mod &&
                (s.config?.channel === ch || s.kind.startsWith('SENSOR_') || s.kind === 'LOGIC_GATE'),
            ) || primarySeat
          : primarySeat;

      const p0 = new THREE.Vector3(
        (sourceMod.vx + 0.5) * VOXEL_SIZE,
        (sourceMod.vy + 0.65) * VOXEL_SIZE,
        (sourceMod.vz + 0.5) * VOXEL_SIZE,
      );
      const p1 = new THREE.Vector3(
        (mod.vx + 0.5) * VOXEL_SIZE,
        (mod.vy + 0.65) * VOXEL_SIZE,
        (mod.vz + 0.5) * VOXEL_SIZE,
      );
      const geo = new THREE.BufferGeometry().setFromPoints([p0, p1]);
      const col = lineColors[ch % lineColors.length];
      const mat = new THREE.LineBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.82,
        depthTest: false,
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 995;
      this.wiringLinesGroup.add(line);
    }

    this.wiringLinesGroup.visible = true;
  }

  /**
   * Exports a selected group of blocks & modules (or the whole rig if none selected) as a reusable Sub-Assembly Prefab Stamp.
   */
  exportSubAssemblyPrefab(
    customName: string,
    selectedItems: SelectableBuildObject[],
  ): {
    id: string;
    name: string;
    createdAt: string;
    voxels: Array<[number, number, number, number]>;
    modules: PlacedModuleData[];
  } | null {
    const items =
      selectedItems.length > 0
        ? selectedItems
        : this.getAllSelectableBuildObjects();
    if (items.length === 0) return null;

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    for (const it of items) {
      if (it.vx < minX) minX = it.vx;
      if (it.vy < minY) minY = it.vy;
      if (it.vz < minZ) minZ = it.vz;
    }

    const voxels: Array<[number, number, number, number]> = [];
    const modules: PlacedModuleData[] = [];
    for (const it of items) {
      if (it.kind === 'voxel') {
        const mat = this.getVoxel(it.vx, it.vy, it.vz) || it.mat || MAT.ALLOY_BLUE;
        if (mat !== MAT.AIR) {
          voxels.push([it.vx - minX, it.vy - minY, it.vz - minZ, mat]);
        }
      } else if (it.kind === 'module' && it.moduleKind) {
        const liveMod = this.getModuleAt(it.vx, it.vy, it.vz);
        modules.push({
          kind: it.moduleKind,
          vx: it.vx - minX,
          vy: it.vy - minY,
          vz: it.vz - minZ,
          yawIdx: liveMod?.yawIdx ?? it.yawIdx ?? 0,
          pitchIdx: liveMod?.pitchIdx ?? it.pitchIdx ?? 0,
          rollIdx: liveMod?.rollIdx ?? it.rollIdx ?? 0,
          config: liveMod?.config ? { ...liveMod.config } : it.config,
        });
      }
    }

    return {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: customName.trim() || 'Sub-Assembly Pod',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      voxels,
      modules,
    };
  }

  /**
   * Stamps a saved Sub-Assembly Prefab at `(targetVx, targetVy, targetVz)` with full Undo support.
   */
  stampSubAssemblyPrefab(
    prefab: {
      voxels: Array<[number, number, number, number]>;
      modules: PlacedModuleData[];
    },
    targetVx: number,
    targetVy: number,
    targetVz: number,
  ): number {
    this.pushUndoSnapshot();
    let placed = 0;
    for (const [dx, dy, dz, mat] of prefab.voxels) {
      const nx = targetVx + dx;
      const ny = targetVy + dy;
      const nz = targetVz + dz;
      if (this.inBounds(nx, ny, nz)) {
        this.setVoxel(nx, ny, nz, mat);
        placed++;
      }
    }
    for (const m of prefab.modules) {
      const nx = targetVx + m.vx;
      const ny = targetVy + m.vy;
      const nz = targetVz + m.vz;
      if (this.inBounds(nx, ny, nz)) {
        this.addModule(
          m.kind,
          nx,
          ny,
          nz,
          m.yawIdx || 0,
          m.config ? { ...m.config } : undefined,
          m.pitchIdx || 0,
          m.rollIdx || 0,
        );
        placed++;
      }
    }
    if (placed > 0) {
      this.rebuildVehicleGeometry();
      this.saveIntactSnapshot();
      SoundFX.snap();
    }
    return placed;
  }

  /*
  syncVisualTransform_deprecated(): void {
    _v1.copy(this.comLocal).negate().applyQuaternion(this.quaternion);
    this.rootGroup.position.copy(this.position).add(_v1);
    this.rootGroup.quaternion.copy(this.quaternion);

    const ground = this.world.probeGroundBelow(
      this.position.x,
      this.position.y,
      this.position.z,
      2.0,
    );
    const hasWater = this.world.isWaterAt(this.position.x, WATER_LEVEL - 0.1, this.position.z);
    const floorY = hasWater ? Math.max(WATER_LEVEL, ground.y) : ground.y;
    this.contactShadowMesh.position.set(this.position.x, floorY + 0.02, this.position.z);
    const heightAboveFloor = Math.max(0, this.position.y - floorY);
    const shadowScale = Math.max(0.45, 1.15 - heightAboveFloor * 0.06);
    this.contactShadowMesh.scale.set(shadowScale, 1, shadowScale * 1.25);
    _v2.set(0, 0, 1).applyQuaternion(this.quaternion);
    _v3.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.contactShadowMesh.rotation.y = Math.atan2(_v2.x, _v2.z);

    // Update Forward Halogen Headlights (SpotLight + Subterranean Cave Fill PointLight)
    const showLights =
      this.headlightsOn &&
      !this.inBuildMode &&
      (this.voxelCount > 0 || this.modules.length > 0);
    this.headlightSpot.visible = showLights;
    this.headlightCaveFill.visible = showLights;
    if (showLights) {
      let headlightCount = 0;
      for (let i = 0; i < this.modules.length; i++) {
        if (this.modules[i].kind === 'HEADLIGHT') headlightCount++;
      }
      const boost = 1 + Math.min(4, headlightCount) * 0.35;
      this.headlightSpot.intensity = 5.5 * boost;
      this.headlightCaveFill.intensity = 3.4 * boost;

      this.headlightSpot.position
        .copy(this.position)
        .addScaledVector(_v2, 1.6)
        .addScaledVector(_v3, 0.45);
      this.headlightTarget.position
        .copy(this.position)
        .addScaledVector(_v2, 24.0)
        .addScaledVector(_v3, -1.0);
      this.headlightCaveFill.position
        .copy(this.position)
        .addScaledVector(_v2, 7.5)
        .addScaledVector(_v3, 0.9);
    }
  }
  */

  /**
   * Unbounded 3D Amanatides & Woo DDA raycaster against the vehicle's dynamically padded bounding box!
   */
  raycastVehicle(
    worldOrigin: THREE.Vector3,
    worldDir: THREE.Vector3,
    maxDist = 65.0,
  ): {
    target: 'vehicle';
    vx: number;
    vy: number;
    vz: number;
    mat: number;
    moduleHit?: ActiveModule;
    normal: Vec3;
    distance: number;
    worldPos: THREE.Vector3;
  } | null {
    if (this.voxelCount === 0 && this.modules.length === 0) return null;
    const pad = 4;
    const bMinX = this.minVX - pad;
    const bMinY = this.minVY - pad;
    const bMinZ = this.minVZ - pad;
    const bDimX = Math.max(4, this.maxVX + pad - bMinX + 1);
    const bDimY = Math.max(4, this.maxVY + pad - bMinY + 1);
    const bDimZ = Math.max(4, this.maxVZ + pad - bMinZ + 1);

    _invRot.copy(this.quaternion).invert();
    this.worldToLocalMetric(
      worldOrigin.x,
      worldOrigin.y,
      worldOrigin.z,
      _localOrigin,
    );
    // Shift ray origin into [0 .. bDim * VOXEL_SIZE] space for DDA
    _localOrigin.x -= bMinX * VOXEL_SIZE;
    _localOrigin.y -= bMinY * VOXEL_SIZE;
    _localOrigin.z -= bMinZ * VOXEL_SIZE;
    _localDir.copy(worldDir).applyQuaternion(_invRot).normalize();

    const getCell = (lx: number, ly: number, lz: number): number => {
      const vx = bMinX + lx;
      const vy = bMinY + ly;
      const vz = bMinZ + lz;
      const key = `${vx},${vy},${vz}`;
      // O(1) exact module or 3x3x3 module bounds lookup + chassis voxel check
      const modVal = this.moduleVoxelLookup.get(key);
      if (modVal !== undefined) {
        const modIdx = modVal - 100;
        if (modIdx >= 0 && modIdx < this.modules.length) {
          const mod = this.modules[modIdx];
          if (mod && mod.vx === vx && mod.vy === vy && mod.vz === vz) {
            return modVal;
          }
        }
      }
      const m = this.getVoxel(vx, vy, vz);
      if (m !== MAT.AIR) return m;
      if (modVal !== undefined) {
        const modIdx = modVal - 100;
        if (modIdx >= 0 && modIdx < this.modules.length) {
          return modVal;
        }
      }
      return 0;
    };

    const ddaHit = raycastVoxelGridDDA(
      { x: _localOrigin.x, y: _localOrigin.y, z: _localOrigin.z },
      { x: _localDir.x, y: _localDir.y, z: _localDir.z },
      bDimX,
      bDimY,
      bDimZ,
      VOXEL_SIZE,
      getCell,
      maxDist,
    );

    if (!ddaHit) return null;

    const realVX = bMinX + ddaHit.vx;
    const realVY = bMinY + ddaHit.vy;
    const realVZ = bMinZ + ddaHit.vz;
    const worldPos = this.localVoxelToWorld(realVX, realVY, realVZ);

    if (ddaHit.val >= 100) {
      const modIdx = ddaHit.val - 100;
      const mod = (modIdx >= 0 && modIdx < this.modules.length) ? this.modules[modIdx] : undefined;
      if (mod) {
        return {
          target: 'vehicle',
          vx: realVX,
          vy: realVY,
          vz: realVZ,
          mat: MAT.ALLOY_BLUE,
          moduleHit: mod,
          normal: ddaHit.normal,
          distance: ddaHit.distance,
          worldPos,
        };
      }
    }

    const safeMat = (ddaHit.val >= 100 || ddaHit.val === MAT.AIR) ? MAT.ALLOY_BLUE : ddaHit.val;
    return {
      target: 'vehicle',
      vx: realVX,
      vy: realVY,
      vz: realVZ,
      mat: safeMat,
      normal: ddaHit.normal,
      distance: ddaHit.distance,
      worldPos,
    };
  }

  /**
   * Raycasts the vehicle, or if dragging in BOX_FILL / LINE_DRAG mode and the cursor leaves the hull
   * into open air (up, down, left, right, anywhere!), projects onto a 3D drag plane through dragStartVoxel!
   */
  raycastBuildOrDragPlane(
    worldOrigin: THREE.Vector3,
    worldDir: THREE.Vector3,
    dragStartVoxel: { vx: number; vy: number; vz: number } | null,
    dragPlaneNormal: Vec3 = { x: 0, y: 1, z: 0 },
  ): {
    target: 'vehicle';
    vx: number;
    vy: number;
    vy_unused?: number;
    vz: number;
    mat: number;
    moduleHit?: ActiveModule;
    normal: Vec3;
    distance: number;
    worldPos: THREE.Vector3;
  } | null {
    const directHit = this.raycastVehicle(worldOrigin, worldDir, 65.0);
    if (directHit) return directHit;
    if (!dragStartVoxel) return null;

    _invRot.copy(this.quaternion).invert();
    this.worldToLocalMetric(
      worldOrigin.x,
      worldOrigin.y,
      worldOrigin.z,
      _localOrigin,
    );
    _localDir.copy(worldDir).applyQuaternion(_invRot).normalize();

    const planeVox = computeRayDragPlaneVoxel(
      { x: _localOrigin.x, y: _localOrigin.y, z: _localOrigin.z },
      { x: _localDir.x, y: _localDir.y, z: _localDir.z },
      dragStartVoxel,
      dragPlaneNormal,
      VOXEL_SIZE,
    );
    if (!planeVox || !this.inBounds(planeVox.vx, planeVox.vy, planeVox.vz)) {
      return null;
    }

    return {
      target: 'vehicle',
      vx: planeVox.vx,
      vy: planeVox.vy,
      vz: planeVox.vz,
      mat: MAT.ALLOY_BLUE,
      normal: { x: 0, y: 0, z: 0 },
      distance: 12.0,
      worldPos: this.localVoxelToWorld(planeVox.vx, planeVox.vy, planeVox.vz),
    };
  }

  /**
   * Cached, zero-GC Trailmakers-style 3D Ghost Preview supporting all 6 Placement Modes and 3-Axis Rotation!
   */
  updateBuildGhost(
    hit: { vx: number; vy: number; vz: number; normal: Vec3 } | null,
    slotItem: BuildSlotItem | undefined,
    placementMode: BuildPlacementMode,
    dragStartVoxel: { vx: number; vy: number; vz: number } | null = null,
  ): void {
    if (!this.inBuildMode || !hit || !slotItem) {
      if (this.ghostGroup.visible) {
        this.ghostGroup.visible = false;
        this.lastGhostSignature = '';
      }
      return;
    }

    const sig = `${hit.vx},${hit.vy},${hit.vz}:${hit.normal.x},${hit.normal.y},${hit.normal.z}:${slotItem.slot}:${placementMode}:${this.mirrorMode}:${this.partYawIndex}:${this.partPitchIndex}:${this.partRollIndex}:${
      dragStartVoxel ? `${dragStartVoxel.vx},${dragStartVoxel.vy},${dragStartVoxel.vz}` : 'none'
    }`;

    if (sig === this.lastGhostSignature && this.ghostGroup.visible) {
      return; // Zero-GC fast path: nothing changed since last frame!
    }
    this.lastGhostSignature = sig;

    while (this.ghostGroup.children.length > 0) {
      const child = this.ghostGroup.children[0];
      this.ghostGroup.remove(child);
      disposeModuleGroupGeometries(child);
    }

    const isPaintTool =
      placementMode === 'PAINT_TOOL' || placementMode === 'FLOOD_PAINT';
    const nx = isPaintTool ? hit.vx : hit.vx + hit.normal.x;
    const ny = isPaintTool ? hit.vy : hit.vy + hit.normal.y;
    const nz = isPaintTool ? hit.vz : hit.vz + hit.normal.z;
    if (!this.inBounds(nx, ny, nz)) {
      this.ghostGroup.visible = false;
      return;
    }

    this.ghostGroup.visible = true;

    // Update ghost box material color to match selected slot's color
    if (slotItem.mat && MAT_INFO[slotItem.mat]) {
      _sharedGhostBoxMat.color.setHex(MAT_INFO[slotItem.mat].color);
    } else {
      _sharedGhostBoxMat.color.set(slotItem.color || '#38bdf8');
    }

    // Trailmakers yellow weld connection pin on the clicked face
    const weldCenterX = (hit.vx + 0.5 + hit.normal.x * 0.5) * VOXEL_SIZE;
    const weldCenterY = (hit.vy + 0.5 + hit.normal.y * 0.5) * VOXEL_SIZE;
    const weldCenterZ = (hit.vz + 0.5 + hit.normal.z * 0.5) * VOXEL_SIZE;

    const pin = new THREE.Mesh(_sharedPinGeo, _sharedWeldMat);
    pin.position.set(weldCenterX, weldCenterY, weldCenterZ);
    if (hit.normal.x !== 0) pin.rotation.z = Math.PI / 2;
    if (hit.normal.z !== 0) pin.rotation.x = Math.PI / 2;
    this.ghostGroup.add(pin);

    if (slotItem.type === 'voxel' || isPaintTool) {
      const coords =
        placementMode === 'FLOOD_PAINT'
          ? computeFloodFillPaintCoords(
              hit.vx,
              hit.vy,
              hit.vz,
              (vx, vy, vz) => this.getVoxel(vx, vy, vz),
              this.mirrorMode,
              250,
            )
          : placementMode === 'FACE_EXTRUDE'
            ? computeFaceExtrudeCoords(
                hit,
                (vx, vy, vz) => this.getVoxel(vx, vy, vz),
                this.mirrorMode,
                160,
              )
            : computePlacementVoxelCoords(
                placementMode,
                hit,
                dragStartVoxel,
                this.mirrorMode,
                false,
                this.partYawIndex,
                this.partPitchIndex,
                this.partRollIndex,
              );
      for (let i = 0; i < coords.length; i++) {
        const pt = coords[i];
        if (!this.inBounds(pt.vx, pt.vy, pt.vz)) continue;
        if (isPaintTool && this.getVoxel(pt.vx, pt.vy, pt.vz) === MAT.AIR) continue;
        const box = new THREE.Mesh(_sharedUnitBoxGeo, _sharedGhostBoxMat);
        if (isPaintTool) {
          box.scale.set(1.04, 1.04, 1.04);
        }
        box.position.set(
          (pt.vx + 0.5) * VOXEL_SIZE,
          (pt.vy + 0.5) * VOXEL_SIZE,
          (pt.vz + 0.5) * VOXEL_SIZE,
        );
        this.ghostGroup.add(box);
      }
    } else if (slotItem.type === 'module' && slotItem.kind) {
      const previewMod: ActiveModule = {
        kind: slotItem.kind,
        vx: nx,
        vy: ny,
        vz: nz,
        yawIdx: this.partYawIndex,
        pitchIdx: this.partPitchIndex,
        rollIdx: this.partRollIndex,
        mesh: null,
        wheelMesh: null,
        spinMesh: null,
        lastCompression: 0,
      };
      const ghostMesh = this.createModuleMesh(previewMod, true);

      const arrowCone = new THREE.Mesh(_sharedArrowConeGeo, _sharedArrowMat);
      arrowCone.rotation.x = Math.PI / 2;
      arrowCone.position.set(0, 0.42, 0.38);
      ghostMesh.add(arrowCone);

      this.ghostGroup.add(ghostMesh);

      const isCenterSeat =
        slotItem.kind === 'COCKPIT' ||
        slotItem.kind === 'SEAT_KART' ||
        slotItem.kind === 'SEAT_MOTO' ||
        slotItem.kind === 'SEAT_OPERATOR' ||
        slotItem.kind === 'SEAT_ARMORED' ||
        slotItem.kind === 'SEAT_DIVING' ||
        slotItem.kind === 'SEAT_SPACE' ||
        slotItem.kind === 'SEAT_SHIP_WHEEL';
      if (this.mirrorMode && !isCenterSeat) {
        const mx = SYMMETRY_CENTER_X * 2 - 1 - nx;
        if (mx !== nx && this.inBounds(mx, ny, nz)) {
          const mirrorMod: ActiveModule = {
            ...previewMod,
            vx: mx,
          };
          this.ghostGroup.add(this.createModuleMesh(mirrorMod, true));
        }
      }
    }
  }

  /**
   * Evaluates a placed module's custom bound Positive/Negative keys + Logic Bus Channel (1..8)
   */
  private evalModSignal(
    mod: ActiveModule,
    keys: Record<string, boolean>,
    hasPilot: boolean,
    defaultPosKey?: string,
    defaultNegKey?: string,
  ): number {
    let val = 0;
    const cfg = mod.config;
    const ch = cfg?.channel ?? 0;
    if (ch >= 1 && ch <= 8 && this.logicChannelSignals[ch]) {
      val += 1.0;
    }
    if (!hasPilot) return Math.max(-1, Math.min(1, val));

    const pk = cfg?.posKey ?? defaultPosKey;
    const nk = cfg?.negKey ?? defaultNegKey;
    if (pk && pk !== 'NONE' && keys[pk]) val += 1.0;
    if (nk && nk !== 'NONE' && keys[nk]) val -= 1.0;

    // Also apply proportional mobile/touch OR smart AI inputs when using standard drive/steer/pitch axes
    const isAiDriver = !this.isLocalPlayerOccupied && this.aiConfig.enabled;
    const analogThrottle = isAiDriver ? this.aiThrottleInput : this.touchThrottleInput;
    const analogSteer = isAiDriver ? this.aiSteerInput : this.touchSteerInput;
    const analogPitch = isAiDriver ? this.aiPitchInput : this.touchPitchInput;

    if (pk === 'KeyW' && nk === 'KeyS') {
      if (isAiDriver) {
        val = analogThrottle;
      } else if (
        Math.abs(analogThrottle) > 0.01 &&
        Math.abs(analogThrottle) > Math.abs(val)
      ) {
        val = analogThrottle;
      }
    } else if (pk === 'KeyA' && nk === 'KeyD') {
      if (isAiDriver) {
        val = analogSteer;
      } else if (
        Math.abs(analogSteer) > 0.01 &&
        Math.abs(analogSteer) > Math.abs(val)
      ) {
        val = analogSteer;
      }
    } else if (pk === 'KeyI' && nk === 'KeyK') {
      if (isAiDriver) {
        val = analogPitch;
      } else if (
        Math.abs(analogPitch) > 0.01 &&
        Math.abs(analogPitch) > Math.abs(val)
      ) {
        val = analogPitch;
      }
    }

    return Math.max(-1, Math.min(1, val));
  }

  /**
   * Semi-Implicit Rigid-Body Physics Solver with Decoupled Suspensions, Steering Hinges,
   * True 2-Wheeler Tipping, Active Gyros, and Automation Logic Channels!
   */
  updatePhysics(
    dt: number,
    keys: Record<string, boolean>,
    isSeatedDriver: boolean,
    isAiPiloted = false,
  ): void {
    dt = Math.min(dt, 0.033);
    // #5 — Flush any 1-frame deferred collision-hull & mass rebuild from a prior frame's bullet/explosion impact
    if (this.pendingPhysicsHullRebuild) {
      this.flushPendingPhysicsHullRebuild();
    }

    // Fast O(1) PropRigidBody path at the VERY TOP of updatePhysics for dynamic/static Voxel Entities
    // (skips all vehicle ECU, sensor, module, per-voxel AABB, and smoke loops!)
    if (this.isVoxelEntity && this.propRigidBody) {
      if (this.fallingOffVoxels.size > 0) {
        updateFallingOffVoxels(this, dt, this.fx?.voxelDebrisSystem);
      }
      if (
        this.velocity.lengthSq() > 0.001 ||
        this.angularVelocity.lengthSq() > 0.001 ||
        this.fallingOffVoxels.size > 0 ||
        this.ignitedC4Voxels.size > 0
      ) {
        if (this.rigidBody.isSleeping) {
          this.rigidBody.wake();
        }
      }

      const prop = this.propRigidBody;
      const isShared = prop.position === this.rigidBody.position;
      if (!isShared) {
        prop.position.copy(this.rigidBody.position);
        prop.quaternion.copy(this.rigidBody.quaternion);
        prop.velocity.copy(this.rigidBody.velocity);
        prop.angularVelocity.copy(this.rigidBody.angularVelocity);
        prop.isSleeping = this.rigidBody.isSleeping;
      }

      stepPropRigidBody(
        prop,
        dt,
        (wx, wy, wz) => {
          return this.probeGroundAndVehiclesBelow(wx, wy + 0.15, wz, 0.45).y;
        },
        (wx, wy, wz) => {
          const ceil = this.world.probeCeilingAbove(wx, wy - 0.15, wz, 0.5);
          return ceil ? ceil.y : null;
        },
      );

      if (!isShared) {
        this.rigidBody.position.copy(prop.position);
        this.rigidBody.quaternion.copy(prop.quaternion);
        this.rigidBody.velocity.copy(prop.velocity);
        this.rigidBody.angularVelocity.copy(prop.angularVelocity);
        this.rigidBody.isSleeping = prop.isSleeping;
      }
      this.rigidBody.sleepTimer = prop.sleepTimer;
      this.speedKmh = this.velocity.length() * 3.6;

      const rad = prop.boundingRadius + 0.25;
      this.aabbMin.set(
        this.position.x - rad,
        this.position.y - rad,
        this.position.z - rad,
      );
      this.aabbMax.set(
        this.position.x + rad,
        this.position.y + rad,
        this.position.z + rad,
      );

      this.syncToVoxelWorld();
      return;
    }

    if (this.cannonCooldown > 0) {
      this.cannonCooldown = Math.max(0, this.cannonCooldown - dt);
    }
    if (this.meleeCooldown > 0) {
      this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    }
    if (this.skidCooldown > 0) {
      this.skidCooldown = Math.max(0, this.skidCooldown - dt);
    }
    if (this.crashCooldown > 0) {
      this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    }

    // Emit rising dark smoke and embers from blocks with < 50% structural integrity (capped at 10s burn so FPS never degrades forever)
    if (
      !this.isVoxelEntity &&
      this.damagedVoxelsList.length > 0 &&
      this.smokeBurnRemainingSec > 0
    ) {
      this.smokeBurnRemainingSec = Math.max(0, this.smokeBurnRemainingSec - dt);
      this.smokeEmitTimer += dt;
      if (this.smokeEmitTimer >= 0.055) {
        this.smokeEmitTimer = 0;
        const emitCalls = Math.min(2, this.damagedVoxelsList.length);
        for (let i = 0; i < emitCalls; i++) {
          const idx = Math.floor(Math.random() * this.damagedVoxelsList.length);
          const dv = this.damagedVoxelsList[idx];
          const wp = this.localVoxelToWorld(dv.vx, dv.vy, dv.vz);
          this.fx.spawnStructuralSmoke(wp.x, wp.y + 0.14, wp.z);
        }
      }
    }

    if (this.inBuildMode) {
      this.hoverTime += dt * 2.4;
      this.position.x = this.hoverAnchorPos.x;
      this.position.z = this.hoverAnchorPos.z;
      this.position.y = this.hoverAnchorPos.y + Math.sin(this.hoverTime) * 0.05;
      this.symmetryPlane.visible = this.mirrorMode;
      this.statusLabel = 'HOVERING (BUILD)';
      this.speedKmh = 0;
      this.isBoostingNow = false;
      this.syncToVoxelWorld();
      return;
    }

    if (this.isRemoteControlled) {
      const spd = this.rigidBody.velocity.length();
      this.speedKmh = Math.round(spd * 3.6);
      this.altitudeMeters = Number((this.rigidBody.position.y - WATER_LEVEL).toFixed(1));
      this.statusLabel = 'REMOTE PILOT';

      // Articulate remote wheel suspension compression over local terrain & spin wheels smoothly
      _forward.set(0, 0, 1).applyQuaternion(this.quaternion);
      const fwdSpd = this.velocity.dot(_forward);
      for (const mod of this.modules) {
        if (!mod.wheelMesh) continue;
        const isMonster = mod.kind === 'WHEEL_MONSTER';
        const isDrag = mod.kind === 'WHEEL_DRAG';
        const isKart = mod.kind === 'WHEEL_KART';
        const wheelRadius = isMonster
          ? 0.92
          : isDrag
            ? 0.54
            : isKart
              ? 0.34
              : 0.48;
        const restLen = isMonster ? 1.15 : isKart ? 0.65 : 0.85;
        const wp = this.localVoxelToWorld(mod.vx, mod.vy, mod.vz);
        const gnd = this.world.probeGroundBelow(
          wp.x,
          wp.y + 0.35,
          wp.z,
          restLen + wheelRadius + 0.5,
        );
        const dist = wp.y - gnd.y;
        const maxReach = restLen + wheelRadius;
        if (dist < maxReach) {
          const comp = Math.max(0, Math.min(restLen * 0.72, maxReach - dist));
          mod.lastCompression = comp;
          mod.wheelMesh.position.y = -(restLen - comp) * 0.78;
        } else {
          mod.lastCompression = 0;
          mod.wheelMesh.position.y = -restLen * 0.78;
        }
      }

      const inferredThrottle = Math.min(1, spd / 18);
      this.updateVehicleVisuals(
        dt,
        fwdSpd >= -0.5 ? inferredThrottle : -inferredThrottle,
        this.isBoostingNow,
      );
      this.syncToVoxelWorld();
      return;
    }

    // If the player is seated in the vehicle but no intact seat module remains, immediately eject!
    if (isSeatedDriver && !this.hasIntactSeat()) {
      isSeatedDriver = false;
      if (this.onSeatBroken) {
        this.onSeatBroken();
      }
    }

    // AI can pilot even damaged / seat-less / unconventional creations!
    const hasPilot = isSeatedDriver || (isAiPiloted && !this.isVoxelEntity);

    // --- PASS 1: EVALUATE SENSORS & LOGIC GATES INTO 8-CHANNEL SIGNAL BUS ---
    this.logicChannelSignals.fill(false);
    const rawChannelInputs: number[] = new Array(9).fill(0);
    for (const mod of this.modules) {
      const k = mod.kind;
      const ch = mod.config?.channel ?? 1;
      const thresh = mod.config?.threshold ?? 15;
      if (k === 'SENSOR_SPEED') {
        if (this.speedKmh >= thresh) rawChannelInputs[ch]++;
      } else if (k === 'SENSOR_ALTIMETER') {
        if (this.altitudeMeters >= thresh) rawChannelInputs[ch]++;
      } else if (k === 'SENSOR_ANGLE') {
        if (Math.hypot(this.pitchDeg, this.rollDeg) >= thresh) rawChannelInputs[ch]++;
      } else if (k === 'SENSOR_POSITION') {
        if (Math.hypot(this.position.x, this.position.z) >= thresh) rawChannelInputs[ch]++;
      } else if (k === 'SENSOR_DISTANCE') {
        const origin = this.localVoxelToWorld(mod.vx, mod.vy, mod.vz);
        const gnd = this.world.probeGroundBelow(origin.x, origin.y, origin.z, thresh);
        if (origin.y - gnd.y <= thresh) rawChannelInputs[ch]++;
      } else if (k === 'RADIO_TRX') {
        const pk = mod.config?.posKey ?? 'KeyF';
        if (hasPilot && keys[pk]) rawChannelInputs[ch]++;
      }
    }
    for (let ch = 1; ch <= 8; ch++) {
      this.logicChannelSignals[ch] = rawChannelInputs[ch] > 0;
    }
    for (const mod of this.modules) {
      if (mod.kind !== 'LOGIC_GATE') continue;
      const ch = mod.config?.channel ?? 1;
      const gate = mod.config?.gateType ?? 'OR';
      const count = rawChannelInputs[ch];
      if (gate === 'OR') this.logicChannelSignals[ch] = count >= 1;
      else if (gate === 'AND') this.logicChannelSignals[ch] = count >= 2;
      else if (gate === 'XOR') this.logicChannelSignals[ch] = count === 1;
      else if (gate === 'NAND') this.logicChannelSignals[ch] = count < 2;
      else if (gate === 'NOR') this.logicChannelSignals[ch] = count === 0;
    }

    let throttle = 0;
    let steerInput = 0;
    let pitchInput = 0;
    let rollInput = 0;
    let collectiveInput = 0;
    let brakeInput = false;

    // --- EVALUATE PROGRAMMABLE MICRO:BIT ECU LOGIC SYSTEM (HARDWARE-GATED) ---
    const ecuMod = this.modules.find((m) => m.kind === 'MICROBIT_ECU');
    let ecuBrakeOverride = false;
    let ecuThrottleOverride: number | null = null;
    let ecuWeaponFireTrigger = false;

    if (ecuMod) {
      const ecuKey = this.activeEcuId || 'ECU_1';
      const ecuProg =
        this.ecuPrograms[ecuKey] ||
        Object.values(this.ecuPrograms)[0] ||
        ECU_STARTER_TEMPLATES.AUTO_BRAKE.program;

      if (this.hardwarePorts.length === 0) {
        this.computeHardwarePorts();
      }

      const sensorCtx: SensorTelemetryContext = {
        distances: {},
        imus: {},
        speedos: {},
        radars: {},
        keys,
        dt,
      };

      for (const p of this.hardwarePorts) {
        const mod = this.modules[p.modIndex];
        const isIntact = mod && (mod.health ?? 1.0) > 0;
        p.hasSignal = Boolean(isIntact);

        if (p.type === 'DIST') {
          if (isIntact) {
            _v1.set(
              (mod.vx + 0.5) * VOXEL_SIZE - this.comLocal.x,
              (mod.vy + 0.5) * VOXEL_SIZE - this.comLocal.y,
              (mod.vz + 0.5) * VOXEL_SIZE - this.comLocal.z,
            ).applyQuaternion(this.quaternion).add(this.position);
            _q1.setFromEuler(
              _modEuler.set(
                ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
                ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
                ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
                'YXZ',
              ),
            );
            _v2.set(0, 0, 1)
              .applyQuaternion(_q1)
              .applyQuaternion(this.quaternion)
              .normalize();
            const wHit = this.world.raycastWorldVoxels(_v1, _v2, 50.0);
            let d = wHit ? wHit.distance : 50.0;
            for (const other of this.fx.rigs) {
              if (other !== this && !other.inBuildMode) {
                const rHit = other.raycastVehicle(_v1, _v2, d);
                if (rHit && rHit.distance < d) d = rHit.distance;
              }
            }
            p.liveValue = Number(d.toFixed(1));
            sensorCtx.distances[p.id] = { distanceMeters: d, hasSignal: true };
          } else {
            p.liveValue = 0;
            sensorCtx.distances[p.id] = { distanceMeters: 0, hasSignal: false };
          }
        } else if (p.type === 'IMU') {
          if (isIntact) {
            p.liveValue = Number(this.pitchDeg.toFixed(1));
            sensorCtx.imus[p.id] = { pitchDeg: this.pitchDeg, rollDeg: this.rollDeg, hasSignal: true };
          } else {
            p.liveValue = 0;
            sensorCtx.imus[p.id] = { pitchDeg: 0, rollDeg: 0, hasSignal: false };
          }
        } else if (p.type === 'SPEED') {
          if (isIntact) {
            p.liveValue = this.speedKmh;
            sensorCtx.speedos[p.id] = { speedKmh: this.speedKmh, altitudeMeters: this.altitudeMeters, hasSignal: true };
          } else {
            p.liveValue = 0;
            sensorCtx.speedos[p.id] = { speedKmh: 0, altitudeMeters: 0, hasSignal: false };
          }
        } else if (p.type === 'RADAR') {
          if (isIntact) {
            let nearestDist = 100.0;
            let nearestAngle = 0;
            const origin = this.position;
            _v1.set(0, 0, 1).applyQuaternion(this.quaternion).normalize();
            for (const other of this.fx.rigs) {
              if (other !== this && !other.inBuildMode) {
                _v2.copy(other.position).sub(origin);
                const d = _v2.length();
                if (d < nearestDist && d > 1.0) {
                  nearestDist = d;
                  _v2.normalize();
                  const crossY = _v1.x * _v2.z - _v1.z * _v2.x;
                  const dot = _v1.dot(_v2);
                  nearestAngle = (Math.atan2(crossY, dot) * 180) / Math.PI;
                }
              }
            }
            p.liveValue = Number(nearestDist.toFixed(1));
            sensorCtx.radars[p.id] = {
              targetAngleDeg: Number(nearestAngle.toFixed(1)),
              targetDistanceMeters: Number(nearestDist.toFixed(1)),
              hasSignal: true,
            };
          } else {
            p.liveValue = 0;
            sensorCtx.radars[p.id] = { targetAngleDeg: 0, targetDistanceMeters: 0, hasSignal: false };
          }
        }
      }

      const ecuOutput = evaluateEcuProgram(ecuProg, sensorCtx);
      this.lastEcuOutput = ecuOutput;

      // Dynamic 5x5 LED matrix display update on the Micro:bit mesh
      updateEcuLedMatrixDisplay(ecuMod.mesh, ecuOutput.ledMatrixIcon);

      // Actuator overrides:
      for (const [portId, on] of Object.entries(ecuOutput.headlights)) {
        if (portId === 'ALL_HEADLIGHTS' || portId.startsWith('HEADLIGHT')) {
          this.setHeadlights(on);
        }
      }
      for (const [portId, fire] of Object.entries(ecuOutput.fireWeapons)) {
        if (fire) {
          ecuWeaponFireTrigger = true;
          break;
        }
      }
      if (this.pistonCount > 0) {
        for (const [_portId, ext] of Object.entries(ecuOutput.pistons)) {
          this.pistonExtRatio = Math.max(this.pistonExtRatio, ext);
        }
      }
      for (const [portId, ang] of Object.entries(ecuOutput.hinges)) {
        const hp = this.hardwarePorts.find((p) => p.id === portId);
        if (hp) {
          const hMod = this.modules[hp.modIndex];
          if (hMod?.spinMesh) {
            hMod.spinMesh.rotation.y = (ang * Math.PI) / 180;
          }
        }
      }
      const thrustEntries = Object.entries(ecuOutput.thrusters);
      if (thrustEntries.length > 0) {
        const val =
          ecuOutput.thrusters['ALL_THRUSTERS'] !== undefined
            ? ecuOutput.thrusters['ALL_THRUSTERS']
            : thrustEntries[thrustEntries.length - 1][1];
        if (val === 0) {
          ecuBrakeOverride = true;
          ecuThrottleOverride = 0;
        } else {
          ecuThrottleOverride = val;
        }
      }
    }

    if (isSeatedDriver) {
      if (keys['KeyW']) throttle += 1.0;
      if (keys['KeyS']) throttle -= 0.9;
      if (keys['KeyA']) steerInput += 1.0;
      if (keys['KeyD']) steerInput -= 1.0;

      if (Math.abs(this.touchThrottleInput) > 0.01) {
        throttle = Math.max(-1.0, Math.min(1.0, throttle + this.touchThrottleInput));
      }
      if (Math.abs(this.touchSteerInput) > 0.01) {
        steerInput = Math.max(-1.0, Math.min(1.0, steerInput + this.touchSteerInput));
      }
      if (Math.abs(this.touchPitchInput) > 0.01) {
        pitchInput = Math.max(-1.0, Math.min(1.0, pitchInput + this.touchPitchInput));
      }

      if (keys['KeyI'] || keys['ArrowUp']) pitchInput += 1.0;
      if (keys['KeyK'] || keys['ArrowDown']) pitchInput -= 1.0;
      if (keys['KeyJ'] || keys['ArrowLeft']) rollInput -= 1.0;
      if (keys['KeyL'] || keys['ArrowRight']) rollInput += 1.0;

      if (keys['Space']) {
        if (this.vtolCount > 0) collectiveInput += 1.0;
        else brakeInput = true;
      }
      if (keys['ControlLeft'] || keys['KeyQ']) collectiveInput -= 1.0;
    } else if (isAiPiloted && !this.isVoxelEntity) {
      throttle = Math.max(-1.25, Math.min(1.25, this.aiThrottleInput));
      steerInput = Math.max(-1.0, Math.min(1.0, this.aiSteerInput));
      pitchInput = Math.max(-1.0, Math.min(1.0, this.aiPitchInput));
      rollInput = Math.max(-1.0, Math.min(1.0, this.aiRollInput));
      collectiveInput = Math.max(-1.0, Math.min(1.0, this.aiCollectiveInput));
      brakeInput = this.aiBrakeInput;
    }

    if (ecuThrottleOverride !== null) {
      throttle = ecuThrottleOverride;
    }
    if (ecuBrakeOverride) {
      brakeInput = true;
    }
    if (ecuWeaponFireTrigger) {
      this.fireCannons();
    }

    // Fire weapons or detachable bolts strictly when their configured module keybind or logic channel is active
    for (const mod of this.modules) {
      if (
        mod.kind === 'PLASMA_CANNON' ||
        mod.kind === 'WEAPON_MINIGUN' ||
        mod.kind === 'WEAPON_ROCKET' ||
        mod.kind === 'WEAPON_BOMB_BAY'
      ) {
        if (this.evalModSignal(mod, keys, hasPilot, 'KeyF') > 0) {
          this.fireCannons();
          break;
        }
      } else if (mod.kind === 'DETACHABLE_BLOCK') {
        if (this.evalModSignal(mod, keys, hasPilot, 'KeyU') > 0) {
          this.triggerDetachableBlocks();
          break;
        }
      } else if (mod.kind === 'SMOKE_FLARE') {
        if (this.evalModSignal(mod, keys, hasPilot, 'KeyI') > 0) {
          this.deploySmokeAndFlares();
          break;
        }
      }
    }

    if (this.countermeasureCooldown > 0) {
      this.countermeasureCooldown = Math.max(0, this.countermeasureCooldown - dt);
    }

    const targetOutrigger = this.outriggersExtended ? 1.0 : 0.0;
    this.outriggerExtRatio +=
      (targetOutrigger - this.outriggerExtRatio) * Math.min(1, dt * 8.0);

    const speed = this.velocity.length();
    const maxSteer = Math.max(0.18, 0.52 - Math.min(0.3, speed * 0.009));
    this.steerAngle +=
      (steerInput * maxSteer - this.steerAngle) * Math.min(1, dt * 11.0);

    const ackermann = computeAckermannAngles(this.steerAngle, 3.8, 3.2);

    if (this.vtolCount > 0) {
      const targetCol =
        collectiveInput !== 0
          ? collectiveInput
          : hasPilot
            ? 0.04
            : -0.5;
      this.vtolCollective +=
        (targetCol - this.vtolCollective) * Math.min(1, dt * 5.0);
    } else {
      this.vtolCollective = 0;
    }

    if (this.pistonCount <= 0) {
      this.pistonExtended = false;
      this.pistonExtRatio = 0;
    } else {
      const targetPistonRatio = this.pistonExtended ? 1.0 : 0.0;
      this.pistonExtRatio +=
        (targetPistonRatio - this.pistonExtRatio) * Math.min(1, dt * 10.0);
    }

    const fwdSpin = speed * dt * 2.1 * (throttle >= 0 ? 1 : -1);
    for (const mod of this.modules) {
      if (mod.kind === 'VTOL_ROTOR' && mod.spinMesh && hasPilot) {
        mod.spinMesh.rotation.y += dt * (18.0 + this.vtolCollective * 9.0);
      } else if (
        (mod.kind === 'BOAT_PROP' ||
          mod.kind === 'BOAT_OUTBOARD' ||
          mod.kind === 'PROP_AERO') &&
        mod.spinMesh
      ) {
        const sig = this.evalModSignal(mod, keys, hasPilot, 'KeyW', 'KeyS');
        if (sig !== 0) mod.spinMesh.rotation.z += sig * dt * 26.0;
      } else if (
        (mod.kind === 'GYRO' || mod.kind === 'GYRO_REACTION') &&
        mod.spinMesh &&
        this.gyroEnabled
      ) {
        mod.spinMesh.rotation.y += dt * 14.0;
      } else if (mod.kind === 'PISTON' && mod.spinMesh) {
        mod.spinMesh.position.y = -this.pistonExtRatio * 0.68;
      } else if (mod.kind === 'OUTRIGGER_JACK' && mod.spinMesh) {
        mod.spinMesh.position.y = -this.outriggerExtRatio * 0.55;
      } else if (mod.kind === 'PARACHUTE_AIRBRAKE' && mod.spinMesh) {
        const targetS = this.parachuteDeployed ? 2.4 : 0.28;
        const currS = mod.spinMesh.scale.x;
        const nextS = currS + (targetS - currS) * Math.min(1, dt * 8.0);
        mod.spinMesh.scale.set(nextS, nextS * 0.85, nextS);
      } else if (mod.kind === 'TURRET_RING' && mod.spinMesh) {
        const sig = this.evalModSignal(mod, keys, hasPilot, 'KeyQ', 'KeyE');
        if (sig !== 0) {
          mod.spinMesh.rotation.y += sig * dt * 3.2 * (mod.config?.strength ?? 1.0);
        }
      } else if (
        (mod.kind === 'SERVO_SPIN' ||
          mod.kind === 'STEERING_HINGE' ||
          mod.kind === 'HINGE_LARGE' ||
          mod.kind === 'SERVO_SMALL' ||
          mod.kind === 'JOINT_MECH') &&
        mod.spinMesh
      ) {
        const sig = this.evalModSignal(mod, keys, hasPilot, 'KeyA', 'KeyD');
        if (mod.kind === 'SERVO_SPIN') {
          mod.spinMesh.rotation.y += sig * dt * 8.0 * (mod.config?.strength ?? 1.0);
        } else {
          const maxRad = ((mod.config?.maxAngleDeg ?? 35) * Math.PI) / 180;
          mod.spinMesh.rotation.y = sig * maxRad;
        }
      } else if (mod.kind === 'GRAPPLING_WINCH' && mod.spinMesh && this.winchAnchorWorld) {
        mod.spinMesh.rotation.x += dt * 16.0;
      } else if (mod.kind === 'COSMETIC_RADAR_DOME' && mod.spinMesh) {
        mod.spinMesh.rotation.y += dt * 4.8;
      } else if (mod.kind === 'COSMETIC_SIREN_BAR' && mod.spinMesh) {
        const sirenActive =
          this.headlightsOn ||
          this.evalModSignal(mod, keys, hasPilot, 'KeyH') > 0;
        if (sirenActive) {
          mod.spinMesh.rotation.y += dt * 16.0;
        }
      } else if (mod.kind === 'COSMETIC_PIRATE_FLAG' && mod.spinMesh) {
        mod.spinMesh.rotation.y =
          Math.sin(performance.now() * 0.006 + mod.vx * 0.5) * (0.18 + Math.min(0.35, speed * 0.02));
      } else if (mod.kind === 'COSMETIC_HORN_BUGLE') {
        if (
          this.evalModSignal(mod, keys, hasPilot, 'KeyH') > 0 &&
          Math.random() < 0.14
        ) {
          SoundFX.hover();
        }
      } else if (mod.kind === 'COSMETIC_EXHAUST_STACK') {
        if (
          !this.inBuildMode &&
          hasPilot &&
          (Math.abs(throttle) > 0.1 || this.isBoostingNow) &&
          Math.random() < 0.25
        ) {
          const wp = this.localVoxelToWorld(mod.vx + 0.5, mod.vy + 1.4, mod.vz + 0.5);
          this.fx.spawnDebris(
            wp.x,
            wp.y,
            wp.z,
            Math.random() < 0.45 ? 0xf97316 : 0x475569,
            2.2,
            0.35,
          );
        }
      }
    }

    const hasDriverCommand =
      hasPilot &&
      (Math.abs(throttle) > 0.01 ||
        Math.abs(steerInput) > 0.01 ||
        Math.abs(pitchInput) > 0.01 ||
        Math.abs(rollInput) > 0.01 ||
        Math.abs(collectiveInput) > 0.01 ||
        brakeInput ||
        Boolean(keys['ShiftLeft']) ||
        Boolean(keys['Space']));

    this.isLocalPlayerOccupied = isSeatedDriver;
    // Step 2.5: Advance 100-200ms timers on structurally disconnected `falling_off` voxels
    if (this.fallingOffVoxels.size > 0) {
      updateFallingOffVoxels(this, dt, this.fx?.voxelDebrisSystem);
    }
    // Step 2.1: Keep world-space AABB updated each tick for 16m spatial hash broadphase
    updateVehicleWorldAABB(this, this.aabbMin, this.aabbMax);

    if (
      hasDriverCommand ||
      this.velocity.lengthSq() > 0.001 ||
      this.angularVelocity.lengthSq() > 0.001 ||
      this.winchAnchorWorld !== null ||
      this.fallingOffVoxels.size > 0 ||
      this.ignitedC4Voxels.size > 0
    ) {
      if (this.rigidBody.isSleeping) {
        this.rigidBody.wake();
      }
    } else if (this.rigidBody.isSleeping) {
      this.speedKmh = 0;
      this.gForce = 1.0;
      this.syncVisualTransform();
      return;
    }

    const angSpeed = this.angularVelocity.length();
    const SUBSTEPS = computeAdaptivePhysicsSubsteps(
      speed,
      angSpeed,
      this.crashCooldown > 0,
      this.inBuildMode,
      dt,
    );
    const activeGameMode = ModRegistry.getActiveGameMode();
    const subDt = dt / SUBSTEPS;
    const G =
      Math.abs(PHYSICS_CONFIG.gravity.y) *
      Math.max(0.08, activeGameMode.gravityMult);
    if (!(ModularVehicleRig as any)._loggedGravityOnce) {
      (ModularVehicleRig as any)._loggedGravityOnce = true;
      console.log('[Physics] Gravity verified:', PHYSICS_CONFIG.gravity);
    }

    const wheelMods = this.cachedWheelMods;
    const primarySeat = this.cachedPrimarySeat;
    let driveYawIdx = (primarySeat?.yawIdx || 0) & 3;
    if (
      !primarySeat &&
      wheelMods.length > 0 &&
      this.maxVX - this.minVX > this.maxVZ - this.minVZ
    ) {
      let sidewaysWheels = 0;
      for (const wm of wheelMods) {
        if (((wm.yawIdx || 0) & 1) === 1) sidewaysWheels++;
      }
      if (sidewaysWheels > wheelMods.length * 0.5) {
        driveYawIdx = (wheelMods[0].yawIdx || 1) & 3;
      }
    }
    const driveYawRad = driveYawIdx * (Math.PI / 2);
    const cosDrive = Math.round(Math.cos(driveYawRad));
    const sinDrive = Math.round(Math.sin(driveYawRad));

    const numWheels = Math.max(1, wheelMods.length);
    let minWheelLat = Infinity;
    let maxWheelLat = -Infinity;
    let minWheelLong = Infinity;
    let maxWheelLong = -Infinity;
    for (const wm of wheelMods) {
      const wLat = wm.vx * cosDrive - wm.vz * sinDrive;
      const wLong = wm.vx * sinDrive + wm.vz * cosDrive;
      if (wLat < minWheelLat) minWheelLat = wLat;
      if (wLat > maxWheelLat) maxWheelLat = wLat;
      if (wLong < minWheelLong) minWheelLong = wLong;
      if (wLong > maxWheelLong) maxWheelLong = wLong;
    }
    const midWheelLat =
      wheelMods.length > 0
        ? (minWheelLat + maxWheelLat) * 0.5
        : ((this.minVX + this.maxVX) * 0.5) * cosDrive -
          ((this.minVZ + this.maxVZ) * 0.5) * sinDrive;
    const midWheelLong =
      wheelMods.length > 0
        ? (minWheelLong + maxWheelLong) * 0.5
        : ((this.minVX + this.maxVX) * 0.5) * sinDrive +
          ((this.minVZ + this.maxVZ) * 0.5) * cosDrive;

    let hasDedicatedSteerWheel = this.cachedSteeringHingeCount > 0;
    let hasFrontSteerWheel = false;
    for (const wm of wheelMods) {
      const wLong = wm.vx * sinDrive + wm.vz * cosDrive;
      if (wm.kind === 'WHEEL_STEER' || wm.kind === 'SKI_SLIDER') {
        hasDedicatedSteerWheel = true;
        if (wLong >= midWheelLong - 0.5) {
          hasFrontSteerWheel = true;
        }
      }
    }
    if (!hasDedicatedSteerWheel && wheelMods.length > 0) {
      hasFrontSteerWheel = true;
    }
    const wheelTrackSpreadMeters =
      wheelMods.length >= 2 ? (maxWheelLat - minWheelLat) * VOXEL_SIZE : 0;
    const wheelbaseMeters = Math.max(
      1.8,
      wheelMods.length >= 2 ? (maxWheelLong - minWheelLong) * VOXEL_SIZE : 3.2,
    );
    const isNarrowTwoWheeler =
      wheelMods.length > 0 && wheelTrackSpreadMeters < 0.75;

    // Smooth steering input rate so fast cars turn progressively along tire arcs instead of snapping to 45°
    const steerRate = steerInput !== 0 ? 7.5 : 10.5;
    this.smoothedSteerSignal +=
      (steerInput - this.smoothedSteerSignal) * Math.min(1.0, steerRate * dt);
    if (Math.abs(this.smoothedSteerSignal) < 0.005 && steerInput === 0) {
      this.smoothedSteerSignal = 0;
    }

    // Pool engine power and evaluate custom engine throttle keybinds across Bulldawg, RAW V8, and Dragon engines
    let engineMultiplier = 0;
    let engineThrottleSignal = 0;
    let hasAnyEngine = false;
    for (const mod of this.modules) {
      const str = mod.config?.strength ?? 1.0;
      if (
        mod.kind === 'ENGINE_BULLDAWG' ||
        mod.kind === 'V8_ENGINE' ||
        mod.kind === 'ENGINE_DRAGON'
      ) {
        hasAnyEngine = true;
        if (mod.kind === 'ENGINE_BULLDAWG') engineMultiplier += 1.25 * str;
        else if (mod.kind === 'V8_ENGINE') engineMultiplier += 2.4 * str;
        else if (mod.kind === 'ENGINE_DRAGON') engineMultiplier += 4.5 * str;

        const engSig = this.evalModSignal(mod, keys, hasPilot, 'KeyW', 'KeyS');
        if (Math.abs(engSig) > Math.abs(engineThrottleSignal)) {
          engineThrottleSignal = engSig;
        }
      }
    }
    if (!hasAnyEngine) {
      engineThrottleSignal = throttle;
    } else if (
      isSeatedDriver &&
      Math.abs(this.touchThrottleInput) > Math.abs(engineThrottleSignal)
    ) {
      engineThrottleSignal = this.touchThrottleInput;
    } else if (isAiPiloted && !isSeatedDriver) {
      if (Math.abs(this.aiThrottleInput) > 0.01) {
        engineThrottleSignal = this.aiThrottleInput;
      }
    }

    let groundedWheels = 0;
    let groundedHullContacts = 0;
    let submergedCount = 0;
    let maxSlipThisFrame = 0;
    let pendingCrash: {
      x: number;
      y: number;
      z: number;
      impactSpeed: number;
    } | null = null;

    // If external caller (e.g. jump pad, cannon recoil, or teleport) modified position/velocity between frames, sync into rigidBody once before substepping
    if (!this.position.equals(this.rigidBody.position)) {
      this.rigidBody.position.copy(this.position);
    }
    if (!this.quaternion.equals(this.rigidBody.quaternion)) {
      this.rigidBody.quaternion.copy(this.quaternion);
    }
    if (!this.velocity.equals(this.rigidBody.velocity)) {
      this.rigidBody.velocity.copy(this.velocity);
    }
    if (!this.angularVelocity.equals(this.rigidBody.angularVelocity)) {
      this.rigidBody.angularVelocity.copy(this.angularVelocity);
    }

    this.prevVelocity.copy(this.rigidBody.velocity);
    this.isBoostingNow = false;
    this.isDrifting = false;
    this.isSteppingPhysics = true;

    // Fast lightweight PropRigidBody step for dynamic/static Voxel Entities (cones, crates, barrels, balls, pins)
    if (this.isVoxelEntity && this.propRigidBody) {
      const prop = this.propRigidBody;
      const isShared = prop.position === this.rigidBody.position;
      if (!isShared) {
        prop.position.copy(this.rigidBody.position);
        prop.quaternion.copy(this.rigidBody.quaternion);
        prop.velocity.copy(this.rigidBody.velocity);
        prop.angularVelocity.copy(this.rigidBody.angularVelocity);
        prop.isSleeping = this.rigidBody.isSleeping;
      }

      stepPropRigidBody(
        prop,
        dt,
        (wx, wy, wz) => {
          return this.probeGroundAndVehiclesBelow(wx, wy + 0.15, wz, 0.45).y;
        },
        (wx, wy, wz) => {
          const ceil = this.world.probeCeilingAbove(wx, wy - 0.15, wz, 0.5);
          return ceil ? ceil.y : null;
        },
      );

      if (!isShared) {
        this.rigidBody.position.copy(prop.position);
        this.rigidBody.quaternion.copy(prop.quaternion);
        this.rigidBody.velocity.copy(prop.velocity);
        this.rigidBody.angularVelocity.copy(prop.angularVelocity);
        this.rigidBody.isSleeping = prop.isSleeping;
      }
      this.rigidBody.sleepTimer = prop.sleepTimer;
      this.speedKmh = this.velocity.length() * 3.6;

      const rad = prop.boundingRadius + 0.25;
      this.aabbMin.set(
        this.position.x - rad,
        this.position.y - rad,
        this.position.z - rad,
      );
      this.aabbMax.set(
        this.position.x + rad,
        this.position.y + rad,
        this.position.z + rad,
      );

      this.isSteppingPhysics = false;
      this.syncToVoxelWorld();
      return;
    }

    const tuningProfile = getVehicleTuningProfile(this.presetIndex);
    const entityBaseScale = this.isVoxelEntity ? 0.06 : 1.0;
    const liveMassScale =
      (PHYSICS_CONFIG.defaultVoxelMassKg || 1.0) *
      (this.isVoxelEntity ? 1.0 : tuningProfile.massScale) *
      entityBaseScale *
      (this.entityMassMultiplier || 1.0);
    if (Math.abs(liveMassScale - this.lastAppliedConfigMassScale) > 1e-4) {
      this.recalculateMassAndCenters();
      this.rigidBody.syncMassProperties(this.totalMass, this.inertia);
    }
    if (!this.isVoxelEntity) {
      this.rigidBody.linearDamping =
        PHYSICS_CONFIG.linearDamping !== PHYSICS_CONFIG.defaultLinearDamping
          ? PHYSICS_CONFIG.linearDamping
          : tuningProfile.linearDamping;
      this.rigidBody.angularDamping =
        PHYSICS_CONFIG.angularDamping !== PHYSICS_CONFIG.defaultAngularDamping
          ? PHYSICS_CONFIG.angularDamping
          : tuningProfile.angularDamping;
    }

    let breakThroughsThisFrame = 0;

    for (let step = 0; step < SUBSTEPS; step++) {
      _forward.set(sinDrive, 0, cosDrive).applyQuaternion(this.rigidBody.quaternion);
      _right.set(cosDrive, 0, -sinDrive).applyQuaternion(this.rigidBody.quaternion);
      _up.set(0, 1, 0).applyQuaternion(this.rigidBody.quaternion);

      // Accumulate gravity at CoM on CustomRigidBody
      _totalForce.set(0, -G * this.rigidBody.mass, 0);
      this.rigidBody.applyForceAtPoint(_totalForce, this.rigidBody.position);

      // Accumulate gyroscopic precession torque: -ω × (I ω)
      const iwx = this.rigidBody.inertiaTensor.x * this.rigidBody.angularVelocity.x;
      const iwy = this.rigidBody.inertiaTensor.y * this.rigidBody.angularVelocity.y;
      const iwz = this.rigidBody.inertiaTensor.z * this.rigidBody.angularVelocity.z;
      _totalTorque.set(
        -(this.rigidBody.angularVelocity.y * iwz - this.rigidBody.angularVelocity.z * iwy),
        -(this.rigidBody.angularVelocity.z * iwx - this.rigidBody.angularVelocity.x * iwz),
        -(this.rigidBody.angularVelocity.x * iwy - this.rigidBody.angularVelocity.y * iwx),
      );

      const addForceAtLocal = (worldForce: THREE.Vector3, localPos: THREE.Vector3) => {
        _rVec
          .copy(localPos)
          .sub(this.comLocal)
          .applyQuaternion(this.rigidBody.quaternion)
          .add(this.rigidBody.position);
        this.rigidBody.applyForceAtPoint(worldForce, _rVec);
      };

      groundedWheels = 0;
      let groundedSteerSum = 0;
      let groundedSteerCount = 0;
      let avgGroundedMu = 0.9;
      // Sub-linear mass reference so physicsConfig.defaultVoxelMassKg & tuningProfile.massScale genuinely change acceleration & power-to-weight feel!
      const effectivePowerMass = 320 + this.rigidBody.mass * 0.45;
      const baseEnginePower =
        (2.8 + engineMultiplier * 3.2) *
        (effectivePowerMass * 32.0) *
        activeGameMode.enginePowerMult;
      const topSpeedMPS =
        (48.0 + engineMultiplier * 20.0) *
        Math.max(0.6, Math.sqrt(activeGameMode.enginePowerMult));
      const wheelLoadCap = this.rigidBody.mass * G * 2.8;

      let leftCompressionSum = 0;
      let rightCompressionSum = 0;
      let leftGroundedCount = 0;
      let rightGroundedCount = 0;

      for (let wIdx = 0; wIdx < wheelMods.length; wIdx++) {
        const mod = wheelMods[wIdx];
        const pairedSusp = this.cachedWheelPairedSusp[wIdx];
        const pairedHinge = this.cachedWheelPairedHinge[wIdx];

        const hasBuiltInSusp =
          mod.kind === 'WHEEL_STEER' ||
          mod.kind === 'WHEEL_DRIVE' ||
          mod.kind === 'WHEEL_MONSTER';
        const suspStiffMult =
          (pairedSusp?.config?.stiffness ?? (hasBuiltInSusp ? 1.0 : 2.1)) *
          tuningProfile.suspensionStiffnessScale;
        const suspDampMult =
          (pairedSusp?.config?.damping ?? (hasBuiltInSusp ? 1.0 : 0.45)) *
          tuningProfile.suspensionDampingScale;

        const restLen = pairedSusp
          ? 0.92
          : mod.kind === 'WHEEL_MONSTER'
            ? 0.95
            : hasBuiltInSusp
              ? 0.84
              : 0.44;
        ensureHybridWheelState(mod);
        const wheelRad = mod.currentRadiusMeters ?? (
          mod.kind === 'WHEEL_MONSTER'
            ? 0.66
            : mod.kind === 'WHEEL_KART'
              ? 0.34
              : mod.kind === 'WHEEL_DRAG'
                ? 0.54
                : 0.48
        );
        const maxTravel = restLen + wheelRad;

        const kSpring = ((this.rigidBody.mass * G) / numWheels) * 3.15 * suspStiffMult;
        const cDamperBump = (this.rigidBody.mass / numWheels) * 7.8 * suspDampMult;
        const cDamperRebound = (this.rigidBody.mass / numWheels) * 11.4 * suspDampMult;

        _localPos.set(
          (mod.vx + 0.5) * VOXEL_SIZE,
          (mod.vy + 0.5) * VOXEL_SIZE,
          (mod.vz + 0.5) * VOXEL_SIZE,
        );
        _worldMount
          .copy(_localPos)
          .sub(this.comLocal)
          .applyQuaternion(this.rigidBody.quaternion)
          .add(this.rigidBody.position);

        // Multi-point wheel ground probe: sample 3 points across wheel width (-halfWidth, center, +halfWidth)
        const wheelHalfWidth =
          mod.kind === 'WHEEL_MONSTER'
            ? 0.28
            : mod.kind === 'WHEEL_DRAG'
              ? 0.22
              : 0.16;
        const groundCenter = this.world.probeGroundBelow(
          _worldMount.x,
          _worldMount.y,
          _worldMount.z,
          0.45,
        );
        const useMultiPoint = speed > 3.0;
        let ground: { y: number; mat: number };
        if (useMultiPoint) {
          const groundLeft = this.world.probeGroundBelow(
            _worldMount.x - _right.x * wheelHalfWidth,
            _worldMount.y - _right.y * wheelHalfWidth,
            _worldMount.z - _right.z * wheelHalfWidth,
            0.45,
          );
          const groundRight = this.world.probeGroundBelow(
            _worldMount.x + _right.x * wheelHalfWidth,
            _worldMount.y + _right.y * wheelHalfWidth,
            _worldMount.z + _right.z * wheelHalfWidth,
            0.45,
          );
          ground =
            groundLeft.y > groundCenter.y && groundLeft.y >= groundRight.y
              ? { y: groundLeft.y, mat: groundLeft.mat }
              : groundRight.y > groundCenter.y
                ? { y: groundRight.y, mat: groundRight.mat }
                : { y: groundCenter.y, mat: groundCenter.mat };
        } else {
          ground = { y: groundCenter.y, mat: groundCenter.mat };
        }
        let wheelSupportVehicle: ModularVehicleRig | null = null;
        const otherRigs = this.fx?.rigs;
        if (otherRigs && otherRigs.length > 1) {
          const tireBottomY = _worldMount.y - maxTravel;
          const stepLimit = Math.max(0.55, wheelRad * 1.15);
          for (let rIdx = 0; rIdx < otherRigs.length; rIdx++) {
            const other = otherRigs[rIdx];
            if (!other || other === this || other.inBuildMode) continue;
            if (other.isVoxelEntity && !other.propRigidBody?.isStatic) continue;
            const vSurf = other.probeVoxelSurfaceBelow(
              _worldMount.x,
              tireBottomY + 0.15,
              _worldMount.z,
              stepLimit,
            );
            if (vSurf && vSurf.y > ground.y && vSurf.y <= _worldMount.y + 0.25) {
              ground.y = vSurf.y;
              ground.mat = vSurf.mat;
              wheelSupportVehicle = other;
            }
          }
        }
        const mapHazards = this.fx?.mapHazards;
        if (mapHazards && mapHazards.length > 0) {
          const tireBottomY = _worldMount.y - maxTravel;
          const stepLimit = Math.max(0.55, wheelRad * 1.15);
          for (let hIdx = 0; hIdx < mapHazards.length; hIdx++) {
            const haz = mapHazards[hIdx];
            if (!haz || typeof haz.probeVoxelSurfaceBelow !== 'function') continue;
            if (
              Math.abs(_worldMount.x - haz.position.x) > 5.0 ||
              Math.abs(_worldMount.z - haz.position.z) > 5.0
            ) {
              continue;
            }
            const hSurf = haz.probeVoxelSurfaceBelow(
              _worldMount.x,
              tireBottomY + 0.15,
              _worldMount.z,
              stepLimit,
            );
            if (hSurf && hSurf.y > ground.y && hSurf.y <= _worldMount.y + 0.25) {
              ground.y = hSurf.y;
              ground.mat = hSurf.mat;
              wheelSupportVehicle = null;
            }
          }
        }
        const dist = _worldMount.y - ground.y;
        const wLat = mod.vx * cosDrive - mod.vz * sinDrive;
        const wLong = mod.vx * sinDrive + mod.vz * cosDrive;
        const isLeftWheel = wLat < midWheelLat - 0.15;
        const isRightWheel = wLat > midWheelLat + 0.15;
        const isFrontAxleWheel = wLong >= midWheelLong - 0.25;
        const isRearAxleWheel =
          hasFrontSteerWheel && wLong < midWheelLong - 0.25;

        // Compute wheel steering angle with speed-sensitive steering curve & automatic front-axle fallback for custom cars!
        let wAng = 0;
        if (pairedHinge) {
          const rawSig = this.evalModSignal(
            pairedHinge,
            keys,
            hasPilot,
            'KeyA',
            'KeyD',
          );
          const hSig =
            pairedHinge.config?.posKey === 'KeyA' &&
            pairedHinge.config?.negKey === 'KeyD'
              ? this.smoothedSteerSignal
              : rawSig;
          const maxRad = ((pairedHinge.config?.maxAngleDeg ?? 35) * Math.PI) / 180;
          const help = pairedHinge.config?.steeringHelp ?? 0.6;
          const speedDamp =
            1.0 / (1.0 + Math.pow(speed / 15.0, 1.25) * (0.55 + help * 0.95));
          wAng = hSig * maxRad * Math.max(0.18, speedDamp);
          if (isRearAxleWheel) {
            wAng *= -0.38;
          }
        } else if (
          mod.kind === 'WHEEL_STEER' ||
          mod.kind === 'SKI_SLIDER' ||
          (!hasDedicatedSteerWheel && isFrontAxleWheel)
        ) {
          const isExplicitSteerKind =
            mod.kind === 'WHEEL_STEER' || mod.kind === 'SKI_SLIDER';
          const rawSig = isExplicitSteerKind
            ? this.evalModSignal(mod, keys, hasPilot, 'KeyA', 'KeyD')
            : this.smoothedSteerSignal;
          const hSig =
            !isExplicitSteerKind ||
            ((!mod.config?.posKey || mod.config.posKey === 'KeyA') &&
              (!mod.config?.negKey || mod.config.negKey === 'KeyD'))
              ? this.smoothedSteerSignal
              : rawSig;
          const maxDeg =
            mod.config?.maxAngleDeg ?? (mod.kind === 'SKI_SLIDER' ? 28 : 32);
          const maxRad = (maxDeg * Math.PI) / 180;
          const help = mod.config?.steeringHelp ?? 0.6;
          const speedDamp =
            1.0 / (1.0 + Math.pow(speed / 15.0, 1.25) * (0.55 + help * 0.95));
          let targetSteerRad = hSig * maxRad * Math.max(0.18, speedDamp);
          if (isRearAxleWheel) {
            targetSteerRad *= -0.38;
          }
          const wheelAckermann = computeAckermannAngles(
            targetSteerRad,
            wheelbaseMeters,
            Math.max(1.6, wheelTrackSpreadMeters),
          );
          wAng = isLeftWheel
            ? wheelAckermann.leftSteerRad
            : isRightWheel
              ? wheelAckermann.rightSteerRad
              : targetSteerRad;
        }

        const isSteerKeyModule =
          mod.kind === 'WHEEL_STEER' ||
          mod.kind === 'SKI_SLIDER' ||
          (mod.config?.posKey === 'KeyA' && mod.config?.negKey === 'KeyD');
        const wheelThrottle =
          mod.kind === 'SKI_SLIDER'
            ? 0
            : isSteerKeyModule
              ? engineThrottleSignal
              : this.evalModSignal(
                  mod,
                  keys,
                  hasPilot,
                  'KeyW',
                  'KeyS',
                );

        if (step === SUBSTEPS - 1 && mod.wheelMesh) {
          if (mod.mesh) {
            mod.mesh.rotation.set(0, driveYawRad, 0);
          }
          mod.wheelMesh.rotation.y = wAng;
          const rollGroup = (mod.wheelMesh.userData.rollGroup || mod.mesh?.userData.rollGroup) as THREE.Object3D | undefined;
          if (rollGroup) {
            rollGroup.rotation.x += fwdSpin;
          } else {
            mod.wheelMesh.children.forEach((child) => {
              child.rotation.x += fwdSpin;
            });
          }
        }

        if (dist < maxTravel && dist > -0.6 && _up.y > 0.15) {
          groundedWheels++;
          if (!isRearAxleWheel && Math.abs(wAng) > 1e-4) {
            groundedSteerSum += wAng;
            groundedSteerCount++;
          }
          const compression = Math.max(0, Math.min(restLen, maxTravel - dist));
          mod.lastCompression = compression;
          if (isLeftWheel) {
            leftCompressionSum += compression;
            leftGroundedCount++;
          } else if (isRightWheel) {
            rightCompressionSum += compression;
            rightGroundedCount++;
          }

          if (step === SUBSTEPS - 1 && mod.wheelMesh) {
            mod.wheelMesh.position.y = -restLen + compression * 0.74;
          }

          _rVec.copy(_worldMount).sub(this.rigidBody.position);
          _crossTmp.crossVectors(this.rigidBody.angularVelocity, _rVec);
          _contactVel.copy(this.rigidBody.velocity).add(_crossTmp);
          if (wheelSupportVehicle) {
            wheelSupportVehicle.rigidBody.velocityAtPoint(_worldMount, _v4);
            _contactVel.sub(_v4);
          }

          const relVelY = _contactVel.y;

          _steerQ.setFromAxisAngle(_worldUpVec, wAng);
          _wheelFwd.copy(_forward).applyQuaternion(_steerQ);
          _wheelFwd.y = 0;
          if (_wheelFwd.lengthSq() < 1e-6) {
            _wheelFwd.set(0, 0, 1);
          } else {
            _wheelFwd.normalize();
          }

          _wheelRight.copy(_right).applyQuaternion(_steerQ);
          _wheelRight.y = 0;
          if (_wheelRight.lengthSq() < 1e-6) {
            _wheelRight.set(1, 0, 0);
          } else {
            _wheelRight.normalize();
          }

          const vLat = _contactVel.dot(_wheelRight);
          const vLong = _contactVel.dot(_wheelFwd);
          const matSpec = MAT_INFO[ground.mat] || MAT_INFO[MAT.GRASS];

          // Step 2.7: Evaluate Hybrid Wheel (Sphere Physics + Voxel Break-Off Visual + Shot-Out Corner Drag)
          const hybridWheel = evaluateHybridWheelStep(
            mod,
            vLong,
            vLat,
            step === SUBSTEPS - 1 ? dt : 0,
          );

          if (hybridWheel.isShotOut) {
            // Wheel is "shot out": corner drags on the ground with much higher skidding friction (metal-on-ground)
            const cornerSupport = Math.max(0, compression * kSpring * 0.55 - relVelY * cDamperBump * 0.5);
            const dragMu = hybridWheel.cornerDragFriction;
            const dragFx = -Math.max(-1, Math.min(1, _contactVel.x * 2.5)) * dragMu * cornerSupport;
            const dragFz = -Math.max(-1, Math.min(1, _contactVel.z * 2.5)) * dragMu * cornerSupport;
            _wheelForce.set(dragFx, cornerSupport, dragFz);
            addForceAtLocal(_wheelForce, _localPos);
            if (step === 0 && speed > 2.5 && Math.random() < 0.35) {
              this.fx.spawnWeldSparks(_worldMount.x, ground.y + 0.08, _worldMount.z);
            }
            continue;
          }

          // Use custom physicsConfig.ts anisotropic material friction & restitution + vehicleTuning.ts scales
          const terrainMatType = mapVoxelMatToMaterialType(ground.mat);
          const groundProfile = getMaterialFrictionProfile(terrainMatType);
          const isTarmac =
            ground.mat === MAT.ASPHALT ||
            ground.mat === MAT.ROAD_LINE ||
            ground.mat === MAT.CONCRETE ||
            ground.mat === MAT.RAMP_ORANGE;
          let wheelGripMult = hybridWheel.gripMultiplier * this.weatherGripMult;
          if (mod.kind === 'WHEEL_RACING') {
            wheelGripMult *= isTarmac ? 1.45 : 0.55;
          } else if (mod.kind === 'WHEEL_DRIVE' || mod.kind === 'WHEEL_MONSTER') {
            wheelGripMult *= isTarmac ? 1.05 : 1.3;
          } else if (mod.kind === 'WHEEL_SPIKED') {
            wheelGripMult *= 1.5;
          } else if (mod.kind === 'TANK_TREAD') {
            wheelGripMult *= 1.85;
          } else if (mod.kind === 'SKI_SLIDER') {
            wheelGripMult *= 0.1;
          }

          const muFwd =
            groundProfile.forwardFriction *
            tuningProfile.forwardFrictionScale *
            wheelGripMult;
          const muLat =
            groundProfile.lateralFriction *
            tuningProfile.lateralFrictionScale *
            wheelGripMult;
          avgGroundedMu = muLat;

          const steerDriveScale = 1.0;
          const effectiveWheelThrottle =
            mod.kind === 'SKI_SLIDER' || Math.abs(wheelThrottle) < 1e-4
              ? 0
              : wheelThrottle;

          _tireStepInput.compression = compression;
          _tireStepInput.restLen = restLen;
          _tireStepInput.kSpring = kSpring;
          _tireStepInput.cDamperBump =
            cDamperBump * (1.0 + groundProfile.restitution * 0.65);
          _tireStepInput.cDamperRebound =
            cDamperRebound * Math.max(0.25, 1.0 - groundProfile.restitution * 0.55);
          _tireStepInput.relVelY = relVelY;
          _tireStepInput.vLong = vLong;
          _tireStepInput.vLat = vLat;
          _tireStepInput.throttle = effectiveWheelThrottle;
          _tireStepInput.brake = brakeInput;
          _tireStepInput.isPowered =
            effectiveWheelThrottle !== 0 &&
            mod.kind !== 'SKI_SLIDER' &&
            (mod.kind !== 'WHEEL_STEER' || this.engineCount > 0);
          // BUG 3: Strictly 0 engine force when throttle input is 0 (no idle RPM force)
          _tireStepInput.engineForcePerWheel =
            effectiveWheelThrottle === 0
              ? 0
              : (baseEnginePower / numWheels) *
                (mod.config?.strength ?? 1.0) *
                steerDriveScale *
                (mod.kind === 'WHEEL_DRAG' ? 1.75 : 1.0);
          _tireStepInput.topSpeedMPS = topSpeedMPS;
          _tireStepInput.surfaceMu = muFwd;
          _tireStepInput.wheelLoadCap = wheelLoadCap;
          _tireStepInput.forwardTraction = mod.config?.forwardTraction ?? 1.0;
          _tireStepInput.sidewaysTraction = mod.config?.sidewaysTraction ?? 1.0;

          const tireOut = solveTireForces(_tireStepInput, _tireStepOutput);

          if (tireOut.slipRatio > maxSlipThisFrame) {
            maxSlipThisFrame = tireOut.slipRatio;
          }

          const anisotropicLatRatio =
            muLat / Math.max(0.05, muFwd);
          const latMult =
            (mod.kind === 'WHEEL_DRAG'
              ? 0.65
              : mod.kind === 'SKI_SLIDER'
                ? 2.4
                : Math.abs(wAng) < 0.01
                  ? 1.35
                  : 1.18) * anisotropicLatRatio;

          // BUG 3: Apply vertical suspension normal load along WORLD UP (0, 1, 0) instead of tilted vehicle _up
          // so slight front/rear CoM pitch angles on flat ground never create a phantom horizontal forward force!
          _wheelForce.set(0, tireOut.normalLoad, 0);
          addForceAtLocal(_wheelForce, _localPos);
          if (wheelSupportVehicle) {
            _wheelForce.set(0, -tireOut.normalLoad * 0.45, 0);
            wheelSupportVehicle.rigidBody.applyForceAtPoint(_wheelForce, _worldMount);
          }

          // Apply longitudinal drive/braking force at wheel mount with slight vertical offset so acceleration/braking induces realistic pitch squat & dive!
          // FIX 2: When a wheel has 3+ simultaneous contacts (inside a cavity), boost rolling resistance by 5.0x so it slides instead of climbing cavity walls
          const pitchArmOffset = Math.max(0, this.comLocal.y - _localPos.y) * 0.18;
          const cavityLongForce = hybridWheel.isInCavity
            ? tireOut.fLong / hybridWheel.rollingFrictionMultiplier -
              Math.max(-1, Math.min(1, vLong * 3.5)) *
                hybridWheel.forwardRollingResistance *
                tireOut.normalLoad
            : tireOut.fLong;
          _wheelForce.copy(_wheelFwd).multiplyScalar(cavityLongForce);
          _v4.set(_localPos.x, this.comLocal.y - pitchArmOffset, _localPos.z);
          addForceAtLocal(_wheelForce, _v4);

          // Apply lateral cornering force with vertical offset below CoM for natural suspension body roll
          const rollOffset = Math.max(0, this.comLocal.y - _localPos.y) * 0.16;
          _wheelForce.copy(_wheelRight).multiplyScalar(tireOut.fLat * latMult);
          _v4.set(_localPos.x, this.comLocal.y - rollOffset, _localPos.z);
          addForceAtLocal(_wheelForce, _v4);

          if (
            step === 0 &&
            speed > 2.2 &&
            Math.random() < (tireOut.slipRatio > 0.35 || speed > 9.0 ? 0.38 : 0.16)
          ) {
            const inShallowWater =
              this.world.isWaterAt(_worldMount.x, WATER_LEVEL - 0.15, _worldMount.z) &&
              ground.y <= WATER_LEVEL + 0.65;
            const trailColor = inShallowWater
              ? Math.random() < 0.55
                ? 0xffffff
                : 0x7dd3fc
              : matSpec.color;
            this.fx.spawnDebris(
              _worldMount.x - _wheelFwd.x * 0.25,
              ground.y + 0.14,
              _worldMount.z - _wheelFwd.z * 0.25,
              trailColor,
              inShallowWater ? 2.8 : 2.4,
              0.48,
            );
          }

          if (
            step === 0 &&
            (tireOut.slipRatio > 0.38 || this.isDrifting) &&
            speed > 2.5 &&
            _up.y > 0.15
          ) {
            this.fx.spawnTireSmoke(
              _worldMount.x - _wheelFwd.x * 0.18,
              ground.y + 0.04,
              _worldMount.z - _wheelFwd.z * 0.18,
              tireOut.slipRatio,
            );
            if (tireOut.slipRatio > 0.52 && Math.random() < 0.55) {
              const yawRad = Math.atan2(_wheelFwd.x, _wheelFwd.z);
              this.fx.spawnTireDecal(
                _worldMount.x,
                ground.y,
                _worldMount.z,
                yawRad,
                mod.kind === 'TANK_TREAD' ? 0.48 : 0.32,
                0.56,
                isTarmac ? 0x0f172a : 0x3f2e21,
              );
            }
          } else if (
            step === 0 &&
            mod.kind === 'TANK_TREAD' &&
            speed > 2.2 &&
            Math.random() < 0.28
          ) {
            const yawRad = Math.atan2(_wheelFwd.x, _wheelFwd.z);
            this.fx.spawnTireDecal(
              _worldMount.x,
              ground.y,
              _worldMount.z,
              yawRad,
              0.48,
              0.42,
              isTarmac ? 0x1e293b : 0x451a03,
            );
          }
        } else {
          mod.lastCompression = 0;
          if (step === SUBSTEPS - 1 && mod.wheelMesh) {
            mod.wheelMesh.position.y = -restLen * 0.78;
          }
        }
      }

      // Wide multi-track vehicles get anti-roll bar + tuningProfile.rollStabilityTorque; narrow 2-wheelers get gravity overturning roll torque
      if (!isNarrowTwoWheeler && groundedWheels >= 2) {
        if (leftGroundedCount > 0 && rightGroundedCount > 0) {
          const leftAvg = leftCompressionSum / leftGroundedCount;
          const rightAvg = rightCompressionSum / rightGroundedCount;
          const rollDiff = leftAvg - rightAvg;
          const antiRollTorque = rollDiff * this.rigidBody.mass * 7.5;
          _totalTorque.addScaledVector(_forward, -antiRollTorque);
        }
        const rollHorizonErr = _crossTmp
          .crossVectors(_up, submergedCount > 0 ? _waveTargetNormal : _worldUpVec)
          .dot(_forward);
        const rollAngVel = this.rigidBody.angularVelocity.dot(_forward);
        _totalTorque.addScaledVector(
          _forward,
          rollHorizonErr * tuningProfile.rollStabilityTorque * 24.0 -
            rollAngVel * this.rigidBody.inertiaTensor.z * 5.8,
        );
      } else if (isNarrowTwoWheeler && groundedWheels >= 1) {
        const leanSin = _right.y;
        const speedStability = Math.min(0.82, speed * 0.045);
        const tipTorque =
          leanSin * this.rigidBody.mass * G * 0.95 * (1.0 - speedStability);
        _totalTorque.addScaledVector(_forward, -tipTorque);
      }

      // --- PILOT SEAT WEIGHT-SHIFT LEAN & SPECIAL SEAT PHYSICS ---
      let spaceGyroBonus = 0;
      let shipRudderBonus = 1.0;
      for (const mod of this.modules) {
        if (mod.kind === 'SEAT_MOTO' || mod.kind === 'SEAT_KART' || mod.kind === 'COCKPIT') {
          const leanSig = this.evalModSignal(mod, keys, hasPilot, 'KeyA', 'KeyD');
          if (leanSig !== 0 && (isNarrowTwoWheeler || groundedWheels < 2)) {
            const leanPower =
              mod.kind === 'SEAT_MOTO' ? 9.5 : mod.kind === 'SEAT_KART' ? 6.5 : 3.5;
            _totalTorque.addScaledVector(
              _forward,
              -leanSig * this.rigidBody.mass * leanPower * (mod.config?.strength ?? 1.0),
            );
          }
        } else if (mod.kind === 'SEAT_SPACE') {
          spaceGyroBonus += 12.0 * (mod.config?.strength ?? 1.0);
        } else if (mod.kind === 'SEAT_SHIP_WHEEL') {
          shipRudderBonus = 1.85;
        }
      }

      // --- STEP 3a.1: BASIC BUOYANCY & SUBMARINE ACTIVE BALLAST (Float on waves or dive/hover underwater!) ---
      const hasSubmarineBallast = this.modules.some(
        (m) => m.kind === 'BCD_TANK' || m.kind === 'SEAT_DIVING',
      );
      const hasBuoyantHull =
        hasSubmarineBallast ||
        this.propCount > 0 ||
        this.totalBuoyancy >= this.rigidBody.mass * 0.85 ||
        this.modules.some(
          (m) =>
            m.kind === 'BOAT_PROP' ||
            m.kind === 'BOAT_OUTBOARD' ||
            m.kind === 'SEAT_SHIP_WHEEL',
        );

      // Update active submarine ballast trim when equipped with BCD_TANK or SEAT_DIVING:
      // - Hold [Ctrl] / [Q] (or negative BCD input) -> Flood ballast tanks to DIVE (-1.0)
      // - Hold [Space] (or positive BCD input)      -> Blow ballast tanks to SURFACE (+1.0)
      // - Released while submerged (< WATER_LEVEL)  -> Hold NEUTRAL BUOYANCY (0.0) to hover at current depth!
      if (hasSubmarineBallast) {
        const diveHeld =
          hasPilot &&
          Boolean(
            keys['ControlLeft'] ||
              keys['ControlRight'] ||
              keys['KeyQ'] ||
              this.touchPitchInput < -0.35 ||
              (isAiPiloted && this.aiCollectiveInput < -0.35),
          );
        const surfaceHeld =
          hasPilot &&
          Boolean(
            keys['Space'] ||
              this.touchPitchInput > 0.35 ||
              (isAiPiloted && this.aiCollectiveInput > 0.35),
          );
        if (diveHeld && !surfaceHeld) {
          this.submarineBallastTrim = -1.0;
        } else if (surfaceHeld && !diveHeld) {
          this.submarineBallastTrim = 1.0;
        } else if (this.rigidBody.position.y < WATER_LEVEL - 0.35) {
          this.submarineBallastTrim = 0.0; // Neutral underwater hover
        } else {
          this.submarineBallastTrim = 0.35; // Positive surface float
        }
      } else {
        this.submarineBallastTrim = 1.0;
      }

      const buoyStepResult = stepVehicleBasicBuoyancy(
        this.rigidBody,
        this.world,
        {
          hasBuoyancy: hasBuoyantHull,
          waterLevel: WATER_LEVEL,
          isSubmarine: hasSubmarineBallast,
          ballastTrim: this.submarineBallastTrim,
        },
      );
      submergedCount = buoyStepResult.submergedPointCount;
      _waveTargetNormal.set(0, 1, 0);
      if (submergedCount > 0) {
        const waveSampleCenter = this.world.sampleWavePhysicsAt(
          this.rigidBody.position.x,
          this.rigidBody.position.z,
          _waveSamplePhysics,
        );
        _waveTargetNormal
          .set(
            -waveSampleCenter.slopeX * 2.0,
            1.0,
            -waveSampleCenter.slopeZ * 2.0,
          )
          .normalize();
        if (
          step === 0 &&
          buoyStepResult.maxDepthMeters < 1.2 &&
          Math.random() < (speed > 1.2 ? 0.22 : 0.05)
        ) {
          this.fx.spawnDebris(
            this.rigidBody.position.x,
            WATER_LEVEL + Math.max(waveSampleCenter.rawH, waveSampleCenter.terracedH) + 0.08,
            this.rigidBody.position.z,
            Math.random() < 0.6 ? 0xffffff : 0x7dd3fc,
            speed > 1.2 ? 2.6 : 1.2,
            0.42,
          );
        }
      }

      for (const mod of this.modules) {
        if (mod.kind === 'BCD_TANK' || mod.kind === 'SEAT_DIVING') {
          let bcdSig = this.evalModSignal(
            mod,
            keys,
            hasPilot,
            'Space',
            'ControlLeft',
          );
          if (bcdSig === 0 && hasPilot && keys['KeyQ']) {
            bcdSig = -1;
          }
          if (bcdSig !== 0 && submergedCount > 0) {
            _localPos.set(
              (mod.vx + 0.5) * VOXEL_SIZE,
              (mod.vy + 0.5) * VOXEL_SIZE,
              (mod.vz + 0.5) * VOXEL_SIZE,
            );
            _wheelForce.set(
              0,
              bcdSig * this.rigidBody.mass * G * 0.75 * (mod.config?.strength ?? 1.0),
              0,
            );
            addForceAtLocal(_wheelForce, _localPos);
          }
        }
      }

      // Underwater hydroplane pitch control when diving in a submarine
      if (
        hasSubmarineBallast &&
        submergedCount > 0 &&
        this.rigidBody.position.y < WATER_LEVEL + 0.2 &&
        pitchInput !== 0
      ) {
        _totalTorque.addScaledVector(
          _right,
          pitchInput * this.rigidBody.mass * 14.0,
        );
      }

      // --- MARINE PROPELLERS, OUTBOARDS & AIRCRAFT PROPS ---
      for (const mod of this.modules) {
        if (
          mod.kind !== 'BOAT_PROP' &&
          mod.kind !== 'BOAT_OUTBOARD' &&
          mod.kind !== 'PROP_AERO'
        ) {
          continue;
        }
        _localPos.set(
          (mod.vx + 0.5) * VOXEL_SIZE,
          (mod.vy + 0.5) * VOXEL_SIZE,
          (mod.vz + 0.5) * VOXEL_SIZE,
        );
        _wp
          .copy(_localPos)
          .sub(this.comLocal)
          .applyQuaternion(this.rigidBody.quaternion)
          .add(this.rigidBody.position);

        const sig = this.evalModSignal(mod, keys, hasPilot, 'KeyW', 'KeyS');
        const str = mod.config?.strength ?? 1.0;

        const propWaveH = this.world.getWaveHeightAt(_wp.x, _wp.z);
        if (mod.kind === 'PROP_AERO') {
          if (_wp.y > WATER_LEVEL + propWaveH - 0.25 && sig !== 0) {
            _wheelForce
              .copy(_forward)
              .multiplyScalar(sig * effectivePowerMass * 11.5 * str);
            addForceAtLocal(_wheelForce, _localPos);
          }
        } else if (
          submergedCount > 0 ||
          (this.world.isWaterAt(_wp.x, WATER_LEVEL - 0.15, _wp.z) &&
            _wp.y <= WATER_LEVEL + propWaveH + 2.2)
        ) {
          if (sig !== 0) {
            _wheelForce
              .copy(_forward)
              .multiplyScalar(sig * effectivePowerMass * 16.5 * str);
            addForceAtLocal(_wheelForce, _localPos);
          }
          if (steerInput !== 0) {
            const yawMult = mod.kind === 'BOAT_OUTBOARD' ? 16.5 : 12.5;
            _totalTorque.addScaledVector(
              _up,
              steerInput * this.rigidBody.mass * yawMult * shipRudderBonus,
            );
          }
        }
      }

      // --- STEP 3a.2: BASIC ROTOR PHYSICS (Per-rotor thrust + reaction torque + vertical/horizontal decomposition) ---
      if (this.vtolCount > 0) {
        const cyclicMax = PHYSICS_CONFIG.rotor.cyclicTiltMaxRad;
        const cyclicPitch = hasPilot
          ? (pitchInput + throttle * 0.55) * cyclicMax
          : 0;
        const cyclicRoll = hasPilot ? -rollInput * cyclicMax : 0;

        for (const mod of this.modules) {
          if (mod.kind !== 'VTOL_ROTOR') continue;
          const rotorThrottle = hasPilot
            ? Math.max(
                0,
                Math.min(
                  1.5,
                  0.62 +
                    this.vtolCollective * 0.68 +
                    Math.max(0, throttle) * 0.2,
                ),
              )
            : 0;
          if (rotorThrottle <= 0) continue;

          // 1. Rotor world position
          _localPos.set(
            (mod.vx + 0.5) * VOXEL_SIZE,
            (mod.vy + 0.5) * VOXEL_SIZE,
            (mod.vz + 0.5) * VOXEL_SIZE,
          );
          _wp
            .copy(_localPos)
            .sub(this.comLocal)
            .applyQuaternion(this.rigidBody.quaternion)
            .add(this.rigidBody.position);

          // 2. Rotor normal (rotor's UP axis in world space, transformed by rotor's yaw/pitch/roll + cyclic tilt + vehicle quaternion)
          _steerQ.setFromEuler(
            _modEuler.set(
              ((mod.pitchIdx || 0) & 3) * (Math.PI / 2) + cyclicPitch,
              ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
              ((mod.rollIdx || 0) & 3) * (Math.PI / 2) + cyclicRoll,
              'YXZ',
            ),
          );
          _v2
            .set(0, 1, 0)
            .applyQuaternion(_steerQ)
            .applyQuaternion(this.rigidBody.quaternion)
            .normalize();

          const rotorPower =
            PHYSICS_CONFIG.rotor.defaultPowerNewtons *
            (mod.config?.strength ?? 1.0);

          // 3, 4, 5. Apply decomposed vertical + horizontal thrust at rotor world pos + reaction torque (-rotorNormal * throttle * power * 0.3)
          stepRotorModulePhysics(
            this.rigidBody,
            _wp,
            _v2,
            rotorThrottle,
            rotorPower,
          );
        }

        if (hasPilot) {
          _totalTorque.addScaledVector(
            _right,
            pitchInput * this.rigidBody.mass * 9.5,
          );
          _totalTorque.addScaledVector(
            _forward,
            -rollInput * this.rigidBody.mass * 9.5,
          );
          if (steerInput !== 0) {
            _totalTorque.addScaledVector(
              _up,
              steerInput * this.rigidBody.mass * 12.5,
            );
          }
        }
      }

      // --- AERODYNAMICS: WINGS, SPOILERS (DOWNFORCE), TAILFINS & POWERED ELEVONS ---
      const fwdSpeed = this.rigidBody.velocity.dot(_forward);
      const vertSpeed = this.rigidBody.velocity.dot(_up);
      const latSpeed = this.rigidBody.velocity.dot(_right);

      if (this.wingCount > 0) {
        const aero = computeWingAerodynamics(fwdSpeed, vertSpeed, pitchInput, 3.2);
        const perWingLift = Math.min(
          (this.rigidBody.mass * G * 0.85) / this.wingCount,
          aero.liftForce + Math.max(0, fwdSpeed) * (this.rigidBody.mass / this.wingCount) * 0.2,
        );
        for (const mod of this.modules) {
          const k = mod.kind;
          _localPos.set(
            (mod.vx + 0.5) * VOXEL_SIZE,
            (mod.vy + 0.5) * VOXEL_SIZE,
            (mod.vz + 0.5) * VOXEL_SIZE,
          );
          if (k === 'AERO_WING' || k === 'WING_STANDARD' || k === 'AERO_BLADE') {
            const liftMult = k === 'WING_STANDARD' ? 1.25 : 1.0;
            _wheelForce
              .copy(_up)
              .multiplyScalar(
                (perWingLift - vertSpeed * (this.rigidBody.mass / this.wingCount) * 1.4) *
                  liftMult,
              )
              .addScaledVector(_forward, aero.dragForce / this.wingCount);
            addForceAtLocal(_wheelForce, _localPos);
          } else if (k === 'SPOILER') {
            const downforce =
              -Math.min(this.rigidBody.mass * G * 1.2, fwdSpeed * fwdSpeed * 1.85);
            _wheelForce.copy(_up).multiplyScalar(downforce);
            addForceAtLocal(_wheelForce, _localPos);
          } else if (k === 'TAILFIN' || k === 'TAILFIN_POWERED') {
            const sideDrag = -latSpeed * (this.rigidBody.mass / this.wingCount) * 3.8;
            _wheelForce.copy(_right).multiplyScalar(sideDrag);
            addForceAtLocal(_wheelForce, _localPos);
            if (k === 'TAILFIN_POWERED') {
              const elevSig = this.evalModSignal(
                mod,
                keys,
                hasPilot,
                'ArrowUp',
                'ArrowDown',
              );
              if (elevSig !== 0) {
                _totalTorque.addScaledVector(
                  _right,
                  elevSig * this.rigidBody.mass * 8.5 * (mod.config?.strength ?? 1.0),
                );
              }
            }
          }
        }
        if (hasPilot) {
          _totalTorque.addScaledVector(_right, pitchInput * this.rigidBody.mass * 12.5);
          _totalTorque.addScaledVector(_forward, -rollInput * this.rigidBody.mass * 13.5);
          if (groundedWheels < 2) {
            _totalTorque.addScaledVector(_up, steerInput * this.rigidBody.mass * 8.2);
          }
          if (this.engineCount > 0 && throttle !== 0) {
            _wheelForce.copy(_forward).multiplyScalar(throttle * effectivePowerMass * 11.5);
            this.rigidBody.applyForceAtPoint(_wheelForce, this.rigidBody.position);
          }
        }
      }

      // --- ANTI-GRAV HOVER MOD BLOCKS (Passive upward lift per hover block) ---
      for (let hIdx = 0; hIdx < this.cachedHoverVoxels.length; hIdx++) {
        const hv = this.cachedHoverVoxels[hIdx];
        _localPos.set(
          (hv.vx + 0.5) * VOXEL_SIZE,
          (hv.vy + 0.5) * VOXEL_SIZE,
          (hv.vz + 0.5) * VOXEL_SIZE,
        );
        _wheelForce.set(0, hv.hoverForce, 0);
        addForceAtLocal(_wheelForce, _localPos);
      }

      // --- STEP 3a.3: JET PHYSICS (Thrusters, Rocket Boosters, Raw Jets & Gimbal Hover Jets) ---
      if (this.thrusterCount > 0) {
        const multiJetScale =
          1.0 / (1.0 + Math.max(0, this.thrusterCount - 1) * 0.14);
        const defaultJetPower =
          PHYSICS_CONFIG.jet.defaultPowerNewtons *
          multiJetScale *
          activeGameMode.thrusterPowerMult;
        for (const mod of this.modules) {
          const k = mod.kind;
          if (
            k !== 'THRUSTER' &&
            k !== 'THRUSTER_MINI' &&
            k !== 'THRUSTER_ROCKET' &&
            k !== 'JET_RAW' &&
            k !== 'JET_GIMBAL'
          ) {
            continue;
          }
          const defaultKey = k === 'JET_GIMBAL' ? 'Space' : 'ShiftLeft';
          const sig = this.evalModSignal(
            mod,
            keys,
            hasPilot,
            defaultKey,
            k === 'JET_GIMBAL' ? 'ControlLeft' : undefined,
          );
          if (sig === 0) continue;
          this.isBoostingNow = true;

          const kindMult =
            k === 'THRUSTER_MINI'
              ? 0.45
              : k === 'THRUSTER_ROCKET'
                ? 1.25
                : k === 'JET_RAW'
                  ? 1.5
                  : 1.0;
          const jetPower =
            defaultJetPower * kindMult * (mod.config?.strength ?? 1.0);

          _localPos.set(
            (mod.vx + 0.5) * VOXEL_SIZE,
            (mod.vy + 0.5) * VOXEL_SIZE,
            (mod.vz + 0.5) * VOXEL_SIZE,
          );
          _wp
            .copy(_localPos)
            .sub(this.comLocal)
            .applyQuaternion(this.rigidBody.quaternion)
            .add(this.rigidBody.position);

          if (k === 'JET_GIMBAL') {
            _v2.set(0, 1, 0).applyQuaternion(this.rigidBody.quaternion).normalize();
            stepJetModulePhysics(this.rigidBody, _wp, _v2, sig, jetPower);
          } else {
            _steerQ.setFromEuler(
              _modEuler.set(
                ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
                ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
                ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
                'YXZ',
              ),
            );
            _v2
              .set(0, 0, 1)
              .applyQuaternion(_steerQ)
              .applyQuaternion(this.rigidBody.quaternion)
              .normalize();
            stepJetModulePhysics(this.rigidBody, _wp, _v2, sig, jetPower);
          }

          if (step === 0) {
            const ex = this.localVoxelToWorld(mod.vx, mod.vy, mod.vz - 1, _fxSmokeVec);
            this.fx.spawnDebris(
              ex.x,
              ex.y,
              ex.z,
              Math.random() < 0.5 ? 0x38bdf8 : 0xf59e0b,
              5.5,
              0.85,
            );
          }
        }
      }

      // --- GYRO STABILIZERS (AUTO-HORIZON) & REACTION WHEEL GYROS (MANUAL TORQUE) ---
      let activeGyroStrength =
        this.gyroCount > 0 && this.gyroEnabled ? spaceGyroBonus : 0;
      if (this.gyroCount > 0 && this.gyroEnabled) {
        for (const mod of this.modules) {
          if ((mod.health ?? 1.0) <= 0) continue;
          if (mod.kind === 'GYRO') {
            activeGyroStrength += 22.0 * (mod.config?.strength ?? 1.0);
          } else if (mod.kind === 'GYRO_REACTION') {
            const rxSig = this.evalModSignal(
              mod,
              keys,
              hasPilot,
              'ArrowUp',
              'ArrowDown',
            );
            if (rxSig !== 0) {
              _totalTorque.addScaledVector(
                _right,
                rxSig * this.rigidBody.mass * 14.0 * (mod.config?.strength ?? 1.0),
              );
            }
          }
        }
      }
      if (activeGyroStrength > 0) {
        _crossTmp.crossVectors(
          _up,
          submergedCount > 0 ? _waveTargetNormal : _worldUpVec,
        );
        _totalTorque.addScaledVector(_crossTmp, this.rigidBody.mass * activeGyroStrength);
      }

      // --- ENERGY MELEE WEAPONS (ORIENTED TERRAIN SLICER WITH ZERO SELF-RECOIL) ---
      if (step === 0 && speed > 4.0) {
        for (const mod of this.modules) {
          if (mod.kind !== 'WEAPON_MELEE' || (mod.health ?? 1.0) <= 0) continue;
          _steerQ.setFromEuler(
            _modEuler.set(
              ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
              ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
              ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
              'YXZ',
            ),
          );
          _v2.set(0, 0, 3).applyQuaternion(_steerQ);
          const tipWorld = this.localVoxelToWorld(
            mod.vx + _v2.x,
            mod.vy + _v2.y,
            mod.vz + _v2.z,
            _fxSmokeVec,
          );
          const voxMat = this.world.getMaterialAtWorld(tipWorld.x, tipWorld.y, tipWorld.z);
          if (voxMat !== MAT.AIR && voxMat !== MAT.WATER_VOX) {
            this.world.carveWorldCrater(tipWorld.x, tipWorld.y, tipWorld.z, 2);
            this.fx.spawnWeldSparks(tipWorld.x, tipWorld.y, tipWorld.z);
          }
        }
      }

      const vLen = this.rigidBody.velocity.length();
      if (vLen > 0.4) {
        const aeroCoeff =
          Math.min(0.038, 0.008 + (vLen / topSpeedMPS) * 0.024) *
          (this.rigidBody.mass / Math.max(1.0, 1.0 + engineMultiplier * 0.45));
        _wheelForce
          .copy(this.rigidBody.velocity)
          .multiplyScalar(-aeroCoeff * vLen * 0.14);
        this.rigidBody.applyForceAtPoint(_wheelForce, this.rigidBody.position);
      }

      // Tire-coupled Ackermann yaw torque (pure force/torque physics — no kinematic velocity.lerp override!)
      if (groundedWheels >= 2 && groundedSteerCount > 0 && Math.abs(fwdSpeed) > 0.3) {
        const groundGripRatio = Math.min(1.0, groundedWheels / Math.max(2, numWheels));
        const avgFrontSteer = groundedSteerSum / groundedSteerCount;
        const kinematicYawRate =
          (fwdSpeed * Math.tan(avgFrontSteer)) / Math.max(2.0, wheelbaseMeters);
        const clampedTargetYaw = Math.max(-4.5, Math.min(4.5, kinematicYawRate));
        const yawErr = clampedTargetYaw - this.rigidBody.angularVelocity.y;
        _totalTorque.addScaledVector(
          _up,
          yawErr * this.rigidBody.inertiaTensor.y * 12.0 * avgGroundedMu * groundGripRatio,
        );
      }

      const yawDampCoeff = groundedWheels >= 2 ? 1.45 : 3.8;
      const pitchRollDamp = submergedCount > 0 ? 2.1 : 4.2;
      _totalTorque.x -= this.rigidBody.angularVelocity.x * this.rigidBody.inertiaTensor.x * pitchRollDamp;
      _totalTorque.y -= this.rigidBody.angularVelocity.y * this.rigidBody.inertiaTensor.y * yawDampCoeff;
      _totalTorque.z -= this.rigidBody.angularVelocity.z * this.rigidBody.inertiaTensor.z * pitchRollDamp;

      // Apply accumulated rotational torques to CustomRigidBody
      this.rigidBody.applyTorque(_totalTorque);

      // Hydraulic Piston Ground Push Force
      if (this.pistonExtRatio > 0.05 && this.pistonCount > 0) {
        for (const mod of this.modules) {
          if (mod.kind !== 'PISTON') continue;
          _localPos.set(
            (mod.vx + 0.5) * VOXEL_SIZE,
            (mod.vy + 0.5) * VOXEL_SIZE,
            (mod.vz + 0.5) * VOXEL_SIZE,
          );
          _wp
            .copy(_localPos)
            .sub(this.comLocal)
            .applyQuaternion(this.rigidBody.quaternion)
            .add(this.rigidBody.position);
          const gnd = this.world.probeGroundBelow(_wp.x, _wp.y, _wp.z, 0.5);
          const reach = 0.55 + this.pistonExtRatio * 0.95;
          const distGnd = _wp.y - gnd.y;
          if (distGnd < reach) {
            const pushUp = (reach - distGnd) * this.rigidBody.mass * G * 2.4;
            _wheelForce.set(0, pushUp, 0);
            addForceAtLocal(_wheelForce, _localPos);
          }
        }
      }

      // 104. Deployable Parachute & Airbrake Aerodynamic Drag + Upright Stabilization
      if (this.parachuteDeployed) {
        for (const mod of this.modules) {
          if (mod.kind !== 'PARACHUTE_AIRBRAKE' || (mod.health ?? 1.0) <= 0) continue;
          const str = mod.config?.strength ?? 1.0;
          _localPos.set(
            (mod.vx + 0.5) * VOXEL_SIZE,
            (mod.vy + 1.2) * VOXEL_SIZE,
            (mod.vz + 0.5) * VOXEL_SIZE,
          );
          _wheelForce
            .copy(this.rigidBody.velocity)
            .multiplyScalar(-this.rigidBody.mass * 2.8 * str);
          if (this.rigidBody.velocity.y < -2.0) {
            _wheelForce.y = -this.rigidBody.velocity.y * this.rigidBody.mass * 5.2 * str;
          }
          addForceAtLocal(_wheelForce, _localPos);
        }
      }

      // 105. Hydraulic Outrigger Stabilizer Jacks (Ground Anchoring & Recoil Damping)
      if (this.outriggerExtRatio > 0.25) {
        for (const mod of this.modules) {
          if (mod.kind !== 'OUTRIGGER_JACK' || (mod.health ?? 1.0) <= 0) continue;
          _localPos.set(
            (mod.vx + 0.5) * VOXEL_SIZE,
            (mod.vy + 0.5) * VOXEL_SIZE,
            (mod.vz + 0.5) * VOXEL_SIZE,
          );
          _wp
            .copy(_localPos)
            .sub(this.comLocal)
            .applyQuaternion(this.rigidBody.quaternion)
            .add(this.rigidBody.position);
          const gnd = this.world.probeGroundBelow(_wp.x, _wp.y, _wp.z, 0.5);
          const reach = 0.65 + this.outriggerExtRatio * 0.85;
          const distGnd = _wp.y - gnd.y;
          if (distGnd < reach) {
            const supportUp = (reach - distGnd) * this.rigidBody.mass * G * 3.2;
            const anchorDampX = -this.rigidBody.velocity.x * this.rigidBody.mass * 14.0;
            const anchorDampZ = -this.rigidBody.velocity.z * this.rigidBody.mass * 14.0;
            _wheelForce.set(anchorDampX, supportUp, anchorDampZ);
            addForceAtLocal(_wheelForce, _localPos);
            this.rigidBody.angularVelocity.multiplyScalar(0.88);
          }
        }
      }

      // 102 & 106. Electromagnetic Magnet/Tractor Coupler & Kinetic Spring Impulse Bumper (evaluated once per frame on step === 0)
      if (step === 0 && this.fx?.rigs && this.fx.rigs.length > 1) {
        for (const mod of this.modules) {
          if ((mod.health ?? 1.0) <= 0) continue;
          if (mod.kind === 'MAGNET_COUPLER') {
            const sig = this.evalModSignal(mod, keys, hasPilot, 'KeyK', 'KeyL');
            const activeMode =
              sig > 0
                ? 'ATTRACT'
                : sig < 0
                  ? 'REPEL'
                  : this.magnetActiveMode;
            if (activeMode !== 'OFF') {
              const dirSign = activeMode === 'ATTRACT' ? -1 : 1;
              const str = (mod.config?.strength ?? 1.0) * 26.0;
              const wp = this.localVoxelToWorld(mod.vx, mod.vy, mod.vz, _v1);
              for (const other of this.fx.rigs) {
                if (other === this || other.inBuildMode) continue;
                const d = other.position.distanceTo(wp);
                if (d > 1.2 && d < 16.0) {
                  _v2.copy(other.position).sub(wp).normalize();
                  const accel = (str * (1 - d / 16.0)) * dirSign;
                  other.velocity.addScaledVector(_v2, accel * dt);
                  other.rigidBody.velocity.copy(other.velocity);
                  if (other.rigidBody.isSleeping) other.rigidBody.wake();
                }
              }
            }
          } else if (mod.kind === 'IMPULSE_BUMPER') {
            const wp = this.localVoxelToWorld(mod.vx, mod.vy, mod.vz, _v1);
            const str = mod.config?.strength ?? 1.3;
            for (const other of this.fx.rigs) {
              if (other === this || other.inBuildMode) continue;
              const d = other.position.distanceTo(wp);
              if (d < 2.65) {
                _v2.copy(other.position).sub(wp);
                _v2.y = Math.max(0.25, _v2.y + 0.25);
                _v2.normalize();
                const knockSpeed = Math.max(12.0, speed * 1.45) * str;
                other.velocity.addScaledVector(_v2, knockSpeed);
                other.rigidBody.velocity.copy(other.velocity);
                if (other.rigidBody.isSleeping) other.rigidBody.wake();
                this.velocity.addScaledVector(_v2, -knockSpeed * 0.25);
                this.rigidBody.velocity.copy(this.velocity);
                SoundFX.clank(16);
                this.fx.spawnWeldSparks(wp.x, wp.y, wp.z);
              }
            }
          }
        }
      }

      // Grappling Tow Winch Spring-Damper Cable Force ([G] / [T] Key)
      if (this.winchAnchorWorld) {
        const winchMod = this.modules.find(
          (m) => m.kind === 'GRAPPLING_WINCH' && (m.health ?? 1.0) > 0,
        );
        if (this.winchCount <= 0 || !winchMod) {
          this.releaseGrappleWinch();
        } else {
          if (this.winchTargetRig && !this.winchTargetRig.inBuildMode) {
            this.winchAnchorWorld.copy(
              this.winchTargetRig.localMetricToWorld(this.winchTargetLocalPos),
            );
          }
          if (!this.winchTargetRig && this.winchRestLength > 1.8) {
            this.winchRestLength = Math.max(1.8, this.winchRestLength - subDt * 6.5);
          }
          _localPos.set(
            (winchMod.vx + 0.5) * VOXEL_SIZE,
            (winchMod.vy + 0.5) * VOXEL_SIZE,
            (winchMod.vz + 0.5) * VOXEL_SIZE,
          );
          _v1
            .copy(_localPos)
            .sub(this.comLocal)
            .applyQuaternion(this.rigidBody.quaternion)
            .add(this.rigidBody.position);

        _v2.copy(this.winchAnchorWorld).sub(_v1);
        const distAnchor = _v2.length();
        if (distAnchor > 1.65) {
          const cableDir = _v2.normalize();
          const stretch = Math.max(0.25, distAnchor - this.winchRestLength);
          if (this.winchTargetRig) {
            _v3.copy(this.rigidBody.velocity).sub(this.winchTargetRig.rigidBody.velocity);
          } else {
            _v3.copy(this.rigidBody.velocity);
          }
          const relVelAlongCable = _v3.dot(cableDir);
          const kWinch = this.rigidBody.mass * 7.5;
          const cWinch = this.rigidBody.mass * 2.8;
          const tensionForceMag = Math.max(
            this.rigidBody.mass * 12.0,
            Math.min(this.rigidBody.mass * 34.0, stretch * kWinch - relVelAlongCable * cWinch),
          );
          _wheelForce.copy(cableDir).multiplyScalar(tensionForceMag);
          addForceAtLocal(_wheelForce, _localPos);

          if (this.winchTargetRig && !this.winchTargetRig.inBuildMode) {
            const towAccel = tensionForceMag / Math.max(150, this.winchTargetRig.rigidBody.mass);
            this.winchTargetRig.rigidBody.velocity.addScaledVector(cableDir, -towAccel * subDt * 0.65);
            this.winchTargetRig.velocity.copy(this.winchTargetRig.rigidBody.velocity);
          }
        } else if (!this.winchTargetRig) {
          this.releaseGrappleWinch();
        }
        }
      }

      // Per-point voxel-tuned ground collision solver (Step 1.3):
      // Evaluates sampled surface voxel collision points against both terrain and other vehicles' voxel ramps/decks
      const _tGroundCol0 = typeof performance !== 'undefined' ? performance.now() : 0;
      const groundColResult = resolveVehicleGroundCollisions(
        this.rigidBody,
        {
          probeGroundBelow: (wx, startY, wz, maxDist) =>
            this.probeGroundAndVehiclesBelow(wx, startY, wz, maxDist),
          probeCeilingAbove: (wx, wy, wz, maxDist) =>
            this.world.probeCeilingAbove(wx, wy, wz, maxDist),
        },
        subDt,
        {
          forwardFrictionScale: tuningProfile.forwardFrictionScale,
          lateralFrictionScale: tuningProfile.lateralFrictionScale,
          springStiffnessScale: tuningProfile.groundSpringScale,
          throttleInput: throttle,
        },
      );
      const _groundColElapsed = _tGroundCol0 > 0 ? performance.now() - _tGroundCol0 : 0;
      if (groundColResult.contactCount > 0 || groundColResult.snappedToRest) {
        groundedHullContacts += Math.max(1, groundColResult.contactCount);
      }
      if (groundColResult.brokenCrunchyVoxelKeys.length > 0) {
        for (let b = 0; b < groundColResult.brokenCrunchyVoxelKeys.length; b++) {
          const bKey = groundColResult.brokenCrunchyVoxelKeys[b];
          const [bvx, bvy, bvz] = unpackVoxelKey(bKey);
          const bMat = this.getVoxel(bvx, bvy, bvz);
          if (bMat !== MAT.AIR) {
            this.setVoxel(bvx, bvy, bvz, MAT.AIR);
            const wpBreak = this.localVoxelToWorld(bvx, bvy, bvz);
            const color = MAT_INFO[bMat]?.color ?? 0xf59e0b;
            this.fx.spawnDebris(wpBreak.x, wpBreak.y, wpBreak.z, color, 6.5, 1.0);
          }
        }
        this.pendingPhysicsHullRebuild = true;
      }

      // BUG 3 Resting Stiction Hold:
      // When no throttle, boost, or winch is active and the vehicle is grounded at near-zero horizontal speed (< 0.08 m/s)
      // with no recent collision, zero out residual horizontal drift so a parked vehicle stays 100% still!
      const noActiveDrive =
        Math.abs(engineThrottleSignal) < 1e-4 &&
        Math.abs(throttle) < 1e-4 &&
        !this.isBoostingNow &&
        !this.winchAnchorWorld &&
        submergedCount === 0;
      const isGroundedOnTerrain =
        groundedWheels > 0 || groundColResult.contactCount > 0;
      if (
        noActiveDrive &&
        isGroundedOnTerrain &&
        this.rigidBody.timeSinceLastCollision >=
          PHYSICS_CONFIG.groundCollision.recentCollisionWindowSec
      ) {
        const horizSpeed = Math.hypot(
          this.rigidBody.velocity.x,
          this.rigidBody.velocity.z,
        );
        if (horizSpeed < 0.08) {
          this.rigidBody.velocity.x = 0;
          this.rigidBody.velocity.z = 0;
          this.rigidBody.accumulatedForce.x = 0;
          this.rigidBody.accumulatedForce.z = 0;
          if (
            Math.abs(this.rigidBody.velocity.y) < 0.05 &&
            this.rigidBody.angularVelocity.length() < 0.08
          ) {
            this.rigidBody.velocity.y = 0;
            this.rigidBody.angularVelocity.set(0, 0, 0);
            this.rigidBody.accumulatedForce.y = 0;
            this.rigidBody.accumulatedTorque.set(0, 0, 0);
          }
        }
      }

      // Integrate rigid-body substep directly in VoxelWorld SoA arrays
      this.rigidBody.integrateSubstep(subDt);

      // Multi-Point 3D Voxel Hull Wall Collision (for vertical cliffs & solid obstacle impacts)
      // Uses impulse resolution + Baumgarte position stabilization (80% of penetration > 0.01m, summed across points and capped at 0.5m/frame)
      const _tWallCol0 = typeof performance !== 'undefined' ? performance.now() : 0;
      let appliedWallImpulseThisSubstep = false;
      for (let i = 0; i < this.collisionPoints.length; i++) {
        const cp = this.collisionPoints[i];
        _localPos.set(cp.x, cp.y, cp.z);
        _rVec
          .copy(_localPos)
          .sub(this.comLocal)
          .applyQuaternion(this.rigidBody.quaternion);
        _wp.copy(this.rigidBody.position).add(_rVec);

        let mat = this.world.getMaterialAtWorld(_wp.x, _wp.y, _wp.z);
        let hitMapHazard: any = null;
        if (mat === MAT.AIR || mat === MAT.WATER_VOX) {
          const mapHazards = this.fx?.mapHazards;
          if (mapHazards && mapHazards.length > 0) {
            for (let hIdx = 0; hIdx < mapHazards.length; hIdx++) {
              const haz = mapHazards[hIdx];
              if (!haz || typeof haz.getSolidVoxelMaterialAtWorld !== 'function') continue;
              if (
                Math.abs(_wp.x - haz.position.x) > 4.5 ||
                Math.abs(_wp.z - haz.position.z) > 4.5
              ) {
                continue;
              }
              const hMat = haz.getSolidVoxelMaterialAtWorld(_wp.x, _wp.y, _wp.z);
              if (hMat !== MAT.AIR) {
                mat = hMat;
                hitMapHazard = haz;
                break;
              }
            }
          }
        }
        if (mat !== MAT.AIR && mat !== MAT.WATER_VOX) {
          _crossTmp.crossVectors(this.rigidBody.angularVelocity, _rVec);
          _contactVel.copy(this.rigidBody.velocity).add(_crossTmp);

          // Fast vertical check: if air is 2 voxels above, it's floor/step unless slamming down hard or moving fast horizontally!
          const matAbove = hitMapHazard
            ? hitMapHazard.getSolidVoxelMaterialAtWorld(_wp.x, _wp.y + 0.4, _wp.z)
            : this.world.getMaterialAtWorld(_wp.x, _wp.y + 0.4, _wp.z);
          const horizontalSpeed = Math.hypot(_contactVel.x, _contactVel.z);
          const isFloorOrStep =
            (matAbove === MAT.AIR || matAbove === MAT.WATER_VOX) &&
            _contactVel.y <= 0.5 &&
            horizontalSpeed < 2.5;
          if (isFloorOrStep) {
            if (_contactVel.y < -10.5) {
              const downSpeed = Math.abs(_contactVel.y);
              if (!pendingCrash || downSpeed > pendingCrash.impactSpeed) {
                pendingCrash = {
                  x: _wp.x,
                  y: _wp.y,
                  z: _wp.z,
                  impactSpeed: downSpeed,
                };
              }
            }
            continue;
          }

          let wallNormal: Vec3;
          if (hitMapHazard) {
            const dxH = _wp.x - hitMapHazard.position.x;
            const dzH = _wp.z - hitMapHazard.position.z;
            const dLen = Math.hypot(dxH, dzH);
            if (dLen > 0.05) {
              wallNormal = { x: dxH / dLen, y: 0, z: dzH / dLen };
            } else {
              wallNormal = { x: 0, y: 1, z: 0 };
            }
          } else {
            const norm = this.world.computeSurfaceNormalAt(_wp.x, _wp.y, _wp.z);
            const horizLen = Math.hypot(norm.x, norm.z);
            if (horizLen > 0.1) {
              wallNormal = { x: norm.x / horizLen, y: 0, z: norm.z / horizLen };
            } else {
              // Fallback if point is deep inside a wall where local 1-voxel gradient is zero: push opposite horizontal velocity
              const vHoriz = Math.hypot(this.rigidBody.velocity.x, this.rigidBody.velocity.z);
              if (vHoriz > 0.1) {
                wallNormal = {
                  x: -this.rigidBody.velocity.x / vHoriz,
                  y: 0,
                  z: -this.rigidBody.velocity.z / vHoriz,
                };
              } else {
                wallNormal = { x: 0, y: 1, z: 0 };
              }
            }
          }

          // Compute wall penetration depth by marching along wallNormal in half-voxel (0.12m) steps
          let wallPenetration = VOXEL_SIZE * 0.5;
          for (let stepM = 1; stepM <= 5; stepM++) {
            const probeDist = stepM * 0.12;
            const px = _wp.x + wallNormal.x * probeDist;
            const py = _wp.y + wallNormal.y * probeDist;
            const pz = _wp.z + wallNormal.z * probeDist;
            const probeMat = hitMapHazard
              ? hitMapHazard.getSolidVoxelMaterialAtWorld(px, py, pz)
              : this.world.getMaterialAtWorld(px, py, pz);
            if (probeMat === MAT.AIR || probeMat === MAT.WATER_VOX) {
              wallPenetration = probeDist;
              break;
            }
            wallPenetration = probeDist;
          }

          // Deep penetration (> 55% of a voxel) break-through logic (capped at 3 break-throughs per frame)
          if (wallPenetration > VOXEL_SIZE * 0.55) {
            if (breakThroughsThisFrame < 3) {
              const rawMat = mat & 63;
              const impactSpeed = _contactVel.length();
              if (
                _wp.y >= VOXEL_SIZE * 1.5 &&
                rawMat !== MAT.WATER_VOX &&
                (rawMat !== MAT.ARMOR_SLATE || impactSpeed > 8.0)
              ) {
                const { vx: tvx, vy: tvy, vz: tvz } = this.world.worldToVoxelCoords(
                  _wp.x,
                  _wp.y,
                  _wp.z,
                );
                const cVx = Math.floor(cp.x / VOXEL_SIZE);
                const cVy = Math.floor(cp.y / VOXEL_SIZE);
                const cVz = Math.floor(cp.z / VOXEL_SIZE);
                const brokenChunk = this.world.markVoxelPendingRemoval(
                  tvx,
                  tvy,
                  tvz,
                  MAT.AIR,
                );
                if (brokenChunk) {
                  this.world.rebuildChunkAsync(brokenChunk);
                }
                if (rawMat === MAT.C4_EXPLOSIVE) {
                  if ((this.getVoxel(cVx, cVy, cVz) & 63) === MAT.C4_EXPLOSIVE) {
                    igniteC4Voxel(this, packVoxelKey(cVx, cVy, cVz));
                  }
                  this.world.consumeTriggeredExplosiveBarrels(_wp.x, _wp.y, _wp.z, 3.0);
                  this.fx?.carveWorldCrater(_wp.x, _wp.y, _wp.z, 6, 0, true);
                }
                const colorHex = MAT_INFO[rawMat]?.color ?? 0x94a3b8;
                terrainEntityManager.spawnTerrainVoxelDebris(
                  _wp.x,
                  _wp.y,
                  _wp.z,
                  colorHex,
                  this.position.x,
                  this.position.y,
                  this.position.z,
                  this.world.scene,
                );
                if (impactSpeed > 3.0) {
                  const vehicleDamage = Math.min(60, impactSpeed * 4.0);
                  applyDamageToVoxel(
                    this,
                    packVoxelKey(cVx, cVy, cVz),
                    vehicleDamage,
                    _wp,
                    this.fx?.voxelDebrisSystem,
                  );
                }
                this.rigidBody.position.x += wallNormal.x * 0.02;
                this.rigidBody.position.y += wallNormal.y * 0.02;
                this.rigidBody.position.z += wallNormal.z * 0.02;
                breakThroughsThisFrame++;
                continue;
              }
            }
          }

          if (!appliedWallImpulseThisSubstep) {
            const spec = MAT_INFO[mat] || MAT_INFO[MAT.BRICK];
            const wallProfile = getMaterialFrictionProfile(mapVoxelMatToMaterialType(mat));
            const colRes = computeCollisionImpulse(
              { x: _contactVel.x, y: _contactVel.y, z: _contactVel.z },
              wallNormal,
              { x: _rVec.x, y: _rVec.y, z: _rVec.z },
              this.rigidBody.mass,
              {
                x: this.rigidBody.inertiaTensor.x,
                y: this.rigidBody.inertiaTensor.y,
                z: this.rigidBody.inertiaTensor.z,
              },
              Math.max(spec.restitution, wallProfile.restitution),
              wallProfile.forwardFriction,
              spec.yieldEnergy,
            );

            const vn =
              _contactVel.x * wallNormal.x +
              _contactVel.y * wallNormal.y +
              _contactVel.z * wallNormal.z;
            const vnAbs = Math.abs(vn);
            const effectiveCrashSpeed = Math.max(vnAbs, this.rigidBody.velocity.length() * 0.72);

            if (vnAbs > 2.0) {
              SoundFX.clank(vnAbs * 2.5);
            }

            if (colRes.shattersVoxel || effectiveCrashSpeed > 6.5) {
              if (!pendingCrash || effectiveCrashSpeed > pendingCrash.impactSpeed) {
                pendingCrash = {
                  x: _wp.x,
                  y: _wp.y,
                  z: _wp.z,
                  impactSpeed: effectiveCrashSpeed,
                };
              }
            }

            // Step 2.4: Apply per-voxel HP damage to the impacted vehicle voxel on wall collision
            if (vnAbs > 2.2) {
              const cVx = Math.floor(cp.x / VOXEL_SIZE);
              const cVy = Math.floor(cp.y / VOXEL_SIZE);
              const cVz = Math.floor(cp.z / VOXEL_SIZE);
              const cMat = this.getVoxel(cVx, cVy, cVz);
              if (cMat !== MAT.AIR) {
                const impMag = Math.hypot(
                  colRes.impulse.x,
                  colRes.impulse.y,
                  colRes.impulse.z,
                );
                const wallDmg = computeCollisionVoxelDamage(
                  Math.max(impMag, vnAbs * this.rigidBody.mass * 0.35),
                  mapVoxelMatToMaterialType(cMat),
                  _v2.set(wallNormal.x, wallNormal.y, wallNormal.z),
                  _forward,
                  mapVoxelMatToMaterialType(mat),
                );
                if (wallDmg > 0) {
                  applyDamageToVoxel(
                    this,
                    packVoxelKey(cVx, cVy, cVz),
                    wallDmg,
                    _wp,
                    this.fx?.voxelDebrisSystem,
                  );
                }
              }
            }

            _v1.set(colRes.impulse.x, colRes.impulse.y, colRes.impulse.z);
            this.rigidBody.applyImpulseAtPoint(_v1, _wp);

            // Ensure inward normal velocity is reflected out of the wall even when shattering voxels
            const postVn =
              this.rigidBody.velocity.x * wallNormal.x +
              this.rigidBody.velocity.y * wallNormal.y +
              this.rigidBody.velocity.z * wallNormal.z;
            if (postVn < 0) {
              const bounceRestitution = Math.max(0.18, wallProfile.restitution);
              const deltaVn = -(1.0 + bounceRestitution) * postVn;
              this.rigidBody.velocity.x += wallNormal.x * deltaVn;
              this.rigidBody.velocity.y += wallNormal.y * deltaVn;
              this.rigidBody.velocity.z += wallNormal.z * deltaVn;
            }

            this.rigidBody.velocity.clampLength(0, 48.0);
            this.rigidBody.angularVelocity.clampLength(0, 4.2);
            appliedWallImpulseThisSubstep = true;
          }

          // Baumgarte Position Correction (in addition to impulse, summed across all penetrating points and capped at 0.5m)
          if (wallPenetration > BAUMGARTE_MIN_PENETRATION_METERS) {
            _v2.set(wallNormal.x, wallNormal.y, wallNormal.z);
            applyBaumgartePositionCorrection(
              this.rigidBody,
              this.position,
              _v2,
              wallPenetration,
              1.0,
            );
          }
        }
      }

      // Only use center ground fallback when vehicle has 0 sampled collision points (BUG B: never push small wheel-less vehicles up above ground!)
      if (this.rigidBody.collisionPoints.length === 0) {
        const groundCenter = this.world.probeGroundBelow(
          this.rigidBody.position.x,
          this.rigidBody.position.y,
          this.rigidBody.position.z,
          0.4,
        );
        const minComClearance = Math.max(
          0,
          this.comLocal.y - (this.minVY + 0.5) * VOXEL_SIZE,
        );
        if (this.rigidBody.position.y < groundCenter.y + minComClearance) {
          const floorProfile = getMaterialFrictionProfile(
            mapVoxelMatToMaterialType(groundCenter.mat),
          );
          this.rigidBody.position.y = groundCenter.y + minComClearance;
          groundedHullContacts++;
          if (this.rigidBody.velocity.y < 0) {
            this.rigidBody.velocity.y =
              Math.abs(this.rigidBody.velocity.y) < 0.25
                ? 0
                : -this.rigidBody.velocity.y *
                  Math.max(0.05, floorProfile.restitution * 0.5);
          }
        }
      }
      if (_tWallCol0 > 0) {
        perfProfiler.recordBodyCollisionCheck(
          _groundColElapsed + (performance.now() - _tWallCol0),
        );
      }
    }

    // Update sleep timer when grounded (via wheels or hull contact) and no active driver command is present
    if (
      !hasDriverCommand &&
      (groundedWheels > 0 || groundedHullContacts > 0) &&
      submergedCount === 0
    ) {
      this.rigidBody.updateSleep(dt);
    } else {
      this.rigidBody.wake();
    }
    this.isSteppingPhysics = false;

    // Apply real-time vehicle + world crash destruction when colliding at speed!
    if (pendingCrash && this.crashCooldown <= 0) {
      this.crashCooldown = 0.14;
      const crashRad = Math.min(
        6,
        Math.max(2, Math.floor(pendingCrash.impactSpeed * 0.34)),
      );
      this.carveVehicleCrater(
        pendingCrash.x,
        pendingCrash.y,
        pendingCrash.z,
        crashRad,
        pendingCrash.impactSpeed * 0.32,
      );
      this.fx.carveWorldCrater(
        pendingCrash.x,
        pendingCrash.y,
        pendingCrash.z,
        Math.min(5, crashRad),
        0,
        false,
      );
    }

    this.isDrifting = maxSlipThisFrame > 0.40 && speed > 3.0 && groundedWheels > 0;
    if (this.isDrifting && speed > 5.0 && this.skidCooldown <= 0) {
      SoundFX.skid();
      this.skidCooldown = 0.12;
    }
    if (isSeatedDriver) {
      SoundFX.updateSurfaceSkidAudio(
        maxSlipThisFrame,
        true,
        this.speedKmh,
        isSeatedDriver,
      );
    }

    const accelMag = _v1
      .copy(this.velocity)
      .sub(this.prevVelocity)
      .divideScalar(Math.max(0.008, dt))
      .length();
    this.gForce = 1.0 + accelMag / 9.81;
    this.speedKmh = Math.round(this.velocity.length() * 3.6);
    this.altitudeMeters = Number((this.position.y - WATER_LEVEL).toFixed(1));
    this.engineRpm = Math.round(
      850 + Math.min(6200, this.velocity.length() * 185 + Math.abs(throttle) * 1400),
    );

    _forward.set(sinDrive, 0, cosDrive).applyQuaternion(this.quaternion);
    _right.set(cosDrive, 0, -sinDrive).applyQuaternion(this.quaternion);
    this.heading = Math.atan2(_forward.x, _forward.z);
    this.pitchDeg = Math.round(
      Math.asin(Math.max(-1, Math.min(1, _forward.y))) * 57.2958,
    );
    this.rollDeg = Math.round(
      Math.asin(Math.max(-1, Math.min(1, _right.y))) * 57.2958,
    );

    if (this.voxelCount === 0 && this.modules.length === 0) {
      this.statusLabel = 'DESTROYED [G TO REPAIR]';
    } else if (submergedCount > 0) {
      this.statusLabel = 'FLOATING (SEA)';
    } else if (this.vtolCount > 0 && groundedWheels === 0) {
      this.statusLabel = 'VTOL HOVER';
    } else if (groundedWheels > 0) {
      this.statusLabel = `GROUNDED (${groundedWheels}W)`;
    } else {
      this.statusLabel = 'AIRBORNE';
    }

    if (this.winchAnchorWorld && !this.inBuildMode) {
      const spoolWorld = this.getWinchSpoolWorldPos();
      const posArr = this.winchLineMesh.geometry.attributes
        .position as THREE.BufferAttribute;
      posArr.setXYZ(0, spoolWorld.x, spoolWorld.y, spoolWorld.z);
      posArr.setXYZ(
        1,
        this.winchAnchorWorld.x,
        this.winchAnchorWorld.y,
        this.winchAnchorWorld.z,
      );
      posArr.needsUpdate = true;
      this.winchLineMesh.visible = true;

      // Position & scale the taut 3D cylindrical steel cable + 3-prong grapple claw
      _v1.copy(spoolWorld).add(this.winchAnchorWorld).multiplyScalar(0.5);
      const cableLen = Math.max(0.1, spoolWorld.distanceTo(this.winchAnchorWorld));
      this.winchCableCylinderMesh.position.copy(_v1);
      this.winchCableCylinderMesh.scale.set(1, 1, cableLen);
      this.winchCableCylinderMesh.lookAt(this.winchAnchorWorld);
      this.winchCableCylinderMesh.visible = true;

      this.winchHookMesh.position.copy(this.winchAnchorWorld);
      this.winchHookMesh.lookAt(spoolWorld);
      this.winchHookMesh.visible = true;
    } else if (
      this.winchLineMesh.visible ||
      this.winchCableCylinderMesh.visible ||
      this.winchHookMesh.visible
    ) {
      this.winchLineMesh.visible = false;
      this.winchCableCylinderMesh.visible = false;
      this.winchHookMesh.visible = false;
    }

    this.updateVehicleVisuals(dt, throttle, this.isBoostingNow);
    this.syncToVoxelWorld();
  }

  /**
   * Returns current wheel spin angles (radians) for P2P STATE_SYNC packets.
   */
  getWheelSpinAngles(): number[] {
    const angles: number[] = [];
    for (const mod of this.modules) {
      if (mod.wheelMesh) {
        const rollGroup = (mod.wheelMesh.userData.rollGroup || mod.mesh?.userData.rollGroup) as THREE.Object3D | undefined;
        if (rollGroup) {
          angles.push(Number(rollGroup.rotation.x.toFixed(2)));
        } else if (mod.wheelMesh.children.length > 0) {
          angles.push(Number(mod.wheelMesh.children[0].rotation.x.toFixed(2)));
        }
      }
    }
    return angles;
  }

  /**
   * Applies remote wheel steering, spin angles, booster particles, and headlights from STATE_SYNC.
   */
  applyRemoteSyncState(
    steerAngle: number,
    wheelAngles: number[],
    boostActive: boolean,
    lightsOn: boolean,
  ): void {
    this.steerAngle = steerAngle;
    this.isBoostingNow = boostActive;
    this.headlightsOn = lightsOn;
    let wIdx = 0;
    for (const mod of this.modules) {
      if (mod.wheelMesh) {
        if (mod.kind === 'WHEEL_STEER' || mod.kind === 'SKI_SLIDER') {
          mod.wheelMesh.rotation.y = steerAngle;
        }
        const spin = wheelAngles[wIdx] ?? 0;
        wIdx++;
        const rollGroup = (mod.wheelMesh.userData.rollGroup || mod.mesh?.userData.rollGroup) as THREE.Object3D | undefined;
        if (rollGroup) {
          rollGroup.rotation.x = spin;
        } else {
          mod.wheelMesh.children.forEach((ch) => {
            ch.rotation.x = spin;
          });
        }
      }
    }
  }

  public isDisposed = false;

  dispose(): void {
    this.isDisposed = true;
    const idx = this.fx.rigs.indexOf(this);
    if (idx >= 0) this.fx.rigs.splice(idx, 1);
    (this.rootGroup as any).voxelWorldRef = null;
    (this.rootGroup as any).voxelBodySlot = -1;
    this.rapierBridge.dispose();
    this.rigidBody.dispose();
    this.clearAll();
    if (this.chassisOutlineMesh) {
      this.rootGroup.remove(this.chassisOutlineMesh);
      if (
        this.chassisOutlineMesh.geometry &&
        this.chassisOutlineMesh.geometry !== this.chassisMesh?.geometry
      ) {
        this.chassisOutlineMesh.geometry.dispose();
      }
      this.chassisOutlineMesh = null;
    }
    if (this.chassisMesh) {
      this.rootGroup.remove(this.chassisMesh);
      disposeSmoothedOutlineGeometry(this.chassisMesh.geometry);
      this.chassisMesh.geometry.dispose();
      this.chassisMesh = null;
    }
    if (this.chassisTransMesh) {
      this.rootGroup.remove(this.chassisTransMesh);
      this.chassisTransMesh.geometry.dispose();
      this.chassisTransMesh = null;
    }
    while (this.ghostGroup.children.length > 0) {
      const ch = this.ghostGroup.children[0];
      this.ghostGroup.remove(ch);
      disposeModuleGroupGeometries(ch);
    }
    const disposeObjectTree = (root: THREE.Object3D | null | undefined) => {
      if (!root) return;
      root.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry && !(obj as THREE.Mesh).geometry.userData?.isSharedPrimitive) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else if (mat && typeof (mat as THREE.Material).dispose === 'function') {
          (mat as THREE.Material).dispose();
        }
      });
    };
    disposeObjectTree(this.comMarker);
    disposeObjectTree(this.cobMarker);
    disposeObjectTree(this.cotMarker);
    disposeObjectTree(this.symmetryPlane);
    disposeObjectTree(this.hoverRingGroup);
    disposeObjectTree(this.winchLineMesh);
    disposeObjectTree(this.winchCableCylinderMesh);
    disposeObjectTree(this.winchHookMesh);
    disposeObjectTree(this.wiringLaserLine);
    disposeObjectTree(this.wiringLinesGroup);
    disposeObjectTree(this.ghostBlueprintGroup);

    this.scene.remove(this.rootGroup);
    this.scene.remove(this.hoverRingGroup);
    this.scene.remove(this.contactShadowMesh);
    this.scene.remove(this.winchLineMesh);
    this.scene.remove(this.winchCableCylinderMesh);
    this.scene.remove(this.winchHookMesh);
    this.scene.remove(this.wiringLaserLine);
    this.scene.remove(this.headlightSpot);
    this.scene.remove(this.headlightTarget);
    this.scene.remove(this.headlightCaveFill);
    this.headlightSpot.dispose();
    this.headlightCaveFill.dispose();
    if (this.aiBadgeSprite) {
      this.scene.remove(this.aiBadgeSprite);
      (this.aiBadgeSprite.material as THREE.Material).dispose();
      this.aiBadgeSprite = null;
    }
    if (this.aiBadgeTexture) {
      this.aiBadgeTexture.dispose();
      this.aiBadgeTexture = null;
    }
    this.aiBadgeCanvas = null;
  }

  /**
   * Returns the primary CSS hex color (e.g. '#38bdf8') of this vehicle's 3D chassis paint
   * for rendering the vehicle dot on the Full-Screen 2D Map (BUG 4).
   */
  public getPrimaryPaintColorHex(): string {
    const counts = new Map<number, number>();
    let bestMat: number = MAT.ALLOY_BLUE;
    let bestCount = 0;
    for (const [, rawVal] of this.voxelMap.entries()) {
      const mat = rawVal & 63;
      if (
        mat === MAT.AIR ||
        mat === MAT.GLASS_SOLID ||
        mat === MAT.ARMOR_SLATE ||
        mat === MAT.PAINT_CARBON ||
        mat === MAT.ASPHALT
      ) {
        continue;
      }
      const next = (counts.get(mat) || 0) + 1;
      counts.set(mat, next);
      if (next > bestCount) {
        bestCount = next;
        bestMat = mat;
      }
    }
    const hexNum = MAT_INFO[bestMat]?.color ?? 0x38bdf8;
    return `#${hexNum.toString(16).padStart(6, '0')}`;
  }
}

export { ModularVehicleRig as Vehicle };

