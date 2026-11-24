import { NoColorSpace, type ColorSpace } from '../math';
import {
  ClampToEdgeWrapping,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
} from '../renderers/webgl/constants';
import { Texture, UVMapping, type DataTextureImage } from './Texture';

export class DataTexture extends Texture {
  readonly isDataTexture = true;

  declare image: DataTextureImage;

  constructor(
    data: ArrayBufferView | null = null,
    width = 1,
    height = 1,
    format: number = RGBAFormat,
    type: number = UnsignedByteType,
    mapping: number = UVMapping,
    wrapS: number = ClampToEdgeWrapping,
    wrapT: number = ClampToEdgeWrapping,
    magFilter: number = NearestFilter,
    minFilter: number = NearestFilter,
    anisotropy = 1,
    colorSpace: ColorSpace = NoColorSpace,
  ) {
    super(
      { data, width, height },
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

    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
  }
}
