import {
  Euler,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
  type Frustum,
  type Matrix4Like,
  type Vector3Like,
} from '../math';
import { EventDispatcher, type DispatchEvent } from './EventDispatcher';

export class Layers {
  mask = 1 | 0;

  set(channel: number): void {
    this.mask = ((1 << channel) | 0) >>> 0;
  }

  enable(channel: number): void {
    this.mask |= (1 << channel) | 0;
  }

  enableAll(): void {
    this.mask = 0xffffffff | 0;
  }

  toggle(channel: number): void {
    this.mask ^= (1 << channel) | 0;
  }

  disable(channel: number): void {
    this.mask &= ~((1 << channel) | 0);
  }

  disableAll(): void {
    this.mask = 0;
  }

  test(layers: Layers): boolean {
    return (this.mask & layers.mask) !== 0;
  }

  isEnabled(channel: number): boolean {
    return (this.mask & ((1 << channel) | 0)) !== 0;
  }
}

export function generateUUID(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = (Math.random() * 256) | 0;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
}

export interface SerializationMeta {
  geometries: Record<string, Record<string, unknown>>;
  materials: Record<string, Record<string, unknown>>;
  textures: Record<string, Record<string, unknown>>;
  images: Record<string, Record<string, unknown>>;
  animations: Record<string, Record<string, unknown>>;
}

export interface Object3DJSON {
  metadata?: {
    version: number;
    type: string;
    generator: string;
  };
  geometries?: Record<string, unknown>[];
  materials?: Record<string, unknown>[];
  textures?: Record<string, unknown>[];
  images?: Record<string, unknown>[];
  animations?: Record<string, unknown>[];
  object: Record<string, unknown>;
}

let _nextObjectId = 0;

const _scratchV = new Vector3();
const _scratchQ = new Quaternion();
const _scratchM = new Matrix4();
const _scratchTarget = new Vector3();
const _scratchPos = new Vector3();
const _scratchScale = new Vector3();
const _scratchQuat = new Quaternion();

const _axisX = new Vector3(1, 0, 0);
const _axisY = new Vector3(0, 1, 0);
const _axisZ = new Vector3(0, 0, 1);

const _addedEvent: DispatchEvent = { type: 'added' };
const _removedEvent: DispatchEvent = { type: 'removed' };
const _childAddedEvent: DispatchEvent = { type: 'childadded', child: null };
const _childRemovedEvent: DispatchEvent = { type: 'childremoved', child: null };

export class Object3D extends EventDispatcher {
  static DEFAULT_UP = new Vector3(0, 1, 0);
  static DEFAULT_MATRIX_AUTO_UPDATE = true;
  static DEFAULT_MATRIX_WORLD_AUTO_UPDATE = true;

  readonly isObject3D = true;
  readonly id: number;
  uuid: string;
  name = '';
  type = 'Object3D';

  parent: Object3D | null = null;
  children: Object3D[] = [];

  up: Vector3;
  readonly position: Vector3;
  readonly rotation: Euler;
  readonly quaternion: Quaternion;
  readonly scale: Vector3;

  readonly modelViewMatrix: Matrix4;
  readonly normalMatrix: Matrix3;

  matrix: Matrix4;
  matrixWorld: Matrix4;

  matrixAutoUpdate: boolean;
  matrixWorldAutoUpdate: boolean;
  matrixWorldNeedsUpdate = false;

  layers: Layers;
  visible = true;
  castShadow = false;
  receiveShadow = false;
  frustumCulled = true;
  renderOrder = 0;

  animations: unknown[] = [];
  userData: Record<string, unknown> = {};
  pivot: Vector3 | null = null;

  /**
   * Voxel-specific optimization flag: when true, marks this node as a voxel chunk mesh
   * eligible for batched rendering and fast-path translation-only matrix updates.
   */
  isChunk = false;

  /**
   * Direct SoA transform binding to a VoxelWorld body slot (Phase 3b zero-copy rendering).
   * When bound, `updateMatrix()` reads `bodyPositions`, `bodyQuaternions`, and `bodyComLocal`
   * directly from `VoxelWorld` typed arrays instead of requiring a per-frame JS copy step.
   */
  voxelWorldRef: {
    bodyPositions: Float32Array;
    bodyQuaternions: Float32Array;
    bodyComLocal: Float32Array;
  } | null = null;
  voxelBodySlot = -1;

  isCamera?: boolean;
  isLight?: boolean;
  isScene?: boolean;
  isMesh?: boolean;

  constructor() {
    super();

    this.id = _nextObjectId++;
    this.uuid = generateUUID();
    this.up = Object3D.DEFAULT_UP.clone();

    const position = new Vector3();
    const rotation = new Euler();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);

    rotation._onChange(() => {
      quaternion.setFromEuler(rotation, false);
    });

    quaternion._onChange(() => {
      rotation.setFromQuaternion(quaternion, undefined, false);
    });

    this.position = position;
    this.rotation = rotation;
    this.quaternion = quaternion;
    this.scale = scale;

    this.modelViewMatrix = new Matrix4();
    this.normalMatrix = new Matrix3();

    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();

    this.matrixAutoUpdate = Object3D.DEFAULT_MATRIX_AUTO_UPDATE;
    this.matrixWorldAutoUpdate = Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE;
    this.layers = new Layers();
  }

  onBeforeRender(..._args: unknown[]): void {
    // hook for subclasses or user callbacks
  }

  onAfterRender(..._args: unknown[]): void {
    // hook for subclasses or user callbacks
  }

  applyMatrix4(matrix: Matrix4Like): void {
    if (this.matrixAutoUpdate) this.updateMatrix();
    this.matrix.premultiply(matrix);
    this.matrix.decompose(this.position, this.quaternion, this.scale);
  }

  applyQuaternion(q: Quaternion): this {
    this.quaternion.premultiply(q);
    return this;
  }

  setRotationFromAxisAngle(axis: Vector3Like, angle: number): void {
    this.quaternion.setFromAxisAngle(axis, angle);
  }

  setRotationFromEuler(euler: Euler): void {
    this.quaternion.setFromEuler(euler, true);
  }

  setRotationFromMatrix(m: Matrix4Like): void {
    this.quaternion.setFromRotationMatrix(m);
  }

  setRotationFromQuaternion(q: Quaternion): void {
    this.quaternion.copy(q);
  }

  rotateOnAxis(axis: Vector3Like, angle: number): this {
    _scratchQ.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(_scratchQ);
    return this;
  }

  rotateOnWorldAxis(axis: Vector3Like, angle: number): this {
    _scratchQ.setFromAxisAngle(axis, angle);
    this.quaternion.premultiply(_scratchQ);
    return this;
  }

  rotateX(angle: number): this {
    return this.rotateOnAxis(_axisX, angle);
  }

  rotateY(angle: number): this {
    return this.rotateOnAxis(_axisY, angle);
  }

  rotateZ(angle: number): this {
    return this.rotateOnAxis(_axisZ, angle);
  }

  translateOnAxis(axis: Vector3Like, distance: number): this {
    _scratchV.copy(axis).applyQuaternion(this.quaternion);
    this.position.add(_scratchV.multiplyScalar(distance));
    return this;
  }

  translateX(distance: number): this {
    return this.translateOnAxis(_axisX, distance);
  }

  translateY(distance: number): this {
    return this.translateOnAxis(_axisY, distance);
  }

  translateZ(distance: number): this {
    return this.translateOnAxis(_axisZ, distance);
  }

  localToWorld(vector: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(this.matrixWorld);
  }

  worldToLocal(vector: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(_scratchM.copy(this.matrixWorld).invert());
  }

  lookAt(x: number | Vector3Like, y?: number, z?: number): void {
    if (typeof x === 'object') {
      _scratchTarget.copy(x);
    } else {
      _scratchTarget.set(x, y ?? 0, z ?? 0);
    }

    const parent = this.parent;
    this.updateWorldMatrix(true, false);
    _scratchPos.setFromMatrixPosition(this.matrixWorld);

    if (this.isCamera || this.isLight) {
      _scratchM.lookAt(_scratchPos, _scratchTarget, this.up);
    } else {
      _scratchM.lookAt(_scratchTarget, _scratchPos, this.up);
    }

    this.quaternion.setFromRotationMatrix(_scratchM);

    if (parent !== null) {
      _scratchM.extractRotation(parent.matrixWorld);
      _scratchQ.setFromRotationMatrix(_scratchM);
      this.quaternion.premultiply(_scratchQ.invert());
    }
  }

  add(...objects: Object3D[]): this {
    if (objects.length > 1) {
      for (let i = 0; i < objects.length; i++) {
        this.add(objects[i]);
      }
      return this;
    }

    const child = objects[0];
    if (!child || child === this || !child.isObject3D) {
      return this;
    }

    child.removeFromParent();
    child.parent = this;
    this.children.push(child);

    child.dispatchEvent(_addedEvent);
    _childAddedEvent.child = child;
    this.dispatchEvent(_childAddedEvent);
    _childAddedEvent.child = null;

    return this;
  }

  remove(...objects: Object3D[]): this {
    if (objects.length > 1) {
      for (let i = 0; i < objects.length; i++) {
        this.remove(objects[i]);
      }
      return this;
    }

    const child = objects[0];
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      child.parent = null;
      this.children.splice(idx, 1);

      child.dispatchEvent(_removedEvent);
      _childRemovedEvent.child = child;
      this.dispatchEvent(_childRemovedEvent);
      _childRemovedEvent.child = null;
    }

    return this;
  }

  removeFromParent(): this {
    if (this.parent !== null) {
      this.parent.remove(this);
    }
    return this;
  }

  clear(): this {
    if (this.children.length > 0) {
      this.remove(...this.children.slice());
    }
    return this;
  }

  attach(object: Object3D): this {
    this.updateWorldMatrix(true, false);
    _scratchM.copy(this.matrixWorld).invert();

    if (object.parent !== null) {
      object.parent.updateWorldMatrix(true, false);
      _scratchM.multiply(object.parent.matrixWorld);
    }

    object.applyMatrix4(_scratchM);
    object.removeFromParent();
    object.parent = this;
    this.children.push(object);

    object.updateWorldMatrix(false, true);

    object.dispatchEvent(_addedEvent);
    _childAddedEvent.child = object;
    this.dispatchEvent(_childAddedEvent);
    _childAddedEvent.child = null;

    return this;
  }

  getObjectById(id: number): Object3D | undefined {
    return this.getObjectByProperty('id', id);
  }

  getObjectByName(name: string): Object3D | undefined {
    return this.getObjectByProperty('name', name);
  }

  getObjectByProperty(name: string, value: unknown): Object3D | undefined {
    if ((this as unknown as Record<string, unknown>)[name] === value) {
      return this;
    }

    for (let i = 0; i < this.children.length; i++) {
      const found = this.children[i].getObjectByProperty(name, value);
      if (found !== undefined) return found;
    }

    return undefined;
  }

  getObjectsByProperty(name: string, value: unknown, result: Object3D[] = []): Object3D[] {
    if ((this as unknown as Record<string, unknown>)[name] === value) {
      result.push(this);
    }

    for (let i = 0; i < this.children.length; i++) {
      this.children[i].getObjectsByProperty(name, value, result);
    }

    return result;
  }

  getWorldPosition(target: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.matrixWorld);
  }

  getWorldQuaternion(target: Quaternion): Quaternion {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_scratchPos, target, _scratchScale);
    return target;
  }

  getWorldScale(target: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_scratchPos, _scratchQuat, target);
    return target;
  }

  getWorldDirection(target: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    const e = this.matrixWorld.elements;
    return target.set(e[8], e[9], e[10]).normalize();
  }

  raycast(_raycaster: unknown, _intersects: unknown[]): void {
    // overridden by renderable subclasses like Mesh
  }

  intersectsFrustum(_frustum: Frustum): boolean | undefined {
    return undefined;
  }

  traverse(callback: (object: Object3D) => void): void {
    callback(this);
    const children = this.children;
    for (let i = 0; i < children.length; i++) {
      children[i].traverse(callback);
    }
  }

  traverseVisible(callback: (object: Object3D) => void): void {
    if (!this.visible) return;
    callback(this);
    const children = this.children;
    for (let i = 0; i < children.length; i++) {
      children[i].traverseVisible(callback);
    }
  }

  traverseAncestors(callback: (object: Object3D) => void): void {
    if (this.parent !== null) {
      callback(this.parent);
      this.parent.traverseAncestors(callback);
    }
  }

  updateMatrix(): void {
    if (this.voxelWorldRef !== null && this.voxelBodySlot >= 0) {
      const vw = this.voxelWorldRef;
      const o3 = this.voxelBodySlot * 3;
      const o4 = this.voxelBodySlot * 4;
      _scratchQuat.set(
        vw.bodyQuaternions[o4],
        vw.bodyQuaternions[o4 + 1],
        vw.bodyQuaternions[o4 + 2],
        vw.bodyQuaternions[o4 + 3],
      );
      const cx = vw.bodyComLocal[o3];
      const cy = vw.bodyComLocal[o3 + 1];
      const cz = vw.bodyComLocal[o3 + 2];
      if (cx !== 0 || cy !== 0 || cz !== 0) {
        _scratchV.set(-cx, -cy, -cz).applyQuaternion(_scratchQuat);
        _scratchPos.set(
          vw.bodyPositions[o3] + _scratchV.x,
          vw.bodyPositions[o3 + 1] + _scratchV.y,
          vw.bodyPositions[o3 + 2] + _scratchV.z,
        );
      } else {
        _scratchPos.set(
          vw.bodyPositions[o3],
          vw.bodyPositions[o3 + 1],
          vw.bodyPositions[o3 + 2],
        );
      }
      this.matrix.compose(_scratchPos, _scratchQuat, this.scale);
    } else {
      this.matrix.compose(this.position, this.quaternion, this.scale);
    }

    if (this.pivot !== null) {
      const px = this.pivot.x;
      const py = this.pivot.y;
      const pz = this.pivot.z;
      const te = this.matrix.elements;

      te[12] += px - te[0] * px - te[4] * py - te[8] * pz;
      te[13] += py - te[1] * px - te[5] * py - te[9] * pz;
      te[14] += pz - te[2] * px - te[6] * py - te[10] * pz;
    }

    this.matrixWorldNeedsUpdate = true;
  }

  updateMatrixWorld(force = false): void {
    if (this.matrixAutoUpdate) this.updateMatrix();

    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate) {
        if (this.parent === null) {
          this.matrixWorld.copy(this.matrix);
        } else {
          this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
        }
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }

    const children = this.children;
    for (let i = 0; i < children.length; i++) {
      children[i].updateMatrixWorld(force);
    }
  }

  updateWorldMatrix(updateParents = false, updateChildren = false, force = false): void {
    if (updateParents && this.parent !== null) {
      this.parent.updateWorldMatrix(true, false);
    }

    if (this.matrixAutoUpdate) this.updateMatrix();

    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate) {
        if (this.parent === null) {
          this.matrixWorld.copy(this.matrix);
        } else {
          this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
        }
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }

    if (updateChildren) {
      const children = this.children;
      for (let i = 0; i < children.length; i++) {
        children[i].updateWorldMatrix(false, true, force);
      }
    }
  }

  toJSON(meta?: SerializationMeta | string): Object3DJSON {
    const isRoot = meta === undefined || typeof meta === 'string';
    const output: Object3DJSON = { object: {} };

    const sharedMeta: SerializationMeta = isRoot
      ? { geometries: {}, materials: {}, textures: {}, images: {}, animations: {} }
      : meta;

    if (isRoot) {
      output.metadata = {
        version: 4.6,
        type: 'Object',
        generator: 'Object3D.toJSON',
      };
    }

    const obj: Record<string, unknown> = {
      uuid: this.uuid,
      type: this.type,
      name: this.name,
      castShadow: this.castShadow,
      receiveShadow: this.receiveShadow,
      visible: this.visible,
      frustumCulled: this.frustumCulled,
      renderOrder: this.renderOrder,
      matrixAutoUpdate: this.matrixAutoUpdate,
      layers: this.layers.mask,
      matrix: Array.from(this.matrix.elements),
      up: [this.up.x, this.up.y, this.up.z],
    };

    if (this.isChunk) {
      obj.isChunk = true;
    }

    if (this.pivot !== null) {
      obj.pivot = [this.pivot.x, this.pivot.y, this.pivot.z];
    }

    if (Object.keys(this.userData).length > 0) {
      obj.userData = this.userData;
    }

    const serializeResource = (
      cache: Record<string, Record<string, unknown>>,
      item: { uuid: string; toJSON?: (m: SerializationMeta) => Record<string, unknown> },
    ): string => {
      if (cache[item.uuid] === undefined) {
        cache[item.uuid] = item.toJSON ? item.toJSON(sharedMeta) : { uuid: item.uuid };
      }
      return item.uuid;
    };

    const selfRecord = this as unknown as {
      geometry?: { uuid: string; toJSON?: (m: SerializationMeta) => Record<string, unknown> };
      material?:
        | { uuid: string; toJSON?: (m: SerializationMeta) => Record<string, unknown> }
        | Array<{ uuid: string; toJSON?: (m: SerializationMeta) => Record<string, unknown> }>;
      background?: { isColor?: boolean; isTexture?: boolean; uuid?: string; toJSON?: (m?: SerializationMeta) => unknown };
      environment?: { isTexture?: boolean; uuid?: string; toJSON?: (m?: SerializationMeta) => { uuid: string } };
    };

    if (this.isScene) {
      if (selfRecord.background) {
        if (selfRecord.background.isColor && selfRecord.background.toJSON) {
          obj.background = selfRecord.background.toJSON();
        } else if (selfRecord.background.isTexture && selfRecord.background.toJSON) {
          const texData = selfRecord.background.toJSON(sharedMeta) as { uuid: string };
          obj.background = texData.uuid;
        }
      }
      if (selfRecord.environment && selfRecord.environment.isTexture && selfRecord.environment.toJSON) {
        obj.environment = selfRecord.environment.toJSON(sharedMeta).uuid;
      }
    } else if (this.isMesh && selfRecord.geometry) {
      obj.geometry = serializeResource(sharedMeta.geometries, selfRecord.geometry);
    }

    if (selfRecord.material !== undefined) {
      if (Array.isArray(selfRecord.material)) {
        obj.material = selfRecord.material.map((mat) => serializeResource(sharedMeta.materials, mat));
      } else {
        obj.material = serializeResource(sharedMeta.materials, selfRecord.material);
      }
    }

    if (this.children.length > 0) {
      obj.children = this.children.map((child) => child.toJSON(sharedMeta).object);
    }

    if (isRoot) {
      const extract = (cache: Record<string, Record<string, unknown>>): Record<string, unknown>[] =>
        Object.values(cache).map((entry) => {
          const clone = { ...entry };
          delete clone.metadata;
          return clone;
        });

      const geometries = extract(sharedMeta.geometries);
      const materials = extract(sharedMeta.materials);
      const textures = extract(sharedMeta.textures);
      const images = extract(sharedMeta.images);
      const animations = extract(sharedMeta.animations);

      if (geometries.length > 0) output.geometries = geometries;
      if (materials.length > 0) output.materials = materials;
      if (textures.length > 0) output.textures = textures;
      if (images.length > 0) output.images = images;
      if (animations.length > 0) output.animations = animations;
    }

    output.object = obj;
    return output;
  }

  clone(recursive = true): this {
    const ctor = this.constructor as new () => this;
    return new ctor().copy(this, recursive);
  }

  copy(source: this, recursive = true): this {
    this.name = source.name;
    this.up.copy(source.up);

    this.position.copy(source.position);
    this.rotation.order = source.rotation.order;
    this.quaternion.copy(source.quaternion);
    this.scale.copy(source.scale);

    this.matrix.copy(source.matrix);
    this.matrixWorld.copy(source.matrixWorld);

    this.matrixAutoUpdate = source.matrixAutoUpdate;
    this.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
    this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;

    this.layers.mask = source.layers.mask;
    this.visible = source.visible;

    this.castShadow = source.castShadow;
    this.receiveShadow = source.receiveShadow;

    this.frustumCulled = source.frustumCulled;
    this.renderOrder = source.renderOrder;
    this.isChunk = source.isChunk;

    this.pivot = source.pivot !== null ? source.pivot.clone() : null;
    this.userData = JSON.parse(JSON.stringify(source.userData));

    if (recursive) {
      for (let i = 0; i < source.children.length; i++) {
        this.add(source.children[i].clone(true));
      }
    }

    return this;
  }
}
