import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  Object3D,
  Raycaster,
  RGBAFormat,
  Texture,
  UnsignedByteType,
  UVMapping,
  Vector3,
  type RaycasterCameraLike,
} from '../index';

const EPS = 1e-5;

function assertNear(actual: number, expected: number, eps = EPS, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    msg ?? `Expected ${actual} to be within ${eps} of ${expected}`,
  );
}

test('InstancedMesh: maxCount=200 pre-allocation, setMatrixAt(199), recycleInstance() FIFO ring, colors & bounds', () => {
  const geo = new BufferGeometry();
  geo.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1], 3),
  );
  const mat = new MeshBasicMaterial({ color: 0xffffff });

  const inst = new InstancedMesh(geo, mat, 0);
  inst.setMaxCount(200);
  inst.count = 200;

  assert.equal(inst.isInstancedMesh, true);
  assert.equal(inst.maxCount, 200);
  assert.equal(inst.instanceMatrix.array.length, 200 * 16);
  const backingRef = inst.instanceMatrix.array;

  // Writing slot 199 must not reallocate backing Float32Array
  const m199 = new Matrix4().makeTranslation(42, 13, -7);
  inst.setMatrixAt(199, m199);
  assert.equal(inst.instanceMatrix.array, backingRef);

  const readBack = new Matrix4();
  inst.getMatrixAt(199, readBack);
  assert.equal(readBack.equals(m199), true);

  // recycleInstance() returns index 0 first, then 1..199, then wraps to 0
  assert.equal(inst.recycleInstance(), 0);
  assert.equal(inst.recycleInstance(), 1);
  for (let i = 2; i < 200; i++) {
    assert.equal(inst.recycleInstance(), i);
  }
  assert.equal(inst.recycleInstance(), 0);

  // Colors
  const c = new Color(0x33aa66);
  inst.setColorAt(199, c);
  assert.notEqual(inst.instanceColor, null);
  const readColor = new Color();
  inst.getColorAt(199, readColor);
  assert.equal(readColor.getHex(), 0x33aa66);

  // Bounding sphere covers translated instance 199
  inst.computeBoundingBox();
  inst.computeBoundingSphere();
  assert.ok(inst.boundingBox !== null && inst.boundingBox.max.x >= 43);
  assert.ok(inst.boundingSphere !== null && inst.boundingSphere.radius > 10);

  // Raycast is a no-op skip for debris
  const rc = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
  assert.equal(rc.intersectObject(inst).length, 0);

  // Clone preserves maxCount & independent buffers
  const cloned = inst.clone();
  assert.equal(cloned.maxCount, 200);
  assert.notEqual(cloned.instanceMatrix.array, inst.instanceMatrix.array);
  const clonedM = new Matrix4();
  cloned.getMatrixAt(199, clonedM);
  assert.equal(clonedM.equals(m199), true);

  // Dispose event
  let disposed = false;
  inst.addEventListener('dispose', () => {
    disposed = true;
  });
  inst.dispose();
  assert.equal(disposed, true);
});

test('Line & LineSegments: flags, defaults, and computeLineDistances parity with Three.js', () => {
  const pts = [0, 0, 0, 3, 4, 0, 3, 4, 12, 3, 10, 12];

  const segGeo = new BufferGeometry();
  segGeo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const segments = new LineSegments(segGeo);
  assert.equal(segments.isLine, true);
  assert.equal(segments.isLineSegments, true);
  assert.equal(segments.isMesh, false);
  assert.ok(segments.material instanceof LineBasicMaterial);
  segments.computeLineDistances();

  const threeSegGeo = new THREE.BufferGeometry();
  threeSegGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const threeSegments = new THREE.LineSegments(threeSegGeo);
  threeSegments.computeLineDistances();

  const ourSegDist = segGeo.getAttribute('lineDistance')!;
  const threeSegDist = threeSegGeo.getAttribute('lineDistance') as THREE.BufferAttribute;
  for (let i = 0; i < ourSegDist.count; i++) {
    assertNear(ourSegDist.getX(i), threeSegDist.getX(i));
  }

  // Line (connected strip)
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const line = new Line(lineGeo);
  assert.equal(line.isLine, true);
  assert.equal(line.isLineSegments, false);
  line.computeLineDistances();

  const threeLineGeo = new THREE.BufferGeometry();
  threeLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const threeLine = new THREE.Line(threeLineGeo);
  threeLine.computeLineDistances();

  const ourLineDist = lineGeo.getAttribute('lineDistance')!;
  const threeLineDist = threeLineGeo.getAttribute('lineDistance') as THREE.BufferAttribute;
  for (let i = 0; i < ourLineDist.count; i++) {
    assertNear(ourLineDist.getX(i), threeLineDist.getX(i));
  }
});

test('Raycaster: Three.js setFromCamera & intersectObjects parity + fast 3D DDA voxel chunk raycast', () => {
  // 1. Standard Three.js perspective camera ray parity
  const threeCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  threeCam.position.set(4, 6, 12);
  threeCam.lookAt(0, 0, 0);
  threeCam.updateMatrixWorld(true);

  const ourCam = new Object3D() as RaycasterCameraLike;
  ourCam.isPerspectiveCamera = true;
  ourCam.near = 0.1;
  ourCam.far = 200;
  ourCam.matrixWorld.fromArray(threeCam.matrixWorld.elements);
  ourCam.projectionMatrix = new Matrix4().fromArray(threeCam.projectionMatrix.elements);
  ourCam.projectionMatrixInverse = new Matrix4().fromArray(threeCam.projectionMatrixInverse.elements);

  const ourRc = new Raycaster();
  const threeRc = new THREE.Raycaster();
  ourRc.setFromCamera({ x: 0.35, y: -0.25 }, ourCam);
  threeRc.setFromCamera(new THREE.Vector2(0.35, -0.25), threeCam);

  assertNear(ourRc.ray.origin.x, threeRc.ray.origin.x);
  assertNear(ourRc.ray.origin.y, threeRc.ray.origin.y);
  assertNear(ourRc.ray.origin.z, threeRc.ray.origin.z);
  assertNear(ourRc.ray.direction.x, threeRc.ray.direction.x);
  assertNear(ourRc.ray.direction.y, threeRc.ray.direction.y);
  assertNear(ourRc.ray.direction.z, threeRc.ray.direction.z);

  // Standard mesh intersectObjects sorting
  const quad = new BufferGeometry();
  quad.setAttribute('position', new Float32BufferAttribute([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = new MeshBasicMaterial({ side: DoubleSide });

  const farMesh = new Mesh(quad, mat);
  farMesh.position.set(0, 0, -10);
  farMesh.updateMatrixWorld(true);

  const nearMesh = new Mesh(quad, mat);
  nearMesh.position.set(0, 0, -4);
  nearMesh.updateMatrixWorld(true);

  ourRc.set(new Vector3(0.25, -0.25, 0), new Vector3(0, 0, -1));
  const meshHits = ourRc.intersectObjects([farMesh, nearMesh]);
  assert.equal(meshHits.length, 2);
  assert.equal(meshHits[0].object, nearMesh);
  assert.equal(meshHits[1].object, farMesh);

  // 2. DDA voxel chunk raycast (16x16x16 chunk)
  const sizeX = 16;
  const sizeY = 16;
  const sizeZ = 16;
  const chunkData = new Uint8Array(sizeX * sizeY * sizeZ);
  const setVoxel = (x: number, y: number, z: number, val: number) => {
    chunkData[x + z * sizeX + y * sizeX * sizeZ] = val;
  };

  // Place target voxel at (5, 3, 7) with material ID 42, plus a blocker behind it at (5, 3, 10)
  setVoxel(5, 3, 7, 42);
  setVoxel(5, 3, 10, 99);

  // Cast from outside the chunk at z = -5 along +Z through center of (5, 3, *)
  ourRc.set(new Vector3(5.5, 3.5, -5), new Vector3(0, 0, 1));
  const hit = ourRc.intersectChunk({
    sizeX,
    sizeY,
    sizeZ,
    data: chunkData,
    origin: { x: 0, y: 0, z: 0 },
    voxelSize: 1.0,
  });

  assert.ok(hit !== null, 'DDA raycaster must hit voxel (5, 3, 7)');
  assert.deepEqual(hit.voxel.toArray(), [5, 3, 7]);
  assert.deepEqual(hit.prevVoxel.toArray(), [5, 3, 6]);
  assert.deepEqual(hit.normal.toArray(), [0, 0, -1]);
  assert.equal(hit.value, 42);
  assertNear(hit.distance, 12.0, 1e-3);
  assertNear(hit.point.z, 7.0, 1e-3);

  // Cast from above diagonally onto top face of (5, 3, 7)
  ourRc.set(new Vector3(5.5, 8.5, 7.5), new Vector3(0, -1, 0));
  const topHit = ourRc.intersectChunk({ sizeX, sizeY, sizeZ, data: chunkData });
  assert.ok(topHit !== null);
  assert.deepEqual(topHit.voxel.toArray(), [5, 3, 7]);
  assert.deepEqual(topHit.prevVoxel.toArray(), [5, 4, 7]);
  assert.deepEqual(topHit.normal.toArray(), [0, 1, 0]);
  assertNear(topHit.distance, 4.5, 1e-3);

  // Missing ray returns null
  ourRc.set(new Vector3(1.5, 1.5, -5), new Vector3(0, 0, 1));
  assert.equal(ourRc.intersectChunk({ sizeX, sizeY, sizeZ, data: chunkData }), null);

  // Micro-voxel 0.25m chunk with world offset
  const microData = new Uint8Array(8 * 8 * 8);
  microData[3 + 2 * 8 + 4 * 64] = 7; // voxel (3, 4, 2)
  ourRc.set(new Vector3(10 + 3.5 * 0.25, 20 + 4.5 * 0.25, 30 - 2), new Vector3(0, 0, 1));
  const microHit = ourRc.intersectChunk({
    sizeX: 8,
    sizeY: 8,
    sizeZ: 8,
    data: microData,
    voxelSize: 0.25,
    origin: { x: 10, y: 20, z: 30 },
  });
  assert.ok(microHit !== null);
  assert.deepEqual(microHit.voxel.toArray(), [3, 4, 2]);
  assert.equal(microHit.value, 7);
});

test('Texture, CanvasTexture & DataTexture: defaults, needsUpdate version, updateMatrix parity & dispose', () => {
  const tex = new Texture();
  assert.equal(tex.isTexture, true);
  assert.equal(tex.mapping, UVMapping);
  assert.equal(tex.wrapS, ClampToEdgeWrapping);
  assert.equal(tex.wrapT, ClampToEdgeWrapping);
  assert.equal(tex.magFilter, LinearFilter);
  assert.equal(tex.minFilter, LinearFilter);
  assert.equal(tex.format, RGBAFormat);
  assert.equal(tex.type, UnsignedByteType);
  assert.equal(tex.colorSpace, NoColorSpace);
  assert.equal(tex.generateMipmaps, true);
  assert.equal(tex.flipY, true);
  assert.equal(tex.unpackAlignment, 4);
  assert.equal(tex.version, 0);

  tex.needsUpdate = true;
  assert.equal(tex.version, 1);

  // UV matrix transform parity with Three.js Texture.updateMatrix()
  tex.offset.set(0.25, 0.5);
  tex.repeat.set(2, 3);
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI / 6;
  tex.updateMatrix();

  const threeTex = new THREE.Texture();
  threeTex.offset.set(0.25, 0.5);
  threeTex.repeat.set(2, 3);
  threeTex.center.set(0.5, 0.5);
  threeTex.rotation = Math.PI / 6;
  threeTex.updateMatrix();

  for (let i = 0; i < 9; i++) {
    assertNear(tex.matrix.elements[i], threeTex.matrix.elements[i]);
  }

  // CanvasTexture defaults needsUpdate=true (version=1)
  const fakeCanvas = { width: 64, height: 32 } as unknown as HTMLCanvasElement;
  const cTex = new CanvasTexture(fakeCanvas);
  assert.equal(cTex.isCanvasTexture, true);
  assert.equal(cTex.needsUpdate, true);
  assert.equal(cTex.version, 1);
  assert.equal(cTex.width, 64);
  assert.equal(cTex.height, 32);

  // DataTexture defaults
  const pixels = new Uint8Array(4 * 4 * 4);
  const dTex = new DataTexture(pixels, 4, 4);
  assert.equal(dTex.isDataTexture, true);
  assert.equal(dTex.image.width, 4);
  assert.equal(dTex.image.height, 4);
  assert.equal(dTex.image.data, pixels);
  assert.equal(dTex.magFilter, NearestFilter);
  assert.equal(dTex.minFilter, NearestFilter);
  assert.equal(dTex.generateMipmaps, false);
  assert.equal(dTex.flipY, false);
  assert.equal(dTex.unpackAlignment, 1);

  // Clone & dispose
  const cloned = tex.clone();
  assert.notEqual(cloned.uuid, tex.uuid);
  assert.deepEqual(cloned.repeat.toArray(), [2, 3]);

  let disposed = false;
  dTex.addEventListener('dispose', () => {
    disposed = true;
  });
  dTex.dispose();
  assert.equal(disposed, true);
});
