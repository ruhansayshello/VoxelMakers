import { BackSide, DoubleSide } from '../../core/constants';
import type { Material } from '../../materials/Material';
import type { LineBasicMaterial } from '../../materials/LineBasicMaterial';
import type { MeshBasicMaterial } from '../../materials/MeshBasicMaterial';
import type { MeshLambertMaterial } from '../../materials/MeshLambertMaterial';
import type { PointsMaterial } from '../../materials/PointsMaterial';
import type { ShaderMaterial } from '../../materials/ShaderMaterial';
import type { Fog } from '../../scenes/Fog';
import type { FogExp2 } from '../../scenes/FogExp2';
import {
  WebGLProgram,
  type ProgramParameters,
  type ProgramRendererLike,
} from './WebGLProgram';

export interface LightsSummary {
  numDirLights: number;
  numHemiLights: number;
  numPointLights: number;
}

export interface RenderObjectLike {
  isInstancedMesh?: boolean;
  instanceColor?: unknown;
}

export interface ProgramRendererContext extends ProgramRendererLike {
  toneMapping: number;
  outputColorSpace: string;
  capabilities?: { logarithmicDepthBuffer?: boolean };
}

export class WebGLPrograms {
  readonly programs: WebGLProgram[] = [];
  private programMap = new Map<string, WebGLProgram>();
  private renderer: ProgramRendererContext;
  private defaultPrecision: 'highp' | 'mediump' | 'lowp';

  constructor(renderer: ProgramRendererContext, defaultPrecision: 'highp' | 'mediump' | 'lowp' = 'highp') {
    this.renderer = renderer;
    this.defaultPrecision = defaultPrecision;
  }

  /**
   * Packs all dynamic draw-call context flags for a given material into a 30-bit positive SMI integer
   * with zero allocations, enabling O(1) per-material program cache hits without calling getParameters()
   * or concatenating GLSL source strings.
   */
  computeMaterialStateHash(
    material: Material,
    lights: LightsSummary,
    fog: Fog | FogExp2 | null,
    object: RenderObjectLike,
    geometry?: { attributes?: Record<string, unknown> } | null,
  ): number {
    const isLambert = (material as MeshLambertMaterial).isMeshLambertMaterial === true;
    const isPoints = (material as PointsMaterial).isPointsMaterial === true;
    const basicLike = material as MeshBasicMaterial;
    const lambertLike = material as MeshLambertMaterial;
    const attrs = geometry?.attributes;

    const instancing = object.isInstancedMesh === true ? 1 : 0;
    const instancingColor = instancing && object.instanceColor != null ? 1 : 0;
    const vertexAo = attrs !== undefined && attrs.ao !== undefined ? 1 : 0;
    const vertexSpawnPop = attrs !== undefined && attrs.spawnTime !== undefined && attrs.voxelCenter !== undefined ? 1 : 0;
    const hasFog = fog !== null && material.fog === true ? 1 : 0;
    const fogExp2 = hasFog && (fog as FogExp2).isFogExp2 === true ? 1 : 0;
    const vertexColors = material.vertexColors === true ? 1 : 0;
    const alphaTestOn = material.alphaTest > 0 ? 1 : 0;
    const hasMap = basicLike.map ? 1 : 0;
    const hasAlphaMap = basicLike.alphaMap ? 1 : 0;
    const hasEmissiveMap = lambertLike.emissiveMap ? 1 : 0;
    const flatShading = lambertLike.flatShading ? 1 : 0;
    const side = material.side & 3;
    const toneMapping = (material.toneMapped ? this.renderer.toneMapping : 0) & 7;
    const srgbOut = this.renderer.outputColorSpace === 'srgb' ? 1 : 0;
    const sizeAttenOff = isPoints && (material as PointsMaterial).sizeAttenuation === false ? 1 : 0;
    const dirLights = isLambert ? (lights.numDirLights > 15 ? 15 : lights.numDirLights) : 0;
    const hemiLights = isLambert ? (lights.numHemiLights > 7 ? 7 : lights.numHemiLights) : 0;
    const pointLights = isLambert ? (lights.numPointLights > 15 ? 15 : lights.numPointLights) : 0;

    return (
      instancing |
      (instancingColor << 1) |
      (vertexAo << 2) |
      (vertexSpawnPop << 3) |
      (hasFog << 4) |
      (fogExp2 << 5) |
      (vertexColors << 6) |
      (alphaTestOn << 7) |
      (hasMap << 8) |
      (hasAlphaMap << 9) |
      (hasEmissiveMap << 10) |
      (flatShading << 11) |
      (side << 12) |
      (toneMapping << 14) |
      (srgbOut << 17) |
      (sizeAttenOff << 18) |
      (dirLights << 19) |
      (hemiLights << 23) |
      (pointLights << 26)
    );
  }

  getParameters(
    material: Material,
    lights: LightsSummary,
    fog: Fog | FogExp2 | null,
    object: RenderObjectLike,
    geometry?: { attributes?: Record<string, unknown> } | null,
  ): ProgramParameters {
    const isLambert = (material as MeshLambertMaterial).isMeshLambertMaterial === true;
    const isLine = (material as LineBasicMaterial).isLineBasicMaterial === true;
    const isPoints = (material as PointsMaterial).isPointsMaterial === true;
    const isShader = (material as ShaderMaterial).isShaderMaterial === true;

    let shaderID: ProgramParameters['shaderID'] = 'basic';
    if (isLambert) shaderID = 'lambert';
    else if (isLine) shaderID = 'line';
    else if (isPoints) shaderID = 'points';
    else if (isShader) shaderID = 'custom';

    const shaderMat = material as ShaderMaterial;
    const basicLike = material as MeshBasicMaterial;
    const lambertLike = material as MeshLambertMaterial;
    const pointsLike = material as PointsMaterial;

    const hasFog = fog !== null && material.fog === true;
    const fogExp2 = hasFog && (fog as FogExp2).isFogExp2 === true;

    return {
      shaderID,
      shaderName: material.type,
      precision: material.precision ?? this.defaultPrecision,
      glslVersion: isShader ? shaderMat.glslVersion : null,
      vertexShader: isShader ? shaderMat.vertexShader : '',
      fragmentShader: isShader ? shaderMat.fragmentShader : '',
      defines: isShader ? { ...shaderMat.defines } : {},
      isRawShaderMaterial: Boolean((material as unknown as { isRawShaderMaterial?: boolean }).isRawShaderMaterial),
      instancing: object.isInstancedMesh === true,
      instancingColor: object.isInstancedMesh === true && object.instanceColor !== null && object.instanceColor !== undefined,
      map: Boolean(basicLike.map),
      alphaMap: Boolean(basicLike.alphaMap),
      emissiveMap: Boolean(lambertLike.emissiveMap),
      vertexColors: material.vertexColors === true,
      vertexAlphas: false,
      vertexAo: Boolean(geometry?.attributes?.ao),
      vertexSpawnPop: Boolean(geometry?.attributes?.spawnTime && geometry?.attributes?.voxelCenter),
      flatShading: Boolean(lambertLike.flatShading),
      doubleSided: material.side === DoubleSide,
      flipSided: material.side === BackSide,
      fog: hasFog,
      fogExp2,
      alphaTest: material.alphaTest,
      toneMapping: material.toneMapped ? this.renderer.toneMapping : 0,
      outputColorSpace: this.renderer.outputColorSpace,
      numDirLights: isLambert ? lights.numDirLights : 0,
      numHemiLights: isLambert ? lights.numHemiLights : 0,
      numPointLights: isLambert ? lights.numPointLights : 0,
      sizeAttenuation: isPoints ? pointsLike.sizeAttenuation : true,
      logarithmicDepthBuffer: Boolean(this.renderer.capabilities?.logarithmicDepthBuffer),
      customProgramCacheKey: material.customProgramCacheKey(),
    };
  }

  getProgramCacheKey(parameters: ProgramParameters): string {
    const parts: Array<string | number | boolean> = [
      parameters.shaderID,
      parameters.precision,
      parameters.glslVersion ?? '',
      parameters.isRawShaderMaterial,
      parameters.instancing,
      parameters.instancingColor,
      parameters.map,
      parameters.alphaMap,
      parameters.emissiveMap,
      parameters.vertexColors,
      Boolean(parameters.vertexAo),
      Boolean(parameters.vertexSpawnPop),
      parameters.flatShading,
      parameters.doubleSided,
      parameters.flipSided,
      parameters.fog,
      parameters.fogExp2,
      parameters.alphaTest > 0,
      parameters.toneMapping,
      parameters.outputColorSpace,
      parameters.numDirLights,
      parameters.numHemiLights,
      parameters.numPointLights,
      parameters.sizeAttenuation,
      Boolean(parameters.logarithmicDepthBuffer),
      parameters.customProgramCacheKey,
    ];

    if (parameters.shaderID === 'custom') {
      parts.push(parameters.vertexShader, parameters.fragmentShader);
      const defKeys = Object.keys(parameters.defines).sort();
      for (let i = 0; i < defKeys.length; i++) {
        const k = defKeys[i];
        parts.push(k, String(parameters.defines[k]));
      }
    }

    return parts.join('|');
  }

  acquireProgram(parameters: ProgramParameters, cacheKey: string): WebGLProgram {
    const existing = this.programMap.get(cacheKey);
    if (existing !== undefined) {
      existing.usedTimes++;
      return existing;
    }

    const program = new WebGLProgram(this.renderer, cacheKey, parameters);
    this.programs.push(program);
    this.programMap.set(cacheKey, program);
    return program;
  }

  releaseProgram(program: WebGLProgram): void {
    if (--program.usedTimes === 0) {
      const idx = this.programs.indexOf(program);
      if (idx !== -1) {
        this.programs[idx] = this.programs[this.programs.length - 1];
        this.programs.pop();
      }
      this.programMap.delete(program.cacheKey);
      program.destroy();
    }
  }

  dispose(): void {
    for (let i = 0; i < this.programs.length; i++) {
      this.programs[i].destroy();
    }
    this.programs.length = 0;
    this.programMap.clear();
  }
}
