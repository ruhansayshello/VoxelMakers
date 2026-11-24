import { Color, type ColorRepresentation } from '../math';
import { Material, type MaterialParameters, type TextureLike } from './Material';

export interface PointsMaterialParameters extends MaterialParameters {
  color?: ColorRepresentation;
  map?: TextureLike | null;
  alphaMap?: TextureLike | null;
  size?: number;
  sizeAttenuation?: boolean;
}

export class PointsMaterial extends Material {
  readonly isPointsMaterial = true;

  color: Color = new Color(0xffffff);
  map: TextureLike | null = null;
  alphaMap: TextureLike | null = null;
  size = 1;
  sizeAttenuation = true;

  constructor(parameters?: PointsMaterialParameters) {
    super();
    this.type = 'PointsMaterial';
    this.fog = true;
    this.setValues(parameters as Record<string, unknown> | undefined);
  }

  override copy(source: this): this {
    super.copy(source);

    this.color.copy(source.color);
    this.map = source.map;
    this.alphaMap = source.alphaMap;
    this.size = source.size;
    this.sizeAttenuation = source.sizeAttenuation;

    return this;
  }

  override toJSON(meta?: Record<string, unknown>): Record<string, unknown> {
    const data = super.toJSON(meta);
    data.color = this.color.getHex();
    if (this.size !== 1) data.size = this.size;
    if (!this.sizeAttenuation) data.sizeAttenuation = false;
    if (this.map && this.map.uuid) data.map = this.map.uuid;
    if (this.alphaMap && this.alphaMap.uuid) data.alphaMap = this.alphaMap.uuid;
    return data;
  }
}
