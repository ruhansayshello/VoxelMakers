import * as THREE from 'three';
import Peer, { type DataConnection, type PeerJSOption } from 'peerjs';
import {
  VOXEL_SIZE,
  MAT,
  MAT_INFO,
  WATER_LEVEL,
  type ModuleKind,
  type SerializedVehicleBlueprint,
  type WorldGenMode,
  type WorldEditToolKind,
} from './constants.ts';
import {
  computeAvatarAnimationPose,
  computeDeadReckonedTargetPos,
  computeSafeMultiplayerSpawnSpot,
  type CharacterAnimationPose,
} from './physicsMath.ts';
import {
  createArticulatedPlayerRig,
  updateCharacterAnimation,
  type CharacterEquippedTool,
} from './playerModel.ts';
import type { ModularVehicleRig } from './vehicle.ts';
import type { MicroVoxelWorld } from './world.ts';
import type { VoxelFXSystem } from './fx.ts';
import type { VoxelObjectPrefab } from './worldObjects.ts';
import { SoundFX } from './sound.ts';
import {
  beginDestructionBatch,
  flushDestructionBatch,
  destroyVoxel,
  applyDamageToVoxel,
} from './physics/destruction.ts';
import type { C4ExplosionEvent } from './physics/c4System.ts';

export const PEER_ROOM_PREFIX = 'usable-vox-room-';

export const PEERJS_FIREWALL_OPTIONS: PeerJSOption = {
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  },
};

export const MULTIPLAYER_BADGE_COLORS = [
  '#38bdf8', // Sky Cyan
  '#f59e0b', // Amber Gold
  '#10b981', // Emerald Green
  '#ec4899', // Neon Pink
  '#a855f7', // Violet Purple
  '#ef4444', // Crimson Red
  '#22d3ee', // Aqua
  '#eab308', // Solar Yellow
] as const;

export interface SerializedNetworkVehiclePart {
  partType: string;
  localPos: [number, number, number];
  localQuat: [number, number, number, number];
  color: number;
}

export interface NetworkVehicleSyncState {
  id: string;
  pos: [number, number, number];
  quat: [number, number, number, number];
  linVel: [number, number, number];
  angVel: [number, number, number];
  wheelAngles: number[];
  steerAngle: number;
  throttle: number;
  boostActive: boolean;
  lightsOn: boolean;
  ownerPeerId: string;
  driverPeerId: string | null;
  seatClaims?: Array<{ seatIndex: number; peerId: string | null }>;
  inBuildMode?: boolean;
}

export interface VehicleTransformPacket {
  type: 'VEHICLE_TRANSFORM';
  peerId: string;
  vehicleId: string;
  ownerPeerId: string;
  driverPeerId: string | null;
  pos: [number, number, number];
  quat: [number, number, number, number];
  linVel: [number, number, number];
  angVel: [number, number, number];
  wheelAngles: number[];
  steerAngle: number;
  throttle: number;
  boostActive: boolean;
  lightsOn: boolean;
  inBuildMode?: boolean;
  timestamp: number;
}

export interface VehicleSeatClaimPacket {
  type: 'VEHICLE_SEAT_CLAIM';
  event: 'SEAT_OCCUPIED_EVENT';
  vehicleId: string;
  seatIndex: number;
  peerId: string | null;
}

export interface StateSyncPacket {
  type: 'STATE_SYNC';
  peerId: string;
  name: string;
  color: string;
  mode: 'walk' | 'drive';
  isBuildMode?: boolean;
  playerPos: [number, number, number];
  playerQuat: [number, number, number, number];
  lookPitch?: number;
  walkSpeed?: number;
  isAirborne?: boolean;
  equippedTool?: CharacterEquippedTool;
  steerAngle?: number;
  activeVehicleId: string | null;
  vehicles: NetworkVehicleSyncState[];
  timestamp: number;
}

export interface BatchStateSyncPacket {
  type: 'BATCH_STATE_SYNC';
  hostPeerId: string;
  states: StateSyncPacket[];
  timestamp: number;
}

export interface SpawnVehiclePacket {
  type: 'SPAWN_VEHICLE';
  vehicleId: string;
  ownerPeerId: string;
  driverPeerId: string | null;
  seatClaims?: Array<{ seatIndex: number; peerId: string | null }>;
  parts: SerializedNetworkVehiclePart[];
  blueprint: SerializedVehicleBlueprint;
  spawnPos: [number, number, number];
  spawnQuat: [number, number, number, number];
}

export interface ClaimVehiclePacket {
  type: 'CLAIM_VEHICLE';
  vehicleId: string;
  peerId: string;
  seatIndex?: number;
  driverPeerId: string | null;
}

export interface VoxelEditPacket {
  type: 'VOXEL_EDIT';
  peerId: string;
  op: 'explosion' | 'stamp' | 'terraform' | 'ramp' | 'prefab';
  worldPos: [number, number, number];
  radius: number;
  matType: number;
  customRGB?: [number, number, number];
  toolKind?: WorldEditToolKind;
  rampStartPos?: [number, number, number];
  prefabData?: {
    prefab: VoxelObjectPrefab;
    vx: number;
    vy: number;
    vz: number;
    yawIdx: number;
    pitchIdx: number;
    rollIdx: number;
  };
}

export interface WorldMapSyncPacket {
  type: 'WORLD_MAP_SYNC';
  peerId: string;
  mapId: string;
  mapLabel: string;
  mode: WorldGenMode;
  flatMat: number;
  heightmap: {
    width: number;
    height: number;
    heights: number[];
    scaleY: number;
  } | null;
  glbMeta?: {
    sizeX: number;
    sizeY: number;
    sizeZ: number;
    scaleFactor: number;
    totalChunks: number;
    totalVoxels: number;
  };
}

export interface WorldMapGlbChunkPacket {
  type: 'WORLD_MAP_GLB_CHUNK';
  peerId: string;
  mapId: string;
  chunkIndex: number;
  totalChunks: number;
  voxels: Array<[number, number, number, number, number?, number?, number?]>;
}

export interface PingPacket {
  type: 'PING';
  fromPeerId: string;
  sentAt: number;
}

export interface PongPacket {
  type: 'PONG';
  fromPeerId: string;
  targetPeerId: string;
  sentAt: number;
}

export interface WelcomeLobbyPacket {
  type: 'WELCOME_LOBBY';
  hostPeerId: string;
  roomCode: string;
  peers: Array<{
    peerId: string;
    name: string;
    color: string;
    mode: 'walk' | 'drive';
    activeVehicleId: string | null;
    pingMs: number;
  }>;
  vehicles: SpawnVehiclePacket[];
}

export interface JoinLobbyAnnouncePacket {
  type: 'JOIN_LOBBY_ANNOUNCE';
  peerId: string;
  name: string;
  color: string;
  roomCode?: string;
}

export interface RequestVehicleBlueprintPacket {
  type: 'REQUEST_VEHICLE_BLUEPRINT';
  fromPeerId: string;
  vehicleId: string;
}

export interface VehicleCollisionImpulsePacket {
  type: 'VEHICLE_COLLISION_IMPULSE';
  fromPeerId: string;
  fromVehicleId?: string;
  targetVehicleId: string;
  deltaVel: [number, number, number];
  deltaAngVel: [number, number, number];
  pushDir: [number, number, number];
  pushDist: number;
  impactPoint: [number, number, number];
}

export interface VehicleDamageCraterPacket {
  type: 'VEHICLE_DAMAGE_CRATER';
  fromPeerId: string;
  targetVehicleId: string;
  impactWorldPos: [number, number, number];
  blastRadiusMeters: number;
}

export interface WeaponFireFxPacket {
  type: 'WEAPON_FIRE_FX';
  fromPeerId: string;
  vehicleId: string;
  weaponKind: string;
  muzzlePos: [number, number, number];
  dir: [number, number, number];
  speed: number;
}

export interface C4ExplosionPacket {
  type: 'C4_EXPLOSION';
  fromPeerId: string;
  vehicleId: string;
  voxelKey: number;
  worldPos: [number, number, number];
  destroyedVoxels: Array<{ vehicleId: string; voxelKey: number }>;
  damagedVoxels: Array<{ vehicleId: string; voxelKey: number; damage: number }>;
}

export interface PeerLeavePacket {
  type: 'PEER_LEAVE';
  peerId: string;
}

export type MultiplayerPacket =
  | StateSyncPacket
  | BatchStateSyncPacket
  | VehicleTransformPacket
  | VehicleSeatClaimPacket
  | SpawnVehiclePacket
  | ClaimVehiclePacket
  | VoxelEditPacket
  | WorldMapSyncPacket
  | WorldMapGlbChunkPacket
  | PingPacket
  | PongPacket
  | WelcomeLobbyPacket
  | JoinLobbyAnnouncePacket
  | RequestVehicleBlueprintPacket
  | VehicleCollisionImpulsePacket
  | VehicleDamageCraterPacket
  | WeaponFireFxPacket
  | C4ExplosionPacket
  | PeerLeavePacket;

export interface ActiveRoomSummary {
  roomCode: string;
  hostPeerId: string;
  hostName: string;
  playerCount: number;
  mapName: string;
  createdAt: number;
}

export interface ConnectedLobbyPlayer {
  peerId: string;
  name: string;
  color: string;
  isLocal: boolean;
  isHost: boolean;
  pingMs: number;
  mode: 'walk' | 'drive';
  activeVehicleId: string | null;
  lastSeenMs: number;
}

export interface MultiplayerLobbyUIState {
  status: 'disconnected' | 'connecting' | 'connected';
  role: 'none' | 'host' | 'client';
  roomCode: string;
  localPeerId: string;
  playerName: string;
  playerColor: string;
  players: ConnectedLobbyPlayer[];
  errorMessage: string | null;
}

/**
 * Generates a 6-character human-friendly room code in the format `VOX-849`.
 */
export function generateRoomCode(): string {
  const digits = Math.floor(100 + Math.random() * 900);
  return `VOX-${digits}`;
}

/**
 * Normalizes user input like `vox849`, `VOX-849`, or `849` into canonical `VOX-849` format
 * and strips non-alphanumeric characters for the PeerJS ID suffix.
 */
export function normalizeRoomCode(rawInput: string): {
  displayCode: string;
  cleanSuffix: string;
} {
  const cleaned = rawInput
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!cleaned) {
    return { displayCode: 'VOX-000', cleanSuffix: 'VOX000' };
  }
  if (/^\d{3}$/.test(cleaned)) {
    return {
      displayCode: `VOX-${cleaned}`,
      cleanSuffix: `VOX${cleaned}`,
    };
  }
  if (cleaned.startsWith('VOX') && cleaned.length === 6) {
    return {
      displayCode: `VOX-${cleaned.slice(3)}`,
      cleanSuffix: cleaned,
    };
  }
  const suffix = cleaned.slice(0, 6).padEnd(6, '0');
  const display =
    suffix.length === 6
      ? `${suffix.slice(0, 3)}-${suffix.slice(3)}`
      : suffix;
  return {
    displayCode: display,
    cleanSuffix: suffix,
  };
}

/**
 * Maps a 6-character room code (e.g. `VOX-849`) to its deterministic PeerJS room ID
 * (`usable-vox-room-VOX849`).
 */
export function roomCodeToPeerId(roomCode: string): string {
  const { cleanSuffix } = normalizeRoomCode(roomCode);
  return `${PEER_ROOM_PREFIX}${cleanSuffix}`;
}

/**
 * Pure helper for 60fps frame-rate independent transform interpolation (`lerp` + `slerp`).
 */
export function interpolateRemoteTransform(
  currentPos: THREE.Vector3,
  currentQuat: THREE.Quaternion,
  targetPos: THREE.Vector3,
  targetQuat: THREE.Quaternion,
  dt: number,
  sharpness = 14.0,
): void {
  const alpha = Math.min(1.0, Math.max(0.05, 1.0 - Math.exp(-sharpness * dt)));
  const distSq = currentPos.distanceToSquared(targetPos);
  if (distSq > 64.0 * 64.0) {
    // Snap if teleported or newly spawned far away
    currentPos.copy(targetPos);
    currentQuat.copy(targetQuat);
  } else {
    currentPos.lerp(targetPos, alpha);
    currentQuat.slerp(targetQuat, alpha);
  }
}

/**
 * Serializes a vehicle's voxel blocks and functional modules into the network part array
 * `[{ partType, localPos, localQuat, color }]`.
 */
export function serializeVehiclePartsArray(
  rig: ModularVehicleRig,
): SerializedNetworkVehiclePart[] {
  const parts: SerializedNetworkVehiclePart[] = [];
  const identQuat: [number, number, number, number] = [0, 0, 0, 1];

  rig.voxelMap.forEach((mat, key) => {
    if (mat === MAT.AIR) return;
    const [vx, vy, vz] = key.split(',').map(Number);
    const color = MAT_INFO[mat]?.color ?? 0x38bdf8;
    parts.push({
      partType: `VOXEL:${mat}`,
      localPos: [vx, vy, vz],
      localQuat: identQuat,
      color,
    });
  });

  const qTmp = new THREE.Quaternion();
  const eTmp = new THREE.Euler(0, 0, 0, 'YXZ');
  for (const mod of rig.modules) {
    eTmp.set(
      ((mod.pitchIdx || 0) & 3) * (Math.PI / 2),
      ((mod.yawIdx || 0) & 3) * (Math.PI / 2),
      ((mod.rollIdx || 0) & 3) * (Math.PI / 2),
      'YXZ',
    );
    qTmp.setFromEuler(eTmp);
    parts.push({
      partType: `MODULE:${mod.kind}`,
      localPos: [mod.vx, mod.vy, mod.vz],
      localQuat: [
        Number(qTmp.x.toFixed(4)),
        Number(qTmp.y.toFixed(4)),
        Number(qTmp.z.toFixed(4)),
        Number(qTmp.w.toFixed(4)),
      ],
      color: 0xf59e0b,
    });
  }

  return parts;
}

/**
 * Reconstructs a vehicle blueprint from a network `parts` array if `blueprint` is omitted or minimal.
 */
export function reconstructBlueprintFromParts(
  vehicleId: string,
  parts: SerializedNetworkVehiclePart[],
  fallbackBlueprint?: SerializedVehicleBlueprint,
): SerializedVehicleBlueprint {
  if (
    fallbackBlueprint &&
    Array.isArray(fallbackBlueprint.voxels) &&
    Array.isArray(fallbackBlueprint.modules) &&
    (fallbackBlueprint.voxels.length > 0 || fallbackBlueprint.modules.length > 0)
  ) {
    return fallbackBlueprint;
  }

  const voxels: Array<[number, number, number, number]> = [];
  const modules: SerializedVehicleBlueprint['modules'] = [];
  const qTmp = new THREE.Quaternion();
  const eTmp = new THREE.Euler(0, 0, 0, 'YXZ');

  for (const p of parts) {
    const vx = Math.round(p.localPos[0]);
    const vy = Math.round(p.localPos[1]);
    const vz = Math.round(p.localPos[2]);
    if (p.partType.startsWith('VOXEL:')) {
      const mat = Number(p.partType.slice(6)) || MAT.ALLOY_BLUE;
      voxels.push([vx, vy, vz, mat]);
    } else if (p.partType.startsWith('MODULE:')) {
      const kind = p.partType.slice(7) as ModuleKind;
      qTmp.set(p.localQuat[0], p.localQuat[1], p.localQuat[2], p.localQuat[3]);
      eTmp.setFromQuaternion(qTmp, 'YXZ');
      const yawIdx = Math.round(eTmp.y / (Math.PI / 2)) & 3;
      const pitchIdx = Math.round(eTmp.x / (Math.PI / 2)) & 3;
      const rollIdx = Math.round(eTmp.z / (Math.PI / 2)) & 3;
      modules.push({
        kind,
        vx,
        vy,
        vz,
        yawIdx,
        pitchIdx,
        rollIdx,
      });
    }
  }

  return {
    id: vehicleId,
    name: fallbackBlueprint?.name || 'Remote Rig',
    createdAt: new Date().toLocaleDateString(),
    massKg: fallbackBlueprint?.massKg || 800,
    blockCount: voxels.length + modules.length,
    powerCores: fallbackBlueprint?.powerCores || 2,
    voxels,
    modules,
  };
}

/**
 * Creates a 3D humanoid voxel character mesh used both for the local player character when walking
 * (`playerCharacterMesh`) and for remote players in the multiplayer lobby.
 */
/**
 * Creates a 3D humanoid voxel character mesh used both for the local player character when walking
 * (`playerCharacterMesh`) and for remote players in the multiplayer lobby.
 */
export function createVoxelCharacterAvatar(accentHex = '#38bdf8'): THREE.Group {
  const rig = createArticulatedPlayerRig(accentHex);
  return rig.rootGroup;
}

/**
 * Applies procedural skeletal limb and torso articulation to a character avatar.
 */
export function applyAvatarPose(
  avatarGroup: THREE.Group,
  pose: CharacterAnimationPose,
): void {
  const { leftLeg, rightLeg, leftArm, rightArm, torso, head, toolMesh } =
    avatarGroup.userData as {
      leftLeg?: THREE.Group;
      rightLeg?: THREE.Group;
      leftArm?: THREE.Group;
      rightArm?: THREE.Group;
      torso?: THREE.Mesh;
      head?: THREE.Object3D;
      toolMesh?: THREE.Object3D;
    };

  if (!leftLeg || !rightLeg || !leftArm || !rightArm) return;

  leftLeg.rotation.x = pose.leftLegX;
  leftLeg.rotation.z = pose.leftLegZ;
  leftLeg.position.y = -0.04 + pose.leftLegOffsetY;

  rightLeg.rotation.x = pose.rightLegX;
  rightLeg.rotation.z = pose.rightLegZ;
  rightLeg.position.y = -0.04 + pose.rightLegOffsetY;

  leftArm.rotation.x = pose.leftArmX;
  leftArm.rotation.z = pose.leftArmZ;

  rightArm.rotation.x = pose.rightArmX;
  rightArm.rotation.z = pose.rightArmZ;

  if (torso) {
    torso.position.y = 0.34 + pose.torsoOffsetY;
    torso.rotation.x = pose.torsoRotX;
  }
  if (head) {
    head.rotation.x = pose.headRotX;
  }
  if (toolMesh) {
    toolMesh.visible = pose.toolActive;
  }
}

/**
 * Creates an animated holographic 3D bottom grid projected onto the terrain under players who are in Build Mode,
 * so all other players in the session immediately see that this player is in Build Mode!
 */
export function createHolographicBuildGrid(): THREE.Group {
  const group = new THREE.Group();

  // Cyan and dark blue blueprint grid
  const grid = new THREE.GridHelper(13.0, 26, 0x38bdf8, 0x0284c7);
  grid.position.y = 0.05;

  // Luminous boundary frame
  const boundaryGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(13.0, 0.18, 13.0));
  const boundaryMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.9,
  });
  const boundary = new THREE.LineSegments(boundaryGeo, boundaryMat);
  boundary.position.y = 0.09;

  // Semi-transparent glowing blueprint baseplate
  const plateGeo = new THREE.PlaneGeometry(13.0, 13.0);
  plateGeo.rotateX(-Math.PI / 2);
  const plateMat = new THREE.MeshBasicMaterial({
    color: 0x0284c7,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.y = 0.04;

  // Corner vertical holographic construction beams
  const cornerGeo = new THREE.BufferGeometry();
  const cornerPositions = new Float32Array([
    -6.5, 0, -6.5,  -6.5, 5.5, -6.5,
     6.5, 0, -6.5,   6.5, 5.5, -6.5,
    -6.5, 0,  6.5,  -6.5, 5.5,  6.5,
     6.5, 0,  6.5,   6.5, 5.5,  6.5,
  ]);
  cornerGeo.setAttribute('position', new THREE.BufferAttribute(cornerPositions, 3));
  const cornerMat = new THREE.LineBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.8,
  });
  const beacons = new THREE.LineSegments(cornerGeo, cornerMat);

  // Rotating golden construction beacon ring
  const ringGeo = new THREE.RingGeometry(4.8, 5.2, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  const scanRing = new THREE.Mesh(ringGeo, ringMat);
  scanRing.position.y = 0.08;

  group.add(grid, boundary, plate, beacons, scanRing);
  group.userData = { scanRing };
  group.visible = false;
  return group;
}

interface RemotePeerRenderEntity {
  peerId: string;
  name: string;
  color: string;
  mode: 'walk' | 'drive';
  isBuildMode: boolean;
  activeVehicleId: string | null;
  pingMs: number;
  lastSeenMs: number;
  currentPos: THREE.Vector3;
  currentQuat: THREE.Quaternion;
  targetPos: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  lookPitch: number;
  walkSpeed: number;
  isAirborne: boolean;
  equippedTool: CharacterEquippedTool;
  steerAngle: number;
  avatarGroup: THREE.Group;
  buildGridGroup: THREE.Group;
  nameplateSprite: THREE.Sprite;
  nameplateCanvas: HTMLCanvasElement;
  nameplateTexture: THREE.CanvasTexture;
  lastRenderedLabel: string;
  walkCyclePhase: number;
}

interface RemoteVehicleInterpTarget {
  vehicleId: string;
  targetPos: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  linVel: THREE.Vector3;
  angVel: THREE.Vector3;
  wheelAngles: number[];
  steerAngle: number;
  throttle: number;
  boostActive: boolean;
  lightsOn: boolean;
  ownerPeerId: string | null;
  driverPeerId: string | null;
  lastUpdatedMs: number;
}

export interface MultiplayerContextCallbacks {
  scene: THREE.Scene;
  world: MicroVoxelWorld;
  fx: VoxelFXSystem;
  getCreations: () => ModularVehicleRig[];
  getActiveVehicle: () => ModularVehicleRig | null;
  getIsWalking: () => boolean;
  getIsBuilding?: () => boolean;
  getLocalPlayerTransform: () => { pos: THREE.Vector3; quat: THREE.Quaternion };
  getLocalCharacterAnimState?: () => {
    lookPitch: number;
    walkSpeed: number;
    isAirborne: boolean;
    equippedTool: CharacterEquippedTool;
    steerAngle: number;
  };
  spawnRemoteVehicleRig: (packet: SpawnVehiclePacket) => ModularVehicleRig;
  onRemoteMapSynced?: (mapLabel: string) => void;
  onStateChange: (uiState: MultiplayerLobbyUIState) => void;
  onStatusToast?: (msg: string) => void;
}

interface IncomingGlbMapBuffer {
  mapId: string;
  mapLabel: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  scaleFactor: number;
  totalChunks: number;
  receivedChunks: Map<
    number,
    Array<[number, number, number, number, number?, number?, number?]>
  >;
}

function getRigVoxelCount(rig: ModularVehicleRig): number {
  if (rig.voxelMap && typeof rig.voxelMap.size === 'number') {
    return rig.voxelMap.size;
  }
  const legacyVoxels = (rig as unknown as { voxels?: { size?: number } }).voxels;
  if (legacyVoxels && typeof legacyVoxels.size === 'number') {
    return legacyVoxels.size;
  }
  return typeof rig.voxelCount === 'number' ? rig.voxelCount : 0;
}

function computeBlueprintSignature(
  bp: SerializedVehicleBlueprint | undefined,
): string {
  if (!bp) return 'empty';
  const vLen = Array.isArray(bp.voxels) ? bp.voxels.length : 0;
  const mLen = Array.isArray(bp.modules) ? bp.modules.length : 0;
  const firstV = vLen > 0 ? `${bp.voxels[0][0]},${bp.voxels[0][1]},${bp.voxels[0][2]},${bp.voxels[0][3]}` : '';
  const lastV =
    vLen > 0
      ? `${bp.voxels[vLen - 1][0]},${bp.voxels[vLen - 1][1]},${bp.voxels[vLen - 1][2]},${bp.voxels[vLen - 1][3]}`
      : '';
  return `${vLen}:${mLen}:${bp.massKg ?? 0}:${firstV}:${lastV}`;
}

const _interpPredPos = new THREE.Vector3();
const _interpPredQuat = new THREE.Quaternion();
const _interpDeltaQuat = new THREE.Quaternion();
const _seatOffsetTmp = new THREE.Vector3();

export class P2PMultiplayerManager {
  private ctx: MultiplayerContextCallbacks;
  public peer: Peer | null = null;
  public connections = new Map<string, DataConnection>();
  private broadcastChannel: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: number | null = null;
  private connectTimeoutId: number | null = null;
  private fallbackTimerId: number | null = null;
  private bcAnnounceTimerId: number | null = null;
  private requestedBlueprintTime = new Map<string, number>();
  private missingBlueprintTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingHostBatchStates = new Map<string, StateSyncPacket>();
  private lastBroadcastVehiclesMs = 0;

  public status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  public role: 'none' | 'host' | 'client' = 'none';
  public roomCode = '';
  public localPeerId = '';
  public hostPeerId = '';
  public playerName: string;
  public playerColor: string;
  public errorMessage: string | null = null;
  public activeMapName = 'Default Map';

  public remotePeers = new Map<string, RemotePeerRenderEntity>();
  public vehicleInterpTargets = new Map<string, RemoteVehicleInterpTarget>();
  public isApplyingRemoteEdit = false;
  private incomingGlbBuffers = new Map<string, IncomingGlbMapBuffer>();

  private syncIntervalId: number | null = null;
  private batchSyncIntervalId: number | null = null;
  private pingIntervalId: number | null = null;

  constructor(ctx: MultiplayerContextCallbacks) {
    this.ctx = ctx;
    const randSuffix = Math.floor(10 + Math.random() * 90);
    this.playerName = `Pilot_${randSuffix}`;
    this.playerColor =
      MULTIPLAYER_BADGE_COLORS[
        Math.floor(Math.random() * MULTIPLAYER_BADGE_COLORS.length)
      ];
  }

  public setPlayerProfile(name: string, color?: string): void {
    const trimmed = name.trim().slice(0, 18);
    if (trimmed) this.playerName = trimmed;
    if (color) this.playerColor = color;
    this.emitUIState();
  }

  public setProfile(name: string, color?: string): void {
    this.setPlayerProfile(name, color);
  }

  /**
   * Queries `/api/multiplayer/rooms` on the local/cloud relay server so players can see
   * and 1-click join active multiplayer lobbies without typing a room code manually.
   */
  public async fetchActiveRooms(): Promise<ActiveRoomSummary[]> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return [];
    try {
      const res = await fetch('/api/multiplayer/rooms');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.rooms) ? data.rooms : [];
    } catch {
      return [];
    }
  }

  public getUIState(): MultiplayerLobbyUIState {
    const players: ConnectedLobbyPlayer[] = [];
    if (this.status !== 'disconnected') {
      const activeVeh = this.ctx.getActiveVehicle();
      players.push({
        peerId: this.localPeerId || 'local',
        name: this.playerName,
        color: this.playerColor,
        isLocal: true,
        isHost: this.role === 'host',
        pingMs: 0,
        mode: this.ctx.getIsWalking() ? 'walk' : 'drive',
        activeVehicleId:
          !this.ctx.getIsWalking() && activeVeh ? activeVeh.vehicleId : null,
        lastSeenMs: performance.now(),
      });
      this.remotePeers.forEach((rp) => {
        players.push({
          peerId: rp.peerId,
          name: rp.name,
          color: rp.color,
          isLocal: false,
          isHost: rp.peerId === this.hostPeerId,
          pingMs: rp.pingMs,
          mode: rp.mode,
          activeVehicleId: rp.activeVehicleId,
          lastSeenMs: rp.lastSeenMs,
        });
      });
    }
    return {
      status: this.status,
      role: this.role,
      roomCode: this.roomCode,
      localPeerId: this.localPeerId,
      playerName: this.playerName,
      playerColor: this.playerColor,
      players,
      errorMessage: this.errorMessage,
    };
  }

  private emitUIState(): void {
    this.ctx.onStateChange(this.getUIState());
  }

  /**
   * Determines whether the local peer is the sole physics & transform authority for `rig`.
   * Strict rule: ONLY the `ownerPeerId` (when no remote peer is driving in seat 0) OR the driver
   * currently sitting in the primary seat (seat 0) is allowed to broadcast `VEHICLE_TRANSFORM`.
   * The Host MUST NOT overwrite or snap a client's vehicle if the client owns/drives it.
   */
  public hasLocalPhysicsAuthority(rig: ModularVehicleRig): boolean {
    const myPeerId = this.localPeerId || 'local';
    const primaryDriver = rig.getPrimarySeatOccupant() ?? rig.driverPeerId;

    // If a remote peer is seated in the primary driver seat, that remote driver has authority
    if (
      primaryDriver &&
      primaryDriver !== myPeerId &&
      primaryDriver !== 'local'
    ) {
      return false;
    }

    // If the local player is actively seated in the primary seat, local player has authority
    const isWalking = this.ctx.getIsWalking();
    const activeVeh = this.ctx.getActiveVehicle();
    if (
      (!isWalking &&
        activeVeh === rig &&
        (!primaryDriver ||
          primaryDriver === myPeerId ||
          primaryDriver === 'local')) ||
      primaryDriver === myPeerId ||
      (myPeerId !== 'local' &&
        primaryDriver === 'local' &&
        rig.isLocalOwner(myPeerId))
    ) {
      return true;
    }

    // Otherwise, SOLE physics authority belongs strictly to the player who spawned the vehicle (`ownerPeerId === myPeerId`)
    return rig.isLocalOwner(myPeerId) || rig.ownerPeerId === 'local';
  }

  /**
   * Rebinds locally spawned vehicles when `localPeerId` is assigned on lobby host/join so every
   * local vehicle has a cryptographically unique `${peerId}_veh_${Date.now()}_${rand}` `networkId`,
   * explicit `ownerPeerId`, and locked primary seat for the seated creator.
   */
  private rebindLocalOwnedVehicles(newPeerId: string): void {
    if (!newPeerId) return;
    const creations = this.ctx.getCreations();
    const activeVeh = this.ctx.getActiveVehicle();
    const isWalking = this.ctx.getIsWalking();

    for (const v of creations) {
      const ownedByUs =
        !v.ownerPeerId ||
        v.ownerPeerId === 'local' ||
        v.ownerPeerId === this.localPeerId ||
        v.ownerPeerId === newPeerId;
      if (!ownedByUs) continue;

      v.ownerPeerId = newPeerId;
      if (!v.networkId || !v.networkId.startsWith(`${newPeerId}_veh_`)) {
        v.networkId = `${newPeerId}_veh_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      }
      v.isRemoteControlled = false;

      if (!isWalking && activeVeh === v) {
        v.claimSeat(0, newPeerId);
      } else {
        const seats = v.getSeatModules();
        for (let i = 0; i < seats.length; i++) {
          if (
            seats[i].seatedPlayerId === 'local' ||
            seats[i].seatedPlayerId === this.localPeerId
          ) {
            v.claimSeat(i, newPeerId);
          }
        }
      }
    }
  }

  /**
   * Relocates any locally owned vehicle that spawns on top of an existing remote vehicle in the lobby
   * so joining players never telefrag or overlap at (0, -4).
   */
  private relocateOverlappingLocalVehicles(): void {
    const creations = this.ctx.getCreations();
    const remotePositions: Array<{ x: number; y: number; z: number }> = [];
    for (const r of creations) {
      if (!this.hasLocalPhysicsAuthority(r)) {
        remotePositions.push({
          x: r.position.x,
          y: r.position.y,
          z: r.position.z,
        });
      }
    }
    if (remotePositions.length === 0) return;

    for (const rig of creations) {
      if (!this.hasLocalPhysicsAuthority(rig)) continue;
      const isTooClose = remotePositions.some((rp) => {
        const dx = rig.position.x - rp.x;
        const dz = rig.position.z - rp.z;
        return dx * dx + dz * dz < 7.5 * 7.5;
      });
      if (isTooClose) {
        const { pos: safePos } = computeSafeMultiplayerSpawnSpot(
          { x: rig.position.x, y: rig.position.y, z: rig.position.z },
          remotePositions,
          8.5,
        );
        const ground = this.ctx.world.probeGroundBelow(
          safePos.x,
          rig.position.y + 8,
          safePos.z,
          2.0,
        );
        const spawnY = Math.max(WATER_LEVEL + 1.4, ground.y + 1.6);
        rig.position.set(safePos.x, spawnY, safePos.z);
        rig.velocity.set(0, 0, 0);
        rig.angularVelocity.set(0, 0, 0);
        rig.syncVisualTransform();
        remotePositions.push({ x: safePos.x, y: spawnY, z: safePos.z });
      }
    }
  }

  /**
   * Broadcasts full `SPAWN_VEHICLE` blueprints + seat claims for all locally owned vehicles.
   */
  public broadcastAllLocalVehicles(force = false): void {
    if (this.status === 'disconnected') return;
    const now = performance.now();
    if (!force && now - this.lastBroadcastVehiclesMs < 900) {
      return;
    }
    this.lastBroadcastVehiclesMs = now;
    const creations = this.ctx.getCreations();
    for (const rig of creations) {
      if (this.hasLocalPhysicsAuthority(rig)) {
        this.broadcastSpawnVehicle(rig);
      }
    }
  }

  /**
   * Hosts a new P2P Lobby with an optional or generated 6-character room code (e.g., `VOX-849`).
   */
  public hostLobby(customRoomCode?: string): string {
    this.disconnect();

    const rawCode = customRoomCode || generateRoomCode();
    const { displayCode } = normalizeRoomCode(rawCode);
    const targetPeerId = roomCodeToPeerId(displayCode);

    this.roomCode = displayCode;
    this.role = 'host';
    this.status = 'connecting';
    this.localPeerId = targetPeerId;
    this.hostPeerId = targetPeerId;
    this.errorMessage = null;

    // Assign local ownership & unique networkId to all locally spawned vehicles
    this.rebindLocalOwnedVehicles(this.localPeerId);

    // 1. Open same-origin BroadcastChannel bridge
    this.setupBroadcastChannelBridge(displayCode);
    // 2. Open WebSocket Room Relay bridge (cross-browser, incognito, LAN & Cloud Run support)
    this.setupWebSocketBridge(displayCode);

    try {
      const peer = new Peer(targetPeerId, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
            {
              urls: 'turn:openrelay.metered.ca:443?transport=tcp',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
          ],
        },
      });
      this.peer = peer;

      this.connectTimeoutId = window.setTimeout(() => {
        this.connectTimeoutId = null;
        if (this.status === 'connecting' && this.role === 'host') {
          this.status = 'connected';
          this.broadcastAllLocalVehicles();
          this.emitUIState();
        }
      }, 650);

      peer.on('open', (id) => {
        if (this.connectTimeoutId !== null) {
          window.clearTimeout(this.connectTimeoutId);
          this.connectTimeoutId = null;
        }
        this.localPeerId = id;
        this.hostPeerId = id;
        this.rebindLocalOwnedVehicles(id);
        this.status = 'connected';
        this.errorMessage = null;
        this.broadcastAllLocalVehicles();
        this.emitUIState();
        this.ctx.onStatusToast?.(`HOSTING LOBBY ${this.roomCode} (COPIED TO CLIPBOARD)`);
      });

      peer.on('connection', (conn) => {
        this.registerDataConnection(conn);
      });

      peer.on('error', (err) => {
        if (this.connectTimeoutId !== null) {
          window.clearTimeout(this.connectTimeoutId);
          this.connectTimeoutId = null;
        }
        if (this.status === 'connecting') {
          this.status = 'connected';
          this.broadcastAllLocalVehicles();
        }
        if (err && err.type === 'unavailable-id') {
          // Even if PeerJS cloud ID is busy, WebSocket & BroadcastChannel relay still work seamlessly
          this.errorMessage = null;
        }
        this.emitUIState();
      });
    } catch {
      this.status = 'connected';
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(this.roomCode).catch(() => {});
    }

    this.startSyncTimers();
    this.emitUIState();
    return this.roomCode;
  }

  /**
   * Joins an existing friend's P2P Lobby using their 6-character Room Code (e.g., `VOX-849`).
   */
  public joinLobby(inputCode: string): void {
    const { displayCode } = normalizeRoomCode(inputCode);
    const hostId = roomCodeToPeerId(displayCode);

    this.disconnect();

    this.roomCode = displayCode;
    this.role = 'client';
    this.status = 'connecting';
    this.hostPeerId = hostId;
    this.localPeerId = `${hostId}-peer-${Math.random().toString(36).slice(2, 7)}`;
    this.errorMessage = null;

    // Rebind local vehicles to our unique client peerId and lock our seat claim before connecting
    this.rebindLocalOwnedVehicles(this.localPeerId);

    // Proactively offset joining client's vehicle if it is still sitting on the default (0, -4) spawn
    // so joining a lobby never spawns the client directly on top of the Host's vehicle!
    for (const rig of this.ctx.getCreations()) {
      if (this.hasLocalPhysicsAuthority(rig)) {
        const distFromDefaultOrigin = Math.hypot(
          rig.position.x - 0,
          rig.position.z - -4,
        );
        if (distFromDefaultOrigin < 6.5) {
          const { pos: safePos } = computeSafeMultiplayerSpawnSpot(
            { x: rig.position.x, y: rig.position.y, z: rig.position.z },
            [{ x: 0, y: rig.position.y, z: -4 }],
            9.5,
          );
          const ground = this.ctx.world.probeGroundBelow(
            safePos.x,
            rig.position.y + 8,
            safePos.z,
            2.0,
          );
          const spawnY = Math.max(WATER_LEVEL + 1.4, ground.y + 1.6);
          rig.position.set(safePos.x, spawnY, safePos.z);
          rig.velocity.set(0, 0, 0);
          rig.angularVelocity.set(0, 0, 0);
          rig.syncVisualTransform();
        }
      }
    }

    // 1. Same-origin BroadcastChannel bridge
    this.setupBroadcastChannelBridge(displayCode);
    // 2. WebSocket Room Relay bridge
    this.setupWebSocketBridge(displayCode);

    try {
      const peer = new Peer(this.localPeerId, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
            {
              urls: 'turn:openrelay.metered.ca:443?transport=tcp',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
          ],
        },
      });
      this.peer = peer;

      this.fallbackTimerId = window.setTimeout(() => {
        this.fallbackTimerId = null;
        if (this.status === 'connecting' && this.role === 'client') {
          this.status = 'connected';
          this.sendJoinAnnounceAndBlueprints();
          this.emitUIState();
        }
      }, 750);

      peer.on('open', (id) => {
        this.localPeerId = id;
        this.rebindLocalOwnedVehicles(id);
        const conn = peer.connect(hostId, {
          reliable: true,
        });
        this.registerDataConnection(conn, () => {
          if (this.fallbackTimerId !== null) {
            window.clearTimeout(this.fallbackTimerId);
            this.fallbackTimerId = null;
          }
          this.status = 'connected';
          this.errorMessage = null;
          this.emitUIState();
          this.ctx.onStatusToast?.(`CONNECTED TO LOBBY ${this.roomCode}`);
        });
      });

      peer.on('connection', (conn) => {
        this.registerDataConnection(conn);
      });

      peer.on('error', () => {
        if (this.fallbackTimerId !== null) {
          window.clearTimeout(this.fallbackTimerId);
          this.fallbackTimerId = null;
        }
        if (this.status === 'connecting') {
          this.status = 'connected';
          this.sendJoinAnnounceAndBlueprints();
          this.emitUIState();
        }
      });
    } catch {
      this.status = 'connected';
    }

    this.startSyncTimers();
    this.emitUIState();
  }

  private sendJoinAnnounceAndBlueprints(): void {
    if (this.status === 'disconnected') return;
    const announce: JoinLobbyAnnouncePacket = {
      type: 'JOIN_LOBBY_ANNOUNCE',
      peerId: this.localPeerId,
      name: this.playerName,
      color: this.playerColor,
    };
    this.sendToAll(announce);
    this.sendToAll(this.buildStateSyncPacket());
    this.broadcastAllLocalVehicles();
  }

  /**
   * Connects to `/ws-multiplayer` on the Express + Vite server so rooms work reliably across
   * different browsers, incognito windows, devices, and Cloud Run proxies even when WebRTC STUN is blocked.
   */
  private setupWebSocketBridge(displayCode: string): void {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      return;
    }
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws-multiplayer`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws || this.status === 'disconnected') return;
        this.status = 'connected';
        ws.send(
          JSON.stringify({
            type: 'WS_ROOM_JOIN',
            roomCode: displayCode,
            peerId: this.localPeerId,
            name: this.playerName,
            color: this.playerColor,
            role: this.role,
          }),
        );
        this.sendJoinAnnounceAndBlueprints();
        this.emitUIState();
      };

      ws.onmessage = (ev) => {
        if (this.ws !== ws || this.status === 'disconnected') return;
        try {
          const msg = JSON.parse(String(ev.data));
          if (!msg || typeof msg !== 'object') return;

          if (msg.type === 'WS_ROOM_JOINED_ACK') {
            if (msg.hostPeerId && this.role === 'client') {
              this.hostPeerId = msg.hostPeerId;
            }
            if (Array.isArray(msg.cachedVehicles)) {
              for (const vPkt of msg.cachedVehicles as SpawnVehiclePacket[]) {
                if (vPkt && vPkt.ownerPeerId !== this.localPeerId) {
                  this.applySpawnVehiclePacket(vPkt);
                }
              }
              this.relocateOverlappingLocalVehicles();
            }
            if (msg.cachedWorldMap && this.role === 'client') {
              const mapPkt = msg.cachedWorldMap as WorldMapSyncPacket;
              if (mapPkt.peerId !== this.localPeerId && mapPkt.mode !== 'CUSTOM_GLB_MAP') {
                this.applyWorldMapSyncPacket(mapPkt);
              }
            }
            this.broadcastAllLocalVehicles();
            this.emitUIState();
            return;
          }

          if (msg.type === 'WS_RELAY' && msg.packet) {
            const pkt = msg.packet as MultiplayerPacket;
            if (pkt && typeof pkt === 'object' && 'type' in pkt) {
              this.handleIncomingPacket(pkt, null);
            }
            return;
          }

          if ('type' in msg) {
            this.handleIncomingPacket(msg as MultiplayerPacket, null);
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          if (this.status !== 'disconnected' && this.roomCode === displayCode) {
            this.wsReconnectTimer = window.setTimeout(() => {
              if (this.status !== 'disconnected' && this.roomCode === displayCode) {
                this.setupWebSocketBridge(displayCode);
              }
            }, 1500);
          }
        }
      };

      ws.onerror = () => {
        // Handled by onclose/fallback
      };
    } catch {
      // Ignore if WebSocket fails to initialize in headless/unit-test environments
    }
  }

  private setupBroadcastChannelBridge(displayCode: string): void {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const bc = new BroadcastChannel(`vox-p2p-${displayCode}`);
      this.broadcastChannel = bc;
      bc.onmessage = (ev) => {
        const data = ev.data as MultiplayerPacket | undefined;
        if (!data || typeof data !== 'object' || !('type' in data)) return;
        this.handleIncomingPacket(data, null);
      };
      // Immediately announce presence and blueprints on the channel
      this.bcAnnounceTimerId = window.setTimeout(() => {
        this.bcAnnounceTimerId = null;
        if (this.status !== 'disconnected') {
          this.status = 'connected';
          this.sendJoinAnnounceAndBlueprints();
          this.emitUIState();
        }
      }, 60);
    } catch {
      // Ignore if BroadcastChannel is unsupported
    }
  }

  private registerDataConnection(
    conn: DataConnection,
    onOpenCallback?: () => void,
  ): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.status = 'connected';
      onOpenCallback?.();

      // Send immediate state sync
      conn.send(this.buildStateSyncPacket());

      // If we are the Host, send the full lobby welcome snapshot (all current vehicles, peers & active map!)
      if (this.role === 'host') {
        const welcome = this.buildWelcomeLobbyPacket();
        conn.send(welcome);
        for (const vPacket of welcome.vehicles) {
          conn.send(vPacket);
        }
        this.broadcastWorldMapSync(this.activeMapName, conn);
      } else {
        // Connected to Host as Client: immediately broadcast all local creations and their seat claims to Host!
        this.sendJoinAnnounceAndBlueprints();
      }
      this.emitUIState();
    });

    conn.on('data', (raw) => {
      const packet = raw as MultiplayerPacket;
      if (!packet || typeof packet !== 'object' || !('type' in packet)) return;
      this.handleIncomingPacket(packet, conn);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.removeRemotePeer(conn.peer);
      this.emitUIState();
    });

    conn.on('error', () => {
      this.connections.delete(conn.peer);
    });
  }

  private buildWelcomeLobbyPacket(): WelcomeLobbyPacket {
    const creations = this.ctx.getCreations();
    // Only include vehicles that actually have blocks/modules (never send empty 0-voxel placeholders!)
    const validCreations = creations.filter(
      (rig) =>
        !rig.rootGroup?.userData?.isPlaceholderBlueprint &&
        (getRigVoxelCount(rig) > 0 || rig.modules.length > 0),
    );
    const vehicles: SpawnVehiclePacket[] = validCreations.map((rig) => ({
      type: 'SPAWN_VEHICLE',
      vehicleId: rig.networkId,
      ownerPeerId: rig.ownerPeerId || this.localPeerId,
      driverPeerId: rig.getPrimarySeatOccupant() ?? rig.driverPeerId,
      seatClaims: rig.getSeatModules().map((s, idx) => ({
        seatIndex: idx,
        peerId: s.seatedPlayerId ?? null,
      })),
      parts: [],
      blueprint: rig.exportBlueprint(rig.customBlueprintName || 'Synced Rig'),
      spawnPos: [rig.position.x, rig.position.y, rig.position.z],
      spawnQuat: [
        rig.quaternion.x,
        rig.quaternion.y,
        rig.quaternion.z,
        rig.quaternion.w,
      ],
    }));

    const peers: WelcomeLobbyPacket['peers'] = [];
    this.remotePeers.forEach((rp) => {
      peers.push({
        peerId: rp.peerId,
        name: rp.name,
        color: rp.color,
        mode: rp.mode,
        activeVehicleId: rp.activeVehicleId,
        pingMs: rp.pingMs,
      });
    });

    return {
      type: 'WELCOME_LOBBY',
      hostPeerId: this.localPeerId,
      roomCode: this.roomCode,
      peers,
      vehicles,
    };
  }

  private startSyncTimers(): void {
    this.stopSyncTimers();
    // 25Hz (every 40ms) local STATE_SYNC loop
    this.syncIntervalId = window.setInterval(() => {
      if (this.status !== 'connected') return;
      if (this.role === 'host' && this.remotePeers.size === 0 && this.connections.size === 0) {
        return;
      }
      try {
        const packet = this.buildStateSyncPacket();
        if (this.role === 'host') {
          this.pendingHostBatchStates.set(this.localPeerId, packet);
        } else {
          this.sendToAll(packet);
        }
      } catch {
        // Ignore transient sync error
      }
    }, 40);

    // 10Hz (every 100ms) combined BATCH_STATE_SYNC packet from Host containing all peer states
    this.batchSyncIntervalId = window.setInterval(() => {
      if (this.status !== 'connected' || this.role !== 'host') return;
      if (this.pendingHostBatchStates.size === 0 || (this.remotePeers.size === 0 && this.connections.size === 0)) {
        this.pendingHostBatchStates.clear();
        return;
      }
      try {
        const batchPacket: BatchStateSyncPacket = {
          type: 'BATCH_STATE_SYNC',
          hostPeerId: this.localPeerId,
          states: Array.from(this.pendingHostBatchStates.values()),
          timestamp: Date.now(),
        };
        this.pendingHostBatchStates.clear();
        this.sendToAll(batchPacket);
      } catch {
        // Ignore transient batch sync error
      }
    }, 100);

    // 1Hz ping measurement loop
    this.pingIntervalId = window.setInterval(() => {
      if (this.status !== 'connected') return;
      if (this.remotePeers.size === 0 && this.connections.size === 0 && this.role === 'host') {
        return;
      }
      const ping: PingPacket = {
        type: 'PING',
        fromPeerId: this.localPeerId,
        sentAt: performance.now(),
      };
      this.sendToAll(ping);
      if (this.remotePeers.size > 0) {
        this.emitUIState();
      }
    }, 1000);
  }

  private stopSyncTimers(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    if (this.batchSyncIntervalId !== null) {
      window.clearInterval(this.batchSyncIntervalId);
      this.batchSyncIntervalId = null;
    }
    if (this.pingIntervalId !== null) {
      window.clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
    this.missingBlueprintTimeouts.forEach((timerId) => clearTimeout(timerId));
    this.missingBlueprintTimeouts.clear();
    this.pendingHostBatchStates.clear();
  }

  private sendToAll(packet: MultiplayerPacket, excludePeerId?: string): void {
    let rtcSentCount = 0;
    this.connections.forEach((conn, peerId) => {
      if (excludePeerId && peerId === excludePeerId) return;
      if (conn.open) {
        try {
          conn.send(packet);
          rtcSentCount++;
        } catch {
          // Ignore transient send errors
        }
      }
    });
    const isHighFreqSync =
      packet.type === 'STATE_SYNC' ||
      packet.type === 'BATCH_STATE_SYNC' ||
      packet.type === 'PING' ||
      packet.type === 'PONG';
    const allPeersCoveredByRtc =
      isHighFreqSync &&
      this.remotePeers.size > 0 &&
      rtcSentCount >= this.remotePeers.size;
    if (allPeersCoveredByRtc) {
      return;
    }
    const wsOpen = Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
    if (this.broadcastChannel && !excludePeerId && !(isHighFreqSync && wsOpen)) {
      try {
        this.broadcastChannel.postMessage(packet);
      } catch {
        // Ignore broadcast channel errors
      }
    }
    if (wsOpen && this.ws && !excludePeerId) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'WS_RELAY',
            roomCode: this.roomCode,
            fromPeerId: this.localPeerId,
            packet,
          }),
        );
      } catch {
        // Ignore WS send error
      }
    }
  }

  public buildStateSyncPacket(): StateSyncPacket {
    const isWalking = this.ctx.getIsWalking();
    const isBuilding = this.ctx.getIsBuilding ? this.ctx.getIsBuilding() : false;
    const activeVeh = this.ctx.getActiveVehicle();
    const { pos, quat } = this.ctx.getLocalPlayerTransform();
    const creations = this.ctx.getCreations();

    const syncedVehicles: NetworkVehicleSyncState[] = [];
    for (const rig of creations) {
      // STRICT AUTHORITY: ONLY broadcast transforms for vehicles where we are the ownerPeerId
      // (with no remote driver in seat 0) OR we are actively driving in seat 0.
      // Never allow the Host to overwrite or snap a client's vehicle!
      if (!this.hasLocalPhysicsAuthority(rig)) {
        continue;
      }

      const primaryOccupant = rig.getPrimarySeatOccupant() ?? rig.driverPeerId;
      const isOurDrivenVehicle =
        !isWalking &&
        activeVeh === rig &&
        (!primaryOccupant ||
          primaryOccupant === this.localPeerId ||
          primaryOccupant === 'local');

      syncedVehicles.push({
        id: rig.networkId,
        pos: [
          Number(rig.position.x.toFixed(3)),
          Number(rig.position.y.toFixed(3)),
          Number(rig.position.z.toFixed(3)),
        ],
        quat: [
          Number(rig.quaternion.x.toFixed(4)),
          Number(rig.quaternion.y.toFixed(4)),
          Number(rig.quaternion.z.toFixed(4)),
          Number(rig.quaternion.w.toFixed(4)),
        ],
        linVel: [
          Number(rig.velocity.x.toFixed(2)),
          Number(rig.velocity.y.toFixed(2)),
          Number(rig.velocity.z.toFixed(2)),
        ],
        angVel: [
          Number(rig.angularVelocity.x.toFixed(2)),
          Number(rig.angularVelocity.y.toFixed(2)),
          Number(rig.angularVelocity.z.toFixed(2)),
        ],
        wheelAngles: rig.getWheelSpinAngles(),
        steerAngle: Number(rig.steerAngle.toFixed(3)),
        throttle: Number((rig.speedKmh / 100).toFixed(2)),
        boostActive: rig.isBoostingNow,
        lightsOn: rig.headlightsOn,
        ownerPeerId: rig.ownerPeerId || this.localPeerId,
        driverPeerId: isOurDrivenVehicle
          ? this.localPeerId
          : primaryOccupant,
        inBuildMode: rig.inBuildMode,
      });
    }

    const animState = this.ctx.getLocalCharacterAnimState
      ? this.ctx.getLocalCharacterAnimState()
      : undefined;

    return {
      type: 'STATE_SYNC',
      peerId: this.localPeerId,
      name: this.playerName,
      color: this.playerColor,
      mode: isWalking ? 'walk' : 'drive',
      isBuildMode: isBuilding,
      playerPos: [
        Number(pos.x.toFixed(3)),
        Number(pos.y.toFixed(3)),
        Number(pos.z.toFixed(3)),
      ],
      playerQuat: [
        Number(quat.x.toFixed(4)),
        Number(quat.y.toFixed(4)),
        Number(quat.z.toFixed(4)),
        Number(quat.w.toFixed(4)),
      ],
      lookPitch: animState ? Number(animState.lookPitch.toFixed(3)) : 0,
      walkSpeed: animState ? Number(animState.walkSpeed.toFixed(2)) : 0,
      isAirborne: animState ? animState.isAirborne : false,
      equippedTool: animState ? animState.equippedTool : 'NONE',
      steerAngle: animState
        ? Number(animState.steerAngle.toFixed(3))
        : activeVeh
          ? Number(activeVeh.steerAngle.toFixed(3))
          : 0,
      activeVehicleId: !isWalking && activeVeh ? activeVeh.networkId : null,
      vehicles: syncedVehicles,
      timestamp: Date.now(),
    };
  }

  /**
   * Broadcasts `VEHICLE_TRANSFORM` packets strictly for vehicles where the local player
   * is the `ownerPeerId` (or the driver currently seated in the primary seat).
   */
  public broadcastVehicleTransforms(): void {
    if (this.status === 'disconnected') return;
    const creations = this.ctx.getCreations();
    const isWalking = this.ctx.getIsWalking();
    const activeVeh = this.ctx.getActiveVehicle();

    for (const rig of creations) {
      if (!this.hasLocalPhysicsAuthority(rig)) continue;
      const primaryOccupant = rig.getPrimarySeatOccupant() ?? rig.driverPeerId;
      const isOurDrivenVehicle =
        !isWalking &&
        activeVeh === rig &&
        (!primaryOccupant ||
          primaryOccupant === this.localPeerId ||
          primaryOccupant === 'local');

      const pkt: VehicleTransformPacket = {
        type: 'VEHICLE_TRANSFORM',
        peerId: this.localPeerId,
        vehicleId: rig.networkId,
        ownerPeerId: rig.ownerPeerId || this.localPeerId,
        driverPeerId: isOurDrivenVehicle ? this.localPeerId : primaryOccupant,
        pos: [
          Number(rig.position.x.toFixed(3)),
          Number(rig.position.y.toFixed(3)),
          Number(rig.position.z.toFixed(3)),
        ],
        quat: [
          Number(rig.quaternion.x.toFixed(4)),
          Number(rig.quaternion.y.toFixed(4)),
          Number(rig.quaternion.z.toFixed(4)),
          Number(rig.quaternion.w.toFixed(4)),
        ],
        linVel: [
          Number(rig.velocity.x.toFixed(2)),
          Number(rig.velocity.y.toFixed(2)),
          Number(rig.velocity.z.toFixed(2)),
        ],
        angVel: [
          Number(rig.angularVelocity.x.toFixed(2)),
          Number(rig.angularVelocity.y.toFixed(2)),
          Number(rig.angularVelocity.z.toFixed(2)),
        ],
        wheelAngles: rig.getWheelSpinAngles(),
        steerAngle: Number(rig.steerAngle.toFixed(3)),
        throttle: Number((rig.speedKmh / 100).toFixed(2)),
        boostActive: rig.isBoostingNow,
        lightsOn: rig.headlightsOn,
        inBuildMode: rig.inBuildMode,
        timestamp: Date.now(),
      };
      this.sendToAll(pkt);
    }
  }

  /**
   * Broadcasts `SPAWN_VEHICLE` whenever the local player spawns a preset, loads a saved vehicle,
   * or finishes building/modifying a vehicle in Build Mode.
   */
  public broadcastSpawnVehicle(rig: ModularVehicleRig): void {
    const myPeerId = this.localPeerId || 'local';
    if (!rig.ownerPeerId || rig.ownerPeerId === 'local') {
      rig.ownerPeerId = myPeerId;
    }
    if (!rig.networkId || !rig.networkId.includes('_veh_')) {
      rig.networkId = `${myPeerId}_veh_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    }
    if (this.status === 'disconnected') return;

    const seatClaims = rig.getSeatModules().map((s, idx) => ({
      seatIndex: idx,
      peerId:
        s.seatedPlayerId === 'local' ? myPeerId : (s.seatedPlayerId ?? null),
    }));
    const primaryDriver =
      rig.getPrimarySeatOccupant() === 'local'
        ? myPeerId
        : (rig.getPrimarySeatOccupant() ?? rig.driverPeerId);

    const packet: SpawnVehiclePacket = {
      type: 'SPAWN_VEHICLE',
      vehicleId: rig.networkId,
      ownerPeerId: rig.ownerPeerId || myPeerId,
      driverPeerId: primaryDriver,
      seatClaims,
      parts: [],
      blueprint: rig.exportBlueprint(rig.customBlueprintName || 'Synced Rig'),
      spawnPos: [rig.position.x, rig.position.y, rig.position.z],
      spawnQuat: [
        rig.quaternion.x,
        rig.quaternion.y,
        rig.quaternion.z,
        rig.quaternion.w,
      ],
    };
    this.sendToAll(packet);

    // Also broadcast explicit VEHICLE_SEAT_CLAIM packets so all remote peers lock the creator's seat
    for (const sc of seatClaims) {
      if (sc.peerId) {
        this.broadcastSeatClaim(rig, sc.seatIndex, sc.peerId);
      }
    }
  }

  /**
   * Broadcasts a collision impulse to a remote-owned vehicle when our local vehicle rams or collides with it,
   * so both vehicles experience realistic two-way physical knockback and spin across the network!
   */
  public broadcastVehicleCollisionImpulse(
    targetVehicleId: string,
    deltaVel: [number, number, number],
    deltaAngVel: [number, number, number],
    pushDir: [number, number, number],
    pushDist: number,
    impactPoint: [number, number, number],
  ): void {
    if (this.status === 'disconnected') return;
    const pkt: VehicleCollisionImpulsePacket = {
      type: 'VEHICLE_COLLISION_IMPULSE',
      fromPeerId: this.localPeerId,
      targetVehicleId,
      deltaVel: [
        Number(deltaVel[0].toFixed(3)),
        Number(deltaVel[1].toFixed(3)),
        Number(deltaVel[2].toFixed(3)),
      ],
      deltaAngVel: [
        Number(deltaAngVel[0].toFixed(3)),
        Number(deltaAngVel[1].toFixed(3)),
        Number(deltaAngVel[2].toFixed(3)),
      ],
      pushDir: [
        Number(pushDir[0].toFixed(3)),
        Number(pushDir[1].toFixed(3)),
        Number(pushDir[2].toFixed(3)),
      ],
      pushDist: Number(Math.min(1.5, Math.max(0, pushDist)).toFixed(3)),
      impactPoint: [
        Number(impactPoint[0].toFixed(2)),
        Number(impactPoint[1].toFixed(2)),
        Number(impactPoint[2].toFixed(2)),
      ],
    };
    this.sendToAll(pkt);
  }

  /**
   * Broadcasts voxel crater damage on a vehicle so weapon hits and high-speed crashes break blocks on all peers.
   */
  public broadcastVehicleDamageCrater(
    targetVehicleId: string,
    impactWorldPos: [number, number, number],
    blastRadiusMeters: number,
  ): void {
    if (this.status === 'disconnected' || this.isApplyingRemoteEdit) return;
    const pkt: VehicleDamageCraterPacket = {
      type: 'VEHICLE_DAMAGE_CRATER',
      fromPeerId: this.localPeerId,
      targetVehicleId,
      impactWorldPos: [
        Number(impactWorldPos[0].toFixed(2)),
        Number(impactWorldPos[1].toFixed(2)),
        Number(impactWorldPos[2].toFixed(2)),
      ],
      blastRadiusMeters: Number(blastRadiusMeters.toFixed(2)),
    };
    this.sendToAll(pkt);
  }

  /**
   * Broadcasts a C4 explosion event so remote peers see the explosion FX, debris, and exact vehicle voxel damage.
   */
  public broadcastC4Explosion(event: C4ExplosionEvent): void {
    if (this.status === 'disconnected' || this.isApplyingRemoteEdit) return;
    const pkt: C4ExplosionPacket = {
      type: 'C4_EXPLOSION',
      fromPeerId: this.localPeerId,
      vehicleId: event.vehicleId,
      voxelKey: event.voxelKey,
      worldPos: [
        Number(event.worldPos.x.toFixed(2)),
        Number(event.worldPos.y.toFixed(2)),
        Number(event.worldPos.z.toFixed(2)),
      ],
      destroyedVoxels: event.destroyedVoxelKeys.map((d) => ({
        vehicleId: d.vehicle.networkId || d.vehicle.vehicleId || event.vehicleId,
        voxelKey: d.voxelKey,
      })),
      damagedVoxels: event.damagedVoxels
        .filter((d) => !d.destroyed)
        .map((d) => ({
          vehicleId: d.vehicle.networkId || d.vehicle.vehicleId || event.vehicleId,
          voxelKey: d.voxelKey,
          damage: d.damage,
        })),
    };
    this.sendToAll(pkt);
  }

  /**
   * Broadcasts weapon fire FX (blasters, cannons, missiles,emp) so remote peers see muzzle flashes & tracers.
   */
  public broadcastWeaponFireFx(
    vehicleId: string,
    weaponKind: string,
    muzzlePos: [number, number, number],
    dir: [number, number, number],
    speed: number,
  ): void {
    if (this.status === 'disconnected') return;
    const pkt: WeaponFireFxPacket = {
      type: 'WEAPON_FIRE_FX',
      fromPeerId: this.localPeerId,
      vehicleId,
      weaponKind,
      muzzlePos: [
        Number(muzzlePos[0].toFixed(2)),
        Number(muzzlePos[1].toFixed(2)),
        Number(muzzlePos[2].toFixed(2)),
      ],
      dir: [
        Number(dir[0].toFixed(3)),
        Number(dir[1].toFixed(3)),
        Number(dir[2].toFixed(3)),
      ],
      speed: Number(speed.toFixed(1)),
    };
    this.sendToAll(pkt);
  }

  /**
   * Broadcasts `VEHICLE_SEAT_CLAIM { vehicleId, seatIndex, peerId }` (`SEAT_OCCUPIED_EVENT`)
   * so other players see the seat as locked when occupied, or freed (`peerId: null`) when exited.
   */
  public broadcastSeatClaim(
    rig: ModularVehicleRig,
    seatIndex: number,
    peerId: string | null,
  ): void {
    const resolvedPeer =
      peerId === 'local' ? this.localPeerId || 'local' : peerId;
    rig.claimSeat(seatIndex, resolvedPeer);
    rig.isRemoteControlled = !this.hasLocalPhysicsAuthority(rig);

    if (this.status === 'disconnected') return;
    const packet: VehicleSeatClaimPacket = {
      type: 'VEHICLE_SEAT_CLAIM',
      event: 'SEAT_OCCUPIED_EVENT',
      vehicleId: rig.networkId,
      seatIndex,
      peerId: resolvedPeer,
    };
    this.sendToAll(packet);
  }

  /**
   * Broadcasts `CLAIM_VEHICLE` and `VEHICLE_SEAT_CLAIM` when a player enters or exits a vehicle seat.
   */
  public broadcastClaimVehicle(
    rig: ModularVehicleRig,
    claimed: boolean,
    seatIndex = 0,
  ): void {
    const nextDriver = claimed ? this.localPeerId || 'local' : null;
    this.broadcastSeatClaim(rig, seatIndex, nextDriver);

    if (this.status === 'disconnected') return;
    const packet: ClaimVehiclePacket = {
      type: 'CLAIM_VEHICLE',
      vehicleId: rig.networkId,
      peerId: this.localPeerId,
      seatIndex,
      driverPeerId: nextDriver,
    };
    this.sendToAll(packet);
  }

  /**
   * Broadcasts `VOXEL_EDIT` (`explosion`, `stamp`, `terraform`, `ramp`, or `prefab`) to all connected peers.
   */
  public broadcastVoxelEdit(
    op: 'explosion' | 'stamp' | 'terraform' | 'ramp' | 'prefab',
    worldPos: [number, number, number],
    radius: number,
    matType: number,
    customRGB?: [number, number, number],
    extra?: {
      toolKind?: WorldEditToolKind;
      rampStartPos?: [number, number, number];
      prefabData?: VoxelEditPacket['prefabData'];
    },
  ): void {
    if (this.status === 'disconnected' || this.isApplyingRemoteEdit) return;
    const packet: VoxelEditPacket = {
      type: 'VOXEL_EDIT',
      peerId: this.localPeerId,
      op,
      worldPos,
      radius,
      matType,
      customRGB,
      toolKind: extra?.toolKind,
      rampStartPos: extra?.rampStartPos,
      prefabData: extra?.prefabData,
    };
    this.sendToAll(packet);
  }

  /**
   * Broadcasts the full World Map state (`WORLD_MAP_SYNC` + chunked `WORLD_MAP_GLB_CHUNK` for custom 3D .GLB worlds)
   * so all players in the lobby share the exact same custom map, biome, or heightmap!
   */
  public broadcastWorldMapSync(
    mapLabel?: string,
    targetConn?: DataConnection,
  ): void {
    if (mapLabel) {
      this.activeMapName = mapLabel;
    }
    if (this.status === 'disconnected' || this.isApplyingRemoteEdit) return;

    const world = this.ctx.world;
    const mode = world.worldGenMode;
    const mapId = `map_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const dispatchPacket = (pkt: MultiplayerPacket) => {
      if (targetConn) {
        if (targetConn.open) {
          try {
            targetConn.send(pkt);
          } catch {
            // Ignore transient send errors
          }
        }
      } else {
        this.sendToAll(pkt);
      }
    };

    if (mode === 'CUSTOM_GLB_MAP' && world.activeGlbMapData) {
      const glb = world.activeGlbMapData;
      const voxels = glb.voxels || [];
      const CHUNK_VOXEL_COUNT = 3500; // ~50KB JSON per packet, safely below WebRTC 64KB SCTP limit
      const totalChunks = Math.max(
        1,
        Math.ceil(voxels.length / CHUNK_VOXEL_COUNT),
      );

      const header: WorldMapSyncPacket = {
        type: 'WORLD_MAP_SYNC',
        peerId: this.localPeerId,
        mapId,
        mapLabel: this.activeMapName || 'Custom 3D .GLB World',
        mode: 'CUSTOM_GLB_MAP',
        flatMat: world.flatBaseplateMat,
        heightmap: null,
        glbMeta: {
          sizeX: glb.sizeX,
          sizeY: glb.sizeY,
          sizeZ: glb.sizeZ,
          scaleFactor: glb.scaleFactor,
          totalChunks,
          totalVoxels: voxels.length,
        },
      };
      dispatchPacket(header);

      for (let c = 0; c < totalChunks; c++) {
        const slice = voxels.slice(
          c * CHUNK_VOXEL_COUNT,
          (c + 1) * CHUNK_VOXEL_COUNT,
        );
        const chunkPkt: WorldMapGlbChunkPacket = {
          type: 'WORLD_MAP_GLB_CHUNK',
          peerId: this.localPeerId,
          mapId,
          chunkIndex: c,
          totalChunks,
          voxels: slice,
        };
        dispatchPacket(chunkPkt);
      }
      return;
    }

    const syncPacket: WorldMapSyncPacket = {
      type: 'WORLD_MAP_SYNC',
      peerId: this.localPeerId,
      mapId,
      mapLabel: this.activeMapName || `Biome: ${mode}`,
      mode,
      flatMat: world.flatBaseplateMat,
      heightmap: world.heightmapData
        ? {
            width: world.heightmapData.width,
            height: world.heightmapData.height,
            heights: Array.from(world.heightmapData.heights),
            scaleY: world.heightmapData.scaleY,
          }
        : null,
    };
    dispatchPacket(syncPacket);
  }

  /**
   * Requests a full `SPAWN_VEHICLE` blueprint from a remote peer if we received a transform
   * for a vehicle whose full voxel/module blueprint hasn't arrived yet.
   * Includes a 5s timeout that deletes the placeholder vehicle if no response arrives.
   */
  private requestMissingBlueprint(vehicleId: string): void {
    const now = performance.now();
    const lastReq = this.requestedBlueprintTime.get(vehicleId) || 0;
    if (now - lastReq < 1500) return;
    this.requestedBlueprintTime.set(vehicleId, now);

    if (!this.missingBlueprintTimeouts.has(vehicleId)) {
      const timeoutId = setTimeout(() => {
        this.missingBlueprintTimeouts.delete(vehicleId);
        this.requestedBlueprintTime.delete(vehicleId);
        const creations = this.ctx.getCreations();
        const idx = creations.findIndex((r) => r.networkId === vehicleId);
        if (idx !== -1) {
          const rig = creations[idx];
          const isStillPlaceholder =
            Boolean(rig.rootGroup?.userData?.isPlaceholderBlueprint) ||
            (getRigVoxelCount(rig) === 0 && rig.modules.length === 0);
          if (isStillPlaceholder && !this.hasLocalPhysicsAuthority(rig)) {
            if (typeof rig.dispose === 'function') {
              rig.dispose();
            } else if (rig.rootGroup) {
              this.ctx.scene.remove(rig.rootGroup);
            }
            creations.splice(idx, 1);
            this.vehicleInterpTargets.delete(vehicleId);
          }
        }
      }, 5000);
      this.missingBlueprintTimeouts.set(vehicleId, timeoutId);
    }

    const req: RequestVehicleBlueprintPacket = {
      type: 'REQUEST_VEHICLE_BLUEPRINT',
      fromPeerId: this.localPeerId,
      vehicleId,
    };
    this.sendToAll(req);
  }

  /**
   * Processes any incoming network packet (or simulated test packet).
   */
  public handleIncomingPacket(
    packet: MultiplayerPacket,
    sourceConn: DataConnection | null = null,
  ): void {
    try {
      if (packet.type === 'STATE_SYNC') {
        if (packet.peerId === this.localPeerId) return;
        this.applyStateSyncPacket(packet);
        if (this.role === 'host') {
          this.pendingHostBatchStates.set(packet.peerId, packet);
        }
      } else if (packet.type === 'BATCH_STATE_SYNC') {
        for (let i = 0; i < packet.states.length; i++) {
          const st = packet.states[i];
          if (st.peerId !== this.localPeerId) {
            this.applyStateSyncPacket(st);
          }
        }
      } else if (packet.type === 'JOIN_LOBBY_ANNOUNCE') {
        if (packet.peerId === this.localPeerId) return;
        if (this.role === 'host') {
          const welcome = this.buildWelcomeLobbyPacket();
          this.sendToAll(welcome);
          if (this.ctx.world.worldGenMode !== 'DEFAULT_PARK') {
            this.broadcastWorldMapSync(this.activeMapName);
          }
        }
        this.broadcastAllLocalVehicles();
      } else if (packet.type === 'REQUEST_VEHICLE_BLUEPRINT') {
        if (packet.fromPeerId === this.localPeerId) return;
        const rig = this.ctx
          .getCreations()
          .find((r) => r.networkId === packet.vehicleId);
        if (rig && this.hasLocalPhysicsAuthority(rig)) {
          this.broadcastSpawnVehicle(rig);
        }
      } else if (packet.type === 'VEHICLE_TRANSFORM') {
        if (packet.peerId === this.localPeerId) return;
        this.applyVehicleTransformPacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'VEHICLE_COLLISION_IMPULSE') {
        if (packet.fromPeerId === this.localPeerId) return;
        this.applyVehicleCollisionImpulsePacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'VEHICLE_DAMAGE_CRATER') {
        if (packet.fromPeerId === this.localPeerId) return;
        this.applyVehicleDamageCraterPacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'WEAPON_FIRE_FX') {
        if (packet.fromPeerId === this.localPeerId) return;
        this.applyWeaponFireFxPacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'C4_EXPLOSION') {
        if (packet.fromPeerId === this.localPeerId) return;
        this.applyC4ExplosionPacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'VEHICLE_SEAT_CLAIM') {
        this.applySeatClaimPacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'SPAWN_VEHICLE') {
        if (packet.ownerPeerId === this.localPeerId) {
          return;
        }
        this.applySpawnVehiclePacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'CLAIM_VEHICLE') {
        if (packet.peerId === this.localPeerId) return;
        this.applyClaimVehiclePacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'VOXEL_EDIT') {
        if (packet.peerId === this.localPeerId) return;
        this.applyVoxelEditPacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'WORLD_MAP_SYNC') {
        if (packet.peerId === this.localPeerId) return;
        this.applyWorldMapSyncPacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'WORLD_MAP_GLB_CHUNK') {
        if (packet.peerId === this.localPeerId) return;
        this.applyWorldMapGlbChunkPacket(packet);
        if (this.role === 'host' && sourceConn) {
          this.sendToAll(packet, sourceConn.peer);
        }
      } else if (packet.type === 'PING') {
        if (packet.fromPeerId === this.localPeerId) return;
        const pong: PongPacket = {
          type: 'PONG',
          fromPeerId: this.localPeerId,
          targetPeerId: packet.fromPeerId,
          sentAt: packet.sentAt,
        };
        if (sourceConn && sourceConn.open) {
          sourceConn.send(pong);
        } else {
          this.sendToAll(pong);
        }
      } else if (packet.type === 'PONG') {
        if (packet.targetPeerId !== this.localPeerId) return;
        const rtt = Math.max(1, Math.round(performance.now() - packet.sentAt));
        const rp = this.remotePeers.get(packet.fromPeerId);
        if (rp) {
          rp.pingMs = rtt;
        }
      } else if (packet.type === 'WELCOME_LOBBY') {
        this.hostPeerId = packet.hostPeerId;
        for (const vPacket of packet.vehicles) {
          // Never let WELCOME_LOBBY overwrite our own locally owned vehicles!
          if (vPacket.ownerPeerId === this.localPeerId) continue;
          const existingLocal = this.ctx
            .getCreations()
            .find((r) => r.networkId === vPacket.vehicleId);
          if (existingLocal && this.hasLocalPhysicsAuthority(existingLocal)) {
            continue;
          }
          this.applySpawnVehiclePacket(vPacket);
        }
        // Prevent spawn telefragging if our car started at the exact same spot as the Host's car
        this.relocateOverlappingLocalVehicles();
        // Broadcast all local vehicles back so the Host and other peers have our full blueprint
        this.broadcastAllLocalVehicles();
        this.emitUIState();
      } else if (packet.type === 'PEER_LEAVE') {
        if (packet.peerId === this.localPeerId) return;
        this.removeRemotePeer(packet.peerId);
        this.emitUIState();
      }
    } catch (err) {
      console.warn('[Multiplayer] Error handling packet:', err);
    }
  }

  private applyVehicleCollisionImpulsePacket(
    packet: VehicleCollisionImpulsePacket,
  ): void {
    const creations = this.ctx.getCreations();
    const rig = creations.find((r) => r.networkId === packet.targetVehicleId);
    if (!rig || !this.hasLocalPhysicsAuthority(rig)) return;

    const pushDist = Math.min(0.65, Math.max(0, packet.pushDist || 0));
    rig.position.x += (packet.pushDir[0] || 0) * pushDist;
    rig.position.z += (packet.pushDir[2] || 0) * pushDist;

    rig.velocity.x += Math.max(-10, Math.min(10, packet.deltaVel[0] || 0));
    rig.velocity.y += Math.max(-0.5, Math.min(0.5, packet.deltaVel[1] || 0));
    rig.velocity.z += Math.max(-10, Math.min(10, packet.deltaVel[2] || 0));
    rig.velocity.clampLength(0, 32);

    rig.angularVelocity.x += Math.max(
      -0.8,
      Math.min(0.8, packet.deltaAngVel[0] || 0),
    );
    rig.angularVelocity.y += Math.max(
      -1.2,
      Math.min(1.2, packet.deltaAngVel[1] || 0),
    );
    rig.angularVelocity.z += Math.max(
      -0.8,
      Math.min(0.8, packet.deltaAngVel[2] || 0),
    );
    rig.angularVelocity.clampLength(0, 2.5);

    rig.syncVisualTransform();
    const [ix, iy, iz] = packet.impactPoint;
    this.ctx.fx.spawnWeldSparks(ix, iy, iz);
    this.ctx.fx.spawnDebris(ix, iy, iz, 0xf59e0b, 6.0, 1.0);
  }

  private applyVehicleDamageCraterPacket(
    packet: VehicleDamageCraterPacket,
  ): void {
    const creations = this.ctx.getCreations();
    const rig = creations.find((r) => r.networkId === packet.targetVehicleId);
    if (!rig) return;

    this.isApplyingRemoteEdit = true;
    try {
      const [ix, iy, iz] = packet.impactWorldPos;
      const radiusVoxels = Math.max(
        1,
        Math.min(12, Math.round(packet.blastRadiusMeters / VOXEL_SIZE)),
      );
      rig.carveVehicleCrater(ix, iy, iz, radiusVoxels, 0);
      this.ctx.fx.spawnWeldSparks(ix, iy, iz);
      this.ctx.fx.spawnDebris(ix, iy, iz, 0xf97316, 8.0, 1.2);
    } finally {
      this.isApplyingRemoteEdit = false;
    }
  }

  private applyWeaponFireFxPacket(packet: WeaponFireFxPacket): void {
    const [mx, my, mz] = packet.muzzlePos;
    this.ctx.fx.spawnWeldSparks(mx, my, mz);
  }

  private applyC4ExplosionPacket(packet: C4ExplosionPacket): void {
    const creations = this.ctx.getCreations();
    const [wx, wy, wz] = packet.worldPos;
    const blastOrigin = new THREE.Vector3(wx, wy, wz);
    const c4SpeedRange = { minMPS: 10, maxMPS: 30 };

    this.isApplyingRemoteEdit = true;
    beginDestructionBatch();
    try {
      for (const d of packet.destroyedVoxels) {
        const rig = creations.find(
          (r) => r.networkId === d.vehicleId || r.vehicleId === d.vehicleId,
        );
        if (rig) {
          destroyVoxel(
            rig,
            d.voxelKey,
            blastOrigin,
            this.ctx.fx?.voxelDebrisSystem,
            true,
            c4SpeedRange,
          );
        }
      }
      for (const dmg of packet.damagedVoxels) {
        const rig = creations.find(
          (r) => r.networkId === dmg.vehicleId || r.vehicleId === dmg.vehicleId,
        );
        if (rig) {
          applyDamageToVoxel(
            rig,
            dmg.voxelKey,
            dmg.damage,
            blastOrigin,
            this.ctx.fx?.voxelDebrisSystem,
            true,
            c4SpeedRange,
          );
        }
      }
      // Spawn 8-12 orange/red C4 explosion FX particles & play explosion sound on remote peer
      const fxColors = [0xf97316, 0xef4444, 0xdc2626, 0xfb923c];
      for (let i = 0; i < 10; i++) {
        const col = fxColors[i % fxColors.length];
        this.ctx.fx?.spawnDebris(
          wx,
          wy + 0.1,
          wz,
          col,
          10 + Math.random() * 20,
          1.25,
        );
        this.ctx.fx?.voxelDebrisSystem?.spawnDebrisVoxel(
          blastOrigin,
          new THREE.Vector3(0, 0, 0),
          blastOrigin,
          col,
          MAT.C4_EXPLOSIVE,
          c4SpeedRange,
        );
      }
      SoundFX.explode();
    } finally {
      flushDestructionBatch();
      this.isApplyingRemoteEdit = false;
    }
  }

  private applyStateSyncPacket(packet: StateSyncPacket): void {
    let entity = this.remotePeers.get(packet.peerId);
    const isNewPeer = !entity;
    if (!entity) {
      entity = this.createRemotePeerEntity(packet);
      this.remotePeers.set(packet.peerId, entity);
      // If we are Host and discovered a new peer, send welcome snapshot + active world map + our vehicles!
      if (this.role === 'host') {
        const welcome = this.buildWelcomeLobbyPacket();
        this.sendToAll(welcome);
        if (this.ctx.world.worldGenMode !== 'DEFAULT_PARK') {
          this.broadcastWorldMapSync(this.activeMapName);
        }
      }
      this.broadcastAllLocalVehicles();
    }

    entity.name = packet.name || entity.name;
    entity.color = packet.color || entity.color;
    entity.mode = packet.mode;
    entity.isBuildMode = Boolean(packet.isBuildMode);
    entity.activeVehicleId = packet.activeVehicleId;
    entity.lastSeenMs = performance.now();
    entity.lookPitch = packet.lookPitch ?? entity.lookPitch;
    entity.walkSpeed = packet.walkSpeed ?? entity.walkSpeed;
    entity.isAirborne = packet.isAirborne ?? false;
    entity.equippedTool =
      packet.equippedTool ?? (entity.isBuildMode ? 'WRENCH' : 'NONE');
    entity.steerAngle = packet.steerAngle ?? entity.steerAngle;
    entity.targetPos.set(
      packet.playerPos[0],
      packet.playerPos[1],
      packet.playerPos[2],
    );
    entity.targetQuat.set(
      packet.playerQuat[0],
      packet.playerQuat[1],
      packet.playerQuat[2],
      packet.playerQuat[3],
    );

    const creations = this.ctx.getCreations();

    for (const vs of packet.vehicles) {
      let localRig = creations.find((r) => r.networkId === vs.id);

      // STRICT AUTHORITY CHECK:
      // 1) Never allow a remote peer (including the Host) to overwrite a vehicle for which we hold local physics authority!
      if (localRig && this.hasLocalPhysicsAuthority(localRig)) {
        continue;
      }
      // 2) Only accept transform packets from the vehicle's ownerPeerId or its active primary-seat driver!
      if (localRig) {
        const senderIsOwner = packet.peerId === localRig.ownerPeerId;
        const senderIsDriver =
          packet.peerId === vs.driverPeerId ||
          packet.peerId === localRig.getPrimarySeatOccupant();
        if (!senderIsOwner && !senderIsDriver) {
          continue;
        }
      }

      if (!localRig && this.status === 'connected') {
        // Vehicle seen in state sync before SPAWN_VEHICLE packet arrived:
        // Spawn a visible placeholder rig AND request the real blueprint from the owner!
        localRig = this.ctx.spawnRemoteVehicleRig({
          type: 'SPAWN_VEHICLE',
          vehicleId: vs.id,
          ownerPeerId: vs.ownerPeerId || packet.peerId,
          driverPeerId: vs.driverPeerId,
          seatClaims: vs.seatClaims,
          parts: [],
          blueprint: {
            id: vs.id,
            name: `${packet.name}'s Rig`,
            createdAt: new Date().toLocaleTimeString(),
            massKg: 800,
            blockCount: 40,
            powerCores: 4,
            voxels: [],
            modules: [],
          },
          spawnPos: vs.pos,
          spawnQuat: vs.quat,
        });
        this.relocateOverlappingLocalVehicles();
        this.requestMissingBlueprint(vs.id);
      } else if (
        localRig &&
        (localRig.rootGroup?.userData?.isPlaceholderBlueprint ||
          (getRigVoxelCount(localRig) === 0 && localRig.modules.length === 0))
      ) {
        this.requestMissingBlueprint(vs.id);
      }

      this.upsertVehicleInterpTarget(
        vs.id,
        vs.pos,
        vs.quat,
        vs.linVel,
        vs.angVel,
        vs.wheelAngles || [],
        vs.steerAngle,
        vs.throttle,
        vs.boostActive,
        vs.lightsOn,
        vs.ownerPeerId || packet.peerId,
        vs.driverPeerId ?? null,
      );

      if (localRig) {
        if (vs.seatClaims) {
          for (const sc of vs.seatClaims) {
            if (sc.peerId !== this.localPeerId) {
              localRig.claimSeat(sc.seatIndex, sc.peerId);
            }
          }
        } else if (vs.driverPeerId !== this.localPeerId) {
          localRig.claimSeat(0, vs.driverPeerId);
        }
        localRig.isRemoteControlled = !this.hasLocalPhysicsAuthority(localRig);
      }
    }

    if (isNewPeer) {
      this.emitUIState();
    }
  }

  private applyVehicleTransformPacket(packet: VehicleTransformPacket): void {
    const creations = this.ctx.getCreations();
    let localRig = creations.find((r) => r.networkId === packet.vehicleId);

    // STRICT AUTHORITY CHECK:
    // Never overwrite a vehicle owned/driven by the local player
    if (localRig && this.hasLocalPhysicsAuthority(localRig)) {
      return;
    }
    if (localRig) {
      const senderIsOwner = packet.peerId === localRig.ownerPeerId;
      const senderIsDriver =
        packet.peerId === packet.driverPeerId ||
        packet.peerId === localRig.getPrimarySeatOccupant();
      if (!senderIsOwner && !senderIsDriver) {
        return;
      }
    }

    if (!localRig && this.status === 'connected') {
      localRig = this.ctx.spawnRemoteVehicleRig({
        type: 'SPAWN_VEHICLE',
        vehicleId: packet.vehicleId,
        ownerPeerId: packet.ownerPeerId || packet.peerId,
        driverPeerId: packet.driverPeerId,
        parts: [],
        blueprint: {
          id: packet.vehicleId,
          name: 'Remote Rig',
          createdAt: new Date().toLocaleTimeString(),
          massKg: 800,
          blockCount: 40,
          powerCores: 4,
          voxels: [],
          modules: [],
        },
        spawnPos: packet.pos,
        spawnQuat: packet.quat,
      });
      this.relocateOverlappingLocalVehicles();
      this.requestMissingBlueprint(packet.vehicleId);
    } else if (
      localRig &&
      (localRig.rootGroup?.userData?.isPlaceholderBlueprint ||
        (getRigVoxelCount(localRig) === 0 && localRig.modules.length === 0))
    ) {
      this.requestMissingBlueprint(packet.vehicleId);
    }

    this.upsertVehicleInterpTarget(
      packet.vehicleId,
      packet.pos,
      packet.quat,
      packet.linVel,
      packet.angVel,
      packet.wheelAngles || [],
      packet.steerAngle,
      packet.throttle,
      packet.boostActive,
      packet.lightsOn,
      packet.ownerPeerId,
      packet.driverPeerId,
    );

    if (localRig) {
      if (packet.driverPeerId !== this.localPeerId) {
        localRig.claimSeat(0, packet.driverPeerId);
      }
      localRig.isRemoteControlled = !this.hasLocalPhysicsAuthority(localRig);
    }
  }

  private upsertVehicleInterpTarget(
    vehicleId: string,
    pos: [number, number, number],
    quat: [number, number, number, number],
    linVel: [number, number, number],
    angVel: [number, number, number],
    wheelAngles: number[],
    steerAngle: number,
    throttle: number,
    boostActive: boolean,
    lightsOn: boolean,
    ownerPeerId: string | null,
    driverPeerId: string | null,
  ): void {
    let vt = this.vehicleInterpTargets.get(vehicleId);
    if (!vt) {
      vt = {
        vehicleId,
        targetPos: new THREE.Vector3(pos[0], pos[1], pos[2]),
        targetQuat: new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]),
        linVel: new THREE.Vector3(linVel[0], linVel[1], linVel[2]),
        angVel: new THREE.Vector3(angVel[0], angVel[1], angVel[2]),
        wheelAngles,
        steerAngle,
        throttle,
        boostActive,
        lightsOn,
        ownerPeerId,
        driverPeerId,
        lastUpdatedMs: performance.now(),
      };
      this.vehicleInterpTargets.set(vehicleId, vt);
    } else {
      vt.targetPos.set(pos[0], pos[1], pos[2]);
      vt.targetQuat.set(quat[0], quat[1], quat[2], quat[3]);
      vt.linVel.set(linVel[0], linVel[1], linVel[2]);
      vt.angVel.set(angVel[0], angVel[1], angVel[2]);
      vt.wheelAngles = wheelAngles;
      vt.steerAngle = steerAngle;
      vt.throttle = throttle;
      vt.boostActive = boostActive;
      vt.lightsOn = lightsOn;
      vt.ownerPeerId = ownerPeerId ?? vt.ownerPeerId;
      vt.driverPeerId = driverPeerId ?? null;
      vt.lastUpdatedMs = performance.now();
    }
  }

  private applySpawnVehiclePacket(packet: SpawnVehiclePacket): void {
    const creations = this.ctx.getCreations();
    let rig = creations.find((r) => r.networkId === packet.vehicleId);

    // Never allow a remote SPAWN_VEHICLE packet to overwrite a vehicle owned by us
    if (
      packet.ownerPeerId === this.localPeerId ||
      (rig && this.hasLocalPhysicsAuthority(rig))
    ) {
      return;
    }

    const bp = reconstructBlueprintFromParts(
      packet.vehicleId,
      packet.parts,
      packet.blueprint,
    );

    const hasRealGeometry =
      (bp.voxels && bp.voxels.length > 0) ||
      (bp.modules && bp.modules.length > 0);
    const bpSig = computeBlueprintSignature(bp);
    let didSpawnOrUpdateTransform = false;

    if (!rig) {
      rig = this.ctx.spawnRemoteVehicleRig({
        ...packet,
        blueprint: bp,
      });
      if (rig.rootGroup?.userData && hasRealGeometry) {
        rig.rootGroup.userData.lastBlueprintSig = bpSig;
      }
      didSpawnOrUpdateTransform = true;
    } else if (hasRealGeometry) {
      const wasPlaceholder = Boolean(
        rig.rootGroup?.userData?.isPlaceholderBlueprint,
      );
      const prevSig = rig.rootGroup?.userData?.lastBlueprintSig;
      if (wasPlaceholder || prevSig !== bpSig) {
        rig.importBlueprint(bp);
        if (rig.rootGroup?.userData) {
          rig.rootGroup.userData.isPlaceholderBlueprint = false;
          rig.rootGroup.userData.lastBlueprintSig = bpSig;
        }
        if (wasPlaceholder) {
          rig.position.set(
            packet.spawnPos[0],
            packet.spawnPos[1],
            packet.spawnPos[2],
          );
          rig.quaternion.set(
            packet.spawnQuat[0],
            packet.spawnQuat[1],
            packet.spawnQuat[2],
            packet.spawnQuat[3],
          );
          didSpawnOrUpdateTransform = true;
        }
        rig.ownerPeerId = packet.ownerPeerId;
        rig.syncVisualTransform();
      }
    }

    if (hasRealGeometry) {
      this.requestedBlueprintTime.delete(packet.vehicleId);
      const pendingTimer = this.missingBlueprintTimeouts.get(packet.vehicleId);
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        this.missingBlueprintTimeouts.delete(packet.vehicleId);
      }
    }

    // Lock the creator's seat so local player never auto-mounts a remote vehicle on spawn
    if (packet.seatClaims && packet.seatClaims.length > 0) {
      for (const sc of packet.seatClaims) {
        rig.claimSeat(sc.seatIndex, sc.peerId);
      }
    } else {
      rig.claimSeat(0, packet.driverPeerId ?? packet.ownerPeerId);
    }
    rig.isRemoteControlled = !this.hasLocalPhysicsAuthority(rig);

    if (
      didSpawnOrUpdateTransform ||
      !this.vehicleInterpTargets.has(packet.vehicleId)
    ) {
      this.upsertVehicleInterpTarget(
        packet.vehicleId,
        packet.spawnPos,
        packet.spawnQuat,
        [0, 0, 0],
        [0, 0, 0],
        [],
        0,
        0,
        false,
        rig.headlightsOn,
        packet.ownerPeerId,
        rig.getPrimarySeatOccupant() ?? packet.driverPeerId,
      );
      this.relocateOverlappingLocalVehicles();
    }
  }

  private applySeatClaimPacket(packet: VehicleSeatClaimPacket): void {
    const creations = this.ctx.getCreations();
    const rig = creations.find((r) => r.networkId === packet.vehicleId);
    if (!rig) return;

    const seats = rig.getSeatModules();
    const targetSeat = seats[packet.seatIndex];
    // Prevent a remote peer from hijacking a seat already occupied by another player
    if (
      packet.peerId !== null &&
      targetSeat &&
      targetSeat.seatedPlayerId !== null &&
      targetSeat.seatedPlayerId !== undefined &&
      targetSeat.seatedPlayerId !== packet.peerId &&
      targetSeat.seatedPlayerId === this.localPeerId
    ) {
      return;
    }

    rig.claimSeat(packet.seatIndex, packet.peerId);
    rig.isRemoteControlled = !this.hasLocalPhysicsAuthority(rig);
    const vt = this.vehicleInterpTargets.get(rig.networkId);
    if (vt && packet.seatIndex === 0) {
      vt.driverPeerId = packet.peerId;
    }
    this.emitUIState();
  }

  private applyClaimVehiclePacket(packet: ClaimVehiclePacket): void {
    this.applySeatClaimPacket({
      type: 'VEHICLE_SEAT_CLAIM',
      event: 'SEAT_OCCUPIED_EVENT',
      vehicleId: packet.vehicleId,
      seatIndex: packet.seatIndex ?? 0,
      peerId: packet.driverPeerId,
    });
  }

  private applyVoxelEditPacket(packet: VoxelEditPacket): void {
    this.isApplyingRemoteEdit = true;
    try {
      const [wx, wy, wz] = packet.worldPos;
      if (packet.op === 'explosion') {
        this.ctx.fx.carveWorldCrater(
          wx,
          wy,
          wz,
          Math.max(1, Math.round(packet.radius)),
          0,
          true,
        );
      } else if (packet.op === 'stamp') {
        const { vx: cvx, vy: cvy, vz: cvz } =
          this.ctx.world.worldToVoxelCoords(wx, wy, wz);
        const rad = Math.max(0, Math.round(packet.radius));
        const r = packet.customRGB?.[0];
        const g = packet.customRGB?.[1];
        const b = packet.customRGB?.[2];
        if (rad <= 0) {
          this.ctx.world.setVoxel(cvx, cvy, cvz, packet.matType, r, g, b);
          const c = this.ctx.world.chunkMap.get(`${cvx >> 6},${cvz >> 6}`);
          if (c) this.ctx.world.rebuildChunkSync(c);
        } else {
          const rSq = rad * rad;
          const touchedChunks = new Set<ReturnType<typeof this.ctx.world.getOrCreateChunk>>();
          for (let dy = -rad; dy <= rad; dy++) {
            for (let dz = -rad; dz <= rad; dz++) {
              for (let dx = -rad; dx <= rad; dx++) {
                if (dx * dx + dy * dy + dz * dz > rSq) continue;
                if (cvy + dy <= 1) continue;
                const tx = cvx + dx;
                const ty = cvy + dy;
                const tz = cvz + dz;
                this.ctx.world.setVoxel(tx, ty, tz, packet.matType, r, g, b);
                const c = this.ctx.world.chunkMap.get(`${tx >> 6},${tz >> 6}`);
                if (c) touchedChunks.add(c);
              }
            }
          }
          if (rad <= 2) {
            touchedChunks.forEach((c) => this.ctx.world.rebuildChunkSync(c));
          }
        }
      } else if (packet.op === 'terraform') {
        this.ctx.world.applyTerraformBrush(
          wx,
          wy,
          wz,
          packet.radius,
          packet.toolKind || 'TERRA_RAISE',
          packet.matType,
        );
      } else if (packet.op === 'ramp' && packet.rampStartPos) {
        this.ctx.world.buildTerrainRamp(
          packet.rampStartPos[0],
          packet.rampStartPos[1],
          packet.rampStartPos[2],
          wx,
          wy,
          wz,
          Math.max(4, packet.radius),
          packet.matType,
        );
      } else if (packet.op === 'prefab' && packet.prefabData) {
        const pd = packet.prefabData;
        this.ctx.world.stampObjectPrefab(
          pd.prefab,
          pd.vx,
          pd.vy,
          pd.vz,
          pd.yawIdx,
          pd.pitchIdx,
          pd.rollIdx,
        );
      }
    } finally {
      this.isApplyingRemoteEdit = false;
    }
  }

  private applyWorldMapSyncPacket(packet: WorldMapSyncPacket): void {
    this.activeMapName = packet.mapLabel;
    if (packet.mode === 'CUSTOM_GLB_MAP' && packet.glbMeta) {
      this.incomingGlbBuffers.set(packet.mapId, {
        mapId: packet.mapId,
        mapLabel: packet.mapLabel,
        sizeX: packet.glbMeta.sizeX,
        sizeY: packet.glbMeta.sizeY,
        sizeZ: packet.glbMeta.sizeZ,
        scaleFactor: packet.glbMeta.scaleFactor,
        totalChunks: packet.glbMeta.totalChunks,
        receivedChunks: new Map(),
      });
      this.ctx.onStatusToast?.(
        `Receiving custom 3D map "${packet.mapLabel}" (0/${packet.glbMeta.totalChunks} chunks)...`,
      );
      return;
    }

    this.isApplyingRemoteEdit = true;
    try {
      const hm = packet.heightmap
        ? {
            width: packet.heightmap.width,
            height: packet.heightmap.height,
            heights: new Uint8Array(packet.heightmap.heights),
            scaleY: packet.heightmap.scaleY,
          }
        : null;
      this.ctx.world.regenerateWorld(packet.mode, packet.flatMat, hm);
      const activeRig = this.ctx.getActiveVehicle();
      if (activeRig) {
        activeRig.summonTo(0, -2.0, 0);
        this.relocateOverlappingLocalVehicles();
      }
      this.ctx.onRemoteMapSynced?.(packet.mapLabel);
      this.ctx.onStatusToast?.(
        `Lobby map updated to "${packet.mapLabel}"!`,
      );
    } finally {
      this.isApplyingRemoteEdit = false;
    }
  }

  private applyWorldMapGlbChunkPacket(packet: WorldMapGlbChunkPacket): void {
    const buf = this.incomingGlbBuffers.get(packet.mapId);
    if (!buf) return;
    buf.receivedChunks.set(packet.chunkIndex, packet.voxels);

    if (buf.receivedChunks.size < buf.totalChunks) {
      this.ctx.onStatusToast?.(
        `Syncing 3D GLB Map "${buf.mapLabel}" (${buf.receivedChunks.size}/${buf.totalChunks} chunks)...`,
      );
      return;
    }

    // All chunks received! Reassemble full voxel array in chunk order and load into MicroVoxelWorld
    const fullVoxels: Array<
      [number, number, number, number, number?, number?, number?]
    > = [];
    for (let i = 0; i < buf.totalChunks; i++) {
      const slice = buf.receivedChunks.get(i);
      if (slice) {
        for (let j = 0; j < slice.length; j++) {
          fullVoxels.push(slice[j]);
        }
      }
    }
    this.incomingGlbBuffers.delete(packet.mapId);

    this.isApplyingRemoteEdit = true;
    try {
      this.ctx.world.loadGlbMapAsWorld(
        fullVoxels,
        buf.sizeX,
        buf.sizeY,
        buf.sizeZ,
        buf.scaleFactor,
      );
      const bestSpawn = this.ctx.world.findBestGlbSpawnPosition();
      const activeRig = this.ctx.getActiveVehicle();
      if (activeRig) {
        activeRig.position.set(bestSpawn.x, bestSpawn.y, bestSpawn.z);
        activeRig.velocity.set(0, 0, 0);
        activeRig.angularVelocity.set(0, 0, 0);
        activeRig.quaternion.identity();
        activeRig.syncVisualTransform();
        this.relocateOverlappingLocalVehicles();
      }
      this.ctx.onRemoteMapSynced?.(buf.mapLabel);
      this.ctx.onStatusToast?.(
        `Synced Custom 3D .GLB Map "${buf.mapLabel}" (${fullVoxels.length.toLocaleString()} voxels)!`,
      );
    } finally {
      this.isApplyingRemoteEdit = false;
    }
  }

  private createRemotePeerEntity(
    packet: StateSyncPacket,
  ): RemotePeerRenderEntity {
    const avatarGroup = createVoxelCharacterAvatar(packet.color || '#38bdf8');
    avatarGroup.position.set(
      packet.playerPos[0],
      packet.playerPos[1],
      packet.playerPos[2],
    );
    this.ctx.scene.add(avatarGroup);

    // Dedicated holographic bottom grid that illuminates when this remote peer enters Build Mode!
    const buildGridGroup = createHolographicBuildGrid();
    this.ctx.scene.add(buildGridGroup);

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 72;
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(3.6, 0.82, 1);
    sprite.renderOrder = 999;
    this.ctx.scene.add(sprite);

    const entity: RemotePeerRenderEntity = {
      peerId: packet.peerId,
      name: packet.name || 'Remote Pilot',
      color: packet.color || '#38bdf8',
      mode: packet.mode,
      isBuildMode: Boolean(packet.isBuildMode),
      activeVehicleId: packet.activeVehicleId,
      pingMs: 18,
      lastSeenMs: performance.now(),
      currentPos: new THREE.Vector3(
        packet.playerPos[0],
        packet.playerPos[1],
        packet.playerPos[2],
      ),
      currentQuat: new THREE.Quaternion(
        packet.playerQuat[0],
        packet.playerQuat[1],
        packet.playerQuat[2],
        packet.playerQuat[3],
      ),
      targetPos: new THREE.Vector3(
        packet.playerPos[0],
        packet.playerPos[1],
        packet.playerPos[2],
      ),
      targetQuat: new THREE.Quaternion(
        packet.playerQuat[0],
        packet.playerQuat[1],
        packet.playerQuat[2],
        packet.playerQuat[3],
      ),
      lookPitch: packet.lookPitch ?? 0,
      walkSpeed: packet.walkSpeed ?? 0,
      isAirborne: packet.isAirborne ?? false,
      equippedTool:
        packet.equippedTool ?? (packet.isBuildMode ? 'WRENCH' : 'NONE'),
      steerAngle: packet.steerAngle ?? 0,
      avatarGroup,
      buildGridGroup,
      nameplateSprite: sprite,
      nameplateCanvas: canvas,
      nameplateTexture: texture,
      lastRenderedLabel: '',
      walkCyclePhase: 0,
    };

    this.drawNameplateCanvas(entity, 0);
    return entity;
  }

  private drawNameplateCanvas(
    entity: RemotePeerRenderEntity,
    distMeters: number,
  ): void {
    const modeTag = entity.isBuildMode
      ? 'BUILDING 🛠️'
      : entity.mode === 'drive'
        ? 'DRIVING'
        : 'ON FOOT';
    const labelKey = `${entity.name}|${entity.color}|${modeTag}|${distMeters}|${entity.isBuildMode}`;
    if (entity.lastRenderedLabel === labelKey) return;
    entity.lastRenderedLabel = labelKey;

    const ctx2d = entity.nameplateCanvas.getContext('2d');
    if (!ctx2d) return;

    const w = entity.nameplateCanvas.width;
    const h = entity.nameplateCanvas.height;
    ctx2d.clearRect(0, 0, w, h);

    // Sleek dark-glass nameplate background (illuminated gold in build mode!)
    ctx2d.fillStyle = entity.isBuildMode
      ? 'rgba(26, 20, 8, 0.92)'
      : 'rgba(9, 13, 22, 0.85)';
    ctx2d.strokeStyle = entity.isBuildMode
      ? '#facc15'
      : entity.color || '#38bdf8';
    ctx2d.lineWidth = entity.isBuildMode ? 4 : 3;
    ctx2d.beginPath();
    ctx2d.roundRect(6, 6, w - 12, h - 12, 10);
    ctx2d.fill();
    ctx2d.stroke();

    // Color badge dot
    ctx2d.fillStyle = entity.isBuildMode
      ? '#facc15'
      : entity.color || '#38bdf8';
    ctx2d.beginPath();
    ctx2d.arc(28, h / 2, 8, 0, Math.PI * 2);
    ctx2d.fill();

    // Username & distance text
    ctx2d.font = 'bold 22px Inter, system-ui, sans-serif';
    ctx2d.fillStyle = '#f8fafc';
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'middle';
    const displayText = `${entity.name.slice(0, 12)} · ${distMeters}m`;
    ctx2d.fillText(displayText, 46, h / 2 - 6);

    ctx2d.font = 'bold 12px JetBrains Mono, monospace';
    ctx2d.fillStyle = entity.isBuildMode ? '#facc15' : '#94a3b8';
    ctx2d.fillText(modeTag, 46, h / 2 + 15);

    entity.nameplateTexture.needsUpdate = true;
  }

  /**
   * Called every render frame (60fps) to smoothly interpolate (`lerp` & `slerp`) with predictive
   * velocity dead-reckoning for remote player avatars, remote vehicle rigid bodies, wheel spin angles,
   * and 3D billboarding nameplates.
   */
  public updateInterpolation(
    dt: number,
    localCameraPos: THREE.Vector3,
  ): void {
    if (this.status === 'disconnected') return;

    try {
      const creations = this.ctx.getCreations();
      const nowMs = performance.now();

      // 1. Interpolate remote vehicles with predictive velocity & angular-velocity dead reckoning
      this.vehicleInterpTargets.forEach((vt) => {
        const rig = creations.find((r) => r.networkId === vt.vehicleId);
        if (!rig) return;

        // Never override any vehicle for which we hold local physics authority (our owned vehicles or our driven vehicle)
        if (this.hasLocalPhysicsAuthority(rig)) {
          rig.isRemoteControlled = false;
          return;
        }

        rig.isRemoteControlled = true;

        // Predictive velocity dead-reckoning since the last network packet arrived
        const ageSec = Math.max(0, (nowMs - vt.lastUpdatedMs) * 0.001);
        const predPos = computeDeadReckonedTargetPos(
          { x: vt.targetPos.x, y: vt.targetPos.y, z: vt.targetPos.z },
          { x: vt.linVel.x, y: vt.linVel.y, z: vt.linVel.z },
          ageSec,
          0.16,
        );
        _interpPredPos.set(predPos.x, predPos.y, predPos.z);

        // Predictive angular dead-reckoning for smooth turns
        _interpPredQuat.copy(vt.targetQuat);
        const angSpeedSq = vt.angVel.lengthSq();
        if (angSpeedSq > 0.0004 && ageSec > 0) {
          const clampedAge = Math.min(0.12, ageSec);
          const halfAngle = 0.5 * Math.sqrt(angSpeedSq) * clampedAge;
          const sinH = Math.sin(halfAngle) / Math.sqrt(angSpeedSq);
          _interpDeltaQuat.set(
            vt.angVel.x * sinH,
            vt.angVel.y * sinH,
            vt.angVel.z * sinH,
            Math.cos(halfAngle),
          );
          _interpPredQuat.premultiply(_interpDeltaQuat).normalize();
        }

        interpolateRemoteTransform(
          rig.position,
          rig.quaternion,
          _interpPredPos,
          _interpPredQuat,
          dt,
          18.0,
        );
        rig.velocity.copy(vt.linVel);
        rig.angularVelocity.copy(vt.angVel);
        rig.applyRemoteSyncState(
          vt.steerAngle,
          vt.wheelAngles,
          vt.boostActive,
          vt.lightsOn,
        );
        rig.syncVisualTransform();
      });

      // 2. Interpolate remote player avatars & update billboarding 3D nameplates
      this.remotePeers.forEach((entity) => {
        interpolateRemoteTransform(
          entity.currentPos,
          entity.currentQuat,
          entity.targetPos,
          entity.targetQuat,
          dt,
          16.0,
        );

        let nameplateWorldAnchor = entity.currentPos;
        const isDriving =
          entity.mode === 'drive' && Boolean(entity.activeVehicleId);
        const isBuilding = Boolean(entity.isBuildMode);

        if (isDriving) {
          const drivenRig = creations.find(
            (r) =>
              r.networkId === entity.activeVehicleId ||
              r.vehicleId === entity.activeVehicleId,
          );
          if (drivenRig) {
            // Find the exact seat claimed by this remote peer, or fallback to primary cockpit/seat
            const seats = drivenRig.getSeatModules();
            const claimedSeat =
              seats.find((s) => s.seatedPlayerId === entity.peerId) ||
              seats[0] ||
              drivenRig.modules.find(
                (m) => m.kind.startsWith('SEAT_') || m.kind === 'COCKPIT',
              );
            const seatWorldPos = claimedSeat
              ? drivenRig.localVoxelToWorld(
                  claimedSeat.vx,
                  claimedSeat.vy + 0.35,
                  claimedSeat.vz,
                )
              : _seatOffsetTmp
                  .copy(drivenRig.position)
                  .setY(drivenRig.position.y + 0.75);

            entity.avatarGroup.visible = true;
            entity.avatarGroup.position.copy(seatWorldPos);
            entity.avatarGroup.quaternion.copy(drivenRig.quaternion);
            nameplateWorldAnchor = seatWorldPos;
          } else {
            // If vehicle hasn't fully spawned on this peer yet, keep avatar visible at vehicle's target position!
            entity.avatarGroup.visible = true;
            entity.avatarGroup.position.copy(entity.currentPos);
            entity.avatarGroup.quaternion.copy(entity.currentQuat);
          }
        } else {
          entity.avatarGroup.visible = true;
          entity.avatarGroup.position.copy(entity.currentPos);
          entity.avatarGroup.quaternion.copy(entity.currentQuat);
        }

        // Procedural skeletal animation (walking, driving with steering wheel tilt, building, idle breathing):
        const moveDelta = entity.currentPos.distanceTo(entity.targetPos);
        const inferredSpeed = moveDelta / Math.max(0.016, dt);
        const effectiveWalkSpeed = Math.max(
          entity.walkSpeed || 0,
          inferredSpeed,
        );
        entity.walkCyclePhase +=
          dt * (isBuilding ? 3.0 : effectiveWalkSpeed > 0.1 ? 8.5 : 2.0);

        let activeSteerAngle = entity.steerAngle || 0;
        if (isDriving && entity.activeVehicleId) {
          const vt = this.vehicleInterpTargets.get(entity.activeVehicleId);
          if (vt) activeSteerAngle = vt.steerAngle;
        }

        const animPose = computeAvatarAnimationPose(
          entity.walkCyclePhase,
          effectiveWalkSpeed,
          isDriving,
          isBuilding,
          !entity.isAirborne,
        );
        applyAvatarPose(entity.avatarGroup, animPose);

        updateCharacterAnimation(
          entity.avatarGroup,
          {
            walkSpeed: isDriving ? 0 : effectiveWalkSpeed,
            isSprinting: effectiveWalkSpeed > 8.5,
            isAirborne: !isDriving && entity.isAirborne,
            isSeated: isDriving,
            steerAngle: activeSteerAngle,
            lookPitch: entity.lookPitch,
            lookYaw: 0,
            isBuildMode: isBuilding,
            equippedTool: isDriving
              ? 'NONE'
              : isBuilding
                ? 'WRENCH'
                : entity.equippedTool,
          },
          dt,
        );

        // Build Mode Holographic Bottom Grid update
        if (isBuilding) {
          entity.buildGridGroup.visible = true;
          const probeAnchor = nameplateWorldAnchor;
          const ground = this.ctx.world.probeGroundBelow(
            probeAnchor.x,
            probeAnchor.y,
            probeAnchor.z,
            2.0,
          );
          const gridY = Math.max(WATER_LEVEL, ground.y) + 0.06;
          entity.buildGridGroup.position.set(
            probeAnchor.x,
            gridY,
            probeAnchor.z,
          );
          const scanRing = entity.buildGridGroup.userData?.scanRing as
            | THREE.Mesh
            | undefined;
          if (scanRing) {
            scanRing.rotation.y += dt * 1.8;
          }
        } else {
          entity.buildGridGroup.visible = false;
        }

        const distMeters = Math.round(
          localCameraPos.distanceTo(nameplateWorldAnchor),
        );
        this.drawNameplateCanvas(entity, distMeters);

        entity.nameplateSprite.position.set(
          nameplateWorldAnchor.x,
          nameplateWorldAnchor.y + (entity.mode === 'drive' ? 2.85 : 2.35),
          nameplateWorldAnchor.z,
        );
      });
    } catch (err) {
      console.warn('[Multiplayer] Error in updateInterpolation:', err);
    }
  }

  private removeRemotePeer(peerId: string): void {
    const entity = this.remotePeers.get(peerId);
    if (entity) {
      const disposeGroupResources = (root: THREE.Object3D) => {
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry && !mesh.geometry.userData?.isSharedPrimitive) {
            mesh.geometry.dispose();
          }
          const mat = mesh.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => m?.dispose?.());
          } else if (mat && typeof (mat as THREE.Material).dispose === 'function') {
            (mat as THREE.Material).dispose();
          }
        });
      };
      this.ctx.scene.remove(entity.avatarGroup);
      this.ctx.scene.remove(entity.buildGridGroup);
      this.ctx.scene.remove(entity.nameplateSprite);
      disposeGroupResources(entity.avatarGroup);
      disposeGroupResources(entity.buildGridGroup);
      entity.nameplateTexture.dispose();
      (entity.nameplateSprite.material as THREE.Material).dispose();
      this.remotePeers.delete(peerId);
    }

    // Release any vehicle seats that this peer was occupying
    const creations = this.ctx.getCreations();
    for (const rig of creations) {
      rig.releasePlayerSeats(peerId);
      rig.isRemoteControlled = !this.hasLocalPhysicsAuthority(rig);
    }
  }

  public disconnect(): void {
    if (this.wsReconnectTimer !== null) {
      window.clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.connectTimeoutId !== null) {
      window.clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
    if (this.fallbackTimerId !== null) {
      window.clearTimeout(this.fallbackTimerId);
      this.fallbackTimerId = null;
    }
    if (this.bcAnnounceTimerId !== null) {
      window.clearTimeout(this.bcAnnounceTimerId);
      this.bcAnnounceTimerId = null;
    }

    if (this.status !== 'disconnected') {
      const leavePacket: PeerLeavePacket = {
        type: 'PEER_LEAVE',
        peerId: this.localPeerId,
      };
      this.sendToAll(leavePacket);
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'WS_ROOM_LEAVE',
              roomCode: this.roomCode,
              peerId: this.localPeerId,
            }),
          );
        }
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    this.stopSyncTimers();

    this.connections.forEach((conn) => {
      try {
        conn.close();
      } catch {
        // Ignore
      }
    });
    this.connections.clear();

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {
        // Ignore
      }
      this.broadcastChannel = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // Ignore
      }
      this.peer = null;
    }

    const peerIds = Array.from(this.remotePeers.keys());
    for (const pid of peerIds) {
      this.removeRemotePeer(pid);
    }
    this.vehicleInterpTargets.clear();
    this.requestedBlueprintTime.clear();

    // Clear remote control flags on local vehicles
    for (const rig of this.ctx.getCreations()) {
      rig.isRemoteControlled = false;
      if (rig.driverPeerId !== this.localPeerId) {
        rig.driverPeerId = null;
      }
    }

    this.status = 'disconnected';
    this.role = 'none';
    this.roomCode = '';
    this.errorMessage = null;
    this.emitUIState();
  }
}
