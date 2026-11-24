import { Color, Matrix4, Vector3 } from '../../math';
import type { Object3D } from '../../core/Object3D';

export interface LightLike extends Object3D {
  isLight?: boolean;
  isAmbientLight?: boolean;
  isHemisphereLight?: boolean;
  isDirectionalLight?: boolean;
  isPointLight?: boolean;
  color: Color;
  groundColor?: Color;
  intensity: number;
  distance?: number;
  decay?: number;
  target?: Object3D;
}

export interface DirectionalLightUniform {
  direction: Vector3;
  color: Color;
}

export interface HemisphereLightUniform {
  direction: Vector3;
  skyColor: Color;
  groundColor: Color;
}

export interface PointLightUniform {
  position: Vector3;
  color: Color;
  distance: number;
  decay: number;
}

export interface LightsState {
  ambient: Color;
  directional: DirectionalLightUniform[];
  hemisphere: HemisphereLightUniform[];
  point: PointLightUniform[];
  numDirLights: number;
  numHemiLights: number;
  numPointLights: number;
}

const _vec = new Vector3();
const _targetPos = new Vector3();

export class WebGLRenderState {
  readonly lightsArray: LightLike[] = [];

  readonly lightsState: LightsState = {
    ambient: new Color(0, 0, 0),
    directional: [],
    hemisphere: [],
    point: [],
    numDirLights: 0,
    numHemiLights: 0,
    numPointLights: 0,
  };

  init(): void {
    this.lightsArray.length = 0;
  }

  pushLight(light: LightLike): void {
    this.lightsArray.push(light);
  }

  setupLights(cameraMatrixWorldInverse: Matrix4): void {
    const state = this.lightsState;
    let r = 0;
    let g = 0;
    let b = 0;

    let dirIdx = 0;
    let hemiIdx = 0;
    let pointIdx = 0;

    for (let i = 0; i < this.lightsArray.length; i++) {
      const light = this.lightsArray[i];
      const color = light.color;
      const intensity = light.intensity;

      if (light.isAmbientLight) {
        r += color.r * intensity;
        g += color.g * intensity;
        b += color.b * intensity;
      } else if (light.isHemisphereLight) {
        let entry = state.hemisphere[hemiIdx];
        if (!entry) {
          entry = {
            direction: new Vector3(),
            skyColor: new Color(),
            groundColor: new Color(),
          };
          state.hemisphere[hemiIdx] = entry;
        }

        entry.direction.setFromMatrixPosition(light.matrixWorld);
        entry.direction.transformDirection(cameraMatrixWorldInverse);
        entry.skyColor.copy(color).multiplyScalar(intensity);
        if (light.groundColor) {
          entry.groundColor.copy(light.groundColor).multiplyScalar(intensity);
        } else {
          entry.groundColor.setRGB(0, 0, 0);
        }
        hemiIdx++;
      } else if (light.isDirectionalLight) {
        let entry = state.directional[dirIdx];
        if (!entry) {
          entry = { direction: new Vector3(), color: new Color() };
          state.directional[dirIdx] = entry;
        }

        _vec.setFromMatrixPosition(light.matrixWorld);
        if (light.target) {
          _targetPos.setFromMatrixPosition(light.target.matrixWorld);
          _vec.sub(_targetPos);
        }
        _vec.transformDirection(cameraMatrixWorldInverse);
        entry.direction.copy(_vec);
        entry.color.copy(color).multiplyScalar(intensity);
        dirIdx++;
      } else if (light.isPointLight) {
        let entry = state.point[pointIdx];
        if (!entry) {
          entry = {
            position: new Vector3(),
            color: new Color(),
            distance: 0,
            decay: 2,
          };
          state.point[pointIdx] = entry;
        }

        entry.position.setFromMatrixPosition(light.matrixWorld);
        entry.position.applyMatrix4(cameraMatrixWorldInverse);
        entry.color.copy(color).multiplyScalar(intensity);
        entry.distance = light.distance ?? 0;
        entry.decay = light.decay ?? 2;
        pointIdx++;
      }
    }

    state.ambient.setRGB(r, g, b);
    state.directional.length = dirIdx;
    state.hemisphere.length = hemiIdx;
    state.point.length = pointIdx;
    state.numDirLights = dirIdx;
    state.numHemiLights = hemiIdx;
    state.numPointLights = pointIdx;
  }
}

export class WebGLRenderStates {
  private states = new WeakMap<object, WebGLRenderState>();

  get(scene: object): WebGLRenderState {
    let state = this.states.get(scene);
    if (state === undefined) {
      state = new WebGLRenderState();
      this.states.set(scene, state);
    }
    return state;
  }

  dispose(): void {
    this.states = new WeakMap<object, WebGLRenderState>();
  }
}
