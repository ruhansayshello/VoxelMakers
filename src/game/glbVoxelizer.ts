import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MAT, WATER_VY, CHUNK_Y } from './constants.ts';

/**
 * High-density micro-voxel scale (0.15m - 0.20m range) for smooth mesh contour fidelity.
 */
export const GLB_MICRO_VOXEL_SIZE = 0.18;
export const DEFAULT_GLB_RESOLUTION = 256;
export const GLB_RESOLUTION_PRESETS = [128, 192, 256] as const;

export type OrthoAxisDirection = '+Y' | '-Y' | '+X' | '-X' | '+Z' | '-Z';

export const SIX_ORTHO_DIRECTIONS: ReadonlyArray<OrthoAxisDirection> = [
  '+Y',
  '-Y',
  '+X',
  '-X',
  '+Z',
  '-Z',
];

export interface PaletteColorRGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Reference RGB color map for automatic physical material property classification
 * (friction, restitution, blast resistance) under the hood while preserving 1:1 RGB vertex colors.
 */
export const MATERIAL_PALETTE_RGB: ReadonlyArray<{
  mat: number;
  rgb: PaletteColorRGB;
}> = [
  { mat: MAT.GRASS, rgb: { r: 0.28, g: 0.65, b: 0.18 } },
  { mat: MAT.SAND, rgb: { r: 0.88, g: 0.78, b: 0.48 } },
  { mat: MAT.WATER_VOX, rgb: { r: 0.12, g: 0.48, b: 0.85 } },
  { mat: MAT.ROCK, rgb: { r: 0.48, g: 0.48, b: 0.48 } },
  { mat: MAT.DIRT, rgb: { r: 0.45, g: 0.28, b: 0.14 } },
  { mat: MAT.ASPHALT, rgb: { r: 0.18, g: 0.18, b: 0.2 } },
  { mat: MAT.CONCRETE, rgb: { r: 0.68, g: 0.68, b: 0.7 } },
  { mat: MAT.WOOD, rgb: { r: 0.55, g: 0.35, b: 0.18 } },
  { mat: MAT.BRICK, rgb: { r: 0.72, g: 0.25, b: 0.2 } },
];

/**
 * Compares sampledColor against each palette entry using RGB squared Euclidean distance:
 * (r1 - r2)^2 + (g1 - g2)^2 + (b1 - b2)^2 and returns the closest engine material.
 */
export function findClosestMaterial(sampledColor: THREE.Color | PaletteColorRGB): number {
  let bestMat: number = MAT.GRASS;
  let bestDistSq = Infinity;
  const r1 = sampledColor.r;
  const g1 = sampledColor.g;
  const b1 = sampledColor.b;

  for (let i = 0; i < MATERIAL_PALETTE_RGB.length; i++) {
    const entry = MATERIAL_PALETTE_RGB[i];
    const r2 = entry.rgb.r;
    const g2 = entry.rgb.g;
    const b2 = entry.rgb.b;
    const distSq = (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestMat = entry.mat;
    }
  }
  return bestMat;
}

/**
 * Classifies physical solid material properties for a land voxel (strictly forbidding MAT.WATER_VOX on land).
 */
export function classifyPhysicalLandMaterial(sampledColor: PaletteColorRGB, slopeDeltaY = 0): number {
  if (slopeDeltaY >= 3) {
    return MAT.ROCK;
  }
  const mat = findClosestMaterial(sampledColor);
  if (mat === MAT.WATER_VOX) {
    return MAT.ROCK;
  }
  return mat;
}

export type GlbVoxelizerProgressCallback = (
  progressPct: number,
  stageLabel: string,
) => void;

export type GlbVoxelizerBatchCallback = (
  batch: Array<[number, number, number, number, number?, number?, number?]>,
  isFinal: boolean,
) => void;

/**
 * Computes the model's real 3D bounding box dimensions and exact proportional vertical voxel height
 * so 1 voxel unit in Y equals 1 voxel unit in X and Z (true 1:1 3D aspect ratio without vertical squashing).
 */
export function computeProportionalVoxelDimensions(
  boxMin: { x: number; y: number; z: number },
  boxMax: { x: number; y: number; z: number },
  targetResolution: number,
): {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  maxHoriz: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  voxelHeightRange: number;
} {
  const sizeX = Math.max(1e-5, boxMax.x - boxMin.x);
  const sizeY = Math.max(1e-5, boxMax.y - boxMin.y);
  const sizeZ = Math.max(1e-5, boxMax.z - boxMin.z);
  const maxHoriz = Math.max(sizeX, sizeZ);
  const gridX = Math.max(1, Math.round(targetResolution));
  const gridZ = Math.max(1, Math.round(targetResolution));
  const gridY = Math.max(1, Math.ceil((sizeY / maxHoriz) * gridX));
  const voxelHeightRange = Math.max(1, Math.round((sizeY / maxHoriz) * gridX));
  return {
    sizeX,
    sizeY,
    sizeZ,
    maxHoriz,
    gridX,
    gridY,
    gridZ,
    voxelHeightRange,
  };
}

/**
 * Computes the flat 1D index for a 3D voxel `(vx, vy, vz)` in a `gridX × gridY × gridZ` volume.
 */
export function getVoxel3DIndex(
  vx: number,
  vy: number,
  vz: number,
  gridX: number,
  gridY: number,
): number {
  return vx + gridX * (vy + gridY * vz);
}

/**
 * Encodes normalized coordinate h in [0.0, 1.0] into two 8-bit channels (hi, lo) for 16-bit precision (65,536 steps).
 */
export function encodeElevation16Bit(normH: number): [number, number] {
  const h = Math.max(0.0, Math.min(1.0, normH));
  const h16 = Math.floor(h * 65535.0 + 0.5);
  const hi = Math.floor(h16 / 256.0) & 255;
  const lo = h16 % 256;
  return [hi, lo];
}

/**
 * Decodes two 8-bit channels (hi, lo) from the GPU 16-bit buffer back into normalized [0.0, 1.0] coordinate.
 */
export function decodeElevation16Bit(hiByte: number, loByte: number): number {
  return ((hiByte * 256) + loByte) / 65535.0;
}

/**
 * Computes barycentric weights [w0, w1, w2] for point P with respect to triangle (a, b, c).
 */
export function computeBarycentricWeights(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): [number, number, number] {
  const v0x = bx - ax;
  const v0y = by - ay;
  const v0z = bz - az;

  const v1x = cx - ax;
  const v1y = cy - ay;
  const v1z = cz - az;

  const v2x = px - ax;
  const v2y = py - ay;
  const v2z = pz - az;

  const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z;

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-9) {
    return [0.3333, 0.3333, 0.3334];
  }

  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1.0 - v - w;

  const cu = Math.max(0, Math.min(1, u));
  const cv = Math.max(0, Math.min(1, v));
  const cw = Math.max(0, Math.min(1, w));
  const sum = cu + cv + cw || 1;
  return [cu / sum, cv / sum, cw / sum];
}

/**
 * Separating Axis Theorem (SAT) for 3D Triangle vs Voxel AABB Intersection.
 */
export function triangleIntersectsVoxel(
  v0x: number,
  v0y: number,
  v0z: number,
  v1x: number,
  v1y: number,
  v1z: number,
  v2x: number,
  v2y: number,
  v2z: number,
  cx: number,
  cy: number,
  cz: number,
  h = 0.5,
): boolean {
  const p0x = v0x - cx;
  const p0y = v0y - cy;
  const p0z = v0z - cz;

  const p1x = v1x - cx;
  const p1y = v1y - cy;
  const p1z = v1z - cz;

  const p2x = v2x - cx;
  const p2y = v2y - cy;
  const p2z = v2z - cz;

  let min = Math.min(p0x, p1x, p2x);
  let max = Math.max(p0x, p1x, p2x);
  if (min > h || max < -h) return false;

  min = Math.min(p0y, p1y, p2y);
  max = Math.max(p0y, p1y, p2y);
  if (min > h || max < -h) return false;

  min = Math.min(p0z, p1z, p2z);
  max = Math.max(p0z, p1z, p2z);
  if (min > h || max < -h) return false;

  const e0x = p1x - p0x;
  const e0y = p1y - p0y;
  const e0z = p1z - p0z;

  const e1x = p2x - p1x;
  const e1y = p2y - p1y;
  const e1z = p2z - p1z;

  const e2x = p0x - p2x;
  const e2y = p0y - p2y;
  const e2z = p0z - p2z;

  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;

  const d = nx * p0x + ny * p0y + nz * p0z;
  const r = h * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
  if (Math.abs(d) > r) return false;

  let rad = h * (Math.abs(e0z) + Math.abs(e0y));
  let p0 = e0z * p0y - e0y * p0z;
  let p2 = e0z * p2y - e0y * p2z;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;

  rad = h * (Math.abs(e0z) + Math.abs(e0x));
  p0 = -e0z * p0x + e0x * p0z;
  p2 = -e0z * p2x + e0x * p2z;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;

  rad = h * (Math.abs(e0y) + Math.abs(e0x));
  p0 = e0y * p0x - e0x * p0y;
  p2 = e0y * p2x - e0x * p2y;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;

  rad = h * (Math.abs(e1z) + Math.abs(e1y));
  p0 = e1z * p0y - e1y * p0z;
  let p1 = e1z * p1y - e1y * p1z;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;

  rad = h * (Math.abs(e1z) + Math.abs(e1x));
  p0 = -e1z * p0x + e1x * p0z;
  p1 = -e1z * p1x + e1x * p1z;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;

  rad = h * (Math.abs(e1y) + Math.abs(e1x));
  p0 = e1y * p0x - e1x * p0y;
  p1 = e1y * p1x - e1x * p1y;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;

  rad = h * (Math.abs(e2z) + Math.abs(e2y));
  p0 = e2z * p0y - e2y * p0z;
  p1 = e2z * p1y - e2y * p1z;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;

  rad = h * (Math.abs(e2z) + Math.abs(e2x));
  p0 = -e2z * p0x + e2x * p0z;
  p1 = -e2z * p1x + e2x * p1z;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;

  rad = h * (Math.abs(e2y) + Math.abs(e2x));
  p0 = e2y * p0x - e2x * p0y;
  p1 = e2y * p1x - e2x * p1y;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;

  return true;
}

/**
 * Prepares a GLB scene for GPU render-target sampling:
 * 1. Calls gltfScene.updateMatrixWorld(true)
 * 2. Forces visible = true on all ancestor & mesh nodes
 * 3. Forces material.side = THREE.DoubleSide on all meshes so backfaces and steep triangles are never culled
 * 4. Computes the exact world-space THREE.Box3 across all child THREE.Mesh nodes
 */
export function prepareGlbSceneForGpuRaster(gltfScene: THREE.Object3D): {
  worldBox: THREE.Box3;
  meshes: THREE.Mesh[];
} {
  gltfScene.visible = true;
  gltfScene.updateMatrixWorld(true);

  const worldBox = new THREE.Box3();
  const meshes: THREE.Mesh[] = [];
  const tempPos = new THREE.Vector3();

  gltfScene.traverse((node) => {
    node.visible = true;
    if (!(node as THREE.Mesh).isMesh) return;
    const mesh = node as THREE.Mesh;
    const geom = mesh.geometry;
    if (!geom || !geom.attributes.position) return;

    // Force DoubleSide on all materials so steep triangles and backfaces are never culled
    if (Array.isArray(mesh.material)) {
      for (let i = 0; i < mesh.material.length; i++) {
        if (mesh.material[i]) {
          mesh.material[i].side = THREE.DoubleSide;
          mesh.material[i].needsUpdate = true;
        }
      }
    } else if (mesh.material) {
      mesh.material.side = THREE.DoubleSide;
      mesh.material.needsUpdate = true;
    }

    const posAttr = geom.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      tempPos.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      worldBox.expandByPoint(tempPos);
    }
    meshes.push(mesh);
  });

  return { worldBox, meshes };
}

/**
 * Builds an unlit THREE.MeshBasicMaterial preserving the mesh's original diffuse map, base color, and vertexColors
 * with zero scene lighting, fog, or tone-mapping distortion.
 */
function createUnlitDiffuseMaterial(
  origMat: THREE.Material | undefined,
  hasVertexColorAttr: boolean,
): THREE.MeshBasicMaterial {
  const std = origMat as
    | (THREE.MeshStandardMaterial & {
        map?: THREE.Texture | null;
        color?: THREE.Color;
      })
    | undefined;

  const baseColor =
    std?.color && typeof std.color.r === 'number'
      ? new THREE.Color(std.color.r, std.color.g, std.color.b)
      : new THREE.Color(0xffffff);
  const diffuseMap = std?.map || null;
  const useVertexColors = Boolean(std?.vertexColors || hasVertexColorAttr);

  return new THREE.MeshBasicMaterial({
    color: baseColor,
    map: diffuseMap,
    vertexColors: useVertexColors,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
    transparent: false,
    opacity: 1.0,
  });
}

/**
 * Builds a custom THREE.ShaderMaterial that encodes normalized world coordinate along any axis
 * (axisIndex: 0 = X, 1 = Y, 2 = Z) into two 8-bit channels (16-bit precision: 65,536 steps).
 */
export function createAxis16BitShaderMaterial(
  axisIndex: 0 | 1 | 2,
  axisMin: number,
  axisMax: number,
): THREE.ShaderMaterial {
  const safeMax = Math.max(axisMin + 1e-5, axisMax);
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    toneMapped: false,
    fog: false,
    uniforms: {
      uAxisIndex: { value: axisIndex },
      uMinVal: { value: axisMin },
      uMaxVal: { value: safeMax },
    },
    vertexShader: `
      uniform int uAxisIndex;
      uniform float uMinVal;
      uniform float uMaxVal;
      varying float vNormalizedCoord;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        float coord = uAxisIndex == 0 ? worldPos.x : (uAxisIndex == 1 ? worldPos.y : worldPos.z);
        vNormalizedCoord = (coord - uMinVal) / (uMaxVal - uMinVal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying float vNormalizedCoord;
      void main() {
        float h = clamp(vNormalizedCoord, 0.0, 1.0);
        float h16 = floor(h * 65535.0 + 0.5);
        float hi = floor(h16 / 256.0) / 255.0;
        float lo = mod(h16, 256.0) / 255.0;
        gl_FragColor = vec4(hi, lo, 0.0, 1.0);
      }
    `,
  });
}

/**
 * Builds the Pass 2 custom THREE.ShaderMaterial that encodes normalized world Y elevation
 * h = clamp((worldPos.y - boxMinY) / (boxMaxY - boxMinY), 0.0, 1.0) across two 8-bit channels (65,536 steps).
 */
export function createElevation16BitShaderMaterial(
  boxMinY: number,
  boxMaxY: number,
): THREE.ShaderMaterial {
  return createAxis16BitShaderMaterial(1, boxMinY, boxMaxY);
}

/**
 * Unprojects a 2D render-target pixel `(u, v)` and its normalized 16-bit depth/axis coordinate `normCoord` in [0..1]
 * back into 3D voxel grid coordinates `(vx, vy, vz)`.
 */
export function unprojectOrthoPixelToVoxel3D(
  dir: OrthoAxisDirection,
  u: number,
  v: number,
  normCoord: number,
  res: number,
  voxelHeightRange: number,
): { vx: number; vy: number; vz: number } {
  const clampXZ = (val: number) => Math.max(0, Math.min(res - 1, Math.round(val)));
  const clampY = (val: number) => Math.max(0, Math.min(voxelHeightRange, Math.round(val)));

  if (dir === '+Y') {
    return {
      vx: clampXZ(u),
      vy: clampY(normCoord * voxelHeightRange),
      vz: clampXZ(v),
    };
  }

  if (dir === '-Y') {
    return {
      vx: clampXZ(u),
      vy: clampY(normCoord * voxelHeightRange),
      vz: clampXZ(res - 1 - v),
    };
  }

  const normY = res > 1 ? 1.0 - v / (res - 1) : 0.0;
  const vy = clampY(normY * voxelHeightRange);

  if (dir === '+X') {
    return {
      vx: clampXZ(normCoord * (res - 1)),
      vy,
      vz: clampXZ(res - 1 - u),
    };
  }

  if (dir === '-X') {
    return {
      vx: clampXZ(normCoord * (res - 1)),
      vy,
      vz: clampXZ(u),
    };
  }

  if (dir === '+Z') {
    return {
      vx: clampXZ(u),
      vy,
      vz: clampXZ(normCoord * (res - 1)),
    };
  }

  return {
    vx: clampXZ(res - 1 - u),
    vy,
    vz: clampXZ(normCoord * (res - 1)),
  };
}

/**
 * True 3D Parity Infill & Structural Crust Builder (`applyTrue3DParityInfill`):
 * - Operates on `voxelSolid` (`0 = air/gap`, `1 = surface shell`, `2 = solid interior`) and `voxelRGB` (`gridX * gridY * gridZ * 3`).
 * - First connects razor-thin vertical walls between adjacent columns ONLY where both columns have a single continuous terrain surface
 *   (strictly avoiding bridging across multi-layer overhangs or tunnels).
 * - Then, for every `(vx, vz)` column:
 *   1. Finds all separated vertical surface segments (`voxelSolid === 1`).
 *   2. If a column has multiple separated surface layers (e.g. an overhang/arch/bridge at `vy = 80` and ground floor at `vy = 30`),
 *      keeps the space between `vy = 78` and `vy = 31` as **100% open `MAT.AIR` (`voxelSolid = 0`)** so 3D gaps, caves, and tunnels are preserved!
 *   3. Directly underneath each upper surface shell (`voxelSolid === 1`), adds a 2-voxel thick structural crust (`voxelSolid = 1` with inherited RGB)
 *      so overhangs, arches, and bridges have solid 3-voxel structural thickness.
 *   4. Only below the *lowest* surface hit (`lowestVY`) in that `(vx, vz)` column (`vy = 0 .. lowestVY - 1`), fills down to `vy = 0` (bedrock)
 *      with `voxelSolid = 2` (solid interior `MAT.DIRT` / `MAT.ROCK`) so the landmass rests on a solid base without floating or exposing groundwater.
 */
export function applyTrue3DParityInfill(
  voxelSolid: Uint8Array,
  voxelRGB: Uint8Array,
  gridX: number,
  gridY: number,
  gridZ: number,
): {
  footprintMask: Uint8Array;
  lowestSurfaceVY: Int16Array;
  highestSurfaceVY: Int16Array;
} {
  const totalCols = gridX * gridZ;
  const footprintMask = new Uint8Array(totalCols);
  const lowestSurfaceVY = new Int16Array(totalCols).fill(-1);
  const highestSurfaceVY = new Int16Array(totalCols).fill(-1);

  // Pre-scan columns to count distinct vertical surface segments and record top/bottom surface vy
  const colSegmentCount = new Uint8Array(totalCols);
  for (let vz = 0; vz < gridZ; vz++) {
    for (let vx = 0; vx < gridX; vx++) {
      const colIdx = vx + vz * gridX;
      let segs = 0;
      let inSeg = false;
      let lowY = -1;
      let highY = -1;

      for (let vy = 0; vy < gridY; vy++) {
        const idx3D = vx + gridX * (vy + gridY * vz);
        if (voxelSolid[idx3D] === 1) {
          if (lowY === -1) lowY = vy;
          highY = vy;
          if (!inSeg) {
            segs++;
            inSeg = true;
          }
        } else {
          inSeg = false;
        }
      }

      if (segs > 0) {
        footprintMask[colIdx] = 1;
        colSegmentCount[colIdx] = Math.min(255, segs);
        lowestSurfaceVY[colIdx] = lowY;
        highestSurfaceVY[colIdx] = highY;
      }
    }
  }

  // Step 1: Connect razor-thin vertical walls on steep slopes where a single-surface column steps down
  // to an adjacent single-surface neighbor (never bridging across multi-segment overhangs!)
  const newlyStitched: Array<{ idx3D: number; r: number; g: number; b: number }> = [];
  for (let vz = 0; vz < gridZ; vz++) {
    for (let vx = 0; vx < gridX; vx++) {
      const colIdx = vx + vz * gridX;
      if (colSegmentCount[colIdx] !== 1) continue;

      const topY = highestSurfaceVY[colIdx];
      const lowY = lowestSurfaceVY[colIdx];
      let minNeighborLowY = lowY;

      const checkNeighbor = (nx: number, nz: number) => {
        const nCol = nx + nz * gridX;
        if (colSegmentCount[nCol] === 1) {
          const nTop = highestSurfaceVY[nCol];
          if (nTop < minNeighborLowY) {
            minNeighborLowY = nTop;
          }
        }
      };

      if (vx > 0) checkNeighbor(vx - 1, vz);
      if (vx < gridX - 1) checkNeighbor(vx + 1, vz);
      if (vz > 0) checkNeighbor(vx, vz - 1);
      if (vz < gridZ - 1) checkNeighbor(vx, vz + 1);

      if (minNeighborLowY < lowY - 1) {
        const srcIdx3D = vx + gridX * (lowY + gridY * vz);
        const srcC = srcIdx3D * 3;
        const r = voxelRGB[srcC] || 128;
        const g = voxelRGB[srcC + 1] || 128;
        const b = voxelRGB[srcC + 2] || 128;
        for (let vy = lowY - 1; vy >= minNeighborLowY; vy--) {
          const idx3D = vx + gridX * (vy + gridY * vz);
          if (voxelSolid[idx3D] === 0) {
            newlyStitched.push({ idx3D, r, g, b });
          }
        }
      }
    }
  }

  for (let i = 0; i < newlyStitched.length; i++) {
    const item = newlyStitched[i];
    voxelSolid[item.idx3D] = 1;
    const cOff = item.idx3D * 3;
    voxelRGB[cOff] = item.r;
    voxelRGB[cOff + 1] = item.g;
    voxelRGB[cOff + 2] = item.b;
  }

  // Step 2: Per-column True 3D Parity Infill:
  // - Keep gaps between separated surface layers as 100% open MAT.AIR (voxelSolid = 0)
  // - Add a 2-voxel thick structural crust directly underneath each upper surface shell
  // - Fill below the lowest surface hit (lowestVY) down to vy = 0 with solid interior (voxelSolid = 2)
  for (let vz = 0; vz < gridZ; vz++) {
    for (let vx = 0; vx < gridX; vx++) {
      const colIdx = vx + vz * gridX;
      if (footprintMask[colIdx] === 0) continue;

      const segments: Array<{ bottomVY: number; topVY: number }> = [];
      let vy = 0;
      while (vy < gridY) {
        const idx3D = vx + gridX * (vy + gridY * vz);
        if (voxelSolid[idx3D] === 1) {
          const bottomVY = vy;
          let topVY = vy;
          while (vy + 1 < gridY && voxelSolid[vx + gridX * ((vy + 1) + gridY * vz)] === 1) {
            vy++;
            topVY = vy;
          }
          segments.push({ bottomVY, topVY });
        }
        vy++;
      }

      if (segments.length === 0) continue;

      const lowestVY = segments[0].bottomVY;
      lowestSurfaceVY[colIdx] = lowestVY;
      highestSurfaceVY[colIdx] = segments[segments.length - 1].topVY;

      // 2a. For each upper overhang/bridge segment (index >= 1), add a 2-voxel structural crust directly beneath it
      // while preserving open air between this crust and the lower surface!
      for (let s = 1; s < segments.length; s++) {
        const seg = segments[s];
        const prevSegTop = segments[s - 1].topVY;
        const srcIdx3D = vx + gridX * (seg.bottomVY + gridY * vz);
        const srcC = srcIdx3D * 3;
        const r = voxelRGB[srcC] || 140;
        const g = voxelRGB[srcC + 1] || 140;
        const b = voxelRGB[srcC + 2] || 140;

        for (let c = 1; c <= 2; c++) {
          const crustVY = seg.bottomVY - c;
          // Leave at least 2 voxels of open air above the lower surface so tunnels/gaps never seal shut
          if (crustVY > prevSegTop + 2) {
            const cIdx3D = vx + gridX * (crustVY + gridY * vz);
            if (voxelSolid[cIdx3D] === 0) {
              voxelSolid[cIdx3D] = 1;
              const cOff = cIdx3D * 3;
              voxelRGB[cOff] = r;
              voxelRGB[cOff + 1] = g;
              voxelRGB[cOff + 2] = b;
            }
          }
        }
      }

      // 2b. Also ensure the lowest surface shell has at least a 2-voxel surface-colored crust before transitioning to MAT.ROCK/DIRT
      const baseSeg = segments[0];
      const baseIdx3D = vx + gridX * (baseSeg.bottomVY + gridY * vz);
      const baseC = baseIdx3D * 3;
      const br = voxelRGB[baseC] || 140;
      const bg = voxelRGB[baseC + 1] || 140;
      const bb = voxelRGB[baseC + 2] || 140;
      for (let c = 1; c <= 2; c++) {
        const crustVY = baseSeg.bottomVY - c;
        if (crustVY >= 0) {
          const cIdx3D = vx + gridX * (crustVY + gridY * vz);
          if (voxelSolid[cIdx3D] === 0) {
            voxelSolid[cIdx3D] = 1;
            const cOff = cIdx3D * 3;
            voxelRGB[cOff] = br;
            voxelRGB[cOff + 1] = bg;
            voxelRGB[cOff + 2] = bb;
          }
        }
      }

      // 2c. Only below the lowest surface crust in this column, fill down to vy = 0 with solid interior (voxelSolid = 2)
      const solidTopVY = Math.max(0, baseSeg.bottomVY - 2);
      for (let fillY = 0; fillY < solidTopVY; fillY++) {
        const fIdx3D = vx + gridX * (fillY + gridY * vz);
        if (voxelSolid[fIdx3D] === 0) {
          voxelSolid[fIdx3D] = 2;
        }
      }
    }
  }

  return {
    footprintMask,
    lowestSurfaceVY,
    highestSurfaceVY,
  };
}

/**
 * Software 3D CT-Slicer fallback (`ctSliceMeshesSoftwareFallback`) used when no WebGLRenderer context is available
 * (e.g. inside headless Node.js unit tests).
 * Slices every triangle across the 3D `(vx, vy, vz)` voxel grid using exact 13-axis SAT (`triangleIntersectsVoxel`)
 * and barycentric vertex color / material color interpolation.
 */
export function ctSliceMeshesSoftwareFallback(
  meshes: THREE.Mesh[],
  worldBox: THREE.Box3,
  gridX: number,
  gridY: number,
  gridZ: number,
  voxelSolid: Uint8Array,
  voxelRGB: Uint8Array,
): void {
  const sizeX = Math.max(1e-5, worldBox.max.x - worldBox.min.x);
  const sizeY = Math.max(1e-5, worldBox.max.y - worldBox.min.y);
  const sizeZ = Math.max(1e-5, worldBox.max.z - worldBox.min.z);
  const maxHoriz = Math.max(sizeX, sizeZ);
  const halfHoriz = maxHoriz * 0.5;
  const centerX = (worldBox.min.x + worldBox.max.x) * 0.5;
  const centerZ = (worldBox.min.z + worldBox.max.z) * 0.5;
  const minX = centerX - halfHoriz;
  const minZ = centerZ - halfHoriz;
  const minY = worldBox.min.y;

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  for (let m = 0; m < meshes.length; m++) {
    const mesh = meshes[m];
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    const colAttr = geom.attributes.color;
    const index = geom.index;

    const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const stdMat = rawMat as (THREE.MeshStandardMaterial & { color?: THREE.Color }) | undefined;
    const matR = stdMat?.color ? stdMat.color.r : 1.0;
    const matG = stdMat?.color ? stdMat.color.g : 1.0;
    const matB = stdMat?.color ? stdMat.color.b : 1.0;

    const triCount = index ? index.count / 3 : posAttr.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

      vA.fromBufferAttribute(posAttr, i0).applyMatrix4(mesh.matrixWorld);
      vB.fromBufferAttribute(posAttr, i1).applyMatrix4(mesh.matrixWorld);
      vC.fromBufferAttribute(posAttr, i2).applyMatrix4(mesh.matrixWorld);

      // Map world triangle vertices into 3D voxel grid coordinates [0..gridX, 0..gridY, 0..gridZ]
      const gx0 = ((vA.x - minX) / maxHoriz) * gridX;
      const gy0 = ((vA.y - minY) / sizeY) * (gridY - 1);
      const gz0 = ((vA.z - minZ) / maxHoriz) * gridZ;

      const gx1 = ((vB.x - minX) / maxHoriz) * gridX;
      const gy1 = ((vB.y - minY) / sizeY) * (gridY - 1);
      const gz1 = ((vB.z - minZ) / maxHoriz) * gridZ;

      const gx2 = ((vC.x - minX) / maxHoriz) * gridX;
      const gy2 = ((vC.y - minY) / sizeY) * (gridY - 1);
      const gz2 = ((vC.z - minZ) / maxHoriz) * gridZ;

      const minVX = Math.max(0, Math.floor(Math.min(gx0, gx1, gx2)));
      const maxVX = Math.min(gridX - 1, Math.floor(Math.max(gx0, gx1, gx2)));
      const minVY = Math.max(0, Math.floor(Math.min(gy0, gy1, gy2)));
      const maxVY = Math.min(gridY - 1, Math.floor(Math.max(gy0, gy1, gy2)));
      const minVZ = Math.max(0, Math.floor(Math.min(gz0, gz1, gz2)));
      const maxVZ = Math.min(gridZ - 1, Math.floor(Math.max(gz0, gz1, gz2)));

      for (let vz = minVZ; vz <= maxVZ; vz++) {
        const cz = vz + 0.5;
        for (let vy = minVY; vy <= maxVY; vy++) {
          const cy = vy + 0.5;
          for (let vx = minVX; vx <= maxVX; vx++) {
            const cx = vx + 0.5;
            if (
              !triangleIntersectsVoxel(
                gx0,
                gy0,
                gz0,
                gx1,
                gy1,
                gz1,
                gx2,
                gy2,
                gz2,
                cx,
                cy,
                cz,
                0.55,
              )
            ) {
              continue;
            }

            const [w0, w1, w2] = computeBarycentricWeights(
              cx,
              cy,
              cz,
              gx0,
              gy0,
              gz0,
              gx1,
              gy1,
              gz1,
              gx2,
              gy2,
              gz2,
            );

            let r = matR;
            let g = matG;
            let b = matB;
            if (colAttr) {
              r *= w0 * colAttr.getX(i0) + w1 * colAttr.getX(i1) + w2 * colAttr.getX(i2);
              g *= w0 * colAttr.getY(i0) + w1 * colAttr.getY(i1) + w2 * colAttr.getY(i2);
              b *= w0 * colAttr.getZ(i0) + w1 * colAttr.getZ(i1) + w2 * colAttr.getZ(i2);
            }

            const idx3D = vx + gridX * (vy + gridY * vz);
            voxelSolid[idx3D] = 1;
            const cOff = idx3D * 3;
            voxelRGB[cOff] = Math.max(1, Math.min(255, Math.round(r * 255)));
            voxelRGB[cOff + 1] = Math.max(1, Math.min(255, Math.round(g * 255)));
            voxelRGB[cOff + 2] = Math.max(1, Math.min(255, Math.round(b * 255)));
          }
        }
      }
    }
  }
}

/**
 * GPU Depth-Slice Tomographic Scanner (`ctSliceSceneWithGpu`):
 * Slices through the 3D model layer-by-layer using hardware near/far clipping planes:
 * 1. **Y-Slice Loop (Top-to-Bottom Hardware Slicing)**:
 *    For each vertical layer `vy` from `0` to `gridY - 1`, sets:
 *    `camera.near = sliceMinDist - (vy + 1) * voxelWorldSize;`
 *    `camera.far  = sliceMinDist - (vy) * voxelWorldSize;`
 *    `camera.updateProjectionMatrix();`
 *    Renders into a tiled offscreen `WebGLRenderTarget` and extracts all slices via `readRenderTargetPixels`.
 *    Every pixel `(vx, vz)` with `alpha > 0` sets `voxelSolid[idx3D] = 1` and stores its exact `R, G, B` in `voxelRGB`.
 * 2. **X-Slice & Z-Slice Passes (Catch Razor-Thin Vertical Walls)**:
 *    Repeats hardware near/far slicing along the X axis and Z axis so 90-degree vertical walls thinner than 1 pixel
 *    are completely captured with their side-wall UV textures and zero holes.
 */
function ctSliceSceneWithGpu(
  gltfScene: THREE.Object3D,
  meshes: THREE.Mesh[],
  worldBox: THREE.Box3,
  gridX: number,
  gridY: number,
  gridZ: number,
  renderer: THREE.WebGLRenderer,
  voxelSolid: Uint8Array,
  voxelRGB: Uint8Array,
  onProgress?: GlbVoxelizerProgressCallback,
): boolean {
  const sizeX = Math.max(1e-5, worldBox.max.x - worldBox.min.x);
  const sizeY = Math.max(1e-5, worldBox.max.y - worldBox.min.y);
  const sizeZ = Math.max(1e-5, worldBox.max.z - worldBox.min.z);
  const maxHoriz = Math.max(sizeX, sizeZ);
  const halfHoriz = maxHoriz * 0.5;
  const halfY = sizeY * 0.5;

  const centerX = (worldBox.min.x + worldBox.max.x) * 0.5;
  const centerY = (worldBox.min.y + worldBox.max.y) * 0.5;
  const centerZ = (worldBox.min.z + worldBox.max.z) * 0.5;
  const minX = centerX - halfHoriz;
  const maxX = centerX + halfHoriz;
  const minZ = centerZ - halfHoriz;
  const maxZ = centerZ + halfHoriz;
  const minY = worldBox.min.y;
  const maxY = worldBox.max.y;

  const savedMeshMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const savedTexColorSpaces = new Map<THREE.Texture, any>();
  const tempMaterialsToDispose: THREE.Material[] = [];

  const prevRenderTarget = renderer.getRenderTarget();
  const prevClearColor = renderer.getClearColor(new THREE.Color());
  const prevClearAlpha = renderer.getClearAlpha();
  const prevToneMapping = renderer.toneMapping;
  const prevAutoClear = renderer.autoClear;
  const prevViewport = new THREE.Vector4();
  const prevScissor = new THREE.Vector4();
  const prevScissorTest = renderer.getScissorTest();
  renderer.getViewport(prevViewport);
  renderer.getScissor(prevScissor);

  // Use a tiled atlas WebGLRenderTarget (e.g. 8x8 tiles per batch) so we execute hardware near/far slicing
  // for every single layer while batching readRenderTargetPixels calls to avoid GPU pipeline stalls!
  const tilesX = 8;
  const tilesY = 8;
  const slicesPerBatch = tilesX * tilesY;
  const tileW = gridX;
  const tileH = gridZ;
  const atlasW = tileW * tilesX;
  const atlasH = tileH * tilesY;

  const rt = new THREE.WebGLRenderTarget(atlasW, atlasH, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  const atlasPixels = new Uint8Array(atlasW * atlasH * 4);

  let anyHit = false;

  try {
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      mesh.visible = true;
      savedMeshMaterials.set(mesh, mesh.material);
      const hasVertCol = Boolean(mesh.geometry.attributes.color);

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((subMat) => {
          const m = createUnlitDiffuseMaterial(subMat, hasVertCol);
          if (m.map && !savedTexColorSpaces.has(m.map)) {
            savedTexColorSpaces.set(m.map, m.map.colorSpace);
            m.map.colorSpace = THREE.NoColorSpace;
          }
          tempMaterialsToDispose.push(m);
          return m;
        });
      } else {
        const m = createUnlitDiffuseMaterial(mesh.material, hasVertCol);
        if (m.map && !savedTexColorSpaces.has(m.map)) {
          savedTexColorSpaces.set(m.map, m.map.colorSpace);
          m.map.colorSpace = THREE.NoColorSpace;
        }
        tempMaterialsToDispose.push(m);
        mesh.material = m;
      }
    }

    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0.0);

    // Helper that sets exact integer pixel viewport & scissor on the offscreen WebGLRenderTarget
    // without multiplying by renderer.getPixelRatio() (which is 0.65 in dynamic-res mode!)
    const setRtViewportAndScissor = (
      x: number,
      y: number,
      w: number,
      h: number,
      enableScissor: boolean,
    ) => {
      rt.viewport.set(x, y, w, h);
      rt.scissor.set(x, y, w, h);
      rt.scissorTest = enableScissor;
      renderer.state.viewport(rt.viewport);
      renderer.state.scissor(rt.scissor);
      renderer.state.setScissorTest(enableScissor);
    };

    const camMargin = 2.0;

    // =========================================================================
    // 1. Y-SLICE LOOP (Top-to-Bottom Hardware Slicing across vy = 0 .. gridY - 1)
    // =========================================================================
    onProgress?.(35, `GPU CT-Slicer: Scanning ${gridY} Y-depth layers (${gridX}×${gridZ})...`);
    const yCam = new THREE.OrthographicCamera(
      -halfHoriz,
      halfHoriz,
      halfHoriz,
      -halfHoriz,
      0.01,
      sizeY + camMargin * 2,
    );
    yCam.position.set(centerX, maxY + camMargin, centerZ);
    yCam.up.set(0, 0, -1);
    yCam.lookAt(centerX, minY, centerZ);
    yCam.updateMatrixWorld(true);

    const sliceMinDistY = sizeY + camMargin;
    const voxelWorldSizeY = sizeY / gridY;
    const padY = voxelWorldSizeY * 0.15;

    for (let batchStart = 0; batchStart < gridY; batchStart += slicesPerBatch) {
      const batchEnd = Math.min(gridY, batchStart + slicesPerBatch);
      setRtViewportAndScissor(0, 0, atlasW, atlasH, false);
      renderer.clear(true, true, false);
      renderer.autoClear = false;

      for (let vy = batchStart; vy < batchEnd; vy++) {
        const localIdx = vy - batchStart;
        const tx = localIdx % tilesX;
        const ty = Math.floor(localIdx / tilesX);
        const vpX = tx * tileW;
        const vpY = ty * tileH;

        yCam.near = Math.max(0.01, sliceMinDistY - (vy + 1) * voxelWorldSizeY - padY);
        yCam.far = Math.max(yCam.near + 1e-4, sliceMinDistY - vy * voxelWorldSizeY + padY);
        yCam.updateProjectionMatrix();

        setRtViewportAndScissor(vpX, vpY, tileW, tileH, true);
        renderer.render(gltfScene, yCam);
      }

      renderer.readRenderTargetPixels(rt, 0, 0, atlasW, atlasH, atlasPixels);

      for (let vy = batchStart; vy < batchEnd; vy++) {
        const localIdx = vy - batchStart;
        const tx = localIdx % tilesX;
        const ty = Math.floor(localIdx / tilesX);
        const baseX = tx * tileW;
        const baseY = ty * tileH;

        for (let vz = 0; vz < gridZ; vz++) {
          // Flip tile Y row so vz = 0 is top of frustum (-Z = minZ) and vz = gridZ - 1 is bottom (+Z = maxZ)
          const srcY = baseY + (tileH - 1 - vz);
          const rowStart = (srcY * atlasW + baseX) * 4;
          for (let vx = 0; vx < gridX; vx++) {
            const pIdx = rowStart + vx * 4;
            if (atlasPixels[pIdx + 3] === 0) continue;

            anyHit = true;
            const idx3D = vx + gridX * (vy + gridY * vz);
            voxelSolid[idx3D] = 1;
            const cOff = idx3D * 3;
            voxelRGB[cOff] = Math.max(1, atlasPixels[pIdx]);
            voxelRGB[cOff + 1] = Math.max(1, atlasPixels[pIdx + 1]);
            voxelRGB[cOff + 2] = Math.max(1, atlasPixels[pIdx + 2]);
          }
        }
      }
    }

    // =========================================================================
    // 2. X-SLICE PASS (Catch Razor-Thin Vertical Walls normal to X axis)
    // =========================================================================
    onProgress?.(60, `GPU CT-Slicer: Scanning X-axis vertical wall slices...`);
    const xCam = new THREE.OrthographicCamera(
      -halfHoriz,
      halfHoriz,
      halfY,
      -halfY,
      0.01,
      maxHoriz + camMargin * 2,
    );
    xCam.position.set(maxX + camMargin, centerY, centerZ);
    xCam.up.set(0, 1, 0);
    xCam.lookAt(minX, centerY, centerZ);
    xCam.updateMatrixWorld(true);

    const sliceMinDistX = maxHoriz + camMargin;
    const voxelWorldSizeX = maxHoriz / gridX;
    const padX = voxelWorldSizeX * 0.25;

    for (let batchStart = 0; batchStart < gridX; batchStart += slicesPerBatch) {
      const batchEnd = Math.min(gridX, batchStart + slicesPerBatch);
      setRtViewportAndScissor(0, 0, atlasW, atlasH, false);
      renderer.clear(true, true, false);
      renderer.autoClear = false;

      for (let vx = batchStart; vx < batchEnd; vx++) {
        const localIdx = vx - batchStart;
        const tx = localIdx % tilesX;
        const ty = Math.floor(localIdx / tilesX);
        const vpX = tx * tileW;
        const vpY = ty * tileH;

        xCam.near = Math.max(0.01, sliceMinDistX - (vx + 1) * voxelWorldSizeX - padX);
        xCam.far = Math.max(xCam.near + 1e-4, sliceMinDistX - vx * voxelWorldSizeX + padX);
        xCam.updateProjectionMatrix();

        setRtViewportAndScissor(vpX, vpY, tileW, tileH, true);
        renderer.render(gltfScene, xCam);
      }

      renderer.readRenderTargetPixels(rt, 0, 0, atlasW, atlasH, atlasPixels);

      for (let vx = batchStart; vx < batchEnd; vx++) {
        const localIdx = vx - batchStart;
        const tx = localIdx % tilesX;
        const ty = Math.floor(localIdx / tilesX);
        const baseX = tx * tileW;
        const baseY = ty * tileH;

        for (let py = 0; py < tileH; py++) {
          // py = 0 in WebGL readRenderTargetPixels is bottom of frustum (-Y = minY -> vy = 0)
          const vy = Math.min(gridY - 1, Math.floor((py / tileH) * gridY));
          const srcY = baseY + py;
          const rowStart = (srcY * atlasW + baseX) * 4;
          for (let px = 0; px < tileW; px++) {
            const pIdx = rowStart + px * 4;
            if (atlasPixels[pIdx + 3] === 0) continue;

            // Looking toward -X: right (+px) is -Z, so px = 0 is maxZ and px = tileW - 1 is minZ
            const vz = Math.max(0, Math.min(gridZ - 1, gridZ - 1 - px));
            anyHit = true;
            const idx3D = vx + gridX * (vy + gridY * vz);
            if (voxelSolid[idx3D] === 0) {
              voxelSolid[idx3D] = 1;
              const cOff = idx3D * 3;
              voxelRGB[cOff] = Math.max(1, atlasPixels[pIdx]);
              voxelRGB[cOff + 1] = Math.max(1, atlasPixels[pIdx + 1]);
              voxelRGB[cOff + 2] = Math.max(1, atlasPixels[pIdx + 2]);
            }
          }
        }
      }
    }

    // =========================================================================
    // 3. Z-SLICE PASS (Catch Razor-Thin Vertical Walls normal to Z axis)
    // =========================================================================
    onProgress?.(78, `GPU CT-Slicer: Scanning Z-axis vertical wall slices...`);
    const zCam = new THREE.OrthographicCamera(
      -halfHoriz,
      halfHoriz,
      halfY,
      -halfY,
      0.01,
      maxHoriz + camMargin * 2,
    );
    zCam.position.set(centerX, centerY, maxZ + camMargin);
    zCam.up.set(0, 1, 0);
    zCam.lookAt(centerX, centerY, minZ);
    zCam.updateMatrixWorld(true);

    const sliceMinDistZ = maxHoriz + camMargin;
    const voxelWorldSizeZ = maxHoriz / gridZ;
    const padZ = voxelWorldSizeZ * 0.25;

    for (let batchStart = 0; batchStart < gridZ; batchStart += slicesPerBatch) {
      const batchEnd = Math.min(gridZ, batchStart + slicesPerBatch);
      setRtViewportAndScissor(0, 0, atlasW, atlasH, false);
      renderer.clear(true, true, false);
      renderer.autoClear = false;

      for (let vz = batchStart; vz < batchEnd; vz++) {
        const localIdx = vz - batchStart;
        const tx = localIdx % tilesX;
        const ty = Math.floor(localIdx / tilesX);
        const vpX = tx * tileW;
        const vpY = ty * tileH;

        zCam.near = Math.max(0.01, sliceMinDistZ - (vz + 1) * voxelWorldSizeZ - padZ);
        zCam.far = Math.max(zCam.near + 1e-4, sliceMinDistZ - vz * voxelWorldSizeZ + padZ);
        zCam.updateProjectionMatrix();

        setRtViewportAndScissor(vpX, vpY, tileW, tileH, true);
        renderer.render(gltfScene, zCam);
      }

      renderer.readRenderTargetPixels(rt, 0, 0, atlasW, atlasH, atlasPixels);

      for (let vz = batchStart; vz < batchEnd; vz++) {
        const localIdx = vz - batchStart;
        const tx = localIdx % tilesX;
        const ty = Math.floor(localIdx / tilesX);
        const baseX = tx * tileW;
        const baseY = ty * tileH;

        for (let py = 0; py < tileH; py++) {
          const vy = Math.min(gridY - 1, Math.floor((py / tileH) * gridY));
          const srcY = baseY + py;
          const rowStart = (srcY * atlasW + baseX) * 4;
          for (let px = 0; px < tileW; px++) {
            const pIdx = rowStart + px * 4;
            if (atlasPixels[pIdx + 3] === 0) continue;

            // Looking toward -Z: right (+px) is +X, so px = 0 is minX and px = tileW - 1 is maxX
            const vx = Math.max(0, Math.min(gridX - 1, px));
            anyHit = true;
            const idx3D = vx + gridX * (vy + gridY * vz);
            if (voxelSolid[idx3D] === 0) {
              voxelSolid[idx3D] = 1;
              const cOff = idx3D * 3;
              voxelRGB[cOff] = Math.max(1, atlasPixels[pIdx]);
              voxelRGB[cOff + 1] = Math.max(1, atlasPixels[pIdx + 1]);
              voxelRGB[cOff + 2] = Math.max(1, atlasPixels[pIdx + 2]);
            }
          }
        }
      }
    }
  } finally {
    renderer.setRenderTarget(prevRenderTarget);
    renderer.setScissorTest(prevScissorTest);
    renderer.setViewport(prevViewport);
    renderer.setScissor(prevScissor);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.toneMapping = prevToneMapping;
    renderer.autoClear = prevAutoClear;

    savedTexColorSpaces.forEach((cs, tex) => {
      tex.colorSpace = cs;
    });
    savedMeshMaterials.forEach((origMat, mesh) => {
      mesh.material = origMat;
    });
    for (let i = 0; i < tempMaterialsToDispose.length; i++) {
      tempMaterialsToDispose[i].dispose();
    }
    rt.dispose();
  }

  return anyHit;
}

/**
 * Software rasterizer fallback for a single top-down pass into colorBuffer and 16-bit heightBuffer.
 * Kept for backwards compatibility with existing unit tests.
 */
export function rasterizeGlbMeshesToBuffersSoftwareFallback(
  meshes: THREE.Mesh[],
  worldBox: THREE.Box3,
  res: number,
  colorBuffer: Uint8Array,
  heightBuffer: Uint8Array,
): void {
  const spanX = Math.max(1e-5, worldBox.max.x - worldBox.min.x);
  const spanY = Math.max(1e-5, worldBox.max.y - worldBox.min.y);
  const spanZ = Math.max(1e-5, worldBox.max.z - worldBox.min.z);
  const maxSpanXZ = Math.max(spanX, spanZ);
  const halfSpanXZ = maxSpanXZ * 0.5;
  const centerX = (worldBox.min.x + worldBox.max.x) * 0.5;
  const centerZ = (worldBox.min.z + worldBox.max.z) * 0.5;
  const minX = centerX - halfSpanXZ;
  const minZ = centerZ - halfSpanXZ;
  const minY = worldBox.min.y;

  const depthGrid = new Float32Array(res * res).fill(-Infinity);
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  for (let m = 0; m < meshes.length; m++) {
    const mesh = meshes[m];
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    const colAttr = geom.attributes.color;
    const index = geom.index;

    const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const stdMat = rawMat as (THREE.MeshStandardMaterial & { color?: THREE.Color }) | undefined;
    const matR = stdMat?.color ? stdMat.color.r : 1.0;
    const matG = stdMat?.color ? stdMat.color.g : 1.0;
    const matB = stdMat?.color ? stdMat.color.b : 1.0;

    const triCount = index ? index.count / 3 : posAttr.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

      vA.fromBufferAttribute(posAttr, i0).applyMatrix4(mesh.matrixWorld);
      vB.fromBufferAttribute(posAttr, i1).applyMatrix4(mesh.matrixWorld);
      vC.fromBufferAttribute(posAttr, i2).applyMatrix4(mesh.matrixWorld);

      const gx0 = ((vA.x - minX) / maxSpanXZ) * res;
      const gz0 = ((vA.z - minZ) / maxSpanXZ) * res;
      const gx1 = ((vB.x - minX) / maxSpanXZ) * res;
      const gz1 = ((vB.z - minZ) / maxSpanXZ) * res;
      const gx2 = ((vC.x - minX) / maxSpanXZ) * res;
      const gz2 = ((vC.z - minZ) / maxSpanXZ) * res;

      const minVX = Math.max(0, Math.floor(Math.min(gx0, gx1, gx2)));
      const maxVX = Math.min(res - 1, Math.floor(Math.max(gx0, gx1, gx2)));
      const minVZ = Math.max(0, Math.floor(Math.min(gz0, gz1, gz2)));
      const maxVZ = Math.min(res - 1, Math.floor(Math.max(gz0, gz1, gz2)));

      const denom = (gz1 - gz2) * (gx0 - gx2) + (gx2 - gx1) * (gz0 - gz2);
      if (Math.abs(denom) < 1e-8) continue;

      for (let vz = minVZ; vz <= maxVZ; vz++) {
        const pz = vz + 0.5;
        for (let vx = minVX; vx <= maxVX; vx++) {
          const px = vx + 0.5;
          const w0 = ((gz1 - gz2) * (px - gx2) + (gx2 - gx1) * (pz - gz2)) / denom;
          const w1 = ((gz2 - gz0) * (px - gx2) + (gx0 - gx2) * (pz - gz2)) / denom;
          const w2 = 1.0 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;

          const wy = w0 * vA.y + w1 * vB.y + w2 * vC.y;
          const cellIdx = vx + vz * res;
          if (wy <= depthGrid[cellIdx]) continue;
          depthGrid[cellIdx] = wy;

          let r = matR;
          let g = matG;
          let b = matB;
          if (colAttr) {
            r *= w0 * colAttr.getX(i0) + w1 * colAttr.getX(i1) + w2 * colAttr.getX(i2);
            g *= w0 * colAttr.getY(i0) + w1 * colAttr.getY(i1) + w2 * colAttr.getY(i2);
            b *= w0 * colAttr.getZ(i0) + w1 * colAttr.getZ(i1) + w2 * colAttr.getZ(i2);
          }

          const pIdx = cellIdx * 4;
          colorBuffer[pIdx] = Math.max(1, Math.min(255, Math.round(r * 255)));
          colorBuffer[pIdx + 1] = Math.max(1, Math.min(255, Math.round(g * 255)));
          colorBuffer[pIdx + 2] = Math.max(1, Math.min(255, Math.round(b * 255)));
          colorBuffer[pIdx + 3] = 255;

          const normH = Math.max(0, Math.min(1, (wy - minY) / spanY));
          const [hi, lo] = encodeElevation16Bit(normH);
          heightBuffer[pIdx] = hi;
          heightBuffer[pIdx + 1] = lo;
          heightBuffer[pIdx + 2] = 0;
          heightBuffer[pIdx + 3] = 255;
        }
      }
    }
  }
}

/**
 * Decodes GPU Pass 1 (colorBuffer) & Pass 2 (16-bit heightBuffer) into high-precision micro-voxel columns.
 * Kept for backwards compatibility with existing unit tests.
 */
export function decodeGpuRasterBuffers(
  colorBuffer: Uint8Array,
  heightBuffer: Uint8Array,
  res: number,
  maxVoxelHeight: number,
  baseOffsetVY: number = WATER_VY + 2,
): {
  voxels: Array<[number, number, number, number, number, number, number]>;
  footprintMask: Uint8Array;
  topVYGrid: Int16Array;
  colorGridRGB: Uint8Array;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  baseOffsetVY: number;
} {
  const totalCells = res * res;
  const footprintMask = new Uint8Array(totalCells);
  const topVYGrid = new Int16Array(totalCells).fill(-999);
  const colorGridRGB = new Uint8Array(totalCells * 3);
  const clampedMaxH = Math.max(1, Math.min(CHUNK_Y - 2 - baseOffsetVY, Math.round(maxVoxelHeight)));

  for (let vz = 0; vz < res; vz++) {
    const rowOff = vz * res;
    for (let vx = 0; vx < res; vx++) {
      const cellIdx = rowOff + vx;
      const idx = cellIdx << 2;
      const alpha = colorBuffer[idx + 3] | heightBuffer[idx + 3];
      if (alpha === 0) continue;

      footprintMask[cellIdx] = 1;
      const normH = decodeElevation16Bit(heightBuffer[idx], heightBuffer[idx + 1]);
      const relVY = Math.round(normH * clampedMaxH);
      const topVY = baseOffsetVY + relVY;
      topVYGrid[cellIdx] = topVY;

      const rByte = Math.max(1, colorBuffer[idx]);
      const gByte = Math.max(1, colorBuffer[idx + 1]);
      const bByte = Math.max(1, colorBuffer[idx + 2]);
      const cOff = cellIdx * 3;
      colorGridRGB[cOff] = rByte;
      colorGridRGB[cOff + 1] = gByte;
      colorGridRGB[cOff + 2] = bByte;
    }
  }

  const voxels: Array<[number, number, number, number, number, number, number]> = [];
  let maxRelY = 1;

  for (let vz = 0; vz < res; vz++) {
    const rowOff = vz * res;
    for (let vx = 0; vx < res; vx++) {
      const cellIdx = rowOff + vx;
      if (footprintMask[cellIdx] === 0) continue;

      const topVY = topVYGrid[cellIdx];
      const relTopY = Math.max(0, topVY - baseOffsetVY);
      if (relTopY + 1 > maxRelY) maxRelY = relTopY + 1;

      let minNeighborVY = topVY;
      if (vx > 0) {
        const nVY = topVYGrid[cellIdx - 1];
        minNeighborVY = Math.min(minNeighborVY, nVY !== -999 ? nVY : baseOffsetVY);
      }
      if (vx < res - 1) {
        const nVY = topVYGrid[cellIdx + 1];
        minNeighborVY = Math.min(minNeighborVY, nVY !== -999 ? nVY : baseOffsetVY);
      }
      if (vz > 0) {
        const nVY = topVYGrid[cellIdx - res];
        minNeighborVY = Math.min(minNeighborVY, nVY !== -999 ? nVY : baseOffsetVY);
      }
      if (vz < res - 1) {
        const nVY = topVYGrid[cellIdx + res];
        minNeighborVY = Math.min(minNeighborVY, nVY !== -999 ? nVY : baseOffsetVY);
      }

      const cOff = cellIdx * 3;
      const rByte = colorGridRGB[cOff];
      const gByte = colorGridRGB[cOff + 1];
      const bByte = colorGridRGB[cOff + 2];

      const slopeDelta = topVY - minNeighborVY;
      const mat = classifyPhysicalLandMaterial(
        { r: rByte / 255, g: gByte / 255, b: bByte / 255 },
        slopeDelta,
      );

      const stitchBottomVY = Math.max(baseOffsetVY, Math.min(topVY, minNeighborVY));
      for (let vy = topVY; vy >= stitchBottomVY; vy--) {
        voxels.push([vx, vy - baseOffsetVY, vz, mat, rByte, gByte, bByte]);
      }
    }
  }

  return {
    voxels,
    footprintMask,
    topVYGrid,
    colorGridRGB,
    sizeX: res,
    sizeY: Math.max(1, maxRelY),
    sizeZ: res,
    baseOffsetVY,
  };
}

/**
 * True 3D Volumetric GPU CT-Slicer (`voxelizeGlbSceneWithGpu`):
 * 1. Computes proportional 3D grid dimensions: `gridX = res`, `gridZ = res`, `gridY = Math.ceil((sizeY / Math.max(sizeX, sizeZ)) * res)`.
 * 2. Allocates true 3D volumetric arrays:
 *    - `voxelSolid = new Uint8Array(gridX * gridY * gridZ)` (`0 = air/gap`, `1 = surface voxel`, `2 = solid interior`)
 *    - `voxelRGB = new Uint8Array(gridX * gridY * gridZ * 3)` (exact 3D RGB color per voxel)
 * 3. Executes the GPU Y-Slice Loop (and X/Z vertical wall slices) using `camera.near` and `camera.far` hardware clipping planes.
 * 4. Applies True 3D Parity Infill (`applyTrue3DParityInfill`) so 3D overhangs, bridges, caves, and valleys remain 100% open air (`voxelSolid = 0`)
 *    while adding a 2-voxel structural crust beneath overhangs and filling solid bedrock (`voxelSolid = 2`) only below the lowest surface hit (`lowestVY`).
 */
export function voxelizeGlbSceneWithGpu(
  gltfScene: THREE.Object3D,
  targetResolution = DEFAULT_GLB_RESOLUTION,
  renderer?: THREE.WebGLRenderer | null,
  onProgress?: GlbVoxelizerProgressCallback,
  onVoxelBatch?: GlbVoxelizerBatchCallback,
): {
  voxels: Array<[number, number, number, number, number, number, number]>;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  voxelHeightRange: number;
  voxelSolid: Uint8Array;
  voxelRGB: Uint8Array;
  colorBuffer: Uint8Array;
  heightBuffer: Uint8Array;
  footprintMask: Uint8Array;
  elapsedMs: number;
} {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const res = Math.max(16, Math.min(256, Math.round(targetResolution || DEFAULT_GLB_RESOLUTION)));

  onProgress?.(15, `Normalizing 3D world bounds & forcing DoubleSide (${res}×${res})...`);
  const { worldBox, meshes } = prepareGlbSceneForGpuRaster(gltfScene);

  const emptyColorBuffer = new Uint8Array(res * res * 4);
  const emptyHeightBuffer = new Uint8Array(res * res * 4);

  if (worldBox.isEmpty() || meshes.length === 0) {
    return {
      voxels: [],
      sizeX: 0,
      sizeY: 0,
      sizeZ: 0,
      gridX: 0,
      gridY: 0,
      gridZ: 0,
      voxelHeightRange: 0,
      voxelSolid: new Uint8Array(0),
      voxelRGB: new Uint8Array(0),
      colorBuffer: emptyColorBuffer,
      heightBuffer: emptyHeightBuffer,
      footprintMask: new Uint8Array(0),
      elapsedMs: 0,
    };
  }

  const baseOffsetVY = WATER_VY + 2;
  const maxAllowedGridY = Math.max(2, CHUNK_Y - 3 - baseOffsetVY);
  const prop = computeProportionalVoxelDimensions(worldBox.min, worldBox.max, res);
  const gridX = prop.gridX;
  const gridZ = prop.gridZ;
  const gridY = Math.max(1, Math.min(maxAllowedGridY, prop.gridY));
  const voxelHeightRange = Math.max(1, Math.min(maxAllowedGridY, prop.voxelHeightRange));

  const totalVoxels3D = gridX * gridY * gridZ;
  const voxelSolid = new Uint8Array(totalVoxels3D);
  const voxelRGB = new Uint8Array(totalVoxels3D * 3);

  let gpuSliced = false;
  if (renderer) {
    gpuSliced = ctSliceSceneWithGpu(
      gltfScene,
      meshes,
      worldBox,
      gridX,
      gridY,
      gridZ,
      renderer,
      voxelSolid,
      voxelRGB,
      onProgress,
    );
  }

  if (!gpuSliced) {
    ctSliceMeshesSoftwareFallback(
      meshes,
      worldBox,
      gridX,
      gridY,
      gridZ,
      voxelSolid,
      voxelRGB,
    );
  }

  // Only hide reference GLB meshes after the 3D CT-slice buffers are fully extracted
  for (let i = 0; i < meshes.length; i++) {
    meshes[i].visible = false;
  }
  gltfScene.visible = false;

  onProgress?.(88, 'Applying 3D parity infill (preserving overhangs/tunnels & filling bedrock)...');
  const { footprintMask, highestSurfaceVY } = applyTrue3DParityInfill(
    voxelSolid,
    voxelRGB,
    gridX,
    gridY,
    gridZ,
  );

  // Extract surface shell voxels (voxelSolid === 1) into the tuple list for world loading & IndexedDB persistence
  const voxels: Array<[number, number, number, number, number, number, number]> = [];
  for (let vz = 0; vz < gridZ; vz++) {
    for (let vx = 0; vx < gridX; vx++) {
      const colIdx = vx + vz * gridX;
      if (footprintMask[colIdx] === 0) continue;
      const topVY = highestSurfaceVY[colIdx];

      for (let vy = 0; vy < gridY; vy++) {
        const idx3D = vx + gridX * (vy + gridY * vz);
        if (voxelSolid[idx3D] !== 1) continue;

        const cOff = idx3D * 3;
        const rByte = voxelRGB[cOff] || 128;
        const gByte = voxelRGB[cOff + 1] || 128;
        const bByte = voxelRGB[cOff + 2] || 128;
        const isWallOrSub = vy < topVY - 1;
        const mat = classifyPhysicalLandMaterial(
          { r: rByte / 255, g: gByte / 255, b: bByte / 255 },
          isWallOrSub ? 3 : 0,
        );
        voxels.push([vx, vy, vz, mat, rByte, gByte, bByte]);
      }
    }
  }

  if (onVoxelBatch && voxels.length > 0) {
    onVoxelBatch(voxels, true);
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const elapsedMs = Math.max(1, Math.round(t1 - t0));
  onProgress?.(
    100,
    `3D CT-Slicer Voxelized ${voxels.length.toLocaleString()} shell micro-voxels (${gridX}×${gridY}×${gridZ}) in ${elapsedMs}ms!`,
  );

  return {
    voxels,
    sizeX: gridX,
    sizeY: gridY,
    sizeZ: gridZ,
    gridX,
    gridY,
    gridZ,
    voxelHeightRange,
    voxelSolid,
    voxelRGB,
    colorBuffer: emptyColorBuffer,
    heightBuffer: emptyHeightBuffer,
    footprintMask,
    elapsedMs,
  };
}

/**
 * Loads a .GLB / .GLTF file or URL and executes True 3D Volumetric GPU CT-Slicing.
 */
export async function voxelizeGlbFile(
  fileOrUrl: File | string,
  targetResolution = DEFAULT_GLB_RESOLUTION,
  renderer?: THREE.WebGLRenderer | null,
  onProgress?: GlbVoxelizerProgressCallback,
  onVoxelBatch?: GlbVoxelizerBatchCallback,
): Promise<{
  voxels: Array<[number, number, number, number, number, number, number]>;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  gridX?: number;
  gridY?: number;
  gridZ?: number;
  voxelHeightRange?: number;
  voxelSolid?: Uint8Array;
  voxelRGB?: Uint8Array;
  colorBuffer?: Uint8Array;
  heightBuffer?: Uint8Array;
  footprintMask?: Uint8Array;
  elapsedMs?: number;
}> {
  const clampedRes = Math.max(16, Math.min(256, Math.round(targetResolution || DEFAULT_GLB_RESOLUTION)));
  onProgress?.(5, 'Loading 3D .GLB / .GLTF model...');

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(dracoLoader);

  let objectUrlToRevoke: string | null = null;
  const url =
    typeof fileOrUrl === 'string'
      ? fileOrUrl
      : (objectUrlToRevoke = URL.createObjectURL(fileOrUrl));

  try {
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.load(
        url,
        (loaded) => resolve(loaded),
        (evt) => {
          if (evt && evt.total > 0) {
            const loadPct = Math.min(22, Math.round((evt.loaded / evt.total) * 18) + 5);
            onProgress?.(loadPct, `Loading 3D mesh data (${loadPct}%)...`);
          }
        },
        (err) => reject(err),
      );
    });

    const root: THREE.Object3D | undefined = gltf.scene || gltf.scenes?.[0];
    if (!root) {
      return { voxels: [], sizeX: 0, sizeY: 0, sizeZ: 0 };
    }

    const result = voxelizeGlbSceneWithGpu(
      root,
      clampedRes,
      renderer,
      onProgress,
      onVoxelBatch,
    );

    // Dispose temporary GLTF geometries, materials, and embedded GPU textures after CT-slice extraction is complete
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
          const anyMat = m as any;
          for (const texKey of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
            if (anyMat[texKey] && typeof anyMat[texKey].dispose === 'function') {
              anyMat[texKey].dispose();
            }
          }
          m.dispose?.();
        }
      }
    });

    return result;
  } finally {
    dracoLoader.dispose();
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}

export const voxelizeGlbModel = voxelizeGlbFile;
