import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoxelWorld,
  encodeChunkId,
  setActiveVoxelWorld,
} from './VoxelWorld';
import { Object3D } from '../core/Object3D';

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

  assert.equal(vw.chunkPhysicsVersion[slotA], 0);
  vw.setVoxel(5, 3, 7, 12);
  assert.equal(vw.getVoxel(5, 3, 7), 12);
  assert.equal(vw.chunkDirty[slotA], 1);
  assert.equal(vw.chunkPhysicsVersion[slotA], 1);

  vw.setVoxel(-3, 4, 33, 9);
  assert.equal(vw.getVoxel(-3, 4, 33), 9);

  const dirtySlots: number[] = [];
  vw.forEachDirtyChunk((slot) => dirtySlots.push(slot));
  assert.deepEqual(dirtySlots.sort(), [slotA, slotB].sort());

  vw.setChunkVisible(slotA, true);
  assert.equal(vw.chunkVisible[slotA], 1);
  const visEvents = vw.drainVisibilityChangedEvents();
  assert.equal(visEvents.length, 1);
  assert.equal(visEvents[0].chunkSlot, slotA);
  assert.equal(visEvents[0].visible, true);

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

  vw.releaseChunkSlot(slotA);
  assert.equal(vw.chunkIds[slotA], -1);
  assert.equal(vw.getChunkSlotById(cidA), -1);
  assert.equal(vw.getChunkSlotByWorld(5, 3, 7), -1);
  assert.equal(vw.activeChunkCount, 1);
});

test('VoxelWorld debris tables: spawn, recycle resting first then oldest active, and release', () => {
  const vw = new VoxelWorld({ maxDebris: 3 });

  const s0 = vw.spawnDebris(0, 5, 0, 1, 2, 3, 0xff0000, 0.25, 8.0);
  const s1 = vw.spawnDebris(1, 5, 0, 0, 0, 0, 0x00ff00, 0.25, 8.0);
  const s2 = vw.spawnDebris(2, 5, 0, 0, 0, 0, 0x0000ff, 0.25, 8.0);
  assert.equal(vw.activeDebrisCount, 3);

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

  const sRecycled2 = vw.spawnDebris(7, 7, 7, 0, 0, 0, 0x123456);
  assert.equal(sRecycled2, s0);

  vw.releaseDebris(s0);
  assert.equal(vw.activeDebrisCount, 2);
});

test('VoxelWorld event queues, fixed-dt clock, and Object3D SoA transform binding', () => {
  const vw = new VoxelWorld({ maxBodies: 8 });
  setActiveVoxelWorld(vw);

  const explosionCallbacks: number[] = [];
  vw.callbacks.onExplosion = (ev) => explosionCallbacks.push(ev.force);
  vw.queueExplosion(1, 2, 3, 2.0, 900);
  vw.queueDamage(0, 12345, 50);

  assert.deepEqual(explosionCallbacks, [900]);
  const all = vw.drainAllEvents();
  assert.equal(all.explosionEvents.length, 1);
  assert.equal(all.damageEvents.length, 1);
  assert.equal(vw.explosionEvents.length, 0);

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
  vw.setBodyComLocal(visibleSlot, 1, 0, 0);

  vw.setBodyVisible(hiddenSlot, false);
  vw.setBodySleeping(sleepingSlot, true);

  let collisionCalls = 0;
  const steps = vw.step(1 / 60, {
    onFixedStep: () => {
      vw.applyBodyForce(visibleSlot, 100, 0, 0);
      vw.applyBodyTorque(visibleSlot, 0, 20, 0);
      vw.applyBodyForce(hiddenSlot, 100, 0, 0);
      vw.bodyForces[sleepingSlot * 3] = 100;
    },
    onResolveCollisions: () => {
      collisionCalls++;
    },
  });

  assert.equal(steps, 1);
  assert.equal(collisionCalls, 1);

  const dt = 1 / 60;
  assert.ok(Math.abs(vw.bodyVelocities[visibleSlot * 3] - 10 * dt) < 1e-5);
  assert.ok(Math.abs(vw.bodyPositions[visibleSlot * 3] - 10 * dt * dt) < 1e-6);
  assert.equal(vw.bodyPositions[hiddenSlot * 3], 0);
  assert.equal(vw.bodyPositions[sleepingSlot * 3], 0);

  const root = new Object3D();
  root.voxelWorldRef = vw;
  root.voxelBodySlot = visibleSlot;
  root.updateMatrixWorld(true);
  assert.ok(Math.abs(root.matrixWorld.elements[12] - (10 * dt * dt - 1)) < 1e-3);

  vw.reset();
  assert.equal(vw.activeChunkCount, 0);
  assert.equal(vw.getTime(), 0);
});
