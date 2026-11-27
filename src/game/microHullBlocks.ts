import * as THREE from 'three';
import {
  MAT,
  MAT_INFO,
  SYMMETRY_CENTER_X,
  VOXEL_SIZE,
  type BuildPlacementMode,
} from './constants.ts';
import {
  MICRO_VOXEL_SIZE,
  MICRO_VOXEL_SUBDIV,
  buildGreedyMicroVoxelGeometry,
  createMicroVoxelGrid,
  setMicroVoxel,
} from './microVoxelMesh.ts';
import type { Vec3 } from './physicsMath.ts';

/**
 * 1px (0.0625m) Scalable Hull Block Layer & Scale-Aware Brush Engine.
 *
 * Coordinate alignment:
 * - Standard 4px chassis voxel `(vx, vy, vz)` occupies micro-grid cells:
 *     `mx ∈ [vx*4 .. vx*4+3]`, `my ∈ [vy*4 .. vy*4+3]`, `mz ∈ [vz*4 .. vz*4+3]`.
 * - Each 1px micro-voxel is `MICRO_VOXEL_SIZE = 0.0625m` (`VOXEL_SIZE / 4`).
 * - Players can scale hull blocks from **1px (`0.25×` ultra-fine detail)** all the way up to
 *   **16px (`4.0×` mega armor blocks)**, and EVERY Build Mode brush steps cleanly in
 *   `hullScalePx` increments!
 * - Damaged 4px hull blocks can also be split Copy-on-Write into `4×4×4` 1px micro-voxels
 *   so armor plates visibly chip and dent in 1px chunks on impact!
 */

export const HULL_SCALE_OPTIONS: ReadonlyArray<{
  px: number;
  label: string;
  shortLabel: string;
  factorLabel: string;
}> = [
  { px: 1, label: '1px Detail (0.25×)', shortLabel: '1px', factorLabel: '0.25×' },
  { px: 2, label: '2px Fine (0.5×)', shortLabel: '2px', factorLabel: '0.5×' },
  { px: 3, label: '3px Trim (0.75×)', shortLabel: '3px', factorLabel: '0.75×' },
  { px: 4, label: '4px Standard (1×)', shortLabel: '4px', factorLabel: '1×' },
  { px: 6, label: '6px Heavy (1.5×)', shortLabel: '6px', factorLabel: '1.5×' },
  { px: 8, label: '8px Double (2×)', shortLabel: '8px', factorLabel: '2×' },
  { px: 12, label: '12px Giant (3×)', shortLabel: '12px', factorLabel: '3×' },
  { px: 16, label: '16px Mega (4×)', shortLabel: '16px', factorLabel: '4×' },
];

export type HullMicroShape =
  | 'CUBE'
  | 'WEDGE'
  | 'CORNER'
  | 'INV_CORNER'
  | 'CYLINDER'
  | 'HALF_SLAB';

export const HULL_SHAPE_OPTIONS: ReadonlyArray<{
  id: HullMicroShape;
  label: string;
  shortLabel: string;
  icon: string;
  desc: string;
}> = [
  { id: 'CUBE',       label: 'Solid Cube',      shortLabel: 'Cube',   icon: '■', desc: 'Solid cubic hull block (1px..16px)' },
  { id: 'WEDGE',      label: '1px Aero Wedge',  shortLabel: 'Wedge',  icon: '◢', desc: '1px stair-stepped aerodynamic slope (rotate with R/T/Y)' },
  { id: 'CORNER',     label: 'Corner Slope',    shortLabel: 'Corner', icon: '◣', desc: '1px tapered corner nose cone / chine slope' },
  { id: 'INV_CORNER', label: 'Inverted Corner', shortLabel: 'InvCrn', icon: '◸', desc: '1px inside corner transition bevel' },
  { id: 'CYLINDER',   label: '1px Cylinder',    shortLabel: 'Cyl',    icon: '●', desc: '1px rounded pillar, pipe, or barrel contour' },
  { id: 'HALF_SLAB',  label: 'Half Slab Plate', shortLabel: 'Slab',   icon: '▬', desc: 'Half-thickness armor plate or trim panel' },
];

export type SymmetryAxisMode = 'OFF' | 'X' | 'Z' | 'XZ';

export const SYMMETRY_CENTER_Z = 18;

export const SYMMETRY_AXIS_OPTIONS: ReadonlyArray<{
  id: SymmetryAxisMode;
  label: string;
  shortLabel: string;
}> = [
  { id: 'OFF', label: 'Symmetry OFF',         shortLabel: 'OFF' },
  { id: 'X',   label: 'Left / Right (X)',     shortLabel: 'X' },
  { id: 'Z',   label: 'Front / Back (Z)',     shortLabel: 'Z' },
  { id: 'XZ',  label: '4-Way Quad (X+Z)',     shortLabel: 'X+Z' },
];

export const DEFAULT_HULL_SCALE_PX = 1;
export const MIN_HULL_SCALE_PX = 1;
export const MAX_HULL_SCALE_PX = 16;

/**
 * Option B: Streamlined 2-state 1px Fine vs. 4px Block (4×4×4 cluster of 1px micro-voxels) stamp toggle.
 */
export const HULL_STAMP_MODES: ReadonlyArray<{
  px: 1 | 4;
  label: string;
  shortLabel: string;
  desc: string;
}> = [
  {
    px: 1,
    label: '1px Fine (0.0625m)',
    shortLabel: '1PX FINE',
    desc: 'Place or carve single 1px micro-voxels and 1px-thick plates',
  },
  {
    px: 4,
    label: '4px Block (4×4×4)',
    shortLabel: '4PX BLOCK',
    desc: 'Quick-stamp or carve a 4×4×4 cluster of 1px micro-voxels (1 world block)',
  },
];

export function toggleHullStampScalePx(currentPx: number): 1 | 4 {
  return currentPx >= 4 ? 1 : 4;
}

export function clampHullScalePx(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_HULL_SCALE_PX;
  const rounded = Math.round(px);
  let best = DEFAULT_HULL_SCALE_PX;
  let bestDiff = Infinity;
  for (let i = 0; i < HULL_SCALE_OPTIONS.length; i++) {
    const cand = HULL_SCALE_OPTIONS[i].px;
    const d = Math.abs(cand - rounded);
    if (d < bestDiff) {
      bestDiff = d;
      best = cand;
    }
  }
  return best;
}

export function stepHullScalePx(currentPx: number, dir: number): number {
  const cur = clampHullScalePx(currentPx);
  const idx = HULL_SCALE_OPTIONS.findIndex((o) => o.px === cur);
  const step = dir < 0 ? -1 : dir > 0 ? 1 : 0;
  const nextIdx = Math.max(0, Math.min(HULL_SCALE_OPTIONS.length - 1, idx + step));
  return HULL_SCALE_OPTIONS[nextIdx].px;
}

export function shouldFillHullShapeVoxel(
  dx: number,
  dy: number,
  dz: number,
  sizePx: number,
  shape: HullMicroShape = 'CUBE',
  yawIdx = 0,
  pitchIdx = 0,
  rollIdx = 0,
): boolean {
  const s = Math.max(1, Math.min(16, Math.round(sizePx)));
  if (shape === 'CUBE' || s <= 1) return true;

  // Transform cell coordinate around block center by inverse (roll, pitch, yaw)
  const center = (s - 1) * 0.5;
  let lx = dx - center;
  let ly = dy - center;
  let lz = dz - center;

  const rotAxis90 = (
    x: number,
    y: number,
    z: number,
    axis: 'yaw' | 'pitch' | 'roll',
    turns: number,
  ): [number, number, number] => {
    const t = ((turns % 4) + 4) % 4;
    let rx = x;
    let ry = y;
    let rz = z;
    for (let i = 0; i < t; i++) {
      if (axis === 'yaw') {
        const nx = rz;
        const nz = -rx;
        rx = nx;
        rz = nz;
      } else if (axis === 'pitch') {
        const ny = -rz;
        const nz = ry;
        ry = ny;
        rz = nz;
      } else {
        const nx = -ry;
        const ny = rx;
        rx = nx;
        ry = ny;
      }
    }
    return [rx, ry, rz];
  };

  [lx, ly, lz] = rotAxis90(lx, ly, lz, 'roll', (4 - (rollIdx & 3)) & 3);
  [lx, ly, lz] = rotAxis90(lx, ly, lz, 'pitch', (4 - (pitchIdx & 3)) & 3);
  [lx, ly, lz] = rotAxis90(lx, ly, lz, 'yaw', (4 - (yawIdx & 3)) & 3);

  const rx = Math.round(lx + center);
  const ry = Math.round(ly + center);
  const rz = Math.round(lz + center);

  switch (shape) {
    case 'WEDGE':
      return ry <= s - 1 - rz;
    case 'CORNER':
      return ry <= Math.min(s - 1 - rx, s - 1 - rz);
    case 'INV_CORNER':
      return ry <= Math.max(s - 1 - rx, s - 1 - rz);
    case 'CYLINDER': {
      const r = s * 0.5;
      const dist = Math.hypot(lx, lz);
      return dist <= r + 0.18;
    }
    case 'HALF_SLAB':
      return ry < Math.max(1, Math.ceil(s * 0.5));
    default:
      return true;
  }
}

export interface MicroVoxelHit {
  mx: number;
  my: number;
  mz: number;
  normal: Vec3;
}

// Fast 3D coordinate packing for 1px micro-grid range [-1024 .. 1023] per axis (safe 33-bit JS integer)
const MICRO_BIAS = 1024;
const MICRO_STRIDE = 2048;
const MICRO_STRIDE_SQ = MICRO_STRIDE * MICRO_STRIDE;

export function packMicroKey(mx: number, my: number, mz: number): number {
  return (mx + MICRO_BIAS) + (my + MICRO_BIAS) * MICRO_STRIDE + (mz + MICRO_BIAS) * MICRO_STRIDE_SQ;
}

export function unpackMicroKey(key: number): [number, number, number] {
  const zIdx = Math.floor(key / MICRO_STRIDE_SQ);
  const rem = key - zIdx * MICRO_STRIDE_SQ;
  const yIdx = Math.floor(rem / MICRO_STRIDE);
  const xIdx = rem - yIdx * MICRO_STRIDE;
  return [xIdx - MICRO_BIAS, yIdx - MICRO_BIAS, zIdx - MICRO_BIAS];
}

export interface MicroHullChip {
  lx: number;
  ly: number;
  lz: number;
  color: number;
}

export interface MicroHullBounds {
  minMX: number;
  maxMX: number;
  minMY: number;
  maxMY: number;
  minMZ: number;
  maxMZ: number;
}

// Build a palette lookup from MAT ID -> RGB hex once
let _matPaletteCache: Record<number, number> | null = null;
function getMatPalette(): Record<number, number> {
  if (!_matPaletteCache) {
    const pal: Record<number, number> = {};
    for (let i = 1; i < 64; i++) {
      const info = MAT_INFO[i];
      if (info) {
        pal[i] = info.color;
        // Bit 64 = charred/damaged dark version
        const r = Math.max(0, Math.round(((info.color >> 16) & 255) * 0.45));
        const g = Math.max(0, Math.round(((info.color >> 8) & 255) * 0.42));
        const b = Math.max(0, Math.round((info.color & 255) * 0.42));
        pal[i | 64] = (r << 16) | (g << 8) | b;
      }
    }
    _matPaletteCache = pal;
  }
  return _matPaletteCache;
}

let _sharedMicroHullMat: THREE.MeshStandardMaterial | null = null;
export function getMicroHullMaterial(): THREE.MeshStandardMaterial {
  if (!_sharedMicroHullMat) {
    _sharedMicroHullMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.52,
      metalness: 0.28,
    });
  }
  return _sharedMicroHullMat;
}

/**
 * Sparse 1px (0.0625m) micro-voxel hull layer attached to a `ModularVehicleRig`.
 * - 0 bytes allocated until the player places a scaled (<4px / 6px) hull block or chips a hull block.
 * - Greedy-meshes into ONE single vertex-colored `BufferGeometry` (1 draw call total!).
 */
export class MicroHullLayer {
  public readonly cells = new Map<number, number>();
  public dirty = false;

  get size(): number {
    return this.cells.size;
  }

  inBounds(mx: number, my: number, mz: number): boolean {
    return (
      mx >= -1000 && mx <= 1000 &&
      my >= -250 && my <= 500 &&
      mz >= -1000 && mz <= 1000
    );
  }

  getMicro(mx: number, my: number, mz: number): number {
    return this.cells.get(packMicroKey(mx, my, mz)) ?? MAT.AIR;
  }

  setMicro(mx: number, my: number, mz: number, mat: number): void {
    if (!this.inBounds(mx, my, mz)) return;
    const key = packMicroKey(mx, my, mz);
    if (mat === MAT.AIR) {
      if (this.cells.delete(key)) {
        this.dirty = true;
      }
    } else {
      const prev = this.cells.get(key);
      if (prev !== mat) {
        this.cells.set(key, mat);
        this.dirty = true;
      }
    }
  }

  /** Stamps a solid `sizePx × sizePx × sizePx` cube starting at corner `(ox, oy, oz)` in 1px micro-coords. */
  stampMicroCube(
    ox: number,
    oy: number,
    oz: number,
    sizePx: number,
    mat: number,
  ): number {
    return this.stampMicroShape(ox, oy, oz, sizePx, mat, 'CUBE', 0, 0, 0);
  }

  /**
   * Stamps a 1px-detailed sculpted hull shape (`CUBE`, `WEDGE`, `CORNER`, `INV_CORNER`, `CYLINDER`, `HALF_SLAB`)
   * inside a `sizePx × sizePx × sizePx` bounding volume starting at `(ox, oy, oz)` in 1px micro-coords!
   */
  stampMicroShape(
    ox: number,
    oy: number,
    oz: number,
    sizePx: number,
    mat: number,
    shape: HullMicroShape = 'CUBE',
    yawIdx = 0,
    pitchIdx = 0,
    rollIdx = 0,
  ): number {
    const s = Math.max(1, Math.min(16, Math.round(sizePx)));
    let changed = 0;
    for (let dz = 0; dz < s; dz++) {
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          if (
            shape !== 'CUBE' &&
            !shouldFillHullShapeVoxel(dx, dy, dz, s, shape, yawIdx, pitchIdx, rollIdx)
          ) {
            continue;
          }
          const mx = ox + dx;
          const my = oy + dy;
          const mz = oz + dz;
          if (!this.inBounds(mx, my, mz)) continue;
          const key = packMicroKey(mx, my, mz);
          if (mat === MAT.AIR) {
            if (this.cells.delete(key)) changed++;
          } else if (this.cells.get(key) !== mat) {
            this.cells.set(key, mat);
            changed++;
          }
        }
      }
    }
    if (changed > 0) this.dirty = true;
    return changed;
  }

  /**
   * Splits a coarse 4px chassis voxel `(vx, vy, vz)` into 64 (`4×4×4`) 1px micro-voxels
   * so it can be chipped/carved at 1px resolution!
   */
  splitCoarseVoxelToMicro(vx: number, vy: number, vz: number, mat: number): void {
    if (mat === MAT.AIR) return;
    const ox = vx * MICRO_VOXEL_SUBDIV;
    const oy = vy * MICRO_VOXEL_SUBDIV;
    const oz = vz * MICRO_VOXEL_SUBDIV;
    this.stampMicroCube(ox, oy, oz, MICRO_VOXEL_SUBDIV, mat);
  }

  /**
   * Carves a 3D spherical crater into 1px micro-hull voxels (with optional 2px coarse step for Pentium).
   */
  carveMicroSphere(
    localX: number,
    localY: number,
    localZ: number,
    radiusMeters: number,
    coarseStep = false,
    maxChips = 10,
  ): { carvedCount: number; chips: MicroHullChip[] } {
    if (this.cells.size === 0 || radiusMeters <= 0.01) {
      return { carvedCount: 0, chips: [] };
    }
    const cx = localX / MICRO_VOXEL_SIZE;
    const cy = localY / MICRO_VOXEL_SIZE;
    const cz = localZ / MICRO_VOXEL_SIZE;
    const rVox = Math.max(1.1, radiusMeters / MICRO_VOXEL_SIZE);
    const rSq = rVox * rVox;
    const step = coarseStep ? 2 : 1;

    const minX = Math.floor(cx - rVox);
    const maxX = Math.ceil(cx + rVox);
    const minY = Math.floor(cy - rVox);
    const maxY = Math.ceil(cy + rVox);
    const minZ = Math.floor(cz - rVox);
    const maxZ = Math.ceil(cz + rVox);

    const pal = getMatPalette();
    let carvedCount = 0;
    const chips: MicroHullChip[] = [];

    for (let mz = minZ; mz <= maxZ; mz += step) {
      const dz = mz + 0.5 - cz;
      const dzSq = dz * dz;
      if (dzSq > rSq) continue;
      for (let my = minY; my <= maxY; my += step) {
        const dy = my + 0.5 - cy;
        const dyzSq = dzSq + dy * dy;
        if (dyzSq > rSq) continue;
        for (let mx = minX; mx <= maxX; mx += step) {
          const dx = mx + 0.5 - cx;
          if (dx * dx + dyzSq > rSq) continue;
          for (let sz = 0; sz < step; sz++) {
            for (let sy = 0; sy < step; sy++) {
              for (let sx = 0; sx < step; sx++) {
                const key = packMicroKey(mx + sx, my + sy, mz + sz);
                const mat = this.cells.get(key);
                if (mat !== undefined && mat !== MAT.AIR) {
                  this.cells.delete(key);
                  carvedCount++;
                  if (chips.length < maxChips) {
                    chips.push({
                      lx: (mx + sx + 0.5) * MICRO_VOXEL_SIZE,
                      ly: (my + sy + 0.5) * MICRO_VOXEL_SIZE,
                      lz: (mz + sz + 0.5) * MICRO_VOXEL_SIZE,
                      color: pal[mat] ?? 0x38bdf8,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    if (carvedCount > 0) this.dirty = true;
    return { carvedCount, chips };
  }

  computeBounds(): MicroHullBounds | null {
    if (this.cells.size === 0) return null;
    let minMX = Infinity;
    let maxMX = -Infinity;
    let minMY = Infinity;
    let maxMY = -Infinity;
    let minMZ = Infinity;
    let maxMZ = -Infinity;
    this.cells.forEach((_mat, key) => {
      const [mx, my, mz] = unpackMicroKey(key);
      if (mx < minMX) minMX = mx;
      if (mx > maxMX) maxMX = mx;
      if (my < minMY) minMY = my;
      if (my > maxMY) maxMY = my;
      if (mz < minMZ) minMZ = mz;
      if (mz > maxMZ) maxMZ = mz;
    });
    return { minMX, maxMX, minMY, maxMY, minMZ, maxMZ };
  }

  /**
   * Returns unique coarse voxel coordinates `(vx, vy, vz)` that contain at least one solid 1px micro-voxel.
   */
  getOccupiedCoarseCoords(): Array<[number, number, number]> {
    if (this.cells.size === 0) return [];
    const seen = new Set<string>();
    const out: Array<[number, number, number]> = [];
    this.cells.forEach((mat, key) => {
      if (mat === MAT.AIR) return;
      const [mx, my, mz] = unpackMicroKey(key);
      const vx = Math.floor(mx / MICRO_VOXEL_SUBDIV);
      const vy = Math.floor(my / MICRO_VOXEL_SUBDIV);
      const vz = Math.floor(mz / MICRO_VOXEL_SUBDIV);
      const ck = `${vx},${vy},${vz}`;
      if (!seen.has(ck)) {
        seen.add(ck);
        out.push([vx, vy, vz]);
      }
    });
    return out;
  }

  clear(): void {
    if (this.cells.size > 0) {
      this.cells.clear();
      this.dirty = true;
    }
  }

  exportArray(): Array<[number, number, number, number]> {
    if (this.cells.size === 0) return [];
    const out: Array<[number, number, number, number]> = [];
    this.cells.forEach((mat, key) => {
      if (mat !== MAT.AIR) {
        const [mx, my, mz] = unpackMicroKey(key);
        out.push([mx, my, mz, mat]);
      }
    });
    return out;
  }

  importArray(arr: Array<[number, number, number, number]> | undefined | null): void {
    this.cells.clear();
    if (Array.isArray(arr)) {
      for (let i = 0; i < arr.length; i++) {
        const entry = arr[i];
        if (!Array.isArray(entry) || entry.length < 4) continue;
        const [mx, my, mz, mat] = entry;
        if (mat !== MAT.AIR && this.inBounds(mx, my, mz)) {
          this.cells.set(packMicroKey(mx, my, mz), mat);
        }
      }
    }
    this.dirty = true;
  }

  /**
   * Builds ONE greedy-meshed vertex-colored BufferGeometry for all 1px micro-hull voxels
   * in exact vehicle local meter space `(mx * 0.0625, my * 0.0625, mz * 0.0625)`.
   * Returns null if empty.
   */
  buildMeshGeometry(): THREE.BufferGeometry | null {
    this.dirty = false;
    const bounds = this.computeBounds();
    if (!bounds) return null;

    const sx = bounds.maxMX - bounds.minMX + 1;
    const sy = bounds.maxMY - bounds.minMY + 1;
    const sz = bounds.maxMZ - bounds.minMZ + 1;

    // Safety cap on dense bounding volume so widely scattered 1px chips never allocate giant arrays:
    // If bounded volume <= 262,144 cells (64^3), use ultra-fast greedy mesher; else chunk by 16^3 bricks.
    const vol = sx * sy * sz;
    const pal = getMatPalette();

    if (vol <= 262144) {
      const grid = createMicroVoxelGrid(sx, sy, sz);
      this.cells.forEach((mat, key) => {
        const [mx, my, mz] = unpackMicroKey(key);
        setMicroVoxel(grid, mx - bounds.minMX, my - bounds.minMY, mz - bounds.minMZ, mat);
      });
      const geo = buildGreedyMicroVoxelGeometry(grid, pal, {
        voxelSize: MICRO_VOXEL_SIZE,
        // Shift geometry so grid (0,0,0) lands at exact vehicle local metric (minMX * 0.0625, ...)
        pivot: [-bounds.minMX, -bounds.minMY, -bounds.minMZ],
        bakeAO: true,
        bakeFaceShade: true,
      });
      geo.userData.isSharedPrimitive = false;
      return geo;
    }

    // Fallback sparse per-voxel face emission for huge spread-out builds (still 1 single BufferGeometry!)
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const vs = MICRO_VOXEL_SIZE;

    const FACE_DIRS: ReadonlyArray<{
      n: [number, number, number];
      shade: number;
      corners: ReadonlyArray<[number, number, number]>;
    }> = [
      { n: [1, 0, 0], shade: 0.9, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
      { n: [-1, 0, 0], shade: 0.84, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
      { n: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
      { n: [0, -1, 0], shade: 0.65, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
      { n: [0, 0, 1], shade: 0.94, corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
      { n: [0, 0, -1], shade: 0.78, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
    ];

    this.cells.forEach((mat, key) => {
      const [mx, my, mz] = unpackMicroKey(key);
      const hex = pal[mat] ?? 0x38bdf8;
      const cr = ((hex >> 16) & 255) / 255;
      const cg = ((hex >> 8) & 255) / 255;
      const cb = (hex & 255) / 255;

      for (let f = 0; f < 6; f++) {
        const fd = FACE_DIRS[f];
        if (this.getMicro(mx + fd.n[0], my + fd.n[1], mz + fd.n[2]) !== MAT.AIR) continue;
        const base = positions.length / 3;
        const sh = fd.shade;
        for (let c = 0; c < 4; c++) {
          const co = fd.corners[c];
          positions.push((mx + co[0]) * vs, (my + co[1]) * vs, (mz + co[2]) * vs);
          normals.push(fd.n[0], fd.n[1], fd.n[2]);
          colors.push(cr * sh, cg * sh, cb * sh);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData.isSharedPrimitive = false;
    return geo;
  }
}

// ============================================================================
// SCALE-AWARE BUILD MODE BRUSH PLACEMENT MATH (1px .. 16px)
// ============================================================================

export interface ScaledBlockPlacement {
  /** Minimum corner in 1px micro-grid coordinates (0.0625m/unit) */
  mx: number;
  my: number;
  mz: number;
  /** Cubic edge length in 1px micro-grid units (1, 2, 3, 4, 6, 8, 12, or 16) */
  sizePx: number;
}

function rotatePoint90(
  x: number,
  y: number,
  z: number,
  axis: 'yaw' | 'pitch' | 'roll',
  turns: number,
): { x: number; y: number; z: number } {
  const t = ((turns % 4) + 4) % 4;
  let rx = x;
  let ry = y;
  let rz = z;
  for (let i = 0; i < t; i++) {
    if (axis === 'yaw') {
      const nx = rz;
      const nz = -rx;
      rx = nx;
      rz = nz;
    } else if (axis === 'pitch') {
      const ny = -rz;
      const nz = ry;
      ry = ny;
      rz = nz;
    } else {
      const nx = -ry;
      const ny = rx;
      rx = nx;
      ry = ny;
    }
  }
  return { x: rx, y: ry, z: rz };
}

/**
 * Computes the anchor corner `(mx, my, mz)` in 1px micro-voxel space for placing/erasing
 * a scaled `sizePx × sizePx × sizePx` hull block flush against the clicked 1px cell & face normal.
 */
export function computeScaledAnchorOrigin(
  hitMicro: { mx: number; my: number; mz: number; normal: Vec3 },
  sizePx: number,
  isEraseOrPaint = false,
): { mx: number; my: number; mz: number } {
  const s = clampHullScalePx(sizePx);
  const nx = Math.round(hitMicro.normal.x);
  const ny = Math.round(hitMicro.normal.y);
  const nz = Math.round(hitMicro.normal.z);

  if (isEraseOrPaint) {
    // Snap down to the aligned block cell containing the hit micro-voxel
    return {
      mx: Math.floor(hitMicro.mx / s) * s,
      my: Math.floor(hitMicro.my / s) * s,
      mz: Math.floor(hitMicro.mz / s) * s,
    };
  }

  // Align tangent axes cleanly to `s` grid while pushing normal axis flush onto the surface!
  const snapAxis = (coord: number, n: number): number => {
    if (n > 0) return coord + 1;
    if (n < 0) return coord - s;
    return Math.floor(coord / s) * s;
  };

  return {
    mx: snapAxis(hitMicro.mx, nx),
    my: snapAxis(hitMicro.my, ny),
    mz: snapAxis(hitMicro.mz, nz),
  };
}

/**
 * Pure, deterministic scale-aware brush placement solver supporting ALL Build Mode brushes
 * (`SINGLE`, `BOX_FILL`, `LINE_DRAG`, `BEAM_6`, `PLATE_3X3`, `PLATE_5X5`, `PAINT`, `CHISEL`, `PAINT_TOOL`)
 * at ANY hull scale from `1px (0.25×)` up to `16px (4×)` with multi-axis (`OFF`, `X`, `Z`, `XZ`) symmetry mirroring!
 */
export function computeScaledHullPlacementCoords(
  mode: BuildPlacementMode,
  hitMicro: { mx: number; my: number; mz: number; normal: Vec3 },
  dragStartOrigin: { mx: number; my: number; mz: number } | null,
  hullScalePx: number,
  mirrorMode: boolean | SymmetryAxisMode,
  isErase = false,
  yawIdx = 0,
  pitchIdx = 0,
  rollIdx = 0,
  boxDepthPx = 1,
): ScaledBlockPlacement[] {
  const s = clampHullScalePx(hullScalePx);
  const effectiveErase = isErase || mode === 'CHISEL';
  const useTargetBlock = effectiveErase || mode === 'PAINT_TOOL';
  const anchor = computeScaledAnchorOrigin(hitMicro, s, useTargetBlock);
  const baseBlocks: ScaledBlockPlacement[] = [];

  if (mode === 'BOX_FILL' && dragStartOrigin) {
    // Step in exact `s` increments between dragStartOrigin and anchor (clamped to keep builds responsive)
    const maxUnits = s <= 2 ? 32 : 16;
    const stepX = Math.max(-maxUnits, Math.min(maxUnits, Math.round((anchor.mx - dragStartOrigin.mx) / s)));
    const stepY = Math.max(-maxUnits, Math.min(maxUnits, Math.round((anchor.my - dragStartOrigin.my) / s)));
    const stepZ = Math.max(-maxUnits, Math.min(maxUnits, Math.round((anchor.mz - dragStartOrigin.mz) / s)));

    const minX = Math.min(0, stepX);
    const maxX = Math.max(0, stepX);
    const minY = Math.min(0, stepY);
    const maxY = Math.max(0, stepY);
    const minZ = Math.min(0, stepZ);
    const maxZ = Math.max(0, stepZ);

    const depthLayers = Math.max(1, Math.min(8, Math.round(boxDepthPx || 1)));
    const nx = Math.round(hitMicro.normal.x) * (effectiveErase ? -1 : 1);
    const ny = Math.round(hitMicro.normal.y) * (effectiveErase ? -1 : 1);
    const nz = Math.round(hitMicro.normal.z) * (effectiveErase ? -1 : 1);

    const maxBlocks = s >= 8 ? 160 : 1200;
    const seenBox = new Set<string>();
    for (let d = 0; d < depthLayers; d++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        for (let iy = minY; iy <= maxY; iy++) {
          for (let ix = minX; ix <= maxX; ix++) {
            const bx = dragStartOrigin.mx + (ix + nx * d) * s;
            const by = dragStartOrigin.my + (iy + ny * d) * s;
            const bz = dragStartOrigin.mz + (iz + nz * d) * s;
            const bk = `${bx},${by},${bz}`;
            if (!seenBox.has(bk)) {
              seenBox.add(bk);
              baseBlocks.push({
                mx: bx,
                my: by,
                mz: bz,
                sizePx: s,
              });
            }
            if (baseBlocks.length >= maxBlocks) break;
          }
          if (baseBlocks.length >= maxBlocks) break;
        }
        if (baseBlocks.length >= maxBlocks) break;
      }
      if (baseBlocks.length >= maxBlocks) break;
    }
  } else if (mode === 'LINE_DRAG' && dragStartOrigin) {
    const ux = Math.round((anchor.mx - dragStartOrigin.mx) / s);
    const uy = Math.round((anchor.my - dragStartOrigin.my) / s);
    const uz = Math.round((anchor.mz - dragStartOrigin.mz) / s);
    const steps = Math.min(64, Math.max(1, Math.max(Math.abs(ux), Math.abs(uy), Math.abs(uz))));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      baseBlocks.push({
        mx: dragStartOrigin.mx + Math.round(ux * t) * s,
        my: dragStartOrigin.my + Math.round(uy * t) * s,
        mz: dragStartOrigin.mz + Math.round(uz * t) * s,
        sizePx: s,
      });
    }
  } else if (mode === 'BEAM_6' && !effectiveErase) {
    const nx = Math.round(hitMicro.normal.x);
    const ny = Math.round(hitMicro.normal.y);
    const nz = Math.round(hitMicro.normal.z) || (nx === 0 && ny === 0 ? 1 : 0);
    for (let i = 0; i < 6; i++) {
      let off = rotatePoint90(nx * i, ny * i, nz * i, 'yaw', yawIdx);
      off = rotatePoint90(off.x, off.y, off.z, 'pitch', pitchIdx);
      off = rotatePoint90(off.x, off.y, off.z, 'roll', rollIdx);
      baseBlocks.push({
        mx: anchor.mx + off.x * s,
        my: anchor.my + off.y * s,
        mz: anchor.mz + off.z * s,
        sizePx: s,
      });
    }
  } else if (mode === 'PLATE_3X3' || mode === 'PLATE_5X5') {
    // Option A: When s === 1 (pure 1px Fine mode), PLATE_3X3 stamps a 4×4×1 plate (16 micro-voxels = 1 classic block face)
    // and PLATE_5X5 stamps an 8×8×1 panel (64 micro-voxels = 2×2 block deck at 1px thickness).
    // When s > 1 (e.g. 4px Block mode), it stamps 3×3 or 5×5 blocks of size s.
    const minU = s === 1 ? (mode === 'PLATE_5X5' ? -3 : -1) : mode === 'PLATE_5X5' ? -2 : -1;
    const maxU = s === 1 ? (mode === 'PLATE_5X5' ? 4 : 2) : mode === 'PLATE_5X5' ? 2 : 1;
    const absX = Math.abs(hitMicro.normal.x);
    const absY = Math.abs(hitMicro.normal.y);
    const absZ = Math.abs(hitMicro.normal.z);

    for (let u = minU; u <= maxU; u++) {
      for (let v = minU; v <= maxU; v++) {
        let ox = u;
        let oy = 0;
        let oz = v;
        if (absX > 0.5) {
          ox = 0;
          oy = u;
          oz = v;
        } else if (absZ > 0.5) {
          ox = u;
          oy = v;
          oz = 0;
        } else if (absY > 0.5) {
          ox = u;
          oy = 0;
          oz = v;
        }
        let off = rotatePoint90(ox, oy, oz, 'yaw', yawIdx);
        off = rotatePoint90(off.x, off.y, off.z, 'pitch', pitchIdx);
        off = rotatePoint90(off.x, off.y, off.z, 'roll', rollIdx);
        baseBlocks.push({
          mx: anchor.mx + off.x * s,
          my: anchor.my + off.y * s,
          mz: anchor.mz + off.z * s,
          sizePx: s,
        });
      }
    }
  } else {
    baseBlocks.push({ mx: anchor.mx, my: anchor.my, mz: anchor.mz, sizePx: s });
  }

  return applyMicroSymmetryMirror(baseBlocks, mirrorMode);
}

export function applyMicroSymmetryMirror(
  baseBlocks: ReadonlyArray<ScaledBlockPlacement>,
  mirrorMode: boolean | SymmetryAxisMode,
): ScaledBlockPlacement[] {
  const symMode: SymmetryAxisMode =
    typeof mirrorMode === 'boolean'
      ? mirrorMode
        ? 'X'
        : 'OFF'
      : mirrorMode;

  if (symMode === 'OFF') {
    return [...baseBlocks];
  }

  // Exact X and Z symmetry mirror planes in 1px micro-grid space:
  // Coarse X plane sits at micro X = SYMMETRY_CENTER_X * 4 (48.0) -> mirrorPlaneX2 = 96
  // Coarse Z plane sits at micro Z = SYMMETRY_CENTER_Z * 4 (72.0) -> mirrorPlaneZ2 = 144
  const mirrorPlaneX2 = SYMMETRY_CENTER_X * MICRO_VOXEL_SUBDIV * 2; // 96
  const mirrorPlaneZ2 = SYMMETRY_CENTER_Z * MICRO_VOXEL_SUBDIV * 2; // 144
  const mirrorX = symMode === 'X' || symMode === 'XZ';
  const mirrorZ = symMode === 'Z' || symMode === 'XZ';

  const seen = new Set<string>();
  const finalBlocks: ScaledBlockPlacement[] = [];

  const pushUnique = (mx: number, my: number, mz: number, sizePx: number) => {
    const k = `${mx},${my},${mz}`;
    if (!seen.has(k)) {
      seen.add(k);
      finalBlocks.push({ mx, my, mz, sizePx });
    }
  };

  for (let i = 0; i < baseBlocks.length; i++) {
    const b = baseBlocks[i];
    pushUnique(b.mx, b.my, b.mz, b.sizePx);
    const mirX = mirrorPlaneX2 - b.mx - b.sizePx;
    const mirZ = mirrorPlaneZ2 - b.mz - b.sizePx;
    if (mirrorX) {
      pushUnique(mirX, b.my, b.mz, b.sizePx);
    }
    if (mirrorZ) {
      pushUnique(b.mx, b.my, mirZ, b.sizePx);
    }
    if (mirrorX && mirrorZ) {
      pushUnique(mirX, b.my, mirZ, b.sizePx);
    }
  }

  return finalBlocks;
}

/**
 * 1px Micro-Face Extrude Solver:
 * Flood-fills contiguous coplanar 1px surface cells matching the clicked micro-voxel material
 * and extrudes them outward along `hitMicro.normal` by `depthLayers` (1..8) 1px layers.
 */
export function computeMicroFaceExtrudeCoords(
  hitMicro: { mx: number; my: number; mz: number; normal: Vec3 },
  getMicroMatAt: (mx: number, my: number, mz: number) => number,
  mirrorMode: boolean | SymmetryAxisMode,
  depthLayers = 1,
  maxAreaCells = 256,
): ScaledBlockPlacement[] {
  const seedMat = getMicroMatAt(hitMicro.mx, hitMicro.my, hitMicro.mz);
  if (!seedMat || seedMat === MAT.AIR) return [];

  const nx = Math.round(hitMicro.normal.x);
  const ny = Math.round(hitMicro.normal.y);
  const nz = Math.round(hitMicro.normal.z);
  if (nx === 0 && ny === 0 && nz === 0) return [];

  // Two orthogonal tangent axes on the clicked face plane
  const tangents: Array<[number, number, number]> =
    Math.abs(nx) > 0
      ? [
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ]
      : Math.abs(ny) > 0
        ? [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 0, 1],
            [0, 0, -1],
          ]
        : [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
          ];

  const visited = new Set<string>();
  const queue: Array<[number, number, number]> = [[hitMicro.mx, hitMicro.my, hitMicro.mz]];
  visited.add(`${hitMicro.mx},${hitMicro.my},${hitMicro.mz}`);
  const surfaceCells: Array<[number, number, number]> = [];

  while (queue.length > 0 && surfaceCells.length < maxAreaCells) {
    const [cx, cy, cz] = queue.shift()!;
    if (getMicroMatAt(cx, cy, cz) !== seedMat) continue;
    // Must be an exposed face along normal
    if (getMicroMatAt(cx + nx, cy + ny, cz + nz) !== MAT.AIR) continue;
    surfaceCells.push([cx, cy, cz]);

    for (let i = 0; i < tangents.length; i++) {
      const [tx, ty, tz] = tangents[i];
      const nbx = cx + tx;
      const nby = cy + ty;
      const nbz = cz + tz;
      const k = `${nbx},${nby},${nbz}`;
      if (!visited.has(k)) {
        visited.add(k);
        if (
          getMicroMatAt(nbx, nby, nbz) === seedMat &&
          getMicroMatAt(nbx + nx, nby + ny, nbz + nz) === MAT.AIR
        ) {
          queue.push([nbx, nby, nbz]);
        }
      }
    }
  }

  const layers = Math.max(1, Math.min(8, Math.round(depthLayers || 1)));
  const baseBlocks: ScaledBlockPlacement[] = [];
  for (let d = 1; d <= layers; d++) {
    for (let i = 0; i < surfaceCells.length; i++) {
      const [cx, cy, cz] = surfaceCells[i];
      const ex = cx + nx * d;
      const ey = cy + ny * d;
      const ez = cz + nz * d;
      if (getMicroMatAt(ex, ey, ez) === MAT.AIR) {
        baseBlocks.push({ mx: ex, my: ey, mz: ez, sizePx: 1 });
      }
    }
  }

  return applyMicroSymmetryMirror(baseBlocks, mirrorMode);
}

/**
 * Computes a live human-readable dimensions & mass summary for the current Build Mode ghost preview.
 */
export function computeGhostDimensionsSummary(
  placements: ReadonlyArray<ScaledBlockPlacement>,
  unitStandardMassKg = 7,
  isErase = false,
): {
  dimsLabel: string;
  count: number;
  massDeltaKg: number;
} {
  if (placements.length === 0) {
    return { dimsLabel: '0×0×0', count: 0, massDeltaKg: 0 };
  }
  let minMX = Infinity;
  let maxMX = -Infinity;
  let minMY = Infinity;
  let maxMY = -Infinity;
  let minMZ = Infinity;
  let maxMZ = -Infinity;
  let totalMicroVol = 0;

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (p.mx < minMX) minMX = p.mx;
    if (p.mx + p.sizePx > maxMX) maxMX = p.mx + p.sizePx;
    if (p.my < minMY) minMY = p.my;
    if (p.my + p.sizePx > maxMY) maxMY = p.my + p.sizePx;
    if (p.mz < minMZ) minMZ = p.mz;
    if (p.mz + p.sizePx > maxMZ) maxMZ = p.mz + p.sizePx;
    totalMicroVol += p.sizePx * p.sizePx * p.sizePx;
  }

  const s = placements[0].sizePx;
  const spanU = Math.max(1, Math.round((maxMX - minMX) / s));
  const spanV = Math.max(1, Math.round((maxMY - minMY) / s));
  const spanW = Math.max(1, Math.round((maxMZ - minMZ) / s));
  const stdVoxEquivalent = totalMicroVol / 64; // 64 micro-voxels per standard 4px block
  const rawMass = Math.max(0.1, Math.round(stdVoxEquivalent * unitStandardMassKg * 10) / 10);

  return {
    dimsLabel: `${spanU}×${spanV}×${spanW} (${s}px)`,
    count: placements.length,
    massDeltaKg: isErase ? -rawMass : rawMass,
  };
}

/**
 * Helper to determine if a scaled block placement aligns cleanly to the standard 4px coarse grid
 * (so 4px/8px/12px/16px blocks placed on coarse boundaries stay in the fast coarse `voxelMap`!).
 */
export function isCoarseAlignedPlacement(
  bOrMx: ScaledBlockPlacement | number,
  my = 0,
  mz = 0,
  sizePx = 4,
): boolean {
  const b: ScaledBlockPlacement =
    typeof bOrMx === 'number'
      ? { mx: bOrMx, my, mz, sizePx }
      : bOrMx;
  return (
    b.sizePx >= MICRO_VOXEL_SUBDIV &&
    b.sizePx % MICRO_VOXEL_SUBDIV === 0 &&
    ((b.mx % MICRO_VOXEL_SUBDIV) + MICRO_VOXEL_SUBDIV) % MICRO_VOXEL_SUBDIV === 0 &&
    ((b.my % MICRO_VOXEL_SUBDIV) + MICRO_VOXEL_SUBDIV) % MICRO_VOXEL_SUBDIV === 0 &&
    ((b.mz % MICRO_VOXEL_SUBDIV) + MICRO_VOXEL_SUBDIV) % MICRO_VOXEL_SUBDIV === 0
  );
}

/**
 * Converts a micro-grid block's center into local vehicle meters for ghost rendering.
 */
export function microBlockCenterMeters(
  bOrMx: ScaledBlockPlacement | number,
  my = 0,
  mz = 0,
  sizePx = 4,
): { x: number; y: number; z: number; edgeMeters: number } {
  const b: ScaledBlockPlacement =
    typeof bOrMx === 'number'
      ? { mx: bOrMx, my, mz, sizePx }
      : bOrMx;
  const edgeMeters = b.sizePx * MICRO_VOXEL_SIZE;
  return {
    x: (b.mx + b.sizePx * 0.5) * MICRO_VOXEL_SIZE,
    y: (b.my + b.sizePx * 0.5) * MICRO_VOXEL_SIZE,
    z: (b.mz + b.sizePx * 0.5) * MICRO_VOXEL_SIZE,
    edgeMeters,
  };
}

export { VOXEL_SIZE, MICRO_VOXEL_SIZE, MICRO_VOXEL_SUBDIV };

