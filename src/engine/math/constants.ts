import {
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
  NoColorSpace,
  SRGBColorSpace,
  LinearSRGBColorSpace,
} from '../constants';

export {
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
  NoColorSpace,
  SRGBColorSpace,
  LinearSRGBColorSpace,
};

export type CoordinateSystem = typeof WebGLCoordinateSystem | typeof WebGPUCoordinateSystem;

export type ColorSpace = typeof NoColorSpace | typeof SRGBColorSpace | typeof LinearSRGBColorSpace | string;

export const ColorManagement = {
  enabled: true,
  workingColorSpace: LinearSRGBColorSpace as ColorSpace,

  convert(color: { r: number; g: number; b: number }, sourceColorSpace: ColorSpace, targetColorSpace: ColorSpace) {
    if (!this.enabled || sourceColorSpace === targetColorSpace || !sourceColorSpace || !targetColorSpace) {
      return color;
    }

    if (sourceColorSpace === SRGBColorSpace && targetColorSpace === LinearSRGBColorSpace) {
      color.r = SRGBToLinear(color.r);
      color.g = SRGBToLinear(color.g);
      color.b = SRGBToLinear(color.b);
    } else if (sourceColorSpace === LinearSRGBColorSpace && targetColorSpace === SRGBColorSpace) {
      color.r = LinearToSRGB(color.r);
      color.g = LinearToSRGB(color.g);
      color.b = LinearToSRGB(color.b);
    }

    return color;
  },

  fromWorkingColorSpace(color: { r: number; g: number; b: number }, targetColorSpace: ColorSpace) {
    return this.convert(color, this.workingColorSpace, targetColorSpace);
  },

  toWorkingColorSpace(color: { r: number; g: number; b: number }, sourceColorSpace: ColorSpace) {
    return this.convert(color, sourceColorSpace, this.workingColorSpace);
  },
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function euclideanModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function lerp(x: number, y: number, t: number): number {
  return (1 - t) * x + t * y;
}

export function SRGBToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

export function LinearToSRGB(c: number): number {
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
}

export interface Vector2Like {
  x: number;
  y: number;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface Vector4Like {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BufferAttributeLike {
  count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ?(index: number): number;
  getW?(index: number): number;
}

export interface Matrix4Like {
  elements: ArrayLike<number>;
}

export interface CameraLike {
  projectionMatrix: Matrix4Like;
  matrixWorldInverse: Matrix4Like;
  projectionMatrixInverse?: Matrix4Like;
  matrixWorld?: Matrix4Like;
}
