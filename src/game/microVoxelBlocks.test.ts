import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carveMicroVoxelModule,
  createMicroVoxelDamageState,
  disposeMicroVoxelDamageState,
  getMicroVoxelBlockTemplate,
  getMicroVoxelTemplateStats,
  type MicroVoxelBlockKind,
} from './microVoxelBlocks.ts';
import { MICRO_VOXEL_SIZE } from './microVoxelMesh.ts';

test('microVoxelBlocks: templates build valid 1px greedy geometry with shared primitive flag and layered inner cores', () => {
  const kinds: MicroVoxelBlockKind[] = [
    'V8_ENGINE',
    'ENGINE_BULLDAWG',
    'ENGINE_DRAGON',
    'HEADLIGHT',
    'THRUSTER',
    'PLASMA_CANNON',
    'COCKPIT',
    'SEAT_KART',
  ];

  for (const kind of kinds) {
    const tpl = getMicroVoxelBlockTemplate(kind);
    const stats = getMicroVoxelTemplateStats(kind);
    assert.ok(tpl.totalVoxels > 20, `${kind} should have >20 solid 1px micro-voxels`);
    assert.equal(tpl.intactGeometry.userData.isSharedPrimitive, true);
    assert.ok(tpl.intactGeometry.getAttribute('color'), `${kind} should bake vertex colors`);
    assert.ok(stats.triangleCount > 12, `${kind} should produce greedy triangles`);
    // Greedy compression should keep triangles well below unmerged naive 12 triangles/voxel
    assert.ok(
      stats.triangleCount < stats.totalVoxels * 4,
      `${kind} greedy triangles (${stats.triangleCount}) should be well compressed vs ${stats.totalVoxels} voxels`,
    );
  }

  // V8 Engine, Thruster, and Plasma Cannon must contain hidden inner core/piston micro-voxels
  assert.equal(getMicroVoxelTemplateStats('V8_ENGINE').hasInnerCoreVoxels, true);
  assert.equal(getMicroVoxelTemplateStats('THRUSTER').hasInnerCoreVoxels, true);
  assert.equal(getMicroVoxelTemplateStats('PLASMA_CANNON').hasInnerCoreVoxels, true);
  assert.equal(MICRO_VOXEL_SIZE, 0.0625);
});

test('microVoxelBlocks: Copy-on-Write keeps grid null until first hit, then carves 1px chips, degrades integrity, and disposes cleanly', () => {
  const state = createMicroVoxelDamageState('V8_ENGINE');
  assert.equal(state.grid, null, 'Intact CoW state must allocate 0 bytes for grid before first hit');
  assert.equal(state.damagedGeometry, null);
  assert.equal(state.integrity, 1.0);
  assert.equal(state.totalVoxels, state.remainingVoxels);

  // Hit outer side of the V8 engine block
  const hit1 = carveMicroVoxelModule(state, 0.25, 0.15, 0.0, 0.24, { maxChips: 16 });
  assert.ok(state.grid !== null, 'First hit must clone CoW grid');
  assert.ok(hit1.carvedCount > 0, 'Hit should remove 1px micro-voxels');
  assert.ok(hit1.chips.length > 0 && hit1.chips.length <= 16, 'Hit should emit bounded 1px chips');
  assert.ok(hit1.integrity < 1.0 && hit1.integrity > 0.2, `Expected partial integrity, got ${hit1.integrity}`);
  assert.equal(hit1.destroyed, false, 'Glancing side hit should chip V8 engine without obliterating it');
  assert.ok(hit1.geometry !== null, 'Damaged module should return newly greedy-meshed geometry');
  assert.equal(hit1.geometry?.userData.isSharedPrimitive, false);
  assert.equal(state.damagedGeometry, hit1.geometry);

  // Verify chip colors are valid hex RGB values
  for (const chip of hit1.chips) {
    assert.ok(chip.color >= 0 && chip.color <= 0xffffff);
  }

  // Coarse Pentium carving mode respects coarseStep and smaller chip budget
  const hit2 = carveMicroVoxelModule(state, -0.22, 0.12, 0.05, 0.26, {
    maxChips: 6,
    coarseStep: true,
  });
  assert.ok(hit2.carvedCount > 0);
  assert.ok(hit2.chips.length <= 6);
  assert.ok(hit2.integrity < hit1.integrity);

  // Massive direct blast destroys the module
  const obliterate = carveMicroVoxelModule(state, 0, 0, 0, 1.2, { maxChips: 12 });
  assert.equal(obliterate.destroyed, true);
  assert.ok(obliterate.integrity < 0.26);

  // Clean disposal frees damaged geometry & CoW grid
  disposeMicroVoxelDamageState(state);
  assert.equal(state.damagedGeometry, null);
  assert.equal(state.grid, null);
});

test('microVoxelBlocks Part 3: all mechanical/aero/marine/weapon modules and 1px wheel assemblies build and chip cleanly', async () => {
  const mod = await import('./microVoxelBlocks.ts');
  const part3Kinds: MicroVoxelBlockKind[] = [
    'AERO_WING',
    'SPOILER',
    'BOAT_OUTBOARD',
    'PROP_AERO',
    'WEAPON_MINIGUN',
    'WEAPON_ROCKET',
    'TANK_TREAD',
    'GYRO',
    'PISTON',
    'GRAPPLING_WINCH',
    'SUSPENSION',
    'STEERING_HINGE',
    'PONTOON_LARGE',
    'BCD_TANK',
    'WEIGHT_BLOCK',
    'SENSOR_DISTANCE',
  ];

  for (const kind of part3Kinds) {
    assert.equal(mod.isMicroVoxelDestructibleKind(kind), true, `${kind} should be destructible`);
    const tpl = mod.getMicroVoxelBlockTemplate(kind);
    assert.ok(tpl.totalVoxels > 20, `${kind} should have rich 1px detail`);
    assert.equal(tpl.intactGeometry.userData.isSharedPrimitive, true);
  }

  // CoW chipping on a Part 3 module (WEAPON_MINIGUN)
  const wState = mod.createMicroVoxelDamageState('WEAPON_MINIGUN');
  const wHit = mod.carveMicroVoxelModule(wState, 0.1, 0.08, 0.1, 0.22, { maxChips: 10 });
  assert.ok(wHit.carvedCount > 0, 'Part 3 weapon should chip into 1px voxels');
  assert.ok(wHit.integrity < 1.0);
  mod.disposeMicroVoxelDamageState(wState);

  // 1px wheel roll geometry caches shared primitive BufferGeometry with baked vertex colors
  const wheelGeo = mod.getMicroVoxelWheelRollGeometry('WHEEL_MONSTER', 0.52, 0.34, 0xfacc15, false);
  assert.equal(wheelGeo.userData.isSharedPrimitive, true);
  assert.ok(wheelGeo.getAttribute('position').count > 100);
  assert.ok(wheelGeo.getAttribute('color').count > 100);
  // Cached instance returns identical BufferGeometry reference
  assert.equal(mod.getMicroVoxelWheelRollGeometry('WHEEL_MONSTER', 0.52, 0.34, 0xfacc15, false), wheelGeo);
});

