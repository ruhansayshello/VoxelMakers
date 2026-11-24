import { Color, Euler, Vector2, type ColorRepresentation } from '../math';
import { MultiplyOperation, TangentSpaceNormalMap } from '../core/constants';
import { Material, type MaterialParameters, type TextureLike } from './Material';

export interface MeshLambertMaterialParameters extends MaterialParameters {
  color?: ColorRepresentation;
  emissive?: ColorRepresentation;
  emissiveIntensity?: number;
  emissiveMap?: TextureLike | null;
  map?: TextureLike | null;
  lightMap?: TextureLike | null;
  lightMapIntensity?: number;
  aoMap?: TextureLike | null;
  aoMapIntensity?: number;
  bumpMap?: TextureLike | null;
  bumpScale?: number;
  normalMap?: TextureLike | null;
  normalMapType?: number;
  normalScale?: Vector2;
  displacementMap?: TextureLike | null;
  displacementScale?: number;
  displacementBias?: number;
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
  flatShading?: boolean;
}

export class MeshLambertMaterial extends Material {
  readonly isMeshLambertMaterial = true;

  color: Color = new Color(0xffffff);

  map: TextureLike | null = null;
  lightMap: TextureLike | null = null;
  lightMapIntensity = 1.0;

  aoMap: TextureLike | null = null;
  aoMapIntensity = 1.0;

  emissive: Color = new Color(0x000000);
  emissiveIntensity = 1.0;
  emissiveMap: TextureLike | null = null;

  bumpMap: TextureLike | null = null;
  bumpScale = 1;

  normalMap: TextureLike | null = null;
  normalMapType: number = TangentSpaceNormalMap;
  normalScale: Vector2 = new Vector2(1, 1);

  displacementMap: TextureLike | null = null;
  displacementScale = 1;
  displacementBias = 0;

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

  flatShading = false;

  constructor(parameters?: MeshLambertMaterialParameters) {
    super();
    this.type = 'MeshLambertMaterial';
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

    this.emissive.copy(source.emissive);
    this.emissiveIntensity = source.emissiveIntensity;
    this.emissiveMap = source.emissiveMap;

    this.bumpMap = source.bumpMap;
    this.bumpScale = source.bumpScale;

    this.normalMap = source.normalMap;
    this.normalMapType = source.normalMapType;
    this.normalScale.copy(source.normalScale);

    this.displacementMap = source.displacementMap;
    this.displacementScale = source.displacementScale;
    this.displacementBias = source.displacementBias;

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

    this.flatShading = source.flatShading;

    return this;
  }

  override toJSON(meta?: Record<string, unknown>): Record<string, unknown> {
    const data = super.toJSON(meta);
    data.color = this.color.getHex();
    data.emissive = this.emissive.getHex();
    if (this.emissiveIntensity !== 1) data.emissiveIntensity = this.emissiveIntensity;
    if (this.flatShading) data.flatShading = true;
    if (this.wireframe) data.wireframe = true;
    if (this.wireframeLinewidth !== 1) data.wireframeLinewidth = this.wireframeLinewidth;
    if (this.combine !== MultiplyOperation) data.combine = this.combine;
    if (this.reflectivity !== 1) data.reflectivity = this.reflectivity;
    if (this.refractionRatio !== 0.98) data.refractionRatio = this.refractionRatio;
    if (this.map && this.map.uuid) data.map = this.map.uuid;
    if (this.emissiveMap && this.emissiveMap.uuid) data.emissiveMap = this.emissiveMap.uuid;
    if (this.normalMap && this.normalMap.uuid) {
      data.normalMap = this.normalMap.uuid;
      data.normalScale = this.normalScale.toArray();
    }
    return data;
  }
}
