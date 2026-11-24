import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  Color,
  EventDispatcher,
  Fog,
  FogExp2,
  FrontSide,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Ray,
  Scene,
  TrianglesDrawMode,
  Vector3,
  type BufferGeometryLike,
  type MeshIntersection,
} from '../index';

function assertClose(actual: number, expected: number, eps = 1e-5, label = ''): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${label ? label + ': ' : ''}expected ${actual} to be within ${eps} of ${expected}`,
  );
}

function assertArrayClose(actual: ArrayLike<number>, expected: ArrayLike<number>, eps = 1e-5, label = ''): void {
  assert.equal(actual.length, expected.length, `${label} length mismatch`);
  for (let i = 0; i < actual.length; i++) {
    assertClose(actual[i], expected[i], eps, `${label}[${i}]`);
  }
}

function makeQuadGeometry(): BufferGeometryLike {
  // Two triangles forming a 2x2 quad in XY plane at z = 0, facing +Z
  const positions = new Float32Array([
    -1, -1, 0,
     1, -1, 0,
     1,  1, 0,
    -1,  1, 0,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const posAttr = {
    count: 4,
    getX: (i: number) => positions[i * 3],
    getY: (i: number) => positions[i * 3 + 1],
    getZ: (i: number) => positions[i * 3 + 2],
  };
  const uvAttr = {
    count: 4,
    getX: (i: number) => uvs[i * 2],
    getY: (i: number) => uvs[i * 2 + 1],
  };
  const indexAttr = {
    count: 6,
    getX: (i: number) => indices[i],
    getY: () => 0,
  };

  const mesh = new Mesh();
  mesh.geometry.attributes.position = posAttr;
  mesh.geometry.attributes.uv = uvAttr;
  mesh.geometry.index = indexAttr;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  return mesh.geometry;
}

// ============================================================================
// 1. VOXEL-SPECIFIC SCENE GRAPH OPTIMIZATIONS
// ============================================================================

test('Voxel Scene Optimization: 10 chunks stay synced in chunks & children and update in one updateChunkMatrices() call', () => {
  const scene = new Scene();
  const nonChunkProp = new Mesh();
  nonChunkProp.name = 'hero-rig';
  nonChunkProp.position.set(100, 5, -20);
  scene.add(nonChunkProp);

  assert.equal(nonChunkProp.isChunk, false);
  assert.equal(scene.chunks.length, 0);
  assert.equal(scene.children.length, 1);

  const chunks: Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const chunk = new Mesh();
    chunk.name = `chunk_${i}`;
    chunk.position.set(i * 16, (i % 3) * 16, -i * 16);
    scene.addChunk(chunk);
    chunks.push(chunk);
  }

  // Verify chunks array has all 10 entries with isChunk = true
  assert.equal(scene.chunks.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(chunks[i].isChunk, true);
    assert.equal(chunks[i].parent, scene);
    assert.equal(scene.chunks[i], chunks[i]);
  }

  // Verify standard children array still contains all 10 chunks + the 1 non-chunk object
  assert.equal(scene.children.length, 11);
  for (const chunk of chunks) {
    assert.ok(scene.children.includes(chunk), 'children array must contain every chunk');
  }

  // Re-adding an existing chunk does not duplicate entries
  scene.addChunk(chunks[0]);
  assert.equal(scene.chunks.length, 10);
  assert.equal(scene.children.length, 11);

  // Move all 10 chunks and update all 10 matrices in one bulk call
  for (let i = 0; i < 10; i++) {
    chunks[i].position.set(i * 32 - 64, i * 4, i * 16 + 8);
  }
  scene.updateChunkMatrices();

  for (let i = 0; i < 10; i++) {
    const expectedX = i * 32 - 64;
    const expectedY = i * 4;
    const expectedZ = i * 16 + 8;
    const e = chunks[i].matrixWorld.elements;

    assertClose(e[12], expectedX, 1e-6, `chunk[${i}].matrixWorld.x`);
    assertClose(e[13], expectedY, 1e-6, `chunk[${i}].matrixWorld.y`);
    assertClose(e[14], expectedZ, 1e-6, `chunk[${i}].matrixWorld.z`);
    assertClose(e[0], 1, 1e-6, `chunk[${i}] unit rotation X`);
    assertClose(e[5], 1, 1e-6, `chunk[${i}] unit rotation Y`);
    assertClose(e[10], 1, 1e-6, `chunk[${i}] unit rotation Z`);
    assert.equal(chunks[i].matrixWorldNeedsUpdate, false);

    const worldPoint = new Vector3(1, 2, 3).applyMatrix4(chunks[i].matrixWorld);
    assertClose(worldPoint.x, expectedX + 1);
    assertClose(worldPoint.y, expectedY + 2);
    assertClose(worldPoint.z, expectedZ + 3);
  }

  // Removing via removeChunk keeps both arrays in sync
  scene.removeChunk(chunks[3]);
  assert.equal(scene.chunks.length, 9);
  assert.equal(scene.children.length, 10);
  assert.equal(chunks[3].parent, null);
  assert.equal(scene.chunks.includes(chunks[3]), false);
  assert.equal(scene.children.includes(chunks[3]), false);

  // Removing via standard scene.remove() also stays in sync with chunks
  scene.remove(chunks[7]);
  assert.equal(scene.chunks.length, 8);
  assert.equal(scene.children.length, 9);
  assert.equal(scene.chunks.includes(chunks[7]), false);

  // Clear empties both children and chunks
  scene.clear();
  assert.equal(scene.chunks.length, 0);
  assert.equal(scene.children.length, 0);
});

// ============================================================================
// 2. EVENT DISPATCHER
// ============================================================================

test('EventDispatcher add/has/remove/dispatch semantics', () => {
  const dispatcher = new EventDispatcher();
  const seen: string[] = [];
  let observedTarget: unknown = null;

  const listenerA = (ev: { type: string; target?: unknown }) => {
    seen.push(`A:${ev.type}`);
    observedTarget = ev.target;
    dispatcher.removeEventListener('ping', listenerA);
  };
  const listenerB = (ev: { type: string }) => {
    seen.push(`B:${ev.type}`);
  };

  dispatcher.addEventListener('ping', listenerA);
  dispatcher.addEventListener('ping', listenerA); // duplicate ignored
  dispatcher.addEventListener('ping', listenerB);
  assert.equal(dispatcher.hasEventListener('ping', listenerA), true);

  const event = { type: 'ping', target: null as unknown };
  dispatcher.dispatchEvent(event);

  assert.deepEqual(seen, ['A:ping', 'B:ping']);
  assert.equal(observedTarget, dispatcher);
  assert.equal(event.target, null);
  assert.equal(dispatcher.hasEventListener('ping', listenerA), false);

  dispatcher.dispatchEvent(event);
  assert.deepEqual(seen, ['A:ping', 'B:ping', 'B:ping']);
});

// ============================================================================
// 3. OBJECT3D THREE.JS PARITY
// ============================================================================

test('Object3D hierarchy, transforms, world getters, lookAt, traversal, and lookup parity with Three.js', () => {
  const root = new Group();
  const child = new Object3D();
  const grandChild = new Object3D();

  assert.ok(child.id > root.id && grandChild.id > child.id, 'ids auto-increment');
  assert.equal(typeof root.uuid, 'string');
  assert.equal(root.matrixAutoUpdate, true);
  assert.equal(root.visible, true);
  assert.equal(root.renderOrder, 0);
  assert.equal(root.isChunk, false);

  root.name = 'root';
  child.name = 'child';
  grandChild.name = 'grandChild';

  const events: string[] = [];
  child.addEventListener('added', () => events.push('child:added'));
  root.addEventListener('childadded', () => events.push('root:childadded'));

  root.add(child);
  child.add(grandChild);
  assert.deepEqual(events, ['child:added', 'root:childadded']);

  // Mirror exact same hierarchy & transforms in Three.js
  const tRoot = new THREE.Group();
  const tChild = new THREE.Object3D();
  const tGrand = new THREE.Object3D();
  tRoot.add(tChild);
  tChild.add(tGrand);

  root.position.set(10, -5, 3);
  root.rotation.set(0.2, 0.5, -0.3);
  root.scale.set(2, 2, 2);

  tRoot.position.set(10, -5, 3);
  tRoot.rotation.set(0.2, 0.5, -0.3);
  tRoot.scale.set(2, 2, 2);

  child.position.set(1, 2, 3);
  child.rotateY(0.75);
  child.translateZ(4);

  tChild.position.set(1, 2, 3);
  tChild.rotateY(0.75);
  tChild.translateZ(4);

  grandChild.position.set(-2, 0.5, 1.5);
  grandChild.rotateX(-0.4);
  grandChild.rotateZ(0.25);

  tGrand.position.set(-2, 0.5, 1.5);
  tGrand.rotateX(-0.4);
  tGrand.rotateZ(0.25);

  root.updateMatrixWorld(true);
  tRoot.updateMatrixWorld(true);

  assertArrayClose(grandChild.matrixWorld.elements, tGrand.matrixWorld.elements, 1e-4, 'grandChild.matrixWorld');

  const wp = grandChild.getWorldPosition(new Vector3());
  const twp = tGrand.getWorldPosition(new THREE.Vector3());
  assertArrayClose(wp.toArray(), twp.toArray(), 1e-4, 'getWorldPosition');

  const wq = grandChild.getWorldQuaternion(new Quaternion());
  const twq = tGrand.getWorldQuaternion(new THREE.Quaternion());
  assertArrayClose(wq.toArray(), twq.toArray(), 1e-4, 'getWorldQuaternion');

  const ws = grandChild.getWorldScale(new Vector3());
  const tws = tGrand.getWorldScale(new THREE.Vector3());
  assertArrayClose(ws.toArray(), tws.toArray(), 1e-4, 'getWorldScale');

  const wd = grandChild.getWorldDirection(new Vector3());
  const twd = tGrand.getWorldDirection(new THREE.Vector3());
  assertArrayClose(wd.toArray(), twd.toArray(), 1e-4, 'getWorldDirection');

  // lookAt parity with Three.js
  const looker = new Object3D();
  looker.position.set(4, 3, 2);
  looker.lookAt(new Vector3(-1, 5, -10));

  const tLooker = new THREE.Object3D();
  tLooker.position.set(4, 3, 2);
  tLooker.lookAt(new THREE.Vector3(-1, 5, -10));

  assertArrayClose(looker.quaternion.toArray(), tLooker.quaternion.toArray(), 1e-5, 'lookAt quaternion');

  // Traversal & lookup
  const visited: string[] = [];
  root.traverse((o) => visited.push(o.name));
  assert.deepEqual(visited, ['root', 'child', 'grandChild']);

  child.visible = false;
  const visibleVisited: string[] = [];
  root.traverseVisible((o) => visibleVisited.push(o.name));
  assert.deepEqual(visibleVisited, ['root']);

  const ancestors: string[] = [];
  grandChild.traverseAncestors((o) => ancestors.push(o.name));
  assert.deepEqual(ancestors, ['child', 'root']);

  assert.equal(root.getObjectById(grandChild.id), grandChild);
  assert.equal(root.getObjectByName('grandChild'), grandChild);
  assert.equal(root.getObjectByProperty('uuid', child.uuid), child);

  // applyMatrix4 parity
  const transform = new Matrix4().makeTranslation(5, -2, 1).multiply(new Matrix4().makeRotationY(Math.PI / 2));
  const tTransform = new THREE.Matrix4().fromArray(transform.elements);
  const objA = new Object3D();
  objA.position.set(1, 0, 0);
  objA.applyMatrix4(transform);

  const tObjA = new THREE.Object3D();
  tObjA.position.set(1, 0, 0);
  tObjA.applyMatrix4(tTransform);
  assertArrayClose(objA.position.toArray(), tObjA.position.toArray(), 1e-5, 'applyMatrix4.position');
  assertArrayClose(objA.quaternion.toArray(), tObjA.quaternion.toArray(), 1e-5, 'applyMatrix4.quaternion');

  // clone & toJSON
  const cloned = root.clone(true);
  assert.notEqual(cloned.uuid, root.uuid);
  assert.equal(cloned.children.length, 1);
  assert.equal(cloned.children[0].children[0].name, 'grandChild');

  const json = root.toJSON();
  assert.equal(json.object.type, 'Group');
  assert.equal(json.object.name, 'root');
  assert.ok(Array.isArray(json.object.children));
});

// ============================================================================
// 4. MESH, MORPH TARGETS, AND RAYCASTING
// ============================================================================

test('Mesh defaults, morph targets, vertex positions, copy, and raycasting', () => {
  const defaultMesh = new Mesh();
  assert.equal(defaultMesh.type, 'Mesh');
  assert.equal(defaultMesh.isMesh, true);
  assert.equal(defaultMesh.drawMode, TrianglesDrawMode);
  assert.deepEqual(defaultMesh.morphTargetInfluences, []);
  assert.equal(defaultMesh.morphTargetDictionary, null);

  // Build quad geometry with a morph target
  const geom = makeQuadGeometry();
  const morphPositions = new Float32Array([
    -1, -1, 2,
     1, -1, 2,
     1,  1, 2,
    -1,  1, 2,
  ]);
  geom.morphAttributes = {
    position: [
      {
        name: 'extrudeZ',
        count: 4,
        getX: (i: number) => morphPositions[i * 3],
        getY: (i: number) => morphPositions[i * 3 + 1],
        getZ: (i: number) => morphPositions[i * 3 + 2],
      },
    ],
  };

  const mesh = new Mesh(geom);
  assert.deepEqual(mesh.morphTargetDictionary, { extrudeZ: 0 });
  assert.deepEqual(mesh.morphTargetInfluences, [0]);

  const v0 = mesh.getVertexPosition(0, new Vector3());
  assert.equal(v0.equals(new Vector3(-1, -1, 0)), true);

  mesh.morphTargetInfluences[0] = 0.5;
  const v0Morphed = mesh.getVertexPosition(0, new Vector3());
  assertClose(v0Morphed.z, 1.0, 1e-6, 'morphed vertex z');

  // Reset morph and raycast against translated mesh
  mesh.morphTargetInfluences[0] = 0;
  mesh.position.set(0, 0, -5);
  mesh.updateMatrixWorld(true);

  const intersects: MeshIntersection[] = [];
  const raycaster = {
    ray: new Ray(new Vector3(0.25, -0.25, 0), new Vector3(0, 0, -1)),
    near: 0,
    far: 100,
  };
  mesh.raycast(raycaster, intersects);

  assert.equal(intersects.length, 1);
  assertClose(intersects[0].distance, 5, 1e-5, 'hit distance');
  assertArrayClose(intersects[0].point.toArray(), [0.25, -0.25, -5], 1e-5, 'hit point');
  assert.equal(intersects[0].object, mesh);
  assert.ok(intersects[0].uv !== undefined);
  assertClose(intersects[0].uv!.x, 0.625, 1e-5, 'interpolated u');
  assertClose(intersects[0].uv!.y, 0.375, 1e-5, 'interpolated v');

  // Backface raycast should miss with FrontSide, hit with DoubleSide
  const backHits: MeshIntersection[] = [];
  const backRaycaster = {
    ray: new Ray(new Vector3(0.25, -0.25, -10), new Vector3(0, 0, 1)),
    near: 0,
    far: 100,
  };
  (mesh.material as { side?: number }).side = FrontSide;
  mesh.raycast(backRaycaster, backHits);
  assert.equal(backHits.length, 0);

  (mesh.material as { side?: number }).side = DoubleSide;
  mesh.raycast(backRaycaster, backHits);
  assert.equal(backHits.length, 1);
  assertClose(backHits[0].distance, 5, 1e-5);

  // Copy preserves geometry, material, drawMode, and morph data
  const meshCopy = new Mesh().copy(mesh);
  assert.equal(meshCopy.geometry, mesh.geometry);
  assert.equal(meshCopy.material, mesh.material);
  assert.deepEqual(meshCopy.morphTargetDictionary, { extrudeZ: 0 });
});

// ============================================================================
// 5. SCENE PROPERTIES, FOG, AND FOGEXP2
// ============================================================================

test('Scene properties, Fog, FogExp2, clone, and JSON serialization', () => {
  const fog = new Fog(0x88ccff, 15, 250);
  fog.name = 'horizonFog';
  assert.equal(fog.isFog, true);
  assert.equal(fog.near, 15);
  assert.equal(fog.far, 250);
  assert.equal(fog.color.getHex(), 0x88ccff);
  assert.deepEqual(fog.toJSON(), {
    type: 'Fog',
    name: 'horizonFog',
    color: 0x88ccff,
    near: 15,
    far: 250,
  });

  const fogExp = new FogExp2(0x112233);
  assert.equal(fogExp.isFogExp2, true);
  assert.equal(fogExp.density, 0.00025);
  const fogExpClone = fogExp.clone();
  assert.notEqual(fogExpClone, fogExp);
  assert.equal(fogExpClone.color.getHex(), 0x112233);

  const scene = new Scene();
  scene.background = new Color(0x203040);
  scene.fog = fog;
  const chunk = new Mesh();
  scene.addChunk(chunk);

  const sceneClone = scene.clone(true);
  assert.equal(sceneClone.type, 'Scene');
  assert.ok(sceneClone.background instanceof Color);
  assert.equal((sceneClone.background as Color).getHex(), 0x203040);
  assert.ok(sceneClone.fog instanceof Fog);
  assert.equal((sceneClone.fog as Fog).near, 15);
  assert.equal(sceneClone.chunks.length, 1);
  assert.equal(sceneClone.children.length, 1);

  const json = scene.toJSON();
  assert.equal(json.object.type, 'Scene');
  assert.equal(json.object.background, 0x203040);
  assert.deepEqual(json.object.fog, fog.toJSON());
});
