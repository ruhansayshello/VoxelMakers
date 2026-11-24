import { Box3, Matrix3, Matrix4, Quaternion, Sphere, Vector3 } from '../math';
import {
  BufferAttribute,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
  type BufferAttributeJSON,
  type TypedArray,
} from './BufferAttribute';
import { DynamicDrawUsage, StaticDrawUsage } from './constants';
import { EventDispatcher } from './EventDispatcher';
import { generateUUID } from './Object3D';

export interface GeometryGroup {
  start: number;
  count: number;
  materialIndex: number;
}

export interface DrawRange {
  start: number;
  count: number;
}

export interface VoxelChunkMeshData {
  positions: Float32Array;
  normals?: Float32Array | Int8Array;
  colors?: Float32Array | Uint8Array;
  uvs?: Float32Array;
  indices?: Uint16Array | Uint32Array | number[];
  /** Optional pre-known tight bounds (e.g., from greedy mesher) to skip O(N) vertex scan. */
  boundsMin?: { x: number; y: number; z: number };
  boundsMax?: { x: number; y: number; z: number };
  /** Set true for frequently edited chunks to hint DynamicDrawUsage. */
  dynamic?: boolean;
}

export interface BufferGeometryJSON {
  metadata?: {
    version: number;
    type: string;
    generator: string;
  };
  uuid: string;
  type: string;
  name?: string;
  userData?: Record<string, unknown>;
  data: {
    attributes: Record<string, BufferAttributeJSON>;
    index?: { type: string; array: number[] };
    groups?: GeometryGroup[];
    boundingSphere?: { center: number[]; radius: number };
  };
}

let _bufferGeometryId = 1;

const _m1 = new Matrix4();
const _normalMatrix = new Matrix3();
const _offset = new Vector3();
const _box = new Box3();
const _boxMorphTargets = new Box3();
const _vector = new Vector3();
const _pA = new Vector3();
const _pB = new Vector3();
const _pC = new Vector3();
const _cb = new Vector3();
const _ab = new Vector3();
const _up = new Vector3(0, 1, 0);
const _origin = new Vector3(0, 0, 0);

function arrayNeedsUint32(arr: ArrayLike<number>): boolean {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] >= 65535) return true;
  }
  return false;
}

function buildIndexAttribute(indices: BufferAttribute | number[] | Uint16Array | Uint32Array): BufferAttribute {
  if (indices instanceof BufferAttribute) {
    return indices;
  }
  if (indices instanceof Uint16Array) {
    return new BufferAttribute(indices, 1);
  }
  if (indices instanceof Uint32Array) {
    return new BufferAttribute(indices, 1);
  }
  return arrayNeedsUint32(indices)
    ? new Uint32BufferAttribute(indices, 1)
    : new Uint16BufferAttribute(indices, 1);
}

export class BufferGeometry extends EventDispatcher {
  readonly isBufferGeometry = true;
  readonly id: number;

  uuid: string;
  name = '';
  type = 'BufferGeometry';

  index: BufferAttribute | null = null;
  attributes: Record<string, BufferAttribute> = {};
  morphAttributes: Record<string, BufferAttribute[]> = {};
  morphTargetsRelative = false;

  groups: GeometryGroup[] = [];
  boundingBox: Box3 | null = null;
  boundingSphere: Sphere | null = null;
  drawRange: DrawRange = { start: 0, count: Infinity };
  userData: Record<string, unknown> = {};

  /** Voxel-specific optimization flag identifying chunk/voxel-packed geometries. */
  isVoxelGeometry = false;

  constructor() {
    super();
    this.id = _bufferGeometryId++;
    this.uuid = generateUUID();
  }

  getIndex(): BufferAttribute | null {
    return this.index;
  }

  setIndex(index: BufferAttribute | number[] | Uint16Array | Uint32Array | null): this {
    if (index === null) {
      this.index = null;
    } else {
      this.index = buildIndexAttribute(index);
    }
    return this;
  }

  getAttribute(name: string): BufferAttribute | undefined {
    return this.attributes[name];
  }

  setAttribute(name: string, attribute: BufferAttribute): this {
    this.attributes[name] = attribute;
    return this;
  }

  deleteAttribute(name: string): this {
    delete this.attributes[name];
    return this;
  }

  hasAttribute(name: string): boolean {
    return this.attributes[name] !== undefined;
  }

  addGroup(start: number, count: number, materialIndex = 0): void {
    this.groups.push({ start, count, materialIndex });
  }

  clearGroups(): void {
    this.groups.length = 0;
  }

  setDrawRange(start: number, count: number): void {
    this.drawRange.start = start;
    this.drawRange.count = count;
  }

  applyMatrix4(matrix: Matrix4): this {
    const position = this.attributes.position;
    if (position !== undefined) {
      position.applyMatrix4(matrix);
      position.needsUpdate = true;
    }

    const normal = this.attributes.normal;
    if (normal !== undefined) {
      _normalMatrix.getNormalMatrix(matrix);
      normal.applyNormalMatrix(_normalMatrix);
      normal.needsUpdate = true;
    }

    const tangent = this.attributes.tangent;
    if (tangent !== undefined) {
      tangent.transformDirection(matrix);
      tangent.needsUpdate = true;
    }

    if (this.boundingBox !== null) {
      this.computeBoundingBox();
    }

    if (this.boundingSphere !== null) {
      this.computeBoundingSphere();
    }

    return this;
  }

  applyQuaternion(q: Quaternion): this {
    _m1.makeRotationFromQuaternion(q);
    this.applyMatrix4(_m1);
    return this;
  }

  rotateX(angle: number): this {
    _m1.makeRotationX(angle);
    this.applyMatrix4(_m1);
    return this;
  }

  rotateY(angle: number): this {
    _m1.makeRotationY(angle);
    this.applyMatrix4(_m1);
    return this;
  }

  rotateZ(angle: number): this {
    _m1.makeRotationZ(angle);
    this.applyMatrix4(_m1);
    return this;
  }

  translate(x: number, y: number, z: number): this {
    _m1.makeTranslation(x, y, z);
    this.applyMatrix4(_m1);
    return this;
  }

  scale(x: number, y: number, z: number): this {
    _m1.makeScale(x, y, z);
    this.applyMatrix4(_m1);
    return this;
  }

  lookAt(vector: Vector3): this {
    _m1.lookAt(vector, _origin, _up);
    this.applyMatrix4(_m1);
    return this;
  }

  center(): this {
    this.computeBoundingBox();
    this.boundingBox!.getCenter(_offset).negate();
    this.translate(_offset.x, _offset.y, _offset.z);
    return this;
  }

  setFromPoints(points: Array<{ x: number; y: number; z?: number }>): this {
    const coords = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      coords[i * 3] = p.x;
      coords[i * 3 + 1] = p.y;
      coords[i * 3 + 2] = p.z ?? 0;
    }
    this.setAttribute('position', new Float32BufferAttribute(coords, 3));
    return this;
  }

  computeBoundingBox(): void {
    if (this.boundingBox === null) {
      this.boundingBox = new Box3();
    }

    const position = this.attributes.position;
    const morphPositions = this.morphAttributes.position;

    if (position !== undefined) {
      this.boundingBox.setFromBufferAttribute(position);

      if (morphPositions) {
        for (let i = 0; i < morphPositions.length; i++) {
          _box.setFromBufferAttribute(morphPositions[i]);
          if (this.morphTargetsRelative) {
            _vector.addVectors(this.boundingBox.min, _box.min);
            this.boundingBox.expandByPoint(_vector);
            _vector.addVectors(this.boundingBox.max, _box.max);
            this.boundingBox.expandByPoint(_vector);
          } else {
            this.boundingBox.expandByPoint(_box.min);
            this.boundingBox.expandByPoint(_box.max);
          }
        }
      }
    } else {
      this.boundingBox.makeEmpty();
    }

    if (
      Number.isNaN(this.boundingBox.min.x) ||
      Number.isNaN(this.boundingBox.min.y) ||
      Number.isNaN(this.boundingBox.min.z)
    ) {
      this.boundingBox.makeEmpty();
    }
  }

  computeBoundingSphere(): void {
    if (this.boundingSphere === null) {
      this.boundingSphere = new Sphere();
    }

    const position = this.attributes.position;
    const morphPositions = this.morphAttributes.position;

    if (position === undefined) {
      this.boundingSphere.center.set(0, 0, 0);
      this.boundingSphere.radius = 0;
      return;
    }

    const center = this.boundingSphere.center;
    _box.setFromBufferAttribute(position);

    if (morphPositions) {
      for (let i = 0; i < morphPositions.length; i++) {
        _boxMorphTargets.setFromBufferAttribute(morphPositions[i]);
        if (this.morphTargetsRelative) {
          _vector.addVectors(_box.min, _boxMorphTargets.min);
          _box.expandByPoint(_vector);
          _vector.addVectors(_box.max, _boxMorphTargets.max);
          _box.expandByPoint(_vector);
        } else {
          _box.expandByPoint(_boxMorphTargets.min);
          _box.expandByPoint(_boxMorphTargets.max);
        }
      }
    }

    if (_box.isEmpty()) {
      center.set(0, 0, 0);
      this.boundingSphere.radius = 0;
      return;
    }

    _box.getCenter(center);

    let maxRadiusSq = 0;
    const count = position.count;
    for (let i = 0; i < count; i++) {
      _vector.fromBufferAttribute(position, i);
      maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
    }

    if (morphPositions) {
      for (let i = 0; i < morphPositions.length; i++) {
        const morphAttr = morphPositions[i];
        const mCount = morphAttr.count;
        for (let j = 0; j < mCount; j++) {
          _vector.fromBufferAttribute(morphAttr, j);
          if (this.morphTargetsRelative) {
            _offset.fromBufferAttribute(position, j);
            _vector.add(_offset);
          }
          maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
        }
      }
    }

    this.boundingSphere.radius = Math.sqrt(maxRadiusSq);
  }

  computeVertexNormals(): void {
    const position = this.attributes.position;
    if (position === undefined) return;

    let normal = this.attributes.normal;
    if (normal === undefined) {
      normal = new BufferAttribute(new Float32Array(position.count * 3), 3);
      this.setAttribute('normal', normal);
    } else {
      for (let i = 0; i < normal.count; i++) {
        normal.setXYZ(i, 0, 0, 0);
      }
    }

    const index = this.index;
    if (index !== null) {
      const idxCount = index.count;
      for (let i = 0; i + 2 < idxCount; i += 3) {
        const vA = index.getX(i);
        const vB = index.getX(i + 1);
        const vC = index.getX(i + 2);

        _pA.fromBufferAttribute(position, vA);
        _pB.fromBufferAttribute(position, vB);
        _pC.fromBufferAttribute(position, vC);

        _cb.subVectors(_pC, _pB);
        _ab.subVectors(_pA, _pB);
        _cb.cross(_ab);

        normal.setXYZ(vA, normal.getX(vA) + _cb.x, normal.getY(vA) + _cb.y, normal.getZ(vA) + _cb.z);
        normal.setXYZ(vB, normal.getX(vB) + _cb.x, normal.getY(vB) + _cb.y, normal.getZ(vB) + _cb.z);
        normal.setXYZ(vC, normal.getX(vC) + _cb.x, normal.getY(vC) + _cb.y, normal.getZ(vC) + _cb.z);
      }
    } else {
      const count = position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        _pA.fromBufferAttribute(position, i);
        _pB.fromBufferAttribute(position, i + 1);
        _pC.fromBufferAttribute(position, i + 2);

        _cb.subVectors(_pC, _pB);
        _ab.subVectors(_pA, _pB);
        _cb.cross(_ab);

        normal.setXYZ(i, _cb.x, _cb.y, _cb.z);
        normal.setXYZ(i + 1, _cb.x, _cb.y, _cb.z);
        normal.setXYZ(i + 2, _cb.x, _cb.y, _cb.z);
      }
    }

    this.normalizeNormals();
    normal.needsUpdate = true;
  }

  normalizeNormals(): void {
    const normals = this.attributes.normal;
    if (normals === undefined) return;

    for (let i = 0; i < normals.count; i++) {
      _vector.fromBufferAttribute(normals, i);
      const invLen = 1.0 / _vector.length();
      if (invLen === Infinity) {
        _vector.set(0, 0, 1);
      } else {
        _vector.multiplyScalar(invLen);
      }
      normals.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }
  }

  toNonIndexed(): BufferGeometry {
    if (this.index === null) {
      return this.clone();
    }

    const geometry = new BufferGeometry();
    const indices = this.index.array;
    const indexCount = indices.length;

    for (const name of Object.keys(this.attributes)) {
      const src = this.attributes[name];
      const itemSize = src.itemSize;
      const Ctor = src.array.constructor as new (len: number) => TypedArray;
      const out = new Ctor(indexCount * itemSize);

      for (let i = 0; i < indexCount; i++) {
        const srcBase = indices[i] * itemSize;
        const dstBase = i * itemSize;
        for (let k = 0; k < itemSize; k++) {
          out[dstBase + k] = src.array[srcBase + k];
        }
      }

      geometry.setAttribute(name, new BufferAttribute(out, itemSize, src.normalized));
    }

    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i];
      geometry.addGroup(g.start, g.count, g.materialIndex);
    }

    return geometry;
  }

  /**
   * Voxel-specific optimization: builds a chunk BufferGeometry with tight bounds
   * and normalized compact vertex attributes (e.g. Int8 normals, Uint8 colors)
   * without scanning every vertex when chunk bounds are supplied.
   */
  static createVoxelChunkGeometry(data: VoxelChunkMeshData): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.isVoxelGeometry = true;
    geometry.updateVoxelChunkBuffers(data);
    return geometry;
  }

  /**
   * Voxel-specific optimization: updates attributes in-place on chunk re-mesh,
   * reusing existing BufferAttribute wrappers and incrementing their version
   * so GPU uploaders can orphan/re-upload without rebuilding geometry metadata.
   */
  updateVoxelChunkBuffers(data: VoxelChunkMeshData): this {
    this.isVoxelGeometry = true;
    const usage = data.dynamic ? DynamicDrawUsage : StaticDrawUsage;

    const setOrUpdate = (
      attrName: string,
      typedArray: TypedArray,
      itemSize: number,
      normalized: boolean,
    ) => {
      const existing = this.attributes[attrName];
      if (existing !== undefined && existing.itemSize === itemSize && existing.normalized === normalized) {
        existing.setArray(typedArray);
        existing.setUsage(usage);
        existing.needsUpdate = true;
      } else {
        const attr = new BufferAttribute(typedArray, itemSize, normalized);
        attr.setUsage(usage);
        attr.needsUpdate = true;
        this.setAttribute(attrName, attr);
      }
    };

    setOrUpdate('position', data.positions, 3, false);

    if (data.normals !== undefined) {
      setOrUpdate('normal', data.normals, 3, data.normals instanceof Int8Array);
    }
    if (data.colors !== undefined) {
      setOrUpdate('color', data.colors, 3, data.colors instanceof Uint8Array);
    }
    if (data.uvs !== undefined) {
      setOrUpdate('uv', data.uvs, 2, false);
    }

    if (data.indices !== undefined) {
      const idxAttr = buildIndexAttribute(data.indices);
      idxAttr.setUsage(usage);
      idxAttr.needsUpdate = true;
      this.index = idxAttr;
      this.setDrawRange(0, idxAttr.count);
    } else {
      this.index = null;
      this.setDrawRange(0, data.positions.length / 3);
    }

    if (data.boundsMin !== undefined && data.boundsMax !== undefined) {
      if (this.boundingBox === null) this.boundingBox = new Box3();
      this.boundingBox.min.set(data.boundsMin.x, data.boundsMin.y, data.boundsMin.z);
      this.boundingBox.max.set(data.boundsMax.x, data.boundsMax.y, data.boundsMax.z);

      if (this.boundingSphere === null) this.boundingSphere = new Sphere();
      this.boundingBox.getBoundingSphere(this.boundingSphere);
    } else {
      this.boundingBox = null;
      this.boundingSphere = null;
    }

    return this;
  }

  clone(): BufferGeometry {
    return new BufferGeometry().copy(this);
  }

  copy(source: BufferGeometry): this {
    this.index = null;
    this.attributes = {};
    this.morphAttributes = {};
    this.groups = [];
    this.boundingBox = null;
    this.boundingSphere = null;

    this.name = source.name;
    this.isVoxelGeometry = source.isVoxelGeometry;

    if (source.index !== null) {
      this.setIndex(source.index.clone());
    }

    for (const name of Object.keys(source.attributes)) {
      this.setAttribute(name, source.attributes[name].clone());
    }

    this.morphTargetsRelative = source.morphTargetsRelative;
    for (const name of Object.keys(source.morphAttributes)) {
      this.morphAttributes[name] = source.morphAttributes[name].map((attr) => attr.clone());
    }

    for (let i = 0; i < source.groups.length; i++) {
      const g = source.groups[i];
      this.addGroup(g.start, g.count, g.materialIndex);
    }

    if (source.boundingBox !== null) {
      this.boundingBox = source.boundingBox.clone();
    }

    if (source.boundingSphere !== null) {
      this.boundingSphere = source.boundingSphere.clone();
    }

    this.drawRange.start = source.drawRange.start;
    this.drawRange.count = source.drawRange.count;
    this.userData = JSON.parse(JSON.stringify(source.userData));

    return this;
  }

  toJSON(): BufferGeometryJSON {
    const attributes: Record<string, BufferAttributeJSON> = {};
    for (const key of Object.keys(this.attributes)) {
      attributes[key] = this.attributes[key].toJSON();
    }

    const data: BufferGeometryJSON['data'] = { attributes };

    if (this.index !== null) {
      data.index = {
        type: this.index.array.constructor.name,
        array: Array.from(this.index.array),
      };
    }

    if (this.groups.length > 0) {
      data.groups = this.groups.map((g) => ({ ...g }));
    }

    if (this.boundingSphere !== null) {
      data.boundingSphere = {
        center: [
          this.boundingSphere.center.x,
          this.boundingSphere.center.y,
          this.boundingSphere.center.z,
        ],
        radius: this.boundingSphere.radius,
      };
    }

    const out: BufferGeometryJSON = {
      metadata: {
        version: 4.6,
        type: 'BufferGeometry',
        generator: 'VoxelEngine.BufferGeometry.toJSON',
      },
      uuid: this.uuid,
      type: this.type,
      data,
    };

    if (this.name !== '') out.name = this.name;
    if (Object.keys(this.userData).length > 0) out.userData = this.userData;

    return out;
  }

  dispose(): void {
    this.dispatchEvent({ type: 'dispose' });
  }
}
