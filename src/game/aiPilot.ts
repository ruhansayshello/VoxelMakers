import * as THREE from 'three';
import {
  MAT,
  VOXEL_SIZE,
  WATER_LEVEL,
  isWheelOrTireModuleKind,
  type ModuleKind,
  type ModuleTuningConfig,
} from './constants.ts';
import { isSeatModuleKind } from './physicsMath.ts';
import { PHYSICS_CONFIG } from './physics/physicsConfig.ts';

export type VehicleAIRole = 'AUTO' | 'MELEE' | 'GUNNER' | 'RAMMER' | 'GUARD';
export type VehicleAITeam = 'PLAYER' | 'RED' | 'BLUE' | 'GREEN' | 'ROGUE';
export type VehicleAIPersonality = 'AGGRESSIVE' | 'CAUTIOUS' | 'MIXED';
export type AIMistakeType =
  | 'NONE'
  | 'WRONG_TURN'
  | 'LATE_BRAKE'
  | 'OFF_AIM'
  | 'OBSTACLE_CLIP';

export interface TargetHistorySample {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

export function pickRandomAIPersonality(
  rng: () => number = Math.random,
): VehicleAIPersonality {
  const r = rng();
  if (r < 1 / 3) return 'AGGRESSIVE';
  if (r < 2 / 3) return 'CAUTIOUS';
  return 'MIXED';
}

export interface VehicleAIConfig {
  enabled: boolean;
  role: VehicleAIRole;
  team: VehicleAITeam;
  personality: VehicleAIPersonality;
  effectivePersonality: 'AGGRESSIVE' | 'CAUTIOUS';
  homeX: number;
  homeZ: number;
  statusLabel: string;
  activeStyleLabel: string;
}

export function createDefaultVehicleAIConfig(
  rng: () => number = Math.random,
): VehicleAIConfig {
  const personality = pickRandomAIPersonality(rng);
  return {
    enabled: false,
    role: 'AUTO',
    team: 'RED',
    personality,
    effectivePersonality: personality === 'CAUTIOUS' ? 'CAUTIOUS' : 'AGGRESSIVE',
    homeX: 0,
    homeZ: 0,
    statusLabel: 'HUMAN',
    activeStyleLabel: 'IDLE',
  };
}

export interface AIBrainMemory {
  stuckTimer: number;
  unstuckTimer: number;
  unstuckSteerSign: number;
  flipTimer: number;
  selfRightCooldown: number;
  meleeRecoverTimer: number;
  yawTrim: number;
  lastSampleX: number;
  lastSampleZ: number;
  progressSampleTimer: number;
  strafeSign: number;
  strafeFlipTimer: number;
  pistonCycleTimer: number;
  thrusterBurstTimer: number;
  hasInitializedPos: boolean;
  simTime: number;
  reactionDelaySec: number;
  observedTargetId: string | null;
  targetHistory: TargetHistorySample[];
  hasLastKnownTarget: boolean;
  lastKnownTargetX: number;
  lastKnownTargetY: number;
  lastKnownTargetZ: number;
  lastKnownTargetVx: number;
  lastKnownTargetVz: number;
  losBlockedTimer: number;
  searchAngle: number;
  searchRadius: number;
  searchDirection: number;
  hesitationTimer: number;
  hesitationCooldown: number;
  mistakeEvalTimer: number;
  mistakeTimer: number;
  activeMistakeType: AIMistakeType;
  mistakeSteerOffset: number;
  mistakeAimOffsetX: number;
  mistakeAimOffsetZ: number;
  mixedPhase: 'AGGRESSIVE' | 'CAUTIOUS';
  mixedPhaseTimer: number;
  wallRecoverTimer: number;
  wallRecoverSteer: number;
  wallDodgeTimer: number;
  wallDodgeSign: number;
}

export function createDefaultAIBrainMemory(
  rng: () => number = Math.random,
): AIBrainMemory {
  const baseDelaySec = PHYSICS_CONFIG.aiReactionDelayMs / 1000;
  const reactionDelaySec = Math.max(
    0.25,
    Math.min(0.4, baseDelaySec + (rng() - 0.35) * 0.14),
  );
  return {
    stuckTimer: 0,
    unstuckTimer: 0,
    unstuckSteerSign: 1,
    flipTimer: 0,
    selfRightCooldown: 0,
    meleeRecoverTimer: 0,
    yawTrim: 0,
    lastSampleX: 0,
    lastSampleZ: 0,
    progressSampleTimer: 0,
    strafeSign: 1,
    strafeFlipTimer: 4.5,
    pistonCycleTimer: 0,
    thrusterBurstTimer: 0,
    hasInitializedPos: false,
    simTime: 0,
    reactionDelaySec,
    observedTargetId: null,
    targetHistory: [],
    hasLastKnownTarget: false,
    lastKnownTargetX: 0,
    lastKnownTargetY: 0,
    lastKnownTargetZ: 0,
    lastKnownTargetVx: 0,
    lastKnownTargetVz: 0,
    losBlockedTimer: 0,
    searchAngle: rng() * Math.PI * 2,
    searchRadius: 7.0,
    searchDirection: rng() < 0.5 ? 1 : -1,
    hesitationTimer: 0,
    hesitationCooldown: 0,
    mistakeEvalTimer: 0.7 + rng() * 0.8,
    mistakeTimer: 0,
    activeMistakeType: 'NONE',
    mistakeSteerOffset: 0,
    mistakeAimOffsetX: 0,
    mistakeAimOffsetZ: 0,
    mixedPhase: rng() < 0.5 ? 'AGGRESSIVE' : 'CAUTIOUS',
    mixedPhaseTimer: 5.0 + rng() * 5.0,
    wallRecoverTimer: 0,
    wallRecoverSteer: 1,
    wallDodgeTimer: 0,
    wallDodgeSign: 0,
  };
}

export interface AIModuleLike {
  kind: ModuleKind;
  vx: number;
  vy: number;
  vz: number;
  yawIdx?: number;
  pitchIdx?: number;
  rollIdx?: number;
  health?: number;
  isShotOut?: boolean;
  lastCompression?: number;
  config?: ModuleTuningConfig;
}

export interface AIRigLike {
  vehicleId: string;
  networkId?: string;
  customBlueprintName?: string | null;
  isVoxelEntity: boolean;
  inBuildMode: boolean;
  isRemoteControlled?: boolean;
  isSeatedByLocalPlayer?: boolean;
  voxelCount: number;
  totalMass: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  angularVelocity?: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  comLocal?: { x: number; y: number; z: number };
  minVX?: number;
  maxVX?: number;
  minVZ?: number;
  maxVZ?: number;
  modules: AIModuleLike[];
  voxelMap?: Map<number | string, number>;
  aiConfig: VehicleAIConfig;
  aiBrainMemory: AIBrainMemory;
  structuralIntegrityPct?: number;
}

export interface VehicleCapabilityProfile {
  intactDriveWheels: number;
  intactSteerWheels: number;
  groundedWheels: number;
  leftDriveWheels: number;
  rightDriveWheels: number;
  wheelAsymmetryBias: number;
  engineCount: number;
  forwardThrusters: number;
  reverseThrusters: number;
  upThrusters: number;
  lateralThrusters: number;
  forwardThrusterKeys: string[];
  reverseThrusterKeys: string[];
  upThrusterKeys: string[];
  leftTurnThrusterKeys: string[];
  rightTurnThrusterKeys: string[];
  vtolCount: number;
  boatPropCount: number;
  aeroPropCount: number;
  wingCount: number;
  gyroCount: number;
  pistonCount: number;
  meleeCount: number;
  rangedCount: number;
  bombBayCount: number;
  c4Count: number;
  /** Primary melee blade local vector relative to rig drive forward (+Z=1) */
  meleeLocalForwardBias: number;
  meleeLocalRightBias: number;
  driveYawRad: number;
  canDriveGround: boolean;
  canThrustSkid: boolean;
  canSwim: boolean;
  canFly: boolean;
  isDamagedAsymmetric: boolean;
  isImmobilized: boolean;
}

export interface TerrainProber {
  sampleGroundY: (wx: number, wy: number, wz: number) => number;
  isWaterAt: (wx: number, wy: number, wz: number) => boolean;
  hasLineOfSight?: (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => boolean;
  /**
   * Optional horizontal raycast against world walls/structures.
   * Returns distance in meters to the first solid hit up to maxDist, or null if clear.
   */
  raycastObstacle?: (
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ) => number | null;
}

export interface AIDecisionOutput {
  keys: Record<string, boolean>;
  throttle: number;
  steer: number;
  pitch: number;
  roll: number;
  collective: number;
  brake: boolean;
  boost: boolean;
  enableGyro: boolean;
  extendPistons: boolean;
  fireWeapons: boolean;
  triggerMeleeStrike: boolean;
  selfRightImpulse: boolean;
  detonateC4: boolean;
  aimTargetWorld: { x: number; y: number; z: number } | null;
  resolvedStyle:
    | 'MELEE'
    | 'RANGED'
    | 'RAM'
    | 'THRUSTER_SKID'
    | 'AERIAL'
    | 'MARINE'
    | 'UNSTUCK'
    | 'PATROL';
  statusLabel: string;
}

const _q = new THREE.Quaternion();
const _modQ = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _vec = new THREE.Vector3();

function isModuleIntact(mod: AIModuleLike): boolean {
  return !mod.isShotOut && (mod.health ?? 1.0) > 0;
}

function getDriveYawRad(rig: AIRigLike): number {
  const intactSeat = rig.modules.find(
    (m) => isModuleIntact(m) && isSeatModuleKind(m.kind),
  );
  let yawIdx = (intactSeat?.yawIdx || 0) & 3;
  if (!intactSeat) {
    const wheels = rig.modules.filter(
      (m) => isModuleIntact(m) && isWheelOrTireModuleKind(m.kind),
    );
    if (
      wheels.length > 0 &&
      (rig.maxVX ?? 0) - (rig.minVX ?? 0) > (rig.maxVZ ?? 0) - (rig.minVZ ?? 0)
    ) {
      let sideways = 0;
      for (const wm of wheels) {
        if (((wm.yawIdx || 0) & 1) === 1) sideways++;
      }
      if (sideways > wheels.length * 0.5) {
        yawIdx = (wheels[0].yawIdx || 1) & 3;
      }
    }
  }
  return yawIdx * (Math.PI / 2);
}

/**
 * Filters a list of scene entities down to genuine vehicles eligible for AI control.
 * Lifeless physics props (`isVoxelEntity === true`) are ALWAYS excluded.
 */
export function getEligibleAIRigs<T extends AIRigLike>(rigs: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < rigs.length; i++) {
    const r = rigs[i];
    if (!r || r.isVoxelEntity || r.inBuildMode || r.voxelCount <= 0) continue;
    out.push(r);
  }
  return out;
}

/**
 * Inspects a vehicle's intact modules & voxel hull so the AI understands
 * what kind of creation it is driving—even if damaged, lopsided, wheel-less,
 * thruster-only, or oddly built!
 */
export function analyzeVehicleCapabilities(
  rig: AIRigLike,
): VehicleCapabilityProfile {
  const driveYawRad = getDriveYawRad(rig);
  const cosD = Math.round(Math.cos(driveYawRad));
  const sinD = Math.round(Math.sin(driveYawRad));

  const comVX = rig.comLocal ? rig.comLocal.x / VOXEL_SIZE : ((rig.minVX ?? 0) + (rig.maxVX ?? 0)) * 0.5;
  const comVZ = rig.comLocal ? rig.comLocal.z / VOXEL_SIZE : ((rig.minVZ ?? 0) + (rig.maxVZ ?? 0)) * 0.5;
  const comLat = comVX * cosD - comVZ * sinD;

  let intactDriveWheels = 0;
  let intactSteerWheels = 0;
  let groundedWheels = 0;
  let leftDriveWheels = 0;
  let rightDriveWheels = 0;
  let engineCount = 0;
  let forwardThrusters = 0;
  let reverseThrusters = 0;
  let upThrusters = 0;
  let lateralThrusters = 0;
  let vtolCount = 0;
  let boatPropCount = 0;
  let aeroPropCount = 0;
  let wingCount = 0;
  let gyroCount = 0;
  let pistonCount = 0;
  let meleeCount = 0;
  let rangedCount = 0;
  let bombBayCount = 0;
  let meleeFwdSum = 0;
  let meleeRightSum = 0;

  const forwardThrusterKeys = new Set<string>();
  const reverseThrusterKeys = new Set<string>();
  const upThrusterKeys = new Set<string>();
  const leftTurnThrusterKeys = new Set<string>();
  const rightTurnThrusterKeys = new Set<string>();

  for (let i = 0; i < rig.modules.length; i++) {
    const mod = rig.modules[i];
    if (!isModuleIntact(mod)) continue;
    const k = mod.kind;

    if (isWheelOrTireModuleKind(k)) {
      intactDriveWheels++;
      if ((mod.lastCompression ?? 0) > 0.005) groundedWheels++;
      if (k === 'WHEEL_STEER' || k === 'SKI_SLIDER') intactSteerWheels++;
      const wLat = mod.vx * cosD - mod.vz * sinD - comLat;
      if (wLat >= 0.15) leftDriveWheels++;
      else if (wLat <= -0.15) rightDriveWheels++;
    } else if (
      k === 'ENGINE_BULLDAWG' ||
      k === 'V8_ENGINE' ||
      k === 'ENGINE_DRAGON'
    ) {
      engineCount++;
    } else if (
      k === 'THRUSTER' ||
      k === 'THRUSTER_MINI' ||
      k === 'THRUSTER_ROCKET' ||
      k === 'JET_RAW' ||
      k === 'JET_GIMBAL'
    ) {
      const key =
        mod.config?.posKey && mod.config.posKey !== 'NONE'
          ? mod.config.posKey
          : k === 'JET_GIMBAL'
            ? 'Space'
            : 'ShiftLeft';
      if (k === 'JET_GIMBAL') {
        upThrusters++;
        upThrusterKeys.add(key);
      } else {
        _modQ.setFromEuler(
          _euler.set(
            ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
            ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
            ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
            'YXZ',
          ),
        );
        // Thruster pushes along local +Z transformed by module orientation
        _vec.set(0, 0, 1).applyQuaternion(_modQ);
        const pushFwd = _vec.z * cosD + _vec.x * sinD;
        const pushRight = -(_vec.x * cosD - _vec.z * sinD);
        const pushUp = _vec.y;
        const offsetLat = mod.vx * cosD - mod.vz * sinD - comLat;

        if (pushFwd > 0.45) {
          forwardThrusters++;
          forwardThrusterKeys.add(key);
          // Off-center forward thrusters also induce yaw when fired alone
          if (offsetLat > 0.8) rightTurnThrusterKeys.add(key);
          else if (offsetLat < -0.8) leftTurnThrusterKeys.add(key);
        } else if (pushFwd < -0.45) {
          reverseThrusters++;
          reverseThrusterKeys.add(key);
        } else if (pushUp > 0.45) {
          upThrusters++;
          upThrusterKeys.add(key);
        } else if (Math.abs(pushRight) > 0.45) {
          lateralThrusters++;
          if (pushRight > 0) rightTurnThrusterKeys.add(key);
          else leftTurnThrusterKeys.add(key);
        }
      }
    } else if (k === 'VTOL_ROTOR') {
      vtolCount++;
    } else if (k === 'BOAT_PROP' || k === 'BOAT_OUTBOARD') {
      boatPropCount++;
    } else if (k === 'PROP_AERO') {
      aeroPropCount++;
      const key =
        mod.config?.posKey && mod.config.posKey !== 'NONE'
          ? mod.config.posKey
          : 'KeyW';
      forwardThrusterKeys.add(key);
    } else if (k === 'AERO_WING' || k === 'WING_STANDARD' || k === 'AERO_BLADE') {
      wingCount++;
    } else if (k === 'GYRO' || k === 'GYRO_REACTION') {
      gyroCount++;
    } else if (k === 'PISTON') {
      pistonCount++;
    } else if (k === 'WEAPON_MELEE') {
      meleeCount++;
      _modQ.setFromEuler(
        _euler.set(
          ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
          ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
          ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
          'YXZ',
        ),
      );
      _vec.set(0, 0, 1).applyQuaternion(_modQ);
      meleeFwdSum += _vec.z * cosD + _vec.x * sinD;
      meleeRightSum += -(_vec.x * cosD - _vec.z * sinD);
    } else if (
      k === 'PLASMA_CANNON' ||
      k === 'WEAPON_MINIGUN' ||
      k === 'WEAPON_ROCKET'
    ) {
      rangedCount++;
    } else if (k === 'WEAPON_BOMB_BAY') {
      bombBayCount++;
    }
  }

  let c4Count = 0;
  if (rig.voxelMap) {
    for (const mat of rig.voxelMap.values()) {
      if ((mat & 63) === MAT.C4_EXPLOSIVE) c4Count++;
    }
  }

  const wheelSideTotal = Math.max(1, leftDriveWheels + rightDriveWheels);
  const wheelAsymmetryBias = (leftDriveWheels - rightDriveWheels) / wheelSideTotal;
  const isDamagedAsymmetric =
    (intactDriveWheels > 0 && Math.abs(leftDriveWheels - rightDriveWheels) >= 1) ||
    (rig.structuralIntegrityPct !== undefined && rig.structuralIntegrityPct < 75);

  const canDriveGround = intactDriveWheels >= 1;
  const canThrustSkid = forwardThrusters + aeroPropCount + upThrusters + pistonCount > 0;
  const canSwim = boatPropCount > 0 || intactDriveWheels >= 4;
  const canFly = vtolCount > 0 || (wingCount >= 2 && forwardThrusters + aeroPropCount > 0);
  const isImmobilized =
    !canDriveGround && !canThrustSkid && !canSwim && !canFly;

  return {
    intactDriveWheels,
    intactSteerWheels,
    groundedWheels,
    leftDriveWheels,
    rightDriveWheels,
    wheelAsymmetryBias,
    engineCount,
    forwardThrusters,
    reverseThrusters,
    upThrusters,
    lateralThrusters,
    forwardThrusterKeys: Array.from(forwardThrusterKeys),
    reverseThrusterKeys: Array.from(reverseThrusterKeys),
    upThrusterKeys: Array.from(upThrusterKeys),
    leftTurnThrusterKeys: Array.from(leftTurnThrusterKeys),
    rightTurnThrusterKeys: Array.from(rightTurnThrusterKeys),
    vtolCount,
    boatPropCount,
    aeroPropCount,
    wingCount,
    gyroCount,
    pistonCount,
    meleeCount,
    rangedCount,
    bombBayCount,
    c4Count,
    meleeLocalForwardBias: meleeCount > 0 ? meleeFwdSum / meleeCount : 1,
    meleeLocalRightBias: meleeCount > 0 ? meleeRightSum / meleeCount : 0,
    driveYawRad,
    canDriveGround,
    canThrustSkid,
    canSwim,
    canFly,
    isDamagedAsymmetric,
    isImmobilized,
  };
}

/**
 * Determines whether two vehicles are hostile toward each other based on offline AI teams.
 * Lifeless props (`isVoxelEntity`) are never valid combat targets.
 */
export function areAITeamsHostile(
  teamA: VehicleAITeam,
  teamB: VehicleAITeam,
): boolean {
  if (teamA === 'ROGUE' || teamB === 'ROGUE') return true;
  return teamA !== teamB;
}

/**
 * Selects the nearest valid hostile vehicle target for an AI vehicle rig.
 */
export function selectHostileTarget<T extends AIRigLike>(
  self: T,
  candidates: readonly T[],
  playerRig: T | null,
): T | null {
  let bestTarget: T | null = null;
  let bestDistSq = Infinity;
  const selfTeam = self.aiConfig.team;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (
      !cand ||
      cand === self ||
      cand.isVoxelEntity ||
      cand.inBuildMode ||
      cand.voxelCount < 3
    ) {
      continue;
    }

    const candTeam: VehicleAITeam =
      cand === playerRig || cand.isSeatedByLocalPlayer
        ? 'PLAYER'
        : cand.aiConfig.enabled
          ? cand.aiConfig.team
          : 'PLAYER';

    if (!areAITeamsHostile(selfTeam, candTeam)) continue;

    const dx = cand.position.x - self.position.x;
    const dy = cand.position.y - self.position.y;
    const dz = cand.position.z - self.position.z;
    const dSq = dx * dx + dy * dy * 0.5 + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestTarget = cand;
    }
  }

  return bestTarget;
}

/**
 * Computes obstacle/terrain/water/wall avoidance steering nudge in [-1.4, +1.4],
 * emergency pre-impact braking, and forward speed limit factor [0..1] using
 * horizontal wall whisker raycasts + terrain ground probes + nearby rig repulsion.
 */
export function computeSpatialHazardAvoidance(
  rig: AIRigLike,
  fwdX: number,
  fwdZ: number,
  rightX: number,
  rightZ: number,
  prober: TerrainProber | null,
  nearbyObstacles: readonly AIRigLike[],
  targetRig: AIRigLike | null,
  caps: VehicleCapabilityProfile,
  protectedRig: AIRigLike | null = null,
): {
  steerBias: number;
  reverseDanger: boolean;
  speedFactor: number;
  emergencyBrake: boolean;
  hazardReason: string | null;
  closestFrontWallDist: number;
  leftWallBlocked: boolean;
  rightWallBlocked: boolean;
} {
  let steerBias = 0;
  let speedFactor = 1.0;
  let reverseDanger = false;
  let emergencyBrake = false;
  let hazardReason: string | null = null;
  let closestFrontWallDist = Infinity;
  let leftWallBlocked = false;
  let rightWallBlocked = false;

  const px = rig.position.x;
  const py = rig.position.y;
  const pz = rig.position.z;
  const horizSpeed = Math.hypot(rig.velocity.x, rig.velocity.z);
  const rigFwdSpeed = rig.velocity.x * fwdX + rig.velocity.z * fwdZ;
  const halfLen = Math.max(
    1.6,
    ((rig.maxVZ ?? 4) - (rig.minVZ ?? -4)) * VOXEL_SIZE * 0.55,
  );
  const halfWidth = Math.max(
    1.1,
    ((rig.maxVX ?? 2) - (rig.minVX ?? -2)) * VOXEL_SIZE * 0.45,
  );

  if (prober && !caps.canFly) {
    // Sample true ground surface under the rig so wall rays never shoot over 0.6m-2.0m barriers!
    const groundHere = prober.sampleGroundY(px, py + 2.5, pz);
    const baseGroundY =
      Number.isFinite(groundHere) && Math.abs(groundHere - py) < 4.5
        ? groundHere
        : py - 1.15;

    const checkLane = (dirX: number, dirZ: number, dist: number): number => {
      const sx = px + dirX * dist;
      const sz = pz + dirZ * dist;
      const gy = prober.sampleGroundY(sx, py + 4.0, sz);
      const inWater = prober.isWaterAt(sx, WATER_LEVEL - 0.1, sz);
      let danger = 0;
      if (inWater && !caps.canSwim) {
        danger += 1.6;
      }
      const dy = gy - baseGroundY;
      // Steep drop / abyss pit ahead
      if (dy < -3.8) {
        danger += Math.min(2.2, (-dy - 2.6) * 0.4);
      }
      // Vertical wall / cliff obstacle ahead (ground-relative so ledges/buildings are caught, but <34 deg climbable ramps are allowed)
      if (dy > 1.25) {
        const preGy = prober.sampleGroundY(
          px + dirX * Math.max(0.5, dist - 1.2),
          py + 4.0,
          pz + dirZ * Math.max(0.5, dist - 1.2),
        );
        const slope = (gy - preGy) / 1.2;
        const avgGrade = dy / Math.max(1.0, dist);
        if (slope > 0.68 || (dy > 2.4 && avgGrade > 0.52)) {
          danger += Math.min(2.4, (dy - 0.9) * 0.65);
        }
      }
      return danger;
    };

    const probeNearDist = Math.max(4.5, 4.0 + horizSpeed * 0.25);
    const probeFarDist = Math.max(9.5, 7.5 + horizSpeed * 0.52);
    const centerShort = checkLane(fwdX, fwdZ, probeNearDist);
    const centerFar = checkLane(fwdX, fwdZ, probeFarDist);

    // True left = -right, true right = +right
    const leftFwdX = fwdX * 0.84 - rightX * 0.54;
    const leftFwdZ = fwdZ * 0.84 - rightZ * 0.54;
    const rightFwdX = fwdX * 0.84 + rightX * 0.54;
    const rightFwdZ = fwdZ * 0.84 + rightZ * 0.54;

    const sideProbeDist = Math.max(7.2, 6.0 + horizSpeed * 0.35);
    let leftDanger = checkLane(leftFwdX, leftFwdZ, sideProbeDist);
    let rightDanger = checkLane(rightFwdX, rightFwdZ, sideProbeDist);
    const behindDanger = checkLane(-fwdX, -fwdZ, 4.2);

    if (behindDanger > 1.1) {
      reverseDanger = true;
    }

    // Multi-height horizontal bumper & whisker raycasts to catch short (0.6m+), thin, and tall walls
    let wallBlockingAhead = false;
    if (prober.raycastObstacle) {
      const lookAhead = Math.min(34.0, 11.5 + horizSpeed * 0.72);
      const lowRayY = Math.max(baseGroundY + 0.55, py - 0.45);
      const midRayY = Math.max(baseGroundY + 1.05, py + 0.15);
      const highRayY = Math.max(baseGroundY + 1.65, py + 0.85);

      // Returns wall hit distance beyond bumper edge, ignoring gentle driveable ramps (< ~32 deg)
      const castWallRay = (
        ox: number,
        oz: number,
        dx: number,
        dz: number,
        maxDist: number,
      ): number | null => {
        const dLow = prober.raycastObstacle!(ox, lowRayY, oz, dx, 0, dz, maxDist);
        const dMid = prober.raycastObstacle!(ox, midRayY, oz, dx, 0, dz, maxDist);
        const dHigh = prober.raycastObstacle!(ox, highRayY, oz, dx, 0, dz, maxDist);

        // Find closest hit across all 3 chassis height bands
        let firstHit: number | null = dLow;
        if (dMid !== null && (firstHit === null || dMid < firstHit)) firstHit = dMid;
        if (dHigh !== null && (firstHit === null || dHigh < firstHit)) firstHit = dHigh;
        if (firstHit === null) return null;

        // Vertical wall if mid or high ray hits nearly at the same distance as low ray (or overhanging lip)
        if (
          dLow !== null &&
          ((dMid !== null && Math.abs(dMid - dLow) < 0.85) ||
            (dHigh !== null && Math.abs(dHigh - dLow) < 1.0))
        ) {
          return firstHit;
        }
        // Overhead/mid structure overhanging ground ray
        if (dLow === null && (dMid !== null || dHigh !== null)) {
          return firstHit;
        }

        // Low barrier (0.55m..1.2m): sample closely right at/behind the hit face so thin 0.25-0.5m walls are NEVER skipped
        if (dLow !== null) {
          const preY = prober.sampleGroundY(
            ox + dx * Math.max(0.05, dLow - 0.65),
            midRayY + 2.5,
            oz + dz * Math.max(0.05, dLow - 0.65),
          );
          const s1 = prober.sampleGroundY(ox + dx * (dLow + 0.12), midRayY + 2.5, oz + dz * (dLow + 0.12));
          const s2 = prober.sampleGroundY(ox + dx * (dLow + 0.35), midRayY + 2.5, oz + dz * (dLow + 0.35));
          const s3 = prober.sampleGroundY(ox + dx * (dLow + 0.65), midRayY + 2.5, oz + dz * (dLow + 0.65));
          const peakWallY = Math.max(s1, s2, s3);
          const rise = peakWallY - preY;
          // Driveable ramps step smoothly (~0.25m over 0.7m); steep curbs/walls rise >= 0.55m abruptly
          if (rise >= 0.55) return dLow;
        }
        return null;
      };

      const startX = px + fwdX * halfLen;
      const startZ = pz + fwdZ * halfLen;
      const sideOff = Math.min(1.45, halfWidth * 0.88);

      const dCenter = castWallRay(startX, startZ, fwdX, fwdZ, lookAhead);
      const dLeftBumper = castWallRay(
        startX - rightX * sideOff,
        startZ - rightZ * sideOff,
        fwdX,
        fwdZ,
        lookAhead * 0.92,
      );
      const dRightBumper = castWallRay(
        startX + rightX * sideOff,
        startZ + rightZ * sideOff,
        fwdX,
        fwdZ,
        lookAhead * 0.92,
      );

      const whiskerLeftX = fwdX * 0.89 - rightX * 0.454; // ~27 deg left
      const whiskerLeftZ = fwdZ * 0.89 - rightZ * 0.454;
      const whiskerRightX = fwdX * 0.89 + rightX * 0.454; // ~27 deg right
      const whiskerRightZ = fwdZ * 0.89 + rightZ * 0.454;

      const dWhiskerL = castWallRay(startX, startZ, whiskerLeftX, whiskerLeftZ, lookAhead);
      const dWhiskerR = castWallRay(startX, startZ, whiskerRightX, whiskerRightZ, lookAhead);

      // Wide peripheral feelers (~50 deg) so turning corners doesn't clip side walls
      const wideLeftX = fwdX * 0.64 - rightX * 0.766;
      const wideLeftZ = fwdZ * 0.64 - rightZ * 0.766;
      const wideRightX = fwdX * 0.64 + rightX * 0.766;
      const wideRightZ = fwdZ * 0.64 + rightZ * 0.766;
      const wideMax = Math.min(12.0, lookAhead * 0.55);
      const dWideL = castWallRay(startX - rightX * sideOff, startZ - rightZ * sideOff, wideLeftX, wideLeftZ, wideMax);
      const dWideR = castWallRay(startX + rightX * sideOff, startZ + rightZ * sideOff, wideRightX, wideRightZ, wideMax);

      if (dCenter !== null) closestFrontWallDist = Math.min(closestFrontWallDist, dCenter);
      if (dLeftBumper !== null) {
        closestFrontWallDist = Math.min(closestFrontWallDist, dLeftBumper);
        leftDanger += Math.max(0.65, (lookAhead - dLeftBumper) / lookAhead) * 2.4;
        if (dLeftBumper < 14.0) leftWallBlocked = true;
      }
      if (dRightBumper !== null) {
        closestFrontWallDist = Math.min(closestFrontWallDist, dRightBumper);
        rightDanger += Math.max(0.65, (lookAhead - dRightBumper) / lookAhead) * 2.4;
        if (dRightBumper < 14.0) rightWallBlocked = true;
      }
      if (dWhiskerL !== null) {
        leftDanger += Math.max(0.45, (lookAhead - dWhiskerL) / lookAhead) * 1.9;
        if (dWhiskerL < 13.5) leftWallBlocked = true;
      }
      if (dWhiskerR !== null) {
        rightDanger += Math.max(0.45, (lookAhead - dWhiskerR) / lookAhead) * 1.9;
        if (dWhiskerR < 13.5) rightWallBlocked = true;
      }
      if (dWideL !== null) {
        leftDanger += Math.max(0.25, (wideMax - dWideL) / wideMax) * 1.25;
        if (dWideL < 8.5) leftWallBlocked = true;
      }
      if (dWideR !== null) {
        rightDanger += Math.max(0.25, (wideMax - dWideR) / wideMax) * 1.25;
        if (dWideR < 8.5) rightWallBlocked = true;
      }

      // Stopping-distance-aware speed control & emergency braking
      const brakeDist = 2.8 + (horizSpeed * horizSpeed) / 26.0 + horizSpeed * 0.22;
      if (closestFrontWallDist < lookAhead) {
        wallBlockingAhead = true;
        if (closestFrontWallDist < Math.min(8.5, Math.max(3.2, brakeDist * 0.65))) {
          emergencyBrake = true;
          speedFactor = 0;
        } else if (closestFrontWallDist < Math.max(7.5, brakeDist)) {
          speedFactor = Math.min(speedFactor, 0.12);
        } else if (closestFrontWallDist < Math.max(14.0, brakeDist * 1.45)) {
          const ratio = Math.max(
            0.22,
            (closestFrontWallDist - brakeDist * 0.5) / Math.max(4.0, lookAhead - brakeDist * 0.5),
          );
          speedFactor = Math.min(speedFactor, ratio);
        }
      }

      // Check rear wall so reversing doesn't slam straight backward
      const dBack = castWallRay(
        px - fwdX * halfLen,
        pz - fwdZ * halfLen,
        -fwdX,
        -fwdZ,
        4.2,
      );
      if (dBack !== null && dBack < 3.4) {
        reverseDanger = true;
      }
    }

    const centerDanger = Math.max(centerShort, centerFar * 0.8);
    if (
      wallBlockingAhead ||
      centerDanger > 0.6 ||
      Math.abs(leftDanger - rightDanger) > 0.4
    ) {
      // Steer toward the safer side (positive steer = Left via KeyA, negative = Right via KeyD)
      const wallUrgency = wallBlockingAhead
        ? Math.max(0.85, (18.0 - Math.min(18.0, closestFrontWallDist)) * 0.14)
        : 0;
      const steerMag = Math.min(
        1.5,
        0.65 + Math.max(centerDanger * 0.6, wallUrgency),
      );
      if (leftDanger < rightDanger) {
        steerBias += steerMag;
      } else {
        steerBias -= steerMag;
      }
      if (centerShort > 1.0) {
        speedFactor = Math.min(speedFactor, 0.35);
      }
      hazardReason = wallBlockingAhead
        ? 'DODGING WALL'
        : centerDanger > 1.0
          ? 'AVOIDING HAZARD'
          : 'DODGING TERRAIN';
    }
  }

  // Avoid slamming into non-target vehicles / allies / heavy static rigs & large barriers
  const ignoreSmallObstacles =
    rig.aiBrainMemory.mistakeTimer > 0 &&
    rig.aiBrainMemory.activeMistakeType === 'OBSTACLE_CLIP';

  for (let i = 0; i < nearbyObstacles.length; i++) {
    const ob = nearbyObstacles[i];
    if (!ob || ob === rig || ob === targetRig || ob.inBuildMode) continue;
    const isProtected = ob === protectedRig;
    const isStaticProp = Boolean((ob as any).propRigidBody?.isStatic);
    // Ignore lightweight dynamic cones/crates (mass <= 180kg) — always respect static props (ramps/arches/walls) and heavy rigs
    if (!isProtected && !isStaticProp && ob.isVoxelEntity && ob.totalMass < (ignoreSmallObstacles ? 2200 : 180)) {
      continue;
    }
    if (!isProtected && !isStaticProp && ignoreSmallObstacles && ob.totalMass < 700) continue;

    const ox = ob.position.x - px;
    const oz = ob.position.z - pz;
    const dist = Math.hypot(ox, oz);
    const dynamicBuffer = isProtected ? Math.min(10.0, horizSpeed * 0.55) : Math.min(6.0, horizSpeed * 0.35);
    const maxDist = (isProtected ? 14.0 : 10.5) + dynamicBuffer;
    if (dist < 0.25 || dist > maxDist) continue;

    const ux = ox / dist;
    const uz = oz / dist;
    const aheadDot = ux * fwdX + uz * fwdZ;
    // Check relative closing speed toward obstacle
    const relVx = rig.velocity.x - (ob.velocity?.x ?? 0);
    const relVz = rig.velocity.z - (ob.velocity?.z ?? 0);
    const closingSpeed = relVx * ux + relVz * uz;

    if (aheadDot < (isProtected ? -0.25 : 0.15)) continue;

    const sideDot = ux * rightX + uz * rightZ;
    const weight =
      ((maxDist - dist) / maxDist) *
      Math.max(0.3, aheadDot + (closingSpeed > 3.0 ? 0.35 : 0)) *
      (isProtected ? 1.85 : 1.25);
    // Positive steer = LEFT (+), Negative steer = RIGHT (-).
    // If obstacle is on RIGHT (sideDot > 0), steer LEFT (+); if on LEFT (sideDot < 0), steer RIGHT (-).
    steerBias += sideDot >= 0 ? weight : -weight;

    if (isProtected) {
      const stopThreshold = 5.6 + Math.max(0, closingSpeed) * 0.52;
      if (
        (dist < 5.6 && (aheadDot > 0.15 || closingSpeed > 0.8)) ||
        (dist < stopThreshold && aheadDot > 0.32 && closingSpeed > 2.2)
      ) {
        emergencyBrake = true;
        speedFactor = 0;
        hazardReason = 'YIELDING ALLY';
      } else if (dist < 10.5 + Math.max(0, closingSpeed) * 0.35 && aheadDot > 0.15) {
        const yieldFactor = Math.max(0.08, (dist - 5.2) / 6.5);
        speedFactor = Math.min(speedFactor, yieldFactor);
        if (rigFwdSpeed > 5.0 && dist < 8.5) {
          speedFactor = Math.min(speedFactor, 0.2);
        }
        if (!hazardReason) hazardReason = 'YIELDING ALLY';
      }
    } else if (dist < 5.2 + Math.max(0, closingSpeed) * 0.35 && aheadDot > 0.65) {
      if (dist < 3.6 && closingSpeed > 4.0) {
        emergencyBrake = true;
        speedFactor = 0;
      } else {
        speedFactor = Math.min(speedFactor, 0.35);
      }
      if (!hazardReason) hazardReason = 'DODGING RIG';
    }
  }

  return {
    steerBias: Math.max(-1.5, Math.min(1.5, steerBias)),
    reverseDanger,
    speedFactor,
    emergencyBrake,
    hazardReason,
    closestFrontWallDist,
    leftWallBlocked,
    rightWallBlocked,
  };
}

/**
 * Computes a rear-flank wingman formation target behind/beside the player so
 * Escort AIs follow cleanly without crossing the player's nose or ramming them.
 */
export function computeEscortFormationGoal(
  rig: AIRigLike,
  playerRig: AIRigLike,
): { x: number; y: number; z: number; vx: number; vz: number } {
  const pvx = playerRig.velocity.x;
  const pvz = playerRig.velocity.z;
  const pSpeed = Math.hypot(pvx, pvz);

  const pYaw = getDriveYawRad(playerRig);
  _q.set(
    playerRig.quaternion.x,
    playerRig.quaternion.y,
    playerRig.quaternion.z,
    playerRig.quaternion.w,
  );
  _vec.set(Math.sin(pYaw), 0, Math.cos(pYaw)).applyQuaternion(_q);
  const bodyLen = Math.hypot(_vec.x, _vec.z);
  let pFwdX = bodyLen > 1e-4 ? _vec.x / bodyLen : 0;
  let pFwdZ = bodyLen > 1e-4 ? _vec.z / bodyLen : 1;

  // Only align formation heading to velocity if moving forward (never flip wingman slot onto player's nose when reversing!)
  if (pSpeed > 2.2) {
    const vDotBody = (pvx / pSpeed) * pFwdX + (pvz / pSpeed) * pFwdZ;
    if (vDotBody > 0.2) {
      pFwdX = pvx / pSpeed;
      pFwdZ = pvz / pSpeed;
    }
  }
  const pRightX = -pFwdZ;
  const pRightZ = pFwdX;

  let hash = 0;
  for (let i = 0; i < rig.vehicleId.length; i++) {
    hash = (hash * 31 + rig.vehicleId.charCodeAt(i)) | 0;
  }
  const absHash = Math.abs(hash);
  const sideSign = (absHash & 1) === 0 ? 1 : -1;
  const tier = (absHash >> 1) % 3;
  const distToPlayer = Math.hypot(
    playerRig.position.x - rig.position.x,
    playerRig.position.z - rig.position.z,
  );
  const baseTrailDist = 8.5 + tier * 2.5;
  const sideScale =
    distToPlayer > 16.0 ? Math.max(0.15, 1.0 - (distToPlayer - 16.0) / 14.0) : 1.0;
  // During catchup (or when chasing a moving player), cap trailDist so slot stays ahead of the escort instead of behind it
  const trailDist =
    distToPlayer > 12.0 || pSpeed > 2.5
      ? Math.min(baseTrailDist, Math.max(5.5, distToPlayer * 0.45))
      : baseTrailDist;
  const sideOffset = sideSign * (6.5 + tier * 1.8) * sideScale;

  let slotX = playerRig.position.x - pFwdX * trailDist + pRightX * sideOffset;
  let slotZ = playerRig.position.z - pFwdZ * trailDist + pRightZ * sideOffset;

  // If straight path to formation slot cuts across the player's body, bend waypoint wide around the player
  const segX = slotX - rig.position.x;
  const segZ = slotZ - rig.position.z;
  const segLen = Math.hypot(segX, segZ);
  if (segLen > 1.0) {
    const ux = segX / segLen;
    const uz = segZ / segLen;
    const toPx = playerRig.position.x - rig.position.x;
    const toPz = playerRig.position.z - rig.position.z;
    const proj = toPx * ux + toPz * uz;
    if (proj > 0 && proj < segLen) {
      const closestX = rig.position.x + ux * proj;
      const closestZ = rig.position.z + uz * proj;
      const offX = closestX - playerRig.position.x;
      const offZ = closestZ - playerRig.position.z;
      const clearance = Math.hypot(offX, offZ);
      if (clearance < 8.0) {
        const pushLen = clearance > 0.1 ? clearance : 1.0;
        const nX = clearance > 0.1 ? offX / pushLen : pRightX * sideSign;
        const nZ = clearance > 0.1 ? offZ / pushLen : pRightZ * sideSign;
        const detour = (8.5 - clearance) + 2.0;
        slotX = closestX + nX * detour;
        slotZ = closestZ + nZ * detour;
      }
    }
  }

  return {
    x: slotX,
    y: playerRig.position.y,
    z: slotZ,
    vx: pvx,
    vz: pvz,
  };
}

/**
 * Records the target's live state and returns the delayed position/velocity from
 * `reactionDelaySec` ago (default ~300ms, 250-400ms spread) so AI reacts like a human driver.
 */
export function recordAndSampleDelayedTarget(
  mem: AIBrainMemory,
  targetId: string,
  pos: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
  reactionDelaySec: number,
): TargetHistorySample {
  if (mem.observedTargetId !== targetId) {
    mem.observedTargetId = targetId;
    mem.targetHistory.length = 0;
  }
  const hist = mem.targetHistory;
  const last = hist.length > 0 ? hist[hist.length - 1] : null;
  if (!last || mem.simTime - last.t >= 0.025) {
    hist.push({
      t: mem.simTime,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      vx: vel.x,
      vz: vel.z,
    });
  } else {
    last.x = pos.x;
    last.y = pos.y;
    last.z = pos.z;
    last.vx = vel.x;
    last.vz = vel.z;
  }

  // Prune samples older than 1.5s
  const cutoff = mem.simTime - 1.5;
  while (hist.length > 1 && hist[0].t < cutoff) {
    hist.shift();
  }

  if (hist.length === 0) {
    return { t: mem.simTime, x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vz: vel.z };
  }

  const queryTime = mem.simTime - Math.max(0, reactionDelaySec);
  if (queryTime <= hist[0].t) {
    return hist[0];
  }
  if (queryTime >= hist[hist.length - 1].t) {
    return hist[hist.length - 1];
  }

  for (let i = 0; i < hist.length - 1; i++) {
    const a = hist[i];
    const b = hist[i + 1];
    if (queryTime >= a.t && queryTime <= b.t) {
      const span = Math.max(1e-5, b.t - a.t);
      const alpha = (queryTime - a.t) / span;
      return {
        t: queryTime,
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
        z: a.z + (b.z - a.z) * alpha,
        vx: a.vx + (b.vx - a.vx) * alpha,
        vz: a.vz + (b.vz - a.vz) * alpha,
      };
    }
  }
  return hist[hist.length - 1];
}

/**
 * Detects sudden unexpected target maneuvers within the past <500ms:
 * - Velocity direction swings by > 90 degrees (sudden 180 turn / reverse)
 * - Or target slams to a sudden stop from high speed
 */
export function detectUnexpectedManeuver(
  mem: AIBrainMemory,
  curVx: number,
  curVz: number,
  windowSec = 0.5,
): boolean {
  const hist = mem.targetHistory;
  if (hist.length < 2) return false;

  const curSpeed = Math.hypot(curVx, curVz);
  const minTime = mem.simTime - windowSec;
  const maxTime = mem.simTime - 0.08;

  for (let i = hist.length - 1; i >= 0; i--) {
    const s = hist[i];
    if (s.t > maxTime) continue;
    if (s.t < minTime) break;

    const prevSpeed = Math.hypot(s.vx, s.vz);
    if (prevSpeed < 3.0) continue;

    // Sudden direction flip > 90 degrees (cos < 0)
    if (curSpeed >= 1.8) {
      const dot = (s.vx * curVx + s.vz * curVz) / (prevSpeed * curSpeed);
      if (dot < -0.05) {
        return true;
      }
    }
    // Sudden hard stop from moving speed
    if (prevSpeed >= 6.0 && curSpeed <= 1.2) {
      return true;
    }
  }
  return false;
}

/**
 * Rolls occasional human-like mistakes (~20% total rate):
 * - 8% wrong turn (10-20 deg steer bias)
 * - 5% late brake / overshoot
 * - 4% slightly off-target combat aim
 * - 3% clip small obstacle
 */
export function rollSuboptimalMistake(
  mem: AIBrainMemory,
  rng: () => number = Math.random,
  mistakeChance = PHYSICS_CONFIG.aiMistakeChance,
): AIMistakeType {
  const u = rng();
  if (u >= mistakeChance || mistakeChance <= 0) {
    mem.activeMistakeType = 'NONE';
    mem.mistakeTimer = 0;
    mem.mistakeSteerOffset = 0;
    mem.mistakeAimOffsetX = 0;
    mem.mistakeAimOffsetZ = 0;
    return 'NONE';
  }

  const rel = u / mistakeChance; // [0..1)
  const sign = rng() < 0.5 ? -1 : 1;
  if (rel < 0.4) {
    // 8% of 20% -> 10-20 degree steering error
    mem.activeMistakeType = 'WRONG_TURN';
    mem.mistakeTimer = 0.65;
    mem.mistakeSteerOffset = sign * (0.26 + rng() * 0.16);
    mem.mistakeAimOffsetX = 0;
    mem.mistakeAimOffsetZ = 0;
  } else if (rel < 0.65) {
    // 5% of 20% -> brake too late and overshoot
    mem.activeMistakeType = 'LATE_BRAKE';
    mem.mistakeTimer = 0.75;
    mem.mistakeSteerOffset = 0;
    mem.mistakeAimOffsetX = 0;
    mem.mistakeAimOffsetZ = 0;
  } else if (rel < 0.85) {
    // 4% of 20% -> aim slightly off-target and miss shots
    mem.activeMistakeType = 'OFF_AIM';
    mem.mistakeTimer = 0.9;
    mem.mistakeSteerOffset = 0;
    const missDist = 2.8 + rng() * 1.8;
    const ang = rng() * Math.PI * 2;
    mem.mistakeAimOffsetX = Math.cos(ang) * missDist;
    mem.mistakeAimOffsetZ = Math.sin(ang) * missDist;
  } else {
    // 3% of 20% -> fails to dodge a small obstacle cleanly
    mem.activeMistakeType = 'OBSTACLE_CLIP';
    mem.mistakeTimer = 0.7;
    mem.mistakeSteerOffset = 0;
    mem.mistakeAimOffsetX = 0;
    mem.mistakeAimOffsetZ = 0;
  }
  return mem.activeMistakeType;
}

/**
 * Main smart AI decision engine for a single vehicle rig.
 * Works with normal rigs, melee brawlers, turret gunners, flyers, boats, AND
 * broken/lopsided/wheel-less/seat-less creations while incorporating human-like
 * reaction lag, LOS search mode, personality variation, hesitation, and occasional mistakes.
 */
export function computeSmartVehicleAIControls(
  rig: AIRigLike,
  dt: number,
  allVehicles: readonly AIRigLike[],
  playerRig: AIRigLike | null,
  prober: TerrainProber | null,
  flareTargetPos: { x: number; y: number; z: number } | null = null,
  rng: () => number = Math.random,
): AIDecisionOutput {
  const keys: Record<string, boolean> = {};
  const mem = rig.aiBrainMemory;
  const cfg = rig.aiConfig;

  mem.simTime += Math.max(0, dt);

  if (!mem.hasInitializedPos) {
    mem.lastSampleX = rig.position.x;
    mem.lastSampleZ = rig.position.z;
    mem.hasInitializedPos = true;
  }

  // Update MIXED personality alternation every 5-10 seconds
  if (PHYSICS_CONFIG.aiPersonalityVariation) {
    if (cfg.personality === 'MIXED') {
      mem.mixedPhaseTimer -= dt;
      if (mem.mixedPhaseTimer <= 0) {
        mem.mixedPhase = mem.mixedPhase === 'AGGRESSIVE' ? 'CAUTIOUS' : 'AGGRESSIVE';
        mem.mixedPhaseTimer = 5.0 + rng() * 5.0;
      }
      cfg.effectivePersonality = mem.mixedPhase;
    } else {
      cfg.effectivePersonality = cfg.personality === 'CAUTIOUS' ? 'CAUTIOUS' : 'AGGRESSIVE';
    }
  } else {
    cfg.effectivePersonality = 'AGGRESSIVE';
  }

  const activePersonality: 'AGGRESSIVE' | 'CAUTIOUS' = cfg.effectivePersonality;
  const personalitySpeedScale = PHYSICS_CONFIG.aiPersonalityVariation
    ? activePersonality === 'AGGRESSIVE'
      ? 1.2
      : 0.8
    : 1.0;

  const caps = analyzeVehicleCapabilities(rig);

  // World-space basis vectors respecting the rig's build orientation (driveYawRad)
  // In Three.js (+Y up), local +Z forward rotated by yaw has LEFT = (+cosD, 0, -sinD) and RIGHT = (-cosD, 0, sinD)
  _q.set(rig.quaternion.x, rig.quaternion.y, rig.quaternion.z, rig.quaternion.w);
  const sinD = Math.sin(caps.driveYawRad);
  const cosD = Math.cos(caps.driveYawRad);
  _fwd.set(sinD, 0, cosD).applyQuaternion(_q);
  _right.set(-cosD, 0, sinD).applyQuaternion(_q);
  _up.set(0, 1, 0).applyQuaternion(_q);

  const flatFwdLen = Math.hypot(_fwd.x, _fwd.z) || 1;
  const fwdX = _fwd.x / flatFwdLen;
  const fwdZ = _fwd.z / flatFwdLen;
  const rightX = _right.x / (Math.hypot(_right.x, _right.z) || 1);
  const rightZ = _right.z / (Math.hypot(_right.x, _right.z) || 1);

  const horizSpeed = Math.hypot(rig.velocity.x, rig.velocity.z);
  const isFlipped = _up.y < 0.32;
  const isInWater =
    prober?.isWaterAt(rig.position.x, WATER_LEVEL - 0.15, rig.position.z) ??
    rig.position.y < WATER_LEVEL;

  // Periodic strafe sign oscillation for Gunner orbit variety
  mem.strafeFlipTimer -= dt;
  if (mem.strafeFlipTimer <= 0) {
    mem.strafeSign = mem.strafeSign >= 0 ? -1 : 1;
    mem.strafeFlipTimer = 4.0 + rng() * 2.5;
  }

  // Cooldown & imperfection timers
  if (mem.selfRightCooldown > 0) mem.selfRightCooldown = Math.max(0, mem.selfRightCooldown - dt);
  if (mem.meleeRecoverTimer > 0) mem.meleeRecoverTimer = Math.max(0, mem.meleeRecoverTimer - dt);
  if (mem.unstuckTimer > 0) mem.unstuckTimer = Math.max(0, mem.unstuckTimer - dt);
  if (mem.wallRecoverTimer > 0) mem.wallRecoverTimer = Math.max(0, mem.wallRecoverTimer - dt);
  if (mem.wallDodgeTimer > 0) mem.wallDodgeTimer = Math.max(0, mem.wallDodgeTimer - dt);
  if (mem.hesitationTimer > 0) mem.hesitationTimer = Math.max(0, mem.hesitationTimer - dt);
  if (mem.hesitationCooldown > 0) mem.hesitationCooldown = Math.max(0, mem.hesitationCooldown - dt);
  if (mem.mistakeTimer > 0) {
    mem.mistakeTimer = Math.max(0, mem.mistakeTimer - dt);
    if (mem.mistakeTimer <= 0) {
      mem.activeMistakeType = 'NONE';
      mem.mistakeSteerOffset = 0;
      mem.mistakeAimOffsetX = 0;
      mem.mistakeAimOffsetZ = 0;
    }
  }
  mem.mistakeEvalTimer -= dt;
  if (mem.mistakeEvalTimer <= 0) {
    mem.mistakeEvalTimer = 1.4 + rng() * 0.9;
    rollSuboptimalMistake(mem, rng, PHYSICS_CONFIG.aiMistakeChance);
  }

  mem.pistonCycleTimer += dt;
  mem.thrusterBurstTimer += dt;

  // Select hostile target and apply 300ms reaction delay + LOS tracking loss / search mode
  const isPlayerEscort =
    cfg.role === 'GUARD' &&
    cfg.team === 'PLAYER' &&
    playerRig !== null &&
    playerRig !== rig;
  const distToPlayer = playerRig
    ? Math.hypot(
        playerRig.position.x - rig.position.x,
        playerRig.position.z - rig.position.z,
      )
    : Infinity;

  const targetRig = selectHostileTarget(rig, allVehicles, playerRig);
  let goalX = cfg.homeX;
  let goalY = rig.position.y;
  let goalZ = cfg.homeZ;
  let goalVelX = 0;
  let goalVelZ = 0;
  let hasCombatTarget = false;
  let hasVisualLock = false;
  let isSearchMode = false;
  let isLastSeenPursuit = false;

  if (targetRig) {
    const distToEnemy = Math.hypot(
      targetRig.position.x - rig.position.x,
      targetRig.position.z - rig.position.z,
    );
    const enemyDistToPlayer = playerRig
      ? Math.hypot(
          targetRig.position.x - playerRig.position.x,
          targetRig.position.z - playerRig.position.z,
        )
      : distToEnemy;
    const inAggroRange = isPlayerEscort
      ? distToPlayer < 26.0 && enemyDistToPlayer < 38.0
      : cfg.role !== 'GUARD' || distToEnemy < 58.0;

    if (inAggroRange) {
      const losClear =
        !PHYSICS_CONFIG.aiLoseTrackLineOfSight ||
        !prober?.hasLineOfSight ||
        prober.hasLineOfSight(
          rig.position.x,
          rig.position.y + 1.4,
          rig.position.z,
          targetRig.position.x,
          targetRig.position.y + 1.4,
          targetRig.position.z,
        );

      if (losClear) {
        // Check for unexpected player/target maneuver (<500ms sudden stop or >90deg flip)
        if (
          mem.hesitationCooldown <= 0 &&
          PHYSICS_CONFIG.aiHesitationMs > 0 &&
          detectUnexpectedManeuver(mem, targetRig.velocity.x, targetRig.velocity.z, 0.5)
        ) {
          mem.hesitationTimer = PHYSICS_CONFIG.aiHesitationMs / 1000;
          mem.hesitationCooldown = 1.6;
        }

        // Record live position, then sample delayed observation (~300ms ago)
        const delayed = recordAndSampleDelayedTarget(
          mem,
          targetRig.vehicleId,
          targetRig.position,
          targetRig.velocity,
          mem.reactionDelaySec,
        );

        mem.losBlockedTimer = 0;
        mem.searchRadius = 7.0;
        mem.hasLastKnownTarget = true;
        mem.lastKnownTargetX = delayed.x;
        mem.lastKnownTargetY = delayed.y;
        mem.lastKnownTargetZ = delayed.z;
        mem.lastKnownTargetVx = delayed.vx;
        mem.lastKnownTargetVz = delayed.vz;

        hasCombatTarget = true;
        hasVisualLock = true;
        goalX = delayed.x;
        goalY = delayed.y;
        goalZ = delayed.z;
        goalVelX = delayed.vx;
        goalVelZ = delayed.vz;
      } else {
        // Line of sight blocked by terrain/hill/structure!
        mem.losBlockedTimer += dt;
        if (mem.hasLastKnownTarget && (!isPlayerEscort || distToPlayer < 22.0)) {
          hasCombatTarget = true;
          hasVisualLock = false;
          if (mem.losBlockedTimer < 2.0) {
            // Lose track for 1-2s: drive toward last known position
            isLastSeenPursuit = true;
            const coastSec = Math.min(0.45, mem.losBlockedTimer * 0.35);
            goalX = mem.lastKnownTargetX + mem.lastKnownTargetVx * coastSec;
            goalY = mem.lastKnownTargetY;
            goalZ = mem.lastKnownTargetZ + mem.lastKnownTargetVz * coastSec;
          } else {
            // Still can't see after 2s -> Search Mode (expanding circles around last known position)
            isSearchMode = true;
            mem.searchRadius = Math.min(34.0, 7.0 + (mem.losBlockedTimer - 2.0) * 3.4);
            const angularRate = 1.35 / Math.max(1.0, mem.searchRadius * 0.14);
            mem.searchAngle += mem.searchDirection * angularRate * dt;
            goalX = mem.lastKnownTargetX + Math.cos(mem.searchAngle) * mem.searchRadius;
            goalY = mem.lastKnownTargetY;
            goalZ = mem.lastKnownTargetZ + Math.sin(mem.searchAngle) * mem.searchRadius;
          }
        }
      }
    }
  } else {
    mem.losBlockedTimer = 0;
    mem.hasLastKnownTarget = false;
  }

  const isEscortingFollow = !hasCombatTarget && isPlayerEscort && playerRig !== null;
  if (!hasCombatTarget) {
    if (isEscortingFollow && playerRig) {
      const escortSlot = computeEscortFormationGoal(rig, playerRig);
      goalX = escortSlot.x;
      goalY = escortSlot.y;
      goalZ = escortSlot.z;
      goalVelX = escortSlot.vx;
      goalVelZ = escortSlot.vz;
    } else {
      const patrolAng = mem.thrusterBurstTimer * 0.35 + rig.position.x * 0.02;
      goalX = cfg.homeX + Math.cos(patrolAng) * 28.0;
      goalZ = cfg.homeZ + Math.sin(patrolAng) * 28.0;
    }
  }

  // Resolve active combat style dynamically based on role, surviving hardware, and personality!
  let style: AIDecisionOutput['resolvedStyle'] = 'RAM';
  if (!hasCombatTarget || isSearchMode || isLastSeenPursuit) {
    style =
      caps.canFly && (caps.vtolCount > 0 || !caps.canDriveGround)
        ? 'AERIAL'
        : isInWater && caps.canSwim
          ? 'MARINE'
          : !caps.canDriveGround && caps.canThrustSkid
            ? 'THRUSTER_SKID'
            : 'PATROL';
  } else if (caps.canFly && (caps.vtolCount > 0 || !caps.canDriveGround)) {
    style = 'AERIAL';
  } else if (isInWater && caps.canSwim) {
    style = 'MARINE';
  } else if (cfg.role === 'MELEE') {
    style = caps.canDriveGround || !caps.canThrustSkid ? 'MELEE' : 'THRUSTER_SKID';
  } else if (cfg.role === 'GUNNER') {
    if (caps.rangedCount > 0) {
      style = 'RANGED';
    } else if (activePersonality === 'CAUTIOUS' && caps.meleeCount === 0) {
      style = 'RANGED'; // Defensive standoff even if disarmed
    } else {
      style = caps.meleeCount > 0 ? 'MELEE' : 'RAM';
    }
  } else if (cfg.role === 'RAMMER') {
    // CAUTIOUS never intentionally rams head-on; orbits defensively instead
    if (activePersonality === 'CAUTIOUS') {
      style = 'RANGED';
    } else {
      style = caps.canDriveGround ? 'RAM' : 'THRUSTER_SKID';
    }
  } else {
    // AUTO (Smart): choose best style for surviving weapons, locomotion & personality
    if (!caps.canDriveGround && caps.canThrustSkid) {
      style = 'THRUSTER_SKID';
    } else if (activePersonality === 'CAUTIOUS') {
      style = caps.rangedCount > 0 ? 'RANGED' : caps.meleeCount > 0 ? 'MELEE' : 'RANGED';
    } else if (caps.meleeCount > 0 && caps.rangedCount === 0) {
      style = 'MELEE';
    } else if (caps.rangedCount > 0) {
      style = 'RANGED';
    } else if (caps.meleeCount > 0) {
      style = 'MELEE';
    } else {
      style = 'RAM';
    }
  }

  // Flip & Stuck Self-Recovery
  let selfRightImpulse = false;
  let extendPistons = false;
  if (isFlipped) {
    mem.flipTimer += dt;
    if (caps.pistonCount > 0 && Math.sin(mem.pistonCycleTimer * 6.0) > 0) {
      extendPistons = true;
    }
    if (mem.flipTimer > 1.8 && mem.selfRightCooldown <= 0) {
      selfRightImpulse = true;
      mem.flipTimer = 0;
      mem.selfRightCooldown = 3.5;
    }
  } else {
    mem.flipTimer = Math.max(0, mem.flipTimer - dt * 2.0);
  }

  // Compute intercept/tactical target point
  const rawDx = goalX - rig.position.x;
  const rawDz = goalZ - rig.position.z;
  const targetDist = Math.hypot(rawDx, rawDz);

  let navGoalX = goalX;
  let navGoalZ = goalZ;

  if (hasVisualLock && (style === 'MELEE' || style === 'RAM' || style === 'THRUSTER_SKID')) {
    const leadSec = Math.min(1.0, targetDist / 24.0);
    navGoalX = goalX + goalVelX * leadSec;
    navGoalZ = goalZ + goalVelZ * leadSec;
  } else if (isEscortingFollow) {
    const leadSec = Math.min(0.4, targetDist / 28.0);
    navGoalX = goalX + goalVelX * leadSec;
    navGoalZ = goalZ + goalVelZ * leadSec;
  } else if (hasVisualLock && style === 'RANGED') {
    const dirX = rawDx / Math.max(0.1, targetDist);
    const dirZ = rawDz / Math.max(0.1, targetDist);
    const tangX = -dirZ * mem.strafeSign;
    const tangZ = dirX * mem.strafeSign;
    // CAUTIOUS keeps more distance (~26m) than AGGRESSIVE (~18m)
    const desiredOrbitDist = activePersonality === 'CAUTIOUS' ? 26.0 : 18.0;
    const radialWeight = Math.max(-0.9, Math.min(0.95, (targetDist - desiredOrbitDist) / 14.0));
    navGoalX = rig.position.x + (dirX * radialWeight + tangX * 0.85) * 14.0;
    navGoalZ = rig.position.z + (dirZ * radialWeight + tangZ * 0.85) * 14.0;
  }

  const navDx = navGoalX - rig.position.x;
  const navDz = navGoalZ - rig.position.z;
  const navDist = Math.hypot(navDx, navDz) || 1;
  const toGoalX = navDx / navDist;
  const toGoalZ = navDz / navDist;

  const fwdDot = toGoalX * fwdX + toGoalZ * fwdZ;
  const rightDot = toGoalX * rightX + toGoalZ * rightZ;

  // Spatial hazard & obstacle avoidance
  const avoidance = computeSpatialHazardAvoidance(
    rig,
    fwdX,
    fwdZ,
    rightX,
    rightZ,
    prober,
    allVehicles,
    hasVisualLock ? targetRig : null,
    caps,
    isPlayerEscort ? playerRig : null,
  );

  const playerSpeed = Math.hypot(goalVelX, goalVelZ);
  const isEscortHolding =
    isEscortingFollow &&
    playerSpeed < 1.5 &&
    targetDist < 5.0 &&
    distToPlayer >= 5.2;

  // Check if stuck (skip during hesitation pause or escort station-keeping!)
  mem.progressSampleTimer += dt;
  const shouldBeMoving =
    mem.hesitationTimer <= 0 &&
    !caps.isImmobilized &&
    !isEscortHolding &&
    (hasCombatTarget || targetDist > 6.0);
  if (mem.progressSampleTimer >= 0.9) {
    const moved = Math.hypot(
      rig.position.x - mem.lastSampleX,
      rig.position.z - mem.lastSampleZ,
    );
    mem.lastSampleX = rig.position.x;
    mem.lastSampleZ = rig.position.z;
    mem.progressSampleTimer = 0;

    if (shouldBeMoving && moved < 0.75 && mem.unstuckTimer <= 0 && !isFlipped) {
      mem.stuckTimer += 0.9;
      if (mem.stuckTimer >= 1.3 && !avoidance.reverseDanger) {
        mem.unstuckTimer = 1.05;
        mem.unstuckSteerSign = rightDot >= 0 ? 1 : -1;
        mem.stuckTimer = 0;
      }
    } else {
      mem.stuckTimer = 0;
    }
  }

  // If nose-to-nose in melee with low speed, briefly back up for a fresh melee charge
  if (
    hasVisualLock &&
    (style === 'MELEE' || style === 'RAM') &&
    targetDist < 3.4 &&
    horizSpeed < 2.2 &&
    mem.meleeRecoverTimer <= 0 &&
    !avoidance.reverseDanger
  ) {
    mem.meleeRecoverTimer = 0.75;
  }

  // Learn yaw trim to compensate for asymmetric/broken wheels or thrusters
  const desiredYawSteer =
    Math.abs(rightDot) < 0.025 && fwdDot > 0
      ? 0
      : Math.max(-1, Math.min(1, -rightDot * 1.85 - (rig.angularVelocity?.y ?? 0) * 0.12));
  if (caps.isDamagedAsymmetric && fwdDot > 0.25 && horizSpeed > 2.5 && mem.unstuckTimer <= 0) {
    const yawRate = rig.angularVelocity?.y ?? 0;
    const targetYawRate = desiredYawSteer * 1.1;
    const yawErr = targetYawRate - yawRate;
    mem.yawTrim = Math.max(-0.48, Math.min(0.48, mem.yawTrim + yawErr * dt * 0.42));
  } else if (!caps.isDamagedAsymmetric) {
    mem.yawTrim *= Math.max(0, 1 - dt * 2.0);
  }
  const structuralFeedForward = caps.wheelAsymmetryBias * 0.22;

  const isLateBrakeMistake =
    !isEscortingFollow &&
    mem.mistakeTimer > 0 &&
    mem.activeMistakeType === 'LATE_BRAKE';
  const wrongTurnBias =
    !isEscortingFollow &&
    mem.mistakeTimer > 0 &&
    mem.activeMistakeType === 'WRONG_TURN'
      ? mem.mistakeSteerOffset
      : 0;

  let throttle = 0;
  let steer = 0;
  let pitch = 0;
  let roll = 0;
  let collective = 0;
  let brake = false;
  let boost = false;
  let statusLabel: string = style;

  const canSafelyBoostBase =
    !avoidance.emergencyBrake &&
    avoidance.speedFactor > 0.85 &&
    avoidance.closestFrontWallDist > 26.0 &&
    avoidance.hazardReason === null &&
    fwdDot > 0.85 &&
    horizSpeed < (activePersonality === 'AGGRESSIVE' ? 23.0 : 17.5);

  if (mem.hesitationTimer > 0 && !isEscortingFollow) {
    // Brief human-like 500ms hesitation pause after unexpected target maneuver
    throttle = 0;
    steer = Math.max(-0.5, Math.min(0.5, mem.yawTrim));
    brake = activePersonality === 'CAUTIOUS' && horizSpeed > 8.0;
    boost = false;
    statusLabel = 'HESITATING';
  } else if (mem.unstuckTimer > 0) {
    throttle = -0.95;
    steer = mem.unstuckSteerSign * 0.95;
    if (caps.pistonCount > 0 && Math.sin(mem.pistonCycleTimer * 8.0) > 0) {
      extendPistons = true;
    }
    statusLabel = 'UNSTUCK';
    style = 'UNSTUCK';
  } else if (mem.meleeRecoverTimer > 0) {
    throttle = -0.85;
    steer = rightDot >= 0 ? 0.65 : -0.65;
    statusLabel = 'MELEE WINDUP';
  } else if (style === 'AERIAL') {
    const terrainAheadY = prober
      ? prober.sampleGroundY(rig.position.x + fwdX * 14.0, rig.position.y + 18.0, rig.position.z + fwdZ * 14.0)
      : goalY;
    const desiredAlt = Math.max(goalY + 7.5, terrainAheadY + 7.0, WATER_LEVEL + 9.0);
    const altErr = desiredAlt - rig.position.y;
    collective = Math.max(-0.5, Math.min(1.0, 0.25 + altErr * 0.14));
    steer = Math.max(-1, Math.min(1, desiredYawSteer + wrongTurnBias));
    throttle = (fwdDot > 0 ? 1.0 : 0.45) * personalitySpeedScale;
    pitch = Math.max(-0.6, Math.min(0.6, -altErr * 0.04 + (fwdDot > 0.5 ? 0.2 : 0)));
    roll = Math.max(-0.5, Math.min(0.5, rightDot * 0.45));
    boost = activePersonality === 'AGGRESSIVE' && targetDist > 24 && fwdDot > 0.8 && Math.abs(steer) < 0.25 && horizSpeed < 24;
    statusLabel = isSearchMode ? 'AERIAL SEARCH' : 'AERIAL HUNT';
  } else if (style === 'THRUSTER_SKID') {
    steer = Math.max(-1, Math.min(1, desiredYawSteer + avoidance.steerBias + wrongTurnBias));
    if (avoidance.emergencyBrake && !avoidance.reverseDanger) {
      throttle = -0.75;
      brake = true;
    } else if (fwdDot > 0.4) {
      throttle = Math.min(1.0, personalitySpeedScale * avoidance.speedFactor);
      boost = activePersonality === 'AGGRESSIVE' && canSafelyBoostBase && Math.abs(steer) < 0.3;
    } else if (fwdDot < -0.55 && caps.reverseThrusters > 0) {
      throttle = -0.85;
    } else {
      throttle = 0.25 * personalitySpeedScale * avoidance.speedFactor;
      boost = activePersonality === 'AGGRESSIVE' && canSafelyBoostBase && Math.sin(mem.thrusterBurstTimer * 5.0) > 0.35;
    }
    if (caps.pistonCount > 0 && Math.sin(mem.pistonCycleTimer * 5.2) > 0.1) {
      extendPistons = true;
    }
    statusLabel = isSearchMode ? 'SEARCH SKID' : 'THRUSTER SKID';
  } else {
    let effectiveRightDot = rightDot;
    let effectiveFwdDot = fwdDot;
    if (style === 'MELEE' && caps.meleeCount > 0 && targetDist < 9.5) {
      const bx = caps.meleeLocalForwardBias;
      const bz = caps.meleeLocalRightBias;
      const bLen = Math.hypot(bx, bz) || 1;
      const nBx = bx / bLen;
      const nBz = bz / bLen;
      effectiveFwdDot = fwdDot * nBx + rightDot * nBz;
      effectiveRightDot = rightDot * nBx - fwdDot * nBz;
    }

    const baseSteer =
      Math.abs(effectiveRightDot) < 0.025 && effectiveFwdDot > 0
        ? 0
        : Math.max(
            -1,
            Math.min(1, -effectiveRightDot * 1.9 - (rig.angularVelocity?.y ?? 0) * 0.12),
          );

    // Clamp target-seeking baseSteer away from any side blocked by a nearby wall, and commit to wall dodge arcs briefly
    if (avoidance.hazardReason === 'DODGING WALL' && Math.abs(avoidance.steerBias) > 0.4) {
      const dodgeSign = avoidance.steerBias > 0 ? 1 : -1;
      if (mem.wallDodgeTimer <= 0 || mem.wallDodgeSign === dodgeSign) {
        mem.wallDodgeSign = dodgeSign;
        mem.wallDodgeTimer = 0.65;
      }
    }
    let safeBaseSteer = baseSteer;
    if (avoidance.leftWallBlocked && safeBaseSteer > 0) safeBaseSteer = 0;
    if (avoidance.rightWallBlocked && safeBaseSteer < 0) safeBaseSteer = 0;
    if (mem.wallDodgeTimer > 0) {
      if ((mem.wallDodgeSign > 0 && avoidance.leftWallBlocked) || (mem.wallDodgeSign < 0 && avoidance.rightWallBlocked)) {
        // Obstacle shifted onto dodge side, allow avoidance steerBias to re-route
      } else if (safeBaseSteer * mem.wallDodgeSign < 0) {
        safeBaseSteer = 0;
      }
    }

    const wallCommitBias =
      mem.wallDodgeTimer > 0 && Math.abs(avoidance.steerBias) < 0.35
        ? mem.wallDodgeSign * 0.65
        : 0;

    steer = Math.max(
      -1,
      Math.min(
        1,
        safeBaseSteer + avoidance.steerBias + wallCommitBias + mem.yawTrim + structuralFeedForward + wrongTurnBias,
      ),
    );

    const rigFwdSpeed = rig.velocity.x * fwdX + rig.velocity.z * fwdZ;
    const isAvoidingWallOrObstacle =
      avoidance.closestFrontWallDist < 24.0 || avoidance.hazardReason !== null || mem.wallDodgeTimer > 0;

    if (avoidance.reverseDanger && mem.wallRecoverTimer > 0) {
      mem.wallRecoverTimer = 0;
    }

    if (
      avoidance.emergencyBrake &&
      avoidance.closestFrontWallDist < 5.0 &&
      !avoidance.reverseDanger &&
      rigFwdSpeed < 1.5 &&
      mem.wallRecoverTimer <= 0
    ) {
      mem.wallRecoverTimer = 0.72;
      mem.wallRecoverSteer = avoidance.steerBias >= 0 ? -0.95 : 0.95;
    }

    if (mem.wallRecoverTimer > 0 && !avoidance.reverseDanger) {
      throttle = -0.85;
      brake = false;
      steer = mem.wallRecoverSteer;
      statusLabel = 'DODGING WALL';
    } else if (avoidance.emergencyBrake) {
      // Stop immediately and turn AWAY from wall/player.
      // If still moving forward (>1.2 m/s), positive steerBias means turn LEFT (+); if reversing, flip wheel steer so rear swings away.
      if (rigFwdSpeed > 1.2) {
        throttle = 0;
        brake = true;
        steer = avoidance.steerBias >= 0 ? 1.0 : -1.0;
      } else if (!avoidance.reverseDanger) {
        throttle = -0.85;
        brake = false;
        steer = avoidance.steerBias >= 0 ? -0.9 : 0.9;
      } else {
        throttle = 0;
        brake = true;
      }
    } else if (isEscortingFollow) {
      const turnTightness = Math.abs(steer);
      const cornerThrottle =
        turnTightness > 0.72 && horizSpeed > 10.0 ? 0.55 : 1.0;
      const closingOnPlayer =
        playerRig && distToPlayer > 0.1
          ? ((rig.velocity.x - playerRig.velocity.x) * (playerRig.position.x - rig.position.x) +
              (rig.velocity.z - playerRig.velocity.z) * (playerRig.position.z - rig.position.z)) /
            distToPlayer
          : 0;

      if (isEscortHolding || (playerSpeed < 1.5 && distToPlayer < 9.5 && targetDist < 6.0)) {
        throttle = 0;
        steer = 0;
        brake = horizSpeed > 0.8;
        statusLabel = 'ESCORT HOLD';
      } else if (effectiveFwdDot < -0.42 && targetDist < 13.0 && !avoidance.reverseDanger) {
        throttle = -0.78;
        // Negate ONLY baseSteer when reversing so avoidance.steerBias keeps pushing away from obstacles
        steer = Math.max(-1, Math.min(1, -baseSteer + avoidance.steerBias));
        statusLabel = 'ESCORT ALIGN';
      } else if (distToPlayer < 8.0 && closingOnPlayer > 2.0) {
        // Predictive braking so Escort never slams into the player's bumper or flanks
        throttle = rigFwdSpeed > 2.5 ? -0.35 : 0;
        brake = true;
        statusLabel = 'YIELDING ALLY';
      } else if (targetDist > 16.0 || distToPlayer > 22.0) {
        const catchupCap =
          distToPlayer < 16.0 && closingOnPlayer > 4.0 ? 0.35 : 1.0;
        throttle =
          Math.max(1.0, personalitySpeedScale) *
          cornerThrottle *
          avoidance.speedFactor *
          catchupCap;
        // Only engage boost during Escort when far behind, clear of walls, straight, and not closing dangerously on player
        if (
          canSafelyBoostBase &&
          Math.abs(steer) < 0.2 &&
          distToPlayer > 34.0 &&
          targetDist > 28.0 &&
          closingOnPlayer < 14.0
        ) {
          boost = true;
        }
        statusLabel = 'ESCORT CATCHUP';
      } else {
        const desiredSpeed = Math.max(
          0,
          playerSpeed + Math.max(-3.0, Math.min(7.0, (targetDist - 2.5) * 0.65)),
        );
        const speedErr = desiredSpeed - rigFwdSpeed;
        if (distToPlayer < 6.8 && rigFwdSpeed > playerSpeed + 1.0) {
          throttle = -0.35;
          brake = true;
        } else if (speedErr < -2.8) {
          throttle = Math.max(-0.35, speedErr * 0.08);
          brake = rigFwdSpeed > desiredSpeed + 3.0;
        } else {
          throttle =
            Math.max(0, Math.min(1.0, 0.2 + speedErr * 0.15)) *
            cornerThrottle *
            avoidance.speedFactor;
        }
        statusLabel = 'ESCORTING';
      }
    } else if (!hasCombatTarget && targetDist < 5.0) {
      throttle = 0;
      brake = !isLateBrakeMistake;
      statusLabel = cfg.role === 'GUARD' ? 'GUARDING' : 'PATROL';
    } else if (
      activePersonality === 'CAUTIOUS' &&
      hasVisualLock &&
      targetDist < 9.5 &&
      style !== 'MELEE' &&
      !avoidance.reverseDanger
    ) {
      // Defensive CAUTIOUS AI refuses to ram — backs off to maintain safe spacing
      throttle = -0.75;
      steer = Math.max(-1, Math.min(1, -baseSteer + avoidance.steerBias));
      statusLabel = 'DEFENSIVE EVADE';
    } else if (effectiveFwdDot < -0.45 && targetDist < 14.0 && !avoidance.reverseDanger) {
      throttle = -0.82;
      steer = Math.max(-1, Math.min(1, -baseSteer + avoidance.steerBias));
    } else {
      const turnTightness = Math.abs(steer);
      const cautiousSlow = activePersonality === 'CAUTIOUS' && turnTightness > 0.55 && horizSpeed > 8.5;
      const cornerThrottle =
        !isLateBrakeMistake && (cautiousSlow || (turnTightness > 0.72 && horizSpeed > 10.5))
          ? 0.52
          : 1.0;
      const wallCappedSpeedFactor = isAvoidingWallOrObstacle
        ? Math.min(avoidance.speedFactor, mem.wallDodgeTimer > 0 ? 0.68 : 1.0)
        : activePersonality === 'AGGRESSIVE'
          ? Math.min(1.0, avoidance.speedFactor + 0.12)
          : avoidance.speedFactor;
      const safeFactor = isLateBrakeMistake ? 1.0 : wallCappedSpeedFactor;
      throttle = cornerThrottle * safeFactor * personalitySpeedScale;

      // Active stopping-distance speed control when approaching a wall so vehicle decelerates BEFORE impact
      if (!isLateBrakeMistake && avoidance.closestFrontWallDist < 22.0) {
        const safeApproachSpeed = Math.max(3.2, (avoidance.closestFrontWallDist - 3.6) * 0.68);
        if (rigFwdSpeed > safeApproachSpeed + 1.2) {
          throttle = 0;
          brake = true;
        } else if (rigFwdSpeed > safeApproachSpeed) {
          throttle = Math.min(throttle, 0.18);
        }
      }
      if (isAvoidingWallOrObstacle && avoidance.speedFactor < 0.35 && horizSpeed > 8.0) {
        brake = true;
      }
      if (isLateBrakeMistake && turnTightness > 0.65) {
        statusLabel = 'OVERSHOOTING';
      }
    }

    // Aggressive personality boosts ONLY on clear straight open runways (never into walls or tight turns!)
    if (
      !isEscortingFollow &&
      activePersonality === 'AGGRESSIVE' &&
      canSafelyBoostBase &&
      Math.abs(steer) < 0.24 &&
      (targetDist > 18 || (style === 'MELEE' && targetDist < 13 && targetDist > 5) || style === 'RAM')
    ) {
      boost = true;
    }

    if (style === 'MELEE' && targetDist < 5.5 && caps.pistonCount > 0) {
      extendPistons = true;
    }

    if (avoidance.hazardReason) {
      statusLabel = avoidance.hazardReason;
    } else if (mem.wallRecoverTimer > 0) {
      statusLabel = 'DODGING WALL';
    } else if (isEscortingFollow) {
      // keep ESCORT HOLD / ESCORT ALIGN / ESCORT CATCHUP / ESCORTING label
    } else if (isSearchMode) {
      statusLabel = 'SEARCHING';
    } else if (isLastSeenPursuit) {
      statusLabel = 'LAST SEEN';
    } else if (style === 'MELEE') {
      statusLabel = targetDist < 9.0 ? 'MELEE STRIKE' : 'CLOSING MELEE';
    } else if (style === 'RANGED') {
      statusLabel = activePersonality === 'CAUTIOUS' ? 'DEFENSIVE FIRE' : 'ORBIT FIRE';
    } else if (style === 'RAM') {
      statusLabel = boost ? 'BOOST RAM' : 'HUNTING';
    }
  }

  // Translate analog decisions into virtual `keys` so ALL custom-key modules work!
  if (throttle > 0.25) keys['KeyW'] = true;
  if (throttle < -0.25) keys['KeyS'] = true;
  if (steer > 0.22) keys['KeyA'] = true;
  if (steer < -0.22) keys['KeyD'] = true;
  if (brake) keys['Space'] = true;
  if (collective > 0.25) keys['Space'] = true;
  if (collective < -0.25) keys['ControlLeft'] = true;

  if (boost) {
    keys['ShiftLeft'] = true;
    for (let i = 0; i < caps.forwardThrusterKeys.length; i++) {
      keys[caps.forwardThrusterKeys[i]] = true;
    }
  }
  if (isFlipped || (style === 'THRUSTER_SKID' && throttle > 0.2)) {
    for (let i = 0; i < caps.upThrusterKeys.length; i++) {
      keys[caps.upThrusterKeys[i]] = true;
    }
  }
  if (throttle < -0.3) {
    for (let i = 0; i < caps.reverseThrusterKeys.length; i++) {
      keys[caps.reverseThrusterKeys[i]] = true;
    }
  }
  if (steer > 0.35) {
    for (let i = 0; i < caps.leftTurnThrusterKeys.length; i++) {
      keys[caps.leftTurnThrusterKeys[i]] = true;
    }
  } else if (steer < -0.35) {
    for (let i = 0; i < caps.rightTurnThrusterKeys.length; i++) {
      keys[caps.rightTurnThrusterKeys[i]] = true;
    }
  }

  // Turret aiming & firing logic (only with clear visual lock or active flare, never blind through hills, paused during hesitation)
  let aimTargetWorld: { x: number; y: number; z: number } | null = null;
  let fireWeapons = false;
  if (
    mem.hesitationTimer <= 0 &&
    hasVisualLock &&
    targetRig &&
    caps.rangedCount + caps.bombBayCount > 0
  ) {
    const aimSrcX = flareTargetPos ? flareTargetPos.x : goalX;
    const aimSrcY = flareTargetPos ? flareTargetPos.y : goalY;
    const aimSrcZ = flareTargetPos ? flareTargetPos.z : goalZ;
    const tFlight = flareTargetPos ? 0 : Math.min(0.8, targetDist / 65.0);
    const isOffAimMistake =
      mem.mistakeTimer > 0 && mem.activeMistakeType === 'OFF_AIM';
    aimTargetWorld = {
      x:
        aimSrcX +
        (flareTargetPos ? 0 : goalVelX * tFlight) +
        (isOffAimMistake ? mem.mistakeAimOffsetX : 0),
      y: aimSrcY + 0.7 + (isOffAimMistake ? 0.5 : 0),
      z:
        aimSrcZ +
        (flareTargetPos ? 0 : goalVelZ * tFlight) +
        (isOffAimMistake ? mem.mistakeAimOffsetZ : 0),
    };
    const inFireRange = targetDist < 58.0;
    let allyInLineOfFire = false;
    if (inFireRange) {
      const rayX = aimTargetWorld.x - rig.position.x;
      const rayZ = aimTargetWorld.z - rig.position.z;
      const rayLen = Math.hypot(rayX, rayZ) || 1;
      const uRayX = rayX / rayLen;
      const uRayZ = rayZ / rayLen;
      for (let i = 0; i < allVehicles.length; i++) {
        const ally = allVehicles[i];
        if (!ally || ally === rig || ally === targetRig || ally.isVoxelEntity || ally.inBuildMode) continue;
        const allyTeam: VehicleAITeam =
          ally === playerRig || ally.isSeatedByLocalPlayer
            ? 'PLAYER'
            : ally.aiConfig.enabled
              ? ally.aiConfig.team
              : 'PLAYER';
        if (areAITeamsHostile(cfg.team, allyTeam)) continue;
        const ax = ally.position.x - rig.position.x;
        const az = ally.position.z - rig.position.z;
        const proj = ax * uRayX + az * uRayZ;
        if (proj > 0.5 && proj < rayLen + 2.0) {
          const perp = Math.abs(uRayX * az - uRayZ * ax);
          if (perp < 3.8) {
            allyInLineOfFire = true;
            break;
          }
        }
      }
    }
    if (
      inFireRange &&
      !allyInLineOfFire &&
      (style === 'RANGED' || style === 'AERIAL' || fwdDot > 0.35 || caps.rangedCount > 0)
    ) {
      fireWeapons = true;
      keys['KeyF'] = true;
    }
  }

  const triggerMeleeStrike =
    mem.hesitationTimer <= 0 &&
    hasVisualLock &&
    caps.meleeCount > 0 &&
    targetDist < 7.5;

  const detonateC4 =
    mem.hesitationTimer <= 0 &&
    hasVisualLock &&
    caps.c4Count > 0 &&
    targetDist < 3.8 &&
    (caps.isImmobilized || (rig.structuralIntegrityPct ?? 100) < 28);

  return {
    keys,
    throttle,
    steer,
    pitch,
    roll,
    collective,
    brake,
    boost,
    enableGyro: caps.gyroCount > 0,
    extendPistons,
    fireWeapons,
    triggerMeleeStrike,
    selfRightImpulse,
    detonateC4,
    aimTargetWorld,
    resolvedStyle: style,
    statusLabel,
  };
}
