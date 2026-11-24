import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { BuildPreviewRenderer, getSharedBuildPreviewRenderer } from './buildPreviewRenderer.ts';
import { BUILD_SLOTS, MAT } from './constants.ts';
import { VoxelFXSystem } from './fx.ts';
import { MicroVoxelWorld } from './world.ts';
import { ModularVehicleRig } from './vehicle.ts';

describe('Build Preview Renderer & Tire-Slip Systems', () => {
  it('initializes BuildPreviewRenderer with dedicated scene, camera tilt, and studio lighting', () => {
    const renderer = new BuildPreviewRenderer();
    assert.ok(renderer.scene instanceof THREE.Scene);
    assert.strictEqual(renderer.scene.name, 'BuildPreviewScene');

    // Camera setup: 20-degree downward isometric tilt looking at origin
    assert.ok(renderer.camera instanceof THREE.PerspectiveCamera);
    assert.strictEqual(renderer.camera.position.x, 0);
    assert.strictEqual(renderer.camera.position.y, 0.65);
    assert.strictEqual(renderer.camera.position.z, 2.05);

    // Studio lights in scene
    const lights = renderer.scene.children.filter((c) => c instanceof THREE.Light);
    assert.strictEqual(lights.length, 3, 'Should have 3 studio lights: ambient, main dir, and rim dir');
    renderer.dispose();
  });

  it('generates consistent unique keys for voxel blocks and mechanical modules', () => {
    const renderer = new BuildPreviewRenderer();
    const voxItem = BUILD_SLOTS.find((s) => s.type === 'voxel' && s.mat === MAT.STEEL);
    assert.ok(voxItem);
    assert.strictEqual(renderer.getItemKey(voxItem), `vox_${MAT.STEEL}`);

    const wheelItem = BUILD_SLOTS.find((s) => s.type === 'module' && s.kind === 'WHEEL_STEER');
    assert.ok(wheelItem);
    assert.strictEqual(renderer.getItemKey(wheelItem), 'mod_WHEEL_STEER');
    renderer.dispose();
  });

  it('prewarms and caches 3D stylized models centered at origin', () => {
    const renderer = new BuildPreviewRenderer();
    renderer.prewarm(BUILD_SLOTS.slice(0, 5));

    const firstSlot = BUILD_SLOTS[0];
    const key = renderer.getItemKey(firstSlot);
    const mesh1 = renderer.getOrCreatePreviewMesh(key, firstSlot);
    assert.ok(mesh1 instanceof THREE.Group);

    // Subsequent retrieval returns the cached instance
    const mesh2 = renderer.getOrCreatePreviewMesh(key);
    assert.strictEqual(mesh1, mesh2, 'Should return cached mesh');
    renderer.dispose();
  });

  it('exports a global shared singleton for zero-overhead reuse', () => {
    const s1 = getSharedBuildPreviewRenderer();
    const s2 = getSharedBuildPreviewRenderer();
    assert.strictEqual(s1, s2, 'getSharedBuildPreviewRenderer() should return identical singleton');
  });

  it('VoxelFXSystem spawns tire smoke particles with velocity and buoyancy', () => {
    const scene = new THREE.Scene();
    const world = new MicroVoxelWorld(scene, true);
    const fx = new VoxelFXSystem(scene, world);

    // Spawn tire smoke
    fx.spawnTireSmoke(10, 2, 15, 1.5);
    assert.ok(fx.debrisPool.length > 0, 'Debris pool should contain smoke particles');

    const smokeParticle = fx.debrisPool.find((p) => p.life > 0);
    assert.ok(smokeParticle, 'A particle should be active');
    assert.ok(smokeParticle.vy > 0, 'Tire smoke should have upward buoyant velocity');

    const initialLife = smokeParticle.life;
    // Update particles for a frame
    fx.update(0.016);
    assert.ok(smokeParticle.life < initialLife, 'Particle life should decay over time');
  });

  it('ModularVehicleRig tracks isDrifting flag and exposes it for visual effects', () => {
    const scene = new THREE.Scene();
    const world = new MicroVoxelWorld(scene, true);
    const fx = new VoxelFXSystem(scene, world);
    const rig = new ModularVehicleRig(scene, world, fx);

    assert.strictEqual(typeof rig.isDrifting, 'boolean');
    assert.strictEqual(rig.isDrifting, false);
  });

  it('correctly computes relative canvas scissor coordinates without window.innerHeight', () => {
    const renderer = new BuildPreviewRenderer();
    const mockCanvas = {
      width: 1280,
      height: 720,
      getBoundingClientRect: () => ({ left: 20, top: 40, right: 820, bottom: 640, width: 800, height: 600 }),
    };

    const history: Array<{ vp: number[]; sc: number[] }> = [];
    let currentVp: number[] = [];
    let currentSc: number[] = [];
    const mockRenderer = {
      domElement: mockCanvas as any,
      getScissorTest: () => false,
      setScissorTest: (_v: boolean) => {},
      getViewport: (_v: any) => {},
      getScissor: (_v: any) => {},
      setViewport: (x: any, y?: any, w?: any, h?: any) => {
        if (typeof x === 'number') currentVp = [x, y, w, h];
      },
      setScissor: (x: any, y?: any, w?: any, h?: any) => {
        if (typeof x === 'number') currentSc = [x, y, w, h];
      },
      autoClear: false,
      getClearColor: (_c: any) => {},
      getClearAlpha: () => 1,
      setClearColor: () => {},
      clear: () => {},
      render: () => {
        history.push({ vp: [...currentVp], sc: [...currentSc] });
      },
    } as any;

    const mockSlotEl = {
      getBoundingClientRect: () => ({ left: 60, top: 90, right: 120, bottom: 150, width: 60, height: 60 }),
      closest: () => null,
    } as any;

    renderer.renderHotbarPreviews(mockRenderer, [{ el: mockSlotEl, itemKey: 'vox_1' }], 0.016);

    // relLeft = 60 - 20 = 40; scaleX = 1280 / 800 = 1.6 => 40 * 1.6 = 64
    // relBottom = 640 - 150 = 490; scaleY = 720 / 600 = 1.2 => 490 * 1.2 = 588
    // width = 60 * 1.6 = 96; height = 60 * 1.2 = 72
    assert.strictEqual(history.length, 1);
    assert.deepStrictEqual(history[0].vp, [64, 588, 96, 72]);
    assert.deepStrictEqual(history[0].sc, [64, 588, 96, 72]);
    renderer.dispose();
  });
});
