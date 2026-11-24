import { Color, type ColorRepresentation } from '../math';
import { Material, type MaterialParameters, type TextureLike } from './Material';

export interface LineBasicMaterialParameters extends MaterialParameters {
  color?: ColorRepresentation;
  map?: TextureLike | null;
  linewidth?: number;
  linecap?: string;
  linejoin?: string;
}

export class LineBasicMaterial extends Material {
  readonly isLineBasicMaterial = true;

  color: Color = new Color(0xffffff);
  map: TextureLike | null = null;
  linewidth = 1;
  linecap = 'round';
  linejoin = 'round';

  constructor(parameters?: LineBasicMaterialParameters) {
    super();
    this.type = 'LineBasicMaterial';
    this.fog = true;
    this.setValues(parameters as Record<string, unknown> | undefined);
  }

  override copy(source: this): this {
    super.copy(source);

    this.color.copy(source.color);
    this.map = source.map;
    this.linewidth = source.linewidth;
    this.linecap = source.linecap;
    this.linejoin = source.linejoin;

    return this;
  }

  override toJSON(meta?: Record<string, unknown>): Record<string, unknown> {
    const data = super.toJSON(meta);
    data.color = this.color.getHex();
    if (this.linewidth !== 1) data.linewidth = this.linewidth;
    if (this.linecap !== 'round') data.linecap = this.linecap;
    if (this.linejoin !== 'round') data.linejoin = this.linejoin;
    if (this.map && this.map.uuid) data.map = this.map.uuid;
    return data;
  }
}
