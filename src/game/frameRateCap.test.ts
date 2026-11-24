import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectHardwareTierFromProfile,
  resolveTargetFps,
  sanitizeFrameRateCap,
  parseFrameRateCapInput,
  computeFrameCapTargetMs,
  shouldRenderCappedFrame,
  FRAME_RATE_CAP_OPTIONS,
} from './frameRateCap';
import {
  GRAPHICS_PRESETS,
  createDefaultGraphicsSettings,
  sanitizeGraphicsSettings,
} from './graphicsSettings';
import {
  createInitialFrameGovernorState,
  createDefaultFrameGovernorConfig,
  stepFrameGovernor,
} from './frameGovernor';
import { VoxelWorld } from '../engine/world/VoxelWorld';

describe('Adaptive Frame Rate Cap — Hardware Tier Auto-Detection', () => {
  it('classifies Pentium, Celeron, Intel HD, SwiftShader, and <4GB mobile as LOW (30 FPS)', () => {
    const lowCases = [
      { gpuRenderer: 'Intel(R) HD Graphics 4000', hardwareConcurrency: 4, deviceMemoryGB: 8 },
      { gpuRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11)', hardwareConcurrency: 4, deviceMemoryGB: 4 },
      { gpuRenderer: 'Pentium Silver Integrated', hardwareConcurrency: 4, deviceMemoryGB: 4 },
      { gpuRenderer: 'Intel Celeron N4020', hardwareConcurrency: 2, deviceMemoryGB: 4 },
      { gpuRenderer: 'Google SwiftShader', hardwareConcurrency: 8, deviceMemoryGB: 8 },
      { gpuRenderer: 'Mali-G52 MC2', isMobile: true, hardwareConcurrency: 8, deviceMemoryGB: 3 },
      { gpuRenderer: 'Adreno (TM) 610', isMobile: true, hardwareConcurrency: 8, deviceMemoryGB: 2 },
      { isLowEndGpu: true, gpuRenderer: 'Unknown GPU', hardwareConcurrency: 4, deviceMemoryGB: 8 },
      { gpuRenderer: 'Generic Integrated GPU', hardwareConcurrency: 2, deviceMemoryGB: 8 },
    ];

    for (const profile of lowCases) {
      const res = detectHardwareTierFromProfile(profile);
      assert.equal(res.tier, 'LOW', `Expected LOW for ${JSON.stringify(profile)}, got ${res.tier}`);
      assert.equal(res.defaultFpsCap, 30);
    }
  });

  it('classifies mid-range desktop and mid-range mobile (Dimensity 6300 / Mali-G57) as MEDIUM (60 FPS)', () => {
    const mediumCases = [
      // Dimensity 6300 (Mali-G57 MC2, 8 cores, 6GB or 8GB RAM)
      {
        gpuRenderer: 'Mali-G57 MC2',
        isMobile: true,
        hardwareConcurrency: 8,
        deviceMemoryGB: 6,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Dimensity 6300) Mobile',
      },
      {
        gpuRenderer: 'Mali-G57 MC2',
        isMobile: true,
        hardwareConcurrency: 8,
        deviceMemoryGB: 8,
      },
      // Mid-range mobile Adreno 6xx
      { gpuRenderer: 'Adreno (TM) 619', isMobile: true, hardwareConcurrency: 8, deviceMemoryGB: 6 },
      // Mid-range desktop integrated GPU
      { gpuRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', hardwareConcurrency: 8, deviceMemoryGB: 8 },
      { gpuRenderer: 'AMD Radeon(TM) Graphics', hardwareConcurrency: 6, deviceMemoryGB: 8 },
    ];

    for (const profile of mediumCases) {
      const res = detectHardwareTierFromProfile(profile);
      assert.equal(res.tier, 'MEDIUM', `Expected MEDIUM for ${JSON.stringify(profile)}, got ${res.tier}`);
      assert.equal(res.defaultFpsCap, 60);
    }
  });

  it('classifies discrete GPUs and flagship 8GB+ mobile as HIGH (144 FPS)', () => {
    const highCases = [
      { gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)', hardwareConcurrency: 12, deviceMemoryGB: 16 },
      { gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti)', hardwareConcurrency: 6, deviceMemoryGB: 8 },
      { gpuRenderer: 'AMD Radeon RX 7800 XT', hardwareConcurrency: 16, deviceMemoryGB: 32 },
      { gpuRenderer: 'Intel(R) Arc(TM) A770 Graphics', hardwareConcurrency: 12, deviceMemoryGB: 16 },
      { gpuRenderer: 'Apple M3 Pro', hardwareConcurrency: 12, deviceMemoryGB: 16 },
      // Flagship mobile with 8GB+ RAM
      { gpuRenderer: 'Adreno (TM) 750', isMobile: true, hardwareConcurrency: 8, deviceMemoryGB: 12 },
      { gpuRenderer: 'Immortalis-G720 MC12', isMobile: true, hardwareConcurrency: 8, deviceMemoryGB: 12 },
      { gpuRenderer: 'Apple A17 Pro GPU', isMobile: true, hardwareConcurrency: 6 },
    ];

    for (const profile of highCases) {
      const res = detectHardwareTierFromProfile(profile);
      assert.equal(res.tier, 'HIGH', `Expected HIGH for ${JSON.stringify(profile)}, got ${res.tier}`);
      assert.equal(res.defaultFpsCap, 144);
    }
  });
});

describe('Adaptive Frame Rate Cap — Settings, Options & Resolution', () => {
  it('exposes exact dropdown options [Auto (recommended), 30, 60, 120, 144, Uncapped]', () => {
    assert.deepEqual(
      FRAME_RATE_CAP_OPTIONS.map((o) => o.value),
      ['AUTO', 30, 60, 120, 144, 'UNCAPPED'],
    );
    assert.equal(FRAME_RATE_CAP_OPTIONS[0].label, 'Auto (recommended)');
    assert.equal(FRAME_RATE_CAP_OPTIONS[5].label, 'Uncapped');
  });

  it('defaults to AUTO (never UNCAPPED) across all presets and default graphics settings', () => {
    for (const [presetName, preset] of Object.entries(GRAPHICS_PRESETS)) {
      assert.equal(preset.frameRateCap, 'AUTO', `Preset ${presetName} must default to AUTO`);
    }
    assert.equal(createDefaultGraphicsSettings(false, false).frameRateCap, 'AUTO');
    assert.equal(createDefaultGraphicsSettings(true, false).frameRateCap, 'AUTO');
    assert.equal(createDefaultGraphicsSettings(false, true).frameRateCap, 'AUTO');
    assert.equal(sanitizeGraphicsSettings({}).frameRateCap, 'AUTO');
  });

  it('resolves AUTO per tier and respects all manual overrides', () => {
    assert.equal(resolveTargetFps('AUTO', 'LOW'), 30);
    assert.equal(resolveTargetFps('AUTO', 'MEDIUM'), 60);
    assert.equal(resolveTargetFps('AUTO', 'HIGH'), 144);

    assert.equal(resolveTargetFps(30, 'HIGH'), 30);
    assert.equal(resolveTargetFps(60, 'LOW'), 60);
    assert.equal(resolveTargetFps(120, 'MEDIUM'), 120);
    assert.equal(resolveTargetFps(144, 'MEDIUM'), 144);
    assert.equal(resolveTargetFps('UNCAPPED', 'LOW'), 0);

    assert.equal(sanitizeFrameRateCap('invalid'), 'AUTO');
    assert.equal(parseFrameRateCapInput('120'), 120);
    assert.equal(parseFrameRateCapInput('UNCAPPED'), 'UNCAPPED');
    assert.equal(parseFrameRateCapInput('AUTO'), 'AUTO');
    assert.equal(computeFrameCapTargetMs(0), 0);
    assert.ok(Math.abs(computeFrameCapTargetMs(30) - 33.3333) < 0.01);
  });
});

describe('Adaptive Frame Rate Cap — Render Pacing & 60Hz Fixed Physics Invariant', () => {
  function simulateRenderFrames(displayHz: number, targetFps: number, durationSec = 2): number {
    const stepMs = 1000 / displayHz;
    let lastRender = 0;
    let rendered = 0;
    const totalTicks = Math.round(displayHz * durationSec);
    for (let tick = 1; tick <= totalTicks; tick++) {
      // Simulate ±0.25ms realistic browser rAF jitter
      const jitter = tick % 2 === 0 ? -0.25 : 0.25;
      const now = tick * stepMs + jitter;
      if (shouldRenderCappedFrame(now, lastRender, targetFps)) {
        lastRender = now;
        rendered++;
      }
    }
    return rendered / durationSec;
  }

  it('caps render FPS accurately on 60Hz, 120Hz, and 144Hz displays without halving due to rAF jitter', () => {
    const lowOn60 = simulateRenderFrames(60, 30);
    assert.ok(lowOn60 >= 29 && lowOn60 <= 31, `Expected ~30 FPS on 60Hz display, got ${lowOn60}`);

    const medOn60 = simulateRenderFrames(60, 60);
    assert.ok(medOn60 >= 59 && medOn60 <= 61, `Expected ~60 FPS on 60Hz display, got ${medOn60}`);

    const medOn120 = simulateRenderFrames(120, 60);
    assert.ok(medOn120 >= 59 && medOn120 <= 61, `Expected ~60 FPS on 120Hz display, got ${medOn120}`);

    const highOn144 = simulateRenderFrames(144, 144);
    assert.ok(highOn144 >= 142 && highOn144 <= 145, `Expected ~144 FPS on 144Hz display, got ${highOn144}`);

    const uncappedOn144 = simulateRenderFrames(144, 0);
    assert.equal(uncappedOn144, 144);
  });

  it('keeps VoxelWorld physics at exact 60Hz fixed step when render loop is capped at 30 FPS', () => {
    const worldAt30 = new VoxelWorld({ maxBodies: 8 });
    const worldAt60 = new VoxelWorld({ maxBodies: 8 });

    const b30 = worldAt30.acquireBodySlot(1);
    const b60 = worldAt60.acquireBodySlot(1);
    worldAt30.setBodyPosition(b30, 0, 50, 0);
    worldAt60.setBodyPosition(b60, 0, 50, 0);
    worldAt30.bodyMasses[b30] = 100;
    worldAt60.bodyMasses[b60] = 100;
    worldAt30.bodyInvMasses[b30] = 1 / 100;
    worldAt60.bodyInvMasses[b60] = 1 / 100;
    worldAt30.bodyVisible[b30] = 1;
    worldAt60.bodyVisible[b60] = 1;
    worldAt30.bodySleepStates[b30] = 0;
    worldAt60.bodySleepStates[b60] = 0;

    let stepsAt30 = 0;
    for (let f = 0; f < 30; f++) {
      stepsAt30 += worldAt30.step(1 / 30, {
        maxSubsteps: 4,
        onFixedStep: () => {
          worldAt30.bodyForces[b30 * 3 + 1] += -9.81 * worldAt30.bodyMasses[b30];
        },
      });
    }

    let stepsAt60 = 0;
    for (let f = 0; f < 60; f++) {
      stepsAt60 += worldAt60.step(1 / 60, {
        maxSubsteps: 4,
        onFixedStep: () => {
          worldAt60.bodyForces[b60 * 3 + 1] += -9.81 * worldAt60.bodyMasses[b60];
        },
      });
    }

    // Both execute ~60 fixed 60Hz physics steps in 1.0s (allowing 1-step FP rounding boundary)
    assert.ok(stepsAt30 >= 59 && stepsAt30 <= 60, `Expected 60 physics steps at 30 FPS render, got ${stepsAt30}`);
    assert.ok(stepsAt60 >= 59 && stepsAt60 <= 60, `Expected 60 physics steps at 60 FPS render, got ${stepsAt60}`);
    assert.equal(stepsAt30, stepsAt60);

    // Identical rigid-body gravity trajectory at 30 FPS render vs 60 FPS render
    const y30 = worldAt30.bodyPositions[b30 * 3 + 1];
    const y60 = worldAt60.bodyPositions[b60 * 3 + 1];
    assert.ok(Math.abs(y30 - y60) < 1e-4, `Expected matching Y trajectory (${y30} vs ${y60})`);
    assert.ok(y30 < 46, `Body should have fallen under gravity (got y=${y30})`);
  });

  it('does not trigger false FrameGovernor slow-motion or watchdog trips during an intentional 30 FPS cap', () => {
    const govState = createInitialFrameGovernorState();
    const govConfig = {
      ...createDefaultFrameGovernorConfig(),
      autoSlowMoEnabled: true,
      antiFreezeWatchdogEnabled: true,
      targetFpsCap: 30,
    };

    let lastRes = stepFrameGovernor(govState, 1 / 30, govConfig);
    for (let i = 0; i < 60; i++) {
      lastRes = stepFrameGovernor(govState, 1 / 30, govConfig);
    }

    assert.equal(lastRes.timeScale, 1.0, 'Steady 30 FPS cap must keep 1.0x simulation speed');
    assert.equal(lastRes.isSlowMoActive, false, 'Steady 30 FPS cap must not engage slow-motion');
    assert.equal(lastRes.watchdog.isProtecting, false, 'Steady 30 FPS cap must not trip watchdog');
  });
});
