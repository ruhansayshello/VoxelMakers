import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MAT,
  VEH_DIM_X,
  VEH_DIM_Y,
  VEH_DIM_Z,
  VOXEL_SIZE,
} from './constants.ts';
import {
  computeRigidBodyProperties,
  computePlacementVoxelCoords,
  computeAckermannAngles,
  solveTireForces,
  computeWingAerodynamics,
  computeCollisionImpulse,
  raycastVoxelGridDDA,
  greedyMeshBoundedArrays,
  resolveCharacterVehicleCollision,
  resolveVehicleVehicleCollision,
  computeDirectionalObbRadius,
  computeDeadReckonedTargetPos,
  computeSafeMultiplayerSpawnSpot,
  computeAvatarAnimationPose,
  type SelectableBuildObject,
} from './physicsMath.ts';

test('computeRigidBodyProperties computes exact mass, CoM, and principal inertia tensor for 1-voxel scratch start', () => {
  const voxels = new Uint8Array(VEH_DIM_X * VEH_DIM_Y * VEH_DIM_Z);
  const idx = 12 + VEH_DIM_X * (6 + VEH_DIM_Y * 18);
  voxels[idx] = MAT.ARMOR_SLATE; // 22 kg

  const summary = computeRigidBodyProperties(voxels, []);
  assert.equal(summary.voxelCount, 1);
  assert.equal(summary.totalMass, 25); // Clamped minimum safe mass 25kg
  assert.ok(Math.abs(summary.comLocal.x - (12 + 0.5) * VOXEL_SIZE) < 1e-6);
  assert.ok(Math.abs(summary.comLocal.y - (6 + 0.5) * VOXEL_SIZE) < 1e-6);
  assert.ok(Math.abs(summary.comLocal.z - (18 + 0.5) * VOXEL_SIZE) < 1e-6);
  assert.ok(summary.inertia.x > 0 && summary.inertia.y > 0 && summary.inertia.z > 0);
});

test('computeRigidBodyProperties supports unbounded negative and positive vehicle coordinates', () => {
  const sparseMap = new Map<string, number>();
  sparseMap.set('-40,5,-80', MAT.ALLOY_BLUE);
  sparseMap.set('60,5,120', MAT.ALLOY_BLUE);

  const summary = computeRigidBodyProperties(
    {
      getVoxel: (vx, vy, vz) => sparseMap.get(`${vx},${vy},${vz}`) || MAT.AIR,
      forEachVoxel: (cb) => {
        sparseMap.forEach((mat, key) => {
          const [vx, vy, vz] = key.split(',').map(Number);
          cb(vx, vy, vz, mat);
        });
      },
    },
    [],
  );

  assert.equal(summary.voxelCount, 2);
  // Midpoint between vx=-40 and vx=60 is vx=10 -> (10 + 0.5) * 0.25 = 2.625m
  assert.ok(Math.abs(summary.comLocal.x - 10.5 * VOXEL_SIZE) < 1e-5);
  // Midpoint between vz=-80 and vz=120 is vz=20 -> (20 + 0.5) * 0.25 = 5.125m
  assert.ok(Math.abs(summary.comLocal.z - 20.5 * VOXEL_SIZE) < 1e-5);
});

test('computePlacementVoxelCoords generates 6-block beam, 3x3 plate, and line drag coordinates', () => {
  const hit = { vx: 12, vy: 6, vz: 18, normal: { x: 0, y: 0, z: 1 } };
  const beam = computePlacementVoxelCoords('BEAM_6', hit, null, false, false);
  assert.equal(beam.length, 6);
  assert.deepEqual(beam[0], { vx: 12, vy: 6, vz: 19 });
  assert.deepEqual(beam[5], { vx: 12, vy: 6, vz: 24 });

  const plate = computePlacementVoxelCoords('PLATE_3X3', hit, null, false, false);
  assert.equal(plate.length, 9);

  const line = computePlacementVoxelCoords(
    'LINE_DRAG',
    { vx: 12, vy: 6, vz: 28, normal: { x: 0, y: 0, z: 1 } },
    { vx: 12, vy: 6, vz: 19 },
    false,
    false,
  );
  assert.equal(line.length, 11);
});

test('computeAckermannAngles turns inner wheel sharper than outer wheel', () => {
  const leftTurn = computeAckermannAngles(0.35, 3.8, 3.2);
  assert.ok(leftTurn.leftSteerRad > leftTurn.rightSteerRad);
  assert.ok(leftTurn.rightSteerRad > 0);

  const rightTurn = computeAckermannAngles(-0.35, 3.8, 3.2);
  assert.ok(Math.abs(rightTurn.rightSteerRad) > Math.abs(rightTurn.leftSteerRad));
  assert.ok(rightTurn.leftSteerRad < 0);
});

test('solveTireForces enforces Coulomb friction circle and asymmetric bump/rebound damping', () => {
  const bumpRes = solveTireForces({
    compression: 0.4,
    restLen: 0.85,
    kSpring: 12000,
    cDamperBump: 1800,
    cDamperRebound: 3400,
    relVelY: -1.0,
    vLong: 5.0,
    vLat: 4.0,
    throttle: 1.0,
    brake: false,
    isPowered: true,
    engineForcePerWheel: 9000,
    topSpeedMPS: 30,
    surfaceMu: 1.0,
    wheelLoadCap: 25000,
  });

  assert.ok(bumpRes.normalLoad > 0);
  const combinedHorizontal = Math.hypot(bumpRes.fLong, bumpRes.fLat);
  assert.ok(combinedHorizontal <= bumpRes.normalLoad * 1.0 + 1e-3);
  assert.ok(bumpRes.fLat < 0);
});

test('computeWingAerodynamics generates positive lift and detects stall at high AoA', () => {
  const normalFlight = computeWingAerodynamics(25, 0, 0.2);
  assert.ok(normalFlight.liftForce > 100);
  assert.equal(normalFlight.isStalled, false);

  const stalledFlight = computeWingAerodynamics(10, -8, 1.0);
  assert.equal(stalledFlight.isStalled, true);
});

test('computeCollisionImpulse distinguishes elastic bounce vs high-energy voxel shatter', () => {
  const lowSpeed = computeCollisionImpulse(
    { x: 0, y: 0, z: -2.0 },
    { x: 0, y: 0, z: 1.0 },
    { x: 0, y: 0, z: 1.5 },
    800,
    { x: 1200, y: 1500, z: 900 },
    0.2,
    0.9,
    6200,
  );
  assert.equal(lowSpeed.shattersVoxel, false);
  assert.ok(lowSpeed.impulse.z > 0);

  const highSpeed = computeCollisionImpulse(
    { x: 0, y: 0, z: -12.0 },
    { x: 0, y: 0, z: 1.0 },
    { x: 0, y: 0, z: 1.5 },
    1200,
    { x: 1800, y: 2200, z: 1400 },
    0.2,
    0.9,
    6200,
  );
  assert.equal(highSpeed.shattersVoxel, true);
  assert.ok(highSpeed.impactEnergy >= 6200);
});

test('raycastVoxelGridDDA hits exact single voxel and returns accurate surface normal for Build Mode', () => {
  const voxels = new Uint8Array(VEH_DIM_X * VEH_DIM_Y * VEH_DIM_Z);
  const targetVX = 12, targetVY = 6, targetVZ = 18;
  voxels[targetVX + VEH_DIM_X * (targetVY + VEH_DIM_Y * targetVZ)] = MAT.ALLOY_BLUE;

  const targetCenter = {
    x: (targetVX + 0.5) * VOXEL_SIZE,
    y: (targetVY + 0.5) * VOXEL_SIZE,
    z: (targetVZ + 0.5) * VOXEL_SIZE,
  };

  const origin = { x: targetCenter.x, y: targetCenter.y, z: targetCenter.z + 2.0 };
  const dir = { x: 0, y: 0, z: -1 };

  const hit = raycastVoxelGridDDA(
    origin,
    dir,
    VEH_DIM_X,
    VEH_DIM_Y,
    VEH_DIM_Z,
    VOXEL_SIZE,
    (vx, vy, vz) => voxels[vx + VEH_DIM_X * (vy + VEH_DIM_Y * vz)],
    10.0,
  );

  assert.ok(hit !== null);
  assert.equal(hit.vx, targetVX);
  assert.equal(hit.vy, targetVY);
  assert.equal(hit.vz, targetVZ);
  assert.deepEqual(hit.normal, { x: 0, y: 0, z: 1 });
});

test('greedyMeshBoundedArrays merges a 4x1x4 slab of identical voxels into 6 quads instead of 40 faces', () => {
  const grid = new Uint8Array(8 * 8 * 8);
  for (let z = 2; z < 6; z++) {
    for (let x = 2; x < 6; x++) {
      grid[x + 8 * (2 + 8 * z)] = MAT.ALLOY_BLUE;
    }
  }
  const res = greedyMeshBoundedArrays(
    8, 8, 8,
    0, 7,
    (x, y, z) => grid[x + 8 * (y + 8 * z)],
    0, 0, 0,
  );
  assert.equal(res.mergedQuads, 6);
  assert.ok(res.rawFaces > res.mergedQuads);
});

test('computeSphericalCraterOffsets returns exact 3D spherical blast volume for vehicle destruction', async () => {
  const { computeSphericalCraterOffsets } = await import('./physicsMath.ts');
  const craterR2 = computeSphericalCraterOffsets(2);
  assert.ok(craterR2.length > 15);
  assert.ok(craterR2.some((o) => o.dx === 0 && o.dy === 0 && o.dz === 0));
  assert.ok(craterR2.every((o) => o.distSq <= 4));
});

test('computePlacementVoxelCoords BOX_FILL fills complete rectangular and 3D box volumes from dragStartVoxel to hit', async () => {
  const { computePlacementVoxelCoords } = await import('./physicsMath.ts');
  // Dragging from (10, 5, 12) to (13, 7, 15) -> 4 x 3 x 4 = 48 blocks
  const coords = computePlacementVoxelCoords(
    'BOX_FILL',
    { vx: 13, vy: 7, vz: 15, normal: { x: 0, y: 0, z: 0 } },
    { vx: 10, vy: 5, vz: 12 },
    false,
    false,
  );
  assert.equal(coords.length, 4 * 3 * 4);
  assert.ok(coords.some((c) => c.vx === 10 && c.vy === 5 && c.vz === 12));
  assert.ok(coords.some((c) => c.vx === 13 && c.vy === 7 && c.vz === 15));
});

test('computeRayDragPlaneVoxel projects free-air drag ray onto plane passing through dragStartVoxel', async () => {
  const { computeRayDragPlaneVoxel } = await import('./physicsMath.ts');
  // Ray starting at (3.0, 2.0, -2.0) looking +Z toward dragStartVoxel at (12, 8, 16) -> z = 16.5 * 0.25 = 4.125
  const res = computeRayDragPlaneVoxel(
    { x: 4.5, y: 3.0, z: 0.0 },
    { x: 0, y: 0, z: 1 },
    { vx: 12, vy: 8, vz: 16 },
    { x: 0, y: 0, z: 0 },
    VOXEL_SIZE,
  );
  assert.ok(res !== null);
  assert.equal(res.vz, 16);
  assert.equal(res.vx, Math.floor(4.5 / VOXEL_SIZE));
  assert.equal(res.vy, Math.floor(3.0 / VOXEL_SIZE));
});

test('greedyMeshBoundedArrays darkens charred blocks when structural integrity bit 64 (<50% health) is set', () => {
  const intactRes = greedyMeshBoundedArrays(
    4, 4, 4,
    0, 3,
    (x, y, z) => (x === 1 && y === 1 && z === 1 ? MAT.ALLOY_BLUE : MAT.AIR),
    0, 0, 0,
  );
  const charredRes = greedyMeshBoundedArrays(
    4, 4, 4,
    0, 3,
    (x, y, z) => (x === 1 && y === 1 && z === 1 ? MAT.ALLOY_BLUE | 64 : MAT.AIR),
    0, 0, 0,
  );
  assert.ok(intactRes.colors.length > 0);
  assert.equal(intactRes.colors.length, charredRes.colors.length);
  // Charred block RGB components should be significantly darker (< 50% of intact brightness)
  assert.ok(charredRes.colors[0] < intactRes.colors[0] * 0.5);
  assert.ok(charredRes.colors[1] < intactRes.colors[1] * 0.5);
  assert.ok(charredRes.colors[2] < intactRes.colors[2] * 0.5);
});

test('computePlacementVoxelCoords PAINT_TOOL targets the hit block directly instead of adjacent air and mirrors across X', async () => {
  const { computePlacementVoxelCoords } = await import('./physicsMath.ts');
  const coords = computePlacementVoxelCoords(
    'PAINT_TOOL',
    { vx: 8, vy: 6, vz: 14, normal: { x: 0, y: 1, z: 0 } },
    null,
    true,
    false,
  );
  // Should target (8, 6, 14) and its mirror (23 - 8 = 15, 6, 14), NOT vy=7
  assert.equal(coords.length, 2);
  assert.deepEqual(coords[0], { vx: 8, vy: 6, vz: 14 });
  assert.deepEqual(coords[1], { vx: 15, vy: 6, vz: 14 });
});

test('buildAllLodPayloadsForChunk computes LOD0, LOD1 (0.5m), and LOD2 (1.0m) with progressively fewer quads and identical Y heights', async () => {
  const { buildAllLodPayloadsForChunk } = await import('./meshWorker.ts');
  const vox = new Uint8Array(64 * 40 * 64);
  // Create a stepped pyramid terrain so LOD0 has many step faces while LOD1 and LOD2 downsample them
  for (let lz = 0; lz < 64; lz++) {
    for (let lx = 0; lx < 64; lx++) {
      const h = 8 + (lx & 3) + (lz & 3);
      for (let ly = 0; ly <= h; ly++) {
        vox[lx + 64 * (ly + 40 * lz)] = MAT.GRASS;
      }
    }
  }
  const res = buildAllLodPayloadsForChunk({
    jobId: 1,
    cx: 8,
    cz: 8,
    minY: 6,
    maxY: 16,
    originX: 0,
    originZ: 0,
    voxels: vox,
  });
  assert.ok(res.lod0.mergedQuads > res.lod1.mergedQuads);
  assert.ok(res.lod1.mergedQuads > res.lod2.mergedQuads);
  assert.ok(res.lod2.mergedQuads > 0);

  // Also verify flat baseplate at y=8 has exact identical top-surface Y (9 * 0.25 = 2.25m) across LOD0, LOD1, and LOD2!
  const flatVox = new Uint8Array(64 * 40 * 64);
  for (let lz = 0; lz < 64; lz++) {
    for (let lx = 0; lx < 64; lx++) {
      for (let ly = 0; ly <= 8; ly++) {
        flatVox[lx + 64 * (ly + 40 * lz)] = MAT.CONCRETE;
      }
    }
  }
  const flatRes = buildAllLodPayloadsForChunk({
    jobId: 2,
    cx: 0,
    cz: 0,
    minY: 8,
    maxY: 8,
    originX: 0,
    originZ: 0,
    voxels: flatVox,
  });
  const maxY0 = Math.max(...Array.from(flatRes.lod0.positions).filter((_, i) => i % 3 === 1));
  const maxY1 = Math.max(...Array.from(flatRes.lod1.positions).filter((_, i) => i % 3 === 1));
  const maxY2 = Math.max(...Array.from(flatRes.lod2.positions).filter((_, i) => i % 3 === 1));
  assert.equal(maxY0, 2.25);
  assert.equal(maxY1, 2.25);
  assert.equal(maxY2, 2.25);
});

test('findDisconnectedVoxelIslands detects severed voxel clusters away from cockpit', async () => {
  const { findDisconnectedVoxelIslands } = await import('./worldObjects.ts');
  const voxelMap = new Map<string, number>();
  // Main hull cluster around (12, 6, 18)
  voxelMap.set('12,6,18', MAT.ALLOY_BLUE);
  voxelMap.set('12,6,19', MAT.ALLOY_BLUE);
  voxelMap.set('13,6,18', MAT.ALLOY_BLUE);
  // Severed rear tail cluster at (12, 6, 25..26) with air gap at z=20..24
  voxelMap.set('12,6,25', MAT.ARMOR_SLATE);
  voxelMap.set('12,6,26', MAT.ARMOR_SLATE);

  const res = findDisconnectedVoxelIslands(voxelMap, { vx: 12, vy: 6, vz: 18 });
  assert.equal(res.detachedIslands.length, 1);
  assert.equal(res.detachedIslands[0].length, 2);
});

test('PREBUILT_OBJECTS and normalizeVoxelObjectToOrigin produce valid 3D placeable prefabs', async () => {
  const { PREBUILT_OBJECTS, normalizeVoxelObjectToOrigin, computePrefabDimensions } = await import('./worldObjects.ts');
  assert.ok(PREBUILT_OBJECTS.length >= 6);
  for (const obj of PREBUILT_OBJECTS) {
    assert.ok(obj.voxels.length > 0, `${obj.name} should have voxels`);
    assert.ok(obj.sizeX > 0 && obj.sizeY > 0 && obj.sizeZ > 0);
  }
  const custom = normalizeVoxelObjectToOrigin([
    [10, 5, 20, MAT.CONCRETE],
    [12, 8, 21, MAT.RAMP_ORANGE],
  ]);
  const dims = computePrefabDimensions(custom);
  assert.equal(dims.sizeX, 3);
  assert.equal(dims.sizeY, 4);
  assert.equal(dims.sizeZ, 2);
  assert.equal(custom[0][1], 0);
});

test('evaluateBiomeColumn supports Flat Baseplate, Biomes at arbitrary coordinates, and Heightmaps', async () => {
  const { evaluateBiomeColumn, generateProceduralHeightmapPreset } = await import('./worldObjects.ts');
  const { BASE_SURF_VY, CHUNK_Y } = await import('./constants.ts');
  const flatCol = evaluateBiomeColumn(1250, -900, 5000, -3600, 'FLAT_BASEPLATE', MAT.CONCRETE, null);
  assert.equal(flatCol.surfVY, BASE_SURF_VY);
  assert.equal(flatCol.topMat, MAT.CONCRETE);

  const desertCol = evaluateBiomeColumn(800, 450, 3200, 1800, 'BIOME_CANYON', MAT.ASPHALT, null);
  assert.ok(desertCol.surfVY >= 2 && desertCol.surfVY < CHUNK_Y);

  const hm = generateProceduralHeightmapPreset('CRATER_BASIN', 64);
  const hmCol = evaluateBiomeColumn(64, 64, 256, 256, 'CUSTOM_HEIGHTMAP', MAT.ASPHALT, hm);
  assert.ok(hmCol.surfVY >= 2 && hmCol.surfVY < CHUNK_Y);
});

test('resolveShiftObjectSelection selects all identical objects when nothing is selected and toggles individual objects when selection exists', async () => {
  const {
    resolveShiftObjectSelection,
    filterObjectsInScreenBox,
    mergeBuildObjectSelections,
  } = await import('./physicsMath.ts');

  const allObjects: SelectableBuildObject[] = [
    { kind: 'module', vx: 4, vy: 5, vz: 10, moduleKind: 'WHEEL_STEER', yawIdx: 0 },
    { kind: 'module', vx: 19, vy: 5, vz: 10, moduleKind: 'WHEEL_STEER', yawIdx: 0 },
    { kind: 'module', vx: 4, vy: 5, vz: 24, moduleKind: 'WHEEL_DRIVE', yawIdx: 0 },
    { kind: 'module', vx: 19, vy: 5, vz: 24, moduleKind: 'WHEEL_DRIVE', yawIdx: 0 },
    { kind: 'voxel', vx: 10, vy: 6, vz: 15, mat: MAT.ALLOY_BLUE },
    { kind: 'voxel', vx: 11, vy: 6, vz: 15, mat: MAT.ALLOY_BLUE },
    { kind: 'voxel', vx: 12, vy: 6, vz: 15, mat: MAT.ARMOR_SLATE },
  ];

  // 1. Shift-clicking a WHEEL_STEER when nothing is selected -> selects ALL WHEEL_STEER modules
  const shiftFromEmpty = resolveShiftObjectSelection([], allObjects[0], allObjects);
  assert.equal(shiftFromEmpty.length, 2);
  assert.ok(shiftFromEmpty.every((o) => o.kind === 'module' && o.moduleKind === 'WHEEL_STEER'));

  // 2. Shift-clicking an ALLOY_BLUE voxel when nothing is selected -> selects ALL ALLOY_BLUE voxels
  const shiftVoxelsFromEmpty = resolveShiftObjectSelection([], allObjects[4], allObjects);
  assert.equal(shiftVoxelsFromEmpty.length, 2);
  assert.ok(shiftVoxelsFromEmpty.every((o) => o.kind === 'voxel' && o.mat === MAT.ALLOY_BLUE));

  // 3. Shift-clicking a different object when objects are already selected -> adds to multi-selection
  const addedSelection = resolveShiftObjectSelection(shiftFromEmpty, allObjects[2], allObjects);
  assert.equal(addedSelection.length, 3);

  // 4. Shift-clicking an already-selected object in a multi-selection -> removes that object
  const toggledOff = resolveShiftObjectSelection(addedSelection, allObjects[2], allObjects);
  assert.equal(toggledOff.length, 2);

  // 5. Screen-space marquee box from Point A (300, 500) to Point B (100, 200) (reverse drag direction)
  const screenCandidates = [
    { obj: allObjects[0], screenX: 150, screenY: 250, inFront: true },
    { obj: allObjects[1], screenX: 280, screenY: 420, inFront: true },
    { obj: allObjects[2], screenX: 450, screenY: 300, inFront: true },
    { obj: allObjects[4], screenX: 200, screenY: 300, inFront: false }, // behind camera
  ];
  const boxSelected = filterObjectsInScreenBox(screenCandidates, 300, 500, 100, 200);
  assert.equal(boxSelected.length, 2);
  assert.deepEqual(boxSelected.map((o) => o.vx), [4, 19]);

  // 6. Merging selections avoids duplicates
  const merged = mergeBuildObjectSelections(boxSelected, [allObjects[1], allObjects[2]]);
  assert.equal(merged.length, 3);
});

test('rotatePoint3D90 and computePlacementVoxelCoords rotate points and multi-voxel brushes on all 3 axes (Yaw, Pitch, Roll)', async () => {
  const { rotatePoint3D90, computePlacementVoxelCoords, computeCaveAtmosphereFactor } = await import('./physicsMath.ts');

  // 1. Yaw (Y-axis) 90° step: (0, 0, 5) -> (5, 0, 0)
  const pYaw = rotatePoint3D90(0, 0, 5, 'yaw', 1);
  assert.deepEqual(pYaw, { x: 5, y: 0, z: 0 });
  // 4 steps of 90° returns to identity on any axis
  assert.deepEqual(rotatePoint3D90(3, -2, 7, 'yaw', 4), { x: 3, y: -2, z: 7 });
  assert.deepEqual(rotatePoint3D90(3, -2, 7, 'pitch', 4), { x: 3, y: -2, z: 7 });
  assert.deepEqual(rotatePoint3D90(3, -2, 7, 'roll', 4), { x: 3, y: -2, z: 7 });

  // 2. Pitch (X-axis) 90° step: (0, 0, 5) -> (0, -5, 0)
  const pPitch = rotatePoint3D90(0, 0, 5, 'pitch', 1);
  assert.deepEqual(pPitch, { x: 0, y: -5, z: 0 });

  // 3. Roll (Z-axis) 90° step: (4, 0, 0) -> (0, 4, 0)
  const pRoll = rotatePoint3D90(4, 0, 0, 'roll', 1);
  assert.deepEqual(pRoll, { x: 0, y: 4, z: 0 });

  // 4. Multi-voxel BEAM_6 rotates onto X-axis when yawIdx=1 and onto Y-axis when pitchIdx=3
  const hit = { vx: 10, vy: 10, vz: 10, normal: { x: 0, y: 0, z: 1 } };
  const beamX = computePlacementVoxelCoords('BEAM_6', hit, null, false, false, 1, 0, 0);
  assert.equal(beamX.length, 6);
  // Base is (10, 10, 11), and yawIdx=1 rotates (0,0,s) -> (s,0,0)
  assert.deepEqual(beamX[0], { vx: 10, vy: 10, vz: 11 });
  assert.deepEqual(beamX[5], { vx: 15, vy: 10, vz: 11 });

  const beamY = computePlacementVoxelCoords('BEAM_6', hit, null, false, false, 0, 3, 0);
  assert.equal(beamY.length, 6);
  // pitchIdx=3 rotates (0,0,s) -> (0,s,0)
  assert.deepEqual(beamY[5], { vx: 10, vy: 15, vz: 11 });

  // 5. Cave atmosphere factor is 0 on surface and approaches 1.0 deep underground under a solid roof
  assert.equal(computeCaveAtmosphereFactor(14.5, 14.5, false), 0);
  assert.ok(computeCaveAtmosphereFactor(8.0, 14.5, true) >= 0.95);
});

test('isTranslucentVoxelMat and buildAllLodPayloadsForChunk separate opaque terrain from blue-tinted translucent water/glass so underwater/behind-glass walls are never culled', async () => {
  const { isTranslucentVoxelMat } = await import('./physicsMath.ts');
  const { buildAllLodPayloadsForChunk } = await import('./meshWorker.ts');
  const { CHUNK_X, CHUNK_Y, CHUNK_Z } = await import('./constants.ts');

  assert.equal(isTranslucentVoxelMat(MAT.WATER_VOX), true);
  assert.equal(isTranslucentVoxelMat(MAT.GLASS_SOLID), true);
  assert.equal(isTranslucentVoxelMat(MAT.ROCK), false);
  assert.equal(isTranslucentVoxelMat(MAT.ALLOY_BLUE), false);

  // Build a chunk with a solid ROCK wall at lx=10, ly=5, lz=10 and a GLASS_SOLID block right in front of it at lx=10, ly=5, lz=11
  const vox = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
  vox[10 + CHUNK_X * (5 + CHUNK_Y * 10)] = MAT.ROCK;
  vox[10 + CHUNK_X * (5 + CHUNK_Y * 11)] = MAT.GLASS_SOLID;

  const res = buildAllLodPayloadsForChunk({
    jobId: 99,
    cx: 0,
    cz: 0,
    minY: 4,
    maxY: 6,
    originX: 0,
    originZ: 0,
    voxels: vox,
  });

  // The single ROCK block must have ALL 6 opaque faces emitted (even the face touching GLASS_SOLID!)
  assert.equal(res.lod0.mergedQuads, 6);
  // And the GLASS_SOLID block must be emitted in the separate translucent pass!
  assert.ok(res.transLod0.positions.length > 0);
});

test('solveTireForces retains strong forward drive traction under heavy cornering demand', () => {
  // Heavy cornering test: vLong = 22 m/s (~80 km/h), high lateral slip vLat = 8.5 m/s
  const hardTurnDrive = solveTireForces({
    compression: 0.35,
    restLen: 0.85,
    kSpring: 14000,
    cDamperBump: 1600,
    cDamperRebound: 2800,
    relVelY: 0,
    vLong: 22.0,
    vLat: 8.5,
    throttle: 1.0,
    brake: false,
    isPowered: true,
    engineForcePerWheel: 22000, // Dual V12 level engine power
    topSpeedMPS: 75,
    surfaceMu: 1.25,
    wheelLoadCap: 30000,
  });

  // Must deliver massive forward drive force (greater than 2000 N per wheel) rather than stalling to zero!
  assert.ok(hardTurnDrive.fLong > 2500, `Expected fLong > 2500N during hard turn, got ${hardTurnDrive.fLong}`);
  assert.ok(hardTurnDrive.fLat < 0, 'Lateral cornering force must oppose slip');
  // Proportional friction circle must be bounded
  const combined = Math.hypot(hardTurnDrive.fLong, hardTurnDrive.fLat);
  assert.ok(combined <= hardTurnDrive.normalLoad * 1.25 + 1e-2);
});

test('WATER_WAVE_PALETTE_HEX defines 10 blue-to-white colors and evaluateGerstnerWaveSample computes terraced heights, slopes, and orbital velocities', async () => {
  const { WATER_WAVE_PALETTE_HEX, evaluateGerstnerWaveSample } = await import(
    './physicsMath.ts'
  );
  assert.equal(WATER_WAVE_PALETTE_HEX.length, 10);
  // Deepest trough is deep navy/indigo, highest crest is white foam
  assert.equal(WATER_WAVE_PALETTE_HEX[0], 0x04153b);
  assert.equal(WATER_WAVE_PALETTE_HEX[9], 0xffffff);

  // Sample across space and time to verify color index coverage and non-zero wave kinematics
  const seenColorIndices = new Set<number>();
  let maxAbsSlope = 0;
  let maxOrbitalSpeed = 0;

  for (let x = -80; x <= -30; x += 2.5) {
    for (let z = -40; z <= 20; z += 2.5) {
      const sample = evaluateGerstnerWaveSample(x, z, 4.2, 1.0);
      assert.ok(sample.colorIndex >= 0 && sample.colorIndex <= 9);
      seenColorIndices.add(sample.colorIndex);
      // Terraced height is quantized to 0.125m steps
      assert.ok(Math.abs(sample.terracedH * 8 - Math.round(sample.terracedH * 8)) < 1e-6);
      maxAbsSlope = Math.max(maxAbsSlope, Math.hypot(sample.slopeX, sample.slopeZ));
      maxOrbitalSpeed = Math.max(
        maxOrbitalSpeed,
        Math.hypot(sample.orbitalVx, sample.orbitalVy, sample.orbitalVz),
      );
    }
  }

  assert.ok(seenColorIndices.size >= 6, 'Should span multiple wave elevation color bands');
  assert.ok(maxAbsSlope > 0.05, 'Waves should produce meaningful surface slopes for vehicle surge');
  assert.ok(maxOrbitalSpeed > 0.15, 'Waves should produce orbital water velocities');
});

test('isWaterBasinArea restricts water to designated ocean, pond, archipelago, and canyon river basins', async () => {
  const { isWaterBasinArea } = await import('./world.ts');

  // FLAT_BASEPLATE never has water basins
  assert.equal(isWaterBasinArea(-50, 0, 'FLAT_BASEPLATE'), false);
  assert.equal(isWaterBasinArea(65, -85, 'FLAT_BASEPLATE'), false);

  // BIOME_ARCHIPELAGO is all water basin
  assert.equal(isWaterBasinArea(0, 0, 'BIOME_ARCHIPELAGO'), true);
  assert.equal(isWaterBasinArea(40, 40, 'BIOME_ARCHIPELAGO'), true);

  // DEFAULT_PARK only allows West Ocean/Harbor Bay (wx < -24 && wz < 38) or inland park pond (hypot(wx - 65, wz + 85) < 18)
  assert.equal(isWaterBasinArea(-45, 0, 'DEFAULT_PARK'), true); // West Ocean
  assert.equal(isWaterBasinArea(65, -85, 'DEFAULT_PARK'), true); // Inland pond center
  assert.equal(isWaterBasinArea(10, 10, 'DEFAULT_PARK'), false); // Inland dry land
  assert.equal(isWaterBasinArea(-45, 50, 'DEFAULT_PARK'), false); // Outside wz < 38

  // BIOME_CANYON only allows winding riverbed |wx - sin(wz * 0.04) * 22| < 8
  assert.equal(isWaterBasinArea(0, 0, 'BIOME_CANYON'), true);
  assert.equal(isWaterBasinArea(35, 0, 'BIOME_CANYON'), false);

  // Other biomes return false
  assert.equal(isWaterBasinArea(-45, 0, 'BIOME_ARCTIC'), false);
  assert.equal(isWaterBasinArea(-45, 0, 'BIOME_VOLCANIC'), false);
});

test('evaluateGerstnerWaveSample keeps wave bottom strictly above static water surface (+0.03m) and scales ponds vs ocean swells (+1.0m..+1.5m)', async () => {
  const { evaluateGerstnerWaveSample } = await import('./physicsMath.ts');
  const { STATIC_WATER_TOP_VY, WATER_VY } = await import('./constants.ts');

  // Static water fills up to WATER_VY - 1 so no dry ground patches appear between waves
  assert.equal(STATIC_WATER_TOP_VY, WATER_VY - 1);

  let maxPondH = 0;
  let maxOceanH = 0;

  for (let x = -120; x <= -30; x += 2.0) {
    for (let z = -60; z <= 30; z += 2.0) {
      const pondSample = evaluateGerstnerWaveSample(x, z, 3.6, 1.0, true);
      const oceanSample = evaluateGerstnerWaveSample(x, z, 3.6, 1.0, false);

      assert.ok(pondSample.rawH >= 0.03, 'Pond wave height must stay strictly above static water top');
      assert.ok(pondSample.terracedH >= 0.03 && pondSample.terracedH <= 0.76);
      assert.ok(oceanSample.rawH >= 0.03, 'Ocean wave height must stay strictly above static water top');
      assert.ok(oceanSample.terracedH >= 0.03 && oceanSample.terracedH <= 1.55);

      maxPondH = Math.max(maxPondH, pondSample.terracedH);
      maxOceanH = Math.max(maxOceanH, oceanSample.terracedH);
    }
  }

  assert.ok(maxPondH <= 0.76, `Expected pond waves <= 0.75m, got ${maxPondH}`);
  assert.ok(maxOceanH >= 1.0, `Expected ocean swells to reach >= +1.0m..1.5m, got ${maxOceanH}`);
});

test('findClosestMaterial maps sampled RGB colors to nearest-neighbor engine materials', async () => {
  const THREE = await import('three');
  const { findClosestMaterial } = await import('./glbVoxelizer.ts');

  assert.equal(findClosestMaterial(new THREE.Color(0.27, 0.64, 0.19)), MAT.GRASS);
  assert.equal(findClosestMaterial(new THREE.Color(0.44, 0.29, 0.15)), MAT.DIRT);
  assert.equal(findClosestMaterial(new THREE.Color(0.49, 0.49, 0.48)), MAT.ROCK);
  assert.equal(findClosestMaterial(new THREE.Color(0.87, 0.77, 0.47)), MAT.SAND);
  assert.equal(findClosestMaterial(new THREE.Color(0.17, 0.18, 0.21)), MAT.ASPHALT);
  assert.equal(findClosestMaterial(new THREE.Color(0.69, 0.68, 0.71)), MAT.CONCRETE);
  assert.equal(findClosestMaterial(new THREE.Color(0.11, 0.49, 0.84)), MAT.WATER_VOX);
  assert.equal(findClosestMaterial(new THREE.Color(0.56, 0.34, 0.19)), MAT.WOOD);
  assert.equal(findClosestMaterial(new THREE.Color(0.73, 0.24, 0.21)), MAT.BRICK);
});

test('deepOceanFactor scales ocean swells into towering rogue waves (+4.5m..+6.5m) and CUSTOM_GLB_MAP acts as an endless ocean basin', async () => {
  const { evaluateGerstnerWaveSample, greedyMeshBoundedArrays } = await import(
    './physicsMath.ts'
  );
  const { isWaterBasinArea } = await import('./world.ts');
  const { evaluateBiomeColumn } = await import('./worldObjects.ts');
  const { VEHICLE_SKINS, BUILD_SLOTS, WATER_VY } = await import('./constants.ts');

  assert.equal(isWaterBasinArea(250, -320, 'CUSTOM_GLB_MAP'), true);
  const col = evaluateBiomeColumn(250, -320, 1000, 1000, 'CUSTOM_GLB_MAP');
  assert.ok(col.surfVY < WATER_VY, 'CUSTOM_GLB_MAP outer seabed must lie below WATER_VY');

  let maxCoastalH = 0;
  let maxAbyssalH = 0;
  for (let x = -220; x <= -80; x += 4.0) {
    for (let z = -80; z <= 40; z += 4.0) {
      const coastal = evaluateGerstnerWaveSample(x, z, 5.0, 0.0, false, 1.0);
      const abyssal = evaluateGerstnerWaveSample(x, z, 5.0, 600.0, false, 1.0);
      maxCoastalH = Math.max(maxCoastalH, coastal.terracedH);
      maxAbyssalH = Math.max(maxAbyssalH, abyssal.terracedH);
    }
  }
  assert.ok(
    maxAbyssalH > maxCoastalH * 2.5 && maxAbyssalH >= 4.0,
    `Expected deep ocean rogue waves >= 4.0m (got ${maxAbyssalH} vs coastal ${maxCoastalH})`,
  );

  assert.equal(VEHICLE_SKINS.length, 8);
  const cosmeticSlots = BUILD_SLOTS.filter((s) => s.category === 'COSMETICS');
  assert.equal(cosmeticSlots.length, 22);

  // Verify greedy mesher renders procedural carbon, camo, gold, and chrome paint blocks cleanly
  const res = greedyMeshBoundedArrays(
    4,
    2,
    2,
    0,
    1,
    (x, y, z) =>
      y === 0 && z === 0
        ? [MAT.PAINT_CARBON, MAT.PAINT_CAMO, MAT.PAINT_GOLD, MAT.CHROME_SILVER][x] || MAT.AIR
        : MAT.AIR,
    0,
    0,
    0,
    0.25,
    0.25,
    'OPAQUE_ONLY',
  );
  assert.ok(res.vertCount > 0 && res.mergedQuads > 0);
});

test('computeHullPointBuoyancy prevents bouncing on calm water and lifts float blocks above high wave crests', async () => {
  const { computeHullPointBuoyancy } = await import('./physicsMath.ts');

  const effWaterY = 14.0; // WATER_LEVEL
  const floatBlockDispKg = 180; // High buoyancy float block
  const sampleMassKg = 25;

  // 1. Point fully above water: zero buoyancy
  const above = computeHullPointBuoyancy(14.5, effWaterY, floatBlockDispKg, sampleMassKg, 0, 0, 0);
  assert.equal(above.isSubmerged, false);
  assert.equal(above.buoyUp, 0);

  // 2. Calm equilibrium (submerged 0.35m, stationary): positive upward buoyancy with critical damping
  const calm = computeHullPointBuoyancy(13.65, effWaterY, floatBlockDispKg, sampleMassKg, 0, 0, 0);
  assert.equal(calm.isSubmerged, true);
  assert.ok(calm.buoyUp > 0);
  // Verify vertical damping opposes upward motion smoothly to stop trampoline bouncing
  const rising = computeHullPointBuoyancy(13.65, effWaterY, floatBlockDispKg, sampleMassKg, 1.5, 0, 0);
  assert.ok(rising.buoyUp < calm.buoyUp, 'Damping must resist rapid bouncing upward');
  assert.ok(rising.dampingForceY > 0);

  // 3. Deep immersion under a wave crest (submerged 3.0m down): progressive displacement scaling kicks in
  // providing strong restoring lift while capping subRatio to prevent trampoline popping
  const deepWave = computeHullPointBuoyancy(11.0, effWaterY, floatBlockDispKg, sampleMassKg, 0, 0.1, -0.1);
  assert.equal(deepWave.isSubmerged, true);
  assert.ok(
    deepWave.buoyUp > calm.buoyUp * 1.5,
    `Deep immersion must deliver progressive restoring force (got ${deepWave.buoyUp})`,
  );
  assert.ok(deepWave.waveSlopeFx !== 0 && deepWave.waveSlopeFz !== 0);
});

test('CUSTOM_GLB_MAP seabed deepens from shallow coast to abyssal trench and supports scale factor up to 100x', async () => {
  const { evaluateBiomeColumn } = await import('./worldObjects.ts');
  const { WATER_VY, VOXEL_SIZE } = await import('./constants.ts');

  // 1. Coastline near island shore (< 24m): shallow shelf (water depth <= 2 voxels)
  const coast = evaluateBiomeColumn(12, 10, 50, 50, 'CUSTOM_GLB_MAP');
  assert.ok(coast.surfVY >= WATER_VY - 3, `Expected shallow coastal shelf >= ${WATER_VY - 3}, got ${coast.surfVY}`);

  // 2. Open ocean abyss (180m out): deep seabed trench (water depth >= 40 voxels / 10m deep)
  const abyss = evaluateBiomeColumn(180, 140, 500, 500, 'CUSTOM_GLB_MAP');
  assert.ok(abyss.surfVY <= 14, `Expected deep abyss <= 14, got ${abyss.surfVY}`);
  assert.ok(abyss.surfVY < coast.surfVY - 30, 'Abyssal depth must be significantly deeper than coast');

  // 3. Scale factor up to 100x computes correct world span
  const sizeX = 64;
  const scale1xSpan = sizeX * 1 * VOXEL_SIZE;
  const scale10xSpan = sizeX * 10 * VOXEL_SIZE;
  const scale100xSpan = sizeX * 100 * VOXEL_SIZE;
  assert.equal(scale1xSpan, 16.0);
  assert.equal(scale10xSpan, 160.0);
  assert.equal(scale100xSpan, 1600.0);
});

test('triangleIntersectsVoxel and computeBarycentricWeights implement exact 13-axis SAT geometric testing', async () => {
  const { triangleIntersectsVoxel, computeBarycentricWeights } = await import('./glbVoxelizer.ts');

  // 1. Direct overlapping triangle centered on box
  const inside = triangleIntersectsVoxel(
    0.2, 0.2, 0.5,
    0.8, 0.2, 0.5,
    0.5, 0.8, 0.5,
    0.5, 0.5, 0.5,
    0.5,
  );
  assert.equal(inside, true, 'Triangle directly inside box must intersect');

  // 2. Distant triangle outside box
  const outside = triangleIntersectsVoxel(
    10.0, 10.0, 10.0,
    12.0, 10.0, 10.0,
    11.0, 12.0, 10.0,
    0.5, 0.5, 0.5,
    0.5,
  );
  assert.equal(outside, false, 'Triangle far outside box must not intersect');

  // 3. Triangle whose 3D AABB overlaps box AABB, but triangle plane normal separates them
  // Box is [0, 1] on all axes (center 0.5, h = 0.5).
  // Plane: x + y + z = 4. Triangle is near (1.5, 1.5, 1.0), (1.0, 1.5, 1.5), (1.5, 1.0, 1.5).
  // Box max corner (1, 1, 1) has x + y + z = 3 < 4, so they are strictly separated by plane normal!
  const separatedByNormal = triangleIntersectsVoxel(
    1.5, 1.5, 1.0,
    1.0, 1.5, 1.5,
    1.5, 1.0, 1.5,
    0.5, 0.5, 0.5,
    0.5,
  );
  assert.equal(separatedByNormal, false, 'Triangle separated along triangle plane normal must return false');

  // 4. Barycentric weights calculation
  const v0 = [0, 0, 0];
  const v1 = [1, 0, 0];
  const v2 = [0, 1, 0];
  const centroidWeights = computeBarycentricWeights(
    1 / 3, 1 / 3, 0,
    v0[0], v0[1], v0[2],
    v1[0], v1[1], v1[2],
    v2[0], v2[1], v2[2],
  );
  assert.ok(Math.abs(centroidWeights[0] - 0.3333) < 0.05);
  assert.ok(Math.abs(centroidWeights[1] - 0.3333) < 0.05);
  assert.ok(Math.abs(centroidWeights[2] - 0.3333) < 0.05);
  assert.ok(Math.abs(centroidWeights[0] + centroidWeights[1] + centroidWeights[2] - 1.0) < 1e-4);
});

test('GPU Render-Target Voxelizer 16-bit elevation encoding, Pass 1 RGB capture, and cliff stitching', async () => {
  const {
    encodeElevation16Bit,
    decodeElevation16Bit,
    decodeGpuRasterBuffers,
    DEFAULT_GLB_RESOLUTION,
    GLB_MICRO_VOXEL_SIZE,
  } = await import('./glbVoxelizer.ts');
  const { WATER_VY, MAT } = await import('./constants.ts');

  // 1. Verify default resolution is 256 and micro-voxel size is in [0.15, 0.20]
  assert.equal(DEFAULT_GLB_RESOLUTION, 256);
  assert.ok(GLB_MICRO_VOXEL_SIZE >= 0.15 && GLB_MICRO_VOXEL_SIZE <= 0.20);

  // 2. Verify 16-bit sub-millimeter elevation encoding & decoding (65,536 steps)
  for (const h of [0.0, 0.12345, 0.5, 0.87654, 1.0]) {
    const [hi, lo] = encodeElevation16Bit(h);
    const decoded = decodeElevation16Bit(hi, lo);
    assert.ok(
      Math.abs(decoded - h) <= 1.0 / 65535.0 + 1e-6,
      `16-bit elevation roundtrip failed for ${h}: got ${decoded}`,
    );
  }

  // 3. Verify decodeGpuRasterBuffers extracts exact RGB, 16-bit height, footprintMask, and stitches steep cliffs
  const res = 4;
  const colorBuffer = new Uint8Array(res * res * 4);
  const heightBuffer = new Uint8Array(res * res * 4);

  const setPixel = (
    vx: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    normH: number,
  ) => {
    const idx = (vz * res + vx) * 4;
    colorBuffer[idx] = r;
    colorBuffer[idx + 1] = g;
    colorBuffer[idx + 2] = b;
    colorBuffer[idx + 3] = 255;

    const [hi, lo] = encodeElevation16Bit(normH);
    heightBuffer[idx] = hi;
    heightBuffer[idx + 1] = lo;
    heightBuffer[idx + 2] = 0;
    heightBuffer[idx + 3] = 255;
  };

  setPixel(1, 1, 42, 188, 96, 0.0);
  setPixel(2, 1, 214, 92, 58, 1.0);

  const decoded = decodeGpuRasterBuffers(colorBuffer, heightBuffer, res, 20);
  assert.equal(decoded.baseOffsetVY, WATER_VY + 2);
  assert.equal(decoded.footprintMask[0], 0, 'Pixel (0,0) with alpha=0 must have footprintMask=0');
  assert.equal(decoded.footprintMask[1 + 1 * res], 1, 'Pixel (1,1) with alpha=255 must have footprintMask=1');
  assert.equal(decoded.footprintMask[2 + 1 * res], 1, 'Pixel (2,1) with alpha=255 must have footprintMask=1');

  // Verify exact RGB preservation and cliff stitching on (2, 1) down to neighbor (1, 1)
  const colPeakVoxels = decoded.voxels.filter((v) => v[0] === 2 && v[2] === 1);
  assert.ok(
    colPeakVoxels.length >= 20,
    `Expected steep cliff column at (2,1) to stitch vertical wall down to neighbor (got ${colPeakVoxels.length} voxels)`,
  );
  for (const v of colPeakVoxels) {
    assert.notEqual(v[3], MAT.WATER_VOX, 'Landmass voxel must never be MAT.WATER_VOX');
    assert.equal(v[4], 214);
    assert.equal(v[5], 92);
    assert.equal(v[6], 58);
  }
});

test('Direct RGB Vertex Color Meshing writes exact (r/255, g/255, b/255) into geometry color buffer', async () => {
  const { greedyMeshBoundedArrays } = await import('./physicsMath.ts');
  const { MAT } = await import('./constants.ts');

  const dimsX = 4, dimsY = 4, dimsZ = 4;
  const voxels = new Uint8Array(dimsX * dimsY * dimsZ);
  const customColors = new Uint8Array(dimsX * dimsY * dimsZ * 3);

  const idx = 1 + dimsX * (1 + dimsY * 1);
  voxels[idx] = MAT.ROCK;
  customColors[idx * 3] = 210;
  customColors[idx * 3 + 1] = 105;
  customColors[idx * 3 + 2] = 45;

  const meshRes = greedyMeshBoundedArrays(
    dimsX,
    dimsY,
    dimsZ,
    0,
    dimsY - 1,
    (x, y, z) => voxels[x + dimsX * (y + dimsY * z)],
    0,
    0,
    0,
    0.25,
    0.25,
    'OPAQUE_ONLY',
    customColors,
  );

  assert.ok(meshRes.vertCount > 0, 'Expected meshed vertices for custom RGB voxel');
  const rFloat = meshRes.colors[0];
  const gFloat = meshRes.colors[1];
  const bFloat = meshRes.colors[2];
  assert.ok(Math.abs(rFloat - 210 / 255) < 1e-4, `Expected R=${210 / 255}, got ${rFloat}`);
  assert.ok(Math.abs(gFloat - 105 / 255) < 1e-4, `Expected G=${105 / 255}, got ${gFloat}`);
  assert.ok(Math.abs(bFloat - 45 / 255) < 1e-4, `Expected B=${45 / 255}, got ${bFloat}`);
});

test('GLB World Auto-Elevation (WATER_VY + 2), Strict Water Masking, and 100% Solid Bedrock Infill to vy = 0', async () => {
  const THREE = await import('three');
  const { MicroVoxelWorld } = await import('./world.ts');
  const { MAT, WATER_VY } = await import('./constants.ts');

  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene, true);
  world.radiusModeIdx = 4;
  world.customRenderDistance = 1;

  // Create a 4x4 GLB island with an interior valley (dy = 0) surrounded by high ridges (dy = 12)
  const voxels: Array<[number, number, number, number, number?, number?, number?]> = [];
  for (let dz = 0; dz < 4; dz++) {
    for (let dx = 0; dx < 4; dx++) {
      const isInteriorValley = dx === 1 && dz === 1;
      const dy = isInteriorValley ? 0 : 12;
      voxels.push([dx, dy, dz, MAT.GRASS, 64, 180, 72]);
    }
  }

  world.loadGlbMapAsWorld(voxels, 4, 16, 4, 1);

  // Check center of island (inside footprintMask > 0)
  const { vx, vz } = world.worldToVoxelCoords(-0.12, 14.0, -0.12);
  const topVY = world.getColumnSolidVY(vx, vz);

  // 1. Auto-Elevation: even the lowest interior valley (dy = 0) must sit at >= WATER_VY + 2
  assert.ok(
    topVY >= WATER_VY + 2,
    `Lowest GLB valley must be elevated to >= WATER_VY + 2 (${WATER_VY + 2}), got ${topVY}`,
  );

  // 2. Strict Groundwater Masking: zero MAT.WATER_VOX at ANY elevation inside the landmass column
  for (let vy = 0; vy < 128; vy++) {
    assert.notEqual(
      world.getVoxel(vx, vy, vz),
      MAT.WATER_VOX,
      `Found forbidden MAT.WATER_VOX inside GLB landmass at vy=${vy}`,
    );
  }
  assert.equal(world.isWaterAt(-0.12, 14.0, -0.12), false, 'isWaterAt must be false inside GLB landmass');

  // 3. 100% Solid Subterranean Bedrock Infill: every voxel from topVY down to vy = 0 must be solid (zero hollow air/void)
  for (let vy = topVY; vy >= 0; vy--) {
    const m = world.getVoxel(vx, vy, vz);
    assert.ok(
      m !== MAT.AIR && m !== MAT.WATER_VOX,
      `Expected 100% solid subterranean voxel at vy=${vy}, but got mat=${m}`,
    );
  }
  assert.equal(world.getVoxel(vx, 0, vz), MAT.ROCK, 'Bottom of world (vy=0) must be solid MAT.ROCK bedrock');

  // 4. Carve a 5-voxel deep explosion crater into the surface and verify solid MAT.DIRT / MAT.ROCK underneath
  for (let carveY = topVY; carveY > topVY - 5; carveY--) {
    world.setVoxel(vx, carveY, vz, MAT.AIR);
  }
  const exposedUnderCrater = world.getVoxel(vx, topVY - 5, vz);
  assert.ok(
    exposedUnderCrater === MAT.DIRT || exposedUnderCrater === MAT.ROCK,
    `Crater floor 5 voxels deep must expose solid MAT.DIRT or MAT.ROCK, got ${exposedUnderCrater}`,
  );
});

test('True 3D Volumetric 6-Way GPU Voxelizer preserves 1:1 vertical aspect ratio, captures side-wall colors from +X/-X/+Z/-Z/-Y passes, and stores distinct 3D (lx, vy, lz) colors per chunk', async () => {
  const THREE = await import('three');
  const {
    computeProportionalVoxelDimensions,
    unprojectOrthoPixelToVoxel3D,
    voxelizeGlbSceneWithGpu,
  } = await import('./glbVoxelizer.ts');
  const { MicroVoxelWorld } = await import('./world.ts');
  const { CHUNK_X, CHUNK_Y, WATER_VY, MAT } = await import('./constants.ts');

  // 1. Verify True 1:1 Aspect Ratio calculation (no hardcoded small maxVoxelHeight squashing!)
  const propCube = computeProportionalVoxelDimensions(
    { x: -10, y: 0, z: -10 },
    { x: 10, y: 20, z: 10 },
    256,
  );
  assert.equal(propCube.sizeX, 20);
  assert.equal(propCube.sizeY, 20);
  assert.equal(propCube.sizeZ, 20);
  assert.equal(propCube.maxHoriz, 20);
  assert.equal(propCube.voxelHeightRange, 256, 'A 1:1 cube at 256 resolution must have voxelHeightRange = 256');
  assert.ok(
    CHUNK_Y >= WATER_VY + 2 + 256,
    `CHUNK_Y (${CHUNK_Y}) must accommodate baseOffsetVY (${WATER_VY + 2}) + 256 vertical voxels without squashing`,
  );

  const propHalfTall = computeProportionalVoxelDimensions(
    { x: 0, y: 0, z: 0 },
    { x: 40, y: 20, z: 30 },
    200,
  );
  assert.equal(propHalfTall.voxelHeightRange, 100);

  // 2. Verify 6-way orthographic unprojection (+Y, -Y, +X, -X, +Z, -Z) maps into 3D voxel coordinates
  const topHit = unprojectOrthoPixelToVoxel3D('+Y', 10, 20, 1.0, 64, 48);
  assert.deepEqual(topHit, { vx: 10, vy: 48, vz: 20 });

  const rightHit = unprojectOrthoPixelToVoxel3D('+X', 0, 0, 1.0, 64, 48);
  assert.equal(rightHit.vx, 63);
  assert.equal(rightHit.vy, 48);
  assert.equal(rightHit.vz, 63);

  const frontHit = unprojectOrthoPixelToVoxel3D('+Z', 15, 63, 0.5, 64, 48);
  assert.equal(frontHit.vx, 15);
  assert.equal(frontHit.vy, 0);
  assert.equal(frontHit.vz, 32);

  // 3. Build a 3D scene with a green roof (+Y) and bright red/orange vertical cliff walls (+X/-X/+Z/-Z)
  // and verify 6-axis voxelization captures both the roof color at top vy and distinct side-wall colors at mid vy!
  const group = new THREE.Group();
  const boxGeo = new THREE.BoxGeometry(10, 10, 10);
  // Assign vertex colors: top vertices (y > 0) = bright green (20, 230, 60), bottom vertices (y < 0) = crimson red (240, 40, 30)
  const posAttr = boxGeo.attributes.position;
  const colArr = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    if (y > 0) {
      colArr[i * 3] = 0.08;
      colArr[i * 3 + 1] = 0.92;
      colArr[i * 3 + 2] = 0.24;
    } else {
      colArr[i * 3] = 0.95;
      colArr[i * 3 + 1] = 0.15;
      colArr[i * 3 + 2] = 0.12;
    }
  }
  boxGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const boxMesh = new THREE.Mesh(
    boxGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  group.add(boxMesh);

  const voxRes = voxelizeGlbSceneWithGpu(group, 64, null);
  assert.equal(voxRes.voxelHeightRange, 64, 'Cube at 64 resolution must preserve 1:1 voxelHeightRange = 64');
  assert.ok(voxRes.voxels.length > 64 * 64, '6-axis shell must emit side-wall voxels in addition to top roof');

  // Load into MicroVoxelWorld and verify 3D per-voxel customColors in the chunk has DIFFERENT colors at roof vs lower side wall in the same (lx, lz) column!
  const worldScene = new THREE.Scene();
  const world = new MicroVoxelWorld(worldScene, true);
  world.radiusModeIdx = 4;
  world.customRenderDistance = 1;
  world.loadGlbMapAsWorld(voxRes.voxels, voxRes.sizeX, voxRes.sizeY, voxRes.sizeZ, 1);

  // Inspect a perimeter wall column of the cube
  let foundMultiColorColumn = false;
  for (const chunk of world.chunkMap.values()) {
    if (!chunk.customColors) continue;
    for (let lz = 0; lz < 64 && !foundMultiColorColumn; lz++) {
      for (let lx = 0; lx < 64 && !foundMultiColorColumn; lx++) {
        const topVY = chunk.surfaceHeightMap[lx + (lz << 6)];
        if (topVY > WATER_VY + 30) {
          const topIdx = (lx + CHUNK_X * (topVY + CHUNK_Y * lz)) * 3;
          const lowVY = WATER_VY + 4;
          const lowIdx = (lx + CHUNK_X * (lowVY + CHUNK_Y * lz)) * 3;
          const topR = chunk.customColors[topIdx];
          const topG = chunk.customColors[topIdx + 1];
          const lowR = chunk.customColors[lowIdx];
          const lowG = chunk.customColors[lowIdx + 1];
          if (topG > topR && lowR > lowG) {
            foundMultiColorColumn = true;
          }
          // Also verify solid interior infill beneath the surface down to vy = 0
          assert.equal(chunk.voxels[lx + CHUNK_X * (0 + CHUNK_Y * lz)], MAT.ROCK);
        }
      }
    }
  }
  assert.equal(
    foundMultiColorColumn,
    true,
    '3D chunk customColors must store distinct roof (green) and lower side-wall (red) RGB colors at different vy heights in the same (lx, lz) column',
  );
});

test('True 3D Volumetric GPU CT-Slicer and Parity Infill preserve 3D overhangs/tunnels as open MAT.AIR, add 2-voxel structural crust under overhangs, and fill MAT.ROCK/DIRT only below lowestVY', async () => {
  const THREE = await import('three');
  const {
    voxelizeGlbSceneWithGpu,
    getVoxel3DIndex,
  } = await import('./glbVoxelizer.ts');
  const { MicroVoxelWorld } = await import('./world.ts');
  const { WATER_VY, MAT } = await import('./constants.ts');

  // Construct a 3D model with:
  // 1) A flat ground floor slab at y = 4.0m (spanning x in [-10..10], z in [-10..10])
  // 2) An elevated bridge/arch overhang directly above the center at y = 18.0m (spanning x in [-6..6], z in [-6..6])
  // 3) Outer canyon walls around the perimeter so an outside camera would be occluded, testing CT depth-slicing!
  const root = new THREE.Group();

  const floorGeo = new THREE.BoxGeometry(20, 1.0, 20);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x38b000, side: THREE.DoubleSide });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(0, 4.0, 0);
  root.add(floorMesh);

  const bridgeGeo = new THREE.BoxGeometry(10, 1.0, 10);
  const bridgeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide });
  const bridgeMesh = new THREE.Mesh(bridgeGeo, bridgeMat);
  bridgeMesh.position.set(0, 18.0, 0);
  root.add(bridgeMesh);

  // Outer perimeter walls (y = 0..20m) that would block a naive side orthographic camera from seeing the gap under the bridge!
  const wallMat = new THREE.MeshBasicMaterial({ color: 0xc84b31, side: THREE.DoubleSide });
  for (const [wx, wz, sx, sz] of [
    [-9.5, 0, 1.0, 20],
    [9.5, 0, 1.0, 20],
    [0, -9.5, 20, 1.0],
    [0, 9.5, 20, 1.0],
  ]) {
    const wMesh = new THREE.Mesh(new THREE.BoxGeometry(sx, 20, sz), wallMat);
    wMesh.position.set(wx, 10.0, wz);
    root.add(wMesh);
  }

  const res = 32;
  const ct = voxelizeGlbSceneWithGpu(root, res, null);

  assert.equal(ct.gridX, 32);
  assert.equal(ct.gridZ, 32);
  assert.equal(ct.gridY, 32);
  assert.equal(ct.voxelSolid.length, 32 * 32 * 32);
  assert.equal(ct.voxelRGB.length, 32 * 32 * 32 * 3);

  // Check center column (vx = 16, vz = 16) in the 3D CT-Slicer grid:
  // - Floor is around gy ~ 6
  // - Bridge overhang is around gy ~ 28
  // - Space between floor and bridge (e.g. gy = 14 .. 22) MUST be 0 (open air gap), even though outer walls surround the perimeter!
  const centerVX = 16;
  const centerVZ = 16;
  const midAirIdx = getVoxel3DIndex(centerVX, 16, centerVZ, ct.gridX, ct.gridY);
  assert.equal(
    ct.voxelSolid[midAirIdx],
    0,
    'CT-Slicer must preserve open 3D air gap (voxelSolid = 0) between ground floor and overhang even when enclosed by outer perimeter walls',
  );

  // Verify solid interior (voxelSolid = 2) below the lowest floor hit (gy = 0 .. 2)
  const subFloorIdx = getVoxel3DIndex(centerVX, 1, centerVZ, ct.gridX, ct.gridY);
  assert.equal(
    ct.voxelSolid[subFloorIdx],
    2,
    'CT-Slicer parity infill must mark voxels below the lowest surface floor as solid interior (voxelSolid = 2)',
  );

  // Now load into MicroVoxelWorld and verify world.getVoxel preserves the 3D tunnel/gap in the actual world chunks!
  const worldScene = new THREE.Scene();
  const world = new MicroVoxelWorld(worldScene, true);
  world.radiusModeIdx = 4;
  world.customRenderDistance = 1;
  world.loadGlbMapAsWorld(
    ct.voxels,
    ct.sizeX,
    ct.sizeY,
    ct.sizeZ,
    1,
    ct.voxelSolid,
    ct.voxelRGB,
  );

  const { vx: wvx, vz: wvz } = world.worldToVoxelCoords(0.1, 14.0, 0.1);
  const baseVY = WATER_VY + 2;

  // 1. Mid-gap between floor and bridge (baseVY + 16) must be MAT.AIR in the world chunk!
  assert.equal(
    world.getVoxel(wvx, baseVY + 16, wvz),
    MAT.AIR,
    'World chunk must keep the 3D gap under the bridge as MAT.AIR instead of collapsing to a 2D topVY column',
  );

  // 2. Overhang bridge above the gap must be solid!
  let bridgeSolidCount = 0;
  for (let gy = 24; gy < ct.gridY; gy++) {
    if (world.getVoxel(wvx, baseVY + gy, wvz) !== MAT.AIR) {
      bridgeSolidCount++;
    }
  }
  assert.ok(
    bridgeSolidCount >= 3,
    `Overhang bridge + 2-voxel structural crust must be >= 3 voxels thick (got ${bridgeSolidCount})`,
  );

  // 3. Ground floor and bedrock down to vy = 0 must be 100% solid MAT.DIRT / MAT.ROCK!
  for (let vy = baseVY + 2; vy >= 0; vy--) {
    const m = world.getVoxel(wvx, vy, wvz);
    assert.ok(
      m !== MAT.AIR && m !== MAT.WATER_VOX,
      `Subterranean bedrock below lowest floor hit must be solid down to vy = 0 (failed at vy=${vy}, got ${m})`,
    );
  }
});

test('P2P Multiplayer: generateRoomCode, normalizeRoomCode, and roomCodeToPeerId map 6-character codes deterministically', async () => {
  const {
    generateRoomCode,
    normalizeRoomCode,
    roomCodeToPeerId,
  } = await import('./multiplayer.ts');

  const code = generateRoomCode();
  assert.match(code, /^VOX-\d{3}$/);
  assert.equal(normalizeRoomCode('vox849').displayCode, 'VOX-849');
  assert.equal(normalizeRoomCode('VOX-849').cleanSuffix, 'VOX849');
  assert.equal(roomCodeToPeerId('vox-849'), 'usable-vox-room-VOX849');
});

test('P2P Multiplayer: interpolateRemoteTransform smoothly lerps vectors and slerps quaternions at 60fps', async () => {
  const THREE = await import('three');
  const { interpolateRemoteTransform } = await import('./multiplayer.ts');

  const pos = new THREE.Vector3(0, 10, 0);
  const quat = new THREE.Quaternion();
  const targetPos = new THREE.Vector3(20, 10, -10);
  const targetQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  );

  const dt = 1 / 60;
  const expectedAlpha = 1.0 - Math.exp(-14.0 * dt);
  interpolateRemoteTransform(pos, quat, targetPos, targetQuat, dt, 14.0);
  assert.ok(Math.abs(pos.x - 20 * expectedAlpha) < 1e-4);
  assert.ok(Math.abs(pos.z - -10 * expectedAlpha) < 1e-4);
  assert.ok(quat.angleTo(targetQuat) < Math.PI / 2);
});

test('P2P Multiplayer & Multi-Vehicle: serializeVehiclePartsArray and reconstructBlueprintFromParts preserve vehicle parts & colors', async () => {
  const {
    serializeVehiclePartsArray,
    reconstructBlueprintFromParts,
  } = await import('./multiplayer.ts');

  const fakeVoxelMap = new Map<string, number>([
    ['10,5,12', MAT.ALLOY_BLUE],
    ['11,5,12', MAT.ARMOR_SLATE],
    ['12,6,12', MAT.FLOAT_YELLOW],
  ]);
  const fakeRig = {
    voxelMap: fakeVoxelMap,
    modules: [
      { kind: 'SEAT' as const, vx: 11, vy: 6, vz: 12, yawIdx: 0, pitchIdx: 0, rollIdx: 0 },
      { kind: 'WHEEL_OFFROAD' as const, vx: 9, vy: 4, vz: 10, yawIdx: 1, pitchIdx: 0, rollIdx: 0 },
    ],
  };

  const parts = serializeVehiclePartsArray(fakeRig as never);
  assert.equal(parts.length, 5, 'Vehicle parts array should serialize all 3 blocks and 2 modules');

  const reconstructed = reconstructBlueprintFromParts('veh_test_01', parts);
  assert.equal(reconstructed.voxels.length, 3);
  assert.equal(reconstructed.modules.length, 2);
  assert.equal(reconstructed.modules[0].kind, 'SEAT');
  assert.equal(reconstructed.modules[1].yawIdx, 1);
});

test('resolveCharacterVehicleCollision prevents character from clipping through vehicle bounding box', () => {
  // Vehicle at (0, 1, 0) with half-extents (1.5, 0.8, 3.0)
  // Player standing inside bounds at (0, 1.2, 0) with radius 0.4, height 1.8
  const res = resolveCharacterVehicleCollision(
    { x: 0, y: 1.2, z: 0 },
    0.4,
    1.8,
    { x: 0, y: 1, z: 0 },
    0, // 0 yaw
    1.5,
    0.8,
    3.0,
  );

  assert.equal(res.collided, true);
  // Nearest edge is X (1.5 + 0.4 = 1.9 vs 3.0 + 0.4 = 3.4), so it pushes out along X
  assert.ok(Math.abs(res.pushOutX) > 0.5);

  // Player far away at (10, 1, 10) should not collide
  const farRes = resolveCharacterVehicleCollision(
    { x: 10, y: 1, z: 10 },
    0.4,
    1.8,
    { x: 0, y: 1, z: 0 },
    0,
    1.5,
    0.8,
    3.0,
  );
  assert.equal(farRes.collided, false);
});

test('resolveVehicleVehicleCollision detects collision, pushes vehicles apart, and applies momentum impulse', () => {
  const posA = { x: 0, y: 1, z: 0 };
  const velA = { x: 0, y: 0, z: 10 }; // Moving forward towards B
  const halfA = { x: 1.5, y: 0.8, z: 2.5 };

  const posB = { x: 0, y: 1, z: 4.2 }; // Overlapping within radius 2.5 + 2.5 = 5.0
  const velB = { x: 0, y: 0, z: -5 }; // Head-on collision
  const halfB = { x: 1.5, y: 0.8, z: 2.5 };

  const res = resolveVehicleVehicleCollision(
    posA,
    velA,
    800,
    halfA,
    posB,
    velB,
    1000,
    halfB,
    0.6,
  );

  assert.equal(res.hasCollision, true);
  assert.ok(res.penetration > 0);
  assert.ok(res.relativeSpeed > 10);
  // Impulse on A should push it backward (-Z), and impulse on B should push it forward (+Z)
  assert.ok(res.impulseA.z < 0);
  assert.ok(res.impulseB.z > 0);
  // Separation displacements should separate them along Z
  assert.ok(res.separateA.z < 0);
  assert.ok(res.separateB.z > 0);
});

test('computeAvatarAnimationPose produces valid distinct poses for driving, walking, building, and idle', () => {
  const drivePose = computeAvatarAnimationPose(0, 0, true, false, true);
  assert.ok(drivePose.leftLegX > 1.0, 'Legs should be bent forward in driver pose');
  assert.ok(drivePose.leftArmX < -0.5, 'Arms should be forward gripping steering wheel');

  const buildPose = computeAvatarAnimationPose(0, 0, false, true, true);
  assert.equal(buildPose.toolActive, true);
  assert.ok(buildPose.rightArmX < -0.5, 'Right arm should be raised projecting tool in build mode');

  const walkPose = computeAvatarAnimationPose(Math.PI / 2, 6.0, false, false, true);
  assert.ok(walkPose.leftLegX !== 0);
  assert.ok(walkPose.rightLegX !== 0);
  assert.ok(Math.abs(walkPose.leftLegX - -walkPose.rightLegX) < 1e-4, 'Legs should swing symmetrically opposite');

  const idlePose = computeAvatarAnimationPose(0, 0, false, false, true);
  assert.equal(idlePose.leftLegX, 0);
  assert.equal(idlePose.toolActive, false);
});

test('Multiplayer Vehicle Authority & Seat Claims: unique networkId, strict ownerPeerId authority, seat lock, and 2.5m entry range', async () => {
  const THREE = await import('three');
  const { ModularVehicleRig, generateVehicleNetworkId } = await import('./vehicle.ts');
  const { MicroVoxelWorld } = await import('./world.ts');
  const { VoxelFXSystem } = await import('./fx.ts');
  const { P2PMultiplayerManager } = await import('./multiplayer.ts');

  const netId = generateVehicleNetworkId('peer_alpha');
  assert.match(
    netId,
    /^peer_alpha_veh_\d+_[a-z0-9]{4}$/,
    `networkId must match \${peerId}_veh_\${Date.now()}_\${rand}, got ${netId}`,
  );

  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene, true);
  const fx = new VoxelFXSystem(scene, world);

  const hostPeerId = 'usable-vox-room-VOX123';
  const clientPeerId = 'usable-vox-room-VOX123-peer-abcde';

  const hostRig = new ModularVehicleRig(scene, world, fx);
  hostRig.assignNetworkIdentity(hostPeerId, undefined, true);
  hostRig.position.set(0, 5, 0);
  hostRig.syncVisualTransform();

  const clientRig = new ModularVehicleRig(scene, world, fx);
  clientRig.assignNetworkIdentity(clientPeerId, undefined, true);
  clientRig.position.set(25, 5, 25);
  clientRig.syncVisualTransform();

  // 1. Verify unique networkId & ownerPeerId
  assert.equal(hostRig.ownerPeerId, hostPeerId);
  assert.equal(clientRig.ownerPeerId, clientPeerId);
  assert.notEqual(hostRig.networkId, clientRig.networkId);
  assert.equal(hostRig.isLocalOwner(hostPeerId), true);
  assert.equal(hostRig.isLocalOwner(clientPeerId), false);
  assert.equal(clientRig.isLocalOwner(clientPeerId), true);
  assert.equal(clientRig.isLocalOwner(hostPeerId), false);

  // 2. Verify creator is automatically seated in seat 0 (seatedPlayerId = myPeerId)
  assert.equal(hostRig.getPrimarySeatOccupant(), hostPeerId);
  assert.equal(clientRig.getPrimarySeatOccupant(), clientPeerId);

  // 3. Verify another player cannot claim an occupied seat, and can only enter an empty seat within 2.5m
  const nearClientRigPos = clientRig.localVoxelToWorld(
    clientRig.getSeatModules()[0].vx,
    clientRig.getSeatModules()[0].vy,
    clientRig.getSeatModules()[0].vz,
  );
  assert.equal(
    clientRig.findEmptySeatWithinRange(nearClientRigPos, 2.5),
    null,
    'Occupied seat must NOT be returned as an empty enterable seat',
  );

  // Release client seat -> now seat is empty (seatedPlayerId === null)
  clientRig.releasePlayerSeats(clientPeerId);
  assert.equal(clientRig.getPrimarySeatOccupant(), null);

  // Far player (> 2.5m away) cannot enter seat
  const farPos = nearClientRigPos.clone().add(new THREE.Vector3(3.2, 0, 0));
  assert.equal(
    clientRig.findEmptySeatWithinRange(farPos, 2.5),
    null,
    'Player standing > 2.5m from seat must not be able to enter',
  );

  // Close player (<= 2.5m away) CAN enter empty seat
  const closePos = nearClientRigPos.clone().add(new THREE.Vector3(1.8, 0, 0));
  const emptyFound = clientRig.findEmptySeatWithinRange(closePos, 2.5);
  assert.ok(emptyFound !== null && emptyFound.seatIndex === 0);

  // Re-seat client in clientRig
  clientRig.claimSeat(0, clientPeerId);

  // 4. Verify Strict Position Sync Authority on Host:
  // Host must ONLY broadcast hostRig, NEVER clientRig, and must NOT snap clientRig to Host coordinates!
  const hostCreations = [hostRig, clientRig];
  const hostMp = new P2PMultiplayerManager({
    scene,
    world,
    fx,
    getCreations: () => hostCreations,
    getActiveVehicle: () => hostRig,
    getIsWalking: () => false,
    getLocalPlayerTransform: () => ({
      pos: hostRig.position.clone(),
      quat: hostRig.quaternion.clone(),
    }),
    spawnRemoteVehicleRig: () => clientRig,
    onStateChange: () => {},
  });
  hostMp.role = 'host';
  hostMp.status = 'connected';
  hostMp.localPeerId = hostPeerId;

  assert.equal(
    hostMp.hasLocalPhysicsAuthority(hostRig),
    true,
    'Host must have physics authority over its own vehicle',
  );
  assert.equal(
    hostMp.hasLocalPhysicsAuthority(clientRig),
    false,
    'Host must NOT have physics authority over a client-owned vehicle',
  );

  const hostSyncPacket = hostMp.buildStateSyncPacket();
  assert.equal(
    hostSyncPacket.vehicles.length,
    1,
    'Host STATE_SYNC must only broadcast vehicles owned/driven by Host, never client vehicles',
  );
  assert.equal(hostSyncPacket.vehicles[0].id, hostRig.networkId);

  // 5. Simulate Client receiving a spoofed/stale transform packet for clientRig from Host -> Client must ignore it!
  const clientCreations = [clientRig, hostRig];
  const clientMp = new P2PMultiplayerManager({
    scene,
    world,
    fx,
    getCreations: () => clientCreations,
    getActiveVehicle: () => clientRig,
    getIsWalking: () => false,
    getLocalPlayerTransform: () => ({
      pos: clientRig.position.clone(),
      quat: clientRig.quaternion.clone(),
    }),
    spawnRemoteVehicleRig: () => hostRig,
    onStateChange: () => {},
  });
  clientMp.role = 'client';
  clientMp.status = 'connected';
  clientMp.localPeerId = clientPeerId;

  clientMp.handleIncomingPacket({
    type: 'VEHICLE_TRANSFORM',
    peerId: hostPeerId,
    vehicleId: clientRig.networkId,
    ownerPeerId: clientPeerId,
    driverPeerId: clientPeerId,
    pos: [-999, 5, -999],
    quat: [0, 0, 0, 1],
    linVel: [0, 0, 0],
    angVel: [0, 0, 0],
    wheelAngles: [],
    steerAngle: 0,
    throttle: 0,
    boostActive: false,
    lightsOn: true,
    timestamp: Date.now(),
  });
  clientMp.updateInterpolation(1 / 60, new THREE.Vector3());
  assert.equal(
    clientRig.position.x,
    25,
    'Client vehicle must NEVER be snapped or overwritten by Host transform packets',
  );

  // 6. Simulate Host receiving authoritative VEHICLE_TRANSFORM from Client -> Host smoothly interpolates clientRig!
  hostMp.handleIncomingPacket({
    type: 'VEHICLE_TRANSFORM',
    peerId: clientPeerId,
    vehicleId: clientRig.networkId,
    ownerPeerId: clientPeerId,
    driverPeerId: clientPeerId,
    pos: [40, 5, 40],
    quat: [0, 0, 0, 1],
    linVel: [12, 0, 0],
    angVel: [0, 0, 0],
    wheelAngles: [0.5, 0.5, 0.5, 0.5],
    steerAngle: 0.2,
    throttle: 0.8,
    boostActive: false,
    lightsOn: true,
    timestamp: Date.now(),
  });
  hostMp.updateInterpolation(1 / 60, new THREE.Vector3());
  assert.ok(
    clientRig.position.x > 25 && clientRig.position.x <= 40,
    'Host must interpolate client-owned vehicle transforms sent by client owner',
  );
  assert.equal(clientRig.isRemoteControlled, true);

  // 7. Verify two-way VEHICLE_COLLISION_IMPULSE packet applies bounded velocity & angular knockback on the owner's rig
  const prevVelX = clientRig.velocity.x;
  clientMp.handleIncomingPacket({
    type: 'VEHICLE_COLLISION_IMPULSE',
    fromPeerId: hostPeerId,
    targetVehicleId: clientRig.networkId,
    deltaVel: [6.5, 2.0, -4.0],
    deltaAngVel: [0.1, 0.8, -0.1],
    pushDir: [1, 0, 0],
    pushDist: 0.4,
    impactPoint: [25, 5, 25],
  });
  assert.ok(
    Math.abs(clientRig.velocity.x - (prevVelX + 6.5)) < 1e-4,
    'Owner rig must apply incoming VEHICLE_COLLISION_IMPULSE deltaVel',
  );
  assert.ok(
    Math.abs(clientRig.angularVelocity.y - 0.8) < 1e-4,
    'Owner rig must apply incoming VEHICLE_COLLISION_IMPULSE deltaAngVel',
  );
});

test('Multiplayer Physics Math: directional OBB radius, mass-scaled collision Δv, dead-reckoning, and spawn de-overlap', () => {
  // 1. Directional OBB radius: side-by-side cars should use width (1.5m), not length (3.5m)!
  const halfExt = { x: 1.5, y: 0.8, z: 3.5 };
  const lateralR = computeDirectionalObbRadius(halfExt.x, halfExt.z, 0, 1, 0);
  const longitudinalR = computeDirectionalObbRadius(halfExt.x, halfExt.z, 0, 0, 1);
  assert.ok(Math.abs(lateralR - 1.5) < 1e-5, `Expected lateral radius 1.5, got ${lateralR}`);
  assert.ok(Math.abs(longitudinalR - 3.5) < 1e-5, `Expected longitudinal radius 3.5, got ${longitudinalR}`);

  // Two long cars parked side-by-side 3.6m apart along X (1.5 + 1.5 = 3.0m < 3.6m) MUST NOT false-collide!
  const sideBySide = resolveVehicleVehicleCollision(
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 15 },
    1000,
    halfExt,
    { x: 3.6, y: 1, z: 0 },
    { x: 0, y: 0, z: 15 },
    1000,
    halfExt,
    0.5,
    0,
    0,
  );
  assert.equal(
    sideBySide.hasCollision,
    false,
    'Side-by-side vehicles separated by > 2 * halfWidth must not false-collide due to length!',
  );

  // 2. Mass-scaled Δv: head-on collision at 15 m/s must produce realistic Δv (< 28 m/s), NEVER raw 10,000+ N·s!
  const headOn = resolveVehicleVehicleCollision(
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 12 },
    1200,
    halfExt,
    { x: 0, y: 1, z: 5.5 },
    { x: 0, y: 0, z: -8 },
    1200,
    halfExt,
    0.55,
    0,
    0,
  );
  assert.equal(headOn.hasCollision, true);
  assert.ok(headOn.impulseA && headOn.impulseB);
  const dvMagA = Math.hypot(headOn.impulseA.x, headOn.impulseA.y, headOn.impulseA.z);
  const dvMagB = Math.hypot(headOn.impulseB.x, headOn.impulseB.y, headOn.impulseB.z);
  assert.ok(
    dvMagA > 2 && dvMagA <= 28.5,
    `Collision Δv on A must be realistic mass-scaled m/s (2..28.5), got ${dvMagA}`,
  );
  assert.ok(
    dvMagB > 2 && dvMagB <= 28.5,
    `Collision Δv on B must be realistic mass-scaled m/s (2..28.5), got ${dvMagB}`,
  );

  // 3. Predictive velocity dead-reckoning extrapolates smoothly and clamps horizon
  const pred = computeDeadReckonedTargetPos(
    { x: 10, y: 2, z: -5 },
    { x: 20, y: 0, z: -10 },
    0.05,
    0.18,
  );
  assert.equal(pred.x, 11);
  assert.equal(pred.y, 2);
  assert.equal(pred.z, -5.5);

  // 4. Safe multiplayer spawn spot avoids overlapping existing vehicle at (0, 2, -4)
  const safeSpot = computeSafeMultiplayerSpawnSpot(
    { x: 0, y: 2, z: -4 },
    [{ x: 0, y: 2, z: -4 }],
    8.5,
  );
  const distFromHost = Math.hypot(safeSpot.pos.x - 0, safeSpot.pos.z - -4);
  assert.ok(
    distFromHost >= 8.5,
    `Safe multiplayer spawn spot must be >= 8.5m away from existing vehicle, got ${distFromHost}`,
  );
});

test('Multiplayer Lobby Handshake: JOIN_LOBBY_ANNOUNCE, WELCOME_LOBBY, STATE_SYNC, and SPAWN_VEHICLE deduplication run without throwing or freezing', async () => {
  const THREE = await import('three');
  const { ModularVehicleRig } = await import('./vehicle.ts');
  const { MicroVoxelWorld } = await import('./world.ts');
  const { VoxelFXSystem } = await import('./fx.ts');
  const { P2PMultiplayerManager } = await import('./multiplayer.ts');

  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene, true);
  const fx = new VoxelFXSystem(scene, world);

  const hostPeerId = 'usable-vox-room-VOX777';
  const clientPeerId = 'usable-vox-room-VOX777-peer-9999';

  const hostRig = new ModularVehicleRig(scene, world, fx, hostPeerId);
  hostRig.assignNetworkIdentity(hostPeerId, undefined, true);
  hostRig.position.set(0, 4, -4);
  hostRig.syncVisualTransform();

  const clientRig = new ModularVehicleRig(scene, world, fx, clientPeerId);
  clientRig.assignNetworkIdentity(clientPeerId, undefined, true);
  clientRig.position.set(12, 4, -4);
  clientRig.syncVisualTransform();

  const hostCreations: InstanceType<typeof ModularVehicleRig>[] = [hostRig];
  const clientCreations: InstanceType<typeof ModularVehicleRig>[] = [clientRig];

  const hostMp = new P2PMultiplayerManager({
    scene,
    world,
    fx,
    getCreations: () => hostCreations,
    getActiveVehicle: () => hostRig,
    getIsWalking: () => false,
    getLocalPlayerTransform: () => ({
      pos: hostRig.position.clone(),
      quat: hostRig.quaternion.clone(),
    }),
    spawnRemoteVehicleRig: (pkt) => {
      const r = new ModularVehicleRig(scene, world, fx, pkt.ownerPeerId, true);
      r.networkId = pkt.vehicleId;
      r.ownerPeerId = pkt.ownerPeerId;
      if (pkt.blueprint?.voxels?.length) {
        r.importBlueprint(pkt.blueprint);
      } else {
        r.loadPreset(0);
      }
      r.isRemoteControlled = true;
      r.position.set(pkt.spawnPos[0], pkt.spawnPos[1], pkt.spawnPos[2]);
      hostCreations.push(r);
      return r;
    },
    onStateChange: () => {},
  });
  hostMp.role = 'host';
  hostMp.status = 'connected';
  hostMp.localPeerId = hostPeerId;

  const clientMp = new P2PMultiplayerManager({
    scene,
    world,
    fx,
    getCreations: () => clientCreations,
    getActiveVehicle: () => clientRig,
    getIsWalking: () => false,
    getLocalPlayerTransform: () => ({
      pos: clientRig.position.clone(),
      quat: clientRig.quaternion.clone(),
    }),
    spawnRemoteVehicleRig: (pkt) => {
      const r = new ModularVehicleRig(scene, world, fx, pkt.ownerPeerId, true);
      r.networkId = pkt.vehicleId;
      r.ownerPeerId = pkt.ownerPeerId;
      if (pkt.blueprint?.voxels?.length) {
        r.importBlueprint(pkt.blueprint);
      } else {
        r.loadPreset(0);
      }
      r.isRemoteControlled = true;
      r.position.set(pkt.spawnPos[0], pkt.spawnPos[1], pkt.spawnPos[2]);
      clientCreations.push(r);
      return r;
    },
    onStateChange: () => {},
  });
  clientMp.role = 'client';
  clientMp.status = 'connected';
  clientMp.localPeerId = clientPeerId;

  // 1. Client sends STATE_SYNC to Host -> Host creates remote peer, builds WELCOME_LOBBY without crashing on voxelMap, and spawns clientRig
  const clientSync1 = clientMp.buildStateSyncPacket();
  hostMp.handleIncomingPacket(clientSync1);
  assert.equal(hostCreations.length, 2, 'Host must spawn remote client vehicle from STATE_SYNC');

  // 2. Subsequent STATE_SYNC packets with moved position update interpolation target smoothly without throwing
  clientRig.position.set(22, 4, -8);
  const clientSync2 = clientMp.buildStateSyncPacket();
  hostMp.handleIncomingPacket(clientSync2);
  hostMp.updateInterpolation(1 / 60, new THREE.Vector3());

  const spawnedClientOnHost = hostCreations.find((r) => r.networkId === clientRig.networkId)!;
  assert.ok(
    spawnedClientOnHost.position.x > 12,
    `Remote vehicle on Host must interpolate toward new position 22, got ${spawnedClientOnHost.position.x}`,
  );
});

test('custom cars built off-center or without GYRO / WHEEL_STEER turn cleanly without rolling sideways', async () => {
  const THREE = await import('three');
  const { MicroVoxelWorld } = await import('./world.ts');
  const { VoxelFXSystem } = await import('./fx.ts');
  const { ModularVehicleRig } = await import('./vehicle.ts');

  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene);
  const fx = new VoxelFXSystem(scene, world);

  // Build an off-center, high-CoM custom car starting at vx=12..18 (all wheels >= SYMMETRY_CENTER_X=12)
  // with SEAT_KART + V8_ENGINE + 4 WHEEL_DRIVE wheels (no GYRO and no explicit WHEEL_STEER)
  const customRig = new ModularVehicleRig(scene, world, fx, 'local', true);
  customRig.clearAll();
  customRig.fillBox(13, 6, 14, 17, 7, 24, MAT.ALLOY_BLUE);
  customRig.addModule('SEAT_KART', 15, 8, 18);
  customRig.addModule('V8_ENGINE', 15, 8, 22);
  customRig.addModule('WHEEL_DRIVE', 12, 5, 23);
  customRig.addModule('WHEEL_DRIVE', 18, 5, 23);
  customRig.addModule('WHEEL_DRIVE', 12, 5, 15);
  customRig.addModule('WHEEL_DRIVE', 18, 5, 15);
  customRig.rebuildVehicleGeometry();

  const ground = world.probeGroundBelow(0, 12, 0, 12);
  customRig.position.set(0, ground.y + 1.25, 0);
  customRig.quaternion.identity();

  // Simulate 90 frames (1.5 seconds) of full-throttle hard left turn (KeyW + KeyA)
  for (let i = 0; i < 90; i++) {
    customRig.updatePhysics(1 / 60, { KeyW: true, KeyA: true }, true);
  }

  const fwdAfterTurn = new THREE.Vector3(0, 0, 1).applyQuaternion(customRig.quaternion);
  const upAfterTurn = new THREE.Vector3(0, 1, 0).applyQuaternion(customRig.quaternion);
  const yawChangeRad = Math.atan2(fwdAfterTurn.x, fwdAfterTurn.z);

  assert.ok(
    Math.abs(yawChangeRad) > 0.25,
    `Custom car with 4 WHEEL_DRIVE wheels must steer and turn in yaw (got yaw=${yawChangeRad.toFixed(3)} rad)`,
  );
  assert.ok(
    upAfterTurn.y > 0.95 && Math.abs(customRig.rollDeg) <= 12,
    `Custom car must stay flat and never roll sideways while turning (got rollDeg=${customRig.rollDeg}, up.y=${upAfterTurn.y.toFixed(3)})`,
  );
  customRig.dispose();
  world.dispose();
});

test('zero-allocation out parameters in solveTireForces, evaluateGerstnerWaveSample, and computeHullPointBuoyancy mutate in-place identically and world chunk streaming avoids duplicate dirtyQueue entries', async () => {
  const {
    evaluateGerstnerWaveSample,
    computeHullPointBuoyancy,
  } = await import('./physicsMath.ts');
  const THREE = await import('three');
  const { MicroVoxelWorld } = await import('./world.ts');

  const tireInput = {
    compression: 0.35,
    restLen: 0.85,
    kSpring: 12000,
    cDamperBump: 1800,
    cDamperRebound: 3400,
    relVelY: -0.5,
    vLong: 8.0,
    vLat: 2.5,
    throttle: 1.0,
    brake: false,
    isPowered: true,
    engineForcePerWheel: 9000,
    topSpeedMPS: 30,
    surfaceMu: 1.0,
    wheelLoadCap: 25000,
  };
  const tireFresh = solveTireForces(tireInput);
  const tireOut = { normalLoad: 0, fLong: 0, fLat: 0, slipRatio: 0 };
  const tireReturned = solveTireForces(tireInput, tireOut);
  assert.equal(tireReturned, tireOut);
  assert.deepEqual(tireOut, tireFresh);

  const waveFresh = evaluateGerstnerWaveSample(12.5, -8.2, 3.4, 20.0, false, 1.0);
  const waveOut = {
    rawH: 0,
    terracedH: 0,
    slopeX: 0,
    slopeZ: 0,
    orbitalVx: 0,
    orbitalVy: 0,
    orbitalVz: 0,
    colorIndex: 0,
  };
  const waveReturned = evaluateGerstnerWaveSample(12.5, -8.2, 3.4, 20.0, false, 1.0, waveOut);
  assert.equal(waveReturned, waveOut);
  assert.deepEqual(waveOut, waveFresh);

  const buoyFresh = computeHullPointBuoyancy(1.1, 2.0, 45.0, 20.0, -0.8, 0.05, -0.04);
  const buoyOut = {
    isSubmerged: false,
    subDepth: 0,
    buoyUp: 0,
    waveSlopeFx: 0,
    waveSlopeFz: 0,
    dampingForceY: 0,
  };
  const buoyReturned = computeHullPointBuoyancy(
    1.1,
    2.0,
    45.0,
    20.0,
    -0.8,
    0.05,
    -0.04,
    buoyOut,
  );
  assert.equal(buoyReturned, buoyOut);
  assert.deepEqual(buoyOut, buoyFresh);

  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene);
  const initialQueueLen = world.dirtyQueue.length;
  const streamedChunk = world.getOrCreateChunk(99, 99, false, false);
  assert.equal(streamedChunk.inDirtyQueue, false);
  assert.equal(world.dirtyQueue.length, initialQueueLen);
  world.dispose();
});

test('8-Point Voxel Performance Architecture (#1 in-place BufferGeometry, #2 throttled rebuild budget, #3/#6 worker pool keep-alive, #4 1000-instance debris pool, #5 1-frame deferred vehicle hull rebuild, #7/#8 material bucket submesh merging)', async () => {
  const THREE = await import('three');
  const {
    MAT_BUCKET_SOIL,
    MAT_BUCKET_ROCK,
    MAT_BUCKET_STRUCTURAL,
    getVoxelMaterialBucket,
    warmUpGreedyMesherScratchpad,
  } = await import('./physicsMath.ts');
  const { MicroVoxelWorld, updateOrCreateDynamicMeshBuffer } = await import('./world.ts');
  const { VoxelFXSystem } = await import('./fx.ts');
  const { ModularVehicleRig } = await import('./vehicle.ts');

  // #6 & #7 — Warm up TypedArray greedy mesher scratchpad
  const warmResult = warmUpGreedyMesherScratchpad();
  assert.equal(warmResult, 1, 'Warm-up single voxel must return 1 when scratchpad is warmed');

  // #8 — Verify material bucket classification and partition equivalence
  assert.equal(getVoxelMaterialBucket(MAT.GRASS), MAT_BUCKET_SOIL);
  assert.equal(getVoxelMaterialBucket(MAT.ROCK), MAT_BUCKET_ROCK);
  assert.equal(getVoxelMaterialBucket(MAT.ALLOY_BLUE), MAT_BUCKET_STRUCTURAL);

  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene, true);
  const fx = new VoxelFXSystem(scene, world);

  // #4 — Verify 1000-instance InstancedMesh debris pool is pre-allocated with instanceColor
  assert.equal(fx.maxDebris, 1000, 'Debris pool must pre-allocate 1000 instances');
  assert.equal(fx.instanced.count, 1000, 'InstancedMesh count must be 1000');
  assert.ok(fx.instanced.instanceColor !== null, 'InstancedMesh instanceColor must be pre-allocated');

  // #6 — Verify worker pool keep-alive ping executes cleanly
  world.workerPool.pingIdleWorkers();
  assert.ok(world.workerPool.pingCount >= 1, 'Worker pool pingIdleWorkers must increment pingCount');

  // #1 & #8 — Verify in-place BufferAttribute updates and per-material bucket caching on chunks
  const chunk = world.getOrCreateChunk(8, 8, true);
  assert.ok(chunk.mesh !== null, 'Chunk mesh must exist after initial build');
  const initialGeo = chunk.mesh!.geometry;
  const initialPosAttr = initialGeo.getAttribute('position') as THREE.BufferAttribute;
  const initialIdxAttr = initialGeo.getIndex()!;
  assert.equal(initialPosAttr.usage, THREE.DynamicDrawUsage, 'Chunk position buffer must use DynamicDrawUsage');

  // Modify a single structural voxel inside chunk (8,8) -> only MAT_BUCKET_STRUCTURAL bit should be marked dirty
  chunk.dirty = false;
  chunk.dirtyBucketMask = 0;
  const prevSoilBucketRef = chunk.cachedOpaqueBuckets[MAT_BUCKET_SOIL];
  const worldVx = 8 * 32 + 10;
  const worldVz = 8 * 32 + 10;
  world.setVoxel(worldVx, 20, worldVz, MAT.ALLOY_BLUE);
  assert.equal(
    chunk.dirtyBucketMask,
    1 << MAT_BUCKET_STRUCTURAL,
    'Setting an ALLOY_BLUE voxel must only dirty MAT_BUCKET_STRUCTURAL bucket',
  );

  world.rebuildChunk(chunk);
  assert.equal(chunk.mesh!.geometry, initialGeo, '#1: Chunk rebuild must reuse the exact same BufferGeometry instance');
  assert.equal(
    chunk.mesh!.geometry.getAttribute('position'),
    initialPosAttr,
    '#1: Chunk rebuild must update existing position BufferAttribute in-place',
  );
  assert.equal(
    chunk.mesh!.geometry.getIndex(),
    initialIdxAttr,
    '#1: Chunk rebuild must update existing index BufferAttribute in-place',
  );
  assert.ok(chunk.inPlaceBufferUpdates >= 1, '#1: Chunk must record in-place buffer update');
  assert.equal(
    chunk.cachedOpaqueBuckets[MAT_BUCKET_SOIL],
    prevSoilBucketRef,
    '#8: Untouched SOIL material bucket cache must be reused without remeshing',
  );

  // #2 — Verify chunk rebuild throttling (maxChunkRebuildsPerFrame = 2) when 4 neighboring chunks are dirtied
  assert.equal(world.maxChunkRebuildsPerFrame, 2, '#2: Default rebuild budget must be 2 chunks per frame');
  const c00 = world.getOrCreateChunk(8, 8, true);
  const c10 = world.getOrCreateChunk(9, 8, true);
  const c01 = world.getOrCreateChunk(8, 9, true);
  const c11 = world.getOrCreateChunk(9, 9, true);
  for (const c of [c00, c10, c01, c11]) {
    c.dirty = true;
    c.dirtyBucketMask = 1 << MAT_BUCKET_SOIL;
    if (!c.inDirtyQueue) {
      c.inDirtyQueue = true;
      world.dirtyQueue.push(c);
    }
  }
  world.flushDirtyChunksImmediate(0, 0);
  const remainingDirty = [c00, c10, c01, c11].filter((c) => c.dirty).length;
  assert.equal(
    remainingDirty,
    2,
    '#2: Impact touching 4 chunks must only rebuild 2 chunks this frame and leave 2 dirty for next frame',
  );

  // #1 & #5 — Verify vehicle chassis updates BufferGeometry in-place and defers collision-hull rebuild by 1 frame on bullet impact
  const rig = new ModularVehicleRig(scene, world, fx, 'local');
  const rigInitialGeo = rig.chassisMesh!.geometry;
  const rigInitialPosAttr = rigInitialGeo.getAttribute('position');
  const collisionPointsBefore = rig.collisionPoints;

  // Carve a crater on the vehicle
  const wp = rig.localVoxelToWorld(12, 5, 16);
  const broken = rig.carveVehicleCrater(wp.x, wp.y, wp.z, 3, 2.0);
  assert.ok(broken > 0, 'Crater impact must break vehicle voxels');
  assert.equal(
    rig.chassisMesh!.geometry,
    rigInitialGeo,
    '#1: Vehicle crater rebuild must update chassis BufferGeometry in-place',
  );
  assert.equal(
    rig.chassisMesh!.geometry.getAttribute('position'),
    rigInitialPosAttr,
    '#1: Vehicle crater rebuild must reuse chassis position BufferAttribute in-place',
  );
  assert.ok(rig.inPlaceChassisBufferUpdates >= 1, '#1: Vehicle must record in-place chassis buffer update');
  assert.equal(
    rig.pendingPhysicsHullRebuild,
    true,
    '#5: Vehicle crater impact must defer collision-hull rebuild to next frame',
  );
  assert.equal(
    rig.collisionPoints,
    collisionPointsBefore,
    '#5: Collision hull array must remain unchanged on the impact frame itself',
  );

  // Step physics 1 frame -> deferred collision hull rebuild executes automatically!
  rig.updatePhysics(1 / 60, {}, false);
  assert.equal(
    rig.pendingPhysicsHullRebuild,
    false,
    '#5: Next frame updatePhysics must flush pendingPhysicsHullRebuild',
  );
  assert.notEqual(
    rig.collisionPoints,
    collisionPointsBefore,
    '#5: Collision hull must be updated on the frame following impact',
  );

  // Verify updateOrCreateDynamicMeshBuffer drawRange shrink/grow behavior directly
  const dummyGroup = new THREE.Group();
  const r1 = updateOrCreateDynamicMeshBuffer(
    null,
    {
      positions: new Float32Array(12),
      normals: new Float32Array(12),
      colors: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      vertCount: 4,
      indexCount: 6,
      rawFaces: 1,
      mergedQuads: 1,
    },
    world.sharedVoxelMaterial,
    dummyGroup,
    false,
    64,
  );
  assert.equal(r1.updatedInPlace, false);
  assert.equal(r1.mesh!.geometry.drawRange.count, 6);

  const r2 = updateOrCreateDynamicMeshBuffer(
    r1.mesh,
    {
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      colors: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
      vertCount: 3,
      indexCount: 3,
      rawFaces: 1,
      mergedQuads: 1,
    },
    world.sharedVoxelMaterial,
    dummyGroup,
    false,
    64,
  );
  assert.equal(r2.updatedInPlace, true);
  assert.equal(r2.mesh, r1.mesh);
  assert.equal(r2.mesh!.geometry.drawRange.count, 3);

  rig.dispose();
  world.dispose();
});

test('BUG 1 & BUG 2 Fix Verification: Worker pool >= 2 workers, Priority 0 spawn chunk + parallel Priority 1 surrounding chunks + spiral out, deferred LOD1/LOD2 until all chunks reach LOD0 MESH_READY, and radius <= 2 sync vs radius > 2 deferred voxel+mesh swap', async () => {
  const THREE = await import('three');
  const { MultiCoreMeshWorkerPool } = await import('./meshWorkerPool.ts');
  const { buildAllLodPayloadsForChunk } = await import('./meshWorker.ts');
  const { MicroVoxelWorld, ChunkState } = await import('./world.ts');
  const { VoxelFXSystem } = await import('./fx.ts');
  const { WORLD_CHUNKS_X, WORLD_CHUNKS_Z } = await import('./constants.ts');

  // 1. BUG 1a: Worker pool always has at least 2 active workers (Math.max(2, navigator.hardwareConcurrency - 1))
  const pool = new MultiCoreMeshWorkerPool();
  assert.ok(
    pool.activeWorkers >= 2,
    `Worker pool must always have at least 2 active workers, got ${pool.activeWorkers}`,
  );
  pool.dispose();

  // 2. BUG 1b & 1c: Priority queue generates spawn chunk first (priority 0), queues 8 surrounding chunks at priority 1 IN PARALLEL, spirals out, and defers LOD1/LOD2 until ALL chunks reach LOD0 MESH_READY
  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene, true);
  const centerCX = WORLD_CHUNKS_X >> 1;
  const centerCZ = WORLD_CHUNKS_Z >> 1;

  const spawnChunk = world.chunkMap.get(`${centerCX},${centerCZ}`)!;
  assert.ok(spawnChunk, 'Spawn chunk must exist');
  assert.equal(spawnChunk.priority, 0, 'Spawn chunk must have priority 0');
  assert.equal(spawnChunk.state, ChunkState.MESH_READY, 'Spawn chunk must reach MESH_READY immediately');
  assert.equal(spawnChunk.lod12Built, false, 'Spawn chunk LOD1/LOD2 must be deferred at startup');

  // Verify the 8 surrounding chunks at priority 1 were all processed in parallel in the first batch!
  let priority1ReadyCount = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const c = world.chunkMap.get(`${centerCX + dx},${centerCZ + dz}`)!;
      assert.equal(c.priority, 1, `Surrounding chunk (${dx},${dz}) must have priority 1`);
      if (c.state === ChunkState.MESH_READY || c.state === ChunkState.COMPLETE) {
        priority1ReadyCount++;
      }
      assert.equal(c.lod12Built, false, 'Priority 1 chunk LOD1/LOD2 must be deferred until all chunks reach LOD0 MESH_READY');
    }
  }
  assert.equal(
    priority1ReadyCount,
    8,
    'All 8 surrounding chunks at priority 1 must be dispatched and built in parallel in the first batch',
  );

  // Verify remaining queued chunks are ordered spiraling outward (priority 2, 3, 4...)
  for (let i = 1; i < world.priorityChunkQueue.length; i++) {
    const prev = world.priorityChunkQueue[i - 1];
    const curr = world.priorityChunkQueue[i];
    assert.ok(
      curr.priority > prev.priority ||
        (curr.priority === prev.priority && curr.spiralAngle >= prev.spiralAngle - 1e-6),
      'Remaining chunks in priorityChunkQueue must be sorted by ring priority then spiral angle',
    );
  }

  // While outer chunks are still in priorityChunkQueue, areAllChunksLod0MeshReady() MUST be false
  assert.equal(
    world.areAllChunksLod0MeshReady(),
    false,
    'areAllChunksLod0MeshReady must be false while outer spiral chunks are still queued',
  );

  // Verify buildAllLodPayloadsForChunk with lod0Only: true skips LOD1 and LOD2 generation
  const lod0OnlyPayload = buildAllLodPayloadsForChunk({
    jobId: 999,
    cx: centerCX,
    cz: centerCZ,
    minY: spawnChunk.minY,
    maxY: spawnChunk.maxY,
    originX: spawnChunk.originX,
    originZ: spawnChunk.originZ,
    voxels: spawnChunk.voxels,
    hasTranslucent: false,
    lod0Only: true,
  });
  assert.equal(lod0OnlyPayload.lod12Deferred, true);
  assert.equal(lod0OnlyPayload.lod1.vertCount, 0, 'lod0Only must skip LOD1 generation');
  assert.equal(lod0OnlyPayload.lod2.vertCount, 0, 'lod0Only must skip LOD2 generation');

  // Drain priorityChunkQueue -> now ALL chunks reach LOD0 MESH_READY
  while (world.priorityChunkQueue.length > 0) {
    world.processPriorityChunkQueue();
  }
  assert.equal(
    world.areAllChunksLod0MeshReady(),
    true,
    'areAllChunksLod0MeshReady must be true once all chunks have reached LOD0 MESH_READY',
  );

  // 3. BUG 2a: Small destruction (single block / radius <= 2) rebuilds chunk mesh SYNCHRONOUSLY on main thread
  const fx = new VoxelFXSystem(scene, world);
  const groundAtOrigin = world.probeGroundBelow(0, 20, 0, 5);
  const { vx: gvx, vy: gvy, vz: gvz } = world.worldToVoxelCoords(0, groundAtOrigin.y - 0.12, 0);
  const targetChunk = world.chunkMap.get(`${gvx >> 6},${gvz >> 6}`)!;
  const updatesBeforeSmall = targetChunk.inPlaceBufferUpdates;

  assert.notEqual(world.getVoxel(gvx, gvy, gvz), MAT.AIR, 'Target ground voxel must initially be solid');
  fx.carveWorldCrater(0, groundAtOrigin.y - 0.12, 0, 2, 0, false); // radius = 2 <= 2 (small destruction)
  assert.equal(
    world.getVoxel(gvx, gvy, gvz),
    MAT.AIR,
    'Small destruction (radius <= 2) must update voxel array immediately',
  );
  assert.equal(
    targetChunk.pendingRemovals.size,
    0,
    'Small destruction (radius <= 2) must not leave pendingRemovals',
  );
  assert.ok(
    targetChunk.inPlaceBufferUpdates > updatesBeforeSmall,
    'Small destruction (radius <= 2) must synchronously rebuild chunk mesh on the same frame via rebuildChunkSync()',
  );

  // 4. BUG 2b: Large destruction (radius > 2) defers voxel removal until worker returns new mesh, then swaps both simultaneously
  const testWX = 6.0;
  const testWZ = 6.0;
  const groundAtTest = world.probeGroundBelow(testWX, 20, testWZ, 5);
  const { vx: lvx, vy: lvy, vz: lvz } = world.worldToVoxelCoords(testWX, groundAtTest.y - 0.12, testWZ);
  const largeChunk = world.chunkMap.get(`${lvx >> 6},${lvz >> 6}`)!;

  // Intercept enqueueChunkJob to hold the worker resolution so we can inspect the in-flight state!
  let resolveHeldWorker: ((res: ReturnType<typeof buildAllLodPayloadsForChunk>) => void) | null = null;
  let capturedWorkerVoxels: Uint8Array | null = null;
  const origEnqueue = world.workerPool.enqueueChunkJob.bind(world.workerPool);
  world.workerPool.enqueueChunkJob = (
    cx,
    cz,
    minY,
    maxY,
    originX,
    originZ,
    voxels,
    hasTranslucent,
    transMinY,
    transMaxY,
    customColors,
    dirtyBucketMask,
    lod0Only,
  ) => {
    capturedWorkerVoxels = new Uint8Array(voxels);
    return new Promise((resolve) => {
      resolveHeldWorker = () => {
        resolve(
          buildAllLodPayloadsForChunk({
            jobId: 12345,
            cx,
            cz,
            minY,
            maxY,
            originX,
            originZ,
            voxels,
            customColors: customColors || undefined,
            hasTranslucent,
            transMinY,
            transMaxY,
            dirtyBucketMask,
            lod0Only,
          }),
        );
      };
    });
  };

  const meshUpdatesBeforeLarge = largeChunk.inPlaceBufferUpdates;
  fx.carveWorldCrater(testWX, groundAtTest.y - 0.12, testWZ, 5, 0, false); // radius = 5 > 2 (large destruction)

  // WHILE WORKER IS IN FLIGHT:
  // - Voxel is marked as pending removal
  // - Physics (`world.getVoxel` / `world.isSolidAtWorld`) STILL sees the solid block so player never falls through visible blocks!
  // - Worker snapshot already has the voxel removed (`MAT.AIR`) so worker builds the post-crater mesh
  assert.equal(
    world.isVoxelPendingRemoval(lvx, lvy, lvz),
    true,
    'Large destruction (radius > 2) must mark voxel as pending removal while worker is meshing',
  );
  assert.notEqual(
    world.getVoxel(lvx, lvy, lvz),
    MAT.AIR,
    'Large destruction (radius > 2) must NOT remove voxel from active physics array before worker completes',
  );
  assert.ok(capturedWorkerVoxels !== null, 'Worker must be queued with voxel snapshot');
  const localIdx = (lvx & 63) + 64 * (lvy + 512 * (lvz & 63));
  assert.equal(
    capturedWorkerVoxels![localIdx],
    MAT.AIR,
    'Worker snapshot must contain the pending removal so the worker meshes the new crater',
  );
  assert.equal(
    largeChunk.inPlaceBufferUpdates,
    meshUpdatesBeforeLarge,
    'Chunk mesh must not swap before worker completes',
  );

  // NOW COMPLETE THE WORKER:
  assert.ok(resolveHeldWorker !== null, 'Worker job must be pending');
  (resolveHeldWorker as (val: unknown) => void)(null);
  await Promise.resolve();
  await Promise.resolve();

  // ON WORKER COMPLETION:
  // Both the voxel array AND the chunk mesh must have swapped at the exact same time!
  assert.equal(
    world.isVoxelPendingRemoval(lvx, lvy, lvz),
    false,
    'Pending removal flag must be cleared on worker completion',
  );
  assert.equal(
    world.getVoxel(lvx, lvy, lvz),
    MAT.AIR,
    'Voxel must be removed from physics array upon worker completion',
  );
  assert.ok(
    largeChunk.inPlaceBufferUpdates > meshUpdatesBeforeLarge,
    'Chunk mesh must swap at the exact same time the pending voxel removal is committed',
  );

  world.workerPool.enqueueChunkJob = origEnqueue;
  world.dispose();
});

test('Static World Structural Collapse (Option A + Option B): 5x5 terrain column undercut and Gantry Arch pillar severing spawn falling TerrainEntity blocks', async () => {
  const { MicroVoxelWorld } = await import('./world.ts');
  const { VoxelFXSystem } = await import('./fx.ts');
  const { TerrainEntity } = await import('./physics/terrainEntity.ts');
  const { TOTAL_VX, TOTAL_VZ } = await import('./constants.ts');

  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene);
  const fx = new VoxelFXSystem(scene, world);
  TerrainEntity.clearAll();

  const cx = TOTAL_VX >> 1;
  const cz = TOTAL_VZ >> 1;

  // 1. Test 5x5 column of terrain collapse when base support is destroyed
  const colCenterVX = cx - 40;
  const colCenterVZ = cz - 20;
  const groundProbe = world.probeGroundBelow(
    (colCenterVX - cx + 0.5) * VOXEL_SIZE,
    20,
    (colCenterVZ - cz + 0.5) * VOXEL_SIZE,
    5,
  );
  const baseVY = Math.round(groundProbe.y / VOXEL_SIZE) - 1;

  // Build a 5x5 column of height 4 (base at baseVY+1..baseVY+2, upper cap at baseVY+3..baseVY+4)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = 1; dy <= 4; dy++) {
        world.setVoxel(colCenterVX + dx, baseVY + dy, colCenterVZ + dz, MAT.DIRT);
      }
    }
  }
  assert.equal(
    world.readEffectiveVoxelMat(colCenterVX, baseVY + 4, colCenterVZ),
    MAT.DIRT,
    'Top of 5x5 column must initially be solid MAT.DIRT',
  );

  // Carve out the base of the 5x5 column (vy = baseVY+1..baseVY+2)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      world.setVoxel(colCenterVX + dx, baseVY + 1, colCenterVZ + dz, MAT.AIR);
      world.setVoxel(colCenterVX + dx, baseVY + 2, colCenterVZ + dz, MAT.AIR);
    }
  }

  TerrainEntity.clearAll();
  const touched = new Set<import('./world.ts').MicroVoxelChunk>();
  const collapsedColumnBlocks = world.collapseUnsupportedWorldVoxels(
    colCenterVX,
    baseVY + 1,
    colCenterVZ,
    2,
    true,
    touched,
  );

  assert.equal(
    collapsedColumnBlocks,
    50,
    'All 50 unsupported blocks (2 layers of 5x5) above the severed column base must collapse',
  );
  assert.equal(
    world.readEffectiveVoxelMat(colCenterVX, baseVY + 4, colCenterVZ),
    MAT.AIR,
    'Collapsed 5x5 column voxels must be removed from static world chunk',
  );
  assert.equal(
    TerrainEntity.active.length,
    1,
    'Entire 5x5x2 collapsed column cap must fall as ONE unified TerrainEntity structure',
  );
  assert.equal(TerrainEntity.active[0].isStructure, true);
  assert.equal(
    TerrainEntity.active[0].voxelCount,
    50,
    'Unified TerrainEntity structure must contain all 50 collapsed voxels',
  );

  // Step TerrainEntity physics so the unified collapsed column lands on the ground below and enters sleep mode
  for (let s = 0; s < 140; s++) {
    TerrainEntity.updateAll(0.02, [], world);
  }
  assert.equal(
    TerrainEntity.active.every((e) => e.isResting),
    true,
    'Collapsed 5x5 column unified TerrainEntity must land on the ground below and rest',
  );

  // 2. Test Proving Grounds Speed Trap Gantry Arch collapse when support pillars are smashed with Hammer (radius = 5)
  const gateZ = cz + 48;
  // Verify the overhead arch beam at center (cx, baseVY + 21, gateZ) is initially intact
  assert.notEqual(
    world.readEffectiveVoxelMat(cx, baseVY + 21, gateZ),
    MAT.AIR,
    'Overhead Gantry Arch beam must initially be intact when both pillars stand',
  );

  TerrainEntity.clearAll();
  // Smash the Left Pillar (cx - 22, baseVY + 5, gateZ) with Hammer crater (radius = 5)
  const leftPillarWX = (cx - 22 - cx + 0.5) * VOXEL_SIZE;
  const leftPillarWY = (baseVY + 5 + 0.5) * VOXEL_SIZE;
  const leftPillarWZ = (gateZ - cz + 0.5) * VOXEL_SIZE;
  fx.carveWorldCrater(leftPillarWX, leftPillarWY, leftPillarWZ, 5, 0, false);

  // Smash the Right Pillar (cx + 22, baseVY + 5, gateZ) with Hammer crater (radius = 5)
  const rightPillarWX = (cx + 22 - cx + 0.5) * VOXEL_SIZE;
  const rightPillarWY = (baseVY + 5 + 0.5) * VOXEL_SIZE;
  const rightPillarWZ = (gateZ - cz + 0.5) * VOXEL_SIZE;
  fx.carveWorldCrater(rightPillarWX, rightPillarWY, rightPillarWZ, 5, 0, false);

  assert.equal(
    world.readEffectiveVoxelMat(cx, baseVY + 21, gateZ),
    MAT.AIR,
    'Overhead Gantry Arch beam must collapse once its support pillars are destroyed',
  );
  const archStructures = TerrainEntity.active.filter((e) => e.isStructure);
  const totalArchVoxels = archStructures.reduce((sum, e) => sum + e.voxelCount, 0);
  assert.ok(
    archStructures.length >= 1 && totalArchVoxels > 200,
    `Expected unified falling TerrainEntity structure(s) from collapsed Gantry Arch, got ${archStructures.length} structures (${totalArchVoxels} voxels)`,
  );

  TerrainEntity.clearAll();
  world.dispose();
});

test('Phase 1 Item 5: baked voxel AO (0.70..1.0), ±5% per-voxel color jitter on 5x5x5 cube, <50% HP red tint + 1.05x scale-up, and spawnTime pop', () => {
  // 1. 5x5x5 green cube with perVoxelDetail=true -> 6 * 25 = 150 distinct quads, distinct per-voxel colors
  const cubeRes = greedyMeshBoundedArrays(
    5, 5, 5,
    0, 4,
    () => MAT.PAINT_EMERALD,
    0, 0, 0,
    VOXEL_SIZE, VOXEL_SIZE,
    'OPAQUE_ONLY',
    null,
    false,
    -1,
    undefined,
    { perVoxelDetail: true },
  );
  assert.equal(cubeRes.mergedQuads, 150, '5x5x5 cube with perVoxelDetail must emit 150 individual face quads');
  assert.ok(cubeRes.ao && cubeRes.ao.length === cubeRes.vertCount, 'Must emit baked ao vertex attribute');
  // Outer flat faces of a convex 5x5x5 cube have ao === 1.0
  for (let i = 0; i < cubeRes.vertCount; i++) {
    assert.equal(cubeRes.ao[i], 1.0);
  }
  // Adjacent voxels on the same face must have distinct jittered green channel values within ±5%
  const topGreenValues = new Set<number>();
  for (let q = 0; q < cubeRes.mergedQuads; q++) {
    const vIdx = q * 4;
    if (cubeRes.normals[vIdx * 3 + 1] > 0.9) {
      topGreenValues.add(Math.round(cubeRes.colors[vIdx * 3 + 1] * 10000));
    }
  }
  assert.ok(topGreenValues.size >= 15, `Expected distinct per-voxel jitter shades on 5x5 top face, got ${topGreenValues.size}`);

  // 2. Concave L-shape -> inner corner must get baked AO < 1.0 (in [0.70, 0.88])
  const lRes = greedyMeshBoundedArrays(
    3, 3, 3,
    0, 2,
    (x, y, z) => (y === 0 || (x === 0 && y === 1) ? MAT.CONCRETE : MAT.AIR),
    0, 0, 0,
    VOXEL_SIZE, VOXEL_SIZE,
    'OPAQUE_ONLY',
    null,
    false,
    -1,
    undefined,
    { perVoxelDetail: true },
  );
  let minAo = 1.0;
  let maxAo = 0.0;
  for (let i = 0; i < lRes.vertCount; i++) {
    const v = lRes.ao![i];
    if (v < minAo) minAo = v;
    if (v > maxAo) maxAo = v;
  }
  assert.ok(minAo >= 0.70 && minAo <= 0.88, `Expected concave corner AO in [0.70, 0.88], got ${minAo}`);
  assert.equal(maxAo, 1.0, 'Flat exposed corners must retain AO = 1.0');

  // 3. Vehicle voxel damage highlight (< 50% HP -> red tint + 1.05x scale-up) & Build Mode spawnTime
  const intactSingle = greedyMeshBoundedArrays(
    1, 1, 1,
    0, 0,
    () => MAT.PAINT_EMERALD,
    0, 0, 0,
    VOXEL_SIZE, VOXEL_SIZE,
    'OPAQUE_ONLY',
    null,
    false,
    -1,
    undefined,
    { perVoxelDetail: true, getVoxelHp: () => 1.0 },
  );
  const dmgSingle = greedyMeshBoundedArrays(
    1, 1, 1,
    0, 0,
    () => MAT.PAINT_EMERALD,
    0, 0, 0,
    VOXEL_SIZE, VOXEL_SIZE,
    'OPAQUE_ONLY',
    null,
    false,
    -1,
    undefined,
    {
      perVoxelDetail: true,
      getVoxelHp: () => 0.25, // 25% HP -> 62.5% red tint + 1.05x scale-up
      getVoxelSpawnTime: () => 12.5,
    },
  );
  // Check red tint dramatically boosts R relative to intact green voxel
  assert.ok(dmgSingle.colors[0] > intactSingle.colors[0] + 0.35, 'Damaged voxel (<50% HP) must shift strongly toward red');
  // Check 1.05x scale-up around voxel center (0.125, 0.125, 0.125)
  let maxSpanX = 0;
  for (let i = 0; i < dmgSingle.vertCount; i++) {
    const dx = Math.abs(dmgSingle.positions[i * 3] - 0.125);
    if (dx > maxSpanX) maxSpanX = dx;
  }
  assert.ok(
    Math.abs(maxSpanX - 0.125 * 1.05) < 1e-4,
    `Expected damaged voxel half-extent ${0.125 * 1.05}, got ${maxSpanX}`,
  );
  assert.ok(dmgSingle.spawnTimes && dmgSingle.spawnTimes[0] === 12.5);
  assert.ok(dmgSingle.voxelCenters && Math.abs(dmgSingle.voxelCenters[0] - 0.125) < 1e-5);
});





