import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld, setActiveVoxelWorld } from '../engine/world/VoxelWorld';
import { Object3D } from '../engine/core/Object3D';
import { CustomRigidBody } from './physics/customRigidBody';
import { VoxelDebrisSystem } from './physics/debris';
import { MicroVoxelChunk } from './world';

test('VoxelMakers integration: CustomRigidBody, VoxelDebrisSystem, and MicroVoxelChunk delegate to Voxl VoxelWorld SoA', () => {
  const sleepLog: Array<{ slot: number; sleeping: boolean }> = [];
  const vw = new VoxelWorld({
    maxChunks: 16,
    maxBodies: 8,
    maxDebris: 32,
    callbacks: {
      onBodySleep: (ev) => sleepLog.push({ slot: ev.bodySlot, sleeping: ev.sleeping }),
    },
  });
  setActiveVoxelWorld(vw);

  const bodyA = new CustomRigidBody(vw, 101);
  const bodyB = new CustomRigidBody(vw, 202);
  assert.equal(vw.activeBodyCount, 2);
  bodyA.position.set(10, 20, 30);
  bodyA.mass = 1500;
  bodyA.invMass = 1 / 1500;
  bodyA.syncToVoxelWorld();
  assert.equal(vw.bodyPositions[bodyA.slotIndex * 3], 10);

  bodyB.sleep();
  assert.equal(sleepLog.length, 1);
  bodyB.wake();

  const root = new Object3D();
  root.voxelWorldRef = vw;
  root.voxelBodySlot = bodyA.slotIndex;
  root.updateMatrixWorld(true);
  assert.ok(Math.abs(root.matrixWorld.elements[12] - 10) < 1e-4);

  const chunk = new MicroVoxelChunk(2, 3, false, vw);
  chunk.setVoxel(4, 10, 5, 7);
  assert.equal(vw.getVoxel(2 * 64 + 4, 10, 3 * 64 + 5), 7);

  const debrisSys = new VoxelDebrisSystem(null, 8, vw);
  const p = debrisSys.spawnDebrisVoxel(
    new THREE.Vector3(2, 4, 6),
    new THREE.Vector3(1, 0, 0),
    null,
    0x336699,
  );
  assert.ok(p.slotIndex >= 0);
  assert.equal(vw.activeDebrisCount, 1);

  debrisSys.clearAll();
  debrisSys.dispose();
  bodyA.dispose();
  bodyB.dispose();
});
