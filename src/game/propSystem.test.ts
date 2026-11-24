import test from 'node:test';
import assert from 'node:assert/strict';
import { PREBUILT_OBJECTS } from './worldObjects';
import { buildPropTemplateVoxels, type PropTemplateKind } from './voxelEntities';
import { BINDABLE_KEYS, type WorldEditToolKind } from './constants';

test('buildPropTemplateVoxels generates valid voxel coordinates for all starter templates', () => {
  const templates: PropTemplateKind[] = ['BLANK', 'CRATE', 'CONE', 'RAMP', 'BARRIER', 'BARREL'];
  for (const t of templates) {
    const coords = buildPropTemplateVoxels(t);
    assert.ok(coords.length > 0, `Template ${t} should produce voxels`);
    for (const c of coords) {
      assert.ok(Number.isFinite(c.vx), 'vx must be finite');
      assert.ok(Number.isFinite(c.vy), 'vy must be finite');
      assert.ok(Number.isFinite(c.vz), 'vz must be finite');
      assert.ok(c.mat > 0, 'mat must be non-air');
    }
  }
});

test('PREBUILT_OBJECTS includes both stunt structures and physics props', () => {
  const propCone = PREBUILT_OBJECTS.find((p) => p.id === 'prop_traffic_cone');
  const propCrate = PREBUILT_OBJECTS.find((p) => p.id === 'prop_wooden_crate');
  const propBarrel = PREBUILT_OBJECTS.find((p) => p.id === 'prop_c4_barrel');
  const propBarrier = PREBUILT_OBJECTS.find((p) => p.id === 'prop_jersey_barrier');
  const ramp = PREBUILT_OBJECTS.find((p) => p.id === 'prebuilt_mega_ramp');

  assert.ok(propCone, 'Traffic Cone prop should exist in prebuilts');
  assert.ok(propCrate, 'Wooden Crate prop should exist in prebuilts');
  assert.ok(propBarrel, 'C4 Barrel prop should exist in prebuilts');
  assert.ok(propBarrier, 'Jersey Barrier prop should exist in prebuilts');
  assert.ok(ramp, 'Mega Ramp should exist in prebuilts');

  assert.equal(propCone.sizeY, 5);
  assert.equal(propCrate.sizeY, 4);
  assert.equal(propBarrel.sizeY, 5);
  assert.equal(propBarrier.sizeX, 6);
});

test('Freed vehicle keys are available in BINDABLE_KEYS', () => {
  const codes = new Set(BINDABLE_KEYS.map((k) => k.code));
  assert.ok(codes.has('KeyG'), 'KeyG must be bindable for vehicles');
  assert.ok(codes.has('KeyJ'), 'KeyJ must be bindable for vehicles');
  assert.ok(codes.has('KeyK'), 'KeyK must be bindable for vehicles');
  assert.ok(codes.has('KeyL'), 'KeyL must be bindable for vehicles');
  assert.ok(codes.has('KeyN'), 'KeyN must be bindable for vehicles');
});

test('R-key tap vs hold logic resolves correctly', () => {
  // Pure logic helper for R-key behavior
  function evaluateRKeyAction(holdDurationMs: number, isKeyUp: boolean): 'CALL_UPRIGHT' | 'REPAIR' | 'HOLDING' {
    if (holdDurationMs >= 500) {
      return 'REPAIR';
    }
    if (isKeyUp && holdDurationMs < 500) {
      return 'CALL_UPRIGHT';
    }
    return 'HOLDING';
  }

  // Tap released after 120ms: calls vehicle upright without repairing
  assert.equal(evaluateRKeyAction(120, true), 'CALL_UPRIGHT');
  // Tap released after 350ms: calls vehicle upright without repairing
  assert.equal(evaluateRKeyAction(350, true), 'CALL_UPRIGHT');
  // Held at 200ms without release: still holding
  assert.equal(evaluateRKeyAction(200, false), 'HOLDING');
  // Held reached 500ms: triggers full vehicle repair
  assert.equal(evaluateRKeyAction(500, false), 'REPAIR');
  // Held reached 750ms: triggers full vehicle repair
  assert.equal(evaluateRKeyAction(750, false), 'REPAIR');
});
