import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFrameGovernorState,
  createDefaultFrameGovernorConfig,
  stepFrameGovernor,
  getStoredCrashSlowMo,
  setStoredCrashSlowMo,
} from './frameGovernor.ts';

test('60 FPS steady state keeps timeScale at 1.0x and watchdog inactive', () => {
  const state = createInitialFrameGovernorState();
  const cfg = createDefaultFrameGovernorConfig();

  for (let i = 0; i < 10; i++) {
    const res = stepFrameGovernor(state, 1 / 60, cfg);
    assert.equal(res.timeScale, 1.0);
    assert.equal(res.isSlowMoActive, false);
    assert.equal(res.slowMoReason, 'NONE');
    assert.equal(res.watchdog.isProtecting, false);
    assert.equal(res.watchdog.maxSyncChunkRebuilds, 2);
  }
});

test('Low FPS (~18 FPS / 55ms frames) automatically engages smooth slow-motion and caps simDt', () => {
  const state = createInitialFrameGovernorState();
  const cfg = createDefaultFrameGovernorConfig();

  let lastRes = stepFrameGovernor(state, 0.055, cfg);
  for (let i = 0; i < 6; i++) {
    lastRes = stepFrameGovernor(state, 0.055, cfg);
  }

  assert.equal(lastRes.isSlowMoActive, true);
  assert.equal(lastRes.slowMoReason, 'AUTO_FPS');
  assert.ok(
    lastRes.timeScale < 0.65 && lastRes.timeScale >= cfg.minTimeScale,
    `Expected timeScale to drop into slow-mo range, got ${lastRes.timeScale}`,
  );
  // Physics step should be significantly smaller than the raw 55ms frame delta so motion never stutters
  assert.ok(
    lastRes.simDt < 0.016,
    `Expected stabilized simDt < 16ms during low FPS slow-mo, got ${lastRes.simDt}`,
  );
});

test('Smoothly recovers back to 1.0x timeScale when FPS returns to 60', () => {
  const state = createInitialFrameGovernorState();
  const cfg = createDefaultFrameGovernorConfig();

  // Induce low FPS
  for (let i = 0; i < 8; i++) {
    stepFrameGovernor(state, 0.06, cfg);
  }
  assert.ok(state.currentTimeScale < 0.6);

  // Return to 60 FPS for ~1.5 seconds (90 frames)
  let recovered = stepFrameGovernor(state, 1 / 60, cfg);
  for (let i = 0; i < 90; i++) {
    recovered = stepFrameGovernor(state, 1 / 60, cfg);
  }

  assert.equal(recovered.timeScale, 1.0);
  assert.equal(recovered.isSlowMoActive, false);
  assert.equal(recovered.slowMoReason, 'NONE');
});

test('Manual slow-mo override forces slow-motion even at 60 FPS', () => {
  const state = createInitialFrameGovernorState();
  const cfg = {
    ...createDefaultFrameGovernorConfig(),
    manualSlowMoActive: true,
    manualTimeScale: 0.35,
  };

  let res = stepFrameGovernor(state, 1 / 60, cfg);
  for (let i = 0; i < 15; i++) {
    res = stepFrameGovernor(state, 1 / 60, cfg);
  }

  assert.equal(res.isSlowMoActive, true);
  assert.equal(res.slowMoReason, 'MANUAL');
  assert.ok(Math.abs(res.timeScale - 0.35) < 0.03);
});

test('Background tab hibernation spike (>250ms) is clamped cleanly without triggering false stalls', () => {
  const state = createInitialFrameGovernorState();
  const cfg = createDefaultFrameGovernorConfig();

  // Simulate a 4.5-second tab switch
  const res = stepFrameGovernor(state, 4.5, cfg);
  assert.equal(res.timeScale, 1.0);
  assert.equal(res.watchdog.isProtecting, false);
  assert.ok(res.simDt <= 1 / 45);
});

test('Anti-freeze watchdog sheds load (0 sync chunk rebuilds, reduced chunk budget, wave skip) on severe frame spikes', () => {
  const state = createInitialFrameGovernorState();
  const cfg = createDefaultFrameGovernorConfig();

  // Simulate two consecutive 85ms frames
  stepFrameGovernor(state, 0.085, cfg);
  const res2 = stepFrameGovernor(state, 0.085, cfg);

  assert.equal(res2.watchdog.isProtecting, true);
  assert.equal(res2.watchdog.maxSyncChunkRebuilds, 0);
  assert.ok(res2.watchdog.chunkBudgetMs <= 2.0);
  assert.ok(res2.watchdog.debrisSpawnMultiplier < 0.5);
  assert.equal(res2.watchdog.maxExplosionsThisFrame, 1);
});

test('Crash slow-motion storage defaults to enabled and persists OFF/ON state', () => {
  const store = new Map<string, string>();
  const origWindow = globalThis.window;
  (globalThis as unknown as { window: { localStorage: Storage } }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  };
  try {
    assert.equal(getStoredCrashSlowMo(), true);
    setStoredCrashSlowMo(false);
    assert.equal(getStoredCrashSlowMo(), false);
    setStoredCrashSlowMo(true);
    assert.equal(getStoredCrashSlowMo(), true);
  } finally {
    if (origWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: Window & typeof globalThis }).window =
        origWindow;
    }
  }
});
