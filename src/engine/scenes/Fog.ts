import { Color, type ColorRepresentation } from '../math';

export interface FogJSON {
  type: 'Fog';
  name: string;
  color: number;
  near: number;
  far: number;
}

export class Fog {
  readonly isFog = true;
  name = '';
  color: Color;
  near: number;
  far: number;

  constructor(color: ColorRepresentation, near = 1, far = 1000) {
    this.color = new Color(color);
    this.near = near;
    this.far = far;
  }

  clone(): Fog {
    const copy = new Fog(this.color, this.near, this.far);
    copy.name = this.name;
    return copy;
  }

  toJSON(): FogJSON {
    return {
      type: 'Fog',
      name: this.name,
      color: this.color.getHex(),
      near: this.near,
      far: this.far,
    };
  }
}
