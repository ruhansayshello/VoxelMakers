import { SRGBColorSpace } from '../../math';
import { GLSL3, type GLSLVersion } from '../../core/constants';
import {
  ACESFilmicToneMapping,
  CineonToneMapping,
  LinearToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
} from './constants';
import { createWebGLShader, formatShaderLog } from './WebGLShader';
import { WebGLUniforms } from './WebGLUniforms';

export interface OnBeforeCompileShader {
  name: string;
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

export interface ProgramParameters {
  shaderID: 'basic' | 'lambert' | 'line' | 'points' | 'custom';
  shaderName: string;
  precision: 'highp' | 'mediump' | 'lowp';
  glslVersion: GLSLVersion;
  vertexShader: string;
  fragmentShader: string;
  compiledVertexShader?: string;
  compiledFragmentShader?: string;
  defines: Record<string, unknown>;
  isRawShaderMaterial: boolean;
  instancing: boolean;
  instancingColor: boolean;
  map: boolean;
  alphaMap: boolean;
  emissiveMap: boolean;
  vertexColors: boolean;
  vertexAlphas: boolean;
  vertexAo?: boolean;
  vertexSpawnPop?: boolean;
  flatShading: boolean;
  doubleSided: boolean;
  flipSided: boolean;
  fog: boolean;
  fogExp2: boolean;
  alphaTest: number;
  toneMapping: number;
  outputColorSpace: string;
  numDirLights: number;
  numHemiLights: number;
  numPointLights: number;
  sizeAttenuation: boolean;
  customProgramCacheKey: string;
}

export interface AttributeLocationInfo {
  type: number;
  location: number;
  locationSize: number;
}

export interface ProgramRendererLike {
  getContext(): WebGL2RenderingContext;
}

let _programId = 0;

function generateDefines(defines: Record<string, unknown>): string {
  const chunks: string[] = [];
  for (const name of Object.keys(defines)) {
    const value = defines[name];
    if (value === false || value === undefined) continue;
    chunks.push(`#define ${name} ${value}`);
  }
  return chunks.join('\n');
}

function getToneMappingGLSL(toneMapping: number): string {
  switch (toneMapping) {
    case LinearToneMapping:
      return `vec3 toneMapping(vec3 color) { return color * toneMappingExposure; }`;
    case ReinhardToneMapping:
      return `vec3 toneMapping(vec3 color) {
  color *= toneMappingExposure;
  return clamp(color / (vec3(1.0) + color), 0.0, 1.0);
}`;
    case CineonToneMapping:
      return `vec3 toneMapping(vec3 color) {
  color *= toneMappingExposure;
  color = max(vec3(0.0), color - 0.004);
  return pow((color * (6.2 * color + 0.5)) / (color * (6.2 * color + 1.7) + 0.06), vec3(2.2));
}`;
    case ACESFilmicToneMapping:
      return `vec3 toneMapping(vec3 color) {
  color *= toneMappingExposure / 0.6;
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
}`;
    case NoToneMapping:
    default:
      return `vec3 toneMapping(vec3 color) { return color; }`;
  }
}

function getOutputColorSpaceGLSL(colorSpace: string): string {
  if (colorSpace === SRGBColorSpace) {
    return `vec4 linearToOutputTexel(vec4 value) {
  vec3 c = max(value.rgb, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return vec4(mix(hi, lo, step(c, vec3(0.0031308))), value.a);
}`;
  }
  return `vec4 linearToOutputTexel(vec4 value) { return value; }`;
}

function getFogFragmentGLSL(fog: boolean, fogExp2: boolean): string {
  if (!fog) return '';
  if (fogExp2) {
    return `float _fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(_fogFactor, 0.0, 1.0));`;
  }
  return `float _fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, _fogFactor);`;
}

function getBuiltinDefines(params: ProgramParameters): string {
  return [
    params.vertexColors ? '#define USE_COLOR' : '',
    params.vertexAo ? '#define USE_AO' : '',
    params.vertexSpawnPop ? '#define USE_SPAWN_POP' : '',
    params.instancing ? '#define USE_INSTANCING' : '',
    params.instancingColor ? '#define USE_INSTANCING_COLOR' : '',
    params.doubleSided ? '#define DOUBLE_SIDED' : '',
    params.flipSided ? '#define FLIP_SIDED' : '',
    params.flatShading ? '#define FLAT_SHADED' : '',
    params.map ? '#define USE_MAP' : '',
    params.alphaMap ? '#define USE_ALPHAMAP' : '',
    params.emissiveMap ? '#define USE_EMISSIVEMAP' : '',
    params.fog ? '#define USE_FOG' : '',
    params.fog && params.fogExp2 ? '#define FOG_EXP2' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildBuiltinShaderChunks(params: ProgramParameters): Record<string, string> {
  const fogFrag = getFogFragmentGLSL(params.fog, params.fogExp2);
  const instancingNormal = params.instancing
    ? 'transformedNormal = mat3(instanceMatrix) * transformedNormal;'
    : '';
  const instancingPos = params.instancing ? 'mvPosition = instanceMatrix * mvPosition;' : '';
  const instancingWorldPos = params.instancing ? 'worldPosition = instanceMatrix * worldPosition;' : '';
  const isLambert = params.shaderID === 'lambert';

  const beginVertexChunk = params.vertexSpawnPop
    ? `vec3 transformed = vec3(position);
  if (spawnTime > 0.0) {
    float _popAge = max(0.0, uCurrentTime - spawnTime);
    float _popScale = mix(0.5, 1.0, clamp(_popAge / 0.1, 0.0, 1.0));
    transformed = voxelCenter + (transformed - voxelCenter) * _popScale;
  }`
    : 'vec3 transformed = vec3(position);';

  return {
    common: '',
    beginnormal_vertex: isLambert ? 'vec3 objectNormal = vec3(normal);' : '',
    defaultnormal_vertex: isLambert
      ? `vec3 transformedNormal = objectNormal;
  ${instancingNormal}
  transformedNormal = normalMatrix * transformedNormal;
  vViewNormal = normalize(transformedNormal);`
      : '',
    begin_vertex: beginVertexChunk,
    project_vertex: isLambert
      ? `vec4 mvPosition = vec4(transformed, 1.0);
  ${instancingPos}
  mvPosition = modelViewMatrix * mvPosition;
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;`
      : `vec4 mvPosition = vec4(transformed, 1.0);
  ${instancingPos}
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`,
    worldpos_vertex: `vec4 worldPosition = vec4(transformed, 1.0);
  ${instancingWorldPos}
  worldPosition = modelMatrix * worldPosition;`,
    opaque_fragment: 'gl_FragColor = vec4(outgoingLight, diffuseColor.a);',
    output_fragment: 'gl_FragColor = vec4(outgoingLight, diffuseColor.a);',
    tonemapping_fragment: 'gl_FragColor.rgb = toneMapping(gl_FragColor.rgb);',
    colorspace_fragment: 'gl_FragColor = linearToOutputTexel(gl_FragColor);',
    encodings_fragment: 'gl_FragColor = linearToOutputTexel(gl_FragColor);',
    fog_fragment: fogFrag,
    dithering_fragment: '',
  };
}

const INCLUDE_PATTERN = /^[ \t]*#include[ \t]+<([\w\d_]+)>/gm;

export function resolveShaderIncludes(source: string, chunks: Record<string, string>): string {
  let result = source;
  for (let pass = 0; pass < 4; pass++) {
    if (!result.includes('#include')) break;
    let replaced = false;
    result = result.replace(INCLUDE_PATTERN, (_match, name: string) => {
      replaced = true;
      return chunks[name] ?? '';
    });
    if (!replaced) break;
  }
  return result;
}

export function buildBuiltinShaderTemplates(params: ProgramParameters): { vertex: string; fragment: string } {
  const toneGLSL = getToneMappingGLSL(params.toneMapping);
  const outGLSL = getOutputColorSpaceGLSL(params.outputColorSpace);
  const definesGLSL = getBuiltinDefines(params);

  if (params.shaderID === 'basic' || params.shaderID === 'line') {
    const vertex = `
precision ${params.precision} float;
precision ${params.precision} int;
${definesGLSL}
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
attribute vec3 position;
${params.map || params.alphaMap ? 'attribute vec2 uv;\nvarying vec2 vUv;' : ''}
${params.vertexColors ? 'attribute vec3 color;\nvarying vec3 vColor;' : ''}
${params.vertexAo ? 'attribute float ao;\nvarying float vAo;' : ''}
${params.vertexSpawnPop ? 'attribute float spawnTime;\nattribute vec3 voxelCenter;\nuniform float uCurrentTime;' : ''}
${params.instancing ? 'attribute mat4 instanceMatrix;' : ''}
${params.instancingColor ? 'attribute vec3 instanceColor;\nvarying vec3 vInstanceColor;' : ''}
${params.fog ? 'varying float vFogDepth;' : ''}
#include <common>

void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  ${params.map || params.alphaMap ? 'vUv = uv;' : ''}
  ${params.vertexColors ? 'vColor = color;' : ''}
  ${params.vertexAo ? 'vAo = ao;' : ''}
  ${params.instancingColor ? 'vInstanceColor = instanceColor;' : ''}
  ${params.fog ? 'vFogDepth = -mvPosition.z;' : ''}
}`;

    const fragment = `
precision ${params.precision} float;
precision ${params.precision} int;
${definesGLSL}
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform vec3 diffuse;
uniform float opacity;
uniform float toneMappingExposure;
${params.map ? 'uniform sampler2D map;\nvarying vec2 vUv;' : ''}
${params.alphaMap ? `uniform sampler2D alphaMap;\n${params.map ? '' : 'varying vec2 vUv;'}` : ''}
${params.vertexColors ? 'varying vec3 vColor;' : ''}
${params.vertexAo ? 'varying float vAo;' : ''}
${params.instancingColor ? 'varying vec3 vInstanceColor;' : ''}
${params.fog ? `uniform vec3 fogColor;\nvarying float vFogDepth;\n${params.fogExp2 ? 'uniform float fogDensity;' : 'uniform float fogNear;\nuniform float fogFar;'}` : ''}
${params.alphaTest > 0 ? 'uniform float alphaTest;' : ''}
${toneGLSL}
${outGLSL}
#include <common>

void main() {
  vec4 diffuseColor = vec4(diffuse, opacity);
  ${params.map ? 'diffuseColor *= texture2D(map, vUv);' : ''}
  ${params.alphaMap ? 'diffuseColor.a *= texture2D(alphaMap, vUv).g;' : ''}
  ${params.vertexColors ? 'diffuseColor.rgb *= vColor;' : ''}
  ${params.vertexAo ? 'diffuseColor.rgb *= vAo;' : ''}
  ${params.instancingColor ? 'diffuseColor.rgb *= vInstanceColor;' : ''}
  ${params.alphaTest > 0 ? 'if (diffuseColor.a < alphaTest) discard;' : ''}
  vec3 outgoingLight = diffuseColor.rgb;
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}`;
    return { vertex, fragment };
  }

  if (params.shaderID === 'points') {
    const vertex = `
precision ${params.precision} float;
precision ${params.precision} int;
${definesGLSL}
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform float size;
uniform float scale;
attribute vec3 position;
${params.vertexColors ? 'attribute vec3 color;\nvarying vec3 vColor;' : ''}
${params.fog ? 'varying float vFogDepth;' : ''}
#include <common>

void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  gl_PointSize = size${params.sizeAttenuation ? ' * (scale / max(-mvPosition.z, 0.001))' : ''};
  ${params.vertexColors ? 'vColor = color;' : ''}
  ${params.fog ? 'vFogDepth = -mvPosition.z;' : ''}
}`;

    const fragment = `
precision ${params.precision} float;
precision ${params.precision} int;
${definesGLSL}
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform vec3 diffuse;
uniform float opacity;
uniform float toneMappingExposure;
${params.map ? 'uniform sampler2D map;' : ''}
${params.alphaMap ? 'uniform sampler2D alphaMap;' : ''}
${params.vertexColors ? 'varying vec3 vColor;' : ''}
${params.fog ? `uniform vec3 fogColor;\nvarying float vFogDepth;\n${params.fogExp2 ? 'uniform float fogDensity;' : 'uniform float fogNear;\nuniform float fogFar;'}` : ''}
${params.alphaTest > 0 ? 'uniform float alphaTest;' : ''}
${toneGLSL}
${outGLSL}
#include <common>

void main() {
  vec4 diffuseColor = vec4(diffuse, opacity);
  ${params.map ? 'diffuseColor *= texture2D(map, gl_PointCoord);' : ''}
  ${params.alphaMap ? 'diffuseColor.a *= texture2D(alphaMap, gl_PointCoord).g;' : ''}
  ${params.vertexColors ? 'diffuseColor.rgb *= vColor;' : ''}
  ${params.alphaTest > 0 ? 'if (diffuseColor.a < alphaTest) discard;' : ''}
  vec3 outgoingLight = diffuseColor.rgb;
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}`;
    return { vertex, fragment };
  }

  // MeshLambertMaterial / MeshPhongMaterial / MeshStandardMaterial
  const dirCount = params.numDirLights;
  const hemiCount = params.numHemiLights;
  const pointCount = params.numPointLights;

  const vertex = `
precision ${params.precision} float;
precision ${params.precision} int;
${definesGLSL}
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
attribute vec3 position;
attribute vec3 normal;
${params.map || params.alphaMap || params.emissiveMap ? 'attribute vec2 uv;\nvarying vec2 vUv;' : ''}
${params.vertexColors ? 'attribute vec3 color;\nvarying vec3 vColor;' : ''}
${params.vertexAo ? 'attribute float ao;\nvarying float vAo;' : ''}
${params.vertexSpawnPop ? 'attribute float spawnTime;\nattribute vec3 voxelCenter;\nuniform float uCurrentTime;' : ''}
${params.instancing ? 'attribute mat4 instanceMatrix;' : ''}
${params.instancingColor ? 'attribute vec3 instanceColor;\nvarying vec3 vInstanceColor;' : ''}
varying vec3 vViewNormal;
varying vec3 vViewPosition;
${params.fog ? 'varying float vFogDepth;' : ''}
#include <common>

void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  ${params.map || params.alphaMap || params.emissiveMap ? 'vUv = uv;' : ''}
  ${params.vertexColors ? 'vColor = color;' : ''}
  ${params.vertexAo ? 'vAo = ao;' : ''}
  ${params.instancingColor ? 'vInstanceColor = instanceColor;' : ''}
  ${params.fog ? 'vFogDepth = -mvPosition.z;' : ''}
}`;

  const dirStruct =
    dirCount > 0
      ? `struct DirectionalLight { vec3 direction; vec3 color; };
uniform DirectionalLight directionalLights[${dirCount}];`
      : '';

  const hemiStruct =
    hemiCount > 0
      ? `struct HemisphereLight { vec3 direction; vec3 skyColor; vec3 groundColor; };
uniform HemisphereLight hemisphereLights[${hemiCount}];`
      : '';

  const pointStruct =
    pointCount > 0
      ? `struct PointLight { vec3 position; vec3 color; float distance; float decay; };
uniform PointLight pointLights[${pointCount}];`
      : '';

  const fragment = `
precision ${params.precision} float;
precision ${params.precision} int;
${definesGLSL}
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
uniform vec3 ambientLightColor;
uniform float toneMappingExposure;
${dirStruct}
${hemiStruct}
${pointStruct}
${params.map ? 'uniform sampler2D map;\nvarying vec2 vUv;' : ''}
${params.alphaMap ? `uniform sampler2D alphaMap;\n${params.map ? '' : 'varying vec2 vUv;'}` : ''}
${params.emissiveMap ? `uniform sampler2D emissiveMap;\n${params.map || params.alphaMap ? '' : 'varying vec2 vUv;'}` : ''}
${params.vertexColors ? 'varying vec3 vColor;' : ''}
${params.vertexAo ? 'varying float vAo;' : ''}
${params.instancingColor ? 'varying vec3 vInstanceColor;' : ''}
varying vec3 vViewNormal;
varying vec3 vViewPosition;
${params.fog ? `uniform vec3 fogColor;\nvarying float vFogDepth;\n${params.fogExp2 ? 'uniform float fogDensity;' : 'uniform float fogNear;\nuniform float fogFar;'}` : ''}
${params.alphaTest > 0 ? 'uniform float alphaTest;' : ''}
${toneGLSL}
${outGLSL}
#include <common>

void main() {
  vec4 diffuseColor = vec4(diffuse, opacity);
  ${params.map ? 'diffuseColor *= texture2D(map, vUv);' : ''}
  ${params.alphaMap ? 'diffuseColor.a *= texture2D(alphaMap, vUv).g;' : ''}
  ${params.vertexColors ? 'diffuseColor.rgb *= vColor;' : ''}
  ${params.vertexAo ? 'diffuseColor.rgb *= vAo;' : ''}
  ${params.instancingColor ? 'diffuseColor.rgb *= vInstanceColor;' : ''}
  ${params.alphaTest > 0 ? 'if (diffuseColor.a < alphaTest) discard;' : ''}

  vec3 _surfNormal = ${
    params.flatShading
      ? 'normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)))'
      : 'normalize(vViewNormal)'
  };
  ${params.doubleSided ? '_surfNormal *= (float(gl_FrontFacing) * 2.0 - 1.0);' : ''}

  vec3 _irradiance = ambientLightColor;
  ${
    hemiCount > 0
      ? `for (int i = 0; i < ${hemiCount}; i++) {
    float dotNL = dot(_surfNormal, hemisphereLights[i].direction);
    float hemiWeight = 0.5 * dotNL + 0.5;
    _irradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hemiWeight);
  }`
      : ''
  }
  ${
    dirCount > 0
      ? `for (int i = 0; i < ${dirCount}; i++) {
    float dotNL = max(dot(_surfNormal, directionalLights[i].direction), 0.0);
    _irradiance += directionalLights[i].color * dotNL;
  }`
      : ''
  }
  ${
    pointCount > 0
      ? `for (int i = 0; i < ${pointCount}; i++) {
    vec3 lVec = pointLights[i].position + vViewPosition;
    float dist = length(lVec);
    vec3 lDir = lVec / max(dist, 0.0001);
    float dotNL = max(dot(_surfNormal, lDir), 0.0);
    float atten = 1.0;
    if (pointLights[i].distance > 0.0) {
      atten = pow(clamp(1.0 - pow(dist / pointLights[i].distance, 4.0), 0.0, 1.0), 2.0) / (pow(dist, pointLights[i].decay) + 1.0);
    }
    _irradiance += pointLights[i].color * dotNL * atten;
  }`
      : ''
  }

  vec3 _totalEmissive = emissive;
  ${params.emissiveMap ? '_totalEmissive *= texture2D(emissiveMap, vUv).rgb;' : ''}

  vec3 outgoingLight = diffuseColor.rgb * _irradiance + _totalEmissive;
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}`;

  return { vertex, fragment };
}

export function buildBuiltinShaders(params: ProgramParameters): { vertex: string; fragment: string } {
  const templates = buildBuiltinShaderTemplates(params);
  const chunks = buildBuiltinShaderChunks(params);
  return {
    vertex: resolveShaderIncludes(templates.vertex, chunks),
    fragment: resolveShaderIncludes(templates.fragment, chunks),
  };
}

export function buildCustomShaderSources(params: ProgramParameters): { vertex: string; fragment: string } {
  const isGLSL3 = params.glslVersion === GLSL3;
  const versionLine = isGLSL3 ? '#version 300 es\n' : '';
  const definesBlock = generateDefines(params.defines);
  const attrKeyword = isGLSL3 ? 'in' : 'attribute';

  if (params.isRawShaderMaterial) {
    const prefix = `${versionLine}${definesBlock ? `${definesBlock}\n` : ''}`;
    return {
      vertex: `${prefix}${params.vertexShader}`,
      fragment: `${prefix}${params.fragmentShader}`,
    };
  }

  const sharedDefines = [
    params.vertexColors ? '#define USE_COLOR' : '',
    params.vertexAo ? '#define USE_AO' : '',
    params.vertexSpawnPop ? '#define USE_SPAWN_POP' : '',
    params.instancing ? '#define USE_INSTANCING' : '',
    params.instancingColor ? '#define USE_INSTANCING_COLOR' : '',
    params.doubleSided ? '#define DOUBLE_SIDED' : '',
    params.flipSided ? '#define FLIP_SIDED' : '',
    params.flatShading ? '#define FLAT_SHADED' : '',
    params.fog ? '#define USE_FOG' : '',
    params.fog && params.fogExp2 ? '#define FOG_EXP2' : '',
  ].filter(Boolean);

  const vertexPrefix = [
    versionLine.trim(),
    `precision ${params.precision} float;`,
    `precision ${params.precision} int;`,
    '#define SHADER_TYPE ShaderMaterial',
    ...sharedDefines,
    definesBlock,
    'uniform mat4 modelMatrix;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat4 projectionMatrix;',
    'uniform mat4 viewMatrix;',
    'uniform mat3 normalMatrix;',
    'uniform vec3 cameraPosition;',
    params.vertexSpawnPop ? 'uniform float uCurrentTime;' : '',
    params.instancing ? `${attrKeyword} mat4 instanceMatrix;` : '',
    params.instancingColor ? `${attrKeyword} vec3 instanceColor;` : '',
    `${attrKeyword} vec3 position;`,
    `${attrKeyword} vec3 normal;`,
    `${attrKeyword} vec2 uv;`,
    params.vertexColors ? `${attrKeyword} vec3 color;` : '',
    params.vertexAo ? `${attrKeyword} float ao;` : '',
    params.vertexSpawnPop ? `${attrKeyword} float spawnTime;` : '',
    params.vertexSpawnPop ? `${attrKeyword} vec3 voxelCenter;` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const fragmentPrefix = [
    versionLine.trim(),
    `precision ${params.precision} float;`,
    `precision ${params.precision} int;`,
    '#define SHADER_TYPE ShaderMaterial',
    ...sharedDefines,
    definesBlock,
    'uniform mat4 viewMatrix;',
    'uniform vec3 cameraPosition;',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    vertex: `${vertexPrefix}\n${params.vertexShader}`,
    fragment: `${fragmentPrefix}\n${params.fragmentShader}`,
  };
}

export class WebGLProgram {
  readonly id: number;
  readonly name: string;
  readonly cacheKey: string;
  usedTimes = 1;

  program: globalThis.WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;

  private gl: WebGL2RenderingContext;
  private cachedUniforms: WebGLUniforms | null = null;
  private cachedAttributes: Record<string, AttributeLocationInfo> | null = null;

  constructor(renderer: ProgramRendererLike, cacheKey: string, parameters: ProgramParameters) {
    const gl = renderer.getContext();
    this.gl = gl;
    this.id = _programId++;
    this.name = parameters.shaderName;
    this.cacheKey = cacheKey;

    const sources =
      parameters.compiledVertexShader !== undefined && parameters.compiledFragmentShader !== undefined
        ? { vertex: parameters.compiledVertexShader, fragment: parameters.compiledFragmentShader }
        : parameters.shaderID === 'custom'
          ? buildCustomShaderSources(parameters)
          : buildBuiltinShaders(parameters);

    const glVertexShader = createWebGLShader(gl, gl.VERTEX_SHADER, sources.vertex);
    const glFragmentShader = createWebGLShader(gl, gl.FRAGMENT_SHADER, sources.fragment);

    const program = gl.createProgram();
    if (program === null) {
      throw new Error('WebGLProgram: failed to allocate WebGLProgram.');
    }

    gl.attachShader(program, glVertexShader);
    gl.attachShader(program, glFragmentShader);
    gl.linkProgram(program);

    const linkOk = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linkOk) {
      const vsOk = gl.getShaderParameter(glVertexShader, gl.COMPILE_STATUS);
      const fsOk = gl.getShaderParameter(glFragmentShader, gl.COMPILE_STATUS);
      const vsLog = !vsOk ? formatShaderLog(sources.vertex, gl.getShaderInfoLog(glVertexShader) ?? '') : '';
      const fsLog = !fsOk ? formatShaderLog(sources.fragment, gl.getShaderInfoLog(glFragmentShader) ?? '') : '';
      const progLog = gl.getProgramInfoLog(program) ?? '';
      console.error(`WebGLProgram link error (${this.name}): ${progLog}`, { vsLog, fsLog });
    }

    gl.deleteShader(glVertexShader);
    gl.deleteShader(glFragmentShader);

    this.program = program;
    this.vertexShader = glVertexShader;
    this.fragmentShader = glFragmentShader;
  }

  getUniforms(): WebGLUniforms {
    if (this.cachedUniforms === null) {
      this.cachedUniforms = new WebGLUniforms(this.gl, this.program);
    }
    return this.cachedUniforms;
  }

  private cachedAttributeKeys: string[] | null = null;

  getAttributes(): Record<string, AttributeLocationInfo> {
    if (this.cachedAttributes === null) {
      const attrs: Record<string, AttributeLocationInfo> = {};
      const keys: string[] = [];
      const gl = this.gl;
      const count = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES) as number;

      for (let i = 0; i < count; i++) {
        const info = gl.getActiveAttrib(this.program, i);
        if (!info) continue;

        const location = gl.getAttribLocation(this.program, info.name);
        let locationSize = 1;
        if (info.type === gl.FLOAT_MAT2) locationSize = 2;
        else if (info.type === gl.FLOAT_MAT3) locationSize = 3;
        else if (info.type === gl.FLOAT_MAT4) locationSize = 4;

        attrs[info.name] = {
          type: info.type,
          location,
          locationSize,
        };
        keys.push(info.name);
      }

      this.cachedAttributes = attrs;
      this.cachedAttributeKeys = keys;
    }
    return this.cachedAttributes;
  }

  getAttributeKeys(): string[] {
    if (this.cachedAttributeKeys === null) {
      this.getAttributes();
    }
    return this.cachedAttributeKeys!;
  }

  destroy(): void {
    this.gl.deleteProgram(this.program);
    this.cachedUniforms = null;
    this.cachedAttributes = null;
    this.cachedAttributeKeys = null;
  }
}
