import type { BufferAttribute, TypedArray } from '../../core/BufferAttribute';

export interface GLBufferRecord {
  buffer: WebGLBuffer;
  type: number;
  bytesPerElement: number;
  version: number;
  size: number;
}

function getGLType(gl: WebGL2RenderingContext, array: TypedArray): number {
  if (array instanceof Float32Array) return gl.FLOAT;
  if (array instanceof Uint16Array) return gl.UNSIGNED_SHORT;
  if (array instanceof Int16Array) return gl.SHORT;
  if (array instanceof Uint32Array) return gl.UNSIGNED_INT;
  if (array instanceof Int32Array) return gl.INT;
  if (array instanceof Int8Array) return gl.BYTE;
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return gl.UNSIGNED_BYTE;
  return gl.FLOAT;
}

export class WebGLAttributes {
  private gl: WebGL2RenderingContext;
  private buffers = new WeakMap<BufferAttribute, GLBufferRecord>();
  private activeBuffers = new Set<WebGLBuffer>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  private createBuffer(attribute: BufferAttribute, bufferType: number): GLBufferRecord {
    const gl = this.gl;
    const array = attribute.array;
    const usage = attribute.usage;

    const buffer = gl.createBuffer();
    if (buffer === null) {
      throw new Error('WebGLAttributes: failed to create WebGLBuffer.');
    }

    gl.bindBuffer(bufferType, buffer);
    gl.bufferData(bufferType, array, usage);

    attribute.onUploadCallback();
    attribute.clearUpdateRanges();
    this.activeBuffers.add(buffer);

    return {
      buffer,
      type: getGLType(gl, array),
      bytesPerElement: array.BYTES_PER_ELEMENT,
      version: attribute.version,
      size: array.byteLength,
    };
  }

  private updateBuffer(
    record: GLBufferRecord,
    attribute: BufferAttribute,
    bufferType: number,
  ): void {
    const gl = this.gl;
    const array = attribute.array;
    const updateRanges = attribute.updateRanges;

    gl.bindBuffer(bufferType, record.buffer);

    if (array.byteLength !== record.size) {
      // Backing TypedArray resized (common when re-meshing a voxel chunk): reallocate via bufferData.
      gl.bufferData(bufferType, array, attribute.usage);
      record.size = array.byteLength;
      record.type = getGLType(gl, array);
      record.bytesPerElement = array.BYTES_PER_ELEMENT;
    } else if (updateRanges.length === 0) {
      gl.bufferSubData(bufferType, 0, array);
    } else {
      for (let i = 0; i < updateRanges.length; i++) {
        const range = updateRanges[i];
        const start = range.start;
        const count = range.count;
        if (count === 0) continue;
        const end = count < 0 ? array.length : Math.min(array.length, start + count);
        gl.bufferSubData(
          bufferType,
          start * array.BYTES_PER_ELEMENT,
          array.subarray(start, end),
        );
      }
      attribute.clearUpdateRanges();
    }

    attribute.onUploadCallback();
  }

  get(attribute: BufferAttribute): GLBufferRecord | undefined {
    return this.buffers.get(attribute);
  }

  update(attribute: BufferAttribute, bufferType: number): GLBufferRecord {
    const existing = this.buffers.get(attribute);
    if (existing === undefined) {
      const created = this.createBuffer(attribute, bufferType);
      this.buffers.set(attribute, created);
      return created;
    }

    if (existing.version < attribute.version) {
      this.updateBuffer(existing, attribute, bufferType);
      existing.version = attribute.version;
    }

    return existing;
  }

  remove(attribute: BufferAttribute): void {
    const data = this.buffers.get(attribute);
    if (data !== undefined) {
      this.gl.deleteBuffer(data.buffer);
      this.activeBuffers.delete(data.buffer);
      this.buffers.delete(attribute);
    }
  }

  dispose(): void {
    for (const buf of this.activeBuffers) {
      this.gl.deleteBuffer(buf);
    }
    this.activeBuffers.clear();
    this.buffers = new WeakMap<BufferAttribute, GLBufferRecord>();
  }
}
