import { Vector2 } from '../math';
import { Clock } from '../core/Clock';
import { HalfFloatType, LinearFilter, RGBAFormat } from '../renderers/webgl/constants';
import type { WebGLRenderer } from '../renderers/WebGLRenderer';
import { WebGLRenderTarget } from '../renderers/WebGLRenderTarget';
import { CopyShader } from './CopyShader';
import type { Pass } from './Pass';
import { ShaderPass } from './ShaderPass';

export class EffectComposer {
  renderer: WebGLRenderer;
  renderTarget1: WebGLRenderTarget;
  renderTarget2: WebGLRenderTarget;
  writeBuffer: WebGLRenderTarget;
  readBuffer: WebGLRenderTarget;
  renderTargetDepth: WebGLRenderTarget | null = null;

  passes: Pass[] = [];
  copyPass: ShaderPass;
  clock: Clock;

  autoClear = false;
  renderToScreen = true;
  /**
   * Voxel-specific optimization: when true and the final pass renders into an
   * off-screen buffer instead of directly to screen, copy to the default
   * framebuffer via hardware gl.blitFramebuffer instead of a full-screen quad draw.
   */
  useBlitToScreen = true;

  private _pixelRatio: number;
  private _width: number;
  private _height: number;

  constructor(renderer: WebGLRenderer, renderTarget?: WebGLRenderTarget) {
    this.renderer = renderer;

    this._pixelRatio = renderer.getPixelRatio();

    if (renderTarget === undefined) {
      const size = renderer.getSize(new Vector2());
      this._width = Math.max(1, size.width);
      this._height = Math.max(1, size.height);

      // Pre-allocate ping-pong render targets once at startup (never reallocated per frame)
      this.renderTarget1 = new WebGLRenderTarget(
        Math.max(1, Math.floor(this._width * this._pixelRatio)),
        Math.max(1, Math.floor(this._height * this._pixelRatio)),
        {
          minFilter: LinearFilter,
          magFilter: LinearFilter,
          format: RGBAFormat,
          type: HalfFloatType,
          depthBuffer: true,
        },
      );
    } else {
      this._width = renderTarget.width;
      this._height = renderTarget.height;
      this.renderTarget1 = renderTarget;
    }

    this.renderTarget2 = this.renderTarget1.clone();
    this.writeBuffer = this.renderTarget1;
    this.readBuffer = this.renderTarget2;

    this.copyPass = new ShaderPass(CopyShader);
    this.clock = new Clock();
  }

  get renderingToScreen(): boolean {
    return this.renderToScreen;
  }

  set renderingToScreen(value: boolean) {
    this.renderToScreen = value;
  }

  swapBuffers(): void {
    const tmp = this.readBuffer;
    this.readBuffer = this.writeBuffer;
    this.writeBuffer = tmp;
  }

  addPass(pass: Pass): void {
    this.passes.push(pass);
    pass.setSize(
      Math.max(1, Math.floor(this._width * this._pixelRatio)),
      Math.max(1, Math.floor(this._height * this._pixelRatio)),
    );
  }

  insertPass(pass: Pass, index: number): void {
    this.passes.splice(index, 0, pass);
    pass.setSize(
      Math.max(1, Math.floor(this._width * this._pixelRatio)),
      Math.max(1, Math.floor(this._height * this._pixelRatio)),
    );
  }

  removePass(pass: Pass): void {
    const idx = this.passes.indexOf(pass);
    if (idx !== -1) {
      this.passes.splice(idx, 1);
    }
  }

  getEnabledPasses(): Pass[] {
    const enabled: Pass[] = [];
    for (let i = 0; i < this.passes.length; i++) {
      if (this.passes[i].enabled) {
        enabled.push(this.passes[i]);
      }
    }
    return enabled;
  }

  isLastEnabledPass(passIndex: number): boolean {
    for (let i = passIndex + 1; i < this.passes.length; i++) {
      if (this.passes[i].enabled) {
        return false;
      }
    }
    return true;
  }

  render(deltaTime?: number): void {
    const dt = deltaTime === undefined ? this.clock.getDelta() : deltaTime;

    const currentRenderTarget = this.renderer.getRenderTarget();
    const maskActive = false;

    // Locate last enabled pass once (O(N), zero allocations)
    let lastEnabledIndex = -1;
    for (let i = this.passes.length - 1; i >= 0; i--) {
      if (this.passes[i].enabled) {
        lastEnabledIndex = i;
        break;
      }
    }

    if (lastEnabledIndex === -1) return;

    let renderedFinalToScreen = false;

    for (let i = 0; i < this.passes.length; i++) {
      const pass = this.passes[i];
      // Optimization: completely skip disabled passes without invoking render()
      if (pass.enabled === false) continue;

      const isLast = i === lastEnabledIndex;
      const shouldRenderDirectToScreen = this.renderToScreen && isLast;
      pass.renderToScreen = shouldRenderDirectToScreen;

      pass.render(this.renderer, this.writeBuffer, this.readBuffer, dt, maskActive);

      if (pass.renderToScreen) {
        renderedFinalToScreen = true;
      }

      if (pass.needsSwap) {
        this.swapBuffers();
      }
    }

    // Optimization: if final enabled pass rendered into an off-screen target while
    // composer targets the screen, prefer hardware WebGL2 gl.blitFramebuffer over copyPass.
    if (this.renderToScreen && !renderedFinalToScreen) {
      const blitted = this.useBlitToScreen && this.renderer.blitToScreen(this.readBuffer);
      if (!blitted) {
        this.copyPass.renderToScreen = true;
        this.copyPass.render(this.renderer, this.writeBuffer, this.readBuffer, dt, maskActive);
      }
    }

    this.renderer.setRenderTarget(currentRenderTarget);
  }

  /**
   * Convenience method to copy the current readBuffer directly to screen via
   * WebGL2 gl.blitFramebuffer (falling back to CopyShader if unavailable).
   */
  presentToScreen(): boolean {
    if (this.useBlitToScreen && this.renderer.blitToScreen(this.readBuffer)) {
      return true;
    }
    this.copyPass.renderToScreen = true;
    this.copyPass.render(this.renderer, this.writeBuffer, this.readBuffer, 0, false);
    return false;
  }

  reset(renderTarget?: WebGLRenderTarget): void {
    if (renderTarget === undefined) {
      const size = this.renderer.getSize(new Vector2());
      this._pixelRatio = this.renderer.getPixelRatio();
      this._width = Math.max(1, size.width);
      this._height = Math.max(1, size.height);

      const rt = this.renderTarget1.clone();
      rt.setSize(
        Math.max(1, Math.floor(this._width * this._pixelRatio)),
        Math.max(1, Math.floor(this._height * this._pixelRatio)),
      );
      this.renderTarget1.dispose();
      this.renderTarget2.dispose();
      this.renderTarget1 = rt;
    } else {
      if (this.renderTarget1 !== renderTarget) {
        this.renderTarget1.dispose();
      }
      this.renderTarget2.dispose();
      this.renderTarget1 = renderTarget;
    }

    this.renderTarget2 = this.renderTarget1.clone();
    this.writeBuffer = this.renderTarget1;
    this.readBuffer = this.renderTarget2;
  }

  setSize(width: number, height: number): void {
    this._width = Math.max(1, width);
    this._height = Math.max(1, height);

    const effectiveWidth = Math.max(1, Math.floor(this._width * this._pixelRatio));
    const effectiveHeight = Math.max(1, Math.floor(this._height * this._pixelRatio));

    this.renderTarget1.setSize(effectiveWidth, effectiveHeight);
    this.renderTarget2.setSize(effectiveWidth, effectiveHeight);
    if (this.renderTargetDepth !== null) {
      this.renderTargetDepth.setSize(effectiveWidth, effectiveHeight);
    }

    for (let i = 0; i < this.passes.length; i++) {
      this.passes[i].setSize(effectiveWidth, effectiveHeight);
    }
  }

  setPixelRatio(pixelRatio: number): void {
    this._pixelRatio = pixelRatio;
    this.setSize(this._width, this._height);
  }

  dispose(): void {
    this.renderTarget1.dispose();
    this.renderTarget2.dispose();
    if (this.renderTargetDepth !== null) {
      this.renderTargetDepth.dispose();
    }
    this.copyPass.dispose();
  }
}
