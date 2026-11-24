import { Color, Vector2, Vector3, Vector4, type ColorRepresentation } from '../math';
import { ShaderMaterial } from '../materials/ShaderMaterial';

export const VOXEL_MAT_DEFAULT = 0;
export const VOXEL_MAT_GRASS = 1;
export const VOXEL_MAT_DIRT = 2;
export const VOXEL_MAT_STONE = 3;
export const VOXEL_MAT_WOOD = 4;
export const VOXEL_MAT_METAL = 5;
export const VOXEL_MAT_GLASS = 6;
export const VOXEL_MAT_PALETTE_SIZE = 7;

export interface VoxelMaterialSpec {
  color: Color;
  /** Material surface hardness (0..1), boosts rim highlight sharpness. */
  hardness: number;
  /** How strongly baked vertex AO darkens crevices (0..1). */
  aoContribution: number;
  /** Specular/rim boost factor for stylized highlights. */
  rimBoost: number;
  /** Base alpha (1.0 for opaque blocks, <1.0 for glass). */
  alpha: number;
}

export function createDefaultVoxelMaterialPalette(): VoxelMaterialSpec[] {
  return [
    // 0: Default
    { color: new Color(0xffffff), hardness: 0.4, aoContribution: 1.0, rimBoost: 1.0, alpha: 1.0 },
    // 1: Grass
    { color: new Color(0x5ea843), hardness: 0.2, aoContribution: 0.9, rimBoost: 0.75, alpha: 1.0 },
    // 2: Dirt
    { color: new Color(0x8a6142), hardness: 0.25, aoContribution: 1.0, rimBoost: 0.6, alpha: 1.0 },
    // 3: Stone
    { color: new Color(0x889098), hardness: 0.7, aoContribution: 1.0, rimBoost: 0.9, alpha: 1.0 },
    // 4: Wood
    { color: new Color(0x9c6e44), hardness: 0.45, aoContribution: 0.95, rimBoost: 0.8, alpha: 1.0 },
    // 5: Metal
    { color: new Color(0xb8c4d4), hardness: 0.95, aoContribution: 0.85, rimBoost: 1.65, alpha: 1.0 },
    // 6: Glass
    { color: new Color(0x9ee6ff), hardness: 0.9, aoContribution: 0.35, rimBoost: 1.85, alpha: 0.65 },
  ];
}

export const VOXEL_POTATO_VERTEX_SHADER = `
attribute float voxelMaterial;
attribute float lodLevel;

uniform vec2 uLodDistances;
uniform float uEnableGpuLod;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vColor;
varying float vFogDepth;
varying float vVoxelMaterial;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec3 toCamera = cameraPosition - worldPosition.xyz;
  float camDist = length(toCamera);

  // Single-draw-call GPU LOD culling: discard vertices whose lodLevel does not match camera distance band
  if (uEnableGpuLod > 0.5) {
    float activeLod = camDist < uLodDistances.x ? 0.0 : (camDist < uLodDistances.y ? 1.0 : 2.0);
    if (abs(lodLevel - activeLod) > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vNormal = vec3(0.0, 1.0, 0.0);
      vViewDir = vec3(0.0, 0.0, 1.0);
      vColor = vec3(1.0);
      vFogDepth = 0.0;
      vVoxelMaterial = 0.0;
      return;
    }
  }

  vColor = color;
  vVoxelMaterial = voxelMaterial;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = toCamera / max(camDist, 0.0001);

  vec4 mvPosition = viewMatrix * worldPosition;
  vFogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const VOXEL_POTATO_FRAGMENT_SHADER = `
uniform vec3 uMatColors[${VOXEL_MAT_PALETTE_SIZE}];
uniform vec4 uMatProps[${VOXEL_MAT_PALETTE_SIZE}];

uniform vec3 uLightDir;
uniform vec3 uSunTint;
uniform vec3 uShadowTint;
uniform vec3 uRimColor;
uniform float uRimIntensity;
uniform float uFogEnabled;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vColor;
varying float vFogDepth;
varying float vVoxelMaterial;

void main() {
  int matId = int(clamp(floor(vVoxelMaterial + 0.5), 0.0, ${VOXEL_MAT_PALETTE_SIZE - 1}.0));

  vec3 matColor = uMatColors[0];
  vec4 matProp = uMatProps[0];
  for (int i = 1; i < ${VOXEL_MAT_PALETTE_SIZE}; i++) {
    if (i == matId) {
      matColor = uMatColors[i];
      matProp = uMatProps[i];
    }
  }

  float hardness = matProp.x;
  float aoContrib = matProp.y;
  float rimBoost = matProp.z;
  float alpha = matProp.w;

  vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);

  // Combine per-vertex baked AO/tint with palette material color weighted by aoContribution
  vec3 bakedTint = mix(vec3(1.0), vColor, aoContrib);
  vec3 baseAlbedo = clamp(matColor * bakedTint, 0.0, 1.0);

  // Hemisphere AO + fast 3-band smoothstep cel shading (no pow/sin)
  float hemiAO = 0.84 + 0.08 * (N.y + 1.0);
  float NdotL = dot(N, normalize(uLightDir));
  float bandShadow = smoothstep(-0.12, 0.08, NdotL);
  float bandMid = smoothstep(0.32, 0.48, NdotL);
  float bandHigh = smoothstep(0.74, 0.88, NdotL);
  float celIntensity = (0.50 + 0.26 * bandShadow + 0.14 * bandMid + 0.10 * bandHigh) * hemiAO;
  vec3 lightColor = mix(uShadowTint, uSunTint, bandShadow);

  // Fast cubic Fresnel rim scaled by material hardness and rimBoost
  float fresnel = 1.0 - max(dot(N, normalize(vViewDir)), 0.0);
  float rim = fresnel * fresnel * fresnel;
  vec3 rimContribution = uRimColor * (rim * uRimIntensity * rimBoost * (0.5 + 0.5 * hardness));

  vec3 litColor = baseAlbedo * lightColor * celIntensity + rimContribution;

  if (uFogEnabled > 0.5) {
    float fogFactor = clamp((vFogDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
    litColor = mix(litColor, uFogColor, fogFactor);
  }

  gl_FragColor = vec4(litColor, alpha);
}
`;

export interface VoxelPotatoMaterialOptions {
  palette?: VoxelMaterialSpec[];
  lightDir?: Vector3;
  sunTint?: ColorRepresentation;
  shadowTint?: ColorRepresentation;
  rimColor?: ColorRepresentation;
  rimIntensity?: number;
  fogEnabled?: boolean;
  fogColor?: ColorRepresentation;
  fogNear?: number;
  fogFar?: number;
  enableGpuLod?: boolean;
  lodDistances?: Vector2;
}

export function createVoxelPotatoMaterial(options: VoxelPotatoMaterialOptions = {}): ShaderMaterial {
  const palette = options.palette ?? createDefaultVoxelMaterialPalette();

  const matColors: Color[] = [];
  const matProps: Vector4[] = [];
  for (let i = 0; i < VOXEL_MAT_PALETTE_SIZE; i++) {
    const entry = palette[i] ?? palette[0];
    matColors.push(entry.color.clone());
    matProps.push(new Vector4(entry.hardness, entry.aoContribution, entry.rimBoost, entry.alpha));
  }

  const material = new ShaderMaterial({
    name: 'VoxelPotatoMaterial',
    vertexColors: true,
    isVoxelMaterial: true,
    uniforms: {
      uMatColors: { value: matColors },
      uMatProps: { value: matProps },
      uLightDir: { value: (options.lightDir ?? new Vector3(0.45, 0.82, 0.35)).clone().normalize() },
      uSunTint: { value: new Color(options.sunTint ?? 0xfff7e6) },
      uShadowTint: { value: new Color(options.shadowTint ?? 0x6f8db8) },
      uRimColor: { value: new Color(options.rimColor ?? 0xd8f0ff) },
      uRimIntensity: { value: options.rimIntensity ?? 0.42 },
      uFogEnabled: { value: options.fogEnabled ? 1.0 : 0.0 },
      uFogColor: { value: new Color(options.fogColor ?? 0x6ab4e8) },
      uFogNear: { value: options.fogNear ?? 80.0 },
      uFogFar: { value: options.fogFar ?? 380.0 },
      uEnableGpuLod: { value: options.enableGpuLod ? 1.0 : 0.0 },
      uLodDistances: { value: (options.lodDistances ?? new Vector2(96, 224)).clone() },
    },
    vertexShader: VOXEL_POTATO_VERTEX_SHADER,
    fragmentShader: VOXEL_POTATO_FRAGMENT_SHADER,
  });

  return material;
}

export function setVoxelMaterialPaletteEntry(
  material: ShaderMaterial,
  materialId: number,
  color: ColorRepresentation,
  hardness: number,
  aoContribution: number,
  rimBoost = 1.0,
  alpha = 1.0,
): void {
  const idx = Math.max(0, Math.min(VOXEL_MAT_PALETTE_SIZE - 1, Math.floor(materialId)));
  const colors = material.uniforms.uMatColors?.value as Color[] | undefined;
  const props = material.uniforms.uMatProps?.value as Vector4[] | undefined;
  if (colors && colors[idx]) {
    colors[idx].set(color);
  }
  if (props && props[idx]) {
    props[idx].set(hardness, aoContribution, rimBoost, alpha);
  }
  material.uniformsNeedUpdate = true;
}
