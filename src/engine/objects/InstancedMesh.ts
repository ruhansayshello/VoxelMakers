import { Box3, Color, Matrix4, Sphere } from '../math';
import type { BufferGeometryLike, MaterialLike } from '../core/Mesh';
import { Mesh } from '../core/Mesh';
import { InstancedBufferAttribute } from '../core/InstancedBufferAttribute';
import { DynamicDrawUsage } from '../core/constants';

const _instanceLocalMatrix = new Matrix4();
const _box3 = new Box3();
const _sphere = new Sphere();

export class InstancedMesh extends Mesh {
  readonly isInstancedMesh = true;

  instanceMatrix: InstancedBufferAttribute;
  instanceColor: InstancedBufferAttribute | null = null;

  boundingBox: Box3 | null = null;
  boundingSphere: Sphere | null = null;

  private _maxCount: number;
  private _recycleCursor = 0;

  constructor(
    geometry?: BufferGeometryLike,
    material?: MaterialLike | MaterialLike[],
    count = 0,
  ) {
    super(geometry, material);
    this.type = 'InstancedMesh';

    const safeCount = Math.max(0, Math.floor(count));
    this._maxCount = safeCount;
    this.count = safeCount;
    const matArray = new Float32Array(safeCount * 16);
    for (let i = 0; i < safeCount; i++) {
      matArray[i * 16 + 15] = 1;
    }
    this.instanceMatrix = new InstancedBufferAttribute(matArray, 16);
    this.instanceMatrix.setUsage(DynamicDrawUsage);
    this.frustumCulled = true;
  }

  get maxCount(): number {
    return this._maxCount;
  }

  /**
   * Voxel-specific optimization: pre-allocates the instanceMatrix (and instanceColor
   * if present) to capacity `n` so high-churn debris pools never reallocate per frame.
   */
  setMaxCount(n: number): this {
    const capacity = Math.max(0, Math.floor(n));
    if (capacity === this._maxCount) return this;

    const nextMatrices = new Float32Array(capacity * 16);
    const copyLen = Math.min(this.instanceMatrix.array.length, nextMatrices.length);
    if (copyLen > 0) {
      nextMatrices.set(this.instanceMatrix.array.subarray(0, copyLen));
    }
    const prevSlots = Math.floor(copyLen / 16);
    for (let i = prevSlots; i < capacity; i++) {
      nextMatrices[i * 16 + 15] = 1;
    }
    this.instanceMatrix.setArray(nextMatrices);
    this.instanceMatrix.needsUpdate = true;

    if (this.instanceColor !== null) {
      const nextColors = new Float32Array(capacity * 3);
      const colorCopyLen = Math.min(this.instanceColor.array.length, nextColors.length);
      if (colorCopyLen > 0) {
        nextColors.set(this.instanceColor.array.subarray(0, colorCopyLen));
      }
      this.instanceColor.setArray(nextColors);
      this.instanceColor.needsUpdate = true;
    }

    this._maxCount = capacity;
    if (this.count > capacity) {
      this.count = capacity;
    }
    if (capacity === 0) {
      this._recycleCursor = 0;
    } else {
      this._recycleCursor = this._recycleCursor % capacity;
    }

    return this;
  }

  /**
   * Voxel-specific optimization: FIFO ring-buffer slot recycling when the debris
   * instance cap (e.g. 200) is reached. Returns the oldest slot index (0, 1, ..., maxCount - 1).
   */
  recycleInstance(): number {
    if (this._maxCount <= 0) return -1;
    const slot = this._recycleCursor;
    this._recycleCursor = (this._recycleCursor + 1) % this._maxCount;
    return slot;
  }

  resetRecycleCursor(): void {
    this._recycleCursor = 0;
  }

  setMatrixAt(index: number, matrix: Matrix4): void {
    matrix.toArray(this.instanceMatrix.array as Float32Array, index * 16);
  }

  getMatrixAt(index: number, matrix: Matrix4): void {
    matrix.fromArray(this.instanceMatrix.array as Float32Array, index * 16);
  }

  setColorAt(index: number, color: Color): void {
    if (this.instanceColor === null) {
      const capacity = Math.max(this._maxCount, this.count, index + 1);
      this.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      this.instanceColor.setUsage(DynamicDrawUsage);
    }
    color.toArray(this.instanceColor.array as Float32Array, index * 3);
  }

  getColorAt(index: number, color: Color): void {
    if (this.instanceColor === null) return;
    color.fromArray(this.instanceColor.array as Float32Array, index * 3);
  }

  computeBoundingBox(): void {
    const geometry = this.geometry;
    const count = this.count;

    if (this.boundingBox === null) {
      this.boundingBox = new Box3();
    }

    if (geometry.boundingBox === null) {
      geometry.computeBoundingBox();
    }

    this.boundingBox.makeEmpty();
    if (geometry.boundingBox === null) return;

    for (let i = 0; i < count; i++) {
      this.getMatrixAt(i, _instanceLocalMatrix);
      _box3.copy(geometry.boundingBox).applyMatrix4(_instanceLocalMatrix);
      this.boundingBox.union(_box3);
    }
  }

  computeBoundingSphere(): void {
    const geometry = this.geometry;
    const count = this.count;

    if (this.boundingSphere === null) {
      this.boundingSphere = new Sphere();
    }

    if (geometry.boundingSphere === null) {
      geometry.computeBoundingSphere();
    }

    this.boundingSphere.makeEmpty();
    if (geometry.boundingSphere === null) return;

    for (let i = 0; i < count; i++) {
      this.getMatrixAt(i, _instanceLocalMatrix);
      _sphere.copy(geometry.boundingSphere).applyMatrix4(_instanceLocalMatrix);
      this.boundingSphere.union(_sphere);
    }
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);

    this._maxCount = source._maxCount;
    this._recycleCursor = source._recycleCursor;
    this.count = source.count;
    this.instanceMatrix = source.instanceMatrix.clone();
    this.instanceColor = source.instanceColor !== null ? source.instanceColor.clone() : null;
    this.boundingBox = source.boundingBox !== null ? source.boundingBox.clone() : null;
    this.boundingSphere = source.boundingSphere !== null ? source.boundingSphere.clone() : null;

    return this;
  }

  override clone(recursive = true): this {
    const cloned = new InstancedMesh(this.geometry, this.material, this._maxCount) as this;
    return cloned.copy(this, recursive);
  }

  override raycast(): void {
    // Intentionally skipped for v1 (voxel debris does not participate in triangle raycasting)
  }

  dispose(): void {
    this.dispatchEvent({ type: 'dispose' });
  }
}
