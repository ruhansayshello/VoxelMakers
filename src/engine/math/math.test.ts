import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  Box3,
  Color,
  Euler,
  Frustum,
  Matrix3,
  Matrix4,
  Plane,
  Quaternion,
  Ray,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
  type EulerOrder,
} from './index';

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

// ============================================================================
// 1. VOXEL-SPECIFIC OPTIMIZATIONS
// ============================================================================

test('Voxel Optimization: Vector3.packToInt32 / unpackFromInt32 roundtrip across full range', () => {
  const samples: [number, number, number][] = [
    [0, 0, 0],
    [1, 2, 3],
    [-1, -1, -1],
    [-256, -64, -256],
    [767, 447, 767],
    [-256, 447, 767],
    [767, -64, -256],
    [128, 64, -128],
    [-42, 19, 311],
  ];

  const v = new Vector3();
  for (const [x, y, z] of samples) {
    v.set(x, y, z);
    const key = v.packToInt32();
    assert.ok(Number.isInteger(key) && key >= 0, `key should be non-negative 32-bit int, got ${key}`);
    const unpacked = Vector3.unpackFromInt32(key);
    assert.deepEqual(unpacked, [x, y, z], `roundtrip failed for (${x}, ${y}, ${z})`);
  }

  // Verify collision-free Map keying across a 20x20x20 grid centered around negative & positive coords
  const map = new Map<number, string>();
  for (let x = -10; x < 10; x++) {
    for (let y = -10; y < 10; y++) {
      for (let z = -10; z < 10; z++) {
        const key = v.set(x, y, z).packToInt32();
        const tag = `${x},${y},${z}`;
        assert.equal(map.has(key), false, `duplicate key for ${tag}`);
        map.set(key, tag);
      }
    }
  }
  assert.equal(map.size, 8000);
});

test('Voxel Optimization: Matrix4.makeVoxelTransform fast path matches compose and uses Float32Array(16)', () => {
  const m = new Matrix4();
  assert.ok(m.elements instanceof Float32Array, 'Matrix4.elements must be Float32Array');
  assert.equal(m.elements.length, 16);

  // Dirty the matrix first with rotation & non-unit scale to verify makeVoxelTransform resets all 16 entries
  m.compose(new Vector3(1, 2, 3), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7), new Vector3(5, 6, 7));

  m.makeVoxelTransform(-12, 34.5, 78);

  const composed = new Matrix4().compose(new Vector3(-12, 34.5, 78), new Quaternion(), new Vector3(1, 1, 1));
  assert.equal(m.equals(composed), true);

  const p = new Vector3(2, 3, 4).applyMatrix4(m);
  assertClose(p.x, -10);
  assertClose(p.y, 37.5);
  assertClose(p.z, 82);
});

test('Voxel Optimization: Frustum.cullChunkArray matches Three.js Frustum visibility exactly', () => {
  // Build a real Three.js perspective camera looking down -Z from (0, 10, 0)
  const threeCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 100);
  threeCam.position.set(0, 10, 0);
  threeCam.lookAt(0, 10, -50);
  threeCam.updateMatrixWorld(true);
  threeCam.updateProjectionMatrix();

  const threeProjScreen = new THREE.Matrix4().multiplyMatrices(
    threeCam.projectionMatrix,
    threeCam.matrixWorldInverse,
  );
  const threeFrustum = new THREE.Frustum().setFromProjectionMatrix(threeProjScreen);

  // Create a mix of chunks: inside, behind, far beyond, far left/right, above/below, grazing boundary
  const chunkSpecs: [number, number, number, number][] = [
    [0, 10, -20, 8],      // 0: clearly inside
    [0, 10, 20, 8],       // 1: behind camera
    [0, 10, -150, 8],     // 2: beyond far plane
    [-80, 10, -20, 8],    // 3: far left
    [80, 10, -20, 8],     // 4: far right
    [0, 90, -20, 8],      // 5: far above
    [0, -70, -20, 8],     // 6: far below
    [0, 10, -104, 8],     // 7: partially intersecting far plane (visible)
    [0, 10, 3, 8],        // 8: sphere encloses near plane (visible)
    [15, 12, -45, 12],    // 9: inside off-center
  ];

  const ourSpheres = chunkSpecs.map(([x, y, z, r]) => new Sphere(new Vector3(x, y, z), r));
  const threeSpheres = chunkSpecs.map(([x, y, z, r]) => new THREE.Sphere(new THREE.Vector3(x, y, z), r));

  const expectedIndices: number[] = [];
  threeSpheres.forEach((s, idx) => {
    if (threeFrustum.intersectsSphere(s)) expectedIndices.push(idx);
  });

  const cameraAdapter = {
    projectionMatrix: new Matrix4().fromArray(threeCam.projectionMatrix.elements),
    matrixWorldInverse: new Matrix4().fromArray(threeCam.matrixWorldInverse.elements),
  };

  // Test instance method
  const frustum = new Frustum();
  const visibleInstance = frustum.cullChunkArray(ourSpheres, cameraAdapter);
  assert.deepEqual(visibleInstance, expectedIndices);
  assert.deepEqual(visibleInstance, [0, 7, 8, 9]);

  // Test static method with { boundingSphere } wrapper objects
  const wrappedChunks = ourSpheres.map((s) => ({ boundingSphere: s }));
  const visibleStatic = Frustum.cullChunkArray(wrappedChunks, cameraAdapter);
  assert.deepEqual(visibleStatic, expectedIndices);
});

// ============================================================================
// 2. CORE MATH PARITY AGAINST THREE.JS (ALL 13 CLASSES)
// ============================================================================

test('Vector2 parity with Three.js', () => {
  const a = new Vector2(3, -4);
  const b = new Vector2(1, 2);
  assertClose(a.length(), 5);
  assertClose(a.dot(b), -5);

  const c = a.clone().add(b).sub(new Vector2(2, 1)).multiplyScalar(2);
  assert.equal(c.equals(new Vector2(4, -6)), true);

  const n = new Vector2(3, 4).normalize();
  assertClose(n.x, 0.6);
  assertClose(n.y, 0.8);
});

test('Vector3 parity with Three.js', () => {
  const v = new Vector3(1.7, -2.3, 4.5);
  assert.deepEqual(v.clone().floor().toArray(), [1, -3, 4]);
  assert.deepEqual(v.clone().ceil().toArray(), [2, -2, 5]);
  assert.deepEqual(v.clone().round().toArray(), [2, -2, 5]);

  const clamped = new Vector3(-5, 5, 15).clamp(new Vector3(0, 0, 0), new Vector3(10, 10, 10));
  assert.equal(clamped.equals(new Vector3(0, 5, 10)), true);

  const cross = new Vector3(1, 0, 0).cross(new Vector3(0, 1, 0));
  assert.equal(cross.equals(new Vector3(0, 0, 1)), true);

  const mul = new Vector3().multiplyVectors(new Vector3(2, 3, 4), new Vector3(5, -2, 0.5));
  assert.equal(mul.equals(new Vector3(10, -6, 2)), true);

  const lerped = new Vector3(0, 0, 0).lerp(new Vector3(10, 20, 30), 0.25);
  assert.equal(lerped.equals(new Vector3(2.5, 5, 7.5)), true);

  // applyQuaternion & applyMatrix4 vs Three.js
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 1).normalize(), Math.PI / 3);
  const tq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 1).normalize(), Math.PI / 3);
  const vq = new Vector3(3, -1, 2).applyQuaternion(q);
  const tvq = new THREE.Vector3(3, -1, 2).applyQuaternion(tq);
  assertArrayClose(vq.toArray(), tvq.toArray(), 1e-6, 'applyQuaternion');

  const m = new Matrix4().compose(new Vector3(5, -2, 8), q, new Vector3(2, 0.5, 3));
  const tm = new THREE.Matrix4().compose(
    new THREE.Vector3(5, -2, 8),
    tq,
    new THREE.Vector3(2, 0.5, 3),
  );
  const vm = new Vector3(1, 2, 3).applyMatrix4(m);
  const tvm = new THREE.Vector3(1, 2, 3).applyMatrix4(tm);
  assertArrayClose(vm.toArray(), tvm.toArray(), 1e-5, 'applyMatrix4');
});

test('Vector4 parity with Three.js and extended Vector3 methods', () => {
  const a = new Vector4(1, 2, 3, 4);
  const b = new Vector4(5, 6, 7, 8);
  assertClose(a.dot(b), 70);
  assertClose(a.distanceToSquared(b), 64);
  assertClose(a.distanceTo(b), 8);

  const mul = new Vector4().multiplyVectors(a, b);
  assert.equal(mul.equals(new Vector4(5, 12, 21, 32)), true);

  const m = new Matrix4().makeTranslation(10, 20, 30);
  const v4 = new Vector4(1, 2, 3, 1).applyMatrix4(m);
  assert.equal(v4.equals(new Vector4(11, 22, 33, 1)), true);
});

test('Matrix3 normal matrix parity with Three.js', () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.8);
  const m4 = new Matrix4().compose(new Vector3(10, 5, -3), q, new Vector3(2, 0.5, 3));
  const tm4 = new THREE.Matrix4().compose(
    new THREE.Vector3(10, 5, -3),
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
    new THREE.Vector3(2, 0.5, 3),
  );

  const n3 = new Matrix3().getNormalMatrix(m4);
  const tn3 = new THREE.Matrix3().getNormalMatrix(tm4);
  assertArrayClose(n3.elements, tn3.elements, 1e-5, 'Matrix3.getNormalMatrix');
});

test('Matrix4 operations (rotations, multiply, invert, transpose, compose/decompose) parity with Three.js', () => {
  const rx = new Matrix4().makeRotationX(0.4);
  const ry = new Matrix4().makeRotationY(-0.7);
  const rz = new Matrix4().makeRotationZ(1.1);
  const s = new Matrix4().makeScale(2, 3, 0.5);
  const t = new Matrix4().makeTranslation(-4, 7, 12);

  const combined = new Matrix4().multiplyMatrices(t, rx).multiply(ry).multiply(rz).multiply(s);

  const tCombined = new THREE.Matrix4()
    .multiplyMatrices(new THREE.Matrix4().makeTranslation(-4, 7, 12), new THREE.Matrix4().makeRotationX(0.4))
    .multiply(new THREE.Matrix4().makeRotationY(-0.7))
    .multiply(new THREE.Matrix4().makeRotationZ(1.1))
    .multiply(new THREE.Matrix4().makeScale(2, 3, 0.5));

  assertArrayClose(combined.elements, tCombined.elements, 1e-5, 'Matrix4.multiply');

  // Invert
  const inv = combined.clone().invert();
  const tInv = tCombined.clone().invert();
  assertArrayClose(inv.elements, tInv.elements, 1e-5, 'Matrix4.invert');

  // Product with inverse should be identity
  const prod = new Matrix4().multiplyMatrices(combined, inv);
  assertArrayClose(prod.elements, new Matrix4().elements, 1e-5, 'M * M^-1 == I');

  // Decompose -> Compose roundtrip
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  combined.decompose(pos, quat, scl);
  const recomposed = new Matrix4().compose(pos, quat, scl);
  assertArrayClose(recomposed.elements, combined.elements, 1e-4, 'decompose/compose roundtrip');

  // Transpose
  const trans = combined.clone().transpose();
  const tTrans = tCombined.clone().transpose();
  assertArrayClose(trans.elements, tTrans.elements, 1e-5, 'Matrix4.transpose');
});

test('Quaternion & Euler parity across all 6 rotation orders', () => {
  const orders: EulerOrder[] = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];

  for (const order of orders) {
    const e = new Euler(0.3, -0.6, 0.9, order);
    const te = new THREE.Euler(0.3, -0.6, 0.9, order);

    const q = new Quaternion().setFromEuler(e);
    const tq = new THREE.Quaternion().setFromEuler(te);
    assertArrayClose(q.toArray(), tq.toArray(), 1e-6, `Quaternion.setFromEuler(${order})`);

    const m = new Matrix4().makeRotationFromEuler(e);
    const tm = new THREE.Matrix4().makeRotationFromEuler(te);
    assertArrayClose(m.elements, tm.elements, 1e-5, `Matrix4.makeRotationFromEuler(${order})`);

    const eBack = new Euler().setFromQuaternion(q, order);
    const teBack = new THREE.Euler().setFromQuaternion(tq, order);
    assertClose(eBack.x, teBack.x, 1e-5, `Euler.setFromQuaternion(${order}).x`);
    assertClose(eBack.y, teBack.y, 1e-5, `Euler.setFromQuaternion(${order}).y`);
    assertClose(eBack.z, teBack.z, 1e-5, `Euler.setFromQuaternion(${order}).z`);
  }

  // Slerp & rotateTowards vs Three.js
  const qa = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2);
  const qb = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.4);
  const qs = qa.clone().slerp(qb, 0.35);

  const tqa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2);
  const tqb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.4);
  const tqs = tqa.clone().slerp(tqb, 0.35);
  assertArrayClose(qs.toArray(), tqs.toArray(), 1e-6, 'Quaternion.slerp');

  assertClose(qa.angleTo(qb), tqa.angleTo(tqb), 1e-6, 'Quaternion.angleTo');
  const qr = qa.clone().rotateTowards(qb, 0.25);
  const tqr = tqa.clone().rotateTowards(tqb, 0.25);
  assertArrayClose(qr.toArray(), tqr.toArray(), 1e-6, 'Quaternion.rotateTowards');
});

test('Color parity with Three.js (hex, sRGB/Linear, lerp, style)', () => {
  const c = new Color(0x3a7bd5);
  const tc = new THREE.Color(0x3a7bd5);

  assertClose(c.r, tc.r, 1e-6, 'Color.r');
  assertClose(c.g, tc.g, 1e-6, 'Color.g');
  assertClose(c.b, tc.b, 1e-6, 'Color.b');
  assert.equal(c.getHex(), tc.getHex());

  const c2 = new Color('#ff8800');
  const tc2 = new THREE.Color('#ff8800');
  c.lerp(c2, 0.4);
  tc.lerp(tc2, 0.4);
  assertClose(c.r, tc.r, 1e-6, 'Color.lerp.r');
  assertClose(c.g, tc.g, 1e-6, 'Color.lerp.g');
  assertClose(c.b, tc.b, 1e-6, 'Color.lerp.b');

  const lin = new Color().setRGB(0.5, 0.25, 0.75, 'srgb-linear');
  const srgb = lin.clone().convertLinearToSRGB();
  const roundtrip = srgb.clone().convertSRGBToLinear();
  assertClose(roundtrip.r, 0.5, 1e-4);
  assertClose(roundtrip.g, 0.25, 1e-4);
  assertClose(roundtrip.b, 0.75, 1e-4);
});

test('Plane, Sphere, Box3, Ray parity with Three.js', () => {
  // Plane
  const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), new Vector3(0, 5, 0));
  assertClose(plane.distanceToPoint(new Vector3(3, 8, -2)), 3);
  const hit = plane.intersectLine({ start: new Vector3(0, 0, 0), end: new Vector3(0, 10, 0) }, new Vector3());
  assert.ok(hit !== null);
  assert.equal(hit.equals(new Vector3(0, 5, 0)), true);

  // Box3 & Sphere
  const box = new Box3().setFromPoints([
    new Vector3(-2, 0, -3),
    new Vector3(4, 6, 5),
    new Vector3(1, 2, 1),
  ]);
  assert.equal(box.getCenter(new Vector3()).equals(new Vector3(1, 3, 1)), true);
  assert.equal(box.getSize(new Vector3()).equals(new Vector3(6, 6, 8)), true);

  const innerBox = new Box3(new Vector3(-1, 1, -1), new Vector3(2, 4, 3));
  assert.equal(box.containsBox(innerBox), true);
  assert.equal(box.intersectsBox(innerBox), true);

  const sphere = new Sphere(new Vector3(1, 3, 1), 2);
  assert.equal(sphere.intersectsBox(box), true);
  assert.equal(sphere.intersectsPoint(new Vector3(2, 3, 1)), true);
  assert.equal(sphere.intersectsPoint(new Vector3(10, 3, 1)), false);
  assert.equal(sphere.intersectsSphere(new Sphere(new Vector3(4, 3, 1), 1.5)), true);
  assert.equal(sphere.intersectsSphere(new Sphere(new Vector3(10, 3, 1), 1.5)), false);

  // Box3.applyMatrix4 parity with Three.js
  const rotMat = new Matrix4().makeRotationY(Math.PI / 4).setPosition(10, 20, 30);
  const tRotMat = new THREE.Matrix4().fromArray(rotMat.elements);
  const boxTransformed = box.clone().applyMatrix4(rotMat);
  const tBoxTransformed = new THREE.Box3(
    new THREE.Vector3(-2, 0, -3),
    new THREE.Vector3(4, 6, 5),
  ).applyMatrix4(tRotMat);
  assertArrayClose(boxTransformed.min.toArray(), tBoxTransformed.min.toArray(), 1e-5, 'Box3.applyMatrix4.min');
  assertArrayClose(boxTransformed.max.toArray(), tBoxTransformed.max.toArray(), 1e-5, 'Box3.applyMatrix4.max');

  // Box3.setFromObject
  const mockObj = {
    matrixWorld: new Matrix4().makeVoxelTransform(10, 20, 30),
    geometry: {
      boundingBox: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      computeBoundingBox() {},
    },
  };
  const objBox = new Box3().setFromObject(mockObj);
  assert.equal(objBox.min.equals(new Vector3(9, 19, 29)), true);
  assert.equal(objBox.max.equals(new Vector3(11, 21, 31)), true);

  // Ray: intersectsBox, intersectsSphere, intersectTriangle, closestPointToPoint, recast, applyMatrix4
  const ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
  assert.equal(ray.intersectsSphere(new Sphere(new Vector3(0, 0, 0), 2)), true);
  assert.equal(ray.intersectsBox(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))), true);

  const triHit = ray.intersectTriangle(
    new Vector3(-2, -2, 0),
    new Vector3(2, -2, 0),
    new Vector3(0, 2, 0),
    true,
    new Vector3(),
  );
  assert.ok(triHit !== null);
  assertArrayClose(triHit.toArray(), [0, 0, 0], 1e-6, 'Ray.intersectTriangle');

  // Backface culled when winding is reversed
  const backfaceHit = ray.intersectTriangle(
    new Vector3(-2, -2, 0),
    new Vector3(0, 2, 0),
    new Vector3(2, -2, 0),
    true,
    new Vector3(),
  );
  assert.equal(backfaceHit, null);

  assertClose(ray.distanceToPoint(new Vector3(3, 4, 2)), 5);
  assert.equal(ray.closestPointToPoint(new Vector3(3, 4, 2), new Vector3()).equals(new Vector3(0, 0, 2)), true);

  const recasted = ray.clone().recast(4);
  assert.equal(recasted.origin.equals(new Vector3(0, 0, 6)), true);
});
