import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIG_SECTOR_SIZE_METERS,
  computeBigCameraRelativeScaledOffset,
  computeDynamicLodPlan,
  computeNestedRingBoxes,
  computeNestedRingBoxesBigInt,
  computeOpticalZoomTargetPoint,
  computeZoomedLod0BoxBigInt,
  createBigSectorPosition,
  doesTileContainChunk,
  enumerateRingTiles,
  enumerateRingTilesBigInt,
  formatHorizonDistance,
  formatHorizonDistanceBigInt,
  isChunkInsideBox,
  MAX_LOD_SPACING,
  MAX_RENDER_DISTANCE_CHUNKS,
  MAX_RENDER_DISTANCE_CHUNKS_BIGINT,
  MAX_RENDER_DISTANCE_KM_BIGINT,
  MIN_LOD_SPACING,
  MIN_RENDER_DISTANCE_CHUNKS,
  parseRenderDistanceInputToChunksBigInt,
  resolveRingScaleBand,
  sanitizeLodSpacing,
  sanitizePositiveRenderDistance,
  sanitizePositiveRenderDistanceBigInt,
  SCALE_BAND_FAR,
} from './distantHorizonMath.ts';
import {
  evaluateIntegerHashedHorizonColumn,
  hashBigInt2D,
  sampleIntegerFbm2D,
} from './integerNoise.ts';
import {
  getVoxelDrawDistanceBigInt,
  GRAPHICS_PRESETS,
  sanitizeGraphicsSettings,
} from './graphicsSettings.ts';
import { buildHorizonTilePayload, type ModifiedChunkSurfaceStamp } from './meshWorker.ts';
import { MAT, WATER_LEVEL } from './constants.ts';

describe('Distant Horizons Dynamic Mega-Tile LOD Math', () => {
  it('sanitizes positive-only render distance and rejects negative, zero, and NaN inputs', () => {
    assert.equal(sanitizePositiveRenderDistance(-10, 12), 12);
    assert.equal(sanitizePositiveRenderDistance(0, 12), 12);
    assert.equal(sanitizePositiveRenderDistance('-50', 8), 8);
    assert.equal(sanitizePositiveRenderDistance('abc', 8), 8);
    assert.equal(sanitizePositiveRenderDistance(Number.NaN, 10), 10);
    assert.equal(sanitizePositiveRenderDistance(1, 10), MIN_RENDER_DISTANCE_CHUNKS);
    assert.equal(sanitizePositiveRenderDistance(32, 10), 32);
    assert.equal(sanitizePositiveRenderDistance('128', 10), 128);
    assert.equal(sanitizePositiveRenderDistance('62500', 10), 62500);
    assert.equal(
      sanitizePositiveRenderDistance(999999, 10),
      MAX_RENDER_DISTANCE_CHUNKS,
    );
  });

  it('formats horizon distances cleanly across meters and kilometers up to 1,000 km', () => {
    assert.equal(formatHorizonDistance(256), '256m');
    assert.equal(formatHorizonDistance(1024), '1.02 km');
    assert.equal(formatHorizonDistance(8192), '8.19 km');
    assert.equal(formatHorizonDistance(100_000), '100 km');
    assert.equal(formatHorizonDistance(1_000_000), '1,000 km');
  });

  it('sanitizes lodSpacing strictly within [0.5, 2.5]', () => {
    assert.equal(sanitizeLodSpacing(0.1), MIN_LOD_SPACING);
    assert.equal(sanitizeLodSpacing(9.9), MAX_LOD_SPACING);
    assert.equal(sanitizeLodSpacing(1.5), 1.5);
    assert.equal(sanitizeLodSpacing(Number.NaN, 1.25), 1.25);
  });

  it('dynamically spawns more outer mega-tile rings as render distance increases up to 1,000 km (LOD15)', () => {
    const planSmall = computeDynamicLodPlan({ renderDistanceChunks: 3 });
    const planMed = computeDynamicLodPlan({ renderDistanceChunks: 12 });
    const planLarge = computeDynamicLodPlan({ renderDistanceChunks: 64 });
    const planUltra = computeDynamicLodPlan({ renderDistanceChunks: 256 });
    const plan1000km = computeDynamicLodPlan({ renderDistanceChunks: 62500 });

    assert.equal(planSmall.rings.length, 0);
    assert.ok(planMed.rings.length >= 2, '12 chunks should spawn multiple LOD rings');
    assert.ok(
      planLarge.rings.length > planMed.rings.length,
      '64 chunks should spawn more rings than 12 chunks',
    );
    assert.ok(
      planUltra.rings.length > planLarge.rings.length,
      '256 chunks should spawn even more outer rings',
    );
    assert.ok(
      plan1000km.rings.length >= 13 && plan1000km.rings.length <= 15,
      `62,500 chunks (1,000 km) should spawn 13..15 mega-tile rings at 1.0x spacing, got ${plan1000km.rings.length}`,
    );
    assert.equal(
      plan1000km.rings[plan1000km.rings.length - 1].outerRadiusChunks,
      62500,
    );
    const plan1000kmTight = computeDynamicLodPlan({
      renderDistanceChunks: 62500,
      lodSpacing: 0.5,
    });
    assert.ok(
      plan1000kmTight.rings.length >= 14 && plan1000kmTight.rings.length <= 15,
      `62,500 chunks at 0.5x tight spacing should utilize 14..15 rings, got ${plan1000kmTight.rings.length}`,
    );
    assert.equal(
      plan1000kmTight.rings[plan1000kmTight.rings.length - 1].outerRadiusChunks,
      62500,
    );
    assert.equal(plan1000km.totalLodLayers, 1 + plan1000km.rings.length);
    assert.ok(planUltra.cameraFar > 8000);
    assert.ok(planUltra.skyDomeScale > 15);
    assert.ok(plan1000km.activeScaleBands >= 2, '1,000 km horizon activates Scale-Space Multi-Pass bands');
    assert.ok(
      plan1000km.cameraFar <= SCALE_BAND_FAR && plan1000km.cameraFar >= 32_000,
      `Band-0 cameraFar stays tight (<= ${SCALE_BAND_FAR}) for full 24-bit depth precision, got ${plan1000km.cameraFar}`,
    );
    assert.ok(plan1000km.skyDomeScale <= 40, 'skyDomeScale stays compact (<= 40x) to prevent Float32 sky wobble');
    // Crisp LOD0 real-chunk radius stays bounded even at 62,500 chunks so RAM never explodes
    assert.ok(plan1000km.realChunkRadiusChunks <= 8);

    // Verify O(log R) mega-tile budget at full 1,000 km (62,500 chunk radius = ~15.6 billion real chunks!)
    const nested1000 = computeNestedRingBoxes(0, 0, plan1000km);
    let totalTiles1000 = 0;
    for (let i = 0; i < plan1000km.rings.length; i++) {
      const inner = i === 0 ? nested1000.lod0Box : nested1000.ringOuterBoxes[i - 1];
      const outer = nested1000.ringOuterBoxes[i];
      totalTiles1000 += enumerateRingTiles(plan1000km.rings[i], inner, outer).length;
    }
    assert.ok(
      totalTiles1000 > 150 && totalTiles1000 < 1000,
      `1,000 km horizon must stay O(log R) compact (< 1000 mega-tiles), got ${totalTiles1000}`,
    );
  });

  it('scales both LOD0 crisp bubble and outer ring radii upward when lodSpacing increases', () => {
    const tight = computeDynamicLodPlan({
      renderDistanceChunks: 64,
      lodSpacing: 0.6,
    });
    const wide = computeDynamicLodPlan({
      renderDistanceChunks: 64,
      lodSpacing: 2.2,
    });

    assert.ok(wide.realChunkRadiusChunks > tight.realChunkRadiusChunks);
    assert.ok(wide.rings[0].outerRadiusChunks > tight.rings[0].outerRadiusChunks);
  });

  it('produces 100% watertight, zero-overlap, zero-gap nested ring boxes across every chunk', () => {
    const plan = computeDynamicLodPlan({
      renderDistanceChunks: 48,
      lodSpacing: 1.0,
    });
    const nested = computeNestedRingBoxes(5, -3, plan);

    assert.equal(nested.ringOuterBoxes.length, plan.rings.length);

    // Collect every chunk covered by LOD0 or any mega-tile ring inside the outermost box
    const outermost = nested.ringOuterBoxes[nested.ringOuterBoxes.length - 1];
    const coverageCount = new Map<string, number>();

    // Mark LOD0 real chunks
    for (let cz = nested.lod0Box.minCZ; cz < nested.lod0Box.maxCZExcl; cz++) {
      for (let cx = nested.lod0Box.minCX; cx < nested.lod0Box.maxCXExcl; cx++) {
        const k = `${cx},${cz}`;
        coverageCount.set(k, (coverageCount.get(k) || 0) + 1);
      }
    }

    // Mark all mega-tile rings
    let totalTiles = 0;
    for (let i = 0; i < plan.rings.length; i++) {
      const inner = i === 0 ? nested.lod0Box : nested.ringOuterBoxes[i - 1];
      const outer = nested.ringOuterBoxes[i];
      const tiles = enumerateRingTiles(plan.rings[i], inner, outer);
      totalTiles += tiles.length;
      for (const tile of tiles) {
        for (let cz = tile.minCZ; cz < tile.maxCZExcl; cz++) {
          for (let cx = tile.minCX; cx < tile.maxCXExcl; cx++) {
            const k = `${cx},${cz}`;
            coverageCount.set(k, (coverageCount.get(k) || 0) + 1);
          }
        }
      }
    }

    // Verify EVERY single chunk inside outermost is covered EXACTLY ONCE (no gaps, no overlaps!)
    for (let cz = outermost.minCZ; cz < outermost.maxCZExcl; cz++) {
      for (let cx = outermost.minCX; cx < outermost.maxCXExcl; cx++) {
        const count = coverageCount.get(`${cx},${cz}`) || 0;
        assert.equal(
          count,
          1,
          `Chunk (${cx},${cz}) expected coverage 1, got ${count}`,
        );
      }
    }

    // Verify O(log R) tile efficiency: 48-chunk radius (~9,200 real chunks) covered by < 400 mega-tiles!
    assert.ok(
      totalTiles > 10 && totalTiles < 400,
      `Expected compact mega-tile count, got ${totalTiles}`,
    );
  });

  it('disables horizon rings cleanly when supportsHorizonTiles is false (custom GLB/heightmap worlds)', () => {
    const plan = computeDynamicLodPlan({
      renderDistanceChunks: 32,
      supportsHorizonTiles: false,
    });
    assert.equal(plan.rings.length, 0);
    assert.equal(plan.totalLodLayers, 1);
    const nested = computeNestedRingBoxes(4, 4, plan);
    assert.equal(nested.ringOuterBoxes.length, 0);
    assert.equal(isChunkInsideBox(4, 4, nested.lod0Box), true);
  });

  it('builds tile-local horizon mega-tile meshes with 64-bit origin, exact 0.25m ocean elevation, and overlays modified chunk stamps', () => {
    // 1. Build a baseline LOD2 mega-tile (4x4 chunks = 64m x 64m)
    const baseRes = buildHorizonTilePayload({
      type: 'horizonTile',
      jobId: 1,
      tileKey: '2:1,1',
      level: 2,
      tx: 1,
      tz: 1,
      tileChunks: 4,
      stepVoxels: 4,
      worldGenMode: 'DEFAULT_PARK',
      flatBaseplateMat: MAT.CONCRETE,
    });

    assert.equal(baseRes.type, 'horizonTile');
    assert.ok(Number.isFinite(baseRes.originX) && Number.isFinite(baseRes.originZ));
    assert.ok(baseRes.opaque && baseRes.opaque.vertCount > 0 && baseRes.opaque.positions, 'Opaque terrain mesh should be non-empty');

    // Verify vertices are tile-local in [0 .. tileWorldMeters] (64m) for Float32 precision at 1,000 km!
    for (let i = 0; i < baseRes.opaque.positions.length; i += 3) {
      const lx = baseRes.opaque.positions[i];
      const lz = baseRes.opaque.positions[i + 2];
      assert.ok(lx >= -0.01 && lx <= 64.01, `Tile-local X=${lx} must stay in [0..64]`);
      assert.ok(lz >= -0.01 && lz <= 64.01, `Tile-local Z=${lz} must stay in [0..64]`);
    }

    // If ocean water is present on the tile, its Y coordinate must sit near WATER_LEVEL (14.25m), NOT scaled by stepMeters!
    if (baseRes.water && baseRes.water.positions && baseRes.water.vertCount > 0) {
      for (let i = 1; i < baseRes.water.positions.length; i += 3) {
        const wy = baseRes.water.positions[i];
        assert.ok(
          Math.abs(wy - WATER_LEVEL) <= 0.5,
          `Water vertex Y=${wy} should stay at ~${WATER_LEVEL}m sea level`,
        );
      }
    }

    // 2. Apply a ModifiedChunkSurfaceStamp raising a tall concrete tower in chunk (4, 4) inside tile (2:1,1)
    assert.equal(
      doesTileContainChunk({ minCX: 4, maxCXExcl: 8, minCZ: 4, maxCZExcl: 8 }, 4, 4),
      true,
    );
    const towerHeights = new Uint16Array(256).fill(140); // 140 * 0.25 = 35m tall tower!
    const towerMats = new Uint8Array(256).fill(MAT.STEEL);
    const stamp: ModifiedChunkSurfaceStamp = {
      cx: 4,
      cz: 4,
      heights16: towerHeights,
      mats16: towerMats,
      version: 1,
    };

    const stampedRes = buildHorizonTilePayload({
      type: 'horizonTile',
      jobId: 2,
      tileKey: '2:1,1',
      level: 2,
      tx: 1,
      tz: 1,
      tileChunks: 4,
      stepVoxels: 4,
      worldGenMode: 'DEFAULT_PARK',
      flatBaseplateMat: MAT.CONCRETE,
      stamps: [stamp],
    });

    assert.ok(stampedRes.opaque && stampedRes.opaque.positions);
    let maxY = 0;
    for (let i = 1; i < stampedRes.opaque.positions.length; i += 3) {
      if (stampedRes.opaque.positions[i] > maxY) {
        maxY = stampedRes.opaque.positions[i];
      }
    }
    assert.ok(
      maxY >= 34.5,
      `Stamped tower should raise distant mega-tile maxY to >= 34.5m, got ${maxY}`,
    );

    // 3. Build an ultra-far LOD12 mega-tile (4,096 chunks = 65.536 km wide, positioned > 500 km out!)
    const ultraFarRes = buildHorizonTilePayload({
      type: 'horizonTile',
      jobId: 3,
      tileKey: '12:8,8',
      level: 12,
      tx: 8,
      tz: 8,
      tileChunks: 4096,
      stepVoxels: 4096,
      worldGenMode: 'DEFAULT_PARK',
      flatBaseplateMat: MAT.CONCRETE,
    });
    assert.ok(ultraFarRes.originX > 400_000, `LOD12 tile originX should exceed 400 km, got ${ultraFarRes.originX}`);
    assert.ok(ultraFarRes.opaque && ultraFarRes.opaque.vertCount > 0, 'LOD12 macro peak-sampled mega-tile should produce valid geometry');
  });

  it('uses highp float precision, logdepthbuf, 64-bit RTE, and planet curvature in Potato/Cartoon shaders for 1,000 km stability', async () => {
    const {
      POTATO_VERTEX_SHADER,
      POTATO_FRAGMENT_SHADER,
      CARTOON_FRAGMENT_SHADER,
      CARTOON_OUTLINE_VERTEX_SHADER,
      CARTOON_OUTLINE_FRAGMENT_SHADER,
    } = await import('./potatoShader.ts');

    assert.ok(POTATO_VERTEX_SHADER.includes('#include <logdepthbuf_pars_vertex>'));
    assert.ok(POTATO_VERTEX_SHADER.includes('#include <logdepthbuf_vertex>'));
    assert.ok(POTATO_VERTEX_SHADER.includes('modelViewMatrix * localPos4'), 'POTATO_VERTEX_SHADER must use RTE modelViewMatrix directly');
    assert.ok(POTATO_VERTEX_SHADER.includes('uPlanetCurvatureInv2R'), 'POTATO_VERTEX_SHADER must support planetary horizon curvature');
    assert.ok(!POTATO_FRAGMENT_SHADER.includes('precision lowp float'));
    assert.ok(POTATO_FRAGMENT_SHADER.includes('precision highp float'));
    assert.ok(POTATO_FRAGMENT_SHADER.includes('#include <logdepthbuf_pars_fragment>'));
    assert.ok(POTATO_FRAGMENT_SHADER.includes('#include <logdepthbuf_fragment>'));

    assert.ok(!CARTOON_FRAGMENT_SHADER.includes('precision mediump float'));
    assert.ok(CARTOON_FRAGMENT_SHADER.includes('precision highp float'));
    assert.ok(CARTOON_FRAGMENT_SHADER.includes('#include <logdepthbuf_pars_fragment>'));
    assert.ok(CARTOON_FRAGMENT_SHADER.includes('#include <logdepthbuf_fragment>'));

    assert.ok(CARTOON_OUTLINE_VERTEX_SHADER.includes('#include <logdepthbuf_vertex>'));
    assert.ok(CARTOON_OUTLINE_VERTEX_SHADER.includes('uPlanetCurvatureInv2R'));
    assert.ok(CARTOON_OUTLINE_FRAGMENT_SHADER.includes('#include <logdepthbuf_fragment>'));

    const plan512 = computeDynamicLodPlan({ renderDistanceChunks: 512 });
    assert.ok(plan512.cameraFar <= 18000 && plan512.cameraFar >= 12000);
    assert.ok(plan512.rings.length >= 6);
  });

  it('parses, clamps, and formats BigInt render distances up to 10000000000000000000000000000001 km (10^31 + 1 km)', () => {
    const maxKmStr = '10000000000000000000000000000001 km';
    const parsedMax = parseRenderDistanceInputToChunksBigInt(maxKmStr);
    assert.equal(parsedMax, MAX_RENDER_DISTANCE_CHUNKS_BIGINT);
    assert.equal(parsedMax, 625000000000000000000000000000063n);

    // Rejects negative, zero, and garbage inputs cleanly
    assert.equal(parseRenderDistanceInputToChunksBigInt('-100'), null);
    assert.equal(parseRenderDistanceInputToChunksBigInt('0'), null);
    assert.equal(parseRenderDistanceInputToChunksBigInt('abc km'), null);
    assert.equal(sanitizePositiveRenderDistanceBigInt(-5n, 16n), 16n);
    assert.equal(
      sanitizePositiveRenderDistanceBigInt(MAX_RENDER_DISTANCE_CHUNKS_BIGINT + 999999n, 6n),
      MAX_RENDER_DISTANCE_CHUNKS_BIGINT,
    );

    // Formats 10^31 + 1 km cleanly
    assert.equal(
      formatHorizonDistanceBigInt(MAX_RENDER_DISTANCE_KM_BIGINT * 1000n),
      '10^31 + 1 km',
    );
    assert.equal(formatHorizonDistanceBigInt(1_000_000n), '1,000 km');

    // JSON serialization round-trip in GraphicsSettings never throws BigInt JSON TypeError
    const cosmicSettings = sanitizeGraphicsSettings(
      {
        voxelDrawDistanceBig: MAX_RENDER_DISTANCE_CHUNKS_BIGINT.toString(),
      },
      GRAPHICS_PRESETS.MEDIUM,
    );
    const jsonStr = JSON.stringify(cosmicSettings);
    const restored = sanitizeGraphicsSettings(JSON.parse(jsonStr), GRAPHICS_PRESETS.MEDIUM);
    assert.equal(getVoxelDrawDistanceBigInt(restored), MAX_RENDER_DISTANCE_CHUNKS_BIGINT);
  });

  it('preserves exact sub-meter precision past 2^53 using BigInt Sector subtraction and keeps Band-9 offsets inside Float32 bounds', () => {
    // At 10^34 m, naive Float64 subtraction completely erases 500 m offsets (Number(10^34 + 500) - Number(10^34) === 0!)
    const baseSector = 10_000_000_000_000_000_000_000_000_000_000n; // ~10^31 sectors = ~1.024e34 m!
    const camPos = createBigSectorPosition(125.5, 20.0, -40.25, baseSector, baseSector);
    const tileOriginLocal = {
      x: baseSector * BIG_SECTOR_SIZE_METERS + 625n,
      y: 0n,
      z: baseSector * BIG_SECTOR_SIZE_METERS - 140n,
    };
    const relLocal = computeBigCameraRelativeScaledOffset(tileOriginLocal, camPos, 1n);
    assert.ok(Math.abs(relLocal.x - (625 - 125.5)) < 1e-9, `Expected exact 499.5m offset, got ${relLocal.x}`);
    assert.ok(Math.abs(relLocal.z - (-140 - -40.25)) < 1e-9, `Expected exact -99.75m offset, got ${relLocal.z}`);

    // Band 9 cosmic offset at 10^34 m must divide cleanly into a safe Float32 coordinate in [-10000, +10000]
    const band9 = resolveRingScaleBand(108);
    assert.equal(band9.scaleBand, 9);
    const cosmicTileOrigin = {
      x: camPos.sectorX * BIG_SECTOR_SIZE_METERS + band9.bandScaleMetersBig * 512n,
      y: 0n,
      z: camPos.sectorZ * BIG_SECTOR_SIZE_METERS - band9.bandScaleMetersBig * 1024n,
    };
    const relCosmic = computeBigCameraRelativeScaledOffset(
      cosmicTileOrigin,
      camPos,
      band9.bandScaleMetersBig,
    );
    assert.ok(Number.isFinite(relCosmic.x) && Number.isFinite(relCosmic.z));
    assert.ok(Math.abs(relCosmic.x - 512) < 0.01, `Band 9 scaled X expected ~512, got ${relCosmic.x}`);
    assert.ok(Math.abs(relCosmic.z - -1024) < 0.01, `Band 9 scaled Z expected ~-1024, got ${relCosmic.z}`);
  });

  it('builds a compact O(log R) watertight Scale-Space ring plan all the way to 10^31 + 1 km and emits bounded Float32 vertices', () => {
    const planCosmic = computeDynamicLodPlan({
      renderDistanceChunks: MAX_RENDER_DISTANCE_CHUNKS_BIGINT,
      lodSpacing: 1.0,
    });
    assert.equal(planCosmic.renderDistanceChunksBig, MAX_RENDER_DISTANCE_CHUNKS_BIGINT);
    assert.ok(planCosmic.rings.length >= 100 && planCosmic.rings.length <= 110);
    assert.ok(planCosmic.activeScaleBands >= 9 && planCosmic.activeScaleBands <= 11);
    assert.equal(
      planCosmic.rings[planCosmic.rings.length - 1].outerRadiusChunksBig,
      MAX_RENDER_DISTANCE_CHUNKS_BIGINT,
    );

    const nestedCosmic = computeNestedRingBoxesBigInt(8n, 8n, planCosmic);
    assert.equal(nestedCosmic.ringOuterBoxes.length, planCosmic.rings.length);

    // Check every ring's outer box strictly encloses inner box and aligns to next ring's tileChunksBig
    let totalCosmicTiles = 0;
    for (let i = 0; i < planCosmic.rings.length; i++) {
      const ring = planCosmic.rings[i];
      const inner = i === 0 ? nestedCosmic.lod0Box : nestedCosmic.ringOuterBoxes[i - 1];
      const outer = nestedCosmic.ringOuterBoxes[i];
      assert.ok(
        outer.minCX <= inner.minCX &&
          outer.maxCXExcl >= inner.maxCXExcl &&
          outer.minCZ <= inner.minCZ &&
          outer.maxCZExcl >= inner.maxCZExcl,
        `Ring ${ring.level} outer box must enclose inner box`,
      );
      if (i + 1 < planCosmic.rings.length) {
        const nextTC = planCosmic.rings[i + 1].tileChunksBig;
        assert.equal(outer.minCX % nextTC, 0n);
        assert.equal(outer.maxCXExcl % nextTC, 0n);
        assert.equal(outer.minCZ % nextTC, 0n);
        assert.equal(outer.maxCZExcl % nextTC, 0n);
      }
      totalCosmicTiles += enumerateRingTilesBigInt(ring, inner, outer).length;
    }
    assert.ok(
      totalCosmicTiles > 300 && totalCosmicTiles < 2600,
      `Entire 10^31 km universe must remain O(log R) compact (< 2600 total tiles), got ${totalCosmicTiles}`,
    );

    // Build an outermost Band-9 cosmic mega-tile (~10^34 m out) and verify EVERY Float32 vertex is finite and inside [0..8192]
    const outerRing = planCosmic.rings[planCosmic.rings.length - 1];
    const cosmicPayload = buildHorizonTilePayload({
      type: 'horizonTile',
      jobId: 99,
      tileKey: `${outerRing.level}:1,1`,
      level: outerRing.level,
      tx: 1,
      tz: 1,
      tileChunks: outerRing.tileChunks,
      stepVoxels: outerRing.stepVoxels,
      txBig: 1n,
      tzBig: 1n,
      tileChunksBig: outerRing.tileChunksBig,
      stepVoxelsBig: outerRing.stepVoxelsBig,
      gridCells: outerRing.gridCells,
      scaleBand: outerRing.scaleBand,
      bandScaleMetersBig: outerRing.bandScaleMetersBig,
      worldGenMode: 'DEFAULT_PARK',
      flatBaseplateMat: MAT.CONCRETE,
    });
    assert.ok(
      cosmicPayload.opaque && cosmicPayload.opaque.vertCount > 0 && cosmicPayload.opaque.positions,
      'Outermost cosmic mega-tile must generate valid geometry',
    );
    for (let i = 0; i < cosmicPayload.opaque.positions.length; i++) {
      const v = cosmicPayload.opaque.positions[i];
      assert.ok(Number.isFinite(v), `Cosmic vertex component ${v} must be finite`);
      assert.ok(
        v >= -10000 && v <= 10000,
        `Cosmic Float32 vertex ${v} must stay inside safe [-10000, 10000] range`,
      );
    }
  });

  it('generates non-quantized deterministic integer-hashed terrain at coordinates > 10^33 (where Float64 trig breaks)', () => {
    const hugeCoord = 10_000_000_000_000_000_000_000_000_000_000_000n; // 10^34
    const stepBig = 1n << 104n;
    const distinctHashes = new Set<number>();
    const distinctHeights = new Set<number>();

    for (let i = 0n; i < 16n; i++) {
      const h = hashBigInt2D(hugeCoord + i, hugeCoord - i * 3n, 0x123456789abcdef0n);
      assert.ok(h >= 0 && h < 1, `Hash ${h} must be in [0, 1)`);
      distinctHashes.add(h);

      const fbm = sampleIntegerFbm2D(hugeCoord + i * stepBig, hugeCoord + i * stepBig * 2n, 106n, 3);
      assert.ok(Number.isFinite(fbm) && fbm >= -1 && fbm <= 1);

      const col = evaluateIntegerHashedHorizonColumn(
        hugeCoord + i * stepBig,
        hugeCoord - i * stepBig,
        stepBig,
        'BIOME_CANYON',
        MAT.CONCRETE,
      );
      distinctHeights.add(col.surfVY);
    }
    assert.ok(distinctHashes.size >= 14, `Integer hash must not quantize at 10^34, got ${distinctHashes.size}/16 unique`);
    assert.ok(distinctHeights.size >= 3, `Integer-hashed canyon terrain must preserve height relief at 10^34, got ${distinctHeights.size} heights`);
  });

  it('projects optical zoom sightline onto terrain and punches a watertight LOD0 box out of LOD1 horizon tiles', () => {
    // 1. Camera at (0, 35, 0) looking tilted downward along +Z at flat y=15m terrain -> hits at Z=160m
    const hitRes = computeOpticalZoomTargetPoint({
      eyeX: 0,
      eyeY: 35,
      eyeZ: 0,
      dirX: 0,
      dirY: -0.1240347,
      dirZ: 0.99227788,
      sampleSurfaceY: () => 15,
      maxDistanceMeters: 520,
    });
    assert.ok(
      Math.abs(hitRes.targetZ - 160) < 1.5,
      `Expected terrain intersection near Z=160m, got ${hitRes.targetZ}`,
    );
    assert.equal(hitRes.centerCX, 8);
    assert.equal(hitRes.centerCZ, 18);

    // 2. Compute zoomed LOD0 box centered at chunk (10, 10) with 2-chunk radius snapped to 2x2 grid -> [8..14) x [8..14) (3x3 = 9 LOD1 tiles)
    const zoomBox = computeZoomedLod0BoxBigInt(10, 10, 2, 2n);
    assert.equal(zoomBox.minCX, 8n);
    assert.equal(zoomBox.maxCXExcl, 14n);
    assert.equal(zoomBox.minCZ, 8n);
    assert.equal(zoomBox.maxCZExcl, 14n);

    // 3. Verify LOD1 (2x2 chunk tiles) cleanly excludes the 9 tiles inside zoomBox with 0 gaps and 0 overlaps
    const plan = computeDynamicLodPlan({ renderDistanceChunks: 24, lodSpacing: 1.0 });
    const nested = computeNestedRingBoxesBigInt(0n, 0n, plan);
    const lod1Ring = plan.rings[0];
    assert.equal(lod1Ring.tileChunksBig, 2n);

    const tilesWithoutZoom = enumerateRingTilesBigInt(
      lod1Ring,
      nested.lod0Box,
      nested.ringOuterBoxes[0],
    );
    const tilesWithZoom = enumerateRingTilesBigInt(
      lod1Ring,
      nested.lod0Box,
      nested.ringOuterBoxes[0],
      [zoomBox],
    );
    assert.equal(
      tilesWithoutZoom.length - tilesWithZoom.length,
      4,
      'zoomLod0Box overlapping [8..12)x[8..12) of LOD1 ring must punch out four 2x2 LOD1 tiles',
    );

    // 4. Verify unlimited zoom range (> 800m): camera at (0, 215, 0) looking slightly down hits terrain at Z=4000m
    const farHit = computeOpticalZoomTargetPoint({
      eyeX: 0,
      eyeY: 215,
      eyeZ: 0,
      dirX: 0,
      dirY: -0.05,
      dirZ: 1.0,
      sampleSurfaceY: () => 15,
      maxDistanceMeters: 20_000,
    });
    assert.ok(
      Math.abs(farHit.targetZ - 4000) < 35,
      `Unlimited optical zoom ray march must lock onto terrain at Z=4000m (>800m), got ${farHit.targetZ}`,
    );
  });
});

