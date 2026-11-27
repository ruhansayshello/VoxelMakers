import { BufferAttribute } from '../core/BufferAttribute';
import { BufferGeometry } from '../core/BufferGeometry';
import { Color, Vector3 } from '../math';
import { VOXEL_MAT_DEFAULT, VOXEL_MAT_GLASS } from './VoxelPotatoShader';

export interface VoxelMesherPaletteEntry {
  /** Base linear/sRGB hex color used for vertex color tinting (or fallback when using Lambert/Basic materials). */
  color: number;
  /** VoxelPotatoShader material ID (0..6). */
  shaderMatId?: number;
  /** Optional top-face color override (e.g. grass top vs dirt side). */
  topColor?: number;
  /** Optional bottom-face color override. */
  bottomColor?: number;
  /** True for transparent blocks like water/glass so opaque neighbors don't cull against them. */
  transparent?: boolean;
  /** Emissive brightness boost (1.0 = normal, >1.0 = bright/glowing). */
  emissiveBoost?: number;
}

export interface BuildVoxelChunkMeshOptions {
  /** Voxel sampler in world voxel coordinates (wx, wy, wz) -> material id (0 = air). */
  getVoxel: (wx: number, wy: number, wz: number) => number;
  /** Chunk origin in world voxel coordinates. */
  originX: number;
  originY: number;
  originZ: number;
  /** Chunk dimensions in voxels. */
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  /** Scale of 1 voxel in world units (default 1.0). */
  voxelSize?: number;
  /** Step size in voxels (1 = LOD0, 2 = LOD1, 4 = LOD2). */
  step?: number;
  /** LOD tier stamped into the `lodLevel` vertex attribute (0, 1, or 2). */
  lodLevel?: number;
  /** Whether to bake smooth 4-sample per-vertex ambient occlusion into vertex colors. */
  bakeAO?: boolean;
  /** Palette lookup from voxel block ID -> visual/material attributes. */
  palette: Record<number, VoxelMesherPaletteEntry>;
  /** Build opaque faces only (false) or transparent faces only (true). */
  transparentPass?: boolean;
  /** Whether to tint vertex color with the block's RGB color (true for Lambert/Basic/Textured, false when VoxelPotatoShader supplies palette color). */
  encodeColorInVertices?: boolean;
}

export interface VoxelDDARaycastHit {
  wx: number;
  wy: number;
  wz: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  materialId: number;
  distance: number;
}

const FACE_DEFS: ReadonlyArray<{
  dir: readonly [number, number, number];
  shade: number;
  corners: ReadonlyArray<readonly [number, number, number]>;
  uvs: ReadonlyArray<readonly [number, number]>;
  aoAxes: readonly [readonly [number, number, number], readonly [number, number, number]];
}> = [
  // +Y Top
  {
    dir: [0, 1, 0],
    shade: 1.0,
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoAxes: [
      [1, 0, 0],
      [0, 0, 1],
    ],
  },
  // -Y Bottom
  {
    dir: [0, -1, 0],
    shade: 0.62,
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoAxes: [
      [1, 0, 0],
      [0, 0, 1],
    ],
  },
  // +X East
  {
    dir: [1, 0, 0],
    shade: 0.86,
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoAxes: [
      [0, 1, 0],
      [0, 0, 1],
    ],
  },
  // -X West
  {
    dir: [-1, 0, 0],
    shade: 0.78,
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoAxes: [
      [0, 1, 0],
      [0, 0, 1],
    ],
  },
  // +Z South
  {
    dir: [0, 0, 1],
    shade: 0.92,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoAxes: [
      [1, 0, 0],
      [0, 1, 0],
    ],
  },
  // -Z North
  {
    dir: [0, 0, -1],
    shade: 0.72,
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoAxes: [
      [1, 0, 0],
      [0, 1, 0],
    ],
  },
];

const _tmpColor = new Color();

function computeVertexAO(side1: number, side2: number, corner: number): number {
  if (side1 && side2) return 0.42;
  const occ = side1 + side2 + corner;
  if (occ === 0) return 1.0;
  if (occ === 1) return 0.82;
  if (occ === 2) return 0.62;
  return 0.42;
}

/**
 * General-purpose Voxl chunk mesher with face culling, baked per-vertex AO,
 * UVs, voxelMaterial & lodLevel attributes compatible with both ChunkBatchRenderer
 * (VoxelPotatoShader) and standard MeshLambertMaterial / MeshBasicMaterial.
 */
export function buildVoxelChunkGeometry(options: BuildVoxelChunkMeshOptions): BufferGeometry {
  const {
    getVoxel,
    originX,
    originY,
    originZ,
    sizeX,
    sizeY,
    sizeZ,
    voxelSize = 1.0,
    step = 1,
    lodLevel = 0,
    bakeAO = true,
    palette,
    transparentPass = false,
    encodeColorInVertices = true,
  } = options;

  const s = Math.max(1, Math.floor(step));
  const cellScale = voxelSize * s;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const matIds: number[] = [];
  const lodLevels: number[] = [];
  const indices: number[] = [];

  const isOpaqueSolid = (wx: number, wy: number, wz: number): boolean => {
    const id = getVoxel(wx, wy, wz);
    if (id === 0) return false;
    const spec = palette[id];
    return spec ? !spec.transparent : true;
  };

  for (let ly = 0; ly < sizeY; ly += s) {
    const wy = originY + ly;
    for (let lz = 0; lz < sizeZ; lz += s) {
      const wz = originZ + lz;
      for (let lx = 0; lx < sizeX; lx += s) {
        const wx = originX + lx;
        const mat = getVoxel(wx, wy, wz);
        if (mat === 0) continue;

        const spec = palette[mat];
        const isTrans = Boolean(spec?.transparent);
        if (isTrans !== transparentPass) continue;

        const shaderMatId = spec?.shaderMatId ?? (isTrans ? VOXEL_MAT_GLASS : VOXEL_MAT_DEFAULT);
        const emissive = spec?.emissiveBoost ?? 1.0;

        for (let f = 0; f < 6; f++) {
          const face = FACE_DEFS[f];
          const [dx, dy, dz] = face.dir;
          const nwx = wx + dx * s;
          const nwy = wy + dy * s;
          const nwz = wz + dz * s;
          const neighbor = getVoxel(nwx, nwy, nwz);

          if (neighbor !== 0) {
            const nSpec = palette[neighbor];
            const nTrans = Boolean(nSpec?.transparent);
            if (!isTrans && !nTrans) continue;
            if (isTrans && neighbor === mat) continue;
          }

          let faceHex = spec?.color ?? 0xffffff;
          if (f === 0 && spec?.topColor !== undefined) {
            faceHex = spec.topColor;
          } else if (f === 1 && spec?.bottomColor !== undefined) {
            faceHex = spec.bottomColor;
          }

          if (encodeColorInVertices) {
            _tmpColor.setHex(faceHex);
          } else {
            _tmpColor.setRGB(1, 1, 1);
          }

          const baseVertex = positions.length / 3;
          const cornerAOs: number[] = [1, 1, 1, 1];

          for (let c = 0; c < 4; c++) {
            const [cx, cy, cz] = face.corners[c];
            positions.push(
              (lx + cx * s) * voxelSize,
              (ly + cy * s) * voxelSize,
              (lz + cz * s) * voxelSize,
            );
            normals.push(dx, dy, dz);
            uvs.push(face.uvs[c][0], face.uvs[c][1]);
            matIds.push(shaderMatId);
            lodLevels.push(lodLevel);

            let ao = 1.0;
            if (bakeAO && !isTrans) {
              const [ax1, ax2] = face.aoAxes;
              const s1Dir =
                ax1[0] !== 0 ? (cx > 0 ? 1 : -1) : ax1[1] !== 0 ? (cy > 0 ? 1 : -1) : cz > 0 ? 1 : -1;
              const s2Dir =
                ax2[0] !== 0 ? (cx > 0 ? 1 : -1) : ax2[1] !== 0 ? (cy > 0 ? 1 : -1) : cz > 0 ? 1 : -1;

              const occ1 = isOpaqueSolid(
                nwx + ax1[0] * s1Dir * s,
                nwy + ax1[1] * s1Dir * s,
                nwz + ax1[2] * s1Dir * s,
              )
                ? 1
                : 0;
              const occ2 = isOpaqueSolid(
                nwx + ax2[0] * s2Dir * s,
                nwy + ax2[1] * s2Dir * s,
                nwz + ax2[2] * s2Dir * s,
              )
                ? 1
                : 0;
              const occC = isOpaqueSolid(
                nwx + (ax1[0] * s1Dir + ax2[0] * s2Dir) * s,
                nwy + (ax1[1] * s1Dir + ax2[1] * s2Dir) * s,
                nwz + (ax1[2] * s1Dir + ax2[2] * s2Dir) * s,
              )
                ? 1
                : 0;
              ao = computeVertexAO(occ1, occ2, occC);
            }
            cornerAOs[c] = ao;

            const shadeFactor = Math.min(1.35, face.shade * ao * emissive);
            colors.push(
              Math.min(1, _tmpColor.r * shadeFactor),
              Math.min(1, _tmpColor.g * shadeFactor),
              Math.min(1, _tmpColor.b * shadeFactor),
            );
          }

          // Flip quad diagonal to prevent anisotropic AO interpolation artifacts
          if (cornerAOs[0] + cornerAOs[2] > cornerAOs[1] + cornerAOs[3]) {
            indices.push(
              baseVertex,
              baseVertex + 1,
              baseVertex + 2,
              baseVertex,
              baseVertex + 2,
              baseVertex + 3,
            );
          } else {
            indices.push(
              baseVertex + 1,
              baseVertex + 2,
              baseVertex + 3,
              baseVertex + 1,
              baseVertex + 3,
              baseVertex,
            );
          }
        }
      }
    }
  }

  const geo = new BufferGeometry();
  geo.isVoxelGeometry = true;
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setAttribute('voxelMaterial', new BufferAttribute(new Int8Array(matIds), 1));
  geo.setAttribute('lodLevel', new BufferAttribute(new Int8Array(lodLevels), 1));
  geo.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  if (positions.length > 0) {
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  } else {
    geo.boundingSphere = null;
  }
  void cellScale;
  return geo;
}

/**
 * Fast 3D DDA voxel raycaster for block selection, mining, and placement in any Voxl game.
 */
export function raycastVoxels(
  origin: Vector3,
  direction: Vector3,
  maxDistance: number,
  getVoxel: (wx: number, wy: number, wz: number) => number,
  isTargetSolid: (materialId: number) => boolean = (id) => id !== 0,
): VoxelDDARaycastHit | null {
  const dirLen = direction.length();
  if (dirLen < 1e-6) return null;
  const dx = direction.x / dirLen;
  const dy = direction.y / dirLen;
  const dz = direction.z / dirLen;

  let vx = Math.floor(origin.x);
  let vy = Math.floor(origin.y);
  let vz = Math.floor(origin.z);

  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const stepZ = dz >= 0 ? 1 : -1;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = dx !== 0 ? ((dx > 0 ? vx + 1 - origin.x : origin.x - vx) * tDeltaX) : Infinity;
  let tMaxY = dy !== 0 ? ((dy > 0 ? vy + 1 - origin.y : origin.y - vy) * tDeltaY) : Infinity;
  let tMaxZ = dz !== 0 ? ((dz > 0 ? vz + 1 - origin.z : origin.z - vz) * tDeltaZ) : Infinity;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let dist = 0;

  const maxSteps = Math.ceil(maxDistance * 3) + 4;
  for (let i = 0; i < maxSteps; i++) {
    if (dist > maxDistance) break;
    const mat = getVoxel(vx, vy, vz);
    if (isTargetSolid(mat)) {
      return {
        wx: vx,
        wy: vy,
        wz: vz,
        normalX: nx,
        normalY: ny,
        normalZ: nz,
        materialId: mat,
        distance: dist,
      };
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        dist = tMaxX;
        tMaxX += tDeltaX;
        vx += stepX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else {
        dist = tMaxZ;
        tMaxZ += tDeltaZ;
        vz += stepZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    } else if (tMaxY < tMaxZ) {
      dist = tMaxY;
      tMaxY += tDeltaY;
      vy += stepY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      dist = tMaxZ;
      tMaxZ += tDeltaZ;
      vz += stepZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
  }

  return null;
}
