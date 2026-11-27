import {
  VOXEL_SIZE,
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Z,
  TOTAL_VX,
  TOTAL_VZ,
  WATER_VY,
  MAT,
  type WorldGenMode,
} from './constants.ts';
import { evaluateBiomeColumn, isWaterBasinArea } from './worldObjects.ts';
import { evaluateIntegerHashedHorizonColumn } from './integerNoise.ts';
import {
  greedyMeshBoundedArrays,
  greedyMeshTopSurfaceOnly,
  greedyMeshWaterTopSurfaceOnly,
  isTranslucentVoxelMat,
  warmUpGreedyMesherScratchpad,
  MAT_BUCKET_SOIL,
  MAT_BUCKET_ROCK,
  MAT_BUCKET_STRUCTURAL,
  MAT_BUCKET_TRANSLUCENT,
  MAT_BUCKET_ALL_MASK,
  type GreedyMeshFilterMode,
} from './physicsMath.ts';

export interface ChunkNeighborBoundarySlices {
  /** West neighbor (cx - 1, cz) eastmost slice at lx = CHUNK_X - 1, indexed by [ly + chunkY * lz]. Undefined if neighbor not generated yet. */
  west?: Uint8Array;
  /** East neighbor (cx + 1, cz) westmost slice at lx = 0, indexed by [ly + chunkY * lz]. Undefined if neighbor not generated yet. */
  east?: Uint8Array;
  /** North neighbor (cx, cz - 1) southmost slice at lz = CHUNK_Z - 1, indexed by [lx + CHUNK_X * ly]. Undefined if neighbor not generated yet. */
  north?: Uint8Array;
  /** South neighbor (cx, cz + 1) northmost slice at lz = 0, indexed by [lx + CHUNK_X * ly]. Undefined if neighbor not generated yet. */
  south?: Uint8Array;
}

export function createChunkBoundaryVoxelSampler(
  borders: ChunkNeighborBoundarySlices | undefined,
  chunkY: number,
): (lx: number, ly: number, lz: number) => number {
  return (lx: number, ly: number, lz: number): number => {
    if (!borders || ly < 0 || ly >= chunkY) return 0;
    if (lx < 0) {
      if (!borders.west || lz < 0 || lz >= CHUNK_Z) return 0;
      return borders.west[ly + chunkY * lz];
    }
    if (lx >= CHUNK_X) {
      if (!borders.east || lz < 0 || lz >= CHUNK_Z) return 0;
      return borders.east[ly + chunkY * lz];
    }
    if (lz < 0) {
      if (!borders.north || lx < 0 || lx >= CHUNK_X) return 0;
      return borders.north[lx + CHUNK_X * ly];
    }
    if (lz >= CHUNK_Z) {
      if (!borders.south || lx < 0 || lx >= CHUNK_X) return 0;
      return borders.south[lx + CHUNK_X * ly];
    }
    return 0;
  };
}

export interface ChunkMeshJobRequest {
  type?: 'mesh';
  jobId: number;
  cx: number;
  cz: number;
  minY: number;
  maxY: number;
  originX: number;
  originZ: number;
  voxels: Uint8Array;
  customColors?: Uint8Array;
  hasTranslucent?: boolean;
  transMinY?: number;
  transMaxY?: number;
  /** Bitmask of dirty material buckets (#8): bit 0 = SOIL, bit 1 = ROCK, bit 2 = STRUCTURAL, bit 3 = TRANSLUCENT */
  dirtyBucketMask?: number;
  /** If true, defer LOD1/LOD2/LOD3 generation until all chunks have reached LOD0 MESH_READY */
  lod0Only?: boolean;
  /** If true, skip LOD0 and translucent meshing and only build LOD1/LOD2/LOD3 payloads */
  lod12Only?: boolean;
  /** Optional 1-voxel-thick boundary slices from the 4 cardinal neighbors for cross-chunk face culling */
  neighborBorders?: ChunkNeighborBoundarySlices;
  /** Optional deferred voxel removals applied directly into the worker arena buffer (avoids 819KB main-thread clone) */
  pendingRemovals?: ReadonlyMap<number, number>;
  /** If true, meshes only the top visible surface + cliff step walls inside the worker */
  isSurfaceOnly?: boolean;
  /** 64x64 surface heightmap for fast top-surface meshing in the worker */
  surfaceHeightMap?: Uint16Array;
  /** Optional 64-byte 1D neighbor surface height strips [west, east, north, south] */
  neighborSurfaceHeights?: {
    west?: Uint16Array | Uint8Array;
    east?: Uint16Array | Uint8Array;
    north?: Uint16Array | Uint8Array;
    south?: Uint16Array | Uint8Array;
  };
  /** Slot index into the single shared VoxelWorld surface slab (zero-copy when useSharedSlab is true) */
  slotIndex?: number;
  /** When true, read/write compact surface chunk data directly in the shared VoxelWorld slab */
  useSharedSlab?: boolean;
  /** When true, worker generates the 64x64 surface heightmap + 66x66 deterministic border apron off-thread */
  generateSurfaceTerrain?: boolean;
  worldGenMode?: WorldGenMode;
  flatBaseplateMat?: number;
  /** When true (default for surface-only jobs), also builds downsampled 32x32 LOD1 and 16x16 LOD2 meshes */
  buildSurfaceLods?: boolean;
}

export interface WorkerInitSlabRequest {
  type: 'initSlab';
  surfaceVoxelsSab: SharedArrayBuffer;
  surfaceHeightSab: SharedArrayBuffer;
  surfaceVoxelsStride: number;
  surfaceHeightStride: number;
  surfaceSlabCapacity: number;
}

export interface WorkerPingRequest {
  type: 'ping';
  jobId: number;
}

export interface WorkerPingResponse {
  type: 'pong';
  jobId: number;
}

/**
 * Compact 16x16 (~768 byte) surface snapshot of a user-modified chunk so craters, trenches,
 * and player-built voxel structures remain visible across EVERY distant horizon LOD ring.
 */
export interface ModifiedChunkSurfaceStamp {
  cx: number;
  cz: number;
  heights16: Uint16Array;
  mats16: Uint8Array;
  version: number;
}

export interface HorizonTileJobRequest {
  type: 'horizonTile';
  jobId: number;
  tileKey: string;
  level: number;
  tx: number;
  tz: number;
  tileChunks: number;
  stepVoxels: number;
  /** Exact BigInt tile coordinates & scale-band metadata for ultra-far / cosmic rings (up to 10^31 km) */
  txBig?: bigint;
  tzBig?: bigint;
  tileChunksBig?: bigint;
  stepVoxelsBig?: bigint;
  gridCells?: number;
  scaleBand?: number;
  bandScaleMetersBig?: bigint;
  worldGenMode: WorldGenMode;
  flatBaseplateMat: number;
  /** Optional list of modified-chunk surface stamps overlapping this mega-tile */
  stamps?: ModifiedChunkSurfaceStamp[];
}

export interface HorizonTileJobResponse {
  type: 'horizonTile';
  jobId: number;
  tileKey: string;
  level: number;
  tx: number;
  tz: number;
  originX: number;
  originZ: number;
  originXBig: bigint;
  originZBig: bigint;
  scaleBand: number;
  bandScaleMetersBig: bigint;
  opaque: LodSubMeshPayload;
  water: LodSubMeshPayload;
}

export interface SubMeshMaterialGroup {
  materialBucket: number;
  start: number;
  count: number;
}

export interface LodSubMeshPayload {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  ao?: Float32Array;
  spawnTimes?: Float32Array;
  voxelCenters?: Float32Array;
  indices: Uint32Array;
  positionsBuffer?: ArrayBuffer;
  normalsBuffer?: ArrayBuffer;
  colorsBuffer?: ArrayBuffer;
  aoBuffer?: ArrayBuffer;
  indicesBuffer?: ArrayBuffer;
  vertCount: number;
  indexCount: number;
  rawFaces: number;
  mergedQuads: number;
  groups?: SubMeshMaterialGroup[];
}

export interface ChunkMeshJobResponse {
  type?: 'mesh';
  jobId: number;
  cx: number;
  cz: number;
  dirtyBucketMask: number;
  lod0: LodSubMeshPayload;
  lod0Buckets: [
    LodSubMeshPayload | null,
    LodSubMeshPayload | null,
    LodSubMeshPayload | null,
  ];
  lod1: LodSubMeshPayload;
  lod2: LodSubMeshPayload;
  lod3: LodSubMeshPayload;
  transLod0: LodSubMeshPayload;
  transLod1: LodSubMeshPayload;
  transLod2: LodSubMeshPayload;
  transSkipped?: boolean;
  lod12Deferred?: boolean;
  lod12Only?: boolean;
  isSurfaceOnly?: boolean;
  /** Populated when worker generated surface terrain without SharedArrayBuffer (zero-copy Transferable handoff) */
  generatedSurfaceVoxels?: Uint8Array;
  generatedSurfaceVoxelsBuffer?: ArrayBuffer;
  generatedSurfaceHeightMap?: Uint16Array;
  generatedSurfaceHeightMapBuffer?: ArrayBuffer;
  generatedMinY?: number;
  generatedMaxY?: number;
  generatedHasTranslucent?: boolean;
  generatedTransMinY?: number;
  generatedTransMaxY?: number;
}

export function createEmptyLodSubMeshPayload(): LodSubMeshPayload {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
    vertCount: 0,
    indexCount: 0,
    rawFaces: 0,
    mergedQuads: 0,
  };
}

/**
 * Merges the 3 opaque material submesh buckets (SOIL, ROCK, STRUCTURAL) into a single
 * contiguous payload with submesh draw groups (#8).
 */
export function mergeOpaqueBucketPayloads(
  buckets: ReadonlyArray<LodSubMeshPayload | null>,
): LodSubMeshPayload {
  let totalVerts = 0;
  let totalIndices = 0;
  let totalRawFaces = 0;
  let totalMergedQuads = 0;

  for (let b = 0; b < buckets.length; b++) {
    const p = buckets[b];
    if (!p || p.vertCount === 0) continue;
    totalVerts += p.vertCount;
    totalIndices += p.indexCount;
    totalRawFaces += p.rawFaces;
    totalMergedQuads += p.mergedQuads;
  }

  if (totalVerts === 0) {
    return createEmptyLodSubMeshPayload();
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const ao = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIndices);
  const groups: SubMeshMaterialGroup[] = [];

  let vOffset = 0;
  let iOffset = 0;

  for (let b = 0; b < buckets.length; b++) {
    const p = buckets[b];
    if (!p || p.vertCount === 0) continue;

    const v3 = p.vertCount * 3;
    positions.set(p.positions.subarray(0, v3), vOffset * 3);
    normals.set(p.normals.subarray(0, v3), vOffset * 3);
    colors.set(p.colors.subarray(0, v3), vOffset * 3);
    if (p.ao && p.ao.length >= p.vertCount) {
      ao.set(p.ao.subarray(0, p.vertCount), vOffset);
    } else {
      ao.fill(1.0, vOffset, vOffset + p.vertCount);
    }

    const srcIdx = p.indices;
    const iCount = p.indexCount;
    for (let i = 0; i < iCount; i++) {
      indices[iOffset + i] = srcIdx[i] + vOffset;
    }

    groups.push({
      materialBucket: b,
      start: iOffset,
      count: iCount,
    });

    vOffset += p.vertCount;
    iOffset += iCount;
  }

  return {
    positions,
    normals,
    colors,
    ao,
    indices,
    vertCount: totalVerts,
    indexCount: totalIndices,
    rawFaces: totalRawFaces,
    mergedQuads: totalMergedQuads,
    groups,
  };
}

// Pre-allocated typed-array scratchpads for LOD1/LOD2/LOD3 custom color downsampling (#7)
let _lodCustomColorsStep2 = new Uint8Array((CHUNK_X >> 1) * CHUNK_Y * (CHUNK_Z >> 1) * 3);
let _lodCustomColorsStep4 = new Uint8Array((CHUNK_X >> 2) * CHUNK_Y * (CHUNK_Z >> 2) * 3);
let _lodCustomColorsStep8 = new Uint8Array((CHUNK_X >> 3) * CHUNK_Y * (CHUNK_Z >> 3) * 3);

// Pre-allocated scratchpads for fast 2D top-surface LOD1 (32x32), LOD2 (16x16), & LOD3 (8x8) downsampling
const _surfLod1H = new Uint16Array(32 * 32);
const _surfLod1V = new Uint8Array(32 * 32);
const _surfLod2H = new Uint16Array(16 * 16);
const _surfLod2V = new Uint8Array(16 * 16);
const _surfLod3H = new Uint16Array(8 * 8);
const _surfLod3V = new Uint8Array(8 * 8);

// Single shared VoxelWorld surface slab views (attached once at worker startup when crossOriginIsolated)
let _sharedSurfaceVoxels: Uint8Array | null = null;
let _sharedSurfaceHeights: Uint16Array | null = null;
let _sharedSurfaceVoxelsStride = CHUNK_X * 4 * CHUNK_Z;
let _sharedSurfaceHeightStride = CHUNK_X * CHUNK_Z;
let _sharedSurfaceSlabCapacity = 0;

function downsampleSurfaceGrid(
  step: 2 | 4 | 8,
  srcH: Uint16Array,
  srcVoxels: Uint8Array,
  outH: Uint16Array,
  outV: Uint8Array,
): { dimsX: number; dimsZ: number } {
  const dimsX = CHUNK_X / step;
  const dimsZ = CHUNK_Z / step;
  const isCompact = srcVoxels.length < CHUNK_X * CHUNK_Y * CHUNK_Z;
  const compactYStride = isCompact
    ? Math.max(1, Math.floor(srcVoxels.length / (CHUNK_X * CHUNK_Z)))
    : CHUNK_Y;

  for (let dz = 0; dz < dimsZ; dz++) {
    const baseZ = dz * step;
    const outRow = dz * dimsX;
    for (let dx = 0; dx < dimsX; dx++) {
      const baseX = dx * step;
      let bestH = 0;
      let bestLx = baseX;
      let bestLz = baseZ;
      for (let oz = 0; oz < step; oz++) {
        const lz = baseZ + oz;
        const hOff = lz * CHUNK_X;
        for (let ox = 0; ox < step; ox++) {
          const lx = baseX + ox;
          const h = srcH[lx + hOff];
          if (h >= bestH) {
            bestH = h;
            bestLx = lx;
            bestLz = lz;
          }
        }
      }
      outH[dx + outRow] = bestH;
      const srcIdx = isCompact
        ? bestLx + CHUNK_X * compactYStride * bestLz
        : bestLx + CHUNK_X * (bestH + CHUNK_Y * bestLz);
      outV[dx + outRow] = srcVoxels[srcIdx] || MAT.ROCK;
    }
  }
  return { dimsX, dimsZ };
}

/**
 * Pure function that computes all 3 Seamless LOD levels for a 64x96x64 micro-voxel chunk:
 * - Supports zero-copy worker-side procedural top-surface generation with 66x66 padded apron
 *   and downsampled LOD1 (32x32) / LOD2 (16x16) surface meshes!
 * - Splits LOD0 opaque geometry by material bucket (SOIL, ROCK, STRUCTURAL) so partial edits
 *   only rebuild the affected material bucket(s) (#8)!
 * - Skips translucent water/glass meshing completely when translucent voxels weren't touched (#8)!
 */
export function buildAllLodPayloadsForChunk(
  req: ChunkMeshJobRequest,
): ChunkMeshJobResponse {
  const { jobId, cx, cz, originX, originZ, customColors } = req;
  let minY = req.minY;
  let maxY = req.maxY;
  let voxels = req.voxels;
  let shMap = req.surfaceHeightMap;
  let nbSurf = req.neighborSurfaceHeights;
  let hasTrans = req.hasTranslucent ?? true;
  let tMinY = req.transMinY !== undefined ? req.transMinY : minY;
  let tMaxY = req.transMaxY !== undefined ? req.transMaxY : maxY;

  let generatedSurfaceVoxels: Uint8Array | undefined;
  let generatedSurfaceHeightMap: Uint16Array | undefined;
  let generatedMeta: {
    minY: number;
    maxY: number;
    hasTranslucent: boolean;
    transMinY: number;
    transMaxY: number;
  } | null = null;

  const canUseSlabSlot =
    req.useSharedSlab === true &&
    req.slotIndex !== undefined &&
    req.slotIndex >= 0 &&
    req.slotIndex < _sharedSurfaceSlabCapacity &&
    _sharedSurfaceVoxels !== null &&
    _sharedSurfaceHeights !== null;

  // Worker-side procedural top-surface generation (with deterministic 66x66 border apron -> zero neighbor cascade!)
  if (req.generateSurfaceTerrain && req.worldGenMode) {
    const mode = req.worldGenMode;
    const flatMat = req.flatBaseplateMat ?? MAT.CONCRETE;
    const isFlat = mode === 'FLAT_BASEPLATE';
    const halfVX = TOTAL_VX >> 1;
    const halfVZ = TOTAL_VZ >> 1;
    const surfChunkY = 4;

    if (canUseSlabSlot) {
      const vOff = req.slotIndex! * _sharedSurfaceVoxelsStride;
      const hOff = req.slotIndex! * _sharedSurfaceHeightStride;
      voxels = _sharedSurfaceVoxels!.subarray(vOff, vOff + _sharedSurfaceVoxelsStride);
      shMap = _sharedSurfaceHeights!.subarray(hOff, hOff + _sharedSurfaceHeightStride);
      voxels.fill(0);
    } else {
      voxels = new Uint8Array(CHUNK_X * surfChunkY * CHUNK_Z);
      shMap = new Uint16Array(CHUNK_X * CHUNK_Z);
      generatedSurfaceVoxels = voxels;
      generatedSurfaceHeightMap = shMap;
    }

    let cMinY = CHUNK_Y - 1;
    let cMaxY = 0;
    let foundTrans = false;

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      const vz = cz * CHUNK_Z + lz;
      const wz = (vz - halfVZ) * VOXEL_SIZE;
      const hRowOff = lz << 6;
      const vRowOff = CHUNK_X * surfChunkY * lz;

      for (let lx = 0; lx < CHUNK_X; lx++) {
        const vx = cx * CHUNK_X + lx;
        const wx = (vx - halfVX) * VOXEL_SIZE;
        const col = evaluateBiomeColumn(wx, wz, vx, vz, mode, flatMat, null);
        const surfVY = col.surfVY;
        shMap[lx + hRowOff] = surfVY;

        const colBase = lx + vRowOff;
        voxels[colBase] = col.topMat;
        if (surfVY >= 1) voxels[colBase + CHUNK_X] = col.subMat;
        if (surfVY >= 2) voxels[colBase + 2 * CHUNK_X] = MAT.ROCK;

        let colTop = surfVY;
        if (!isFlat && surfVY < WATER_VY && isWaterBasinArea(wx, wz, mode)) {
          foundTrans = true;
          voxels[colBase + 3 * CHUNK_X] = MAT.WATER_VOX;
          if (WATER_VY > colTop) colTop = WATER_VY;
        }

        if (surfVY - 2 < cMinY) cMinY = Math.max(1, surfVY - 2);
        if (colTop + 1 > cMaxY) cMaxY = Math.min(CHUNK_Y - 1, colTop + 1);
      }
    }

    // Compute exact deterministic 1-voxel neighbor border height strips (66x66 padded apron)
    // so newly streamed procedural chunks NEVER need to invalidate or re-mesh their neighbors!
    const westStrip = new Uint16Array(CHUNK_Z);
    const eastStrip = new Uint16Array(CHUNK_Z);
    const northStrip = new Uint16Array(CHUNK_X);
    const southStrip = new Uint16Array(CHUNK_X);
    const westVX = cx * CHUNK_X - 1;
    const westWX = (westVX - halfVX) * VOXEL_SIZE;
    const eastVX = cx * CHUNK_X + CHUNK_X;
    const eastWX = (eastVX - halfVX) * VOXEL_SIZE;
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      const vz = cz * CHUNK_Z + lz;
      const wz = (vz - halfVZ) * VOXEL_SIZE;
      westStrip[lz] = evaluateBiomeColumn(westWX, wz, westVX, vz, mode, flatMat, null).surfVY;
      eastStrip[lz] = evaluateBiomeColumn(eastWX, wz, eastVX, vz, mode, flatMat, null).surfVY;
    }
    const northVZ = cz * CHUNK_Z - 1;
    const northWZ = (northVZ - halfVZ) * VOXEL_SIZE;
    const southVZ = cz * CHUNK_Z + CHUNK_Z;
    const southWZ = (southVZ - halfVZ) * VOXEL_SIZE;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const vx = cx * CHUNK_X + lx;
      const wx = (vx - halfVX) * VOXEL_SIZE;
      northStrip[lx] = evaluateBiomeColumn(wx, northWZ, vx, northVZ, mode, flatMat, null).surfVY;
      southStrip[lx] = evaluateBiomeColumn(wx, southWZ, vx, southVZ, mode, flatMat, null).surfVY;
    }
    nbSurf = {
      west: westStrip,
      east: eastStrip,
      north: northStrip,
      south: southStrip,
    };

    minY = Math.max(1, Math.min(cMinY, cMaxY));
    maxY = Math.max(minY + 1, cMaxY);
    hasTrans = foundTrans;
    tMinY = foundTrans ? Math.max(1, WATER_VY - 1) : CHUNK_Y;
    tMaxY = foundTrans ? Math.min(CHUNK_Y - 1, WATER_VY + 1) : 0;
    generatedMeta = {
      minY,
      maxY,
      hasTranslucent: foundTrans,
      transMinY: tMinY,
      transMaxY: tMaxY,
    };
  } else if (req.isSurfaceOnly && canUseSlabSlot) {
    const vOff = req.slotIndex! * _sharedSurfaceVoxelsStride;
    const hOff = req.slotIndex! * _sharedSurfaceHeightStride;
    voxels = _sharedSurfaceVoxels!.subarray(vOff, vOff + _sharedSurfaceVoxelsStride);
    shMap = _sharedSurfaceHeights!.subarray(hOff, hOff + _sharedSurfaceHeightStride);
  }

  const voxLen = voxels.length;
  const chunkY = Math.max(1, Math.round(voxLen / (CHUNK_X * CHUNK_Z)));
  const dirtyBucketMask =
    req.dirtyBucketMask !== undefined && req.dirtyBucketMask !== 0
      ? req.dirtyBucketMask
      : MAT_BUCKET_ALL_MASK;

  // Fast worker-side top-surface-only meshing path (zero main-thread meshing!)
  if (req.isSurfaceOnly && shMap) {
    const lod12Only = req.lod12Only === true;
    const getBoundarySurfVY = (lx: number, lz: number): number => {
      if (lx < 0) {
        return nbSurf?.west && lz >= 0 && lz < CHUNK_Z ? nbSurf.west[lz] : 0;
      }
      if (lx >= CHUNK_X) {
        return nbSurf?.east && lz >= 0 && lz < CHUNK_Z ? nbSurf.east[lz] : 0;
      }
      if (lz < 0) {
        return nbSurf?.north && lx >= 0 && lx < CHUNK_X ? nbSurf.north[lx] : 0;
      }
      if (lz >= CHUNK_Z) {
        return nbSurf?.south && lx >= 0 && lx < CHUNK_X ? nbSurf.south[lx] : 0;
      }
      return 0;
    };

    const lod0 = lod12Only
      ? createEmptyLodSubMeshPayload()
      : greedyMeshTopSurfaceOnly(
          CHUNK_X,
          CHUNK_Y,
          CHUNK_Z,
          shMap,
          voxels,
          originX,
          0,
          originZ,
          VOXEL_SIZE,
          customColors,
          false,
          getBoundarySurfVY,
          VOXEL_SIZE,
        );

    const buildSurfaceLods = lod12Only || req.buildSurfaceLods !== false;
    let lod1 = createEmptyLodSubMeshPayload();
    let lod2 = createEmptyLodSubMeshPayload();
    let lod3 = createEmptyLodSubMeshPayload();
    if (buildSurfaceLods) {
      const makeLodBoundarySampler = (step: 2 | 4 | 8) => {
        const dX = CHUNK_X / step;
        const dZ = CHUNK_Z / step;
        return (lx: number, lz: number): number => {
          let minBorder = CHUNK_Y;
          if (lx < 0 && nbSurf?.west) {
            const z0 = Math.max(0, Math.min(CHUNK_Z - step, lz * step));
            for (let o = 0; o < step; o++) {
              const v = nbSurf.west[z0 + o];
              if (v < minBorder) minBorder = v;
            }
            return minBorder === CHUNK_Y ? 0 : minBorder;
          }
          if (lx >= dX && nbSurf?.east) {
            const z0 = Math.max(0, Math.min(CHUNK_Z - step, lz * step));
            for (let o = 0; o < step; o++) {
              const v = nbSurf.east[z0 + o];
              if (v < minBorder) minBorder = v;
            }
            return minBorder === CHUNK_Y ? 0 : minBorder;
          }
          if (lz < 0 && nbSurf?.north) {
            const x0 = Math.max(0, Math.min(CHUNK_X - step, lx * step));
            for (let o = 0; o < step; o++) {
              const v = nbSurf.north[x0 + o];
              if (v < minBorder) minBorder = v;
            }
            return minBorder === CHUNK_Y ? 0 : minBorder;
          }
          if (lz >= dZ && nbSurf?.south) {
            const x0 = Math.max(0, Math.min(CHUNK_X - step, lx * step));
            for (let o = 0; o < step; o++) {
              const v = nbSurf.south[x0 + o];
              if (v < minBorder) minBorder = v;
            }
            return minBorder === CHUNK_Y ? 0 : minBorder;
          }
          return 0;
        };
      };

      const d1 = downsampleSurfaceGrid(2, shMap, voxels, _surfLod1H, _surfLod1V);
      lod1 = greedyMeshTopSurfaceOnly(
        d1.dimsX,
        CHUNK_Y,
        d1.dimsZ,
        _surfLod1H,
        _surfLod1V,
        originX,
        0,
        originZ,
        VOXEL_SIZE * 2,
        null,
        false,
        makeLodBoundarySampler(2),
        VOXEL_SIZE,
      );

      const d2 = downsampleSurfaceGrid(4, shMap, voxels, _surfLod2H, _surfLod2V);
      lod2 = greedyMeshTopSurfaceOnly(
        d2.dimsX,
        CHUNK_Y,
        d2.dimsZ,
        _surfLod2H,
        _surfLod2V,
        originX,
        0,
        originZ,
        VOXEL_SIZE * 4,
        null,
        false,
        makeLodBoundarySampler(4),
        VOXEL_SIZE,
      );

      const d3 = downsampleSurfaceGrid(8, shMap, voxels, _surfLod3H, _surfLod3V);
      lod3 = greedyMeshTopSurfaceOnly(
        d3.dimsX,
        CHUNK_Y,
        d3.dimsZ,
        _surfLod3H,
        _surfLod3V,
        originX,
        0,
        originZ,
        VOXEL_SIZE * 8,
        null,
        false,
        makeLodBoundarySampler(8),
        VOXEL_SIZE,
      );
    }

    const transLod0 =
      !lod12Only && hasTrans
        ? greedyMeshWaterTopSurfaceOnly(
            CHUNK_X,
            CHUNK_Y,
            CHUNK_Z,
            WATER_VY,
            voxels,
            originX,
            0,
            originZ,
            VOXEL_SIZE,
            false,
            undefined,
            shMap,
          )
        : createEmptyLodSubMeshPayload();

    const empty = createEmptyLodSubMeshPayload();
    return {
      type: 'mesh',
      jobId,
      cx,
      cz,
      dirtyBucketMask: MAT_BUCKET_ALL_MASK,
      lod0,
      lod0Buckets: [null, null, null],
      lod1,
      lod2,
      lod3,
      transLod0,
      transLod1: empty,
      transLod2: empty,
      transSkipped: lod12Only,
      lod12Deferred: !buildSurfaceLods,
      lod12Only,
      isSurfaceOnly: true,
      generatedSurfaceVoxels,
      generatedSurfaceHeightMap,
      generatedMinY: generatedMeta?.minY,
      generatedMaxY: generatedMeta?.maxY,
      generatedHasTranslucent: generatedMeta?.hasTranslucent,
      generatedTransMinY: generatedMeta?.transMinY,
      generatedTransMaxY: generatedMeta?.transMaxY,
    };
  }

  const sampleVoxel = (lx: number, ly: number, lz: number) =>
    voxels[lx + CHUNK_X * (ly + chunkY * lz)];
  const sampleBoundaryVoxel = createChunkBoundaryVoxelSampler(
    req.neighborBorders,
    chunkY,
  );

  const lod12Only = req.lod12Only === true;

  // 1. LOD0 Per-Material-Bucket Submesh Meshing (#8) — skipped when lod12Only is requested
  const lod0Buckets: [
    LodSubMeshPayload | null,
    LodSubMeshPayload | null,
    LodSubMeshPayload | null,
  ] = [null, null, null];

  if (!lod12Only) {
    const bucketIds: [0, 1, 2] = [
      MAT_BUCKET_SOIL,
      MAT_BUCKET_ROCK,
      MAT_BUCKET_STRUCTURAL,
    ];
    for (let bIdx = 0; bIdx < 3; bIdx++) {
      const bucket = bucketIds[bIdx];
      if ((dirtyBucketMask & (1 << bucket)) !== 0) {
        lod0Buckets[bucket] = greedyMeshBoundedArrays(
          CHUNK_X,
          chunkY,
          CHUNK_Z,
          minY,
          maxY,
          sampleVoxel,
          originX,
          0,
          originZ,
          VOXEL_SIZE,
          VOXEL_SIZE,
          'OPAQUE_ONLY',
          customColors,
          false,
          bucket,
          sampleBoundaryVoxel,
        );
      }
    }
  }

  // Merge whichever buckets were built in this job (all 3 on full build, or partial on incremental update)
  const lod0 = lod12Only
    ? createEmptyLodSubMeshPayload()
    : mergeOpaqueBucketPayloads(lod0Buckets);

  const transDirty = !lod12Only && (dirtyBucketMask & (1 << MAT_BUCKET_TRANSLUCENT)) !== 0;
  const transSkipped = !transDirty;
  const transLod0 =
    transDirty && hasTrans && tMaxY >= tMinY
      ? greedyMeshBoundedArrays(
          CHUNK_X,
          chunkY,
          CHUNK_Z,
          tMinY,
          tMaxY,
          sampleVoxel,
          originX,
          0,
          originZ,
          VOXEL_SIZE,
          VOXEL_SIZE,
          'TRANSLUCENT_ONLY',
        )
      : createEmptyLodSubMeshPayload();

  // Seamless Anisotropic XZ-Downsampled / Y-Exact LOD Builder (stepXZ = 2 -> 0.50m, 4 -> 1.00m, 8 -> 2.00m)
  const buildSeamlessLodStep = (
    stepXZ: 2 | 4 | 8,
    filterMode: GreedyMeshFilterMode,
    y0: number,
    y1: number,
  ): LodSubMeshPayload => {
    const dX = Math.floor(CHUNK_X / stepXZ);
    const dZ = Math.floor(CHUNK_Z / stepXZ);
    const wantTranslucent = filterMode === 'TRANSLUCENT_ONLY';

    let lodCustomColors: Uint8Array | undefined;
    if (customColors && filterMode === 'OPAQUE_ONLY') {
      const reqLen = dX * chunkY * dZ * 3;
      if (stepXZ === 2) {
        if (_lodCustomColorsStep2.length < reqLen) {
          _lodCustomColorsStep2 = new Uint8Array(reqLen);
        }
        lodCustomColors = _lodCustomColorsStep2;
      } else if (stepXZ === 4) {
        if (_lodCustomColorsStep4.length < reqLen) {
          _lodCustomColorsStep4 = new Uint8Array(reqLen);
        }
        lodCustomColors = _lodCustomColorsStep4;
      } else {
        if (_lodCustomColorsStep8.length < reqLen) {
          _lodCustomColorsStep8 = new Uint8Array(reqLen);
        }
        lodCustomColors = _lodCustomColorsStep8;
      }
      lodCustomColors.fill(0, 0, reqLen);
      const yStart = Math.max(0, y0 - 1);
      const yEnd = Math.min(chunkY - 1, y1 + 1);
      for (let lz = 0; lz < dZ; lz++) {
        const sz = lz * stepXZ;
        for (let ly = yStart; ly <= yEnd; ly++) {
          for (let lx = 0; lx < dX; lx++) {
            const sx = lx * stepXZ;
            const c0 = (sx + CHUNK_X * (ly + chunkY * sz)) * 3;
            let r = customColors[c0];
            let g = customColors[c0 + 1];
            let b = customColors[c0 + 2];
            if (r === 0 && g === 0 && b === 0) {
              const c1 = (sx + (stepXZ >> 1) + CHUNK_X * (ly + chunkY * (sz + (stepXZ >> 1)))) * 3;
              r = customColors[c1];
              g = customColors[c1 + 1];
              b = customColors[c1 + 2];
            }
            if (r !== 0 || g !== 0 || b !== 0) {
              const dst = (lx + dX * (ly + chunkY * lz)) * 3;
              lodCustomColors[dst] = r;
              lodCustomColors[dst + 1] = g;
              lodCustomColors[dst + 2] = b;
            }
          }
        }
      }
    }

    const lodBoundarySampler =
      filterMode === 'OPAQUE_ONLY' && req.neighborBorders
        ? (lx: number, ly: number, lz: number): number => {
            if (ly < 0 || ly >= chunkY) return 0;
            const borders = req.neighborBorders!;
            if (lx < 0) {
              if (!borders.west || lz < 0 || lz >= dZ) return 0;
              const baseZ = lz * stepXZ;
              let firstMat = 0;
              for (let s = 0; s < stepXZ; s++) {
                const m = borders.west[ly + chunkY * (baseZ + s)];
                if (m === 0 || isTranslucentVoxelMat(m)) return 0;
                if (s === 0) firstMat = m;
              }
              return firstMat;
            }
            if (lx >= dX) {
              if (!borders.east || lz < 0 || lz >= dZ) return 0;
              const baseZ = lz * stepXZ;
              let firstMat = 0;
              for (let s = 0; s < stepXZ; s++) {
                const m = borders.east[ly + chunkY * (baseZ + s)];
                if (m === 0 || isTranslucentVoxelMat(m)) return 0;
                if (s === 0) firstMat = m;
              }
              return firstMat;
            }
            if (lz < 0) {
              if (!borders.north || lx < 0 || lx >= dX) return 0;
              const baseX = lx * stepXZ;
              let firstMat = 0;
              for (let s = 0; s < stepXZ; s++) {
                const m = borders.north[baseX + s + CHUNK_X * ly];
                if (m === 0 || isTranslucentVoxelMat(m)) return 0;
                if (s === 0) firstMat = m;
              }
              return firstMat;
            }
            if (lz >= dZ) {
              if (!borders.south || lx < 0 || lx >= dX) return 0;
              const baseX = lx * stepXZ;
              let firstMat = 0;
              for (let s = 0; s < stepXZ; s++) {
                const m = borders.south[baseX + s + CHUNK_X * ly];
                if (m === 0 || isTranslucentVoxelMat(m)) return 0;
                if (s === 0) firstMat = m;
              }
              return firstMat;
            }
            return 0;
          }
        : undefined;

    return greedyMeshBoundedArrays(
      dX,
      chunkY,
      dZ,
      y0,
      y1,
      (lx, ly, lz) => {
        const sx = lx * stepXZ;
        const sz = lz * stepXZ;
        const m0 = voxels[sx + CHUNK_X * (ly + chunkY * sz)];
        if (m0 !== 0 && isTranslucentVoxelMat(m0) === wantTranslucent) return m0;
        const m1 = voxels[sx + (stepXZ >> 1) + CHUNK_X * (ly + chunkY * (sz + (stepXZ >> 1)))];
        if (m1 !== 0 && isTranslucentVoxelMat(m1) === wantTranslucent) return m1;
        const m2 = voxels[sx + (stepXZ - 1) + CHUNK_X * (ly + chunkY * sz)];
        if (m2 !== 0 && isTranslucentVoxelMat(m2) === wantTranslucent) return m2;
        const m3 = voxels[sx + CHUNK_X * (ly + chunkY * (sz + (stepXZ - 1)))];
        if (m3 !== 0 && isTranslucentVoxelMat(m3) === wantTranslucent) return m3;
        return m0;
      },
      originX,
      0,
      originZ,
      VOXEL_SIZE * stepXZ,
      VOXEL_SIZE,
      filterMode,
      lodCustomColors,
      false,
      -1,
      lodBoundarySampler,
    );
  };

  const lod0Only = !lod12Only && req.lod0Only === true;
  const opaqueDirty = lod12Only || (!lod0Only && (dirtyBucketMask & 0b0111) !== 0);
  const lod1 = opaqueDirty
    ? buildSeamlessLodStep(2, 'OPAQUE_ONLY', minY, maxY)
    : createEmptyLodSubMeshPayload();
  const lod2 = opaqueDirty
    ? buildSeamlessLodStep(4, 'OPAQUE_ONLY', minY, maxY)
    : createEmptyLodSubMeshPayload();
  const lod3 = opaqueDirty
    ? buildSeamlessLodStep(8, 'OPAQUE_ONLY', minY, maxY)
    : createEmptyLodSubMeshPayload();
  // Translucent water stays on full-resolution LOD0 to keep shorelines seamless; skip dead transLod1/2 builds
  const emptyTrans = createEmptyLodSubMeshPayload();

  return {
    type: 'mesh',
    jobId,
    cx,
    cz,
    dirtyBucketMask,
    lod0,
    lod0Buckets,
    lod1,
    lod2,
    lod3,
    transLod0,
    transLod1: emptyTrans,
    transLod2: emptyTrans,
    transSkipped,
    lod12Deferred: lod0Only,
    lod12Only,
  };
}

// Scratchpad buffers for Distant Horizons 64x64 mega-tile generation (zero GC per tile!)
const _horizonSurfH = new Uint16Array(64 * 64);
const _horizonSurfV = new Uint8Array(64 * 4 * 64);
const _horizonWestApron = new Uint16Array(64);
const _horizonEastApron = new Uint16Array(64);
const _horizonNorthApron = new Uint16Array(64);
const _horizonSouthApron = new Uint16Array(64);

/**
 * Pure, blazingly fast Distant Horizons mega-tile builder (< 0.6ms per tile).
 * Evaluates a constant 64x64 surface grid at `stepMeters = 0.25 * 2^level`, overlays any
 * `ModifiedChunkSurfaceStamp`s from destroyed/built chunks, adds a subtle 2-voxel downward
 * border skirt to eliminate inter-ring sky slivers, and greedy-meshes both terrain and ocean
 * into a single lightweight payload with exact 0.25m vertical precision.
 */
export function buildHorizonTilePayload(
  req: HorizonTileJobRequest,
): HorizonTileJobResponse {
  const { jobId, tileKey, level, tx, tz, tileChunks, stepVoxels, worldGenMode, flatBaseplateMat } = req;
  const gridN = req.gridCells === 16 || req.gridCells === 32 ? req.gridCells : 64;
  const tileChunksBig = req.tileChunksBig ?? BigInt(Math.max(1, Math.round(tileChunks)));
  const txBig = req.txBig ?? BigInt(Math.round(tx));
  const tzBig = req.tzBig ?? BigInt(Math.round(tz));
  const scaleBand = req.scaleBand ?? 0;
  const bandScaleMetersBig = req.bandScaleMetersBig ?? 1n;

  const minCXBig = txBig * tileChunksBig;
  const minCZBig = tzBig * tileChunksBig;
  const halfWorldChunksXBig = BigInt(WORLD_CHUNKS_X >> 1);
  const halfWorldChunksZBig = BigInt(WORLD_CHUNKS_Z >> 1);
  const originXBig = (minCXBig - halfWorldChunksXBig) * 16n;
  const originZBig = (minCZBig - halfWorldChunksZBig) * 16n;
  const originX = Number(originXBig);
  const originZ = Number(originZBig);

  // Exact tile-local cell size divided by the band's scale factor on CPU so every Float32
  // vertex stays safely inside [0 .. 8192] even for 10^31 km cosmic rings!
  const tileWorldMetersBig = tileChunksBig * 16n;
  const tileWidthScaled =
    bandScaleMetersBig <= 1n
      ? Number(tileWorldMetersBig)
      : Number(tileWorldMetersBig / bandScaleMetersBig) +
        Number(tileWorldMetersBig % bandScaleMetersBig) / Number(bandScaleMetersBig);
  const scaledStepXZ = tileWidthScaled / gridN;
  const scaledStepY =
    bandScaleMetersBig <= 1n
      ? VOXEL_SIZE
      : VOXEL_SIZE / Number(bandScaleMetersBig);

  // Exact BigInt voxel stride per grid cell (tile spans tileChunksBig * 64n voxels)
  const cellStepVoxelsBig = (tileChunksBig * 64n) / BigInt(gridN);
  const halfCellStepBig = cellStepVoxelsBig >> 1n;
  const minVXBig = minCXBig * 64n;
  const minVZBig = minCZBig * 64n;

  const halfVX = TOTAL_VX * 0.5;
  const halfVZ = TOTAL_VZ * 0.5;
  const isFlat = worldGenMode === 'FLAT_BASEPLATE';
  const useIntegerHashedTerrain =
    scaleBand > 0 ||
    level >= 10 ||
    cellStepVoxelsBig > 1024n ||
    minVXBig > 268435456n ||
    minVXBig < -268435456n ||
    minVZBig > 268435456n ||
    minVZBig < -268435456n;
  const useMacroPeakSampler = !isFlat && !useIntegerHashedTerrain && level >= 7;
  const quarterStep = Math.max(1, Math.floor(stepVoxels * 0.25));

  // Build fast stamp lookup map only if modified chunks overlap this tile (Band 0 / local rings)
  let stampMap: Map<string, ModifiedChunkSurfaceStamp> | null = null;
  if (scaleBand === 0 && req.stamps && req.stamps.length > 0) {
    stampMap = new Map();
    for (let i = 0; i < req.stamps.length; i++) {
      const st = req.stamps[i];
      stampMap.set(`${st.cx},${st.cz}`, st);
    }
  }

  const sampleSinglePointLocal = (
    vx: number,
    vz: number,
  ): { surfVY: number; topMat: number; hasWater: boolean } => {
    const wx = (vx - halfVX) * VOXEL_SIZE;
    const wz = (vz - halfVZ) * VOXEL_SIZE;
    const col = evaluateBiomeColumn(wx, wz, vx, vz, worldGenMode, flatBaseplateMat, null);
    const water = !isFlat && col.surfVY < WATER_VY && isWaterBasinArea(wx, wz, worldGenMode);
    return { surfVY: col.surfVY, topMat: col.topMat, hasWater: water };
  };

  const sampleCell = (
    gx: number,
    gz: number,
    allowMacroPeak: boolean,
  ): { surfVY: number; topMat: number; hasWater: boolean } => {
    if (useIntegerHashedTerrain) {
      const vxBig = minVXBig + BigInt(gx) * cellStepVoxelsBig + halfCellStepBig;
      const vzBig = minVZBig + BigInt(gz) * cellStepVoxelsBig + halfCellStepBig;
      return evaluateIntegerHashedHorizonColumn(
        vxBig,
        vzBig,
        cellStepVoxelsBig,
        worldGenMode,
        flatBaseplateMat,
      );
    }

    const vx = Number(minVXBig) + gx * Number(cellStepVoxelsBig) + Number(halfCellStepBig);
    const vz = Number(minVZBig) + gz * Number(cellStepVoxelsBig) + Number(halfCellStepBig);
    const wx = (vx - halfVX) * VOXEL_SIZE;
    const wz = (vz - halfVZ) * VOXEL_SIZE;

    if (stampMap) {
      const scx = Math.floor(vx / CHUNK_X);
      const scz = Math.floor(vz / CHUNK_Z);
      const st = stampMap.get(`${scx},${scz}`);
      if (st && st.heights16 && st.mats16) {
        const lx = ((vx % CHUNK_X) + CHUNK_X) % CHUNK_X;
        const lz = ((vz % CHUNK_Z) + CHUNK_Z) % CHUNK_Z;
        const idx16 = (lx >> 2) + ((lz >> 2) << 4);
        const h = st.heights16[idx16];
        const m = st.mats16[idx16];
        if (m !== 0) {
          const water = !isFlat && h < WATER_VY && isWaterBasinArea(wx, wz, worldGenMode);
          return { surfVY: h, topMat: m, hasWater: water };
        }
      }
    }

    if (!allowMacroPeak) {
      return sampleSinglePointLocal(vx, vz);
    }

    // 5-point peak-preserving macro sampler for mid-far Band 0 rings (LOD7..LOD9)
    const c0 = sampleSinglePointLocal(vx, vz);
    const c1 = sampleSinglePointLocal(vx - quarterStep, vz - quarterStep);
    const c2 = sampleSinglePointLocal(vx + quarterStep, vz - quarterStep);
    const c3 = sampleSinglePointLocal(vx - quarterStep, vz + quarterStep);
    const c4 = sampleSinglePointLocal(vx + quarterStep, vz + quarterStep);

    let maxH = c0.surfVY;
    let peakMat = c0.topMat;
    if (c1.surfVY > maxH) { maxH = c1.surfVY; peakMat = c1.topMat; }
    if (c2.surfVY > maxH) { maxH = c2.surfVY; peakMat = c2.topMat; }
    if (c3.surfVY > maxH) { maxH = c3.surfVY; peakMat = c3.topMat; }
    if (c4.surfVY > maxH) { maxH = c4.surfVY; peakMat = c4.topMat; }

    const avgH = (c0.surfVY + c1.surfVY + c2.surfVY + c3.surfVY + c4.surfVY) * 0.2;
    const blendedH = Math.max(1, Math.min(CHUNK_Y - 1, Math.round(maxH * 0.55 + avgH * 0.45)));
    const waterVotes =
      (c0.hasWater ? 1 : 0) +
      (c1.hasWater ? 1 : 0) +
      (c2.hasWater ? 1 : 0) +
      (c3.hasWater ? 1 : 0) +
      (c4.hasWater ? 1 : 0);
    const hasWater = waterVotes >= 3 && blendedH < WATER_VY;
    return { surfVY: blendedH, topMat: peakMat, hasWater };
  };

  const activeCells = gridN * gridN;
  _horizonSurfV.fill(0, 0, activeCells * 4);
  let foundWater = false;

  for (let gz = 0; gz < gridN; gz++) {
    const hRowOff = gz * gridN;
    const vRowOff = gridN * 4 * gz;
    for (let gx = 0; gx < gridN; gx++) {
      const cell = sampleCell(gx, gz, useMacroPeakSampler);
      const base = gx + vRowOff;
      if (scaleBand > 0 && cell.hasWater) {
        // For cosmic scale bands (16 km .. 10^31 km), bake ocean directly into the single
        // opaque mesh at sea level so cosmic bands need ZERO separate transparent water draw calls!
        _horizonSurfH[gx + hRowOff] = WATER_VY;
        _horizonSurfV[base] = MAT.WATER_VOX;
      } else {
        _horizonSurfH[gx + hRowOff] = cell.surfVY;
        _horizonSurfV[base] = cell.topMat;
        if (cell.hasWater) {
          _horizonSurfV[base + 3 * gridN] = MAT.WATER_VOX;
          foundWater = true;
        }
      }
    }
  }

  // Deterministic 1-cell border apron with level-scaled downward skirt so transitions
  // between adjacent outer LOD rings never expose sky slivers
  const skirtDrop = Math.min(64, 3 + Math.min(level, 15) * 4);
  for (let gz = 0; gz < gridN; gz++) {
    const wH = sampleCell(-1, gz, false).surfVY;
    const eH = sampleCell(gridN, gz, false).surfVY;
    _horizonWestApron[gz] = wH > skirtDrop ? wH - skirtDrop : 1;
    _horizonEastApron[gz] = eH > skirtDrop ? eH - skirtDrop : 1;
  }
  for (let gx = 0; gx < gridN; gx++) {
    const nH = sampleCell(gx, -1, false).surfVY;
    const sH = sampleCell(gx, gridN, false).surfVY;
    _horizonNorthApron[gx] = nH > skirtDrop ? nH - skirtDrop : 1;
    _horizonSouthApron[gx] = sH > skirtDrop ? sH - skirtDrop : 1;
  }

  const getBoundarySurfVY = (lx: number, lz: number): number => {
    if (lx < 0) return lz >= 0 && lz < gridN ? _horizonWestApron[lz] : 0;
    if (lx >= gridN) return lz >= 0 && lz < gridN ? _horizonEastApron[lz] : 0;
    if (lz < 0) return lx >= 0 && lx < gridN ? _horizonNorthApron[lx] : 0;
    if (lz >= gridN) return lx >= 0 && lx < gridN ? _horizonSouthApron[lx] : 0;
    return 0;
  };

  // Emit vertices in BAND-SCALED TILE-LOCAL coordinates ([0 .. <= 8192]) so GPU Float32 attributes
  // never overflow even for 10^31 km cosmic mega-tiles!
  // Slice scratch buffers to exact gridN dimensions so compactYStride is always 4 even when gridN is 32 or 16.
  const activeSurfH =
    gridN === 64 ? _horizonSurfH : _horizonSurfH.subarray(0, activeCells);
  const activeSurfV =
    gridN === 64 ? _horizonSurfV : _horizonSurfV.subarray(0, activeCells * 4);

  const opaque = greedyMeshTopSurfaceOnly(
    gridN,
    CHUNK_Y,
    gridN,
    activeSurfH,
    activeSurfV,
    0,
    0,
    0,
    scaledStepXZ,
    null,
    false,
    getBoundarySurfVY,
    scaledStepY,
  );

  const water = foundWater
    ? greedyMeshWaterTopSurfaceOnly(
        gridN,
        CHUNK_Y,
        gridN,
        WATER_VY,
        activeSurfV,
        0,
        0,
        0,
        scaledStepXZ,
        false,
        undefined,
        activeSurfH,
        scaledStepY,
      )
    : createEmptyLodSubMeshPayload();

  return {
    type: 'horizonTile',
    jobId,
    tileKey,
    level,
    tx,
    tz,
    originX,
    originZ,
    originXBig,
    originZBig,
    scaleBand,
    bandScaleMetersBig,
    opaque,
    water,
  };
}

// If running inside a dedicated Web Worker thread, listen for chunk meshing, horizon tile & keep-alive ping jobs
const isWorkerScope =
  typeof self !== 'undefined' &&
  typeof window === 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function';

if (isWorkerScope) {
  self.onmessage = (
    e: MessageEvent<
      ChunkMeshJobRequest | HorizonTileJobRequest | WorkerPingRequest | WorkerInitSlabRequest
    >,
  ) => {
    const data = e.data;
    if (data && data.type === 'initSlab') {
      _sharedSurfaceVoxels = new Uint8Array(data.surfaceVoxelsSab);
      _sharedSurfaceHeights = new Uint16Array(data.surfaceHeightSab);
      _sharedSurfaceVoxelsStride = data.surfaceVoxelsStride;
      _sharedSurfaceHeightStride = data.surfaceHeightStride;
      _sharedSurfaceSlabCapacity = data.surfaceSlabCapacity;
      return;
    }
    if (data && data.type === 'ping') {
      warmUpGreedyMesherScratchpad();
      const pong: WorkerPingResponse = { type: 'pong', jobId: data.jobId };
      (self as unknown as Worker).postMessage(pong);
      return;
    }

    const transferSet = new Set<ArrayBuffer>();
    const addPayloadBuffers = (p: LodSubMeshPayload | null | undefined) => {
      if (!p || p.vertCount === 0) return;
      p.positionsBuffer = p.positions.buffer as ArrayBuffer;
      p.normalsBuffer = p.normals.buffer as ArrayBuffer;
      p.colorsBuffer = p.colors.buffer as ArrayBuffer;
      p.indicesBuffer = p.indices.buffer as ArrayBuffer;
      transferSet.add(p.positionsBuffer);
      transferSet.add(p.normalsBuffer);
      transferSet.add(p.colorsBuffer);
      transferSet.add(p.indicesBuffer);
      if (p.ao && p.ao.length > 0) {
        p.aoBuffer = p.ao.buffer as ArrayBuffer;
        transferSet.add(p.aoBuffer);
      }
    };

    if (data && data.type === 'horizonTile') {
      const tileRes = buildHorizonTilePayload(data as HorizonTileJobRequest);
      addPayloadBuffers(tileRes.opaque);
      addPayloadBuffers(tileRes.water);
      (self as unknown as Worker).postMessage(tileRes, Array.from(transferSet));
      return;
    }

    const res = buildAllLodPayloadsForChunk(data as ChunkMeshJobRequest);

    addPayloadBuffers(res.lod0);
    addPayloadBuffers(res.lod0Buckets[0]);
    addPayloadBuffers(res.lod0Buckets[1]);
    addPayloadBuffers(res.lod0Buckets[2]);
    addPayloadBuffers(res.lod1);
    addPayloadBuffers(res.lod2);
    addPayloadBuffers(res.lod3);
    addPayloadBuffers(res.transLod0);
    addPayloadBuffers(res.transLod1);
    addPayloadBuffers(res.transLod2);

    if (res.generatedSurfaceVoxels) {
      res.generatedSurfaceVoxelsBuffer = res.generatedSurfaceVoxels.buffer as ArrayBuffer;
      transferSet.add(res.generatedSurfaceVoxelsBuffer);
      res.generatedSurfaceVoxels = undefined;
    }
    if (res.generatedSurfaceHeightMap) {
      res.generatedSurfaceHeightMapBuffer = res.generatedSurfaceHeightMap.buffer as ArrayBuffer;
      transferSet.add(res.generatedSurfaceHeightMapBuffer);
      res.generatedSurfaceHeightMap = undefined;
    }

    (self as unknown as Worker).postMessage(res, Array.from(transferSet));
  };
}

