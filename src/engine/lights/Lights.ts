import { Color, Matrix4, Vector2, type ColorRepresentation } from '../math';
import { Object3D } from '../core/Object3D';
import { OrthographicCamera, PerspectiveCamera, type Camera } from '../cameras/Camera';

export class LightShadow<TCamera extends Camera = Camera> {
  camera: TCamera;
  intensity = 1;
  bias = 0;
  normalBias = 0;
  radius = 1;
  blurSamples = 8;
  mapSize = new Vector2(512, 512);
  map: unknown = null;
  mapPass: unknown = null;
  matrix = new Matrix4();
  autoUpdate = true;
  needsUpdate = false;

  constructor(camera: TCamera) {
    this.camera = camera;
  }

  dispose(): void {
    if (this.map && typeof (this.map as { dispose?: () => void }).dispose === 'function') {
      (this.map as { dispose: () => void }).dispose();
    }
    this.map = null;
    this.mapPass = null;
  }
}

export class Light extends Object3D {
  readonly isLight = true;
  override type = 'Light';

  color: Color;
  intensity: number;

  constructor(color?: ColorRepresentation, intensity = 1) {
    super();
    this.color = new Color(color ?? 0xffffff);
    this.intensity = intensity;
  }

  dispose(): void {
    // Subclasses with shadows override
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    this.color.copy(source.color);
    this.intensity = source.intensity;
    return this;
  }
}

export class AmbientLight extends Light {
  readonly isAmbientLight = true;
  override type = 'AmbientLight';

  constructor(color?: ColorRepresentation, intensity = 1) {
    super(color, intensity);
  }
}

export class HemisphereLight extends Light {
  readonly isHemisphereLight = true;
  override type = 'HemisphereLight';

  groundColor: Color;

  constructor(skyColor?: ColorRepresentation, groundColor?: ColorRepresentation, intensity = 1) {
    super(skyColor, intensity);
    this.position.copy(Object3D.DEFAULT_UP);
    this.updateMatrix();
    this.groundColor = new Color(groundColor ?? 0x444444);
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    this.groundColor.copy(source.groundColor);
    return this;
  }
}

export class DirectionalLight extends Light {
  readonly isDirectionalLight = true;
  override type = 'DirectionalLight';

  target = new Object3D();
  shadow: LightShadow<OrthographicCamera>;

  constructor(color?: ColorRepresentation, intensity = 1) {
    super(color, intensity);
    this.position.copy(Object3D.DEFAULT_UP);
    this.updateMatrix();
    this.shadow = new LightShadow(new OrthographicCamera(-5, 5, 5, -5, 0.5, 500));
  }

  override dispose(): void {
    this.shadow.dispose();
  }
}

export class PointLight extends Light {
  readonly isPointLight = true;
  override type = 'PointLight';

  distance: number;
  decay: number;
  shadow: LightShadow<PerspectiveCamera>;

  constructor(color?: ColorRepresentation, intensity = 1, distance = 0, decay = 2) {
    super(color, intensity);
    this.distance = distance;
    this.decay = decay;
    this.shadow = new LightShadow(new PerspectiveCamera(90, 1, 0.5, 500));
  }

  get power(): number {
    return this.intensity * 4 * Math.PI;
  }

  set power(power: number) {
    this.intensity = power / (4 * Math.PI);
  }

  override dispose(): void {
    this.shadow.dispose();
  }
}

export class SpotLight extends Light {
  readonly isSpotLight = true;
  override type = 'SpotLight';

  target = new Object3D();
  distance: number;
  angle: number;
  penumbra: number;
  decay: number;
  map: unknown = null;
  shadow: LightShadow<PerspectiveCamera>;

  constructor(
    color?: ColorRepresentation,
    intensity = 1,
    distance = 0,
    angle = Math.PI / 3,
    penumbra = 0,
    decay = 2,
  ) {
    super(color, intensity);
    this.position.copy(Object3D.DEFAULT_UP);
    this.updateMatrix();
    this.distance = distance;
    this.angle = angle;
    this.penumbra = penumbra;
    this.decay = decay;
    this.shadow = new LightShadow(new PerspectiveCamera(50, 1, 0.5, 500));
  }

  get power(): number {
    return this.intensity * Math.PI;
  }

  set power(power: number) {
    this.intensity = power / Math.PI;
  }

  override dispose(): void {
    this.shadow.dispose();
  }
}
