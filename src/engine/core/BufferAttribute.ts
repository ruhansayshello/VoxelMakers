import { Matrix3, Matrix4, Vector2, Vector3 } from '../math';
import { FloatType, StaticDrawUsage } from './constants';

export type TypedArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

export type TypedArrayConstructor =
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor;

export interface UpdateRange {
  start: number;
  count: number;
}

export interface BufferAttributeJSON {
  itemSize: number;
  type: string;
  array: number[];
  normalized: boolean;
  name?: string;
  usage?: number;
}

let _bufferAttributeId = 1;

const _vec2 = new Vector2();
const _vec3 = new Vector3();

function denormalizeValue(raw: number, array: TypedArray): number {
  switch (array.constructor) {
    case Float32Array:
    case Float64Array:
      return raw;
    case Uint32Array:
      return raw / 4294967295.0;
    case Uint16Array:
      return raw / 65535.0;
    case Uint8Array:
    case Uint8ClampedArray:
      return raw / 255.0;
    case Int32Array:
      return Math.max(raw / 2147483647.0, -1.0);
    case Int16Array:
      return Math.max(raw / 32767.0, -1.0);
    case Int8Array:
      return Math.max(raw / 127.0, -1.0);
    default:
      return raw;
  }
}

function normalizeValue(val: number, array: TypedArray): number {
  switch (array.constructor) {
    case Float32Array:
    case Float64Array:
      return val;
    case Uint32Array:
      return Math.round(val * 4294967295.0);
    case Uint16Array:
      return Math.round(val * 65535.0);
    case Uint8Array:
    case Uint8ClampedArray:
      return Math.round(val * 255.0);
    case Int32Array:
      return Math.round(val * 2147483647.0);
    case Int16Array:
      return Math.round(val * 32767.0);
    case Int8Array:
      return Math.round(val * 127.0);
    default:
      return val;
  }
}

function cloneTypedArray(source: TypedArray): TypedArray {
  const Ctor = source.constructor as TypedArrayConstructor;
  return new Ctor(source);
}

export class BufferAttribute {
  readonly isBufferAttribute = true;
  readonly isGLBufferAttribute = false;
  readonly id: number;

  name = '';
  itemSize: number;
  normalized: boolean;
  usage: number = StaticDrawUsage;
  updateRanges: UpdateRange[] = [];
  gpuType: number = FloatType;
  version = 0;

  onUploadCallback: () => void = () => {};

  private _array: TypedArray;
  private _needsUpdate = false;

  constructor(array: TypedArray, itemSize: number, normalized = false) {
    if (Array.isArray(array)) {
      throw new TypeError('BufferAttribute: array must be a TypedArray.');
    }

    this.id = _bufferAttributeId++;
    this._array = array;
    this.itemSize = itemSize;
    this.normalized = normalized === true;
  }

  get array(): TypedArray {
    return this._array;
  }

  set array(value: TypedArray) {
    this._array = value;
  }

  get count(): number {
    return this._array !== undefined ? this._array.length / this.itemSize : 0;
  }

  get needsUpdate(): boolean {
    return this._needsUpdate;
  }

  set needsUpdate(value: boolean) {
    this._needsUpdate = value;
    if (value === true) {
      this.version++;
    }
  }

  onUpload(callback: () => void): this {
    this.onUploadCallback = callback;
    return this;
  }

  setUsage(value: number): this {
    this.usage = value;
    return this;
  }

  setArray(array: TypedArray): this {
    this._array = array;
    return this;
  }

  addUpdateRange(start: number, count: number): void {
    this.updateRanges.push({ start, count });
  }

  clearUpdateRanges(): void {
    this.updateRanges.length = 0;
  }

  /**
   * Voxel-specific optimization: writes a slice into the backing buffer,
   * records a tight GPU sub-upload range, and flags needsUpdate.
   */
  updateSubRange(data: ArrayLike<number>, offset = 0): this {
    this._array.set(data, offset);
    this.addUpdateRange(offset, data.length);
    this.needsUpdate = true;
    return this;
  }

  copy(source: BufferAttribute): this {
    this.name = source.name;
    this._array = cloneTypedArray(source._array);
    this.itemSize = source.itemSize;
    this.normalized = source.normalized;
    this.usage = source.usage;
    this.gpuType = source.gpuType;
    return this;
  }

  copyAt(index1: number, attribute: BufferAttribute, index2: number): this {
    const dstOffset = index1 * this.itemSize;
    const srcOffset = index2 * attribute.itemSize;
    for (let i = 0; i < this.itemSize; i++) {
      this._array[dstOffset + i] = attribute._array[srcOffset + i];
    }
    return this;
  }

  copyArray(array: ArrayLike<number>): this {
    this._array.set(array);
    return this;
  }

  set(value: ArrayLike<number>, offset = 0): this {
    this._array.set(value, offset);
    return this;
  }

  getComponent(index: number, component: number): number {
    const raw = this._array[index * this.itemSize + component];
    return this.normalized ? denormalizeValue(raw, this._array) : raw;
  }

  setComponent(index: number, component: number, value: number): this {
    const encoded = this.normalized ? normalizeValue(value, this._array) : value;
    this._array[index * this.itemSize + component] = encoded;
    return this;
  }

  getX(index: number): number {
    const raw = this._array[index * this.itemSize];
    return this.normalized ? denormalizeValue(raw, this._array) : raw;
  }

  setX(index: number, x: number): this {
    this._array[index * this.itemSize] = this.normalized ? normalizeValue(x, this._array) : x;
    return this;
  }

  getY(index: number): number {
    const raw = this._array[index * this.itemSize + 1];
    return this.normalized ? denormalizeValue(raw, this._array) : raw;
  }

  setY(index: number, y: number): this {
    this._array[index * this.itemSize + 1] = this.normalized ? normalizeValue(y, this._array) : y;
    return this;
  }

  getZ(index: number): number {
    const raw = this._array[index * this.itemSize + 2];
    return this.normalized ? denormalizeValue(raw, this._array) : raw;
  }

  setZ(index: number, z: number): this {
    this._array[index * this.itemSize + 2] = this.normalized ? normalizeValue(z, this._array) : z;
    return this;
  }

  getW(index: number): number {
    const raw = this._array[index * this.itemSize + 3];
    return this.normalized ? denormalizeValue(raw, this._array) : raw;
  }

  setW(index: number, w: number): this {
    this._array[index * this.itemSize + 3] = this.normalized ? normalizeValue(w, this._array) : w;
    return this;
  }

  setXY(index: number, x: number, y: number): this {
    const base = index * this.itemSize;
    if (this.normalized) {
      this._array[base] = normalizeValue(x, this._array);
      this._array[base + 1] = normalizeValue(y, this._array);
    } else {
      this._array[base] = x;
      this._array[base + 1] = y;
    }
    return this;
  }

  setXYZ(index: number, x: number, y: number, z: number): this {
    const base = index * this.itemSize;
    if (this.normalized) {
      this._array[base] = normalizeValue(x, this._array);
      this._array[base + 1] = normalizeValue(y, this._array);
      this._array[base + 2] = normalizeValue(z, this._array);
    } else {
      this._array[base] = x;
      this._array[base + 1] = y;
      this._array[base + 2] = z;
    }
    return this;
  }

  setXYZW(index: number, x: number, y: number, z: number, w: number): this {
    const base = index * this.itemSize;
    if (this.normalized) {
      this._array[base] = normalizeValue(x, this._array);
      this._array[base + 1] = normalizeValue(y, this._array);
      this._array[base + 2] = normalizeValue(z, this._array);
      this._array[base + 3] = normalizeValue(w, this._array);
    } else {
      this._array[base] = x;
      this._array[base + 1] = y;
      this._array[base + 2] = z;
      this._array[base + 3] = w;
    }
    return this;
  }

  applyMatrix3(m: Matrix3): this {
    const n = this.count;
    if (this.itemSize === 2) {
      for (let i = 0; i < n; i++) {
        _vec2.set(this.getX(i), this.getY(i));
        _vec2.applyMatrix3(m);
        this.setXY(i, _vec2.x, _vec2.y);
      }
    } else if (this.itemSize === 3) {
      for (let i = 0; i < n; i++) {
        _vec3.set(this.getX(i), this.getY(i), this.getZ(i));
        _vec3.applyMatrix3(m);
        this.setXYZ(i, _vec3.x, _vec3.y, _vec3.z);
      }
    }
    return this;
  }

  applyMatrix4(m: Matrix4): this {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      _vec3.set(this.getX(i), this.getY(i), this.getZ(i));
      _vec3.applyMatrix4(m);
      this.setXYZ(i, _vec3.x, _vec3.y, _vec3.z);
    }
    return this;
  }

  applyNormalMatrix(m: Matrix3): this {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      _vec3.set(this.getX(i), this.getY(i), this.getZ(i));
      _vec3.applyNormalMatrix(m);
      this.setXYZ(i, _vec3.x, _vec3.y, _vec3.z);
    }
    return this;
  }

  transformDirection(m: Matrix4): this {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      _vec3.set(this.getX(i), this.getY(i), this.getZ(i));
      _vec3.transformDirection(m);
      this.setXYZ(i, _vec3.x, _vec3.y, _vec3.z);
    }
    return this;
  }

  clone(): BufferAttribute {
    const cloned = new (this.constructor as new (
      array: TypedArray,
      itemSize: number,
      normalized?: boolean,
    ) => BufferAttribute)(cloneTypedArray(this._array), this.itemSize, this.normalized);
    cloned.name = this.name;
    cloned.usage = this.usage;
    cloned.gpuType = this.gpuType;
    return cloned;
  }

  toJSON(): BufferAttributeJSON {
    const data: BufferAttributeJSON = {
      itemSize: this.itemSize,
      type: this._array.constructor.name,
      array: Array.from(this._array),
      normalized: this.normalized,
    };

    if (this.name !== '') data.name = this.name;
    if (this.usage !== StaticDrawUsage) data.usage = this.usage;

    return data;
  }
}

export class Int8BufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Int8Array(array as ArrayLike<number>), itemSize, normalized);
  }
}

export class Uint8BufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Uint8Array(array as ArrayLike<number>), itemSize, normalized);
  }
}

export class Uint8ClampedBufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Uint8ClampedArray(array as ArrayLike<number>), itemSize, normalized);
  }
}

export class Int16BufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Int16Array(array as ArrayLike<number>), itemSize, normalized);
  }
}

export class Uint16BufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Uint16Array(array as ArrayLike<number>), itemSize, normalized);
  }
}

export class Int32BufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Int32Array(array as ArrayLike<number>), itemSize, normalized);
  }
}

export class Uint32BufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Uint32Array(array as ArrayLike<number>), itemSize, normalized);
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Float32Array(array as ArrayLike<number>), itemSize, normalized);
  }
}

export class Float64BufferAttribute extends BufferAttribute {
  constructor(array: Iterable<number> | ArrayLike<number> | number, itemSize: number, normalized = false) {
    super(new Float64Array(array as ArrayLike<number>), itemSize, normalized);
  }
}
