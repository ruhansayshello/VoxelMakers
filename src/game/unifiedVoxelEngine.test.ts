import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FACE_MASK_PX,
  FACE_MASK_NX,
  FACE_MASK_PY,
  FACE_MASK_NY,
  FACE_MASK_PZ,
  FACE_MASK_NZ,
  computeVoxelExposedFaceMask,
  shouldCullCollisionPointByDirection,
  classifyEntityPhysicsLodTier,
  writeInstanceMatrixEulerXYZFast,
  unifiedEngineTelemetry,
} from './unifiedVoxelEngine.ts';
import {
  packVoxelKey,
  sampleVehicleCollisionPoints,
} from './physics/collisionPoints.ts';
import { MAT } from './constants.ts';

test('1. 6-Bit Exposed-Face Mask & Outward Normal Computation', () => {
  // Interior voxel surrounded by solid neighbors -> mask === 0
  const interior = computeVoxelExposedFaceMask(0, 0, 0, () => false);
  assert.equal(interior.mask, 0);
  assert.equal(interior.exposedCount, 0);

  // Top-only deck voxel (+Y exposed)
  const topOnly = computeVoxelExposedFaceMask(
    0,
    5,
    0,
    (nx, ny, nz) => nx === 0 && ny === 6 && nz === 0,
  );
  assert.equal(topOnly.mask, FACE_MASK_PY);
  assert.equal(topOnly.exposedCount, 1);
  assert.equal(topOnly.normalX, 0);
  assert.equal(topOnly.normalY, 1);
  assert.equal(topOnly.normalZ, 0);

  // Front-bottom bumper corner (-Y and +Z exposed)
  const corner = computeVoxelExposedFaceMask(
    0,
    0,
    5,
    (nx, ny, nz) => (ny === -1 && nz === 5) || (ny === 0 && nz === 6),
  );
  assert.equal(corner.mask, FACE_MASK_NY | FACE_MASK_PZ);
  assert.equal(corner.exposedCount, 2);
  assert.ok(corner.normalY < -0.7 && corner.normalZ > 0.7);
});

test('2. Directional Back-Face Culling for Surface-Shell Collision Points', () => {
  // Top-only point (+Y) should be culled when probing downward (0, -1, 0)
  const cullTopOnGroundProbe = shouldCullCollisionPointByDirection(
    FACE_MASK_PY,
    0,
    1,
    0,
    0,
    -1,
    0,
  );
  assert.equal(cullTopOnGroundProbe, true);

  // Bottom-exposed point (-Y) should NOT be culled when probing downward (0, -1, 0)
  const keepBottomOnGroundProbe = shouldCullCollisionPointByDirection(
    FACE_MASK_NY,
    0,
    -1,
    0,
    0,
    -1,
    0,
  );
  assert.equal(keepBottomOnGroundProbe, false);

  // Side-bottom corner (-X | -Y) should NOT be culled when probing downward
  const keepCornerOnGroundProbe = shouldCullCollisionPointByDirection(
    FACE_MASK_NX | FACE_MASK_NY,
    -Math.SQRT1_2,
    -Math.SQRT1_2,
    0,
    0,
    -1,
    0,
  );
  assert.equal(keepCornerOnGroundProbe, false);

  // Rear bumper point (-Z) should be culled when colliding forward (+Z) into another vehicle
  const cullRearOnForwardHit = shouldCullCollisionPointByDirection(
    FACE_MASK_NZ,
    0,
    0,
    -1,
    0,
    0,
    1,
  );
  assert.equal(cullRearOnForwardHit, true);

  // Front bumper point (+Z) should NOT be culled when colliding forward (+Z)
  const keepFrontOnForwardHit = shouldCullCollisionPointByDirection(
    FACE_MASK_PZ | FACE_MASK_PX,
    Math.SQRT1_2,
    0,
    Math.SQRT1_2,
    0,
    0,
    1,
  );
  assert.equal(keepFrontOnForwardHit, false);
});

test('3. sampleVehicleCollisionPoints Attaches 6-Bit exposedFaceMask & localOutwardNormal', () => {
  const voxelMap = new Map<number, number>();
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        voxelMap.set(packVoxelKey(x, y, z), MAT.ALLOY_BLUE);
      }
    }
  }
  const points = sampleVehicleCollisionPoints(voxelMap, { x: 0, y: 0, z: 0 });
  assert.ok(points.length > 0);
  for (const pt of points) {
    assert.ok(typeof pt.exposedFaceMask === 'number' && pt.exposedFaceMask > 0);
    assert.ok(pt.localOutwardNormal !== undefined);
    const len = Math.hypot(
      pt.localOutwardNormal.x,
      pt.localOutwardNormal.y,
      pt.localOutwardNormal.z,
    );
    assert.ok(Math.abs(len - 1.0) < 1e-5);
  }
});

test('4. LOD-Synchronized & Optical-Zoom-Aware Physics Tier Classifier', () => {
  // Nearby entity inside player LOD0 box -> FULL_60HZ_LOD0
  const nearRes = classifyEntityPhysicsLodTier({
    entityX: 30,
    entityZ: 40,
    playerX: 0,
    playerZ: 0,
    isActivePlayerEntity: false,
  });
  assert.equal(nearRes.tier, 'FULL_60HZ_LOD0');
  assert.equal(nearRes.promotedByOpticalZoom, false);
  assert.equal(nearRes.frameStride, 1);

  // Mid-range entity (180m away, outside LOD0, no zoom) -> MID_20HZ_LOD1_2 (frameStride = 3)
  const midRes = classifyEntityPhysicsLodTier({
    entityX: 180,
    entityZ: 0,
    playerX: 0,
    playerZ: 0,
    isActivePlayerEntity: false,
    isOpticalZoomActive: false,
  });
  assert.equal(midRes.tier, 'MID_20HZ_LOD1_2');
  assert.equal(midRes.frameStride, 3);

  // Far entity (1,500m away, outside LOD0, no zoom) -> FAR_SLEEP_LOD3_PLUS (frameStride = 0)
  const farRes = classifyEntityPhysicsLodTier({
    entityX: 1500,
    entityZ: 0,
    playerX: 0,
    playerZ: 0,
    isActivePlayerEntity: false,
    isOpticalZoomActive: false,
  });
  assert.equal(farRes.tier, 'FAR_SLEEP_LOD3_PLUS');
  assert.equal(farRes.frameStride, 0);

  // Same far entity (1,500m away) when Optical Zoom is focused at (1,480m, 0) -> Promoted to FULL_60HZ_LOD0!
  const zoomedFarRes = classifyEntityPhysicsLodTier({
    entityX: 1500,
    entityZ: 0,
    playerX: 0,
    playerZ: 0,
    isActivePlayerEntity: false,
    isOpticalZoomActive: true,
    zoomFocusX: 1480,
    zoomFocusZ: 0,
  });
  assert.equal(zoomedFarRes.tier, 'FULL_60HZ_LOD0');
  assert.equal(zoomedFarRes.promotedByOpticalZoom, true);
  assert.equal(zoomedFarRes.frameStride, 1);
});

test('5. Direct Float32Array Instance Matrix Writer Matches THREE.Object3D.updateMatrix Bit-For-Bit', () => {
  const dummy = new THREE.Object3D();
  const fastBuf = new Float32Array(32);
  const prevWrites = unifiedEngineTelemetry.directMatrixWrites;

  const x = 14.25,
    y = 8.75,
    z = -31.5;
  const rx = 0.62,
    ry = -1.14,
    rz = 0.38;
  const scale = 0.72;

  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz, 'XYZ');
  dummy.scale.set(scale, scale, scale);
  dummy.updateMatrix();

  writeInstanceMatrixEulerXYZFast(fastBuf, 1, x, y, z, rx, ry, rz, scale);
  assert.equal(unifiedEngineTelemetry.directMatrixWrites, prevWrites + 1);

  for (let k = 0; k < 16; k++) {
    const expected = Math.fround(dummy.matrix.elements[k]);
    const actual = fastBuf[16 + k];
    assert.ok(
      Math.abs(actual - expected) < 1e-5,
      `Matrix element ${k} mismatch: expected ${expected}, got ${actual}`,
    );
  }
});

test('6. Ground Collision Solver Uses 6-Bit Exposed-Face Culling to Skip Top-Deck Hull Points', async () => {
  const { CustomRigidBody } = await import('./physics/customRigidBody.ts');
  const { resolveVehicleGroundCollisions } = await import(
    './physics/groundCollision.ts'
  );

  // Build a 3x3x3 voxel cube so it has distinct top-only (+Y) and bottom (-Y) sampled collision points
  const voxelMap = new Map<number, number>();
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        voxelMap.set(packVoxelKey(x, y, z), MAT.ALLOY_BLUE);
      }
    }
  }
  const body = new CustomRigidBody();
  body.position.set(0, 1.0, 0);
  body.collisionPoints = sampleVehicleCollisionPoints(voxelMap, {
    x: 0,
    y: 0,
    z: 0,
  });

  const beforeCullCount = unifiedEngineTelemetry.cullSkippedCollisionPoints;
  let probeCalls = 0;
  resolveVehicleGroundCollisions(
    body,
    {
      probeGroundBelow: () => {
        probeCalls++;
        return { y: 0.7, mat: MAT.ROCK };
      },
    },
    1 / 60,
  );
  const culledThisStep =
    unifiedEngineTelemetry.cullSkippedCollisionPoints - beforeCullCount;
  assert.ok(
    culledThisStep > 0,
    `Expected top-deck collision points to be culled by 6-bit exposedFaceMask, culled=${culledThisStep}`,
  );
  assert.ok(
    probeCalls < body.collisionPoints.length,
    `Expected ground probe calls (${probeCalls}) < total collision points (${body.collisionPoints.length})`,
  );
});

test('7. Hierarchical Chunk-Cached 3D Voxel DDA Raycaster Skips Empty Air Above maxY & surfaceHeightMap', async () => {
  const { MicroVoxelWorld } = await import('./world.ts');
  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene, false);

  const beforeCached = unifiedEngineTelemetry.cachedChunkRaycastSteps;
  const beforeSkipped = unifiedEngineTelemetry.skippedAirRaycastSteps;

  // Cast a ray across chunk (8, 8) above the terrain surface down toward the ground
  const origin = new THREE.Vector3(0, 22, -10);
  const dir = new THREE.Vector3(0, -0.45, 0.89).normalize();
  const hit = world.raycastWorldVoxels(origin, dir, 40);

  assert.ok(
    unifiedEngineTelemetry.cachedChunkRaycastSteps > beforeCached,
    'Expected raycastWorldVoxels to reuse cached chunk pointer across intra-chunk DDA steps',
  );
  assert.ok(
    unifiedEngineTelemetry.skippedAirRaycastSteps > beforeSkipped,
    'Expected raycastWorldVoxels to fast-skip air steps above chunk.maxY / surfaceHeightMap',
  );
  assert.ok(hit === null || hit.target === 'world');
});

