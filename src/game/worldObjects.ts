import { MAT, CHUNK_Y, WATER_VY, SUBTERRANEAN_DEPTH_VY, type WorldGenMode } from './constants.ts';
import { parseVoxelCoords } from './physicsMath.ts';

export interface VoxelObjectPrefab {
  id: string;
  name: string;
  category: 'STUNT' | 'BUILDING' | 'HAZARD' | 'CUSTOM';
  tag: string;
  createdAt: string;
  blockCount: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxels: Array<[number, number, number, number]>; // [dx, dy, dz, mat] relative to bottom-center (0, 0, 0)
}

export function computePrefabDimensions(
  voxels: Array<[number, number, number, number]>,
): { sizeX: number; sizeY: number; sizeZ: number } {
  if (voxels.length === 0) return { sizeX: 1, sizeY: 1, sizeZ: 1 };
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const [x, y, z] of voxels) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    sizeX: Math.max(1, maxX - minX + 1),
    sizeY: Math.max(1, maxY - minY + 1),
    sizeZ: Math.max(1, maxZ - minZ + 1),
  };
}

/**
 * Helper to generate a box of voxels inside a prefab array.
 */
function pushPrefabBox(
  map: Map<string, number>,
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
        if (mat === MAT.AIR) {
          map.delete(`${x},${y},${z}`);
        } else {
          map.set(`${x},${y},${z}`, mat);
        }
      }
    }
  }
}

function mapToVoxelArray(map: Map<string, number>): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  map.forEach((mat, key) => {
    if (mat !== MAT.AIR) {
      const [x, y, z] = parseVoxelCoords(key);
      out.push([x, y, z, mat]);
    }
  });
  return out;
}

/**
 * Normalizes any vehicle/studio voxel map so its bottom-center is at (0, 0, 0),
 * ready to be stamped cleanly onto any terrain surface in the World Editor!
 */
export function normalizeVoxelObjectToOrigin(
  voxels: Array<[number, number, number, number]>,
): Array<[number, number, number, number]> {
  if (voxels.length === 0) return [[0, 0, 0, MAT.BRICK]];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const [vx, vy, vz, mat] of voxels) {
    if (mat === MAT.AIR) continue;
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vz < minZ) minZ = vz;
    if (vz > maxZ) maxZ = vz;
  }

  if (!Number.isFinite(minY)) return [[0, 0, 0, MAT.BRICK]];
  const centerX = Math.round((minX + maxX) / 2);
  const centerZ = Math.round((minZ + maxZ) / 2);

  return voxels
    .filter((v) => v[3] !== MAT.AIR)
    .map(([vx, vy, vz, mat]) => [
      vx - centerX,
      vy - minY,
      vz - centerZ,
      mat,
    ]);
}

/**
 * Rotates a normalized object prefab across all 3 axes:
 * - yawIdx (Y-axis: 0=0°, 1=90°, 2=180°, 3=270°)
 * - pitchIdx (X-axis: 0=0°, 1=90°, 2=180°, 3=270°)
 * - rollIdx (Z-axis: 0=0°, 1=90°, 2=180°, 3=270°)
 * Automatically re-grounds the bottom-most voxel to dy=0 when pitched or rolled.
 */
export function rotateObjectVoxels(
  voxels: Array<[number, number, number, number]>,
  yawIdx: number,
  pitchIdx = 0,
  rollIdx = 0,
): Array<[number, number, number, number]> {
  const ry = ((yawIdx % 4) + 4) % 4;
  const rx = ((pitchIdx % 4) + 4) % 4;
  const rz = ((rollIdx % 4) + 4) % 4;
  if (ry === 0 && rx === 0 && rz === 0) return voxels;

  let minY = Infinity;
  const rotated: Array<[number, number, number, number]> = voxels.map(([dx, dy, dz, mat]) => {
    let x = dx;
    let y = dy;
    let z = dz;
    // 1. Pitch around X
    for (let i = 0; i < rx; i++) {
      const ny = -z;
      const nz = y;
      y = ny;
      z = nz;
    }
    // 2. Roll around Z
    for (let i = 0; i < rz; i++) {
      const nx = -y;
      const ny = x;
      x = nx;
      y = ny;
    }
    // 3. Yaw around Y
    for (let i = 0; i < ry; i++) {
      const nx = z;
      const nz = -x;
      x = nx;
      z = nz;
    }
    if (y < minY) minY = y;
    return [x, y, z, mat];
  });

  if (Number.isFinite(minY) && minY !== 0) {
    for (let i = 0; i < rotated.length; i++) {
      rotated[i][1] -= minY;
    }
  }
  return rotated;
}

/**
 * Built-in Pre-Built Placeable Objects ready to stamp anywhere in the world!
 */
export function createPrebuiltPlaceableObjects(): VoxelObjectPrefab[] {
  // 1. Mega Stunt Kicker Ramp (12 wide x 16 long x 6 high)
  const rampMap = new Map<string, number>();
  for (let s = 0; s < 16; s++) {
    const h = Math.floor(s / 2.5);
    pushPrefabBox(rampMap, -6, 0, -8 + s, 6, h, -8 + s, MAT.RAMP_ORANGE);
    // Side safety rails
    pushPrefabBox(rampMap, -6, h + 1, -8 + s, -6, h + 1, -8 + s, MAT.STEEL);
    pushPrefabBox(rampMap, 6, h + 1, -8 + s, 6, h + 1, -8 + s, MAT.STEEL);
  }
  const rampVox = mapToVoxelArray(rampMap);

  // 2. Explosive C4 Fuel Tower (Volatile chain-reaction target!)
  const towerMap = new Map<string, number>();
  pushPrefabBox(towerMap, -4, 0, -4, -3, 12, -3, MAT.STEEL);
  pushPrefabBox(towerMap, 3, 0, -4, 4, 12, -3, MAT.STEEL);
  pushPrefabBox(towerMap, -4, 0, 3, -3, 12, 4, MAT.STEEL);
  pushPrefabBox(towerMap, 3, 0, 3, 4, 12, 4, MAT.STEEL);
  pushPrefabBox(towerMap, -4, 5, -4, 4, 5, 4, MAT.STEEL);
  pushPrefabBox(towerMap, -3, 6, -3, 3, 13, 3, MAT.C4_EXPLOSIVE);
  pushPrefabBox(towerMap, -2, 14, -2, 2, 15, 2, MAT.FLOAT_YELLOW);
  const towerVox = mapToVoxelArray(towerMap);

  // 3. Hollow Brick Watchtower (Destructible 2-story building with windows)
  const bldgMap = new Map<string, number>();
  pushPrefabBox(bldgMap, -6, 0, -6, 6, 12, 6, MAT.BRICK);
  pushPrefabBox(bldgMap, -5, 0, -5, 5, 11, 5, MAT.AIR);
  // Doorway
  pushPrefabBox(bldgMap, -2, 0, -6, 2, 5, -5, MAT.AIR);
  // Glass windows
  pushPrefabBox(bldgMap, -6, 5, -3, 6, 8, 3, MAT.GLASS_SOLID);
  pushPrefabBox(bldgMap, -5, 5, -4, 5, 8, 4, MAT.AIR);
  // Roof & C4 Core
  pushPrefabBox(bldgMap, -7, 12, -7, 7, 13, 7, MAT.STEEL);
  pushPrefabBox(bldgMap, -2, 14, -2, 2, 16, 2, MAT.C4_EXPLOSIVE);
  const bldgVox = mapToVoxelArray(bldgMap);

  // 4. Stunt Ring Arch Gate (Drive or fly through!)
  const archMap = new Map<string, number>();
  pushPrefabBox(archMap, -8, 0, -1, -6, 16, 1, MAT.STEEL);
  pushPrefabBox(archMap, 6, 0, -1, 8, 16, 1, MAT.STEEL);
  pushPrefabBox(archMap, -8, 14, -1, 8, 16, 1, MAT.RAMP_ORANGE);
  pushPrefabBox(archMap, -6, 16, 0, 6, 17, 0, MAT.FLOAT_YELLOW);
  const archVox = mapToVoxelArray(archMap);

  // 5. Steel Bridge Span (10 wide x 20 long elevated deck)
  const bridgeMap = new Map<string, number>();
  pushPrefabBox(bridgeMap, -5, 0, -9, -4, 4, -8, MAT.CONCRETE);
  pushPrefabBox(bridgeMap, 4, 0, -9, 5, 4, -8, MAT.CONCRETE);
  pushPrefabBox(bridgeMap, -5, 0, 8, -4, 4, 9, MAT.CONCRETE);
  pushPrefabBox(bridgeMap, 4, 0, 8, 5, 4, 9, MAT.CONCRETE);
  pushPrefabBox(bridgeMap, -5, 4, -10, 5, 4, 10, MAT.ASPHALT);
  pushPrefabBox(bridgeMap, -5, 5, -10, -5, 6, 10, MAT.STEEL);
  pushPrefabBox(bridgeMap, 5, 5, -10, 5, 6, 10, MAT.STEEL);
  const bridgeVox = mapToVoxelArray(bridgeMap);

  // 6. Concrete Bunker Pillbox
  const bunkerMap = new Map<string, number>();
  pushPrefabBox(bunkerMap, -6, 0, -5, 6, 7, 5, MAT.CONCRETE);
  pushPrefabBox(bunkerMap, -4, 0, -3, 4, 5, 3, MAT.AIR);
  pushPrefabBox(bunkerMap, -4, 3, -5, 4, 4, 5, MAT.AIR); // firing slit
  pushPrefabBox(bunkerMap, -7, 7, -6, 7, 8, 6, MAT.STEEL);
  const bunkerVox = mapToVoxelArray(bunkerMap);

  // 7. Harbor Timber Cabin
  const cabinMap = new Map<string, number>();
  pushPrefabBox(cabinMap, -5, 0, -5, 5, 8, 5, MAT.WOOD);
  pushPrefabBox(cabinMap, -4, 0, -4, 4, 7, 4, MAT.AIR);
  pushPrefabBox(cabinMap, -2, 0, 4, 2, 5, 5, MAT.AIR);
  pushPrefabBox(cabinMap, -6, 8, -6, 6, 9, 6, MAT.BRICK);
  pushPrefabBox(cabinMap, -4, 10, -4, 4, 10, 4, MAT.BRICK);
  const cabinVox = mapToVoxelArray(cabinMap);

  // 8. Giant Bowling Pin Target Cluster
  const pinsMap = new Map<string, number>();
  const pinOffsets = [
    [0, 0],
    [-3, 3],
    [3, 3],
    [-6, 6],
    [0, 6],
    [6, 6],
  ];
  for (const [px, pz] of pinOffsets) {
    pushPrefabBox(pinsMap, px - 1, 0, pz - 1, px + 1, 6, pz + 1, MAT.FLOAT_YELLOW);
    pushPrefabBox(pinsMap, px - 1, 4, pz - 1, px + 1, 5, pz + 1, MAT.C4_EXPLOSIVE);
    pushPrefabBox(pinsMap, px, 7, pz, px, 9, pz, MAT.FLOAT_YELLOW);
  }
  const pinsVox = mapToVoxelArray(pinsMap);

  return [
    {
      id: 'prebuilt_mega_ramp',
      name: 'Mega Stunt Kicker Ramp',
      category: 'STUNT',
      tag: 'Driveable Launch Ramp',
      createdAt: 'Pre-Built',
      blockCount: rampVox.length,
      ...computePrefabDimensions(rampVox),
      voxels: rampVox,
    },
    {
      id: 'prebuilt_c4_tower',
      name: 'Explosive C4 Fuel Tower',
      category: 'HAZARD',
      tag: 'Chain-Reaction Silo',
      createdAt: 'Pre-Built',
      blockCount: towerVox.length,
      ...computePrefabDimensions(towerVox),
      voxels: towerVox,
    },
    {
      id: 'prebuilt_watchtower',
      name: 'Hollow Brick Watchtower',
      category: 'BUILDING',
      tag: '2-Story Destructible Tower',
      createdAt: 'Pre-Built',
      blockCount: bldgVox.length,
      ...computePrefabDimensions(bldgVox),
      voxels: bldgVox,
    },
    {
      id: 'prebuilt_stunt_arch',
      name: 'Stunt Ring Arch Gate',
      category: 'STUNT',
      tag: 'Checkpoint Jump Gate',
      createdAt: 'Pre-Built',
      blockCount: archVox.length,
      ...computePrefabDimensions(archVox),
      voxels: archVox,
    },
    {
      id: 'prebuilt_steel_bridge',
      name: 'Steel Girder Bridge',
      category: 'STUNT',
      tag: 'Driveable Elevated Span',
      createdAt: 'Pre-Built',
      blockCount: bridgeVox.length,
      ...computePrefabDimensions(bridgeVox),
      voxels: bridgeVox,
    },
    {
      id: 'prebuilt_bunker',
      name: 'Concrete Bunker Pillbox',
      category: 'BUILDING',
      tag: 'Armored Fortification',
      createdAt: 'Pre-Built',
      blockCount: bunkerVox.length,
      ...computePrefabDimensions(bunkerVox),
      voxels: bunkerVox,
    },
    {
      id: 'prebuilt_timber_cabin',
      name: 'Harbor Timber Cabin',
      category: 'BUILDING',
      tag: 'Wooden Destructible House',
      createdAt: 'Pre-Built',
      blockCount: cabinVox.length,
      ...computePrefabDimensions(cabinVox),
      voxels: cabinVox,
    },
    {
      id: 'prebuilt_bowling_pins',
      name: 'Explosive Bowling Pins',
      category: 'HAZARD',
      tag: '6-Pin Smash Target',
      createdAt: 'Pre-Built',
      blockCount: pinsVox.length,
      ...computePrefabDimensions(pinsVox),
      voxels: pinsVox,
    },
    // --- Physics Props for World Edit & Prop Placer ---
    {
      id: 'prop_traffic_cone',
      name: 'Traffic Cone Prop',
      category: 'HAZARD',
      tag: 'Physics Obstacle · 5kg',
      createdAt: 'Pre-Built Prop',
      sizeX: 4,
      sizeY: 5,
      sizeZ: 4,
      blockCount: 20,
      voxels: [
        [-2,0,-2,MAT.ASPHALT],[-1,0,-2,MAT.RAMP_ORANGE],[0,0,-2,MAT.RAMP_ORANGE],[1,0,-2,MAT.ASPHALT],
        [-2,0,-1,MAT.RAMP_ORANGE],[-1,0,-1,MAT.RAMP_ORANGE],[0,0,-1,MAT.RAMP_ORANGE],[1,0,-1,MAT.RAMP_ORANGE],
        [-2,0,0,MAT.RAMP_ORANGE],[-1,0,0,MAT.RAMP_ORANGE],[0,0,0,MAT.RAMP_ORANGE],[1,0,0,MAT.RAMP_ORANGE],
        [-2,0,1,MAT.ASPHALT],[-1,0,1,MAT.RAMP_ORANGE],[0,0,1,MAT.RAMP_ORANGE],[1,0,1,MAT.ASPHALT],
        [-1,1,-1,MAT.RAMP_ORANGE],[0,1,-1,MAT.RAMP_ORANGE],[-1,1,0,MAT.RAMP_ORANGE],[0,1,0,MAT.RAMP_ORANGE],
        [-1,2,-1,MAT.PAINT_WHITE],[0,2,-1,MAT.PAINT_WHITE],[-1,2,0,MAT.PAINT_WHITE],[0,2,0,MAT.PAINT_WHITE],
        [-1,3,-1,MAT.RAMP_ORANGE],[0,3,-1,MAT.RAMP_ORANGE],[-1,3,0,MAT.RAMP_ORANGE],[0,3,0,MAT.RAMP_ORANGE],
        [0,4,0,MAT.RAMP_ORANGE],
      ],
    },
    {
      id: 'prop_wooden_crate',
      name: 'Wooden Supply Crate',
      category: 'HAZARD',
      tag: 'Stackable Physics Crate · 50kg',
      createdAt: 'Pre-Built Prop',
      sizeX: 4,
      sizeY: 4,
      sizeZ: 4,
      blockCount: 32,
      voxels: [
        // base
        [-1,0,-1,MAT.DIRT],[0,0,-1,MAT.WOOD],[1,0,-1,MAT.DIRT],
        [-1,0,0,MAT.WOOD],[0,0,0,MAT.WOOD],[1,0,0,MAT.WOOD],
        [-1,0,1,MAT.DIRT],[0,0,1,MAT.WOOD],[1,0,1,MAT.DIRT],
        // walls
        [-1,1,-1,MAT.DIRT],[1,1,-1,MAT.DIRT],[-1,1,1,MAT.DIRT],[1,1,1,MAT.DIRT],
        [-1,2,-1,MAT.DIRT],[1,2,-1,MAT.DIRT],[-1,2,1,MAT.DIRT],[1,2,1,MAT.DIRT],
        // top
        [-1,3,-1,MAT.DIRT],[0,3,-1,MAT.WOOD],[1,3,-1,MAT.DIRT],
        [-1,3,0,MAT.WOOD],[0,3,0,MAT.WOOD],[1,3,0,MAT.WOOD],
        [-1,3,1,MAT.DIRT],[0,3,1,MAT.WOOD],[1,3,1,MAT.DIRT],
      ],
    },
    {
      id: 'prop_c4_barrel',
      name: 'Explosive C4 Barrel',
      category: 'HAZARD',
      tag: 'Volatile Hazard Drum · 50kg',
      createdAt: 'Pre-Built Prop',
      sizeX: 3,
      sizeY: 5,
      sizeZ: 3,
      blockCount: 25,
      voxels: [
        [-1,0,-1,MAT.STEEL],[0,0,-1,MAT.STEEL],[1,0,-1,MAT.STEEL],
        [-1,0,0,MAT.STEEL],[0,0,0,MAT.STEEL],[1,0,0,MAT.STEEL],
        [-1,0,1,MAT.STEEL],[0,0,1,MAT.STEEL],[1,0,1,MAT.STEEL],
        [-1,1,0,MAT.C4_EXPLOSIVE],[1,1,0,MAT.C4_EXPLOSIVE],[0,1,-1,MAT.C4_EXPLOSIVE],[0,1,1,MAT.C4_EXPLOSIVE],
        [-1,2,0,MAT.FLOAT_YELLOW],[1,2,0,MAT.FLOAT_YELLOW],[0,2,-1,MAT.FLOAT_YELLOW],[0,2,1,MAT.FLOAT_YELLOW],
        [-1,3,0,MAT.C4_EXPLOSIVE],[1,3,0,MAT.C4_EXPLOSIVE],[0,3,-1,MAT.C4_EXPLOSIVE],[0,3,1,MAT.C4_EXPLOSIVE],
        [-1,4,-1,MAT.STEEL],[0,4,-1,MAT.STEEL],[1,4,-1,MAT.STEEL],
        [-1,4,0,MAT.STEEL],[0,4,0,MAT.STEEL],[1,4,0,MAT.STEEL],
        [-1,4,1,MAT.STEEL],[0,4,1,MAT.STEEL],[1,4,1,MAT.STEEL],
      ],
    },
    {
      id: 'prop_jersey_barrier',
      name: 'Jersey Concrete Barrier',
      category: 'HAZARD',
      tag: 'Highway Deflector · 150kg',
      createdAt: 'Pre-Built Prop',
      sizeX: 6,
      sizeY: 3,
      sizeZ: 3,
      blockCount: 28,
      voxels: [
        [-3,0,-1,MAT.CONCRETE],[-2,0,-1,MAT.CONCRETE],[-1,0,-1,MAT.CONCRETE],[0,0,-1,MAT.CONCRETE],[1,0,-1,MAT.CONCRETE],[2,0,-1,MAT.CONCRETE],
        [-3,0,0,MAT.CONCRETE],[-2,0,0,MAT.CONCRETE],[-1,0,0,MAT.CONCRETE],[0,0,0,MAT.CONCRETE],[1,0,0,MAT.CONCRETE],[2,0,0,MAT.CONCRETE],
        [-3,0,1,MAT.CONCRETE],[-2,0,1,MAT.CONCRETE],[-1,0,1,MAT.CONCRETE],[0,0,1,MAT.CONCRETE],[1,0,1,MAT.CONCRETE],[2,0,1,MAT.CONCRETE],
        [-3,1,0,MAT.RAMP_ORANGE],[-2,1,0,MAT.CONCRETE],[-1,1,0,MAT.CONCRETE],[0,1,0,MAT.CONCRETE],[1,1,0,MAT.CONCRETE],[2,1,0,MAT.RAMP_ORANGE],
        [-3,2,0,MAT.ROAD_LINE],[-2,2,0,MAT.CONCRETE],[-1,2,0,MAT.CONCRETE],[0,2,0,MAT.CONCRETE],[1,2,0,MAT.CONCRETE],[2,2,0,MAT.ROAD_LINE],
      ],
    },
    {
      id: 'prop_stunt_ball',
      name: 'Stunt Soccer Sphere',
      category: 'STUNT',
      tag: 'Bouncy Target Ball · 12kg',
      createdAt: 'Pre-Built Prop',
      sizeX: 5,
      sizeY: 5,
      sizeZ: 5,
      blockCount: 24,
      voxels: [
        [0,0,0,MAT.PAINT_CARBON],[-1,0,0,MAT.NEON_CYAN],[1,0,0,MAT.NEON_CYAN],[0,0,-1,MAT.NEON_CYAN],[0,0,1,MAT.NEON_CYAN],
        [0,1,-1,MAT.FLOAT_YELLOW],[0,1,1,MAT.FLOAT_YELLOW],[-1,1,0,MAT.FLOAT_YELLOW],[1,1,0,MAT.FLOAT_YELLOW],
        [0,2,0,MAT.PAINT_CARBON],[-1,2,0,MAT.NEON_CYAN],[1,2,0,MAT.NEON_CYAN],[0,2,-1,MAT.NEON_CYAN],[0,2,1,MAT.NEON_CYAN],
        [0,3,-1,MAT.FLOAT_YELLOW],[0,3,1,MAT.FLOAT_YELLOW],[-1,3,0,MAT.FLOAT_YELLOW],[1,3,0,MAT.FLOAT_YELLOW],
        [0,4,0,MAT.PAINT_CARBON],
      ],
    },
    {
      id: 'prop_single_bowling_pin',
      name: 'Target Bowling Pin',
      category: 'STUNT',
      tag: 'Knockdown Target · 5kg',
      createdAt: 'Pre-Built Prop',
      sizeX: 2,
      sizeY: 6,
      sizeZ: 2,
      blockCount: 14,
      voxels: [
        [-1,0,0,MAT.PAINT_WHITE],[0,0,0,MAT.PAINT_WHITE],
        [-1,1,0,MAT.PAINT_WHITE],[0,1,0,MAT.PAINT_WHITE],
        [-1,2,0,MAT.PAINT_WHITE],[0,2,0,MAT.PAINT_WHITE],
        [-1,3,0,MAT.PAINT_CRIMSON],[0,3,0,MAT.PAINT_CRIMSON],
        [-1,4,0,MAT.PAINT_CRIMSON],[0,4,0,MAT.PAINT_CRIMSON],
        [-1,5,0,MAT.PAINT_WHITE],[0,5,0,MAT.PAINT_WHITE],
      ],
    },
  ];
}

export const PREBUILT_OBJECTS = createPrebuiltPlaceableObjects();

export interface SubterraneanCaveColumn {
  hasCave: boolean;
  caveFloorVY: number;
  caveCeilVY: number;
  floorMat: number;
  ceilMat: number;
  archRimTopVY: number;
  archRimMat: number;
  stalactiteLen?: number;
  stalagmiteLen?: number;
}

/**
 * Evaluates the interconnected subterranean cave network and the Grand Surface Cave Entrance Ramp
 * at world micro-voxel column (vx, vz).
 * Uses fast 2D continuous wave fields so chunk generation runs in <1ms without 3D noise loops!
 */
const _NO_CAVE_COLUMN: SubterraneanCaveColumn = {
  hasCave: false,
  caveFloorVY: 0,
  caveCeilVY: 0,
  floorMat: MAT.ROCK,
  ceilMat: MAT.ROCK,
  archRimTopVY: 0,
  archRimMat: MAT.ROCK,
  stalactiteLen: 0,
  stalagmiteLen: 0,
};

export function evaluateSubterraneanCaveColumn(
  vx: number,
  vz: number,
  surfVY: number,
): SubterraneanCaveColumn {
  const noCave = _NO_CAVE_COLUMN;

  const spatialHash = ((vx * 73856093) ^ (vz * 19349663)) >>> 0;

  // 0. EXEMPT WEST BEACH & OCEAN SHORELINE BASIN (vx < -44, i.e. wx < -11m)
  // Keep the western beach and ocean shoreline 100% solid bedrock underground so craters/trenches dug near the beach never punch into hollow caves!
  if (vx < -44) {
    return noCave;
  }

  // 1. GRAND SURFACE CAVE ENTRANCE PORTAL & WIDE DESCENT RAMP
  // Located at vx in [52..104] (wx = 13m..26m, comfortably east of the central proving ground),
  // descending from vz = -24 down to vz = 84 into the Grand Cathedral Cavern Hub!
  if (vx >= 52 && vx <= 104 && vz >= -24 && vz <= 84) {
    const absDx = Math.abs(vx - 72);
    const rampProgress = Math.max(0, Math.min(1, (vz - -36) / 116)); // 0.0 at vz=-36 -> 1.0 at vz=+80
    const rampFloorVY = Math.round((10 + SUBTERRANEAN_DEPTH_VY) - rampProgress * 44); // vy=58 down to vy=14

    // Rugged Cavern Cliff Walls framing the surface entrance trench (absDx in 21..28)
    // Only return early for vz <= 24; beyond vz > 24, let columns merge seamlessly into the Grand Hub Cavern!
    if (absDx >= 21) {
      if (vz <= 24) {
        let archRimTopVY = 0;
        let archRimMat: number = MAT.ROCK;
        if (vz >= -28 && vz <= 24) {
          const isPortalMouth = vz >= 6 && vz <= 20;
          const cragWave = Math.round(Math.sin(vz * 0.25 + vx * 0.3) * 2.5);
          archRimTopVY = surfVY + (isPortalMouth ? 16 : 8) + cragWave - Math.floor((absDx - 21) * 0.8);
          if (isPortalMouth && absDx <= 23 && (spatialHash & 15) === 0) {
            archRimMat = MAT.GLOW_CRYSTAL;
          } else {
            archRimMat = (spatialHash & 3) === 0 ? MAT.ARMOR_SLATE : MAT.ROCK;
          }
        }
        return {
          hasCave: false,
          caveFloorVY: 0,
          caveCeilVY: 0,
          floorMat: MAT.ROCK,
          ceilMat: MAT.ROCK,
          archRimTopVY: Math.max(0, archRimTopVY),
          archRimMat,
          stalactiteLen: 0,
          stalagmiteLen: 0,
        };
      }
    } else {
      // Inside the 41-voxel-wide (10.25m) cavernous entrance ramp (absDx <= 20):
      // From vz = -36..11: Open-air sloped gorge cutting cleanly through the surface!
      // From vz = 12..84: Passes under the natural stone arch into the deep vaulted cavern!
      const isUndergroundSection = vz >= 12;
      const archFactor = Math.sqrt(Math.max(0.15, 1.0 - (absDx / 21) * (absDx / 21)));
      const vaultedRampCeil = rampFloorVY + Math.round(28 * archFactor);
      const caveCeilVY = isUndergroundSection
        ? Math.min(surfVY - 5, Math.max(rampFloorVY + 16, vaultedRampCeil))
        : surfVY + 12;

      // Natural dark cavern slate & rock floor with subtle bioluminescent crystal markers along the walls
      let floorMat: number = absDx <= 12 ? MAT.ASPHALT : MAT.ROCK;
      if (absDx >= 18) {
        floorMat = (spatialHash & 15) === 0 ? MAT.GLOW_CRYSTAL : MAT.ARMOR_SLATE;
      }

      // Natural Jagged Stone Portal Arch Lintel at vz in [8..20]
      let archRimTopVY = 0;
      let archRimMat: number = MAT.ROCK;
      if (vz >= 8 && vz <= 20) {
        archRimTopVY = surfVY + 16 - Math.floor(absDx * 0.28);
        archRimMat = (spatialHash & 19) === 0 ? MAT.GLOW_CRYSTAL : MAT.ROCK;
      }

      const ceilMat = (spatialHash & 31) === 0 ? MAT.GLOW_CRYSTAL : MAT.ROCK;
      const stalactiteLen =
        isUndergroundSection && absDx >= 10 && (spatialHash & 15) === 0
          ? 1 + (spatialHash & 3)
          : 0;

      return {
        hasCave: true,
        caveFloorVY: rampFloorVY,
        caveCeilVY,
        floorMat,
        ceilMat,
        archRimTopVY,
        archRimMat,
        stalactiteLen,
        stalagmiteLen: 0,
      };
    }
  }

  // 2. GRAND SUBTERRANEAN CATHEDRAL CAVERN HUB (at the foot of the entrance ramp, centered at vx=72, vz=96)
  // Massive 96x88 voxel radius (48m x 44m underground dome!)
  const hubDx = (vx - 72) / 96;
  const hubDz = (vz - 96) / 88;
  const hubDistSq = hubDx * hubDx + hubDz * hubDz;

  // 3. MASSIVE INTERCONNECTED SUBTERRANEAN CAVE NETWORK
  // Three wide, organic cavern rifts that weave and intersect across the entire world:
  const wNS = Math.sin((vx - 72) * 0.011 + Math.sin((vz - 96) * 0.0065) * 1.65);
  const wEW = Math.sin((vz - 96) * 0.011 + Math.sin((vx - 72) * 0.0065) * 1.65);
  const wDiag = Math.sin((vx - 72) * 0.0085 + (vz - 96) * 0.0085 + Math.cos((vx - vz) * 0.0055) * 1.45);

  const absNS = Math.abs(wNS);
  const absEW = Math.abs(wEW);
  const absDiag = Math.abs(wDiag);

  const inNSTunnel = absNS < 0.52;
  const inEWTunnel = absEW < 0.52;
  const inDiagTunnel = absDiag < 0.38;
  const inHub = hubDistSq < 1.0;

  if (!inNSTunnel && !inEWTunnel && !inDiagTunnel && !inHub) {
    return noCave;
  }

  // Compute how centered we are inside the tunnel/chamber (0.0 at wall -> 1.0 at center)
  const nsStrength = inNSTunnel ? 1.0 - absNS / 0.52 : 0;
  const ewStrength = inEWTunnel ? 1.0 - absEW / 0.52 : 0;
  const diagStrength = inDiagTunnel ? 1.0 - absDiag / 0.38 : 0;
  const hubStrength = inHub ? 1.0 - hubDistSq : 0;
  const tunnelStrength = Math.max(nsStrength, ewStrength, diagStrength, hubStrength);
  const isIntersectionChamber =
    (inNSTunnel && inEWTunnel) ||
    (inNSTunnel && inDiagTunnel) ||
    (inEWTunnel && inDiagTunnel) ||
    inHub;

  // Smoothly undulating subterranean cavern floor between vy = 8 and vy = 22
  // Matches vy = 14 at the foot of the entrance ramp (vx=72, vz=84)!
  const floorWave =
    Math.sin((vx - 72) * 0.0055 + (vz - 84) * 0.0055) * 4.0 +
    Math.cos((vx - 72) * 0.010 - (vz - 84) * 0.0085) * 2.0;
  const hubBlend = inHub ? Math.max(0, 1.0 - hubDistSq * 1.35) : 0;
  const rawFloorVY = Math.round(14 + floorWave * (1.0 - hubBlend));
  const caveFloorVY = Math.max(6, Math.min(24, rawFloorVY));

  // Soaring vaulted cathedral ceiling height: up to 36 micro-voxels (9.0m) above floor,
  // with organic rock ceiling undulation so it looks like a real natural cavern!
  const ceilRipple =
    Math.sin(vx * 0.045 + vz * 0.035) * 2.2 +
    Math.cos(vx * 0.08 - vz * 0.07) * 1.3;
  const archProfile = Math.sqrt(Math.max(0.18, tunnelStrength));
  const baseRoomHeight = isIntersectionChamber ? 35 : 26;
  const vaultHeight = Math.max(
    10,
    Math.round(baseRoomHeight * archProfile + ceilRipple * archProfile),
  );

  // Watertight ceiling safety bound: keep a thick 16-voxel (4.0m) solid rock crust below surface terrain!
  const crustMargin = surfVY <= WATER_VY + 4 ? 18 : 14;
  const maxSafeCeil = surfVY - crustMargin;
  const caveCeilVY = Math.min(maxSafeCeil, caveFloorVY + vaultHeight);

  if (caveCeilVY <= caveFloorVY + 6) {
    return noCave;
  }

  // Authentic Dark Cavern Geological Materials & Sparse Bioluminescent Ore Pockets
  let floorMat: number = (spatialHash & 3) === 0 ? MAT.ARMOR_SLATE : MAT.ROCK;
  let ceilMat: number = MAT.ROCK;

  if (tunnelStrength < 0.28 && (spatialHash & 31) === 0) {
    // Sparse glowing crystal & deep magma pockets tucked along cavern walls
    floorMat = caveFloorVY <= 11 ? MAT.GLOW_MAGMA : MAT.GLOW_CRYSTAL;
  } else if (caveFloorVY <= 9 && (spatialHash & 31) < 2) {
    floorMat = MAT.GLOW_MAGMA;
  } else if (tunnelStrength > 0.65 && (spatialHash & 7) === 0) {
    floorMat = MAT.ASPHALT;
  }

  // Sparse bioluminescent crystal veins across the high vaulted roof (~3% density for moody darkness)
  if ((spatialHash & 31) === 0 || (isIntersectionChamber && (spatialHash & 23) === 0)) {
    ceilMat = caveFloorVY <= 10 && (spatialHash & 3) === 0 ? MAT.GLOW_MAGMA : MAT.GLOW_CRYSTAL;
  }

  // Natural hanging stalactites & rising stalagmites (kept clear of center driving lane)
  const roomSpan = caveCeilVY - caveFloorVY;
  let stalactiteLen = 0;
  let stalagmiteLen = 0;
  if (roomSpan >= 14) {
    const formNoise = Math.sin(vx * 0.37) * Math.cos(vz * 0.41);
    if (formNoise > 0.72 && (spatialHash & 3) === 0) {
      stalactiteLen = Math.min(6, 1 + ((spatialHash >> 4) % 5));
    }
    if (tunnelStrength < 0.48 && tunnelStrength > 0.16 && formNoise < -0.76 && (spatialHash & 7) === 0) {
      stalagmiteLen = Math.min(4, 1 + ((spatialHash >> 7) % 4));
    }
  }

  return {
    hasCave: true,
    caveFloorVY,
    caveCeilVY,
    floorMat,
    ceilMat,
    archRimTopVY: 0,
    archRimMat: MAT.ROCK,
    stalactiteLen,
    stalagmiteLen,
  };
}

/**
 * Internal relative surface height evaluator (before adding SUBTERRANEAN_DEPTH_VY).
 */
function evaluateBiomeColumnRelative(
  wx: number,
  wz: number,
  vx: number,
  vz: number,
  mode: WorldGenMode,
  flatMat: number = MAT.ASPHALT,
  heightmapData?: {
    width: number;
    height: number;
    heights: Uint8Array;
    scaleY: number;
  } | null,
): { surfVY: number; topMat: number; subMat: number } {
  const relWaterVY = WATER_VY - SUBTERRANEAN_DEPTH_VY;

  if (mode === 'FLAT_BASEPLATE') {
    const isGridLine = (vx & 15) === 0 || (vz & 15) === 0;
    const topMat =
      flatMat === MAT.ASPHALT && isGridLine ? MAT.ROAD_LINE : flatMat;
    return {
      surfVY: 10,
      topMat,
      subMat: MAT.ROCK,
    };
  }

  if (mode === 'CUSTOM_HEIGHTMAP' && heightmapData && heightmapData.width > 0 && heightmapData.height > 0) {
    // Map world coordinates smoothly across the heightmap (repeating/mirroring cleanly for unlimited world!)
    const normU = ((wx + 128) / 256);
    const normV = ((wz + 128) / 256);
    const wrapU = ((normU % 1) + 1) % 1;
    const wrapV = ((normV % 1) + 1) % 1;
    const px = Math.min(heightmapData.width - 1, Math.floor(wrapU * heightmapData.width));
    const pz = Math.min(heightmapData.height - 1, Math.floor(wrapV * heightmapData.height));
    const lum = heightmapData.heights[px + pz * heightmapData.width] / 255;

    const maxRelY = CHUNK_Y - SUBTERRANEAN_DEPTH_VY;
    const maxVY = Math.min(maxRelY - 4, Math.max(12, heightmapData.scaleY || 28));
    const surfVY = Math.max(3, Math.min(maxRelY - 3, Math.round(4 + lum * (maxVY - 4))));

    let topMat: number = MAT.GRASS;
    let subMat: number = MAT.DIRT;
    if (surfVY <= relWaterVY + 1) {
      topMat = MAT.SAND;
      subMat = MAT.SAND;
    } else if (surfVY >= 22) {
      topMat = MAT.CONCRETE;
      subMat = MAT.ROCK;
    } else if (surfVY >= 16) {
      topMat = MAT.CANYON_ORANGE;
      subMat = MAT.CANYON_RED;
    }
    return { surfVY, topMat, subMat };
  }

  if (mode === 'CUSTOM_GLB_MAP') {
    const dist = Math.hypot(wx, wz);
    // Smooth deepening: near the island shore (< 24m) the shelf is shallow (surfVY = 6..7).
    // As you sail further into the open ocean, the seabed slopes downward into a deep dark trench (surfVY = -40..-42).
    const deepDrop = Math.max(0, Math.min(1, (dist - 24.0) / 130.0));
    const seabedWave = Math.sin(wx * 0.04) * Math.cos(wz * 0.04) * 1.5;
    const baseVY = 6.0 - deepDrop * 46.0 + seabedWave;
    const surfVY = Math.max(-42, Math.min(7, Math.round(baseVY)));
    return {
      surfVY,
      topMat: deepDrop > 0.35 || surfVY <= 2 ? MAT.ROCK : MAT.SAND,
      subMat: MAT.ROCK,
    };
  }

  // Fast deterministic 2D trigonometric terrain waves for unlimited biomes
  const n1 = Math.sin(wx * 0.032) * Math.cos(wz * 0.032);
  const n2 = Math.sin((wx + wz) * 0.065) * 0.5;
  const distOrigin = Math.hypot(wx, wz);

  // Keep a flat 18m spawn pad around (0, -4) so the vehicle always spawns cleanly on level ground
  if (distOrigin < 18) {
    const isStripe = Math.abs(wx) < 0.4 && ((vz >> 3) & 1) === 0;
    return {
      surfVY: 10,
      topMat: isStripe ? MAT.ROAD_LINE : MAT.ASPHALT,
      subMat: MAT.ROCK,
    };
  }

  if (mode === 'BIOME_CANYON') {
    const ridge = Math.abs(n1 + n2 * 0.6);
    let surfVY = 10;
    let topMat: number = MAT.SAND;
    if (ridge > 0.62) {
      surfVY = 22;
      topMat = MAT.CANYON_ORANGE;
    } else if (ridge > 0.35) {
      surfVY = 15;
      topMat = MAT.CANYON_RED;
    } else if (ridge < 0.12) {
      surfVY = 7;
      topMat = MAT.SAND;
    }
    return { surfVY, topMat, subMat: MAT.CANYON_RED };
  }

  if (mode === 'BIOME_ARCTIC') {
    const hVal = n1 * 7.5 + n2 * 4.0;
    const surfVY = Math.max(6, Math.min(28, Math.round(11 + hVal)));
    let topMat: number = MAT.CONCRETE; // Snow/Glacier crust
    if (surfVY <= relWaterVY + 1) {
      topMat = MAT.GLASS_SOLID; // Glacial Ice Shelf
    } else if (surfVY >= 19) {
      topMat = MAT.ARMOR_SLATE; // Exposed Alpine Peak Rock
    }
    return { surfVY, topMat, subMat: MAT.ROCK };
  }

  if (mode === 'BIOME_VOLCANIC') {
    const craterWave = Math.sin(distOrigin * 0.055) + n2 * 0.7;
    const surfVY = Math.max(6, Math.min(26, Math.round(11 + craterWave * 5.5)));
    let topMat: number = MAT.ASPHALT; // Dark Basalt
    if (surfVY <= 8) {
      topMat = ((vx + vz) & 3) === 0 ? MAT.GLOW_MAGMA : MAT.RAMP_ORANGE; // Glowing Magma trench!
    } else if (surfVY >= 17) {
      topMat = MAT.STEEL;
    }
    return { surfVY, topMat, subMat: MAT.ROCK };
  }

  if (mode === 'BIOME_ARCHIPELAGO') {
    const islandWave = Math.sin(wx * 0.045) * Math.sin(wz * 0.045) + n2 * 0.35;
    const rawH =
      islandWave >= 0
        ? Math.round(8 + islandWave * 7.5)
        : Math.round(8 + islandWave * 28.0);
    const surfVY = Math.max(-36, Math.min(20, rawH));
    let topMat: number = MAT.GRASS;
    if (surfVY <= relWaterVY - 10) {
      topMat = MAT.ROCK;
    } else if (surfVY <= relWaterVY + 2) {
      topMat = MAT.SAND;
    } else if (surfVY >= 15) {
      topMat = MAT.ROCK;
    }
    return {
      surfVY,
      topMat,
      subMat: surfVY <= relWaterVY - 6 ? MAT.ROCK : MAT.SAND,
    };
  }

  // DEFAULT_PARK (with unlimited outer terrain continuation beyond +/-128m!)
  const edgeDist = Math.max(Math.abs(wx), Math.abs(wz));
  const isPlaza = Math.abs(wx) < 22 && Math.abs(wz) < 22;
  const isMainEW = Math.abs(wz) < 6.0 && wx > -95 && wx < 115;
  const isMainNS = Math.abs(wx) < 6.0 && wz > -115 && wz < 115;
  const isRunway = Math.abs(wx) < 10.0 && wz > 42 && wz < 118;

  if (edgeDist > 128 && !(wx < -22 && wz < 35)) {
    // Unlimited procedural rolling hills & highways outside the initial 256m park (except the endless West Ocean)!
    const isInfiniteRoad = (Math.abs(wx) < 6.0 || Math.abs(wz) < 6.0) && wx >= -28;
    if (isInfiniteRoad) {
      const isStripe =
        (Math.abs(wx) < 0.35 && ((vz >> 4) & 1) === 0) ||
        (Math.abs(wz) < 0.35 && ((vx >> 4) & 1) === 0);
      return {
        surfVY: 10,
        topMat: isStripe ? MAT.ROAD_LINE : MAT.ASPHALT,
        subMat: MAT.ROCK,
      };
    }
    const hill = Math.round(10 + n1 * 5.0 + n2 * 3.0);
    const surfVY = Math.max(6, Math.min(24, hill));
    return {
      surfVY,
      topMat: surfVY > 16 ? MAT.CANYON_ORANGE : surfVY <= 9 ? MAT.SAND : MAT.GRASS,
      subMat: MAT.DIRT,
    };
  }

  if (edgeDist > 118 && !(wx < -22 && wz < 35)) {
    return {
      surfVY: 15 + Math.min(8, Math.floor((edgeDist - 118) * 0.8)),
      topMat: MAT.CANYON_RED,
      subMat: MAT.ROCK,
    };
  }
  if (isPlaza || isMainEW || isMainNS || isRunway) {
    const isStripe =
      (isMainEW && Math.abs(wz) < 0.35 && ((vx >> 4) & 1) === 0) ||
      (isMainNS && Math.abs(wx) < 0.35 && ((vz >> 4) & 1) === 0) ||
      (isRunway && Math.abs(wx) < 0.5 && ((vz >> 4) & 1) === 0);
    return {
      surfVY: 10,
      topMat: isStripe ? MAT.ROAD_LINE : MAT.ASPHALT,
      subMat: MAT.ROCK,
    };
  }
  if (wx < -22 && wz < 35) {
    // Distance into the ocean bay from the east beach (wx = -25.5) and north beach (wz = 33.0)
    const distFromEastBeach = -25.5 - wx;
    const distFromNorthBeach = wz > 17.0 ? (33.0 - wz) * 1.4 : Infinity;
    const shoreDist = Math.min(distFromEastBeach, distFromNorthBeach);

    // Smooth sloping sandy beach & swash zone (wx between -22 and -25.5, or wz between 33 and 35)
    // Waves rise above surfVY = 8..9 and smash directly onto this sloped sand beach!
    if (shoreDist <= 0) {
      const beachVY = shoreDist > -1.75 ? 8 : shoreDist > -3.0 ? 9 : 10;
      return {
        surfVY: beachVY,
        topMat: MAT.SAND,
        subMat: MAT.SAND,
      };
    }

    // Lighthouse Island at (-72, -54) with gradual underwater shelf & sandy beach
    const dIsland = Math.hypot(wx - -72, wz - -54);
    if (dIsland < 23.5) {
      const surfVY =
        dIsland < 15.5
          ? 11
          : dIsland < 19.0
            ? 10
            : dIsland < 21.5
              ? 9
              : 8;
      return {
        surfVY,
        topMat: surfVY <= 9 ? MAT.SAND : MAT.GRASS,
        subMat: MAT.DIRT,
      };
    }

    // Smooth West Marina Concrete Boat Slipway sloping into deep water (wz around -14)
    if (wx > -48 && Math.abs(wz - -14) < 7.5) {
      const drop = Math.floor(shoreDist * 0.65);
      return {
        surfVY: Math.max(-6, 9 - drop),
        topMat: MAT.CONCRETE,
        subMat: MAT.ROCK,
      };
    }

    // Gradually deepening ocean seabed:
    // - Near shore (0 < shoreDist <= 4m): gentle surf sandbar (surfVY = 7 down to 5)
    // - Offshore (shoreDist > 4m): slopes smoothly deeper and deeper down to surfVY = -38 (11.5m water depth!)
    //   so boats never scrape the bottom and submarines can dive into the deep ocean trench.
    const seabedRipple = Math.sin(wx * 0.055) * Math.cos(wz * 0.055) * 1.1;
    let targetVY: number;
    if (shoreDist <= 4.0) {
      targetVY = 8.0 - shoreDist * 0.75;
    } else {
      targetVY = 5.0 - (shoreDist - 4.0) * 0.44 + seabedRipple;
    }
    if (dIsland < 38.0) {
      const islandShelfVY = 8.0 - (dIsland - 23.0) * 1.45;
      targetVY = Math.max(targetVY, islandShelfVY);
    }
    const surfVY = Math.max(-38, Math.min(7, Math.round(targetVY)));
    const topMat = surfVY <= -10 ? MAT.ROCK : MAT.SAND;
    const subMat = surfVY <= -4 ? MAT.ROCK : MAT.SAND;
    return { surfVY, topMat, subMat };
  }
  if (wx > 32 && wz > 24) {
    const distMesa = Math.max(Math.abs(wx - 72), Math.abs(wz - 68));
    if (distMesa < 22) {
      return { surfVY: 18, topMat: MAT.CANYON_ORANGE, subMat: MAT.CANYON_RED };
    }
    if (distMesa < 34) {
      return { surfVY: 14, topMat: MAT.CANYON_RED, subMat: MAT.CANYON_RED };
    }
    return { surfVY: 10, topMat: MAT.SAND, subMat: MAT.CANYON_RED };
  }
  if (wx > 28 && wz < -24) {
    return {
      surfVY: 10,
      topMat:
        Math.abs(wx - 64) < 4.5 || Math.abs(wz - -64) < 4.5
          ? MAT.ASPHALT
          : MAT.CONCRETE,
      subMat: MAT.ROCK,
    };
  }

  return { surfVY: 10, topMat: MAT.GRASS, subMat: MAT.DIRT };
}

/**
 * Pure procedural biome height & material evaluator for unlimited world chunk generation!
 * Works at ANY (wx, wz) coordinate without boundaries, and includes SUBTERRANEAN_DEPTH_VY (36 voxels)
 * so the world has deep underground rock & interconnected caves!
 */
export function evaluateBiomeColumn(
  wx: number,
  wz: number,
  vx: number,
  vz: number,
  mode: WorldGenMode,
  flatMat: number = MAT.ASPHALT,
  heightmapData?: {
    width: number;
    height: number;
    heights: Uint8Array;
    scaleY: number;
  } | null,
): { surfVY: number; topMat: number; subMat: number } {
  const rel = evaluateBiomeColumnRelative(wx, wz, vx, vz, mode, flatMat, heightmapData);
  return {
    surfVY: rel.surfVY + SUBTERRANEAN_DEPTH_VY,
    topMat: rel.topMat,
    subMat: rel.subMat,
  };
}

/**
 * Generates procedural 2D grayscale heightmap data (64x64) for quick one-click testing
 * in addition to custom PNG/JPG file uploads!
 */
export function generateProceduralHeightmapPreset(
  preset: 'CRATER_BASIN' | 'TWIN_PEAKS' | 'SPIRAL_CANYON' | 'ATOLL_RING',
  size = 64,
): { width: number; height: number; heights: Uint8Array; scaleY: number } {
  const heights = new Uint8Array(size * size);
  for (let z = 0; z < size; z++) {
    const nz = (z / size) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const r = Math.hypot(nx, nz);
      let h = 0.25;

      // Keep center spawn area flat so vehicle spawns level
      if (r < 0.14) {
        h = 0.26;
      } else if (preset === 'CRATER_BASIN') {
        const rim = Math.exp(-Math.pow((r - 0.62) / 0.18, 2));
        h = 0.24 + rim * 0.68;
      } else if (preset === 'TWIN_PEAKS') {
        const p1 = Math.exp(-((nx - 0.45) ** 2 + (nz - 0.35) ** 2) * 8.0);
        const p2 = Math.exp(-((nx + 0.45) ** 2 + (nz + 0.35) ** 2) * 8.0);
        h = 0.25 + (p1 + p2) * 0.72;
      } else if (preset === 'SPIRAL_CANYON') {
        const ang = Math.atan2(nz, nx);
        const spiral = Math.sin(r * 10.0 + ang * 2.0) * 0.5 + 0.5;
        h = 0.2 + spiral * 0.65 * Math.min(1, (r - 0.14) * 2.5);
      } else {
        // ATOLL_RING
        const ring = Math.exp(-Math.pow((r - 0.52) / 0.16, 2));
        h = 0.12 + ring * 0.75;
      }

      heights[x + z * size] = Math.max(0, Math.min(255, Math.round(h * 255)));
    }
  }
  return { width: size, height: size, heights, scaleY: 28 };
}

/**
 * 3D Connected-Components (6-Neighbor Flood Fill) for Structural Split & Fracture ("Real Break-Offs").
 * Returns { keptKeys, detachedIslands } where detachedIslands are any disconnected voxel clusters
 * that are no longer attached to the vehicle's main core (Cockpit or largest component)!
 */
export function findDisconnectedVoxelIslands(
  voxelMap: Map<any, number>,
  cockpitVoxel: { vx: number; vy: number; vz: number } | null,
): {
  detachedIslands: Array<Array<[number, number, number, number]>>;
} {
  if (voxelMap.size <= 1) return { detachedIslands: [] };

  const visited = new Set<number | string>();
  const components: Array<{
    hasCockpit: boolean;
    voxels: Array<[number, number, number, number]>;
  }> = [];

  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  voxelMap.forEach((startMat, startKey) => {
    if (startMat === MAT.AIR || visited.has(startKey)) return;
    visited.add(startKey);

    const isIntKey = typeof startKey === 'number';
    const compVoxels: Array<[number, number, number, number]> = [];
    let hasCockpit = false;
    const queue: Array<number | string> = [startKey];
    let head = 0;

    while (head < queue.length) {
      const key = queue[head++];
      const mat = voxelMap.get(key) || MAT.AIR;
      if (mat === MAT.AIR) continue;
      const [vx, vy, vz] = parseVoxelCoords(key);
      compVoxels.push([vx, vy, vz, mat]);

      if (
        cockpitVoxel &&
        Math.abs(vx - cockpitVoxel.vx) <= 2 &&
        Math.abs(vy - cockpitVoxel.vy) <= 2 &&
        Math.abs(vz - cockpitVoxel.vz) <= 2
      ) {
        hasCockpit = true;
      }

      for (let d = 0; d < 6; d++) {
        const nx = vx + dirs[d][0];
        const ny = vy + dirs[d][1];
        const nz = vz + dirs[d][2];
        const nKey: number | string = isIntKey
          ? (((nx + 512) & 0x3ff) << 20) |
            (((ny + 512) & 0x3ff) << 10) |
            ((nz + 512) & 0x3ff)
          : `${nx},${ny},${nz}`;
        if (!visited.has(nKey) && voxelMap.has(nKey)) {
          visited.add(nKey);
          queue.push(nKey);
        }
      }
    }

    if (compVoxels.length > 0) {
      components.push({ hasCockpit, voxels: compVoxels });
    }
  });

  if (components.length <= 1) {
    return { detachedIslands: [] };
  }

  // Keep the component that contains the Cockpit, or if none, the component with the most voxels!
  let mainIdx = components.findIndex((c) => c.hasCockpit);
  if (mainIdx === -1) {
    mainIdx = 0;
    for (let i = 1; i < components.length; i++) {
      if (components[i].voxels.length > components[mainIdx].voxels.length) {
        mainIdx = i;
      }
    }
  }

  const detachedIslands: Array<Array<[number, number, number, number]>> = [];
  for (let i = 0; i < components.length; i++) {
    if (i !== mainIdx) {
      detachedIslands.push(components[i].voxels);
    }
  }

  return { detachedIslands };
}
