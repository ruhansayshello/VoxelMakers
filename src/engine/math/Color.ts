import {
  clamp,
  ColorManagement,
  euclideanModulo,
  LinearSRGBColorSpace,
  LinearToSRGB,
  SRGBColorSpace,
  SRGBToLinear,
  type ColorSpace,
  type Vector3Like,
} from './constants';
import type { Matrix3 } from './Matrix3';

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type ColorRepresentation = Color | number | string;

const NAMED_COLORS: Record<string, number> = {
  black: 0x000000,
  white: 0xffffff,
  red: 0xff0000,
  lime: 0x00ff00,
  green: 0x008000,
  blue: 0x0000ff,
  yellow: 0xffff00,
  cyan: 0x00ffff,
  aqua: 0x00ffff,
  magenta: 0xff00ff,
  fuchsia: 0xff00ff,
  gray: 0x808080,
  grey: 0x808080,
  silver: 0xc0c0c0,
  maroon: 0x800000,
  olive: 0x808000,
  purple: 0x800080,
  teal: 0x008080,
  navy: 0x000080,
  orange: 0xffa500,
  gold: 0xffd700,
  coral: 0xff7f50,
  crimson: 0xdc143c,
  indigo: 0x4b0082,
  violet: 0xee82ee,
  pink: 0xffc0cb,
  brown: 0xa52a2a,
  tan: 0xd2b48c,
  beige: 0xf5f5dc,
  ivory: 0xfffff0,
  khaki: 0xf0e68c,
  lavender: 0xe6e6fa,
  skyblue: 0x87ceeb,
  steelblue: 0x4682b4,
  slategray: 0x708090,
  slategrey: 0x708090,
  darkgray: 0xa9a9a9,
  darkgrey: 0xa9a9a9,
  lightgray: 0xd3d3d3,
  lightgrey: 0xd3d3d3,
  turquoise: 0x40e0d0,
  salmon: 0xfa8072,
  tomato: 0xff6347,
  chocolate: 0xd2691e,
  sienna: 0xa0522d,
  peru: 0xcd853f,
  wheat: 0xf5deb3,
  plum: 0xdda0dd,
  orchid: 0xda70d6,
  mintcream: 0xf5fffa,
  azure: 0xf0ffff,
  aliceblue: 0xf0f8ff,
  cornflowerblue: 0x6495ed,
  royalblue: 0x4169e1,
  dodgerblue: 0x1e90ff,
  deepskyblue: 0x00bfff,
  forestgreen: 0x228b22,
  limegreen: 0x32cd32,
  seagreen: 0x2e8b57,
  springgreen: 0x00ff7f,
  darkolivegreen: 0x556b2f,
  firebrick: 0xb22222,
  darkred: 0x8b0000,
  darkgreen: 0x006400,
  darkblue: 0x00008b,
  midnightblue: 0x191970,
};

function hueToChannel(p: number, q: number, t: number): number {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * 6 * (2 / 3 - u);
  return p;
}

let _scratchColor: Color | undefined;
const _hslA: HSL = { h: 0, s: 0, l: 0 };
const _hslB: HSL = { h: 0, s: 0, l: 0 };

export class Color {
  static NAMES = NAMED_COLORS;

  readonly isColor = true;
  r = 1;
  g = 1;
  b = 1;

  constructor(r?: ColorRepresentation, g?: number, b?: number) {
    if (g === undefined && b === undefined) {
      if (r !== undefined) {
        this.set(r);
      }
    } else {
      this.setRGB(r as number, g!, b!);
    }
  }

  set(r: ColorRepresentation, g?: number, b?: number): this {
    if (g === undefined && b === undefined) {
      const value = r;
      if (value instanceof Color || (typeof value === 'object' && value !== null && 'isColor' in value)) {
        this.copy(value);
      } else if (typeof value === 'number') {
        this.setHex(value);
      } else if (typeof value === 'string') {
        this.setStyle(value);
      }
    } else {
      this.setRGB(r as number, g!, b!);
    }
    return this;
  }

  setScalar(scalar: number): this {
    this.r = scalar;
    this.g = scalar;
    this.b = scalar;
    return this;
  }

  setHex(hex: number, colorSpace: ColorSpace = SRGBColorSpace): this {
    const intHex = Math.floor(hex);
    this.r = ((intHex >> 16) & 255) / 255;
    this.g = ((intHex >> 8) & 255) / 255;
    this.b = (intHex & 255) / 255;
    ColorManagement.toWorkingColorSpace(this, colorSpace);
    return this;
  }

  setRGB(r: number, g: number, b: number, colorSpace: ColorSpace = ColorManagement.workingColorSpace): this {
    this.r = r;
    this.g = g;
    this.b = b;
    ColorManagement.toWorkingColorSpace(this, colorSpace);
    return this;
  }

  setHSL(h: number, s: number, l: number, colorSpace: ColorSpace = ColorManagement.workingColorSpace): this {
    const hue = euclideanModulo(h, 1);
    const sat = clamp(s, 0, 1);
    const light = clamp(l, 0, 1);

    if (sat === 0) {
      this.r = this.g = this.b = light;
    } else {
      const q = light <= 0.5 ? light * (1 + sat) : light + sat - light * sat;
      const p = 2 * light - q;
      this.r = hueToChannel(p, q, hue + 1 / 3);
      this.g = hueToChannel(p, q, hue);
      this.b = hueToChannel(p, q, hue - 1 / 3);
    }

    ColorManagement.toWorkingColorSpace(this, colorSpace);
    return this;
  }

  setStyle(style: string, colorSpace: ColorSpace = SRGBColorSpace): this {
    const trimmed = style.trim();

    if (trimmed.startsWith('#')) {
      const hexBody = trimmed.slice(1);
      if (hexBody.length === 3 || hexBody.length === 4) {
        const r = parseInt(hexBody[0] + hexBody[0], 16) / 255;
        const g = parseInt(hexBody[1] + hexBody[1], 16) / 255;
        const b = parseInt(hexBody[2] + hexBody[2], 16) / 255;
        return this.setRGB(r, g, b, colorSpace);
      }
      if (hexBody.length === 6 || hexBody.length === 8) {
        const parsed = parseInt(hexBody.slice(0, 6), 16);
        return this.setHex(parsed, colorSpace);
      }
    }

    const fnMatch = /^([a-z]+)\(([^)]+)\)$/i.exec(trimmed);
    if (fnMatch) {
      const fnName = fnMatch[1].toLowerCase();
      const parts = fnMatch[2].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);

      if ((fnName === 'rgb' || fnName === 'rgba') && parts.length >= 3) {
        const parseChannel = (token: string): number =>
          token.endsWith('%')
            ? Math.min(100, parseFloat(token)) / 100
            : Math.min(255, parseFloat(token)) / 255;
        return this.setRGB(parseChannel(parts[0]), parseChannel(parts[1]), parseChannel(parts[2]), colorSpace);
      }

      if ((fnName === 'hsl' || fnName === 'hsla') && parts.length >= 3) {
        const h = parseFloat(parts[0]) / 360;
        const s = parseFloat(parts[1]) / 100;
        const l = parseFloat(parts[2]) / 100;
        return this.setHSL(h, s, l, colorSpace);
      }
    }

    const keywordHex = NAMED_COLORS[trimmed.toLowerCase()];
    if (keywordHex !== undefined) {
      return this.setHex(keywordHex, colorSpace);
    }

    return this;
  }

  setColorName(name: string, colorSpace: ColorSpace = SRGBColorSpace): this {
    const hex = NAMED_COLORS[name.toLowerCase()];
    if (hex !== undefined) {
      this.setHex(hex, colorSpace);
    }
    return this;
  }

  clone(): Color {
    return new Color(this.r, this.g, this.b);
  }

  copy(color: RGB): this {
    this.r = color.r;
    this.g = color.g;
    this.b = color.b;
    return this;
  }

  copySRGBToLinear(color: RGB): this {
    this.r = SRGBToLinear(color.r);
    this.g = SRGBToLinear(color.g);
    this.b = SRGBToLinear(color.b);
    return this;
  }

  copyLinearToSRGB(color: RGB): this {
    this.r = LinearToSRGB(color.r);
    this.g = LinearToSRGB(color.g);
    this.b = LinearToSRGB(color.b);
    return this;
  }

  convertSRGBToLinear(): this {
    return this.copySRGBToLinear(this);
  }

  convertLinearToSRGB(): this {
    return this.copyLinearToSRGB(this);
  }

  getHex(colorSpace: ColorSpace = SRGBColorSpace): number {
    if (_scratchColor === undefined) _scratchColor = new Color();
    ColorManagement.fromWorkingColorSpace(_scratchColor.copy(this), colorSpace);
    const ri = Math.round(clamp(_scratchColor.r * 255, 0, 255));
    const gi = Math.round(clamp(_scratchColor.g * 255, 0, 255));
    const bi = Math.round(clamp(_scratchColor.b * 255, 0, 255));
    return (ri << 16) ^ (gi << 8) ^ bi;
  }

  getHexString(colorSpace: ColorSpace = SRGBColorSpace): string {
    return ('000000' + this.getHex(colorSpace).toString(16)).slice(-6);
  }

  getHSL(target: HSL, colorSpace: ColorSpace = ColorManagement.workingColorSpace): HSL {
    if (_scratchColor === undefined) _scratchColor = new Color();
    ColorManagement.fromWorkingColorSpace(_scratchColor.copy(this), colorSpace);

    const r = _scratchColor.r;
    const g = _scratchColor.g;
    const b = _scratchColor.b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (min + max) * 0.5;

    let h = 0;
    let s = 0;
    if (min !== max) {
      const delta = max - min;
      s = l <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
      if (max === r) {
        h = (g - b) / delta + (g < b ? 6 : 0);
      } else if (max === g) {
        h = (b - r) / delta + 2;
      } else {
        h = (r - g) / delta + 4;
      }
      h /= 6;
    }

    target.h = h;
    target.s = s;
    target.l = l;
    return target;
  }

  getRGB(target: RGB, colorSpace: ColorSpace = ColorManagement.workingColorSpace): RGB {
    if (_scratchColor === undefined) _scratchColor = new Color();
    ColorManagement.fromWorkingColorSpace(_scratchColor.copy(this), colorSpace);
    target.r = _scratchColor.r;
    target.g = _scratchColor.g;
    target.b = _scratchColor.b;
    return target;
  }

  getStyle(colorSpace: ColorSpace = SRGBColorSpace): string {
    if (_scratchColor === undefined) _scratchColor = new Color();
    ColorManagement.fromWorkingColorSpace(_scratchColor.copy(this), colorSpace);
    const r = _scratchColor.r;
    const g = _scratchColor.g;
    const b = _scratchColor.b;
    if (colorSpace !== SRGBColorSpace) {
      return `color(${colorSpace} ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)})`;
    }
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  }

  offsetHSL(h: number, s: number, l: number): this {
    this.getHSL(_hslA);
    return this.setHSL(_hslA.h + h, _hslA.s + s, _hslA.l + l);
  }

  add(color: RGB): this {
    this.r += color.r;
    this.g += color.g;
    this.b += color.b;
    return this;
  }

  addColors(a: RGB, b: RGB): this {
    this.r = a.r + b.r;
    this.g = a.g + b.g;
    this.b = a.b + b.b;
    return this;
  }

  addScalar(s: number): this {
    this.r += s;
    this.g += s;
    this.b += s;
    return this;
  }

  sub(color: RGB): this {
    this.r = Math.max(0, this.r - color.r);
    this.g = Math.max(0, this.g - color.g);
    this.b = Math.max(0, this.b - color.b);
    return this;
  }

  multiply(color: RGB): this {
    this.r *= color.r;
    this.g *= color.g;
    this.b *= color.b;
    return this;
  }

  multiplyScalar(s: number): this {
    this.r *= s;
    this.g *= s;
    this.b *= s;
    return this;
  }

  lerp(color: RGB, alpha: number): this {
    this.r += (color.r - this.r) * alpha;
    this.g += (color.g - this.g) * alpha;
    this.b += (color.b - this.b) * alpha;
    return this;
  }

  lerpColors(a: RGB, b: RGB, alpha: number): this {
    this.r = a.r + (b.r - a.r) * alpha;
    this.g = a.g + (b.g - a.g) * alpha;
    this.b = a.b + (b.b - a.b) * alpha;
    return this;
  }

  lerpHSL(color: Color, alpha: number): this {
    this.getHSL(_hslA);
    color.getHSL(_hslB);
    const h = _hslA.h + (_hslB.h - _hslA.h) * alpha;
    const s = _hslA.s + (_hslB.s - _hslA.s) * alpha;
    const l = _hslA.l + (_hslB.l - _hslA.l) * alpha;
    return this.setHSL(h, s, l);
  }

  setFromVector3(v: Vector3Like): this {
    this.r = v.x;
    this.g = v.y;
    this.b = v.z;
    return this;
  }

  applyMatrix3(m: Matrix3): this {
    const r = this.r, g = this.g, b = this.b;
    const e = m.elements;
    this.r = e[0] * r + e[3] * g + e[6] * b;
    this.g = e[1] * r + e[4] * g + e[7] * b;
    this.b = e[2] * r + e[5] * g + e[8] * b;
    return this;
  }

  equals(c: RGB): boolean {
    return c.r === this.r && c.g === this.g && c.b === this.b;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.r = array[offset];
    this.g = array[offset + 1];
    this.b = array[offset + 2];
    return this;
  }

  toArray(array: number[] | Float32Array = [], offset = 0): number[] | Float32Array {
    array[offset] = this.r;
    array[offset + 1] = this.g;
    array[offset + 2] = this.b;
    return array;
  }

  toJSON(): number {
    return this.getHex();
  }

  *[Symbol.iterator](): Generator<number> {
    yield this.r;
    yield this.g;
    yield this.b;
  }
}

export { LinearSRGBColorSpace, SRGBColorSpace };
