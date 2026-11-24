import { Color, Vector2, type ColorRepresentation } from '../math';
import { Float32BufferAttribute } from '../core/BufferAttribute';
import { BufferGeometry } from '../core/BufferGeometry';
import { Object3D } from '../core/Object3D';
import { LineBasicMaterial } from '../materials/LineBasicMaterial';
import { PointsMaterial } from '../materials/PointsMaterial';
import { SpriteMaterial } from '../materials/ExtendedMaterials';
import type { Material } from '../materials/Material';
import { Line } from './Line';
import { LineSegments } from './LineSegments';

let _spriteGeometry: BufferGeometry | null = null;

function getSharedSpriteGeometry(): BufferGeometry {
  if (_spriteGeometry === null) {
    _spriteGeometry = new BufferGeometry();
    _spriteGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    _spriteGeometry.setAttribute(
      'position',
      new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
    );
    _spriteGeometry.setAttribute(
      'uv',
      new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
    );
  }
  return _spriteGeometry;
}

export class Sprite extends Object3D {
  readonly isSprite = true;
  readonly isMesh = true;
  override type = 'Sprite';

  geometry: BufferGeometry;
  material: SpriteMaterial;
  center = new Vector2(0.5, 0.5);

  constructor(material: SpriteMaterial = new SpriteMaterial()) {
    super();
    this.geometry = getSharedSpriteGeometry();
    this.material = material;
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    this.center.copy(source.center);
    this.material = source.material;
    return this;
  }
}

export class Points extends Object3D {
  readonly isPoints = true;
  override type = 'Points';

  geometry: BufferGeometry;
  material: Material | Material[];

  constructor(
    geometry: BufferGeometry = new BufferGeometry(),
    material: Material | Material[] = new PointsMaterial(),
  ) {
    super();
    this.geometry = geometry;
    this.material = material;
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    this.material = Array.isArray(source.material) ? source.material.slice() : source.material;
    this.geometry = source.geometry;
    return this;
  }
}

export class LineLoop extends Line {
  readonly isLineLoop = true;
  override type = 'LineLoop';
}

export class GridHelper extends LineSegments {
  override type = 'GridHelper';

  constructor(
    size = 10,
    divisions = 10,
    color1: ColorRepresentation = 0x444444,
    color2: ColorRepresentation = 0x888888,
  ) {
    const c1 = new Color(color1);
    const c2 = new Color(color2);
    const center = divisions / 2;
    const step = size / divisions;
    const halfSize = size / 2;

    const vertices: number[] = [];
    const colors: number[] = [];

    for (let i = 0, j = 0, k = -halfSize; i <= divisions; i++, k += step) {
      vertices.push(-halfSize, 0, k, halfSize, 0, k);
      vertices.push(k, 0, -halfSize, k, 0, halfSize);

      const color = i === center ? c1 : c2;
      color.toArray(colors, j); j += 3;
      color.toArray(colors, j); j += 3;
      color.toArray(colors, j); j += 3;
      color.toArray(colors, j); j += 3;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

    const material = new LineBasicMaterial({ vertexColors: true, toneMapped: false });
    super(geometry, material);
  }

  dispose(): void {
    (this.geometry as BufferGeometry).dispose?.();
    if (!Array.isArray(this.material)) {
      (this.material as Material).dispose?.();
    }
  }
}
