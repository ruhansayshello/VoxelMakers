export interface PerfSnapshot {
  fps: number;
  frameTimeMs: number;
  physicsStepMs: number;
  physicsTotalMs: number;
  renderTimeMs: number;
  chunkMeshingMs: number;
  workerMsgMs: number;
  heapUsedMB: number | null;
  activeBodies: number;
  totalBodies: number;
  activeDebris: number;
  visibleChunks: number;
  dirtyChunks: number;
  physicsStepsThisFrame: number;
  drawCalls: number;
  sceneDrawCalls: number;
  triangles: number;
  sceneTriangles: number;
  // Step 2 hot paths (ms/frame rolling avg)
  integratePhysicsMs: number;
  resolveCollisionsMs: number;
  perBodyIntegrationAvgMs: number;
  perBodyIntegrationMaxMs: number;
  perBodyCollisionAvgMs: number;
  perBodyCollisionMaxMs: number;
  workerRoundTripAvgMs: number;
  eventDrainMs: number;
  hudUpdateMs: number;
  // Additional breakdown for diagnosis
  worldUpdateMs: number;
  vehiclePhysicsMs: number;
  debrisUpdateMs: number;
  recentWarnings: string[];
}

const FRAME_HISTORY_SIZE = 60;
const EMA_ALPHA = 0.1;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Lightweight, zero-allocation-in-hot-path performance profiler for Phase 3 SoA diagnostics.
 */
export class PerfProfiler {
  private _frameTimes = new Float64Array(FRAME_HISTORY_SIZE);
  private _frameCursor = 0;
  private _frameCount = 0;
  private _frameSum = 0;

  public fps = 0;
  public frameTimeMs = 0;
  public physicsStepMs = 0;
  public physicsTotalMs = 0;
  public renderTimeMs = 0;
  public chunkMeshingMs = 0;
  public workerMsgMs = 0;

  public activeBodies = 0;
  public totalBodies = 0;
  public activeDebris = 0;
  public visibleChunks = 0;
  public dirtyChunks = 0;
  public physicsStepsThisFrame = 0;

  public drawCalls = 0;
  public sceneDrawCalls = 0;
  public triangles = 0;
  public sceneTriangles = 0;

  // Step 2 hot-path rolling averages (ms/frame)
  public integratePhysicsMs = 0;
  public resolveCollisionsMs = 0;
  public perBodyIntegrationAvgMs = 0;
  public perBodyIntegrationMaxMs = 0;
  public perBodyCollisionAvgMs = 0;
  public perBodyCollisionMaxMs = 0;
  public workerRoundTripAvgMs = 0;
  public eventDrainMs = 0;
  public hudUpdateMs = 0;

  // Sub-phase breakdown
  public worldUpdateMs = 0;
  public vehiclePhysicsMs = 0;
  public debrisUpdateMs = 0;

  // Per-frame accumulators (reset at start of each frame)
  private _frameIntegrateMs = 0;
  private _frameIntegrateBodies = 0;
  private _frameIntegrateMaxBodyMs = 0;
  private _frameCollisionMs = 0;
  private _frameCollisionBodies = 0;
  private _frameCollisionMaxBodyMs = 0;
  private _frameMeshingMs = 0;
  private _frameWorkerMsgMs = 0;
  private _frameEventDrainMs = 0;
  private _frameHudUpdateMs = 0;
  private _frameVehiclePhysicsMs = 0;
  private _frameDrawCalls = 0;
  private _frameTriangles = 0;
  private _frameSceneDrawCalls = 0;
  private _frameSceneTriangles = 0;
  private _frameRenderPassIdx = 0;

  // Warning throttle timestamps (ms)
  private _lastWarnPhysics = 0;
  private _lastWarnRender = 0;
  private _lastWarnMeshing = 0;
  private _lastWarnBody = 0;
  public recentWarnings: string[] = [];

  public beginFrame(): void {
    this._frameIntegrateMs = 0;
    this._frameIntegrateBodies = 0;
    this._frameIntegrateMaxBodyMs = 0;
    this._frameCollisionMs = 0;
    this._frameCollisionBodies = 0;
    this._frameCollisionMaxBodyMs = 0;
    this._frameMeshingMs = 0;
    this._frameWorkerMsgMs = 0;
    this._frameEventDrainMs = 0;
    this._frameHudUpdateMs = 0;
    this._frameVehiclePhysicsMs = 0;
    this._frameDrawCalls = 0;
    this._frameTriangles = 0;
    this._frameSceneDrawCalls = 0;
    this._frameSceneTriangles = 0;
    this._frameRenderPassIdx = 0;
  }

  private _pushWarning(msg: string): void {
    this.recentWarnings.push(msg);
    if (this.recentWarnings.length > 25) {
      this.recentWarnings.shift();
    }
  }

  public recordBodyIntegration(bodyId: number, elapsedMs: number): void {
    this._frameIntegrateMs += elapsedMs;
    this._frameIntegrateBodies++;
    if (elapsedMs > this._frameIntegrateMaxBodyMs) {
      this._frameIntegrateMaxBodyMs = elapsedMs;
    }
    if (elapsedMs > 0.5) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this._lastWarnBody > 1000) {
        this._lastWarnBody = now;
        const msg = `Body ${bodyId} slow: ${elapsedMs.toFixed(3)} ms`;
        this._pushWarning(msg);
      }
    }
  }

  public recordIntegrateLoopOverhead(elapsedMs: number): void {
    // Only add if it exceeds already-recorded per-body time
    if (elapsedMs > this._frameIntegrateMs) {
      this._frameIntegrateMs = elapsedMs;
    }
  }

  public recordBodyCollisionCheck(elapsedMs: number): void {
    this._frameCollisionMs += elapsedMs;
    this._frameCollisionBodies++;
    if (elapsedMs > this._frameCollisionMaxBodyMs) {
      this._frameCollisionMaxBodyMs = elapsedMs;
    }
  }

  public recordCollisionPass(elapsedMs: number): void {
    this._frameCollisionMs += elapsedMs;
  }

  public recordVehiclePhysics(elapsedMs: number): void {
    this._frameVehiclePhysicsMs += elapsedMs;
  }

  public recordChunkMeshing(elapsedMs: number): void {
    this._frameMeshingMs += elapsedMs;
    if (elapsedMs > 2) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this._lastWarnMeshing > 1000) {
        this._lastWarnMeshing = now;
        const msg = `Meshing slow: ${elapsedMs.toFixed(2)} ms`;
        this._pushWarning(msg);
      }
    }
  }

  public recordWorkerMessage(elapsedMs: number): void {
    this._frameWorkerMsgMs += elapsedMs;
  }

  public recordWorkerRoundTrip(roundTripMs: number): void {
    this.workerRoundTripAvgMs =
      this.workerRoundTripAvgMs === 0
        ? roundTripMs
        : lerp(this.workerRoundTripAvgMs, roundTripMs, EMA_ALPHA);
  }

  public recordEventDrain(elapsedMs: number): void {
    this._frameEventDrainMs += elapsedMs;
  }

  public recordHudUpdate(elapsedMs: number): void {
    this._frameHudUpdateMs += elapsedMs;
  }

  public recordRenderPassStats(calls: number, triangles: number, isMainScenePass: boolean): void {
    this._frameDrawCalls += calls;
    this._frameTriangles += triangles;
    if (isMainScenePass || this._frameRenderPassIdx === 0) {
      this._frameSceneDrawCalls = calls;
      this._frameSceneTriangles = triangles;
    }
    this._frameRenderPassIdx++;
  }

  public endFrame(params: {
    frameDeltaMs: number;
    physicsTotalMs: number;
    physicsSteps: number;
    renderMs: number;
    worldUpdateMs: number;
    debrisUpdateMs: number;
    activeBodies: number;
    totalBodies: number;
    activeDebris: number;
    visibleChunks: number;
    dirtyChunks: number;
  }): void {
    // Rolling 60-frame average for FPS & Frame Time
    const clampedDelta = Math.max(0.1, Math.min(2000, params.frameDeltaMs));
    if (this._frameCount < FRAME_HISTORY_SIZE) {
      this._frameTimes[this._frameCursor] = clampedDelta;
      this._frameSum += clampedDelta;
      this._frameCount++;
    } else {
      this._frameSum -= this._frameTimes[this._frameCursor];
      this._frameTimes[this._frameCursor] = clampedDelta;
      this._frameSum += clampedDelta;
    }
    this._frameCursor = (this._frameCursor + 1) % FRAME_HISTORY_SIZE;
    this.frameTimeMs = this._frameSum / Math.max(1, this._frameCount);
    this.fps = this.frameTimeMs > 0 ? 1000 / this.frameTimeMs : 0;

    this.physicsStepsThisFrame = params.physicsSteps;
    const perStepMs =
      params.physicsSteps > 0 ? params.physicsTotalMs / params.physicsSteps : params.physicsTotalMs;
    this.physicsStepMs =
      this.physicsStepMs === 0 ? perStepMs : lerp(this.physicsStepMs, perStepMs, EMA_ALPHA);
    this.physicsTotalMs =
      this.physicsTotalMs === 0
        ? params.physicsTotalMs
        : lerp(this.physicsTotalMs, params.physicsTotalMs, EMA_ALPHA);
    this.renderTimeMs =
      this.renderTimeMs === 0 ? params.renderMs : lerp(this.renderTimeMs, params.renderMs, EMA_ALPHA);
    this.chunkMeshingMs = lerp(this.chunkMeshingMs, this._frameMeshingMs, EMA_ALPHA);
    this.workerMsgMs = lerp(this.workerMsgMs, this._frameWorkerMsgMs, EMA_ALPHA);
    this.worldUpdateMs = lerp(this.worldUpdateMs, params.worldUpdateMs, EMA_ALPHA);
    this.debrisUpdateMs = lerp(this.debrisUpdateMs, params.debrisUpdateMs, EMA_ALPHA);
    this.vehiclePhysicsMs = lerp(this.vehiclePhysicsMs, this._frameVehiclePhysicsMs, EMA_ALPHA);

    this.integratePhysicsMs = lerp(this.integratePhysicsMs, this._frameIntegrateMs, EMA_ALPHA);
    this.resolveCollisionsMs = lerp(this.resolveCollisionsMs, this._frameCollisionMs, EMA_ALPHA);
    const bodyIntAvg =
      this._frameIntegrateBodies > 0 ? this._frameIntegrateMs / this._frameIntegrateBodies : 0;
    this.perBodyIntegrationAvgMs = lerp(this.perBodyIntegrationAvgMs, bodyIntAvg, EMA_ALPHA);
    this.perBodyIntegrationMaxMs = lerp(
      this.perBodyIntegrationMaxMs,
      this._frameIntegrateMaxBodyMs,
      EMA_ALPHA,
    );
    const bodyColAvg =
      this._frameCollisionBodies > 0 ? this._frameCollisionMs / this._frameCollisionBodies : 0;
    this.perBodyCollisionAvgMs = lerp(this.perBodyCollisionAvgMs, bodyColAvg, EMA_ALPHA);
    this.perBodyCollisionMaxMs = lerp(
      this.perBodyCollisionMaxMs,
      this._frameCollisionMaxBodyMs,
      EMA_ALPHA,
    );
    this.eventDrainMs = lerp(this.eventDrainMs, this._frameEventDrainMs, EMA_ALPHA);
    this.hudUpdateMs = lerp(this.hudUpdateMs, this._frameHudUpdateMs, EMA_ALPHA);

    this.activeBodies = params.activeBodies;
    this.totalBodies = params.totalBodies;
    this.activeDebris = params.activeDebris;
    this.visibleChunks = params.visibleChunks;
    this.dirtyChunks = params.dirtyChunks;

    this.drawCalls = this._frameDrawCalls;
    this.triangles = this._frameTriangles;
    this.sceneDrawCalls = this._frameSceneDrawCalls;
    this.sceneTriangles = this._frameSceneTriangles;

    // Record slow-path warnings into profiler ring buffer without spamming console (console.warn stalls iframe DevTools!)
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (params.physicsTotalMs > 4 && now - this._lastWarnPhysics > 1000) {
      this._lastWarnPhysics = now;
      this._pushWarning(`Physics slow: ${params.physicsTotalMs.toFixed(2)} ms`);
    }
    if (params.renderMs > 8 && now - this._lastWarnRender > 1000) {
      this._lastWarnRender = now;
      this._pushWarning(`Render slow: ${params.renderMs.toFixed(2)} ms`);
    }
    if (this._frameMeshingMs > 2 && now - this._lastWarnMeshing > 1000) {
      this._lastWarnMeshing = now;
      this._pushWarning(`Meshing slow: ${this._frameMeshingMs.toFixed(2)} ms`);
    }
  }

  public getSnapshot(): PerfSnapshot {
    const perfAny =
      typeof performance !== 'undefined'
        ? (performance as unknown as { memory?: { usedJSHeapSize: number } })
        : null;
    const heapUsedMB = perfAny?.memory
      ? Number((perfAny.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1))
      : null;

    return {
      fps: Number(this.fps.toFixed(1)),
      frameTimeMs: Number(this.frameTimeMs.toFixed(2)),
      physicsStepMs: Number(this.physicsStepMs.toFixed(2)),
      physicsTotalMs: Number(this.physicsTotalMs.toFixed(2)),
      renderTimeMs: Number(this.renderTimeMs.toFixed(2)),
      chunkMeshingMs: Number(this.chunkMeshingMs.toFixed(2)),
      workerMsgMs: Number(this.workerMsgMs.toFixed(2)),
      heapUsedMB,
      activeBodies: this.activeBodies,
      totalBodies: this.totalBodies,
      activeDebris: this.activeDebris,
      visibleChunks: this.visibleChunks,
      dirtyChunks: this.dirtyChunks,
      physicsStepsThisFrame: this.physicsStepsThisFrame,
      drawCalls: this.drawCalls,
      sceneDrawCalls: this.sceneDrawCalls,
      triangles: this.triangles,
      sceneTriangles: this.sceneTriangles,
      integratePhysicsMs: Number(this.integratePhysicsMs.toFixed(3)),
      resolveCollisionsMs: Number(this.resolveCollisionsMs.toFixed(3)),
      perBodyIntegrationAvgMs: Number(this.perBodyIntegrationAvgMs.toFixed(4)),
      perBodyIntegrationMaxMs: Number(this.perBodyIntegrationMaxMs.toFixed(4)),
      perBodyCollisionAvgMs: Number(this.perBodyCollisionAvgMs.toFixed(3)),
      perBodyCollisionMaxMs: Number(this.perBodyCollisionMaxMs.toFixed(3)),
      workerRoundTripAvgMs: Number(this.workerRoundTripAvgMs.toFixed(2)),
      eventDrainMs: Number(this.eventDrainMs.toFixed(4)),
      hudUpdateMs: Number(this.hudUpdateMs.toFixed(3)),
      worldUpdateMs: Number(this.worldUpdateMs.toFixed(2)),
      vehiclePhysicsMs: Number(this.vehiclePhysicsMs.toFixed(2)),
      debrisUpdateMs: Number(this.debrisUpdateMs.toFixed(3)),
      recentWarnings: this.recentWarnings.slice(),
    };
  }

  public formatOverlayText(): string {
    const s = this.getSnapshot();
    const memStr = s.heapUsedMB !== null ? `${s.heapUsedMB.toFixed(1)} MB` : 'n/a';
    return [
      `FPS: ${s.fps.toFixed(1)}  Frame: ${s.frameTimeMs.toFixed(2)} ms`,
      `Physics: ${s.physicsTotalMs.toFixed(2)} ms (${s.physicsStepMs.toFixed(2)}/step, steps:${s.physicsStepsThisFrame})`,
      `  integrate: ${s.integratePhysicsMs.toFixed(3)} ms (body avg ${s.perBodyIntegrationAvgMs.toFixed(4)} / max ${s.perBodyIntegrationMaxMs.toFixed(4)})`,
      `  vehPhys:   ${s.vehiclePhysicsMs.toFixed(2)} ms  collide: ${s.resolveCollisionsMs.toFixed(3)} ms`,
      `  bodyCol:   avg ${s.perBodyCollisionAvgMs.toFixed(3)} / max ${s.perBodyCollisionMaxMs.toFixed(3)} ms`,
      `Render:  ${s.renderTimeMs.toFixed(2)} ms  Calls: ${s.drawCalls} (scene ${s.sceneDrawCalls})`,
      `Tris:    ${s.triangles.toLocaleString()} (scene ${s.sceneTriangles.toLocaleString()})`,
      `Meshing: ${s.chunkMeshingMs.toFixed(2)} ms  WorldUpd: ${s.worldUpdateMs.toFixed(2)} ms`,
      `Worker:  msg ${s.workerMsgMs.toFixed(2)} ms  RTT ${s.workerRoundTripAvgMs.toFixed(1)} ms`,
      `Events:  ${s.eventDrainMs.toFixed(4)} ms  HUD: ${s.hudUpdateMs.toFixed(3)} ms  Debris: ${s.debrisUpdateMs.toFixed(3)} ms`,
      `Memory:  ${memStr}`,
      `Bodies:  ${s.activeBodies}/${s.totalBodies} awake  Debris: ${s.activeDebris}`,
      `Chunks:  ${s.visibleChunks} visible  ${s.dirtyChunks} dirty`,
    ].join('\n');
  }
}

export const perfProfiler = new PerfProfiler();
