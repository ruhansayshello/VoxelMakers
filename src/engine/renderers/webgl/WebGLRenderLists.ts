import type { BufferGeometry, GeometryGroup } from '../../core/BufferGeometry';
import type { Object3D } from '../../core/Object3D';
import type { Material } from '../../materials/Material';

export interface RenderItem {
  id: number;
  object: Object3D;
  geometry: BufferGeometry;
  material: Material;
  groupOrder: number;
  renderOrder: number;
  z: number;
  group: GeometryGroup | null;
}

function opaqueSort(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.material.id !== b.material.id) return a.material.id - b.material.id;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}

function transparentSort(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return b.z - a.z;
  return a.id - b.id;
}

export class WebGLRenderList {
  private pool: RenderItem[] = [];
  private poolIndex = 0;

  readonly opaque: RenderItem[] = [];
  readonly transparent: RenderItem[] = [];

  init(): void {
    this.poolIndex = 0;
    this.opaque.length = 0;
    this.transparent.length = 0;
  }

  private nextItem(
    object: Object3D,
    geometry: BufferGeometry,
    material: Material,
    groupOrder: number,
    z: number,
    group: GeometryGroup | null,
  ): RenderItem {
    let item = this.pool[this.poolIndex];
    if (item === undefined) {
      item = {
        id: object.id,
        object,
        geometry,
        material,
        groupOrder,
        renderOrder: object.renderOrder,
        z,
        group,
      };
      this.pool[this.poolIndex] = item;
    } else {
      item.id = object.id;
      item.object = object;
      item.geometry = geometry;
      item.material = material;
      item.groupOrder = groupOrder;
      item.renderOrder = object.renderOrder;
      item.z = z;
      item.group = group;
    }

    this.poolIndex++;
    return item;
  }

  push(
    object: Object3D,
    geometry: BufferGeometry,
    material: Material,
    groupOrder: number,
    z: number,
    group: GeometryGroup | null,
  ): void {
    const item = this.nextItem(object, geometry, material, groupOrder, z, group);
    if (material.transparent === true) {
      this.transparent.push(item);
    } else {
      this.opaque.push(item);
    }
  }

  sort(
    customOpaqueSort?: (a: RenderItem, b: RenderItem) => number,
    customTransparentSort?: (a: RenderItem, b: RenderItem) => number,
  ): void {
    if (this.opaque.length > 1) {
      this.opaque.sort(customOpaqueSort ?? opaqueSort);
    }
    if (this.transparent.length > 1) {
      this.transparent.sort(customTransparentSort ?? transparentSort);
    }
  }

  finish(): void {
    // Clear object references in unused pool slots so GC can reclaim disposed meshes
    for (let i = this.poolIndex; i < this.pool.length; i++) {
      const slot = this.pool[i];
      slot.object = null as unknown as Object3D;
      slot.geometry = null as unknown as BufferGeometry;
      slot.material = null as unknown as Material;
      slot.group = null;
    }
  }
}

export class WebGLRenderLists {
  private lists = new WeakMap<object, WebGLRenderList>();

  get(scene: object): WebGLRenderList {
    let list = this.lists.get(scene);
    if (list === undefined) {
      list = new WebGLRenderList();
      this.lists.set(scene, list);
    }
    return list;
  }

  dispose(): void {
    this.lists = new WeakMap<object, WebGLRenderList>();
  }
}
