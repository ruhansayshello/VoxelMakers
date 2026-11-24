import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  GLSL3,
  InstancedBufferAttribute,
  Int16BufferAttribute,
  Int8BufferAttribute,
  LineBasicMaterial,
  Material,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PointsMaterial,
  Quaternion,
  Ray,
  ShaderMaterial,
  StaticDrawUsage,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
  Uint8BufferAttribute,
  Vector2,
  Vector3,
} from '../index';

const EPS = 1e-5;

function assertNear(actual: number, expected: number, eps = EPS, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    msg ?? `Expected ${actual} to be within ${eps} of ${expected}`,
  );
}

test('BufferAttribute: typed arrays, count getter, needsUpdate version, accessors, normalization parity', () => {
  const attr = new BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6]), 3);
  assert.equal(attr.isBufferAttribute, true);
  assert.equal(attr.isGLBufferAttribute, false);
  assert.equal(attr.count, 2);
  assert.equal(attr.itemSize, 3);
  assert.equal(attr.normalized, false);
  assert.equal(attr.usage, StaticDrawUsage);
  assert.equal(attr.version, 0);

  assert.equal(attr.getX(0), 1);
  assert.equal(attr.getY(0), 2);
  assert.equal(attr.getZ(0), 3);
  assert.equal(attr.getComponent(1, 2), 6);

  attr.setX(0, 10).setY(0, 20).setZ(0, 30);
  assert.deepEqual(Array.from(attr.array.slice(0, 3)), [10, 20, 30]);

  attr.set([7, 8, 9], 3);
  assert.deepEqual(Array.from(attr.array.slice(3, 6)), [7, 8, 9]);

  // needsUpdate increments version only on true
  attr.needsUpdate = false;
  assert.equal(attr.version, 0);
  attr.needsUpdate = true;
  assert.equal(attr.version, 1);
  attr.needsUpdate = true;
  assert.equal(attr.version, 2);

  // setArray updates dynamic count
  attr.setArray(new Float32Array(12));
  assert.equal(attr.count, 4);

  // setUsage & update ranges
  attr.setUsage(DynamicDrawUsage);
  assert.equal(attr.usage, DynamicDrawUsage);
  attr.addUpdateRange(0, 6);
  attr.addUpdateRange(6, 6);
  assert.equal(attr.updateRanges.length, 2);
  assert.deepEqual(attr.updateRanges[1], { start: 6, count: 6 });
  attr.clearUpdateRanges();
  assert.equal(attr.updateRanges.length, 0);

  // Voxel sub-range optimization
  const prevVersion = attr.version;
  attr.updateSubRange([11, 22, 33], 3);
  assert.equal(attr.version, prevVersion + 1);
  assert.deepEqual(attr.updateRanges, [{ start: 3, count: 3 }]);
  assert.deepEqual(Array.from(attr.array.slice(3, 6)), [11, 22, 33]);

  // Normalized Uint8 parity with Three.js
  const ourNorm = new Uint8BufferAttribute([0, 128, 255, 64], 4, true);
  const threeNorm = new THREE.Uint8BufferAttribute([0, 128, 255, 64], 4, true);
  assertNear(ourNorm.getX(0), threeNorm.getX(0));
  assertNear(ourNorm.getY(0), threeNorm.getY(0));
  assertNear(ourNorm.getZ(0), threeNorm.getZ(0));
  assertNear(ourNorm.getW(0), threeNorm.getW(0));

  ourNorm.setXYZW(0, 0.5, 1.0, 0.0, 0.25);
  threeNorm.setXYZW(0, 0.5, 1.0, 0.0, 0.25);
  assert.deepEqual(Array.from(ourNorm.array), Array.from(threeNorm.array));

  // Normalized Int16 & Int8 parity
  const ourInt16 = new Int16BufferAttribute([-32768, 0, 32767], 3, true);
  const threeInt16 = new THREE.Int16BufferAttribute([-32768, 0, 32767], 3, true);
  assertNear(ourInt16.getX(0), threeInt16.getX(0));
  assertNear(ourInt16.getY(0), threeInt16.getY(0));
  assertNear(ourInt16.getZ(0), threeInt16.getZ(0));

  const ourInt8 = new Int8BufferAttribute([0, 127, -127], 3, true);
  assertNear(ourInt8.getY(0), 1.0);
  assertNear(ourInt8.getZ(0), -1.0);

  // applyMatrix4 & applyMatrix3 on BufferAttribute
  const vecAttr = new Float32BufferAttribute([1, 0, 0], 3);
  vecAttr.applyMatrix4(new Matrix4().makeTranslation(2, 3, 4));
  assert.deepEqual(Array.from(vecAttr.array), [3, 3, 4]);
  vecAttr.applyMatrix3(new Matrix3().set(2, 0, 0, 0, 2, 0, 0, 0, 2));
  assert.deepEqual(Array.from(vecAttr.array), [6, 6, 8]);

  // clone & copy produce independent backing arrays
  const cloned = attr.clone();
  assert.notEqual(cloned.array, attr.array);
  assert.deepEqual(Array.from(cloned.array), Array.from(attr.array));
  cloned.setX(0, 999);
  assert.notEqual(attr.getX(0), 999);
});

test('InstancedBufferAttribute: meshPerAttribute default, custom, clone & copy', () => {
  const inst = new InstancedBufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6]), 3);
  assert.equal(inst.isBufferAttribute, true);
  assert.equal(inst.isInstancedBufferAttribute, true);
  assert.equal(inst.meshPerAttribute, 1);
  assert.equal(inst.count, 2);

  const custom = new InstancedBufferAttribute(new Float32Array([9, 8, 7]), 3, false, 4);
  assert.equal(custom.meshPerAttribute, 4);

  const cloned = custom.clone();
  assert.equal(cloned.isInstancedBufferAttribute, true);
  assert.equal(cloned.meshPerAttribute, 4);
  assert.deepEqual(Array.from(cloned.array), [9, 8, 7]);
  assert.equal(cloned.toJSON().meshPerAttribute, 4);
});

test('BufferGeometry: attributes, index auto-typing, transforms, bounds & vertex normals parity with Three.js', () => {
  const positions = new Float32Array([
    0, 0, 0,
    2, 0, 0,
    2, 2, 0,
    0, 2, 0,
  ]);
  const indices = [0, 1, 2, 0, 2, 3];

  const ourGeo = new BufferGeometry();
  ourGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  ourGeo.setIndex(indices);

  const threeGeo = new THREE.BufferGeometry();
  threeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  threeGeo.setIndex(indices);

  assert.equal(ourGeo.hasAttribute('position'), true);
  assert.equal(ourGeo.hasAttribute('uv'), false);
  assert.ok(ourGeo.getIndex() instanceof Uint16BufferAttribute);

  // Large index auto-upgrades to Uint32BufferAttribute
  const largeGeo = new BufferGeometry();
  largeGeo.setIndex([0, 1, 70000]);
  assert.ok(largeGeo.getIndex() instanceof Uint32BufferAttribute);

  // Compute vertex normals parity
  ourGeo.computeVertexNormals();
  threeGeo.computeVertexNormals();
  const ourNorm = ourGeo.getAttribute('normal')!;
  const threeNorm = threeGeo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < ourNorm.count; i++) {
    assertNear(ourNorm.getX(i), threeNorm.getX(i));
    assertNear(ourNorm.getY(i), threeNorm.getY(i));
    assertNear(ourNorm.getZ(i), threeNorm.getZ(i));
  }

  // Transform parity: translate -> rotateY -> scale -> center
  ourGeo.translate(3, -1, 5).rotateY(Math.PI / 4).scale(2, 0.5, 1.5).center();
  threeGeo.translate(3, -1, 5).rotateY(Math.PI / 4).scale(2, 0.5, 1.5).center();

  ourGeo.computeBoundingBox();
  ourGeo.computeBoundingSphere();
  threeGeo.computeBoundingBox();
  threeGeo.computeBoundingSphere();

  const ourPos = ourGeo.getAttribute('position')!;
  const threePos = threeGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < ourPos.count; i++) {
    assertNear(ourPos.getX(i), threePos.getX(i), 1e-4);
    assertNear(ourPos.getY(i), threePos.getY(i), 1e-4);
    assertNear(ourPos.getZ(i), threePos.getZ(i), 1e-4);
  }

  assertNear(ourGeo.boundingBox!.min.x, threeGeo.boundingBox!.min.x, 1e-4);
  assertNear(ourGeo.boundingBox!.max.y, threeGeo.boundingBox!.max.y, 1e-4);
  assertNear(ourGeo.boundingSphere!.radius, threeGeo.boundingSphere!.radius, 1e-4);

  // Groups, drawRange, deleteAttribute, clone, dispose event
  ourGeo.addGroup(0, 3, 0);
  ourGeo.addGroup(3, 3, 1);
  ourGeo.setDrawRange(0, 6);
  assert.equal(ourGeo.groups.length, 2);
  assert.deepEqual(ourGeo.drawRange, { start: 0, count: 6 });

  const cloned = ourGeo.clone();
  assert.notEqual(cloned.uuid, ourGeo.uuid);
  assert.equal(cloned.groups.length, 2);
  assert.notEqual(cloned.getAttribute('position'), ourGeo.getAttribute('position'));

  ourGeo.clearGroups();
  assert.equal(ourGeo.groups.length, 0);
  ourGeo.deleteAttribute('normal');
  assert.equal(ourGeo.hasAttribute('normal'), false);

  let disposed = false;
  ourGeo.addEventListener('dispose', () => {
    disposed = true;
  });
  ourGeo.dispose();
  assert.equal(disposed, true);
});

test('BufferGeometry: voxel chunk fast-path creation and in-place re-mesh buffer updates', () => {
  const geo = BufferGeometry.createVoxelChunkGeometry({
    positions: new Float32Array([0, 0, 0, 16, 0, 0, 16, 16, 0, 0, 16, 0]),
    normals: new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127]),
    colors: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    boundsMin: { x: 0, y: 0, z: 0 },
    boundsMax: { x: 16, y: 16, z: 16 },
    dynamic: true,
  });

  assert.equal(geo.isVoxelGeometry, true);
  assert.equal(geo.getAttribute('normal')!.normalized, true);
  assert.equal(geo.getAttribute('color')!.normalized, true);
  assert.equal(geo.getAttribute('position')!.usage, DynamicDrawUsage);
  assert.deepEqual(geo.drawRange, { start: 0, count: 6 });
  assert.deepEqual(geo.boundingBox!.max.toArray(), [16, 16, 16]);
  assertNear(geo.boundingSphere!.radius, Math.sqrt(8 * 8 * 3));

  const origPosAttr = geo.getAttribute('position')!;
  const origVersion = origPosAttr.version;

  // In-place re-mesh reuses BufferAttribute wrapper and bumps version
  geo.updateVoxelChunkBuffers({
    positions: new Float32Array([0, 0, 0, 8, 0, 0, 8, 8, 0]),
    indices: [0, 1, 2],
    boundsMin: { x: 0, y: 0, z: 0 },
    boundsMax: { x: 8, y: 8, z: 1 },
    dynamic: true,
  });

  assert.equal(geo.getAttribute('position'), origPosAttr);
  assert.equal(origPosAttr.count, 3);
  assert.equal(origPosAttr.version, origVersion + 1);
  assert.deepEqual(geo.drawRange, { start: 0, count: 3 });
  assert.deepEqual(geo.boundingBox!.max.toArray(), [8, 8, 1]);
});

test('Material hierarchy: defaults, setValues, needsUpdate, clone/copy, dispose, renderStateKey', () => {
  const base = new Material();
  assert.equal(base.isMaterial, true);
  assert.equal(base.visible, true);
  assert.equal(base.fog, true);
  assert.equal(base.side, FrontSide);
  assert.equal(base.opacity, 1);
  assert.equal(base.transparent, false);
  assert.equal(base.depthTest, true);
  assert.equal(base.depthWrite, true);
  assert.equal(base.stencilTest, false);
  assert.equal(base.stencilWrite, false);
  assert.equal(base.version, 0);

  base.needsUpdate = true;
  assert.equal(base.version, 1);

  // alphaTest crossing 0 bumps version like Three.js
  base.alphaTest = 0.5;
  assert.equal(base.version, 2);
  base.alphaTest = 0.7;
  assert.equal(base.version, 2);
  base.alphaTest = 0;
  assert.equal(base.version, 3);

  let disposed = false;
  base.addEventListener('dispose', () => {
    disposed = true;
  });
  base.dispose();
  assert.equal(disposed, true);

  // MeshBasicMaterial
  const basic = new MeshBasicMaterial({
    color: 0x336699,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
    side: DoubleSide,
    vertexColors: true,
    envMapRotation: new Euler(0, Math.PI / 2, 0),
  });
  assert.equal(basic.isMeshBasicMaterial, true);
  assert.equal(basic.color.getHex(), 0x336699);
  assert.equal(basic.wireframe, true);
  assert.equal(basic.side, DoubleSide);
  assert.equal(basic.vertexColors, true);
  assertNear(basic.envMapRotation.y, Math.PI / 2);

  // applyQuaternion on BufferGeometry
  const qGeo = new BufferGeometry();
  qGeo.setAttribute('position', new Float32BufferAttribute([1, 0, 0], 3));
  qGeo.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
  assertNear(qGeo.getAttribute('position')!.getX(0), 0);
  assertNear(qGeo.getAttribute('position')!.getZ(0), -1);

  const basicClone = basic.clone();
  assert.notEqual(basicClone.uuid, basic.uuid);
  assert.notEqual(basicClone.color, basic.color);
  assert.equal(basicClone.color.getHex(), 0x336699);
  assert.equal(basicClone.getRenderStateKey(), basic.getRenderStateKey());

  // MeshLambertMaterial
  const lambert = new MeshLambertMaterial({
    color: '#ffaa00',
    emissive: 0x112233,
    emissiveIntensity: 0.75,
    flatShading: true,
    normalScale: new Vector2(2, 3),
    blending: AdditiveBlending,
  });
  assert.equal(lambert.isMeshLambertMaterial, true);
  assert.equal(lambert.color.getHex(), 0xffaa00);
  assert.equal(lambert.emissive.getHex(), 0x112233);
  assert.equal(lambert.emissiveIntensity, 0.75);
  assert.equal(lambert.flatShading, true);
  assert.deepEqual(lambert.normalScale.toArray(), [2, 3]);

  const lambertClone = lambert.clone();
  lambertClone.emissive.setHex(0xffffff);
  assert.equal(lambert.emissive.getHex(), 0x112233);
  assert.notEqual(lambertClone.normalScale, lambert.normalScale);

  // LineBasicMaterial & PointsMaterial
  const lineMat = new LineBasicMaterial({ color: 0x00ff00, linewidth: 3, fog: false });
  assert.equal(lineMat.isLineBasicMaterial, true);
  assert.equal(lineMat.color.getHex(), 0x00ff00);
  assert.equal(lineMat.linewidth, 3);
  assert.equal(lineMat.fog, false);
  assert.equal(lineMat.clone().color.getHex(), 0x00ff00);

  const ptsMat = new PointsMaterial({ color: 0x00ffff, size: 4.5, sizeAttenuation: false });
  assert.equal(ptsMat.isPointsMaterial, true);
  assert.equal(ptsMat.color.getHex(), 0x00ffff);
  assert.equal(ptsMat.size, 4.5);
  assert.equal(ptsMat.sizeAttenuation, false);
  assert.equal(ptsMat.clone().size, 4.5);
});

test('ShaderMaterial: uniforms deep clone, defines, extensions, glslVersion & toJSON', () => {
  const mat = new ShaderMaterial({
    defines: { USE_VOXEL_AO: 1 },
    uniforms: {
      uTime: { value: 1.5 },
      uTint: { value: new Color(0x224466) },
      uSunDir: { value: new Vector3(0.5, 0.8, 0.2) },
      uTex: { value: { isTexture: true, uuid: 'tex-uuid-1' } },
    },
    vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    glslVersion: GLSL3,
    extensions: { multiDraw: true },
    side: BackSide,
  });

  assert.equal(mat.isShaderMaterial, true);
  assert.equal(mat.fog, false);
  assert.equal(mat.glslVersion, GLSL3);
  assert.equal(mat.extensions.multiDraw, true);
  assert.equal(mat.extensions.clipCullDistance, false);

  const cloned = mat.clone();
  assert.notEqual(cloned.uniforms, mat.uniforms);
  assert.notEqual(cloned.uniforms.uTint.value, mat.uniforms.uTint.value);
  assert.notEqual(cloned.uniforms.uSunDir.value, mat.uniforms.uSunDir.value);
  // Textures are shared by reference like Three.js
  assert.equal(cloned.uniforms.uTex.value, mat.uniforms.uTex.value);

  (cloned.uniforms.uTint.value as Color).setHex(0xffffff);
  assert.equal((mat.uniforms.uTint.value as Color).getHex(), 0x224466);

  const json = mat.toJSON();
  assert.equal(json.type, 'ShaderMaterial');
  assert.equal(json.glslVersion, GLSL3);
  const uniformsJson = json.uniforms as Record<string, { type?: string; value: unknown }>;
  assert.deepEqual(uniformsJson.uTint, { type: 'c', value: 0x224466 });
  assert.deepEqual(uniformsJson.uSunDir, { type: 'v3', value: [0.5, 0.8, 0.2] });
  assert.deepEqual(uniformsJson.uTex, { type: 't', value: 'tex-uuid-1' });
});

test('Mesh integration: default BufferGeometry + MeshBasicMaterial and real BufferGeometry raycasting', () => {
  const defaultMesh = new Mesh();
  assert.ok(defaultMesh.geometry instanceof BufferGeometry);
  assert.ok(defaultMesh.material instanceof MeshBasicMaterial);

  const quad = new BufferGeometry();
  quad.setAttribute(
    'position',
    new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  quad.computeVertexNormals();

  const mat = new MeshLambertMaterial({ color: 0x44cc88, side: DoubleSide });
  const mesh = new Mesh(quad, mat);
  mesh.position.set(0, 0, -5);
  mesh.updateMatrixWorld(true);

  const hits: ReturnType<typeof Array.prototype.slice> = [];
  mesh.raycast(
    { ray: new Ray(new Vector3(0.25, -0.25, 0), new Vector3(0, 0, -1)), near: 0.1, far: 100 },
    hits,
  );
  assert.equal(hits.length, 1);
  assertNear(hits[0].distance, 5);
  assertNear(hits[0].point.z, -5);
});
