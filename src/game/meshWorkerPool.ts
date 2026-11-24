import {
  buildAllLodPayloadsForChunk,
  type ChunkMeshJobRequest,
  type ChunkMeshJobResponse,
  type ChunkNeighborBoundarySlices,
  type LodSubMeshPayload,
  type WorkerPingRequest,
  type WorkerPingResponse,
} from './meshWorker.ts';
import { MAT_BUCKET_ALL_MASK, warmUpGreedyMesherScratchpad } from './physicsMath.ts';
import { perfProfiler } from '../engine/perf/PerfProfiler';

export const MAX_CONCURRENT_CHUNK_LOADS = 2;

interface QueuedJob {
  req: ChunkMeshJobRequest;
  resolvers: Array<(res: ChunkMeshJobResponse) => void>;
  rejecters: Array<(err: Error) => void>;
}

interface WorkerSharedArena {
  voxelsSab: SharedArrayBuffer;
  voxelsView: Uint8Array;
  colorsSab: SharedArrayBuffer;
  colorsView: Uint8Array;
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
 * - Pre-warms idle workers every 1,000 ms with a lightweight "ping" job (#6) so worker threads are never
 *   de-prioritized by the OS after a pause!
 */
export class MultiCoreMeshWorkerPool {
  public readonly coreCount: number;
  public readonly activeWorkers: number;
  public readonly hasDedicatedWorkers: boolean;
  public readonly usesSharedArrayBuffer: boolean;
  public completedJobs = 0;
  public pingCount = 0;

  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private inFlightCount = 0;
  private workerSharedArenas = new Map<Worker, WorkerSharedArena>();
  private activeJobByWorker = new Map<Worker, number>();
  private queue: QueuedJob[] = [];
  private pendingCallbacks = new Map<
    number,
    {
      resolvers: Array<(res: ChunkMeshJobResponse) => void>;
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
    // Strictly cap concurrent chunk loads at 2 so worker pool never saturates CPU cores during fast driving
    const targetWorkerCount = MAX_CONCURRENT_CHUNK_LOADS;

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
            e: MessageEvent<ChunkMeshJobResponse | WorkerPingResponse>,
          ) => {
            this.handleWorkerResponse(w, e.data);
          };
          w.onerror = (evt: ErrorEvent) => {
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
            if (this.queue.length > 0 && this.inFlightCount < MAX_CONCURRENT_CHUNK_LOADS) {
              const next = this.queue.shift()!;
              this.inFlightCount++;
              this.dispatchToWorker(w, next);
            } else if (!this.idleWorkers.includes(w)) {
              this.idleWorkers.push(w);
            }
          };
          if (canUseSab) {
            const voxelsSab = new SharedArrayBuffer(MAX_CHUNK_VOXELS_BYTES);
            const colorsSab = new SharedArrayBuffer(MAX_CHUNK_VOXELS_BYTES * 3);
            const westSab = new SharedArrayBuffer(MAX_BORDER_SLICE_BYTES);
            const eastSab = new SharedArrayBuffer(MAX_BORDER_SLICE_BYTES);
            const northSab = new SharedArrayBuffer(MAX_BORDER_SLICE_BYTES);
            const southSab = new SharedArrayBuffer(MAX_BORDER_SLICE_BYTES);
            this.workerSharedArenas.set(w, {
              voxelsSab,
              voxelsView: new Uint8Array(voxelsSab),
              colorsSab,
              colorsView: new Uint8Array(colorsSab),
              westSab,
              westView: new Uint8Array(westSab),
              eastSab,
              eastView: new Uint8Array(eastSab),
              northSab,
              northView: new Uint8Array(northSab),
              southSab,
              southView: new Uint8Array(southSab),
            });
          }
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
    this.activeWorkers = Math.max(2, this.workers.length || targetWorkerCount);

    // Pre-warm the worker pool immediately and keep workers warm every 1 second (#6)
    warmUpGreedyMesherScratchpad();
    if (this.hasDedicatedWorkers) {
      this.pingIdleWorkers();
      this.keepAliveTimer = setInterval(() => {
        this.pingIdleWorkers();
      }, 1000);
      if (typeof (this.keepAliveTimer as any)?.unref === 'function') {
        (this.keepAliveTimer as any).unref();
      }
    }
  }

  /**
   * Sends a tiny "ping" job to all currently idle workers (#6) so the OS never de-prioritizes
   * or parks worker threads during quiet driving pauses.
   */
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
    res: ChunkMeshJobResponse | WorkerPingResponse,
  ): void {
    if (res && res.type === 'pong') {
      return;
    }
    const _tRespStart = typeof performance !== 'undefined' ? performance.now() : 0;
    const meshRes = res as ChunkMeshJobResponse;
    const sentAt = this.jobDispatchTimeMs.get(meshRes.jobId);
    if (sentAt !== undefined) {
      this.jobDispatchTimeMs.delete(meshRes.jobId);
      if (_tRespStart > 0) {
        perfProfiler.recordWorkerRoundTrip(_tRespStart - sentAt);
      }
    }
    this.activeJobByWorker.delete(worker);
    this.unwrapTransferredPayload(meshRes.lod0);
    if (meshRes.lod0Buckets) {
      this.unwrapTransferredPayload(meshRes.lod0Buckets[0]);
      this.unwrapTransferredPayload(meshRes.lod0Buckets[1]);
      this.unwrapTransferredPayload(meshRes.lod0Buckets[2]);
    }
    this.unwrapTransferredPayload(meshRes.lod1);
    this.unwrapTransferredPayload(meshRes.lod2);
    this.unwrapTransferredPayload(meshRes.transLod0);
    this.unwrapTransferredPayload(meshRes.transLod1);
    this.unwrapTransferredPayload(meshRes.transLod2);

    this.completedJobs++;
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    const cb = this.pendingCallbacks.get(meshRes.jobId);
    if (cb) {
      this.pendingCallbacks.delete(meshRes.jobId);
      for (let k = 0; k < cb.resolvers.length; k++) {
        cb.resolvers[k](meshRes);
      }
    }
    if (_tRespStart > 0) {
      perfProfiler.recordWorkerMessage(performance.now() - _tRespStart);
    }

    if (this.queue.length > 0 && this.inFlightCount < MAX_CONCURRENT_CHUNK_LOADS) {
      const next = this.queue.shift()!;
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
    const arena = this.workerSharedArenas.get(worker);
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
      west?: Uint8Array;
      east?: Uint8Array;
      north?: Uint8Array;
      south?: Uint8Array;
    },
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
      neighborBorders,
      pendingRemovals: clonedPending,
      isSurfaceOnly,
      surfaceHeightMap,
      neighborSurfaceHeights,
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

    return new Promise<ChunkMeshJobResponse>((resolve, reject) => {
      // If this chunk is already queued and waiting for a worker, replace the stale queued job in-place without nesting closures
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i].req.cx === cx && this.queue[i].req.cz === cz) {
          const prevJob = this.queue[i];
          prevJob.req = req;
          prevJob.resolvers.push(resolve);
          prevJob.rejecters.push(reject);
          return;
        }
      }
      const job: QueuedJob = { req, resolvers: [resolve], rejecters: [reject] };
      if (
        this.inFlightCount < MAX_CONCURRENT_CHUNK_LOADS &&
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

