import { NoColorSpace, Vector4, type ColorSpace } from '../math';
import { EventDispatcher } from '../core/EventDispatcher';
import {
  ClampToEdgeWrapping,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from './webgl/constants';
import { Texture, UVMapping } from '../textures/Texture';
import type { DepthTexture } from '../textures/DepthTexture';

export interface WebGLRenderTargetOptions {
  wrapS?: number;
  wrapT?: number;
  magFilter?: number;
  minFilter?: number;
  generateMipmaps?: boolean;
  format?: number;
  type?: number;
  anisotropy?: number;
  colorSpace?: ColorSpace;
  internalFormat?: string | null;
  depthBuffer?: boolean;
  stencilBuffer?: boolean;
  depth?: boolean;
  stencil?: boolean;
  depthTexture?: DepthTexture | Texture | null;
  samples?: number;
}

export class WebGLRenderTarget extends EventDispatcher {
  readonly isWebGLRenderTarget = true;

  width: number;
  height: number;

  scissor: Vector4;
  scissorTest = false;
  viewport: Vector4;

  texture: Texture;
  depthBuffer: boolean;
  stencilBuffer: boolean;
  depthTexture: DepthTexture | Texture | null;
  samples: number;

  constructor(width = 1, height = 1, options: WebGLRenderTargetOptions = {}) {
    super();

    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));

    this.scissor = new Vector4(0, 0, this.width, this.height);
    this.viewport = new Vector4(0, 0, this.width, this.height);

    const tex = new Texture(
      { data: null, width: this.width, height: this.height },
      UVMapping,
      options.wrapS ?? ClampToEdgeWrapping,
      options.wrapT ?? ClampToEdgeWrapping,
      options.magFilter ?? LinearFilter,
      options.minFilter ?? LinearFilter,
      options.format ?? RGBAFormat,
      options.type ?? UnsignedByteType,
      options.anisotropy ?? 1,
      options.colorSpace ?? NoColorSpace,
    );

    tex.generateMipmaps = options.generateMipmaps ?? false;
    tex.internalFormat = options.internalFormat ?? null;
    tex.flipY = false;

    this.texture = tex;
    this.depthBuffer = options.depthBuffer ?? options.depth ?? true;
    this.stencilBuffer = options.stencilBuffer ?? options.stencil ?? false;
    this.depthTexture = options.depthTexture ?? null;
    this.samples = options.samples ?? 0;
  }

  get depth(): boolean {
    return this.depthBuffer;
  }

  set depth(value: boolean) {
    this.depthBuffer = value;
  }

  get stencil(): boolean {
    return this.stencilBuffer;
  }

  set stencil(value: boolean) {
    this.stencilBuffer = value;
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    if (this.width !== w || this.height !== h) {
      this.width = w;
      this.height = h;

      this.texture.image = { data: null, width: w, height: h };
      if (this.depthTexture !== null) {
        this.depthTexture.image = { data: null, width: w, height: h };
      }

      this.dispose();
    }

    this.viewport.set(0, 0, w, h);
    this.scissor.set(0, 0, w, h);
  }

  clone(): WebGLRenderTarget {
    return new WebGLRenderTarget(this.width, this.height).copy(this);
  }

  copy(source: WebGLRenderTarget): this {
    this.width = source.width;
    this.height = source.height;

    this.viewport.copy(source.viewport);
    this.scissor.copy(source.scissor);
    this.scissorTest = source.scissorTest;

    this.texture = source.texture.clone();
    this.texture.image = { data: null, width: this.width, height: this.height };

    this.depthBuffer = source.depthBuffer;
    this.stencilBuffer = source.stencilBuffer;
    this.depthTexture = source.depthTexture !== null ? source.depthTexture.clone() : null;
    this.samples = source.samples;

    return this;
  }

  dispose(): void {
    this.dispatchEvent({ type: 'dispose' });
  }
}
