import * as THREE from 'three';
import {
  MICRO_VOXEL_SIZE,
  createMicroVoxelGrid,
  fillMicroBox,
  fillMicroEllipsoid,
  setMicroVoxel,
  getMicroVoxel,
  countSolidMicroVoxels,
  buildGreedyMicroVoxelGeometry,
  type MicroVoxelGrid,
} from './microVoxelMesh.ts';

/**
 * 1px (0.0625m) Micro-Voxel Functional Blocks with Copy-on-Write (CoW) Destruction.
 *
 * Architecture:
 * - Every intact module shares ONE cached static `BufferGeometry` + shared vertex-colored material
 *   (0 bytes of per-instance voxel RAM, 1 draw call per module body, Build Mode ghost compatible!).
 * - When a module takes blast/impact/tool damage, we lazily clone its compact `Uint8Array`
 *   (~512–2,016 bytes) and carve a 3D crater at 1px (0.0625m) resolution (or 2px coarse steps on
 *   Pentium/Potato mode), detach disconnected micro-voxel shards, spawn 1px colored debris chips,
 *   and greedy-remesh ONLY that damaged module (< 0.1ms).
 * - Repairing or rebuilding disposes the temporary damaged geometry and restores the shared intact
 *   geometry with zero GPU memory leaks.
 */

export type MicroVoxelBlockKind =
  | 'V8_ENGINE'
  | 'ENGINE_BULLDAWG'
  | 'ENGINE_DRAGON'
  | 'HEADLIGHT'
  | 'PLASMA_CANNON'
  | 'THRUSTER'
  | 'THRUSTER_MINI'
  | 'THRUSTER_ROCKET'
  | 'JET_RAW'
  | 'JET_GIMBAL'
  | 'COCKPIT'
  | 'SEAT_KART'
  | 'SEAT_MOTO'
  | 'SEAT_OPERATOR'
  | 'SEAT_ARMORED'
  | 'SEAT_DIVING'
  | 'SEAT_SPACE'
  | 'SEAT_SHIP_WHEEL'
  // Part 3: Remaining mechanical, aero, marine, utility, sensor & weapon modules
  | 'AERO_WING'
  | 'WING_STANDARD'
  | 'SPOILER'
  | 'TAILFIN'
  | 'TAILFIN_POWERED'
  | 'AERO_BLADE'
  | 'BOAT_PROP'
  | 'BOAT_OUTBOARD'
  | 'PROP_AERO'
  | 'VTOL_ROTOR'
  | 'GYRO'
  | 'GYRO_REACTION'
  | 'SUSPENSION'
  | 'STEERING_HINGE'
  | 'PISTON'
  | 'GRAPPLING_WINCH'
  | 'SKI_SLIDER'
  | 'HINGE_LARGE'
  | 'HINGE_TRAILER'
  | 'JOINT_MECH'
  | 'SERVO_SPIN'
  | 'SERVO_SMALL'
  | 'DETACHABLE_BLOCK'
  | 'PONTOON_LARGE'
  | 'BCD_TANK'
  | 'WEIGHT_BLOCK'
  | 'WEAPON_MINIGUN'
  | 'WEAPON_ROCKET'
  | 'WEAPON_BOMB_BAY'
  | 'WEAPON_MELEE'
  | 'SENSOR_DISTANCE'
  | 'SENSOR_SPEED'
  | 'SENSOR_ALTIMETER'
  | 'SENSOR_ANGLE'
  | 'SENSOR_POSITION'
  | 'SENSOR_IMU_TILT'
  | 'SENSOR_SPEEDO'
  | 'LOGIC_GATE'
  | 'RADIO_TRX'
  | 'TURRET_RING'
  | 'MAGNET_COUPLER'
  | 'TANK_TREAD'
  | 'PARACHUTE_AIRBRAKE'
  | 'OUTRIGGER_JACK'
  | 'IMPULSE_BUMPER'
  | 'SMOKE_FLARE';

const DESTRUCTIBLE_KINDS = new Set<string>([
  'V8_ENGINE',
  'ENGINE_BULLDAWG',
  'ENGINE_DRAGON',
  'HEADLIGHT',
  'PLASMA_CANNON',
  'THRUSTER',
  'THRUSTER_MINI',
  'THRUSTER_ROCKET',
  'JET_RAW',
  'JET_GIMBAL',
  'COCKPIT',
  'SEAT_KART',
  'SEAT_MOTO',
  'SEAT_OPERATOR',
  'SEAT_ARMORED',
  'SEAT_DIVING',
  'SEAT_SPACE',
  'SEAT_SHIP_WHEEL',
  // Part 3 modules
  'AERO_WING',
  'WING_STANDARD',
  'SPOILER',
  'TAILFIN',
  'TAILFIN_POWERED',
  'AERO_BLADE',
  'BOAT_PROP',
  'BOAT_OUTBOARD',
  'PROP_AERO',
  'VTOL_ROTOR',
  'GYRO',
  'GYRO_REACTION',
  'SUSPENSION',
  'STEERING_HINGE',
  'PISTON',
  'GRAPPLING_WINCH',
  'SKI_SLIDER',
  'HINGE_LARGE',
  'HINGE_TRAILER',
  'JOINT_MECH',
  'SERVO_SPIN',
  'SERVO_SMALL',
  'DETACHABLE_BLOCK',
  'PONTOON_LARGE',
  'BCD_TANK',
  'WEIGHT_BLOCK',
  'WEAPON_MINIGUN',
  'WEAPON_ROCKET',
  'WEAPON_BOMB_BAY',
  'WEAPON_MELEE',
  'SENSOR_DISTANCE',
  'SENSOR_SPEED',
  'SENSOR_ALTIMETER',
  'SENSOR_ANGLE',
  'SENSOR_POSITION',
  'SENSOR_IMU_TILT',
  'SENSOR_SPEEDO',
  'LOGIC_GATE',
  'RADIO_TRX',
  'TURRET_RING',
  'MAGNET_COUPLER',
  'TANK_TREAD',
  'PARACHUTE_AIRBRAKE',
  'OUTRIGGER_JACK',
  'IMPULSE_BUMPER',
  'SMOKE_FLARE',
]);

export function isMicroVoxelDestructibleKind(kind: string): kind is MicroVoxelBlockKind {
  return DESTRUCTIBLE_KINDS.has(kind);
}

export interface MicroVoxelBlockTemplate {
  readonly kind: MicroVoxelBlockKind;
  readonly grid: MicroVoxelGrid;
  readonly palette: Record<number, number>;
  readonly voxelSize: number;
  readonly pivot: [number, number, number];
  readonly totalVoxels: number;
  readonly intactGeometry: THREE.BufferGeometry;
  /** Fraction of remaining voxels below which the module fails completely. */
  readonly destroyThreshold: number;
}

export interface MicroVoxelDamageState {
  readonly kind: MicroVoxelBlockKind;
  readonly template: MicroVoxelBlockTemplate;
  /** Lazily cloned Uint8Array — stays null until the module is actually damaged! */
  grid: MicroVoxelGrid | null;
  remainingVoxels: number;
  readonly totalVoxels: number;
  /** 0..1 structural integrity ratio (scales engine horsepower, weapon fire rate, etc.). */
  integrity: number;
  destroyed: boolean;
  /** Temporary custom BufferGeometry for the chipped mesh (must be disposed on repair/removal). */
  damagedGeometry: THREE.BufferGeometry | null;
}

export interface MicroVoxelChip {
  /** Local offset relative to module pivot in meters. */
  lx: number;
  ly: number;
  lz: number;
  color: number;
}

export interface MicroVoxelCarveResult {
  carvedCount: number;
  detachedCount: number;
  chips: MicroVoxelChip[];
  integrity: number;
  destroyed: boolean;
  geometry: THREE.BufferGeometry | null;
}

export interface MicroVoxelCarveOptions {
  /** Use 2x2x2 macro carve steps on Pentium/low-end presets for ultra-fast chipping. */
  coarseStep?: boolean;
  /** Maximum number of 1px debris chips returned for particle spawning. */
  maxChips?: number;
  /** Optional minimum integrity clamp if caller wants to preview damage without instant removal. */
  allowFullDestroy?: boolean;
}

// ============================================================================
// SHARED VERTEX-COLORED MATERIALS (PBR + GHOST + CHARRED)
// ============================================================================

let _sharedIntactBlockMat: THREE.MeshStandardMaterial | null = null;
let _sharedCharredBlockMat: THREE.MeshStandardMaterial | null = null;
let _sharedGhostBlockMat: THREE.MeshStandardMaterial | null = null;

export function getMicroVoxelBlockMaterial(
  isGhost = false,
  isCharred = false,
): THREE.MeshStandardMaterial {
  if (isGhost) {
    if (!_sharedGhostBlockMat) {
      _sharedGhostBlockMat = new THREE.MeshStandardMaterial({
        color: 0xdbeafe,
        vertexColors: true,
        roughness: 0.45,
        metalness: 0.25,
        transparent: true,
        opacity: 0.46,
        depthWrite: false,
      });
    }
    return _sharedGhostBlockMat;
  }
  if (isCharred) {
    if (!_sharedCharredBlockMat) {
      _sharedCharredBlockMat = new THREE.MeshStandardMaterial({
        color: 0x64686e,
        vertexColors: true,
        roughness: 0.88,
        metalness: 0.22,
      });
    }
    return _sharedCharredBlockMat;
  }
  if (!_sharedIntactBlockMat) {
    _sharedIntactBlockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.46,
      metalness: 0.42,
    });
  }
  return _sharedIntactBlockMat;
}

// ============================================================================
// 1PX MICRO-VOXEL BLUEPRINT GENERATORS (WITH LAYERED INTERIORS!)
// ============================================================================

function buildEngineTemplate(
  kind: 'V8_ENGINE' | 'ENGINE_BULLDAWG' | 'ENGINE_DRAGON',
): MicroVoxelBlockTemplate {
  const blockHex =
    kind === 'ENGINE_BULLDAWG'
      ? 0xf97316
      : kind === 'ENGINE_DRAGON'
        ? 0xef4444
        : 0xe11d48;
  const intakeHex = kind === 'ENGINE_DRAGON' ? 0xff6600 : 0x38bdf8;
  const scoopHex = kind === 'ENGINE_DRAGON' ? 0xf59e0b : 0xfacc15;
  const scale =
    kind === 'ENGINE_DRAGON' ? 1.12 : kind === 'ENGINE_BULLDAWG' ? 0.92 : 1.0;

  const palette: Record<number, number> = {
    1: 0x1e293b, // Oil sump / dark steel housing
    2: blockHex, // Cast engine block body
    3: 0x334155, // Cylinder banks / headers base
    4: 0xe2e8f0, // Ribbed aluminum valve covers
    5: 0x94a3b8, // Exhaust manifold pipes
    6: 0xcbd5e1, // Supercharger blower casing
    7: scoopHex, // Air scoop & pulley accents
    8: intakeHex, // Glowing air intake / turbine core
    9: 0x0f172a, // Drive belt & bolts
    10: 0xff6a00, // INNER PISTON / COMBUSTION CORE (exposed when outer block chips!)
    11: 0xfbbf24, // INNER CRANKSHAFT / BRASS BEARINGS (exposed when chipped!)
  };

  // 12 x 12 x 14 micro-voxels (~0.75m x 0.75m x 0.875m at 0.0625m)
  const g = createMicroVoxelGrid(12, 12, 14);

  // 1. Oil sump pan (y = 0..1)
  fillMicroBox(g, 2, 0, 1, 9, 1, 12, 1);

  // 2. Main engine block (y = 2..5)
  fillMicroBox(g, 2, 2, 1, 9, 5, 12, 2);

  // 3. INNER LAYERED CORE: crankshaft & glowing hot pistons inside the block!
  // Invisible when intact (culled by greedy mesher -> 0 extra tris!), revealed when outer voxels chip away!
  fillMicroBox(g, 5, 2, 2, 6, 3, 11, 11); // Crankshaft spine
  for (let z = 3; z <= 10; z += 2) {
    setMicroVoxel(g, 4, 4, z, 10); // Left bank glowing piston
    setMicroVoxel(g, 7, 4, z, 10); // Right bank glowing piston
    setMicroVoxel(g, 5, 4, z, 1);  // Steel sleeve divider
    setMicroVoxel(g, 6, 4, z, 1);
  }

  // 4. Stepped V-8 Cylinder Banks & Ribbed Chrome Valve Covers (left x=1..3, right x=8..10)
  fillMicroBox(g, 1, 4, 2, 3, 6, 11, 3);
  fillMicroBox(g, 8, 4, 2, 10, 6, 11, 3);
  // Valve cover rails with cooling fins
  fillMicroBox(g, 1, 7, 2, 3, 7, 11, 4);
  fillMicroBox(g, 8, 7, 2, 10, 7, 11, 4);
  for (let z = 3; z <= 10; z += 2) {
    setMicroVoxel(g, 2, 8, z, 4);
    setMicroVoxel(g, 9, 8, z, 4);
  }

  // 5. Quad Exhaust Header Pipes on each flank (x = 0 and x = 11)
  for (let z = 2; z <= 11; z += 3) {
    fillMicroBox(g, 0, 3, z, 0, 5, z, 5);
    fillMicroBox(g, 11, 3, z, 11, 5, z, 5);
  }
  // Collector rails running back along bottom edge
  fillMicroBox(g, 0, 3, 1, 0, 3, 11, 5);
  fillMicroBox(g, 11, 3, 1, 11, 3, 11, 5);

  // 6. Central Supercharger Blower (y = 6..8, x = 4..7, z = 3..10) + side fuel rails
  fillMicroBox(g, 4, 6, 3, 7, 8, 10, 6);
  // Chrome fuel rail studs flanking blower
  for (let z = 3; z <= 10; z += 2) {
    setMicroVoxel(g, 3, 8, z, 7);
    setMicroVoxel(g, 8, 8, z, 7);
  }
  // Inner blower rotor (visible if top scoop is blown off!)
  fillMicroBox(g, 5, 7, 4, 6, 7, 9, 11);

  // 7. Top Air Scoop with sculpted twin butterfly intake valves (y = 9..11, x = 4..7, z = 5..11)
  fillMicroBox(g, 4, 9, 5, 7, 10, 11, 7);
  fillMicroBox(g, 5, 11, 6, 6, 11, 10, 7);
  // Twin recessed glowing intake throats separated by chrome divider
  setMicroVoxel(g, 4, 10, 11, 6);
  setMicroVoxel(g, 7, 10, 11, 6);
  fillMicroBox(g, 5, 9, 11, 6, 10, 11, 8);
  // Rear distributor cap & oil filter canister
  fillMicroBox(g, 5, 6, 1, 6, 7, 2, 1);
  setMicroVoxel(g, 5, 8, 1, 2);
  setMicroVoxel(g, 6, 8, 1, 2);

  // 8. Front Belt Drive & Yellow Crank/Blower Pulleys + tensioner (z = 13)
  fillMicroBox(g, 5, 2, 13, 6, 7, 13, 9); // Vertical serpentine belt
  fillMicroBox(g, 4, 2, 13, 7, 4, 13, 7); // Lower crank pulley
  setMicroVoxel(g, 5, 3, 13, 1);
  setMicroVoxel(g, 6, 3, 13, 1);
  fillMicroBox(g, 5, 7, 13, 6, 8, 13, 7); // Upper supercharger pulley
  setMicroVoxel(g, 4, 5, 13, 4); // Chrome idler tensioner pulley

  // Extra twin rear exhaust stacks on Dragon engine
  if (kind === 'ENGINE_DRAGON') {
    fillMicroBox(g, 2, 8, 1, 3, 10, 2, 5);
    fillMicroBox(g, 8, 8, 1, 9, 10, 2, 5);
    setMicroVoxel(g, 2, 10, 1, 8);
    setMicroVoxel(g, 9, 10, 1, 8);
  }

  const voxelSize = MICRO_VOXEL_SIZE * scale;
  const pivot: [number, number, number] = [6, 4.5, 7];
  const intactGeometry = buildGreedyMicroVoxelGeometry(g, palette, {
    voxelSize,
    pivot,
    bakeAO: true,
    bakeFaceShade: true,
  });
  intactGeometry.userData.isSharedPrimitive = true;

  return {
    kind,
    grid: g,
    palette,
    voxelSize,
    pivot,
    totalVoxels: countSolidMicroVoxels(g),
    intactGeometry,
    destroyThreshold: 0.3,
  };
}

function buildHeadlightTemplate(): MicroVoxelBlockTemplate {
  const palette: Record<number, number> = {
    1: 0x1e293b, // Mounting bracket
    2: 0x334155, // Lamp casing
    3: 0xfacc15, // Yellow rim bezel
    4: 0xffedd5, // Bright warm lens
    5: 0x64748b, // Inner silver parabolic reflector
  };
  const g = createMicroVoxelGrid(8, 8, 8);
  // Bracket base
  fillMicroBox(g, 2, 0, 2, 5, 1, 5, 1);
  // Rounded lamp housing (y = 2..7)
  fillMicroEllipsoid(g, 4, 4.5, 3.2, 3.3, 3.1, 2.8, 2);
  // Inner reflector cavity
  fillMicroBox(g, 3, 3, 3, 4, 5, 4, 5);
  // Front bezel ring & warm lens
  fillMicroBox(g, 2, 2, 6, 5, 6, 6, 3);
  fillMicroBox(g, 2, 3, 7, 5, 5, 7, 4);
  fillMicroBox(g, 3, 2, 7, 4, 6, 7, 4);

  const pivot: [number, number, number] = [4, 4, 4];
  const intactGeometry = buildGreedyMicroVoxelGeometry(g, palette, {
    voxelSize: MICRO_VOXEL_SIZE,
    pivot,
    bakeAO: true,
    bakeFaceShade: true,
  });
  intactGeometry.userData.isSharedPrimitive = true;

  return {
    kind: 'HEADLIGHT',
    grid: g,
    palette,
    voxelSize: MICRO_VOXEL_SIZE,
    pivot,
    totalVoxels: countSolidMicroVoxels(g),
    intactGeometry,
    destroyThreshold: 0.25,
  };
}

function buildThrusterTemplate(
  kind: 'THRUSTER' | 'THRUSTER_MINI' | 'THRUSTER_ROCKET' | 'JET_RAW' | 'JET_GIMBAL',
): MicroVoxelBlockTemplate {
  const isMini = kind === 'THRUSTER_MINI';
  const isRaw = kind === 'JET_RAW';
  const isRocket = kind === 'THRUSTER_ROCKET';
  const isGimbal = kind === 'JET_GIMBAL';
  const scale = isMini ? 0.68 : isRaw ? 1.2 : isRocket ? 1.12 : 1.0;
  const casingHex = isRaw
    ? 0xf97316
    : isRocket
      ? 0xdc2626
      : isGimbal
        ? 0x0d9488
        : 0x0284c7;

  const palette: Record<number, number> = {
    1: casingHex, // Main outer casing
    2: 0x1e293b,  // Dark heat-shield collars & intake cone
    3: 0x334155,  // Nozzle bell metal
    4: 0xff6600,  // Inner glowing rocket throat
    5: 0xfacc15,  // Deep reactor chamber core (exposed when outer shell chips!)
    6: 0x94a3b8,  // Mounting struts
  };

  // Built vertically along Y (intake at +Y, nozzle bell at -Y) matching Thruster bodyGroup orientation
  const g = createMicroVoxelGrid(10, 16, 10);

  // Main cylindrical heat-shield casing (y = 5..12)
  for (let y = 5; y <= 12; y++) {
    const isRib = y === 6 || y === 11;
    const mat = isRib ? 2 : 1;
    const r = isRib ? 4.4 : 3.9;
    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 10; x++) {
        const d = Math.hypot(x + 0.5 - 5, z + 0.5 - 5);
        if (d <= r) {
          setMicroVoxel(g, x, y, z, mat);
        }
      }
    }
  }

  // Inner reactor chamber core inside the casing (hidden until outer hull breaks!)
  fillMicroBox(g, 4, 6, 4, 5, 10, 5, 5);

  // Supersonic front intake nose cone (y = 13..15)
  fillMicroBox(g, 3, 13, 3, 6, 13, 6, 2);
  fillMicroBox(g, 4, 14, 4, 5, 15, 5, 6);

  // Diverging rocket exhaust bell nozzle (y = 0..4) with hollow glowing interior!
  for (let y = 0; y <= 4; y++) {
    const outerR = y === 0 ? 4.4 : y === 1 ? 4.0 : y === 2 ? 3.5 : 3.0;
    const innerR = y <= 1 ? 2.4 : 1.7;
    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 10; x++) {
        const d = Math.hypot(x + 0.5 - 5, z + 0.5 - 5);
        if (d <= outerR && d >= innerR) {
          setMicroVoxel(g, x, y, z, y === 0 ? 2 : 3);
        } else if (d < innerR && y >= 3) {
          setMicroVoxel(g, x, y, z, 4);
        }
      }
    }
  }

  const voxelSize = MICRO_VOXEL_SIZE * scale;
  const pivot: [number, number, number] = [5, 8.5, 5];
  const intactGeometry = buildGreedyMicroVoxelGeometry(g, palette, {
    voxelSize,
    pivot,
    bakeAO: true,
    bakeFaceShade: true,
  });
  intactGeometry.userData.isSharedPrimitive = true;

  return {
    kind,
    grid: g,
    palette,
    voxelSize,
    pivot,
    totalVoxels: countSolidMicroVoxels(g),
    intactGeometry,
    destroyThreshold: 0.28,
  };
}

function buildPlasmaCannonTemplate(): MicroVoxelBlockTemplate {
  const palette: Record<number, number> = {
    1: 0x1e293b, // Dark armored top shield / cooling shroud
    2: 0xbe123c, // Crimson turret receiver breech
    3: 0x334155, // Rail barrel steel
    4: 0x64748b, // Muzzle brake / accents
    5: 0x38bdf8, // Glowing cyan plasma coils & inner capacitor core
    6: 0x0f172a, // Dark vents
  };

  // Turret pivot assembly: breech at z=1..10, barrel extending along +Z to z=21!
  const g = createMicroVoxelGrid(12, 8, 22);

  // Armored receiver housing
  fillMicroBox(g, 2, 1, 1, 9, 5, 10, 2);
  // Inner cyan plasma capacitor core (exposed when outer crimson armor chips!)
  fillMicroBox(g, 4, 2, 3, 7, 4, 8, 5);
  // Top armor plate
  fillMicroBox(g, 3, 6, 2, 8, 6, 9, 1);

  // Side plasma accelerator coils (x = 1 and x = 10)
  fillMicroBox(g, 1, 2, 2, 1, 4, 9, 5);
  fillMicroBox(g, 10, 2, 2, 10, 4, 9, 5);

  // Heavy cooling shroud (z = 11..15)
  fillMicroBox(g, 4, 2, 11, 7, 5, 15, 1);
  // Rail barrel core (z = 11..20)
  fillMicroBox(g, 5, 3, 11, 6, 4, 20, 3);
  // Side barrel rails with cyan slit
  fillMicroBox(g, 4, 3, 16, 4, 4, 19, 3);
  fillMicroBox(g, 7, 3, 16, 7, 4, 19, 3);
  fillMicroBox(g, 5, 3, 16, 6, 4, 19, 5);
  // Flared muzzle brake (z = 19..21)
  fillMicroBox(g, 4, 2, 20, 7, 5, 21, 4);
  fillMicroBox(g, 5, 3, 21, 6, 4, 21, 5);

  const pivot: [number, number, number] = [6, 3.2, 5.5];
  const intactGeometry = buildGreedyMicroVoxelGeometry(g, palette, {
    voxelSize: MICRO_VOXEL_SIZE,
    pivot,
    bakeAO: true,
    bakeFaceShade: true,
  });
  intactGeometry.userData.isSharedPrimitive = true;

  return {
    kind: 'PLASMA_CANNON',
    grid: g,
    palette,
    voxelSize: MICRO_VOXEL_SIZE,
    pivot,
    totalVoxels: countSolidMicroVoxels(g),
    intactGeometry,
    destroyThreshold: 0.28,
  };
}

function buildCockpitTemplate(
  kind:
    | 'COCKPIT'
    | 'SEAT_KART'
    | 'SEAT_MOTO'
    | 'SEAT_OPERATOR'
    | 'SEAT_ARMORED'
    | 'SEAT_DIVING'
    | 'SEAT_SPACE'
    | 'SEAT_SHIP_WHEEL',
): MicroVoxelBlockTemplate {
  const isMoto = kind === 'SEAT_MOTO';
  const isArmored = kind === 'SEAT_ARMORED';
  const seatHex = isMoto ? 0xf97316 : isArmored ? 0x475569 : 0x0284c7;

  const palette: Record<number, number> = {
    1: 0x0f172a, // Floor rails & dark structural base
    2: seatHex,  // Sculpted bucket seat upholstery
    3: 0x1e293b, // Roll-cage tubular pillars & side bolsters
    4: 0x334155, // Dashboard & steering wheel frame
    5: 0x38bdf8, // Glowing cyan MFD telemetry display
    6: 0xe2e8f0, // Chrome trim / handlebars / harness buckle
    7: 0xfacc15, // Safety harness accents
  };

  const sx = isMoto ? 8 : 13;
  const sy = 15;
  const sz = 13;
  const g = createMicroVoxelGrid(sx, sy, sz);
  const cx = Math.floor(sx / 2);

  // 1. Floor rails & seat cushion
  fillMicroBox(g, 1, 0, 1, sx - 2, 1, sz - 2, 1);
  fillMicroBox(g, 1, 2, 2, sx - 2, 3, sz - 3, 2);

  // 2. Sculpted seat back + racing headrest (z = 1..2)
  fillMicroBox(g, 1, 3, 1, sx - 2, 10, 2, 2);
  fillMicroBox(g, Math.max(1, cx - 2), 11, 1, Math.min(sx - 2, cx + 2), 13, 2, 1);
  // Racing harness stripes
  setMicroVoxel(g, Math.max(1, cx - 1), 8, 2, 7);
  setMicroVoxel(g, Math.min(sx - 2, cx + 1), 8, 2, 7);
  setMicroVoxel(g, Math.max(1, cx - 1), 9, 2, 7);
  setMicroVoxel(g, Math.min(sx - 2, cx + 1), 9, 2, 7);

  // 3. Side bolsters
  fillMicroBox(g, 0, 2, 2, 0, 6, sz - 3, 3);
  fillMicroBox(g, sx - 1, 2, 2, sx - 1, 6, sz - 3, 3);

  // 4. Roll-cage A-pillars, B-pillars, roof rails & cross-brace
  fillMicroBox(g, 0, 6, 1, 0, 14, 1, 3);
  fillMicroBox(g, sx - 1, 6, 1, sx - 1, 14, 1, 3);
  // Angled front A-pillars
  for (let i = 0; i < 8; i++) {
    const py = 6 + i;
    const pz = Math.max(3, sz - 2 - Math.floor(i * 0.45));
    setMicroVoxel(g, 0, py, pz, 3);
    setMicroVoxel(g, sx - 1, py, pz, 3);
  }
  // Roof side rails + rear cross-brace
  fillMicroBox(g, 0, 14, 1, 0, 14, sz - 5, 3);
  fillMicroBox(g, sx - 1, 14, 1, sx - 1, 14, sz - 5, 3);
  fillMicroBox(g, 0, 14, 1, sx - 1, 14, 1, 3);

  // 5. Front dashboard console & glowing cyan MFD telemetry screen
  fillMicroBox(g, 1, 4, sz - 3, sx - 2, 7, sz - 1, 4);
  fillMicroBox(g, Math.max(2, cx - 2), 6, sz - 3, Math.min(sx - 3, cx + 2), 7, sz - 3, 5);

  // 6. Steering wheel or Moto handlebars
  if (isMoto) {
    fillMicroBox(g, 0, 8, sz - 3, sx - 1, 8, sz - 3, 6);
    setMicroVoxel(g, 0, 8, sz - 4, 1);
    setMicroVoxel(g, sx - 1, 8, sz - 4, 1);
  } else {
    // Steering column + ring
    fillMicroBox(g, cx, 6, sz - 4, cx, 7, sz - 4, 4);
    fillMicroBox(g, cx - 1, 7, sz - 5, cx + 1, 9, sz - 5, 4);
    setMicroVoxel(g, cx, 8, sz - 5, 6);
  }

  const pivot: [number, number, number] = [sx * 0.5, 2.5, sz * 0.5];
  const intactGeometry = buildGreedyMicroVoxelGeometry(g, palette, {
    voxelSize: MICRO_VOXEL_SIZE,
    pivot,
    bakeAO: true,
    bakeFaceShade: true,
  });
  intactGeometry.userData.isSharedPrimitive = true;

  return {
    kind,
    grid: g,
    palette,
    voxelSize: MICRO_VOXEL_SIZE,
    pivot,
    totalVoxels: countSolidMicroVoxels(g),
    intactGeometry,
    destroyThreshold: 0.25,
  };
}

// ============================================================================
// PART 3: REMAINING MECHANICAL, AERO, MARINE, WEAPON, SENSOR & WHEEL 1PX MODELS
// ============================================================================

function finalizeTemplate(
  kind: MicroVoxelBlockKind,
  g: MicroVoxelGrid,
  palette: Record<number, number>,
  pivot: [number, number, number],
  voxelSize = MICRO_VOXEL_SIZE,
  destroyThreshold = 0.28,
): MicroVoxelBlockTemplate {
  const intactGeometry = buildGreedyMicroVoxelGeometry(g, palette, {
    voxelSize,
    pivot,
    bakeAO: true,
    bakeFaceShade: true,
  });
  intactGeometry.userData.isSharedPrimitive = true;
  return {
    kind,
    grid: g,
    palette,
    voxelSize,
    pivot,
    totalVoxels: countSolidMicroVoxels(g),
    intactGeometry,
    destroyThreshold,
  };
}

function buildAeroTemplate(
  kind: 'AERO_WING' | 'WING_STANDARD' | 'SPOILER' | 'TAILFIN' | 'TAILFIN_POWERED' | 'AERO_BLADE',
): MicroVoxelBlockTemplate {
  const isSpoiler = kind === 'SPOILER';
  const isTail = kind === 'TAILFIN' || kind === 'TAILFIN_POWERED';
  const pal: Record<number, number> = {
    1: 0x1e293b, // Carbon spar / base mount
    2: isSpoiler ? 0x0f172a : 0x0284c7, // Main airfoil skin
    3: 0x94a3b8, // Aluminum struts / trim tabs
    4: 0xfacc15, // Wingtip accent & hazard edge
    5: 0x38bdf8, // Inner composite honeycomb core (revealed when chipped!)
    6: 0xef4444, // Navigation strobe tip
  };

  if (isSpoiler) {
    const g = createMicroVoxelGrid(20, 9, 8);
    // Base chassis mount
    fillMicroBox(g, 7, 0, 1, 12, 1, 6, 1);
    // Twin angled aluminum risers
    fillMicroBox(g, 3, 1, 2, 4, 6, 5, 3);
    fillMicroBox(g, 15, 1, 2, 16, 6, 5, 3);
    // Sculpted rear downforce wing foil + inner carbon core
    fillMicroBox(g, 1, 6, 1, 18, 7, 6, 2);
    fillMicroBox(g, 4, 7, 3, 15, 7, 4, 5);
    // Endplates with yellow racing lip
    fillMicroBox(g, 0, 5, 0, 0, 8, 7, 1);
    fillMicroBox(g, 19, 5, 0, 19, 8, 7, 1);
    fillMicroBox(g, 0, 8, 1, 0, 8, 6, 4);
    fillMicroBox(g, 19, 8, 1, 19, 8, 6, 4);
    return finalizeTemplate(kind, g, pal, [10, 1.5, 4]);
  }

  if (isTail) {
    const g = createMicroVoxelGrid(6, 16, 14);
    fillMicroBox(g, 1, 0, 1, 4, 1, 12, 1);
    // Swept vertical stabilizer with tapered leading edge + rudder trim
    for (let y = 2; y <= 14; y++) {
      const leadZ = Math.min(11, 12 - Math.floor((y - 2) * 0.45));
      fillMicroBox(g, 2, y, 1, 3, y, leadZ, 2);
      if (y % 3 === 0) fillMicroBox(g, 2, y, 2, 3, y, Math.max(2, leadZ - 1), 5);
      // Powered rudder flap trailing edge
      setMicroVoxel(g, 2, y, 0, kind === 'TAILFIN_POWERED' ? 4 : 3);
      setMicroVoxel(g, 3, y, 0, kind === 'TAILFIN_POWERED' ? 4 : 3);
    }
    fillMicroBox(g, 2, 15, 1, 3, 15, 5, 4);
    setMicroVoxel(g, 2, 15, 5, 6);
    return finalizeTemplate(kind, g, pal, [3, 1.5, 7]);
  }

  // Main Airfoil Wing (20 x 6 x 12)
  const g = createMicroVoxelGrid(20, 6, 12);
  fillMicroBox(g, 0, 0, 1, 3, 2, 10, 1); // Wing root pylon
  // Tapered airfoil cross-section along X
  fillMicroBox(g, 1, 1, 2, 18, 2, 9, 2);
  fillMicroBox(g, 2, 2, 3, 17, 2, 7, 5); // Inner spar core
  fillMicroBox(g, 1, 1, 10, 18, 1, 10, 3); // Leading edge slat
  fillMicroBox(g, 2, 1, 1, 17, 1, 1, 3); // Trailing edge aileron flap
  // Upturned yellow winglet + red wingtip beacon
  fillMicroBox(g, 19, 1, 2, 19, 5, 7, 4);
  setMicroVoxel(g, 19, 5, 7, 6);
  return finalizeTemplate(kind, g, pal, [9.5, 1.5, 6]);
}

function buildMarineOutboardTemplate(
  kind: 'BOAT_PROP' | 'BOAT_OUTBOARD' | 'PROP_AERO' | 'VTOL_ROTOR',
): MicroVoxelBlockTemplate {
  const isAero = kind === 'PROP_AERO';
  const isVtol = kind === 'VTOL_ROTOR';
  const cowlHex = isAero ? 0x84cc16 : isVtol ? 0x334155 : kind === 'BOAT_OUTBOARD' ? 0x0284c7 : 0x06b6d4;
  const pal: Record<number, number> = {
    1: 0x1e293b, // Shaft / dark gearbox
    2: cowlHex,  // Cowling / nacelle body
    3: 0x94a3b8, // Chrome trim / cavitation foil
    4: 0xfacc15, // Accent stripes / inner brass gear core
    5: 0xff6600, // Inner hot motor stator core
  };

  if (isVtol) {
    const g = createMicroVoxelGrid(8, 10, 8);
    fillMicroBox(g, 2, 0, 2, 5, 2, 5, 1); // Base gearbox
    fillMicroBox(g, 3, 1, 3, 4, 4, 4, 5); // Inner motor core
    fillMicroBox(g, 2, 3, 2, 5, 7, 5, 2); // Mast shroud
    fillMicroBox(g, 3, 7, 3, 4, 9, 4, 3); // Swashplate mast
    setMicroVoxel(g, 2, 6, 5, 4);
    setMicroVoxel(g, 5, 6, 5, 4);
    return finalizeTemplate(kind, g, pal, [4, 2.5, 4]);
  }

  if (isAero) {
    const g = createMicroVoxelGrid(12, 12, 10);
    // Circular ducted nacelle housing + mounting ring
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const d = Math.hypot(x + 0.5 - 6, y + 0.5 - 6);
        if (d <= 5.6 && d >= 4.4) {
          fillMicroBox(g, x, y, 2, x, y, 7, 2);
        } else if (d <= 2.4) {
          fillMicroBox(g, x, y, 1, x, y, 8, 1);
        }
      }
    }
    fillMicroBox(g, 5, 5, 3, 6, 6, 6, 5); // Inner stator core
    // 4 radial support struts
    fillMicroBox(g, 5, 1, 4, 6, 10, 5, 3);
    fillMicroBox(g, 1, 5, 4, 10, 6, 5, 3);
    return finalizeTemplate(kind, g, pal, [6, 6, 5]);
  }

  // Marine Outboard Motor: Upper powerhead cowling + vertical shaft + anti-cavitation plate + torpedo bulb
  const g = createMicroVoxelGrid(8, 16, 10);
  // Powerhead cowling (y = 11..15)
  fillMicroBox(g, 1, 11, 2, 6, 14, 8, 2);
  fillMicroBox(g, 2, 15, 3, 5, 15, 7, 1);
  fillMicroBox(g, 3, 12, 4, 4, 13, 6, 5); // Inner engine core
  fillMicroBox(g, 1, 13, 3, 6, 13, 7, 4); // Racing stripe
  // Vertical drive leg (y = 5..10)
  fillMicroBox(g, 3, 5, 3, 4, 10, 6, 1);
  // Anti-cavitation horizontal foil (y = 5)
  fillMicroBox(g, 1, 5, 2, 6, 5, 7, 3);
  // Torpedo lower gearcase bulb (y = 2..4) + skeg fin (y = 0..1)
  fillMicroBox(g, 2, 2, 2, 5, 4, 8, 2);
  fillMicroBox(g, 3, 3, 9, 4, 3, 9, 3); // Nose cone
  fillMicroBox(g, 3, 0, 3, 4, 1, 6, 1); // Skeg
  return finalizeTemplate(kind, g, pal, [4, 9.5, 5]);
}

function buildWeaponTemplate(
  kind: 'WEAPON_MINIGUN' | 'WEAPON_ROCKET' | 'WEAPON_BOMB_BAY' | 'WEAPON_MELEE',
): MicroVoxelBlockTemplate {
  const pal: Record<number, number> = {
    1: 0x1e293b, // Dark receiver steel
    2: kind === 'WEAPON_ROCKET' ? 0x991b1b : kind === 'WEAPON_MELEE' ? 0x475569 : 0x334155,
    3: 0x94a3b8, // Machined chrome / rails
    4: 0xfacc15, // Ammo drum / warhead tips / hazard stripe
    5: kind === 'WEAPON_MELEE' ? 0xe879f9 : 0xf97316, // Glowing core / plasma edge
    6: 0xef4444, // Red tail fins / armed light
  };

  if (kind === 'WEAPON_MINIGUN') {
    const g = createMicroVoxelGrid(10, 8, 10);
    fillMicroBox(g, 2, 1, 1, 7, 6, 8, 2); // Armored receiver
    fillMicroBox(g, 4, 3, 3, 5, 4, 6, 5); // Inner feed motor core
    fillMicroBox(g, 1, 0, 2, 8, 3, 5, 4); // Underslung yellow rotary ammo drum
    fillMicroBox(g, 3, 7, 2, 6, 7, 7, 1); // Top feed chute
    fillMicroBox(g, 3, 2, 9, 6, 5, 9, 3); // Barrel collar mount
    return finalizeTemplate(kind, g, pal, [5, 3.5, 5]);
  }

  if (kind === 'WEAPON_ROCKET') {
    const g = createMicroVoxelGrid(12, 9, 15);
    fillMicroBox(g, 1, 1, 1, 10, 7, 13, 2); // Crimson launcher pod
    fillMicroBox(g, 4, 3, 4, 7, 5, 10, 5); // Inner ignition bus core
    fillMicroBox(g, 1, 1, 13, 10, 7, 13, 1); // Dark front faceplate
    // 4 recessed launch tubes with protruding yellow warheads
    for (const ox of [3, 8]) {
      for (const oy of [2, 5]) {
        fillMicroBox(g, ox - 1, oy, 13, ox, oy + 1, 13, 1);
        fillMicroBox(g, ox - 1, oy, 14, ox, oy + 1, 14, 4);
      }
    }
    fillMicroBox(g, 2, 8, 3, 9, 8, 11, 1); // Top rail
    return finalizeTemplate(kind, g, pal, [6, 3.5, 7]);
  }

  if (kind === 'WEAPON_BOMB_BAY') {
    const g = createMicroVoxelGrid(12, 10, 14);
    fillMicroBox(g, 1, 6, 1, 10, 9, 12, 2); // Upper bomb rack
    fillMicroBox(g, 1, 8, 1, 10, 8, 12, 5); // Orange hazard stripe
    // Suspended heavy ordnance bomb
    fillMicroBox(g, 4, 1, 3, 7, 4, 10, 1);
    fillMicroBox(g, 5, 2, 11, 6, 3, 13, 4); // Yellow nose fuse
    fillMicroBox(g, 3, 0, 1, 8, 5, 2, 6); // Red tail fins
    return finalizeTemplate(kind, g, pal, [6, 5.5, 7]);
  }

  // WEAPON_MELEE: Energized 1px micro-voxel ram blade
  const g = createMicroVoxelGrid(6, 7, 24);
  fillMicroBox(g, 1, 1, 0, 4, 5, 6, 1); // Heavy armored hilt
  fillMicroBox(g, 2, 2, 2, 3, 4, 5, 5); // Inner plasma battery
  fillMicroBox(g, 2, 2, 7, 3, 4, 21, 3); // Forged steel spine
  fillMicroBox(g, 2, 1, 8, 3, 1, 22, 5); // Glowing magenta plasma cutting edge
  fillMicroBox(g, 2, 5, 8, 3, 5, 22, 5);
  fillMicroBox(g, 2, 2, 22, 3, 4, 23, 5); // Plasma tip
  return finalizeTemplate(kind, g, pal, [3, 3.5, 4]);
}

function buildMechanicalUtilityTemplate(kind: MicroVoxelBlockKind): MicroVoxelBlockTemplate {
  const pal: Record<number, number> = {
    1: 0x1e293b, // Forged dark steel frame
    2: 0x334155, // Mid-slate casing
    3: 0x94a3b8, // Chrome piston/shaft/trim
    4: 0xfacc15, // Industrial yellow hazard/brass
    5: 0xf97316, // Hydraulic orange / coil spring
    6: 0x38bdf8, // Cyan tech / gyro / sensor glow
    7: 0x10b981, // Emerald status / servo rotor
    8: 0xef4444, // Crimson laser / pyrotechnic charge
    9: 0x4d7c0f, // Olive tank armor skirt
    10: 0xa855f7, // Impulse purple coil
  };

  if (kind === 'SUSPENSION') {
    const g = createMicroVoxelGrid(8, 14, 8);
    fillMicroBox(g, 1, 11, 1, 6, 13, 6, 1); // Upper chassis clevis mount
    fillMicroBox(g, 3, 1, 3, 4, 11, 4, 3); // Chrome hydraulic damper shaft
    // Helical orange spring coils around damper shaft
    for (let y = 4; y <= 10; y += 2) {
      fillMicroBox(g, 2, y, 2, 5, y, 5, 5);
      fillMicroBox(g, 3, y, 3, 4, y, 4, 3);
    }
    fillMicroBox(g, 1, 0, 1, 6, 1, 6, 2); // Lower suspension control arm mount
    return finalizeTemplate(kind, g, pal, [4, 7, 4]);
  }

  if (kind === 'PISTON') {
    const g = createMicroVoxelGrid(8, 14, 8);
    // Heavy forged top clevis mounting cap
    fillMicroBox(g, 1, 12, 1, 6, 13, 6, 1);
    // Solid enclosed dark-steel hydraulic cylinder barrel (clearly different from orange coilover suspension)
    fillMicroBox(g, 1, 5, 1, 6, 11, 6, 2);
    // High-viz industrial yellow hydraulic pressure collar bands
    fillMicroBox(g, 1, 10, 1, 6, 10, 6, 4);
    fillMicroBox(g, 1, 5, 1, 6, 5, 6, 4);
    // Lower forged steel gland seal collar
    fillMicroBox(g, 1, 3, 1, 6, 4, 6, 1);
    // Side chrome hydraulic pressure manifold line + fittings
    fillMicroBox(g, 7, 4, 3, 7, 11, 4, 3);
    fillMicroBox(g, 6, 11, 3, 7, 11, 4, 4);
    fillMicroBox(g, 6, 4, 3, 7, 4, 4, 4);
    // Thick inner chrome ram rod stub emerging from cylinder bore
    fillMicroBox(g, 2, 1, 2, 5, 2, 5, 3);
    return finalizeTemplate(kind, g, pal, [4, 7, 4]);
  }

  if (kind === 'OUTRIGGER_JACK') {
    const g = createMicroVoxelGrid(8, 14, 8);
    fillMicroBox(g, 1, 11, 1, 6, 13, 6, 1); // Upper frame bracket
    fillMicroBox(g, 2, 5, 2, 5, 11, 5, 2); // Outer square telescopic steel leg
    fillMicroBox(g, 2, 7, 2, 5, 8, 5, 4); // Industrial yellow hazard band
    fillMicroBox(g, 3, 2, 3, 4, 5, 4, 3); // Inner chrome jack extension post
    fillMicroBox(g, 0, 0, 0, 7, 1, 7, 4); // Wide stabilizer ground footpad
    return finalizeTemplate(kind, g, pal, [4, 7, 4]);
  }

  if (kind === 'GYRO' || kind === 'GYRO_REACTION') {
    const g = createMicroVoxelGrid(11, 10, 11);
    fillMicroBox(g, 1, 0, 1, 9, 2, 9, 1); // Base mount plate
    // Corner protective gimbal posts
    for (const cx of [1, 9]) {
      for (const cz of [1, 9]) {
        fillMicroBox(g, cx, 2, cz, cx, 8, cz, 2);
      }
    }
    fillMicroBox(g, 1, 8, 1, 9, 9, 9, 1); // Top ring cap
    fillMicroBox(g, 3, 8, 3, 7, 9, 7, 0); // Open top viewport into glowing flywheel
    fillMicroBox(g, 4, 3, 4, 6, 6, 6, 6); // Glowing blue reaction core
    fillMicroBox(g, 2, 4, 2, 8, 5, 8, 3); // Gimbal ring
    fillMicroBox(g, 4, 4, 4, 6, 5, 6, 6); // Keep glowing core center
    return finalizeTemplate(kind, g, pal, [5.5, 4.5, 5.5]);
  }

  if (kind === 'TANK_TREAD') {
    const g = createMicroVoxelGrid(8, 12, 22);
    // Olive armored side skirt + upper chassis strut
    fillMicroBox(g, 2, 8, 7, 5, 11, 14, 2);
    fillMicroBox(g, 0, 6, 1, 7, 8, 20, 9);
    fillMicroBox(g, 0, 7, 2, 7, 7, 19, 4); // Trim line
    // Continuous rubber-steel track belt loop with cleats
    fillMicroBox(g, 1, 0, 2, 6, 5, 19, 1);
    fillMicroBox(g, 1, 1, 1, 6, 4, 20, 1);
    // 3 visible recessed steel road wheels + yellow hubs on each flank
    for (const wz of [4, 11, 17]) {
      fillMicroBox(g, 0, 1, wz - 2, 7, 4, wz + 2, 3);
      fillMicroBox(g, 0, 2, wz - 1, 7, 3, wz + 1, 4);
    }
    // Bottom tread cleats
    for (let z = 2; z <= 19; z += 3) {
      fillMicroBox(g, 1, 0, z, 6, 0, z, 2);
    }
    return finalizeTemplate(kind, g, pal, [4, 7, 11]);
  }

  if (kind === 'PONTOON_LARGE') {
    const g = createMicroVoxelGrid(10, 9, 20);
    // High-viz yellow hydrodynamic pontoon hull with tapered bow
    fillMicroBox(g, 1, 2, 3, 8, 6, 15, 4);
    fillMicroBox(g, 2, 1, 3, 7, 7, 16, 4);
    fillMicroBox(g, 3, 2, 16, 6, 5, 18, 4);
    fillMicroBox(g, 4, 3, 19, 5, 4, 19, 4); // Bow point
    fillMicroBox(g, 3, 2, 1, 6, 6, 2, 2); // Stern cap
    fillMicroBox(g, 4, 0, 3, 5, 1, 16, 1); // Keel skeg
    fillMicroBox(g, 2, 7, 4, 7, 8, 15, 2); // Top mounting rail
    fillMicroBox(g, 1, 2, 6, 8, 6, 6, 1); // Strap band
    fillMicroBox(g, 1, 2, 13, 8, 6, 13, 1);
    return finalizeTemplate(kind, g, pal, [5, 4.5, 10]);
  }

  if (kind === 'IMPULSE_BUMPER') {
    const g = createMicroVoxelGrid(16, 8, 8);
    fillMicroBox(g, 1, 1, 0, 14, 6, 2, 1); // Back mount
    fillMicroBox(g, 3, 2, 2, 5, 5, 5, 10); // Left purple impulse coil
    fillMicroBox(g, 10, 2, 2, 12, 5, 5, 10); // Right purple impulse coil
    fillMicroBox(g, 0, 0, 5, 15, 7, 7, 2); // Heavy armored ram shield
    fillMicroBox(g, 0, 3, 7, 15, 4, 7, 4); // Glowing hazard bumper bar
    return finalizeTemplate(kind, g, pal, [8, 4, 4]);
  }

  if (kind === 'WEIGHT_BLOCK' || kind === 'BCD_TANK' || kind === 'DETACHABLE_BLOCK') {
    const g = createMicroVoxelGrid(12, 10, 12);
    if (kind === 'BCD_TANK') {
      fillMicroBox(g, 1, 0, 1, 10, 1, 10, 1);
      fillMicroBox(g, 1, 8, 1, 10, 8, 10, 1);
      fillMicroBox(g, 1, 2, 1, 4, 7, 10, 6); // Left ballast cylinder
      fillMicroBox(g, 7, 2, 1, 10, 7, 10, 6); // Right ballast cylinder
      fillMicroBox(g, 5, 8, 5, 6, 9, 6, 4); // Brass purge valve
      fillMicroBox(g, 5, 3, 11, 6, 6, 11, 6); // Sight gauge
    } else if (kind === 'DETACHABLE_BLOCK') {
      fillMicroBox(g, 1, 0, 1, 10, 2, 10, 1);
      fillMicroBox(g, 1, 7, 1, 10, 9, 10, 1);
      fillMicroBox(g, 2, 3, 2, 9, 6, 9, 8); // Red pyrotechnic charge core
      fillMicroBox(g, 1, 4, 1, 10, 5, 10, 4); // Hazard band
    } else {
      fillMicroBox(g, 1, 0, 1, 10, 8, 10, 2); // Solid iron anvil weight
      fillMicroBox(g, 0, 0, 0, 11, 1, 11, 1);
      fillMicroBox(g, 1, 3, 0, 10, 4, 11, 4); // Hazard stripes
      fillMicroBox(g, 4, 8, 5, 7, 9, 6, 3); // Lifting eye
      fillMicroBox(g, 5, 8, 5, 6, 8, 6, 0);
    }
    return finalizeTemplate(kind, g, pal, [6, 5, 6]);
  }

  if (kind === 'GRAPPLING_WINCH') {
    const g = createMicroVoxelGrid(10, 8, 10);
    fillMicroBox(g, 1, 0, 1, 8, 1, 8, 1); // Base plate
    fillMicroBox(g, 1, 1, 1, 2, 6, 8, 2); // Left cheek
    fillMicroBox(g, 7, 1, 1, 8, 6, 8, 2); // Right cheek
    fillMicroBox(g, 3, 2, 3, 6, 5, 6, 4); // Brass spool core
    fillMicroBox(g, 2, 2, 9, 7, 2, 9, 3); // Lower fairlead roller
    fillMicroBox(g, 2, 5, 9, 7, 5, 9, 3); // Upper fairlead roller
    return finalizeTemplate(kind, g, pal, [5, 3.5, 5]);
  }

  if (kind === 'SKI_SLIDER') {
    const g = createMicroVoxelGrid(6, 9, 24);
    fillMicroBox(g, 1, 7, 10, 4, 8, 13, 1); // Chassis mount
    fillMicroBox(g, 2, 2, 9, 3, 7, 10, 3); // Rear strut
    fillMicroBox(g, 2, 2, 13, 3, 7, 14, 3); // Front strut
    fillMicroBox(g, 0, 0, 1, 5, 1, 20, 6); // Cyan ski runner
    fillMicroBox(g, 0, 1, 20, 5, 2, 22, 4); // Upturned yellow ski tip
    fillMicroBox(g, 0, 2, 22, 5, 3, 23, 4);
    return finalizeTemplate(kind, g, pal, [3, 7.5, 12]);
  }

  // Sensors, Logic, Servos, Hinges, Turret Ring, Magnet Coupler, Parachute, Smoke Flare
  const g = createMicroVoxelGrid(10, 8, 10);
  const accent =
    kind === 'SENSOR_DISTANCE' || kind === 'SMOKE_FLARE'
      ? 8
      : kind === 'SERVO_SPIN' || kind === 'SERVO_SMALL' || kind === 'LOGIC_GATE' || kind === 'SENSOR_SPEED' || kind === 'SENSOR_SPEEDO'
        ? 7
        : kind === 'HINGE_LARGE' || kind === 'PARACHUTE_AIRBRAKE'
          ? 5
          : kind === 'SENSOR_ANGLE' || kind === 'SENSOR_IMU_TILT' || kind === 'TURRET_RING'
            ? 4
            : 6;

  // Ruggedized beveled avionics/mechanical block with cooling fins, inner circuit core & front optics
  fillMicroBox(g, 1, 0, 1, 8, 5, 8, 1);
  fillMicroBox(g, 3, 2, 3, 6, 4, 6, accent); // Inner glowing electronics/mechanical core!
  fillMicroBox(g, 0, 2, 2, 9, 2, 7, 2); // Side heatsink rib 1
  fillMicroBox(g, 0, 4, 2, 9, 4, 7, 2); // Side heatsink rib 2
  fillMicroBox(g, 2, 6, 2, 7, 6, 7, accent); // Top cap / status pad
  fillMicroBox(g, 2, 2, 9, 7, 3, 9, accent); // Front glowing telemetry / optics bar
  setMicroVoxel(g, 1, 5, 1, 3); // Corner bolts
  setMicroVoxel(g, 8, 5, 1, 3);
  setMicroVoxel(g, 1, 5, 8, 3);
  setMicroVoxel(g, 8, 5, 8, 3);
  return finalizeTemplate(kind, g, pal, [5, 3.5, 5]);
}

// ============================================================================
// 1PX MICRO-VOXEL WHEEL TIRE & RIM GEOMETRY CACHE (FOR MODELS.TS)
// ============================================================================

const _wheelGeoCache = new Map<string, THREE.BufferGeometry>();

/**
 * Generates a high-detail 1px greedy-meshed micro-voxel spinning tire + alloy rim + lug nuts
 * centered at (0, 0, 0) along the X axle so `rollGroup.rotation.x` spins smoothly with 1 draw call!
 */
export function getMicroVoxelWheelRollGeometry(
  kind: string,
  radiusMeters: number,
  widthMeters: number,
  rimColorHex: number,
  isSpiked = false,
): THREE.BufferGeometry {
  const key = `${kind}_${radiusMeters.toFixed(2)}_${widthMeters.toFixed(2)}_${rimColorHex}_${isSpiked}`;
  const cached = _wheelGeoCache.get(key);
  if (cached) return cached;

  const vs = MICRO_VOXEL_SIZE;
  const rVox = Math.max(5, Math.min(12, Math.round(radiusMeters / vs)));
  const halfW = Math.max(2, Math.min(6, Math.round((widthMeters * 0.5) / vs)));
  const sx = halfW * 2 + 1;
  const sy = rVox * 2 + 1;
  const sz = rVox * 2 + 1;

  const pal: Record<number, number> = {
    1: 0x16191f, // Deep matte tire rubber
    2: 0x262b33, // Raised tread lug rubber
    3: rimColorHex, // Alloy rim & spokes
    4: 0x1e293b, // Recessed brake drum / inner dish
    5: 0xe2e8f0, // Chrome hubcap & lug nuts
    6: 0x7dd3fc, // Ice spikes (WHEEL_SPIKED)
  };

  const g = createMicroVoxelGrid(sx, sy, sz);
  const cx = halfW;
  const cy = rVox;
  const cz = rVox;
  const rimR = rVox * 0.62;
  const hubR = rVox * 0.24;

  for (let z = 0; z < sz; z++) {
    const dz = z - cz;
    for (let y = 0; y < sy; y++) {
      const dy = y - cy;
      const dist = Math.hypot(dy, dz);
      if (dist > rVox + 0.35) continue;

      const ang = Math.atan2(dy, dz);
      const treadWave = Math.sin(ang * 12) > 0.22;
      const spokeWave = Math.cos(ang * 5) > 0.58;

      for (let x = 0; x < sx; x++) {
        const ax = Math.abs(x - cx);
        if (dist >= rimR) {
          // Tire rubber & outer tread lugs
          if (dist > rVox - 0.65) {
            if (treadWave && ax < halfW) {
              setMicroVoxel(g, x, y, z, isSpiked ? 6 : 2);
            } else if (ax <= halfW - 1 && dist <= rVox - 0.15) {
              setMicroVoxel(g, x, y, z, 1);
            }
          } else {
            // Sidewall chamfer
            if (ax < halfW || dist < rVox - 1.2) {
              setMicroVoxel(g, x, y, z, 1);
            }
          }
        } else if (dist <= hubR) {
          // Hubcap & chrome center axle
          setMicroVoxel(g, x, y, z, ax >= halfW - 1 ? 5 : 4);
        } else {
          // Recessed alloy rim dish + 5 sculpted spokes + outer rim lip
          if (dist > rimR - 1.0 && ax <= halfW) {
            setMicroVoxel(g, x, y, z, 3);
          } else if (spokeWave && ax <= halfW) {
            setMicroVoxel(g, x, y, z, 3);
          } else if (ax <= Math.max(1, halfW - 1)) {
            setMicroVoxel(g, x, y, z, 4);
          }
        }
      }
    }
  }

  const geo = buildGreedyMicroVoxelGeometry(g, pal, {
    voxelSize: vs,
    pivot: [cx + 0.5, cy + 0.5, cz + 0.5],
    bakeAO: true,
    bakeFaceShade: true,
  });
  geo.userData.isSharedPrimitive = true;
  geo.computeBoundingSphere();
  _wheelGeoCache.set(key, geo);
  return geo;
}

// ============================================================================
// SINGLETON TEMPLATE CACHE
// ============================================================================

const _templateCache = new Map<MicroVoxelBlockKind, MicroVoxelBlockTemplate>();

export function getMicroVoxelBlockTemplate(
  kind: MicroVoxelBlockKind,
): MicroVoxelBlockTemplate {
  let tpl = _templateCache.get(kind);
  if (tpl) return tpl;

  if (kind === 'V8_ENGINE' || kind === 'ENGINE_BULLDAWG' || kind === 'ENGINE_DRAGON') {
    tpl = buildEngineTemplate(kind);
  } else if (kind === 'HEADLIGHT') {
    tpl = buildHeadlightTemplate();
  } else if (kind === 'PLASMA_CANNON') {
    tpl = buildPlasmaCannonTemplate();
  } else if (
    kind === 'THRUSTER' ||
    kind === 'THRUSTER_MINI' ||
    kind === 'THRUSTER_ROCKET' ||
    kind === 'JET_RAW' ||
    kind === 'JET_GIMBAL'
  ) {
    tpl = buildThrusterTemplate(kind);
  } else if (
    kind === 'COCKPIT' ||
    kind === 'SEAT_KART' ||
    kind === 'SEAT_MOTO' ||
    kind === 'SEAT_OPERATOR' ||
    kind === 'SEAT_ARMORED' ||
    kind === 'SEAT_DIVING' ||
    kind === 'SEAT_SPACE' ||
    kind === 'SEAT_SHIP_WHEEL'
  ) {
    tpl = buildCockpitTemplate(kind);
  } else if (
    kind === 'AERO_WING' ||
    kind === 'WING_STANDARD' ||
    kind === 'SPOILER' ||
    kind === 'TAILFIN' ||
    kind === 'TAILFIN_POWERED' ||
    kind === 'AERO_BLADE'
  ) {
    tpl = buildAeroTemplate(kind);
  } else if (
    kind === 'BOAT_PROP' ||
    kind === 'BOAT_OUTBOARD' ||
    kind === 'PROP_AERO' ||
    kind === 'VTOL_ROTOR'
  ) {
    tpl = buildMarineOutboardTemplate(kind);
  } else if (
    kind === 'WEAPON_MINIGUN' ||
    kind === 'WEAPON_ROCKET' ||
    kind === 'WEAPON_BOMB_BAY' ||
    kind === 'WEAPON_MELEE'
  ) {
    tpl = buildWeaponTemplate(kind);
  } else {
    tpl = buildMechanicalUtilityTemplate(kind);
  }

  _templateCache.set(kind, tpl);
  return tpl;
}

// ============================================================================
// COPY-ON-WRITE (CoW) DESTRUCTION & ISLAND PRUNING
// ============================================================================

export function createMicroVoxelDamageState(
  kind: MicroVoxelBlockKind,
): MicroVoxelDamageState {
  const template = getMicroVoxelBlockTemplate(kind);
  return {
    kind,
    template,
    grid: null, // Copy-on-Write: zero RAM allocated until first hit!
    remainingVoxels: template.totalVoxels,
    totalVoxels: template.totalVoxels,
    integrity: 1.0,
    destroyed: false,
    damagedGeometry: null,
  };
}

export function disposeMicroVoxelDamageState(
  state: MicroVoxelDamageState | null | undefined,
): void {
  if (!state) return;
  if (state.damagedGeometry) {
    state.damagedGeometry.dispose();
    state.damagedGeometry = null;
  }
  state.grid = null;
}

// Reusable BFS scratch buffers for fast zero-GC connected-component island detection
let _bfsVisited = new Uint8Array(4096);
let _bfsQueue = new Int32Array(4096);

function ensureBfsBuffers(size: number): void {
  if (_bfsVisited.length < size) {
    _bfsVisited = new Uint8Array(size);
    _bfsQueue = new Int32Array(size);
  }
}

/**
 * Carves a 3D spherical crater into a module's 1px micro-voxel grid using Copy-on-Write.
 * - Lazily clones the template Uint8Array on first hit.
 * - Detaches any floating micro-voxel shards via fast 6-neighbor BFS.
 * - Rebuilds a greedy-meshed BufferGeometry only if voxels were actually removed.
 */
export function carveMicroVoxelModule(
  state: MicroVoxelDamageState,
  localHitX: number,
  localHitY: number,
  localHitZ: number,
  radiusMeters: number,
  options: MicroVoxelCarveOptions = {},
): MicroVoxelCarveResult {
  const tpl = state.template;
  if (state.destroyed || radiusMeters <= 0.01) {
    return {
      carvedCount: 0,
      detachedCount: 0,
      chips: [],
      integrity: state.integrity,
      destroyed: state.destroyed,
      geometry: state.damagedGeometry ?? tpl.intactGeometry,
    };
  }

  const vs = tpl.voxelSize;
  const gxCenter = localHitX / vs + tpl.pivot[0];
  const gyCenter = localHitY / vs + tpl.pivot[1];
  const gzCenter = localHitZ / vs + tpl.pivot[2];
  const radVox = Math.max(1.15, radiusMeters / vs);
  const radVoxSq = radVox * radVox;

  const srcData = state.grid ? state.grid.data : tpl.grid.data;
  const sx = tpl.grid.sx;
  const sy = tpl.grid.sy;
  const sz = tpl.grid.sz;

  const minX = Math.max(0, Math.floor(gxCenter - radVox));
  const maxX = Math.min(sx - 1, Math.ceil(gxCenter + radVox));
  const minY = Math.max(0, Math.floor(gyCenter - radVox));
  const maxY = Math.min(sy - 1, Math.ceil(gyCenter + radVox));
  const minZ = Math.max(0, Math.floor(gzCenter - radVox));
  const maxZ = Math.min(sz - 1, Math.ceil(gzCenter + radVox));

  if (minX > maxX || minY > maxY || minZ > maxZ) {
    return {
      carvedCount: 0,
      detachedCount: 0,
      chips: [],
      integrity: state.integrity,
      destroyed: state.destroyed,
      geometry: state.damagedGeometry ?? tpl.intactGeometry,
    };
  }

  // Quick pre-check before triggering Copy-on-Write clone: ensure at least 1 solid voxel is hit
  let willHitAny = false;
  for (let y = minY; y <= maxY && !willHitAny; y++) {
    const dy = y + 0.5 - gyCenter;
    const dy2 = dy * dy;
    const yOff = y * sz;
    for (let z = minZ; z <= maxZ && !willHitAny; z++) {
      const dz = z + 0.5 - gzCenter;
      const dyz2 = dy2 + dz * dz;
      if (dyz2 > radVoxSq) continue;
      const row = (yOff + z) * sx;
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - gxCenter;
        if (dx * dx + dyz2 <= radVoxSq && srcData[row + x] !== 0) {
          willHitAny = true;
          break;
        }
      }
    }
  }

  if (!willHitAny) {
    return {
      carvedCount: 0,
      detachedCount: 0,
      chips: [],
      integrity: state.integrity,
      destroyed: state.destroyed,
      geometry: state.damagedGeometry ?? tpl.intactGeometry,
    };
  }

  // Trigger Copy-on-Write clone now!
  if (!state.grid) {
    state.grid = {
      sx,
      sy,
      sz,
      data: new Uint8Array(tpl.grid.data),
    };
  }

  const data = state.grid.data;
  const maxChips = options.maxChips ?? 14;
  const step = options.coarseStep ? 2 : 1;
  const chips: MicroVoxelChip[] = [];
  let carvedCount = 0;

  const pushChip = (vx: number, vy: number, vz: number, mat: number) => {
    if (chips.length >= maxChips) return;
    chips.push({
      lx: (vx + 0.5 - tpl.pivot[0]) * vs,
      ly: (vy + 0.5 - tpl.pivot[1]) * vs,
      lz: (vz + 0.5 - tpl.pivot[2]) * vs,
      color: tpl.palette[mat] ?? 0x94a3b8,
    });
  };

  for (let y = minY; y <= maxY; y += step) {
    const dy = y + 0.5 - gyCenter;
    const dy2 = dy * dy;
    for (let z = minZ; z <= maxZ; z += step) {
      const dz = z + 0.5 - gzCenter;
      const dyz2 = dy2 + dz * dz;
      if (dyz2 > radVoxSq) continue;
      for (let x = minX; x <= maxX; x += step) {
        const dx = x + 0.5 - gxCenter;
        if (dx * dx + dyz2 > radVoxSq) continue;

        for (let oy = 0; oy < step && y + oy < sy; oy++) {
          const yy = y + oy;
          for (let oz = 0; oz < step && z + oz < sz; oz++) {
            const zz = z + oz;
            const row = (yy * sz + zz) * sx;
            for (let ox = 0; ox < step && x + ox < sx; ox++) {
              const xx = x + ox;
              const mat = data[row + xx];
              if (mat !== 0) {
                data[row + xx] = 0;
                carvedCount++;
                if ((carvedCount & 1) === 1) {
                  pushChip(xx, yy, zz, mat);
                }
              }
            }
          }
        }
      }
    }
  }

  // Fast 6-neighbor BFS to prune small floating disconnected micro-voxel islands
  let detachedCount = 0;
  const totalCells = sx * sy * sz;
  ensureBfsBuffers(totalCells);
  _bfsVisited.fill(0, 0, totalCells);

  // Find the largest connected component (or the anchor component closest to base y=0..2)
  let bestCompSize = 0;
  let bestCompRoot = -1;
  let componentCount = 0;

  for (let i = 0; i < totalCells; i++) {
    if (data[i] === 0 || _bfsVisited[i] !== 0) continue;
    componentCount++;
    let head = 0;
    let tail = 0;
    _bfsQueue[tail++] = i;
    _bfsVisited[i] = componentCount & 0xff || 1;
    let compSize = 0;
    let hasBaseAnchor = false;

    while (head < tail) {
      const idx = _bfsQueue[head++];
      compSize++;
      const vy = Math.floor(idx / (sx * sz));
      const rem = idx - vy * sx * sz;
      const vz = Math.floor(rem / sx);
      const vx = rem - vz * sx;
      if (vy <= 1) hasBaseAnchor = true;

      if (vx > 0) {
        const ni = idx - 1;
        if (data[ni] !== 0 && _bfsVisited[ni] === 0) {
          _bfsVisited[ni] = 1;
          _bfsQueue[tail++] = ni;
        }
      }
      if (vx + 1 < sx) {
        const ni = idx + 1;
        if (data[ni] !== 0 && _bfsVisited[ni] === 0) {
          _bfsVisited[ni] = 1;
          _bfsQueue[tail++] = ni;
        }
      }
      if (vz > 0) {
        const ni = idx - sx;
        if (data[ni] !== 0 && _bfsVisited[ni] === 0) {
          _bfsVisited[ni] = 1;
          _bfsQueue[tail++] = ni;
        }
      }
      if (vz + 1 < sz) {
        const ni = idx + sx;
        if (data[ni] !== 0 && _bfsVisited[ni] === 0) {
          _bfsVisited[ni] = 1;
          _bfsQueue[tail++] = ni;
        }
      }
      if (vy > 0) {
        const ni = idx - sx * sz;
        if (data[ni] !== 0 && _bfsVisited[ni] === 0) {
          _bfsVisited[ni] = 1;
          _bfsQueue[tail++] = ni;
        }
      }
      if (vy + 1 < sy) {
        const ni = idx + sx * sz;
        if (data[ni] !== 0 && _bfsVisited[ni] === 0) {
          _bfsVisited[ni] = 1;
          _bfsQueue[tail++] = ni;
        }
      }
    }

    const score = compSize + (hasBaseAnchor ? 250 : 0);
    if (score > bestCompSize) {
      bestCompSize = score;
      bestCompRoot = i;
    }
  }

  // If multiple disconnected components exist, keep only the main anchored component and pop loose shards!
  if (componentCount > 1 && bestCompRoot >= 0) {
    _bfsVisited.fill(0, 0, totalCells);
    let head = 0;
    let tail = 0;
    _bfsQueue[tail++] = bestCompRoot;
    _bfsVisited[bestCompRoot] = 1;
    while (head < tail) {
      const idx = _bfsQueue[head++];
      const vy = Math.floor(idx / (sx * sz));
      const rem = idx - vy * sx * sz;
      const vz = Math.floor(rem / sx);
      const vx = rem - vz * sx;

      if (vx > 0 && data[idx - 1] !== 0 && _bfsVisited[idx - 1] === 0) {
        _bfsVisited[idx - 1] = 1;
        _bfsQueue[tail++] = idx - 1;
      }
      if (vx + 1 < sx && data[idx + 1] !== 0 && _bfsVisited[idx + 1] === 0) {
        _bfsVisited[idx + 1] = 1;
        _bfsQueue[tail++] = idx + 1;
      }
      if (vz > 0 && data[idx - sx] !== 0 && _bfsVisited[idx - sx] === 0) {
        _bfsVisited[idx - sx] = 1;
        _bfsQueue[tail++] = idx - sx;
      }
      if (vz + 1 < sz && data[idx + sx] !== 0 && _bfsVisited[idx + sx] === 0) {
        _bfsVisited[idx + sx] = 1;
        _bfsQueue[tail++] = idx + sx;
      }
      if (vy > 0 && data[idx - sx * sz] !== 0 && _bfsVisited[idx - sx * sz] === 0) {
        _bfsVisited[idx - sx * sz] = 1;
        _bfsQueue[tail++] = idx - sx * sz;
      }
      if (vy + 1 < sy && data[idx + sx * sz] !== 0 && _bfsVisited[idx + sx * sz] === 0) {
        _bfsVisited[idx + sx * sz] = 1;
        _bfsQueue[tail++] = idx + sx * sz;
      }
    }

    for (let i = 0; i < totalCells; i++) {
      const mat = data[i];
      if (mat !== 0 && _bfsVisited[i] === 0) {
        data[i] = 0;
        detachedCount++;
        const vy = Math.floor(i / (sx * sz));
        const rem = i - vy * sx * sz;
        const vz = Math.floor(rem / sx);
        const vx = rem - vz * sx;
        pushChip(vx, vy, vz, mat);
      }
    }
  }

  state.remainingVoxels = Math.max(0, state.remainingVoxels - carvedCount - detachedCount);
  state.integrity = state.totalVoxels > 0 ? state.remainingVoxels / state.totalVoxels : 0;

  const allowFullDestroy = options.allowFullDestroy !== false;
  if (
    allowFullDestroy &&
    (state.remainingVoxels <= 0 || state.integrity < tpl.destroyThreshold)
  ) {
    state.destroyed = true;
    state.integrity = 0;
    if (state.damagedGeometry) {
      state.damagedGeometry.dispose();
      state.damagedGeometry = null;
    }
    return {
      carvedCount,
      detachedCount,
      chips,
      integrity: 0,
      destroyed: true,
      geometry: null,
    };
  }

  // Rebuild greedy geometry for ONLY this damaged module (< 0.1ms)
  const newGeo = buildGreedyMicroVoxelGeometry(state.grid, tpl.palette, {
    voxelSize: tpl.voxelSize,
    pivot: tpl.pivot,
    bakeAO: true,
    bakeFaceShade: true,
  });
  newGeo.userData.isSharedPrimitive = false;
  if (state.damagedGeometry) {
    state.damagedGeometry.dispose();
  }
  state.damagedGeometry = newGeo;

  return {
    carvedCount,
    detachedCount,
    chips,
    integrity: state.integrity,
    destroyed: false,
    geometry: newGeo,
  };
}

export function getMicroVoxelTemplateStats(kind: MicroVoxelBlockKind): {
  totalVoxels: number;
  vertexCount: number;
  triangleCount: number;
  hasInnerCoreVoxels: boolean;
} {
  const tpl = getMicroVoxelBlockTemplate(kind);
  const posAttr = tpl.intactGeometry.getAttribute('position');
  const idxAttr = tpl.intactGeometry.getIndex();
  const g = tpl.grid;
  let innerCount = 0;
  for (let y = 1; y < g.sy - 1; y++) {
    for (let z = 1; z < g.sz - 1; z++) {
      for (let x = 1; x < g.sx - 1; x++) {
        if (
          getMicroVoxel(g, x, y, z) !== 0 &&
          getMicroVoxel(g, x - 1, y, z) !== 0 &&
          getMicroVoxel(g, x + 1, y, z) !== 0 &&
          getMicroVoxel(g, x, y - 1, z) !== 0 &&
          getMicroVoxel(g, x, y + 1, z) !== 0 &&
          getMicroVoxel(g, x, y, z - 1) !== 0 &&
          getMicroVoxel(g, x, y, z + 1) !== 0
        ) {
          innerCount++;
        }
      }
    }
  }
  return {
    totalVoxels: tpl.totalVoxels,
    vertexCount: posAttr ? posAttr.count : 0,
    triangleCount: idxAttr ? idxAttr.count / 3 : 0,
    hasInnerCoreVoxels: innerCount > 0,
  };
}
