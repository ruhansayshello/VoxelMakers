import type { Matrix4Like, Vector3Like } from './constants';
import { Matrix3 } from './Matrix3';
import { Vector3 } from './Vector3';
import type { Box3 } from './Box3';
import type { Sphere } from './Sphere';

export interface Line3Like {
  start: Vector3;
  end: Vector3;
  delta?(target: Vector3): Vector3;
}

let _scratchV1: Vector3 | undefined;
let _scratchV2: Vector3 | undefined;
let _scratchNormalMat: Matrix3 | undefined;

export class Plane {
  readonly isPlane = true;
  normal: Vector3;
  constant: number;

  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.normal = normal;
    this.constant = constant;
  }

  set(normal: Vector3Like, constant: number): this {
    this.normal.copy(normal);
    this.constant = constant;
    return this;
  }

  setComponents(x: number, y: number, z: number, w: number): this {
    this.normal.set(x, y, z);
    this.constant = w;
    return this;
  }

  setFromNormalAndCoplanarPoint(normal: Vector3Like, point: Vector3Like): this {
    this.normal.copy(normal);
    this.constant = -this.normal.dot(point);
    return this;
  }

  setFromCoplanarPoints(a: Vector3Like, b: Vector3Like, c: Vector3Like): this {
    if (_scratchV1 === undefined) _scratchV1 = new Vector3();
    if (_scratchV2 === undefined) _scratchV2 = new Vector3();

    const normal = _scratchV1.subVectors(c, b).cross(_scratchV2.subVectors(a, b)).normalize();
    return this.setFromNormalAndCoplanarPoint(normal, a);
  }

  copy(plane: Plane): this {
    this.normal.copy(plane.normal);
    this.constant = plane.constant;
    return this;
  }

  normalize(): this {
    const invLen = 1.0 / this.normal.length();
    this.normal.multiplyScalar(invLen);
    this.constant *= invLen;
    return this;
  }

  negate(): this {
    this.constant *= -1;
    this.normal.negate();
    return this;
  }

  distanceToPoint(point: Vector3Like): number {
    return this.normal.dot(point) + this.constant;
  }

  distanceToSphere(sphere: Sphere): number {
    return this.distanceToPoint(sphere.center) - sphere.radius;
  }

  projectPoint(point: Vector3Like, target: Vector3): Vector3 {
    return target.copy(point).addScaledVector(this.normal, -this.distanceToPoint(point));
  }

  intersectLine(line: Line3Like, target: Vector3): Vector3 | null {
    if (_scratchV1 === undefined) _scratchV1 = new Vector3();

    const direction = line.delta
      ? line.delta(_scratchV1)
      : _scratchV1.subVectors(line.end, line.start);

    const denom = this.normal.dot(direction);
    if (denom === 0) {
      if (this.distanceToPoint(line.start) === 0) {
        return target.copy(line.start);
      }
      return null;
    }

    const t = -(this.normal.dot(line.start) + this.constant) / denom;
    if (t < 0 || t > 1) {
      return null;
    }

    return target.copy(line.start).addScaledVector(direction, t);
  }

  intersectsLine(line: Line3Like): boolean {
    const startSign = this.distanceToPoint(line.start);
    const endSign = this.distanceToPoint(line.end);
    return (startSign < 0 && endSign > 0) || (endSign < 0 && startSign > 0);
  }

  intersectsBox(box: Box3): boolean {
    return box.intersectsPlane(this);
  }

  intersectsSphere(sphere: Sphere): boolean {
    return sphere.intersectsPlane(this);
  }

  coplanarPoint(target: Vector3): Vector3 {
    return target.copy(this.normal).multiplyScalar(-this.constant);
  }

  applyMatrix4(matrix: Matrix4Like, optionalNormalMatrix?: Matrix3): this {
    if (_scratchV1 === undefined) _scratchV1 = new Vector3();
    if (_scratchNormalMat === undefined) _scratchNormalMat = new Matrix3();

    const normalMat = optionalNormalMatrix ?? _scratchNormalMat.getNormalMatrix(matrix);
    const refPoint = this.coplanarPoint(_scratchV1).applyMatrix4(matrix);
    const normal = this.normal.applyMatrix3(normalMat).normalize();

    this.constant = -refPoint.dot(normal);
    return this;
  }

  translate(offset: Vector3Like): this {
    this.constant -= offset.x * this.normal.x + offset.y * this.normal.y + offset.z * this.normal.z;
    return this;
  }

  equals(plane: Plane): boolean {
    return plane.normal.equals(this.normal) && plane.constant === this.constant;
  }

  clone(): Plane {
    return new Plane().copy(this);
  }
}
