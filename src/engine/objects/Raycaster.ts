import { Matrix4, Ray, Vector3 } from '../math';
import { Layers, type Object3D } from '../core/Object3D';

export interface RaycasterCameraLike extends Object3D {
  isPerspectiveCamera?: boolean;
  isOrthographicCamera?: boolean;
  near: number;
  far: number;
  projectionMatrixInverse?: Matrix4;
  projectionMatrix: Matrix4;
}

export interface RaycasterIntersection {
  distance: number;
  point: Vector3;
  object: Object3D;
  face?: { a: number; b: number; c: number; normal: Vector3; materialIndex: number } | null;
  faceIndex?: number | null;
  uv?: { x: number; y: number };
  [key: string]: unknown;
}

export interface RaycasterParams {
  Mesh: { threshold?: number };
  Line: { threshold: number };
  LOD: { threshold?: number };
  Points: { threshold: number };
  Sprite: { threshold?: number };
}

export interface VoxelGridSource {
  getVoxel(x: number, y: number, z: number): number;
  voxelSize?: number;
  origin?: { x: number; y: number; z: number };
  dimX?: number;
  dimY?: number;
  dimZ?: number;
}

export interface VoxelChunkRaycastSource {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  data: ArrayLike<number>;
  voxelSize?: number;
  origin?: { x: number; y: number; z: number };
  /** Optional custom indexer; defaults to `x + z * sizeX + y * sizeX * sizeZ`. */
  getVoxel?: (x: number, y: number, z: number) => number;
}

export interface VoxelRaycastHit {
  /** Integer voxel coordinates hit in grid space. */
  voxel: Vector3;
  /** Adjacent empty voxel coordinates immediately prior to hit (for block placement). */
  prevVoxel: Vector3;
  /** Exact world-space hit position. */
  point: Vector3;
  /** Exact axis-aligned face normal of the hit voxel face. */
  normal: Vector3;
  /** Distance from ray origin to hit point in world units. */
  distance: number;
  /** Non-zero voxel material/block ID stored in the hit cell. */
  value: number;
}

const _invProj = new Matrix4();

function ascSort(a: RaycasterIntersection, b: RaycasterIntersection): number {
  return a.distance - b.distance;
}

function intersectObjectRecursive(
  object: Object3D,
  raycaster: Raycaster,
  intersects: RaycasterIntersection[],
  recursive: boolean,
): void {
  if (object.visible === false) return;

  if (object.layers.test(raycaster.layers)) {
    object.raycast(raycaster, intersects);
  }

  if (recursive === true) {
    const children = object.children;
    for (let i = 0; i < children.length; i++) {
      intersectObjectRecursive(children[i], raycaster, intersects, true);
    }
  }
}

export class Raycaster {
  ray: Ray;
  near: number;
  far: number;
  camera: RaycasterCameraLike | null = null;
  layers: Layers = new Layers();
  params: RaycasterParams = {
    Mesh: {},
    Line: { threshold: 1 },
    LOD: {},
    Points: { threshold: 1 },
    Sprite: {},
  };

  constructor(origin?: Vector3, direction?: Vector3, near = 0, far = Infinity) {
    this.ray = new Ray(origin, direction);
    this.near = near;
    this.far = far;
  }

  set(origin: Vector3, direction: Vector3): void {
    this.ray.set(origin, direction);
  }

  setFromCamera(coords: { x: number; y: number }, camera: RaycasterCameraLike): void {
    this.camera = camera;

    const invProj =
      camera.projectionMatrixInverse ?? _invProj.copy(camera.projectionMatrix).invert();

    if (camera.isPerspectiveCamera) {
      this.ray.origin.setFromMatrixPosition(camera.matrixWorld);
      this.ray.direction
        .set(coords.x, coords.y, 0.5)
        .applyMatrix4(invProj)
        .applyMatrix4(camera.matrixWorld)
        .sub(this.ray.origin)
        .normalize();
    } else if (camera.isOrthographicCamera) {
      const denom = camera.near - camera.far;
      const ndcZ = denom !== 0 ? (camera.near + camera.far) / denom : 0;
      this.ray.origin
        .set(coords.x, coords.y, ndcZ)
        .applyMatrix4(invProj)
        .applyMatrix4(camera.matrixWorld);
      this.ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
    } else {
      // Fallback: treat as perspective camera
      this.ray.origin.setFromMatrixPosition(camera.matrixWorld);
      this.ray.direction
        .set(coords.x, coords.y, 0.5)
        .applyMatrix4(invProj)
        .applyMatrix4(camera.matrixWorld)
        .sub(this.ray.origin)
        .normalize();
    }
  }

  intersectObject(
    object: Object3D,
    recursive = true,
    intersects: RaycasterIntersection[] = [],
  ): RaycasterIntersection[] {
    intersectObjectRecursive(object, this, intersects, recursive);
    intersects.sort(ascSort);
    return intersects;
  }

  intersectObjects(
    objects: Object3D[],
    recursive = true,
    intersects: RaycasterIntersection[] = [],
  ): RaycasterIntersection[] {
    for (let i = 0; i < objects.length; i++) {
      intersectObjectRecursive(objects[i], this, intersects, recursive);
    }
    intersects.sort(ascSort);
    return intersects;
  }

  /**
   * Voxel-specific optimization: 3D Amanatides & Woo fast DDA voxel raycaster
   * (default 95m reach). Supports both bounded chunks (with AABB slab entry) and
   * unbounded infinite voxel worlds, returning exact voxel coordinates, hit face
   * normal, and adjacent placement voxel without per-triangle intersection.
   */
  intersectVoxelGrid(grid: VoxelGridSource, maxDistance = 95): VoxelRaycastHit | null {
    const reach = Math.min(maxDistance, this.far);
    if (reach <= this.near) return null;

    const dir = this.ray.direction;
    const len = dir.length();
    if (len < 1e-8) return null;

    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;

    const voxelSize = grid.voxelSize ?? 1.0;
    const originX = grid.origin?.x ?? 0;
    const originY = grid.origin?.y ?? 0;
    const originZ = grid.origin?.z ?? 0;

    // Transform ray origin into grid-local space
    const lx = this.ray.origin.x - originX;
    const ly = this.ray.origin.y - originY;
    const lz = this.ray.origin.z - originZ;

    const bounded =
      grid.dimX !== undefined && grid.dimY !== undefined && grid.dimZ !== undefined;

    let tMin = Math.max(0, this.near);
    let tMax = reach;
    let nx = 0;
    let ny = 0;
    let nz = 0;

    if (bounded) {
      const maxX = grid.dimX! * voxelSize;
      const maxY = grid.dimY! * voxelSize;
      const maxZ = grid.dimZ! * voxelSize;

      const clipAxis = (
        o: number,
        d: number,
        maxB: number,
        axis: 0 | 1 | 2,
      ): boolean => {
        if (Math.abs(d) < 1e-8) {
          return o >= 0 && o <= maxB;
        }
        const invD = 1 / d;
        let t1 = (0 - o) * invD;
        let t2 = (maxB - o) * invD;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tMin) {
          tMin = t1;
          const nSign = d > 0 ? -1 : 1;
          nx = axis === 0 ? nSign : 0;
          ny = axis === 1 ? nSign : 0;
          nz = axis === 2 ? nSign : 0;
        }
        if (t2 < tMax) tMax = t2;
        return tMin <= tMax;
      };

      if (
        !clipAxis(lx, dx, maxX, 0) ||
        !clipAxis(ly, dy, maxY, 1) ||
        !clipAxis(lz, dz, maxZ, 2)
      ) {
        return null;
      }
    }

    const startT = tMin + (bounded && tMin > 0 ? 1e-5 : 0);
    const sx = lx + dx * startT;
    const sy = ly + dy * startT;
    const sz = lz + dz * startT;

    let vx = Math.floor(sx / voxelSize);
    let vy = Math.floor(sy / voxelSize);
    let vz = Math.floor(sz / voxelSize);

    if (bounded) {
      vx = Math.min(grid.dimX! - 1, Math.max(0, vx));
      vy = Math.min(grid.dimY! - 1, Math.max(0, vy));
      vz = Math.min(grid.dimZ! - 1, Math.max(0, vz));
    }

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(voxelSize / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(voxelSize / dy) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(voxelSize / dz) : Infinity;

    const nextBoundaryX = (vx + (stepX > 0 ? 1 : 0)) * voxelSize;
    const nextBoundaryY = (vy + (stepY > 0 ? 1 : 0)) * voxelSize;
    const nextBoundaryZ = (vz + (stepZ > 0 ? 1 : 0)) * voxelSize;

    let tMaxX = stepX !== 0 ? startT + (nextBoundaryX - sx) / dx : Infinity;
    let tMaxY = stepY !== 0 ? startT + (nextBoundaryY - sy) / dy : Infinity;
    let tMaxZ = stepZ !== 0 ? startT + (nextBoundaryZ - sz) / dz : Infinity;

    let prevVx = vx + nx;
    let prevVy = vy + ny;
    let prevVz = vz + nz;
    let currentT = tMin;

    const maxSteps = Math.ceil((tMax - startT) / voxelSize) * 3 + 16;

    for (let step = 0; step <= maxSteps; step++) {
      if (bounded) {
        if (
          vx < 0 ||
          vx >= grid.dimX! ||
          vy < 0 ||
          vy >= grid.dimY! ||
          vz < 0 ||
          vz >= grid.dimZ!
        ) {
          return null;
        }
      }

      const cell = grid.getVoxel(vx, vy, vz);
      if (cell !== 0) {
        return {
          voxel: new Vector3(vx, vy, vz),
          prevVoxel: new Vector3(prevVx, prevVy, prevVz),
          point: new Vector3(
            this.ray.origin.x + dx * currentT,
            this.ray.origin.y + dy * currentT,
            this.ray.origin.z + dz * currentT,
          ),
          normal: new Vector3(nx, ny, nz),
          distance: currentT,
          value: cell,
        };
      }

      prevVx = vx;
      prevVy = vy;
      prevVz = vz;

      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        if (tMaxX > tMax) return null;
        currentT = tMaxX;
        vx += stepX;
        tMaxX += tDeltaX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else if (tMaxY <= tMaxZ) {
        if (tMaxY > tMax) return null;
        currentT = tMaxY;
        vy += stepY;
        tMaxY += tDeltaY;
        nx = 0;
        ny = -stepY;
        nz = 0;
      } else {
        if (tMaxZ > tMax) return null;
        currentT = tMaxZ;
        vz += stepZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    }

    return null;
  }

  /**
   * Voxel-specific convenience helper for raycasting directly against a flat
   * chunk data buffer (`x + z * sizeX + y * sizeX * sizeZ` by default).
   */
  intersectChunk(chunk: VoxelChunkRaycastSource, maxDistance = 95): VoxelRaycastHit | null {
    const sx = chunk.sizeX;
    const sz = chunk.sizeZ;
    const data = chunk.data;
    const getter =
      chunk.getVoxel ??
      ((x: number, y: number, z: number) => data[x + z * sx + y * sx * sz] ?? 0);

    return this.intersectVoxelGrid(
      {
        dimX: chunk.sizeX,
        dimY: chunk.sizeY,
        dimZ: chunk.sizeZ,
        voxelSize: chunk.voxelSize ?? 1.0,
        origin: chunk.origin,
        getVoxel: getter,
      },
      maxDistance,
    );
  }
}
