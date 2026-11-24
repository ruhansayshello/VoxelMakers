import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluateEcuProgram,
  evaluateEcuExpression,
  LED_PATTERNS,
  ECU_STARTER_TEMPLATES,
  serializeEcuProgramToJson,
  parseAndValidateEcuProgramJson,
  loadSavedEcuPrograms,
  saveEcuProgramToLibrary,
  deleteSavedEcuProgramFromLibrary,
  type SensorTelemetryContext,
  type EcuProgram,
} from './logicSystem.ts';
import {
  isWheelOrTireModuleKind,
  TIRE_TRACTION_PRESETS,
  MAT,
} from './constants.ts';
import {
  computeWheelTractionMultipliers,
  solveTireForces,
} from './physicsMath.ts';
import {
  classifyCriticalModuleKind,
  extractVehicleCriticalModuleMarkers,
  resolveIntegritySymbolColor,
  resolveSilhouetteCellColor,
} from './ui/vehicleIntegrityDiagram.tsx';
import {
  sampleTacticalMapTerrain,
  computeNavigationMetrics,
  computeMultiRouteSummary,
  appendVehicleTrailPoint,
  formatCompassCardinal,
} from './ui/fullScreenMap.tsx';

describe('Micro:bit ECU Programmable Logic System Tests', () => {
  it('LED_PATTERNS all have exactly 25 pixels (5x5)', () => {
    for (const [key, pattern] of Object.entries(LED_PATTERNS)) {
      assert.strictEqual(pattern.length, 25, `Pattern ${key} must have exactly 25 elements`);
      for (const val of pattern) {
        assert.ok(val === 0 || val === 1, `Pixel in ${key} must be 0 or 1`);
      }
    }
  });

  it('Hardware Gating: Missing or uninstalled sensor returns 0 and flags missing signal', () => {
    const ctx: SensorTelemetryContext = {
      distances: {},
      imus: {},
      speedos: {},
      radars: {},
      keys: {},
      dt: 0.016,
    };

    const missingPorts: string[] = [];
    const res = evaluateEcuExpression(
      { kind: 'READ_SENSOR', portId: 'DIST_1', property: 'distance' },
      ctx,
      missingPorts,
    );

    assert.strictEqual(res.value, 0);
    assert.strictEqual(res.hasSignal, false);
    assert.deepStrictEqual(missingPorts, ['DIST_1']);
  });

  it('Hardware Gating: Severed sensor (hasSignal=false) causes ECU to display ERROR_X', () => {
    const ctx: SensorTelemetryContext = {
      distances: {
        DIST_1: { distanceMeters: 0, hasSignal: false }, // destroyed in combat!
      },
      imus: {},
      speedos: {},
      radars: {},
      keys: {},
      dt: 0.016,
    };

    const program: EcuProgram = {
      id: 'test_brake',
      name: 'Test Brake',
      enabled: true,
      rules: [
        {
          id: 'rule_1',
          name: 'Obstacle Detection',
          event: 'TICK',
          actions: [
            {
              kind: 'IF_THEN',
              condition: {
                kind: 'COMPARE',
                op: '<',
                left: { kind: 'READ_SENSOR', portId: 'DIST_1', property: 'distance' },
                right: { kind: 'NUMBER_CONST', value: 8 },
              },
              thenActions: [
                { kind: 'SET_LED_MATRIX', icon: 'WARNING' },
              ],
            },
          ],
        },
      ],
    };

    const output = evaluateEcuProgram(program, ctx);
    assert.strictEqual(output.missingHardwareError, true);
    assert.ok(output.missingPorts.includes('DIST_1'));
    assert.strictEqual(output.ledMatrixIcon, 'ERROR_X');
  });

  it('Normal Operation: Intact sensors evaluate logic, math, clamps, and triggers correctly', () => {
    const ctx: SensorTelemetryContext = {
      distances: {
        DIST_1: { distanceMeters: 4.2, hasSignal: true },
      },
      imus: {
        IMU_1: { pitchDeg: 12.5, rollDeg: -2.0, hasSignal: true },
      },
      speedos: {
        SPEED_1: { speedKmh: 45.0, altitudeMeters: 14.0, hasSignal: true },
      },
      radars: {
        RADAR_1: { targetAngleDeg: 15.0, targetDistanceMeters: 25.0, hasSignal: true },
      },
      keys: { Space: true },
      dt: 0.016,
    };

    // 1. Math and Clamp
    const clampRes = evaluateEcuExpression(
      {
        kind: 'CLAMP',
        val: {
          kind: 'MATH_OP',
          op: '*',
          left: { kind: 'READ_SENSOR', portId: 'IMU_1', property: 'pitch' },
          right: { kind: 'NUMBER_CONST', value: 4 },
        },
        min: { kind: 'NUMBER_CONST', value: 10 },
        max: { kind: 'NUMBER_CONST', value: 40 },
      },
      ctx,
    );
    assert.strictEqual(clampRes.hasSignal, true);
    assert.strictEqual(clampRes.value, 40); // 12.5 * 4 = 50 -> clamped to 40

    // 2. Starter template Auto-Brake executes with intact distance sensor
    const brakeOutput = evaluateEcuProgram(ECU_STARTER_TEMPLATES.AUTO_BRAKE.program, ctx);
    assert.strictEqual(brakeOutput.missingHardwareError, false);
    assert.strictEqual(brakeOutput.thrusters['ALL_THRUSTERS'], 0);
    assert.strictEqual(brakeOutput.ledMatrixIcon, 'WARNING');

    // 3. Starter template Auto-Turret tracks target angle
    const turretOutput = evaluateEcuProgram(ECU_STARTER_TEMPLATES.AUTO_TURRET.program, ctx);
    assert.strictEqual(turretOutput.missingHardwareError, false);
    assert.strictEqual(turretOutput.hinges['HINGE_1'], 15.0);
    assert.strictEqual(turretOutput.ledMatrixIcon, 'TARGET');

    // 4. Cruise Control starter template boosts thrusters when speed < 60 km/h
    const cruiseOutput = evaluateEcuProgram(ECU_STARTER_TEMPLATES.CRUISE_CONTROL.program, ctx);
    assert.strictEqual(cruiseOutput.missingHardwareError, false);
    assert.strictEqual(cruiseOutput.thrusters['ALL_THRUSTERS'], 0.85);
    assert.strictEqual(cruiseOutput.ledMatrixIcon, 'BAR_GRAPH');
  });

  it('ECU Program Save Library & JSON Share/Import round-trips cleanly', () => {
    const storeMap = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storeMap.set(k, v);
      },
    };

    const json = serializeEcuProgramToJson(ECU_STARTER_TEMPLATES.CRUISE_CONTROL.program);
    const parsed = parseAndValidateEcuProgramJson(json);
    assert.strictEqual(parsed.ok, true);
    if (parsed.ok) {
      assert.strictEqual(parsed.program.name, 'Speedo Cruise Control');
      assert.strictEqual(parsed.program.rules.length, 1);
    }

    // Save to library and load back
    const { saved, list } = saveEcuProgramToLibrary(
      ECU_STARTER_TEMPLATES.AUTO_HOVER.program,
      'My Hover ECU',
      mockStorage,
    );
    assert.strictEqual(saved.name, 'My Hover ECU');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(loadSavedEcuPrograms(mockStorage).length, 1);

    // Delete from library
    const afterDel = deleteSavedEcuProgramFromLibrary(saved.id, mockStorage);
    assert.strictEqual(afterDel.length, 0);

    // Reject malformed JSON
    const badRes = parseAndValidateEcuProgramJson('{broken json');
    assert.strictEqual(badRes.ok, false);
  });

  it('Wheel Forward & Sideways Traction tuning scales longitudinal drive and lateral cornering independently', () => {
    assert.strictEqual(isWheelOrTireModuleKind('WHEEL_STEER'), true);
    assert.strictEqual(isWheelOrTireModuleKind('WHEEL_RACING'), true);
    assert.strictEqual(isWheelOrTireModuleKind('COCKPIT'), false);
    assert.ok(TIRE_TRACTION_PRESETS.length >= 6);

    const clamped = computeWheelTractionMultipliers({
      forwardTraction: 5.0,
      sidewaysTraction: 0.01,
    });
    assert.strictEqual(clamped.forwardTraction, 3.0);
    assert.strictEqual(clamped.sidewaysTraction, 0.1);

    const baseInput = {
      compression: 0.15,
      restLen: 0.4,
      kSpring: 12000,
      cDamperBump: 1200,
      cDamperRebound: 1600,
      relVelY: 0,
      vLong: 5.0,
      vLat: 3.0,
      throttle: 1.0,
      brake: false,
      isPowered: true,
      engineForcePerWheel: 3500,
      topSpeedMPS: 40,
      surfaceMu: 1.0,
      wheelLoadCap: 15000,
    };

    const driftTire = solveTireForces({
      ...baseInput,
      forwardTraction: 1.4,
      sidewaysTraction: 0.3,
    });
    const slickTire = solveTireForces({
      ...baseInput,
      forwardTraction: 1.4,
      sidewaysTraction: 1.8,
    });

    // Racing slick has much stronger lateral cornering force than drift tire
    assert.ok(
      Math.abs(slickTire.fLat) > Math.abs(driftTire.fLat) * 2.5,
      `Expected slick lateral force (${Math.abs(slickTire.fLat)}) > 2.5x drift lateral force (${Math.abs(driftTire.fLat)})`,
    );

    const lowFwdTire = solveTireForces({
      ...baseInput,
      vLat: 0,
      forwardTraction: 0.4,
      sidewaysTraction: 1.0,
    });
    const highFwdTire = solveTireForces({
      ...baseInput,
      vLat: 0,
      forwardTraction: 2.2,
      sidewaysTraction: 1.0,
    });
    assert.ok(
      highFwdTire.fLong > lowFwdTire.fLong * 3.0,
      `Expected high forward traction (${highFwdTire.fLong}) > 3x low forward traction (${lowFwdTire.fLong})`,
    );
  });

  it('Damage Chart extracts critical module symbols (Seat, Thruster, Engine, Wheel, Weapon, ECU) and applies unified HP color system', () => {
    assert.strictEqual(classifyCriticalModuleKind('COCKPIT')?.category, 'SEAT');
    assert.strictEqual(classifyCriticalModuleKind('COCKPIT')?.symbolCode, '◆');
    assert.strictEqual(classifyCriticalModuleKind('THRUSTER')?.category, 'THRUSTER');
    assert.strictEqual(classifyCriticalModuleKind('THRUSTER')?.symbolCode, '▲');
    assert.strictEqual(classifyCriticalModuleKind('V8_ENGINE')?.category, 'ENGINE');
    assert.strictEqual(classifyCriticalModuleKind('WHEEL_STEER')?.category, 'WHEEL');
    assert.strictEqual(classifyCriticalModuleKind('PLASMA_CANNON')?.category, 'WEAPON');
    assert.strictEqual(classifyCriticalModuleKind('MICROBIT_ECU')?.category, 'ECU');

    const voxelMap = new Map<string, number>([['5,2,5', MAT.STEEL]]);
    const markers = extractVehicleCriticalModuleMarkers({
      voxelMap,
      modules: [
        { kind: 'COCKPIT', vx: 5, vy: 3, vz: 5, health: 1.0 },
        { kind: 'THRUSTER', vx: 5, vy: 3, vz: 2, health: 0.65 },
        { kind: 'V8_ENGINE', vx: 5, vy: 3, vz: 7, health: 0.35 },
      ],
      intactBlueprintSnapshot: {
        voxels: [[5, 2, 5, MAT.STEEL]],
        modules: [
          { kind: 'COCKPIT', vx: 5, vy: 3, vz: 5 },
          { kind: 'THRUSTER', vx: 5, vy: 3, vz: 2 },
          { kind: 'V8_ENGINE', vx: 5, vy: 3, vz: 7 },
          { kind: 'WHEEL_DRIVE', vx: 2, vy: 1, vz: 5 }, // Destroyed & missing from live modules!
        ],
      },
    });

    assert.strictEqual(markers.length, 4);
    const seatM = markers.find((m) => m.category === 'SEAT')!;
    const thrustM = markers.find((m) => m.category === 'THRUSTER')!;
    const engM = markers.find((m) => m.category === 'ENGINE')!;
    const wheelM = markers.find((m) => m.category === 'WHEEL')!;

    assert.strictEqual(seatM.hp, 100);
    assert.strictEqual(thrustM.hp, 65);
    assert.strictEqual(engM.hp, 35);
    assert.strictEqual(wheelM.hp, 0);
    assert.strictEqual(wheelM.isDestroyed, true);

    // Verify symbol colors match the exact same color system as voxel silhouette cells
    for (const hp of [95, 65, 35, 10, 0]) {
      const symColor = resolveIntegritySymbolColor({ hp, fallingOff: false }, true);
      const cellColor = resolveSilhouetteCellColor(
        {
          vx: 0,
          vz: 0,
          highestVy: 0,
          voxelKey: 0,
          damageValue: hp / 100,
          hp,
          fallingOff: false,
          impactGradient: 0,
        },
        true,
      );
      assert.strictEqual(symColor, cellColor);
    }
  });

  it('Tactical Map terrain sampler, navigation metrics, multi-route ΔY summary, and bounded vehicle trail buffer', () => {
    // 1. Proving Grounds flat tarmac near origin
    const originSample = sampleTacticalMapTerrain(0, 0);
    assert.strictEqual(originSample.biome, 'PROVING_GROUNDS');
    assert.strictEqual(originSample.isWater, false);
    assert.strictEqual(originSample.elevationMeters, 2.0);

    // 2. Coastal Hydro Basin water depth & bathymetry
    const waterSample = sampleTacticalMapTerrain(-125, 95);
    assert.strictEqual(waterSample.isWater, true);
    assert.ok(waterSample.waterDepthMeters > 1.0);
    assert.ok(waterSample.elevationMeters < 0);

    // 3. Bridge crossing over river
    const bridgeSample = sampleTacticalMapTerrain(-78, 0);
    assert.strictEqual(bridgeSample.isBridge, true);
    assert.strictEqual(bridgeSample.isRoad, true);
    assert.ok(bridgeSample.elevationMeters >= 9.5);

    // 4. Straight-line navigation metrics & elevation difference (ΔY)
    const nav = computeNavigationMetrics(
      { x: 0, y: 2.0, z: 0 },
      { x: 30, y: 14.5, z: -40 },
    );
    assert.strictEqual(nav.distance2DMeters, 50.0);
    assert.strictEqual(nav.elevationDeltaMeters, 12.5);
    assert.ok(nav.distance3DMeters > 51.0);
    assert.strictEqual(formatCompassCardinal(0), 'N');
    assert.strictEqual(formatCompassCardinal(90), 'E');

    // 5. Multi-point route leg & cumulative climb/descent calculation
    const route = computeMultiRouteSummary([
      { id: 'r1', label: 'A', x: 0, y: 2, z: 0 },
      { id: 'r2', label: 'B', x: 0, y: 12, z: -100 },
      { id: 'r3', label: 'C', x: 100, y: 7, z: -100 },
    ]);
    assert.strictEqual(route.legs.length, 2);
    assert.strictEqual(route.totalDistance2DMeters, 200);
    assert.strictEqual(route.totalClimbMeters, 10);
    assert.strictEqual(route.totalDescentMeters, 5);
    assert.strictEqual(route.netElevationDeltaMeters, 5);

    // 6. Bounded vehicle breadcrumb trail ring buffer
    let trail: Array<{ x: number; y: number; z: number }> = [];
    trail = appendVehicleTrailPoint(trail, { x: 0, y: 2, z: 0 }, 4, 2.0);
    // Tiny jitter (< 2.0m) is ignored to prevent unnecessary redraws/allocations
    trail = appendVehicleTrailPoint(trail, { x: 0.4, y: 2, z: 0.3 }, 4, 2.0);
    assert.strictEqual(trail.length, 1);

    // Moving further appends and caps at maxPoints (4)
    for (let step = 1; step <= 6; step++) {
      trail = appendVehicleTrailPoint(trail, { x: step * 5, y: 2, z: 0 }, 4, 2.0);
    }
    assert.strictEqual(trail.length, 4);
    assert.strictEqual(trail[trail.length - 1].x, 30);
  });
});


