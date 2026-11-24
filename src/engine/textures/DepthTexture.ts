import {
  ClampToEdgeWrapping,
  DepthFormat,
  DepthStencilFormat,
  NearestFilter,
  UnsignedInt248Type,
  UnsignedIntType,
} from '../renderers/webgl/constants';
import { Texture, UVMapping, type DataTextureImage } from './Texture';

export class DepthTexture extends Texture {
  readonly isDepthTexture = true;

  declare image: DataTextureImage;

  constructor(
    width = 1,
    height = 1,
    type?: number,
    mapping: number = UVMapping,
    wrapS: number = ClampToEdgeWrapping,
    wrapT: number = ClampToEdgeWrapping,
    magFilter: number = NearestFilter,
    minFilter: number = NearestFilter,
    anisotropy = 1,
    format: number = DepthFormat,
  ) {
    const resolvedType =
      type ?? (format === DepthStencilFormat ? UnsignedInt248Type : UnsignedIntType);

    super(
      { data: null, width, height },
      mapping,
      wrapS,
      wrapT,
      magFilter,
      minFilter,
      format,
      resolvedType,
      anisotropy,
    );

    this.image = { data: null, width, height };
    this.flipY = false;
    this.generateMipmaps = false;
  }
}
