import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAT } from './constants.ts';
import { getMicroVoxelBlockTemplate } from './microVoxelBlocks.ts';
import {
  previewBuildModeDisconnections,
  detachDisconnectedVoxelsOnExitBuildMode,
} from './physics/structuralIntegrity.ts';
import { findDisconnectedVoxelIslands } from './worldObjects.ts';
import { ModularVehicleRig } from './vehicle.ts';
import { VoxelFXSystem } from './fx.ts';
import { MicroVoxelWorld } from './world.ts';

test('PISTON visual template is distinct from SUSPENSION coilover spring', () => {
  const susp = getMicroVoxelBlockTemplate('SUSPENSION');
  const piston = getMicroVoxelBlockTemplate('PISTON');
  const jack = getMicroVoxelBlockTemplate('OUTRIGGER_JACK');

  assert.notEqual(
    piston.totalVoxels,
    susp.totalVoxels,
    'PISTON must have a distinct solid hydraulic barrel voxel count vs SUSPENSION coil spring',
  );
  assert.notEqual(
    jack.totalVoxels,
    susp.totalVoxels,
    'OUTRIGGER_JACK must have a distinct telescopic box leg vs SUSPENSION',
  );

  // Verify PISTON has solid hydraulic cylinder walls (pal[2] steel & pal[4] yellow collars) and NO orange spring coils (pal[5])
  let pistonOrangeCount = 0;
  let suspOrangeCount = 0;
  for (let i = 0; i < piston.grid.data.length; i++) {
    if (piston.grid.data[i] === 5) pistonOrangeCount++;
  }
  for (let i = 0; i < susp.grid.data.length; i++) {
    if (susp.grid.data[i] === 5) suspOrangeCount++;
  }
  assert.equal(pistonOrangeCount, 0, 'PISTON should not use orange coil spring voxels');
  assert.ok(suspOrangeCount > 10, 'SUSPENSION must retain orange coil spring voxels');
});

test('Blocks attached to PISTON, chained modules, or 1px microHull bridges stay connected in Build Mode and Driving Mode', () => {
  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene, true);
  const fx = new VoxelFXSystem(scene, world);
  const rig = new ModularVehicleRig(scene, world, fx);

  rig.clearAll();
  rig.setHoverBuildMode(true);

  // Main chassis floor + cockpit at (12, 6..7, 18..22)
  for (let z = 18; z <= 22; z++) {
    rig.setVoxel(12, 6, z, MAT.ALLOY_BLUE);
  }
  rig.addModule('COCKPIT', 12, 7, 18);

  // Place PISTON on top of chassis voxel (12, 6, 22) -> placed at (12, 7, 22) (far from COCKPIT at z=18)
  rig.addModule('PISTON', 12, 7, 22);

  // Attach a block to the top face of the 3x3x3 PISTON volume -> lands at (12, 9, 22) (distance dy=2 from piston)
  rig.setVoxel(12, 9, 22, MAT.ARMOR_SLATE);

  // Chain another module (HINGE_LARGE) onto the PISTON at (12, 7, 25) -> attach a block at (12, 7, 27)
  rig.addModule('HINGE_LARGE', 12, 7, 25);
  rig.setVoxel(12, 7, 27, MAT.ARMOR_SLATE);

  // Build a 1px microHull bridge from (12, 6, 18) to (10, 6, 18) and attach a 4px block at (9, 6, 18)
  rig.placeScaledHullBlock(11 * 4, 6 * 4, 18 * 4, 1, MAT.STEEL);
  rig.placeScaledHullBlock(10 * 4, 6 * 4, 18 * 4, 1, MAT.STEEL);
  rig.setVoxel(9, 6, 18, MAT.ALLOY_BLUE);

  rig.rebuildVehicleGeometry();

  const disconnected = previewBuildModeDisconnections(rig);
  assert.equal(
    disconnected.length,
    0,
    'Blocks attached through PISTON, chained modules, or microHull must NOT be marked disconnected',
  );
  assert.equal(rig.fallingOffVoxels.size, 0);

  // Exiting build mode must keep all attached blocks intact!
  const detachedOnExit = detachDisconnectedVoxelsOnExitBuildMode(rig, fx.voxelDebrisSystem);
  assert.equal(detachedOnExit.length, 0);
  assert.equal(rig.getVoxel(12, 9, 22), MAT.ARMOR_SLATE);
  assert.equal(rig.getVoxel(12, 7, 27), MAT.ARMOR_SLATE);
  assert.equal(rig.getVoxel(9, 6, 18), MAT.ALLOY_BLUE);

  // findDisconnectedVoxelIslands with bridgeModules must also keep them connected
  const islandCheck = findDisconnectedVoxelIslands(
    rig.voxelMap,
    { vx: 12, vy: 7, vz: 18 },
    rig.modules,
    rig.microHull.getOccupiedCoarseCoords(),
  );
  assert.equal(islandCheck.detachedIslands.length, 0);

  // Removing the bridging PISTON MUST now cause (12, 9, 22) and (12, 7, 27) to be marked disconnected
  rig.setHoverBuildMode(true);
  rig.removeModuleAt(12, 7, 22);
  const afterRemove = previewBuildModeDisconnections(rig);
  assert.equal(
    afterRemove.length,
    2,
    'Removing the bridging PISTON must disconnect the 2 voxels that depended on it',
  );

  world.dispose();
});

test('PISTON extends on first keypress and retracts cleanly on second press of the SAME key (default KeyX and custom KeyG)', () => {
  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene, true);
  const fx = new VoxelFXSystem(scene, world);
  const rig = new ModularVehicleRig(scene, world, fx);

  rig.setHoverBuildMode(false);
  rig.isLocalPlayerOccupied = true;

  // Install default piston (KeyX) and custom-bound piston (KeyG)
  rig.addModule('PISTON', 12, 5, 18);
  rig.addModule('PISTON', 12, 5, 20, 0, {
    posKey: 'KeyG',
    negKey: 'KeyQ',
    toggleMode: true,
    autoReset: false, // Even if a saved blueprint has autoReset: false alongside toggleMode: true, same-key retract MUST work!
  });
  rig.rebuildVehicleGeometry();

  const defaultPiston = rig.getModuleAt(12, 5, 18)!;
  const customPiston = rig.getModuleAt(12, 5, 20)!;
  assert.ok(defaultPiston && customPiston);

  const keys: Record<string, boolean> = {};

  // 1. Press KeyX once -> default piston extends; custom piston stays retracted
  keys.KeyX = true;
  for (let i = 0; i < 30; i++) {
    rig.updatePhysics(1 / 60, keys, true);
  }
  assert.ok(
    (defaultPiston.pistonExtension ?? 0) > 0.85,
    `Expected default piston to extend on KeyX press, got ${defaultPiston.pistonExtension}`,
  );
  assert.ok(
    (customPiston.pistonExtension ?? 0) < 0.05,
    'Custom KeyG piston should stay retracted when KeyX is pressed',
  );

  // Release KeyX -> default piston must stay extended
  keys.KeyX = false;
  for (let i = 0; i < 15; i++) {
    rig.updatePhysics(1 / 60, keys, true);
  }
  assert.ok(
    (defaultPiston.pistonExtension ?? 0) > 0.9,
    'Default piston must remain extended after releasing KeyX',
  );

  // 2. Press KeyX a SECOND time -> default piston MUST retract back toward 0!
  keys.KeyX = true;
  rig.updatePhysics(1 / 60, keys, true);
  keys.KeyX = false;
  for (let i = 0; i < 45; i++) {
    rig.updatePhysics(1 / 60, keys, true);
  }
  assert.ok(
    (defaultPiston.pistonExtension ?? 0) < 0.1,
    `Expected default piston to retract on second KeyX press, got ${defaultPiston.pistonExtension}`,
  );

  // 3. Same test for custom-bound KeyG piston (even with autoReset: false from older blueprints)
  keys.KeyG = true;
  for (let i = 0; i < 30; i++) {
    rig.updatePhysics(1 / 60, keys, true);
  }
  assert.ok(
    (customPiston.pistonExtension ?? 0) > 0.85,
    `Expected custom KeyG piston to extend on first press, got ${customPiston.pistonExtension}`,
  );
  keys.KeyG = false;
  for (let i = 0; i < 10; i++) {
    rig.updatePhysics(1 / 60, keys, true);
  }
  keys.KeyG = true;
  rig.updatePhysics(1 / 60, keys, true);
  keys.KeyG = false;
  for (let i = 0; i < 45; i++) {
    rig.updatePhysics(1 / 60, keys, true);
  }
  assert.ok(
    (customPiston.pistonExtension ?? 0) < 0.1,
    `Expected custom KeyG piston to retract on second KeyG press, got ${customPiston.pistonExtension}`,
  );

  world.dispose();
});
