import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TELEPORT_NODES,
  createInitialTeleportState,
  addTeleportNode,
  removeTeleportNode,
  recordCombatDamage,
  initiateTeleportToNode,
  stepTeleportSpinup,
  saveLastBuildAutoSave,
  loadLastBuildAutoSave,
  clearLastBuildAutoSave,
  shouldPromptRestoreLastBuild,
  TIME_TRIAL_5_CHECKPOINTS,
  createInitialDestructionDerbyState,
  stepDestructionDerby,
  evaluateBuildingChallengeResult,
  createInitialCtfState,
  stepCtfPlayerPosition,
  createInitialBuildBattleState,
  launchBuildBattleArena,
  createInitialSurvivalWavesState,
  stepSurvivalWaves,
} from './gameModesEngine';

test('Teleport Nodes enforce 8-beacon cap, free first teleport, 1s spinup, movement cancel, and 5s combat lock', () => {
  let state = createInitialTeleportState([]);
  assert.equal(state.maxNodes, MAX_TELEPORT_NODES);
  assert.equal(state.hasUsedFreeTeleport, false);

  // Add up to MAX_TELEPORT_NODES beacons
  for (let i = 0; i < MAX_TELEPORT_NODES; i++) {
    const res = addTeleportNode(
      state,
      { name: `Node ${i + 1}`, x: i * 10, y: 2, z: i * 10 },
      1000 + i,
    );
    assert.ok(res.added);
    state = res.state;
  }
  assert.equal(state.nodes.length, MAX_TELEPORT_NODES);

  // 9th beacon should be rejected by cap
  const overCap = addTeleportNode(
    state,
    { name: 'Overflow Node', x: 99, y: 2, z: 99 },
    2000,
  );
  assert.equal(overCap.added, null);
  assert.equal(overCap.state.nodes.length, MAX_TELEPORT_NODES);

  const firstNodeId = state.nodes[0].id;
  const secondNodeId = state.nodes[1].id;

  // First teleport is FREE & immediate (0s delay)
  const tp1 = initiateTeleportToNode(
    state,
    firstNodeId,
    { x: 0, y: 2, z: 0 },
    3000,
  );
  assert.equal(tp1.teleportedImmediately, true);
  assert.equal(tp1.state.hasUsedFreeTeleport, true);
  assert.equal(tp1.state.activeSpinup, null);
  state = tp1.state;

  // Second teleport requires 1.0s engine spinup
  const tp2 = initiateTeleportToNode(
    state,
    secondNodeId,
    { x: 0, y: 2, z: 0 },
    4000,
  );
  assert.equal(tp2.teleportedImmediately, false);
  assert.ok(tp2.state.activeSpinup);
  assert.equal(tp2.state.activeSpinup?.remainingSec, 1.0);
  state = tp2.state;

  // Moving during spinup cancels the teleport
  const cancelled = stepTeleportSpinup(
    state,
    0.3,
    { x: 2.0, y: 2, z: 0 },
    true,
    4300,
  );
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.state.activeSpinup, null);
  state = cancelled.state;

  // Restart spinup and hold still for 1.0s -> completes teleport
  state = initiateTeleportToNode(
    state,
    secondNodeId,
    { x: 0, y: 2, z: 0 },
    5000,
  ).state;
  const stepHalf = stepTeleportSpinup(
    state,
    0.5,
    { x: 0, y: 2, z: 0 },
    false,
    5500,
  );
  assert.equal(stepHalf.completedNode, null);
  const stepDone = stepTeleportSpinup(
    stepHalf.state,
    0.6,
    { x: 0, y: 2, z: 0 },
    false,
    6100,
  );
  assert.equal(stepDone.completedNode?.id, secondNodeId);
  state = stepDone.state;

  // Combat lock: taking damage within 5 seconds blocks teleporting
  state = recordCombatDamage(state, 10000);
  const blockedByCombat = initiateTeleportToNode(
    state,
    firstNodeId,
    { x: 0, y: 2, z: 0 },
    12500, // 2.5s after damage (< 5s)
  );
  assert.equal(blockedByCombat.teleportedImmediately, false);
  assert.equal(blockedByCombat.targetNode, null);
  assert.ok(blockedByCombat.error?.includes('COMBAT LOCK'));

  // After 5.1 seconds, teleport is allowed again
  const allowedAfterCooldown = initiateTeleportToNode(
    state,
    firstNodeId,
    { x: 0, y: 2, z: 0 },
    15100,
  );
  assert.ok(allowedAfterCooldown.state.activeSpinup);

  // Removing a node reduces count
  state = removeTeleportNode(state, firstNodeId);
  assert.equal(state.nodes.length, MAX_TELEPORT_NODES - 1);
});

test('Last Build Recovery auto-saves and prompts to restore vehicle on next load', () => {
  const mem = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };

  assert.equal(loadLastBuildAutoSave(mockStorage), null);

  const sampleBp = {
    id: 'bp_test',
    name: 'AutoSaved Stunt Rig',
    createdAt: '2026-11-02',
    massKg: 1450,
    blockCount: 42,
    powerCores: 4,
    voxels: [[12, 6, 18, 10]] as Array<[number, number, number, number]>,
    modules: [{ kind: 'SEAT_KART' as const, vx: 12, vy: 7, vz: 18, yawIdx: 0 }],
  };

  const saved = saveLastBuildAutoSave(sampleBp, mockStorage);
  assert.ok(saved);

  const loaded = loadLastBuildAutoSave(mockStorage);
  assert.ok(loaded);
  assert.equal(shouldPromptRestoreLastBuild(loaded), true);
  assert.equal(loaded?.blueprint.name, 'AutoSaved Stunt Rig');

  clearLastBuildAutoSave(mockStorage);
  assert.equal(loadLastBuildAutoSave(mockStorage), null);
});

test('6 Game Modes: Time Trial (5 checkpoints), Destruction Derby (60s), Building Challenge, CTF, Build Battle, Survival Waves', () => {
  // 1. Time Trial has exactly 5 sequential checkpoints
  assert.equal(TIME_TRIAL_5_CHECKPOINTS.length, 5);
  assert.equal(TIME_TRIAL_5_CHECKPOINTS[0].index, 0);
  assert.equal(TIME_TRIAL_5_CHECKPOINTS[4].index, 4);

  // 2. Destruction Derby tracks voxels destroyed in 60s
  let derby = createInitialDestructionDerbyState(100, 0);
  derby = stepDestructionDerby(derby, 30, 350);
  assert.equal(derby.scoreVoxelsDestroyed, 250);
  assert.equal(derby.finished, false);
  derby = stepDestructionDerby(derby, 31, 520);
  assert.equal(derby.scoreVoxelsDestroyed, 420);
  assert.equal(derby.bestScoreVoxels, 420);
  assert.equal(derby.finished, true);

  // 3. Building Challenge auto-evaluates all 3 prompts accurately
  const dropPass = evaluateBuildingChallengeResult('DROP_50M', {
    totalBlocks: 80,
    hasIntactSeat: true,
    structuralIntegrityPct: 88,
    installedModuleKinds: ['SEAT_KART', 'WHEEL_MONSTER'],
    peakSpeedKmh: 45,
    distanceTravelledMeters: 50,
  });
  assert.equal(dropPass.passed, true);

  const blockLimitFail = evaluateBuildingChallengeResult('MAX_50_BLOCKS', {
    totalBlocks: 64,
    hasIntactSeat: true,
    structuralIntegrityPct: 100,
    installedModuleKinds: ['SEAT_KART', 'WHEEL_STEER'],
    peakSpeedKmh: 40,
    distanceTravelledMeters: 20,
  });
  assert.equal(blockLimitFail.passed, false);

  const noJetsFail = evaluateBuildingChallengeResult('FASTEST_NO_JETS', {
    totalBlocks: 40,
    hasIntactSeat: true,
    structuralIntegrityPct: 100,
    installedModuleKinds: ['SEAT_KART', 'JET_RAW'],
    peakSpeedKmh: 95,
    distanceTravelledMeters: 60,
  });
  assert.equal(noJetsFail.passed, false);

  const noJetsPass = evaluateBuildingChallengeResult('FASTEST_NO_JETS', {
    totalBlocks: 40,
    hasIntactSeat: true,
    structuralIntegrityPct: 100,
    installedModuleKinds: ['SEAT_KART', 'WHEEL_DRAG', 'ENGINE_DRAGON'],
    peakSpeedKmh: 62,
    distanceTravelledMeters: 45,
  });
  assert.equal(noJetsPass.passed, true);

  // 4. Capture the Flag: first to 3 captures wins
  let ctf = createInitialCtfState('BLUE');
  for (let cap = 1; cap <= 3; cap++) {
    const pickup = stepCtfPlayerPosition(ctf, ctf.redBasePos);
    assert.equal(pickup.event, 'PICKED_UP_FLAG');
    const score = stepCtfPlayerPosition(pickup.state, ctf.blueBasePos);
    assert.equal(score.event, cap === 3 ? 'MATCH_WON' : 'SCORED_CAPTURE');
    ctf = score.state;
  }
  assert.equal(ctf.blueCaptures, 3);
  assert.equal(ctf.winnerTeam, 'BLUE');

  // 5. Build Battle: transitions from 5m build phase to Arena Combat with contenders
  const bbInit = createInitialBuildBattleState(0);
  assert.equal(bbInit.phase, 'BUILD');
  assert.equal(bbInit.buildRemainingSec, 300);
  const bbArena = launchBuildBattleArena(bbInit, 'Tester');
  assert.equal(bbArena.phase, 'ARENA_COMBAT');
  assert.equal(bbArena.contenders.length, 4);

  // 6. Survival Waves: spawns cubes, destroys cubes on high-speed ram, advances wave, and triggers fail state
  const surv = createInitialSurvivalWavesState({ x: 0, y: 2, z: 0 }, 1);
  assert.equal(surv.wave, 1);
  assert.ok(surv.enemies.length >= 5);

  // Place all enemies right in front of a high-speed ramming vehicle -> clears Wave 1 -> Wave 2!
  const clustered = {
    ...surv,
    enemies: surv.enemies.map((e) => ({ ...e, x: 0.5, z: 0.5 })),
  };
  const steppedWave = stepSurvivalWaves(
    clustered,
    0.05,
    { x: 0, y: 2, z: 0 },
    55, // 55 km/h ramming speed
    100,
    true,
  );
  assert.equal(steppedWave.waveCleared, true);
  assert.equal(steppedWave.state.wave, 2);

  // Fail state when seat is lost
  const failed = stepSurvivalWaves(
    steppedWave.state,
    0.05,
    { x: 0, y: 2, z: 0 },
    0,
    10,
    false,
  );
  assert.equal(failed.state.isGameOver, true);
});
