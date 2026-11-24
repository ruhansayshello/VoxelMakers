import * as THREE from 'three';
import {
  MAT,
  MAT_INFO,
  VOXEL_SIZE,
  WATER_LEVEL,
} from './constants.ts';
import { greedyMeshBoundedArrays } from './physicsMath.ts';
import { SoundFX } from './sound.ts';
import {
  updateOrCreateDynamicMeshBuffer,
  type MicroVoxelWorld,
} from './world.ts';
import type { ModularVehicleRig } from './vehicle.ts';
import type { VoxelFXSystem } from './fx.ts';

export type MapHazardPresetId =
  | 'SAW_BLADE_VERTICAL'
  | 'SAW_BLADE_HORIZONTAL'
  | 'TWIN_SHREDDER_PIT'
  | 'PENDULUM_BLADE'
  | 'CONVEYOR_BELT'
  | 'LAUNCH_CATAPULT'
  | 'VOXEL_BRIDGE';

export interface MapHazardPresetSpec {
  id: MapHazardPresetId;
  name: string;
  category: string;
  badgeColor: string;
  desc: string;
  bladeRadiusMeters: number;
  bladeThicknessMeters: number;
  rpm: number;
}

export const MAP_HAZARD_PRESETS: ReadonlyArray<MapHazardPresetSpec> = [
  {
    id: 'SAW_BLADE_VERTICAL',
    name: 'Voxel Buzzsaw Ø3.2m',
    category: 'SAW',
    badgeColor: '#ef4444',
    desc: 'High-RPM 0.25m micro-voxel buzzsaw · Chip teeth or sever the support stanchions / motor!',
    bladeRadiusMeters: 1.65,
    bladeThicknessMeters: 0.5,
    rpm: 360,
  },
  {
    id: 'TWIN_SHREDDER_PIT',
    name: 'Twin Voxel Shredder',
    category: 'GRINDER',
    badgeColor: '#f97316',
    desc: 'Counter-rotating 0.25m voxel toothed drums driven by independent end-wall motors',
    bladeRadiusMeters: 1.85,
    bladeThicknessMeters: 1.5,
    rpm: 240,
  },
  {
    id: 'SAW_BLADE_HORIZONTAL',
    name: 'Horizontal Voxel Reaper',
    category: 'SPINNER',
    badgeColor: '#eab308',
    desc: 'Wheel-height horizontal 0.25m voxel spinner mounted on a central motor pedestal',
    bladeRadiusMeters: 1.75,
    bladeThicknessMeters: 0.5,
    rpm: 420,
  },
  {
    id: 'PENDULUM_BLADE',
    name: 'Swinging Voxel Guillotine',
    category: 'PENDULUM',
    badgeColor: '#ec4899',
    desc: 'Overhead 0.25m voxel gantry & truss arm with a motorized swinging buzzsaw',
    bladeRadiusMeters: 1.55,
    bladeThicknessMeters: 0.5,
    rpm: 320,
  },
  {
    id: 'CONVEYOR_BELT',
    name: 'Voxel Turbo Conveyor',
    category: 'CONVEYOR',
    badgeColor: '#06b6d4',
    desc: 'Motorized 0.25m micro-voxel conveyor belt & roller deck that accelerates vehicles and props forward',
    bladeRadiusMeters: 2.35,
    bladeThicknessMeters: 0.75,
    rpm: 260,
  },
  {
    id: 'LAUNCH_CATAPULT',
    name: 'Pneumatic Voxel Catapult',
    category: 'LAUNCHER',
    badgeColor: '#22c55e',
    desc: 'Motorized 0.25m micro-voxel pneumatic launch pad that flings vehicles & props skyward!',
    bladeRadiusMeters: 1.95,
    bladeThicknessMeters: 0.65,
    rpm: 180,
  },
  {
    id: 'VOXEL_BRIDGE',
    name: 'Destructible Voxel Bridge',
    category: 'BRIDGE',
    badgeColor: '#38bdf8',
    desc: 'Driveable 0.25m micro-voxel suspension bridge · Blast deck holes or sever support piers to collapse spans!',
    bladeRadiusMeters: 3.1,
    bladeThicknessMeters: 1.0,
    rpm: 0,
  },
];

export interface SerializedMapHazard {
  presetId: MapHazardPresetId;
  wx: number;
  wy: number;
  wz: number;
  yawRad: number;
}

export interface MapHazardRayHit {
  hazard: KinematicMapHazard;
  worldPos: THREE.Vector3;
  distance: number;
  mat: number;
  partLabel: 'Blade' | 'Motor' | 'Support' | 'Pendulum Arm';
}

// Pre-allocated scratch math objects for zero-GC 120Hz hazard physics
const _hazInvQuat = new THREE.Quaternion();
const _subQuat = new THREE.Quaternion();
const _subInvQuat = new THREE.Quaternion();
const _localPt = new THREE.Vector3();
const _subLocalPt = new THREE.Vector3();
const _worldPt = new THREE.Vector3();
const _bladeCenterWorld = new THREE.Vector3();
const _tangentDir = new THREE.Vector3();
const _impulseVec = new THREE.Vector3();
const _rigLocalMetric = new THREE.Vector3();
const _debrisVelTmp = new THREE.Vector3();
const _debrisPosTmp = new THREE.Vector3();
const _rayStepPosTmp = new THREE.Vector3();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

// 18-neighbor offsets (6 face-neighbors + 12 edge-diagonals) so 0.25m voxel trusses, saw discs, and pillars have solid structural connectivity
const STRUCTURAL_NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

function parseCoordKey(key: string): [number, number, number] {
  const p1 = key.indexOf(',');
  const p2 = key.indexOf(',', p1 + 1);
  return [
    Number(key.slice(0, p1)),
    Number(key.slice(p1 + 1, p2)),
    Number(key.slice(p2 + 1)),
  ];
}

/**
 * Builds a greedy-meshed 0.25m micro-voxel THREE.Mesh from a sparse Map<"vx,vy,vz", mat>
 * and per-voxel health map (charred darkening when hp < 0.5 via bit 64, identical to ModularVehicleRig).
 */
function rebuildVoxelSubAssemblyMesh(
  voxelMap: Map<string, number>,
  healthMap: Map<string, number>,
  existingMesh: THREE.Mesh | null,
  parentGroup: THREE.Group,
  sharedMaterial: THREE.Material,
): THREE.Mesh | null {
  if (voxelMap.size === 0) {
    if (existingMesh) {
      existingMesh.visible = false;
    }
    return existingMesh;
  }

  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;

  for (const [k, mat] of voxelMap.entries()) {
    if (mat === MAT.AIR) continue;
    const [vx, vy, vz] = parseCoordKey(k);
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
    if (vz < minZ) minZ = vz;
    if (vz > maxZ) maxZ = vz;
  }

  if (minX > maxX) {
    if (existingMesh) existingMesh.visible = false;
    return existingMesh;
  }

  const spanX = Math.max(1, maxX - minX + 1);
  const spanY = Math.max(1, maxY - minY + 1);
  const spanZ = Math.max(1, maxZ - minZ + 1);

  const sampleCell = (lx: number, ly: number, lz: number): number => {
    const key = `${minX + lx},${minY + ly},${minZ + lz}`;
    const mat = voxelMap.get(key) || 0;
    if (mat === MAT.AIR) return 0;
    const hp = healthMap.get(key) ?? 1.0;
    return hp < 0.5 ? (mat & 63) | 64 : mat & 63;
  };

  const res = greedyMeshBoundedArrays(
    spanX,
    spanY,
    spanZ,
    0,
    spanY - 1,
    sampleCell,
    minX * VOXEL_SIZE,
    minY * VOXEL_SIZE,
    minZ * VOXEL_SIZE,
    VOXEL_SIZE,
    VOXEL_SIZE,
    'OPAQUE_ONLY',
    null,
    true,
  );

  const updated = updateOrCreateDynamicMeshBuffer(
    existingMesh,
    res,
    sharedMaterial,
    parentGroup,
    false,
    1024,
  );
  if (updated.mesh) {
    updated.mesh.castShadow = true;
    updated.mesh.receiveShadow = true;
  }
  return updated.mesh;
}

/**
 * Generates a serrated 0.25m micro-voxel saw blade disc in the XY plane (or XZ plane if horizontal).
 * Uses 3D checkerboard micro-voxel material tiling so every single 0.25m block is individually visible!
 */
function populateVoxelSawDisc(
  targetMap: Map<string, number>,
  healthMap: Map<string, number>,
  radiusVox: number,
  horizontalPlane: boolean,
): void {
  const maxR = radiusVox + 1;
  for (let a = -maxR; a <= maxR; a++) {
    for (let b = -maxR; b <= maxR; b++) {
      const r = Math.hypot(a, b);
      if (r > radiusVox + 0.85) continue;

      const angle = Math.atan2(b, a);
      const toothWave = Math.sin(angle * 8);
      const isOuterTooth = r > radiusVox - 1.15;
      if (isOuterTooth && toothWave < -0.1) {
        continue; // Serrated gap between 0.25m voxel saw teeth
      }

      const parity = (Math.abs(a) + Math.abs(b)) & 1;
      let mat: number = MAT.STEEL;
      if (r <= 1.55) {
        // Central rotor axle hub (if these hub voxels or the external drive motor break, the blade detaches!)
        mat = parity === 0 ? MAT.PAINT_COPPER : MAT.GLOW_CRYSTAL;
      } else if (r <= 3.1) {
        // Hazard yellow & carbon chevron reinforcement ring
        mat = parity === 0 ? MAT.FLOAT_YELLOW : MAT.PAINT_CARBON;
      } else if (isOuterTooth) {
        mat = parity === 0 ? MAT.CHROME_SILVER : MAT.GLOW_MAGMA;
      } else {
        mat = parity === 0 ? MAT.STEEL : MAT.ARMOR_SLATE;
      }

      if (horizontalPlane) {
        const k0 = `${a},0,${b}`;
        targetMap.set(k0, mat);
        healthMap.set(k0, 1.0);
        if (r <= 2.1) {
          const k1 = `${a},1,${b}`;
          const hubMat = parity === 0 ? MAT.GLOW_CRYSTAL : MAT.PAINT_COPPER;
          targetMap.set(k1, hubMat);
          healthMap.set(k1, 1.0);
        }
      } else {
        const k0 = `${a},${b},0`;
        targetMap.set(k0, mat);
        healthMap.set(k0, 1.0);
        if (r <= 2.1) {
          const kNeg = `${a},${b},-1`;
          const kPos = `${a},${b},1`;
          const hubMat = parity === 0 ? MAT.GLOW_CRYSTAL : MAT.PAINT_COPPER;
          targetMap.set(kNeg, hubMat);
          healthMap.set(kNeg, 1.0);
          targetMap.set(kPos, hubMat);
          healthMap.set(kPos, 1.0);
        }
      }
    }
  }
}

/**
 * Generates a toothed 0.25m micro-voxel shredder drum along local Z.
 */
function populateVoxelShredderDrum(
  targetMap: Map<string, number>,
  healthMap: Map<string, number>,
  halfLenVox = 6,
): void {
  for (let vz = -halfLenVox; vz <= halfLenVox; vz++) {
    for (let vx = -3; vx <= 3; vx++) {
      for (let vy = -3; vy <= 3; vy++) {
        const r = Math.hypot(vx, vy);
        if (r > 3.2) continue;

        const parity = (Math.abs(vx) + Math.abs(vy) + Math.abs(vz)) & 1;
        const key = `${vx},${vy},${vz}`;
        if (r <= 1.25) {
          // Central drive axle shaft running through the drum
          targetMap.set(key, parity === 0 ? MAT.PAINT_COPPER : MAT.GLOW_CRYSTAL);
          healthMap.set(key, 1.0);
        } else if (r <= 2.15) {
          targetMap.set(key, parity === 0 ? MAT.STEEL : MAT.ARMOR_SLATE);
          healthMap.set(key, 1.0);
        } else {
          // Staggered 0.25m voxel ripper teeth around circumference
          const angIdx = Math.round((Math.atan2(vy, vx) / (Math.PI * 2)) * 8) & 7;
          if (((angIdx + vz) & 1) === 0) {
            targetMap.set(
              key,
              parity === 0 ? MAT.CHROME_SILVER : MAT.FLOAT_YELLOW,
            );
            healthMap.set(key, 1.0);
          }
        }
      }
    }
  }
}

export class KinematicMapHazard {
  public readonly id: string;
  public readonly presetId: MapHazardPresetId;
  public readonly spec: MapHazardPresetSpec;
  public readonly world: MicroVoxelWorld;
  public readonly scene: THREE.Scene;
  public readonly position = new THREE.Vector3();
  public readonly quaternion = new THREE.Quaternion();
  public yawRad = 0;

  public readonly rootGroup = new THREE.Group();
  public readonly rotorGroup = new THREE.Group();
  public readonly secondaryRotorGroup = new THREE.Group();
  public readonly pendulumArmGroup = new THREE.Group();

  // Real 0.25m micro-voxel maps & per-voxel HP maps for each sub-assembly
  public readonly baseVoxels = new Map<string, number>();
  public readonly baseHealth = new Map<string, number>();

  public readonly rotorVoxels = new Map<string, number>();
  public readonly rotorHealth = new Map<string, number>();

  public readonly secondaryRotorVoxels = new Map<string, number>();
  public readonly secondaryRotorHealth = new Map<string, number>();

  public readonly armVoxels = new Map<string, number>();
  public readonly armHealth = new Map<string, number>();

  // Critical structural Motor voxel keys (if broken or severed from ground support, the corresponding rotor/arm detaches!)
  public readonly rotor1MotorKeys = new Set<string>();
  public readonly rotor2MotorKeys = new Set<string>();
  public readonly armMotorKeys = new Set<string>();
  public initialRotor1MotorCount = 0;
  public initialRotor2MotorCount = 0;
  public initialArmMotorCount = 0;

  public rotor1Mounted = true;
  public rotor2Mounted = false;
  public armMounted = false;

  private baseMesh: THREE.Mesh | null = null;
  private rotorMesh: THREE.Mesh | null = null;
  private secondaryRotorMesh: THREE.Mesh | null = null;
  private armMesh: THREE.Mesh | null = null;
  private conveyorSlatsGroup: THREE.Group = new THREE.Group();
  private conveyorSlatHolders: THREE.Group[] = [];
  private conveyorSlatMeshes: Array<THREE.Mesh | null> = [];

  public initialTotalVoxels = 0;
  public destroyed = false;

  public spinAngleRad = 0;
  public beltPhase = 0;
  public pendulumPhase = 0;
  public angularSpeedRadPerSec: number;
  public shredCooldownByRig = new Map<string, number>();
  public soundCooldown = 0;

  constructor(
    scene: THREE.Scene,
    world: MicroVoxelWorld,
    presetId: MapHazardPresetId,
    wx: number,
    wy: number,
    wz: number,
    yawRad = 0,
  ) {
    this.id = `haz_${presetId}_${Math.random().toString(36).slice(2, 8)}`;
    this.scene = scene;
    this.world = world;
    this.presetId = presetId;
    this.spec =
      MAP_HAZARD_PRESETS.find((p) => p.id === presetId) || MAP_HAZARD_PRESETS[0];
    this.angularSpeedRadPerSec = (this.spec.rpm * Math.PI * 2) / 60;
    this.yawRad = yawRad;
    this.position.set(wx, wy, wz);
    this.quaternion.setFromAxisAngle(_yAxis, yawRad);

    this.populateVoxelAssemblies();
    this.initialTotalVoxels = this.getTotalVoxelCount();
    this.rebuildAllVoxelMeshes();

    this.rootGroup.position.copy(this.position);
    this.rootGroup.quaternion.copy(this.quaternion);
    scene.add(this.rootGroup);
  }

  public getTotalVoxelCount(): number {
    return (
      this.baseVoxels.size +
      this.rotorVoxels.size +
      this.secondaryRotorVoxels.size +
      this.armVoxels.size
    );
  }

  private setBaseVox(vx: number, vy: number, vz: number, mat: number, isRotor1Motor = false, isRotor2Motor = false, isArmMotor = false): void {
    const key = `${vx},${vy},${vz}`;
    this.baseVoxels.set(key, mat);
    this.baseHealth.set(key, 1.0);
    if (isRotor1Motor) this.rotor1MotorKeys.add(key);
    if (isRotor2Motor) this.rotor2MotorKeys.add(key);
    if (isArmMotor) this.armMotorKeys.add(key);
  }

  private setArmVox(vx: number, vy: number, vz: number, mat: number, isRotor1Motor = false): void {
    const key = `${vx},${vy},${vz}`;
    this.armVoxels.set(key, mat);
    this.armHealth.set(key, 1.0);
    if (isRotor1Motor) this.rotor1MotorKeys.add(key);
  }

  private populateVoxelAssemblies(): void {
    this.baseVoxels.clear();
    this.baseHealth.clear();
    this.rotorVoxels.clear();
    this.rotorHealth.clear();
    this.secondaryRotorVoxels.clear();
    this.secondaryRotorHealth.clear();
    this.armVoxels.clear();
    this.armHealth.clear();
    this.rotor1MotorKeys.clear();
    this.rotor2MotorKeys.clear();
    this.armMotorKeys.clear();

    this.rotor1Mounted = this.presetId !== 'VOXEL_BRIDGE' && this.presetId !== 'LAUNCH_CATAPULT';
    this.rotor2Mounted =
      this.presetId === 'TWIN_SHREDDER_PIT' || this.presetId === 'CONVEYOR_BELT';
    this.armMounted =
      this.presetId === 'PENDULUM_BLADE' || this.presetId === 'LAUNCH_CATAPULT';

    if (this.presetId === 'SAW_BLADE_VERTICAL') {
      // 0.25m micro-voxel foundation base with center blade slot + twin A-frame support stanchions + twin electric drive motors
      for (let vx = -6; vx <= 6; vx++) {
        for (let vz = -3; vz <= 3; vz++) {
          if (Math.abs(vz) <= 1 && Math.abs(vx) <= 5) continue; // Center slot for saw blade
          const parity = (Math.abs(vx) + Math.abs(vz)) & 1;
          const isEdge = Math.abs(vx) === 6 || Math.abs(vz) === 3;
          this.setBaseVox(
            vx,
            0,
            vz,
            isEdge
              ? parity === 0
                ? MAT.FLOAT_YELLOW
                : MAT.PAINT_CARBON
              : parity === 0
                ? MAT.STEEL
                : MAT.ARMOR_SLATE,
          );
          if (Math.abs(vx) <= 4 && Math.abs(vz) >= 2) {
            this.setBaseVox(
              vx,
              1,
              vz,
              parity === 0 ? MAT.ARMOR_SLATE : MAT.STEEL,
            );
          }
        }
      }
      // Twin structural support stanchions (vy = 2..4) + Drive Motor Housings at the top (vy = 5..6)
      for (const vz of [-2, 2]) {
        for (let vy = 2; vy <= 6; vy++) {
          const halfW = vy <= 3 ? 2 : 1;
          for (let vx = -halfW; vx <= halfW; vx++) {
            const parity = (Math.abs(vx) + vy + Math.abs(vz)) & 1;
            const isMotorHousing = vy >= 5 && Math.abs(vx) <= 1;
            const mat = isMotorHousing
              ? parity === 0
                ? MAT.PAINT_COPPER
                : MAT.GLOW_CRYSTAL
              : parity === 0
                ? MAT.STEEL
                : MAT.ARMOR_SLATE;
            this.setBaseVox(vx, vy, vz, mat, isMotorHousing);
          }
        }
      }

      // Rotor at y = 1.45m (voxel y ~ 6), radius = 6 voxels (1.5m)
      this.rotorGroup.position.set(0, 1.45, 0);
      populateVoxelSawDisc(this.rotorVoxels, this.rotorHealth, 6, false);
      this.rootGroup.add(this.rotorGroup);
    } else if (this.presetId === 'SAW_BLADE_HORIZONTAL') {
      // Stepped 0.25m micro-voxel turret foundation + central support column + top drive motor block
      for (let vx = -4; vx <= 4; vx++) {
        for (let vz = -4; vz <= 4; vz++) {
          const r = Math.hypot(vx, vz);
          if (r > 4.2) continue;
          const parity = (Math.abs(vx) + Math.abs(vz)) & 1;
          const isRim = r > 3.0;
          this.setBaseVox(
            vx,
            0,
            vz,
            isRim
              ? parity === 0
                ? MAT.FLOAT_YELLOW
                : MAT.PAINT_CARBON
              : parity === 0
                ? MAT.STEEL
                : MAT.ARMOR_SLATE,
          );
          // Support column at vy = 1
          if (r <= 2.3) {
            this.setBaseVox(
              vx,
              1,
              vz,
              parity === 0 ? MAT.ARMOR_SLATE : MAT.STEEL,
            );
          }
          // Drive Motor Core at vy = 2 supporting the horizontal spinner
          if (r <= 1.6) {
            this.setBaseVox(
              vx,
              2,
              vz,
              parity === 0 ? MAT.PAINT_COPPER : MAT.GLOW_CRYSTAL,
              true,
            );
          }
        }
      }

      // Horizontal voxel reaper disc at y = 0.68m
      this.rotorGroup.position.set(0, 0.68, 0);
      populateVoxelSawDisc(this.rotorVoxels, this.rotorHealth, 7, true);
      this.rootGroup.add(this.rotorGroup);
    } else if (this.presetId === 'TWIN_SHREDDER_PIT') {
      // Heavy 0.25m micro-voxel hopper side walls + end-wall support bearings & separate left/right drive motors
      for (let vz = -7; vz <= 7; vz++) {
        for (let vy = 0; vy <= 5; vy++) {
          for (const vx of [-6, -5, 5, 6]) {
            const parity = (Math.abs(vx) + vy + Math.abs(vz)) & 1;
            const mat =
              vy === 5
                ? parity === 0
                  ? MAT.FLOAT_YELLOW
                  : MAT.PAINT_CARBON
                : parity === 0
                  ? MAT.STEEL
                  : MAT.ARMOR_SLATE;
            this.setBaseVox(vx, vy, vz, mat);
          }
        }
      }
      // End walls (vz = -7 and vz = 7) with left motor (vx = -3..-1) for Rotor 1 and right motor (vx = 1..3) for Rotor 2
      for (const vz of [-7, 7]) {
        for (let vy = 0; vy <= 5; vy++) {
          for (let vx = -4; vx <= 4; vx++) {
            const parity = (Math.abs(vx) + vy + Math.abs(vz)) & 1;
            const isLeftMotor = vy >= 2 && vy <= 4 && vx >= -3 && vx <= -1;
            const isRightMotor = vy >= 2 && vy <= 4 && vx >= 1 && vx <= 3;
            const mat =
              isLeftMotor || isRightMotor
                ? parity === 0
                  ? MAT.PAINT_COPPER
                  : MAT.GLOW_CRYSTAL
                : parity === 0
                  ? MAT.ARMOR_SLATE
                  : MAT.STEEL;
            this.setBaseVox(vx, vy, vz, mat, isLeftMotor, isRightMotor);
          }
        }
      }

      // Left & right counter-rotating 0.25m voxel toothed drums
      this.rotorGroup.position.set(-0.65, 0.85, 0);
      populateVoxelShredderDrum(this.rotorVoxels, this.rotorHealth, 6);
      this.rootGroup.add(this.rotorGroup);

      this.secondaryRotorGroup.position.set(0.65, 0.85, 0);
      populateVoxelShredderDrum(
        this.secondaryRotorVoxels,
        this.secondaryRotorHealth,
        6,
      );
      this.rootGroup.add(this.secondaryRotorGroup);
    } else if (this.presetId === 'PENDULUM_BLADE') {
      // Twin 0.25m micro-voxel A-frame gantry support towers + top crossbeam + top swing motor
      const gantryHeightVox = 18; // 4.5m
      for (const sideX of [-7, 7]) {
        // Footings at vy = 0..1
        for (let vx = sideX - 1; vx <= sideX + 1; vx++) {
          for (let vz = -2; vz <= 2; vz++) {
            const parity = (Math.abs(vx) + Math.abs(vz)) & 1;
            this.setBaseVox(
              vx,
              0,
              vz,
              parity === 0 ? MAT.FLOAT_YELLOW : MAT.PAINT_CARBON,
            );
            if (Math.abs(vz) <= 1) {
              this.setBaseVox(
                vx,
                1,
                vz,
                parity === 0 ? MAT.ARMOR_SLATE : MAT.STEEL,
              );
            }
          }
        }
        // 2x2 stepped micro-voxel truss support columns (vy = 2..gantryHeightVox)
        for (let vy = 2; vy <= gantryHeightVox; vy++) {
          for (const dx of [0, sideX < 0 ? 1 : -1]) {
            for (const vz of [-1, 0, 1]) {
              if (Math.abs(vz) === 1 && (vy & 1) === 1 && dx !== 0) continue; // Open voxel truss lattice
              const vx = sideX + dx;
              const parity = (Math.abs(vx) + vy + Math.abs(vz)) & 1;
              this.setBaseVox(
                vx,
                vy,
                vz,
                vz === 1
                  ? parity === 0
                    ? MAT.FLOAT_YELLOW
                    : MAT.PAINT_CARBON
                  : parity === 0
                    ? MAT.STEEL
                    : MAT.ARMOR_SLATE,
              );
            }
          }
        }
      }
      // Overhead crossbeam (vy = 18..19) + center pendulum swing motor (vx = -2..2)
      for (let vx = -7; vx <= 7; vx++) {
        for (const vz of [-1, 0, 1]) {
          for (const vy of [gantryHeightVox, gantryHeightVox + 1]) {
            const isSwingMotor = Math.abs(vx) <= 2 && Math.abs(vz) <= 1;
            const parity = (Math.abs(vx) + vy + Math.abs(vz)) & 1;
            const mat = isSwingMotor
              ? parity === 0
                ? MAT.PAINT_COPPER
                : MAT.GLOW_CRYSTAL
              : parity === 0
                ? MAT.STEEL
                : MAT.ARMOR_SLATE;
            this.setBaseVox(vx, vy, vz, mat, false, false, isSwingMotor);
          }
        }
      }

      // Swinging 0.25m micro-voxel truss arm (vy = -12..0) + bottom saw drive motor (vy = -13..-11)
      this.pendulumArmGroup.position.set(0, 4.45, 0);
      for (let vy = -13; vy <= 0; vy++) {
        for (let vx = -1; vx <= 1; vx++) {
          for (let vz = -1; vz <= 1; vz++) {
            const isBottomSawMotor = vy <= -11;
            if (!isBottomSawMotor && Math.abs(vx) === 1 && Math.abs(vz) === 1) {
              continue; // Cross-shaped 0.25m voxel truss beam
            }
            const parity = (Math.abs(vx) + Math.abs(vy) + Math.abs(vz)) & 1;
            const mat = isBottomSawMotor
              ? parity === 0
                ? MAT.PAINT_COPPER
                : MAT.GLOW_CRYSTAL
              : vx === 0 && vz === 0
                ? parity === 0
                  ? MAT.STEEL
                  : MAT.ARMOR_SLATE
                : parity === 0
                  ? MAT.FLOAT_YELLOW
                  : MAT.PAINT_CARBON;
            this.setArmVox(vx, vy, vz, mat, isBottomSawMotor);
          }
        }
      }

      this.rotorGroup.position.set(0, -3.15, 0);
      populateVoxelSawDisc(this.rotorVoxels, this.rotorHealth, 6, false);
      this.pendulumArmGroup.add(this.rotorGroup);
      this.rootGroup.add(this.pendulumArmGroup);
    } else if (this.presetId === 'CONVEYOR_BELT') {
      // 0.25m micro-voxel Turbo Conveyor Belt: side frame rails + twin drive motors + full circulating treadmill belt + front & rear spinning rollers
      for (let vz = -9; vz <= 9; vz++) {
        for (let vx = -5; vx <= 5; vx++) {
          const parity = (Math.abs(vx) + Math.abs(vz)) & 1;
          // Ground frame & cross-ties at vy = 0
          if (Math.abs(vx) >= 4 || (vz & 3) === 0) {
            this.setBaseVox(
              vx,
              0,
              vz,
              Math.abs(vx) === 5
                ? parity === 0
                  ? MAT.FLOAT_YELLOW
                  : MAT.PAINT_CARBON
                : parity === 0
                  ? MAT.STEEL
                  : MAT.ARMOR_SLATE,
            );
          }
          // Side guide rails & twin electric drive motor blocks at vy = 1..2
          if (Math.abs(vx) === 5) {
            const isRearMotor = vz >= -7 && vz <= -4;
            const isFrontMotor = vz >= 4 && vz <= 7;
            const isMotor = isRearMotor || isFrontMotor;
            for (const vy of [1, 2]) {
              const mat = isMotor
                ? parity === 0
                  ? MAT.PAINT_COPPER
                  : MAT.GLOW_CRYSTAL
                : parity === 0
                  ? MAT.STEEL
                  : MAT.ARMOR_SLATE;
              this.setBaseVox(vx, vy, vz, mat, isFrontMotor, isRearMotor);
            }
          }
        }
      }
      // Spinning front drive roller drum in rotorVoxels (rotates around local X at z = +2.0m, y = 0.35m)
      this.rotorGroup.position.set(0, 0.35, 2.0);
      // Spinning rear return roller drum in secondaryRotorVoxels (rotates around local X at z = -2.0m, y = 0.35m)
      this.secondaryRotorGroup.position.set(0, 0.35, -2.0);
      for (let vx = -4; vx <= 4; vx++) {
        for (let vy = -1; vy <= 1; vy++) {
          for (let vz = -1; vz <= 1; vz++) {
            const parity = (Math.abs(vx) + Math.abs(vy) + Math.abs(vz)) & 1;
            const k = `${vx},${vy},${vz}`;
            const isHub = vy === 0 && vz === 0;
            const mat = isHub
              ? parity === 0
                ? MAT.PAINT_COPPER
                : MAT.GLOW_CRYSTAL
              : parity === 0
                ? MAT.CHROME_SILVER
                : MAT.FLOAT_YELLOW;
            this.rotorVoxels.set(k, mat);
            this.rotorHealth.set(k, 1.0);
            this.secondaryRotorVoxels.set(k, mat);
            this.secondaryRotorHealth.set(k, 1.0);
          }
        }
      }
      this.rootGroup.add(this.rotorGroup);
      this.rootGroup.add(this.secondaryRotorGroup);
      this.rootGroup.add(this.conveyorSlatsGroup);
    } else if (this.presetId === 'LAUNCH_CATAPULT') {
      // 0.25m micro-voxel Pneumatic Catapult: heavy anchor frame + twin pneumatic cylinder motors + hinged launch plate
      for (let vz = -6; vz <= 6; vz++) {
        for (let vx = -5; vx <= 5; vx++) {
          const parity = (Math.abs(vx) + Math.abs(vz)) & 1;
          const isEdge = Math.abs(vx) === 5 || Math.abs(vz) === 6;
          this.setBaseVox(
            vx,
            0,
            vz,
            isEdge
              ? parity === 0
                ? MAT.FLOAT_YELLOW
                : MAT.PAINT_CARBON
              : parity === 0
                ? MAT.STEEL
                : MAT.ARMOR_SLATE,
          );
          // Twin pneumatic drive cylinders at vy = 1..2
          const isPneumaticMotor =
            Math.abs(vx) >= 2 &&
            Math.abs(vx) <= 4 &&
            vz >= -2 &&
            vz <= 2;
          if (isPneumaticMotor || (Math.abs(vx) === 5 && vz >= -4 && vz <= 2)) {
            for (const vy of [1, 2]) {
              const mat = isPneumaticMotor
                ? parity === 0
                  ? MAT.PAINT_COPPER
                  : MAT.GLOW_CRYSTAL
                : parity === 0
                  ? MAT.ARMOR_SLATE
                  : MAT.STEEL;
              this.setBaseVox(vx, vy, vz, mat, false, false, isPneumaticMotor);
            }
          }
        }
      }
      // Hinged 0.25m micro-voxel launch deck plate in armVoxels
      this.pendulumArmGroup.position.set(0, 0.55, 0);
      for (let vz = -4; vz <= 4; vz++) {
        for (let vx = -4; vx <= 4; vx++) {
          const parity = (Math.abs(vx) + Math.abs(vz)) & 1;
          const isChevron = (Math.abs(vx) + vz + 8) % 3 === 0;
          this.setArmVox(
            vx,
            0,
            vz,
            isChevron
              ? MAT.GLOW_CRYSTAL
              : parity === 0
                ? MAT.FLOAT_YELLOW
                : MAT.ARMOR_SLATE,
          );
          if (Math.abs(vx) === 4 || vz === -4) {
            this.setArmVox(
              vx,
              1,
              vz,
              parity === 0 ? MAT.STEEL : MAT.PAINT_CARBON,
            );
          }
        }
      }
      this.rootGroup.add(this.pendulumArmGroup);
    } else if (this.presetId === 'VOXEL_BRIDGE') {
      // Destructible 0.25m micro-voxel Suspension Bridge: 4 grounded support piers + twin suspension towers + driveable deck
      for (let vz = -11; vz <= 11; vz++) {
        for (let vx = -5; vx <= 5; vx++) {
          const parity = (Math.abs(vx) + Math.abs(vz)) & 1;
          // 4 Heavy support piers grounded at vy = 0..2 (near ends vz = -10..-8 and 8..10, plus center pier at vz = -1..1)
          const isEndPier = Math.abs(vx) >= 3 && Math.abs(vz) >= 8 && Math.abs(vz) <= 10;
          const isCenterPier = Math.abs(vx) >= 4 && Math.abs(vz) <= 1;
          if (isEndPier || isCenterPier) {
            for (let vy = 0; vy <= 2; vy++) {
              this.setBaseVox(
                vx,
                vy,
                vz,
                vy === 0
                  ? parity === 0
                    ? MAT.FLOAT_YELLOW
                    : MAT.PAINT_CARBON
                  : parity === 0
                    ? MAT.ARMOR_SLATE
                    : MAT.STEEL,
              );
            }
          }
          // Approach ramps at vz = -11 and vz = 11 (vy = 1..2)
          if (Math.abs(vz) === 11 && Math.abs(vx) <= 4) {
            this.setBaseVox(vx, 1, vz, parity === 0 ? MAT.STEEL : MAT.ARMOR_SLATE);
            this.setBaseVox(vx, 2, vz, parity === 0 ? MAT.FLOAT_YELLOW : MAT.PAINT_CARBON);
          }
          // Main driveable bridge deck at vy = 3
          if (Math.abs(vz) <= 10 && Math.abs(vx) <= 4) {
            const isCenterLine = vx === 0 && (vz & 1) === 0;
            this.setBaseVox(
              vx,
              3,
              vz,
              isCenterLine
                ? MAT.FLOAT_YELLOW
                : parity === 0
                  ? MAT.ARMOR_SLATE
                  : MAT.STEEL,
            );
          }
          // Side guardrails & suspension towers at Math.abs(vx) === 5
          if (Math.abs(vx) === 5 && Math.abs(vz) <= 10) {
            this.setBaseVox(
              vx,
              3,
              vz,
              parity === 0 ? MAT.STEEL : MAT.ARMOR_SLATE,
            );
            this.setBaseVox(
              vx,
              4,
              vz,
              parity === 0 ? MAT.FLOAT_YELLOW : MAT.PAINT_CARBON,
            );
            // Suspension towers above end piers
            if (Math.abs(vz) === 9) {
              for (let vy = 5; vy <= 7; vy++) {
                this.setBaseVox(
                  vx,
                  vy,
                  vz,
                  vy === 7
                    ? MAT.GLOW_CRYSTAL
                    : parity === 0
                      ? MAT.STEEL
                      : MAT.ARMOR_SLATE,
                );
              }
            }
          }
        }
      }
    }

    this.initialRotor1MotorCount = Math.max(1, this.rotor1MotorKeys.size);
    this.initialRotor2MotorCount = Math.max(1, this.rotor2MotorKeys.size);
    this.initialArmMotorCount = Math.max(1, this.armMotorKeys.size);
  }

  public rebuildAllVoxelMeshes(): void {
    const sharedMat =
      typeof this.world.getActiveOpaqueVoxelMaterial === 'function'
        ? this.world.getActiveOpaqueVoxelMaterial()
        : this.world.sharedVoxelMaterial;

    this.baseMesh = rebuildVoxelSubAssemblyMesh(
      this.baseVoxels,
      this.baseHealth,
      this.baseMesh,
      this.rootGroup,
      sharedMat,
    );
    this.rotorMesh = rebuildVoxelSubAssemblyMesh(
      this.rotorVoxels,
      this.rotorHealth,
      this.rotorMesh,
      this.rotorGroup,
      sharedMat,
    );
    if (
      this.presetId === 'TWIN_SHREDDER_PIT' ||
      this.presetId === 'CONVEYOR_BELT'
    ) {
      this.secondaryRotorMesh = rebuildVoxelSubAssemblyMesh(
        this.secondaryRotorVoxels,
        this.secondaryRotorHealth,
        this.secondaryRotorMesh,
        this.secondaryRotorGroup,
        sharedMat,
      );
    }
    if (this.presetId === 'CONVEYOR_BELT') {
      // Build 18 circulating 3D voxel belt slats that rotate continuously around the entire treadmill loop
      if (this.conveyorSlatHolders.length === 0) {
        const slatCount = 18;
        for (let s = 0; s < slatCount; s++) {
          const holder = new THREE.Group();
          const slatVox = new Map<string, number>();
          const slatHp = new Map<string, number>();
          for (let vx = -4; vx <= 4; vx++) {
            const chevron = (Math.abs(vx) + s) % 3 === 0;
            const parity = (Math.abs(vx) + s) & 1;
            slatVox.set(
              `${vx},0,0`,
              chevron
                ? MAT.FLOAT_YELLOW
                : parity === 0
                  ? MAT.ASPHALT
                  : MAT.PAINT_CARBON,
            );
            slatHp.set(`${vx},0,0`, 1.0);
          }
          const m = rebuildVoxelSubAssemblyMesh(
            slatVox,
            slatHp,
            null,
            holder,
            sharedMat,
          );
          if (m) {
            m.scale.set(1.0, 0.48, 0.92);
          }
          this.conveyorSlatsGroup.add(holder);
          this.conveyorSlatHolders.push(holder);
          this.conveyorSlatMeshes.push(m);
        }
        this.updateConveyorBeltSlatsPose();
      }
      this.conveyorSlatsGroup.visible =
        (this.rotor1Mounted || this.rotor2Mounted) && this.baseVoxels.size > 0;
    }
    if (
      this.presetId === 'PENDULUM_BLADE' ||
      this.presetId === 'LAUNCH_CATAPULT'
    ) {
      this.armMesh = rebuildVoxelSubAssemblyMesh(
        this.armVoxels,
        this.armHealth,
        this.armMesh,
        this.pendulumArmGroup,
        sharedMat,
      );
    }
  }

  private updateConveyorBeltSlatsPose(): void {
    const n = this.conveyorSlatHolders.length;
    if (n === 0) return;
    // Closed stadium track perimeter:
    // Top straight run: z from -1.85m to +1.85m (length 3.70m) at y = 0.56m
    // Front half-circle arc around (y = 0.35m, z = +1.85m), radius R = 0.21m (length pi*R = 0.66m)
    // Bottom return run: z from +1.85m to -1.85m (length 3.70m) at y = 0.14m
    // Rear half-circle arc around (y = 0.35m, z = -1.85m), radius R = 0.21m (length pi*R = 0.66m)
    const L = 3.7;
    const R = 0.21;
    const arcLen = Math.PI * R;
    const totalPerim = 2 * L + 2 * arcLen;
    const centerY = 0.35;
    const halfZ = 1.85;

    for (let i = 0; i < n; i++) {
      const holder = this.conveyorSlatHolders[i];
      const u = ((i / n + this.beltPhase) % 1.0 + 1.0) % 1.0;
      const dist = u * totalPerim;
      if (dist < L) {
        // Top run moving forward (+Z)
        const z = -halfZ + dist;
        holder.position.set(0, centerY + R, z);
        holder.rotation.set(0, 0, 0);
      } else if (dist < L + arcLen) {
        // Front roller wrap (theta from 0 to PI)
        const theta = ((dist - L) / arcLen) * Math.PI;
        const y = centerY + Math.cos(theta) * R;
        const z = halfZ + Math.sin(theta) * R;
        holder.position.set(0, y, z);
        holder.rotation.set(theta, 0, 0);
      } else if (dist < 2 * L + arcLen) {
        // Bottom return run moving backward (-Z)
        const dBottom = dist - (L + arcLen);
        const z = halfZ - dBottom;
        holder.position.set(0, centerY - R, z);
        holder.rotation.set(Math.PI, 0, 0);
      } else {
        // Rear roller wrap (theta from PI to 2*PI)
        const dRear = dist - (2 * L + arcLen);
        const theta = Math.PI + (dRear / arcLen) * Math.PI;
        const y = centerY + Math.cos(theta) * R;
        const z = -halfZ + Math.sin(theta) * R;
        holder.position.set(0, y, z);
        holder.rotation.set(theta, 0, 0);
      }
    }
  }

  // --- Exact Sub-Assembly Coordinate Transforms ---

  public worldToBaseLocal(wx: number, wy: number, wz: number, out: THREE.Vector3): THREE.Vector3 {
    _hazInvQuat.copy(this.quaternion).invert();
    return out.set(wx, wy, wz).sub(this.position).applyQuaternion(_hazInvQuat);
  }

  public baseVoxelToWorld(vx: number, vy: number, vz: number, out: THREE.Vector3): THREE.Vector3 {
    return out
      .set(vx * VOXEL_SIZE, vy * VOXEL_SIZE, vz * VOXEL_SIZE)
      .applyQuaternion(this.quaternion)
      .add(this.position);
  }

  public worldToArmLocal(wx: number, wy: number, wz: number, out: THREE.Vector3): THREE.Vector3 {
    this.worldToBaseLocal(wx, wy, wz, out);
    if (this.presetId === 'LAUNCH_CATAPULT') {
      out.y -= 0.55;
      const kickAngle = -Math.max(0, Math.sin(this.pendulumPhase)) * 0.52;
      _subInvQuat.setFromAxisAngle(_xAxis, -kickAngle);
      return out.applyQuaternion(_subInvQuat);
    }
    out.y -= 4.45;
    const swingAngle = Math.sin(this.pendulumPhase) * 0.68;
    _subInvQuat.setFromAxisAngle(_zAxis, -swingAngle);
    return out.applyQuaternion(_subInvQuat);
  }

  public armVoxelToWorld(vx: number, vy: number, vz: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.presetId === 'LAUNCH_CATAPULT') {
      const kickAngle = -Math.max(0, Math.sin(this.pendulumPhase)) * 0.52;
      _subQuat.setFromAxisAngle(_xAxis, kickAngle);
      out
        .set(vx * VOXEL_SIZE, vy * VOXEL_SIZE, vz * VOXEL_SIZE)
        .applyQuaternion(_subQuat);
      out.y += 0.55;
      return out.applyQuaternion(this.quaternion).add(this.position);
    }
    const swingAngle = Math.sin(this.pendulumPhase) * 0.68;
    _subQuat.setFromAxisAngle(_zAxis, swingAngle);
    out
      .set(vx * VOXEL_SIZE, vy * VOXEL_SIZE, vz * VOXEL_SIZE)
      .applyQuaternion(_subQuat);
    out.y += 4.45;
    return out.applyQuaternion(this.quaternion).add(this.position);
  }

  public worldToRotor1Local(wx: number, wy: number, wz: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.presetId === 'PENDULUM_BLADE') {
      this.worldToArmLocal(wx, wy, wz, out);
      out.y -= -3.15;
      _subInvQuat.setFromAxisAngle(_zAxis, this.spinAngleRad);
      return out.applyQuaternion(_subInvQuat);
    }
    this.worldToBaseLocal(wx, wy, wz, out);
    if (this.presetId === 'CONVEYOR_BELT') {
      out.y -= 0.35;
      out.z -= 2.0;
      _subInvQuat.setFromAxisAngle(_xAxis, -this.spinAngleRad);
      return out.applyQuaternion(_subInvQuat);
    }
    if (this.presetId === 'SAW_BLADE_VERTICAL') {
      out.y -= 1.45;
      _subInvQuat.setFromAxisAngle(_zAxis, this.spinAngleRad);
      return out.applyQuaternion(_subInvQuat);
    }
    if (this.presetId === 'SAW_BLADE_HORIZONTAL') {
      out.y -= 0.68;
      _subInvQuat.setFromAxisAngle(_yAxis, -this.spinAngleRad);
      return out.applyQuaternion(_subInvQuat);
    }
    // TWIN_SHREDDER_PIT left drum
    out.x -= -0.65;
    out.y -= 0.85;
    _subInvQuat.setFromAxisAngle(_zAxis, this.spinAngleRad);
    return out.applyQuaternion(_subInvQuat);
  }

  public rotor1VoxelToWorld(vx: number, vy: number, vz: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(vx * VOXEL_SIZE, vy * VOXEL_SIZE, vz * VOXEL_SIZE);
    if (this.presetId === 'PENDULUM_BLADE') {
      _subQuat.setFromAxisAngle(_zAxis, -this.spinAngleRad);
      out.applyQuaternion(_subQuat);
      out.y += -3.15;
      const swingAngle = Math.sin(this.pendulumPhase) * 0.68;
      _subQuat.setFromAxisAngle(_zAxis, swingAngle);
      out.applyQuaternion(_subQuat);
      out.y += 4.45;
      return out.applyQuaternion(this.quaternion).add(this.position);
    }
    if (this.presetId === 'CONVEYOR_BELT') {
      _subQuat.setFromAxisAngle(_xAxis, this.spinAngleRad);
      out.applyQuaternion(_subQuat);
      out.y += 0.35;
      out.z += 2.0;
      return out.applyQuaternion(this.quaternion).add(this.position);
    }
    if (this.presetId === 'SAW_BLADE_VERTICAL') {
      _subQuat.setFromAxisAngle(_zAxis, -this.spinAngleRad);
      out.applyQuaternion(_subQuat);
      out.y += 1.45;
      return out.applyQuaternion(this.quaternion).add(this.position);
    }
    if (this.presetId === 'SAW_BLADE_HORIZONTAL') {
      _subQuat.setFromAxisAngle(_yAxis, this.spinAngleRad);
      out.applyQuaternion(_subQuat);
      out.y += 0.68;
      return out.applyQuaternion(this.quaternion).add(this.position);
    }
    // TWIN_SHREDDER_PIT left drum
    _subQuat.setFromAxisAngle(_zAxis, -this.spinAngleRad);
    out.applyQuaternion(_subQuat);
    out.x += -0.65;
    out.y += 0.85;
    return out.applyQuaternion(this.quaternion).add(this.position);
  }

  public worldToRotor2Local(wx: number, wy: number, wz: number, out: THREE.Vector3): THREE.Vector3 {
    this.worldToBaseLocal(wx, wy, wz, out);
    if (this.presetId === 'CONVEYOR_BELT') {
      out.y -= 0.35;
      out.z -= -2.0;
      _subInvQuat.setFromAxisAngle(_xAxis, -this.spinAngleRad);
      return out.applyQuaternion(_subInvQuat);
    }
    out.x -= 0.65;
    out.y -= 0.85;
    _subInvQuat.setFromAxisAngle(_zAxis, -this.spinAngleRad);
    return out.applyQuaternion(_subInvQuat);
  }

  public rotor2VoxelToWorld(vx: number, vy: number, vz: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(vx * VOXEL_SIZE, vy * VOXEL_SIZE, vz * VOXEL_SIZE);
    if (this.presetId === 'CONVEYOR_BELT') {
      _subQuat.setFromAxisAngle(_xAxis, this.spinAngleRad);
      out.applyQuaternion(_subQuat);
      out.y += 0.35;
      out.z += -2.0;
      return out.applyQuaternion(this.quaternion).add(this.position);
    }
    _subQuat.setFromAxisAngle(_zAxis, this.spinAngleRad);
    out.applyQuaternion(_subQuat);
    out.x += 0.65;
    out.y += 0.85;
    return out.applyQuaternion(this.quaternion).add(this.position);
  }

  public stepVisuals(dt: number): void {
    if (this.destroyed) return;
    if (this.rotor1Mounted || this.rotor2Mounted) {
      this.spinAngleRad =
        (this.spinAngleRad + this.angularSpeedRadPerSec * dt) % (Math.PI * 200);
    }
    if (this.soundCooldown > 0) {
      this.soundCooldown = Math.max(0, this.soundCooldown - dt);
    }

    for (const [rigId, cd] of this.shredCooldownByRig.entries()) {
      if (cd <= dt) {
        this.shredCooldownByRig.delete(rigId);
      } else {
        this.shredCooldownByRig.set(rigId, cd - dt);
      }
    }

    if (this.presetId === 'SAW_BLADE_VERTICAL') {
      if (this.rotor1Mounted) {
        this.rotorGroup.rotation.z = -this.spinAngleRad;
      }
    } else if (this.presetId === 'SAW_BLADE_HORIZONTAL') {
      if (this.rotor1Mounted) {
        this.rotorGroup.rotation.y = this.spinAngleRad;
      }
    } else if (this.presetId === 'TWIN_SHREDDER_PIT') {
      if (this.rotor1Mounted) {
        this.rotorGroup.rotation.z = -this.spinAngleRad;
      }
      if (this.rotor2Mounted) {
        this.secondaryRotorGroup.rotation.z = this.spinAngleRad;
      }
    } else if (this.presetId === 'PENDULUM_BLADE') {
      if (this.armMounted) {
        this.pendulumPhase += dt * 2.35;
        const swingAngle = Math.sin(this.pendulumPhase) * 0.68;
        this.pendulumArmGroup.rotation.z = swingAngle;
      }
      if (this.rotor1Mounted) {
        this.rotorGroup.rotation.z = -this.spinAngleRad;
      }
    } else if (this.presetId === 'CONVEYOR_BELT') {
      if (this.rotor1Mounted) {
        this.rotorGroup.rotation.x = this.spinAngleRad;
      }
      if (this.rotor2Mounted) {
        this.secondaryRotorGroup.rotation.x = this.spinAngleRad;
      }
      if (this.rotor1Mounted || this.rotor2Mounted) {
        this.beltPhase = (this.beltPhase + dt * 0.72) % 1.0;
        this.updateConveyorBeltSlatsPose();
      }
    } else if (this.presetId === 'LAUNCH_CATAPULT') {
      if (this.armMounted && this.pendulumPhase > 0) {
        this.pendulumPhase = Math.max(0, this.pendulumPhase - dt * 3.2);
        const kickAngle = -Math.sin(this.pendulumPhase) * 0.52;
        this.pendulumArmGroup.rotation.x = kickAngle;
      }
    }
  }

  /**
   * Returns the world-space center of the active spinning voxel blade/drum/deck.
   */
  public getActiveBladeCenterWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.presetId === 'PENDULUM_BLADE') {
      const armLen = 3.15;
      const swingAngle = Math.sin(this.pendulumPhase) * 0.68;
      _localPt.set(
        Math.sin(swingAngle) * armLen,
        4.45 - Math.cos(swingAngle) * armLen,
        0,
      );
    } else if (this.presetId === 'SAW_BLADE_VERTICAL') {
      _localPt.set(0, 1.45, 0);
    } else if (this.presetId === 'SAW_BLADE_HORIZONTAL') {
      _localPt.set(0, 0.68, 0);
    } else if (this.presetId === 'CONVEYOR_BELT' || this.presetId === 'LAUNCH_CATAPULT') {
      _localPt.set(0, 0.55, 0);
    } else if (this.presetId === 'VOXEL_BRIDGE') {
      _localPt.set(0, 0.75, 0);
    } else {
      _localPt.set(0, 0.85, 0);
    }
    return out.copy(_localPt).applyQuaternion(this.quaternion).add(this.position);
  }

  /**
   * Raycasts against all intact 0.25m micro-voxels of this hazard (base support, motor blocks,
   * pendulum arm, and rotating saw/drum voxels in their exact current rotated orientation).
   */
  public raycastHazard(
    rayOrigin: THREE.Vector3,
    rayDir: THREE.Vector3,
    maxDist = 28,
  ): MapHazardRayHit | null {
    if (this.destroyed) return null;

    this.getActiveBladeCenterWorld(_bladeCenterWorld);
    const midX = (this.position.x + _bladeCenterWorld.x) * 0.5;
    const midY = (this.position.y + _bladeCenterWorld.y) * 0.5;
    const midZ = (this.position.z + _bladeCenterWorld.z) * 0.5;
    const toCenterX = midX - rayOrigin.x;
    const toCenterY = midY - rayOrigin.y;
    const toCenterZ = midZ - rayOrigin.z;
    const distSq =
      toCenterX * toCenterX + toCenterY * toCenterY + toCenterZ * toCenterZ;
    const boundR = 5.5;
    if (distSq > (maxDist + boundR) * (maxDist + boundR)) {
      return null;
    }

    const step = VOXEL_SIZE * 0.42;
    const startD = Math.max(0, Math.sqrt(distSq) - boundR);
    const endD = Math.min(maxDist, Math.sqrt(distSq) + boundR);

    for (let d = startD; d <= endD; d += step) {
      _rayStepPosTmp.copy(rayOrigin).addScaledVector(rayDir, d);

      // 1. Check Base Support & Base Motor Voxels
      if (this.baseVoxels.size > 0) {
        this.worldToBaseLocal(_rayStepPosTmp.x, _rayStepPosTmp.y, _rayStepPosTmp.z, _subLocalPt);
        const vx = Math.round(_subLocalPt.x / VOXEL_SIZE);
        const vy = Math.round(_subLocalPt.y / VOXEL_SIZE);
        const vz = Math.round(_subLocalPt.z / VOXEL_SIZE);
        const key = `${vx},${vy},${vz}`;
        const mat = this.baseVoxels.get(key);
        if (mat) {
          const isMotor =
            this.rotor1MotorKeys.has(key) ||
            this.rotor2MotorKeys.has(key) ||
            this.armMotorKeys.has(key);
          return {
            hazard: this,
            worldPos: _rayStepPosTmp.clone(),
            distance: d,
            mat,
            partLabel: isMotor ? 'Motor' : 'Support',
          };
        }
      }

      // 2. Check Swinging Pendulum Truss Arm & Bottom Motor
      if (this.armMounted && this.armVoxels.size > 0) {
        this.worldToArmLocal(_rayStepPosTmp.x, _rayStepPosTmp.y, _rayStepPosTmp.z, _subLocalPt);
        const vx = Math.round(_subLocalPt.x / VOXEL_SIZE);
        const vy = Math.round(_subLocalPt.y / VOXEL_SIZE);
        const vz = Math.round(_subLocalPt.z / VOXEL_SIZE);
        const key = `${vx},${vy},${vz}`;
        const mat = this.armVoxels.get(key);
        if (mat) {
          const isMotor = this.rotor1MotorKeys.has(key);
          return {
            hazard: this,
            worldPos: _rayStepPosTmp.clone(),
            distance: d,
            mat,
            partLabel: isMotor ? 'Motor' : 'Pendulum Arm',
          };
        }
      }

      // 3. Check Primary Spinning Rotor Voxels in current rotated pose
      if (this.rotor1Mounted && this.rotorVoxels.size > 0) {
        this.worldToRotor1Local(_rayStepPosTmp.x, _rayStepPosTmp.y, _rayStepPosTmp.z, _subLocalPt);
        const vx = Math.round(_subLocalPt.x / VOXEL_SIZE);
        const vy = Math.round(_subLocalPt.y / VOXEL_SIZE);
        const vz = Math.round(_subLocalPt.z / VOXEL_SIZE);
        const key = `${vx},${vy},${vz}`;
        const mat = this.rotorVoxels.get(key);
        if (mat) {
          const isHubMotor = Math.hypot(vx, vy, vz) <= 1.6;
          return {
            hazard: this,
            worldPos: _rayStepPosTmp.clone(),
            distance: d,
            mat,
            partLabel: isHubMotor ? 'Motor' : 'Blade',
          };
        }
      }

      // 4. Check Secondary Counter-Rotating Drum Voxels
      if (this.rotor2Mounted && this.secondaryRotorVoxels.size > 0) {
        this.worldToRotor2Local(_rayStepPosTmp.x, _rayStepPosTmp.y, _rayStepPosTmp.z, _subLocalPt);
        const vx = Math.round(_subLocalPt.x / VOXEL_SIZE);
        const vy = Math.round(_subLocalPt.y / VOXEL_SIZE);
        const vz = Math.round(_subLocalPt.z / VOXEL_SIZE);
        const key = `${vx},${vy},${vz}`;
        const mat = this.secondaryRotorVoxels.get(key);
        if (mat) {
          const isHubMotor = Math.hypot(vx, vy) <= 1.3;
          return {
            hazard: this,
            worldPos: _rayStepPosTmp.clone(),
            distance: d,
            mat,
            partLabel: isHubMotor ? 'Motor' : 'Blade',
          };
        }
      }
    }

    return null;
  }

  /**
   * Carves a localized spherical crater into a single sub-assembly's 0.25m voxel map and health map,
   * exactly like `ModularVehicleRig.carveVehicleCrater`:
   * - Voxels within the core impact radius lose HP and break off into physical 3D voxel debris cubes.
   * - Voxels in the outer shockwave ring drop below 50% HP so they visibly char/darken (`mat | 64`).
   */
  private carveSubAssemblyCrater(
    voxelMap: Map<string, number>,
    healthMap: Map<string, number>,
    localHitMetric: THREE.Vector3,
    radiusVoxels: number,
    voxelToWorldFn: (vx: number, vy: number, vz: number, out: THREE.Vector3) => THREE.Vector3,
    blastWorldOrigin: THREE.Vector3,
    fx: VoxelFXSystem | null,
  ): { broken: number; damaged: number } {
    if (voxelMap.size === 0) return { broken: 0, damaged: 0 };

    const hitVX = localHitMetric.x / VOXEL_SIZE;
    const hitVY = localHitMetric.y / VOXEL_SIZE;
    const hitVZ = localHitMetric.z / VOXEL_SIZE;

    const innerRad = Math.max(0.9, radiusVoxels * 0.85);
    const outerShockRad = Math.max(innerRad + 0.8, radiusVoxels * 1.45);
    const outerRadSq = outerShockRad * outerShockRad;

    let broken = 0;
    let damaged = 0;

    for (const [key, mat] of Array.from(voxelMap.entries())) {
      const [vx, vy, vz] = parseCoordKey(key);
      const dx = vx - hitVX;
      const dy = vy - hitVY;
      const dz = vz - hitVZ;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > outerRadSq) continue;

      const dist = Math.sqrt(dSq);
      const oldHp = healthMap.get(key) ?? 1.0;

      if (dist <= innerRad) {
        // Armor slate resists light peripheral hits by charring first
        if (
          mat === MAT.ARMOR_SLATE &&
          dist > innerRad * 0.55 &&
          radiusVoxels <= 3.2 &&
          oldHp > 0.48
        ) {
          healthMap.set(key, 0.35);
          damaged++;
          continue;
        }

        voxelMap.delete(key);
        healthMap.delete(key);
        broken++;

        if (fx && broken <= 28) {
          voxelToWorldFn(vx, vy, vz, _debrisPosTmp);
          _debrisVelTmp
            .copy(_debrisPosTmp)
            .sub(blastWorldOrigin);
          if (_debrisVelTmp.lengthSq() < 0.001) {
            _debrisVelTmp.set(Math.random() - 0.5, 1, Math.random() - 0.5);
          }
          _debrisVelTmp.normalize().multiplyScalar(6 + Math.random() * 9);
          _debrisVelTmp.y = Math.max(3.5, _debrisVelTmp.y + 4.0);
          fx.voxelDebrisSystem.spawnDebrisVoxel(
            _debrisPosTmp,
            _debrisVelTmp,
            null,
            MAT_INFO[mat & 63]?.color ?? 0xfacc15,
            mat & 63,
          );
        }
      } else {
        // Outer shockwave ring: reduce block health below 50% so it chars/darkens
        const falloff = Math.max(
          0.2,
          1 - (dist - innerRad) / Math.max(0.5, outerShockRad - innerRad),
        );
        const hpLoss = Math.max(0.54, falloff * 0.72);
        const nextHp = oldHp - hpLoss;
        if (nextHp <= 0.05) {
          voxelMap.delete(key);
          healthMap.delete(key);
          broken++;
        } else {
          healthMap.set(key, Math.min(0.42, Math.max(0.15, nextHp)));
          damaged++;
        }
      }
    }

    return { broken, damaged };
  }

  /**
   * Runs a 3D connected-components BFS from the sub-assembly's structural anchor voxels.
   * Any voxel clusters no longer connected to the anchor break off as tumbling 3D rigid-body
   * voxel islands (`fx.spawnDetachedIslandFragment`), while connected voxels continue operating!
   */
  private severDisconnectedSubAssemblyIslands(
    voxelMap: Map<string, number>,
    healthMap: Map<string, number>,
    isAnchorVoxelFn: (vx: number, vy: number, vz: number, key: string) => boolean,
    voxelToWorldFn: (vx: number, vy: number, vz: number, out: THREE.Vector3) => THREE.Vector3,
    isSpinningRotor: boolean,
    fx: VoxelFXSystem | null,
  ): number {
    if (voxelMap.size === 0) return 0;

    const visited = new Set<string>();
    const queue: string[] = [];

    for (const key of voxelMap.keys()) {
      const [vx, vy, vz] = parseCoordKey(key);
      if (isAnchorVoxelFn(vx, vy, vz, key)) {
        visited.add(key);
        queue.push(key);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const curKey = queue[head++];
      const [cx, cy, cz] = parseCoordKey(curKey);
      for (let i = 0; i < STRUCTURAL_NEIGHBOR_OFFSETS.length; i++) {
        const [dx, dy, dz] = STRUCTURAL_NEIGHBOR_OFFSETS[i];
        const nKey = `${cx + dx},${cy + dy},${cz + dz}`;
        if (!visited.has(nKey) && voxelMap.has(nKey)) {
          visited.add(nKey);
          queue.push(nKey);
        }
      }
    }

    if (visited.size === voxelMap.size) {
      return 0; // All remaining voxels are structurally supported!
    }

    // Group unvisited (severed) voxels into connected 3D islands so each broken piece tumbles independently
    const unvisited = new Set<string>();
    for (const key of voxelMap.keys()) {
      if (!visited.has(key)) {
        unvisited.add(key);
      }
    }

    let totalSevered = 0;
    for (const seedKey of unvisited) {
      if (!unvisited.has(seedKey)) continue;
      const islandKeys: string[] = [seedKey];
      unvisited.delete(seedKey);

      let iHead = 0;
      while (iHead < islandKeys.length) {
        const k = islandKeys[iHead++];
        const [kx, ky, kz] = parseCoordKey(k);
        for (let i = 0; i < STRUCTURAL_NEIGHBOR_OFFSETS.length; i++) {
          const [dx, dy, dz] = STRUCTURAL_NEIGHBOR_OFFSETS[i];
          const nk = `${kx + dx},${ky + dy},${kz + dz}`;
          if (unvisited.has(nk)) {
            unvisited.delete(nk);
            islandKeys.push(nk);
          }
        }
      }

      const islandCoords: Array<[number, number, number, number]> = [];
      let sumX = 0,
        sumY = 0,
        sumZ = 0;
      for (let i = 0; i < islandKeys.length; i++) {
        const k = islandKeys[i];
        const mat = voxelMap.get(k) || MAT.STEEL;
        voxelMap.delete(k);
        healthMap.delete(k);
        const [vx, vy, vz] = parseCoordKey(k);
        islandCoords.push([vx, vy, vz, mat & 63]);
        sumX += vx;
        sumY += vy;
        sumZ += vz;
        totalSevered++;
      }

      if (fx && islandCoords.length > 0) {
        const avgVX = sumX / islandCoords.length;
        const avgVY = sumY / islandCoords.length;
        const avgVZ = sumZ / islandCoords.length;
        const centerWorld = voxelToWorldFn(avgVX, avgVY, avgVZ, new THREE.Vector3());

        // Center island local coords around (0,0,0) for clean tumbling physics
        const centeredIsland: Array<[number, number, number, number]> = islandCoords.map(
          ([vx, vy, vz, mat]) => [
            Math.round(vx - avgVX),
            Math.round(vy - avgVY),
            Math.round(vz - avgVZ),
            mat,
          ],
        );

        const launchVel = new THREE.Vector3(
          (Math.random() - 0.5) * 5.5,
          3.5 + Math.random() * 4.5,
          (Math.random() - 0.5) * 5.5,
        );
        if (isSpinningRotor) {
          // Fling severed blade chunk tangentially using rotor angular velocity!
          launchVel.x += (Math.random() - 0.5) * 9.0;
          launchVel.y += 4.5;
        }
        fx.spawnDetachedIslandFragment(
          centerWorld,
          this.quaternion,
          centeredIsland,
          launchVel,
        );
      }
    }

    return totalSevered;
  }

  /**
   * Detaches an entire sub-assembly (such as a spinning saw blade or shredder drum whose motor
   * or support pillar was broken) as a tumbling 3D voxel island!
   */
  private detachEntireSubAssemblyAsIsland(
    voxelMap: Map<string, number>,
    healthMap: Map<string, number>,
    voxelToWorldFn: (vx: number, vy: number, vz: number, out: THREE.Vector3) => THREE.Vector3,
    fx: VoxelFXSystem | null,
    upwardBoost = 6.5,
  ): number {
    const count = voxelMap.size;
    if (count === 0) return 0;

    // Sever all voxels by passing an anchor predicate that returns false
    this.severDisconnectedSubAssemblyIslands(
      voxelMap,
      healthMap,
      () => false,
      voxelToWorldFn,
      true,
      fx,
    );

    if (fx) {
      const worldCenter = voxelToWorldFn(0, 0, 0, new THREE.Vector3());
      fx.spawnWeldSparks(worldCenter.x, worldCenter.y, worldCenter.z);
      fx.spawnDebris(worldCenter.x, worldCenter.y, worldCenter.z, 0xfacc15, 10.5, 1.4);
      fx.trauma = Math.min(1.0, fx.trauma + 0.22);
    }
    SoundFX.explode();
    return count + (upwardBoost > 0 ? 0 : 0);
  }

  private countIntactKeysInMap(keys: Set<string>, map: Map<string, number>): number {
    let intact = 0;
    for (const k of keys) {
      if (map.has(k)) intact++;
    }
    return intact;
  }

  private countIntactHubVoxels(rotorMap: Map<string, number>): number {
    let hubCount = 0;
    for (const k of rotorMap.keys()) {
      const [vx, vy, vz] = parseCoordKey(k);
      if (this.presetId === 'TWIN_SHREDDER_PIT') {
        if (Math.hypot(vx, vy) <= 1.35) hubCount++;
      } else {
        if (Math.hypot(vx, vy, vz) <= 1.65) hubCount++;
      }
    }
    return hubCount;
  }

  /**
   * Damages 0.25m micro-voxels on this hazard around world point `(wx, wy, wz)`,
   * identical to vehicle destruction:
   * 1. Carves a localized spherical crater on whichever part was hit (blade teeth, support pillar,
   *    pendulum arm, or motor housing) and chars surrounding voxels (<50% HP).
   * 2. Runs 3D connected-components BFS so any severed teeth or struts break off into tumbling
   *    3D voxel islands while the rest of the hazard continues operating!
   * 3. Checks critical **Motor** and **Support** integrity: if a blade's drive motor, central hub,
   *    or the support pillar/arm holding it is broken through, that blade/arm detaches and collapses
   *    into tumbling 3D voxel islands!
   */
  public damageAtWorldPoint(
    wx: number,
    wy: number,
    wz: number,
    radiusVoxels: number,
    fx: VoxelFXSystem | null,
    _legacyForceExplode = false,
  ): boolean {
    if (this.destroyed) return false;

    this.getActiveBladeCenterWorld(_bladeCenterWorld);
    const distToBlade = Math.hypot(
      wx - _bladeCenterWorld.x,
      wy - _bladeCenterWorld.y,
      wz - _bladeCenterWorld.z,
    );
    const distToBase = Math.hypot(
      wx - this.position.x,
      wy - (this.position.y + 1.2),
      wz - this.position.z,
    );
    const hitRangeMeters = Math.max(2.2, radiusVoxels * VOXEL_SIZE + 2.4);
    if (distToBlade > hitRangeMeters && distToBase > hitRangeMeters + 2.5) {
      return false;
    }

    const blastOrigin = new THREE.Vector3(wx, wy, wz);
    const effectiveRadiusVox = Math.max(1.2, Math.min(4.5, radiusVoxels));
    let totalBroken = 0;
    let totalDamaged = 0;

    // 1. Carve localized crater on Base Support & Base Motors
    if (this.baseVoxels.size > 0) {
      this.worldToBaseLocal(wx, wy, wz, _subLocalPt);
      const res = this.carveSubAssemblyCrater(
        this.baseVoxels,
        this.baseHealth,
        _subLocalPt,
        effectiveRadiusVox,
        (vx, vy, vz, out) => this.baseVoxelToWorld(vx, vy, vz, out),
        blastOrigin,
        fx,
      );
      totalBroken += res.broken;
      totalDamaged += res.damaged;
    }

    // 2. Carve localized crater on Swinging Pendulum Arm
    if (this.armMounted && this.armVoxels.size > 0) {
      this.worldToArmLocal(wx, wy, wz, _subLocalPt);
      const res = this.carveSubAssemblyCrater(
        this.armVoxels,
        this.armHealth,
        _subLocalPt,
        effectiveRadiusVox,
        (vx, vy, vz, out) => this.armVoxelToWorld(vx, vy, vz, out),
        blastOrigin,
        fx,
      );
      totalBroken += res.broken;
      totalDamaged += res.damaged;
    }

    // 3. Carve localized crater on Primary Spinning Rotor (in its current rotated pose!)
    if (this.rotor1Mounted && this.rotorVoxels.size > 0) {
      this.worldToRotor1Local(wx, wy, wz, _subLocalPt);
      const res = this.carveSubAssemblyCrater(
        this.rotorVoxels,
        this.rotorHealth,
        _subLocalPt,
        effectiveRadiusVox,
        (vx, vy, vz, out) => this.rotor1VoxelToWorld(vx, vy, vz, out),
        blastOrigin,
        fx,
      );
      totalBroken += res.broken;
      totalDamaged += res.damaged;
    }

    // 4. Carve localized crater on Secondary Spinning Drum (in its current rotated pose!)
    if (this.rotor2Mounted && this.secondaryRotorVoxels.size > 0) {
      this.worldToRotor2Local(wx, wy, wz, _subLocalPt);
      const res = this.carveSubAssemblyCrater(
        this.secondaryRotorVoxels,
        this.secondaryRotorHealth,
        _subLocalPt,
        effectiveRadiusVox,
        (vx, vy, vz, out) => this.rotor2VoxelToWorld(vx, vy, vz, out),
        blastOrigin,
        fx,
      );
      totalBroken += res.broken;
      totalDamaged += res.damaged;
    }

    if (totalBroken === 0 && totalDamaged === 0) {
      return false;
    }

    // --- Structural Connectivity & Critical Support / Motor Checks ---

    // A. Base Foundation Connectivity (anchored to ground vy === 0):
    // If a support pillar, stanchion, or gantry leg is cut through, any upper base voxels
    // (including motor blocks mounted on top of that support!) sever into 3D falling islands!
    if (this.baseVoxels.size > 0) {
      totalBroken += this.severDisconnectedSubAssemblyIslands(
        this.baseVoxels,
        this.baseHealth,
        (_vx, vy, _vz) => vy === 0,
        (vx, vy, vz, out) => this.baseVoxelToWorld(vx, vy, vz, out),
        false,
        fx,
      );
    }

    // B. Pendulum Gantry Motor / Catapult Pneumatic Cylinder & Arm Connectivity:
    if (
      (this.presetId === 'PENDULUM_BLADE' ||
        this.presetId === 'LAUNCH_CATAPULT') &&
      this.armMounted
    ) {
      const intactOverheadMotor = this.countIntactKeysInMap(
        this.armMotorKeys,
        this.baseVoxels,
      );
      if (intactOverheadMotor < Math.ceil(this.initialArmMotorCount * 0.35)) {
        // Overhead gantry support or pneumatic cylinder motor broke! Detach the arm/plate!
        this.armMounted = false;
        totalBroken += this.detachEntireSubAssemblyAsIsland(
          this.armVoxels,
          this.armHealth,
          (vx, vy, vz, out) => this.armVoxelToWorld(vx, vy, vz, out),
          fx,
        );
        if (this.rotor1Mounted) {
          this.rotor1Mounted = false;
          totalBroken += this.detachEntireSubAssemblyAsIsland(
            this.rotorVoxels,
            this.rotorHealth,
            (vx, vy, vz, out) => this.rotor1VoxelToWorld(vx, vy, vz, out),
            fx,
          );
        }
      } else {
        // Check if the pendulum arm or catapult plate itself had chunks severed
        totalBroken += this.severDisconnectedSubAssemblyIslands(
          this.armVoxels,
          this.armHealth,
          (_vx, vy, vz) =>
            this.presetId === 'LAUNCH_CATAPULT' ? vz <= -3 : vy >= -1,
          (vx, vy, vz, out) => this.armVoxelToWorld(vx, vy, vz, out),
          false,
          fx,
        );
        if (this.armVoxels.size === 0) {
          this.armMounted = false;
        }
      }
    }

    // C. Primary Rotor (Rotor 1) Motor, Support & Hub Check:
    if (this.rotor1Mounted && this.rotorVoxels.size > 0) {
      const motorHostMap =
        this.presetId === 'PENDULUM_BLADE' ? this.armVoxels : this.baseVoxels;
      const intactMotorVoxels = this.countIntactKeysInMap(
        this.rotor1MotorKeys,
        motorHostMap,
      );
      const intactHubVoxels = this.countIntactHubVoxels(this.rotorVoxels);

      const motorOrSupportBroken =
        intactMotorVoxels < Math.ceil(this.initialRotor1MotorCount * 0.35) ||
        intactHubVoxels < 3;

      if (motorOrSupportBroken) {
        // The drive motor, axle hub, or support stanchion holding Rotor 1 broke!
        // Detach the entire remaining spinning blade/drum as a tumbling 3D voxel island!
        this.rotor1Mounted = false;
        totalBroken += this.detachEntireSubAssemblyAsIsland(
          this.rotorVoxels,
          this.rotorHealth,
          (vx, vy, vz, out) => this.rotor1VoxelToWorld(vx, vy, vz, out),
          fx,
        );
      } else {
        // Motor and support are still intact: only detach outer blade teeth/segments severed from the central hub!
        totalBroken += this.severDisconnectedSubAssemblyIslands(
          this.rotorVoxels,
          this.rotorHealth,
          (vx, vy, vz) =>
            this.presetId === 'TWIN_SHREDDER_PIT'
              ? Math.hypot(vx, vy) <= 1.4
              : Math.hypot(vx, vy, vz) <= 1.7,
          (vx, vy, vz, out) => this.rotor1VoxelToWorld(vx, vy, vz, out),
          true,
          fx,
        );
        if (this.rotorVoxels.size === 0) {
          this.rotor1Mounted = false;
        }
      }
    }

    // D. Secondary Rotor (Rotor 2 on TWIN_SHREDDER_PIT) Motor, Support & Hub Check:
    if (this.rotor2Mounted && this.secondaryRotorVoxels.size > 0) {
      const intactMotor2Voxels = this.countIntactKeysInMap(
        this.rotor2MotorKeys,
        this.baseVoxels,
      );
      const intactHub2Voxels = this.countIntactHubVoxels(
        this.secondaryRotorVoxels,
      );
      const motor2OrSupportBroken =
        intactMotor2Voxels < Math.ceil(this.initialRotor2MotorCount * 0.35) ||
        intactHub2Voxels < 3;

      if (motor2OrSupportBroken) {
        this.rotor2Mounted = false;
        totalBroken += this.detachEntireSubAssemblyAsIsland(
          this.secondaryRotorVoxels,
          this.secondaryRotorHealth,
          (vx, vy, vz, out) => this.rotor2VoxelToWorld(vx, vy, vz, out),
          fx,
        );
      } else {
        totalBroken += this.severDisconnectedSubAssemblyIslands(
          this.secondaryRotorVoxels,
          this.secondaryRotorHealth,
          (vx, vy) => Math.hypot(vx, vy) <= 1.4,
          (vx, vy, vz, out) => this.rotor2VoxelToWorld(vx, vy, vz, out),
          true,
          fx,
        );
        if (this.secondaryRotorVoxels.size === 0) {
          this.rotor2Mounted = false;
        }
      }
    }

    // Rebuild the greedy 0.25m micro-voxel meshes so the exact missing bite & charred voxels show immediately
    this.rebuildAllVoxelMeshes();

    if (fx) {
      fx.spawnWeldSparks(wx, wy, wz);
      if (totalBroken > 0) {
        fx.spawnDebris(wx, wy, wz, 0xfacc15, 9.5, 1.25);
      }
    }
    SoundFX.clank(8.5);

    if (this.getTotalVoxelCount() === 0) {
      this.destroyed = true;
      this.dispose(this.scene);
    }

    return totalBroken > 0 || totalDamaged > 0;
  }

  /**
   * Checks if `worldPt` touches an actual intact 0.25m voxel on the spinning rotor(s).
   * If part of a blade was broken off, that missing section no longer cuts vehicles!
   */
  private isWorldPointTouchingIntactRotorVoxel(worldPt: THREE.Vector3): boolean {
    if (this.rotor1Mounted && this.rotorVoxels.size > 0) {
      this.worldToRotor1Local(worldPt.x, worldPt.y, worldPt.z, _subLocalPt);
      const rvx = Math.round(_subLocalPt.x / VOXEL_SIZE);
      const rvy = Math.round(_subLocalPt.y / VOXEL_SIZE);
      const rvz = Math.round(_subLocalPt.z / VOXEL_SIZE);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (this.rotorVoxels.has(`${rvx + dx},${rvy + dy},${rvz + dz}`)) {
              return true;
            }
          }
        }
      }
    }

    if (this.rotor2Mounted && this.secondaryRotorVoxels.size > 0) {
      this.worldToRotor2Local(worldPt.x, worldPt.y, worldPt.z, _subLocalPt);
      const rvx = Math.round(_subLocalPt.x / VOXEL_SIZE);
      const rvy = Math.round(_subLocalPt.y / VOXEL_SIZE);
      const rvz = Math.round(_subLocalPt.z / VOXEL_SIZE);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (
              this.secondaryRotorVoxels.has(
                `${rvx + dx},${rvy + dy},${rvz + dz}`,
              )
            ) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Computes the current active cutting center in world space and checks/shreds any overlapping
   * vehicle or dynamic prop rig against the hazard's intact spinning rotor voxels.
   */
  public checkAndShredRig(
    rig: ModularVehicleRig,
    fx: VoxelFXSystem | null,
    dt: number,
  ): number {
    if (
      this.destroyed ||
      !rig ||
      rig.inBuildMode ||
      (rig.voxelCount <= 0 && rig.modules.length === 0)
    ) {
      return 0;
    }

    // --- Interactive Voxel Map Platforms: CONVEYOR_BELT, LAUNCH_CATAPULT, VOXEL_BRIDGE ---
    if (
      this.presetId === 'CONVEYOR_BELT' ||
      this.presetId === 'LAUNCH_CATAPULT' ||
      this.presetId === 'VOXEL_BRIDGE'
    ) {
      this.worldToBaseLocal(
        rig.position.x,
        rig.position.y,
        rig.position.z,
        _localPt,
      );

      if (this.presetId === 'CONVEYOR_BELT') {
        if (
          this.rotor1Mounted &&
          this.baseVoxels.size > 0 &&
          Math.abs(_localPt.x) <= 1.55 &&
          Math.abs(_localPt.z) <= 2.45 &&
          _localPt.y >= -0.25 &&
          _localPt.y <= 1.85
        ) {
          rig.rigidBody.wake();
          if (rig.propRigidBody) {
            rig.propRigidBody.isSleeping = false;
            rig.propRigidBody.sleepTimer = 0;
          }
          // Propel vehicle/prop forward along the conveyor belt's local +Z axis
          _tangentDir.set(0, 0.08, 1).normalize().applyQuaternion(this.quaternion);
          const beltAccel = 26.0 * dt;
          rig.rigidBody.velocity.x += _tangentDir.x * beltAccel;
          rig.rigidBody.velocity.y = Math.max(
            0,
            rig.rigidBody.velocity.y + _tangentDir.y * beltAccel,
          );
          rig.rigidBody.velocity.z += _tangentDir.z * beltAccel;
          rig.rigidBody.velocity.clampLength(0, 36.0);
          rig.velocity.copy(rig.rigidBody.velocity);
          if (rig.propRigidBody) {
            rig.propRigidBody.velocity.copy(rig.rigidBody.velocity);
          }
        }
        return 0;
      }

      if (this.presetId === 'LAUNCH_CATAPULT') {
        const cd = this.shredCooldownByRig.get(rig.vehicleId) ?? 0;
        if (
          cd <= 0 &&
          this.armMounted &&
          this.armVoxels.size > 0 &&
          Math.abs(_localPt.x) <= 1.55 &&
          Math.abs(_localPt.z) <= 1.75 &&
          _localPt.y >= -0.25 &&
          _localPt.y <= 1.85
        ) {
          this.shredCooldownByRig.set(rig.vehicleId, 0.65);
          this.pendulumPhase = Math.PI * 0.5;
          rig.rigidBody.wake();
          if (rig.propRigidBody) {
            rig.propRigidBody.isSleeping = false;
            rig.propRigidBody.sleepTimer = 0;
          }
          // Launch vehicle/prop upward and forward along catapult's local +Y / +Z
          _tangentDir.set(0, 12.5, 14.5).applyQuaternion(this.quaternion);
          rig.rigidBody.velocity.x += _tangentDir.x;
          rig.rigidBody.velocity.y = Math.max(12.5, rig.rigidBody.velocity.y + _tangentDir.y);
          rig.rigidBody.velocity.z += _tangentDir.z;
          rig.rigidBody.velocity.clampLength(0, 38.0);
          rig.velocity.copy(rig.rigidBody.velocity);
          if (rig.propRigidBody) {
            rig.propRigidBody.velocity.copy(rig.rigidBody.velocity);
          }
          if (fx) {
            fx.spawnWeldSparks(rig.position.x, rig.position.y, rig.position.z);
          }
          if (this.soundCooldown <= 0) {
            SoundFX.clank(9.0);
            this.soundCooldown = 0.25;
          }
        }
        return 0;
      }

      if (this.presetId === 'VOXEL_BRIDGE') {
        if (
          this.baseVoxels.size > 0 &&
          Math.abs(_localPt.x) <= 1.35 &&
          Math.abs(_localPt.z) <= 2.95 &&
          _localPt.y >= 0.45 &&
          _localPt.y <= 2.15
        ) {
          // Check if the bridge deck voxels directly beneath the rig are still intact!
          const bvx = Math.round(_localPt.x / VOXEL_SIZE);
          const bvz = Math.round(_localPt.z / VOXEL_SIZE);
          const deckIntact =
            this.baseVoxels.has(`${bvx},3,${bvz}`) ||
            this.baseVoxels.has(`${bvx},2,${bvz}`);
          if (deckIntact && rig.rigidBody.velocity.y < 0) {
            const deckWorldY = this.position.y + 4 * VOXEL_SIZE + 0.55;
            if (rig.position.y < deckWorldY) {
              rig.position.y = deckWorldY;
              rig.rigidBody.position.y = deckWorldY;
              rig.rigidBody.velocity.y = Math.max(0, rig.rigidBody.velocity.y);
              rig.velocity.y = rig.rigidBody.velocity.y;
            }
          }
        }
        return 0;
      }
    }

    if (
      (!this.rotor1Mounted && !this.rotor2Mounted) ||
      (this.rotorVoxels.size === 0 && this.secondaryRotorVoxels.size === 0)
    ) {
      return 0;
    }

    this.getActiveBladeCenterWorld(_bladeCenterWorld);

    // Fast bounding-sphere broadphase check
    const rigHalfX = (rig.maxVX - rig.minVX + 3) * VOXEL_SIZE * 0.5;
    const rigHalfY = (rig.maxVY - rig.minVY + 3) * VOXEL_SIZE * 0.5;
    const rigHalfZ = (rig.maxVZ - rig.minVZ + 3) * VOXEL_SIZE * 0.5;
    const rigRadius = Math.max(0.85, Math.hypot(rigHalfX, rigHalfY, rigHalfZ));
    const hazardBroadRadius =
      this.presetId === 'TWIN_SHREDDER_PIT'
        ? 2.45
        : this.spec.bladeRadiusMeters + 0.45;

    const dxW = rig.position.x - _bladeCenterWorld.x;
    const dyW = rig.position.y - _bladeCenterWorld.y;
    const dzW = rig.position.z - _bladeCenterWorld.z;
    const maxDist = rigRadius + hazardBroadRadius;
    if (dxW * dxW + dyW * dyW + dzW * dzW > maxDist * maxDist) {
      return 0;
    }

    // Rate-limit crater cleaving per rig so 120Hz substeps shred progressively and smoothly
    const cooldown = this.shredCooldownByRig.get(rig.vehicleId) ?? 0;
    if (cooldown > 0) {
      return 0;
    }

    _hazInvQuat.copy(this.quaternion).invert();

    let hitFound = false;
    let bestHitWorldX = _bladeCenterWorld.x;
    let bestHitWorldY = _bladeCenterWorld.y;
    let bestHitWorldZ = _bladeCenterWorld.z;
    let bestHitDistSq = Infinity;
    let hitMatOnRig = 0;

    rig.worldToLocalMetric(
      _bladeCenterWorld.x,
      _bladeCenterWorld.y,
      _bladeCenterWorld.z,
      _rigLocalMetric,
    );
    const centerVX = Math.floor(_rigLocalMetric.x / VOXEL_SIZE);
    const centerVY = Math.floor(_rigLocalMetric.y / VOXEL_SIZE);
    const centerVZ = Math.floor(_rigLocalMetric.z / VOXEL_SIZE);
    const scanRadVox = Math.ceil((hazardBroadRadius + 0.35) / VOXEL_SIZE);

    const minX = Math.max(rig.minVX, centerVX - scanRadVox);
    const maxX = Math.min(rig.maxVX, centerVX + scanRadVox);
    const minY = Math.max(rig.minVY, centerVY - scanRadVox);
    const maxY = Math.min(rig.maxVY, centerVY + scanRadVox);
    const minZ = Math.max(rig.minVZ, centerVZ - scanRadVox);
    const maxZ = Math.min(rig.maxVZ, centerVZ + scanRadVox);

    for (let vz = minZ; vz <= maxZ; vz++) {
      for (let vy = minY; vy <= maxY; vy++) {
        for (let vx = minX; vx <= maxX; vx++) {
          const mat = rig.getVoxel(vx, vy, vz);
          if (mat === 0) continue;
          rig.localVoxelToWorld(vx, vy, vz, _worldPt);
          if (this.isWorldPointTouchingIntactRotorVoxel(_worldPt)) {
            const dSq = _worldPt.distanceToSquared(_bladeCenterWorld);
            if (dSq < bestHitDistSq) {
              bestHitDistSq = dSq;
              bestHitWorldX = _worldPt.x;
              bestHitWorldY = _worldPt.y;
              bestHitWorldZ = _worldPt.z;
              hitMatOnRig = mat & 63;
              hitFound = true;
            }
          }
        }
      }
    }

    if (!hitFound && rig.modules.length > 0) {
      for (let i = 0; i < rig.modules.length; i++) {
        const m = rig.modules[i];
        rig.localVoxelToWorld(m.vx, m.vy, m.vz, _worldPt);
        if (this.isWorldPointTouchingIntactRotorVoxel(_worldPt)) {
          bestHitWorldX = _worldPt.x;
          bestHitWorldY = _worldPt.y;
          bestHitWorldZ = _worldPt.z;
          hitFound = true;
          break;
        }
      }
    }

    if (!hitFound) {
      return 0;
    }

    // If an explosive C4 barrel prop or C4 vehicle block is fed into the spinning blade,
    // carve an explosive blast into both the vehicle and the contact section of the blade!
    if (hitMatOnRig === MAT.C4_EXPLOSIVE) {
      rig.carveVehicleCrater(bestHitWorldX, bestHitWorldY, bestHitWorldZ, 4, 10);
      this.damageAtWorldPoint(bestHitWorldX, bestHitWorldY, bestHitWorldZ, 4, fx);
      return 8;
    }

    this.shredCooldownByRig.set(rig.vehicleId, 0.045);

    rig.rigidBody.wake();
    if (rig.propRigidBody) {
      rig.propRigidBody.isSleeping = false;
      rig.propRigidBody.sleepTimer = 0;
    }

    const prevVoxelCount = rig.voxelCount + rig.modules.length;
    const biteRadiusVoxels = this.presetId === 'TWIN_SHREDDER_PIT' ? 3 : 2;
    rig.carveVehicleCrater(
      bestHitWorldX,
      bestHitWorldY,
      bestHitWorldZ,
      biteRadiusVoxels,
      0,
    );
    const shearedCount = Math.max(
      1,
      prevVoxelCount - (rig.voxelCount + rig.modules.length),
    );

    _worldPt.set(bestHitWorldX, bestHitWorldY, bestHitWorldZ);
    if (this.presetId === 'TWIN_SHREDDER_PIT') {
      _localPt.copy(_worldPt).sub(this.position).applyQuaternion(_hazInvQuat);
      const pinchX = -_localPt.x * 5.5;
      const grindY = Math.abs(_localPt.x) < 0.45 ? -4.2 : 3.2;
      const jitterZ = (Math.random() - 0.5) * 4.0;
      _tangentDir.set(pinchX, grindY, jitterZ).applyQuaternion(this.quaternion);

      const dvScale = rig.isVoxelEntity ? 0.55 : 0.32;
      rig.rigidBody.velocity.x += _tangentDir.x * dvScale;
      rig.rigidBody.velocity.y += _tangentDir.y * dvScale;
      rig.rigidBody.velocity.z += _tangentDir.z * dvScale;
      rig.rigidBody.angularVelocity.x += (Math.random() - 0.5) * 3.5;
      rig.rigidBody.angularVelocity.z += (Math.random() - 0.5) * 3.5;
    } else {
      _localPt.copy(_worldPt).sub(_bladeCenterWorld).applyQuaternion(_hazInvQuat);
      if (this.presetId === 'SAW_BLADE_HORIZONTAL') {
        _tangentDir.set(-_localPt.z, 0.28, _localPt.x);
      } else {
        _tangentDir.set(
          _localPt.y,
          Math.max(0.35, -_localPt.x),
          (Math.random() - 0.5) * 0.35,
        );
      }
      if (_tangentDir.lengthSq() < 0.001) {
        _tangentDir.set(1, 0.5, 0);
      } else {
        _tangentDir.normalize();
      }
      _tangentDir.applyQuaternion(this.quaternion);

      const flingSpeed = this.presetId === 'PENDULUM_BLADE' ? 9.5 : 7.5;
      _impulseVec
        .copy(_tangentDir)
        .multiplyScalar(rig.rigidBody.mass * flingSpeed * 0.42);
      rig.rigidBody.applyImpulseAtPoint(_impulseVec, _worldPt);
    }

    rig.rigidBody.velocity.clampLength(0, 38.0);
    rig.rigidBody.angularVelocity.clampLength(0, 8.5);
    rig.velocity.copy(rig.rigidBody.velocity);
    rig.angularVelocity.copy(rig.rigidBody.angularVelocity);
    if (rig.propRigidBody) {
      rig.propRigidBody.velocity.copy(rig.rigidBody.velocity);
      rig.propRigidBody.angularVelocity.copy(rig.rigidBody.angularVelocity);
    }

    if (fx) {
      fx.spawnWeldSparks(bestHitWorldX, bestHitWorldY, bestHitWorldZ);
      fx.spawnDebris(
        bestHitWorldX,
        bestHitWorldY,
        bestHitWorldZ,
        0xfacc15,
        11.5,
        1.4,
      );
      fx.trauma = Math.min(1.0, fx.trauma + 0.16);
    }
    if (this.soundCooldown <= 0) {
      SoundFX.clank(9.5);
      this.soundCooldown = 0.07;
    }

    return shearedCount;
  }

  /**
   * Returns the solid 0.25m voxel material at `(wx, wy, wz)` across this hazard's intact
   * base, pendulum/catapult arm, and spinning rotors, or `MAT.AIR` (`0`) if empty.
   */
  public getSolidVoxelMaterialAtWorld(wx: number, wy: number, wz: number): number {
    if (this.destroyed) return MAT.AIR;
    if (
      Math.abs(wx - this.position.x) > 4.2 ||
      Math.abs(wz - this.position.z) > 4.2 ||
      wy < this.position.y - 0.5 ||
      wy > this.position.y + 6.5
    ) {
      return MAT.AIR;
    }

    if (this.baseVoxels.size > 0) {
      this.worldToBaseLocal(wx, wy, wz, _subLocalPt);
      const vx = Math.round(_subLocalPt.x / VOXEL_SIZE);
      const vy = Math.round(_subLocalPt.y / VOXEL_SIZE);
      const vz = Math.round(_subLocalPt.z / VOXEL_SIZE);
      const mat = this.baseVoxels.get(`${vx},${vy},${vz}`);
      if (mat) return mat & 63;
      if (
        this.presetId === 'CONVEYOR_BELT' &&
        (this.rotor1Mounted || this.rotor2Mounted) &&
        Math.abs(vx) <= 4 &&
        Math.abs(vz) <= 8 &&
        (vy === 1 || vy === 2)
      ) {
        return MAT.ASPHALT;
      }
    }

    if (this.armMounted && this.armVoxels.size > 0) {
      this.worldToArmLocal(wx, wy, wz, _subLocalPt);
      const vx = Math.round(_subLocalPt.x / VOXEL_SIZE);
      const vy = Math.round(_subLocalPt.y / VOXEL_SIZE);
      const vz = Math.round(_subLocalPt.z / VOXEL_SIZE);
      const mat = this.armVoxels.get(`${vx},${vy},${vz}`);
      if (mat) return mat & 63;
    }

    if (this.rotor1Mounted && this.rotorVoxels.size > 0) {
      this.worldToRotor1Local(wx, wy, wz, _subLocalPt);
      const vx = Math.round(_subLocalPt.x / VOXEL_SIZE);
      const vy = Math.round(_subLocalPt.y / VOXEL_SIZE);
      const vz = Math.round(_subLocalPt.z / VOXEL_SIZE);
      const mat = this.rotorVoxels.get(`${vx},${vy},${vz}`);
      if (mat) return mat & 63;
    }

    if (this.rotor2Mounted && this.secondaryRotorVoxels.size > 0) {
      this.worldToRotor2Local(wx, wy, wz, _subLocalPt);
      const vx = Math.round(_subLocalPt.x / VOXEL_SIZE);
      const vy = Math.round(_subLocalPt.y / VOXEL_SIZE);
      const vz = Math.round(_subLocalPt.z / VOXEL_SIZE);
      const mat = this.secondaryRotorVoxels.get(`${vx},${vy},${vz}`);
      if (mat) return mat & 63;
    }

    return MAT.AIR;
  }

  /**
   * Probes downward from `startY + maxStepUp` to find the highest walkable voxel top surface
   * on this hazard (e.g. `VOXEL_BRIDGE` deck, `CONVEYOR_BELT` bed, `LAUNCH_CATAPULT` plate, or support bases).
   */
  public probeVoxelSurfaceBelow(
    wx: number,
    startY: number,
    wz: number,
    maxStepUp = 0.5,
  ): { y: number; mat: number } | null {
    if (this.destroyed) return null;
    if (
      Math.abs(wx - this.position.x) > 4.2 ||
      Math.abs(wz - this.position.z) > 4.2
    ) {
      return null;
    }

    const maxAllowedY = startY + maxStepUp;
    const minScanY = Math.max(this.position.y - 0.25, startY - 3.5);
    if (maxAllowedY < minScanY) return null;

    // Fast exact check in base local coordinates for baseVoxels (VOXEL_BRIDGE, CONVEYOR_BELT, bases)
    let bestY = -Infinity;
    let bestMat: number = MAT.AIR;

    if (this.baseVoxels.size > 0) {
      this.worldToBaseLocal(wx, startY, wz, _subLocalPt);
      const bvx = Math.round(_subLocalPt.x / VOXEL_SIZE);
      const bvz = Math.round(_subLocalPt.z / VOXEL_SIZE);
      const maxLocalVY = Math.min(24, Math.floor((maxAllowedY - this.position.y) / VOXEL_SIZE));
      for (let vy = maxLocalVY; vy >= 0; vy--) {
        const mat = this.baseVoxels.get(`${bvx},${vy},${bvz}`);
        if (!mat) continue;
        const above1 = this.baseVoxels.has(`${bvx},${vy + 1},${bvz}`);
        const above2 = this.baseVoxels.has(`${bvx},${vy + 2},${bvz}`);
        if (!above1 && !above2) {
          const topWorldY = this.position.y + (vy + 0.5) * VOXEL_SIZE;
          if (topWorldY <= maxAllowedY + 0.02 && topWorldY > bestY) {
            bestY = topWorldY;
            bestMat = mat & 63;
          }
          break;
        }
      }
    }

    // Check conveyor belt moving tread deck & rollers at local y = 0.56m so vehicles, props, and players ride smoothly on top of the belt
    if (
      this.presetId === 'CONVEYOR_BELT' &&
      (this.rotor1Mounted || this.rotor2Mounted) &&
      this.baseVoxels.size > 0
    ) {
      this.worldToBaseLocal(wx, startY, wz, _subLocalPt);
      if (Math.abs(_subLocalPt.x) <= 1.25 && Math.abs(_subLocalPt.z) <= 2.35) {
        const beltTopY = this.position.y + 2.25 * VOXEL_SIZE;
        if (beltTopY <= maxAllowedY + 0.08 && beltTopY > bestY) {
          bestY = beltTopY;
          bestMat = MAT.ASPHALT;
        }
      }
    }

    // Check catapult launch arm plate so player can step onto the launch pad
    if (this.presetId === 'LAUNCH_CATAPULT' && this.armMounted && this.armVoxels.size > 0) {
      this.worldToArmLocal(wx, startY, wz, _subLocalPt);
      const avx = Math.round(_subLocalPt.x / VOXEL_SIZE);
      const avz = Math.round(_subLocalPt.z / VOXEL_SIZE);
      for (let vy = 4; vy >= -2; vy--) {
        const mat = this.armVoxels.get(`${avx},${vy},${avz}`);
        if (!mat) continue;
        if (!this.armVoxels.has(`${avx},${vy + 1},${avz}`)) {
          this.armVoxelToWorld(avx, vy, avz, _worldPt);
          const topWorldY = _worldPt.y + VOXEL_SIZE * 0.5;
          if (topWorldY <= maxAllowedY + 0.08 && topWorldY > bestY) {
            bestY = topWorldY;
            bestMat = mat & 63;
          }
          break;
        }
      }
    }

    if (bestY > -Infinity) {
      return { y: Math.round(bestY * 100) / 100, mat: bestMat };
    }
    return null;
  }

  /**
   * Resolves active hazard physics against an on-foot player:
   * - `CONVEYOR_BELT`: carries and accelerates the player along the belt's forward direction
   * - `LAUNCH_CATAPULT`: flings the player upward and forward when stepping onto the active launch plate
   * - Spinning Blades / Shredders (`SAW_BLADE_VERTICAL`, `SAW_BLADE_HORIZONTAL`, `TWIN_SHREDDER_PIT`, `PENDULUM_BLADE`):
   *   checks the player's body capsule against intact spinning rotor voxels and knocks the player back tangentially with sparks & trauma!
   */
  public checkAndResolvePlayerInteraction(
    playerState: PlayerHazardInteractionState,
    fx: VoxelFXSystem | null,
    dt: number,
  ): boolean {
    if (this.destroyed) return false;

    const px = playerState.position.x;
    const pz = playerState.position.z;
    const footY = playerState.footY;

    if (
      Math.abs(px - this.position.x) > 4.2 ||
      Math.abs(pz - this.position.z) > 4.2 ||
      footY > this.position.y + 6.0 ||
      footY + 1.8 < this.position.y - 0.5
    ) {
      return false;
    }

    this.worldToBaseLocal(px, footY, pz, _localPt);

    if (this.presetId === 'CONVEYOR_BELT') {
      if (
        this.rotor1Mounted &&
        this.baseVoxels.size > 0 &&
        Math.abs(_localPt.x) <= 1.35 &&
        Math.abs(_localPt.z) <= 2.45 &&
        _localPt.y >= -0.25 &&
        _localPt.y <= 1.25
      ) {
        _tangentDir.set(0, 0, 1).applyQuaternion(this.quaternion);
        const beltCarrySpeed = 7.8;
        playerState.knockbackVel.x =
          playerState.knockbackVel.x * (1 - Math.min(1, dt * 8)) +
          _tangentDir.x * beltCarrySpeed * Math.min(1, dt * 10);
        playerState.knockbackVel.z =
          playerState.knockbackVel.z * (1 - Math.min(1, dt * 8)) +
          _tangentDir.z * beltCarrySpeed * Math.min(1, dt * 10);
        return true;
      }
      return false;
    }

    if (this.presetId === 'LAUNCH_CATAPULT') {
      const cd = this.shredCooldownByRig.get('__local_player__') ?? 0;
      if (
        cd <= 0 &&
        this.armMounted &&
        this.armVoxels.size > 0 &&
        Math.abs(_localPt.x) <= 1.45 &&
        Math.abs(_localPt.z) <= 1.65 &&
        _localPt.y >= -0.25 &&
        _localPt.y <= 1.45
      ) {
        this.shredCooldownByRig.set('__local_player__', 0.65);
        this.pendulumPhase = Math.PI * 0.5;
        _tangentDir.set(0, 13.5, 15.0).applyQuaternion(this.quaternion);
        playerState.velY = Math.max(playerState.velY, _tangentDir.y);
        playerState.knockbackVel.x += _tangentDir.x;
        playerState.knockbackVel.z += _tangentDir.z;
        if (fx) {
          fx.spawnWeldSparks(px, footY + 0.4, pz);
          fx.trauma = Math.min(1.0, fx.trauma + 0.22);
        }
        if (this.soundCooldown <= 0) {
          SoundFX.clank(9.0);
          this.soundCooldown = 0.25;
        }
        return true;
      }
      return false;
    }

    if (this.presetId === 'VOXEL_BRIDGE') {
      return false;
    }

    // Spinning Blades & Shredders: check player body cylinder sample points against intact rotor voxels
    if (
      (!this.rotor1Mounted && !this.rotor2Mounted) ||
      (this.rotorVoxels.size === 0 && this.secondaryRotorVoxels.size === 0)
    ) {
      return false;
    }

    const cd = this.shredCooldownByRig.get('__local_player__') ?? 0;
    if (cd > 0) {
      return false;
    }

    this.getActiveBladeCenterWorld(_bladeCenterWorld);
    const sampleHeights = [footY + 0.25, footY + 0.85, footY + 1.45];
    const sampleRadialOffsets: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [0.32, 0],
      [-0.32, 0],
      [0, 0.32],
      [0, -0.32],
    ];

    let hitRotor = false;
    let hitX = px;
    let hitY = footY + 0.85;
    let hitZ = pz;

    for (let hIdx = 0; hIdx < sampleHeights.length && !hitRotor; hIdx++) {
      const sy = sampleHeights[hIdx];
      for (let rIdx = 0; rIdx < sampleRadialOffsets.length; rIdx++) {
        const [ox, oz] = sampleRadialOffsets[rIdx];
        _worldPt.set(px + ox, sy, pz + oz);
        if (this.isWorldPointTouchingIntactRotorVoxel(_worldPt)) {
          hitRotor = true;
          hitX = _worldPt.x;
          hitY = _worldPt.y;
          hitZ = _worldPt.z;
          break;
        }
      }
    }

    if (!hitRotor) {
      return false;
    }

    this.shredCooldownByRig.set('__local_player__', 0.22);
    _hazInvQuat.copy(this.quaternion).invert();
    _localPt.set(px, footY + 0.85, pz).sub(_bladeCenterWorld).applyQuaternion(_hazInvQuat);

    if (this.presetId === 'SAW_BLADE_HORIZONTAL') {
      _tangentDir.set(-_localPt.z + _localPt.x * 0.6, 0.45, _localPt.x + _localPt.z * 0.6);
    } else if (this.presetId === 'TWIN_SHREDDER_PIT') {
      _tangentDir.set(_localPt.x >= 0 ? 1.0 : -1.0, 0.75, (Math.random() - 0.5) * 0.6);
    } else {
      _tangentDir.set(
        _localPt.x * 0.7 + (_localPt.y >= 0 ? 0.6 : -0.6),
        0.55,
        (_localPt.z >= 0 ? 0.8 : -0.8),
      );
    }
    if (_tangentDir.lengthSq() < 0.001) {
      _tangentDir.set(0, 0.6, 1);
    }
    _tangentDir.normalize().applyQuaternion(this.quaternion);

    const knockSpeed = this.presetId === 'PENDULUM_BLADE' ? 14.5 : 12.0;
    playerState.knockbackVel.x = _tangentDir.x * knockSpeed;
    playerState.knockbackVel.z = _tangentDir.z * knockSpeed;
    playerState.velY = Math.max(playerState.velY, 7.5);

    if (fx) {
      fx.spawnWeldSparks(hitX, hitY, hitZ);
      fx.spawnDebris(hitX, hitY, hitZ, 0x38bdf8, 9.5, 1.1);
      fx.trauma = Math.min(1.0, fx.trauma + 0.35);
    }
    if (this.soundCooldown <= 0) {
      SoundFX.clank(9.5);
      this.soundCooldown = 0.09;
    }

    return true;
  }

  public serialize(): SerializedMapHazard {
    return {
      presetId: this.presetId,
      wx: Number(this.position.x.toFixed(3)),
      wy: Number(this.position.y.toFixed(3)),
      wz: Number(this.position.z.toFixed(3)),
      yawRad: Number(this.yawRad.toFixed(4)),
    };
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.rootGroup);
    this.rootGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        mesh.geometry.dispose();
      }
    });
  }
}

export interface PlayerHazardInteractionState {
  position: THREE.Vector3;
  footY: number;
  velY: number;
  knockbackVel: THREE.Vector3;
}

/**
 * Steps active map hazard interactions (Conveyor Belt push, Launch Catapult fling,
 * and Spinning Blade / Shredder tangential knockback) against the on-foot player.
 */
export function stepPlayerMapHazardsInteraction(
  hazards: ReadonlyArray<KinematicMapHazard>,
  playerState: PlayerHazardInteractionState,
  fx: VoxelFXSystem | null,
  dt: number,
): boolean {
  let interacted = false;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    if (h.destroyed) continue;
    if (h.checkAndResolvePlayerInteraction(playerState, fx, dt)) {
      interacted = true;
    }
  }
  return interacted;
}

/**
 * Raycasts a segment or ray against all active voxel map hazards.
 */
export function raycastAllMapHazards(
  hazards: ReadonlyArray<KinematicMapHazard>,
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3,
  maxDist = 28,
): MapHazardRayHit | null {
  let bestHit: MapHazardRayHit | null = null;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    if (h.destroyed) continue;
    const hit = h.raycastHazard(rayOrigin, rayDir, bestHit ? bestHit.distance : maxDist);
    if (hit && (!bestHit || hit.distance < bestHit.distance)) {
      bestHit = hit;
    }
  }
  return bestHit;
}

/**
 * Carves localized voxel damage into any voxel map hazards caught within a sledgehammer swing,
 * projectile impact, or C4 explosion radius.
 */
export function damageAllMapHazardsInRadius(
  hazards: KinematicMapHazard[],
  wx: number,
  wy: number,
  wz: number,
  radiusVoxels: number,
  fx: VoxelFXSystem | null,
  forceExplode = false,
): number {
  let affected = 0;
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    if (h.destroyed) {
      hazards.splice(i, 1);
      continue;
    }
    if (h.damageAtWorldPoint(wx, wy, wz, radiusVoxels, fx, forceExplode)) {
      affected++;
      if (h.destroyed) {
        hazards.splice(i, 1);
      }
    }
  }
  return affected;
}

/**
 * Steps all active map hazards (visual blade rotation + vehicle/prop/island shredding)
 * and prunes any completely destroyed hazards.
 */
export function stepMapHazardsPhysics(
  hazards: KinematicMapHazard[],
  creations: ReadonlyArray<ModularVehicleRig>,
  voxelEntities: ReadonlyArray<ModularVehicleRig>,
  fx: VoxelFXSystem | null,
  dt: number,
): number {
  if (hazards.length === 0) return 0;
  let totalSheared = 0;

  for (let hIdx = hazards.length - 1; hIdx >= 0; hIdx--) {
    const haz = hazards[hIdx];
    if (haz.destroyed) {
      hazards.splice(hIdx, 1);
      continue;
    }
    haz.stepVisuals(dt);

    for (let cIdx = 0; cIdx < creations.length; cIdx++) {
      totalSheared += haz.checkAndShredRig(creations[cIdx], fx, dt);
      if (haz.destroyed) break;
    }
    if (haz.destroyed) {
      hazards.splice(hIdx, 1);
      continue;
    }

    for (let eIdx = 0; eIdx < voxelEntities.length; eIdx++) {
      totalSheared += haz.checkAndShredRig(voxelEntities[eIdx], fx, dt);
      if (haz.destroyed) break;
    }
    if (haz.destroyed) {
      hazards.splice(hIdx, 1);
      continue;
    }

    // Also fling any severed island chunks that tumble into active spinning blades!
    if ((haz.rotor1Mounted || haz.rotor2Mounted) && fx && fx.detachedChunks.length > 0) {
      for (let dIdx = 0; dIdx < fx.detachedChunks.length; dIdx++) {
        const chunk = fx.detachedChunks[dIdx];
        const dx = chunk.group.position.x - haz.position.x;
        const dy = chunk.group.position.y - (haz.position.y + 1.0);
        const dz = chunk.group.position.z - haz.position.z;
        const hitR = haz.spec.bladeRadiusMeters + 0.65;
        if (dx * dx + dy * dy + dz * dz <= hitR * hitR) {
          chunk.sleeping = false;
          chunk.lowSpeedTimer = 0;
          chunk.vel.set(
            (Math.random() - 0.5) * 14.0,
            5.5 + Math.random() * 5.0,
            (Math.random() - 0.5) * 14.0,
          );
          chunk.angVel.set(
            (Math.random() - 0.5) * 12.0,
            (Math.random() - 0.5) * 12.0,
            (Math.random() - 0.5) * 12.0,
          );
          fx.spawnWeldSparks(
            chunk.group.position.x,
            chunk.group.position.y,
            chunk.group.position.z,
          );
        }
      }
    }
  }

  return totalSheared;
}

/**
 * Spawns a single KinematicMapHazard built out of 0.25m micro-voxels snapped cleanly onto the terrain surface.
 */
export function spawnMapHazardOnTerrain(
  scene: THREE.Scene,
  world: MicroVoxelWorld,
  presetId: MapHazardPresetId,
  wx: number,
  wz: number,
  yawRad = 0,
  explicitWY?: number,
): KinematicMapHazard {
  let wy = explicitWY;
  if (wy === undefined) {
    const gnd = world.probeGroundBelow(wx, WATER_LEVEL + 32.0, wz, 48.0);
    wy = Math.max(WATER_LEVEL, gnd.y);
  }
  return new KinematicMapHazard(scene, world, presetId, wx, wy, wz, yawRad);
}

/**
 * Spawns the default Proving Grounds Stunt & Shredder Gauntlet voxel hazards
 * along the dedicated West Shredder Gauntlet Apron (wx = -15m..-9m, wz = 14m..34m)
 * so the center Beginner Runway & Table-Top Jump stay unobstructed for new pilots!
 */
export function spawnDefaultArenaMapHazards(
  scene: THREE.Scene,
  world: MicroVoxelWorld,
): KinematicMapHazard[] {
  const layout: Array<{
    presetId: MapHazardPresetId;
    wx: number;
    wz: number;
    yawRad: number;
  }> = [
    { presetId: 'SAW_BLADE_VERTICAL', wx: -9.2, wz: 15.0, yawRad: 0 },
    { presetId: 'TWIN_SHREDDER_PIT', wx: -14.2, wz: 20.5, yawRad: 0 },
    { presetId: 'SAW_BLADE_HORIZONTAL', wx: -9.2, wz: 26.5, yawRad: 0 },
    { presetId: 'PENDULUM_BLADE', wx: -12.2, wz: 33.5, yawRad: 0 },
    { presetId: 'CONVEYOR_BELT', wx: 10.5, wz: 14.5, yawRad: 0 },
    { presetId: 'LAUNCH_CATAPULT', wx: 10.5, wz: 22.0, yawRad: 0 },
    { presetId: 'VOXEL_BRIDGE', wx: 10.5, wz: 32.5, yawRad: 0 },
  ];

  const list: KinematicMapHazard[] = [];
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];
    list.push(
      spawnMapHazardOnTerrain(
        scene,
        world,
        item.presetId,
        item.wx,
        item.wz,
        item.yawRad,
      ),
    );
  }
  return list;
}

