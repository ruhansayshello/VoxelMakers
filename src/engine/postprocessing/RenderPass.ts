import { Color, type ColorRepresentation } from '../math';
import type { Material } from '../materials/Material';
import type { Scene } from '../scenes/Scene';
import type { RenderCameraLike, WebGLRenderer } from '../renderers/WebGLRenderer';
import type { WebGLRenderTarget } from '../renderers/WebGLRenderTarget';
import { Pass } from './Pass';

export class RenderPass extends Pass {
  scene: Scene;
  camera: RenderCameraLike;
  overrideMaterial: Material | null;
  clearColor: Color | null;
  clearAlpha: number;
  clearDepth = false;

  private _oldClearColor = new Color();

  constructor(
    scene: Scene,
    camera: RenderCameraLike,
    overrideMaterial: Material | null = null,
    clearColor: ColorRepresentation | null = null,
    clearAlpha = 0,
  ) {
    super();

    this.scene = scene;
    this.camera = camera;
    this.overrideMaterial = overrideMaterial;
    this.clearColor = clearColor !== null ? new Color(clearColor) : null;
    this.clearAlpha = clearAlpha;

    this.clear = true;
    this.clearDepth = false;
    this.needsSwap = false;
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    _deltaTime?: number,
    _maskActive?: boolean,
  ): void {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    let oldClearAlpha = 1;
    let oldOverrideMaterial: typeof this.scene.overrideMaterial = null;

    if (this.overrideMaterial !== null) {
      oldOverrideMaterial = this.scene.overrideMaterial;
      this.scene.overrideMaterial = this.overrideMaterial;
    }

    if (this.clearColor !== null) {
      renderer.getClearColor(this._oldClearColor);
      oldClearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(this.clearColor, this.clearAlpha);
    }

    if (this.clearDepth) {
      renderer.clearDepth();
    }

    // Because needsSwap === false, RenderPass writes into readBuffer so the
    // immediately following ShaderPass reads readBuffer.texture without an extra swap.
    const target = this.renderToScreen ? null : (readBuffer ?? writeBuffer);
    renderer.setRenderTarget(target);

    if (this.clear === true) {
      renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }

    renderer.render(this.scene, this.camera);

    if (this.clearColor !== null) {
      renderer.setClearColor(this._oldClearColor, oldClearAlpha);
    }

    if (this.overrideMaterial !== null) {
      this.scene.overrideMaterial = oldOverrideMaterial;
    }

    renderer.autoClear = oldAutoClear;
  }
}
