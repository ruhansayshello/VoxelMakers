import { Color, type ColorRepresentation } from '../math';

export interface FogExp2JSON {
  type: 'FogExp2';
  name: string;
  color: number;
  density: number;
}

export class FogExp2 {
  readonly isFogExp2 = true;
  name = '';
  color: Color;
  density: number;

  constructor(color: ColorRepresentation, density = 0.00025) {
    this.color = new Color(color);
    this.density = density;
  }

  clone(): FogExp2 {
    const copy = new FogExp2(this.color, this.density);
    copy.name = this.name;
    return copy;
  }

  toJSON(): FogExp2JSON {
    return {
      type: 'FogExp2',
      name: this.name,
      color: this.color.getHex(),
      density: this.density,
    };
  }
}
