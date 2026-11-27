import { FloatType } from '../../core/constants';
import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapLinearFilter,
  NearestMipmapNearestFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from './constants';
import type { WebGLProperties } from './WebGLProperties';
import type { WebGLState } from './WebGLState';
import type { TextureBinder } from './WebGLUniforms';

export interface RenderTextureLike {
  isTexture?: boolean;
  isDataTexture?: boolean;
  isData3DTexture?: boolean;
  image?: {
    data?: ArrayBufferView | null;
    width?: number;
    height?: number;
    depth?: number;
  } | TexImageSource | null;
  width?: number;
  height?: number;
  format?: number;
  type?: number;
  wrapS?: number;
  wrapT?: number;
  wrapR?: number;
  magFilter?: number;
  minFilter?: number;
  generateMipmaps?: boolean;
  flipY?: boolean;
  premultiplyAlpha?: boolean;
  unpackAlignment?: number;
  version?: number;
  addEventListener?(type: string, listener: () => void): void;
}

export interface RenderTargetLike {
  isWebGLRenderTarget?: boolean;
  width: number;
  height: number;
  texture: RenderTextureLike;
  depthBuffer?: boolean;
  stencilBuffer?: boolean;
  depthTexture?: RenderTextureLike | null;
  viewport?: { x: number; y: number; z: number; w: number };
  scissor?: { x: number; y: number; z: number; w: number };
  scissorTest?: boolean;
  addEventListener?(type: string, listener: () => void): void;
}

interface TextureProps {
  __webglTexture?: WebGLTexture | null;
  __version?: number;
  __init?: boolean;
  __isRenderTargetTexture?: boolean;
}

interface RenderTargetProps {
  __webglFramebuffer?: WebGLFramebuffer | null;
  __webglDepthbuffer?: WebGLRenderbuffer | null;
  __init?: boolean;
  __width?: number;
  __height?: number;
}

function mapWrap(gl: WebGL2RenderingContext, wrap?: number): number {
  if (wrap === RepeatWrapping) return gl.REPEAT;
  if (wrap === MirroredRepeatWrapping) return gl.MIRRORED_REPEAT;
  if (wrap === ClampToEdgeWrapping) return gl.CLAMP_TO_EDGE;
  return gl.CLAMP_TO_EDGE;
}

function mapFilter(gl: WebGL2RenderingContext, filter?: number): number {
  switch (filter) {
    case NearestFilter:
      return gl.NEAREST;
    case NearestMipmapNearestFilter:
      return gl.NEAREST_MIPMAP_NEAREST;
    case NearestMipmapLinearFilter:
      return gl.NEAREST_MIPMAP_LINEAR;
    case LinearFilter:
      return gl.LINEAR;
    case LinearMipmapNearestFilter:
      return gl.LINEAR_MIPMAP_NEAREST;
    case LinearMipmapLinearFilter:
      return gl.LINEAR_MIPMAP_LINEAR;
    default:
      return gl.LINEAR;
  }
}

function mapFormat(gl: WebGL2RenderingContext, format?: number): { internalFormat: number; format: number } {
  if (format === RedFormat) return { internalFormat: gl.R8, format: gl.RED };
  return { internalFormat: gl.RGBA8, format: gl.RGBA };
}

function mapType(gl: WebGL2RenderingContext, type?: number): number {
  if (type === FloatType) return gl.FLOAT;
  if (type === HalfFloatType) return gl.HALF_FLOAT;
  if (type === UnsignedByteType) return gl.UNSIGNED_BYTE;
  return gl.UNSIGNED_BYTE;
}

export class WebGLTextures implements TextureBinder {
  private gl: WebGL2RenderingContext;
  private state: WebGLState;
  private properties: WebGLProperties;
  private memory: { textures: number };
  private maxTextures: number;
  private textureUnits = 0;

  private activeTextures = new Set<WebGLTexture>();
  private activeFramebuffers = new Set<WebGLFramebuffer>();
  private activeRenderbuffers = new Set<WebGLRenderbuffer>();
  private canRenderFloat = false;
  private canRenderHalfFloat = false;

  constructor(
    gl: WebGL2RenderingContext,
    state: WebGLState,
    properties: WebGLProperties,
    memory: { textures: number },
    maxTextures = 16,
  ) {
    this.gl = gl;
    this.state = state;
    this.properties = properties;
    this.memory = memory;
    this.maxTextures = maxTextures;

    if (typeof gl.getExtension === 'function') {
      const extFloat = gl.getExtension('EXT_color_buffer_float');
      const extHalfFloat = gl.getExtension('EXT_color_buffer_half_float');
      this.canRenderFloat = Boolean(extFloat);
      this.canRenderHalfFloat = Boolean(extFloat || extHalfFloat);
    } else {
      // Headless/unit-test mock GL contexts without getExtension: preserve requested float formats
      this.canRenderFloat = true;
      this.canRenderHalfFloat = true;
    }
  }

  resetTextureUnits(): void {
    this.textureUnits = 0;
  }

  allocateTextureUnit(): number {
    const unit = this.textureUnits;
    if (unit >= this.maxTextures) {
      return this.maxTextures - 1;
    }
    this.textureUnits++;
    return unit;
  }

  setTexture2D(texture: unknown, slot: number): void {
    const gl = this.gl;
    if (!texture || typeof texture !== 'object') {
      this.state.bindTexture(gl.TEXTURE_2D, null, gl.TEXTURE0 + slot);
      return;
    }

    const tex = texture as RenderTextureLike;
    const props = this.properties.get<TextureProps>(tex);

    if (props.__isRenderTargetTexture && props.__webglTexture) {
      this.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture, gl.TEXTURE0 + slot);
      return;
    }

    if (tex.version !== undefined && tex.version > 0 && props.__version !== tex.version) {
      this.uploadTexture2D(tex, props, slot);
    } else if (!props.__webglTexture) {
      this.uploadTexture2D(tex, props, slot);
    } else {
      this.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture, gl.TEXTURE0 + slot);
    }
  }

  setTexture3D(texture: unknown, slot: number): void {
    const gl = this.gl;
    if (!texture || typeof texture !== 'object') {
      this.state.bindTexture(gl.TEXTURE_3D, null, gl.TEXTURE0 + slot);
      return;
    }

    const tex = texture as RenderTextureLike;
    const props = this.properties.get<TextureProps>(tex);

    if (!props.__webglTexture || (tex.version !== undefined && props.__version !== tex.version)) {
      if (!props.__webglTexture) {
        props.__webglTexture = gl.createTexture();
        if (props.__webglTexture) {
          this.activeTextures.add(props.__webglTexture);
          this.memory.textures++;
        }
        if (!props.__init && typeof tex.addEventListener === 'function') {
          props.__init = true;
          tex.addEventListener('dispose', () => this.deallocateTexture(tex));
        }
      }
      this.state.bindTexture(gl.TEXTURE_3D, props.__webglTexture ?? null, gl.TEXTURE0 + slot);

      const img = tex.image as { data?: ArrayBufferView | null; width?: number; height?: number; depth?: number } | null;
      const w = img?.width ?? 1;
      const h = img?.height ?? 1;
      const d = img?.depth ?? 1;
      const fmt = mapFormat(gl, tex.format ?? RGBAFormat);
      const glType = mapType(gl, tex.type);

      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, mapWrap(gl, tex.wrapS));
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, mapWrap(gl, tex.wrapT));
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, mapWrap(gl, tex.wrapR));
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, mapFilter(gl, tex.magFilter ?? NearestFilter));
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, mapFilter(gl, tex.minFilter ?? NearestFilter));

      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        fmt.internalFormat,
        w,
        h,
        d,
        0,
        fmt.format,
        glType,
        img?.data ?? null,
      );
      props.__version = tex.version ?? 0;
    } else {
      this.state.bindTexture(gl.TEXTURE_3D, props.__webglTexture, gl.TEXTURE0 + slot);
    }
  }

  private uploadTexture2D(tex: RenderTextureLike, props: TextureProps, slot: number): void {
    const gl = this.gl;

    if (!props.__webglTexture) {
      props.__webglTexture = gl.createTexture();
      if (props.__webglTexture) {
        this.activeTextures.add(props.__webglTexture);
        this.memory.textures++;
      }
      if (!props.__init && typeof tex.addEventListener === 'function') {
        props.__init = true;
        tex.addEventListener('dispose', () => this.deallocateTexture(tex));
      }
    }

    this.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture ?? null, gl.TEXTURE0 + slot);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, tex.flipY !== false ? 1 : 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, tex.premultiplyAlpha ? 1 : 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, tex.unpackAlignment ?? 4);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mapWrap(gl, tex.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mapWrap(gl, tex.wrapT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mapFilter(gl, tex.magFilter ?? LinearFilter));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mapFilter(gl, tex.minFilter ?? LinearFilter));

    const fmt = mapFormat(gl, tex.format ?? RGBAFormat);
    const glType = mapType(gl, tex.type);
    const internalFormat = glType === gl.FLOAT ? gl.RGBA32F : glType === gl.HALF_FLOAT ? gl.RGBA16F : fmt.internalFormat;

    const image = tex.image;
    if (tex.isDataTexture || (image && typeof image === 'object' && 'data' in image)) {
      const dataImg = image as { data?: ArrayBufferView | null; width?: number; height?: number };
      const w = dataImg?.width ?? tex.width ?? 1;
      const h = dataImg?.height ?? tex.height ?? 1;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, fmt.format, glType, dataImg?.data ?? null);
    } else if (image) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, fmt.format, glType, image as TexImageSource);
    } else {
      const w = tex.width ?? 1;
      const h = tex.height ?? 1;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, fmt.format, glType, null);
    }

    if (tex.generateMipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    props.__version = tex.version ?? 0;
  }

  setupRenderTarget(renderTarget: RenderTargetLike): WebGLFramebuffer | null {
    const gl = this.gl;
    const rtProps = this.properties.get<RenderTargetProps>(renderTarget);
    const tex = renderTarget.texture;
    const texProps = this.properties.get<TextureProps>(tex);

    const resolveAttachmentFormat = () => {
      const fmt = mapFormat(gl, tex.format ?? RGBAFormat);
      let glType = mapType(gl, tex.type);
      if (glType === gl.FLOAT && !this.canRenderFloat) {
        glType = gl.UNSIGNED_BYTE;
      } else if (glType === gl.HALF_FLOAT && !this.canRenderHalfFloat) {
        glType = gl.UNSIGNED_BYTE;
      }
      const internalFormat =
        glType === gl.FLOAT ? gl.RGBA32F : glType === gl.HALF_FLOAT ? gl.RGBA16F : fmt.internalFormat;
      return { fmt, glType, internalFormat };
    };

    if (rtProps.__webglFramebuffer) {
      if (rtProps.__width !== renderTarget.width || rtProps.__height !== renderTarget.height) {
        rtProps.__width = renderTarget.width;
        rtProps.__height = renderTarget.height;
        const { fmt, glType, internalFormat } = resolveAttachmentFormat();
        if (texProps.__webglTexture) {
          this.state.bindTexture(gl.TEXTURE_2D, texProps.__webglTexture);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            internalFormat,
            renderTarget.width,
            renderTarget.height,
            0,
            fmt.format,
            glType,
            null,
          );
        }
        if (rtProps.__webglDepthbuffer) {
          gl.bindRenderbuffer(gl.RENDERBUFFER, rtProps.__webglDepthbuffer);
          gl.renderbufferStorage(
            gl.RENDERBUFFER,
            renderTarget.stencilBuffer ? gl.DEPTH24_STENCIL8 : gl.DEPTH_COMPONENT16,
            renderTarget.width,
            renderTarget.height,
          );
          gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        }
      }
      return rtProps.__webglFramebuffer;
    }

    const fb = gl.createFramebuffer();
    if (!fb) return null;

    this.activeFramebuffers.add(fb);
    rtProps.__webglFramebuffer = fb;
    rtProps.__width = renderTarget.width;
    rtProps.__height = renderTarget.height;

    if (!texProps.__webglTexture) {
      texProps.__webglTexture = gl.createTexture();
      if (texProps.__webglTexture) {
        this.activeTextures.add(texProps.__webglTexture);
        this.memory.textures++;
      }
    }
    texProps.__isRenderTargetTexture = true;
    texProps.__version = tex.version ?? 0;

    const { fmt, glType, internalFormat } = resolveAttachmentFormat();

    this.state.bindTexture(gl.TEXTURE_2D, texProps.__webglTexture ?? null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mapWrap(gl, tex.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mapWrap(gl, tex.wrapT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mapFilter(gl, tex.magFilter ?? LinearFilter));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mapFilter(gl, tex.minFilter ?? LinearFilter));
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      renderTarget.width,
      renderTarget.height,
      0,
      fmt.format,
      glType,
      null,
    );

    this.state.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texProps.__webglTexture ?? null, 0);

    if (renderTarget.depthTexture) {
      const depthTex = renderTarget.depthTexture;
      const depthTexProps = this.properties.get<TextureProps>(depthTex);
      if (!depthTexProps.__webglTexture) {
        depthTexProps.__webglTexture = gl.createTexture();
        if (depthTexProps.__webglTexture) {
          this.activeTextures.add(depthTexProps.__webglTexture);
          this.memory.textures++;
        }
        if (!depthTexProps.__init && typeof depthTex.addEventListener === 'function') {
          depthTexProps.__init = true;
          depthTex.addEventListener('dispose', () => this.deallocateTexture(depthTex));
        }
      }
      this.state.bindTexture(gl.TEXTURE_2D, depthTexProps.__webglTexture ?? null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      if (renderTarget.stencilBuffer) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.DEPTH24_STENCIL8,
          renderTarget.width,
          renderTarget.height,
          0,
          gl.DEPTH_STENCIL,
          gl.UNSIGNED_INT_24_8,
          null,
        );
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.DEPTH_STENCIL_ATTACHMENT,
          gl.TEXTURE_2D,
          depthTexProps.__webglTexture ?? null,
          0,
        );
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.DEPTH_COMPONENT24,
          renderTarget.width,
          renderTarget.height,
          0,
          gl.DEPTH_COMPONENT,
          gl.UNSIGNED_INT,
          null,
        );
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          gl.TEXTURE_2D,
          depthTexProps.__webglTexture ?? null,
          0,
        );
      }
    } else if (renderTarget.depthBuffer !== false) {
      const rb = gl.createRenderbuffer();
      if (rb) {
        this.activeRenderbuffers.add(rb);
        rtProps.__webglDepthbuffer = rb;
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        if (renderTarget.stencilBuffer) {
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, renderTarget.width, renderTarget.height);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
        } else {
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, renderTarget.width, renderTarget.height);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
        }
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      }
    }

    if (!rtProps.__init && typeof renderTarget.addEventListener === 'function') {
      rtProps.__init = true;
      renderTarget.addEventListener('dispose', () => this.deallocateRenderTarget(renderTarget));
    }

    return fb;
  }

  getRenderTargetFramebuffer(renderTarget: RenderTargetLike): WebGLFramebuffer | null {
    const rtProps = this.properties.get<RenderTargetProps>(renderTarget);
    return rtProps.__webglFramebuffer ?? null;
  }

  getWebGLTexture(texture: RenderTextureLike): WebGLTexture | null {
    const props = this.properties.get<TextureProps>(texture);
    return props.__webglTexture ?? null;
  }

  deallocateTexture(texture: RenderTextureLike): void {
    const props = this.properties.get<TextureProps>(texture);
    if (props.__webglTexture) {
      this.gl.deleteTexture(props.__webglTexture);
      this.activeTextures.delete(props.__webglTexture);
      this.memory.textures = Math.max(0, this.memory.textures - 1);
      props.__webglTexture = null;
    }
    this.properties.remove(texture);
  }

  deallocateRenderTarget(renderTarget: RenderTargetLike): void {
    const props = this.properties.get<RenderTargetProps>(renderTarget);
    if (props.__webglFramebuffer) {
      this.gl.deleteFramebuffer(props.__webglFramebuffer);
      this.activeFramebuffers.delete(props.__webglFramebuffer);
      props.__webglFramebuffer = null;
    }
    if (props.__webglDepthbuffer) {
      this.gl.deleteRenderbuffer(props.__webglDepthbuffer);
      this.activeRenderbuffers.delete(props.__webglDepthbuffer);
      props.__webglDepthbuffer = null;
    }
    if (renderTarget.texture) {
      this.deallocateTexture(renderTarget.texture);
    }
    if (renderTarget.depthTexture) {
      this.deallocateTexture(renderTarget.depthTexture);
    }
    this.properties.remove(renderTarget);
  }

  dispose(): void {
    for (const tex of this.activeTextures) this.gl.deleteTexture(tex);
    for (const fb of this.activeFramebuffers) this.gl.deleteFramebuffer(fb);
    for (const rb of this.activeRenderbuffers) this.gl.deleteRenderbuffer(rb);
    this.activeTextures.clear();
    this.activeFramebuffers.clear();
    this.activeRenderbuffers.clear();
    this.memory.textures = 0;
  }
}
