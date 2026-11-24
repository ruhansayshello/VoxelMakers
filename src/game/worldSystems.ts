import * as THREE from 'three';
import { VOXEL_SIZE, WATER_VY } from './constants.ts';
import type { MicroVoxelWorld } from './world.ts';
import type { VoxelFXSystem } from './fx.ts';
import type { ModularVehicleRig } from './vehicle.ts';
import { SoundFX } from './sound.ts';

export type ArenaTrapKind =
  | 'PRESSURE_MINE'
  | 'LASER_TRIPWIRE'
  | 'CRUSHER_PRESS'
  | 'BOULDER_DISPENSER'
  | 'FUEL_SILO'
  | 'FRACTURE_PILLAR';

export type WeatherDisasterMode =
  | 'CALM'
  | 'WIND_GUSTS'
  | 'FLOOD_SURGE'
  | 'METEOR_SHOWER'
  | 'VORTEX_STORM';

export type AIBotBehaviorMode =
  | 'OFF'
  | 'PATROL'
  | 'RACE_WAYPOINTS'
  | 'DERBY_RAM'
  | 'TURRET_COMBAT'
  | 'EVADE';

export type CustomTrackNodeKind =
  | 'START_FINISH_GATE'
  | 'CHECKPOINT_RING'
  | 'BOOST_PAD';

export interface ArenaTrapInstance {
  id: number;
  kind: ArenaTrapKind;
  pos: THREE.Vector3;
  yaw: number;
  group: THREE.Group;
  movingPart?: THREE.Object3D;
  cooldown: number;
  phase: number;
  intact: boolean;
  health: number;
}

export interface CustomTrackNode {
  id: number;
  kind: CustomTrackNodeKind;
  index: number;
  pos: THREE.Vector3;
  yaw: number;
  group: THREE.Group;
  triggeredThisLap: boolean;
}

export interface AerialTargetDrone {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  orbitCenter: THREE.Vector3;
  orbitRadius: number;
  orbitPhase: number;
  health: number;
  group: THREE.Group;
  rotorMesh: THREE.Object3D;
  fireCooldown: number;
}

export interface CrashTelemetryReport {
  timestampMs: number;
  peakSpeedKmh: number;
  peakGForce: number;
  hullIntegrityPct: number;
  blocksDetached: number;
}

const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _tmpDummy = new THREE.Object3D();
const _tmpColor = new THREE.Color();

function disposeDroneGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m) => m.dispose());
    } else if (mesh.material) {
      mesh.material.dispose();
    }
  });
}

// Circular Ghost Replay Recorder capacity: 1800 samples (~30 seconds at 60Hz) * 7 floats (x, y, z, qx, qy, qz, qw)
const MAX_GHOST_SAMPLES = 1800;

export class WorldArenaSystemsManager {
  public scene: THREE.Scene;
  public world: MicroVoxelWorld;
  public fx: VoxelFXSystem;

  // 1. Placeable Traps & Destructible Chain-Reaction Structures
  public traps: ArenaTrapInstance[] = [];
  private nextTrapId = 1;

  // 2. Dynamic Weather & Disasters
  public disasterMode: WeatherDisasterMode = 'CALM';
  public windForceVec = new THREE.Vector3(0, 0, 0);
  public floodWaterOffsetMeters = 0;
  private disasterTimer = 0;
  private meteorSpawnTimer = 0;
  private vortexCenter = new THREE.Vector3(18, 8, -18);
  private weatherParticlesCount = 240;
  private weatherInstanced: THREE.InstancedMesh;
  private weatherOffsets: Float32Array;
  private lastWeatherColorHex = -1;

  // 3. Autonomous AI Bot Behavior & Aerial Target Drones
  public aiBotMode: AIBotBehaviorMode = 'OFF';
  public targetDronesEnabled = false;
  public drones: AerialTargetDrone[] = [];
  private droneRespawnTimers: Array<ReturnType<typeof setTimeout>> = [];
  public dronesDestroyedCount = 0;
  private aiDecisionTimer = 0;

  // 4. Custom Race Track Builder & Ghost Lap Replay
  public trackNodes: CustomTrackNode[] = [];
  private nextTrackNodeId = 1;
  public raceActive = false;
  public currentLapTimeSec = 0;
  public bestLapTimeSec: number | null = null;
  public lastLapTimeSec: number | null = null;
  public checkpointsCleared = 0;
  public totalCheckpoints = 0;

  // Ghost Lap Recording & Playback
  public ghostReplayEnabled = true;
  private currentLapBuffer = new Float32Array(MAX_GHOST_SAMPLES * 7);
  private currentLapSampleCount = 0;
  private bestLapBuffer = new Float32Array(MAX_GHOST_SAMPLES * 7);
  private bestLapSampleCount = 0;
  private ghostPlaybackCursor = 0;
  public ghostMeshGroup: THREE.Group;

  // 5. Slow-Mo Impact Camera & Crash Telemetry
  public autoSlowMoOnCrash = true;
  public slowMoRemainingSec = 0;
  public timeScale = 1.0;
  public lastCrashReport: CrashTelemetryReport | null = null;
  private prevRigVel = new THREE.Vector3();
  private prevRigVoxelCount = 0;
  private crashCooldownSec = 0;

  constructor(scene: THREE.Scene, world: MicroVoxelWorld, fx: VoxelFXSystem) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;

    // Weather InstancedMesh (rain streaks / wind dust / vortex embers in 1 draw call)
    const wGeo = new THREE.BoxGeometry(0.08, 0.85, 0.08);
    const wMat = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.weatherInstanced = new THREE.InstancedMesh(
      wGeo,
      wMat,
      this.weatherParticlesCount,
    );
    this.weatherInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.weatherInstanced.frustumCulled = false;
    this.weatherInstanced.visible = false;
    this.weatherOffsets = new Float32Array(this.weatherParticlesCount * 3);
    for (let i = 0; i < this.weatherParticlesCount; i++) {
      this.weatherOffsets[i * 3] = (Math.random() - 0.5) * 64;
      this.weatherOffsets[i * 3 + 1] = Math.random() * 28;
      this.weatherOffsets[i * 3 + 2] = (Math.random() - 0.5) * 64;
    }
    this.scene.add(this.weatherInstanced);

    // Translucent Ghost Replay Vehicle Hologram
    this.ghostMeshGroup = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });
    const ghostChassis = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.9, 3.8),
      ghostMat,
    );
    ghostChassis.position.y = 0.65;
    const ghostCab = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.65, 1.8),
      ghostMat,
    );
    ghostCab.position.set(0, 1.35, -0.2);
    this.ghostMeshGroup.add(ghostChassis, ghostCab);
    this.ghostMeshGroup.visible = false;
    this.scene.add(this.ghostMeshGroup);
  }

  // ============================================================================
  // 1. ARENA TRAPS & DESTRUCTIBLE STRUCTURES
  // ============================================================================
  public spawnArenaTrap(
    kind: ArenaTrapKind,
    wx: number,
    wz: number,
    yaw = 0,
  ): ArenaTrapInstance {
    const wy = this.world.getSurfaceHeightAt(wx, wz);
    const group = new THREE.Group();
    group.position.set(wx, wy, wz);
    group.rotation.y = yaw;

    const stdMat = (hex: number, metal = 0.45, rough = 0.4) =>
      new THREE.MeshStandardMaterial({
        color: hex,
        metalness: metal,
        roughness: rough,
      });
    const glowMat = (hex: number, intensity = 2.0) =>
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: intensity,
        roughness: 0.2,
      });

    let movingPart: THREE.Object3D | undefined;

    if (kind === 'PRESSURE_MINE') {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.25, 0.16, 16),
        stdMat(0x334155),
      );
      base.position.y = 0.08;
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.82, 0.86, 0.12, 16),
        glowMat(0xef4444, 1.8),
      );
      pad.position.y = 0.18;
      group.add(base, pad);
      movingPart = pad;
    } else if (kind === 'LASER_TRIPWIRE') {
      const postL = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.18, 1.4, 10),
        stdMat(0x1e293b),
      );
      postL.position.set(-2.2, 0.7, 0);
      const postR = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.18, 1.4, 10),
        stdMat(0x1e293b),
      );
      postR.position.set(2.2, 0.7, 0);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 4.4, 8),
        glowMat(0xf43f5e, 2.8),
      );
      beam.rotation.z = Math.PI / 2;
      beam.position.y = 0.85;
      group.add(postL, postR, beam);
      movingPart = beam;
    } else if (kind === 'CRUSHER_PRESS') {
      for (const sx of [-2.1, 2.1]) {
        const pillar = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 4.6, 0.45),
          stdMat(0x334155),
        );
        pillar.position.set(sx, 2.3, 0);
        group.add(pillar);
      }
      const topBeam = new THREE.Mesh(
        new THREE.BoxGeometry(4.8, 0.55, 0.9),
        stdMat(0x1e293b),
      );
      topBeam.position.y = 4.6;
      const ramHead = new THREE.Group();
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 0.75, 1.8),
        stdMat(0xf59e0b, 0.6, 0.35),
      );
      const pistonStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 3.2, 10),
        stdMat(0xcbd5e1, 0.8, 0.2),
      );
      pistonStem.position.y = 1.8;
      ramHead.add(plate, pistonStem);
      ramHead.position.y = 3.4;
      group.add(topBeam, ramHead);
      movingPart = ramHead;
    } else if (kind === 'BOULDER_DISPENSER') {
      const chute = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 2.8, 2.4),
        stdMat(0x475569),
      );
      chute.position.y = 1.4;
      const boulder = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.05, 1),
        stdMat(0x78716c, 0.1, 0.85),
      );
      boulder.position.set(0, 1.5, 1.4);
      group.add(chute, boulder);
      movingPart = boulder;
    } else if (kind === 'FUEL_SILO') {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(1.35, 1.35, 4.2, 16),
        stdMat(0xdc2626, 0.45, 0.35),
      );
      tank.position.y = 2.1;
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(1.38, 1.38, 0.55, 16),
        glowMat(0xfacc15, 1.4),
      );
      stripe.position.y = 2.1;
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(1.34, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
        stdMat(0x991b1b),
      );
      dome.position.y = 4.2;
      group.add(tank, stripe, dome);
    } else if (kind === 'FRACTURE_PILLAR') {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.6, 1.4),
        stdMat(0x475569),
      );
      base.position.y = 0.3;
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 5.2, 1.0),
        stdMat(0x64748b),
      );
      col.position.y = 2.9;
      const weakRing = new THREE.Mesh(
        new THREE.BoxGeometry(1.08, 0.32, 1.08),
        glowMat(0xf97316, 1.8),
      );
      weakRing.position.y = 1.4;
      group.add(base, col, weakRing);
      movingPart = col;
    }

    this.scene.add(group);
    const inst: ArenaTrapInstance = {
      id: this.nextTrapId++,
      kind,
      pos: new THREE.Vector3(wx, wy, wz),
      yaw,
      group,
      movingPart,
      cooldown: 0,
      phase: 0,
      intact: true,
      health: 100,
    };
    this.traps.push(inst);
    return inst;
  }

  public clearArenaTraps(): void {
    for (const t of this.traps) {
      this.scene.remove(t.group);
    }
    this.traps.length = 0;
  }

  public onExplosionNearTraps(
    wx: number,
    wy: number,
    wz: number,
    radiusVoxels: number,
  ): void {
    const blastRadiusM = radiusVoxels * VOXEL_SIZE + 2.6;
    for (const t of this.traps) {
      if (!t.intact) continue;
      const dist = t.pos.distanceTo(_tmpVecA.set(wx, wy, wz));
      if (dist <= blastRadiusM) {
        this.triggerOrDestroyTrap(t);
      }
    }
  }

  private triggerOrDestroyTrap(t: ArenaTrapInstance): void {
    if (!t.intact) return;
    if (t.kind === 'FUEL_SILO') {
      t.intact = false;
      t.group.visible = false;
      // Chain-reaction multi-crater fuel silo detonation
      this.fx.pendingExplosions.push(
        {
          wx: t.pos.x,
          wy: t.pos.y + 1.2,
          wz: t.pos.z,
          radiusVoxels: 11,
          depth: 1,
          damageVehicle: true,
        },
        {
          wx: t.pos.x + 1.8,
          wy: t.pos.y + 2.4,
          wz: t.pos.z - 1.4,
          radiusVoxels: 9,
          depth: 1,
          damageVehicle: true,
        },
      );
      SoundFX.explode();
    } else if (t.kind === 'FRACTURE_PILLAR') {
      t.intact = false;
      if (t.movingPart) {
        t.movingPart.rotation.z = Math.PI * 0.46;
        t.movingPart.position.set(2.2, 0.7, 0);
      }
      this.fx.carveWorldCrater(t.pos.x + 2.5, t.pos.y + 0.5, t.pos.z, 6, 1, true);
    } else if (t.kind === 'PRESSURE_MINE' || t.kind === 'LASER_TRIPWIRE') {
      t.intact = false;
      t.group.visible = false;
      this.fx.carveWorldCrater(t.pos.x, t.pos.y + 0.5, t.pos.z, 9, 1, true);
    }
  }

  // ============================================================================
  // 2. CUSTOM RACE TRACK BUILDER & GHOST REPLAY
  // ============================================================================
  public spawnTrackNode(
    kind: CustomTrackNodeKind,
    wx: number,
    wz: number,
    yaw = 0,
  ): CustomTrackNode {
    const wy = this.world.getSurfaceHeightAt(wx, wz);
    const group = new THREE.Group();
    group.position.set(wx, wy, wz);
    group.rotation.y = yaw;

    const cpIndex =
      kind === 'CHECKPOINT_RING'
        ? this.trackNodes.filter((n) => n.kind === 'CHECKPOINT_RING').length + 1
        : 0;

    if (kind === 'START_FINISH_GATE') {
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        metalness: 0.5,
        roughness: 0.35,
      });
      const bannerMat = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 1.5,
      });
      for (const sx of [-3.6, 3.6]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.26, 5.2, 12),
          pillarMat,
        );
        post.position.set(sx, 2.6, 0);
        group.add(post);
      }
      const arch = new THREE.Mesh(
        new THREE.BoxGeometry(7.8, 0.65, 0.45),
        bannerMat,
      );
      arch.position.y = 5.1;
      group.add(arch);
    } else if (kind === 'CHECKPOINT_RING') {
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 1.6,
        roughness: 0.2,
      });
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(3.2, 0.18, 10, 28),
        ringMat,
      );
      torus.position.y = 3.2;
      group.add(torus);
    } else if (kind === 'BOOST_PAD') {
      const padMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 1.9,
        roughness: 0.25,
      });
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.14, 3.6),
        padMat,
      );
      plate.position.y = 0.08;
      group.add(plate);
    }

    this.scene.add(group);
    const node: CustomTrackNode = {
      id: this.nextTrackNodeId++,
      kind,
      index: cpIndex,
      pos: new THREE.Vector3(wx, wy, wz),
      yaw,
      group,
      triggeredThisLap: false,
    };
    this.trackNodes.push(node);
    this.totalCheckpoints = this.trackNodes.filter(
      (n) => n.kind === 'CHECKPOINT_RING',
    ).length;
    return node;
  }

  public clearTrackNodes(): void {
    for (const n of this.trackNodes) {
      this.scene.remove(n.group);
    }
    this.trackNodes.length = 0;
    this.raceActive = false;
    this.currentLapTimeSec = 0;
    this.checkpointsCleared = 0;
    this.totalCheckpoints = 0;
    this.ghostMeshGroup.visible = false;
  }

  // ============================================================================
  // 3. AERIAL TARGET DRONES
  // ============================================================================
  public setTargetDronesEnabled(enabled: boolean, centerPos?: THREE.Vector3): void {
    this.targetDronesEnabled = enabled;
    if (!enabled) {
      for (const timer of this.droneRespawnTimers) {
        clearTimeout(timer);
      }
      this.droneRespawnTimers.length = 0;
      for (const d of this.drones) {
        this.scene.remove(d.group);
        disposeDroneGroup(d.group);
      }
      this.drones.length = 0;
      return;
    }
    if (this.drones.length === 0) {
      const baseCenter = centerPos
        ? centerPos.clone()
        : new THREE.Vector3(0, 14, 0);
      for (let i = 0; i < 5; i++) {
        this.spawnSingleDrone(i, baseCenter);
      }
    }
  }

  private spawnSingleDrone(idx: number, baseCenter: THREE.Vector3): void {
    const group = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.6,
      roughness: 0.3,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xf43f5e,
      emissiveIntensity: 2.2,
    });
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.65, 1),
      hullMat,
    );
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.55), eyeMat);
    eye.position.z = 0.45;
    const rotor = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 0.05, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8 }),
    );
    rotor.position.y = 0.65;
    group.add(core, eye, rotor);

    const ang = (idx / 5) * Math.PI * 2;
    const radius = 18 + (idx % 3) * 7;
    const pos = new THREE.Vector3(
      baseCenter.x + Math.cos(ang) * radius,
      Math.max(12, baseCenter.y + 8 + (idx % 2) * 4),
      baseCenter.z + Math.sin(ang) * radius,
    );
    group.position.copy(pos);
    this.scene.add(group);

    this.drones.push({
      id: idx + 1,
      pos,
      vel: new THREE.Vector3(),
      orbitCenter: baseCenter.clone(),
      orbitRadius: radius,
      orbitPhase: ang,
      health: 100,
      group,
      rotorMesh: rotor,
      fireCooldown: 1.5 + idx * 0.4,
    });
  }

  // ============================================================================
  // 4. MAIN PER-FRAME STEP
  // ============================================================================
  public update(
    dt: number,
    activeRig: ModularVehicleRig | null,
    allRigs: ModularVehicleRig[],
    observerPos: THREE.Vector3,
    waterMesh?: THREE.Mesh | null,
  ): void {
    // 1. Slow-Mo Time Scale & Crash Telemetry Monitoring
    if (!this.autoSlowMoOnCrash) {
      this.slowMoRemainingSec = 0;
      this.timeScale = 1.0;
    } else if (this.slowMoRemainingSec > 0) {
      this.slowMoRemainingSec = Math.max(0, this.slowMoRemainingSec - dt);
      this.timeScale = this.slowMoRemainingSec > 0 ? 0.28 : 1.0;
    } else {
      this.timeScale = 1.0;
    }
    if (this.crashCooldownSec > 0) {
      this.crashCooldownSec = Math.max(0, this.crashCooldownSec - dt);
    }
    if (
      this.lastCrashReport &&
      Date.now() - this.lastCrashReport.timestampMs >= 4500
    ) {
      this.lastCrashReport = null;
    }

    if (activeRig && !activeRig.inBuildMode && dt > 0.001) {
      const currSpeedMPS = activeRig.velocity.length();
      const deltaV = _tmpVecA
        .copy(activeRig.velocity)
        .sub(this.prevRigVel)
        .length();
      const gForce = deltaV / Math.max(0.008, dt) / 9.81;
      const currVoxels = activeRig.summary?.voxelCount ?? 0;

      if (
        gForce >= 7.5 &&
        this.prevRigVel.length() * 3.6 >= 28 &&
        this.crashCooldownSec <= 0
      ) {
        const blocksLost = Math.max(0, this.prevRigVoxelCount - currVoxels);
        const integrityPct = Math.round((activeRig.structuralHealth ?? 1) * 100);
        this.lastCrashReport = {
          timestampMs: Date.now(),
          peakSpeedKmh: Math.round(
            Math.max(currSpeedMPS, this.prevRigVel.length()) * 3.6,
          ),
          peakGForce: Math.round(gForce * 10) / 10,
          hullIntegrityPct: integrityPct,
          blocksDetached: blocksLost,
        };
        this.crashCooldownSec = 3.5;
        if (this.autoSlowMoOnCrash && gForce >= 10.5) {
          this.slowMoRemainingSec = 1.15;
          this.timeScale = 0.28;
        }
      }
      this.prevRigVel.copy(activeRig.velocity);
      this.prevRigVoxelCount = currVoxels;
    }

    // 2. Step Arena Traps & Destructible Structures
    for (let i = 0; i < this.traps.length; i++) {
      const t = this.traps[i];
      if (!t.intact) continue;
      if (t.cooldown > 0) t.cooldown = Math.max(0, t.cooldown - dt);

      if (t.kind === 'CRUSHER_PRESS' && t.movingPart) {
        t.phase += dt * 2.8;
        const pressY = 1.05 + Math.abs(Math.sin(t.phase)) * 2.55;
        t.movingPart.position.y = pressY;
        if (pressY < 1.35 && t.cooldown <= 0) {
          for (const r of allRigs) {
            if (r.inBuildMode) continue;
            if (r.position.distanceTo(t.pos) < 2.8) {
              t.cooldown = 0.65;
              r.carveVehicleCrater(t.pos.x, t.pos.y + 1.0, t.pos.z, 4, 8.5);
              SoundFX.clank(18);
            }
          }
        }
      } else if (t.kind === 'BOULDER_DISPENSER' && t.movingPart) {
        t.phase += dt * 1.6;
        t.movingPart.rotation.x += dt * 3.2;
        const rollOffset = (t.phase % 4.0) * 3.5;
        const fwdX = Math.sin(t.yaw) * rollOffset;
        const fwdZ = Math.cos(t.yaw) * rollOffset;
        const bx = t.pos.x + fwdX;
        const bz = t.pos.z + fwdZ;
        const by = this.world.getSurfaceHeightAt(bx, bz) + 1.05;
        t.movingPart.position.set(0, by - t.pos.y, rollOffset);
        for (const r of allRigs) {
          if (r.inBuildMode) continue;
          if (r.position.distanceTo(_tmpVecA.set(bx, by, bz)) < 2.4 && t.cooldown <= 0) {
            t.cooldown = 0.8;
            r.velocity.y += 6.5;
            r.carveVehicleCrater(bx, by, bz, 3, 6.0);
            SoundFX.clank(14);
          }
        }
      } else {
        for (const r of allRigs) {
          if (r.inBuildMode) continue;
          const d = r.position.distanceTo(t.pos);
          if (
            (t.kind === 'PRESSURE_MINE' && d < 2.2) ||
            (t.kind === 'LASER_TRIPWIRE' && d < 2.6) ||
            ((t.kind === 'FUEL_SILO' || t.kind === 'FRACTURE_PILLAR') &&
              d < 2.5 &&
              r.velocity.length() > 8.5)
          ) {
            this.triggerOrDestroyTrap(t);
            break;
          }
        }
      }
    }

    // 3. Step Dynamic Weather & Disasters
    this.stepWeatherAndDisasters(dt, allRigs, observerPos, waterMesh);

    // 4. Step Autonomous AI Bot Rigs & Aerial Target Drones
    this.stepAIBotsAndDrones(dt, activeRig, allRigs, observerPos);

    // 5. Step Custom Race Track & Ghost Lap Replay
    this.stepRaceTrackAndGhost(dt, activeRig);
  }

  private stepWeatherAndDisasters(
    dt: number,
    allRigs: ModularVehicleRig[],
    observerPos: THREE.Vector3,
    waterMesh?: THREE.Mesh | null,
  ): void {
    this.disasterTimer += dt;

    if (this.disasterMode === 'CALM') {
      this.windForceVec.set(0, 0, 0);
      this.floodWaterOffsetMeters += (0 - this.floodWaterOffsetMeters) * Math.min(1, dt * 2.5);
      this.weatherInstanced.visible = false;
    } else {
      this.weatherInstanced.visible = true;

      if (this.disasterMode === 'WIND_GUSTS') {
        const gustAngle = Math.sin(this.disasterTimer * 0.45) * 0.8;
        const gustMag = 9.5 + Math.sin(this.disasterTimer * 1.6) * 4.5;
        this.windForceVec.set(
          Math.cos(gustAngle) * gustMag,
          0,
          Math.sin(gustAngle) * gustMag,
        );
        for (const r of allRigs) {
          if (!r.inBuildMode) {
            r.velocity.x += this.windForceVec.x * dt * 0.38;
            r.velocity.z += this.windForceVec.z * dt * 0.38;
          }
        }
      } else if (this.disasterMode === 'FLOOD_SURGE') {
        const targetSurge = 3.2 + Math.sin(this.disasterTimer * 0.5) * 1.4;
        this.floodWaterOffsetMeters +=
          (targetSurge - this.floodWaterOffsetMeters) * Math.min(1, dt * 1.2);
        for (const r of allRigs) {
          if (!r.inBuildMode) {
            const floodSurfaceY = WATER_VY * VOXEL_SIZE + this.floodWaterOffsetMeters;
            if (r.position.y < floodSurfaceY) {
              const depth = Math.min(2.5, floodSurfaceY - r.position.y);
              r.velocity.y += depth * 14.5 * dt;
            }
          }
        }
      } else if (this.disasterMode === 'METEOR_SHOWER') {
        this.meteorSpawnTimer += dt;
        if (this.meteorSpawnTimer >= 1.35) {
          this.meteorSpawnTimer = 0;
          const mx = observerPos.x + (Math.random() - 0.5) * 75;
          const mz = observerPos.z + (Math.random() - 0.5) * 75;
          const startPos = new THREE.Vector3(mx, observerPos.y + 42, mz);
          const dir = new THREE.Vector3(
            (Math.random() - 0.5) * 0.35,
            -0.94,
            (Math.random() - 0.5) * 0.35,
          ).normalize();
          this.fx.fireWeaponProjectile(
            'BOMB',
            startPos,
            dir,
            new THREE.Vector3(0, -18, 0),
            true,
            true,
          );
        }
      } else if (this.disasterMode === 'VORTEX_STORM') {
        this.vortexCenter.set(
          observerPos.x + Math.cos(this.disasterTimer * 0.35) * 22,
          observerPos.y,
          observerPos.z + Math.sin(this.disasterTimer * 0.35) * 22,
        );
        for (const r of allRigs) {
          if (r.inBuildMode) continue;
          const dx = this.vortexCenter.x - r.position.x;
          const dz = this.vortexCenter.z - r.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 1.5 && dist < 38) {
            const pull = (1 - dist / 38) * 14.0;
            // Inward radial pull + tangential swirl + upward lift near vortex eye
            const nx = dx / dist;
            const nz = dz / dist;
            r.velocity.x += (nx * 0.55 - nz * 0.85) * pull * dt;
            r.velocity.z += (nz * 0.55 + nx * 0.85) * pull * dt;
            if (dist < 14) {
              r.velocity.y += (1 - dist / 14) * 16.0 * dt;
            }
          }
        }
      }

      // Animate single-pass weather InstancedMesh around observerPos
      const isVortex = this.disasterMode === 'VORTEX_STORM';
      const isMeteor = this.disasterMode === 'METEOR_SHOWER';
      const targetColorHex = isMeteor
        ? 0xf97316
        : isVortex
          ? 0x94a3b8
          : 0xbae6fd;
      const colorChanged = targetColorHex !== this.lastWeatherColorHex;
      if (colorChanged) {
        this.lastWeatherColorHex = targetColorHex;
        _tmpColor.setHex(targetColorHex);
      }
      for (let i = 0; i < this.weatherParticlesCount; i++) {
        const idx = i * 3;
        let ox = this.weatherOffsets[idx];
        let oy = this.weatherOffsets[idx + 1];
        let oz = this.weatherOffsets[idx + 2];

        oy -= dt * (isMeteor ? 22 : 16);
        ox += this.windForceVec.x * dt * 0.8;
        oz += this.windForceVec.z * dt * 0.8;
        if (oy < -4) oy += 30;
        if (ox > 32) ox -= 64;
        if (ox < -32) ox += 64;
        if (oz > 32) oz -= 64;
        if (oz < -32) oz += 64;

        this.weatherOffsets[idx] = ox;
        this.weatherOffsets[idx + 1] = oy;
        this.weatherOffsets[idx + 2] = oz;

        if (isVortex) {
          const ang = this.disasterTimer * 4.5 + i * 0.25;
          const rad = 1.5 + (oy / 30) * 12.0;
          _tmpDummy.position.set(
            this.vortexCenter.x + Math.cos(ang) * rad,
            observerPos.y + oy - 4,
            this.vortexCenter.z + Math.sin(ang) * rad,
          );
          _tmpDummy.rotation.set(0.3, ang, 0.4);
          _tmpDummy.scale.set(2.2, 0.4, 2.2);
        } else {
          _tmpDummy.position.set(
            observerPos.x + ox,
            observerPos.y + oy,
            observerPos.z + oz,
          );
          _tmpDummy.rotation.set(0, 0, this.windForceVec.x * -0.03);
          _tmpDummy.scale.set(1, 1, 1);
        }
        _tmpDummy.updateMatrix();
        this.weatherInstanced.setMatrixAt(i, _tmpDummy.matrix);
        if (colorChanged) {
          this.weatherInstanced.setColorAt(i, _tmpColor);
        }
      }
      this.weatherInstanced.instanceMatrix.needsUpdate = true;
      if (colorChanged && this.weatherInstanced.instanceColor) {
        this.weatherInstanced.instanceColor.needsUpdate = true;
      }
    }

    if (waterMesh) {
      waterMesh.position.y = WATER_VY * VOXEL_SIZE + this.floodWaterOffsetMeters;
    }
  }

  private stepAIBotsAndDrones(
    dt: number,
    activeRig: ModularVehicleRig | null,
    allRigs: ModularVehicleRig[],
    observerPos: THREE.Vector3,
  ): void {
    // Check if thermal flares are active (distract AI targeting!)
    const activeFlarePos =
      this.fx.activeFlares.length > 0
        ? this.fx.activeFlares[this.fx.activeFlares.length - 1].pos
        : null;

    const targetPos =
      activeFlarePos ||
      (activeRig ? activeRig.position : observerPos);

    // Step Autonomous AI Vehicle Rigs (any non-player rig when aiBotMode !== 'OFF')
    if (this.aiBotMode !== 'OFF' && allRigs.length > 1) {
      this.aiDecisionTimer += dt;
      for (let i = 0; i < allRigs.length; i++) {
        const bot = allRigs[i];
        if (
          !bot ||
          bot === activeRig ||
          bot.inBuildMode ||
          bot.isVoxelEntity ||
          bot.aiConfig?.enabled
        ) {
          continue;
        }

        let goalX = targetPos.x;
        let goalZ = targetPos.z;

        if (this.aiBotMode === 'PATROL') {
          const patrolAng = this.disasterTimer * 0.4 + i * 2.1;
          goalX = Math.cos(patrolAng) * 42;
          goalZ = Math.sin(patrolAng) * 42;
        } else if (
          this.aiBotMode === 'RACE_WAYPOINTS' &&
          this.trackNodes.length > 0
        ) {
          const wpIdx =
            Math.floor(this.disasterTimer * 0.25 + i) % this.trackNodes.length;
          goalX = this.trackNodes[wpIdx].pos.x;
          goalZ = this.trackNodes[wpIdx].pos.z;
        } else if (this.aiBotMode === 'EVADE') {
          goalX = bot.position.x + (bot.position.x - targetPos.x);
          goalZ = bot.position.z + (bot.position.z - targetPos.z);
        }

        const dx = goalX - bot.position.x;
        const dz = goalZ - bot.position.z;
        const dist = Math.hypot(dx, dz);

        // Compute desired heading error in bot's local space
        _tmpVecA.set(0, 0, 1).applyQuaternion(bot.quaternion);
        _tmpVecB.set(1, 0, 0).applyQuaternion(bot.quaternion);
        const fwdDot = (dx * _tmpVecA.x + dz * _tmpVecA.z) / Math.max(0.1, dist);
        const rightDot = (dx * _tmpVecB.x + dz * _tmpVecB.z) / Math.max(0.1, dist);

        // Apply autonomous steering & forward drive impulse
        const steerCmd = Math.max(-1, Math.min(1, -rightDot * 1.8));
        bot.steerAngle = steerCmd * 0.55;
        if (dist > 4.0) {
          const driveAccel = fwdDot >= -0.2 ? 9.5 : -6.5;
          bot.velocity.x += _tmpVecA.x * driveAccel * dt;
          bot.velocity.z += _tmpVecA.z * driveAccel * dt;
          bot.heading += steerCmd * 1.35 * dt * Math.sign(driveAccel);
          bot.quaternion.setFromAxisAngle(_upAxis, bot.heading);
        }

        // Aim turrets and fire in TURRET_COMBAT mode
        if (this.aiBotMode === 'TURRET_COMBAT') {
          bot.aimTurretsAt(_tmpVecA.set(goalX, targetPos.y + 0.8, goalZ), dt);
          if (dist < 48 && Math.random() < dt * 1.4) {
            bot.fireMountedCannons(this.fx);
          }
        }
      }
    }

    // Step Aerial Target Drones
    if (this.targetDronesEnabled) {
      for (let i = this.drones.length - 1; i >= 0; i--) {
        const d = this.drones[i];
        d.orbitPhase += dt * 0.65;
        d.rotorMesh.rotation.y += dt * 22.0;

        const destX = activeFlarePos
          ? activeFlarePos.x + Math.cos(d.orbitPhase * 3) * 4
          : observerPos.x + Math.cos(d.orbitPhase) * d.orbitRadius;
        const destZ = activeFlarePos
          ? activeFlarePos.z + Math.sin(d.orbitPhase * 3) * 4
          : observerPos.z + Math.sin(d.orbitPhase) * d.orbitRadius;
        const destY = Math.max(
          this.world.getSurfaceHeightAt(destX, destZ) + 7.5,
          observerPos.y + 9.0 + Math.sin(d.orbitPhase * 2.0) * 2.5,
        );

        d.pos.x += (destX - d.pos.x) * Math.min(1, dt * 2.4);
        d.pos.y += (destY - d.pos.y) * Math.min(1, dt * 2.4);
        d.pos.z += (destZ - d.pos.z) * Math.min(1, dt * 2.4);
        d.group.position.copy(d.pos);
        d.group.lookAt(targetPos.x, targetPos.y + 0.8, targetPos.z);

        // Check if any active player weapon shell hit this drone
        for (let sIdx = this.fx.shells.length - 1; sIdx >= 0; sIdx--) {
          const sh = this.fx.shells[sIdx];
          if (sh.mesh.position.distanceTo(d.pos) < 1.65) {
            d.health = 0;
            this.fx.carveWorldCrater(d.pos.x, d.pos.y, d.pos.z, 4, 1, false);
            this.dronesDestroyedCount++;
            this.scene.remove(d.group);
            disposeDroneGroup(d.group);
            this.drones.splice(i, 1);
            // Respawn replacement drone after a short delay
            const respawnOrigin = observerPos.clone();
            const timerId = setTimeout(() => {
              const tIdx = this.droneRespawnTimers.indexOf(timerId);
              if (tIdx >= 0) this.droneRespawnTimers.splice(tIdx, 1);
              if (this.targetDronesEnabled && this.drones.length < 5) {
                this.spawnSingleDrone(this.drones.length + 1, respawnOrigin);
              }
            }, 3500);
            this.droneRespawnTimers.push(timerId);
            break;
          }
        }
      }
    }
  }

  private stepRaceTrackAndGhost(
    dt: number,
    activeRig: ModularVehicleRig | null,
  ): void {
    if (!activeRig || activeRig.inBuildMode || this.trackNodes.length === 0) {
      this.ghostMeshGroup.visible = false;
      return;
    }

    for (const node of this.trackNodes) {
      const dist = activeRig.position.distanceTo(node.pos);
      if (node.kind === 'BOOST_PAD' && dist < 3.0) {
        const fwdX = Math.sin(node.yaw);
        const fwdZ = Math.cos(node.yaw);
        activeRig.velocity.x += fwdX * 38.0 * dt;
        activeRig.velocity.z += fwdZ * 38.0 * dt;
        SoundFX.boost();
      } else if (
        node.kind === 'CHECKPOINT_RING' &&
        dist < 4.5 &&
        !node.triggeredThisLap
      ) {
        node.triggeredThisLap = true;
        this.checkpointsCleared++;
        SoundFX.snap();
      } else if (node.kind === 'START_FINISH_GATE' && dist < 4.6) {
        if (!this.raceActive) {
          this.raceActive = true;
          this.currentLapTimeSec = 0;
          this.checkpointsCleared = 0;
          this.currentLapSampleCount = 0;
          this.ghostPlaybackCursor = 0;
          for (const cp of this.trackNodes) cp.triggeredThisLap = false;
          SoundFX.telegraph();
        } else if (
          this.currentLapTimeSec > 3.0 &&
          (this.totalCheckpoints === 0 ||
            this.checkpointsCleared >= this.totalCheckpoints)
        ) {
          // Lap completed!
          this.lastLapTimeSec = this.currentLapTimeSec;
          if (
            this.bestLapTimeSec === null ||
            this.currentLapTimeSec < this.bestLapTimeSec
          ) {
            this.bestLapTimeSec = this.currentLapTimeSec;
            this.bestLapBuffer.set(this.currentLapBuffer);
            this.bestLapSampleCount = this.currentLapSampleCount;
          }
          this.currentLapTimeSec = 0;
          this.checkpointsCleared = 0;
          this.currentLapSampleCount = 0;
          this.ghostPlaybackCursor = 0;
          for (const cp of this.trackNodes) cp.triggeredThisLap = false;
          SoundFX.victory();
        }
      }
    }

    if (this.raceActive) {
      this.currentLapTimeSec += dt;

      // Record current vehicle transform into circular lap buffer
      if (this.currentLapSampleCount < MAX_GHOST_SAMPLES) {
        const base = this.currentLapSampleCount * 7;
        this.currentLapBuffer[base] = activeRig.position.x;
        this.currentLapBuffer[base + 1] = activeRig.position.y;
        this.currentLapBuffer[base + 2] = activeRig.position.z;
        this.currentLapBuffer[base + 3] = activeRig.quaternion.x;
        this.currentLapBuffer[base + 4] = activeRig.quaternion.y;
        this.currentLapBuffer[base + 5] = activeRig.quaternion.z;
        this.currentLapBuffer[base + 6] = activeRig.quaternion.w;
        this.currentLapSampleCount++;
      }

      // Playback best-lap ghost hologram
      if (this.ghostReplayEnabled && this.bestLapSampleCount > 0) {
        this.ghostMeshGroup.visible = true;
        const idx = Math.min(
          this.bestLapSampleCount - 1,
          this.ghostPlaybackCursor,
        );
        const base = idx * 7;
        this.ghostMeshGroup.position.set(
          this.bestLapBuffer[base],
          this.bestLapBuffer[base + 1],
          this.bestLapBuffer[base + 2],
        );
        this.ghostMeshGroup.quaternion.set(
          this.bestLapBuffer[base + 3],
          this.bestLapBuffer[base + 4],
          this.bestLapBuffer[base + 5],
          this.bestLapBuffer[base + 6],
        );
        this.ghostPlaybackCursor++;
      } else {
        this.ghostMeshGroup.visible = false;
      }
    } else {
      this.ghostMeshGroup.visible = false;
    }
  }

  public dispose(): void {
    this.clearArenaTraps();
    this.clearTrackNodes();
    this.setTargetDronesEnabled(false);
    this.scene.remove(this.weatherInstanced);
    this.weatherInstanced.geometry.dispose();
    if (this.weatherInstanced.material instanceof THREE.Material) {
      this.weatherInstanced.material.dispose();
    }
    this.scene.remove(this.ghostMeshGroup);
  }
}
