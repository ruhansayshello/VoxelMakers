import * as THREE from 'three';
import {
  BUILD_SLOTS,
  BuildCategory,
  BuildSlotItem,
  MAT_INFO,
  MaterialSpec,
  ModuleKind,
  ModuleTuningConfig,
  WATER_LEVEL,
} from './constants';
import {
  TIME_TRIAL_5_CHECKPOINTS,
  loadStoredBestTimeTrialSec,
  saveStoredBestTimeTrialSec,
  type TeleportNode,
  type CtfMatchState,
  type SurvivalWavesState,
  type BuildBattleState,
} from './gameModesEngine';

export type ModBlockBehavior =
  | 'STANDARD_ARMOR'
  | 'ANTI_GRAV_HOVER'
  | 'SUPER_BOUNCE'
  | 'EXPLOSIVE_C4'
  | 'EMISSIVE_GLOW';

export interface ModBlockDefinition {
  id: string;
  name: string;
  type: 'voxel' | 'module';
  category: Exclude<BuildCategory, 'ALL'>;
  colorHex: string;
  massKg: number;
  powerCores: number;
  enabled: boolean;
  isBuiltIn?: boolean;
  // For voxel blocks:
  matId?: number;
  behavior?: ModBlockBehavior;
  durabilityHp?: number;
  friction?: number;
  restitution?: number;
  hoverForce?: number;
  bounceMultiplier?: number;
  // For functional module variants:
  moduleKind?: ModuleKind;
  strengthMult?: number;
  stiffnessMult?: number;
  dampingMult?: number;
  posKey?: string;
  negKey?: string;
}

export interface GameModeDefinition {
  id: string;
  name: string;
  description: string;
  badgeColor: string;
  gravityMult: number;
  enginePowerMult: number;
  thrusterPowerMult: number;
  explosionMult: number;
  indestructibleVehicles: boolean;
  enableCheckpointRace: boolean;
  enableDemolitionScore: boolean;
  isBuiltIn?: boolean;
}

export interface SerializedModPack {
  version: 1;
  packName: string;
  createdAt: string;
  activeGameModeId: string;
  customBlocks: ModBlockDefinition[];
  customGameModes: GameModeDefinition[];
}

export interface CheckpointGateState {
  index: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  label: string;
}

const STORAGE_KEY_MOD_PACK = 'terrasmash_internal_mods_v1';

// Extend MaterialSpec at runtime with optional hoverForce and bounceMultiplier
export interface ExtendedMaterialSpec extends MaterialSpec {
  hoverForce?: number;
  bounceMultiplier?: number;
}

export const BUILTIN_MOD_BLOCKS: ModBlockDefinition[] = [
  {
    id: 'mod_antigrav_core',
    name: 'Anti-Grav Hover Cube',
    type: 'voxel',
    category: 'BUOYANCY',
    colorHex: '#c084fc',
    massKg: 2,
    powerCores: 0,
    enabled: true,
    isBuiltIn: true,
    matId: 50,
    behavior: 'ANTI_GRAV_HOVER',
    durabilityHp: 18000,
    friction: 0.75,
    restitution: 0.35,
    hoverForce: 32,
  },
  {
    id: 'mod_hyper_slime',
    name: 'Hyper-Bounce Bumper',
    type: 'voxel',
    category: 'MECHANICAL',
    colorHex: '#84cc16',
    massKg: 8,
    powerCores: 0,
    enabled: true,
    isBuiltIn: true,
    matId: 51,
    behavior: 'SUPER_BOUNCE',
    durabilityHp: 65000,
    friction: 1.15,
    restitution: 1.45,
    bounceMultiplier: 2.3,
  },
  {
    id: 'mod_beskar_hull',
    name: 'Beskar Titan Alloy',
    type: 'voxel',
    category: 'CHASSIS',
    colorHex: '#cbd5e1',
    massKg: 14,
    powerCores: 0,
    enabled: true,
    isBuiltIn: true,
    matId: 52,
    behavior: 'STANDARD_ARMOR',
    durabilityHp: 120000,
    friction: 0.95,
    restitution: 0.25,
  },
  {
    id: 'mod_nova_detonator',
    name: 'Nova Plasma Charge',
    type: 'voxel',
    category: 'WEAPONS',
    colorHex: '#f43f5e',
    massKg: 5,
    powerCores: 0,
    enabled: true,
    isBuiltIn: true,
    matId: 53,
    behavior: 'EXPLOSIVE_C4',
    durabilityHp: 1600,
    friction: 0.85,
    restitution: 0.2,
  },
  {
    id: 'mod_overclock_jet',
    name: 'Overclocked Plasma Jet',
    type: 'module',
    category: 'PROPULSION',
    colorHex: '#38bdf8',
    massKg: 55,
    powerCores: 3,
    enabled: true,
    isBuiltIn: true,
    moduleKind: 'JET_RAW',
    strengthMult: 2.8,
    posKey: 'ShiftLeft',
  },
  {
    id: 'mod_crawler_wheel',
    name: 'Titan Crawler Wheel',
    type: 'module',
    category: 'WHEELS',
    colorHex: '#facc15',
    massKg: 62,
    powerCores: 1,
    enabled: true,
    isBuiltIn: true,
    moduleKind: 'WHEEL_MONSTER',
    strengthMult: 2.1,
    stiffnessMult: 1.4,
    dampingMult: 1.2,
    posKey: 'KeyW',
    negKey: 'KeyS',
  },
  {
    id: 'mod_railgun_turret',
    name: 'Hyper-Velocity Railgun',
    type: 'module',
    category: 'WEAPONS',
    colorHex: '#00f5ff',
    massKg: 50,
    powerCores: 2,
    enabled: true,
    isBuiltIn: true,
    moduleKind: 'PLASMA_CANNON',
    strengthMult: 2.5,
    posKey: 'KeyF',
  },
  {
    id: 'mod_cryo_drift_slider',
    name: 'Cryo Zero-Friction Slider',
    type: 'voxel',
    category: 'WHEELS',
    colorHex: '#67e8f9',
    massKg: 6,
    powerCores: 0,
    enabled: true,
    isBuiltIn: true,
    matId: 54,
    behavior: 'EMISSIVE_GLOW',
    durabilityHp: 35000,
    friction: 0.04,
    restitution: 0.35,
  },
  {
    id: 'mod_tungsten_ram_prow',
    name: 'Tungsten Siege Ram Block',
    type: 'voxel',
    category: 'CHASSIS',
    colorHex: '#334155',
    massKg: 20,
    powerCores: 0,
    enabled: true,
    isBuiltIn: true,
    matId: 55,
    behavior: 'STANDARD_ARMOR',
    durabilityHp: 155000,
    friction: 1.1,
    restitution: 0.1,
  },
  {
    id: 'mod_solar_repulsor_pad',
    name: 'Solar Repulsor Hover Pad',
    type: 'voxel',
    category: 'BUOYANCY',
    colorHex: '#fde047',
    massKg: 3,
    powerCores: 0,
    enabled: true,
    isBuiltIn: true,
    matId: 56,
    behavior: 'ANTI_GRAV_HOVER',
    durabilityHp: 28000,
    friction: 0.5,
    restitution: 0.4,
    hoverForce: 48,
  },
  {
    id: 'mod_twin_gatling_cannon',
    name: 'Overclocked Vulcan Minigun',
    type: 'module',
    category: 'WEAPONS',
    colorHex: '#fb923c',
    massKg: 42,
    powerCores: 2,
    enabled: true,
    isBuiltIn: true,
    moduleKind: 'WEAPON_MINIGUN',
    strengthMult: 2.4,
    posKey: 'KeyF',
  },
  {
    id: 'mod_heavy_siege_rocket',
    name: 'Hellfire Siege Rocket Pod',
    type: 'module',
    category: 'WEAPONS',
    colorHex: '#ef4444',
    massKg: 48,
    powerCores: 2,
    enabled: true,
    isBuiltIn: true,
    moduleKind: 'WEAPON_ROCKET',
    strengthMult: 2.3,
    posKey: 'KeyG',
  },
];

export const BUILTIN_GAME_MODES: GameModeDefinition[] = [
  {
    id: 'SANDBOX_FREEPLAY',
    name: 'Standard Proving Ground',
    description: 'Beginner-friendly proving ground with smooth launch lanes, stunt ramps, West Shredder Gauntlet & open-world engineering.',
    badgeColor: '#38bdf8',
    gravityMult: 1.0,
    enginePowerMult: 1.0,
    thrusterPowerMult: 1.0,
    explosionMult: 1.0,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: false,
    isBuiltIn: true,
  },
  {
    id: 'CHECKPOINT_TIME_TRIAL',
    name: '1. Time Trial (Solo)',
    description: '5 checkpoints in a row from Start Line to Finish Line with checkpoint nitro boost, Lap Timer & Best Time saved!',
    badgeColor: '#facc15',
    gravityMult: 1.0,
    enginePowerMult: 1.25,
    thrusterPowerMult: 1.2,
    explosionMult: 1.0,
    indestructibleVehicles: true,
    enableCheckpointRace: true,
    enableDemolitionScore: false,
    isBuiltIn: true,
  },
  {
    id: 'DESTRUCTION_DERBY',
    name: '2. Destruction Derby (60s)',
    description: 'Spawns breakable voxel buildings, towers & blast walls! Chain combos & hit 150/400 voxel milestones for +8s/+10s bonus time!',
    badgeColor: '#f43f5e',
    gravityMult: 1.0,
    enginePowerMult: 1.45,
    thrusterPowerMult: 1.4,
    explosionMult: 2.2,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: true,
    isBuiltIn: true,
  },
  {
    id: 'BUILDING_CHALLENGE',
    name: '3. Building Challenge (Solo)',
    description: '6 engineering prompts ("50m Drop", "Max 50 Blocks", "No Jets", "90-Block Fortress", "Gauntlet Sprint", "Mach Sprint") + auto-test!',
    badgeColor: '#4ade80',
    gravityMult: 1.0,
    enginePowerMult: 1.15,
    thrusterPowerMult: 1.15,
    explosionMult: 1.0,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: false,
    isBuiltIn: true,
  },
  {
    id: 'CAPTURE_THE_FLAG',
    name: '4. Capture the Flag (CTF)',
    description: 'Two bases on opposite ends of the map (Blue South vs Red North). Steal the enemy flag & return home — first to 3 captures wins!',
    badgeColor: '#38bdf8',
    gravityMult: 1.0,
    enginePowerMult: 1.25,
    thrusterPowerMult: 1.2,
    explosionMult: 1.35,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: false,
    isBuiltIn: true,
  },
  {
    id: 'BUILD_BATTLE',
    name: '5. Build Battle (Arena)',
    description: 'All players get a shared build prompt & 5 minutes to engineer. Then everyone spawns in the arena — last vehicle moving wins!',
    badgeColor: '#fb923c',
    gravityMult: 1.0,
    enginePowerMult: 1.3,
    thrusterPowerMult: 1.3,
    explosionMult: 1.6,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: true,
    isBuiltIn: true,
  },
  {
    id: 'SURVIVAL_WAVES',
    name: '6. Survival Waves (Co-op/Solo)',
    description: 'Runner, Brute, Bomber & Boss voxel cubes spawn in escalating waves! Ram (>24 km/h) or blast them to survive & restore +20% shield per wave.',
    badgeColor: '#c084fc',
    gravityMult: 1.0,
    enginePowerMult: 1.3,
    thrusterPowerMult: 1.25,
    explosionMult: 1.8,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: false,
    isBuiltIn: true,
  },
  {
    id: 'KING_OF_THE_HILL',
    name: '7. King of the Hill (Arena)',
    description: 'Hold the central Crown Zone (Z=+12m) against AI Gladiator rigs until your Crown Control reaches 100%!',
    badgeColor: '#facc15',
    gravityMult: 1.0,
    enginePowerMult: 1.35,
    thrusterPowerMult: 1.3,
    explosionMult: 1.5,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: true,
    isBuiltIn: true,
  },
  {
    id: 'SHREDDER_GAUNTLET',
    name: '8. Shredder Gauntlet (Hazards)',
    description: 'High-torque run through the West Shredder Gauntlet! Smash or dodge spinning voxel sawblades, twin rollers & guillotine pendulums.',
    badgeColor: '#f97316',
    gravityMult: 1.0,
    enginePowerMult: 1.4,
    thrusterPowerMult: 1.35,
    explosionMult: 1.75,
    indestructibleVehicles: false,
    enableCheckpointRace: true,
    enableDemolitionScore: true,
    isBuiltIn: true,
  },
  {
    id: 'STUNT_FREESTYLE',
    name: '9. Stunt Freestyle Jam (90s)',
    description: '90-second trick & airtime score attack! Launch off ramps, pull aerial barrel spins & chain high-speed landings for up to 5.0x combo.',
    badgeColor: '#2dd4bf',
    gravityMult: 0.78,
    enginePowerMult: 1.5,
    thrusterPowerMult: 1.65,
    explosionMult: 1.2,
    indestructibleVehicles: true,
    enableCheckpointRace: false,
    enableDemolitionScore: false,
    isBuiltIn: true,
  },
  {
    id: 'JUGGERNAUT_BOSS',
    name: '10. Juggernaut Titan Hunt',
    description: 'Face a heavily armored Boss Cube & escort squadron with 1.5x engine power and 2.4x weapon explosive yield!',
    badgeColor: '#e11d48',
    gravityMult: 1.0,
    enginePowerMult: 1.5,
    thrusterPowerMult: 1.45,
    explosionMult: 2.4,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: true,
    isBuiltIn: true,
  },
  {
    id: 'DEMOLITION_MAYHEM',
    name: 'Explosive Demolition Derby',
    description: '2.2x explosive blast radius, boosted engine ramming torque & live Destruction Score tracker!',
    badgeColor: '#f43f5e',
    gravityMult: 1.0,
    enginePowerMult: 1.35,
    thrusterPowerMult: 1.35,
    explosionMult: 2.2,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: true,
    isBuiltIn: true,
  },
  {
    id: 'LOW_GRAV_MOON',
    name: 'Low-G Lunar Colony',
    description: '0.30x Moon gravity with 1.6x thruster impulse for massive orbital stunt jumps & air control.',
    badgeColor: '#c084fc',
    gravityMult: 0.30,
    enginePowerMult: 1.15,
    thrusterPowerMult: 1.6,
    explosionMult: 1.25,
    indestructibleVehicles: false,
    enableCheckpointRace: false,
    enableDemolitionScore: false,
    isBuiltIn: true,
  },
  {
    id: 'HYPER_OVERDRIVE',
    name: 'Hyper-Speed Overdrive',
    description: '2.2x engine & jet power with indestructible chassis armor for extreme high-speed stunts.',
    badgeColor: '#4ade80',
    gravityMult: 1.15,
    enginePowerMult: 2.2,
    thrusterPowerMult: 2.3,
    explosionMult: 1.5,
    indestructibleVehicles: true,
    enableCheckpointRace: false,
    enableDemolitionScore: false,
    isBuiltIn: true,
  },
];

// 5 Checkpoints in a row from Start Line to Finish Line for Time Trial (Solo)
export const DEFAULT_CHECKPOINT_COURSE: CheckpointGateState[] = TIME_TRIAL_5_CHECKPOINTS;

const INITIAL_BASE_SLOT_COUNT = BUILD_SLOTS.length;

function parseHexToNumber(hex: string): number {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
  const parsed = parseInt(cleaned || '38bdf8', 16);
  return Number.isNaN(parsed) ? 0x38bdf8 : parsed;
}

class InternalModRegistry {
  public blocks: ModBlockDefinition[] = [...BUILTIN_MOD_BLOCKS];
  public gameModes: GameModeDefinition[] = [...BUILTIN_GAME_MODES];
  public activeGameModeId = 'SANDBOX_FREEPLAY';

  // Live Checkpoint Time Trial state
  public currentCheckpointIndex = 0;
  public raceTimerSec = 0;
  public bestLapSec: number | null = loadStoredBestTimeTrialSec();
  public lastLapSec: number | null = null;
  public completedLaps = 0;

  // Live Demolition Score state
  public demolitionScore = 0;

  // 3D Checkpoint Ring Meshes & Mode Visuals in the scene
  private attachedScene: THREE.Scene | null = null;
  private checkpointGroup: THREE.Group | null = null;
  private checkpointMeshes: THREE.Mesh[] = [];
  private checkpointBeaconMeshes: THREE.Mesh[] = [];
  private teleportBeaconGroup: THREE.Group | null = null;
  private ctfVisualGroup: THREE.Group | null = null;
  private survivalEnemyGroup: THREE.Group | null = null;
  private buildBattleGroup: THREE.Group | null = null;
  private lastTeleportSig = '';

  constructor() {
    this.loadFromStorage();
    this.syncToEngineConstants();
  }

  public getActiveGameMode(): GameModeDefinition {
    return (
      this.gameModes.find((m) => m.id === this.activeGameModeId) ||
      BUILTIN_GAME_MODES[0]
    );
  }

  public setActiveGameMode(id: string): GameModeDefinition {
    const found = this.gameModes.find((m) => m.id === id);
    if (found) {
      this.activeGameModeId = found.id;
      this.currentCheckpointIndex = 0;
      this.raceTimerSec = 0;
      this.saveToStorage();
      this.updateCheckpointVisuals();
      return found;
    }
    return this.getActiveGameMode();
  }

  /**
   * Synchronizes all enabled Mod Blocks into `MAT_INFO` and `BUILD_SLOTS`
   * so the Build Mode catalog, 3D preview renderer, vehicle physics, and `.json` blueprints
   * automatically support every mod block!
   */
  public syncToEngineConstants(): void {
    // Reset BUILD_SLOTS back to core base slots before appending active mod slots
    BUILD_SLOTS.length = INITIAL_BASE_SLOT_COUNT;

    let nextSlotNum = INITIAL_BASE_SLOT_COUNT + 1;
    let nextDynamicMatId = 55;

    for (const b of this.blocks) {
      if (b.type === 'voxel') {
        if (!b.matId || b.matId >= 100) {
          b.matId = Math.min(98, nextDynamicMatId++);
        } else if (b.matId >= nextDynamicMatId) {
          nextDynamicMatId = Math.min(98, b.matId + 1);
        }
        const spec: ExtendedMaterialSpec = {
          name: b.name,
          color: parseHexToNumber(b.colorHex),
          mass: Math.max(1, b.massKg),
          buoy: b.behavior === 'ANTI_GRAV_HOVER' ? 45 : 10,
          friction: b.friction ?? 0.95,
          restitution:
            b.behavior === 'SUPER_BOUNCE'
              ? Math.max(1.35, b.restitution ?? 1.45)
              : (b.restitution ?? 0.22),
          yieldEnergy:
            b.durabilityHp ??
            (b.behavior === 'EXPLOSIVE_C4' ? 1800 : 28000),
          explosive: b.behavior === 'EXPLOSIVE_C4',
          emissive:
            b.behavior === 'EMISSIVE_GLOW' ||
            b.behavior === 'ANTI_GRAV_HOVER' ||
            b.behavior === 'SUPER_BOUNCE',
          hoverForce:
            b.behavior === 'ANTI_GRAV_HOVER' ? (b.hoverForce ?? 32) : 0,
          bounceMultiplier:
            b.behavior === 'SUPER_BOUNCE' ? (b.bounceMultiplier ?? 2.3) : 1.0,
        };
        (MAT_INFO as Record<number, ExtendedMaterialSpec>)[b.matId] = spec;

        if (b.enabled) {
          const behaviorTag =
            b.behavior === 'ANTI_GRAV_HOVER'
              ? 'Anti-Grav Lift'
              : b.behavior === 'SUPER_BOUNCE'
                ? '2.3x Bounce Pad'
                : b.behavior === 'EXPLOSIVE_C4'
                  ? 'Explosive Core'
                  : b.behavior === 'EMISSIVE_GLOW'
                    ? 'Radiant Neon'
                    : 'Mod Armor';
          const slotItem: BuildSlotItem = {
            slot: nextSlotNum++,
            key: '',
            type: 'voxel',
            category: b.category,
            mat: b.matId,
            name: `★ ${b.name}`,
            tag: `[MOD] ${behaviorTag} · ${b.massKg}kg`,
            color: b.colorHex,
            massKg: b.massKg,
            powerCores: b.powerCores || 0,
          };
          BUILD_SLOTS.push(slotItem);
        }
      } else if (b.type === 'module' && b.moduleKind && b.enabled) {
        const defaultConfig: ModuleTuningConfig = {
          strength: b.strengthMult ?? 1.8,
          stiffness: b.stiffnessMult ?? 1.2,
          damping: b.dampingMult ?? 1.0,
          accentHex: b.colorHex,
        };
        if (b.posKey) defaultConfig.posKey = b.posKey;
        if (b.negKey) defaultConfig.negKey = b.negKey;

        const slotItem: BuildSlotItem = {
          slot: nextSlotNum++,
          key: '',
          type: 'module',
          category: b.category,
          kind: b.moduleKind,
          name: `★ ${b.name}`,
          tag: `[MOD ${(b.strengthMult ?? 1.8).toFixed(1)}x] · ${b.massKg}kg`,
          color: b.colorHex,
          massKg: b.massKg,
          powerCores: b.powerCores ?? 1,
          defaultConfig,
        };
        BUILD_SLOTS.push(slotItem);
      }
    }
  }

  public toggleModBlock(id: string): void {
    const found = this.blocks.find((b) => b.id === id);
    if (found) {
      found.enabled = !found.enabled;
      this.syncToEngineConstants();
      this.saveToStorage();
    }
  }

  public addCustomModBlock(
    partial: Omit<ModBlockDefinition, 'id' | 'enabled'>,
  ): ModBlockDefinition {
    const usedMatIds = this.blocks
      .map((b) => b.matId || 0)
      .filter((n) => n >= 50 && n < 99);
    const nextMatId = Math.min(
      98,
      usedMatIds.length > 0 ? Math.max(...usedMatIds) + 1 : 55,
    );

    const created: ModBlockDefinition = {
      ...partial,
      id: `custom_blk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      enabled: true,
      isBuiltIn: false,
      matId: partial.type === 'voxel' ? nextMatId : undefined,
    };
    this.blocks.push(created);
    this.syncToEngineConstants();
    this.saveToStorage();
    return created;
  }

  public deleteCustomModBlock(id: string): void {
    this.blocks = this.blocks.filter((b) => b.id !== id || b.isBuiltIn);
    this.syncToEngineConstants();
    this.saveToStorage();
  }

  public addCustomGameMode(
    partial: Omit<GameModeDefinition, 'id' | 'isBuiltIn'>,
  ): GameModeDefinition {
    const created: GameModeDefinition = {
      ...partial,
      id: `custom_mode_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      isBuiltIn: false,
    };
    this.gameModes.push(created);
    this.activeGameModeId = created.id;
    this.saveToStorage();
    this.updateCheckpointVisuals();
    return created;
  }

  public deleteCustomGameMode(id: string): void {
    this.gameModes = this.gameModes.filter((m) => m.id !== id || m.isBuiltIn);
    if (!this.gameModes.some((m) => m.id === this.activeGameModeId)) {
      this.activeGameModeId = 'SANDBOX_FREEPLAY';
    }
    this.saveToStorage();
    this.updateCheckpointVisuals();
  }

  public exportModPackJson(packName = 'Custom Mod Pack'): string {
    const pack: SerializedModPack = {
      version: 1,
      packName: packName.trim() || 'Custom Mod Pack',
      createdAt: new Date().toLocaleDateString(),
      activeGameModeId: this.activeGameModeId,
      customBlocks: this.blocks.filter((b) => !b.isBuiltIn),
      customGameModes: this.gameModes.filter((m) => !m.isBuiltIn),
    };
    return JSON.stringify(pack);
  }

  public importModPackJson(jsonStr: string): {
    ok: boolean;
    message: string;
  } {
    try {
      const parsed = JSON.parse(jsonStr.trim()) as Partial<SerializedModPack>;
      if (
        !parsed ||
        (!Array.isArray(parsed.customBlocks) &&
          !Array.isArray(parsed.customGameModes))
      ) {
        return {
          ok: false,
          message: 'Invalid Mod Pack .json format.',
        };
      }
      let addedBlocks = 0;
      let addedModes = 0;
      if (Array.isArray(parsed.customBlocks)) {
        for (const cb of parsed.customBlocks) {
          if (cb && cb.name && (cb.type === 'voxel' || cb.type === 'module')) {
            const exists = this.blocks.some((b) => b.name === cb.name);
            if (!exists) {
              this.addCustomModBlock({
                name: cb.name,
                type: cb.type,
                category: cb.category || 'CHASSIS',
                colorHex: cb.colorHex || '#38bdf8',
                massKg: Number(cb.massKg) || 10,
                powerCores: Number(cb.powerCores) || 0,
                behavior: cb.behavior || 'STANDARD_ARMOR',
                durabilityHp: cb.durabilityHp ?? 25000,
                hoverForce: cb.hoverForce,
                bounceMultiplier: cb.bounceMultiplier,
                moduleKind: cb.moduleKind,
                strengthMult: cb.strengthMult,
                stiffnessMult: cb.stiffnessMult,
                dampingMult: cb.dampingMult,
                posKey: cb.posKey,
                negKey: cb.negKey,
              });
              addedBlocks++;
            }
          }
        }
      }
      if (Array.isArray(parsed.customGameModes)) {
        for (const cm of parsed.customGameModes) {
          if (cm && cm.name) {
            const exists = this.gameModes.some((m) => m.name === cm.name);
            if (!exists) {
              const mode = this.addCustomGameMode({
                name: cm.name,
                description: cm.description || 'Imported custom game mode',
                badgeColor: cm.badgeColor || '#38bdf8',
                gravityMult: Number(cm.gravityMult) || 1.0,
                enginePowerMult: Number(cm.enginePowerMult) || 1.0,
                thrusterPowerMult: Number(cm.thrusterPowerMult) || 1.0,
                explosionMult: Number(cm.explosionMult) || 1.0,
                indestructibleVehicles: Boolean(cm.indestructibleVehicles),
                enableCheckpointRace: Boolean(cm.enableCheckpointRace),
                enableDemolitionScore: Boolean(cm.enableDemolitionScore),
              });
              this.activeGameModeId = mode.id;
              addedModes++;
            }
          }
        }
      }
      if (
        parsed.activeGameModeId &&
        this.gameModes.some((m) => m.id === parsed.activeGameModeId)
      ) {
        this.activeGameModeId = parsed.activeGameModeId;
      }
      this.syncToEngineConstants();
      this.saveToStorage();
      this.updateCheckpointVisuals();
      return {
        ok: true,
        message: `Imported Mod Pack "${parsed.packName || 'Custom'}" (+${addedBlocks} blocks, +${addedModes} game modes)!`,
      };
    } catch {
      return {
        ok: false,
        message: 'Could not parse Mod Pack .json string.',
      };
    }
  }

  public attachScene(scene: THREE.Scene): void {
    this.attachedScene = scene;
    if (this.checkpointGroup) scene.remove(this.checkpointGroup);
    if (this.teleportBeaconGroup) scene.remove(this.teleportBeaconGroup);
    if (this.ctfVisualGroup) scene.remove(this.ctfVisualGroup);
    if (this.survivalEnemyGroup) scene.remove(this.survivalEnemyGroup);
    if (this.buildBattleGroup) scene.remove(this.buildBattleGroup);

    this.checkpointGroup = new THREE.Group();
    this.teleportBeaconGroup = new THREE.Group();
    this.ctfVisualGroup = new THREE.Group();
    this.survivalEnemyGroup = new THREE.Group();
    this.buildBattleGroup = new THREE.Group();
    this.checkpointMeshes = [];
    this.checkpointBeaconMeshes = [];
    this.lastTeleportSig = '';

    const torusGeo = new THREE.TorusGeometry(4.2, 0.34, 10, 28);
    const beaconGeo = new THREE.CylinderGeometry(0.18, 0.18, 22, 8);
    const pillarGeo = new THREE.BoxGeometry(0.7, 6.5, 0.7);
    const bannerGeo = new THREE.BoxGeometry(9.2, 1.1, 0.7);

    for (let i = 0; i < DEFAULT_CHECKPOINT_COURSE.length; i++) {
      const cp = DEFAULT_CHECKPOINT_COURSE[i];
      const isStart = i === 0;
      const isFinish = i === DEFAULT_CHECKPOINT_COURSE.length - 1;
      const mat = new THREE.MeshStandardMaterial({
        color: isStart ? 0x4ade80 : isFinish ? 0xf43f5e : 0x38bdf8,
        emissive: isStart ? 0x4ade80 : isFinish ? 0xf43f5e : 0x38bdf8,
        emissiveIntensity: 0.75,
        roughness: 0.2,
      });
      const ring = new THREE.Mesh(torusGeo, mat);
      ring.position.set(cp.x, cp.y, cp.z);
      this.checkpointGroup.add(ring);
      this.checkpointMeshes.push(ring);

      // Add Start Line and Finish Line overhead gantry arches
      if (isStart || isFinish) {
        const archMat = new THREE.MeshStandardMaterial({
          color: isStart ? 0x4ade80 : 0xfacc15,
          emissive: isStart ? 0x22c55e : 0xf43f5e,
          emissiveIntensity: 0.55,
          roughness: 0.3,
        });
        const leftPillar = new THREE.Mesh(pillarGeo, archMat);
        leftPillar.position.set(cp.x - 4.4, cp.y + 1.2, cp.z);
        const rightPillar = new THREE.Mesh(pillarGeo, archMat);
        rightPillar.position.set(cp.x + 4.4, cp.y + 1.2, cp.z);
        const topBanner = new THREE.Mesh(bannerGeo, archMat);
        topBanner.position.set(cp.x, cp.y + 4.8, cp.z);
        this.checkpointGroup.add(leftPillar, rightPillar, topBanner);
      }

      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.28,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(cp.x, cp.y + 10, cp.z);
      this.checkpointGroup.add(beacon);
      this.checkpointBeaconMeshes.push(beacon);
    }

    scene.add(this.checkpointGroup);
    scene.add(this.teleportBeaconGroup);
    scene.add(this.ctfVisualGroup);
    scene.add(this.survivalEnemyGroup);
    scene.add(this.buildBattleGroup);
    this.updateCheckpointVisuals();
  }

  /**
   * Renders 3D Fast-Travel Teleport Beacons across the sandbox world
   */
  public syncTeleportBeacons3D(nodes: TeleportNode[], timeSec = 0): void {
    if (!this.teleportBeaconGroup) return;
    const sig = nodes.map((n) => `${n.id}:${n.x},${n.y},${n.z},${n.color}`).join('|');
    if (sig !== this.lastTeleportSig) {
      this.lastTeleportSig = sig;
      while (this.teleportBeaconGroup.children.length > 0) {
        this.teleportBeaconGroup.remove(this.teleportBeaconGroup.children[0]);
      }
      const padGeo = new THREE.CylinderGeometry(1.65, 1.85, 0.35, 16);
      const ringGeo = new THREE.TorusGeometry(1.45, 0.12, 8, 24);
      const beamGeo = new THREE.CylinderGeometry(0.22, 0.45, 28, 10);

      for (const n of nodes) {
        const col = parseHexToNumber(n.color);
        const nodeGrp = new THREE.Group();
        nodeGrp.position.set(n.x, n.y - 0.5, n.z);

        const padMat = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          emissive: col,
          emissiveIntensity: 0.45,
          roughness: 0.3,
        });
        const pad = new THREE.Mesh(padGeo, padMat);
        nodeGrp.add(pad);

        const ringMat = new THREE.MeshBasicMaterial({ color: col });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI * 0.5;
        ring.position.y = 0.25;
        ring.name = 'tp_ring';
        nodeGrp.add(ring);

        const beamMat = new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = 14.0;
        nodeGrp.add(beam);

        this.teleportBeaconGroup.add(nodeGrp);
      }
    }

    // Subtle pulse animation on beacon rings
    const pulse = 1.0 + Math.sin(timeSec * 3.5) * 0.08;
    for (const child of this.teleportBeaconGroup.children) {
      const ring = child.getObjectByName('tp_ring');
      if (ring) {
        ring.scale.setScalar(pulse);
      }
    }
  }

  /**
   * Renders 3D Capture the Flag Bases & Flags when CTF mode is active
   */
  public syncCtfVisuals3D(
    ctfState: CtfMatchState | null,
    playerPos: THREE.Vector3,
  ): void {
    if (!this.ctfVisualGroup) return;
    const isCtf = this.activeGameModeId === 'CAPTURE_THE_FLAG' && ctfState !== null;
    this.ctfVisualGroup.visible = isCtf;
    if (!isCtf || !ctfState) return;

    if (this.ctfVisualGroup.children.length === 0) {
      const basePadGeo = new THREE.CylinderGeometry(5.5, 6.0, 0.45, 24);
      const poleGeo = new THREE.CylinderGeometry(0.14, 0.14, 7.5, 8);
      const clothGeo = new THREE.BoxGeometry(2.4, 1.4, 0.16);

      // Blue Base & Flag
      const bluePad = new THREE.Mesh(
        basePadGeo,
        new THREE.MeshStandardMaterial({
          color: 0x0284c7,
          emissive: 0x38bdf8,
          emissiveIntensity: 0.45,
        }),
      );
      bluePad.name = 'blue_pad';
      const blueFlagGrp = new THREE.Group();
      blueFlagGrp.name = 'blue_flag';
      const bluePole = new THREE.Mesh(
        poleGeo,
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0 }),
      );
      bluePole.position.y = 3.75;
      const blueCloth = new THREE.Mesh(
        clothGeo,
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x38bdf8,
          emissiveIntensity: 0.7,
        }),
      );
      blueCloth.position.set(1.2, 6.6, 0);
      blueFlagGrp.add(bluePole, blueCloth);

      // Red Base & Flag
      const redPad = new THREE.Mesh(
        basePadGeo,
        new THREE.MeshStandardMaterial({
          color: 0xe11d48,
          emissive: 0xf43f5e,
          emissiveIntensity: 0.45,
        }),
      );
      redPad.name = 'red_pad';
      const redFlagGrp = new THREE.Group();
      redFlagGrp.name = 'red_flag';
      const redPole = new THREE.Mesh(
        poleGeo,
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0 }),
      );
      redPole.position.y = 3.75;
      const redCloth = new THREE.Mesh(
        clothGeo,
        new THREE.MeshStandardMaterial({
          color: 0xf43f5e,
          emissive: 0xf43f5e,
          emissiveIntensity: 0.7,
        }),
      );
      redCloth.position.set(1.2, 6.6, 0);
      redFlagGrp.add(redPole, redCloth);

      this.ctfVisualGroup.add(bluePad, blueFlagGrp, redPad, redFlagGrp);
    }

    const bluePad = this.ctfVisualGroup.getObjectByName('blue_pad');
    const blueFlag = this.ctfVisualGroup.getObjectByName('blue_flag');
    const redPad = this.ctfVisualGroup.getObjectByName('red_pad');
    const redFlag = this.ctfVisualGroup.getObjectByName('red_flag');

    if (bluePad) {
      bluePad.position.set(
        ctfState.blueBasePos.x,
        ctfState.blueBasePos.y - 0.6,
        ctfState.blueBasePos.z,
      );
    }
    if (redPad) {
      redPad.position.set(
        ctfState.redBasePos.x,
        ctfState.redBasePos.y - 0.6,
        ctfState.redBasePos.z,
      );
    }
    if (blueFlag) {
      if (ctfState.carrierOfBlueFlag === 'LOCAL_PLAYER') {
        blueFlag.position.set(playerPos.x, playerPos.y + 1.8, playerPos.z);
      } else {
        blueFlag.position.set(
          ctfState.blueBasePos.x,
          ctfState.blueBasePos.y - 0.4,
          ctfState.blueBasePos.z,
        );
      }
    }
    if (redFlag) {
      if (ctfState.carrierOfRedFlag === 'LOCAL_PLAYER') {
        redFlag.position.set(playerPos.x, playerPos.y + 1.8, playerPos.z);
      } else {
        redFlag.position.set(
          ctfState.redBasePos.x,
          ctfState.redBasePos.y - 0.4,
          ctfState.redBasePos.z,
        );
      }
    }
  }

  /**
   * Renders 3D Survival Wave Voxel Cube Enemies
   */
  public syncSurvivalEnemies3D(survivalState: SurvivalWavesState | null): void {
    if (!this.survivalEnemyGroup) return;
    const active =
      this.activeGameModeId === 'SURVIVAL_WAVES' && survivalState !== null;
    this.survivalEnemyGroup.visible = active;
    if (!active || !survivalState) return;

    while (
      this.survivalEnemyGroup.children.length > survivalState.enemies.length
    ) {
      this.survivalEnemyGroup.remove(
        this.survivalEnemyGroup.children[
          this.survivalEnemyGroup.children.length - 1
        ],
      );
    }

    const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < survivalState.enemies.length; i++) {
      const e = survivalState.enemies[i];
      let mesh = this.survivalEnemyGroup.children[i] as THREE.Mesh | undefined;
      if (!mesh) {
        const mat = new THREE.MeshStandardMaterial({
          color: e.colorHex,
          emissive: e.colorHex,
          emissiveIntensity: 0.45,
          roughness: 0.25,
        });
        mesh = new THREE.Mesh(unitBoxGeo, mat);
        this.survivalEnemyGroup.add(mesh);
      } else {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(e.colorHex);
        mat.emissive.setHex(e.colorHex);
      }
      mesh.position.set(e.x, e.y, e.z);
      mesh.scale.setScalar(e.sizeMeters);
      mesh.rotation.y = e.hopPhase * 0.4;
    }
  }

  /**
   * Renders 3D Build Battle Arena Contenders during ARENA_COMBAT phase
   */
  public syncBuildBattleContenders3D(battleState: BuildBattleState | null): void {
    if (!this.buildBattleGroup) return;
    const active =
      this.activeGameModeId === 'BUILD_BATTLE' &&
      battleState !== null &&
      battleState.phase !== 'BUILD';
    this.buildBattleGroup.visible = active;
    if (!active || !battleState) return;

    const aiContenders = battleState.contenders.filter((c) => !c.isPlayer && c.alive);
    while (this.buildBattleGroup.children.length > aiContenders.length) {
      this.buildBattleGroup.remove(
        this.buildBattleGroup.children[this.buildBattleGroup.children.length - 1],
      );
    }

    const hullGeo = new THREE.BoxGeometry(2.6, 1.2, 3.8);
    for (let i = 0; i < aiContenders.length; i++) {
      const c = aiContenders[i];
      let mesh = this.buildBattleGroup.children[i] as THREE.Mesh | undefined;
      const col = parseHexToNumber(c.color);
      if (!mesh) {
        mesh = new THREE.Mesh(
          hullGeo,
          new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: 0.35,
            roughness: 0.3,
          }),
        );
        this.buildBattleGroup.add(mesh);
      } else {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(col);
        mat.emissive.setHex(col);
      }
      mesh.position.set(c.x, c.y, c.z);
      mesh.rotation.y = Math.atan2(c.vx, c.vz);
    }
  }

  public updateCheckpointVisuals(): void {
    if (!this.checkpointGroup) return;
    const mode = this.getActiveGameMode();
    this.checkpointGroup.visible = mode.enableCheckpointRace;
    if (!mode.enableCheckpointRace) return;

    for (let i = 0; i < this.checkpointMeshes.length; i++) {
      const ring = this.checkpointMeshes[i];
      const beacon = this.checkpointBeaconMeshes[i];
      const isCurrent = i === this.currentCheckpointIndex;
      const mat = ring.material as THREE.MeshStandardMaterial;
      if (isCurrent) {
        mat.color.setHex(0xfacc15);
        mat.emissive.setHex(0xfacc15);
        mat.emissiveIntensity = 1.35;
        ring.scale.setScalar(1.12);
        beacon.visible = true;
      } else {
        const isStart = i === 0;
        const isFinish = i === DEFAULT_CHECKPOINT_COURSE.length - 1;
        const baseHex = isStart ? 0x4ade80 : isFinish ? 0xf43f5e : 0x38bdf8;
        mat.color.setHex(baseHex);
        mat.emissive.setHex(baseHex);
        mat.emissiveIntensity = 0.35;
        ring.scale.setScalar(0.88);
        beacon.visible = false;
      }
    }
  }

  /**
   * Called each frame in the simulation loop to update active Game Mode timers,
   * checkpoint ring crossings, and demolition scores.
   */
  public tickGameMode(
    dt: number,
    vehiclePos: THREE.Vector3,
    vehicleVel: THREE.Vector3,
    inBuildMode: boolean,
    onCheckpointCrossed?: (gateIdx: number, totalGates: number, lapCompleted: boolean) => void,
  ): void {
    const mode = this.getActiveGameMode();
    if (!mode.enableCheckpointRace || inBuildMode) return;

    this.raceTimerSec += dt;
    const activeRing = this.checkpointMeshes[this.currentCheckpointIndex];
    if (activeRing) {
      activeRing.rotation.y += dt * 1.6;
    }

    const cp = DEFAULT_CHECKPOINT_COURSE[this.currentCheckpointIndex];
    if (!cp) return;

    const dx = vehiclePos.x - cp.x;
    const dy = vehiclePos.y - cp.y;
    const dz = vehiclePos.z - cp.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= cp.radius && Math.abs(dy) <= 6.5) {
      // Give a small nitro speed surge on crossing a checkpoint gate
      const spd = vehicleVel.length();
      if (spd > 1.0) {
        vehicleVel.multiplyScalar(1.12);
      }
      const nextIdx = this.currentCheckpointIndex + 1;
      if (nextIdx >= DEFAULT_CHECKPOINT_COURSE.length) {
        this.lastLapSec = Number(this.raceTimerSec.toFixed(2));
        if (this.bestLapSec === null || this.lastLapSec < this.bestLapSec) {
          this.bestLapSec = this.lastLapSec;
          saveStoredBestTimeTrialSec(this.bestLapSec);
        }
        this.completedLaps++;
        this.currentCheckpointIndex = 0;
        this.raceTimerSec = 0;
        this.updateCheckpointVisuals();
        onCheckpointCrossed?.(DEFAULT_CHECKPOINT_COURSE.length, DEFAULT_CHECKPOINT_COURSE.length, true);
      } else {
        this.currentCheckpointIndex = nextIdx;
        this.updateCheckpointVisuals();
        onCheckpointCrossed?.(nextIdx, DEFAULT_CHECKPOINT_COURSE.length, false);
      }
    }
  }

  private saveToStorage(): void {
    try {
      const data: SerializedModPack = {
        version: 1,
        packName: 'Local Internal Mods',
        createdAt: new Date().toISOString(),
        activeGameModeId: this.activeGameModeId,
        customBlocks: this.blocks.filter((b) => !b.isBuiltIn),
        customGameModes: this.gameModes.filter((m) => !m.isBuiltIn),
      };
      localStorage.setItem(STORAGE_KEY_MOD_PACK, JSON.stringify(data));
    } catch {
      // Ignore quota errors
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MOD_PACK);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SerializedModPack>;
      if (Array.isArray(parsed.customBlocks)) {
        for (const cb of parsed.customBlocks) {
          if (cb && cb.id && cb.name) {
            this.blocks.push({ ...cb, isBuiltIn: false });
          }
        }
      }
      if (Array.isArray(parsed.customGameModes)) {
        for (const cm of parsed.customGameModes) {
          if (cm && cm.id && cm.name) {
            this.gameModes.push({ ...cm, isBuiltIn: false });
          }
        }
      }
      if (
        parsed.activeGameModeId &&
        this.gameModes.some((m) => m.id === parsed.activeGameModeId)
      ) {
        this.activeGameModeId = parsed.activeGameModeId;
      }
    } catch {
      // Ignore storage parse errors
    }
  }
}

export const ModRegistry = new InternalModRegistry();
