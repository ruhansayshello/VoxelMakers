import { Color, Matrix3, Matrix4, Quaternion, Vector2, Vector3, Vector4 } from '../math';
import type { GLSLVersion } from '../core/constants';
import { Material, type MaterialParameters, type TextureLike } from './Material';

export interface IUniform<T = unknown> {
  value: T;
}

export interface ShaderMaterialExtensions {
  clipCullDistance: boolean;
  multiDraw: boolean;
}

export interface ShaderMaterialParameters extends MaterialParameters {
  defines?: Record<string, unknown>;
  uniforms?: Record<string, IUniform>;
  uniformsGroups?: unknown[];
  vertexShader?: string;
  fragmentShader?: string;
  linewidth?: number;
  wireframe?: boolean;
  wireframeLinewidth?: number;
  lights?: boolean;
  clipping?: boolean;
  extensions?: Partial<ShaderMaterialExtensions>;
  glslVersion?: GLSLVersion;
}

const DEFAULT_VERTEX_SHADER = `void main() {
\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const DEFAULT_FRAGMENT_SHADER = `void main() {
\tgl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;

function cloneUniformValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (
    value instanceof Color ||
    value instanceof Vector2 ||
    value instanceof Vector3 ||
    value instanceof Vector4 ||
    value instanceof Matrix3 ||
    value instanceof Matrix4 ||
    value instanceof Quaternion
  ) {
    return value.clone();
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneUniformValue(item));
  }

  if (ArrayBuffer.isView(value)) {
    const Ctor = (value as Float32Array).constructor as new (src: ArrayBufferView) => ArrayBufferView;
    return new Ctor(value);
  }

  if (typeof value === 'object' && typeof (value as { clone?: () => unknown }).clone === 'function') {
    const maybeTexture = value as TextureLike & { clone: () => unknown };
    if (maybeTexture.isTexture) {
      // Textures are shared by reference when cloning ShaderMaterial uniforms (matches Three.js).
      return value;
    }
    return maybeTexture.clone();
  }

  return value;
}

export function cloneUniforms(src: Record<string, IUniform>): Record<string, IUniform> {
  const dst: Record<string, IUniform> = {};
  for (const key of Object.keys(src)) {
    const entry = src[key];
    dst[key] = { value: cloneUniformValue(entry.value) };
  }
  return dst;
}

function serializeUniform(value: unknown): { type?: string; value: unknown } {
  if (value instanceof Color) {
    return { type: 'c', value: value.getHex() };
  }
  if (value instanceof Vector2) {
    return { type: 'v2', value: value.toArray() };
  }
  if (value instanceof Vector3) {
    return { type: 'v3', value: value.toArray() };
  }
  if (value instanceof Vector4) {
    return { type: 'v4', value: value.toArray() };
  }
  if (value instanceof Matrix3) {
    return { type: 'm3', value: Array.from(value.elements) };
  }
  if (value instanceof Matrix4) {
    return { type: 'm4', value: Array.from(value.elements) };
  }
  if (value !== null && typeof value === 'object' && (value as TextureLike).isTexture) {
    return { type: 't', value: (value as TextureLike).uuid };
  }
  if (Array.isArray(value) && value.length > 0) {
    if (value[0] instanceof Vector2) {
      return { type: 'v2v', value: value.map((v: Vector2) => v.toArray()) };
    }
    if (value[0] instanceof Vector3) {
      return { type: 'v3v', value: value.map((v: Vector3) => v.toArray()) };
    }
    if (value[0] instanceof Vector4) {
      return { type: 'v4v', value: value.map((v: Vector4) => v.toArray()) };
    }
    if (value[0] instanceof Color) {
      return { type: 'cv', value: value.map((c: Color) => c.getHex()) };
    }
  }
  return { value };
}

export class ShaderMaterial extends Material {
  readonly isShaderMaterial = true;

  defines: Record<string, unknown> = {};
  uniforms: Record<string, IUniform> = {};
  uniformsGroups: unknown[] = [];

  vertexShader: string = DEFAULT_VERTEX_SHADER;
  fragmentShader: string = DEFAULT_FRAGMENT_SHADER;

  linewidth = 1;
  wireframe = false;
  wireframeLinewidth = 1;

  lights = false;
  clipping = false;

  extensions: ShaderMaterialExtensions = {
    clipCullDistance: false,
    multiDraw: false,
  };

  defaultAttributeValues: Record<string, number[]> = {
    color: [1, 1, 1],
    uv: [0, 0],
    uv1: [0, 0],
  };

  index0AttributeName: string | undefined = undefined;
  uniformsNeedUpdate = false;
  glslVersion: GLSLVersion = null;

  constructor(parameters?: ShaderMaterialParameters) {
    super();
    this.type = 'ShaderMaterial';
    this.fog = false;
    this.forceSinglePass = true;

    if (parameters !== undefined) {
      const { extensions, ...rest } = parameters;
      this.setValues(rest as Record<string, unknown>);
      if (extensions !== undefined) {
        this.extensions = {
          clipCullDistance: Boolean(extensions.clipCullDistance),
          multiDraw: Boolean(extensions.multiDraw),
        };
      }
    }
  }

  override copy(source: this): this {
    super.copy(source);

    this.fragmentShader = source.fragmentShader;
    this.vertexShader = source.vertexShader;

    this.uniforms = cloneUniforms(source.uniforms);
    this.uniformsGroups = source.uniformsGroups.slice();
    this.defines = { ...source.defines };

    this.linewidth = source.linewidth;
    this.wireframe = source.wireframe;
    this.wireframeLinewidth = source.wireframeLinewidth;

    this.fog = source.fog;
    this.lights = source.lights;
    this.clipping = source.clipping;

    this.extensions = {
      clipCullDistance: source.extensions.clipCullDistance,
      multiDraw: source.extensions.multiDraw,
    };

    this.defaultAttributeValues = {};
    for (const key of Object.keys(source.defaultAttributeValues)) {
      this.defaultAttributeValues[key] = source.defaultAttributeValues[key].slice();
    }

    this.index0AttributeName = source.index0AttributeName;
    this.glslVersion = source.glslVersion;

    return this;
  }

  override toJSON(meta?: Record<string, unknown>): Record<string, unknown> {
    const data = super.toJSON(meta);

    data.glslVersion = this.glslVersion;
    data.uniforms = {};
    const outUniforms = data.uniforms as Record<string, unknown>;
    for (const name of Object.keys(this.uniforms)) {
      outUniforms[name] = serializeUniform(this.uniforms[name].value);
    }

    if (Object.keys(this.defines).length > 0) {
      data.defines = { ...this.defines };
    }

    data.vertexShader = this.vertexShader;
    data.fragmentShader = this.fragmentShader;
    data.lights = this.lights;
    data.clipping = this.clipping;

    const activeExtensions: Record<string, boolean> = {};
    if (this.extensions.clipCullDistance) activeExtensions.clipCullDistance = true;
    if (this.extensions.multiDraw) activeExtensions.multiDraw = true;
    if (Object.keys(activeExtensions).length > 0) {
      data.extensions = activeExtensions;
    }

    return data;
  }
}
