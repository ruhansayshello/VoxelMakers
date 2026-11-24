import {
  Box3,
  Color,
  Matrix4,
  Ray,
  Sphere,
  Vector2,
  Vector3,
  type BufferAttributeLike,
  type Frustum,
} from '../math';
import { MeshBasicMaterial } from '../materials/MeshBasicMaterial';
import { BufferGeometry, type GeometryGroup } from './BufferGeometry';
import {
  BackSide,
  DoubleSide,
  FrontSide,
  TriangleFanDrawMode,
  TriangleStripDrawMode,
  TrianglesDrawMode,
} from './constants';
import { Object3D } from './Object3D';

export {
  BackSide,
  DoubleSide,
  FrontSide,
  TriangleFanDrawMode,
  TriangleStripDrawMode,
  TrianglesDrawMode,
  type GeometryGroup,
};

export interface MorphAttributeLike extends BufferAttributeLike {
  name?: string;
}

export interface BufferGeometryLike {
  isBufferGeometry?: boolean;
  uuid: string;
  attributes: Record<string, BufferAttributeLike | undefined>;
  morphAttributes?: Record<string, MorphAttributeLike[] | undefined>;
  morphTargetsRelative?: boolean;
  index: BufferAttributeLike | null;
  groups: Array<{ start: number; count: number; materialIndex?: number }>;
  drawRange: { start: number; count: number };
  boundingBox: Box3 | null;
  boundingSphere: Sphere | null;
  computeBoundingBox(): void;
  computeBoundingSphere(): void;
  toJSON?(): unknown;
}

export interface MaterialLike {
  isMaterial?: boolean;
  type?: string;
  uuid: string;
  side?: number;
  color?: Color;
  visible?: boolean;
  clone?(): MaterialLike;
  toJSON?(meta?: Record<string, unknown>): unknown;
}

export interface RaycasterLike {
  ray: Ray;
  near: number;
  far: number;
}

export interface MeshFace {
  a: number;
  b: number;
  c: number;
  normal: Vector3;
  materialIndex: number;
}

export interface MeshIntersection {
  distance: number;
  point: Vector3;
  object: Mesh;
  face: MeshFace;
  faceIndex: number;
  barycoord: Vector3;
  uv?: Vector2;
  uv1?: Vector2;
  normal?: Vector3;
}

const _invMatrix = new Matrix4();
const _localRay = new Ray();
const _worldSphere = new Sphere();
const _sphereHit = new Vector3();

const _vA = new Vector3();
const _vB = new Vector3();
const _vC = new Vector3();
const _tmpMorph = new Vector3();
const _morphSum = new Vector3();
const _hitLocal = new Vector3();
const _hitWorld = new Vector3();
const _baryV0 = new Vector3();
const _baryV1 = new Vector3();
const _baryV2 = new Vector3();

function computeBarycoord(point: Vector3, a: Vector3, b: Vector3, c: Vector3, target: Vector3): Vector3 {
  _baryV0.subVectors(c, a);
  _baryV1.subVectors(b, a);
  _baryV2.subVectors(point, a);

  const dot00 = _baryV0.dot(_baryV0);
  const dot01 = _baryV0.dot(_baryV1);
  const dot02 = _baryV0.dot(_baryV2);
  const dot11 = _baryV1.dot(_baryV1);
  const dot12 = _baryV1.dot(_baryV2);

  const denom = dot00 * dot11 - dot01 * dot01;
  if (denom === 0) {
    return target.set(-2, -1, -1);
  }

  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

  return target.set(1 - u - v, v, u);
}

function computeTriangleNormal(a: Vector3, b: Vector3, c: Vector3, target: Vector3): Vector3 {
  target.subVectors(c, b);
  _baryV0.subVectors(a, b);
  target.cross(_baryV0);
  const lenSq = target.lengthSq();
  if (lenSq > 0) {
    return target.multiplyScalar(1 / Math.sqrt(lenSq));
  }
  return target.set(0, 0, 0);
}

export class Mesh extends Object3D {
  isMesh = true;

  geometry: BufferGeometryLike;
  material: MaterialLike | MaterialLike[];
  drawMode: number = TrianglesDrawMode;
  morphTargetInfluences: number[] = [];
  morphTargetDictionary: Record<string, number> | null = null;
  count = 1;

  constructor(
    geometry: BufferGeometryLike = new BufferGeometry(),
    material: MaterialLike | MaterialLike[] = new MeshBasicMaterial(),
  ) {
    super();
    this.type = 'Mesh';
    this.geometry = geometry;
    this.material = material;
    this.updateMorphTargets();
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);

    this.drawMode = source.drawMode;
    this.morphTargetInfluences = source.morphTargetInfluences.slice();
    this.morphTargetDictionary =
      source.morphTargetDictionary !== null
        ? { ...source.morphTargetDictionary }
        : null;

    this.material = Array.isArray(source.material) ? source.material.slice() : source.material;
    this.geometry = source.geometry;

    return this;
  }

  updateMorphTargets(): void {
    const morphAttributes = this.geometry.morphAttributes;
    if (!morphAttributes) return;

    const keys = Object.keys(morphAttributes);
    if (keys.length === 0) return;

    const morphAttrList = morphAttributes[keys[0]];
    if (morphAttrList !== undefined && morphAttrList.length > 0) {
      this.morphTargetInfluences = [];
      this.morphTargetDictionary = {};

      for (let i = 0; i < morphAttrList.length; i++) {
        const name = morphAttrList[i].name || String(i);
        this.morphTargetInfluences.push(0);
        this.morphTargetDictionary[name] = i;
      }
    }
  }

  getVertexPosition(index: number, target: Vector3): Vector3 {
    const geometry = this.geometry;
    const position = geometry.attributes.position;
    if (!position) {
      return target.set(0, 0, 0);
    }

    target.fromBufferAttribute(position, index);

    const morphPosition = geometry.morphAttributes?.position;
    const influences = this.morphTargetInfluences;
    const relative = Boolean(geometry.morphTargetsRelative);

    if (morphPosition && influences.length > 0) {
      _morphSum.set(0, 0, 0);
      for (let i = 0; i < morphPosition.length; i++) {
        const weight = influences[i];
        if (!weight) continue;

        _tmpMorph.fromBufferAttribute(morphPosition[i], index);
        if (relative) {
          _morphSum.addScaledVector(_tmpMorph, weight);
        } else {
          _morphSum.addScaledVector(_tmpMorph.sub(target), weight);
        }
      }
      target.add(_morphSum);
    }

    return target;
  }

  override intersectsFrustum(frustum: Frustum): boolean {
    return frustum.intersectsObject(this);
  }

  override raycast(raycaster: RaycasterLike, intersects: MeshIntersection[]): void {
    const geometry = this.geometry;
    const material = this.material;
    const matrixWorld = this.matrixWorld;

    if (material === undefined) return;

    if (geometry.boundingSphere === null) {
      geometry.computeBoundingSphere();
    }
    if (geometry.boundingSphere === null) return;

    _worldSphere.copy(geometry.boundingSphere).applyMatrix4(matrixWorld);

    _localRay.copy(raycaster.ray).recast(raycaster.near);
    if (!_worldSphere.containsPoint(_localRay.origin)) {
      if (_localRay.intersectSphere(_worldSphere, _sphereHit) === null) return;
      const maxDist = raycaster.far - raycaster.near;
      if (_localRay.origin.distanceToSquared(_sphereHit) > maxDist * maxDist) return;
    }

    _invMatrix.copy(matrixWorld).invert();
    _localRay.copy(raycaster.ray).applyMatrix4(_invMatrix);

    if (geometry.boundingBox !== null && !_localRay.intersectsBox(geometry.boundingBox)) {
      return;
    }

    this._testGeometryTriangles(raycaster, intersects, _localRay);
  }

  private _testGeometryTriangles(
    raycaster: RaycasterLike,
    intersects: MeshIntersection[],
    rayLocal: Ray,
  ): void {
    const geometry = this.geometry;
    const material = this.material;
    const index = geometry.index;
    const position = geometry.attributes.position;
    if (!position) return;

    const uv = geometry.attributes.uv;
    const uv1 = geometry.attributes.uv1;
    const normalAttr = geometry.attributes.normal;
    const groups = geometry.groups ?? [];
    const drawRange = geometry.drawRange ?? { start: 0, count: Infinity };
    const totalCount = index !== null ? index.count : position.count;

    const testRange = (startIdx: number, endIdx: number, mat: MaterialLike, materialIndex: number) => {
      for (let i = startIdx; i + 2 < endIdx; i += 3) {
        const a = index !== null ? index.getX(i) : i;
        const b = index !== null ? index.getX(i + 1) : i + 1;
        const c = index !== null ? index.getX(i + 2) : i + 2;

        const hit = this._checkTriangle(mat, raycaster, rayLocal, uv, uv1, normalAttr, a, b, c);
        if (hit !== null) {
          hit.faceIndex = Math.floor(i / 3);
          hit.face.materialIndex = materialIndex;
          intersects.push(hit);
        }
      }
    };

    if (Array.isArray(material)) {
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        const matIdx = group.materialIndex ?? 0;
        const groupMat = material[matIdx];
        if (!groupMat) continue;

        const start = Math.max(group.start, drawRange.start);
        const end = Math.min(totalCount, Math.min(group.start + group.count, drawRange.start + drawRange.count));
        testRange(start, end, groupMat, matIdx);
      }
    } else {
      const start = Math.max(0, drawRange.start);
      const end = Math.min(totalCount, drawRange.start + drawRange.count);
      testRange(start, end, material, 0);
    }
  }

  private _checkTriangle(
    material: MaterialLike,
    raycaster: RaycasterLike,
    rayLocal: Ray,
    uv: BufferAttributeLike | undefined,
    uv1: BufferAttributeLike | undefined,
    normalAttr: BufferAttributeLike | undefined,
    a: number,
    b: number,
    c: number,
  ): MeshIntersection | null {
    this.getVertexPosition(a, _vA);
    this.getVertexPosition(b, _vB);
    this.getVertexPosition(c, _vC);

    const side = material.side ?? FrontSide;
    const hitPoint =
      side === BackSide
        ? rayLocal.intersectTriangle(_vC, _vB, _vA, true, _hitLocal)
        : rayLocal.intersectTriangle(_vA, _vB, _vC, side === FrontSide, _hitLocal);

    if (hitPoint === null) return null;

    _hitWorld.copy(hitPoint).applyMatrix4(this.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(_hitWorld);
    if (distance < raycaster.near || distance > raycaster.far) return null;

    const barycoord = computeBarycoord(hitPoint, _vA, _vB, _vC, new Vector3());
    const faceNormal = computeTriangleNormal(_vA, _vB, _vC, new Vector3());

    const result: MeshIntersection = {
      distance,
      point: _hitWorld.clone(),
      object: this,
      face: { a, b, c, normal: faceNormal, materialIndex: 0 },
      faceIndex: 0,
      barycoord,
    };

    if (uv) {
      result.uv = new Vector2(
        uv.getX(a) * barycoord.x + uv.getX(b) * barycoord.y + uv.getX(c) * barycoord.z,
        uv.getY(a) * barycoord.x + uv.getY(b) * barycoord.y + uv.getY(c) * barycoord.z,
      );
    }

    if (uv1) {
      result.uv1 = new Vector2(
        uv1.getX(a) * barycoord.x + uv1.getX(b) * barycoord.y + uv1.getX(c) * barycoord.z,
        uv1.getY(a) * barycoord.x + uv1.getY(b) * barycoord.y + uv1.getY(c) * barycoord.z,
      );
    }

    if (normalAttr && normalAttr.getZ) {
      const interpNormal = new Vector3(
        normalAttr.getX(a) * barycoord.x + normalAttr.getX(b) * barycoord.y + normalAttr.getX(c) * barycoord.z,
        normalAttr.getY(a) * barycoord.x + normalAttr.getY(b) * barycoord.y + normalAttr.getY(c) * barycoord.z,
        normalAttr.getZ(a) * barycoord.x + normalAttr.getZ(b) * barycoord.y + normalAttr.getZ(c) * barycoord.z,
      ).normalize();
      if (interpNormal.dot(rayLocal.direction) > 0) {
        interpNormal.negate();
      }
      result.normal = interpNormal;
    }

    return result;
  }
}
