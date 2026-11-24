import type { Matrix4Like, Vector3Like } from './constants';
import { Box3 } from './Box3';
import type { Plane } from './Plane';
import { Vector3 } from './Vector3';

let _scratchBox: Box3 | undefined;
let _scratchV1: Vector3 | undefined;
let _scratchV2: Vector3 | undefined;

export class Sphere {
  readonly isSphere = true;
  center: Vector3;
  radius: number;

  constructor(center = new Vector3(), radius = -1) {
    this.center = center;
    this.radius = radius;
  }

  set(center: Vector3Like, radius: number): this {
    this.center.copy(center);
    this.radius = radius;
    return this;
  }

  setFromPoints(points: ArrayLike<Vector3Like>, optionalCenter?: Vector3Like): this {
    const center = this.center;
    if (optionalCenter !== undefined) {
      center.copy(optionalCenter);
    } else {
      if (_scratchBox === undefined) _scratchBox = new Box3();
      _scratchBox.setFromPoints(points).getCenter(center);
    }

    let maxRadiusSq = 0;
    for (let i = 0; i < points.length; i++) {
      const distSq = center.distanceToSquared(points[i]);
      if (distSq > maxRadiusSq) maxRadiusSq = distSq;
    }

    this.radius = Math.sqrt(maxRadiusSq);
    return this;
  }

  copy(sphere: Sphere): this {
    this.center.copy(sphere.center);
    this.radius = sphere.radius;
    return this;
  }

  isEmpty(): boolean {
    return this.radius < 0;
  }

  makeEmpty(): this {
    this.center.set(0, 0, 0);
    this.radius = -1;
    return this;
  }

  containsPoint(point: Vector3Like): boolean {
    if (this.radius < 0) return false;
    return this.center.distanceToSquared(point) <= this.radius * this.radius;
  }

  /**
   * Alias for `containsPoint(point)` matching point-sphere intersection checks.
   */
  intersectsPoint(point: Vector3Like): boolean {
    return this.containsPoint(point);
  }

  distanceToPoint(point: Vector3Like): number {
    return this.center.distanceTo(point) - this.radius;
  }

  intersectsSphere(sphere: Sphere): boolean {
    if (this.radius < 0 || sphere.radius < 0) return false;
    const radiusSum = this.radius + sphere.radius;
    return this.center.distanceToSquared(sphere.center) <= radiusSum * radiusSum;
  }

  intersectsBox(box: Box3): boolean {
    return box.intersectsSphere(this);
  }

  intersectsPlane(plane: Plane): boolean {
    return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
  }

  clampPoint(point: Vector3Like, target: Vector3): Vector3 {
    const distSq = this.center.distanceToSquared(point);
    target.copy(point);

    if (distSq > this.radius * this.radius) {
      target.sub(this.center).normalize();
      target.multiplyScalar(this.radius).add(this.center);
    }

    return target;
  }

  getBoundingBox(target: Box3): Box3 {
    if (this.isEmpty()) {
      target.makeEmpty();
      return target;
    }
    target.set(this.center, this.center);
    target.expandByScalar(this.radius);
    return target;
  }

  applyMatrix4(matrix: Matrix4Like & { getMaxScaleOnAxis?(): number }): this {
    this.center.applyMatrix4(matrix);
    const e = matrix.elements;
    const maxScale = matrix.getMaxScaleOnAxis
      ? matrix.getMaxScaleOnAxis()
      : Math.sqrt(
          Math.max(
            e[0] * e[0] + e[1] * e[1] + e[2] * e[2],
            e[4] * e[4] + e[5] * e[5] + e[6] * e[6],
            e[8] * e[8] + e[9] * e[9] + e[10] * e[10],
          ),
        );
    this.radius *= maxScale;
    return this;
  }

  translate(offset: Vector3Like): this {
    this.center.add(offset);
    return this;
  }

  expandByPoint(point: Vector3Like): this {
    if (this.isEmpty()) {
      this.center.copy(point);
      this.radius = 0;
      return this;
    }

    if (_scratchV1 === undefined) _scratchV1 = new Vector3();
    _scratchV1.subVectors(point, this.center);
    const distSq = _scratchV1.lengthSq();

    if (distSq > this.radius * this.radius) {
      const dist = Math.sqrt(distSq);
      const delta = (dist - this.radius) * 0.5;
      this.center.addScaledVector(_scratchV1, delta / dist);
      this.radius += delta;
    }

    return this;
  }

  union(sphere: Sphere): this {
    if (sphere.isEmpty()) return this;
    if (this.isEmpty()) {
      this.copy(sphere);
      return this;
    }

    if (this.center.equals(sphere.center)) {
      this.radius = Math.max(this.radius, sphere.radius);
    } else {
      if (_scratchV1 === undefined) _scratchV1 = new Vector3();
      if (_scratchV2 === undefined) _scratchV2 = new Vector3();

      _scratchV2.subVectors(sphere.center, this.center).setLength(sphere.radius);
      this.expandByPoint(_scratchV1.copy(sphere.center).add(_scratchV2));
      this.expandByPoint(_scratchV1.copy(sphere.center).sub(_scratchV2));
    }

    return this;
  }

  equals(sphere: Sphere): boolean {
    return sphere.center.equals(this.center) && sphere.radius === this.radius;
  }

  clone(): Sphere {
    return new Sphere().copy(this);
  }
}
