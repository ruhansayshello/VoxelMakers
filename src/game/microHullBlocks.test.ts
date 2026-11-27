import test from 'node:test';
import assert from 'node:assert/strict';
import { MAT } from './constants.ts';
import {
  HULL_SCALE_OPTIONS,
  HULL_SHAPE_OPTIONS,
  HULL_STAMP_MODES,
  SYMMETRY_AXIS_OPTIONS,
  DEFAULT_HULL_SCALE_PX,
  MICRO_VOXEL_SUBDIV,
  clampHullScalePx,
  stepHullScalePx,
  toggleHullStampScalePx,
  shouldFillHullShapeVoxel,
  MicroHullLayer,
  computeScaledAnchorOrigin,
  computeScaledHullPlacementCoords,
  computeMicroFaceExtrudeCoords,
  computeGhostDimensionsSummary,
  isCoarseAlignedPlacement,
  microBlockCenterMeters,
} from './microHullBlocks.ts';

test('Pure 1px default car hull scale and Option B 1px Fine / 4px Block stamp toggle', () => {
  assert.equal(DEFAULT_HULL_SCALE_PX, 1);
  assert.equal(HULL_STAMP_MODES.length, 2);
  assert.equal(HULL_STAMP_MODES[0].px, 1);
  assert.equal(HULL_STAMP_MODES[1].px, 4);
  assert.equal(toggleHullStampScalePx(1), 4);
  assert.equal(toggleHullStampScalePx(4), 1);

  assert.equal(HULL_SCALE_OPTIONS[0].px, 1);
  assert.equal(HULL_SCALE_OPTIONS[HULL_SCALE_OPTIONS.length - 1].px, 16);
  assert.equal(HULL_SHAPE_OPTIONS.length, 6);
  assert.equal(SYMMETRY_AXIS_OPTIONS.length, 4);

  assert.equal(clampHullScalePx(0), 1);
  assert.equal(clampHullScalePx(5), 4);
  assert.equal(clampHullScalePx(7), 6);
  assert.equal(clampHullScalePx(99), 16);

  assert.equal(stepHullScalePx(4, -1), 3);
  assert.equal(stepHullScalePx(1, -1), 1);
  assert.equal(stepHullScalePx(4, 1), 6);
  assert.equal(stepHullScalePx(16, 1), 16);
});

test('MicroHullLayer stamps, carves, splits 4px blocks into 1px micro-voxels, meshes, and serializes', () => {
  const layer = new MicroHullLayer();
  assert.equal(layer.size, 0);

  // Stamp a 2x2x2 micro block (8 voxels)
  const stamped = layer.stampMicroCube(10, 12, 14, 2, MAT.ALLOY_BLUE);
  assert.equal(stamped, 8);
  assert.equal(layer.size, 8);
  assert.equal(layer.getMicro(10, 12, 14), MAT.ALLOY_BLUE);
  assert.equal(layer.getMicro(11, 13, 15), MAT.ALLOY_BLUE);

  // Carve a single 1px cell out of it
  const erased = layer.stampMicroCube(10, 12, 14, 1, MAT.AIR);
  assert.equal(erased, 1);
  assert.equal(layer.size, 7);
  assert.equal(layer.getMicro(10, 12, 14), MAT.AIR);

  // Split a 4px coarse block at (2, 1, 3) into 64 1px micro-voxels
  layer.clear();
  layer.splitCoarseVoxelToMicro(2, 1, 3, MAT.ARMOR_SLATE);
  assert.equal(layer.size, MICRO_VOXEL_SUBDIV * MICRO_VOXEL_SUBDIV * MICRO_VOXEL_SUBDIV);
  assert.equal(layer.getMicro(8, 4, 12), MAT.ARMOR_SLATE);
  assert.equal(layer.getMicro(11, 7, 15), MAT.ARMOR_SLATE);

  // Build greedy geometry
  const geo = layer.buildMeshGeometry();
  assert.ok(geo, 'expected non-null BufferGeometry');
  const posAttr = geo.getAttribute('position');
  assert.ok(posAttr.count > 0, 'expected geometry vertices');
  assert.ok(geo.index && geo.index.count >= 36, 'expected at least 12 triangles');
  geo.dispose();

  // Round-trip serialization
  const tuples = layer.exportArray();
  assert.equal(tuples.length, 64);
  const restored = new MicroHullLayer();
  restored.importArray(tuples);
  assert.equal(restored.size, 64);
  assert.equal(restored.getMicro(9, 5, 13), MAT.ARMOR_SLATE);
});

test('shouldFillHullShapeVoxel backward compatibility for legacy shapes', () => {
  const layer = new MicroHullLayer();
  const wedgeCount = layer.stampMicroShape(0, 0, 0, 4, MAT.ALLOY_BLUE, 'WEDGE', 0, 0, 0);
  assert.equal(wedgeCount, 40);
  assert.equal(shouldFillHullShapeVoxel(0, 3, 0, 4, 'WEDGE', 0, 0, 0), true);
  assert.equal(shouldFillHullShapeVoxel(0, 3, 3, 4, 'WEDGE', 0, 0, 0), false);
});

test('computeScaledAnchorOrigin places flush against positive and negative face normals at 1px and 16px', () => {
  // Clicking top face (+Y) of micro cell (48, 24, 72) with 1px scale -> places at y=25
  const top1 = computeScaledAnchorOrigin({ mx: 48, my: 24, mz: 72, normal: { x: 0, y: 1, z: 0 } }, 1);
  assert.deepEqual(top1, { mx: 48, my: 25, mz: 72 });

  // Clicking bottom face (-Y) with 16px mega scale -> places at y = 24 - 16 = 8
  const bot16 = computeScaledAnchorOrigin({ mx: 48, my: 24, mz: 72, normal: { x: 0, y: -1, z: 0 } }, 16);
  assert.equal(bot16.my, 8);

  // Coarse alignment check
  assert.equal(isCoarseAlignedPlacement(48, 24, 72, 4), true);
  assert.equal(isCoarseAlignedPlacement(48, 24, 72, 8), true);
  assert.equal(isCoarseAlignedPlacement(48, 24, 72, 16), true);
  assert.equal(isCoarseAlignedPlacement(49, 24, 72, 4), false);
  assert.equal(isCoarseAlignedPlacement(48, 24, 72, 2), false);

  const center = microBlockCenterMeters(0, 0, 0, 4);
  assert.ok(Math.abs(center.x - 0.125) < 1e-6);
});

test('Option A 1px smart volume brushes: 4x4 Plate (16 1px cells), 8x8 Panel (64 1px cells), BOX_FILL with depth extrusion & carve, and 1px Face Extrude', () => {
  const hitTop = { mx: 40, my: 20, mz: 60, normal: { x: 0, y: 1, z: 0 } };

  // PLATE_3X3 at s=1 stamps a 4x4x1 plate of 1px micro-voxels (16 voxels = 1 classic block face)
  const plate4x4 = computeScaledHullPlacementCoords('PLATE_3X3', hitTop, null, 1, 'OFF');
  assert.equal(plate4x4.length, 16);

  // PLATE_5X5 at s=1 stamps an 8x8x1 panel of 1px micro-voxels (64 voxels = 2x2 block deck)
  const panel8x8 = computeScaledHullPlacementCoords('PLATE_5X5', hitTop, null, 1, 'OFF');
  assert.equal(panel8x8.length, 64);

  // BOX_FILL at s=1 from (40,21,60) to (43,21,63) (4x4 = 16) with boxDepthPx=3 -> 48 1px voxels
  const dragStart = { mx: 40, my: 21, mz: 60 };
  const hitEnd = { mx: 43, my: 20, mz: 63, normal: { x: 0, y: 1, z: 0 } };
  const box3d = computeScaledHullPlacementCoords('BOX_FILL', hitEnd, dragStart, 1, 'OFF', false, 0, 0, 0, 3);
  assert.equal(box3d.length, 48);

  // BOX_FILL carve (isErase=true) with boxDepthPx=2 extrudes inward (-Y) by 2 layers (4x4x2 = 32)
  const dragCarveStart = { mx: 40, my: 20, mz: 60 };
  const boxCarve = computeScaledHullPlacementCoords('BOX_FILL', hitEnd, dragCarveStart, 1, 'OFF', true, 0, 0, 0, 2);
  assert.equal(boxCarve.length, 32);

  // 1px Micro-Face Extrude across a 4x4 1px surface with depthLayers=2 -> 32 extruded 1px cells
  const layer = new MicroHullLayer();
  for (let z = 60; z < 64; z++) {
    for (let x = 40; x < 44; x++) {
      layer.setMicro(x, 20, z, MAT.ALLOY_BLUE);
    }
  }
  const extruded = computeMicroFaceExtrudeCoords(
    hitTop,
    (mx, my, mz) => layer.getMicro(mx, my, mz),
    'OFF',
    2,
  );
  assert.equal(extruded.length, 32);
  assert.ok(extruded.every((b) => b.my === 21 || b.my === 22));
});

test('computeScaledHullPlacementCoords supports CHISEL, multi-axis symmetry (X, Z, XZ), and computeGhostDimensionsSummary', () => {
  const hitTop = { mx: 40, my: 20, mz: 60, normal: { x: 0, y: 1, z: 0 } };

  // SINGLE at 1px with X mirror -> 2 blocks
  const single1MirrorX = computeScaledHullPlacementCoords('SINGLE', hitTop, null, 1, 'X');
  assert.equal(single1MirrorX.length, 2);

  // SINGLE at 1px with Z mirror -> 2 blocks mirrored across Z
  const single1MirrorZ = computeScaledHullPlacementCoords('SINGLE', hitTop, null, 1, 'Z');
  assert.equal(single1MirrorZ.length, 2);
  assert.notEqual(single1MirrorZ[0].mz, single1MirrorZ[1].mz);

  // SINGLE at 1px with XZ 4-way quad symmetry -> 4 blocks
  const single1MirrorXZ = computeScaledHullPlacementCoords('SINGLE', hitTop, null, 1, 'XZ');
  assert.equal(single1MirrorXZ.length, 4);

  // CHISEL targets in-place clicked block (my=20 instead of my=21)
  const chiselCoords = computeScaledHullPlacementCoords('CHISEL', hitTop, null, 2, 'OFF');
  assert.equal(chiselCoords.length, 1);
  assert.equal(chiselCoords[0].my, 20);

  // PLATE_3X3 at 2px without mirror -> 9 blocks spaced by 2px
  const plate3 = computeScaledHullPlacementCoords('PLATE_3X3', hitTop, null, 2, false);
  assert.equal(plate3.length, 9);
  const xs = [...new Set(plate3.map((b) => b.mx))].sort((a, b) => a - b);
  assert.equal(xs.length, 3);
  assert.equal(xs[1] - xs[0], 2);

  // Ghost dimensions & mass summary for 9 blocks at 2px and CHISEL negative mass delta
  const addSummary = computeGhostDimensionsSummary(plate3, 18, false);
  assert.equal(addSummary.dimsLabel, '3×1×3 (2px)');
  assert.equal(addSummary.count, 9);
  assert.ok(addSummary.massDeltaKg > 0);

  const carveSummary = computeGhostDimensionsSummary(chiselCoords, 18, true);
  assert.equal(carveSummary.dimsLabel, '1×1×1 (2px)');
  assert.ok(carveSummary.massDeltaKg < 0);
});


