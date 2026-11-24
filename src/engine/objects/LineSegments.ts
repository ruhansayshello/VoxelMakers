import { Vector3 } from '../math';
import { BufferGeometry } from '../core/BufferGeometry';
import { Float32BufferAttribute } from '../core/BufferAttribute';
import type { BufferGeometryLike, MaterialLike } from '../core/Mesh';
import { LineBasicMaterial } from '../materials/LineBasicMaterial';
import { Line } from './Line';

const _start = new Vector3();
const _end = new Vector3();

export class LineSegments extends Line {
  override readonly isLineSegments = true;

  constructor(
    geometry: BufferGeometryLike = new BufferGeometry(),
    material: MaterialLike | MaterialLike[] = new LineBasicMaterial(),
  ) {
    super(geometry, material);
    this.type = 'LineSegments';
  }

  override computeLineDistances(): this {
    const geometry = this.geometry;
    if (geometry.index !== null) {
      return this;
    }

    const position = geometry.attributes.position;
    if (position === undefined) return this;

    const distances = new Float32Array(position.count);
    for (let i = 0; i + 1 < position.count; i += 2) {
      _start.fromBufferAttribute(position, i);
      _end.fromBufferAttribute(position, i + 1);
      distances[i] = i === 0 ? 0 : distances[i - 1];
      distances[i + 1] = distances[i] + _start.distanceTo(_end);
    }

    if (geometry instanceof BufferGeometry) {
      geometry.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1));
    } else {
      geometry.attributes.lineDistance = new Float32BufferAttribute(distances, 1);
    }

    return this;
  }

  override clone(recursive = true): this {
    const cloned = new LineSegments(this.geometry, this.material) as this;
    return cloned.copy(this, recursive);
  }
}
