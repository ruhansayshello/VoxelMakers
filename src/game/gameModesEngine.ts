import {
  WATER_LEVEL,
  MAT,
  type ModuleKind,
  type SerializedVehicleBlueprint,
} from './constants';
import type { CheckpointGateState } from './modRegistry';

// ============================================================================
// 1. FAST-TRAVEL TELEPORT NODES SYSTEM (Cap 5-10 Beacons, 1s Spinup, Combat Lock)
// ============================================================================

export const MAX_TELEPORT_NODES = 8; // Capped between 5 and 10 beacons per world
export const TELEPORT_SPINUP_DURATION_SEC = 1.0; // 1 second engine spinup after first free teleport
export const COMBAT_TELEPORT_COOLDOWN_MS = 5000; // 5 seconds combat lock after taking damage
export const TELEPORT_MOVE_CANCEL_DIST_METERS = 0.65; // Cancel spinup if player moves > 0.65m

export interface TeleportNode {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  color: string;
  createdAt: number;
  isPresetLandmark?: boolean;
}

export interface TeleportSpinupState {
  targetNodeId: string;
  targetNodeName: string;
  remainingSec: number;
  totalSec: number;
  originPos: { x: number; y: number; z: number };
}

export interface TeleportSystemState {
  nodes: TeleportNode[];
  maxNodes: number;
  hasUsedFreeTeleport: boolean;
  lastDamageTakenAtMs: number | null;
  activeSpinup: TeleportSpinupState | null;
  statusMessage: string;
}

export const DEFAULT_STARTER_TELEPORT_NODES: TeleportNode[] = [
  {
    id: 'node_stunt_park_hub',
    name: 'Stunt Park Launchpad',
    x: 0,
    y: WATER_LEVEL + 1.8,
    z: 0,
    color: '#facc15',
    createdAt: 1,
    isPresetLandmark: true,
  },
  {
    id: 'node_west_shredder_gauntlet',
    name: 'West Shredder Gauntlet',
    x: -11.5,
    y: WATER_LEVEL + 1.8,
    z: 10,
    color: '#f97316',
    createdAt: 2,
    isPresetLandmark: true,
  },
  {
    id: 'node_north_loop_arena',
    name: 'North Mega Ramp & Loop',
    x: 0,
    y: WATER_LEVEL + 1.8,
    z: 58,
    color: '#38bdf8',
    createdAt: 3,
    isPresetLandmark: true,
  },
  {
    id: 'node_east_base_plateau',
    name: 'East Base-Build Plateau',
    x: 48,
    y: WATER_LEVEL + 2.2,
    z: 18,
    color: '#4ade80',
    createdAt: 4,
    isPresetLandmark: true,
  },
  {
    id: 'node_west_marina_slipway',
    name: 'West Marina Boat Slipway',
    x: -23,
    y: WATER_LEVEL + 1.8,
    z: 0,
    color: '#2dd4bf',
    createdAt: 5,
    isPresetLandmark: true,
  },
];

export function createInitialTeleportState(
  initialNodes: TeleportNode[] = DEFAULT_STARTER_TELEPORT_NODES,
): TeleportSystemState {
  return {
    nodes: initialNodes.slice(0, MAX_TELEPORT_NODES).map((n) => ({ ...n })),
    maxNodes: MAX_TELEPORT_NODES,
    hasUsedFreeTeleport: false,
    lastDamageTakenAtMs: null,
    activeSpinup: null,
    statusMessage: 'First teleport is FREE (instant). Subsequent jumps take 1.0s engine spinup.',
  };
}

export function canPlaceTeleportNode(state: TeleportSystemState): {
  allowed: boolean;
  reason?: string;
} {
  if (state.nodes.length >= state.maxNodes) {
    return {
      allowed: false,
      reason: `Beacon cap reached (${state.maxNodes}/${state.maxNodes} max). Remove a node first!`,
    };
  }
  return { allowed: true };
}

export function addTeleportNode(
  state: TeleportSystemState,
  partial: {
    name: string;
    x: number;
    y: number;
    z: number;
    color?: string;
    isPresetLandmark?: boolean;
  },
  nowMs = Date.now(),
): {
  state: TeleportSystemState;
  added: TeleportNode | null;
  error?: string;
} {
  const check = canPlaceTeleportNode(state);
  if (!check.allowed) {
    return {
      state: {
        ...state,
        statusMessage: check.reason || 'Cannot place more Teleport Nodes.',
      },
      added: null,
      error: check.reason,
    };
  }

  const cleanName =
    partial.name.trim() || `Beacon #${state.nodes.length + 1}`;
  const added: TeleportNode = {
    id: `tp_node_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    x: Math.round(partial.x * 10) / 10,
    y: Math.round(partial.y * 10) / 10,
    z: Math.round(partial.z * 10) / 10,
    color: partial.color || '#38bdf8',
    createdAt: nowMs,
    isPresetLandmark: partial.isPresetLandmark ?? false,
  };

  const nextState: TeleportSystemState = {
    ...state,
    nodes: [...state.nodes, added],
    statusMessage: `Placed Teleport Beacon "${added.name}" (${state.nodes.length + 1}/${state.maxNodes}).`,
  };
  return { state: nextState, added };
}

export function removeTeleportNode(
  state: TeleportSystemState,
  nodeId: string,
): TeleportSystemState {
  const target = state.nodes.find((n) => n.id === nodeId);
  const nextNodes = state.nodes.filter((n) => n.id !== nodeId);
  const nextSpinup =
    state.activeSpinup?.targetNodeId === nodeId ? null : state.activeSpinup;
  return {
    ...state,
    nodes: nextNodes,
    activeSpinup: nextSpinup,
    statusMessage: target
      ? `Removed Beacon "${target.name}" (${nextNodes.length}/${state.maxNodes}).`
      : state.statusMessage,
  };
}

export function recordCombatDamage(
  state: TeleportSystemState,
  nowMs = Date.now(),
): TeleportSystemState {
  const cancelledSpinup = state.activeSpinup !== null;
  return {
    ...state,
    lastDamageTakenAtMs: nowMs,
    activeSpinup: null,
    statusMessage: cancelledSpinup
      ? '⚠️ Teleport Spinup Interrupted by Combat Damage!'
      : state.statusMessage,
  };
}

export function getCombatCooldownRemainingSec(
  state: TeleportSystemState,
  nowMs = Date.now(),
): number {
  if (state.lastDamageTakenAtMs === null) return 0;
  const elapsed = nowMs - state.lastDamageTakenAtMs;
  if (elapsed >= COMBAT_TELEPORT_COOLDOWN_MS) return 0;
  return Math.max(0, (COMBAT_TELEPORT_COOLDOWN_MS - elapsed) / 1000);
}

export function initiateTeleportToNode(
  state: TeleportSystemState,
  nodeId: string,
  currentPos: { x: number; y: number; z: number },
  nowMs = Date.now(),
): {
  state: TeleportSystemState;
  teleportedImmediately: boolean;
  targetNode: TeleportNode | null;
  error?: string;
} {
  const targetNode = state.nodes.find((n) => n.id === nodeId) || null;
  if (!targetNode) {
    return {
      state: { ...state, statusMessage: 'Teleport Node not found.' },
      teleportedImmediately: false,
      targetNode: null,
      error: 'Teleport Node not found.',
    };
  }

  const combatRemaining = getCombatCooldownRemainingSec(state, nowMs);
  if (combatRemaining > 0) {
    const msg = `⚠️ COMBAT LOCK: Cannot fast-travel within 5s of taking damage (${combatRemaining.toFixed(1)}s left)!`;
    return {
      state: {
        ...state,
        activeSpinup: null,
        statusMessage: msg,
      },
      teleportedImmediately: false,
      targetNode: null,
      error: msg,
    };
  }

  // First time is FREE (instant jump)!
  if (!state.hasUsedFreeTeleport) {
    return {
      state: {
        ...state,
        hasUsedFreeTeleport: true,
        activeSpinup: null,
        statusMessage: `⚡ Free Instant Teleport to "${targetNode.name}" complete! Next teleports require 1.0s engine spinup.`,
      },
      teleportedImmediately: true,
      targetNode,
    };
  }

  // Subsequent teleports require 1.0s of "Engine Spinup" (cancellable by moving)
  return {
    state: {
      ...state,
      activeSpinup: {
        targetNodeId: targetNode.id,
        targetNodeName: targetNode.name,
        remainingSec: TELEPORT_SPINUP_DURATION_SEC,
        totalSec: TELEPORT_SPINUP_DURATION_SEC,
        originPos: {
          x: currentPos.x,
          y: currentPos.y,
          z: currentPos.z,
        },
      },
      statusMessage: `⚡ Spinning up teleport drive to "${targetNode.name}" (1.0s)... Move to cancel.`,
    },
    teleportedImmediately: false,
    targetNode,
  };
}

export function stepTeleportSpinup(
  state: TeleportSystemState,
  dtSec: number,
  currentPos: { x: number; y: number; z: number },
  isMovingInput: boolean,
  nowMs = Date.now(),
): {
  state: TeleportSystemState;
  completedNode: TeleportNode | null;
  cancelled: boolean;
  cancelReason?: string;
} {
  if (!state.activeSpinup) {
    return { state, completedNode: null, cancelled: false };
  }

  const combatRem = getCombatCooldownRemainingSec(state, nowMs);
  if (combatRem > 0) {
    const reason = '⚠️ Teleport Cancelled: Took combat damage!';
    return {
      state: {
        ...state,
        activeSpinup: null,
        statusMessage: reason,
      },
      completedNode: null,
      cancelled: true,
      cancelReason: reason,
    };
  }

  const dx = currentPos.x - state.activeSpinup.originPos.x;
  const dy = currentPos.y - state.activeSpinup.originPos.y;
  const dz = currentPos.z - state.activeSpinup.originPos.z;
  const movedDist = Math.hypot(dx, dy, dz);

  if (isMovingInput || movedDist > TELEPORT_MOVE_CANCEL_DIST_METERS) {
    const reason = 'Teleport Spinup Cancelled (Moved during spinup).';
    return {
      state: {
        ...state,
        activeSpinup: null,
        statusMessage: reason,
      },
      completedNode: null,
      cancelled: true,
      cancelReason: reason,
    };
  }

  const nextRem = state.activeSpinup.remainingSec - dtSec;
  if (nextRem <= 0) {
    const targetNode =
      state.nodes.find((n) => n.id === state.activeSpinup!.targetNodeId) || null;
    return {
      state: {
        ...state,
        activeSpinup: null,
        statusMessage: targetNode
          ? `⚡ Teleported to "${targetNode.name}"!`
          : 'Teleport complete.',
      },
      completedNode: targetNode,
      cancelled: false,
    };
  }

  return {
    state: {
      ...state,
      activeSpinup: {
        ...state.activeSpinup,
        remainingSec: nextRem,
      },
    },
    completedNode: null,
    cancelled: false,
  };
}

// ============================================================================
// 2. "LAST BUILD" RECOVERY (Auto-Save & Restore Prompt on Crash / Reload)
// ============================================================================

export const STORAGE_KEY_LAST_BUILD_AUTOSAVE =
  'voxelmakers_last_build_autosave_v1';

export interface LastBuildAutoSavePayload {
  version: 1;
  savedAtIso: string;
  savedAtLabel: string;
  blueprint: SerializedVehicleBlueprint;
  wasModifiedInSession: boolean;
}

export function saveLastBuildAutoSave(
  blueprint: SerializedVehicleBlueprint,
  storage?: Pick<Storage, 'setItem'>,
): LastBuildAutoSavePayload | null {
  if (
    !blueprint ||
    (!Array.isArray(blueprint.voxels) && !Array.isArray(blueprint.modules))
  ) {
    return null;
  }
  const totalBlocks =
    (blueprint.voxels?.length || 0) + (blueprint.modules?.length || 0);
  if (totalBlocks === 0) return null;

  const now = new Date();
  const payload: LastBuildAutoSavePayload = {
    version: 1,
    savedAtIso: now.toISOString(),
    savedAtLabel: now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
    blueprint,
    wasModifiedInSession: true,
  };

  try {
    const targetStorage =
      storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    targetStorage?.setItem(
      STORAGE_KEY_LAST_BUILD_AUTOSAVE,
      JSON.stringify(payload),
    );
  } catch {
    // Ignore storage quota errors
  }
  return payload;
}

export function loadLastBuildAutoSave(
  storage?: Pick<Storage, 'getItem'>,
): LastBuildAutoSavePayload | null {
  try {
    const targetStorage =
      storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = targetStorage?.getItem(STORAGE_KEY_LAST_BUILD_AUTOSAVE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastBuildAutoSavePayload>;
    if (
      !parsed ||
      !parsed.blueprint ||
      !Array.isArray(parsed.blueprint.voxels) ||
      !Array.isArray(parsed.blueprint.modules)
    ) {
      return null;
    }
    const blockCount =
      parsed.blueprint.voxels.length + parsed.blueprint.modules.length;
    if (blockCount <= 0) return null;
    return {
      version: 1,
      savedAtIso: parsed.savedAtIso || new Date().toISOString(),
      savedAtLabel: parsed.savedAtLabel || 'Recent Session',
      blueprint: parsed.blueprint,
      wasModifiedInSession: Boolean(parsed.wasModifiedInSession ?? true),
    };
  } catch {
    return null;
  }
}

export function clearLastBuildAutoSave(
  storage?: Pick<Storage, 'removeItem'>,
): void {
  try {
    const targetStorage =
      storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    targetStorage?.removeItem(STORAGE_KEY_LAST_BUILD_AUTOSAVE);
  } catch {
    // Ignore errors
  }
}

export function shouldPromptRestoreLastBuild(
  payload: LastBuildAutoSavePayload | null,
): boolean {
  if (!payload || !payload.wasModifiedInSession) return false;
  const totalBlocks =
    (payload.blueprint.voxels?.length || 0) +
    (payload.blueprint.modules?.length || 0);
  return totalBlocks > 0;
}

// ============================================================================
// 3. SIX GAME MODES ENGINE (Time Trial, Destruction Derby, Building Challenge,
//    Capture the Flag, Build Battle, Survival Waves)
// ============================================================================

export const STORAGE_KEY_TIMETRIAL_BEST = 'voxelmakers_timetrial_best_v1';
export const STORAGE_KEY_DERBY_BEST = 'voxelmakers_derby_best_v1';
export const STORAGE_KEY_SURVIVAL_BEST_WAVE = 'voxelmakers_survival_best_v1';

/**
 * 1. TIME TRIAL (SOLO): 5 Checkpoints in a row from Start Line to Finish Line!
 */
export const TIME_TRIAL_5_CHECKPOINTS: CheckpointGateState[] = [
  {
    index: 0,
    x: 0,
    y: WATER_LEVEL + 2.4,
    z: 16,
    radius: 5.8,
    label: 'CHECKPOINT 1 · START LINE LAUNCH',
  },
  {
    index: 1,
    x: 0,
    y: WATER_LEVEL + 5.0,
    z: 46,
    radius: 6.2,
    label: 'CHECKPOINT 2 · MEGA RAMP CREST',
  },
  {
    index: 2,
    x: 28,
    y: WATER_LEVEL + 2.4,
    z: 56,
    radius: 6.0,
    label: 'CHECKPOINT 3 · NORTH HAIRPIN',
  },
  {
    index: 3,
    x: 36,
    y: WATER_LEVEL + 2.4,
    z: 10,
    radius: 6.0,
    label: 'CHECKPOINT 4 · EAST STRAIGHTAWAY',
  },
  {
    index: 4,
    x: 0,
    y: WATER_LEVEL + 2.4,
    z: -12,
    radius: 6.2,
    label: 'CHECKPOINT 5 · FINISH LINE ARCH',
  },
];

export function loadStoredBestTimeTrialSec(
  storage?: Pick<Storage, 'getItem'>,
): number | null {
  try {
    const s =
      storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = s?.getItem(STORAGE_KEY_TIMETRIAL_BEST);
    if (!raw) return null;
    const val = Number(raw);
    return Number.isFinite(val) && val > 0 ? val : null;
  } catch {
    return null;
  }
}

export function saveStoredBestTimeTrialSec(
  timeSec: number,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    const s =
      storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    s?.setItem(STORAGE_KEY_TIMETRIAL_BEST, timeSec.toFixed(2));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * 2. DESTRUCTION DERBY (SOLO OR MULTIPLAYER):
 * Breakable voxel structures (buildings, towers, walls) & 60s Destruction Timer.
 */
export const DESTRUCTION_DERBY_DURATION_SEC = 60.0;

export interface BreakableDerbyStructureSpec {
  id: string;
  name: string;
  kind: 'TOWER' | 'WALL' | 'BUILDING';
  worldX: number;
  worldZ: number;
  widthVx: number;
  heightVy: number;
  depthVz: number;
  primaryMat: number;
  accentMat: number;
}

export const DEFAULT_DERBY_STRUCTURES: BreakableDerbyStructureSpec[] = [
  {
    id: 'derby_tower_north',
    name: 'Crimson Watchtower',
    kind: 'TOWER',
    worldX: 12,
    worldZ: 24,
    widthVx: 6,
    heightVy: 16,
    depthVz: 6,
    primaryMat: MAT.BRICK,
    accentMat: MAT.C4_EXPLOSIVE,
  },
  {
    id: 'derby_wall_west',
    name: 'Fortress Blast Wall',
    kind: 'WALL',
    worldX: -14,
    worldZ: 20,
    widthVx: 14,
    heightVy: 8,
    depthVz: 3,
    primaryMat: MAT.CONCRETE,
    accentMat: MAT.RAMP_ORANGE,
  },
  {
    id: 'derby_building_east',
    name: 'Outpost Bunker Depot',
    kind: 'BUILDING',
    worldX: 20,
    worldZ: 8,
    widthVx: 10,
    heightVy: 10,
    depthVz: 10,
    primaryMat: MAT.CANYON_ORANGE,
    accentMat: MAT.C4_EXPLOSIVE,
  },
  {
    id: 'derby_tower_south',
    name: 'Solar Relay Spire',
    kind: 'TOWER',
    worldX: -16,
    worldZ: -10,
    widthVx: 6,
    heightVy: 15,
    depthVz: 6,
    primaryMat: MAT.CANYON_ORANGE,
    accentMat: MAT.FLOAT_YELLOW,
  },
  {
    id: 'derby_wall_center',
    name: 'Checkered Smash Barrier',
    kind: 'WALL',
    worldX: 0,
    worldZ: 30,
    widthVx: 16,
    heightVy: 7,
    depthVz: 3,
    primaryMat: MAT.BRICK,
    accentMat: MAT.C4_EXPLOSIVE,
  },
  {
    id: 'derby_building_north_east',
    name: 'Refinery Silo Block',
    kind: 'BUILDING',
    worldX: 24,
    worldZ: 32,
    widthVx: 9,
    heightVy: 12,
    depthVz: 9,
    primaryMat: MAT.CONCRETE,
    accentMat: MAT.C4_EXPLOSIVE,
  },
];

export interface DestructionDerbyState {
  active: boolean;
  finished: boolean;
  remainingSec: number;
  baselineVoxelsDestroyed: number;
  scoreVoxelsDestroyed: number;
  bestScoreVoxels: number;
  comboMultiplier?: number;
  comboTimerSec?: number;
  milestonesAwarded?: number;
}

export function createInitialDestructionDerbyState(
  currentTotalVoxelsDestroyed = 0,
  bestScore = 0,
): DestructionDerbyState {
  return {
    active: true,
    finished: false,
    remainingSec: DESTRUCTION_DERBY_DURATION_SEC,
    baselineVoxelsDestroyed: currentTotalVoxelsDestroyed,
    scoreVoxelsDestroyed: 0,
    bestScoreVoxels: bestScore,
    comboMultiplier: 1.0,
    comboTimerSec: 0,
    milestonesAwarded: 0,
  };
}

export function stepDestructionDerby(
  state: DestructionDerbyState,
  dtSec: number,
  currentTotalVoxelsDestroyed: number,
  extraScoreBonus = 0,
): DestructionDerbyState {
  if (!state.active || state.finished) return state;

  const rawDestroyed =
    Math.max(0, currentTotalVoxelsDestroyed - state.baselineVoxelsDestroyed) +
    extraScoreBonus;
  const deltaVoxels = Math.max(0, rawDestroyed - state.scoreVoxelsDestroyed);

  let comboMult = state.comboMultiplier ?? 1.0;
  let comboTimer = Math.max(0, (state.comboTimerSec ?? 0) - dtSec);
  if (deltaVoxels > 0) {
    comboTimer = 3.5;
    comboMult = Math.min(4.0, Number((comboMult + Math.min(0.5, deltaVoxels * 0.02)).toFixed(2)));
  } else if (comboTimer <= 0) {
    comboMult = 1.0;
  }

  const liveScore = rawDestroyed;
  let milestones = state.milestonesAwarded ?? 0;
  let bonusTimeSec = 0;
  if (milestones === 0 && liveScore >= 150) {
    milestones = 1;
    bonusTimeSec = 8.0; // +8s Destruction Frenzy Time Bonus!
  } else if (milestones === 1 && liveScore >= 400) {
    milestones = 2;
    bonusTimeSec = 10.0; // +10s Mega Demolition Time Bonus!
  }

  const nextRem = Math.max(0, state.remainingSec - dtSec + bonusTimeSec);
  const finished = nextRem <= 0;
  const nextBest = Math.max(state.bestScoreVoxels, liveScore);

  return {
    ...state,
    remainingSec: nextRem,
    scoreVoxelsDestroyed: liveScore,
    bestScoreVoxels: nextBest,
    comboMultiplier: comboMult,
    comboTimerSec: comboTimer,
    milestonesAwarded: milestones,
    finished,
  };
}

/**
 * 3. BUILDING CHALLENGE (SOLO):
 * Prompts + 5-Minute Build Timer + Automated Physics Verification + Photo Snapshot!
 */
export type BuildingChallengePromptId =
  | 'DROP_50M'
  | 'MAX_50_BLOCKS'
  | 'FASTEST_NO_JETS'
  | 'HEAVY_ARMOR_FORTRESS'
  | 'SHREDDER_GAUNTLET_RUN'
  | 'SKY_JUMPER_FLIGHT';

export interface BuildingChallengePromptSpec {
  id: BuildingChallengePromptId;
  title: string;
  promptText: string;
  ruleSummary: string;
  buildTimeSec: number;
  testDurationSec: number;
}

export const BUILDING_CHALLENGE_PROMPTS: BuildingChallengePromptSpec[] = [
  {
    id: 'DROP_50M',
    title: '50m Drop Survival',
    promptText: 'Build a vehicle that can survive a 50m drop',
    ruleSummary:
      'Auto-test lifts your vehicle 50m into the sky and drops it onto the concrete arena. Keep ≥ 70% structural integrity & an intact seat to PASS!',
    buildTimeSec: 300,
    testDurationSec: 4.0,
  },
  {
    id: 'MAX_50_BLOCKS',
    title: '50-Block Micro-Engineer',
    promptText: 'Build a vehicle with only 50 blocks',
    ruleSummary:
      'Total blocks + modules must be ≤ 50 (and ≥ 3) with an intact seat, and your vehicle must drive forward at least 8m during the auto-test!',
    buildTimeSec: 300,
    testDurationSec: 3.5,
  },
  {
    id: 'FASTEST_NO_JETS',
    title: 'Pure Wheel Speedster',
    promptText: 'Build the fastest car with no jet engines',
    ruleSummary:
      'Zero jet engines, rockets, or propellers allowed! Auto-test floors the wheel throttle for 3.5s — reach ≥ 28 km/h using wheel power alone to PASS!',
    buildTimeSec: 300,
    testDurationSec: 3.5,
  },
  {
    id: 'HEAVY_ARMOR_FORTRESS',
    title: '90-Block Heavy Juggernaut',
    promptText: 'Build a heavily armored rig (≥ 90 blocks) that drives ≥ 20 km/h',
    ruleSummary:
      'Must contain ≥ 90 blocks/modules, retain ≥ 85% structural integrity, and reach at least 20 km/h under its own power!',
    buildTimeSec: 300,
    testDurationSec: 4.0,
  },
  {
    id: 'SHREDDER_GAUNTLET_RUN',
    title: 'Hazard Gauntlet Survivor',
    promptText: 'Build a reinforced rig that sprints ≥ 18m with ≥ 75% integrity',
    ruleSummary:
      'Auto-test launches your rig forward for 4.0s — cover ≥ 18m distance while keeping ≥ 75% hull integrity and an intact seat!',
    buildTimeSec: 300,
    testDurationSec: 4.0,
  },
  {
    id: 'SKY_JUMPER_FLIGHT',
    title: 'Mach-Speed Sprint (≥ 48 km/h)',
    promptText: 'Build an ultra-fast thruster or dragster rig that hits ≥ 48 km/h',
    ruleSummary:
      'Combine engines, wheels, or thrusters to break the 48 km/h speed barrier during the 3.5s full-throttle auto-test!',
    buildTimeSec: 300,
    testDurationSec: 3.5,
  },
];

export const FORBIDDEN_JET_MODULE_KINDS: ReadonlySet<ModuleKind> = new Set<ModuleKind>([
  'JET_RAW',
  'THRUSTER_ROCKET',
  'PROP_AERO',
  'VTOL_ROTOR',
]);

export interface BuildingChallengeVehicleTelemetry {
  totalBlocks: number;
  hasIntactSeat: boolean;
  structuralIntegrityPct: number;
  installedModuleKinds: ModuleKind[];
  peakSpeedKmh: number;
  distanceTravelledMeters: number;
}

export interface BuildingChallengeEvaluation {
  passed: boolean;
  headline: string;
  detail: string;
  metricsBadge: string;
}

export function evaluateBuildingChallengeResult(
  promptId: BuildingChallengePromptId,
  telemetry: BuildingChallengeVehicleTelemetry,
): BuildingChallengeEvaluation {
  if (!telemetry.hasIntactSeat) {
    return {
      passed: false,
      headline: 'FAIL · NO INTACT DRIVER SEAT',
      detail: 'Your vehicle must have an intact driver seat at the end of the test.',
      metricsBadge: `Integrity: ${telemetry.structuralIntegrityPct}% · Blocks: ${telemetry.totalBlocks}`,
    };
  }

  if (promptId === 'DROP_50M') {
    const passed = telemetry.structuralIntegrityPct >= 70;
    return {
      passed,
      headline: passed
        ? 'PASS · SURVIVED 50M FREE-FALL!'
        : 'FAIL · CHASSIS SHATTERED ON IMPACT',
      detail: passed
        ? `Your suspension and armor absorbed the 50m drop with ${telemetry.structuralIntegrityPct}% integrity remaining!`
        : `Structural integrity dropped to ${telemetry.structuralIntegrityPct}% (requires ≥ 70% after 50m impact). Add suspension or stronger armor!`,
      metricsBadge: `Drop Integrity: ${telemetry.structuralIntegrityPct}% · Blocks: ${telemetry.totalBlocks}`,
    };
  }

  if (promptId === 'MAX_50_BLOCKS') {
    if (telemetry.totalBlocks > 50) {
      return {
        passed: false,
        headline: `FAIL · OVER BLOCK LIMIT (${telemetry.totalBlocks}/50)`,
        detail: `Your vehicle uses ${telemetry.totalBlocks} blocks, which exceeds the 50-block cap by ${telemetry.totalBlocks - 50}.`,
        metricsBadge: `Blocks: ${telemetry.totalBlocks}/50`,
      };
    }
    const droveEnough =
      telemetry.distanceTravelledMeters >= 6.0 || telemetry.peakSpeedKmh >= 16;
    return {
      passed: droveEnough,
      headline: droveEnough
        ? `PASS · ${telemetry.totalBlocks}-BLOCK MICRO-RIG DRIVES!`
        : 'FAIL · VEHICLE DID NOT DRIVE FORWARD',
      detail: droveEnough
        ? `Built with only ${telemetry.totalBlocks}/50 blocks and hit ${Math.round(telemetry.peakSpeedKmh)} km/h!`
        : `Under the 50-block limit (${telemetry.totalBlocks}/50), but only moved ${telemetry.distanceTravelledMeters.toFixed(1)}m. Add powered wheels!`,
      metricsBadge: `Blocks: ${telemetry.totalBlocks}/50 · Peak: ${Math.round(telemetry.peakSpeedKmh)} km/h`,
    };
  }

  if (promptId === 'HEAVY_ARMOR_FORTRESS') {
    if (telemetry.totalBlocks < 90) {
      return {
        passed: false,
        headline: `FAIL · TOO LIGHT (${telemetry.totalBlocks}/90 BLOCKS)`,
        detail: `Your fortress needs at least 90 blocks/modules (currently ${telemetry.totalBlocks}). Add Heavy Steel or Tungsten armor!`,
        metricsBadge: `Blocks: ${telemetry.totalBlocks}/90 · Integrity: ${telemetry.structuralIntegrityPct}%`,
      };
    }
    const passed = telemetry.peakSpeedKmh >= 20 && telemetry.structuralIntegrityPct >= 85;
    return {
      passed,
      headline: passed
        ? `PASS · ${telemetry.totalBlocks}-BLOCK JUGGERNAUT ROLLS OUT!`
        : 'FAIL · FORTRESS TOO SLOW OR DAMAGED',
      detail: passed
        ? `Heavy ${telemetry.totalBlocks}-block fortress reached ${Math.round(telemetry.peakSpeedKmh)} km/h with ${telemetry.structuralIntegrityPct}% integrity!`
        : `Reached ${Math.round(telemetry.peakSpeedKmh)} km/h (needs ≥ 20 km/h & ≥ 85% integrity). Add Monster Wheels or Dragon Engines!`,
      metricsBadge: `Blocks: ${telemetry.totalBlocks} · Peak: ${Math.round(telemetry.peakSpeedKmh)} km/h`,
    };
  }

  if (promptId === 'SHREDDER_GAUNTLET_RUN') {
    const passed =
      telemetry.distanceTravelledMeters >= 18.0 &&
      telemetry.structuralIntegrityPct >= 75;
    return {
      passed,
      headline: passed
        ? 'PASS · GAUNTLET SPRINT COMPLETED!'
        : 'FAIL · DID NOT CLEAR 18M GAUNTLET INTACT',
      detail: passed
        ? `Covered ${telemetry.distanceTravelledMeters.toFixed(1)}m with ${telemetry.structuralIntegrityPct}% chassis integrity!`
        : `Travelled ${telemetry.distanceTravelledMeters.toFixed(1)}m (needs ≥ 18m) at ${telemetry.structuralIntegrityPct}% integrity (needs ≥ 75%).`,
      metricsBadge: `Dist: ${telemetry.distanceTravelledMeters.toFixed(1)}m · Integrity: ${telemetry.structuralIntegrityPct}%`,
    };
  }

  if (promptId === 'SKY_JUMPER_FLIGHT') {
    const passed = telemetry.peakSpeedKmh >= 48;
    return {
      passed,
      headline: passed
        ? `PASS · ${Math.round(telemetry.peakSpeedKmh)} KM/H MACH RUNNER!`
        : `FAIL · REACHED ${Math.round(telemetry.peakSpeedKmh)} / 48 KM/H`,
      detail: passed
        ? `Blasted to ${Math.round(telemetry.peakSpeedKmh)} km/h with ${telemetry.structuralIntegrityPct}% hull integrity!`
        : `Peak speed was ${Math.round(telemetry.peakSpeedKmh)} km/h (requires ≥ 48 km/h). Add Plasma Jets or Rocket Thrusters!`,
      metricsBadge: `Peak Speed: ${Math.round(telemetry.peakSpeedKmh)} km/h`,
    };
  }

  // FASTEST_NO_JETS
  const forbiddenUsed = telemetry.installedModuleKinds.filter((k) =>
    FORBIDDEN_JET_MODULE_KINDS.has(k),
  );
  if (forbiddenUsed.length > 0) {
    return {
      passed: false,
      headline: 'FAIL · JET / THRUSTER DETECTED!',
      detail: `Disqualified for using ${forbiddenUsed.length} forbidden jet/thruster module(s) (${forbiddenUsed[0]}). Use only wheels & engines!`,
      metricsBadge: `Forbidden Jets: ${forbiddenUsed.length}`,
    };
  }

  const fastEnough = telemetry.peakSpeedKmh >= 28;
  return {
    passed: fastEnough,
    headline: fastEnough
      ? `PASS · ${Math.round(telemetry.peakSpeedKmh)} KM/H WHEEL SPEEDSTER!`
      : `FAIL · TOO SLOW (${Math.round(telemetry.peakSpeedKmh)} / 28 KM/H)`,
    detail: fastEnough
      ? `Reached ${Math.round(telemetry.peakSpeedKmh)} km/h on pure wheel & engine power with zero jets!`
      : `Only reached ${Math.round(telemetry.peakSpeedKmh)} km/h (target ≥ 28 km/h). Add Dragon Engines or Dragster Wheels!`,
    metricsBadge: `Peak Speed: ${Math.round(telemetry.peakSpeedKmh)} km/h · 0 Jets`,
  };
}

/**
 * 4. CAPTURE THE FLAG (MULTIPLAYER 2v2 / 3v3 OR SOLO):
 * Two bases on opposite ends of the map. First to 3 captures wins.
 */
export const CTF_WIN_CAPTURES = 3;
export const CTF_BASE_RADIUS_METERS = 7.0;

export interface CtfMatchState {
  blueCaptures: number;
  redCaptures: number;
  targetCaptures: number;
  playerTeam: 'BLUE' | 'RED';
  blueBasePos: { x: number; y: number; z: number };
  redBasePos: { x: number; y: number; z: number };
  carrierOfRedFlag: string | null; // 'LOCAL_PLAYER' or peerId
  carrierOfBlueFlag: string | null; // 'BOT_RED' or peerId
  winnerTeam: 'BLUE' | 'RED' | null;
  statusBanner: string;
}

export function createInitialCtfState(
  playerTeam: 'BLUE' | 'RED' = 'BLUE',
): CtfMatchState {
  return {
    blueCaptures: 0,
    redCaptures: 0,
    targetCaptures: CTF_WIN_CAPTURES,
    playerTeam,
    blueBasePos: { x: 0, y: WATER_LEVEL + 1.8, z: -42 },
    redBasePos: { x: 0, y: WATER_LEVEL + 1.8, z: 54 },
    carrierOfRedFlag: null,
    carrierOfBlueFlag: null,
    winnerTeam: null,
    statusBanner:
      'Drive to the Enemy Base (+54m North) to steal their Flag, then return to Blue Base (-42m South)!',
  };
}

export function stepCtfPlayerPosition(
  state: CtfMatchState,
  playerPos: { x: number; y: number; z: number },
  actorId = 'LOCAL_PLAYER',
): {
  state: CtfMatchState;
  event: 'NONE' | 'PICKED_UP_FLAG' | 'SCORED_CAPTURE' | 'MATCH_WON';
} {
  if (state.winnerTeam) {
    return { state, event: 'NONE' };
  }

  const enemyBase =
    state.playerTeam === 'BLUE' ? state.redBasePos : state.blueBasePos;
  const homeBase =
    state.playerTeam === 'BLUE' ? state.blueBasePos : state.redBasePos;

  const distToEnemyBase = Math.hypot(
    playerPos.x - enemyBase.x,
    playerPos.z - enemyBase.z,
  );
  const distToHomeBase = Math.hypot(
    playerPos.x - homeBase.x,
    playerPos.z - homeBase.z,
  );

  const isCarryingEnemyFlag =
    state.playerTeam === 'BLUE'
      ? state.carrierOfRedFlag === actorId
      : state.carrierOfBlueFlag === actorId;

  if (!isCarryingEnemyFlag && distToEnemyBase <= CTF_BASE_RADIUS_METERS) {
    const nextState: CtfMatchState = {
      ...state,
      carrierOfRedFlag:
        state.playerTeam === 'BLUE' ? actorId : state.carrierOfRedFlag,
      carrierOfBlueFlag:
        state.playerTeam === 'RED' ? actorId : state.carrierOfBlueFlag,
      statusBanner:
        '🚩 YOU HAVE THE ENEMY FLAG! Race back to your Home Base to score!',
    };
    return { state: nextState, event: 'PICKED_UP_FLAG' };
  }

  if (isCarryingEnemyFlag && distToHomeBase <= CTF_BASE_RADIUS_METERS) {
    const nextBlue =
      state.playerTeam === 'BLUE' ? state.blueCaptures + 1 : state.blueCaptures;
    const nextRed =
      state.playerTeam === 'RED' ? state.redCaptures + 1 : state.redCaptures;
    const winner: 'BLUE' | 'RED' | null =
      nextBlue >= state.targetCaptures
        ? 'BLUE'
        : nextRed >= state.targetCaptures
          ? 'RED'
          : null;

    const nextState: CtfMatchState = {
      ...state,
      blueCaptures: nextBlue,
      redCaptures: nextRed,
      carrierOfRedFlag:
        state.playerTeam === 'BLUE' ? null : state.carrierOfRedFlag,
      carrierOfBlueFlag:
        state.playerTeam === 'RED' ? null : state.carrierOfBlueFlag,
      winnerTeam: winner,
      statusBanner: winner
        ? `🏆 ${winner} TEAM WINS CAPTURE THE FLAG (${nextBlue} - ${nextRed})!`
        : `🎯 FLAG CAPTURED! Score: BLUE ${nextBlue} — RED ${nextRed} (First to ${state.targetCaptures})`,
    };
    return {
      state: nextState,
      event: winner ? 'MATCH_WON' : 'SCORED_CAPTURE',
    };
  }

  return { state, event: 'NONE' };
}

/**
 * 5. BUILD BATTLE (MULTIPLAYER / ARENA CONTENDERS):
 * 5-minute shared prompt build phase -> Arena spawn -> Last vehicle moving wins!
 */
export const BUILD_BATTLE_PROMPTS: string[] = [
  'Heavy Ramming Juggernaut',
  'Artillery Plasma Hover-Tank',
  'High-Speed Wedge Flipper',
  'Multi-Turret Battle Fortress',
  'Twin-Sawblade Shredder Chariot',
  'Rocket-Powered Sky Interceptor',
];

export interface BuildBattleContender {
  id: string;
  name: string;
  color: string;
  isPlayer: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface BuildBattleState {
  phase: 'BUILD' | 'ARENA_COMBAT' | 'VICTORY';
  prompt: string;
  buildRemainingSec: number;
  combatElapsedSec: number;
  contenders: BuildBattleContender[];
  winnerName: string | null;
}

export function createInitialBuildBattleState(
  promptIndex = 0,
): BuildBattleState {
  const prompt =
    BUILD_BATTLE_PROMPTS[promptIndex % BUILD_BATTLE_PROMPTS.length];
  return {
    phase: 'BUILD',
    prompt,
    buildRemainingSec: 300,
    combatElapsedSec: 0,
    contenders: [],
    winnerName: null,
  };
}

export function launchBuildBattleArena(
  state: BuildBattleState,
  playerName = 'Pilot_01',
): BuildBattleState {
  const contenders: BuildBattleContender[] = [
    {
      id: 'player',
      name: `${playerName} (You)`,
      color: '#facc15',
      isPlayer: true,
      x: 0,
      y: WATER_LEVEL + 2.2,
      z: -16,
      vx: 0,
      vz: 0,
      hp: 100,
      maxHp: 100,
      alive: true,
    },
    {
      id: 'gladiator_1',
      name: 'IronClad_Mk4',
      color: '#f43f5e',
      isPlayer: false,
      x: -18,
      y: WATER_LEVEL + 2.2,
      z: 18,
      vx: 0,
      vz: 0,
      hp: 100,
      maxHp: 100,
      alive: true,
    },
    {
      id: 'gladiator_2',
      name: 'VoltCrusher_X',
      color: '#38bdf8',
      isPlayer: false,
      x: 18,
      y: WATER_LEVEL + 2.2,
      z: 18,
      vx: 0,
      vz: 0,
      hp: 100,
      maxHp: 100,
      alive: true,
    },
    {
      id: 'gladiator_3',
      name: 'ApexDozer_99',
      color: '#c084fc',
      isPlayer: false,
      x: 0,
      y: WATER_LEVEL + 2.2,
      z: 26,
      vx: 0,
      vz: 0,
      hp: 100,
      maxHp: 100,
      alive: true,
    },
  ];

  return {
    ...state,
    phase: 'ARENA_COMBAT',
    buildRemainingSec: 0,
    combatElapsedSec: 0,
    contenders,
    winnerName: null,
  };
}

/**
 * 6. SURVIVAL WAVES (SOLO OR CO-OP):
 * Hostile voxel cubes (RUNNER, BRUTE, BOMBER, BOSS) spawn in escalating waves!
 */
export type SurvivalEnemyArchetype = 'RUNNER' | 'BRUTE' | 'BOMBER' | 'BOSS';

export interface SurvivalEnemyCube {
  id: string;
  archetype?: SurvivalEnemyArchetype;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  sizeMeters: number;
  hp: number;
  maxHp: number;
  speedMPS: number;
  colorHex: number;
  hopPhase: number;
}

export interface SurvivalWavesState {
  wave: number;
  bestWave: number;
  enemies: SurvivalEnemyCube[];
  totalDefeated: number;
  playerShieldPct: number;
  waveIntermissionSec: number;
  isGameOver: boolean;
}

export function spawnWaveEnemyCubes(
  wave: number,
  centerPos: { x: number; y: number; z: number },
): SurvivalEnemyCube[] {
  const count = Math.min(18, 3 + wave * 2);
  const enemies: SurvivalEnemyCube[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + wave * 0.37;
    const radius = 28 + (i % 3) * 6;
    const isBossCube = i === 0 && wave >= 3;
    const archetype: SurvivalEnemyArchetype = isBossCube
      ? 'BOSS'
      : i % 4 === 1
        ? 'RUNNER'
        : i % 4 === 2
          ? 'BRUTE'
          : i % 4 === 3 && wave >= 2
            ? 'BOMBER'
            : 'RUNNER';

    const hp =
      archetype === 'BOSS'
        ? 110 + wave * 25
        : archetype === 'BRUTE'
          ? 55 + wave * 14
          : archetype === 'BOMBER'
            ? 25 + wave * 8
            : 30 + wave * 10;

    const sizeMeters =
      archetype === 'BOSS'
        ? 2.45
        : archetype === 'BRUTE'
          ? 1.75
          : archetype === 'BOMBER'
            ? 1.3
            : 1.25;

    const speedMPS =
      archetype === 'RUNNER'
        ? Math.min(18.5, 8.2 + wave * 0.9)
        : archetype === 'BOMBER'
          ? Math.min(17.0, 7.6 + wave * 0.85)
          : archetype === 'BRUTE'
            ? Math.min(13.0, 5.4 + wave * 0.65)
            : Math.min(15.0, 6.5 + wave * 0.75);

    const colorHex =
      archetype === 'BOSS'
        ? 0xfacc15
        : archetype === 'BRUTE'
          ? 0xa855f7
          : archetype === 'BOMBER'
            ? 0xf97316
            : 0xf43f5e;

    enemies.push({
      id: `wave_${wave}_cube_${i}`,
      archetype,
      x: centerPos.x + Math.cos(angle) * radius,
      y: Math.max(WATER_LEVEL + 2.2, centerPos.y + 1.5),
      z: centerPos.z + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      vz: 0,
      sizeMeters,
      hp,
      maxHp: hp,
      speedMPS,
      colorHex,
      hopPhase: i * 0.9,
    });
  }
  return enemies;
}

export function createInitialSurvivalWavesState(
  centerPos: { x: number; y: number; z: number } = {
    x: 0,
    y: WATER_LEVEL + 2.0,
    z: 0,
  },
  bestWave = 1,
): SurvivalWavesState {
  return {
    wave: 1,
    bestWave: Math.max(1, bestWave),
    enemies: spawnWaveEnemyCubes(1, centerPos),
    totalDefeated: 0,
    playerShieldPct: 100,
    waveIntermissionSec: 0,
    isGameOver: false,
  };
}

export function stepSurvivalWaves(
  state: SurvivalWavesState,
  dtSec: number,
  playerPos: { x: number; y: number; z: number },
  playerSpeedKmh: number,
  playerIntegrityPct: number,
  playerHasSeat: boolean,
  sampleGroundY?: (x: number, z: number) => number,
): {
  state: SurvivalWavesState;
  playerHitCount: number;
  enemiesSmashedByRam: Array<{ x: number; y: number; z: number; colorHex: number }>;
  waveCleared: boolean;
} {
  if (state.isGameOver) {
    return {
      state,
      playerHitCount: 0,
      enemiesSmashedByRam: [],
      waveCleared: false,
    };
  }

  if (!playerHasSeat || playerIntegrityPct < 20 || state.playerShieldPct <= 0) {
    return {
      state: {
        ...state,
        playerShieldPct: 0,
        isGameOver: true,
      },
      playerHitCount: 0,
      enemiesSmashedByRam: [],
      waveCleared: false,
    };
  }

  let playerHitCount = 0;
  let nextShield = state.playerShieldPct;
  let nextTotalDefeated = state.totalDefeated;
  const enemiesSmashedByRam: Array<{
    x: number;
    y: number;
    z: number;
    colorHex: number;
  }> = [];

  const survivingEnemies: SurvivalEnemyCube[] = [];

  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0) {
      nextTotalDefeated++;
      enemiesSmashedByRam.push({
        x: e.x,
        y: e.y,
        z: e.z,
        colorHex: e.colorHex,
      });
      continue;
    }

    const dx = playerPos.x - e.x;
    const dz = playerPos.z - e.z;
    const dist = Math.hypot(dx, dz);
    const dirX = dist > 0.001 ? dx / dist : 0;
    const dirZ = dist > 0.001 ? dz / dist : 1;

    const nextHopPhase = e.hopPhase + dtSec * 5.2;
    const hopOffset = Math.max(0, Math.sin(nextHopPhase)) * 0.75;
    const nx = e.x + dirX * e.speedMPS * dtSec;
    const nz = e.z + dirZ * e.speedMPS * dtSec;
    const baseGround = sampleGroundY
      ? sampleGroundY(nx, nz)
      : WATER_LEVEL + 1.5;
    const ny = Math.max(WATER_LEVEL + 0.8, baseGround) + e.sizeMeters * 0.5 + hopOffset;

    // Check collision with player/vehicle
    const hitRadius = e.sizeMeters * 0.65 + 2.1;
    if (dist <= hitRadius) {
      if (playerSpeedKmh >= 24) {
        // High-speed ramming smashes the enemy voxel cube!
        nextTotalDefeated++;
        enemiesSmashedByRam.push({
          x: nx,
          y: ny,
          z: nz,
          colorHex: e.colorHex,
        });
        continue;
      } else {
        // Enemy cube slams into the player's rig and deals damage!
        playerHitCount++;
        const dmg = e.archetype === 'BOMBER' ? 20 : e.archetype === 'BRUTE' ? 16 : 12;
        nextShield = Math.max(0, nextShield - dmg);
        // Knock the cube back after impact
        survivingEnemies.push({
          ...e,
          x: nx - dirX * 7.5,
          y: ny + 1.2,
          z: nz - dirZ * 7.5,
          hopPhase: nextHopPhase,
        });
        continue;
      }
    }

    survivingEnemies.push({
      ...e,
      x: nx,
      y: ny,
      z: nz,
      hopPhase: nextHopPhase,
    });
  }

  if (survivingEnemies.length === 0) {
    const nextWave = state.wave + 1;
    const nextBest = Math.max(state.bestWave, nextWave);
    return {
      state: {
        ...state,
        wave: nextWave,
        bestWave: nextBest,
        enemies: spawnWaveEnemyCubes(nextWave, playerPos),
        totalDefeated: nextTotalDefeated,
        playerShieldPct: Math.min(100, nextShield + 20),
        isGameOver: nextShield <= 0,
      },
      playerHitCount,
      enemiesSmashedByRam,
      waveCleared: true,
    };
  }

  return {
    state: {
      ...state,
      enemies: survivingEnemies,
      totalDefeated: nextTotalDefeated,
      playerShieldPct: nextShield,
      isGameOver: nextShield <= 0,
    },
    playerHitCount,
    enemiesSmashedByRam,
    waveCleared: false,
  };
}

/**
 * 7. NEW GAME MODES: KING OF THE HILL, STUNT FREESTYLE JAM & JUGGERNAUT BOSS HUNT
 */
export interface KingOfTheHillState {
  hillCenter: { x: number; y: number; z: number };
  hillRadiusMeters: number;
  playerControlPct: number;
  aiControlPct: number;
  playerInZone: boolean;
  contested: boolean;
  winner: 'PLAYER' | 'AI' | null;
}

export function createInitialKingOfTheHillState(): KingOfTheHillState {
  return {
    hillCenter: { x: 0, y: WATER_LEVEL + 1.8, z: 12 },
    hillRadiusMeters: 11.0,
    playerControlPct: 0,
    aiControlPct: 0,
    playerInZone: false,
    contested: false,
    winner: null,
  };
}

export function stepKingOfTheHill(
  state: KingOfTheHillState,
  dtSec: number,
  playerPos: { x: number; y: number; z: number },
  aiPositions: Array<{ x: number; z: number }> = [],
): KingOfTheHillState {
  if (state.winner) return state;
  const distPlayer = Math.hypot(
    playerPos.x - state.hillCenter.x,
    playerPos.z - state.hillCenter.z,
  );
  const playerInZone = distPlayer <= state.hillRadiusMeters;
  const aiInZone = aiPositions.some(
    (p) =>
      Math.hypot(p.x - state.hillCenter.x, p.z - state.hillCenter.z) <=
      state.hillRadiusMeters,
  );
  const contested = playerInZone && aiInZone;
  let nextPlayerPct = state.playerControlPct;
  let nextAiPct = state.aiControlPct;

  if (playerInZone && !aiInZone) {
    nextPlayerPct = Math.min(100, nextPlayerPct + dtSec * 4.5);
  } else if (aiInZone && !playerInZone) {
    nextAiPct = Math.min(100, nextAiPct + dtSec * 2.8);
  } else if (playerInZone && aiInZone) {
    // Player still edges out progress slowly while brawling on the hill
    nextPlayerPct = Math.min(100, nextPlayerPct + dtSec * 1.5);
  }

  const winner: 'PLAYER' | 'AI' | null =
    nextPlayerPct >= 100 ? 'PLAYER' : nextAiPct >= 100 ? 'AI' : null;

  return {
    ...state,
    playerControlPct: Number(nextPlayerPct.toFixed(1)),
    aiControlPct: Number(nextAiPct.toFixed(1)),
    playerInZone,
    contested,
    winner,
  };
}

export interface StuntFreestyleState {
  remainingSec: number;
  finished: boolean;
  totalScore: number;
  bestScore: number;
  currentAirtimeSec: number;
  comboMultiplier: number;
  lastTrickBanner: string;
}

export function createInitialStuntFreestyleState(bestScore = 0): StuntFreestyleState {
  return {
    remainingSec: 90.0,
    finished: false,
    totalScore: 0,
    bestScore,
    currentAirtimeSec: 0,
    comboMultiplier: 1.0,
    lastTrickBanner: 'Hit ramps, get big air & pull high-speed drifts!',
  };
}

export function stepStuntFreestyle(
  state: StuntFreestyleState,
  dtSec: number,
  isAirborne: boolean,
  speedKmh: number,
  angularSpeedRadSec: number,
): StuntFreestyleState {
  if (state.finished) return state;
  const nextRem = Math.max(0, state.remainingSec - dtSec);
  const finished = nextRem <= 0;

  let nextScore = state.totalScore;
  let nextAir = isAirborne ? state.currentAirtimeSec + dtSec : 0;
  let nextCombo = state.comboMultiplier;
  let nextBanner = state.lastTrickBanner;

  if (isAirborne && nextAir > 0.35) {
    const airPoints = Math.round(dtSec * 140 * nextCombo);
    nextScore += airPoints;
    if (angularSpeedRadSec > 2.2) {
      nextCombo = Math.min(5.0, Number((nextCombo + dtSec * 0.65).toFixed(2)));
      nextScore += Math.round(dtSec * 220 * nextCombo);
      nextBanner = `🌪️ AERIAL BARREL SPIN! (${nextCombo.toFixed(1)}x COMBO)`;
    } else if (nextAir > 1.8) {
      nextCombo = Math.min(5.0, Number((nextCombo + dtSec * 0.35).toFixed(2)));
      nextBanner = `🚀 MEGA AIRTIME: ${nextAir.toFixed(1)}s (${nextCombo.toFixed(1)}x)`;
    }
  } else if (!isAirborne) {
    if (state.currentAirtimeSec >= 1.2) {
      const landingBonus = Math.round(state.currentAirtimeSec * 250 * nextCombo);
      nextScore += landingBonus;
      nextBanner = `🎯 STUNT LANDING +${landingBonus} PTS!`;
    } else if (speedKmh >= 65) {
      nextScore += Math.round(dtSec * 45);
      nextBanner = `⚡ SUPERSONIC RUN (${Math.round(speedKmh)} KM/H)`;
    } else {
      nextCombo = Math.max(1.0, Number((nextCombo - dtSec * 0.25).toFixed(2)));
    }
  }

  return {
    remainingSec: nextRem,
    finished,
    totalScore: nextScore,
    bestScore: Math.max(state.bestScore, nextScore),
    currentAirtimeSec: nextAir,
    comboMultiplier: nextCombo,
    lastTrickBanner: nextBanner,
  };
}

