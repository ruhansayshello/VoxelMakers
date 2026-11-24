import {
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  MAT,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Z,
  type SerializedVehicleBlueprint,
  type WorldGenMode,
} from './constants.ts';
import { MAT_BUCKET_ALL_MASK } from './physicsMath.ts';
import type { MicroVoxelChunk, MicroVoxelWorld } from './world.ts';
import type { ModularVehicleRig } from './vehicle.ts';
import type { KinematicMapHazard, SerializedMapHazard } from './mapHazards.ts';

export const SAVED_WORLDS_STORAGE_KEY = 'voxelmakers_saved_worlds_v1';
export const MAX_SAVED_WORLDS_IN_STORAGE = 10;

export interface SerializedModifiedChunk {
  cx: number;
  cz: number;
  minY: number;
  maxY: number;
  hasTranslucent: boolean;
  transMinY: number;
  transMaxY: number;
  surfaceHeightMap: number[];
  voxelsRle: number[];
  colorsSparse?: number[];
}

export interface SerializedPlacedEntity {
  presetId: string | null;
  wx: number;
  wy: number;
  wz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  blueprint: SerializedVehicleBlueprint;
}

export interface SerializedCustomWorldSave {
  id: string;
  name: string;
  createdAt: string;
  version: 1;
  worldGenMode: WorldGenMode;
  flatBaseplateMat: number;
  modifiedChunks: SerializedModifiedChunk[];
  placedEntities: SerializedPlacedEntity[];
  placedHazards: SerializedMapHazard[];
}

function encodeChunkRle(voxels: Uint8Array): number[] {
  const runs: number[] = [];
  if (voxels.length === 0) return runs;
  let curMat = voxels[0];
  let runLen = 1;
  for (let i = 1; i < voxels.length; i++) {
    const m = voxels[i];
    if (m === curMat && runLen < 0xffffff) {
      runLen++;
    } else {
      runs.push(((curMat & 0xff) << 24) | (runLen & 0xffffff));
      curMat = m;
      runLen = 1;
    }
  }
  runs.push(((curMat & 0xff) << 24) | (runLen & 0xffffff));
  return runs;
}

function decodeChunkRleInto(runs: ReadonlyArray<number>, outVoxels: Uint8Array): void {
  let writeCursor = 0;
  const maxLen = outVoxels.length;
  for (let i = 0; i < runs.length; i++) {
    const word = runs[i] >>> 0;
    const mat = (word >>> 24) & 0xff;
    const len = word & 0xffffff;
    const end = Math.min(maxLen, writeCursor + len);
    outVoxels.fill(mat, writeCursor, end);
    writeCursor = end;
  }
}

function serializeModifiedChunk(chunk: MicroVoxelChunk): SerializedModifiedChunk {
  chunk.commitPendingRemovals();

  let voxelsRle: number[];
  let colorsSparse: number[] | undefined;

  if (chunk.compressedVoxelsRle) {
    voxelsRle = Array.from(chunk.compressedVoxelsRle);
    if (chunk.compressedColorsSparse && chunk.compressedColorsSparse.length > 0) {
      colorsSparse = Array.from(chunk.compressedColorsSparse);
    }
  } else {
    voxelsRle = encodeChunkRle(chunk.voxels);
    if (chunk.customColors) {
      const sparse: number[] = [];
      const colors = chunk.customColors;
      const totalVoxels = CHUNK_X * CHUNK_Y * CHUNK_Z;
      for (let vIdx = 0; vIdx < totalVoxels; vIdx++) {
        const cIdx = vIdx * 3;
        const r = colors[cIdx];
        const g = colors[cIdx + 1];
        const b = colors[cIdx + 2];
        if (r !== 0 || g !== 0 || b !== 0) {
          sparse.push(vIdx, (r << 16) | (g << 8) | b);
        }
      }
      if (sparse.length > 0) {
        colorsSparse = sparse;
      }
    }
  }

  return {
    cx: chunk.cx,
    cz: chunk.cz,
    minY: chunk.minY,
    maxY: chunk.maxY,
    hasTranslucent: chunk.hasTranslucent,
    transMinY: chunk.transMinY,
    transMaxY: chunk.transMaxY,
    surfaceHeightMap: Array.from(chunk.surfaceHeightMap),
    voxelsRle,
    colorsSparse,
  };
}

/**
 * Captures the current world state (biome, all user-modified chunks, placed physics props,
 * and spinning map hazards) into a compact RLE-compressed save snapshot.
 */
export function captureCustomWorldSave(
  name: string,
  world: MicroVoxelWorld,
  voxelEntities: ReadonlyArray<ModularVehicleRig>,
  mapHazards: ReadonlyArray<KinematicMapHazard>,
): SerializedCustomWorldSave {
  const modifiedByKey = new Map<string, SerializedModifiedChunk>();

  // 1. Collect pruned modified chunks from the LRU cache first
  for (const [key, cachedChunk] of world.modifiedChunkCache.entries()) {
    if (cachedChunk.userModified) {
      modifiedByKey.set(key, serializeModifiedChunk(cachedChunk));
    }
  }

  // 2. Collect active modified chunks in world.chunkMap (overriding any older cached entry)
  for (const [key, activeChunk] of world.chunkMap.entries()) {
    if (activeChunk.userModified) {
      modifiedByKey.set(key, serializeModifiedChunk(activeChunk));
    }
  }

  // 3. Serialize active dynamic props (up to 150 props)
  const placedEntities: SerializedPlacedEntity[] = [];
  const maxProps = Math.min(150, voxelEntities.length);
  for (let i = 0; i < maxProps; i++) {
    const ent = voxelEntities[i];
    if (!ent || ent.voxelCount <= 0) continue;
    placedEntities.push({
      presetId: ent.entityPresetId ?? null,
      wx: Number(ent.position.x.toFixed(3)),
      wy: Number(ent.position.y.toFixed(3)),
      wz: Number(ent.position.z.toFixed(3)),
      qx: Number(ent.quaternion.x.toFixed(4)),
      qy: Number(ent.quaternion.y.toFixed(4)),
      qz: Number(ent.quaternion.z.toFixed(4)),
      qw: Number(ent.quaternion.w.toFixed(4)),
      blueprint: ent.exportBlueprint(ent.customBlueprintName || 'Saved Prop'),
    });
  }

  // 4. Serialize spinning map hazards
  const placedHazards: SerializedMapHazard[] = [];
  for (let i = 0; i < mapHazards.length; i++) {
    placedHazards.push(mapHazards[i].serialize());
  }

  const trimmedName = (name || '').trim() || `Custom World ${new Date().toLocaleTimeString()}`;

  return {
    id: `world_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: trimmedName,
    createdAt: new Date().toLocaleString(),
    version: 1,
    worldGenMode: world.worldGenMode,
    flatBaseplateMat: world.flatBaseplateMat || MAT.CONCRETE,
    modifiedChunks: Array.from(modifiedByKey.values()),
    placedEntities,
    placedHazards,
  };
}

/**
 * Restores the base biome and applies all RLE-compressed modified chunks onto `world`.
 * Returns the number of modified chunks restored.
 */
export function applyCustomWorldSaveToTerrain(
  save: SerializedCustomWorldSave,
  world: MicroVoxelWorld,
): number {
  const mode: WorldGenMode =
    save.worldGenMode === 'CUSTOM_GLB_MAP' || save.worldGenMode === 'CUSTOM_HEIGHTMAP'
      ? 'DEFAULT_PARK'
      : save.worldGenMode || 'DEFAULT_PARK';

  world.modifiedChunkCache.clear();
  world.regenerateWorld(mode, save.flatBaseplateMat || MAT.CONCRETE, null);

  if (!Array.isArray(save.modifiedChunks) || save.modifiedChunks.length === 0) {
    return 0;
  }

  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let restoredCount = 0;

  for (let i = 0; i < save.modifiedChunks.length; i++) {
    const mc = save.modifiedChunks[i];
    if (
      typeof mc.cx !== 'number' ||
      typeof mc.cz !== 'number' ||
      !Array.isArray(mc.voxelsRle)
    ) {
      continue;
    }

    const chunk = world.getOrCreateChunk(mc.cx, mc.cz, false, false);
    const fullSize = CHUNK_X * CHUNK_Y * CHUNK_Z;
    if (chunk.voxels.length !== fullSize) {
      chunk.voxels = new Uint8Array(fullSize);
    }
    decodeChunkRleInto(mc.voxelsRle, chunk.voxels);

    if (Array.isArray(mc.surfaceHeightMap) && mc.surfaceHeightMap.length === CHUNK_X * CHUNK_Z) {
      for (let sIdx = 0; sIdx < mc.surfaceHeightMap.length; sIdx++) {
        chunk.surfaceHeightMap[sIdx] = mc.surfaceHeightMap[sIdx];
      }
    }

    if (Array.isArray(mc.colorsSparse) && mc.colorsSparse.length >= 2) {
      if (!chunk.customColors) {
        chunk.customColors = new Uint8Array(fullSize * 3);
      } else {
        chunk.customColors.fill(0);
      }
      for (let c = 0; c < mc.colorsSparse.length; c += 2) {
        const vIdx: number = mc.colorsSparse[c];
        const rgb: number = mc.colorsSparse[c + 1];
        const cIdx = vIdx * 3;
        if (cIdx + 2 < chunk.customColors.length) {
          chunk.customColors[cIdx] = (rgb >>> 16) & 0xff;
          chunk.customColors[cIdx + 1] = (rgb >>> 8) & 0xff;
          chunk.customColors[cIdx + 2] = rgb & 0xff;
        }
      }
    } else {
      chunk.customColors = null;
    }

    chunk.compressedVoxelsRle = null;
    chunk.compressedColorsSparse = null;
    chunk.isSurfaceOnlyTerrain = false;
    chunk.isSurfaceOnlyMesh = false;
    chunk.userModified = true;
    chunk.lastAccessedMs = nowMs;
    chunk.minY = typeof mc.minY === 'number' ? mc.minY : 1;
    chunk.maxY = typeof mc.maxY === 'number' ? mc.maxY : CHUNK_Y - 1;
    chunk.hasTranslucent = Boolean(mc.hasTranslucent);
    chunk.transMinY = typeof mc.transMinY === 'number' ? mc.transMinY : 1;
    chunk.transMaxY = typeof mc.transMaxY === 'number' ? mc.transMaxY : CHUNK_Y - 1;
    chunk.dirtyBucketMask = MAT_BUCKET_ALL_MASK;

    if (
      mc.cx >= 0 &&
      mc.cx < WORLD_CHUNKS_X &&
      mc.cz >= 0 &&
      mc.cz < WORLD_CHUNKS_Z
    ) {
      world.chunks[mc.cx + mc.cz * WORLD_CHUNKS_X] = chunk;
    }
    world.markChunkDirty(chunk);
    restoredCount++;
  }

  world.flushDirtyChunksImmediate(
    WORLD_CHUNKS_X >> 1,
    WORLD_CHUNKS_Z >> 1,
    Math.min(32, restoredCount + 4),
  );
  return restoredCount;
}

export function loadSavedWorldsFromStorage(): SerializedCustomWorldSave[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SAVED_WORLDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SerializedCustomWorldSave =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        Array.isArray(item.modifiedChunks),
    );
  } catch (err) {
    console.warn('[WorldSaveSystem] Failed to load saved worlds from storage:', err);
    return [];
  }
}

export function saveWorldToStorage(
  save: SerializedCustomWorldSave,
): SerializedCustomWorldSave[] {
  const existing = loadSavedWorldsFromStorage().filter(
    (w) => w.id !== save.id && w.name.toLowerCase() !== save.name.toLowerCase(),
  );
  const next = [save, ...existing].slice(0, MAX_SAVED_WORLDS_IN_STORAGE);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SAVED_WORLDS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch (err) {
    console.warn('[WorldSaveSystem] Storage quota reached, trimming oldest world saves:', err);
    const trimmed = next.slice(0, Math.max(1, next.length - 2));
    try {
      localStorage.setItem(SAVED_WORLDS_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Ignore secondary storage quota error
    }
    return trimmed;
  }
  return next;
}

export function deleteSavedWorldFromStorage(
  id: string,
): SerializedCustomWorldSave[] {
  const next = loadSavedWorldsFromStorage().filter((w) => w.id !== id);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SAVED_WORLDS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage write error
  }
  return next;
}

export function exportWorldSaveJson(save: SerializedCustomWorldSave): string {
  return JSON.stringify(save);
}

export function parseWorldSaveJson(
  rawJson: string,
): SerializedCustomWorldSave | null {
  try {
    const parsed = JSON.parse(rawJson.trim());
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.modifiedChunks)
    ) {
      return null;
    }
    return {
      id:
        typeof parsed.id === 'string'
          ? parsed.id
          : `world_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name:
        typeof parsed.name === 'string' && parsed.name.trim()
          ? parsed.name.trim()
          : 'Imported Custom World',
      createdAt:
        typeof parsed.createdAt === 'string'
          ? parsed.createdAt
          : new Date().toLocaleString(),
      version: 1,
      worldGenMode: parsed.worldGenMode || 'DEFAULT_PARK',
      flatBaseplateMat:
        typeof parsed.flatBaseplateMat === 'number'
          ? parsed.flatBaseplateMat
          : MAT.CONCRETE,
      modifiedChunks: parsed.modifiedChunks,
      placedEntities: Array.isArray(parsed.placedEntities)
        ? parsed.placedEntities
        : [],
      placedHazards: Array.isArray(parsed.placedHazards)
        ? parsed.placedHazards
        : [],
    };
  } catch {
    return null;
  }
}
