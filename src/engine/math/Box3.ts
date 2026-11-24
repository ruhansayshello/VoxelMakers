import type { BufferAttributeLike, Matrix4Like, Vector3Like } from './constants';
import { Vector3 } from './Vector3';
import type { Plane } from './Plane';
import type { Sphere } from './Sphere';

export interface Box3ObjectLike {
  matrixWorld: Matrix4Like;
  updateWorldMatrix?(updateParents: boolean, updateChildren: boolean): void;
  geometry?: {
    boundingBox: Box3 | null;
    computeBoundingBox(): void;
    attributes?: {
      position?: BufferAttributeLike;
    };
  };
  boundingBox?: Box3 | null;
  computeBoundingBox?(): void;
  children?: Box3ObjectLike[];
}

let _corners: Vector3[] | undefined;
let _scratchV: Vector3 | undefined;
let _scratchBox: Box3 | undefined;

function getCorners(): Vector3[] {
  if (_corners === undefined) {
    _corners = [
      new Vector3(), new Vector3(), new Vector3(), new Vector3(),
      new Vector3(), new Vector3(), new Vector3(), new Vector3(),
    ];
  }
  return _corners;
}

export class Box3 {
  readonly isBox3 = true;
  min: Vector3;
  max: Vector3;

  constructor(
    min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity),
  ) {
    this.min = min;
    this.max = max;
  }

  set(min: Vector3Like, max: Vector3Like): this {
    this.min.copy(min);
    this.max.copy(max);
    return this;
  }

  setFromArray(array: ArrayLike<number>): this {
    this.makeEmpty();
    for (let i = 0; i < array.length; i += 3) {
      this.expandByPoint(_getScratchV().set(array[i], array[i + 1], array[i + 2]));
    }
    return this;
  }

  setFromBufferAttribute(attribute: BufferAttributeLike): this {
    this.makeEmpty();
    const v = _getScratchV();
    for (let i = 0; i < attribute.count; i++) {
      this.expandByPoint(v.fromBufferAttribute(attribute, i));
    }
    return this;
  }

  setFromPoints(points: ArrayLike<Vector3Like>): this {
    this.makeEmpty();
    for (let i = 0; i < points.length; i++) {
      this.expandByPoint(points[i]);
    }
    return this;
  }

  setFromCenterAndSize(center: Vector3Like, size: Vector3Like): this {
    const half = _getScratchV().copy(size).multiplyScalar(0.5);
    this.min.copy(center).sub(half);
    this.max.copy(center).add(half);
    return this;
  }

  setFromObject(object: Box3ObjectLike, precise = false): this {
    this.makeEmpty();
    return this.expandByObject(object, precise);
  }

  clone(): Box3 {
    return new Box3().copy(this);
  }

  copy(box: Box3): this {
    this.min.copy(box.min);
    this.max.copy(box.max);
    return this;
  }

  makeEmpty(): this {
    this.min.x = this.min.y = this.min.z = Infinity;
    this.max.x = this.max.y = this.max.z = -Infinity;
    return this;
  }

  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }

  getCenter(target: Vector3): Vector3 {
    return this.isEmpty()
      ? target.set(0, 0, 0)
      : target.addVectors(this.min, this.max).multiplyScalar(0.5);
  }

  getSize(target: Vector3): Vector3 {
    return this.isEmpty()
      ? target.set(0, 0, 0)
      : target.subVectors(this.max, this.min);
  }

  expandByPoint(point: Vector3Like): this {
    this.min.min(point);
    this.max.max(point);
    return this;
  }

  expandByVector(vector: Vector3Like): this {
    this.min.sub(vector);
    this.max.add(vector);
    return this;
  }

  expandByScalar(scalar: number): this {
    this.min.addScalar(-scalar);
    this.max.addScalar(scalar);
    return this;
  }

  expandByObject(object: Box3ObjectLike, precise = false): this {
    if (object.updateWorldMatrix) {
      object.updateWorldMatrix(false, false);
    }

    if (object.boundingBox !== undefined) {
      if (object.boundingBox === null && object.computeBoundingBox) {
        object.computeBoundingBox();
      }
      if (object.boundingBox !== null) {
        if (_scratchBox === undefined) _scratchBox = new Box3();
        _scratchBox.copy(object.boundingBox);
        _scratchBox.applyMatrix4(object.matrixWorld);
        this.union(_scratchBox);
      }
    } else if (object.geometry !== undefined) {
      const geom = object.geometry;
      const posAttr = geom.attributes?.position;
      if (precise && posAttr !== undefined) {
        const v = _getScratchV();
        for (let i = 0; i < posAttr.count; i++) {
          v.fromBufferAttribute(posAttr, i).applyMatrix4(object.matrixWorld);
          this.expandByPoint(v);
        }
      } else {
        if (geom.boundingBox === null) {
          geom.computeBoundingBox();
        }
        if (geom.boundingBox !== null) {
          if (_scratchBox === undefined) _scratchBox = new Box3();
          _scratchBox.copy(geom.boundingBox);
          _scratchBox.applyMatrix4(object.matrixWorld);
          this.union(_scratchBox);
        }
      }
    }

    const children = object.children;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        this.expandByObject(children[i], precise);
      }
    }

    return this;
  }

  containsPoint(point: Vector3Like): boolean {
    return (
      point.x >= this.min.x && point.x <= this.max.x &&
      point.y >= this.min.y && point.y <= this.max.y &&
      point.z >= this.min.z && point.z <= this.max.z
    );
  }

  containsBox(box: Box3): boolean {
    return (
      this.min.x <= box.min.x && box.max.x <= this.max.x &&
      this.min.y <= box.min.y && box.max.y <= this.max.y &&
      this.min.z <= box.min.z && box.max.z <= this.max.z
    );
  }

  getParameter(point: Vector3Like, target: Vector3): Vector3 {
    return target.set(
      (point.x - this.min.x) / (this.max.x - this.min.x),
      (point.y - this.min.y) / (this.max.y - this.min.y),
      (point.z - this.min.z) / (this.max.z - this.min.z),
    );
  }

  intersectsBox(box: Box3): boolean {
    return (
      box.max.x >= this.min.x && box.min.x <= this.max.x &&
      box.max.y >= this.min.y && box.min.y <= this.max.y &&
      box.max.z >= this.min.z && box.min.z <= this.max.z
    );
  }

  intersectsSphere(sphere: Sphere): boolean {
    const clamped = this.clampPoint(sphere.center, _getScratchV());
    return clamped.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius;
  }

  intersectsPlane(plane: Plane): boolean {
    let lo: number;
    let hi: number;
    const n = plane.normal;

    if (n.x > 0) {
      lo = n.x * this.min.x;
      hi = n.x * this.max.x;
    } else {
      lo = n.x * this.max.x;
      hi = n.x * this.min.x;
    }

    if (n.y > 0) {
      lo += n.y * this.min.y;
      hi += n.y * this.max.y;
    } else {
      lo += n.y * this.max.y;
      hi += n.y * this.min.y;
    }

    if (n.z > 0) {
      lo += n.z * this.min.z;
      hi += n.z * this.max.z;
    } else {
      lo += n.z * this.max.z;
      hi += n.z * this.min.z;
    }

    return lo <= -plane.constant && hi >= -plane.constant;
  }

  clampPoint(point: Vector3Like, target: Vector3): Vector3 {
    return target.copy(point).clamp(this.min, this.max);
  }

  distanceToPoint(point: Vector3Like): number {
    return this.clampPoint(point, _getScratchV()).distanceTo(point);
  }

  getBoundingSphere(target: Sphere): Sphere {
    if (this.isEmpty()) {
      target.makeEmpty();
    } else {
      this.getCenter(target.center);
      target.radius = this.getSize(_getScratchV()).length() * 0.5;
    }
    return target;
  }

  intersect(box: Box3): this {
    this.min.max(box.min);
    this.max.min(box.max);
    if (this.isEmpty()) this.makeEmpty();
    return this;
  }

  union(box: Box3): this {
    this.min.min(box.min);
    this.max.max(box.max);
    return this;
  }

  applyMatrix4(matrix: Matrix4Like): this {
    if (this.isEmpty()) return this;

    const pts = getCorners();
    const minX = this.min.x, minY = this.min.y, minZ = this.min.z;
    const maxX = this.max.x, maxY = this.max.y, maxZ = this.max.z;

    pts[0].set(minX, minY, minZ).applyMatrix4(matrix);
    pts[1].set(minX, minY, maxZ).applyMatrix4(matrix);
    pts[2].set(minX, maxY, minZ).applyMatrix4(matrix);
    pts[3].set(minX, maxY, maxZ).applyMatrix4(matrix);
    pts[4].set(maxX, minY, minZ).applyMatrix4(matrix);
    pts[5].set(maxX, minY, maxZ).applyMatrix4(matrix);
    pts[6].set(maxX, maxY, minZ).applyMatrix4(matrix);
    pts[7].set(maxX, maxY, maxZ).applyMatrix4(matrix);

    this.setFromPoints(pts);
    return this;
  }

  translate(offset: Vector3Like): this {
    this.min.add(offset);
    this.max.add(offset);
    return this;
  }

  equals(box: Box3): boolean {
    return box.min.equals(this.min) && box.max.equals(this.max);
  }
}

function _getScratchV(): Vector3 {
  if (_scratchV === undefined) _scratchV = new Vector3();
  return _scratchV;
}
