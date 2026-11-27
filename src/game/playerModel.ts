import * as THREE from 'three';
import {
  getEmissiveNeonMat,
} from './models.ts';
import {
  MICRO_VOXEL_SIZE,
  buildGreedyMicroVoxelGeometry,
  createMicroVoxelGrid,
  fillMicroBox,
  setMicroVoxel,
} from './microVoxelMesh.ts';

export type EquippedCharacterTool =
  | 'NONE'
  | 'PLASMA_RIFLE'
  | 'SLEDGE'
  | 'PIPE_BOMB'
  | 'LIGHT_BLOCK'
  | 'WRENCH';

export type CharacterEquippedTool = EquippedCharacterTool;

export interface CharacterAnimState {
  walkSpeed: number;
  isGrounded?: boolean;
  isAirborne?: boolean;
  isSprinting?: boolean;
  isDriving?: boolean;
  isSeated?: boolean;
  seatKind?: string;
  steerAngle?: number;
  lookPitch?: number;
  lookYaw?: number;
  equippedTool?: EquippedCharacterTool;
  isBuildMode?: boolean;
  isJetpacking?: boolean;
}

export interface ArticulatedCharacterRig {
  rootGroup: THREE.Group;
  pelvisGroup: THREE.Group;
  torsoMesh: THREE.Mesh;
  headGroup: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftForearmPivot: THREE.Group;
  rightForearmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftKneePivot: THREE.Group;
  rightKneePivot: THREE.Group;
  toolMountNode: THREE.Group;
  thrusterCore: THREE.Mesh;
  thrusterNozzleL: THREE.Mesh;
  thrusterNozzleR: THREE.Mesh;
  thrusterPlumeL: THREE.Mesh;
  thrusterPlumeR: THREE.Mesh;
  visorMat: THREE.MeshStandardMaterial;
  nozzleMat: THREE.MeshStandardMaterial;
  toolMeshes: Record<EquippedCharacterTool, THREE.Group | null>;
  animPhase: number;
}

export type ProceduralPlayerRig = ArticulatedCharacterRig;

// Cached shared micro-voxel geometries for character rigs (zero duplicate allocations across singleplayer + multiplayer peers)
const _charGeoCache = new Map<string, THREE.BufferGeometry>();
let _sharedMicroVoxelCharMat: THREE.MeshStandardMaterial | null = null;

function getSharedMicroVoxelCharMat(): THREE.MeshStandardMaterial {
  if (!_sharedMicroVoxelCharMat) {
    _sharedMicroVoxelCharMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.16,
    });
  }
  return _sharedMicroVoxelCharMat;
}

function getCharGeo<T extends THREE.BufferGeometry>(
  key: string,
  factory: () => T,
): T {
  let g = _charGeoCache.get(key) as T | undefined;
  if (!g) {
    g = factory();
    g.userData.isSharedPrimitive = true;
    g.userData.isMicroVoxel = true;
    g.userData.microVoxelSize = MICRO_VOXEL_SIZE;
    g.computeBoundingSphere();
    _charGeoCache.set(key, g);
  }
  return g;
}

function setStaticSubMesh(mesh: THREE.Object3D): void {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = true;
  mesh.updateMatrix();
}

// Palette indices for micro-voxel character & tools
const PAL = {
  DARK_ARMOR: 1,
  SLATE_TRIM: 2,
  HELMET_WHITE: 3,
  HELMET_SHADE: 4,
  ACCENT: 5,
  GOLD: 6,
  BOOT_RUBBER: 7,
  CHROME: 8,
  HAZARD: 9,
  CRIMSON: 10,
  ORANGE_ACCENT: 11,
  VISOR_DARK: 12,
} as const;

function makeCharacterPalette(accentHex: number): Record<number, number> {
  return {
    [PAL.DARK_ARMOR]: 0x1e293b,
    [PAL.SLATE_TRIM]: 0x475569,
    [PAL.HELMET_WHITE]: 0xf1f5f9,
    [PAL.HELMET_SHADE]: 0xcbd5e1,
    [PAL.ACCENT]: accentHex,
    [PAL.GOLD]: 0xfacc15,
    [PAL.BOOT_RUBBER]: 0x181c22,
    [PAL.CHROME]: 0xdbeafe,
    [PAL.HAZARD]: 0xf59e0b,
    [PAL.CRIMSON]: 0xdc2626,
    [PAL.ORANGE_ACCENT]: 0xf97316,
    [PAL.VISOR_DARK]: 0x0f172a,
  };
}

/**
 * Helper to create a clean micro-voxel box geometry (in exact 1px = 0.0625m scale) for glowing/emissive sub-parts.
 */
function buildSolidMicroBoxGeo(
  key: string,
  sx: number,
  sy: number,
  sz: number,
  colorHex = 0xffffff,
  pivot?: [number, number, number],
): THREE.BufferGeometry {
  return getCharGeo(key, () => {
    const g = createMicroVoxelGrid(sx, sy, sz);
    fillMicroBox(g, 0, 0, 0, sx - 1, sy - 1, sz - 1, 1);
    return buildGreedyMicroVoxelGeometry(
      g,
      { 1: colorHex },
      {
        voxelSize: MICRO_VOXEL_SIZE,
        pivot: pivot ?? [sx * 0.5, sy * 0.5, sz * 0.5],
        bakeAO: false,
        bakeFaceShade: true,
      },
    );
  });
}

/**
 * Builds the 4 distinct 1px micro-voxel handheld tools mounted inside `toolMountNode` on the right hand:
 * - PLASMA_RIFLE: 1px micro-voxel repeater with glowing cyan coils & muzzle
 * - SLEDGE: Heavy 1px micro-voxel demolition sledgehammer with energized orange impact plates
 * - PIPE_BOMB: Tactical 1px micro-voxel C4 remote detonator & beacon
 * - LIGHT_BLOCK / WRENCH: 1px micro-voxel Engineering Multi-Tool & Holo-Wrench
 */
function buildHandheldTools(): Record<EquippedCharacterTool, THREE.Group | null> {
  const voxMat = getSharedMicroVoxelCharMat();
  const basePal = makeCharacterPalette(0x38bdf8);
  const cyanGlow = getEmissiveNeonMat(0x38bdf8, 2.2);
  const orangeGlow = getEmissiveNeonMat(0xff6600, 2.1);
  const redGlow = getEmissiveNeonMat(0xef4444, 2.3);

  // 1. 1px Micro-Voxel Plasma Rifle
  const plasmaGroup = new THREE.Group();
  plasmaGroup.name = 'Tool_PLASMA_RIFLE';
  const rifleBodyGeo = getCharGeo('mv_tool_rifle_body', () => {
    const g = createMicroVoxelGrid(2, 3, 9);
    // Stock + receiver
    fillMicroBox(g, 0, 0, 0, 1, 1, 6, PAL.DARK_ARMOR);
    // Top rail & barrel shroud
    fillMicroBox(g, 0, 2, 1, 1, 2, 5, PAL.SLATE_TRIM);
    fillMicroBox(g, 0, 1, 6, 1, 1, 8, PAL.SLATE_TRIM);
    // Side vents
    setMicroVoxel(g, 0, 1, 3, PAL.CHROME);
    setMicroVoxel(g, 1, 1, 3, PAL.CHROME);
    return buildGreedyMicroVoxelGeometry(g, basePal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1, 1, 1.5],
    });
  });
  const rifleBody = new THREE.Mesh(rifleBodyGeo, voxMat);
  rifleBody.position.set(0, 0.02, 0.06);
  setStaticSubMesh(rifleBody);

  const rifleCoil = new THREE.Mesh(
    buildSolidMicroBoxGeo('mv_tool_rifle_coil', 2, 1, 4, 0xffffff, [1, 0.5, 2]),
    cyanGlow,
  );
  rifleCoil.scale.set(1.06, 0.85, 0.95);
  rifleCoil.position.set(0, 0.055, 0.24);
  setStaticSubMesh(rifleCoil);

  const rifleMuzzle = new THREE.Mesh(
    buildSolidMicroBoxGeo('mv_tool_rifle_muzzle', 1, 1, 1, 0xffffff),
    cyanGlow,
  );
  rifleMuzzle.position.set(0, 0.04, 0.54);
  setStaticSubMesh(rifleMuzzle);
  plasmaGroup.add(rifleBody, rifleCoil, rifleMuzzle);
  plasmaGroup.visible = false;

  // 2. 1px Micro-Voxel Sledgehammer
  const sledgeGroup = new THREE.Group();
  sledgeGroup.name = 'Tool_SLEDGE';
  const sledgeBodyGeo = getCharGeo('mv_tool_sledge_body', () => {
    const g = createMicroVoxelGrid(5, 2, 11);
    // Shaft along Z
    fillMicroBox(g, 2, 0, 0, 2, 0, 8, PAL.SLATE_TRIM);
    setMicroVoxel(g, 2, 0, 0, PAL.HAZARD);
    setMicroVoxel(g, 2, 0, 1, PAL.HAZARD);
    // Heavy steel head at tip
    fillMicroBox(g, 0, 0, 8, 4, 1, 10, PAL.DARK_ARMOR);
    fillMicroBox(g, 1, 0, 9, 3, 1, 9, PAL.SLATE_TRIM);
    return buildGreedyMicroVoxelGeometry(g, basePal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [2.5, 0.5, 1.5],
    });
  });
  const sledgeMesh = new THREE.Mesh(sledgeBodyGeo, voxMat);
  sledgeMesh.position.set(0, 0, 0.04);
  setStaticSubMesh(sledgeMesh);

  const strikePlates = new THREE.Mesh(
    buildSolidMicroBoxGeo('mv_tool_sledge_strike', 5, 1, 1, 0xffffff),
    orangeGlow,
  );
  strikePlates.scale.set(1.06, 1.1, 1.1);
  strikePlates.position.set(0, 0.03, 0.53);
  setStaticSubMesh(strikePlates);
  sledgeGroup.add(sledgeMesh, strikePlates);
  sledgeGroup.visible = false;

  // 3. 1px Micro-Voxel C4 Remote Detonator
  const c4Group = new THREE.Group();
  c4Group.name = 'Tool_PIPE_BOMB';
  const c4Geo = getCharGeo('mv_tool_c4_body', () => {
    const g = createMicroVoxelGrid(2, 4, 3);
    fillMicroBox(g, 0, 0, 0, 1, 1, 2, PAL.CRIMSON);
    setMicroVoxel(g, 0, 1, 0, PAL.DARK_ARMOR);
    setMicroVoxel(g, 1, 1, 0, PAL.DARK_ARMOR);
    // Pixel antenna mast
    setMicroVoxel(g, 1, 2, 2, PAL.CHROME);
    setMicroVoxel(g, 1, 3, 2, PAL.CHROME);
    return buildGreedyMicroVoxelGeometry(g, basePal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1, 0.5, 0.5],
    });
  });
  const detonatorBox = new THREE.Mesh(c4Geo, voxMat);
  detonatorBox.position.set(0, 0.01, 0.08);
  setStaticSubMesh(detonatorBox);

  const c4Beacon = new THREE.Mesh(
    buildSolidMicroBoxGeo('mv_tool_c4_led', 1, 1, 1, 0xffffff),
    redGlow,
  );
  c4Beacon.scale.set(0.65, 0.65, 0.65);
  c4Beacon.position.set(-0.02, 0.11, 0.14);
  setStaticSubMesh(c4Beacon);
  c4Group.add(detonatorBox, c4Beacon);
  c4Group.visible = false;

  // 4. 1px Micro-Voxel Engineering Holo-Wrench
  const wrenchGroup = new THREE.Group();
  wrenchGroup.name = 'Tool_WRENCH';
  const wrenchGeo = getCharGeo('mv_tool_wrench_body', () => {
    const g = createMicroVoxelGrid(3, 1, 7);
    // Hazard handle
    fillMicroBox(g, 1, 0, 0, 1, 0, 4, PAL.HAZARD);
    // Stepped chrome C-jaw
    fillMicroBox(g, 0, 0, 4, 2, 0, 4, PAL.CHROME);
    setMicroVoxel(g, 0, 0, 5, PAL.CHROME);
    setMicroVoxel(g, 2, 0, 5, PAL.CHROME);
    setMicroVoxel(g, 0, 0, 6, PAL.CHROME);
    setMicroVoxel(g, 2, 0, 6, PAL.CHROME);
    return buildGreedyMicroVoxelGeometry(g, basePal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1.5, 0.5, 1.0],
    });
  });
  const wrenchBody = new THREE.Mesh(wrenchGeo, voxMat);
  wrenchBody.position.set(0, 0, 0.04);
  setStaticSubMesh(wrenchBody);

  const holoCore = new THREE.Mesh(
    buildSolidMicroBoxGeo('mv_tool_wrench_core', 1, 1, 1, 0xffffff),
    cyanGlow,
  );
  holoCore.scale.set(0.7, 0.7, 0.7);
  holoCore.position.set(0, 0, 0.34);
  setStaticSubMesh(holoCore);
  wrenchGroup.add(wrenchBody, holoCore);
  wrenchGroup.visible = true;

  return {
    NONE: null,
    PLASMA_RIFLE: plasmaGroup,
    SLEDGE: sledgeGroup,
    PIPE_BOMB: c4Group,
    LIGHT_BLOCK: wrenchGroup,
    WRENCH: wrenchGroup,
  };
}

/**
 * 1px Micro-Voxel Articulated Engineer Rig (`0.0625m` micro-voxels = 1/4 of world voxel size):
 * Every limb, helmet, chestplate, jetpack, boot, and handheld tool is greedy-meshed from a
 * compact 1px micro-voxel grid with baked crevice AO and cached once per accent color.
 *
 * Preserves exact pivot hierarchy, child counts, and `userData` aliases expected by animation,
 * multiplayer pose sync, Build Mode, and physics tests.
 */
export function createArticulatedPlayerRig(accentHex = '#38bdf8'): ArticulatedCharacterRig {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'SciFiPilotRig';

  const accentColor = new THREE.Color(accentHex).getHex();
  const palKey = accentColor.toString(16);
  const pal = makeCharacterPalette(accentColor);
  const voxMat = getSharedMicroVoxelCharMat();

  // Per-rig materials for dynamic visor & nozzle emissive pulsing
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: new THREE.Color(0x38bdf8),
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.15,
  });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: new THREE.Color(0x38bdf8),
    emissiveIntensity: 1.2,
    roughness: 0.25,
    metalness: 0.35,
  });
  const coreGlowMat = getEmissiveNeonMat(0x38bdf8, 2.0);

  // --- 1. PELVIS GROUP (Hip Center at y = 0.72m) ---
  const pelvisGroup = new THREE.Group();
  pelvisGroup.name = 'pelvisGroup';
  pelvisGroup.position.set(0, 0.72, 0);
  rootGroup.add(pelvisGroup);

  const pelvisGeo = getCharGeo(`mv_pelvis_${palKey}`, () => {
    const g = createMicroVoxelGrid(7, 3, 4);
    fillMicroBox(g, 0, 1, 0, 6, 2, 3, PAL.DARK_ARMOR);
    fillMicroBox(g, 1, 0, 0, 5, 0, 3, PAL.DARK_ARMOR);
    // Center armored hip guard
    fillMicroBox(g, 2, 0, 3, 4, 2, 3, PAL.SLATE_TRIM);
    setMicroVoxel(g, 3, 1, 3, PAL.ACCENT);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [3.5, 1.5, 2.0],
    });
  });
  const pelvisBlock = new THREE.Mesh(pelvisGeo, voxMat);
  setStaticSubMesh(pelvisBlock);
  pelvisGroup.add(pelvisBlock);

  // --- 2. TORSO MESH (1px Micro-Voxel Armored Chestplate + Utility Belt + Twin-Nozzle Jetpack) ---
  const torsoGeo = getCharGeo(`mv_torso_${palKey}`, () => {
    // 8 x 9 x 5 = 0.50m W x 0.5625m H x 0.3125m D
    const g = createMicroVoxelGrid(8, 9, 5);
    // Core torso body
    fillMicroBox(g, 1, 1, 1, 6, 8, 3, PAL.DARK_ARMOR);
    // Broadened upper armored ribcage
    fillMicroBox(g, 0, 4, 1, 7, 7, 3, PAL.DARK_ARMOR);
    // Chamfered front chestplate protruding to z=4
    fillMicroBox(g, 1, 3, 4, 6, 6, 4, PAL.DARK_ARMOR);
    // Upper accent chevron stripe across chest
    fillMicroBox(g, 1, 7, 4, 6, 7, 4, PAL.ACCENT);
    setMicroVoxel(g, 1, 6, 4, PAL.SLATE_TRIM);
    setMicroVoxel(g, 6, 6, 4, PAL.SLATE_TRIM);
    // Subtle warm utility detail tabs on lower chest
    setMicroVoxel(g, 1, 3, 4, PAL.ORANGE_ACCENT);
    setMicroVoxel(g, 6, 3, 4, PAL.ORANGE_ACCENT);
    // Back spine ridge
    fillMicroBox(g, 2, 2, 0, 5, 7, 0, PAL.SLATE_TRIM);
    // Utility belt wrapping lower torso (y = 0..1)
    fillMicroBox(g, 0, 0, 0, 7, 1, 4, PAL.SLATE_TRIM);
    // Gold belt buckle centered at front
    fillMicroBox(g, 3, 0, 4, 4, 1, 4, PAL.GOLD);
    // Side utility pouches
    fillMicroBox(g, 0, 0, 1, 0, 1, 3, PAL.DARK_ARMOR);
    fillMicroBox(g, 7, 0, 1, 7, 1, 3, PAL.DARK_ARMOR);
    // Collar neck ring at y = 8
    fillMicroBox(g, 2, 8, 1, 5, 8, 3, PAL.SLATE_TRIM);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [4.0, 4.5, 2.5],
    });
  });

  const torsoMesh = new THREE.Mesh(torsoGeo, voxMat);
  torsoMesh.name = 'torsoMesh';
  torsoMesh.position.set(0, 0.34, 0);
  torsoMesh.castShadow = true;
  torsoMesh.frustumCulled = true;
  pelvisGroup.add(torsoMesh);

  // Glowing 1px chest core emblem
  const chestEmblem = new THREE.Mesh(
    buildSolidMicroBoxGeo('mv_chest_emblem', 2, 2, 1, 0xffffff),
    coreGlowMat,
  );
  chestEmblem.scale.set(0.7, 0.7, 0.5);
  chestEmblem.position.set(0, 0.05, 0.165);
  setStaticSubMesh(chestEmblem);
  torsoMesh.add(chestEmblem);

  // 1px Micro-Voxel Backpack Jetpack
  const jetpackGeo = getCharGeo(`mv_jetpack_${palKey}`, () => {
    const g = createMicroVoxelGrid(6, 7, 3);
    // Main armored housing with beveled top corners
    fillMicroBox(g, 0, 1, 0, 5, 5, 2, PAL.DARK_ARMOR);
    fillMicroBox(g, 1, 6, 0, 4, 6, 2, PAL.SLATE_TRIM);
    // Twin vertical fuel cylinders on left/right
    fillMicroBox(g, 0, 0, 0, 1, 5, 1, PAL.SLATE_TRIM);
    fillMicroBox(g, 4, 0, 0, 5, 5, 1, PAL.SLATE_TRIM);
    // Accent stripes on tanks
    setMicroVoxel(g, 0, 4, 0, PAL.ACCENT);
    setMicroVoxel(g, 5, 4, 0, PAL.ACCENT);
    setMicroVoxel(g, 0, 2, 0, PAL.ORANGE_ACCENT);
    setMicroVoxel(g, 5, 2, 0, PAL.ORANGE_ACCENT);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [3.0, 3.5, 1.5],
    });
  });
  const jetpackBody = new THREE.Mesh(jetpackGeo, voxMat);
  jetpackBody.position.set(0, 0.03, -0.21);
  setStaticSubMesh(jetpackBody);

  const thrusterCore = new THREE.Mesh(
    buildSolidMicroBoxGeo('mv_jetpack_core', 2, 3, 1, 0xffffff),
    nozzleMat,
  );
  thrusterCore.name = 'thrusterCore';
  thrusterCore.scale.set(0.85, 0.9, 0.65);
  thrusterCore.position.set(0, 0.03, -0.09);
  setStaticSubMesh(thrusterCore);
  jetpackBody.add(thrusterCore);

  const thrusterNozzleGeo = buildSolidMicroBoxGeo('mv_jet_nozzle', 2, 2, 2, 0xffffff);
  const plumeGeo = getCharGeo('mv_jet_plume', () => {
    // Stepped 1px micro-voxel flame cone pointing downward (-Y)
    const g = createMicroVoxelGrid(2, 4, 2);
    fillMicroBox(g, 0, 2, 0, 1, 3, 1, 1);
    setMicroVoxel(g, 0, 1, 0, 1);
    setMicroVoxel(g, 1, 1, 1, 1);
    setMicroVoxel(g, 0, 0, 1, 1);
    return buildGreedyMicroVoxelGeometry(
      g,
      { 1: 0xffffff },
      { voxelSize: MICRO_VOXEL_SIZE * 0.75, pivot: [1, 4, 1], bakeAO: false },
    );
  });

  const thrusterNozzleL = new THREE.Mesh(thrusterNozzleGeo, nozzleMat);
  thrusterNozzleL.name = 'thrusterNozzleL';
  thrusterNozzleL.scale.set(0.75, 0.85, 0.75);
  thrusterNozzleL.position.set(-0.125, -0.24, -0.02);
  thrusterNozzleL.rotation.x = 0.16;
  setStaticSubMesh(thrusterNozzleL);

  const thrusterNozzleR = new THREE.Mesh(thrusterNozzleGeo, nozzleMat);
  thrusterNozzleR.name = 'thrusterNozzleR';
  thrusterNozzleR.scale.set(0.75, 0.85, 0.75);
  thrusterNozzleR.position.set(0.125, -0.24, -0.02);
  thrusterNozzleR.rotation.x = 0.16;
  setStaticSubMesh(thrusterNozzleR);

  const thrusterPlumeL = new THREE.Mesh(plumeGeo, nozzleMat);
  thrusterPlumeL.name = 'thrusterPlumeL';
  thrusterPlumeL.position.set(-0.125, -0.29, -0.03);
  thrusterPlumeL.scale.set(0.5, 0.35, 0.5);
  thrusterPlumeL.frustumCulled = false;

  const thrusterPlumeR = new THREE.Mesh(plumeGeo, nozzleMat);
  thrusterPlumeR.name = 'thrusterPlumeR';
  thrusterPlumeR.position.set(0.125, -0.29, -0.03);
  thrusterPlumeR.scale.set(0.5, 0.35, 0.5);
  thrusterPlumeR.frustumCulled = false;

  jetpackBody.add(thrusterNozzleL, thrusterNozzleR, thrusterPlumeL, thrusterPlumeR);
  torsoMesh.add(jetpackBody);

  // --- 3. HEAD GROUP (1px Micro-Voxel Chamfered Helmet + Armored Neck + Recessed Visor + Ear Comms + Pixel Antenna) ---
  // Top of torso collar sits at +0.28125m local Y; seating headGroup at +0.275m with a y=0 neck column eliminates any floating gap!
  const headGroup = new THREE.Group();
  headGroup.name = 'headGroup';
  headGroup.position.set(0, 0.245, 0);
  torsoMesh.add(headGroup);

  const helmetGeo = getCharGeo(`mv_helmet_${palKey}`, () => {
    // 9 x 10 x 7 at 0.0625m with solid armored neck seated at y=0..1, sculpted helmet chamfers, chin guard, visor brow, ear pods & crest
    const g = createMicroVoxelGrid(9, 10, 7);
    // Solid armored neck collar base (y = 0..1, x: 2..6, z: 1..5) overlapping deeply into torso collar (zero gap from any angle!)
    fillMicroBox(g, 2, 0, 1, 6, 1, 5, PAL.DARK_ARMOR);
    fillMicroBox(g, 3, 0, 1, 5, 1, 5, PAL.SLATE_TRIM);
    // Core rounded-block helmet (x: 1..7, y: 1..6, z: 0..6)
    fillMicroBox(g, 1, 2, 1, 7, 5, 5, PAL.HELMET_WHITE);
    // Top dome step (y: 6) + beveled forehead brow
    fillMicroBox(g, 2, 6, 1, 6, 6, 5, PAL.HELMET_WHITE);
    // Center helmet crest stripe + side accent vents
    fillMicroBox(g, 4, 6, 1, 4, 6, 5, PAL.ACCENT);
    setMicroVoxel(g, 2, 6, 3, PAL.SLATE_TRIM);
    setMicroVoxel(g, 6, 6, 3, PAL.SLATE_TRIM);
    // Back shell depth + rear cooling vent (z: 0)
    fillMicroBox(g, 2, 2, 0, 6, 5, 0, PAL.HELMET_SHADE);
    fillMicroBox(g, 3, 3, 0, 5, 4, 0, PAL.SLATE_TRIM);
    // Front brow overhang & dark respirator chin guard (z: 6)
    fillMicroBox(g, 2, 5, 6, 6, 5, 6, PAL.HELMET_WHITE);
    setMicroVoxel(g, 4, 5, 6, PAL.ACCENT);
    fillMicroBox(g, 2, 1, 1, 6, 1, 6, PAL.DARK_ARMOR);
    fillMicroBox(g, 3, 2, 6, 5, 2, 6, PAL.DARK_ARMOR);
    setMicroVoxel(g, 4, 1, 6, PAL.SLATE_TRIM);
    // Recessed visor dark backing (y: 3..4, z: 5)
    fillMicroBox(g, 2, 3, 5, 6, 4, 5, PAL.VISOR_DARK);
    // Side comms ear pods (x=0 and x=8)
    fillMicroBox(g, 0, 3, 2, 0, 4, 4, PAL.SLATE_TRIM);
    fillMicroBox(g, 8, 3, 2, 8, 4, 4, PAL.SLATE_TRIM);
    setMicroVoxel(g, 0, 4, 3, PAL.ORANGE_ACCENT);
    setMicroVoxel(g, 8, 4, 3, PAL.ORANGE_ACCENT);
    setMicroVoxel(g, 0, 3, 4, PAL.CHROME);
    setMicroVoxel(g, 8, 3, 4, PAL.CHROME);
    // Left-side comms antenna mast (x=1, y=7..9, z=2)
    setMicroVoxel(g, 1, 7, 2, PAL.SLATE_TRIM);
    setMicroVoxel(g, 1, 8, 2, PAL.SLATE_TRIM);
    setMicroVoxel(g, 1, 9, 2, PAL.SLATE_TRIM);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [4.5, 0.5, 3.5],
    });
  });
  const helmetShell = new THREE.Mesh(helmetGeo, voxMat);
  helmetShell.position.set(0, 0.0, 0);
  setStaticSubMesh(helmetShell);

  // Glowing 1px Micro-Voxel Wraparound Visor
  const visorGeo = getCharGeo('mv_helmet_visor', () => {
    const g = createMicroVoxelGrid(5, 2, 2);
    fillMicroBox(g, 0, 0, 1, 4, 1, 1, 1);
    // Wrap corners 1px back along sides
    fillMicroBox(g, 0, 0, 0, 0, 1, 0, 1);
    fillMicroBox(g, 4, 0, 0, 4, 1, 0, 1);
    return buildGreedyMicroVoxelGeometry(
      g,
      { 1: 0xffffff },
      { voxelSize: MICRO_VOXEL_SIZE, pivot: [2.5, 1.0, 1.0], bakeAO: false },
    );
  });
  const visorDome = new THREE.Mesh(visorGeo, visorMat);
  visorDome.name = 'visorDome';
  visorDome.position.set(0, 3.5 * MICRO_VOXEL_SIZE, 2.75 * MICRO_VOXEL_SIZE);
  setStaticSubMesh(visorDome);

  const antennaTip = new THREE.Mesh(
    buildSolidMicroBoxGeo('mv_antenna_tip', 1, 1, 1, 0xffffff),
    nozzleMat,
  );
  antennaTip.scale.set(0.65, 0.65, 0.65);
  antennaTip.position.set(-3.0 * MICRO_VOXEL_SIZE, 9.6 * MICRO_VOXEL_SIZE, -1.0 * MICRO_VOXEL_SIZE);
  setStaticSubMesh(antennaTip);

  headGroup.add(helmetShell, visorDome, antennaTip);

  // --- 4. LEFT & RIGHT ARM PIVOTS (1px Micro-Voxel Pauldron + Upper Arm + Forearm + Glove) ---
  const upperArmGeoL = getCharGeo(`mv_upper_arm_L_${palKey}`, () => {
    const g = createMicroVoxelGrid(3, 5, 4);
    // Armored upper bicep
    fillMicroBox(g, 1, 0, 1, 2, 4, 2, PAL.DARK_ARMOR);
    // Stepped shoulder pauldron overhanging outer (-X) side
    fillMicroBox(g, 0, 3, 0, 2, 4, 3, PAL.ACCENT);
    fillMicroBox(g, 0, 2, 1, 0, 2, 2, PAL.SLATE_TRIM);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1.5, 4.5, 2.0],
    });
  });
  const upperArmGeoR = getCharGeo(`mv_upper_arm_R_${palKey}`, () => {
    const g = createMicroVoxelGrid(3, 5, 4);
    fillMicroBox(g, 0, 0, 1, 1, 4, 2, PAL.DARK_ARMOR);
    // Stepped shoulder pauldron overhanging outer (+X) side
    fillMicroBox(g, 0, 3, 0, 2, 4, 3, PAL.ACCENT);
    fillMicroBox(g, 2, 2, 1, 2, 2, 2, PAL.SLATE_TRIM);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1.5, 4.5, 2.0],
    });
  });

  const forearmGeo = getCharGeo(`mv_forearm_${palKey}`, () => {
    const g = createMicroVoxelGrid(2, 5, 3);
    // Elbow joint cap (y=4)
    fillMicroBox(g, 0, 4, 0, 1, 4, 1, PAL.SLATE_TRIM);
    // Bracer forearm (y=2..3)
    fillMicroBox(g, 0, 2, 0, 1, 3, 1, PAL.ACCENT);
    // Heavy armored glove (y=0..1, slightly forward toward +Z)
    fillMicroBox(g, 0, 0, 1, 1, 1, 2, PAL.DARK_ARMOR);
    setMicroVoxel(g, 0, 1, 2, PAL.SLATE_TRIM);
    setMicroVoxel(g, 1, 1, 2, PAL.SLATE_TRIM);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1.0, 4.5, 1.0],
    });
  });

  const createArmAssembly = (
    side: -1 | 1,
  ): { armPivot: THREE.Group; forearmPivot: THREE.Group; handMount: THREE.Group } => {
    const armPivot = new THREE.Group();
    armPivot.name = side === -1 ? 'leftArmPivot' : 'rightArmPivot';
    armPivot.position.set(side * 0.32, 0.22, 0);

    const upperArm = new THREE.Mesh(side === -1 ? upperArmGeoL : upperArmGeoR, voxMat);
    upperArm.position.set(side * 0.02, 0.02, 0);
    setStaticSubMesh(upperArm);

    const forearmPivot = new THREE.Group();
    forearmPivot.name = side === -1 ? 'leftForearmPivot' : 'rightForearmPivot';
    forearmPivot.position.set(side * 0.02, -0.28, 0);

    const forearm = new THREE.Mesh(forearmGeo, voxMat);
    forearm.position.set(0, 0.02, 0);
    setStaticSubMesh(forearm);

    const handMount = new THREE.Group();
    handMount.name = side === -1 ? 'leftHandMount' : 'toolMountNode';
    handMount.position.set(0, -0.26, 0.09);

    forearmPivot.add(forearm, handMount);
    armPivot.add(upperArm, forearmPivot);
    torsoMesh.add(armPivot);
    return { armPivot, forearmPivot, handMount };
  };

  const leftArm = createArmAssembly(-1);
  const rightArm = createArmAssembly(1);

  const toolMeshes = buildHandheldTools();
  const addedToolGroups = new Set<THREE.Group>();
  (Object.keys(toolMeshes) as EquippedCharacterTool[]).forEach((k) => {
    const grp = toolMeshes[k];
    if (grp && !addedToolGroups.has(grp)) {
      addedToolGroups.add(grp);
      rightArm.handMount.add(grp);
    }
  });

  // --- 5. LEFT & RIGHT LEG PIVOTS (Preserves exact 2 children on legPivot & 4 children on kneePivot!) ---
  const thighGeo = getCharGeo(`mv_thigh_${palKey}`, () => {
    const g = createMicroVoxelGrid(3, 6, 3);
    fillMicroBox(g, 0, 0, 0, 2, 5, 2, PAL.DARK_ARMOR);
    // Side thigh armor plate
    fillMicroBox(g, 0, 2, 1, 2, 4, 1, PAL.SLATE_TRIM);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1.5, 5.5, 1.5],
    });
  });

  const kneePadGeo = getCharGeo(`mv_knee_pad_${palKey}`, () => {
    const g = createMicroVoxelGrid(2, 2, 2);
    fillMicroBox(g, 0, 0, 0, 1, 1, 1, PAL.ACCENT);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1.0, 1.0, 1.0],
    });
  });

  const shinGeo = getCharGeo(`mv_shin_${palKey}`, () => {
    const g = createMicroVoxelGrid(2, 5, 3);
    fillMicroBox(g, 0, 0, 0, 1, 4, 2, PAL.SLATE_TRIM);
    fillMicroBox(g, 0, 1, 2, 1, 3, 2, PAL.DARK_ARMOR);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1.0, 4.5, 1.5],
    });
  });

  const magBootGeo = getCharGeo(`mv_mag_boot_${palKey}`, () => {
    const g = createMicroVoxelGrid(3, 2, 5);
    fillMicroBox(g, 0, 0, 0, 2, 1, 3, PAL.BOOT_RUBBER);
    // Stepped armored toe cap
    fillMicroBox(g, 0, 0, 4, 2, 0, 4, PAL.BOOT_RUBBER);
    setMicroVoxel(g, 1, 1, 3, PAL.SLATE_TRIM);
    return buildGreedyMicroVoxelGeometry(g, pal, {
      voxelSize: MICRO_VOXEL_SIZE,
      pivot: [1.5, 1.0, 2.0],
    });
  });

  const bootSoleGeo = buildSolidMicroBoxGeo('mv_boot_sole', 3, 1, 5, 0xffffff, [1.5, 0.5, 2.0]);

  const createLegAssembly = (
    side: -1 | 1,
  ): { legPivot: THREE.Group; kneePivot: THREE.Group } => {
    const legPivot = new THREE.Group();
    legPivot.name = side === -1 ? 'leftLegPivot' : 'rightLegPivot';
    legPivot.position.set(side * 0.13, -0.04, 0);

    const thigh = new THREE.Mesh(thighGeo, voxMat);
    thigh.position.set(0, 0, 0);
    setStaticSubMesh(thigh);

    // Articulated Knee Joint at y = -0.34
    const kneePivot = new THREE.Group();
    kneePivot.name = side === -1 ? 'leftKneePivot' : 'rightKneePivot';
    kneePivot.position.set(0, -0.34, 0);

    const kneePad = new THREE.Mesh(kneePadGeo, voxMat);
    kneePad.position.set(0, 0, 0.04);
    setStaticSubMesh(kneePad);

    const shin = new THREE.Mesh(shinGeo, voxMat);
    shin.position.set(0, 0, 0);
    setStaticSubMesh(shin);

    const magBoot = new THREE.Mesh(magBootGeo, voxMat);
    magBoot.position.set(0, -0.28, 0.03);
    setStaticSubMesh(magBoot);

    const bootSoleGlow = new THREE.Mesh(bootSoleGeo, coreGlowMat);
    bootSoleGlow.scale.set(1.02, 0.4, 1.02);
    bootSoleGlow.position.set(0, -0.335, 0.03);
    setStaticSubMesh(bootSoleGlow);

    // Exact 4 children on kneePivot & 2 children on legPivot (verified by physics.test.ts)
    kneePivot.add(kneePad, shin, magBoot, bootSoleGlow);
    legPivot.add(thigh, kneePivot);
    pelvisGroup.add(legPivot);
    return { legPivot, kneePivot };
  };

  const leftLeg = createLegAssembly(-1);
  const rightLeg = createLegAssembly(1);

  const rig: ArticulatedCharacterRig = {
    rootGroup,
    pelvisGroup,
    torsoMesh,
    headGroup,
    leftArmPivot: leftArm.armPivot,
    rightArmPivot: rightArm.armPivot,
    leftForearmPivot: leftArm.forearmPivot,
    rightForearmPivot: rightArm.forearmPivot,
    leftLegPivot: leftLeg.legPivot,
    rightLegPivot: rightLeg.legPivot,
    leftKneePivot: leftLeg.kneePivot,
    rightKneePivot: rightLeg.kneePivot,
    toolMountNode: rightArm.handMount,
    thrusterCore,
    thrusterNozzleL,
    thrusterNozzleR,
    thrusterPlumeL,
    thrusterPlumeR,
    visorMat,
    nozzleMat,
    toolMeshes,
    animPhase: 0,
  };

  rootGroup.userData = {
    rig,
    isMicroVoxelCharacter: true,
    microVoxelSize: MICRO_VOXEL_SIZE,
    pelvisGroup,
    torsoMesh,
    headGroup,
    leftArmPivot: leftArm.armPivot,
    rightArmPivot: rightArm.armPivot,
    leftForearmPivot: leftArm.forearmPivot,
    rightForearmPivot: rightArm.forearmPivot,
    leftLegPivot: leftLeg.legPivot,
    rightLegPivot: rightLeg.legPivot,
    leftKneePivot: leftLeg.kneePivot,
    rightKneePivot: rightLeg.kneePivot,
    toolMountNode: rightArm.handMount,
    // Legacy aliases
    leftLeg: leftLeg.legPivot,
    rightLeg: rightLeg.legPivot,
    leftArm: leftArm.armPivot,
    rightArm: rightArm.armPivot,
    torso: torsoMesh,
    head: headGroup,
    toolMesh: toolMeshes.WRENCH,
  };

  return rig;
}

export const createProceduralPlayerRig = createArticulatedPlayerRig;

/**
 * State Machine Animation Loop (`updateProceduralPlayer(rig, state, dt)`):
 * - Driving: If `state.isDriving === true`, hide `rig.rootGroup.visible = false` and return early so vehicle seats stay empty.
 * - Walking/Sprinting: Counter-swing hips (`sin(timer)`) with reactive knee flexion on back-swing (`Math.max(0, -sin(timer) * 1.2)`), opposite arm swing, and pelvis drop on stride extension.
 * - Jumping/Airborne: Legs tuck forward (`rotation.x = -0.4`), knees bend (`0.6`), arms flare outward, backpack nozzles pulse emissive brightness to `2.5`.
 * - Idle: Gentle chest breathing bob (`sin(timer * 2.0) * 0.015`) and soft visor pulse.
 */
export function updateProceduralPlayer(
  rigOrGroup: ArticulatedCharacterRig | THREE.Group,
  state: CharacterAnimState,
  dt: number,
): void {
  const rig: ArticulatedCharacterRig | undefined =
    'rootGroup' in rigOrGroup
      ? rigOrGroup
      : (rigOrGroup.userData?.rig as ArticulatedCharacterRig | undefined);
  if (!rig) return;

  // 0. DRIVING STATE: Hide rig completely so vehicle seats stay empty
  if (state.isDriving === true) {
    rig.rootGroup.visible = false;
    return;
  }
  rig.rootGroup.visible = true;

  const safeDt = Math.min(0.1, Math.max(0.001, dt));
  const speed = Math.max(0, state.walkSpeed || 0);
  const isSeated = Boolean(state.isSeated);
  const isMoving = !isSeated && speed > 0.15;
  const isGrounded =
    state.isGrounded !== undefined
      ? state.isGrounded
      : !state.isAirborne;

  // Ensure pelvis orientation is upright when driven by procedural animation (clears any ragdoll tilt)
  rig.pelvisGroup.position.x = 0;
  rig.pelvisGroup.position.z = 0;
  rig.pelvisGroup.rotation.set(0, 0, 0);
  rig.leftForearmPivot.rotation.set(0, 0, 0);
  rig.rightForearmPivot.rotation.set(0, 0, 0);

  // Advance animation phase
  const freq = isSeated
    ? 2.2
    : !isGrounded
      ? 4.0
      : isMoving
        ? Math.min(15.0, 4.5 + speed * 0.95)
        : 1.0;
  rig.animPhase += safeDt * freq;
  const p = rig.animPhase;

  // Update visible handheld tool in toolMountNode (default to multi-tool WRENCH when on foot unless NONE specified)
  const activeTool: EquippedCharacterTool = isSeated
    ? 'NONE'
    : state.isBuildMode
      ? 'WRENCH'
      : state.equippedTool !== undefined
        ? state.equippedTool
        : 'WRENCH';

  const uniqueTools = new Set<THREE.Group>();
  (Object.keys(rig.toolMeshes) as EquippedCharacterTool[]).forEach((k) => {
    const g = rig.toolMeshes[k];
    if (g) uniqueTools.add(g);
  });
  uniqueTools.forEach((g) => {
    g.visible = false;
  });
  const selectedToolGroup = rig.toolMeshes[activeTool];
  if (selectedToolGroup) {
    selectedToolGroup.visible = true;
  }

  // Head pitch (-60° to +60°, i.e. -Math.PI/3 to +Math.PI/3) & yaw tracking
  const maxPitchRad = Math.PI / 3;
  const targetPitch = Math.max(-maxPitchRad, Math.min(maxPitchRad, state.lookPitch || 0));
  const targetYaw = Math.max(-0.85, Math.min(0.85, state.lookYaw || 0));
  rig.headGroup.rotation.x = THREE.MathUtils.lerp(
    rig.headGroup.rotation.x,
    -targetPitch,
    Math.min(1, safeDt * 16),
  );
  rig.headGroup.rotation.y = THREE.MathUtils.lerp(
    rig.headGroup.rotation.y,
    targetYaw * 0.65,
    Math.min(1, safeDt * 16),
  );
  rig.headGroup.rotation.z = 0;

  // Always keep hip pivots anchored at the bottom of pelvisGroup (-0.04m) so legs are never displaced into the torso
  rig.leftLegPivot.position.set(-0.13, -0.04, 0);
  rig.rightLegPivot.position.set(0.13, -0.04, 0);

  // 1. SEATED POSE (when seated without isDriving: true)
  if (isSeated) {
    const steer = Math.max(-0.8, Math.min(0.8, state.steerAngle || 0));
    const isMoto = state.seatKind === 'SEAT_MOTO';

    rig.pelvisGroup.position.y = 0.36;
    rig.torsoMesh.position.y = 0.34 + Math.sin(p) * 0.008;
    rig.torsoMesh.rotation.x = isMoto ? 0.24 : -0.08;
    rig.torsoMesh.rotation.z = -steer * (isMoto ? 0.28 : 0.12);

    rig.leftLegPivot.rotation.set(-Math.PI * 0.42, 0, -0.08);
    rig.rightLegPivot.rotation.set(-Math.PI * 0.42, 0, 0.08);
    rig.leftKneePivot.rotation.set(0.75, 0, 0);
    rig.rightKneePivot.rotation.set(0.75, 0, 0);

    rig.leftArmPivot.rotation.set(-Math.PI * 0.36 + steer * 0.38, 0, 0.14 + steer * 0.22);
    rig.rightArmPivot.rotation.set(-Math.PI * 0.36 - steer * 0.38, 0, -0.14 + steer * 0.22);

    rig.nozzleMat.emissiveIntensity = 1.0;
    rig.thrusterPlumeL.scale.set(0.35, 0.2, 0.35);
    rig.thrusterPlumeR.scale.set(0.35, 0.2, 0.35);
    return;
  }

  // 2. JETPACKING / JUMPING / AIRBORNE POSE
  if (state.isJetpacking || !isGrounded) {
    const jetActive = Boolean(state.isJetpacking);
    rig.pelvisGroup.position.y = 0.74;
    rig.torsoMesh.position.y = 0.34;
    rig.torsoMesh.rotation.set(jetActive ? 0.24 : 0.14, 0, 0);

    if (jetActive) {
      // Stabilized flight posture with knees slightly bent and boots angled downward
      const hoverSway = Math.sin(p * 3.0) * 0.06;
      rig.leftLegPivot.rotation.set(0.16 + hoverSway, 0, -0.08);
      rig.rightLegPivot.rotation.set(0.16 - hoverSway, 0, 0.08);
      rig.leftKneePivot.rotation.set(0.38, 0, 0);
      rig.rightKneePivot.rotation.set(0.38, 0, 0);
    } else {
      // Legs tuck forward (-0.4) and knees bend (0.6)
      rig.leftLegPivot.rotation.set(-0.4, 0, -0.06);
      rig.rightLegPivot.rotation.set(-0.4, 0, 0.06);
      rig.leftKneePivot.rotation.set(0.6, 0, 0);
      rig.rightKneePivot.rotation.set(0.6, 0, 0);
    }

    // Arms flare outward for flight control
    rig.leftArmPivot.rotation.set(jetActive ? -0.28 : -0.45, 0, -0.52);
    if (activeTool !== 'NONE') {
      rig.rightArmPivot.rotation.set(-0.75 - targetPitch * 0.4, 0, 0.38);
    } else {
      rig.rightArmPivot.rotation.set(jetActive ? -0.28 : -0.45, 0, 0.52);
    }

    // Backpack nozzles pulse high emissive brightness during jetpack burn
    rig.nozzleMat.emissiveIntensity = jetActive ? 4.2 + Math.sin(p * 16.0) * 0.8 : 2.5;
    rig.visorMat.emissiveIntensity = jetActive ? 1.55 : 1.25;
    const flare = jetActive
      ? 2.6 + Math.sin(p * 20.0) * 0.55
      : 1.2 + Math.sin(p * 4.0) * 0.25;
    const plumeRad = jetActive ? 1.45 : 0.95;
    rig.thrusterPlumeL.scale.set(plumeRad, flare, plumeRad);
    rig.thrusterPlumeR.scale.set(plumeRad, flare, plumeRad);
    return;
  }

  // 3. WALKING / SPRINTING POSE
  if (isMoving) {
    const stride = Math.min(1.0, speed / 9.5);
    const legAmp = 0.72 * stride;
    const armAmp = 0.62 * stride;
    const sinP = Math.sin(p);

    // Pelvis drop on stride extension
    const pelvisDrop = Math.abs(sinP) * 0.048 * stride;
    rig.pelvisGroup.position.y = 0.72 - pelvisDrop;
    rig.torsoMesh.position.y = 0.34;
    rig.torsoMesh.rotation.set(0.08 * stride, 0, sinP * 0.04 * stride);

    // Counter-swing hips (sin(timer))
    rig.leftLegPivot.rotation.set(sinP * legAmp, 0, 0);
    rig.rightLegPivot.rotation.set(-sinP * legAmp, 0, 0);

    // Reactive knee flexion on back-swing: Math.max(0, -sin(timer) * 1.2)
    rig.leftKneePivot.rotation.set(Math.max(0, -sinP * 1.2) * stride, 0, 0);
    rig.rightKneePivot.rotation.set(Math.max(0, sinP * 1.2) * stride, 0, 0);

    // Opposite arm swing
    rig.leftArmPivot.rotation.set(-sinP * armAmp, 0, -0.06);
    if (activeTool === 'PLASMA_RIFLE') {
      rig.rightArmPivot.rotation.set(
        -0.78 - targetPitch * 0.5 + Math.sin(p * 2) * 0.06,
        0,
        0.08,
      );
    } else {
      rig.rightArmPivot.rotation.set(sinP * armAmp, 0, 0.06);
    }

    rig.nozzleMat.emissiveIntensity = 1.3 + stride * 0.45;
    rig.visorMat.emissiveIntensity = 0.95;
    const runGlow = 0.55 + stride * 0.35;
    rig.thrusterPlumeL.scale.set(0.6, runGlow, 0.6);
    rig.thrusterPlumeR.scale.set(0.6, runGlow, 0.6);
    return;
  }

  // 4. IDLE BREATHING POSE
  // Gentle chest breathing bob (sin(timer * 2.0) * 0.015) and soft visor pulse
  const breath = Math.sin(p * 2.0) * 0.015;
  rig.pelvisGroup.position.y = 0.72;
  rig.torsoMesh.position.y = 0.34 + breath;
  rig.torsoMesh.rotation.set(0, 0, 0);

  rig.leftLegPivot.rotation.set(0, 0, -0.02);
  rig.rightLegPivot.rotation.set(0, 0, 0.02);
  rig.leftKneePivot.rotation.set(0, 0, 0);
  rig.rightKneePivot.rotation.set(0, 0, 0);

  rig.leftArmPivot.rotation.set(Math.sin(p * 1.6) * 0.04, 0, -0.06);
  if (activeTool === 'PLASMA_RIFLE') {
    rig.rightArmPivot.rotation.set(
      -0.75 - targetPitch * 0.5 + Math.sin(p * 2.0) * 0.03,
      0,
      0.08,
    );
  } else {
    rig.rightArmPivot.rotation.set(-Math.sin(p * 1.6) * 0.04, 0, 0.06);
  }

  rig.visorMat.emissiveIntensity = 0.85 + Math.sin(p * 2.0) * 0.25;
  rig.nozzleMat.emissiveIntensity = 1.1 + Math.sin(p * 2.0) * 0.15;
  rig.thrusterPlumeL.scale.set(0.45, 0.3 + Math.sin(p * 2.0) * 0.05, 0.45);
  rig.thrusterPlumeR.scale.set(0.45, 0.3 + Math.sin(p * 2.0) * 0.05, 0.45);
}

export const updateCharacterAnimation = updateProceduralPlayer;
