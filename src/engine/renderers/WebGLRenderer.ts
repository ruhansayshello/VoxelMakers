import {
  Color,
  Frustum,
  Matrix3,
  Matrix4,
  Sphere,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  WebGLCoordinateSystem,
  type ColorRepresentation,
  type CoordinateSystem,
} from '../math';
import { DEG2RAD } from '../math/MathUtils';
import { BufferAttribute } from '../core/BufferAttribute';
import { BufferGeometry, type GeometryGroup } from '../core/BufferGeometry';
import { DynamicDrawUsage } from '../core/constants';
import { Object3D } from '../core/Object3D';
import { Material } from '../materials/Material';
import type { LineBasicMaterial } from '../materials/LineBasicMaterial';
import type { MeshBasicMaterial } from '../materials/MeshBasicMaterial';
import type { MeshLambertMaterial } from '../materials/MeshLambertMaterial';
import type { PointsMaterial } from '../materials/PointsMaterial';
import type { ShaderMaterial } from '../materials/ShaderMaterial';
import type { Fog } from '../scenes/Fog';
import type { FogExp2 } from '../scenes/FogExp2';
import type { Scene } from '../scenes/Scene';
import { NoToneMapping, PCFShadowMap } from './webgl/constants';
import { perfProfiler } from '../perf/PerfProfiler';
import { WebGLAttributes } from './webgl/WebGLAttributes';
import { WebGLBackground } from './webgl/WebGLBackground';
import { WebGLBindingStates, type InstancedMeshLike } from './webgl/WebGLBindingStates';
import {
  WebGLBufferRenderer,
  WebGLIndexedBufferRenderer,
  type MultiDrawExtension,
} from './webgl/WebGLBufferRenderer';
import {
  buildBuiltinShaderChunks,
  buildBuiltinShaderTemplates,
  buildCustomShaderSources,
  resolveShaderIncludes,
  type OnBeforeCompileShader,
  type WebGLProgram,
} from './webgl/WebGLProgram';
import { WebGLPrograms } from './webgl/WebGLPrograms';
import { WebGLProperties } from './webgl/WebGLProperties';
import { WebGLRenderLists, type RenderItem } from './webgl/WebGLRenderLists';
import { WebGLRenderStates, type LightLike } from './webgl/WebGLRenderStates';
import { WebGLState } from './webgl/WebGLState';
import {
  WebGLTextures,
  type RenderTargetLike,
  type RenderTextureLike,
} from './webgl/WebGLTextures';
import { WebGLUniforms, type UniformNode } from './webgl/WebGLUniforms';

export interface WebGLRendererParameters {
  canvas?: HTMLCanvasElement;
  context?: WebGL2RenderingContext;
  precision?: 'highp' | 'mediump' | 'lowp';
  alpha?: boolean;
  premultipliedAlpha?: boolean;
  antialias?: boolean;
  stencil?: boolean;
  preserveDrawingBuffer?: boolean;
  powerPreference?: WebGLPowerPreference;
  failIfMajorPerformanceCaveat?: boolean;
  depth?: boolean;
  logarithmicDepthBuffer?: boolean;
}

export interface BigSectorPositionLike {
  sectorX: bigint;
  sectorZ: bigint;
  localX: number;
  localY: number;
  localZ: number;
}

export interface RenderCameraLike extends Object3D {
  isCamera?: boolean;
  isPerspectiveCamera?: boolean;
  isOrthographicCamera?: boolean;
  matrixWorldInverse: Matrix4;
  projectionMatrix: Matrix4;
  projectionMatrixInverse?: Matrix4;
  coordinateSystem?: CoordinateSystem;
  reversedDepth?: boolean;
  fov?: number;
  aspect?: number;
  zoom?: number;
  near?: number;
  far?: number;
}

export interface RenderableObjectLike extends Object3D, InstancedMeshLike {
  isMesh?: boolean;
  isLine?: boolean;
  isLineSegments?: boolean;
  isLineLoop?: boolean;
  isPoints?: boolean;
  geometry?: BufferGeometry;
  material?: Material | Material[];
  count?: number;
}

export interface WebGLCapabilities {
  isWebGL2: boolean;
  logarithmicDepthBuffer: boolean;
  precision: 'highp' | 'mediump' | 'lowp';
  maxTextures: number;
  maxVertexTextures: number;
  maxTextureSize: number;
  maxCubemapSize: number;
  maxAttributes: number;
  maxVertexAttribs: number;
  maxVertexUniforms: number;
  maxVaryings: number;
  maxVaryingVectors: number;
  maxFragmentUniforms: number;
  maxSamples: number;
  getMaxAnisotropy(): number;
}

export interface WebGLExtensions {
  has(name: string): boolean;
  get<T = unknown>(name: string): T | null;
}

export interface WebGLInfo {
  memory: {
    geometries: number;
    textures: number;
  };
  render: {
    frame: number;
    calls: number;
    triangles: number;
    lines: number;
    points: number;
  };
  programs: WebGLProgram[];
  autoReset: boolean;
  reset(): void;
}

interface MaterialRuntimeProps {
  program?: WebGLProgram;
  programs?: Map<string, WebGLProgram>;
  programsByHash?: Map<number, { program: WebGLProgram; customUniformSeq?: UniformNode[] }>;
  lastHash?: number;
  lastProgram?: WebGLProgram;
  lastCustomUniformSeq?: UniformNode[];
  lastVertexShader?: string;
  lastFragmentShader?: string;
  lastCustomKey?: string;
  version?: number;
  lightsStateVersion?: number;
  fog?: Fog | FogExp2 | null;
  instancing?: boolean;
  outputColorSpace?: string;
  toneMapping?: number;
  disposeAttached?: boolean;
  customUniforms?: Record<string, { value: unknown }>;
  customUniformSeq?: UniformNode[];
  customUniformSeqs?: Map<string, UniformNode[]>;
}

const EMPTY_LIGHTS_SUMMARY = { numDirLights: 0, numHemiLights: 0, numPointLights: 0 };

const _projScreenMatrix = new Matrix4();
const _frustum = new Frustum();
const _vector3 = new Vector3();
const _sphere = new Sphere();
const _modelViewMatrix = new Matrix4();
const _normalMatrix = new Matrix3();
const _cameraWorldPos = new Vector3();
const _emissiveColor = new Color();
const _bandProjMatrix = new Matrix4();
const _savedProjMatrix = new Matrix4();
const BIG_SECTOR_SIZE_METERS = 1024n;
const SCALE_BAND_NEAR = 0.25;
const SCALE_BAND_FAR = 65536;

interface ScaleBandBucket {
  opaque: RenderItem[];
  water: RenderItem[];
}

function createCanvasElement(): HTMLCanvasElement {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 150;
    return canvas;
  }
  return {
    width: 300,
    height: 150,
    style: { width: '', height: '' },
    getContext: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

export class WebGLRenderer {
  readonly domElement: HTMLCanvasElement;
  readonly context: WebGL2RenderingContext;
  readonly capabilities: WebGLCapabilities;
  readonly extensions: WebGLExtensions;
  readonly properties: WebGLProperties;
  readonly state: WebGLState;
  readonly info: WebGLInfo;

  readonly shadowMap = {
    enabled: false,
    autoUpdate: true,
    needsUpdate: false,
    type: PCFShadowMap,
  };

  readonly vr = {
    enabled: false,
  };

  readonly xr = {
    enabled: false,
    isPresenting: false,
  };

  localClippingEnabled = false;
  physicallyCorrectLights = false;
  useLegacyLights = true;
  toneMapping: number = NoToneMapping;
  toneMappingExposure = 1.0;
  outputColorSpace: string = SRGBColorSpace;

  autoClear = true;
  autoClearColor = true;
  autoClearDepth = true;
  autoClearStencil = true;
  sortObjects = true;

  pixelRatio = 1;
  size = { width: 300, height: 150 };
  drawingBufferSize = { width: 300, height: 150 };
  viewport = new Vector4(0, 0, 300, 150);
  scissor = new Vector4(0, 0, 300, 150);
  scissorTest = false;

  private _gl: WebGL2RenderingContext;
  private _width: number;
  private _height: number;
  private _pixelRatio = 1;
  private _viewport = new Vector4(0, 0, 300, 150);
  private _scissor = new Vector4(0, 0, 300, 150);
  private _scissorTest = false;
  private _currentRenderTarget: RenderTargetLike | null = null;
  private _isContextLost = false;
  public currentTime = 0;
  /** Optional planetary curvature radius in meters (0 = flat world, e.g. 1_600_000 = curved horizon) */
  public planetCurvatureRadius = 0;
  /** Optional BigInt macro-sector + local Float64 camera coordinates for exact 10^31 km RTE rendering */
  public cameraBigSector: BigSectorPositionLike | null = null;
  private _trackedGeometries = new WeakSet<BufferGeometry>();
  private _trackedInstancedMeshes = new WeakSet<RenderableObjectLike>();
  private _wireframeIndexCache = new WeakMap<
    BufferGeometry,
    { version: number; indexCount: number; attribute: BufferAttribute }
  >();

  // Fix 3: Reusable terrain chunk batching buffers (merges visible opaque terrain chunks into 1 draw call)
  private _terrainChunks: RenderableObjectLike[] = [];
  private _batchEligibleChunks: RenderableObjectLike[] = [];
  private _batchFallbackChunks: RenderableObjectLike[] = [];

  // Scale-Space Multi-Pass rendering scratchpads (zero per-frame allocations)
  private _scaleBandBuckets = new Map<number, ScaleBandBucket>();
  private _activeScaleBandKeys: number[] = [];
  private _skyDomeItems: RenderItem[] = [];
  private _activeScaleBand = 0;
  private _activeBandScaleBig = 1n;

  private _attributes: WebGLAttributes;
  private _bindingStates: WebGLBindingStates;
  private _programs: WebGLPrograms;
  private _renderLists: WebGLRenderLists;
  private _renderStates: WebGLRenderStates;
  private _textures: WebGLTextures;
  private _background: WebGLBackground;
  private _bufferRenderer: WebGLBufferRenderer;
  private _indexedBufferRenderer: WebGLIndexedBufferRenderer;

  private _extCache: Record<string, unknown> = {};
  private _animationLoopCallback: ((time: number, frame?: unknown) => void) | null = null;
  private _rafId: number | null = null;

  constructor(parameters: WebGLRendererParameters = {}) {
    const canvas = parameters.canvas ?? createCanvasElement();
    this.domElement = canvas;

    const contextAttributes: WebGLContextAttributes = {
      alpha: parameters.alpha ?? false,
      depth: parameters.depth ?? true,
      stencil: parameters.stencil ?? true,
      antialias: parameters.antialias ?? false,
      premultipliedAlpha: parameters.premultipliedAlpha ?? true,
      preserveDrawingBuffer: parameters.preserveDrawingBuffer ?? false,
      powerPreference: parameters.powerPreference ?? 'default',
      failIfMajorPerformanceCaveat: parameters.failIfMajorPerformanceCaveat ?? false,
    };

    const gl =
      parameters.context ??
      (canvas.getContext('webgl2', contextAttributes) as WebGL2RenderingContext | null);

    if (gl === null) {
      throw new Error('WebGLRenderer: WebGL2 context could not be created.');
    }

    this._gl = gl;
    this.context = gl;

    const self = this;
    this.extensions = {
      has(name: string): boolean {
        return self.extensions.get(name) !== null;
      },
      get<T = unknown>(name: string): T | null {
        if (name in self._extCache) {
          return self._extCache[name] as T | null;
        }
        const ext = typeof gl.getExtension === 'function' ? gl.getExtension(name) : null;
        self._extCache[name] = ext;
        return ext as T | null;
      },
    };

    const getParam = (pname: number, fallback: number): number => {
      if (typeof gl.getParameter !== 'function') return fallback;
      const val = gl.getParameter(pname);
      return typeof val === 'number' && !Number.isNaN(val) ? val : fallback;
    };

    const maxTextures = getParam(gl.MAX_TEXTURE_IMAGE_UNITS, 16);
    const maxVertexAttribs = getParam(gl.MAX_VERTEX_ATTRIBS, 16);
    const maxVaryingVectors = getParam(gl.MAX_VARYING_VECTORS, 15);
    const precision = parameters.precision ?? 'highp';

    this.capabilities = {
      isWebGL2: true,
      logarithmicDepthBuffer: Boolean(parameters.logarithmicDepthBuffer),
      precision,
      maxTextures,
      maxVertexTextures: getParam(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS, 16),
      maxTextureSize: getParam(gl.MAX_TEXTURE_SIZE, 4096),
      maxCubemapSize: getParam(gl.MAX_CUBE_MAP_TEXTURE_SIZE, 4096),
      maxAttributes: maxVertexAttribs,
      maxVertexAttribs,
      maxVertexUniforms: getParam(gl.MAX_VERTEX_UNIFORM_VECTORS, 256),
      maxVaryings: maxVaryingVectors,
      maxVaryingVectors,
      maxFragmentUniforms: getParam(gl.MAX_FRAGMENT_UNIFORM_VECTORS, 256),
      maxSamples: getParam(gl.MAX_SAMPLES, 4),
      getMaxAnisotropy: () => {
        const ext = this.extensions.get<{ MAX_TEXTURE_MAX_ANISOTROPY_EXT: number }>(
          'EXT_texture_filter_anisotropic',
        );
        if (ext && typeof gl.getParameter === 'function') {
          return (gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) || 1;
        }
        return 1;
      },
    };

    this.properties = new WebGLProperties();
    this.state = new WebGLState(gl);
    this._programs = new WebGLPrograms(this, precision);

    const infoRender = { frame: 0, calls: 0, triangles: 0, lines: 0, points: 0 };
    const infoMemory = { geometries: 0, textures: 0 };

    this.info = {
      memory: infoMemory,
      render: infoRender,
      programs: this._programs.programs,
      autoReset: true,
      reset() {
        infoRender.calls = 0;
        infoRender.triangles = 0;
        infoRender.lines = 0;
        infoRender.points = 0;
      },
    };

    const multiDrawExt = this.extensions.get<MultiDrawExtension>('WEBGL_multi_draw');
    this._attributes = new WebGLAttributes(gl);
    this._bindingStates = new WebGLBindingStates(gl, this._attributes);
    this._renderLists = new WebGLRenderLists();
    this._renderStates = new WebGLRenderStates();
    this._textures = new WebGLTextures(gl, this.state, this.properties, infoMemory, maxTextures);
    this._background = new WebGLBackground(this.state, contextAttributes.premultipliedAlpha !== false);
    this._bufferRenderer = new WebGLBufferRenderer(gl, infoRender, multiDrawExt);
    this._indexedBufferRenderer = new WebGLIndexedBufferRenderer(gl, infoRender, multiDrawExt);

    this._width = canvas.width || 300;
    this._height = canvas.height || 150;
    this.size.width = this._width;
    this.size.height = this._height;
    this.drawingBufferSize.width = this._width;
    this.drawingBufferSize.height = this._height;
    this._viewport.set(0, 0, this._width, this._height);
    this._scissor.set(0, 0, this._width, this._height);
    this.viewport.copy(this._viewport);
    this.scissor.copy(this._scissor);

    this.state.setViewport(0, 0, this._width, this._height);
    this.state.setClearColor(0, 0, 0, contextAttributes.alpha ? 0 : 1);
    if (!contextAttributes.alpha) {
      this._background.setClearColor(0x000000, 1);
    }
  }

  getContext(): WebGL2RenderingContext {
    return this._gl;
  }

  getContextAttributes(): WebGLContextAttributes | null {
    return typeof this._gl.getContextAttributes === 'function'
      ? this._gl.getContextAttributes()
      : null;
  }

  forceContextLoss(): void {
    const ext = this.extensions.get<WEBGL_lose_context>('WEBGL_lose_context');
    if (ext) ext.loseContext();
    this._isContextLost = true;
  }

  forceContextRestore(): void {
    const ext = this.extensions.get<WEBGL_lose_context>('WEBGL_lose_context');
    if (ext) ext.restoreContext();
    this._isContextLost = false;
  }

  getPixelRatio(): number {
    return this._pixelRatio;
  }

  setPixelRatio(value: number): void {
    if (value === undefined) return;
    this._pixelRatio = value;
    this.pixelRatio = value;
    this.setSize(this._width, this._height, false);
  }

  getSize(target: Vector2): Vector2 {
    return target.set(this._width, this._height);
  }

  setSize(width: number, height: number, updateStyle = true): void {
    this._width = width;
    this._height = height;
    this.size.width = width;
    this.size.height = height;

    const bufferW = Math.floor(width * this._pixelRatio);
    const bufferH = Math.floor(height * this._pixelRatio);
    this.domElement.width = bufferW;
    this.domElement.height = bufferH;
    this.drawingBufferSize.width = bufferW;
    this.drawingBufferSize.height = bufferH;

    if (updateStyle && this.domElement.style) {
      this.domElement.style.width = `${width}px`;
      this.domElement.style.height = `${height}px`;
    }

    this.setViewport(0, 0, width, height);
  }

  getDrawingBufferSize(target: Vector2): Vector2 {
    return target.set(this._width * this._pixelRatio, this._height * this._pixelRatio).floor();
  }

  setDrawingBufferSize(width: number, height: number, pixelRatio: number): void {
    this._width = width;
    this._height = height;
    this._pixelRatio = pixelRatio;
    this.pixelRatio = pixelRatio;
    this.size.width = width;
    this.size.height = height;

    const bufferW = Math.floor(width * pixelRatio);
    const bufferH = Math.floor(height * pixelRatio);
    this.domElement.width = bufferW;
    this.domElement.height = bufferH;
    this.drawingBufferSize.width = bufferW;
    this.drawingBufferSize.height = bufferH;

    this.setViewport(0, 0, width, height);
  }

  getCurrentViewport(target: Vector4): Vector4 {
    return target.copy(this.state.currentViewport);
  }

  getViewport(target: Vector4): Vector4 {
    return target.copy(this._viewport);
  }

  setViewport(x: number | Vector4, y?: number, width?: number, height?: number): void {
    if (x instanceof Vector4) {
      this._viewport.set(x.x, x.y, x.z, x.w);
    } else {
      this._viewport.set(x, y ?? 0, width ?? this._width, height ?? this._height);
    }
    this.viewport.copy(this._viewport);

    if (this._currentRenderTarget === null) {
      const pr = this._pixelRatio;
      this.state.setViewport(
        Math.floor(this._viewport.x * pr),
        Math.floor(this._viewport.y * pr),
        Math.floor(this._viewport.z * pr),
        Math.floor(this._viewport.w * pr),
      );
    } else {
      this.state.setViewport(
        Math.floor(this._viewport.x),
        Math.floor(this._viewport.y),
        Math.floor(this._viewport.z),
        Math.floor(this._viewport.w),
      );
    }
  }

  getScissor(target: Vector4): Vector4 {
    return target.copy(this._scissor);
  }

  setScissor(x: number | Vector4, y?: number, width?: number, height?: number): void {
    if (x instanceof Vector4) {
      this._scissor.set(x.x, x.y, x.z, x.w);
    } else {
      this._scissor.set(x, y ?? 0, width ?? this._width, height ?? this._height);
    }
    this.scissor.copy(this._scissor);

    if (this._currentRenderTarget === null) {
      const pr = this._pixelRatio;
      this.state.setScissor(
        Math.floor(this._scissor.x * pr),
        Math.floor(this._scissor.y * pr),
        Math.floor(this._scissor.z * pr),
        Math.floor(this._scissor.w * pr),
      );
    } else {
      this.state.setScissor(
        Math.floor(this._scissor.x),
        Math.floor(this._scissor.y),
        Math.floor(this._scissor.z),
        Math.floor(this._scissor.w),
      );
    }
  }

  getScissorTest(): boolean {
    return this._scissorTest;
  }

  setScissorTest(enable: boolean): void {
    this._scissorTest = enable;
    this.scissorTest = enable;
    this.state.setScissorTest(enable);
  }

  getClearColor(target?: Color): Color {
    return this._background.getClearColor(target);
  }

  setClearColor(color: ColorRepresentation, alpha = 1): void {
    this._background.setClearColor(color, alpha);
  }

  getClearAlpha(): number {
    return this._background.getClearAlpha();
  }

  setClearAlpha(alpha: number): void {
    this._background.setClearAlpha(alpha);
  }

  clear(color = true, depth = true, stencil = true): void {
    const gl = this._gl;
    let bits = 0;

    if (color) {
      this.state.setColorMask(true);
      bits |= gl.COLOR_BUFFER_BIT;
    }
    if (depth) {
      this.state.setDepthWrite(true);
      bits |= gl.DEPTH_BUFFER_BIT;
    }
    if (stencil) {
      bits |= gl.STENCIL_BUFFER_BIT;
    }

    if (bits !== 0) {
      gl.clear(bits);
    }
  }

  clearColor(): void {
    this.clear(true, false, false);
  }

  clearDepth(): void {
    this.clear(false, true, false);
  }

  clearStencil(): void {
    this.clear(false, false, true);
  }

  clearTarget(renderTarget: RenderTargetLike | null, color = true, depth = true, stencil = true): void {
    const prev = this._currentRenderTarget;
    this.setRenderTarget(renderTarget);
    this.clear(color, depth, stencil);
    this.setRenderTarget(prev);
  }

  resetGLState(): void {
    this.state.reset();
    this._bindingStates.reset();
  }

  resetState(): void {
    this.resetGLState();
  }

  getRenderTarget(): RenderTargetLike | null {
    return this._currentRenderTarget;
  }

  setRenderTarget(
    renderTarget: RenderTargetLike | null,
    _activeCubeFace?: number,
    _activeMipmapLevel?: number,
  ): void {
    const gl = this._gl;
    this._currentRenderTarget = renderTarget;

    if (renderTarget !== null) {
      const fb = this._textures.setupRenderTarget(renderTarget);
      this.state.bindFramebuffer(gl.FRAMEBUFFER, fb);

      if (renderTarget.viewport) {
        this.state.setViewport(
          renderTarget.viewport.x,
          renderTarget.viewport.y,
          renderTarget.viewport.z,
          renderTarget.viewport.w,
        );
      } else {
        this.state.setViewport(0, 0, renderTarget.width, renderTarget.height);
      }

      if (renderTarget.scissor) {
        this.state.setScissor(
          renderTarget.scissor.x,
          renderTarget.scissor.y,
          renderTarget.scissor.z,
          renderTarget.scissor.w,
        );
      }
      if (renderTarget.scissorTest !== undefined) {
        this.state.setScissorTest(renderTarget.scissorTest);
      }
    } else {
      this.state.bindFramebuffer(gl.FRAMEBUFFER, null);
      const pr = this._pixelRatio;
      this.state.setViewport(
        Math.floor(this._viewport.x * pr),
        Math.floor(this._viewport.y * pr),
        Math.floor(this._viewport.z * pr),
        Math.floor(this._viewport.w * pr),
      );
      this.state.setScissor(
        Math.floor(this._scissor.x * pr),
        Math.floor(this._scissor.y * pr),
        Math.floor(this._scissor.z * pr),
        Math.floor(this._scissor.w * pr),
      );
      this.state.setScissorTest(this._scissorTest);
    }
  }

  readRenderTargetPixels(
    renderTarget: RenderTargetLike,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: ArrayBufferView,
    _activeCubeFaceIndex = 0,
  ): void {
    const gl = this._gl;
    const fb = this._textures.getRenderTargetFramebuffer(renderTarget);
    if (!fb) return;

    const prevRT = this._currentRenderTarget;
    this.state.bindFramebuffer(gl.FRAMEBUFFER, fb);

    const type = buffer instanceof Float32Array ? gl.FLOAT : gl.UNSIGNED_BYTE;
    gl.readPixels(x, y, width, height, gl.RGBA, type, buffer);

    if (prevRT !== null) {
      this.state.bindFramebuffer(gl.FRAMEBUFFER, this._textures.getRenderTargetFramebuffer(prevRT));
    } else {
      this.state.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /**
   * Voxel-specific WebGL2 optimization: fast hardware copy from an off-screen
   * render target directly to the default screen framebuffer via gl.blitFramebuffer,
   * avoiding a full-screen quad draw call when no final shader pass is needed.
   */
  blitToScreen(renderTarget: RenderTargetLike): boolean {
    const gl = this._gl;
    if (typeof gl.blitFramebuffer !== 'function') return false;

    const fb = this._textures.getRenderTargetFramebuffer(renderTarget);
    if (!fb) return false;

    const dstW = this.drawingBufferSize.width;
    const dstH = this.drawingBufferSize.height;

    this.state.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    this.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      renderTarget.width,
      renderTarget.height,
      0,
      0,
      dstW,
      dstH,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );

    this.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    this.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    this.state.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._currentRenderTarget = null;
    return true;
  }

  copyFramebufferToTexture(position: Vector2, texture: RenderTextureLike, level = 0): void {
    const gl = this._gl;
    this._textures.setTexture2D(texture, 0);
    const w = texture.width ?? (texture.image as { width?: number } | null)?.width ?? this.drawingBufferSize.width;
    const h = texture.height ?? (texture.image as { height?: number } | null)?.height ?? this.drawingBufferSize.height;
    gl.copyTexSubImage2D(gl.TEXTURE_2D, level, 0, 0, position.x, position.y, w, h);
  }

  copyTextureToTexture(
    position: Vector2,
    srcTexture: RenderTextureLike,
    dstTexture: RenderTextureLike,
    level = 0,
  ): void {
    const gl = this._gl;
    const width = srcTexture.width ?? (srcTexture.image as { width?: number } | null)?.width ?? 1;
    const height = srcTexture.height ?? (srcTexture.image as { height?: number } | null)?.height ?? 1;

    this._textures.setTexture2D(dstTexture, 0);
    const img = srcTexture.image;
    if (srcTexture.isDataTexture || (img && typeof img === 'object' && 'data' in img)) {
      const dataImg = img as { data?: ArrayBufferView | null };
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        level,
        position.x,
        position.y,
        width,
        height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        dataImg.data ?? null,
      );
    } else if (img) {
      gl.texSubImage2D(gl.TEXTURE_2D, level, position.x, position.y, gl.RGBA, gl.UNSIGNED_BYTE, img as TexImageSource);
    }
  }

  setAnimationLoop(callback: ((time: number, frame?: unknown) => void) | null): void {
    if (this._rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._animationLoopCallback = callback;
    if (callback !== null && typeof requestAnimationFrame === 'function') {
      const step = (time: number) => {
        if (this._animationLoopCallback === null) return;
        this._animationLoopCallback(time);
        this._rafId = requestAnimationFrame(step);
      };
      this._rafId = requestAnimationFrame(step);
    }
  }

  private trackGeometry(geometry: BufferGeometry): void {
    if (!this._trackedGeometries.has(geometry)) {
      this._trackedGeometries.add(geometry);
      this.info.memory.geometries++;
      geometry.addEventListener('dispose', () => {
        this._bindingStates.releaseStatesOfGeometry(geometry);
        if (geometry.index !== null) {
          this._attributes.remove(geometry.index);
        }
        const cachedWire = this._wireframeIndexCache.get(geometry);
        if (cachedWire) {
          this._attributes.remove(cachedWire.attribute);
          this._wireframeIndexCache.delete(geometry);
        }
        const customWire = geometry.userData?.wireframeIndex as BufferAttribute | undefined;
        if (customWire) {
          this._attributes.remove(customWire);
        }
        for (const key of Object.keys(geometry.attributes)) {
          this._attributes.remove(geometry.attributes[key]);
        }
        this.info.memory.geometries = Math.max(0, this.info.memory.geometries - 1);
      });
    }
  }

  private trackInstancedMesh(object: RenderableObjectLike): void {
    if (!this._trackedInstancedMeshes.has(object)) {
      this._trackedInstancedMeshes.add(object);
      object.addEventListener('dispose', () => {
        this._bindingStates.releaseStatesOfObject(object.id);
        if (object.instanceMatrix) {
          this._attributes.remove(object.instanceMatrix);
        }
        if (object.instanceColor) {
          this._attributes.remove(object.instanceColor);
        }
      });
    }
  }

  private getWireframeIndexAttribute(geometry: BufferGeometry): BufferAttribute | null {
    const customWire = geometry.userData?.wireframeIndex;
    if (customWire && typeof customWire === 'object' && 'array' in customWire) {
      return customWire as BufferAttribute;
    }

    const index = geometry.index;
    const position = geometry.attributes.position;
    if (!position) return null;

    const srcVersion = index ? index.version : position.version;
    const srcCount = index ? index.count : position.count;
    const cached = this._wireframeIndexCache.get(geometry);
    if (cached && cached.version === srcVersion && cached.indexCount === srcCount) {
      return cached.attribute;
    }
    if (cached) {
      this._attributes.remove(cached.attribute);
    }

    const indices: number[] = [];
    if (index !== null) {
      const arr = index.array;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const a = arr[i];
        const b = arr[i + 1];
        const c = arr[i + 2];
        indices.push(a, b, b, c, c, a);
      }
    } else {
      for (let i = 0; i + 2 < position.count; i += 3) {
        const a = i;
        const b = i + 1;
        const c = i + 2;
        indices.push(a, b, b, c, c, a);
      }
    }

    const useUint32 = position.count > 65535;
    const wireArray = useUint32 ? new Uint32Array(indices) : new Uint16Array(indices);
    const wireAttr = new BufferAttribute(wireArray, 1);
    this._wireframeIndexCache.set(geometry, {
      version: srcVersion,
      indexCount: srcCount,
      attribute: wireAttr,
    });
    return wireAttr;
  }

  private getProgram(
    material: Material,
    scene: Scene | null,
    object: RenderableObjectLike,
    geometry?: BufferGeometry | null,
  ): WebGLProgram {
    const renderState = scene ? this._renderStates.get(scene) : null;
    const lightsSummary = renderState ? renderState.lightsState : EMPTY_LIGHTS_SUMMARY;
    const fog = scene ? scene.fog : null;

    const props = this.properties.get<MaterialRuntimeProps>(material);
    const isShaderMat = (material as ShaderMaterial).isShaderMaterial === true;
    const shaderMat = isShaderMat ? (material as ShaderMaterial) : null;
    const hasCustomCacheKey =
      material.customProgramCacheKey !== Material.prototype.customProgramCacheKey;
    const customKey = hasCustomCacheKey ? material.customProgramCacheKey() : '';

    // Invalidate all cached programs for this material when material.version increments
    if (props.version !== material.version) {
      if (props.programs) {
        for (const oldProg of props.programs.values()) {
          this._bindingStates.releaseStatesOfProgram(oldProg);
          this._programs.releaseProgram(oldProg);
        }
        props.programs.clear();
      }
      props.programsByHash?.clear();
      props.customUniformSeqs?.clear();
      props.program = undefined;
      props.lastProgram = undefined;
      props.lastHash = undefined;
      props.lastCustomUniformSeq = undefined;
      props.lastVertexShader = undefined;
      props.lastFragmentShader = undefined;
      props.lastCustomKey = undefined;
    }

    // Zero-allocation fast path: check 30-bit numeric state hash + shader string ref equality
    const stateHash = this._programs.computeMaterialStateHash(
      material,
      lightsSummary,
      fog,
      object,
      geometry,
    );

    const shadersUnchanged =
      !isShaderMat ||
      (props.lastVertexShader === shaderMat!.vertexShader &&
        props.lastFragmentShader === shaderMat!.fragmentShader);
    const customKeyUnchanged = !hasCustomCacheKey || props.lastCustomKey === customKey;

    if (
      props.lastProgram !== undefined &&
      props.lastHash === stateHash &&
      shadersUnchanged &&
      customKeyUnchanged
    ) {
      props.program = props.lastProgram;
      props.customUniformSeq = props.lastCustomUniformSeq;
      return props.lastProgram;
    }

    if (props.programsByHash !== undefined && shadersUnchanged && customKeyUnchanged) {
      const hit = props.programsByHash.get(stateHash);
      if (hit !== undefined) {
        props.program = hit.program;
        props.customUniformSeq = hit.customUniformSeq;
        props.lastHash = stateHash;
        props.lastProgram = hit.program;
        props.lastCustomUniformSeq = hit.customUniformSeq;
        return hit.program;
      }
    }

    // Cache miss: build full ProgramParameters and cacheKey (first draw or after material mutation)
    const params = this._programs.getParameters(material, lightsSummary, fog, object, geometry);
    const cacheKey = this._programs.getProgramCacheKey(params);

    let program = props.programs?.get(cacheKey);
    let customSeq: UniformNode[] | undefined;

    if (program === undefined) {
      const hasOnBeforeCompile =
        typeof material.onBeforeCompile === 'function' &&
        material.onBeforeCompile !== Material.prototype.onBeforeCompile;

      if (hasOnBeforeCompile) {
        const isShader = params.shaderID === 'custom';
        const template = isShader
          ? { vertex: params.vertexShader, fragment: params.fragmentShader }
          : buildBuiltinShaderTemplates(params);
        const shaderObject: OnBeforeCompileShader = {
          name: params.shaderName,
          uniforms: isShader ? (material as ShaderMaterial).uniforms : {},
          vertexShader: template.vertex,
          fragmentShader: template.fragment,
        };

        material.onBeforeCompile(shaderObject, this);

        if (isShader) {
          params.vertexShader = shaderObject.vertexShader;
          params.fragmentShader = shaderObject.fragmentShader;
          const built = buildCustomShaderSources(params);
          params.compiledVertexShader = built.vertex;
          params.compiledFragmentShader = built.fragment;
        } else {
          const chunks = buildBuiltinShaderChunks(params);
          params.compiledVertexShader = resolveShaderIncludes(shaderObject.vertexShader, chunks);
          params.compiledFragmentShader = resolveShaderIncludes(shaderObject.fragmentShader, chunks);
        }

        props.customUniforms = shaderObject.uniforms;
      } else {
        props.customUniforms = undefined;
        props.customUniformSeq = undefined;
      }

      program = this._programs.acquireProgram(params, cacheKey);
      if (!props.programs) props.programs = new Map();
      props.programs.set(cacheKey, program);
      props.program = program;
      props.version = material.version;

      if (props.customUniforms !== undefined) {
        customSeq = WebGLUniforms.seqWithValue(
          program.getUniforms().seq,
          props.customUniforms,
        );
        props.customUniformSeq = customSeq;
        if (!props.customUniformSeqs) props.customUniformSeqs = new Map();
        props.customUniformSeqs.set(cacheKey, customSeq);
      }

      if (!props.disposeAttached) {
        props.disposeAttached = true;
        material.addEventListener('dispose', () => {
          const matProps = this.properties.get<MaterialRuntimeProps>(material);
          if (matProps.programs) {
            for (const p of matProps.programs.values()) {
              this._bindingStates.releaseStatesOfProgram(p);
              this._programs.releaseProgram(p);
            }
            matProps.programs.clear();
          } else if (matProps.program !== undefined) {
            this._bindingStates.releaseStatesOfProgram(matProps.program);
            this._programs.releaseProgram(matProps.program);
          }
          matProps.programsByHash?.clear();
          matProps.program = undefined;
          matProps.lastProgram = undefined;
          matProps.lastHash = undefined;
          matProps.lastCustomUniformSeq = undefined;
          matProps.customUniforms = undefined;
          matProps.customUniformSeq = undefined;
          matProps.customUniformSeqs?.clear();
          this.properties.remove(material);
        });
      }
    } else {
      props.program = program;
      if (props.customUniformSeqs?.has(cacheKey)) {
        customSeq = props.customUniformSeqs.get(cacheKey);
        props.customUniformSeq = customSeq;
      }
    }

    // Store in per-material fast hash cache
    if (!shadersUnchanged || !customKeyUnchanged) {
      props.programsByHash?.clear();
    }
    if (!props.programsByHash) props.programsByHash = new Map();
    props.programsByHash.set(stateHash, { program, customUniformSeq: customSeq });
    props.lastHash = stateHash;
    props.lastProgram = program;
    props.lastCustomUniformSeq = customSeq;
    props.lastVertexShader = shaderMat ? shaderMat.vertexShader : undefined;
    props.lastFragmentShader = shaderMat ? shaderMat.fragmentShader : undefined;
    props.lastCustomKey = customKey;
    props.version = material.version;

    return program;
  }

  private uploadCommonUniforms(
    program: WebGLProgram,
    camera: RenderCameraLike,
    scene: Scene | null,
    material: Material,
    object: RenderableObjectLike,
  ): void {
    const gl = this._gl;
    const uniforms = program.getUniforms();

    this._textures.resetTextureUnits();

    const objUserData = (
      object as unknown as {
        userData?: {
          worldOrigin64?: { x: number; y: number; z: number };
          worldOriginBigInt?: { x: bigint; y: bigint; z: bigint };
          worldOriginYOffset?: number;
          scaleBand?: number;
          bandScaleMetersBig?: bigint;
        };
      }
    ).userData;
    const originBig = objUserData?.worldOriginBigInt;
    const origin64 = objUserData?.worldOrigin64;
    const objScaleBand = objUserData?.scaleBand ?? 0;

    if (originBig && (this._activeScaleBand > 0 || objScaleBand > 0 || this.cameraBigSector !== null)) {
      // Exact BigInt Sector subtraction + CPU scale-band division BEFORE converting to Float32:
      // Fixes JS Float64 2^53 precision loss AND WebGL Float32 overflow up to 10^31 km (10^34 m)!
      const ve = camera.matrixWorldInverse.elements;
      const useDirectCamPos = !camera.parent || camera.parent === scene;
      const fallbackCamX = useDirectCamPos ? camera.position.x : camera.matrixWorld.elements[12];
      const fallbackCamY = useDirectCamPos ? camera.position.y : camera.matrixWorld.elements[13];
      const fallbackCamZ = useDirectCamPos ? camera.position.z : camera.matrixWorld.elements[14];
      const camSector = this.cameraBigSector;
      const camOriginXBig = camSector ? camSector.sectorX * BIG_SECTOR_SIZE_METERS : 0n;
      const camOriginZBig = camSector ? camSector.sectorZ * BIG_SECTOR_SIZE_METERS : 0n;
      const camLocalX = camSector ? camSector.localX : fallbackCamX;
      const camLocalY = camSector ? camSector.localY : fallbackCamY;
      const camLocalZ = camSector ? camSector.localZ : fallbackCamZ;

      const diffXBig = originBig.x - camOriginXBig;
      const diffZBig = originBig.z - camOriginZBig;
      const extraY = typeof objUserData?.worldOriginYOffset === 'number' ? objUserData.worldOriginYOffset : 0;
      const diffY = Number(originBig.y) + extraY - camLocalY;

      const bandScaleBig =
        objUserData?.bandScaleMetersBig && objUserData.bandScaleMetersBig > 1n
          ? objUserData.bandScaleMetersBig
          : this._activeBandScaleBig;

      let dx: number;
      let dy: number;
      let dz: number;
      if (bandScaleBig <= 1n) {
        dx = Number(diffXBig) - camLocalX;
        dy = diffY;
        dz = Number(diffZBig) - camLocalZ;
      } else {
        const qX = diffXBig / bandScaleBig;
        const rX = diffXBig % bandScaleBig;
        const qZ = diffZBig / bandScaleBig;
        const rZ = diffZBig % bandScaleBig;
        const invScale = 1 / Number(bandScaleBig);
        dx = Number(qX) + (Number(rX) - camLocalX) * invScale;
        dy = diffY * invScale;
        dz = Number(qZ) + (Number(rZ) - camLocalZ) * invScale;
      }

      const mv = _modelViewMatrix.elements;
      mv[0] = ve[0]; mv[1] = ve[1]; mv[2] = ve[2]; mv[3] = 0;
      mv[4] = ve[4]; mv[5] = ve[5]; mv[6] = ve[6]; mv[7] = 0;
      mv[8] = ve[8]; mv[9] = ve[9]; mv[10] = ve[10]; mv[11] = 0;
      mv[12] = ve[0] * dx + ve[4] * dy + ve[8] * dz;
      mv[13] = ve[1] * dx + ve[5] * dy + ve[9] * dz;
      mv[14] = ve[2] * dx + ve[6] * dy + ve[10] * dz;
      mv[15] = 1;
    } else if (origin64) {
      // Exact IEEE-754 Float64 Relative-to-Eye (RTE) modelViewMatrix for Band-0 mega-tiles
      const ve = camera.matrixWorldInverse.elements;
      const useDirectCamPos = !camera.parent || camera.parent === scene;
      const camX = useDirectCamPos ? camera.position.x : camera.matrixWorld.elements[12];
      const camY = useDirectCamPos ? camera.position.y : camera.matrixWorld.elements[13];
      const camZ = useDirectCamPos ? camera.position.z : camera.matrixWorld.elements[14];
      const dx = origin64.x - camX;
      const dy = origin64.y - camY;
      const dz = origin64.z - camZ;
      const mv = _modelViewMatrix.elements;
      mv[0] = ve[0]; mv[1] = ve[1]; mv[2] = ve[2]; mv[3] = 0;
      mv[4] = ve[4]; mv[5] = ve[5]; mv[6] = ve[6]; mv[7] = 0;
      mv[8] = ve[8]; mv[9] = ve[9]; mv[10] = ve[10]; mv[11] = 0;
      mv[12] = ve[0] * dx + ve[4] * dy + ve[8] * dz;
      mv[13] = ve[1] * dx + ve[5] * dy + ve[9] * dz;
      mv[14] = ve[2] * dx + ve[6] * dy + ve[10] * dz;
      mv[15] = 1;
    } else {
      _modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
    }
    _normalMatrix.getNormalMatrix(_modelViewMatrix);
    _cameraWorldPos.setFromMatrixPosition(camera.matrixWorld);

    uniforms.setValue(gl, 'projectionMatrix', camera.projectionMatrix);
    uniforms.setValue(gl, 'viewMatrix', camera.matrixWorldInverse);
    uniforms.setValue(gl, 'modelMatrix', object.matrixWorld);
    uniforms.setValue(gl, 'modelViewMatrix', _modelViewMatrix);
    uniforms.setValue(gl, 'normalMatrix', _normalMatrix);
    uniforms.setValue(gl, 'cameraPosition', _cameraWorldPos);
    uniforms.setValue(gl, 'toneMappingExposure', this.toneMappingExposure);
    const shaderClockSec =
      this.currentTime > 0
        ? this.currentTime
        : typeof performance !== 'undefined'
          ? performance.now() * 0.001
          : 0;
    uniforms.setValue(gl, 'uCurrentTime', shaderClockSec);
    const isOrtho = Boolean(camera.isOrthographicCamera);
    let curvatureInv2R = 0.0;
    if (!isOrtho && this.planetCurvatureRadius > 0) {
      if (this._activeScaleBand === 0) {
        curvatureInv2R = 1.0 / (2.0 * this.planetCurvatureRadius);
      } else if (this._activeScaleBand === 1) {
        // Scale curvature drop consistently into Band 1 coordinates (bandScale / (2 * R))
        curvatureInv2R = Number(this._activeBandScaleBig) / (2.0 * this.planetCurvatureRadius);
      }
    }
    uniforms.setValue(gl, 'uPlanetCurvatureInv2R', curvatureInv2R);
    if (this.capabilities.logarithmicDepthBuffer) {
      const camFar = typeof camera.far === 'number' && camera.far > 1 ? camera.far : 1000;
      uniforms.setValue(gl, 'logDepthBufFC', 2.0 / Math.log2(camFar + 1.0));
    }

    // Fog uniforms (in cosmic scale bands > 0, use gentle band-local aerial perspective bounds
    // so Band-0 meter-scale fog distances never wipe out planetary/cosmic horizons!)
    if (scene && scene.fog && material.fog) {
      const fog = scene.fog;
      uniforms.setValue(gl, 'fogColor', fog.color);
      if (this._activeScaleBand > 0) {
        if ((fog as FogExp2).isFogExp2) {
          uniforms.setValue(gl, 'fogDensity', 0.0);
        } else {
          uniforms.setValue(gl, 'fogNear', 28000);
          uniforms.setValue(gl, 'fogFar', 120000);
        }
      } else if ((fog as FogExp2).isFogExp2) {
        uniforms.setValue(gl, 'fogDensity', (fog as FogExp2).density);
      } else {
        uniforms.setValue(gl, 'fogNear', (fog as Fog).near);
        uniforms.setValue(gl, 'fogFar', (fog as Fog).far);
      }
    }

    if ((material as ShaderMaterial).isShaderMaterial) {
      const shaderMat = material as ShaderMaterial;
      WebGLUniforms.upload(gl, uniforms.seq, shaderMat.uniforms, this._textures);
      shaderMat.uniformsNeedUpdate = false;
      return;
    }

    // Standard material uniforms (Basic / Lambert / Line / Points)
    uniforms.setValue(gl, 'opacity', material.opacity);
    if (material.alphaTest > 0) {
      uniforms.setValue(gl, 'alphaTest', material.alphaTest);
    }

    const basic = material as MeshBasicMaterial;
    if (basic.color) {
      uniforms.setValue(gl, 'diffuse', basic.color);
    }
    if (basic.map) {
      uniforms.setValue(gl, 'map', basic.map, this._textures);
    }
    if (basic.alphaMap) {
      uniforms.setValue(gl, 'alphaMap', basic.alphaMap, this._textures);
    }

    if ((material as PointsMaterial).isPointsMaterial) {
      const pts = material as PointsMaterial;
      uniforms.setValue(gl, 'size', pts.size * this._pixelRatio);
      uniforms.setValue(gl, 'scale', this._height * 0.5);
    }

    if ((material as MeshLambertMaterial).isMeshLambertMaterial) {
      const lambert = material as MeshLambertMaterial;
      _emissiveColor.copy(lambert.emissive).multiplyScalar(lambert.emissiveIntensity);
      uniforms.setValue(gl, 'emissive', _emissiveColor);
      if (lambert.emissiveMap) {
        uniforms.setValue(gl, 'emissiveMap', lambert.emissiveMap, this._textures);
      }

      if (scene) {
        const lights = this._renderStates.get(scene).lightsState;
        uniforms.setValue(gl, 'ambientLightColor', lights.ambient);
        if (lights.numDirLights > 0) {
          uniforms.setValue(gl, 'directionalLights', lights.directional);
        }
        if (lights.numHemiLights > 0) {
          uniforms.setValue(gl, 'hemisphereLights', lights.hemisphere);
        }
        if (lights.numPointLights > 0) {
          uniforms.setValue(gl, 'pointLights', lights.point);
        }
      }
    }

    const matProps = this.properties.get<MaterialRuntimeProps>(material);
    if (
      matProps.customUniforms !== undefined &&
      matProps.customUniformSeq !== undefined &&
      matProps.customUniformSeq.length > 0
    ) {
      WebGLUniforms.upload(gl, matProps.customUniformSeq, matProps.customUniforms, this._textures);
    }
  }

  renderBufferDirect(
    camera: RenderCameraLike,
    scene: Scene | null,
    geometry: BufferGeometry,
    material: Material,
    object: RenderableObjectLike,
    group: GeometryGroup | null = null,
  ): void {
    if (this._isContextLost) return;

    const gl = this._gl;
    this.trackGeometry(geometry);
    if (object.isInstancedMesh) {
      this.trackInstancedMesh(object);
    }

    const frontFaceCW = object.matrixWorld.determinant() < 0;
    const program = this.getProgram(material, scene, object, geometry);

    this.state.useProgram(program.program);
    this.state.setMaterial(material, frontFaceCW);

    this.uploadCommonUniforms(program, camera, scene, material, object);

    let index = geometry.index;
    const position = geometry.attributes.position;
    if (position === undefined) return;

    const isMeshWireframe =
      Boolean((material as MeshBasicMaterial).wireframe) &&
      !object.isLineSegments &&
      !object.isLine &&
      !object.isLineLoop &&
      !object.isPoints;

    let drawMode: number = gl.TRIANGLES;
    if (isMeshWireframe) {
      const wireIndex = this.getWireframeIndexAttribute(geometry);
      if (wireIndex) {
        index = wireIndex;
      }
      drawMode = gl.LINES;
      this.state.setLineWidth(1.0);
      gl.lineWidth(1.0);
    } else if (object.isLineSegments) {
      drawMode = gl.LINES;
      this.state.setLineWidth(1.0);
      gl.lineWidth(1.0);
    } else if (object.isLineLoop) {
      drawMode = gl.LINE_LOOP;
      this.state.setLineWidth(1.0);
      gl.lineWidth(1.0);
    } else if (object.isLine) {
      drawMode = gl.LINE_STRIP;
      this.state.setLineWidth(1.0);
      gl.lineWidth(1.0);
    } else if (object.isPoints) {
      drawMode = gl.POINTS;
    }

    this._bindingStates.setup(object, material, program, geometry, index);

    const drawRange = geometry.drawRange;
    let drawStart = drawRange.start;
    let drawEnd = drawRange.start + drawRange.count;

    if (isMeshWireframe && index !== null) {
      // Wireframe index buffer stores 2 indices per edge (full geometry edges or 2x triangle index count)
      drawStart = 0;
      drawEnd = index.count;
    } else if (group !== null) {
      drawStart = Math.max(drawStart, group.start);
      drawEnd = Math.min(drawEnd, group.start + group.count);
    }

    if (index !== null) {
      const indexRecord = this._attributes.update(index, gl.ELEMENT_ARRAY_BUFFER);
      drawEnd = Math.min(drawEnd, index.count);
      const drawCount = Math.max(0, drawEnd - drawStart);
      if (drawCount === 0) return;

      this._indexedBufferRenderer.setMode(drawMode);
      this._indexedBufferRenderer.setIndex(indexRecord);

      if (object.isInstancedMesh) {
        this._indexedBufferRenderer.renderInstances(drawStart, drawCount, object.count ?? 0);
      } else {
        this._indexedBufferRenderer.render(drawStart, drawCount);
      }
    } else {
      drawEnd = Math.min(drawEnd, position.count);
      const drawCount = Math.max(0, drawEnd - drawStart);
      if (drawCount === 0) return;

      this._bufferRenderer.setMode(drawMode);

      if (object.isInstancedMesh) {
        this._bufferRenderer.renderInstances(drawStart, drawCount, object.count ?? 0);
      } else {
        this._bufferRenderer.render(drawStart, drawCount);
      }
    }
  }

  private projectObject(
    object: Object3D,
    camera: RenderCameraLike,
    scene: Scene,
    groupOrder: number,
  ): void {
    if (object.visible === false) return;

    const visible = object.layers.test(camera.layers);
    const renderable = object as RenderableObjectLike;
    const maybeLight = object as LightLike;

    if (visible) {
      if (maybeLight.isLight) {
        this._renderStates.get(scene).pushLight(maybeLight);
      } else if (
        renderable.geometry !== undefined &&
        renderable.material !== undefined &&
        (renderable.isMesh || renderable.isLine || renderable.isPoints)
      ) {
        const objUserData = (
          renderable as unknown as {
            userData?: { scaleBand?: number; isSkyDome?: boolean };
          }
        ).userData;
        const scaleBand = objUserData?.scaleBand ?? 0;
        const isSkyDome = Boolean(objUserData?.isSkyDome);
        const overrideMat = scene.overrideMaterial as Material | null;

        // Cosmic Scale-Space Band objects (scaleBand > 0) skip Band-0 frustum culling and
        // route to their own farthest-to-nearest multi-pass bucket (skipped in ortho/shadow passes)
        if (scaleBand > 0) {
          if (overrideMat === null && !camera.isOrthographicCamera) {
            const geometry = renderable.geometry;
            const material = Array.isArray(renderable.material)
              ? renderable.material[0]
              : renderable.material;
            if (material && material.visible) {
              let bucket = this._scaleBandBuckets.get(scaleBand);
              if (!bucket) {
                bucket = { opaque: [], water: [] };
                this._scaleBandBuckets.set(scaleBand, bucket);
              }
              if (bucket.opaque.length === 0 && bucket.water.length === 0) {
                this._activeScaleBandKeys.push(scaleBand);
              }
              const item: RenderItem = {
                id: object.id,
                object,
                geometry,
                material,
                groupOrder,
                renderOrder: object.renderOrder,
                z: 0,
                group: null,
              };
              if (material.transparent) {
                bucket.water.push(item);
              } else {
                bucket.opaque.push(item);
              }
            }
          }
        } else if (!object.frustumCulled || this.isObjectInFrustum(renderable)) {
          _vector3.setFromMatrixPosition(object.matrixWorld).applyMatrix4(_projScreenMatrix);
          const z = _vector3.z;

          const geometry = renderable.geometry;
          const material = overrideMat ?? renderable.material;
          const list = this._renderLists.get(scene);

          if (isSkyDome && overrideMat === null && !Array.isArray(material) && material.visible) {
            this._skyDomeItems.push({
              id: object.id,
              object,
              geometry,
              material,
              groupOrder,
              renderOrder: object.renderOrder,
              z,
              group: null,
            });
          } else if (Array.isArray(material)) {
            const groups = geometry.groups;
            for (let i = 0; i < groups.length; i++) {
              const group = groups[i];
              const groupMat = material[group.materialIndex];
              if (groupMat && groupMat.visible) {
                list.push(object, geometry, groupMat, groupOrder, z, group);
              }
            }
          } else if (material.visible) {
            if (
              overrideMat === null &&
              !material.transparent &&
              (renderable as unknown as { isTerrainChunk?: boolean }).isTerrainChunk === true
            ) {
              this._terrainChunks.push(renderable);
            } else {
              list.push(object, geometry, material, groupOrder, z, null);
            }
          }
        }
      }
    }

    const children = object.children;
    for (let i = 0; i < children.length; i++) {
      this.projectObject(children[i], camera, scene, groupOrder);
    }
  }

  private isObjectInFrustum(object: RenderableObjectLike): boolean {
    const geometry = object.geometry;
    if (!geometry) return true;
    if (geometry.boundingSphere === null) {
      geometry.computeBoundingSphere();
    }
    if (geometry.boundingSphere === null) return true;

    _sphere.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld);
    return _frustum.intersectsSphere(_sphere);
  }

  private renderObjects(items: RenderItem[], scene: Scene, camera: RenderCameraLike): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const object = item.object as RenderableObjectLike;
      const material = item.material;

      material.onBeforeRender(this, scene, camera, item.geometry, object, item.group);
      this.renderBufferDirect(camera, scene, item.geometry, material, object, item.group);
    }
  }

  private isIdentityMatrix(m: Matrix4): boolean {
    const e = m.elements;
    return (
      e[0] === 1 && e[1] === 0 && e[2] === 0 && e[3] === 0 &&
      e[4] === 0 && e[5] === 1 && e[6] === 0 && e[7] === 0 &&
      e[8] === 0 && e[9] === 0 && e[10] === 1 && e[11] === 0 &&
      e[12] === 0 && e[13] === 0 && e[14] === 0 && e[15] === 1
    );
  }

  /**
   * Voxel-specific optimization: renders a flat array of terrain chunk meshes directly
   * using each chunk's own persistent GPU VBOs + cached VAO while sharing a single
   * program bind, material state setup, and uniform upload across all compatible chunks.
   *
   * Unlike monolithic VBO merging, frustum visibility changes never copy or re-upload
   * unchanged chunks, eliminating camera-turn VBO rebuild spikes.
   */
  renderChunkBatch(
    chunks: RenderableObjectLike[],
    camera: RenderCameraLike,
    scene: Scene,
    alreadyFrustumCulled = false,
  ): number {
    if (this._isContextLost || chunks.length === 0) return 0;

    if (!alreadyFrustumCulled) {
      _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projScreenMatrix);
    }

    const gl = this._gl;
    const eligible = this._batchEligibleChunks;
    const fallback = this._batchFallbackChunks;
    eligible.length = 0;
    fallback.length = 0;

    let batchMat: Material | null = null;
    let batchAttrMask = -1;
    let rendered = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.visible || !chunk.geometry || !chunk.material) continue;
      if (!alreadyFrustumCulled && chunk.frustumCulled && !this.isObjectInFrustum(chunk)) continue;

      const mat = Array.isArray(chunk.material) ? chunk.material[0] : chunk.material;
      if (!mat || !mat.visible) continue;

      const geo = chunk.geometry;
      const posAttr = geo.attributes.position;
      const idxAttr = geo.index;
      const isWireframe = Boolean((mat as MeshBasicMaterial).wireframe);
      const drawStart = geo.drawRange.start;
      const drawCount =
        idxAttr !== null
          ? Math.max(0, Math.min(idxAttr.count, drawStart + geo.drawRange.count) - drawStart)
          : 0;

      const canShareState =
        !isWireframe &&
        !chunk.isInstancedMesh &&
        posAttr !== undefined &&
        idxAttr !== null &&
        drawCount > 0 &&
        this.isIdentityMatrix(chunk.matrixWorld);

      if (canShareState) {
        const hasAo = geo.attributes.ao !== undefined ? 1 : 0;
        const hasSpawnPop =
          geo.attributes.spawnTime !== undefined && geo.attributes.voxelCenter !== undefined ? 2 : 0;
        const attrMask = hasAo | hasSpawnPop;
        if (batchMat === null) {
          batchMat = mat;
          batchAttrMask = attrMask;
        }
        if (mat === batchMat && attrMask === batchAttrMask) {
          eligible.push(chunk);
          rendered++;
          continue;
        }
      }

      fallback.push(chunk);
      rendered++;
    }

    if (eligible.length >= 2 && batchMat !== null) {
      const firstChunk = eligible[0];
      const firstGeo = firstChunk.geometry!;

      batchMat.onBeforeRender(this, scene, camera, firstGeo, firstChunk, null);
      const program = this.getProgram(batchMat, scene, firstChunk, firstGeo);

      this.state.useProgram(program.program);
      this.state.setMaterial(batchMat, false);
      this.uploadCommonUniforms(program, camera, scene, batchMat, firstChunk);
      this._indexedBufferRenderer.setMode(gl.TRIANGLES);

      for (let i = 0; i < eligible.length; i++) {
        const ch = eligible[i];
        const geo = ch.geometry!;
        const index = geo.index!;
        const drawStart = geo.drawRange.start;
        const drawEnd = Math.min(index.count, drawStart + geo.drawRange.count);
        const drawCount = Math.max(0, drawEnd - drawStart);
        if (drawCount === 0) continue;

        this.trackGeometry(geo);
        this._bindingStates.setup(ch, batchMat, program, geo, index);
        const indexRecord = this._attributes.update(index, gl.ELEMENT_ARRAY_BUFFER);
        this._indexedBufferRenderer.setIndex(indexRecord);
        this._indexedBufferRenderer.render(drawStart, drawCount);
      }
    } else if (eligible.length === 1 && batchMat !== null) {
      const ch = eligible[0];
      batchMat.onBeforeRender(this, scene, camera, ch.geometry!, ch, null);
      this.renderBufferDirect(camera, scene, ch.geometry!, batchMat, ch, null);
    }

    for (let i = 0; i < fallback.length; i++) {
      const ch = fallback[i];
      const mat = Array.isArray(ch.material) ? ch.material[0] : ch.material!;
      mat.onBeforeRender(this, scene, camera, ch.geometry!, ch, null);
      this.renderBufferDirect(camera, scene, ch.geometry!, mat, ch, null);
    }

    eligible.length = 0;
    fallback.length = 0;
    return rendered;
  }

  compile(scene: Scene, camera: RenderCameraLike): Set<Material> {
    if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();

    const renderState = this._renderStates.get(scene);
    renderState.init();

    scene.traverseVisible((obj) => {
      const light = obj as LightLike;
      if (light.isLight) renderState.pushLight(light);
    });
    renderState.setupLights(camera.matrixWorldInverse);

    const compiled = new Set<Material>();
    scene.traverseVisible((obj) => {
      const r = obj as RenderableObjectLike;
      if (!r.material) return;
      const mats = Array.isArray(r.material) ? r.material : [r.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!compiled.has(m)) {
          this.getProgram(m, scene, r);
          compiled.add(m);
        }
      }
    });

    return compiled;
  }

  compileAsync(scene: Scene, camera: RenderCameraLike): Promise<Scene> {
    this.compile(scene, camera);
    return Promise.resolve(scene);
  }

  private buildScaleBandProjectionMatrix(camera: RenderCameraLike, target: Matrix4): void {
    const fov = typeof camera.fov === 'number' && camera.fov > 0 ? camera.fov : 50;
    const aspect = typeof camera.aspect === 'number' && camera.aspect > 0 ? camera.aspect : 1;
    const zoom = typeof camera.zoom === 'number' && camera.zoom > 0 ? camera.zoom : 1;
    const near = SCALE_BAND_NEAR;
    const far = SCALE_BAND_FAR;
    const top = (near * Math.tan(DEG2RAD * 0.5 * fov)) / zoom;
    const height = 2 * top;
    const width = aspect * height;
    const left = -0.5 * width;
    target.makePerspective(
      left,
      left + width,
      top,
      top - height,
      near,
      far,
      camera.coordinateSystem ?? WebGLCoordinateSystem,
      Boolean(camera.reversedDepth),
    );
  }

  render(scene: Scene, camera: RenderCameraLike): void {
    if (this._isContextLost) return;

    if (this.info.autoReset) {
      this.info.reset();
    }
    this.info.render.frame++;

    if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();

    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    const renderState = this._renderStates.get(scene);
    renderState.init();

    const renderList = this._renderLists.get(scene);
    renderList.init();
    this._terrainChunks.length = 0;
    this._skyDomeItems.length = 0;
    for (let i = 0; i < this._activeScaleBandKeys.length; i++) {
      const b = this._scaleBandBuckets.get(this._activeScaleBandKeys[i]);
      if (b) {
        b.opaque.length = 0;
        b.water.length = 0;
      }
    }
    this._activeScaleBandKeys.length = 0;

    this.projectObject(scene, camera, scene, 0);
    renderList.finish();

    if (this.sortObjects) {
      renderList.sort();
    }

    renderState.setupLights(camera.matrixWorldInverse);

    this._background.render(this, scene);

    // 1. Paint SkyDome FIRST behind every cosmic scale band (depthWrite: false, depth = 1.0)
    if (this._skyDomeItems.length > 0) {
      this.renderObjects(this._skyDomeItems, scene, camera);
    }

    // 2. Scale-Space Multi-Pass Rendering: render outer scale bands from FARTHEST -> NEAREST,
    //    clearing the depth buffer (`gl.clear(gl.DEPTH_BUFFER_BIT)`) between every band so each
    //    band uses a tight [0.25 .. 65536] frustum with full 24-bit depth precision & zero z-fighting!
    if (this._activeScaleBandKeys.length > 0 && !camera.isOrthographicCamera) {
      this._activeScaleBandKeys.sort((a, b) => b - a);
      this.buildScaleBandProjectionMatrix(camera, _bandProjMatrix);
      _savedProjMatrix.copy(camera.projectionMatrix);
      const savedFar = camera.far;

      camera.projectionMatrix.copy(_bandProjMatrix);
      camera.far = SCALE_BAND_FAR;

      for (let i = 0; i < this._activeScaleBandKeys.length; i++) {
        const bandIdx = this._activeScaleBandKeys[i];
        const bucket = this._scaleBandBuckets.get(bandIdx);
        if (!bucket || (bucket.opaque.length === 0 && bucket.water.length === 0)) continue;

        this._activeScaleBand = bandIdx;
        this._activeBandScaleBig = 1n << BigInt(bandIdx * 12);

        if (bucket.opaque.length > 0) {
          this.renderObjects(bucket.opaque, scene, camera);
        }
        if (bucket.water.length > 0) {
          this.renderObjects(bucket.water, scene, camera);
        }

        // Clear depth buffer between scale bands so nearer bands composite cleanly with full 24-bit depth
        this.state.setDepthWrite(true);
        this._gl.clear(this._gl.DEPTH_BUFFER_BIT);
      }

      this._activeScaleBand = 0;
      this._activeBandScaleBig = 1n;
      camera.projectionMatrix.copy(_savedProjMatrix);
      camera.far = savedFar;
    }

    // 3. Band 0 (Local Scene): LOD0 real chunks, vehicles, nearby horizon rings, particles, water
    if (this._terrainChunks.length > 0) {
      this.renderChunkBatch(this._terrainChunks, camera, scene, true);
    }

    if (renderList.opaque.length > 0) {
      this.renderObjects(renderList.opaque, scene, camera);
    }

    if (renderList.transparent.length > 0) {
      this.renderObjects(renderList.transparent, scene, camera);
    }

    perfProfiler.recordRenderPassStats(
      this.info.render.calls,
      this.info.render.triangles,
      scene.children.length > 1,
    );
  }

  dispose(): void {
    this.setAnimationLoop(null);
    this._terrainChunks.length = 0;
    this._batchEligibleChunks.length = 0;
    this._batchFallbackChunks.length = 0;
    this._skyDomeItems.length = 0;
    this._activeScaleBandKeys.length = 0;
    this._scaleBandBuckets.clear();
    this._renderLists.dispose();
    this._renderStates.dispose();
    this._bindingStates.dispose();
    this._attributes.dispose();
    this._textures.dispose();
    this._programs.dispose();
    this.properties.dispose();
    this.state.reset();
  }
}
