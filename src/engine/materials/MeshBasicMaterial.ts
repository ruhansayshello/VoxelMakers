import { Color, Euler, type ColorRepresentation } from '../math';
import { MultiplyOperation } from '../core/constants';
import { Material, type MaterialParameters, type TextureLike } from './Material';

export interface MeshBasicMaterialParameters extends MaterialParameters {
  color?: ColorRepresentation;
  map?: TextureLike | null;
  lightMap?: TextureLike | null;
  lightMapIntensity?: number;
  aoMap?: TextureLike | null;
  aoMapIntensity?: number;
  specularMap?: TextureLike | null;
  alphaMap?: TextureLike | null;
  envMap?: TextureLike | null;
  envMapRotation?: Euler;
  combine?: number;
  reflectivity?: number;
  refractionRatio?: number;
  wireframe?: boolean;
  wireframeLinewidth?: number;
  wireframeLinecap?: string;
  wireframeLinejoin?: string;
}

export class MeshBasicMaterial extends Material {
  readonly isMeshBasicMaterial = true;

  color: Color = new Color(0xffffff);

  map: TextureLike | null = null;
  lightMap: TextureLike | null = null;
  lightMapIntensity = 1.0;

  aoMap: TextureLike | null = null;
  aoMapIntensity = 1.0;

  specularMap: TextureLike | null = null;
  alphaMap: TextureLike | null = null;

  envMap: TextureLike | null = null;
  envMapRotation: Euler = new Euler();
  combine: number = MultiplyOperation;
  reflectivity = 1;
  refractionRatio = 0.98;

  wireframe = false;
  wireframeLinewidth = 1;
  wireframeLinecap = 'round';
  wireframeLinejoin = 'round';

  constructor(parameters?: MeshBasicMaterialParameters) {
    super();
    this.type = 'MeshBasicMaterial';
    this.fog = true;
    this.setValues(parameters as Record<string, unknown> | undefined);
  }

  override copy(source: this): this {
    super.copy(source);

    this.color.copy(source.color);
    this.map = source.map;
    this.lightMap = source.lightMap;
    this.lightMapIntensity = source.lightMapIntensity;
    this.aoMap = source.aoMap;
    this.aoMapIntensity = source.aoMapIntensity;
    this.specularMap = source.specularMap;
    this.alphaMap = source.alphaMap;

    this.envMap = source.envMap;
    this.envMapRotation.copy(source.envMapRotation);
    this.combine = source.combine;
    this.reflectivity = source.reflectivity;
    this.refractionRatio = source.refractionRatio;

    this.wireframe = source.wireframe;
    this.wireframeLinewidth = source.wireframeLinewidth;
    this.wireframeLinecap = source.wireframeLinecap;
    this.wireframeLinejoin = source.wireframeLinejoin;

    return this;
  }

  override toJSON(meta?: Record<string, unknown>): Record<string, unknown> {
    const data = super.toJSON(meta);
    data.color = this.color.getHex();
    if (this.wireframe) data.wireframe = true;
    if (this.wireframeLinewidth !== 1) data.wireframeLinewidth = this.wireframeLinewidth;
    if (this.combine !== MultiplyOperation) data.combine = this.combine;
    if (this.reflectivity !== 1) data.reflectivity = this.reflectivity;
    if (this.refractionRatio !== 0.98) data.refractionRatio = this.refractionRatio;
    if (this.lightMapIntensity !== 1) data.lightMapIntensity = this.lightMapIntensity;
    if (this.aoMapIntensity !== 1) data.aoMapIntensity = this.aoMapIntensity;
    if (this.map && this.map.uuid) data.map = this.map.uuid;
    if (this.alphaMap && this.alphaMap.uuid) data.alphaMap = this.alphaMap.uuid;
    if (this.envMap && this.envMap.uuid) data.envMap = this.envMap.uuid;
    return data;
  }
}
