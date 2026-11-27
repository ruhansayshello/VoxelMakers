import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VOXEL_SIZE } from './constants.ts';
import {
  MICRO_VOXEL_SIZE,
  MICRO_VOXEL_SUBDIV,
  buildGreedyMicroVoxelGeometry,
  countSolidMicroVoxels,
  createMicroVoxelGrid,
  fillMicroBox,
  setMicroVoxel,
} from './microVoxelMesh.ts';
import {
  createArticulatedPlayerRig,
  updateProceduralPlayer,
} from './playerModel.ts';
import {
  RAGDOLL_NODE,
  RAGDOLL_NODE_COUNT,
  activatePlayerRagdoll,
  applyRagdollToRig,
  createPlayerRagdollState,
  deactivatePlayerRagdoll,
  resetRigFromRagdoll,
  stepPlayerRagdoll,
} from './playerRagdoll.ts';

test('microVoxelMesh: 1px scale is exact 1/4 of world voxel and greedy-meshes a solid 4x4x4 cube to 6 quads', () => {
  assert.equal(MICRO_VOXEL_SUBDIV, 4);
  assert.equal(MICRO_VOXEL_SIZE, VOXEL_SIZE / 4);
  assert.equal(MICRO_VOXEL_SIZE, 0.0625);

  const grid = createMicroVoxelGrid(4, 4, 4);
  fillMicroBox(grid, 0, 0, 0, 3, 3, 3, 1);
  assert.equal(countSolidMicroVoxels(grid), 64);

  const geo = buildGreedyMicroVoxelGeometry(grid, { 1: 0x38bdf8 }, { bakeAO: false });
  const indexCount = geo.index ? geo.index.count : 0;
  // 6 faces * 2 triangles * 3 indices = 36 indices (zero interior faces, full greedy merge)
  assert.equal(indexCount, 36, `Expected 36 indices for greedy 4x4x4 cube, got ${indexCount}`);

  const bb = geo.boundingBox!;
  assert.ok(Math.abs((bb.max.x - bb.min.x) - VOXEL_SIZE) < 1e-6);
  assert.ok(Math.abs((bb.max.y - bb.min.y) - VOXEL_SIZE) < 1e-6);
  assert.ok(Math.abs((bb.max.z - bb.min.z) - VOXEL_SIZE) < 1e-6);

  const colorAttr = geo.getAttribute('color');
  assert.ok(colorAttr && colorAttr.count === 24);
  geo.dispose();
});

test('microVoxelMesh: sculpted multi-color micro-voxel grid preserves colors and valid normals', () => {
  const grid = createMicroVoxelGrid(4, 4, 4);
  fillMicroBox(grid, 0, 0, 0, 3, 1, 3, 1);
  setMicroVoxel(grid, 1, 2, 1, 2);
  setMicroVoxel(grid, 2, 2, 1, 2);

  const geo = buildGreedyMicroVoxelGeometry(grid, { 1: 0x1e293b, 2: 0xfacc15 });
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const col = geo.getAttribute('color');
  assert.ok(pos.count > 24, 'Stepped voxel extrusion should add exterior faces');
  assert.equal(pos.count, norm.count);
  assert.equal(pos.count, col.count);
  for (let i = 0; i < norm.count; i++) {
    const len = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i));
    assert.ok(Math.abs(len - 1.0) < 1e-4, `Normal at ${i} should be unit length`);
  }
  geo.dispose();
});

test('playerModel: 1px micro-voxel pilot preserves rig hierarchy, child counts, and tools', () => {
  const rig = createArticulatedPlayerRig('#38bdf8');
  assert.equal(rig.rootGroup.userData.isMicroVoxelCharacter, true);
  assert.equal(rig.rootGroup.userData.microVoxelSize, MICRO_VOXEL_SIZE);

  // Required by existing physics.test.ts assertions
  assert.equal(rig.leftLegPivot.children.length, 2);
  assert.equal(rig.rightLegPivot.children.length, 2);
  assert.equal(rig.leftKneePivot.children.length, 4);
  assert.equal(rig.rightKneePivot.children.length, 4);

  let meshCount = 0;
  rig.rootGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      meshCount++;
      assert.equal(obj.geometry.userData.isMicroVoxel, true, `Mesh ${obj.name} should use 1px micro-voxel geometry`);
      assert.ok(obj.geometry.getAttribute('position').count >= 24);
    }
  });
  assert.ok(meshCount >= 18, `Expected full articulated micro-voxel pilot meshes (got ${meshCount})`);

  // Verify build-mode wrench tool visibility & walking animation still work
  updateProceduralPlayer(
    rig,
    { walkSpeed: 5.5, isGrounded: true, isBuildMode: true },
    0.05,
  );
  assert.equal(rig.toolMeshes.WRENCH?.visible, true);
  assert.equal(rig.toolMeshes.PLASMA_RIFLE?.visible, false);
});

test('playerRagdoll: simulates launch, maintains skeleton constraints, collides with voxel ground, settles, and resets cleanly', () => {
  const state = createPlayerRagdollState();
  const rig = createArticulatedPlayerRig('#38bdf8');

  // Inactive ragdoll is a no-op
  const idleStep = stepPlayerRagdoll(state, 0.016, {
    sampleGroundY: () => 2.0,
  });
  assert.equal(idleStep.active, false);
  assert.equal(idleStep.readyToRecover, false);

  // Activate ragdoll with an upward & forward blast impulse at ground y = 2.0
  activatePlayerRagdoll(state, 10, 2.0, -4, 0.4, 7.5, 6.2, 3.0, 2.2, 1 / 60);
  assert.equal(state.active, true);

  const floorY = 2.0;
  let maxPelvisY = -Infinity;
  let lastStep = idleStep;

  for (let i = 0; i < 180; i++) {
    lastStep = stepPlayerRagdoll(state, 1 / 60, {
      sampleGroundY: () => floorY,
    });
    if (lastStep.pelvisY > maxPelvisY) {
      maxPelvisY = lastStep.pelvisY;
    }
    // Every joint must remain at or above floorY + radius (no sinking through terrain)
    for (let n = 0; n < RAGDOLL_NODE_COUNT; n++) {
      const y = state.pos[n * 3 + 1];
      assert.ok(
        y >= floorY + state.radii[n] - 1e-4,
        `Node ${n} sank below floor at step ${i}: y=${y} < ${floorY + state.radii[n]}`,
      );
    }
  }

  // Should have launched into the air and traveled horizontally
  assert.ok(maxPelvisY > floorY + 1.2, `Ragdoll should arc upward on blast (maxPelvisY=${maxPelvisY})`);
  const horizTravel = Math.hypot(lastStep.pelvisX - 10, lastStep.pelvisZ - -4);
  assert.ok(horizTravel > 2.5, `Ragdoll should travel horizontally under blast (travel=${horizTravel})`);

  // Primary torso bone (pelvis -> chest) should preserve rest length tightly
  const pBase = RAGDOLL_NODE.PELVIS * 3;
  const cBase = RAGDOLL_NODE.CHEST * 3;
  const spineLen = Math.hypot(
    state.pos[cBase] - state.pos[pBase],
    state.pos[cBase + 1] - state.pos[pBase + 1],
    state.pos[cBase + 2] - state.pos[pBase + 2],
  );
  const expectedSpine = state.constraints[0].restLen;
  assert.ok(
    Math.abs(spineLen - expectedSpine) < 0.03,
    `Spine length drifted: got ${spineLen}, expected ${expectedSpine}`,
  );

  // Apply ragdoll to rig -> pelvisGroup should move to origin & rotate in 3D
  applyRagdollToRig(rig, state);
  assert.equal(rig.pelvisGroup.position.y, 0);
  assert.ok(
    Math.abs(rig.rootGroup.position.x - lastStep.pelvisX) < 1e-4 &&
      Math.abs(rig.rootGroup.position.y - lastStep.pelvisY) < 1e-4,
  );

  // Continue stepping until settled / readyToRecover
  for (let i = 0; i < 180 && !lastStep.readyToRecover; i++) {
    lastStep = stepPlayerRagdoll(state, 1 / 60, { sampleGroundY: () => floorY });
  }
  assert.equal(lastStep.readyToRecover, true, 'Ragdoll should settle and signal recovery');

  // Reset cleanly (simulates stand-up or entering Build Mode mid-ragdoll)
  deactivatePlayerRagdoll(state);
  resetRigFromRagdoll(rig);
  assert.equal(state.active, false);
  assert.equal(rig.pelvisGroup.position.y, 0.72);
  assert.equal(rig.leftLegPivot.position.y, -0.04);
  assert.equal(rig.rightLegPivot.position.y, -0.04);
  assert.ok(Math.abs(rig.pelvisGroup.quaternion.w - 1.0) < 1e-5);
});

test('playerRagdoll: getting-up animation smoothly rises through crouch push-up to upright and supports instant cancel', async () => {
  const { beginRagdollGetUp, stepRagdollGetUp } = await import('./playerRagdoll.ts');
  const state = createPlayerRagdollState();
  const rig = createArticulatedPlayerRig('#38bdf8');
  const floorY = 2.0;

  // Launch & settle ragdoll on ground
  activatePlayerRagdoll(state, 4, floorY, 2, 0.5, 4.0, 3.0, 2.0, 2.0, 1 / 60);
  for (let i = 0; i < 160; i++) {
    stepPlayerRagdoll(state, 1 / 60, { sampleGroundY: () => floorY });
  }
  applyRagdollToRig(rig, state);
  const lyingPelvisY = rig.rootGroup.position.y;

  // Begin 0.55s getting-up sequence
  beginRagdollGetUp(state, rig, state.pos[0], floorY, state.pos[2], 1.2, 0.55);
  assert.equal(state.active, false);
  assert.equal(state.isGettingUp, true);

  // Step to mid-point (~0.26s — crouched push-up phase)
  let midStep = stepRagdollGetUp(state, rig, 1 / 60);
  for (let i = 1; i < 16; i++) {
    midStep = stepRagdollGetUp(state, rig, 1 / 60);
  }
  assert.equal(midStep.isGettingUp, true);
  assert.equal(midStep.completed, false);
  assert.ok(midStep.progress > 0.35 && midStep.progress < 0.65);
  assert.ok(
    midStep.pelvisY > lyingPelvisY && midStep.pelvisY < floorY + 0.72,
    `Mid-get-up pelvis height (${midStep.pelvisY}) should be rising between ground (${lyingPelvisY}) and standing (${floorY + 0.72})`,
  );

  // Step through completion
  let finalStep = midStep;
  for (let i = 0; i < 30 && !finalStep.completed; i++) {
    finalStep = stepRagdollGetUp(state, rig, 1 / 60);
  }
  assert.equal(finalStep.completed, true);
  assert.equal(state.isGettingUp, false);
  assert.equal(rig.pelvisGroup.position.y, 0.72);
  assert.ok(Math.abs(rig.rootGroup.position.y - floorY) < 1e-4);
  assert.ok(Math.abs(rig.pelvisGroup.quaternion.w - 1.0) < 1e-5);

  // Verify instant cancel mid-get-up (e.g., entering Build Mode / Vehicle)
  activatePlayerRagdoll(state, 4, floorY, 2, 0, 2, 2, 0, 1.0, 1 / 60);
  applyRagdollToRig(rig, state);
  beginRagdollGetUp(state, rig, 4, floorY, 2, 0, 0.55);
  stepRagdollGetUp(state, rig, 0.1);
  assert.equal(state.isGettingUp, true);
  deactivatePlayerRagdoll(state);
  assert.equal(state.isGettingUp, false);
  assert.equal(state.active, false);
});

