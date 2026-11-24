import {
  BufferAttribute,
  type BufferAttributeJSON,
  type TypedArray,
  type TypedArrayConstructor,
} from './BufferAttribute';

export interface InstancedBufferAttributeJSON extends BufferAttributeJSON {
  meshPerAttribute: number;
  isInstancedBufferAttribute: true;
}

export class InstancedBufferAttribute extends BufferAttribute {
  readonly isInstancedBufferAttribute = true;
  meshPerAttribute: number;

  constructor(array: TypedArray, itemSize: number, normalized = false, meshPerAttribute = 1) {
    super(array, itemSize, normalized);
    this.meshPerAttribute = meshPerAttribute;
  }

  override copy(source: InstancedBufferAttribute): this {
    super.copy(source);
    this.meshPerAttribute = source.meshPerAttribute;
    return this;
  }

  override clone(): InstancedBufferAttribute {
    const Ctor = this.array.constructor as TypedArrayConstructor;
    const cloned = new InstancedBufferAttribute(
      new Ctor(this.array),
      this.itemSize,
      this.normalized,
      this.meshPerAttribute,
    );
    cloned.name = this.name;
    cloned.usage = this.usage;
    cloned.gpuType = this.gpuType;
    return cloned;
  }

  override toJSON(): InstancedBufferAttributeJSON {
    const data = super.toJSON() as InstancedBufferAttributeJSON;
    data.meshPerAttribute = this.meshPerAttribute;
    data.isInstancedBufferAttribute = true;
    return data;
  }
}
