import {
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
  type CameraLike,
  type CoordinateSystem,
  type Matrix4Like,
  type Vector3Like,
} from './constants';
import type { Box3 } from './Box3';
import { Matrix4 } from './Matrix4';
import { Plane } from './Plane';
import { Sphere } from './Sphere';
import { Vector3 } from './Vector3';

export interface FrustumObjectLike {
  matrixWorld: Matrix4Like;
  boundingSphere?: Sphere | null;
  computeBoundingSphere?(): void;
  geometry?: {
    boundingSphere: Sphere | null;
    computeBoundingSphere(): void;
  };
}

export interface ChunkSphereLike {
  center: Vector3Like;
  radius: number;
}

export type CullableChunk = ChunkSphereLike | { boundingSphere: ChunkSphereLike };

let _scratchSphere: Sphere | undefined;
let _scratchVec: Vector3 | undefined;
let _scratchProjScreen: Matrix4 | undefined;
let _scratchFrustum: Frustum | undefined;

export class Frustum {
  planes: [Plane, Plane, Plane, Plane, Plane, Plane];

  constructor(
    p0 = new Plane(),
    p1 = new Plane(),
    p2 = new Plane(),
    p3 = new Plane(),
    p4 = new Plane(),
    p5 = new Plane(),
  ) {
    this.planes = [p0, p1, p2, p3, p4, p5];
  }

  set(p0: Plane, p1: Plane, p2: Plane, p3: Plane, p4: Plane, p5: Plane): this {
    const planes = this.planes;
    planes[0].copy(p0);
    planes[1].copy(p1);
    planes[2].copy(p2);
    planes[3].copy(p3);
    planes[4].copy(p4);
    planes[5].copy(p5);
    return this;
  }

  copy(frustum: Frustum): this {
    const planes = this.planes;
    for (let i = 0; i < 6; i++) {
      planes[i].copy(frustum.planes[i]);
    }
    return this;
  }

  setFromProjectionMatrix(
    m: Matrix4Like,
    coordinateSystem: CoordinateSystem = WebGLCoordinateSystem,
    reversedDepth = false,
  ): this {
    const planes = this.planes;
    const e = m.elements;

    const m00 = e[0], m01 = e[4], m02 = e[8],  m03 = e[12];
    const m10 = e[1], m11 = e[5], m12 = e[9],  m13 = e[13];
    const m20 = e[2], m21 = e[6], m22 = e[10], m23 = e[14];
    const m30 = e[3], m31 = e[7], m32 = e[11], m33 = e[15];

    planes[0].setComponents(m30 - m00, m31 - m01, m32 - m02, m33 - m03).normalize();
    planes[1].setComponents(m30 + m00, m31 + m01, m32 + m02, m33 + m03).normalize();
    planes[2].setComponents(m30 + m10, m31 + m11, m32 + m12, m33 + m13).normalize();
    planes[3].setComponents(m30 - m10, m31 - m11, m32 - m12, m33 - m13).normalize();
    planes[4].setComponents(m30 - m20, m31 - m21, m32 - m22, m33 - m23).normalize();

    if (reversedDepth) {
      planes[5].setComponents(m20, m21, m22, m23).normalize();
    } else if (coordinateSystem === WebGLCoordinateSystem) {
      planes[5].setComponents(m30 + m20, m31 + m21, m32 + m22, m33 + m23).normalize();
    } else if (coordinateSystem === WebGPUCoordinateSystem) {
      planes[5].setComponents(m20, m21, m22, m23).normalize();
    } else {
      throw new Error('Frustum.setFromProjectionMatrix: Invalid coordinate system: ' + coordinateSystem);
    }

    return this;
  }

  intersectsObject(object: FrustumObjectLike): boolean {
    if (_scratchSphere === undefined) _scratchSphere = new Sphere();

    if (object.boundingSphere !== undefined) {
      if (object.boundingSphere === null && object.computeBoundingSphere) {
        object.computeBoundingSphere();
      }
      if (object.boundingSphere === null) return false;
      _scratchSphere.copy(object.boundingSphere).applyMatrix4(object.matrixWorld);
    } else if (object.geometry !== undefined) {
      const geom = object.geometry;
      if (geom.boundingSphere === null) {
        geom.computeBoundingSphere();
      }
      if (geom.boundingSphere === null) return false;
      _scratchSphere.copy(geom.boundingSphere).applyMatrix4(object.matrixWorld);
    } else {
      return false;
    }

    return this.intersectsSphere(_scratchSphere);
  }

  intersectsSphere(sphere: ChunkSphereLike): boolean {
    const planes = this.planes;
    const center = sphere.center;
    const negRadius = -sphere.radius;

    for (let i = 0; i < 6; i++) {
      const dist = planes[i].distanceToPoint(center);
      if (dist < negRadius) return false;
    }

    return true;
  }

  intersectsBox(box: Box3): boolean {
    if (_scratchVec === undefined) _scratchVec = new Vector3();
    const planes = this.planes;
    const v = _scratchVec;

    for (let i = 0; i < 6; i++) {
      const plane = planes[i];
      v.x = plane.normal.x > 0 ? box.max.x : box.min.x;
      v.y = plane.normal.y > 0 ? box.max.y : box.min.y;
      v.z = plane.normal.z > 0 ? box.max.z : box.min.z;

      if (plane.distanceToPoint(v) < 0) return false;
    }

    return true;
  }

  containsPoint(point: Vector3Like): boolean {
    const planes = this.planes;
    for (let i = 0; i < 6; i++) {
      if (planes[i].distanceToPoint(point) < 0) return false;
    }
    return true;
  }

  /**
   * Voxel-specific optimization: bulk frustum-culls an array of chunk bounding spheres
   * in a single tight unrolled loop with zero per-chunk heap allocations.
   *
   * If `camera` is provided, updates this frustum's 6 planes from `camera.projectionMatrix * camera.matrixWorldInverse`
   * (or from a pre-multiplied `Matrix4` if passed directly). Returns indices of all visible chunks.
   */
  cullChunkArray(chunks: ReadonlyArray<CullableChunk>, camera?: CameraLike | Matrix4Like): number[] {
    if (camera !== undefined) {
      if ('projectionMatrix' in camera) {
        if (_scratchProjScreen === undefined) _scratchProjScreen = new Matrix4();
        _scratchProjScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.setFromProjectionMatrix(_scratchProjScreen);
      } else {
        this.setFromProjectionMatrix(camera);
      }
    }

    const p = this.planes;
    const n0x = p[0].normal.x, n0y = p[0].normal.y, n0z = p[0].normal.z, c0 = p[0].constant;
    const n1x = p[1].normal.x, n1y = p[1].normal.y, n1z = p[1].normal.z, c1 = p[1].constant;
    const n2x = p[2].normal.x, n2y = p[2].normal.y, n2z = p[2].normal.z, c2 = p[2].constant;
    const n3x = p[3].normal.x, n3y = p[3].normal.y, n3z = p[3].normal.z, c3 = p[3].constant;
    const n4x = p[4].normal.x, n4y = p[4].normal.y, n4z = p[4].normal.z, c4 = p[4].constant;
    const n5x = p[5].normal.x, n5y = p[5].normal.y, n5z = p[5].normal.z, c5 = p[5].constant;

    const visible: number[] = [];
    const len = chunks.length;

    for (let i = 0; i < len; i++) {
      const entry = chunks[i];
      const sphere = 'boundingSphere' in entry ? entry.boundingSphere : entry;
      const cx = sphere.center.x;
      const cy = sphere.center.y;
      const cz = sphere.center.z;
      const negR = -sphere.radius;

      if (
        n0x * cx + n0y * cy + n0z * cz + c0 >= negR &&
        n1x * cx + n1y * cy + n1z * cz + c1 >= negR &&
        n2x * cx + n2y * cy + n2z * cz + c2 >= negR &&
        n3x * cx + n3y * cy + n3z * cz + c3 >= negR &&
        n4x * cx + n4y * cy + n4z * cz + c4 >= negR &&
        n5x * cx + n5y * cy + n5z * cz + c5 >= negR
      ) {
        visible.push(i);
      }
    }

    return visible;
  }

  /**
   * Static convenience wrapper for bulk chunk culling without allocating a Frustum instance.
   */
  static cullChunkArray(chunks: ReadonlyArray<CullableChunk>, camera: CameraLike | Matrix4Like): number[] {
    if (_scratchFrustum === undefined) _scratchFrustum = new Frustum();
    return _scratchFrustum.cullChunkArray(chunks, camera);
  }

  clone(): Frustum {
    return new Frustum().copy(this);
  }
}
