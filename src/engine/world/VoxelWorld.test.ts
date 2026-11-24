import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  VoxelWorld,
  encodeChunkId,
  setActiveVoxelWorld,
} from './VoxelWorld';
import { CustomRigidBody } from '../../game/physics/customRigidBody';
import { VoxelDebrisSystem } from '../../game/physics/debris';
import { MicroVoxelChunk } from '../../game/world';

test('VoxelWorld chunk tables: acquire, world/id lookup, get/set/damage voxel, dirty, visibility, release', () => {
  const destroyed: Array<{ x: number; y: number; z: number; mat: number }> = [];
  const vw = new VoxelWorld({
    maxChunks: 4,
    chunkX: 16,
    chunkY: 16,
    chunkZ: 16,
    callbacks: {
      onVoxelDestroyed: (ev) => {
        destroyed.push({ x: ev.worldX, y: ev.worldY, z: ev.worldZ, mat: ev.materialId });
      },
    },
  });

  const cidA = encodeChunkId(0, 0);
  const cidB = encodeChunkId(-1, 2);
  const slotA = vw.acquireChunkSlot(cidA, 0, 0, 0);
  const slotB = vw.acquireChunkSlot(cidB, -16, 0, 32);

  assert.notEqual(slotA, slotB);
  assert.equal(vw.activeChunkCount, 2);
  assert.equal(vw.getChunkSlotById(cidA), slotA);
  assert.equal(vw.getChunkSlotById(cidB), slotB);
  assert.equal(vw.getChunkSlotByWorld(5, 3, 7), slotA);
  assert.equal(vw.getChunkSlotByWorld(-1, 2, 35), slotB);
  assert.equal(vw.getChunkSlotByWorld(999, 0, 999), -1);

  // setVoxel / getVoxel
  assert.equal(vw.chunkPhysicsVersion[slotA], 0);
  vw.setVoxel(5, 3, 7, 12);
  assert.equal(vw.getVoxel(5, 3, 7), 12);
  assert.equal(vw.chunkDirty[slotA], 1);
  assert.equal(vw.chunkPhysicsVersion[slotA], 1);

  // Negative chunk coordinates
  vw.setVoxel(-3, 4, 33, 9);
  assert.equal(vw.getVoxel(-3, 4, 33), 9);

  // forEachDirtyChunk
  const dirtySlots: number[] = [];
  vw.forEachDirtyChunk((slot) => dirtySlots.push(slot));
  assert.deepEqual(dirtySlots.sort(), [slotA, slotB].sort());

  // Visibility + event
  vw.setChunkVisible(slotA, true);
  assert.equal(vw.chunkVisible[slotA], 1);
  const visEvents = vw.drainVisibilityChangedEvents();
  assert.equal(visEvents.length, 1);
  assert.equal(visEvents[0].chunkSlot, slotA);
  assert.equal(visEvents[0].visible, true);

  // damageVoxel reduces HP and triggers destruction at 0
  const hp1 = vw.damageVoxel(5, 3, 7, 100);
  assert.equal(hp1, 155);
  assert.equal(vw.getVoxel(5, 3, 7), 12);
  assert.equal(destroyed.length, 0);

  const hp2 = vw.damageVoxel(5, 3, 7, 200, 'explosion');
  assert.equal(hp2, 0);
  assert.equal(vw.getVoxel(5, 3, 7), 0);
  assert.equal(destroyed.length, 1);
  assert.deepEqual(destroyed[0], { x: 5, y: 3, z: 7, mat: 12 });

  const destroyedEvents = vw.drainVoxelDestroyedEvents();
  assert.equal(destroyedEvents.length, 1);
  assert.equal(destroyedEvents[0].cause, 'explosion');

  // Release & reuse
  vw.releaseChunkSlot(slotA);
  assert.equal(vw.chunkIds[slotA], -1);
  assert.equal(vw.getChunkSlotById(cidA), -1);
  assert.equal(vw.getChunkSlotByWorld(5, 3, 7), -1);
  assert.equal(vw.activeChunkCount, 1);
});

test('VoxelWorld body tables & CustomRigidBody live SoA delegation', () => {
  const sleepLog: Array<{ slot: number; sleeping: boolean }> = [];
  const vw = new VoxelWorld({
    maxBodies: 4,
    callbacks: {
      onBodySleep: (ev) => sleepLog.push({ slot: ev.bodySlot, sleeping: ev.sleeping }),
    },
  });
  setActiveVoxelWorld(vw);

  const bodyA = new CustomRigidBody(vw, 101);
  const bodyB = new CustomRigidBody(vw, 202);

  assert.equal(vw.activeBodyCount, 2);
  assert.equal(vw.getBodySlotById(101), bodyA.slotIndex);
  assert.equal(vw.getBodySlotById(202), bodyB.slotIndex);
  assert.equal(bodyA.position.isVector3, true);
  assert.equal(bodyA.quaternion.isQuaternion, true);
  assert.equal(Object.getPrototypeOf(bodyA.position), THREE.Vector3.prototype);
  assert.equal(Object.getPrototypeOf(bodyA.quaternion), THREE.Quaternion.prototype);
  const xDesc = Object.getOwnPropertyDescriptor(bodyA.position, 'x');
  assert.equal(xDesc?.get, undefined, 'bodyA.position.x must be a plain data property, not an accessor getter');

  // Plain Vector3 mutation + explicit syncToVoxelWorld writes to VoxelWorld typed arrays
  bodyA.position.set(10, 20, 30);
  bodyA.position.x += 2.5;
  bodyA.velocity.set(1, -2, 3);
  bodyA.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.5);
  bodyA.mass = 1500;
  bodyA.invMass = 1 / 1500;
  bodyA.syncToVoxelWorld();

  assert.equal(vw.bodyPositions[bodyA.slotIndex * 3], 12.5);
  assert.equal(vw.bodyPositions[bodyA.slotIndex * 3 + 1], 20);
  assert.equal(vw.bodyPositions[bodyA.slotIndex * 3 + 2], 30);

  // Explicit syncFromVoxelWorld pulls SoA updates back into plain Vector3/Quaternion
  vw.bodyPositions[bodyA.slotIndex * 3] = 42.5;
  bodyA.syncFromVoxelWorld();
  assert.equal(bodyA.position.x, 42.5);
  bodyA.position.x = 12.5;
  bodyA.syncToVoxelWorld();

  // Cloned vector is independent
  const cloned = bodyA.position.clone();
  cloned.x = 999;
  assert.equal(bodyA.position.x, 12.5);

  const qOut = vw.getBodyQuaternion(bodyA.slotIndex);
  assert.ok(Math.abs(qOut.y - Math.SQRT1_2) < 1e-5);
  assert.ok(Math.abs(qOut.w - Math.SQRT1_2) < 1e-5);
  assert.equal(vw.getBodyMass(bodyA.slotIndex), 1500);
  assert.ok(Math.abs(vw.getBodyInvMass(bodyA.slotIndex) - 1 / 1500) < 1e-6);

  // Sleep & forEachAwakeBody
  bodyB.sleep();
  assert.equal(vw.getBodySleeping(bodyB.slotIndex), true);
  assert.equal(sleepLog.length, 1);
  assert.deepEqual(sleepLog[0], { slot: bodyB.slotIndex, sleeping: true });

  const awakeIds: number[] = [];
  vw.forEachAwakeBody((_slot, id) => awakeIds.push(id));
  assert.deepEqual(awakeIds, [101]);

  bodyB.wake();
  assert.equal(vw.getBodySleeping(bodyB.slotIndex), false);
  const sleepEvents = vw.drainBodySleepEvents();
  assert.equal(sleepEvents.length, 2);

  // Dispose releases slot
  bodyA.dispose();
  assert.equal(vw.getBodySlotById(101), -1);
  assert.equal(vw.activeBodyCount, 1);
  bodyB.dispose();
  assert.equal(vw.activeBodyCount, 0);
});

test('VoxelWorld debris tables: spawn, recycle resting first then oldest active, release, and VoxelDebrisSystem delegation', () => {
  const vw = new VoxelWorld({ maxDebris: 3 });

  const s0 = vw.spawnDebris(0, 5, 0, 1, 2, 3, 0xff0000, 0.25, 8.0);
  const s1 = vw.spawnDebris(1, 5, 0, 0, 0, 0, 0x00ff00, 0.25, 8.0);
  const s2 = vw.spawnDebris(2, 5, 0, 0, 0, 0, 0x0000ff, 0.25, 8.0);
  assert.equal(vw.activeDebrisCount, 3);

  // Mark s1 as resting -> spawning a 4th debris must recycle s1 (resting) before s0 (older but flying)
  vw.setDebrisResting(s1, true);
  const activeOnly: number[] = [];
  vw.forEachActiveDebris((slot) => activeOnly.push(slot));
  assert.deepEqual(activeOnly.sort(), [s0, s2].sort());

  const allSlots: number[] = [];
  vw.forEachAllDebris((slot) => allSlots.push(slot));
  assert.deepEqual(allSlots.sort(), [s0, s1, s2].sort());

  const sRecycled = vw.spawnDebris(9, 9, 9, 0, 1, 0, 0xffff00, 0.5, 4.0);
  assert.equal(sRecycled, s1);
  assert.equal(vw.debrisResting[sRecycled], 0);
  assert.equal(vw.debrisPositions[sRecycled * 3], 9);
  assert.equal(vw.debrisSizes[sRecycled], 0.5);

  // Now all 3 are flying -> spawning another recycles oldest active (s0)
  const sRecycled2 = vw.spawnDebris(7, 7, 7, 0, 0, 0, 0x123456);
  assert.equal(sRecycled2, s0);

  vw.releaseDebris(s0);
  assert.equal(vw.activeDebrisCount, 2);

  // VoxelDebrisSystem integration
  const vw2 = new VoxelWorld({ maxDebris: 32 });
  const debrisSys = new VoxelDebrisSystem(null, 8, vw2);
  const p = debrisSys.spawnDebrisVoxel(
    new THREE.Vector3(2, 4, 6),
    new THREE.Vector3(1, 0, 0),
    null,
    0x336699,
  );
  assert.ok(p.slotIndex >= 0);
  assert.equal(vw2.activeDebrisCount, 1);
  assert.equal(vw2.debrisPositions[p.slotIndex * 3], 2);
  assert.equal(vw2.debrisColors[p.slotIndex], 0x336699);

  debrisSys.update(0.1, null, null);
  assert.ok(Math.abs(vw2.debrisPositions[p.slotIndex * 3 + 1] - p.position.y) < 1e-4);

  debrisSys.clearAll();
  assert.equal(vw2.activeDebrisCount, 0);
  debrisSys.dispose();
});

test('VoxelWorld MicroVoxelChunk delegation, event queues, and single world clock', () => {
  const vw = new VoxelWorld({ maxChunks: 16 });
  setActiveVoxelWorld(vw);

  const chunk = new MicroVoxelChunk(2, 3, false, vw);
  assert.equal(vw.getChunkSlotById(chunk.chunkId), chunk.slotIndex);

  chunk.setVoxel(4, 10, 5, 7);
  assert.equal(vw.getVoxel(2 * 64 + 4, 10, 3 * 64 + 5), 7);
  assert.equal(chunk.physicsVersion, 1);

  chunk.dirty = true;
  assert.equal(vw.chunkDirty[chunk.slotIndex], 1);

  chunk.visible = true;
  assert.equal(vw.chunkVisible[chunk.slotIndex], 1);

  // Event queues & drainAllEvents
  const explosionCallbacks: number[] = [];
  vw.callbacks.onExplosion = (ev) => explosionCallbacks.push(ev.force);
  vw.queueExplosion(1, 2, 3, 2.0, 900);
  vw.queueDamage(0, 12345, 50);

  assert.deepEqual(explosionCallbacks, [900]);
  const all = vw.drainAllEvents();
  assert.equal(all.explosionEvents.length, 1);
  assert.equal(all.damageEvents.length, 1);
  assert.equal(all.visibilityChangedEvents.length, 1);
  assert.equal(vw.explosionEvents.length, 0);
  assert.equal(vw.damageEvents.length, 0);

  // Single world clock (60Hz fixedDt)
  assert.ok(Math.abs(vw.fixedDt - 1 / 60) < 1e-9);
  const steps = vw.step(1 / 30);
  assert.equal(steps, 2);
  assert.ok(Math.abs(vw.getTime() - 1 / 30) < 1e-6);

  vw.reset();
  assert.equal(vw.activeChunkCount, 0);
  assert.equal(vw.getTime(), 0);
});

test('Phase 3b: VoxelWorld.step integrates awake visible bodies directly & skips invisible/sleeping bodies', () => {
  const vw = new VoxelWorld({ maxBodies: 8 });
  setActiveVoxelWorld(vw);

  const visibleSlot = vw.acquireBodySlot(10);
  const hiddenSlot = vw.acquireBodySlot(20);
  const sleepingSlot = vw.acquireBodySlot(30);

  vw.setBodyMass(visibleSlot, 10);
  vw.setBodyMass(hiddenSlot, 10);
  vw.setBodyMass(sleepingSlot, 10);
  vw.bodyLinearDamping[visibleSlot] = 0;
  vw.bodyLinearDamping[hiddenSlot] = 0;
  vw.bodyAngularDamping[visibleSlot] = 0;
  vw.bodyInvInertiaLocal[visibleSlot * 3 + 1] = 0.5;

  // Hide hiddenSlot & sleep sleepingSlot
  vw.setBodyVisible(hiddenSlot, false);
  vw.setBodySleeping(sleepingSlot, true);

  let collisionCalls = 0;
  const steps = vw.step(1 / 60, {
    onFixedStep: () => {
      vw.applyBodyForce(visibleSlot, 100, 0, 0); // a = 10 m/s^2
      vw.applyBodyTorque(visibleSlot, 0, 20, 0); // alpha_y = 10 rad/s^2
      vw.applyBodyForce(hiddenSlot, 100, 0, 0);
      // Do not wake sleepingSlot via applyBodyForce (applyBodyForce wakes on non-zero); keep it asleep directly
      vw.bodyForces[sleepingSlot * 3] = 100;
    },
    onResolveCollisions: () => {
      collisionCalls++;
    },
  });

  assert.equal(steps, 1);
  assert.equal(collisionCalls, 1);

  const dt = 1 / 60;
  // Visible awake body integrated: v = 10 * dt, p = v * dt
  assert.ok(Math.abs(vw.bodyVelocities[visibleSlot * 3] - 10 * dt) < 1e-5);
  assert.ok(Math.abs(vw.bodyPositions[visibleSlot * 3] - 10 * dt * dt) < 1e-6);
  // Quaternion rotated around Y from torque
  assert.ok(Math.abs(vw.bodyAngularVelocities[visibleSlot * 3 + 1] - 10 * dt) < 1e-5);
  assert.ok(vw.bodyQuaternions[visibleSlot * 4 + 1] > 0);
  // Forces & torques cleared after integration
  assert.equal(vw.bodyForces[visibleSlot * 3], 0);
  assert.equal(vw.bodyTorques[visibleSlot * 3 + 1], 0);

  // Invisible body was skipped (position and velocity stayed 0)
  assert.equal(vw.bodyPositions[hiddenSlot * 3], 0);
  assert.equal(vw.bodyVelocities[hiddenSlot * 3], 0);

  // Sleeping body was skipped
  assert.equal(vw.bodyPositions[sleepingSlot * 3], 0);
  assert.equal(vw.bodyVelocities[sleepingSlot * 3], 0);

  // Re-enabling visibility resumes physics integration
  vw.setBodyVisible(hiddenSlot, true);
  vw.applyBodyForce(hiddenSlot, 100, 0, 0);
  vw.step(1 / 60);
  assert.ok(vw.bodyVelocities[hiddenSlot * 3] > 0.1);
  assert.ok(vw.bodyPositions[hiddenSlot * 3] > 0);
});

test('Phase 3b: CustomRigidBody.integrateSubstep delegates to VoxelWorld without double-integration & Object3D.updateMatrix reads SoA directly', async () => {
  const { Object3D } = await import('../core/Object3D');
  const vw = new VoxelWorld({ maxBodies: 8 });
  setActiveVoxelWorld(vw);

  const body = new CustomRigidBody(vw, 77);
  body.mass = 20;
  body.invMass = 1 / 20;
  body.linearDamping = 0;
  body.position.set(10, 5, -3);
  vw.setBodyComLocal(body.slotIndex, 1, 0, 0);

  // Bind an Object3D directly to VoxelWorld (zero per-frame JS copy)
  const root = new Object3D();
  root.voxelWorldRef = vw;
  root.voxelBodySlot = body.slotIndex;

  // Step inside VoxelWorld.step where onFixedStep calls body.integrateSubstep (vehicle substep path)
  vw.step(1 / 60, {
    onFixedStep: (stepDt) => {
      body.applyForce(new THREE.Vector3(200, 0, 0)); // a = 10 m/s^2
      body.integrateSubstep(stepDt);
    },
  });

  const dt = 1 / 60;
  const expectedVx = 10 * dt;
  const expectedPx = 10 + expectedVx * dt;
  // Must match single integration (not double-integrated by VoxelWorld.integratePhysics!)
  assert.ok(Math.abs(body.velocity.x - expectedVx) < 1e-5);
  assert.ok(Math.abs(body.position.x - expectedPx) < 1e-5);
  assert.equal(vw.bodyIntegratedThisStep[body.slotIndex], 0);

  // Object3D.updateMatrixWorld() reads VoxelWorld.bodyPositions - rotate(comLocal, quat) directly!
  // Notice root.position is still (0,0,0) — no JS copy needed!
  assert.equal(root.position.x, 0);
  root.updateMatrixWorld(true);
  // Translation column of matrixWorld (elements 12, 13, 14) = bodyPosition - comLocal = (expectedPx - 1, 5, -3)
  assert.ok(Math.abs(root.matrixWorld.elements[12] - (expectedPx - 1)) < 1e-5);
  assert.ok(Math.abs(root.matrixWorld.elements[13] - 5) < 1e-5);
  assert.ok(Math.abs(root.matrixWorld.elements[14] - -3) < 1e-5);

  body.dispose();
});

