import * as THREE from 'three';
import {
  getMachinedMetalMat,
  getEmissiveNeonMat,
  getMatteRubberMat,
} from './models.ts';

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

// Cached shared geometries for character rigs (zero duplicate allocations across singleplayer + multiplayer peers)
const _charGeoCache = new Map<string, THREE.BufferGeometry>();

function getCharGeo<T extends THREE.BufferGeometry>(
  key: string,
  factory: () => T,
): T {
  let g = _charGeoCache.get(key) as T | undefined;
  if (!g) {
    g = factory();
    g.userData.isSharedPrimitive = true;
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

/**
 * Builds the 4 distinct handheld tool 3D models mounted inside `toolMountNode` on the right hand:
 * - PLASMA_RIFLE: Sci-Fi Plasma Repeater with glowing cyan accelerator coils
 * - SLEDGE: Heavy Demolition Sledgehammer with energized impact head
 * - PIPE_BOMB: Tactical C4 Remote Detonator & Sticky Charge
 * - LIGHT_BLOCK / WRENCH: Low-poly Engineering Multi-Tool & Holo-Wrench
 */
function buildHandheldTools(): Record<EquippedCharacterTool, THREE.Group | null> {
  const darkMetal = getMachinedMetalMat(0x1e293b, 0.4, 0.7);
  const slateMetal = getMachinedMetalMat(0x475569, 0.35, 0.75);
  const chromeMat = getMachinedMetalMat(0xe2e8f0, 0.2, 0.9);
  const hazardMat = getMachinedMetalMat(0xfacc15, 0.35, 0.4);
  const crimsonMat = getMachinedMetalMat(0xdc2626, 0.35, 0.5);
  const cyanGlow = getEmissiveNeonMat(0x38bdf8, 2.4);
  const orangeGlow = getEmissiveNeonMat(0xff6600, 2.2);
  const redGlow = getEmissiveNeonMat(0xef4444, 2.4);

  // 1. Plasma Rifle
  const plasmaGroup = new THREE.Group();
  plasmaGroup.name = 'Tool_PLASMA_RIFLE';
  const rifleBody = new THREE.Mesh(
    getCharGeo('tool_rifle_body', () => new THREE.BoxGeometry(0.1, 0.14, 0.44)),
    darkMetal,
  );
  rifleBody.position.set(0, 0.02, 0.14);
  setStaticSubMesh(rifleBody);

  const rifleBarrel = new THREE.Mesh(
    getCharGeo('tool_rifle_barrel', () => {
      const g = new THREE.CylinderGeometry(0.032, 0.038, 0.36, 8);
      g.rotateX(Math.PI / 2);
      return g;
    }),
    slateMetal,
  );
  rifleBarrel.position.set(0, 0.04, 0.38);
  setStaticSubMesh(rifleBarrel);

  const rifleCoil = new THREE.Mesh(
    getCharGeo('tool_rifle_coil', () => new THREE.BoxGeometry(0.115, 0.07, 0.24)),
    cyanGlow,
  );
  rifleCoil.position.set(0, 0.04, 0.22);
  setStaticSubMesh(rifleCoil);

  const rifleMuzzle = new THREE.Mesh(
    getCharGeo('tool_rifle_muzzle', () => new THREE.SphereGeometry(0.036, 8, 8)),
    cyanGlow,
  );
  rifleMuzzle.position.set(0, 0.04, 0.56);
  setStaticSubMesh(rifleMuzzle);
  plasmaGroup.add(rifleBody, rifleBarrel, rifleCoil, rifleMuzzle);
  plasmaGroup.visible = false;

  // 2. Sledgehammer
  const sledgeGroup = new THREE.Group();
  sledgeGroup.name = 'Tool_SLEDGE';
  const handle = new THREE.Mesh(
    getCharGeo('tool_sledge_shaft', () => {
      const g = new THREE.CylinderGeometry(0.024, 0.028, 0.68, 8);
      g.rotateX(Math.PI / 2);
      return g;
    }),
    slateMetal,
  );
  handle.position.set(0, 0, 0.22);
  setStaticSubMesh(handle);

  const hammerHead = new THREE.Mesh(
    getCharGeo('tool_sledge_head', () => new THREE.BoxGeometry(0.28, 0.14, 0.16)),
    darkMetal,
  );
  hammerHead.position.set(0, 0, 0.54);
  setStaticSubMesh(hammerHead);

  const strikePlates = new THREE.Mesh(
    getCharGeo('tool_sledge_strike', () => new THREE.BoxGeometry(0.31, 0.11, 0.08)),
    orangeGlow,
  );
  strikePlates.position.set(0, 0, 0.54);
  setStaticSubMesh(strikePlates);
  sledgeGroup.add(handle, hammerHead, strikePlates);
  sledgeGroup.visible = false;

  // 3. C4 Remote / Pipe Bomb
  const c4Group = new THREE.Group();
  c4Group.name = 'Tool_PIPE_BOMB';
  const detonatorBox = new THREE.Mesh(
    getCharGeo('tool_c4_box', () => new THREE.BoxGeometry(0.12, 0.08, 0.2)),
    crimsonMat,
  );
  detonatorBox.position.set(0, 0.02, 0.12);
  setStaticSubMesh(detonatorBox);

  const c4Antenna = new THREE.Mesh(
    getCharGeo('tool_c4_ant', () => new THREE.CylinderGeometry(0.008, 0.01, 0.18, 6)),
    chromeMat,
  );
  c4Antenna.position.set(0.03, 0.12, 0.18);
  setStaticSubMesh(c4Antenna);

  const c4Beacon = new THREE.Mesh(
    getCharGeo('tool_c4_led', () => new THREE.SphereGeometry(0.026, 8, 8)),
    redGlow,
  );
  c4Beacon.position.set(0, 0.07, 0.15);
  setStaticSubMesh(c4Beacon);
  c4Group.add(detonatorBox, c4Antenna, c4Beacon);
  c4Group.visible = false;

  // 4. Low-Poly Multi-Tool / Holo-Wrench
  const wrenchGroup = new THREE.Group();
  wrenchGroup.name = 'Tool_WRENCH';
  const wrenchShaft = new THREE.Mesh(
    getCharGeo('tool_wrench_shaft', () => new THREE.BoxGeometry(0.05, 0.07, 0.34)),
    hazardMat,
  );
  wrenchShaft.position.set(0, 0, 0.14);
  setStaticSubMesh(wrenchShaft);

  const wrenchJaw = new THREE.Mesh(
    getCharGeo('tool_wrench_jaw', () => {
      const g = new THREE.TorusGeometry(0.075, 0.024, 6, 12, Math.PI * 1.35);
      g.rotateX(Math.PI / 2);
      return g;
    }),
    chromeMat,
  );
  wrenchJaw.position.set(0, 0, 0.34);
  setStaticSubMesh(wrenchJaw);

  const holoCore = new THREE.Mesh(
    getCharGeo('tool_wrench_core', () => new THREE.SphereGeometry(0.038, 8, 8)),
    cyanGlow,
  );
  holoCore.position.set(0, 0, 0.34);
  setStaticSubMesh(holoCore);
  wrenchGroup.add(wrenchShaft, wrenchJaw, holoCore);
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
 * Pure Procedural Animated Engineer Rig using native Three.js primitives:
 * - `rootGroup` (handles world position & yaw)
 *   - `pelvisGroup` (walk bobbing)
 *     - `torsoMesh`: Chamfered armored chestplate (`0x1e293b`), utility belt, backpack thruster with twin cyan emissive nozzles (`0x38bdf8`).
 *     - `headGroup`: Rounded helmet with a curved cyan visor (`emissive: 0x38bdf8`, `roughness: 0.1`) and side comms antenna. Tilts with camera pitch (`-60°` to `+60°`).
 *     - `leftArmPivot` & `rightArmPivot`: Upper/lower articulated arm segments. Right hand holds a low-poly multi-tool.
 *     - `leftLegPivot` & `rightLegPivot`: Upper thigh, knee joint (`leftKneePivot` & `rightKneePivot`), and lower shin with magnetic boots.
 */
export function createArticulatedPlayerRig(accentHex = '#38bdf8'): ArticulatedCharacterRig {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'SciFiPilotRig';

  const accentColor = new THREE.Color(accentHex).getHex();
  const suitMat = getMachinedMetalMat(accentColor, 0.36, 0.55);
  const darkArmorMat = getMachinedMetalMat(0x1e293b, 0.42, 0.68);
  const slateTrimMat = getMachinedMetalMat(0x475569, 0.32, 0.75);
  const helmMat = getMachinedMetalMat(0xf8fafc, 0.25, 0.45);
  const bootMat = getMatteRubberMat(false, false);
  const beltGoldMat = getMachinedMetalMat(0xfacc15, 0.3, 0.75);

  // Per-rig materials for dynamic visor & nozzle emissive pulsing
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: new THREE.Color(0x38bdf8),
    emissiveIntensity: 0.9,
    roughness: 0.1,
    metalness: 0.2,
  });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: new THREE.Color(0x38bdf8),
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.5,
  });

  const coreGlowMat = getEmissiveNeonMat(0x38bdf8, 2.2);

  // --- 1. PELVIS GROUP (Hip Center at y = 0.72m) ---
  const pelvisGroup = new THREE.Group();
  pelvisGroup.name = 'pelvisGroup';
  pelvisGroup.position.set(0, 0.72, 0);
  rootGroup.add(pelvisGroup);

  const pelvisBlock = new THREE.Mesh(
    getCharGeo('char_pelvis', () => new THREE.BoxGeometry(0.42, 0.16, 0.26)),
    darkArmorMat,
  );
  setStaticSubMesh(pelvisBlock);
  pelvisGroup.add(pelvisBlock);

  // --- 2. TORSO MESH (Chamfered Armored Chestplate 0x1e293b + Utility Belt + Backpack Thruster with Twin Cyan Nozzles) ---
  const torsoMesh = new THREE.Mesh(
    getCharGeo('char_torso_main', () => new THREE.BoxGeometry(0.48, 0.56, 0.28)),
    darkArmorMat,
  );
  torsoMesh.name = 'torsoMesh';
  torsoMesh.position.set(0, 0.34, 0);
  torsoMesh.castShadow = true;
  torsoMesh.frustumCulled = true;
  pelvisGroup.add(torsoMesh);

  // Chamfered Armored Chestplate (0x1e293b) with beveled side plates & trim
  const chestArmorMain = new THREE.Mesh(
    getCharGeo('char_chest_plate', () => new THREE.BoxGeometry(0.44, 0.36, 0.08)),
    darkArmorMat,
  );
  chestArmorMain.position.set(0, 0.06, 0.14);
  setStaticSubMesh(chestArmorMain);

  const chestChamferTop = new THREE.Mesh(
    getCharGeo('char_chest_chamfer_top', () => new THREE.BoxGeometry(0.4, 0.1, 0.06)),
    suitMat,
  );
  chestChamferTop.position.set(0, 0.2, 0.15);
  chestChamferTop.rotation.x = -0.32;
  setStaticSubMesh(chestChamferTop);

  const chestEmblem = new THREE.Mesh(
    getCharGeo('char_chest_emblem', () => {
      const g = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 8);
      g.rotateX(Math.PI / 2);
      return g;
    }),
    coreGlowMat,
  );
  chestEmblem.position.set(0, 0.08, 0.18);
  setStaticSubMesh(chestEmblem);

  // Utility Belt & Pouches mounted along lower torso waist
  const utilityBelt = new THREE.Mesh(
    getCharGeo('char_belt', () => new THREE.BoxGeometry(0.5, 0.085, 0.31)),
    slateTrimMat,
  );
  utilityBelt.position.set(0, -0.25, 0);
  setStaticSubMesh(utilityBelt);

  const beltBuckle = new THREE.Mesh(
    getCharGeo('char_buckle', () => new THREE.BoxGeometry(0.11, 0.09, 0.04)),
    beltGoldMat,
  );
  beltBuckle.position.set(0, -0.25, 0.16);
  setStaticSubMesh(beltBuckle);

  for (const side of [-1, 1]) {
    const pouch = new THREE.Mesh(
      getCharGeo('char_pouch', () => new THREE.BoxGeometry(0.065, 0.11, 0.12)),
      darkArmorMat,
    );
    pouch.position.set(side * 0.25, -0.25, 0.02);
    setStaticSubMesh(pouch);
    torsoMesh.add(pouch);
  }

  const collarRing = new THREE.Mesh(
    getCharGeo('char_collar', () => new THREE.CylinderGeometry(0.16, 0.19, 0.08, 12)),
    slateTrimMat,
  );
  collarRing.position.set(0, 0.29, 0);
  setStaticSubMesh(collarRing);
  torsoMesh.add(chestArmorMain, chestChamferTop, chestEmblem, utilityBelt, beltBuckle, collarRing);

  // Backpack Thruster with Twin Cyan Emissive Nozzles (0x38bdf8)
  const jetpackBody = new THREE.Mesh(
    getCharGeo('char_jetpack_body', () => new THREE.BoxGeometry(0.36, 0.44, 0.16)),
    darkArmorMat,
  );
  jetpackBody.position.set(0, 0.02, -0.2);
  setStaticSubMesh(jetpackBody);

  const thrusterCore = new THREE.Mesh(
    getCharGeo('char_jetpack_core', () => new THREE.BoxGeometry(0.14, 0.26, 0.05)),
    nozzleMat,
  );
  thrusterCore.name = 'thrusterCore';
  thrusterCore.position.set(0, 0.03, -0.07);
  setStaticSubMesh(thrusterCore);
  jetpackBody.add(thrusterCore);

  const thrusterNozzleGeo = getCharGeo('char_jet_nozzle', () =>
    new THREE.CylinderGeometry(0.042, 0.068, 0.12, 8),
  );
  const plumeGeo = getCharGeo('char_jet_plume', () => {
    const g = new THREE.ConeGeometry(0.052, 0.18, 8);
    g.rotateX(Math.PI);
    return g;
  });

  const thrusterNozzleL = new THREE.Mesh(thrusterNozzleGeo, nozzleMat);
  thrusterNozzleL.name = 'thrusterNozzleL';
  thrusterNozzleL.position.set(-0.11, -0.24, -0.02);
  thrusterNozzleL.rotation.x = 0.18;
  setStaticSubMesh(thrusterNozzleL);

  const thrusterNozzleR = new THREE.Mesh(thrusterNozzleGeo, nozzleMat);
  thrusterNozzleR.name = 'thrusterNozzleR';
  thrusterNozzleR.position.set(0.11, -0.24, -0.02);
  thrusterNozzleR.rotation.x = 0.18;
  setStaticSubMesh(thrusterNozzleR);

  const thrusterPlumeL = new THREE.Mesh(plumeGeo, nozzleMat);
  thrusterPlumeL.name = 'thrusterPlumeL';
  thrusterPlumeL.position.set(-0.11, -0.35, -0.04);
  thrusterPlumeL.scale.set(0.5, 0.35, 0.5);
  thrusterPlumeL.frustumCulled = false;

  const thrusterPlumeR = new THREE.Mesh(plumeGeo, nozzleMat);
  thrusterPlumeR.name = 'thrusterPlumeR';
  thrusterPlumeR.position.set(0.11, -0.35, -0.04);
  thrusterPlumeR.scale.set(0.5, 0.35, 0.5);
  thrusterPlumeR.frustumCulled = false;

  jetpackBody.add(thrusterNozzleL, thrusterNozzleR, thrusterPlumeL, thrusterPlumeR);
  torsoMesh.add(jetpackBody);

  // --- 3. HEAD GROUP (Rounded Helmet + Curved Cyan Visor 0x38bdf8 + Side Comms Antenna) ---
  const headGroup = new THREE.Group();
  headGroup.name = 'headGroup';
  headGroup.position.set(0, 0.34, 0);
  torsoMesh.add(headGroup);

  const helmetShell = new THREE.Mesh(
    getCharGeo('char_helmet_shell', () => new THREE.SphereGeometry(0.23, 14, 12)),
    helmMat,
  );
  helmetShell.position.set(0, 0.2, 0);
  helmetShell.scale.set(0.96, 1.02, 1.04);
  setStaticSubMesh(helmetShell);

  const chinGuard = new THREE.Mesh(
    getCharGeo('char_helmet_chin', () => new THREE.BoxGeometry(0.28, 0.11, 0.26)),
    darkArmorMat,
  );
  chinGuard.position.set(0, 0.08, 0.06);
  setStaticSubMesh(chinGuard);

  // Curved Cyan Visor (emissive: 0x38bdf8, roughness: 0.1)
  const visorDome = new THREE.Mesh(
    getCharGeo('char_helmet_visor', () =>
      new THREE.SphereGeometry(0.215, 12, 10, -Math.PI * 0.38, Math.PI * 0.76, Math.PI * 0.22, Math.PI * 0.44),
    ),
    visorMat,
  );
  visorDome.name = 'visorDome';
  visorDome.rotation.y = Math.PI * 0.5;
  visorDome.position.set(0, 0.21, 0.045);
  setStaticSubMesh(visorDome);

  // Side Comms Pods & Telemetry Antenna
  for (const side of [-1, 1]) {
    const earPod = new THREE.Mesh(
      getCharGeo('char_ear_pod', () => {
        const g = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 8);
        g.rotateZ(Math.PI / 2);
        return g;
      }),
      slateTrimMat,
    );
    earPod.position.set(side * 0.22, 0.2, -0.01);
    setStaticSubMesh(earPod);
    headGroup.add(earPod);
  }

  const antennaMast = new THREE.Mesh(
    getCharGeo('char_antenna_mast', () => new THREE.CylinderGeometry(0.008, 0.014, 0.22, 6)),
    slateTrimMat,
  );
  antennaMast.position.set(-0.19, 0.36, -0.06);
  setStaticSubMesh(antennaMast);

  const antennaTip = new THREE.Mesh(
    getCharGeo('char_antenna_tip', () => new THREE.SphereGeometry(0.024, 6, 6)),
    nozzleMat,
  );
  antennaTip.position.set(-0.19, 0.48, -0.06);
  setStaticSubMesh(antennaTip);

  headGroup.add(helmetShell, chinGuard, visorDome, antennaMast, antennaTip);

  // --- 4. LEFT & RIGHT ARM PIVOTS (Upper/Lower Articulated Arm Segments + Multi-Tool Mount) ---
  const createArmAssembly = (
    side: -1 | 1,
  ): { armPivot: THREE.Group; forearmPivot: THREE.Group; handMount: THREE.Group } => {
    const armPivot = new THREE.Group();
    armPivot.name = side === -1 ? 'leftArmPivot' : 'rightArmPivot';
    armPivot.position.set(side * 0.32, 0.22, 0);

    const shoulderPad = new THREE.Mesh(
      getCharGeo('char_shoulder_pad', () => new THREE.BoxGeometry(0.18, 0.15, 0.22)),
      suitMat,
    );
    shoulderPad.position.set(side * 0.03, 0.02, 0);
    shoulderPad.rotation.z = -side * 0.18;
    setStaticSubMesh(shoulderPad);

    const upperArm = new THREE.Mesh(
      getCharGeo('char_upper_arm', () => new THREE.CylinderGeometry(0.068, 0.058, 0.28, 8)),
      darkArmorMat,
    );
    upperArm.position.set(side * 0.02, -0.14, 0);
    setStaticSubMesh(upperArm);

    const forearmPivot = new THREE.Group();
    forearmPivot.name = side === -1 ? 'leftForearmPivot' : 'rightForearmPivot';
    forearmPivot.position.set(side * 0.02, -0.28, 0);

    const elbowJoint = new THREE.Mesh(
      getCharGeo('char_elbow', () => new THREE.SphereGeometry(0.062, 8, 8)),
      slateTrimMat,
    );
    setStaticSubMesh(elbowJoint);

    const forearm = new THREE.Mesh(
      getCharGeo('char_forearm', () => new THREE.CylinderGeometry(0.062, 0.052, 0.26, 8)),
      suitMat,
    );
    forearm.position.set(0, -0.13, 0.03);
    forearm.rotation.x = -0.18;
    setStaticSubMesh(forearm);

    const glove = new THREE.Mesh(
      getCharGeo('char_glove', () => new THREE.BoxGeometry(0.1, 0.11, 0.12)),
      darkArmorMat,
    );
    glove.position.set(0, -0.26, 0.06);
    setStaticSubMesh(glove);

    const handMount = new THREE.Group();
    handMount.name = side === -1 ? 'leftHandMount' : 'toolMountNode';
    handMount.position.set(0, -0.26, 0.09);

    forearmPivot.add(elbowJoint, forearm, glove, handMount);
    armPivot.add(shoulderPad, upperArm, forearmPivot);
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

  // --- 5. LEFT & RIGHT LEG PIVOTS (Upper Thigh + Articulated Knee Joint + Lower Shin + Magnetic Boots) ---
  const createLegAssembly = (
    side: -1 | 1,
  ): { legPivot: THREE.Group; kneePivot: THREE.Group } => {
    const legPivot = new THREE.Group();
    legPivot.name = side === -1 ? 'leftLegPivot' : 'rightLegPivot';
    legPivot.position.set(side * 0.13, -0.04, 0);

    const thigh = new THREE.Mesh(
      getCharGeo('char_thigh', () => new THREE.CylinderGeometry(0.088, 0.074, 0.34, 8)),
      darkArmorMat,
    );
    thigh.position.set(0, -0.17, 0);
    setStaticSubMesh(thigh);

    // Articulated Knee Joint at y = -0.34
    const kneePivot = new THREE.Group();
    kneePivot.name = side === -1 ? 'leftKneePivot' : 'rightKneePivot';
    kneePivot.position.set(0, -0.34, 0);

    const kneePad = new THREE.Mesh(
      getCharGeo('char_knee_pad', () => new THREE.BoxGeometry(0.13, 0.12, 0.14)),
      suitMat,
    );
    kneePad.position.set(0, 0, 0.03);
    setStaticSubMesh(kneePad);

    const shin = new THREE.Mesh(
      getCharGeo('char_shin', () => new THREE.CylinderGeometry(0.076, 0.064, 0.32, 8)),
      slateTrimMat,
    );
    shin.position.set(0, -0.16, 0);
    setStaticSubMesh(shin);

    const magBoot = new THREE.Mesh(
      getCharGeo('char_mag_boot', () => new THREE.BoxGeometry(0.16, 0.12, 0.28)),
      bootMat,
    );
    magBoot.position.set(0, -0.28, 0.04);
    setStaticSubMesh(magBoot);

    const bootSoleGlow = new THREE.Mesh(
      getCharGeo('char_boot_sole', () => new THREE.BoxGeometry(0.165, 0.025, 0.285)),
      coreGlowMat,
    );
    bootSoleGlow.position.set(0, -0.33, 0.04);
    setStaticSubMesh(bootSoleGlow);

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
    rig.leftKneePivot.rotation.x = 0.75;
    rig.rightKneePivot.rotation.x = 0.75;

    rig.leftArmPivot.rotation.x = -Math.PI * 0.36 + steer * 0.38;
    rig.leftArmPivot.rotation.z = 0.14 + steer * 0.22;
    rig.rightArmPivot.rotation.x = -Math.PI * 0.36 - steer * 0.38;
    rig.rightArmPivot.rotation.z = -0.14 + steer * 0.22;

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
    rig.torsoMesh.rotation.x = jetActive ? 0.24 : 0.14;
    rig.torsoMesh.rotation.z = 0;

    if (jetActive) {
      // Stabilized flight posture with knees slightly bent and boots angled downward
      const hoverSway = Math.sin(p * 3.0) * 0.06;
      rig.leftLegPivot.rotation.set(0.16 + hoverSway, 0, -0.08);
      rig.rightLegPivot.rotation.set(0.16 - hoverSway, 0, 0.08);
      rig.leftKneePivot.rotation.x = 0.38;
      rig.rightKneePivot.rotation.x = 0.38;
    } else {
      // Legs tuck forward (-0.4) and knees bend (0.6)
      rig.leftLegPivot.rotation.set(-0.4, 0, -0.06);
      rig.rightLegPivot.rotation.set(-0.4, 0, 0.06);
      rig.leftKneePivot.rotation.x = 0.6;
      rig.rightKneePivot.rotation.x = 0.6;
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
    rig.torsoMesh.rotation.x = 0.08 * stride;
    rig.torsoMesh.rotation.z = sinP * 0.04 * stride;

    // Counter-swing hips (sin(timer))
    rig.leftLegPivot.rotation.set(sinP * legAmp, 0, 0);
    rig.rightLegPivot.rotation.set(-sinP * legAmp, 0, 0);

    // Reactive knee flexion on back-swing: Math.max(0, -sin(timer) * 1.2)
    rig.leftKneePivot.rotation.x = Math.max(0, -sinP * 1.2) * stride;
    rig.rightKneePivot.rotation.x = Math.max(0, sinP * 1.2) * stride;

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
  rig.leftKneePivot.rotation.x = 0;
  rig.rightKneePivot.rotation.x = 0;

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
