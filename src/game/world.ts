import * as THREE from 'three';
import {
  VoxelWorld,
  encodeChunkId,
  getActiveVoxelWorld,
  setActiveVoxelWorld,
} from '../engine/world/VoxelWorld';
import { perfProfiler } from '../engine/perf/PerfProfiler';
import { unifiedEngineTelemetry } from './unifiedVoxelEngine.ts';
import {
  VOXEL_SIZE,
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  SURFACE_CHUNK_Y,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Z,
  TOTAL_VX,
  TOTAL_VZ,
  WATER_VY,
  STATIC_WATER_TOP_VY,
  WATER_LEVEL,
  SUBTERRANEAN_DEPTH_VY,
  MAT,
  MAT_INFO,
  type WorldGenMode,
  type WorldEditToolKind,
} from './constants.ts';
import {
  greedyMeshBoundedArrays,
  greedyMeshTopSurfaceOnly,
  greedyMeshWaterTopSurfaceOnly,
  computeCaveAtmosphereFactor,
  isTranslucentVoxelMat,
  getVoxelMaterialBucket,
  MAT_BUCKET_SOIL,
  MAT_BUCKET_ROCK,
  MAT_BUCKET_STRUCTURAL,
  MAT_BUCKET_TRANSLUCENT,
  MAT_BUCKET_ALL_MASK,
  WATER_WAVE_PALETTE_HEX,
  evaluateGerstnerWaveSample,
  type GerstnerWaveSample,
  type VoxelWaveLineState,
  type Vec3,
} from './physicsMath.ts';
import { MultiCoreMeshWorkerPool } from './meshWorkerPool.ts';
import {
  mergeOpaqueBucketPayloads,
  type ChunkMeshJobResponse,
  type ChunkNeighborBoundarySlices,
  type LodSubMeshPayload,
  type ModifiedChunkSurfaceStamp,
} from './meshWorker.ts';
import { DistantHorizonManager } from './distantHorizon.ts';
import {
  computeDynamicLodPlan,
  computeNestedRingBoxesBigInt,
  computeZoomedLod0BoxBigInt,
  createBigSectorPosition,
  DEFAULT_LOD_SPACING,
  isChunkInsideBox,
  MAX_RENDER_DISTANCE_CHUNKS,
  sanitizeLodSpacing,
  sanitizePositiveRenderDistanceBigInt,
  type ChunkBox,
  type ChunkBoxBigInt,
} from './distantHorizonMath.ts';
import {
  evaluateBiomeColumn,
  evaluateSubterraneanCaveColumn,
  isWaterBasinArea,
  rotateObjectVoxels,
  PREBUILT_OBJECTS,
  type VoxelObjectPrefab,
} from './worldObjects.ts';
export { isWaterBasinArea };
import {
  applyTrue3DParityInfill,
  classifyPhysicalLandMaterial,
} from './glbVoxelizer.ts';
import {
  computeRenderDistanceTuning,
  computeTacticalMapRenderRadiusChunks,
  resolveChunkTargetLod,
} from './touchControls.ts';
import { TerrainEntity, terrainEntityManager } from './physics/terrainEntity.ts';
import {
  findUnsupportedTerrainVoxels,
  TERRAIN_SUPPORT_MAX_BFS_VISITED,
} from './physics/terrainConnectivity.ts';
import {
  getSharedPotatoShaderMaterial,
  getSharedCartoonShaderMaterial,
  getPotatoSolidColorMaterial,
  getCartoonSolidColorMaterial,
  updateSharedPotatoShaderUniforms,
  attachGpuGerstnerOceanShader,
  type ActiveShaderMode,
  type GpuOceanWaveUniforms,
} from './potatoShader.ts';
import {
  computeLinearFogBounds,
  worldGenModeToShaderId,
} from './graphicsSettings.ts';

export enum ChunkState {
  QUEUED = 'QUEUED',
  GENERATING = 'GENERATING',
  WIREFRAME_READY = 'WIREFRAME_READY',
  MESH_READY = 'MESH_READY',
  COMPLETE = 'COMPLETE',
}

export { SURFACE_CHUNK_Y };

let sharedCubeWireGeom: THREE.BoxGeometry | null = null;
export function getSharedCubeWireframeGeometry(): THREE.BoxGeometry {
  if (!sharedCubeWireGeom) {
    sharedCubeWireGeom = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    // Find one vertex index for each of the 8 unique cube corners (±h, ±h, ±h)
    // and attach exact 12 cube-edge line pairs (24 indices) so wireframe cubes render
    // as 12 crisp 1px edges with zero face diagonals or thick filled quads.
    const pos = sharedCubeWireGeom.getAttribute('position') as THREE.BufferAttribute;
    const cornerIdx = new Int32Array(8).fill(-1);
    for (let i = 0; i < pos.count; i++) {
      const bx = pos.getX(i) > 0 ? 1 : 0;
      const by = pos.getY(i) > 0 ? 2 : 0;
      const bz = pos.getZ(i) > 0 ? 4 : 0;
      const bit = bx | by | bz;
      if (cornerIdx[bit] === -1) cornerIdx[bit] = i;
    }
    const edgePairs: [number, number][] = [
      // Bottom face 4 edges (y = -h)
      [0, 1], [1, 5], [5, 4], [4, 0],
      // Top face 4 edges (y = +h)
      [2, 3], [3, 7], [7, 6], [6, 2],
      // 4 vertical pillars
      [0, 2], [1, 3], [5, 7], [4, 6],
    ];
    const lineIndices = new Uint16Array(edgePairs.length * 2);
    for (let e = 0; e < edgePairs.length; e++) {
      lineIndices[e * 2] = cornerIdx[edgePairs[e][0]];
      lineIndices[e * 2 + 1] = cornerIdx[edgePairs[e][1]];
    }
    sharedCubeWireGeom.userData.wireframeIndex = new THREE.BufferAttribute(lineIndices, 1);
  }
  return sharedCubeWireGeom;
}

const _bloomMaterialPool: THREE.Material[] = [];
const _wireInstancedMeshPool: THREE.InstancedMesh[] = [];
const _sharedWireScratch = new Int32Array(2400 * 3);
const _sharedWireMatrix = new THREE.Matrix4();

export function createBloomShaderMaterial(
  baseMaterial: THREE.Material,
  origin: THREE.Vector3,
  maxDist: number,
): THREE.Material {
  const safeMaxDist = Math.max(0.1, maxDist);
  const pooled = _bloomMaterialPool.pop();
  if (pooled && (pooled as any).uniforms) {
    const u = (pooled as any).uniforms;
    u.uFillProgress.value = 0.0;
    u.uFillOrigin.value.copy(origin);
    u.uFillMaxDist.value = safeMaxDist;
    const cs = (pooled as any)._compiledShader;
    if (cs && cs.uniforms) {
      if (cs.uniforms.uFillProgress) cs.uniforms.uFillProgress.value = 0.0;
      if (cs.uniforms.uFillOrigin) cs.uniforms.uFillOrigin.value.copy(origin);
      if (cs.uniforms.uFillMaxDist) cs.uniforms.uFillMaxDist.value = safeMaxDist;
    }
    return pooled;
  }
  const mat = baseMaterial.clone();
  mat.transparent = true;
  mat.side = THREE.DoubleSide;
  (mat as any).uniforms = {
    uFillProgress: { value: 0.0 },
    uFillOrigin: { value: origin.clone() },
    uFillMaxDist: { value: safeMaxDist },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFillProgress = (mat as any).uniforms.uFillProgress;
    shader.uniforms.uFillOrigin = (mat as any).uniforms.uFillOrigin;
    shader.uniforms.uFillMaxDist = (mat as any).uniforms.uFillMaxDist;
    (mat as any)._compiledShader = shader;

    shader.vertexShader = shader.vertexShader.replace(
      `#include <common>`,
      `
      #include <common>
      varying vec3 vWorldPosition;
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      `#include <worldpos_vertex>`,
      `
      #include <worldpos_vertex>
      vec4 realWorldPos = modelMatrix * vec4( transformed, 1.0 );
      vWorldPosition = realWorldPos.xyz;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <common>`,
      `
      #include <common>
      varying vec3 vWorldPosition;
      uniform float uFillProgress;
      uniform vec3 uFillOrigin;
      uniform float uFillMaxDist;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <dithering_fragment>`,
      `
      #include <dithering_fragment>
      float distFromOrigin = distance(vWorldPosition, uFillOrigin);
      float fillRadius = uFillProgress * (uFillMaxDist + 3.0);
      float voxelFilled = 1.0 - smoothstep(fillRadius - 0.85, fillRadius + 0.25, distFromOrigin);
      float edgeBand = smoothstep(fillRadius - 3.2, fillRadius + 0.35, distFromOrigin) * (1.0 - smoothstep(fillRadius + 0.35, fillRadius + 1.8, distFromOrigin));
      float fadeOutEdge = 1.0 - smoothstep(0.90, 1.0, uFillProgress);

      // High-visibility 3D holographic 0.25m voxel wireframe lattice ahead of the solid wavefront
      vec3 voxGrid = abs(fract(vWorldPosition / 0.25 - 0.5) - 0.5);
      // Use the two smallest axes so every 0.25m voxel cube edge is drawn brightly on all 6 faces
      float e1 = min(voxGrid.x, min(voxGrid.y, voxGrid.z));
      float e2 = max(min(voxGrid.x, voxGrid.y), min(max(voxGrid.x, voxGrid.y), voxGrid.z));
      float wireLine = 1.0 - smoothstep(0.02, 0.11, e2);

      vec3 wireCyan = vec3(0.0, 0.96, 1.0);
      vec3 wireGold = vec3(1.0, 0.88, 0.22);
      vec3 wireCol = mix(vec3(0.04, 0.20, 0.38), mix(wireCyan, wireGold, edgeBand), max(wireLine, edgeBand));

      vec3 holoGlow = mix(wireCyan, wireGold, 0.55);
      vec3 filledRgb = mix(gl_FragColor.rgb, holoGlow * 1.55, edgeBand * 0.90 * fadeOutEdge);

      gl_FragColor.rgb = mix(wireCol * 1.35, filledRgb, voxelFilled);
      float wireAlpha = max(wireLine * 0.95, 0.24) * fadeOutEdge;
      gl_FragColor.a = max(voxelFilled, wireAlpha);
      `,
    );
  };

  mat.customProgramCacheKey = () => 'voxel_bloom_fill_v1';

  return mat;
}

export class MicroVoxelChunk {
  public readonly voxelWorld: VoxelWorld;
  public readonly slotIndex: number;
  public readonly chunkId: number;
  public cx: number;
  public cz: number;
  public key: string;
  public minY = 1;
  public maxY = 12;
  public hasTranslucent = false;
  public transMinY = CHUNK_Y;
  public transMaxY = 0;
  public inDirtyQueue = false;
  public mesh: THREE.Mesh | null = null;
  public meshLOD1: THREE.Mesh | null = null;
  public meshLOD2: THREE.Mesh | null = null;
  public meshLOD3: THREE.Mesh | null = null;
  public transMesh: THREE.Mesh | null = null;
  public transMeshLOD1: THREE.Mesh | null = null;
  public transMeshLOD2: THREE.Mesh | null = null;
  public activeLodLevel: -1 | 0 | 1 | 2 | 3 = -1;

  // Chunk State Machine & Diegetic Wireframe / Bloom Fill Properties
  public state: ChunkState = ChunkState.QUEUED;
  public priority = 0;
  public spiralAngle = 0;
  public lod12Built = false;
  public wireMesh: THREE.InstancedMesh | null = null;
  public animStartTime = 0;
  public animProgress = 0;
  public fillOrigin = new THREE.Vector3();
  public fillMaxDist = 1;
  public isBloomMaterialAttached = false;

  public rawFaces = 0;
  public mergedQuads = 0;
  public lod1Quads = 0;
  public lod2Quads = 0;
  public lod3Quads = 0;
  public originX: number;
  public originZ: number;
  public centerWorld: THREE.Vector3;
  public boundingSphere: THREE.Sphere;
  public workerPending = false;
  public hasBuiltMesh = false;
  public terrainPopulated = false;
  public isSurfaceOnlyTerrain = false;
  public surfaceBaseY = 0;
  public isSurfaceOnlyMesh = false;
  public userModified = false;
  public lastAccessedMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  /** Cached per-material opaque submeshes (#8) so partial material edits never re-mesh untouched materials */
  public cachedOpaqueBuckets: [
    LodSubMeshPayload | null,
    LodSubMeshPayload | null,
    LodSubMeshPayload | null,
  ] = [null, null, null];
  /** Diagnostic counter of in-place GPU buffer updates (#1) */
  public inPlaceBufferUpdates = 0;
  /** Compact RLE-compressed voxel stream used when a modified chunk is parked in `modifiedChunkCache` */
  public compressedVoxelsRle: Uint32Array | null = null;
  /** Sparse [voxelIdx, rgb24] pairs used when a painted chunk is parked in `modifiedChunkCache` */
  public compressedColorsSparse: Uint32Array | null = null;

  constructor(
    cx: number,
    cz: number,
    isSurfaceOnly = false,
    voxelWorld: VoxelWorld = getActiveVoxelWorld(),
  ) {
    this.voxelWorld = voxelWorld;
    this.cx = cx;
    this.cz = cz;
    this.key = `${cx},${cz}`;
    this.chunkId = encodeChunkId(cx, cz);
    this.isSurfaceOnlyTerrain = isSurfaceOnly;
    this.slotIndex = voxelWorld.acquireChunkSlot(
      this.chunkId,
      cx * CHUNK_X,
      0,
      cz * CHUNK_Z,
      {
        surfaceOnly: isSurfaceOnly,
        surfaceChunkY: SURFACE_CHUNK_Y,
        allocateDamage: false,
      },
    );
    this.voxelWorld.chunkDirtyBucketMask[this.slotIndex] = MAT_BUCKET_ALL_MASK;

    this.originX = (cx - WORLD_CHUNKS_X / 2) * CHUNK_X * VOXEL_SIZE;
    this.originZ = (cz - WORLD_CHUNKS_Z / 2) * CHUNK_Z * VOXEL_SIZE;
    const halfSpan = CHUNK_X * VOXEL_SIZE * 0.5;
    this.centerWorld = new THREE.Vector3(
      this.originX + halfSpan,
      CHUNK_Y * VOXEL_SIZE * 0.5,
      this.originZ + halfSpan,
    );
    // Tight true bounding sphere of a 16m x 24m x 16m chunk (+2m safety margin) for accurate frustum culling
    const halfY = CHUNK_Y * VOXEL_SIZE * 0.5;
    this.boundingSphere = new THREE.Sphere(
      this.centerWorld,
      Math.hypot(halfSpan, halfY, halfSpan) + 2.0,
    );
  }

  public get voxels(): Uint8Array {
    return this.voxelWorld.chunkVoxels[this.slotIndex];
  }

  public set voxels(value: Uint8Array) {
    this.voxelWorld.chunkVoxels[this.slotIndex] = value;
  }

  public get customColors(): Uint8Array | null {
    return this.voxelWorld.chunkCustomColors[this.slotIndex];
  }

  public set customColors(value: Uint8Array | null) {
    this.voxelWorld.chunkCustomColors[this.slotIndex] = value;
  }

  public get surfaceHeightMap(): Uint16Array {
    return this.voxelWorld.chunkSurfaceHeightMap[this.slotIndex];
  }

  public set surfaceHeightMap(value: Uint16Array) {
    this.voxelWorld.chunkSurfaceHeightMap[this.slotIndex] = value;
  }

  public get pendingRemovals(): Map<number, number> {
    return this.voxelWorld.chunkPendingRemovals[this.slotIndex];
  }

  public set pendingRemovals(value: Map<number, number>) {
    this.voxelWorld.chunkPendingRemovals[this.slotIndex] = value;
  }

  public get dirty(): boolean {
    return this.voxelWorld.chunkDirty[this.slotIndex] === 1;
  }

  public set dirty(value: boolean) {
    this.voxelWorld.chunkDirty[this.slotIndex] = value ? 1 : 0;
  }

  public get dirtyBucketMask(): number {
    return this.voxelWorld.chunkDirtyBucketMask[this.slotIndex];
  }

  public set dirtyBucketMask(value: number) {
    this.voxelWorld.chunkDirtyBucketMask[this.slotIndex] = value >>> 0;
  }

  public get visible(): boolean {
    return this.voxelWorld.chunkVisible[this.slotIndex] === 1;
  }

  public set visible(value: boolean) {
    this.voxelWorld.setChunkVisible(this.slotIndex, value);
  }

  public get version(): number {
    return this.voxelWorld.chunkMeshVersion[this.slotIndex];
  }

  public set version(value: number) {
    this.voxelWorld.chunkMeshVersion[this.slotIndex] = value >>> 0;
  }

  public get physicsVersion(): number {
    return this.voxelWorld.chunkPhysicsVersion[this.slotIndex];
  }

  public set physicsVersion(value: number) {
    this.voxelWorld.chunkPhysicsVersion[this.slotIndex] = value >>> 0;
  }

  /**
   * Compresses `this.voxels` (819 KB) into a compact RLE `Uint32Array` (~2-8 KB) and `this.customColors` (2.45 MB)
   * into sparse `[index, rgb24]` pairs when the chunk is parked in `modifiedChunkCache`.
   */
  public compressForCache(): void {
    if (this.pendingRemovals.size > 0) {
      this.commitPendingRemovals();
    }
    if (this.compressedVoxelsRle !== null && this.voxels.length === 0) {
      return;
    }
    const vox = this.voxels;
    const len = vox.length;
    if (len > 0) {
      const runs: number[] = [];
      let curMat = vox[0];
      let runLen = 1;
      for (let i = 1; i < len; i++) {
        const m = vox[i];
        if (m === curMat && runLen < 0xffffff) {
          runLen++;
        } else {
          runs.push(((runLen & 0xffffff) << 8) | (curMat & 0xff));
          curMat = m;
          runLen = 1;
        }
      }
      runs.push(((runLen & 0xffffff) << 8) | (curMat & 0xff));
      this.compressedVoxelsRle = new Uint32Array(runs);
      this.voxels = new Uint8Array(0);
    }
    if (this.customColors && this.customColors.length > 0) {
      const cols = this.customColors;
      const sparse: number[] = [];
      const voxCount = Math.floor(cols.length / 3);
      for (let i = 0; i < voxCount; i++) {
        const cIdx = i * 3;
        const r = cols[cIdx];
        const g = cols[cIdx + 1];
        const b = cols[cIdx + 2];
        if (r !== 0 || g !== 0 || b !== 0) {
          sparse.push(i, ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff));
        }
      }
      this.compressedColorsSparse = sparse.length > 0 ? new Uint32Array(sparse) : null;
      this.customColors = null;
    }
    this.cachedOpaqueBuckets = [null, null, null];
  }

  /**
   * Restores `this.voxels` and `this.customColors` when a chunk is retrieved from `modifiedChunkCache`.
   */
  public decompressFromCache(): void {
    if (this.compressedVoxelsRle !== null) {
      const rle = this.compressedVoxelsRle;
      const targetLen = this.isSurfaceOnlyTerrain
        ? CHUNK_X * SURFACE_CHUNK_Y * CHUNK_Z
        : CHUNK_X * CHUNK_Y * CHUNK_Z;
      const out = new Uint8Array(targetLen);
      let writePos = 0;
      for (let i = 0; i < rle.length; i++) {
        const entry = rle[i];
        const runLen = entry >>> 8;
        const mat = entry & 0xff;
        const end = Math.min(targetLen, writePos + runLen);
        if (mat !== 0) {
          out.fill(mat, writePos, end);
        }
        writePos = end;
      }
      this.voxels = out;
      this.compressedVoxelsRle = null;
      this.dirtyBucketMask = MAT_BUCKET_ALL_MASK;
    }
    if (this.compressedColorsSparse !== null) {
      const sparse = this.compressedColorsSparse;
      const cols = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z * 3);
      for (let i = 0; i < sparse.length; i += 2) {
        const voxIdx = sparse[i];
        const rgb = sparse[i + 1];
        const cIdx = voxIdx * 3;
        if (cIdx + 2 < cols.length) {
          cols[cIdx] = (rgb >>> 16) & 0xff;
          cols[cIdx + 1] = (rgb >>> 8) & 0xff;
          cols[cIdx + 2] = rgb & 0xff;
        }
      }
      this.customColors = cols;
      this.compressedColorsSparse = null;
    }
  }

  /**
   * Reads a voxel from a compact 64x4x64 surface-only chunk (`isSurfaceOnlyTerrain && !userModified`).
   * Compact layout stores:
   * - layer 0: topMat at `surfVY`
   * - layer 1: subMat at `surfVY - 1`
   * - layer 2: MAT.ROCK at `<= surfVY - 2`
   * - layer 3: MAT.WATER_VOX at `surfVY < ly <= WATER_VY`
   */
  public sampleSurfaceCompactVoxel(lx: number, ly: number, lz: number): number {
    const surfVY = this.surfaceHeightMap[lx + (lz << 6)];
    if (this.voxels.length === CHUNK_X * SURFACE_CHUNK_Y * CHUNK_Z) {
      const colBase = lx + CHUNK_X * SURFACE_CHUNK_Y * lz;
      if (ly === surfVY) return this.voxels[colBase] || MAT.ROCK;
      if (ly === surfVY - 1) return this.voxels[colBase + CHUNK_X] || MAT.ROCK;
      if (ly < surfVY - 1) return MAT.ROCK;
      if (ly <= WATER_VY && this.voxels[colBase + 3 * CHUNK_X] === MAT.WATER_VOX) {
        return MAT.WATER_VOX;
      }
      return MAT.AIR;
    }
    const flatIdx = lx + CHUNK_X * (ly + CHUNK_Y * lz);
    if (ly <= surfVY) {
      const m = this.voxels[flatIdx];
      return m !== MAT.AIR ? m : MAT.ROCK;
    }
    return this.voxels[flatIdx];
  }

  /**
   * Identifies SURFACE voxels (solid voxels with at least 1 face adjacent to AIR).
   */
  public getSurfaceVoxels(): Array<{ lx: number; ly: number; lz: number }> {
    const result: Array<{ lx: number; ly: number; lz: number }> = [];
    const voxels = this.voxels;
    const CHX = CHUNK_X;
    const CHY = CHUNK_Y;
    const CHZ = CHUNK_Z;

    if (this.isSurfaceOnlyTerrain && !this.userModified) {
      for (let lz = 0; lz < CHZ; lz++) {
        const rowOff = lz << 6;
        for (let lx = 0; lx < CHX; lx++) {
          const surfVY = this.surfaceHeightMap[lx + rowOff];
          if (surfVY > 0 && surfVY < CHY) {
            result.push({ lx, ly: surfVY, lz });
          }
        }
      }
      return result;
    }

    const minY = Math.max(0, this.minY - 1);
    const maxY = Math.min(CHY - 1, this.maxY + 1);

    for (let lz = 0; lz < CHZ; lz++) {
      for (let ly = minY; ly <= maxY; ly++) {
        for (let lx = 0; lx < CHX; lx++) {
          const mat = voxels[lx + CHX * (ly + CHY * lz)];
          if (mat === MAT.AIR || mat === MAT.WATER_VOX) continue;

          let exposed = false;
          if (
            lx === 0 ||
            lx === CHX - 1 ||
            ly === 0 ||
            ly === CHY - 1 ||
            lz === 0 ||
            lz === CHZ - 1
          ) {
            exposed = true;
          } else {
            const mLeft = voxels[lx - 1 + CHX * (ly + CHY * lz)];
            const mRight = voxels[lx + 1 + CHX * (ly + CHY * lz)];
            const mDown = voxels[lx + CHX * (ly - 1 + CHY * lz)];
            const mUp = voxels[lx + CHX * (ly + 1 + CHY * lz)];
            const mBack = voxels[lx + CHX * (ly + CHY * (lz - 1))];
            const mFront = voxels[lx + CHX * (ly + CHY * (lz + 1))];

            if (
              mLeft === MAT.AIR ||
              mRight === MAT.AIR ||
              mDown === MAT.AIR ||
              mUp === MAT.AIR ||
              mBack === MAT.AIR ||
              mFront === MAT.AIR
            ) {
              exposed = true;
            }
          }

          if (exposed) {
            result.push({ lx, ly, lz });
          }
        }
      }
    }
    return result;
  }

  idx(lx: number, ly: number, lz: number): number {
    return lx + CHUNK_X * (ly + CHUNK_Y * lz);
  }

  /**
   * Marks the material bucket of `mat` (and any exposed 6-neighbors when editing a built chunk)
   * dirty in `dirtyBucketMask` (#8).
   */
  markVoxelChangeMaterialBuckets(
    lx: number,
    ly: number,
    lz: number,
    prevMat: number,
    newMat: number,
  ): void {
    if (prevMat !== MAT.AIR) {
      this.dirtyBucketMask |= 1 << getVoxelMaterialBucket(prevMat);
    }
    if (newMat !== MAT.AIR) {
      this.dirtyBucketMask |= 1 << getVoxelMaterialBucket(newMat);
    }
    // If this chunk already has a built mesh and a voxel changed between solid/air/translucent,
    // its 6 face-adjacent neighbors may have gained or lost an exposed face, so mark their buckets too (#8)
    if (this.hasBuiltMesh && prevMat !== newMat) {
      const vox = this.voxels;
      if (lx > 0) {
        const m = vox[lx - 1 + CHUNK_X * (ly + CHUNK_Y * lz)];
        if (m !== MAT.AIR) this.dirtyBucketMask |= 1 << getVoxelMaterialBucket(m);
      }
      if (lx + 1 < CHUNK_X) {
        const m = vox[lx + 1 + CHUNK_X * (ly + CHUNK_Y * lz)];
        if (m !== MAT.AIR) this.dirtyBucketMask |= 1 << getVoxelMaterialBucket(m);
      }
      if (ly > 0) {
        const m = vox[lx + CHUNK_X * (ly - 1 + CHUNK_Y * lz)];
        if (m !== MAT.AIR) this.dirtyBucketMask |= 1 << getVoxelMaterialBucket(m);
      }
      if (ly + 1 < CHUNK_Y) {
        const m = vox[lx + CHUNK_X * (ly + 1 + CHUNK_Y * lz)];
        if (m !== MAT.AIR) this.dirtyBucketMask |= 1 << getVoxelMaterialBucket(m);
      }
      if (lz > 0) {
        const m = vox[lx + CHUNK_X * (ly + CHUNK_Y * (lz - 1))];
        if (m !== MAT.AIR) this.dirtyBucketMask |= 1 << getVoxelMaterialBucket(m);
      }
      if (lz + 1 < CHUNK_Z) {
        const m = vox[lx + CHUNK_X * (ly + CHUNK_Y * (lz + 1))];
        if (m !== MAT.AIR) this.dirtyBucketMask |= 1 << getVoxelMaterialBucket(m);
      }
    }
  }

  setVoxel(
    lx: number,
    ly: number,
    lz: number,
    mat: number,
    r?: number,
    g?: number,
    b?: number,
  ): void {
    const index = lx + CHUNK_X * (ly + CHUNK_Y * lz);
    this.pendingRemovals.delete(index);
    const prevMat = this.voxels[index];
    this.voxels[index] = mat;
    if (prevMat !== mat) {
      this.voxelWorld.chunkPhysicsVersion[this.slotIndex]++;
    }
    this.markVoxelChangeMaterialBuckets(lx, ly, lz, prevMat, mat);
    if (
      r !== undefined &&
      g !== undefined &&
      b !== undefined &&
      mat !== MAT.AIR &&
      mat !== MAT.WATER_VOX
    ) {
      if (!this.customColors) {
        this.customColors = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z * 3);
      }
      const cIdx = index * 3;
      const cr = r & 255;
      const cg = g & 255;
      const cb = b & 255;
      this.customColors[cIdx] = cr === 0 && cg === 0 && cb === 0 ? 1 : cr;
      this.customColors[cIdx + 1] = cg;
      this.customColors[cIdx + 2] = cb;
      this.dirtyBucketMask |= 1 << MAT_BUCKET_STRUCTURAL;
    } else if (this.customColors) {
      const cIdx = index * 3;
      this.customColors[cIdx] = 0;
      this.customColors[cIdx + 1] = 0;
      this.customColors[cIdx + 2] = 0;
    }
  }

  /**
   * Marks a voxel at `(lx, ly, lz)` as pending removal without mutating `this.voxels` yet.
   * Physics queries (`getVoxel`, `probeGroundBelow`, `isSolidAtWorld`) continue to see the solid block
   * until the worker finishes meshing and `commitPendingRemovals()` swaps both simultaneously.
   */
  markVoxelPendingRemoval(
    lx: number,
    ly: number,
    lz: number,
    newMat: number = MAT.AIR,
  ): void {
    const index = lx + CHUNK_X * (ly + CHUNK_Y * lz);
    const prevMat = this.voxels[index];
    if (prevMat === newMat) return;
    this.pendingRemovals.set(index, newMat);
    this.markVoxelChangeMaterialBuckets(lx, ly, lz, prevMat, newMat);
    if (ly - 1 < this.minY) this.minY = Math.max(0, ly - 1);
    if (ly + 1 > this.maxY) this.maxY = Math.min(CHUNK_Y - 1, ly + 1);
    if (isTranslucentVoxelMat(newMat)) {
      this.hasTranslucent = true;
      if (ly - 1 < this.transMinY) this.transMinY = Math.max(1, ly - 1);
      if (ly + 1 > this.transMaxY) this.transMaxY = Math.min(CHUNK_Y - 1, ly + 1);
    }
  }

  isVoxelPendingRemoval(lx: number, ly: number, lz: number): boolean {
    return this.pendingRemovals.has(lx + CHUNK_X * (ly + CHUNK_Y * lz));
  }

  /**
   * Builds a voxel array snapshot with all `pendingRemovals` applied for off-thread worker meshing,
   * while leaving `this.voxels` untouched on the main thread until the worker completes.
   */
  buildVoxelSnapshotWithPendingRemovals(): Uint8Array {
    if (this.pendingRemovals.size === 0) {
      return this.voxels;
    }
    const snapshot = new Uint8Array(this.voxels);
    this.pendingRemovals.forEach((newMat, index) => {
      snapshot[index] = newMat;
    });
    return snapshot;
  }

  /**
   * Commits all `pendingRemovals` into `this.voxels` and updates `this.surfaceHeightMap`
   * at the exact moment the worker mesh is swapped in.
   */
  commitPendingRemovals(subset?: Map<number, number>): number {
    const targetMap = subset ?? this.pendingRemovals;
    if (targetMap.size === 0) return 0;
    const touchedCols = new Set<number>();
    let committed = 0;

    targetMap.forEach((newMat, index) => {
      if (subset) {
        const currentPending = this.pendingRemovals.get(index);
        if (currentPending === newMat) {
          this.pendingRemovals.delete(index);
        }
      }
      const lx = index & 63;
      const ly = Math.floor(index / CHUNK_X) % CHUNK_Y;
      const lz = Math.floor(index / (CHUNK_X * CHUNK_Y));
      const prevMat = this.voxels[index];
      if (prevMat !== newMat) {
        this.voxels[index] = newMat;
        this.voxelWorld.chunkPhysicsVersion[this.slotIndex]++;
        this.markVoxelChangeMaterialBuckets(lx, ly, lz, prevMat, newMat);
        if (this.customColors && (newMat === MAT.AIR || newMat === MAT.WATER_VOX)) {
          const cIdx = index * 3;
          this.customColors[cIdx] = 0;
          this.customColors[cIdx + 1] = 0;
          this.customColors[cIdx + 2] = 0;
        }
        touchedCols.add(lx + (lz << 6));
        committed++;
      }
    });

    if (!subset) {
      this.pendingRemovals.clear();
    }

    touchedCols.forEach((colIdx) => {
      const lx = colIdx & 63;
      const lz = colIdx >> 6;
      const prevTop = this.surfaceHeightMap[colIdx] || this.maxY;
      let newTop = 1;
      for (let scanY = Math.min(CHUNK_Y - 2, Math.max(prevTop, this.maxY)); scanY >= 1; scanY--) {
        const m = this.voxels[lx + CHUNK_X * (scanY + CHUNK_Y * lz)];
        if (m !== MAT.AIR && m !== MAT.WATER_VOX) {
          newTop = scanY;
          break;
        }
      }
      this.surfaceHeightMap[colIdx] = newTop;
    });

    return committed;
  }
}

// Reusable GPU Mesh/BufferGeometry free-list pool so streaming chunks recycle VBOs/VAOs
// via bufferSubData instead of causing gl.createBuffer / gl.deleteBuffer driver stalls!
const _chunkOpaqueMeshPool: THREE.Mesh[] = [];
const _chunkTranslucentMeshPool: THREE.Mesh[] = [];
let _maxPooledOpaqueChunkMeshes = 64;
let _maxPooledTranslucentChunkMeshes = 24;

export function setChunkMeshPoolLimits(opaqueMax: number, translucentMax: number): void {
  _maxPooledOpaqueChunkMeshes = Math.max(8, opaqueMax | 0);
  _maxPooledTranslucentChunkMeshes = Math.max(4, translucentMax | 0);
  while (_chunkOpaqueMeshPool.length > _maxPooledOpaqueChunkMeshes) {
    _chunkOpaqueMeshPool.pop()?.geometry.dispose();
  }
  while (_chunkTranslucentMeshPool.length > _maxPooledTranslucentChunkMeshes) {
    _chunkTranslucentMeshPool.pop()?.geometry.dispose();
  }
}

function acquirePooledChunkMesh(
  isTranslucent: boolean,
  minVerts: number,
  minIndices: number,
  wantsAo: boolean,
  wantsSpawnPop: boolean,
): THREE.Mesh | null {
  const pool = isTranslucent ? _chunkTranslucentMeshPool : _chunkOpaqueMeshPool;
  let bestIdx = -1;
  let bestCap = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const m = pool[i];
    const geo = m.geometry;
    const vCap = (geo.userData.vertexCapacity as number) || 0;
    const iCap = (geo.userData.indexCapacity as number) || 0;
    const hasAo = Boolean(geo.getAttribute('ao'));
    const hasSpawn = Boolean(geo.getAttribute('spawnTime'));
    if (
      vCap >= minVerts &&
      iCap >= minIndices &&
      hasAo === wantsAo &&
      hasSpawn === wantsSpawnPop &&
      vCap < bestCap
    ) {
      bestCap = vCap;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const picked = pool[bestIdx];
  const last = pool.pop()!;
  if (bestIdx < pool.length) {
    pool[bestIdx] = last;
  }
  return picked;
}

function recycleChunkMeshToPool(mesh: THREE.Mesh, isTranslucent: boolean): boolean {
  const pool = isTranslucent ? _chunkTranslucentMeshPool : _chunkOpaqueMeshPool;
  const limit = isTranslucent
    ? _maxPooledTranslucentChunkMeshes
    : _maxPooledOpaqueChunkMeshes;
  if (pool.length >= limit) return false;
  mesh.visible = false;
  mesh.geometry.setDrawRange(0, 0);
  mesh.geometry.userData.activeVertCount = 0;
  mesh.geometry.userData.activeIndexCount = 0;
  mesh.userData.hasActiveVerts = false;
  pool.push(mesh);
  return true;
}

function drainChunkMeshPool(): void {
  while (_chunkOpaqueMeshPool.length > 0) {
    _chunkOpaqueMeshPool.pop()?.geometry.dispose();
  }
  while (_chunkTranslucentMeshPool.length > 0) {
    _chunkTranslucentMeshPool.pop()?.geometry.dispose();
  }
}

/**
 * In-Place GPU BufferAttribute Updater (#1):
 * Pre-allocates or recycles pooled position / normal / color / index buffers,
 * writes new data directly into the existing BufferAttribute `.array`,
 * sets `.needsUpdate = true` with `addUpdateRange`, and calls `geometry.setDrawRange(0, newIndexCount)`.
 */
export function updateOrCreateDynamicMeshBuffer(
  existingMesh: THREE.Mesh | null,
  payload: LodSubMeshPayload | null,
  material: THREE.Material,
  parent: THREE.Object3D,
  isTranslucent = false,
  initialVertCapacity = 8192,
  fixedBoundingSphere?: THREE.Sphere,
): { mesh: THREE.Mesh | null; updatedInPlace: boolean } {
  const vertCount = payload ? payload.vertCount : 0;
  const indexCount = payload ? payload.indexCount : 0;

  if (vertCount === 0 || indexCount === 0 || !payload) {
    if (existingMesh) {
      existingMesh.geometry.setDrawRange(0, 0);
      existingMesh.geometry.userData.activeVertCount = 0;
      existingMesh.geometry.userData.activeIndexCount = 0;
      existingMesh.geometry.userData.chunkGeoRevision =
        ((existingMesh.geometry.userData.chunkGeoRevision as number) || 0) + 1;
      existingMesh.visible = false;
      existingMesh.userData.hasActiveVerts = false;
      return { mesh: existingMesh, updatedInPlace: true };
    }
    return { mesh: null, updatedInPlace: false };
  }

  let mesh = existingMesh;
  let updatedInPlace = false;

  const wantsAo = Boolean(payload.ao && payload.ao.length >= vertCount);
  const wantsSpawnPop = Boolean(
    payload.spawnTimes &&
    payload.voxelCenters &&
    payload.spawnTimes.length >= vertCount &&
    payload.voxelCenters.length >= vertCount * 3,
  );

  if (!mesh) {
    const pooled = acquirePooledChunkMesh(
      isTranslucent,
      vertCount,
      indexCount,
      wantsAo,
      wantsSpawnPop,
    );
    if (pooled) {
      mesh = pooled;
      mesh.material = material;
      mesh.visible = true;
      updatedInPlace = true;
      if (mesh.parent !== parent) {
        parent.add(mesh);
      }
    } else {
      let capVerts = Math.max(1024, initialVertCapacity);
      while (capVerts < vertCount) {
        capVerts <<= 1;
      }
      const capIndices = Math.max((capVerts >> 2) * 6, indexCount);

      const geo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(new Float32Array(capVerts * 3), 3);
      const normAttr = new THREE.BufferAttribute(new Float32Array(capVerts * 3), 3);
      const colAttr = new THREE.BufferAttribute(new Float32Array(capVerts * 3), 3);
      const idxAttr = new THREE.BufferAttribute(new Uint32Array(capIndices), 1);

      posAttr.setUsage(THREE.DynamicDrawUsage);
      normAttr.setUsage(THREE.DynamicDrawUsage);
      colAttr.setUsage(THREE.DynamicDrawUsage);
      idxAttr.setUsage(THREE.DynamicDrawUsage);

      geo.setAttribute('position', posAttr);
      geo.setAttribute('normal', normAttr);
      geo.setAttribute('color', colAttr);
      if (wantsAo) {
        const aoAttr = new THREE.BufferAttribute(new Float32Array(capVerts), 1);
        aoAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('ao', aoAttr);
      }
      if (wantsSpawnPop) {
        const spawnAttr = new THREE.BufferAttribute(new Float32Array(capVerts), 1);
        const centerAttr = new THREE.BufferAttribute(new Float32Array(capVerts * 3), 3);
        spawnAttr.setUsage(THREE.DynamicDrawUsage);
        centerAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('spawnTime', spawnAttr);
        geo.setAttribute('voxelCenter', centerAttr);
      }
      geo.setIndex(idxAttr);
      geo.userData.vertexCapacity = capVerts;
      geo.userData.indexCapacity = capIndices;

      mesh = new THREE.Mesh(geo, material);
      if (isTranslucent) {
        mesh.renderOrder = 2;
      } else {
        (mesh as unknown as { isTerrainChunk?: boolean }).isTerrainChunk = true;
      }
      mesh.castShadow = false;
      mesh.receiveShadow = !isTranslucent;
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
    }
  } else {
    updatedInPlace = true;
    if (mesh.parent !== parent) {
      parent.add(mesh);
    }
  }

  let geo = mesh.geometry;
  const capVerts = (geo.userData.vertexCapacity as number) || 0;
  const capIndices = (geo.userData.indexCapacity as number) || 0;

  if (vertCount > capVerts || indexCount > capIndices) {
    let newCapVerts = Math.max(1024, capVerts || initialVertCapacity);
    while (newCapVerts < vertCount) {
      newCapVerts <<= 1;
    }
    const newCapIndices = Math.max((newCapVerts >> 2) * 6, indexCount);

    // Allocate a fresh BufferGeometry before disposing the old one so mobile WebGL2 never rebinds a disposed VAO!
    const oldGeo = geo;
    const newGeo = new THREE.BufferGeometry();

    const posAttr = new THREE.BufferAttribute(new Float32Array(newCapVerts * 3), 3);
    const normAttr = new THREE.BufferAttribute(new Float32Array(newCapVerts * 3), 3);
    const colAttr = new THREE.BufferAttribute(new Float32Array(newCapVerts * 3), 3);
    const idxAttr = new THREE.BufferAttribute(new Uint32Array(newCapIndices), 1);

    posAttr.setUsage(THREE.DynamicDrawUsage);
    normAttr.setUsage(THREE.DynamicDrawUsage);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    idxAttr.setUsage(THREE.DynamicDrawUsage);

    newGeo.setAttribute('position', posAttr);
    newGeo.setAttribute('normal', normAttr);
    newGeo.setAttribute('color', colAttr);
    if (wantsAo) {
      const aoAttr = new THREE.BufferAttribute(new Float32Array(newCapVerts), 1);
      aoAttr.setUsage(THREE.DynamicDrawUsage);
      newGeo.setAttribute('ao', aoAttr);
    }
    if (wantsSpawnPop) {
      const spawnAttr = new THREE.BufferAttribute(new Float32Array(newCapVerts), 1);
      const centerAttr = new THREE.BufferAttribute(new Float32Array(newCapVerts * 3), 3);
      spawnAttr.setUsage(THREE.DynamicDrawUsage);
      centerAttr.setUsage(THREE.DynamicDrawUsage);
      newGeo.setAttribute('spawnTime', spawnAttr);
      newGeo.setAttribute('voxelCenter', centerAttr);
    }
    newGeo.setIndex(idxAttr);
    newGeo.userData.vertexCapacity = newCapVerts;
    newGeo.userData.indexCapacity = newCapIndices;

    mesh.geometry = newGeo;
    oldGeo.dispose();
    geo = newGeo;
  }

  const activeCapVerts = (geo.userData.vertexCapacity as number) || Math.max(1024, vertCount);
  const v3 = vertCount * 3;
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
  const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
  const idxAttr = geo.getIndex() as THREE.BufferAttribute;

  (posAttr.array as Float32Array).set(payload.positions.subarray(0, v3), 0);
  (normAttr.array as Float32Array).set(payload.normals.subarray(0, v3), 0);
  (colAttr.array as Float32Array).set(payload.colors.subarray(0, v3), 0);
  (idxAttr.array as Uint32Array).set(payload.indices.subarray(0, indexCount), 0);

  if (wantsAo && payload.ao) {
    let aoAttr = geo.getAttribute('ao') as THREE.BufferAttribute | undefined;
    if (!aoAttr || aoAttr.array.length < vertCount) {
      aoAttr = new THREE.BufferAttribute(new Float32Array(activeCapVerts), 1);
      aoAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('ao', aoAttr);
    }
    (aoAttr.array as Float32Array).set(payload.ao.subarray(0, vertCount), 0);
    aoAttr.clearUpdateRanges();
    aoAttr.addUpdateRange(0, vertCount);
    aoAttr.needsUpdate = true;
  }

  if (wantsSpawnPop && payload.spawnTimes && payload.voxelCenters) {
    let spawnAttr = geo.getAttribute('spawnTime') as THREE.BufferAttribute | undefined;
    let centerAttr = geo.getAttribute('voxelCenter') as THREE.BufferAttribute | undefined;
    if (!spawnAttr || spawnAttr.array.length < vertCount) {
      spawnAttr = new THREE.BufferAttribute(new Float32Array(activeCapVerts), 1);
      spawnAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('spawnTime', spawnAttr);
    }
    if (!centerAttr || centerAttr.array.length < v3) {
      centerAttr = new THREE.BufferAttribute(new Float32Array(activeCapVerts * 3), 3);
      centerAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('voxelCenter', centerAttr);
    }
    (spawnAttr.array as Float32Array).set(payload.spawnTimes.subarray(0, vertCount), 0);
    spawnAttr.clearUpdateRanges();
    spawnAttr.addUpdateRange(0, vertCount);
    spawnAttr.needsUpdate = true;

    (centerAttr.array as Float32Array).set(payload.voxelCenters.subarray(0, v3), 0);
    centerAttr.clearUpdateRanges();
    centerAttr.addUpdateRange(0, v3);
    centerAttr.needsUpdate = true;
  } else {
    const existingSpawn = geo.getAttribute('spawnTime') as THREE.BufferAttribute | undefined;
    if (existingSpawn) {
      (existingSpawn.array as Float32Array).fill(0, 0, Math.min(vertCount, existingSpawn.array.length));
      existingSpawn.clearUpdateRanges();
      existingSpawn.addUpdateRange(0, Math.min(vertCount, existingSpawn.array.length));
      existingSpawn.needsUpdate = true;
    }
  }

  posAttr.clearUpdateRanges();
  posAttr.addUpdateRange(0, v3);
  posAttr.needsUpdate = true;

  normAttr.clearUpdateRanges();
  normAttr.addUpdateRange(0, v3);
  normAttr.needsUpdate = true;

  colAttr.clearUpdateRanges();
  colAttr.addUpdateRange(0, v3);
  colAttr.needsUpdate = true;

  idxAttr.clearUpdateRanges();
  idxAttr.addUpdateRange(0, indexCount);
  idxAttr.needsUpdate = true;

  geo.setDrawRange(0, indexCount);
  geo.userData.activeVertCount = vertCount;
  geo.userData.activeIndexCount = indexCount;
  geo.userData.chunkGeoRevision = ((geo.userData.chunkGeoRevision as number) || 0) + 1;
  geo.clearGroups();
  if (payload.groups && payload.groups.length > 0) {
    for (let i = 0; i < payload.groups.length; i++) {
      const g = payload.groups[i];
      geo.addGroup(g.start, g.count, 0);
    }
  }

  if (fixedBoundingSphere) {
    if (!geo.boundingSphere) {
      geo.boundingSphere = fixedBoundingSphere.clone();
    } else {
      geo.boundingSphere.copy(fixedBoundingSphere);
    }
  } else {
    mesh.frustumCulled = false;
  }

  mesh.userData.hasActiveVerts = true;
  mesh.visible = true;
  return { mesh, updatedInPlace };
}

/**
 * Creates a natural 3D Atmospheric Skybox Dome with Rayleigh/Mie horizon gradient,
 * soft sun disc, subtle high-altitude procedural clouds, and subterranean cave blackout (uCaveFactor).
 */
export function createAtmosphericSkyDome(): THREE.Mesh {
  const skyGeo = new THREE.SphereGeometry(360, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.45, 0.48, 0.55).normalize() },
      uCaveFactor: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        vec4 clipPos = projectionMatrix * viewMatrix * wp;
        gl_Position = clipPos.xyww;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform vec3 uSunDir;
      uniform float uCaveFactor;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vec3 d = normalize(vWorldDir);
        float h = clamp(d.y, 0.0, 1.0);

        // Crisp Trailmakers daytime cerulean sky gradient
        vec3 zenithCol  = vec3(0.05, 0.42, 0.82);
        vec3 midSkyCol  = vec3(0.18, 0.64, 0.96);
        vec3 horizonCol = vec3(0.54, 0.86, 0.99);
        vec3 groundCol  = vec3(0.26, 0.46, 0.64);

        vec3 sky = mix(horizonCol, midSkyCol, pow(h, 0.45));
        sky = mix(sky, zenithCol, pow(h, 1.15));
        if (d.y < 0.0) {
          sky = mix(horizonCol, groundCol, clamp(-d.y * 4.0, 0.0, 1.0));
        }

        float sunAmt = max(dot(d, uSunDir), 0.0);
        sky += vec3(0.98, 0.86, 0.55) * pow(sunAmt, 10.0) * 0.26;
        sky += vec3(1.0, 0.96, 0.84) * smoothstep(0.996, 0.9995, sunAmt) * 0.65;

        if (d.y > 0.05) {
          vec2 uv = d.xz / (d.y + 0.18) * 2.2;
          float c = noise(uv) * 0.6 + noise(uv * 2.3) * 0.4;
          float cloudMask = smoothstep(0.56, 0.80, c) * smoothstep(0.05, 0.25, d.y) * (1.0 - smoothstep(0.65, 0.95, d.y));
          sky = mix(sky, vec3(0.94, 0.97, 1.0), cloudMask * 0.30);
        }

        // Transition sky dome into deep pitch-dark subterranean cavern rock when underground
        vec3 caveAbyss = vec3(0.02, 0.03, 0.05);
        sky = mix(sky, caveAbyss, clamp(uCaveFactor, 0.0, 1.0));

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  const dome = new THREE.Mesh(skyGeo, skyMat);
  dome.frustumCulled = false;
  dome.matrixAutoUpdate = false;
  dome.updateMatrix();
  dome.renderOrder = -1000;
  dome.userData.isSkyDome = true;
  return dome;
}

/**
 * Creates a persistent, infinite-feeling Tactical Map Horizon Skirt Plane (8000m x 8000m)
 * positioned beneath the voxel chunks so that at any zoom altitude or 2.5D angle,
 * the sides and far horizon display biome-matched terrain, ocean water, and tactical grid lines
 * rather than blue sky.
 */
export function createMapHorizonSkirtMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(8000, 8000, 1, 1);
  geo.rotateX(-Math.PI * 0.5);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uBiomeType: { value: 0.0 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      precision highp float;
      #include <logdepthbuf_pars_fragment>
      varying vec3 vWorldPos;
      uniform float uBiomeType;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        #include <logdepthbuf_fragment>
        vec2 wxz = vWorldPos.xz;
        vec3 landCol = vec3(0.27, 0.47, 0.24);
        vec3 waterCol = vec3(0.02, 0.30, 0.62);
        vec3 baseCol = landCol;

        if (uBiomeType < 0.5) {
          // DEFAULT_PARK: West ocean basin + green terrain meadow
          bool inOcean = (wxz.x < -30.0 && wxz.y < 30.0) || length(wxz - vec2(65.0, -85.0)) < 18.0;
          baseCol = inOcean ? waterCol : landCol;
        } else if (uBiomeType < 1.5) {
          // DESERT / CANYON
          baseCol = vec3(0.72, 0.50, 0.31);
        } else if (uBiomeType < 2.5) {
          // ARCTIC
          baseCol = vec3(0.78, 0.84, 0.90);
        } else if (uBiomeType < 3.5) {
          // VOLCANIC
          baseCol = vec3(0.16, 0.16, 0.18);
        } else if (uBiomeType < 4.5) {
          // ARCHIPELAGO / CUSTOM_GLB_MAP
          baseCol = waterCol;
        } else {
          // FLAT_BASEPLATE
          baseCol = vec3(0.24, 0.25, 0.28);
        }

        // Subtle 16m chunk & 64m sector tactical blueprint grid lines
        vec2 cell16 = abs(fract(wxz / 16.0 - 0.5) - 0.5) / fwidth(wxz / 16.0);
        float line16 = 1.0 - min(min(cell16.x, cell16.y), 1.0);
        vec2 cell64 = abs(fract(wxz / 64.0 - 0.5) - 0.5) / fwidth(wxz / 64.0);
        float line64 = 1.0 - min(min(cell64.x, cell64.y), 1.0);

        float n = hash(floor(wxz / 4.0)) * 0.04 - 0.02;
        vec3 col = clamp(baseCol + vec3(n), 0.0, 1.0);
        col = mix(col, vec3(0.28, 0.34, 0.42), clamp(line16 * 0.28, 0.0, 0.35));
        col = mix(col, vec3(0.75, 0.62, 0.18), clamp(line64 * 0.38, 0.0, 0.45));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.set(0, 0.05, 0);
  mesh.visible = false;
  mesh.renderOrder = -500;
  return mesh;
}

const _frustum = new THREE.Frustum();
const _tmpChunkSphere = new THREE.Sphere(new THREE.Vector3(), 20);
const _projScreenMat = new THREE.Matrix4();
const _camDirTmp = new THREE.Vector3();
const _rayHitWorldPos = new THREE.Vector3();
const _tmpWaveSample: GerstnerWaveSample = {
  rawH: 0,
  terracedH: 0,
  slopeX: 0,
  slopeZ: 0,
  orbitalVx: 0,
  orbitalVy: 0,
  orbitalVz: 0,
  colorIndex: 4,
};
const _tmpSplashWaveSample: GerstnerWaveSample = {
  rawH: 0,
  terracedH: 0,
  slopeX: 0,
  slopeZ: 0,
  orbitalVx: 0,
  orbitalVy: 0,
  orbitalVz: 0,
  colorIndex: 4,
};
const _wakeSourcesScratch: Array<{
  x: number;
  z: number;
  speed: number;
  fwdX: number;
  fwdZ: number;
  rightX: number;
  rightZ: number;
  halfW: number;
  halfL: number;
  cr: {
    position: THREE.Vector3;
    isWorldPointSolid: (wx: number, wy: number, wz: number) => boolean;
  };
}> = [];
const _wavePaletteRGB: ReadonlyArray<[number, number, number]> =
  WATER_WAVE_PALETTE_HEX.map((hex) => [
    ((hex >> 16) & 255) / 255,
    ((hex >> 8) & 255) / 255,
    (hex & 255) / 255,
  ]);

// 1024-entry cosine lookup table for ultra-fast O(1) wave evaluation without per-cell Math.cos overhead
const _cosLUT = new Float32Array(1024);
const _RAD_TO_LUT = 1024 / (Math.PI * 2);
for (let i = 0; i < 1024; i++) {
  _cosLUT[i] = Math.cos((i * Math.PI * 2) / 1024);
}

// `isWaterBasinArea` is imported and re-exported from `./worldObjects.ts` so main thread & workers share one implementation.

/**
 * Returns true if (wx, wz) is inside a small inland pond or river (0.75m gentle waves)
 * rather than an open ocean/archipelago (+1.0m to +1.5m randomized swells).
 */
export function isInlandPondOrRiver(
  wx: number,
  wz: number,
  mode: WorldGenMode,
): boolean {
  if (mode === 'BIOME_CANYON') return true;
  if (mode === 'DEFAULT_PARK') {
    return !(wx < -24 && wz < 38) && Math.hypot(wx - 65, wz - -85) < 18;
  }
  return false;
}

export interface PlacedWorldObjectRecord {
  prefabId: string;
  name: string;
  wx: number;
  wy: number;
  wz: number;
  yawIdx: number;
  pitchIdx?: number;
  rollIdx?: number;
}

export class MicroVoxelWorld {
  public readonly voxelWorld: VoxelWorld = new VoxelWorld({
    maxChunks: 512,
    maxBodies: 256,
    maxDebris: 2000,
    chunkX: CHUNK_X,
    chunkY: CHUNK_Y,
    chunkZ: CHUNK_Z,
  });
  public scene: THREE.Scene;
  public activeVehicle: unknown = null;
  public chunks: MicroVoxelChunk[];
  public chunkMap = new Map<string, MicroVoxelChunk>();
  public chunkSlotMap = new Map<string, number>();
  public modifiedChunkCache = new Map<string, MicroVoxelChunk>();
  public dirtyQueue: MicroVoxelChunk[] = [];
  public pendingTerrainStructures: Array<{
    voxels: Array<{ vx: number; vy: number; vz: number; mat: number }>;
    waitingChunks: Set<MicroVoxelChunk>;
    halfVX: number;
    halfVZ: number;
    voxelSize: number;
  }> = [];
  public pendingCarvedDebris: Array<{
    items: Array<{
      wx: number;
      wy: number;
      wz: number;
      color: number;
      blastX: number;
      blastY: number;
      blastZ: number;
    }>;
    waitingChunks: Set<MicroVoxelChunk>;
  }> = [];
  public sharedVoxelMaterial: THREE.MeshLambertMaterial;
  public sharedTranslucentMaterial: THREE.MeshPhongMaterial;
  public sharedHorizonWaterMaterial: THREE.MeshPhongMaterial;
  public skyDome: THREE.Mesh;
  public mapHorizonSkirt: THREE.Mesh;
  public activeMapRenderRadiusChunks = 8;

  // Unlimited World & Biome State
  public worldGenMode: WorldGenMode = 'DEFAULT_PARK';
  public flatBaseplateMat: number = MAT.ASPHALT;
  public heightmapData: {
    width: number;
    height: number;
    heights: Uint8Array;
    scaleY: number;
  } | null = null;
  public activeGlbBounds: {
    minWX: number;
    maxWX: number;
    minWZ: number;
    maxWZ: number;
  } | null = null;
  public activeGlbMapData: {
    voxels: Array<[number, number, number, number, number?, number?, number?]>;
    sizeX: number;
    sizeY: number;
    sizeZ: number;
    gridX: number;
    gridY: number;
    gridZ: number;
    scaleFactor: number;
    cellMeters: number;
    startWX: number;
    startWZ: number;
    baseVY: number;
    footprintMask: Uint8Array;
    lowestSurfaceVY: Int16Array;
    highestSurfaceVY: Int16Array;
    voxelSolid: Uint8Array;
    voxelRGB: Uint8Array;
    voxelMat: Uint8Array;
  } | null = null;
  public placedObjectsHistory: PlacedWorldObjectRecord[] = [];
  public explosiveBarrels: Array<{
    id: string;
    wx: number;
    wy: number;
    wz: number;
    vx: number;
    vy: number;
    vz: number;
    intact: boolean;
  }> = [];
  public speedTrapGate = {
    wx: 0,
    wy: (SUBTERRANEAN_DEPTH_VY + 12) * VOXEL_SIZE,
    wz: 48 * VOXEL_SIZE,
    halfWidthMeters: 5.5,
    heightMeters: 6.5,
  };

  public radiusModes = [
    { radius: 2, label: '3-Tier LOD Ultra Fast (64m)' },
    { radius: 3, label: '3-Tier LOD Fast (96m)' },
    { radius: 4, label: '3-Tier LOD Balanced (128m)' },
    { radius: 6, label: '3-Tier LOD High Horizon (192m)' },
    { radius: 8, label: '3-Tier LOD Ultra Horizon (256m)' },
    { radius: 10, label: '3-Tier LOD Extreme Horizon (320m)' },
  ];
  public radiusModeIdx = 2;
  public customRenderDistance = 4;
  public customRenderDistanceBig: bigint = 4n;

  // 2D Terraced Voxel Heightfield & GPU Gerstner Ocean Waves
  public waveQuality: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  public waveTime = 0;
  public weatherWaveMult = 1.0;
  public waveLines: VoxelWaveLineState[] = [];
  public waterWaveInstancedMesh: THREE.InstancedMesh;
  public readonly maxWaveVoxels = 1200;
  public sharedPotatoVoxelMaterial: THREE.ShaderMaterial | null = null;
  public sharedCartoonVoxelMaterial: THREE.ShaderMaterial | null = null;
  public usePotatoShader = false;
  public useCartoonShader = false;
  public gpuOceanWaveUniforms: GpuOceanWaveUniforms;
  public fogEnabled = true;
  public sunDirection = new THREE.Vector3(45, 42, 55).normalize();

  private lastFocusX = 0;
  private lastFocusZ = -4;
  private _lastStreamCenterCX = Number.NaN;
  private _lastStreamCenterCZ = Number.NaN;
  private _lastStreamMaxRad = -1;
  private _allChunksInRadiusPresent = false;
  private completedWorkerQueue: Array<{
    chunk: MicroVoxelChunk;
    res: ChunkMeshJobResponse;
    jobRemovals?: Map<number, number>;
  }> = [];

  public visibleTris = 0;
  public greedySavingsPct = 96;
  public lod0Chunks = 25;
  public lod1Chunks = 24;
  public lod2Chunks = 32;
  public lod3Chunks = 0;
  public cpuThreads: number;
  public workerPool: MultiCoreMeshWorkerPool;
  public horizonManager!: DistantHorizonManager;
  public lodSpacing = DEFAULT_LOD_SPACING;
  public activeHorizonRings = 0;
  public activeHorizonTiles = 0;
  public activeTotalLodLayers = 1;
  public activeScaleBands = 1;
  private _horizonActive = false;
  private _lastStreamLodSpacing = DEFAULT_LOD_SPACING;
  private _lastStreamMaxRadBig: bigint = -1n;
  private _cameraFwdScratch = new THREE.Vector3();
  private _initialSpawnBubbleReady = false;
  public lodSummary = 'L0:25 L1:24 L2:32 L3:0 · 8 CORES';
  public uncappedChunkLod = false;
  /** Optional planetary curvature radius in meters (0 = flat world, > 0 = curved horizon frustum margin) */
  public planetCurvatureRadius = 0;
  /** Strict per-frame chunk rebuild budget (#2: max N=2 chunks per frame) */
  public maxChunkRebuildsPerFrame = 2;
  /** World-space (x, z) focus point of active optical camera zoom where distant terrain renders at full crisp LOD0 */
  public zoomFocusWorld: { x: number; z: number } | null = null;
  public activeZoomLod0Chunks = 0;
  private _lastZoomCX = -999999;
  private _lastZoomCZ = -999999;

  // Diegetic Loading State Machine & Priority Queueing
  public onSpawnChunkReady: (() => void) | null = null;
  public isSpawnChunkLoaded = false;
  public priorityChunkQueue: MicroVoxelChunk[] = [];
  public animatingChunks: MicroVoxelChunk[] = [];
  public fogTargetNear = 108;
  public fogTargetFar = 172;
  public currentFogNear = 108;
  public currentFogFar = 172;

  // Progressive Cellular Water Flow Queue (so water visibly pours in from the breach, pools at the bottom, and rises layer by layer)
  public pendingWaterFlowQueue: Array<{ vx: number; vy: number; vz: number }> = [];
  private pendingWaterFlowSet = new Set<number>();
  private waterFlowStepTimer = 0;
  private waterFlowSteppedThisFrame = false;

  get totalAllocatedChunks(): number {
    return this.chunkMap.size;
  }
  get lodNearChunks(): number {
    return this.lod0Chunks;
  }
  get lodMidChunks(): number {
    return this.lod1Chunks;
  }
  get lodFarChunks(): number {
    return this.lod2Chunks + this.lod3Chunks;
  }

  constructor(
    scene: THREE.Scene,
    isHeadless = false,
    initialRenderDistance?: number,
    initialPotatoShader = false,
    initialLodSpacing?: number,
  ) {
    setActiveVoxelWorld(this.voxelWorld);
    this.scene = scene;
    this.usePotatoShader = initialPotatoShader;
    if (typeof initialLodSpacing === 'number') {
      this.lodSpacing = sanitizeLodSpacing(initialLodSpacing, DEFAULT_LOD_SPACING);
    }
    this.chunks = new Array(WORLD_CHUNKS_X * WORLD_CHUNKS_Z);
    this.workerPool = new MultiCoreMeshWorkerPool();
    if (this.voxelWorld.usesSharedSurfaceSlab) {
      this.workerPool.attachSharedSurfaceSlab(
        this.voxelWorld.surfaceVoxelsSab,
        this.voxelWorld.surfaceHeightSab,
        this.voxelWorld.surfaceVoxelsStride,
        this.voxelWorld.surfaceHeightStride,
        this.voxelWorld.surfaceSlabCapacity,
      );
    }
    this.cpuThreads = this.workerPool.coreCount;
    this.lodSummary = `L0:25 L1:24 L2:32 · ${this.cpuThreads} CORES`;

    this.skyDome = createAtmosphericSkyDome();
    this.scene.add(this.skyDome);

    this.mapHorizonSkirt = createMapHorizonSkirtMesh();
    this.scene.add(this.mapHorizonSkirt);

    this.sharedVoxelMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    // Blue-tinted transparent material for water bodies and glass windows
    this.sharedTranslucentMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(0x0060d0),
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      shininess: 110,
      specular: new THREE.Color(0xbae6fd),
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.gpuOceanWaveUniforms = attachGpuGerstnerOceanShader(
      this.sharedTranslucentMaterial,
    );

    // Static, opaque, FrontSide distant ocean material for LOD1..LOD8+ horizon mega-tiles:
    // matches LOD0 ocean color & specular sheen while avoiding giant 4 km Gerstner vertex heaving.
    this.sharedHorizonWaterMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(0x0060d0),
      vertexColors: true,
      shininess: 90,
      specular: new THREE.Color(0xbae6fd),
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });

    this.horizonManager = new DistantHorizonManager(
      this.scene,
      this.workerPool,
      this.getActiveOpaqueVoxelMaterial(),
      this.getActiveHorizonWaterMaterial(),
    );

    // Instanced Mesh for dynamic fluid wave crests & vehicle wake foam (thin translucent crests)
    const waveVoxGeo = new THREE.BoxGeometry(
      VOXEL_SIZE * 0.98,
      VOXEL_SIZE * 0.35,
      VOXEL_SIZE * 0.98,
    );
    const waveVoxMat = new THREE.MeshPhongMaterial({
      color: 0x38bdf8,
      specular: new THREE.Color(0xffffff),
      shininess: 120,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      depthTest: true,
    });
    this.waterWaveInstancedMesh = new THREE.InstancedMesh(
      waveVoxGeo,
      waveVoxMat,
      this.maxWaveVoxels,
    );
    this.waterWaveInstancedMesh.count = 0;
    this.waterWaveInstancedMesh.visible = false;
    this.waterWaveInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Pre-initialize 4x4 matrices to identity so per-frame updates only write 6 floats (scale + translation)
    const matArr = this.waterWaveInstancedMesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < this.maxWaveVoxels; i++) {
      const mOff = i << 4;
      matArr[mOff] = 1;
      matArr[mOff + 5] = 1;
      matArr[mOff + 10] = 1;
      matArr[mOff + 15] = 1;
    }
    const waveColors = new Float32Array(this.maxWaveVoxels * 3);
    for (let i = 0; i < waveColors.length; i += 3) {
      waveColors[i] = 0.0;
      waveColors[i + 1] = 0.376;
      waveColors[i + 2] = 0.816;
    }
    this.waterWaveInstancedMesh.instanceColor = new THREE.InstancedBufferAttribute(waveColors, 3);
    this.waterWaveInstancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.waterWaveInstancedMesh.frustumCulled = false;
    this.waterWaveInstancedMesh.renderOrder = 3;
    this.scene.add(this.waterWaveInstancedMesh);

    this.initVoxelWaveLines();

    if (isHeadless) {
      this.radiusModeIdx = 2;
      this.customRenderDistance = 4;
    } else if (typeof initialRenderDistance === 'number') {
      this.setRenderDistanceChunks(initialRenderDistance, false);
    }

    this.generateAllVoxelTerrain();
  }

  public initVoxelWaveLines(): void {
    this.waveLines = [
      { cx: -30, cz: -10, dirX: 0.8, dirZ: 0.6, lengthVoxels: 64, speed: 5.5, phase: 0.0, cooldown: 0 },
      { cx: 10, cz: -40, dirX: 0.6, dirZ: -0.8, lengthVoxels: 56, speed: 6.2, phase: 1.2, cooldown: 0 },
      { cx: -50, cz: 20, dirX: 0.9, dirZ: 0.2, lengthVoxels: 72, speed: 5.0, phase: 2.5, cooldown: 0 },
      { cx: 30, cz: 50, dirX: -0.7, dirZ: -0.7, lengthVoxels: 60, speed: 5.8, phase: 3.8, cooldown: 0 },
      { cx: -10, cz: -70, dirX: 0.5, dirZ: 0.86, lengthVoxels: 68, speed: 6.0, phase: 0.8, cooldown: 0 },
      { cx: 60, cz: -20, dirX: -0.86, dirZ: 0.5, lengthVoxels: 52, speed: 5.2, phase: 4.5, cooldown: 0 },
      { cx: -70, cz: -30, dirX: 0.7, dirZ: 0.7, lengthVoxels: 64, speed: 5.6, phase: 2.1, cooldown: 0 },
      { cx: 0, cz: 60, dirX: -0.5, dirZ: -0.86, lengthVoxels: 48, speed: 6.5, phase: 5.0, cooldown: 0 },
      { cx: -20, cz: 80, dirX: 0.8, dirZ: -0.6, lengthVoxels: 56, speed: 5.4, phase: 1.7, cooldown: 0 },
      { cx: 40, cz: -60, dirX: -0.6, dirZ: 0.8, lengthVoxels: 60, speed: 5.9, phase: 3.1, cooldown: 0 },
    ];
  }

  public getActiveOpaqueVoxelMaterial(): THREE.Material {
    if (this.useCartoonShader) {
      if (!this.sharedCartoonVoxelMaterial) {
        this.sharedCartoonVoxelMaterial = getSharedCartoonShaderMaterial();
      }
      return this.sharedCartoonVoxelMaterial;
    }
    if (this.usePotatoShader) {
      if (!this.sharedPotatoVoxelMaterial) {
        this.sharedPotatoVoxelMaterial = getSharedPotatoShaderMaterial();
      }
      return this.sharedPotatoVoxelMaterial;
    }
    return this.sharedVoxelMaterial;
  }

  public getActiveHorizonWaterMaterial(): THREE.Material {
    if (this.useCartoonShader) {
      return getCartoonSolidColorMaterial(new THREE.Color(0x0060d0), null, true);
    }
    if (this.usePotatoShader) {
      return getPotatoSolidColorMaterial(new THREE.Color(0x0060d0), null, true);
    }
    return this.sharedHorizonWaterMaterial;
  }

  public getActiveShaderMode(): ActiveShaderMode {
    if (this.useCartoonShader) return 'CARTOON';
    if (this.usePotatoShader) return 'POTATO';
    return 'PBR';
  }

  private syncAllChunkOpaqueMaterials(): void {
    const targetMat = this.getActiveOpaqueVoxelMaterial();
    this.chunkMap.forEach((chunk) => {
      if (chunk.mesh && !chunk.isBloomMaterialAttached) {
        chunk.mesh.material = targetMat;
      }
      if (chunk.meshLOD1) {
        chunk.meshLOD1.material = targetMat;
      }
      if (chunk.meshLOD2) {
        chunk.meshLOD2.material = targetMat;
      }
      if (chunk.meshLOD3) {
        chunk.meshLOD3.material = targetMat;
      }
    });
    this.horizonManager?.syncOpaqueMaterial(targetMat);
    this.horizonManager?.syncWaterMaterial(this.getActiveHorizonWaterMaterial());
  }

  /**
   * Swaps all chunk LOD meshes between the standard material (`usePBR`),
   * Potato Mode cel+rim shader (`usePotatoShader`), and Cartoon Mode shader (`useCartoonShader`).
   */
  public setPotatoShaderMode(enabled: boolean): void {
    this.usePotatoShader = enabled;
    if (enabled) this.useCartoonShader = false;
    // Trim GPU mesh pool aggressively on Pentium / Potato mode to cut VRAM & JS heap overhead
    setChunkMeshPoolLimits(enabled ? 20 : 64, enabled ? 8 : 24);
    this.syncAllChunkOpaqueMaterials();
  }

  public setCartoonShaderMode(enabled: boolean): void {
    this.useCartoonShader = enabled;
    if (enabled) this.usePotatoShader = false;
    this.syncAllChunkOpaqueMaterials();
  }

  public setWaveQuality(q: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH'): void {
    this.waveQuality = q;
    this.gpuOceanWaveUniforms.uWavesEnabled.value = q === 'OFF' ? 0.0 : 1.0;
    // Keep the secondary close-to-vehicle instanced wave overlay permanently disabled so there is
    // only ONE unified full-ocean GPU Gerstner wave animation!
    this.waterWaveInstancedMesh.count = 0;
    this.waterWaveInstancedMesh.visible = false;
  }

  public setWeatherWaveMultiplier(mult: number): void {
    this.weatherWaveMult = Math.max(0.25, Math.min(2.5, mult));
    this.gpuOceanWaveUniforms.uWeatherWaveMult.value = this.weatherWaveMult;
  }

  public setRenderDistanceChunks(
    radius: number | bigint | string,
    uncappedLod?: boolean,
    lodSpacing?: number,
  ): void {
    const clampedBig = sanitizePositiveRenderDistanceBigInt(
      radius,
      this.customRenderDistanceBig > 0n ? this.customRenderDistanceBig : 6n,
    );
    const clamped =
      clampedBig > BigInt(MAX_RENDER_DISTANCE_CHUNKS)
        ? MAX_RENDER_DISTANCE_CHUNKS
        : Number(clampedBig);
    this.customRenderDistanceBig = clampedBig;
    this.customRenderDistance = clamped;
    if (typeof uncappedLod === 'boolean') {
      this.uncappedChunkLod = uncappedLod;
    }
    if (typeof lodSpacing === 'number') {
      this.lodSpacing = sanitizeLodSpacing(lodSpacing, this.lodSpacing);
    }
    const matchIdx = this.radiusModes.findIndex((m) => BigInt(m.radius) === clampedBig);
    if (matchIdx >= 0) {
      this.radiusModeIdx = matchIdx;
    }
  }

  public setLodSpacing(spacing: number): void {
    this.lodSpacing = sanitizeLodSpacing(spacing, this.lodSpacing);
  }

  public cycleRadiusMode(): number {
    this.radiusModeIdx = (this.radiusModeIdx + 1) % this.radiusModes.length;
    this.customRenderDistance = this.radiusModes[this.radiusModeIdx].radius;
    this.customRenderDistanceBig = BigInt(this.customRenderDistance);
    return this.customRenderDistance;
  }

  /**
   * Queues all existing adjacent cardinal neighbor chunks ((cx-1,cz), (cx+1,cz), (cx,cz-1), (cx,cz+1))
   * for re-meshing when chunk (cx, cz) is generated, populated, or upgraded to full 3D terrain.
   */
  public invalidateAdjacentNeighborChunks(cx: number, cz: number): void {
    const dirs = [
      [cx - 1, cz],
      [cx + 1, cz],
      [cx, cz - 1],
      [cx, cz + 1],
    ];
    for (let i = 0; i < 4; i++) {
      const nChunk = this.chunkMap.get(`${dirs[i][0]},${dirs[i][1]}`);
      if (
        nChunk &&
        nChunk.terrainPopulated &&
        (nChunk.hasBuiltMesh || nChunk.workerPending)
      ) {
        nChunk.cachedOpaqueBuckets = [null, null, null];
        nChunk.dirtyBucketMask = MAT_BUCKET_ALL_MASK;
        this.markChunkDirty(nChunk);
      }
    }
  }

  /**
   * When a voxel on a chunk border (lx === 0, lx === 63, lz === 0, lz === 63) is modified or removed,
   * invalidates the adjacent neighbor chunk(s) and upgrades them from surface-only if needed so exposed
   * cross-chunk boundary faces are immediately re-meshed with zero sky holes.
   */
  private invalidateNeighborsForBorderVoxel(
    cx: number,
    cz: number,
    lx: number,
    vy: number,
    lz: number,
    touchedChunks?: Set<MicroVoxelChunk>,
  ): void {
    const notifyNeighbor = (ncx: number, ncz: number) => {
      const nChunk = this.chunkMap.get(`${ncx},${ncz}`);
      if (!nChunk || !nChunk.terrainPopulated) return;
      if (nChunk.isSurfaceOnlyTerrain) {
        this.ensureFullChunkTerrain(nChunk);
      }
      if (vy - 1 < nChunk.minY) nChunk.minY = Math.max(0, vy - 1);
      if (vy + 1 > nChunk.maxY) nChunk.maxY = Math.min(CHUNK_Y - 1, vy + 1);
      nChunk.isSurfaceOnlyMesh = false;
      nChunk.cachedOpaqueBuckets = [null, null, null];
      nChunk.dirtyBucketMask = MAT_BUCKET_ALL_MASK;
      this.markChunkDirty(nChunk);
      if (touchedChunks) {
        touchedChunks.add(nChunk);
      }
    };

    if (lx === 0) notifyNeighbor(cx - 1, cz);
    if (lx === CHUNK_X - 1) notifyNeighbor(cx + 1, cz);
    if (lz === 0) notifyNeighbor(cx, cz - 1);
    if (lz === CHUNK_Z - 1) notifyNeighbor(cx, cz + 1);
  }

  /**
   * Samples the effective voxel of a neighboring chunk at out-of-bounds local coordinates (lx, ly, lz).
   * Returns 0 (MAT.AIR) if the neighboring chunk does not exist yet (conservative: never cull against ungenerated neighbors).
   */
  public sampleChunkBoundaryVoxel(
    chunk: MicroVoxelChunk,
    lx: number,
    ly: number,
    lz: number,
  ): number {
    if (ly < 0 || ly >= CHUNK_Y) return MAT.AIR;
    let ncx = chunk.cx;
    let ncz = chunk.cz;
    let nlx = lx;
    let nlz = lz;
    if (nlx < 0) {
      ncx--;
      nlx += CHUNK_X;
    } else if (nlx >= CHUNK_X) {
      ncx++;
      nlx -= CHUNK_X;
    }
    if (nlz < 0) {
      ncz--;
      nlz += CHUNK_Z;
    } else if (nlz >= CHUNK_Z) {
      ncz++;
      nlz -= CHUNK_Z;
    }
    if (nlx < 0 || nlx >= CHUNK_X || nlz < 0 || nlz >= CHUNK_Z) {
      return MAT.AIR;
    }
    const neighbor = this.chunkMap.get(`${ncx},${ncz}`);
    if (!neighbor || !neighbor.terrainPopulated) {
      return MAT.AIR;
    }
    if (neighbor.isSurfaceOnlyTerrain && !neighbor.userModified) {
      return neighbor.sampleSurfaceCompactVoxel(nlx, ly, nlz);
    }
    const flatIdx = nlx + CHUNK_X * (ly + CHUNK_Y * nlz);
    if (neighbor.pendingRemovals.size > 0 && neighbor.pendingRemovals.has(flatIdx)) {
      return neighbor.pendingRemovals.get(flatIdx) ?? MAT.AIR;
    }
    return neighbor.voxels[flatIdx];
  }

  private _sharedWestBorderSlice = new Uint8Array(CHUNK_Y * CHUNK_Z);
  private _sharedEastBorderSlice = new Uint8Array(CHUNK_Y * CHUNK_Z);
  private _sharedNorthBorderSlice = new Uint8Array(CHUNK_X * CHUNK_Y);
  private _sharedSouthBorderSlice = new Uint8Array(CHUNK_X * CHUNK_Y);

  /**
   * Extracts 1-voxel-thick boundary slices from the 4 cardinal neighbors of `chunk` for Web Worker meshing.
   * Reuses 4 singleton 20KB buffers (`_sharedWestBorderSlice`, etc.) instead of allocating 80KB per rebuild.
   */
  private extractNeighborBoundarySlices(
    chunk: MicroVoxelChunk,
  ): ChunkNeighborBoundarySlices {
    const slices: ChunkNeighborBoundarySlices = {};

    const buildXBorder = (
      ncx: number,
      ncz: number,
      borderLX: number,
      out: Uint8Array,
    ): Uint8Array | undefined => {
      const neighbor = this.chunkMap.get(`${ncx},${ncz}`);
      if (!neighbor || !neighbor.terrainPopulated) return undefined;
      const isSurfOnly = neighbor.isSurfaceOnlyTerrain && !neighbor.userModified;
      const hasPending = neighbor.pendingRemovals.size > 0;
      const nVox = neighbor.voxels;
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        const colBase = borderLX + CHUNK_X * CHUNK_Y * lz;
        const outBase = CHUNK_Y * lz;
        for (let ly = 0; ly < CHUNK_Y; ly++) {
          if (isSurfOnly) {
            out[outBase + ly] = neighbor.sampleSurfaceCompactVoxel(borderLX, ly, lz);
          } else {
            const flatIdx = colBase + ly * CHUNK_X;
            if (hasPending && neighbor.pendingRemovals.has(flatIdx)) {
              out[outBase + ly] = neighbor.pendingRemovals.get(flatIdx) ?? MAT.AIR;
            } else {
              out[outBase + ly] = nVox[flatIdx];
            }
          }
        }
      }
      return out;
    };

    const buildZBorder = (
      ncx: number,
      ncz: number,
      borderLZ: number,
      out: Uint8Array,
    ): Uint8Array | undefined => {
      const neighbor = this.chunkMap.get(`${ncx},${ncz}`);
      if (!neighbor || !neighbor.terrainPopulated) return undefined;
      const isSurfOnly = neighbor.isSurfaceOnlyTerrain && !neighbor.userModified;
      const hasPending = neighbor.pendingRemovals.size > 0;
      const nVox = neighbor.voxels;
      const zVoxBase = CHUNK_X * CHUNK_Y * borderLZ;
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const colBase = lx + zVoxBase;
        for (let ly = 0; ly < CHUNK_Y; ly++) {
          const outIdx = lx + CHUNK_X * ly;
          if (isSurfOnly) {
            out[outIdx] = neighbor.sampleSurfaceCompactVoxel(lx, ly, borderLZ);
          } else {
            const flatIdx = colBase + ly * CHUNK_X;
            if (hasPending && neighbor.pendingRemovals.has(flatIdx)) {
              out[outIdx] = neighbor.pendingRemovals.get(flatIdx) ?? MAT.AIR;
            } else {
              out[outIdx] = nVox[flatIdx];
            }
          }
        }
      }
      return out;
    };

    slices.west = buildXBorder(chunk.cx - 1, chunk.cz, CHUNK_X - 1, this._sharedWestBorderSlice);
    if (slices.west) slices.west = slices.west.slice();
    slices.east = buildXBorder(chunk.cx + 1, chunk.cz, 0, this._sharedEastBorderSlice);
    if (slices.east) slices.east = slices.east.slice();
    slices.north = buildZBorder(chunk.cx, chunk.cz - 1, CHUNK_Z - 1, this._sharedNorthBorderSlice);
    if (slices.north) slices.north = slices.north.slice();
    slices.south = buildZBorder(chunk.cx, chunk.cz + 1, 0, this._sharedSouthBorderSlice);
    if (slices.south) slices.south = slices.south.slice();
    return slices;
  }

  /**
   * Computes the highest continuous opaque voxel column height on a neighbor's boundary column.
   * For surface-only unmodified chunks this is an O(1) heightmap lookup; for 3D or modified chunks
   * it scans upward from vy = 1 so border cliff walls are NEVER culled across cave mouths or craters.
   */
  private getNeighborContinuousSolidTopVY(
    neighbor: MicroVoxelChunk,
    nlx: number,
    nlz: number,
  ): number {
    const lx = nlx & 63;
    const lz = nlz & 63;
    const nSurfVY = neighbor.surfaceHeightMap[lx + (lz << 6)];
    if (neighbor.isSurfaceOnlyTerrain && !neighbor.userModified) {
      return nSurfVY;
    }
    const nVox = neighbor.voxels;
    if (nVox.length < CHUNK_X * CHUNK_Y * CHUNK_Z) {
      return nSurfVY;
    }
    const hasPending = neighbor.pendingRemovals.size > 0;
    const colBase = lx + CHUNK_X * CHUNK_Y * lz;
    let solidTop = 0;
    const scanMax = Math.min(CHUNK_Y - 1, nSurfVY);
    for (let vy = 1; vy <= scanMax; vy++) {
      const flatIdx = colBase + vy * CHUNK_X;
      const m =
        hasPending && neighbor.pendingRemovals.has(flatIdx)
          ? (neighbor.pendingRemovals.get(flatIdx) ?? MAT.AIR)
          : nVox[flatIdx];
      if (m === MAT.AIR || isTranslucentVoxelMat(m)) {
        break;
      }
      solidTop = vy;
    }
    return solidTop;
  }

  private extractNeighborSurfaceHeights(chunk: MicroVoxelChunk): {
    west?: Uint16Array;
    east?: Uint16Array;
    north?: Uint16Array;
    south?: Uint16Array;
  } {
    const res: {
      west?: Uint16Array;
      east?: Uint16Array;
      north?: Uint16Array;
      south?: Uint16Array;
    } = {};
    const wN = this.chunkMap.get(`${chunk.cx - 1},${chunk.cz}`);
    if (wN && wN.terrainPopulated) {
      const arr = new Uint16Array(CHUNK_Z);
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        arr[lz] = this.getNeighborContinuousSolidTopVY(wN, CHUNK_X - 1, lz);
      }
      res.west = arr;
    }
    const eN = this.chunkMap.get(`${chunk.cx + 1},${chunk.cz}`);
    if (eN && eN.terrainPopulated) {
      const arr = new Uint16Array(CHUNK_Z);
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        arr[lz] = this.getNeighborContinuousSolidTopVY(eN, 0, lz);
      }
      res.east = arr;
    }
    const nN = this.chunkMap.get(`${chunk.cx},${chunk.cz - 1}`);
    if (nN && nN.terrainPopulated) {
      const arr = new Uint16Array(CHUNK_X);
      for (let lx = 0; lx < CHUNK_X; lx++) {
        arr[lx] = this.getNeighborContinuousSolidTopVY(nN, lx, CHUNK_Z - 1);
      }
      res.north = arr;
    }
    const sN = this.chunkMap.get(`${chunk.cx},${chunk.cz + 1}`);
    if (sN && sN.terrainPopulated) {
      const arr = new Uint16Array(CHUNK_X);
      for (let lx = 0; lx < CHUNK_X; lx++) {
        arr[lx] = this.getNeighborContinuousSolidTopVY(sN, lx, 0);
      }
      res.south = arr;
    }
    return res;
  }

  /**
   * Retrieves an existing chunk at (cx, cz) or dynamically generates a new chunk on-the-fly
   * so the world has NO outer border limit!
   */
  getOrCreateChunk(
    cx: number,
    cz: number,
    buildImmediately = false,
    enqueueDirty = true,
  ): MicroVoxelChunk {
    const inBounds =
      cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z;
    const existing = inBounds
      ? this.chunks[cx + cz * WORLD_CHUNKS_X]
      : this.chunkMap.get(`${cx},${cz}`);
    if (existing) {
      if (!existing.terrainPopulated) {
        this.populateChunkTerrain(existing);
        this.invalidateAdjacentNeighborChunks(cx, cz);
      }
      if (buildImmediately && !existing.hasBuiltMesh) {
        this.rebuildChunkSync(existing);
      }
      return existing;
    }

    const key = `${cx},${cz}`;
    const cachedModified = this.modifiedChunkCache.get(key);
    if (cachedModified) {
      this.modifiedChunkCache.delete(key);
      cachedModified.decompressFromCache();
      cachedModified.lastAccessedMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.chunkMap.set(key, cachedModified);
      this.chunkSlotMap.set(key, cachedModified.slotIndex);
      if (inBounds) {
        this.chunks[cx + cz * WORLD_CHUNKS_X] = cachedModified;
      }
      this.invalidateAdjacentNeighborChunks(cx, cz);
      if (buildImmediately) {
        this.rebuildChunkSync(cachedModified);
      } else if (enqueueDirty) {
        this.markChunkDirty(cachedModified);
      } else {
        cachedModified.dirty = true;
      }
      return cachedModified;
    }

    const chunk = new MicroVoxelChunk(cx, cz, false, this.voxelWorld);
    this.chunkMap.set(key, chunk);
    this.chunkSlotMap.set(key, chunk.slotIndex);
    if (inBounds) {
      this.chunks[cx + cz * WORLD_CHUNKS_X] = chunk;
    }

    this.populateChunkTerrain(chunk);
    this.invalidateAdjacentNeighborChunks(cx, cz);
    if (buildImmediately) {
      this.rebuildChunkSync(chunk);
    } else if (enqueueDirty) {
      this.markChunkDirty(chunk);
    } else {
      chunk.dirty = true;
    }
    return chunk;
  }

  private canUseWorkerProceduralSurfaceGen(): boolean {
    return (
      this.workerPool.hasDedicatedWorkers &&
      this.worldGenMode !== 'CUSTOM_GLB_MAP' &&
      this.worldGenMode !== 'CUSTOM_HEIGHTMAP'
    );
  }

  /**
   * Retrieves an existing chunk at (cx, cz) or creates a lightweight Top-Visible-Layer-Only chunk
   * that only populates and meshes the top surface + cliff steps (skipping all 80 underground Y-layers & caves).
   * When `deferTerrainGenToWorker` is true (default for outer streaming rings), skips main-thread
   * noise evaluation and neighbor invalidation — the Web Worker computes the 66x66 padded surface apron off-thread!
   */
  getOrCreateChunkTopSurfaceOnly(
    cx: number,
    cz: number,
    buildMeshImmediately = true,
    deferTerrainGenToWorker = false,
  ): MicroVoxelChunk {
    const inBounds =
      cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z;
    const existing = inBounds
      ? this.chunks[cx + cz * WORLD_CHUNKS_X]
      : this.chunkMap.get(`${cx},${cz}`);
    if (existing) {
      if (!existing.terrainPopulated && (!deferTerrainGenToWorker || buildMeshImmediately)) {
        this.populateChunkTopSurfaceOnly(existing);
        this.invalidateModifiedAdjacentNeighbors(cx, cz);
      }
      if (buildMeshImmediately && !existing.hasBuiltMesh && !existing.workerPending) {
        this.rebuildChunkTopSurfaceOnly(existing);
      }
      return existing;
    }

    const key = `${cx},${cz}`;

    const cachedModified = this.modifiedChunkCache.get(key);
    if (cachedModified) {
      this.modifiedChunkCache.delete(key);
      cachedModified.decompressFromCache();
      cachedModified.lastAccessedMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.chunkMap.set(key, cachedModified);
      this.chunkSlotMap.set(key, cachedModified.slotIndex);
      if (cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z) {
        this.chunks[cx + cz * WORLD_CHUNKS_X] = cachedModified;
      }
      this.invalidateAdjacentNeighborChunks(cx, cz);
      if (buildMeshImmediately) {
        this.rebuildChunkSync(cachedModified);
      } else {
        this.markChunkDirty(cachedModified);
      }
      return cachedModified;
    }

    const chunk = new MicroVoxelChunk(cx, cz, true, this.voxelWorld);
    this.chunkMap.set(key, chunk);
    this.chunkSlotMap.set(key, chunk.slotIndex);
    if (cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z) {
      this.chunks[cx + cz * WORLD_CHUNKS_X] = chunk;
    }

    if (deferTerrainGenToWorker && !buildMeshImmediately && this.canUseWorkerProceduralSurfaceGen()) {
      // Zero main-thread terrain generation & zero neighbor remesh cascade!
      // Worker will generate the 64x64 surface + 66x66 deterministic apron + LOD0/1/2 off-thread.
      chunk.dirty = true;
      this.invalidateModifiedAdjacentNeighbors(cx, cz);
      return chunk;
    }

    this.populateChunkTopSurfaceOnly(chunk);
    // Procedural chunks use deterministic borders, so only invalidate neighbors if they are user-modified
    if (this.worldGenMode === 'CUSTOM_GLB_MAP' || this.worldGenMode === 'CUSTOM_HEIGHTMAP') {
      this.invalidateAdjacentNeighborChunks(cx, cz);
    } else {
      this.invalidateModifiedAdjacentNeighbors(cx, cz);
    }
    if (buildMeshImmediately) {
      this.rebuildChunkTopSurfaceOnly(chunk);
    } else {
      chunk.dirty = true;
    }
    return chunk;
  }

  private invalidateModifiedAdjacentNeighbors(cx: number, cz: number): void {
    const dirs = [
      [cx - 1, cz],
      [cx + 1, cz],
      [cx, cz - 1],
      [cx, cz + 1],
    ];
    for (let i = 0; i < 4; i++) {
      const nChunk = this.chunkMap.get(`${dirs[i][0]},${dirs[i][1]}`);
      if (
        nChunk &&
        nChunk.userModified &&
        nChunk.terrainPopulated &&
        (nChunk.hasBuiltMesh || nChunk.workerPending)
      ) {
        nChunk.cachedOpaqueBuckets = [null, null, null];
        nChunk.dirtyBucketMask = MAT_BUCKET_ALL_MASK;
        this.markChunkDirty(nChunk);
      }
    }
  }

  /**
   * Populates ONLY the top visible surface layer of a chunk (3-voxel surface crust + water top layer),
   * skipping all buried underground rock/dirt layers (vy = 0..surfVY-3) and subterranean cave generation!
   */
  public populateChunkTopSurfaceOnly(chunk: MicroVoxelChunk): void {
    if (this.worldGenMode === 'CUSTOM_GLB_MAP' && this.activeGlbMapData) {
      this.populateChunkTerrain(chunk);
      return;
    }
    let cMinY = CHUNK_Y - 1;
    let cMaxY = 0;
    let hasTrans = false;
    const { cx, cz } = chunk;
    const halfVX = TOTAL_VX >> 1;
    const halfVZ = TOTAL_VZ >> 1;
    const isFlat = this.worldGenMode === 'FLAT_BASEPLATE';

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      const vz = cz * CHUNK_Z + lz;
      const relVZ = vz - halfVZ;
      const wz = relVZ * VOXEL_SIZE;
      const hRowOff = lz << 6;

      for (let lx = 0; lx < CHUNK_X; lx++) {
        const vx = cx * CHUNK_X + lx;
        const relVX = vx - halfVX;
        const wx = relVX * VOXEL_SIZE;

        const col = evaluateBiomeColumn(
          wx,
          wz,
          vx,
          vz,
          this.worldGenMode,
          this.flatBaseplateMat,
          this.heightmapData,
        );
        const surfVY = col.surfVY;
        chunk.surfaceHeightMap[lx + hRowOff] = surfVY;

        // Write ONLY the top surface voxel + 2-voxel sub-crust for physics into compact 64x32x64 buffer
        const colBase = lx + CHUNK_X * SURFACE_CHUNK_Y * lz;
        chunk.voxels[colBase] = col.topMat;
        if (surfVY >= 1) {
          chunk.voxels[colBase + CHUNK_X] = col.subMat;
        }
        if (surfVY >= 2) {
          chunk.voxels[colBase + 2 * CHUNK_X] = MAT.ROCK;
        }

        let colTop = surfVY;
        if (!isFlat && surfVY < WATER_VY && isWaterBasinArea(wx, wz, this.worldGenMode)) {
          hasTrans = true;
          chunk.voxels[colBase + 3 * CHUNK_X] = MAT.WATER_VOX;
          if (WATER_VY > colTop) colTop = WATER_VY;
        }

        if (surfVY - 2 < cMinY) cMinY = Math.max(1, surfVY - 2);
        if (colTop + 1 > cMaxY) cMaxY = Math.min(CHUNK_Y - 1, colTop + 1);
      }
    }

    chunk.minY = Math.max(1, Math.min(cMinY, cMaxY));
    chunk.maxY = Math.max(chunk.minY + 1, cMaxY);
    chunk.hasTranslucent = hasTrans;
    chunk.transMinY = hasTrans ? Math.max(1, WATER_VY - 1) : CHUNK_Y;
    chunk.transMaxY = hasTrans ? Math.min(CHUNK_Y - 1, WATER_VY + 1) : 0;
    chunk.terrainPopulated = true;
    chunk.isSurfaceOnlyTerrain = true;
  }

  /**
   * Upgrades a Top-Surface-Only chunk to full 3D volumetric terrain (filling underground strata & caves)
   * when a player modifies, digs, or explodes terrain in that chunk.
   */
  public ensureFullChunkTerrain(chunk: MicroVoxelChunk): void {
    if (!chunk.isSurfaceOnlyTerrain) return;
    chunk.isSurfaceOnlyTerrain = false;
    chunk.isSurfaceOnlyMesh = false;
    chunk.lod12Built = false;
    chunk.cachedOpaqueBuckets = [null, null, null];
    chunk.dirtyBucketMask = MAT_BUCKET_ALL_MASK;
    if (chunk.meshLOD1) {
      chunk.meshLOD1.visible = false;
      chunk.meshLOD1.userData.hasActiveVerts = false;
    }
    if (chunk.meshLOD2) {
      chunk.meshLOD2.visible = false;
      chunk.meshLOD2.userData.hasActiveVerts = false;
    }
    if (chunk.meshLOD3) {
      chunk.meshLOD3.visible = false;
      chunk.meshLOD3.userData.hasActiveVerts = false;
    }
    if (chunk.voxels.length !== CHUNK_X * CHUNK_Y * CHUNK_Z) {
      chunk.voxels = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
    }
    this.populateChunkTerrain(chunk);
    this.invalidateAdjacentNeighborChunks(chunk.cx, chunk.cz);
  }

  /**
   * Fast O(1) non-allocating surface height query for the Tactical Map & UI raycasts:
   * Reads `chunk.surfaceHeightMap` if the chunk is already in memory, or evaluates `evaluateBiomeColumn`
   * directly without allocating a 512KB chunk!
   */
  public sampleSurfaceHeightFast(wx: number, wz: number): number {
    const vx = Math.floor(wx / VOXEL_SIZE) + (TOTAL_VX >> 1);
    const vz = Math.floor(wz / VOXEL_SIZE) + (TOTAL_VZ >> 1);
    const cx = vx >> 6;
    const cz = vz >> 6;
    const inBounds =
      cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z;
    const chunk = inBounds
      ? this.chunks[cx + cz * WORLD_CHUNKS_X]
      : this.chunkMap.get(`${cx},${cz}`);
    if (chunk && chunk.terrainPopulated) {
      const surfVY = chunk.surfaceHeightMap[(vx & 63) + ((vz & 63) << 6)];
      return Math.round((surfVY + 1) * VOXEL_SIZE * 100) / 100;
    }
    const col =
      this.worldGenMode === 'CUSTOM_GLB_MAP' && this.activeGlbMapData
        ? this.evaluateGlbColumn(wx, wz)
        : evaluateBiomeColumn(
            wx,
            wz,
            vx,
            vz,
            this.worldGenMode,
            this.flatBaseplateMat,
            this.heightmapData,
          );
    return Math.round((col.surfVY + 1) * VOXEL_SIZE * 100) / 100;
  }

  /**
   * Returns true if world coordinate (wx, wz) lies inside the GPU footprint mask (alpha > 0)
   * of the active .GLB landmass, where water is strictly forbidden at any elevation.
   */
  public isInsideGlbLandmass(wx: number, wz: number): boolean {
    if (this.worldGenMode !== 'CUSTOM_GLB_MAP' || !this.activeGlbMapData) {
      return false;
    }
    const { sizeX, sizeZ, startWX, startWZ, cellMeters, footprintMask } =
      this.activeGlbMapData;
    const gx = Math.floor((wx - startWX) / cellMeters);
    const gz = Math.floor((wz - startWZ) / cellMeters);
    if (gx < 0 || gx >= sizeX || gz < 0 || gz >= sizeZ) {
      return false;
    }
    return footprintMask[gx + gz * sizeX] > 0;
  }

  /**
   * Queries the 3D Volumetric CT-Slicer grid directly at `(gx, gy, gz)`.
   * Returns `state`:
   * - `0`: open `MAT.AIR` (3D gaps, overhangs, caves, tunnels, valleys)
   * - `1`: surface shell voxel with exact 3D `(r, g, b)` color
   * - `2`: solid interior (`MAT.DIRT` / `MAT.ROCK` below the lowest surface hit)
   */
  public queryGlbVoxel3D(
    gx: number,
    gy: number,
    gz: number,
  ): { state: 0 | 1 | 2; mat: number; r: number; g: number; b: number } {
    const data = this.activeGlbMapData;
    if (
      !data ||
      gx < 0 ||
      gx >= data.gridX ||
      gy < 0 ||
      gy >= data.gridY ||
      gz < 0 ||
      gz >= data.gridZ
    ) {
      return { state: 0, mat: MAT.AIR, r: 0, g: 0, b: 0 };
    }
    const idx3D = gx + data.gridX * (gy + data.gridY * gz);
    const state = data.voxelSolid[idx3D] as 0 | 1 | 2;
    if (state === 0) {
      return { state: 0, mat: MAT.AIR, r: 0, g: 0, b: 0 };
    }
    if (state === 2) {
      const lowY = data.lowestSurfaceVY[gx + gz * data.gridX];
      const mat = gy >= lowY - 5 ? MAT.DIRT : MAT.ROCK;
      return { state: 2, mat, r: 0, g: 0, b: 0 };
    }
    const cOff = idx3D * 3;
    const r = data.voxelRGB[cOff] || 128;
    const g = data.voxelRGB[cOff + 1] || 128;
    const b = data.voxelRGB[cOff + 2] || 128;
    const rawMat = data.voxelMat[idx3D];
    const mat =
      rawMat && rawMat !== MAT.WATER_VOX
        ? rawMat
        : classifyPhysicalLandMaterial({ r: r / 255, g: g / 255, b: b / 255 }, 0);
    return { state: 1, mat, r, g, b };
  }

  private populateChunkTerrain(chunk: MicroVoxelChunk): void {
    let cMaxY = 0;
    let hasTrans = false;
    let tMinY = CHUNK_Y;
    let tMaxY = 0;
    const { cx, cz } = chunk;
    const halfVX = TOTAL_VX >> 1;
    const halfVZ = TOTAL_VZ >> 1;

    // True 3D Volumetric GPU CT-Slicer .GLB / .GLTF Terrain Populator:
    // - Queries the 3D voxel grid (voxelSolid & voxelRGB) directly at (gx, gy, gz) instead of a 2D topVY heightmap
    // - voxelSolid === 0 -> MAT.AIR (preserving 3D overhangs, bridges, arches, caves, tunnels, and valleys!)
    // - voxelSolid === 1 -> surface block with exact 3D (gx, gy, gz) RGB color written to chunk.customColors
    // - voxelSolid === 2 -> solid interior MAT.DIRT / MAT.ROCK below the lowest surface hit down to vy = 0
    // - Auto-elevated baseOffsetVY = WATER_VY + 2 and strict MAT.WATER_VOX block inside footprintMask > 0
    if (this.worldGenMode === 'CUSTOM_GLB_MAP' && this.activeGlbMapData) {
      const {
        gridX,
        gridY,
        gridZ,
        cellMeters,
        startWX,
        startWZ,
        baseVY,
        footprintMask,
        lowestSurfaceVY,
        highestSurfaceVY,
        voxelSolid,
        voxelRGB,
        voxelMat,
      } = this.activeGlbMapData;
      let cMinExposedY = CHUNK_Y - 1;

      for (let lz = 0; lz < CHUNK_Z; lz++) {
        const vz = cz * CHUNK_Z + lz;
        const relVZ = vz - halfVZ;
        const wz = relVZ * VOXEL_SIZE;

        for (let lx = 0; lx < CHUNK_X; lx++) {
          const vx = cx * CHUNK_X + lx;
          const relVX = vx - halfVX;
          const wx = relVX * VOXEL_SIZE;
          const colBase = lx + CHUNK_X * CHUNK_Y * lz;

          const gx = Math.floor((wx - startWX) / cellMeters);
          const gz = Math.floor((wz - startWZ) / cellMeters);

          if (gx >= 0 && gx < gridX && gz >= 0 && gz < gridZ) {
            const colIdx = gx + gz * gridX;

            if (footprintMask[colIdx] > 0) {
              const lowGY = Math.max(0, lowestSurfaceVY[colIdx]);
              const highGY = Math.max(lowGY, highestSurfaceVY[colIdx]);
              const lowestWorldVY = Math.min(CHUNK_Y - 2, baseVY + lowGY);

              if (baseVY < cMinExposedY) cMinExposedY = baseVY;

              // 1. Subterranean bedrock base below baseVY (vy = 0 .. baseVY - 1) so the lowest floor sits on solid ground down to vy = 0
              const subDirtStart = Math.max(1, lowestWorldVY - 5);
              for (let vy = 0; vy < baseVY; vy++) {
                chunk.voxels[colBase + vy * CHUNK_X] =
                  vy >= subDirtStart ? MAT.DIRT : MAT.ROCK;
              }

              // 2. Direct 3D Volumetric CT-Slice Query across gy = 0 .. gridY - 1
              let highestPlacedVY = baseVY;
              for (let gy = 0; gy < gridY; gy++) {
                const vy = baseVY + gy;
                if (vy >= CHUNK_Y - 1) break;

                const idx3D = gx + gridX * (gy + gridY * gz);
                const state = voxelSolid[idx3D];

                if (state === 0) {
                  // Preserve 3D gaps, overhangs, caves, arches, and valleys as 100% open MAT.AIR!
                  chunk.voxels[colBase + vy * CHUNK_X] = MAT.AIR;
                } else if (state === 1) {
                  // Surface shell voxel: assign exact 3D (gx, gy, gz) RGB color to chunk.customColors
                  const cOff = idx3D * 3;
                  const r = voxelRGB[cOff] || 128;
                  const g = voxelRGB[cOff + 1] || 128;
                  const b = voxelRGB[cOff + 2] || 128;
                  const rawMat = voxelMat[idx3D];
                  const mat =
                    rawMat && rawMat !== MAT.WATER_VOX
                      ? rawMat
                      : classifyPhysicalLandMaterial(
                          { r: r / 255, g: g / 255, b: b / 255 },
                          gy < highGY - 1 ? 3 : 0,
                        );
                  chunk.setVoxel(lx, vy, lz, mat, r, g, b);
                  if (vy > highestPlacedVY) highestPlacedVY = vy;
                } else {
                  // state === 2: Solid interior beneath lowestVY
                  chunk.voxels[colBase + vy * CHUNK_X] =
                    gy >= lowGY - 5 ? MAT.DIRT : MAT.ROCK;
                  if (vy > highestPlacedVY) highestPlacedVY = vy;
                }
              }

              // Strictly NO MAT.WATER_VOX inside valid landmass columns (footprintMask > 0)
              chunk.surfaceHeightMap[lx + (lz << 6)] = highestPlacedVY;
              if (highestPlacedVY + 1 > cMaxY) {
                cMaxY = Math.min(CHUNK_Y - 1, highestPlacedVY + 1);
              }
            } else {
              // Empty bay or ocean inlet outside the GLB footprint (alpha == 0): shallow sand seabed + ocean water
              const seabedVY = Math.max(2, WATER_VY - 4);
              if (seabedVY < cMinExposedY) cMinExposedY = seabedVY;
              for (let vy = 0; vy <= seabedVY; vy++) {
                chunk.voxels[colBase + vy * CHUNK_X] =
                  vy >= seabedVY - 2 ? MAT.SAND : MAT.ROCK;
              }
              hasTrans = true;
              const waterMinY = Math.max(46, seabedVY + 1);
              if (waterMinY < tMinY) tMinY = waterMinY;
              if (WATER_VY > tMaxY) tMaxY = WATER_VY;
              for (let vy = seabedVY + 1; vy <= WATER_VY; vy++) {
                chunk.voxels[colBase + vy * CHUNK_X] = MAT.WATER_VOX;
              }
              chunk.surfaceHeightMap[lx + (lz << 6)] = seabedVY;
              if (WATER_VY + 1 > cMaxY) {
                cMaxY = Math.min(CHUNK_Y - 1, WATER_VY + 1);
              }
            }
          } else {
            // Outside island bounds (alpha == 0): deepening endless ocean
            const col = this.evaluateOceanSeabedColumn(wx, wz);
            const surfVY = col.surfVY;
            if (surfVY < cMinExposedY) cMinExposedY = surfVY;
            chunk.surfaceHeightMap[lx + (lz << 6)] = surfVY;

            for (let vy = 0; vy <= surfVY; vy++) {
              let m: number = MAT.ROCK;
              if (vy === surfVY) m = col.topMat;
              else if (vy >= surfVY - 2) m = col.subMat;
              chunk.voxels[colBase + vy * CHUNK_X] = m;
            }

            if (surfVY < WATER_VY) {
              hasTrans = true;
              const waterMinY = Math.max(46, surfVY + 1);
              if (waterMinY < tMinY) tMinY = waterMinY;
              if (WATER_VY > tMaxY) tMaxY = WATER_VY;
              for (let vy = surfVY + 1; vy <= WATER_VY; vy++) {
                chunk.voxels[colBase + vy * CHUNK_X] = MAT.WATER_VOX;
              }
            }

            const colTop = Math.max(surfVY, WATER_VY);
            if (colTop + 1 > cMaxY) {
              cMaxY = Math.min(CHUNK_Y - 1, colTop + 1);
            }
          }
        }
      }

      chunk.minY = Math.max(1, cMinExposedY - 2);
      chunk.maxY = cMaxY;
      chunk.hasTranslucent = hasTrans;
      chunk.transMinY = hasTrans ? Math.max(1, tMinY - 1) : CHUNK_Y;
      chunk.transMaxY = hasTrans ? Math.min(CHUNK_Y - 1, tMaxY + 1) : 0;
      chunk.terrainPopulated = true;
      return;
    }

    let cMinExposedY = CHUNK_Y - 1;

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      const vz = cz * CHUNK_Z + lz;
      const relVZ = vz - halfVZ;
      const wz = relVZ * VOXEL_SIZE;

      for (let lx = 0; lx < CHUNK_X; lx++) {
        const vx = cx * CHUNK_X + lx;
        const relVX = vx - halfVX;
        const wx = relVX * VOXEL_SIZE;

        const col =
          this.worldGenMode === 'CUSTOM_GLB_MAP' && this.activeGlbMapData
            ? this.evaluateGlbColumn(wx, wz)
            : evaluateBiomeColumn(
                wx,
                wz,
                vx,
                vz,
                this.worldGenMode,
                this.flatBaseplateMat,
                this.heightmapData,
              );
        const surfVY = col.surfVY;
        const topMat = col.topMat;
        const subMat = col.subMat;
        chunk.surfaceHeightMap[lx + (lz << 6)] = surfVY;
        if (surfVY - 2 < cMinExposedY) {
          cMinExposedY = Math.max(1, surfVY - 2);
        }

        for (let vy = 0; vy <= surfVY; vy++) {
          let m: number = MAT.ROCK;
          if (vy === surfVY) m = topMat;
          else if (vy >= surfVY - 2) m = subMat;
          chunk.voxels[chunk.idx(lx, vy, lz)] = m;
        }

        let colTop = surfVY;

        if (this.worldGenMode !== 'FLAT_BASEPLATE') {
          const inBasin = isWaterBasinArea(wx, wz, this.worldGenMode);
          if (surfVY < WATER_VY && inBasin) {
            // Fill translucent water blocks all the way up to WATER_VY so water meets the shoreline
            // ground with zero gap at every elevation!
            hasTrans = true;
            const waterMinY = Math.max(46, surfVY + 1);
            if (waterMinY < tMinY) tMinY = waterMinY;
            if (WATER_VY > tMaxY) tMaxY = WATER_VY;
            for (let vy = surfVY + 1; vy <= WATER_VY; vy++) {
              chunk.voxels[chunk.idx(lx, vy, lz)] = MAT.WATER_VOX;
            }
            if (WATER_VY > colTop) colTop = WATER_VY;
          }

          // Only carve subterranean caves under dry inland terrain well above water level so caves never breach the seabed or shoreline!
          if (this.worldGenMode !== 'CUSTOM_GLB_MAP' && (!inBasin || surfVY > WATER_VY + 2)) {
            const cave = evaluateSubterraneanCaveColumn(relVX, relVZ, surfVY);

            if (cave.archRimTopVY > surfVY) {
              const topRim = Math.min(CHUNK_Y - 2, cave.archRimTopVY);
              for (let vy = surfVY + 1; vy <= topRim; vy++) {
                chunk.voxels[chunk.idx(lx, vy, lz)] = cave.archRimMat;
              }
              chunk.surfaceHeightMap[lx + (lz << 6)] = topRim;
              if (topRim > colTop) colTop = topRim;
            }

            if (cave.hasCave) {
              const fVY = Math.max(1, cave.caveFloorVY);
              const cVY = Math.min(CHUNK_Y - 2, cave.caveCeilVY);
              if (fVY - 2 < cMinExposedY) {
                cMinExposedY = Math.max(1, fVY - 2);
              }
              chunk.voxels[chunk.idx(lx, fVY, lz)] = cave.floorMat;
              if (fVY > 1) {
                chunk.voxels[chunk.idx(lx, fVY - 1, lz)] =
                  cave.floorMat === MAT.ASPHALT ? MAT.ROCK : cave.floorMat;
              }
              for (let vy = fVY + 1; vy <= cVY; vy++) {
                if (cave.archRimTopVY > 0 && vy >= surfVY + 6 && vy <= cave.archRimTopVY) {
                  chunk.voxels[chunk.idx(lx, vy, lz)] = cave.archRimMat;
                } else {
                  chunk.voxels[chunk.idx(lx, vy, lz)] = MAT.AIR;
                }
              }
              if (cVY >= surfVY && cave.archRimTopVY === 0) {
                chunk.surfaceHeightMap[lx + (lz << 6)] = fVY;
              }

              const stalLen = cave.stalactiteLen || 0;
              if (stalLen > 0 && cVY - stalLen > fVY + 5) {
                for (let s = 0; s < stalLen; s++) {
                  const svy = cVY - s;
                  chunk.voxels[chunk.idx(lx, svy, lz)] =
                    s === stalLen - 1 && cave.ceilMat !== MAT.ROCK
                      ? cave.ceilMat
                      : MAT.ROCK;
                }
              }

              const stagLen = cave.stalagmiteLen || 0;
              if (stagLen > 0 && fVY + stagLen < cVY - 5) {
                for (let s = 1; s <= stagLen; s++) {
                  chunk.voxels[chunk.idx(lx, fVY + s, lz)] = MAT.ROCK;
                }
              }

              if (cVY + 1 < surfVY && cave.ceilMat !== MAT.ROCK) {
                chunk.voxels[chunk.idx(lx, cVY + 1, lz)] = cave.ceilMat;
              }
            }
          }
        }

        if (colTop + 1 > cMaxY) cMaxY = Math.min(CHUNK_Y - 1, colTop + 1);
      }
    }

    chunk.minY = Math.max(1, cMinExposedY);
    chunk.maxY = Math.max(chunk.maxY, cMaxY);
    chunk.hasTranslucent = chunk.hasTranslucent || hasTrans;
    chunk.transMinY = hasTrans ? Math.max(1, Math.min(chunk.transMinY, tMinY - 1)) : chunk.transMinY;
    chunk.transMaxY = hasTrans ? Math.min(CHUNK_Y - 1, Math.max(chunk.transMaxY, tMaxY + 1)) : chunk.transMaxY;
    chunk.terrainPopulated = true;
  }

  worldToVoxelCoords(wx: number, wy: number, wz: number): { vx: number; vy: number; vz: number } {
    const vx = Math.floor(wx / VOXEL_SIZE) + TOTAL_VX / 2;
    const vy = Math.floor(wy / VOXEL_SIZE);
    const vz = Math.floor(wz / VOXEL_SIZE) + TOTAL_VZ / 2;
    return { vx, vy, vz };
  }

  getVoxel(vx: number, vy: number, vz: number): number {
    if (vy < 0 || vy >= CHUNK_Y) {
      return MAT.AIR;
    }
    const cx = vx >> 6;
    const cz = vz >> 6;
    let chunk: MicroVoxelChunk | undefined;
    if (cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z) {
      chunk = this.chunks[cx + cz * WORLD_CHUNKS_X];
    } else {
      chunk = this.chunkMap.get(`${cx},${cz}`);
    }
    if (!chunk) return MAT.AIR;
    if (!chunk.terrainPopulated) {
      const wx = (vx - (TOTAL_VX >> 1)) * VOXEL_SIZE;
      const wz = (vz - (TOTAL_VZ >> 1)) * VOXEL_SIZE;
      const col = evaluateBiomeColumn(
        wx,
        wz,
        vx,
        vz,
        this.worldGenMode,
        this.flatBaseplateMat,
        this.heightmapData,
      );
      if (vy > col.surfVY) {
        return vy <= WATER_VY && isWaterBasinArea(wx, wz, this.worldGenMode)
          ? MAT.WATER_VOX
          : MAT.AIR;
      }
      if (vy === col.surfVY) return col.topMat;
      if (vy === col.surfVY - 1) return col.subMat;
      return MAT.ROCK;
    }
    const lx = vx & 63;
    const lz = vz & 63;
    if (chunk.isSurfaceOnlyTerrain && !chunk.userModified) {
      return chunk.sampleSurfaceCompactVoxel(lx, vy, lz);
    }
    const m = chunk.voxels[lx + CHUNK_X * (vy + CHUNK_Y * lz)];
    if (m !== MAT.AIR) return m;
    return MAT.AIR;
  }

  getColumnSolidVY(vx: number, vz: number): number {
    const cx = vx >> 6;
    const cz = vz >> 6;
    let chunk: MicroVoxelChunk | undefined;
    if (cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z) {
      chunk = this.chunks[cx + cz * WORLD_CHUNKS_X];
    } else {
      chunk = this.chunkMap.get(`${cx},${cz}`);
    }
    if (!chunk) return WATER_VY + 2;
    if (!chunk.terrainPopulated) {
      const wx = (vx - (TOTAL_VX >> 1)) * VOXEL_SIZE;
      const wz = (vz - (TOTAL_VZ >> 1)) * VOXEL_SIZE;
      return evaluateBiomeColumn(
        wx,
        wz,
        vx,
        vz,
        this.worldGenMode,
        this.flatBaseplateMat,
        this.heightmapData,
      ).surfVY;
    }
    return chunk.surfaceHeightMap[(vx & 63) + ((vz & 63) << 6)];
  }

  setVoxel(
    vx: number,
    vy: number,
    vz: number,
    mat: number,
    r?: number,
    g?: number,
    b?: number,
  ): void {
    if (vy < 1 || vy >= CHUNK_Y) {
      return;
    }
    const cx = vx >> 6;
    const cz = vz >> 6;
    const chunk = this.getOrCreateChunk(cx, cz, false);
    if (chunk.isSurfaceOnlyTerrain) {
      this.ensureFullChunkTerrain(chunk);
    }
    const lx = vx & 63;
    const lz = vz & 63;

    // Strictly forbid water inside the GLB landmass footprint (alpha > 0)
    const wx = (vx - (TOTAL_VX >> 1)) * VOXEL_SIZE;
    const wz = (vz - (TOTAL_VZ >> 1)) * VOXEL_SIZE;
    if (mat === MAT.WATER_VOX && this.isInsideGlbLandmass(wx, wz)) {
      return;
    }

    // Allow water voxels up to WATER_VY so shorelines have zero gap
    const writeMat =
      mat === MAT.WATER_VOX && vy > WATER_VY ? MAT.AIR : mat;
    chunk.setVoxel(lx, vy, lz, writeMat, r, g, b);

    const colIdx = lx + (lz << 6);
    const prevSurf = chunk.surfaceHeightMap[colIdx];
    if (writeMat !== MAT.AIR && writeMat !== MAT.WATER_VOX) {
      if (vy > prevSurf) chunk.surfaceHeightMap[colIdx] = vy;
    } else if (vy >= prevSurf) {
      let newTop = 1;
      for (let scanY = Math.min(CHUNK_Y - 2, prevSurf); scanY >= 1; scanY--) {
        const m = chunk.voxels[lx + CHUNK_X * (scanY + CHUNK_Y * lz)];
        if (m !== MAT.AIR && m !== MAT.WATER_VOX) {
          newTop = scanY;
          break;
        }
      }
      chunk.surfaceHeightMap[colIdx] = newTop;
    }

    if (vy - 1 < chunk.minY) chunk.minY = Math.max(0, vy - 1);
    if (vy + 1 > chunk.maxY) chunk.maxY = Math.min(CHUNK_Y - 1, vy + 1);
    if (isTranslucentVoxelMat(writeMat)) {
      chunk.hasTranslucent = true;
      if (vy - 1 < chunk.transMinY) chunk.transMinY = Math.max(1, vy - 1);
      if (vy + 1 > chunk.transMaxY) chunk.transMaxY = Math.min(CHUNK_Y - 1, vy + 1);
    }
    chunk.userModified = true;
    chunk.lastAccessedMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    chunk.isSurfaceOnlyMesh = false;
    this.markChunkDirty(chunk);
    if (lx === 0 || lx === CHUNK_X - 1 || lz === 0 || lz === CHUNK_Z - 1) {
      this.invalidateNeighborsForBorderVoxel(cx, cz, lx, vy, lz);
    }
  }

  /**
   * Marks a world voxel at `(vx, vy, vz)` as pending removal for large destruction (`radius > 2`).
   * Does NOT remove the voxel from `chunk.voxels` yet — the voxel remains solid for physics until
   * the worker completes meshing and swaps both the voxel array and mesh simultaneously.
   */
  public markVoxelPendingRemoval(
    vx: number,
    vy: number,
    vz: number,
    fillMat: number = MAT.AIR,
    touchedChunks?: Set<MicroVoxelChunk>,
  ): MicroVoxelChunk | null {
    if (vy < 1 || vy >= CHUNK_Y) {
      return null;
    }
    const cx = vx >> 6;
    const cz = vz >> 6;
    const chunk = this.getOrCreateChunk(cx, cz, false, false);
    if (chunk.isSurfaceOnlyTerrain) {
      this.ensureFullChunkTerrain(chunk);
    }
    const lx = vx & 63;
    const lz = vz & 63;

    const wx = (vx - (TOTAL_VX >> 1)) * VOXEL_SIZE;
    const wz = (vz - (TOTAL_VZ >> 1)) * VOXEL_SIZE;
    if (fillMat === MAT.WATER_VOX && this.isInsideGlbLandmass(wx, wz)) {
      return null;
    }
    const writeMat =
      fillMat === MAT.WATER_VOX && vy > WATER_VY ? MAT.AIR : fillMat;
    chunk.markVoxelPendingRemoval(lx, vy, lz, writeMat);
    chunk.userModified = true;
    chunk.lastAccessedMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    chunk.isSurfaceOnlyMesh = false;
    chunk.cachedOpaqueBuckets = [null, null, null];
    chunk.dirtyBucketMask = MAT_BUCKET_ALL_MASK;
    chunk.version++;
    chunk.dirty = true;
    if (lx === 0 || lx === CHUNK_X - 1 || lz === 0 || lz === CHUNK_Z - 1) {
      this.invalidateNeighborsForBorderVoxel(cx, cz, lx, vy, lz, touchedChunks);
    }
    return chunk;
  }

  public isVoxelPendingRemoval(vx: number, vy: number, vz: number): boolean {
    if (vy < 0 || vy >= CHUNK_Y) return false;
    const cx = vx >> 6;
    const cz = vz >> 6;
    const chunk = this.chunkMap.get(`${cx},${cz}`);
    if (!chunk) return false;
    return chunk.isVoxelPendingRemoval(vx & 63, vy, vz & 63);
  }

  markChunkDirty(chunk: MicroVoxelChunk): void {
    chunk.version++;
    chunk.dirty = true;
    if (!chunk.inDirtyQueue) {
      chunk.inDirtyQueue = true;
      this.dirtyQueue.push(chunk);
    }
  }

  /**
   * Mass rebuild pass when `dirtyQueue.length > 50` (e.g. detonating 100 C4 charges at once).
   * Deduplicates dirty chunks, immediately commits pending voxel removals so physics stays synced,
   * and batch-dispatches LOD0-only worker rebuilds / fast surface rebuilds to prevent a slow-mo spiral.
   */
  private performMassDirtyChunkRebuildPass(
    centerCX: number,
    centerCZ: number,
    maxRad: number,
    isMapFastLoad = false,
  ): number {
    const uniqueDirty = new Map<string, MicroVoxelChunk>();
    for (let i = 0; i < this.dirtyQueue.length; i++) {
      const c = this.dirtyQueue[i];
      c.inDirtyQueue = false;
      if (c.dirty || !c.hasBuiltMesh) {
        uniqueDirty.set(c.key, c);
      }
    }
    this.dirtyQueue.length = 0;

    const sorted = Array.from(uniqueDirty.values()).sort((a, b) => {
      const da = Math.max(Math.abs(a.cx - centerCX), Math.abs(a.cz - centerCZ));
      const db = Math.max(Math.abs(b.cx - centerCX), Math.abs(b.cz - centerCZ));
      return da - db;
    });

    let processed = 0;
    const massBatchLimit = Math.max(24, this.cpuThreads * 6);
    const remaining: MicroVoxelChunk[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      if (c.pendingRemovals.size > 0) {
        c.commitPendingRemovals();
      }
      if (c.workerPending) continue;
      const cheb = Math.max(Math.abs(c.cx - centerCX), Math.abs(c.cz - centerCZ));
      if (processed < massBatchLimit && cheb <= maxRad + 2) {
        if ((isMapFastLoad || c.isSurfaceOnlyTerrain) && !c.userModified) {
          this.rebuildChunkTopSurfaceOnly(c);
        } else if (this.workerPool.hasDedicatedWorkers && c.hasBuiltMesh) {
          this.rebuildChunkAsync(c, true);
        } else if (cheb <= 1 && processed < 4) {
          this.rebuildChunkSync(c, true);
        } else {
          this.rebuildChunkAsync(c, true);
        }
        processed++;
      } else {
        c.inDirtyQueue = true;
        remaining.push(c);
      }
    }

    if (remaining.length > 0) {
      this.dirtyQueue.push(...remaining);
    }
    return processed;
  }

  /**
   * Extracts the closest eligible dirty chunk within `maxCheb` of `(centerCX, centerCZ)` in O(N) time
   * using O(1) swap-pop removal — zero `.sort()` closures, zero `.shift()` memmoves, and zero allocations!
   * Also prunes any already-clean or worker-pending entries encountered during the scan.
   */
  private extractClosestDirtyChunk(
    centerCX: number,
    centerCZ: number,
    maxCheb: number,
  ): { chunk: MicroVoxelChunk; cheb: number } | null {
    let bestIdx = -1;
    let bestCheb = Infinity;
    let i = 0;
    while (i < this.dirtyQueue.length) {
      const c = this.dirtyQueue[i];
      if (c.workerPending || (!c.dirty && c.hasBuiltMesh)) {
        c.inDirtyQueue = false;
        const last = this.dirtyQueue.pop()!;
        if (i < this.dirtyQueue.length) {
          this.dirtyQueue[i] = last;
        }
        continue;
      }
      const cheb = Math.max(Math.abs(c.cx - centerCX), Math.abs(c.cz - centerCZ));
      if (cheb <= maxCheb && cheb < bestCheb) {
        bestCheb = cheb;
        bestIdx = i;
        if (cheb === 0) break;
      }
      i++;
    }
    if (bestIdx < 0) return null;
    const chosen = this.dirtyQueue[bestIdx];
    chosen.inDirtyQueue = false;
    const last = this.dirtyQueue.pop()!;
    if (bestIdx < this.dirtyQueue.length) {
      this.dirtyQueue[bestIdx] = last;
    }
    return { chunk: chosen, cheb: bestCheb };
  }

  /**
   * Schedules dirty chunks near an impact/edit for rebuild (#2 & #3):
   * - Selects closest chunks to `(focusWX, focusWZ)` via O(1) swap-pop priority extraction
   * - Respects caller `maxChunks` when larger than `maxChunkRebuildsPerFrame` (e.g. stamping huge objects)
   */
  public flushDirtyChunksImmediate(
    focusWX: number,
    focusWZ: number,
    maxChunks = 2,
  ): void {
    if (this.dirtyQueue.length === 0) return;
    const centerCX = Math.floor(focusWX / (CHUNK_X * VOXEL_SIZE) + WORLD_CHUNKS_X / 2);
    const centerCZ = Math.floor(focusWZ / (CHUNK_Z * VOXEL_SIZE) + WORLD_CHUNKS_Z / 2);
    if (this.dirtyQueue.length > 50) {
      const baseRad = this.customRenderDistance || this.radiusModes[this.radiusModeIdx].radius;
      this.performMassDirtyChunkRebuildPass(centerCX, centerCZ, baseRad, false);
      return;
    }
    const budget = Math.max(1, maxChunks > this.maxChunkRebuildsPerFrame ? maxChunks : this.maxChunkRebuildsPerFrame);
    const maxCheb = maxChunks > 4 ? 8 : 4;
    let scheduled = 0;
    while (scheduled < budget && this.dirtyQueue.length > 0) {
      const next = this.extractClosestDirtyChunk(centerCX, centerCZ, maxCheb);
      if (!next) break;
      if (maxChunks > 4 || !this.workerPool.hasDedicatedWorkers) {
        this.rebuildChunk(next.chunk);
      } else {
        this.rebuildChunkAsync(next.chunk);
      }
      scheduled++;
    }
  }

  fillVoxelBox(
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
    const sy = Math.max(1, Math.min(y0, y1));
    const ey = Math.min(CHUNK_Y - 1, Math.max(y0, y1));
    const sz = Math.min(z0, z1);
    const ez = Math.max(z0, z1);

    for (let vz = sz; vz <= ez; vz++) {
      for (let vy = sy; vy <= ey; vy++) {
        for (let vx = sx; vx <= ex; vx++) {
          this.setVoxel(vx, vy, vz, mat);
        }
      }
    }
  }

  private disposeChunkWireAndBloom(chunk: MicroVoxelChunk): void {
    if (chunk.wireMesh) {
      this.scene.remove(chunk.wireMesh);
      chunk.wireMesh.count = 0;
      if (_wireInstancedMeshPool.length < 32) {
        const mat = chunk.wireMesh.material as THREE.MeshBasicMaterial;
        if (mat && !Array.isArray(mat)) {
          mat.opacity = 0.96;
        }
        _wireInstancedMeshPool.push(chunk.wireMesh);
      } else {
        if (Array.isArray(chunk.wireMesh.material)) {
          chunk.wireMesh.material.forEach((m) => m.dispose());
        } else {
          chunk.wireMesh.material.dispose();
        }
        chunk.wireMesh.dispose();
      }
      chunk.wireMesh = null;
    }
    if (chunk.isBloomMaterialAttached && chunk.mesh) {
      const prevMat = chunk.mesh.material;
      const stdMat = this.getActiveOpaqueVoxelMaterial();
      chunk.mesh.material = stdMat;
      if (
        prevMat &&
        prevMat !== stdMat &&
        prevMat !== this.sharedVoxelMaterial &&
        prevMat !== this.sharedTranslucentMaterial &&
        !Array.isArray(prevMat)
      ) {
        if (_bloomMaterialPool.length < 32 && (prevMat as any).uniforms) {
          _bloomMaterialPool.push(prevMat);
        } else {
          prevMat.dispose();
        }
      }
    }
    chunk.isBloomMaterialAttached = false;
  }

  private disposeChunkMeshes(chunk: MicroVoxelChunk, recycleToPool = true): void {
    this.disposeChunkWireAndBloom(chunk);
    const releaseMesh = (m: THREE.Mesh | null, isTranslucent: boolean) => {
      if (!m) return;
      this.scene.remove(m);
      if (!recycleToPool || !recycleChunkMeshToPool(m, isTranslucent)) {
        m.geometry.dispose();
      }
    };
    releaseMesh(chunk.mesh, false);
    chunk.mesh = null;
    releaseMesh(chunk.meshLOD1, false);
    chunk.meshLOD1 = null;
    releaseMesh(chunk.meshLOD2, false);
    chunk.meshLOD2 = null;
    releaseMesh(chunk.meshLOD3, false);
    chunk.meshLOD3 = null;
    releaseMesh(chunk.transMesh, true);
    chunk.transMesh = null;
    releaseMesh(chunk.transMeshLOD1, true);
    chunk.transMeshLOD1 = null;
    releaseMesh(chunk.transMeshLOD2, true);
    chunk.transMeshLOD2 = null;
    chunk.cachedOpaqueBuckets = [null, null, null];
    chunk.pendingRemovals.clear();
    chunk.activeLodLevel = -1;
  }

  regenerateWorld(
    mode: WorldGenMode,
    flatMat: number = this.flatBaseplateMat,
    heightmap: { width: number; height: number; heights: Uint8Array; scaleY: number } | null = this.heightmapData,
  ): void {
    this.worldGenMode = mode;
    this.gpuOceanWaveUniforms.uWorldGenMode.value = worldGenModeToShaderId(mode);
    this.flatBaseplateMat = flatMat;
    if (heightmap !== undefined) {
      this.heightmapData = heightmap;
    }
    if (mode !== 'CUSTOM_GLB_MAP') {
      this.activeGlbBounds = null;
      this.activeGlbMapData = null;
    }
    this.workerPool.clearQueuedJobs();
    this.placedObjectsHistory = [];
    this.dirtyQueue = [];
    this.priorityChunkQueue = [];
    this.animatingChunks = [];
    this.completedWorkerQueue = [];
    this.pendingWaterFlowQueue.length = 0;
    this.pendingWaterFlowSet.clear();
    this.pendingTerrainStructures.length = 0;
    this.pendingCarvedDebris.length = 0;
    this._cachedAllLod0Ready = false;
    this._allChunksInRadiusPresent = false;
    this._lastStreamCenterCX = Number.NaN;
    this._lastStreamCenterCZ = Number.NaN;
    this._lastStreamMaxRad = -1;

    this.chunkMap.forEach((chunk) => {
      chunk.version++;
      this.disposeChunkMeshes(chunk, true);
      this.voxelWorld.releaseChunkSlot(chunk.slotIndex);
    });
    this.modifiedChunkCache.forEach((chunk) => {
      this.voxelWorld.releaseChunkSlot(chunk.slotIndex);
    });
    this.chunkMap.clear();
    this.chunkSlotMap.clear();
    this.modifiedChunkCache.clear();
    this.horizonManager?.clearAll(true);
    this.chunks = new Array(WORLD_CHUNKS_X * WORLD_CHUNKS_Z);

    this.generateAllVoxelTerrain();
  }

  public buildWireframeMesh(chunk: MicroVoxelChunk): THREE.InstancedMesh | null {
    if (chunk.wireMesh) {
      this.scene.remove(chunk.wireMesh);
      chunk.wireMesh.count = 0;
      if (_wireInstancedMeshPool.length < 32) {
        _wireInstancedMeshPool.push(chunk.wireMesh);
      } else {
        if (Array.isArray(chunk.wireMesh.material)) {
          chunk.wireMesh.material.forEach((m) => m.dispose());
        } else {
          chunk.wireMesh.material.dispose();
        }
        chunk.wireMesh.dispose();
      }
      chunk.wireMesh = null;
    }

    // High-density wireframe cubes (up to 2400 instances per chunk) populated via reservoir/stride sampling
    // into a flat reusable Int32Array scratch buffer (zero heap allocations!)
    const maxWireInstances = 2400;
    let outCount = 0;
    const hMap = chunk.surfaceHeightMap;
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      const rowOff = lz << 6;
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const surfVY = hMap[lx + rowOff];
        if (surfVY > 0 && surfVY < CHUNK_Y) {
          if (outCount < maxWireInstances) {
            const b = outCount * 3;
            _sharedWireScratch[b] = lx;
            _sharedWireScratch[b + 1] = surfVY;
            _sharedWireScratch[b + 2] = lz;
            outCount++;
          } else if (((lx + lz) & 1) === 0) {
            const replaceIdx = ((lx * 37 + lz * 61) % maxWireInstances) * 3;
            _sharedWireScratch[replaceIdx] = lx;
            _sharedWireScratch[replaceIdx + 1] = surfVY;
            _sharedWireScratch[replaceIdx + 2] = lz;
          }
        }
      }
    }
    if (outCount === 0) return null;

    let wireMesh = _wireInstancedMeshPool.pop();
    if (!wireMesh) {
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0x00f5ff,
        wireframe: true,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
      });
      wireMesh = new THREE.InstancedMesh(
        getSharedCubeWireframeGeometry() as unknown as THREE.BufferGeometry,
        wireMat,
        maxWireInstances,
      );
    } else {
      const mat = wireMesh.material as THREE.MeshBasicMaterial;
      if (mat && !Array.isArray(mat)) {
        mat.opacity = 0.96;
      }
    }

    const halfV = VOXEL_SIZE * 0.5;
    for (let i = 0; i < outCount; i++) {
      const b = i * 3;
      const wx = chunk.originX + _sharedWireScratch[b] * VOXEL_SIZE + halfV;
      const wy = _sharedWireScratch[b + 1] * VOXEL_SIZE + halfV;
      const wz = chunk.originZ + _sharedWireScratch[b + 2] * VOXEL_SIZE + halfV;
      _sharedWireMatrix.setPosition(wx, wy, wz);
      wireMesh.setMatrixAt(i, _sharedWireMatrix);
    }
    wireMesh.count = outCount;
    wireMesh.instanceMatrix.needsUpdate = true;
    wireMesh.frustumCulled = false;
    wireMesh.renderOrder = 4;
    this.scene.add(wireMesh);
    chunk.wireMesh = wireMesh;
    chunk.state = ChunkState.WIREFRAME_READY;
    return wireMesh;
  }

  public attachBloomFillMaterial(chunk: MicroVoxelChunk): void {
    if (!chunk.mesh || chunk.isBloomMaterialAttached) return;

    const chunkCenterX = chunk.originX + CHUNK_X * VOXEL_SIZE * 0.5;
    const chunkMinY = chunk.minY * VOXEL_SIZE;
    const chunkCenterZ = chunk.originZ + CHUNK_Z * VOXEL_SIZE * 0.5;
    chunk.fillOrigin.set(chunkCenterX, chunkMinY, chunkCenterZ);

    const dy = (chunk.maxY - chunk.minY + 2) * VOXEL_SIZE;
    const dx = CHUNK_X * VOXEL_SIZE * 0.5;
    const dz = CHUNK_Z * VOXEL_SIZE * 0.5;
    chunk.fillMaxDist = Math.hypot(dx, dy, dz);

    const bloomMat = createBloomShaderMaterial(
      this.sharedVoxelMaterial,
      chunk.fillOrigin,
      chunk.fillMaxDist,
    );

    const prevMat = chunk.mesh.material;
    const stdMat = this.getActiveOpaqueVoxelMaterial();
    if (
      prevMat &&
      prevMat !== stdMat &&
      prevMat !== this.sharedVoxelMaterial &&
      prevMat !== this.sharedTranslucentMaterial &&
      !Array.isArray(prevMat)
    ) {
      if (_bloomMaterialPool.length < 32 && (prevMat as any).uniforms) {
        _bloomMaterialPool.push(prevMat);
      } else {
        prevMat.dispose();
      }
    }

    chunk.mesh.material = bloomMat;
    chunk.isBloomMaterialAttached = true;
  }

  public updateChunkAnimations(nowMs: number): void {
    for (let i = this.animatingChunks.length - 1; i >= 0; i--) {
      const chunk = this.animatingChunks[i];
      if (chunk.state !== ChunkState.MESH_READY) {
        this.disposeChunkWireAndBloom(chunk);
        this.animatingChunks.splice(i, 1);
        continue;
      }

      const elapsedSec = (nowMs - chunk.animStartTime) / 1000;
      if (elapsedSec < 0) {
        // Staggered delay before voxel fill begins — keep bright cyan wireframe glowing!
        chunk.animProgress = 0;
        if (chunk.mesh) {
          const mat = chunk.mesh.material as any;
          if (mat.uniforms?.uFillProgress) mat.uniforms.uFillProgress.value = 0;
          if (mat._compiledShader?.uniforms?.uFillProgress) {
            mat._compiledShader.uniforms.uFillProgress.value = 0;
          }
        }
        if (chunk.wireMesh) {
          const wireMat = chunk.wireMesh.material as THREE.MeshBasicMaterial;
          wireMat.opacity = 0.96;
        }
        continue;
      }

      // Crisp 0.85-second holographic wireframe-to-voxel materialization wave
      const rawT = Math.min(1.0, elapsedSec / 0.85);
      // Smooth ease-in-out so the wireframe is clearly visible first and then sweeps into solid voxels
      const progress = rawT < 0.2
        ? (rawT / 0.2) * 0.08
        : 0.08 + 0.92 * (1.0 - Math.pow(1.0 - (rawT - 0.2) / 0.8, 2.2));
      chunk.animProgress = progress;

      if (chunk.mesh) {
        const mat = chunk.mesh.material as any;
        if (mat.uniforms?.uFillProgress) mat.uniforms.uFillProgress.value = progress;
        if (mat._compiledShader?.uniforms?.uFillProgress) {
          mat._compiledShader.uniforms.uFillProgress.value = progress;
        }
      }

      // Coordinated Wireframe fade-out (holds crisp bright wireframe through 55% then dissolves smoothly)
      if (chunk.wireMesh) {
        const wireMat = chunk.wireMesh.material as THREE.MeshBasicMaterial;
        if (rawT < 0.55) {
          wireMat.opacity = 0.96;
        } else {
          wireMat.opacity = Math.max(0, 0.96 * (1.0 - (rawT - 0.55) / 0.45));
        }
      }

      if (rawT >= 1.0) {
        // Bloom Animation Complete — dispose wireMesh and cloned bloom material cleanly
        this.disposeChunkWireAndBloom(chunk);
        chunk.state = ChunkState.COMPLETE;
        this.animatingChunks.splice(i, 1);
      }
    }
  }

  public triggerArenaWireframeSweep(): void {
    const centerCX = WORLD_CHUNKS_X >> 1;
    const centerCZ = WORLD_CHUNKS_Z >> 1;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const chunk = this.chunkMap.get(`${centerCX + dx},${centerCZ + dz}`);
        if (!chunk || !chunk.mesh) continue;
        this.disposeChunkWireAndBloom(chunk);
        this.buildWireframeMesh(chunk);
        this.attachBloomFillMaterial(chunk);
        const ringDist = Math.hypot(dx, dz);
        chunk.animStartTime = nowMs + 120 + ringDist * 110;
        chunk.animProgress = 0;
        const mat = chunk.mesh.material as any;
        if (mat.uniforms?.uFillProgress) {
          mat.uniforms.uFillProgress.value = 0;
        }
        if (mat._compiledShader?.uniforms?.uFillProgress) {
          mat._compiledShader.uniforms.uFillProgress.value = 0;
        }
        chunk.state = ChunkState.MESH_READY;
        if (!this.animatingChunks.includes(chunk)) {
          this.animatingChunks.push(chunk);
        }
      }
    }
  }

  private _cachedAllLod0Ready = false;

  /**
   * Returns true only after ALL chunks in the world have reached LOD0 MESH_READY (or COMPLETE) state
   * and the startup priority queue is empty. LOD1 and LOD2 generation is strictly deferred until this is true.
   */
  public areAllChunksLod0MeshReady(): boolean {
    if (this._cachedAllLod0Ready && this.priorityChunkQueue.length === 0) {
      return true;
    }
    if (this.priorityChunkQueue.length > 0) {
      this._cachedAllLod0Ready = false;
      return false;
    }
    for (const chunk of this.chunkMap.values()) {
      if (
        !chunk.hasBuiltMesh ||
        (chunk.state !== ChunkState.MESH_READY &&
          chunk.state !== ChunkState.COMPLETE)
      ) {
        this._cachedAllLod0Ready = false;
        return false;
      }
    }
    const ready = this.chunkMap.size > 0;
    this._cachedAllLod0Ready = ready;
    return ready;
  }

  /**
   * Dispatches a queued chunk for LOD0 mesh generation (with LOD1/LOD2 deferred until all chunks reach LOD0 MESH_READY).
   */
  private dispatchQueuedChunkGeneration(
    chunk: MicroVoxelChunk,
    centerCX: number,
    centerCZ: number,
    skipWireframeBloom = false,
  ): void {
    if (chunk.state !== ChunkState.QUEUED) return;
    chunk.state = ChunkState.GENERATING;
    const ringDist = Math.hypot(chunk.cx - centerCX, chunk.cz - centerCZ);
    const effectiveSkipWireframe =
      skipWireframeBloom || this.usePotatoShader || ringDist > 1.5;

    if (!chunk.terrainPopulated) {
      if (skipWireframeBloom || (this.usePotatoShader && ringDist > 1.5)) {
        this.populateChunkTopSurfaceOnly(chunk);
      } else {
        this.populateChunkTerrain(chunk);
      }
      this.invalidateAdjacentNeighborChunks(chunk.cx, chunk.cz);
    }

    if (!effectiveSkipWireframe) {
      this.buildWireframeMesh(chunk);
    }

    const finalizeChunkMeshReady = () => {
      if (effectiveSkipWireframe) {
        this.disposeChunkWireAndBloom(chunk);
        chunk.state = ChunkState.COMPLETE;
        return;
      }
      this.attachBloomFillMaterial(chunk);
      const nowMs =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      chunk.animStartTime = nowMs + 35 + ringDist * 40;
      chunk.state = ChunkState.MESH_READY;
      if (!this.animatingChunks.includes(chunk)) {
        this.animatingChunks.push(chunk);
      }
    };

    const isSurfaceOnly =
      chunk.isSurfaceOnlyTerrain &&
      !chunk.userModified &&
      this.worldGenMode !== 'CUSTOM_GLB_MAP';

    if (this.workerPool.hasDedicatedWorkers) {
      chunk.dirty = false;
      chunk.workerPending = true;
      chunk.dirtyBucketMask = 0;
      const spawnPriorityScore = -950 + Math.round(ringDist * 25);
      const useSharedSlab =
        isSurfaceOnly &&
        chunk.isSurfaceOnlyTerrain &&
        chunk.voxels.length === CHUNK_X * SURFACE_CHUNK_Y * CHUNK_Z &&
        this.voxelWorld.usesSharedSurfaceSlab &&
        this.workerPool.hasSharedSurfaceSlab &&
        chunk.slotIndex < this.voxelWorld.surfaceSlabCapacity;
      this.workerPool
        .enqueueChunkJob(
          chunk.cx,
          chunk.cz,
          chunk.minY,
          chunk.maxY,
          chunk.originX,
          chunk.originZ,
          chunk.voxels,
          chunk.hasTranslucent,
          chunk.transMinY,
          chunk.transMaxY,
          chunk.customColors,
          MAT_BUCKET_ALL_MASK,
          true, // Defer LOD1 & LOD2 until all chunks reach LOD0 MESH_READY
          isSurfaceOnly ? undefined : this.extractNeighborBoundarySlices(chunk),
          undefined,
          isSurfaceOnly,
          isSurfaceOnly ? chunk.surfaceHeightMap : undefined,
          isSurfaceOnly ? this.extractNeighborSurfaceHeights(chunk) : undefined,
          {
            priorityScore: spawnPriorityScore,
            slotIndex: chunk.slotIndex,
            useSharedSlab,
            buildSurfaceLods: isSurfaceOnly && !this._horizonActive,
          },
        )
        .then((workerRes) => {
          chunk.workerPending = false;
          if (this.chunkMap.get(chunk.key) !== chunk) return;
          this.applyWorkerPayloadToChunk(chunk, workerRes);
          finalizeChunkMeshReady();
        })
        .catch(() => {
          chunk.workerPending = false;
          if (isSurfaceOnly) {
            this.rebuildChunkTopSurfaceOnly(chunk);
          } else {
            this.rebuildChunkSync(chunk, true);
          }
          finalizeChunkMeshReady();
        });
    } else if (skipWireframeBloom || isSurfaceOnly) {
      this.rebuildChunkTopSurfaceOnly(chunk);
      finalizeChunkMeshReady();
    } else {
      this.rebuildChunkSync(chunk, true);
      finalizeChunkMeshReady();
    }
  }

  public processPriorityChunkQueue(
    focusPos?: THREE.Vector3,
    isMapFastLoad = false,
  ): void {
    if (this.priorityChunkQueue.length === 0) return;

    const focusX = focusPos ? focusPos.x : this.lastFocusX;
    const focusZ = focusPos ? focusPos.z : this.lastFocusZ;
    const centerCX = Math.floor(focusX / (CHUNK_X * VOXEL_SIZE) + WORLD_CHUNKS_X / 2);
    const centerCZ = Math.floor(focusZ / (CHUNK_Z * VOXEL_SIZE) + WORLD_CHUNKS_Z / 2);

    if (isMapFastLoad) {
      this.priorityChunkQueue.sort((a, b) => {
        const da = Math.max(Math.abs(a.cx - centerCX), Math.abs(a.cz - centerCZ));
        const db = Math.max(Math.abs(b.cx - centerCX), Math.abs(b.cz - centerCZ));
        return da - db;
      });
      const startMs = typeof performance !== 'undefined' ? performance.now() : 0;
      let processed = 0;
      while (
        this.priorityChunkQueue.length > 0 &&
        processed < 18 &&
        (typeof performance === 'undefined' || performance.now() - startMs < 5.0)
      ) {
        const chunk = this.priorityChunkQueue.shift()!;
        if (chunk.state !== ChunkState.QUEUED) continue;
        this.dispatchQueuedChunkGeneration(chunk, centerCX, centerCZ, true);
        processed++;
      }
      return;
    }

    this.priorityChunkQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.spiralAngle - b.spiralAngle;
    });

    // Dispatch spawn-area chunks aggressively so the entire spawn LOD0 bubble fills rapidly before outer horizon rings build
    const processBatchSize = this.usePotatoShader ? 8 : 24;
    let processed = 0;

    while (this.priorityChunkQueue.length > 0 && processed < processBatchSize) {
      const chunk = this.priorityChunkQueue.shift()!;
      if (chunk.state !== ChunkState.QUEUED) continue;
      this.dispatchQueuedChunkGeneration(chunk, centerCX, centerCZ);
      processed++;
    }
  }

  public updateSceneFog(
    dt: number,
    isPlaying: boolean,
    isMapMode = false,
    fogEnabled = this.fogEnabled,
  ): void {
    this.fogEnabled = fogEnabled;
    if (!this.scene.fog) return;
    if (this.scene.fog instanceof THREE.FogExp2) {
      if (isMapMode) {
        this.scene.fog.density = 0.00025;
      }
      return;
    }
    if (!(this.scene.fog instanceof THREE.Fog)) return;
    const fog = this.scene.fog;

    if (isMapMode) {
      this.currentFogNear = 650;
      this.currentFogFar = 1300;
      fog.near = 650;
      fog.far = 1300;
      return;
    }

    const activeRad =
      this.customRenderDistance || this.radiusModes[this.radiusModeIdx]?.radius || 4;
    const bounds = computeLinearFogBounds(activeRad, fogEnabled, isPlaying, isMapMode);
    this.fogTargetNear = bounds.near;
    this.fogTargetFar = bounds.far;

    const lerpSpeed = Math.min(1, dt * 3.0);
    this.currentFogNear = THREE.MathUtils.lerp(this.currentFogNear, this.fogTargetNear, lerpSpeed);
    this.currentFogFar = THREE.MathUtils.lerp(this.currentFogFar, this.fogTargetFar, lerpSpeed);

    fog.near = this.currentFogNear;
    fog.far = this.currentFogFar;
  }

  generateAllVoxelTerrain(): void {
    const centerCX = WORLD_CHUNKS_X >> 1;
    const centerCZ = WORLD_CHUNKS_Z >> 1;
    this.dirtyQueue = [];
    this.priorityChunkQueue = [];
    this.animatingChunks = [];
    this.pendingWaterFlowQueue.length = 0;
    this.pendingWaterFlowSet.clear();
    this.waterFlowStepTimer = 0;
    this.isSpawnChunkLoaded = false;
    this._initialSpawnBubbleReady = false;

    const activeRad =
      this.customRenderDistance || this.radiusModes[this.radiusModeIdx].radius;
    const isLowEndMode = this.usePotatoShader || this.cpuThreads <= 2;
    const supportsHorizonTiles =
      this.worldGenMode !== 'CUSTOM_GLB_MAP' &&
      this.worldGenMode !== 'CUSTOM_HEIGHTMAP';
    const initialPlan = computeDynamicLodPlan({
      renderDistanceChunks: this.customRenderDistanceBig || BigInt(activeRad),
      lodSpacing: this.lodSpacing,
      isLowEndMode,
      uncappedChunkLod: this.uncappedChunkLod,
      supportsHorizonTiles,
    });
    const initialNested = computeNestedRingBoxesBigInt(centerCX, centerCZ, initialPlan);
    this._horizonActive = initialPlan.rings.length > 0;

    const ringRad = Math.min(3, Math.max(2, activeRad));
    const maxFull3DRad = this.usePotatoShader ? 1 : 3;

    // Cover the union of the core structure ring AND the snapped initial LOD0 box so there is NEVER an uncreated rim gap!
    const minInitCX = Math.min(centerCX - ringRad, Number(initialNested.lod0Box.minCX));
    const maxInitCXExcl = Math.max(
      centerCX + ringRad + 1,
      Number(initialNested.lod0Box.maxCXExcl),
    );
    const minInitCZ = Math.min(centerCZ - ringRad, Number(initialNested.lod0Box.minCZ));
    const maxInitCZExcl = Math.max(
      centerCZ + ringRad + 1,
      Number(initialNested.lod0Box.maxCZExcl),
    );

    // PART 1: Pre-populate terrain across the entire spawn LOD0 bubble so structures stamp cleanly and no edge rim is missing
    for (let cz = minInitCZ; cz < maxInitCZExcl; cz++) {
      for (let cx = minInitCX; cx < maxInitCXExcl; cx++) {
        const dx = cx - centerCX;
        const dz = cz - centerCZ;
        const key = `${cx},${cz}`;
        let chunk = this.chunkMap.get(key);
        const cheb = Math.max(Math.abs(dx), Math.abs(dz));
        const isOuterSurfaceOnly = cheb > maxFull3DRad;
        if (!chunk) {
          chunk = new MicroVoxelChunk(cx, cz, isOuterSurfaceOnly, this.voxelWorld);
          if (cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z) {
            this.chunks[cx + cz * WORLD_CHUNKS_X] = chunk;
          }
          this.chunkMap.set(key, chunk);
          this.chunkSlotMap.set(key, chunk.slotIndex);
        }
        chunk.state = ChunkState.QUEUED;
        chunk.hasBuiltMesh = false;
        chunk.lod12Built = false;
        chunk.priority = cheb;
        chunk.spiralAngle = Math.atan2(dz, dx);
        if (!chunk.terrainPopulated) {
          if (cheb <= maxFull3DRad) {
            this.populateChunkTerrain(chunk);
          } else {
            this.populateChunkTopSurfaceOnly(chunk);
          }
        }
      }
    }

    // PART 2: Stamp all world structures, stunt ramps, loops, obstacle courses, outposts & explosive silos
    if (this.worldGenMode === 'DEFAULT_PARK') {
      this.stampWorldStructures();
    }

    // Clear dirty flags created during structure stamping so priority queue manages initial meshing cleanly
    this.dirtyQueue = [];
    this.chunkMap.forEach((chunk) => {
      const dx = chunk.cx - centerCX;
      const dz = chunk.cz - centerCZ;
      chunk.priority = Math.max(Math.abs(dx), Math.abs(dz));
      chunk.spiralAngle = Math.atan2(dz, dx);
      chunk.dirty = false;
      chunk.inDirtyQueue = false;
      chunk.lod12Built = false;
      if (!chunk.hasBuiltMesh) {
        chunk.state = ChunkState.QUEUED;
      }
    });

    // PART 3: Priority 0 — Generate ONLY the spawn chunk first (LOD0 only, LOD1/LOD2 deferred!)
    const animNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const spawnChunk = this.chunkMap.get(`${centerCX},${centerCZ}`);
    if (spawnChunk) {
      spawnChunk.priority = 0;
      spawnChunk.state = ChunkState.GENERATING;
      this.rebuildChunkSync(spawnChunk, true);
      if (this.usePotatoShader) {
        this.disposeChunkWireAndBloom(spawnChunk);
        spawnChunk.state = ChunkState.COMPLETE;
      } else {
        this.buildWireframeMesh(spawnChunk);
        this.attachBloomFillMaterial(spawnChunk);
        spawnChunk.animStartTime = animNow + 150;
        spawnChunk.state = ChunkState.MESH_READY;
        this.animatingChunks.push(spawnChunk);
      }
    }

    this.isSpawnChunkLoaded = true;
    if (this.onSpawnChunkReady) {
      this.onSpawnChunkReady();
    }

    // PART 4: Queue the 8 surrounding chunks at priority 1, followed by outer chunks spiraling out (priority 2, 3, ...)
    this.chunkMap.forEach((chunk) => {
      if (chunk !== spawnChunk && !chunk.hasBuiltMesh && chunk.state === ChunkState.QUEUED) {
        this.priorityChunkQueue.push(chunk);
      }
    });

    // Sort priorityChunkQueue: priority 1 (8 surrounding chunks) first, then spiral out by ring & angle
    this.priorityChunkQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.spiralAngle - b.spiralAngle;
    });

    // Dispatch all 8 surrounding priority-1 chunks IN PARALLEL immediately!
    this.processPriorityChunkQueue();
  }

  stampPlaceableObject(
    prefab: VoxelObjectPrefab,
    wx: number,
    wy: number,
    wz: number,
    yawIdx = 0,
    recordHistory = true,
    pitchIdx = 0,
    rollIdx = 0,
  ): number {
    const { vx: baseVX, vy: baseVY, vz: baseVZ } = this.worldToVoxelCoords(wx, wy, wz);
    const rotated = rotateObjectVoxels(prefab.voxels, yawIdx, pitchIdx, rollIdx);
    const touchedChunks = new Set<MicroVoxelChunk>();
    let placed = 0;

    for (let i = 0; i < rotated.length; i++) {
      const [dx, dy, dz, mat] = rotated[i];
      const tvx = baseVX + dx;
      const tvy = Math.max(1, Math.min(CHUNK_Y - 2, baseVY + dy));
      const tvz = baseVZ + dz;
      this.setVoxel(tvx, tvy, tvz, mat);
      const c = this.chunkMap.get(`${tvx >> 6},${tvz >> 6}`);
      if (c) touchedChunks.add(c);
      placed++;
    }

    // Immediately rebuild all chunks touched by the placed object so huge objects never glitch or partially vanish
    touchedChunks.forEach((c) => {
      this.rebuildChunk(c);
    });

    if (recordHistory) {
      this.placedObjectsHistory.push({
        prefabId: prefab.id,
        name: prefab.name,
        wx: Number(wx.toFixed(2)),
        wy: Number(wy.toFixed(2)),
        wz: Number(wz.toFixed(2)),
        yawIdx,
        pitchIdx,
        rollIdx,
      });
    }
    return placed;
  }

  stampObjectPrefab(
    prefab: VoxelObjectPrefab,
    baseVX: number,
    baseVY: number,
    baseVZ: number,
    yawIdx = 0,
    pitchIdx = 0,
    rollIdx = 0,
  ): number {
    const rotated = rotateObjectVoxels(prefab.voxels, yawIdx, pitchIdx, rollIdx);
    const touchedChunks = new Set<MicroVoxelChunk>();
    let placed = 0;
    for (let i = 0; i < rotated.length; i++) {
      const [dx, dy, dz, mat] = rotated[i];
      const tvx = baseVX + dx;
      const tvy = Math.max(1, Math.min(CHUNK_Y - 2, baseVY + dy));
      const tvz = baseVZ + dz;
      this.setVoxel(tvx, tvy, tvz, mat);
      const c = this.chunkMap.get(`${tvx >> 6},${tvz >> 6}`);
      if (c) touchedChunks.add(c);
      placed++;
    }
    touchedChunks.forEach((c) => {
      if (c.hasBuiltMesh) {
        this.rebuildChunk(c);
      }
    });
    return placed;
  }

  /**
   * Stamps a voxelized 3D .GLB / .GLTF model into the world starting at (startWX, startWY, startWZ)
   * with direct RGB vertex colors, auto-elevation (WATER_VY + 2 minimum), and solid subterranean infill.
   */
  stampVoxelizedModel(
    voxels: Array<[number, number, number, number, number?, number?, number?]>,
    startWX: number,
    startWY: number,
    startWZ: number,
  ): number {
    const { vx: baseVX, vy: rawBaseVY, vz: baseVZ } = this.worldToVoxelCoords(
      startWX,
      startWY,
      startWZ,
    );
    // Guarantee stamped GLB models sit at least at WATER_VY + 2 so valleys never flood
    const baseVY = Math.max(WATER_VY + 2, rawBaseVY);
    const touchedChunks = new Set<MicroVoxelChunk>();
    let placed = 0;

    // Group stamped voxels by (tvx, tvz) column while preserving 3D gaps/overhangs:
    // Only fill solid ground beneath the *lowest* surface hit (lowestVY) in each column!
    const colMap = new Map<
      string,
      {
        tvx: number;
        tvz: number;
        lowestVY: number;
        topVY: number;
        vList: Array<{ vy: number; mat: number; r?: number; g?: number; b?: number }>;
      }
    >();

    for (let i = 0; i < voxels.length; i++) {
      const [dx, dy, dz, rawMat, r, g, b] = voxels[i];
      const mat = rawMat === MAT.WATER_VOX ? MAT.ROCK : rawMat;
      if (mat === MAT.AIR) continue;
      const tvx = baseVX + dx;
      const tvy = Math.max(WATER_VY + 2, Math.min(CHUNK_Y - 2, baseVY + dy));
      const tvz = baseVZ + dz;
      this.setVoxel(tvx, tvy, tvz, mat, r, g, b);

      const key = `${tvx},${tvz}`;
      let col = colMap.get(key);
      if (!col) {
        col = { tvx, tvz, lowestVY: tvy, topVY: tvy, vList: [] };
        colMap.set(key, col);
      } else {
        if (tvy < col.lowestVY) col.lowestVY = tvy;
        if (tvy > col.topVY) col.topVY = tvy;
      }
      col.vList.push({ vy: tvy, mat, r, g, b });

      const chunk = this.chunkMap.get(`${tvx >> 6},${tvz >> 6}`);
      if (chunk) {
        chunk.dirty = true;
        touchedChunks.add(chunk);
      }
      placed++;
    }

    // Solidify subterranean column ONLY beneath lowestVY in each stamped (tvx, tvz) column down to vy = 0
    // so 3D overhangs, bridges, and tunnels remain 100% open MAT.AIR!
    colMap.forEach((col) => {
      const { tvx, tvz, lowestVY, topVY, vList } = col;
      const cx = tvx >> 6;
      const cz = tvz >> 6;
      const chunk = this.getOrCreateChunk(cx, cz, false);
      const lx = tvx & 63;
      const lz = tvz & 63;
      const colBase = lx + CHUNK_X * CHUNK_Y * lz;

      // Add a 2-voxel structural crust directly beneath each stamped surface voxel where open air exists
      for (let i = 0; i < vList.length; i++) {
        const item = vList[i];
        for (let c = 1; c <= 2; c++) {
          const crustVY = item.vy - c;
          if (crustVY >= lowestVY - 2 && crustVY >= 1) {
            if (chunk.voxels[colBase + crustVY * CHUNK_X] === MAT.AIR) {
              chunk.setVoxel(lx, crustVY, lz, item.mat, item.r, item.g, item.b);
            }
          }
        }
      }

      const solidTopVY = Math.max(1, lowestVY - 2);
      for (let vy = solidTopVY - 1; vy >= Math.max(1, solidTopVY - 3); vy--) {
        chunk.voxels[colBase + vy * CHUNK_X] = MAT.DIRT;
      }
      for (let vy = Math.max(0, solidTopVY - 4); vy >= 0; vy--) {
        chunk.voxels[colBase + vy * CHUNK_X] = MAT.ROCK;
      }
      chunk.minY = Math.max(1, Math.min(chunk.minY, lowestVY - 3));
      if (topVY + 1 > chunk.maxY) chunk.maxY = Math.min(CHUNK_Y - 1, topVY + 1);
      chunk.dirty = true;
      touchedChunks.add(chunk);
    });

    touchedChunks.forEach((chunk) => {
      this.rebuildChunk(chunk);
    });

    return placed;
  }

  /**
   * Generates deepening endless ocean seabed outside the GLB island.
   */
  public evaluateOceanSeabedColumn(
    wx: number,
    wz: number,
  ): { surfVY: number; topMat: number; subMat: number } {
    let distOutside = Math.hypot(wx, wz);
    if (this.activeGlbBounds) {
      const dx = Math.max(
        0,
        this.activeGlbBounds.minWX - wx,
        wx - this.activeGlbBounds.maxWX,
      );
      const dz = Math.max(
        0,
        this.activeGlbBounds.minWZ - wz,
        wz - this.activeGlbBounds.maxWZ,
      );
      distOutside = Math.hypot(dx, dz);
    }
    const deepDrop = Math.max(0, Math.min(1, (distOutside - 4.0) / 140.0));
    const seabedWave = Math.sin(wx * 0.04) * Math.cos(wz * 0.04) * 1.5;
    const targetVY = (WATER_VY - 2) - deepDrop * 48.0 + seabedWave;
    const surfVY = Math.max(4, Math.min(WATER_VY - 1, Math.round(targetVY)));
    const topMat = deepDrop > 0.35 || surfVY <= 10 ? MAT.ROCK : MAT.SAND;
    const subMat = MAT.ROCK;
    return { surfVY, topMat, subMat };
  }

  /**
   * Evaluates the outer ocean seabed or lowest ground base for an imported .GLB world map.
   * Note: `populateChunkTerrain` bypasses 2D column heightmaps and queries `voxelSolid` & `voxelRGB` in 3D directly!
   */
  public evaluateGlbColumn(
    wx: number,
    wz: number,
  ): { surfVY: number; topMat: number; subMat: number } {
    if (this.activeGlbMapData) {
      const {
        gridX,
        gridY,
        gridZ,
        footprintMask,
        lowestSurfaceVY,
        highestSurfaceVY,
        voxelMat,
        startWX,
        startWZ,
        cellMeters,
        baseVY,
      } = this.activeGlbMapData;
      const gx = Math.floor((wx - startWX) / cellMeters);
      const gz = Math.floor((wz - startWZ) / cellMeters);
      if (gx >= 0 && gx < gridX && gz >= 0 && gz < gridZ) {
        const colIdx = gx + gz * gridX;
        if (footprintMask[colIdx] > 0 && lowestSurfaceVY[colIdx] >= 0) {
          const lowGY = lowestSurfaceVY[colIdx];
          const highGY = highestSurfaceVY[colIdx];
          const topIdx3D = gx + gridX * (highGY + gridY * gz);
          const rawMat = voxelMat[topIdx3D];
          const mat =
            rawMat === MAT.WATER_VOX || rawMat === MAT.AIR ? MAT.ROCK : rawMat;
          const surfVY = Math.max(
            WATER_VY + 2,
            Math.min(CHUNK_Y - 2, baseVY + lowGY),
          );
          return { surfVY, topMat: mat, subMat: MAT.DIRT };
        }
      }
    }

    return this.evaluateOceanSeabedColumn(wx, wz);
  }

  /**
   * Loads an imported .GLB / .GLTF 3D CT-Sliced model as a dedicated island world (`CUSTOM_GLB_MAP`)
   * scaled by `scaleFactor` (1x up to 100x), surrounded by an endless deep ocean.
   * Stores the full 3D volumetric `voxelSolid` (0 = air/gap, 1 = surface voxel, 2 = solid interior)
   * and `voxelRGB` (gridX * gridY * gridZ * 3) arrays so `populateChunkTerrain` queries 3D space directly,
   * preserving 100% of 3D overhangs, tunnels, bridges, arches, and valleys!
   */
  loadGlbMapAsWorld(
    voxels: Array<[number, number, number, number, number?, number?, number?]>,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    scaleFactor = 1,
    prebuiltVoxelSolid?: Uint8Array,
    prebuiltVoxelRGB?: Uint8Array,
  ): number {
    const clampedScale = Math.max(1, Math.min(100, Math.round(scaleFactor)));
    const cellMeters = clampedScale * VOXEL_SIZE;
    const gridX = Math.max(1, sizeX);
    const gridZ = Math.max(1, sizeZ);
    const spanX = gridX * cellMeters;
    const spanZ = gridZ * cellMeters;
    const startWX = -spanX * 0.5;
    const startWZ = -spanZ * 0.5;
    this.activeGlbBounds = {
      minWX: startWX,
      maxWX: startWX + spanX,
      minWZ: startWZ,
      maxWZ: startWZ + spanZ,
    };

    // Fit vertical height within [WATER_VY + 2 .. CHUNK_Y - 3]
    const baseVY = WATER_VY + 2;
    const maxAllowedDY = Math.max(1, CHUNK_Y - 3 - baseVY);
    const heightScale =
      sizeY > maxAllowedDY ? maxAllowedDY / Math.max(1, sizeY) : 1.0;
    const gridY = Math.max(
      1,
      Math.min(maxAllowedDY + 1, Math.ceil(Math.max(1, sizeY) * heightScale)),
    );

    const totalVoxels3D = gridX * gridY * gridZ;
    const voxelSolid = new Uint8Array(totalVoxels3D);
    const voxelRGB = new Uint8Array(totalVoxels3D * 3);
    const voxelMat = new Uint8Array(totalVoxels3D);

    // Fallback RGB lookup if legacy 4-tuple voxels are passed without explicit [r, g, b]
    const fallbackMatRGB = (mat: number): [number, number, number] => {
      const hex = MAT_INFO[mat]?.color ?? 0x808890;
      return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    };

    if (
      prebuiltVoxelSolid &&
      prebuiltVoxelRGB &&
      prebuiltVoxelSolid.length === totalVoxels3D &&
      prebuiltVoxelRGB.length === totalVoxels3D * 3
    ) {
      voxelSolid.set(prebuiltVoxelSolid);
      voxelRGB.set(prebuiltVoxelRGB);
    }

    for (let i = 0; i < voxels.length; i++) {
      const tuple = voxels[i];
      const dx = tuple[0];
      const rawDY = tuple[1];
      const dz = tuple[2];
      const rawMat = tuple[3];
      if (rawMat === MAT.AIR) continue;

      // Never allow MAT.WATER_VOX inside the GLB landmass footprint
      const mat = rawMat === MAT.WATER_VOX ? MAT.ROCK : rawMat;
      const dy = Math.max(0, Math.min(gridY - 1, Math.round(rawDY * heightScale)));

      let r = tuple[4];
      let g = tuple[5];
      let b = tuple[6];
      if (r === undefined || g === undefined || b === undefined) {
        const fb = fallbackMatRGB(mat);
        r = fb[0];
        g = fb[1];
        b = fb[2];
      }

      if (dx >= 0 && dx < gridX && dz >= 0 && dz < gridZ) {
        const idx3D = dx + gridX * (dy + gridY * dz);
        voxelSolid[idx3D] = 1;
        voxelMat[idx3D] = mat;
        const cOff = idx3D * 3;
        voxelRGB[cOff] = r === 0 && g === 0 && b === 0 ? 1 : r;
        voxelRGB[cOff + 1] = g;
        voxelRGB[cOff + 2] = b;
      }
    }

    // Run True 3D Parity Infill on the 3D grid:
    // - Preserves 3D gaps/tunnels between separated surface layers as 0 (MAT.AIR)
    // - Adds a 2-voxel structural crust directly beneath each overhang shell
    // - Fills solid interior (voxelSolid = 2) ONLY below the lowest surface hit (lowestVY) down to gy = 0
    const { footprintMask, lowestSurfaceVY, highestSurfaceVY } =
      applyTrue3DParityInfill(voxelSolid, voxelRGB, gridX, gridY, gridZ);

    const placedCount = voxels.length;
    this.activeGlbMapData = {
      voxels: [],
      sizeX: gridX,
      sizeY: gridY,
      sizeZ: gridZ,
      gridX,
      gridY,
      gridZ,
      scaleFactor: clampedScale,
      cellMeters,
      startWX,
      startWZ,
      baseVY,
      footprintMask,
      lowestSurfaceVY,
      highestSurfaceVY,
      voxelSolid,
      voxelRGB,
      voxelMat,
    };
    this.regenerateWorld('CUSTOM_GLB_MAP');
    return placedCount;
  }

  /**
   * Finds the best solid ground position near the center of an imported GLB map so vehicles spawn cleanly on land.
   */
  findBestGlbSpawnPosition(): { x: number; y: number; z: number } {
    const maxRadiusMeters = this.activeGlbBounds
      ? Math.max(24, (this.activeGlbBounds.maxWX - this.activeGlbBounds.minWX) * 0.45)
      : 24;
    for (let r = 0; r <= maxRadiusMeters; r += 1.5) {
      const steps = r === 0 ? 1 : Math.min(36, Math.max(12, Math.round(r * 2)));
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const wx = Math.cos(ang) * r;
        const wz = Math.sin(ang) * r;
        const { vx, vz } = this.worldToVoxelCoords(wx, WATER_LEVEL, wz);
        const solidVY = this.getColumnSolidVY(vx, vz);
        if (solidVY >= WATER_VY) {
          const topMat = this.getVoxel(vx, solidVY, vz);
          if (topMat !== MAT.AIR && topMat !== MAT.WATER_VOX) {
            return {
              x: wx,
              y: (solidVY + 1) * VOXEL_SIZE + 1.8,
              z: wz,
            };
          }
        }
      }
    }
    return { x: 0, y: WATER_LEVEL + 2.5, z: 0 };
  }

  /**
   * Computes exact distance in meters deep into the open ocean beyond shoreline or island bounds.
   */
  public getDeepOceanDistance(wx: number, wz: number): number {
    const mode = this.worldGenMode;
    if (mode === 'FLAT_BASEPLATE') return 0;
    if (mode === 'CUSTOM_GLB_MAP' && this.activeGlbBounds) {
      const dxOut = Math.max(
        0,
        this.activeGlbBounds.minWX - wx,
        wx - this.activeGlbBounds.maxWX,
      );
      const dzOut = Math.max(
        0,
        this.activeGlbBounds.minWZ - wz,
        wz - this.activeGlbBounds.maxWZ,
      );
      return Math.max(0, Math.hypot(dxOut, dzOut) - 20.0);
    }
    if (mode === 'DEFAULT_PARK') {
      if (wx < -48 && wz < 38) {
        return Math.max(0, -48 - wx);
      }
      return 0;
    }
    if (mode === 'BIOME_ARCHIPELAGO') {
      return Math.max(0, Math.hypot(wx, wz) - 95.0);
    }
    return Math.max(0, Math.hypot(wx, wz) - 120.0);
  }

  /**
   * Computes a normalized [0..1] deep-ocean factor based on how far out into the open ocean (wx, wz) is
   * beyond the GLB island border or coastal shelf.
   */
  public getDeepOceanFactor(wx: number, wz: number): number {
    const dist = this.getDeepOceanDistance(wx, wz);
    return Math.max(0, Math.min(1.0, dist / 140.0));
  }

  carveWorldCrater(
    wx: number,
    wy: number,
    wz: number,
    radiusVoxels = 3,
  ): number {
    const safeRadius = Math.max(1, Math.round(radiusVoxels));
    const isSmallDestruction = safeRadius <= 2;
    const { vx: cvx, vy: cvy, vz: cvz } = this.worldToVoxelCoords(wx, wy, wz);
    const rSq = safeRadius * safeRadius;
    const touchedChunks = new Set<MicroVoxelChunk>();
    let carved = 0;

    const carveTrenchChannel =
      this.worldGenMode === 'DEFAULT_PARK' &&
      cvy - safeRadius <= WATER_VY + 2 &&
      cvy >= WATER_VY - 2;
    const innerChannelRSq = Math.max(2, (safeRadius - 1) * (safeRadius - 1));

    const carvedDebrisVoxels: Array<{ vx: number; vy: number; vz: number; mat: number }> = [];

    for (let dz = -safeRadius; dz <= safeRadius; dz++) {
      for (let dy = -safeRadius; dy <= safeRadius; dy++) {
        for (let dx = -safeRadius; dx <= safeRadius; dx++) {
          const horizSq = dx * dx + dz * dz;
          const inSphere = horizSq + dy * dy <= rSq;
          const ty = cvy + dy;
          const inTrenchFloor =
            carveTrenchChannel &&
            horizSq <= innerChannelRSq &&
            ty >= WATER_VY - 1 &&
            ty <= cvy;
          if (inSphere || inTrenchFloor) {
            const tx = cvx + dx;
            const tz = cvz + dz;
            if (ty >= 1 && ty < CHUNK_Y - 1) {
              if (this.isVoxelPendingRemoval(tx, ty, tz)) continue;
              const prev = this.getVoxel(tx, ty, tz);
              if (prev !== MAT.AIR && prev !== MAT.WATER_VOX && prev !== MAT.BEDROCK) {
                const lx = tx & 63;
                const lz = tz & 63;
                if (isSmallDestruction) {
                  this.setVoxel(tx, ty, tz, MAT.AIR);
                  const c = this.chunkMap.get(`${tx >> 6},${tz >> 6}`);
                  if (c) touchedChunks.add(c);
                } else {
                  const c = this.markVoxelPendingRemoval(tx, ty, tz, MAT.AIR);
                  if (c) touchedChunks.add(c);
                }
                if (lx === 0 || lx === CHUNK_X - 1 || lz === 0 || lz === CHUNK_Z - 1) {
                  this.invalidateNeighborsForBorderVoxel(
                    tx >> 6,
                    tz >> 6,
                    lx,
                    ty,
                    lz,
                    touchedChunks,
                  );
                }
                carvedDebrisVoxels.push({ vx: tx, vy: ty, vz: tz, mat: prev });
                carved++;
              }
            }
          }
        }
      }
    }

    // Also ensure if carveTrenchChannel is active and cvy - safeRadius > WATER_VY - 1, we carve down to WATER_VY - 1
    if (carveTrenchChannel && cvy - safeRadius > WATER_VY - 1) {
      for (let dz = -safeRadius; dz <= safeRadius; dz++) {
        for (let dx = -safeRadius; dx <= safeRadius; dx++) {
          if (dx * dx + dz * dz > innerChannelRSq) continue;
          const tx = cvx + dx;
          const tz = cvz + dz;
          for (let ty = WATER_VY - 1; ty < cvy - safeRadius; ty++) {
            if (ty >= 1 && ty < CHUNK_Y - 1) {
              if (this.isVoxelPendingRemoval(tx, ty, tz)) continue;
              const prev = this.getVoxel(tx, ty, tz);
              if (prev !== MAT.AIR && prev !== MAT.WATER_VOX && prev !== MAT.BEDROCK) {
                const lx = tx & 63;
                const lz = tz & 63;
                if (isSmallDestruction) {
                  this.setVoxel(tx, ty, tz, MAT.AIR);
                  const c = this.chunkMap.get(`${tx >> 6},${tz >> 6}`);
                  if (c) touchedChunks.add(c);
                } else {
                  const c = this.markVoxelPendingRemoval(tx, ty, tz, MAT.AIR);
                  if (c) touchedChunks.add(c);
                }
                if (lx === 0 || lx === CHUNK_X - 1 || lz === 0 || lz === CHUNK_Z - 1) {
                  this.invalidateNeighborsForBorderVoxel(
                    tx >> 6,
                    tz >> 6,
                    lx,
                    ty,
                    lz,
                    touchedChunks,
                  );
                }
                carvedDebrisVoxels.push({ vx: tx, vy: ty, vz: tz, mat: prev });
                carved++;
              }
            }
          }
        }
      }
    }

    // Spawn TerrainEntity physics cubes for destroyed terrain voxels (never particles),
    // synchronized with chunk mesh swap on async large craters so debris appears as static blocks disappear
    if (carvedDebrisVoxels.length > 0) {
      const halfVX = TOTAL_VX >> 1;
      const halfVZ = TOTAL_VZ >> 1;
      const maxDebrisEntities = 24;
      const totalCarved = carvedDebrisVoxels.length;
      const spawnCount = Math.min(totalCarved, maxDebrisEntities);
      const stride = totalCarved / spawnCount;
      const debrisBatch: Array<{
        wx: number;
        wy: number;
        wz: number;
        color: number;
        blastX: number;
        blastY: number;
        blastZ: number;
      }> = [];
      for (let i = 0; i < spawnCount; i++) {
        const item = carvedDebrisVoxels[Math.min(totalCarved - 1, Math.floor(i * stride))];
        const info = MAT_INFO[item.mat & 63];
        debrisBatch.push({
          wx: (item.vx - halfVX + 0.5) * VOXEL_SIZE,
          wy: (item.vy + 0.5) * VOXEL_SIZE,
          wz: (item.vz - halfVZ + 0.5) * VOXEL_SIZE,
          color: info ? info.color : 0x94a3b8,
          blastX: wx,
          blastY: wy,
          blastZ: wz,
        });
      }
      if (!isSmallDestruction && this.workerPool.hasDedicatedWorkers && touchedChunks.size > 0) {
        this.queuePendingCarvedDebris(debrisBatch, new Set(touchedChunks));
      } else {
        for (let i = 0; i < debrisBatch.length; i++) {
          const d = debrisBatch[i];
          terrainEntityManager.spawnTerrainVoxelDebris(
            d.wx,
            d.wy,
            d.wz,
            d.color,
            d.blastX,
            d.blastY,
            d.blastZ,
            this.scene,
          );
        }
      }
    }

    // Collapse any static world structures that lost their ground support as unified rigid TerrainEntity structures
    const collapsedCount = this.collapseUnsupportedWorldVoxels(
      cvx,
      cvy,
      cvz,
      safeRadius,
      isSmallDestruction,
      touchedChunks,
    );
    carved += collapsedCount;

    // If the crater reaches at or below water level (vy <= WATER_VY) and touches a water body,
    // automatically flood connected air cavities with MAT.WATER_VOX!
    const effectiveMinVY = carveTrenchChannel
      ? Math.min(cvy - safeRadius, WATER_VY - 1)
      : cvy - safeRadius;
    if (effectiveMinVY <= WATER_VY) {
      this.floodConnectedWaterIntoRegion(
        cvx - safeRadius,
        cvx + safeRadius,
        Math.max(1, effectiveMinVY),
        Math.min(WATER_VY, cvy + safeRadius),
        cvz - safeRadius,
        cvz + safeRadius,
        !isSmallDestruction,
        touchedChunks,
      );
    }

    if (carved > 0) {
      if (isSmallDestruction) {
        // SMALL destruction (radius <= 2): rebuild chunk mesh SYNCHRONOUSLY on main thread
        // so visual hole and physics stay 100% consistent on the exact same frame!
        touchedChunks.forEach((chunk) => {
          this.rebuildChunkSync(chunk);
        });
      } else {
        // LARGE destruction (radius > 2): defer mesh rebuild to worker AND defer voxel array removal
        // until worker returns the new mesh, then swap both at the same time!
        touchedChunks.forEach((chunk) => {
          this.rebuildChunkAsync(chunk);
        });
      }
    }
    return carved;
  }

  /**
   * Static World Structural Collapse (Uncapped 10-Neighbor Support BFS + Unified Structure Entities):
   * - Walks all 10 neighbors (Up, Down, N, S, E, W, NE, NW, SE, SW) with downward-biased early exit
   *   when a path to ground/bedrock (`vy <= 1`, `MAT.BEDROCK`, or continuous natural terrain floor) exists.
   * - Zero BFS visited cap, zero component size cap, and zero local window truncation so arbitrarily
   *   large buildings, towers, arches, and bridges never stay floating.
   * - Detaches every disconnected unsupported component and spawns ONE unified greedy-meshed
   *   `TerrainEntity` rigid-body structure per island so the entire section falls as one piece.
   */
  public queuePendingCarvedDebris(
    items: Array<{
      wx: number;
      wy: number;
      wz: number;
      color: number;
      blastX: number;
      blastY: number;
      blastZ: number;
    }>,
    waitingChunks: Set<MicroVoxelChunk>,
  ): void {
    if (items.length === 0) return;
    if (waitingChunks.size === 0) {
      for (let i = 0; i < items.length; i++) {
        const d = items[i];
        terrainEntityManager.spawnTerrainVoxelDebris(
          d.wx,
          d.wy,
          d.wz,
          d.color,
          d.blastX,
          d.blastY,
          d.blastZ,
          this.scene,
        );
      }
      TerrainEntity.flushGpuBuffers();
      return;
    }
    this.pendingCarvedDebris.push({ items, waitingChunks });
  }

  /**
   * Flushes any deferred TerrainEntity structures / blast debris waiting on `chunk` once
   * `chunk`'s static mesh has swapped and the old static blocks have disappeared.
   */
  public flushPendingTerrainEntitiesForChunk(chunk: MicroVoxelChunk): number {
    let spawned = 0;
    for (let i = this.pendingTerrainStructures.length - 1; i >= 0; i--) {
      const entry = this.pendingTerrainStructures[i];
      entry.waitingChunks.delete(chunk);
      if (entry.waitingChunks.size === 0) {
        this.pendingTerrainStructures.splice(i, 1);
        terrainEntityManager.spawnStructure(entry.voxels, {
          halfVX: entry.halfVX,
          halfVZ: entry.halfVZ,
          voxelSize: entry.voxelSize,
          scene: this.scene,
        });
        spawned++;
      }
    }
    for (let i = this.pendingCarvedDebris.length - 1; i >= 0; i--) {
      const entry = this.pendingCarvedDebris[i];
      entry.waitingChunks.delete(chunk);
      if (entry.waitingChunks.size === 0) {
        this.pendingCarvedDebris.splice(i, 1);
        for (let k = 0; k < entry.items.length; k++) {
          const d = entry.items[k];
          terrainEntityManager.spawnTerrainVoxelDebris(
            d.wx,
            d.wy,
            d.wz,
            d.color,
            d.blastX,
            d.blastY,
            d.blastZ,
            this.scene,
          );
        }
        spawned += entry.items.length;
      }
    }
    if (spawned > 0) {
      TerrainEntity.flushGpuBuffers();
    }
    return spawned;
  }

  public collapseUnsupportedWorldVoxels(
    cvx: number,
    cvy: number,
    cvz: number,
    radiusVoxels: number,
    isSmallDestruction: boolean,
    touchedChunks: Set<MicroVoxelChunk>,
    onCollapseVoxel?: (
      wx: number,
      wy: number,
      wz: number,
      mat: number,
      colorHex: number,
    ) => void,
    options?: { deferUntilChunkSwap?: boolean },
  ): number {
    const safeR = Math.max(1, Math.min(32, Math.round(radiusVoxels)));
    const halfVX = TOTAL_VX >> 1;
    const halfVZ = TOTAL_VZ >> 1;
    const minFloorCheckY = Math.max(1, Math.min(WATER_VY, cvy - safeR - 1));
    const natGroundCache = new Map<number, number>();

    const getNaturalGroundVY = (vx: number, vz: number): number => {
      const colKey = ((vx & 0x7ff) << 11) | (vz & 0x7ff);
      let g = natGroundCache.get(colKey);
      if (g !== undefined) return g;
      const wx = (vx - halfVX + 0.5) * VOXEL_SIZE;
      const wz = (vz - halfVZ + 0.5) * VOXEL_SIZE;
      const col =
        this.worldGenMode === 'CUSTOM_GLB_MAP' && this.activeGlbMapData
          ? this.evaluateGlbColumn(wx, wz)
          : evaluateBiomeColumn(
              wx,
              wz,
              vx,
              vz,
              this.worldGenMode,
              this.flatBaseplateMat,
              this.heightmapData,
            );
      g = col.surfVY;
      natGroundCache.set(colKey, g);
      return g;
    };

    const isGroundVoxel = (vx: number, vy: number, vz: number, mat: number): boolean => {
      if (vy <= 1 || mat === MAT.BEDROCK) return true;
      const natVY = getNaturalGroundVY(vx, vz);
      if (vy > natVY) return false;
      // Untouched top-surface-only chunks represent unbroken natural ground below surfVY
      const cx = vx >> 6;
      const cz = vz >> 6;
      if (cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z) {
        const chunk = this.chunks[cx + cz * WORLD_CHUNKS_X];
        if (chunk && chunk.isSurfaceOnlyTerrain && !chunk.userModified) {
          return true;
        }
      }
      for (let y = vy - 1; y >= minFloorCheckY; y--) {
        const belowMat = this.readEffectiveVoxelMat(vx, y, vz);
        if (belowMat === MAT.AIR || belowMat === MAT.WATER_VOX) {
          return false;
        }
      }
      return true;
    };

    const result = findUnsupportedTerrainVoxels({
      cvx,
      cvy,
      cvz,
      radiusVoxels: safeR,
      minWorldX: 1,
      maxWorldX: TOTAL_VX - 2,
      minWorldY: 1,
      maxWorldY: CHUNK_Y - 2,
      minWorldZ: 1,
      maxWorldZ: TOTAL_VZ - 2,
      getMat: (vx, vy, vz) => this.readEffectiveVoxelMat(vx, vy, vz),
      isGroundVoxel,
      maxBfsVisited: TERRAIN_SUPPORT_MAX_BFS_VISITED,
    });

    if (result.components.length === 0) {
      return 0;
    }

    const deferSpawnUntilSwap =
      options?.deferUntilChunkSwap ??
      (!isSmallDestruction && this.workerPool.hasDedicatedWorkers);

    let totalCollapsed = 0;
    for (let cIdx = 0; cIdx < result.components.length; cIdx++) {
      const comp = result.components[cIdx];
      const detachedComp: Array<{ vx: number; vy: number; vz: number; mat: number }> = [];
      const compChunks = new Set<MicroVoxelChunk>();

      for (let i = 0; i < comp.length; i++) {
        const item = comp[i];
        const { vx, vy, vz } = item;
        if (
          vy <= 1 ||
          vy >= CHUNK_Y - 1 ||
          vx < 1 ||
          vx >= TOTAL_VX - 1 ||
          vz < 1 ||
          vz >= TOTAL_VZ - 1
        ) {
          continue;
        }
        const mat = this.readEffectiveVoxelMat(vx, vy, vz);
        if (mat === MAT.AIR || mat === MAT.WATER_VOX || mat === MAT.BEDROCK) continue;
        const lx = vx & 63;
        const lz = vz & 63;
        let touchedChunk: MicroVoxelChunk | undefined | null = null;
        if (isSmallDestruction) {
          this.setVoxel(vx, vy, vz, MAT.AIR);
          touchedChunk = this.chunkMap.get(`${vx >> 6},${vz >> 6}`);
          if (touchedChunk) touchedChunks.add(touchedChunk);
        } else {
          touchedChunk = this.markVoxelPendingRemoval(vx, vy, vz, MAT.AIR, touchedChunks);
          if (touchedChunk) touchedChunks.add(touchedChunk);
        }
        if (touchedChunk) {
          compChunks.add(touchedChunk);
        }
        if (lx === 0 || lx === CHUNK_X - 1 || lz === 0 || lz === CHUNK_Z - 1) {
          this.invalidateNeighborsForBorderVoxel(
            vx >> 6,
            vz >> 6,
            lx,
            vy,
            lz,
            touchedChunks,
          );
        }
        detachedComp.push({ vx, vy, vz, mat });
      }

      if (detachedComp.length === 0) continue;
      totalCollapsed += detachedComp.length;

      // Spawn the ENTIRE disconnected unsupported terrain component as ONE unified rigid-body TerrainEntity
      // at the exact moment its static blocks disappear (deferred until worker mesh swap on async craters)
      if (deferSpawnUntilSwap && compChunks.size > 0) {
        this.pendingTerrainStructures.push({
          voxels: detachedComp,
          waitingChunks: compChunks,
          halfVX,
          halfVZ,
          voxelSize: VOXEL_SIZE,
        });
      } else {
        terrainEntityManager.spawnStructure(detachedComp, {
          halfVX,
          halfVZ,
          voxelSize: VOXEL_SIZE,
          scene: this.scene,
        });
      }

      if (onCollapseVoxel) {
        for (let i = 0; i < detachedComp.length; i++) {
          const item = detachedComp[i];
          const info = MAT_INFO[item.mat & 63];
          onCollapseVoxel(
            (item.vx - halfVX + 0.5) * VOXEL_SIZE,
            (item.vy + 0.5) * VOXEL_SIZE,
            (item.vz - halfVZ + 0.5) * VOXEL_SIZE,
            item.mat,
            info ? info.color : 0x94a3b8,
          );
        }
      }
    }

    TerrainEntity.flushGpuBuffers();
    return totalCollapsed;
  }

  /**
   * Packs 3D world voxel coordinates (vx, vy, vz) into a collision-free 30-bit integer key
   * so BFS flood-fill and progressive water queues allocate zero strings.
   */
  private packWaterFlowKey(vx: number, vy: number, vz: number): number {
    return ((vy & 0xff) << 22) | ((vx & 0x7ff) << 11) | (vz & 0x7ff);
  }

  /**
   * Reads the effective material at (vx, vy, vz), taking into account any pending async
   * crater removals (`chunk.pendingRemovals`) so large craters (`radius > 2`) immediately
   * accept progressive water flow even while a background mesh worker is still running.
   */
  public readEffectiveVoxelMat(vx: number, vy: number, vz: number): number {
    if (vy < 1 || vy >= CHUNK_Y) return MAT.AIR;
    const cx = vx >> 6;
    const cz = vz >> 6;
    const inBounds =
      cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z;
    let chunk = inBounds
      ? this.chunks[cx + cz * WORLD_CHUNKS_X]
      : this.chunkMap.get(`${cx},${cz}`);
    if (!chunk && inBounds) {
      chunk = this.getOrCreateChunkTopSurfaceOnly(cx, cz, false);
    }
    if (!chunk) return MAT.AIR;
    const lx = vx & 63;
    const lz = vz & 63;
    if (chunk.isSurfaceOnlyTerrain && !chunk.userModified) {
      return chunk.sampleSurfaceCompactVoxel(lx, vy, lz);
    }
    const flatIdx = lx + CHUNK_X * (vy + CHUNK_Y * lz);
    if (chunk.pendingRemovals.size > 0 && chunk.pendingRemovals.has(flatIdx)) {
      return chunk.pendingRemovals.get(flatIdx) ?? MAT.AIR;
    }
    return chunk.voxels[flatIdx];
  }

  /**
   * Enqueues any 6-connected `MAT.AIR` neighbor cells around a newly placed water voxel `(vx, vy, vz)`
   * so progressive water flow continuously propagates across large craters and newly connected trenches
   * without ever stopping at an initial bounding box arc.
   */
  private enqueueNeighborAirForWaterFlow(vx: number, vy: number, vz: number): void {
    const tryNeighbor = (nx: number, ny: number, nz: number, isDown: boolean) => {
      if (ny < 1 || ny > WATER_VY || nx < 0 || nx >= TOTAL_VX || nz < 0 || nz >= TOTAL_VZ) {
        return;
      }
      const nk = this.packWaterFlowKey(nx, ny, nz);
      if (this.pendingWaterFlowSet.has(nk)) return;
      if (this.readEffectiveVoxelMat(nx, ny, nz) === MAT.AIR) {
        this.pendingWaterFlowSet.add(nk);
        if (isDown) {
          this.pendingWaterFlowQueue.unshift({ vx: nx, vy: ny, vz: nz });
        } else {
          this.pendingWaterFlowQueue.push({ vx: nx, vy: ny, vz: nz });
        }
      }
    };
    tryNeighbor(vx, vy - 1, vz, true);
    tryNeighbor(vx - 1, vy, vz, false);
    tryNeighbor(vx + 1, vy, vz, false);
    tryNeighbor(vx, vy, vz - 1, false);
    tryNeighbor(vx, vy, vz + 1, false);
    tryNeighbor(vx, vy + 1, vz, false);
  }

  /**
   * Fast water-only voxel setter used during progressive water flow (`stepWaterFlow`):
   * Updates `chunk.voxels` and translucent Y bounds without rescanning `surfaceHeightMap`
   * (unless clearing a pending solid removal) and without wiping neighbor opaque bucket caches!
   */
  private setWaterFlowVoxel(
    vx: number,
    vy: number,
    vz: number,
  ): MicroVoxelChunk | null {
    if (vy < 1 || vy > WATER_VY) return null;
    const wx = (vx - (TOTAL_VX >> 1)) * VOXEL_SIZE;
    const wz = (vz - (TOTAL_VZ >> 1)) * VOXEL_SIZE;
    if (this.isInsideGlbLandmass(wx, wz)) return null;

    const cx = vx >> 6;
    const cz = vz >> 6;
    const chunk = this.getOrCreateChunk(cx, cz, false);
    if (chunk.isSurfaceOnlyTerrain) {
      this.ensureFullChunkTerrain(chunk);
    }
    const lx = vx & 63;
    const lz = vz & 63;
    const flatIdx = lx + CHUNK_X * (vy + CHUNK_Y * lz);
    if (chunk.pendingRemovals.size > 0 && chunk.pendingRemovals.has(flatIdx)) {
      chunk.pendingRemovals.delete(flatIdx);
    }
    const prevMat = chunk.voxels[flatIdx];
    if (prevMat === MAT.WATER_VOX) return null;

    chunk.voxels[flatIdx] = MAT.WATER_VOX;
    if (prevMat !== MAT.AIR) {
      const colIdx = lx + (lz << 6);
      if (vy >= chunk.surfaceHeightMap[colIdx]) {
        let scanY = vy - 1;
        while (scanY > 0) {
          const m = chunk.voxels[lx + CHUNK_X * (scanY + CHUNK_Y * lz)];
          if (m !== MAT.AIR && m !== MAT.WATER_VOX) break;
          scanY--;
        }
        chunk.surfaceHeightMap[colIdx] = scanY;
      }
    }
    if (chunk.customColors) {
      const cIdx = flatIdx * 3;
      chunk.customColors[cIdx] = 0;
      chunk.customColors[cIdx + 1] = 0;
      chunk.customColors[cIdx + 2] = 0;
    }
    chunk.dirtyBucketMask |= 1 << MAT_BUCKET_TRANSLUCENT;
    chunk.hasTranslucent = true;
    if (vy - 1 < chunk.transMinY) chunk.transMinY = Math.max(1, vy - 1);
    if (vy + 1 > chunk.transMaxY) chunk.transMaxY = Math.min(CHUNK_Y - 1, vy + 1);
    if (vy - 1 < chunk.minY) chunk.minY = Math.max(0, vy - 1);
    if (vy + 1 > chunk.maxY) chunk.maxY = Math.min(CHUNK_Y - 1, vy + 1);
    chunk.userModified = true;
    return chunk;
  }

  /**
   * Rebuilds ONLY the translucent water mesh (`chunk.transMesh`) for a chunk during progressive water flow,
   * using the ultra-fast 2D column-top water mesher (`greedyMeshWaterTopSurfaceOnly` < 0.05ms)
   * and completely skipping the 3 opaque terrain buckets (`chunk.mesh`) so progressive water filling
   * runs at a locked 60+ FPS with zero main-thread stutter!
   */
  public rebuildChunkWaterOnly(chunk: MicroVoxelChunk): void {
    if (!chunk.hasTranslucent || chunk.transMaxY < chunk.transMinY) return;
    if (chunk.isSurfaceOnlyTerrain) {
      this.rebuildChunkTopSurfaceOnly(chunk);
      return;
    }

    const transRes = greedyMeshWaterTopSurfaceOnly(
      CHUNK_X,
      CHUNK_Y,
      CHUNK_Z,
      WATER_VY,
      chunk.voxels,
      chunk.originX,
      0,
      chunk.originZ,
      VOXEL_SIZE,
      true,
      Math.max(1, chunk.transMinY),
      chunk.surfaceHeightMap,
    );

    const tm0Res = updateOrCreateDynamicMeshBuffer(
      chunk.transMesh,
      transRes,
      this.sharedTranslucentMaterial,
      this.scene,
      true,
      4096,
      chunk.boundingSphere,
    );
    chunk.transMesh = tm0Res.mesh;
    if (chunk.transMesh) {
      chunk.transMesh.userData.rawFaces = transRes.rawFaces;
      chunk.transMesh.userData.mergedQuads = transRes.mergedQuads;
      chunk.transMesh.visible = true;
      if (chunk.activeLodLevel < 0) chunk.activeLodLevel = 0;
    }
    if (tm0Res.updatedInPlace) chunk.inPlaceBufferUpdates++;
    chunk.dirtyBucketMask &= ~(1 << MAT_BUCKET_TRANSLUCENT);
  }

  /**
   * Real-time cellular water flood-fill:
   * Whenever terrain is dug, lowered, or blasted near water level (`vy <= WATER_VY`),
   * any `MAT.AIR` cavity at `1 <= vy <= WATER_VY` that is directly 6-neighbor connected to an existing
   * `MAT.WATER_VOX` body (or an active progressive water flow queue cell) progressively floods with
   * `MAT.WATER_VOX` up to `WATER_VY`!
   * Separate holes that do not touch water remain dry until a connecting trench is dug.
   */
  public floodConnectedWaterIntoRegion(
    minVX: number,
    maxVX: number,
    minVY: number,
    maxVY: number,
    minVZ: number,
    maxVZ: number,
    usePendingRemoval = false,
    touchedChunks?: Set<MicroVoxelChunk>,
    instant = false,
  ): number {
    if (this.worldGenMode === 'FLAT_BASEPLATE' || minVY > WATER_VY) {
      return 0;
    }

    const sMinX = Math.min(minVX, maxVX);
    const sMaxX = Math.max(minVX, maxVX);
    const sMinY = Math.max(1, Math.min(minVY, maxVY));
    const sMaxY = WATER_VY;
    const sMinZ = Math.min(minVZ, maxVZ);
    const sMaxZ = Math.max(minVZ, maxVZ);

    const readEffectiveMat = (vx: number, vy: number, vz: number): number =>
      this.readEffectiveVoxelMat(vx, vy, vz);

    const isWaterOrQueuedAt = (vx: number, vy: number, vz: number): boolean => {
      if (readEffectiveMat(vx, vy, vz) === MAT.WATER_VOX) return true;
      if (
        this.pendingWaterFlowSet.size > 0 &&
        this.pendingWaterFlowSet.has(this.packWaterFlowKey(vx, vy, vz))
      ) {
        return true;
      }
      return false;
    };

    const isAdjacentToWater = (vx: number, vy: number, vz: number): boolean => {
      if (isWaterOrQueuedAt(vx - 1, vy, vz)) return true;
      if (isWaterOrQueuedAt(vx + 1, vy, vz)) return true;
      if (isWaterOrQueuedAt(vx, vy, vz - 1)) return true;
      if (isWaterOrQueuedAt(vx, vy, vz + 1)) return true;
      if (vy > 1 && isWaterOrQueuedAt(vx, vy - 1, vz)) return true;
      if (vy < WATER_VY && isWaterOrQueuedAt(vx, vy + 1, vz)) return true;
      return false;
    };

    const halfVX = TOTAL_VX >> 1;
    const halfVZ = TOTAL_VZ >> 1;

    // Only allow shoreline wave overtop when a hole is dug right on the wet ocean beach edge
    // (wx in [-25.5 .. -23.5], wz <= 33.5) within 1–6 voxels of the actual West Ocean water!
    // Never jump across dry land between separate holes or inland roads!
    const checkNaturalShorelineLip = (
      vx: number,
      vy: number,
      vz: number,
    ): Array<[number, number]> | null => {
      if (this.worldGenMode !== 'DEFAULT_PARK' || vy < WATER_VY - 1) return null;
      const wx = (vx - halfVX) * VOXEL_SIZE;
      const wz = (vz - halfVZ) * VOXEL_SIZE;
      if (wx < -25.5 || wx > -23.5 || wz > 33.5) return null;

      const lipCells: Array<[number, number]> = [];
      for (let step = 1; step <= 6; step++) {
        const sx = vx - step;
        const sz = vz;
        const matAtWater = readEffectiveMat(sx, WATER_VY, sz);
        const matBelowWater = readEffectiveMat(sx, WATER_VY - 1, sz);
        if (matAtWater === MAT.WATER_VOX || matBelowWater === MAT.WATER_VOX) {
          return lipCells;
        }
        // Stop if blocked by solid terrain higher than 2 voxels above sea level
        const matAbove = readEffectiveMat(sx, WATER_VY + 3, sz);
        if (matAbove !== MAT.AIR && matAbove !== MAT.WATER_VOX) {
          return null;
        }
        lipCells.push([sx, sz]);
      }
      return null;
    };

    // Generous +112 voxel (28m) horizontal expansion window so breaching a trench into any large pre-dug road crater
    // discovers and queues the entire crater on the very first check!
    const boundMinX = Math.max(0, sMinX - 112);
    const boundMaxX = Math.min(TOTAL_VX - 1, sMaxX + 112);
    const boundMinZ = Math.max(0, sMinZ - 112);
    const boundMaxZ = Math.min(TOTAL_VZ - 1, sMaxZ + 112);

    const visited = new Set<number>();
    const queueX: number[] = [];
    const queueY: number[] = [];
    const queueZ: number[] = [];
    const queueDist: number[] = [];

    for (let vz = sMinZ; vz <= sMaxZ; vz++) {
      for (let vx = sMinX; vx <= sMaxX; vx++) {
        for (let vy = sMinY; vy <= sMaxY; vy++) {
          if (readEffectiveMat(vx, vy, vz) !== MAT.AIR) continue;
          let seeded = isAdjacentToWater(vx, vy, vz);
          if (!seeded && vy >= WATER_VY - 1) {
            const lipCells = checkNaturalShorelineLip(vx, vy, vz);
            if (lipCells !== null) {
              seeded = true;
              for (let lIdx = 0; lIdx < lipCells.length; lIdx++) {
                const [lx, lz] = lipCells[lIdx];
                if (readEffectiveMat(lx, WATER_VY + 1, lz) !== MAT.AIR) {
                  if (usePendingRemoval) {
                    const c = this.markVoxelPendingRemoval(lx, WATER_VY + 1, lz, MAT.AIR, touchedChunks);
                    if (c && touchedChunks) touchedChunks.add(c);
                  } else {
                    this.setVoxel(lx, WATER_VY + 1, lz, MAT.AIR);
                    const c = this.chunkMap.get(`${lx >> 6},${lz >> 6}`);
                    if (c && touchedChunks) touchedChunks.add(c);
                  }
                }
                const lk = this.packWaterFlowKey(lx, WATER_VY, lz);
                if (!visited.has(lk)) {
                  visited.add(lk);
                  queueX.push(lx);
                  queueY.push(WATER_VY);
                  queueZ.push(lz);
                  queueDist.push(lIdx);
                }
              }
            }
          }
          if (seeded) {
            const k = this.packWaterFlowKey(vx, vy, vz);
            if (!visited.has(k)) {
              visited.add(k);
              queueX.push(vx);
              queueY.push(vy);
              queueZ.push(vz);
              queueDist.push(0);
            }
          }
        }
      }
    }

    if (queueX.length === 0) {
      return 0;
    }

    const MAX_FLOOD_VOXELS = 16384;
    let head = 0;
    const discoveredCells: Array<{ vx: number; vy: number; vz: number; dist: number }> = [];
    let minDiscoveredVY = WATER_VY;

    while (head < queueX.length && discoveredCells.length < MAX_FLOOD_VOXELS) {
      const vx = queueX[head];
      const vy = queueY[head];
      const vz = queueZ[head];
      const dist = queueDist[head];
      head++;

      discoveredCells.push({ vx, vy, vz, dist });
      if (vy < minDiscoveredVY) minDiscoveredVY = vy;

      // Propagate to 6-connected MAT.AIR neighbors at 1 <= ny <= WATER_VY
      const neighbors: Array<[number, number, number]> = [
        [vx - 1, vy, vz],
        [vx + 1, vy, vz],
        [vx, vy, vz - 1],
        [vx, vy, vz + 1],
        [vx, vy - 1, vz],
        [vx, vy + 1, vz],
      ];

      for (let i = 0; i < 6; i++) {
        const [nx, ny, nz] = neighbors[i];
        if (
          ny < 1 ||
          ny > WATER_VY ||
          nx < boundMinX ||
          nx > boundMaxX ||
          nz < boundMinZ ||
          nz > boundMaxZ
        ) {
          continue;
        }
        const nk = this.packWaterFlowKey(nx, ny, nz);
        if (visited.has(nk)) continue;
        if (readEffectiveMat(nx, ny, nz) === MAT.AIR) {
          visited.add(nk);
          queueX.push(nx);
          queueY.push(ny);
          queueZ.push(nz);
          queueDist.push(dist + 1);
        }
      }
    }

    if (instant) {
      for (let i = 0; i < discoveredCells.length; i++) {
        const { vx, vy, vz } = discoveredCells[i];
        const c = this.setWaterFlowVoxel(vx, vy, vz);
        if (c && touchedChunks) touchedChunks.add(c);
      }
      return discoveredCells.length;
    }

    // Progressive Flow Order:
    // Advance smoothly from the breach (dist) while filling the bottom of each trench/crater section first (vy)
    discoveredCells.sort((a, b) => {
      const scoreA = a.dist * 0.85 + (a.vy - minDiscoveredVY) * 1.6;
      const scoreB = b.dist * 0.85 + (b.vy - minDiscoveredVY) * 1.6;
      return scoreA - scoreB;
    });

    // Place the first entry batch immediately at the breach so water visibly rushes in on frame 1,
    // and enqueue the rest to flow progressively via stepWaterFlow(dt)!
    const immediateEntryCount = Math.min(20, discoveredCells.length);
    for (let i = 0; i < immediateEntryCount; i++) {
      const { vx, vy, vz } = discoveredCells[i];
      const c = this.setWaterFlowVoxel(vx, vy, vz);
      if (c && touchedChunks) touchedChunks.add(c);
    }

    for (let i = immediateEntryCount; i < discoveredCells.length; i++) {
      const { vx, vy, vz } = discoveredCells[i];
      const key = this.packWaterFlowKey(vx, vy, vz);
      if (!this.pendingWaterFlowSet.has(key)) {
        this.pendingWaterFlowSet.add(key);
        this.pendingWaterFlowQueue.push({ vx, vy, vz });
      }
    }

    // Also ensure any neighbors of the immediate entry cells are queued if needed
    for (let i = 0; i < immediateEntryCount; i++) {
      const { vx, vy, vz } = discoveredCells[i];
      this.enqueueNeighborAirForWaterFlow(vx, vy, vz);
    }

    return discoveredCells.length;
  }

  /**
   * Advances progressive cellular water flow into dug holes & trenches over time.
   * Runs at 40Hz (every 25ms) and updates ONLY the translucent water mesh (`rebuildChunkWaterOnly` < 0.05ms)
   * so water pours in smoothly and responsively while keeping frame rate locked at 60 FPS!
   */
  public stepWaterFlow(dt: number): number {
    if (this.pendingWaterFlowQueue.length === 0) {
      this.waterFlowStepTimer = 0;
      return 0;
    }

    this.waterFlowStepTimer += dt;
    const FLOW_STEP_INTERVAL = 0.025;
    if (this.waterFlowStepTimer < FLOW_STEP_INTERVAL) {
      return 0;
    }

    const stepsToRun = Math.min(4, Math.floor(this.waterFlowStepTimer / FLOW_STEP_INTERVAL));
    this.waterFlowStepTimer -= stepsToRun * FLOW_STEP_INTERVAL;

    const touchedChunks = new Set<MicroVoxelChunk>();
    let placedCount = 0;

    for (let s = 0; s < stepsToRun && this.pendingWaterFlowQueue.length > 0; s++) {
      const batchSize = Math.max(
        18,
        Math.min(180, Math.ceil(this.pendingWaterFlowQueue.length * 0.28)),
      );
      for (let i = 0; i < batchSize && this.pendingWaterFlowQueue.length > 0; i++) {
        const cell = this.pendingWaterFlowQueue.shift()!;
        const key = this.packWaterFlowKey(cell.vx, cell.vy, cell.vz);
        this.pendingWaterFlowSet.delete(key);

        if (this.readEffectiveVoxelMat(cell.vx, cell.vy, cell.vz) === MAT.AIR) {
          const chunk = this.setWaterFlowVoxel(cell.vx, cell.vy, cell.vz);
          if (chunk) touchedChunks.add(chunk);
          this.enqueueNeighborAirForWaterFlow(cell.vx, cell.vy, cell.vz);
          placedCount++;
        }
      }
    }

    if (touchedChunks.size > 0) {
      touchedChunks.forEach((chunk) => {
        this.rebuildChunkWaterOnly(chunk);
      });
    }

    return placedCount;
  }

  /**
   * Immediately flushes all remaining queued water flow cells (useful for deterministic tests or instant settle).
   */
  public flushPendingWaterFlow(): number {
    if (this.pendingWaterFlowQueue.length === 0) return 0;
    const touchedChunks = new Set<MicroVoxelChunk>();
    let placedCount = 0;
    const MAX_FLUSH_CELLS = 32768;

    while (this.pendingWaterFlowQueue.length > 0 && placedCount < MAX_FLUSH_CELLS) {
      const cell = this.pendingWaterFlowQueue.shift()!;
      const key = this.packWaterFlowKey(cell.vx, cell.vy, cell.vz);
      this.pendingWaterFlowSet.delete(key);
      if (this.readEffectiveVoxelMat(cell.vx, cell.vy, cell.vz) === MAT.AIR) {
        const chunk = this.setWaterFlowVoxel(cell.vx, cell.vy, cell.vz);
        if (chunk) touchedChunks.add(chunk);
        this.enqueueNeighborAirForWaterFlow(cell.vx, cell.vy, cell.vz);
        placedCount++;
      }
    }

    this.waterFlowStepTimer = 0;
    touchedChunks.forEach((chunk) => {
      this.rebuildChunkWaterOnly(chunk);
    });
    return placedCount;
  }

  buildTerrainRamp(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    radiusVoxels = 8,
    paintMat: number = MAT.RAMP_ORANGE,
  ): void {
    this.applyTerraformBrush(
      x1,
      y1,
      z1,
      'TERRA_RAMP',
      radiusVoxels,
      paintMat,
      new THREE.Vector3(x0, y0, z0),
    );
  }

  applyTerraformBrush(
    wx: number,
    wy: number,
    wz: number,
    arg4: WorldEditToolKind | string | number,
    arg5: WorldEditToolKind | string | number = 8,
    paintMat: number = MAT.GRASS,
    rampStartWorld?: THREE.Vector3 | null,
  ): void {
    const tool = typeof arg4 === 'string' ? arg4 : String(arg5);
    const radiusVoxels = typeof arg4 === 'number' ? arg4 : typeof arg5 === 'number' ? arg5 : 8;
    const { vx: cvx, vy: cvy, vz: cvz } = this.worldToVoxelCoords(wx, wy, wz);

    if ((tool === 'TERRA_RAMP' || tool === 'RAMP') && rampStartWorld) {
      const startV = this.worldToVoxelCoords(
        rampStartWorld.x,
        rampStartWorld.y,
        rampStartWorld.z,
      );
      const dx = cvx - startV.vx;
      const dy = cvy - startV.vy;
      const dz = cvz - startV.vz;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz)));
      const halfW = Math.max(2, Math.round(radiusVoxels * 0.6));

      const lenXZ = Math.max(1, Math.hypot(dx, dz));
      const perpX = -dz / lenXZ;
      const perpZ = dx / lenXZ;

      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const rx = Math.round(startV.vx + dx * t);
        const ry = Math.max(2, Math.min(CHUNK_Y - 2, Math.round(startV.vy + dy * t)));
        const rz = Math.round(startV.vz + dz * t);

        for (let w = -halfW; w <= halfW; w++) {
          const tx = Math.round(rx + perpX * w);
          const tz = Math.round(rz + perpZ * w);
          for (let y = Math.max(1, ry - 3); y <= ry; y++) {
            this.setVoxel(tx, y, tz, y === ry ? paintMat : MAT.ROCK);
          }
          for (let y = ry + 1; y <= Math.min(CHUNK_Y - 2, ry + 6); y++) {
            if (this.getVoxel(tx, y, tz) !== MAT.AIR) {
              this.setVoxel(tx, y, tz, MAT.AIR);
            }
          }
        }
      }
      return;
    }

    const rSq = radiusVoxels * radiusVoxels;
    for (let dz = -radiusVoxels; dz <= radiusVoxels; dz++) {
      for (let dx = -radiusVoxels; dx <= radiusVoxels; dx++) {
        const dSq = dx * dx + dz * dz;
        if (dSq > rSq) continue;

        const tx = cvx + dx;
        const tz = cvz + dz;
        const falloff = 1 - Math.sqrt(dSq) / (radiusVoxels + 0.5);

        let topY = 1;
        for (let y = CHUNK_Y - 2; y >= 1; y--) {
          const m = this.getVoxel(tx, y, tz);
          if (m !== MAT.AIR && m !== MAT.WATER_VOX) {
            topY = y;
            break;
          }
        }

        if (tool === 'TERRA_RAISE' || tool === 'RAISE') {
          const addH = Math.max(1, Math.round(falloff * 3));
          const newTop = Math.min(CHUNK_Y - 2, topY + addH);
          for (let y = topY; y <= newTop; y++) {
            this.setVoxel(tx, y, tz, y === newTop ? paintMat : MAT.DIRT);
          }
        } else if (tool === 'TERRA_LOWER' || tool === 'LOWER') {
          const subH = Math.max(1, Math.round(falloff * 3));
          const newTop = Math.max(2, topY - subH);
          for (let y = topY; y > newTop; y--) {
            this.setVoxel(tx, y, tz, MAT.AIR);
          }
          this.setVoxel(tx, newTop, tz, paintMat);
        } else if (tool === 'TERRA_FLATTEN' || tool === 'FLATTEN' || tool === 'SMOOTH') {
          const targetY =
            tool === 'SMOOTH'
              ? Math.max(2, Math.min(CHUNK_Y - 3, Math.round(topY * (1 - falloff * 0.5) + cvy * (falloff * 0.5))))
              : Math.max(2, Math.min(CHUNK_Y - 3, cvy));
          if (topY < targetY) {
            for (let y = topY; y <= targetY; y++) {
              this.setVoxel(tx, y, tz, y === targetY ? paintMat : MAT.ROCK);
            }
          } else if (topY > targetY) {
            for (let y = topY; y > targetY; y--) {
              this.setVoxel(tx, y, tz, MAT.AIR);
            }
            this.setVoxel(tx, targetY, tz, paintMat);
          } else {
            this.setVoxel(tx, targetY, tz, paintMat);
          }
        } else if (tool === 'TERRA_PAINT' || tool === 'BIOME_PAINT' || tool === 'PAINT') {
          this.setVoxel(tx, topY, tz, paintMat);
          if (topY > 2) {
            this.setVoxel(tx, topY - 1, tz, paintMat);
          }
        }
      }
    }
    if (
      tool === 'TERRA_LOWER' ||
      tool === 'LOWER' ||
      tool === 'TERRA_FLATTEN' ||
      tool === 'FLATTEN' ||
      tool === 'SMOOTH'
    ) {
      this.floodConnectedWaterIntoRegion(
        cvx - radiusVoxels,
        cvx + radiusVoxels,
        1,
        WATER_VY,
        cvz - radiusVoxels,
        cvz + radiusVoxels,
        false,
      );
    }
    this.flushDirtyChunksImmediate(wx, wz, this.maxChunkRebuildsPerFrame);
  }

  stampHollowBuilding(
    vx0: number,
    vz0: number,
    widthV: number,
    depthV: number,
    heightV: number,
    wallMat: number,
    roofMat: number,
  ): void {
    const baseVY = 11 + SUBTERRANEAN_DEPTH_VY;
    const topVY = baseVY + heightV;
    this.fillVoxelBox(vx0, baseVY, vz0, vx0 + widthV, topVY, vz0 + 1, wallMat);
    this.fillVoxelBox(vx0, baseVY, vz0 + depthV - 1, vx0 + widthV, topVY, vz0 + depthV, wallMat);
    this.fillVoxelBox(vx0, baseVY, vz0, vx0 + 1, topVY, vz0 + depthV, wallMat);
    this.fillVoxelBox(vx0 + widthV - 1, baseVY, vz0, vx0 + widthV, topVY, vz0 + depthV, wallMat);

    const doorStart = vx0 + Math.floor((widthV - 12) / 2);
    this.fillVoxelBox(doorStart, baseVY, vz0, doorStart + 12, baseVY + 10, vz0 + depthV, MAT.AIR);

    this.fillVoxelBox(vx0, baseVY + 5, vz0 + 5, vx0 + widthV, baseVY + 10, vz0 + depthV - 5, MAT.GLASS_SOLID);
    this.fillVoxelBox(vx0 + 2, baseVY, vz0 + 2, vx0 + widthV - 2, topVY - 1, vz0 + depthV - 2, MAT.AIR);

    this.fillVoxelBox(vx0 - 1, topVY, vz0 - 1, vx0 + widthV + 1, topVY + 1, vz0 + depthV + 1, roofMat);
    this.fillVoxelBox(vx0 + 6, topVY + 2, vz0 + 6, vx0 + widthV - 6, topVY + 5, vz0 + depthV - 6, MAT.C4_EXPLOSIVE);
  }

  stampExplosiveBarrelStash(
    vxCenter: number,
    vzCenter: number,
    count = 3,
    idPrefix = 'barrel',
  ): void {
    const baseVY = 11 + SUBTERRANEAN_DEPTH_VY;
    const offsets = [
      { dx: 0, dz: 0 },
      { dx: 3, dz: 1 },
      { dx: -2, dz: 2 },
      { dx: 1, dz: -2 },
    ];
    for (let i = 0; i < Math.min(count, offsets.length); i++) {
      const bvx = vxCenter + offsets[i].dx;
      const bvz = vzCenter + offsets[i].dz;
      // 2x3x2 Red Explosive Voxel Barrel with Hazard Yellow top band
      this.fillVoxelBox(bvx, baseVY, bvz, bvx + 1, baseVY + 2, bvz + 1, MAT.C4_EXPLOSIVE);
      this.fillVoxelBox(bvx, baseVY + 3, bvz, bvx + 1, baseVY + 3, bvz + 1, MAT.ROAD_LINE);
      this.setVoxel(bvx, baseVY + 3, bvz, MAT.C4_EXPLOSIVE);

      const wx = (bvx - TOTAL_VX / 2 + 0.5) * VOXEL_SIZE;
      const wy = (baseVY + 1.5) * VOXEL_SIZE;
      const wz = (bvz - TOTAL_VZ / 2 + 0.5) * VOXEL_SIZE;
      this.explosiveBarrels.push({
        id: `${idPrefix}_${i}`,
        wx,
        wy,
        wz,
        vx: bvx,
        vy: baseVY + 1,
        vz: bvz,
        intact: true,
      });
    }
  }

  /**
   * Checks if any intact explosive barrel stash is within `radiusMeters` of `(wx, wy, wz)`,
   * marks matching barrels as detonated, and returns their positions for chain-reaction craters.
   */
  consumeTriggeredExplosiveBarrels(
    wx: number,
    wy: number,
    wz: number,
    radiusMeters = 2.6,
  ): Array<{ wx: number; wy: number; wz: number }> {
    const rSq = radiusMeters * radiusMeters;
    const triggered: Array<{ wx: number; wy: number; wz: number }> = [];
    for (let i = 0; i < this.explosiveBarrels.length; i++) {
      const b = this.explosiveBarrels[i];
      if (!b.intact) continue;
      const dx = b.wx - wx;
      const dy = b.wy - wy;
      const dz = b.wz - wz;
      if (dx * dx + dy * dy + dz * dz <= rSq) {
        b.intact = false;
        triggered.push({ wx: b.wx, wy: b.wy, wz: b.wz });
      }
    }
    return triggered;
  }

  /**
   * Checks whether a vehicle moving from `(prevX, prevZ)` to `(curX, curZ)` passed through
   * the Speed Trap Radar Gate across the starting runway.
   */
  checkSpeedTrapCrossing(
    prevX: number,
    prevZ: number,
    curX: number,
    curZ: number,
    curY: number,
  ): boolean {
    const gateZ = this.speedTrapGate.wz;
    const crossedZ =
      (prevZ < gateZ && curZ >= gateZ) || (prevZ > gateZ && curZ <= gateZ);
    if (!crossedZ) return false;
    const midX = (prevX + curX) * 0.5;
    if (Math.abs(midX - this.speedTrapGate.wx) > this.speedTrapGate.halfWidthMeters) {
      return false;
    }
    if (
      curY < this.speedTrapGate.wy - 2.0 ||
      curY > this.speedTrapGate.wy + this.speedTrapGate.heightMeters
    ) {
      return false;
    }
    return true;
  }

  stampWorldStructures(): void {
    const cx = TOTAL_VX / 2;
    const cz = TOTAL_VZ / 2;
    const bY = SUBTERRANEAN_DEPTH_VY;
    const baseVY = bY + 10;
    this.explosiveBarrels = [];

    // 0A. WIDE BEGINNER LAUNCH PLAZA & 3-LANE PROVING GROUNDS RUNWAY
    // Center Beginner Runway from cz - 56 to cz + 72 (wx = -5.5m..+5.5m, wz = -14m..+18m)
    for (let z = cz - 56; z <= cz + 72; z++) {
      const isStripe = (z & 7) < 4;
      for (let x = cx - 22; x <= cx + 22; x++) {
        const isCenterStripe = Math.abs(x - cx) <= 1 && isStripe;
        const isLaneGuide = (Math.abs(x - (cx - 8)) === 0 || Math.abs(x - (cx + 8)) === 0) && isStripe;
        const isBorderCurb = Math.abs(x - cx) >= 21;
        const m = isBorderCurb
          ? MAT.HAZARD_YELLOW
          : isCenterStripe
            ? MAT.ROAD_LINE
            : isLaneGuide
              ? MAT.NEON_CYAN
              : MAT.ASPHALT;
        this.fillVoxelBox(x, bY + 9, z, x, baseVY, z, m);
      }
    }

    // 0B. DEDICATED WEST SHREDDER GAUNTLET APRON (wx = -18m..-6m, wz = +8m..+40m)
    // Gives players a flat, hazard-bordered arena right beside the main runway for the 4 spinning voxel hazards!
    for (let z = cz + 32; z <= cz + 160; z++) {
      for (let x = cx - 72; x <= cx - 23; x++) {
        const isEdge =
          x === cx - 72 || x === cx - 23 || z === cz + 32 || z === cz + 160;
        const mat = isEdge
          ? ((x + z) & 2 ? MAT.HAZARD_YELLOW : MAT.STEEL)
          : MAT.CONCRETE;
        this.fillVoxelBox(x, bY + 9, z, x, baseVY, z, mat);
      }
    }

    // 0C. SPEED TRAP RADAR GATE across starting runway at (cx, cz + 48 -> wx = 0, wz = 12.0m)
    this.speedTrapGate = {
      wx: 0,
      wy: (baseVY + 1) * VOXEL_SIZE,
      wz: 48 * VOXEL_SIZE,
      halfWidthMeters: 5.5,
      heightMeters: 6.5,
    };
    const gateZ = cz + 48;
    // Left & Right Radar Pylons
    this.fillVoxelBox(cx - 24, baseVY, gateZ - 1, cx - 21, baseVY + 22, gateZ + 2, MAT.STEEL);
    this.fillVoxelBox(cx + 21, baseVY, gateZ - 1, cx + 24, baseVY + 22, gateZ + 2, MAT.STEEL);
    this.fillVoxelBox(cx - 24, baseVY + 4, gateZ - 1, cx - 21, baseVY + 6, gateZ + 2, MAT.HAZARD_YELLOW);
    this.fillVoxelBox(cx + 21, baseVY + 4, gateZ - 1, cx + 24, baseVY + 6, gateZ + 2, MAT.HAZARD_YELLOW);
    this.fillVoxelBox(cx - 24, baseVY + 14, gateZ - 1, cx - 21, baseVY + 16, gateZ + 2, MAT.HAZARD_YELLOW);
    this.fillVoxelBox(cx + 21, baseVY + 14, gateZ - 1, cx + 24, baseVY + 16, gateZ + 2, MAT.HAZARD_YELLOW);
    // Overhead Radar Gantry Arch & Neon Cyan Sensor Array
    this.fillVoxelBox(cx - 24, baseVY + 20, gateZ - 1, cx + 24, baseVY + 23, gateZ + 2, MAT.STEEL);
    this.fillVoxelBox(cx - 18, baseVY + 21, gateZ - 2, cx + 18, baseVY + 22, gateZ + 3, MAT.NEON_CYAN);
    // Checkered tarmac timing line underneath gate
    for (let dx = -20; dx <= 20; dx++) {
      const mat = ((dx + 20) >> 1) % 2 === 0 ? MAT.HAZARD_YELLOW : MAT.ASPHALT;
      this.fillVoxelBox(cx + dx, baseVY, gateZ - 1, cx + dx, baseVY, gateZ + 1, mat);
    }

    // 1. CENTRAL STUNT JUMP RAMP & BEGINNER TABLE-TOP BRIDGE
    // Outer lanes (cx - 18..-9 and cx + 9..+18) are open gap jumps;
    // Center lane (cx - 8..+8) features a high table-top deck so beginners at any speed never get stuck in a pit!
    for (let s = 0; s < 48; s++) {
      const h = baseVY + Math.floor(s / 3);
      this.fillVoxelBox(cx - 18, baseVY, cz + 72 + s, cx + 18, h, cz + 72 + s, MAT.RAMP_ORANGE);
    }
    const tableTopVY = baseVY + 15;
    for (let z = cz + 120; z <= cz + 147; z++) {
      for (let x = cx - 8; x <= cx + 8; x++) {
        const isRail = Math.abs(x - cx) === 8;
        const deckMat = isRail ? MAT.NEON_CYAN : ((z & 3) === 0 ? MAT.HAZARD_YELLOW : MAT.ASPHALT);
        this.fillVoxelBox(x, tableTopVY - 1, z, x, tableTopVY, z, deckMat);
      }
      // Paved ground safety run-out underneath the outer gap jump wings
      this.fillVoxelBox(cx - 18, bY + 9, z, cx + 18, baseVY, z, MAT.ASPHALT);
    }
    for (let s = 0; s < 48; s++) {
      const h = baseVY + Math.floor((47 - s) / 3);
      this.fillVoxelBox(cx - 18, baseVY, cz + 148 + s, cx + 18, h, cz + 148 + s, MAT.RAMP_ORANGE);
    }
    // Paved landing apron extending north to the Giant Bowling Pins (cz + 196 .. cz + 228)
    this.fillVoxelBox(cx - 20, bY + 9, cz + 196, cx + 20, baseVY, cz + 228, MAT.ASPHALT);

    this.fillVoxelBox(cx - 24, baseVY, cz + 115, cx - 20, bY + 32, cz + 119, MAT.STEEL);
    this.fillVoxelBox(cx + 20, baseVY, cz + 115, cx + 24, bY + 32, cz + 119, MAT.STEEL);
    this.fillVoxelBox(cx - 24, bY + 30, cz + 115, cx + 24, bY + 33, cz + 119, MAT.RAMP_ORANGE);

    // 2. GIANT LOOP-DE-LOOP RAMP near starting runway (East Lane: cx + 42 .. cx + 68, cz + 70 .. cz + 135)
    const loopCenterZ = cz + 104;
    const loopRadius = 16;
    const loopCenterY = baseVY + loopRadius;
    // Entry approach ramp leading smoothly into bottom of loop
    for (let zOff = -24; zOff <= 0; zOff++) {
      const rampY = baseVY + Math.floor(((zOff + 24) / 24) * 2);
      this.fillVoxelBox(
        cx + 42,
        baseVY,
        loopCenterZ + zOff,
        cx + 54,
        rampY,
        loopCenterZ + zOff,
        MAT.RAMP_ORANGE,
      );
    }
    // 360-degree helical loop-de-loop track with side guide curbs
    const loopSteps = 160;
    for (let i = 0; i <= loopSteps; i++) {
      const t = i / loopSteps;
      const theta = -Math.PI * 0.5 + t * Math.PI * 2.0;
      const lvy = Math.round(loopCenterY + Math.sin(theta) * loopRadius);
      const lvz = Math.round(loopCenterZ + Math.cos(theta) * loopRadius);
      const laneShiftX = Math.round(t * 14);
      const lvx0 = cx + 42 + laneShiftX;
      const lvx1 = cx + 54 + laneShiftX;

      this.fillVoxelBox(
        lvx0,
        Math.max(baseVY, lvy - 1),
        lvz - 1,
        lvx1,
        lvy,
        lvz + 1,
        MAT.RAMP_ORANGE,
      );
      // Neon cyan & steel side safety curbs along the loop
      this.setVoxel(lvx0, Math.min(CHUNK_Y - 2, lvy + 1), lvz, MAT.NEON_CYAN);
      this.setVoxel(lvx1, Math.min(CHUNK_Y - 2, lvy + 1), lvz, MAT.NEON_CYAN);
    }
    // Support stanchions for the loop-de-loop
    this.fillVoxelBox(cx + 41, baseVY, loopCenterZ + loopRadius - 2, cx + 43, loopCenterY + 6, loopCenterZ + loopRadius + 2, MAT.STEEL);
    this.fillVoxelBox(cx + 67, baseVY, loopCenterZ - loopRadius - 2, cx + 69, loopCenterY + 6, loopCenterZ - loopRadius + 2, MAT.STEEL);

    // 3. VERTICAL HALF-PIPE near starting runway (West Lane: cx - 84 .. cx - 40, cz + 72 .. cz + 116)
    const hpCenterX = cx - 62;
    const hpZ0 = cz + 72;
    const hpZ1 = cz + 116;
    const hpFlatHalfW = 6;
    const hpCurveR = 14;
    for (let dx = -(hpFlatHalfW + hpCurveR); dx <= hpFlatHalfW + hpCurveR; dx++) {
      const absDx = Math.abs(dx);
      let wallH = 1;
      if (absDx > hpFlatHalfW) {
        const u = Math.min(1, (absDx - hpFlatHalfW) / hpCurveR);
        wallH = 1 + Math.round((1 - Math.sqrt(Math.max(0, 1 - u * u))) * hpCurveR);
      }
      const topY = baseVY + wallH;
      const mat =
        absDx >= hpFlatHalfW + hpCurveR - 1
          ? MAT.HAZARD_YELLOW
          : absDx > hpFlatHalfW
            ? MAT.RAMP_ORANGE
            : MAT.CONCRETE;
      this.fillVoxelBox(hpCenterX + dx, baseVY, hpZ0, hpCenterX + dx, topY, hpZ1, mat);
    }
    // Half-pipe end-coping platforms
    this.fillVoxelBox(hpCenterX - (hpFlatHalfW + hpCurveR) - 3, baseVY, hpZ0, hpCenterX - (hpFlatHalfW + hpCurveR) - 1, baseVY + hpCurveR + 1, hpZ1, MAT.STEEL);
    this.fillVoxelBox(hpCenterX + (hpFlatHalfW + hpCurveR) + 1, baseVY, hpZ0, hpCenterX + (hpFlatHalfW + hpCurveR) + 3, baseVY + hpCurveR + 1, hpZ1, MAT.STEEL);

    // 4. STEPPED SUSPENSION TEST STAIRS (cx + 26 .. cx + 38, cz + 16 .. cz + 56)
    const stairX0 = cx + 26;
    const stairX1 = cx + 38;
    const stairStartZ = cz + 16;
    const totalSteps = 8;
    const stepDepth = 2;
    for (let step = 0; step < totalSteps; step++) {
      const stepH = baseVY + 1 + Math.floor(step * 0.75);
      const zA = stairStartZ + step * stepDepth;
      const zB = zA + stepDepth - 1;
      const stepMat = step % 2 === 0 ? MAT.CONCRETE : MAT.HAZARD_YELLOW;
      this.fillVoxelBox(stairX0, baseVY, zA, stairX1, stepH, zB, stepMat);
      // Descending side
      const zDescA = stairStartZ + (totalSteps * 2 - 1 - step) * stepDepth;
      const zDescB = zDescA + stepDepth - 1;
      this.fillVoxelBox(stairX0, baseVY, zDescA, stairX1, stepH, zDescB, stepMat);
    }

    // 5. OUTPOST BUILDINGS & EXPLOSIVE BARREL STASHES
    this.stampHollowBuilding(cx + 140, cz - 180, 28, 28, 16, MAT.BRICK, MAT.STEEL);
    this.stampHollowBuilding(cx + 210, cz - 180, 28, 28, 18, MAT.CONCRETE, MAT.STEEL);
    this.stampHollowBuilding(cx + 140, cz - 110, 28, 28, 16, MAT.BRICK, MAT.CONCRETE);
    this.stampHollowBuilding(cx + 210, cz - 110, 30, 30, 20, MAT.BRICK, MAT.STEEL);

    this.fillVoxelBox(cx + 180, baseVY, cz - 140, cx + 196, bY + 20, cz - 124, MAT.C4_EXPLOSIVE);

    // Spawn Explosive Barrel Stashes near stunt ramps, obstacle stairs, half-pipe, and outposts
    this.stampExplosiveBarrelStash(cx + 22, cz + 68, 4, 'stunt_ramp_east');
    this.stampExplosiveBarrelStash(cx - 22, cz + 68, 4, 'stunt_ramp_west');
    this.stampExplosiveBarrelStash(cx + 38, cz + 78, 3, 'loop_entrance');
    this.stampExplosiveBarrelStash(cx - 36, cz + 66, 3, 'halfpipe_south');
    this.stampExplosiveBarrelStash(cx + 134, cz - 145, 4, 'outpost_west');
    this.stampExplosiveBarrelStash(cx + 176, cz - 136, 4, 'outpost_center');

    for (let s = 0; s < 36; s++) {
      const h = baseVY + Math.floor(s / 4.5);
      this.fillVoxelBox(cx + 140 + s, baseVY, cz + 180, cx + 140 + s, h, cz + 204, MAT.CANYON_ORANGE);
    }

    // West Marina Dock alongside the concrete boat slipway
    this.fillVoxelBox(cx - 142, baseVY - 1, cz + 4, cx - 102, baseVY, cz + 18, MAT.WOOD);
    this.stampHollowBuilding(cx - 300, cz - 230, 32, 32, 18, MAT.BRICK, MAT.STEEL);

    // 6. Starting Stunt Park Prefabs
    // East side practice kicker ramp (placed clear of the Grand Cave Entrance Portal at cx+72)
    if (PREBUILT_OBJECTS[0]) {
      this.stampObjectPrefab(PREBUILT_OBJECTS[0], cx + 32, baseVY + 1, cz - 28, 0);
    }
    // Stunt Ring Arch Gate framing the runway approach
    if (PREBUILT_OBJECTS[3]) {
      this.stampObjectPrefab(PREBUILT_OBJECTS[3], cx, baseVY + 1, cz + 64, 0);
    }
    // Giant 6-Pin Explosive Bowling Target cluster situated right at the mega jump landing zone!
    if (PREBUILT_OBJECTS[7]) {
      this.stampObjectPrefab(PREBUILT_OBJECTS[7], cx, baseVY + 1, cz + 210, 0);
    }
  }

  private applyWorkerPayloadToChunk(
    chunk: MicroVoxelChunk,
    workerRes: ChunkMeshJobResponse,
    jobRemovals?: Map<number, number>,
  ): void {
    const _tMesh0 = typeof performance !== 'undefined' ? performance.now() : 0;

    // Discard stale surface-only worker results that finish AFTER a chunk was upgraded to full 3D or modified,
    // so stale 2D surface meshes never overwrite active 3D terrain/caves/craters!
    if (workerRes.isSurfaceOnly && (!chunk.isSurfaceOnlyTerrain || chunk.userModified)) {
      chunk.dirty = true;
      chunk.dirtyBucketMask = MAT_BUCKET_ALL_MASK;
      if (!chunk.workerPending && !chunk.inDirtyQueue) {
        chunk.inDirtyQueue = true;
        this.dirtyQueue.push(chunk);
      }
      return;
    }

    const prevLod = chunk.activeLodLevel >= 0 ? chunk.activeLodLevel : 0;

    // Fast path for deferred Phase-2 background LOD1/LOD2/LOD3 builds: upload only LOD1..3 without touching LOD0!
    if (workerRes.lod12Only) {
      const stdOpaqueMat = this.getActiveOpaqueVoxelMaterial();
      const m1Res = updateOrCreateDynamicMeshBuffer(
        chunk.meshLOD1,
        workerRes.lod1,
        stdOpaqueMat,
        this.scene,
        false,
        4096,
        chunk.boundingSphere,
      );
      chunk.meshLOD1 = m1Res.mesh;
      if (chunk.meshLOD1) chunk.meshLOD1.castShadow = true;
      chunk.lod1Quads = workerRes.lod1.mergedQuads;

      const m2Res = updateOrCreateDynamicMeshBuffer(
        chunk.meshLOD2,
        workerRes.lod2,
        stdOpaqueMat,
        this.scene,
        false,
        2048,
        chunk.boundingSphere,
      );
      chunk.meshLOD2 = m2Res.mesh;
      if (chunk.meshLOD2) chunk.meshLOD2.castShadow = false;
      chunk.lod2Quads = workerRes.lod2.mergedQuads;

      const m3Res = updateOrCreateDynamicMeshBuffer(
        chunk.meshLOD3,
        workerRes.lod3,
        stdOpaqueMat,
        this.scene,
        false,
        1024,
        chunk.boundingSphere,
      );
      chunk.meshLOD3 = m3Res.mesh;
      if (chunk.meshLOD3) chunk.meshLOD3.castShadow = false;
      chunk.lod3Quads = workerRes.lod3?.mergedQuads || 0;

      chunk.lod12Built = true;
      this.setChunkLodLevel(chunk, prevLod as 0 | 1 | 2 | 3);
      if (_tMesh0 > 0) {
        perfProfiler.recordChunkMeshing(performance.now() - _tMesh0);
      }
      return;
    }

    // Attach zero-copy worker-generated surface terrain buffers (non-SAB Transferable path)
    // or metadata (both SAB and Transferable paths) to the single VoxelWorld chunk slot!
    if (workerRes.generatedMinY !== undefined && chunk.isSurfaceOnlyTerrain && !chunk.userModified) {
      if (workerRes.generatedSurfaceVoxels) {
        chunk.voxels = workerRes.generatedSurfaceVoxels;
      }
      if (workerRes.generatedSurfaceHeightMap) {
        chunk.surfaceHeightMap = workerRes.generatedSurfaceHeightMap;
      }
      chunk.minY = workerRes.generatedMinY;
      chunk.maxY = workerRes.generatedMaxY ?? chunk.maxY;
      chunk.hasTranslucent = workerRes.generatedHasTranslucent ?? chunk.hasTranslucent;
      chunk.transMinY = workerRes.generatedTransMinY ?? chunk.transMinY;
      chunk.transMaxY = workerRes.generatedTransMaxY ?? chunk.transMaxY;
      chunk.terrainPopulated = true;
    }

    // Commit the deferred large-destruction voxel removals that were snapshotted for this worker job
    // at the EXACT same moment the new worker mesh is swapped in so visual and physics always agree!
    if (jobRemovals && jobRemovals.size > 0) {
      chunk.commitPendingRemovals(jobRemovals);
    } else if (chunk.pendingRemovals.size > 0) {
      chunk.commitPendingRemovals();
    }

    const isLod12Deferred = workerRes.lod12Deferred === true;

    // #8: Update only the rebuilt material bucket(s) in `chunk.cachedOpaqueBuckets`,
    // keeping clean material buckets untouched!
    let mergedOpaquePayload = workerRes.lod0;
    if (workerRes.lod0Buckets) {
      let hasAllCachedBuckets = true;
      for (let b = 0; b < 3; b++) {
        const bucketRes = workerRes.lod0Buckets[b];
        if (bucketRes !== null) {
          chunk.cachedOpaqueBuckets[b] = bucketRes;
        }
        if (chunk.cachedOpaqueBuckets[b] === null) {
          hasAllCachedBuckets = false;
        }
      }
      // If this was a partial material-bucket rebuild and all 3 buckets are populated, merge the 3 cached material buckets
      if ((workerRes.dirtyBucketMask & 0b0111) !== 0b0111 && hasAllCachedBuckets) {
        mergedOpaquePayload = mergeOpaqueBucketPayloads(chunk.cachedOpaqueBuckets);
      }
    }

    const transRawFaces = workerRes.transSkipped
      ? chunk.transMesh?.userData?.rawFaces || 0
      : workerRes.transLod0?.rawFaces || 0;
    const transMergedQuads = workerRes.transSkipped
      ? chunk.transMesh?.userData?.mergedQuads || 0
      : workerRes.transLod0?.mergedQuads || 0;

    chunk.rawFaces = mergedOpaquePayload.rawFaces + transRawFaces;
    chunk.mergedQuads = mergedOpaquePayload.mergedQuads + transMergedQuads;

    // #1: Update existing / pooled GPU BufferAttributes in-place via setDrawRange(0, newIndexCount)!
    if ((workerRes.dirtyBucketMask & 0b0111) !== 0) {
      const activeOpaqueMat = chunk.isBloomMaterialAttached && chunk.mesh
        ? (chunk.mesh.material as THREE.Material)
        : this.getActiveOpaqueVoxelMaterial();
      const lod0Cap = workerRes.isSurfaceOnly ? 8192 : 16384;
      const m0Res = updateOrCreateDynamicMeshBuffer(
        chunk.mesh,
        mergedOpaquePayload,
        activeOpaqueMat,
        this.scene,
        false,
        lod0Cap,
        chunk.boundingSphere,
      );
      chunk.mesh = m0Res.mesh;
      if (chunk.mesh) chunk.mesh.castShadow = true;
      if (m0Res.updatedInPlace) chunk.inPlaceBufferUpdates++;

      if (!isLod12Deferred) {
        const stdOpaqueMat = this.getActiveOpaqueVoxelMaterial();
        const m1Res = updateOrCreateDynamicMeshBuffer(
          chunk.meshLOD1,
          workerRes.lod1,
          stdOpaqueMat,
          this.scene,
          false,
          4096,
          chunk.boundingSphere,
        );
        chunk.meshLOD1 = m1Res.mesh;
        if (chunk.meshLOD1) chunk.meshLOD1.castShadow = true;
        chunk.lod1Quads = workerRes.lod1.mergedQuads;

        const m2Res = updateOrCreateDynamicMeshBuffer(
          chunk.meshLOD2,
          workerRes.lod2,
          stdOpaqueMat,
          this.scene,
          false,
          2048,
          chunk.boundingSphere,
        );
        chunk.meshLOD2 = m2Res.mesh;
        if (chunk.meshLOD2) chunk.meshLOD2.castShadow = false;
        chunk.lod2Quads = workerRes.lod2.mergedQuads;

        const m3Res = updateOrCreateDynamicMeshBuffer(
          chunk.meshLOD3,
          workerRes.lod3,
          stdOpaqueMat,
          this.scene,
          false,
          1024,
          chunk.boundingSphere,
        );
        chunk.meshLOD3 = m3Res.mesh;
        if (chunk.meshLOD3) chunk.meshLOD3.castShadow = false;
        chunk.lod3Quads = workerRes.lod3?.mergedQuads || 0;
      }
    }

    if (!workerRes.transSkipped) {
      const tm0Res = updateOrCreateDynamicMeshBuffer(
        chunk.transMesh,
        workerRes.transLod0,
        this.sharedTranslucentMaterial,
        this.scene,
        true,
        8192,
        chunk.boundingSphere,
      );
      chunk.transMesh = tm0Res.mesh;
      if (chunk.transMesh) {
        chunk.transMesh.userData.rawFaces = workerRes.transLod0?.rawFaces || 0;
        chunk.transMesh.userData.mergedQuads = workerRes.transLod0?.mergedQuads || 0;
      }
      if (tm0Res.updatedInPlace) chunk.inPlaceBufferUpdates++;
    }

    chunk.lod12Built = !isLod12Deferred;
    chunk.isSurfaceOnlyMesh = Boolean(workerRes.isSurfaceOnly);

    // If progressive water flow placed water voxels into this chunk while the worker was running,
    // immediately sync the live translucent water mesh so worker snapshots never overwrite flowing water!
    if (chunk.hasTranslucent && chunk.userModified) {
      this.rebuildChunkWaterOnly(chunk);
    }

    this.setChunkLodLevel(chunk, prevLod as 0 | 1 | 2 | 3);
    chunk.hasBuiltMesh = true;
    if (chunk.state === ChunkState.QUEUED || chunk.state === ChunkState.GENERATING || chunk.state === ChunkState.WIREFRAME_READY) {
      if (chunk.wireMesh) {
        chunk.state = ChunkState.MESH_READY;
        if (!this.animatingChunks.includes(chunk)) {
          this.attachBloomFillMaterial(chunk);
          const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          if (!chunk.animStartTime || chunk.animStartTime < nowMs - 10000) {
            chunk.animStartTime = nowMs + 120;
          }
          this.animatingChunks.push(chunk);
        }
      } else if (!chunk.isBloomMaterialAttached) {
        chunk.state = ChunkState.COMPLETE;
      } else {
        chunk.state = ChunkState.MESH_READY;
      }
    }
    this.flushPendingTerrainEntitiesForChunk(chunk);
    if (chunk.userModified) {
      this.captureModifiedChunkStamp(chunk);
    }
    if (_tMesh0 > 0) {
      perfProfiler.recordChunkMeshing(performance.now() - _tMesh0);
    }
  }

  /**
   * Captures a compact 16x16 (~768-byte) surface height & material stamp of a player-modified chunk
   * so craters, trenches, and player-built structures persist across every distant mega-tile LOD ring.
   */
  private captureModifiedChunkStamp(chunk: MicroVoxelChunk): void {
    if (!this.horizonManager) return;
    const heights = new Uint16Array(256);
    const mats = new Uint8Array(256);
    const isFull3D =
      !chunk.isSurfaceOnlyTerrain &&
      chunk.voxels.length === CHUNK_X * CHUNK_Y * CHUNK_Z;
    const vox = chunk.voxels;
    const hMap = chunk.surfaceHeightMap;
    const scanMaxY = Math.min(CHUNK_Y - 1, Math.max(chunk.maxY, WATER_VY + 4));

    for (let sz = 0; sz < 16; sz++) {
      const lz = (sz << 2) + 2;
      const rowOff = sz << 4;
      for (let sx = 0; sx < 16; sx++) {
        const lx = (sx << 2) + 2;
        const idx = rowOff + sx;
        if (isFull3D) {
          let topVY = 0;
          let topMat: number = MAT.AIR;
          const colBase = lx + CHUNK_X * CHUNK_Y * lz;
          for (let vy = scanMaxY; vy >= 0; vy--) {
            const m = vox[colBase + CHUNK_X * vy];
            if (m !== MAT.AIR && m !== MAT.WATER_VOX) {
              topVY = vy;
              topMat = m;
              break;
            }
          }
          heights[idx] = topVY;
          mats[idx] = topMat;
        } else {
          const topVY = hMap[lx + CHUNK_X * lz];
          heights[idx] = topVY;
          mats[idx] =
            topVY > 0
              ? vox[lx + CHUNK_X * (SURFACE_CHUNK_Y - 1 + SURFACE_CHUNK_Y * lz)]
              : MAT.AIR;
        }
      }
    }

    const stamp: ModifiedChunkSurfaceStamp = {
      cx: chunk.cx,
      cz: chunk.cz,
      heights16: heights,
      mats16: mats,
      version: chunk.version,
    };
    this.horizonManager.setModifiedChunkStamp(stamp);
  }

  /**
   * Synchronous main-thread chunk mesh rebuild used for small destruction (radius <= 2)
   * so visual and physics stay immediately consistent on the same frame.
   */
  public rebuildChunkSync(chunk: MicroVoxelChunk, lod0Only = false): void {
    if (chunk.pendingRemovals.size > 0) {
      chunk.commitPendingRemovals();
    }
    if (chunk.inDirtyQueue) {
      chunk.inDirtyQueue = false;
      const idx = this.dirtyQueue.indexOf(chunk);
      if (idx >= 0) {
        this.dirtyQueue.splice(idx, 1);
      }
    }
    this.rebuildChunk(chunk, lod0Only);
  }

  rebuildChunkAsync(
    chunk: MicroVoxelChunk,
    forceLod0Only?: boolean,
    priorityScore = 100,
    lod12Only = false,
  ): void {
    const hasPendingDestruction = chunk.pendingRemovals.size > 0;
    if (chunk.isSurfaceOnlyTerrain && (hasPendingDestruction || chunk.userModified)) {
      this.ensureFullChunkTerrain(chunk);
    }
    if (chunk.workerPending) {
      if (!lod12Only) {
        chunk.dirty = true;
      }
      return;
    }
    if (!lod12Only) {
      chunk.dirty = false;
    }
    chunk.workerPending = true;
    const jobVersion = chunk.version;
    const isSurfOnlyJob =
      chunk.isSurfaceOnlyTerrain &&
      !chunk.userModified &&
      !hasPendingDestruction &&
      this.worldGenMode !== 'CUSTOM_GLB_MAP';
    const effectiveLod12Only = lod12Only && !hasPendingDestruction && chunk.hasBuiltMesh;
    const jobRemovals = hasPendingDestruction
      ? new Map(chunk.pendingRemovals)
      : undefined;
    if (!effectiveLod12Only && (hasPendingDestruction || chunk.userModified)) {
      chunk.cachedOpaqueBuckets = [null, null, null];
    }
    const missingCachedBucket =
      !chunk.cachedOpaqueBuckets[0] ||
      !chunk.cachedOpaqueBuckets[1] ||
      !chunk.cachedOpaqueBuckets[2];
    const requestedBucketMask = effectiveLod12Only
      ? 0b0111
      : hasPendingDestruction ||
          chunk.userModified ||
          !chunk.hasBuiltMesh ||
          chunk.isSurfaceOnlyMesh ||
          missingCachedBucket ||
          chunk.dirtyBucketMask === 0
        ? MAT_BUCKET_ALL_MASK
        : chunk.dirtyBucketMask;
    if (!effectiveLod12Only) {
      chunk.dirtyBucketMask = 0;
    }

    // Defer LOD1/LOD2/LOD3 generation for full 3D chunks until LOD0 ready; surface-only chunks build cheap LOD1/2/3 directly!
    const lod0Only = effectiveLod12Only
      ? false
      : isSurfOnlyJob ||
        (forceLod0Only !== undefined
          ? forceLod0Only
          : !this.areAllChunksLod0MeshReady());

    const generateInWorker =
      isSurfOnlyJob &&
      !effectiveLod12Only &&
      !chunk.terrainPopulated &&
      this.canUseWorkerProceduralSurfaceGen();
    const useSharedSlab =
      isSurfOnlyJob &&
      chunk.isSurfaceOnlyTerrain &&
      chunk.voxels.length === CHUNK_X * SURFACE_CHUNK_Y * CHUNK_Z &&
      this.voxelWorld.usesSharedSurfaceSlab &&
      this.workerPool.hasSharedSurfaceSlab &&
      chunk.slotIndex < this.voxelWorld.surfaceSlabCapacity;

    this.workerPool
      .enqueueChunkJob(
        chunk.cx,
        chunk.cz,
        chunk.minY,
        chunk.maxY,
        chunk.originX,
        chunk.originZ,
        chunk.voxels,
        chunk.hasTranslucent,
        chunk.transMinY,
        chunk.transMaxY,
        chunk.customColors,
        requestedBucketMask,
        lod0Only,
        isSurfOnlyJob ? undefined : this.extractNeighborBoundarySlices(chunk),
        jobRemovals,
        isSurfOnlyJob,
        isSurfOnlyJob && !generateInWorker ? chunk.surfaceHeightMap : undefined,
        isSurfOnlyJob && !generateInWorker ? this.extractNeighborSurfaceHeights(chunk) : undefined,
        {
          priorityScore: hasPendingDestruction ? -500 : priorityScore,
          slotIndex: chunk.slotIndex,
          useSharedSlab,
          generateSurfaceTerrain: generateInWorker,
          worldGenMode: generateInWorker ? this.worldGenMode : undefined,
          flatBaseplateMat: generateInWorker ? this.flatBaseplateMat : undefined,
          buildSurfaceLods: isSurfOnlyJob && !this._horizonActive,
          lod12Only: effectiveLod12Only,
        },
      )
      .then((workerRes) => {
        chunk.workerPending = false;
        if (this.chunkMap.get(chunk.key) !== chunk) {
          return;
        }
        if (hasPendingDestruction || chunk.pendingRemovals.size > 0) {
          // Route destruction commits to the high-priority front of the budgeted commit queue
          // so explosions stay snappy without spiking a single frame when many chunks finish together!
          this.completedWorkerQueue.unshift({ chunk, res: workerRes, jobRemovals });
        } else {
          this.completedWorkerQueue.push({ chunk, res: workerRes });
        }
        if (chunk.dirty || chunk.version !== jobVersion || chunk.pendingRemovals.size > 0) {
          chunk.dirty = true;
          chunk.dirtyBucketMask = MAT_BUCKET_ALL_MASK;
          if (chunk.pendingRemovals.size > 0 || chunk.userModified) {
            this.rebuildChunkAsync(chunk, true, -250);
          } else if (!chunk.inDirtyQueue) {
            chunk.inDirtyQueue = true;
            this.dirtyQueue.push(chunk);
          }
        }
      })
      .catch(() => {
        chunk.workerPending = false;
        chunk.dirtyBucketMask |= requestedBucketMask;
        if (!chunk.hasBuiltMesh) {
          chunk.dirty = true;
        }
        if (chunk.dirty && !chunk.inDirtyQueue) {
          chunk.inDirtyQueue = true;
          this.dirtyQueue.push(chunk);
        }
      });
  }

  rebuildChunk(chunk: MicroVoxelChunk, _lod0Only = false): void {
    const _tMesh0 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (chunk.isSurfaceOnlyTerrain) {
      this.ensureFullChunkTerrain(chunk);
    }
    if (chunk.pendingRemovals.size > 0) {
      chunk.commitPendingRemovals();
    }
    const missingCachedBucket =
      !chunk.cachedOpaqueBuckets[0] ||
      !chunk.cachedOpaqueBuckets[1] ||
      !chunk.cachedOpaqueBuckets[2];
    const requestedMask =
      !chunk.hasBuiltMesh ||
      chunk.isSurfaceOnlyMesh ||
      missingCachedBucket ||
      chunk.dirtyBucketMask === 0
        ? MAT_BUCKET_ALL_MASK
        : chunk.dirtyBucketMask;
    chunk.dirty = false;
    chunk.dirtyBucketMask = 0;
    chunk.version++;
    chunk.lod12Built = false;

    const vox = chunk.voxels;
    const sampleVoxel = (lx: number, ly: number, lz: number) =>
      vox[lx + CHUNK_X * (ly + CHUNK_Y * lz)];
    const sampleBoundaryVoxel = (lx: number, ly: number, lz: number) =>
      this.sampleChunkBoundaryVoxel(chunk, lx, ly, lz);

    // #8: Only re-mesh the dirty material bucket(s) and reuse cached buckets for untouched materials!
    // CRITICAL: useSubarray MUST be `false` so each cached bucket owns its own independent cloned typed arrays
    // rather than aliasing the shared static `BUF_POS` / `BUF_COL` / `BUF_IDX` buffers across buckets 0, 1, and 2!
    const bucketIds: [0, 1, 2] = [
      MAT_BUCKET_SOIL,
      MAT_BUCKET_ROCK,
      MAT_BUCKET_STRUCTURAL,
    ];
    for (let bIdx = 0; bIdx < 3; bIdx++) {
      const b = bucketIds[bIdx];
      if ((requestedMask & (1 << b)) !== 0 || !chunk.cachedOpaqueBuckets[b]) {
        chunk.cachedOpaqueBuckets[b] = greedyMeshBoundedArrays(
          CHUNK_X,
          CHUNK_Y,
          CHUNK_Z,
          chunk.minY,
          chunk.maxY,
          sampleVoxel,
          chunk.originX,
          0,
          chunk.originZ,
          VOXEL_SIZE,
          VOXEL_SIZE,
          'OPAQUE_ONLY',
          chunk.customColors,
          false,
          b,
          sampleBoundaryVoxel,
        );
      }
    }

    const mergedOpaque = mergeOpaqueBucketPayloads(chunk.cachedOpaqueBuckets);
    const transDirty = (requestedMask & (1 << MAT_BUCKET_TRANSLUCENT)) !== 0;
    const transRes =
      transDirty && chunk.hasTranslucent && chunk.transMaxY >= chunk.transMinY
        ? greedyMeshBoundedArrays(
            CHUNK_X,
            CHUNK_Y,
            CHUNK_Z,
            chunk.transMinY,
            chunk.transMaxY,
            sampleVoxel,
            chunk.originX,
            0,
            chunk.originZ,
            VOXEL_SIZE,
            VOXEL_SIZE,
            'TRANSLUCENT_ONLY',
            undefined,
            false,
          )
        : null;

    const prevTransRaw = chunk.transMesh?.userData?.rawFaces || 0;
    const prevTransQuads = chunk.transMesh?.userData?.mergedQuads || 0;
    chunk.rawFaces =
      mergedOpaque.rawFaces + (transDirty ? (transRes ? transRes.rawFaces : 0) : prevTransRaw);
    chunk.mergedQuads =
      mergedOpaque.mergedQuads + (transDirty ? (transRes ? transRes.mergedQuads : 0) : prevTransQuads);

    // #1: Update existing GPU BufferAttributes in-place via setDrawRange — never recreate BufferGeometry!
    const m0Res = updateOrCreateDynamicMeshBuffer(
      chunk.mesh,
      mergedOpaque,
      this.getActiveOpaqueVoxelMaterial(),
      this.scene,
      false,
      24576,
      chunk.boundingSphere,
    );
    chunk.mesh = m0Res.mesh;
    if (m0Res.updatedInPlace) chunk.inPlaceBufferUpdates++;
    if (chunk.mesh && chunk.activeLodLevel < 0) {
      chunk.activeLodLevel = 0;
    }

    if (transDirty) {
      const tm0Res = updateOrCreateDynamicMeshBuffer(
        chunk.transMesh,
        transRes,
        this.sharedTranslucentMaterial,
        this.scene,
        true,
        8192,
        chunk.boundingSphere,
      );
      chunk.transMesh = tm0Res.mesh;
      if (chunk.transMesh) {
        chunk.transMesh.userData.rawFaces = transRes ? transRes.rawFaces : 0;
        chunk.transMesh.userData.mergedQuads = transRes ? transRes.mergedQuads : 0;
        if (chunk.activeLodLevel < 0) chunk.activeLodLevel = 0;
      }
      if (tm0Res.updatedInPlace) chunk.inPlaceBufferUpdates++;
    }

    // Invalidate stale LOD1/LOD2/LOD3 meshes when rebuilding synchronously on main thread so setChunkLodLevel
    // always displays the fresh LOD0 mesh until a background worker regenerates LOD1/LOD2/LOD3
    if (chunk.meshLOD1) {
      chunk.meshLOD1.visible = false;
      chunk.meshLOD1.userData.hasActiveVerts = false;
    }
    if (chunk.meshLOD2) {
      chunk.meshLOD2.visible = false;
      chunk.meshLOD2.userData.hasActiveVerts = false;
    }
    if (chunk.meshLOD3) {
      chunk.meshLOD3.visible = false;
      chunk.meshLOD3.userData.hasActiveVerts = false;
    }

    this.setChunkLodLevel(
      chunk,
      (chunk.activeLodLevel >= 0 ? chunk.activeLodLevel : 0) as 0 | 1 | 2 | 3,
    );
    chunk.hasBuiltMesh = true;
    chunk.isSurfaceOnlyMesh = false;
    if (chunk.state === ChunkState.QUEUED || chunk.state === ChunkState.GENERATING || chunk.state === ChunkState.WIREFRAME_READY) {
      chunk.state = ChunkState.MESH_READY;
      if (chunk.wireMesh && !this.animatingChunks.includes(chunk)) {
        this.attachBloomFillMaterial(chunk);
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (!chunk.animStartTime || chunk.animStartTime < nowMs - 10000) {
          chunk.animStartTime = nowMs + 120;
        }
        this.animatingChunks.push(chunk);
      }
    }
    this.flushPendingTerrainEntitiesForChunk(chunk);
    if (chunk.userModified) {
      this.captureModifiedChunkStamp(chunk);
    }
    if (_tMesh0 > 0) {
      perfProfiler.recordChunkMeshing(performance.now() - _tMesh0);
    }
  }

  /**
   * Builds ONLY the top visible surface mesh (2D greedy-merged top faces + exposed vertical cliff steps + flat water surface),
   * completely skipping all 80 underground Y-layers, subterranean caves, and worker serialization overhead!
   */
  public rebuildChunkTopSurfaceOnly(chunk: MicroVoxelChunk): void {
    const _tMesh0 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!chunk.terrainPopulated) {
      this.populateChunkTopSurfaceOnly(chunk);
    }
    chunk.dirty = false;
    chunk.dirtyBucketMask = 0;
    chunk.version++;
    chunk.lod12Built = !this.workerPool.hasDedicatedWorkers;
    chunk.cachedOpaqueBuckets = [null, null, null];

    const getBoundarySurfVY = (lx: number, lz: number): number => {
      let ncx = chunk.cx;
      let ncz = chunk.cz;
      let nlx = lx;
      let nlz = lz;
      if (nlx < 0) {
        ncx--;
        nlx += CHUNK_X;
      } else if (nlx >= CHUNK_X) {
        ncx++;
        nlx -= CHUNK_X;
      }
      if (nlz < 0) {
        ncz--;
        nlz += CHUNK_Z;
      } else if (nlz >= CHUNK_Z) {
        ncz++;
        nlz -= CHUNK_Z;
      }
      const neighbor = this.chunkMap.get(`${ncx},${ncz}`);
      // If the neighboring chunk doesn't exist yet (not generated),
      // DON'T cull the face — return 0 so the entire boundary wall is rendered conservatively!
      if (!neighbor || !neighbor.terrainPopulated) {
        return 0;
      }
      return this.getNeighborContinuousSolidTopVY(neighbor, nlx, nlz);
    };

    const opaquePayload = greedyMeshTopSurfaceOnly(
      CHUNK_X,
      CHUNK_Y,
      CHUNK_Z,
      chunk.surfaceHeightMap,
      chunk.voxels,
      chunk.originX,
      0,
      chunk.originZ,
      VOXEL_SIZE,
      chunk.customColors,
      true,
      getBoundarySurfVY,
    );

    const m0Res = updateOrCreateDynamicMeshBuffer(
      chunk.mesh,
      opaquePayload,
      this.getActiveOpaqueVoxelMaterial(),
      this.scene,
      false,
      8192,
      chunk.boundingSphere,
    );
    chunk.mesh = m0Res.mesh;
    if (m0Res.updatedInPlace) chunk.inPlaceBufferUpdates++;
    if (chunk.mesh && chunk.activeLodLevel < 0) {
      chunk.activeLodLevel = 0;
    }

    let transRaw = 0;
    let transQuads = 0;
    if (chunk.hasTranslucent) {
      const transPayload = greedyMeshWaterTopSurfaceOnly(
        CHUNK_X,
        CHUNK_Y,
        CHUNK_Z,
        WATER_VY,
        chunk.voxels,
        chunk.originX,
        0,
        chunk.originZ,
        VOXEL_SIZE,
        true,
        undefined,
        chunk.surfaceHeightMap,
      );
      transRaw = transPayload.rawFaces;
      transQuads = transPayload.mergedQuads;
      const tm0Res = updateOrCreateDynamicMeshBuffer(
        chunk.transMesh,
        transPayload,
        this.sharedTranslucentMaterial,
        this.scene,
        true,
        2048,
        chunk.boundingSphere,
      );
      chunk.transMesh = tm0Res.mesh;
      if (chunk.transMesh) {
        chunk.transMesh.userData.rawFaces = transRaw;
        chunk.transMesh.userData.mergedQuads = transQuads;
      }
    } else if (chunk.transMesh) {
      chunk.transMesh.visible = false;
      chunk.transMesh.userData.hasActiveVerts = false;
    }

    chunk.rawFaces = opaquePayload.rawFaces + transRaw;
    chunk.mergedQuads = opaquePayload.mergedQuads + transQuads;

    if (chunk.meshLOD1) {
      chunk.meshLOD1.visible = false;
      chunk.meshLOD1.userData.hasActiveVerts = false;
    }
    if (chunk.meshLOD2) {
      chunk.meshLOD2.visible = false;
      chunk.meshLOD2.userData.hasActiveVerts = false;
    }
    if (chunk.meshLOD3) {
      chunk.meshLOD3.visible = false;
      chunk.meshLOD3.userData.hasActiveVerts = false;
    }

    this.setChunkLodLevel(chunk, 0);
    chunk.hasBuiltMesh = true;
    chunk.isSurfaceOnlyMesh = true;
    if (chunk.isBloomMaterialAttached || chunk.wireMesh) {
      chunk.state = ChunkState.MESH_READY;
      if (chunk.wireMesh && !this.animatingChunks.includes(chunk)) {
        this.attachBloomFillMaterial(chunk);
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (!chunk.animStartTime || chunk.animStartTime < nowMs - 10000) {
          chunk.animStartTime = nowMs + 120;
        }
        this.animatingChunks.push(chunk);
      }
    } else {
      chunk.state = ChunkState.COMPLETE;
    }
    if (_tMesh0 > 0) {
      perfProfiler.recordChunkMeshing(performance.now() - _tMesh0);
    }
  }

  private setChunkLodLevel(chunk: MicroVoxelChunk, level: -1 | 0 | 1 | 2 | 3): number {
    if (!chunk.mesh && !chunk.transMesh) return 0;

    if (level === -1) {
      chunk.activeLodLevel = -1;
      this.voxelWorld.setChunkVisible(chunk.slotIndex, false);
      if (chunk.mesh) chunk.mesh.visible = false;
      if (chunk.meshLOD1) chunk.meshLOD1.visible = false;
      if (chunk.meshLOD2) chunk.meshLOD2.visible = false;
      if (chunk.meshLOD3) chunk.meshLOD3.visible = false;
      if (chunk.transMesh) chunk.transMesh.visible = false;
      if (chunk.transMeshLOD1) chunk.transMeshLOD1.visible = false;
      if (chunk.transMeshLOD2) chunk.transMeshLOD2.visible = false;
      return 0;
    }

    const hasLod0 = Boolean(chunk.mesh && chunk.mesh.userData.hasActiveVerts !== false);
    const hasLod1 = Boolean(chunk.meshLOD1 && chunk.meshLOD1.userData.hasActiveVerts !== false);
    const hasLod2 = Boolean(chunk.meshLOD2 && chunk.meshLOD2.userData.hasActiveVerts !== false);
    const hasLod3 = Boolean(chunk.meshLOD3 && chunk.meshLOD3.userData.hasActiveVerts !== false);

    let effectiveLevel: 0 | 1 | 2 | 3 = 0;
    if (level === 3) {
      effectiveLevel = hasLod3 ? 3 : hasLod2 ? 2 : hasLod1 ? 1 : 0;
    } else if (level === 2) {
      effectiveLevel = hasLod2 ? 2 : hasLod1 ? 1 : 0;
    } else if (level === 1) {
      effectiveLevel = hasLod1 ? 1 : 0;
    }

    chunk.activeLodLevel = effectiveLevel;
    this.voxelWorld.setChunkVisible(chunk.slotIndex, true);
    if (chunk.mesh) chunk.mesh.visible = effectiveLevel === 0 && hasLod0;
    if (chunk.meshLOD1) chunk.meshLOD1.visible = effectiveLevel === 1 && hasLod1;
    if (chunk.meshLOD2) chunk.meshLOD2.visible = effectiveLevel === 2 && hasLod2;
    if (chunk.meshLOD3) chunk.meshLOD3.visible = effectiveLevel === 3 && hasLod3;

    if (chunk.transMesh) {
      const hasTransLod0 = chunk.transMesh.userData.hasActiveVerts !== false;
      chunk.transMesh.visible = hasTransLod0;
      if (chunk.transMeshLOD1) chunk.transMeshLOD1.visible = false;
      if (chunk.transMeshLOD2) chunk.transMeshLOD2.visible = false;
    }

    if (effectiveLevel === 0) return chunk.mergedQuads;
    if (effectiveLevel === 1) return chunk.lod1Quads || chunk.mergedQuads;
    if (effectiveLevel === 2) return chunk.lod2Quads || chunk.mergedQuads;
    return chunk.lod3Quads || chunk.lod2Quads || chunk.mergedQuads;
  }

  evaluateCaveAtmosphereAt(
    wx: number,
    wy: number,
    wz: number,
  ): { surfY: number; hasOverheadRoof: boolean; caveFactor: number } {
    if (this.worldGenMode === 'FLAT_BASEPLATE') {
      return { surfY: (10 + SUBTERRANEAN_DEPTH_VY) * VOXEL_SIZE, hasOverheadRoof: false, caveFactor: 0 };
    }
    const { vx, vy, vz } = this.worldToVoxelCoords(wx, wy, wz);
    const col = evaluateBiomeColumn(
      wx,
      wz,
      vx,
      vz,
      this.worldGenMode,
      this.flatBaseplateMat,
      this.heightmapData,
    );
    const surfVY = col.surfVY;
    const surfY = (surfVY + 1) * VOXEL_SIZE;

    let hasOverheadRoof = false;
    const scanStart = Math.max(1, vy + 2);
    const scanEnd = Math.min(CHUNK_Y - 2, surfVY + 4);
    for (let checkY = scanStart; checkY <= scanEnd; checkY += 2) {
      const m = this.getVoxel(vx, checkY, vz);
      if (m !== MAT.AIR && m !== MAT.WATER_VOX && m !== MAT.GLASS_SOLID) {
        hasOverheadRoof = true;
        break;
      }
    }

    const subCaveFactor = computeCaveAtmosphereFactor(wy, surfY, hasOverheadRoof);
    const deepOcean = this.getDeepOceanFactor(wx, wz);
    const underwaterDepth =
      wy < WATER_LEVEL && isWaterBasinArea(wx, wz, this.worldGenMode)
        ? Math.min(1, (WATER_LEVEL - wy) / 9.0)
        : 0;
    const abyssOceanDarkness = Math.min(
      0.96,
      deepOcean * 0.92 + underwaterDepth * (0.42 + deepOcean * 0.54),
    );
    const caveFactor = Math.max(subCaveFactor, abyssOceanDarkness);
    return { surfY, hasOverheadRoof, caveFactor };
  }

  probeGroundBelow(
    wx: number,
    wy: number,
    wz: number,
    maxStepUp = 0.5,
  ): { y: number; mat: number } {
    const vx = Math.floor(wx / VOXEL_SIZE) + TOTAL_VX / 2;
    const vz = Math.floor(wz / VOXEL_SIZE) + TOTAL_VZ / 2;
    const cx = vx >> 6;
    const cz = vz >> 6;
    const chunk = this.getOrCreateChunkTopSurfaceOnly(cx, cz, false);
    const lx = vx & 63;
    const lz = vz & 63;
    const maxAllowedSurfY = wy + maxStepUp;

    // If this chunk is currently a Top-Surface-Only chunk (only top 3 crust voxels populated, hollow below),
    // resolve against its authoritative surfaceHeightMap while respecting maxAllowedSurfY so the player
    // or vehicle can never fall through the hollow underside of a surface-only chunk.
    if (chunk.isSurfaceOnlyTerrain && !chunk.userModified) {
      const surfVY = chunk.surfaceHeightMap[lx + (lz << 6)];
      const surfY = Math.round((surfVY + 1) * VOXEL_SIZE * 100) / 100;
      const topMat = chunk.sampleSurfaceCompactVoxel(lx, surfVY, lz) || MAT.GRASS;
      if (surfY <= maxAllowedSurfY + 0.001) {
        return { y: surfY, mat: topMat };
      }
      if (wy >= surfY - 2.5) {
        return {
          y: Math.round(maxAllowedSurfY * 100) / 100,
          mat: topMat,
        };
      }
      return { y: 0.25, mat: MAT.ROCK };
    }

    const startVY = Math.min(
      CHUNK_Y - 3,
      Math.max(1, Math.floor(maxAllowedSurfY / VOXEL_SIZE)),
    );

    for (let vy = startVY; vy >= 0; vy--) {
      const surfY = (vy + 1) * VOXEL_SIZE;
      if (surfY > maxAllowedSurfY + 0.001) {
        continue;
      }
      const mat = chunk.voxels[lx + CHUNK_X * (vy + CHUNK_Y * lz)];
      const matAbove = chunk.voxels[lx + CHUNK_X * (vy + 1 + CHUNK_Y * lz)];
      const matAbove2 = chunk.voxels[lx + CHUNK_X * (vy + 2 + CHUNK_Y * lz)];
      if (
        mat !== MAT.AIR &&
        mat !== MAT.WATER_VOX &&
        (matAbove === MAT.AIR || matAbove === MAT.WATER_VOX) &&
        (matAbove2 === MAT.AIR || matAbove2 === MAT.WATER_VOX)
      ) {
        const roundedY = Math.round(surfY * 100) / 100;
        return { y: roundedY, mat };
      }
    }

    // Fallback if `startVY` is embedded inside solid ground near the terrain surface:
    // lift up to `Math.min(fallbackSurfY, maxAllowedSurfY)` rather than dropping to y = 0.25!
    const matAtStart = chunk.voxels[lx + CHUNK_X * (startVY + CHUNK_Y * lz)];
    if (matAtStart !== MAT.AIR && matAtStart !== MAT.WATER_VOX) {
      const fallbackSurfVY = chunk.surfaceHeightMap[lx + (lz << 6)];
      const fallbackSurfY =
        Math.round((fallbackSurfVY + 1) * VOXEL_SIZE * 100) / 100;
      if (fallbackSurfVY > 0 && wy >= fallbackSurfY - 2.5) {
        return {
          y: Math.min(
            fallbackSurfY,
            Math.round(maxAllowedSurfY * 100) / 100,
          ),
          mat: matAtStart,
        };
      }
    }
    return { y: 0.25, mat: MAT.ROCK };
  }

  /**
   * Pending-removal-aware ground probe used by falling `TerrainEntity` blocks so collapsed
   * columns and blocks falling into a freshly carved crater do not stop in mid-air on
   * uncommitted `pendingRemovals` voxels while the background mesh worker is running.
   */
  probeGroundBelowForEntity(
    wx: number,
    wy: number,
    wz: number,
    maxStepUp = 0.5,
  ): { y: number; mat: number } {
    const vx = Math.floor(wx / VOXEL_SIZE) + TOTAL_VX / 2;
    const vz = Math.floor(wz / VOXEL_SIZE) + TOTAL_VZ / 2;
    const cx = vx >> 6;
    const cz = vz >> 6;
    const chunk = this.getOrCreateChunkTopSurfaceOnly(cx, cz, false);
    const lx = vx & 63;
    const lz = vz & 63;
    const maxAllowedSurfY = wy + maxStepUp;

    if (
      chunk.isSurfaceOnlyTerrain &&
      !chunk.userModified &&
      chunk.pendingRemovals.size === 0
    ) {
      return this.probeGroundBelow(wx, wy, wz, maxStepUp);
    }

    const startVY = Math.min(
      CHUNK_Y - 3,
      Math.max(1, Math.floor(maxAllowedSurfY / VOXEL_SIZE)),
    );
    const hasPending = chunk.pendingRemovals.size > 0;
    const readMat = (vy: number): number => {
      const flatIdx = lx + CHUNK_X * (vy + CHUNK_Y * lz);
      if (hasPending && chunk.pendingRemovals.has(flatIdx)) {
        return chunk.pendingRemovals.get(flatIdx) ?? MAT.AIR;
      }
      return chunk.voxels[flatIdx];
    };

    for (let vy = startVY; vy >= 0; vy--) {
      const surfY = (vy + 1) * VOXEL_SIZE;
      if (surfY > maxAllowedSurfY + 0.001) {
        continue;
      }
      const mat = readMat(vy);
      const matAbove = readMat(vy + 1);
      const matAbove2 = readMat(vy + 2);
      if (
        mat !== MAT.AIR &&
        mat !== MAT.WATER_VOX &&
        (matAbove === MAT.AIR || matAbove === MAT.WATER_VOX) &&
        (matAbove2 === MAT.AIR || matAbove2 === MAT.WATER_VOX)
      ) {
        const roundedY = Math.round(surfY * 100) / 100;
        return { y: roundedY, mat };
      }
    }

    return { y: 0.25, mat: MAT.ROCK };
  }

  public probeCeilingAbove(
    wx: number,
    wy: number,
    wz: number,
    maxDist = 0.45,
  ): { y: number; mat: number } | null {
    const vx = Math.floor(wx / VOXEL_SIZE) + TOTAL_VX / 2;
    const vz = Math.floor(wz / VOXEL_SIZE) + TOTAL_VZ / 2;
    const cx = vx >> 6;
    const cz = vz >> 6;
    const chunk = this.getOrCreateChunkTopSurfaceOnly(cx, cz, false);
    const lx = vx & 63;
    const lz = vz & 63;
    const maxAllowedY = wy + maxDist;

    if (chunk.isSurfaceOnlyTerrain && !chunk.userModified) {
      const surfVY = chunk.surfaceHeightMap[lx + (lz << 6)];
      const topMat = chunk.sampleSurfaceCompactVoxel(lx, surfVY, lz) || MAT.GRASS;
      if (topMat === MAT.AIR || topMat === MAT.WATER_VOX) {
        return null;
      }
      const bottomY = Math.round(Math.max(0, surfVY - 2) * VOXEL_SIZE * 100) / 100;
      if (bottomY >= wy - VOXEL_SIZE && bottomY <= maxAllowedY + 0.001) {
        return { y: bottomY, mat: topMat };
      }
      return null;
    }

    const surfVY = chunk.surfaceHeightMap[lx + (lz << 6)];
    const startVY = Math.max(1, Math.floor(wy / VOXEL_SIZE));
    const endVY = Math.min(
      CHUNK_Y - 1,
      Math.ceil(maxAllowedY / VOXEL_SIZE),
    );
    const zBase = lx + CHUNK_X * CHUNK_Y * lz;

    for (let vy = startVY; vy <= endVY; vy++) {
      const bottomY = vy * VOXEL_SIZE;
      if (bottomY > maxAllowedY + 0.001) {
        break;
      }
      const mat = chunk.voxels[zBase + vy * CHUNK_X];
      if (mat === MAT.AIR || mat === MAT.WATER_VOX) {
        continue;
      }
      const matBelow = chunk.voxels[zBase + (vy - 1) * CHUNK_X];
      if (
        matBelow === MAT.AIR ||
        matBelow === MAT.WATER_VOX ||
        (vy < surfVY &&
          mat !== MAT.ROCK &&
          mat !== MAT.DIRT &&
          matBelow !== mat)
      ) {
        return { y: Math.round(bottomY * 100) / 100, mat };
      }
    }

    return null;
  }

  getMaterialAtWorld(wx: number, wy: number, wz: number): number {
    const vx = Math.floor(wx / VOXEL_SIZE) + (TOTAL_VX >> 1);
    const vy = Math.floor(wy / VOXEL_SIZE);
    const vz = Math.floor(wz / VOXEL_SIZE) + (TOTAL_VZ >> 1);
    const cx = vx >> 6;
    const cz = vz >> 6;
    const inBounds =
      cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z;
    const chunk = inBounds
      ? this.chunks[cx + cz * WORLD_CHUNKS_X]
      : this.chunkMap.get(`${cx},${cz}`);
    if (!chunk) {
      this.getOrCreateChunkTopSurfaceOnly(cx, cz, false);
    }
    return this.getVoxel(vx, vy, vz);
  }

  isSolidAtWorld(wx: number, wy: number, wz: number): boolean {
    const mat = this.getMaterialAtWorld(wx, wy, wz);
    return mat !== MAT.AIR && mat !== MAT.WATER_VOX;
  }

  /**
   * Pending-removal-aware solid voxel check used by falling TerrainEntity structures & cubes
   * so they collide with static terrain walls/pillars without catching on just-removed voxels.
   */
  isSolidAtWorldForEntity(wx: number, wy: number, wz: number): boolean {
    const vx = Math.floor(wx / VOXEL_SIZE) + (TOTAL_VX >> 1);
    const vy = Math.floor(wy / VOXEL_SIZE);
    const vz = Math.floor(wz / VOXEL_SIZE) + (TOTAL_VZ >> 1);
    const mat = this.readEffectiveVoxelMat(vx, vy, vz);
    return mat !== MAT.AIR && mat !== MAT.WATER_VOX;
  }

  isWaterAt(wx: number, wy: number, wz: number): boolean {
    const vy = Math.floor(wy / VOXEL_SIZE);
    if (vy < 1 || vy > WATER_VY + 28) return false;
    if (this.isInsideGlbLandmass(wx, wz)) return false;
    const vx = Math.floor(wx / VOXEL_SIZE) + (TOTAL_VX >> 1);
    const vz = Math.floor(wz / VOXEL_SIZE) + (TOTAL_VZ >> 1);
    const cx = vx >> 6;
    const cz = vz >> 6;
    const inBounds =
      cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z;
    let chunk = inBounds
      ? this.chunks[cx + cz * WORLD_CHUNKS_X]
      : this.chunkMap.get(`${cx},${cz}`);
    if (!chunk) {
      chunk = this.getOrCreateChunkTopSurfaceOnly(cx, cz, false);
    }
    if (this.getVoxel(vx, vy, vz) === MAT.WATER_VOX) return true;
    if (vy >= WATER_VY - 1 && this.getVoxel(vx, WATER_VY, vz) === MAT.WATER_VOX) return true;
    // Never treat dry MAT.AIR inside a player-modified chunk or beach/inland hole as water!
    if (chunk?.userModified || (this.worldGenMode === 'DEFAULT_PARK' && wx > -25.25)) {
      return false;
    }
    if (!isWaterBasinArea(wx, wz, this.worldGenMode)) return false;
    const solidVY = this.getColumnSolidVY(vx, vz);
    if (solidVY >= 0 && solidVY < WATER_VY && vy > solidVY) {
      return this.getVoxel(vx, vy, vz) === MAT.AIR;
    }
    return false;
  }

  computeSurfaceNormalAt(wx: number, wy: number, wz: number): Vec3 {
    const { vx, vy, vz } = this.worldToVoxelCoords(wx, wy, wz);
    let nx = 0, ny = 0, nz = 0;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const m = this.getVoxel(vx + dx, vy + dy, vz + dz);
          if (m === MAT.AIR || m === MAT.WATER_VOX) {
            nx += dx;
            ny += dy;
            nz += dz;
          }
        }
      }
    }

    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-4) return { x: 0, y: 1, z: 0 };
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  raycastWorldVoxels(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist = 42,
    startOffset = 0.15,
  ): {
    target: 'world';
    vx: number;
    vy: number;
    vz: number;
    mat: number;
    normal: Vec3;
    distance: number;
    worldPos: THREE.Vector3;
  } | null {
    const dirLen = Math.hypot(dir.x, dir.y, dir.z);
    if (dirLen < 1e-6) return null;
    const dx = dir.x / dirLen;
    const dy = dir.y / dirLen;
    const dz = dir.z / dirLen;

    const wx = origin.x + dx * startOffset;
    const wy = origin.y + dy * startOffset;
    const wz = origin.z + dz * startOffset;

    let { vx, vy, vz } = this.worldToVoxelCoords(wx, wy, wz);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const halfVX = TOTAL_VX >> 1;
    const halfVZ = TOTAL_VZ >> 1;

    const nextBoundX = (vx - halfVX + (stepX > 0 ? 1 : 0)) * VOXEL_SIZE;
    const nextBoundY = (vy + (stepY > 0 ? 1 : 0)) * VOXEL_SIZE;
    const nextBoundZ = (vz - halfVZ + (stepZ > 0 ? 1 : 0)) * VOXEL_SIZE;

    let tMaxX = stepX !== 0 ? (nextBoundX - wx) / dx : Infinity;
    let tMaxY = stepY !== 0 ? (nextBoundY - wy) / dy : Infinity;
    let tMaxZ = stepZ !== 0 ? (nextBoundZ - wz) / dz : Infinity;

    const tDeltaX = stepX !== 0 ? Math.abs(VOXEL_SIZE / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(VOXEL_SIZE / dy) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(VOXEL_SIZE / dz) : Infinity;

    let normalX = 0, normalY = 1, normalZ = 0;
    let traveledDist = startOffset;
    const maxSteps = Math.ceil(maxDist / VOXEL_SIZE) + 2;

    let cachedCX = -99999999;
    let cachedCZ = -99999999;
    let cachedChunk: MicroVoxelChunk | undefined;

    for (let i = 0; i < maxSteps && traveledDist < maxDist; i++) {
      if (vy >= 1 && vy < CHUNK_Y - 1) {
        const cx = vx >> 6;
        const cz = vz >> 6;
        if (cx !== cachedCX || cz !== cachedCZ) {
          cachedCX = cx;
          cachedCZ = cz;
          if (cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z) {
            cachedChunk = this.chunks[cx + cz * WORLD_CHUNKS_X];
          } else {
            cachedChunk = this.chunkMap.get(`${cx},${cz}`);
          }
        } else {
          unifiedEngineTelemetry.cachedChunkRaycastSteps++;
        }

        let mat: number = MAT.AIR;
        if (cachedChunk) {
          if (cachedChunk.terrainPopulated && vy > cachedChunk.maxY) {
            // Fast hierarchical Y-bound skip: ray step is above the highest solid/water voxel in this chunk
            unifiedEngineTelemetry.skippedAirRaycastSteps++;
          } else if (
            cachedChunk.terrainPopulated &&
            cachedChunk.isSurfaceOnlyTerrain &&
            !cachedChunk.userModified
          ) {
            const lx = vx & 63;
            const lz = vz & 63;
            const surfVY = cachedChunk.surfaceHeightMap[lx + (lz << 6)];
            if (vy > surfVY) {
              unifiedEngineTelemetry.skippedAirRaycastSteps++;
            } else {
              mat = cachedChunk.sampleSurfaceCompactVoxel(lx, vy, lz);
            }
          } else {
            mat = this.getVoxel(vx, vy, vz);
          }
        }

        if (mat !== MAT.AIR && mat !== MAT.WATER_VOX) {
          _rayHitWorldPos.set(
            (vx - halfVX + 0.5) * VOXEL_SIZE,
            (vy + 0.5) * VOXEL_SIZE,
            (vz - halfVZ + 0.5) * VOXEL_SIZE,
          );
          return {
            target: 'world',
            vx,
            vy,
            vz,
            mat,
            normal: { x: normalX, y: normalY, z: normalZ },
            distance: traveledDist,
            worldPos: _rayHitWorldPos,
          };
        }
      }

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          traveledDist = startOffset + tMaxX;
          tMaxX += tDeltaX;
          vx += stepX;
          normalX = -stepX;
          normalY = 0;
          normalZ = 0;
        } else {
          traveledDist = startOffset + tMaxZ;
          tMaxZ += tDeltaZ;
          vz += stepZ;
          normalX = 0;
          normalY = 0;
          normalZ = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          traveledDist = startOffset + tMaxY;
          tMaxY += tDeltaY;
          vy += stepY;
          normalX = 0;
          normalY = -stepY;
          normalZ = 0;
        } else {
          traveledDist = startOffset + tMaxZ;
          tMaxZ += tDeltaZ;
          vz += stepZ;
          normalX = 0;
          normalY = 0;
          normalZ = -stepZ;
        }
      }
    }
    return null;
  }

  /**
   * Evaluates exact analytical Gerstner wave elevation, slopes, orbital velocity, and 10-band color index at (wx, wz).
   */
  public sampleGerstnerWaves(wx: number, wz: number, time: number): GerstnerWaveSample {
    const isPond = isInlandPondOrRiver(wx, wz, this.worldGenMode);
    const deepDist = isPond ? 0 : this.getDeepOceanDistance(wx, wz);
    return evaluateGerstnerWaveSample(wx, wz, time, deepDist, isPond, this.weatherWaveMult);
  }

  public sampleTerracedWave(wx: number, wz: number): GerstnerWaveSample {
    const isPond = isInlandPondOrRiver(wx, wz, this.worldGenMode);
    const deepDist = isPond ? 0 : this.getDeepOceanDistance(wx, wz);
    return evaluateGerstnerWaveSample(wx, wz, this.waveTime, deepDist, isPond, this.weatherWaveMult);
  }

  /**
   * Returns true if the water at (wx, wz) is inside a dug/blasted non-natural hole or inland trench
   * (on the road, beach, or anywhere inland) rather than the open ocean or natural pond,
   * so it receives tiny, calm ripples (~8% wave height) instead of big waves.
   */
  public isWaterInDugHole(wx: number, wz: number, skipWaterCheck = false): boolean {
    if (!skipWaterCheck && !this.isWaterAt(wx, WATER_LEVEL - 0.15, wz)) return false;
    if (this.worldGenMode === 'DEFAULT_PARK') {
      const isNaturalPond = Math.hypot(wx - 65, wz - -85) < 16.5;
      const isNaturalOcean = wx < -24.8 && wz < 33.5;
      if (!isNaturalOcean && !isNaturalPond) {
        return true;
      }
    }
    // Also check if surrounded by solid walls at WATER_LEVEL within 1.5m on at least 2 cardinal sides
    let solidSides = 0;
    if (this.isSolidAtWorld(wx - 1.5, WATER_LEVEL, wz)) solidSides++;
    if (this.isSolidAtWorld(wx + 1.5, WATER_LEVEL, wz)) solidSides++;
    if (this.isSolidAtWorld(wx, WATER_LEVEL, wz - 1.5)) solidSides++;
    if (this.isSolidAtWorld(wx, WATER_LEVEL, wz + 1.5)) solidSides++;
    return solidSides >= 2;
  }

  public sampleWavePhysicsAt(
    wx: number,
    wz: number,
    out?: GerstnerWaveSample,
  ): GerstnerWaveSample {
    const hasActualWater = this.isWaterAt(wx, WATER_LEVEL - 0.15, wz);
    if (
      this.worldGenMode === 'FLAT_BASEPLATE' ||
      this.waveQuality === 'OFF' ||
      !hasActualWater
    ) {
      if (out) {
        out.rawH = 0;
        out.terracedH = 0;
        out.slopeX = 0;
        out.slopeZ = 0;
        out.orbitalVx = 0;
        out.orbitalVy = 0;
        out.orbitalVz = 0;
        out.colorIndex = 4;
        return out;
      }
      return {
        rawH: 0,
        terracedH: 0,
        slopeX: 0,
        slopeZ: 0,
        orbitalVx: 0,
        orbitalVy: 0,
        orbitalVz: 0,
        colorIndex: 4,
      };
    }
    const isHole = this.isWaterInDugHole(wx, wz, true);
    const isPond = isHole || isInlandPondOrRiver(wx, wz, this.worldGenMode);
    const deepDist = isPond ? 0 : this.getDeepOceanDistance(wx, wz);
    const sample = evaluateGerstnerWaveSample(
      wx,
      wz,
      this.waveTime,
      deepDist,
      isPond,
      this.weatherWaveMult,
      out,
    );
    if (isHole) {
      // Unnatural holes anywhere (on the road, beach, or inland) have tiny, calm ripples (~8% amplitude)
      const holeWaveScale = 0.08;
      sample.rawH *= holeWaveScale;
      sample.terracedH *= holeWaveScale;
      sample.slopeX *= holeWaveScale;
      sample.slopeZ *= holeWaveScale;
      sample.orbitalVx *= holeWaveScale;
      sample.orbitalVy *= holeWaveScale;
      sample.orbitalVz *= holeWaveScale;
    }
    return sample;
  }

  /**
   * Updates 2D terraced voxel water heightfield across the FULL active render distance with:
   * - 10-color ocean-to-foam gradient
   * - 3-5m stepped turquoise & white-foam beach swash sheets
   * - Real-time voxel boat hull foam collar & V-wake trails
   * - Zero per-cell getVoxel/Math.cos overhead via surfaceHeightMap & _cosLUT for locked 60+ FPS!
   */
  updateWaterWaves(
    dt: number,
    creations: ReadonlyArray<{
      position: THREE.Vector3;
      quaternion?: THREE.Quaternion;
      velocity: THREE.Vector3;
      inBuildMode: boolean;
      isWorldPointSolid: (wx: number, wy: number, wz: number) => boolean;
    }>,
    onSplash?: (wx: number, wy: number, wz: number) => void,
    camera?: THREE.Camera,
  ): void {
    const mode = this.worldGenMode;
    this.waveTime += dt;
    this.gpuOceanWaveUniforms.uWaveTime.value = this.waveTime;
    this.gpuOceanWaveUniforms.uWorldGenMode.value = worldGenModeToShaderId(mode);
    this.gpuOceanWaveUniforms.uSunDir.value.copy(this.sunDirection);

    // Step progressive cellular water flow into any connected dug holes/trenches
    this.stepWaterFlow(dt);
    this.waterFlowSteppedThisFrame = true;

    if (
      mode === 'FLAT_BASEPLATE' ||
      mode === 'BIOME_ARCTIC' ||
      mode === 'BIOME_VOLCANIC' ||
      mode === 'CUSTOM_HEIGHTMAP' ||
      this.waveQuality === 'OFF'
    ) {
      this.waterWaveInstancedMesh.count = 0;
      this.waterWaveInstancedMesh.visible = false;
      return;
    }

    const anchorX = this.lastFocusX;
    const anchorZ = this.lastFocusZ;

    // Skip surface wave wake/splash checks when camera is deep underground inside subterranean caves
    if (
      camera &&
      camera.position.y < WATER_LEVEL - 2.0 &&
      !isWaterBasinArea(anchorX, anchorZ, mode)
    ) {
      this.waterWaveInstancedMesh.count = 0;
      this.waterWaveInstancedMesh.visible = false;
      return;
    }

    // Match wave horizon radius directly to the active chunk render distance!
    const activeChunkRadius =
      this.customRenderDistance || this.radiusModes[this.radiusModeIdx].radius;
    const maxRadiusMeters = Math.max(
      32,
      (activeChunkRadius + 0.5) * CHUNK_X * VOXEL_SIZE,
    );

    // Fast spatial early-exit when player is inland far from any water basin
    if (mode === 'DEFAULT_PARK') {
      const nearWestOcean = anchorX - maxRadiusMeters < -23 && anchorZ - maxRadiusMeters < 39;
      const nearPond = Math.hypot(anchorX - 65, anchorZ - -85) < 18 + maxRadiusMeters;
      if (!nearWestOcean && !nearPond) {
        this.waterWaveInstancedMesh.count = 0;
        this.waterWaveInstancedMesh.visible = false;
        return;
      }
    } else if (mode === 'BIOME_CANYON') {
      if (Math.abs(anchorX) - maxRadiusMeters > 32) {
        this.waterWaveInstancedMesh.count = 0;
        this.waterWaveInstancedMesh.visible = false;
        return;
      }
    }

    // Camera frustum half-space culling for distant wave cells
    let hasCamDir = false;
    let camX = anchorX;
    let camZ = anchorZ;
    let camFwdX = 0;
    let camFwdZ = 1;
    if (camera) {
      camera.getWorldDirection(_camDirTmp);
      const horizLen = Math.hypot(_camDirTmp.x, _camDirTmp.z);
      if (horizLen > 0.05) {
        hasCamDir = true;
        camX = camera.position.x;
        camZ = camera.position.z;
        camFwdX = _camDirTmp.x / horizLen;
        camFwdZ = _camDirTmp.z / horizLen;
      }
    }

    // Precompute watercraft hull wake sources for floating/skimming creations
    _wakeSourcesScratch.length = 0;
    const wakeSources = _wakeSourcesScratch;

    if (creations) {
      for (let i = 0; i < creations.length; i++) {
        const cr = creations[i];
        if (!cr || cr.inBuildMode) continue;
        if (
          cr.position.y < WATER_LEVEL + 3.2 &&
          cr.position.y > WATER_LEVEL - 3.5 &&
          isWaterBasinArea(cr.position.x, cr.position.z, mode)
        ) {
          const spd = Math.hypot(cr.velocity.x, cr.velocity.z);
          let fx = 0;
          let fz = 1;
          if (cr.quaternion) {
            const q = cr.quaternion;
            fx = 2 * (q.x * q.z + q.w * q.y);
            fz = 1 - 2 * (q.x * q.x + q.y * q.y);
            const fl = Math.hypot(fx, fz);
            if (fl > 1e-4) {
              fx /= fl;
              fz /= fl;
            }
          } else if (spd > 0.3) {
            fx = cr.velocity.x / spd;
            fz = cr.velocity.z / spd;
          }
          wakeSources.push({
            x: cr.position.x,
            z: cr.position.z,
            speed: spd,
            fwdX: fx,
            fwdZ: fz,
            rightX: fz,
            rightZ: -fx,
            halfW: 1.95,
            halfL: 3.35,
            cr,
          });
        }
      }
    }

    // Unified GPU Gerstner Ocean Shader renders the entire ocean with 1:1 deep-ocean wave scaling!
    // Keep the secondary close-to-vehicle instanced wave mesh disabled so there is never a duplicate wave ring around the vehicle.
    this.waterWaveInstancedMesh.count = 0;
    this.waterWaveInstancedMesh.visible = false;
    const time = this.waveTime;
    for (let i = 0; i < wakeSources.length; i++) {
      const ws = wakeSources[i];
      if (onSplash && ws.speed > 1.6 && Math.random() < 0.24) {
        const sideSign = Math.random() < 0.5 ? -1 : 1;
        const splashX =
          ws.x + ws.fwdX * (ws.halfL * 0.65) + ws.rightX * sideSign * (ws.halfW * 0.85);
        const splashZ =
          ws.z + ws.fwdZ * (ws.halfL * 0.65) + ws.rightZ * sideSign * (ws.halfW * 0.85);
        const deepDist = this.getDeepOceanDistance(splashX, splashZ);
        const waveSample = evaluateGerstnerWaveSample(
          splashX,
          splashZ,
          time,
          deepDist,
          false,
          this.weatherWaveMult,
          _tmpSplashWaveSample,
        );
        onSplash(splashX, WATER_LEVEL + waveSample.rawH + 0.15, splashZ);
      }
    }
  }

  /**
   * Returns exact analytical wave swell elevation at any world point (wx, wz) for vehicle buoyancy.
   */
  public getWaveHeightAt(wx: number, wz: number): number {
    if (
      this.worldGenMode === 'FLAT_BASEPLATE' ||
      this.waveQuality === 'OFF' ||
      (!isWaterBasinArea(wx, wz, this.worldGenMode) &&
        !this.isWaterAt(wx, WATER_LEVEL - 0.15, wz))
    ) {
      return 0;
    }
    const h = this.sampleGerstnerWaves(wx, wz, this.waveTime).terracedH;
    return this.isWaterInDugHole(wx, wz, true) ? h * 0.15 : h;
  }

  updateChunksAndVisibility(
    focusX: number,
    focusZ: number,
    vehRawFaces: number,
    vehMergedQuads: number,
    camera?: THREE.Camera,
    chunkBudgetMs = 8.5,
    maxSyncChunkRebuilds = 2,
    isMapFastLoad = false,
  ): void {
    const startMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const hasBudget = () =>
      typeof performance === 'undefined' ||
      performance.now() - startMs < chunkBudgetMs;

    const velX = focusX - this.lastFocusX;
    const velZ = focusZ - this.lastFocusZ;
    const velLen = Math.hypot(velX, velZ);
    const velDirX = velLen > 0.05 ? velX / velLen : 0;
    const velDirZ = velLen > 0.05 ? velZ / velLen : 0;
    this.lastFocusX = focusX;
    this.lastFocusZ = focusZ;

    // Also advance progressive water flow if updateWaterWaves hasn't already stepped it this frame
    if (!this.waterFlowSteppedThisFrame && this.pendingWaterFlowQueue.length > 0) {
      this.stepWaterFlow(0.016);
    }
    this.waterFlowSteppedThisFrame = false;

    // In Map Mode fast load, immediately finalize any wireframe/bloom animating chunks so they display solid terrain right away
    if (isMapFastLoad && this.animatingChunks.length > 0) {
      for (let i = 0; i < this.animatingChunks.length; i++) {
        const c = this.animatingChunks[i];
        this.disposeChunkWireAndBloom(c);
        c.state = ChunkState.COMPLETE;
      }
      this.animatingChunks.length = 0;
    }

    // Process queued diegetic wireframe/bloom chunks & animate bloom fill
    this.processPriorityChunkQueue(
      camera ? camera.position : undefined,
      isMapFastLoad,
    );
    this.updateChunkAnimations(nowMs);
    this.updateSceneFog(0.016, true, isMapFastLoad, this.fogEnabled);
    updateSharedPotatoShaderUniforms(nowMs * 0.001, this.scene.fog, this.sunDirection);

    if (camera) {
      this.skyDome.position.copy(camera.position);
      _projScreenMat.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      _frustum.setFromProjectionMatrix(_projScreenMat);
    } else {
      this.skyDome.position.set(focusX, 0, focusZ);
    }
    this.skyDome.visible = !isMapFastLoad;
    this.skyDome.updateMatrix();

    if (this.mapHorizonSkirt) {
      this.mapHorizonSkirt.visible = isMapFastLoad;
      if (isMapFastLoad) {
        this.mapHorizonSkirt.position.set(focusX, 0.05, focusZ);
        const mat = this.mapHorizonSkirt.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uBiomeType) {
          let bVal = 0.0;
          if (this.worldGenMode === 'BIOME_CANYON') bVal = 1.0;
          else if (this.worldGenMode === 'BIOME_ARCTIC') bVal = 2.0;
          else if (this.worldGenMode === 'BIOME_VOLCANIC') bVal = 3.0;
          else if (this.worldGenMode === 'BIOME_ARCHIPELAGO' || this.worldGenMode === 'CUSTOM_GLB_MAP') bVal = 4.0;
          else if (this.worldGenMode === 'FLAT_BASEPLATE') bVal = 5.0;
          mat.uniforms.uBiomeType.value = bVal;
        }
      }
    }

    const centerCX = Math.floor(focusX / (CHUNK_X * VOXEL_SIZE) + WORLD_CHUNKS_X / 2);
    const centerCZ = Math.floor(focusZ / (CHUNK_Z * VOXEL_SIZE) + WORLD_CHUNKS_Z / 2);
    const baseRad = this.customRenderDistance || this.radiusModes[this.radiusModeIdx].radius;
    const camAlt = camera ? Math.max(16, camera.position.y) : 65;
    const camAspect =
      camera && (camera as THREE.PerspectiveCamera).aspect
        ? (camera as THREE.PerspectiveCamera).aspect
        : 1.78;
    const dynamicMapRad = computeTacticalMapRenderRadiusChunks(
      camAlt,
      baseRad,
      false,
      camAspect,
    );
    const maxRad = isMapFastLoad ? dynamicMapRad : baseRad;
    if (isMapFastLoad) {
      this.activeMapRenderRadiusChunks = maxRad;
    }

    const isMassDirtySpike = this.dirtyQueue.length > 50;
    const isLowEndMode = this.usePotatoShader || this.cpuThreads <= 2;

    const supportsHorizonTiles = true;
    const mapAltChunks = Math.max(
      dynamicMapRad,
      baseRad,
      Math.min(1000000000, Math.ceil((camAlt * 2.4 * Math.max(1, camAspect)) / 16)),
    );
    const effectiveRenderDistBig: bigint = isMapFastLoad
      ? BigInt(mapAltChunks)
      : this.customRenderDistanceBig > 0n
        ? this.customRenderDistanceBig
        : BigInt(baseRad);
    if (isMapFastLoad) {
      this.activeMapRenderRadiusChunks = mapAltChunks;
    }
    const lodPlan = computeDynamicLodPlan({
      renderDistanceChunks: effectiveRenderDistBig,
      lodSpacing: this.lodSpacing,
      isLowEndMode,
      uncappedChunkLod: this.uncappedChunkLod,
      supportsHorizonTiles,
    });
    const nestedBoxesBig = computeNestedRingBoxesBigInt(centerCX, centerCZ, lodPlan);
    const lod0BoxNum: ChunkBox = {
      minCX: Number(nestedBoxesBig.lod0Box.minCX),
      maxCXExcl: Number(nestedBoxesBig.lod0Box.maxCXExcl),
      minCZ: Number(nestedBoxesBig.lod0Box.minCZ),
      maxCZExcl: Number(nestedBoxesBig.lod0Box.maxCZExcl),
    };
    const horizonActive = lodPlan.rings.length > 0;
    this._horizonActive = horizonActive;
    this.activeTotalLodLayers = lodPlan.totalLodLayers;
    this.activeScaleBands = lodPlan.activeScaleBands;
    if (this.mapHorizonSkirt) {
      this.mapHorizonSkirt.visible = isMapFastLoad && !horizonActive;
    }

    // Compute Optical Zoom LOD0 Focus Box (snapped to LOD1's 2x2 chunk grid for 100% watertight tile cutout!)
    let zoomLod0BoxBig: ChunkBoxBigInt | null = null;
    let zoomLod0BoxNum: ChunkBox | null = null;
    if (!isMapFastLoad && this.zoomFocusWorld !== null) {
      const rawZoomCX = Math.floor(
        this.zoomFocusWorld.x / (CHUNK_X * VOXEL_SIZE) + WORLD_CHUNKS_X / 2,
      );
      const rawZoomCZ = Math.floor(
        this.zoomFocusWorld.z / (CHUNK_Z * VOXEL_SIZE) + WORLD_CHUNKS_Z / 2,
      );
      if (
        this._lastZoomCX === -999999 ||
        Math.hypot(rawZoomCX - this._lastZoomCX, rawZoomCZ - this._lastZoomCZ) >= 1.15
      ) {
        this._lastZoomCX = rawZoomCX;
        this._lastZoomCZ = rawZoomCZ;
      }
      const zoomSnapMult = lodPlan.rings.length > 0 ? lodPlan.rings[0].tileChunksBig : 2n;
      const candidateZoomBoxBig = computeZoomedLod0BoxBigInt(
        this._lastZoomCX,
        this._lastZoomCZ,
        isLowEndMode ? 1 : 2,
        zoomSnapMult,
      );
      const candidateZoomBoxNum: ChunkBox = {
        minCX: Number(candidateZoomBoxBig.minCX),
        maxCXExcl: Number(candidateZoomBoxBig.maxCXExcl),
        minCZ: Number(candidateZoomBoxBig.minCZ),
        maxCZExcl: Number(candidateZoomBoxBig.maxCZExcl),
      };
      // Only activate secondary zoomed LOD0 box if it extends outside the player's local lod0BoxNum
      const fullyInsidePlayerLod0 =
        candidateZoomBoxNum.minCX >= lod0BoxNum.minCX &&
        candidateZoomBoxNum.maxCXExcl <= lod0BoxNum.maxCXExcl &&
        candidateZoomBoxNum.minCZ >= lod0BoxNum.minCZ &&
        candidateZoomBoxNum.maxCZExcl <= lod0BoxNum.maxCZExcl;
      if (!fullyInsidePlayerLod0) {
        zoomLod0BoxBig = candidateZoomBoxBig;
        zoomLod0BoxNum = candidateZoomBoxNum;
      }
    } else {
      this._lastZoomCX = -999999;
      this._lastZoomCZ = -999999;
    }

    if (!isMapFastLoad && this.skyDome) {
      const targetSkyScale = lodPlan.skyDomeScale;
      if (Math.abs(this.skyDome.scale.x - targetSkyScale) > 0.01) {
        this.skyDome.scale.setScalar(targetSkyScale);
        this.skyDome.updateMatrix();
      }
    }

    const lod0ScanRad = horizonActive
      ? Math.max(
          Math.abs(lod0BoxNum.minCX - centerCX),
          Math.abs(lod0BoxNum.maxCXExcl - 1 - centerCX),
          Math.abs(lod0BoxNum.minCZ - centerCZ),
          Math.abs(lod0BoxNum.maxCZExcl - 1 - centerCZ),
        )
      : maxRad;

    // Check how many chunks inside the crisp LOD0 bubble (and active zoomed LOD0 box) still lack a built mesh
    let missingLod0Count = 0;
    let missingZoomLod0Count = 0;
    if (!isMapFastLoad) {
      const b0 = lod0BoxNum;
      for (let cz = b0.minCZ; cz < b0.maxCZExcl; cz++) {
        for (let cx = b0.minCX; cx < b0.maxCXExcl; cx++) {
          const c = this.chunkMap.get(`${cx},${cz}`);
          if (!c || !c.hasBuiltMesh) {
            missingLod0Count++;
          }
        }
      }
      if (missingLod0Count === 0) {
        this._initialSpawnBubbleReady = true;
      }
      if (zoomLod0BoxNum !== null) {
        for (let cz = zoomLod0BoxNum.minCZ; cz < zoomLod0BoxNum.maxCZExcl; cz++) {
          for (let cx = zoomLod0BoxNum.minCX; cx < zoomLod0BoxNum.maxCXExcl; cx++) {
            if (isChunkInsideBox(cx, cz, b0)) continue;
            const c = this.chunkMap.get(`${cx},${cz}`);
            if (!c || !c.hasBuiltMesh) {
              missingZoomLod0Count++;
            }
          }
        }
      }
    }
    const isBootstrappingLod0 =
      !isMapFastLoad &&
      (!this._initialSpawnBubbleReady || missingLod0Count > 6 || missingZoomLod0Count > 0);

    const chunkRebuildBudget = isMapFastLoad
      ? 24
      : isLowEndMode
        ? isBootstrappingLod0
          ? 2
          : 1
        : isBootstrappingLod0
          ? 6
          : Math.min(3, Math.max(2, this.maxChunkRebuildsPerFrame));
    // Unified per-frame worker upload budget: boost during initial spawn bubble or optical zoom lock so LOD0 fills immediately with zero gap
    const workerCommitLimit = isMapFastLoad
      ? 24
      : isLowEndMode
        ? isBootstrappingLod0
          ? 4
          : 1
        : isBootstrappingLod0
          ? 8
          : isMassDirtySpike
            ? 3
            : 2;
    const workerBudgetMs = isMapFastLoad
      ? chunkBudgetMs
      : isBootstrappingLod0
        ? Math.min(chunkBudgetMs, isLowEndMode ? 3.5 : 5.5)
        : Math.min(chunkBudgetMs, isLowEndMode ? 1.5 : 2.0);
    let appliedWorkers = 0;
    while (
      this.completedWorkerQueue.length > 0 &&
      appliedWorkers < workerCommitLimit &&
      (appliedWorkers === 0 ||
        typeof performance === 'undefined' ||
        performance.now() - startMs < workerBudgetMs)
    ) {
      const item = this.completedWorkerQueue.shift()!;
      const wasStillDirty = item.chunk.dirty;
      const savedDirtyMask = item.chunk.dirtyBucketMask;
      this.applyWorkerPayloadToChunk(item.chunk, item.res, item.jobRemovals);
      if (wasStillDirty && savedDirtyMask !== 0) {
        item.chunk.dirty = true;
        item.chunk.dirtyBucketMask = savedDirtyMask;
      }
      appliedWorkers++;
    }

    // Cancel stale out-of-range worker jobs whenever the player crosses a chunk boundary or changes LOD settings
    const centerMoved =
      centerCX !== this._lastStreamCenterCX ||
      centerCZ !== this._lastStreamCenterCZ ||
      maxRad !== this._lastStreamMaxRad ||
      effectiveRenderDistBig !== this._lastStreamMaxRadBig ||
      this.lodSpacing !== this._lastStreamLodSpacing;
    if (centerMoved) {
      this._lastStreamCenterCX = centerCX;
      this._lastStreamCenterCZ = centerCZ;
      this._lastStreamMaxRad = maxRad;
      this._lastStreamMaxRadBig = effectiveRenderDistBig;
      this._lastStreamLodSpacing = this.lodSpacing;
      this._allChunksInRadiusPresent = false;
      if (!isMapFastLoad) {
        let cancelRad = lod0ScanRad + 1;
        if (zoomLod0BoxNum !== null) {
          const zoomFarCheb = Math.max(
            Math.abs(zoomLod0BoxNum.minCX - centerCX),
            Math.abs(zoomLod0BoxNum.maxCXExcl - centerCX),
            Math.abs(zoomLod0BoxNum.minCZ - centerCZ),
            Math.abs(zoomLod0BoxNum.maxCZExcl - centerCZ),
          );
          cancelRad = Math.max(cancelRad, zoomFarCheb + 2);
        }
        this.workerPool.cancelOutOfRangeJobs(centerCX, centerCZ, cancelRad);
      }
    }

    let createdThisFrame = 0;
    let immediateBuiltThisFrame = 0;
    const maxNewChunksThisFrame = isMapFastLoad
      ? 44
      : isBootstrappingLod0
        ? isLowEndMode
          ? 6
          : 16
        : 4;
    const chunkSpanMeters = CHUNK_X * VOXEL_SIZE;

    // Ground level in the park is y = 14.5m (WATER_LEVEL = 14.25m); only trigger full 3D cave chunk upgrades
    // when the camera is genuinely descending below ground level / into a cave or submarine trench (y < 13.75m)!
    const isPlayerNearOrUnderground =
      !isMapFastLoad &&
      camera !== undefined &&
      camera.position.y < WATER_LEVEL - 0.5;

    // All real LOD0 chunks get strictly negative priority scores (-500 .. -200) so they ALWAYS beat outer horizon tiles (+600+)
    const computeChunkPriority = (cx: number, cz: number, dx: number, dz: number, ring: number): number => {
      let score = -500 + ring * 25 + Math.hypot(dx, dz) * 4;
      if (camera) {
        _tmpChunkSphere.center.set(
          (cx - WORLD_CHUNKS_X / 2 + 0.5) * chunkSpanMeters,
          12,
          (cz - WORLD_CHUNKS_Z / 2 + 0.5) * chunkSpanMeters,
        );
        if (_frustum.intersectsSphere(_tmpChunkSphere)) {
          score -= 35;
        }
      }
      if (velLen > 0.05 && ring > 0) {
        const dLen = Math.hypot(dx, dz) || 1;
        const align = (dx / dLen) * velDirX + (dz / dLen) * velDirZ;
        score -= align * 20;
      }
      return score;
    };

    // High-priority Optical Zoom LOD0 Focus Streamer:
    // Streams the compact 4x4 (or 2x2 on low-end) zoomed LOD0 focus box at ultra-high priority (-560)
    // and builds the 1-2 central crosshair chunks immediately so the zoomed sightline is instant LOD0!
    if (zoomLod0BoxNum !== null && missingZoomLod0Count > 0) {
      let syncCrosshairBuilt = 0;
      const maxSyncCrosshair = isLowEndMode ? 1 : 2;
      for (let cz = zoomLod0BoxNum.minCZ; cz < zoomLod0BoxNum.maxCZExcl; cz++) {
        for (let cx = zoomLod0BoxNum.minCX; cx < zoomLod0BoxNum.maxCXExcl; cx++) {
          if (isChunkInsideBox(cx, cz, lod0BoxNum)) continue;
          const inBounds =
            cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z;
          const existing = inBounds
            ? this.chunks[cx + cz * WORLD_CHUNKS_X]
            : this.chunkMap.get(`${cx},${cz}`);
          if (existing && existing.hasBuiltMesh && !existing.dirty) {
            if (existing.wireMesh || existing.isBloomMaterialAttached) {
              this.disposeChunkWireAndBloom(existing);
              existing.state = ChunkState.COMPLETE;
            }
            continue;
          }
          const zDx = cx - this._lastZoomCX;
          const zDz = cz - this._lastZoomCZ;
          const zCheb = Math.max(Math.abs(zDx), Math.abs(zDz));
          const isCrosshairCenter = zCheb === 0;
          const zoomPrio = -560 + Math.hypot(zDx, zDz) * 6;
          if (!existing) {
            if (
              isCrosshairCenter &&
              syncCrosshairBuilt < maxSyncCrosshair &&
              hasBudget()
            ) {
              const c = this.getOrCreateChunkTopSurfaceOnly(cx, cz, true, false);
              this.disposeChunkWireAndBloom(c);
              c.state = ChunkState.COMPLETE;
              syncCrosshairBuilt++;
              createdThisFrame++;
              immediateBuiltThisFrame++;
            } else {
              const deferToWorker = this.canUseWorkerProceduralSurfaceGen();
              const c = this.getOrCreateChunkTopSurfaceOnly(
                cx,
                cz,
                !this.workerPool.hasDedicatedWorkers,
                deferToWorker,
              );
              this.disposeChunkWireAndBloom(c);
              if (this.workerPool.hasDedicatedWorkers && !c.hasBuiltMesh && !c.workerPending) {
                this.rebuildChunkAsync(c, true, zoomPrio);
              }
              createdThisFrame++;
            }
          } else if (!existing.workerPending) {
            this.disposeChunkWireAndBloom(existing);
            if (
              isCrosshairCenter &&
              syncCrosshairBuilt < maxSyncCrosshair &&
              existing.isSurfaceOnlyTerrain &&
              !existing.userModified &&
              hasBudget()
            ) {
              this.rebuildChunkTopSurfaceOnly(existing);
              existing.state = ChunkState.COMPLETE;
              syncCrosshairBuilt++;
              immediateBuiltThisFrame++;
            } else if (this.workerPool.hasDedicatedWorkers) {
              this.rebuildChunkAsync(existing, true, zoomPrio);
            } else if (existing.isSurfaceOnlyTerrain && !existing.userModified) {
              this.rebuildChunkTopSurfaceOnly(existing);
            } else {
              this.rebuildChunkSync(existing, true);
            }
          }
        }
      }
    }

    // Skip the triple-nested ring creation scan completely when stationary and all chunks in radius are loaded!
    const shouldRunRingScan =
      isMapFastLoad ||
      isPlayerNearOrUnderground ||
      !this._allChunksInRadiusPresent ||
      this.dirtyQueue.length > 0;

    if (shouldRunRingScan) {
      let allPresentInScan = true;
      const circularScanRadSq = (lod0ScanRad + 0.35) * (lod0ScanRad + 0.35);
      for (let ring = 0; ring <= lod0ScanRad; ring++) {
        for (let dz = -ring; dz <= ring; dz++) {
          for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
            const cx = centerCX + dx;
            const cz = centerCZ + dz;
            if (horizonActive) {
              if (!isChunkInsideBox(cx, cz, lod0BoxNum)) continue;
            } else if (
              !isMapFastLoad &&
              ring > 1 &&
              dx * dx + dz * dz > circularScanRadSq
            ) {
              continue;
            }
            const inBounds =
              cx >= 0 && cx < WORLD_CHUNKS_X && cz >= 0 && cz < WORLD_CHUNKS_Z;
            const existing = inBounds
              ? this.chunks[cx + cz * WORLD_CHUNKS_X]
              : this.chunkMap.get(`${cx},${cz}`);
            const isDirectlyUnder = dx === 0 && dz === 0;
            const needsFull3DCaveTerrain =
              !isMapFastLoad &&
              this.worldGenMode !== 'FLAT_BASEPLATE' &&
              isPlayerNearOrUnderground &&
              ring <= 1;
            if (!existing) {
              allPresentInScan = false;
              if (isMapFastLoad) {
                if (ring > 4 && camera) {
                  _tmpChunkSphere.center.set(
                    (cx - WORLD_CHUNKS_X / 2 + 0.5) * chunkSpanMeters,
                    8,
                    (cz - WORLD_CHUNKS_Z / 2 + 0.5) * chunkSpanMeters,
                  );
                  if (!_frustum.intersectsSphere(_tmpChunkSphere)) {
                    continue;
                  }
                }
                if (createdThisFrame < maxNewChunksThisFrame && hasBudget()) {
                  this.getOrCreateChunkTopSurfaceOnly(cx, cz, true, false);
                  createdThisFrame++;
                  immediateBuiltThisFrame++;
                }
              } else if (createdThisFrame < maxNewChunksThisFrame && (isDirectlyUnder || hasBudget())) {
                const prio = computeChunkPriority(cx, cz, dx, dz, ring);
                if (needsFull3DCaveTerrain) {
                  const c = this.getOrCreateChunk(cx, cz, false, false);
                  if (this.workerPool.hasDedicatedWorkers) {
                    this.rebuildChunkAsync(c, true, prio);
                  } else {
                    this.rebuildChunkSync(c, true);
                  }
                } else {
                  // Ring 0 populates immediately for instant ground physics; outer rings generate 100% off-thread in the worker!
                  const deferToWorker = !isDirectlyUnder && this.canUseWorkerProceduralSurfaceGen();
                  const c = this.getOrCreateChunkTopSurfaceOnly(
                    cx,
                    cz,
                    !this.workerPool.hasDedicatedWorkers,
                    deferToWorker,
                  );
                  if (this.workerPool.hasDedicatedWorkers && !c.hasBuiltMesh && !c.workerPending) {
                    this.rebuildChunkAsync(c, true, prio);
                  }
                }
                createdThisFrame++;
                immediateBuiltThisFrame++;
              }
            } else if (
              needsFull3DCaveTerrain &&
              existing.isSurfaceOnlyTerrain &&
              !existing.workerPending &&
              createdThisFrame < 1 &&
              hasBudget()
            ) {
              allPresentInScan = false;
              this.ensureFullChunkTerrain(existing);
              if (this.workerPool.hasDedicatedWorkers) {
                this.rebuildChunkAsync(existing, true, -100);
              } else {
                this.rebuildChunkSync(existing, true);
              }
              createdThisFrame++;
              immediateBuiltThisFrame++;
            } else if (isMapFastLoad && !existing.hasBuiltMesh && !existing.workerPending && hasBudget()) {
              allPresentInScan = false;
              this.rebuildChunkTopSurfaceOnly(existing);
              immediateBuiltThisFrame++;
            } else if (
              existing.dirty &&
              !existing.workerPending &&
              (isDirectlyUnder || (isMapFastLoad && ring <= 1)) &&
              immediateBuiltThisFrame < (isMapFastLoad ? 12 : 2)
            ) {
              allPresentInScan = false;
              if (isMapFastLoad && !existing.userModified) {
                this.rebuildChunkTopSurfaceOnly(existing);
              } else if (this.workerPool.hasDedicatedWorkers) {
                this.rebuildChunkAsync(existing, true, computeChunkPriority(cx, cz, dx, dz, ring));
              } else if (existing.isSurfaceOnlyTerrain && !existing.userModified) {
                this.rebuildChunkTopSurfaceOnly(existing);
              } else {
                this.rebuildChunk(existing);
              }
              immediateBuiltThisFrame++;
            } else if (
              !isMapFastLoad &&
              !existing.hasBuiltMesh &&
              !existing.workerPending &&
              existing.state !== ChunkState.QUEUED &&
              createdThisFrame < maxNewChunksThisFrame &&
              (isDirectlyUnder || hasBudget())
            ) {
              allPresentInScan = false;
              const prio = computeChunkPriority(cx, cz, dx, dz, ring);
              if (this.workerPool.hasDedicatedWorkers) {
                this.rebuildChunkAsync(existing, true, prio);
              } else if (existing.isSurfaceOnlyTerrain && !existing.userModified) {
                this.rebuildChunkTopSurfaceOnly(existing);
              } else {
                this.rebuildChunkSync(existing, true);
              }
              createdThisFrame++;
              immediateBuiltThisFrame++;
            } else if (!existing.hasBuiltMesh || existing.dirty) {
              allPresentInScan = false;
            }
          }
        }
      }
      if (!isMapFastLoad) {
        this._allChunksInRadiusPresent = allPresentInScan;
      }
    }

    if (this.dirtyQueue.length > 50 && isMapFastLoad) {
      immediateBuiltThisFrame += this.performMassDirtyChunkRebuildPass(
        centerCX,
        centerCZ,
        maxRad,
        isMapFastLoad,
      );
    } else if (this.dirtyQueue.length > 0 && immediateBuiltThisFrame < chunkRebuildBudget && hasBudget()) {
      let dispatchedCount = immediateBuiltThisFrame;
      const dirtySearchRad = horizonActive ? Math.max(lod0ScanRad + 1, 4) : maxRad;
      while (
        this.dirtyQueue.length > 0 &&
        dispatchedCount < chunkRebuildBudget &&
        hasBudget()
      ) {
        const picked = this.extractClosestDirtyChunk(centerCX, centerCZ, dirtySearchRad);
        if (!picked) break;
        const { chunk: next } = picked;
        if (isMapFastLoad && !next.userModified) {
          this.rebuildChunkTopSurfaceOnly(next);
          dispatchedCount++;
        } else if (this.workerPool.hasDedicatedWorkers) {
          const prio = computeChunkPriority(
            next.cx,
            next.cz,
            next.cx - centerCX,
            next.cz - centerCZ,
            Math.max(Math.abs(next.cx - centerCX), Math.abs(next.cz - centerCZ)),
          );
          this.rebuildChunkAsync(next, true, prio);
          dispatchedCount++;
        } else if (next.isSurfaceOnlyTerrain && !next.userModified) {
          this.rebuildChunkTopSurfaceOnly(next);
          dispatchedCount++;
        } else {
          this.rebuildChunk(next);
          dispatchedCount++;
        }
      }
    }

    // Defer per-chunk LOD1/LOD2/LOD3 generation ONLY when Distant Horizon mega-tiles are inactive
    if (
      !horizonActive &&
      !isMapFastLoad &&
      this.workerPool.hasDedicatedWorkers &&
      this.areAllChunksLod0MeshReady() &&
      hasBudget()
    ) {
      let lod12Scheduled = 0;
      for (const chunk of this.chunkMap.values()) {
        if (lod12Scheduled >= chunkRebuildBudget || !hasBudget()) break;
        if (!chunk.lod12Built && chunk.hasBuiltMesh && !chunk.workerPending && !chunk.dirty) {
          this.rebuildChunkAsync(chunk, false, 500, true);
          lod12Scheduled++;
        }
      }
    }

    if (camera) {
      _projScreenMat.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      _frustum.setFromProjectionMatrix(_projScreenMat);
    }

    let visibleRaw = vehRawFaces;
    let visibleMerged = vehMergedQuads;
    let l0Count = 0;
    let l1Count = 0;
    let l2Count = 0;
    let l3Count = 0;
    let zoomLod0Count = 0;

    const tuning = computeRenderDistanceTuning(
      maxRad,
      this.uncappedChunkLod,
      this.lodSpacing,
    );
    const effectiveVisibilityRad = horizonActive
      ? lod0ScanRad
      : isMapFastLoad
        ? Math.max(maxRad + 4, 26)
        : maxRad;
    // Hysteresis band: tighter (+1) on Pentium/low draw distance so far chunks free RAM quickly
    const retentionRad =
      isLowEndMode || effectiveVisibilityRad <= 4
        ? effectiveVisibilityRad + 1
        : effectiveVisibilityRad + 2;
    const zoomRetentionExtra = zoomLod0BoxNum !== null ? 16 : 0;
    const maxRetainedChunks =
      (2 * retentionRad + 1) * (2 * retentionRad + 1) + zoomRetentionExtra;
    const shouldPruneFarChunks = !isMapFastLoad && this.chunkMap.size > maxRetainedChunks;
    let evictedThisFrame = 0;
    const maxEvictionsPerFrame = isLowEndMode ? 4 : 3;

    const effectiveVisCircRadSq = (effectiveVisibilityRad + 0.35) * (effectiveVisibilityRad + 0.35);
    this.chunkMap.forEach((chunk, key) => {
      const dxC = chunk.cx - centerCX;
      const dzC = chunk.cz - centerCZ;
      const chebDist = Math.max(Math.abs(dxC), Math.abs(dzC));
      const isInsideZoomBox =
        zoomLod0BoxNum !== null && isChunkInsideBox(chunk.cx, chunk.cz, zoomLod0BoxNum);
      const isOutsideVisible = isInsideZoomBox
        ? false
        : horizonActive
          ? !isChunkInsideBox(chunk.cx, chunk.cz, lod0BoxNum)
          : chebDist > effectiveVisibilityRad ||
            (!isMapFastLoad &&
              chebDist > 1 &&
              dxC * dxC + dzC * dzC > effectiveVisCircRadSq);

      // Seamless Outgoing Bridge: if a real LOD0 chunk just exited lod0Box or zoomLod0Box,
      // keep it visible until the replacement Distant Horizon mega-tile covering it has built!
      const isOutgoingLod0Bridge =
        horizonActive &&
        isOutsideVisible &&
        chunk.hasBuiltMesh &&
        (chunk.mesh !== null || chunk.transMesh !== null) &&
        (chebDist <= lod0ScanRad + 3 || nowMs - chunk.lastAccessedMs < 2500) &&
        Boolean(this.horizonManager) &&
        !this.horizonManager.isChunkCoveredByReadyTile(chunk.cx, chunk.cz);

      if (isOutsideVisible && !isOutgoingLod0Bridge) {
        this.setChunkLodLevel(chunk, -1);
        // Only clear CPU cachedOpaqueBuckets once chunk is hidden outside visibility radius
        if (
          !chunk.dirty &&
          !chunk.workerPending &&
          (chunk.cachedOpaqueBuckets[0] !== null ||
            chunk.cachedOpaqueBuckets[1] !== null ||
            chunk.cachedOpaqueBuckets[2] !== null)
        ) {
          chunk.cachedOpaqueBuckets = [null, null, null];
        }
        const isStaleUnmodified =
          !isMapFastLoad &&
          !chunk.userModified &&
          chebDist > retentionRad &&
          (shouldPruneFarChunks || nowMs - chunk.lastAccessedMs > 30_000);
        const isStaleUserModified =
          chunk.userModified &&
          chebDist > Math.max(effectiveVisibilityRad * 2, 16) &&
          nowMs - chunk.lastAccessedMs > 120_000;
        if (
          evictedThisFrame < maxEvictionsPerFrame &&
          !chunk.workerPending &&
          !chunk.inDirtyQueue &&
          (isStaleUnmodified || isStaleUserModified)
        ) {
          this.disposeChunkMeshes(chunk, true);
          chunk.hasBuiltMesh = false;
          chunk.lod12Built = false;
          this.chunkMap.delete(key);
          this.chunkSlotMap.delete(key);
          evictedThisFrame++;
          if (chunk.userModified) {
            chunk.compressForCache();
            if (this.modifiedChunkCache.has(key)) {
              const prevCached = this.modifiedChunkCache.get(key);
              if (prevCached && prevCached !== chunk) {
                this.voxelWorld.releaseChunkSlot(prevCached.slotIndex);
              }
              this.modifiedChunkCache.delete(key);
            } else if (this.modifiedChunkCache.size >= 128) {
              const oldestKey = this.modifiedChunkCache.keys().next().value;
              if (oldestKey !== undefined) {
                const oldestChunk = this.modifiedChunkCache.get(oldestKey);
                if (oldestChunk) {
                  this.voxelWorld.releaseChunkSlot(oldestChunk.slotIndex);
                }
                this.modifiedChunkCache.delete(oldestKey);
              }
            }
            this.modifiedChunkCache.set(key, chunk);
          } else {
            this.voxelWorld.releaseChunkSlot(chunk.slotIndex);
          }
          if (
            chunk.cx >= 0 &&
            chunk.cx < WORLD_CHUNKS_X &&
            chunk.cz >= 0 &&
            chunk.cz < WORLD_CHUNKS_Z
          ) {
            this.chunks[chunk.cx + chunk.cz * WORLD_CHUNKS_X] =
              undefined as unknown as MicroVoxelChunk;
          }
        }
        return;
      }

      chunk.lastAccessedMs = nowMs;

      if (!chunk.mesh && !chunk.transMesh) {
        return;
      }

      if (
        !isMapFastLoad &&
        !isInsideZoomBox &&
        chebDist > (horizonActive ? 2 : tuning.lod0MaxCheb) &&
        camera &&
        !_frustum.intersectsSphere(chunk.boundingSphere)
      ) {
        this.setChunkLodLevel(chunk, -1);
        return;
      }

      if (isInsideZoomBox && (chunk.wireMesh || chunk.isBloomMaterialAttached)) {
        this.disposeChunkWireAndBloom(chunk);
        chunk.state = ChunkState.COMPLETE;
      }

      const targetLod: 0 | 1 | 2 | 3 =
        horizonActive || isInsideZoomBox
          ? 0
          : resolveChunkTargetLod({
              chebDist,
              distMeters: Math.hypot(
                chunk.centerWorld.x - focusX,
                chunk.centerWorld.z - focusZ,
              ),
              prevLod: chunk.activeLodLevel,
              tuning,
              isLowEndMode,
              isMapFastLoad,
            });

      const activeQuads = this.setChunkLodLevel(chunk, targetLod);
      if (chunk.activeLodLevel === 0) {
        l0Count++;
        if (isInsideZoomBox) zoomLod0Count++;
      } else if (chunk.activeLodLevel === 1) l1Count++;
      else if (chunk.activeLodLevel === 2) l2Count++;
      else if (chunk.activeLodLevel === 3) l3Count++;
      visibleRaw += chunk.rawFaces;
      visibleMerged += activeQuads;
    });
    this.activeZoomLod0Chunks = zoomLod0Count;

    // Update Distant Horizons dynamic outer mega-tile rings (LOD1 .. LOD8)
    let horizonStats = {
      activeRings: 0,
      visibleTiles: 0,
      visibleQuads: 0,
      pendingJobs: 0,
      cachedTiles: 0,
    };
    if (this.horizonManager) {
      if (horizonActive) {
        const camBigSector = camera
          ? createBigSectorPosition(camera.position.x, camera.position.y, camera.position.z)
          : createBigSectorPosition(focusX, 16, focusZ);
        if (camera) {
          camera.getWorldDirection(this._cameraFwdScratch);
        }
        horizonStats = this.horizonManager.update({
          plan: lodPlan,
          nestedBoxes: nestedBoxesBig,
          centerCX,
          centerCZ,
          zoomLod0Box: zoomLod0BoxBig,
          cameraBigSector: camBigSector,
          cameraForward: camera ? this._cameraFwdScratch : null,
          worldGenMode: this.worldGenMode,
          flatBaseplateMat: this.flatBaseplateMat,
          frustum: camera ? _frustum : null,
          isLowEndMode,
          isLod0RegionReady: (minCX, maxCXExcl, minCZ, maxCZExcl) => {
            for (let cz = minCZ; cz < maxCZExcl; cz++) {
              for (let cx = minCX; cx < maxCXExcl; cx++) {
                const c = this.chunkMap.get(`${cx},${cz}`);
                if (!c || !c.hasBuiltMesh || (!c.mesh && !c.transMesh)) {
                  return false;
                }
              }
            }
            return true;
          },
          nowMs,
          // Hold off dispatching NEW outer mega-tiles only while core spawn chunks or zoomed LOD0 chunks are still missing
          deferNewDispatches:
            (!this._initialSpawnBubbleReady && missingLod0Count > 6) ||
            missingZoomLod0Count > 4,
          planetCurvatureRadius: this.planetCurvatureRadius,
        });
        visibleMerged += horizonStats.visibleQuads;
        visibleRaw += horizonStats.visibleQuads * 16;
      } else {
        this.horizonManager.setAllVisible(false);
      }
    }
    const prevRings = this.activeHorizonRings;
    const prevTiles = this.activeHorizonTiles;
    this.activeHorizonRings = horizonStats.activeRings;
    this.activeHorizonTiles = horizonStats.visibleTiles;

    const prevL0 = this.lod0Chunks;
    const prevL1 = this.lod1Chunks;
    const prevL2 = this.lod2Chunks;
    const prevL3 = this.lod3Chunks;
    this.lod0Chunks = l0Count;
    this.lod1Chunks = l1Count;
    this.lod2Chunks = l2Count;
    this.lod3Chunks = l3Count;
    this.visibleTris = visibleMerged * 2;
    const rawTris = visibleRaw * 2;
    this.greedySavingsPct =
      rawTris > 0 ? Math.round((1 - this.visibleTris / rawTris) * 100) : 96;
    if (
      l0Count !== prevL0 ||
      l1Count !== prevL1 ||
      l2Count !== prevL2 ||
      l3Count !== prevL3 ||
      this.activeHorizonRings !== prevRings ||
      this.activeHorizonTiles !== prevTiles ||
      !this.lodSummary
    ) {
      this.lodSummary = horizonActive
        ? `LOD0:${l0Count} · +${lodPlan.rings.length} RINGS (${horizonStats.visibleTiles} TILES) · ${this.cpuThreads} CORES`
        : `L0:${l0Count} L1:${l1Count} L2:${l2Count} L3:${l3Count} · ${this.cpuThreads} CORES`;
    }
  }

  public dispose(): void {
    this.horizonManager?.dispose();
    this.workerPool.dispose();
    this.dirtyQueue.length = 0;
    this.completedWorkerQueue.length = 0;
    this.pendingWaterFlowQueue.length = 0;
    this.pendingWaterFlowSet.clear();
    this.chunkMap.forEach((chunk) => {
      this.disposeChunkMeshes(chunk, false);
      this.voxelWorld.releaseChunkSlot(chunk.slotIndex);
    });
    drainChunkMeshPool();
    this.modifiedChunkCache.forEach((chunk) => {
      this.voxelWorld.releaseChunkSlot(chunk.slotIndex);
    });
    this.chunkMap.clear();
    this.chunkSlotMap.clear();
    this.modifiedChunkCache.clear();
    while (_bloomMaterialPool.length > 0) {
      _bloomMaterialPool.pop()?.dispose();
    }
    while (_wireInstancedMeshPool.length > 0) {
      const wm = _wireInstancedMeshPool.pop();
      if (wm) {
        if (Array.isArray(wm.material)) {
          wm.material.forEach((m) => m.dispose());
        } else {
          wm.material.dispose();
        }
        wm.dispose();
      }
    }
    if (sharedCubeWireGeom) {
      sharedCubeWireGeom.dispose();
      sharedCubeWireGeom = null;
    }
    if (this.waterWaveInstancedMesh) {
      this.scene.remove(this.waterWaveInstancedMesh);
      this.waterWaveInstancedMesh.geometry.dispose();
      (this.waterWaveInstancedMesh.material as THREE.Material).dispose();
      this.waterWaveInstancedMesh.dispose();
    }
    if (this.skyDome) {
      this.scene.remove(this.skyDome);
      this.skyDome.geometry.dispose();
      (this.skyDome.material as THREE.Material).dispose();
    }
    if (this.mapHorizonSkirt) {
      this.scene.remove(this.mapHorizonSkirt);
      this.mapHorizonSkirt.geometry.dispose();
      (this.mapHorizonSkirt.material as THREE.Material).dispose();
    }
    this.sharedVoxelMaterial.dispose();
    this.sharedTranslucentMaterial.dispose();
    this.sharedHorizonWaterMaterial.dispose();
    this.sharedPotatoVoxelMaterial?.dispose();
    this.sharedCartoonVoxelMaterial?.dispose();
  }

  public getSurfaceHeightAt(wx: number, wz: number): number {
    return this.probeGroundBelow(wx, 48, wz, 1.0).y;
  }

  public get waterMesh(): THREE.Mesh | null {
    return null;
  }
}