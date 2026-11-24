/**
 * Lightweight Three.js loader, skeleton, interleaved buffer, and animation compatibility
 * primitives so `three/examples/jsm/loaders/GLTFLoader.js` and `DRACOLoader.js` execute
 * cleanly against our custom engine without pulling `three` core into the bundle.
 */

import { Matrix4 } from '../math';
import { BufferAttribute, type TypedArray } from '../core/BufferAttribute';
import { Mesh } from '../core/Mesh';
import { Object3D } from '../core/Object3D';
import { Texture } from '../textures/Texture';
import { AttachedBindMode, InterpolateLinear } from '../constants';

export class InterleavedBuffer {
  readonly isInterleavedBuffer = true;
  array: TypedArray;
  stride: number;
  count: number;
  usage = 35044;
  version = 0;

  constructor(array: TypedArray, stride: number) {
    this.array = array;
    this.stride = stride;
    this.count = array !== undefined ? array.length / stride : 0;
  }

  set needsUpdate(value: boolean) {
    if (value) this.version++;
  }

  clone(): InterleavedBuffer {
    const ClonedCtor = this.array.constructor as new (arr: TypedArray) => TypedArray;
    return new InterleavedBuffer(new ClonedCtor(this.array), this.stride);
  }
}

export class InterleavedBufferAttribute {
  readonly isInterleavedBufferAttribute = true;
  name = '';
  data: InterleavedBuffer;
  itemSize: number;
  offset: number;
  normalized: boolean;

  constructor(interleavedBuffer: InterleavedBuffer, itemSize: number, offset: number, normalized = false) {
    this.data = interleavedBuffer;
    this.itemSize = itemSize;
    this.offset = offset;
    this.normalized = normalized;
  }

  get count(): number {
    return this.data.count;
  }

  get array(): TypedArray {
    return this.data.array;
  }

  getX(index: number): number {
    return this.data.array[index * this.data.stride + this.offset];
  }

  getY(index: number): number {
    return this.data.array[index * this.data.stride + this.offset + 1];
  }

  getZ(index: number): number {
    return this.data.array[index * this.data.stride + this.offset + 2];
  }

  getW(index: number): number {
    return this.data.array[index * this.data.stride + this.offset + 3];
  }

  clone(): BufferAttribute {
    const out = new Float32Array(this.count * this.itemSize);
    for (let i = 0; i < this.count; i++) {
      const base = i * this.data.stride + this.offset;
      for (let k = 0; k < this.itemSize; k++) {
        out[i * this.itemSize + k] = this.data.array[base + k];
      }
    }
    return new BufferAttribute(out, this.itemSize, this.normalized);
  }
}

export class Bone extends Object3D {
  readonly isBone = true;
  override type = 'Bone';
}

export class Skeleton {
  bones: Bone[];
  boneInverses: Matrix4[];
  boneMatrices: Float32Array | null = null;
  boneTexture: Texture | null = null;

  constructor(bones: Bone[] = [], boneInverses: Matrix4[] = []) {
    this.bones = bones.slice();
    this.boneInverses = boneInverses.slice();
    this.boneMatrices = new Float32Array(this.bones.length * 16);
  }

  calculateInverses(): void {
    this.boneInverses.length = 0;
    for (let i = 0; i < this.bones.length; i++) {
      const inv = new Matrix4();
      if (this.bones[i]) inv.copy(this.bones[i].matrixWorld).invert();
      this.boneInverses.push(inv);
    }
  }

  update(): void {}
  dispose(): void {}
}

export class SkinnedMesh extends Mesh {
  readonly isSkinnedMesh = true;
  override type = 'SkinnedMesh';

  bindMode: string = AttachedBindMode;
  bindMatrix = new Matrix4();
  bindMatrixInverse = new Matrix4();
  skeleton: Skeleton | null = null;

  bind(skeleton: Skeleton, bindMatrix?: Matrix4): void {
    this.skeleton = skeleton;
    if (bindMatrix === undefined) {
      this.updateMatrixWorld(true);
      this.skeleton.calculateInverses();
      bindMatrix = this.matrixWorld;
    }
    this.bindMatrix.copy(bindMatrix);
    this.bindMatrixInverse.copy(bindMatrix).invert();
  }
}

export class Interpolant {
  parameterPositions: ArrayLike<number>;
  resultBuffer: Float32Array;
  sampleValues: ArrayLike<number>;
  valueSize: number;
  settings: unknown = null;
  DefaultSettings_: Record<string, unknown> = {};

  constructor(
    parameterPositions: ArrayLike<number>,
    sampleValues: ArrayLike<number>,
    sampleSize: number,
    resultBuffer?: Float32Array,
  ) {
    this.parameterPositions = parameterPositions;
    this.sampleValues = sampleValues;
    this.valueSize = sampleSize;
    this.resultBuffer = resultBuffer ?? new Float32Array(sampleSize);
  }

  evaluate(_t: number): Float32Array {
    return this.resultBuffer;
  }
}

export class KeyframeTrack {
  name: string;
  times: Float32Array;
  values: Float32Array;
  interpolation: number;

  constructor(
    name: string,
    times: ArrayLike<number>,
    values: ArrayLike<number>,
    interpolation = InterpolateLinear,
  ) {
    this.name = name;
    this.times = new Float32Array(times);
    this.values = new Float32Array(values);
    this.interpolation = interpolation;
  }

  createInterpolant?: (result?: Float32Array) => Interpolant;
}

export class NumberKeyframeTrack extends KeyframeTrack {
  ValueTypeName = 'number';
}

export class VectorKeyframeTrack extends KeyframeTrack {
  ValueTypeName = 'vector';
}

export class QuaternionKeyframeTrack extends KeyframeTrack {
  ValueTypeName = 'quaternion';
}

export class AnimationClip {
  name: string;
  tracks: KeyframeTrack[];
  duration: number;
  uuid = '';

  constructor(name = '', duration = -1, tracks: KeyframeTrack[] = []) {
    this.name = name;
    this.tracks = tracks;
    this.duration = duration;
  }
}

export class AnimationMixer {
  private _root: Object3D;
  time = 0;
  timeScale = 1;

  constructor(root: Object3D) {
    this._root = root;
  }

  clipAction(_clip: AnimationClip, _optionalRoot?: Object3D): {
    play(): unknown;
    stop(): unknown;
    reset(): unknown;
  } {
    const action = {
      play: () => action,
      stop: () => action,
      reset: () => action,
    };
    return action;
  }

  getRoot(): Object3D {
    return this._root;
  }

  update(deltaTime: number): this {
    this.time += deltaTime * this.timeScale;
    return this;
  }
}

export class SkeletonHelper extends Object3D {
  readonly isSkeletonHelper = true;
  override type = 'SkeletonHelper';
  root: Object3D;
  bones: Bone[] = [];

  constructor(object: Object3D) {
    super();
    this.root = object;
    this.matrix = object.matrixWorld;
    this.matrixAutoUpdate = false;
  }

  dispose(): void {}
}

export const PropertyBinding = {
  sanitizeNodeName(name: string): string {
    return name.replace(/\s/g, '_').replace(/[\[\].:/]/g, '');
  },
};

export class LoadingManager {
  itemStart(_url: string): void {}
  itemEnd(_url: string): void {}
  itemError(_url: string): void {}
  resolveURL(url: string): string {
    return url;
  }
  getHandler(_file: string): unknown {
    return null;
  }
}

export const DefaultLoadingManager = new LoadingManager();

export class Loader {
  manager: LoadingManager;
  crossOrigin = 'anonymous';
  withCredentials = false;
  path = '';
  resourcePath = '';
  requestHeader: Record<string, string> = {};

  constructor(manager?: LoadingManager) {
    this.manager = manager ?? DefaultLoadingManager;
  }

  setCrossOrigin(crossOrigin: string): this {
    this.crossOrigin = crossOrigin;
    return this;
  }

  setWithCredentials(value: boolean): this {
    this.withCredentials = value;
    return this;
  }

  setPath(path: string): this {
    this.path = path;
    return this;
  }

  setResourcePath(resourcePath: string): this {
    this.resourcePath = resourcePath;
    return this;
  }

  setRequestHeader(requestHeader: Record<string, string>): this {
    this.requestHeader = requestHeader;
    return this;
  }
}

export class FileLoader extends Loader {
  responseType = '';

  setResponseType(value: string): this {
    this.responseType = value;
    return this;
  }

  load(
    url: string,
    onLoad?: (data: string | ArrayBuffer) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): void {
    const resolved = this.path ? this.path + url : url;
    fetch(resolved)
      .then((res): Promise<string | ArrayBuffer> => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${resolved}`);
        return this.responseType === 'arraybuffer' ? res.arrayBuffer() : res.text();
      })
      .then((data) => onLoad?.(data))
      .catch((err) => onError?.(err));
  }
}

export class ImageBitmapLoader extends Loader {
  options: ImageBitmapOptions = { premultiplyAlpha: 'none' };

  setOptions(options: ImageBitmapOptions): this {
    this.options = options;
    return this;
  }

  load(
    url: string,
    onLoad?: (bitmap: ImageBitmap) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): void {
    const resolved = this.path ? this.path + url : url;
    fetch(resolved)
      .then((res) => res.blob())
      .then((blob) => createImageBitmap(blob, this.options))
      .then((bitmap) => onLoad?.(bitmap))
      .catch((err) => onError?.(err));
  }
}

export class TextureLoader extends Loader {
  load(
    url: string,
    onLoad?: (texture: Texture) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): Texture {
    const texture = new Texture();
    const img = new Image();
    img.crossOrigin = this.crossOrigin;
    img.onload = () => {
      texture.image = img;
      texture.needsUpdate = true;
      onLoad?.(texture);
    };
    img.onerror = (err) => onError?.(err);
    img.src = this.path ? this.path + url : url;
    return texture;
  }
}

export const LoaderUtils = {
  extractUrlBase(url: string): string {
    const index = url.lastIndexOf('/');
    return index === -1 ? './' : url.slice(0, index + 1);
  },
  resolveURL(url: string, path: string): string {
    if (!url) return '';
    if (/^https?:\/\//i.test(url) || /^data:.*,.*$/i.test(url) || /^blob:.*$/i.test(url)) {
      return url;
    }
    return path + url;
  },
};
