import * as THREE from 'three';
import {
  VOXEL_SIZE,
  SYMMETRY_CENTER_X,
  type ModuleKind,
} from './constants.ts';
import type { ActiveModule } from './vehicle.ts';
import { LED_PATTERNS, type LedMatrixIcon } from './logicSystem.ts';
import {
  getMicroVoxelBlockTemplate,
  getMicroVoxelBlockMaterial,
  getMicroVoxelWheelRollGeometry,
  type MicroVoxelBlockKind,
} from './microVoxelBlocks.ts';

// ============================================================================
// 1. UNIFIED PALETTE & SPECIALIZED MATERIAL DEFINITIONS
// ============================================================================

/**
 * Creates a shared 256x256 color swatch texture containing distinct mechanical zones:
 * - Matte rubber charcoal
 * - Machined metal, chassis slate, chrome
 * - Emissive neon orange (0xff6600), cyan, red
 * - Caution hazard stripes
 */
let _sharedPaletteTexture: THREE.CanvasTexture | null = null;

export function getSharedPaletteTexture(): THREE.Texture {
  if (_sharedPaletteTexture) return _sharedPaletteTexture;
  if (typeof document === 'undefined') {
    return new THREE.Texture();
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Fill base charcoal
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, 256, 256);

    // Quad 1: Metals
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(0, 64, 128, 64);

    // Quad 2: Bright accents & hazard
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(128, 0, 128, 64);
    // Diagonal hazard stripes in sub-region
    ctx.save();
    ctx.beginPath();
    ctx.rect(128, 0, 128, 64);
    ctx.clip();
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 14;
    for (let x = 110; x < 280; x += 28) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 40, 64);
    }
    ctx.stroke();
    ctx.restore();

    // Quad 3: Emissives (Rocket Orange 0xff6600, Cyan, Taillight Red)
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(128, 64, 64, 64);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(192, 64, 64, 64);

    // Quad 4: Dark Rubber & Carbon
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 128, 128, 128);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(128, 128, 128, 128);
  }

  _sharedPaletteTexture = new THREE.CanvasTexture(canvas);
  _sharedPaletteTexture.colorSpace = THREE.SRGBColorSpace;
  _sharedPaletteTexture.minFilter = THREE.NearestFilter;
  _sharedPaletteTexture.magFilter = THREE.NearestFilter;
  return _sharedPaletteTexture;
}

const _modelMatCache = new Map<string, THREE.Material>();

// Pre-cached materials and geometry for Micro:bit 5x5 dynamic LED matrix
const _ledOffMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.85,
  metalness: 0.15,
});
const _ledRedMat = new THREE.MeshBasicMaterial({
  color: 0xef4444,
});
const _ledCyanMat = new THREE.MeshBasicMaterial({
  color: 0x00f5ff,
});
const _sharedLedDotGeo = new THREE.BoxGeometry(0.040, 0.02, 0.040);

/**
 * Updates the 5x5 LED matrix on a Micro:bit ECU module mesh dynamically at 60Hz with zero memory allocation.
 */
export function updateEcuLedMatrixDisplay(root: THREE.Object3D | null | undefined, icon: LedMatrixIcon): void {
  if (!root || !root.userData) return;
  const dots = root.userData.ledMatrixDots as THREE.Mesh[] | undefined;
  if (!dots || dots.length !== 25) return;
  if (root.userData.currentLedIcon === icon) return;
  root.userData.currentLedIcon = icon;

  const pattern = LED_PATTERNS[icon] || LED_PATTERNS.OFF;
  const isErr = icon === 'ERROR_X';
  const litMat = isErr ? _ledRedMat : _ledCyanMat;

  for (let i = 0; i < 25; i++) {
    const isLit = pattern[i] === 1;
    dots[i].material = isLit ? litMat : _ledOffMat;
  }
}

/**
 * Matte Rubber: Low roughness, dark charcoal for tires (solid PBR without UV texture blotches).
 */
export function getMatteRubberMat(isGhost = false, isCharred = false): THREE.Material {
  const key = `rubber:${isGhost ? 1 : 0}:${isCharred ? 1 : 0}`;
  let mat = _modelMatCache.get(key);
  if (mat) return mat;

  if (isGhost) {
    mat = new THREE.MeshBasicMaterial({
      color: 0x18181b,
      transparent: true,
      opacity: 0.5,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: isCharred ? 0x09090b : 0x1c1917,
      roughness: 0.92,
      metalness: 0.08,
    });
  }
  _modelMatCache.set(key, mat);
  return mat;
}

/**
 * Machined Metal: Slightly reflective, medium roughness for chassis frames,
 * shock springs, engine blocks, and hardware (clean solid PBR).
 */
export function getMachinedMetalMat(
  hex: number,
  roughness = 0.38,
  metalness = 0.65,
  isGhost = false,
  isCharred = false,
): THREE.Material {
  const key = `metal:${hex.toString(16)}:${roughness}:${metalness}:${isGhost ? 1 : 0}:${isCharred ? 1 : 0}`;
  let mat = _modelMatCache.get(key);
  if (mat) return mat;

  if (isGhost) {
    mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.52,
    });
  } else {
    const col = new THREE.Color(hex);
    if (isCharred) col.multiplyScalar(0.42);
    mat = new THREE.MeshStandardMaterial({
      color: col,
      roughness,
      metalness,
    });
  }
  _modelMatCache.set(key, mat);
  return mat;
}

/**
 * Emissive Neon: Bright self-illuminated accents for headlights, taillights,
 * cockpit displays, and thruster cores (e.g. emissive: 0xff6600, emissiveIntensity: 2.0).
 */
export function getEmissiveNeonMat(
  hex: number,
  intensity = 2.0,
  isGhost = false,
  isCharred = false,
): THREE.Material {
  const key = `neon:${hex.toString(16)}:${intensity}:${isGhost ? 1 : 0}:${isCharred ? 1 : 0}`;
  let mat = _modelMatCache.get(key);
  if (mat) return mat;

  if (isGhost) {
    mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.7,
    });
  } else {
    const col = new THREE.Color(hex);
    if (isCharred) col.multiplyScalar(0.5);
    mat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: intensity,
      roughness: 0.2,
      metalness: 0.1,
    });
  }
  _modelMatCache.set(key, mat);
  return mat;
}

/**
 * Translucent Cockpit Glass: Opacity 0.6, high smoothness for cabin windshields and sensor domes.
 */
export function getCockpitGlassMat(
  hex = 0x38bdf8,
  opacity = 0.6,
  isGhost = false,
): THREE.Material {
  const key = `glass:${hex.toString(16)}:${opacity}:${isGhost ? 1 : 0}`;
  let mat = _modelMatCache.get(key);
  if (mat) return mat;

  mat = new THREE.MeshPhongMaterial({
    color: hex,
    specular: 0xe0f2fe,
    shininess: 110,
    transparent: true,
    opacity: isGhost ? opacity * 0.6 : opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  _modelMatCache.set(key, mat);
  return mat;
}

// ============================================================================
// 1B. SHARED BUFFERGEOMETRY PRIMITIVE CACHE & SHADOW/MATRIX CULLING
// ============================================================================

const _sharedPrimitiveGeoCache = new Map<string, THREE.BufferGeometry>();

export function getCachedBoxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `box:${w.toFixed(4)}:${h.toFixed(4)}:${d.toFixed(4)}`;
  let geo = _sharedPrimitiveGeoCache.get(key) as THREE.BoxGeometry | undefined;
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d);
    geo.computeBoundingSphere();
    geo.userData.isSharedPrimitive = true;
    geo.userData.cacheKey = key;
    _sharedPrimitiveGeoCache.set(key, geo);
  }
  return geo;
}

export function getCachedCylGeo(
  rt: number,
  rb: number,
  h: number,
  segs = 10,
  hSegs = 1,
  openEnded = false,
  rotAxis?: 'x' | 'z',
): THREE.CylinderGeometry {
  const key = `cyl:${rt.toFixed(4)}:${rb.toFixed(4)}:${h.toFixed(4)}:${segs}:${hSegs}:${openEnded ? 1 : 0}:${rotAxis || 'y'}`;
  let geo = _sharedPrimitiveGeoCache.get(key) as THREE.CylinderGeometry | undefined;
  if (!geo) {
    geo = new THREE.CylinderGeometry(rt, rb, h, segs, hSegs, openEnded);
    if (rotAxis === 'x') geo.rotateX(Math.PI / 2);
    else if (rotAxis === 'z') geo.rotateZ(Math.PI / 2);
    geo.computeBoundingSphere();
    geo.userData.isSharedPrimitive = true;
    geo.userData.cacheKey = key;
    _sharedPrimitiveGeoCache.set(key, geo);
  }
  return geo;
}

export function getCachedConeGeo(
  r: number,
  h: number,
  segs = 10,
  rotAxis?: 'x' | '-x',
): THREE.ConeGeometry {
  const key = `cone:${r.toFixed(4)}:${h.toFixed(4)}:${segs}:${rotAxis || 'y'}`;
  let geo = _sharedPrimitiveGeoCache.get(key) as THREE.ConeGeometry | undefined;
  if (!geo) {
    geo = new THREE.ConeGeometry(r, h, segs);
    if (rotAxis === 'x') geo.rotateX(Math.PI / 2);
    else if (rotAxis === '-x') geo.rotateX(-Math.PI / 2);
    geo.computeBoundingSphere();
    geo.userData.isSharedPrimitive = true;
    geo.userData.cacheKey = key;
    _sharedPrimitiveGeoCache.set(key, geo);
  }
  return geo;
}

export function getCachedSphereGeo(
  r: number,
  wSegs = 10,
  hSegs = 10,
): THREE.SphereGeometry {
  const key = `sph:${r.toFixed(4)}:${wSegs}:${hSegs}`;
  let geo = _sharedPrimitiveGeoCache.get(key) as THREE.SphereGeometry | undefined;
  if (!geo) {
    geo = new THREE.SphereGeometry(r, wSegs, hSegs);
    geo.computeBoundingSphere();
    geo.userData.isSharedPrimitive = true;
    geo.userData.cacheKey = key;
    _sharedPrimitiveGeoCache.set(key, geo);
  }
  return geo;
}

export function getCachedTorusGeo(
  r: number,
  tube: number,
  rSegs = 8,
  tSegs = 12,
  arc = Math.PI * 2,
): THREE.TorusGeometry {
  const key = `tor:${r.toFixed(4)}:${tube.toFixed(4)}:${rSegs}:${tSegs}:${arc.toFixed(3)}`;
  let geo = _sharedPrimitiveGeoCache.get(key) as THREE.TorusGeometry | undefined;
  if (!geo) {
    geo = new THREE.TorusGeometry(r, tube, rSegs, tSegs, arc);
    geo.computeBoundingSphere();
    geo.userData.isSharedPrimitive = true;
    geo.userData.cacheKey = key;
    _sharedPrimitiveGeoCache.set(key, geo);
  }
  return geo;
}

const _sharedMergedGeoCache = new Map<string, THREE.BufferGeometry>();
let _sharedMergedStaticMat: THREE.MeshStandardMaterial | null = null;

function getSharedMergedStaticMat(): THREE.MeshStandardMaterial {
  if (!_sharedMergedStaticMat) {
    _sharedMergedStaticMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.44,
      metalness: 0.45,
    });
  }
  return _sharedMergedStaticMat;
}

export function getSharedGeoCacheSize(): number {
  return _sharedPrimitiveGeoCache.size + _sharedMergedGeoCache.size;
}

/**
 * Disposes all shared procedural module geometries, merged geometries, materials,
 * and cached palette textures on full scene teardown.
 */
export function disposeSharedModelCaches(): void {
  if (_sharedPaletteTexture) {
    _sharedPaletteTexture.dispose();
    _sharedPaletteTexture = null;
  }
  for (const mat of _modelMatCache.values()) {
    mat.dispose();
  }
  _modelMatCache.clear();
  if (_sharedMergedStaticMat) {
    _sharedMergedStaticMat.dispose();
    _sharedMergedStaticMat = null;
  }
  for (const geo of _sharedPrimitiveGeoCache.values()) {
    geo.dispose();
  }
  _sharedPrimitiveGeoCache.clear();
  for (const geo of _sharedMergedGeoCache.values()) {
    geo.dispose();
  }
  _sharedMergedGeoCache.clear();
  _ledOffMat.dispose();
  _ledRedMat.dispose();
  _ledCyanMat.dispose();
  _sharedLedDotGeo.dispose();
}

const _mergePos = new THREE.Vector3();
const _mergeNrm = new THREE.Vector3();
const _mergeNormalMat = new THREE.Matrix3();
const _mergeRelMat = new THREE.Matrix4();

function isMergeableOpaqueStaticMesh(
  obj: THREE.Object3D,
  skip?: Set<THREE.Object3D>,
): obj is THREE.Mesh {
  if (!(obj instanceof THREE.Mesh)) return false;
  if (obj instanceof THREE.InstancedMesh) return false;
  if (skip?.has(obj)) return false;
  if (obj.children.length > 0) return false;
  if (!obj.geometry) return false;
  const posAttr = obj.geometry.getAttribute('position');
  const nrmAttr = obj.geometry.getAttribute('normal');
  if (!posAttr || !nrmAttr || posAttr.count === 0) return false;

  const mat = obj.material as THREE.Material & {
    transparent?: boolean;
    wireframe?: boolean;
    opacity?: number;
    map?: THREE.Texture | null;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };
  if (!mat || Array.isArray(mat)) return false;
  if (mat.transparent || mat.wireframe) return false;
  if (mat.opacity !== undefined && mat.opacity < 0.99) return false;
  if (mat.map) return false;
  if (
    mat.emissive &&
    (mat.emissiveIntensity ?? 1) > 0 &&
    (mat.emissive.r > 0.001 || mat.emissive.g > 0.001 || mat.emissive.b > 0.001)
  ) {
    return false;
  }
  return true;
}

/**
 * Merges all static opaque child meshes under `group` (skipping animated/referenced sub-trees in `skip`)
 * into a single vertex-colored Mesh with cached BufferGeometry, slashing draw calls 5x–13x per module.
 */
export function mergeStaticMeshesInGroup(
  group: THREE.Object3D,
  skip?: Set<THREE.Object3D>,
): THREE.Mesh | null {
  interface MergeCandidate {
    mesh: THREE.Mesh;
    relMatrix: THREE.Matrix4;
    r: number;
    g: number;
    b: number;
    sig: string;
  }

  const candidates: MergeCandidate[] = [];
  const candidateAncestors = new Set<THREE.Object3D>();

  const collect = (parent: THREE.Object3D, parentRelMat: THREE.Matrix4 | null) => {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (skip?.has(child)) continue;

      child.updateMatrix();
      const childRelMat = parentRelMat
        ? new THREE.Matrix4().multiplyMatrices(parentRelMat, child.matrix)
        : child.matrix.clone();

      if (isMergeableOpaqueStaticMesh(child, skip)) {
        const mat = child.material as THREE.Material & { color?: THREE.Color };
        const r = mat.color ? mat.color.r : 1;
        const g = mat.color ? mat.color.g : 1;
        const b = mat.color ? mat.color.b : 1;

        const geo = child.geometry as THREE.BufferGeometry & {
          parameters?: Record<string, unknown>;
        };
        const geoSig = geo.userData?.cacheKey
          ? String(geo.userData.cacheKey)
          : geo.parameters
            ? `${geo.type}:${JSON.stringify(geo.parameters)}`
            : `${geo.type}:${geo.getAttribute('position')?.count ?? 0}:${geo.index?.count ?? 0}`;
        const e = childRelMat.elements;
        // Quantize matrix + color for deterministic deduplication across identical modules
        const mSig =
          `${Math.round(e[0] * 1000)},${Math.round(e[1] * 1000)},${Math.round(e[2] * 1000)},` +
          `${Math.round(e[4] * 1000)},${Math.round(e[5] * 1000)},${Math.round(e[6] * 1000)},` +
          `${Math.round(e[8] * 1000)},${Math.round(e[9] * 1000)},${Math.round(e[10] * 1000)},` +
          `${Math.round(e[12] * 1000)},${Math.round(e[13] * 1000)},${Math.round(e[14] * 1000)}`;
        const cSig = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;

        candidates.push({
          mesh: child,
          relMatrix: childRelMat,
          r,
          g,
          b,
          sig: `${geoSig}|${cSig}|${mSig}`,
        });
        if (parent !== group) {
          candidateAncestors.add(parent);
        }
      } else if (child instanceof THREE.Group || child.type === 'Object3D') {
        collect(child, childRelMat);
      }
    }
  };

  collect(group, null);
  if (candidates.length < 2) return null;

  const cacheKey = candidates.map((c) => c.sig).join(';');
  let mergedGeo = _sharedMergedGeoCache.get(cacheKey);

  if (!mergedGeo) {
    let totalVerts = 0;
    let totalIndices = 0;
    for (let i = 0; i < candidates.length; i++) {
      const geo = candidates[i].mesh.geometry;
      const posAttr = geo.getAttribute('position')!;
      totalVerts += posAttr.count;
      totalIndices += geo.index ? geo.index.count : posAttr.count;
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);
    const indices =
      totalVerts <= 65535
        ? new Uint16Array(totalIndices)
        : new Uint32Array(totalIndices);

    let vOffset = 0;
    let iOffset = 0;

    for (let i = 0; i < candidates.length; i++) {
      const { mesh, relMatrix, r, g, b } = candidates[i];
      const geo = mesh.geometry;
      const posAttr = geo.getAttribute('position')!;
      const nrmAttr = geo.getAttribute('normal')!;
      const colAttr = geo.getAttribute('color');
      const vCount = posAttr.count;

      _mergeRelMat.copy(relMatrix);
      _mergeNormalMat.getNormalMatrix(_mergeRelMat);

      for (let v = 0; v < vCount; v++) {
        _mergePos.set(posAttr.getX(v), posAttr.getY(v), posAttr.getZ(v)).applyMatrix4(_mergeRelMat);
        const dst3 = (vOffset + v) * 3;
        positions[dst3] = _mergePos.x;
        positions[dst3 + 1] = _mergePos.y;
        positions[dst3 + 2] = _mergePos.z;

        _mergeNrm.set(nrmAttr.getX(v), nrmAttr.getY(v), nrmAttr.getZ(v)).applyMatrix3(_mergeNormalMat).normalize();
        normals[dst3] = _mergeNrm.x;
        normals[dst3 + 1] = _mergeNrm.y;
        normals[dst3 + 2] = _mergeNrm.z;

        if (colAttr) {
          colors[dst3] = colAttr.getX(v) * r;
          colors[dst3 + 1] = colAttr.getY(v) * g;
          colors[dst3 + 2] = colAttr.getZ(v) * b;
        } else {
          colors[dst3] = r;
          colors[dst3 + 1] = g;
          colors[dst3 + 2] = b;
        }
      }

      if (geo.index) {
        const idxArr = geo.index.array;
        for (let k = 0; k < geo.index.count; k++) {
          indices[iOffset + k] = idxArr[k] + vOffset;
        }
        iOffset += geo.index.count;
      } else {
        for (let k = 0; k < vCount; k++) {
          indices[iOffset + k] = vOffset + k;
        }
        iOffset += vCount;
      }

      vOffset += vCount;
    }

    mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mergedGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    mergedGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    mergedGeo.setIndex(new THREE.BufferAttribute(indices, 1));
    mergedGeo.computeBoundingSphere();
    mergedGeo.userData.isSharedPrimitive = true;
    mergedGeo.userData.isMergedStatic = true;
    _sharedMergedGeoCache.set(cacheKey, mergedGeo);
  }

  // Remove original static meshes and dispose non-shared source geometries
  for (let i = 0; i < candidates.length; i++) {
    const mesh = candidates[i].mesh;
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    if (mesh.geometry && !mesh.geometry.userData?.isSharedPrimitive) {
      mesh.geometry.dispose();
    }
  }

  // Prune any intermediate static groups that are now empty
  for (const anc of candidateAncestors) {
    if (anc.children.length === 0 && anc.parent && !skip?.has(anc)) {
      anc.parent.remove(anc);
    }
  }

  const mergedMesh = new THREE.Mesh(mergedGeo, getSharedMergedStaticMat());
  mergedMesh.name = `${group.name || 'StaticGroup'}_Merged`;
  mergedMesh.frustumCulled = true;
  mergedMesh.castShadow = false;
  mergedMesh.receiveShadow = false;
  mergedMesh.matrixAutoUpdate = false;
  mergedMesh.updateMatrix();
  group.add(mergedMesh);
  return mergedMesh;
}

/**
 * Optimizes a generated module hierarchy:
 * - Merges static opaque sub-meshes into vertex-colored BufferGeometries (5x-13x draw-call reduction)
 * - Marks all child geometries as shared primitives in `_sharedPrimitiveGeoCache` so they are never leaked or redundantly allocated
 * - Disables `castShadow` on small sub-parts (lug bolts, springs, screens, trim)
 * - Enables `frustumCulled = true` on every mesh and sub-assembly
 * - Sets `matrixAutoUpdate = false` (calling `updateMatrix()` once) on static sub-meshes
 */
export function optimizeModuleMeshHierarchy(
  root: THREE.Group,
  mod?: ActiveModule,
): THREE.Group {
  const dynamicNodes = new Set<THREE.Object3D>();
  const skipForMerge = new Set<THREE.Object3D>();

  const registerDynamic = (node: unknown) => {
    if (node instanceof THREE.Object3D) {
      dynamicNodes.add(node);
      skipForMerge.add(node);
    }
  };

  registerDynamic(root.userData.steerPivot);
  registerDynamic(root.userData.rollGroup);
  registerDynamic(root.userData.propellerHub);
  registerDynamic(root.userData.flameCore);
  registerDynamic(root.userData.turretPivot);
  registerDynamic(root.userData.spinMesh);
  registerDynamic(root.userData.hookMesh);
  registerDynamic(root.userData.winchHookClaw);
  if (root.userData.nozzleBell instanceof THREE.Object3D) {
    skipForMerge.add(root.userData.nozzleBell);
  }
  if (root.userData.microVoxelMesh instanceof THREE.Object3D) {
    skipForMerge.add(root.userData.microVoxelMesh);
  }
  if (Array.isArray(root.userData.ledMatrixDots)) {
    for (const dot of root.userData.ledMatrixDots) {
      if (dot instanceof THREE.Object3D) skipForMerge.add(dot);
    }
  }
  if (mod) {
    registerDynamic(mod.wheelMesh);
    registerDynamic(mod.spinMesh);
    registerDynamic(mod.turretPivot);
  }

  // Merge static sub-meshes inside animated pivot sub-groups (while preserving nested pivots & propellerHub bladeGroups)
  for (const dynNode of dynamicNodes) {
    if (dynNode === root) continue;
    if (dynNode === root.userData.propellerHub) continue;
    if (dynNode instanceof THREE.Group) {
      mergeStaticMeshesInGroup(dynNode, skipForMerge);
    }
  }

  // Merge static sub-meshes on root (skipping animated/referenced sub-trees)
  mergeStaticMeshesInGroup(root, skipForMerge);

  root.frustumCulled = true;

  root.traverse((child) => {
    child.frustumCulled = true;
    if (child === root) return;
    if (child instanceof THREE.Mesh && child.geometry) {
      // Cache any inline primitive geometry by its constructor + parameters so repeat module spawns share the exact GPU buffer!
      const geo = child.geometry as THREE.BufferGeometry & {
        parameters?: Record<string, unknown>;
      };
      if (!geo.userData.isSharedPrimitive && geo.parameters) {
        const paramKey = `${geo.type}:${JSON.stringify(geo.parameters)}:${child.rotation.x.toFixed(2)},${child.rotation.y.toFixed(2)},${child.rotation.z.toFixed(2)}`;
        const existing = _sharedPrimitiveGeoCache.get(paramKey);
        if (existing && existing !== geo) {
          // Only swap if no geometry bake was applied
          if (!geo.userData.hasBakedTransform) {
            geo.dispose();
            child.geometry = existing;
          }
        } else {
          if (!geo.boundingSphere) geo.computeBoundingSphere();
          geo.userData.isSharedPrimitive = true;
          _sharedPrimitiveGeoCache.set(paramKey, geo);
        }
      } else {
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        geo.userData.isSharedPrimitive = true;
      }

      child.castShadow = false;
      child.receiveShadow = false;
    }

    if (!dynamicNodes.has(child)) {
      child.matrixAutoUpdate = false;
      child.updateMatrix();
    }
  });

  return root;
}

// ============================================================================
// 2. PROCEDURAL HIGH-DETAIL MESH GENERATORS
// ============================================================================

/**
 * Builds an All-Terrain Wheel with:
 * - Kingpin steering pivot directly at the wheel center `(sideOffset, -0.42, 0)` and `rollGroup` at `(0, 0, 0)`
 *   so wheels turn in place on their kingpin instead of swinging in a wide arc
 * - Steering knuckle and brake caliper attached to `steerPivot` (do not spin with tire)
 * - Outer-perimeter tread lugs that never clip through the inner alloy rim and spokes (zero Z-fighting)
 * - Double-wishbone suspension arms, coilover shock spring, & steering tie-rod
 */
export function createDetailedWheelMesh(
  mod: ActiveModule,
  isGhost = false,
  isCharred = false,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `WheelAssembly_${mod.kind}`;

  const k = mod.kind;
  const isSteer = k === 'WHEEL_STEER';
  const isMonster = k === 'WHEEL_MONSTER';
  const isKart = k === 'WHEEL_KART';
  const isDrag = k === 'WHEEL_DRAG';
  const isRacing = k === 'WHEEL_RACING';
  const isSpiked = k === 'WHEEL_SPIKED';

  const rad = isMonster ? 0.68 : isKart ? 0.32 : isDrag ? 0.56 : 0.48;
  const width = isMonster ? 0.62 : isDrag ? 0.64 : isKart ? 0.28 : 0.44;
  const rimColor = isSteer
    ? 0xf59e0b
    : isRacing
      ? 0xef4444
      : isMonster
        ? 0x84cc16
        : isKart
          ? 0x38bdf8
          : isSpiked
            ? 0x67e8f9
            : 0x10b981;

  const isCenter = mod.vx === SYMMETRY_CENTER_X || mod.vx === SYMMETRY_CENTER_X - 1;
  const isLeft = mod.vx < SYMMETRY_CENTER_X;
  const sideSign = isCenter ? 1 : isLeft ? -1 : 1;
  const sideOffset = isCenter ? 0 : sideSign * 0.34;

  const metalMat = getMachinedMetalMat(0x64748b, 0.35, 0.7, isGhost, isCharred);
  const darkMetalMat = getMachinedMetalMat(0x1e293b, 0.45, 0.6, isGhost, isCharred);
  const springMat = getMachinedMetalMat(rimColor, 0.3, 0.5, isGhost, isCharred);

  // --- Fixed Chassis Mount & Suspension Links (Stay mounted to vehicle body) ---
  const upperMount = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), darkMetalMat);
  upperMount.position.y = 0.05;
  root.add(upperMount);

  // Upper & Lower A-Arm Wishbone struts connecting chassis to steering knuckle
  for (const armY of [-0.04, -0.32]) {
    const wishbone = new THREE.Group();
    const rodF = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8), metalMat);
    rodF.rotation.z = sideSign * 0.52;
    rodF.position.set(sideOffset * 0.45, armY, 0.12);

    const rodR = rodF.clone();
    rodR.position.z = -0.12;
    wishbone.add(rodF, rodR);
    root.add(wishbone);
  }

  // Steering tie-rod bar
  const tieRod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), darkMetalMat);
  tieRod.rotation.z = sideSign * 0.48;
  tieRod.position.set(sideOffset * 0.45, -0.18, 0.18);
  root.add(tieRod);

  // Coilover shock spring & damper strut
  const shockBody = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.46, 8), metalMat);
  shockBody.position.set(sideOffset * 0.28, -0.2, 0);
  shockBody.rotation.z = sideSign * 0.22;

  // Helical appearance via segmented spring rings
  for (let s = 0; s < 5; s++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.02, 8, 12), springMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sideOffset * 0.28, -0.08 - s * 0.058, 0);
    ring.rotation.z = sideSign * 0.22;
    root.add(ring);
  }
  root.add(shockBody);

  // --- Steering Pivot Group (Positioned directly at wheel center so it turns in place on its kingpin) ---
  const steerPivot = new THREE.Group();
  steerPivot.name = 'SteerPivotGroup';
  steerPivot.position.set(sideOffset, -0.42, 0);

  // Steering Knuckle & Brake Caliper (Attached to steerPivot on inboard side, does NOT spin with tire)
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.16), darkMetalMat);
  knuckle.position.set(-sideSign * (width * 0.42), 0, 0);
  const brakeCaliper = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.16, 0.18),
    getMachinedMetalMat(0xef4444, 0.3, 0.4, isGhost, isCharred),
  );
  brakeCaliper.position.set(-sideSign * (width * 0.32), 0.1, 0.12);
  steerPivot.add(knuckle, brakeCaliper);

  // --- Wheel Roll Group (Centered at (0, 0, 0) inside steerPivot; rotates on X-axis for Wheel Spin) ---
  const rollGroup = new THREE.Group();
  rollGroup.name = 'WheelRollGroup';
  rollGroup.position.set(0, 0, 0);

  // High-detail 1px (0.0625m) greedy-meshed micro-voxel wheel (tread lugs, sidewalls, recessed alloy rim, 5 spokes & chrome hubcap in 1 draw call!)
  const wheelRollGeo = getMicroVoxelWheelRollGeometry(
    k,
    rad,
    width,
    rimColor,
    isSpiked,
  );
  const wheelRollMesh = new THREE.Mesh(
    wheelRollGeo,
    getMicroVoxelBlockMaterial(isGhost, isCharred),
  );
  wheelRollMesh.name = `MicroVoxelWheel_${k}`;
  wheelRollMesh.userData.isMicroVoxelBody = true;
  rollGroup.add(wheelRollMesh);

  steerPivot.add(rollGroup);
  root.add(steerPivot);

  // Tag nodes for hierarchical animation
  steerPivot.userData.rollGroup = rollGroup;
  root.userData.steerPivot = steerPivot;
  root.userData.rollGroup = rollGroup;
  if (!isGhost) {
    mod.wheelMesh = steerPivot;
  }

  return optimizeModuleMeshHierarchy(root, mod);
}

/**
 * Builds a Dragon Jet / Rocket Thruster with:
 * - Hexagonal/cylindrical multi-tiered heat shield outer casing
 * - Stepped converging-diverging exhaust bell nozzle
 * - Interior core with dedicated emissive material (emissive: 0xff6600, emissiveIntensity: 2.0)
 * - Dynamic thruster flame trail mesh tagged for scaling along thrust axis on boost
 */
export function createDetailedThrusterMesh(
  mod: ActiveModule,
  isGhost = false,
  isCharred = false,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Thruster_${mod.kind}`;

  const k = mod.kind as 'THRUSTER' | 'THRUSTER_MINI' | 'THRUSTER_ROCKET' | 'JET_RAW' | 'JET_GIMBAL';
  const isMini = k === 'THRUSTER_MINI';
  const isRaw = k === 'JET_RAW';
  const isRocket = k === 'THRUSTER_ROCKET';
  const isGimbal = k === 'JET_GIMBAL';
  const scale = isMini ? 0.68 : isRaw ? 1.2 : isRocket ? 1.12 : 1.0;

  const bodyGroup = new THREE.Group();
  const tpl = getMicroVoxelBlockTemplate(k);
  const bodyGeo =
    !isGhost && mod.microDamage?.damagedGeometry
      ? mod.microDamage.damagedGeometry
      : tpl.intactGeometry;
  const microBody = new THREE.Mesh(
    bodyGeo,
    getMicroVoxelBlockMaterial(isGhost, isCharred),
  );
  microBody.name = `MicroVoxel_${k}`;
  microBody.userData.isMicroVoxelBody = true;

  // Dynamic Thruster Flame Trail Mesh (Scales along thrust axis during Shift boost)
  const flameMesh = new THREE.Mesh(
    getCachedConeGeo(0.22 * scale, 0.68 * scale, 10),
    getEmissiveNeonMat(0xff7700, 2.4, isGhost, isCharred),
  );
  flameMesh.rotation.x = Math.PI; // Point backwards out of nozzle
  flameMesh.position.y = -0.82 * scale;
  flameMesh.scale.set(0.65, 0.55, 0.65); // Default idle plume
  flameMesh.name = 'FlameMesh';

  bodyGroup.add(microBody, flameMesh);

  if (!isGimbal) {
    bodyGroup.rotation.x = Math.PI / 2;
  }
  root.add(bodyGroup);

  // Expose flameCore, nozzleBell, and microVoxelMesh for boost scaling & CoW chipping
  root.userData.flameCore = flameMesh;
  root.userData.nozzleBell = microBody;
  root.userData.microVoxelMesh = microBody;
  root.userData.microVoxelKind = k;
  root.userData.baseScaleY = 0.55;

  return root;
}

/**
 * Builds an Outboard Marine Motor or Propeller Unit with:
 * - Detailed vertical drive shaft housing
 * - Anti-cavitation plate (horizontal planar foil)
 * - Aerodynamic torpedo gear-case bulb
 * - Separated isolated sub-mesh (`propellerHub`) with 3 angled, curved blades
 */
export function createDetailedOutboardMesh(
  mod: ActiveModule,
  isGhost = false,
  isCharred = false,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `MarineOutboard_${mod.kind}`;

  const k = mod.kind as 'BOAT_PROP' | 'BOAT_OUTBOARD' | 'PROP_AERO';
  const isAero = k === 'PROP_AERO';

  const darkMetalMat = getMachinedMetalMat(0x1e293b, 0.45, 0.6, isGhost, isCharred);
  const chromeMat = getMachinedMetalMat(0xe2e8f0, 0.15, 0.9, isGhost, isCharred);
  const bladeMat = getMachinedMetalMat(0xfacc15, 0.25, 0.75, isGhost, isCharred);

  // 1px micro-voxel destructible nacelle / outboard motor powerhead & drive shaft
  const tpl = getMicroVoxelBlockTemplate(k);
  const bodyGeo =
    !isGhost && mod.microDamage?.damagedGeometry
      ? mod.microDamage.damagedGeometry
      : tpl.intactGeometry;
  const microBody = new THREE.Mesh(
    bodyGeo,
    getMicroVoxelBlockMaterial(isGhost, isCharred),
  );
  microBody.name = `MicroVoxel_${k}`;
  microBody.userData.isMicroVoxelBody = true;
  root.add(microBody);
  root.userData.microVoxelMesh = microBody;
  root.userData.microVoxelKind = k;

  if (isAero) {
    const propHub = new THREE.Group();
    propHub.name = 'PropellerHub';
    propHub.position.z = 0.28;

    const spinner = new THREE.Mesh(getCachedConeGeo(0.12, 0.24, 10, 'x'), chromeMat);
    propHub.add(spinner);

    // 3 curved aero blades spaced at 120 degrees
    const aeroBladeGeo = getCachedBoxGeo(0.1, 0.94, 0.035);
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3;
      const blade = new THREE.Mesh(aeroBladeGeo, bladeMat);
      blade.rotation.z = angle;
      blade.rotation.y = 0.22;
      propHub.add(blade);
    }
    root.add(propHub);
    root.userData.propellerHub = propHub;
    if (!isGhost) mod.spinMesh = propHub;
    return root;
  }

  // Isolated Sub-Mesh: `propellerHub` with 3 Angled, Curved Blades
  const propellerHub = new THREE.Group();
  propellerHub.name = 'PropellerHub';
  propellerHub.position.set(0, -0.42, -0.28);

  const propNose = new THREE.Mesh(getCachedConeGeo(0.08, 0.14, 8, 'x'), chromeMat);
  propellerHub.add(propNose);

  const propCenter = new THREE.Mesh(getCachedCylGeo(0.08, 0.08, 0.1, 8, 1, false, 'x'), darkMetalMat);
  propellerHub.add(propCenter);

  const hydroBladeGeo = getCachedBoxGeo(0.09, 0.28, 0.03);
  for (let b = 0; b < 3; b++) {
    const angle = (b * 2 * Math.PI) / 3;
    const bladeGroup = new THREE.Group();
    bladeGroup.rotation.z = angle;

    const blade = new THREE.Mesh(hydroBladeGeo, bladeMat);
    blade.position.y = 0.16;
    blade.rotation.x = 0.38;
    blade.rotation.y = 0.12;
    bladeGroup.add(blade);

    propellerHub.add(bladeGroup);
  }

  root.add(propellerHub);
  root.userData.propellerHub = propellerHub;
  if (!isGhost) {
    mod.spinMesh = propellerHub;
  }

  return root;
}

/**
 * Builds a Driver Cockpit & Roll-Cage Module with:
 * - Heavy-duty tubular roll-cage cage struts
 * - Tinted windshield glass element
 * - Ergonomic bucket seat, side bolsters, racing harness
 * - Instrument dashboard with digital telemetry displays & steering wheel / handlebars
 */
export function createDetailedCockpitMesh(
  mod: ActiveModule,
  isGhost = false,
  isCharred = false,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Cockpit_${mod.kind}`;

  const k = mod.kind as MicroVoxelBlockKind;
  const isMoto = k === 'SEAT_MOTO';
  const w = isMoto ? 0.46 : 0.76;

  // 1px micro-voxel sculpted bucket seat, bolsters, dashboard, steering & roll-cage
  const tpl = getMicroVoxelBlockTemplate(k);
  const bodyGeo =
    !isGhost && mod.microDamage?.damagedGeometry
      ? mod.microDamage.damagedGeometry
      : tpl.intactGeometry;
  const microBody = new THREE.Mesh(
    bodyGeo,
    getMicroVoxelBlockMaterial(isGhost, isCharred),
  );
  microBody.name = `MicroVoxel_${k}`;
  microBody.userData.isMicroVoxelBody = true;
  root.add(microBody);

  // Translucent tinted windshield glass panel for enclosed cockpits/seats
  if (!isMoto) {
    const glassMat = getCockpitGlassMat(0x38bdf8, 0.6, isGhost);
    const windshield = new THREE.Mesh(
      getCachedBoxGeo(w * 0.94, 0.42, 0.04),
      glassMat,
    );
    windshield.position.set(0, 0.48, 0.22);
    windshield.rotation.x = -0.42;
    windshield.renderOrder = 2;
    root.add(windshield);
  }

  root.userData.microVoxelMesh = microBody;
  root.userData.microVoxelKind = k;
  return root;
}

// ============================================================================
// 3. MAIN DETAILED MODULE MESH DISPATCHER
// ============================================================================

/**
 * Builds high-fidelity stylized low-poly mechanical models for all module kinds.
 * Ensures the root pivot is strictly centered at (0, 0, 0).
 */
export function createDetailedModuleMesh(
  mod: ActiveModule,
  isGhost = false,
): THREE.Group {
  const isCharred = !isGhost && (mod.health ?? 1.0) < 0.5;
  const k = mod.kind;

  // 1. Traction & Wheel Assemblies
  if (
    k === 'WHEEL_STEER' ||
    k === 'WHEEL_DRIVE' ||
    k === 'WHEEL_RACING' ||
    k === 'WHEEL_MONSTER' ||
    k === 'WHEEL_KART' ||
    k === 'WHEEL_DRAG' ||
    k === 'WHEEL_SPIKED'
  ) {
    return createDetailedWheelMesh(mod, isGhost, isCharred);
  }

  // 2. Dragon Jet & Rocket Thrusters
  if (
    k === 'THRUSTER' ||
    k === 'THRUSTER_MINI' ||
    k === 'THRUSTER_ROCKET' ||
    k === 'JET_RAW' ||
    k === 'JET_GIMBAL'
  ) {
    return optimizeModuleMeshHierarchy(createDetailedThrusterMesh(mod, isGhost, isCharred), mod);
  }

  // 3. Outboard Marine Motors & Propellers
  if (k === 'BOAT_PROP' || k === 'BOAT_OUTBOARD' || k === 'PROP_AERO') {
    return optimizeModuleMeshHierarchy(createDetailedOutboardMesh(mod, isGhost, isCharred), mod);
  }

  // 4. Cockpits, Seats & Roll-Cages
  if (
    k === 'COCKPIT' ||
    k === 'SEAT_KART' ||
    k === 'SEAT_MOTO' ||
    k === 'SEAT_OPERATOR' ||
    k === 'SEAT_ARMORED' ||
    k === 'SEAT_DIVING' ||
    k === 'SEAT_SPACE' ||
    k === 'SEAT_SHIP_WHEEL'
  ) {
    return optimizeModuleMeshHierarchy(createDetailedCockpitMesh(mod, isGhost, isCharred), mod);
  }

  // For other specialized parts, build cleanly structured stylized low-poly components:
  const root = new THREE.Group();
  root.name = `Module_${k}`;

  const makeMat = (hex: number) => getMachinedMetalMat(hex, 0.38, 0.65, isGhost, isCharred);
  const makeGlowMat = (hex: number, intensity = 2.0) =>
    getEmissiveNeonMat(hex, intensity, isGhost, isCharred);

  if (
    k === 'V8_ENGINE' ||
    k === 'ENGINE_BULLDAWG' ||
    k === 'ENGINE_DRAGON'
  ) {
    const tpl = getMicroVoxelBlockTemplate(k);
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = `MicroVoxel_${k}`;
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = k;
  } else if (k === 'PLASMA_CANNON') {
    const turretBase = new THREE.Mesh(getCachedCylGeo(0.36, 0.4, 0.14, 14), makeMat(0x1e293b));
    turretBase.position.y = -0.18;
    root.add(turretBase);

    const turretPivot = new THREE.Group();
    turretPivot.name = 'TurretPivot';
    turretPivot.position.y = 0.04;

    const tpl = getMicroVoxelBlockTemplate('PLASMA_CANNON');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_PLASMA_CANNON';
    microBody.userData.isMicroVoxelBody = true;
    turretPivot.add(microBody);

    root.add(turretPivot);
    root.userData.turretPivot = turretPivot;
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'PLASMA_CANNON';
    if (!isGhost) mod.spinMesh = turretPivot;
  } else if (k === 'HEADLIGHT') {
    const tpl = getMicroVoxelBlockTemplate('HEADLIGHT');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_HEADLIGHT';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'HEADLIGHT';
  } else if (
    k === 'AERO_WING' ||
    k === 'WING_STANDARD' ||
    k === 'SPOILER' ||
    k === 'TAILFIN' ||
    k === 'TAILFIN_POWERED' ||
    k === 'AERO_BLADE' ||
    k === 'SUSPENSION' ||
    k === 'STEERING_HINGE' ||
    k === 'SKI_SLIDER' ||
    k === 'WEAPON_MELEE' ||
    k === 'PONTOON_LARGE' ||
    k === 'BCD_TANK' ||
    k === 'WEIGHT_BLOCK' ||
    k === 'HINGE_LARGE' ||
    k === 'HINGE_TRAILER' ||
    k === 'JOINT_MECH' ||
    k === 'DETACHABLE_BLOCK' ||
    k === 'SENSOR_DISTANCE' ||
    k === 'SENSOR_SPEED' ||
    k === 'SENSOR_ALTIMETER' ||
    k === 'SENSOR_ANGLE' ||
    k === 'SENSOR_POSITION' ||
    k === 'SENSOR_IMU_TILT' ||
    k === 'SENSOR_SPEEDO' ||
    k === 'LOGIC_GATE' ||
    k === 'RADIO_TRX'
  ) {
    // Part 3: Full 1px (0.0625m) greedy-meshed micro-voxel destructible module body
    const tpl = getMicroVoxelBlockTemplate(k as MicroVoxelBlockKind);
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = `MicroVoxel_${k}`;
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = k;
  } else if (k === 'VTOL_ROTOR') {
    const tpl = getMicroVoxelBlockTemplate('VTOL_ROTOR');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_VTOL_ROTOR';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'VTOL_ROTOR';

    const rotorHead = new THREE.Group();
    rotorHead.position.y = 0.48;
    const hub = new THREE.Mesh(getCachedCylGeo(0.18, 0.18, 0.1, 10), makeMat(0x0f172a));
    rotorHead.add(hub);
    const bladeGeo = getCachedBoxGeo(1.64, 0.04, 0.14);
    for (let b = 0; b < 2; b++) {
      const blade = new THREE.Mesh(bladeGeo, makeMat(0xfacc15));
      blade.rotation.y = b * Math.PI;
      rotorHead.add(blade);
    }
    root.add(rotorHead);
    root.userData.propellerHub = rotorHead;
    if (!isGhost) mod.spinMesh = rotorHead;
  } else if (k === 'GYRO' || k === 'GYRO_REACTION') {
    const tpl = getMicroVoxelBlockTemplate(k);
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = `MicroVoxel_${k}`;
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = k;

    const ring = new THREE.Mesh(getCachedTorusGeo(0.3, 0.036, 8, 14), makeMat(0x94a3b8));
    const core = new THREE.Mesh(getCachedSphereGeo(0.14, 10, 10), makeGlowMat(0x38bdf8, 2.2));
    root.add(ring, core);
    if (!isGhost) mod.spinMesh = ring;
  } else if (k === 'PISTON') {
    const tpl = getMicroVoxelBlockTemplate('PISTON');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_PISTON';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'PISTON';

    const rod = new THREE.Mesh(getCachedCylGeo(0.09, 0.09, 0.62, 8), makeMat(0xe2e8f0));
    rod.position.y = -0.26;
    const footPad = new THREE.Mesh(getCachedBoxGeo(0.42, 0.09, 0.42), makeMat(0x334155));
    footPad.position.y = -0.58;
    const innerRam = new THREE.Group();
    innerRam.add(rod, footPad);
    root.add(innerRam);
    if (!isGhost) mod.spinMesh = innerRam;
  } else if (k === 'GRAPPLING_WINCH') {
    const tpl = getMicroVoxelBlockTemplate('GRAPPLING_WINCH');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_GRAPPLING_WINCH';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'GRAPPLING_WINCH';

    // Rotating Cable Spool Drum
    const spoolGroup = new THREE.Group();
    spoolGroup.name = 'WinchSpool';
    const drumCore = new THREE.Mesh(getCachedCylGeo(0.15, 0.15, 0.34, 12, 1, false, 'z'), makeMat(0xfacc15));
    const cableWrap = new THREE.Mesh(getCachedCylGeo(0.17, 0.17, 0.26, 12, 1, false, 'z'), makeMat(0x64748b));
    spoolGroup.add(drumCore, cableWrap);
    root.add(spoolGroup);

    // 3-Prong Forged Grapple Hook
    const hookGroup = new THREE.Group();
    hookGroup.position.set(0, 0, 0.34);
    const hookShaft = new THREE.Mesh(getCachedCylGeo(0.035, 0.035, 0.18, 8, 1, false, 'x'), makeMat(0xe2e8f0));
    const hookRing = new THREE.Mesh(getCachedTorusGeo(0.09, 0.028, 8, 12), makeMat(0xfacc15));
    hookGroup.add(hookShaft, hookRing);
    for (let c = 0; c < 3; c++) {
      const ang = (c * Math.PI * 2) / 3;
      const claw = new THREE.Mesh(getCachedBoxGeo(0.035, 0.14, 0.08), makeMat(0xe2e8f0));
      claw.position.set(Math.cos(ang) * 0.07, Math.sin(ang) * 0.07, 0.08);
      claw.rotation.z = ang;
      hookGroup.add(claw);
    }
    root.add(hookGroup);
    root.userData.hookMesh = hookGroup;
    root.userData.winchHookClaw = hookGroup;
    root.userData.spinMesh = spoolGroup;
    if (!isGhost) mod.spinMesh = spoolGroup;
  } else if (k === 'WEAPON_MINIGUN') {
    const turretPivot = new THREE.Group();
    turretPivot.name = 'TurretPivot';

    const tpl = getMicroVoxelBlockTemplate('WEAPON_MINIGUN');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_WEAPON_MINIGUN';
    microBody.userData.isMicroVoxelBody = true;
    turretPivot.add(microBody);

    const cluster = new THREE.Group();
    cluster.name = 'GatlingCluster';
    const clampF = new THREE.Mesh(getCachedCylGeo(0.155, 0.155, 0.08, 10, 1, false, 'x'), makeMat(0x94a3b8));
    clampF.position.z = 0.88;
    const clampM = new THREE.Mesh(getCachedCylGeo(0.155, 0.155, 0.07, 10, 1, false, 'x'), makeMat(0x64748b));
    clampM.position.z = 0.54;
    cluster.add(clampF, clampM);
    const barrelGeo = getCachedCylGeo(0.028, 0.028, 0.96, 8, 1, false, 'x');
    for (let b = 0; b < 6; b++) {
      const ang = (b * Math.PI * 2) / 6;
      const bMesh = new THREE.Mesh(barrelGeo, makeMat(0xe2e8f0));
      bMesh.position.set(Math.cos(ang) * 0.088, Math.sin(ang) * 0.088, 0.58);
      cluster.add(bMesh);
    }
    cluster.position.y = 0.06;
    turretPivot.add(cluster);
    root.add(turretPivot);
    root.userData.turretPivot = turretPivot;
    root.userData.spinMesh = cluster;
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'WEAPON_MINIGUN';
    if (!isGhost) mod.spinMesh = cluster;
  } else if (k === 'WEAPON_ROCKET' || k === 'WEAPON_BOMB_BAY') {
    const turretPivot = new THREE.Group();
    turretPivot.name = 'TurretPivot';

    const tpl = getMicroVoxelBlockTemplate(k);
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = `MicroVoxel_${k}`;
    microBody.userData.isMicroVoxelBody = true;
    turretPivot.add(microBody);

    root.add(turretPivot);
    root.userData.turretPivot = turretPivot;
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = k;
    if (!isGhost && k === 'WEAPON_ROCKET') mod.spinMesh = turretPivot;
  } else if (k === 'SERVO_SPIN' || k === 'SERVO_SMALL') {
    const isSmall = k === 'SERVO_SMALL';
    const sc = isSmall ? 0.78 : 1.0;

    const tpl = getMicroVoxelBlockTemplate(k);
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = `MicroVoxel_${k}`;
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = k;

    const rotorGroup = new THREE.Group();
    rotorGroup.position.y = 0.2 * sc;
    const turntable = new THREE.Mesh(
      getCachedCylGeo(0.26 * sc, 0.22 * sc, 0.08 * sc, 12),
      makeMat(isSmall ? 0x34d399 : 0x10b981),
    );
    const crossKey = new THREE.Mesh(
      getCachedBoxGeo(0.38 * sc, 0.05 * sc, 0.1 * sc),
      makeMat(0xe2e8f0),
    );
    crossKey.position.y = 0.05 * sc;
    rotorGroup.add(turntable, crossKey);
    root.add(rotorGroup);
    if (!isGhost) mod.spinMesh = rotorGroup;
  } else if (k === 'MICROBIT_ECU') {
    // Official stylized Micro:bit V2 / V3 Controller Block with active 5x5 LED matrix
    const pcbMat = makeMat(0x0f172a);
    const goldMat = makeMat(0xf59e0b);
    const btnMat = makeMat(0x18181b);
    const bezelMat = makeMat(0x64748b);

    const pcbBoard = new THREE.Mesh(getCachedBoxGeo(0.64, 0.12, 0.64), pcbMat);
    pcbBoard.position.y = -0.06;
    root.add(pcbBoard);

    const goldBus = new THREE.Mesh(getCachedBoxGeo(0.60, 0.025, 0.12), goldMat);
    goldBus.position.set(0, 0.01, 0.25);
    root.add(goldBus);

    for (const gx of [-0.22, -0.11, 0, 0.11, 0.22]) {
      const pinNotch = new THREE.Mesh(getCachedBoxGeo(0.015, 0.03, 0.13), pcbMat);
      pinNotch.position.set(gx, 0.015, 0.25);
      root.add(pinNotch);
    }

    for (const sx of [-0.21, 0.21]) {
      const btnRing = new THREE.Mesh(getCachedCylGeo(0.065, 0.065, 0.035, 10), bezelMat);
      btnRing.position.set(sx, 0.015, 0.02);
      const btnCap = new THREE.Mesh(getCachedCylGeo(0.045, 0.045, 0.045, 10), btnMat);
      btnCap.position.set(sx, 0.02, 0.02);
      root.add(btnRing, btnCap);
    }

    const ledDots: THREE.Mesh[] = [];
    const ledSpacing = 0.052;
    for (let row = -2; row <= 2; row++) {
      for (let col = -2; col <= 2; col++) {
        const dot = new THREE.Mesh(_sharedLedDotGeo, _ledOffMat);
        dot.position.set(col * ledSpacing, 0.015, row * ledSpacing + 0.02);
        root.add(dot);
        ledDots.push(dot);
      }
    }
    root.userData.ledMatrixDots = ledDots;
    root.userData.currentLedIcon = 'OFF';

    const antTrace = new THREE.Mesh(getCachedBoxGeo(0.36, 0.015, 0.04), goldMat);
    antTrace.position.set(0, 0.01, -0.24);
    root.add(antTrace);
  } else if (k === 'SENSOR_TARGET_RADAR') {
    const basePedestal = new THREE.Mesh(getCachedCylGeo(0.24, 0.28, 0.16, 12), makeMat(0x1e293b));
    basePedestal.position.y = -0.16;
    const neckCollar = new THREE.Mesh(getCachedCylGeo(0.16, 0.16, 0.08, 12), makeMat(0x64748b));
    neckCollar.position.y = -0.04;
    root.add(basePedestal, neckCollar);

    const dishGroup = new THREE.Group();
    dishGroup.position.y = 0.06;
    const dish = new THREE.Mesh(getCachedCylGeo(0.32, 0.12, 0.14, 14), makeMat(0xe2e8f0));
    dish.rotation.x = Math.PI * 0.35;
    const dishCore = new THREE.Mesh(getCachedSphereGeo(0.08, 8, 8), makeGlowMat(0xa855f7, 2.5));
    dishCore.position.z = 0.08;
    const feedHorn = new THREE.Mesh(getCachedCylGeo(0.02, 0.02, 0.18, 6), makeMat(0xf59e0b));
    feedHorn.rotation.x = Math.PI * 0.35;
    feedHorn.position.z = 0.12;
    dishGroup.add(dish, dishCore, feedHorn);
    root.add(dishGroup);
    if (!isGhost) mod.spinMesh = dishGroup;
  } else if (
    (k as string) === 'FLOAT_PONTOON' ||
    (k as string) === 'HEAVY_PONTOON' ||
    (k as string) === 'BALLAST_TANK' ||
    (k as string) === 'LEAD_WEIGHT'
  ) {
    const mappedKind: MicroVoxelBlockKind =
      (k as string) === 'BALLAST_TANK'
        ? 'BCD_TANK'
        : (k as string) === 'LEAD_WEIGHT'
          ? 'WEIGHT_BLOCK'
          : 'PONTOON_LARGE';
    const tpl = getMicroVoxelBlockTemplate(mappedKind);
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = `MicroVoxel_${mappedKind}`;
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = mappedKind;
  } else if (k === 'COSMETIC_RACING_FIN') {
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.62), makeMat(0x1e293b));
    scoop.position.y = -0.16;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.72), makeMat(0xef4444));
    fin.position.set(0, 0.12, -0.06);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.74), makeGlowMat(0xfacc15, 1.8));
    trim.position.set(0, 0.32, -0.06);
    root.add(scoop, fin, trim);
  } else if (k === 'COSMETIC_EXHAUST_STACK') {
    const manifold = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, 0.32), makeMat(0x1e293b));
    manifold.position.y = -0.28;
    for (const sx of [-0.16, 0.16]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.72, 10), makeMat(0xe2e8f0));
      pipe.position.set(sx, 0.08, 0);
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.38, 10), makeMat(0x64748b));
      shield.position.set(sx, 0.02, 0);
      root.add(pipe, shield);
    }
    root.add(manifold);
  } else if (k === 'COSMETIC_BULLBAR') {
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.88, 8), makeMat(0x334155));
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.y = -0.12;
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 8, 12, Math.PI), makeMat(0xf59e0b));
    hoop.position.set(0, -0.06, 0.08);
    for (const sx of [-0.14, 0.14]) {
      const fogLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), makeGlowMat(0xfef08a, 2.5));
      fogLamp.rotation.x = Math.PI / 2;
      fogLamp.position.set(sx, -0.02, 0.12);
      root.add(fogLamp);
    }
    root.add(crossbar, hoop);
  } else if (k === 'COSMETIC_NEON_STRIP') {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.08, 0.16), makeMat(0x0f172a));
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 10), makeGlowMat(0x00f5ff, 2.8));
    tube.rotation.z = Math.PI / 2;
    tube.position.y = 0.04;
    root.add(rail, tube);
  } else if (k === 'COSMETIC_SIREN_BAR') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.24), makeMat(0xe2e8f0));
    bar.position.y = -0.08;
    const domeL = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.22), makeGlowMat(0xef4444, 2.6));
    domeL.position.set(-0.22, 0.03, 0);
    const domeR = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.22), makeGlowMat(0x3b82f6, 2.6));
    domeR.position.set(0.22, 0.03, 0);
    root.add(bar, domeL, domeR);
  } else if (k === 'COSMETIC_RADAR_DOME') {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.26, 10), makeMat(0x1e293b));
    pedestal.position.y = -0.16;
    const dishGroup = new THREE.Group();
    dishGroup.position.y = 0.08;
    const scannerBar = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.12, 0.16), makeMat(0xe2e8f0));
    const accentStripe = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.17), makeGlowMat(0x38bdf8, 2.0));
    dishGroup.add(scannerBar, accentStripe);
    root.add(pedestal, dishGroup);
    if (!isGhost) mod.spinMesh = dishGroup;
  } else if (k === 'COSMETIC_HORN_BUGLE') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.32), makeMat(0x1e293b));
    base.position.y = -0.14;
    for (let i = -1; i <= 1; i++) {
      const len = 0.48 - Math.abs(i) * 0.08;
      const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.09, len, 10), makeMat(0xfacc15));
      horn.rotation.x = -Math.PI / 2;
      horn.position.set(i * 0.14, 0.02, 0.04);
      root.add(horn);
    }
    root.add(base);
  } else if (k === 'COSMETIC_PIRATE_FLAG') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.1, 8), makeMat(0x1e293b));
    base.position.y = -0.36;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.82, 8), makeMat(0xe2e8f0));
    mast.position.y = 0.04;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.52), makeMat(0xec4899));
    flag.position.set(0, 0.22, -0.26);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), makeMat(0xfacc15));
    finial.position.y = 0.46;
    root.add(base, mast, flag, finial);
  } else if (k === 'TURRET_RING') {
    const tpl = getMicroVoxelBlockTemplate('TURRET_RING');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_TURRET_RING';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'TURRET_RING';

    const turretDeck = new THREE.Group();
    turretDeck.position.y = 0.08;
    const topDisk = new THREE.Mesh(getCachedCylGeo(0.36, 0.36, 0.08, 12), makeMat(0x475569));
    const aimArrow = new THREE.Mesh(getCachedBoxGeo(0.14, 0.06, 0.42), makeGlowMat(0xfacc15, 2.0));
    aimArrow.position.set(0, 0.06, 0.14);
    turretDeck.add(topDisk, aimArrow);
    root.add(turretDeck);
    if (!isGhost) {
      mod.turretPivot = turretDeck;
      mod.spinMesh = turretDeck;
    }
  } else if (k === 'MAGNET_COUPLER') {
    const tpl = getMicroVoxelBlockTemplate('MAGNET_COUPLER');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_MAGNET_COUPLER';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'MAGNET_COUPLER';

    const emitterGroup = new THREE.Group();
    emitterGroup.position.z = 0.28;
    const fieldRing = new THREE.Mesh(getCachedTorusGeo(0.24, 0.04, 8, 14), makeGlowMat(0x38bdf8, 2.6));
    emitterGroup.add(fieldRing);
    root.add(emitterGroup);
    if (!isGhost) mod.spinMesh = emitterGroup;
  } else if (k === 'TANK_TREAD') {
    const tpl = getMicroVoxelBlockTemplate('TANK_TREAD');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_TANK_TREAD';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'TANK_TREAD';

    const wheelsGroup = new THREE.Group();
    wheelsGroup.position.y = -0.14;
    const hubGeo = getCachedCylGeo(0.1, 0.1, 0.46, 8, 1, false, 'z');
    for (const wz of [-0.42, 0, 0.42]) {
      const hub = new THREE.Mesh(hubGeo, makeMat(0xfacc15));
      hub.position.set(0, 0, wz);
      wheelsGroup.add(hub);
    }
    root.add(wheelsGroup);
    if (!isGhost) mod.spinMesh = wheelsGroup;
  } else if (k === 'PARACHUTE_AIRBRAKE') {
    const tpl = getMicroVoxelBlockTemplate('PARACHUTE_AIRBRAKE');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_PARACHUTE_AIRBRAKE';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'PARACHUTE_AIRBRAKE';

    const canopyGroup = new THREE.Group();
    canopyGroup.position.y = 0.14;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
      makeMat(0xf97316),
    );
    dome.position.y = 0.36;
    const domeStripe = new THREE.Mesh(getCachedBoxGeo(0.86, 0.12, 0.22), makeMat(0xf8fafc));
    domeStripe.position.y = 0.56;
    canopyGroup.add(dome, domeStripe);
    canopyGroup.scale.set(0.28, 0.18, 0.28);
    root.add(canopyGroup);
    if (!isGhost) mod.spinMesh = canopyGroup;
  } else if (k === 'OUTRIGGER_JACK') {
    const tpl = getMicroVoxelBlockTemplate('OUTRIGGER_JACK');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_OUTRIGGER_JACK';
    microBody.userData.isMicroVoxelBody = true;
    root.add(microBody);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'OUTRIGGER_JACK';

    const ramGroup = new THREE.Group();
    const chromeRod = new THREE.Mesh(getCachedCylGeo(0.1, 0.1, 0.56, 8), makeMat(0xe2e8f0));
    chromeRod.position.y = -0.22;
    const footPad = new THREE.Mesh(getCachedCylGeo(0.3, 0.34, 0.1, 10), makeMat(0xf59e0b));
    footPad.position.y = -0.5;
    ramGroup.add(chromeRod, footPad);
    root.add(ramGroup);
    if (!isGhost) mod.spinMesh = ramGroup;
  } else if (k === 'IMPULSE_BUMPER') {
    const tpl = getMicroVoxelBlockTemplate('IMPULSE_BUMPER');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_IMPULSE_BUMPER';
    microBody.userData.isMicroVoxelBody = true;
    const plateGroup = new THREE.Group();
    plateGroup.add(microBody);
    root.add(plateGroup);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'IMPULSE_BUMPER';
    if (!isGhost) mod.spinMesh = plateGroup;
  } else if (k === 'SMOKE_FLARE') {
    const tpl = getMicroVoxelBlockTemplate('SMOKE_FLARE');
    const bodyGeo =
      !isGhost && mod.microDamage?.damagedGeometry
        ? mod.microDamage.damagedGeometry
        : tpl.intactGeometry;
    const microBody = new THREE.Mesh(
      bodyGeo,
      getMicroVoxelBlockMaterial(isGhost, isCharred),
    );
    microBody.name = 'MicroVoxel_SMOKE_FLARE';
    microBody.userData.isMicroVoxelBody = true;
    const launcherPod = new THREE.Group();
    launcherPod.add(microBody);
    root.add(launcherPod);
    root.userData.microVoxelMesh = microBody;
    root.userData.microVoxelKind = 'SMOKE_FLARE';
    if (!isGhost) mod.spinMesh = launcherPod;
  } else {
    // Structured Battery / Fuel Cell Power Module (with cooling fins, cylindrical cells & LED indicator)
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.14, 0.66), makeMat(0x1e293b));
    tray.position.y = -0.22;
    const topCap = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.64), makeMat(0x334155));
    topCap.position.y = 0.24;
    for (const cx of [-0.16, 0.16]) {
      for (const cz of [-0.16, 0.16]) {
        const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 10), makeMat(0x0284c7));
        cell.position.set(cx, 0.02, cz);
        root.add(cell);
      }
    }
    const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.04), makeGlowMat(0x38bdf8, 2.2));
    ledStrip.position.set(0, 0.02, 0.32);
    root.add(tray, topCap, ledStrip);
  }

  return optimizeModuleMeshHierarchy(root, mod);
}

