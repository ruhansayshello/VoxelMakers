import { Color, Matrix3, Matrix4, Vector2, Vector3, Vector4 } from '../../math';

export interface TextureBinder {
  allocateTextureUnit(): number;
  setTexture2D(texture: unknown, slot: number): void;
  setTexture3D?(texture: unknown, slot: number): void;
  setTextureCube?(texture: unknown, slot: number): void;
}

export interface UniformNode {
  id: string;
  setValue(gl: WebGL2RenderingContext, value: unknown, textures?: TextureBinder): void;
}

function arrayEqual(a: number[], b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function copyInto(dst: number[], src: ArrayLike<number>): void {
  dst.length = src.length;
  for (let i = 0; i < src.length; i++) dst[i] = src[i];
}

let _scratchFloat32 = new Float32Array(256);
let _scratchInt32 = new Int32Array(32);

function ensureScratchFloat32(len: number): Float32Array {
  if (_scratchFloat32.length < len) {
    let next = _scratchFloat32.length || 64;
    while (next < len) next *= 2;
    _scratchFloat32 = new Float32Array(next);
  }
  return _scratchFloat32.subarray(0, len);
}

function ensureScratchInt32(len: number): Int32Array {
  if (_scratchInt32.length < len) {
    let next = _scratchInt32.length || 16;
    while (next < len) next *= 2;
    _scratchInt32 = new Int32Array(next);
  }
  return _scratchInt32.subarray(0, len);
}

function flattenArray(values: unknown[], elemSize: number): Float32Array {
  const n = values.length;
  const out = ensureScratchFloat32(n * elemSize);
  for (let i = 0; i < n; i++) {
    const v = values[i] as Record<string, number> | Color | Matrix3 | Matrix4;
    const base = i * elemSize;
    if (v instanceof Color) {
      out[base] = v.r;
      out[base + 1] = v.g;
      out[base + 2] = v.b;
    } else if (v instanceof Matrix3 || v instanceof Matrix4) {
      out.set(v.elements, base);
    } else if (typeof (v as { x?: number }).x === 'number') {
      const vec = v as { x: number; y?: number; z?: number; w?: number };
      out[base] = vec.x;
      if (elemSize > 1) out[base + 1] = vec.y ?? 0;
      if (elemSize > 2) out[base + 2] = vec.z ?? 0;
      if (elemSize > 3) out[base + 3] = vec.w ?? 0;
    }
  }
  return out;
}

class SingleUniform implements UniformNode {
  readonly id: string;
  readonly addr: WebGLUniformLocation;
  readonly type: number;
  private cache: number[] = [];

  constructor(id: string, activeInfo: WebGLActiveInfo, addr: WebGLUniformLocation) {
    this.id = id;
    this.addr = addr;
    this.type = activeInfo.type;
  }

  setValue(gl: WebGL2RenderingContext, value: unknown, textures?: TextureBinder): void {
    if (value === undefined) return;
    const addr = this.addr;
    const c = this.cache;

    if (value === null) {
      if (this.type === 0x8b5e || this.type === 0x8dc1 || this.type === 0x8b62) {
        const unit = textures ? textures.allocateTextureUnit() : 0;
        if (c[0] !== unit) {
          gl.uniform1i(addr, unit);
          c[0] = unit;
        }
        textures?.setTexture2D(null, unit);
      } else if (this.type === 0x8b5f) {
        const unit = textures ? textures.allocateTextureUnit() : 0;
        if (c[0] !== unit) {
          gl.uniform1i(addr, unit);
          c[0] = unit;
        }
        textures?.setTexture3D?.(null, unit);
      } else if (this.type === 0x8b60) {
        const unit = textures ? textures.allocateTextureUnit() : 0;
        if (c[0] !== unit) {
          gl.uniform1i(addr, unit);
          c[0] = unit;
        }
        textures?.setTextureCube?.(null, unit);
      }
      return;
    }

    switch (this.type) {
      case 0x1406: {
        // FLOAT
        const v = value as number;
        if (c[0] === v) return;
        gl.uniform1f(addr, v);
        c[0] = v;
        break;
      }
      case 0x8b50: {
        // FLOAT_VEC2
        if (value instanceof Vector2 || (typeof value === 'object' && 'x' in (value as object))) {
          const v = value as Vector2;
          if (c[0] === v.x && c[1] === v.y) return;
          gl.uniform2f(addr, v.x, v.y);
          c[0] = v.x;
          c[1] = v.y;
        } else {
          const arr = value as ArrayLike<number>;
          if (arrayEqual(c, arr)) return;
          gl.uniform2fv(addr, arr as Float32Array);
          copyInto(c, arr);
        }
        break;
      }
      case 0x8b51: {
        // FLOAT_VEC3
        if (value instanceof Color) {
          if (c[0] === value.r && c[1] === value.g && c[2] === value.b) return;
          gl.uniform3f(addr, value.r, value.g, value.b);
          c[0] = value.r;
          c[1] = value.g;
          c[2] = value.b;
        } else if (value instanceof Vector3 || (typeof value === 'object' && 'x' in (value as object))) {
          const v = value as Vector3;
          if (c[0] === v.x && c[1] === v.y && c[2] === v.z) return;
          gl.uniform3f(addr, v.x, v.y, v.z);
          c[0] = v.x;
          c[1] = v.y;
          c[2] = v.z;
        } else {
          const arr = value as ArrayLike<number>;
          if (arrayEqual(c, arr)) return;
          gl.uniform3fv(addr, arr as Float32Array);
          copyInto(c, arr);
        }
        break;
      }
      case 0x8b52: {
        // FLOAT_VEC4
        if (value instanceof Vector4 || (typeof value === 'object' && 'x' in (value as object))) {
          const v = value as Vector4;
          if (c[0] === v.x && c[1] === v.y && c[2] === v.z && c[3] === v.w) return;
          gl.uniform4f(addr, v.x, v.y, v.z, v.w);
          c[0] = v.x;
          c[1] = v.y;
          c[2] = v.z;
          c[3] = v.w;
        } else {
          const arr = value as ArrayLike<number>;
          if (arrayEqual(c, arr)) return;
          gl.uniform4fv(addr, arr as Float32Array);
          copyInto(c, arr);
        }
        break;
      }
      case 0x8b5b: {
        // FLOAT_MAT3
        const elems = value instanceof Matrix3 ? value.elements : (value as Float32Array);
        if (arrayEqual(c, elems)) return;
        gl.uniformMatrix3fv(addr, false, elems);
        copyInto(c, elems);
        break;
      }
      case 0x8b5c: {
        // FLOAT_MAT4
        const elems = value instanceof Matrix4 ? value.elements : (value as Float32Array);
        if (arrayEqual(c, elems)) return;
        gl.uniformMatrix4fv(addr, false, elems);
        copyInto(c, elems);
        break;
      }
      case 0x1404: // INT
      case 0x8b56: {
        // BOOL
        const v = typeof value === 'boolean' ? (value ? 1 : 0) : (value as number);
        if (c[0] === v) return;
        gl.uniform1i(addr, v);
        c[0] = v;
        break;
      }
      case 0x1405: {
        // UNSIGNED_INT
        const v = value as number;
        if (c[0] === v) return;
        gl.uniform1ui(addr, v);
        c[0] = v;
        break;
      }
      case 0x8b53: // INT_VEC2
      case 0x8b57: {
        const arr = value as Int32Array | number[];
        if (arrayEqual(c, arr)) return;
        gl.uniform2iv(addr, arr);
        copyInto(c, arr);
        break;
      }
      case 0x8b54: // INT_VEC3
      case 0x8b58: {
        const arr = value as Int32Array | number[];
        if (arrayEqual(c, arr)) return;
        gl.uniform3iv(addr, arr);
        copyInto(c, arr);
        break;
      }
      case 0x8b55: // INT_VEC4
      case 0x8b59: {
        const arr = value as Int32Array | number[];
        if (arrayEqual(c, arr)) return;
        gl.uniform4iv(addr, arr);
        copyInto(c, arr);
        break;
      }
      case 0x8b5e: // SAMPLER_2D
      case 0x8dc1: // SAMPLER_2D_ARRAY
      case 0x8b62: {
        // SAMPLER_2D_SHADOW
        const unit = textures ? textures.allocateTextureUnit() : 0;
        if (c[0] !== unit) {
          gl.uniform1i(addr, unit);
          c[0] = unit;
        }
        textures?.setTexture2D(value, unit);
        break;
      }
      case 0x8b5f: {
        // SAMPLER_3D
        const unit = textures ? textures.allocateTextureUnit() : 0;
        if (c[0] !== unit) {
          gl.uniform1i(addr, unit);
          c[0] = unit;
        }
        textures?.setTexture3D?.(value, unit);
        break;
      }
      case 0x8b60: {
        // SAMPLER_CUBE
        const unit = textures ? textures.allocateTextureUnit() : 0;
        if (c[0] !== unit) {
          gl.uniform1i(addr, unit);
          c[0] = unit;
        }
        textures?.setTextureCube?.(value, unit);
        break;
      }
      default:
        break;
    }
  }
}

class PureArrayUniform implements UniformNode {
  readonly id: string;
  readonly addr: WebGLUniformLocation;
  readonly type: number;
  readonly size: number;
  private cache: number[] = [];

  constructor(id: string, activeInfo: WebGLActiveInfo, addr: WebGLUniformLocation) {
    this.id = id;
    this.addr = addr;
    this.type = activeInfo.type;
    this.size = activeInfo.size;
  }

  setValue(gl: WebGL2RenderingContext, value: unknown, textures?: TextureBinder): void {
    if (!value) return;
    const addr = this.addr;
    const c = this.cache;

    switch (this.type) {
      case 0x1406: {
        const data = value as Float32Array | number[];
        if (arrayEqual(c, data)) return;
        gl.uniform1fv(addr, data);
        copyInto(c, data);
        break;
      }
      case 0x8b50: {
        const data =
          Array.isArray(value) && typeof value[0] === 'object'
            ? flattenArray(value, 2)
            : (value as Float32Array | number[]);
        if (arrayEqual(c, data)) return;
        gl.uniform2fv(addr, data);
        copyInto(c, data);
        break;
      }
      case 0x8b51: {
        const data =
          Array.isArray(value) && typeof value[0] === 'object'
            ? flattenArray(value, 3)
            : (value as Float32Array | number[]);
        if (arrayEqual(c, data)) return;
        gl.uniform3fv(addr, data);
        copyInto(c, data);
        break;
      }
      case 0x8b52: {
        const data =
          Array.isArray(value) && typeof value[0] === 'object'
            ? flattenArray(value, 4)
            : (value as Float32Array | number[]);
        if (arrayEqual(c, data)) return;
        gl.uniform4fv(addr, data);
        copyInto(c, data);
        break;
      }
      case 0x8b5b: {
        const data =
          Array.isArray(value) && typeof value[0] === 'object'
            ? flattenArray(value, 9)
            : (value as Float32Array | number[]);
        if (arrayEqual(c, data)) return;
        gl.uniformMatrix3fv(addr, false, data);
        copyInto(c, data);
        break;
      }
      case 0x8b5c: {
        const data =
          Array.isArray(value) && typeof value[0] === 'object'
            ? flattenArray(value, 16)
            : (value as Float32Array | number[]);
        if (arrayEqual(c, data)) return;
        gl.uniformMatrix4fv(addr, false, data);
        copyInto(c, data);
        break;
      }
      case 0x1404:
      case 0x8b56: {
        const data = value as Int32Array | number[];
        if (arrayEqual(c, data)) return;
        gl.uniform1iv(addr, data);
        copyInto(c, data);
        break;
      }
      case 0x8b5e: {
        const arr = value as unknown[];
        const units = ensureScratchInt32(arr.length);
        for (let i = 0; i < arr.length; i++) {
          const unit = textures ? textures.allocateTextureUnit() : i;
          units[i] = unit;
          textures?.setTexture2D(arr[i], unit);
        }
        if (!arrayEqual(c, units)) {
          gl.uniform1iv(addr, units);
          copyInto(c, units);
        }
        break;
      }
      default:
        break;
    }
  }
}

class StructuredUniform implements UniformNode {
  readonly id: string;
  readonly seq: UniformNode[] = [];
  readonly map: Record<string, UniformNode> = {};

  constructor(id: string) {
    this.id = id;
  }

  setValue(gl: WebGL2RenderingContext, value: unknown, textures?: TextureBinder): void {
    if (value === null || value === undefined) return;
    const obj = value as Record<string, unknown>;
    for (let i = 0; i < this.seq.length; i++) {
      const u = this.seq[i];
      u.setValue(gl, obj[u.id], textures);
    }
  }
}

const PATH_REGEX = /([\w\d_]+)(\])?(\[|\.)?/g;

function addUniform(container: { seq: UniformNode[]; map: Record<string, UniformNode> }, node: UniformNode): void {
  container.seq.push(node);
  container.map[node.id] = node;
}

function parseUniform(
  activeInfo: WebGLActiveInfo,
  addr: WebGLUniformLocation,
  root: { seq: UniformNode[]; map: Record<string, UniformNode> },
): void {
  const path = activeInfo.name;
  const pathLength = path.length;
  PATH_REGEX.lastIndex = 0;

  let container = root;
  while (true) {
    const match = PATH_REGEX.exec(path);
    if (match === null) break;

    const matchEnd = PATH_REGEX.lastIndex;
    let id = match[1];
    const isIndex = match[2] === ']';
    const subscript = match[3];

    if (isIndex) id = String(Number(id) | 0);

    if (subscript === undefined || (subscript === '[' && matchEnd + 2 === pathLength)) {
      const node =
        subscript === undefined
          ? new SingleUniform(id, activeInfo, addr)
          : new PureArrayUniform(id, activeInfo, addr);
      addUniform(container, node);
      break;
    } else {
      let next = container.map[id] as StructuredUniform | undefined;
      if (next === undefined) {
        next = new StructuredUniform(id);
        addUniform(container, next);
      }
      container = next;
    }
  }
}

export class WebGLUniforms {
  readonly seq: UniformNode[] = [];
  readonly map: Record<string, UniformNode> = {};

  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const addr = gl.getUniformLocation(program, info.name);
      if (addr !== null) {
        parseUniform(info, addr, this);
      }
    }
  }

  setValue(gl: WebGL2RenderingContext, name: string, value: unknown, textures?: TextureBinder): void {
    const node = this.map[name];
    if (node !== undefined) {
      node.setValue(gl, value, textures);
    }
  }

  setOptional(gl: WebGL2RenderingContext, object: Record<string, unknown>, name: string): void {
    const val = object[name];
    if (val !== undefined) {
      this.setValue(gl, name, val);
    }
  }

  static upload(
    gl: WebGL2RenderingContext,
    seq: UniformNode[],
    values: Record<string, { value: unknown }>,
    textures?: TextureBinder,
  ): void {
    for (let i = 0; i < seq.length; i++) {
      const node = seq[i];
      const entry = values[node.id];
      if (entry !== undefined) {
        node.setValue(gl, entry.value, textures);
      }
    }
  }

  static seqWithValue(seq: UniformNode[], values: Record<string, { value: unknown }>): UniformNode[] {
    const matched: UniformNode[] = [];
    for (let i = 0; i < seq.length; i++) {
      const node = seq[i];
      if (node.id in values) matched.push(node);
    }
    return matched;
  }
}
