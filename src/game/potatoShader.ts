import * as THREE from 'three';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DELIVERABLE 1: POTATO SHADER & CARTOON SHADER + VEHICLE OUTLINE SHADER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. POTATO SHADER (PENTIUM preset):
 *    - 40+ FPS on Intel Pentium G4400 + 4GB RAM + Intel HD Graphics
 *    - 3-band smoothstep cel-shading with warm sun key & cool sky hemisphere fill
 *    - Fresnel rim lighting (pow(1.0 - max(dot(N, V), 0.0), 3.0))
 *    - Separate vertex-color vs solid-color ShaderMaterials so meshes without a
 *      `color` BufferAttribute never glitch or read unbound WebGL vertex attributes.
 *
 * 2. CARTOON SHADER + GPU VEHICLE OUTLINE SHADER (CARTOON preset):
 *    - Vibrant comic-book saturation boost (1.35x)
 *    - Hard-stepped 3-tone cel shading bands + crisp cartoon specular highlight dot
 *    - Procedural 0.25m voxel-edge ink outlines in the fragment shader
 *    - Dedicated BackSide GPU normal-extrusion Vehicle Outline Shader (`createVehicleOutlineMaterial`)
 *      that draws a bold comic-book silhouette outline around the vehicle and its modules.
 */
export type ActiveShaderMode = 'PBR' | 'POTATO' | 'CARTOON';

export const POTATO_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  varying vec3 vColor;
  varying float vAo;
  varying vec2 vUv;
  varying float vFogDepth;

  void main() {
    #ifdef USE_COLOR
      vColor = color;
    #else
      vColor = vec3(1.0);
    #endif

    #ifdef USE_INSTANCING_COLOR
      vColor *= instanceColor;
    #endif

    #ifdef USE_AO
      vAo = ao;
    #else
      vAo = 1.0;
    #endif

    vec3 localPosition = position;
    #ifdef USE_SPAWN_POP
      if (spawnTime > 0.0) {
        float popAge = max(0.0, uCurrentTime - spawnTime);
        float popScale = mix(0.5, 1.0, clamp(popAge / 0.1, 0.0, 1.0));
        localPosition = voxelCenter + (localPosition - voxelCenter) * popScale;
      }
    #endif

    vUv = uv;

    vec4 localPos4 = vec4(localPosition, 1.0);
    vec3 objNormal = normal;
    #ifdef USE_INSTANCING
      localPos4 = instanceMatrix * localPos4;
      objNormal = mat3(instanceMatrix) * objNormal;
    #endif

    vec4 worldPosition = modelMatrix * localPos4;
    vWorldPos = worldPosition.xyz;

    // Transform normal to world space for consistent directional cel-shading
    vNormal = normalize(mat3(modelMatrix) * objNormal);

    // Compute view-space position directly from 64-bit RTE modelViewMatrix (jitter-free up to 1,000 km!)
    vec4 mvPosition = modelViewMatrix * localPos4;
    vec3 relWorldPos = mvPosition.xyz * mat3(viewMatrix);
    vViewDir = normalize(-relWorldPos);

    if (uPlanetCurvatureInv2R > 0.0) {
      float _h2 = relWorldPos.x * relWorldPos.x + relWorldPos.z * relWorldPos.z;
      float _drop = min(_h2 * uPlanetCurvatureInv2R, 650000.0);
      mvPosition.xyz -= viewMatrix[1].xyz * _drop;
    }

    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

export const POTATO_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  varying vec3 vColor;
  varying float vAo;
  varying vec2 vUv;
  varying float vFogDepth;

  uniform vec3 uBaseColor;
  uniform vec3 uLightDir;
  uniform vec3 uRimColor;
  uniform float uRimIntensity;
  uniform vec3 uSunTint;
  uniform vec3 uShadowTint;
  #ifdef USE_POTATO_MAP
    uniform sampler2D uMap;
  #endif
  uniform float uFogEnabled;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  void main() {
    #include <logdepthbuf_fragment>
    // Ultra-fast ALU path for integrated/mobile GPUs (zero pow, zero sin, zero unused uniforms)
    vec3 N = vNormal * (gl_FrontFacing ? 1.0 : -1.0);
    #ifdef USE_POTATO_MAP
      vec3 baseAlbedo = clamp(vColor * uBaseColor * texture2D(uMap, vUv).rgb * vAo, 0.0, 1.0);
    #else
      vec3 baseAlbedo = clamp(vColor * uBaseColor * vAo, 0.0, 1.0);
    #endif

    // Hemisphere AO + 3-band smoothstep cel shading
    float hemiAO = 0.84 + 0.08 * (N.y + 1.0);
    float NdotL = dot(N, uLightDir);
    float bandShadow = smoothstep(-0.12, 0.08, NdotL);
    float bandMid    = smoothstep(0.32, 0.48, NdotL);
    float bandHigh   = smoothstep(0.74, 0.88, NdotL);
    float celIntensity = (0.50 + 0.26 * bandShadow + 0.14 * bandMid + 0.10 * bandHigh) * hemiAO;
    vec3 lightColor = mix(uShadowTint, uSunTint, bandShadow);

    // Fast cubic Fresnel rim (zero transcendental pow)
    float fresnel = 1.0 - max(dot(N, vViewDir), 0.0);
    float rim = fresnel * fresnel * fresnel;
    vec3 litColor = baseAlbedo * lightColor * celIntensity + uRimColor * (rim * uRimIntensity * 0.65);

    if (uFogEnabled > 0.5) {
      float fogFactor = clamp((vFogDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
      litColor = mix(litColor, uFogColor, fogFactor);
    }

    gl_FragColor = vec4(clamp(litColor, 0.0, 1.0), 1.0);
  }
`;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CARTOON MODE SHADER (HARD-STEPPED COMIC CEL + OPTIONAL VOXEL INK + CUSTOM PRESETS)
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const CARTOON_VERTEX_SHADER = POTATO_VERTEX_SHADER;

export const CARTOON_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  varying vec3 vColor;
  varying float vAo;
  varying vec2 vUv;
  varying float vFogDepth;

  uniform vec3 uBaseColor;
  uniform vec3 uLightDir; // Pre-normalized on CPU
  uniform vec3 uRimColor;
  uniform float uRimIntensity;
  uniform float uSaturation;
  uniform float uCelBands;
  uniform float uVoxelInkStrength;
  uniform vec3 uSunTint;
  uniform vec3 uShadowTint;
  uniform vec3 uOutlineInkColor;
  #ifdef USE_POTATO_MAP
    uniform sampler2D uMap;
  #endif
  uniform float uFogEnabled;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 V = normalize(vViewDir);
    vec3 L = uLightDir;

    #ifdef USE_POTATO_MAP
      vec3 rawAlbedo = clamp(vColor * uBaseColor * texture2D(uMap, vUv).rgb * vAo, 0.0, 1.0);
    #else
      vec3 rawAlbedo = clamp(vColor * uBaseColor * vAo, 0.0, 1.0);
    #endif

    // 1. Configurable Saturation Boost (default 1.38x in Cartoon mode)
    float luma = dot(rawAlbedo, vec3(0.299, 0.587, 0.114));
    vec3 saturatedAlbedo = clamp(mix(vec3(luma), rawAlbedo, uSaturation), 0.0, 1.0);

    // 2. Crisp Hard-Stepped Cartoon Cel Bands (supports 2..8 bands via uCelBands)
    float NdotL = dot(N, L);
    float step2 = smoothstep(0.18, 0.23, NdotL);
    float bands = clamp(uCelBands, 2.0, 8.0);
    float scaledL = clamp(NdotL * 0.5 + 0.5, 0.0, 0.999) * bands;
    float bandIdx = floor(scaledL);
    float bandFrac = smoothstep(0.88, 1.0, fract(scaledL));
    float quantizedL = (bandIdx + bandFrac) / max(1.0, bands - 1.0);
    float toonShade = 0.42 + 0.62 * clamp(quantizedL, 0.0, 1.0);

    vec3 toonLightCol = mix(uShadowTint, uSunTint, step2);

    // 3. Hard Cartoon Specular Dot (polynomial x^48 — zero pow())
    vec3 H = normalize(L + V);
    float nh = max(dot(N, H), 0.0);
    float nh2 = nh * nh;
    float nh4 = nh2 * nh2;
    float nh8 = nh4 * nh4;
    float nh16 = nh8 * nh8;
    float spec = nh16 * nh16 * nh16;
    float toonSpec = smoothstep(0.52, 0.58, spec) * 0.26 * step2;

    // 4. Optional Voxel Block Ink Borders (compiled out when uVoxelInkStrength == 0) + Grazing Rim
    float NdotV = max(dot(N, V), 0.0);
    float voxelInkMask = 0.0;
    #ifdef USE_VOXEL_INK
      vec3 absN = abs(N);
      vec2 planeCoord = absN.y > 0.5
        ? vWorldPos.xz
        : (absN.x > 0.5 ? vWorldPos.yz : vWorldPos.xy);
      vec2 gridDist = abs(fract(planeCoord * 4.0 - 0.5) - 0.5);
      float minGrid = min(gridDist.x, gridDist.y);
      float distFade = 1.0 - smoothstep(14.0, 52.0, vFogDepth);
      voxelInkMask = (1.0 - smoothstep(0.025, 0.065, minGrid)) * uVoxelInkStrength * distFade;
    #endif

    float comicEdgeInk = (1.0 - smoothstep(0.14, 0.24, NdotV)) * clamp(uVoxelInkStrength * 1.5, 0.15, 0.78);
    float innerRimPop  = smoothstep(0.24, 0.34, NdotV) * (1.0 - smoothstep(0.34, 0.48, NdotV)) * uRimIntensity * step2;

    vec3 litColor = saturatedAlbedo * toonLightCol * toonShade + vec3(toonSpec) + uRimColor * innerRimPop;
    float totalInk = clamp(max(voxelInkMask, comicEdgeInk), 0.0, 0.85);
    litColor = mix(litColor, uOutlineInkColor, totalInk);

    if (uFogEnabled > 0.5) {
      float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
      litColor = mix(litColor, uFogColor, fogFactor);
    }

    gl_FragColor = vec4(clamp(litColor, 0.0, 1.0), 1.0);
  }
`;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GPU VEHICLE SILHOUETTE OUTLINE SHADER (BACKFACE EXTRUSION)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Renders an inverted-hull (BackSide) mesh extruded along vertex normals in
 * world/object space to draw a bold, clean cartoon outline around any vehicle.
 */
export const CARTOON_OUTLINE_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uOutlineThickness;

  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float dist = clamp(-mvPos.z, 1.5, 65.0);
    // Scale outline thickness smoothly with camera distance so vehicle silhouettes stay crisp without splitting
    float dynamicThickness = clamp(uOutlineThickness * (0.72 + 0.016 * dist), 0.0, 0.24);

    vec3 normDir = length(normal) > 0.001 ? normalize(normal) : normalize(position + vec3(0.0, 0.001, 0.0));
    vec3 extrudedPos = position + normDir * dynamicThickness;

    vec4 mvExtruded = modelViewMatrix * vec4(extrudedPos, 1.0);
    if (uPlanetCurvatureInv2R > 0.0) {
      vec3 _relW = mvExtruded.xyz * mat3(viewMatrix);
      float _h2 = _relW.x * _relW.x + _relW.z * _relW.z;
      float _drop = min(_h2 * uPlanetCurvatureInv2R, 650000.0);
      mvExtruded.xyz -= viewMatrix[1].xyz * _drop;
    }
    vec4 clipPos = projectionMatrix * mvExtruded;
    // Tiny depth bias so the BackSide outline never z-fights with FrontSide vehicle faces
    clipPos.z += 0.0004 * clipPos.w;
    gl_Position = clipPos;
    #include <logdepthbuf_vertex>
    #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
      vFragDepth += 0.025;
    #endif
  }
`;

const _smoothOutlineGeoCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Returns a cached clone of `sourceGeo` whose `normal` attribute is welded/averaged across
 * coincident vertex coordinates so BackSide hull extrusion forms a seamless, gap-free comic silhouette.
 */
export function getSmoothedOutlineGeometry(
  sourceGeo: THREE.BufferGeometry,
  forceRefresh = false,
): THREE.BufferGeometry {
  if (!forceRefresh) {
    const cached = _smoothOutlineGeoCache.get(sourceGeo);
    if (cached) return cached;
  } else {
    const oldCached = _smoothOutlineGeoCache.get(sourceGeo);
    if (oldCached && oldCached !== sourceGeo) {
      oldCached.dispose();
    }
  }

  const posAttr = sourceGeo.getAttribute('position');
  if (!posAttr || posAttr.count === 0) {
    return sourceGeo;
  }

  const cloned = sourceGeo.clone();
  cloned.setDrawRange(sourceGeo.drawRange.start, sourceGeo.drawRange.count);
  const cPos = cloned.getAttribute('position');
  const normAttr = cloned.getAttribute('normal');
  const activeCount =
    sourceGeo.index && sourceGeo.drawRange.count !== Infinity
      ? cPos.count
      : Math.min(cPos.count, sourceGeo.drawRange.count);
  const count = cPos.count;

  const accum = new Map<string, [number, number, number]>();
  const vertKeys = new Array<string>(count);

  const scanCount = sourceGeo.index ? count : Math.min(count, activeCount);
  for (let i = 0; i < scanCount; i++) {
    const x = cPos.getX(i);
    const y = cPos.getY(i);
    const z = cPos.getZ(i);
    const key = `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;
    vertKeys[i] = key;

    const nx = normAttr ? normAttr.getX(i) : x;
    const ny = normAttr ? normAttr.getY(i) : y;
    const nz = normAttr ? normAttr.getZ(i) : z;
    let entry = accum.get(key);
    if (!entry) {
      entry = [0, 0, 0];
      accum.set(key, entry);
    }
    entry[0] += nx;
    entry[1] += ny;
    entry[2] += nz;
  }

  const outNormals = new Float32Array(count * 3);
  for (let i = 0; i < scanCount; i++) {
    const entry = accum.get(vertKeys[i])!;
    let ax = entry[0];
    let ay = entry[1];
    let az = entry[2];
    const len = Math.hypot(ax, ay, az);
    if (len > 1e-5) {
      ax /= len;
      ay /= len;
      az /= len;
    } else {
      const px = cPos.getX(i);
      const py = cPos.getY(i);
      const pz = cPos.getZ(i);
      const plen = Math.hypot(px, py, pz) || 1;
      ax = px / plen;
      ay = py / plen;
      az = pz / plen;
    }
    outNormals[i * 3] = ax;
    outNormals[i * 3 + 1] = ay;
    outNormals[i * 3 + 2] = az;
  }

  cloned.setAttribute('normal', new THREE.BufferAttribute(outNormals, 3));
  _smoothOutlineGeoCache.set(sourceGeo, cloned);
  return cloned;
}

export function disposeSmoothedOutlineGeometry(
  sourceGeo: THREE.BufferGeometry | null | undefined,
): void {
  if (!sourceGeo) return;
  const cached = _smoothOutlineGeoCache.get(sourceGeo);
  if (cached && cached !== sourceGeo) {
    cached.dispose();
  }
  _smoothOutlineGeoCache.delete(sourceGeo);
}

export const CARTOON_OUTLINE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uOutlineColor;

  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uOutlineColor, 1.0);
  }
`;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CUSTOM SHADER PRESET STUDIO (BUILT-IN & USER-CREATED SHADER PRESETS)
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface CustomShaderPreset {
  id: string;
  name: string;
  description: string;
  isBuiltIn?: boolean;
  baseMode: 'CARTOON' | 'POTATO';
  saturation: number;       // 0.0 .. 2.4
  celBands: number;         // 2 .. 6
  voxelInkStrength: number; // 0.0 .. 0.9
  outlineThickness: number; // 0.0 .. 0.10
  outlineColorHex: string;  // e.g. '#060a12'
  rimColorHex: string;      // e.g. '#fef08a'
  rimIntensity: number;     // 0.0 .. 1.2
  sunTintHex: string;       // e.g. '#fff5e0'
  shadowTintHex: string;    // e.g. '#a8bdf5'
}

export const BUILTIN_SHADER_PRESETS: CustomShaderPreset[] = [
  {
    id: 'shader_comic_ink',
    name: 'Comic Book Ink (Default Toon)',
    description: 'Vibrant 4-band comic cel shading with crisp 0.25m voxel ink borders & bold silhouette outlines.',
    isBuiltIn: true,
    baseMode: 'CARTOON',
    saturation: 1.38,
    celBands: 4,
    voxelInkStrength: 0.34,
    outlineThickness: 0.045,
    outlineColorHex: '#060a12',
    rimColorHex: '#fef08a',
    rimIntensity: 0.26,
    sunTintHex: '#fff5e0',
    shadowTintHex: '#a8bdf5',
  },
  {
    id: 'shader_cyberpunk_synth',
    name: 'Cyberpunk Synthwave Neon',
    description: 'Hyper-saturated magenta & cyan rim glow with electric cyan voxel grid lines and deep violet shadows.',
    isBuiltIn: true,
    baseMode: 'CARTOON',
    saturation: 1.75,
    celBands: 3,
    voxelInkStrength: 0.48,
    outlineThickness: 0.052,
    outlineColorHex: '#00f5ff',
    rimColorHex: '#ff2a85',
    rimIntensity: 0.68,
    sunTintHex: '#ffe6fa',
    shadowTintHex: '#4c1d95',
  },
  {
    id: 'shader_noir_sincity',
    name: 'Graphic Novel Noir',
    description: 'High-contrast monochrome comic ink with razor-sharp 2-tone cel bands and crimson rim highlights.',
    isBuiltIn: true,
    baseMode: 'CARTOON',
    saturation: 0.15,
    celBands: 2,
    voxelInkStrength: 0.62,
    outlineThickness: 0.058,
    outlineColorHex: '#020408',
    rimColorHex: '#f43f5e',
    rimIntensity: 0.55,
    sunTintHex: '#ffffff',
    shadowTintHex: '#475569',
  },
  {
    id: 'shader_blueprint_cad',
    name: 'Engineering Blueprint CAD',
    description: 'Technical blueprint drafting look with crisp white voxel grid lines and cyan-tinted schematic shading.',
    isBuiltIn: true,
    baseMode: 'CARTOON',
    saturation: 0.55,
    celBands: 3,
    voxelInkStrength: 0.72,
    outlineThickness: 0.042,
    outlineColorHex: '#e0f2fe',
    rimColorHex: '#38bdf8',
    rimIntensity: 0.62,
    sunTintHex: '#bae6fd',
    shadowTintHex: '#0c4a6e',
  },
  {
    id: 'shader_golden_sunset',
    name: 'Golden Hour Anime Cel',
    description: 'Warm sunset amber key light, soft lavender shadows, and glowing golden rim highlights.',
    isBuiltIn: true,
    baseMode: 'CARTOON',
    saturation: 1.45,
    celBands: 4,
    voxelInkStrength: 0.24,
    outlineThickness: 0.038,
    outlineColorHex: '#1e1b4b',
    rimColorHex: '#fbbf24',
    rimIntensity: 0.52,
    sunTintHex: '#fde68a',
    shadowTintHex: '#818cf8',
  },
  {
    id: 'shader_retro_potato',
    name: 'Retro Smooth Cel (Potato+)',
    description: 'Ultra-fast smooth 3-band cel shading with sky-blue Fresnel rim lighting and subtle voxel bevels.',
    isBuiltIn: true,
    baseMode: 'POTATO',
    saturation: 1.18,
    celBands: 3,
    voxelInkStrength: 0.14,
    outlineThickness: 0.0,
    outlineColorHex: '#060a12',
    rimColorHex: '#7dd3fc',
    rimIntensity: 0.36,
    sunTintHex: '#fff8eb',
    shadowTintHex: '#b8ccfa',
  },
];

const STORAGE_KEY_CUSTOM_SHADERS = 'voxelmakers_custom_shader_presets_v1';
const STORAGE_KEY_ACTIVE_SHADER_ID = 'voxelmakers_active_shader_preset_id_v1';

export function restoreActiveCustomShaderPreset(): CustomShaderPreset {
  const presets = loadCustomShaderPresets();
  if (typeof window !== 'undefined') {
    try {
      const savedId = window.localStorage?.getItem(STORAGE_KEY_ACTIVE_SHADER_ID);
      if (savedId) {
        const found = presets.find((p) => p.id === savedId);
        if (found) return { ...found };
      }
    } catch {
      // Ignore storage read errors
    }
  }
  return { ...BUILTIN_SHADER_PRESETS[0] };
}

let _activeShaderPreset: CustomShaderPreset = restoreActiveCustomShaderPreset();

export function getActiveCustomShaderPreset(): CustomShaderPreset {
  return _activeShaderPreset;
}

export function loadCustomShaderPresets(): CustomShaderPreset[] {
  const list: CustomShaderPreset[] = BUILTIN_SHADER_PRESETS.map((p) => ({ ...p }));
  if (typeof window === 'undefined') return list;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_CUSTOM_SHADERS);
    if (!raw) return list;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item.id === 'string' && typeof item.name === 'string') {
          list.push({
            id: item.id,
            name: item.name,
            description: item.description || 'Custom user shader preset',
            isBuiltIn: false,
            baseMode: item.baseMode === 'POTATO' ? 'POTATO' : 'CARTOON',
            saturation: Number.isFinite(item.saturation) ? item.saturation : 1.35,
            celBands: Number.isFinite(item.celBands) ? item.celBands : 4,
            voxelInkStrength: Number.isFinite(item.voxelInkStrength) ? item.voxelInkStrength : 0.34,
            outlineThickness: Number.isFinite(item.outlineThickness) ? item.outlineThickness : 0.045,
            outlineColorHex: typeof item.outlineColorHex === 'string' ? item.outlineColorHex : '#060a12',
            rimColorHex: typeof item.rimColorHex === 'string' ? item.rimColorHex : '#fef08a',
            rimIntensity: Number.isFinite(item.rimIntensity) ? item.rimIntensity : 0.3,
            sunTintHex: typeof item.sunTintHex === 'string' ? item.sunTintHex : '#fff5e0',
            shadowTintHex: typeof item.shadowTintHex === 'string' ? item.shadowTintHex : '#a8bdf5',
          });
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return list;
}

export function saveCustomShaderPreset(preset: Omit<CustomShaderPreset, 'id' | 'isBuiltIn'> & { id?: string }): CustomShaderPreset {
  const existingUser = loadCustomShaderPresets().filter((p) => !p.isBuiltIn);
  const id = preset.id && !preset.id.startsWith('shader_')
    ? preset.id
    : `custom_shader_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const saved: CustomShaderPreset = {
    ...preset,
    id,
    isBuiltIn: false,
  };
  const nextUser = existingUser.filter((p) => p.id !== id);
  nextUser.push(saved);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(STORAGE_KEY_CUSTOM_SHADERS, JSON.stringify(nextUser));
      window.localStorage?.setItem(STORAGE_KEY_ACTIVE_SHADER_ID, saved.id);
    } catch {
      // Ignore quota errors
    }
  }
  applyCustomShaderPresetToMaterials(saved);
  return saved;
}

export function deleteCustomShaderPreset(id: string): CustomShaderPreset[] {
  const existingUser = loadCustomShaderPresets().filter((p) => !p.isBuiltIn && p.id !== id);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(STORAGE_KEY_CUSTOM_SHADERS, JSON.stringify(existingUser));
    } catch {
      // Ignore errors
    }
  }
  if (_activeShaderPreset.id === id) {
    applyCustomShaderPresetToMaterials(BUILTIN_SHADER_PRESETS[0]);
  }
  return loadCustomShaderPresets();
}

export interface PotatoShaderUniforms {
  [uniform: string]: THREE.IUniform<any>;
  uBaseColor: THREE.IUniform<THREE.Color>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
  uRimColor: THREE.IUniform<THREE.Color>;
  uRimIntensity: THREE.IUniform<number>;
  uSaturation: THREE.IUniform<number>;
  uCelBands: THREE.IUniform<number>;
  uVoxelInkStrength: THREE.IUniform<number>;
  uSunTint: THREE.IUniform<THREE.Color>;
  uShadowTint: THREE.IUniform<THREE.Color>;
  uOutlineInkColor: THREE.IUniform<THREE.Color>;
  uTime: THREE.IUniform<number>;
  uUseVertexColors: THREE.IUniform<number>;
  uHasMap: THREE.IUniform<number>;
  uMap: THREE.IUniform<THREE.Texture | null>;
  uFogEnabled: THREE.IUniform<number>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogNear: THREE.IUniform<number>;
  uniformsNeedUpdate?: any;
  uFogFar: THREE.IUniform<number>;
}

function createBaseShaderUniforms(
  baseColorHex = 0xffffff,
  useVertexColors = true,
  rimColorHex: number | string = 0x7dd3fc,
  mapTexture: THREE.Texture | null = null,
  preset: CustomShaderPreset = _activeShaderPreset,
): PotatoShaderUniforms {
  return {
    uBaseColor: { value: new THREE.Color(baseColorHex) },
    uLightDir: { value: new THREE.Vector3(45, 42, 55).normalize() },
    uRimColor: { value: new THREE.Color(preset.rimColorHex || rimColorHex) },
    uRimIntensity: { value: preset.rimIntensity ?? 0.34 },
    uSaturation: { value: preset.saturation ?? 1.35 },
    uCelBands: { value: preset.celBands ?? 4.0 },
    uVoxelInkStrength: { value: preset.voxelInkStrength ?? 0.34 },
    uSunTint: { value: new THREE.Color(preset.sunTintHex || '#fff5e0') },
    uShadowTint: { value: new THREE.Color(preset.shadowTintHex || '#a8bdf5') },
    uOutlineInkColor: { value: new THREE.Color(preset.outlineColorHex || '#060a12') },
    uTime: { value: 0.0 },
    uUseVertexColors: { value: useVertexColors ? 1.0 : 0.0 },
    uHasMap: { value: mapTexture ? 1.0 : 0.0 },
    uMap: { value: mapTexture },
    uFogEnabled: { value: 1.0 },
    uFogColor: { value: new THREE.Color(0x5b9bd5) },
    uFogNear: { value: 30.0 },
    uFogFar: { value: 160.0 },
  };
}

/**
 * Creates a Three.js ShaderMaterial wrapper for the Potato Mode cel + rim shader.
 */
export function createPotatoShaderMaterial(
  useVertexColors = true,
  baseColorHex = 0xffffff,
  mapTexture: THREE.Texture | null = null,
): THREE.ShaderMaterial {
  const uniforms = createBaseShaderUniforms(baseColorHex, useVertexColors, 0x7dd3fc, mapTexture, _activeShaderPreset);
  const defines: Record<string, number> = {};
  if (mapTexture) defines.USE_POTATO_MAP = 1;

  return new THREE.ShaderMaterial({
    name: useVertexColors ? 'PotatoCelRimShaderMaterial' : `PotatoSolidShader_${baseColorHex.toString(16)}`,
    vertexShader: POTATO_VERTEX_SHADER,
    fragmentShader: POTATO_FRAGMENT_SHADER,
    defines,
    uniforms,
    vertexColors: useVertexColors,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
}

/**
 * Creates a Three.js ShaderMaterial wrapper for the Cartoon Mode shader.
 */
export function createCartoonShaderMaterial(
  useVertexColors = true,
  baseColorHex = 0xffffff,
  mapTexture: THREE.Texture | null = null,
): THREE.ShaderMaterial {
  const uniforms = createBaseShaderUniforms(baseColorHex, useVertexColors, 0xfef08a, mapTexture, _activeShaderPreset);
  const defines: Record<string, number> = {};
  if (mapTexture) defines.USE_POTATO_MAP = 1;
  if ((_activeShaderPreset.voxelInkStrength ?? 0.34) > 0.001) {
    defines.USE_VOXEL_INK = 1;
  }

  const mat = new THREE.ShaderMaterial({
    name: useVertexColors ? 'CartoonCelShaderMaterial' : `CartoonSolidShader_${baseColorHex.toString(16)}`,
    vertexShader: CARTOON_VERTEX_SHADER,
    fragmentShader: CARTOON_FRAGMENT_SHADER,
    defines,
    uniforms,
    vertexColors: useVertexColors,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
  mat.customProgramCacheKey = () =>
    `cartoon_v2_${mapTexture ? 1 : 0}_${mat.defines.USE_VOXEL_INK ? 1 : 0}`;
  return mat;
}

/**
 * Creates a Three.js ShaderMaterial for the GPU BackSide Vehicle Silhouette Outline.
 */
export function createVehicleOutlineMaterial(
  outlineColorHex: number | string = 0x070b14,
  thickness = 0.044,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'CartoonVehicleOutlineShaderMaterial',
    vertexShader: CARTOON_OUTLINE_VERTEX_SHADER,
    fragmentShader: CARTOON_OUTLINE_FRAGMENT_SHADER,
    uniforms: {
      uOutlineColor: { value: new THREE.Color(outlineColorHex) },
      uOutlineThickness: { value: thickness },
    },
    side: THREE.BackSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
}

let _sharedPotatoMaterial: THREE.ShaderMaterial | null = null;
let _sharedCartoonMaterial: THREE.ShaderMaterial | null = null;
let _sharedVehicleOutlineMaterial: THREE.ShaderMaterial | null = null;

// Cached solid-color materials (keyed by color hex + texture id) for meshes that do NOT have a `color` BufferAttribute
const _potatoSolidMaterialCache = new Map<string, THREE.ShaderMaterial>();
const _cartoonSolidMaterialCache = new Map<string, THREE.ShaderMaterial>();

function applyPresetUniformsToShaderMat(mat: THREE.ShaderMaterial, preset: CustomShaderPreset): void {
  const u = mat.uniforms as PotatoShaderUniforms;
  if (!u) return;
  u.uRimColor?.value?.set(preset.rimColorHex || '#fef08a');
  if (u.uRimIntensity) u.uRimIntensity.value = preset.rimIntensity;
  if (u.uSaturation) u.uSaturation.value = preset.saturation;
  if (u.uCelBands) u.uCelBands.value = preset.celBands;
  if (u.uVoxelInkStrength) u.uVoxelInkStrength.value = preset.voxelInkStrength;
  u.uSunTint?.value?.set(preset.sunTintHex || '#fff5e0');
  u.uShadowTint?.value?.set(preset.shadowTintHex || '#a8bdf5');
  u.uOutlineInkColor?.value?.set(preset.outlineColorHex || '#060a12');
  if (mat.name.startsWith('Cartoon')) {
    if (preset.voxelInkStrength > 0.001) {
      mat.defines.USE_VOXEL_INK = 1;
    } else {
      delete mat.defines.USE_VOXEL_INK;
    }
  }
}

/**
 * Applies a CustomShaderPreset to all shared and cached Cartoon/Potato ShaderMaterials
 * and the GPU Vehicle Silhouette Outline ShaderMaterial in real time.
 */
export function applyCustomShaderPresetToMaterials(preset: CustomShaderPreset): void {
  _activeShaderPreset = { ...preset };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(STORAGE_KEY_ACTIVE_SHADER_ID, preset.id);
    } catch {
      // Ignore storage errors
    }
  }
  if (_sharedPotatoMaterial) applyPresetUniformsToShaderMat(_sharedPotatoMaterial, preset);
  if (_sharedCartoonMaterial) applyPresetUniformsToShaderMat(_sharedCartoonMaterial, preset);
  for (const mat of _potatoSolidMaterialCache.values()) {
    applyPresetUniformsToShaderMat(mat, preset);
  }
  for (const mat of _cartoonSolidMaterialCache.values()) {
    applyPresetUniformsToShaderMat(mat, preset);
  }
  const outlineMat = getSharedVehicleOutlineMaterial();
  if (outlineMat?.uniforms) {
    outlineMat.uniforms.uOutlineColor?.value?.set(preset.outlineColorHex || '#060a12');
    if (outlineMat.uniforms.uOutlineThickness) {
      outlineMat.uniforms.uOutlineThickness.value = preset.outlineThickness;
    }
  }
}

/**
 * Returns the singleton vertex-colored Potato ShaderMaterial reused across all chunk and chassis meshes.
 */
export function getSharedPotatoShaderMaterial(): THREE.ShaderMaterial {
  if (!_sharedPotatoMaterial) {
    _sharedPotatoMaterial = createPotatoShaderMaterial(true, 0xffffff, null);
  }
  return _sharedPotatoMaterial;
}

/**
 * Returns the singleton vertex-colored Cartoon ShaderMaterial reused across all chunk and chassis meshes.
 */
export function getSharedCartoonShaderMaterial(): THREE.ShaderMaterial {
  if (!_sharedCartoonMaterial) {
    _sharedCartoonMaterial = createCartoonShaderMaterial(true, 0xffffff, null);
  }
  return _sharedCartoonMaterial;
}

/**
 * Returns the singleton GPU BackSide Outline ShaderMaterial for vehicles in Cartoon Mode.
 */
export function getSharedVehicleOutlineMaterial(): THREE.ShaderMaterial {
  if (!_sharedVehicleOutlineMaterial) {
    _sharedVehicleOutlineMaterial = createVehicleOutlineMaterial(
      _activeShaderPreset.outlineColorHex || 0x060a12,
      _activeShaderPreset.outlineThickness ?? 0.045,
    );
  }
  return _sharedVehicleOutlineMaterial;
}

export function getPotatoSolidColorMaterial(
  color: THREE.Color,
  mapTexture: THREE.Texture | null = null,
  hasVertexColors = false,
): THREE.ShaderMaterial {
  const hex = color.getHex();
  if (hasVertexColors && hex === 0xffffff && !mapTexture) {
    return getSharedPotatoShaderMaterial();
  }
  const key = `${hasVertexColors ? 'vc' : 'solid'}_${hex.toString(16)}_${mapTexture ? mapTexture.id : 'nomap'}`;
  let mat = _potatoSolidMaterialCache.get(key);
  if (!mat) {
    mat = createPotatoShaderMaterial(hasVertexColors, hex, mapTexture);
    _potatoSolidMaterialCache.set(key, mat);
  }
  return mat;
}

export function getCartoonSolidColorMaterial(
  color: THREE.Color,
  mapTexture: THREE.Texture | null = null,
  hasVertexColors = false,
): THREE.ShaderMaterial {
  const hex = color.getHex();
  if (hasVertexColors && hex === 0xffffff && !mapTexture) {
    return getSharedCartoonShaderMaterial();
  }
  const key = `${hasVertexColors ? 'vc' : 'solid'}_${hex.toString(16)}_${mapTexture ? mapTexture.id : 'nomap'}`;
  let mat = _cartoonSolidMaterialCache.get(key);
  if (!mat) {
    mat = createCartoonShaderMaterial(hasVertexColors, hex, mapTexture);
    _cartoonSolidMaterialCache.set(key, mat);
  }
  return mat;
}

function syncUniformsOnMaterial(
  mat: THREE.ShaderMaterial,
  timeSec: number,
  sceneFog: THREE.Fog | THREE.FogExp2 | null,
  sunDirection?: THREE.Vector3,
): void {
  const u = mat.uniforms as PotatoShaderUniforms;
  u.uTime.value = timeSec;
  if (sunDirection) {
    u.uLightDir.value.copy(sunDirection).normalize();
  }
  if (sceneFog && sceneFog instanceof THREE.Fog) {
    u.uFogEnabled.value = 1.0;
    u.uFogColor.value.copy(sceneFog.color);
    u.uFogNear.value = sceneFog.near;
    u.uFogFar.value = Math.max(sceneFog.far, sceneFog.near + 8.0);
  } else if (sceneFog && sceneFog instanceof THREE.FogExp2) {
    const d = Math.max(0.0005, sceneFog.density);
    u.uFogEnabled.value = 1.0;
    u.uFogColor.value.copy(sceneFog.color);
    u.uFogNear.value = Math.max(16.0, 0.35 / d);
    u.uFogFar.value = Math.max(48.0, 1.85 / d);
  } else {
    u.uFogEnabled.value = 0.0;
  }
}

/**
 * Updates the shared Potato and Cartoon ShaderMaterial time and fog uniforms once per frame
 * without eagerly allocating unused shader singletons.
 */
export function updateSharedPotatoShaderUniforms(
  timeSec: number,
  sceneFog: THREE.Fog | THREE.FogExp2 | null,
  sunDirection?: THREE.Vector3,
): void {
  if (_sharedPotatoMaterial) {
    syncUniformsOnMaterial(_sharedPotatoMaterial, timeSec, sceneFog, sunDirection);
  }
  if (_sharedCartoonMaterial) {
    syncUniformsOnMaterial(_sharedCartoonMaterial, timeSec, sceneFog, sunDirection);
  }

  for (const mat of _potatoSolidMaterialCache.values()) {
    syncUniformsOnMaterial(mat, timeSec, sceneFog, sunDirection);
  }
  for (const mat of _cartoonSolidMaterialCache.values()) {
    syncUniformsOnMaterial(mat, timeSec, sceneFog, sunDirection);
  }
}

export function disposeSharedPotatoShaderResources(): void {
  if (_sharedPotatoMaterial) {
    _sharedPotatoMaterial.dispose();
    _sharedPotatoMaterial = null;
  }
  if (_sharedCartoonMaterial) {
    _sharedCartoonMaterial.dispose();
    _sharedCartoonMaterial = null;
  }
  if (_sharedVehicleOutlineMaterial) {
    _sharedVehicleOutlineMaterial.dispose();
    _sharedVehicleOutlineMaterial = null;
  }
  for (const mat of _potatoSolidMaterialCache.values()) {
    mat.dispose();
  }
  _potatoSolidMaterialCache.clear();
  for (const mat of _cartoonSolidMaterialCache.values()) {
    mat.dispose();
  }
  _cartoonSolidMaterialCache.clear();
  if (_sharedBlobShadowTexture) {
    _sharedBlobShadowTexture.dispose();
    _sharedBlobShadowTexture = null;
  }
  if (_sharedBlobShadowGeometry) {
    _sharedBlobShadowGeometry.dispose();
    _sharedBlobShadowGeometry = null;
  }
  if (_sharedBlobShadowMaterial) {
    _sharedBlobShadowMaterial.dispose();
    _sharedBlobShadowMaterial = null;
  }
}

function isCustomCelMaterial(mat: unknown): boolean {
  if (!mat || !(mat instanceof THREE.ShaderMaterial)) return false;
  return (
    mat.name.startsWith('Potato') ||
    mat.name.startsWith('Cartoon')
  );
}

/**
 * Swaps a Mesh's material between its original PBR/Lambert material, the Potato ShaderMaterial,
 * or the Cartoon ShaderMaterial while preserving per-voxel vertex colors, solid `uBaseColor`,
 * and any diffuse texture map (`uMap`).
 *
 * Accepts either a boolean (`usePotatoShader`) for backwards compatibility with existing callers
 * or an `ActiveShaderMode` (`'PBR' | 'POTATO' | 'CARTOON'`).
 */
export function applyMeshMaterialPresetSwap(
  mesh: THREE.Mesh,
  modeOrUsePotato: boolean | ActiveShaderMode,
  fallbackStandardMaterial?: THREE.Material,
): void {
  if (!mesh || mesh.userData?.isCartoonOutlineMesh) return;

  const targetMode: ActiveShaderMode =
    typeof modeOrUsePotato === 'boolean'
      ? modeOrUsePotato
        ? 'POTATO'
        : 'PBR'
      : modeOrUsePotato;

  const curMat = mesh.material as THREE.Material & {
    color?: THREE.Color;
    map?: THREE.Texture | null;
    transparent?: boolean;
    wireframe?: boolean;
    opacity?: number;
  };
  if (!curMat) return;

  // Ignore translucent beams, ghosts, water, or wireframes
  if (
    !isCustomCelMaterial(curMat) &&
    (curMat.transparent || curMat.wireframe || (curMat.opacity !== undefined && curMat.opacity < 0.98))
  ) {
    return;
  }

  if (targetMode === 'POTATO' || targetMode === 'CARTOON') {
    if (!isCustomCelMaterial(curMat)) {
      mesh.userData.origPbrMaterial = curMat;
      if (curMat.color instanceof THREE.Color) {
        mesh.userData.savedBaseColor = curMat.color.clone();
      } else {
        mesh.userData.savedBaseColor = new THREE.Color(0xffffff);
      }
      mesh.userData.savedMapTexture = curMat.map ?? null;
    }

    const savedColor = (mesh.userData.savedBaseColor as THREE.Color | undefined) ?? new THREE.Color(0xffffff);
    const savedMap = (mesh.userData.savedMapTexture as THREE.Texture | null | undefined) ?? null;
    const hasVertexColorAttr = Boolean(mesh.geometry?.getAttribute('color'));

    if (targetMode === 'POTATO') {
      mesh.material = getPotatoSolidColorMaterial(savedColor, savedMap, hasVertexColorAttr);
    } else {
      mesh.material = getCartoonSolidColorMaterial(savedColor, savedMap, hasVertexColorAttr);
    }
  } else {
    // Restore original PBR / standard material
    const origMat = (mesh.userData.origPbrMaterial as THREE.Material | undefined) || fallbackStandardMaterial;
    if (origMat && isCustomCelMaterial(mesh.material)) {
      const savedBase = mesh.userData.savedBaseColor as THREE.Color | undefined;
      if (savedBase && (origMat as any).color instanceof THREE.Color) {
        (origMat as any).color.copy(savedBase);
      }
      mesh.material = origMat;
    }
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DELIVERABLE 3: LOW-END GPU AUTO-DETECTION FUNCTION
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function getWebGLRendererString(
  glOrRenderer?: WebGLRenderingContext | WebGL2RenderingContext | THREE.WebGLRenderer | string | null,
): string {
  if (typeof glOrRenderer === 'string') {
    return glOrRenderer;
  }
  if (glOrRenderer && typeof (glOrRenderer as THREE.WebGLRenderer).getContext === 'function') {
    const gl = (glOrRenderer as THREE.WebGLRenderer).getContext();
    return extractWebGLRendererString(gl);
  }
  if (glOrRenderer && typeof (glOrRenderer as WebGLRenderingContext).getParameter === 'function') {
    return extractWebGLRendererString(glOrRenderer as WebGLRenderingContext);
  }
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const gl =
        (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
        (canvas.getContext('webgl') as WebGLRenderingContext | null);
      if (gl) {
        const result = extractWebGLRendererString(gl);
        try {
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        } catch {
          // Ignore extension errors on headless/mock contexts
        }
        return result;
      }
    } catch {
      // Ignore context creation errors in non-browser environments
    }
  }
  return '';
}

export function detectLowEndGpu(
  glOrRenderer?: WebGLRenderingContext | WebGL2RenderingContext | THREE.WebGLRenderer | string | null,
): boolean {
  const rendererStr = getWebGLRendererString(glOrRenderer);
  if (!rendererStr) return false;
  return isLowEndRendererString(rendererStr);
}

function extractWebGLRendererString(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): string {
  try {
    const dbgExt = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbgExt) {
      const unmasked = gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL);
      if (typeof unmasked === 'string' && unmasked.length > 0) {
        return unmasked;
      }
    }
    const baseRenderer = gl.getParameter(gl.RENDERER);
    return typeof baseRenderer === 'string' ? baseRenderer : '';
  } catch {
    return '';
  }
}

export function isLowEndRendererString(rendererStr: string): boolean {
  const s = rendererStr.toLowerCase();
  return (
    s.includes('pentium') ||
    s.includes('celeron') ||
    s.includes('sandybridge') ||
    s.includes('snb ') ||
    s.includes('(snb') ||
    s.includes('ivybridge') ||
    s.includes('ivb ') ||
    s.includes('(ivb') ||
    s.includes('ironlake') ||
    s.includes('bay trail') ||
    s.includes('haswell') ||
    s.includes('mesa dri intel') ||
    s.includes('hd graphics 2000') ||
    s.includes('hd graphics 3000') ||
    s.includes('hd graphics 4000') ||
    s.includes('intel(r) hd graphics') ||
    s.includes('intel hd graphics') ||
    s.includes('intel(r) uhd graphics 60') ||
    s.includes('intel(r) uhd graphics 61') ||
    s.includes('gma ') ||
    s.includes('atom') ||
    s.includes('swiftshader') ||
    s.includes('llvmpipe') ||
    s.includes('softpipe') ||
    s.includes('software') ||
    s.includes('basic render driver') ||
    s.includes('mali-4') ||
    s.includes('adreno (tm) 3')
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DELIVERABLE 4: BLOB SHADOW IMPLEMENTATION (SHARED 64x64 TEXTURE + FLAT MESH)
 * ═══════════════════════════════════════════════════════════════════════════
 */
let _sharedBlobShadowTexture: THREE.CanvasTexture | null = null;
let _sharedBlobShadowGeometry: THREE.PlaneGeometry | null = null;
let _sharedBlobShadowMaterial: THREE.MeshBasicMaterial | null = null;

export function getSharedBlobShadowTexture(): THREE.CanvasTexture | null {
  if (_sharedBlobShadowTexture) return _sharedBlobShadowTexture;
  if (typeof document === 'undefined') return null;

  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = 64;
  blobCanvas.height = 64;
  const ctx = blobCanvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  _sharedBlobShadowTexture = new THREE.CanvasTexture(blobCanvas);
  _sharedBlobShadowTexture.needsUpdate = true;
  return _sharedBlobShadowTexture;
}

export function createVehicleBlobShadowMesh(): THREE.Mesh {
  if (!_sharedBlobShadowGeometry) {
    _sharedBlobShadowGeometry = new THREE.PlaneGeometry(1, 1);
    _sharedBlobShadowGeometry.rotateX(-Math.PI / 2);
  }
  if (!_sharedBlobShadowMaterial) {
    const blobTexture = getSharedBlobShadowTexture();
    _sharedBlobShadowMaterial = new THREE.MeshBasicMaterial({
      map: blobTexture,
      color: blobTexture ? 0xffffff : 0x000000,
      transparent: true,
      opacity: blobTexture ? 1.0 : 0.4,
      depthWrite: false,
    });
  }
  const mesh = new THREE.Mesh(_sharedBlobShadowGeometry, _sharedBlobShadowMaterial);
  mesh.renderOrder = 2;
  return mesh;
}

export function updateVehicleBlobShadow(
  blobMesh: THREE.Mesh,
  worldX: number,
  worldY: number,
  worldZ: number,
  groundY: number,
  footprintX: number,
  footprintZ: number,
  yawRad: number,
  blobShadowsEnabled: boolean,
): void {
  blobMesh.visible = blobShadowsEnabled;
  if (!blobShadowsEnabled) return;

  blobMesh.position.set(worldX, groundY + 0.02, worldZ);
  const heightAboveFloor = Math.max(0, worldY - groundY);
  const atten = Math.max(0.45, 1.0 - heightAboveFloor * 0.05);
  blobMesh.scale.set(
    Math.max(2.2, footprintX) * atten,
    1.0,
    Math.max(2.8, footprintZ) * atten,
  );
  blobMesh.rotation.y = yawRad;
}

const _blobShadowPos = new THREE.Vector3();
const _blobShadowQuat = new THREE.Quaternion();
const _blobShadowScale = new THREE.Vector3();
const _blobShadowMat = new THREE.Matrix4();
const _blobShadowUpAxis = new THREE.Vector3(0, 1, 0);
const _blobShadowHiddenMat = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Pooled single-draw-call InstancedMesh manager for all vehicle and voxel entity ground blob shadows.
 * Replaces 20+ separate PlaneGeometry draw calls with 1 instanced draw call.
 */
export class BlobShadowInstancedManager {
  public readonly mesh: THREE.InstancedMesh;
  private _capacity: number;
  private freeSlots: number[] = [];
  private activeSlots = new Set<number>();
  private dirty = false;

  public get capacity(): number {
    return this._capacity;
  }

  constructor(initialCapacity = 64) {
    this._capacity = Math.max(1, initialCapacity);
    if (!_sharedBlobShadowGeometry) {
      _sharedBlobShadowGeometry = new THREE.PlaneGeometry(1, 1);
      _sharedBlobShadowGeometry.rotateX(-Math.PI / 2);
    }
    if (!_sharedBlobShadowMaterial) {
      const blobTexture = getSharedBlobShadowTexture();
      _sharedBlobShadowMaterial = new THREE.MeshBasicMaterial({
        map: blobTexture,
        color: blobTexture ? 0xffffff : 0x000000,
        transparent: true,
        opacity: blobTexture ? 1.0 : 0.4,
        depthWrite: false,
      });
    }
    this.mesh = new THREE.InstancedMesh(
      _sharedBlobShadowGeometry,
      _sharedBlobShadowMaterial,
      this._capacity,
    );
    this.mesh.name = 'InstancedBlobShadows';
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    for (let i = this._capacity - 1; i >= 0; i--) {
      this.mesh.setMatrixAt(i, _blobShadowHiddenMat);
      this.freeSlots.push(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public acquireSlot(): number {
    if (this.freeSlots.length === 0) {
      const prevCap = this._capacity;
      const nextCap = prevCap * 2;
      const oldArr = this.mesh.instanceMatrix.array as Float32Array;
      const nextArr = new Float32Array(nextCap * 16);
      nextArr.set(oldArr);
      this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(nextArr, 16);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = nextCap - 1; i >= prevCap; i--) {
        this.mesh.setMatrixAt(i, _blobShadowHiddenMat);
        this.freeSlots.push(i);
      }
      this._capacity = nextCap;
    }
    const slot = this.freeSlots.pop()!;
    this.activeSlots.add(slot);
    this.mesh.setMatrixAt(slot, _blobShadowHiddenMat);
    this.syncCount();
    this.dirty = true;
    return slot;
  }

  public updateSlot(
    slot: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    groundY: number,
    footprintX: number,
    footprintZ: number,
    yawRad: number,
    blobShadowsEnabled: boolean,
  ): void {
    if (slot < 0 || slot >= this.capacity) return;
    if (!blobShadowsEnabled) {
      this.mesh.setMatrixAt(slot, _blobShadowHiddenMat);
      this.dirty = true;
      return;
    }
    const heightAboveFloor = Math.max(0, worldY - groundY);
    const atten = Math.max(0.45, 1.0 - heightAboveFloor * 0.05);
    _blobShadowPos.set(worldX, groundY + 0.02, worldZ);
    _blobShadowQuat.setFromAxisAngle(_blobShadowUpAxis, yawRad);
    _blobShadowScale.set(
      Math.max(2.2, footprintX) * atten,
      1.0,
      Math.max(2.8, footprintZ) * atten,
    );
    _blobShadowMat.compose(_blobShadowPos, _blobShadowQuat, _blobShadowScale);
    this.mesh.setMatrixAt(slot, _blobShadowMat);
    this.dirty = true;
  }

  public hideSlot(slot: number): void {
    if (slot < 0 || slot >= this.capacity) return;
    this.mesh.setMatrixAt(slot, _blobShadowHiddenMat);
    this.dirty = true;
  }

  public releaseSlot(slot: number): void {
    if (!this.activeSlots.has(slot)) return;
    this.activeSlots.delete(slot);
    this.mesh.setMatrixAt(slot, _blobShadowHiddenMat);
    this.freeSlots.push(slot);
    this.syncCount();
    this.dirty = true;
  }

  private syncCount(): void {
    let maxSlot = -1;
    for (const s of this.activeSlots) {
      if (s > maxSlot) maxSlot = s;
    }
    this.mesh.count = maxSlot + 1;
    this.mesh.visible = this.mesh.count > 0;
  }

  public commit(): void {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }

  public getActiveCount(): number {
    return this.activeSlots.size;
  }

  public dispose(): void {
    this.activeSlots.clear();
    this.freeSlots.length = 0;
    this.mesh.count = 0;
    this.mesh.dispose();
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DELIVERABLE 7 (PART A): GPU VOXEL-STEPPED GERSTNER OCEAN SHADER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Renders a crisp, stepped 3D voxel ocean on the GPU while CPU buoyancy
 * (sampleWavePhysicsAt) uses the exact same Gerstner wave equations.
 *  - Zero horizontal X/Z shoreline pull so water never separates from the ground
 *  - Quantizes wave coordinates and elevation to discrete voxel terraces
 *  - Shades each 0.25m × 0.25m voxel cell with a blocky voxel bevel lattice and
 *    quantized voxel seafoam crests.
 */
export interface GpuOceanWaveUniforms {
  uWaveTime: { value: number };
  uWavesEnabled: { value: number };
  uWeatherWaveMult: { value: number };
  uRealisticWater: { value: number };
  uWorldGenMode: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uHasPlanarTex: { value: number };
  uPlanarTex: { value: THREE.Texture | null };
  uReflViewProj: { value: THREE.Matrix4 };
  uPlanarStrength: { value: number };
  uWaterOutputSrgb: { value: number };
  uRenderingPlanar: { value: number };
}

export function attachGpuGerstnerOceanShader(
  material: THREE.MeshPhongMaterial,
): GpuOceanWaveUniforms {
  const waveUniforms: GpuOceanWaveUniforms = {
    uWaveTime: { value: 0.0 },
    uWavesEnabled: { value: 1.0 },
    uWeatherWaveMult: { value: 1.0 },
    uRealisticWater: { value: 0.0 },
    uWorldGenMode: { value: 0.0 },
    uSunDir: { value: new THREE.Vector3(45, 42, 55).normalize() },
    uHasPlanarTex: { value: 0.0 },
    uPlanarTex: { value: null },
    uReflViewProj: { value: new THREE.Matrix4() },
    uPlanarStrength: { value: 0.85 },
    uWaterOutputSrgb: { value: 0.0 },
    uRenderingPlanar: { value: 0.0 },
  };
  (material as any).userData.waveUniforms = waveUniforms;
  // Split Realistic Water vs Voxel-Stepped Water into two cached WebGLPrograms via compile-time #define
  material.customProgramCacheKey = () =>
    waveUniforms.uRealisticWater.value > 0.5
      ? 'gpu_gerstner_ocean_realistic_v4'
      : 'gpu_gerstner_ocean_voxel_v4';

  material.onBeforeCompile = (shader) => {
    const realisticDefine = waveUniforms.uRealisticWater.value > 0.5 ? '#define REALISTIC_WATER 1\n' : '';
    shader.uniforms.uWaveTime = waveUniforms.uWaveTime;
    shader.uniforms.uWavesEnabled = waveUniforms.uWavesEnabled;
    shader.uniforms.uWeatherWaveMult = waveUniforms.uWeatherWaveMult;
    shader.uniforms.uRealisticWater = waveUniforms.uRealisticWater;
    shader.uniforms.uWorldGenMode = waveUniforms.uWorldGenMode;
    shader.uniforms.uSunDir = waveUniforms.uSunDir;
    shader.uniforms.uHasPlanarTex = waveUniforms.uHasPlanarTex;
    shader.uniforms.uPlanarTex = waveUniforms.uPlanarTex;
    shader.uniforms.uReflViewProj = waveUniforms.uReflViewProj;
    shader.uniforms.uPlanarStrength = waveUniforms.uPlanarStrength;
    shader.uniforms.uWaterOutputSrgb = waveUniforms.uWaterOutputSrgb;
    shader.uniforms.uRenderingPlanar = waveUniforms.uRenderingPlanar;

    const oceanBasinGlsl = /* glsl */ `
      float evalPondMask(vec2 xz) {
        if (uWorldGenMode > 0.5) return 0.0;
        return 1.0 - smoothstep(13.0, 18.0, length(xz - vec2(65.0, -85.0)));
      }
      float evalOceanExposure(vec2 xz) {
        if (abs(uWorldGenMode - 4.0) < 0.5) {
          return 1.0; // BIOME_ARCHIPELAGO / CUSTOM_GLB_MAP
        }
        if (abs(uWorldGenMode - 1.0) < 0.5) {
          // BIOME_CANYON winding river
          return (1.0 - smoothstep(14.0, 18.5, abs(xz.x - sin(xz.y * 0.04) * 22.0))) * 0.55;
        }
        if (uWorldGenMode > 1.5) {
          return 0.0; // ARCTIC, VOLCANIC, FLAT_BASEPLATE, CUSTOM_HEIGHTMAP
        }
        return (1.0 - smoothstep(-32.0, -19.5, xz.x)) * (1.0 - smoothstep(27.5, 37.5, xz.y));
      }
      float evalDeepOceanDist(vec2 xz, float oceanExposure) {
        if (abs(uWorldGenMode - 4.0) < 0.5) {
          return max(0.0, length(xz) - 38.0) * 0.65;
        }
        if (uWorldGenMode > 0.5) return 0.0;
        return oceanExposure * max(0.0, -45.0 - xz.x) * (1.0 - smoothstep(25.0, 35.0, xz.y));
      }
    `;

    shader.vertexShader = shader.vertexShader.replace(
      `#include <common>`,
      `
      ${realisticDefine}
      #include <common>
      uniform float uWaveTime;
      uniform float uWavesEnabled;
      uniform float uWeatherWaveMult;
      uniform float uRealisticWater;
      uniform float uWorldGenMode;
      varying float vWaveCrestFactor;
      varying float vIsWaterSurface;
      varying float vIsHoleWater;
      varying float vWaterNormalY;
      varying vec3 vWaterWorldPos;
      ${oceanBasinGlsl}
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      `#include <beginnormal_vertex>`,
      `
      #include <beginnormal_vertex>
      float isWaterVox = 0.0;
      float isHoleWater = 0.0;
      vec3 worldPosPre = (modelMatrix * vec4(position, 1.0)).xyz;
      vWaterWorldPos = worldPosPre;
      vWaterNormalY = normal.y;

      #ifdef USE_COLOR
        // MAT.WATER_VOX has blue channel dominant over red channel; glass windows are neutral/cyan-white
        if (color.b > color.r * 1.15 && position.y >= 11.2) {
          isWaterVox = 1.0;
          float pondExposurePre = evalPondMask(worldPosPre.xz);
          float oceanExposurePre = evalOceanExposure(worldPosPre.xz);
          float subSurfaceHole = position.y < 13.92 ? 1.0 : 0.0;
          float colorTagWeight = color.r >= 0.12 ? (1.0 - oceanExposurePre) : 0.0;
          isHoleWater = clamp(max(subSurfaceHole, max(colorTagWeight, 1.0 - max(oceanExposurePre, pondExposurePre))), 0.0, 1.0);
        }
      #endif
      vIsWaterSurface = isWaterVox;
      vIsHoleWater = isHoleWater;
      vWaveCrestFactor = 0.0;

      // Only compute Gerstner wave normals on upward-facing water surfaces (never overwrite vertical side faces!)
      if (uWavesEnabled > 0.5 && isWaterVox > 0.5 && normal.y > 0.5) {
        float wx = worldPosPre.x;
        float wz = worldPosPre.z;
        float k1 = 6.2831853 / 28.0;
        float k2 = 6.2831853 / 40.0;
        float k3 = 6.2831853 / 14.0;
        float k4 = 6.2831853 / 7.5;

        float p1 = k1 * (0.85 * wx + 0.52 * wz) - 0.85 * uWaveTime;
        float p2 = k2 * (0.62 * wx - 0.78 * wz) - 1.15 * uWaveTime;
        float p3 = k3 * (-0.40 * wx + 0.91 * wz) - 1.55 * uWaveTime;
        float p4 = k4 * (0.72 * wx - 0.69 * wz) - 2.15 * uWaveTime;

        float s1 = sin(p1);
        float s2 = sin(p2);
        float s3 = sin(p3);
        float s4 = sin(p4);

        float pondMask = evalPondMask(vec2(wx, wz));
        float oceanExposure = evalOceanExposure(vec2(wx, wz));
        float deepOceanDist = evalDeepOceanDist(vec2(wx, wz), oceanExposure);

        float swellEnv = cos(wx * 0.037 + wz * 0.029 - uWaveTime * 0.42) * 0.5 + 0.5;
        float baseOceanPeak = 1.0 + 0.5 * swellEnv;
        float waveMult = clamp(1.0 + deepOceanDist / 120.0, 1.0, 6.0);
        float naturalPeak = mix(0.05, baseOceanPeak * waveMult, oceanExposure);
        naturalPeak = max(naturalPeak, pondMask * 0.45) * max(0.25, uWeatherWaveMult);

        float holeBlend = clamp(max(isHoleWater, 1.0 - max(oceanExposure, pondMask)), 0.0, 1.0);
        float peakMeters = mix(naturalPeak, 0.05, holeBlend);

        float ampScale = peakMeters / 1.84;
        float a1 = 0.65 * ampScale;
        float a2 = 0.35 * ampScale;
        float a3 = 0.14 * ampScale;
        float a4 = uRealisticWater > 0.5 ? 0.08 * ampScale : 0.0;

        float slopeX = -a1 * k1 * 0.85 * s1 - a2 * k2 * 0.62 * s2 - a3 * k3 * (-0.40) * s3 - a4 * k4 * 0.72 * s4;
        float slopeZ = -a1 * k1 * 0.52 * s1 - a2 * k2 * (-0.78) * s2 - a3 * k3 * 0.91 * s3 - a4 * k4 * (-0.69) * s4;

        objectNormal = normalize(vec3(-slopeX * 1.35, 1.0, -slopeZ * 1.35));
      }
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      `#include <begin_vertex>`,
      `
      #include <begin_vertex>
      if (vIsWaterSurface > 0.5 && normal.y > 0.5) {
        float wx = vWaterWorldPos.x;
        float wz = vWaterWorldPos.z;
        float k1 = 6.2831853 / 28.0;
        float k2 = 6.2831853 / 40.0;
        float k3 = 6.2831853 / 14.0;
        float k4 = 6.2831853 / 7.5;

        float animTime = uWavesEnabled > 0.5 ? uWaveTime : 0.0;
        float p1 = k1 * (0.85 * wx + 0.52 * wz) - 0.85 * animTime;
        float p2 = k2 * (0.62 * wx - 0.78 * wz) - 1.15 * animTime;
        float p3 = k3 * (-0.40 * wx + 0.91 * wz) - 1.55 * animTime;
        float p4 = k4 * (0.72 * wx - 0.69 * wz) - 2.15 * animTime;

        float c1 = cos(p1);
        float c2 = cos(p2);
        float c3 = cos(p3);
        float c4 = cos(p4);

        float signedWave = 0.65 * c1 + 0.35 * c2 + 0.14 * c3 + (uRealisticWater > 0.5 ? 0.08 * c4 : 0.0);
        float normWave = clamp((signedWave + 0.92) / 1.84, 0.0, 1.0);

        float pondMask = evalPondMask(vec2(wx, wz));
        float oceanExposure = evalOceanExposure(vec2(wx, wz));
        float deepOceanDist = evalDeepOceanDist(vec2(wx, wz), oceanExposure);

        float swellEnv = cos(wx * 0.037 + wz * 0.029 - animTime * 0.42) * 0.5 + 0.5;
        float baseOceanPeak = 1.0 + 0.5 * swellEnv;
        float waveMult = clamp(1.0 + deepOceanDist / 120.0, 1.0, 6.0);
        float naturalPeak = mix(0.05, baseOceanPeak * waveMult, oceanExposure);
        naturalPeak = max(naturalPeak, pondMask * 0.45) * max(0.25, uWeatherWaveMult);

        float holeBlend = clamp(max(vIsHoleWater, 1.0 - max(oceanExposure, pondMask)), 0.0, 1.0);
        float peakMeters = mix(naturalPeak, 0.05, holeBlend);

        float shoreZone = 0.0;
        float beachRunup = 0.0;
        float roadRunup = 0.0;
        if (uWorldGenMode < 0.5) {
          float eastShoreZone = (1.0 - vIsHoleWater) * smoothstep(-36.0, -26.5, wx) * (1.0 - smoothstep(-22.5, -20.5, wx)) * (1.0 - smoothstep(29.0, 37.5, wz));
          float northShoreZone = (1.0 - vIsHoleWater) * (1.0 - smoothstep(-26.5, -20.5, wx)) * smoothstep(25.0, 32.0, wz) * (1.0 - smoothstep(34.0, 38.0, wz));
          // Full Ocean Causeway Road (wx = -95.0 .. -21.0 along |wz| < 6.0)
          float roadMask = smoothstep(-96.5, -93.0, wx) * (1.0 - smoothstep(-21.5, -19.5, wx));
          float roadShoreZone = (1.0 - vIsHoleWater) * roadMask * (1.0 - smoothstep(5.5, 9.0, abs(wz))) * smoothstep(1.2, 4.5, abs(wz));
          shoreZone = max(max(eastShoreZone, northShoreZone), roadShoreZone);

          // Progressive inland run-up depth over elevated beach sand (wx > -25.5, wz > 33.0) and full Ocean Causeway Road (|wz| < 6.0):
          float eastBeachRunup = smoothstep(-25.6, -21.0, wx) * (1.0 - smoothstep(31.0, 37.5, wz));
          float northBeachRunup = smoothstep(32.8, 37.2, wz) * (1.0 - smoothstep(-26.0, -20.5, wx));
          beachRunup = (1.0 - vIsHoleWater) * max(eastBeachRunup, northBeachRunup);
          roadRunup = (1.0 - vIsHoleWater) * roadMask * (1.0 - smoothstep(1.5, 6.2, abs(wz)));
        }
        float landRunup = max(beachRunup, roadRunup);
        // Broad 28m shore breaker wavelength so each incoming roller lifts the entire beach/road swash sheet cohesively
        float shoreBreakerPhase = wx * 0.22 - animTime * 2.15 + sin(wz * 0.14) * 0.85;
        float shoreBreaker = sin(shoreBreakerPhase);
        float shoreSurge = shoreZone * (shoreBreaker > 0.0 ? pow(shoreBreaker, 1.1) * 0.48 : shoreBreaker * 0.08);

        float topSurfaceWeight = step(11.2, vWaterWorldPos.y);
        float runupSink = max(beachRunup * 0.72, roadRunup * max(0.84, peakMeters * 0.84));
        float rawH = (0.0625 + normWave * (peakMeters - 0.02) + shoreSurge - runupSink) * topSurfaceWeight;
        // Keep open/shallow ocean water >= -0.1875m (Y >= 14.0625m, 6.25cm above the 14.00m shallow seabed at surfVY=55),
        // and only allow receding swash to dip down to -0.3125m proportionally to landRunup over elevated beach/road terrain!
        float oceanFloorH = mix(0.0625, -0.1875, shoreZone);
        float minAllowedH = mix(mix(oceanFloorH, -0.3125, landRunup), 0.015, holeBlend) * topSurfaceWeight;

        float finalH = (0.0625 - runupSink) * topSurfaceWeight;
        if (uWavesEnabled > 0.5) {
          if (uRealisticWater > 0.5) {
            finalH = max(minAllowedH, rawH);
            // Push continuous water surface away from exact 0.25m voxel terrain planes (0.00m, +0.25m, +0.50m)
            float nearestPlane = floor(finalH * 4.0 + 0.5) * 0.25;
            float planeDelta = finalH - nearestPlane;
            if (abs(planeDelta) < 0.032) {
              finalH = nearestPlane + (planeDelta >= 0.0 ? 0.032 : -0.032);
            }
          } else {
            // Half-voxel 0.125m steps shifted by half a step (+0.0625m):
            // Every possible terrace ((k + 0.5) * 0.125m = ..., -0.1875, -0.0625, +0.0625, +0.1875, +0.3125, +0.4375, +0.5625, ...)
            // is guaranteed >= 6.25cm away from every 0.25m terrain voxel face (-0.25m, 0.00m, +0.25m, +0.50m)!
            float stepSize = mix(0.125, 0.025, holeBlend);
            float halfStep = stepSize * 0.5;
            float steppedH = floor((rawH - halfStep) / stepSize + 0.5) * stepSize + halfStep;
            // Blend toward smooth swash over the beach/road slope so water glides over 0.25m steps without 12.5cm snapping
            float smoothSwashBlend = clamp(landRunup * 1.35 + shoreZone * 0.35, 0.0, 1.0);
            float combinedH = mix(steppedH, rawH, smoothSwashBlend);
            float nearestPlane = floor(combinedH * 4.0 + 0.5) * 0.25;
            float planeDelta = combinedH - nearestPlane;
            if (abs(planeDelta) < 0.035) {
              combinedH = nearestPlane + (planeDelta >= 0.0 ? 0.035 : -0.035);
            }
            finalH = max(minAllowedH, combinedH);
          }
        }

        transformed.y += finalH;
        vWaveCrestFactor = mix(clamp(normWave + max(0.0, shoreSurge) * 1.15, 0.0, 1.0), normWave * 0.18, holeBlend) * topSurfaceWeight;
        vWaterWorldPos.y += finalH;
      }
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <common>`,
      `
      ${realisticDefine}
      #include <common>
      uniform float uWaveTime;
      uniform float uWavesEnabled;
      uniform float uWeatherWaveMult;
      uniform float uRealisticWater;
      uniform float uWorldGenMode;
      uniform vec3 uSunDir;
      uniform float uHasPlanarTex;
      uniform sampler2D uPlanarTex;
      uniform mat4 uReflViewProj;
      uniform float uPlanarStrength;
      uniform float uWaterOutputSrgb;
      uniform float uRenderingPlanar;
      varying float vWaveCrestFactor;
      varying float vIsWaterSurface;
      varying float vIsHoleWater;
      varying float vWaterNormalY;
      varying vec3 vWaterWorldPos;
      ${oceanBasinGlsl}

      #ifdef REALISTIC_WATER
        float waterHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float waterNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = waterHash(i);
          float b = waterHash(i + vec2(1.0, 0.0));
          float c = waterHash(i + vec2(0.0, 1.0));
          float d = waterHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        // Optimized 2-octave FBM (cuts per-pixel noise taps from 20 down to 7 on realistic water)
        float waterFbm(vec2 p) {
          float v = 0.65 * waterNoise(p);
          mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
          p = rot * p * 2.04 + vec2(11.3, 7.1);
          v += 0.35 * waterNoise(p);
          return v;
        }
      #endif
      `,
    );

    // Realistic Water Shading runs BEFORE fog/colorspace/tonemap in linear RGB (compiled out in Voxel Water mode)
    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <opaque_fragment>`,
      `
      if (uRenderingPlanar > 0.5 && vIsWaterSurface > 0.5) {
        discard;
      }
      #include <opaque_fragment>
      #ifdef REALISTIC_WATER
      if (vIsWaterSurface > 0.5) {
        // Any vertical water side face exposed to air: soft translucent water volume, never a chrome mirror wall!
        if (abs(vWaterNormalY) <= 0.5) {
          gl_FragColor.rgb = vec3(0.018, 0.21, 0.34);
          gl_FragColor.a = 0.34;
        } else {
          float animT = uWavesEnabled > 0.5 ? uWaveTime : uWaveTime * 0.28;
          vec2 pXZ = vWaterWorldPos.xz;

          float pondMask = evalPondMask(pXZ);
          float oceanExposure = evalOceanExposure(pXZ);
          float deepOceanDist = evalDeepOceanDist(pXZ, oceanExposure);
          float holeBlend = clamp(max(vIsHoleWater, 1.0 - max(oceanExposure, pondMask)), 0.0, 1.0);

          // Continuous per-pixel Gerstner swell + multi-octave directional capillary ripples
          float waveMult = clamp(1.0 + deepOceanDist / 120.0, 1.0, 6.0);
          float swellEnv = cos(pXZ.x * 0.037 + pXZ.y * 0.029 - animT * 0.42) * 0.5 + 0.5;
          float naturalPeak = max(mix(0.05, (1.0 + 0.5 * swellEnv) * waveMult, oceanExposure), pondMask * 0.45) * max(0.25, uWeatherWaveMult);
          float peakMeters = mix(naturalPeak, 0.05, holeBlend);
          float waveEnableAmp = uWavesEnabled > 0.5 ? 1.0 : 0.12;
          float ampScale = (peakMeters / 1.84) * waveEnableAmp;

          float k1 = 6.2831853 / 28.0;
          float k2 = 6.2831853 / 40.0;
          float k3 = 6.2831853 / 14.0;
          float k4 = 6.2831853 / 7.5;
          float ph1 = k1 * (0.85 * pXZ.x + 0.52 * pXZ.y) - 0.85 * animT;
          float ph2 = k2 * (0.62 * pXZ.x - 0.78 * pXZ.y) - 1.15 * animT;
          float ph3 = k3 * (-0.40 * pXZ.x + 0.91 * pXZ.y) - 1.55 * animT;
          float ph4 = k4 * (0.72 * pXZ.x - 0.69 * pXZ.y) - 2.15 * animT;

          float normWave = clamp((0.65 * cos(ph1) + 0.35 * cos(ph2) + 0.14 * cos(ph3) + 0.08 * cos(ph4) + 0.92) / 1.84, 0.0, 1.0);

          vec2 gradMacro = vec2(
            -0.65 * ampScale * k1 * 0.85 * sin(ph1)
            - 0.35 * ampScale * k2 * 0.62 * sin(ph2)
            - 0.14 * ampScale * k3 * (-0.40) * sin(ph3)
            - 0.08 * ampScale * k4 * 0.72 * sin(ph4),
            -0.65 * ampScale * k1 * 0.52 * sin(ph1)
            - 0.35 * ampScale * k2 * (-0.78) * sin(ph2)
            - 0.14 * ampScale * k3 * 0.91 * sin(ph3)
            - 0.08 * ampScale * k4 * (-0.69) * sin(ph4)
          );

          // High-frequency rotating capillary wavelets (2-octave FBM finite difference)
          float eps = 0.08;
          vec2 uvA = pXZ * 0.62 + vec2(animT * 0.62, -animT * 0.41);
          float r0 = waterFbm(uvA);
          float rx = waterFbm(uvA + vec2(eps, 0.0));
          float rz = waterFbm(uvA + vec2(0.0, eps));
          float microScale = mix(0.28, 0.12, holeBlend) * mix(0.55, 1.0, waveEnableAmp);
          vec2 gradMicro = vec2(rx - r0, rz - r0) / eps * microScale;

          vec3 N = normalize(vec3(-(gradMacro.x * 1.15 + gradMicro.x), 1.0, -(gradMacro.y * 1.15 + gradMicro.y)));
          vec3 V = normalize(cameraPosition - vWaterWorldPos);
          vec3 L = normalize(uSunDir);

          bool isUnderwater = cameraPosition.y < vWaterWorldPos.y - 0.05 || !gl_FrontFacing;
          if (isUnderwater) {
            vec3 Nunder = normalize(vec3(N.x * 0.5, -abs(N.y), N.z * 0.5));
            float underNdotV = clamp(dot(Nunder, V), 0.02, 1.0);
            float snellWindow = smoothstep(0.32, 0.72, underNdotV);
            vec3 deepUnderRefl = vec3(0.012, 0.145, 0.255) + vec3(0.015, 0.10, 0.14) * normWave;
            vec3 snellSkyTint = vec3(0.14, 0.42, 0.64);
            float uh = max(dot(Nunder, normalize(L + V)), 0.0);
            float uh2 = uh * uh; float uh4 = uh2 * uh2; float uh8 = uh4 * uh4; float uh16 = uh8 * uh8;
            float underGlitter = (uh16 * uh16 * uh16 * uh16) * 0.45;
            gl_FragColor.rgb = mix(deepUnderRefl, snellSkyTint, snellWindow * 0.75) + vec3(0.55, 0.85, 0.96) * underGlitter;
            gl_FragColor.a = mix(0.58, 0.18, snellWindow);
          } else {
            float NdotV = clamp(dot(N, V), 0.02, 1.0);
            float invNdotV = 1.0 - NdotV;
            float inv2 = invNdotV * invNdotV;
            float fresnel = 0.03 + 0.97 * (inv2 * inv2 * invNdotV);

            vec3 abyssCol   = vec3(0.004, 0.030, 0.110);
            vec3 pelagicCol = vec3(0.010, 0.115, 0.255);
            vec3 shallowCol = vec3(0.022, 0.275, 0.355);
            float depthFactor = clamp(oceanExposure * (0.25 + clamp(deepOceanDist / 160.0, 0.0, 0.75)), 0.0, 1.0);
            vec3 waterBodyCol = mix(shallowCol, mix(pelagicCol, abyssCol, depthFactor), clamp(0.35 + depthFactor * 0.65 - normWave * 0.28, 0.0, 1.0));

            float sssBase = clamp(dot(V, -L + N * 0.45), 0.0, 1.0);
            float sssWrap = sssBase * sssBase * sssBase;
            float crestHeight = clamp(normWave * (1.0 - holeBlend), 0.0, 1.0);
            waterBodyCol += vec3(0.020, 0.34, 0.39) * (sssWrap * 0.65 + crestHeight * 0.22);

            vec3 R = reflect(-V, N);
            float rUp = clamp(R.y, 0.0, 1.0);
            vec3 skyZenith  = vec3(0.045, 0.195, 0.560);
            vec3 skyHorizon = vec3(0.310, 0.540, 0.790);
            vec3 skyReflCol = mix(skyHorizon, skyZenith, sqrt(rUp));
            float cloudWisp = smoothstep(0.52, 0.85, waterNoise(R.xz / max(0.14, R.y + 0.18) * 1.4 + animT * 0.02));
            skyReflCol = mix(skyReflCol, vec3(0.85, 0.90, 0.96), cloudWisp * 0.22 * (1.0 - rUp * 0.5));

            // #14 Real-Time Planar Mirror Reflection sampling with wave distortion
            if (uHasPlanarTex > 0.5) {
              vec4 reflClip = uReflViewProj * vec4(vWaterWorldPos.x, 14.0, vWaterWorldPos.z, 1.0);
              if (reflClip.w > 0.01) {
                vec2 reflUv = (reflClip.xy / reflClip.w) * 0.5 + 0.5;
                vec2 distortedUv = reflUv + N.xz * vec2(0.042, 0.032);
                float edgeFade =
                  smoothstep(0.01, 0.10, distortedUv.x) * smoothstep(0.99, 0.90, distortedUv.x) *
                  smoothstep(0.01, 0.10, distortedUv.y) * smoothstep(0.99, 0.90, distortedUv.y);
                if (edgeFade > 0.01) {
                  vec3 planarCol = texture2D(uPlanarTex, clamp(distortedUv, 0.002, 0.998)).rgb;
                  float reflLuma = dot(planarCol, vec3(0.2126, 0.7152, 0.0722));
                  float validPlanar = smoothstep(0.002, 0.025, reflLuma);
                  skyReflCol = mix(skyReflCol, planarCol, edgeFade * validPlanar * clamp(uPlanarStrength, 0.0, 1.0));
                }
              }
            }

            // Blinn-Phong solar glitter sparkle path
            vec3 H = normalize(L + V);
            float NdotH = max(dot(N, H), 0.0);
            float sunCore = pow(NdotH, 320.0) * 2.6;
            float sunHalo = pow(NdotH, 48.0) * 0.34;
            vec3 sunGlitter = vec3(1.0, 0.93, 0.80) * (sunCore + sunHalo);

            // Shoreline surf & lacy whitecaps
            float swashZone = 0.0;
            if (uWorldGenMode < 0.5) {
              float eastSwash = (1.0 - vIsHoleWater) * smoothstep(-32.0, -25.5, pXZ.x) * (1.0 - smoothstep(-23.0, -20.5, pXZ.x)) * (1.0 - smoothstep(29.0, 37.5, pXZ.y));
              float northSwash = (1.0 - vIsHoleWater) * (1.0 - smoothstep(-26.5, -20.5, pXZ.x)) * smoothstep(27.0, 32.5, pXZ.y) * (1.0 - smoothstep(34.0, 38.0, pXZ.y));
              float roadSwash = (1.0 - vIsHoleWater) * smoothstep(-96.0, -93.0, pXZ.x) * (1.0 - smoothstep(-22.5, -20.5, pXZ.x)) * (1.0 - smoothstep(5.2, 8.0, abs(pXZ.y))) * smoothstep(1.8, 4.5, abs(pXZ.y));
              swashZone = max(max(eastSwash, northSwash), roadSwash);
            }
            float shoreBreakerFoam = swashZone * clamp(sin(pXZ.x * 0.22 - animT * 2.15 + sin(pXZ.y * 0.14) * 0.85) * 0.52 + 0.42, 0.0, 1.0);
            float foamNoise = waterFbm(pXZ * 1.15 + vec2(-animT * 0.35, animT * 0.25));
            float crestSignal = smoothstep(0.76, 0.97, normWave) * (0.45 + 0.55 * foamNoise);
            float surfSignal = shoreBreakerFoam * smoothstep(0.32, 0.78, foamNoise);
            float foamMask = (1.0 - smoothstep(0.28, 0.60, holeBlend)) * smoothstep(0.46, 0.86, max(crestSignal, surfSignal * 1.05));

            float reflBlend = clamp(0.08 + fresnel * 0.84, 0.08, 0.92);
            vec3 waterLinear = mix(waterBodyCol, skyReflCol, reflBlend) + sunGlitter;
            waterLinear = mix(waterLinear, vec3(0.86, 0.92, 0.97), foamMask * 0.78);

            float shallowFade = mix(0.62, 1.0, clamp(oceanExposure * 0.75 + depthFactor * 0.45, 0.0, 1.0));
            gl_FragColor.rgb = waterLinear;
            gl_FragColor.a = mix(0.84, 0.97, max(fresnel * 0.55, foamMask)) * max(shallowFade, foamMask * 0.85);
          }
        }
      }
      #endif
      `,
    );

    // Classic Voxel-Stepped Water Shader (compiled ONLY when REALISTIC_WATER is NOT defined)
    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <dithering_fragment>`,
      `
      #include <dithering_fragment>
      #ifndef REALISTIC_WATER
      if (vIsWaterSurface > 0.5) {
        vec2 voxId = floor(vWaterWorldPos.xz / 0.25);
        vec2 voxUv = fract(vWaterWorldPos.xz / 0.25);
        float cellHash = fract(sin(dot(voxId, vec2(12.9898, 78.233))) * 43758.5453);

        vec2 cellWorldXZ = (voxId + 0.5) * 0.25;
        float animT = uWavesEnabled > 0.5 ? uWaveTime : 0.0;
        float k1 = 6.2831853 / 28.0;
        float k2 = 6.2831853 / 40.0;
        float k3 = 6.2831853 / 14.0;
        float cw1 = cos(k1 * (0.85 * cellWorldXZ.x + 0.52 * cellWorldXZ.y) - 0.85 * animT);
        float cw2 = cos(k2 * (0.62 * cellWorldXZ.x - 0.78 * cellWorldXZ.y) - 1.15 * animT);
        float cw3 = cos(k3 * (-0.40 * cellWorldXZ.x + 0.91 * cellWorldXZ.y) - 1.55 * animT);
        float cellNormWave = clamp(((0.65 * cw1 + 0.35 * cw2 + 0.14 * cw3) + 0.92) / 1.84, 0.0, 1.0);

        float pondMask = evalPondMask(cellWorldXZ);
        float oceanExposure = evalOceanExposure(cellWorldXZ);
        float holeBlend = clamp(max(vIsHoleWater, 1.0 - max(oceanExposure, pondMask)), 0.0, 1.0);

        float swashZone = 0.0;
        if (uWorldGenMode < 0.5) {
          float eastSwash = (1.0 - vIsHoleWater) * smoothstep(-32.0, -25.5, cellWorldXZ.x) * (1.0 - smoothstep(-23.2, -20.5, cellWorldXZ.x)) * (1.0 - smoothstep(29.5, 37.5, cellWorldXZ.y));
          float northSwash = (1.0 - vIsHoleWater) * (1.0 - smoothstep(-26.5, -20.5, cellWorldXZ.x)) * smoothstep(28.0, 32.5, cellWorldXZ.y) * (1.0 - smoothstep(34.2, 38.0, cellWorldXZ.y));
          float roadSwash = (1.0 - vIsHoleWater) * smoothstep(-96.0, -93.0, cellWorldXZ.x) * (1.0 - smoothstep(-22.5, -20.5, cellWorldXZ.x)) * (1.0 - smoothstep(5.2, 8.0, abs(cellWorldXZ.y))) * smoothstep(1.8, 4.5, abs(cellWorldXZ.y));
          swashZone = max(max(eastSwash, northSwash), roadSwash);
        }
        float shoreBreakerFoam = swashZone * clamp(sin(cellWorldXZ.x * 0.22 - animT * 2.15 + sin(cellWorldXZ.y * 0.14) * 0.85) * 0.65 + 0.45, 0.0, 1.0);

        float openBand = clamp(cellNormWave + swashZone * 0.25 + (cellHash - 0.5) * 0.12, 0.0, 0.999);
        float holeBand = clamp(0.22 + cellNormWave * 0.25 + (cellHash - 0.5) * 0.06, 0.0, 0.58);
        float effectiveWaveBand = mix(openBand, holeBand, holeBlend);
        float steppedBand = floor(effectiveWaveBand * 5.0) / 4.0;

        vec3 deepTroughCol = vec3(0.03, 0.24, 0.60);
        vec3 midSwellCol   = vec3(0.04, 0.50, 0.90);
        vec3 surfCyanCol   = vec3(0.20, 0.79, 0.98);
        vec3 foamWhiteCol  = vec3(0.95, 0.99, 1.00);

        vec3 waveCol = mix(deepTroughCol, midSwellCol, clamp(steppedBand * 1.4, 0.0, 1.0));
        waveCol = mix(waveCol, surfCyanCol, clamp((steppedBand - 0.45) * 1.8, 0.0, 1.0));

        float blockyFoamNoise = fract(sin(dot(floor(vWaterWorldPos.xz / 0.5) + floor(animT * 1.5), vec2(27.1, 91.7))) * 43758.5453);
        float isFoamBlock = (1.0 - step(0.35, holeBlend)) * step(0.70, max(cellNormWave, shoreBreakerFoam * 1.12) + blockyFoamNoise * 0.16);
        waveCol = mix(waveCol, foamWhiteCol, isFoamBlock * 0.92);

        vec2 edgeDist = abs(voxUv - 0.5);
        float maxEdge = max(edgeDist.x, edgeDist.y);
        float voxelBevelLine = smoothstep(0.42, 0.48, maxEdge);
        vec3 bevelCol = mix(waveCol * 0.80, vec3(0.65, 0.92, 1.0), isFoamBlock * 0.5);
        waveCol = mix(waveCol, bevelCol, voxelBevelLine * 0.55);

        gl_FragColor.rgb = mix(gl_FragColor.rgb, waveCol, 0.86);
        gl_FragColor.a = max(gl_FragColor.a, mix(0.92, 0.98, isFoamBlock));
      }
      #endif
      `,
    );
  };

  material.needsUpdate = true;
  return waveUniforms;
}
