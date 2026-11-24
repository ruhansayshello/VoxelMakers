import type { Matrix4Like, Vector3Like } from './constants';
import type { Box3 } from './Box3';
import type { Plane } from './Plane';
import type { Sphere } from './Sphere';
import { Vector3 } from './Vector3';

let _scratchV: Vector3 | undefined;
let _segCenter: Vector3 | undefined;
let _segDir: Vector3 | undefined;
let _diff: Vector3 | undefined;
let _edge1: Vector3 | undefined;
let _edge2: Vector3 | undefined;
let _triNormal: Vector3 | undefined;

export class Ray {
  origin: Vector3;
  direction: Vector3;

  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin;
    this.direction = direction;
  }

  set(origin: Vector3Like, direction: Vector3Like): this {
    this.origin.copy(origin);
    this.direction.copy(direction);
    return this;
  }

  copy(ray: Ray): this {
    this.origin.copy(ray.origin);
    this.direction.copy(ray.direction);
    return this;
  }

  at(t: number, target: Vector3): Vector3 {
    return target.copy(this.origin).addScaledVector(this.direction, t);
  }

  lookAt(v: Vector3Like): this {
    this.direction.copy(v).sub(this.origin).normalize();
    return this;
  }

  recast(t: number): this {
    if (_scratchV === undefined) _scratchV = new Vector3();
    this.origin.copy(this.at(t, _scratchV));
    return this;
  }

  closestPointToPoint(point: Vector3Like, target: Vector3): Vector3 {
    target.subVectors(point, this.origin);
    const proj = target.dot(this.direction);
    if (proj < 0) {
      return target.copy(this.origin);
    }
    return target.copy(this.origin).addScaledVector(this.direction, proj);
  }

  distanceToPoint(point: Vector3Like): number {
    return Math.sqrt(this.distanceSqToPoint(point));
  }

  distanceSqToPoint(point: Vector3Like): number {
    if (_scratchV === undefined) _scratchV = new Vector3();
    const proj = _scratchV.subVectors(point, this.origin).dot(this.direction);
    if (proj < 0) {
      return this.origin.distanceToSquared(point);
    }
    _scratchV.copy(this.origin).addScaledVector(this.direction, proj);
    return _scratchV.distanceToSquared(point);
  }

  distanceSqToSegment(
    v0: Vector3Like,
    v1: Vector3Like,
    optionalPointOnRay?: Vector3,
    optionalPointOnSegment?: Vector3,
  ): number {
    if (_segCenter === undefined) _segCenter = new Vector3();
    if (_segDir === undefined) _segDir = new Vector3();
    if (_diff === undefined) _diff = new Vector3();

    _segCenter.copy(v0).add(v1).multiplyScalar(0.5);
    _segDir.copy(v1).sub(v0).normalize();
    _diff.copy(this.origin).sub(_segCenter);

    const segExtent = Math.hypot(v0.x - v1.x, v0.y - v1.y, v0.z - v1.z) * 0.5;
    const a01 = -this.direction.dot(_segDir);
    const b0 = _diff.dot(this.direction);
    const b1 = -_diff.dot(_segDir);
    const c = _diff.lengthSq();
    const det = Math.abs(1 - a01 * a01);

    let s0: number;
    let s1: number;
    let sqrDist: number;

    if (det > 0) {
      s0 = a01 * b1 - b0;
      s1 = a01 * b0 - b1;
      const extDet = segExtent * det;

      if (s0 >= 0) {
        if (s1 >= -extDet) {
          if (s1 <= extDet) {
            const invDet = 1 / det;
            s0 *= invDet;
            s1 *= invDet;
            sqrDist = s0 * (s0 + a01 * s1 + 2 * b0) + s1 * (a01 * s0 + s1 + 2 * b1) + c;
          } else {
            s1 = segExtent;
            s0 = Math.max(0, -(a01 * s1 + b0));
            sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
          }
        } else {
          s1 = -segExtent;
          s0 = Math.max(0, -(a01 * s1 + b0));
          sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
        }
      } else if (s1 <= -extDet) {
        s0 = Math.max(0, -(-a01 * segExtent + b0));
        s1 = s0 > 0 ? -segExtent : Math.min(Math.max(-segExtent, -b1), segExtent);
        sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
      } else if (s1 <= extDet) {
        s0 = 0;
        s1 = Math.min(Math.max(-segExtent, -b1), segExtent);
        sqrDist = s1 * (s1 + 2 * b1) + c;
      } else {
        s0 = Math.max(0, -(a01 * segExtent + b0));
        s1 = s0 > 0 ? segExtent : Math.min(Math.max(-segExtent, -b1), segExtent);
        sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
      }
    } else {
      s1 = a01 > 0 ? -segExtent : segExtent;
      s0 = Math.max(0, -(a01 * s1 + b0));
      sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
    }

    if (optionalPointOnRay) {
      optionalPointOnRay.copy(this.origin).addScaledVector(this.direction, s0);
    }
    if (optionalPointOnSegment) {
      optionalPointOnSegment.copy(_segCenter).addScaledVector(_segDir, s1);
    }

    return sqrDist;
  }

  intersectSphere(sphere: Sphere, target: Vector3): Vector3 | null {
    if (_scratchV === undefined) _scratchV = new Vector3();
    _scratchV.subVectors(sphere.center, this.origin);
    const tca = _scratchV.dot(this.direction);
    const d2 = _scratchV.dot(_scratchV) - tca * tca;
    const radiusSq = sphere.radius * sphere.radius;

    if (d2 > radiusSq) return null;

    const thc = Math.sqrt(radiusSq - d2);
    const t0 = tca - thc;
    const t1 = tca + thc;

    if (t1 < 0) return null;
    if (t0 < 0) return this.at(t1, target);
    return this.at(t0, target);
  }

  intersectsSphere(sphere: Sphere): boolean {
    if (sphere.radius < 0) return false;
    return this.distanceSqToPoint(sphere.center) <= sphere.radius * sphere.radius;
  }

  distanceToPlane(plane: Plane): number | null {
    const denom = plane.normal.dot(this.direction);
    if (denom === 0) {
      return plane.distanceToPoint(this.origin) === 0 ? 0 : null;
    }
    const t = -(this.origin.dot(plane.normal) + plane.constant) / denom;
    return t >= 0 ? t : null;
  }

  intersectPlane(plane: Plane, target: Vector3): Vector3 | null {
    const t = this.distanceToPlane(plane);
    if (t === null) return null;
    return this.at(t, target);
  }

  intersectsPlane(plane: Plane): boolean {
    const dist = plane.distanceToPoint(this.origin);
    if (dist === 0) return true;
    const denom = plane.normal.dot(this.direction);
    return denom * dist < 0;
  }

  intersectBox(box: Box3, target: Vector3): Vector3 | null {
    const invX = 1 / this.direction.x;
    const invY = 1 / this.direction.y;
    const invZ = 1 / this.direction.z;
    const ox = this.origin.x;
    const oy = this.origin.y;
    const oz = this.origin.z;

    let tmin: number;
    let tmax: number;
    let tymin: number;
    let tymax: number;
    let tzmin: number;
    let tzmax: number;

    if (invX >= 0) {
      tmin = (box.min.x - ox) * invX;
      tmax = (box.max.x - ox) * invX;
    } else {
      tmin = (box.max.x - ox) * invX;
      tmax = (box.min.x - ox) * invX;
    }

    if (invY >= 0) {
      tymin = (box.min.y - oy) * invY;
      tymax = (box.max.y - oy) * invY;
    } else {
      tymin = (box.max.y - oy) * invY;
      tymax = (box.min.y - oy) * invY;
    }

    if (tmin > tymax || tymin > tmax) return null;
    if (tymin > tmin || Number.isNaN(tmin)) tmin = tymin;
    if (tymax < tmax || Number.isNaN(tmax)) tmax = tymax;

    if (invZ >= 0) {
      tzmin = (box.min.z - oz) * invZ;
      tzmax = (box.max.z - oz) * invZ;
    } else {
      tzmin = (box.max.z - oz) * invZ;
      tzmax = (box.min.z - oz) * invZ;
    }

    if (tmin > tzmax || tzmin > tmax) return null;
    if (tzmin > tmin || Number.isNaN(tmin)) tmin = tzmin;
    if (tzmax < tmax || Number.isNaN(tmax)) tmax = tzmax;

    if (tmax < 0) return null;

    return this.at(tmin >= 0 ? tmin : tmax, target);
  }

  intersectsBox(box: Box3): boolean {
    if (_scratchV === undefined) _scratchV = new Vector3();
    return this.intersectBox(box, _scratchV) !== null;
  }

  intersectTriangle(
    a: Vector3Like,
    b: Vector3Like,
    c: Vector3Like,
    backfaceCulling: boolean,
    target: Vector3,
  ): Vector3 | null {
    if (_edge1 === undefined) _edge1 = new Vector3();
    if (_edge2 === undefined) _edge2 = new Vector3();
    if (_triNormal === undefined) _triNormal = new Vector3();
    if (_diff === undefined) _diff = new Vector3();

    _edge1.subVectors(b, a);
    _edge2.subVectors(c, a);
    _triNormal.crossVectors(_edge1, _edge2);

    let dDotN = this.direction.dot(_triNormal);
    let sign: number;

    if (dDotN > 0) {
      if (backfaceCulling) return null;
      sign = 1;
    } else if (dDotN < 0) {
      sign = -1;
      dDotN = -dDotN;
    } else {
      return null;
    }

    _diff.subVectors(this.origin, a);
    const dDotQxE2 = sign * this.direction.dot(_edge2.crossVectors(_diff, _edge2));
    if (dDotQxE2 < 0) return null;

    const dDotE1xQ = sign * this.direction.dot(_edge1.cross(_diff));
    if (dDotE1xQ < 0) return null;
    if (dDotQxE2 + dDotE1xQ > dDotN) return null;

    const qDotN = -sign * _diff.dot(_triNormal);
    if (qDotN < 0) return null;

    return this.at(qDotN / dDotN, target);
  }

  applyMatrix4(matrix4: Matrix4Like): this {
    this.origin.applyMatrix4(matrix4);
    this.direction.transformDirection(matrix4);
    return this;
  }

  equals(ray: Ray): boolean {
    return ray.origin.equals(this.origin) && ray.direction.equals(this.direction);
  }

  clone(): Ray {
    return new Ray().copy(this);
  }
}
