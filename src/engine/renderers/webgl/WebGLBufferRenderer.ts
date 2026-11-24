import type { GLBufferRecord } from './WebGLAttributes';

export interface RendererInfoCounters {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
}

export interface MultiDrawExtension {
  multiDrawArraysWEBGL(
    mode: number,
    firstsList: Int32Array | number[],
    firstsOffset: number,
    countsList: Int32Array | number[],
    countsOffset: number,
    drawcount: number,
  ): void;
  multiDrawElementsWEBGL(
    mode: number,
    countsList: Int32Array | number[],
    countsOffset: number,
    type: number,
    offsetsList: Int32Array | number[],
    offsetsOffset: number,
    drawcount: number,
  ): void;
}

function updateDrawStats(
  gl: WebGL2RenderingContext,
  stats: RendererInfoCounters,
  mode: number,
  count: number,
  instanceCount = 1,
): void {
  stats.calls++;
  if (mode === gl.TRIANGLES) {
    stats.triangles += instanceCount * (count / 3);
  } else if (mode === gl.LINES) {
    stats.lines += instanceCount * (count / 2);
  } else if (mode === gl.LINE_STRIP) {
    stats.lines += instanceCount * Math.max(0, count - 1);
  } else if (mode === gl.LINE_LOOP) {
    stats.lines += instanceCount * count;
  } else if (mode === gl.POINTS) {
    stats.points += instanceCount * count;
  }
}

export class WebGLBufferRenderer {
  private gl: WebGL2RenderingContext;
  private stats: RendererInfoCounters;
  private mode = 4; // gl.TRIANGLES
  private multiDrawExt: MultiDrawExtension | null;

  constructor(
    gl: WebGL2RenderingContext,
    stats: RendererInfoCounters,
    multiDrawExt: MultiDrawExtension | null = null,
  ) {
    this.gl = gl;
    this.stats = stats;
    this.multiDrawExt = multiDrawExt;
  }

  setMode(mode: number): void {
    this.mode = mode;
  }

  render(start: number, count: number): void {
    this.gl.drawArrays(this.mode, start, count);
    updateDrawStats(this.gl, this.stats, this.mode, count, 1);
  }

  renderInstances(start: number, count: number, primcount: number): void {
    if (primcount === 0) return;
    this.gl.drawArraysInstanced(this.mode, start, count, primcount);
    updateDrawStats(this.gl, this.stats, this.mode, count, primcount);
  }

  renderMultiDraw(starts: Int32Array, counts: Int32Array, drawCount: number): void {
    if (drawCount === 0) return;
    if (this.multiDrawExt !== null) {
      this.multiDrawExt.multiDrawArraysWEBGL(this.mode, starts, 0, counts, 0, drawCount);
      let total = 0;
      for (let i = 0; i < drawCount; i++) total += counts[i];
      updateDrawStats(this.gl, this.stats, this.mode, total, 1);
    } else {
      for (let i = 0; i < drawCount; i++) {
        this.render(starts[i], counts[i]);
      }
    }
  }
}

export class WebGLIndexedBufferRenderer {
  private gl: WebGL2RenderingContext;
  private stats: RendererInfoCounters;
  private mode = 4; // gl.TRIANGLES
  private type = 5123; // gl.UNSIGNED_SHORT
  private bytesPerElement = 2;
  private multiDrawExt: MultiDrawExtension | null;

  constructor(
    gl: WebGL2RenderingContext,
    stats: RendererInfoCounters,
    multiDrawExt: MultiDrawExtension | null = null,
  ) {
    this.gl = gl;
    this.stats = stats;
    this.multiDrawExt = multiDrawExt;
  }

  setMode(mode: number): void {
    this.mode = mode;
  }

  setIndex(indexRecord: GLBufferRecord): void {
    this.type = indexRecord.type;
    this.bytesPerElement = indexRecord.bytesPerElement;
  }

  render(start: number, count: number): void {
    this.gl.drawElements(this.mode, count, this.type, start * this.bytesPerElement);
    updateDrawStats(this.gl, this.stats, this.mode, count, 1);
  }

  renderInstances(start: number, count: number, primcount: number): void {
    if (primcount === 0) return;
    this.gl.drawElementsInstanced(this.mode, count, this.type, start * this.bytesPerElement, primcount);
    updateDrawStats(this.gl, this.stats, this.mode, count, primcount);
  }

  renderMultiDraw(starts: Int32Array, counts: Int32Array, drawCount: number): void {
    if (drawCount === 0) return;
    if (this.multiDrawExt !== null) {
      this.multiDrawExt.multiDrawElementsWEBGL(this.mode, counts, 0, this.type, starts, 0, drawCount);
      let total = 0;
      for (let i = 0; i < drawCount; i++) total += counts[i];
      updateDrawStats(this.gl, this.stats, this.mode, total, 1);
    } else {
      for (let i = 0; i < drawCount; i++) {
        this.gl.drawElements(this.mode, counts[i], this.type, starts[i]);
        updateDrawStats(this.gl, this.stats, this.mode, counts[i], 1);
      }
    }
  }
}
