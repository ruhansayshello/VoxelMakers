import * as THREE from 'three';
import type { ArticulatedCharacterRig } from './playerModel.ts';

/**
 * Lightweight on-demand 11-node Verlet ragdoll for the 1px micro-voxel player.
 * - Zero CPU cost when inactive (`active === false`).
 * - Activates on explosions, high-speed vehicle bailouts, hard falls, hazard flings, or manual [G] toggle.
 * - Collides each joint directly against coarse 4px world voxel queries (and optional vehicles).
 * - Auto-sleeps and recovers smoothly into normal standing control, and cancels cleanly for Build Mode.
 */

export const RAGDOLL_NODE = {
  PELVIS: 0,
  CHEST: 1,
  HEAD: 2,
  ELBOW_L: 3,
  HAND_L: 4,
  ELBOW_R: 5,
  HAND_R: 6,
  KNEE_L: 7,
  FOOT_L: 8,
  KNEE_R: 9,
  FOOT_R: 10,
} as const;

export const RAGDOLL_NODE_COUNT = 11;

export interface RagdollConstraint {
  a: number;
  b: number;
  restLen: number;
  /** Minimum distance (if > 0, acts as soft angular/anti-collapse brace rather than rigid bone). */
  minOnly?: boolean;
  stiffness: number;
}

export interface PlayerRagdollState {
  active: boolean;
  /** True while smoothly blending from ragdoll ground pose -> push-up crouch -> standing upright */
  isGettingUp: boolean;
  /** Seconds elapsed in the getting-up stand animation */
  getUpElapsed: number;
  /** Total duration of getting-up animation in seconds (default 0.55s) */
  getUpDuration: number;
  /** Captured starting world pelvis position [x, y, z] at the moment stand-up begins */
  getUpStartPelvis: Float32Array;
  /** Target world foot position [x, y, z] where pilot finishes standing */
  getUpTargetFoot: Float32Array;
  /** Target upright character yaw in radians */
  getUpTargetYaw: number;
  /** Captured start quaternions for 10 rig joints (pelvis, head, L/R arms, L/R forearms, L/R legs, L/R knees) */
  getUpStartQuats: Float32Array;
  /** Seconds elapsed since ragdoll activation */
  elapsed: number;
  /** Seconds the ragdoll has stayed below sleep speed */
  settledTime: number;
  /** True once ragdoll settled and is ready to auto-stand up */
  readyToRecover: boolean;
  /** Current world-space joint positions (x, y, z) x 11 */
  pos: Float32Array;
  /** Previous Verlet world-space joint positions (x, y, z) x 11 */
  prevPos: Float32Array;
  /** Per-node collision sphere radius in meters */
  radii: Float32Array;
  /** Structural bone & anti-collapse constraints */
  constraints: RagdollConstraint[];
  /** Stored initial yaw so torso forward vector stays coherent while tumbling */
  refYaw: number;
}

export interface RagdollGetUpStepResult {
  isGettingUp: boolean;
  completed: boolean;
  progress: number;
  pelvisX: number;
  pelvisY: number;
  pelvisZ: number;
}

export interface RagdollWorldCollision {
  /** Returns top solid ground Y at (wx, wz) searching down from startY */
  sampleGroundY: (wx: number, startY: number, wz: number) => number;
  /** Optional solid voxel check for horizontal wall bounce */
  isSolid?: (wx: number, wy: number, wz: number) => boolean;
}

export interface RagdollStepResult {
  active: boolean;
  pelvisX: number;
  pelvisY: number;
  pelvisZ: number;
  speedMPS: number;
  readyToRecover: boolean;
}

// Rest offsets in character-local space (meters relative to feet at y = 0, facing +Z)
const LOCAL_REST_OFFSETS: ReadonlyArray<[number, number, number]> = [
  [0, 0.72, 0],       // 0 PELVIS
  [0, 1.18, 0],       // 1 CHEST (shoulder line)
  [0, 1.48, 0],       // 2 HEAD (seated flush on neck collar)
  [-0.36, 0.94, 0.04], // 3 ELBOW_L
  [-0.4, 0.68, 0.1],  // 4 HAND_L
  [0.36, 0.94, 0.04], // 5 ELBOW_R
  [0.4, 0.68, 0.1],   // 6 HAND_R
  [-0.14, 0.36, 0.03], // 7 KNEE_L
  [-0.14, 0.06, 0.04], // 8 FOOT_L
  [0.14, 0.36, 0.03], // 9 KNEE_R
  [0.14, 0.06, 0.04], // 10 FOOT_R
];

const NODE_RADII: ReadonlyArray<number> = [
  0.18, // PELVIS
  0.2,  // CHEST
  0.18, // HEAD
  0.09, // ELBOW_L
  0.08, // HAND_L
  0.09, // ELBOW_R
  0.08, // HAND_R
  0.1,  // KNEE_L
  0.1,  // FOOT_L
  0.1,  // KNEE_R
  0.1,  // FOOT_R
];

function restDist(a: number, b: number): number {
  const pa = LOCAL_REST_OFFSETS[a];
  const pb = LOCAL_REST_OFFSETS[b];
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
}

function buildDefaultConstraints(): RagdollConstraint[] {
  const N = RAGDOLL_NODE;
  return [
    // Primary rigid skeleton bones
    { a: N.PELVIS, b: N.CHEST, restLen: restDist(N.PELVIS, N.CHEST), stiffness: 1.0 },
    { a: N.CHEST, b: N.HEAD, restLen: restDist(N.CHEST, N.HEAD), stiffness: 1.0 },
    { a: N.CHEST, b: N.ELBOW_L, restLen: restDist(N.CHEST, N.ELBOW_L), stiffness: 0.95 },
    { a: N.ELBOW_L, b: N.HAND_L, restLen: restDist(N.ELBOW_L, N.HAND_L), stiffness: 0.95 },
    { a: N.CHEST, b: N.ELBOW_R, restLen: restDist(N.CHEST, N.ELBOW_R), stiffness: 0.95 },
    { a: N.ELBOW_R, b: N.HAND_R, restLen: restDist(N.ELBOW_R, N.HAND_R), stiffness: 0.95 },
    { a: N.PELVIS, b: N.KNEE_L, restLen: restDist(N.PELVIS, N.KNEE_L), stiffness: 0.98 },
    { a: N.KNEE_L, b: N.FOOT_L, restLen: restDist(N.KNEE_L, N.FOOT_L), stiffness: 0.98 },
    { a: N.PELVIS, b: N.KNEE_R, restLen: restDist(N.PELVIS, N.KNEE_R), stiffness: 0.98 },
    { a: N.KNEE_R, b: N.FOOT_R, restLen: restDist(N.KNEE_R, N.FOOT_R), stiffness: 0.98 },
    // Anti-collapse structural braces (prevent head/limbs folding inside torso)
    { a: N.PELVIS, b: N.HEAD, restLen: restDist(N.PELVIS, N.HEAD) * 0.88, minOnly: true, stiffness: 0.7 },
    { a: N.ELBOW_L, b: N.ELBOW_R, restLen: 0.44, minOnly: true, stiffness: 0.55 },
    { a: N.KNEE_L, b: N.KNEE_R, restLen: 0.2, minOnly: true, stiffness: 0.45 },
    { a: N.CHEST, b: N.KNEE_L, restLen: 0.52, minOnly: true, stiffness: 0.45 },
    { a: N.CHEST, b: N.KNEE_R, restLen: 0.52, minOnly: true, stiffness: 0.45 },
  ];
}

export function createPlayerRagdollState(): PlayerRagdollState {
  const startQuats = new Float32Array(10 * 4);
  for (let i = 0; i < 10; i++) {
    startQuats[i * 4 + 3] = 1;
  }
  return {
    active: false,
    isGettingUp: false,
    getUpElapsed: 0,
    getUpDuration: 0.55,
    getUpStartPelvis: new Float32Array(3),
    getUpTargetFoot: new Float32Array(3),
    getUpTargetYaw: 0,
    getUpStartQuats: startQuats,
    elapsed: 0,
    settledTime: 0,
    readyToRecover: false,
    pos: new Float32Array(RAGDOLL_NODE_COUNT * 3),
    prevPos: new Float32Array(RAGDOLL_NODE_COUNT * 3),
    radii: Float32Array.from(NODE_RADII),
    constraints: buildDefaultConstraints(),
    refYaw: 0,
  };
}

/**
 * Activates the player ragdoll from the character's foot position, facing yaw, and launch impulse.
 * Adds subtle differential spin across head, torso, and limbs so the body tumbles naturally.
 */
export function activatePlayerRagdoll(
  state: PlayerRagdollState,
  footX: number,
  footY: number,
  footZ: number,
  charYaw: number,
  velX: number,
  velY: number,
  velZ: number,
  spinStrength = 1.6,
  dtHint = 1 / 60,
): void {
  const sinY = Math.sin(charYaw);
  const cosY = Math.cos(charYaw);
  const safeDt = Math.max(0.005, Math.min(0.033, dtHint));

  state.active = true;
  state.isGettingUp = false;
  state.getUpElapsed = 0;
  state.elapsed = 0;
  state.settledTime = 0;
  state.readyToRecover = false;
  state.refYaw = charYaw;

  // Deterministic slight angular tumble derived from velocity direction
  const speedHoriz = Math.hypot(velX, velZ);
  const tumbleDirX = speedHoriz > 0.2 ? velX / speedHoriz : sinY;
  const tumbleDirZ = speedHoriz > 0.2 ? velZ / speedHoriz : cosY;

  for (let i = 0; i < RAGDOLL_NODE_COUNT; i++) {
    const off = LOCAL_REST_OFFSETS[i];
    const lx = off[0];
    const ly = off[1];
    const lz = off[2];
    const wx = footX + lx * cosY + lz * sinY;
    const wy = footY + ly;
    const wz = footZ - lx * sinY + lz * cosY;

    // Upper body pitches forward/away slightly faster than feet for organic tumble
    const heightBias = (ly - 0.72) * spinStrength;
    const sideTwist = lx * spinStrength * 0.75;
    const nvx = velX + tumbleDirX * heightBias - tumbleDirZ * sideTwist;
    const nvy = velY + (i === RAGDOLL_NODE.HEAD ? 0.55 : i >= RAGDOLL_NODE.KNEE_L ? -0.35 : 0.15) * Math.min(2.0, spinStrength);
    const nvz = velZ + tumbleDirZ * heightBias + tumbleDirX * sideTwist;

    const base = i * 3;
    state.pos[base] = wx;
    state.pos[base + 1] = wy;
    state.pos[base + 2] = wz;

    state.prevPos[base] = wx - nvx * safeDt;
    state.prevPos[base + 1] = wy - nvy * safeDt;
    state.prevPos[base + 2] = wz - nvz * safeDt;
  }
}

export function deactivatePlayerRagdoll(state: PlayerRagdollState): void {
  state.active = false;
  state.isGettingUp = false;
  state.getUpElapsed = 0;
  state.elapsed = 0;
  state.settledTime = 0;
  state.readyToRecover = false;
}

/**
 * Advances the 11-node Verlet ragdoll one physics tick (~0.08–0.12ms/frame).
 * Returns pelvis position and whether the ragdoll has settled and is ready to stand back up.
 */
export function stepPlayerRagdoll(
  state: PlayerRagdollState,
  dt: number,
  collision: RagdollWorldCollision,
  options?: {
    gravity?: number;
    airDamping?: number;
    groundFriction?: number;
    settleDurationSec?: number;
    maxDurationSec?: number;
  },
): RagdollStepResult {
  const pBase = RAGDOLL_NODE.PELVIS * 3;
  if (!state.active) {
    return {
      active: false,
      pelvisX: state.pos[pBase],
      pelvisY: state.pos[pBase + 1],
      pelvisZ: state.pos[pBase + 2],
      speedMPS: 0,
      readyToRecover: false,
    };
  }

  const safeDt = Math.max(0.002, Math.min(0.033, dt));
  const gravity = options?.gravity ?? 21.5;
  const airDamp = options?.airDamping ?? 0.992;
  const groundFriction = options?.groundFriction ?? 0.72;
  const settleDuration = options?.settleDurationSec ?? 1.15;
  const maxDuration = options?.maxDurationSec ?? 3.8;

  state.elapsed += safeDt;

  const pos = state.pos;
  const prev = state.prevPos;
  const radii = state.radii;
  const gravStep = gravity * safeDt * safeDt;

  // 1. Verlet integration
  for (let i = 0; i < RAGDOLL_NODE_COUNT; i++) {
    const b = i * 3;
    const x = pos[b];
    const y = pos[b + 1];
    const z = pos[b + 2];

    // Clamp max per-step displacement for numerical stability against huge blasts
    let vx = (x - prev[b]) * airDamp;
    let vy = (y - prev[b + 1]) * airDamp;
    let vz = (z - prev[b + 2]) * airDamp;
    const maxStep = 36.0 * safeDt;
    const stepMag = Math.hypot(vx, vy, vz);
    if (stepMag > maxStep) {
      const s = maxStep / stepMag;
      vx *= s;
      vy *= s;
      vz *= s;
    }

    prev[b] = x;
    prev[b + 1] = y;
    prev[b + 2] = z;

    pos[b] = x + vx;
    pos[b + 1] = y + vy - gravStep;
    pos[b + 2] = z + vz;
  }

  // 2. Iterative distance & anti-collapse constraint solver + ground/wall collision (5 iterations)
  const constraints = state.constraints;
  const ITERATIONS = 5;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let c = 0; c < constraints.length; c++) {
      const con = constraints[c];
      const ba = con.a * 3;
      const bb = con.b * 3;
      const dx = pos[bb] - pos[ba];
      const dy = pos[bb + 1] - pos[ba + 1];
      const dz = pos[bb + 2] - pos[ba + 2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1e-5) continue;
      if (con.minOnly && dist >= con.restLen) continue;

      const diff = ((dist - con.restLen) / dist) * 0.5 * con.stiffness;
      const cx = dx * diff;
      const cy = dy * diff;
      const cz = dz * diff;

      pos[ba] += cx;
      pos[ba + 1] += cy;
      pos[ba + 2] += cz;
      pos[bb] -= cx;
      pos[bb + 1] -= cy;
      pos[bb + 2] -= cz;
    }

    // Ground & wall collision projection
    for (let i = 0; i < RAGDOLL_NODE_COUNT; i++) {
      const b = i * 3;
      const r = radii[i];
      const wx = pos[b];
      const wy = pos[b + 1];
      const wz = pos[b + 2];

      const groundY = collision.sampleGroundY(wx, wy + 0.6, wz);
      const minY = groundY + r;
      if (wy < minY) {
        pos[b + 1] = minY;
        // Apply tangential ground friction + light bounce only on final iteration
        if (iter === ITERATIONS - 1) {
          const vx = pos[b] - prev[b];
          const vz = pos[b + 2] - prev[b + 2];
          const vy = wy - prev[b + 1];
          prev[b] = pos[b] - vx * groundFriction;
          prev[b + 2] = pos[b + 2] - vz * groundFriction;
          // Mild bounce on hard impacts (> 4 m/s), otherwise rest cleanly
          if (vy < -4.0 * safeDt) {
            prev[b + 1] = pos[b + 1] + vy * 0.22;
          } else {
            prev[b + 1] = pos[b + 1];
          }
        }
      }

      if (collision.isSolid && iter === ITERATIONS - 1) {
        if (collision.isSolid(pos[b], pos[b + 1], pos[b + 2])) {
          // Push back horizontally toward previous non-solid position
          const oldX = prev[b];
          const oldZ = prev[b + 2];
          if (!collision.isSolid(oldX, pos[b + 1], pos[b + 2])) {
            pos[b] = oldX;
            prev[b] = oldX + (pos[b] - oldX) * 0.3;
          } else if (!collision.isSolid(pos[b], pos[b + 1], oldZ)) {
            pos[b + 2] = oldZ;
            prev[b + 2] = oldZ + (pos[b + 2] - oldZ) * 0.3;
          } else {
            pos[b] = oldX;
            pos[b + 2] = oldZ;
          }
        }
      }
    }
  }

  // 3. Measure average speed to detect settling
  let speedSum = 0;
  for (let i = 0; i < RAGDOLL_NODE_COUNT; i++) {
    const b = i * 3;
    speedSum += Math.hypot(
      pos[b] - prev[b],
      pos[b + 1] - prev[b + 1],
      pos[b + 2] - prev[b + 2],
    );
  }
  const avgSpeedMPS = speedSum / (RAGDOLL_NODE_COUNT * safeDt);

  if (state.elapsed > 0.45 && avgSpeedMPS < 0.75) {
    state.settledTime += safeDt;
  } else {
    state.settledTime = Math.max(0, state.settledTime - safeDt * 0.5);
  }

  if (state.settledTime >= settleDuration || state.elapsed >= maxDuration) {
    state.readyToRecover = true;
  }

  return {
    active: state.active,
    pelvisX: pos[pBase],
    pelvisY: pos[pBase + 1],
    pelvisZ: pos[pBase + 2],
    speedMPS: avgSpeedMPS,
    readyToRecover: state.readyToRecover,
  };
}

// Reusable scratch vectors/quaternions (zero per-frame allocations)
const _vPelvis = new THREE.Vector3();
const _vChest = new THREE.Vector3();
const _vHead = new THREE.Vector3();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _vUp = new THREE.Vector3();
const _vRight = new THREE.Vector3();
const _vFwd = new THREE.Vector3();
const _vRefFwd = new THREE.Vector3();
const _mBasis = new THREE.Matrix4();
const _qTorsoWorld = new THREE.Quaternion();
const _qInvTorso = new THREE.Quaternion();
const _qLimbLocal = new THREE.Quaternion();
const _qParentInv = new THREE.Quaternion();
const _vDown = new THREE.Vector3(0, -1, 0);
const _vUpAxis = new THREE.Vector3(0, 1, 0);

function readNode(state: PlayerRagdollState, idx: number, out: THREE.Vector3): THREE.Vector3 {
  const b = idx * 3;
  return out.set(state.pos[b], state.pos[b + 1], state.pos[b + 2]);
}

function orientLimbToDirection(
  pivot: THREE.Group,
  parentWorldQuatInv: THREE.Quaternion,
  worldStart: THREE.Vector3,
  worldEnd: THREE.Vector3,
  localRestAxis: THREE.Vector3,
): THREE.Quaternion {
  _vDir.subVectors(worldEnd, worldStart);
  if (_vDir.lengthSq() < 1e-6) {
    pivot.quaternion.identity();
    return _qLimbLocal.identity();
  }
  _vDir.normalize();
  // Convert target direction into parent's local frame
  _vDir.applyQuaternion(parentWorldQuatInv).normalize();
  _qLimbLocal.setFromUnitVectors(localRestAxis, _vDir);
  pivot.quaternion.copy(_qLimbLocal);
  return _qLimbLocal;
}

/**
 * Maps the simulated 11-node Verlet ragdoll pose cleanly onto `ArticulatedCharacterRig`
 * without altering the rig hierarchy or allocating temporary objects.
 */
export function applyRagdollToRig(
  rigOrGroup: ArticulatedCharacterRig | THREE.Group,
  state: PlayerRagdollState,
): void {
  const rig: ArticulatedCharacterRig | undefined =
    'rootGroup' in rigOrGroup
      ? rigOrGroup
      : (rigOrGroup.userData?.rig as ArticulatedCharacterRig | undefined);
  if (!rig || !state.active) return;

  const N = RAGDOLL_NODE;
  readNode(state, N.PELVIS, _vPelvis);
  readNode(state, N.CHEST, _vChest);
  readNode(state, N.HEAD, _vHead);

  // Place rootGroup directly at pelvis world position with identity rotation;
  // pelvisGroup carries the full 3D ragdoll torso orientation!
  rig.rootGroup.visible = true;
  rig.rootGroup.position.copy(_vPelvis);
  rig.rootGroup.rotation.set(0, 0, 0);
  rig.rootGroup.quaternion.identity();

  rig.pelvisGroup.position.set(0, 0, 0);
  rig.torsoMesh.position.set(0, 0.34, 0);
  rig.torsoMesh.rotation.set(0, 0, 0);
  rig.torsoMesh.quaternion.identity();

  // Construct stable orthonormal basis for torso from Pelvis->Chest (Up) and Left->Right shoulders/knees (Right)
  _vUp.subVectors(_vChest, _vPelvis);
  if (_vUp.lengthSq() < 1e-5) {
    _vUp.set(0, 1, 0);
  } else {
    _vUp.normalize();
  }

  readNode(state, N.ELBOW_L, _vA);
  readNode(state, N.ELBOW_R, _vB);
  _vRight.subVectors(_vB, _vA);
  // Orthogonalize Right against Up
  _vRight.addScaledVector(_vUp, -_vRight.dot(_vUp));
  if (_vRight.lengthSq() < 1e-4) {
    _vRefFwd.set(Math.sin(state.refYaw), 0, Math.cos(state.refYaw));
    _vRight.crossVectors(_vUp, _vRefFwd);
    if (_vRight.lengthSq() < 1e-4) {
      _vRight.set(1, 0, 0);
    }
  }
  _vRight.normalize();
  _vFwd.crossVectors(_vRight, _vUp).normalize();
  _vRight.crossVectors(_vUp, _vFwd).normalize();

  _mBasis.makeBasis(_vRight, _vUp, _vFwd);
  _qTorsoWorld.setFromRotationMatrix(_mBasis);
  rig.pelvisGroup.quaternion.copy(_qTorsoWorld);
  _qInvTorso.copy(_qTorsoWorld).invert();

  // Head orientation (Chest -> Head along local +Y)
  orientLimbToDirection(rig.headGroup, _qInvTorso, _vChest, _vHead, _vUpAxis);

  // Left Arm (Chest -> ElbowL -> HandL along local -Y)
  readNode(state, N.ELBOW_L, _vA);
  readNode(state, N.HAND_L, _vB);
  const qArmL = orientLimbToDirection(rig.leftArmPivot, _qInvTorso, _vChest, _vA, _vDown);
  _qParentInv.copy(_qTorsoWorld).multiply(qArmL).invert();
  orientLimbToDirection(rig.leftForearmPivot, _qParentInv, _vA, _vB, _vDown);

  // Right Arm (Chest -> ElbowR -> HandR along local -Y)
  readNode(state, N.ELBOW_R, _vA);
  readNode(state, N.HAND_R, _vB);
  const qArmR = orientLimbToDirection(rig.rightArmPivot, _qInvTorso, _vChest, _vA, _vDown);
  _qParentInv.copy(_qTorsoWorld).multiply(qArmR).invert();
  orientLimbToDirection(rig.rightForearmPivot, _qParentInv, _vA, _vB, _vDown);

  // Left Leg (Pelvis -> KneeL -> FootL along local -Y)
  rig.leftLegPivot.position.set(-0.13, -0.04, 0);
  readNode(state, N.KNEE_L, _vA);
  readNode(state, N.FOOT_L, _vB);
  const qLegL = orientLimbToDirection(rig.leftLegPivot, _qInvTorso, _vPelvis, _vA, _vDown);
  _qParentInv.copy(_qTorsoWorld).multiply(qLegL).invert();
  orientLimbToDirection(rig.leftKneePivot, _qParentInv, _vA, _vB, _vDown);

  // Right Leg (Pelvis -> KneeR -> FootR along local -Y)
  rig.rightLegPivot.position.set(0.13, -0.04, 0);
  readNode(state, N.KNEE_R, _vA);
  readNode(state, N.FOOT_R, _vB);
  const qLegR = orientLimbToDirection(rig.rightLegPivot, _qInvTorso, _vPelvis, _vA, _vDown);
  _qParentInv.copy(_qTorsoWorld).multiply(qLegR).invert();
  orientLimbToDirection(rig.rightKneePivot, _qParentInv, _vA, _vB, _vDown);

  // Dim jetpack plumes while ragdolling
  rig.nozzleMat.emissiveIntensity = 0.45;
  rig.thrusterPlumeL.scale.set(0.2, 0.12, 0.2);
  rig.thrusterPlumeR.scale.set(0.2, 0.12, 0.2);
}

/**
 * Restores all rig pivot transforms cleanly when exiting ragdoll (e.g. stand-up, entering Build Mode, or entering a vehicle).
 */
export function resetRigFromRagdoll(
  rigOrGroup: ArticulatedCharacterRig | THREE.Group,
): void {
  const rig: ArticulatedCharacterRig | undefined =
    'rootGroup' in rigOrGroup
      ? rigOrGroup
      : (rigOrGroup.userData?.rig as ArticulatedCharacterRig | undefined);
  if (!rig) return;

  rig.pelvisGroup.position.set(0, 0.72, 0);
  rig.pelvisGroup.quaternion.identity();
  rig.pelvisGroup.rotation.set(0, 0, 0);

  rig.torsoMesh.position.set(0, 0.34, 0);
  rig.torsoMesh.quaternion.identity();
  rig.torsoMesh.rotation.set(0, 0, 0);

  rig.headGroup.quaternion.identity();
  rig.headGroup.rotation.set(0, 0, 0);

  rig.leftArmPivot.quaternion.identity();
  rig.leftArmPivot.rotation.set(0, 0, 0);
  rig.rightArmPivot.quaternion.identity();
  rig.rightArmPivot.rotation.set(0, 0, 0);
  rig.leftForearmPivot.quaternion.identity();
  rig.leftForearmPivot.rotation.set(0, 0, 0);
  rig.rightForearmPivot.quaternion.identity();
  rig.rightForearmPivot.rotation.set(0, 0, 0);

  rig.leftLegPivot.position.set(-0.13, -0.04, 0);
  rig.leftLegPivot.quaternion.identity();
  rig.leftLegPivot.rotation.set(0, 0, 0);
  rig.rightLegPivot.position.set(0.13, -0.04, 0);
  rig.rightLegPivot.quaternion.identity();
  rig.rightLegPivot.rotation.set(0, 0, 0);

  rig.leftKneePivot.quaternion.identity();
  rig.leftKneePivot.rotation.set(0, 0, 0);
  rig.rightKneePivot.quaternion.identity();
  rig.rightKneePivot.rotation.set(0, 0, 0);
}

// Reusable scratch quaternions/eulers for zero-allocation getting-up animation
const _qStart = new THREE.Quaternion();
const _qMid = new THREE.Quaternion();
const _qEnd = new THREE.Quaternion();
const _qTargetYaw = new THREE.Quaternion();
const _qTmp = new THREE.Quaternion();
const _eMid = new THREE.Euler();
const _vYAxis = new THREE.Vector3(0, 1, 0);

function writeQuat(buf: Float32Array, idx: number, q: THREE.Quaternion): void {
  const b = idx * 4;
  buf[b] = q.x;
  buf[b + 1] = q.y;
  buf[b + 2] = q.z;
  buf[b + 3] = q.w;
}

function readQuat(buf: Float32Array, idx: number, out: THREE.Quaternion): THREE.Quaternion {
  const b = idx * 4;
  return out.set(buf[b], buf[b + 1], buf[b + 2], buf[b + 3]);
}

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Transitions smoothly out of active Verlet ragdoll into an animated getting-up sequence
 * (lying ground pose -> crouched push-up off hands & knees -> upright standing pose).
 */
export function beginRagdollGetUp(
  state: PlayerRagdollState,
  rigOrGroup: ArticulatedCharacterRig | THREE.Group,
  targetFootX: number,
  targetFootY: number,
  targetFootZ: number,
  targetYaw: number,
  durationSec = 0.55,
): void {
  const rig: ArticulatedCharacterRig | undefined =
    'rootGroup' in rigOrGroup
      ? rigOrGroup
      : (rigOrGroup.userData?.rig as ArticulatedCharacterRig | undefined);

  state.active = false;
  state.readyToRecover = false;
  state.settledTime = 0;
  state.isGettingUp = true;
  state.getUpElapsed = 0;
  state.getUpDuration = Math.max(0.2, durationSec);
  state.getUpTargetFoot[0] = targetFootX;
  state.getUpTargetFoot[1] = targetFootY;
  state.getUpTargetFoot[2] = targetFootZ;
  state.getUpTargetYaw = targetYaw;

  if (rig) {
    // Capture current world pelvis position & all 10 joint quaternions
    state.getUpStartPelvis[0] = rig.rootGroup.position.x + rig.pelvisGroup.position.x;
    state.getUpStartPelvis[1] = rig.rootGroup.position.y + rig.pelvisGroup.position.y;
    state.getUpStartPelvis[2] = rig.rootGroup.position.z + rig.pelvisGroup.position.z;

    const joints: THREE.Object3D[] = [
      rig.pelvisGroup,
      rig.headGroup,
      rig.leftArmPivot,
      rig.rightArmPivot,
      rig.leftForearmPivot,
      rig.rightForearmPivot,
      rig.leftLegPivot,
      rig.rightLegPivot,
      rig.leftKneePivot,
      rig.rightKneePivot,
    ];
    for (let i = 0; i < joints.length; i++) {
      writeQuat(state.getUpStartQuats, i, joints[i].quaternion);
    }
  } else {
    state.getUpStartPelvis[0] = state.pos[0];
    state.getUpStartPelvis[1] = state.pos[1];
    state.getUpStartPelvis[2] = state.pos[2];
    for (let i = 0; i < 10; i++) {
      const b = i * 4;
      state.getUpStartQuats[b] = 0;
      state.getUpStartQuats[b + 1] = 0;
      state.getUpStartQuats[b + 2] = 0;
      state.getUpStartQuats[b + 3] = 1;
    }
  }
}

/**
 * Steps the getting-up stand animation one frame and applies the blended push-up -> standing pose
 * directly to `ArticulatedCharacterRig`. Zero per-frame allocations.
 */
export function stepRagdollGetUp(
  state: PlayerRagdollState,
  rigOrGroup: ArticulatedCharacterRig | THREE.Group,
  dt: number,
): RagdollGetUpStepResult {
  const footX = state.getUpTargetFoot[0];
  const footY = state.getUpTargetFoot[1];
  const footZ = state.getUpTargetFoot[2];

  if (!state.isGettingUp) {
    return {
      isGettingUp: false,
      completed: false,
      progress: 1,
      pelvisX: footX,
      pelvisY: footY + 0.72,
      pelvisZ: footZ,
    };
  }

  const rig: ArticulatedCharacterRig | undefined =
    'rootGroup' in rigOrGroup
      ? rigOrGroup
      : (rigOrGroup.userData?.rig as ArticulatedCharacterRig | undefined);

  const safeDt = Math.max(0.001, Math.min(0.05, dt));
  state.getUpElapsed += safeDt;
  const rawT = Math.min(1, state.getUpElapsed / Math.max(0.1, state.getUpDuration));

  // Two-stage eased arc:
  //   Stage 1 (0.00 -> 0.48): push off ground into crouched kneel/push-up stance
  //   Stage 2 (0.48 -> 1.00): rise smoothly from crouch to full upright standing pose
  const split = 0.48;
  const inFirstHalf = rawT < split;
  const u = inFirstHalf
    ? smoothstep01(rawT / split)
    : smoothstep01((rawT - split) / (1 - split));

  const startPx = state.getUpStartPelvis[0];
  const startPy = state.getUpStartPelvis[1];
  const startPz = state.getUpStartPelvis[2];
  const midPx = startPx + (footX - startPx) * 0.55;
  const midPy = Math.max(startPy + 0.14, footY + 0.44);
  const midPz = startPz + (footZ - startPz) * 0.55;
  const endPy = footY + 0.72;

  const curPx = inFirstHalf ? startPx + (midPx - startPx) * u : midPx + (footX - midPx) * u;
  const curPy = inFirstHalf ? startPy + (midPy - startPy) * u : midPy + (endPy - midPy) * u;
  const curPz = inFirstHalf ? startPz + (midPz - startPz) * u : midPz + (footZ - midPz) * u;

  if (rig) {
    rig.rootGroup.visible = true;
    if (rawT >= 1.0) {
      // Snap cleanly to standard walking rig layout at completion
      resetRigFromRagdoll(rig);
      rig.rootGroup.position.set(footX, footY, footZ);
      rig.rootGroup.rotation.set(0, state.getUpTargetYaw, 0);
    } else {
      // During transition, rootGroup sits at interpolated pelvis world position (matching ragdoll convention)
      // while pelvisGroup carries world orientation blending toward targetYaw!
      rig.rootGroup.position.set(curPx, curPy, curPz);
      rig.rootGroup.rotation.set(0, 0, 0);
      rig.rootGroup.quaternion.identity();
      rig.pelvisGroup.position.set(0, 0, 0);
      rig.torsoMesh.position.set(0, 0.34, 0);
      rig.torsoMesh.quaternion.identity();

      _qTargetYaw.setFromAxisAngle(_vYAxis, state.getUpTargetYaw);

      const blendJoint = (
        jointIdx: number,
        obj: THREE.Object3D,
        midEulerX: number,
        midEulerY: number,
        midEulerZ: number,
        isPelvis = false,
      ) => {
        readQuat(state.getUpStartQuats, jointIdx, _qStart);
        _eMid.set(midEulerX, midEulerY, midEulerZ, 'YXZ');
        _qMid.setFromEuler(_eMid);
        if (isPelvis) {
          _qMid.premultiply(_qTargetYaw);
          _qEnd.copy(_qTargetYaw);
        } else {
          _qEnd.identity();
        }
        if (inFirstHalf) {
          _qTmp.slerpQuaternions(_qStart, _qMid, u);
        } else {
          _qTmp.slerpQuaternions(_qMid, _qEnd, u);
        }
        obj.quaternion.copy(_qTmp);
      };

      // Pelvis leans forward into a grounded crouch (+0.46 rad pitch) before rising upright
      blendJoint(0, rig.pelvisGroup, 0.46, 0, 0, true);
      // Head looks forward slightly up while getting up
      blendJoint(1, rig.headGroup, -0.32, 0, 0);
      // Arms brace forward/down to push off the floor, asymmetrical for natural feel
      blendJoint(2, rig.leftArmPivot, -0.78, 0, 0.16);
      blendJoint(3, rig.rightArmPivot, -0.64, 0, -0.14);
      blendJoint(4, rig.leftForearmPivot, -0.58, 0, 0);
      blendJoint(5, rig.rightForearmPivot, -0.48, 0, 0);
      // Legs tuck into a knee-up crouch (left knee deeper than right)
      blendJoint(6, rig.leftLegPivot, -0.72, 0, 0);
      blendJoint(7, rig.rightLegPivot, -0.48, 0, 0);
      blendJoint(8, rig.leftKneePivot, 1.05, 0, 0);
      blendJoint(9, rig.rightKneePivot, 0.82, 0, 0);

      // Gentle jetpack pilot glow stabilizing during stand-up
      rig.nozzleMat.emissiveIntensity = 0.55 + rawT * 0.45;
      rig.thrusterPlumeL.scale.set(0.25, 0.16, 0.25);
      rig.thrusterPlumeR.scale.set(0.25, 0.16, 0.25);
    }
  }

  if (rawT >= 1.0) {
    state.isGettingUp = false;
    state.getUpElapsed = 0;
    return {
      isGettingUp: false,
      completed: true,
      progress: 1,
      pelvisX: footX,
      pelvisY: footY + 0.72,
      pelvisZ: footZ,
    };
  }

  return {
    isGettingUp: true,
    completed: false,
    progress: rawT,
    pelvisX: curPx,
    pelvisY: curPy,
    pelvisZ: curPz,
  };
}
