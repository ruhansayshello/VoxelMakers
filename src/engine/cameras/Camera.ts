import { Matrix4, Vector3, WebGLCoordinateSystem, type CoordinateSystem } from '../math';
import { DEG2RAD } from '../math/MathUtils';
import { Object3D } from '../core/Object3D';

export interface CameraViewOffset {
  enabled: boolean;
  fullWidth: number;
  fullHeight: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export class Camera extends Object3D {
  readonly isCamera = true;
  override type = 'Camera';

  matrixWorldInverse = new Matrix4();
  projectionMatrix = new Matrix4();
  projectionMatrixInverse = new Matrix4();
  coordinateSystem: CoordinateSystem = WebGLCoordinateSystem;
  reversedDepth = false;

  constructor() {
    super();
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    this.matrixWorldInverse.copy(source.matrixWorldInverse);
    this.projectionMatrix.copy(source.projectionMatrix);
    this.projectionMatrixInverse.copy(source.projectionMatrixInverse);
    this.coordinateSystem = source.coordinateSystem;
    return this;
  }

  override getWorldDirection(target: Vector3): Vector3 {
    return super.getWorldDirection(target).negate();
  }

  override updateMatrixWorld(force = false): void {
    super.updateMatrixWorld(force);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }

  override updateWorldMatrix(updateParents = false, updateChildren = false): void {
    super.updateWorldMatrix(updateParents, updateChildren);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }

  override clone(recursive = true): this {
    return new (this.constructor as new () => this)().copy(this, recursive);
  }
}

export class PerspectiveCamera extends Camera {
  readonly isPerspectiveCamera = true;
  override type = 'PerspectiveCamera';

  fov: number;
  zoom = 1;
  near: number;
  far: number;
  focus = 10;
  aspect: number;
  view: CameraViewOffset | null = null;
  filmGauge = 35;
  filmOffset = 0;

  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    this.fov = source.fov;
    this.zoom = source.zoom;
    this.near = source.near;
    this.far = source.far;
    this.focus = source.focus;
    this.aspect = source.aspect;
    this.view = source.view === null ? null : { ...source.view };
    this.filmGauge = source.filmGauge;
    this.filmOffset = source.filmOffset;
    return this;
  }

  setViewOffset(
    fullWidth: number,
    fullHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.aspect = fullWidth / fullHeight;
    if (this.view === null) {
      this.view = {
        enabled: true,
        fullWidth: 1,
        fullHeight: 1,
        offsetX: 0,
        offsetY: 0,
        width: 1,
        height: 1,
      };
    }
    this.view.enabled = true;
    this.view.fullWidth = fullWidth;
    this.view.fullHeight = fullHeight;
    this.view.offsetX = x;
    this.view.offsetY = y;
    this.view.width = width;
    this.view.height = height;
    this.updateProjectionMatrix();
  }

  clearViewOffset(): void {
    if (this.view !== null) {
      this.view.enabled = false;
    }
    this.updateProjectionMatrix();
  }

  getFilmWidth(): number {
    return this.filmGauge * Math.min(this.aspect, 1);
  }

  getFilmHeight(): number {
    return this.filmGauge / Math.max(this.aspect, 1);
  }

  getEffectiveFOV(): number {
    return (2 * Math.atan(Math.tan(DEG2RAD * 0.5 * this.fov) / this.zoom)) / DEG2RAD;
  }

  updateProjectionMatrix(): void {
    const near = this.near;
    let top = (near * Math.tan(DEG2RAD * 0.5 * this.fov)) / this.zoom;
    let height = 2 * top;
    let width = this.aspect * height;
    let left = -0.5 * width;
    const view = this.view;

    if (view !== null && view.enabled) {
      const fullWidth = view.fullWidth;
      const fullHeight = view.fullHeight;
      left += (view.offsetX * width) / fullWidth;
      top -= (view.offsetY * height) / fullHeight;
      width *= view.width / fullWidth;
      height *= view.height / fullHeight;
    }

    const skew = this.filmOffset;
    if (skew !== 0) left += (near * skew) / this.getFilmWidth();

    this.projectionMatrix.makePerspective(
      left,
      left + width,
      top,
      top - height,
      near,
      this.far,
      this.coordinateSystem,
      this.reversedDepth,
    );
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}

export class OrthographicCamera extends Camera {
  readonly isOrthographicCamera = true;
  override type = 'OrthographicCamera';

  zoom = 1;
  view: CameraViewOffset | null = null;
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;

  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super();
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    this.left = source.left;
    this.right = source.right;
    this.top = source.top;
    this.bottom = source.bottom;
    this.near = source.near;
    this.far = source.far;
    this.zoom = source.zoom;
    this.view = source.view === null ? null : { ...source.view };
    return this;
  }

  setViewOffset(
    fullWidth: number,
    fullHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (this.view === null) {
      this.view = {
        enabled: true,
        fullWidth: 1,
        fullHeight: 1,
        offsetX: 0,
        offsetY: 0,
        width: 1,
        height: 1,
      };
    }
    this.view.enabled = true;
    this.view.fullWidth = fullWidth;
    this.view.fullHeight = fullHeight;
    this.view.offsetX = x;
    this.view.offsetY = y;
    this.view.width = width;
    this.view.height = height;
    this.updateProjectionMatrix();
  }

  clearViewOffset(): void {
    if (this.view !== null) {
      this.view.enabled = false;
    }
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix(): void {
    const dx = (this.right - this.left) / (2 * this.zoom);
    const dy = (this.top - this.bottom) / (2 * this.zoom);
    const cx = (this.right + this.left) / 2;
    const cy = (this.top + this.bottom) / 2;

    let left = cx - dx;
    let right = cx + dx;
    let top = cy + dy;
    let bottom = cy - dy;

    if (this.view !== null && this.view.enabled) {
      const scaleW = (this.right - this.left) / this.view.fullWidth / this.zoom;
      const scaleH = (this.top - this.bottom) / this.view.fullHeight / this.zoom;
      left += scaleW * this.view.offsetX;
      right = left + scaleW * this.view.width;
      top -= scaleH * this.view.offsetY;
      bottom = top - scaleH * this.view.height;
    }

    this.projectionMatrix.makeOrthographic(
      left,
      right,
      top,
      bottom,
      this.near,
      this.far,
      this.coordinateSystem,
      this.reversedDepth,
    );
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
