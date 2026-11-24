import {
  VOXEL_SIZE,
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  WATER_VY,
} from './constants.ts';
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
  /** If true, defer LOD1 and LOD2 generation until all chunks have reached LOD0 MESH_READY */
  lod0Only?: boolean;
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
    west?: Uint8Array;
    east?: Uint8Array;
    north?: Uint8Array;
    south?: Uint8Array;
  };
}

export interface WorkerPingRequest {
  type: 'ping';
  jobId: number;
}

export interface WorkerPingResponse {
  type: 'pong';
  jobId: number;
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
  transLod0: LodSubMeshPayload;
  transLod1: LodSubMeshPayload;
  transLod2: LodSubMeshPayload;
  transSkipped?: boolean;
  lod12Deferred?: boolean;
  isSurfaceOnly?: boolean;
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

// Pre-allocated typed-array scratchpads for LOD1/LOD2 custom color downsampling (#7)
let _lodCustomColorsStep2 = new Uint8Array((CHUNK_X >> 1) * CHUNK_Y * (CHUNK_Z >> 1) * 3);
let _lodCustomColorsStep4 = new Uint8Array((CHUNK_X >> 2) * CHUNK_Y * (CHUNK_Z >> 2) * 3);

/**
 * Pure function that computes all 3 Seamless LOD levels for a 64x96x64 micro-voxel chunk:
 * - Splits LOD0 opaque geometry by material bucket (SOIL, ROCK, STRUCTURAL) so partial edits
 *   only rebuild the affected material bucket(s) (#8)!
 * - Skips translucent water/glass meshing completely when translucent voxels weren't touched (#8)!
 */
export function buildAllLodPayloadsForChunk(
  req: ChunkMeshJobRequest,
): ChunkMeshJobResponse {
  const { jobId, cx, cz, minY, maxY, originX, originZ, voxels, customColors } = req;
  const voxLen = voxels.length;
  const chunkY = Math.max(1, Math.round(voxLen / (CHUNK_X * CHUNK_Z)));
  const hasTrans = req.hasTranslucent ?? true;
  const tMinY = req.transMinY !== undefined ? req.transMinY : minY;
  const tMaxY = req.transMaxY !== undefined ? req.transMaxY : maxY;
  const dirtyBucketMask =
    req.dirtyBucketMask !== undefined && req.dirtyBucketMask !== 0
      ? req.dirtyBucketMask
      : MAT_BUCKET_ALL_MASK;

  // Fast worker-side top-surface-only meshing path (zero main-thread meshing!)
  if (req.isSurfaceOnly && req.surfaceHeightMap) {
    const shMap = req.surfaceHeightMap;
    const nbSurf = req.neighborSurfaceHeights;
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

    const lod0 = greedyMeshTopSurfaceOnly(
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
    );

    const transLod0 = hasTrans
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
      lod1: empty,
      lod2: empty,
      transLod0,
      transLod1: empty,
      transLod2: empty,
      transSkipped: false,
      lod12Deferred: true,
      isSurfaceOnly: true,
    };
  }

  const sampleVoxel = (lx: number, ly: number, lz: number) =>
    voxels[lx + CHUNK_X * (ly + chunkY * lz)];
  const sampleBoundaryVoxel = createChunkBoundaryVoxelSampler(
    req.neighborBorders,
    chunkY,
  );

  // 1. LOD0 Per-Material-Bucket Submesh Meshing (#8)
  const lod0Buckets: [
    LodSubMeshPayload | null,
    LodSubMeshPayload | null,
    LodSubMeshPayload | null,
  ] = [null, null, null];

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

  // Merge whichever buckets were built in this job (all 3 on full build, or partial on incremental update)
  const lod0 = mergeOpaqueBucketPayloads(lod0Buckets);

  const transDirty = (dirtyBucketMask & (1 << MAT_BUCKET_TRANSLUCENT)) !== 0;
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

  // Seamless Anisotropic XZ-Downsampled / Y-Exact LOD Builder (stepXZ = 2 for 0.50m, stepXZ = 4 for 1.00m)
  const buildSeamlessLodStep = (
    stepXZ: 2 | 4,
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
      } else {
        if (_lodCustomColorsStep4.length < reqLen) {
          _lodCustomColorsStep4 = new Uint8Array(reqLen);
        }
        lodCustomColors = _lodCustomColorsStep4;
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

  const lod0Only = req.lod0Only === true;
  const opaqueDirty = !lod0Only && (dirtyBucketMask & 0b0111) !== 0;
  const lod1 = opaqueDirty
    ? buildSeamlessLodStep(2, 'OPAQUE_ONLY', minY, maxY)
    : createEmptyLodSubMeshPayload();
  const lod2 = opaqueDirty
    ? buildSeamlessLodStep(4, 'OPAQUE_ONLY', minY, maxY)
    : createEmptyLodSubMeshPayload();
  const transLod1 =
    !lod0Only && transDirty && hasTrans && tMaxY >= tMinY && transLod0.vertCount > 0
      ? buildSeamlessLodStep(2, 'TRANSLUCENT_ONLY', tMinY, tMaxY)
      : createEmptyLodSubMeshPayload();
  const transLod2 =
    !lod0Only && transDirty && hasTrans && tMaxY >= tMinY && transLod0.vertCount > 0
      ? buildSeamlessLodStep(4, 'TRANSLUCENT_ONLY', tMinY, tMaxY)
      : createEmptyLodSubMeshPayload();

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
    transLod0,
    transLod1,
    transLod2,
    transSkipped,
    lod12Deferred: lod0Only,
  };
}

// If running inside a dedicated Web Worker thread, listen for chunk meshing & keep-alive ping jobs
const isWorkerScope =
  typeof self !== 'undefined' &&
  typeof window === 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function';

if (isWorkerScope) {
  self.onmessage = (
    e: MessageEvent<ChunkMeshJobRequest | WorkerPingRequest>,
  ) => {
    const data = e.data;
    if (data && data.type === 'ping') {
      warmUpGreedyMesherScratchpad();
      const pong: WorkerPingResponse = { type: 'pong', jobId: data.jobId };
      (self as unknown as Worker).postMessage(pong);
      return;
    }

    const res = buildAllLodPayloadsForChunk(data as ChunkMeshJobRequest);
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

    addPayloadBuffers(res.lod0);
    addPayloadBuffers(res.lod0Buckets[0]);
    addPayloadBuffers(res.lod0Buckets[1]);
    addPayloadBuffers(res.lod0Buckets[2]);
    addPayloadBuffers(res.lod1);
    addPayloadBuffers(res.lod2);
    addPayloadBuffers(res.transLod0);
    addPayloadBuffers(res.transLod1);
    addPayloadBuffers(res.transLod2);

    (self as unknown as Worker).postMessage(res, Array.from(transferSet));
  };
}

