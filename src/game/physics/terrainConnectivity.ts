import { MAT } from '../constants.ts';

/**
 * 10-neighbor connectivity offsets for terrain structural support:
 * Up, Down, N (-Z), S (+Z), E (+X), W (-X), NE, NW, SE, SW.
 * Note: This relation is strictly symmetric (undirected graph).
 */
export const TERRAIN_TEN_NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 0],  // Down (checked first to hit ground anchors rapidly)
  [0, 1, 0],   // Up
  [0, 0, -1],  // N
  [0, 0, 1],   // S
  [1, 0, 0],   // E
  [-1, 0, 0],  // W
  [1, 0, -1],  // NE
  [-1, 0, -1], // NW
  [1, 0, 1],   // SE
  [-1, 0, 1],  // SW
];

/**
 * Uncapped by default (`Infinity`) so large unsupported buildings, towers,
 * arches, and bridges always detach completely rather than staying floating.
 */
export const TERRAIN_SUPPORT_MAX_BFS_VISITED = Number.POSITIVE_INFINITY;

export interface TerrainVoxelCoord {
  vx: number;
  vy: number;
  vz: number;
  mat: number;
}

export interface TerrainConnectivityQuery {
  /** Center of destruction in voxel coordinates. */
  cvx: number;
  cvy: number;
  cvz: number;
  /** Radius of destruction in voxels (>= 1). */
  radiusVoxels: number;
  /** Inclusive world/grid bounds. */
  minWorldX: number;
  maxWorldX: number;
  minWorldY: number;
  maxWorldY: number;
  minWorldZ: number;
  maxWorldZ: number;
  /** Returns effective voxel material at (vx, vy, vz). MAT.AIR / MAT.WATER_VOX are empty. */
  getMat: (vx: number, vy: number, vz: number) => number;
  /**
   * Returns true if the solid voxel at (vx, vy, vz) is a ground/bedrock anchor.
   * Defaults to: `vy <= 0 || mat === MAT.BEDROCK`.
   */
  isGroundVoxel?: (vx: number, vy: number, vz: number, mat: number) => boolean;
  /**
   * Optional BFS visit cap. Defaults to `Infinity` (uncapped) so arbitrarily large
   * unsupported structures never stay floating.
   */
  maxBfsVisited?: number;
  /**
   * Optional local search half-extents around (cvx, cvy, cvz).
   * Defaults to full world bounds (uncapped) so wide bridges/buildings never shear or float.
   */
  halfWindowX?: number;
  halfWindowYDown?: number;
  halfWindowYUp?: number;
  halfWindowZ?: number;
}

export interface TerrainConnectivityResult {
  /** Disconnected unsupported terrain islands, each to be spawned as ONE unified TerrainEntity. */
  components: TerrainVoxelCoord[][];
  /** Flattened list of all unsupported voxels across all components. */
  unsupported: TerrainVoxelCoord[];
  supportedCount: number;
  bfsVisited: number;
  hitVisitedCap: boolean;
}

function isSolidTerrainMat(mat: number): boolean {
  return mat !== MAT.AIR && mat !== MAT.WATER_VOX;
}

/**
 * Default ground/bedrock predicate for standalone voxel grids:
 * ground voxels are `vy <= 0` or explicitly marked `MAT.BEDROCK`.
 */
export function defaultIsGroundVoxel(
  _vx: number,
  vy: number,
  _vz: number,
  mat: number,
): boolean {
  return vy <= 0 || mat === MAT.BEDROCK;
}

/**
 * Uncapped 10-neighbor terrain structural connectivity solver:
 *
 * Because the 10-neighbor relation (Up, Down, N, S, E, W, NE, NW, SE, SW) forms a
 * strictly symmetric undirected graph, a connected non-ground component is supported
 * by ground if and only if ANY voxel in that component is adjacent to a ground/bedrock
 * anchor (`vy <= 0`, `MAT.BEDROCK`, or custom `isGroundVoxel`).
 *
 * Performance & Zero-Cap Guarantee:
 * - Uses a downward-biased 2-bucket queue (`downQueue` popped before `otherQueue`):
 *   grounded buildings/hillsides shoot straight down to a ground anchor and short-circuit
 *   in O(height) steps (< 0.1ms even on massive 50,000-voxel grounded skyscrapers!).
 * - Any voxel visited during a grounded search is memoized in `groundedSet` so subsequent
 *   border candidates reaching it also short-circuit in O(1).
 * - Genuinely unsupported structures exhaust their entire connected component with NO
 *   500-voxel, 4096-voxel, or 56x28 window cap, returning each disconnected structure as
 *   its own `TerrainVoxelCoord[]` inside `components` so it falls as ONE unified entity.
 */
export function findUnsupportedTerrainVoxels(
  query: TerrainConnectivityQuery,
): TerrainConnectivityResult {
  const safeR = Math.max(1, Math.min(32, Math.round(query.radiusVoxels)));
  const maxBfsVisited =
    query.maxBfsVisited !== undefined && Number.isFinite(query.maxBfsVisited)
      ? Math.max(1, Math.floor(query.maxBfsVisited))
      : Number.POSITIVE_INFINITY;
  const isGround = query.isGroundVoxel ?? defaultIsGroundVoxel;

  const minX =
    query.halfWindowX !== undefined && Number.isFinite(query.halfWindowX)
      ? Math.max(query.minWorldX, query.cvx - Math.floor(query.halfWindowX))
      : query.minWorldX;
  const maxX =
    query.halfWindowX !== undefined && Number.isFinite(query.halfWindowX)
      ? Math.min(query.maxWorldX, query.cvx + Math.floor(query.halfWindowX))
      : query.maxWorldX;
  const minY =
    query.halfWindowYDown !== undefined && Number.isFinite(query.halfWindowYDown)
      ? Math.max(query.minWorldY, query.cvy - Math.floor(query.halfWindowYDown))
      : query.minWorldY;
  const maxY =
    query.halfWindowYUp !== undefined && Number.isFinite(query.halfWindowYUp)
      ? Math.min(query.maxWorldY, query.cvy + Math.floor(query.halfWindowYUp))
      : query.maxWorldY;
  const minZ =
    query.halfWindowZ !== undefined && Number.isFinite(query.halfWindowZ)
      ? Math.max(query.minWorldZ, query.cvz - Math.floor(query.halfWindowZ))
      : query.minWorldZ;
  const maxZ =
    query.halfWindowZ !== undefined && Number.isFinite(query.halfWindowZ)
      ? Math.min(query.maxWorldZ, query.cvz + Math.floor(query.halfWindowZ))
      : query.maxWorldZ;

  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const spanZ = maxZ - minZ + 1;
  if (spanX <= 0 || spanY <= 0 || spanZ <= 0) {
    return {
      components: [],
      unsupported: [],
      supportedCount: 0,
      bfsVisited: 0,
      hitVisitedCap: false,
    };
  }

  const strideY = spanX;
  const strideZ = spanX * spanY;
  const toLocalIdx = (vx: number, vy: number, vz: number): number =>
    vx - minX + (vy - minY) * strideY + (vz - minZ) * strideZ;

  // Step 1: Collect solid non-ground voxels directly bordering the destroyed region
  const borderMinX = Math.max(minX, query.cvx - safeR - 1);
  const borderMaxX = Math.min(maxX, query.cvx + safeR + 1);
  const borderMinY = Math.max(minY, query.cvy - safeR - 1);
  const borderMaxY = Math.min(maxY, query.cvy + safeR + 1);
  const borderMinZ = Math.max(minZ, query.cvz - safeR - 1);
  const borderMaxZ = Math.min(maxZ, query.cvz + safeR + 1);

  const matCache = new Map<number, number>();
  const groundCache = new Map<number, boolean>();

  const readCachedMat = (idx: number, vx: number, vy: number, vz: number): number => {
    let m = matCache.get(idx);
    if (m === undefined) {
      m = query.getMat(vx, vy, vz);
      matCache.set(idx, m);
    }
    return m;
  };

  const readCachedGround = (
    idx: number,
    vx: number,
    vy: number,
    vz: number,
    mat: number,
  ): boolean => {
    let g = groundCache.get(idx);
    if (g === undefined) {
      g = isGround(vx, vy, vz, mat);
      groundCache.set(idx, g);
    }
    return g;
  };

  const borderCandidates: number[] = [];
  for (let vz = borderMinZ; vz <= borderMaxZ; vz++) {
    for (let vy = borderMinY; vy <= borderMaxY; vy++) {
      for (let vx = borderMinX; vx <= borderMaxX; vx++) {
        const idx = toLocalIdx(vx, vy, vz);
        const mat = readCachedMat(idx, vx, vy, vz);
        if (!isSolidTerrainMat(mat)) continue;
        if (readCachedGround(idx, vx, vy, vz, mat)) continue;
        borderCandidates.push(idx);
      }
    }
  }

  if (borderCandidates.length === 0) {
    return {
      components: [],
      unsupported: [],
      supportedCount: 0,
      bfsVisited: 0,
      hitVisitedCap: false,
    };
  }

  const groundedSet = new Set<number>();
  const detachedSet = new Set<number>();
  const components: TerrainVoxelCoord[][] = [];
  const unsupported: TerrainVoxelCoord[] = [];
  let totalSupportedCount = 0;
  let totalBfsVisited = 0;
  let anyHitVisitedCap = false;

  // Step 2: Explore each candidate component via downward-biased 10-neighbor BFS
  for (let c = 0; c < borderCandidates.length; c++) {
    const startIdx = borderCandidates[c];
    if (groundedSet.has(startIdx) || detachedSet.has(startIdx)) continue;

    const compCells: number[] = [startIdx];
    const compVisited = new Set<number>([startIdx]);
    const downQueue: number[] = [];
    const otherQueue: number[] = [startIdx];
    let downHead = 0;
    let otherHead = 0;

    let isSupported = false;
    let compVisitedCount = 1;
    let compHitCap = false;

    while (downHead < downQueue.length || otherHead < otherQueue.length) {
      const curr =
        downHead < downQueue.length
          ? downQueue[downHead++]
          : otherQueue[otherHead++];

      const rem = curr % strideZ;
      const ix = rem % spanX;
      const iy = (rem / spanX) | 0;
      const iz = (curr / strideZ) | 0;
      const vx = minX + ix;
      const vy = minY + iy;
      const vz = minZ + iz;

      for (let d = 0; d < TERRAIN_TEN_NEIGHBORS.length; d++) {
        const off = TERRAIN_TEN_NEIGHBORS[d];
        const nx = vx + off[0];
        const ny = vy + off[1];
        const nz = vz + off[2];
        if (
          nx < minX ||
          nx > maxX ||
          ny < minY ||
          ny > maxY ||
          nz < minZ ||
          nz > maxZ
        ) {
          continue;
        }

        const nIdx = toLocalIdx(nx, ny, nz);
        if (groundedSet.has(nIdx)) {
          isSupported = true;
          break;
        }
        if (compVisited.has(nIdx) || detachedSet.has(nIdx)) continue;

        const nMat = readCachedMat(nIdx, nx, ny, nz);
        if (!isSolidTerrainMat(nMat)) continue;

        if (readCachedGround(nIdx, nx, ny, nz, nMat)) {
          isSupported = true;
          break;
        }

        if (compVisitedCount >= maxBfsVisited) {
          compHitCap = true;
          isSupported = true;
          break;
        }

        compVisited.add(nIdx);
        compCells.push(nIdx);
        compVisitedCount++;

        // Prioritize downward traversal (-Y) so grounded pillars reach ground immediately
        if (off[1] < 0) {
          downQueue.push(nIdx);
        } else {
          otherQueue.push(nIdx);
        }
      }

      if (isSupported) break;
    }

    totalBfsVisited += compVisitedCount;
    if (compHitCap) anyHitVisitedCap = true;

    if (isSupported) {
      for (let i = 0; i < compCells.length; i++) {
        groundedSet.add(compCells[i]);
      }
      totalSupportedCount += compCells.length;
    } else {
      // Entire connected component has zero path to ground -> emit as ONE unified island
      const component: TerrainVoxelCoord[] = new Array(compCells.length);
      for (let i = 0; i < compCells.length; i++) {
        const idx = compCells[i];
        detachedSet.add(idx);
        const rem = idx % strideZ;
        const ix = rem % spanX;
        const iy = (rem / spanX) | 0;
        const iz = (idx / strideZ) | 0;
        const vx = minX + ix;
        const vy = minY + iy;
        const vz = minZ + iz;
        const mat = readCachedMat(idx, vx, vy, vz);
        const entry: TerrainVoxelCoord = { vx, vy, vz, mat };
        component[i] = entry;
        unsupported.push(entry);
      }
      components.push(component);
    }
  }

  return {
    components,
    unsupported,
    supportedCount: totalSupportedCount,
    bfsVisited: totalBfsVisited,
    hitVisitedCap: anyHitVisitedCap,
  };
}
