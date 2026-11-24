import {
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
  type CoordinateSystem,
  type Matrix4Like,
  type Vector3Like,
  type Vector4Like,
} from './constants';
import type { Euler } from './Euler';
import type { Matrix3 } from './Matrix3';
import { Vector3 } from './Vector3';

let _scratchV: Vector3 | undefined;
let _scratchX: Vector3 | undefined;
let _scratchY: Vector3 | undefined;
let _scratchZ: Vector3 | undefined;
let _scratchZero: Vector3 | undefined;
let _scratchOne: Vector3 | undefined;
let _scratchM: Matrix4 | undefined;

export class Matrix4 implements Matrix4Like {
  readonly isMatrix4 = true;
  elements: Float32Array;

  constructor(
    r0c0?: number, r0c1?: number, r0c2?: number, r0c3?: number,
    r1c0?: number, r1c1?: number, r1c2?: number, r1c3?: number,
    r2c0?: number, r2c1?: number, r2c2?: number, r2c3?: number,
    r3c0?: number, r3c1?: number, r3c2?: number, r3c3?: number,
  ) {
    this.elements = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);

    if (r0c0 !== undefined) {
      this.set(
        r0c0, r0c1!, r0c2!, r0c3!,
        r1c0!, r1c1!, r1c2!, r1c3!,
        r2c0!, r2c1!, r2c2!, r2c3!,
        r3c0!, r3c1!, r3c2!, r3c3!,
      );
    }
  }

  /**
   * Sets matrix components from row-major arguments into column-major Float32Array storage.
   */
  set(
    r0c0: number, r0c1: number, r0c2: number, r0c3: number,
    r1c0: number, r1c1: number, r1c2: number, r1c3: number,
    r2c0: number, r2c1: number, r2c2: number, r2c3: number,
    r3c0: number, r3c1: number, r3c2: number, r3c3: number,
  ): this {
    const out = this.elements;
    out[0] = r0c0; out[4] = r0c1; out[8] = r0c2;  out[12] = r0c3;
    out[1] = r1c0; out[5] = r1c1; out[9] = r1c2;  out[13] = r1c3;
    out[2] = r2c0; out[6] = r2c1; out[10] = r2c2; out[14] = r2c3;
    out[3] = r3c0; out[7] = r3c1; out[11] = r3c2; out[15] = r3c3;
    return this;
  }

  identity(): this {
    const out = this.elements;
    out.fill(0);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return this;
  }

  clone(): Matrix4 {
    const copy = new Matrix4();
    copy.elements.set(this.elements);
    return copy;
  }

  copy(src: Matrix4Like): this {
    const dst = this.elements;
    const s = src.elements;
    for (let i = 0; i < 16; i++) {
      dst[i] = s[i];
    }
    return this;
  }

  copyPosition(src: Matrix4Like): this {
    const dst = this.elements;
    const s = src.elements;
    dst[12] = s[12];
    dst[13] = s[13];
    dst[14] = s[14];
    return this;
  }

  setFromMatrix3(m: Matrix3): this {
    const s = m.elements;
    return this.set(
      s[0], s[3], s[6], 0,
      s[1], s[4], s[7], 0,
      s[2], s[5], s[8], 0,
      0,    0,    0,    1,
    );
  }

  extractBasis(xAxis: Vector3, yAxis: Vector3, zAxis: Vector3): this {
    xAxis.setFromMatrixColumn(this, 0);
    yAxis.setFromMatrixColumn(this, 1);
    zAxis.setFromMatrixColumn(this, 2);
    return this;
  }

  makeBasis(xAxis: Vector3Like, yAxis: Vector3Like, zAxis: Vector3Like): this {
    return this.set(
      xAxis.x, yAxis.x, zAxis.x, 0,
      xAxis.y, yAxis.y, zAxis.y, 0,
      xAxis.z, yAxis.z, zAxis.z, 0,
      0,       0,       0,       1,
    );
  }

  extractRotation(src: Matrix4Like): this {
    if (_scratchV === undefined) _scratchV = new Vector3();
    const out = this.elements;
    const s = src.elements;

    const invSx = 1 / _scratchV.setFromMatrixColumn(src, 0).length();
    const invSy = 1 / _scratchV.setFromMatrixColumn(src, 1).length();
    const invSz = 1 / _scratchV.setFromMatrixColumn(src, 2).length();

    out[0] = s[0] * invSx; out[1] = s[1] * invSx; out[2] = s[2] * invSx; out[3] = 0;
    out[4] = s[4] * invSy; out[5] = s[5] * invSy; out[6] = s[6] * invSy; out[7] = 0;
    out[8] = s[8] * invSz; out[9] = s[9] * invSz; out[10] = s[10] * invSz; out[11] = 0;
    out[12] = 0;           out[13] = 0;           out[14] = 0;            out[15] = 1;

    return this;
  }

  makeRotationFromEuler(euler: Euler): this {
    const out = this.elements;
    const rx = euler.x;
    const ry = euler.y;
    const rz = euler.z;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);

    switch (euler.order) {
      case 'XYZ': {
        const cxcz = cx * cz, cxsz = cx * sz, sxcz = sx * cz, sxsz = sx * sz;
        out[0] = cy * cz;             out[4] = -cy * sz;            out[8] = sy;
        out[1] = cxsz + sxcz * sy;    out[5] = cxcz - sxsz * sy;    out[9] = -sx * cy;
        out[2] = sxsz - cxcz * sy;    out[6] = sxcz + cxsz * sy;    out[10] = cx * cy;
        break;
      }
      case 'YXZ': {
        const cycz = cy * cz, cysz = cy * sz, sycz = sy * cz, sysz = sy * sz;
        out[0] = cycz + sysz * sx;    out[4] = sycz * sx - cysz;    out[8] = cx * sy;
        out[1] = cx * sz;             out[5] = cx * cz;             out[9] = -sx;
        out[2] = cysz * sx - sycz;    out[6] = sysz + cycz * sx;    out[10] = cx * cy;
        break;
      }
      case 'ZXY': {
        const cycz = cy * cz, cysz = cy * sz, sycz = sy * cz, sysz = sy * sz;
        out[0] = cycz - sysz * sx;    out[4] = -cx * sz;            out[8] = sycz + cysz * sx;
        out[1] = cysz + sycz * sx;    out[5] = cx * cz;             out[9] = sysz - cycz * sx;
        out[2] = -cx * sy;            out[6] = sx;                  out[10] = cx * cy;
        break;
      }
      case 'ZYX': {
        const cxcz = cx * cz, cxsz = cx * sz, sxcz = sx * cz, sxsz = sx * sz;
        out[0] = cy * cz;             out[4] = sxcz * sy - cxsz;    out[8] = cxcz * sy + sxsz;
        out[1] = cy * sz;             out[5] = sxsz * sy + cxcz;    out[9] = cxsz * sy - sxcz;
        out[2] = -sy;                 out[6] = sx * cy;             out[10] = cx * cy;
        break;
      }
      case 'YZX': {
        const cxcy = cx * cy, cxsy = cx * sy, sxcy = sx * cy, sxsy = sx * sy;
        out[0] = cy * cz;             out[4] = sxsy - cxcy * sz;    out[8] = sxcy * sz + cxsy;
        out[1] = sz;                  out[5] = cx * cz;             out[9] = -sx * cz;
        out[2] = -sy * cz;            out[6] = cxsy * sz + sxcy;    out[10] = cxcy - sxsy * sz;
        break;
      }
      case 'XZY': {
        const cxcy = cx * cy, cxsy = cx * sy, sxcy = sx * cy, sxsy = sx * sy;
        out[0] = cy * cz;             out[4] = -sz;                 out[8] = sy * cz;
        out[1] = cxcy * sz + sxsy;    out[5] = cx * cz;             out[9] = cxsy * sz - sxcy;
        out[2] = sxcy * sz - cxsy;    out[6] = sx * cz;             out[10] = sxsy * sz + cxcy;
        break;
      }
    }

    out[3] = 0;  out[7] = 0;  out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return this;
  }

  makeRotationFromQuaternion(q: Vector4Like): this {
    if (_scratchZero === undefined) _scratchZero = new Vector3(0, 0, 0);
    if (_scratchOne === undefined) _scratchOne = new Vector3(1, 1, 1);
    return this.compose(_scratchZero, q, _scratchOne);
  }

  lookAt(eye: Vector3Like, target: Vector3Like, up: Vector3Like): this {
    if (_scratchX === undefined) _scratchX = new Vector3();
    if (_scratchY === undefined) _scratchY = new Vector3();
    if (_scratchZ === undefined) _scratchZ = new Vector3();

    const out = this.elements;
    _scratchZ.subVectors(eye, target);
    if (_scratchZ.lengthSq() === 0) {
      _scratchZ.z = 1;
    }
    _scratchZ.normalize();

    _scratchX.crossVectors(up, _scratchZ);
    if (_scratchX.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) {
        _scratchZ.x += 0.0001;
      } else {
        _scratchZ.z += 0.0001;
      }
      _scratchZ.normalize();
      _scratchX.crossVectors(up, _scratchZ);
    }
    _scratchX.normalize();
    _scratchY.crossVectors(_scratchZ, _scratchX);

    out[0] = _scratchX.x; out[4] = _scratchY.x; out[8] = _scratchZ.x;
    out[1] = _scratchX.y; out[5] = _scratchY.y; out[9] = _scratchZ.y;
    out[2] = _scratchX.z; out[6] = _scratchY.z; out[10] = _scratchZ.z;

    return this;
  }

  multiply(m: Matrix4Like): this {
    return this.multiplyMatrices(this, m);
  }

  premultiply(m: Matrix4Like): this {
    return this.multiplyMatrices(m, this);
  }

  multiplyMatrices(lhs: Matrix4Like, rhs: Matrix4Like): this {
    const a = lhs.elements;
    const b = rhs.elements;
    const out = this.elements;

    const a00 = a[0], a01 = a[4], a02 = a[8],  a03 = a[12];
    const a10 = a[1], a11 = a[5], a12 = a[9],  a13 = a[13];
    const a20 = a[2], a21 = a[6], a22 = a[10], a23 = a[14];
    const a30 = a[3], a31 = a[7], a32 = a[11], a33 = a[15];

    const b00 = b[0], b01 = b[4], b02 = b[8],  b03 = b[12];
    const b10 = b[1], b11 = b[5], b12 = b[9],  b13 = b[13];
    const b20 = b[2], b21 = b[6], b22 = b[10], b23 = b[14];
    const b30 = b[3], b31 = b[7], b32 = b[11], b33 = b[15];

    out[0]  = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30;
    out[4]  = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31;
    out[8]  = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32;
    out[12] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33;

    out[1]  = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30;
    out[5]  = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31;
    out[9]  = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32;
    out[13] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33;

    out[2]  = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30;
    out[6]  = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31;
    out[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32;
    out[14] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33;

    out[3]  = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30;
    out[7]  = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31;
    out[11] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32;
    out[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33;

    return this;
  }

  multiplyScalar(s: number): this {
    const out = this.elements;
    for (let i = 0; i < 16; i++) {
      out[i] *= s;
    }
    return this;
  }

  determinant(): number {
    const m = this.elements;
    const m00 = m[0], m01 = m[4], m02 = m[8],  m03 = m[12];
    const m10 = m[1], m11 = m[5], m12 = m[9],  m13 = m[13];
    const m20 = m[2], m21 = m[6], m22 = m[10], m23 = m[14];
    const m30 = m[3], m31 = m[7], m32 = m[11], m33 = m[15];

    return (
      m30 * (+m03 * m12 * m21 - m02 * m13 * m21 - m03 * m11 * m22 + m01 * m13 * m22 + m02 * m11 * m23 - m01 * m12 * m23) +
      m31 * (+m00 * m12 * m23 - m00 * m13 * m22 + m03 * m10 * m22 - m02 * m10 * m23 + m02 * m13 * m20 - m03 * m12 * m20) +
      m32 * (+m00 * m13 * m21 - m00 * m11 * m23 - m03 * m10 * m21 + m01 * m10 * m23 + m03 * m11 * m20 - m01 * m13 * m20) +
      m33 * (-m02 * m11 * m20 - m00 * m12 * m21 + m00 * m11 * m22 + m02 * m10 * m21 - m01 * m10 * m22 + m01 * m12 * m20)
    );
  }

  transpose(): this {
    const m = this.elements;
    let tmp: number;
    tmp = m[1];  m[1]  = m[4];  m[4]  = tmp;
    tmp = m[2];  m[2]  = m[8];  m[8]  = tmp;
    tmp = m[6];  m[6]  = m[9];  m[9]  = tmp;
    tmp = m[3];  m[3]  = m[12]; m[12] = tmp;
    tmp = m[7];  m[7]  = m[13]; m[13] = tmp;
    tmp = m[11]; m[11] = m[14]; m[14] = tmp;
    return this;
  }

  setPosition(x: number | Vector3Like, y?: number, z?: number): this {
    const out = this.elements;
    if (typeof x === 'object') {
      out[12] = x.x;
      out[13] = x.y;
      out[14] = x.z;
    } else {
      out[12] = x;
      out[13] = y ?? 0;
      out[14] = z ?? 0;
    }
    return this;
  }

  invert(): this {
    const m = this.elements;
    const m00 = m[0], m10 = m[1], m20 = m[2],  m30 = m[3];
    const m01 = m[4], m11 = m[5], m21 = m[6],  m31 = m[7];
    const m02 = m[8], m12 = m[9], m22 = m[10], m32 = m[11];
    const m03 = m[12], m13 = m[13], m23 = m[14], m33 = m[15];

    const c00 = m12 * m23 * m31 - m13 * m22 * m31 + m13 * m21 * m32 - m11 * m23 * m32 - m12 * m21 * m33 + m11 * m22 * m33;
    const c01 = m03 * m22 * m31 - m02 * m23 * m31 - m03 * m21 * m32 + m01 * m23 * m32 + m02 * m21 * m33 - m01 * m22 * m33;
    const c02 = m02 * m13 * m31 - m03 * m12 * m31 + m03 * m11 * m32 - m01 * m13 * m32 - m02 * m11 * m33 + m01 * m12 * m33;
    const c03 = m03 * m12 * m21 - m02 * m13 * m21 - m03 * m11 * m22 + m01 * m13 * m22 + m02 * m11 * m23 - m01 * m12 * m23;

    const det = m00 * c00 + m10 * c01 + m20 * c02 + m30 * c03;
    if (det === 0) {
      m.fill(0);
      return this;
    }

    const invDet = 1 / det;

    m[0] = c00 * invDet;
    m[1] = (m13 * m22 * m30 - m12 * m23 * m30 - m13 * m20 * m32 + m10 * m23 * m32 + m12 * m20 * m33 - m10 * m22 * m33) * invDet;
    m[2] = (m11 * m23 * m30 - m13 * m21 * m30 + m13 * m20 * m31 - m10 * m23 * m31 - m11 * m20 * m33 + m10 * m21 * m33) * invDet;
    m[3] = (m12 * m21 * m30 - m11 * m22 * m30 - m12 * m20 * m31 + m10 * m22 * m31 + m11 * m20 * m32 - m10 * m21 * m32) * invDet;

    m[4] = c01 * invDet;
    m[5] = (m02 * m23 * m30 - m03 * m22 * m30 + m03 * m20 * m32 - m00 * m23 * m32 - m02 * m20 * m33 + m00 * m22 * m33) * invDet;
    m[6] = (m03 * m21 * m30 - m01 * m23 * m30 - m03 * m20 * m31 + m00 * m23 * m31 + m01 * m20 * m33 - m00 * m21 * m33) * invDet;
    m[7] = (m01 * m22 * m30 - m02 * m21 * m30 + m02 * m20 * m31 - m00 * m22 * m31 - m01 * m20 * m32 + m00 * m21 * m32) * invDet;

    m[8] = c02 * invDet;
    m[9] = (m03 * m12 * m30 - m02 * m13 * m30 - m03 * m10 * m32 + m00 * m13 * m32 + m02 * m10 * m33 - m00 * m12 * m33) * invDet;
    m[10] = (m01 * m13 * m30 - m03 * m11 * m30 + m03 * m10 * m31 - m00 * m13 * m31 - m01 * m10 * m33 + m00 * m11 * m33) * invDet;
    m[11] = (m02 * m11 * m30 - m01 * m12 * m30 - m02 * m10 * m31 + m00 * m12 * m31 + m01 * m10 * m32 - m00 * m11 * m32) * invDet;

    m[12] = c03 * invDet;
    m[13] = (m02 * m13 * m20 - m03 * m12 * m20 + m03 * m10 * m22 - m00 * m13 * m22 - m02 * m10 * m23 + m00 * m12 * m23) * invDet;
    m[14] = (m03 * m11 * m20 - m01 * m13 * m20 - m03 * m10 * m21 + m00 * m13 * m21 + m01 * m10 * m23 - m00 * m11 * m23) * invDet;
    m[15] = (m01 * m12 * m20 - m02 * m11 * m20 + m02 * m10 * m21 - m00 * m12 * m21 - m01 * m10 * m22 + m00 * m11 * m22) * invDet;

    return this;
  }

  scale(v: Vector3Like): this {
    const m = this.elements;
    const sx = v.x, sy = v.y, sz = v.z;
    m[0] *= sx; m[4] *= sy; m[8] *= sz;
    m[1] *= sx; m[5] *= sy; m[9] *= sz;
    m[2] *= sx; m[6] *= sy; m[10] *= sz;
    m[3] *= sx; m[7] *= sy; m[11] *= sz;
    return this;
  }

  getMaxScaleOnAxis(): number {
    const m = this.elements;
    const sxSq = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
    const sySq = m[4] * m[4] + m[5] * m[5] + m[6] * m[6];
    const szSq = m[8] * m[8] + m[9] * m[9] + m[10] * m[10];
    return Math.sqrt(Math.max(sxSq, sySq, szSq));
  }

  makeTranslation(x: number | Vector3Like, y?: number, z?: number): this {
    if (typeof x === 'object') {
      return this.makeVoxelTransform(x.x, x.y, x.z);
    }
    return this.makeVoxelTransform(x, y ?? 0, z ?? 0);
  }

  /**
   * Voxel-specific optimization: direct fast-path translation transform for unrotated,
   * unit-scale voxel blocks and chunks. Skips quaternion math and matrix composition overhead.
   */
  makeVoxelTransform(x: number, y: number, z: number): this {
    const out = this.elements;
    out[0] = 1;  out[1] = 0;  out[2] = 0;  out[3] = 0;
    out[4] = 0;  out[5] = 1;  out[6] = 0;  out[7] = 0;
    out[8] = 0;  out[9] = 0;  out[10] = 1; out[11] = 0;
    out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
    return this;
  }

  makeRotationX(theta: number): this {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return this.set(
      1, 0,  0, 0,
      0, c, -s, 0,
      0, s,  c, 0,
      0, 0,  0, 1,
    );
  }

  makeRotationY(theta: number): this {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return this.set(
       c, 0, s, 0,
       0, 1, 0, 0,
      -s, 0, c, 0,
       0, 0, 0, 1,
    );
  }

  makeRotationZ(theta: number): this {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return this.set(
      c, -s, 0, 0,
      s,  c, 0, 0,
      0,  0, 1, 0,
      0,  0, 0, 1,
    );
  }

  makeRotationAxis(axis: Vector3Like, angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const ax = axis.x, ay = axis.y, az = axis.z;
    const tx = t * ax, ty = t * ay;

    return this.set(
      tx * ax + c,      tx * ay - s * az, tx * az + s * ay, 0,
      tx * ay + s * az, ty * ay + c,      ty * az - s * ax, 0,
      tx * az - s * ay, ty * az + s * ax, t * az * az + c,  0,
      0,                0,                0,                1,
    );
  }

  makeScale(x: number, y: number, z: number): this {
    return this.set(
      x, 0, 0, 0,
      0, y, 0, 0,
      0, 0, z, 0,
      0, 0, 0, 1,
    );
  }

  makeShear(xy: number, xz: number, yx: number, yz: number, zx: number, zy: number): this {
    return this.set(
      1,  yx, zx, 0,
      xy, 1,  zy, 0,
      xz, yz, 1,  0,
      0,  0,  0,  1,
    );
  }

  compose(position: Vector3Like, quaternion: Vector4Like, scale: Vector3Like): this {
    const out = this.elements;
    const qx = quaternion.x, qy = quaternion.y, qz = quaternion.z, qw = quaternion.w;
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;

    const sx = scale.x, sy = scale.y, sz = scale.z;

    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[3] = 0;

    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[7] = 0;

    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;
    out[11] = 0;

    out[12] = position.x;
    out[13] = position.y;
    out[14] = position.z;
    out[15] = 1;

    return this;
  }

  decompose(
    position: Vector3,
    quaternion: { setFromRotationMatrix(m: Matrix4): unknown },
    scale: Vector3,
  ): this {
    if (_scratchV === undefined) _scratchV = new Vector3();
    if (_scratchM === undefined) _scratchM = new Matrix4();

    const m = this.elements;
    let sx = _scratchV.set(m[0], m[1], m[2]).length();
    const sy = _scratchV.set(m[4], m[5], m[6]).length();
    const sz = _scratchV.set(m[8], m[9], m[10]).length();

    if (this.determinant() < 0) sx = -sx;

    position.x = m[12];
    position.y = m[13];
    position.z = m[14];

    _scratchM.copy(this);
    const invSx = 1 / sx;
    const invSy = 1 / sy;
    const invSz = 1 / sz;

    const sm = _scratchM.elements;
    sm[0] *= invSx; sm[1] *= invSx; sm[2] *= invSx;
    sm[4] *= invSy; sm[5] *= invSy; sm[6] *= invSy;
    sm[8] *= invSz; sm[9] *= invSz; sm[10] *= invSz;

    quaternion.setFromRotationMatrix(_scratchM);

    scale.x = sx;
    scale.y = sy;
    scale.z = sz;

    return this;
  }

  makePerspective(
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
    coordinateSystem: CoordinateSystem = WebGLCoordinateSystem,
    reversedDepth = false,
  ): this {
    const out = this.elements;
    const x = (2 * near) / (right - left);
    const y = (2 * near) / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);

    let c: number;
    let d: number;

    if (reversedDepth) {
      c = near / (far - near);
      d = (far * near) / (far - near);
    } else if (coordinateSystem === WebGLCoordinateSystem) {
      c = -(far + near) / (far - near);
      d = (-2 * far * near) / (far - near);
    } else if (coordinateSystem === WebGPUCoordinateSystem) {
      c = -far / (far - near);
      d = (-far * near) / (far - near);
    } else {
      throw new Error('Matrix4.makePerspective: Invalid coordinate system: ' + coordinateSystem);
    }

    out[0] = x; out[4] = 0; out[8] = a;   out[12] = 0;
    out[1] = 0; out[5] = y; out[9] = b;   out[13] = 0;
    out[2] = 0; out[6] = 0; out[10] = c;  out[14] = d;
    out[3] = 0; out[7] = 0; out[11] = -1; out[15] = 0;

    return this;
  }

  makeOrthographic(
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
    coordinateSystem: CoordinateSystem = WebGLCoordinateSystem,
    reversedDepth = false,
  ): this {
    const out = this.elements;
    const invW = 1 / (right - left);
    const invH = 1 / (top - bottom);
    const invD = 1 / (far - near);

    const tx = (right + left) * invW;
    const ty = (top + bottom) * invH;

    let zScale: number;
    let zTrans: number;

    if (reversedDepth) {
      zScale = invD;
      zTrans = far * invD;
    } else if (coordinateSystem === WebGLCoordinateSystem) {
      zScale = -2 * invD;
      zTrans = -(far + near) * invD;
    } else if (coordinateSystem === WebGPUCoordinateSystem) {
      zScale = -invD;
      zTrans = -near * invD;
    } else {
      throw new Error('Matrix4.makeOrthographic: Invalid coordinate system: ' + coordinateSystem);
    }

    out[0] = 2 * invW; out[4] = 0;        out[8] = 0;       out[12] = -tx;
    out[1] = 0;        out[5] = 2 * invH; out[9] = 0;       out[13] = -ty;
    out[2] = 0;        out[6] = 0;        out[10] = zScale; out[14] = zTrans;
    out[3] = 0;        out[7] = 0;        out[11] = 0;      out[15] = 1;

    return this;
  }

  equals(other: Matrix4Like): boolean {
    const a = this.elements;
    const b = other.elements;
    for (let i = 0; i < 16; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    for (let i = 0; i < 16; i++) {
      this.elements[i] = array[i + offset];
    }
    return this;
  }

  toArray(array: number[] | Float32Array = [], offset = 0): number[] | Float32Array {
    const m = this.elements;
    for (let i = 0; i < 16; i++) {
      array[offset + i] = m[i];
    }
    return array;
  }
}
