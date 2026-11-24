import { clamp, type Matrix4Like, type Vector3Like } from './constants';
import { Matrix4 } from './Matrix4';
import { Quaternion } from './Quaternion';

export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';

let _scratchMatrix: Matrix4 | undefined;
let _scratchQuat: Quaternion | undefined;

export class Euler {
  static DEFAULT_ORDER: EulerOrder = 'XYZ';

  readonly isEuler = true;
  _x: number;
  _y: number;
  _z: number;
  _order: EulerOrder;

  constructor(x = 0, y = 0, z = 0, order: EulerOrder = Euler.DEFAULT_ORDER) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = order;
  }

  get x(): number {
    return this._x;
  }

  set x(value: number) {
    this._x = value;
    this._onChangeCallback();
  }

  get y(): number {
    return this._y;
  }

  set y(value: number) {
    this._y = value;
    this._onChangeCallback();
  }

  get z(): number {
    return this._z;
  }

  set z(value: number) {
    this._z = value;
    this._onChangeCallback();
  }

  get order(): EulerOrder {
    return this._order;
  }

  set order(value: EulerOrder) {
    this._order = value;
    this._onChangeCallback();
  }

  set(x: number, y: number, z: number, order: EulerOrder = this._order): this {
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = order;
    this._onChangeCallback();
    return this;
  }

  clone(): Euler {
    return new Euler(this._x, this._y, this._z, this._order);
  }

  copy(src: Euler): this {
    this._x = src._x;
    this._y = src._y;
    this._z = src._z;
    this._order = src._order;
    this._onChangeCallback();
    return this;
  }

  setFromRotationMatrix(m: Matrix4Like, order: EulerOrder = this._order, update = true): this {
    const e = m.elements;
    const r00 = e[0], r01 = e[4], r02 = e[8];
    const r10 = e[1], r11 = e[5], r12 = e[9];
    const r20 = e[2], r21 = e[6], r22 = e[10];
    const gimbalLockThreshold = 0.9999999;

    switch (order) {
      case 'XYZ':
        this._y = Math.asin(clamp(r02, -1, 1));
        if (Math.abs(r02) < gimbalLockThreshold) {
          this._x = Math.atan2(-r12, r22);
          this._z = Math.atan2(-r01, r00);
        } else {
          this._x = Math.atan2(r21, r11);
          this._z = 0;
        }
        break;

      case 'YXZ':
        this._x = Math.asin(-clamp(r12, -1, 1));
        if (Math.abs(r12) < gimbalLockThreshold) {
          this._y = Math.atan2(r02, r22);
          this._z = Math.atan2(r10, r11);
        } else {
          this._y = Math.atan2(-r20, r00);
          this._z = 0;
        }
        break;

      case 'ZXY':
        this._x = Math.asin(clamp(r21, -1, 1));
        if (Math.abs(r21) < gimbalLockThreshold) {
          this._y = Math.atan2(-r20, r22);
          this._z = Math.atan2(-r01, r11);
        } else {
          this._y = 0;
          this._z = Math.atan2(r10, r00);
        }
        break;

      case 'ZYX':
        this._y = Math.asin(-clamp(r20, -1, 1));
        if (Math.abs(r20) < gimbalLockThreshold) {
          this._x = Math.atan2(r21, r22);
          this._z = Math.atan2(r10, r00);
        } else {
          this._x = 0;
          this._z = Math.atan2(-r01, r11);
        }
        break;

      case 'YZX':
        this._z = Math.asin(clamp(r10, -1, 1));
        if (Math.abs(r10) < gimbalLockThreshold) {
          this._x = Math.atan2(-r12, r11);
          this._y = Math.atan2(-r20, r00);
        } else {
          this._x = 0;
          this._y = Math.atan2(r02, r22);
        }
        break;

      case 'XZY':
        this._z = Math.asin(-clamp(r01, -1, 1));
        if (Math.abs(r01) < gimbalLockThreshold) {
          this._x = Math.atan2(r21, r11);
          this._y = Math.atan2(r02, r00);
        } else {
          this._x = Math.atan2(-r12, r22);
          this._y = 0;
        }
        break;
    }

    this._order = order;
    if (update) this._onChangeCallback();
    return this;
  }

  setFromQuaternion(q: Quaternion, order: EulerOrder = this._order, update = true): this {
    if (_scratchMatrix === undefined) _scratchMatrix = new Matrix4();
    _scratchMatrix.makeRotationFromQuaternion(q);
    return this.setFromRotationMatrix(_scratchMatrix, order, update);
  }

  setFromVector3(v: Vector3Like, order: EulerOrder = this._order): this {
    return this.set(v.x, v.y, v.z, order);
  }

  reorder(newOrder: EulerOrder): this {
    if (_scratchQuat === undefined) _scratchQuat = new Quaternion();
    _scratchQuat.setFromEuler(this);
    return this.setFromQuaternion(_scratchQuat, newOrder);
  }

  equals(other: Euler): boolean {
    return (
      other._x === this._x &&
      other._y === this._y &&
      other._z === this._z &&
      other._order === this._order
    );
  }

  fromArray(array: [number, number, number, EulerOrder?]): this {
    this._x = array[0];
    this._y = array[1];
    this._z = array[2];
    if (array[3] !== undefined) this._order = array[3];
    this._onChangeCallback();
    return this;
  }

  toArray(array: (number | EulerOrder)[] = [], offset = 0): (number | EulerOrder)[] {
    array[offset] = this._x;
    array[offset + 1] = this._y;
    array[offset + 2] = this._z;
    array[offset + 3] = this._order;
    return array;
  }

  _onChange(callback: () => void): this {
    this._onChangeCallback = callback;
    return this;
  }

  _onChangeCallback(): void {
    // no-op by default
  }

  *[Symbol.iterator](): Generator<number | EulerOrder> {
    yield this._x;
    yield this._y;
    yield this._z;
    yield this._order;
  }
}
