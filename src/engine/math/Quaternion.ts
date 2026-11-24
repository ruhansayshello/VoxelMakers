import { clamp, type Matrix4Like, type Vector3Like, type Vector4Like } from './constants';
import type { Euler } from './Euler';

export class Quaternion {
  readonly isQuaternion = true;
  _x: number;
  _y: number;
  _z: number;
  _w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
  }

  static slerpFlat(
    dst: number[] | Float32Array,
    dstOffset: number,
    src0: ArrayLike<number>,
    srcOffset0: number,
    src1: ArrayLike<number>,
    srcOffset1: number,
    t: number,
  ): void {
    let x0 = src0[srcOffset0];
    let y0 = src0[srcOffset0 + 1];
    let z0 = src0[srcOffset0 + 2];
    let w0 = src0[srcOffset0 + 3];

    const x1 = src1[srcOffset1];
    const y1 = src1[srcOffset1 + 1];
    const z1 = src1[srcOffset1 + 2];
    const w1 = src1[srcOffset1 + 3];

    if (t === 0) {
      dst[dstOffset] = x0;
      dst[dstOffset + 1] = y0;
      dst[dstOffset + 2] = z0;
      dst[dstOffset + 3] = w0;
      return;
    }

    if (t === 1) {
      dst[dstOffset] = x1;
      dst[dstOffset + 1] = y1;
      dst[dstOffset + 2] = z1;
      dst[dstOffset + 3] = w1;
      return;
    }

    if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {
      let s = 1 - t;
      const cosHalf = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
      const sign = cosHalf >= 0 ? 1 : -1;
      const sqrSin = 1 - cosHalf * cosHalf;

      if (sqrSin > Number.EPSILON) {
        const sinHalf = Math.sqrt(sqrSin);
        const halfAngle = Math.atan2(sinHalf, cosHalf * sign);
        s = Math.sin(s * halfAngle) / sinHalf;
        t = Math.sin(t * halfAngle) / sinHalf;
      }

      const scaledT = t * sign;
      x0 = x0 * s + x1 * scaledT;
      y0 = y0 * s + y1 * scaledT;
      z0 = z0 * s + z1 * scaledT;
      w0 = w0 * s + w1 * scaledT;

      if (s === 1 - t) {
        const invLen = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
        x0 *= invLen;
        y0 *= invLen;
        z0 *= invLen;
        w0 *= invLen;
      }
    }

    dst[dstOffset] = x0;
    dst[dstOffset + 1] = y0;
    dst[dstOffset + 2] = z0;
    dst[dstOffset + 3] = w0;
  }

  static multiplyQuaternionsFlat(
    dst: number[] | Float32Array,
    dstOffset: number,
    src0: ArrayLike<number>,
    srcOffset0: number,
    src1: ArrayLike<number>,
    srcOffset1: number,
  ): number[] | Float32Array {
    const x0 = src0[srcOffset0];
    const y0 = src0[srcOffset0 + 1];
    const z0 = src0[srcOffset0 + 2];
    const w0 = src0[srcOffset0 + 3];

    const x1 = src1[srcOffset1];
    const y1 = src1[srcOffset1 + 1];
    const z1 = src1[srcOffset1 + 2];
    const w1 = src1[srcOffset1 + 3];

    dst[dstOffset] = x0 * w1 + w0 * x1 + y0 * z1 - z0 * y1;
    dst[dstOffset + 1] = y0 * w1 + w0 * y1 + z0 * x1 - x0 * z1;
    dst[dstOffset + 2] = z0 * w1 + w0 * z1 + x0 * y1 - y0 * x1;
    dst[dstOffset + 3] = w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1;

    return dst;
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

  get w(): number {
    return this._w;
  }

  set w(value: number) {
    this._w = value;
    this._onChangeCallback();
  }

  set(x: number, y: number, z: number, w: number): this {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
    this._onChangeCallback();
    return this;
  }

  clone(): Quaternion {
    return new Quaternion(this._x, this._y, this._z, this._w);
  }

  copy(q: Vector4Like): this {
    this._x = q.x;
    this._y = q.y;
    this._z = q.z;
    this._w = q.w;
    this._onChangeCallback();
    return this;
  }

  setFromEuler(euler: Euler, update = true): this {
    const hx = euler.x * 0.5;
    const hy = euler.y * 0.5;
    const hz = euler.z * 0.5;

    const cx = Math.cos(hx), sx = Math.sin(hx);
    const cy = Math.cos(hy), sy = Math.sin(hy);
    const cz = Math.cos(hz), sz = Math.sin(hz);

    switch (euler.order) {
      case 'XYZ':
        this._x = sx * cy * cz + cx * sy * sz;
        this._y = cx * sy * cz - sx * cy * sz;
        this._z = cx * cy * sz + sx * sy * cz;
        this._w = cx * cy * cz - sx * sy * sz;
        break;
      case 'YXZ':
        this._x = sx * cy * cz + cx * sy * sz;
        this._y = cx * sy * cz - sx * cy * sz;
        this._z = cx * cy * sz - sx * sy * cz;
        this._w = cx * cy * cz + sx * sy * sz;
        break;
      case 'ZXY':
        this._x = sx * cy * cz - cx * sy * sz;
        this._y = cx * sy * cz + sx * cy * sz;
        this._z = cx * cy * sz + sx * sy * cz;
        this._w = cx * cy * cz - sx * sy * sz;
        break;
      case 'ZYX':
        this._x = sx * cy * cz - cx * sy * sz;
        this._y = cx * sy * cz + sx * cy * sz;
        this._z = cx * cy * sz - sx * sy * cz;
        this._w = cx * cy * cz + sx * sy * sz;
        break;
      case 'YZX':
        this._x = sx * cy * cz + cx * sy * sz;
        this._y = cx * sy * cz + sx * cy * sz;
        this._z = cx * cy * sz - sx * sy * cz;
        this._w = cx * cy * cz - sx * sy * sz;
        break;
      case 'XZY':
        this._x = sx * cy * cz - cx * sy * sz;
        this._y = cx * sy * cz - sx * cy * sz;
        this._z = cx * cy * sz + sx * sy * cz;
        this._w = cx * cy * cz + sx * sy * sz;
        break;
    }

    if (update) this._onChangeCallback();
    return this;
  }

  setFromAxisAngle(axis: Vector3Like, angle: number): this {
    const half = angle * 0.5;
    const s = Math.sin(half);
    this._x = axis.x * s;
    this._y = axis.y * s;
    this._z = axis.z * s;
    this._w = Math.cos(half);
    this._onChangeCallback();
    return this;
  }

  setFromRotationMatrix(m: Matrix4Like): this {
    const e = m.elements;
    const r00 = e[0], r01 = e[4], r02 = e[8];
    const r10 = e[1], r11 = e[5], r12 = e[9];
    const r20 = e[2], r21 = e[6], r22 = e[10];
    const trace = r00 + r11 + r22;

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      this._w = 0.25 / s;
      this._x = (r21 - r12) * s;
      this._y = (r02 - r20) * s;
      this._z = (r10 - r01) * s;
    } else if (r00 > r11 && r00 > r22) {
      const s = 2.0 * Math.sqrt(1.0 + r00 - r11 - r22);
      this._w = (r21 - r12) / s;
      this._x = 0.25 * s;
      this._y = (r01 + r10) / s;
      this._z = (r02 + r20) / s;
    } else if (r11 > r22) {
      const s = 2.0 * Math.sqrt(1.0 + r11 - r00 - r22);
      this._w = (r02 - r20) / s;
      this._x = (r01 + r10) / s;
      this._y = 0.25 * s;
      this._z = (r12 + r21) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + r22 - r00 - r11);
      this._w = (r10 - r01) / s;
      this._x = (r02 + r20) / s;
      this._y = (r12 + r21) / s;
      this._z = 0.25 * s;
    }

    this._onChangeCallback();
    return this;
  }

  setFromUnitVectors(vFrom: Vector3Like, vTo: Vector3Like): this {
    let r = vFrom.x * vTo.x + vFrom.y * vTo.y + vFrom.z * vTo.z + 1;
    if (r < 1e-6) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this._x = -vFrom.y;
        this._y = vFrom.x;
        this._z = 0;
        this._w = r;
      } else {
        this._x = 0;
        this._y = -vFrom.z;
        this._z = vFrom.y;
        this._w = r;
      }
    } else {
      this._x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this._y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this._z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this._w = r;
    }
    return this.normalize();
  }

  angleTo(q: Quaternion): number {
    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
  }

  rotateTowards(q: Quaternion, step: number): this {
    const angle = this.angleTo(q);
    if (angle === 0) return this;
    const t = Math.min(1, step / angle);
    this.slerp(q, t);
    return this;
  }

  identity(): this {
    return this.set(0, 0, 0, 1);
  }

  invert(): this {
    return this.conjugate();
  }

  conjugate(): this {
    this._x = -this._x;
    this._y = -this._y;
    this._z = -this._z;
    this._onChangeCallback();
    return this;
  }

  dot(q: Vector4Like): number {
    return this._x * q.x + this._y * q.y + this._z * q.z + this._w * q.w;
  }

  lengthSq(): number {
    return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    let l = this.length();
    if (l === 0) {
      this._x = 0;
      this._y = 0;
      this._z = 0;
      this._w = 1;
    } else {
      l = 1 / l;
      this._x *= l;
      this._y *= l;
      this._z *= l;
      this._w *= l;
    }
    this._onChangeCallback();
    return this;
  }

  multiply(q: Vector4Like): this {
    return this.multiplyQuaternions(this, q);
  }

  premultiply(q: Vector4Like): this {
    return this.multiplyQuaternions(q, this);
  }

  multiplyQuaternions(a: Vector4Like, b: Vector4Like): this {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w;
    const bx = b.x, by = b.y, bz = b.z, bw = b.w;

    this._x = ax * bw + aw * bx + ay * bz - az * by;
    this._y = ay * bw + aw * by + az * bx - ax * bz;
    this._z = az * bw + aw * bz + ax * by - ay * bx;
    this._w = aw * bw - ax * bx - ay * by - az * bz;

    this._onChangeCallback();
    return this;
  }

  slerp(qb: Vector4Like, t: number): this {
    if (t === 0) return this;
    if (t === 1) return this.copy(qb);

    const ax = this._x, ay = this._y, az = this._z, aw = this._w;
    let cosHalf = aw * qb.w + ax * qb.x + ay * qb.y + az * qb.z;

    if (cosHalf < 0) {
      this._w = -qb.w;
      this._x = -qb.x;
      this._y = -qb.y;
      this._z = -qb.z;
      cosHalf = -cosHalf;
    } else {
      this.copy(qb);
    }

    if (cosHalf >= 1.0) {
      this._w = aw;
      this._x = ax;
      this._y = ay;
      this._z = az;
      return this;
    }

    const sqrSin = 1.0 - cosHalf * cosHalf;
    if (sqrSin <= Number.EPSILON) {
      const s = 1 - t;
      this._w = s * aw + t * this._w;
      this._x = s * ax + t * this._x;
      this._y = s * ay + t * this._y;
      this._z = s * az + t * this._z;
      return this.normalize();
    }

    const sinHalf = Math.sqrt(sqrSin);
    const halfAngle = Math.atan2(sinHalf, cosHalf);
    const ratioA = Math.sin((1 - t) * halfAngle) / sinHalf;
    const ratioB = Math.sin(t * halfAngle) / sinHalf;

    this._w = aw * ratioA + this._w * ratioB;
    this._x = ax * ratioA + this._x * ratioB;
    this._y = ay * ratioA + this._y * ratioB;
    this._z = az * ratioA + this._z * ratioB;

    this._onChangeCallback();
    return this;
  }

  slerpQuaternions(qa: Vector4Like, qb: Vector4Like, t: number): this {
    return this.copy(qa).slerp(qb, t);
  }

  equals(q: Vector4Like): boolean {
    return q.x === this._x && q.y === this._y && q.z === this._z && q.w === this._w;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    this._x = array[offset];
    this._y = array[offset + 1];
    this._z = array[offset + 2];
    this._w = array[offset + 3];
    this._onChangeCallback();
    return this;
  }

  toArray(array: number[] | Float32Array = [], offset = 0): number[] | Float32Array {
    array[offset] = this._x;
    array[offset + 1] = this._y;
    array[offset + 2] = this._z;
    array[offset + 3] = this._w;
    return array;
  }

  toJSON(): [number, number, number, number] {
    return [this._x, this._y, this._z, this._w];
  }

  _onChange(callback: () => void): this {
    this._onChangeCallback = callback;
    return this;
  }

  _onChangeCallback(): void {
    // no-op by default
  }

  *[Symbol.iterator](): Generator<number> {
    yield this._x;
    yield this._y;
    yield this._z;
    yield this._w;
  }
}
