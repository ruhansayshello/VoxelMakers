import * as THREE from 'three';
import {
  VOXEL_SIZE,
  SYMMETRY_CENTER_X,
  type ModuleKind,
} from './constants.ts';
import type { ActiveModule } from './vehicle.ts';
import { LED_PATTERNS, type LedMatrixIcon } from './logicSystem.ts';

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
    _sharedPrimitiveGeoCache.set(key, geo);
  }
  return geo;
}

export function getSharedGeoCacheSize(): number {
  return _sharedPrimitiveGeoCache.size;
}

/**
 * Optimizes a generated module hierarchy:
 * - Marks all child geometries as shared primitives in `_sharedPrimitiveGeoCache` so they are never leaked or redundantly allocated
 * - Disables `castShadow` on small sub-parts (lug bolts, springs, screens, trim)
 * - Enables `frustumCulled = true` on every mesh and sub-assembly
 * - Sets `matrixAutoUpdate = false` (calling `updateMatrix()` once) on static sub-meshes
 */
export function optimizeModuleMeshHierarchy(root: THREE.Group): THREE.Group {
  const dynamicNodes = new Set<THREE.Object3D>();
  if (root.userData.steerPivot) dynamicNodes.add(root.userData.steerPivot);
  if (root.userData.rollGroup) dynamicNodes.add(root.userData.rollGroup);
  if (root.userData.propellerHub) dynamicNodes.add(root.userData.propellerHub);
  if (root.userData.flameCore) dynamicNodes.add(root.userData.flameCore);
  if (root.userData.turretPivot) dynamicNodes.add(root.userData.turretPivot);
  if (root.userData.spinMesh) dynamicNodes.add(root.userData.spinMesh);
  if (root.userData.hookMesh) dynamicNodes.add(root.userData.hookMesh);

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
  const rubberMat = getMatteRubberMat(isGhost, isCharred);
  const rimMat = getMachinedMetalMat(rimColor, 0.25, 0.8, isGhost, isCharred);
  const boltMat = getMachinedMetalMat(0xe2e8f0, 0.15, 0.9, isGhost, isCharred);

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

  // 1. Tire Carcass (Tread base cylinder + beveled shoulder rings)
  const tireGeo = getCachedCylGeo(rad, rad, width * 0.88, 20, 1, false, 'z');
  const tire = new THREE.Mesh(tireGeo, rubberMat);

  const shoulderGeo = getCachedCylGeo(rad * 0.88, rad * 0.88, width, 20, 1, false, 'z');
  const shoulder = new THREE.Mesh(shoulderGeo, rubberMat);
  rollGroup.add(tire, shoulder);

  // 2. Outer-Perimeter Tread Lugs (Placed strictly along the outer tire perimeter ring so they never clip the rim)
  const lugCount = isRacing || isDrag ? 10 : 12;
  const lugRadialHeight = isSpiked ? rad * 0.18 : rad * 0.11;
  const lugCircumWidth = isSpiked ? 0.055 : rad * 0.22;
  const lugGeo = getCachedBoxGeo(width * 0.92, lugRadialHeight, lugCircumWidth);
  const lugMat = isSpiked
    ? getMachinedMetalMat(0x7dd3fc, 0.2, 0.8, isGhost, isCharred)
    : rubberMat;

  for (let i = 0; i < lugCount; i++) {
    const angle = (i * 2 * Math.PI) / lugCount;
    const lug = new THREE.Mesh(lugGeo, lugMat);
    const lugRadius = rad - lugRadialHeight * 0.25;
    lug.position.set(0, Math.sin(angle) * lugRadius, Math.cos(angle) * lugRadius);
    lug.rotation.x = -angle;
    rollGroup.add(lug);
  }

  // 3. Recessed Alloy Rim with Beveled Lip & 5 Spoke Webbing (staggered widths prevent Z-fighting)
  const rimOuterGeo = getCachedCylGeo(rad * 0.62, rad * 0.62, width * 0.94, 16, 1, false, 'z');
  const rimOuter = new THREE.Mesh(rimOuterGeo, rimMat);

  const rimInnerGeo = getCachedCylGeo(rad * 0.52, rad * 0.52, width * 0.84, 16, 1, false, 'z');
  const rimInner = new THREE.Mesh(rimInnerGeo, darkMetalMat);
  rollGroup.add(rimOuter, rimInner);

  // 5 Spoke Bars radiating from hub (width sits cleanly outside rimInner without Z-fighting)
  const spokeGeo = getCachedBoxGeo(width * 0.98, rad * 0.46, rad * 0.14);
  for (let s = 0; s < 5; s++) {
    const sAngle = (s * 2 * Math.PI) / 5;
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.position.set(0, Math.sin(sAngle) * rad * 0.26, Math.cos(sAngle) * rad * 0.26);
    spoke.rotation.x = -sAngle;
    rollGroup.add(spoke);
  }

  // 4. Central Hubcap & Chrome Lug Bolts
  const hubcapGeo = getCachedCylGeo(rad * 0.2, rad * 0.2, width + 0.04, 12, 1, false, 'z');
  const hubcap = new THREE.Mesh(hubcapGeo, metalMat);
  rollGroup.add(hubcap);

  // Lug Bolts on outboard face
  const boltFaceX = (width + 0.05) * 0.5 * sideSign;
  const lugBoltGeo = getCachedCylGeo(0.022, 0.022, 0.04, 6, 1, false, 'z');
  for (let b = 0; b < 5; b++) {
    const bAngle = (b * (2 * Math.PI)) / 5;
    const bolt = new THREE.Mesh(lugBoltGeo, boltMat);
    bolt.position.set(
      boltFaceX,
      Math.sin(bAngle) * rad * 0.13,
      Math.cos(bAngle) * rad * 0.13,
    );
    rollGroup.add(bolt);
  }

  steerPivot.add(rollGroup);
  root.add(steerPivot);

  // Tag nodes for hierarchical animation
  steerPivot.userData.rollGroup = rollGroup;
  root.userData.steerPivot = steerPivot;
  root.userData.rollGroup = rollGroup;
  if (!isGhost) {
    mod.wheelMesh = steerPivot;
  }

  return optimizeModuleMeshHierarchy(root);
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

  const k = mod.kind;
  const isMini = k === 'THRUSTER_MINI';
  const isRaw = k === 'JET_RAW';
  const isRocket = k === 'THRUSTER_ROCKET';
  const isGimbal = k === 'JET_GIMBAL';

  const scale = isMini ? 0.65 : isRaw ? 1.25 : isRocket ? 1.15 : 1.0;
  const casingCol = isRaw ? 0xf97316 : isRocket ? 0xdc2626 : isGimbal ? 0x0d9488 : 0x0284c7;
  const emissiveColor = 0xff6600; // Dedicated rocket glow emissive core

  const metalMat = getMachinedMetalMat(casingCol, 0.35, 0.7, isGhost, isCharred);
  const heatShieldMat = getMachinedMetalMat(0x1e293b, 0.45, 0.6, isGhost, isCharred);
  const nozzleMat = getMachinedMetalMat(0x334155, 0.3, 0.8, isGhost, isCharred);
  const glowMat = getEmissiveNeonMat(emissiveColor, 2.0, isGhost, isCharred);
  const innerChamberMat = getEmissiveNeonMat(0xfacc15, 1.8, isGhost, isCharred);

  const bodyGroup = new THREE.Group();

  // 1. Multi-tiered Outer Heat-Shield Casing (Hexagonal/12-sided with reinforcement ribs)
  const casing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26 * scale, 0.28 * scale, 0.66 * scale, 12),
    metalMat,
  );

  // Stepped cooling jacket collars & structural mount brackets
  const ribF = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3 * scale, 0.3 * scale, 0.08 * scale, 12),
    heatShieldMat,
  );
  ribF.position.y = 0.22 * scale;
  const ribR = ribF.clone();
  ribR.position.y = -0.18 * scale;

  // Supersonic intake compression cone (front)
  const intakeCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.16 * scale, 0.26 * scale, 10),
    heatShieldMat,
  );
  intakeCone.position.y = 0.38 * scale;

  // 2. Stepped Exhaust Bell Nozzle (Multi-stage divergent rocket bell)
  const nozzleBell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18 * scale, 0.29 * scale, 0.32 * scale, 12, 1, true),
    nozzleMat,
  );
  nozzleBell.position.y = -0.44 * scale;

  const nozzleRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.29 * scale, 0.025 * scale, 8, 14),
    heatShieldMat,
  );
  nozzleRim.rotation.x = Math.PI / 2;
  nozzleRim.position.y = -0.58 * scale;

  // 3. Dedicated Emissive Rocket Core (emissive: 0xff6600, emissiveIntensity: 2.0)
  const emitterCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13 * scale, 0.17 * scale, 0.14 * scale, 10),
    glowMat,
  );
  emitterCore.position.y = -0.42 * scale;

  const deepChamber = new THREE.Mesh(
    new THREE.SphereGeometry(0.11 * scale, 8, 8),
    innerChamberMat,
  );
  deepChamber.position.y = -0.34 * scale;

  // 4. Dynamic Thruster Flame Trail Mesh (Scales along thrust axis during Shift boost)
  const flameMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.24 * scale, 0.72 * scale, 10),
    getEmissiveNeonMat(0xff7700, 2.4, isGhost, isCharred),
  );
  flameMesh.rotation.x = Math.PI; // Point backwards out of nozzle
  flameMesh.position.y = -0.84 * scale;
  flameMesh.scale.set(0.65, 0.55, 0.65); // Default idle plume
  flameMesh.name = 'FlameMesh';

  bodyGroup.add(casing, ribF, ribR, intakeCone, nozzleBell, nozzleRim, emitterCore, deepChamber, flameMesh);

  if (!isGimbal) {
    bodyGroup.rotation.x = Math.PI / 2;
  }
  root.add(bodyGroup);

  // Expose flameMesh on root userData for dynamic boost scaling
  root.userData.flameCore = flameMesh;
  root.userData.nozzleBell = nozzleBell;
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

  const k = mod.kind;
  const isAero = k === 'PROP_AERO';
  const isOutboard = k === 'BOAT_OUTBOARD';

  const housingCol = isAero ? 0x84cc16 : isOutboard ? 0x0284c7 : 0x06b6d4;
  const metalMat = getMachinedMetalMat(housingCol, 0.35, 0.65, isGhost, isCharred);
  const darkMetalMat = getMachinedMetalMat(0x1e293b, 0.45, 0.6, isGhost, isCharred);
  const chromeMat = getMachinedMetalMat(0xe2e8f0, 0.15, 0.9, isGhost, isCharred);
  const bladeMat = getMachinedMetalMat(0xfacc15, 0.25, 0.75, isGhost, isCharred);

  if (isAero) {
    // Aircraft Propeller Nacelle & 3-Blade Aero Rotor
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.52, 12), metalMat);
    nacelle.rotation.x = Math.PI / 2;
    root.add(nacelle);

    const shroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.48, 0.28, 16, 1, true),
      metalMat,
    );
    shroud.rotation.x = Math.PI / 2;
    root.add(shroud);

    const propHub = new THREE.Group();
    propHub.name = 'PropellerHub';
    propHub.position.z = 0.28;

    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 10), chromeMat);
    spinner.rotation.x = Math.PI / 2;
    propHub.add(spinner);

    // 3 curved aero blades spaced at 120 degrees
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.94, 0.035), bladeMat);
      blade.rotation.z = angle;
      blade.rotation.y = 0.22; // Pitch angle
      propHub.add(blade);
    }
    root.add(propHub);
    root.userData.propellerHub = propHub;
    if (!isGhost) mod.spinMesh = propHub;
    return root;
  }

  // --- Marine Outboard Motor Assembly ---
  // 1. Upper Cowling / Powerhead
  const cowling = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.52), metalMat);
  cowling.position.set(0, 0.24, -0.06);
  const cowlCap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.48, 10), darkMetalMat);
  cowlCap.rotation.x = Math.PI / 2;
  cowlCap.position.set(0, 0.38, -0.06);
  root.add(cowling, cowlCap);

  // 2. Streamlined Vertical Drive Shaft Housing (Vertical pylon/leg)
  const driveShaftHousing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.28), darkMetalMat);
  driveShaftHousing.position.set(0, -0.12, -0.04);
  root.add(driveShaftHousing);

  // 3. Anti-Cavitation Plate (Horizontal planar foil above propeller)
  const antiCavPlate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.38), metalMat);
  antiCavPlate.position.set(0, -0.32, -0.02);
  root.add(antiCavPlate);

  // 4. Aerodynamic Torpedo Gear-Case Bulb (Bullet-shaped housing for prop shaft)
  const torpedoBulb = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.48, 12), metalMat);
  torpedoBulb.rotation.x = Math.PI / 2;
  torpedoBulb.position.set(0, -0.42, -0.02);
  const torpedoCone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 10), chromeMat);
  torpedoCone.rotation.x = -Math.PI / 2;
  torpedoCone.position.set(0, -0.42, 0.26);

  // Skeg fin under torpedo for rudder stability & protection
  const skeg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.24), darkMetalMat);
  skeg.position.set(0, -0.52, -0.04);
  root.add(torpedoBulb, torpedoCone, skeg);

  // 5. Isolated Sub-Mesh: `propellerHub` with 3 Angled, Curved Blades
  const propellerHub = new THREE.Group();
  propellerHub.name = 'PropellerHub';
  propellerHub.position.set(0, -0.42, -0.28);

  const propNose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 8), chromeMat);
  propNose.rotation.x = Math.PI / 2;
  propellerHub.add(propNose);

  const propCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8), darkMetalMat);
  propCenter.rotation.x = Math.PI / 2;
  propellerHub.add(propCenter);

  // 3 Angled, Curved Blades spaced symmetrically at 120° (2*PI/3)
  for (let b = 0; b < 3; b++) {
    const angle = (b * 2 * Math.PI) / 3;
    const bladeGroup = new THREE.Group();
    bladeGroup.rotation.z = angle;

    // Curved hydro-foil blade
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.28, 0.03), bladeMat);
    blade.position.y = 0.16;
    blade.rotation.x = 0.38; // Hydro-pitch twist
    blade.rotation.y = 0.12; // Cupped curve
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

  const k = mod.kind;
  const isMoto = k === 'SEAT_MOTO';
  const isArmored = k === 'SEAT_ARMORED';
  const w = isMoto ? 0.46 : 0.76;

  const seatColor = isMoto ? 0xf97316 : isArmored ? 0x475569 : 0x0284c7;
  const metalMat = getMachinedMetalMat(0x334155, 0.35, 0.7, isGhost, isCharred);
  const darkMetalMat = getMachinedMetalMat(0x0f172a, 0.45, 0.6, isGhost, isCharred);
  const seatMat = getMachinedMetalMat(seatColor, 0.75, 0.15, isGhost, isCharred);
  const chromeMat = getMachinedMetalMat(0xe2e8f0, 0.15, 0.9, isGhost, isCharred);
  const displayMat = getEmissiveNeonMat(0x38bdf8, 2.0, isGhost, isCharred);
  const glassMat = getCockpitGlassMat(0x38bdf8, 0.6, isGhost);

  // 1. Lower Floor Rails & Slider Mount
  const floorRails = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.08, 0.78), darkMetalMat);
  floorRails.position.y = -0.12;
  root.add(floorRails);

  // 2. Ergonomic Racing Bucket Seat with Bolsters & Headrest
  const seatCushion = new THREE.Mesh(new THREE.BoxGeometry(w * 0.88, 0.16, 0.68), seatMat);
  seatCushion.position.set(0, -0.02, 0.02);

  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(w * 0.84, 0.62, 0.14), seatMat);
  seatBack.position.set(0, 0.3, -0.28);
  seatBack.rotation.x = -0.14;

  const headrest = new THREE.Mesh(new THREE.BoxGeometry(w * 0.58, 0.2, 0.12), darkMetalMat);
  headrest.position.set(0, 0.66, -0.34);

  root.add(seatCushion, seatBack, headrest);

  // 3. Side Bolsters & Tubular Roll-Cage Struts
  const bolsterL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.64), darkMetalMat);
  bolsterL.position.set(-w * 0.46, 0.14, 0.02);
  const bolsterR = bolsterL.clone();
  bolsterR.position.x = w * 0.46;
  root.add(bolsterL, bolsterR);

  // Tubular Roll-Cage Exo-Structure (A-pillars, B-pillars & Crossbar)
  const cageGroup = new THREE.Group();
  const tubeMat = getMachinedMetalMat(0x1e293b, 0.35, 0.8, isGhost, isCharred);

  // Left & Right Front A-Pillars (Angled tubular struts)
  for (const side of [-1, 1]) {
    const aPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8), tubeMat);
    aPillar.position.set(side * w * 0.48, 0.38, 0.22);
    aPillar.rotation.x = -0.38;
    cageGroup.add(aPillar);

    const bPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.68, 8), tubeMat);
    bPillar.position.set(side * w * 0.48, 0.42, -0.32);
    cageGroup.add(bPillar);

    const roofRail = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.58, 8), tubeMat);
    roofRail.position.set(side * w * 0.48, 0.72, -0.05);
    roofRail.rotation.x = Math.PI / 2;
    cageGroup.add(roofRail);
  }

  // Roof Cross-Brace
  const roofCross = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, w * 0.96, 8), tubeMat);
  roofCross.position.set(0, 0.72, -0.05);
  roofCross.rotation.z = Math.PI / 2;
  cageGroup.add(roofCross);
  root.add(cageGroup);

  // 4. Tinted Windshield Glass Element
  if (!isMoto) {
    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.96, 0.44, 0.04),
      glassMat,
    );
    windshield.position.set(0, 0.48, 0.22);
    windshield.rotation.x = -0.42;
    windshield.renderOrder = 2;
    root.add(windshield);
  }

  // 5. Dashboard Console, Digital Telemetry Screen & Steering Wheel
  const dashConsole = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.18, 0.24), darkMetalMat);
  dashConsole.position.set(0, 0.26, 0.28);
  dashConsole.rotation.x = -0.35;

  const mfdScreen = new THREE.Mesh(new THREE.BoxGeometry(w * 0.52, 0.12, 0.04), displayMat);
  mfdScreen.position.set(0, 0.32, 0.29);
  mfdScreen.rotation.x = -0.35;
  root.add(dashConsole, mfdScreen);

  if (isMoto) {
    // Motocross Handlebars & Handgrips
    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8), chromeMat);
    handlebar.rotation.z = Math.PI / 2;
    handlebar.position.set(0, 0.42, 0.24);
    root.add(handlebar);
  } else {
    // Sport Steering Wheel
    const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.024, 8, 16), metalMat);
    wheelRim.rotation.x = Math.PI / 2 - 0.45;
    wheelRim.position.set(0, 0.36, 0.18);
    root.add(wheelRim);
  }

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
    return optimizeModuleMeshHierarchy(createDetailedThrusterMesh(mod, isGhost, isCharred));
  }

  // 3. Outboard Marine Motors & Propellers
  if (k === 'BOAT_PROP' || k === 'BOAT_OUTBOARD' || k === 'PROP_AERO') {
    return optimizeModuleMeshHierarchy(createDetailedOutboardMesh(mod, isGhost, isCharred));
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
    return optimizeModuleMeshHierarchy(createDetailedCockpitMesh(mod, isGhost, isCharred));
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
    const col =
      k === 'ENGINE_BULLDAWG'
        ? 0xf97316
        : k === 'ENGINE_DRAGON'
          ? 0xef4444
          : 0xe11d48;
    const scale = k === 'ENGINE_DRAGON' ? 1.15 : k === 'ENGINE_BULLDAWG' ? 0.9 : 1.0;

    const sump = new THREE.Mesh(new THREE.BoxGeometry(0.62 * scale, 0.18 * scale, 0.86 * scale), makeMat(0x1e293b));
    sump.position.y = -0.22 * scale;

    const block = new THREE.Mesh(new THREE.BoxGeometry(0.68 * scale, 0.44 * scale, 0.82 * scale), makeMat(col));

    // Angled V-8 Cylinder Banks & Chrome Valve Covers
    for (const s of [-1, 1]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(0.28 * scale, 0.32 * scale, 0.78 * scale), makeMat(0x334155));
      bank.position.set(s * 0.24 * scale, 0.18 * scale, 0);
      bank.rotation.z = -s * 0.42;

      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, 0.08 * scale, 0.74 * scale), makeMat(0xe2e8f0));
      cover.position.set(s * 0.31 * scale, 0.31 * scale, 0);
      cover.rotation.z = -s * 0.42;

      const header = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * scale, 0.055 * scale, 0.86 * scale, 8), makeMat(0x94a3b8));
      header.rotation.x = Math.PI / 2;
      header.position.set(s * 0.38 * scale, 0.08 * scale, -0.04 * scale);

      root.add(bank, cover, header);
    }

    const blower = new THREE.Mesh(new THREE.BoxGeometry(0.38 * scale, 0.22 * scale, 0.56 * scale), makeMat(0xcbd5e1));
    blower.position.y = 0.32 * scale;
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.32 * scale, 0.14 * scale, 0.38 * scale), makeMat(0xfacc15));
    scoop.position.set(0, 0.46 * scale, 0.08 * scale);
    const intakeMouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.26 * scale, 0.09 * scale, 0.06 * scale),
      makeGlowMat(k === 'ENGINE_DRAGON' ? 0xff6600 : 0x38bdf8),
    );
    intakeMouth.position.set(0, 0.46 * scale, 0.26 * scale);

    const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.14 * scale, 0.08 * scale, 10), makeMat(0xfacc15));
    pulley.rotation.x = Math.PI / 2;
    pulley.position.set(0, -0.02 * scale, 0.44 * scale);

    root.add(sump, block, blower, scoop, intakeMouth, pulley);
  } else if (k === 'PLASMA_CANNON') {
    const turretBase = new THREE.Mesh(getCachedCylGeo(0.36, 0.4, 0.14, 14), makeMat(0x1e293b));
    turretBase.position.y = -0.18;
    const bearingRing = new THREE.Mesh(getCachedTorusGeo(0.32, 0.03, 8, 16), makeMat(0x64748b));
    bearingRing.rotation.x = Math.PI / 2;
    bearingRing.position.y = -0.1;
    root.add(turretBase, bearingRing);

    const turretPivot = new THREE.Group();
    turretPivot.name = 'TurretPivot';
    turretPivot.position.y = 0.04;

    const mount = new THREE.Mesh(getCachedBoxGeo(0.58, 0.34, 0.68), makeMat(0xbe123c));
    const shieldTop = new THREE.Mesh(getCachedBoxGeo(0.5, 0.08, 0.56), makeMat(0x1e293b));
    shieldTop.position.y = 0.2;
    turretPivot.add(mount, shieldTop);

    for (const s of [-1, 1]) {
      const coil = new THREE.Mesh(getCachedBoxGeo(0.08, 0.18, 0.58), makeGlowMat(0x38bdf8, 2.4));
      coil.position.set(s * 0.3, 0.02, 0.04);
      turretPivot.add(coil);
    }

    const barrel = new THREE.Mesh(getCachedCylGeo(0.11, 0.14, 1.18, 12, 1, false, 'x'), makeMat(0x334155));
    barrel.position.set(0, 0.02, 0.62);

    const coolingShroud = new THREE.Mesh(getCachedCylGeo(0.155, 0.155, 0.52, 12, 1, false, 'x'), makeMat(0x1e293b));
    coolingShroud.position.set(0, 0.02, 0.48);

    const muzzleBrake = new THREE.Mesh(getCachedCylGeo(0.14, 0.12, 0.18, 12, 1, false, 'x'), makeMat(0x64748b));
    muzzleBrake.position.set(0, 0.02, 1.14);

    const muzzleCore = new THREE.Mesh(getCachedCylGeo(0.085, 0.085, 0.2, 10, 1, false, 'x'), makeGlowMat(0x38bdf8, 2.8));
    muzzleCore.position.set(0, 0.02, 1.18);

    turretPivot.add(barrel, coolingShroud, muzzleBrake, muzzleCore);
    root.add(turretPivot);
    root.userData.turretPivot = turretPivot;
    if (!isGhost) mod.spinMesh = turretPivot;
  } else if (k === 'HEADLIGHT') {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.28), makeMat(0x1e293b));
    bracket.position.y = -0.18;
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.28, 12), makeMat(0x334155));
    housing.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.06, 12), makeMat(0xfacc15));
    rim.rotation.x = Math.PI / 2;
    rim.position.z = 0.12;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 12), makeGlowMat(0xffedd5, 2.8));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.15;
    root.add(bracket, housing, rim, lens);
  } else if (
    k === 'AERO_WING' ||
    k === 'WING_STANDARD' ||
    k === 'SPOILER' ||
    k === 'TAILFIN' ||
    k === 'TAILFIN_POWERED' ||
    k === 'AERO_BLADE'
  ) {
    const isTail = k === 'TAILFIN' || k === 'TAILFIN_POWERED';
    const isSpoiler = k === 'SPOILER';
    const wingColor = isTail ? 0x0284c7 : isSpoiler ? 0x1e293b : 0x0284c7;

    const baseMount = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.82), makeMat(0x1e293b));
    root.add(baseMount);

    if (isSpoiler) {
      for (const sx of [-0.44, 0.44]) {
        const riser = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.14), makeMat(0x94a3b8));
        riser.position.set(sx, 0.2, 0);
        root.add(riser);
      }
      const foil = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.06, 0.38), makeMat(0x0f172a));
      foil.position.set(0, 0.38, 0);
      foil.rotation.x = -0.12;
      root.add(foil);
    } else if (isTail) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.94, 0.82), makeMat(wingColor));
      fin.position.set(0, 0.48, -0.1);
      fin.rotation.x = -0.22;
      root.add(fin);
    } else {
      // Main Airfoil Blade with swept wingtip winglet
      const foil = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.08, 0.62), makeMat(wingColor));
      foil.position.set(0, 0.06, 0);
      const winglet = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.38), makeMat(0xfacc15));
      winglet.position.set(0.64, 0.18, -0.06);
      root.add(foil, winglet);
    }
  } else if (k === 'VTOL_ROTOR') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.54, 10), makeMat(0x334155));
    mast.position.y = 0.22;
    const rotorHead = new THREE.Group();
    rotorHead.position.y = 0.48;

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 10), makeMat(0x0f172a));
    rotorHead.add(hub);

    for (let b = 0; b < 2; b++) {
      const ang = (b * Math.PI);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.04, 0.14), makeMat(0xfacc15));
      blade.rotation.y = ang;
      rotorHead.add(blade);
    }
    root.add(mast, rotorHead);
    root.userData.propellerHub = rotorHead;
    if (!isGhost) mod.spinMesh = rotorHead;
  } else if (k === 'GYRO' || k === 'GYRO_REACTION') {
    const gyroBase = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.18, 0.68), makeMat(0x1e293b));
    gyroBase.position.y = -0.22;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 16), makeMat(0x94a3b8));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), makeGlowMat(0x38bdf8, 2.2));
    root.add(gyroBase, ring, core);
    if (!isGhost) mod.spinMesh = ring;
  } else if (k === 'SUSPENSION') {
    const topMount = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.32), makeMat(0x1e293b));
    topMount.position.y = 0.28;
    const damperShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.62, 8), makeMat(0xe2e8f0));
    const springCoil = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.44, 8), makeMat(0xf97316));
    springCoil.position.y = 0.04;
    root.add(topMount, damperShaft, springCoil);
  } else if (k === 'STEERING_HINGE') {
    const lowerPlate = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.38), makeMat(0x1e293b));
    lowerPlate.position.y = -0.22;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.48, 8), makeMat(0xe2e8f0));
    const upperYoke = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.42), makeMat(0x3b82f6));
    upperYoke.position.y = 0.16;
    root.add(lowerPlate, pin, upperYoke);
  } else if (k === 'PISTON') {
    const outerTube = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.5, 10), makeMat(0xf97316));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 8), makeMat(0xe2e8f0));
    rod.position.y = -0.26;
    const footPad = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.44), makeMat(0x334155));
    footPad.position.y = -0.58;
    const innerRam = new THREE.Group();
    innerRam.add(rod, footPad);
    root.add(outerTube, innerRam);
    if (!isGhost) mod.spinMesh = innerRam;
  } else if (k === 'GRAPPLING_WINCH') {
    const basePlate = new THREE.Mesh(getCachedBoxGeo(0.56, 0.1, 0.54), makeMat(0x0f172a));
    basePlate.position.y = -0.2;
    root.add(basePlate);

    for (const sx of [-0.22, 0.22]) {
      const cheekPlate = new THREE.Mesh(getCachedBoxGeo(0.07, 0.38, 0.48), makeMat(0x1e293b));
      cheekPlate.position.set(sx, 0, 0);
      root.add(cheekPlate);
    }

    // Fairlead rollers on front mouth
    const rollerH = new THREE.Mesh(getCachedCylGeo(0.03, 0.03, 0.38, 8, 1, false, 'z'), makeMat(0xe2e8f0));
    rollerH.position.set(0, 0.1, 0.24);
    const rollerB = new THREE.Mesh(getCachedCylGeo(0.03, 0.03, 0.38, 8, 1, false, 'z'), makeMat(0xe2e8f0));
    rollerB.position.set(0, -0.08, 0.24);
    root.add(rollerH, rollerB);

    // Rotating Cable Spool Drum
    const spoolGroup = new THREE.Group();
    spoolGroup.name = 'WinchSpool';
    const drumCore = new THREE.Mesh(getCachedCylGeo(0.16, 0.16, 0.36, 12, 1, false, 'z'), makeMat(0xfacc15));
    const cableWrap = new THREE.Mesh(getCachedCylGeo(0.18, 0.18, 0.28, 12, 1, false, 'z'), makeMat(0x64748b));
    const gearFlange = new THREE.Mesh(getCachedCylGeo(0.2, 0.2, 0.04, 10, 1, false, 'z'), makeMat(0x94a3b8));
    gearFlange.position.x = 0.16;
    spoolGroup.add(drumCore, cableWrap, gearFlange);
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
  } else if (k === 'SKI_SLIDER') {
    const mount = new THREE.Mesh(getCachedBoxGeo(0.26, 0.1, 0.26), makeMat(0x334155));
    const strutF = new THREE.Mesh(getCachedBoxGeo(0.1, 0.44, 0.1), makeMat(0x94a3b8));
    strutF.position.set(0, -0.22, 0.18);
    strutF.rotation.x = 0.2;
    const strutR = strutF.clone();
    strutR.position.z = -0.18;
    strutR.rotation.x = -0.2;
    const runner = new THREE.Mesh(getCachedBoxGeo(0.32, 0.07, 1.42), makeMat(0x38bdf8));
    runner.position.y = -0.45;
    const keel = new THREE.Mesh(getCachedBoxGeo(0.12, 0.08, 1.24), makeMat(0x0284c7));
    keel.position.y = -0.41;
    const tip = new THREE.Mesh(getCachedBoxGeo(0.32, 0.14, 0.34), makeMat(0xfacc15));
    tip.position.set(0, -0.37, 0.78);
    tip.rotation.x = -0.48;
    root.add(mount, strutF, strutR, runner, keel, tip);
  } else if (k === 'WEAPON_MINIGUN') {
    const baseRing = new THREE.Mesh(getCachedCylGeo(0.32, 0.36, 0.12, 12), makeMat(0x1e293b));
    baseRing.position.y = -0.2;
    root.add(baseRing);

    const turretPivot = new THREE.Group();
    turretPivot.name = 'TurretPivot';
    const receiver = new THREE.Mesh(getCachedBoxGeo(0.52, 0.38, 0.58), makeMat(0x334155));
    const ammoDrum = new THREE.Mesh(getCachedCylGeo(0.19, 0.19, 0.38, 12, 1, false, 'z'), makeMat(0xeab308));
    ammoDrum.position.set(0, -0.08, -0.1);

    const cluster = new THREE.Group();
    cluster.name = 'GatlingCluster';
    const clampF = new THREE.Mesh(getCachedCylGeo(0.165, 0.165, 0.1, 12, 1, false, 'x'), makeMat(0x94a3b8));
    clampF.position.z = 0.88;
    const clampM = new THREE.Mesh(getCachedCylGeo(0.165, 0.165, 0.08, 12, 1, false, 'x'), makeMat(0x64748b));
    clampM.position.z = 0.52;
    cluster.add(clampF, clampM);

    const barrelGeo = getCachedCylGeo(0.032, 0.032, 1.08, 8, 1, false, 'x');
    for (let b = 0; b < 6; b++) {
      const ang = (b * Math.PI * 2) / 6;
      const bMesh = new THREE.Mesh(barrelGeo, makeMat(0xe2e8f0));
      bMesh.position.set(Math.cos(ang) * 0.095, Math.sin(ang) * 0.095, 0.56);
      cluster.add(bMesh);
    }
    cluster.position.y = 0.06;
    turretPivot.add(receiver, ammoDrum, cluster);
    root.add(turretPivot);
    root.userData.turretPivot = turretPivot;
    root.userData.spinMesh = cluster;
    if (!isGhost) mod.spinMesh = cluster;
  } else if (k === 'WEAPON_ROCKET') {
    const basePedestal = new THREE.Mesh(getCachedCylGeo(0.3, 0.34, 0.12, 12), makeMat(0x1e293b));
    basePedestal.position.y = -0.2;
    root.add(basePedestal);

    const turretPivot = new THREE.Group();
    turretPivot.name = 'TurretPivot';
    const pod = new THREE.Mesh(getCachedBoxGeo(0.68, 0.48, 0.86), makeMat(0x991b1b));
    pod.position.y = 0.06;
    const faceplate = new THREE.Mesh(getCachedBoxGeo(0.64, 0.42, 0.06), makeMat(0x0f172a));
    faceplate.position.set(0, 0.06, 0.42);
    const rearVents = new THREE.Mesh(getCachedBoxGeo(0.62, 0.38, 0.06), makeMat(0x334155));
    rearVents.position.set(0, 0.06, -0.42);
    turretPivot.add(pod, faceplate, rearVents);

    const tubeGeo = getCachedCylGeo(0.11, 0.11, 0.88, 10, 1, false, 'x');
    const warheadGeo = getCachedConeGeo(0.095, 0.24, 10, 'x');
    for (const ox of [-0.16, 0.16]) {
      for (const oy of [-0.05, 0.17]) {
        const tube = new THREE.Mesh(tubeGeo, makeMat(0x1e293b));
        tube.position.set(ox, oy, 0.02);
        const warhead = new THREE.Mesh(warheadGeo, makeMat(0xfacc15));
        warhead.position.set(ox, oy, 0.52);
        turretPivot.add(tube, warhead);
      }
    }
    root.add(turretPivot);
    root.userData.turretPivot = turretPivot;
    if (!isGhost) mod.spinMesh = turretPivot;
  } else if (k === 'WEAPON_BOMB_BAY') {
    const bay = new THREE.Mesh(getCachedBoxGeo(0.72, 0.24, 0.84), makeMat(0x334155));
    bay.position.y = 0.1;
    const stripe = new THREE.Mesh(getCachedBoxGeo(0.74, 0.07, 0.86), makeMat(0xf97316));
    stripe.position.y = 0.16;
    const turretPivot = new THREE.Group();
    turretPivot.name = 'TurretPivot';
    const bomb = new THREE.Mesh(getCachedCylGeo(0.16, 0.16, 0.62, 12, 1, false, 'x'), makeMat(0x1e293b));
    bomb.position.y = -0.16;
    const nose = new THREE.Mesh(getCachedConeGeo(0.16, 0.22, 12, 'x'), makeMat(0xfacc15));
    nose.position.set(0, -0.16, 0.41);
    const tailFins = new THREE.Mesh(getCachedBoxGeo(0.38, 0.38, 0.14), makeMat(0xef4444));
    tailFins.position.set(0, -0.16, -0.28);
    turretPivot.add(bomb, nose, tailFins);
    root.add(bay, stripe, turretPivot);
    root.userData.turretPivot = turretPivot;
  } else if (k === 'WEAPON_MELEE') {
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.48), makeMat(0x334155));
    const bladeBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 1.58), makeMat(0x94a3b8));
    bladeBody.position.z = 0.92;
    const plasmaEdge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 1.66), makeGlowMat(0xe879f9, 2.5));
    plasmaEdge.position.z = 0.95;
    root.add(hilt, bladeBody, plasmaEdge);
  } else if (
    k === 'PONTOON_LARGE' ||
    (k as string) === 'FLOAT_PONTOON' ||
    (k as string) === 'HEAVY_PONTOON'
  ) {
    // Tapered high-visibility yellow/slate hydrodynamic pontoon hull with top mounting rails
    const hullMat = makeMat(0xfacc15);
    const slateMat = makeMat(0x334155);
    const darkMat = makeMat(0x1e293b);

    // Main central pontoon hull body
    const hullBody = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.78, 12), hullMat);
    hullBody.rotation.x = Math.PI / 2;

    // Tapered hydrodynamic bow cone (front) & stern cone (rear)
    const bowCone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.36, 12), hullMat);
    bowCone.rotation.x = Math.PI / 2;
    bowCone.position.z = 0.57;

    const sternCone = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.28, 0.24, 12), slateMat);
    sternCone.rotation.x = Math.PI / 2;
    sternCone.position.z = -0.51;

    // Keel skeg & side rub-strakes
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 1.02), darkMat);
    keel.position.y = -0.26;
    const strakeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.84), slateMat);
    strakeL.position.set(-0.27, 0, 0.02);
    const strakeR = strakeL.clone();
    strakeR.position.x = 0.27;

    // Top structural mounting rail & cross-cleats
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.76), slateMat);
    topRail.position.y = 0.27;
    for (const cz of [-0.24, 0.24]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.295, 0.295, 0.07, 12), darkMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.z = cz;
      root.add(collar);
    }

    root.add(hullBody, bowCone, sternCone, keel, strakeL, strakeR, topRail);
  } else if (k === 'BCD_TANK' || (k as string) === 'BALLAST_TANK') {
    // Bolted dark-iron submarine ballast tank with pressure valves & water-level gauge
    const ironMat = makeMat(0x1e293b);
    const tankMat = makeMat(0x0891b2);
    const brassMat = makeMat(0xf59e0b);
    const chromeMat = makeMat(0xe2e8f0);

    // Lower & upper bolted cradle frame
    const cradleB = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.78), ironMat);
    cradleB.position.y = -0.24;
    const cradleT = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.72), ironMat);
    cradleT.position.y = 0.22;

    // Twin cylindrical high-pressure flood chambers
    for (const sx of [-0.18, 0.18]) {
      const chamber = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.76, 12), tankMat);
      chamber.rotation.x = Math.PI / 2;
      chamber.position.set(sx, 0, 0);

      const capF = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), ironMat);
      capF.scale.set(1, 1, 0.55);
      capF.position.set(sx, 0, 0.38);
      const capR = capF.clone();
      capR.position.z = -0.38;
      root.add(chamber, capF, capR);
    }

    // Top pressure purge valve wheel & manifold pipe
    const valveStem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), chromeMat);
    valveStem.position.y = 0.29;
    const valveWheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 12), brassMat);
    valveWheel.rotation.x = Math.PI / 2;
    valveWheel.position.y = 0.36;

    // Illuminated water-level sight gauge strip
    const gaugeStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.28, 0.04),
      makeGlowMat(0x22d3ee, 2.2),
    );
    gaugeStrip.position.set(0, 0, 0.41);

    root.add(cradleB, cradleT, valveStem, valveWheel, gaugeStrip);
  } else if (k === 'WEIGHT_BLOCK' || (k as string) === 'LEAD_WEIGHT') {
    // Heavy bolted dark-iron lead ballast anvil block with hazard trim & lifting eye
    const leadMat = makeMat(0x334155);
    const darkIronMat = makeMat(0x0f172a);
    const hazardMat = makeMat(0xfacc15);
    const chromeMat = makeMat(0xe2e8f0);

    const coreBlock = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.52, 0.74), leadMat);
    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.66), darkIronMat);
    topPlate.position.y = 0.28;
    const botPlate = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.1, 0.78), darkIronMat);
    botPlate.position.y = -0.28;

    // Yellow industrial weight hazard bands
    const bandF = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.1, 0.04), hazardMat);
    bandF.position.set(0, -0.1, 0.37);
    const bandR = bandF.clone();
    bandR.position.z = -0.37;

    // Corner reinforcement rivets
    for (const bx of [-0.26, 0.26]) {
      for (const bz of [-0.26, 0.26]) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 6), chromeMat);
        bolt.position.set(bx, 0, bz);
        root.add(bolt);
      }
    }

    // Top hoist lifting eye-ring
    const hoistRing = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 8, 12), chromeMat);
    hoistRing.position.y = 0.38;

    root.add(coreBlock, topPlate, botPlate, bandF, bandR, hoistRing);
  } else if (k === 'HINGE_LARGE' || k === 'HINGE_TRAILER' || k === 'JOINT_MECH') {
    // Articulated mechanical hinge / trailer ball hitch / robotic limb joint
    const baseMat = makeMat(0x1e293b);
    const accentColor =
      k === 'HINGE_LARGE' ? 0xf97316 : k === 'JOINT_MECH' ? 0xa855f7 : 0x94a3b8;
    const armMat = makeMat(accentColor);
    const pinMat = makeMat(0xe2e8f0);

    const baseBracket = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.54), baseMat);
    baseBracket.position.y = -0.24;

    if (k === 'HINGE_TRAILER') {
      // Tow tongue + polished chrome trailer hitch ball + socket coupler
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.24, 10), baseMat);
      neck.position.y = -0.08;
      const towBall = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), pinMat);
      towBall.position.y = 0.08;
      const socketHood = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.18, 12), armMat);
      socketHood.position.set(0, 0.2, -0.06);
      root.add(baseBracket, neck, towBall, socketHood);
    } else {
      // Twin clevis ears + transverse chrome pivot axle + upper actuator yoke
      for (const sx of [-0.18, 0.18]) {
        const ear = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.32), baseMat);
        ear.position.set(sx, -0.05, 0);
        root.add(ear);
      }
      const axlePin = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.52, 10), pinMat);
      axlePin.rotation.z = Math.PI / 2;
      axlePin.position.y = 0.02;

      const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.28), armMat);
      upperArm.position.y = 0.16;
      const topFlange = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), armMat);
      topFlange.position.y = 0.32;
      root.add(baseBracket, axlePin, upperArm, topFlange);
    }
  } else if (k === 'SERVO_SPIN' || k === 'SERVO_SMALL') {
    // Electric rotary servo motor with ribbed stator housing & splined output turntable
    const isSmall = k === 'SERVO_SMALL';
    const sc = isSmall ? 0.78 : 1.0;
    const statorMat = makeMat(0x1e293b);
    const rotorMat = makeMat(isSmall ? 0x34d399 : 0x10b981);
    const chromeMat = makeMat(0xe2e8f0);

    const baseFlange = new THREE.Mesh(
      new THREE.BoxGeometry(0.62 * sc, 0.1 * sc, 0.62 * sc),
      statorMat,
    );
    baseFlange.position.y = -0.24 * sc;

    const motorCan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26 * sc, 0.26 * sc, 0.36 * sc, 14),
      statorMat,
    );
    motorCan.position.y = -0.04 * sc;

    // Cooling ring ribs
    for (const ry of [-0.1 * sc, 0.04 * sc]) {
      const rib = new THREE.Mesh(
        new THREE.CylinderGeometry(0.285 * sc, 0.285 * sc, 0.045 * sc, 14),
        makeMat(0x475569),
      );
      rib.position.y = ry;
      root.add(rib);
    }

    const rotorGroup = new THREE.Group();
    rotorGroup.position.y = 0.2 * sc;
    const turntable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28 * sc, 0.24 * sc, 0.1 * sc, 14),
      rotorMat,
    );
    const crossKey = new THREE.Mesh(
      new THREE.BoxGeometry(0.42 * sc, 0.06 * sc, 0.12 * sc),
      chromeMat,
    );
    crossKey.position.y = 0.05 * sc;
    const crossKey2 = crossKey.clone();
    crossKey2.rotation.y = Math.PI / 2;
    rotorGroup.add(turntable, crossKey, crossKey2);

    const statusLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.12 * sc, 0.06 * sc, 0.04 * sc),
      makeGlowMat(0x4ade80, 2.2),
    );
    statusLed.position.set(0, -0.04 * sc, 0.27 * sc);

    root.add(baseFlange, motorCan, rotorGroup, statusLed);
    if (!isGhost) mod.spinMesh = rotorGroup;
  } else if (k === 'DETACHABLE_BLOCK') {
    // Pyrotechnic explosive bolt stage-separation coupler
    const clampMat = makeMat(0x1e293b);
    const chargeMat = makeMat(0xdc2626);
    const hazardMat = makeMat(0xfacc15);

    const lowerJaw = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.56), clampMat);
    lowerJaw.position.y = -0.2;
    const upperJaw = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.56), clampMat);
    upperJaw.position.y = 0.2;

    const pyroCore = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.26, 12), chargeMat);
    const hazardRing = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 12), hazardMat);
    const armedLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 8),
      makeGlowMat(0xef4444, 2.5),
    );
    armedLed.position.set(0, 0, 0.24);

    root.add(lowerJaw, upperJaw, pyroCore, hazardRing, armedLed);
  } else if (k === 'MICROBIT_ECU') {
    // Official stylized Micro:bit V2 / V3 Controller Block
    // Matte dark circuit board, gold edge-connector pins, tactile buttons A & B, and active 5x5 LED matrix
    const pcbMat = makeMat(0x0f172a);
    const goldMat = makeMat(0xf59e0b);
    const btnMat = makeMat(0x18181b);
    const bezelMat = makeMat(0x64748b);

    // Main PCB Chassis
    const pcbBoard = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.12, 0.64), pcbMat);
    pcbBoard.position.y = -0.06;
    root.add(pcbBoard);

    // Gold edge-connector bus at the front edge
    const goldBus = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.025, 0.12), goldMat);
    goldBus.position.set(0, 0.01, 0.25);
    root.add(goldBus);

    // Gold contact pads divider slots
    for (const gx of [-0.22, -0.11, 0, 0.11, 0.22]) {
      const pinNotch = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.03, 0.13), pcbMat);
      pinNotch.position.set(gx, 0.015, 0.25);
      root.add(pinNotch);
    }

    // Tactile Button A (Left) with metal bezel ring
    const btnRingA = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.035, 10), bezelMat);
    btnRingA.position.set(-0.21, 0.015, 0.02);
    const btnCapA = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.045, 10), btnMat);
    btnCapA.position.set(-0.21, 0.02, 0.02);
    const labelA = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.04), makeMat(0xe2e8f0));
    labelA.position.set(-0.21, 0.01, -0.07);
    root.add(btnRingA, btnCapA, labelA);

    // Tactile Button B (Right) with metal bezel ring
    const btnRingB = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.035, 10), bezelMat);
    btnRingB.position.set(0.21, 0.015, 0.02);
    const btnCapB = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.045, 10), btnMat);
    btnCapB.position.set(0.21, 0.02, 0.02);
    const labelB = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.04), makeMat(0xe2e8f0));
    labelB.position.set(0.21, 0.01, -0.07);
    root.add(btnRingB, btnCapB, labelB);

    // Dynamic 5x5 LED Matrix Array centered on the top face
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

    // Status / BLE antenna trace at rear
    const antTrace = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.015, 0.04), goldMat);
    antTrace.position.set(0, 0.01, -0.24);
    root.add(antTrace);
  } else if (k === 'SENSOR_TARGET_RADAR') {
    // 360-degree Rotating Target Radar & Tracking Gimbal
    const basePedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.16, 12), makeMat(0x1e293b));
    basePedestal.position.y = -0.16;
    const neckCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12), makeMat(0x64748b));
    neckCollar.position.y = -0.04;
    root.add(basePedestal, neckCollar);

    const dishGroup = new THREE.Group();
    dishGroup.position.y = 0.06;

    // Parabolic tracking dish
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.12, 0.14, 14), makeMat(0xe2e8f0));
    dish.rotation.x = Math.PI * 0.35;
    const dishCore = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), makeGlowMat(0xa855f7, 2.5));
    dishCore.position.z = 0.08;
    const feedHorn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6), makeMat(0xf59e0b));
    feedHorn.rotation.x = Math.PI * 0.35;
    feedHorn.position.z = 0.12;

    dishGroup.add(dish, dishCore, feedHorn);
    root.add(dishGroup);
    if (!isGhost) mod.spinMesh = dishGroup;
  } else if (k === 'SENSOR_IMU_TILT') {
    // 3-Axis Gyro & Inclinometer block with etched coordinate arrows
    const bodyMat = makeMat(0xfacc15); // High-viz yellow
    const slateMat = makeMat(0x1e293b);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.28, 0.60), slateMat);
    chassis.position.y = -0.10;
    const yellowCap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.56), bodyMat);
    yellowCap.position.y = 0.07;
    root.add(chassis, yellowCap);

    // Cross axis markings (Pitch & Roll lines)
    const axisX = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.02, 0.05), slateMat);
    axisX.position.y = 0.11;
    const axisZ = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.46), slateMat);
    axisZ.position.y = 0.11;
    const centerGyro = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), makeGlowMat(0x38bdf8, 2.2));
    centerGyro.position.y = 0.12;
    root.add(axisX, axisZ, centerGyro);
  } else if (k === 'SENSOR_SPEEDO') {
    // Pitot Tube Aerodynamic Probe + Telemetry Housing
    const casing = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.28, 0.58), makeMat(0x1e293b));
    casing.position.y = -0.10;
    root.add(casing);

    // Long forward needle probe
    const probeMast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.46, 8), makeMat(0xe2e8f0));
    probeMast.rotation.x = Math.PI / 2;
    probeMast.position.set(0, 0.02, 0.46);
    const probeTip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.10, 8), makeMat(0xf59e0b));
    probeTip.rotation.x = Math.PI / 2;
    probeTip.position.set(0, 0.02, 0.70);
    const speedLed = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.04), makeGlowMat(0x10b981, 2.4));
    speedLed.position.set(0, 0.06, 0.29);
    root.add(probeMast, probeTip, speedLed);
  } else if (
    k === 'SENSOR_DISTANCE' ||
    k === 'SENSOR_SPEED' ||
    k === 'SENSOR_ALTIMETER' ||
    k === 'SENSOR_ANGLE' ||
    k === 'SENSOR_POSITION' ||
    k === 'RADIO_TRX' ||
    k === 'LOGIC_GATE'
  ) {
    // Structured electronics box with machined cooling fins, LED status strips, and specialized sensor/logic optics
    const caseMat = makeMat(0x1e293b);
    const finMat = makeMat(0x64748b);
    const chromeMat = makeMat(0xe2e8f0);
    const accentHex =
      k === 'SENSOR_DISTANCE'
        ? 0xef4444 // Red laser diode for laser rangefinder!
        : k === 'SENSOR_SPEED'
          ? 0x22c55e
          : k === 'SENSOR_ALTIMETER'
            ? 0x38bdf8
            : k === 'SENSOR_ANGLE'
              ? 0xfacc15
              : k === 'SENSOR_POSITION'
                ? 0xa3e635
                : k === 'RADIO_TRX'
                  ? 0x2dd4bf
                  : 0x10b981;
    const ledMat = makeGlowMat(accentHex, 2.4);

    // Main ruggedized avionics enclosure
    const chassisBox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.62), caseMat);
    chassisBox.position.y = -0.06;
    root.add(chassisBox);

    // Side aluminum cooling heatsink fins
    for (let f = -1; f <= 1; f++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.045, 0.48), finMat);
      fin.position.set(0, -0.06 + f * 0.1, 0);
      root.add(fin);
    }

    // Front glowing LED telemetry status bar
    const statusStrip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.04), ledMat);
    statusStrip.position.set(0, -0.16, 0.31);
    root.add(statusStrip);

    if (k === 'SENSOR_DISTANCE') {
      // Twin laser rangefinder optical barrels with glowing red laser emitter on front face
      for (const sx of [-0.14, 0.14]) {
        const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 12), chromeMat);
        bezel.rotation.x = Math.PI / 2;
        bezel.position.set(sx, 0.02, 0.34);
        const laserLens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 12), ledMat);
        laserLens.rotation.x = Math.PI / 2;
        laserLens.position.set(sx, 0.02, 0.345);
        root.add(bezel, laserLens);
      }
      // Center laser targeting dot
      const centerDot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), makeGlowMat(0xef4444, 3.0));
      centerDot.position.set(0, 0.02, 0.36);
      root.add(centerDot);
    } else if (k === 'SENSOR_SPEED') {
      // Forward pitot tube probe + top anemometer cup rotor
      const pitotTube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.42, 8), chromeMat);
      pitotTube.rotation.x = Math.PI / 2;
      pitotTube.position.set(0, 0.02, 0.46);
      const rotorMast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), chromeMat);
      rotorMast.position.y = 0.22;
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.08), ledMat);
      vane.position.y = 0.32;
      root.add(pitotTube, rotorMast, vane);
    } else if (k === 'SENSOR_ALTIMETER') {
      // Barometric static pressure dome & vertical altitude scale bar
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), ledMat);
      dome.scale.set(1, 0.65, 1);
      dome.position.y = 0.14;
      const guardRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 14), chromeMat);
      guardRing.rotation.x = Math.PI / 2;
      guardRing.position.y = 0.15;
      root.add(dome, guardRing);
    } else if (k === 'SENSOR_ANGLE') {
      // Horizon inclinometer gimbal ring & pendulum plumb core
      const dialRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 8, 16), chromeMat);
      dialRing.position.y = 0.22;
      const horizonBar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.045), ledMat);
      horizonBar.position.y = 0.22;
      root.add(dialRing, horizonBar);
    } else if (k === 'SENSOR_POSITION') {
      // Ceramic GPS radome patch antenna + corner beacon
      const radome = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.12, 12), chromeMat);
      radome.position.y = 0.18;
      const patchCore = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 12), ledMat);
      patchCore.position.y = 0.185;
      root.add(radome, patchCore);
    } else if (k === 'RADIO_TRX') {
      // Dual whip antennas + glowing channel transceiver matrix
      for (const sx of [-0.18, 0.18]) {
        const baseCoil = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 8), makeMat(0xfacc15));
        baseCoil.position.set(sx, 0.18, -0.14);
        const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.48, 6), chromeMat);
        whip.position.set(sx, 0.42, -0.14);
        root.add(baseCoil, whip);
      }
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.04), ledMat);
      screen.position.set(0, 0.0, 0.31);
      root.add(screen);
    } else {
      // LOGIC_GATE microprocessor die, gold connector pins & glowing boolean gate matrix
      const cpuDie = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), makeMat(0x0f172a));
      cpuDie.position.y = 0.16;
      const gateMatrix = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.26), ledMat);
      gateMatrix.position.y = 0.165;
      for (const px of [-0.22, 0, 0.22]) {
        const pinBus = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.72), makeMat(0xfacc15));
        pinBus.position.set(px, 0.13, 0);
        root.add(pinBus);
      }
      root.add(cpuDie, gateMatrix);
    }
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
    // 101. Motorized 360° Turret Azimuth Ring with geared raceway & rotating top mount
    const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.12, 0.86), makeMat(0x1e293b));
    basePlate.position.y = -0.18;
    const outerRace = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.16, 16), makeMat(0x334155));
    outerRace.position.y = -0.06;
    const gearRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 8, 16), makeMat(0xf59e0b));
    gearRing.rotation.x = Math.PI / 2;
    gearRing.position.y = 0.02;
    const turretDeck = new THREE.Group();
    turretDeck.position.y = 0.08;
    const topDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 16), makeMat(0x475569));
    const aimArrow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.42), makeGlowMat(0xfacc15, 2.0));
    aimArrow.position.set(0, 0.06, 0.14);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), makeMat(0x94a3b8));
      clamp.position.set(Math.cos(a) * 0.28, 0.04, Math.sin(a) * 0.28);
      turretDeck.add(clamp);
    }
    turretDeck.add(topDisk, aimArrow);
    root.add(basePlate, outerRace, gearRing, turretDeck);
    if (!isGhost) {
      mod.turretPivot = turretDeck;
      mod.spinMesh = turretDeck;
    }
  } else if (k === 'MAGNET_COUPLER') {
    // 102. Tractor-Beam & Electromagnet Coupler with copper field coils & twin glowing emitter poles
    const chassisMount = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.28, 0.56), makeMat(0x1e293b));
    chassisMount.position.z = -0.12;
    const coreCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.36, 14), makeMat(0xb45309));
    coreCyl.rotation.x = Math.PI / 2;
    coreCyl.position.z = 0.08;
    const emitterGroup = new THREE.Group();
    emitterGroup.position.z = 0.28;
    const fieldRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 8, 16), makeGlowMat(0x38bdf8, 2.6));
    const innerLens = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.08, 12), makeGlowMat(0x00f5ff, 3.0));
    innerLens.rotation.x = Math.PI / 2;
    for (const sx of [-0.24, 0.24]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.18), makeMat(0xef4444));
      pole.position.set(sx, 0, -0.04);
      const poleTip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.06), makeMat(0xe2e8f0));
      poleTip.position.set(sx, 0, 0.07);
      emitterGroup.add(pole, poleTip);
    }
    emitterGroup.add(fieldRing, innerLens);
    root.add(chassisMount, coreCyl, emitterGroup);
    if (!isGhost) mod.spinMesh = emitterGroup;
  } else if (k === 'TANK_TREAD') {
    // 103. Heavy Armored Tank Tread Bogie with drive sprockets, road wheels & continuous rubber-steel belt
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.48), makeMat(0x334155));
    strut.position.y = 0.16;
    const armorSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 1.32), makeMat(0x4d7c0f));
    armorSkirt.position.y = 0.08;
    const beltOuter = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.56, 1.28), makeMat(0x111827));
    beltOuter.position.y = -0.14;
    const wheelsGroup = new THREE.Group();
    wheelsGroup.position.y = -0.14;
    for (const wz of [-0.44, 0, 0.44]) {
      const bogie = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.45, 12), makeMat(0x64748b));
      bogie.rotation.z = Math.PI / 2;
      bogie.position.set(0, 0, wz);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.47, 8), makeMat(0xfacc15));
      hub.rotation.z = Math.PI / 2;
      hub.position.set(0, 0, wz);
      wheelsGroup.add(bogie, hub);
    }
    for (let t = -3; t <= 3; t++) {
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.08), makeMat(0x374151));
      cleat.position.set(0, -0.43, t * 0.17);
      root.add(cleat);
    }
    root.add(strut, armorSkirt, beltOuter, wheelsGroup);
    if (!isGhost) mod.spinMesh = wheelsGroup;
  } else if (k === 'PARACHUTE_AIRBRAKE') {
    // 104. Deployable Parachute Canister & Twin Aerodynamic Airbrake Flaps
    const packBox = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.34, 0.52), makeMat(0x334155));
    packBox.position.y = -0.12;
    const packCap = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.46), makeMat(0xf97316));
    packCap.position.y = 0.08;
    const canopyGroup = new THREE.Group();
    canopyGroup.position.y = 0.14;
    // Airbrake side flaps + overhead dome canopy (scales up when deployed in physics)
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      makeMat(0xf97316),
    );
    dome.position.y = 0.36;
    const domeStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.12, 0.22),
      makeMat(0xf8fafc),
    );
    domeStripe.position.y = 0.56;
    for (const sx of [-0.28, 0.28]) {
      for (const sz of [-0.22, 0.22]) {
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.46, 6), makeMat(0xe2e8f0));
        cord.position.set(sx * 0.65, 0.2, sz * 0.65);
        canopyGroup.add(cord);
      }
    }
    canopyGroup.add(dome, domeStripe);
    canopyGroup.scale.set(0.28, 0.18, 0.28);
    root.add(packBox, packCap, canopyGroup);
    if (!isGhost) mod.spinMesh = canopyGroup;
  } else if (k === 'OUTRIGGER_JACK') {
    // 105. Hydraulic Outrigger Stabilizer Jack with extendable vertical ram & heavy hazard footpad
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.62, 12), makeMat(0x1e293b));
    housing.position.y = 0.08;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 12), makeMat(0xfacc15));
    collar.position.y = -0.18;
    const ramGroup = new THREE.Group();
    const chromeRod = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.58, 10), makeMat(0xe2e8f0));
    chromeRod.position.y = -0.22;
    const footPad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.1, 12), makeMat(0xf59e0b));
    footPad.position.y = -0.5;
    const gripBase = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 12), makeMat(0x0f172a));
    gripBase.position.y = -0.56;
    ramGroup.add(chromeRod, footPad, gripBase);
    root.add(housing, collar, ramGroup);
    if (!isGhost) mod.spinMesh = ramGroup;
  } else if (k === 'IMPULSE_BUMPER') {
    // 106. Kinetic Spring-Impulse Ramming Bumper Plate
    const backMount = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.36, 0.18), makeMat(0x1e293b));
    backMount.position.z = -0.22;
    const plateGroup = new THREE.Group();
    for (const sx of [-0.24, 0.24]) {
      const springCoil = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.36, 10), makeMat(0xa855f7));
      springCoil.rotation.x = Math.PI / 2;
      springCoil.position.set(sx, 0, -0.02);
      plateGroup.add(springCoil);
    }
    const ramShield = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.48, 0.16), makeMat(0x334155));
    ramShield.position.z = 0.2;
    const hazardBar = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.16, 0.18), makeGlowMat(0xfacc15, 1.8));
    hazardBar.position.z = 0.21;
    plateGroup.add(ramShield, hazardBar);
    root.add(backMount, plateGroup);
    if (!isGhost) mod.spinMesh = plateGroup;
  } else if (k === 'SMOKE_FLARE') {
    // 107. Multi-Tube Smoke & Thermal Flare Countermeasure Dispenser Rack
    const rackBase = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.16, 0.54), makeMat(0x1e293b));
    rackBase.position.y = -0.2;
    const launcherPod = new THREE.Group();
    launcherPod.rotation.x = -0.35;
    const podBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.28, 0.44), makeMat(0x475569));
    launcherPod.add(podBody);
    for (const sx of [-0.18, 0, 0.18]) {
      for (const sz of [-0.1, 0.1]) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.32, 8), makeMat(0x0f172a));
        tube.position.set(sx, 0.04, sz);
        const flareCap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), makeGlowMat(0xf43f5e, 2.4));
        flareCap.position.set(sx, 0.2, sz);
        launcherPod.add(tube, flareCap);
      }
    }
    root.add(rackBase, launcherPod);
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

  return optimizeModuleMeshHierarchy(root);
}

