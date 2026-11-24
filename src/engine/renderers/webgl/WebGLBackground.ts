import { Color, type ColorRepresentation } from '../../math';
import type { Scene } from '../../scenes/Scene';
import type { WebGLState } from './WebGLState';

export interface BackgroundRendererHost {
  autoClear: boolean;
  autoClearColor: boolean;
  autoClearDepth: boolean;
  autoClearStencil: boolean;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
}

export class WebGLBackground {
  private state: WebGLState;
  private clearColor = new Color(0x000000);
  private clearAlpha = 0;

  constructor(state: WebGLState, premultipliedAlpha = true) {
    this.state = state;
    this.premultipliedAlpha = premultipliedAlpha;
  }

  private premultipliedAlpha: boolean;

  getClearColor(target?: Color): Color {
    if (target) return target.copy(this.clearColor);
    return this.clearColor;
  }

  setClearColor(color: ColorRepresentation, alpha = 1): void {
    this.clearColor.set(color);
    this.clearAlpha = alpha;
    this.applyClearColor(this.clearColor, this.clearAlpha);
  }

  getClearAlpha(): number {
    return this.clearAlpha;
  }

  setClearAlpha(alpha: number): void {
    this.clearAlpha = alpha;
    this.applyClearColor(this.clearColor, this.clearAlpha);
  }

  private applyClearColor(color: Color, alpha: number): void {
    if (this.premultipliedAlpha) {
      this.state.setClearColor(color.r * alpha, color.g * alpha, color.b * alpha, alpha);
    } else {
      this.state.setClearColor(color.r, color.g, color.b, alpha);
    }
  }

  render(renderer: BackgroundRendererHost, scene: Scene): void {
    const background = scene.background;
    let forceClear = false;

    if (background instanceof Color) {
      this.applyClearColor(background, 1);
      forceClear = true;
    } else {
      this.applyClearColor(this.clearColor, this.clearAlpha);
    }

    if (renderer.autoClear || forceClear) {
      renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }
  }
}
