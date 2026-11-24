import { SRGBColorSpace } from '../math';
import { ShaderMaterial, type IUniform } from '../materials/ShaderMaterial';
import {
  ACESFilmicToneMapping,
  CineonToneMapping,
  LinearToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
} from '../renderers/webgl/constants';
import type { WebGLRenderer } from '../renderers/WebGLRenderer';
import type { WebGLRenderTarget } from '../renderers/WebGLRenderTarget';
import { FullScreenQuad } from './FullScreenQuad';
import { Pass } from './Pass';

const OUTPUT_VERTEX_SHADER = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const OUTPUT_FRAGMENT_SHADER = `uniform sampler2D tDiffuse;
uniform float toneMappingExposure;
uniform int uToneMapping;
uniform int uToSRGB;
varying vec2 vUv;

vec3 applyToneMapping(vec3 color, int mode, float exposure) {
  if (mode == 1) {
    return color * exposure;
  } else if (mode == 2) {
    color *= exposure;
    return clamp(color / (vec3(1.0) + color), 0.0, 1.0);
  } else if (mode == 3) {
    color *= exposure;
    color = max(vec3(0.0), color - 0.004);
    return pow((color * (6.2 * color + 0.5)) / (color * (6.2 * color + 1.7) + 0.06), vec3(2.2));
  } else if (mode == 4) {
    color *= exposure / 0.6;
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
  }
  return color;
}

vec3 linearToSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec3 col = applyToneMapping(texel.rgb, uToneMapping, toneMappingExposure);
  if (uToSRGB == 1) {
    col = linearToSRGB(col);
  }
  gl_FragColor = vec4(col, texel.a);
}`;

function mapToneMappingMode(toneMapping: number): number {
  switch (toneMapping) {
    case LinearToneMapping:
      return 1;
    case ReinhardToneMapping:
      return 2;
    case CineonToneMapping:
      return 3;
    case ACESFilmicToneMapping:
      return 4;
    case NoToneMapping:
    default:
      return 0;
  }
}

export class OutputPass extends Pass {
  textureID = 'tDiffuse';
  toneMapping: number = NoToneMapping;
  uniforms: Record<string, IUniform>;
  material: ShaderMaterial;
  fsQuad: FullScreenQuad;

  private _outputColorSpace: string | null = null;

  constructor() {
    super();
    this.needsSwap = true;

    this.uniforms = {
      tDiffuse: { value: null },
      toneMappingExposure: { value: 1.0 },
      uToneMapping: { value: 0 },
      uToSRGB: { value: 1 },
    };

    this.material = new ShaderMaterial({
      name: 'OutputShader',
      uniforms: this.uniforms,
      vertexShader: OUTPUT_VERTEX_SHADER,
      fragmentShader: OUTPUT_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });

    this.fsQuad = new FullScreenQuad(this.material);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    _deltaTime?: number,
    _maskActive?: boolean,
  ): void {
    this.uniforms[this.textureID].value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;

    if (
      this._outputColorSpace !== renderer.outputColorSpace ||
      this.toneMapping !== renderer.toneMapping
    ) {
      this._outputColorSpace = renderer.outputColorSpace;
      this.toneMapping = renderer.toneMapping;
      this.uniforms.uToneMapping.value = mapToneMappingMode(this.toneMapping);
      this.uniforms.uToSRGB.value = this._outputColorSpace === SRGBColorSpace ? 1 : 0;
    }

    if (this.renderToScreen === true) {
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
