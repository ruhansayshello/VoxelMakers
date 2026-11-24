import { Matrix4 } from '../math';
import { Float32BufferAttribute } from '../core/BufferAttribute';
import { BufferGeometry } from '../core/BufferGeometry';
import { Mesh } from '../core/Mesh';
import { Object3D } from '../core/Object3D';
import type { Material } from '../materials/Material';
import type { RenderCameraLike, WebGLRenderer } from '../renderers/WebGLRenderer';

function createScreenTriangleGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
  );
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  return geometry;
}

function createOrthographicNDCCamera(): RenderCameraLike {
  const cam = new Object3D() as RenderCameraLike;
  cam.isCamera = true;
  cam.matrixWorld.identity();
  cam.matrixWorldInverse = new Matrix4();
  cam.projectionMatrix = new Matrix4();
  cam.matrixAutoUpdate = false;
  cam.matrixWorldAutoUpdate = false;
  return cam;
}

const _sharedCamera = createOrthographicNDCCamera();

export class FullScreenQuad {
  readonly geometry: BufferGeometry;
  readonly mesh: Mesh;

  constructor(material?: Material) {
    this.geometry = createScreenTriangleGeometry();
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
  }

  get material(): Material {
    return this.mesh.material as Material;
  }

  set material(value: Material) {
    this.mesh.material = value;
  }

  render(renderer: WebGLRenderer): void {
    renderer.renderBufferDirect(
      _sharedCamera,
      null,
      this.geometry,
      this.mesh.material as Material,
      this.mesh as unknown as Parameters<WebGLRenderer['renderBufferDirect']>[4],
      null,
    );
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
