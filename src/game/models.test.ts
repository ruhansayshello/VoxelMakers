import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import {
  createDetailedWheelMesh,
  createDetailedThrusterMesh,
  createDetailedOutboardMesh,
  createDetailedCockpitMesh,
  createDetailedModuleMesh,
  getMatteRubberMat,
  getMachinedMetalMat,
  getEmissiveNeonMat,
  getCockpitGlassMat,
  getSharedGeoCacheSize,
} from './models.ts';
import {
  createArticulatedPlayerRig,
  createProceduralPlayerRig,
  updateCharacterAnimation,
  updateProceduralPlayer,
} from './playerModel.ts';
import {
  computeEngineAudioParams,
  computeThrusterRoarParams,
  computeCollisionClangParams,
  computeWeaponBlastParams,
  computeAmbientWindDebrisParams,
} from './audio.ts';
import { VEHICLE_PRESETS } from './vehiclePresets.ts';
import { computeAdaptivePhysicsSubsteps, type ActiveModule } from './vehicle.ts';
import {
  evaluateDebrisChunkThrottling,
  DEBRIS_MAX_DIST_SQ,
} from './fx.ts';
import {
  getWasmGreedyKernel,
  WASM_MASK_BYTE_OFFSET,
  WASM_QUADS_BYTE_OFFSET,
  WASM_MAX_QUADS_PER_SLICE,
} from './wasmGreedyMesher.ts';

describe('Vehicle Models & Materials Overhaul', () => {
  it('generates unified materials with distinct mechanical slots', () => {
    const rubberMat = getMatteRubberMat(false, false) as THREE.MeshStandardMaterial;
    assert.strictEqual(rubberMat.roughness, 0.92);
    assert.strictEqual(rubberMat.metalness, 0.08);

    const metalMat = getMachinedMetalMat(0x64748b, 0.38, 0.65) as THREE.MeshStandardMaterial;
    assert.strictEqual(metalMat.roughness, 0.38);
    assert.strictEqual(metalMat.metalness, 0.65);

    const neonMat = getEmissiveNeonMat(0xff6600, 2.0) as THREE.MeshStandardMaterial;
    assert.strictEqual(neonMat.emissive.getHex(), 0xff6600);
    assert.strictEqual(neonMat.emissiveIntensity, 2.0);

    const glassMat = getCockpitGlassMat(0x38bdf8, 0.6) as THREE.MeshPhongMaterial;
    assert.strictEqual(glassMat.transparent, true);
    assert.strictEqual(glassMat.opacity, 0.6);
  });

  it('builds All-Terrain Wheel with dual-axis steering and roll pivot hierarchy', () => {
    const mod: ActiveModule = {
      kind: 'WHEEL_STEER',
      vx: 5,
      vy: 5,
      vz: 25,
      yawIdx: 0,
      mesh: null,
      wheelMesh: null,
      spinMesh: null,
      lastCompression: 0,
    };

    const wheelMesh = createDetailedWheelMesh(mod, false, false);
    assert.ok(wheelMesh instanceof THREE.Group);
    assert.ok(wheelMesh.userData.steerPivot, 'Should have steerPivot node for steering angle Y');
    assert.ok(wheelMesh.userData.rollGroup, 'Should have rollGroup node for wheel roll spin X');
    assert.strictEqual(mod.wheelMesh, wheelMesh.userData.steerPivot, 'mod.wheelMesh should point to steerPivot');
  });

  it('builds Dragon Jet Thruster with multi-tiered casing and dynamic flame core', () => {
    const mod: ActiveModule = {
      kind: 'THRUSTER',
      vx: 9,
      vy: 7,
      vz: 6,
      yawIdx: 0,
      mesh: null,
      wheelMesh: null,
      spinMesh: null,
      lastCompression: 0,
    };

    const thrusterMesh = createDetailedThrusterMesh(mod, false, false);
    assert.ok(thrusterMesh instanceof THREE.Group);
    assert.ok(thrusterMesh.userData.flameCore, 'Should expose flameCore for boost scaling');
    assert.ok(thrusterMesh.userData.nozzleBell, 'Should have exhaust nozzle bell');
  });

  it('builds Outboard Marine Motor with vertical drive shaft, cavitation plate, and 3-blade propeller', () => {
    const mod: ActiveModule = {
      kind: 'BOAT_OUTBOARD',
      vx: 6,
      vy: 5,
      vz: 5,
      yawIdx: 0,
      mesh: null,
      wheelMesh: null,
      spinMesh: null,
      lastCompression: 0,
    };

    const outboardMesh = createDetailedOutboardMesh(mod, false, false);
    assert.ok(outboardMesh instanceof THREE.Group);
    const propHub = outboardMesh.userData.propellerHub as THREE.Group;
    assert.ok(propHub, 'Should have isolated propellerHub sub-mesh');
    assert.strictEqual(mod.spinMesh, propHub, 'mod.spinMesh should be set to propellerHub for rotation');

    // Count blades inside propellerHub (3 blades + prop center + nose)
    const bladeGroups = propHub.children.filter((ch) => ch.children.length > 0);
    assert.strictEqual(bladeGroups.length, 3, 'Propeller hub should contain 3 curved blades');
  });

  it('builds Cockpit module with tubular roll-cage struts and windshield glass', () => {
    const mod: ActiveModule = {
      kind: 'COCKPIT',
      vx: 12,
      vy: 7,
      vz: 18,
      yawIdx: 0,
      mesh: null,
      wheelMesh: null,
      spinMesh: null,
      lastCompression: 0,
    };

    const cockpitMesh = createDetailedCockpitMesh(mod, false, false);
    assert.ok(cockpitMesh instanceof THREE.Group);
    // Find windshield mesh with transparent glass
    let hasGlass = false;
    cockpitMesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
        if (child.material.transparent && child.material.opacity === 0.6) {
          hasGlass = true;
        }
      }
    });
    assert.ok(hasGlass, 'Cockpit should contain translucent glass element');
  });

  it('optimizes module hierarchy with shared geometry caching, frustumCulled = true, cached boundingSphere, and matrixAutoUpdate = false on static sub-meshes', () => {
    const weaponKinds = ['PLASMA_CANNON', 'WEAPON_MINIGUN', 'WEAPON_ROCKET', 'WEAPON_BOMB_BAY', 'GRAPPLING_WINCH'] as const;
    for (const kind of weaponKinds) {
      const mod: ActiveModule = {
        kind,
        vx: 10,
        vy: 8,
        vz: 10,
        yawIdx: 0,
        mesh: null,
        wheelMesh: null,
        spinMesh: null,
        lastCompression: 0,
      };
      const meshGroup = createDetailedModuleMesh(mod, false);
      assert.ok(meshGroup instanceof THREE.Group);
      assert.strictEqual(meshGroup.frustumCulled, true, 'Root module group should have frustumCulled = true');
      if (kind !== 'GRAPPLING_WINCH') {
        assert.ok(meshGroup.userData.turretPivot, `${kind} should expose turretPivot for crosshair aiming`);
      } else {
        assert.ok(meshGroup.userData.winchHookClaw, 'GRAPPLING_WINCH should expose winchHookClaw');
      }
      let staticMeshChecked = false;
      meshGroup.traverse((child) => {
        assert.strictEqual(child.frustumCulled, true, 'Every child node should have frustumCulled = true');
        if (child instanceof THREE.Mesh) {
          assert.strictEqual(child.geometry.userData.isSharedPrimitive, true, 'Geometry should be tagged isSharedPrimitive');
          assert.ok(child.geometry.boundingSphere !== null, 'Shared geometry should have precomputed boundingSphere');
          assert.strictEqual(child.matrixAutoUpdate, false, 'Static child mesh should have matrixAutoUpdate = false');
          staticMeshChecked = true;
        }
      });
      assert.ok(staticMeshChecked);
    }
    assert.ok(getSharedGeoCacheSize() > 0, 'Shared geometry cache should populate');
  });

  it('adapts physics substeps (2 at rest/low speed, 4 at >5 m/s, velocity-scaled up to 16 at 1000 km/h) and throttles debris chunks', () => {
    assert.strictEqual(computeAdaptivePhysicsSubsteps(0.0, 0.0, false, false), 2, 'Rest state uses 2 substeps');
    assert.strictEqual(computeAdaptivePhysicsSubsteps(0.8, 0.2, false, false), 2, '<1.0 m/s without collision uses 2 substeps');
    assert.strictEqual(computeAdaptivePhysicsSubsteps(6.2, 0.1, false, false), 4, '>5.0 m/s scales to 4 substeps');
    assert.strictEqual(computeAdaptivePhysicsSubsteps(0.5, 1.8, false, false), 4, 'High angular velocity scales to 4 substeps');
    assert.strictEqual(computeAdaptivePhysicsSubsteps(0.4, 0.1, true, false), 4, 'Active collision scales to 4 substeps');
    assert.strictEqual(computeAdaptivePhysicsSubsteps(90.0, 0.2, false, false, 1 / 60), 16, '90 m/s (324 km/h) scales to 16 substeps with quarter-voxel step size');
    assert.strictEqual(computeAdaptivePhysicsSubsteps(278.0, 0.5, false, false, 1 / 60), 16, '278 m/s (1000 km/h) caps at 16 substeps');
    assert.strictEqual(computeAdaptivePhysicsSubsteps(10.0, 0.0, false, true), 1, 'Build mode uses 1 substep');

    // Debris chunk sleep after 1.5s below 0.1 m/s
    const step1 = evaluateDebrisChunkThrottling(0.05, 0.8, 100, 0.8);
    assert.strictEqual(step1.shouldDespawn, false);
    assert.strictEqual(step1.sleeping, true, 'Debris below 0.1 m/s for >=1.5s should sleep');

    // Debris chunk despawn beyond 75m
    const farStep = evaluateDebrisChunkThrottling(2.0, 0, DEBRIS_MAX_DIST_SQ + 10, 0.016);
    assert.strictEqual(farStep.shouldDespawn, true, 'Debris >75m from player/camera should despawn');
  });

  it('builds Articulated 3D Sci-Fi Engineer Rig and animates Idle, Walk, Jump, and Seated Driving Pose', () => {
    const rig = createArticulatedPlayerRig('#38bdf8');
    assert.ok(rig.rootGroup instanceof THREE.Group);
    assert.ok(rig.pelvisGroup instanceof THREE.Group);
    assert.ok(rig.torsoMesh instanceof THREE.Mesh);
    assert.ok(rig.headGroup instanceof THREE.Group);
    assert.ok(rig.leftArmPivot instanceof THREE.Group);
    assert.ok(rig.rightArmPivot instanceof THREE.Group);
    assert.ok(rig.leftLegPivot instanceof THREE.Group);
    assert.ok(rig.rightLegPivot instanceof THREE.Group);
    assert.ok(rig.toolMountNode instanceof THREE.Group);

    // 1. Walk animation + Plasma Rifle equipped
    updateCharacterAnimation(
      rig,
      {
        walkSpeed: 7.5,
        isSprinting: false,
        isAirborne: false,
        isSeated: false,
        steerAngle: 0,
        lookPitch: 0.25,
        isBuildMode: false,
        equippedTool: 'PLASMA_RIFLE',
      },
      0.1,
    );
    assert.strictEqual(rig.toolMeshes.PLASMA_RIFLE?.visible, true);
    assert.strictEqual(rig.toolMeshes.SLEDGE?.visible, false);
    assert.ok(Math.abs(rig.leftLegPivot.rotation.x) > 0.01, 'Legs should swing during walk');

    // 2. Seated Driving Pose with steering angle
    updateCharacterAnimation(
      rig,
      {
        walkSpeed: 0,
        isSprinting: false,
        isAirborne: false,
        isSeated: true,
        steerAngle: 0.45,
        lookPitch: 0,
        isBuildMode: false,
        equippedTool: 'PLASMA_RIFLE',
      },
      0.016,
    );
    assert.ok(Math.abs(rig.leftLegPivot.rotation.x - -Math.PI * 0.42) < 1e-4, 'Seated legs should bend forward -Math.PI * 0.42');
    assert.ok(Math.abs(rig.rightLegPivot.rotation.x - -Math.PI * 0.42) < 1e-4, 'Seated legs should bend forward -Math.PI * 0.42');
    assert.notStrictEqual(rig.leftArmPivot.rotation.x, rig.rightArmPivot.rotation.x, 'Arms should tilt asymmetrically when steering');
    assert.strictEqual(rig.toolMeshes.PLASMA_RIFLE?.visible, false, 'Handheld tools should hide while seated');

    // 3. Driving state hides rootGroup.visible = false so vehicle seats stay empty
    updateProceduralPlayer(
      rig,
      {
        walkSpeed: 0,
        isDriving: true,
        isSeated: true,
      },
      0.016,
    );
    assert.strictEqual(rig.rootGroup.visible, false, 'isDriving: true should hide rig.rootGroup');

    // 4. Airborne state tucks legs (-0.4), bends knees (0.6), and pulses backpack nozzles to 2.5
    const rigAir = createProceduralPlayerRig('#38bdf8');
    updateProceduralPlayer(
      rigAir,
      {
        walkSpeed: 4.0,
        isGrounded: false,
        isDriving: false,
      },
      0.05,
    );
    assert.strictEqual(rigAir.rootGroup.visible, true);
    assert.ok(Math.abs(rigAir.leftLegPivot.rotation.x - -0.4) < 1e-4, 'Airborne legs should tuck forward -0.4');
    assert.ok(Math.abs(rigAir.leftKneePivot.rotation.x - 0.6) < 1e-4, 'Airborne knees should bend to 0.6');
    assert.strictEqual(rigAir.nozzleMat.emissiveIntensity, 2.5, 'Airborne nozzle emissiveIntensity should pulse to 2.5');
  });

  it('computes Procedural Web Audio parameters for engine pitch (50Hz-320Hz), thruster bandpass, collision clang, and weapon blasts', () => {
    const idleEng = computeEngineAudioParams(0, 0, true);
    assert.strictEqual(idleEng.freqHz, 50, 'Engine idle frequency should be 50Hz');

    const redlineEng = computeEngineAudioParams(1.0, 140, true);
    assert.strictEqual(redlineEng.freqHz, 320, 'Engine redline frequency should reach 320Hz');
    assert.ok(redlineEng.lowpassCutoffHz > idleEng.lowpassCutoffHz, 'Lowpass cutoff should open with throttle/speed');

    const thrOff = computeThrusterRoarParams(0, false);
    assert.strictEqual(thrOff.gain, 0, 'Inactive thruster should have 0 gain');
    const thrBoost = computeThrusterRoarParams(1.0, true);
    assert.ok(thrBoost.gain > 0.15 && thrBoost.bandpassFreqHz > 1000, 'Boosting thruster should scale bandpass frequency and gain');

    const lightClang = computeCollisionClangParams(2.0);
    const heavyClang = computeCollisionClangParams(22.0);
    assert.ok(heavyClang.gain > lightClang.gain, 'Collision clang gain should scale with impact impulse');
    assert.ok(heavyClang.decaySec > lightClang.decaySec, 'Heavy collision clang should decay longer');

    const plasmaBlast = computeWeaponBlastParams('PLASMA');
    const rocketBlast = computeWeaponBlastParams('ROCKET');
    assert.ok(plasmaBlast.snapStartHz > plasmaBlast.snapEndHz, 'Weapon blast should include high-freq snap sweep');
    assert.ok(rocketBlast.noiseDurSec > plasmaBlast.noiseDurSec, 'Rocket blast should have longer low-end noise burst');

    const calmWind = computeAmbientWindDebrisParams(0, 10, 0);
    const fastWind = computeAmbientWindDebrisParams(160, 80, 0.8);
    assert.ok(fastWind.windGain > calmWind.windGain, 'Ambient wind gain should scale with speed and altitude');
    assert.ok(fastWind.debrisGain > calmWind.debrisGain, 'Distant debris gain should scale with debris intensity');

    const wasmKernel = getWasmGreedyKernel();
    assert.ok(wasmKernel !== null, 'WASM 2D greedy mask kernel should compile and instantiate');
    wasmKernel!.maskView.fill(0, 0, 16);
    // 2x2 block of material 5 in a 4x4 slice
    wasmKernel!.maskView[0] = 5;
    wasmKernel!.maskView[1] = 5;
    wasmKernel!.maskView[4] = 5;
    wasmKernel!.maskView[5] = 5;
    const qCount = wasmKernel!.exports.mergeMask2D(
      4,
      4,
      WASM_MASK_BYTE_OFFSET,
      WASM_QUADS_BYTE_OFFSET,
      WASM_MAX_QUADS_PER_SLICE,
    );
    assert.strictEqual(qCount, 1, 'WASM kernel should merge 2x2 block into 1 quad');
    assert.strictEqual(wasmKernel!.quadsView[2], 2, 'Merged quad width should be 2');
    assert.strictEqual(wasmKernel!.quadsView[3], 2, 'Merged quad height should be 2');
    assert.strictEqual(wasmKernel!.quadsView[4], 5, 'Merged quad material code should be 5');
  });

  it('loads starter builds with upgraded modular components from VEHICLE_PRESETS', () => {
    assert.ok(VEHICLE_PRESETS.length >= 7);
    const buggy = VEHICLE_PRESETS[0];
    assert.strictEqual(buggy.category, 'Buggy');
    assert.ok(buggy.modules.some((m) => m.kind === 'COCKPIT'));
    assert.ok(buggy.modules.some((m) => m.kind === 'V8_ENGINE'));
    assert.ok(buggy.modules.some((m) => m.kind === 'WHEEL_STEER'));

    const heavyTruck = VEHICLE_PRESETS[1];
    assert.strictEqual(heavyTruck.category, 'Heavy Truck');
    assert.ok(heavyTruck.modules.some((m) => m.kind === 'PLASMA_CANNON'));

    const boat = VEHICLE_PRESETS[3];
    assert.strictEqual(boat.category, 'Speedboat');
    assert.ok(boat.modules.some((m) => m.kind === 'BOAT_OUTBOARD'));

    const bike = VEHICLE_PRESETS[6];
    assert.strictEqual(bike.category, 'Jet Bike');
    assert.ok(bike.modules.some((m) => m.kind === 'SEAT_MOTO'));
    assert.ok(bike.modules.some((m) => m.kind === 'ENGINE_DRAGON'));
  });
});

