import * as THREE from 'three';
import { VOXEL_SIZE } from './constants.ts';

/**
 * 1px micro-voxel size relative to the standard 4px (0.25m) world voxel.
 * 4 x 4 x 4 = 64 micro-voxels fit cleanly inside a single world voxel.
 */
export const MICRO_VOXEL_SUBDIV = 4;
export const MICRO_VOXEL_SIZE = VOXEL_SIZE / MICRO_VOXEL_SUBDIV; // 0.0625m

export interface MicroVoxelGrid {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly data: Uint8Array;
}

export interface MicroVoxelMeshOptions {
  /** World-space size of one micro-voxel. Defaults to MICRO_VOXEL_SIZE (0.0625m). */
  voxelSize?: number;
  /**
   * Pivot point in grid-voxel coordinates (e.g., [sx/2, sy/2, sz/2] to center the mesh).
   * Vertices are shifted by (-pivot[0], -pivot[1], -pivot[2]) * voxelSize.
   */
  pivot?: [number, number, number];
  /** Enables subtle corner ambient occlusion baked into vertex colors. Defaults to true. */
  bakeAO?: boolean;
  /** Enables subtle directional face shading for crisp voxel readability. Defaults to true. */
  bakeFaceShade?: boolean;
}

/**
 * Creates a compact Uint8Array micro-voxel grid (0 = empty, 1..255 = palette color index).
 */
export function createMicroVoxelGrid(
  sx: number,
  sy: number,
  sz: number,
): MicroVoxelGrid {
  return {
    sx: Math.max(1, sx | 0),
    sy: Math.max(1, sy | 0),
    sz: Math.max(1, sz | 0),
    data: new Uint8Array(Math.max(1, sx | 0) * Math.max(1, sy | 0) * Math.max(1, sz | 0)),
  };
}

export function getMicroVoxel(
  grid: MicroVoxelGrid,
  x: number,
  y: number,
  z: number,
): number {
  if (x < 0 || y < 0 || z < 0 || x >= grid.sx || y >= grid.sy || z >= grid.sz) {
    return 0;
  }
  return grid.data[(y * grid.sz + z) * grid.sx + x];
}

export function setMicroVoxel(
  grid: MicroVoxelGrid,
  x: number,
  y: number,
  z: number,
  mat: number,
): void {
  const ix = x | 0;
  const iy = y | 0;
  const iz = z | 0;
  if (ix < 0 || iy < 0 || iz < 0 || ix >= grid.sx || iy >= grid.sy || iz >= grid.sz) {
    return;
  }
  grid.data[(iy * grid.sz + iz) * grid.sx + ix] = mat & 0xff;
}

export function fillMicroBox(
  grid: MicroVoxelGrid,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  mat: number,
): void {
  const minX = Math.max(0, Math.min(x0, x1) | 0);
  const maxX = Math.min(grid.sx - 1, Math.max(x0, x1) | 0);
  const minY = Math.max(0, Math.min(y0, y1) | 0);
  const maxY = Math.min(grid.sy - 1, Math.max(y0, y1) | 0);
  const minZ = Math.max(0, Math.min(z0, z1) | 0);
  const maxZ = Math.min(grid.sz - 1, Math.max(z0, z1) | 0);
  const v = mat & 0xff;
  for (let y = minY; y <= maxY; y++) {
    const yOff = y * grid.sz;
    for (let z = minZ; z <= maxZ; z++) {
      const row = (yOff + z) * grid.sx;
      for (let x = minX; x <= maxX; x++) {
        grid.data[row + x] = v;
      }
    }
  }
}

export function fillMicroEllipsoid(
  grid: MicroVoxelGrid,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  mat: number,
): void {
  const invRx2 = 1 / Math.max(1e-4, rx * rx);
  const invRy2 = 1 / Math.max(1e-4, ry * ry);
  const invRz2 = 1 / Math.max(1e-4, rz * rz);
  const minX = Math.max(0, Math.floor(cx - rx));
  const maxX = Math.min(grid.sx - 1, Math.ceil(cx + rx));
  const minY = Math.max(0, Math.floor(cy - ry));
  const maxY = Math.min(grid.sy - 1, Math.ceil(cy + ry));
  const minZ = Math.max(0, Math.floor(cz - rz));
  const maxZ = Math.min(grid.sz - 1, Math.ceil(cz + rz));
  const v = mat & 0xff;
  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - cy;
    const dy2 = dy * dy * invRy2;
    for (let z = minZ; z <= maxZ; z++) {
      const dz = z + 0.5 - cz;
      const dz2 = dz * dz * invRz2;
      if (dy2 + dz2 > 1.0) continue;
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx * invRx2 + dy2 + dz2 <= 1.0) {
          grid.data[(y * grid.sz + z) * grid.sx + x] = v;
        }
      }
    }
  }
}

export function countSolidMicroVoxels(grid: MicroVoxelGrid): number {
  let count = 0;
  const d = grid.data;
  for (let i = 0; i < d.length; i++) {
    if (d[i] !== 0) count++;
  }
  return count;
}

// Subtle directional face shading multipliers so micro-voxels pop even under flat/low-end lighting
const FACE_SHADE = [
  1.0,  // +Y (top)
  0.76, // -Y (bottom)
  0.94, // +Z (front)
  0.84, // -Z (back)
  0.9,  // +X (right)
  0.86, // -X (left)
];

/**
 * 6-direction greedy mesher for compact micro-voxel grids.
 * - Culls all internal faces between solid micro-voxels.
 * - Merges coplanar adjacent faces with identical palette index + AO state into maximal quads.
 * - Produces a standard indexed BufferGeometry (`position`, `normal`, `color`) suitable for
 *   MeshStandardMaterial({ vertexColors: true }) as well as Potato/Cartoon shaders.
 */
export function buildGreedyMicroVoxelGeometry(
  grid: MicroVoxelGrid,
  palette: Record<number, number>,
  options: MicroVoxelMeshOptions = {},
): THREE.BufferGeometry {
  const voxelSize = options.voxelSize ?? MICRO_VOXEL_SIZE;
  const pivotX = (options.pivot ? options.pivot[0] : grid.sx * 0.5) * voxelSize;
  const pivotY = (options.pivot ? options.pivot[1] : grid.sy * 0.5) * voxelSize;
  const pivotZ = (options.pivot ? options.pivot[2] : grid.sz * 0.5) * voxelSize;
  const bakeAO = options.bakeAO !== false;
  const bakeFaceShade = options.bakeFaceShade !== false;

  const dims = [grid.sx, grid.sy, grid.sz];
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Pre-unpack palette hex colors into normalized RGB (0..1)
  const paletteRgb = new Float32Array(256 * 3);
  for (const key of Object.keys(palette)) {
    const idx = Number(key) | 0;
    if (idx <= 0 || idx > 255) continue;
    const hex = palette[idx] >>> 0;
    paletteRgb[idx * 3] = ((hex >> 16) & 0xff) / 255;
    paletteRgb[idx * 3 + 1] = ((hex >> 8) & 0xff) / 255;
    paletteRgb[idx * 3 + 2] = (hex & 0xff) / 255;
  }

  const maxMask = Math.max(dims[0] * dims[1], dims[1] * dims[2], dims[0] * dims[2]);
  const mask = new Int32Array(maxMask);

  const sampleSolid = (x: number, y: number, z: number): number => {
    if (x < 0 || y < 0 || z < 0 || x >= grid.sx || y >= grid.sy || z >= grid.sz) {
      return 0;
    }
    return grid.data[(y * grid.sz + z) * grid.sx + x] !== 0 ? 1 : 0;
  };

  // Sweep along each of the 3 axes (d = 0: X, 1: Y, 2: Z)
  const x = [0, 0, 0];
  const q = [0, 0, 0];
  const du = [0, 0, 0];
  const dv = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    q[0] = 0;
    q[1] = 0;
    q[2] = 0;
    q[d] = 1;

    const uDim = dims[u];
    const vDim = dims[v];
    const dDim = dims[d];

    for (x[d] = -1; x[d] < dDim; ) {
      // Build slice face mask
      let n = 0;
      for (x[v] = 0; x[v] < vDim; x[v]++) {
        for (x[u] = 0; x[u] < uDim; x[u]++) {
          const a =
            x[d] >= 0 ? getMicroVoxel(grid, x[0], x[1], x[2]) : 0;
          const b =
            x[d] < dDim - 1
              ? getMicroVoxel(grid, x[0] + q[0], x[1] + q[1], x[2] + q[2])
              : 0;

          if ((a !== 0) === (b !== 0)) {
            mask[n++] = 0;
          } else if (a !== 0) {
            // Positive normal face (+d)
            let aoKey = 0;
            if (bakeAO) {
              // Sample 4 cardinal neighbors on the air slice (x + q) for crisp greedy-compatible face AO
              const ax = x[0] + q[0];
              const ay = x[1] + q[1];
              const az = x[2] + q[2];
              const uStep = [0, 0, 0];
              const vStep = [0, 0, 0];
              uStep[u] = 1;
              vStep[v] = 1;
              const occl =
                sampleSolid(ax + uStep[0], ay + uStep[1], az + uStep[2]) +
                sampleSolid(ax - uStep[0], ay - uStep[1], az - uStep[2]) +
                sampleSolid(ax + vStep[0], ay + vStep[1], az + vStep[2]) +
                sampleSolid(ax - vStep[0], ay - vStep[1], az - vStep[2]);
              aoKey = occl << 8;
            }
            mask[n++] = a | aoKey;
          } else {
            // Negative normal face (-d)
            let aoKey = 0;
            if (bakeAO) {
              const ax = x[0];
              const ay = x[1];
              const az = x[2];
              const uStep = [0, 0, 0];
              const vStep = [0, 0, 0];
              uStep[u] = 1;
              vStep[v] = 1;
              const occl =
                sampleSolid(ax + uStep[0], ay + uStep[1], az + uStep[2]) +
                sampleSolid(ax - uStep[0], ay - uStep[1], az - uStep[2]) +
                sampleSolid(ax + vStep[0], ay + vStep[1], az + vStep[2]) +
                sampleSolid(ax - vStep[0], ay - vStep[1], az - vStep[2]);
              aoKey = occl << 8;
            }
            mask[n++] = -(b | aoKey);
          }
        }
      }

      x[d]++;

      // Greedily merge rectangular quads on this slice
      n = 0;
      for (let j = 0; j < vDim; j++) {
        for (let i = 0; i < uDim; ) {
          const c = mask[n];
          if (c !== 0) {
            let w = 1;
            while (i + w < uDim && mask[n + w] === c) {
              w++;
            }

            let h = 1;
            let done = false;
            while (j + h < vDim) {
              for (let k = 0; k < w; k++) {
                if (mask[n + k + h * uDim] !== c) {
                  done = true;
                  break;
                }
              }
              if (done) break;
              h++;
            }

            x[u] = i;
            x[v] = j;
            du[0] = 0;
            du[1] = 0;
            du[2] = 0;
            dv[0] = 0;
            dv[1] = 0;
            dv[2] = 0;
            du[u] = w;
            dv[v] = h;

            const isPositive = c > 0;
            const raw = isPositive ? c : -c;
            const matIdx = raw & 0xff;
            const occlCount = (raw >> 8) & 0x7;

            // Compute face shade + subtle crevice darkening
            let shade = 1.0;
            if (bakeFaceShade) {
              const faceIndex =
                d === 1
                  ? isPositive
                    ? 0
                    : 1
                  : d === 2
                    ? isPositive
                      ? 2
                      : 3
                    : isPositive
                      ? 4
                      : 5;
              shade *= FACE_SHADE[faceIndex];
            }
            if (bakeAO && occlCount > 0) {
              shade *= Math.max(0.74, 1.0 - occlCount * 0.065);
            }

            const r = Math.min(1, paletteRgb[matIdx * 3] * shade);
            const g = Math.min(1, paletteRgb[matIdx * 3 + 1] * shade);
            const b = Math.min(1, paletteRgb[matIdx * 3 + 2] * shade);

            const nx = d === 0 ? (isPositive ? 1 : -1) : 0;
            const ny = d === 1 ? (isPositive ? 1 : -1) : 0;
            const nz = d === 2 ? (isPositive ? 1 : -1) : 0;

            const p0x = x[0] * voxelSize - pivotX;
            const p0y = x[1] * voxelSize - pivotY;
            const p0z = x[2] * voxelSize - pivotZ;

            const dux = du[0] * voxelSize;
            const duy = du[1] * voxelSize;
            const duz = du[2] * voxelSize;

            const dvx = dv[0] * voxelSize;
            const dvy = dv[1] * voxelSize;
            const dvz = dv[2] * voxelSize;

            const baseVert = positions.length / 3;

            positions.push(
              p0x,
              p0y,
              p0z,
              p0x + dux,
              p0y + duy,
              p0z + duz,
              p0x + dux + dvx,
              p0y + duy + dvy,
              p0z + duz + dvz,
              p0x + dvx,
              p0y + dvy,
              p0z + dvz,
            );

            for (let vi = 0; vi < 4; vi++) {
              normals.push(nx, ny, nz);
              colors.push(r, g, b);
            }

            // Counter-clockwise winding for outward-facing normal
            if (isPositive) {
              indices.push(
                baseVert,
                baseVert + 1,
                baseVert + 2,
                baseVert,
                baseVert + 2,
                baseVert + 3,
              );
            } else {
              indices.push(
                baseVert,
                baseVert + 2,
                baseVert + 1,
                baseVert,
                baseVert + 3,
                baseVert + 2,
              );
            }

            // Clear consumed mask cells
            for (let l = 0; l < h; l++) {
              for (let k = 0; k < w; k++) {
                mask[n + k + l * uDim] = 0;
              }
            }

            i += w;
            n += w;
          } else {
            i++;
            n++;
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
