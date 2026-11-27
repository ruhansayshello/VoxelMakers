export const VOXEL_SIZE = 0.25; // 4x4x4 micro-voxels per meter
export const CHUNK_X = 64;      // 16.0m wide per chunk
export const CHUNK_Y = 320;     // 80.0m vertical height (58 voxels subterranean/sea-level base + up to 256 voxels 1:1 3D volumetric model height!)
export const CHUNK_Z = 64;      // 16.0m deep per chunk
export const SURFACE_CHUNK_Y = 4; // 4 logical surface layers: topMat, subMat, MAT.ROCK, MAT.WATER_VOX

export const WORLD_CHUNKS_X = 16; // 16 x 64 = 1024 micro-voxels (256m)
export const WORLD_CHUNKS_Z = 16; // 16 x 64 = 1024 micro-voxels (1024)
export const TOTAL_VX = WORLD_CHUNKS_X * CHUNK_X; // 1024
export const TOTAL_VZ = WORLD_CHUNKS_Z * CHUNK_Z; // 1024

export const SUBTERRANEAN_DEPTH_VY = 48;          // 48 micro-voxels (12.0m) of deep underground cavern strata
export const WATER_VY = 8 + SUBTERRANEAN_DEPTH_VY; // Water surface at voxel Y=56 (14.0m)
export const STATIC_WATER_TOP_VY = WATER_VY - 1;  // Full static water basin up to Y=55 (top face at 14.0m) with animated waves directly on top!
export const WATER_LEVEL = WATER_VY * VOXEL_SIZE; // 14.0m
export const BASE_SURF_VY = 10 + SUBTERRANEAN_DEPTH_VY; // Default ground surface at voxel Y=58 (14.5m)

// Default starter grid reference (vehicles can now expand unboundedly beyond this!)
export const VEH_DIM_X = 24;
export const VEH_DIM_Y = 20;
export const VEH_DIM_Z = 36;
export const SYMMETRY_CENTER_X = 12; // Symmetry axis at vx = 11.5 (mirrorX = 23 - vx)

export const MAT = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  ROCK: 3,
  ASPHALT: 4,
  ROAD_LINE: 5,
  SAND: 6,
  WATER_VOX: 7,
  CANYON_RED: 8,
  CANYON_ORANGE: 9,
  BRICK: 10,
  CONCRETE: 11,
  STEEL: 12,
  WOOD: 13,
  GLASS_SOLID: 14,
  RAMP_ORANGE: 15,
  C4_EXPLOSIVE: 16,
  ALLOY_BLUE: 17,
  ARMOR_SLATE: 18,
  FLOAT_YELLOW: 19,
  GLOW_CRYSTAL: 20,
  GLOW_MAGMA: 21,
  HEADLIGHT_LAMP: 22,
  PAINT_CRIMSON: 23,
  PAINT_EMERALD: 24,
  PAINT_VIOLET: 25,
  PAINT_MAGENTA: 26,
  PAINT_WHITE: 27,
  PAINT_CARBON: 28,
  PAINT_GOLD: 29,
  PAINT_COPPER: 30,
  PAINT_TEAL: 31,
  PAINT_CAMO: 32,
  NEON_CYAN: 33,
  NEON_PINK: 34,
  NEON_LIME: 35,
  CHROME_SILVER: 36,
  CARBON_WEAVE: 37,
  RUBBER_GRIP: 38,
  ICE_SLICK: 39,
  MAGMA_CORE: 40,
  TUNGSTEN_HEAVY: 41,
  NEON_GOLD: 42,
  BEDROCK: 43,
  HAZARD_YELLOW: 5,
} as const;

export interface MaterialSpec {
  name: string;
  color: number;
  mass: number;
  buoy: number;
  friction: number;
  restitution: number;
  yieldEnergy: number;
  explosive?: boolean;
  emissive?: boolean;
}

// Vibrant, rich outdoor & subterranean palette with multi-tone vertex shading support
export const MAT_INFO: Record<number, MaterialSpec> = {
  [MAT.GRASS]:          { name: 'Vibrant Meadow Grass', color: 0x38b000, mass: 10, buoy: 5,  friction: 0.92, restitution: 0.12, yieldEnergy: 9500 },
  [MAT.DIRT]:           { name: 'Rich Loam Soil',       color: 0x8d5524, mass: 11, buoy: 5,  friction: 0.85, restitution: 0.10, yieldEnergy: 9000 },
  [MAT.ROCK]:           { name: 'Deep Cavern Stone',    color: 0x5c6b73, mass: 18, buoy: 4,  friction: 1.05, restitution: 0.22, yieldEnergy: 28000 },
  [MAT.ASPHALT]:        { name: 'Tarmac Asphalt',       color: 0x1e2631, mass: 16, buoy: 4,  friction: 1.24, restitution: 0.18, yieldEnergy: 22000 },
  [MAT.ROAD_LINE]:      { name: 'Highway Gold Line',    color: 0xfacc15, mass: 16, buoy: 4,  friction: 1.22, restitution: 0.18, yieldEnergy: 22000 },
  [MAT.SAND]:           { name: 'Golden Dune Sand',     color: 0xf4d35e, mass: 12, buoy: 5,  friction: 0.74, restitution: 0.06, yieldEnergy: 7500 },
  [MAT.WATER_VOX]:      { name: 'Cerulean Water',       color: 0x0080ff, mass: 10, buoy: 10, friction: 0.30, restitution: 0.02, yieldEnergy: 999999 },
  [MAT.CANYON_RED]:     { name: 'Crimson Red-Rock',     color: 0xc84b31, mass: 16, buoy: 4,  friction: 1.02, restitution: 0.20, yieldEnergy: 18000 },
  [MAT.CANYON_ORANGE]:  { name: 'Sunburst Sandstone',   color: 0xec7d10, mass: 15, buoy: 4,  friction: 1.00, restitution: 0.18, yieldEnergy: 16000 },
  [MAT.BRICK]:          { name: 'Fired Clay Brick',     color: 0xc1121f, mass: 12, buoy: 4,  friction: 0.95, restitution: 0.16, yieldEnergy: 6200 },
  [MAT.CONCRETE]:       { name: 'Reinforced Concrete',  color: 0x8d99ae, mass: 16, buoy: 4,  friction: 1.08, restitution: 0.20, yieldEnergy: 11000 },
  [MAT.STEEL]:          { name: 'Gunmetal Steel',       color: 0x334155, mass: 26, buoy: 4,  friction: 0.92, restitution: 0.28, yieldEnergy: 24000 },
  [MAT.WOOD]:           { name: 'Cedar Plank Timber',   color: 0xb5651d, mass: 7,  buoy: 22, friction: 0.88, restitution: 0.15, yieldEnergy: 4800 },
  [MAT.GLASS_SOLID]:    { name: 'Crystal Canopy Glass', color: 0x38bdf8, mass: 5,  buoy: 5,  friction: 0.65, restitution: 0.25, yieldEnergy: 1800 },
  [MAT.RAMP_ORANGE]:    { name: 'Nitro Stunt Track',    color: 0xff5400, mass: 18, buoy: 4,  friction: 1.28, restitution: 0.15, yieldEnergy: 32000 },
  [MAT.C4_EXPLOSIVE]:   { name: 'Volatile C4 Charge',   color: 0xe63946, mass: 7,  buoy: 8,  friction: 0.85, restitution: 0.15, yieldEnergy: 2200, explosive: true },
  [MAT.ALLOY_BLUE]:     { name: 'Cobalt Aero Alloy',    color: 0x00b4d8, mass: 7,  buoy: 11, friction: 0.90, restitution: 0.20, yieldEnergy: 12000 },
  [MAT.ARMOR_SLATE]:    { name: 'Titanium Slate Armor', color: 0x64748b, mass: 22, buoy: 6,  friction: 0.95, restitution: 0.24, yieldEnergy: 26000 },
  [MAT.FLOAT_YELLOW]:   { name: 'Buoyant Pontoon Gold', color: 0xffbe0b, mass: 3,  buoy: 68, friction: 0.80, restitution: 0.22, yieldEnergy: 8000 },
  [MAT.GLOW_CRYSTAL]:   { name: 'Cave Glow Crystal',    color: 0x00f5d4, mass: 12, buoy: 8,  friction: 0.95, restitution: 0.30, yieldEnergy: 15000, emissive: true },
  [MAT.GLOW_MAGMA]:     { name: 'Molten Magma Ore',     color: 0xff6b00, mass: 20, buoy: 4,  friction: 1.05, restitution: 0.15, yieldEnergy: 19000, emissive: true },
  [MAT.HEADLIGHT_LAMP]: { name: 'Halogen Glow Block',   color: 0xfef08a, mass: 6,  buoy: 9,  friction: 0.85, restitution: 0.20, yieldEnergy: 9000,  emissive: true },
  [MAT.PAINT_CRIMSON]:  { name: 'Crimson Racing Red',   color: 0xef4444, mass: 7,  buoy: 11, friction: 0.90, restitution: 0.20, yieldEnergy: 12500 },
  [MAT.PAINT_EMERALD]:  { name: 'Emerald Nitro Green',  color: 0x10b981, mass: 7,  buoy: 11, friction: 0.90, restitution: 0.20, yieldEnergy: 12500 },
  [MAT.PAINT_VIOLET]:   { name: 'Royal Cyber Violet',   color: 0x8b5cf6, mass: 7,  buoy: 11, friction: 0.90, restitution: 0.20, yieldEnergy: 12500 },
  [MAT.PAINT_MAGENTA]:  { name: 'Neon Synth Pink',      color: 0xec4899, mass: 7,  buoy: 11, friction: 0.90, restitution: 0.20, yieldEnergy: 12500 },
  [MAT.PAINT_WHITE]:    { name: 'Arctic Pearl White',   color: 0xf8fafc, mass: 7,  buoy: 11, friction: 0.90, restitution: 0.20, yieldEnergy: 12500 },
  [MAT.PAINT_CARBON]:   { name: 'Carbon Weave Black',   color: 0x111827, mass: 6,  buoy: 12, friction: 0.95, restitution: 0.22, yieldEnergy: 16000 },
  [MAT.PAINT_GOLD]:     { name: '24K Chrome Gold',      color: 0xf59e0b, mass: 10, buoy: 9,  friction: 0.88, restitution: 0.24, yieldEnergy: 15000 },
  [MAT.PAINT_COPPER]:   { name: 'Brushed Copper Alloy', color: 0xd97706, mass: 9,  buoy: 10, friction: 0.90, restitution: 0.22, yieldEnergy: 14000 },
  [MAT.PAINT_TEAL]:     { name: 'Deep Lagoon Teal',     color: 0x14b8a6, mass: 7,  buoy: 11, friction: 0.90, restitution: 0.20, yieldEnergy: 12500 },
  [MAT.PAINT_CAMO]:     { name: 'Tactical Olive Camo',  color: 0x4d7c0f, mass: 9,  buoy: 10, friction: 0.94, restitution: 0.20, yieldEnergy: 15000 },
  [MAT.NEON_CYAN]:      { name: 'Neon Cyber Cyan',      color: 0x00f5ff, mass: 6,  buoy: 10, friction: 0.88, restitution: 0.22, yieldEnergy: 12000, emissive: true },
  [MAT.NEON_PINK]:      { name: 'Neon Laser Pink',      color: 0xff007f, mass: 6,  buoy: 10, friction: 0.88, restitution: 0.22, yieldEnergy: 12000, emissive: true },
  [MAT.NEON_LIME]:      { name: 'Neon Venom Lime',      color: 0x39ff14, mass: 6,  buoy: 10, friction: 0.88, restitution: 0.22, yieldEnergy: 12000, emissive: true },
  [MAT.CHROME_SILVER]:  { name: 'Mirror Chrome Silver', color: 0xe2e8f0, mass: 9,  buoy: 10, friction: 0.86, restitution: 0.25, yieldEnergy: 16000 },
  [MAT.CARBON_WEAVE]:   { name: 'Aero Carbon Weave',    color: 0x1e293b, mass: 4,  buoy: 18, friction: 0.96, restitution: 0.28, yieldEnergy: 29000 },
  [MAT.RUBBER_GRIP]:    { name: 'High-Grip Tire Rubber',color: 0x0f172a, mass: 11, buoy: 14, friction: 1.68, restitution: 0.88, yieldEnergy: 34000 },
  [MAT.ICE_SLICK]:      { name: 'Zero-Friction Cryo Ice',color: 0xa5f3fc, mass: 8,  buoy: 12, friction: 0.04, restitution: 0.15, yieldEnergy: 11000 },
  [MAT.MAGMA_CORE]:     { name: 'Plasma Reactor Core',  color: 0xff3b00, mass: 14, buoy: 16, friction: 1.02, restitution: 0.32, yieldEnergy: 31000, explosive: true, emissive: true },
  [MAT.TUNGSTEN_HEAVY]: { name: 'Depleted Tungsten Ram',color: 0x3f3f46, mass: 48, buoy: 1,  friction: 1.12, restitution: 0.18, yieldEnergy: 58000 },
  [MAT.NEON_GOLD]:      { name: 'Solar Gold Beacon',    color: 0xfde047, mass: 6,  buoy: 12, friction: 0.88, restitution: 0.24, yieldEnergy: 14500, emissive: true },
  [MAT.BEDROCK]:        { name: 'Indestructible Bedrock', color: 0x1f2937, mass: 100, buoy: 0, friction: 1.15, restitution: 0.10, yieldEnergy: 999999 },
};

export type ModuleKind =
  // 1. Seats & Pilot Controls
  | 'COCKPIT'
  | 'SEAT_KART'
  | 'SEAT_MOTO'
  | 'SEAT_OPERATOR'
  | 'SEAT_ARMORED'
  | 'SEAT_DIVING'
  | 'SEAT_SPACE'
  | 'SEAT_SHIP_WHEEL'
  // 2. Propulsion & Engines
  | 'ENGINE_BULLDAWG'
  | 'V8_ENGINE'
  | 'ENGINE_DRAGON'
  | 'THRUSTER_MINI'
  | 'THRUSTER_ROCKET'
  | 'THRUSTER'
  | 'JET_RAW'
  | 'JET_GIMBAL'
  | 'VTOL_ROTOR'
  | 'PROP_AERO'
  | 'BOAT_PROP'
  | 'BOAT_OUTBOARD'
  // 3. Traction, Wheels & Sliders
  | 'WHEEL_STEER'
  | 'WHEEL_DRIVE'
  | 'WHEEL_RACING'
  | 'WHEEL_MONSTER'
  | 'WHEEL_KART'
  | 'WHEEL_DRAG'
  | 'WHEEL_SPIKED'
  | 'SKI_SLIDER'
  // 4. Mechanical, Articulation Joints & Gyros
  | 'SUSPENSION'
  | 'STEERING_HINGE'
  | 'GYRO'
  | 'GYRO_REACTION'
  | 'HINGE_LARGE'
  | 'HINGE_TRAILER'
  | 'SERVO_SPIN'
  | 'SERVO_SMALL'
  | 'JOINT_MECH'
  | 'PISTON'
  | 'DETACHABLE_BLOCK'
  | 'GRAPPLING_WINCH'
  // 5. Aerodynamics, Lift & Drag
  | 'AERO_WING'
  | 'WING_STANDARD'
  | 'SPOILER'
  | 'TAILFIN'
  | 'TAILFIN_POWERED'
  | 'AERO_BLADE'
  // 6. Balance & Nautical Buoyancy
  | 'WEIGHT_BLOCK'
  | 'PONTOON_LARGE'
  | 'BCD_TANK'
  // 7. Gadgets, Sensors & Automation Logic
  | 'MICROBIT_ECU'
  | 'SENSOR_DISTANCE'
  | 'SENSOR_IMU_TILT'
  | 'SENSOR_SPEEDO'
  | 'SENSOR_TARGET_RADAR'
  | 'SENSOR_SPEED'
  | 'SENSOR_ALTIMETER'
  | 'SENSOR_ANGLE'
  | 'SENSOR_POSITION'
  | 'RADIO_TRX'
  | 'LOGIC_GATE'
  | 'HEADLIGHT'
  // 8. Weapons & Combat Utilities
  | 'PLASMA_CANNON'
  | 'WEAPON_MINIGUN'
  | 'WEAPON_ROCKET'
  | 'WEAPON_BOMB_BAY'
  | 'WEAPON_MELEE'
  // 9. Cosmetics, Trim & Visual Accessories
  | 'COSMETIC_RACING_FIN'
  | 'COSMETIC_EXHAUST_STACK'
  | 'COSMETIC_BULLBAR'
  | 'COSMETIC_NEON_STRIP'
  | 'COSMETIC_SIREN_BAR'
  | 'COSMETIC_RADAR_DOME'
  | 'COSMETIC_HORN_BUGLE'
  | 'COSMETIC_PIRATE_FLAG'
  // 10. Advanced Tactical & Engineering Modules
  | 'TURRET_RING'
  | 'MAGNET_COUPLER'
  | 'TANK_TREAD'
  | 'PARACHUTE_AIRBRAKE'
  | 'OUTRIGGER_JACK'
  | 'IMPULSE_BUMPER'
  | 'SMOKE_FLARE';

export interface ModuleTuningConfig {
  posKey?: string;
  negKey?: string;
  toggleMode?: boolean;
  autoReset?: boolean;
  maxAngleDeg?: number;
  steeringHelp?: number;
  stiffness?: number;
  damping?: number;
  strength?: number;
  forwardTraction?: number;
  sidewaysTraction?: number;
  threshold?: number;
  gateType?: 'AND' | 'OR' | 'XOR' | 'NAND' | 'NOR';
  channel?: number;
  accentHex?: string;
  disabled?: boolean;
}

export function isWheelOrTireModuleKind(
  kind: ModuleKind | null | undefined,
): boolean {
  if (!kind) return false;
  return (
    kind === 'WHEEL_STEER' ||
    kind === 'WHEEL_DRIVE' ||
    kind === 'WHEEL_RACING' ||
    kind === 'WHEEL_MONSTER' ||
    kind === 'WHEEL_KART' ||
    kind === 'WHEEL_DRAG' ||
    kind === 'WHEEL_SPIKED' ||
    kind === 'SKI_SLIDER' ||
    kind === 'TANK_TREAD'
  );
}

export interface TireTractionPreset {
  id: string;
  label: string;
  forwardTraction: number;
  sidewaysTraction: number;
  desc: string;
}

export const TIRE_TRACTION_PRESETS: TireTractionPreset[] = [
  {
    id: 'BALANCED',
    label: 'STREET BALANCED',
    forwardTraction: 1.0,
    sidewaysTraction: 1.0,
    desc: 'Balanced 1.0x longitudinal & lateral grip',
  },
  {
    id: 'DRIFT',
    label: 'DRIFT COMPOUND',
    forwardTraction: 1.35,
    sidewaysTraction: 0.35,
    desc: 'Strong forward push with loose rear/side slip',
  },
  {
    id: 'SLICK',
    label: 'RACING SLICK',
    forwardTraction: 1.65,
    sidewaysTraction: 1.85,
    desc: 'High cornering lateral grip & tarmac launch',
  },
  {
    id: 'DRAG',
    label: 'DRAG RADIAL',
    forwardTraction: 2.25,
    sidewaysTraction: 0.85,
    desc: 'Maximum straight-line launch traction',
  },
  {
    id: 'RALLY',
    label: 'RALLY GRAVEL',
    forwardTraction: 1.3,
    sidewaysTraction: 0.7,
    desc: 'Responsive off-road drive with controlled slide',
  },
  {
    id: 'CRAWLER',
    label: 'ROCK CRAWLER',
    forwardTraction: 1.85,
    sidewaysTraction: 1.65,
    desc: 'Heavy climbing bite & side-slope hold',
  },
  {
    id: 'ICE',
    label: 'LOW-GRIP ICE',
    forwardTraction: 0.45,
    sidewaysTraction: 0.2,
    desc: 'Ultra-low friction skating physics',
  },
];


export type BuildCategory =
  | 'ALL'
  | 'CHASSIS'
  | 'SEATS'
  | 'PROPULSION'
  | 'WHEELS'
  | 'MECHANICAL'
  | 'AERODYNAMICS'
  | 'BUOYANCY'
  | 'LOGIC'
  | 'WEAPONS'
  | 'COSMETICS'
  | 'GADGETS';

export const BUILD_CATEGORY_META: Array<{
  id: Exclude<BuildCategory, 'GADGETS'>;
  label: string;
  shortLabel: string;
  accent: string;
}> = [
  { id: 'ALL',          label: 'All Blueprint Parts',        shortLabel: 'ALL',     accent: '#fbbf24' },
  { id: 'CHASSIS',      label: '0. Hull & Chassis Blocks',   shortLabel: 'HULL',    accent: '#fbbf24' },
  { id: 'SEATS',        label: '1. Seats & Pilot Controls',  shortLabel: 'SEATS',   accent: '#fbbf24' },
  { id: 'PROPULSION',   label: '2. Propulsion & Engines',    shortLabel: 'ENGINES', accent: '#fbbf24' },
  { id: 'WHEELS',       label: '3. Traction, Wheels & Skis', shortLabel: 'WHEELS',  accent: '#fbbf24' },
  { id: 'MECHANICAL',   label: '4. Suspensions, Servos & Gyros', shortLabel: 'MECH', accent: '#fbbf24' },
  { id: 'AERODYNAMICS', label: '5. Aerodynamics, Lift & Drag', shortLabel: 'AERO',  accent: '#fbbf24' },
  { id: 'BUOYANCY',     label: '6. Weights & Buoyancy',      shortLabel: 'FLOAT',   accent: '#fbbf24' },
  { id: 'LOGIC',        label: '7. Sensors & Logic Gates',   shortLabel: 'LOGIC',   accent: '#fbbf24' },
  { id: 'WEAPONS',      label: '8. Weapons & Combat',        shortLabel: 'WEAPONS', accent: '#dc2626' },
  { id: 'COSMETICS',    label: '9. Cosmetics, Paint & Skins',shortLabel: 'STYLE',   accent: '#fbbf24' },
];

export type CameraViewMode =
  | 'CHASE'
  | 'FIRST_PERSON'
  | 'ACTION_WHEEL'
  | 'TOP_DOWN'
  | 'FREE_ORBIT';

export const CAMERA_MODES: Array<{ id: CameraViewMode; label: string }> = [
  { id: 'CHASE', label: 'Chase Cam' },
  { id: 'FIRST_PERSON', label: 'Cockpit POV' },
  { id: 'ACTION_WHEEL', label: 'Wheel Cam' },
  { id: 'TOP_DOWN', label: 'Drone Top-Down' },
  { id: 'FREE_ORBIT', label: 'Free Orbit' },
];

export type BuildPlacementMode =
  | 'SINGLE'
  | 'BOX_FILL'
  | 'LINE_DRAG'
  | 'PLATE_3X3'
  | 'PLATE_5X5'
  | 'BEAM_6'
  | 'PAINT'
  | 'CHISEL'
  | 'PAINT_TOOL'
  | 'FLOOD_PAINT'
  | 'FACE_EXTRUDE';

export const PLACEMENT_MODES: Array<{
  id: BuildPlacementMode;
  label: string;
  shortLabel: string;
  desc: string;
}> = [
  { id: 'SINGLE',       label: '1×1 Dot',         shortLabel: '1×1 Dot',  desc: 'Precision single 1px micro-voxel (or 4×4×4 cluster in 4px Block mode) or module' },
  { id: 'BOX_FILL',     label: 'Rect / 3D Box',   shortLabel: 'Box Fill', desc: 'Drag out a 1px sheet, wall, or 3D box (Q/E adjusts slab depth 1..8px)' },
  { id: 'LINE_DRAG',    label: '1px Line',        shortLabel: 'Line',     desc: 'Click & drag to stretch a 1px trim line or structural beam' },
  { id: 'BEAM_6',       label: '6-Voxel Beam',    shortLabel: 'Beam×6',   desc: 'Extrude a 6-voxel spar along surface normal' },
  { id: 'PLATE_3X3',    label: '4×4 Plate',       shortLabel: '4×4',      desc: 'Stamp a 4×4×1 1px micro-plate (= 1 standard block face at 1px thickness)' },
  { id: 'PLATE_5X5',    label: '8×8 Panel',       shortLabel: '8×8',      desc: 'Stamp an 8×8×1 1px hull panel (= 2×2 block deck at 1px thickness)' },
  { id: 'PAINT',        label: 'Continuous Sweep',shortLabel: 'Sweep',    desc: 'Hold L-Click & sweep to weld 1px voxels rapidly' },
  { id: 'CHISEL',       label: '1px Chisel',      shortLabel: 'Chisel',   desc: 'Carve & shave 1px micro-voxels (or 4×4×4 blocks) on Left-Click' },
  { id: 'PAINT_TOOL',   label: 'Paint Tool',      shortLabel: 'Paint',    desc: 'Recolor/change material of existing voxels without deleting them' },
  { id: 'FLOOD_PAINT',  label: 'Flood Paint',     shortLabel: 'Flood',    desc: 'One-click contiguous color bucket fill across matching hull blocks' },
  { id: 'FACE_EXTRUDE', label: '1px Extrude',     shortLabel: 'Extrude',  desc: 'One-click extrude an entire contiguous coplanar face outward by 1px (or Q/E depth)' },
];

export interface BuildSlotItem {
  slot: number;
  key: string;
  type: 'voxel' | 'module';
  category: Exclude<BuildCategory, 'ALL'>;
  mat?: number;
  kind?: ModuleKind;
  name: string;
  tag: string;
  color: string;
  massKg: number;
  powerCores: number;
  defaultConfig?: ModuleTuningConfig;
}

export const BUILD_SLOTS: BuildSlotItem[] = [
  // --- CORE 1-14 SLOTS (Preserves keyboard hotkeys 1-0, -, =, X, T & existing test indices) ---
  { slot: 1,  key: '1', type: 'voxel',  category: 'CHASSIS',      mat: MAT.ALLOY_BLUE,     name: 'Light Alloy',        tag: 'Chassis Block · 7kg',         color: '#38bdf8', massKg: 7,   powerCores: 0 },
  { slot: 2,  key: '2', type: 'voxel',  category: 'CHASSIS',      mat: MAT.ARMOR_SLATE,    name: 'Heavy Armor',        tag: 'Armored Steel · 22kg',        color: '#94a3b8', massKg: 22,  powerCores: 0 },
  { slot: 3,  key: '3', type: 'voxel',  category: 'BUOYANCY',     mat: MAT.FLOAT_YELLOW,   name: 'Float Pontoon Voxel',tag: '38x Buoyancy · 3kg',          color: '#facc15', massKg: 3,   powerCores: 0 },
  { slot: 4,  key: '4', type: 'module', category: 'SEATS',        kind: 'COCKPIT',         name: 'Standard Cockpit',   tag: 'Enclosed Cab · Weight Shift', color: '#eab308', massKg: 35,  powerCores: 0, defaultConfig: { posKey: 'KeyA', negKey: 'KeyD', strength: 1.0 } },
  { slot: 5,  key: '5', type: 'module', category: 'WHEELS',       kind: 'WHEEL_STEER',     name: 'Steer Wheel Hub',    tag: 'Steerable Wheel · 38kg',      color: '#f59e0b', massKg: 38,  powerCores: 0, defaultConfig: { posKey: 'KeyA', negKey: 'KeyD', maxAngleDeg: 32, steeringHelp: 0.6 } },
  { slot: 6,  key: '6', type: 'module', category: 'WHEELS',       kind: 'WHEEL_DRIVE',     name: 'Offroad Wheel',      tag: 'Deep Dirt Tread · 42kg',      color: '#10b981', massKg: 42,  powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.0 } },
  { slot: 7,  key: '7', type: 'module', category: 'PROPULSION',   kind: 'V8_ENGINE',       name: 'RAW V8 Engine',      tag: 'Extreme Torque · Overheat Risk', color: '#ec4899', massKg: 85, powerCores: 2, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.3 } },
  { slot: 8,  key: '8', type: 'module', category: 'PROPULSION',   kind: 'THRUSTER',        name: 'Dragon Jet',         tag: '[Shift] Sustained Jet · 45kg',color: '#06b6d4', massKg: 45,  powerCores: 2, defaultConfig: { posKey: 'ShiftLeft', strength: 1.0 } },
  { slot: 9,  key: '9', type: 'module', category: 'PROPULSION',   kind: 'BOAT_PROP',       name: 'Underwater Prop',    tag: 'Hydrodynamic Thrust · 35kg',  color: '#22d3ee', massKg: 35,  powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.0 } },
  { slot: 10, key: '0', type: 'module', category: 'AERODYNAMICS', kind: 'AERO_WING',       name: 'Modular Wing',       tag: 'Airfoil Lift Plate · 22kg',   color: '#a855f7', massKg: 22,  powerCores: 0 },
  { slot: 11, key: '-', type: 'module', category: 'PROPULSION',   kind: 'VTOL_ROTOR',      name: 'Helicopter Engine',  tag: '[Space/Ctrl] Rotor Lift · 55kg', color: '#34d399', massKg: 55, powerCores: 2, defaultConfig: { posKey: 'Space', negKey: 'ControlLeft', strength: 1.0 } },
  { slot: 12, key: '=', type: 'module', category: 'WEAPONS',      kind: 'PLASMA_CANNON',   name: 'Tank Cannon',        tag: 'Ballistic Recoil · 55kg',     color: '#fb7185', massKg: 55,  powerCores: 2, defaultConfig: { posKey: 'KeyF', strength: 1.0 } },
  { slot: 13, key: 'X', type: 'module', category: 'MECHANICAL',   kind: 'PISTON',          name: 'Hydraulic Piston',   tag: '[X] Hydraulic Rod · Toggle Ext/Ret', color: '#f97316', massKg: 28, powerCores: 1, defaultConfig: { posKey: 'KeyX', negKey: 'KeyQ', toggleMode: true, autoReset: true, strength: 1.0 } },
  { slot: 14, key: 'T', type: 'module', category: 'MECHANICAL',   kind: 'GRAPPLING_WINCH', name: 'Grapple Winch',      tag: '[T] Tow Cable · 32kg',        color: '#38bdf8', massKg: 32,  powerCores: 1, defaultConfig: { posKey: 'KeyT' } },

  // --- 0. ADDITIONAL CHASSIS MATERIALS ---
  { slot: 15, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.STEEL,          name: 'Reinforced Steel',   tag: 'Heavy Frame · 26kg',          color: '#475569', massKg: 26,  powerCores: 0 },
  { slot: 16, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.WOOD,           name: 'Harbor Timber',      tag: 'Light Wood Deck · 7kg',       color: '#d97706', massKg: 7,   powerCores: 0 },
  { slot: 17, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.GLASS_SOLID,    name: 'Canopy Glass',       tag: 'Windshield Pane · 5kg',       color: '#7dd3fc', massKg: 5,   powerCores: 0 },
  { slot: 18, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.C4_EXPLOSIVE,   name: 'Volatile C4 Block',  tag: 'Explosive Detonation · 7kg',  color: '#ef4444', massKg: 7,   powerCores: 0 },

  // --- 1. SEATS & PILOT CONTROLS ---
  { slot: 19, key: '',  type: 'module', category: 'SEATS',        kind: 'SEAT_KART',       name: 'Go-Kart Seat',       tag: 'Ultra-Light 12kg · Fast Cam', color: '#facc15', massKg: 12,  powerCores: 0, defaultConfig: { posKey: 'KeyA', negKey: 'KeyD', strength: 1.4 } },
  { slot: 20, key: '',  type: 'module', category: 'SEATS',        kind: 'SEAT_MOTO',       name: 'Motorcycle Seat',    tag: '1×2 Narrow Saddle · Lean Shift', color: '#f97316', massKg: 18, powerCores: 0, defaultConfig: { posKey: 'KeyA', negKey: 'KeyD', strength: 1.8 } },
  { slot: 21, key: '',  type: 'module', category: 'SEATS',        kind: 'SEAT_OPERATOR',   name: 'Operator Seat',      tag: 'Industrial Cab · 40kg',       color: '#f59e0b', massKg: 40,  powerCores: 0 },
  { slot: 22, key: '',  type: 'module', category: 'SEATS',        kind: 'SEAT_ARMORED',    name: 'Armored Seat',       tag: 'Heavy Blast Cage · 95kg',     color: '#64748b', massKg: 95,  powerCores: 0 },
  { slot: 23, key: '',  type: 'module', category: 'SEATS',        kind: 'SEAT_DIVING',     name: 'Diving Bell',        tag: 'Submarine Capsule · 110kg',   color: '#06b6d4', massKg: 110, powerCores: 0 },
  { slot: 24, key: '',  type: 'module', category: 'SEATS',        kind: 'SEAT_SPACE',      name: 'Spaceship Cockpit',  tag: 'Zero-G Gyro Cabin · 55kg',    color: '#38bdf8', massKg: 55,  powerCores: 1, defaultConfig: { strength: 1.2 } },
  { slot: 25, key: '',  type: 'module', category: 'SEATS',        kind: 'SEAT_SHIP_WHEEL', name: 'Ship Helm Wheel',    tag: 'Nautical Hull Rudder · 30kg', color: '#b45309', massKg: 30,  powerCores: 0 },

  // --- 2. PROPULSION & ENGINES ---
  { slot: 26, key: '',  type: 'module', category: 'PROPULSION',   kind: 'ENGINE_BULLDAWG', name: 'Bulldawg Engine',    tag: 'Entry 4-Cyl · Linear Torque', color: '#f97316', massKg: 55,  powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 0.85 } },
  { slot: 27, key: '',  type: 'module', category: 'PROPULSION',   kind: 'ENGINE_DRAGON',   name: 'Dragon V12 Engine',  tag: 'Instant Acceleration · 95kg', color: '#ef4444', massKg: 95,  powerCores: 3, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.65 } },
  { slot: 28, key: '',  type: 'module', category: 'PROPULSION',   kind: 'THRUSTER_MINI',   name: 'Mini Thruster',      tag: 'Micro Flight RCS · 15kg',     color: '#38bdf8', massKg: 15,  powerCores: 1, defaultConfig: { posKey: 'ShiftLeft', strength: 0.45 } },
  { slot: 29, key: '',  type: 'module', category: 'PROPULSION',   kind: 'THRUSTER_ROCKET', name: 'Rocket Thruster',    tag: 'Solid Fuel Burst · 50kg',     color: '#f43f5e', massKg: 50,  powerCores: 2, defaultConfig: { posKey: 'ShiftLeft', strength: 1.6 } },
  { slot: 30, key: '',  type: 'module', category: 'PROPULSION',   kind: 'JET_RAW',         name: 'RAW Afterburner Jet',tag: 'Extreme Speed · High Heat',   color: '#fb923c', massKg: 75,  powerCores: 3, defaultConfig: { posKey: 'ShiftLeft', strength: 2.1 } },
  { slot: 31, key: '',  type: 'module', category: 'PROPULSION',   kind: 'JET_GIMBAL',      name: 'Gimbal Hover Jet',   tag: 'Vertical CoM Auto-Hover · 48kg', color: '#2dd4bf', massKg: 48, powerCores: 2, defaultConfig: { posKey: 'Space', negKey: 'ControlLeft', strength: 1.2 } },
  { slot: 32, key: '',  type: 'module', category: 'PROPULSION',   kind: 'PROP_AERO',       name: 'Aircraft Propeller', tag: 'Low-Alt Air Thrust · 28kg',   color: '#a3e635', massKg: 28,  powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 0.9 } },
  { slot: 33, key: '',  type: 'module', category: 'PROPULSION',   kind: 'BOAT_OUTBOARD',   name: 'Outboard Boat Motor',tag: 'Aquatic Thrust + Steering Yaw', color: '#0ea5e9', massKg: 42, powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.15 } },

  // --- 3. TRACTION, WHEELS & SLIDERS ---
  { slot: 34, key: '',  type: 'module', category: 'WHEELS',       kind: 'WHEEL_RACING',    name: 'Racing Slick Wheel', tag: 'Max Tarmac Grip · 32kg',      color: '#ef4444', massKg: 32,  powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.1 } },
  { slot: 35, key: '',  type: 'module', category: 'WHEELS',       kind: 'WHEEL_MONSTER',   name: 'Monster Truck Wheel',tag: 'Oversized + Floatation · 68kg', color: '#84cc16', massKg: 68, powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.25 } },
  { slot: 36, key: '',  type: 'module', category: 'WHEELS',       kind: 'WHEEL_KART',      name: 'Go-Kart Slim Wheel', tag: 'Light Compact Tire · 16kg',   color: '#38bdf8', massKg: 16,  powerCores: 0, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 0.8 } },
  { slot: 37, key: '',  type: 'module', category: 'WHEELS',       kind: 'WHEEL_DRAG',      name: 'Dragster Wide Slick',tag: '2.2x Launch Grip · 48kg',     color: '#f59e0b', massKg: 48,  powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.5 } },
  { slot: 38, key: '',  type: 'module', category: 'WHEELS',       kind: 'WHEEL_SPIKED',    name: 'Spiked Ice Wheel',   tag: 'Zero Ice Slip · 44kg',        color: '#67e8f9', massKg: 44,  powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.1 } },
  { slot: 39, key: '',  type: 'module', category: 'WHEELS',       kind: 'SKI_SLIDER',      name: 'Carving Ski Runner', tag: 'Low-Friction Snow/Sand Slide', color: '#e2e8f0', massKg: 18, powerCores: 0, defaultConfig: { posKey: 'KeyA', negKey: 'KeyD', maxAngleDeg: 28 } },

  // --- 4. MECHANICAL, ARTICULATION JOINTS & GYROS ---
  { slot: 40, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'SUSPENSION',      name: 'Coilover Suspension',tag: 'Spring + Damper Strut · 24kg',color: '#facc15', massKg: 24,  powerCores: 0, defaultConfig: { stiffness: 1.0, damping: 1.0 } },
  { slot: 41, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'STEERING_HINGE',  name: 'Steering Hinge',     tag: 'Turns Attached Wheels · 22kg',color: '#f97316', massKg: 22,  powerCores: 0, defaultConfig: { posKey: 'KeyA', negKey: 'KeyD', maxAngleDeg: 35, steeringHelp: 0.65 } },
  { slot: 42, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'GYRO',            name: 'Gyro Stabilizer',    tag: 'Auto-Upright 2-Wheelers · 45kg', color: '#38bdf8', massKg: 45, powerCores: 1, defaultConfig: { posKey: 'KeyG', toggleMode: true, strength: 1.0 } },
  { slot: 43, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'GYRO_REACTION',   name: 'Reaction Wheel Gyro',tag: 'Active Pitch/Roll Torque · 38kg', color: '#06b6d4', massKg: 38, powerCores: 1, defaultConfig: { posKey: 'ArrowUp', negKey: 'ArrowDown', strength: 1.2 } },
  { slot: 44, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'HINGE_LARGE',     name: 'Large Power Hinge',  tag: 'High-Torque Pivot · 36kg',    color: '#fb923c', massKg: 36,  powerCores: 1, defaultConfig: { posKey: 'KeyQ', negKey: 'KeyE', maxAngleDeg: 60, strength: 1.2 } },
  { slot: 45, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'HINGE_TRAILER',   name: 'Trailer Ball Hinge', tag: 'Free-Floating Tow Joint · 20kg', color: '#94a3b8', massKg: 20, powerCores: 0 },
  { slot: 46, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'SERVO_SPIN',      name: '360° Spinning Servo',tag: 'Continuous Motor RPM · 28kg', color: '#10b981', massKg: 28,  powerCores: 1, defaultConfig: { posKey: 'KeyQ', negKey: 'KeyE', strength: 1.0 } },
  { slot: 47, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'SERVO_SMALL',     name: 'Small 1×1 Servo',    tag: 'Compact Side Connector · 14kg', color: '#34d399', massKg: 14, powerCores: 0, defaultConfig: { posKey: 'KeyA', negKey: 'KeyD', maxAngleDeg: 45 } },
  { slot: 48, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'JOINT_MECH',      name: 'Mech Limb Joint',    tag: '5°–90° Articulator · 18kg',   color: '#c084fc', massKg: 18,  powerCores: 0, defaultConfig: { posKey: 'KeyZ', negKey: 'KeyC', maxAngleDeg: 45 } },
  { slot: 49, key: '',  type: 'module', category: 'MECHANICAL',   kind: 'DETACHABLE_BLOCK',name: 'Detachable Bolt',    tag: 'Pyrotechnic Stage Split · 15kg', color: '#ef4444', massKg: 15, powerCores: 0, defaultConfig: { posKey: 'KeyU' } },

  // --- 5. AERODYNAMICS, LIFT & DRAG ---
  { slot: 50, key: '',  type: 'module', category: 'AERODYNAMICS', kind: 'WING_STANDARD',   name: 'Standard Airfoil',   tag: 'High-Lift Main Wing · 26kg',  color: '#8b5cf6', massKg: 26,  powerCores: 0 },
  { slot: 51, key: '',  type: 'module', category: 'AERODYNAMICS', kind: 'SPOILER',         name: 'Downforce Spoiler',  tag: 'Inverted Lift Tire Grip · 18kg', color: '#ec4899', massKg: 18, powerCores: 0 },
  { slot: 52, key: '',  type: 'module', category: 'AERODYNAMICS', kind: 'TAILFIN',         name: 'Vertical Tailfin',   tag: 'Eliminates Yaw Drift · 16kg', color: '#6366f1', massKg: 16,  powerCores: 0 },
  { slot: 53, key: '',  type: 'module', category: 'AERODYNAMICS', kind: 'TAILFIN_POWERED', name: 'Powered Elevon Fin', tag: 'Active Pitch/Yaw Control · 20kg', color: '#a855f7', massKg: 20, powerCores: 0, defaultConfig: { posKey: 'ArrowUp', negKey: 'ArrowDown', maxAngleDeg: 30, strength: 1.0 } },
  { slot: 54, key: '',  type: 'module', category: 'AERODYNAMICS', kind: 'AERO_BLADE',      name: 'Aero Paddle Blade',  tag: 'Rotational Air/Water Foil · 14kg', color: '#c084fc', massKg: 14, powerCores: 0 },

  // --- 6. BALANCE & NAUTICAL BUOYANCY ---
  { slot: 55, key: '',  type: 'module', category: 'BUOYANCY',     kind: 'WEIGHT_BLOCK',    name: 'Lead Weight Block',  tag: '120kg Ballast · Shifts CoM',  color: '#475569', massKg: 120, powerCores: 0 },
  { slot: 56, key: '',  type: 'module', category: 'BUOYANCY',     kind: 'PONTOON_LARGE',   name: 'Heavy Hull Pontoon', tag: '180kg Upward Buoyancy · 12kg',color: '#facc15', massKg: 12,  powerCores: 0 },
  { slot: 57, key: '',  type: 'module', category: 'BUOYANCY',     kind: 'BCD_TANK',        name: 'Submarine Ballast BCD', tag: 'Flood to Sink / Purge Float', color: '#06b6d4', massKg: 35, powerCores: 1, defaultConfig: { posKey: 'Space', negKey: 'ControlLeft', strength: 1.0 } },

  // --- 7. GADGETS, SENSORS & AUTOMATION LOGIC ---
  { slot: 58, key: '',  type: 'module', category: 'LOGIC',        kind: 'MICROBIT_ECU',    name: 'Micro:bit ECU',      tag: '5×5 Matrix & Programmable ECU · 12kg', color: '#0ea5e9', massKg: 12, powerCores: 1 },
  { slot: 59, key: '',  type: 'module', category: 'LOGIC',        kind: 'SENSOR_DISTANCE', name: 'Laser Rangefinder',  tag: '50m Optical Forward Raycast · 10kg',  color: '#ef4444', massKg: 10, powerCores: 0, defaultConfig: { threshold: 12, channel: 1 } },
  { slot: 60, key: '',  type: 'module', category: 'LOGIC',        kind: 'SENSOR_IMU_TILT', name: '3-Axis Gyro IMU',    tag: 'Pitch ±90° & Roll ±180° · 8kg',       color: '#facc15', massKg: 8,  powerCores: 0, defaultConfig: { threshold: 20, channel: 1 } },
  { slot: 61, key: '',  type: 'module', category: 'LOGIC',        kind: 'SENSOR_SPEEDO',   name: 'Pitot Speed & Alt',  tag: 'Speed km/h & Altitude · 6kg',         color: '#10b981', massKg: 6,  powerCores: 0, defaultConfig: { threshold: 50, channel: 1 } },
  { slot: 62, key: '',  type: 'module', category: 'LOGIC',        kind: 'SENSOR_TARGET_RADAR', name: 'Target Radar Dome', tag: 'Target Angle & Range (100m) · 14kg',   color: '#a855f7', massKg: 14, powerCores: 1 },
  { slot: 63, key: '',  type: 'module', category: 'LOGIC',        kind: 'RADIO_TRX',       name: 'Radio Transceiver',  tag: 'Wireless Channel Bus · 12kg',         color: '#2dd4bf', massKg: 12,  powerCores: 0, defaultConfig: { posKey: 'KeyF', channel: 1 } },
  { slot: 64, key: '',  type: 'module', category: 'LOGIC',        kind: 'LOGIC_GATE',      name: 'Logic Gate Processor',tag: 'AND / OR / XOR / NOT · 10kg',         color: '#10b981', massKg: 10, powerCores: 0, defaultConfig: { gateType: 'OR', channel: 1 } },

  // --- 8. WEAPONS & COMBAT UTILITIES ---
  { slot: 65, key: '',  type: 'module', category: 'WEAPONS',      kind: 'WEAPON_MINIGUN',  name: 'Rotary Mini-Gun',    tag: 'Rapid Ballistic Stream · 38kg',color: '#f43f5e', massKg: 38, powerCores: 2, defaultConfig: { posKey: 'KeyF', strength: 1.0 } },
  { slot: 66, key: '',  type: 'module', category: 'WEAPONS',      kind: 'WEAPON_ROCKET',   name: 'Missile Pod Launcher',tag: 'Explosive Ordinance · 48kg', color: '#ef4444', massKg: 48,  powerCores: 2, defaultConfig: { posKey: 'KeyF', strength: 1.3 } },
  { slot: 67, key: '',  type: 'module', category: 'WEAPONS',      kind: 'WEAPON_BOMB_BAY', name: 'Gravity Bomb Bay',   tag: 'Drops Heavy Ordnance · 42kg', color: '#fb923c', massKg: 42,  powerCores: 1, defaultConfig: { posKey: 'KeyB', strength: 1.0 } },
  { slot: 68, key: '',  type: 'module', category: 'WEAPONS',      kind: 'WEAPON_MELEE',    name: 'Energy Plasma Blade',tag: 'Velocity Contact Slicer · 25kg', color: '#e879f9', massKg: 25, powerCores: 1 },

  // --- 9. ILLUMINATION, HEADLIGHTS & GLOWING CAVE BLOCKS ---
  { slot: 69, key: 'H', type: 'module', category: 'LOGIC',        kind: 'HEADLIGHT',       name: 'Twin Halogen Headlight', tag: '[H] High-Beam Cavern Lamp · 8kg', color: '#fef08a', massKg: 8, powerCores: 0, defaultConfig: { posKey: 'KeyH', toggleMode: true, strength: 1.0 } },
  { slot: 70, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.GLOW_CRYSTAL,   name: 'Cave Glow Crystal',  tag: 'Radiant Emissive Crystal · 12kg', color: '#00f5d4', massKg: 12, powerCores: 0 },
  { slot: 71, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.GLOW_MAGMA,     name: 'Molten Magma Block', tag: 'Incandescent Cave Core · 20kg',   color: '#ff6b00', massKg: 20, powerCores: 0 },
  { slot: 72, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.HEADLIGHT_LAMP, name: 'Halogen Glow Voxel', tag: 'Self-Lit Floodlight Block · 6kg', color: '#fef08a', massKg: 6,  powerCores: 0 },

  // --- 10. COSMETICS, PAINT BLOCKS & VISUAL ACCESSORIES ---
  { slot: 73, key: '',  type: 'module', category: 'COSMETICS',    kind: 'COSMETIC_RACING_FIN',   name: 'GT Roof Scoop & Fin',  tag: 'Aero Dorsal Fin Trim · 4kg',      color: '#ef4444', massKg: 4,  powerCores: 0 },
  { slot: 74, key: '',  type: 'module', category: 'COSMETICS',    kind: 'COSMETIC_EXHAUST_STACK',name: 'Twin Chrome Exhaust',  tag: 'Dual V8 Smoke Stacks · 5kg',      color: '#e2e8f0', massKg: 5,  powerCores: 0 },
  { slot: 75, key: '',  type: 'module', category: 'COSMETICS',    kind: 'COSMETIC_BULLBAR',      name: 'Offroad Rally Bullbar',tag: 'Tubular Bumper + Fog Lamps · 8kg',color: '#f59e0b', massKg: 8,  powerCores: 0 },
  { slot: 76, key: '',  type: 'module', category: 'COSMETICS',    kind: 'COSMETIC_NEON_STRIP',   name: 'Underglow Neon Bar',   tag: 'Emissive Cyber Light Tube · 3kg', color: '#00f5ff', massKg: 3,  powerCores: 0 },
  { slot: 77, key: '',  type: 'module', category: 'COSMETICS',    kind: 'COSMETIC_SIREN_BAR',    name: 'Emergency Beacon Bar', tag: 'Flashing Red/Blue Strobe · 5kg',  color: '#3b82f6', massKg: 5,  powerCores: 0, defaultConfig: { posKey: 'KeyH' } },
  { slot: 78, key: '',  type: 'module', category: 'COSMETICS',    kind: 'COSMETIC_RADAR_DOME',   name: 'Spinning Radar Array', tag: 'Rotating Marine/Aero Dish · 5kg', color: '#38bdf8', massKg: 5,  powerCores: 0 },
  { slot: 79, key: '',  type: 'module', category: 'COSMETICS',    kind: 'COSMETIC_HORN_BUGLE',   name: 'Chrome Air Horn',      tag: '[H] Triple Bugle Horn · 4kg',     color: '#facc15', massKg: 4,  powerCores: 0, defaultConfig: { posKey: 'KeyH' } },
  { slot: 80, key: '',  type: 'module', category: 'COSMETICS',    kind: 'COSMETIC_PIRATE_FLAG',  name: 'Expedition Pennant',   tag: 'Waving Mast Flag · 3kg',          color: '#ec4899', massKg: 3,  powerCores: 0 },

  // --- 11. CUSTOM PAINT & FINISH CHASSIS BLOCKS ---
  { slot: 81, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_CRIMSON,  name: 'Crimson Racing Paint',tag: 'Gloss Red Bodywork · 7kg',       color: '#ef4444', massKg: 7,  powerCores: 0 },
  { slot: 82, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_EMERALD,  name: 'Emerald Nitro Paint', tag: 'Gloss Green Bodywork · 7kg',     color: '#10b981', massKg: 7,  powerCores: 0 },
  { slot: 83, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_VIOLET,   name: 'Royal Violet Paint',  tag: 'Metallic Purple Trim · 7kg',     color: '#8b5cf6', massKg: 7,  powerCores: 0 },
  { slot: 84, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_MAGENTA,  name: 'Synthwave Pink Paint',tag: 'Hot Pink Bodywork · 7kg',        color: '#ec4899', massKg: 7,  powerCores: 0 },
  { slot: 85, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_WHITE,    name: 'Arctic Pearl White',  tag: 'Clean Ceramic Finish · 7kg',     color: '#f8fafc', massKg: 7,  powerCores: 0 },
  { slot: 86, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_CARBON,   name: 'Carbon Fiber Weave',  tag: 'Ultralight Weave · 6kg',         color: '#1f2937', massKg: 6,  powerCores: 0 },
  { slot: 87, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_GOLD,     name: '24K Chrome Gold',     tag: 'Mirror Gold Finish · 10kg',      color: '#f59e0b', massKg: 10, powerCores: 0 },
  { slot: 88, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_COPPER,   name: 'Brushed Copper',      tag: 'Steampunk Bronze · 9kg',         color: '#d97706', massKg: 9,  powerCores: 0 },
  { slot: 89, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_TEAL,     name: 'Lagoon Teal Paint',   tag: 'Marine Aqua Finish · 7kg',       color: '#14b8a6', massKg: 7,  powerCores: 0 },
  { slot: 90, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.PAINT_CAMO,     name: 'Tactical Olive Camo', tag: 'Woodland Camo Pattern · 9kg',    color: '#4d7c0f', massKg: 9,  powerCores: 0 },
  { slot: 91, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.NEON_CYAN,      name: 'Neon Cyber Cyan',     tag: 'Emissive Tron Glow · 6kg',       color: '#00f5ff', massKg: 6,  powerCores: 0 },
  { slot: 92, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.NEON_PINK,      name: 'Neon Laser Pink',     tag: 'Emissive Synth Glow · 6kg',      color: '#ff007f', massKg: 6,  powerCores: 0 },
  { slot: 93, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.NEON_LIME,      name: 'Neon Venom Lime',     tag: 'Emissive Acid Glow · 6kg',       color: '#39ff14', massKg: 6,  powerCores: 0 },
  { slot: 94, key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.CHROME_SILVER,  name: 'Mirror Chrome Silver',tag: 'Polished Metallic · 9kg',        color: '#e2e8f0', massKg: 9,  powerCores: 0 },
  { slot: 95, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.CARBON_WEAVE,   name: 'Aero Carbon Weave',   tag: 'Ultralight High-Strength · 4kg', color: '#1e293b', massKg: 4,  powerCores: 0 },
  { slot: 96, key: '',  type: 'voxel',  category: 'WHEELS',       mat: MAT.RUBBER_GRIP,    name: 'High-Grip Tire Block',tag: '1.68x Grip & Bouncy Bumper · 11kg',color: '#0f172a', massKg: 11, powerCores: 0 },
  { slot: 97, key: '',  type: 'voxel',  category: 'WHEELS',       mat: MAT.ICE_SLICK,      name: 'Cryo Drift Ice Block',tag: 'Zero-Friction Slide Runner · 8kg',color: '#a5f3fc', massKg: 8,  powerCores: 0 },
  { slot: 98, key: '',  type: 'voxel',  category: 'PROPULSION',   mat: MAT.MAGMA_CORE,     name: 'Plasma Reactor Block',tag: 'Emissive High-Energy Core · 14kg',color: '#ff3b00', massKg: 14, powerCores: 0 },
  { slot: 99, key: '',  type: 'voxel',  category: 'CHASSIS',      mat: MAT.TUNGSTEN_HEAVY, name: 'Tungsten Battering Ram',tag: 'Ultra-Dense 48kg Armor Block', color: '#3f3f46', massKg: 48, powerCores: 0 },
  { slot: 100,key: '',  type: 'voxel',  category: 'COSMETICS',    mat: MAT.NEON_GOLD,      name: 'Solar Gold Emissive', tag: 'Radiant Golden Glow · 6kg',      color: '#fde047', massKg: 6,  powerCores: 0 },

  // --- 12. ADVANCED TACTICAL, TRACTION & ENGINEERING MODULES ---
  { slot: 101,key: '',  type: 'module', category: 'MECHANICAL',   kind: 'TURRET_RING',       name: 'Motorized Turret Ring', tag: '360° Aim-Tracking Mount · 42kg', color: '#f59e0b', massKg: 42, powerCores: 1, defaultConfig: { posKey: 'KeyQ', negKey: 'KeyE', strength: 1.0 } },
  { slot: 102,key: '',  type: 'module', category: 'MECHANICAL',   kind: 'MAGNET_COUPLER',    name: 'Tractor Magnet Coupler',tag: '[K/L] Attract & Repel Beam · 36kg',color: '#38bdf8', massKg: 36, powerCores: 1, defaultConfig: { posKey: 'KeyK', negKey: 'KeyL', toggleMode: true, strength: 1.2 } },
  { slot: 103,key: '',  type: 'module', category: 'WHEELS',       kind: 'TANK_TREAD',        name: 'Armored Tank Tread',    tag: '2.2x Climbing Track Belt · 64kg',color: '#84cc16', massKg: 64, powerCores: 1, defaultConfig: { posKey: 'KeyW', negKey: 'KeyS', strength: 1.35, forwardTraction: 2.2, sidewaysTraction: 1.9 } },
  { slot: 104,key: '',  type: 'module', category: 'AERODYNAMICS', kind: 'PARACHUTE_AIRBRAKE',name: 'Deployable Parachute',  tag: '[U] Canopy Drag & Airbrake · 20kg',color: '#fb923c', massKg: 20, powerCores: 0, defaultConfig: { posKey: 'KeyU', toggleMode: true, strength: 1.0 } },
  { slot: 105,key: '',  type: 'module', category: 'MECHANICAL',   kind: 'OUTRIGGER_JACK',    name: 'Hydraulic Outrigger',   tag: '[J] Ground Anchor Stabilizer · 34kg',color: '#facc15', massKg: 34, powerCores: 1, defaultConfig: { posKey: 'KeyJ', toggleMode: true, strength: 1.0 } },
  { slot: 106,key: '',  type: 'module', category: 'WEAPONS',      kind: 'IMPULSE_BUMPER',    name: 'Spring Impulse Bumper', tag: 'Kinetic Knockback Plate · 38kg', color: '#a855f7', massKg: 38, powerCores: 1, defaultConfig: { strength: 1.4 } },
  { slot: 107,key: '',  type: 'module', category: 'WEAPONS',      kind: 'SMOKE_FLARE',       name: 'Smoke & Flare Pod',     tag: '[I] Decoy Flares & Smoke · 22kg', color: '#f43f5e', massKg: 22, powerCores: 1, defaultConfig: { posKey: 'KeyI', strength: 1.0 } },
];

export type VehicleSkinId =
  | 'DEFAULT_AERO'
  | 'CYBERPUNK_NEON'
  | 'RACING_APEX'
  | 'MILITARY_CAMO'
  | 'GOLDEN_ROYAL'
  | 'HAZARD_INDUSTRIAL'
  | 'ARCTIC_STEALTH'
  | 'MAGMA_FORGE';

export interface VehicleSkinSpec {
  id: VehicleSkinId;
  name: string;
  desc: string;
  primaryMat: number;
  secondaryMat: number;
  accentMat: number;
  pattern: 'STRIPE_CENTER' | 'CAMO_BLOTCH' | 'HAZARD_DIAG' | 'CYBER_TRIM' | 'TWO_TONE';
  previewColors: [string, string, string];
}

export const VEHICLE_SKINS: VehicleSkinSpec[] = [
  {
    id: 'DEFAULT_AERO',
    name: 'Cobalt Aero Original',
    desc: 'Classic Trailmakers cobalt blue hull with slate trim & gold accents',
    primaryMat: MAT.ALLOY_BLUE,
    secondaryMat: MAT.ARMOR_SLATE,
    accentMat: MAT.FLOAT_YELLOW,
    pattern: 'TWO_TONE',
    previewColors: ['#00b4d8', '#64748b', '#ffbe0b'],
  },
  {
    id: 'CYBERPUNK_NEON',
    name: 'Cyberpunk Neon Synth',
    desc: 'Carbon fiber weave hull with glowing Neon Cyan & Laser Pink trim',
    primaryMat: MAT.PAINT_CARBON,
    secondaryMat: MAT.NEON_CYAN,
    accentMat: MAT.NEON_PINK,
    pattern: 'CYBER_TRIM',
    previewColors: ['#111827', '#00f5ff', '#ff007f'],
  },
  {
    id: 'RACING_APEX',
    name: 'Apex Formula GT',
    desc: 'Crimson red racing bodywork with twin Pearl White center stripes',
    primaryMat: MAT.PAINT_CRIMSON,
    secondaryMat: MAT.PAINT_WHITE,
    accentMat: MAT.PAINT_GOLD,
    pattern: 'STRIPE_CENTER',
    previewColors: ['#ef4444', '#f8fafc', '#f59e0b'],
  },
  {
    id: 'MILITARY_CAMO',
    name: 'Tactical Woodland Camo',
    desc: 'Multi-tone olive camo blotches with reinforced gunmetal steel',
    primaryMat: MAT.PAINT_CAMO,
    secondaryMat: MAT.STEEL,
    accentMat: MAT.ARMOR_SLATE,
    pattern: 'CAMO_BLOTCH',
    previewColors: ['#4d7c0f', '#334155', '#64748b'],
  },
  {
    id: 'GOLDEN_ROYAL',
    name: '24K Royal Gold & Chrome',
    desc: 'Polished 24K Chrome Gold plating over obsidian carbon & silver',
    primaryMat: MAT.PAINT_GOLD,
    secondaryMat: MAT.PAINT_CARBON,
    accentMat: MAT.CHROME_SILVER,
    pattern: 'STRIPE_CENTER',
    previewColors: ['#f59e0b', '#111827', '#e2e8f0'],
  },
  {
    id: 'HAZARD_INDUSTRIAL',
    name: 'Heavy Hazard Stripes',
    desc: 'Diagonal yellow-and-black industrial hazard chevron livery',
    primaryMat: MAT.FLOAT_YELLOW,
    secondaryMat: MAT.PAINT_CARBON,
    accentMat: MAT.RAMP_ORANGE,
    pattern: 'HAZARD_DIAG',
    previewColors: ['#facc15', '#111827', '#ff5400'],
  },
  {
    id: 'ARCTIC_STEALTH',
    name: 'Arctic Ghost Polar',
    desc: 'Pearl white snow livery with mirror chrome & glowing crystal trim',
    primaryMat: MAT.PAINT_WHITE,
    secondaryMat: MAT.CHROME_SILVER,
    accentMat: MAT.GLOW_CRYSTAL,
    pattern: 'TWO_TONE',
    previewColors: ['#f8fafc', '#e2e8f0', '#00f5d4'],
  },
  {
    id: 'MAGMA_FORGE',
    name: 'Volcanic Magma Core',
    desc: 'Dark carbon hull veined with incandescent Molten Magma & Crimson',
    primaryMat: MAT.PAINT_CARBON,
    secondaryMat: MAT.GLOW_MAGMA,
    accentMat: MAT.PAINT_CRIMSON,
    pattern: 'CYBER_TRIM',
    previewColors: ['#111827', '#ff6b00', '#ef4444'],
  },
];

export const OBJECT_STUDIO_SLOTS: BuildSlotItem[] = [
  { slot: 1,  key: '1', type: 'voxel', category: 'CHASSIS', mat: MAT.BRICK,         name: 'Building Brick',  tag: 'Destructible Wall', color: '#dc2626', massKg: 12, powerCores: 0 },
  { slot: 2,  key: '2', type: 'voxel', category: 'CHASSIS', mat: MAT.CONCRETE,      name: 'Bunker Concrete', tag: 'Heavy Structure',   color: '#94a3b8', massKg: 16, powerCores: 0 },
  { slot: 3,  key: '3', type: 'voxel', category: 'CHASSIS', mat: MAT.STEEL,         name: 'Dark Steel',      tag: 'Reinforced Girder', color: '#475569', massKg: 26, powerCores: 0 },
  { slot: 4,  key: '4', type: 'voxel', category: 'CHASSIS', mat: MAT.WOOD,          name: 'Harbor Timber',   tag: 'Buoyant Wood',      color: '#d97706', massKg: 7,  powerCores: 0 },
  { slot: 5,  key: '5', type: 'voxel', category: 'CHASSIS', mat: MAT.GLASS_SOLID,   name: 'Window Glass',    tag: 'Shatter Pane',      color: '#7dd3fc', massKg: 5,  powerCores: 0 },
  { slot: 6,  key: '6', type: 'voxel', category: 'CHASSIS', mat: MAT.RAMP_ORANGE,   name: 'Stunt Ramp',      tag: 'High-Grip Surface', color: '#f97316', massKg: 18, powerCores: 0 },
  { slot: 7,  key: '7', type: 'voxel', category: 'WEAPONS', mat: MAT.C4_EXPLOSIVE,  name: 'Volatile C4',     tag: 'Explosive Core!',   color: '#ef4444', massKg: 7,  powerCores: 0 },
  { slot: 8,  key: '8', type: 'voxel', category: 'CHASSIS', mat: MAT.ALLOY_BLUE,    name: 'Light Alloy',     tag: 'Neon Trim Block',   color: '#38bdf8', massKg: 7,  powerCores: 0 },
  { slot: 9,  key: '9', type: 'voxel', category: 'CHASSIS', mat: MAT.FLOAT_YELLOW,  name: 'Gold / Hazard',   tag: 'Bright Accent',     color: '#facc15', massKg: 3,  powerCores: 0 },
  { slot: 10, key: '0', type: 'voxel', category: 'CHASSIS', mat: MAT.ASPHALT,       name: 'Road Asphalt',    tag: 'Dark Tarmac',       color: '#334155', massKg: 16, powerCores: 0 },
  { slot: 11, key: '-', type: 'voxel', category: 'CHASSIS', mat: MAT.CANYON_ORANGE, name: 'Mesa Sandstone',  tag: 'Desert Stone',      color: '#ea580c', massKg: 15, powerCores: 0 },
  { slot: 12, key: '=', type: 'voxel', category: 'CHASSIS', mat: MAT.GRASS,         name: 'Foliage Green',   tag: 'Park Hedge/Turf',   color: '#4ade80', massKg: 10, powerCores: 0 },
  { slot: 13, key: '',  type: 'voxel', category: 'CHASSIS', mat: MAT.GLOW_CRYSTAL,  name: 'Cave Glow Crystal', tag: 'Emissive Cyan',   color: '#00f5d4', massKg: 12, powerCores: 0 },
  { slot: 14, key: '',  type: 'voxel', category: 'CHASSIS', mat: MAT.GLOW_MAGMA,    name: 'Glowing Magma',   tag: 'Emissive Magma',    color: '#ff6b00', massKg: 20, powerCores: 0 },
  { slot: 15, key: '',  type: 'voxel', category: 'CHASSIS', mat: MAT.CARBON_WEAVE,  name: 'Aero Carbon Weave', tag: 'Ultralight 4kg',  color: '#1e293b', massKg: 4,  powerCores: 0 },
  { slot: 16, key: '',  type: 'voxel', category: 'CHASSIS', mat: MAT.RUBBER_GRIP,   name: 'High-Grip Rubber',  tag: 'Bouncy Bumper',   color: '#0f172a', massKg: 11, powerCores: 0 },
  { slot: 17, key: '',  type: 'voxel', category: 'CHASSIS', mat: MAT.ICE_SLICK,     name: 'Cryo Drift Ice',    tag: 'Low Friction',    color: '#a5f3fc', massKg: 8,  powerCores: 0 },
  { slot: 18, key: '',  type: 'voxel', category: 'CHASSIS', mat: MAT.TUNGSTEN_HEAVY,name: 'Tungsten Ballast',  tag: 'Heavy 48kg Armor',color: '#3f3f46', massKg: 48, powerCores: 0 },
];

export type WorldGenMode =
  | 'DEFAULT_PARK'
  | 'FLAT_BASEPLATE'
  | 'BIOME_CANYON'
  | 'BIOME_ARCTIC'
  | 'BIOME_VOLCANIC'
  | 'BIOME_ARCHIPELAGO'
  | 'CUSTOM_HEIGHTMAP'
  | 'CUSTOM_GLB_MAP';

export const WORLD_GEN_BIOMES: Array<{
  id: WorldGenMode;
  name: string;
  desc: string;
  badgeColor: string;
}> = [
  { id: 'DEFAULT_PARK',      name: 'Proving Ground & Town', desc: 'Stunt ramps, demolition town, red-rock mesa & harbor', badgeColor: '#38bdf8' },
  { id: 'FLAT_BASEPLATE',    name: 'Unlimited Flat Baseplate', desc: 'Infinite flat canvas for building custom tracks & cities', badgeColor: '#10b981' },
  { id: 'BIOME_CANYON',      name: 'Red-Rock Grand Canyon', desc: 'Towering sandstone mesas, winding canyon floors & arches', badgeColor: '#f97316' },
  { id: 'BIOME_ARCTIC',      name: 'Arctic Glacier & Peaks', desc: 'Snow-capped peaks, frozen sea shelves & icy ridges', badgeColor: '#7dd3fc' },
  { id: 'BIOME_VOLCANIC',    name: 'Volcanic Basalt Caldera', desc: 'Dark obsidian crags, explosive C4 magma veins & ash flats', badgeColor: '#ef4444' },
  { id: 'BIOME_ARCHIPELAGO', name: 'Tropical Archipelago',  desc: 'Endless island chain, sandbars, lagoons & ocean channels', badgeColor: '#facc15' },
  { id: 'CUSTOM_HEIGHTMAP',  name: 'Imported Heightmap',    desc: 'Generated from a 2D grayscale/color heightmap image', badgeColor: '#a855f7' },
  { id: 'CUSTOM_GLB_MAP',    name: '3D GLB Island + Endless Ocean', desc: 'Imported 3D model island surrounded by infinite deep ocean swells', badgeColor: '#e879f9' },
];

export type WorldEditToolKind =
  | 'PLACE_OBJECT'
  | 'PLACE_PROP'
  | 'SPAWN_VOXEL_ENTITY'
  | 'SPAWN_MAP_HAZARD'
  | 'TERRA_RAISE'
  | 'TERRA_LOWER'
  | 'TERRA_FLATTEN'
  | 'TERRA_RAMP'
  | 'TERRA_PAINT';

export type PlayToolKind =
  | 'SLEDGE'
  | 'PIPE_BOMB'
  | 'PLASMA_RIFLE'
  | 'LIGHT_BLOCK'
  | 'LIGHT_PLATE'
  | 'LIGHT_BEAM'
  | 'LIGHT_BOX';

export type WalkBuildShape =
  | 'SINGLE'
  | 'WALL_5X4'
  | 'RAMP_4X4'
  | 'FLOOR_5X5'
  | 'PILLAR_1X6';

export interface PlaySlotItem {
  slot: number;
  key: string;
  kind: PlayToolKind;
  placementMode?: BuildPlacementMode;
  buildShape?: WalkBuildShape;
  name: string;
  tag: string;
  color: string;
}

export const PLAY_SLOTS: PlaySlotItem[] = [
  { slot: 1, key: '1', kind: 'SLEDGE',       name: 'Heavy Sledgehammer', tag: 'Smash & Damage Integrity', color: '#f59e0b' },
  { slot: 2, key: '2', kind: 'PIPE_BOMB',    name: 'Sticky C4 Charge',   tag: 'L-Throw / R-Detonate',     color: '#ef4444' },
  { slot: 3, key: '3', kind: 'PLASMA_RIFLE', name: 'Handheld Plasma Gun',tag: 'Blast Voxel Craters',      color: '#fb7185' },
  { slot: 4, key: '4', kind: 'LIGHT_BLOCK',  placementMode: 'SINGLE',    buildShape: 'SINGLE',     name: 'Field Welder (Block 1×1)',   tag: 'Place / Break (R: Cycle Shape)',  color: '#38bdf8' },
  { slot: 5, key: '5', kind: 'LIGHT_BLOCK',  placementMode: 'PLATE_3X3', buildShape: 'WALL_5X4',   name: 'Light Wall 5×4',    tag: 'Stamp 5×4 Light Wall',     color: '#22d3ee' },
  { slot: 6, key: '6', kind: 'LIGHT_BLOCK',  placementMode: 'BEAM_6',    buildShape: 'RAMP_4X4',   name: 'Light Ramp 4×4',    tag: '4×4 Driveable Light Ramp', color: '#34d399' },
  { slot: 7, key: '7', kind: 'LIGHT_BLOCK',  placementMode: 'BOX_FILL',  buildShape: 'FLOOR_5X5',  name: 'Light Floor 5×5',   tag: '5×5 Light Bridge Deck',    color: '#a855f7' },
  { slot: 8, key: '8', kind: 'LIGHT_BLOCK',  placementMode: 'BEAM_6',    buildShape: 'PILLAR_1X6', name: 'Light Pillar 1×6',  tag: '6-Block Vertical Column',  color: '#38bdf8' },
];

export const PRESET_NAMES = [
  '01. Baja Trophy Truck',
  '02. Heavy Siege Tank',
  '03. Twin-Rotor VTOL Heli',
  '04. Hydro-Foil Gunboat',
  '05. Delta-Wing Stunt Jet',
  '06. 1-Voxel Scratch Core',
  '07. Trailmakers Dirt Bike (2-Wheeler)',
  '08. Nautilus Deep Submarine',
];

export const DIR_NAMES = ['NORTH (+Z)', 'EAST (+X)', 'SOUTH (-Z)', 'WEST (-X)'];

export const BINDABLE_KEYS: Array<{ code: string; label: string }> = [
  { code: 'KeyW',        label: 'W' },
  { code: 'KeyS',        label: 'S' },
  { code: 'KeyA',        label: 'A' },
  { code: 'KeyD',        label: 'D' },
  { code: 'Space',       label: 'SPACE' },
  { code: 'ShiftLeft',   label: 'SHIFT' },
  { code: 'ControlLeft', label: 'CTRL' },
  { code: 'KeyQ',        label: 'Q' },
  { code: 'KeyE',        label: 'E' },
  { code: 'KeyF',        label: 'F' },
  { code: 'KeyG',        label: 'G' },
  { code: 'KeyH',        label: 'H' },
  { code: 'KeyJ',        label: 'J' },
  { code: 'KeyK',        label: 'K' },
  { code: 'KeyL',        label: 'L' },
  { code: 'KeyN',        label: 'N' },
  { code: 'KeyU',        label: 'U' },
  { code: 'KeyI',        label: 'I' },
  { code: 'KeyX',        label: 'X' },
  { code: 'KeyT',        label: 'T' },
  { code: 'KeyY',        label: 'Y' },
  { code: 'KeyZ',        label: 'Z' },
  { code: 'ArrowUp',     label: 'UP ↑' },
  { code: 'ArrowDown',   label: 'DOWN ↓' },
  { code: 'ArrowLeft',   label: 'LEFT ←' },
  { code: 'ArrowRight',  label: 'RIGHT →' },
  { code: 'NONE',        label: 'NONE (Channel Only)' },
];

export const AXIS_ROT_NAMES = ['0°', '90°', '180°', '270°'];

export interface SerializedVehicleBlueprint {
  id: string;
  name: string;
  createdAt: string;
  massKg: number;
  blockCount: number;
  powerCores: number;
  voxels: Array<[number, number, number, number]>; // [vx, vy, vz, mat]
  microVoxels?: Array<[number, number, number, number]>; // [mx, my, mz, mat] at 1px (0.0625m)
  modules: Array<{
    kind: ModuleKind;
    vx: number;
    vy: number;
    vz: number;
    yawIdx: number;
    pitchIdx?: number;
    rollIdx?: number;
    config?: ModuleTuningConfig;
  }>;
  ecuPrograms?: Record<string, any>;
}


