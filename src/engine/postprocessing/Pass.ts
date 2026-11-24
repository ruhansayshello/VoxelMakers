import type { WebGLRenderer } from '../renderers/WebGLRenderer';
import type { WebGLRenderTarget } from '../renderers/WebGLRenderTarget';
export { FullScreenQuad } from './FullScreenQuad';

export class Pass {
  enabled = true;
  needsSwap = false;
  clear = false;
  renderToScreen = false;

  setSize(_width: number, _height: number): void {}

  render(
    _renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget,
    _readBuffer: WebGLRenderTarget,
    _deltaTime?: number,
    _maskActive?: boolean,
  ): void {
    throw new Error('Pass: subclasses must implement render().');
  }

  dispose(): void {}
}
