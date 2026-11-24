import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAT, TOTAL_VX, TOTAL_VZ, VOXEL_SIZE } from '../constants.ts';
import {
  findUnsupportedTerrainVoxels,
  TERRAIN_SUPPORT_MAX_BFS_VISITED,
  TERRAIN_TEN_NEIGHBORS,
} from './terrainConnectivity.ts';
import { TerrainEntity, terrainEntityManager } from './terrainEntity.ts';
import { MicroVoxelWorld } from '../world.ts';
import { VoxelFXSystem } from '../fx.ts';
import { destroyVoxel } from './destruction.ts';
import { packVoxelKey } from './collisionPoints.ts';

function makeSparseGrid() {
  const map = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    map,
    set(x: number, y: number, z: number, mat: number) {
      if (mat === MAT.AIR) {
        map.delete(key(x, y, z));
      } else {
        map.set(key(x, y, z), mat);
      }
    },
    get(x: number, y: number, z: number): number {
      return map.get(key(x, y, z)) ?? MAT.AIR;
    },
  };
}

test('Connectivity constants: 10-neighbor connectivity and uncapped BFS (Infinity)', () => {
  assert.equal(TERRAIN_TEN_NEIGHBORS.length, 10);
  assert.equal(TERRAIN_SUPPORT_MAX_BFS_VISITED, Number.POSITIVE_INFINITY);

  const offsets = new Set(TERRAIN_TEN_NEIGHBORS.map(([x, y, z]) => `${x},${y},${z}`));
  for (const expected of [
    '0,1,0',   // Up
    '0,-1,0',  // Down
    '0,0,-1',  // N
    '0,0,1',   // S
    '1,0,0',   // E
    '-1,0,0',  // W
    '1,0,-1',  // NE
    '-1,0,-1', // NW
    '1,0,1',   // SE
    '-1,0,1',  // SW
  ]) {
    assert.ok(offsets.has(expected), `Missing neighbor offset ${expected}`);
  }
});

test('Scenario 1 (pure grid): 5-tall column, destroy #2 -> #3-5 grouped as 1 component, #1 stays', () => {
  const grid = makeSparseGrid();
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      grid.set(x, 0, z, MAT.ROCK);
    }
  }
  for (let y = 1; y <= 5; y++) {
    grid.set(0, y, 0, MAT.CONCRETE);
  }
  grid.set(0, 2, 0, MAT.AIR);

  const res = findUnsupportedTerrainVoxels({
    cvx: 0,
    cvy: 2,
    cvz: 0,
    radiusVoxels: 1,
    minWorldX: -20,
    maxWorldX: 20,
    minWorldY: 0,
    maxWorldY: 20,
    minWorldZ: -20,
    maxWorldZ: 20,
    getMat: (x, y, z) => grid.get(x, y, z),
  });

  assert.equal(res.components.length, 1, 'Unsupported column upper section must be 1 connected component');
  const fallenYs = res.components[0].map((v) => v.vy).sort((a, b) => a - b);
  assert.deepEqual(fallenYs, [3, 4, 5], 'Blocks #3, #4, #5 must fall when #2 is destroyed');
});

test('Scenario 2 (pure grid): 5-tall column with side wall at #3, destroy #2 -> #3-5 stay', () => {
  const grid = makeSparseGrid();
  for (let x = -2; x <= 4; x++) {
    for (let z = -2; z <= 2; z++) {
      grid.set(x, 0, z, MAT.ROCK);
    }
  }
  for (let y = 1; y <= 5; y++) {
    grid.set(0, y, 0, MAT.CONCRETE);
  }
  for (let y = 1; y <= 3; y++) {
    grid.set(1, y, 0, MAT.BRICK);
  }
  grid.set(0, 2, 0, MAT.AIR);

  const res = findUnsupportedTerrainVoxels({
    cvx: 0,
    cvy: 2,
    cvz: 0,
    radiusVoxels: 1,
    minWorldX: -20,
    maxWorldX: 20,
    minWorldY: 0,
    maxWorldY: 20,
    minWorldZ: -20,
    maxWorldZ: 20,
    getMat: (x, y, z) => grid.get(x, y, z),
  });

  assert.equal(res.components.length, 0);
  assert.equal(res.unsupported.length, 0, '#3-5 must stay supported through the side wall');
});

test('10-neighbor diagonal support: diagonal NE wall at #3 keeps #3-5 supported when #2 is destroyed', () => {
  const grid = makeSparseGrid();
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      grid.set(x, 0, z, MAT.ROCK);
    }
  }
  for (let y = 1; y <= 5; y++) {
    grid.set(0, y, 0, MAT.CONCRETE);
  }
  for (let y = 1; y <= 3; y++) {
    grid.set(1, y, -1, MAT.BRICK);
  }
  grid.set(0, 2, 0, MAT.AIR);

  const res = findUnsupportedTerrainVoxels({
    cvx: 0,
    cvy: 2,
    cvz: 0,
    radiusVoxels: 1,
    minWorldX: -20,
    maxWorldX: 20,
    minWorldY: 0,
    maxWorldY: 20,
    minWorldZ: -20,
    maxWorldZ: 20,
    getMat: (x, y, z) => grid.get(x, y, z),
  });

  assert.equal(res.unsupported.length, 0, 'Diagonal NE neighbor must conduct ground support to #3-5');
});

test('Scenario 3 (pure grid): 2-pillar bridge, destroy 1 pillar -> stays; destroy both -> entire bridge is 1 component', () => {
  const grid = makeSparseGrid();
  for (let x = -2; x <= 24; x++) {
    grid.set(x, 0, 0, MAT.ROCK);
  }
  for (let y = 1; y <= 5; y++) {
    grid.set(0, y, 0, MAT.STEEL);
    grid.set(20, y, 0, MAT.STEEL);
  }
  for (let x = 0; x <= 20; x++) {
    grid.set(x, 6, 0, MAT.CONCRETE);
  }

  // Destroy Pillar 1 (y = 2)
  grid.set(0, 2, 0, MAT.AIR);
  const afterOnePillar = findUnsupportedTerrainVoxels({
    cvx: 0,
    cvy: 2,
    cvz: 0,
    radiusVoxels: 1,
    minWorldX: -50,
    maxWorldX: 50,
    minWorldY: 0,
    maxWorldY: 30,
    minWorldZ: -20,
    maxWorldZ: 20,
    getMat: (x, y, z) => grid.get(x, y, z),
  });
  assert.equal(afterOnePillar.unsupported.length, 0);

  // Destroy Pillar 2 (y = 2) -> entire bridge falls as ONE connected component
  grid.set(20, 2, 0, MAT.AIR);
  const afterBothPillars = findUnsupportedTerrainVoxels({
    cvx: 20,
    cvy: 2,
    cvz: 0,
    radiusVoxels: 1,
    minWorldX: -50,
    maxWorldX: 50,
    minWorldY: 0,
    maxWorldY: 30,
    minWorldZ: -20,
    maxWorldZ: 20,
    getMat: (x, y, z) => grid.get(x, y, z),
  });
  assert.equal(afterBothPillars.components.length, 1, 'Entire unsupported bridge must form 1 unified component');
  assert.equal(afterBothPillars.components[0].length, 27);
  assert.equal(afterBothPillars.unsupported.length, 27);
});

test('Uncapped large structures: 5,200-voxel wide building (> old 500 & 4096 & 56-window caps) collapses as 1 unified component, and stays supported when anchored', () => {
  const grid = makeSparseGrid();
  // Ground plane at y = 0
  for (let x = -2; x <= 82; x++) {
    for (let z = -2; z <= 12; z++) {
      grid.set(x, 0, z, MAT.ROCK);
    }
  }
  // Single support pillar at x = 0, y = 1..2, z = 0
  grid.set(0, 1, 0, MAT.STEEL);
  grid.set(0, 2, 0, MAT.STEEL);
  // Second support pillar far away at x = 79, y = 1..2, z = 0 (past old 56-voxel window!)
  grid.set(79, 1, 0, MAT.STEEL);
  grid.set(79, 2, 0, MAT.STEEL);

  // Massive 80 x 13 x 5 = 5,200-voxel structure resting on top at y = 3..7, x = 0..79, z = 0..12
  for (let x = 0; x < 80; x++) {
    for (let z = 0; z < 13; z++) {
      for (let y = 3; y <= 7; y++) {
        grid.set(x, y, z, MAT.CONCRETE);
      }
    }
  }

  // Sever left pillar only -> far right pillar at x=79 (79 voxels away!) still supports the entire 5,200-voxel structure!
  grid.set(0, 1, 0, MAT.AIR);
  const stillSupported = findUnsupportedTerrainVoxels({
    cvx: 0,
    cvy: 1,
    cvz: 0,
    radiusVoxels: 1,
    minWorldX: -10,
    maxWorldX: 90,
    minWorldY: 0,
    maxWorldY: 30,
    minWorldZ: -10,
    maxWorldZ: 20,
    getMat: (x, y, z) => grid.get(x, y, z),
  });
  assert.equal(stillSupported.unsupported.length, 0, 'Far pillar 79 voxels away must keep 5,200-voxel building supported');
  assert.equal(stillSupported.hitVisitedCap, false);

  // Now sever far right pillar too -> ALL 5,202 unsupported voxels (5,200 + 2 pillar stubs at y=2) collapse as ONE component!
  grid.set(79, 1, 0, MAT.AIR);
  const fullCollapse = findUnsupportedTerrainVoxels({
    cvx: 79,
    cvy: 1,
    cvz: 0,
    radiusVoxels: 1,
    minWorldX: -10,
    maxWorldX: 90,
    minWorldY: 0,
    maxWorldY: 30,
    minWorldZ: -10,
    maxWorldZ: 20,
    getMat: (x, y, z) => grid.get(x, y, z),
  });
  assert.equal(fullCollapse.hitVisitedCap, false, 'Uncapped solver must never hit a visited cap');
  assert.equal(fullCollapse.components.length, 1, 'Entire 5,202-voxel structure must fall as ONE unified entity');
  assert.equal(fullCollapse.components[0].length, 5202);
});

test('BEDROCK anchor: structure anchored to MAT.BEDROCK above y=0 stays supported while detached tip falls as 1 component', () => {
  const grid = makeSparseGrid();
  grid.set(0, 10, 0, MAT.BEDROCK);
  for (let x = 1; x <= 6; x++) {
    grid.set(x, 10, 0, MAT.CONCRETE);
  }
  grid.set(4, 10, 0, MAT.AIR);

  const res = findUnsupportedTerrainVoxels({
    cvx: 4,
    cvy: 10,
    cvz: 0,
    radiusVoxels: 1,
    minWorldX: -20,
    maxWorldX: 20,
    minWorldY: 0,
    maxWorldY: 20,
    minWorldZ: -20,
    maxWorldZ: 20,
    getMat: (x, y, z) => grid.get(x, y, z),
  });
  assert.equal(res.components.length, 1);
  const fallenXs = res.components[0].map((v) => v.vx).sort((a, b) => a - b);
  assert.deepEqual(fallenXs, [5, 6], 'Only blocks detached from MAT.BEDROCK must fall');
});

test('Full MicroVoxelWorld integration: unified TerrainEntity collapse, uncapped 800-voxel tower collapse as 1 entity, and vehicle vs terrain debris routing', async () => {
  const scene = new THREE.Scene();
  const world = new MicroVoxelWorld(scene);
  const fx = new VoxelFXSystem(scene, world);
  terrainEntityManager.clearAll();

  let spawnDebrisCalls = 0;
  const origSpawnDebris = fx.spawnDebris.bind(fx);
  fx.spawnDebris = (...args) => {
    spawnDebrisCalls++;
    return origSpawnDebris(...args);
  };

  const cx = TOTAL_VX >> 1;
  const cz = TOTAL_VZ >> 1;
  const baseVX = cx - 32;
  const baseVZ = cz - 24;
  const groundProbe = world.probeGroundBelow(
    (baseVX - cx + 0.5) * VOXEL_SIZE,
    25,
    (baseVZ - cz + 0.5) * VOXEL_SIZE,
    5,
  );
  const groundVY = Math.round(groundProbe.y / VOXEL_SIZE) - 1;

  // --- BUG 1 check: fx.carveWorldCrater spawns TerrainEntity and NEVER calls fx.spawnDebris ---
  terrainEntityManager.clearAll();
  spawnDebrisCalls = 0;
  const craterWX = (baseVX - cx + 0.5) * VOXEL_SIZE;
  const craterWY = (groundVY + 0.5) * VOXEL_SIZE;
  const craterWZ = (baseVZ - cz + 0.5) * VOXEL_SIZE;
  fx.carveWorldCrater(craterWX, craterWY, craterWZ, 2, 0, false);

  assert.equal(spawnDebrisCalls, 0, 'Terrain destruction must NOT call fx.spawnDebris()');
  assert.ok(TerrainEntity.active.length > 0, 'Terrain destruction must spawn TerrainEntity');

  // --- BUG 1 check: vehicle destruction STILL calls fx.spawnDebris() ---
  spawnDebrisCalls = 0;
  const fakeVehicle: any = {
    voxelMap: new Map<string, number>([['0,0,0', MAT.ALLOY_BLUE]]),
    voxelHealthMap: new Map<string, number>([['0,0,0', 1.0]]),
    voxelHealth: new Map<number, number>([[packVoxelKey(0, 0, 0), 100]]),
    velocity: new THREE.Vector3(),
    position: new THREE.Vector3(0, 15, 0),
    fx,
    rigidBody: {
      removeCollisionPointByKey() {},
      wake() {},
      recomputeMassFromVoxels() {},
      position: new THREE.Vector3(0, 15, 0),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      collisionPoints: [],
    },
    setVoxel(vx: number, vy: number, vz: number, mat: number) {
      if (mat === MAT.AIR) this.voxelMap.delete(`${vx},${vy},${vz}`);
      else this.voxelMap.set(`${vx},${vy},${vz}`, mat);
    },
    getVoxel(vx: number, vy: number, vz: number) {
      return this.voxelMap.get(`${vx},${vy},${vz}`) ?? MAT.AIR;
    },
    localVoxelToWorld(vx: number, vy: number, vz: number, out = new THREE.Vector3()) {
      return out.set(vx * VOXEL_SIZE, 15 + vy * VOXEL_SIZE, vz * VOXEL_SIZE);
    },
    rebuildVehicleGeometry() {},
    recomputePhysicsProperties() {},
  };
  destroyVoxel(fakeVehicle, packVoxelKey(0, 0, 0), new THREE.Vector3(0, 15, 0), undefined);
  assert.ok(spawnDebrisCalls > 0, 'Vehicle destruction must keep calling fx.spawnDebris()');

  // --- Scenario 1 in MicroVoxelWorld: 5-tall column, destroy #2 -> #3-5 fall as ONE unified TerrainEntity ---
  const s1x = cx - 18;
  const s1z = cz - 18;
  for (let dy = 1; dy <= 5; dy++) {
    world.setVoxel(s1x, groundVY + dy, s1z, MAT.BRICK);
  }
  terrainEntityManager.clearAll();
  world.setVoxel(s1x, groundVY + 2, s1z, MAT.AIR);
  const touched1 = new Set<import('../world.ts').MicroVoxelChunk>();
  const collapsed1 = world.collapseUnsupportedWorldVoxels(s1x, groundVY + 2, s1z, 1, true, touched1);
  assert.equal(collapsed1, 3, 'Scenario 1: exactly #3, #4, #5 must collapse');
  assert.equal(world.readEffectiveVoxelMat(s1x, groundVY + 1, s1z), MAT.BRICK, '#1 must stay');
  assert.equal(world.readEffectiveVoxelMat(s1x, groundVY + 3, s1z), MAT.AIR);
  assert.equal(world.readEffectiveVoxelMat(s1x, groundVY + 5, s1z), MAT.AIR);
  assert.equal(TerrainEntity.active.length, 1, 'Entire unsupported column (#3-#5) must fall as ONE unified TerrainEntity');
  assert.equal(TerrainEntity.active[0].isStructure, true);
  assert.equal(TerrainEntity.active[0].voxelCount, 3);
  assert.ok(TerrainEntity.active[0].mesh, 'Unified TerrainEntity must have a greedy-meshed THREE.Mesh');

  // Step physics until it lands and rests cleanly on ground
  const startY = TerrainEntity.active[0].position.y;
  for (let step = 0; step < 120; step++) {
    TerrainEntity.updateAll(0.02, [], world);
  }
  assert.ok(TerrainEntity.active[0].position.y < startY, 'Unified TerrainEntity must fall downward under gravity');
  assert.equal(TerrainEntity.active[0].isResting, true, 'Unified TerrainEntity must settle into resting state on ground');

  // --- Scenario 2 in MicroVoxelWorld: 5-tall column + side wall at #3, destroy #2 -> #3-5 stay ---
  const s2x = cx - 8;
  const s2z = cz - 18;
  for (let dy = 1; dy <= 5; dy++) {
    world.setVoxel(s2x, groundVY + dy, s2z, MAT.BRICK);
  }
  for (let dy = 1; dy <= 3; dy++) {
    world.setVoxel(s2x + 1, groundVY + dy, s2z, MAT.CONCRETE);
  }
  terrainEntityManager.clearAll();
  world.setVoxel(s2x, groundVY + 2, s2z, MAT.AIR);
  const touched2 = new Set<import('../world.ts').MicroVoxelChunk>();
  const collapsed2 = world.collapseUnsupportedWorldVoxels(s2x, groundVY + 2, s2z, 1, true, touched2);
  assert.equal(collapsed2, 0, 'Scenario 2: side wall at #3 must keep #3-5 supported');
  assert.equal(TerrainEntity.active.length, 0);

  // --- Scenario 3 in MicroVoxelWorld: 2-pillar bridge -> stays with 1 pillar; falls as ONE entity when 2nd pillar breaks ---
  const s3x = cx + 4;
  const s3z = cz - 18;
  for (let dy = 1; dy <= 5; dy++) {
    world.setVoxel(s3x, groundVY + dy, s3z, MAT.STEEL);
    world.setVoxel(s3x + 12, groundVY + dy, s3z, MAT.STEEL);
  }
  for (let dx = 0; dx <= 12; dx++) {
    world.setVoxel(s3x + dx, groundVY + 6, s3z, MAT.RAMP_ORANGE);
  }
  terrainEntityManager.clearAll();
  world.setVoxel(s3x, groundVY + 2, s3z, MAT.AIR);
  const touched3 = new Set<import('../world.ts').MicroVoxelChunk>();
  const collapsed3 = world.collapseUnsupportedWorldVoxels(s3x, groundVY + 2, s3z, 1, true, touched3);
  assert.equal(collapsed3, 0, 'Scenario 3: bridge must stay when 1 pillar is destroyed');
  assert.equal(TerrainEntity.active.length, 0);

  // Destroy 2nd pillar -> entire bridge (13 deck + 3 stub A + 3 stub B = 19 voxels) falls as ONE entity!
  world.setVoxel(s3x + 12, groundVY + 2, s3z, MAT.AIR);
  const collapsed3b = world.collapseUnsupportedWorldVoxels(s3x + 12, groundVY + 2, s3z, 1, true, touched3);
  assert.equal(collapsed3b, 19);
  assert.equal(TerrainEntity.active.length, 1, 'Entire collapsed bridge must fall as ONE unified TerrainEntity');
  assert.equal(TerrainEntity.active[0].voxelCount, 19);

  // --- Large Structure (> old 500 cap): 800-voxel tower on 1 pillar falls as ONE unified entity ---
  const bigX = cx - 44;
  const bigZ = cz + 10;
  world.setVoxel(bigX, groundVY + 1, bigZ, MAT.STEEL); // single pillar
  // 10 x 8 x 10 = 800-voxel blockhouse above pillar (dy = 2..9)
  for (let dx = 0; dx < 10; dx++) {
    for (let dz = 0; dz < 10; dz++) {
      for (let dy = 2; dy <= 9; dy++) {
        world.setVoxel(bigX + dx, groundVY + dy, bigZ + dz, MAT.CONCRETE);
      }
    }
  }
  terrainEntityManager.clearAll();
  world.setVoxel(bigX, groundVY + 1, bigZ, MAT.AIR);
  const touchedBig = new Set<import('../world.ts').MicroVoxelChunk>();
  const collapsedBig = world.collapseUnsupportedWorldVoxels(bigX, groundVY + 1, bigZ, 1, true, touchedBig);
  assert.equal(collapsedBig, 800, 'All 800 voxels (> old 500 cap) must detach without staying floating');
  assert.equal(TerrainEntity.active.length, 1, 'Entire 800-voxel blockhouse must fall as ONE unified TerrainEntity');
  assert.equal(TerrainEntity.active[0].isStructure, true);
  assert.equal(TerrainEntity.active[0].voxelCount, 800);
  assert.equal(world.readEffectiveVoxelMat(bigX + 5, groundVY + 9, bigZ + 5), MAT.AIR);

  // Verify ZERO random initial force (pure gravity straight-down drop)
  const bigEnt = TerrainEntity.active[0];
  assert.equal(bigEnt.velocity.x, 0, 'Collapsed terrain must have zero random X velocity');
  assert.equal(bigEnt.velocity.y, 0, 'Collapsed terrain must have zero random Y velocity');
  assert.equal(bigEnt.velocity.z, 0, 'Collapsed terrain must have zero random Z velocity');
  assert.equal(bigEnt.angularVelocity.x, 0, 'Collapsed terrain must have zero random X spin');
  assert.equal(bigEnt.angularVelocity.y, 0, 'Collapsed terrain must have zero random Y spin');
  assert.equal(bigEnt.angularVelocity.z, 0, 'Collapsed terrain must have zero random Z spin');

  // --- Verify deferred spawn-on-disappear synchronization ---
  const defX = cx - 28;
  const defZ = cz + 12;
  for (let dy = 1; dy <= 5; dy++) {
    world.setVoxel(defX, groundVY + dy, defZ, MAT.BRICK);
  }
  terrainEntityManager.clearAll();
  world.markVoxelPendingRemoval(defX, groundVY + 2, defZ, MAT.AIR);
  const touchedDef = new Set<import('../world.ts').MicroVoxelChunk>();
  const collapsedDef = world.collapseUnsupportedWorldVoxels(
    defX,
    groundVY + 2,
    defZ,
    1,
    false,
    touchedDef,
    undefined,
    { deferUntilChunkSwap: true },
  );
  assert.equal(collapsedDef, 3);
  assert.equal(
    TerrainEntity.active.length,
    0,
    'Deferred TerrainEntity must NOT spawn before static chunk mesh swaps and blocks disappear',
  );
  assert.equal(world.pendingTerrainStructures.length, 1);
  // Once chunk rebuilds/swaps and static blocks disappear, TerrainEntity spawns immediately!
  touchedDef.forEach((c) => world.rebuildChunkSync(c));
  assert.equal(
    TerrainEntity.active.length,
    1,
    'Deferred TerrainEntity must spawn the exact instant static blocks disappear on chunk swap',
  );
  assert.equal(TerrainEntity.active[0].voxelCount, 3);

  // --- Verify FULL collision with EVERYTHING ---
  terrainEntityManager.clearAll();
  // Spawn two 4x4x4 structures stacked vertically to test TerrainEntity-vs-TerrainEntity stacking,
  // vehicle collision, player collision, and bullet raycast hit!
  const lowerVoxels = [];
  const upperVoxels = [];
  for (let dx = 0; dx < 4; dx++) {
    for (let dz = 0; dz < 4; dz++) {
      for (let dy = 0; dy < 4; dy++) {
        lowerVoxels.push({ vx: cx + dx, vy: groundVY + 1 + dy, vz: cz + dz, mat: MAT.CONCRETE });
        upperVoxels.push({ vx: cx + dx, vy: groundVY + 8 + dy, vz: cz + dz, mat: MAT.BRICK });
      }
    }
  }
  const lowerEnt = TerrainEntity.spawnStructure(lowerVoxels, { scene })!;
  const upperEnt = TerrainEntity.spawnStructure(upperVoxels, { scene })!;
  for (let s = 0; s < 160; s++) {
    TerrainEntity.updateAll(0.02, [], world);
  }
  assert.ok(lowerEnt.isResting, 'Lower structure must rest on ground');
  assert.ok(
    upperEnt.position.y >= lowerEnt.position.y + 0.85,
    `Upper TerrainEntity must collide and stack on top of lower TerrainEntity (upperY=${upperEnt.position.y.toFixed(2)}, lowerY=${lowerEnt.position.y.toFixed(2)})`,
  );

  // Player solid & walkable surface check on TerrainEntity
  assert.equal(
    TerrainEntity.isSolidAtWorld(lowerEnt.position.x, lowerEnt.position.y, lowerEnt.position.z),
    true,
    'TerrainEntity must be solid for player/world queries',
  );
  const topSurface = TerrainEntity.probeSurfaceBelow(
    upperEnt.position.x,
    upperEnt.position.y + 1.0,
    upperEnt.position.z,
    1.5,
  );
  assert.ok(topSurface && topSurface.y > lowerEnt.position.y, 'Vehicles & player must detect walkable top surface on TerrainEntity');

  const playerEye = new THREE.Vector3(lowerEnt.position.x, lowerEnt.position.y + 0.4, lowerEnt.position.z);
  const pushedPlayer = TerrainEntity.resolvePlayerCollision(playerEye, 1.65, 0.32);
  assert.equal(pushedPlayer, true, 'TerrainEntity must push out overlapping player');

  // Projectile raycast against TerrainEntity
  const { raycastBulletSegmentDDA } = await import('../fx.ts');
  const rayStart = new THREE.Vector3(lowerEnt.position.x - 5, lowerEnt.position.y, lowerEnt.position.z);
  const rayEnd = new THREE.Vector3(lowerEnt.position.x + 5, lowerEnt.position.y, lowerEnt.position.z);
  const rayHit = raycastBulletSegmentDDA(rayStart, rayEnd, null, [], false);
  assert.ok(rayHit && rayHit.target === 'terrainEntity' && rayHit.terrainEntity === lowerEnt, 'Bullets/rockets must hit TerrainEntity');

  // Vehicle bidirectional collision with TerrainEntity
  let vehImpulseApplied = false;
  const mockVeh: any = {
    position: new THREE.Vector3(lowerEnt.position.x + 0.6, lowerEnt.position.y, lowerEnt.position.z),
    velocity: new THREE.Vector3(-8, 0, 0),
    boundingRadius: 1.4,
    totalMass: 1200,
    rigidBody: {
      position: new THREE.Vector3(lowerEnt.position.x + 0.6, lowerEnt.position.y, lowerEnt.position.z),
      velocity: new THREE.Vector3(-8, 0, 0),
      mass: 1200,
      applyImpulseAtPoint() {
        vehImpulseApplied = true;
      },
    },
  };
  TerrainEntity.updateAll(0.02, [mockVeh], world);
  assert.equal(vehImpulseApplied, true, 'Colliding vehicle must receive solid impulse from TerrainEntity');
  assert.ok(lowerEnt.velocity.x < 0, 'Colliding vehicle must physically push TerrainEntity');

  terrainEntityManager.clearAll();
  world.dispose();
});
