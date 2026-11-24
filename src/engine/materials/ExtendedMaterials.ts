import { Color, Vector2, type ColorRepresentation } from '../math';
import { Material, type MaterialParameters, type TextureLike } from './Material';
import { MeshLambertMaterial, type MeshLambertMaterialParameters } from './MeshLambertMaterial';

export interface MeshStandardMaterialParameters extends MeshLambertMaterialParameters {
  roughness?: number;
  metalness?: number;
  roughnessMap?: TextureLike | null;
  metalnessMap?: TextureLike | null;
  envMapIntensity?: number;
  normalMap?: TextureLike | null;
  normalScale?: Vector2;
  bumpMap?: TextureLike | null;
  bumpScale?: number;
  aoMap?: TextureLike | null;
  aoMapIntensity?: number;
  displacementMap?: TextureLike | null;
  displacementScale?: number;
  displacementBias?: number;
}

export class MeshStandardMaterial extends MeshLambertMaterial {
  readonly isMeshStandardMaterial = true;
  override type = 'MeshStandardMaterial';

  roughness = 1.0;
  metalness = 0.0;
  roughnessMap: TextureLike | null = null;
  metalnessMap: TextureLike | null = null;
  envMapIntensity = 1.0;
  normalMap: TextureLike | null = null;
  normalScale = new Vector2(1, 1);
  bumpMap: TextureLike | null = null;
  bumpScale = 1;
  aoMap: TextureLike | null = null;
  aoMapIntensity = 1;
  displacementMap: TextureLike | null = null;
  displacementScale = 1;
  displacementBias = 0;

  constructor(parameters?: MeshStandardMaterialParameters) {
    super();
    if (parameters !== undefined) {
      this.setValues(parameters as unknown as Record<string, unknown>);
    }
  }
}

export interface MeshPhysicalMaterialParameters extends MeshStandardMaterialParameters {
  clearcoat?: number;
  clearcoatRoughness?: number;
  ior?: number;
  reflectivity?: number;
  sheen?: number;
  sheenRoughness?: number;
  sheenColor?: ColorRepresentation;
  transmission?: number;
  thickness?: number;
  specularIntensity?: number;
  specularColor?: ColorRepresentation;
}

export class MeshPhysicalMaterial extends MeshStandardMaterial {
  readonly isMeshPhysicalMaterial = true;
  override type = 'MeshPhysicalMaterial';

  clearcoat = 0;
  clearcoatRoughness = 0;
  ior = 1.5;
  reflectivity = 0.5;
  sheen = 0;
  sheenRoughness = 1;
  sheenColor = new Color(0x000000);
  transmission = 0;
  thickness = 0;
  specularIntensity = 1;
  specularColor = new Color(0xffffff);

  constructor(parameters?: MeshPhysicalMaterialParameters) {
    super();
    if (parameters !== undefined) {
      this.setValues(parameters as unknown as Record<string, unknown>);
    }
  }
}

export interface MeshPhongMaterialParameters extends MeshLambertMaterialParameters {
  specular?: ColorRepresentation;
  shininess?: number;
  specularMap?: TextureLike | null;
  normalMap?: TextureLike | null;
  normalScale?: Vector2;
  bumpMap?: TextureLike | null;
  bumpScale?: number;
}

export class MeshPhongMaterial extends MeshLambertMaterial {
  readonly isMeshPhongMaterial = true;
  override type = 'MeshPhongMaterial';

  specular = new Color(0x111111);
  shininess = 30;
  specularMap: TextureLike | null = null;
  normalMap: TextureLike | null = null;
  normalScale = new Vector2(1, 1);
  bumpMap: TextureLike | null = null;
  bumpScale = 1;

  constructor(parameters?: MeshPhongMaterialParameters) {
    super();
    if (parameters !== undefined) {
      this.setValues(parameters as unknown as Record<string, unknown>);
    }
  }
}

export interface SpriteMaterialParameters extends MaterialParameters {
  color?: ColorRepresentation;
  map?: TextureLike | null;
  alphaMap?: TextureLike | null;
  rotation?: number;
  sizeAttenuation?: boolean;
}

export class SpriteMaterial extends Material {
  readonly isSpriteMaterial = true;
  override type = 'SpriteMaterial';

  color = new Color(0xffffff);
  map: TextureLike | null = null;
  alphaMap: TextureLike | null = null;
  rotation = 0;
  sizeAttenuation = true;

  constructor(parameters?: SpriteMaterialParameters) {
    super();
    this.transparent = true;
    if (parameters !== undefined) {
      this.setValues(parameters as unknown as Record<string, unknown>);
    }
  }

  override copy(source: this): this {
    super.copy(source);
    this.color.copy(source.color);
    this.map = source.map;
    this.alphaMap = source.alphaMap;
    this.rotation = source.rotation;
    this.sizeAttenuation = source.sizeAttenuation;
    return this;
  }
}
