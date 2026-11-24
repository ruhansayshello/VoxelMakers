import {
  VOXEL_SIZE,
  WATER_VY,
  VEH_DIM_X,
  VEH_DIM_Y,
  VEH_DIM_Z,
  SYMMETRY_CENTER_X,
  MAT,
  MAT_INFO,
  type ModuleKind,
  type ModuleTuningConfig,
  type BuildPlacementMode,
} from './constants.ts';

let _waterFrontierA = new Int32Array(64 * 64);
let _waterFrontierB = new Int32Array(64 * 64);
function getWaterFrontierBuffers(minSize: number): [Int32Array, Int32Array] {
  if (_waterFrontierA.length < minSize) {
    _waterFrontierA = new Int32Array(minSize);
    _waterFrontierB = new Int32Array(minSize);
  }
  return [_waterFrontierA, _waterFrontierB];
}
import {
  getWasmGreedyKernel,
  WASM_MASK_BYTE_OFFSET,
  WASM_QUADS_BYTE_OFFSET,
  WASM_MAX_MASK_CELLS,
  WASM_MAX_QUADS_PER_SLICE,
} from './wasmGreedyMesher.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type RotationAxis = 'yaw' | 'pitch' | 'roll';

export interface PlacedModuleData {
  kind: ModuleKind;
  vx: number;
  vy: number;
  vz: number;
  yawIdx: number;
  pitchIdx?: number;
  rollIdx?: number;
  config?: ModuleTuningConfig;
}

export interface HullSample {
  localPos: Vec3;
  dispKg: number;
}

export interface UnboundedVoxelSource {
  getVoxel: (vx: number, vy: number, vz: number) => number;
  forEachVoxel: (cb: (vx: number, vy: number, vz: number, mat: number) => void) => void;
}

export interface RigidBodySummary {
  totalMass: number;
  totalBuoyancy: number;
  voxelCount: number;
  comLocal: Vec3;
  cobLocal: Vec3;
  cotLocal: Vec3;
  inertia: Vec3; // Principal moments Ixx, Iyy, Izz around CoM
  hullSamples: HullSample[];
  collisionPoints: Vec3[]; // Outer hull boundary points in local meters
  engineCount: number;
  thrusterCount: number;
  propCount: number;
  wingCount: number;
  vtolCount: number;
  gyroCount: number;
  cannonCount: number;
  wheelCount: number;
  pistonCount: number;
  winchCount: number;
}

function getModulePhysicalSpecs(kind: ModuleKind): {
  mass: number;
  buoy: number;
  thrust: number;
  inertiaMass: number;
} {
  switch (kind) {
    // Original 12 modules (exact values preserved)
    case 'WHEEL_STEER':      return { mass: 38, buoy: 28, thrust: 35, inertiaMass: 38 };
    case 'WHEEL_DRIVE':      return { mass: 42, buoy: 28, thrust: 35, inertiaMass: 38 };
    case 'V8_ENGINE':        return { mass: 85, buoy: 20, thrust: 50, inertiaMass: 85 };
    case 'THRUSTER':         return { mass: 45, buoy: 20, thrust: 120, inertiaMass: 45 };
    case 'BOAT_PROP':        return { mass: 35, buoy: 45, thrust: 90, inertiaMass: 38 };
    case 'AERO_WING':        return { mass: 22, buoy: 65, thrust: 0, inertiaMass: 38 };
    case 'VTOL_ROTOR':       return { mass: 55, buoy: 75, thrust: 110, inertiaMass: 55 };
    case 'GYRO':             return { mass: 45, buoy: 20, thrust: 0, inertiaMass: 45 };
    case 'PLASMA_CANNON':    return { mass: 55, buoy: 18, thrust: 0, inertiaMass: 55 };
    case 'PISTON':           return { mass: 28, buoy: 16, thrust: 0, inertiaMass: 38 };
    case 'GRAPPLING_WINCH':  return { mass: 32, buoy: 18, thrust: 0, inertiaMass: 38 };
    case 'COCKPIT':          return { mass: 35, buoy: 25, thrust: 0, inertiaMass: 38 };
    // 1. Seats & Pilot Controls
    case 'SEAT_KART':        return { mass: 12, buoy: 18, thrust: 0, inertiaMass: 12 };
    case 'SEAT_MOTO':        return { mass: 18, buoy: 20, thrust: 0, inertiaMass: 18 };
    case 'SEAT_OPERATOR':    return { mass: 40, buoy: 25, thrust: 0, inertiaMass: 40 };
    case 'SEAT_ARMORED':     return { mass: 95, buoy: 22, thrust: 0, inertiaMass: 95 };
    case 'SEAT_DIVING':      return { mass: 110, buoy: 85, thrust: 0, inertiaMass: 110 };
    case 'SEAT_SPACE':       return { mass: 55, buoy: 40, thrust: 0, inertiaMass: 55 };
    case 'SEAT_SHIP_WHEEL':  return { mass: 30, buoy: 45, thrust: 0, inertiaMass: 30 };
    // 2. Propulsion & Engines
    case 'ENGINE_BULLDAWG':  return { mass: 55, buoy: 20, thrust: 35, inertiaMass: 55 };
    case 'ENGINE_DRAGON':    return { mass: 95, buoy: 20, thrust: 75, inertiaMass: 95 };
    case 'THRUSTER_MINI':    return { mass: 15, buoy: 12, thrust: 55, inertiaMass: 15 };
    case 'THRUSTER_ROCKET':  return { mass: 50, buoy: 18, thrust: 185, inertiaMass: 50 };
    case 'JET_RAW':          return { mass: 75, buoy: 22, thrust: 240, inertiaMass: 75 };
    case 'JET_GIMBAL':       return { mass: 48, buoy: 45, thrust: 130, inertiaMass: 48 };
    case 'PROP_AERO':        return { mass: 28, buoy: 35, thrust: 95, inertiaMass: 28 };
    case 'BOAT_OUTBOARD':    return { mass: 42, buoy: 55, thrust: 110, inertiaMass: 42 };
    // 3. Traction, Wheels & Sliders
    case 'WHEEL_RACING':     return { mass: 32, buoy: 22, thrust: 40, inertiaMass: 32 };
    case 'WHEEL_MONSTER':    return { mass: 68, buoy: 120, thrust: 45, inertiaMass: 68 };
    case 'WHEEL_KART':       return { mass: 16, buoy: 15, thrust: 25, inertiaMass: 16 };
    case 'WHEEL_DRAG':       return { mass: 48, buoy: 28, thrust: 65, inertiaMass: 48 };
    case 'WHEEL_SPIKED':     return { mass: 44, buoy: 26, thrust: 40, inertiaMass: 44 };
    case 'SKI_SLIDER':       return { mass: 18, buoy: 35, thrust: 0, inertiaMass: 18 };
    // 4. Mechanical, Articulation Joints & Gyros
    case 'SUSPENSION':       return { mass: 24, buoy: 14, thrust: 0, inertiaMass: 24 };
    case 'STEERING_HINGE':   return { mass: 22, buoy: 14, thrust: 0, inertiaMass: 22 };
    case 'GYRO_REACTION':    return { mass: 38, buoy: 20, thrust: 0, inertiaMass: 38 };
    case 'HINGE_LARGE':      return { mass: 36, buoy: 16, thrust: 0, inertiaMass: 36 };
    case 'HINGE_TRAILER':    return { mass: 20, buoy: 12, thrust: 0, inertiaMass: 20 };
    case 'SERVO_SPIN':       return { mass: 28, buoy: 16, thrust: 0, inertiaMass: 28 };
    case 'SERVO_SMALL':      return { mass: 14, buoy: 10, thrust: 0, inertiaMass: 14 };
    case 'JOINT_MECH':       return { mass: 18, buoy: 12, thrust: 0, inertiaMass: 18 };
    case 'DETACHABLE_BLOCK': return { mass: 15, buoy: 10, thrust: 0, inertiaMass: 15 };
    // 5. Aerodynamics, Lift & Drag
    case 'WING_STANDARD':    return { mass: 26, buoy: 80, thrust: 0, inertiaMass: 26 };
    case 'SPOILER':          return { mass: 18, buoy: 12, thrust: 0, inertiaMass: 18 };
    case 'TAILFIN':          return { mass: 16, buoy: 30, thrust: 0, inertiaMass: 16 };
    case 'TAILFIN_POWERED':  return { mass: 20, buoy: 35, thrust: 0, inertiaMass: 20 };
    case 'AERO_BLADE':       return { mass: 14, buoy: 25, thrust: 0, inertiaMass: 14 };
    // 6. Balance & Nautical Buoyancy
    case 'WEIGHT_BLOCK':     return { mass: 120, buoy: 5, thrust: 0, inertiaMass: 120 };
    case 'PONTOON_LARGE':    return { mass: 12, buoy: 180, thrust: 0, inertiaMass: 12 };
    case 'BCD_TANK':         return { mass: 35, buoy: 95, thrust: 0, inertiaMass: 35 };
    // 7. Gadgets, Sensors & Automation Logic
    case 'SENSOR_DISTANCE':
    case 'SENSOR_SPEED':
    case 'SENSOR_ALTIMETER':
    case 'SENSOR_ANGLE':
    case 'SENSOR_POSITION':
    case 'LOGIC_GATE':       return { mass: 10, buoy: 10, thrust: 0, inertiaMass: 10 };
    case 'RADIO_TRX':        return { mass: 12, buoy: 10, thrust: 0, inertiaMass: 12 };
    case 'HEADLIGHT':        return { mass: 8,  buoy: 8,  thrust: 0, inertiaMass: 8 };
    // 8. Weapons & Combat Utilities
    case 'WEAPON_MINIGUN':   return { mass: 38, buoy: 15, thrust: 0, inertiaMass: 38 };
    case 'WEAPON_ROCKET':    return { mass: 48, buoy: 18, thrust: 0, inertiaMass: 48 };
    case 'WEAPON_BOMB_BAY':  return { mass: 42, buoy: 15, thrust: 0, inertiaMass: 42 };
    case 'WEAPON_MELEE':     return { mass: 25, buoy: 15, thrust: 0, inertiaMass: 25 };
    // 9. Tactical & Heavy Utility Modules (101 - 107)
    case 'TURRET_RING':        return { mass: 34, buoy: 16, thrust: 0, inertiaMass: 34 };
    case 'MAGNET_COUPLER':     return { mass: 40, buoy: 18, thrust: 0, inertiaMass: 40 };
    case 'TANK_TREAD':         return { mass: 74, buoy: 34, thrust: 55, inertiaMass: 74 };
    case 'PARACHUTE_AIRBRAKE': return { mass: 18, buoy: 45, thrust: 0, inertiaMass: 18 };
    case 'OUTRIGGER_JACK':     return { mass: 46, buoy: 14, thrust: 0, inertiaMass: 46 };
    case 'IMPULSE_BUMPER':     return { mass: 36, buoy: 22, thrust: 0, inertiaMass: 36 };
    case 'SMOKE_FLARE':        return { mass: 16, buoy: 14, thrust: 0, inertiaMass: 16 };
    default:                 return { mass: 30, buoy: 20, thrust: 0, inertiaMass: 30 };
  }
}

/**
 * Pure check for whether a ModuleKind is a pilot seat / cockpit module.
 */
export function isSeatModuleKind(kind: ModuleKind): boolean {
  return (
    kind === 'COCKPIT' ||
    kind === 'SEAT_KART' ||
    kind === 'SEAT_MOTO' ||
    kind === 'SEAT_OPERATOR' ||
    kind === 'SEAT_ARMORED' ||
    kind === 'SEAT_DIVING' ||
    kind === 'SEAT_SPACE' ||
    kind === 'SEAT_SHIP_WHEEL'
  );
}

/**
 * Pure check for whether a vehicle rig still has at least one intact (unbroken) seat module
 * that a player can sit in and drive from.
 */
export function hasIntactSeatModule(
  modules: ReadonlyArray<{ kind: ModuleKind; health?: number }>,
): boolean {
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    if (isSeatModuleKind(m.kind) && (m.health ?? 1.0) > 0.05) {
      return true;
    }
  }
  return false;
}

/**
 * Computes exact rigid-body mass, Center of Mass (CoM), Center of Buoyancy/Lift (CoB),
 * Center of Thrust (CoT), and true 3D principal moments of inertia (Ixx, Iyy, Izz)
 * via the Parallel Axis Theorem across unbounded chassis micro-voxels and functional modules.
 * Automatically downsamples collision & buoyancy points so 4-substep physics runs at 120+ FPS
 * regardless of how massive a vehicle is!
 */
export function computeRigidBodyProperties(
  voxelInput: Uint8Array | UnboundedVoxelSource,
  modules: PlacedModuleData[],
): RigidBodySummary {
  let mass = 0;
  let buoy = 0;
  let thrustWeight = 0;
  let voxelCount = 0;

  let sumMX = 0, sumMY = 0, sumMZ = 0;
  let sumBX = 0, sumBY = 0, sumBZ = 0;
  let sumTX = 0, sumTY = 0, sumTZ = 0;

  const rawHullSamples: HullSample[] = [];
  const rawCollisionPoints: Vec3[] = [];
  const activeVoxels: Array<{ vx: number; vy: number; vz: number; mat: number }> = [];

  let getVox: (vx: number, vy: number, vz: number) => number;

  if (voxelInput instanceof Uint8Array) {
    getVox = (vx: number, vy: number, vz: number): number => {
      if (
        vx < 0 ||
        vx >= VEH_DIM_X ||
        vy < 0 ||
        vy >= VEH_DIM_Y ||
        vz < 0 ||
        vz >= VEH_DIM_Z
      ) {
        return MAT.AIR;
      }
      return voxelInput[vx + VEH_DIM_X * (vy + VEH_DIM_Y * vz)];
    };
    for (let vz = 0; vz < VEH_DIM_Z; vz++) {
      for (let vy = 0; vy < VEH_DIM_Y; vy++) {
        for (let vx = 0; vx < VEH_DIM_X; vx++) {
          const mat = getVox(vx, vy, vz);
          if (mat !== MAT.AIR) {
            activeVoxels.push({ vx, vy, vz, mat });
          }
        }
      }
    }
  } else {
    getVox = voxelInput.getVoxel;
    voxelInput.forEachVoxel((vx, vy, vz, mat) => {
      if (mat !== MAT.AIR) {
        activeVoxels.push({ vx, vy, vz, mat });
      }
    });
  }

  // Group into 2x2x2 spatial clusters using a string/numeric hash so unbounded coordinates work seamlessly
  const clusterMap = new Map<
    string,
    { cx: number; cy: number; cz: number; buoy: number; isSurface: boolean }
  >();

  for (let i = 0; i < activeVoxels.length; i++) {
    const { vx, vy, vz, mat } = activeVoxels[i];
    voxelCount++;
    const info = MAT_INFO[mat] || MAT_INFO[MAT.ALLOY_BLUE];
    mass += info.mass;
    buoy += info.buoy;

    const px = (vx + 0.5) * VOXEL_SIZE;
    const py = (vy + 0.5) * VOXEL_SIZE;
    const pz = (vz + 0.5) * VOXEL_SIZE;

    sumMX += px * info.mass;
    sumMY += py * info.mass;
    sumMZ += pz * info.mass;

    sumBX += px * info.buoy;
    sumBY += py * info.buoy;
    sumBZ += pz * info.buoy;

    const cx = Math.floor(vx / 2) * 2;
    const cy = Math.floor(vy / 2) * 2;
    const cz = Math.floor(vz / 2) * 2;
    const key = `${cx},${cy},${cz}`;
    let cluster = clusterMap.get(key);
    if (!cluster) {
      cluster = { cx, cy, cz, buoy: 0, isSurface: false };
      clusterMap.set(key, cluster);
    }
    cluster.buoy += info.buoy;

    if (
      !cluster.isSurface &&
      (getVox(vx - 1, vy, vz) === MAT.AIR ||
        getVox(vx + 1, vy, vz) === MAT.AIR ||
        getVox(vx, vy - 1, vz) === MAT.AIR ||
        getVox(vx, vy + 1, vz) === MAT.AIR ||
        getVox(vx, vy, vz - 1) === MAT.AIR ||
        getVox(vx, vy, vz + 1) === MAT.AIR)
    ) {
      cluster.isSurface = true;
    }
  }

  clusterMap.forEach((c) => {
    const clusterCenter = {
      x: (c.cx + 1) * VOXEL_SIZE,
      y: (c.cy + 1) * VOXEL_SIZE,
      z: (c.cz + 1) * VOXEL_SIZE,
    };
    rawHullSamples.push({
      localPos: clusterCenter,
      dispKg: c.buoy,
    });
    if (c.isSurface) {
      rawCollisionPoints.push(clusterCenter);
    }
  });

  // Downsample hullSamples and collisionPoints to bounded counts for ultra-fast O(1) substep physics!
  const MAX_HULL_SAMPLES = 56;
  let hullSamples: HullSample[] = rawHullSamples;
  if (rawHullSamples.length > MAX_HULL_SAMPLES) {
    hullSamples = [];
    const scaleFactor = rawHullSamples.length / MAX_HULL_SAMPLES;
    for (let i = 0; i < MAX_HULL_SAMPLES; i++) {
      const src = rawHullSamples[Math.floor(i * scaleFactor)];
      hullSamples.push({
        localPos: src.localPos,
        dispKg: src.dispKg * scaleFactor,
      });
    }
  }

  const MAX_COLLISION_PTS = 48;
  const collisionPoints: Vec3[] = [];
  if (rawCollisionPoints.length <= MAX_COLLISION_PTS) {
    collisionPoints.push(...rawCollisionPoints);
  } else {
    const step = rawCollisionPoints.length / MAX_COLLISION_PTS;
    for (let i = 0; i < MAX_COLLISION_PTS; i++) {
      collisionPoints.push(rawCollisionPoints[Math.floor(i * step)]);
    }
  }

  let engineCount = 0;
  let thrusterCount = 0;
  let propCount = 0;
  let wingCount = 0;
  let vtolCount = 0;
  let gyroCount = 0;
  let cannonCount = 0;
  let wheelCount = 0;
  let pistonCount = 0;
  let winchCount = 0;

  for (const mod of modules) {
    const spec = getModulePhysicalSpecs(mod.kind);
    const m = spec.mass;
    const b = spec.buoy;
    const t = spec.thrust;

    if (
      mod.kind === 'WHEEL_STEER' ||
      mod.kind === 'WHEEL_DRIVE' ||
      mod.kind === 'WHEEL_RACING' ||
      mod.kind === 'WHEEL_MONSTER' ||
      mod.kind === 'WHEEL_KART' ||
      mod.kind === 'WHEEL_DRAG' ||
      mod.kind === 'WHEEL_SPIKED' ||
      mod.kind === 'TANK_TREAD' ||
      mod.kind === 'SKI_SLIDER'
    ) {
      wheelCount++;
    } else if (
      mod.kind === 'V8_ENGINE' ||
      mod.kind === 'ENGINE_BULLDAWG' ||
      mod.kind === 'ENGINE_DRAGON'
    ) {
      engineCount++;
    } else if (
      mod.kind === 'THRUSTER' ||
      mod.kind === 'THRUSTER_MINI' ||
      mod.kind === 'THRUSTER_ROCKET' ||
      mod.kind === 'JET_RAW' ||
      mod.kind === 'JET_GIMBAL'
    ) {
      thrusterCount++;
    } else if (
      mod.kind === 'BOAT_PROP' ||
      mod.kind === 'BOAT_OUTBOARD' ||
      mod.kind === 'PROP_AERO'
    ) {
      propCount++;
    } else if (
      mod.kind === 'AERO_WING' ||
      mod.kind === 'WING_STANDARD' ||
      mod.kind === 'SPOILER' ||
      mod.kind === 'TAILFIN' ||
      mod.kind === 'TAILFIN_POWERED' ||
      mod.kind === 'AERO_BLADE'
    ) {
      wingCount++;
    } else if (mod.kind === 'VTOL_ROTOR') {
      vtolCount++;
    } else if (mod.kind === 'GYRO' || mod.kind === 'GYRO_REACTION') {
      gyroCount++;
    } else if (
      mod.kind === 'PLASMA_CANNON' ||
      mod.kind === 'WEAPON_MINIGUN' ||
      mod.kind === 'WEAPON_ROCKET' ||
      mod.kind === 'WEAPON_BOMB_BAY' ||
      mod.kind === 'WEAPON_MELEE'
    ) {
      cannonCount++;
    } else if (mod.kind === 'PISTON') {
      pistonCount++;
    } else if (mod.kind === 'GRAPPLING_WINCH') {
      winchCount++;
    }

    const px = (mod.vx + 0.5) * VOXEL_SIZE;
    const py = (mod.vy + 0.5) * VOXEL_SIZE;
    const pz = (mod.vz + 0.5) * VOXEL_SIZE;

    mass += m;
    buoy += b;
    sumMX += px * m;
    sumMY += py * m;
    sumMZ += pz * m;

    sumBX += px * b;
    sumBY += py * b;
    sumBZ += pz * b;

    if (t > 0) {
      thrustWeight += t;
      sumTX += px * t;
      sumTY += py * t;
      sumTZ += pz * t;
    }

    // Add large pontoon/BCD/weight blocks directly to hull buoyancy samples so water displacement is accurate!
    if (b >= 60) {
      hullSamples.push({
        localPos: { x: px, y: py, z: pz },
        dispKg: b * 2.2,
      });
    }

    collisionPoints.push({ x: px, y: py, z: pz });
  }

  const comLocal: Vec3 =
    mass > 0
      ? { x: sumMX / mass, y: sumMY / mass, z: sumMZ / mass }
      : { x: 3.0, y: 1.5, z: 4.5 };

  const cobLocal: Vec3 =
    buoy > 0
      ? { x: sumBX / buoy, y: sumBY / buoy, z: sumBZ / buoy }
      : { ...comLocal };

  const cotLocal: Vec3 =
    thrustWeight > 0
      ? { x: sumTX / thrustWeight, y: sumTY / thrustWeight, z: sumTZ / thrustWeight }
      : { ...comLocal };

  // Second pass: Exact Principal Moments of Inertia (Ixx, Iyy, Izz) about CoM
  let ixx = 0;
  let iyy = 0;
  let izz = 0;
  const voxSelfInertia = (VOXEL_SIZE * VOXEL_SIZE) / 6.0; // 1/6 * s^2 for a cube

  for (let i = 0; i < activeVoxels.length; i++) {
    const { vx, vy, vz, mat } = activeVoxels[i];
    const info = MAT_INFO[mat] || MAT_INFO[MAT.ALLOY_BLUE];
    const m = info.mass;
    const rx = (vx + 0.5) * VOXEL_SIZE - comLocal.x;
    const ry = (vy + 0.5) * VOXEL_SIZE - comLocal.y;
    const rz = (vz + 0.5) * VOXEL_SIZE - comLocal.z;

    ixx += m * (ry * ry + rz * rz + voxSelfInertia);
    iyy += m * (rx * rx + rz * rz + voxSelfInertia);
    izz += m * (rx * rx + ry * ry + voxSelfInertia);
  }

  for (const mod of modules) {
    const m = getModulePhysicalSpecs(mod.kind).inertiaMass;

    const rx = (mod.vx + 0.5) * VOXEL_SIZE - comLocal.x;
    const ry = (mod.vy + 0.5) * VOXEL_SIZE - comLocal.y;
    const rz = (mod.vz + 0.5) * VOXEL_SIZE - comLocal.z;
    const modSelfInertia = 0.08;

    ixx += m * (ry * ry + rz * rz + modSelfInertia);
    iyy += m * (rx * rx + rz * rz + modSelfInertia);
    izz += m * (rx * rx + ry * ry + modSelfInertia);
  }

  const minInertia = Math.max(12.0, mass * 0.25);

  return {
    totalMass: Math.max(25, mass),
    totalBuoyancy: Math.max(25, buoy),
    voxelCount,
    comLocal,
    cobLocal,
    cotLocal,
    inertia: {
      x: Math.max(minInertia, ixx),
      y: Math.max(minInertia, iyy),
      z: Math.max(minInertia, izz),
    },
    hullSamples,
    collisionPoints,
    engineCount,
    thrusterCount,
    propCount,
    wingCount,
    vtolCount,
    gyroCount,
    cannonCount,
    wheelCount,
    pistonCount,
    winchCount,
  };
}

/**
 * Computes all target micro-voxel coordinates (vx, vy, vz) for the active Build Placement Mode
 * (1x1 Single, Line Drag, 6-Block Beam, 3x3 Plate, 5x5 Deck Plate, or Continuous Paint)
 * including optional X-axis symmetry mirroring!
 */
export function computePlacementVoxelCoords(
  mode: BuildPlacementMode,
  hit: { vx: number; vy: number; vz: number; normal: Vec3 },
  dragStartVoxel: { vx: number; vy: number; vz: number } | null,
  mirrorMode: boolean,
  isErase = false,
  yawIdx = 0,
  pitchIdx = 0,
  rollIdx = 0,
): Array<{ vx: number; vy: number; vz: number }> {
  const baseCoords: Array<{ vx: number; vy: number; vz: number }> = [];

  // For placement, start at the adjacent air cell (hit + normal); for erasing or PAINT_TOOL, start at the hit block itself
  const useTargetBlock = isErase || mode === 'PAINT_TOOL';
  const targetX = useTargetBlock ? hit.vx : hit.vx + hit.normal.x;
  const targetY = useTargetBlock ? hit.vy : hit.vy + hit.normal.y;
  const targetZ = useTargetBlock ? hit.vz : hit.vz + hit.normal.z;

  if (mode === 'BOX_FILL' && dragStartVoxel && !isErase) {
    // 3D / 2D Rectangular Box Fill between dragStartVoxel and (targetX, targetY, targetZ)
    // Works in any direction: up, down, left, right, forward, backward!
    const maxSpan = 20;
    const dx = Math.max(-maxSpan, Math.min(maxSpan, targetX - dragStartVoxel.vx));
    const dy = Math.max(-maxSpan, Math.min(maxSpan, targetY - dragStartVoxel.vy));
    const dz = Math.max(-maxSpan, Math.min(maxSpan, targetZ - dragStartVoxel.vz));

    const minX = Math.min(dragStartVoxel.vx, dragStartVoxel.vx + dx);
    const maxX = Math.max(dragStartVoxel.vx, dragStartVoxel.vx + dx);
    const minY = Math.min(dragStartVoxel.vy, dragStartVoxel.vy + dy);
    const maxY = Math.max(dragStartVoxel.vy, dragStartVoxel.vy + dy);
    const minZ = Math.min(dragStartVoxel.vz, dragStartVoxel.vz + dz);
    const maxZ = Math.max(dragStartVoxel.vz, dragStartVoxel.vz + dz);

    for (let vz = minZ; vz <= maxZ; vz++) {
      for (let vy = minY; vy <= maxY; vy++) {
        for (let vx = minX; vx <= maxX; vx++) {
          baseCoords.push({ vx, vy, vz });
          if (baseCoords.length >= 1200) break;
        }
        if (baseCoords.length >= 1200) break;
      }
      if (baseCoords.length >= 1200) break;
    }
  } else if (mode === 'LINE_DRAG' && dragStartVoxel && !isErase) {
    // 3D Bresenham line between dragStartVoxel and (targetX, targetY, targetZ)
    const x0 = dragStartVoxel.vx;
    const y0 = dragStartVoxel.vy;
    const z0 = dragStartVoxel.vz;
    const dx = targetX - x0;
    const dy = targetY - y0;
    const dz = targetZ - z0;
    const steps = Math.min(48, Math.max(1, Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      baseCoords.push({
        vx: Math.round(x0 + dx * t),
        vy: Math.round(y0 + dy * t),
        vz: Math.round(z0 + dz * t),
      });
    }
  } else if (mode === 'BEAM_6' && !isErase) {
    // Extrude a 6-block structural beam along the surface normal, rotated by (yawIdx, pitchIdx, rollIdx)
    const nx = hit.normal.x || 0;
    const ny = hit.normal.y || 0;
    const nz = hit.normal.z || (nx === 0 && ny === 0 ? 1 : 0);
    for (let i = 0; i < 6; i++) {
      let off = rotatePoint3D90(nx * i, ny * i, nz * i, 'yaw', yawIdx);
      off = rotatePoint3D90(off.x, off.y, off.z, 'pitch', pitchIdx);
      off = rotatePoint3D90(off.x, off.y, off.z, 'roll', rollIdx);
      baseCoords.push({
        vx: targetX + off.x,
        vy: targetY + off.y,
        vz: targetZ + off.z,
      });
    }
  } else if (mode === 'PLATE_3X3' || mode === 'PLATE_5X5') {
    const r = mode === 'PLATE_5X5' ? 2 : 1;
    // Orient the plate perpendicular to the clicked face normal, then apply 3-axis (yaw, pitch, roll) rotation!
    const absX = Math.abs(hit.normal.x);
    const absY = Math.abs(hit.normal.y);
    const absZ = Math.abs(hit.normal.z);

    for (let u = -r; u <= r; u++) {
      for (let v = -r; v <= r; v++) {
        let ox = u, oy = 0, oz = v;
        if (absX > 0.5) {
          ox = 0; oy = u; oz = v;
        } else if (absZ > 0.5) {
          ox = u; oy = v; oz = 0;
        } else if (absY > 0.5) {
          ox = u; oy = 0; oz = v;
        }
        let off = rotatePoint3D90(ox, oy, oz, 'yaw', yawIdx);
        off = rotatePoint3D90(off.x, off.y, off.z, 'pitch', pitchIdx);
        off = rotatePoint3D90(off.x, off.y, off.z, 'roll', rollIdx);
        baseCoords.push({
          vx: targetX + off.x,
          vy: targetY + off.y,
          vz: targetZ + off.z,
        });
      }
    }
  } else {
    // SINGLE or PAINT (or BOX_FILL / LINE_DRAG before drag starts)
    baseCoords.push({ vx: targetX, vy: targetY, vz: targetZ });
  }

  if (!mirrorMode) {
    return baseCoords;
  }

  const seen = new Set<string>();
  const finalCoords: Array<{ vx: number; vy: number; vz: number }> = [];
  const mirrorAxis2X = SYMMETRY_CENTER_X * 2 - 1; // 23

  for (const pt of baseCoords) {
    const k1 = `${pt.vx},${pt.vy},${pt.vz}`;
    if (!seen.has(k1)) {
      seen.add(k1);
      finalCoords.push(pt);
    }
    const mx = mirrorAxis2X - pt.vx;
    const k2 = `${mx},${pt.vy},${pt.vz}`;
    if (!seen.has(k2)) {
      seen.add(k2);
      finalCoords.push({ vx: mx, vy: pt.vy, vz: pt.vz });
    }
  }

  return finalCoords;
}

/**
 * Computes true Ackermann steering geometry for left & right front wheels
 * so the inside wheel turns at a sharper angle than the outside wheel without scrubbing.
 */
export function computeAckermannAngles(
  centerSteerRad: number,
  wheelbaseMeters = 3.6,
  trackWidthMeters = 3.0,
): { leftSteerRad: number; rightSteerRad: number } {
  if (Math.abs(centerSteerRad) < 1e-4) {
    return { leftSteerRad: 0, rightSteerRad: 0 };
  }
  const tanCenter = Math.tan(Math.abs(centerSteerRad));
  const turnRadius = wheelbaseMeters / tanCenter;
  const halfTrack = trackWidthMeters * 0.5;

  const innerAngle = Math.atan(wheelbaseMeters / Math.max(0.4, turnRadius - halfTrack));
  const outerAngle = Math.atan(wheelbaseMeters / (turnRadius + halfTrack));

  if (centerSteerRad > 0) {
    return { leftSteerRad: innerAngle, rightSteerRad: outerAngle };
  } else {
    return { leftSteerRad: -outerAngle, rightSteerRad: -innerAngle };
  }
}

export interface TireStepInput {
  compression: number;     // Current spring compression (m)
  restLen: number;         // Suspension rest length (m)
  kSpring: number;         // Spring stiffness (N/m)
  cDamperBump: number;     // Compression damping (N*s/m)
  cDamperRebound: number;  // Rebound damping (N*s/m) - higher than bump
  relVelY: number;         // Vertical contact velocity along suspension up axis (m/s)
  vLong: number;           // Forward velocity along wheel heading (m/s)
  vLat: number;            // Lateral slip velocity along wheel right axis (m/s)
  throttle: number;        // -1 .. +1
  brake: boolean;
  isPowered: boolean;
  engineForcePerWheel: number;
  topSpeedMPS: number;
  surfaceMu: number;       // Material friction coefficient (e.g., 1.25 asphalt, 0.72 sand)
  wheelLoadCap: number;    // Max normal force cap
  forwardTraction?: number; // Custom forward traction multiplier (default 1.0)
  sidewaysTraction?: number; // Custom sideways/lateral traction multiplier (default 1.0)
}

export interface TireStepOutput {
  normalLoad: number; // Upward suspension normal force (N)
  fLong: number;      // Longitudinal tractive/braking force (N)
  fLat: number;       // Lateral cornering force (N)
  slipRatio: number;  // Combined friction circle utilization (0..1+)
}

export function computeWheelTractionMultipliers(config?: {
  forwardTraction?: number;
  sidewaysTraction?: number;
}): { forwardTraction: number; sidewaysTraction: number } {
  const fwdRaw = config?.forwardTraction;
  const latRaw = config?.sidewaysTraction;
  const forwardTraction =
    typeof fwdRaw === 'number' && Number.isFinite(fwdRaw)
      ? Math.max(0.1, Math.min(3.0, fwdRaw))
      : 1.0;
  const sidewaysTraction =
    typeof latRaw === 'number' && Number.isFinite(latRaw)
      ? Math.max(0.1, Math.min(3.0, latRaw))
      : 1.0;
  return { forwardTraction, sidewaysTraction };
}

/**
 * Progressive suspension spring with asymmetric bump/rebound damping
 * and a Pacejka-inspired combined-slip Coulomb friction circle / ellipse:
 * sqrt((fLong / maxFrictionFwd)^2 + (fLat / maxFrictionLat)^2) <= 1.0
 */
export function solveTireForces(
  input: TireStepInput,
  out?: TireStepOutput,
): TireStepOutput {
  const {
    compression,
    restLen,
    kSpring,
    cDamperBump,
    cDamperRebound,
    relVelY,
    vLong,
    vLat,
    throttle,
    brake,
    isPowered,
    engineForcePerWheel,
    topSpeedMPS,
    surfaceMu,
    wheelLoadCap,
    forwardTraction,
    sidewaysTraction,
  } = input;

  if (compression <= 0) {
    if (out) {
      out.normalLoad = 0;
      out.fLong = 0;
      out.fLat = 0;
      out.slipRatio = 0;
      return out;
    }
    return { normalLoad: 0, fLong: 0, fLat: 0, slipRatio: 0 };
  }

  const progRatio = compression / Math.max(0.1, restLen);
  const progressiveMult = 1.0 + 0.45 * progRatio * progRatio;
  const fSpring = compression * kSpring * progressiveMult;

  const damperCoeff = relVelY < 0 ? cDamperBump : cDamperRebound;
  const fDamper = -relVelY * damperCoeff;

  const normalLoad = Math.max(0, Math.min(wheelLoadCap, fSpring + fDamper));
  if (normalLoad <= 0) {
    if (out) {
      out.normalLoad = 0;
      out.fLong = 0;
      out.fLat = 0;
      out.slipRatio = 0;
      return out;
    }
    return { normalLoad: 0, fLong: 0, fLat: 0, slipRatio: 0 };
  }

  const fwdMult =
    typeof forwardTraction === 'number' && Number.isFinite(forwardTraction)
      ? Math.max(0.1, Math.min(3.0, forwardTraction))
      : 1.0;
  const latMult =
    typeof sidewaysTraction === 'number' && Number.isFinite(sidewaysTraction)
      ? Math.max(0.1, Math.min(3.0, sidewaysTraction))
      : 1.0;

  const muFwdEffective = surfaceMu * fwdMult;
  const muLatEffective = surfaceMu * latMult;
  const maxFrictionFwd = muFwdEffective * normalLoad;
  const maxFrictionLat = muLatEffective * normalLoad;

  let rawFLong = 0;
  if (brake) {
    rawFLong = -vLong * normalLoad * 0.72 * fwdMult;
  } else if (throttle !== 0 && isPowered) {
    const speedRatio = Math.min(1.0, Math.abs(vLong) / Math.max(5.0, topSpeedMPS));
    const torqueCurve =
      throttle * vLong >= 0 ? Math.max(0.18, 1.0 - speedRatio * 0.8) : 1.15;
    rawFLong = throttle * engineForcePerWheel * torqueCurve * fwdMult;
    const maxDriveLong = maxFrictionFwd * 1.25;
    if (Math.abs(rawFLong) > maxDriveLong) {
      rawFLong = Math.sign(rawFLong) * maxDriveLong;
    }
  } else {
    // BUG 3: Zero engine force when throttle === 0, and increased forward rolling friction
    // so coasting vehicles decelerate to a complete stop instead of maintaining speed
    const rollingCoeff = Math.abs(vLong) < 2.0 ? 0.24 : 0.14;
    const coulombRolling =
      Math.abs(vLong) > 1e-4
        ? -Math.sign(vLong) * Math.min(Math.abs(vLong) * normalLoad * 0.45, normalLoad * 0.06)
        : 0;
    rawFLong = -vLong * normalLoad * rollingCoeff + coulombRolling;
  }

  // Pacejka-inspired lateral tire cornering force
  const slipAngleApprox = Math.atan2(vLat, Math.max(0.85, Math.abs(vLong)));
  const corneringStiffness = normalLoad * 7.5 * muLatEffective;
  const peakCornering = Math.sin(
    1.52 * Math.atan(2.8 * Math.max(-0.95, Math.min(0.95, slipAngleApprox))),
  );
  const directLatDamp =
    -Math.sign(vLat) *
    Math.min(maxFrictionLat, Math.abs(vLat) * normalLoad * 1.8 * muLatEffective);
  const highSpeedCornering =
    -peakCornering * corneringStiffness * 0.95 + directLatDamp * 0.45;
  const rawFLat = Math.max(
    -maxFrictionLat,
    Math.min(maxFrictionLat, Math.abs(vLong) > 1.2 ? highSpeedCornering : directLatDamp),
  );

  // Proportional Coulomb friction circle / anisotropic ellipse:
  // When fwdMult === 1 && latMult === 1, maxFrictionFwd === maxFrictionLat === surfaceMu * normalLoad.
  let fLong = rawFLong;
  let fLat = rawFLat;
  let slipRatio = 0;

  if (fwdMult === 1.0 && latMult === 1.0) {
    const maxFriction = maxFrictionFwd;
    const combinedDemand = Math.hypot(rawFLong, rawFLat);
    if (combinedDemand > maxFriction) {
      const frictionScale = maxFriction / combinedDemand;
      fLong = rawFLong * frictionScale;
      fLat = rawFLat * frictionScale;
    }
    const combinedMag = Math.hypot(fLong, fLat);
    slipRatio = maxFriction > 1e-3 ? combinedMag / maxFriction : 0;
  } else {
    const normLong = maxFrictionFwd > 1e-3 ? rawFLong / maxFrictionFwd : 0;
    const normLat = maxFrictionLat > 1e-3 ? rawFLat / maxFrictionLat : 0;
    const ellipseDemand = Math.hypot(normLong, normLat);
    if (ellipseDemand > 1.0) {
      fLong = rawFLong / ellipseDemand;
      fLat = rawFLat / ellipseDemand;
    }
    const usedLong = maxFrictionFwd > 1e-3 ? fLong / maxFrictionFwd : 0;
    const usedLat = maxFrictionLat > 1e-3 ? fLat / maxFrictionLat : 0;
    slipRatio = Math.hypot(usedLong, usedLat);
  }

  if (out) {
    out.normalLoad = normalLoad;
    out.fLong = fLong;
    out.fLat = fLat;
    out.slipRatio = slipRatio;
    return out;
  }
  return {
    normalLoad,
    fLong,
    fLat,
    slipRatio,
  };
}

/**
 * Computes stall-aware airfoil lift and induced drag for Modular Aero Wings.
 */
export function computeWingAerodynamics(
  forwardSpeedMPS: number,
  verticalSpeedMPS: number,
  pitchInput: number,
  wingAreaM2 = 2.8,
): { liftForce: number; dragForce: number; angleOfAttackRad: number; isStalled: boolean } {
  const airspeedSq = forwardSpeedMPS * forwardSpeedMPS + verticalSpeedMPS * verticalSpeedMPS;
  if (airspeedSq < 0.25) {
    return { liftForce: 0, dragForce: 0, angleOfAttackRad: 0, isStalled: false };
  }

  const flowAoA = Math.atan2(-verticalSpeedMPS, Math.max(0.5, Math.abs(forwardSpeedMPS)));
  const effectiveAoA = flowAoA + pitchInput * 0.22 + 0.06;

  const stallAngle = 0.31;
  const isStalled = Math.abs(effectiveAoA) > stallAngle;

  let cL = 0;
  if (!isStalled) {
    cL = 4.8 * effectiveAoA;
  } else {
    const over = Math.abs(effectiveAoA) - stallAngle;
    const postStall = Math.max(0.15, 1.48 - over * 2.4);
    cL = Math.sign(effectiveAoA) * postStall;
  }

  const rho = 1.225;
  const dynamicPressure = 0.5 * rho * airspeedSq;

  const liftForce = dynamicPressure * wingAreaM2 * cL * 18.0;
  const cD = 0.04 + (cL * cL) / (Math.PI * 5.2 * 0.8) + (isStalled ? 0.35 : 0);
  const dragForce =
    -Math.sign(forwardSpeedMPS || 1) * dynamicPressure * wingAreaM2 * cD * 6.0;

  return {
    liftForce,
    dragForce,
    angleOfAttackRad: effectiveAoA,
    isStalled,
  };
}

/**
 * Resolves 3D Rigid-Body Collision Impulse j along contact normal n with Coulomb friction
 * and determines whether the impact kinetic energy exceeds the voxel material's yield threshold.
 */
export function computeCollisionImpulse(
  contactVel: Vec3,
  normal: Vec3,
  rVec: Vec3,
  mass: number,
  inertia: Vec3,
  restitution: number,
  friction: number,
  yieldEnergyJoules: number,
): {
  impulse: Vec3;
  impactEnergy: number;
  shattersVoxel: boolean;
} {
  const vn = contactVel.x * normal.x + contactVel.y * normal.y + contactVel.z * normal.z;
  if (vn >= 0) {
    return { impulse: { x: 0, y: 0, z: 0 }, impactEnergy: 0, shattersVoxel: false };
  }

  const rxnX = rVec.y * normal.z - rVec.z * normal.y;
  const rxnY = rVec.z * normal.x - rVec.x * normal.z;
  const rxnZ = rVec.x * normal.y - rVec.y * normal.x;

  const angTerm =
    (rxnX * rxnX) / Math.max(1, inertia.x) +
    (rxnY * rxnY) / Math.max(1, inertia.y) +
    (rxnZ * rxnZ) / Math.max(1, inertia.z);

  const invEffMass = 1 / Math.max(1, mass) + angTerm;
  const effMass = 1 / invEffMass;

  const impactEnergy = 0.5 * effMass * vn * vn;
  const shattersVoxel = impactEnergy >= yieldEnergyJoules;

  const effectiveRestitution = shattersVoxel ? 0.02 : restitution;
  const jn =
    (-(1 + effectiveRestitution) * vn) / invEffMass * (shattersVoxel ? 0.32 : 1.0);

  const vtX = contactVel.x - vn * normal.x;
  const vtY = contactVel.y - vn * normal.y;
  const vtZ = contactVel.z - vn * normal.z;
  const vtMag = Math.hypot(vtX, vtY, vtZ);

  let jtX = 0, jtY = 0, jtZ = 0;
  if (vtMag > 1e-4) {
    const maxJt = friction * jn;
    const rawJt = Math.min(maxJt, (vtMag / invEffMass) * 0.45);
    jtX = (-vtX / vtMag) * rawJt;
    jtY = (-vtY / vtMag) * rawJt;
    jtZ = (-vtZ / vtMag) * rawJt;
  }

  return {
    impulse: {
      x: normal.x * jn + jtX,
      y: normal.y * jn + jtY,
      z: normal.z * jn + jtZ,
    },
    impactEnergy,
    shattersVoxel,
  };
}

/**
 * Computes all relative (dx, dy, dz) voxel offsets inside a spherical blast/crash crater of radiusVoxels.
 */
export function computeSphericalCraterOffsets(
  radiusVoxels: number,
): Array<{ dx: number; dy: number; dz: number; distSq: number }> {
  const offsets: Array<{ dx: number; dy: number; dz: number; distSq: number }> = [];
  const r = Math.max(1, Math.floor(radiusVoxels));
  const rSq = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq <= rSq) {
          offsets.push({ dx, dy, dz, distSq });
        }
      }
    }
  }
  return offsets;
}

export interface VoxelHitResult {
  vx: number;
  vy: number;
  vz: number;
  val: number;
  normal: Vec3;
  distance: number;
}

/**
 * Exact 3D Amanatides & Woo Fast Voxel DDA Raycaster.
 * Guarantees 100% precision on 0.25m micro-voxels and exact face normals for Build Mode placement.
 */
export function raycastVoxelGridDDA(
  origin: Vec3,
  dir: Vec3,
  dimX: number,
  dimY: number,
  dimZ: number,
  voxelSize: number,
  getCell: (vx: number, vy: number, vz: number) => number,
  maxDistMeters = 36.0,
): VoxelHitResult | null {
  const dirLen = Math.hypot(dir.x, dir.y, dir.z);
  if (dirLen < 1e-6) return null;
  const dx = dir.x / dirLen;
  const dy = dir.y / dirLen;
  const dz = dir.z / dirLen;

  const boxMaxX = dimX * voxelSize;
  const boxMaxY = dimY * voxelSize;
  const boxMaxZ = dimZ * voxelSize;

  let tMin = 0.0;
  let tMax = maxDistMeters;
  let entryNormal: Vec3 = { x: 0, y: 1, z: 0 };

  const axes: Array<['x' | 'y' | 'z', number, number, number]> = [
    ['x', origin.x, dx, boxMaxX],
    ['y', origin.y, dy, boxMaxY],
    ['z', origin.z, dz, boxMaxZ],
  ];

  for (const [axis, orig, d, maxBound] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (orig < 0 || orig > maxBound) return null;
    } else {
      const invD = 1.0 / d;
      let t1 = (0 - orig) * invD;
      let t2 = (maxBound - orig) * invD;
      const nSign = -Math.sign(d);
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tMin) {
        tMin = t1;
        entryNormal = {
          x: axis === 'x' ? nSign : 0,
          y: axis === 'y' ? nSign : 0,
          z: axis === 'z' ? nSign : 0,
        };
      }
      if (t2 < tMax) {
        tMax = t2;
      }
      if (tMin > tMax) return null;
    }
  }

  const startT = Math.max(0, tMin + 1e-4);
  const startX = origin.x + dx * startT;
  const startY = origin.y + dy * startT;
  const startZ = origin.z + dz * startT;

  let vx = Math.min(dimX - 1, Math.max(0, Math.floor(startX / voxelSize)));
  let vy = Math.min(dimY - 1, Math.max(0, Math.floor(startY / voxelSize)));
  let vz = Math.min(dimZ - 1, Math.max(0, Math.floor(startZ / voxelSize)));

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(voxelSize / dx) : 1e9;
  const tDeltaY = stepY !== 0 ? Math.abs(voxelSize / dy) : 1e9;
  const tDeltaZ = stepZ !== 0 ? Math.abs(voxelSize / dz) : 1e9;

  let tMaxX =
    stepX > 0
      ? ((vx + 1) * voxelSize - startX) / dx
      : stepX < 0
      ? (vx * voxelSize - startX) / dx
      : 1e9;
  let tMaxY =
    stepY > 0
      ? ((vy + 1) * voxelSize - startY) / dy
      : stepY < 0
      ? (vy * voxelSize - startY) / dy
      : 1e9;
  let tMaxZ =
    stepZ > 0
      ? ((vz + 1) * voxelSize - startZ) / dz
      : stepZ < 0
      ? (vz * voxelSize - startZ) / dz
      : 1e9;

  let normal: Vec3 = { ...entryNormal };
  let dist = startT;
  const maxSteps = dimX + dimY + dimZ + 24;

  for (let i = 0; i < maxSteps; i++) {
    if (vx < 0 || vx >= dimX || vy < 0 || vy >= dimY || vz < 0 || vz >= dimZ) {
      break;
    }
    const cellVal = getCell(vx, vy, vz);
    if (cellVal !== 0) {
      return { vx, vy, vz, val: cellVal, normal, distance: dist };
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        dist = startT + tMaxX;
        if (dist > maxDistMeters) break;
        vx += stepX;
        tMaxX += tDeltaX;
        normal = { x: -stepX, y: 0, z: 0 };
      } else {
        dist = startT + tMaxZ;
        if (dist > maxDistMeters) break;
        vz += stepZ;
        tMaxZ += tDeltaZ;
        normal = { x: 0, y: 0, z: -stepZ };
      }
    } else {
      if (tMaxY < tMaxZ) {
        dist = startT + tMaxY;
        if (dist > maxDistMeters) break;
        vy += stepY;
        tMaxY += tDeltaY;
        normal = { x: 0, y: -stepY, z: 0 };
      } else {
        dist = startT + tMaxZ;
        if (dist > maxDistMeters) break;
        vz += stepZ;
        tMaxZ += tDeltaZ;
        normal = { x: 0, y: 0, z: -stepZ };
      }
    }
  }

  return null;
}

// Reusable scratch buffers for zero-GC 2D Greedy Meshing (auto-expands for huge unbounded vehicles!)
let MAX_VERTS = 24576;
let BUF_POS = new Float32Array(MAX_VERTS * 3);
let BUF_NORM = new Float32Array(MAX_VERTS * 3);
let BUF_COL = new Float32Array(MAX_VERTS * 3);
let BUF_AO = new Float32Array(MAX_VERTS);
let BUF_SPAWN_TIME = new Float32Array(MAX_VERTS);
let BUF_VOXEL_CENTER = new Float32Array(MAX_VERTS * 3);
let BUF_IDX = new Uint32Array((MAX_VERTS / 4) * 6);
let MASK_2D = new Int32Array(128 * 128);
let MASK_AO = new Uint8Array(128 * 128);

const _AO_LEVELS = new Float32Array([1.0, 0.88, 0.78, 0.70]);

/**
 * Deterministic per-voxel ±5% brightness jitter (0.95..1.05) so adjacent cubes of the
 * same material read as crisp individual voxels instead of a flat blob.
 */
export function computeVoxelColorJitter(vx: number, vy: number, vz: number): number {
  const dot = vx * 12.9898 + vy * 78.233 + vz * 37.719;
  const s = Math.sin(dot) * 43758.5453;
  const hash = s - Math.floor(s);
  return 0.95 + hash * 0.10;
}

function ensureGreedyVertexCapacity(neededVerts: number): void {
  if (neededVerts <= MAX_VERTS) return;
  MAX_VERTS = Math.max(neededVerts + 4096, MAX_VERTS * 2);
  const nextPos = new Float32Array(MAX_VERTS * 3);
  nextPos.set(BUF_POS);
  BUF_POS = nextPos;
  const nextNorm = new Float32Array(MAX_VERTS * 3);
  nextNorm.set(BUF_NORM);
  BUF_NORM = nextNorm;
  const nextCol = new Float32Array(MAX_VERTS * 3);
  nextCol.set(BUF_COL);
  BUF_COL = nextCol;
  const nextAo = new Float32Array(MAX_VERTS);
  nextAo.set(BUF_AO);
  BUF_AO = nextAo;
  const nextSpawn = new Float32Array(MAX_VERTS);
  nextSpawn.set(BUF_SPAWN_TIME);
  BUF_SPAWN_TIME = nextSpawn;
  const nextCenter = new Float32Array(MAX_VERTS * 3);
  nextCenter.set(BUF_VOXEL_CENTER);
  BUF_VOXEL_CENTER = nextCenter;
  const nextIdx = new Uint32Array((MAX_VERTS / 4) * 6);
  nextIdx.set(BUF_IDX);
  BUF_IDX = nextIdx;
}

export interface GreedyMeshVisualOptions {
  /** Returns normalized HP in [0, 1] for local grid voxel (lx, ly, lz). Values < 0.5 trigger red tint + 1.05x scale-up. */
  getVoxelHp?: (lx: number, ly: number, lz: number) => number;
  /** Returns spawn timestamp (seconds) for Build Mode pop-in animation (0 = static). */
  getVoxelSpawnTime?: (lx: number, ly: number, lz: number) => number;
  /** When true (vehicles/entities), emits 1x1 per-voxel quads with distinct ±5% jitter, baked AO, damage pop, and spawn animation. */
  perVoxelDetail?: boolean;
}

export interface GreedyMeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  ao?: Float32Array;
  spawnTimes?: Float32Array;
  voxelCenters?: Float32Array;
  indices: Uint32Array;
  vertCount: number;
  indexCount: number;
  rawFaces: number;
  mergedQuads: number;
}

/**
 * Projects a 3D ray onto a virtual drag plane passing through dragStartVoxel
 * so the user can drag BOX_FILL or LINE_DRAG up/down/left/right into open air!
 */
export function computeRayDragPlaneVoxel(
  localOrigin: Vec3,
  localDir: Vec3,
  dragStartVoxel: { vx: number; vy: number; vz: number },
  planeNormal: Vec3,
  voxelSize = VOXEL_SIZE,
): { vx: number; vy: number; vz: number; normal: Vec3 } | null {
  const pX = (dragStartVoxel.vx + 0.5) * voxelSize;
  const pY = (dragStartVoxel.vy + 0.5) * voxelSize;
  const pZ = (dragStartVoxel.vz + 0.5) * voxelSize;

  let nx = planeNormal.x;
  let ny = planeNormal.y;
  let nz = planeNormal.z;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-4) {
    nx = 0;
    ny = 1;
    nz = 0;
  } else {
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
  }

  let denom = localDir.x * nx + localDir.y * ny + localDir.z * nz;
  // If ray is nearly parallel to the initial face normal, fall back to a camera-facing plane
  if (Math.abs(denom) < 0.08) {
    nx = -localDir.x;
    ny = -localDir.y;
    nz = -localDir.z;
    denom = localDir.x * nx + localDir.y * ny + localDir.z * nz;
  }
  if (Math.abs(denom) < 1e-5) return null;

  const t =
    ((pX - localOrigin.x) * nx +
      (pY - localOrigin.y) * ny +
      (pZ - localOrigin.z) * nz) /
    denom;

  if (t < 0.1 || t > 65.0) return null;

  const hitX = localOrigin.x + localDir.x * t;
  const hitY = localOrigin.y + localDir.y * t;
  const hitZ = localOrigin.z + localDir.z * t;

  return {
    vx: Math.floor(hitX / voxelSize),
    vy: Math.floor(hitY / voxelSize),
    vz: Math.floor(hitZ / voxelSize),
    normal: { x: 0, y: 0, z: 0 },
  };
}

export type GreedyMeshFilterMode = 'ALL' | 'OPAQUE_ONLY' | 'TRANSLUCENT_ONLY';

export const MAT_BUCKET_SOIL = 0;
export const MAT_BUCKET_ROCK = 1;
export const MAT_BUCKET_STRUCTURAL = 2;
export const MAT_BUCKET_TRANSLUCENT = 3;
export const MAT_BUCKET_ALL_MASK = 0b1111;

const _GREEDY_DIMS = new Int32Array(3);
const _GREEDY_MIN_BOUNDS = new Int32Array(3);
const _GREEDY_MAX_BOUNDS = new Int32Array(3);
const _GREEDY_X = new Int32Array(3);
const _GREEDY_Q = new Int32Array(3);
const _GREEDY_DU = new Int32Array(3);
const _GREEDY_DV = new Int32Array(3);
const _GREEDY_FACE_SHADES = new Float32Array([0.88, 0.76, 1.0, 0.55, 0.93, 0.72]);

export function isTranslucentVoxelMat(rawVal: number): boolean {
  const matId = rawVal & 63;
  return matId === MAT.WATER_VOX || matId === MAT.GLASS_SOLID;
}

/**
 * Classifies a voxel material ID into one of 4 submesh buckets (#8):
 * - 0 (MAT_BUCKET_SOIL): GRASS, DIRT, SAND, SNOW, ICE
 * - 1 (MAT_BUCKET_ROCK): ROCK, CANYON_RED, CANYON_ORANGE
 * - 2 (MAT_BUCKET_STRUCTURAL): ASPHALT, ROAD_LINE, CONCRETE, BRICK, WOOD, STEEL, RAMP_ORANGE, HAZARD_YELLOW, C4_EXPLOSIVE, GLOW_*, NEON_CYAN, custom/vehicle blocks
 * - 3 (MAT_BUCKET_TRANSLUCENT): WATER_VOX, GLASS_SOLID
 */
export function getVoxelMaterialBucket(rawVal: number): 0 | 1 | 2 | 3 {
  if ((rawVal & 0x40000000) !== 0) {
    return MAT_BUCKET_STRUCTURAL;
  }
  const matId = rawVal & 63;
  if (matId === MAT.WATER_VOX || matId === MAT.GLASS_SOLID) {
    return MAT_BUCKET_TRANSLUCENT;
  }
  if (
    matId === MAT.GRASS ||
    matId === MAT.DIRT ||
    matId === MAT.SAND
  ) {
    return MAT_BUCKET_SOIL;
  }
  if (
    matId === MAT.ROCK ||
    matId === MAT.CANYON_RED ||
    matId === MAT.CANYON_ORANGE
  ) {
    return MAT_BUCKET_ROCK;
  }
  return MAT_BUCKET_STRUCTURAL;
}

/**
 * Touches the pre-allocated greedy-mesher TypedArray buffers so worker threads and JIT stay warm (#6).
 */
export function warmUpGreedyMesherScratchpad(): number {
  BUF_POS[0] = 0;
  BUF_NORM[0] = 1;
  BUF_COL[0] = 1;
  BUF_AO[0] = 1;
  BUF_SPAWN_TIME[0] = 0;
  BUF_VOXEL_CENTER[0] = 0;
  BUF_IDX[0] = 0;
  MASK_2D[0] = 0;
  MASK_AO[0] = 0;
  return BUF_NORM[0];
}

/**
 * Zero-allocation fast voxel coordinate parser for bit-packed int32 keys and string keys ("vx,vy,vz").
 * Avoids creating intermediate string[] and number[] arrays in hot physics/destruction loops.
 */
export function parseVoxelCoords(key: string | number): [number, number, number] {
  if (typeof key === 'number') {
    const k = key | 0;
    return [
      ((k >>> 20) & 0x3ff) - 512,
      ((k >>> 10) & 0x3ff) - 512,
      (k & 0x3ff) - 512,
    ];
  }
  const c1 = key.indexOf(',');
  const c2 = key.indexOf(',', c1 + 1);
  return [
    parseInt(key.slice(0, c1), 10),
    parseInt(key.slice(c1 + 1, c2), 10),
    parseInt(key.slice(c2 + 1), 10),
  ];
}

/**
 * Bounded 2D Greedy Mesher returning typed geometry arrays (positions, normals, vertex colors, ao, indices).
 * Uses strictly pre-allocated TypedArrays (zero regular JS arrays or .push() calls) (#7),
 * and supports per-material submesh bucket filtering (`materialBucketFilter`) (#8)!
 */
export function greedyMeshBoundedArrays(
  dimsX: number,
  dimsY: number,
  dimsZ: number,
  minY: number,
  maxY: number,
  getVoxelFn: (x: number, y: number, z: number) => number,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  voxelSizeParam = VOXEL_SIZE,
  voxelSizeYParam = voxelSizeParam,
  filterMode: GreedyMeshFilterMode = 'ALL',
  customColors?: Uint8Array | null,
  useSubarray = false,
  materialBucketFilter: -1 | 0 | 1 | 2 = -1,
  getBoundaryVoxelFn?: (x: number, y: number, z: number) => number,
  visualOptions?: GreedyMeshVisualOptions,
): GreedyMeshArrays {
  let vertCount = 0;
  let indexCount = 0;
  let rawFaces = 0;
  let mergedQuads = 0;
  const perVoxelDetail = Boolean(visualOptions?.perVoxelDetail) && filterMode !== 'TRANSLUCENT_ONLY';
  const getVoxelHp = visualOptions?.getVoxelHp;
  const getVoxelSpawnTime = visualOptions?.getVoxelSpawnTime;
  const emitSpawnPop = Boolean(getVoxelSpawnTime);
  const computeBakedAo = filterMode !== 'TRANSLUCENT_ONLY';

  const isOpaqueSolidAt = (sx: number, sy: number, sz: number): number => {
    if (sy < 0 || sy >= dimsY) return 0;
    if (sx < 0 || sx >= dimsX || sz < 0 || sz >= dimsZ) {
      if (getBoundaryVoxelFn !== undefined) {
        const bVal = getBoundaryVoxelFn(sx, sy, sz);
        return bVal !== 0 && !isTranslucentVoxelMat(bVal) ? 1 : 0;
      }
      return 0;
    }
    const val = getVoxelFn(sx, sy, sz);
    return val !== 0 && !isTranslucentVoxelMat(val) ? 1 : 0;
  };

  const yStart = Math.max(0, minY - 1);
  const yEnd = Math.min(dimsY - 1, maxY + 1);

  _GREEDY_DIMS[0] = dimsX;
  _GREEDY_DIMS[1] = dimsY;
  _GREEDY_DIMS[2] = dimsZ;

  _GREEDY_MIN_BOUNDS[0] = 0;
  _GREEDY_MIN_BOUNDS[1] = yStart;
  _GREEDY_MIN_BOUNDS[2] = 0;

  _GREEDY_MAX_BOUNDS[0] = dimsX;
  _GREEDY_MAX_BOUNDS[1] = yEnd + 1;
  _GREEDY_MAX_BOUNDS[2] = dimsZ;

  const dims = _GREEDY_DIMS;
  const minBounds = _GREEDY_MIN_BOUNDS;
  const maxBounds = _GREEDY_MAX_BOUNDS;
  const x = _GREEDY_X;
  const q = _GREEDY_Q;
  const du = _GREEDY_DU;
  const dv = _GREEDY_DV;
  const faceShades = _GREEDY_FACE_SHADES;

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    x[0] = 0;
    x[1] = 0;
    x[2] = 0;
    q[0] = 0;
    q[1] = 0;
    q[2] = 0;
    q[d] = 1;

    const uMin = minBounds[u], uMax = maxBounds[u];
    const vMin = minBounds[v], vMax = maxBounds[v];
    const sliceW = uMax - uMin;
    const sliceH = vMax - vMin;
    if (sliceW <= 0 || sliceH <= 0) continue;

    const sliceCells = sliceW * sliceH;
    const wasmKernel = !perVoxelDetail && sliceCells <= WASM_MAX_MASK_CELLS ? getWasmGreedyKernel() : null;
    if (sliceCells > MASK_2D.length) {
      MASK_2D = new Int32Array(sliceCells + 1024);
    }
    if (computeBakedAo && sliceCells > MASK_AO.length) {
      MASK_AO = new Uint8Array(sliceCells + 1024);
    }
    const activeMask = wasmKernel ? wasmKernel.maskView : MASK_2D;

    const sampleCornerOcc = (
      ox: number,
      oy: number,
      oz: number,
      su: number,
      sv: number,
    ): number => {
      let s1x = ox, s1y = oy, s1z = oz;
      if (u === 0) s1x += su;
      else if (u === 1) s1y += su;
      else s1z += su;

      let s2x = ox, s2y = oy, s2z = oz;
      if (v === 0) s2x += sv;
      else if (v === 1) s2y += sv;
      else s2z += sv;

      const side1 = isOpaqueSolidAt(s1x, s1y, s1z);
      const side2 = isOpaqueSolidAt(s2x, s2y, s2z);
      if (side1 && side2) return 3;

      let cx = s1x, cy = s1y, cz = s1z;
      if (v === 0) cx += sv;
      else if (v === 1) cy += sv;
      else cz += sv;
      return side1 + side2 + isOpaqueSolidAt(cx, cy, cz);
    };

    for (x[d] = minBounds[d] - 1; x[d] < maxBounds[d]; ) {
      let n = 0;
      let hasAnyFaceInSlice = false;
      let sliceHasAnyAo = false;

      for (x[v] = vMin; x[v] < vMax; ++x[v]) {
        for (x[u] = uMin; x[u] < uMax; ++x[u]) {
          const isNegBoundary = x[d] < 0;
          const isPosBoundary = x[d] >= dims[d] - 1;
          const rawA = !isNegBoundary ? getVoxelFn(x[0], x[1], x[2]) : 0;
          const rawB = !isPosBoundary
            ? getVoxelFn(x[0] + q[0], x[1] + q[1], x[2] + q[2])
            : 0;

          // Only skip the subterranean bottom-most world bedrock face at y < 0 facing downward (-Y).
          // Never skip bottom (-Y) faces on vehicles, modules, or placeable objects!
          if (d === 1 && x[1] < 0 && dimsX === 64 && dimsZ === 64 && (rawB & 63) === MAT.ROCK) {
            activeMask[n++] = 0;
            continue;
          }

          if (filterMode === 'OPAQUE_ONLY') {
            let a = rawA !== 0 && !isTranslucentVoxelMat(rawA) ? rawA : 0;
            let b = rawB !== 0 && !isTranslucentVoxelMat(rawB) ? rawB : 0;

            // Cross-chunk face culling with conservative missing-neighbor fallback:
            // Only cull a chunk boundary face if the neighboring chunk exists and has an opaque voxel at the adjacent cell.
            if (d !== 1 && getBoundaryVoxelFn !== undefined) {
              if (isNegBoundary && b !== 0) {
                const neighborRaw = getBoundaryVoxelFn(x[0], x[1], x[2]);
                if (neighborRaw !== 0 && !isTranslucentVoxelMat(neighborRaw)) {
                  a = neighborRaw;
                }
              } else if (isPosBoundary && a !== 0) {
                const neighborRaw = getBoundaryVoxelFn(
                  x[0] + q[0],
                  x[1] + q[1],
                  x[2] + q[2],
                );
                if (neighborRaw !== 0 && !isTranslucentVoxelMat(neighborRaw)) {
                  b = neighborRaw;
                }
              }
            }

            if (customColors && typeof customColors !== 'boolean' && (customColors as Uint8Array).length > 0) {
              if (a !== 0 && !isNegBoundary) {
                const idxA = (x[0] + dimsX * (x[1] + dimsY * x[2])) * 3;
                const crA = customColors[idxA] || 0;
                const cgA = customColors[idxA + 1] || 0;
                const cbA = customColors[idxA + 2] || 0;
                if (crA !== 0 || cgA !== 0 || cbA !== 0) {
                  a = 0x40000000 | (crA << 16) | (cgA << 8) | cbA;
                }
              }
              if (b !== 0 && !isPosBoundary) {
                const bx = x[0] + q[0];
                const by = x[1] + q[1];
                const bz = x[2] + q[2];
                const idxB = (bx + dimsX * (by + dimsY * bz)) * 3;
                const crB = customColors[idxB] || 0;
                const cgB = customColors[idxB + 1] || 0;
                const cbB = customColors[idxB + 2] || 0;
                if (crB !== 0 || cgB !== 0 || cbB !== 0) {
                  b = 0x40000000 | (crB << 16) | (cgB << 8) | cbB;
                }
              }
            }

            if ((a !== 0) === (b !== 0)) {
              activeMask[n++] = 0;
            } else if (a !== 0) {
              if (
                materialBucketFilter !== -1 &&
                getVoxelMaterialBucket(a) !== materialBucketFilter
              ) {
                activeMask[n++] = 0;
              } else {
                activeMask[n++] = a;
                rawFaces++;
                hasAnyFaceInSlice = true;
              }
            } else {
              if (
                materialBucketFilter !== -1 &&
                getVoxelMaterialBucket(b) !== materialBucketFilter
              ) {
                activeMask[n++] = 0;
              } else {
                activeMask[n++] = -b;
                rawFaces++;
                hasAnyFaceInSlice = true;
              }
            }
          } else if (filterMode === 'TRANSLUCENT_ONLY') {
            const a = rawA !== 0 && isTranslucentVoxelMat(rawA) ? rawA : 0;
            const b = rawB !== 0 && isTranslucentVoxelMat(rawB) ? rawB : 0;
            const matA = a & 63;
            const matB = b & 63;

            if (matA === matB) {
              activeMask[n++] = 0;
            } else if (a !== 0 && b === 0) {
              // Never emit vertical water walls against chunk borders or solid terrain (prevents vertical mirror curtains along shores/roads/craters)
              const isChunkSideBorder = d !== 1 && (x[d] < 0 || x[d] >= dims[d] - 1);
              if (matA === MAT.WATER_VOX && (isChunkSideBorder || rawB !== 0)) {
                activeMask[n++] = 0;
              } else {
                activeMask[n++] = a;
                rawFaces++;
                hasAnyFaceInSlice = true;
              }
            } else if (b !== 0 && a === 0) {
              const isChunkSideBorder = d !== 1 && (x[d] < 0 || x[d] >= dims[d] - 1);
              if (matB === MAT.WATER_VOX && (isChunkSideBorder || rawA !== 0)) {
                activeMask[n++] = 0;
              } else {
                activeMask[n++] = -b;
                rawFaces++;
                hasAnyFaceInSlice = true;
              }
            } else {
              // Glass touching water: emit the glass face
              if (matA === MAT.GLASS_SOLID) {
                activeMask[n++] = a;
                rawFaces++;
                hasAnyFaceInSlice = true;
              } else {
                activeMask[n++] = -b;
                rawFaces++;
                hasAnyFaceInSlice = true;
              }
            }
          } else {
            const a = rawA;
            const b = rawB;
            if ((a !== 0) === (b !== 0)) {
              activeMask[n++] = 0;
            } else if (a !== 0) {
              activeMask[n++] = a;
              rawFaces++;
              hasAnyFaceInSlice = true;
            } else {
              activeMask[n++] = -b;
              rawFaces++;
              hasAnyFaceInSlice = true;
            }
          }
        }
      }

      if (computeBakedAo && hasAnyFaceInSlice) {
        let aoIdx = 0;
        const baseD = x[d];
        for (let j = 0; j < sliceH; j++) {
          const vv = vMin + j;
          for (let i = 0; i < sliceW; i++) {
            const cVal = activeMask[aoIdx];
            if (cVal === 0) {
              MASK_AO[aoIdx++] = 0;
              continue;
            }
            const uu = uMin + i;
            // Sample the empty air plane directly outside the exposed face
            const outD = cVal > 0 ? baseD + 1 : baseD;
            let ox = 0, oy = 0, oz = 0;
            if (d === 0) { ox = outD; oy = uu; oz = vv; }
            else if (d === 1) { ox = vv; oy = outD; oz = uu; }
            else { ox = uu; oy = vv; oz = outD; }

            const occ0 = sampleCornerOcc(ox, oy, oz, -1, -1);
            const occ1 = sampleCornerOcc(ox, oy, oz, 1, -1);
            const occ2 = sampleCornerOcc(ox, oy, oz, 1, 1);
            const occ3 = sampleCornerOcc(ox, oy, oz, -1, 1);
            const packedAo = occ0 | (occ1 << 2) | (occ2 << 4) | (occ3 << 6);
            MASK_AO[aoIdx++] = packedAo;
            if (packedAo !== 0) sliceHasAnyAo = true;
          }
        }
      }

      ++x[d];
      const waterTopSliceY = WATER_VY + 1;
      const hasWaterBorderNeighbor =
        filterMode === 'TRANSLUCENT_ONLY' &&
        d === 1 &&
        x[1] === waterTopSliceY &&
        getBoundaryVoxelFn !== undefined;
      if (!hasAnyFaceInSlice && !hasWaterBorderNeighbor) continue;

      // Expand top water surface slice (x[1] === WATER_VY + 1, i.e. 57) by up to 4.5m (18 voxels at LOD0) into adjacent
      // sloped beaches, shore banks, and low roads (<= WATER_VY + 2 = 14.75m; never into open air cavities or >= 15.0m walls)
      // so crashing ocean swells smoothly climb and wash onto both the beach AND the road!
      if (filterMode === 'TRANSLUCENT_ONLY' && d === 1 && x[1] === waterTopSliceY) {
        const seaVY = x[1] - 1;
        const maxPasses = Math.max(4, Math.min(18, Math.round(4.5 / voxelSizeParam)));
        let [frontierA, frontierB] = getWaterFrontierBuffers(sliceCells);
        let frontierLen = 0;

        for (let j = 0; j < sliceH; j++) {
          const rowOff = j * sliceW;
          const lxIdx = vMin + j;
          for (let i = 0; i < sliceW; i++) {
            const idx = rowOff + i;
            if (activeMask[idx] !== 0) continue;
            const lzIdx = uMin + i;
            const curRaw = getVoxelFn(lxIdx, seaVY, lzIdx);
            if (curRaw === 0 || curRaw === MAT.WATER_VOX) continue;
            if (seaVY + 3 < dimsY && getVoxelFn(lxIdx, seaVY + 3, lzIdx) !== 0) continue;
            const hasW =
              (i > 0 && activeMask[idx - 1] > 0 && activeMask[idx - 1] < 0x7fff0000 && (activeMask[idx - 1] & 63) === MAT.WATER_VOX) ||
              (i + 1 < sliceW && activeMask[idx + 1] > 0 && activeMask[idx + 1] < 0x7fff0000 && (activeMask[idx + 1] & 63) === MAT.WATER_VOX) ||
              (j > 0 && activeMask[idx - sliceW] > 0 && activeMask[idx - sliceW] < 0x7fff0000 && (activeMask[idx - sliceW] & 63) === MAT.WATER_VOX) ||
              (j + 1 < sliceH && activeMask[idx + sliceW] > 0 && activeMask[idx + sliceW] < 0x7fff0000 && (activeMask[idx + sliceW] & 63) === MAT.WATER_VOX) ||
              (getBoundaryVoxelFn !== undefined && (
                (i === 0 && (getBoundaryVoxelFn(lxIdx, seaVY, lzIdx - 1) & 63) === MAT.WATER_VOX) ||
                (i + 1 === sliceW && (getBoundaryVoxelFn(lxIdx, seaVY, lzIdx + 1) & 63) === MAT.WATER_VOX) ||
                (j === 0 && (getBoundaryVoxelFn(lxIdx - 1, seaVY, lzIdx) & 63) === MAT.WATER_VOX) ||
                (j + 1 === sliceH && (getBoundaryVoxelFn(lxIdx + 1, seaVY, lzIdx) & 63) === MAT.WATER_VOX)
              ));
            if (hasW) {
              activeMask[idx] = 0x7fff0000;
              frontierA[frontierLen++] = idx;
            }
          }
        }
        for (let f = 0; f < frontierLen; f++) {
          activeMask[frontierA[f]] = MAT.WATER_VOX;
        }

        const tryExpandNeighbor = (ni: number, nj: number, nextArr: Int32Array, nextCount: number): number => {
          const nIdx = nj * sliceW + ni;
          if (activeMask[nIdx] !== 0) return nextCount;
          const lxIdx = vMin + nj;
          const lzIdx = uMin + ni;
          const curRaw = getVoxelFn(lxIdx, seaVY, lzIdx);
          if (curRaw === 0 || curRaw === MAT.WATER_VOX) return nextCount;
          if (seaVY + 3 < dimsY && getVoxelFn(lxIdx, seaVY + 3, lzIdx) !== 0) return nextCount;
          activeMask[nIdx] = MAT.WATER_VOX;
          nextArr[nextCount] = nIdx;
          return nextCount + 1;
        };

        for (let pass = 1; pass < maxPasses && frontierLen > 0; pass++) {
          let nextLen = 0;
          for (let f = 0; f < frontierLen; f++) {
            const cIdx = frontierA[f];
            const cj = Math.floor(cIdx / sliceW);
            const ci = cIdx - cj * sliceW;
            if (ci > 0) nextLen = tryExpandNeighbor(ci - 1, cj, frontierB, nextLen);
            if (ci + 1 < sliceW) nextLen = tryExpandNeighbor(ci + 1, cj, frontierB, nextLen);
            if (cj > 0) nextLen = tryExpandNeighbor(ci, cj - 1, frontierB, nextLen);
            if (cj + 1 < sliceH) nextLen = tryExpandNeighbor(ci, cj + 1, frontierB, nextLen);
          }
          const tmp = frontierA;
          frontierA = frontierB;
          frontierB = tmp;
          frontierLen = nextLen;
        }
      }

      const emitMergedSliceQuad = (
        i: number,
        j: number,
        w: number,
        h: number,
        c: number,
        packedAo = 0,
      ) => {
        ensureGreedyVertexCapacity(vertCount + 4);
        // Subdivide sea-level water surface faces into 2x2 voxel cells (0.5m) so shoreline waves wash smoothly over slopes,
        // while allowing 8x8 merged quads for deeper subterranean/hole water below sea level!
        if (d === 1 && c > 0 && (Math.abs(c) & 63) === MAT.WATER_VOX) {
          const cellWX = offsetX + (vMin + j) * voxelSizeParam;
          const cellWZ = offsetZ + (uMin + i) * voxelSizeParam;
          const isShoreSwash =
            x[1] >= waterTopSliceY &&
            ((cellWX > -27.5 && cellWX < -19.5 && cellWZ < 38.0) ||
              (cellWX < -19.5 && Math.abs(cellWZ) < 7.0) ||
              (cellWX < -19.5 && cellWZ > 31.0 && cellWZ < 38.0));
          const maxSpan = x[1] >= 57 ? (isShoreSwash ? 1 : 2) : 8;
          if (w > maxSpan || h > maxSpan) {
            for (let subJ = 0; subJ < h; subJ += maxSpan) {
              const subH = Math.min(maxSpan, h - subJ);
              for (let subI = 0; subI < w; subI += maxSpan) {
                const subW = Math.min(maxSpan, w - subI);
                emitMergedSliceQuad(i + subI, j + subJ, subW, subH, c, packedAo);
              }
            }
            return;
          }
        }
        x[u] = uMin + i;
        x[v] = vMin + j;

        du[0] = 0;
        du[1] = 0;
        du[2] = 0;
        dv[0] = 0;
        dv[1] = 0;
        dv[2] = 0;
        du[u] = w;
        dv[v] = h;

        const rawCode = Math.abs(c);
        const isCustomColor = (rawCode & 0x40000000) !== 0;
        const faceIdx = c > 0 ? d * 2 : d * 2 + 1;

        // Owner voxel coordinates (in local grid space) for per-voxel jitter, HP damage highlight, and Build Mode spawn pop
        const voxX = x[0] - (c > 0 && d === 0 ? 1 : 0);
        const voxY = x[1] - (c > 0 && d === 1 ? 1 : 0);
        const voxZ = x[2] - (c > 0 && d === 2 ? 1 : 0);
        const voxCenterX = offsetX + (voxX + 0.5) * voxelSizeParam;
        const voxCenterY = offsetY + (voxY + 0.5) * voxelSizeYParam;
        const voxCenterZ = offsetZ + (voxZ + 0.5) * voxelSizeParam;

        let voxelHp = 1.0;
        let isVehicleDamaged = false;
        let damageRedMix = 0;
        if (getVoxelHp && w === 1 && h === 1) {
          voxelHp = getVoxelHp(voxX, voxY, voxZ);
          if (voxelHp < 0.5) {
            isVehicleDamaged = true;
            // 50% HP = 25% red, 0% HP = 100% red
            const dmgFrac = Math.max(0, Math.min(1, (0.5 - voxelHp) / 0.5));
            damageRedMix = 0.25 + dmgFrac * 0.75;
          }
        }
        const spawnTimeVal = getVoxelSpawnTime && w === 1 && h === 1
          ? getVoxelSpawnTime(voxX, voxY, voxZ)
          : 0;

        let baseR: number;
        let baseG: number;
        let baseB: number;
        let shade: number;
        let charMult = 1.0;

        if (isCustomColor) {
          baseR = ((rawCode >> 16) & 255) / 255;
          baseG = ((rawCode >> 8) & 255) / 255;
          baseB = (rawCode & 255) / 255;
          shade = 1.0;
        } else {
          const isDamagedBelow50 = !getVoxelHp && (rawCode & 64) !== 0;
          const matId = rawCode & 63;
          const info = MAT_INFO[matId] || MAT_INFO[MAT.ROCK];
          const isEmissive = Boolean(info.emissive);
          shade = isEmissive ? 1.0 : faceShades[faceIdx];
          charMult = isDamagedBelow50 ? 0.32 : 1.0;
          baseR = ((info.color >> 16) & 255) / 255;
          baseG = ((info.color >> 8) & 255) / 255;
          baseB = (info.color & 255) / 255;
        }

        // Keep top water surface flush with voxel grid so there is zero shoreline gap
        const waterYInset = 0;

        let v0x = offsetX + x[0] * voxelSizeParam;
        let v0y = offsetY + x[1] * voxelSizeYParam + waterYInset;
        let v0z = offsetZ + x[2] * voxelSizeParam;

        let v1x = offsetX + (x[0] + du[0]) * voxelSizeParam;
        let v1y = offsetY + (x[1] + du[1]) * voxelSizeYParam + waterYInset;
        let v1z = offsetZ + (x[2] + du[2]) * voxelSizeParam;

        let v2x = offsetX + (x[0] + du[0] + dv[0]) * voxelSizeParam;
        let v2y = offsetY + (x[1] + du[1] + dv[1]) * voxelSizeYParam + waterYInset;
        let v2z = offsetZ + (x[2] + du[2] + dv[2]) * voxelSizeParam;

        let v3x = offsetX + (x[0] + dv[0]) * voxelSizeParam;
        let v3y = offsetY + (x[1] + dv[1]) * voxelSizeYParam + waterYInset;
        let v3z = offsetZ + (x[2] + dv[2]) * voxelSizeParam;

        // Item 5B2: Damaged vehicle voxels (< 50% HP) scale up 1.05x around their voxel center so they pop out slightly
        if (isVehicleDamaged) {
          const dmgScale = 1.05;
          v0x = voxCenterX + (v0x - voxCenterX) * dmgScale;
          v0y = voxCenterY + (v0y - voxCenterY) * dmgScale;
          v0z = voxCenterZ + (v0z - voxCenterZ) * dmgScale;
          v1x = voxCenterX + (v1x - voxCenterX) * dmgScale;
          v1y = voxCenterY + (v1y - voxCenterY) * dmgScale;
          v1z = voxCenterZ + (v1z - voxCenterZ) * dmgScale;
          v2x = voxCenterX + (v2x - voxCenterX) * dmgScale;
          v2y = voxCenterY + (v2y - voxCenterY) * dmgScale;
          v2z = voxCenterZ + (v2z - voxCenterZ) * dmgScale;
          v3x = voxCenterX + (v3x - voxCenterX) * dmgScale;
          v3y = voxCenterY + (v3y - voxCenterY) * dmgScale;
          v3z = voxCenterZ + (v3z - voxCenterZ) * dmgScale;
        }

        const pBase = vertCount * 3;
        BUF_POS[pBase]      = v0x; BUF_POS[pBase + 1]  = v0y; BUF_POS[pBase + 2]  = v0z;
        BUF_POS[pBase + 3]  = v1x; BUF_POS[pBase + 4]  = v1y; BUF_POS[pBase + 5]  = v1z;
        BUF_POS[pBase + 6]  = v2x; BUF_POS[pBase + 7]  = v2y; BUF_POS[pBase + 8]  = v2z;
        BUF_POS[pBase + 9]  = v3x; BUF_POS[pBase + 10] = v3y; BUF_POS[pBase + 11] = v3z;

        // Item 5A1: Per-vertex baked Ambient Occlusion (0.70..1.0)
        const ao0 = computeBakedAo ? _AO_LEVELS[packedAo & 3] : 1.0;
        const ao1 = computeBakedAo ? _AO_LEVELS[(packedAo >> 2) & 3] : 1.0;
        const ao2 = computeBakedAo ? _AO_LEVELS[(packedAo >> 4) & 3] : 1.0;
        const ao3 = computeBakedAo ? _AO_LEVELS[(packedAo >> 6) & 3] : 1.0;
        BUF_AO[vertCount]     = ao0;
        BUF_AO[vertCount + 1] = ao1;
        BUF_AO[vertCount + 2] = ao2;
        BUF_AO[vertCount + 3] = ao3;

        if (emitSpawnPop) {
          BUF_SPAWN_TIME[vertCount]     = spawnTimeVal;
          BUF_SPAWN_TIME[vertCount + 1] = spawnTimeVal;
          BUF_SPAWN_TIME[vertCount + 2] = spawnTimeVal;
          BUF_SPAWN_TIME[vertCount + 3] = spawnTimeVal;
          for (let cv = 0; cv < 12; cv += 3) {
            BUF_VOXEL_CENTER[pBase + cv]     = voxCenterX;
            BUF_VOXEL_CENTER[pBase + cv + 1] = voxCenterY;
            BUF_VOXEL_CENTER[pBase + cv + 2] = voxCenterZ;
          }
        }

        const nSign = c > 0 ? 1 : -1;
        const nx = d === 0 ? nSign : 0;
        const ny = d === 1 ? nSign : 0;
        const nz = d === 2 ? nSign : 0;

        // Item 5A2: Deterministic ±5% per-voxel color jitter (0.95..1.05)
        const perVoxelJitter = perVoxelDetail
          ? computeVoxelColorJitter(voxX, voxY, voxZ)
          : 1.0;

        for (let cv = 0; cv < 12; cv += 3) {
          BUF_NORM[pBase + cv]     = nx;
          BUF_NORM[pBase + cv + 1] = ny;
          BUF_NORM[pBase + cv + 2] = nz;

          if (isCustomColor) {
            let cr = baseR * perVoxelJitter;
            let cg = baseG * perVoxelJitter;
            let cb = baseB * perVoxelJitter;
            if (isVehicleDamaged) {
              cr = cr * (1 - damageRedMix) + 1.0 * damageRedMix;
              cg = cg * (1 - damageRedMix) + 0.12 * damageRedMix;
              cb = cb * (1 - damageRedMix) + 0.08 * damageRedMix;
            }
            BUF_COL[pBase + cv]     = Math.min(1, cr);
            BUF_COL[pBase + cv + 1] = Math.min(1, cg);
            BUF_COL[pBase + cv + 2] = Math.min(1, cb);
          } else {
            const matId = rawCode & 63;
            const vx = BUF_POS[pBase + cv];
            const vy = BUF_POS[pBase + cv + 1];
            const vz = BUF_POS[pBase + cv + 2];

            // Fast deterministic spatial harmonic for rich multi-tone vibrancy across every material!
            const w1 = Math.sin(vx * 0.42 + vz * 0.31 + vy * 0.25);
            const w2 = Math.cos(vx * 0.19 - vz * 0.37 + vy * 0.55);
            const micro = Math.sin(vx * 2.4 + vz * 2.4 + vy * 2.1);

            let vr = baseR;
            let vg = baseG;
            let vb = baseB;

            if (matId === MAT.GRASS) {
              // Lush multi-tone meadow grass: blends sunlit lime, vibrant emerald, and rich clover
              const lush = w1 * 0.55 + w2 * 0.45;
              vr = Math.max(0.10, Math.min(0.48, baseR + lush * 0.14 + micro * 0.04));
              vg = Math.max(0.48, Math.min(0.92, baseG + lush * 0.18 + micro * 0.05));
              vb = Math.max(0.04, Math.min(0.28, baseB - lush * 0.04 + micro * 0.02));
            } else if (matId === MAT.GLOW_CRYSTAL) {
              // Radiant bioluminescent cave crystal: shimmers between electric cyan and neon aquamarine
              const pulse = (w1 + w2) * 0.5;
              vr = Math.min(1, 0.12 + Math.max(0, pulse) * 0.25);
              vg = Math.min(1, 0.92 + pulse * 0.08);
              vb = Math.min(1, 0.85 + Math.abs(micro) * 0.15);
            } else if (matId === MAT.GLOW_MAGMA) {
              // Incandescent molten magma core: glows between deep lava orange and bright solar gold
              const heat = (w1 + micro) * 0.5;
              vr = 1.0;
              vg = Math.max(0.32, Math.min(0.88, 0.48 + heat * 0.28));
              vb = Math.max(0.02, Math.min(0.35, 0.08 + Math.max(0, heat) * 0.22));
            } else if (matId === MAT.HEADLIGHT_LAMP) {
              vr = 1.0;
              vg = 0.97;
              vb = 0.78;
            } else if (matId === MAT.ROCK || matId === MAT.CONCRETE || matId === MAT.ARMOR_SLATE) {
              // Natural geological strata & bevel variation
              const strata = Math.sin(vy * 1.35 + w1 * 0.8) * 0.08 + micro * 0.035;
              vr = Math.max(0.08, Math.min(1, baseR + strata));
              vg = Math.max(0.09, Math.min(1, baseG + strata * 1.05));
              vb = Math.max(0.11, Math.min(1, baseB + strata * 1.12));
            } else if (matId === MAT.SAND || matId === MAT.CANYON_ORANGE || matId === MAT.CANYON_RED) {
              // Warm wind-rippled sandstone & desert dune banding
              const ripple = (w1 * 0.6 + Math.sin(vy * 1.8) * 0.4) * 0.09 + micro * 0.03;
              vr = Math.max(0.15, Math.min(1, baseR + ripple * 1.1));
              vg = Math.max(0.10, Math.min(1, baseG + ripple * 0.85));
              vb = Math.max(0.05, Math.min(1, baseB + ripple * 0.5));
            } else if (matId === MAT.WATER_VOX) {
              // Tag sheltered subterranean/inland hole water with vr = 0.60 vs open shoreline/basin water vr = 0.04
              // Keep the entire coastal beach & road wash-up apron (-19.5m / +38.0m) unflagged so waves climb onto shores & roads!
              const isPondCore = Math.hypot(vx - 65, vz - -85) < 17.5;
              const isHoleOrTrenchWater =
                vy < 13.95 || ((vx > -19.5 || vz > 38.0) && !isPondCore);
              vr = isHoleOrTrenchWater ? 0.60 : 0.04;
              vg = baseG;
              vb = Math.max(0.86, baseB);
            } else if (matId === MAT.GLASS_SOLID) {
              // Crisp blue-tinted transparent window glass with subtle specular sheen
              const sheen = (w1 * 0.5 + micro * 0.5) * 0.06;
              vr = Math.max(0.20, Math.min(0.48, 0.28 + sheen));
              vg = Math.max(0.68, Math.min(0.92, 0.78 + sheen));
              vb = Math.max(0.92, Math.min(1.0, 0.98 + sheen * 0.5));
            } else if (matId === MAT.PAINT_CARBON) {
              // Diagonal twill carbon-fiber weave pattern
              const weave = Math.sin((vx + vz) * 8.0 + vy * 8.0) * 0.055;
              vr = Math.max(0.04, Math.min(0.24, baseR + weave));
              vg = Math.max(0.05, Math.min(0.26, baseG + weave));
              vb = Math.max(0.07, Math.min(0.32, baseB + weave * 1.2));
            } else if (matId === MAT.PAINT_CAMO) {
              // Multi-tone woodland camo blotches (olive, dark moss, earth tan)
              const camo = Math.sin(vx * 1.4 + vz * 0.9) + Math.cos(vz * 1.3 - vy * 1.1);
              if (camo > 0.65) {
                vr = 0.22; vg = 0.34; vb = 0.14;
              } else if (camo < -0.55) {
                vr = 0.44; vg = 0.38; vb = 0.22;
              } else {
                vr = baseR + micro * 0.03;
                vg = baseG + micro * 0.03;
                vb = baseB + micro * 0.02;
              }
            } else if (matId === MAT.PAINT_GOLD || matId === MAT.CHROME_SILVER) {
              // High-gloss metallic specular gradient
              const specBand = Math.sin(vx * 1.1 + vy * 2.2 - vz * 0.9) * 0.12 + micro * 0.04;
              vr = Math.max(0.15, Math.min(1.0, baseR + specBand));
              vg = Math.max(0.15, Math.min(1.0, baseG + specBand));
              vb = Math.max(0.10, Math.min(1.0, baseB + specBand));
            } else if (perVoxelDetail) {
              // Per-voxel detail mode (vehicles & voxel entities): clean flat base color modulated by ±5% deterministic voxel hash!
              vr = baseR;
              vg = baseG;
              vb = baseB;
            } else {
              // Terrain/world structures: subtle micro-contrast + deterministic ±5% voxel jitter
              const bev = micro * 0.03 + w1 * 0.025;
              vr = Math.max(0.05, Math.min(1, baseR + bev));
              vg = Math.max(0.05, Math.min(1, baseG + bev));
              vb = Math.max(0.05, Math.min(1, baseB + bev));
            }

            const jitterMult =
              matId === MAT.WATER_VOX || matId === MAT.GLASS_SOLID
                ? 1.0
                : perVoxelDetail
                  ? perVoxelJitter
                  : computeVoxelColorJitter(
                      Math.floor(vx / voxelSizeParam),
                      Math.floor(vy / voxelSizeYParam),
                      Math.floor(vz / voxelSizeParam),
                    );

            let outR = Math.min(1, vr * shade * charMult * jitterMult);
            let outG = Math.min(1, vg * shade * charMult * jitterMult);
            let outB = Math.min(1, vb * shade * charMult * jitterMult);

            if (isVehicleDamaged) {
              outR = outR * (1 - damageRedMix) + 1.0 * damageRedMix;
              outG = outG * (1 - damageRedMix) + 0.12 * damageRedMix;
              outB = outB * (1 - damageRedMix) + 0.08 * damageRedMix;
            }

            BUF_COL[pBase + cv]     = Math.min(1, outR);
            BUF_COL[pBase + cv + 1] = Math.min(1, outG);
            BUF_COL[pBase + cv + 2] = Math.min(1, outB);
          }
        }

        // Flip quad diagonal when opposing AO corners have higher contrast (eliminates interpolation anisotropy)
        const flipAoDiag = ao0 + ao2 < ao1 + ao3;
        if (c > 0) {
          if (!flipAoDiag) {
            BUF_IDX[indexCount++] = vertCount;
            BUF_IDX[indexCount++] = vertCount + 1;
            BUF_IDX[indexCount++] = vertCount + 2;
            BUF_IDX[indexCount++] = vertCount;
            BUF_IDX[indexCount++] = vertCount + 2;
            BUF_IDX[indexCount++] = vertCount + 3;
          } else {
            BUF_IDX[indexCount++] = vertCount + 1;
            BUF_IDX[indexCount++] = vertCount + 2;
            BUF_IDX[indexCount++] = vertCount + 3;
            BUF_IDX[indexCount++] = vertCount + 1;
            BUF_IDX[indexCount++] = vertCount + 3;
            BUF_IDX[indexCount++] = vertCount;
          }
        } else {
          if (!flipAoDiag) {
            BUF_IDX[indexCount++] = vertCount;
            BUF_IDX[indexCount++] = vertCount + 2;
            BUF_IDX[indexCount++] = vertCount + 1;
            BUF_IDX[indexCount++] = vertCount;
            BUF_IDX[indexCount++] = vertCount + 3;
            BUF_IDX[indexCount++] = vertCount + 2;
          } else {
            BUF_IDX[indexCount++] = vertCount + 1;
            BUF_IDX[indexCount++] = vertCount + 3;
            BUF_IDX[indexCount++] = vertCount + 2;
            BUF_IDX[indexCount++] = vertCount + 1;
            BUF_IDX[indexCount++] = vertCount;
            BUF_IDX[indexCount++] = vertCount + 3;
          }
        }

        vertCount += 4;
        mergedQuads++;
      };

      if (perVoxelDetail) {
        n = 0;
        for (let j = 0; j < sliceH; ++j) {
          for (let i = 0; i < sliceW; ++i, ++n) {
            const c = activeMask[n];
            if (c !== 0) {
              emitMergedSliceQuad(i, j, 1, 1, c, computeBakedAo ? MASK_AO[n] : 0);
              activeMask[n] = 0;
            }
          }
        }
      } else if (wasmKernel && !sliceHasAnyAo) {
        const quadCount = wasmKernel.exports.mergeMask2D(
          sliceW,
          sliceH,
          WASM_MASK_BYTE_OFFSET,
          WASM_QUADS_BYTE_OFFSET,
          WASM_MAX_QUADS_PER_SLICE,
        );
        const qv = wasmKernel.quadsView;
        for (let qi = 0; qi < quadCount; qi++) {
          const qBase = qi * 5;
          emitMergedSliceQuad(
            qv[qBase],
            qv[qBase + 1],
            qv[qBase + 2],
            qv[qBase + 3],
            qv[qBase + 4],
            0,
          );
        }
      } else {
        n = 0;
        for (let j = 0; j < sliceH; ++j) {
          for (let i = 0; i < sliceW; ) {
            const c = activeMask[n];
            if (c !== 0) {
              const aoSig = computeBakedAo ? MASK_AO[n] : 0;
              let w = 1;
              while (
                i + w < sliceW &&
                activeMask[n + w] === c &&
                (!computeBakedAo || MASK_AO[n + w] === aoSig)
              ) {
                w++;
              }

              let h = 1;
              let done = false;
              while (j + h < sliceH) {
                for (let k = 0; k < w; ++k) {
                  const cellIdx = n + k + h * sliceW;
                  if (
                    activeMask[cellIdx] !== c ||
                    (computeBakedAo && MASK_AO[cellIdx] !== aoSig)
                  ) {
                    done = true;
                    break;
                  }
                }
                if (done) break;
                h++;
              }

              emitMergedSliceQuad(i, j, w, h, c, aoSig);

              for (let l = 0; l < h; ++l) {
                for (let k = 0; k < w; ++k) {
                  activeMask[n + k + l * sliceW] = 0;
                }
              }
              i += w;
              n += w;
            } else {
              i++;
              n++;
            }
          }
        }
      }
    }
  }

  return {
    positions: useSubarray
      ? BUF_POS.subarray(0, vertCount * 3)
      : BUF_POS.slice(0, vertCount * 3),
    normals: useSubarray
      ? BUF_NORM.subarray(0, vertCount * 3)
      : BUF_NORM.slice(0, vertCount * 3),
    colors: useSubarray
      ? BUF_COL.subarray(0, vertCount * 3)
      : BUF_COL.slice(0, vertCount * 3),
    ao: useSubarray
      ? BUF_AO.subarray(0, vertCount)
      : BUF_AO.slice(0, vertCount),
    ...(emitSpawnPop
      ? {
          spawnTimes: useSubarray
            ? BUF_SPAWN_TIME.subarray(0, vertCount)
            : BUF_SPAWN_TIME.slice(0, vertCount),
          voxelCenters: useSubarray
            ? BUF_VOXEL_CENTER.subarray(0, vertCount * 3)
            : BUF_VOXEL_CENTER.slice(0, vertCount * 3),
        }
      : {}),
    indices: useSubarray
      ? BUF_IDX.subarray(0, indexCount)
      : BUF_IDX.slice(0, indexCount),
    vertCount,
    indexCount,
    rawFaces,
    mergedQuads,
  };
}

/**
 * Ultra-fast 2.5D Top-Visible-Layer Greedy Mesher for terrain chunks:
 * Instead of scanning all 80 vertical Y slices and underground caves in 3D,
 * directly meshes ONLY the top visible surface layer (`surfaceHeightMap[lx + (lz << 6)]`)
 * and exposed vertical cliff step walls (`surfVY > neighborVY`) in a single 64x64 2D pass!
 */
export function greedyMeshTopSurfaceOnly(
  dimsX: number,
  dimsY: number,
  dimsZ: number,
  surfaceHeightMap: Uint16Array,
  voxels: Uint8Array,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  voxelSizeParam = VOXEL_SIZE,
  customColors?: Uint8Array | null,
  useSubarray = false,
  getBoundarySurfVY?: (lx: number, lz: number) => number,
): GreedyMeshArrays {
  let vertCount = 0;
  let indexCount = 0;
  let rawFaces = 0;
  let mergedQuads = 0;

  const totalCells = dimsX * dimsZ;
  if (totalCells > MASK_2D.length) {
    MASK_2D = new Int32Array(totalCells + 1024);
  }

  const hasCustom =
    Boolean(customColors) &&
    typeof customColors !== 'boolean' &&
    (customColors as Uint8Array).length > 0;
  const faceShades = _GREEDY_FACE_SHADES;

  const isCompactSurfaceBuf = voxels.length < dimsX * dimsY * dimsZ;
  const compactYStride = isCompactSurfaceBuf
    ? Math.max(1, Math.floor(voxels.length / (dimsX * dimsZ)))
    : dimsY;

  const getCellCode = (lx: number, vy: number, lz: number): number => {
    const idx3D = isCompactSurfaceBuf
      ? lx + dimsX * compactYStride * lz
      : lx + dimsX * (vy + dimsY * lz);
    const rawMat = voxels[idx3D];
    const mat =
      rawMat !== 0 && !isTranslucentVoxelMat(rawMat) ? rawMat : MAT.ROCK;
    if (hasCustom && customColors && !isCompactSurfaceBuf) {
      const cIdx = idx3D * 3;
      const cr = customColors[cIdx] || 0;
      const cg = customColors[cIdx + 1] || 0;
      const cb = customColors[cIdx + 2] || 0;
      if (cr !== 0 || cg !== 0 || cb !== 0) {
        return 0x40000000 | (cr << 16) | (cg << 8) | cb;
      }
    }
    return mat;
  };

  const emitQuad = (
    v0x: number,
    v0y: number,
    v0z: number,
    v1x: number,
    v1y: number,
    v1z: number,
    v2x: number,
    v2y: number,
    v2z: number,
    v3x: number,
    v3y: number,
    v3z: number,
    nx: number,
    ny: number,
    nz: number,
    faceIdx: number,
    rawCode: number,
    flipWinding: boolean,
    ao0 = 1.0,
    ao1 = 1.0,
    ao2 = 1.0,
    ao3 = 1.0,
  ) => {
    ensureGreedyVertexCapacity(vertCount + 4);
    const isCustomColor = (rawCode & 0x40000000) !== 0;
    let baseR: number;
    let baseG: number;
    let baseB: number;
    let shade: number;
    let charMult = 1.0;

    if (isCustomColor) {
      baseR = ((rawCode >> 16) & 255) / 255;
      baseG = ((rawCode >> 8) & 255) / 255;
      baseB = (rawCode & 255) / 255;
      shade = faceShades[faceIdx] ?? 1.0;
    } else {
      const isDamagedBelow50 = (rawCode & 64) !== 0;
      const matId = rawCode & 63;
      const info = MAT_INFO[matId] || MAT_INFO[MAT.ROCK];
      const isEmissive = Boolean(info.emissive);
      shade = isEmissive ? 1.0 : faceShades[faceIdx];
      charMult = isDamagedBelow50 ? 0.32 : 1.0;
      baseR = ((info.color >> 16) & 255) / 255;
      baseG = ((info.color >> 8) & 255) / 255;
      baseB = (info.color & 255) / 255;
    }

    const pBase = vertCount * 3;
    BUF_POS[pBase] = v0x;
    BUF_POS[pBase + 1] = v0y;
    BUF_POS[pBase + 2] = v0z;
    BUF_POS[pBase + 3] = v1x;
    BUF_POS[pBase + 4] = v1y;
    BUF_POS[pBase + 5] = v1z;
    BUF_POS[pBase + 6] = v2x;
    BUF_POS[pBase + 7] = v2y;
    BUF_POS[pBase + 8] = v2z;
    BUF_POS[pBase + 9] = v3x;
    BUF_POS[pBase + 10] = v3y;
    BUF_POS[pBase + 11] = v3z;

    BUF_AO[vertCount] = ao0;
    BUF_AO[vertCount + 1] = ao1;
    BUF_AO[vertCount + 2] = ao2;
    BUF_AO[vertCount + 3] = ao3;

    for (let cv = 0; cv < 12; cv += 3) {
      BUF_NORM[pBase + cv] = nx;
      BUF_NORM[pBase + cv + 1] = ny;
      BUF_NORM[pBase + cv + 2] = nz;

      if (isCustomColor) {
        BUF_COL[pBase + cv] = Math.min(1, baseR * shade);
        BUF_COL[pBase + cv + 1] = Math.min(1, baseG * shade);
        BUF_COL[pBase + cv + 2] = Math.min(1, baseB * shade);
      } else {
        const matId = rawCode & 63;
        const vx = BUF_POS[pBase + cv];
        const vy = BUF_POS[pBase + cv + 1];
        const vz = BUF_POS[pBase + cv + 2];
        const w1 = Math.sin(vx * 0.42 + vz * 0.31 + vy * 0.25);
        const w2 = Math.cos(vx * 0.19 - vz * 0.37 + vy * 0.55);
        const micro = Math.sin(vx * 2.4 + vz * 2.4 + vy * 2.1);

        let vr = baseR;
        let vg = baseG;
        let vb = baseB;

        if (matId === MAT.GRASS) {
          const lush = w1 * 0.55 + w2 * 0.45;
          vr = Math.max(0.1, Math.min(0.48, baseR + lush * 0.14 + micro * 0.04));
          vg = Math.max(0.48, Math.min(0.92, baseG + lush * 0.18 + micro * 0.05));
          vb = Math.max(0.04, Math.min(0.28, baseB - lush * 0.04 + micro * 0.02));
        } else if (matId === MAT.ROCK || matId === MAT.CONCRETE || matId === MAT.ARMOR_SLATE) {
          const strata = Math.sin(vy * 1.35 + w1 * 0.8) * 0.08 + micro * 0.035;
          vr = Math.max(0.08, Math.min(1, baseR + strata));
          vg = Math.max(0.09, Math.min(1, baseG + strata * 1.05));
          vb = Math.max(0.11, Math.min(1, baseB + strata * 1.12));
        } else if (matId === MAT.SAND || matId === MAT.CANYON_ORANGE || matId === MAT.CANYON_RED) {
          const ripple = (w1 * 0.6 + Math.sin(vy * 1.8) * 0.4) * 0.09 + micro * 0.03;
          vr = Math.max(0.15, Math.min(1, baseR + ripple * 1.1));
          vg = Math.max(0.1, Math.min(1, baseG + ripple * 0.85));
          vb = Math.max(0.05, Math.min(1, baseB + ripple * 0.5));
        } else {
          const bev = micro * 0.045 + w1 * 0.035;
          vr = Math.max(0.05, Math.min(1, baseR + bev));
          vg = Math.max(0.05, Math.min(1, baseG + bev));
          vb = Math.max(0.05, Math.min(1, baseB + bev));
        }

        const jitter = computeVoxelColorJitter(
          Math.floor(vx / voxelSizeParam),
          Math.floor(vy / voxelSizeParam),
          Math.floor(vz / voxelSizeParam),
        );
        BUF_COL[pBase + cv] = Math.min(1, vr * shade * charMult * jitter);
        BUF_COL[pBase + cv + 1] = Math.min(1, vg * shade * charMult * jitter);
        BUF_COL[pBase + cv + 2] = Math.min(1, vb * shade * charMult * jitter);
      }
    }

    const flipAoDiag = ao0 + ao2 < ao1 + ao3;
    if (!flipWinding) {
      if (!flipAoDiag) {
        BUF_IDX[indexCount++] = vertCount;
        BUF_IDX[indexCount++] = vertCount + 1;
        BUF_IDX[indexCount++] = vertCount + 2;
        BUF_IDX[indexCount++] = vertCount;
        BUF_IDX[indexCount++] = vertCount + 2;
        BUF_IDX[indexCount++] = vertCount + 3;
      } else {
        BUF_IDX[indexCount++] = vertCount + 1;
        BUF_IDX[indexCount++] = vertCount + 2;
        BUF_IDX[indexCount++] = vertCount + 3;
        BUF_IDX[indexCount++] = vertCount + 1;
        BUF_IDX[indexCount++] = vertCount + 3;
        BUF_IDX[indexCount++] = vertCount;
      }
    } else {
      if (!flipAoDiag) {
        BUF_IDX[indexCount++] = vertCount;
        BUF_IDX[indexCount++] = vertCount + 2;
        BUF_IDX[indexCount++] = vertCount + 1;
        BUF_IDX[indexCount++] = vertCount;
        BUF_IDX[indexCount++] = vertCount + 3;
        BUF_IDX[indexCount++] = vertCount + 2;
      } else {
        BUF_IDX[indexCount++] = vertCount + 1;
        BUF_IDX[indexCount++] = vertCount + 3;
        BUF_IDX[indexCount++] = vertCount + 2;
        BUF_IDX[indexCount++] = vertCount + 1;
        BUF_IDX[indexCount++] = vertCount;
        BUF_IDX[indexCount++] = vertCount + 3;
      }
    }

    vertCount += 4;
    mergedQuads++;
  };

  // PASS 1: 2D Greedy Merge of Top Horizontal Faces (+Y, faceIdx = 2)
  for (let lz = 0; lz < dimsZ; lz++) {
    const rowOff = lz * dimsX;
    const hRowOff = lz << 6;
    for (let lx = 0; lx < dimsX; lx++) {
      const surfVY = surfaceHeightMap[lx + hRowOff];
      const matCode = getCellCode(lx, surfVY, lz);
      // Pack (surfVY + 1) and matCode if standard material; if customColor, disable merging across different heights
      if ((matCode & 0x40000000) !== 0) {
        MASK_2D[rowOff + lx] = matCode;
      } else {
        MASK_2D[rowOff + lx] = ((surfVY & 0x7ff) << 12) | (matCode & 0xfff);
      }
      rawFaces++;
    }
  }

  for (let lz = 0; lz < dimsZ; lz++) {
    for (let lx = 0; lx < dimsX; ) {
      const idx = lx + lz * dimsX;
      const key = MASK_2D[idx];
      if (key !== 0) {
        const surfVY = surfaceHeightMap[lx + (lz << 6)];
        const isCustom = (key & 0x40000000) !== 0;
        const matCode = isCustom ? key : key & 0xfff;

        let w = 1;
        while (
          lx + w < dimsX &&
          MASK_2D[idx + w] === key &&
          surfaceHeightMap[lx + w + (lz << 6)] === surfVY
        ) {
          w++;
        }

        let h = 1;
        let done = false;
        while (lz + h < dimsZ) {
          for (let k = 0; k < w; k++) {
            if (
              MASK_2D[idx + k + h * dimsX] !== key ||
              surfaceHeightMap[lx + k + ((lz + h) << 6)] !== surfVY
            ) {
              done = true;
              break;
            }
          }
          if (done) break;
          h++;
        }

        const wy = offsetY + (surfVY + 1) * voxelSizeParam;
        const x0 = offsetX + lx * voxelSizeParam;
        const x1 = offsetX + (lx + w) * voxelSizeParam;
        const z0 = offsetZ + lz * voxelSizeParam;
        const z1 = offsetZ + (lz + h) * voxelSizeParam;

        emitQuad(
          x0, wy, z0,
          x0, wy, z1,
          x1, wy, z1,
          x1, wy, z0,
          0, 1, 0,
          2,
          matCode,
          false,
        );

        for (let dz = 0; dz < h; dz++) {
          const rBase = idx + dz * dimsX;
          for (let dx = 0; dx < w; dx++) {
            MASK_2D[rBase + dx] = 0;
          }
        }
        lx += w;
      } else {
        lx++;
      }
    }
  }

  // PASS 2: Exposed Vertical Step Walls (+X, -X, +Z, -Z) ONLY where surfVY > neighborVY
  const sampleSurfVY = (lx: number, lz: number, _fallbackVY: number): number => {
    if (lx >= 0 && lx < dimsX && lz >= 0 && lz < dimsZ) {
      return surfaceHeightMap[lx + (lz << 6)];
    }
    if (getBoundarySurfVY) {
      return getBoundarySurfVY(lx, lz);
    }
    // Conservative default when neighbor chunk data does not exist yet: render full boundary face!
    return 0;
  };

  // +X and -X step walls (merged along Z)
  for (let lx = 0; lx < dimsX; lx++) {
    // +X wall (normal 1, 0, 0, faceIdx = 0)
    for (let lz = 0; lz < dimsZ; ) {
      const surfVY = surfaceHeightMap[lx + (lz << 6)];
      const nVY = sampleSurfVY(lx + 1, lz, surfVY);
      if (surfVY > nVY) {
        const matCode = getCellCode(lx, surfVY, lz);
        let spanZ = 1;
        while (lz + spanZ < dimsZ) {
          const nextVY = surfaceHeightMap[lx + ((lz + spanZ) << 6)];
          const nextNVY = sampleSurfVY(lx + 1, lz + spanZ, nextVY);
          if (
            nextVY !== surfVY ||
            nextNVY !== nVY ||
            getCellCode(lx, nextVY, lz + spanZ) !== matCode
          ) {
            break;
          }
          spanZ++;
        }
        rawFaces += (surfVY - nVY) * spanZ;
        const wx = offsetX + (lx + 1) * voxelSizeParam;
        const y0 = offsetY + (nVY + 1) * voxelSizeParam;
        const y1 = offsetY + (surfVY + 1) * voxelSizeParam;
        const z0 = offsetZ + lz * voxelSizeParam;
        const z1 = offsetZ + (lz + spanZ) * voxelSizeParam;
        emitQuad(
          wx, y0, z0,
          wx, y1, z0,
          wx, y1, z1,
          wx, y0, z1,
          1, 0, 0,
          0,
          matCode,
          false,
          0.78, 1.0, 1.0, 0.78,
        );
        lz += spanZ;
      } else {
        lz++;
      }
    }

    // -X wall (normal -1, 0, 0, faceIdx = 1)
    for (let lz = 0; lz < dimsZ; ) {
      const surfVY = surfaceHeightMap[lx + (lz << 6)];
      const nVY = sampleSurfVY(lx - 1, lz, surfVY);
      if (surfVY > nVY) {
        const matCode = getCellCode(lx, surfVY, lz);
        let spanZ = 1;
        while (lz + spanZ < dimsZ) {
          const nextVY = surfaceHeightMap[lx + ((lz + spanZ) << 6)];
          const nextNVY = sampleSurfVY(lx - 1, lz + spanZ, nextVY);
          if (
            nextVY !== surfVY ||
            nextNVY !== nVY ||
            getCellCode(lx, nextVY, lz + spanZ) !== matCode
          ) {
            break;
          }
          spanZ++;
        }
        rawFaces += (surfVY - nVY) * spanZ;
        const wx = offsetX + lx * voxelSizeParam;
        const y0 = offsetY + (nVY + 1) * voxelSizeParam;
        const y1 = offsetY + (surfVY + 1) * voxelSizeParam;
        const z0 = offsetZ + lz * voxelSizeParam;
        const z1 = offsetZ + (lz + spanZ) * voxelSizeParam;
        emitQuad(
          wx, y0, z0,
          wx, y1, z0,
          wx, y1, z1,
          wx, y0, z1,
          -1, 0, 0,
          1,
          matCode,
          true,
          0.78, 1.0, 1.0, 0.78,
        );
        lz += spanZ;
      } else {
        lz++;
      }
    }
  }

  // +Z and -Z step walls (merged along X)
  for (let lz = 0; lz < dimsZ; lz++) {
    const hRowOff = lz << 6;
    // +Z wall (normal 0, 0, 1, faceIdx = 4)
    for (let lx = 0; lx < dimsX; ) {
      const surfVY = surfaceHeightMap[lx + hRowOff];
      const nVY = sampleSurfVY(lx, lz + 1, surfVY);
      if (surfVY > nVY) {
        const matCode = getCellCode(lx, surfVY, lz);
        let spanX = 1;
        while (lx + spanX < dimsX) {
          const nextVY = surfaceHeightMap[lx + spanX + hRowOff];
          const nextNVY = sampleSurfVY(lx + spanX, lz + 1, nextVY);
          if (
            nextVY !== surfVY ||
            nextNVY !== nVY ||
            getCellCode(lx + spanX, nextVY, lz) !== matCode
          ) {
            break;
          }
          spanX++;
        }
        rawFaces += (surfVY - nVY) * spanX;
        const wz = offsetZ + (lz + 1) * voxelSizeParam;
        const x0 = offsetX + lx * voxelSizeParam;
        const x1 = offsetX + (lx + spanX) * voxelSizeParam;
        const y0 = offsetY + (nVY + 1) * voxelSizeParam;
        const y1 = offsetY + (surfVY + 1) * voxelSizeParam;
        emitQuad(
          x0, y0, wz,
          x1, y0, wz,
          x1, y1, wz,
          x0, y1, wz,
          0, 0, 1,
          4,
          matCode,
          false,
          0.78, 0.78, 1.0, 1.0,
        );
        lx += spanX;
      } else {
        lx++;
      }
    }

    // -Z wall (normal 0, 0, -1, faceIdx = 5)
    for (let lx = 0; lx < dimsX; ) {
      const surfVY = surfaceHeightMap[lx + hRowOff];
      const nVY = sampleSurfVY(lx, lz - 1, surfVY);
      if (surfVY > nVY) {
        const matCode = getCellCode(lx, surfVY, lz);
        let spanX = 1;
        while (lx + spanX < dimsX) {
          const nextVY = surfaceHeightMap[lx + spanX + hRowOff];
          const nextNVY = sampleSurfVY(lx + spanX, lz - 1, nextVY);
          if (
            nextVY !== surfVY ||
            nextNVY !== nVY ||
            getCellCode(lx + spanX, nextVY, lz) !== matCode
          ) {
            break;
          }
          spanX++;
        }
        rawFaces += (surfVY - nVY) * spanX;
        const wz = offsetZ + lz * voxelSizeParam;
        const x0 = offsetX + lx * voxelSizeParam;
        const x1 = offsetX + (lx + spanX) * voxelSizeParam;
        const y0 = offsetY + (nVY + 1) * voxelSizeParam;
        const y1 = offsetY + (surfVY + 1) * voxelSizeParam;
        emitQuad(
          x0, y0, wz,
          x1, y0, wz,
          x1, y1, wz,
          x0, y1, wz,
          0, 0, -1,
          5,
          matCode,
          true,
          0.78, 0.78, 1.0, 1.0,
        );
        lx += spanX;
      } else {
        lx++;
      }
    }
  }

  return {
    positions: useSubarray
      ? BUF_POS.subarray(0, vertCount * 3)
      : BUF_POS.slice(0, vertCount * 3),
    normals: useSubarray
      ? BUF_NORM.subarray(0, vertCount * 3)
      : BUF_NORM.slice(0, vertCount * 3),
    colors: useSubarray
      ? BUF_COL.subarray(0, vertCount * 3)
      : BUF_COL.slice(0, vertCount * 3),
    ao: useSubarray
      ? BUF_AO.subarray(0, vertCount)
      : BUF_AO.slice(0, vertCount),
    indices: useSubarray
      ? BUF_IDX.subarray(0, indexCount)
      : BUF_IDX.slice(0, indexCount),
    vertCount,
    indexCount,
    rawFaces,
    mergedQuads,
  };
}

/**
 * Ultra-fast 2D Top Water Surface Mesher:
 * Greedily merges both sea-level ocean/pond water (`waterVY`) and progressive dug-hole/trench water
 * at any elevation (`minWaterScanVY .. waterVY`) in a single 64x64 column pass (< 0.05ms)!
 */
export function greedyMeshWaterTopSurfaceOnly(
  dimsX: number,
  dimsY: number,
  dimsZ: number,
  waterVY: number,
  voxels: Uint8Array,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  voxelSizeParam = VOXEL_SIZE,
  useSubarray = false,
  minWaterScanVY?: number,
  surfaceHeightMap?: Uint16Array | Uint8Array,
): GreedyMeshArrays {
  let vertCount = 0;
  let indexCount = 0;
  let rawFaces = 0;
  let mergedQuads = 0;

  const totalCells = dimsX * dimsZ;
  if (totalCells > MASK_2D.length) {
    MASK_2D = new Int32Array(totalCells + 1024);
  }

  const isCompactSurfaceBuf = voxels.length < dimsX * dimsY * dimsZ;
  const compactYStride = isCompactSurfaceBuf
    ? Math.max(1, Math.floor(voxels.length / (dimsX * dimsZ)))
    : dimsY;
  const scanFloorVY =
    !isCompactSurfaceBuf && minWaterScanVY !== undefined
      ? Math.max(1, Math.min(waterVY, minWaterScanVY))
      : waterVY;

  let hasWater = false;
  for (let lz = 0; lz < dimsZ; lz++) {
    const rowOff = lz * dimsX;
    const zColOff = dimsY * lz;
    for (let lx = 0; lx < dimsX; lx++) {
      if (isCompactSurfaceBuf) {
        const m = voxels[lx + dimsX * (3 + compactYStride * lz)];
        if (m === MAT.WATER_VOX) {
          MASK_2D[rowOff + lx] = waterVY;
          rawFaces++;
          hasWater = true;
        } else {
          MASK_2D[rowOff + lx] = 0;
        }
      } else {
        const colBase = lx + dimsX * zColOff;
        if (voxels[colBase + dimsX * waterVY] === MAT.WATER_VOX) {
          MASK_2D[rowOff + lx] = waterVY;
          rawFaces++;
          hasWater = true;
        } else if (scanFloorVY < waterVY) {
          let foundVY = 0;
          for (let vy = waterVY - 1; vy >= scanFloorVY; vy--) {
            if (voxels[colBase + dimsX * vy] === MAT.WATER_VOX) {
              foundVY = vy;
              break;
            }
          }
          MASK_2D[rowOff + lx] = foundVY;
          if (foundVY > 0) {
            rawFaces++;
            hasWater = true;
          }
        } else {
          MASK_2D[rowOff + lx] = 0;
        }
      }
    }
  }

  // Expand sea-level water surface mask by up to 4.5m (18 voxels) into adjacent sloped beaches, shore banks, and roads
  // (up to WATER_VY + 2 = 14.75m; never into open air holes or >= 15.00m walls) so waves climb naturally onto shores & roads!
  if (hasWater) {
    let [frontierA, frontierB] = getWaterFrontierBuffers(totalCells);
    let frontierLen = 0;

    const canExpandWaterCell = (lx: number, lz: number, rowOff: number): boolean => {
      if (MASK_2D[rowOff + lx] !== 0) return false;
      if (isCompactSurfaceBuf) {
        if (voxels[lx + dimsX * (3 + compactYStride * lz)] === MAT.WATER_VOX) return false;
        if (surfaceHeightMap) {
          const sVY = surfaceHeightMap[rowOff + lx];
          if (sVY < waterVY || sVY > waterVY + 2) return false;
        }
      } else {
        const zColOff = dimsY * lz;
        const cellMat = voxels[lx + dimsX * (zColOff + waterVY)];
        if (cellMat === 0 || cellMat === MAT.WATER_VOX) return false;
        if (waterVY + 3 < dimsY && voxels[lx + dimsX * (zColOff + waterVY + 3)] !== 0) return false;
      }
      return true;
    };

    for (let lz = 0; lz < dimsZ; lz++) {
      const rowOff = lz * dimsX;
      for (let lx = 0; lx < dimsX; lx++) {
        if (!canExpandWaterCell(lx, lz, rowOff)) continue;
        const idx = rowOff + lx;
        const hasWaterNeighbor =
          (lx > 0 && MASK_2D[idx - 1] === waterVY) ||
          (lx + 1 < dimsX && MASK_2D[idx + 1] === waterVY) ||
          (lz > 0 && MASK_2D[idx - dimsX] === waterVY) ||
          (lz + 1 < dimsZ && MASK_2D[idx + dimsX] === waterVY);
        if (hasWaterNeighbor) {
          MASK_2D[idx] = -1;
          frontierA[frontierLen++] = idx;
        }
      }
    }
    for (let f = 0; f < frontierLen; f++) {
      MASK_2D[frontierA[f]] = waterVY;
    }

    for (let pass = 1; pass < 18 && frontierLen > 0; pass++) {
      let nextLen = 0;
      for (let f = 0; f < frontierLen; f++) {
        const cIdx = frontierA[f];
        const cz = Math.floor(cIdx / dimsX);
        const cx = cIdx - cz * dimsX;
        const rowOff = cz * dimsX;
        if (cx > 0 && canExpandWaterCell(cx - 1, cz, rowOff)) {
          MASK_2D[cIdx - 1] = waterVY;
          frontierB[nextLen++] = cIdx - 1;
        }
        if (cx + 1 < dimsX && canExpandWaterCell(cx + 1, cz, rowOff)) {
          MASK_2D[cIdx + 1] = waterVY;
          frontierB[nextLen++] = cIdx + 1;
        }
        if (cz > 0 && canExpandWaterCell(cx, cz - 1, rowOff - dimsX)) {
          MASK_2D[cIdx - dimsX] = waterVY;
          frontierB[nextLen++] = cIdx - dimsX;
        }
        if (cz + 1 < dimsZ && canExpandWaterCell(cx, cz + 1, rowOff + dimsX)) {
          MASK_2D[cIdx + dimsX] = waterVY;
          frontierB[nextLen++] = cIdx + dimsX;
        }
      }
      const tmp = frontierA;
      frontierA = frontierB;
      frontierB = tmp;
      frontierLen = nextLen;
    }
  }

  if (hasWater) {
    const info = MAT_INFO[MAT.WATER_VOX] || MAT_INFO[MAT.ROCK];
    const shade = _GREEDY_FACE_SHADES[2];
    const wg = (((info.color >> 8) & 255) / 255) * shade;
    const wb = Math.max(0.86, (((info.color & 255) / 255) * shade));

    for (let lz = 0; lz < dimsZ; lz++) {
      for (let lx = 0; lx < dimsX; ) {
        const idx = lx + lz * dimsX;
        const cellWaterVY = MASK_2D[idx];
        if (cellWaterVY > 0 && vertCount + 4 < MAX_VERTS) {
          const cellWX = offsetX + lx * voxelSizeParam;
          const cellWZ = offsetZ + lz * voxelSizeParam;
          const isPondCore = Math.hypot(cellWX - 65, cellWZ - -85) < 17.5;
          const isHoleOrTrenchWater =
            cellWaterVY < waterVY || ((cellWX > -19.5 || cellWZ > 38.0) && !isPondCore);
          const isShoreSwash =
            cellWaterVY >= waterVY &&
            ((cellWX > -27.5 && cellWX < -19.5 && cellWZ < 38.0) ||
              (cellWX < -19.5 && Math.abs(cellWZ) < 7.0) ||
              (cellWX < -19.5 && cellWZ > 31.0 && cellWZ < 38.0));
          const maxWaterSpan = cellWaterVY < waterVY ? 8 : isShoreSwash ? 1 : 2;
          const wr = isHoleOrTrenchWater ? 0.60 : 0.04;
          const wy = offsetY + (cellWaterVY + 1) * voxelSizeParam;

          let w = 1;
          while (w < maxWaterSpan && lx + w < dimsX && MASK_2D[idx + w] === cellWaterVY) w++;
          let h = 1;
          let done = false;
          while (h < maxWaterSpan && lz + h < dimsZ) {
            for (let k = 0; k < w; k++) {
              if (MASK_2D[idx + k + h * dimsX] !== cellWaterVY) {
                done = true;
                break;
              }
            }
            if (done) break;
            h++;
          }

          const x0 = offsetX + lx * voxelSizeParam;
          const x1 = offsetX + (lx + w) * voxelSizeParam;
          const z0 = offsetZ + lz * voxelSizeParam;
          const z1 = offsetZ + (lz + h) * voxelSizeParam;

          ensureGreedyVertexCapacity(vertCount + 4);
          const pBase = vertCount * 3;
          BUF_POS[pBase] = x0;
          BUF_POS[pBase + 1] = wy;
          BUF_POS[pBase + 2] = z0;
          BUF_POS[pBase + 3] = x0;
          BUF_POS[pBase + 4] = wy;
          BUF_POS[pBase + 5] = z1;
          BUF_POS[pBase + 6] = x1;
          BUF_POS[pBase + 7] = wy;
          BUF_POS[pBase + 8] = z1;
          BUF_POS[pBase + 9] = x1;
          BUF_POS[pBase + 10] = wy;
          BUF_POS[pBase + 11] = z0;

          for (let cv = 0; cv < 12; cv += 3) {
            BUF_NORM[pBase + cv] = 0;
            BUF_NORM[pBase + cv + 1] = 1;
            BUF_NORM[pBase + cv + 2] = 0;
            BUF_COL[pBase + cv] = wr;
            BUF_COL[pBase + cv + 1] = wg;
            BUF_COL[pBase + cv + 2] = wb;
          }

          BUF_IDX[indexCount++] = vertCount;
          BUF_IDX[indexCount++] = vertCount + 1;
          BUF_IDX[indexCount++] = vertCount + 2;
          BUF_IDX[indexCount++] = vertCount;
          BUF_IDX[indexCount++] = vertCount + 2;
          BUF_IDX[indexCount++] = vertCount + 3;

          vertCount += 4;
          mergedQuads++;

          for (let dz = 0; dz < h; dz++) {
            const rBase = idx + dz * dimsX;
            for (let dx = 0; dx < w; dx++) {
              MASK_2D[rBase + dx] = 0;
            }
          }
          lx += w;
        } else {
          lx++;
        }
      }
    }
  }

  return {
    positions: useSubarray
      ? BUF_POS.subarray(0, vertCount * 3)
      : BUF_POS.slice(0, vertCount * 3),
    normals: useSubarray
      ? BUF_NORM.subarray(0, vertCount * 3)
      : BUF_NORM.slice(0, vertCount * 3),
    colors: useSubarray
      ? BUF_COL.subarray(0, vertCount * 3)
      : BUF_COL.slice(0, vertCount * 3),
    indices: useSubarray
      ? BUF_IDX.subarray(0, indexCount)
      : BUF_IDX.slice(0, indexCount),
    vertCount,
    indexCount,
    rawFaces,
    mergedQuads,
  };
}


/**
 * Rotates a 3D relative coordinate (dx, dy, dz) in 90-degree increments around the chosen axis:
 * - 'yaw'   (Y-axis): (x, y, z) -> ( z,  y, -x)
 * - 'pitch' (X-axis): (x, y, z) -> ( x, -z,  y)
 * - 'roll'  (Z-axis): (x, y, z) -> (-y,  x,  z)
 */
export function rotatePoint3D90(
  dx: number,
  dy: number,
  dz: number,
  axis: RotationAxis,
  steps = 1,
): Vec3 {
  const s = ((steps % 4) + 4) % 4;
  let x = dx;
  let y = dy;
  let z = dz;
  for (let i = 0; i < s; i++) {
    if (axis === 'yaw') {
      const nx = z;
      const nz = -x;
      x = nx;
      z = nz;
    } else if (axis === 'pitch') {
      const ny = -z;
      const nz = y;
      y = ny;
      z = nz;
    } else {
      const nx = -y;
      const ny = x;
      x = nx;
      y = ny;
    }
  }
  return { x: x + 0, y: y + 0, z: z + 0 };
}

/**
 * Computes a smooth subterranean cave atmosphere factor in [0.0 .. 1.0]
 * based on camera elevation relative to the surface terrain and whether a solid cave roof is overhead.
 */
export function computeCaveAtmosphereFactor(
  camY: number,
  surfY: number,
  hasOverheadRoof: boolean,
): number {
  const depthBelowSurf = surfY - camY;
  if (!hasOverheadRoof) {
    if (depthBelowSurf <= 1.5) return 0;
    // Descending into open cave entrance trench: gentle atmospheric dimming up to 0.32
    return Math.min(0.32, (depthBelowSurf - 1.5) / 8.0);
  }
  if (depthBelowSurf <= 0.3) return 0.15;
  return Math.max(0, Math.min(1.0, 0.35 + (depthBelowSurf - 0.3) / 3.2));
}

export interface SelectableBuildObject {
  kind: 'module' | 'voxel';
  vx: number;
  vy: number;
  vz: number;
  moduleKind?: ModuleKind;
  yawIdx?: number;
  pitchIdx?: number;
  rollIdx?: number;
  mat?: number;
  config?: ModuleTuningConfig;
}

export function isSameBuildObjectCoord(
  a: SelectableBuildObject,
  b: SelectableBuildObject,
): boolean {
  return (
    a.kind === b.kind &&
    a.vx === b.vx &&
    a.vy === b.vy &&
    a.vz === b.vz
  );
}

export function isSameBuildObjectType(
  a: SelectableBuildObject,
  b: SelectableBuildObject,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'module') {
    return Boolean(a.moduleKind) && a.moduleKind === b.moduleKind;
  }
  return Boolean(a.mat) && a.mat === b.mat;
}

export function findAllSameBuildObjects(
  target: SelectableBuildObject,
  allVehicleObjects: SelectableBuildObject[],
): SelectableBuildObject[] {
  return allVehicleObjects
    .filter((obj) => isSameBuildObjectType(target, obj))
    .map((obj) => ({
      ...obj,
      config: obj.config ? { ...obj.config } : undefined,
    }));
}

/**
 * Resolves Shift + Select on a vehicle object:
 * - If nothing is currently selected (or only that exact single object is selected),
 *   Shift-selecting an object selects ALL objects of the same type (moduleKind or voxel mat) on the vehicle!
 * - If 1 or more other objects are already selected, Shift-selecting toggles/adds the clicked object in the multi-selection.
 */
export function resolveShiftObjectSelection(
  currentSelection: SelectableBuildObject[],
  clickedObj: SelectableBuildObject,
  allVehicleObjects: SelectableBuildObject[],
): SelectableBuildObject[] {
  if (
    currentSelection.length === 0 ||
    (currentSelection.length === 1 &&
      isSameBuildObjectCoord(currentSelection[0], clickedObj))
  ) {
    const allSame = findAllSameBuildObjects(clickedObj, allVehicleObjects);
    return allSame.length > 0 ? allSame : [{ ...clickedObj }];
  }

  const existsIdx = currentSelection.findIndex((item) =>
    isSameBuildObjectCoord(item, clickedObj),
  );
  if (existsIdx >= 0) {
    return currentSelection.filter((_, idx) => idx !== existsIdx);
  }
  return [
    ...currentSelection,
    {
      ...clickedObj,
      config: clickedObj.config ? { ...clickedObj.config } : undefined,
    },
  ];
}

export function mergeBuildObjectSelections(
  existing: SelectableBuildObject[],
  incoming: SelectableBuildObject[],
): SelectableBuildObject[] {
  const result = existing.map((o) => ({
    ...o,
    config: o.config ? { ...o.config } : undefined,
  }));
  for (const inc of incoming) {
    if (!result.some((r) => isSameBuildObjectCoord(r, inc))) {
      result.push({
        ...inc,
        config: inc.config ? { ...inc.config } : undefined,
      });
    }
  }
  return result;
}

export function filterObjectsInScreenBox<T extends SelectableBuildObject>(
  candidates: Array<{
    obj: T;
    screenX: number;
    screenY: number;
    inFront: boolean;
  }>,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): T[] {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const selected: T[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c.inFront) continue;
    if (
      c.screenX >= minX &&
      c.screenX <= maxX &&
      c.screenY >= minY &&
      c.screenY <= maxY
    ) {
      selected.push(c.obj);
    }
  }
  return selected;
}

/**
 * Finds the index and distance (in meters) of the creation closest to a reference world position
 * so Build [B], Repair [G], Upright [R], and Drive [E] target the nearest creation!
 */
export function findClosestCreationIndex(
  refPos: { x: number; y: number; z: number },
  creationPositions: ReadonlyArray<{ x: number; y: number; z: number }>,
): { closestIndex: number; distanceMeters: number } {
  if (creationPositions.length === 0) {
    return { closestIndex: 0, distanceMeters: 0 };
  }
  let bestIdx = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < creationPositions.length; i++) {
    const p = creationPositions[i];
    const dx = p.x - refPos.x;
    const dy = p.y - refPos.y;
    const dz = p.z - refPos.z;
    const dSq = dx * dx + dy * dy + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }
  return {
    closestIndex: bestIdx,
    distanceMeters: Math.sqrt(bestDistSq),
  };
}

export interface VoxelWaveLineState {
  cx: number;
  cz: number;
  dirX: number;
  dirZ: number;
  lengthVoxels: number;
  speed: number;
  phase: number;
  cooldown: number;
}

export interface VoxelWaveStepResult {
  reflected: boolean;
  hitKind: 'none' | 'land' | 'creation';
  hitX: number;
  hitZ: number;
  normalX: number;
  normalZ: number;
}

/**
 * Advances a moving line of water voxels across the water surface and reflects its travel direction
 * when colliding with solid land/shoreline OR any player creation!
 */
export function stepVoxelWaveLine(
  wave: VoxelWaveLineState,
  dt: number,
  isWaterAt: (wx: number, wz: number) => boolean,
  checkCreationHit: (
    wx: number,
    wz: number,
  ) => { hit: boolean; normalX: number; normalZ: number } | null,
): VoxelWaveStepResult {
  wave.phase += dt * 3.8;
  if (wave.cooldown > 0) {
    wave.cooldown = Math.max(0, wave.cooldown - dt);
  }

  const lenNorm = Math.hypot(wave.dirX, wave.dirZ) || 1;
  wave.dirX /= lenNorm;
  wave.dirZ /= lenNorm;

  const perpX = -wave.dirZ;
  const perpZ = wave.dirX;
  const halfSpanMeters = (wave.lengthVoxels * VOXEL_SIZE) * 0.5;

  const stepDist = wave.speed * dt;
  const nextX = wave.cx + wave.dirX * stepDist;
  const nextZ = wave.cz + wave.dirZ * stepDist;
  const probeAhead = Math.max(VOXEL_SIZE * 1.4, stepDist + VOXEL_SIZE);

  // Sample 3 points along the leading edge of the voxel wave line (center, left tip, right tip)
  const sampleOffsets = [0, -halfSpanMeters * 0.75, halfSpanMeters * 0.75];

  if (wave.cooldown <= 0) {
    // 1. Check collision against any player creation in the water
    for (const latOff of sampleOffsets) {
      const px = nextX + wave.dirX * probeAhead + perpX * latOff;
      const pz = nextZ + wave.dirZ * probeAhead + perpZ * latOff;
      const creationCol = checkCreationHit(px, pz);
      if (creationCol && creationCol.hit) {
        let nx = creationCol.normalX;
        let nz = creationCol.normalZ;
        const nLen = Math.hypot(nx, nz);
        if (nLen < 1e-4) {
          nx = -wave.dirX;
          nz = -wave.dirZ;
        } else {
          nx /= nLen;
          nz /= nLen;
        }
        const dot = wave.dirX * nx + wave.dirZ * nz;
        if (dot < 0) {
          wave.dirX = wave.dirX - 2 * dot * nx;
          wave.dirZ = wave.dirZ - 2 * dot * nz;
        } else {
          wave.dirX = -wave.dirX;
          wave.dirZ = -wave.dirZ;
        }
        const rLen = Math.hypot(wave.dirX, wave.dirZ) || 1;
        wave.dirX /= rLen;
        wave.dirZ /= rLen;
        wave.cx += wave.dirX * (VOXEL_SIZE * 0.8);
        wave.cz += wave.dirZ * (VOXEL_SIZE * 0.8);
        wave.cooldown = 0.32;
        return {
          reflected: true,
          hitKind: 'creation',
          hitX: px,
          hitZ: pz,
          normalX: nx,
          normalZ: nz,
        };
      }
    }

    // 2. Check collision against solid land / shoreline
    for (const latOff of sampleOffsets) {
      const px = nextX + wave.dirX * probeAhead + perpX * latOff;
      const pz = nextZ + wave.dirZ * probeAhead + perpZ * latOff;
      if (!isWaterAt(px, pz)) {
        // Estimate shoreline outward normal pointing back toward water
        const eps = VOXEL_SIZE * 2.2;
        const wPosX = isWaterAt(px + eps, pz) ? 1 : 0;
        const wNegX = isWaterAt(px - eps, pz) ? 1 : 0;
        const wPosZ = isWaterAt(px, pz + eps) ? 1 : 0;
        const wNegZ = isWaterAt(px, pz - eps) ? 1 : 0;
        let nx = wPosX - wNegX;
        let nz = wPosZ - wNegZ;
        const nLen = Math.hypot(nx, nz);
        if (nLen > 1e-4) {
          nx /= nLen;
          nz /= nLen;
          const dot = wave.dirX * nx + wave.dirZ * nz;
          if (dot < -0.05) {
            wave.dirX = wave.dirX - 2 * dot * nx;
            wave.dirZ = wave.dirZ - 2 * dot * nz;
          } else {
            wave.dirX = -wave.dirX;
            wave.dirZ = -wave.dirZ;
          }
        } else {
          nx = -wave.dirX;
          nz = -wave.dirZ;
          wave.dirX = -wave.dirX;
          wave.dirZ = -wave.dirZ;
        }
        const rLen = Math.hypot(wave.dirX, wave.dirZ) || 1;
        wave.dirX /= rLen;
        wave.dirZ /= rLen;
        wave.cx += wave.dirX * (VOXEL_SIZE * 0.8);
        wave.cz += wave.dirZ * (VOXEL_SIZE * 0.8);
        wave.cooldown = 0.32;
        return {
          reflected: true,
          hitKind: 'land',
          hitX: px,
          hitZ: pz,
          normalX: nx,
          normalZ: nz,
        };
      }
    }
  }

  wave.cx = nextX;
  wave.cz = nextZ;
  return {
    reflected: false,
    hitKind: 'none',
    hitX: nextX,
    hitZ: nextZ,
    normalX: 0,
    normalZ: 0,
  };
}

/**
 * 10-Color Ocean & Surf Gradient Palette (from deep abyssal indigo through vibrant blues/cyans to pure white seafoam)
 */
export const WATER_WAVE_PALETTE_HEX: ReadonlyArray<number> = [
  0x04153b, // 0: Deep Abyssal Indigo (deepest trough)
  0x08286b, // 1: Dark Sapphire Navy
  0x0c3e99, // 2: Midnight Marine Blue
  0x0258c9, // 3: Royal Ocean Blue
  0x0077e6, // 4: Cerulean Swell
  0x0099ff, // 5: Vibrant Azure Blue
  0x1cb8ff, // 6: Tropical Cyan-Blue
  0x5ce1ff, // 7: Aquamarine Surf
  0xb8f2ff, // 8: Frosted Ice-Blue Crest
  0xffffff, // 9: Crisp White Seafoam
];

export interface GerstnerWaveSample {
  rawH: number;
  terracedH: number;
  slopeX: number;
  slopeZ: number;
  orbitalVx: number;
  orbitalVy: number;
  orbitalVz: number;
  colorIndex: number;
}

/**
 * Pure O(1) analytical Gerstner wave evaluator returning elevation, terraced voxel height,
 * surface slopes (dH/dx, dH/dz), 3D orbital water velocity, and 10-band color index (0..9).
 */
export function evaluateGerstnerWaveSample(
  wx: number,
  wz: number,
  time: number,
  deepOceanDist = 0.0,
  isPondOrRiver = false,
  edgeFade = 1.0,
  out?: GerstnerWaveSample,
): GerstnerWaveSample {
  const k1 = (2 * Math.PI) / 28.0;
  const k2 = (2 * Math.PI) / 40.0;
  const k3 = (2 * Math.PI) / 14.0;

  const w1 = 0.85 * time;
  const w2 = 1.15 * time;
  const w3 = 1.55 * time;

  const phase1 = k1 * (0.85 * wx + 0.52 * wz) - w1;
  const phase2 = k2 * (0.62 * wx - 0.78 * wz) - w2;
  const phase3 = k3 * (-0.40 * wx + 0.91 * wz) - w3;

  const c1 = Math.cos(phase1);
  const s1 = Math.sin(phase1);
  const c2 = Math.cos(phase2);
  const s2 = Math.sin(phase2);
  const c3 = Math.cos(phase3);
  const s3 = Math.sin(phase3);

  const signedWave = 0.65 * c1 + 0.35 * c2 + 0.14 * c3;
  // Normalize trough-to-crest into [0 .. 1] so the lowest wave trough sits directly on top of the static water surface!
  const norm = Math.max(0, Math.min(1, (signedWave + 0.92) / 1.84));

  // Coastal waves are 1.0m to 1.5m tall; out in the deep ocean, swells grow up to 6.0x (10-12m / 40-50 voxels tall) and ARE 100% VISIBLE!
  const swellEnvelope = Math.cos(wx * 0.037 + wz * 0.029 - time * 0.42) * 0.5 + 0.5;
  const baseOceanPeak = 1.0 + 0.5 * swellEnvelope;
  const waveMult = isPondOrRiver ? 1.0 : Math.min(6.0, 1.0 + Math.max(0, deepOceanDist) / 120.0);
  const peakMeters = isPondOrRiver ? 0.75 : baseOceanPeak * waveMult;

  const rawH = (0.03 + norm * (peakMeters - 0.03)) * edgeFade;

  // Quantize to half-voxel (0.125m) steps so distinct elevation bands are smoothly represented and strictly above static water
  const halfVox = VOXEL_SIZE * 0.5;
  const stepIdx = Math.max(1, Math.round(rawH / halfVox));
  const terracedH = stepIdx * halfVox;

  const ampScale = (peakMeters / 1.84) * edgeFade;
  const a1 = 0.65 * ampScale;
  const a2 = 0.35 * ampScale;
  const a3 = 0.14 * ampScale;

  // Spatial derivatives dH/dx and dH/dz for wave normal & slope surge force
  const slopeX =
    -a1 * k1 * 0.85 * s1 -
    a2 * k2 * 0.62 * s2 -
    a3 * k3 * -0.40 * s3;
  const slopeZ =
    -a1 * k1 * 0.52 * s1 -
    a2 * k2 * -0.78 * s2 -
    a3 * k3 * 0.91 * s3;

  // Orbital water particle velocity (u_x, u_y, u_z) for realistic vehicle wave push & heave
  const orbitalVx =
    (0.85 * a1 * 0.85 * c1 + 0.62 * a2 * 1.15 * c2 - 0.40 * a3 * 1.55 * c3) * 1.75;
  const orbitalVz =
    (0.52 * a1 * 0.85 * c1 - 0.78 * a2 * 1.15 * c2 + 0.91 * a3 * 1.55 * c3) * 1.75;
  const orbitalVy =
    a1 * 0.85 * s1 + a2 * 1.15 * s2 + a3 * 1.55 * s3;

  // In deep ocean, shift trough colors toward dark abyssal indigo (0..2) while keeping sharp whitecap crests (8..9)
  const normDeepProgress = Math.min(1.0, deepOceanDist / 900.0);
  const effectiveNorm =
    normDeepProgress > 0
      ? Math.pow(norm, 1.0 + normDeepProgress * 0.85)
      : norm;
  const colorIndex = Math.max(0, Math.min(9, Math.floor(effectiveNorm * 10)));

  if (out) {
    out.rawH = rawH;
    out.terracedH = terracedH;
    out.slopeX = slopeX;
    out.slopeZ = slopeZ;
    out.orbitalVx = orbitalVx;
    out.orbitalVy = orbitalVy;
    out.orbitalVz = orbitalVz;
    out.colorIndex = colorIndex;
    return out;
  }
  return {
    rawH,
    terracedH,
    slopeX,
    slopeZ,
    orbitalVx,
    orbitalVy,
    orbitalVz,
    colorIndex,
  };
}

export interface HullBuoyancyResult {
  isSubmerged: boolean;
  subDepth: number;
  buoyUp: number;
  waveSlopeFx: number;
  waveSlopeFz: number;
  dampingForceY: number;
}

/**
 * Analytical hydrostatic buoyancy evaluator for vehicle hull samples with:
 * - Controlled buoyancy force so vehicles sit calmly in the water without trampoline bouncing.
 * - Heavy critical vertical damping to absorb wave impacts smoothly and keep boats grounded on waves.
 */
export function computeHullPointBuoyancy(
  pointWorldY: number,
  effWaterY: number,
  dispKg: number,
  sampleMassKg: number,
  relVy: number,
  slopeX: number,
  slopeZ: number,
  out?: HullBuoyancyResult,
): HullBuoyancyResult {
  if (pointWorldY >= effWaterY + 0.15) {
    if (out) {
      out.isSubmerged = false;
      out.subDepth = 0;
      out.buoyUp = 0;
      out.waveSlopeFx = 0;
      out.waveSlopeFz = 0;
      out.dampingForceY = 0;
      return out;
    }
    return {
      isSubmerged: false,
      subDepth: 0,
      buoyUp: 0,
      waveSlopeFx: 0,
      waveSlopeFz: 0,
      dampingForceY: 0,
    };
  }

  const subDepth = Math.max(0, effWaterY - pointWorldY + 0.08);
  const nominalDraft = 0.55;
  // Gentle, smooth linear / progressive restoring curve to prevent upward popping/bouncing
  const subRatio = Math.min(
    1.4,
    subDepth <= nominalDraft
      ? subDepth / nominalDraft
      : 1.0 + (subDepth - nominalDraft) * 0.35,
  );

  const effBuoyMass = Math.max(dispKg * 0.65, sampleMassKg * 0.80);
  const G = 9.81;
  // High vertical damping absorbs vertical oscillations instantly so the vehicle rides waves without bouncing!
  const critDamp = Math.sqrt(effBuoyMass * G * 14.0);
  const vertDampCoeff = relVy > 0 ? critDamp * 2.4 : critDamp * 4.2;
  const dampingForceY = relVy * vertDampCoeff;
  const buoyUp = Math.max(0, effBuoyMass * G * subRatio - dampingForceY);

  const waveSlopeFx = -slopeX * effBuoyMass * G * 0.15;
  const waveSlopeFz = -slopeZ * effBuoyMass * G * 0.15;

  if (out) {
    out.isSubmerged = true;
    out.subDepth = subDepth;
    out.buoyUp = buoyUp;
    out.waveSlopeFx = waveSlopeFx;
    out.waveSlopeFz = waveSlopeFz;
    out.dampingForceY = dampingForceY;
    return out;
  }
  return {
    isSubmerged: true,
    subDepth,
    buoyUp,
    waveSlopeFx,
    waveSlopeFz,
    dampingForceY,
  };
}

export interface CharacterVehicleCollisionResult {
  collided: boolean;
  pushOutX: number;
  pushOutZ: number;
  contactHeight: number;
}

const _NO_CHAR_COLLISION: CharacterVehicleCollisionResult = {
  collided: false,
  pushOutX: 0,
  pushOutZ: 0,
  contactHeight: 0,
};
const _CHAR_COLLISION_RESULT: CharacterVehicleCollisionResult = {
  collided: true,
  pushOutX: 0,
  pushOutZ: 0,
  contactHeight: 0,
};

const _ZERO_VEC3: Vec3 = { x: 0, y: 0, z: 0 };
const _NO_VEHICLE_COLLISION: VehicleVehicleCollisionResult = {
  hasCollision: false,
  normal: _ZERO_VEC3,
  penetration: 0,
  contactPoint: _ZERO_VEC3,
  relativeSpeed: 0,
  impulseA: _ZERO_VEC3,
  impulseB: _ZERO_VEC3,
  torqueA: _ZERO_VEC3,
  torqueB: _ZERO_VEC3,
  separateA: _ZERO_VEC3,
  separateB: _ZERO_VEC3,
};
const _VEHICLE_COLLISION_RESULT: VehicleVehicleCollisionResult = {
  hasCollision: true,
  normal: { x: 0, y: 0, z: 0 },
  penetration: 0,
  contactPoint: { x: 0, y: 0, z: 0 },
  relativeSpeed: 0,
  impulseA: { x: 0, y: 0, z: 0 },
  impulseB: { x: 0, y: 0, z: 0 },
  torqueA: { x: 0, y: 0, z: 0 },
  torqueB: { x: 0, y: 0, z: 0 },
  separateA: { x: 0, y: 0, z: 0 },
  separateB: { x: 0, y: 0, z: 0 },
};

/**
 * Resolves horizontal collision between a walking player character cylinder and a vehicle's oriented bounding box.
 * Prevents the player from walking or clipping through vehicles.
 */
export function resolveCharacterVehicleCollision(
  playerPos: Vec3,
  playerRadius: number,
  playerHeight: number,
  vehPos: Vec3,
  vehYaw: number,
  halfWidth: number,
  halfHeight: number,
  halfLength: number,
): CharacterVehicleCollisionResult {
  // Transform player position into vehicle local 2D horizontal space (rotated by -vehYaw around Y)
  const cosY = Math.cos(-vehYaw);
  const sinY = Math.sin(-vehYaw);
  const relX = playerPos.x - vehPos.x;
  const relY = playerPos.y - vehPos.y;
  const relZ = playerPos.z - vehPos.z;

  // Check vertical overlap
  if (relY + playerHeight < -halfHeight || relY > halfHeight + 0.4) {
    return _NO_CHAR_COLLISION;
  }

  const localX = relX * cosY - relZ * sinY;
  const localZ = relX * sinY + relZ * cosY;

  // Expanded bounding box by character radius
  const minX = -halfWidth - playerRadius;
  const maxX = halfWidth + playerRadius;
  const minZ = -halfLength - playerRadius;
  const maxZ = halfLength + playerRadius;

  if (localX > minX && localX < maxX && localZ > minZ && localZ < maxZ) {
    // Overlapping! Find minimal pushout to closest bounding box edge
    const distLeft = localX - minX;
    const distRight = maxX - localX;
    const distBack = localZ - minZ;
    const distFront = maxZ - localZ;

    const minDist = Math.min(distLeft, distRight, distBack, distFront);
    let pushLocalX = 0;
    let pushLocalZ = 0;

    if (minDist === distLeft) pushLocalX = -distLeft;
    else if (minDist === distRight) pushLocalX = distRight;
    else if (minDist === distBack) pushLocalZ = -distBack;
    else pushLocalZ = distFront;

    // Rotate local push vector back to world space
    const cosWorld = Math.cos(vehYaw);
    const sinWorld = Math.sin(vehYaw);
    _CHAR_COLLISION_RESULT.collided = true;
    _CHAR_COLLISION_RESULT.pushOutX = pushLocalX * cosWorld - pushLocalZ * sinWorld;
    _CHAR_COLLISION_RESULT.pushOutZ = pushLocalX * sinWorld + pushLocalZ * cosWorld;
    _CHAR_COLLISION_RESULT.contactHeight = vehPos.y + halfHeight;
    return _CHAR_COLLISION_RESULT;
  }

  return _NO_CHAR_COLLISION;
}

export interface VehicleVehicleCollisionResult {
  hasCollision: boolean;
  normal: Vec3;
  penetration: number;
  contactPoint: Vec3;
  relativeSpeed: number;
  impulseA: Vec3;
  impulseB: Vec3;
  torqueA: Vec3;
  torqueB: Vec3;
  separateA: Vec3;
  separateB: Vec3;
}

/**
 * Computes the directional horizontal support radius of an oriented bounding box (hx, hz)
 * along unit world-space direction (dirX, dirZ) given the box's yaw rotation.
 */
export function computeDirectionalObbRadius(
  halfWidthX: number,
  halfLengthZ: number,
  yawRad: number,
  dirX: number,
  dirZ: number,
): number {
  const hx = Math.max(0.5, halfWidthX);
  const hz = Math.max(0.5, halfLengthZ);
  const cosY = Math.cos(-yawRad);
  const sinY = Math.sin(-yawRad);
  const localDx = Math.abs(dirX * cosY - dirZ * sinY);
  const localDz = Math.abs(dirX * sinY + dirZ * cosY);
  const denom = Math.hypot(hx * localDz, hz * localDx);
  return denom > 1e-4 ? (hx * hz) / denom : Math.min(hx, hz);
}

/**
 * Calculates collision detection, physical separation, and mass-scaled velocity/angular-velocity
 * impulse exchange between two vehicles.
 * Note: `impulseA` and `impulseB` are returned as velocity deltas (m/s, already divided by massA / massB),
 * and `torqueA` and `torqueB` are returned as angular velocity deltas (rad/s, already divided by rotational inertia).
 */
export function resolveVehicleVehicleCollision(
  posA: Vec3,
  velA: Vec3,
  massA: number,
  halfExtentsA: Vec3,
  posB: Vec3,
  velB: Vec3,
  massB: number,
  halfExtentsB: Vec3,
  restitution = 0.25,
  yawA = 0,
  yawB = 0,
): VehicleVehicleCollisionResult {
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const dz = posB.z - posA.z;

  const distSq = dx * dx + dz * dz;
  const dist = Math.max(0.01, Math.sqrt(distSq));
  const dirX = distSq > 1e-6 ? dx / dist : 0;
  const dirZ = distSq > 1e-6 ? dz / dist : 1;

  const radA = computeDirectionalObbRadius(
    halfExtentsA.x,
    halfExtentsA.z,
    yawA,
    dirX,
    dirZ,
  );
  const radB = computeDirectionalObbRadius(
    halfExtentsB.x,
    halfExtentsB.z,
    yawB,
    -dirX,
    -dirZ,
  );
  const totalRadius = radA + radB;

  // Fast horizontal & vertical bounding reject
  if (
    distSq > totalRadius * totalRadius ||
    Math.abs(dy) > halfExtentsA.y + halfExtentsB.y + 0.6
  ) {
    return _NO_VEHICLE_COLLISION;
  }

  // Keep vehicle-to-vehicle collision normal strictly horizontal so cars never launch each other into the sky!
  const normX = dirX;
  const normY = 0;
  const normZ = dirZ;

  const penetration = Math.max(0.01, totalRadius - dist);

  // Relative horizontal velocity of B relative to A
  const relVx = velB.x - velA.x;
  const relVy = velB.y - velA.y;
  const relVz = velB.z - velA.z;
  const relSpeedNorm = relVx * normX + relVz * normZ;

  // Separation displacement inversely proportional to mass (horizontal only!)
  const safeMassA = Math.max(150, massA);
  const safeMassB = Math.max(150, massB);
  const totalMass = safeMassA + safeMassB;
  const ratioA = safeMassB / totalMass;
  const ratioB = safeMassA / totalMass;
  const sepDist = Math.min(0.6, penetration * 0.85);

  let dvMagA = 0;
  let dvMagB = 0;
  if (relSpeedNorm < -0.05) {
    const effectiveRestitution = Math.max(0.05, Math.min(0.3, restitution * 0.5));
    const reducedMass = (safeMassA * safeMassB) / totalMass;
    const rawImpulseJ = -(1.0 + effectiveRestitution) * relSpeedNorm * reducedMass;
    dvMagA = Math.min(11.5, (rawImpulseJ / safeMassA) * 0.72);
    dvMagB = Math.min(11.5, (rawImpulseJ / safeMassB) * 0.72);
  }

  const res = _VEHICLE_COLLISION_RESULT;
  res.hasCollision = true;
  res.normal.x = normX;
  res.normal.y = normY;
  res.normal.z = normZ;
  res.penetration = penetration;
  res.contactPoint.x = posA.x + normX * (radA - penetration * 0.5);
  res.contactPoint.y = (posA.y + posB.y) * 0.5;
  res.contactPoint.z = posA.z + normZ * (radA - penetration * 0.5);
  res.relativeSpeed = Math.hypot(relVx, relVy, relVz);

  res.separateA.x = -normX * sepDist * ratioA;
  res.separateA.y = 0;
  res.separateA.z = -normZ * sepDist * ratioA;

  res.separateB.x = normX * sepDist * ratioB;
  res.separateB.y = 0;
  res.separateB.z = normZ * sepDist * ratioB;

  res.impulseA.x = -normX * dvMagA;
  res.impulseA.y = 0;
  res.impulseA.z = -normZ * dvMagA;

  res.impulseB.x = normX * dvMagB;
  res.impulseB.y = 0;
  res.impulseB.z = -normZ * dvMagB;

  const armAx = res.contactPoint.x - posA.x;
  const armAz = res.contactPoint.z - posA.z;
  const armBx = res.contactPoint.x - posB.x;
  const armBz = res.contactPoint.z - posB.z;

  const invRadiusSqA = 1.0 / Math.max(2.5, radA * radA);
  const invRadiusSqB = 1.0 / Math.max(2.5, radB * radB);

  const rawTorqueAY = (armAx * res.impulseA.z - armAz * res.impulseA.x) * invRadiusSqA * 0.22;
  const rawTorqueBY = (armBx * res.impulseB.z - armBz * res.impulseB.x) * invRadiusSqB * 0.22;

  res.torqueA.x = 0;
  res.torqueA.y = Math.max(-0.9, Math.min(0.9, rawTorqueAY));
  res.torqueA.z = 0;

  res.torqueB.x = 0;
  res.torqueB.y = Math.max(-0.9, Math.min(0.9, rawTorqueBY));
  res.torqueB.z = 0;

  return res;
}

/**
 * Predictive Dead-Reckoning state extrapolation for remote multiplayer vehicles.
 * Projects the last authoritative network position forward along `linVel` (clamped to `maxExtrapolationSec`)
 * so fast-moving remote vehicles do not lag behind their true position between 20Hz network ticks.
 */
export function computeDeadReckonedTargetPos(
  targetPos: Vec3,
  linVel: Vec3,
  packetAgeSec: number,
  maxExtrapolationSec = 0.12,
): Vec3 {
  const clampedAge = Math.max(0, Math.min(maxExtrapolationSec, packetAgeSec));
  return {
    x: targetPos.x + linVel.x * clampedAge,
    y: targetPos.y + linVel.y * clampedAge * 0.5, // damp vertical extrapolation to prevent ground clipping
    z: targetPos.z + linVel.z * clampedAge,
  };
}

/**
 * Computes a safe, non-overlapping spawn position when a player joins a multiplayer lobby
 * so their vehicle never spawns directly on top of an existing lobby vehicle.
 */
export function computeSafeMultiplayerSpawnSpot(
  desiredPos: Vec3,
  existingPositions: ReadonlyArray<Vec3>,
  minClearanceMeters = 7.5,
): { pos: Vec3; relocated: boolean } {
  const isClear = (candX: number, candZ: number): boolean => {
    for (let i = 0; i < existingPositions.length; i++) {
      const ep = existingPositions[i];
      const d = Math.hypot(candX - ep.x, candZ - ep.z);
      if (d < minClearanceMeters) return false;
    }
    return true;
  };

  if (isClear(desiredPos.x, desiredPos.z)) {
    return {
      pos: { x: desiredPos.x, y: desiredPos.y, z: desiredPos.z },
      relocated: false,
    };
  }

  // Search concentric lateral/diagonal spawn bay offsets around desiredPos
  const step = Math.max(8.0, minClearanceMeters + 1.0);
  const candidateOffsets: ReadonlyArray<[number, number]> = [
    [step, 0],
    [-step, 0],
    [0, -step],
    [0, step],
    [step, -step],
    [-step, -step],
    [step * 2, 0],
    [-step * 2, 0],
    [step, step],
    [-step, step],
  ];

  for (const [ox, oz] of candidateOffsets) {
    const cx = desiredPos.x + ox;
    const cz = desiredPos.z + oz;
    if (isClear(cx, cz)) {
      return {
        pos: { x: cx, y: desiredPos.y, z: cz },
        relocated: true,
      };
    }
  }

  return {
    pos: {
      x: desiredPos.x + step * (existingPositions.length + 1),
      y: desiredPos.y,
      z: desiredPos.z,
    },
    relocated: true,
  };
}

export interface CharacterAnimationPose {
  leftLegX: number;
  rightLegX: number;
  leftLegZ: number;
  rightLegZ: number;
  leftLegOffsetY: number;
  rightLegOffsetY: number;
  leftArmX: number;
  rightArmX: number;
  leftArmZ: number;
  rightArmZ: number;
  torsoOffsetY: number;
  torsoRotX: number;
  headRotX: number;
  toolActive: boolean;
}

/**
 * Calculates smooth procedural skeletal limb and torso angles for humanoid avatars across all states:
 * walking, running, idle breathing, seated vehicle driving, jumping, and build mode holograms.
 */
export function computeAvatarAnimationPose(
  walkPhase: number,
  moveSpeed: number,
  isDriving: boolean,
  isBuilding: boolean,
  isGrounded = true,
): CharacterAnimationPose {
  if (isDriving) {
    // Seated Driver pose: legs bent forward, arms gripping wheel
    return {
      leftLegX: Math.PI * 0.48,
      rightLegX: Math.PI * 0.48,
      leftLegZ: 0.14,
      rightLegZ: -0.14,
      leftLegOffsetY: 0.18,
      rightLegOffsetY: 0.18,
      leftArmX: -Math.PI * 0.36,
      rightArmX: -Math.PI * 0.36,
      leftArmZ: 0.16,
      rightArmZ: -0.16,
      torsoOffsetY: -0.12,
      torsoRotX: 0.08,
      headRotX: -0.05,
      toolActive: false,
    };
  }

  if (isBuilding) {
    // Build mode: right arm raised projecting building tool, slight levitation/sway
    const sway = Math.sin(walkPhase * 0.5) * 0.06;
    return {
      leftLegX: 0.08,
      rightLegX: -0.08,
      leftLegZ: 0.08,
      rightLegZ: -0.08,
      leftLegOffsetY: 0,
      rightLegOffsetY: 0,
      leftArmX: -0.22,
      rightArmX: -Math.PI * 0.42 + sway,
      leftArmZ: 0.18,
      rightArmZ: -0.24,
      torsoOffsetY: Math.sin(walkPhase * 0.8) * 0.04,
      torsoRotX: -0.04,
      headRotX: 0.12,
      toolActive: true,
    };
  }

  if (!isGrounded) {
    // Airborne / Jumping pose: legs spread slightly, arms up
    return {
      leftLegX: -0.32,
      rightLegX: 0.28,
      leftLegZ: 0.18,
      rightLegZ: -0.18,
      leftLegOffsetY: 0.08,
      rightLegOffsetY: 0.08,
      leftArmX: -0.85,
      rightArmX: -0.75,
      leftArmZ: 0.32,
      rightArmZ: -0.32,
      torsoOffsetY: 0.05,
      torsoRotX: -0.08,
      headRotX: -0.12,
      toolActive: false,
    };
  }

  if (moveSpeed > 0.15) {
    // Walking / Running: alternate leg swing & arm counter-swing + torso bounce
    const speedRatio = Math.min(1.8, Math.max(0.4, moveSpeed / 6.0));
    const swingMag = Math.min(0.85, 0.45 * speedRatio);
    const legSwing = Math.sin(walkPhase) * swingMag;
    const armSwing = Math.sin(walkPhase + Math.PI) * swingMag * 0.85;
    const bounceY = Math.abs(Math.sin(walkPhase * 2)) * 0.06 * speedRatio;

    return {
      leftLegX: legSwing,
      rightLegX: -legSwing,
      leftLegZ: 0,
      rightLegZ: 0,
      leftLegOffsetY: Math.max(0, -legSwing * 0.08),
      rightLegOffsetY: Math.max(0, legSwing * 0.08),
      leftArmX: armSwing,
      rightArmX: -armSwing,
      leftArmZ: 0.08,
      rightArmZ: -0.08,
      torsoOffsetY: bounceY,
      torsoRotX: 0.06 * speedRatio,
      headRotX: -0.03 * speedRatio,
      toolActive: false,
    };
  }

  // Idle breathing pose
  const breath = Math.sin(walkPhase * 0.75) * 0.03;
  return {
    leftLegX: 0,
    rightLegX: 0,
    leftLegZ: 0.04,
    rightLegZ: -0.04,
    leftLegOffsetY: 0,
    rightLegOffsetY: 0,
    leftArmX: breath * 0.5,
    rightArmX: breath * 0.5,
    leftArmZ: 0.06,
    rightArmZ: -0.06,
    torsoOffsetY: breath * 0.5,
    torsoRotX: 0,
    headRotX: breath * 0.3,
    toolActive: false,
  };
}

/**
 * Checks whether a walking/jetpacking player cylinder (radius = 0.28m) can move horizontally
 * to (nextX, nextZ) at current foot height `footY` without intersecting a solid wall above
 * `maxStepUp` (0.45m) up to player head height (`footY + 1.62m`).
 */
export function canPlayerMoveHorizontal(
  isSolidAtWorld: (wx: number, wy: number, wz: number) => boolean,
  nextX: number,
  footY: number,
  nextZ: number,
  radius = 0.28,
  maxStepUp = 0.45,
): boolean {
  const diag = radius * 0.7071;
  const sampleHeights = [
    footY + maxStepUp + 0.08,
    footY + 0.95,
    footY + 1.35,
    footY + 1.62,
  ];
  const offsets: Array<[number, number]> = [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
    [diag, diag],
    [diag, -diag],
    [-diag, diag],
    [-diag, -diag],
  ];
  for (let hIdx = 0; hIdx < sampleHeights.length; hIdx++) {
    const sampleY = sampleHeights[hIdx];
    for (let oIdx = 0; oIdx < offsets.length; oIdx++) {
      const [ox, oz] = offsets[oIdx];
      if (isSolidAtWorld(nextX + ox, sampleY, nextZ + oz)) {
        return false;
      }
    }
  }
  return true;
}

export interface PlayerJetpackStepInput {
  footY: number;
  groundY: number;
  playerVelY: number;
  spaceHeld: boolean;
  spaceHoldTime: number;
  dt: number;
  longPressThresholdSec?: number;
}

export interface PlayerJetpackStepResult {
  playerVelY: number;
  spaceHoldTime: number;
  isJetpacking: boolean;
  didJump: boolean;
}

/**
 * Resolves on-foot Space key jump vs. long-press backpack jetpack thrust:
 * - Short press while grounded triggers a normal jump (velY = 7.4 m/s).
 * - Holding/long-pressing Space (>= 0.18s) ignites the backpack thruster jetpack,
 *   providing continuous upward thrust that overcomes gravity and climbs up to 11.2 m/s.
 */
export function stepPlayerJetpackAndJump(
  input: PlayerJetpackStepInput,
): PlayerJetpackStepResult {
  const physDt = Math.min(Math.max(0.001, input.dt), 0.05);
  const threshold = input.longPressThresholdSec ?? 0.18;
  let velY = input.playerVelY;
  let holdTime = input.spaceHoldTime;
  let isJetpacking = false;
  let didJump = false;

  if (input.spaceHeld) {
    if (holdTime === 0 && input.footY <= input.groundY + 0.18) {
      velY = 7.4;
      didJump = true;
    }
    holdTime += physDt;
    if (holdTime >= threshold) {
      isJetpacking = true;
      velY = Math.min(11.5, Math.max(4.8, velY) + 38.0 * physDt);
    }
  } else {
    holdTime = 0;
    isJetpacking = false;
  }

  velY = Math.max(-24.0, velY - 19.0 * physDt);

  return {
    playerVelY: velY,
    spaceHoldTime: holdTime,
    isJetpacking,
    didJump,
  };
}

/**
 * Flood-Fill Paint BFS: Finds all contiguous 6-connected hull voxels matching the clicked voxel's
 * material ID (up to maxBlocks = 600), with optional X-axis symmetry mirroring.
 */
export function computeFloodFillPaintCoords(
  startVx: number,
  startVy: number,
  startVz: number,
  getVoxel: (vx: number, vy: number, vz: number) => number,
  mirrorMode: boolean,
  maxBlocks = 600,
): Array<{ vx: number; vy: number; vz: number }> {
  const targetMat = getVoxel(startVx, startVy, startVz);
  if (targetMat === MAT.AIR) return [];

  const visited = new Set<string>();
  const queue: Array<{ vx: number; vy: number; vz: number }> = [
    { vx: startVx, vy: startVy, vz: startVz },
  ];
  visited.add(`${startVx},${startVy},${startVz}`);

  const mirrorAxis2X = SYMMETRY_CENTER_X * 2 - 1;
  if (mirrorMode) {
    const mx = mirrorAxis2X - startVx;
    const mKey = `${mx},${startVy},${startVz}`;
    if (!visited.has(mKey) && getVoxel(mx, startVy, startVz) === targetMat) {
      visited.add(mKey);
      queue.push({ vx: mx, vy: startVy, vz: startVz });
    }
  }

  const results: Array<{ vx: number; vy: number; vz: number }> = [];
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  let head = 0;
  while (head < queue.length && results.length < maxBlocks) {
    const curr = queue[head++];
    results.push(curr);
    for (let d = 0; d < 6; d++) {
      const nx = curr.vx + dirs[d][0];
      const ny = curr.vy + dirs[d][1];
      const nz = curr.vz + dirs[d][2];
      const key = `${nx},${ny},${nz}`;
      if (visited.has(key)) continue;
      if (getVoxel(nx, ny, nz) === targetMat) {
        visited.add(key);
        queue.push({ vx: nx, vy: ny, vz: nz });
      }
    }
  }

  return results;
}

/**
 * Face-Extrude BFS: Finds all contiguous coplanar hull voxels on the clicked face (matching the clicked
 * voxel's material and having empty air along `normal`) and returns the extruded air coordinates
 * (`voxel + normal`), with optional X-axis symmetry mirroring.
 */
export function computeFaceExtrudeCoords(
  hit: { vx: number; vy: number; vz: number; normal: Vec3 },
  getVoxel: (vx: number, vy: number, vz: number) => number,
  mirrorMode: boolean,
  maxBlocks = 256,
): Array<{ vx: number; vy: number; vz: number }> {
  const targetMat = getVoxel(hit.vx, hit.vy, hit.vz);
  if (targetMat === MAT.AIR) return [];

  const nx = Math.round(hit.normal.x);
  const ny = Math.round(hit.normal.y);
  const nz = Math.round(hit.normal.z);
  if (nx === 0 && ny === 0 && nz === 0) return [];

  // Determine the 4 tangent directions perpendicular to the clicked face normal
  const tangents: Array<[number, number, number]> = [];
  if (nx !== 0) {
    tangents.push([0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]);
  } else if (ny !== 0) {
    tangents.push([1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]);
  } else {
    tangents.push([1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]);
  }

  const visited = new Set<string>();
  const queue: Array<{ vx: number; vy: number; vz: number }> = [
    { vx: hit.vx, vy: hit.vy, vz: hit.vz },
  ];
  visited.add(`${hit.vx},${hit.vy},${hit.vz}`);

  const extruded: Array<{ vx: number; vy: number; vz: number }> = [];
  let head = 0;

  while (head < queue.length && extruded.length < maxBlocks) {
    const curr = queue[head++];
    const extX = curr.vx + nx;
    const extY = curr.vy + ny;
    const extZ = curr.vz + nz;
    if (getVoxel(extX, extY, extZ) === MAT.AIR) {
      extruded.push({ vx: extX, vy: extY, vz: extZ });
    }

    for (let t = 0; t < tangents.length; t++) {
      const tx = curr.vx + tangents[t][0];
      const ty = curr.vy + tangents[t][1];
      const tz = curr.vz + tangents[t][2];
      const key = `${tx},${ty},${tz}`;
      if (visited.has(key)) continue;
      if (
        getVoxel(tx, ty, tz) === targetMat &&
        getVoxel(tx + nx, ty + ny, tz + nz) === MAT.AIR
      ) {
        visited.add(key);
        queue.push({ vx: tx, vy: ty, vz: tz });
      }
    }
  }

  if (!mirrorMode) return extruded;

  const mirrorAxis2X = SYMMETRY_CENTER_X * 2 - 1;
  const seenOut = new Set<string>();
  const finalCoords: Array<{ vx: number; vy: number; vz: number }> = [];
  for (const pt of extruded) {
    const k1 = `${pt.vx},${pt.vy},${pt.vz}`;
    if (!seenOut.has(k1)) {
      seenOut.add(k1);
      finalCoords.push(pt);
    }
    const mx = mirrorAxis2X - pt.vx;
    const k2 = `${mx},${pt.vy},${pt.vz}`;
    if (!seenOut.has(k2)) {
      seenOut.add(k2);
      finalCoords.push({ vx: mx, vy: pt.vy, vz: pt.vz });
    }
  }
  return finalCoords;
}


