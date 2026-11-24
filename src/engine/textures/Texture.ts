import { Matrix3, NoColorSpace, Vector2, type ColorSpace } from '../math';
import { EventDispatcher } from '../core/EventDispatcher';
import { generateUUID } from '../core/Object3D';
import {
  ClampToEdgeWrapping,
  CubeReflectionMapping,
  CubeRefractionMapping,
  EquirectangularReflectionMapping,
  EquirectangularRefractionMapping,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  UVMapping,
} from '../constants';

export {
  UVMapping,
  CubeReflectionMapping,
  CubeRefractionMapping,
  EquirectangularReflectionMapping,
  EquirectangularRefractionMapping,
};

export interface DataTextureImage {
  data: ArrayBufferView | null;
  width: number;
  height: number;
  depth?: number;
}

export type TextureImage =
  | TexImageSource
  | HTMLCanvasElement
  | HTMLImageElement
  | ImageData
  | DataTextureImage
  | null;

let _textureId = 1;

export class Texture extends EventDispatcher {
  readonly isTexture = true;
  readonly id: number;

  uuid: string;
  name = '';

  image: TextureImage;
  mipmaps: unknown[] = [];

  mapping: number;
  wrapS: number;
  wrapT: number;
  magFilter: number;
  minFilter: number;
  anisotropy: number;

  format: number;
  internalFormat: string | null = null;
  type: number;

  offset: Vector2 = new Vector2(0, 0);
  repeat: Vector2 = new Vector2(1, 1);
  center: Vector2 = new Vector2(0, 0);
  rotation = 0;

  matrix: Matrix3 = new Matrix3();
  matrixAutoUpdate = true;

  generateMipmaps = true;
  premultiplyAlpha = false;
  flipY = true;
  unpackAlignment = 4;

  colorSpace: ColorSpace;
  userData: Record<string, unknown> = {};
  version = 0;

  private _needsUpdate = false;

  constructor(
    image: TextureImage = null,
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
    super();
    this.id = _textureId++;
    this.uuid = generateUUID();

    this.image = image;
    this.mapping = mapping;
    this.wrapS = wrapS;
    this.wrapT = wrapT;
    this.magFilter = magFilter;
    this.minFilter = minFilter;
    this.format = format;
    this.type = type;
    this.anisotropy = anisotropy;
    this.colorSpace = colorSpace;
  }

  get width(): number {
    const img = this.image as { width?: number } | null;
    return img?.width ?? 0;
  }

  get height(): number {
    const img = this.image as { height?: number } | null;
    return img?.height ?? 0;
  }

  get needsUpdate(): boolean {
    return this._needsUpdate;
  }

  set needsUpdate(value: boolean) {
    this._needsUpdate = value;
    if (value === true) {
      this.version++;
    }
  }

  updateMatrix(): void {
    const tx = this.offset.x;
    const ty = this.offset.y;
    const sx = this.repeat.x;
    const sy = this.repeat.y;
    const rotation = this.rotation;
    const cx = this.center.x;
    const cy = this.center.y;

    const c = Math.cos(rotation);
    const s = Math.sin(rotation);

    this.matrix.set(
      sx * c,
      sx * s,
      -sx * (c * cx + s * cy) + cx + tx,
      -sy * s,
      sy * c,
      -sy * (-s * cx + c * cy) + cy + ty,
      0,
      0,
      1,
    );
  }

  clone(): this {
    const Ctor = this.constructor as new () => this;
    return new Ctor().copy(this);
  }

  copy(source: this): this {
    this.name = source.name;
    this.image = source.image;
    this.mipmaps = source.mipmaps.slice();

    this.mapping = source.mapping;
    this.wrapS = source.wrapS;
    this.wrapT = source.wrapT;
    this.magFilter = source.magFilter;
    this.minFilter = source.minFilter;
    this.anisotropy = source.anisotropy;

    this.format = source.format;
    this.internalFormat = source.internalFormat;
    this.type = source.type;

    this.offset.copy(source.offset);
    this.repeat.copy(source.repeat);
    this.center.copy(source.center);
    this.rotation = source.rotation;

    this.matrixAutoUpdate = source.matrixAutoUpdate;
    this.matrix.copy(source.matrix);

    this.generateMipmaps = source.generateMipmaps;
    this.premultiplyAlpha = source.premultiplyAlpha;
    this.flipY = source.flipY;
    this.unpackAlignment = source.unpackAlignment;
    this.colorSpace = source.colorSpace;

    this.userData = JSON.parse(JSON.stringify(source.userData));
    this.needsUpdate = true;

    return this;
  }

  dispose(): void {
    this.dispatchEvent({ type: 'dispose' });
  }
}
