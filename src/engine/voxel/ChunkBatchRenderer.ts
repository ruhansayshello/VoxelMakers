import { Frustum, Matrix4, Sphere } from '../math';
import { BufferAttribute } from '../core/BufferAttribute';
import { BufferGeometry } from '../core/BufferGeometry';
import { DynamicDrawUsage } from '../core/constants';
import { Mesh } from '../core/Mesh';
import type { Material } from '../materials/Material';
import type { RenderCameraLike, RenderableObjectLike, WebGLRenderer } from '../renderers/WebGLRenderer';
import type { Scene } from '../scenes/Scene';
import { createVoxelPotatoMaterial } from './VoxelPotatoShader';

export interface BatchableChunk {
  id?: number | string;
  geometry: BufferGeometry;
  boundingSphere?: Sphere | null;
  position?: { x: number; y: number; z: number };
  matrixWorld?: Matrix4;
  visible?: boolean;
  /** Optional default voxel material ID (0..6) when geometry lacks a `voxelMaterial` attribute. */
  defaultMaterialId?: number;
  /** Optional LOD tier (0, 1, or 2) stamped into merged `lodLevel` attribute for GPU LOD switching. */
  lodLevel?: number;
}

export interface ChunkBatchRendererOptions {
  maxVertexCount?: number;
  maxIndexCount?: number;
  material?: Material;
  enableGpuLod?: boolean;
}

const _projScreenMatrix = new Matrix4();
const _frustum = new Frustum();
const _worldSphere = new Sphere();

export class ChunkBatchRenderer {
  readonly mergedGeometry: BufferGeometry;
  mergedMaterial: Material;
  readonly mesh: Mesh;

  readonly maxVertexCount: number;
  readonly maxIndexCount: number;

  chunks: BatchableChunk[] = [];
  visibleChunks: BatchableChunk[] = [];
  dirty = true;

  mergedVertexCount = 0;
  mergedIndexCount = 0;
  mergeCount = 0;
  drawCallsLastFrame = 0;

  private _posArray: Float32Array;
  private _normArray: Float32Array;
  private _uvArray: Float32Array;
  private _colorArray: Float32Array;
  private _matIdArray: Int8Array;
  private _lodArray: Int8Array;
  private _indexArray: Uint32Array;

  private _posAttr: BufferAttribute;
  private _normAttr: BufferAttribute;
  private _uvAttr: BufferAttribute;
  private _colorAttr: BufferAttribute;
  private _matIdAttr: BufferAttribute;
  private _lodAttr: BufferAttribute;
  private _indexAttr: BufferAttribute;

  private _prevVisibleChunks: BatchableChunk[] = [];
  private _cullPool: Array<{ chunk: BatchableChunk; boundingSphere: Sphere }> = [];
  private _cullCandidates: Array<{ chunk: BatchableChunk; boundingSphere: Sphere }> = [];

  constructor(options: ChunkBatchRendererOptions = {}) {
    this.maxVertexCount = Math.max(3, Math.floor(options.maxVertexCount ?? 262144));
    this.maxIndexCount = Math.max(3, Math.floor(options.maxIndexCount ?? this.maxVertexCount * 2));

    // Pre-allocate all merged buffers ONCE at startup (zero per-frame heap allocations)
    this._posArray = new Float32Array(this.maxVertexCount * 3);
    this._normArray = new Float32Array(this.maxVertexCount * 3);
    this._uvArray = new Float32Array(this.maxVertexCount * 2);
    this._colorArray = new Float32Array(this.maxVertexCount * 3);
    this._matIdArray = new Int8Array(this.maxVertexCount);
    this._lodArray = new Int8Array(this.maxVertexCount);
    this._indexArray = new Uint32Array(this.maxIndexCount);

    this._posAttr = new BufferAttribute(this._posArray, 3, false).setUsage(DynamicDrawUsage);
    this._normAttr = new BufferAttribute(this._normArray, 3, false).setUsage(DynamicDrawUsage);
    this._uvAttr = new BufferAttribute(this._uvArray, 2, false).setUsage(DynamicDrawUsage);
    this._colorAttr = new BufferAttribute(this._colorArray, 3, false).setUsage(DynamicDrawUsage);
    this._matIdAttr = new BufferAttribute(this._matIdArray, 1, false).setUsage(DynamicDrawUsage);
    this._lodAttr = new BufferAttribute(this._lodArray, 1, false).setUsage(DynamicDrawUsage);
    this._indexAttr = new BufferAttribute(this._indexArray, 1, false).setUsage(DynamicDrawUsage);

    this.mergedGeometry = new BufferGeometry();
    this.mergedGeometry.isVoxelGeometry = true;
    this.mergedGeometry.setAttribute('position', this._posAttr);
    this.mergedGeometry.setAttribute('normal', this._normAttr);
    this.mergedGeometry.setAttribute('uv', this._uvAttr);
    this.mergedGeometry.setAttribute('color', this._colorAttr);
    this.mergedGeometry.setAttribute('voxelMaterial', this._matIdAttr);
    this.mergedGeometry.setAttribute('lodLevel', this._lodAttr);
    this.mergedGeometry.setIndex(this._indexAttr);
    this.mergedGeometry.setDrawRange(0, 0);

    this.mergedMaterial =
      options.material ?? createVoxelPotatoMaterial({ enableGpuLod: options.enableGpuLod });

    this.mesh = new Mesh(this.mergedGeometry, this.mergedMaterial);
    this.mesh.name = 'ChunkBatchMergedMesh';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.matrix.identity();
    this.mesh.matrixWorld.identity();
  }

  addChunk(chunk: BatchableChunk): void {
    if (this.chunks.indexOf(chunk) === -1) {
      this.chunks.push(chunk);
      this.dirty = true;
    }
  }

  removeChunk(chunk: BatchableChunk): boolean {
    const idx = this.chunks.indexOf(chunk);
    if (idx !== -1) {
      this.chunks.splice(idx, 1);
      this.dirty = true;
      return true;
    }
    return false;
  }

  clearChunks(): void {
    this.chunks.length = 0;
    this.visibleChunks.length = 0;
    this._prevVisibleChunks.length = 0;
    this.mergedVertexCount = 0;
    this.mergedIndexCount = 0;
    this.mergedGeometry.setDrawRange(0, 0);
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  private resolveChunkWorldSphere(chunk: BatchableChunk): Sphere | null {
    if (chunk.boundingSphere !== undefined && chunk.boundingSphere !== null) {
      if (chunk.position) {
        _worldSphere.copy(chunk.boundingSphere);
        // If boundingSphere is already world-space or local-space:
        // when geometry.boundingSphere === chunk.boundingSphere, translate by chunk.position
        if (chunk.boundingSphere === chunk.geometry.boundingSphere) {
          _worldSphere.center.x += chunk.position.x;
          _worldSphere.center.y += chunk.position.y;
          _worldSphere.center.z += chunk.position.z;
        }
        return _worldSphere;
      }
      if (chunk.matrixWorld && chunk.boundingSphere === chunk.geometry.boundingSphere) {
        return _worldSphere.copy(chunk.boundingSphere).applyMatrix4(chunk.matrixWorld);
      }
      return chunk.boundingSphere;
    }

    const geo = chunk.geometry;
    if (geo.boundingSphere === null) {
      geo.computeBoundingSphere();
    }
    if (geo.boundingSphere === null) return null;

    _worldSphere.copy(geo.boundingSphere);
    if (chunk.position) {
      _worldSphere.center.x += chunk.position.x;
      _worldSphere.center.y += chunk.position.y;
      _worldSphere.center.z += chunk.position.z;
    } else if (chunk.matrixWorld) {
      _worldSphere.applyMatrix4(chunk.matrixWorld);
    }
    return _worldSphere;
  }

  private cullChunks(sourceChunks: BatchableChunk[], camera: RenderCameraLike): BatchableChunk[] {
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    // Prepare world-space sphere descriptors for bulk Frustum.cullChunkArray with zero per-frame allocations
    this._cullCandidates.length = 0;
    this.visibleChunks.length = 0;

    let poolIdx = 0;
    for (let i = 0; i < sourceChunks.length; i++) {
      const chunk = sourceChunks[i];
      if (chunk.visible === false) continue;

      const posAttr = chunk.geometry.attributes.position;
      if (posAttr === undefined || posAttr.count === 0) continue;

      const sphere = this.resolveChunkWorldSphere(chunk);
      if (sphere === null) {
        this.visibleChunks.push(chunk);
        continue;
      }

      let record = this._cullPool[poolIdx];
      if (record === undefined) {
        record = { chunk, boundingSphere: new Sphere() };
        this._cullPool[poolIdx] = record;
      }
      record.chunk = chunk;
      record.boundingSphere.copy(sphere);
      this._cullCandidates.push(record);
      poolIdx++;
    }

    if (this._cullCandidates.length > 0) {
      const culledIndices = _frustum.cullChunkArray(this._cullCandidates);
      for (let i = 0; i < culledIndices.length; i++) {
        this.visibleChunks.push(this._cullCandidates[culledIndices[i]].chunk);
      }
    }

    return this.visibleChunks;
  }

  private hasVisibleSetChanged(next: BatchableChunk[]): boolean {
    const prev = this._prevVisibleChunks;
    if (prev.length !== next.length) return true;
    for (let i = 0; i < next.length; i++) {
      if (prev[i] !== next[i]) return true;
    }
    return false;
  }

  private mergeVisibleChunks(): void {
    const posDst = this._posArray;
    const normDst = this._normArray;
    const uvDst = this._uvArray;
    const colDst = this._colorArray;
    const matDst = this._matIdArray;
    const lodDst = this._lodArray;
    const idxDst = this._indexArray;

    let vOffset = 0;
    let iOffset = 0;

    for (let c = 0; c < this.visibleChunks.length; c++) {
      const chunk = this.visibleChunks[c];
      const geo = chunk.geometry;
      const posAttr = geo.attributes.position;
      if (!posAttr || posAttr.count === 0) continue;

      const vCount = posAttr.count;
      const srcIdx = geo.index;
      const iCount = srcIdx !== null ? srcIdx.count : vCount;

      if (vOffset + vCount > this.maxVertexCount || iOffset + iCount > this.maxIndexCount) {
        // Capacity reached — stop merging cleanly without crashing or reallocating
        break;
      }

      // Resolve chunk world offset
      let ox = 0;
      let oy = 0;
      let oz = 0;
      if (chunk.position) {
        ox = chunk.position.x;
        oy = chunk.position.y;
        oz = chunk.position.z;
      } else if (chunk.matrixWorld) {
        const e = chunk.matrixWorld.elements;
        ox = e[12];
        oy = e[13];
        oz = e[14];
      }

      // 1. Copy positions with world translation baked in
      const srcPos = posAttr.array;
      const baseFloat = vOffset * 3;
      if (ox === 0 && oy === 0 && oz === 0) {
        posDst.set(srcPos.subarray(0, vCount * 3), baseFloat);
      } else {
        for (let i = 0; i < vCount; i++) {
          const si = i * 3;
          const di = baseFloat + si;
          posDst[di] = srcPos[si] + ox;
          posDst[di + 1] = srcPos[si + 1] + oy;
          posDst[di + 2] = srcPos[si + 2] + oz;
        }
      }

      // 2. Copy normals (handling both Float32 and normalized Int8)
      const normAttr = geo.attributes.normal;
      if (normAttr) {
        if (!normAttr.normalized && normAttr.array instanceof Float32Array) {
          normDst.set(normAttr.array.subarray(0, vCount * 3), baseFloat);
        } else {
          for (let i = 0; i < vCount; i++) {
            const di = baseFloat + i * 3;
            normDst[di] = normAttr.getX(i);
            normDst[di + 1] = normAttr.getY(i);
            normDst[di + 2] = normAttr.getZ(i);
          }
        }
      } else {
        for (let i = 0; i < vCount; i++) {
          const di = baseFloat + i * 3;
          normDst[di] = 0;
          normDst[di + 1] = 1;
          normDst[di + 2] = 0;
        }
      }

      // 2b. Copy UVs if present
      const uvAttr = geo.attributes.uv;
      const baseUv = vOffset * 2;
      if (uvAttr) {
        if (!uvAttr.normalized && uvAttr.array instanceof Float32Array) {
          uvDst.set(uvAttr.array.subarray(0, vCount * 2), baseUv);
        } else {
          for (let i = 0; i < vCount; i++) {
            const di = baseUv + i * 2;
            uvDst[di] = uvAttr.getX(i);
            uvDst[di + 1] = uvAttr.getY(i);
          }
        }
      } else {
        uvDst.fill(0, baseUv, baseUv + vCount * 2);
      }

      // 3. Copy vertex colors / baked AO (default white 1,1,1)
      const colAttr = geo.attributes.color;
      if (colAttr) {
        if (!colAttr.normalized && colAttr.array instanceof Float32Array) {
          colDst.set(colAttr.array.subarray(0, vCount * 3), baseFloat);
        } else {
          for (let i = 0; i < vCount; i++) {
            const di = baseFloat + i * 3;
            colDst[di] = colAttr.getX(i);
            colDst[di + 1] = colAttr.getY(i);
            colDst[di + 2] = colAttr.getZ(i);
          }
        }
      } else {
        colDst.fill(1.0, baseFloat, baseFloat + vCount * 3);
      }

      // 4. Copy or stamp voxelMaterial (Int8)
      const matAttr = geo.attributes.voxelMaterial;
      if (matAttr) {
        for (let i = 0; i < vCount; i++) {
          matDst[vOffset + i] = matAttr.array[i];
        }
      } else {
        matDst.fill(chunk.defaultMaterialId ?? 0, vOffset, vOffset + vCount);
      }

      // 5. Copy or stamp lodLevel (Int8)
      const lodAttr = geo.attributes.lodLevel;
      if (lodAttr) {
        for (let i = 0; i < vCount; i++) {
          lodDst[vOffset + i] = lodAttr.array[i];
        }
      } else {
        lodDst.fill(chunk.lodLevel ?? 0, vOffset, vOffset + vCount);
      }

      // 6. Offset indices by current vertex count
      if (srcIdx !== null) {
        const idxArr = srcIdx.array;
        for (let i = 0; i < iCount; i++) {
          idxDst[iOffset + i] = idxArr[i] + vOffset;
        }
      } else {
        for (let i = 0; i < vCount; i++) {
          idxDst[iOffset + i] = vOffset + i;
        }
      }

      vOffset += vCount;
      iOffset += iCount;
    }

    this.mergedVertexCount = vOffset;
    this.mergedIndexCount = iOffset;
    this.mergedGeometry.setDrawRange(0, iOffset);

    // Flag tight GPU sub-ranges for fast bufferSubData uploads
    if (vOffset > 0) {
      this._posAttr.clearUpdateRanges();
      this._posAttr.addUpdateRange(0, vOffset * 3);
      this._posAttr.needsUpdate = true;

      this._normAttr.clearUpdateRanges();
      this._normAttr.addUpdateRange(0, vOffset * 3);
      this._normAttr.needsUpdate = true;

      this._uvAttr.clearUpdateRanges();
      this._uvAttr.addUpdateRange(0, vOffset * 2);
      this._uvAttr.needsUpdate = true;

      this._colorAttr.clearUpdateRanges();
      this._colorAttr.addUpdateRange(0, vOffset * 3);
      this._colorAttr.needsUpdate = true;

      this._matIdAttr.clearUpdateRanges();
      this._matIdAttr.addUpdateRange(0, vOffset);
      this._matIdAttr.needsUpdate = true;

      this._lodAttr.clearUpdateRanges();
      this._lodAttr.addUpdateRange(0, vOffset);
      this._lodAttr.needsUpdate = true;

      this._indexAttr.clearUpdateRanges();
      this._indexAttr.addUpdateRange(0, iOffset);
      this._indexAttr.needsUpdate = true;
    }

    this.dirty = false;
    this.mergeCount++;

    // Snapshot visible chunk list for next-frame change detection
    this._prevVisibleChunks.length = this.visibleChunks.length;
    for (let i = 0; i < this.visibleChunks.length; i++) {
      this._prevVisibleChunks[i] = this.visibleChunks[i];
    }
  }

  /**
   * Frustum-culls chunks, re-merges ONLY if dirty or visible set changed,
   * and optionally issues ONE single draw call via renderer.renderBufferDirect().
   */
  update(
    chunks: BatchableChunk[] | null,
    camera: RenderCameraLike,
    renderer?: WebGLRenderer,
    scene: Scene | null = null,
  ): number {
    const source = chunks ?? this.chunks;
    this.cullChunks(source, camera);

    if (this.dirty || this.hasVisibleSetChanged(this.visibleChunks)) {
      this.mergeVisibleChunks();
    }

    this.drawCallsLastFrame = 0;
    if (renderer !== undefined && this.mergedIndexCount > 0) {
      this.render(renderer, camera, scene);
    }

    return this.visibleChunks.length;
  }

  render(renderer: WebGLRenderer, camera: RenderCameraLike, scene: Scene | null = null): void {
    if (this.mergedIndexCount === 0) {
      this.drawCallsLastFrame = 0;
      return;
    }

    renderer.renderBufferDirect(
      camera,
      scene,
      this.mergedGeometry,
      this.mergedMaterial,
      this.mesh as unknown as RenderableObjectLike,
      null,
    );
    this.drawCallsLastFrame = 1;
  }

  dispose(): void {
    this.mergedGeometry.dispose();
    this.mergedMaterial.dispose();
    this.chunks.length = 0;
    this.visibleChunks.length = 0;
    this._prevVisibleChunks.length = 0;
    this._cullPool.length = 0;
    this._cullCandidates.length = 0;
  }
}
