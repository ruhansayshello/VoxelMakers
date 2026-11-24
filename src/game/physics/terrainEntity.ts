import * as THREE from 'three';
import {
  VoxelWorld,
  getActiveVoxelWorld,
} from '../../engine/world/VoxelWorld';
import { MAT, MAT_INFO, TOTAL_VX, TOTAL_VZ, VOXEL_SIZE } from '../constants.ts';
import { greedyMeshBoundedArrays } from '../physicsMath.ts';
import type { TerrainVoxelCoord } from './terrainConnectivity.ts';

export interface TerrainEntityWorldProber {
  probeGroundBelow: (
    wx: number,
    wy: number,
    wz: number,
    maxStepUp?: number,
  ) => { y: number; mat: number } | null;
  probeGroundBelowForEntity?: (
    wx: number,
    wy: number,
    wz: number,
    maxStepUp?: number,
  ) => { y: number; mat: number } | null;
  isSolidAtWorld?: (wx: number, wy: number, wz: number) => boolean;
  isSolidAtWorldForEntity?: (wx: number, wy: number, wz: number) => boolean;
}

export interface TerrainEntityVehicleLike {
  position: THREE.Vector3;
  velocity?: THREE.Vector3;
  quaternion?: THREE.Quaternion;
  boundingRadius?: number;
  totalMass?: number;
  inBuildMode?: boolean;
  isVoxelEntity?: boolean;
  rigidBody?: {
    position?: THREE.Vector3;
    velocity?: THREE.Vector3;
    mass?: number;
    invMass?: number;
    isSleeping?: boolean;
    wakeUp?: () => void;
    applyImpulseAtPoint?: (impulse: THREE.Vector3, worldPoint: THREE.Vector3) => void;
  };
  propRigidBody?: {
    position?: THREE.Vector3;
    velocity?: THREE.Vector3;
    mass?: number;
    invMass?: number;
    isStatic?: boolean;
    isSleeping?: boolean;
    wakeUp?: () => void;
    applyImpulseAtPoint?: (impulse: THREE.Vector3, worldPoint: THREE.Vector3) => void;
  } | null;
}

export interface TerrainEntitySpawnOptions {
  position: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  angularVelocity?: { x: number; y: number; z: number };
  color: number;
  size?: number;
  scene?: THREE.Scene | null;
}

export interface TerrainStructureSpawnOptions {
  halfVX?: number;
  halfVZ?: number;
  voxelSize?: number;
  velocity?: { x: number; y: number; z: number };
  angularVelocity?: { x: number; y: number; z: number };
  restingLifetimeSec?: number;
  scene?: THREE.Scene | null;
}

export interface TerrainEntitySurfaceHit {
  y: number;
  mat: number;
  entity: TerrainEntity;
}

export interface TerrainEntityRaycastHit {
  entity: TerrainEntity;
  distance: number;
  worldPos: THREE.Vector3;
  normal: THREE.Vector3;
  mat: number;
}

interface StructureOccupancy {
  dimsX: number;
  dimsY: number;
  dimsZ: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  voxelSize: number;
  denseGrid: Uint8Array | null;
  sparseSet: Map<number, number> | null;
}

// Pre-allocated scratch math objects (zero per-frame allocations)
const _dummyMatrix = new THREE.Matrix4();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
const _scaleVec = new THREE.Vector3(1, 1, 1);
const _colorTmp = new THREE.Color(0xffffff);
const _pushDir = new THREE.Vector3();
const _impulseTmp = new THREE.Vector3();
const _contactLocal = new THREE.Vector3();
const _contactWorld = new THREE.Vector3();
const _leverArm = new THREE.Vector3();
const _invQuatA = new THREE.Quaternion();
const _invQuatB = new THREE.Quaternion();
const _localPt = new THREE.Vector3();
const _clampedPt = new THREE.Vector3();
const _worldClosest = new THREE.Vector3();
const _deltaVec = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _rayLocalOrigin = new THREE.Vector3();
const _rayLocalDir = new THREE.Vector3();
const _rayLocalNormal = new THREE.Vector3();
const _rayWorldNormal = new THREE.Vector3();
const _wallProbePt = new THREE.Vector3();

// Face normals & directional shading matching greedyMeshBoundedArrays for sparse fallback
const _SPARSE_FACES: ReadonlyArray<{
  dx: number;
  dy: number;
  dz: number;
  shade: number;
  verts: ReadonlyArray<readonly [number, number, number]>;
}> = [
  {
    dx: 1, dy: 0, dz: 0, shade: 0.92,
    verts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  },
  {
    dx: -1, dy: 0, dz: 0, shade: 0.80,
    verts: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  },
  {
    dx: 0, dy: 1, dz: 0, shade: 1.0,
    verts: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  },
  {
    dx: 0, dy: -1, dz: 0, shade: 0.56,
    verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  {
    dx: 0, dy: 0, dz: 1, shade: 0.86,
    verts: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
  },
  {
    dx: 0, dy: 0, dz: -1, shade: 0.72,
    verts: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
  },
];

// Dense greedy-meshing threshold: up to 512k bounding-box cells (~512KB Uint8Array)
const MAX_DENSE_GREEDY_CELLS = 512_000;

function buildSparseExposedGeometry(
  voxels: ReadonlyArray<TerrainVoxelCoord>,
  minVX: number,
  minVY: number,
  minVZ: number,
  dimsX: number,
  dimsY: number,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  voxelSize: number,
): { geometry: THREE.BufferGeometry; sparseSet: Map<number, number> } {
  const strideY = dimsX;
  const strideZ = dimsX * dimsY;
  const occ = new Map<number, number>();
  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i];
    occ.set(
      (v.vx - minVX) + (v.vy - minVY) * strideY + (v.vz - minVZ) * strideZ,
      v.mat & 63,
    );
  }

  let faceCount = 0;
  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i];
    const lx = v.vx - minVX;
    const ly = v.vy - minVY;
    const lz = v.vz - minVZ;
    for (let f = 0; f < 6; f++) {
      const fd = _SPARSE_FACES[f];
      const nx = lx + fd.dx;
      const ny = ly + fd.dy;
      const nz = lz + fd.dz;
      if (
        nx < 0 ||
        ny < 0 ||
        nz < 0 ||
        nx >= dimsX ||
        ny >= dimsY ||
        !occ.has(nx + ny * strideY + nz * strideZ)
      ) {
        faceCount++;
      }
    }
  }

  const vertCount = faceCount * 4;
  const indexCount = faceCount * 6;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices =
    vertCount <= 65535 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);

  let vCursor = 0;
  let iCursor = 0;
  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i];
    const lx = v.vx - minVX;
    const ly = v.vy - minVY;
    const lz = v.vz - minVZ;
    const info = MAT_INFO[v.mat & 63] || MAT_INFO[MAT.ROCK];
    const baseR = ((info.color >> 16) & 255) / 255;
    const baseG = ((info.color >> 8) & 255) / 255;
    const baseB = (info.color & 255) / 255;
    const bx = offsetX + lx * voxelSize;
    const by = offsetY + ly * voxelSize;
    const bz = offsetZ + lz * voxelSize;

    for (let f = 0; f < 6; f++) {
      const fd = _SPARSE_FACES[f];
      const nx = lx + fd.dx;
      const ny = ly + fd.dy;
      const nz = lz + fd.dz;
      if (
        nx >= 0 &&
        ny >= 0 &&
        nz >= 0 &&
        nx < dimsX &&
        ny < dimsY &&
        occ.has(nx + ny * strideY + nz * strideZ)
      ) {
        continue;
      }

      const cr = Math.min(1, baseR * fd.shade);
      const cg = Math.min(1, baseG * fd.shade);
      const cb = Math.min(1, baseB * fd.shade);
      const baseVert = vCursor;

      for (let k = 0; k < 4; k++) {
        const corner = fd.verts[k];
        const pOff = (baseVert + k) * 3;
        positions[pOff] = bx + corner[0] * voxelSize;
        positions[pOff + 1] = by + corner[1] * voxelSize;
        positions[pOff + 2] = bz + corner[2] * voxelSize;
        normals[pOff] = fd.dx;
        normals[pOff + 1] = fd.dy;
        normals[pOff + 2] = fd.dz;
        colors[pOff] = cr;
        colors[pOff + 1] = cg;
        colors[pOff + 2] = cb;
      }

      indices[iCursor++] = baseVert;
      indices[iCursor++] = baseVert + 1;
      indices[iCursor++] = baseVert + 2;
      indices[iCursor++] = baseVert;
      indices[iCursor++] = baseVert + 2;
      indices[iCursor++] = baseVert + 3;
      vCursor += 4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, sparseSet: occ };
}

function buildUnifiedStructureGeometryAndOccupancy(
  voxels: ReadonlyArray<TerrainVoxelCoord>,
  minVX: number,
  maxVX: number,
  minVY: number,
  maxVY: number,
  minVZ: number,
  maxVZ: number,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  voxelSize: number,
): { geometry: THREE.BufferGeometry; occupancy: StructureOccupancy } {
  const dimsX = maxVX - minVX + 1;
  const dimsY = maxVY - minVY + 1;
  const dimsZ = maxVZ - minVZ + 1;
  const totalCells = dimsX * dimsY * dimsZ;

  if (totalCells <= MAX_DENSE_GREEDY_CELLS) {
    const strideY = dimsX * dimsZ;
    const grid = new Uint8Array(totalCells);
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      const lx = v.vx - minVX;
      const ly = v.vy - minVY;
      const lz = v.vz - minVZ;
      grid[lx + lz * dimsX + ly * strideY] = v.mat & 63;
    }

    const arrays = greedyMeshBoundedArrays(
      dimsX,
      dimsY,
      dimsZ,
      0,
      dimsY - 1,
      (lx, ly, lz) => grid[lx + lz * dimsX + ly * strideY],
      offsetX,
      offsetY,
      offsetZ,
      voxelSize,
      voxelSize,
      'ALL',
      null,
      false,
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
    if (arrays.vertCount <= 65535) {
      const idx16 = new Uint16Array(arrays.indexCount);
      idx16.set(arrays.indices);
      geometry.setIndex(new THREE.BufferAttribute(idx16, 1));
    } else {
      geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    }
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return {
      geometry,
      occupancy: {
        dimsX,
        dimsY,
        dimsZ,
        offsetX,
        offsetY,
        offsetZ,
        voxelSize,
        denseGrid: grid,
        sparseSet: null,
      },
    };
  }

  const { geometry, sparseSet } = buildSparseExposedGeometry(
    voxels,
    minVX,
    minVY,
    minVZ,
    dimsX,
    dimsY,
    offsetX,
    offsetY,
    offsetZ,
    voxelSize,
  );
  return {
    geometry,
    occupancy: {
      dimsX,
      dimsY,
      dimsZ,
      offsetX,
      offsetY,
      offsetZ,
      voxelSize,
      denseGrid: null,
      sparseSet,
    },
  };
}

/**
 * Extracts up to 24 representative extremal local-space contact points (lowest voxel in each
 * 4x4 XZ footprint bucket + top-quadrant anchors) for fast multi-point terrain collision.
 */
function buildStructureContactPoints(
  voxels: ReadonlyArray<TerrainVoxelCoord>,
  minVX: number,
  maxVX: number,
  minVZ: number,
  maxVZ: number,
  halfVX: number,
  halfVZ: number,
  comX: number,
  comY: number,
  comZ: number,
  voxelSize: number,
): Float32Array {
  const buckets = 4;
  const spanX = Math.max(1, maxVX - minVX + 1);
  const spanZ = Math.max(1, maxVZ - minVZ + 1);

  const minYIdx = new Int32Array(buckets * buckets).fill(-1);
  const minYVal = new Int32Array(buckets * buckets).fill(0x7fffffff);
  const maxYIdx = new Int32Array(4).fill(-1);
  const maxYVal = new Int32Array(4).fill(-0x7fffffff);

  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i];
    const bx = Math.min(buckets - 1, Math.floor(((v.vx - minVX) * buckets) / spanX));
    const bz = Math.min(buckets - 1, Math.floor(((v.vz - minVZ) * buckets) / spanZ));
    const bIdx = bx + bz * buckets;
    if (v.vy < minYVal[bIdx]) {
      minYVal[bIdx] = v.vy;
      minYIdx[bIdx] = i;
    }
    const qx = bx >= 2 ? 1 : 0;
    const qz = bz >= 2 ? 1 : 0;
    const qIdx = qx + qz * 2;
    if (v.vy > maxYVal[qIdx]) {
      maxYVal[qIdx] = v.vy;
      maxYIdx[qIdx] = i;
    }
  }

  const chosen = new Set<number>();
  for (let i = 0; i < minYIdx.length; i++) {
    if (minYIdx[i] >= 0) chosen.add(minYIdx[i]);
  }
  for (let i = 0; i < maxYIdx.length; i++) {
    if (maxYIdx[i] >= 0) chosen.add(maxYIdx[i]);
  }

  const out = new Float32Array(chosen.size * 3);
  let cursor = 0;
  chosen.forEach((vIdx) => {
    const v = voxels[vIdx];
    out[cursor++] = (v.vx - halfVX + 0.5) * voxelSize - comX;
    out[cursor++] = (v.vy + 0.5) * voxelSize - comY;
    out[cursor++] = (v.vz - halfVZ + 0.5) * voxelSize - comZ;
  });
  return out;
}

/**
 * Ray-vs-AABB slab test in local space. Returns [tEnter, tExit] + entry face normal in `_rayLocalNormal`.
 */
function intersectRayLocalAABB(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxDist: number,
  outNormal: THREE.Vector3,
): { tEnter: number; tExit: number } | null {
  let tMin = 0;
  let tMax = maxDist;
  let nx = 0;
  let ny = 1;
  let nz = 0;

  // X slab
  if (Math.abs(dx) < 1e-8) {
    if (ox < minX || ox > maxX) return null;
  } else {
    const invD = 1 / dx;
    let t1 = (minX - ox) * invD;
    let t2 = (maxX - ox) * invD;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      nx = s;
      ny = 0;
      nz = 0;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  // Y slab
  if (Math.abs(dy) < 1e-8) {
    if (oy < minY || oy > maxY) return null;
  } else {
    const invD = 1 / dy;
    let t1 = (minY - oy) * invD;
    let t2 = (maxY - oy) * invD;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      nx = 0;
      ny = s;
      nz = 0;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  // Z slab
  if (Math.abs(dz) < 1e-8) {
    if (oz < minZ || oz > maxZ) return null;
  } else {
    const invD = 1 / dz;
    let t1 = (minZ - oz) * invD;
    let t2 = (maxZ - oz) * invD;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      nx = 0;
      ny = 0;
      nz = s;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  outNormal.set(nx, ny, nz);
  return { tEnter: tMin, tExit: tMax };
}

/**
 * Falling terrain entity supporting BOTH:
 * 1. Unified multi-voxel falling terrain structures (`isStructure = true`, greedy-meshed 1 draw call):
 *    An entire disconnected unsupported terrain section falls as ONE rigid-body entity under pure
 *    gravity (zero random initial force) with exact per-voxel occupancy and full collision against
 *    static terrain (ground + walls), vehicles, dynamic props, player, projectiles, and other TerrainEntities.
 * 2. Pooled single-voxel rubble cubes (`isStructure = false`, shared `InstancedMesh` of capacity 200):
 *    Direct crater-carved rubble cubes with full collision.
 */
export class TerrainEntity {
  public static readonly MAX_INSTANCES = 200;
  public static readonly MAX_ACTIVE_STRUCTURES = 48;
  public static readonly DEFAULT_SIZE = VOXEL_SIZE; // 0.25m per terrain voxel
  public static readonly RESTING_LIFETIME_SEC = 5.0;
  public static readonly STRUCTURE_RESTING_LIFETIME_SEC = 8.0;
  public static readonly FADE_DURATION_SEC = 1.0;

  public static sharedMesh: THREE.InstancedMesh = TerrainEntity.createSharedMesh();
  public static sharedStructureMaterial: THREE.MeshLambertMaterial =
    TerrainEntity.createSharedStructureMaterial();
  public static active: TerrainEntity[] = [];
  private static attachedScene: THREE.Scene | null = null;
  private static freeSlots: number[] = TerrainEntity.createInitialSlotStack();
  private static meshDirty = false;
  private static colorDirty = false;
  private static isDisposed = false;

  public readonly position = new THREE.Vector3();
  public readonly velocity = new THREE.Vector3();
  public readonly quaternion = new THREE.Quaternion();
  public readonly angularVelocity = new THREE.Vector3();
  public readonly halfExtents = new THREE.Vector3();
  public readonly isStructure: boolean;
  public readonly voxelCount: number;
  public readonly mass: number;
  public readonly invMass: number;
  public readonly inertia: number;
  public readonly boundingRadius: number;
  public readonly mesh: THREE.Mesh | null;
  private readonly contactPoints: Float32Array | null;
  private readonly occupancy: StructureOccupancy | null;
  private groundedSettleTimer = 0;

  public size: number;
  public color: number;
  public isResting = false;
  public lifetime: number;
  public readonly instanceSlot: number;
  public readonly voxelWorld: VoxelWorld;
  public debrisSlot = -1;

  private constructor(
    slot: number,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    angularVelocity: { x: number; y: number; z: number },
    color: number,
    size: number,
    structureData?: {
      voxelCount: number;
      mesh: THREE.Mesh;
      halfExtents: { x: number; y: number; z: number };
      boundingRadius: number;
      contactPoints: Float32Array;
      occupancy: StructureOccupancy;
      restingLifetimeSec: number;
    },
  ) {
    this.instanceSlot = slot;
    this.voxelWorld = getActiveVoxelWorld();
    this.position.set(position.x, position.y, position.z);
    this.velocity.set(velocity.x, velocity.y, velocity.z);
    this.angularVelocity.set(
      angularVelocity.x,
      angularVelocity.y,
      angularVelocity.z,
    );
    this.quaternion.set(0, 0, 0, 1);
    this.color = color >>> 0;
    this.size = size;
    this.isResting = false;

    if (structureData) {
      this.isStructure = true;
      this.voxelCount = structureData.voxelCount;
      this.mass = Math.max(15, structureData.voxelCount * 18);
      this.invMass = 1 / this.mass;
      this.mesh = structureData.mesh;
      this.halfExtents.set(
        structureData.halfExtents.x,
        structureData.halfExtents.y,
        structureData.halfExtents.z,
      );
      this.boundingRadius = structureData.boundingRadius;
      this.inertia = Math.max(4, this.mass * this.boundingRadius * this.boundingRadius * 0.4);
      this.contactPoints = structureData.contactPoints;
      this.occupancy = structureData.occupancy;
      this.lifetime = structureData.restingLifetimeSec;
    } else {
      this.isStructure = false;
      this.voxelCount = 1;
      this.mass = 15;
      this.invMass = 1 / 15;
      this.mesh = null;
      const half = size * 0.5;
      this.halfExtents.set(half, half, half);
      this.boundingRadius = half * 1.732;
      this.inertia = Math.max(0.5, this.mass * half * half);
      this.contactPoints = null;
      this.occupancy = null;
      this.lifetime = TerrainEntity.RESTING_LIFETIME_SEC;
      this.debrisSlot = this.voxelWorld.spawnDebris(
        position.x,
        position.y,
        position.z,
        velocity.x,
        velocity.y,
        velocity.z,
        this.color,
        this.size,
        this.lifetime,
      );
    }
  }

  private static createInitialSlotStack(): number[] {
    const slots: number[] = [];
    for (let i = TerrainEntity.MAX_INSTANCES - 1; i >= 0; i--) {
      slots.push(i);
    }
    return slots;
  }

  private static createSharedStructureMaterial(): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
    });
  }

  private static createSharedMesh(): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
    });
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      TerrainEntity.MAX_INSTANCES,
    );
    mesh.name = 'TerrainEntitySharedMesh';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    _colorTmp.setHex(0xffffff);
    for (let i = 0; i < TerrainEntity.MAX_INSTANCES; i++) {
      mesh.setMatrixAt(i, _zeroMatrix);
      mesh.setColorAt(i, _colorTmp);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }
    return mesh;
  }

  public static ensureSharedMesh(): THREE.InstancedMesh {
    if (TerrainEntity.isDisposed) {
      TerrainEntity.sharedMesh = TerrainEntity.createSharedMesh();
      TerrainEntity.sharedStructureMaterial =
        TerrainEntity.createSharedStructureMaterial();
      TerrainEntity.freeSlots = TerrainEntity.createInitialSlotStack();
      TerrainEntity.active.length = 0;
      TerrainEntity.isDisposed = false;
    }
    return TerrainEntity.sharedMesh;
  }

  public static attachToScene(scene?: THREE.Scene | null): THREE.InstancedMesh {
    const mesh = TerrainEntity.ensureSharedMesh();
    if (scene) {
      TerrainEntity.attachedScene = scene;
      if (mesh.parent !== scene) {
        scene.add(mesh);
      }
      for (let i = 0; i < TerrainEntity.active.length; i++) {
        const ent = TerrainEntity.active[i];
        if (ent.isStructure && ent.mesh && ent.mesh.parent !== scene) {
          scene.add(ent.mesh);
        }
      }
    }
    return mesh;
  }

  private static acquireSlotOrRecycle(): number {
    TerrainEntity.ensureSharedMesh();
    if (TerrainEntity.freeSlots.length > 0) {
      return TerrainEntity.freeSlots.pop()!;
    }

    let recycleIdx = TerrainEntity.active.findIndex((e) => !e.isStructure && e.isResting);
    if (recycleIdx < 0) {
      recycleIdx = TerrainEntity.active.findIndex((e) => !e.isStructure);
    }
    if (recycleIdx < 0) {
      return 0;
    }
    const recycled = TerrainEntity.active[recycleIdx];
    TerrainEntity.active.splice(recycleIdx, 1);
    return recycled.instanceSlot;
  }

  private static enforceStructureCap(): void {
    let structureCount = 0;
    let oldestRestingIdx = -1;
    let oldestAnyIdx = -1;
    for (let i = 0; i < TerrainEntity.active.length; i++) {
      const e = TerrainEntity.active[i];
      if (!e.isStructure) continue;
      structureCount++;
      if (oldestAnyIdx < 0) oldestAnyIdx = i;
      if (e.isResting && oldestRestingIdx < 0) oldestRestingIdx = i;
    }
    while (structureCount >= TerrainEntity.MAX_ACTIVE_STRUCTURES) {
      const victimIdx = oldestRestingIdx >= 0 ? oldestRestingIdx : oldestAnyIdx;
      if (victimIdx < 0) break;
      const victim = TerrainEntity.active[victimIdx];
      victim.removeFromActive();
      structureCount--;
      oldestRestingIdx = TerrainEntity.active.findIndex((e) => e.isStructure && e.isResting);
      oldestAnyIdx = TerrainEntity.active.findIndex((e) => e.isStructure);
    }
  }

  /**
   * Spawns ONE unified rigid-body TerrainEntity for an entire connected unsupported terrain
   * structure (any size — zero voxel count cap). Starts with ZERO random velocity or spin
   * so it drops straight under pure gravity and only rotates on real physical contact.
   */
  public static spawnStructure(
    voxels: ReadonlyArray<TerrainVoxelCoord>,
    opts: TerrainStructureSpawnOptions = {},
  ): TerrainEntity | null {
    if (!voxels || voxels.length === 0) return null;

    const targetScene = opts.scene ?? TerrainEntity.attachedScene;
    if (targetScene) {
      TerrainEntity.attachToScene(targetScene);
    } else {
      TerrainEntity.ensureSharedMesh();
    }

    TerrainEntity.enforceStructureCap();

    const halfVX = opts.halfVX ?? (TOTAL_VX >> 1);
    const halfVZ = opts.halfVZ ?? (TOTAL_VZ >> 1);
    const voxelSize = opts.voxelSize ?? TerrainEntity.DEFAULT_SIZE;

    let minVX = Infinity;
    let maxVX = -Infinity;
    let minVY = Infinity;
    let maxVY = -Infinity;
    let minVZ = Infinity;
    let maxVZ = -Infinity;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;

    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      if (v.vx < minVX) minVX = v.vx;
      if (v.vx > maxVX) maxVX = v.vx;
      if (v.vy < minVY) minVY = v.vy;
      if (v.vy > maxVY) maxVY = v.vy;
      if (v.vz < minVZ) minVZ = v.vz;
      if (v.vz > maxVZ) maxVZ = v.vz;
      sumX += (v.vx - halfVX + 0.5) * voxelSize;
      sumY += (v.vy + 0.5) * voxelSize;
      sumZ += (v.vz - halfVZ + 0.5) * voxelSize;
    }

    const invCount = 1 / voxels.length;
    const comX = sumX * invCount;
    const comY = sumY * invCount;
    const comZ = sumZ * invCount;

    const gridOriginWorldX = (minVX - halfVX) * voxelSize;
    const gridOriginWorldY = minVY * voxelSize;
    const gridOriginWorldZ = (minVZ - halfVZ) * voxelSize;

    const offsetX = gridOriginWorldX - comX;
    const offsetY = gridOriginWorldY - comY;
    const offsetZ = gridOriginWorldZ - comZ;

    const { geometry, occupancy } = buildUnifiedStructureGeometryAndOccupancy(
      voxels,
      minVX,
      maxVX,
      minVY,
      maxVY,
      minVZ,
      maxVZ,
      offsetX,
      offsetY,
      offsetZ,
      voxelSize,
    );

    const mesh = new THREE.Mesh(geometry, TerrainEntity.sharedStructureMaterial);
    mesh.name = `TerrainStructureEntity_${voxels.length}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.position.set(comX, comY, comZ);
    mesh.quaternion.set(0, 0, 0, 1);
    if (targetScene) {
      targetScene.add(mesh);
    }

    const halfX = Math.max(voxelSize * 0.5, ((maxVX - minVX + 1) * voxelSize) * 0.5);
    const halfY = Math.max(voxelSize * 0.5, ((maxVY - minVY + 1) * voxelSize) * 0.5);
    const halfZ = Math.max(voxelSize * 0.5, ((maxVZ - minVZ + 1) * voxelSize) * 0.5);
    const boundingRadius = Math.hypot(halfX, halfY, halfZ);

    const contactPoints = buildStructureContactPoints(
      voxels,
      minVX,
      maxVX,
      minVZ,
      maxVZ,
      halfVX,
      halfVZ,
      comX,
      comY,
      comZ,
      voxelSize,
    );

    // Zero random forces: falls purely under gravity unless caller explicitly specifies velocity
    const initVel = opts.velocity ?? { x: 0, y: 0, z: 0 };
    const initAngVel = opts.angularVelocity ?? { x: 0, y: 0, z: 0 };

    const firstInfo = MAT_INFO[voxels[0].mat & 63];
    const entity = new TerrainEntity(
      -1,
      { x: comX, y: comY, z: comZ },
      initVel,
      initAngVel,
      firstInfo ? firstInfo.color : 0x94a3b8,
      voxelSize,
      {
        voxelCount: voxels.length,
        mesh,
        halfExtents: { x: halfX, y: halfY, z: halfZ },
        boundingRadius,
        contactPoints,
        occupancy,
        restingLifetimeSec:
          opts.restingLifetimeSec ?? TerrainEntity.STRUCTURE_RESTING_LIFETIME_SEC,
      },
    );

    TerrainEntity.active.push(entity);
    return entity;
  }

  public static spawn(opts: TerrainEntitySpawnOptions): TerrainEntity {
    const targetScene = opts.scene ?? TerrainEntity.attachedScene;
    if (targetScene) {
      TerrainEntity.attachToScene(targetScene);
    } else {
      TerrainEntity.ensureSharedMesh();
    }

    const slot = TerrainEntity.acquireSlotOrRecycle();
    const entity = new TerrainEntity(
      slot,
      opts.position,
      opts.velocity ?? { x: 0, y: 0, z: 0 },
      opts.angularVelocity ?? { x: 0, y: 0, z: 0 },
      opts.color,
      opts.size ?? TerrainEntity.DEFAULT_SIZE,
    );

    _colorTmp.setHex(entity.color);
    TerrainEntity.sharedMesh.setColorAt(slot, _colorTmp);
    TerrainEntity.colorDirty = true;
    entity.updateInstanceMatrix();
    TerrainEntity.active.push(entity);
    return entity;
  }

  /**
   * Spawns a falling terrain debris cube from directly blast-carved world voxels.
   */
  public static spawnTerrainVoxelDebris(
    wx: number,
    wy: number,
    wz: number,
    colorHex: number,
    blastCenterX?: number,
    blastCenterY?: number,
    blastCenterZ?: number,
    scene?: THREE.Scene | null,
  ): TerrainEntity {
    let vx = 0;
    let vy = 0;
    let vz = 0;

    if (
      blastCenterX !== undefined &&
      blastCenterY !== undefined &&
      blastCenterZ !== undefined
    ) {
      const dx = wx - blastCenterX;
      const dy = wy - blastCenterY;
      const dz = wz - blastCenterZ;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > 1e-4) {
        const inv = 1 / Math.sqrt(dSq);
        const speed = 4.2;
        vx = dx * inv * speed;
        vy = Math.max(1.2, dy * inv * speed + 1.8);
        vz = dz * inv * speed;
      }
    }

    return TerrainEntity.spawn({
      position: { x: wx, y: wy, z: wz },
      velocity: { x: vx, y: vy, z: vz },
      angularVelocity: { x: 0, y: 0, z: 0 },
      color: colorHex,
      size: TerrainEntity.DEFAULT_SIZE,
      scene,
    });
  }

  /**
   * Spawns a single falling TerrainEntity block with zero random initial force.
   */
  public static spawnCollapsedVoxel(
    wx: number,
    wy: number,
    wz: number,
    colorHex: number,
    scene?: THREE.Scene | null,
  ): TerrainEntity {
    return TerrainEntity.spawn({
      position: { x: wx, y: wy, z: wz },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      color: colorHex,
      size: TerrainEntity.DEFAULT_SIZE,
      scene,
    });
  }

  public getCurrentScale(): number {
    if (this.isResting && this.lifetime < TerrainEntity.FADE_DURATION_SEC) {
      return Math.max(0.01, this.lifetime / TerrainEntity.FADE_DURATION_SEC);
    }
    return 1.0;
  }

  /**
   * Exact local-space voxel occupancy check (returns material ID > 0 if solid, 0 if air).
   */
  public getLocalPointMaterial(lx: number, ly: number, lz: number): number {
    const occ = this.occupancy;
    if (!occ) {
      const h = this.size * 0.5;
      if (Math.abs(lx) <= h && Math.abs(ly) <= h && Math.abs(lz) <= h) {
        return MAT.ROCK;
      }
      return MAT.AIR;
    }
    const gx = Math.floor((lx - occ.offsetX) / occ.voxelSize);
    const gy = Math.floor((ly - occ.offsetY) / occ.voxelSize);
    const gz = Math.floor((lz - occ.offsetZ) / occ.voxelSize);
    if (
      gx < 0 ||
      gy < 0 ||
      gz < 0 ||
      gx >= occ.dimsX ||
      gy >= occ.dimsY ||
      gz >= occ.dimsZ
    ) {
      return MAT.AIR;
    }
    if (occ.denseGrid) {
      return occ.denseGrid[gx + gz * occ.dimsX + gy * occ.dimsX * occ.dimsZ];
    }
    if (occ.sparseSet) {
      return occ.sparseSet.get(gx + gy * occ.dimsX + gz * occ.dimsX * occ.dimsY) ?? MAT.AIR;
    }
    return MAT.AIR;
  }

  public wakeUp(): void {
    if (this.isResting) {
      this.isResting = false;
      this.groundedSettleTimer = 0;
      this.lifetime = this.isStructure
        ? TerrainEntity.STRUCTURE_RESTING_LIFETIME_SEC
        : TerrainEntity.RESTING_LIFETIME_SEC;
    }
  }

  /**
   * Applies a world-space impulse (N*s) at a world contact point, waking the entity if resting.
   */
  public applyImpulseAtPoint(impulse: THREE.Vector3, worldPoint: THREE.Vector3): void {
    this.wakeUp();
    this.velocity.addScaledVector(impulse, this.invMass);
    // Clamp runaway velocities for stability
    const maxLin = 32;
    const linSq = this.velocity.lengthSq();
    if (linSq > maxLin * maxLin) {
      this.velocity.multiplyScalar(maxLin / Math.sqrt(linSq));
    }

    const rx = worldPoint.x - this.position.x;
    const ry = worldPoint.y - this.position.y;
    const rz = worldPoint.z - this.position.z;
    // tau = r x impulse
    const tx = ry * impulse.z - rz * impulse.y;
    const ty = rz * impulse.x - rx * impulse.z;
    const tz = rx * impulse.y - ry * impulse.x;
    const invI = 1 / this.inertia;
    this.angularVelocity.x += tx * invI;
    this.angularVelocity.y += ty * invI;
    this.angularVelocity.z += tz * invI;
    const maxAng = 8;
    const angSq = this.angularVelocity.lengthSq();
    if (angSq > maxAng * maxAng) {
      this.angularVelocity.multiplyScalar(maxAng / Math.sqrt(angSq));
    }
  }

  /**
   * Applies radial explosion impulse to all active TerrainEntity instances within `radiusMeters`.
   */
  public static applyExplosionImpulse(
    wx: number,
    wy: number,
    wz: number,
    radiusMeters: number,
    forceScale = 1200,
  ): void {
    const list = TerrainEntity.active;
    if (list.length === 0) return;
    const safeRadius = Math.max(0.5, radiusMeters);
    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      const dx = ent.position.x - wx;
      const dy = ent.position.y - wy;
      const dz = ent.position.z - wz;
      const maxDist = safeRadius + ent.boundingRadius;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq >= maxDist * maxDist) continue;
      const dist = Math.sqrt(distSq);
      const falloff = Math.max(0, 1 - dist / maxDist);
      const invD = dist > 1e-4 ? 1 / dist : 0;
      const nx = dist > 1e-4 ? dx * invD : 0;
      const ny = dist > 1e-4 ? Math.max(0.25, dy * invD) : 1;
      const nz = dist > 1e-4 ? dz * invD : 0;
      const impMag = forceScale * falloff * Math.min(4.0, Math.sqrt(ent.voxelCount));
      _impulseTmp.set(nx * impMag, ny * impMag, nz * impMag);
      _contactWorld.set(wx, wy, wz);
      ent.applyImpulseAtPoint(_impulseTmp, _contactWorld);
    }
  }

  /**
   * Exact world-point solid check against all active TerrainEntity instances
   * (used by on-foot player wall collision, probes, and static solid checks).
   */
  public static isSolidAtWorld(
    wx: number,
    wy: number,
    wz: number,
    excludeEntity?: TerrainEntity | null,
  ): boolean {
    const list = TerrainEntity.active;
    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      if (ent === excludeEntity) continue;
      const scale = ent.getCurrentScale();
      if (scale <= 0.15) continue;
      const dx = wx - ent.position.x;
      const dy = wy - ent.position.y;
      const dz = wz - ent.position.z;
      const r = ent.boundingRadius * scale + 0.05;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;

      _invQuatA.copy(ent.quaternion).invert();
      _localPt.set(dx, dy, dz).applyQuaternion(_invQuatA);
      if (scale !== 1.0) {
        _localPt.multiplyScalar(1 / scale);
      }
      if (ent.getLocalPointMaterial(_localPt.x, _localPt.y, _localPt.z) !== MAT.AIR) {
        return true;
      }
    }
    return false;
  }

  /**
   * Downward vertical surface probe against all active TerrainEntity instances
   * so vehicles, props, player, and other falling TerrainEntities can stand/drive/stack on top!
   */
  public static probeSurfaceBelow(
    wx: number,
    wy: number,
    wz: number,
    maxStepUp = 0.5,
    excludeEntity?: TerrainEntity | null,
  ): TerrainEntitySurfaceHit | null {
    const list = TerrainEntity.active;
    if (list.length === 0) return null;

    const startY = wy + maxStepUp;
    const maxRayDist = Math.max(4.0, startY + 2.0);
    let bestY = -Infinity;
    let bestMat: number = MAT.AIR;
    let bestEnt: TerrainEntity | null = null;

    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      if (ent === excludeEntity) continue;
      const scale = ent.getCurrentScale();
      if (scale <= 0.15) continue;

      const r = ent.boundingRadius * scale + 0.05;
      const dx = wx - ent.position.x;
      const dz = wz - ent.position.z;
      if (dx * dx + dz * dz > r * r) continue;
      if (ent.position.y - r > startY) continue;

      _invQuatA.copy(ent.quaternion).invert();
      _rayLocalOrigin
        .set(wx - ent.position.x, startY - ent.position.y, wz - ent.position.z)
        .applyQuaternion(_invQuatA);
      _rayLocalDir.set(0, -1, 0).applyQuaternion(_invQuatA);
      if (scale !== 1.0) {
        _rayLocalOrigin.multiplyScalar(1 / scale);
      }

      const occ = ent.occupancy;
      const minX = occ ? occ.offsetX : -ent.size * 0.5;
      const minY = occ ? occ.offsetY : -ent.size * 0.5;
      const minZ = occ ? occ.offsetZ : -ent.size * 0.5;
      const maxX = occ ? occ.offsetX + occ.dimsX * occ.voxelSize : ent.size * 0.5;
      const maxY = occ ? occ.offsetY + occ.dimsY * occ.voxelSize : ent.size * 0.5;
      const maxZ = occ ? occ.offsetZ + occ.dimsZ * occ.voxelSize : ent.size * 0.5;

      const boxHit = intersectRayLocalAABB(
        _rayLocalOrigin.x,
        _rayLocalOrigin.y,
        _rayLocalOrigin.z,
        _rayLocalDir.x,
        _rayLocalDir.y,
        _rayLocalDir.z,
        minX,
        minY,
        minZ,
        maxX,
        maxY,
        maxZ,
        maxRayDist / scale,
        _rayLocalNormal,
      );
      if (!boxHit) continue;

      if (!occ) {
        const hitWorldY = startY - boxHit.tEnter * scale;
        if (hitWorldY <= startY + 0.01 && hitWorldY > bestY) {
          bestY = hitWorldY;
          bestMat = MAT.ROCK;
          bestEnt = ent;
        }
        continue;
      }

      // Step through exact local voxels along the ray inside the OBB
      const stepLen = occ.voxelSize * 0.45;
      const tEnd = boxHit.tExit;
      for (let t = Math.max(0, boxHit.tEnter); t <= tEnd + 1e-4; t += stepLen) {
        const sx = _rayLocalOrigin.x + _rayLocalDir.x * t;
        const sy = _rayLocalOrigin.y + _rayLocalDir.y * t;
        const sz = _rayLocalOrigin.z + _rayLocalDir.z * t;
        const mat = ent.getLocalPointMaterial(sx, sy, sz);
        if (mat !== MAT.AIR) {
          const hitWorldY = startY - t * scale;
          if (hitWorldY <= startY + 0.01 && hitWorldY > bestY) {
            bestY = hitWorldY;
            bestMat = mat;
            bestEnt = ent;
          }
          break;
        }
      }
    }

    if (bestEnt && bestY > -Infinity) {
      return { y: bestY, mat: bestMat, entity: bestEnt };
    }
    return null;
  }

  /**
   * Raycast a segment `(origin, dir, maxDist)` against all active TerrainEntity instances
   * (used by bullets, minigun, rockets, plasma shells, and sticky bombs).
   */
  public static raycastSegment(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): TerrainEntityRaycastHit | null {
    const list = TerrainEntity.active;
    if (list.length === 0 || maxDist <= 1e-6) return null;

    let bestDist = maxDist + 1e-4;
    let bestEnt: TerrainEntity | null = null;
    let bestMat: number = MAT.ROCK;
    const bestNormal = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      const scale = ent.getCurrentScale();
      if (scale <= 0.15) continue;

      // Fast ray-sphere rejection
      const ocX = ent.position.x - origin.x;
      const ocY = ent.position.y - origin.y;
      const ocZ = ent.position.z - origin.z;
      const proj = ocX * dir.x + ocY * dir.y + ocZ * dir.z;
      const r = ent.boundingRadius * scale + 0.1;
      if (proj < -r || proj > bestDist + r) continue;
      const perpSq = ocX * ocX + ocY * ocY + ocZ * ocZ - proj * proj;
      if (perpSq > r * r) continue;

      _invQuatA.copy(ent.quaternion).invert();
      _rayLocalOrigin
        .set(origin.x - ent.position.x, origin.y - ent.position.y, origin.z - ent.position.z)
        .applyQuaternion(_invQuatA);
      _rayLocalDir.copy(dir).applyQuaternion(_invQuatA);
      if (scale !== 1.0) {
        _rayLocalOrigin.multiplyScalar(1 / scale);
      }

      const occ = ent.occupancy;
      const minX = occ ? occ.offsetX : -ent.size * 0.5;
      const minY = occ ? occ.offsetY : -ent.size * 0.5;
      const minZ = occ ? occ.offsetZ : -ent.size * 0.5;
      const maxX = occ ? occ.offsetX + occ.dimsX * occ.voxelSize : ent.size * 0.5;
      const maxY = occ ? occ.offsetY + occ.dimsY * occ.voxelSize : ent.size * 0.5;
      const maxZ = occ ? occ.offsetZ + occ.dimsZ * occ.voxelSize : ent.size * 0.5;

      const boxHit = intersectRayLocalAABB(
        _rayLocalOrigin.x,
        _rayLocalOrigin.y,
        _rayLocalOrigin.z,
        _rayLocalDir.x,
        _rayLocalDir.y,
        _rayLocalDir.z,
        minX,
        minY,
        minZ,
        maxX,
        maxY,
        maxZ,
        bestDist / scale,
        _rayLocalNormal,
      );
      if (!boxHit) continue;

      if (!occ) {
        const hitDist = boxHit.tEnter * scale;
        if (hitDist < bestDist) {
          bestDist = hitDist;
          bestEnt = ent;
          bestMat = MAT.ROCK;
          bestNormal.copy(_rayLocalNormal).applyQuaternion(ent.quaternion).normalize();
        }
        continue;
      }

      // Step through exact local voxels inside the OBB
      const stepLen = occ.voxelSize * 0.45;
      const tEnd = Math.min(boxHit.tExit, bestDist / scale);
      for (let t = Math.max(0, boxHit.tEnter); t <= tEnd + 1e-4; t += stepLen) {
        const sx = _rayLocalOrigin.x + _rayLocalDir.x * t;
        const sy = _rayLocalOrigin.y + _rayLocalDir.y * t;
        const sz = _rayLocalOrigin.z + _rayLocalDir.z * t;
        const mat = ent.getLocalPointMaterial(sx, sy, sz);
        if (mat !== MAT.AIR) {
          const hitDist = t * scale;
          if (hitDist < bestDist) {
            bestDist = hitDist;
            bestEnt = ent;
            bestMat = mat;
            bestNormal.copy(_rayLocalNormal).applyQuaternion(ent.quaternion).normalize();
          }
          break;
        }
      }
    }

    if (!bestEnt) return null;
    return {
      entity: bestEnt,
      distance: bestDist,
      worldPos: new THREE.Vector3(
        origin.x + dir.x * bestDist,
        origin.y + dir.y * bestDist,
        origin.z + dir.z * bestDist,
      ),
      normal: bestNormal,
      mat: bestMat,
    };
  }

  /**
   * Resolves overlap between the on-foot player capsule and moving/falling TerrainEntity structures
   * so falling terrain pushes the player out cleanly instead of swallowing them inside the mesh.
   */
  public static resolvePlayerCollision(
    playerEyePos: THREE.Vector3,
    eyeHeight: number,
    playerRadius = 0.32,
  ): boolean {
    const list = TerrainEntity.active;
    if (list.length === 0) return false;
    let pushed = false;
    const centerY = playerEyePos.y - eyeHeight * 0.5;

    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      const scale = ent.getCurrentScale();
      if (scale <= 0.15) continue;

      const dx = playerEyePos.x - ent.position.x;
      const dy = centerY - ent.position.y;
      const dz = playerEyePos.z - ent.position.z;
      const maxR = ent.boundingRadius * scale + playerRadius + eyeHeight * 0.5;
      if (dx * dx + dy * dy + dz * dz > maxR * maxR) continue;

      _invQuatA.copy(ent.quaternion).invert();
      _localPt.set(dx, dy, dz).applyQuaternion(_invQuatA);
      const hx = ent.halfExtents.x * scale;
      const hy = ent.halfExtents.y * scale;
      const hz = ent.halfExtents.z * scale;

      _clampedPt.set(
        Math.max(-hx, Math.min(hx, _localPt.x)),
        Math.max(-hy, Math.min(hy, _localPt.y)),
        Math.max(-hz, Math.min(hz, _localPt.z)),
      );
      _deltaVec.subVectors(_localPt, _clampedPt);
      const distSq = _deltaVec.lengthSq();

      // Verify exact voxel occupancy near clamped point if structure has hollow spaces
      if (ent.occupancy) {
        const matAtClamp = ent.getLocalPointMaterial(
          _clampedPt.x / scale,
          _clampedPt.y / scale,
          _clampedPt.z / scale,
        );
        if (matAtClamp === MAT.AIR && distSq > 0.01) continue;
      }

      if (distSq < playerRadius * playerRadius) {
        let pen = 0;
        if (distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          pen = playerRadius - dist;
          _pushDir.copy(_deltaVec).divideScalar(dist).applyQuaternion(ent.quaternion);
        } else {
          // Inside OBB: push along minimum penetration axis
          const ox = hx - Math.abs(_localPt.x);
          const oy = hy - Math.abs(_localPt.y);
          const oz = hz - Math.abs(_localPt.z);
          if (oy <= ox && oy <= oz) {
            pen = oy + playerRadius;
            _pushDir.set(0, _localPt.y >= 0 ? 1 : -1, 0).applyQuaternion(ent.quaternion);
          } else if (ox <= oz) {
            pen = ox + playerRadius;
            _pushDir.set(_localPt.x >= 0 ? 1 : -1, 0, 0).applyQuaternion(ent.quaternion);
          } else {
            pen = oz + playerRadius;
            _pushDir.set(0, 0, _localPt.z >= 0 ? 1 : -1).applyQuaternion(ent.quaternion);
          }
        }
        playerEyePos.addScaledVector(_pushDir, pen);
        pushed = true;
      }
    }
    return pushed;
  }

  private removeFromActive(): void {
    const idx = TerrainEntity.active.indexOf(this);
    if (idx !== -1) {
      TerrainEntity.active.splice(idx, 1);
    }
    if (this.debrisSlot >= 0) {
      this.voxelWorld.releaseDebris(this.debrisSlot);
      this.debrisSlot = -1;
    }
    if (this.isStructure && this.mesh) {
      if (this.mesh.parent) {
        this.mesh.parent.remove(this.mesh);
      }
      this.mesh.geometry.dispose();
    } else if (this.instanceSlot >= 0) {
      TerrainEntity.sharedMesh.setMatrixAt(this.instanceSlot, _zeroMatrix);
      TerrainEntity.meshDirty = true;
      TerrainEntity.freeSlots.push(this.instanceSlot);
    }
  }

  public updateInstanceMatrix(): void {
    if (this.isStructure && this.mesh) {
      let scale = 1.0;
      if (this.isResting && this.lifetime < TerrainEntity.FADE_DURATION_SEC) {
        scale = Math.max(0, this.lifetime / TerrainEntity.FADE_DURATION_SEC);
      }
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.quaternion);
      this.mesh.scale.set(scale, scale, scale);
      return;
    }

    if (this.debrisSlot >= 0) {
      const vw = this.voxelWorld;
      const o3 = this.debrisSlot * 3;
      const o4 = this.debrisSlot * 4;
      vw.debrisPositions[o3] = this.position.x;
      vw.debrisPositions[o3 + 1] = this.position.y;
      vw.debrisPositions[o3 + 2] = this.position.z;
      vw.debrisVelocities[o3] = this.velocity.x;
      vw.debrisVelocities[o3 + 1] = this.velocity.y;
      vw.debrisVelocities[o3 + 2] = this.velocity.z;
      vw.debrisQuaternions[o4] = this.quaternion.x;
      vw.debrisQuaternions[o4 + 1] = this.quaternion.y;
      vw.debrisQuaternions[o4 + 2] = this.quaternion.z;
      vw.debrisQuaternions[o4 + 3] = this.quaternion.w;
      vw.debrisAngularVelocities[o3] = this.angularVelocity.x;
      vw.debrisAngularVelocities[o3 + 1] = this.angularVelocity.y;
      vw.debrisAngularVelocities[o3 + 2] = this.angularVelocity.z;
      vw.debrisLifetimes[this.debrisSlot] = this.lifetime;
      vw.debrisResting[this.debrisSlot] = this.isResting ? 1 : 0;
    }

    let scale = this.size;
    if (this.isResting && this.lifetime < TerrainEntity.FADE_DURATION_SEC) {
      scale = this.size * Math.max(0, this.lifetime / TerrainEntity.FADE_DURATION_SEC);
    }
    _scaleVec.set(scale, scale, scale);
    _dummyMatrix.compose(this.position, this.quaternion, _scaleVec);
    TerrainEntity.sharedMesh.setMatrixAt(this.instanceSlot, _dummyMatrix);
    TerrainEntity.meshDirty = true;
  }

  /**
   * Solid bidirectional OBB-vs-sphere/hull collision against all vehicles & dynamic voxel props.
   */
  private applyVehicleCollision(
    activeVehicles: TerrainEntityVehicleLike[],
    wakeIfMoving: boolean,
  ): boolean {
    let hit = false;
    const scale = this.getCurrentScale();
    if (scale <= 0.15) return false;
    const hx = this.halfExtents.x * scale;
    const hy = this.halfExtents.y * scale;
    const hz = this.halfExtents.z * scale;

    for (let i = 0; i < activeVehicles.length; i++) {
      const vehicle = activeVehicles[i];
      if (!vehicle || vehicle.inBuildMode) continue;

      const body = vehicle.propRigidBody ?? vehicle.rigidBody;
      const vehVel = body?.velocity ?? vehicle.velocity;

      if (wakeIfMoving) {
        if (!vehVel || vehVel.x * vehVel.x + vehVel.y * vehVel.y + vehVel.z * vehVel.z < 0.04) {
          continue;
        }
      }

      const dx = vehicle.position.x - this.position.x;
      const dy = vehicle.position.y - this.position.y;
      const dz = vehicle.position.z - this.position.z;
      const vehicleRadius = Math.max(0.35, vehicle.boundingRadius ?? 1.8);
      const broadR = this.boundingRadius * scale + vehicleRadius;
      if (dx * dx + dy * dy + dz * dz >= broadR * broadR) continue;

      // Transform vehicle center into this TerrainEntity's local OBB space
      _invQuatA.copy(this.quaternion).invert();
      _localPt.set(dx, dy, dz).applyQuaternion(_invQuatA);
      _clampedPt.set(
        Math.max(-hx, Math.min(hx, _localPt.x)),
        Math.max(-hy, Math.min(hy, _localPt.y)),
        Math.max(-hz, Math.min(hz, _localPt.z)),
      );
      _deltaVec.subVectors(_localPt, _clampedPt);
      const distSq = _deltaVec.lengthSq();
      if (distSq >= vehicleRadius * vehicleRadius) continue;

      // For hollow structures, confirm closest clamped point is actually near a solid voxel
      if (this.occupancy && distSq > 0.04) {
        if (
          this.getLocalPointMaterial(
            _clampedPt.x / scale,
            _clampedPt.y / scale,
            _clampedPt.z / scale,
          ) === MAT.AIR
        ) {
          continue;
        }
      }

      let pen = 0;
      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        pen = vehicleRadius - dist;
        // Normal pointing from TerrainEntity -> Vehicle
        _pushDir.copy(_deltaVec).divideScalar(dist).applyQuaternion(this.quaternion);
      } else {
        const ox = hx - Math.abs(_localPt.x);
        const oy = hy - Math.abs(_localPt.y);
        const oz = hz - Math.abs(_localPt.z);
        if (oy <= ox && oy <= oz) {
          pen = oy + vehicleRadius;
          _pushDir.set(0, _localPt.y >= 0 ? 1 : -1, 0).applyQuaternion(this.quaternion);
        } else if (ox <= oz) {
          pen = ox + vehicleRadius;
          _pushDir.set(_localPt.x >= 0 ? 1 : -1, 0, 0).applyQuaternion(this.quaternion);
        } else {
          pen = oz + vehicleRadius;
          _pushDir.set(0, 0, _localPt.z >= 0 ? 1 : -1).applyQuaternion(this.quaternion);
        }
      }

      _worldClosest.copy(_clampedPt).applyQuaternion(this.quaternion).add(this.position);

      const vehMass =
        body?.mass && Number.isFinite(body.mass)
          ? Math.max(5, body.mass)
          : Math.max(25, vehicle.totalMass ?? 900);
      const vehIsStatic = Boolean(vehicle.propRigidBody?.isStatic);
      const vehInvMass = vehIsStatic ? 0 : 1 / vehMass;
      const totalInvMass = this.invMass + vehInvMass;
      if (totalInvMass <= 0) continue;

      // Wake both bodies on contact
      const relVx = (vehVel ? vehVel.x : 0) - this.velocity.x;
      const relVy = (vehVel ? vehVel.y : 0) - this.velocity.y;
      const relVz = (vehVel ? vehVel.z : 0) - this.velocity.z;
      const vn = relVx * _pushDir.x + relVy * _pushDir.y + relVz * _pushDir.z;

      if (Math.abs(vn) > 0.35 || pen > 0.08) {
        this.wakeUp();
        if (vehicle.rigidBody?.wakeUp) vehicle.rigidBody.wakeUp();
        if (vehicle.propRigidBody?.wakeUp) vehicle.propRigidBody.wakeUp();
      }

      // Positional separation proportional to inverse mass
      const corr = Math.min(pen, 0.45) / totalInvMass;
      this.position.addScaledVector(_pushDir, -corr * this.invMass);
      if (!vehIsStatic) {
        vehicle.position.addScaledVector(_pushDir, corr * vehInvMass);
        if (vehicle.rigidBody?.position) {
          vehicle.rigidBody.position.copy(vehicle.position);
        }
        if (vehicle.propRigidBody?.position) {
          vehicle.propRigidBody.position.copy(vehicle.position);
        }
      }

      // Bidirectional impulse when approaching along collision normal, or sweep transfer when vehicle plows over/engulfs block
      const vehSpeedSq = vehVel
        ? vehVel.x * vehVel.x + vehVel.y * vehVel.y + vehVel.z * vehVel.z
        : 0;
      if (vn < 0) {
        const restitution = 0.22;
        const j = (-(1 + restitution) * vn) / totalInvMass;
        _impulseTmp.copy(_pushDir).multiplyScalar(-j);
        this.applyImpulseAtPoint(_impulseTmp, _worldClosest);

        if (!vehIsStatic) {
          _impulseTmp.copy(_pushDir).multiplyScalar(j);
          if (
            vehicle.propRigidBody &&
            typeof vehicle.propRigidBody.applyImpulseAtPoint === 'function'
          ) {
            vehicle.propRigidBody.applyImpulseAtPoint(_impulseTmp, _worldClosest);
          } else if (
            vehicle.rigidBody &&
            typeof vehicle.rigidBody.applyImpulseAtPoint === 'function'
          ) {
            vehicle.rigidBody.applyImpulseAtPoint(_impulseTmp, _worldClosest);
          } else if (vehicle.velocity) {
            vehicle.velocity.addScaledVector(_impulseTmp, vehInvMass);
          }
        }
      } else if (vehVel && vehSpeedSq > 0.25) {
        // Vehicle is actively moving while overlapping this TerrainEntity (e.g., driving straight over resting rubble):
        // wake and transfer forward + slight upward plow impulse, with equal-and-opposite drag on the vehicle!
        this.wakeUp();
        const sweepGain = 0.65 / totalInvMass;
        _impulseTmp.set(
          (vehVel.x - this.velocity.x) * sweepGain,
          Math.max(0.8 / totalInvMass, (vehVel.y - this.velocity.y) * sweepGain),
          (vehVel.z - this.velocity.z) * sweepGain,
        );
        this.applyImpulseAtPoint(_impulseTmp, _worldClosest);

        if (!vehIsStatic) {
          _impulseTmp.multiplyScalar(-1);
          if (
            vehicle.propRigidBody &&
            typeof vehicle.propRigidBody.applyImpulseAtPoint === 'function'
          ) {
            vehicle.propRigidBody.applyImpulseAtPoint(_impulseTmp, _worldClosest);
          } else if (
            vehicle.rigidBody &&
            typeof vehicle.rigidBody.applyImpulseAtPoint === 'function'
          ) {
            vehicle.rigidBody.applyImpulseAtPoint(_impulseTmp, _worldClosest);
          } else if (vehicle.velocity) {
            vehicle.velocity.addScaledVector(_impulseTmp, vehInvMass);
          }
        }
      }

      hit = true;
    }
    return hit;
  }

  /**
   * Pairwise solid OBB collision between two TerrainEntity instances (enables stacking,
   * rubble piles, and falling buildings crashing into each other!).
   */
  private static resolvePairCollision(a: TerrainEntity, b: TerrainEntity): void {
    if (a.isResting && b.isResting) return;
    const scaleA = a.getCurrentScale();
    const scaleB = b.getCurrentScale();
    if (scaleA <= 0.15 || scaleB <= 0.15) return;

    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const dz = b.position.z - a.position.z;
    const maxR = a.boundingRadius * scaleA + b.boundingRadius * scaleB;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq >= maxR * maxR) return;

    // Test B's center clamped to A's OBB, and A's center clamped to B's OBB
    _invQuatA.copy(a.quaternion).invert();
    _localPt.set(dx, dy, dz).applyQuaternion(_invQuatA);
    const ahx = a.halfExtents.x * scaleA;
    const ahy = a.halfExtents.y * scaleA;
    const ahz = a.halfExtents.z * scaleA;
    _clampedPt.set(
      Math.max(-ahx, Math.min(ahx, _localPt.x)),
      Math.max(-ahy, Math.min(ahy, _localPt.y)),
      Math.max(-ahz, Math.min(ahz, _localPt.z)),
    );
    _worldClosest.copy(_clampedPt).applyQuaternion(a.quaternion).add(a.position);

    // Transform A's closest point into B's local space to check penetration into B's OBB
    _invQuatB.copy(b.quaternion).invert();
    _deltaVec
      .set(
        _worldClosest.x - b.position.x,
        _worldClosest.y - b.position.y,
        _worldClosest.z - b.position.z,
      )
      .applyQuaternion(_invQuatB);
    const bhx = b.halfExtents.x * scaleB;
    const bhy = b.halfExtents.y * scaleB;
    const bhz = b.halfExtents.z * scaleB;

    const ox = bhx - Math.abs(_deltaVec.x);
    const oy = bhy - Math.abs(_deltaVec.y);
    const oz = bhz - Math.abs(_deltaVec.z);
    if (ox <= 0 || oy <= 0 || oz <= 0) return;

    // Minimum translation vector pointing from A -> B
    let pen = 0;
    if (oy <= ox && oy <= oz) {
      pen = oy;
      _pushDir.set(0, _deltaVec.y <= 0 ? 1 : -1, 0).applyQuaternion(b.quaternion);
    } else if (ox <= oz) {
      pen = ox;
      _pushDir.set(_deltaVec.x <= 0 ? 1 : -1, 0, 0).applyQuaternion(b.quaternion);
    } else {
      pen = oz;
      _pushDir.set(0, 0, _deltaVec.z <= 0 ? 1 : -1).applyQuaternion(b.quaternion);
    }
    // Ensure normal points from A toward B
    if (_pushDir.x * dx + _pushDir.y * dy + _pushDir.z * dz < 0) {
      _pushDir.negate();
    }

    const invMassA = a.isResting ? 0 : a.invMass;
    const invMassB = b.isResting ? 0 : b.invMass;
    const totalInv = invMassA + invMassB;
    if (totalInv <= 0) return;

    const sep = Math.min(pen, 0.35) / totalInv;
    a.position.addScaledVector(_pushDir, -sep * invMassA);
    b.position.addScaledVector(_pushDir, sep * invMassB);

    _relVel.subVectors(b.velocity, a.velocity);
    const vn = _relVel.dot(_pushDir);

    // Wake resting partner if struck hard
    if (vn < -1.8) {
      if (a.isResting) a.wakeUp();
      if (b.isResting) b.wakeUp();
    }

    if (vn < 0) {
      const restitution = 0.12;
      const effInvA = a.isResting ? 0 : a.invMass;
      const effInvB = b.isResting ? 0 : b.invMass;
      const effTotal = effInvA + effInvB;
      if (effTotal > 0) {
        const j = (-(1 + restitution) * vn) / effTotal;
        if (!a.isResting) {
          _impulseTmp.copy(_pushDir).multiplyScalar(-j);
          a.applyImpulseAtPoint(_impulseTmp, _worldClosest);
          a.velocity.multiplyScalar(0.85);
          a.angularVelocity.multiplyScalar(0.85);
        }
        if (!b.isResting) {
          _impulseTmp.copy(_pushDir).multiplyScalar(j);
          b.applyImpulseAtPoint(_impulseTmp, _worldClosest);
          b.velocity.multiplyScalar(0.85);
          b.angularVelocity.multiplyScalar(0.85);
        }
      }
    }

    // Allow stacking to settle cleanly when one entity rests vertically on top of a resting entity
    if (_pushDir.y > 0.65 && a.isResting && !b.isResting) {
      if (b.velocity.lengthSq() < 0.09 && b.angularVelocity.lengthSq() < 0.09) {
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
        b.isResting = true;
      }
    } else if (_pushDir.y < -0.65 && b.isResting && !a.isResting) {
      if (a.velocity.lengthSq() < 0.09 && a.angularVelocity.lengthSq() < 0.09) {
        a.velocity.set(0, 0, 0);
        a.angularVelocity.set(0, 0, 0);
        a.isResting = true;
      }
    }

    a.updateInstanceMatrix();
    b.updateInstanceMatrix();
  }

  private resolveStaticTerrainWalls(worldProber?: TerrainEntityWorldProber | null): void {
    if (!worldProber) return;
    const isSolid =
      worldProber.isSolidAtWorldForEntity ?? worldProber.isSolidAtWorld;
    if (!isSolid) return;

    if (!this.isStructure) {
      const h = this.size * 0.5;
      const vx = this.velocity.x;
      const vz = this.velocity.z;
      if (Math.abs(vx) > 0.02) {
        const sx = vx > 0 ? h : -h;
        if (isSolid.call(worldProber, this.position.x + sx, this.position.y, this.position.z)) {
          this.position.x -= sx * 0.5;
          this.velocity.x = -vx * 0.25;
        }
      }
      if (Math.abs(vz) > 0.02) {
        const sz = vz > 0 ? h : -h;
        if (isSolid.call(worldProber, this.position.x, this.position.y, this.position.z + sz)) {
          this.position.z -= sz * 0.5;
          this.velocity.z = -vz * 0.25;
        }
      }
      return;
    }

    const pts = this.contactPoints;
    if (!pts || pts.length === 0) return;

    // Check contact points against static walls along horizontal motion
    let pushX = 0;
    let pushZ = 0;
    let wallHits = 0;
    const step = this.size * 0.55;
    for (let i = 0; i < pts.length; i += 3) {
      _contactLocal.set(pts[i], pts[i + 1], pts[i + 2]);
      _wallProbePt.copy(_contactLocal).applyQuaternion(this.quaternion).add(this.position);
      if (isSolid.call(worldProber, _wallProbePt.x, _wallProbePt.y + this.size * 0.35, _wallProbePt.z)) {
        // Push away from penetrated point toward entity center horizontally
        const rx = this.position.x - _wallProbePt.x;
        const rz = this.position.z - _wallProbePt.z;
        const len = Math.hypot(rx, rz);
        if (len > 1e-4) {
          pushX += (rx / len) * step;
          pushZ += (rz / len) * step;
        } else {
          pushX -= Math.sign(this.velocity.x) * step;
          pushZ -= Math.sign(this.velocity.z) * step;
        }
        wallHits++;
      }
    }

    if (wallHits > 0) {
      const inv = 1 / wallHits;
      this.position.x += pushX * inv;
      this.position.z += pushZ * inv;
      this.velocity.x *= -0.18;
      this.velocity.z *= -0.18;
      this.angularVelocity.multiplyScalar(0.75);
    }
  }

  private resolveStructureGroundCollision(
    dt: number,
    worldProber?: TerrainEntityWorldProber | null,
  ): void {
    const pts = this.contactPoints;
    if (!pts || pts.length === 0) return;

    const halfVox = this.size * 0.5;
    let maxPen = 0;
    let hitCount = 0;
    let avgContactX = 0;
    let avgContactY = 0;
    let avgContactZ = 0;

    for (let i = 0; i < pts.length; i += 3) {
      _contactLocal.set(pts[i], pts[i + 1], pts[i + 2]);
      _contactWorld.copy(_contactLocal).applyQuaternion(this.quaternion).add(this.position);

      const probe = worldProber?.probeGroundBelowForEntity
        ? worldProber.probeGroundBelowForEntity(
            _contactWorld.x,
            _contactWorld.y + this.size * 3.0,
            _contactWorld.z,
            0.75,
          )
        : worldProber?.probeGroundBelow(
            _contactWorld.x,
            _contactWorld.y + this.size * 3.0,
            _contactWorld.z,
            0.75,
          );
      let groundY = probe ? probe.y : 0.25;

      // Also support stacking on top of other resting TerrainEntity structures below
      const entBelow = TerrainEntity.probeSurfaceBelow(
        _contactWorld.x,
        _contactWorld.y + this.size * 1.5,
        _contactWorld.z,
        0.5,
        this,
      );
      if (entBelow && entBelow.y > groundY) {
        groundY = entBelow.y;
      }

      const restY = groundY + halfVox;
      const pen = restY - _contactWorld.y;
      if (pen > 0) {
        hitCount++;
        avgContactX += _contactWorld.x;
        avgContactY += _contactWorld.y;
        avgContactZ += _contactWorld.z;
        if (pen > maxPen) {
          maxPen = pen;
        }
      }
    }

    if (hitCount > 0) {
      this.position.y += maxPen;

      const impactSpeed = Math.max(0, -this.velocity.y);
      if (this.velocity.y < 0) {
        this.velocity.y = impactSpeed < 1.35 ? 0 : -this.velocity.y * 0.14;
      }

      // Ground friction & angular damping
      const linDamp = Math.pow(0.18, dt * 6.0);
      this.velocity.x *= linDamp;
      this.velocity.z *= linDamp;

      // Apply physical tipping torque ONLY when contact lever arm is off-center (uneven terrain/ledge)
      const invHits = 1 / hitCount;
      _leverArm.set(
        avgContactX * invHits - this.position.x,
        avgContactY * invHits - this.position.y,
        avgContactZ * invHits - this.position.z,
      );
      const horizLeverSq = _leverArm.x * _leverArm.x + _leverArm.z * _leverArm.z;
      if (horizLeverSq > 0.01) {
        const inertiaScale = Math.max(0.5, this.boundingRadius * this.boundingRadius);
        const upReaction = Math.min(8.0, 9.81 * dt + impactSpeed * 0.35);
        this.angularVelocity.x += (-_leverArm.z * upReaction) / inertiaScale;
        this.angularVelocity.z += (_leverArm.x * upReaction) / inertiaScale;
      }

      const angDamp = Math.pow(0.12, dt * 5.0);
      this.angularVelocity.multiplyScalar(angDamp);

      const linSpeedSq =
        this.velocity.x * this.velocity.x +
        this.velocity.y * this.velocity.y +
        this.velocity.z * this.velocity.z;
      const angSpeedSq =
        this.angularVelocity.x * this.angularVelocity.x +
        this.angularVelocity.y * this.angularVelocity.y +
        this.angularVelocity.z * this.angularVelocity.z;

      if (linSpeedSq < 0.16 && angSpeedSq < 0.09) {
        this.groundedSettleTimer += dt;
      } else {
        this.groundedSettleTimer += dt * 0.25;
      }

      if (this.groundedSettleTimer >= 0.35 || (linSpeedSq < 0.04 && angSpeedSq < 0.03)) {
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.isResting = true;
      }
    } else {
      this.groundedSettleTimer = 0;
    }
  }

  public update(
    dt: number,
    activeVehicles: TerrainEntityVehicleLike[] = [],
    worldProber?: TerrainEntityWorldProber | null,
  ): boolean {
    if (dt <= 0) return true;

    if (this.isResting) {
      this.lifetime -= dt;
      if (this.lifetime <= 0) {
        this.removeFromActive();
        return false;
      }

      if (activeVehicles.length > 0 && this.lifetime >= TerrainEntity.FADE_DURATION_SEC) {
        if (this.applyVehicleCollision(activeVehicles, true)) {
          this.position.addScaledVector(this.velocity, Math.min(dt, 0.05));
          this.updateInstanceMatrix();
          return true;
        }
      }

      if (this.lifetime < TerrainEntity.FADE_DURATION_SEC) {
        this.updateInstanceMatrix();
      }
      return true;
    }

    // Pure gravity
    this.velocity.y -= 9.81 * dt;

    // Integrate linear motion & light air drag
    this.position.addScaledVector(this.velocity, dt);
    this.velocity.multiplyScalar(0.994);

    // Simplified quaternion integration from angularVelocity (zero allocations)
    const wx = this.angularVelocity.x;
    const wy = this.angularVelocity.y;
    const wz = this.angularVelocity.z;
    if (wx !== 0 || wy !== 0 || wz !== 0) {
      const halfDt = 0.5 * dt;
      const qx = this.quaternion.x;
      const qy = this.quaternion.y;
      const qz = this.quaternion.z;
      const qw = this.quaternion.w;
      this.quaternion.set(
        qx + halfDt * (wx * qw + wy * qz - wz * qy),
        qy + halfDt * (wy * qw + wz * qx - wx * qz),
        qz + halfDt * (wz * qw + wx * qy - wy * qx),
        qw + halfDt * (-wx * qx - wy * qy - wz * qz),
      );
      this.quaternion.normalize();
      this.angularVelocity.multiplyScalar(0.988);
    }

    // Static terrain wall collision
    this.resolveStaticTerrainWalls(worldProber);

    if (this.isStructure) {
      this.resolveStructureGroundCollision(dt, worldProber);
    } else {
      const probe = worldProber?.probeGroundBelowForEntity
        ? worldProber.probeGroundBelowForEntity(
            this.position.x,
            this.position.y + this.size * 2.0,
            this.position.z,
            0.5,
          )
        : worldProber?.probeGroundBelow(
            this.position.x,
            this.position.y + this.size * 2.0,
            this.position.z,
            0.5,
          );
      let groundY = probe ? probe.y : 0.25;
      const entBelow = TerrainEntity.probeSurfaceBelow(
        this.position.x,
        this.position.y + this.size,
        this.position.z,
        0.5,
        this,
      );
      if (entBelow && entBelow.y > groundY) {
        groundY = entBelow.y;
      }
      const restY = groundY + this.size * 0.5;
      if (this.position.y <= restY && this.velocity.y <= 0) {
        this.position.y = restY;
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.isResting = true;
      }
    }

    // Solid vehicle & dynamic prop collision
    if (activeVehicles.length > 0) {
      this.applyVehicleCollision(activeVehicles, false);
    }

    this.updateInstanceMatrix();
    return true;
  }

  public static updateAll(
    dt: number,
    activeVehicles: TerrainEntityVehicleLike[] = [],
    worldProber?: TerrainEntityWorldProber | null,
  ): void {
    const list = TerrainEntity.active;
    if (list.length === 0) return;

    for (let i = list.length - 1; i >= 0; i--) {
      const entity = list[i];
      if (entity) {
        entity.update(dt, activeVehicles, worldProber);
      }
    }

    // Pairwise TerrainEntity-vs-TerrainEntity collision (stacking, bouncing, pushing)
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const a = list[i];
      for (let j = i + 1; j < count; j++) {
        TerrainEntity.resolvePairCollision(a, list[j]);
      }
    }

    TerrainEntity.flushGpuBuffers();
  }

  public static flushGpuBuffers(): void {
    if (TerrainEntity.meshDirty) {
      TerrainEntity.sharedMesh.instanceMatrix.needsUpdate = true;
      TerrainEntity.meshDirty = false;
    }
    if (TerrainEntity.colorDirty && TerrainEntity.sharedMesh.instanceColor) {
      TerrainEntity.sharedMesh.instanceColor.needsUpdate = true;
      TerrainEntity.colorDirty = false;
    }
  }

  public static clearAll(): void {
    const mesh = TerrainEntity.ensureSharedMesh();
    for (let i = TerrainEntity.active.length - 1; i >= 0; i--) {
      const ent = TerrainEntity.active[i];
      if (ent.debrisSlot >= 0) {
        ent.voxelWorld.releaseDebris(ent.debrisSlot);
        ent.debrisSlot = -1;
      }
      if (ent.isStructure && ent.mesh) {
        if (ent.mesh.parent) {
          ent.mesh.parent.remove(ent.mesh);
        }
        ent.mesh.geometry.dispose();
      }
    }
    for (let i = 0; i < TerrainEntity.MAX_INSTANCES; i++) {
      mesh.setMatrixAt(i, _zeroMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    TerrainEntity.active.length = 0;
    TerrainEntity.freeSlots = TerrainEntity.createInitialSlotStack();
    TerrainEntity.meshDirty = false;
    TerrainEntity.colorDirty = false;
  }

  public static dispose(scene?: THREE.Scene | null): void {
    TerrainEntity.clearAll();
    if (scene && TerrainEntity.sharedMesh.parent === scene) {
      scene.remove(TerrainEntity.sharedMesh);
    }
    TerrainEntity.sharedMesh.geometry.dispose();
    if (TerrainEntity.sharedMesh.material instanceof THREE.Material) {
      TerrainEntity.sharedMesh.material.dispose();
    }
    TerrainEntity.sharedMesh.dispose();
    TerrainEntity.sharedStructureMaterial.dispose();
    TerrainEntity.attachedScene = null;
    TerrainEntity.isDisposed = true;
  }
}

/**
 * Manager facade for spawning and updating physics TerrainEntity instances
 * (both unified multi-voxel falling terrain structures and single-voxel blast debris).
 */
export interface TerrainEntityManagerAPI {
  spawnStructure(
    voxels: ReadonlyArray<TerrainVoxelCoord>,
    opts?: TerrainStructureSpawnOptions,
  ): TerrainEntity | null;
  spawnEntity(opts: TerrainEntitySpawnOptions): TerrainEntity;
  spawnEntity(
    worldX: number,
    worldY: number,
    worldZ: number,
    color: number,
    size?: number,
    scene?: THREE.Scene | null,
  ): TerrainEntity;
  spawnTerrainVoxelDebris(
    wx: number,
    wy: number,
    wz: number,
    colorHex: number,
    blastCenterX?: number,
    blastCenterY?: number,
    blastCenterZ?: number,
    scene?: THREE.Scene | null,
  ): TerrainEntity;
  spawnCollapsedVoxel(
    wx: number,
    wy: number,
    wz: number,
    colorHex: number,
    scene?: THREE.Scene | null,
  ): TerrainEntity;
  attachToScene(scene?: THREE.Scene | null): THREE.InstancedMesh;
  updateAll(
    dt: number,
    activeVehicles?: TerrainEntityVehicleLike[],
    worldProber?: TerrainEntityWorldProber | null,
  ): void;
  clearAll(): void;
  readonly active: TerrainEntity[];
}

export const terrainEntityManager: TerrainEntityManagerAPI = {
  spawnStructure(
    voxels: ReadonlyArray<TerrainVoxelCoord>,
    opts?: TerrainStructureSpawnOptions,
  ): TerrainEntity | null {
    return TerrainEntity.spawnStructure(voxels, opts);
  },
  spawnEntity(
    optsOrX: TerrainEntitySpawnOptions | number,
    worldY?: number,
    worldZ?: number,
    color?: number,
    size: number = TerrainEntity.DEFAULT_SIZE,
    scene?: THREE.Scene | null,
  ): TerrainEntity {
    const entity =
      typeof optsOrX === 'number'
        ? TerrainEntity.spawn({
            position: { x: optsOrX, y: worldY ?? 0, z: worldZ ?? 0 },
            velocity: { x: 0, y: 0, z: 0 },
            angularVelocity: { x: 0, y: 0, z: 0 },
            color: color ?? 0x94a3b8,
            size,
            scene,
          })
        : TerrainEntity.spawn(optsOrX);
    TerrainEntity.flushGpuBuffers();
    return entity;
  },
  spawnTerrainVoxelDebris(
    wx: number,
    wy: number,
    wz: number,
    colorHex: number,
    blastCenterX?: number,
    blastCenterY?: number,
    blastCenterZ?: number,
    scene?: THREE.Scene | null,
  ): TerrainEntity {
    const entity = TerrainEntity.spawnTerrainVoxelDebris(
      wx,
      wy,
      wz,
      colorHex,
      blastCenterX,
      blastCenterY,
      blastCenterZ,
      scene,
    );
    TerrainEntity.flushGpuBuffers();
    return entity;
  },
  spawnCollapsedVoxel(
    wx: number,
    wy: number,
    wz: number,
    colorHex: number,
    scene?: THREE.Scene | null,
  ): TerrainEntity {
    const entity = TerrainEntity.spawnCollapsedVoxel(
      wx,
      wy,
      wz,
      colorHex,
      scene,
    );
    TerrainEntity.flushGpuBuffers();
    return entity;
  },
  attachToScene(scene?: THREE.Scene | null): THREE.InstancedMesh {
    return TerrainEntity.attachToScene(scene);
  },
  updateAll(
    dt: number,
    activeVehicles: TerrainEntityVehicleLike[] = [],
    worldProber?: TerrainEntityWorldProber | null,
  ): void {
    TerrainEntity.updateAll(dt, activeVehicles, worldProber);
  },
  clearAll(): void {
    TerrainEntity.clearAll();
  },
  get active(): TerrainEntity[] {
    return TerrainEntity.active;
  },
};
