import * as THREE from 'three';
import { WORLD_CHUNKS_X, type WorldGenMode } from './constants.ts';
import {
  CHUNK_SIZE_METERS,
  CHUNK_SIZE_METERS_BIGINT,
  doesTileContainChunkBigInt,
  enumerateRingTilesBigInt,
  type BigSectorPosition,
  type ChunkBoxBigInt,
  type DynamicLodPlan,
  type HorizonTileCoordBigInt,
  type NestedRingBoxesBigInt,
} from './distantHorizonMath.ts';
import type {
  HorizonTileJobResponse,
  LodSubMeshPayload,
  ModifiedChunkSurfaceStamp,
} from './meshWorker.ts';
import type { MultiCoreMeshWorkerPool } from './meshWorkerPool.ts';

interface CosmicTileGeometryCache {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertCount: number;
  indexCount: number;
}

interface CosmicBandBatch {
  scaleBand: number;
  bandScaleMetersBig: bigint;
  anchorXBig: bigint;
  anchorZBig: bigint;
  mesh: THREE.Mesh | null;
  tileCount: number;
  totalQuads: number;
  dirty: boolean;
}

interface HorizonTileRecord {
  key: string;
  level: number;
  tx: number;
  tz: number;
  txBig: bigint;
  tzBig: bigint;
  tileChunks: number;
  tileChunksBig: bigint;
  stepVoxels: number;
  stepVoxelsBig: bigint;
  gridCells: number;
  scaleBand: number;
  bandScaleMetersBig: bigint;
  minCXBig: bigint;
  maxCXExclBig: bigint;
  minCZBig: bigint;
  maxCZExclBig: bigint;
  originX: number;
  originZ: number;
  originXBig: bigint;
  originZBig: bigint;
  /** Width of this tile in its own scale-band units (always <= 8192) */
  scaledSize: number;
  opaqueMesh: THREE.Mesh | null;
  waterMesh: THREE.Mesh | null;
  /** Compact band-scaled geometry retained for cosmic tiles (scaleBand >= 1) merged into 1 draw call per band */
  cosmicGeo: CosmicTileGeometryCache | null;
  boundingSphere: THREE.Sphere;
  opaqueQuads: number;
  waterQuads: number;
  hasMesh: boolean;
  pending: boolean;
  dirty: boolean;
  stampVersion: number;
  lastUsedMs: number;
}

interface CompletedHorizonJob {
  tileKey: string;
  generationId: number;
  stampVersion: number;
  res: HorizonTileJobResponse;
}

export interface HorizonUpdateParams {
  plan: DynamicLodPlan;
  nestedBoxes: NestedRingBoxesBigInt;
  centerCX: number;
  centerCZ: number;
  /** Optional zoomed LOD0 focus box where distant terrain is rendered at full crisp LOD0 */
  zoomLod0Box?: ChunkBoxBigInt | null;
  /** Optional exact BigInt camera sector position for cosmic scale-band anchoring */
  cameraBigSector?: BigSectorPosition | null;
  /** Optional camera forward direction (world space) */
  cameraForward?: THREE.Vector3 | null;
  worldGenMode: WorldGenMode;
  flatBaseplateMat: number;
  frustum: THREE.Frustum | null;
  isLowEndMode: boolean;
  isLod0RegionReady: (
    minCX: number,
    maxCXExcl: number,
    minCZ: number,
    maxCZExcl: number,
  ) => boolean;
  nowMs: number;
  /** When true, holds off dispatching new outer mega-tile jobs so inner LOD0 spawn chunks get 100% worker CPU first */
  deferNewDispatches?: boolean;
  /** Optional planetary curvature radius in meters (0 = flat world, > 0 expands vertical frustum bounds for far curved tiles) */
  planetCurvatureRadius?: number;
}

export interface HorizonFrameStats {
  activeRings: number;
  visibleTiles: number;
  visibleQuads: number;
  pendingJobs: number;
  cachedTiles: number;
}

const EMPTY_KEY_SET: ReadonlySet<string> = new Set<string>();
const HALF_WORLD_CHUNKS = WORLD_CHUNKS_X * 0.5;
const HALF_WORLD_CHUNKS_BIG = BigInt(WORLD_CHUNKS_X >> 1);
const HALF_WORLD_METERS_BIG = HALF_WORLD_CHUNKS_BIG * CHUNK_SIZE_METERS_BIGINT; // 128n
const _curvedCullSphere = new THREE.Sphere();

function floorDivBigInt(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  return r < 0n ? q - 1n : q;
}

function computeTileBoundingSphere(
  originX: number,
  originZ: number,
  sizeMeters: number,
): THREE.Sphere {
  const half = sizeMeters * 0.5;
  // Terrain Y spans [0 .. ~76m]; center at Y=28 with vertical half-extent 52m covers peaks & valleys
  const radius = Math.hypot(half, 52, half) + 4;
  return new THREE.Sphere(
    new THREE.Vector3(originX + half, 28, originZ + half),
    radius,
  );
}

/**
 * Manages the Distant Horizons dynamic mega-tile rings (`LOD1 .. LOD110`, up to `10^31 + 1 km`)!
 * - Band 0 (local rings 1..9, up to ~16 km): individual mega-tile meshes with frustum culling,
 *   water meshes, crater stamps, and seamless bi-directional LOD0 <-> LOD1 bridging.
 * - Cosmic Scale Bands 1..9 (16 km .. `10^31 + 1 km`): merges all active built tiles per band
 *   into **ONE SINGLE `THREE.Mesh` per Scale Band** (at most 9 draw calls total for the entire
 *   `10^31 + 1 km` universe!), keeping weak iGPUs and Pentium CPUs buttery-smooth!
 * - Caches desired ring tile enumeration across stationary frames and caps in-flight worker jobs
 *   so 108 rings never flood the worker queue or stall the main thread.
 */
export class DistantHorizonManager {
  public readonly group: THREE.Group;
  public activeRings = 0;
  public visibleTiles = 0;
  public visibleQuads = 0;

  private readonly scene: THREE.Scene;
  private readonly workerPool: MultiCoreMeshWorkerPool;
  private opaqueMaterial: THREE.Material;
  private waterMaterial: THREE.Material;

  private tiles = new Map<string, HorizonTileRecord>();
  private cosmicBands = new Map<number, CosmicBandBatch>();
  private modifiedStamps = new Map<string, ModifiedChunkSurfaceStamp>();
  private completedQueue: CompletedHorizonJob[] = [];

  private generationId = 1;
  private lastWorldGenMode: WorldGenMode | null = null;
  private lastFlatBaseplateMat = -1;
  private activeKeySet = new Set<string>();
  private bridgeKeySet = new Set<string>();
  private activeRingLevels = new Set<number>();

  private lastEnumSignature = '';
  private cachedDesiredCoords: Array<{
    coord: HorizonTileCoordBigInt;
    tileChunks: number;
    stepVoxels: number;
    gridCells: number;
  }> = [];

  constructor(
    scene: THREE.Scene,
    workerPool: MultiCoreMeshWorkerPool,
    opaqueMaterial: THREE.Material,
    waterMaterial: THREE.Material,
  ) {
    this.scene = scene;
    this.workerPool = workerPool;
    this.opaqueMaterial = opaqueMaterial;
    this.waterMaterial = waterMaterial;

    this.group = new THREE.Group();
    this.group.name = 'DistantHorizonGroup';
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
    this.scene.add(this.group);
  }

  public syncOpaqueMaterial(mat: THREE.Material): void {
    this.opaqueMaterial = mat;
    this.tiles.forEach((tile) => {
      if (tile.opaqueMesh) {
        tile.opaqueMesh.material = mat;
      }
    });
    this.cosmicBands.forEach((batch) => {
      if (batch.mesh) {
        batch.mesh.material = mat;
      }
    });
  }

  public syncWaterMaterial(mat: THREE.Material): void {
    this.waterMaterial = mat;
    this.tiles.forEach((tile) => {
      if (tile.waterMesh) {
        tile.waterMesh.material = mat;
      }
    });
  }

  public setAllVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Registers or updates a compact 16x16 surface stamp for a player-modified chunk
   * and marks every Band-0 cached mega-tile containing `(cx, cz)` dirty so craters/structures
   * automatically propagate to outer LOD rings.
   */
  public setModifiedChunkStamp(stamp: ModifiedChunkSurfaceStamp): void {
    const chunkKey = `${stamp.cx},${stamp.cz}`;
    this.modifiedStamps.set(chunkKey, stamp);
    const cxBig = BigInt(stamp.cx);
    const czBig = BigInt(stamp.cz);
    this.tiles.forEach((tile) => {
      if (tile.scaleBand === 0 && doesTileContainChunkBigInt(tile, cxBig, czBig)) {
        tile.dirty = true;
        tile.stampVersion++;
      }
    });
  }

  public getModifiedStampCount(): number {
    return this.modifiedStamps.size;
  }

  /**
   * Returns true if chunk `(cx, cz)` is already covered by a built (`hasMesh === true`) active
   * horizon mega-tile, allowing `world.ts` to keep outgoing LOD0 chunks visible until their
   * replacement LOD1 mega-tile is ready (zero blue skybox gaps!).
   */
  public isChunkCoveredByReadyTile(cx: number, cz: number): boolean {
    if (!this.group.visible) return false;
    const cxBig = BigInt(cx);
    const czBig = BigInt(cz);
    let covered = false;
    this.activeKeySet.forEach((key) => {
      if (covered) return;
      const tile = this.tiles.get(key);
      if (tile && tile.scaleBand === 0 && tile.hasMesh && doesTileContainChunkBigInt(tile, cxBig, czBig)) {
        covered = true;
      }
    });
    return covered;
  }

  public clearAll(clearStamps = true): void {
    this.generationId++;
    this.completedQueue.length = 0;
    this.lastEnumSignature = '';
    this.cachedDesiredCoords.length = 0;
    this.tiles.forEach((tile) => {
      this.disposeTileMeshes(tile);
    });
    this.tiles.clear();
    this.cosmicBands.forEach((batch) => {
      if (batch.mesh) {
        this.group.remove(batch.mesh);
        batch.mesh.geometry.dispose();
        batch.mesh = null;
      }
    });
    this.cosmicBands.clear();
    if (clearStamps) {
      this.modifiedStamps.clear();
    }
    this.workerPool.cancelStaleHorizonJobs(EMPTY_KEY_SET);
    this.activeRings = 0;
    this.visibleTiles = 0;
    this.visibleQuads = 0;
  }

  private disposeTileMeshes(tile: HorizonTileRecord): void {
    if (tile.opaqueMesh) {
      this.group.remove(tile.opaqueMesh);
      tile.opaqueMesh.geometry.dispose();
      tile.opaqueMesh = null;
    }
    if (tile.waterMesh) {
      this.group.remove(tile.waterMesh);
      tile.waterMesh.geometry.dispose();
      tile.waterMesh = null;
    }
    tile.cosmicGeo = null;
    tile.hasMesh = false;
    tile.opaqueQuads = 0;
    tile.waterQuads = 0;
  }

  private markCosmicBandDirty(scaleBand: number, bandScaleMetersBig: bigint): void {
    if (scaleBand <= 0) return;
    let batch = this.cosmicBands.get(scaleBand);
    if (!batch) {
      batch = {
        scaleBand,
        bandScaleMetersBig,
        anchorXBig: -HALF_WORLD_METERS_BIG,
        anchorZBig: -HALF_WORLD_METERS_BIG,
        mesh: null,
        tileCount: 0,
        totalQuads: 0,
        dirty: true,
      };
      this.cosmicBands.set(scaleBand, batch);
    } else {
      batch.dirty = true;
    }
  }

  private rebuildCosmicBandMesh(
    batch: CosmicBandBatch,
    centerWorldXBig: bigint,
    centerWorldZBig: bigint,
  ): void {
    // Anchor snapped to exact multiple of bandScaleMetersBig minus 128n so EVERY tile in this band
    // has an exact integer band-unit offset with ZERO remainder even at 10^34 m!
    const anchorXBig =
      floorDivBigInt(centerWorldXBig + HALF_WORLD_METERS_BIG, batch.bandScaleMetersBig) *
        batch.bandScaleMetersBig -
      HALF_WORLD_METERS_BIG;
    const anchorZBig =
      floorDivBigInt(centerWorldZBig + HALF_WORLD_METERS_BIG, batch.bandScaleMetersBig) *
        batch.bandScaleMetersBig -
      HALF_WORLD_METERS_BIG;

    batch.anchorXBig = anchorXBig;
    batch.anchorZBig = anchorZBig;

    let totalVerts = 0;
    let totalIndices = 0;
    let totalQuads = 0;
    const contributors: Array<{ tile: HorizonTileRecord; offX: number; offZ: number }> = [];

    this.activeKeySet.forEach((key) => {
      const tile = this.tiles.get(key);
      if (
        !tile ||
        tile.scaleBand !== batch.scaleBand ||
        !tile.hasMesh ||
        !tile.cosmicGeo
      ) {
        return;
      }
      const offXBig = (tile.originXBig - anchorXBig) / batch.bandScaleMetersBig;
      const offZBig = (tile.originZBig - anchorZBig) / batch.bandScaleMetersBig;
      const offX = Number(offXBig);
      const offZ = Number(offZBig);
      if (!Number.isFinite(offX) || !Number.isFinite(offZ)) return;
      contributors.push({ tile, offX, offZ });
      totalVerts += tile.cosmicGeo.vertCount;
      totalIndices += tile.cosmicGeo.indexCount;
      totalQuads += tile.opaqueQuads;
    });

    batch.tileCount = contributors.length;
    batch.totalQuads = totalQuads;
    batch.dirty = false;

    if (totalVerts === 0 || totalIndices === 0) {
      if (batch.mesh) {
        batch.mesh.visible = false;
      }
      return;
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(totalIndices);

    let vCursor = 0;
    let iCursor = 0;

    for (let c = 0; c < contributors.length; c++) {
      const { tile, offX, offZ } = contributors[c];
      const geo = tile.cosmicGeo!;
      const srcPos = geo.positions;
      const srcNorm = geo.normals;
      const srcCol = geo.colors;
      const srcIdx = geo.indices;
      const vLen3 = geo.vertCount * 3;
      const dstOff3 = vCursor * 3;

      for (let p = 0; p < vLen3; p += 3) {
        positions[dstOff3 + p] = srcPos[p] + offX;
        positions[dstOff3 + p + 1] = srcPos[p + 1];
        positions[dstOff3 + p + 2] = srcPos[p + 2] + offZ;
      }
      normals.set(srcNorm.subarray(0, vLen3), dstOff3);
      colors.set(srcCol.subarray(0, vLen3), dstOff3);

      for (let k = 0; k < geo.indexCount; k++) {
        indices[iCursor + k] = srcIdx[k] + vCursor;
      }

      vCursor += geo.vertCount;
      iCursor += geo.indexCount;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));

    if (batch.mesh) {
      batch.mesh.geometry.dispose();
      batch.mesh.geometry = geom;
      batch.mesh.material = this.opaqueMaterial;
    } else {
      const mesh = new THREE.Mesh(geom, this.opaqueMaterial);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.position.set(0, 0, 0);
      mesh.updateMatrix();
      this.group.add(mesh);
      batch.mesh = mesh;
    }

    batch.mesh.userData.scaleBand = batch.scaleBand;
    batch.mesh.userData.bandScaleMetersBig = batch.bandScaleMetersBig;
    batch.mesh.userData.worldOriginBigInt = {
      x: anchorXBig,
      y: 0n,
      z: anchorZBig,
    };
    batch.mesh.userData.worldOriginYOffset = 0;
    batch.mesh.visible = true;
  }

  private applyTileMetadata(
    mesh: THREE.Mesh,
    tile: HorizonTileRecord,
    yOffsetMeters: number,
  ): void {
    mesh.position.set(tile.originX, yOffsetMeters, tile.originZ);
    mesh.userData.worldOrigin64 = {
      x: tile.originX,
      y: yOffsetMeters,
      z: tile.originZ,
    };
    mesh.userData.scaleBand = 0;
    mesh.userData.bandScaleMetersBig = 1n;
    mesh.userData.worldOriginBigInt = {
      x: tile.originXBig,
      y: 0n,
      z: tile.originZBig,
    };
    mesh.userData.worldOriginYOffset = yOffsetMeters;
    mesh.updateMatrix();
  }

  private applySubMesh(
    tile: HorizonTileRecord,
    existingMesh: THREE.Mesh | null,
    payload: LodSubMeshPayload | null,
    material: THREE.Material,
    receiveShadow: boolean,
  ): { mesh: THREE.Mesh | null; quads: number } {
    const valid =
      payload !== null &&
      payload.vertCount > 0 &&
      payload.indexCount > 0 &&
      payload.positions !== null &&
      payload.normals !== null &&
      payload.colors !== null &&
      payload.indices !== null;

    if (!valid || !payload) {
      if (existingMesh) {
        this.group.remove(existingMesh);
        existingMesh.geometry.dispose();
      }
      return { mesh: null, quads: 0 };
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(payload.positions!, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(payload.normals!, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(payload.colors!, 3));
    geom.setIndex(new THREE.BufferAttribute(payload.indices!, 1));

    if (existingMesh) {
      existingMesh.geometry.dispose();
      existingMesh.geometry = geom;
      existingMesh.material = material;
      const curY =
        typeof existingMesh.userData.worldOriginYOffset === 'number'
          ? existingMesh.userData.worldOriginYOffset
          : 0;
      this.applyTileMetadata(existingMesh, tile, curY);
      return { mesh: existingMesh, quads: payload.mergedQuads };
    }

    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = false;
    mesh.receiveShadow = receiveShadow;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.applyTileMetadata(mesh, tile, 0);
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, quads: payload.mergedQuads };
  }

  private collectStampsForTile(
    tile: HorizonTileRecord,
  ): ModifiedChunkSurfaceStamp[] | undefined {
    if (tile.scaleBand > 0 || this.modifiedStamps.size === 0) return undefined;
    let list: ModifiedChunkSurfaceStamp[] | undefined;
    this.modifiedStamps.forEach((stamp) => {
      if (doesTileContainChunkBigInt(tile, BigInt(stamp.cx), BigInt(stamp.cz))) {
        if (!list) list = [];
        list.push(stamp);
      }
    });
    return list;
  }

  private flushCompletedUploads(maxUploads: number): void {
    let uploaded = 0;
    while (this.completedQueue.length > 0 && uploaded < maxUploads) {
      const item = this.completedQueue.shift()!;
      if (item.generationId !== this.generationId) continue;
      const tile = this.tiles.get(item.tileKey);
      if (!tile) continue;

      if (typeof item.res.originXBig === 'bigint' && typeof item.res.originZBig === 'bigint') {
        tile.originXBig = item.res.originXBig;
        tile.originZBig = item.res.originZBig;
        tile.originX = Number(tile.originXBig);
        tile.originZ = Number(tile.originZBig);
      } else if (Number.isFinite(item.res.originX) && Number.isFinite(item.res.originZ)) {
        tile.originX = item.res.originX;
        tile.originZ = item.res.originZ;
      }

      if (tile.scaleBand > 0) {
        // Store compact band-scaled payload for single-draw-call merged Scale-Band mesh!
        const p = item.res.opaque;
        if (
          p &&
          p.vertCount > 0 &&
          p.indexCount > 0 &&
          p.positions &&
          p.normals &&
          p.colors &&
          p.indices
        ) {
          tile.cosmicGeo = {
            positions: p.positions,
            normals: p.normals,
            colors: p.colors,
            indices: p.indices,
            vertCount: p.vertCount,
            indexCount: p.indexCount,
          };
          tile.opaqueQuads = p.mergedQuads;
        } else {
          tile.cosmicGeo = null;
          tile.opaqueQuads = 0;
        }
        tile.waterQuads = 0;
        tile.hasMesh = true;
        if (item.stampVersion === tile.stampVersion) {
          tile.dirty = false;
        }
        this.markCosmicBandDirty(tile.scaleBand, tile.bandScaleMetersBig);
      } else {
        const opaqueApplied = this.applySubMesh(
          tile,
          tile.opaqueMesh,
          item.res.opaque,
          this.opaqueMaterial,
          true,
        );
        tile.opaqueMesh = opaqueApplied.mesh;
        tile.opaqueQuads = opaqueApplied.quads;

        const waterApplied = this.applySubMesh(
          tile,
          tile.waterMesh,
          item.res.water,
          this.waterMaterial,
          false,
        );
        tile.waterMesh = waterApplied.mesh;
        tile.waterQuads = waterApplied.quads;

        tile.hasMesh = true;
        if (item.stampVersion === tile.stampVersion) {
          tile.dirty = false;
        }
      }
      uploaded++;
    }
  }

  public update(params: HorizonUpdateParams): HorizonFrameStats {
    const {
      plan,
      nestedBoxes,
      centerCX,
      centerCZ,
      zoomLod0Box = null,
      worldGenMode,
      flatBaseplateMat,
      frustum,
      isLowEndMode,
      isLod0RegionReady,
      nowMs,
      deferNewDispatches = false,
      planetCurvatureRadius = 0,
    } = params;

    if (
      this.lastWorldGenMode !== null &&
      (this.lastWorldGenMode !== worldGenMode ||
        this.lastFlatBaseplateMat !== flatBaseplateMat)
    ) {
      this.clearAll(false);
    }
    this.lastWorldGenMode = worldGenMode;
    this.lastFlatBaseplateMat = flatBaseplateMat;

    if (plan.rings.length === 0) {
      this.group.visible = false;
      this.workerPool.cancelStaleHorizonJobs(EMPTY_KEY_SET);
      this.activeRings = 0;
      this.visibleTiles = 0;
      this.visibleQuads = 0;
      return {
        activeRings: 0,
        visibleTiles: 0,
        visibleQuads: 0,
        pendingJobs: 0,
        cachedTiles: this.tiles.size,
      };
    }

    this.group.visible = true;

    // 1. Commit completed worker meshes under a bounded per-frame GPU upload budget
    const uploadBudget = isLowEndMode ? 8 : 16;
    this.flushCompletedUploads(uploadBudget);

    // 2. Enumerate desired tiles across all dynamic rings (cached when stationary for zero per-frame BigInt churn!)
    const centerCXFloor = Math.floor(centerCX);
    const centerCZFloor = Math.floor(centerCZ);
    const zoomSig = zoomLod0Box
      ? `${zoomLod0Box.minCX},${zoomLod0Box.maxCXExcl},${zoomLod0Box.minCZ},${zoomLod0Box.maxCZExcl}`
      : 'none';
    const enumSignature = `${centerCXFloor},${centerCZFloor}|${plan.renderDistanceChunksBig.toString()}|${plan.lodSpacing}|${plan.realChunkRadiusChunks}|${plan.rings.length}|${zoomSig}`;
    const enumChanged = enumSignature !== this.lastEnumSignature;
    const secondaryBoxes = zoomLod0Box ? [zoomLod0Box] : undefined;

    if (enumChanged) {
      this.lastEnumSignature = enumSignature;
      this.cachedDesiredCoords.length = 0;
      this.activeKeySet.clear();

      for (let i = 0; i < plan.rings.length; i++) {
        const ring = plan.rings[i];
        const innerBox =
          i === 0 ? nestedBoxes.lod0Box : nestedBoxes.ringOuterBoxes[i - 1];
        const outerBox = nestedBoxes.ringOuterBoxes[i];
        const ringCoords = enumerateRingTilesBigInt(
          ring,
          innerBox,
          outerBox,
          ring.scaleBand === 0 ? secondaryBoxes : undefined,
        );
        for (let j = 0; j < ringCoords.length; j++) {
          const coord = ringCoords[j];
          this.activeKeySet.add(coord.key);
          this.cachedDesiredCoords.push({
            coord,
            tileChunks: ring.tileChunks,
            stepVoxels: ring.stepVoxels,
            gridCells: ring.gridCells,
          });
        }
      }

      // Mark all cosmic bands dirty when the active ring set changes so band meshes stay synchronized
      this.cosmicBands.forEach((batch) => {
        batch.dirty = true;
      });
    }

    const toBuild: Array<{ tile: HorizonTileRecord; priority: number }> = [];
    const unbuiltBand0DesiredTiles: HorizonTileRecord[] = [];
    const centerCXBig = BigInt(centerCXFloor);
    const centerCZBig = BigInt(centerCZFloor);
    let inFlightPendingCount = 0;

    for (let idx = 0; idx < this.cachedDesiredCoords.length; idx++) {
      const entry = this.cachedDesiredCoords[idx];
      const coord = entry.coord;
      let tile = this.tiles.get(coord.key);
      if (!tile) {
        const originXBig = (coord.minCXBig - HALF_WORLD_CHUNKS_BIG) * CHUNK_SIZE_METERS_BIGINT;
        const originZBig = (coord.minCZBig - HALF_WORLD_CHUNKS_BIG) * CHUNK_SIZE_METERS_BIGINT;
        const originX = Number(originXBig);
        const originZ = Number(originZBig);
        const tileWorldMetersBig = coord.tileChunksBig * CHUNK_SIZE_METERS_BIGINT;
        const scaledSize =
          coord.bandScaleMetersBig <= 1n
            ? Number(tileWorldMetersBig)
            : Number(tileWorldMetersBig / coord.bandScaleMetersBig) +
              Number(tileWorldMetersBig % coord.bandScaleMetersBig) /
                Number(coord.bandScaleMetersBig);

        tile = {
          key: coord.key,
          level: coord.level,
          tx: Number(coord.txBig),
          tz: Number(coord.tzBig),
          txBig: coord.txBig,
          tzBig: coord.tzBig,
          tileChunks: entry.tileChunks,
          tileChunksBig: coord.tileChunksBig,
          stepVoxels: entry.stepVoxels,
          stepVoxelsBig: coord.tileChunksBig,
          gridCells: entry.gridCells,
          scaleBand: coord.scaleBand,
          bandScaleMetersBig: coord.bandScaleMetersBig,
          minCXBig: coord.minCXBig,
          maxCXExclBig: coord.maxCXExclBig,
          minCZBig: coord.minCZBig,
          maxCZExclBig: coord.maxCZExclBig,
          originX,
          originZ,
          originXBig,
          originZBig,
          scaledSize,
          opaqueMesh: null,
          waterMesh: null,
          cosmicGeo: null,
          boundingSphere:
            coord.scaleBand === 0
              ? computeTileBoundingSphere(originX, originZ, Number(tileWorldMetersBig))
              : new THREE.Sphere(new THREE.Vector3(0, 0, 0), scaledSize),
          opaqueQuads: 0,
          waterQuads: 0,
          hasMesh: false,
          pending: false,
          dirty: true,
          stampVersion: 0,
          lastUsedMs: nowMs,
        };
        this.tiles.set(coord.key, tile);
      } else {
        tile.lastUsedMs = nowMs;
      }

      if (tile.pending) {
        inFlightPendingCount++;
      }

      if (!tile.hasMesh && tile.scaleBand === 0) {
        unbuiltBand0DesiredTiles.push(tile);
      }

      if ((!tile.hasMesh || tile.dirty) && !tile.pending) {
        const halfTileBig = tile.tileChunksBig >> 1n;
        const relX =
          Number(tile.minCXBig + halfTileBig - centerCXBig) /
          Math.max(1, Number(tile.tileChunksBig));
        const relZ =
          Number(tile.minCZBig + halfTileBig - centerCZBig) /
          Math.max(1, Number(tile.tileChunksBig));
        const normalizedDist = Math.hypot(relX, relZ);
        const dirtyBoost = tile.hasMesh && tile.dirty ? -40 : 0;
        const priority =
          600 + tile.level * 120 + normalizedDist * 8 + dirtyBoost;
        toBuild.push({ tile, priority });
      }
    }

    // 3. Universal Bi-Directional Seamless LOD Bridge for Band 0 (LOD0 <-> LOD1 <-> ... <-> LOD9)
    this.bridgeKeySet.clear();
    const lod0Box = nestedBoxes.lod0Box;
    const unbuiltBand0Count = unbuiltBand0DesiredTiles.length;
    this.tiles.forEach((tile, key) => {
      if (tile.scaleBand > 0 || !tile.hasMesh || this.activeKeySet.has(key)) return;

      let needsBridge = false;

      const ix0 = tile.minCXBig > lod0Box.minCX ? tile.minCXBig : lod0Box.minCX;
      const ix1 = tile.maxCXExclBig < lod0Box.maxCXExcl ? tile.maxCXExclBig : lod0Box.maxCXExcl;
      const iz0 = tile.minCZBig > lod0Box.minCZ ? tile.minCZBig : lod0Box.minCZ;
      const iz1 = tile.maxCZExclBig < lod0Box.maxCZExcl ? tile.maxCZExclBig : lod0Box.maxCZExcl;
      if (ix0 < ix1 && iz0 < iz1) {
        if (!isLod0RegionReady(Number(ix0), Number(ix1), Number(iz0), Number(iz1))) {
          needsBridge = true;
        }
      }

      if (!needsBridge && zoomLod0Box !== null) {
        const zx0 = tile.minCXBig > zoomLod0Box.minCX ? tile.minCXBig : zoomLod0Box.minCX;
        const zx1 = tile.maxCXExclBig < zoomLod0Box.maxCXExcl ? tile.maxCXExclBig : zoomLod0Box.maxCXExcl;
        const zz0 = tile.minCZBig > zoomLod0Box.minCZ ? tile.minCZBig : zoomLod0Box.minCZ;
        const zz1 = tile.maxCZExclBig < zoomLod0Box.maxCZExcl ? tile.maxCZExclBig : zoomLod0Box.maxCZExcl;
        if (zx0 < zx1 && zz0 < zz1) {
          if (!isLod0RegionReady(Number(zx0), Number(zx1), Number(zz0), Number(zz1))) {
            needsBridge = true;
          }
        }
      }

      if (!needsBridge && unbuiltBand0Count > 0) {
        for (let u = 0; u < unbuiltBand0Count; u++) {
          const target = unbuiltBand0DesiredTiles[u];
          if (
            tile.minCXBig < target.maxCXExclBig &&
            tile.maxCXExclBig > target.minCXBig &&
            tile.minCZBig < target.maxCZExclBig &&
            tile.maxCZExclBig > target.minCZBig
          ) {
            needsBridge = true;
            break;
          }
        }
      }

      if (needsBridge) {
        this.bridgeKeySet.add(key);
        tile.lastUsedMs = nowMs;
      }
    });

    // 4. Drop queued worker jobs for tiles the player has already moved away from (only when enum changed)
    if (enumChanged) {
      this.workerPool.cancelStaleHorizonJobs(this.activeKeySet);
    }

    // 5. Dispatch highest-priority missing/dirty tiles with a strict in-flight cap so worker queues stay lean
    const maxPendingHorizonJobs = isLowEndMode ? 6 : 14;
    if (!deferNewDispatches && toBuild.length > 0 && inFlightPendingCount < maxPendingHorizonJobs) {
      toBuild.sort((a, b) => a.priority - b.priority);
      const room = maxPendingHorizonJobs - inFlightPendingCount;
      const dispatchBudget = Math.min(room, isLowEndMode ? 6 : 12);
      const limit = Math.min(dispatchBudget, toBuild.length);
      for (let i = 0; i < limit; i++) {
        const { tile, priority } = toBuild[i];
        tile.pending = true;
        inFlightPendingCount++;
        const jobGenId = this.generationId;
        const jobStampVer = tile.stampVersion;
        const stamps = this.collectStampsForTile(tile);

        this.workerPool
          .enqueueHorizonTileJob(
            {
              tileKey: tile.key,
              level: tile.level,
              tx: tile.tx,
              tz: tile.tz,
              tileChunks: tile.tileChunks,
              stepVoxels: tile.stepVoxels,
              txBig: tile.txBig,
              tzBig: tile.tzBig,
              tileChunksBig: tile.tileChunksBig,
              stepVoxelsBig: tile.stepVoxelsBig,
              gridCells: tile.gridCells,
              scaleBand: tile.scaleBand,
              bandScaleMetersBig: tile.bandScaleMetersBig,
              worldGenMode,
              flatBaseplateMat,
              stamps,
            },
            priority,
          )
          .then((res) => {
            tile.pending = false;
            if (jobGenId !== this.generationId) return;
            this.completedQueue.push({
              tileKey: tile.key,
              generationId: jobGenId,
              stampVersion: jobStampVer,
              res,
            });
          })
          .catch(() => {
            tile.pending = false;
          });
      }
    }

    // 6. Rebuild at most 2 dirty Cosmic Scale-Band merged meshes per frame (1 draw call per band!)
    const centerWorldXBig = (centerCXBig - HALF_WORLD_CHUNKS_BIG) * CHUNK_SIZE_METERS_BIGINT;
    const centerWorldZBig = (centerCZBig - HALF_WORLD_CHUNKS_BIG) * CHUNK_SIZE_METERS_BIGINT;
    let rebuiltBandsThisFrame = 0;
    this.cosmicBands.forEach((batch) => {
      if (batch.dirty && rebuiltBandsThisFrame < 2) {
        this.rebuildCosmicBandMesh(batch, centerWorldXBig, centerWorldZBig);
        rebuiltBandsThisFrame++;
      }
    });

    // 7. Frustum cull Band-0 tiles and tally visible stats across Band 0 + Cosmic Scale Bands 1..9
    this.activeRingLevels.clear();
    let visibleTiles = 0;
    let visibleQuads = 0;
    const inv2R =
      planetCurvatureRadius > 0 ? 1.0 / (2.0 * planetCurvatureRadius) : 0;
    const focusWorldX = (centerCX - HALF_WORLD_CHUNKS) * CHUNK_SIZE_METERS;
    const focusWorldZ = (centerCZ - HALF_WORLD_CHUNKS) * CHUNK_SIZE_METERS;

    this.tiles.forEach((tile, key) => {
      const isActive = this.activeKeySet.has(key);
      if (tile.scaleBand > 0) {
        if (isActive && tile.hasMesh) {
          this.activeRingLevels.add(tile.level);
        }
        return;
      }

      const isBridgeOnly = !isActive && this.bridgeKeySet.has(key);
      if ((isActive || isBridgeOnly) && tile.hasMesh) {
        let inFrustum = true;
        if (frustum !== null) {
          if (inv2R > 0 && tile.level >= 4) {
            const sc = tile.boundingSphere.center;
            const dx = sc.x - focusWorldX;
            const dz = sc.z - focusWorldZ;
            const drop = Math.min((dx * dx + dz * dz) * inv2R, 650_000);
            _curvedCullSphere.center.set(sc.x, sc.y - drop * 0.65, sc.z);
            _curvedCullSphere.radius = tile.boundingSphere.radius + drop * 0.55;
            inFrustum = frustum.intersectsSphere(_curvedCullSphere);
          } else {
            inFrustum = frustum.intersectsSphere(tile.boundingSphere);
          }
        }

        const overlapsZoomBox =
          zoomLod0Box !== null &&
          tile.minCXBig < zoomLod0Box.maxCXExcl &&
          tile.maxCXExclBig > zoomLod0Box.minCX &&
          tile.minCZBig < zoomLod0Box.maxCZExcl &&
          tile.maxCZExclBig > zoomLod0Box.minCZ;
        const targetY = isBridgeOnly
          ? -Math.min(0.6, 0.12 * tile.level)
          : overlapsZoomBox
            ? -0.45
            : 0;
        if (tile.opaqueMesh) {
          if (tile.opaqueMesh.userData.worldOriginYOffset !== targetY) {
            this.applyTileMetadata(tile.opaqueMesh, tile, targetY);
          }
          tile.opaqueMesh.visible = inFrustum;
        }
        if (tile.waterMesh) {
          if (tile.waterMesh.userData.worldOriginYOffset !== targetY) {
            this.applyTileMetadata(tile.waterMesh, tile, targetY);
          }
          tile.waterMesh.visible = inFrustum;
        }
        if (inFrustum) {
          visibleTiles++;
          visibleQuads += tile.opaqueQuads + tile.waterQuads;
          this.activeRingLevels.add(tile.level);
        }
      } else {
        if (tile.opaqueMesh) tile.opaqueMesh.visible = false;
        if (tile.waterMesh) tile.waterMesh.visible = false;
      }
    });

    this.cosmicBands.forEach((batch) => {
      if (batch.mesh && batch.mesh.visible && batch.tileCount > 0) {
        visibleTiles += batch.tileCount;
        visibleQuads += batch.totalQuads;
      }
    });

    // 8. Bounded LRU cache eviction for stale out-of-range tiles
    const maxCachedTiles = Math.max(
      isLowEndMode ? 360 : 720,
      this.activeKeySet.size + 128,
    );
    if (this.tiles.size > maxCachedTiles) {
      const evictCandidates: HorizonTileRecord[] = [];
      this.tiles.forEach((tile, key) => {
        if (
          !this.activeKeySet.has(key) &&
          !this.bridgeKeySet.has(key) &&
          !tile.pending
        ) {
          evictCandidates.push(tile);
        }
      });
      if (evictCandidates.length > 0) {
        evictCandidates.sort((a, b) => a.lastUsedMs - b.lastUsedMs);
        const toEvict = Math.min(
          evictCandidates.length,
          this.tiles.size - maxCachedTiles + 24,
        );
        for (let i = 0; i < toEvict; i++) {
          const victim = evictCandidates[i];
          this.disposeTileMeshes(victim);
          this.tiles.delete(victim.key);
        }
      }
    }

    this.activeRings = this.activeRingLevels.size;
    this.visibleTiles = visibleTiles;
    this.visibleQuads = visibleQuads;

    return {
      activeRings: this.activeRings,
      visibleTiles,
      visibleQuads,
      pendingJobs: inFlightPendingCount,
      cachedTiles: this.tiles.size,
    };
  }

  public dispose(): void {
    this.clearAll(true);
    this.scene.remove(this.group);
  }
}
