import { Vector3 } from '../math';
import { BufferGeometry } from '../core/BufferGeometry';
import { Float32BufferAttribute } from '../core/BufferAttribute';
import { Mesh, type BufferGeometryLike, type MaterialLike } from '../core/Mesh';
import { LineBasicMaterial } from '../materials/LineBasicMaterial';

const _start = new Vector3();
const _end = new Vector3();

export class Line extends Mesh {
  override isMesh = false;
  readonly isLine = true;
  isLineSegments = false;

  constructor(
    geometry: BufferGeometryLike = new BufferGeometry(),
    material: MaterialLike | MaterialLike[] = new LineBasicMaterial(),
  ) {
    super(geometry, material);
    this.type = 'Line';
  }

  computeLineDistances(): this {
    const geometry = this.geometry;
    if (geometry.index !== null) {
      return this;
    }

    const position = geometry.attributes.position;
    if (position === undefined) return this;

    const distances = new Float32Array(position.count);
    if (position.count > 0) {
      distances[0] = 0;
      for (let i = 1; i < position.count; i++) {
        _start.fromBufferAttribute(position, i - 1);
        _end.fromBufferAttribute(position, i);
        distances[i] = distances[i - 1] + _start.distanceTo(_end);
      }
    }

    if (geometry instanceof BufferGeometry) {
      geometry.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1));
    } else {
      geometry.attributes.lineDistance = new Float32BufferAttribute(distances, 1);
    }

    return this;
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    return this;
  }

  override clone(recursive = true): this {
    const cloned = new Line(this.geometry, this.material) as this;
    return cloned.copy(this, recursive);
  }
}
