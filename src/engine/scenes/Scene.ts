import { Color, Euler } from '../math';
import {
  Object3D,
  type MaterialLike,
  type Object3DJSON,
  type SerializationMeta,
} from '../core';
import type { Fog } from './Fog';
import type { FogExp2 } from './FogExp2';

export interface TextureLike {
  isTexture?: boolean;
  uuid: string;
  clone?(): TextureLike;
  toJSON?(meta?: SerializationMeta): { uuid: string; [key: string]: unknown };
}

export class Scene extends Object3D {
  readonly isScene = true;

  background: Color | TextureLike | null = null;
  environment: TextureLike | null = null;
  fog: Fog | FogExp2 | null = null;
  overrideMaterial: MaterialLike | null = null;

  backgroundBlurriness = 0;
  backgroundIntensity = 1;
  backgroundRotation = new Euler();

  environmentIntensity = 1;
  environmentRotation = new Euler();

  /**
   * Voxel-specific optimization: flat list of chunk meshes eligible for batched
   * rendering and bulk translation-only matrix updates. Kept in sync with `children`.
   */
  chunks: Object3D[] = [];

  constructor() {
    super();
    this.type = 'Scene';
  }

  /**
   * Voxel-specific optimization: registers a chunk for batched rendering and adds it
   * to both `this.chunks` and `this.children`, keeping scene graph state synchronized.
   */
  addChunk(chunk: Object3D): this {
    if (!chunk || chunk === this || !chunk.isObject3D) {
      return this;
    }

    chunk.isChunk = true;
    super.add(chunk);

    if (this.chunks.indexOf(chunk) === -1) {
      this.chunks.push(chunk);
    }

    return this;
  }

  /**
   * Voxel-specific optimization: removes a chunk from both `this.chunks` and `this.children`.
   */
  removeChunk(chunk: Object3D): this {
    const chunkIdx = this.chunks.indexOf(chunk);
    if (chunkIdx !== -1) {
      this.chunks.splice(chunkIdx, 1);
    }

    super.remove(chunk);
    return this;
  }

  override add(...objects: Object3D[]): this {
    super.add(...objects);
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (obj && obj.isObject3D && obj.isChunk && obj.parent === this && this.chunks.indexOf(obj) === -1) {
        this.chunks.push(obj);
      }
    }
    return this;
  }

  override remove(...objects: Object3D[]): this {
    for (let i = 0; i < objects.length; i++) {
      const chunkIdx = this.chunks.indexOf(objects[i]);
      if (chunkIdx !== -1) {
        this.chunks.splice(chunkIdx, 1);
      }
    }
    return super.remove(...objects);
  }

  /**
   * Voxel-specific optimization: bulk updates local and world matrices for all chunks
   * in a single tight loop using translation-only voxel transforms (chunks do not rotate).
   */
  updateChunkMatrices(): void {
    const chunks = this.chunks;
    const len = chunks.length;
    if (len === 0) return;

    const se = this.matrixWorld.elements;
    const isIdentityScene =
      se[0] === 1 && se[1] === 0 && se[2] === 0 && se[3] === 0 &&
      se[4] === 0 && se[5] === 1 && se[6] === 0 && se[7] === 0 &&
      se[8] === 0 && se[9] === 0 && se[10] === 1 && se[11] === 0 &&
      se[12] === 0 && se[13] === 0 && se[14] === 0 && se[15] === 1;

    if (isIdentityScene) {
      for (let i = 0; i < len; i++) {
        const chunk = chunks[i];
        const px = chunk.position.x;
        const py = chunk.position.y;
        const pz = chunk.position.z;

        chunk.matrix.makeVoxelTransform(px, py, pz);
        chunk.matrixWorld.makeVoxelTransform(px, py, pz);
        chunk.matrixWorldNeedsUpdate = false;
      }
    } else {
      for (let i = 0; i < len; i++) {
        const chunk = chunks[i];
        chunk.matrix.makeVoxelTransform(chunk.position.x, chunk.position.y, chunk.position.z);
        chunk.matrixWorld.multiplyMatrices(this.matrixWorld, chunk.matrix);
        chunk.matrixWorldNeedsUpdate = false;
      }
    }
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);

    if (source.background !== null) {
      this.background =
        source.background instanceof Color
          ? source.background.clone()
          : source.background.clone
            ? source.background.clone()
            : source.background;
    } else {
      this.background = null;
    }

    if (source.environment !== null) {
      this.environment = source.environment.clone ? source.environment.clone() : source.environment;
    } else {
      this.environment = null;
    }

    this.fog = source.fog !== null ? source.fog.clone() : null;

    this.backgroundBlurriness = source.backgroundBlurriness;
    this.backgroundIntensity = source.backgroundIntensity;
    this.backgroundRotation.copy(source.backgroundRotation);

    this.environmentIntensity = source.environmentIntensity;
    this.environmentRotation.copy(source.environmentRotation);

    if (source.overrideMaterial !== null) {
      this.overrideMaterial = source.overrideMaterial.clone
        ? source.overrideMaterial.clone()
        : source.overrideMaterial;
    } else {
      this.overrideMaterial = null;
    }

    this.matrixAutoUpdate = source.matrixAutoUpdate;

    // Rebuild chunks array from cloned children
    this.chunks = [];
    for (let i = 0; i < this.children.length; i++) {
      if (this.children[i].isChunk) {
        this.chunks.push(this.children[i]);
      }
    }

    return this;
  }

  override toJSON(meta?: SerializationMeta | string): Object3DJSON {
    const data = super.toJSON(meta);

    if (this.fog !== null) {
      data.object.fog = this.fog.toJSON();
    }

    data.object.backgroundBlurriness = this.backgroundBlurriness;
    data.object.backgroundIntensity = this.backgroundIntensity;
    data.object.backgroundRotation = this.backgroundRotation.toArray();

    data.object.environmentIntensity = this.environmentIntensity;
    data.object.environmentRotation = this.environmentRotation.toArray();

    return data;
  }
}
