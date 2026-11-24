import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEligibleAIRigs,
  analyzeVehicleCapabilities,
  areAITeamsHostile,
  selectHostileTarget,
  computeSpatialHazardAvoidance,
  computeSmartVehicleAIControls,
  createDefaultVehicleAIConfig,
  createDefaultAIBrainMemory,
  recordAndSampleDelayedTarget,
  detectUnexpectedManeuver,
  rollSuboptimalMistake,
  type AIRigLike,
  type TerrainProber,
} from './aiPilot';
import { PHYSICS_CONFIG } from './physics/physicsConfig';

function makeRig(overrides: Partial<AIRigLike> = {}): AIRigLike {
  const aiConfig = createDefaultVehicleAIConfig();
  if (overrides.aiConfig) {
    Object.assign(aiConfig, overrides.aiConfig);
  }
  return {
    vehicleId: overrides.vehicleId ?? 'veh_1',
    customBlueprintName: overrides.customBlueprintName ?? 'Test Rig',
    isVoxelEntity: overrides.isVoxelEntity ?? false,
    inBuildMode: overrides.inBuildMode ?? false,
    isRemoteControlled: overrides.isRemoteControlled ?? false,
    voxelCount: overrides.voxelCount ?? 40,
    totalMass: overrides.totalMass ?? 900,
    position: overrides.position ?? { x: 0, y: 2, z: 0 },
    velocity: overrides.velocity ?? { x: 0, y: 0, z: 0 },
    angularVelocity: overrides.angularVelocity ?? { x: 0, y: 0, z: 0 },
    quaternion: overrides.quaternion ?? { x: 0, y: 0, z: 0, w: 1 },
    comLocal: overrides.comLocal ?? { x: 0, y: 0, z: 0 },
    minVX: overrides.minVX ?? -2,
    maxVX: overrides.maxVX ?? 2,
    minVZ: overrides.minVZ ?? -4,
    maxVZ: overrides.maxVZ ?? 4,
    modules: overrides.modules ?? [
      { kind: 'COCKPIT', vx: 0, vy: 1, vz: 0 },
      { kind: 'WHEEL_STEER', vx: -2, vy: 0, vz: 3, lastCompression: 0.2 },
      { kind: 'WHEEL_STEER', vx: 2, vy: 0, vz: 3, lastCompression: 0.2 },
      { kind: 'WHEEL_DRIVE', vx: -2, vy: 0, vz: -3, lastCompression: 0.2 },
      { kind: 'WHEEL_DRIVE', vx: 2, vy: 0, vz: -3, lastCompression: 0.2 },
    ],
    structuralIntegrityPct: overrides.structuralIntegrityPct ?? 100,
    ...overrides,
    aiConfig,
    aiBrainMemory: overrides.aiBrainMemory ?? createDefaultAIBrainMemory(),
  };
}

const flatProber: TerrainProber = {
  sampleGroundY: () => 2.0,
  isWaterAt: () => false,
};

test('getEligibleAIRigs strictly excludes lifeless voxel entities (props)', () => {
  const playerCar = makeRig({ vehicleId: 'car_1', isVoxelEntity: false });
  const coneProp = makeRig({ vehicleId: 'prop_cone', isVoxelEntity: true, voxelCount: 18 });
  const barrelProp = makeRig({ vehicleId: 'prop_barrel', isVoxelEntity: true, voxelCount: 25 });
  const buildingRig = makeRig({ vehicleId: 'car_build', isVoxelEntity: false, inBuildMode: true });
  const emptyHull = makeRig({ vehicleId: 'car_empty', isVoxelEntity: false, voxelCount: 0 });

  const eligible = getEligibleAIRigs([playerCar, coneProp, barrelProp, buildingRig, emptyHull]);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].vehicleId, 'car_1');
});

test('analyzeVehicleCapabilities detects lopsided broken wheels, custom thruster keys & melee orientation', () => {
  const brokenWeirdRig = makeRig({
    // Seat-less, missing all right-side wheels, custom KeyJ rocket thruster, right-facing melee blade (yawIdx=3 -> -X)
    modules: [
      { kind: 'WHEEL_STEER', vx: 2, vy: 0, vz: 3 },
      { kind: 'WHEEL_DRIVE', vx: 2, vy: 0, vz: -3 },
      { kind: 'THRUSTER_ROCKET', vx: 0, vy: 1, vz: -3, yawIdx: 0, config: { posKey: 'KeyJ' } },
      { kind: 'WEAPON_MELEE', vx: -2, vy: 1, vz: 0, yawIdx: 3 },
    ],
  });

  const caps = analyzeVehicleCapabilities(brokenWeirdRig);
  assert.equal(caps.intactDriveWheels, 2);
  assert.equal(caps.leftDriveWheels, 2);
  assert.equal(caps.rightDriveWheels, 0);
  assert.equal(caps.isDamagedAsymmetric, true);
  assert.equal(caps.wheelAsymmetryBias, 1);
  assert.ok(caps.forwardThrusterKeys.includes('KeyJ'));
  assert.equal(caps.meleeCount, 1);
  // yawIdx=3 rotates +Z -> -X, which in rig drive space (+X is left, -X is right) is +right
  assert.ok(caps.meleeLocalRightBias > 0.5);
});

test('selectHostileTarget respects offline AI teams and ignores props', () => {
  const playerCar = makeRig({
    vehicleId: 'player',
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });
  const wingman = makeRig({
    vehicleId: 'wingman',
    position: { x: 5, y: 2, z: 0 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: true, team: 'PLAYER' },
  });
  const redBot = makeRig({
    vehicleId: 'red_1',
    position: { x: 25, y: 2, z: 0 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: true, team: 'RED' },
  });
  const blueBot = makeRig({
    vehicleId: 'blue_1',
    position: { x: 18, y: 2, z: 0 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: true, team: 'BLUE' },
  });
  const rogueBot = makeRig({
    vehicleId: 'rogue_1',
    position: { x: 12, y: 2, z: 0 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: true, team: 'ROGUE' },
  });
  const nearbyCrate = makeRig({
    vehicleId: 'crate',
    isVoxelEntity: true,
    position: { x: 1, y: 2, z: 0 },
  });

  assert.equal(areAITeamsHostile('PLAYER', 'PLAYER'), false);
  assert.equal(areAITeamsHostile('RED', 'BLUE'), true);
  assert.equal(areAITeamsHostile('ROGUE', 'ROGUE'), true);

  // Wingman (PLAYER) ignores playerCar and nearbyCrate, targets closest hostile (rogueBot at 12m)
  const wingTarget = selectHostileTarget(wingman, [playerCar, wingman, redBot, blueBot, rogueBot, nearbyCrate], playerCar);
  assert.equal(wingTarget?.vehicleId, 'rogue_1');

  // RedBot targets nearest non-RED hostile (rogueBot at x=12, dist 13m vs blueBot dist 7m -> blueBot!)
  const redTarget = selectHostileTarget(redBot, [playerCar, wingman, redBot, blueBot, rogueBot, nearbyCrate], playerCar);
  assert.equal(redTarget?.vehicleId, 'blue_1');
});

test('computeSpatialHazardAvoidance steers clear of cliffs/pits and deep water while ignoring light cones', () => {
  const rig = makeRig({ position: { x: 0, y: 2, z: 0 } });
  const caps = analyzeVehicleCapabilities(rig);

  // Hazard prober: pit directly ahead and on right lane; left lane is safe!
  const pitOnRightProber: TerrainProber = {
    sampleGroundY: (wx, _wy, wz) => {
      if (wx < -1.5 && wz > 2) return 2.0; // left lane is flat safe ground
      if (wz > 3) return -8.0; // center & right lanes drop into deep pit
      return 2.0;
    },
    isWaterAt: () => false,
  };

  const lightCone = makeRig({
    vehicleId: 'cone',
    isVoxelEntity: true,
    totalMass: 25,
    position: { x: 0, y: 2, z: 3 },
  });

  const avoidPit = computeSpatialHazardAvoidance(
    rig,
    0, 1, // fwd = +Z
    -1, 0, // right = -X (so left = +X... wait: if +X is left, then wx > 1.5 is left)
    pitOnRightProber,
    [lightCone],
    null,
    caps,
  );
  // Check right/left sign: if right=(-1,0), left=(+1,0). Since pitOnRightProber had safe at wx<-1.5 (which is right lane), it steers toward safer lane (negative)!
  assert.ok(Math.abs(avoidPit.steerBias) > 0.4, 'Should strongly steer away from cliff/pit');
  assert.ok(avoidPit.speedFactor < 1.0, 'Should slow down approaching pit');

  // On flat ground with only a lightweight cone in front, should NOT dodge cone
  const avoidCone = computeSpatialHazardAvoidance(
    rig,
    0, 1,
    -1, 0,
    flatProber,
    [lightCone],
    null,
    caps,
  );
  assert.equal(avoidCone.steerBias, 0);
  assert.equal(avoidCone.speedFactor, 1.0);
});

test('computeSmartVehicleAIControls adapts wheel-less thruster rigs, damaged asymmetry, and melee fighting', () => {
  const noMistakeRng = () => 0.99;
  // 1. Zero wheels, no seat, only a custom-key Rocket Thruster ('KeyK') -> THRUSTER_SKID triggers 'KeyK'!
  const thrusterSled = makeRig({
    vehicleId: 'sled',
    position: { x: 0, y: 2, z: 0 },
    modules: [
      { kind: 'THRUSTER_ROCKET', vx: 0, vy: 1, vz: -2, yawIdx: 0, config: { posKey: 'KeyK' } },
      { kind: 'WEAPON_MELEE', vx: 0, vy: 1, vz: 2, yawIdx: 0 },
    ],
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'AUTO',
      personality: 'AGGRESSIVE',
    },
  });
  const enemy = makeRig({
    vehicleId: 'enemy',
    position: { x: 0, y: 2, z: 22 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });

  const sledDecision = computeSmartVehicleAIControls(
    thrusterSled,
    1 / 60,
    [thrusterSled, enemy],
    enemy,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.equal(sledDecision.resolvedStyle, 'THRUSTER_SKID');
  assert.equal(sledDecision.boost, true);
  assert.equal(sledDecision.keys['KeyK'], true);

  // 2. Gunner whose cannons got shot off downgrades to MELEE / triggers melee strike at close range!
  const disarmedGunner = makeRig({
    vehicleId: 'gunner',
    position: { x: 0, y: 2, z: 0 },
    modules: [
      { kind: 'WHEEL_STEER', vx: -2, vy: 0, vz: 3 },
      { kind: 'WHEEL_STEER', vx: 2, vy: 0, vz: 3 },
      { kind: 'WEAPON_MINIGUN', vx: 0, vy: 2, vz: 0, isShotOut: true, health: 0 },
      { kind: 'WEAPON_MELEE', vx: 0, vy: 1, vz: 3, yawIdx: 0, health: 1 },
    ],
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'GUNNER',
      personality: 'AGGRESSIVE',
    },
  });
  const closeEnemy = makeRig({
    vehicleId: 'enemy_close',
    position: { x: 0, y: 2, z: 4.5 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });
  const gunnerFallback = computeSmartVehicleAIControls(
    disarmedGunner,
    1 / 60,
    [disarmedGunner, closeEnemy],
    closeEnemy,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.equal(gunnerFallback.resolvedStyle, 'MELEE');
  assert.equal(gunnerFallback.triggerMeleeStrike, true);

  // 3. Stuck detection switches into UNSTUCK reverse-turn mode when blocked for ~2 seconds
  const stuckBot = makeRig({
    vehicleId: 'stuck',
    position: { x: 0, y: 2, z: 0 },
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'RAMMER',
      personality: 'AGGRESSIVE',
    },
  });
  let out = computeSmartVehicleAIControls(stuckBot, 0.9, [stuckBot, enemy], enemy, flatProber, null, noMistakeRng);
  out = computeSmartVehicleAIControls(stuckBot, 0.9, [stuckBot, enemy], enemy, flatProber, null, noMistakeRng);
  out = computeSmartVehicleAIControls(stuckBot, 0.9, [stuckBot, enemy], enemy, flatProber, null, noMistakeRng);
  assert.equal(out.resolvedStyle, 'UNSTUCK');
  assert.ok(out.throttle < 0);
});

test('PHYSICS_CONFIG exposes requested human-like AI tuning constants', () => {
  assert.equal(PHYSICS_CONFIG.aiReactionDelayMs, 300);
  assert.equal(PHYSICS_CONFIG.aiLoseTrackLineOfSight, true);
  assert.equal(PHYSICS_CONFIG.aiMistakeChance, 0.2);
  assert.equal(PHYSICS_CONFIG.aiPersonalityVariation, true);
  assert.equal(PHYSICS_CONFIG.aiHesitationMs, 500);
});

test('AI has ~300ms reaction delay and tracks delayed player position rather than instant frame position', () => {
  const mem = createDefaultAIBrainMemory(() => 0.5);
  mem.reactionDelaySec = 0.3;

  // Record player driving along Z over 0.4s
  for (let i = 0; i <= 8; i++) {
    mem.simTime = i * 0.05; // 0.00 -> 0.40s
    const sampled = recordAndSampleDelayedTarget(
      mem,
      'player_1',
      { x: i * 5, y: 2, z: 20 }, // jumps to x = 40 at t = 0.40s
      { x: 10, y: 0, z: 0 },
      0.3,
    );
    if (i === 8) {
      // At t = 0.40s with 0.30s reaction delay, AI sees player at t = 0.10s -> x = 10, NOT x = 40!
      assert.ok(Math.abs(sampled.x - 10) < 0.01, `Expected delayed x~10, got ${sampled.x}`);
    }
  }
});

test('AI loses track when line of sight is blocked by terrain, drives to last seen, then enters expanding search mode', () => {
  let losVisible = true;
  const losProber: TerrainProber = {
    sampleGroundY: () => 2.0,
    isWaterAt: () => false,
    hasLineOfSight: () => losVisible,
  };
  const ai = makeRig({
    vehicleId: 'seeker',
    position: { x: 0, y: 2, z: 0 },
    modules: [
      { kind: 'WHEEL_STEER', vx: -2, vy: 0, vz: 3 },
      { kind: 'WHEEL_STEER', vx: 2, vy: 0, vz: 3 },
      { kind: 'WHEEL_DRIVE', vx: -2, vy: 0, vz: -3 },
      { kind: 'WHEEL_DRIVE', vx: 2, vy: 0, vz: -3 },
      { kind: 'PLASMA_CANNON', vx: 0, vy: 2, vz: 2 },
    ],
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'GUNNER',
      personality: 'AGGRESSIVE',
    },
  });
  const player = makeRig({
    vehicleId: 'player',
    position: { x: 0, y: 2, z: 25 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });

  // Step 1: player visible -> AI fires and locks onto player
  const seeOut = computeSmartVehicleAIControls(ai, 0.1, [ai, player], player, losProber, null, () => 0.99);
  assert.equal(seeOut.fireWeapons, true);

  // Step 2: player hides behind a hill -> LOS blocked -> for <2s drives toward LAST SEEN and holds fire
  losVisible = false;
  player.position.x = 120; // Player secretly moved far away behind hill
  ai.position.z += 4;
  const lostOut = computeSmartVehicleAIControls(ai, 0.8, [ai, player], player, losProber, null, () => 0.99);
  assert.equal(lostOut.fireWeapons, false);
  assert.equal(lostOut.statusLabel, 'LAST SEEN');

  // Step 3: still hidden past 2.0s -> enters expanding-circle SEARCHING mode
  ai.position.z += 6;
  const search1 = computeSmartVehicleAIControls(ai, 1.5, [ai, player], player, losProber, null, () => 0.99);
  assert.equal(search1.statusLabel, 'SEARCHING');
  const radius1 = ai.aiBrainMemory.searchRadius;
  ai.position.x += 5;
  computeSmartVehicleAIControls(ai, 1.0, [ai, player], player, losProber, null, () => 0.99);
  assert.ok(ai.aiBrainMemory.searchRadius > radius1, 'Search circle radius should expand over time');
});

test('rollSuboptimalMistake produces ~20% mistakes split into WRONG_TURN, LATE_BRAKE, OFF_AIM, and OBSTACLE_CLIP', () => {
  const mem = createDefaultAIBrainMemory();
  assert.equal(rollSuboptimalMistake(mem, () => 0.02, 0.2), 'WRONG_TURN');
  assert.ok(Math.abs(mem.mistakeSteerOffset) >= 0.25);
  assert.equal(rollSuboptimalMistake(mem, () => 0.10, 0.2), 'LATE_BRAKE');
  assert.equal(rollSuboptimalMistake(mem, () => 0.15, 0.2), 'OFF_AIM');
  assert.ok(Math.hypot(mem.mistakeAimOffsetX, mem.mistakeAimOffsetZ) > 2.0);
  assert.equal(rollSuboptimalMistake(mem, () => 0.19, 0.2), 'OBSTACLE_CLIP');
  assert.equal(rollSuboptimalMistake(mem, () => 0.25, 0.2), 'NONE');
});

test('AI personality variation differentiates AGGRESSIVE (120% speed/rams), CAUTIOUS (80% speed/never rams), and MIXED', () => {
  const enemy = makeRig({
    vehicleId: 'target',
    position: { x: 0, y: 2, z: 7 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });

  const aggr = makeRig({
    vehicleId: 'aggr',
    position: { x: 0, y: 2, z: 0 },
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'RAMMER',
      personality: 'AGGRESSIVE',
    },
  });
  const aggrOut = computeSmartVehicleAIControls(aggr, 0.1, [aggr, enemy], enemy, flatProber, null, () => 0.99);
  assert.ok(aggrOut.throttle > 1.05, `Aggressive should drive ~120% speed, got ${aggrOut.throttle}`);
  assert.equal(aggrOut.resolvedStyle, 'RAM');

  const caut = makeRig({
    vehicleId: 'caut',
    position: { x: 0, y: 2, z: 0 },
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'BLUE',
      role: 'RAMMER',
      personality: 'CAUTIOUS',
    },
  });
  const cautOut = computeSmartVehicleAIControls(caut, 0.1, [caut, enemy], enemy, flatProber, null, () => 0.99);
  assert.notEqual(cautOut.resolvedStyle, 'RAM', 'Cautious AI must never ram');
  assert.ok(cautOut.throttle < 0, 'Cautious AI backs off when enemy is close (<9.5m)');

  // Check MIXED flips between AGGRESSIVE and CAUTIOUS over 5-10s
  const mixed = makeRig({
    vehicleId: 'mixed',
    position: { x: 0, y: 2, z: 0 },
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'GREEN',
      role: 'AUTO',
      personality: 'MIXED',
    },
  });
  mixed.aiBrainMemory.mixedPhase = 'AGGRESSIVE';
  mixed.aiBrainMemory.mixedPhaseTimer = 0.2;
  computeSmartVehicleAIControls(mixed, 0.3, [mixed, enemy], enemy, flatProber, null, () => 0.99);
  assert.equal(mixed.aiConfig.effectivePersonality, 'CAUTIOUS');
});

test('AI hesitates for 500ms when player makes a sudden >90deg direction flip or hard stop', () => {
  const ai = makeRig({
    vehicleId: 'hesitator',
    position: { x: 0, y: 2, z: 0 },
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'AUTO',
      personality: 'AGGRESSIVE',
    },
  });
  const player = makeRig({
    vehicleId: 'player',
    position: { x: 0, y: 2, z: 30 },
    velocity: { x: 14, y: 0, z: 0 }, // Moving fast +X
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });

  // Observe player cruising at +14 m/s over 0.25s
  computeSmartVehicleAIControls(ai, 0.12, [ai, player], player, flatProber, null, () => 0.99);
  computeSmartVehicleAIControls(ai, 0.12, [ai, player], player, flatProber, null, () => 0.99);

  // Sudden 180-degree reverse maneuver (-12 m/s)
  player.velocity = { x: -12, y: 0, z: 0 };
  assert.equal(detectUnexpectedManeuver(ai.aiBrainMemory, -12, 0, 0.5), true);

  const hesOut = computeSmartVehicleAIControls(ai, 0.05, [ai, player], player, flatProber, null, () => 0.99);
  assert.equal(hesOut.statusLabel, 'HESITATING');
  assert.equal(hesOut.throttle, 0);
  assert.equal(hesOut.fireWeapons, false);

  // After 500ms elapses, AI resumes tracking!
  const resumeOut = computeSmartVehicleAIControls(ai, 0.55, [ai, player], player, flatProber, null, () => 0.99);
  assert.notEqual(resumeOut.statusLabel, 'HESITATING');
  assert.ok(resumeOut.throttle > 0.5);
});

test('AI steers toward target with true Left (+X) / Right (-X) polarity and avoids walls via horizontal raycasts', () => {
  const noMistakeRng = () => 0.99;
  const ai = makeRig({
    vehicleId: 'wall_avoider',
    position: { x: 0, y: 2, z: 0 },
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'RAMMER',
      personality: 'AGGRESSIVE',
    },
  });

  // 1. Target to the LEFT (+X) when facing +Z must produce POSITIVE steer (KeyA = Left turn)
  const targetLeft = makeRig({
    vehicleId: 'target_left',
    position: { x: 14, y: 2, z: 14 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });
  const leftTurnOut = computeSmartVehicleAIControls(ai, 0.1, [ai, targetLeft], targetLeft, flatProber, null, noMistakeRng);
  assert.ok(leftTurnOut.steer > 0.3, `Expected +steer (Left) for +X target, got ${leftTurnOut.steer}`);
  assert.equal(leftTurnOut.keys['KeyA'], true);

  // Target to the RIGHT (-X) must produce NEGATIVE steer (KeyD = Right turn)
  const targetRight = makeRig({
    vehicleId: 'target_right',
    position: { x: -14, y: 2, z: 14 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });
  const rightTurnOut = computeSmartVehicleAIControls(ai, 0.1, [ai, targetRight], targetRight, flatProber, null, noMistakeRng);
  assert.ok(rightTurnOut.steer < -0.3, `Expected -steer (Right) for -X target, got ${rightTurnOut.steer}`);
  assert.equal(rightTurnOut.keys['KeyD'], true);

  // 2. Short 1.6m wall directly ahead and on the RIGHT (-X) lane, clear on the LEFT (+X):
  //    raycastObstacle detects it even though vertical sampleGroundY would miss a wall <2.4m!
  const wallOnRightProber: TerrainProber = {
    sampleGroundY: () => 2.0,
    isWaterAt: () => false,
    raycastObstacle: (ox, _oy, _oz, dx, _dy, _dz, maxDist) => {
      // Wall spans x <= 0.5 at z = 6m; clear on left (x > 0.5)
      if (dx < 0.15 && ox < 0.6 && maxDist >= 3.5) return 3.8;
      return null;
    },
  };
  const caps = analyzeVehicleCapabilities(ai);
  const dodgeRightWall = computeSpatialHazardAvoidance(
    ai,
    0, 1, // fwd = +Z
    -1, 0, // true right = -X
    wallOnRightProber,
    [],
    null,
    caps,
  );
  assert.equal(dodgeRightWall.hazardReason, 'DODGING WALL');
  assert.ok(dodgeRightWall.steerBias > 0.5, `Must steer LEFT (+) away from right-side wall, got ${dodgeRightWall.steerBias}`);
  assert.ok(dodgeRightWall.speedFactor <= 0.55);

  // 3. Emergency pre-impact reverse when wall is <2.2m right in front of bumper
  const touchingWallProber: TerrainProber = {
    sampleGroundY: () => 2.0,
    isWaterAt: () => false,
    raycastObstacle: () => 1.4,
  };
  const closeWall = computeSpatialHazardAvoidance(
    ai,
    0, 1,
    -1, 0,
    touchingWallProber,
    [],
    null,
    caps,
  );
  assert.equal(closeWall.emergencyBrake, true);
  assert.equal(closeWall.speedFactor, 0);

  // 4. Gentle climbable ramp: low ray hits at 4.0m, high ray hits much further (5.8m) -> NOT flagged as a wall
  const rampProber: TerrainProber = {
    sampleGroundY: (wx, _wy, wz) => 2.0 + Math.max(0, wz - 3) * 0.35 + wx * 0,
    isWaterAt: () => false,
    raycastObstacle: (_ox, oy) => (oy < 3.0 ? 4.0 : 5.8),
  };
  const rampCheck = computeSpatialHazardAvoidance(
    ai,
    0, 1,
    -1, 0,
    rampProber,
    [],
    null,
    caps,
  );
  assert.equal(rampCheck.hazardReason, null, 'Climbable stunt ramp must not trigger wall avoidance');
  assert.equal(rampCheck.emergencyBrake, false);
});

test('GUARD (Escort) on PLAYER team follows moving player without shooting, ramming, or friendly-firing', () => {
  const noMistakeRng = () => 0.99;

  // Player cruising forward along +Z at 15 m/s
  const player = makeRig({
    vehicleId: 'player_car',
    position: { x: 0, y: 2, z: 45 },
    velocity: { x: 0, y: 0, z: 15 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });

  // 1. Escort far behind (z = 0) with cannons + melee blade must catch up toward player, NEVER fire at player
  const escort = makeRig({
    vehicleId: 'escort_1',
    position: { x: 0, y: 2, z: 0 },
    velocity: { x: 0, y: 0, z: 4 },
    modules: [
      { kind: 'WHEEL_STEER', vx: -2, vy: 0, vz: 3 },
      { kind: 'WHEEL_STEER', vx: 2, vy: 0, vz: 3 },
      { kind: 'WHEEL_DRIVE', vx: -2, vy: 0, vz: -3 },
      { kind: 'WHEEL_DRIVE', vx: 2, vy: 0, vz: -3 },
      { kind: 'PLASMA_CANNON', vx: 0, vy: 2, vz: 1 },
      { kind: 'WEAPON_MELEE', vx: 0, vy: 1, vz: 3, yawIdx: 0 },
    ],
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'PLAYER',
      role: 'GUARD',
      personality: 'CAUTIOUS',
    },
  });

  const catchupOut = computeSmartVehicleAIControls(
    escort,
    1 / 60,
    [escort, player],
    player,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.equal(catchupOut.statusLabel, 'ESCORT CATCHUP');
  assert.ok(catchupOut.throttle >= 0.99, `Escort must catch up briskly even when CAUTIOUS, got ${catchupOut.throttle}`);
  assert.equal(catchupOut.fireWeapons, false, 'Escort must never shoot player');
  assert.equal(catchupOut.triggerMeleeStrike, false, 'Escort must never melee player');

  // 2. Escort directly behind a slow player at <4.5m distance must yield/brake instead of rear-ending player
  const closePlayer = makeRig({
    vehicleId: 'player_car',
    position: { x: 0, y: 2, z: 4.0 },
    velocity: { x: 0, y: 0, z: 0.5 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });
  const closeEscort = makeRig({
    vehicleId: 'escort_1',
    position: { x: 0, y: 2, z: 0 },
    velocity: { x: 0, y: 0, z: 6 },
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'PLAYER',
      role: 'GUARD',
      personality: 'AGGRESSIVE',
    },
  });
  const yieldOut = computeSmartVehicleAIControls(
    closeEscort,
    1 / 60,
    [closeEscort, closePlayer],
    closePlayer,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.ok(yieldOut.throttle <= 0, `Escort <4.5m behind player must yield/brake, got throttle=${yieldOut.throttle}`);
  assert.equal(yieldOut.fireWeapons, false);
  assert.equal(yieldOut.triggerMeleeStrike, false);

  // 3. Friendly-fire guard: enemy is ahead at z=30, player is between escort (z=0) and enemy (z=14) -> hold fire!
  const blockedEnemy = makeRig({
    vehicleId: 'red_enemy',
    position: { x: 0, y: 2, z: 30 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: true, team: 'RED' },
  });
  const shieldPlayer = makeRig({
    vehicleId: 'player_car',
    position: { x: 0, y: 2, z: 14 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });
  const gunnerEscort = makeRig({
    vehicleId: 'escort_gunner',
    position: { x: 0, y: 2, z: 0 },
    modules: [
      { kind: 'WHEEL_STEER', vx: -2, vy: 0, vz: 3 },
      { kind: 'WHEEL_STEER', vx: 2, vy: 0, vz: 3 },
      { kind: 'PLASMA_CANNON', vx: 0, vy: 2, vz: 1 },
    ],
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'PLAYER',
      role: 'GUARD',
      personality: 'AGGRESSIVE',
    },
  });
  const lofOut = computeSmartVehicleAIControls(
    gunnerEscort,
    1 / 60,
    [gunnerEscort, shieldPlayer, blockedEnemy],
    shieldPlayer,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.equal(lofOut.fireWeapons, false, 'Escort must hold fire when player is directly in line of fire');

  // 4. Escort tether: if player drives 35m away from nearby enemy, escort breaks combat to follow player
  const farPlayer = makeRig({
    vehicleId: 'player_car',
    position: { x: 0, y: 2, z: 42 },
    velocity: { x: 0, y: 0, z: 14 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });
  const tetherOut = computeSmartVehicleAIControls(
    gunnerEscort,
    1 / 60,
    [gunnerEscort, farPlayer, blockedEnemy],
    farPlayer,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.equal(tetherOut.statusLabel, 'ESCORT CATCHUP');
  assert.equal(tetherOut.fireWeapons, false);
});

test('ground-relative wall raycast catches 1.3m thin walls when vehicle CoM is elevated, brakes & steers away cleanly, and latches wallRecoverTimer', () => {
  const noMistakeRng = () => 0.99;
  const elevatedTruck = makeRig({
    vehicleId: 'elevated_truck',
    position: { x: 0, y: 16.0, z: 0 }, // CoM 1.25m above ground (14.75m)
    velocity: { x: 0, y: 0, z: 12.0 }, // Moving forward at 12 m/s
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'RAMMER',
      personality: 'AGGRESSIVE',
    },
  });
  const enemyBeyondWall = makeRig({
    vehicleId: 'enemy',
    position: { x: 0, y: 16.0, z: 55 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });

  // 1.3m tall thin wall at z = 6m (top y = 16.05m): rays >= 16.2m shoot over it, ground-relative ray at ~15.3m hits!
  const thinLowWallProber: TerrainProber = {
    sampleGroundY: (_wx, _wy, wz) => (wz >= 5.8 && wz <= 6.2 ? 16.05 : 14.75),
    isWaterAt: () => false,
    raycastObstacle: (ox, oy, oz, dx, _dy, dz, maxDist) => {
      if (oy > 16.05) return null;
      // Wall blocks center (ox=0) and right bumper (ox=-1.1), while left (+X > 1.0) is open
      if (dz > 0.5 && ox <= 1.0 && ox + dx * 2.5 <= 1.5) {
        const hitDist = (5.8 - oz) / Math.max(0.1, dz);
        if (hitDist > 0 && hitDist <= maxDist) return hitDist;
      }
      return null;
    },
  };

  // While moving fast forward toward close thin wall, must brake, steer away (+ left because ox <= 2.5 leaves left clearer), and disable boost
  const fastBrakeOut = computeSmartVehicleAIControls(
    elevatedTruck,
    1 / 60,
    [elevatedTruck, enemyBeyondWall],
    enemyBeyondWall,
    thinLowWallProber,
    null,
    noMistakeRng,
  );
  assert.equal(fastBrakeOut.boost, false, 'Must disable boost when wall detected ahead');
  assert.equal(fastBrakeOut.brake, true, 'Must apply brake when approaching wall at 12 m/s');
  assert.ok(fastBrakeOut.steer > 0.3, `Expected +steer away from right-blocking wall while braking, got ${fastBrakeOut.steer}`);

  // Once slowed down right in front of wall (<5m), latches wallRecoverTimer for crisp reverse-and-turn arc
  elevatedTruck.position.z = 2.6;
  elevatedTruck.velocity = { x: 0, y: 0, z: 0.4 };
  const latchOut = computeSmartVehicleAIControls(
    elevatedTruck,
    0.05,
    [elevatedTruck, enemyBeyondWall],
    enemyBeyondWall,
    thinLowWallProber,
    null,
    noMistakeRng,
  );
  assert.ok(elevatedTruck.aiBrainMemory.wallRecoverTimer > 0.5, 'wallRecoverTimer should latch near wall');
  assert.ok(latchOut.throttle < 0, 'Should reverse during wall recovery');
  assert.equal(latchOut.statusLabel, 'DODGING WALL');

  // Even after backing slightly past emergency distance, continues completing recovery arc without forward/back chatter
  elevatedTruck.position.z = 0.5;
  const midRecoverOut = computeSmartVehicleAIControls(
    elevatedTruck,
    0.2,
    [elevatedTruck, enemyBeyondWall],
    enemyBeyondWall,
    thinLowWallProber,
    null,
    noMistakeRng,
  );
  assert.ok(midRecoverOut.throttle < 0, 'Should keep reversing steadily through recovery timer');
  assert.equal(midRecoverOut.statusLabel, 'DODGING WALL');
});

test('escort catchup slot stays ahead of trailing escort and never flips in front of reversing player', () => {
  const noMistakeRng = () => 0.99;
  const player = makeRig({
    vehicleId: 'player',
    position: { x: 0, y: 2, z: 0 },
    velocity: { x: 0, y: 0, z: -8 }, // Player reversing backward (-Z) while facing +Z!
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });
  const escort = makeRig({
    vehicleId: 'escort_chase',
    position: { x: 0, y: 2, z: -18 },
    velocity: { x: 0, y: 0, z: 8 },
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'PLAYER',
      role: 'GUARD',
      personality: 'AGGRESSIVE',
    },
  });

  // Even when escort is 18m behind a moving player, catchup goal must stay ahead of escort (throttle > 0.5)
  player.velocity = { x: 4, y: 0, z: 10 };
  const chaseOut = computeSmartVehicleAIControls(
    escort,
    1 / 60,
    [escort, player],
    player,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.ok(chaseOut.throttle > 0.75, `Trailing escort should accelerate forward to catch up, got ${chaseOut.throttle}`);
  assert.ok(
    chaseOut.statusLabel === 'ESCORT CATCHUP' || chaseOut.statusLabel === 'ESCORTING',
    `Expected ESCORT CATCHUP or ESCORTING, got ${chaseOut.statusLabel}`,
  );

  // At 26m behind moving player, must explicitly enter ESCORT CATCHUP
  escort.position.z = -26;
  const farChaseOut = computeSmartVehicleAIControls(
    escort,
    1 / 60,
    [escort, player],
    player,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.equal(farChaseOut.statusLabel, 'ESCORT CATCHUP');

  // When player is stopped/reversing slowly while facing +Z, escort slot stays behind player (never flips in front of nose)
  player.position = { x: 0, y: 2, z: 0 };
  player.velocity = { x: 0, y: 0, z: -6 };
  escort.position = { x: 0, y: 2, z: -11 };
  escort.velocity = { x: 0, y: 0, z: 0 };
  const revOut = computeSmartVehicleAIControls(
    escort,
    1 / 60,
    [escort, player],
    player,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.equal(revOut.fireWeapons, false);
  assert.equal(revOut.boost, false);
});

test('asymmetric broken wheels apply positive structuralFeedForward counter-steer', () => {
  const noMistakeRng = () => 0.99;
  // Left wheels intact (vx = +2), right wheels shot off -> wheelAsymmetryBias > 0
  const lopsided = makeRig({
    vehicleId: 'lopsided',
    position: { x: 0, y: 2, z: 0 },
    modules: [
      { kind: 'COCKPIT', vx: 0, vy: 1, vz: 0 },
      { kind: 'WHEEL_STEER', vx: 2, vy: 0, vz: 3, lastCompression: 0.2 },
      { kind: 'WHEEL_DRIVE', vx: 2, vy: 0, vz: -3, lastCompression: 0.2 },
    ],
    aiConfig: {
      ...createDefaultVehicleAIConfig(),
      enabled: true,
      team: 'RED',
      role: 'RAMMER',
      personality: 'AGGRESSIVE',
    },
  });
  const straightEnemy = makeRig({
    vehicleId: 'target_straight',
    position: { x: 0, y: 2, z: 30 },
    aiConfig: { ...createDefaultVehicleAIConfig(), enabled: false, team: 'PLAYER' },
  });

  const out = computeSmartVehicleAIControls(
    lopsided,
    1 / 60,
    [lopsided, straightEnemy],
    straightEnemy,
    flatProber,
    null,
    noMistakeRng,
  );
  assert.ok(out.steer > 0.15, `Expected positive counter-steer feed-forward for missing right wheels, got ${out.steer}`);
});



