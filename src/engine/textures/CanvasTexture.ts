import { NoColorSpace, type ColorSpace } from '../math';
import {
  ClampToEdgeWrapping,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from '../renderers/webgl/constants';
import { Texture, UVMapping } from './Texture';

export class CanvasTexture extends Texture {
  readonly isCanvasTexture = true;

  constructor(
    canvas?: HTMLCanvasElement | OffscreenCanvas | null,
    mapping: number = UVMapping,
    wrapS: number = ClampToEdgeWrapping,
    wrapT: number = ClampToEdgeWrapping,
    magFilter: number = LinearFilter,
    minFilter: number = LinearFilter,
    format: number = RGBAFormat,
    type: number = UnsignedByteType,
    anisotropy = 1,
    colorSpace: ColorSpace = NoColorSpace,
  ) {
    super(
      (canvas ?? null) as HTMLCanvasElement | null,
      mapping,
      wrapS,
      wrapT,
      magFilter,
      minFilter,
      format,
      type,
      anisotropy,
      colorSpace,
    );
    this.needsUpdate = true;
  }
}
