import { cloneUniforms, ShaderMaterial, type IUniform } from '../materials/ShaderMaterial';
import type { WebGLRenderer } from '../renderers/WebGLRenderer';
import type { WebGLRenderTarget } from '../renderers/WebGLRenderTarget';
import type { ShaderDefinition } from './CopyShader';
import { FullScreenQuad } from './FullScreenQuad';
import { Pass } from './Pass';

export class ShaderPass extends Pass {
  textureID: string;
  uniforms: Record<string, IUniform>;
  material: ShaderMaterial;
  fsQuad: FullScreenQuad;

  constructor(shader: ShaderMaterial | ShaderDefinition, textureID = 'tDiffuse') {
    super();

    this.textureID = textureID;
    this.needsSwap = true;

    if (shader instanceof ShaderMaterial) {
      this.uniforms = shader.uniforms;
      this.material = shader;
    } else {
      this.uniforms = cloneUniforms(shader.uniforms);
      this.material = new ShaderMaterial({
        name: shader.name,
        defines: shader.defines ? { ...shader.defines } : {},
        uniforms: this.uniforms,
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader,
      });
    }

    this.fsQuad = new FullScreenQuad(this.material);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    _deltaTime?: number,
    _maskActive?: boolean,
  ): void {
    if (this.uniforms[this.textureID] !== undefined) {
      this.uniforms[this.textureID].value = readBuffer.texture;
    }

    this.fsQuad.material = this.material;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) {
        renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      }
      this.fsQuad.render(renderer);
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
