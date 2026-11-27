/**
 * Unified Voxel Renderer & Physics Engine Optimization Module
 *
 * Bridges the voxel renderer (LOD0 box, Optical Zoom focus LOD0 box, worker surface heightmaps,
 * instanced mesh GPU buffers, and exposed-face culling) directly with the rigid-body and micro-voxel
 * physics engine for zero-copy, LOD-synchronized simulation.
 */

export const FACE_MASK_PX = 1 << 0; // +X (1)
export const FACE_MASK_NX = 1 << 1; // -X (2)
export const FACE_MASK_PY = 1 << 2; // +Y (4)
export const FACE_MASK_NY = 1 << 3; // -Y (8)
export const FACE_MASK_PZ = 1 << 4; // +Z (16)
export const FACE_MASK_NZ = 1 << 5; // -Z (32)
export const FACE_MASK_ALL = 0x3f;  // 63

export type PhysicsLodTier =
  | 'FULL_60HZ_LOD0'
  | 'MID_20HZ_LOD1_2'
  | 'FAR_SLEEP_LOD3_PLUS';

export interface ExposedFaceAnalysis {
  /** 6-bit mask of exposed faces (bits 0..5: +X, -X, +Y, -Y, +Z, -Z) */
  mask: number;
  /** Number of exposed faces (0..6) */
  exposedCount: number;
  /** Normalized local outward normal vector computed from exposed faces */
  normalX: number;
  normalY: number;
  normalZ: number;
}

export interface UnifiedEngineTelemetry {
  /** Total raycast DDA steps that reused the cached chunk pointer without hash/array lookup */
  cachedChunkRaycastSteps: number;
  /** Total raycast DDA steps fast-skipped above chunk.maxY or via heightmap O(1) check */
  skippedAirRaycastSteps: number;
  /** Total narrowphase collision point checks skipped via 6-bit exposed-face directional culling */
  cullSkippedCollisionPoints: number;
  /** Entities simulated at full 60Hz LOD0 in the latest frame */
  lod0PhysicsEntities: number;
  /** Entities promoted to full 60Hz LOD0 specifically because they are inside the Optical Zoom focal box */
  lodZoomPromotedEntities: number;
  /** Entities throttled or sleeping in outer LOD rings in the latest frame */
  lodThrottledPhysicsEntities: number;
  /** Direct Float32Array matrix writes executed without THREE.Object3D allocation/decomposition */
  directMatrixWrites: number;
  /** Zero-allocation O(1) shared heightmap terrain bounce probes executed by debris/FX */
  fastHeightmapDebrisProbes: number;
}

export const unifiedEngineTelemetry: UnifiedEngineTelemetry = {
  cachedChunkRaycastSteps: 0,
  skippedAirRaycastSteps: 0,
  cullSkippedCollisionPoints: 0,
  lod0PhysicsEntities: 0,
  lodZoomPromotedEntities: 0,
  lodThrottledPhysicsEntities: 0,
  directMatrixWrites: 0,
  fastHeightmapDebrisProbes: 0,
};

export function resetUnifiedEngineFrameTelemetry(): void {
  unifiedEngineTelemetry.lod0PhysicsEntities = 0;
  unifiedEngineTelemetry.lodZoomPromotedEntities = 0;
  unifiedEngineTelemetry.lodThrottledPhysicsEntities = 0;
}

/**
 * Computes a 6-bit exposed-face bitmask and normalized outward surface normal
 * for a voxel at local coordinates (vx, vy, vz).
 * Shared concept with the greedy mesher: interior voxels have mask === 0,
 * while hull voxels only expose specific directions.
 */
export function computeVoxelExposedFaceMask(
  vx: number,
  vy: number,
  vz: number,
  isAirNeighbor: (nx: number, ny: number, nz: number) => boolean
): ExposedFaceAnalysis {
  let mask = 0;
  let exposedCount = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  if (isAirNeighbor(vx + 1, vy, vz)) {
    mask |= FACE_MASK_PX;
    exposedCount++;
    nx += 1;
  }
  if (isAirNeighbor(vx - 1, vy, vz)) {
    mask |= FACE_MASK_NX;
    exposedCount++;
    nx -= 1;
  }
  if (isAirNeighbor(vx, vy + 1, vz)) {
    mask |= FACE_MASK_PY;
    exposedCount++;
    ny += 1;
  }
  if (isAirNeighbor(vx, vy - 1, vz)) {
    mask |= FACE_MASK_NY;
    exposedCount++;
    ny -= 1;
  }
  if (isAirNeighbor(vx, vy, vz + 1)) {
    mask |= FACE_MASK_PZ;
    exposedCount++;
    nz += 1;
  }
  if (isAirNeighbor(vx, vy, vz - 1)) {
    mask |= FACE_MASK_NZ;
    exposedCount++;
    nz -= 1;
  }

  const lenSq = nx * nx + ny * ny + nz * nz;
  if (lenSq > 1e-8) {
    const invLen = 1 / Math.sqrt(lenSq);
    nx *= invLen;
    ny *= invLen;
    nz *= invLen;
  }

  return {
    mask,
    exposedCount,
    normalX: nx,
    normalY: ny,
    normalZ: nz,
  };
}

/**
 * Fast directional back-face culling for surface-shell collision points.
 * Given a point's 6-bit exposedFaceMask and local outward normal, plus a local-space
 * contact direction or relative motion vector (dirLocalX, dirLocalY, dirLocalZ) pointing
 * from the body toward the obstacle/other body:
 * - Returns true if this hull point cannot possibly face the contact direction (can be skipped).
 * - Returns false if the point faces the contact direction and should be tested.
 */
export function shouldCullCollisionPointByDirection(
  exposedFaceMask: number,
  normalX: number,
  normalY: number,
  normalZ: number,
  dirLocalX: number,
  dirLocalY: number,
  dirLocalZ: number,
  dotThreshold = -0.35
): boolean {
  if (exposedFaceMask === 0) return true;

  // Check if any exposed axis-aligned face aligns with the query direction
  let hasMatchingAxisFace = false;
  if (dirLocalX > 0.15 && (exposedFaceMask & FACE_MASK_PX) !== 0) hasMatchingAxisFace = true;
  else if (dirLocalX < -0.15 && (exposedFaceMask & FACE_MASK_NX) !== 0) hasMatchingAxisFace = true;

  if (dirLocalY > 0.15 && (exposedFaceMask & FACE_MASK_PY) !== 0) hasMatchingAxisFace = true;
  else if (dirLocalY < -0.15 && (exposedFaceMask & FACE_MASK_NY) !== 0) hasMatchingAxisFace = true;

  if (dirLocalZ > 0.15 && (exposedFaceMask & FACE_MASK_PZ) !== 0) hasMatchingAxisFace = true;
  else if (dirLocalZ < -0.15 && (exposedFaceMask & FACE_MASK_NZ) !== 0) hasMatchingAxisFace = true;

  if (!hasMatchingAxisFace) {
    return true;
  }

  const nLenSq = normalX * normalX + normalY * normalY + normalZ * normalZ;
  const dLenSq = dirLocalX * dirLocalX + dirLocalY * dirLocalY + dirLocalZ * dirLocalZ;
  if (nLenSq > 1e-6 && dLenSq > 1e-6) {
    const dot = (normalX * dirLocalX + normalY * dirLocalY + normalZ * dirLocalZ) / Math.sqrt(dLenSq);
    if (dot < dotThreshold) {
      return true;
    }
  }

  return false;
}

export interface ClassifyEntityPhysicsLodParams {
  entityX: number;
  entityY?: number;
  entityZ: number;
  playerX: number;
  playerY?: number;
  playerZ: number;
  /** Whether this entity is the player's currently controlled vehicle or target */
  isActivePlayerEntity: boolean;
  /** Whether this entity has active C4 charges, falling detached voxels, or active impulse wake */
  hasUrgentPhysicsActivity?: boolean;
  /** Radius in meters around the player where full 60Hz LOD0 micro-voxel physics runs (default 110m) */
  playerLod0RadiusMeters?: number;
  /** Radius in meters around the player where mid-tier 20Hz physics runs (default 260m) */
  midTierRadiusMeters?: number;
  /** Whether Optical / Spyglass Zoom is currently active */
  isOpticalZoomActive?: boolean;
  /** World X of the Optical Zoom focal point (if active) */
  zoomFocusX?: number | null;
  /** World Z of the Optical Zoom focal point (if active) */
  zoomFocusZ?: number | null;
  /** Radius in meters around the Optical Zoom focal point promoted to full 60Hz LOD0 (default 110m) */
  zoomLod0RadiusMeters?: number;
}

export interface EntityPhysicsLodDecision {
  tier: PhysicsLodTier;
  /** True when the entity was promoted to FULL_60HZ_LOD0 specifically due to Optical Zoom focus */
  promotedByOpticalZoom: boolean;
  /** Substep stride: 1 = every substep (60Hz), 3 = every 3rd frame (~20Hz), 0 = sleep */
  frameStride: number;
}

/**
 * Classifies an entity or AI vehicle into a physics simulation tier synchronized with
 * the renderer's LOD0 player box AND the active Optical Zoom focal LOD0 box.
 */
export function classifyEntityPhysicsLodTier(
  params: ClassifyEntityPhysicsLodParams
): EntityPhysicsLodDecision {
  if (params.isActivePlayerEntity || params.hasUrgentPhysicsActivity) {
    return {
      tier: 'FULL_60HZ_LOD0',
      promotedByOpticalZoom: false,
      frameStride: 1,
    };
  }

  const lod0R = params.playerLod0RadiusMeters ?? 110;
  const midR = params.midTierRadiusMeters ?? 260;
  const dxPlayer = params.entityX - params.playerX;
  const dzPlayer = params.entityZ - params.playerZ;
  const distSqPlayer = dxPlayer * dxPlayer + dzPlayer * dzPlayer;

  if (distSqPlayer <= lod0R * lod0R) {
    return {
      tier: 'FULL_60HZ_LOD0',
      promotedByOpticalZoom: false,
      frameStride: 1,
    };
  }

  // Check if the entity sits inside the active Optical Zoom focal LOD0 zone
  if (
    params.isOpticalZoomActive &&
    params.zoomFocusX !== undefined &&
    params.zoomFocusX !== null &&
    params.zoomFocusZ !== undefined &&
    params.zoomFocusZ !== null &&
    Number.isFinite(params.zoomFocusX) &&
    Number.isFinite(params.zoomFocusZ)
  ) {
    const zoomR = params.zoomLod0RadiusMeters ?? 115;
    const dxZoom = params.entityX - params.zoomFocusX;
    const dzZoom = params.entityZ - params.zoomFocusZ;
    if (dxZoom * dxZoom + dzZoom * dzZoom <= zoomR * zoomR) {
      return {
        tier: 'FULL_60HZ_LOD0',
        promotedByOpticalZoom: true,
        frameStride: 1,
      };
    }
  }

  if (distSqPlayer <= midR * midR) {
    return {
      tier: 'MID_20HZ_LOD1_2',
      promotedByOpticalZoom: false,
      frameStride: 3,
    };
  }

  return {
    tier: 'FAR_SLEEP_LOD3_PLUS',
    promotedByOpticalZoom: false,
    frameStride: 0,
  };
}

/**
 * Writes a 4x4 column-major transform matrix directly into a Float32Array
 * (such as THREE.InstancedMesh.instanceMatrix.array) at `instanceIndex * 16`
 * from position (x, y, z), XYZ Euler angles (rx, ry, rz), and uniform scale `s`.
 *
 * Matches THREE.Object3D.updateMatrix() with default Euler order 'XYZ' bit-for-bit
 * while eliminating THREE.Object3D / Quaternion / Vector3 / Matrix4.compose overhead.
 */
export function writeInstanceMatrixEulerXYZFast(
  targetArray: Float32Array,
  instanceIndex: number,
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  scaleX: number,
  scaleY = scaleX,
  scaleZ = scaleX
): void {
  const offset = instanceIndex << 4; // instanceIndex * 16
  if (scaleX === 0 && scaleY === 0 && scaleZ === 0) {
    targetArray.fill(0, offset, offset + 16);
    targetArray[offset + 12] = x;
    targetArray[offset + 13] = y;
    targetArray[offset + 14] = z;
    targetArray[offset + 15] = 1;
    unifiedEngineTelemetry.directMatrixWrites++;
    return;
  }

  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);

  const ae = a * e, af = a * f, be = b * e, bf = b * f;

  // Column 0 (matches THREE.Matrix4.makeRotationFromEuler order 'XYZ' scaled by scaleX)
  targetArray[offset + 0] = (c * e) * scaleX;
  targetArray[offset + 1] = (be * d + af) * scaleX;
  targetArray[offset + 2] = (-ae * d + bf) * scaleX;
  targetArray[offset + 3] = 0;

  // Column 1 (scaled by scaleY)
  targetArray[offset + 4] = (-c * f) * scaleY;
  targetArray[offset + 5] = (-bf * d + ae) * scaleY;
  targetArray[offset + 6] = (af * d + be) * scaleY;
  targetArray[offset + 7] = 0;

  // Column 2 (scaled by scaleZ)
  targetArray[offset + 8] = d * scaleZ;
  targetArray[offset + 9] = (-b * c) * scaleZ;
  targetArray[offset + 10] = (a * c) * scaleZ;
  targetArray[offset + 11] = 0;

  // Column 3 (Translation)
  targetArray[offset + 12] = x;
  targetArray[offset + 13] = y;
  targetArray[offset + 14] = z;
  targetArray[offset + 15] = 1;

  unifiedEngineTelemetry.directMatrixWrites++;
}
