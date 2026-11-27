import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE_REF from 'three';
import * as Engine from './index';
import * as EngineConstants from './constants';

test('src/voxl/constants.ts matches Three.js constants exactly', () => {
  const checkedKeys: string[] = [];
  for (const [key, value] of Object.entries(EngineConstants)) {
    const refVal = (THREE_REF as Record<string, unknown>)[key];
    if (refVal !== undefined) {
      assert.deepEqual(
        value,
        refVal,
        `Constant mismatch for ${key}: engine=${JSON.stringify(value)} vs three=${JSON.stringify(refVal)}`,
      );
      checkedKeys.push(key);
    }
  }
  assert.ok(checkedKeys.length >= 100, `Expected >= 100 matched constants, got ${checkedKeys.length}`);
  assert.equal(Engine.NoToneMapping, THREE_REF.NoToneMapping);
  assert.equal(Engine.FrontSide, THREE_REF.FrontSide);
  assert.equal(Engine.BackSide, THREE_REF.BackSide);
  assert.equal(Engine.DoubleSide, THREE_REF.DoubleSide);
  assert.equal(Engine.SRGBColorSpace, THREE_REF.SRGBColorSpace);
  assert.equal(Engine.PCFSoftShadowMap, THREE_REF.PCFSoftShadowMap);
});

test('Cameras, Lights, MathUtils, Geometries, Materials, Sprite & GridHelper parity', () => {
  // MathUtils
  assert.equal(Engine.MathUtils.clamp(15, 0, 10), 10);
  assert.ok(Math.abs(Engine.MathUtils.degToRad(180) - Math.PI) < 1e-6);
  assert.ok(Math.abs(Engine.MathUtils.lerp(10, 20, 0.25) - 12.5) < 1e-6);

  // Cameras
  const persp = new Engine.PerspectiveCamera(60, 16 / 9, 0.5, 500);
  const refPersp = new THREE_REF.PerspectiveCamera(60, 16 / 9, 0.5, 500);
  for (let i = 0; i < 16; i++) {
    assert.ok(
      Math.abs(persp.projectionMatrix.elements[i] - refPersp.projectionMatrix.elements[i]) < 1e-5,
      `PerspectiveCamera projectionMatrix[${i}] mismatch`,
    );
  }
  const ortho = new Engine.OrthographicCamera(-10, 10, 5, -5, 1, 100);
  const refOrtho = new THREE_REF.OrthographicCamera(-10, 10, 5, -5, 1, 100);
  for (let i = 0; i < 16; i++) {
    assert.ok(
      Math.abs(ortho.projectionMatrix.elements[i] - refOrtho.projectionMatrix.elements[i]) < 1e-5,
      `OrthographicCamera projectionMatrix[${i}] mismatch`,
    );
  }

  // Lights
  const amb = new Engine.AmbientLight(0xffffff, 0.5);
  const hemi = new Engine.HemisphereLight(0x88ccff, 0x443322, 0.8);
  const sun = new Engine.DirectionalLight(0xfff5e0, 1.4);
  const pt = new Engine.PointLight(0xff8800, 2, 30);
  const spot = new Engine.SpotLight(0xffffff, 1, 50, Math.PI / 4);
  assert.equal(amb.isAmbientLight, true);
  assert.equal(hemi.isHemisphereLight, true);
  assert.equal(sun.isDirectionalLight, true);
  assert.equal(sun.shadow.camera.isOrthographicCamera, true);
  assert.equal(pt.isPointLight, true);
  assert.equal(spot.isSpotLight, true);

  // Procedural geometries
  const box = new Engine.BoxGeometry(2, 3, 4);
  assert.equal(box.attributes.position.count, 24);
  assert.equal(box.index!.count, 36);

  const edges = new Engine.EdgesGeometry(box);
  assert.equal(edges.attributes.position.count, 24); // 12 cube edges * 2 endpoints

  const plane = new Engine.PlaneGeometry(4, 4, 2, 2);
  assert.equal(plane.attributes.position.count, 9);

  const sphere = new Engine.SphereGeometry(1, 12, 8);
  assert.ok(sphere.attributes.position.count > 0 && sphere.index!.count > 0);

  const cyl = new Engine.CylinderGeometry(1, 1, 2, 12);
  const cone = new Engine.ConeGeometry(1, 2, 12);
  const ring = new Engine.RingGeometry(0.5, 1, 12);
  const torus = new Engine.TorusGeometry(1, 0.3, 8, 16);
  const oct = new Engine.OctahedronGeometry(1);
  const dodec = new Engine.DodecahedronGeometry(1);
  for (const g of [cyl, cone, ring, torus, oct, dodec]) {
    assert.ok(g.attributes.position.count > 0);
    g.dispose();
  }

  // Extended materials & objects
  const stdMat = new Engine.MeshStandardMaterial({ color: 0x336699, roughness: 0.4, metalness: 0.6 });
  const phongMat = new Engine.MeshPhongMaterial({ color: 0x993366, shininess: 64 });
  const physMat = new Engine.MeshPhysicalMaterial({ clearcoat: 0.8 });
  const spriteMat = new Engine.SpriteMaterial({ color: 0xffffff });
  const sprite = new Engine.Sprite(spriteMat);
  const grid = new Engine.GridHelper(20, 10);

  assert.equal(stdMat.isMeshStandardMaterial, true);
  assert.equal(stdMat.isMeshLambertMaterial, true);
  assert.equal(phongMat.isMeshPhongMaterial, true);
  assert.equal(physMat.isMeshPhysicalMaterial, true);
  assert.equal(sprite.isSprite, true);
  assert.equal(grid.isLineSegments, true);

  box.dispose();
  edges.dispose();
  plane.dispose();
  sphere.dispose();
  grid.dispose();
});
