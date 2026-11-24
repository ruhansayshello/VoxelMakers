import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPHICS_PRESETS,
  createDefaultGraphicsSettings,
  sanitizeGraphicsSettings,
  hasActivePostProcessing,
  countActiveGraphicsFeatures,
  computeHaltonJitter,
  sanitizeShadowMapSize,
  sanitizePlanarResolution,
  resolveVisualQualityTier,
  shouldUseRealisticWater,
  computeLinearFogBounds,
  resolveEffectivePixelRatio,
  worldGenModeToShaderId,
} from './graphicsSettings.ts';
import { computeRenderDistanceTuning, computeAnalogSliderSteer } from './touchControls.ts';
import {
  isLowEndRendererString,
  getSharedPotatoShaderMaterial,
  getSharedCartoonShaderMaterial,
  getSharedVehicleOutlineMaterial,
  createVehicleBlobShadowMesh,
  updateVehicleBlobShadow,
  applyMeshMaterialPresetSwap,
  getSmoothedOutlineGeometry,
  attachGpuGerstnerOceanShader,
  applyCustomShaderPresetToMaterials,
  restoreActiveCustomShaderPreset,
  BUILTIN_SHADER_PRESETS,
} from './potatoShader.ts';
import { greedyMeshBoundedArrays, greedyMeshWaterTopSurfaceOnly } from './physicsMath.ts';
import { MAT, WATER_VY } from './constants.ts';
import * as THREE from 'three';

describe('GraphicsSettings & Presets (15 Features + PENTIUM Potato Mode + CARTOON Outline Mode)', () => {
  it('defines PENTIUM, CARTOON, LOW, MEDIUM, HIGH, and ULTRA presets with valid ranges and distinct visual tiers', () => {
    assert.equal(GRAPHICS_PRESETS.PENTIUM.usePotatoShader, true);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.useCartoonShader, false);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.usePBR, false);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.blobShadows, true);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.cheapBloom, false);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.bloomEnabled, false);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.dynamicShadows, false);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.ssaoEnabled, false);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.dofEnabled, false);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.planarReflectionsEnabled, false);
    assert.equal(GRAPHICS_PRESETS.PENTIUM.waveQuality, 'OFF');
    assert.equal(hasActivePostProcessing(GRAPHICS_PRESETS.PENTIUM), false);
    assert.equal(resolveVisualQualityTier(GRAPHICS_PRESETS.PENTIUM), 0);

    assert.equal(GRAPHICS_PRESETS.CARTOON.useCartoonShader, true);
    assert.equal(GRAPHICS_PRESETS.CARTOON.usePotatoShader, false);
    assert.equal(GRAPHICS_PRESETS.CARTOON.usePBR, false);
    assert.equal(GRAPHICS_PRESETS.CARTOON.blobShadows, true);
    assert.equal(GRAPHICS_PRESETS.CARTOON.waveQuality, 'MEDIUM');
    assert.equal(resolveVisualQualityTier(GRAPHICS_PRESETS.CARTOON), 0);

    assert.equal(GRAPHICS_PRESETS.LOW.dynamicShadows, false);
    assert.equal(GRAPHICS_PRESETS.LOW.usePotatoShader, false);
    assert.equal(GRAPHICS_PRESETS.LOW.useCartoonShader, false);
    assert.equal(GRAPHICS_PRESETS.LOW.usePBR, true);
    assert.equal(GRAPHICS_PRESETS.LOW.resolutionScale, 0.55);
    assert.equal(hasActivePostProcessing(GRAPHICS_PRESETS.LOW), false);
    assert.equal(resolveVisualQualityTier(GRAPHICS_PRESETS.LOW), 0);

    assert.equal(GRAPHICS_PRESETS.MEDIUM.dynamicShadows, true);
    assert.equal(GRAPHICS_PRESETS.MEDIUM.ssaoEnabled, true);
    assert.equal(GRAPHICS_PRESETS.MEDIUM.bloomEnabled, true);
    assert.equal(GRAPHICS_PRESETS.MEDIUM.resolutionScale, 0.9);
    assert.equal(GRAPHICS_PRESETS.MEDIUM.waveQuality, 'LOW');
    assert.equal(hasActivePostProcessing(GRAPHICS_PRESETS.MEDIUM), true);
    assert.equal(resolveVisualQualityTier(GRAPHICS_PRESETS.MEDIUM), 1);

    assert.equal(GRAPHICS_PRESETS.HIGH.ssrEnabled, true);
    assert.equal(GRAPHICS_PRESETS.HIGH.godRaysEnabled, true);
    assert.equal(GRAPHICS_PRESETS.HIGH.taaEnabled, true);
    assert.equal(GRAPHICS_PRESETS.HIGH.waveQuality, 'MEDIUM');
    assert.equal(resolveVisualQualityTier(GRAPHICS_PRESETS.HIGH), 2);

    assert.equal(GRAPHICS_PRESETS.ULTRA.shadowMapSize, 2048);
    assert.equal(GRAPHICS_PRESETS.ULTRA.resolutionScale, 1.25);
    assert.equal(GRAPHICS_PRESETS.ULTRA.dofEnabled, true);
    assert.equal(GRAPHICS_PRESETS.ULTRA.planarReflectionsEnabled, true);
    assert.equal(GRAPHICS_PRESETS.ULTRA.uncappedChunkLod, true);
    assert.equal(GRAPHICS_PRESETS.ULTRA.waveQuality, 'HIGH');
    assert.equal(resolveVisualQualityTier(GRAPHICS_PRESETS.ULTRA), 3);
    assert.equal(countActiveGraphicsFeatures(GRAPHICS_PRESETS.ULTRA), 15);

    // Ensure progressive feature count: LOW < MEDIUM < HIGH < ULTRA
    assert.ok(countActiveGraphicsFeatures(GRAPHICS_PRESETS.LOW) < countActiveGraphicsFeatures(GRAPHICS_PRESETS.MEDIUM));
    assert.ok(countActiveGraphicsFeatures(GRAPHICS_PRESETS.MEDIUM) < countActiveGraphicsFeatures(GRAPHICS_PRESETS.HIGH));
    assert.ok(countActiveGraphicsFeatures(GRAPHICS_PRESETS.HIGH) < countActiveGraphicsFeatures(GRAPHICS_PRESETS.ULTRA));

    // Verify mobile analog steering bar math
    assert.equal(computeAnalogSliderSteer(150, 100, 100), 0); // center = 0
    assert.ok(computeAnalogSliderSteer(105, 100, 100) > 0.8); // left edge -> +steer (left)
    assert.ok(computeAnalogSliderSteer(195, 100, 100) < -0.8); // right edge -> -steer (right)
  });

  it('switches to ultra-realistic ocean waves iff #14 Planar Reflections or #3 SSR is enabled', () => {
    assert.equal(
      shouldUseRealisticWater({ planarReflectionsEnabled: false, ssrEnabled: false }),
      false,
    );
    assert.equal(
      shouldUseRealisticWater({ planarReflectionsEnabled: true, ssrEnabled: false }),
      true,
    );
    assert.equal(
      shouldUseRealisticWater({ planarReflectionsEnabled: false, ssrEnabled: true }),
      true,
    );
    assert.equal(
      shouldUseRealisticWater({ planarReflectionsEnabled: true, ssrEnabled: true }),
      true,
    );
    assert.equal(shouldUseRealisticWater(GRAPHICS_PRESETS.LOW), false);
    assert.equal(shouldUseRealisticWater(GRAPHICS_PRESETS.MEDIUM), false);
    assert.equal(shouldUseRealisticWater(GRAPHICS_PRESETS.HIGH), true);
    assert.equal(shouldUseRealisticWater(GRAPHICS_PRESETS.ULTRA), true);
  });

  it('scales linear fog bounds with voxelDrawDistance and respects fogEnabled & map mode', () => {
    const near4 = computeLinearFogBounds(4, true, true, false);
    const far16 = computeLinearFogBounds(16, true, true, false);
    assert.ok(far16.near > near4.near);
    assert.ok(far16.far > near4.far);

    const disabledFog = computeLinearFogBounds(8, false, true, false);
    assert.ok(disabledFog.far >= 2000);

    const mapFog = computeLinearFogBounds(4, true, true, true);
    assert.deepEqual(mapFog, { near: 650, far: 1300 });
  });

  it('computes effective pixel ratio combining DPR with resolutionScale cleanly', () => {
    assert.equal(resolveEffectivePixelRatio(1.25, 2, true), 0.65);
    assert.equal(resolveEffectivePixelRatio(1.0, 2, false), 2);
    assert.equal(resolveEffectivePixelRatio(0.9, 1, false), 0.9);
    assert.equal(resolveEffectivePixelRatio(2.0, 2, false), 2.5);
  });

  it('maps WorldGenMode strings to shader basin IDs', () => {
    assert.equal(worldGenModeToShaderId('DEFAULT_PARK'), 0);
    assert.equal(worldGenModeToShaderId('BIOME_CANYON'), 1);
    assert.equal(worldGenModeToShaderId('BIOME_ARCTIC'), 2);
    assert.equal(worldGenModeToShaderId('BIOME_VOLCANIC'), 3);
    assert.equal(worldGenModeToShaderId('BIOME_ARCHIPELAGO'), 4);
    assert.equal(worldGenModeToShaderId('CUSTOM_GLB_MAP'), 4);
    assert.equal(worldGenModeToShaderId('FLAT_BASEPLATE'), 5);
    assert.equal(worldGenModeToShaderId('CUSTOM_HEIGHTMAP'), 6);
  });

  it('welds coincident normals on BoxGeometry in getSmoothedOutlineGeometry so cartoon outlines never split faces', () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const smooth = getSmoothedOutlineGeometry(box);
    const normAttr = smooth.getAttribute('normal');
    // At corner (+0.5, +0.5, +0.5), averaged normal must point radially outward along all 3 axes!
    const posAttr = smooth.getAttribute('position');
    let checkedCorner = false;
    for (let i = 0; i < posAttr.count; i++) {
      if (posAttr.getX(i) > 0.4 && posAttr.getY(i) > 0.4 && posAttr.getZ(i) > 0.4) {
        const nx = normAttr.getX(i);
        const ny = normAttr.getY(i);
        const nz = normAttr.getZ(i);
        assert.ok(Math.abs(nx - ny) < 1e-4 && Math.abs(ny - nz) < 1e-4);
        assert.ok(nx > 0.5 && ny > 0.5 && nz > 0.5);
        checkedCorner = true;
      }
    }
    assert.equal(checkedCorner, true);
    assert.equal(getSmoothedOutlineGeometry(box), smooth);
  });

  it('attaches realistic + voxel ocean wave uniforms to MeshPhongMaterial and restores active shader preset', () => {
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true });
    const uniforms = attachGpuGerstnerOceanShader(mat);
    assert.equal(uniforms.uRealisticWater.value, 0.0);
    assert.equal(uniforms.uWorldGenMode.value, 0.0);
    assert.equal(uniforms.uHasPlanarTex.value, 0.0);
    assert.equal(uniforms.uWaterOutputSrgb.value, 0.0);

    applyCustomShaderPresetToMaterials(BUILTIN_SHADER_PRESETS[1]);
    const restored = restoreActiveCustomShaderPreset();
    assert.ok(restored && typeof restored.id === 'string');
  });

  it('detects Intel Pentium / HD Graphics / integrated low-end GPU strings', () => {
    assert.equal(
      isLowEndRendererString('ANGLE (Intel, Intel(R) HD Graphics 510, Direct3D11)'),
      true,
    );
    assert.equal(
      isLowEndRendererString('Intel(R) Pentium(R) CPU G4400 Integrated Graphics'),
      true,
    );
    assert.equal(
      isLowEndRendererString('Google SwiftShader'),
      true,
    );
    assert.equal(
      isLowEndRendererString('NVIDIA GeForce RTX 4080/PCIe/SSE2'),
      false,
    );
  });

  it('prevents vertex-color attribute glitches on solid-colored meshes in POTATO and CARTOON modes', () => {
    const matA = getSharedPotatoShaderMaterial();
    const matB = getSharedPotatoShaderMaterial();
    assert.equal(matA, matB);
    assert.equal(matA.vertexColors, true);

    const cartoonMat = getSharedCartoonShaderMaterial();
    assert.equal(cartoonMat.vertexColors, true);

    const outlineMat = getSharedVehicleOutlineMaterial();
    assert.equal(outlineMat.side, THREE.BackSide);
    assert.ok(outlineMat.uniforms.uOutlineThickness.value > 0);

    // 1. Solid-colored module mesh WITHOUT a `color` vertex attribute:
    // Must receive a cached `vertexColors: false` ShaderMaterial with `uBaseColor = 0xff3366`
    const origMat = new THREE.MeshLambertMaterial({ color: 0xff3366 });
    const solidMesh: THREE.Mesh<THREE.BoxGeometry, THREE.Material> = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      origMat,
    );
    applyMeshMaterialPresetSwap(solidMesh, 'POTATO');
    const swappedPotatoMat = solidMesh.material as THREE.ShaderMaterial;
    assert.equal(swappedPotatoMat.vertexColors, false);
    assert.equal(swappedPotatoMat.uniforms.uBaseColor.value.getHex(), 0xff3366);

    applyMeshMaterialPresetSwap(solidMesh, 'CARTOON');
    const swappedCartoonMat = solidMesh.material as THREE.ShaderMaterial;
    assert.equal(swappedCartoonMat.vertexColors, false);
    assert.equal(swappedCartoonMat.uniforms.uBaseColor.value.getHex(), 0xff3366);

    applyMeshMaterialPresetSwap(solidMesh, 'PBR');
    assert.equal(solidMesh.material, origMat);
  });

  it('emits downward (-Y) bottom faces on vehicle/object blocks at ly = 0 so bottom faces are never missing', () => {
    // 1x1x1 vehicle block at (0,0,0) with MAT.ALLOY_BLUE
    const res = greedyMeshBoundedArrays(
      1,
      1,
      1,
      0,
      0,
      (x, y, z) => (x === 0 && y === 0 && z === 0 ? MAT.ALLOY_BLUE : MAT.AIR),
      0,
      0,
      0,
      0.25,
      0.25,
      'OPAQUE_ONLY',
      null,
      true,
    );
    // A single exposed voxel cube MUST have all 6 faces (24 vertices, 36 indices), including the -Y bottom face!
    assert.equal(res.mergedQuads, 6);
    assert.equal(res.vertCount, 24);
    let hasBottomFaceNormal = false;
    for (let i = 0; i < res.vertCount; i++) {
      if (res.normals[i * 3 + 1] < -0.9) {
        hasBottomFaceNormal = true;
        break;
      }
    }
    assert.equal(hasBottomFaceNormal, true);
  });

  it('creates flat PlaneGeometry blob shadows rotated -90 deg on X and updates ground pose', () => {
    const blobMesh = createVehicleBlobShadowMesh();
    assert.ok(blobMesh.geometry.attributes.normal.getY(0) > 0.99);
    const mat = blobMesh.material as THREE.MeshBasicMaterial;
    assert.equal(mat.transparent, true);
    assert.equal(mat.depthWrite, false);

    updateVehicleBlobShadow(blobMesh, 10, 4, -5, 2.0, 3.2, 4.8, 0.5, true);
    assert.equal(blobMesh.visible, true);
    assert.ok(Math.abs(blobMesh.position.x - 10) < 1e-5);
    assert.ok(Math.abs(blobMesh.position.y - 2.02) < 1e-5);
    assert.ok(Math.abs(blobMesh.position.z - -5) < 1e-5);
  });

  it('sanitizes and clamps out-of-range settings for all 15 features', () => {
    const sanitized = sanitizeGraphicsSettings({
      preset: 'CUSTOM',
      resolutionScale: 4.5, // should clamp to 2.0
      shadowMapSize: 8192 as any, // should clamp to 4096
      ssaoIntensity: -5, // should clamp to 0.1
      bloomStrength: 99, // should clamp to 2.5
      particleMultiplier: 0.01, // should clamp to 0.25
      voxelDrawDistance: 50, // should clamp to 16
      lensDistortion: 2.0, // should clamp to 0.4
      taaBlendFactor: 0.99, // should clamp to 0.94
      planarReflectionResolution: 2048 as any, // should clamp to 1024
    });

    assert.equal(sanitized.preset, 'CUSTOM');
    assert.equal(sanitized.resolutionScale, 2.0);
    assert.equal(sanitized.shadowMapSize, 4096);
    assert.equal(sanitized.ssaoIntensity, 0.1);
    assert.equal(sanitized.bloomStrength, 2.5);
    assert.equal(sanitized.particleMultiplier, 0.25);
    assert.equal(sanitized.voxelDrawDistance, 16);
    assert.equal(sanitized.lensDistortion, 0.4);
    assert.equal(sanitized.taaBlendFactor, 0.94);
    assert.equal(sanitized.planarReflectionResolution, 1024);
  });

  it('sanitizes shadow map and planar reflection resolutions to valid power-of-two tiers', () => {
    assert.equal(sanitizeShadowMapSize(512), 512);
    assert.equal(sanitizeShadowMapSize(1024), 1024);
    assert.equal(sanitizeShadowMapSize(2048), 2048);
    assert.equal(sanitizeShadowMapSize(4096), 4096);

    assert.equal(sanitizePlanarResolution(256), 256);
    assert.equal(sanitizePlanarResolution(512), 512);
    assert.equal(sanitizePlanarResolution(1024), 1024);
  });

  it('computes deterministic Halton (2,3) sub-pixel jitter in [-0.5, 0.5] for TAA', () => {
    for (let i = 0; i < 32; i++) {
      const { jx, jy } = computeHaltonJitter(i);
      assert.ok(jx >= -0.5 && jx <= 0.5, `jx=${jx} out of bounds`);
      assert.ok(jy >= -0.5 && jy <= 0.5, `jy=${jy} out of bounds`);
    }
    const f0 = computeHaltonJitter(0);
    const f16 = computeHaltonJitter(16);
    assert.deepEqual(f0, f16);
  });

  it('supports extended Voxel Draw Distance up to 16 chunks and Uncapped Chunk LOD', () => {
    const standard = computeRenderDistanceTuning(12, false);
    assert.equal(standard.clampedChunks, 12);
    assert.equal(standard.uncappedChunkLod, false);
    assert.ok(standard.lod0MaxCheb < 12);

    const uncapped = computeRenderDistanceTuning(16, true);
    assert.equal(uncapped.clampedChunks, 16);
    assert.equal(uncapped.uncappedChunkLod, true);
    assert.ok(uncapped.lod0MaxCheb >= 16);
    assert.ok(uncapped.lod0MaxMeters >= 16 * 16);
  });

  it('creates sensible defaults for mobile/headless, low-end GPU, and desktop', () => {
    const mobileDef = createDefaultGraphicsSettings(true);
    const lowEndDef = createDefaultGraphicsSettings(false, true);
    const desktopDef = createDefaultGraphicsSettings(false, false);
    assert.equal(mobileDef.resolutionScale, 0.65);
    assert.equal(lowEndDef.preset, 'PENTIUM');
    assert.equal(lowEndDef.usePotatoShader, true);
    assert.equal(desktopDef.preset, 'MEDIUM');
  });

  it('emits zero vertical water walls against solid shorelines and expands waves onto solid shore slopes without bridging air holes', () => {
    const dimsX = 16;
    const dimsY = 64;
    const dimsZ = 8;
    const voxels = new Uint8Array(dimsX * dimsY * dimsZ);
    const setVox = (x: number, y: number, z: number, m: number) => {
      voxels[x + dimsX * (y + dimsY * z)] = m;
    };

    // x = 0..4: deep ocean basin with water up to WATER_VY (56)
    // x = 5..10: sloped sand beach at WATER_VY (56) & WATER_VY+1 (57)
    // x = 11..15: dry air crater (MAT.AIR at WATER_VY) separated by 6 sand columns
    for (let z = 0; z < dimsZ; z++) {
      for (let x = 0; x < dimsX; x++) {
        for (let y = 0; y < 50; y++) setVox(x, y, z, MAT.ROCK);
        if (x <= 4) {
          for (let y = 50; y <= WATER_VY; y++) setVox(x, y, z, MAT.WATER_VOX);
        } else if (x <= 12) {
          for (let y = 50; y <= WATER_VY + (x >= 7 ? 1 : 0); y++) setVox(x, y, z, MAT.SAND);
        }
        // Leave x = 13..15 at y = WATER_VY as MAT.AIR (unconnected dry hole)
      }
    }

    const boundedRes = greedyMeshBoundedArrays(
      dimsX,
      dimsY,
      dimsZ,
      48,
      WATER_VY + 2,
      (x, y, z) => voxels[x + dimsX * (y + dimsY * z)],
      -30,
      0,
      0,
      0.25,
      0.25,
      'TRANSLUCENT_ONLY',
      null,
      false,
    );

    assert.ok(boundedRes.vertCount > 0);
    let hasSideFace = false;
    let maxExpandedX = -Infinity;
    for (let i = 0; i < boundedRes.vertCount; i++) {
      const ny = boundedRes.normals[i * 3 + 1];
      if (Math.abs(ny) < 0.5) hasSideFace = true;
      const vx = boundedRes.positions[i * 3];
      if (vx > maxExpandedX) maxExpandedX = vx;
    }
    assert.equal(hasSideFace, false, 'Water touching solid sand shore must NOT emit vertical wall faces');
    // x=4 water ends at -30 + 5*0.25 = -28.75; 6-voxel expansion over sand reaches -30 + 11*0.25 = -27.25 without entering x=13..15 air hole!
    assert.ok(maxExpandedX > -28.5 && maxExpandedX <= -26.75, `Expected shoreline wave overlap into sand (got maxExpandedX=${maxExpandedX})`);

    const topRes = greedyMeshWaterTopSurfaceOnly(
      dimsX,
      dimsY,
      dimsZ,
      WATER_VY,
      voxels,
      -30,
      0,
      0,
      0.25,
      false,
      48,
    );
    assert.ok(topRes.vertCount > 0);
    let maxTopX = -Infinity;
    for (let i = 0; i < topRes.vertCount; i++) {
      const vx = topRes.positions[i * 3];
      if (vx > maxTopX) maxTopX = vx;
    }
    assert.ok(maxTopX > -28.5 && maxTopX <= -26.75, `Top surface mesher must overlap solid sand without crossing air hole (got maxTopX=${maxTopX})`);

    // Tall cliff/building wall right beside water (y = WATER_VY + 3 solid) must NOT receive overlapping water quads,
    // whereas coastal roads (y = WATER_VY + 2) DO receive wave run-up!
    const cliffVoxels = new Uint8Array(dimsX * dimsY * dimsZ);
    const compactVoxels = new Uint8Array(dimsX * 4 * dimsZ);
    const surfHeights = new Uint8Array(dimsX * dimsZ);
    for (let z = 0; z < dimsZ; z++) {
      for (let x = 0; x < dimsX; x++) {
        if (x <= 4) {
          for (let y = 50; y <= WATER_VY; y++) cliffVoxels[x + dimsX * (y + dimsY * z)] = MAT.WATER_VOX;
          compactVoxels[x + dimsX * (3 + 4 * z)] = MAT.WATER_VOX;
          surfHeights[x + dimsX * z] = WATER_VY - 2;
        } else {
          // Tall cliff/retaining wall rising to WATER_VY + 3 (15.00m)
          for (let y = 50; y <= WATER_VY + 3; y++) cliffVoxels[x + dimsX * (y + dimsY * z)] = MAT.ROCK;
          compactVoxels[x + dimsX * (0 + 4 * z)] = MAT.ROCK;
          surfHeights[x + dimsX * z] = WATER_VY + 3;
        }
      }
    }
    const boundedCliff = greedyMeshBoundedArrays(
      dimsX,
      dimsY,
      dimsZ,
      48,
      WATER_VY + 4,
      (x, y, z) => cliffVoxels[x + dimsX * (y + dimsY * z)],
      -30,
      0,
      0,
      0.25,
      0.25,
      'TRANSLUCENT_ONLY',
      null,
      false,
    );
    let maxCliffWaterX = -Infinity;
    for (let i = 0; i < boundedCliff.vertCount; i++) {
      const vx = boundedCliff.positions[i * 3];
      if (vx > maxCliffWaterX) maxCliffWaterX = vx;
    }
    assert.ok(maxCliffWaterX <= -28.74, `Water must stop cleanly at tall cliff wall x=-28.75 (got ${maxCliffWaterX})`);

    const compactCliff = greedyMeshWaterTopSurfaceOnly(
      dimsX,
      dimsY,
      dimsZ,
      WATER_VY,
      compactVoxels,
      -30,
      0,
      0,
      0.25,
      false,
      undefined,
      surfHeights,
    );
    let maxCompactCliffX = -Infinity;
    for (let i = 0; i < compactCliff.vertCount; i++) {
      const vx = compactCliff.positions[i * 3];
      if (vx > maxCompactCliffX) maxCompactCliffX = vx;
    }
    assert.ok(maxCompactCliffX <= -28.74, `Compact surface water must stop cleanly at tall cliff wall (got ${maxCompactCliffX})`);
  });

  it('guards realistic ocean shader against vertical wall displacement and underwater milky ceiling washout', () => {
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true });
    attachGpuGerstnerOceanShader(mat);
    const fakeShader = {
      uniforms: {} as Record<string, any>,
      vertexShader: `#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>`,
      fragmentShader: `#include <common>\n#include <opaque_fragment>\n#include <dithering_fragment>`,
    };
    mat.onBeforeCompile(fakeShader as any, {} as any);
    assert.ok(fakeShader.vertexShader.includes('vWaterNormalY = normal.y;'));
    assert.ok(fakeShader.vertexShader.includes('normal.y > 0.5'));
    assert.ok(fakeShader.fragmentShader.includes('abs(vWaterNormalY) <= 0.5'));
    assert.ok(fakeShader.fragmentShader.includes('bool isUnderwater = cameraPosition.y < vWaterWorldPos.y'));
  });
});
