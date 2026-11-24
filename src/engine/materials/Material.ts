import { Color, Euler, Plane, Vector2, Vector3, Vector4, type ColorRepresentation } from '../math';
import {
  AddEquation,
  AlwaysStencilFunc,
  FrontSide,
  KeepStencilOp,
  LessEqualDepth,
  NormalBlending,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
} from '../core/constants';
import { EventDispatcher } from '../core/EventDispatcher';
import { generateUUID } from '../core/Object3D';

export interface TextureLike {
  isTexture?: boolean;
  uuid?: string;
  toJSON?(meta?: Record<string, unknown>): Record<string, unknown>;
}

export interface MaterialParameters {
  name?: string;
  visible?: boolean;
  fog?: boolean;
  blending?: number;
  side?: number;
  vertexColors?: boolean;
  opacity?: number;
  transparent?: boolean;
  alphaHash?: boolean;
  blendSrc?: number;
  blendDst?: number;
  blendEquation?: number;
  blendSrcAlpha?: number | null;
  blendDstAlpha?: number | null;
  blendEquationAlpha?: number | null;
  blendColor?: ColorRepresentation;
  blendAlpha?: number;
  depthFunc?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  stencilWriteMask?: number;
  stencilFunc?: number;
  stencilRef?: number;
  stencilFuncMask?: number;
  stencilFail?: number;
  stencilZFail?: number;
  stencilZPass?: number;
  stencilWrite?: boolean;
  stencilTest?: boolean;
  clippingPlanes?: Plane[] | null;
  clipIntersection?: boolean;
  clipShadows?: boolean;
  shadowSide?: number | null;
  colorWrite?: boolean;
  precision?: 'highp' | 'mediump' | 'lowp' | null;
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
  dithering?: boolean;
  alphaTest?: number;
  alphaToCoverage?: boolean;
  premultipliedAlpha?: boolean;
  forceSinglePass?: boolean;
  allowOverride?: boolean;
  toneMapped?: boolean;
  userData?: Record<string, unknown>;
  isVoxelMaterial?: boolean;
}

let _materialId = 1;

export class Material extends EventDispatcher {
  readonly isMaterial = true;
  readonly id: number;

  uuid: string;
  name = '';
  type = 'Material';

  blending: number = NormalBlending;
  side: number = FrontSide;
  vertexColors = false;

  opacity = 1;
  transparent = false;
  alphaHash = false;

  blendSrc: number = SrcAlphaFactor;
  blendDst: number = OneMinusSrcAlphaFactor;
  blendEquation: number = AddEquation;
  blendSrcAlpha: number | null = null;
  blendDstAlpha: number | null = null;
  blendEquationAlpha: number | null = null;
  blendColor: Color = new Color(0, 0, 0);
  blendAlpha = 0;

  depthFunc: number = LessEqualDepth;
  depthTest = true;
  depthWrite = true;

  stencilWriteMask = 0xff;
  stencilFunc: number = AlwaysStencilFunc;
  stencilRef = 0;
  stencilFuncMask = 0xff;
  stencilFail: number = KeepStencilOp;
  stencilZFail: number = KeepStencilOp;
  stencilZPass: number = KeepStencilOp;
  stencilWrite = false;
  stencilTest = false;

  clippingPlanes: Plane[] | null = null;
  clipIntersection = false;
  clipShadows = false;

  shadowSide: number | null = null;

  colorWrite = true;
  precision: 'highp' | 'mediump' | 'lowp' | null = null;

  polygonOffset = false;
  polygonOffsetFactor = 0;
  polygonOffsetUnits = 0;

  dithering = false;
  alphaToCoverage = false;
  premultipliedAlpha = false;
  forceSinglePass = false;
  allowOverride = true;

  visible = true;
  toneMapped = true;
  fog = true;

  userData: Record<string, unknown> = {};
  version = 0;

  /** Voxel-specific optimization flag for fast chunk batching pipelines. */
  isVoxelMaterial = false;

  private _alphaTest = 0;
  private _needsUpdate = false;

  constructor() {
    super();
    this.id = _materialId++;
    this.uuid = generateUUID();
  }

  get alphaTest(): number {
    return this._alphaTest;
  }

  set alphaTest(value: number) {
    if ((this._alphaTest > 0) !== (value > 0)) {
      this.version++;
    }
    this._alphaTest = value;
  }

  get needsUpdate(): boolean {
    return this._needsUpdate;
  }

  set needsUpdate(value: boolean) {
    this._needsUpdate = value;
    if (value === true) {
      this.version++;
    }
  }

  onBuild(_shaderObject?: unknown, _renderer?: unknown): void {}

  onBeforeRender(
    _renderer?: unknown,
    _scene?: unknown,
    _camera?: unknown,
    _geometry?: unknown,
    _object?: unknown,
    _group?: unknown,
  ): void {}

  onBeforeCompile(_shaderObject?: unknown, _renderer?: unknown): void {}

  customProgramCacheKey(): string {
    return this.onBeforeCompile.toString();
  }

  /**
   * Voxel-specific optimization: compact deterministic pipeline/state key
   * so chunk renderers can group draw calls with identical WebGL state.
   */
  getRenderStateKey(): string {
    return (
      `${this.type}|s${this.side}|b${this.blending}|t${this.transparent ? 1 : 0}` +
      `|dt${this.depthTest ? 1 : 0}|dw${this.depthWrite ? 1 : 0}` +
      `|vc${this.vertexColors ? 1 : 0}|fg${this.fog ? 1 : 0}|at${this._alphaTest > 0 ? 1 : 0}`
    );
  }

  setValues(values?: Record<string, unknown>): void {
    if (values === undefined) return;

    const self = this as unknown as Record<string, unknown>;

    for (const key of Object.keys(values)) {
      const incoming = values[key];
      if (incoming === undefined) continue;

      const current = self[key];
      if (current === undefined) continue;

      if (current instanceof Color) {
        current.set(incoming as ColorRepresentation);
      } else if (current instanceof Vector2 && incoming instanceof Vector2) {
        current.copy(incoming);
      } else if (current instanceof Vector3 && incoming instanceof Vector3) {
        current.copy(incoming);
      } else if (current instanceof Vector4 && incoming instanceof Vector4) {
        current.copy(incoming);
      } else if (current instanceof Euler && incoming instanceof Euler) {
        current.copy(incoming);
      } else {
        self[key] = incoming;
      }
    }
  }

  toJSON(meta?: Record<string, unknown>): Record<string, unknown> {
    const isRoot = meta === undefined || typeof meta === 'string';

    const data: Record<string, unknown> = {
      uuid: this.uuid,
      type: this.type,
    };

    if (isRoot) {
      data.metadata = {
        version: 4.6,
        type: 'Material',
        generator: 'VoxelEngine.Material.toJSON',
      };
    }

    if (this.name !== '') data.name = this.name;
    if (this.blending !== NormalBlending) data.blending = this.blending;
    if (this.side !== FrontSide) data.side = this.side;
    if (this.vertexColors) data.vertexColors = true;
    if (this.opacity < 1) data.opacity = this.opacity;
    if (this.transparent) data.transparent = true;
    if (this.alphaHash) data.alphaHash = true;

    if (this.blendSrc !== SrcAlphaFactor) data.blendSrc = this.blendSrc;
    if (this.blendDst !== OneMinusSrcAlphaFactor) data.blendDst = this.blendDst;
    if (this.blendEquation !== AddEquation) data.blendEquation = this.blendEquation;
    if (this.blendSrcAlpha !== null) data.blendSrcAlpha = this.blendSrcAlpha;
    if (this.blendDstAlpha !== null) data.blendDstAlpha = this.blendDstAlpha;
    if (this.blendEquationAlpha !== null) data.blendEquationAlpha = this.blendEquationAlpha;
    if (this.blendColor.r !== 0 || this.blendColor.g !== 0 || this.blendColor.b !== 0) {
      data.blendColor = this.blendColor.getHex();
    }
    if (this.blendAlpha !== 0) data.blendAlpha = this.blendAlpha;

    if (this.depthFunc !== LessEqualDepth) data.depthFunc = this.depthFunc;
    if (!this.depthTest) data.depthTest = false;
    if (!this.depthWrite) data.depthWrite = false;
    if (!this.colorWrite) data.colorWrite = false;

    if (this.stencilWriteMask !== 0xff) data.stencilWriteMask = this.stencilWriteMask;
    if (this.stencilFunc !== AlwaysStencilFunc) data.stencilFunc = this.stencilFunc;
    if (this.stencilRef !== 0) data.stencilRef = this.stencilRef;
    if (this.stencilFuncMask !== 0xff) data.stencilFuncMask = this.stencilFuncMask;
    if (this.stencilFail !== KeepStencilOp) data.stencilFail = this.stencilFail;
    if (this.stencilZFail !== KeepStencilOp) data.stencilZFail = this.stencilZFail;
    if (this.stencilZPass !== KeepStencilOp) data.stencilZPass = this.stencilZPass;
    if (this.stencilWrite) data.stencilWrite = true;
    if (this.stencilTest) data.stencilTest = true;

    if (this.polygonOffset) {
      data.polygonOffset = true;
      data.polygonOffsetFactor = this.polygonOffsetFactor;
      data.polygonOffsetUnits = this.polygonOffsetUnits;
    }

    if (this.dithering) data.dithering = true;
    if (this._alphaTest > 0) data.alphaTest = this._alphaTest;
    if (this.alphaToCoverage) data.alphaToCoverage = true;
    if (this.premultipliedAlpha) data.premultipliedAlpha = true;
    if (this.forceSinglePass) data.forceSinglePass = true;
    if (!this.allowOverride) data.allowOverride = false;
    if (!this.visible) data.visible = false;
    if (!this.toneMapped) data.toneMapped = false;
    if (!this.fog) data.fog = false;

    if (Object.keys(this.userData).length > 0) {
      data.userData = this.userData;
    }

    return data;
  }

  clone(): this {
    const Ctor = this.constructor as new () => this;
    return new Ctor().copy(this);
  }

  copy(source: this): this {
    this.name = source.name;

    this.blending = source.blending;
    this.side = source.side;
    this.vertexColors = source.vertexColors;

    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.alphaHash = source.alphaHash;

    this.blendSrc = source.blendSrc;
    this.blendDst = source.blendDst;
    this.blendEquation = source.blendEquation;
    this.blendSrcAlpha = source.blendSrcAlpha;
    this.blendDstAlpha = source.blendDstAlpha;
    this.blendEquationAlpha = source.blendEquationAlpha;
    this.blendColor.copy(source.blendColor);
    this.blendAlpha = source.blendAlpha;

    this.depthFunc = source.depthFunc;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;

    this.stencilWriteMask = source.stencilWriteMask;
    this.stencilFunc = source.stencilFunc;
    this.stencilRef = source.stencilRef;
    this.stencilFuncMask = source.stencilFuncMask;
    this.stencilFail = source.stencilFail;
    this.stencilZFail = source.stencilZFail;
    this.stencilZPass = source.stencilZPass;
    this.stencilWrite = source.stencilWrite;
    this.stencilTest = source.stencilTest;

    if (source.clippingPlanes !== null) {
      this.clippingPlanes = source.clippingPlanes.map((p) => p.clone());
    } else {
      this.clippingPlanes = null;
    }

    this.clipIntersection = source.clipIntersection;
    this.clipShadows = source.clipShadows;
    this.shadowSide = source.shadowSide;

    this.colorWrite = source.colorWrite;
    this.precision = source.precision;

    this.polygonOffset = source.polygonOffset;
    this.polygonOffsetFactor = source.polygonOffsetFactor;
    this.polygonOffsetUnits = source.polygonOffsetUnits;

    this.dithering = source.dithering;
    this._alphaTest = source._alphaTest;
    this.alphaToCoverage = source.alphaToCoverage;
    this.premultipliedAlpha = source.premultipliedAlpha;
    this.forceSinglePass = source.forceSinglePass;
    this.allowOverride = source.allowOverride;

    this.visible = source.visible;
    this.toneMapped = source.toneMapped;
    this.fog = source.fog;
    this.isVoxelMaterial = source.isVoxelMaterial;

    this.userData = JSON.parse(JSON.stringify(source.userData));

    return this;
  }

  dispose(): void {
    this.dispatchEvent({ type: 'dispose' });
  }
}
