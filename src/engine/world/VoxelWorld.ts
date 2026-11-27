import { Vector3 } from '../math/Vector3';
import { Quaternion } from '../math/Quaternion';
import type { Vector3Like, Vector4Like } from '../math/constants';
import { perfProfiler } from '../perf/PerfProfiler';

export const DEFAULT_MAX_CHUNKS = 512;
export const DEFAULT_MAX_BODIES = 256;
export const DEFAULT_MAX_DEBRIS = 2000;
export const DEFAULT_CHUNK_X = 64;
export const DEFAULT_CHUNK_Y = 320;
export const DEFAULT_CHUNK_Z = 64;
export const DEFAULT_FIXED_DT = 1 / 60;
export const DEFAULT_DEBRIS_SIZE = 0.25;
export const DEFAULT_DEBRIS_LIFETIME = 8.0;
export const MAT_BUCKET_ALL_MASK_DEFAULT = 0x0f;

const EMPTY_UINT8 = new Uint8Array(0);
const EMPTY_UINT16 = new Uint16Array(0);

export interface BodyVoxelMapLike {
  readonly size: number;
  get(key: number): number | undefined;
  set(key: number, value: number): unknown;
  has(key: number): boolean;
  delete(key: number): boolean;
}

export interface BodyRootGroupLike {
  visible: boolean;
  position: Vector3Like;
  quaternion: Vector4Like;
}

export type VoxelDestroyCause = 'damage' | 'explosion' | 'collision' | 'collapse' | 'edit';

export interface ExplosionEvent {
  x: number;
  y: number;
  z: number;
  radius: number;
  force: number;
  depth: number;
  radiusVoxels: number;
  time: number;
}

export interface DamageEvent {
  bodySlot: number;
  voxelKey: number;
  damage: number;
  time: number;
}

export interface VoxelDestroyedEvent {
  worldX: number;
  worldY: number;
  worldZ: number;
  materialId: number;
  cause: VoxelDestroyCause;
  time: number;
}

export interface VisibilityChangedEvent {
  chunkSlot: number;
  visible: boolean;
  time: number;
}

export interface BodySleepEvent {
  bodySlot: number;
  sleeping: boolean;
  time: number;
}

export interface DrainedVoxelWorldEvents {
  explosionEvents: ExplosionEvent[];
  damageEvents: DamageEvent[];
  voxelDestroyedEvents: VoxelDestroyedEvent[];
  visibilityChangedEvents: VisibilityChangedEvent[];
  bodySleepEvents: BodySleepEvent[];
}

export interface VoxelWorldCallbacks {
  onVoxelDestroyed?: (event: VoxelDestroyedEvent) => void;
  onBodySleep?: (event: BodySleepEvent) => void;
  onExplosion?: (event: ExplosionEvent) => void;
}

export interface VoxelWorldStepOptions {
  timeScale?: number;
  maxSubsteps?: number;
  maxAccumulatedDt?: number;
  onFixedStep?: (fixedDt: number) => void;
  onResolveCollisions?: (fixedDt: number) => void;
  drainEvents?: boolean;
}

export interface VoxelWorldOptions {
  maxChunks?: number;
  maxBodies?: number;
  maxDebris?: number;
  chunkX?: number;
  chunkY?: number;
  chunkZ?: number;
  fixedDt?: number;
  callbacks?: VoxelWorldCallbacks;
}

export interface AcquireChunkSlotOptions {
  voxels?: Uint8Array;
  surfaceOnly?: boolean;
  surfaceChunkY?: number;
  surfaceHeightMap?: Uint16Array;
  customColors?: Uint8Array | null;
  allocateDamage?: boolean;
}

/**
 * Deterministic 32-bit chunk ID encoder for (cx, cz) chunk grid coordinates.
 * Supports chunk coordinates in [-32768, 32767] on both axes without collisions.
 */
export function encodeChunkId(cx: number, cz: number): number {
  return ((cx + 32768) & 0xffff) | (((cz + 32768) & 0xffff) << 16);
}

/**
 * VoxelWorld — Single Source of Truth (Structure-of-Arrays) for all shared game state.
 *
 * Owns 4 parallel typed-array table sections:
 * 1. Chunk Tables (voxel material data, damage HP, dirty masks, visibility, mesh/physics versions)
 * 2. Body Tables (vehicles & rigid bodies: transforms, velocities, mass/inertia, sleep, visibility, voxel maps)
 * 3. Debris Tables (falling voxel cubes: transforms, velocities, colors, sizes, lifetimes, active/resting flags)
 * 4. Event Queues (cross-system communication: explosions, damage, voxel destruction, visibility, body sleep)
 */
export class VoxelWorld {
  public maxChunks: number;
  public maxBodies: number;
  public maxDebris: number;
  public readonly chunkX: number;
  public readonly chunkY: number;
  public readonly chunkZ: number;
  public readonly chunkVolume: number;

  // =========================================================================
  // SECTION 1: CHUNK TABLES
  // =========================================================================
  public chunkIds: Int32Array;
  public chunkVoxels: Uint8Array[];
  public chunkDamage: (Uint8Array | null)[];
  public chunkDirty: Uint8Array;
  public chunkDirtyBucketMask: Uint32Array;
  public chunkVisible: Uint8Array;
  public chunkMeshVersion: Uint32Array;
  public chunkPhysicsVersion: Uint32Array;
  public chunkPendingRemovals: Map<number, number>[];
  public chunkSurfaceHeightMap: Uint16Array[];
  public chunkCustomColors: (Uint8Array | null)[];
  public chunkWorldX: Int32Array;
  public chunkWorldY: Int32Array;
  public chunkWorldZ: Int32Array;

  /** Optional single zero-copy SharedArrayBuffer slabs for compact surface-only chunks */
  public readonly surfaceSlabCapacity: number;
  public readonly surfaceVoxelsStride: number;
  public readonly surfaceHeightStride: number;
  public readonly surfaceVoxelsSab: SharedArrayBuffer | null;
  public readonly surfaceHeightSab: SharedArrayBuffer | null;
  public readonly usesSharedSurfaceSlab: boolean;
  private _surfaceVoxelsSlabView: Uint8Array | null = null;
  private _surfaceHeightSlabView: Uint16Array | null = null;

  private _chunkIdToSlot = new Map<number, number>();
  private _chunkOriginToSlot = new Map<string, number>();
  private _freeChunkSlots: number[] = [];
  private _activeChunkCount = 0;

  // =========================================================================
  // SECTION 2: BODY TABLES (vehicles & rigid bodies)
  // =========================================================================
  public bodyIds: Int32Array;
  public bodyPositions: Float32Array;
  public bodyVelocities: Float32Array;
  public bodyQuaternions: Float32Array;
  public bodyAngularVelocities: Float32Array;
  public bodyMasses: Float32Array;
  public bodyInvMasses: Float32Array;
  public bodyInertiaLocal: Float32Array;
  public bodyInvInertiaLocal: Float32Array;
  public bodyForces: Float32Array;
  public bodyTorques: Float32Array;
  public bodyLinearDamping: Float64Array;
  public bodyAngularDamping: Float64Array;
  public bodyComLocal: Float32Array;
  public bodyMaxLinearSpeed: Float32Array;
  public bodyMaxAngularSpeed: Float32Array;
  public bodyIntegratedThisStep: Uint8Array;
  public bodySleepStates: Uint8Array;
  public bodyVisible: Uint8Array;
  public bodyCollisionPoints: (Float32Array | null)[];
  public bodyHullSamples: (Float32Array | null)[];
  public bodyVoxelMaps: (BodyVoxelMapLike | null)[];
  public bodyRootGroups: (BodyRootGroupLike | null)[];

  private _bodyIdToSlot = new Map<number, number>();
  private _freeBodySlots: number[] = [];
  private _nextAutoBodyId = 1;
  private _activeBodyCount = 0;

  // =========================================================================
  // SECTION 3: DEBRIS TABLES (falling voxel cubes)
  // =========================================================================
  public debrisPositions: Float32Array;
  public debrisVelocities: Float32Array;
  public debrisQuaternions: Float32Array;
  public debrisAngularVelocities: Float32Array;
  public debrisColors: Uint32Array;
  public debrisSizes: Float32Array;
  public debrisLifetimes: Float32Array;
  public debrisMaxLifetimes: Float32Array;
  public debrisActive: Uint8Array;
  public debrisResting: Uint8Array;

  private _debrisSpawnSeq: Uint32Array;
  private _debrisNextSeq = 1;
  private _activeDebrisCount = 0;

  // =========================================================================
  // SECTION 4: EVENTS (cross-system communication)
  // =========================================================================
  public explosionEvents: ExplosionEvent[] = [];
  public damageEvents: DamageEvent[] = [];
  public voxelDestroyedEvents: VoxelDestroyedEvent[] = [];
  public visibilityChangedEvents: VisibilityChangedEvent[] = [];
  public bodySleepEvents: BodySleepEvent[] = [];

  // =========================================================================
  // CLASS-LEVEL CLOCK & CALLBACKS
  // =========================================================================
  public currentTime = 0;
  public accumulator = 0;
  public fixedDt: number;
  public callbacks: VoxelWorldCallbacks;

  constructor(options: VoxelWorldOptions = {}) {
    this.maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS);
    this.maxBodies = Math.max(1, options.maxBodies ?? DEFAULT_MAX_BODIES);
    this.maxDebris = Math.max(1, options.maxDebris ?? DEFAULT_MAX_DEBRIS);
    this.chunkX = Math.max(1, options.chunkX ?? DEFAULT_CHUNK_X);
    this.chunkY = Math.max(1, options.chunkY ?? DEFAULT_CHUNK_Y);
    this.chunkZ = Math.max(1, options.chunkZ ?? DEFAULT_CHUNK_Z);
    this.chunkVolume = this.chunkX * this.chunkY * this.chunkZ;
    this.fixedDt = options.fixedDt ?? DEFAULT_FIXED_DT;
    this.callbacks = options.callbacks ? { ...options.callbacks } : {};

    // Allocate a single zero-copy SharedArrayBuffer slab for surface-only chunks when crossOriginIsolated.
    // Cap at 256 slots (15x15 = 225 chunks + headroom) to keep shared RAM compact (~6 MB instead of 12 MB).
    this.surfaceSlabCapacity = Math.min(this.maxChunks, 256);
    this.surfaceVoxelsStride = this.chunkX * 4 * this.chunkZ;
    this.surfaceHeightStride = this.chunkX * this.chunkZ;
    const canUseSharedSlab =
      typeof SharedArrayBuffer !== 'undefined' &&
      Boolean((globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated) &&
      this.chunkX === DEFAULT_CHUNK_X &&
      this.chunkZ === DEFAULT_CHUNK_Z;
    if (canUseSharedSlab) {
      let vSab: SharedArrayBuffer | null = null;
      let hSab: SharedArrayBuffer | null = null;
      try {
        vSab = new SharedArrayBuffer(this.surfaceSlabCapacity * this.surfaceVoxelsStride);
        hSab = new SharedArrayBuffer(this.surfaceSlabCapacity * this.surfaceHeightStride * 2);
      } catch {
        vSab = null;
        hSab = null;
      }
      this.surfaceVoxelsSab = vSab;
      this.surfaceHeightSab = hSab;
      this.usesSharedSurfaceSlab = vSab !== null && hSab !== null;
      if (this.usesSharedSurfaceSlab) {
        this._surfaceVoxelsSlabView = new Uint8Array(vSab!);
        this._surfaceHeightSlabView = new Uint16Array(hSab!);
      }
    } else {
      this.surfaceVoxelsSab = null;
      this.surfaceHeightSab = null;
      this.usesSharedSurfaceSlab = false;
    }

    // Section 1: Chunk Tables
    this.chunkIds = new Int32Array(this.maxChunks).fill(-1);
    this.chunkVoxels = new Array<Uint8Array>(this.maxChunks);
    this.chunkDamage = new Array<Uint8Array | null>(this.maxChunks);
    this.chunkDirty = new Uint8Array(this.maxChunks);
    this.chunkDirtyBucketMask = new Uint32Array(this.maxChunks);
    this.chunkVisible = new Uint8Array(this.maxChunks);
    this.chunkMeshVersion = new Uint32Array(this.maxChunks);
    this.chunkPhysicsVersion = new Uint32Array(this.maxChunks);
    this.chunkPendingRemovals = new Array<Map<number, number>>(this.maxChunks);
    this.chunkSurfaceHeightMap = new Array<Uint16Array>(this.maxChunks);
    this.chunkCustomColors = new Array<Uint8Array | null>(this.maxChunks);
    this.chunkWorldX = new Int32Array(this.maxChunks);
    this.chunkWorldY = new Int32Array(this.maxChunks);
    this.chunkWorldZ = new Int32Array(this.maxChunks);

    for (let i = 0; i < this.maxChunks; i++) {
      this.chunkVoxels[i] = EMPTY_UINT8;
      this.chunkDamage[i] = null;
      this.chunkPendingRemovals[i] = new Map<number, number>();
      this.chunkSurfaceHeightMap[i] = EMPTY_UINT16;
      this.chunkCustomColors[i] = null;
    }
    for (let i = this.maxChunks - 1; i >= 0; i--) {
      this._freeChunkSlots.push(i);
    }

    // Section 2: Body Tables
    this.bodyIds = new Int32Array(this.maxBodies).fill(-1);
    this.bodyPositions = new Float32Array(this.maxBodies * 3);
    this.bodyVelocities = new Float32Array(this.maxBodies * 3);
    this.bodyQuaternions = new Float32Array(this.maxBodies * 4);
    this.bodyAngularVelocities = new Float32Array(this.maxBodies * 3);
    this.bodyMasses = new Float32Array(this.maxBodies);
    this.bodyInvMasses = new Float32Array(this.maxBodies);
    this.bodyInertiaLocal = new Float32Array(this.maxBodies * 3);
    this.bodyInvInertiaLocal = new Float32Array(this.maxBodies * 3);
    this.bodyForces = new Float32Array(this.maxBodies * 3);
    this.bodyTorques = new Float32Array(this.maxBodies * 3);
    this.bodyLinearDamping = new Float64Array(this.maxBodies);
    this.bodyAngularDamping = new Float64Array(this.maxBodies);
    this.bodyComLocal = new Float32Array(this.maxBodies * 3);
    this.bodyMaxLinearSpeed = new Float32Array(this.maxBodies);
    this.bodyMaxAngularSpeed = new Float32Array(this.maxBodies);
    this.bodyIntegratedThisStep = new Uint8Array(this.maxBodies);
    this.bodySleepStates = new Uint8Array(this.maxBodies);
    this.bodyVisible = new Uint8Array(this.maxBodies);
    this.bodyCollisionPoints = new Array<Float32Array | null>(this.maxBodies).fill(null);
    this.bodyHullSamples = new Array<Float32Array | null>(this.maxBodies).fill(null);
    this.bodyVoxelMaps = new Array<BodyVoxelMapLike | null>(this.maxBodies).fill(null);
    this.bodyRootGroups = new Array<BodyRootGroupLike | null>(this.maxBodies).fill(null);

    for (let i = 0; i < this.maxBodies; i++) {
      this.bodyQuaternions[i * 4 + 3] = 1;
      this.bodyMasses[i] = 1;
      this.bodyInvMasses[i] = 1;
      this.bodyInertiaLocal[i * 3] = 1;
      this.bodyInertiaLocal[i * 3 + 1] = 1;
      this.bodyInertiaLocal[i * 3 + 2] = 1;
      this.bodyInvInertiaLocal[i * 3] = 1;
      this.bodyInvInertiaLocal[i * 3 + 1] = 1;
      this.bodyInvInertiaLocal[i * 3 + 2] = 1;
      this.bodyLinearDamping[i] = 0.06;
      this.bodyAngularDamping[i] = 0.15;
      this.bodyMaxLinearSpeed[i] = 48.0;
      this.bodyMaxAngularSpeed[i] = 8.0;
    }
    for (let i = this.maxBodies - 1; i >= 0; i--) {
      this._freeBodySlots.push(i);
    }

    // Section 3: Debris Tables
    this.debrisPositions = new Float32Array(this.maxDebris * 3);
    this.debrisVelocities = new Float32Array(this.maxDebris * 3);
    this.debrisQuaternions = new Float32Array(this.maxDebris * 4);
    this.debrisAngularVelocities = new Float32Array(this.maxDebris * 3);
    this.debrisColors = new Uint32Array(this.maxDebris);
    this.debrisSizes = new Float32Array(this.maxDebris);
    this.debrisLifetimes = new Float32Array(this.maxDebris);
    this.debrisMaxLifetimes = new Float32Array(this.maxDebris);
    this.debrisActive = new Uint8Array(this.maxDebris);
    this.debrisResting = new Uint8Array(this.maxDebris);
    this._debrisSpawnSeq = new Uint32Array(this.maxDebris);

    for (let i = 0; i < this.maxDebris; i++) {
      this.debrisQuaternions[i * 4 + 3] = 1;
      this.debrisSizes[i] = DEFAULT_DEBRIS_SIZE;
    }
  }

  // =========================================================================
  // SECTION 1: CHUNK TABLE METHODS
  // =========================================================================

  public get activeChunkCount(): number {
    return this._activeChunkCount;
  }

  private _originKey(originX: number, originY: number, originZ: number): string {
    return `${originX},${originY},${originZ}`;
  }

  private _growChunkCapacity(): void {
    const oldCap = this.maxChunks;
    const newCap = oldCap * 2;
    this.maxChunks = newCap;

    const growI32 = (src: Int32Array, fillVal = 0): Int32Array => {
      const dst = new Int32Array(newCap);
      if (fillVal !== 0) dst.fill(fillVal);
      dst.set(src);
      return dst;
    };
    const growU8 = (src: Uint8Array): Uint8Array => {
      const dst = new Uint8Array(newCap);
      dst.set(src);
      return dst;
    };
    const growU32 = (src: Uint32Array): Uint32Array => {
      const dst = new Uint32Array(newCap);
      dst.set(src);
      return dst;
    };

    this.chunkIds = growI32(this.chunkIds, -1);
    this.chunkDirty = growU8(this.chunkDirty);
    this.chunkDirtyBucketMask = growU32(this.chunkDirtyBucketMask);
    this.chunkVisible = growU8(this.chunkVisible);
    this.chunkMeshVersion = growU32(this.chunkMeshVersion);
    this.chunkPhysicsVersion = growU32(this.chunkPhysicsVersion);
    this.chunkWorldX = growI32(this.chunkWorldX);
    this.chunkWorldY = growI32(this.chunkWorldY);
    this.chunkWorldZ = growI32(this.chunkWorldZ);

    for (let i = oldCap; i < newCap; i++) {
      this.chunkVoxels.push(EMPTY_UINT8);
      this.chunkDamage.push(null);
      this.chunkPendingRemovals.push(new Map<number, number>());
      this.chunkSurfaceHeightMap.push(EMPTY_UINT16);
      this.chunkCustomColors.push(null);
    }
    for (let i = newCap - 1; i >= oldCap; i--) {
      this._freeChunkSlots.push(i);
    }
  }

  public acquireChunkSlot(
    chunkId: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    options: AcquireChunkSlotOptions = {},
  ): number {
    const existing = this._chunkIdToSlot.get(chunkId);
    if (existing !== undefined) {
      return existing;
    }

    if (this._freeChunkSlots.length === 0) {
      this._growChunkCapacity();
    }
    const slotIndex = this._freeChunkSlots.pop()!;

    const surfaceChunkY = options.surfaceChunkY ?? 4;
    const voxelLen = options.voxels
      ? options.voxels.length
      : options.surfaceOnly
        ? this.chunkX * surfaceChunkY * this.chunkZ
        : this.chunkVolume;

    this.chunkIds[slotIndex] = chunkId;
    if (options.voxels) {
      this.chunkVoxels[slotIndex] = options.voxels;
    } else if (
      options.surfaceOnly &&
      this._surfaceVoxelsSlabView &&
      slotIndex < this.surfaceSlabCapacity &&
      voxelLen === this.surfaceVoxelsStride
    ) {
      const start = slotIndex * this.surfaceVoxelsStride;
      const view = this._surfaceVoxelsSlabView.subarray(start, start + voxelLen);
      view.fill(0);
      this.chunkVoxels[slotIndex] = view;
    } else {
      this.chunkVoxels[slotIndex] = new Uint8Array(voxelLen);
    }

    // Allocate damage table eagerly for small chunk volumes or when explicitly requested,
    // and lazily on first damageVoxel() for full 1.3MB game chunks to keep RAM footprint bounded.
    if (options.allocateDamage === true || (options.allocateDamage !== false && voxelLen <= 65536)) {
      const dmg = new Uint8Array(voxelLen);
      dmg.fill(255);
      this.chunkDamage[slotIndex] = dmg;
    } else {
      this.chunkDamage[slotIndex] = null;
    }

    this.chunkDirty[slotIndex] = 0;
    this.chunkDirtyBucketMask[slotIndex] = MAT_BUCKET_ALL_MASK_DEFAULT;
    this.chunkVisible[slotIndex] = 0;
    this.chunkMeshVersion[slotIndex] = 0;
    this.chunkPhysicsVersion[slotIndex] = 0;
    this.chunkPendingRemovals[slotIndex].clear();
    if (options.surfaceHeightMap) {
      this.chunkSurfaceHeightMap[slotIndex] = options.surfaceHeightMap;
    } else if (
      this._surfaceHeightSlabView &&
      slotIndex < this.surfaceSlabCapacity
    ) {
      const hStart = slotIndex * this.surfaceHeightStride;
      const hView = this._surfaceHeightSlabView.subarray(
        hStart,
        hStart + this.surfaceHeightStride,
      );
      hView.fill(0);
      this.chunkSurfaceHeightMap[slotIndex] = hView;
    } else {
      this.chunkSurfaceHeightMap[slotIndex] = new Uint16Array(this.chunkX * this.chunkZ);
    }
    this.chunkCustomColors[slotIndex] = options.customColors ?? null;
    this.chunkWorldX[slotIndex] = worldX | 0;
    this.chunkWorldY[slotIndex] = worldY | 0;
    this.chunkWorldZ[slotIndex] = worldZ | 0;

    this._chunkIdToSlot.set(chunkId, slotIndex);
    this._chunkOriginToSlot.set(this._originKey(worldX | 0, worldY | 0, worldZ | 0), slotIndex);
    this._activeChunkCount++;
    return slotIndex;
  }

  public releaseChunkSlot(slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= this.maxChunks) return;
    const chunkId = this.chunkIds[slotIndex];
    if (chunkId === -1) return;

    this._chunkIdToSlot.delete(chunkId);
    const originKey = this._originKey(
      this.chunkWorldX[slotIndex],
      this.chunkWorldY[slotIndex],
      this.chunkWorldZ[slotIndex],
    );
    if (this._chunkOriginToSlot.get(originKey) === slotIndex) {
      this._chunkOriginToSlot.delete(originKey);
    }

    this.chunkIds[slotIndex] = -1;
    this.chunkVoxels[slotIndex] = EMPTY_UINT8;
    this.chunkDamage[slotIndex] = null;
    this.chunkDirty[slotIndex] = 0;
    this.chunkDirtyBucketMask[slotIndex] = 0;
    this.chunkVisible[slotIndex] = 0;
    this.chunkMeshVersion[slotIndex] = 0;
    this.chunkPhysicsVersion[slotIndex] = 0;
    this.chunkPendingRemovals[slotIndex].clear();
    this.chunkSurfaceHeightMap[slotIndex] = EMPTY_UINT16;
    this.chunkCustomColors[slotIndex] = null;
    this.chunkWorldX[slotIndex] = 0;
    this.chunkWorldY[slotIndex] = 0;
    this.chunkWorldZ[slotIndex] = 0;

    this._freeChunkSlots.push(slotIndex);
    this._activeChunkCount = Math.max(0, this._activeChunkCount - 1);
  }

  public getChunkSlotByWorld(worldX: number, worldY: number, worldZ: number): number {
    const ox = Math.floor(worldX / this.chunkX) * this.chunkX;
    const oy = Math.floor(worldY / this.chunkY) * this.chunkY;
    const oz = Math.floor(worldZ / this.chunkZ) * this.chunkZ;
    const slot = this._chunkOriginToSlot.get(this._originKey(ox, oy, oz));
    return slot !== undefined ? slot : -1;
  }

  public getChunkSlotById(chunkId: number): number {
    const slot = this._chunkIdToSlot.get(chunkId);
    return slot !== undefined ? slot : -1;
  }

  public getLocalVoxelIndex(lx: number, ly: number, lz: number): number {
    return lx + this.chunkX * (ly + this.chunkY * lz);
  }

  public getVoxel(worldX: number, worldY: number, worldZ: number): number {
    const wx = Math.floor(worldX);
    const wy = Math.floor(worldY);
    const wz = Math.floor(worldZ);
    const slot = this.getChunkSlotByWorld(wx, wy, wz);
    if (slot < 0) return 0;

    const voxels = this.chunkVoxels[slot];
    if (voxels.length < this.chunkVolume) return 0;

    const lx = wx - this.chunkWorldX[slot];
    const ly = wy - this.chunkWorldY[slot];
    const lz = wz - this.chunkWorldZ[slot];
    if (
      lx < 0 ||
      lx >= this.chunkX ||
      ly < 0 ||
      ly >= this.chunkY ||
      lz < 0 ||
      lz >= this.chunkZ
    ) {
      return 0;
    }
    return voxels[lx + this.chunkX * (ly + this.chunkY * lz)];
  }

  public setVoxel(worldX: number, worldY: number, worldZ: number, materialId: number): void {
    const wx = Math.floor(worldX);
    const wy = Math.floor(worldY);
    const wz = Math.floor(worldZ);
    const slot = this.getChunkSlotByWorld(wx, wy, wz);
    if (slot < 0) return;

    const voxels = this.chunkVoxels[slot];
    if (voxels.length < this.chunkVolume) return;

    const lx = wx - this.chunkWorldX[slot];
    const ly = wy - this.chunkWorldY[slot];
    const lz = wz - this.chunkWorldZ[slot];
    if (
      lx < 0 ||
      lx >= this.chunkX ||
      ly < 0 ||
      ly >= this.chunkY ||
      lz < 0 ||
      lz >= this.chunkZ
    ) {
      return;
    }

    const idx = lx + this.chunkX * (ly + this.chunkY * lz);
    const mat = materialId & 0xff;
    if (voxels[idx] === mat) return;

    voxels[idx] = mat;
    const dmg = this.chunkDamage[slot];
    if (dmg && idx < dmg.length) {
      dmg[idx] = mat === 0 ? 0 : 255;
    }
    this.chunkDirty[slot] = 1;
    this.chunkDirtyBucketMask[slot] |= MAT_BUCKET_ALL_MASK_DEFAULT;
    this.chunkPhysicsVersion[slot]++;
  }

  public ensureChunkDamage(slotIndex: number): Uint8Array | null {
    if (slotIndex < 0 || slotIndex >= this.maxChunks || this.chunkIds[slotIndex] === -1) {
      return null;
    }
    let dmg = this.chunkDamage[slotIndex];
    if (!dmg) {
      const len = this.chunkVoxels[slotIndex].length;
      if (len === 0) return null;
      dmg = new Uint8Array(len);
      dmg.fill(255);
      this.chunkDamage[slotIndex] = dmg;
    }
    return dmg;
  }

  public damageVoxel(
    worldX: number,
    worldY: number,
    worldZ: number,
    amount: number,
    cause: VoxelDestroyCause = 'damage',
  ): number {
    const wx = Math.floor(worldX);
    const wy = Math.floor(worldY);
    const wz = Math.floor(worldZ);
    const slot = this.getChunkSlotByWorld(wx, wy, wz);
    if (slot < 0) return 0;

    const voxels = this.chunkVoxels[slot];
    if (voxels.length < this.chunkVolume) return 0;

    const lx = wx - this.chunkWorldX[slot];
    const ly = wy - this.chunkWorldY[slot];
    const lz = wz - this.chunkWorldZ[slot];
    if (
      lx < 0 ||
      lx >= this.chunkX ||
      ly < 0 ||
      ly >= this.chunkY ||
      lz < 0 ||
      lz >= this.chunkZ
    ) {
      return 0;
    }

    const idx = lx + this.chunkX * (ly + this.chunkY * lz);
    const mat = voxels[idx];
    if (mat === 0) return 0;

    const dmg = this.ensureChunkDamage(slot);
    if (!dmg || idx >= dmg.length) return 0;

    const prevHp = dmg[idx];
    const nextHp = Math.max(0, Math.round(prevHp - Math.max(0, amount)));
    dmg[idx] = nextHp;

    if (nextHp <= 0) {
      voxels[idx] = 0;
      this.chunkDirty[slot] = 1;
      this.chunkDirtyBucketMask[slot] |= MAT_BUCKET_ALL_MASK_DEFAULT;
      this.chunkPhysicsVersion[slot]++;
      this.queueVoxelDestroyed(wx, wy, wz, mat, cause);
    }

    return nextHp;
  }

  public markChunkDirty(slotIndex: number, bucketMask = MAT_BUCKET_ALL_MASK_DEFAULT): void {
    if (slotIndex < 0 || slotIndex >= this.maxChunks || this.chunkIds[slotIndex] === -1) return;
    this.chunkDirty[slotIndex] = 1;
    this.chunkDirtyBucketMask[slotIndex] |= bucketMask >>> 0;
  }

  public setChunkVisible(slotIndex: number, visible: boolean): void {
    if (slotIndex < 0 || slotIndex >= this.maxChunks || this.chunkIds[slotIndex] === -1) return;
    const nextVal = visible ? 1 : 0;
    if (this.chunkVisible[slotIndex] !== nextVal) {
      this.chunkVisible[slotIndex] = nextVal;
      this.queueVisibilityChanged(slotIndex, visible);
    }
  }

  public forEachDirtyChunk(
    callback: (slotIndex: number, chunkId: number, dirtyBucketMask: number) => void,
  ): void {
    const ids = this.chunkIds;
    const dirty = this.chunkDirty;
    const masks = this.chunkDirtyBucketMask;
    const max = this.maxChunks;
    for (let i = 0; i < max; i++) {
      if (ids[i] !== -1 && dirty[i] === 1) {
        callback(i, ids[i], masks[i]);
      }
    }
  }

  // =========================================================================
  // SECTION 2: BODY TABLE METHODS
  // =========================================================================

  public get activeBodyCount(): number {
    return this._activeBodyCount;
  }

  private _growBodyCapacity(): void {
    const oldCap = this.maxBodies;
    const newCap = oldCap * 2;
    this.maxBodies = newCap;

    const growI32 = (src: Int32Array, fillVal = 0): Int32Array => {
      const dst = new Int32Array(newCap);
      if (fillVal !== 0) dst.fill(fillVal);
      dst.set(src);
      return dst;
    };
    const growU8 = (src: Uint8Array): Uint8Array => {
      const dst = new Uint8Array(newCap);
      dst.set(src);
      return dst;
    };
    const growF32 = (src: Float32Array, stride: number): Float32Array => {
      const dst = new Float32Array(newCap * stride);
      dst.set(src);
      return dst;
    };

    const growF64 = (src: Float64Array, stride: number): Float64Array => {
      const dst = new Float64Array(newCap * stride);
      dst.set(src);
      return dst;
    };

    this.bodyIds = growI32(this.bodyIds, -1);
    this.bodyPositions = growF32(this.bodyPositions, 3);
    this.bodyVelocities = growF32(this.bodyVelocities, 3);
    this.bodyQuaternions = growF32(this.bodyQuaternions, 4);
    this.bodyAngularVelocities = growF32(this.bodyAngularVelocities, 3);
    this.bodyMasses = growF32(this.bodyMasses, 1);
    this.bodyInvMasses = growF32(this.bodyInvMasses, 1);
    this.bodyInertiaLocal = growF32(this.bodyInertiaLocal, 3);
    this.bodyInvInertiaLocal = growF32(this.bodyInvInertiaLocal, 3);
    this.bodyForces = growF32(this.bodyForces, 3);
    this.bodyTorques = growF32(this.bodyTorques, 3);
    this.bodyLinearDamping = growF64(this.bodyLinearDamping, 1);
    this.bodyAngularDamping = growF64(this.bodyAngularDamping, 1);
    this.bodyComLocal = growF32(this.bodyComLocal, 3);
    this.bodyMaxLinearSpeed = growF32(this.bodyMaxLinearSpeed, 1);
    this.bodyMaxAngularSpeed = growF32(this.bodyMaxAngularSpeed, 1);
    this.bodyIntegratedThisStep = growU8(this.bodyIntegratedThisStep);
    this.bodySleepStates = growU8(this.bodySleepStates);
    this.bodyVisible = growU8(this.bodyVisible);

    for (let i = oldCap; i < newCap; i++) {
      this.bodyQuaternions[i * 4 + 3] = 1;
      this.bodyMasses[i] = 1;
      this.bodyInvMasses[i] = 1;
      this.bodyInertiaLocal[i * 3] = 1;
      this.bodyInertiaLocal[i * 3 + 1] = 1;
      this.bodyInertiaLocal[i * 3 + 2] = 1;
      this.bodyInvInertiaLocal[i * 3] = 1;
      this.bodyInvInertiaLocal[i * 3 + 1] = 1;
      this.bodyInvInertiaLocal[i * 3 + 2] = 1;
      this.bodyLinearDamping[i] = 0.06;
      this.bodyAngularDamping[i] = 0.15;
      this.bodyMaxLinearSpeed[i] = 48.0;
      this.bodyMaxAngularSpeed[i] = 8.0;
      this.bodyCollisionPoints.push(null);
      this.bodyHullSamples.push(null);
      this.bodyVoxelMaps.push(null);
      this.bodyRootGroups.push(null);
    }
    for (let i = newCap - 1; i >= oldCap; i--) {
      this._freeBodySlots.push(i);
    }
  }

  public acquireBodySlot(bodyId?: number): number {
    let resolvedId = bodyId;
    if (resolvedId === undefined) {
      while (this._bodyIdToSlot.has(this._nextAutoBodyId)) {
        this._nextAutoBodyId++;
      }
      resolvedId = this._nextAutoBodyId++;
    } else {
      const existing = this._bodyIdToSlot.get(resolvedId);
      if (existing !== undefined) {
        return existing;
      }
      if (resolvedId >= this._nextAutoBodyId) {
        this._nextAutoBodyId = resolvedId + 1;
      }
    }

    if (this._freeBodySlots.length === 0) {
      this._growBodyCapacity();
    }
    const slotIndex = this._freeBodySlots.pop()!;

    this.bodyIds[slotIndex] = resolvedId;
    const o3 = slotIndex * 3;
    const o4 = slotIndex * 4;
    this.bodyPositions[o3] = 0;
    this.bodyPositions[o3 + 1] = 0;
    this.bodyPositions[o3 + 2] = 0;
    this.bodyVelocities[o3] = 0;
    this.bodyVelocities[o3 + 1] = 0;
    this.bodyVelocities[o3 + 2] = 0;
    this.bodyQuaternions[o4] = 0;
    this.bodyQuaternions[o4 + 1] = 0;
    this.bodyQuaternions[o4 + 2] = 0;
    this.bodyQuaternions[o4 + 3] = 1;
    this.bodyAngularVelocities[o3] = 0;
    this.bodyAngularVelocities[o3 + 1] = 0;
    this.bodyAngularVelocities[o3 + 2] = 0;
    this.bodyMasses[slotIndex] = 1;
    this.bodyInvMasses[slotIndex] = 1;
    this.bodyInertiaLocal[o3] = 1;
    this.bodyInertiaLocal[o3 + 1] = 1;
    this.bodyInertiaLocal[o3 + 2] = 1;
    this.bodyInvInertiaLocal[o3] = 1;
    this.bodyInvInertiaLocal[o3 + 1] = 1;
    this.bodyInvInertiaLocal[o3 + 2] = 1;
    this.bodyForces[o3] = 0;
    this.bodyForces[o3 + 1] = 0;
    this.bodyForces[o3 + 2] = 0;
    this.bodyTorques[o3] = 0;
    this.bodyTorques[o3 + 1] = 0;
    this.bodyTorques[o3 + 2] = 0;
    this.bodyLinearDamping[slotIndex] = 0.06;
    this.bodyAngularDamping[slotIndex] = 0.15;
    this.bodyComLocal[o3] = 0;
    this.bodyComLocal[o3 + 1] = 0;
    this.bodyComLocal[o3 + 2] = 0;
    this.bodyMaxLinearSpeed[slotIndex] = 48.0;
    this.bodyMaxAngularSpeed[slotIndex] = 8.0;
    this.bodyIntegratedThisStep[slotIndex] = 0;
    this.bodySleepStates[slotIndex] = 0;
    this.bodyVisible[slotIndex] = 1;
    this.bodyCollisionPoints[slotIndex] = null;
    this.bodyHullSamples[slotIndex] = null;
    this.bodyVoxelMaps[slotIndex] = null;
    this.bodyRootGroups[slotIndex] = null;

    this._bodyIdToSlot.set(resolvedId, slotIndex);
    this._activeBodyCount++;
    return slotIndex;
  }

  public releaseBodySlot(slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= this.maxBodies) return;
    const bodyId = this.bodyIds[slotIndex];
    if (bodyId === -1) return;

    const o3 = slotIndex * 3;
    this._bodyIdToSlot.delete(bodyId);
    this.bodyIds[slotIndex] = -1;
    this.bodyForces[o3] = 0;
    this.bodyForces[o3 + 1] = 0;
    this.bodyForces[o3 + 2] = 0;
    this.bodyTorques[o3] = 0;
    this.bodyTorques[o3 + 1] = 0;
    this.bodyTorques[o3 + 2] = 0;
    this.bodyComLocal[o3] = 0;
    this.bodyComLocal[o3 + 1] = 0;
    this.bodyComLocal[o3 + 2] = 0;
    this.bodyIntegratedThisStep[slotIndex] = 0;
    this.bodySleepStates[slotIndex] = 0;
    this.bodyVisible[slotIndex] = 0;
    this.bodyCollisionPoints[slotIndex] = null;
    this.bodyHullSamples[slotIndex] = null;
    this.bodyVoxelMaps[slotIndex] = null;
    this.bodyRootGroups[slotIndex] = null;

    this._freeBodySlots.push(slotIndex);
    this._activeBodyCount = Math.max(0, this._activeBodyCount - 1);
  }

  public getBodySlotById(bodyId: number): number {
    const slot = this._bodyIdToSlot.get(bodyId);
    return slot !== undefined ? slot : -1;
  }

  public getBodyPosition(slotIndex: number, out: Vector3 = new Vector3()): Vector3 {
    const o = slotIndex * 3;
    return out.set(
      this.bodyPositions[o],
      this.bodyPositions[o + 1],
      this.bodyPositions[o + 2],
    );
  }

  public setBodyPosition(slotIndex: number, x: number, y: number, z: number): void {
    const o = slotIndex * 3;
    this.bodyPositions[o] = x;
    this.bodyPositions[o + 1] = y;
    this.bodyPositions[o + 2] = z;
  }

  public getBodyVelocity(slotIndex: number, out: Vector3 = new Vector3()): Vector3 {
    const o = slotIndex * 3;
    return out.set(
      this.bodyVelocities[o],
      this.bodyVelocities[o + 1],
      this.bodyVelocities[o + 2],
    );
  }

  public setBodyVelocity(slotIndex: number, x: number, y: number, z: number): void {
    const o = slotIndex * 3;
    this.bodyVelocities[o] = x;
    this.bodyVelocities[o + 1] = y;
    this.bodyVelocities[o + 2] = z;
  }

  public getBodyQuaternion(slotIndex: number, out: Quaternion = new Quaternion()): Quaternion {
    const o = slotIndex * 4;
    return out.set(
      this.bodyQuaternions[o],
      this.bodyQuaternions[o + 1],
      this.bodyQuaternions[o + 2],
      this.bodyQuaternions[o + 3],
    );
  }

  public setBodyQuaternion(
    slotIndex: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    const o = slotIndex * 4;
    this.bodyQuaternions[o] = x;
    this.bodyQuaternions[o + 1] = y;
    this.bodyQuaternions[o + 2] = z;
    this.bodyQuaternions[o + 3] = w;
  }

  public getBodyAngularVelocity(slotIndex: number, out: Vector3 = new Vector3()): Vector3 {
    const o = slotIndex * 3;
    return out.set(
      this.bodyAngularVelocities[o],
      this.bodyAngularVelocities[o + 1],
      this.bodyAngularVelocities[o + 2],
    );
  }

  public setBodyAngularVelocity(slotIndex: number, x: number, y: number, z: number): void {
    const o = slotIndex * 3;
    this.bodyAngularVelocities[o] = x;
    this.bodyAngularVelocities[o + 1] = y;
    this.bodyAngularVelocities[o + 2] = z;
  }

  public getBodyMass(slotIndex: number): number {
    return this.bodyMasses[slotIndex];
  }

  public setBodyMass(slotIndex: number, mass: number): void {
    this.bodyMasses[slotIndex] = mass;
    this.bodyInvMasses[slotIndex] = mass > 0 ? 1 / mass : 0;
  }

  public getBodyInvMass(slotIndex: number): number {
    return this.bodyInvMasses[slotIndex];
  }

  public setBodyInvMass(slotIndex: number, invMass: number): void {
    this.bodyInvMasses[slotIndex] = invMass;
  }

  public getBodyInertiaLocal(slotIndex: number, out: Vector3 = new Vector3()): Vector3 {
    const o = slotIndex * 3;
    return out.set(
      this.bodyInertiaLocal[o],
      this.bodyInertiaLocal[o + 1],
      this.bodyInertiaLocal[o + 2],
    );
  }

  public setBodyInertiaLocal(slotIndex: number, ix: number, iy: number, iz: number): void {
    const o = slotIndex * 3;
    this.bodyInertiaLocal[o] = ix;
    this.bodyInertiaLocal[o + 1] = iy;
    this.bodyInertiaLocal[o + 2] = iz;
    this.bodyInvInertiaLocal[o] = ix > 0 ? 1 / ix : 0;
    this.bodyInvInertiaLocal[o + 1] = iy > 0 ? 1 / iy : 0;
    this.bodyInvInertiaLocal[o + 2] = iz > 0 ? 1 / iz : 0;
  }

  public getBodySleeping(slotIndex: number): boolean {
    return this.bodySleepStates[slotIndex] === 1;
  }

  public setBodySleeping(slotIndex: number, sleeping: boolean): void {
    if (slotIndex < 0 || slotIndex >= this.maxBodies) return;
    const nextVal = sleeping ? 1 : 0;
    if (this.bodySleepStates[slotIndex] !== nextVal) {
      this.bodySleepStates[slotIndex] = nextVal;
      if (this.bodyIds[slotIndex] !== -1) {
        this.queueBodySleep(slotIndex, sleeping);
      }
    }
  }

  public setBodyVisible(slotIndex: number, visible: boolean): void {
    if (slotIndex < 0 || slotIndex >= this.maxBodies) return;
    this.bodyVisible[slotIndex] = visible ? 1 : 0;
  }

  public forEachAwakeBody(callback: (slotIndex: number, bodyId: number) => void): void {
    const ids = this.bodyIds;
    const sleep = this.bodySleepStates;
    const max = this.maxBodies;
    for (let i = 0; i < max; i++) {
      if (ids[i] !== -1 && sleep[i] === 0) {
        callback(i, ids[i]);
      }
    }
  }

  public setBodyComLocal(slotIndex: number, cx: number, cy: number, cz: number): void {
    const o3 = slotIndex * 3;
    this.bodyComLocal[o3] = cx;
    this.bodyComLocal[o3 + 1] = cy;
    this.bodyComLocal[o3 + 2] = cz;
  }

  public applyBodyForce(slotIndex: number, fx: number, fy: number, fz: number): void {
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) return;
    if (fx * fx + fy * fy + fz * fz > 1e-6 && this.bodySleepStates[slotIndex] === 1) {
      this.setBodySleeping(slotIndex, false);
    }
    const o3 = slotIndex * 3;
    this.bodyForces[o3] += fx;
    this.bodyForces[o3 + 1] += fy;
    this.bodyForces[o3 + 2] += fz;
  }

  public applyBodyTorque(slotIndex: number, tx: number, ty: number, tz: number): void {
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) return;
    if (tx * tx + ty * ty + tz * tz > 1e-6 && this.bodySleepStates[slotIndex] === 1) {
      this.setBodySleeping(slotIndex, false);
    }
    const o3 = slotIndex * 3;
    this.bodyTorques[o3] += tx;
    this.bodyTorques[o3 + 1] += ty;
    this.bodyTorques[o3 + 2] += tz;
  }

  public applyBodyForceAtPoint(
    slotIndex: number,
    fx: number,
    fy: number,
    fz: number,
    wx: number,
    wy: number,
    wz: number,
  ): void {
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) return;
    if (fx * fx + fy * fy + fz * fz > 1e-6 && this.bodySleepStates[slotIndex] === 1) {
      this.setBodySleeping(slotIndex, false);
    }
    const o3 = slotIndex * 3;
    this.bodyForces[o3] += fx;
    this.bodyForces[o3 + 1] += fy;
    this.bodyForces[o3 + 2] += fz;
    const rx = wx - this.bodyPositions[o3];
    const ry = wy - this.bodyPositions[o3 + 1];
    const rz = wz - this.bodyPositions[o3 + 2];
    this.bodyTorques[o3] += ry * fz - rz * fy;
    this.bodyTorques[o3 + 1] += rz * fx - rx * fz;
    this.bodyTorques[o3 + 2] += rx * fy - ry * fx;
  }

  public applyBodyImpulseAtPoint(
    slotIndex: number,
    ix: number,
    iy: number,
    iz: number,
    wx: number,
    wy: number,
    wz: number,
  ): void {
    if (!Number.isFinite(ix) || !Number.isFinite(iy) || !Number.isFinite(iz)) return;
    const invM = this.bodyInvMasses[slotIndex];
    if (invM <= 0) return;

    if (ix * ix + iy * iy + iz * iz > 1e-6 && this.bodySleepStates[slotIndex] === 1) {
      this.setBodySleeping(slotIndex, false);
    }

    const o3 = slotIndex * 3;
    const o4 = slotIndex * 4;
    this.bodyVelocities[o3] += ix * invM;
    this.bodyVelocities[o3 + 1] += iy * invM;
    this.bodyVelocities[o3 + 2] += iz * invM;

    const rx = wx - this.bodyPositions[o3];
    const ry = wy - this.bodyPositions[o3 + 1];
    const rz = wz - this.bodyPositions[o3 + 2];
    const ax = ry * iz - rz * iy;
    const ay = rz * ix - rx * iz;
    const az = rx * iy - ry * ix;

    // Transform angular impulse to local space via q^-1 = (-qx, -qy, -qz, qw)
    const qx = this.bodyQuaternions[o4];
    const qy = this.bodyQuaternions[o4 + 1];
    const qz = this.bodyQuaternions[o4 + 2];
    const qw = this.bodyQuaternions[o4 + 3];

    const iqx = -qx;
    const iqy = -qy;
    const iqz = -qz;
    const t1x = 2 * (iqy * az - iqz * ay);
    const t1y = 2 * (iqz * ax - iqx * az);
    const t1z = 2 * (iqx * ay - iqy * ax);
    const lx = (ax + qw * t1x + iqy * t1z - iqz * t1y) * this.bodyInvInertiaLocal[o3];
    const ly = (ay + qw * t1y + iqz * t1x - iqx * t1z) * this.bodyInvInertiaLocal[o3 + 1];
    const lz = (az + qw * t1z + iqx * t1y - iqy * t1x) * this.bodyInvInertiaLocal[o3 + 2];

    // Rotate back to world space via q
    const t2x = 2 * (qy * lz - qz * ly);
    const t2y = 2 * (qz * lx - qx * lz);
    const t2z = 2 * (qx * ly - qy * lx);
    this.bodyAngularVelocities[o3] += lx + qw * t2x + qy * t2z - qz * t2y;
    this.bodyAngularVelocities[o3 + 1] += ly + qw * t2y + qz * t2x - qx * t2z;
    this.bodyAngularVelocities[o3 + 2] += lz + qw * t2z + qx * t2y - qy * t2x;
  }

  /**
   * Direct-indexed SoA semi-implicit Euler 6-DOF integration for a single body slot.
   * Hot path: reads and writes flat Float32Arrays directly without getter indirection or allocations.
   * Skips sleeping bodies (`bodySleepStates[slot] === 1`) and invisible bodies (`bodyVisible[slot] === 0`).
   */
  public integrateBodySlot(slotIndex: number, subDt: number): boolean {
    if (subDt <= 0 || !Number.isFinite(subDt)) return false;
    if (slotIndex < 0 || slotIndex >= this.maxBodies || this.bodyIds[slotIndex] === -1) {
      return false;
    }

    const o3 = slotIndex * 3;
    const o4 = slotIndex * 4;
    const forces = this.bodyForces;
    const torques = this.bodyTorques;
    const invM = this.bodyInvMasses[slotIndex];

    if (
      this.bodySleepStates[slotIndex] === 1 ||
      this.bodyVisible[slotIndex] === 0 ||
      invM <= 0
    ) {
      forces[o3] = 0;
      forces[o3 + 1] = 0;
      forces[o3 + 2] = 0;
      torques[o3] = 0;
      torques[o3 + 1] = 0;
      torques[o3 + 2] = 0;
      return true;
    }

    const _tBodyStart = typeof performance !== 'undefined' ? performance.now() : 0;
    const positions = this.bodyPositions;
    const velocities = this.bodyVelocities;
    const quaternions = this.bodyQuaternions;
    const angVelocities = this.bodyAngularVelocities;
    const invInertia = this.bodyInvInertiaLocal;

    const prevPx = positions[o3];
    const prevPy = positions[o3 + 1];
    const prevPz = positions[o3 + 2];
    const prevQx = quaternions[o4];
    const prevQy = quaternions[o4 + 1];
    const prevQz = quaternions[o4 + 2];
    const prevQw = quaternions[o4 + 3];

    // 1. Linear velocity: v += (F * invMass) * dt, apply damping & clamp
    const invMassDt = invM * subDt;
    const linDampFactor = Math.max(0, 1.0 - this.bodyLinearDamping[slotIndex] * subDt);
    let vx = (velocities[o3] + forces[o3] * invMassDt) * linDampFactor;
    let vy = (velocities[o3 + 1] + forces[o3 + 1] * invMassDt) * linDampFactor;
    let vz = (velocities[o3 + 2] + forces[o3 + 2] * invMassDt) * linDampFactor;

    const maxSpeed = this.bodyMaxLinearSpeed[slotIndex];
    const speedSq = vx * vx + vy * vy + vz * vz;
    if (speedSq > maxSpeed * maxSpeed) {
      const scale = maxSpeed / Math.sqrt(speedSq);
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }

    // 2. Position: p += v * dt
    const px = prevPx + vx * subDt;
    const py = prevPy + vy * subDt;
    const pz = prevPz + vz * subDt;

    // 3. Angular velocity: w += (I_world^-1 * tau) * dt
    const tx = torques[o3];
    const ty = torques[o3 + 1];
    const tz = torques[o3 + 2];

    const iqx = -prevQx;
    const iqy = -prevQy;
    const iqz = -prevQz;
    const t1x = 2 * (iqy * tz - iqz * ty);
    const t1y = 2 * (iqz * tx - iqx * tz);
    const t1z = 2 * (iqx * ty - iqy * tx);
    const ltx = (tx + prevQw * t1x + iqy * t1z - iqz * t1y) * invInertia[o3];
    const lty = (ty + prevQw * t1y + iqz * t1x - iqx * t1z) * invInertia[o3 + 1];
    const ltz = (tz + prevQw * t1z + iqx * t1y - iqy * t1x) * invInertia[o3 + 2];

    const t2x = 2 * (prevQy * ltz - prevQz * lty);
    const t2y = 2 * (prevQz * ltx - prevQx * ltz);
    const t2z = 2 * (prevQx * lty - prevQy * ltx);
    const wAlphaX = ltx + prevQw * t2x + prevQy * t2z - prevQz * t2y;
    const wAlphaY = lty + prevQw * t2y + prevQz * t2x - prevQx * t2z;
    const wAlphaZ = ltz + prevQw * t2z + prevQx * t2y - prevQy * t2x;

    const angDampFactor = Math.max(0, 1.0 - this.bodyAngularDamping[slotIndex] * subDt);
    let wx = (angVelocities[o3] + wAlphaX * subDt) * angDampFactor;
    let wy = (angVelocities[o3 + 1] + wAlphaY * subDt) * angDampFactor;
    let wz = (angVelocities[o3 + 2] + wAlphaZ * subDt) * angDampFactor;

    const maxAngSpeed = this.bodyMaxAngularSpeed[slotIndex];
    const angSpeedSq = wx * wx + wy * wy + wz * wz;
    if (angSpeedSq > maxAngSpeed * maxAngSpeed) {
      const scale = maxAngSpeed / Math.sqrt(angSpeedSq);
      wx *= scale;
      wy *= scale;
      wz *= scale;
    }

    // 4. Quaternion integration: dq/dt = 0.5 * w * q
    let qx = prevQx;
    let qy = prevQy;
    let qz = prevQz;
    let qw = prevQw;
    const omegaMag = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (omegaMag > 1e-6) {
      const halfAngle = 0.5 * omegaMag * subDt;
      const sinHalf = Math.sin(halfAngle) / omegaMag;
      const dqx = wx * sinHalf;
      const dqy = wy * sinHalf;
      const dqz = wz * sinHalf;
      const dqw = Math.cos(halfAngle);

      // premultiply: dq * q
      const nqx = dqx * qw + dqw * qx + dqy * qz - dqz * qy;
      const nqy = dqy * qw + dqw * qy + dqz * qx - dqx * qz;
      const nqz = dqz * qw + dqw * qz + dqx * qy - dqy * qx;
      const nqw = dqw * qw - dqx * qx - dqy * qy - dqz * qz;
      const qLen = Math.sqrt(nqx * nqx + nqy * nqy + nqz * nqz + nqw * nqw);
      if (qLen > 1e-12) {
        const invQLen = 1 / qLen;
        qx = nqx * invQLen;
        qy = nqy * invQLen;
        qz = nqz * invQLen;
        qw = nqw * invQLen;
      } else {
        qx = 0;
        qy = 0;
        qz = 0;
        qw = 1;
      }
    }

    // Guard against NaN / Infinity
    if (
      !Number.isFinite(px) ||
      !Number.isFinite(py) ||
      !Number.isFinite(pz) ||
      !Number.isFinite(vx) ||
      !Number.isFinite(vy) ||
      !Number.isFinite(vz) ||
      !Number.isFinite(qx) ||
      !Number.isFinite(qw)
    ) {
      positions[o3] = prevPx;
      positions[o3 + 1] = prevPy;
      positions[o3 + 2] = prevPz;
      quaternions[o4] = prevQx;
      quaternions[o4 + 1] = prevQy;
      quaternions[o4 + 2] = prevQz;
      quaternions[o4 + 3] = prevQw;
      velocities[o3] = 0;
      velocities[o3 + 1] = 0;
      velocities[o3 + 2] = 0;
      angVelocities[o3] = 0;
      angVelocities[o3 + 1] = 0;
      angVelocities[o3 + 2] = 0;
      forces[o3] = 0;
      forces[o3 + 1] = 0;
      forces[o3 + 2] = 0;
      torques[o3] = 0;
      torques[o3 + 1] = 0;
      torques[o3 + 2] = 0;
      return false;
    }

    positions[o3] = px;
    positions[o3 + 1] = py;
    positions[o3 + 2] = pz;
    velocities[o3] = vx;
    velocities[o3 + 1] = vy;
    velocities[o3 + 2] = vz;
    quaternions[o4] = qx;
    quaternions[o4 + 1] = qy;
    quaternions[o4 + 2] = qz;
    quaternions[o4 + 3] = qw;
    angVelocities[o3] = wx;
    angVelocities[o3 + 1] = wy;
    angVelocities[o3 + 2] = wz;

    forces[o3] = 0;
    forces[o3 + 1] = 0;
    forces[o3 + 2] = 0;
    torques[o3] = 0;
    torques[o3 + 1] = 0;
    torques[o3 + 2] = 0;

    if (_tBodyStart > 0) {
      perfProfiler.recordBodyIntegration(this.bodyIds[slotIndex], performance.now() - _tBodyStart);
    }
    return true;
  }

  /**
   * Integrates all awake, visible bodies directly through VoxelWorld SoA arrays.
   * Skips sleeping bodies (`bodySleepStates[slot] === 1`), invisible bodies (`bodyVisible[slot] === 0`),
   * and bodies already substepped during the current fixed step (`bodyIntegratedThisStep[slot] === 1`).
   */
  public integratePhysics(dt: number): number {
    if (dt <= 0 || !Number.isFinite(dt)) return 0;
    const _tLoopStart = typeof performance !== 'undefined' ? performance.now() : 0;
    const ids = this.bodyIds;
    const sleep = this.bodySleepStates;
    const visible = this.bodyVisible;
    const stepped = this.bodyIntegratedThisStep;
    const max = this.maxBodies;
    let integratedCount = 0;

    for (let slot = 0; slot < max; slot++) {
      if (ids[slot] === -1) continue;
      if (stepped[slot] === 1) {
        stepped[slot] = 0;
        continue;
      }
      if (sleep[slot] === 1) continue;
      if (visible[slot] === 0) continue;

      if (this.integrateBodySlot(slot, dt)) {
        integratedCount++;
      }
    }
    if (_tLoopStart > 0) {
      perfProfiler.recordIntegrateLoopOverhead(performance.now() - _tLoopStart);
    }
    return integratedCount;
  }

  public countAwakeBodies(): number {
    let count = 0;
    const ids = this.bodyIds;
    const sleep = this.bodySleepStates;
    const max = this.maxBodies;
    for (let i = 0; i < max; i++) {
      if (ids[i] !== -1 && sleep[i] === 0) count++;
    }
    return count;
  }

  public countVisibleChunks(): number {
    let count = 0;
    const ids = this.chunkIds;
    const vis = this.chunkVisible;
    const max = this.maxChunks;
    for (let i = 0; i < max; i++) {
      if (ids[i] !== -1 && vis[i] === 1) count++;
    }
    return count;
  }

  public countDirtyChunks(): number {
    let count = 0;
    const ids = this.chunkIds;
    const dirty = this.chunkDirty;
    const max = this.maxChunks;
    for (let i = 0; i < max; i++) {
      if (ids[i] !== -1 && dirty[i] === 1) count++;
    }
    return count;
  }

  // =========================================================================
  // SECTION 3: DEBRIS TABLE METHODS
  // =========================================================================

  public get activeDebrisCount(): number {
    return this._activeDebrisCount;
  }

  public spawnDebris(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    size = DEFAULT_DEBRIS_SIZE,
    lifetime = DEFAULT_DEBRIS_LIFETIME,
  ): number {
    let slotIndex = -1;
    const active = this.debrisActive;
    const resting = this.debrisResting;
    const seq = this._debrisSpawnSeq;
    const max = this.maxDebris;

    // 1. Prefer first inactive slot
    for (let i = 0; i < max; i++) {
      if (active[i] === 0) {
        slotIndex = i;
        break;
      }
    }

    // 2. If full, recycle oldest resting debris first
    if (slotIndex === -1) {
      let oldestRestingSeq = 0xffffffff;
      let oldestRestingSlot = -1;
      let oldestActiveSeq = 0xffffffff;
      let oldestActiveSlot = 0;

      for (let i = 0; i < max; i++) {
        const s = seq[i];
        if (resting[i] === 1 && s < oldestRestingSeq) {
          oldestRestingSeq = s;
          oldestRestingSlot = i;
        }
        if (s < oldestActiveSeq) {
          oldestActiveSeq = s;
          oldestActiveSlot = i;
        }
      }
      slotIndex = oldestRestingSlot !== -1 ? oldestRestingSlot : oldestActiveSlot;
    } else {
      this._activeDebrisCount++;
    }

    const o3 = slotIndex * 3;
    const o4 = slotIndex * 4;
    this.debrisPositions[o3] = x;
    this.debrisPositions[o3 + 1] = y;
    this.debrisPositions[o3 + 2] = z;
    this.debrisVelocities[o3] = vx;
    this.debrisVelocities[o3 + 1] = vy;
    this.debrisVelocities[o3 + 2] = vz;
    this.debrisQuaternions[o4] = 0;
    this.debrisQuaternions[o4 + 1] = 0;
    this.debrisQuaternions[o4 + 2] = 0;
    this.debrisQuaternions[o4 + 3] = 1;
    this.debrisAngularVelocities[o3] = 0;
    this.debrisAngularVelocities[o3 + 1] = 0;
    this.debrisAngularVelocities[o3 + 2] = 0;
    this.debrisColors[slotIndex] = color >>> 0;
    this.debrisSizes[slotIndex] = size;
    this.debrisLifetimes[slotIndex] = lifetime;
    this.debrisMaxLifetimes[slotIndex] = lifetime;
    active[slotIndex] = 1;
    resting[slotIndex] = 0;
    seq[slotIndex] = this._debrisNextSeq++;

    return slotIndex;
  }

  public releaseDebris(slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= this.maxDebris) return;
    if (this.debrisActive[slotIndex] === 0) return;

    this.debrisActive[slotIndex] = 0;
    this.debrisResting[slotIndex] = 0;
    this.debrisLifetimes[slotIndex] = 0;
    this.debrisMaxLifetimes[slotIndex] = 0;
    this._debrisSpawnSeq[slotIndex] = 0;
    this._activeDebrisCount = Math.max(0, this._activeDebrisCount - 1);
  }

  public setDebrisResting(slotIndex: number, isResting: boolean): void {
    if (slotIndex < 0 || slotIndex >= this.maxDebris) return;
    this.debrisResting[slotIndex] = isResting ? 1 : 0;
  }

  public forEachActiveDebris(callback: (slotIndex: number) => void): void {
    const active = this.debrisActive;
    const resting = this.debrisResting;
    const max = this.maxDebris;
    for (let i = 0; i < max; i++) {
      if (active[i] === 1 && resting[i] === 0) {
        callback(i);
      }
    }
  }

  public forEachAllDebris(callback: (slotIndex: number) => void): void {
    const active = this.debrisActive;
    const max = this.maxDebris;
    for (let i = 0; i < max; i++) {
      if (active[i] === 1) {
        callback(i);
      }
    }
  }

  // =========================================================================
  // SECTION 4: EVENT QUEUE METHODS
  // =========================================================================

  public queueExplosion(
    x: number,
    y: number,
    z: number,
    radius: number,
    force: number,
    depth = 0,
    radiusVoxels = Math.round(radius / DEFAULT_DEBRIS_SIZE),
  ): ExplosionEvent {
    const event: ExplosionEvent = {
      x,
      y,
      z,
      radius,
      force,
      depth,
      radiusVoxels,
      time: this.currentTime,
    };
    this.explosionEvents.push(event);
    this.callbacks.onExplosion?.(event);
    return event;
  }

  public queueDamage(bodySlot: number, voxelKey: number, damage: number): DamageEvent {
    const event: DamageEvent = {
      bodySlot,
      voxelKey,
      damage,
      time: this.currentTime,
    };
    this.damageEvents.push(event);
    return event;
  }

  public queueVoxelDestroyed(
    worldX: number,
    worldY: number,
    worldZ: number,
    materialId: number,
    cause: VoxelDestroyCause = 'damage',
  ): VoxelDestroyedEvent {
    const event: VoxelDestroyedEvent = {
      worldX,
      worldY,
      worldZ,
      materialId,
      cause,
      time: this.currentTime,
    };
    this.voxelDestroyedEvents.push(event);
    this.callbacks.onVoxelDestroyed?.(event);
    return event;
  }

  public queueVisibilityChanged(chunkSlot: number, visible: boolean): VisibilityChangedEvent {
    const event: VisibilityChangedEvent = {
      chunkSlot,
      visible,
      time: this.currentTime,
    };
    this.visibilityChangedEvents.push(event);
    return event;
  }

  public queueBodySleep(bodySlot: number, sleeping: boolean): BodySleepEvent {
    const event: BodySleepEvent = {
      bodySlot,
      sleeping,
      time: this.currentTime,
    };
    this.bodySleepEvents.push(event);
    this.callbacks.onBodySleep?.(event);
    return event;
  }

  public drainExplosionEvents(): ExplosionEvent[] {
    if (this.explosionEvents.length === 0) return [];
    const out = this.explosionEvents.slice();
    this.explosionEvents.length = 0;
    return out;
  }

  public drainDamageEvents(): DamageEvent[] {
    if (this.damageEvents.length === 0) return [];
    const out = this.damageEvents.slice();
    this.damageEvents.length = 0;
    return out;
  }

  public drainVoxelDestroyedEvents(): VoxelDestroyedEvent[] {
    if (this.voxelDestroyedEvents.length === 0) return [];
    const out = this.voxelDestroyedEvents.slice();
    this.voxelDestroyedEvents.length = 0;
    return out;
  }

  public drainVisibilityChangedEvents(): VisibilityChangedEvent[] {
    if (this.visibilityChangedEvents.length === 0) return [];
    const out = this.visibilityChangedEvents.slice();
    this.visibilityChangedEvents.length = 0;
    return out;
  }

  public drainBodySleepEvents(): BodySleepEvent[] {
    if (this.bodySleepEvents.length === 0) return [];
    const out = this.bodySleepEvents.slice();
    this.bodySleepEvents.length = 0;
    return out;
  }

  public drainAllEvents(): DrainedVoxelWorldEvents {
    const _tEv0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const out: DrainedVoxelWorldEvents = {
      explosionEvents: this.drainExplosionEvents(),
      damageEvents: this.drainDamageEvents(),
      voxelDestroyedEvents: this.drainVoxelDestroyedEvents(),
      visibilityChangedEvents: this.drainVisibilityChangedEvents(),
      bodySleepEvents: this.drainBodySleepEvents(),
    };
    if (_tEv0 > 0) {
      perfProfiler.recordEventDrain(performance.now() - _tEv0);
    }
    return out;
  }

  // =========================================================================
  // CLASS-LEVEL CLOCK & LIFECYCLE
  // =========================================================================

  /**
   * Unified 60Hz fixed-timestep physics and world clock step:
   * - Advances `currentTime` by clamped `dt * timeScale`
   * - Accumulates into `accumulator`
   * - Runs `while (accumulator >= fixedDt)`:
   *     1. `onFixedStep(fixedDt)` (vehicle force accumulation / multi-substep hooks)
   *     2. `integratePhysics(fixedDt)` (direct SoA integration for all awake visible bodies)
   *     3. `onResolveCollisions(fixedDt)` (broadphase + narrowphase collision resolution)
   * - Optionally drains events when `drainEvents` is true
   *
   * Single-frame timing: renderer reads the just-integrated `VoxelWorld` state immediately (no interpolation buffer).
   */
  public step(dt: number, options?: VoxelWorldStepOptions | number): number {
    if (!Number.isFinite(dt) || dt <= 0) return 0;
    const opts: VoxelWorldStepOptions =
      typeof options === 'number' ? { maxSubsteps: options } : options ?? {};

    const maxSubsteps = Math.max(1, opts.maxSubsteps ?? 4);
    const timeScale = Math.max(0.05, Math.min(2.0, opts.timeScale ?? 1.0));
    const maxAccumDt = opts.maxAccumulatedDt ?? 0.05;
    const scaledDt = Math.min(dt, maxAccumDt) * timeScale;

    this.currentTime += scaledDt;
    this.accumulator += scaledDt;

    const maxAccum = this.fixedDt * maxSubsteps;
    if (this.accumulator > maxAccum) {
      this.accumulator = maxAccum;
    }

    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < maxSubsteps) {
      this.accumulator -= this.fixedDt;
      if (opts.onFixedStep) {
        opts.onFixedStep(this.fixedDt);
      }
      this.integratePhysics(this.fixedDt);
      if (opts.onResolveCollisions) {
        opts.onResolveCollisions(this.fixedDt);
      }
      steps++;
    }

    if (opts.drainEvents) {
      this.drainAllEvents();
    }
    return steps;
  }

  public getTime(): number {
    return this.currentTime;
  }

  public reset(): void {
    for (let i = 0; i < this.maxChunks; i++) {
      if (this.chunkIds[i] !== -1) {
        this.releaseChunkSlot(i);
      }
    }
    for (let i = 0; i < this.maxBodies; i++) {
      if (this.bodyIds[i] !== -1) {
        this.releaseBodySlot(i);
      }
    }
    for (let i = 0; i < this.maxDebris; i++) {
      if (this.debrisActive[i] !== 0) {
        this.releaseDebris(i);
      }
    }
    this.drainAllEvents();
    this.currentTime = 0;
    this.accumulator = 0;
  }
}

// ===========================================================================
// SHARED ACTIVE INSTANCE ACCESSOR
// ===========================================================================
let _activeVoxelWorld: VoxelWorld | null = null;

export function getActiveVoxelWorld(): VoxelWorld {
  if (!_activeVoxelWorld) {
    _activeVoxelWorld = new VoxelWorld();
  }
  return _activeVoxelWorld;
}

export function setActiveVoxelWorld(world: VoxelWorld): VoxelWorld {
  _activeVoxelWorld = world;
  return world;
}

export function resetActiveVoxelWorld(): VoxelWorld {
  _activeVoxelWorld = new VoxelWorld();
  return _activeVoxelWorld;
}
