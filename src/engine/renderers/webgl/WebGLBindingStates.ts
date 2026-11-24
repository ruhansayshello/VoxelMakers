import type { BufferAttribute } from '../../core/BufferAttribute';
import type { BufferGeometry } from '../../core/BufferGeometry';
import { IntType } from '../../core/constants';
import type { InstancedBufferAttribute } from '../../core/InstancedBufferAttribute';
import type { Material } from '../../materials/Material';
import type { WebGLAttributes } from './WebGLAttributes';
import type { WebGLProgram } from './WebGLProgram';

export interface InstancedMeshLike {
  isInstancedMesh?: boolean;
  instanceMatrix?: BufferAttribute | null;
  instanceColor?: BufferAttribute | null;
}

interface BindingState {
  vao: WebGLVertexArrayObject | null;
  attributes: Record<string, { attribute: BufferAttribute; version: number }>;
  index: BufferAttribute | null;
  attributesNum: number;
}

export class WebGLBindingStates {
  private gl: WebGL2RenderingContext;
  private attributes: WebGLAttributes;
  private bindingStates: Map<number, Map<number, BindingState>> = new Map();
  private currentVAO: WebGLVertexArrayObject | null = null;

  constructor(gl: WebGL2RenderingContext, attributes: WebGLAttributes) {
    this.gl = gl;
    this.attributes = attributes;
  }

  setup(
    object: InstancedMeshLike,
    material: Material,
    program: WebGLProgram,
    geometry: BufferGeometry,
    index: BufferAttribute | null,
  ): void {
    const gl = this.gl;
    let progMap = this.bindingStates.get(geometry.id);
    if (progMap === undefined) {
      progMap = new Map();
      this.bindingStates.set(geometry.id, progMap);
    }

    let state = progMap.get(program.id);
    let needsUpdate = false;

    if (state === undefined) {
      state = {
        vao: gl.createVertexArray(),
        attributes: {},
        index: null,
        attributesNum: 0,
      };
      progMap.set(program.id, state);
      needsUpdate = true;
    }

    if (this.currentVAO !== state.vao) {
      gl.bindVertexArray(state.vao);
      this.currentVAO = state.vao;
    }

    if (!needsUpdate) {
      needsUpdate = this.needsVertexArrayUpdate(object, program, geometry, index, state);
    }

    if (needsUpdate) {
      this.saveCache(object, program, geometry, index, state);

      if (index !== null) {
        const indexData = this.attributes.update(index, gl.ELEMENT_ARRAY_BUFFER);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexData.buffer);
      }

      this.setupVertexAttributes(object, material, program, geometry);
    } else if (index !== null) {
      // Ensure updated index buffers are uploaded even when VAO topology hasn't changed
      this.attributes.update(index, gl.ELEMENT_ARRAY_BUFFER);
    }
  }

  private needsVertexArrayUpdate(
    object: InstancedMeshLike,
    program: WebGLProgram,
    geometry: BufferGeometry,
    index: BufferAttribute | null,
    state: BindingState,
  ): boolean {
    if (state.index !== index) return true;

    const attrKeys = program.getAttributeKeys();
    let count = 0;

    for (let i = 0; i < attrKeys.length; i++) {
      const name = attrKeys[i];
      const geomAttr = this.resolveAttribute(object, geometry, name);
      if (geomAttr === undefined) continue;
      count++;

      const cached = state.attributes[name];
      if (cached === undefined || cached.attribute !== geomAttr) {
        return true;
      }
      // Make sure modified attribute data gets pushed to GPU VBO
      this.attributes.update(geomAttr, this.gl.ARRAY_BUFFER);
    }

    return count !== state.attributesNum;
  }

  private saveCache(
    object: InstancedMeshLike,
    program: WebGLProgram,
    geometry: BufferGeometry,
    index: BufferAttribute | null,
    state: BindingState,
  ): void {
    const attrKeys = program.getAttributeKeys();
    const cache: Record<string, { attribute: BufferAttribute; version: number }> = {};
    let count = 0;

    for (let i = 0; i < attrKeys.length; i++) {
      const name = attrKeys[i];
      const geomAttr = this.resolveAttribute(object, geometry, name);
      if (geomAttr === undefined) continue;
      cache[name] = { attribute: geomAttr, version: geomAttr.version };
      count++;
    }

    state.attributes = cache;
    state.index = index;
    state.attributesNum = count;
  }

  private resolveAttribute(
    object: InstancedMeshLike,
    geometry: BufferGeometry,
    name: string,
  ): BufferAttribute | undefined {
    const geomAttr = geometry.attributes[name];
    if (geomAttr !== undefined) return geomAttr;

    if (object.isInstancedMesh) {
      if (name === 'instanceMatrix' && object.instanceMatrix) return object.instanceMatrix;
      if (name === 'instanceColor' && object.instanceColor) return object.instanceColor;
    }

    return undefined;
  }

  private setupVertexAttributes(
    object: InstancedMeshLike,
    _material: Material,
    program: WebGLProgram,
    geometry: BufferGeometry,
  ): void {
    const gl = this.gl;
    const programAttrs = program.getAttributes();
    const attrKeys = program.getAttributeKeys();

    for (let k = 0; k < attrKeys.length; k++) {
      const name = attrKeys[k];
      const info = programAttrs[name];
      if (info.location < 0) continue;

      const attr = this.resolveAttribute(object, geometry, name);
      if (attr === undefined) {
        for (let i = 0; i < info.locationSize; i++) {
          gl.disableVertexAttribArray(info.location + i);
        }
        continue;
      }

      const bufData = this.attributes.update(attr, gl.ARRAY_BUFFER);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufData.buffer);

      const isInstancedAttr = (attr as InstancedBufferAttribute).isInstancedBufferAttribute === true;
      const divisor =
        isInstancedAttr
          ? (attr as InstancedBufferAttribute).meshPerAttribute
          : object.isInstancedMesh && (name === 'instanceMatrix' || name === 'instanceColor')
            ? 1
            : 0;

      if (info.locationSize === 1) {
        gl.enableVertexAttribArray(info.location);
        if (attr.gpuType === IntType) {
          gl.vertexAttribIPointer(info.location, attr.itemSize, bufData.type, 0, 0);
        } else {
          gl.vertexAttribPointer(info.location, attr.itemSize, bufData.type, attr.normalized, 0, 0);
        }
        gl.vertexAttribDivisor(info.location, divisor);
      } else {
        // Matrix attribute (mat2/mat3/mat4, e.g., instanceMatrix)
        const stride = info.locationSize * info.locationSize * bufData.bytesPerElement;
        const colBytes = info.locationSize * bufData.bytesPerElement;
        for (let col = 0; col < info.locationSize; col++) {
          const loc = info.location + col;
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, info.locationSize, bufData.type, attr.normalized, stride, col * colBytes);
          gl.vertexAttribDivisor(loc, divisor);
        }
      }
    }
  }

  reset(): void {
    if (this.currentVAO !== null) {
      this.gl.bindVertexArray(null);
      this.currentVAO = null;
    }
  }

  releaseStatesOfGeometry(geometry: BufferGeometry): void {
    const progMap = this.bindingStates.get(geometry.id);
    if (progMap === undefined) return;

    for (const state of progMap.values()) {
      if (state.vao !== null) {
        if (this.currentVAO === state.vao) {
          this.gl.bindVertexArray(null);
          this.currentVAO = null;
        }
        this.gl.deleteVertexArray(state.vao);
      }
    }
    this.bindingStates.delete(geometry.id);
  }

  releaseStatesOfProgram(program: WebGLProgram): void {
    for (const progMap of this.bindingStates.values()) {
      const state = progMap.get(program.id);
      if (state !== undefined) {
        if (state.vao !== null) {
          if (this.currentVAO === state.vao) {
            this.gl.bindVertexArray(null);
            this.currentVAO = null;
          }
          this.gl.deleteVertexArray(state.vao);
        }
        progMap.delete(program.id);
      }
    }
  }

  dispose(): void {
    this.reset();
    for (const progMap of this.bindingStates.values()) {
      for (const state of progMap.values()) {
        if (state.vao !== null) {
          this.gl.deleteVertexArray(state.vao);
        }
      }
    }
    this.bindingStates.clear();
  }
}
