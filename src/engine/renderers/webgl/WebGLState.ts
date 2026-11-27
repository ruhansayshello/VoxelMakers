import { Vector4 } from '../../math';
import {
  AddEquation,
  AdditiveBlending,
  AlwaysDepth,
  BackSide,
  CustomBlending,
  DoubleSide,
  DstAlphaFactor,
  DstColorFactor,
  EqualDepth,
  GreaterDepth,
  GreaterEqualDepth,
  LessDepth,
  LessEqualDepth,
  MaxEquation,
  MinEquation,
  MultiplyBlending,
  NeverDepth,
  NoBlending,
  NormalBlending,
  NotEqualDepth,
  OneFactor,
  OneMinusDstAlphaFactor,
  OneMinusDstColorFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  ReverseSubtractEquation,
  SrcAlphaFactor,
  SrcAlphaSaturateFactor,
  SrcColorFactor,
  SubtractEquation,
  SubtractiveBlending,
  ZeroFactor,
} from '../../core/constants';
import type { Material } from '../../materials/Material';
import { CullFaceBack, CullFaceFront, CullFaceFrontBack, CullFaceNone } from './constants';

export class WebGLState {
  private gl: WebGL2RenderingContext;

  currentProgram: WebGLProgram | null = null;
  currentBlendMode: number | null = null;
  currentBlendEquation: number | null = null;
  currentBlendSrc: number | null = null;
  currentBlendDst: number | null = null;
  currentBlendEquationAlpha: number | null = null;
  currentBlendSrcAlpha: number | null = null;
  currentBlendDstAlpha: number | null = null;
  currentPremultipledAlpha = false;

  currentDepthTest: boolean | null = null;
  currentDepthWrite: boolean | null = null;
  currentDepthFunc: number | null = null;
  currentColorMask: boolean | null = null;

  currentCullFace: number | null = null;
  currentFrontFace: number | null = null;
  currentFlipSided: boolean | null = null;

  currentPolygonOffsetFactor: number | null = null;
  currentPolygonOffsetUnits: number | null = null;
  currentLineWidth: number | null = null;

  currentViewport = new Vector4();
  currentScissor = new Vector4();
  currentScissorTest: boolean | null = null;

  currentClearColor = new Vector4(0, 0, 0, 0);
  currentClearDepth: number | null = null;
  currentClearStencil: number | null = null;

  private enabledCapabilities: Record<number, boolean> = {};
  private currentTextureSlot: number | null = null;
  private boundTextures: Record<number, { type: number; texture: WebGLTexture | null }> = {};
  private currentBoundFramebuffers: Record<number, WebGLFramebuffer | null> = {};

  private readonly equationToGL: Record<number, number>;
  private readonly factorToGL: Record<number, number>;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    this.equationToGL = {
      [AddEquation]: gl.FUNC_ADD,
      [SubtractEquation]: gl.FUNC_SUBTRACT,
      [ReverseSubtractEquation]: gl.FUNC_REVERSE_SUBTRACT,
      [MinEquation]: gl.MIN,
      [MaxEquation]: gl.MAX,
    };

    this.factorToGL = {
      [ZeroFactor]: gl.ZERO,
      [OneFactor]: gl.ONE,
      [SrcColorFactor]: gl.SRC_COLOR,
      [OneMinusSrcColorFactor]: gl.ONE_MINUS_SRC_COLOR,
      [SrcAlphaFactor]: gl.SRC_ALPHA,
      [OneMinusSrcAlphaFactor]: gl.ONE_MINUS_SRC_ALPHA,
      [DstAlphaFactor]: gl.DST_ALPHA,
      [OneMinusDstAlphaFactor]: gl.ONE_MINUS_DST_ALPHA,
      [DstColorFactor]: gl.DST_COLOR,
      [OneMinusDstColorFactor]: gl.ONE_MINUS_DST_COLOR,
      [SrcAlphaSaturateFactor]: gl.SRC_ALPHA_SATURATE,
    };
  }

  enable(capability: number): void {
    if (this.enabledCapabilities[capability] !== true) {
      this.gl.enable(capability);
      this.enabledCapabilities[capability] = true;
    }
  }

  disable(capability: number): void {
    if (this.enabledCapabilities[capability] !== false) {
      this.gl.disable(capability);
      this.enabledCapabilities[capability] = false;
    }
  }

  useProgram(program: WebGLProgram | null): boolean {
    if (this.currentProgram !== program) {
      this.gl.useProgram(program);
      this.currentProgram = program;
      return true;
    }
    return false;
  }

  setBlendMode(
    blending: number,
    blendEquation: number = AddEquation,
    blendSrc: number = SrcAlphaFactor,
    blendDst: number = OneMinusSrcAlphaFactor,
    blendEquationAlpha: number | null = null,
    blendSrcAlpha: number | null = null,
    blendDstAlpha: number | null = null,
    premultipliedAlpha = false,
  ): void {
    const gl = this.gl;

    if (blending === NoBlending) {
      if (this.currentBlendMode !== NoBlending) {
        this.disable(gl.BLEND);
        this.currentBlendMode = NoBlending;
      }
      return;
    }

    if (this.currentBlendMode === NoBlending || this.currentBlendMode === null) {
      this.enable(gl.BLEND);
    }

    if (blending !== CustomBlending) {
      if (blending !== this.currentBlendMode || premultipliedAlpha !== this.currentPremultipledAlpha) {
        if (this.currentBlendEquation !== AddEquation || this.currentBlendEquationAlpha !== AddEquation) {
          gl.blendEquation(gl.FUNC_ADD);
          this.currentBlendEquation = AddEquation;
          this.currentBlendEquationAlpha = AddEquation;
        }

        if (premultipliedAlpha) {
          switch (blending) {
            case NormalBlending:
              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              break;
            case AdditiveBlending:
              gl.blendFunc(gl.ONE, gl.ONE);
              break;
            case SubtractiveBlending:
              gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
              break;
            case MultiplyBlending:
              gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.SRC_ALPHA);
              break;
            default:
              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              break;
          }
        } else {
          switch (blending) {
            case NormalBlending:
              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              break;
            case AdditiveBlending:
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
              break;
            case SubtractiveBlending:
              gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
              break;
            case MultiplyBlending:
              gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
              break;
            default:
              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              break;
          }
        }

        this.currentBlendSrc = null;
        this.currentBlendDst = null;
        this.currentBlendSrcAlpha = null;
        this.currentBlendDstAlpha = null;
        this.currentBlendMode = blending;
        this.currentPremultipledAlpha = premultipliedAlpha;
      }
      return;
    }

    // CustomBlending
    const eqAlpha = blendEquationAlpha ?? blendEquation;
    const srcAlpha = blendSrcAlpha ?? blendSrc;
    const dstAlpha = blendDstAlpha ?? blendDst;

    if (blendEquation !== this.currentBlendEquation || eqAlpha !== this.currentBlendEquationAlpha) {
      gl.blendEquationSeparate(
        this.equationToGL[blendEquation] ?? gl.FUNC_ADD,
        this.equationToGL[eqAlpha] ?? gl.FUNC_ADD,
      );
      this.currentBlendEquation = blendEquation;
      this.currentBlendEquationAlpha = eqAlpha;
    }

    if (
      blendSrc !== this.currentBlendSrc ||
      blendDst !== this.currentBlendDst ||
      srcAlpha !== this.currentBlendSrcAlpha ||
      dstAlpha !== this.currentBlendDstAlpha
    ) {
      gl.blendFuncSeparate(
        this.factorToGL[blendSrc] ?? gl.SRC_ALPHA,
        this.factorToGL[blendDst] ?? gl.ONE_MINUS_SRC_ALPHA,
        this.factorToGL[srcAlpha] ?? gl.ONE,
        this.factorToGL[dstAlpha] ?? gl.ONE_MINUS_SRC_ALPHA,
      );
      this.currentBlendSrc = blendSrc;
      this.currentBlendDst = blendDst;
      this.currentBlendSrcAlpha = srcAlpha;
      this.currentBlendDstAlpha = dstAlpha;
    }

    this.currentBlendMode = CustomBlending;
    this.currentPremultipledAlpha = premultipliedAlpha;
  }

  setBlending(
    blending: number,
    blendEquation?: number,
    blendSrc?: number,
    blendDst?: number,
    blendEquationAlpha?: number | null,
    blendSrcAlpha?: number | null,
    blendDstAlpha?: number | null,
    premultipliedAlpha?: boolean,
  ): void {
    this.setBlendMode(
      blending,
      blendEquation,
      blendSrc,
      blendDst,
      blendEquationAlpha,
      blendSrcAlpha,
      blendDstAlpha,
      premultipliedAlpha,
    );
  }

  setDepthTest(depthTest: boolean): void {
    if (this.currentDepthTest !== depthTest) {
      if (depthTest) {
        this.enable(this.gl.DEPTH_TEST);
      } else {
        this.disable(this.gl.DEPTH_TEST);
      }
      this.currentDepthTest = depthTest;
    }
  }

  setDepthWrite(depthWrite: boolean): void {
    if (this.currentDepthWrite !== depthWrite) {
      this.gl.depthMask(depthWrite);
      this.currentDepthWrite = depthWrite;
    }
  }

  setDepthFunc(depthFunc: number): void {
    if (this.currentDepthFunc === depthFunc) return;
    const gl = this.gl;
    switch (depthFunc) {
      case NeverDepth:
        gl.depthFunc(gl.NEVER);
        break;
      case AlwaysDepth:
        gl.depthFunc(gl.ALWAYS);
        break;
      case LessDepth:
        gl.depthFunc(gl.LESS);
        break;
      case LessEqualDepth:
        gl.depthFunc(gl.LEQUAL);
        break;
      case EqualDepth:
        gl.depthFunc(gl.EQUAL);
        break;
      case GreaterEqualDepth:
        gl.depthFunc(gl.GEQUAL);
        break;
      case GreaterDepth:
        gl.depthFunc(gl.GREATER);
        break;
      case NotEqualDepth:
        gl.depthFunc(gl.NOTEQUAL);
        break;
      default:
        gl.depthFunc(gl.LEQUAL);
        break;
    }
    this.currentDepthFunc = depthFunc;
  }

  setColorMask(colorWrite: boolean): void {
    if (this.currentColorMask !== colorWrite) {
      this.gl.colorMask(colorWrite, colorWrite, colorWrite, colorWrite);
      this.currentColorMask = colorWrite;
    }
  }

  setCullFace(cullFace: number): void {
    const gl = this.gl;
    if (cullFace !== CullFaceNone) {
      this.enable(gl.CULL_FACE);
      if (cullFace !== this.currentCullFace) {
        if (cullFace === CullFaceBack) {
          gl.cullFace(gl.BACK);
        } else if (cullFace === CullFaceFront) {
          gl.cullFace(gl.FRONT);
        } else {
          gl.cullFace(gl.FRONT_AND_BACK);
        }
      }
    } else {
      this.disable(gl.CULL_FACE);
    }
    this.currentCullFace = cullFace;
  }

  setFrontFace(frontFace: number): void {
    if (this.currentFrontFace !== frontFace) {
      this.gl.frontFace(frontFace);
      this.currentFrontFace = frontFace;
      this.currentFlipSided = frontFace === this.gl.CW;
    }
  }

  setFlipSided(flipSided: boolean): void {
    if (this.currentFlipSided !== flipSided) {
      const mode = flipSided ? this.gl.CW : this.gl.CCW;
      this.gl.frontFace(mode);
      this.currentFrontFace = mode;
      this.currentFlipSided = flipSided;
    }
  }

  setPolygonOffset(polygonOffset: boolean, factor = 0, units = 0): void {
    if (polygonOffset) {
      this.enable(this.gl.POLYGON_OFFSET_FILL);
      if (this.currentPolygonOffsetFactor !== factor || this.currentPolygonOffsetUnits !== units) {
        this.gl.polygonOffset(factor, units);
        this.currentPolygonOffsetFactor = factor;
        this.currentPolygonOffsetUnits = units;
      }
    } else {
      this.disable(this.gl.POLYGON_OFFSET_FILL);
    }
  }

  setLineWidth(width: number): void {
    if (this.currentLineWidth !== width) {
      this.gl.lineWidth(width);
      this.currentLineWidth = width;
    }
  }

  setMaterial(material: Material, frontFaceCW = false): void {
    const gl = this.gl;

    if (material.side === DoubleSide) {
      this.disable(gl.CULL_FACE);
      this.currentCullFace = CullFaceNone;
    } else {
      this.enable(gl.CULL_FACE);
      if (this.currentCullFace !== CullFaceBack) {
        gl.cullFace(gl.BACK);
        this.currentCullFace = CullFaceBack;
      }
    }

    let flipSided = material.side === BackSide;
    if (frontFaceCW) flipSided = !flipSided;
    this.setFlipSided(flipSided);

    if (material.blending === NormalBlending && material.transparent === false) {
      this.setBlendMode(NoBlending);
    } else {
      this.setBlendMode(
        material.blending,
        material.blendEquation,
        material.blendSrc,
        material.blendDst,
        material.blendEquationAlpha,
        material.blendSrcAlpha,
        material.blendDstAlpha,
        material.premultipliedAlpha,
      );
    }

    this.setDepthFunc(material.depthFunc);
    this.setDepthTest(material.depthTest);
    this.setDepthWrite(material.depthWrite);
    this.setColorMask(material.colorWrite);
    this.setPolygonOffset(material.polygonOffset, material.polygonOffsetFactor, material.polygonOffsetUnits);
  }

  setViewport(x: number, y: number, width: number, height: number): void {
    if (
      this.currentViewport.x !== x ||
      this.currentViewport.y !== y ||
      this.currentViewport.z !== width ||
      this.currentViewport.w !== height
    ) {
      this.gl.viewport(x, y, width, height);
      this.currentViewport.set(x, y, width, height);
    }
  }

  viewport(vec: Vector4): void {
    this.setViewport(vec.x, vec.y, vec.z, vec.w);
  }

  setScissor(x: number, y: number, width: number, height: number): void {
    if (
      this.currentScissor.x !== x ||
      this.currentScissor.y !== y ||
      this.currentScissor.z !== width ||
      this.currentScissor.w !== height
    ) {
      this.gl.scissor(x, y, width, height);
      this.currentScissor.set(x, y, width, height);
    }
  }

  scissor(vec: Vector4): void {
    this.setScissor(vec.x, vec.y, vec.z, vec.w);
  }

  setScissorTest(scissorTest: boolean): void {
    if (this.currentScissorTest !== scissorTest) {
      if (scissorTest) {
        this.enable(this.gl.SCISSOR_TEST);
      } else {
        this.disable(this.gl.SCISSOR_TEST);
      }
      this.currentScissorTest = scissorTest;
    }
  }

  setClearColor(r: number, g: number, b: number, a: number): void {
    if (
      this.currentClearColor.x !== r ||
      this.currentClearColor.y !== g ||
      this.currentClearColor.z !== b ||
      this.currentClearColor.w !== a
    ) {
      this.gl.clearColor(r, g, b, a);
      this.currentClearColor.set(r, g, b, a);
    }
  }

  setClearDepth(depth: number): void {
    if (this.currentClearDepth !== depth) {
      this.gl.clearDepth(depth);
      this.currentClearDepth = depth;
    }
  }

  setClearStencil(stencil: number): void {
    if (this.currentClearStencil !== stencil) {
      this.gl.clearStencil(stencil);
      this.currentClearStencil = stencil;
    }
  }

  activeTexture(webglSlot?: number): void {
    const gl = this.gl;
    const slot = webglSlot ?? gl.TEXTURE0;
    if (this.currentTextureSlot !== slot) {
      gl.activeTexture(slot);
      this.currentTextureSlot = slot;
    }
  }

  bindTexture(webglType: number, webglTexture: WebGLTexture | null, webglSlot?: number): void {
    const gl = this.gl;
    if (webglSlot !== undefined) {
      this.activeTexture(webglSlot);
    } else if (this.currentTextureSlot === null) {
      this.activeTexture(gl.TEXTURE0);
    }

    const slot = this.currentTextureSlot!;
    const bound = this.boundTextures[slot];
    if (bound === undefined || bound.type !== webglType || bound.texture !== webglTexture) {
      gl.bindTexture(webglType, webglTexture);
      this.boundTextures[slot] = { type: webglType, texture: webglTexture };
    }
  }

  bindFramebuffer(target: number, framebuffer: WebGLFramebuffer | null): boolean {
    const gl = this.gl;
    if (target === gl.FRAMEBUFFER) {
      if (
        this.currentBoundFramebuffers[gl.FRAMEBUFFER] !== framebuffer ||
        this.currentBoundFramebuffers[gl.READ_FRAMEBUFFER] !== framebuffer ||
        this.currentBoundFramebuffers[gl.DRAW_FRAMEBUFFER] !== framebuffer
      ) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        this.currentBoundFramebuffers[gl.FRAMEBUFFER] = framebuffer;
        this.currentBoundFramebuffers[gl.READ_FRAMEBUFFER] = framebuffer;
        this.currentBoundFramebuffers[gl.DRAW_FRAMEBUFFER] = framebuffer;
        return true;
      }
      return false;
    }

    if (this.currentBoundFramebuffers[target] !== framebuffer) {
      gl.bindFramebuffer(target, framebuffer);
      this.currentBoundFramebuffers[target] = framebuffer;
      if (target === gl.READ_FRAMEBUFFER || target === gl.DRAW_FRAMEBUFFER) {
        const readFb = this.currentBoundFramebuffers[gl.READ_FRAMEBUFFER];
        const drawFb = this.currentBoundFramebuffers[gl.DRAW_FRAMEBUFFER];
        if (readFb === drawFb && readFb !== undefined) {
          this.currentBoundFramebuffers[gl.FRAMEBUFFER] = readFb;
        } else {
          delete this.currentBoundFramebuffers[gl.FRAMEBUFFER];
        }
      }
      return true;
    }
    return false;
  }

  reset(): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.useProgram(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.enabledCapabilities = {};
    this.currentProgram = null;
    this.currentBlendMode = null;
    this.currentBlendEquation = null;
    this.currentBlendSrc = null;
    this.currentBlendDst = null;
    this.currentBlendEquationAlpha = null;
    this.currentBlendSrcAlpha = null;
    this.currentBlendDstAlpha = null;
    this.currentPremultipledAlpha = false;
    this.currentDepthTest = null;
    this.currentDepthWrite = null;
    this.currentDepthFunc = null;
    this.currentColorMask = null;
    this.currentCullFace = null;
    this.currentFrontFace = null;
    this.currentFlipSided = null;
    this.currentPolygonOffsetFactor = null;
    this.currentPolygonOffsetUnits = null;
    this.currentLineWidth = null;
    this.currentScissorTest = null;
    this.currentTextureSlot = null;
    this.boundTextures = {};
    this.currentBoundFramebuffers = {};
    this.currentClearDepth = null;
    this.currentClearStencil = null;
    this.currentViewport.set(-1, -1, -1, -1);
    this.currentScissor.set(-1, -1, -1, -1);
  }
}
