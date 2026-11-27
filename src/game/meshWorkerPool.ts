import {
  buildAllLodPayloadsForChunk,
  buildHorizonTilePayload,
  type ChunkMeshJobRequest,
  type ChunkMeshJobResponse,
  type ChunkNeighborBoundarySlices,
  type HorizonTileJobRequest,
  type HorizonTileJobResponse,
  type LodSubMeshPayload,
  type ModifiedChunkSurfaceStamp,
  type WorkerInitSlabRequest,
  type WorkerPingRequest,
  type WorkerPingResponse,
} from './meshWorker.ts';
import type { WorldGenMode } from './constants.ts';
import { MAT_BUCKET_ALL_MASK, warmUpGreedyMesherScratchpad } from './physicsMath.ts';
import { perfProfiler } from '../engine/perf/PerfProfiler';

export const MAX_CONCURRENT_CHUNK_LOADS = 4;

const EMPTY_VOXELS = new Uint8Array(0);

export interface EnqueueChunkExtraOptions {
  priorityScore?: number;
  slotIndex?: number;
  useSharedSlab?: boolean;
  generateSurfaceTerrain?: boolean;
  worldGenMode?: WorldGenMode;
  flatBaseplateMat?: number;
  buildSurfaceLods?: boolean;
  lod12Only?: boolean;
}

type AnyWorkerJobRequest = ChunkMeshJobRequest | HorizonTileJobRequest;
type AnyWorkerJobResponse = ChunkMeshJobResponse | HorizonTileJobResponse;

interface QueuedJob {
  req: AnyWorkerJobRequest;
  priorityScore: number;
  resolvers: Array<(res: AnyWorkerJobResponse) => void>;
  rejecters: Array<(err: Error) => void>;
}

interface WorkerSharedArena {
  voxelsSab: SharedArrayBuffer;
  voxelsView: Uint8Array;
  colorsSab: SharedArrayBuffer | null;
  colorsView: Uint8Array | null;
  westSab: SharedArrayBuffer;
  westView: Uint8Array;
  eastSab: SharedArrayBuffer;
  eastView: Uint8Array;
  northSab: SharedArrayBuffer;
  northView: Uint8Array;
  southSab: SharedArrayBuffer;
  southView: Uint8Array;
}

const MAX_CHUNK_VOXELS_BYTES = 64 * 320 * 64;
const MAX_BORDER_SLICE_BYTES = 64 * 320;

/**
 * Multi-Core CPU Web Worker Pool that scales across `navigator.hardwareConcurrency` cores!
 * - Uses `SharedArrayBuffer` zero-copy arenas when `crossOriginIsolated` is active, with transferable `ArrayBuffer` fallback
 * - Lazy-allocates full-depth 3D staging SABs ONLY when a non-surface 3D chunk is actually meshed (saves 10-21 MB RAM!)
 * - Uses 1 dedicated worker on dual-core CPUs (e.g. Pentium) so workers never starve the main render/physics thread.
 */
export class MultiCoreMeshWorkerPool {
  public readonly coreCount: number;
  public readonly activeWorkers: number;
  public readonly hasDedicatedWorkers: boolean;
  public readonly usesSharedArrayBuffer: boolean;
  public hasSharedSurfaceSlab = false;
  public completedJobs = 0;
  public pingCount = 0;

  private readonly maxConcurrentJobs: number;
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private inFlightCount = 0;
  private workerSharedArenas = new Map<Worker, WorkerSharedArena>();
  private activeJobByWorker = new Map<Worker, number>();
  private queue: QueuedJob[] = [];
  private pendingCallbacks = new Map<
    number,
    {
      resolvers: Array<(res: AnyWorkerJobResponse) => void>;
      rejecters: Array<(err: Error) => void>;
    }
  >();
  private nextJobId = 1;
  private jobDispatchTimeMs = new Map<number, number>();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const detectedCores =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;
    this.coreCount = Math.max(2, detectedCores);
    // On dual-core CPUs (Pentium / Celeron / low-end laptops), spawn 1 worker so the main thread
    // keeps a dedicated physical core and saves ~30-40 MB of extra V8 worker isolate RAM!
    const targetWorkerCount =
      this.coreCount <= 2
        ? 1
        : Math.min(
            MAX_CONCURRENT_CHUNK_LOADS,
            Math.max(2, Math.floor(this.coreCount / 2)),
          );
    this.maxConcurrentJobs = targetWorkerCount;

    const canUseSab =
      typeof SharedArrayBuffer !== 'undefined' &&
      Boolean((globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated);
    this.usesSharedArrayBuffer = canUseSab;

    if (typeof Worker !== 'undefined') {
      try {
        for (let i = 0; i < targetWorkerCount; i++) {
          const w = new Worker(new URL('./meshWorker.ts', import.meta.url), {
            type: 'module',
          });
          w.onmessage = (
            e: MessageEvent<ChunkMeshJobResponse | HorizonTileJobResponse | WorkerPingResponse>,
          ) => {
            this.handleWorkerResponse(w, e.data);
          };
          w.onerror = (evt: ErrorEvent) => {
            if (typeof console !== 'undefined' && console.error) {
              console.error('[MeshWorkerPool] worker error:', evt?.message || evt);
            }
            // Recover active job and dispatch next queued job so worker pool never deadlocks
            const failedJobId = this.activeJobByWorker.get(w);
            if (failedJobId !== undefined) {
              this.activeJobByWorker.delete(w);
              this.inFlightCount = Math.max(0, this.inFlightCount - 1);
              const cb = this.pendingCallbacks.get(failedJobId);
              if (cb) {
                this.pendingCallbacks.delete(failedJobId);
                const err = new Error(evt?.message || 'Mesh worker error');
                for (let k = 0; k < cb.rejecters.length; k++) {
                  cb.rejecters[k](err);
                }
              }
            }
            if (this.queue.length > 0 && this.inFlightCount < this.maxConcurrentJobs) {
              const next = this.popBestQueuedJob()!;
              this.inFlightCount++;
              this.dispatchToWorker(w, next);
            } else if (!this.idleWorkers.includes(w)) {
              this.idleWorkers.push(w);
            }
          };
          this.workers.push(w);
          this.idleWorkers.push(w);
        }
      } catch {
        this.workers = [];
        this.idleWorkers = [];
        this.workerSharedArenas.clear();
      }
    }
    this.hasDedicatedWorkers = this.workers.length > 0;
    this.activeWorkers = Math.max(1, this.workers.length || targetWorkerCount);

    // Pre-warm the worker pool immediately; use gentler keepalive cadence on dual-core CPUs
    warmUpGreedyMesherScratchpad();
    if (this.hasDedicatedWorkers) {
      this.pingIdleWorkers();
      const pingIntervalMs = this.coreCount <= 2 ? 4000 : 1500;
      this.keepAliveTimer = setInterval(() => {
        this.pingIdleWorkers();
      }, pingIntervalMs);
      if (typeof (this.keepAliveTimer as any)?.unref === 'function') {
        (this.keepAliveTimer as any).unref();
      }
    }
  }

  private getOrCreateSharedArena(worker: Worker, needsColors: boolean): WorkerSharedArena | null {
    if (!this.usesSharedArrayBuffer) return null;
    let arena = this.workerSharedArenas.get(worker);
    if (!arena) {
      try {
        const voxelsSab = new SharedArrayBuffer(MAX_CHUNK_VOXELS_BYTES);
        const westSab = new SharedArrayBuffer(MAX_BORDER_SLICE_BYTES);
        const eastSab = new SharedArrayBuffer(MAX_BORDER_SLICE_BYTES);
        const northSab = new SharedArrayBuffer(MAX_BORDER_SLICE_BYTES);
        const southSab = new SharedArrayBuffer(MAX_BORDER_SLICE_BYTES);
        arena = {
          voxelsSab,
          voxelsView: new Uint8Array(voxelsSab),
          colorsSab: null,
          colorsView: null,
          westSab,
          westView: new Uint8Array(westSab),
          eastSab,
          eastView: new Uint8Array(eastSab),
          northSab,
          northView: new Uint8Array(northSab),
          southSab,
          southView: new Uint8Array(southSab),
        };
        this.workerSharedArenas.set(worker, arena);
      } catch {
        return null;
      }
    }
    if (needsColors && !arena.colorsSab) {
      try {
        const colorsSab = new SharedArrayBuffer(MAX_CHUNK_VOXELS_BYTES * 3);
        arena.colorsSab = colorsSab;
        arena.colorsView = new Uint8Array(colorsSab);
      } catch {
        // Fallback to non-SAB transfer if allocation fails
      }
    }
    return arena;
  }

  /**
   * Shares the single VoxelWorld SharedArrayBuffer surface slab once with every worker
   * so workers read/write surface chunks directly by `slotIndex` with zero cloning or copying!
   */
  public attachSharedSurfaceSlab(
    surfaceVoxelsSab: SharedArrayBuffer | null,
    surfaceHeightSab: SharedArrayBuffer | null,
    surfaceVoxelsStride: number,
    surfaceHeightStride: number,
    surfaceSlabCapacity: number,
  ): void {
    if (!surfaceVoxelsSab || !surfaceHeightSab || this.workers.length === 0) {
      this.hasSharedSurfaceSlab = false;
      return;
    }
    const msg: WorkerInitSlabRequest = {
      type: 'initSlab',
      surfaceVoxelsSab,
      surfaceHeightSab,
      surfaceVoxelsStride,
      surfaceHeightStride,
      surfaceSlabCapacity,
    };
    for (let i = 0; i < this.workers.length; i++) {
      this.workers[i].postMessage(msg);
    }
    this.hasSharedSurfaceSlab = true;
  }

  private popBestQueuedJob(): QueuedJob | undefined {
    const len = this.queue.length;
    if (len === 0) return undefined;
    let bestIdx = 0;
    let bestScore = this.queue[0].priorityScore;
    for (let i = 1; i < len; i++) {
      if (this.queue[i].priorityScore < bestScore) {
        bestScore = this.queue[i].priorityScore;
        bestIdx = i;
      }
    }
    const picked = this.queue[bestIdx];
    const last = this.queue.pop()!;
    if (bestIdx < this.queue.length) {
      this.queue[bestIdx] = last;
    }
    return picked;
  }

  /**
   * Drops queued jobs that have drifted outside `maxChebRad` of `(centerCX, centerCZ)`
   * so workers never waste CPU meshing chunks the player already drove past.
   */
  public cancelOutOfRangeJobs(
    centerCX: number,
    centerCZ: number,
    maxChebRad: number,
  ): number {
    if (this.queue.length === 0) return 0;
    let cancelled = 0;
    const cancelErr = new Error('Chunk mesh job out of range');
    let i = 0;
    while (i < this.queue.length) {
      const q = this.queue[i];
      if (q.req.type === 'horizonTile') {
        i++;
        continue;
      }
      const cheb = Math.max(
        Math.abs(q.req.cx - centerCX),
        Math.abs(q.req.cz - centerCZ),
      );
      if (cheb > maxChebRad) {
        const last = this.queue.pop()!;
        if (i < this.queue.length) {
          this.queue[i] = last;
        }
        for (let k = 0; k < q.rejecters.length; k++) {
          q.rejecters[k](cancelErr);
        }
        cancelled++;
      } else {
        i++;
      }
    }
    return cancelled;
  }

  /**
   * Drops queued horizon tile jobs whose tileKey is no longer in the active desired set.
   */
  public cancelStaleHorizonJobs(activeTileKeys: ReadonlySet<string>): number {
    if (this.queue.length === 0) return 0;
    let cancelled = 0;
    const cancelErr = new Error('Horizon tile job out of range');
    let i = 0;
    while (i < this.queue.length) {
      const q = this.queue[i];
      if (q.req.type === 'horizonTile' && !activeTileKeys.has(q.req.tileKey)) {
        const last = this.queue.pop()!;
        if (i < this.queue.length) {
          this.queue[i] = last;
        }
        for (let k = 0; k < q.rejecters.length; k++) {
          q.rejecters[k](cancelErr);
        }
        cancelled++;
      } else {
        i++;
      }
    }
    return cancelled;
  }

  public pingIdleWorkers(): number {
    if (this.workers.length === 0) {
      warmUpGreedyMesherScratchpad();
      this.pingCount++;
      return 1;
    }
    let sent = 0;
    for (let i = 0; i < this.idleWorkers.length; i++) {
      const w = this.idleWorkers[i];
      const pingMsg: WorkerPingRequest = {
        type: 'ping',
        jobId: this.nextJobId++,
      };
      w.postMessage(pingMsg);
      this.pingCount++;
      sent++;
    }
    return sent;
  }

  private unwrapTransferredPayload(p: LodSubMeshPayload | null | undefined): void {
    if (!p || p.vertCount === 0) return;
    if (p.positionsBuffer instanceof ArrayBuffer) {
      p.positions = new Float32Array(p.positionsBuffer, 0, p.vertCount * 3);
    }
    if (p.normalsBuffer instanceof ArrayBuffer) {
      p.normals = new Float32Array(p.normalsBuffer, 0, p.vertCount * 3);
    }
    if (p.colorsBuffer instanceof ArrayBuffer) {
      p.colors = new Float32Array(p.colorsBuffer, 0, p.vertCount * 3);
    }
    if (p.indicesBuffer instanceof ArrayBuffer) {
      p.indices = new Uint32Array(p.indicesBuffer, 0, p.indexCount);
    }
  }

  private handleWorkerResponse(
    worker: Worker,
    res: ChunkMeshJobResponse | HorizonTileJobResponse | WorkerPingResponse,
  ): void {
    if (res && res.type === 'pong') {
      return;
    }
    const _tRespStart = typeof performance !== 'undefined' ? performance.now() : 0;
    const sentAt = this.jobDispatchTimeMs.get(res.jobId);
    if (sentAt !== undefined) {
      this.jobDispatchTimeMs.delete(res.jobId);
      if (_tRespStart > 0) {
        perfProfiler.recordWorkerRoundTrip(_tRespStart - sentAt);
      }
    }
    this.activeJobByWorker.delete(worker);

    if (res.type === 'horizonTile') {
      this.unwrapTransferredPayload(res.opaque);
      this.unwrapTransferredPayload(res.water);
    } else {
      const meshRes = res as ChunkMeshJobResponse;
      this.unwrapTransferredPayload(meshRes.lod0);
      if (meshRes.lod0Buckets) {
        this.unwrapTransferredPayload(meshRes.lod0Buckets[0]);
        this.unwrapTransferredPayload(meshRes.lod0Buckets[1]);
        this.unwrapTransferredPayload(meshRes.lod0Buckets[2]);
      }
      this.unwrapTransferredPayload(meshRes.lod1);
      this.unwrapTransferredPayload(meshRes.lod2);
      this.unwrapTransferredPayload(meshRes.lod3);
      this.unwrapTransferredPayload(meshRes.transLod0);
      this.unwrapTransferredPayload(meshRes.transLod1);
      this.unwrapTransferredPayload(meshRes.transLod2);
      if (meshRes.generatedSurfaceVoxelsBuffer instanceof ArrayBuffer) {
        meshRes.generatedSurfaceVoxels = new Uint8Array(meshRes.generatedSurfaceVoxelsBuffer);
      }
      if (meshRes.generatedSurfaceHeightMapBuffer instanceof ArrayBuffer) {
        meshRes.generatedSurfaceHeightMap = new Uint16Array(meshRes.generatedSurfaceHeightMapBuffer);
      }
    }

    this.completedJobs++;
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    const cb = this.pendingCallbacks.get(res.jobId);
    if (cb) {
      this.pendingCallbacks.delete(res.jobId);
      for (let k = 0; k < cb.resolvers.length; k++) {
        cb.resolvers[k](res);
      }
    }
    if (_tRespStart > 0) {
      perfProfiler.recordWorkerMessage(performance.now() - _tRespStart);
    }

    if (this.queue.length > 0 && this.inFlightCount < this.maxConcurrentJobs) {
      const next = this.popBestQueuedJob()!;
      this.inFlightCount++;
      this.dispatchToWorker(worker, next);
    } else if (!this.idleWorkers.includes(worker)) {
      this.idleWorkers.push(worker);
    }
  }

  private dispatchToWorker(worker: Worker, job: QueuedJob): void {
    const _tSendStart = typeof performance !== 'undefined' ? performance.now() : 0;
    if (_tSendStart > 0) {
      this.jobDispatchTimeMs.set(job.req.jobId, _tSendStart);
    }
    this.activeJobByWorker.set(worker, job.req.jobId);
    this.pendingCallbacks.set(job.req.jobId, {
      resolvers: job.resolvers,
      rejecters: job.rejecters,
    });

    if (job.req.type === 'horizonTile') {
      worker.postMessage(job.req);
      if (_tSendStart > 0) {
        perfProfiler.recordWorkerMessage(performance.now() - _tSendStart);
      }
      return;
    }

    // Fast zero-copy path: worker either generates procedural surface terrain off-thread
    // or reads directly from the single shared VoxelWorld surface slab by slotIndex!
    if (
      job.req.generateSurfaceTerrain ||
      (job.req.useSharedSlab && this.hasSharedSurfaceSlab && job.req.isSurfaceOnly)
    ) {
      const payload: ChunkMeshJobRequest = {
        ...job.req,
        type: 'mesh',
        voxels: EMPTY_VOXELS,
        surfaceHeightMap: undefined,
        customColors: undefined,
        neighborBorders: undefined,
        pendingRemovals: undefined,
      };
      worker.postMessage(payload);
      if (_tSendStart > 0) {
        perfProfiler.recordWorkerMessage(performance.now() - _tSendStart);
      }
      return;
    }

    const arena = this.getOrCreateSharedArena(worker, Boolean(job.req.customColors));
    if (arena && job.req.voxels.byteLength <= arena.voxelsView.byteLength) {
      const vLen = job.req.voxels.byteLength;
      arena.voxelsView.set(job.req.voxels, 0);
      if (job.req.pendingRemovals && job.req.pendingRemovals.size > 0) {
        job.req.pendingRemovals.forEach((newMat, idx) => {
          if (idx >= 0 && idx < vLen) {
            arena.voxelsView[idx] = newMat;
          }
        });
      }
      const voxelsShared = new Uint8Array(arena.voxelsSab, 0, vLen);

      let customColorsShared: Uint8Array | undefined = undefined;
      if (
        job.req.customColors &&
        arena.colorsSab &&
        arena.colorsView &&
        job.req.customColors.byteLength <= arena.colorsView.byteLength
      ) {
        const cLen = job.req.customColors.byteLength;
        arena.colorsView.set(job.req.customColors, 0);
        customColorsShared = new Uint8Array(arena.colorsSab, 0, cLen);
      }

      let neighborBordersShared: ChunkNeighborBoundarySlices | undefined = undefined;
      if (job.req.neighborBorders) {
        neighborBordersShared = {};
        if (job.req.neighborBorders.west) {
          const bLen = job.req.neighborBorders.west.byteLength;
          arena.westView.set(job.req.neighborBorders.west, 0);
          neighborBordersShared.west = new Uint8Array(arena.westSab, 0, bLen);
        }
        if (job.req.neighborBorders.east) {
          const bLen = job.req.neighborBorders.east.byteLength;
          arena.eastView.set(job.req.neighborBorders.east, 0);
          neighborBordersShared.east = new Uint8Array(arena.eastSab, 0, bLen);
        }
        if (job.req.neighborBorders.north) {
          const bLen = job.req.neighborBorders.north.byteLength;
          arena.northView.set(job.req.neighborBorders.north, 0);
          neighborBordersShared.north = new Uint8Array(arena.northSab, 0, bLen);
        }
        if (job.req.neighborBorders.south) {
          const bLen = job.req.neighborBorders.south.byteLength;
          arena.southView.set(job.req.neighborBorders.south, 0);
          neighborBordersShared.south = new Uint8Array(arena.southSab, 0, bLen);
        }
      }

      const payload: ChunkMeshJobRequest = {
        ...job.req,
        type: 'mesh',
        voxels: voxelsShared,
        customColors: customColorsShared,
        neighborBorders: neighborBordersShared,
        pendingRemovals: undefined,
      };
      worker.postMessage(payload);
      if (_tSendStart > 0) {
        perfProfiler.recordWorkerMessage(performance.now() - _tSendStart);
      }
      return;
    }

    const voxelCopy = new Uint8Array(job.req.voxels);
    if (job.req.pendingRemovals && job.req.pendingRemovals.size > 0) {
      const vLen = voxelCopy.byteLength;
      job.req.pendingRemovals.forEach((newMat, idx) => {
        if (idx >= 0 && idx < vLen) {
          voxelCopy[idx] = newMat;
        }
      });
    }
    const transferList: Transferable[] = [voxelCopy.buffer as Transferable];
    let customColorsCopy: Uint8Array | undefined = undefined;
    if (job.req.customColors) {
      customColorsCopy = new Uint8Array(job.req.customColors);
      transferList.push(customColorsCopy.buffer as Transferable);
    }
    let neighborBordersCopy: ChunkNeighborBoundarySlices | undefined = undefined;
    if (job.req.neighborBorders) {
      neighborBordersCopy = {};
      if (job.req.neighborBorders.west) {
        neighborBordersCopy.west = new Uint8Array(job.req.neighborBorders.west);
        transferList.push(neighborBordersCopy.west.buffer as Transferable);
      }
      if (job.req.neighborBorders.east) {
        neighborBordersCopy.east = new Uint8Array(job.req.neighborBorders.east);
        transferList.push(neighborBordersCopy.east.buffer as Transferable);
      }
      if (job.req.neighborBorders.north) {
        neighborBordersCopy.north = new Uint8Array(job.req.neighborBorders.north);
        transferList.push(neighborBordersCopy.north.buffer as Transferable);
      }
      if (job.req.neighborBorders.south) {
        neighborBordersCopy.south = new Uint8Array(job.req.neighborBorders.south);
        transferList.push(neighborBordersCopy.south.buffer as Transferable);
      }
    }
    let surfaceHeightCopy: Uint16Array | undefined = undefined;
    if (job.req.surfaceHeightMap) {
      surfaceHeightCopy = new Uint16Array(job.req.surfaceHeightMap);
      transferList.push(surfaceHeightCopy.buffer as Transferable);
    }
    const payload: ChunkMeshJobRequest = {
      ...job.req,
      type: 'mesh',
      voxels: voxelCopy,
      customColors: customColorsCopy,
      neighborBorders: neighborBordersCopy,
      surfaceHeightMap: surfaceHeightCopy,
      pendingRemovals: undefined,
    };
    worker.postMessage(payload, transferList);
    if (_tSendStart > 0) {
      perfProfiler.recordWorkerMessage(performance.now() - _tSendStart);
    }
  }

  public enqueueChunkJob(
    cx: number,
    cz: number,
    minY: number,
    maxY: number,
    originX: number,
    originZ: number,
    voxels: Uint8Array,
    hasTranslucent = true,
    transMinY = minY,
    transMaxY = maxY,
    customColors?: Uint8Array | null,
    dirtyBucketMask = MAT_BUCKET_ALL_MASK,
    lod0Only = false,
    neighborBorders?: ChunkNeighborBoundarySlices,
    pendingRemovals?: ReadonlyMap<number, number>,
    isSurfaceOnly = false,
    surfaceHeightMap?: Uint16Array,
    neighborSurfaceHeights?: {
      west?: Uint16Array | Uint8Array;
      east?: Uint16Array | Uint8Array;
      north?: Uint16Array | Uint8Array;
      south?: Uint16Array | Uint8Array;
    },
    extraOpts?: EnqueueChunkExtraOptions,
  ): Promise<ChunkMeshJobResponse> {
    const jobId = this.nextJobId++;
    const clonedPending =
      pendingRemovals && pendingRemovals.size > 0
        ? new Map(pendingRemovals)
        : undefined;
    const req: ChunkMeshJobRequest = {
      type: 'mesh',
      jobId,
      cx,
      cz,
      minY,
      maxY,
      originX,
      originZ,
      voxels,
      customColors: customColors || undefined,
      hasTranslucent,
      transMinY,
      transMaxY,
      dirtyBucketMask,
      lod0Only,
      lod12Only: extraOpts?.lod12Only,
      neighborBorders,
      pendingRemovals: clonedPending,
      isSurfaceOnly,
      surfaceHeightMap,
      neighborSurfaceHeights,
      slotIndex: extraOpts?.slotIndex,
      useSharedSlab: extraOpts?.useSharedSlab,
      generateSurfaceTerrain: extraOpts?.generateSurfaceTerrain,
      worldGenMode: extraOpts?.worldGenMode,
      flatBaseplateMat: extraOpts?.flatBaseplateMat,
      buildSurfaceLods: extraOpts?.buildSurfaceLods,
    };

    if (this.workers.length === 0) {
      this.completedJobs++;
      if (clonedPending && clonedPending.size > 0) {
        const tmpVox = new Uint8Array(voxels);
        clonedPending.forEach((newMat, idx) => {
          if (idx >= 0 && idx < tmpVox.length) {
            tmpVox[idx] = newMat;
          }
        });
        req.voxels = tmpVox;
        req.pendingRemovals = undefined;
      }
      return Promise.resolve(buildAllLodPayloadsForChunk(req));
    }

    const priorityScore = extraOpts?.priorityScore ?? 1000;
    return new Promise<ChunkMeshJobResponse>((resolve, reject) => {
      // If this chunk is already queued and waiting for a worker, coalesce without letting a lod12Only job clobber a full LOD0 rebuild
      for (let i = 0; i < this.queue.length; i++) {
        const qReq = this.queue[i].req;
        if (qReq.type !== 'horizonTile' && qReq.cx === cx && qReq.cz === cz) {
          const prevJob = this.queue[i];
          if (!qReq.lod12Only && req.lod12Only) {
            // Upgrade the existing full job to also build LOD1/2/3 in the same pass
            qReq.lod0Only = false;
            qReq.buildSurfaceLods = true;
          } else {
            prevJob.req = req;
          }
          prevJob.priorityScore = Math.min(prevJob.priorityScore, priorityScore);
          prevJob.resolvers.push(resolve as (res: AnyWorkerJobResponse) => void);
          prevJob.rejecters.push(reject);
          return;
        }
      }
      const job: QueuedJob = {
        req,
        priorityScore,
        resolvers: [resolve as (res: AnyWorkerJobResponse) => void],
        rejecters: [reject],
      };
      if (
        this.inFlightCount < this.maxConcurrentJobs &&
        this.idleWorkers.length > 0
      ) {
        const freeWorker = this.idleWorkers.pop()!;
        this.inFlightCount++;
        this.dispatchToWorker(freeWorker, job);
      } else {
        this.queue.push(job);
      }
    });
  }

  public enqueueHorizonTileJob(
    params: {
      tileKey: string;
      level: number;
      tx: number;
      tz: number;
      tileChunks: number;
      stepVoxels: number;
      txBig?: bigint;
      tzBig?: bigint;
      tileChunksBig?: bigint;
      stepVoxelsBig?: bigint;
      gridCells?: number;
      scaleBand?: number;
      bandScaleMetersBig?: bigint;
      worldGenMode: WorldGenMode;
      flatBaseplateMat: number;
      stamps?: ModifiedChunkSurfaceStamp[];
    },
    priorityScore = 600,
  ): Promise<HorizonTileJobResponse> {
    const jobId = this.nextJobId++;
    const req: HorizonTileJobRequest = {
      type: 'horizonTile',
      jobId,
      tileKey: params.tileKey,
      level: params.level,
      tx: params.tx,
      tz: params.tz,
      tileChunks: params.tileChunks,
      stepVoxels: params.stepVoxels,
      txBig: params.txBig,
      tzBig: params.tzBig,
      tileChunksBig: params.tileChunksBig,
      stepVoxelsBig: params.stepVoxelsBig,
      gridCells: params.gridCells,
      scaleBand: params.scaleBand,
      bandScaleMetersBig: params.bandScaleMetersBig,
      worldGenMode: params.worldGenMode,
      flatBaseplateMat: params.flatBaseplateMat,
      stamps: params.stamps,
    };

    if (this.workers.length === 0) {
      this.completedJobs++;
      return Promise.resolve(buildHorizonTilePayload(req));
    }

    return new Promise<HorizonTileJobResponse>((resolve, reject) => {
      for (let i = 0; i < this.queue.length; i++) {
        const qReq = this.queue[i].req;
        if (qReq.type === 'horizonTile' && qReq.tileKey === params.tileKey) {
          const prevJob = this.queue[i];
          prevJob.req = req;
          prevJob.priorityScore = Math.min(prevJob.priorityScore, priorityScore);
          prevJob.resolvers.push(resolve as (res: AnyWorkerJobResponse) => void);
          prevJob.rejecters.push(reject);
          return;
        }
      }
      const job: QueuedJob = {
        req,
        priorityScore,
        resolvers: [resolve as (res: AnyWorkerJobResponse) => void],
        rejecters: [reject],
      };
      if (
        this.inFlightCount < this.maxConcurrentJobs &&
        this.idleWorkers.length > 0
      ) {
        const freeWorker = this.idleWorkers.pop()!;
        this.inFlightCount++;
        this.dispatchToWorker(freeWorker, job);
      } else {
        this.queue.push(job);
      }
    });
  }

  public clearQueuedJobs(): void {
    const cancelErr = new Error('Chunk mesh job cancelled');
    for (let i = 0; i < this.queue.length; i++) {
      const rj = this.queue[i].rejecters;
      for (let k = 0; k < rj.length; k++) {
        rj[k](cancelErr);
      }
    }
    this.queue.length = 0;
    this.pendingCallbacks.forEach((cb) => {
      for (let k = 0; k < cb.rejecters.length; k++) {
        cb.rejecters[k](cancelErr);
      }
    });
    this.pendingCallbacks.clear();
    // Preserve inFlightCount for workers still actively processing an in-flight job
    this.inFlightCount = this.activeJobByWorker.size;
  }

  public dispose(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    this.clearQueuedJobs();
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.idleWorkers = [];
    this.workerSharedArenas.clear();
  }
}

