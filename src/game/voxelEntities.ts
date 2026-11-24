import * as THREE from 'three';
import { MAT, VOXEL_SIZE, WATER_LEVEL } from './constants.ts';
import type { VoxelFXSystem } from './fx.ts';
import { ModularVehicleRig } from './vehicle.ts';
import type { MicroVoxelWorld } from './world.ts';
import {
  PropRigidBody,
  type PropShapeType,
} from './physics/propRigidBody.ts';
import {
  computePrefabDimensions,
  type VoxelObjectPrefab,
} from './worldObjects.ts';

export type VoxelEntityPresetId =
  | 'TRAFFIC_CONE'
  | 'WOOD_CRATE'
  | 'EXPLOSIVE_BARREL'
  | 'STUNT_BALL'
  | 'BOWLING_PIN'
  | 'JERSEY_BARRIER'
  | 'STEEL_CONTAINER';

export interface VoxelEntityCoord {
  vx: number;
  vy: number;
  vz: number;
  mat: number;
}

export interface VoxelEntityPresetSpec {
  id: VoxelEntityPresetId;
  name: string;
  shortLabel: string;
  category: 'HAZARD' | 'CRATE' | 'EXPLOSIVE' | 'STUNT' | 'HEAVY';
  description: string;
  badgeColor: string;
  massMultiplier: number;
  linearDamping: number;
  angularDamping: number;
  sizeVoxels: { x: number; y: number; z: number };
}

export const VOXEL_ENTITY_PRESETS: ReadonlyArray<VoxelEntityPresetSpec> = [
  {
    id: 'TRAFFIC_CONE',
    name: 'Traffic Cone',
    shortLabel: 'CONE',
    category: 'HAZARD',
    description: 'Lightweight orange/white runway cone that tips and flies on impact',
    badgeColor: '#fb923c',
    massMultiplier: 0.35,
    linearDamping: 0.03,
    angularDamping: 0.09,
    sizeVoxels: { x: 4, y: 5, z: 4 },
  },
  {
    id: 'WOOD_CRATE',
    name: 'Wooden Supply Crate',
    shortLabel: 'CRATE',
    category: 'CRATE',
    description: 'Hollow timber crate that stacks, floats, and shatters under high-speed impact',
    badgeColor: '#d97706',
    massMultiplier: 0.55,
    linearDamping: 0.03,
    angularDamping: 0.1,
    sizeVoxels: { x: 4, y: 4, z: 4 },
  },
  {
    id: 'EXPLOSIVE_BARREL',
    name: 'Explosive C4 Barrel',
    shortLabel: 'C4 BARREL',
    category: 'EXPLOSIVE',
    description: 'Volatile red hazard drum that detonates in a C4 chain reaction when rammed or shot',
    badgeColor: '#ef4444',
    massMultiplier: 0.65,
    linearDamping: 0.03,
    angularDamping: 0.09,
    sizeVoxels: { x: 3, y: 5, z: 3 },
  },
  {
    id: 'STUNT_BALL',
    name: 'Stunt Soccer Sphere',
    shortLabel: 'STUNT BALL',
    category: 'STUNT',
    description: 'Giant high-restitution bouncy sphere for vehicle soccer and stunt arena hits',
    badgeColor: '#38bdf8',
    massMultiplier: 0.42,
    linearDamping: 0.015,
    angularDamping: 0.04,
    sizeVoxels: { x: 5, y: 5, z: 5 },
  },
  {
    id: 'BOWLING_PIN',
    name: 'Stunt Target Pin',
    shortLabel: 'TARGET PIN',
    category: 'STUNT',
    description: 'Tall white/crimson physics bowling pin for stunt knock-down clusters',
    badgeColor: '#f8fafc',
    massMultiplier: 0.38,
    linearDamping: 0.025,
    angularDamping: 0.08,
    sizeVoxels: { x: 2, y: 6, z: 2 },
  },
  {
    id: 'JERSEY_BARRIER',
    name: 'Jersey Road Barrier',
    shortLabel: 'BARRIER',
    category: 'HEAVY',
    description: 'Heavy reinforced concrete road divider that absorbs and deflects crashes',
    badgeColor: '#94a3b8',
    massMultiplier: 1.35,
    linearDamping: 0.05,
    angularDamping: 0.14,
    sizeVoxels: { x: 6, y: 3, z: 3 },
  },
  {
    id: 'STEEL_CONTAINER',
    name: 'Steel Cargo Box',
    shortLabel: 'STEEL BOX',
    category: 'HEAVY',
    description: 'Heavy industrial steel cargo crate suitable for Grapple Winch towing and stacking',
    badgeColor: '#60a5fa',
    massMultiplier: 1.15,
    linearDamping: 0.04,
    angularDamping: 0.12,
    sizeVoxels: { x: 5, y: 4, z: 5 },
  },
];

export function getVoxelEntityPresetSpec(
  presetId: VoxelEntityPresetId,
): VoxelEntityPresetSpec {
  return (
    VOXEL_ENTITY_PRESETS.find((p) => p.id === presetId) ||
    VOXEL_ENTITY_PRESETS[0]
  );
}

/**
 * Pure deterministic generator for 0.25m micro-voxel coordinates of a Voxel Entity preset.
 * Centered around local grid (vx ~ 12, vy >= 0, vz ~ 18).
 */
export function buildVoxelEntityBlueprintCoords(
  presetId: VoxelEntityPresetId,
): VoxelEntityCoord[] {
  const coords: VoxelEntityCoord[] = [];
  const cx = 12;
  const cz = 18;

  if (presetId === 'TRAFFIC_CONE') {
    // 4x1x4 weighted dark/orange base at vy = 0
    for (let dx = -2; dx <= 1; dx++) {
      for (let dz = -2; dz <= 1; dz++) {
        const isCorner =
          (dx === -2 || dx === 1) && (dz === -2 || dz === 1);
        coords.push({
          vx: cx + dx,
          vy: 0,
          vz: cz + dz,
          mat: isCorner ? MAT.ASPHALT : MAT.RAMP_ORANGE,
        });
      }
    }
    // 2x2 tapered column vy = 1..4 with white reflective collar at vy = 2
    for (let vy = 1; vy <= 4; vy++) {
      const mat = vy === 2 ? MAT.PAINT_WHITE : MAT.RAMP_ORANGE;
      for (let dx = -1; dx <= 0; dx++) {
        for (let dz = -1; dz <= 0; dz++) {
          if (vy === 4 && (dx !== -1 || dz !== -1)) {
            // Single-voxel tip at vy=4 plus diagonal neighbor for 10-connectivity
            if (!(dx === 0 && dz === 0)) continue;
          }
          coords.push({
            vx: cx + dx,
            vy,
            vz: cz + dz,
            mat,
          });
        }
      }
    }
    return coords;
  }

  if (presetId === 'WOOD_CRATE') {
    // 4x4x4 hollow framed wooden crate (1.0m x 1.0m x 1.0m)
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = -2; dx <= 1; dx++) {
        for (let dz = -2; dz <= 1; dz++) {
          const isXFace = dx === -2 || dx === 1;
          const isYFace = dy === 0 || dy === 3;
          const isZFace = dz === -2 || dz === 1;
          // Hollow inside
          if (!isXFace && !isYFace && !isZFace) continue;
          const edgeCount =
            (isXFace ? 1 : 0) + (isYFace ? 1 : 0) + (isZFace ? 1 : 0);
          coords.push({
            vx: cx + dx,
            vy: dy,
            vz: cz + dz,
            mat: edgeCount >= 2 ? MAT.DIRT : MAT.WOOD,
          });
        }
      }
    }
    return coords;
  }

  if (presetId === 'EXPLOSIVE_BARREL') {
    // 3x5x3 explosive C4 drum (0.75m x 1.25m x 0.75m)
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          // Hollow center at dy=2 for lighter drum physics
          if (dx === 0 && dz === 0 && dy === 2) continue;
          const isCorner = Math.abs(dx) === 1 && Math.abs(dz) === 1;
          let mat: number = MAT.C4_EXPLOSIVE;
          if ((dy === 0 || dy === 4) && isCorner) {
            mat = MAT.STEEL;
          } else if (dy === 2 && !isCorner) {
            mat = MAT.ROAD_LINE; // Hazard yellow band around middle
          }
          coords.push({
            vx: cx + dx,
            vy: dy,
            vz: cz + dz,
            mat,
          });
        }
      }
    }
    return coords;
  }

  if (presetId === 'STUNT_BALL') {
    // 5x5x5 rounded bouncy soccer sphere (1.25m diameter)
    for (let dy = 0; dy < 5; dy++) {
      const ry = dy - 2;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const distSq = dx * dx + ry * ry + dz * dz;
          // Outer shell between r^2 = 2 and r^2 = 6 (slices off cube corners for spherical shape)
          if (distSq > 6 || distSq < 2) continue;
          const isPentagonPatch =
            (dx === 0 && dz === 0) ||
            (ry === 0 && (Math.abs(dx) === 2 || Math.abs(dz) === 2));
          const isNeonSeam =
            Math.abs(dx) + Math.abs(ry) + Math.abs(dz) === 3;
          coords.push({
            vx: cx + dx,
            vy: dy,
            vz: cz + dz,
            mat: isPentagonPatch
              ? MAT.PAINT_CARBON
              : isNeonSeam
                ? MAT.NEON_CYAN
                : MAT.FLOAT_YELLOW,
          });
        }
      }
    }
    return coords;
  }

  if (presetId === 'BOWLING_PIN') {
    // 2x6x2 white & crimson stunt target pin (0.5m x 1.5m x 0.5m)
    for (let dy = 0; dy < 6; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        for (let dz = -1; dz <= 0; dz++) {
          // Narrow neck at dy = 3
          if (dy === 3 && dx === 0 && dz === 0) continue;
          const mat =
            dy === 3 || dy === 4 ? MAT.PAINT_CRIMSON : MAT.PAINT_WHITE;
          coords.push({
            vx: cx + dx,
            vy: dy,
            vz: cz + dz,
            mat,
          });
        }
      }
    }
    return coords;
  }

  if (presetId === 'JERSEY_BARRIER') {
    // 6x3x3 tapered concrete highway divider
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = -3; dx <= 2; dx++) {
        const zMin = dy === 0 ? -1 : 0;
        const zMax = dy === 0 ? 1 : 0;
        for (let dz = zMin; dz <= zMax; dz++) {
          const isReflector =
            dy === 2 && (dx === -3 || dx === 2 || dx === 0);
          const isOrangeStripe = dy === 1 && (dx === -3 || dx === 2);
          coords.push({
            vx: cx + dx,
            vy: dy,
            vz: cz + dz,
            mat: isReflector
              ? MAT.ROAD_LINE
              : isOrangeStripe
                ? MAT.RAMP_ORANGE
                : MAT.CONCRETE,
          });
        }
      }
    }
    return coords;
  }

  // STEEL_CONTAINER (5x4x5 hollow ribbed steel cargo box)
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const isXFace = Math.abs(dx) === 2;
        const isYFace = dy === 0 || dy === 3;
        const isZFace = Math.abs(dz) === 2;
        if (!isXFace && !isYFace && !isZFace) continue;
        const isCorner =
          (isXFace ? 1 : 0) + (isYFace ? 1 : 0) + (isZFace ? 1 : 0) >= 2;
        const isHazardCorner =
          isXFace && isYFace && isZFace;
        coords.push({
          vx: cx + dx,
          vy: dy,
          vz: cz + dz,
          mat: isHazardCorner
            ? MAT.ROAD_LINE
            : isCorner
              ? MAT.STEEL
              : MAT.ALLOY_BLUE,
        });
      }
    }
  }
  return coords;
}

/**
 * Creates a lightweight `ModularVehicleRig` configured as a dynamic Voxel Entity (`isVoxelEntity = true`).
 * Does NOT allocate scene SpotLights/PointLights or build-mode helpers.
 */
export function createVoxelEntityRig(
  scene: THREE.Scene,
  world: MicroVoxelWorld,
  fx: VoxelFXSystem,
  presetId: VoxelEntityPresetId,
  wx: number,
  wz: number,
  yawRad = 0,
  heightOffsetMeters = 0.08,
  isStatic = false,
): ModularVehicleRig {
  const spec = getVoxelEntityPresetSpec(presetId);
  const rig = new ModularVehicleRig(scene, world, fx, 'local', true, true);
  rig.isVoxelEntity = true;
  rig.entityPresetId = spec.id;
  rig.entityName = spec.name;
  rig.customBlueprintName = spec.name;
  rig.entityMassMultiplier = spec.massMultiplier;

  const coords = buildVoxelEntityBlueprintCoords(presetId);
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    rig.setVoxel(c.vx, c.vy, c.vz, c.mat);
  }

  rig.rebuildVehicleGeometry(false);
  rig.rigidBody.linearDamping = spec.linearDamping;
  rig.rigidBody.angularDamping = spec.angularDamping;
  rig.saveIntactSnapshot();

  let propShape: PropShapeType = 'box';
  if (presetId === 'TRAFFIC_CONE' || presetId === 'BOWLING_PIN') {
    propShape = 'cone';
  } else if (presetId === 'STUNT_BALL') {
    propShape = 'sphere';
  }

  const sizeMeters = {
    x: spec.sizeVoxels.x * VOXEL_SIZE,
    y: spec.sizeVoxels.y * VOXEL_SIZE,
    z: spec.sizeVoxels.z * VOXEL_SIZE,
  };
  const propMass =
    presetId === 'TRAFFIC_CONE' || presetId === 'BOWLING_PIN'
      ? 5
      : presetId === 'STUNT_BALL'
        ? 12
        : presetId === 'WOOD_CRATE' || presetId === 'EXPLOSIVE_BARREL'
          ? 50
          : Math.max(50, rig.totalMass);

  // Position cleanly on terrain (or above existing stacked entities)
  const ground = world.probeGroundBelow(wx, WATER_LEVEL + 40, wz, 2.0);
  const hasWater = world.isWaterAt(wx, WATER_LEVEL - 0.1, wz);
  const baseSurfY = hasWater ? Math.max(WATER_LEVEL, ground.y) : ground.y;
  const bottomPointOffset = Math.max(
    0.125,
    rig.comLocal.y - (rig.minVY + 0.5) * VOXEL_SIZE,
  );

  rig.position.set(wx, baseSurfY + bottomPointOffset + heightOffsetMeters, wz);
  rig.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
  rig.velocity.set(0, 0, 0);
  rig.angularVelocity.set(0, 0, 0);
  rig.syncPhysicsSnapshot();
  rig.syncVisualTransform();

  const propBody = new PropRigidBody({
    propId: rig.vehicleId,
    prefabId: presetId,
    shape: propShape,
    size: sizeMeters,
    mass: propMass,
    restitution: presetId === 'STUNT_BALL' ? 0.68 : 0.3,
    friction: 0.5,
    isStatic,
    sharedRigidBody: rig.rigidBody,
  });
  rig.propRigidBody = propBody;
  rig.syncToVoxelWorld();

  // Initialize world-space AABB immediately so broadphase collision works even while sleeping
  const halfX = (rig.maxVX - rig.minVX + 2) * VOXEL_SIZE * 0.5 + 0.25;
  const halfY = (rig.maxVY - rig.minVY + 2) * VOXEL_SIZE * 0.5 + 0.25;
  const halfZ = (rig.maxVZ - rig.minVZ + 2) * VOXEL_SIZE * 0.5 + 0.25;
  const radius = Math.hypot(halfX, halfY, halfZ);
  rig.aabbMin.set(rig.position.x - radius, rig.position.y - radius, rig.position.z - radius);
  rig.aabbMax.set(rig.position.x + radius, rig.position.y + radius, rig.position.z + radius);

  return rig;
}

export interface ArenaEntitySpawnPlacement {
  presetId: VoxelEntityPresetId;
  wx: number;
  wz: number;
  yawRad?: number;
  heightOffsetMeters?: number;
}

/**
 * Curated starter set of Trailmakers-style Voxel Entities around the Proving Grounds runway & stunt ramps.
 * Keeps the immediate spawn lane (x: -2..2, z: -3..6) clear while populating visible cones, crates,
 * explosive barrels, bowling pins, jersey barriers, and a stunt soccer sphere right down the runway.
 */
export const DEFAULT_ARENA_ENTITY_PLACEMENTS: ReadonlyArray<ArenaEntitySpawnPlacement> = [
  // Runway Chicane Traffic Cones (left & right edges + slalom gates)
  { presetId: 'TRAFFIC_CONE', wx: -2.6, wz: 6.5, yawRad: 0 },
  { presetId: 'TRAFFIC_CONE', wx: 2.6, wz: 6.5, yawRad: 0 },
  { presetId: 'TRAFFIC_CONE', wx: -1.8, wz: 10.0, yawRad: 0.2 },
  { presetId: 'TRAFFIC_CONE', wx: 1.8, wz: 10.0, yawRad: -0.2 },
  { presetId: 'TRAFFIC_CONE', wx: 0.0, wz: 12.2, yawRad: 0 },
  { presetId: 'TRAFFIC_CONE', wx: -2.5, wz: 14.0, yawRad: 0 },
  { presetId: 'TRAFFIC_CONE', wx: 2.5, wz: 14.0, yawRad: 0 },

  // Wooden Supply Crate Pyramid (left runway shoulder)
  { presetId: 'WOOD_CRATE', wx: -3.2, wz: 11.5, yawRad: 0.05 },
  { presetId: 'WOOD_CRATE', wx: -2.0, wz: 11.5, yawRad: -0.04 },
  {
    presetId: 'WOOD_CRATE',
    wx: -2.6,
    wz: 11.5,
    yawRad: 0.1,
    heightOffsetMeters: 1.02,
  },

  // Explosive C4 Barrel Hazard Cluster (right runway shoulder)
  { presetId: 'EXPLOSIVE_BARREL', wx: 3.1, wz: 11.2, yawRad: 0 },
  { presetId: 'EXPLOSIVE_BARREL', wx: 3.9, wz: 11.8, yawRad: 0.4 },
  { presetId: 'EXPLOSIVE_BARREL', wx: 3.2, wz: 12.4, yawRad: -0.3 },

  // Giant Bouncy Stunt Soccer Sphere (ready to kick/ram)
  { presetId: 'STUNT_BALL', wx: -3.4, wz: 7.8, yawRad: 0 },

  // Stunt Target Bowling Pin Triangle Rack (center-forward down the runway)
  { presetId: 'BOWLING_PIN', wx: 0.0, wz: 16.2, yawRad: 0 },
  { presetId: 'BOWLING_PIN', wx: -0.45, wz: 17.0, yawRad: 0 },
  { presetId: 'BOWLING_PIN', wx: 0.45, wz: 17.0, yawRad: 0 },

  // Heavy Jersey Barriers & Steel Cargo Box flanking the stunt zone
  { presetId: 'JERSEY_BARRIER', wx: -4.8, wz: 15.0, yawRad: Math.PI * 0.12 },
  { presetId: 'JERSEY_BARRIER', wx: 4.8, wz: 15.0, yawRad: -Math.PI * 0.12 },
  { presetId: 'STEEL_CONTAINER', wx: 4.6, wz: 8.5, yawRad: 0.25 },
];

export function spawnDefaultArenaVoxelEntities(
  scene: THREE.Scene,
  world: MicroVoxelWorld,
  fx: VoxelFXSystem,
  applyGfx?: (rig: ModularVehicleRig) => void,
): ModularVehicleRig[] {
  const spawned: ModularVehicleRig[] = [];
  for (let i = 0; i < DEFAULT_ARENA_ENTITY_PLACEMENTS.length; i++) {
    const p = DEFAULT_ARENA_ENTITY_PLACEMENTS[i];
    const entity = createVoxelEntityRig(
      scene,
      world,
      fx,
      p.presetId,
      p.wx,
      p.wz,
      p.yawRad ?? 0,
      p.heightOffsetMeters ?? 0.0,
    );
    entity.rigidBody.isSleeping = true;
    if (entity.propRigidBody) {
      entity.propRigidBody.isSleeping = true;
    }
    if (applyGfx) {
      applyGfx(entity);
    }
    spawned.push(entity);
  }
  return spawned;
}

export type PropTemplateKind = 'BLANK' | 'CRATE' | 'CONE' | 'RAMP' | 'BARRIER' | 'BARREL';

/**
 * Builds voxel coordinates for starter prop templates in the Prop Maker.
 */
export function buildPropTemplateVoxels(template: PropTemplateKind): VoxelEntityCoord[] {
  const coords: VoxelEntityCoord[] = [];
  const cx = 12;
  const cz = 18;

  if (template === 'CRATE') {
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = -2; dx <= 1; dx++) {
        for (let dz = -2; dz <= 1; dz++) {
          const isX = dx === -2 || dx === 1;
          const isY = dy === 0 || dy === 3;
          const isZ = dz === -2 || dz === 1;
          if (!isX && !isY && !isZ) continue;
          const edges = (isX ? 1 : 0) + (isY ? 1 : 0) + (isZ ? 1 : 0);
          coords.push({
            vx: cx + dx,
            vy: dy,
            vz: cz + dz,
            mat: edges >= 2 ? MAT.DIRT : MAT.WOOD,
          });
        }
      }
    }
    return coords;
  }

  if (template === 'CONE') {
    return buildVoxelEntityBlueprintCoords('TRAFFIC_CONE');
  }

  if (template === 'BARREL') {
    return buildVoxelEntityBlueprintCoords('EXPLOSIVE_BARREL');
  }

  if (template === 'BARRIER') {
    return buildVoxelEntityBlueprintCoords('JERSEY_BARRIER');
  }

  if (template === 'RAMP') {
    for (let s = 0; s < 8; s++) {
      const h = Math.floor(s / 2);
      for (let x = -3; x <= 3; x++) {
        for (let y = 0; y <= h; y++) {
          coords.push({
            vx: cx + x,
            vy: y,
            vz: cz - 4 + s,
            mat: y === h ? MAT.RAMP_ORANGE : MAT.STEEL,
          });
        }
      }
    }
    return coords;
  }

  // BLANK
  coords.push({ vx: cx, vy: 0, vz: cz, mat: MAT.BRICK });
  return coords;
}

/**
 * Creates a dynamic or static prop rig from any VoxelObjectPrefab.
 */
export function createCustomPropRig(
  scene: THREE.Scene,
  world: MicroVoxelWorld,
  fx: VoxelFXSystem,
  prefab: VoxelObjectPrefab,
  wx: number,
  wz: number,
  yawRad = 0,
  heightOffsetMeters = 0.08,
  isDynamic = true,
): ModularVehicleRig {
  const rig = new ModularVehicleRig(scene, world, fx, 'local', true, true);
  rig.isVoxelEntity = true;
  rig.entityPresetId = 'TRAFFIC_CONE'; // valid preset fallback
  rig.entityName = prefab.name;
  rig.customBlueprintName = prefab.name;
  rig.entityMassMultiplier = 1.0;

  const cx = 12;
  const cz = 18;
  for (const [dx, dy, dz, mat] of prefab.voxels) {
    if (mat !== MAT.AIR) {
      rig.setVoxel(cx + dx, dy, cz + dz, mat);
    }
  }

  rig.rebuildVehicleGeometry(false);
  rig.rigidBody.linearDamping = 0.03;
  rig.rigidBody.angularDamping = 0.08;
  rig.saveIntactSnapshot();

  const dims = computePrefabDimensions(prefab.voxels);
  const sizeMeters = {
    x: dims.sizeX * VOXEL_SIZE,
    y: dims.sizeY * VOXEL_SIZE,
    z: dims.sizeZ * VOXEL_SIZE,
  };
  const propMass = Math.max(15, prefab.voxels.length * 5);

  const lower = prefab.id.toLowerCase();
  let shape: PropShapeType = 'box';
  if (lower.includes('cone') || lower.includes('pin')) shape = 'cone';
  else if (lower.includes('ball') || lower.includes('sphere')) shape = 'sphere';

  rig.propRigidBody = new PropRigidBody({
    propId: `prop_${prefab.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    prefabId: prefab.id,
    shape,
    size: sizeMeters,
    mass: propMass,
    restitution: shape === 'sphere' ? 0.6 : 0.3,
    friction: 0.5,
    isStatic: !isDynamic,
    mesh: rig.rootGroup,
  });

  const groundY = world.sampleSurfaceHeightFast(wx, wz);
  const spawnY = Math.max(
    groundY + heightOffsetMeters,
    WATER_LEVEL + (isDynamic ? 0.3 : 0.0),
  );
  rig.summonTo(wx, wz, yawRad);
  rig.position.y = spawnY;
  rig.rigidBody.position.y = spawnY;
  rig.propRigidBody.position.set(wx, spawnY + sizeMeters.y * 0.5, wz);
  rig.propRigidBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
  rig.propRigidBody.syncVisualMesh();

  return rig;
}

