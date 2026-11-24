import React, { useEffect, useRef, useState } from 'react';
import { MAT, type ModuleKind } from '../constants.ts';
import {
  packVoxelKey,
  unpackVoxelKey,
  normalizeVoxelKey,
} from '../physics/collisionPoints.ts';
import { PHYSICS_CONFIG } from '../physics/physicsConfig.ts';

export interface SilhouetteCell {
  vx: number;
  vz: number;
  highestVy: number;
  voxelKey: number;
  /** Normalized damage value: 1.0 = full HP (100), 0.0 = destroyed (0) */
  damageValue: number;
  /** HP on 0..100 scale */
  hp: number;
  /** True if voxel is currently scheduled to fall off (Step 2.5) */
  fallingOff: boolean;
  /** Proximity heat (0..1) from adjacent destroyed/impacted cells for outward damage gradient */
  impactGradient: number;
}

export interface VehicleSilhouetteGrid {
  minVX: number;
  maxVX: number;
  minVZ: number;
  maxVZ: number;
  cols: number;
  rows: number;
  cells: Array<Array<SilhouetteCell | null>>;
}

export type CriticalModuleCategory =
  | 'SEAT'
  | 'THRUSTER'
  | 'ENGINE'
  | 'WHEEL'
  | 'WEAPON'
  | 'ECU';

export interface CriticalModuleSymbolMarker {
  category: CriticalModuleCategory;
  kind: ModuleKind;
  symbolCode: string;
  shortTag: string;
  vx: number;
  vy: number;
  vz: number;
  /** HP on 0..100 scale */
  hp: number;
  /** Normalized damage value: 1.0 = full HP, 0.0 = destroyed */
  damageValue: number;
  fallingOff: boolean;
  isDestroyed: boolean;
}

export interface IntegrityDiagramModuleLike {
  kind: ModuleKind;
  vx: number;
  vy: number;
  vz: number;
  health?: number;
  isShotOut?: boolean;
}

export interface IntegrityDiagramVehicleSource {
  voxelMap: Map<number | string, number>;
  voxelHealthMap?: Map<number | string, number>;
  voxelDestructionMap?: Map<
    number,
    { hp: number; maxHp: number; voxelKey: number }
  >;
  fallingOffVoxels?: Map<number, unknown>;
  modules?: IntegrityDiagramModuleLike[];
  intactBlueprintSnapshot?: {
    voxels: Array<[number, number, number, number]>;
    modules?: Array<{
      kind: ModuleKind;
      vx: number;
      vy: number;
      vz: number;
    }>;
  } | null;
  getVoxel?: (vx: number, vy: number, vz: number) => number;
}

/**
 * Classifies a module kind into one of the 6 critical HUD symbol categories
 * (Seats, Thrusters/Rotors, Engines, Wheels, Weapons, ECU/Gyros).
 */
export function classifyCriticalModuleKind(kind: ModuleKind): {
  category: CriticalModuleCategory;
  symbolCode: string;
  shortTag: string;
} | null {
  switch (kind) {
    case 'COCKPIT':
    case 'SEAT_KART':
    case 'SEAT_MOTO':
    case 'SEAT_OPERATOR':
    case 'SEAT_ARMORED':
    case 'SEAT_DIVING':
    case 'SEAT_SPACE':
    case 'SEAT_SHIP_WHEEL':
      return { category: 'SEAT', symbolCode: '◆', shortTag: 'SEAT' };

    case 'THRUSTER':
    case 'THRUSTER_MINI':
    case 'THRUSTER_ROCKET':
    case 'JET_RAW':
    case 'JET_GIMBAL':
    case 'VTOL_ROTOR':
    case 'PROP_AERO':
    case 'BOAT_PROP':
    case 'BOAT_OUTBOARD':
      return { category: 'THRUSTER', symbolCode: '▲', shortTag: 'THR' };

    case 'V8_ENGINE':
    case 'ENGINE_BULLDAWG':
    case 'ENGINE_DRAGON':
      return { category: 'ENGINE', symbolCode: '⬡', shortTag: 'ENG' };

    case 'WHEEL_STEER':
    case 'WHEEL_DRIVE':
    case 'WHEEL_RACING':
    case 'WHEEL_MONSTER':
    case 'WHEEL_KART':
    case 'WHEEL_DRAG':
    case 'WHEEL_SPIKED':
    case 'SKI_SLIDER':
      return { category: 'WHEEL', symbolCode: '◎', shortTag: 'WHL' };

    case 'PLASMA_CANNON':
    case 'WEAPON_MINIGUN':
    case 'WEAPON_ROCKET':
    case 'WEAPON_BOMB_BAY':
    case 'WEAPON_MELEE':
      return { category: 'WEAPON', symbolCode: '⊕', shortTag: 'WPN' };

    case 'MICROBIT_ECU':
    case 'GYRO':
    case 'GYRO_REACTION':
      return { category: 'ECU', symbolCode: '▣', shortTag: 'ECU' };

    default:
      return null;
  }
}

/**
 * Extracts all critical module markers (Seats, Thrusters, Engines, Wheels, Weapons, ECU)
 * including intact, damaged, and completely destroyed modules from the intact blueprint baseline.
 */
export function extractVehicleCriticalModuleMarkers(
  vehicle: IntegrityDiagramVehicleSource,
): CriticalModuleSymbolMarker[] {
  const markers: CriticalModuleSymbolMarker[] = [];
  const liveModules = vehicle.modules || [];
  const baselineModules = vehicle.intactBlueprintSnapshot?.modules || [];
  const matchedLiveIndices = new Set<number>();

  const computeLiveModuleHp100 = (mod: IntegrityDiagramModuleLike): number => {
    if (mod.isShotOut) return 0;
    const rawHealth = mod.health ?? 1.0;
    if (rawHealth <= 0) return 0;
    const norm = rawHealth > 1.0 ? Math.min(1, rawHealth / 100) : Math.max(0, rawHealth);
    return Math.round(norm * 100);
  };

  // 1. Match baseline modules against live modules so severed/destroyed modules show as hp=0 (black)
  for (let i = 0; i < baselineModules.length; i++) {
    const baseMod = baselineModules[i];
    const meta = classifyCriticalModuleKind(baseMod.kind);
    if (!meta) continue;

    let foundIdx = -1;
    for (let j = 0; j < liveModules.length; j++) {
      if (matchedLiveIndices.has(j)) continue;
      const lm = liveModules[j];
      if (
        lm.kind === baseMod.kind &&
        lm.vx === baseMod.vx &&
        lm.vy === baseMod.vy &&
        lm.vz === baseMod.vz
      ) {
        foundIdx = j;
        break;
      }
    }

    if (foundIdx >= 0) {
      matchedLiveIndices.add(foundIdx);
      const lm = liveModules[foundIdx];
      const vKey = packVoxelKey(lm.vx, lm.vy, lm.vz);
      const fallingOff = Boolean(vehicle.fallingOffVoxels?.has(vKey));
      let hp = computeLiveModuleHp100(lm);
      if (fallingOff && hp > 15) hp = 15;
      markers.push({
        category: meta.category,
        kind: lm.kind,
        symbolCode: meta.symbolCode,
        shortTag: meta.shortTag,
        vx: lm.vx,
        vy: lm.vy,
        vz: lm.vz,
        hp,
        damageValue: hp / 100,
        fallingOff,
        isDestroyed: hp <= 0,
      });
    } else {
      markers.push({
        category: meta.category,
        kind: baseMod.kind,
        symbolCode: meta.symbolCode,
        shortTag: meta.shortTag,
        vx: baseMod.vx,
        vy: baseMod.vy,
        vz: baseMod.vz,
        hp: 0,
        damageValue: 0,
        fallingOff: false,
        isDestroyed: true,
      });
    }
  }

  // 2. Include any live modules not yet in the baseline snapshot
  for (let j = 0; j < liveModules.length; j++) {
    if (matchedLiveIndices.has(j)) continue;
    const lm = liveModules[j];
    const meta = classifyCriticalModuleKind(lm.kind);
    if (!meta) continue;
    const vKey = packVoxelKey(lm.vx, lm.vy, lm.vz);
    const fallingOff = Boolean(vehicle.fallingOffVoxels?.has(vKey));
    let hp = computeLiveModuleHp100(lm);
    if (fallingOff && hp > 15) hp = 15;
    markers.push({
      category: meta.category,
      kind: lm.kind,
      symbolCode: meta.symbolCode,
      shortTag: meta.shortTag,
      vx: lm.vx,
      vy: lm.vy,
      vz: lm.vz,
      hp,
      damageValue: hp / 100,
      fallingOff,
      isDestroyed: hp <= 0,
    });
  }

  return markers;
}

/**
 * Step 2.8: Computes a 2D top-down silhouette of the vehicle's voxels:
 * - For each (vx, vz) column, finds the highest vy voxel that exists (or existed in intact blueprint)
 * - Also expands bounds to include any mounted critical modules (wheels, thrusters, seats)
 * - Computes each cell's damageValue (1.0 = full HP, 0.0 = destroyed) and outward impact gradient
 */
export function computeVehicleTopDownSilhouette(
  vehicle: IntegrityDiagramVehicleSource,
): VehicleSilhouetteGrid {
  const columnHighestNow = new Map<
    string,
    { vx: number; vy: number; vz: number; key: number }
  >();
  const columnIntactBaseline = new Map<
    string,
    { vx: number; vy: number; vz: number; key: number }
  >();

  let minVX = Infinity;
  let maxVX = -Infinity;
  let minVZ = Infinity;
  let maxVZ = -Infinity;

  // Include intact blueprint columns so destroyed voxels appear as black/missing in the silhouette
  if (vehicle.intactBlueprintSnapshot?.voxels) {
    for (let i = 0; i < vehicle.intactBlueprintSnapshot.voxels.length; i++) {
      const [vx, vy, vz, mat] = vehicle.intactBlueprintSnapshot.voxels[i];
      if (mat === MAT.AIR) continue;
      if (vx < minVX) minVX = vx;
      if (vx > maxVX) maxVX = vx;
      if (vz < minVZ) minVZ = vz;
      if (vz > maxVZ) maxVZ = vz;
      const colId = `${vx},${vz}`;
      const prev = columnIntactBaseline.get(colId);
      if (!prev || vy > prev.vy) {
        columnIntactBaseline.set(colId, {
          vx,
          vy,
          vz,
          key: packVoxelKey(vx, vy, vz),
        });
      }
    }
  }

  for (const [rawKey, mat] of vehicle.voxelMap.entries()) {
    if (mat === MAT.AIR) continue;
    const key = normalizeVoxelKey(rawKey);
    const [vx, vy, vz] = unpackVoxelKey(key);
    if (vx < minVX) minVX = vx;
    if (vx > maxVX) maxVX = vx;
    if (vz < minVZ) minVZ = vz;
    if (vz > maxVZ) maxVZ = vz;

    const colId = `${vx},${vz}`;
    const prev = columnHighestNow.get(colId);
    if (!prev || vy > prev.vy) {
      columnHighestNow.set(colId, { vx, vy, vz, key });
    }
  }

  // Also include module coordinates in grid bounds so outboard wheels/thrusters never clip
  const allMods = [
    ...(vehicle.intactBlueprintSnapshot?.modules || []),
    ...(vehicle.modules || []),
  ];
  for (let i = 0; i < allMods.length; i++) {
    const m = allMods[i];
    if (m.vx < minVX) minVX = m.vx;
    if (m.vx > maxVX) maxVX = m.vx;
    if (m.vz < minVZ) minVZ = m.vz;
    if (m.vz > maxVZ) maxVZ = m.vz;
  }

  if (!Number.isFinite(minVX) || !Number.isFinite(minVZ)) {
    return {
      minVX: 0,
      maxVX: 0,
      minVZ: 0,
      maxVZ: 0,
      cols: 1,
      rows: 1,
      cells: [[null]],
    };
  }

  const cols = Math.max(1, maxVX - minVX + 1);
  const rows = Math.max(1, maxVZ - minVZ + 1);
  const cells: Array<Array<SilhouetteCell | null>> = Array.from(
    { length: rows },
    () => new Array<SilhouetteCell | null>(cols).fill(null),
  );

  const impactCenters: Array<{ c: number; r: number; severity: number }> = [];

  for (let r = 0; r < rows; r++) {
    const vz = minVZ + r;
    for (let c = 0; c < cols; c++) {
      const vx = minVX + c;
      const colId = `${vx},${vz}`;
      const liveTop = columnHighestNow.get(colId);
      const baseTop = columnIntactBaseline.get(colId);

      if (!liveTop && !baseTop) {
        continue;
      }

      if (!liveTop && baseTop) {
        // Column was completely destroyed
        cells[r][c] = {
          vx,
          vz,
          highestVy: baseTop.vy,
          voxelKey: baseTop.key,
          damageValue: 0.0,
          hp: 0,
          fallingOff: false,
          impactGradient: 1.0,
        };
        impactCenters.push({ c, r, severity: 1.0 });
        continue;
      }

      const activeTop = liveTop!;
      const isFallingOff = Boolean(
        vehicle.fallingOffVoxels?.has(activeTop.key),
      );
      const destRec = vehicle.voxelDestructionMap?.get(activeTop.key);
      let normHp = 1.0;

      if (destRec) {
        normHp = Math.max(0, Math.min(1, destRec.hp / Math.max(1, destRec.maxHp)));
      } else if (vehicle.voxelHealthMap) {
        const rawH =
          vehicle.voxelHealthMap.get(activeTop.key) ??
          vehicle.voxelHealthMap.get(`${vx},${activeTop.vy},${vz}`);
        if (typeof rawH === 'number') {
          normHp = rawH > 1.0 ? Math.min(1, rawH / 100) : Math.max(0, rawH);
        }
      }

      // If upper layers of this column were shaved off compared to intact baseline, reflect partial column loss
      if (baseTop && activeTop.vy < baseTop.vy) {
        normHp = Math.min(normHp, 0.45);
      }
      if (isFallingOff) {
        normHp = Math.min(normHp, 0.15);
      }

      const hp100 = Math.round(normHp * 100);
      cells[r][c] = {
        vx,
        vz,
        highestVy: activeTop.vy,
        voxelKey: activeTop.key,
        damageValue: normHp,
        hp: hp100,
        fallingOff: isFallingOff,
        impactGradient: normHp < 0.8 ? 1.0 - normHp : 0,
      };

      if (normHp < 0.8) {
        impactCenters.push({ c, r, severity: 1.0 - normHp });
      }
    }
  }

  // Compute smooth outward damage propagation gradient from impact centers
  if (impactCenters.length > 0) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r][c];
        if (!cell) continue;
        let maxGrad = cell.impactGradient;
        for (let i = 0; i < impactCenters.length; i++) {
          const ic = impactCenters[i];
          const dist = Math.hypot(c - ic.c, r - ic.r);
          if (dist <= 3.5) {
            const falloff = Math.max(0, 1.0 - dist / 3.5) * ic.severity * 0.75;
            if (falloff > maxGrad) {
              maxGrad = falloff;
            }
          }
        }
        cell.impactGradient = maxGrad;
      }
    }
  }

  return {
    minVX,
    maxVX,
    minVZ,
    maxVZ,
    cols,
    rows,
    cells,
  };
}

/**
 * Resolves the HUD color for a silhouette voxel cell according to Step 2.8:
 * - Undamaged voxels (hp > 80): dark gray (#444444) (or dim red gradient near impact)
 * - Light damage (hp 50-80): orange-yellow (#facc15)
 * - Heavy damage (hp 20-50): bright red (#dc2626)
 * - Critical damage (hp 1-20): pulsing bright red
 * - Destroyed voxels (hp 0 or absent): black (#090d16)
 */
export function resolveSilhouetteCellColor(
  cell: SilhouetteCell,
  pulsePhase: boolean,
): string {
  if (cell.hp <= 0) {
    return '#090d16';
  }
  if (cell.hp <= 20 || cell.fallingOff) {
    return pulsePhase ? '#ff4444' : '#991b1b';
  }
  if (cell.hp <= 50) {
    return '#dc2626';
  }
  if (cell.hp <= 80) {
    return '#facc15';
  }
  // Undamaged (hp > 80), with subtle dim-red inward fade when adjacent to an impact zone
  if (cell.impactGradient > 0.22) {
    return '#6b2f2f';
  }
  return '#444444';
}

/**
 * Uses the exact same HP color system for critical module symbols (Seat, Thruster, Engine, Wheel, Weapon, ECU):
 * - Undamaged (hp > 80): #444444
 * - Light damage (hp 50-80): #facc15
 * - Heavy damage (hp 20-50): #dc2626
 * - Critical damage (hp 1-20 or fallingOff): pulsing #ff4444 / #991b1b
 * - Destroyed (hp <= 0): #090d16
 */
export function resolveIntegritySymbolColor(
  marker: Pick<CriticalModuleSymbolMarker, 'hp' | 'fallingOff'>,
  pulsePhase: boolean,
): string {
  return resolveSilhouetteCellColor(
    {
      vx: 0,
      vz: 0,
      highestVy: 0,
      voxelKey: 0,
      damageValue: marker.hp / 100,
      hp: marker.hp,
      fallingOff: marker.fallingOff,
      impactGradient: 0,
    },
    pulsePhase,
  );
}

/**
 * Draws a distinct vector symbol for a critical module on the 2D canvas using the unified HP color system.
 */
function drawCriticalModuleCanvasSymbol(
  ctx: CanvasRenderingContext2D,
  category: CriticalModuleCategory,
  cx: number,
  cy: number,
  radius: number,
  fillColor: string,
  hp: number,
): void {
  const r = Math.max(3.5, Math.min(7, radius));
  const strokeColor =
    hp <= 0
      ? '#dc2626'
      : hp <= 50
        ? '#e5e5e5'
        : hp <= 80
          ? '#1a1a1a'
          : '#fbbf24';

  ctx.save();
  ctx.lineWidth = 1.35;
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;

  if (category === 'SEAT') {
    // Diamond Pilot Cockpit Helm (◆)
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.15);
    ctx.lineTo(cx + r * 1.1, cy);
    ctx.lineTo(cx, cy + r * 1.15);
    ctx.lineTo(cx - r * 1.1, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Inner pilot dot
    ctx.fillStyle = strokeColor;
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  } else if (category === 'THRUSTER') {
    // Upward Thrust Chevron / Flame Triangle (▲)
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.1);
    ctx.lineTo(cx + r, cy + r * 0.95);
    ctx.lineTo(cx, cy + r * 0.45);
    ctx.lineTo(cx - r, cy + r * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (category === 'ENGINE') {
    // Mechanical Engine Hex Block (⬡)
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 3) * i - Math.PI / 6;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (category === 'WHEEL') {
    // Tire Ring + Axle Hub (◎)
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.2, r * 0.35), 0, Math.PI * 2);
    ctx.fill();
  } else if (category === 'WEAPON') {
    // Target Crosshair Reticle (⊕)
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.2, cy);
    ctx.lineTo(cx + r * 1.2, cy);
    ctx.moveTo(cx, cy - r * 1.2);
    ctx.lineTo(cx, cy + r * 1.2);
    ctx.stroke();
  } else if (category === 'ECU') {
    // Logic Microchip Square (▣)
    const s = r * 1.6;
    ctx.fillRect(cx - s * 0.5, cy - s * 0.5, s, s);
    ctx.strokeRect(cx - s * 0.5, cy - s * 0.5, s, s);
    ctx.fillStyle = strokeColor;
    ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  }

  // If destroyed (hp <= 0), overlay a crisp red X slash so players see the broken part immediately
  if (hp <= 0) {
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
  }

  ctx.restore();
}

export interface VehicleIntegrityDiagramProps {
  vehicle: IntegrityDiagramVehicleSource | null;
  vehicleName: string;
  enabled?: boolean;
  onClose?: () => void;
  timerPct?: number;
  compactMobile?: boolean;
}

interface SubsystemSummaryItem {
  category: CriticalModuleCategory;
  symbolCode: string;
  shortTag: string;
  intactCount: number;
  totalCount: number;
  avgHp: number;
  color: string;
}

/**
 * Step 2.8: Enhanced Vehicle Integrity Diagram UI.
 * Renders a top-down projected damage silhouette canvas at 5 Hz (every 200ms)
 * overlaid with special symbols for Seats (◆), Thrusters (▲), Engines (⬡), Wheels (◎), Weapons (⊕), and ECU (▣)
 * using the unified HP color system (#444444 intact, #facc15 light, #dc2626 heavy, #ff4444 critical, #090d16 destroyed).
 */
export const VehicleIntegrityDiagram: React.FC<VehicleIntegrityDiagramProps> = ({
  vehicle,
  vehicleName,
  enabled = PHYSICS_CONFIG.integrityDiagram.defaultEnabled,
  onClose,
  timerPct,
  compactMobile = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pulseTickRef = useRef(false);
  const [subsystems, setSubsystems] = useState<SubsystemSummaryItem[]>([]);
  const [overallHullPct, setOverallHullPct] = useState<number>(100);

  const width = compactMobile ? 54 : 74;
  const height = compactMobile ? 42 : 58;

  useEffect(() => {
    if (!enabled) return;

    const renderDiagram = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      pulseTickRef.current = !pulseTickRef.current;
      ctx.clearRect(0, 0, width, height);

      // Industrial dark telemetry screen background + subtle coordinate grid
      ctx.fillStyle = '#101215';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#1b1f25';
      ctx.lineWidth = 1;
      for (let gx = 10; gx < width; gx += 10) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
        ctx.stroke();
      }
      for (let gy = 10; gy < height; gy += 10) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
        ctx.stroke();
      }

      if (!vehicle) return;

      const grid = computeVehicleTopDownSilhouette(vehicle);
      const markers = extractVehicleCriticalModuleMarkers(vehicle);

      const padX = 4;
      const padTop = 3;
      const padBottom = 3;
      const availW = width - padX * 2;
      const availH = height - padTop - padBottom;

      const cellSize = Math.max(
        1.5,
        Math.min(
          availW / Math.max(1, grid.cols),
          availH / Math.max(1, grid.rows),
        ),
      );

      const drawW = grid.cols * cellSize;
      const drawH = grid.rows * cellSize;
      const offsetX = Math.floor((width - drawW) * 0.5);
      const offsetY = padTop + Math.floor((availH - drawH) * 0.5);

      let sumHp = 0;
      let cellCount = 0;

      // 1. Draw voxel silhouette cells
      for (let r = 0; r < grid.rows; r++) {
        // Flip Z so +Z (front of vehicle) points toward top of diagram
        const drawRow = grid.rows - 1 - r;
        for (let c = 0; c < grid.cols; c++) {
          const cell = grid.cells[r][c];
          if (!cell) continue;

          sumHp += cell.hp;
          cellCount++;

          const x = offsetX + c * cellSize;
          const y = offsetY + drawRow * cellSize;

          ctx.fillStyle = resolveSilhouetteCellColor(cell, pulseTickRef.current);
          ctx.fillRect(
            x,
            y,
            Math.max(1, cellSize - 0.5),
            Math.max(1, cellSize - 0.5),
          );
        }
      }

      // 2. Draw special symbols for critical modules on top of the silhouette
      const symbolPriority: Record<CriticalModuleCategory, number> = {
        WHEEL: 1,
        THRUSTER: 2,
        ENGINE: 3,
        WEAPON: 4,
        ECU: 5,
        SEAT: 6,
      };
      const sortedMarkers = [...markers].sort(
        (a, b) => symbolPriority[a.category] - symbolPriority[b.category],
      );

      const symbolRadius = Math.max(2.6, Math.min(4.8, cellSize * 0.92));
      for (let i = 0; i < sortedMarkers.length; i++) {
        const m = sortedMarkers[i];
        const col = m.vx - grid.minVX;
        const row = m.vz - grid.minVZ;
        const drawRow = grid.rows - 1 - row;
        const cx = offsetX + (col + 0.5) * cellSize;
        const cy = offsetY + (drawRow + 0.5) * cellSize;
        const symColor = resolveIntegritySymbolColor(m, pulseTickRef.current);

        drawCriticalModuleCanvasSymbol(
          ctx,
          m.category,
          cx,
          cy,
          symbolRadius,
          symColor,
          m.hp,
        );
      }

      // 3. Aggregate subsystem summary badges using the exact same color system
      const order: CriticalModuleCategory[] = [
        'SEAT',
        'THRUSTER',
        'ENGINE',
        'WHEEL',
        'WEAPON',
        'ECU',
      ];
      const summary: SubsystemSummaryItem[] = [];
      for (const cat of order) {
        const group = markers.filter((m) => m.category === cat);
        if (group.length === 0) continue;
        const intactCount = group.filter((m) => m.hp > 0).length;
        const avgHp = Math.round(
          group.reduce((acc, m) => acc + m.hp, 0) / group.length,
        );
        const anyFalling = group.some((m) => m.fallingOff);
        const color = resolveIntegritySymbolColor(
          { hp: avgHp, fallingOff: anyFalling },
          pulseTickRef.current,
        );
        summary.push({
          category: cat,
          symbolCode: group[0].symbolCode,
          shortTag: group[0].shortTag,
          intactCount,
          totalCount: group.length,
          avgHp,
          color,
        });
      }
      setSubsystems(summary);
      setOverallHullPct(cellCount > 0 ? Math.round(sumHp / cellCount) : 100);
    };

    renderDiagram();
    const timer = window.setInterval(
      renderDiagram,
      PHYSICS_CONFIG.integrityDiagram.updateIntervalMs,
    );
    return () => window.clearInterval(timer);
  }, [vehicle, enabled, width, height]);

  if (!enabled) {
    return null;
  }

  const hullColor = resolveIntegritySymbolColor(
    { hp: overallHullPct, fallingOff: false },
    false,
  );

  const podSizePx = compactMobile ? 64 : 84;

  return (
    <div
      data-testid="vehicle-integrity-diagram"
      style={{
        width: `${podSizePx}px`,
        height: `${podSizePx}px`,
        clipPath:
          'polygon(14% 0%, 86% 0%, 100% 14%, 100% 86%, 86% 100%, 14% 100%, 0% 86%, 0% 14%)',
      }}
      className="bg-[#202328]/95 border-2 border-[#353a42] p-1 flex flex-col items-center justify-between pointer-events-auto relative overflow-hidden shadow-xl select-none shrink-0"
    >
      {/* Compact Header Row: HULL + % */}
      <div className="w-full flex items-center justify-between px-1 leading-none">
        <span
          data-testid="vehicle-integrity-diagram-label"
          className="text-[7px] font-mono-num font-extrabold text-[#f59e0b] uppercase truncate"
          title={vehicleName}
        >
          HULL
        </span>
        <span
          className="px-1 py-0.2 rounded-[1px] text-[7.5px] font-mono-num font-black uppercase leading-none"
          style={{
            backgroundColor: hullColor,
            color: overallHullPct > 50 && overallHullPct <= 80 ? '#141414' : '#ffffff',
          }}
        >
          {overallHullPct}%
        </span>
        {onClose && (
          <button
            type="button"
            data-testid="close-integrity-diagram-btn"
            onClick={onClose}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            title="Dismiss damage diagram"
            className="w-3.5 h-3.5 flex items-center justify-center bg-[#262626] hover:bg-[#dc2626] text-[#e5e5e5] rounded-[1px] text-[8px] font-bold leading-none cursor-pointer touch-manipulation"
          >
            ×
          </button>
        )}
      </div>

      {/* Top-Down Silhouette + Critical Module Symbols Canvas */}
      <canvas
        ref={canvasRef}
        data-testid="vehicle-integrity-diagram-canvas"
        width={width}
        height={height}
        className="rounded-[2px] border border-[#353a42] block"
      />

      {/* Micro Subsystem Status Pips Row (zero text bloat) */}
      {subsystems.length > 0 && (
        <div
          data-testid="vehicle-integrity-symbols-legend"
          className="w-full flex items-center justify-center gap-0.5 px-0.5"
        >
          {subsystems.slice(0, 6).map((sub) => (
            <div
              key={sub.category}
              data-testid={`integrity-symbol-badge-${sub.category}`}
              title={`${sub.shortTag}: ${sub.intactCount}/${sub.totalCount} (${sub.avgHp}% HP)`}
              className="h-1.5 flex-1 rounded-[1px] border border-[#111316]"
              style={{ backgroundColor: sub.color }}
            />
          ))}
        </div>
      )}

      {typeof timerPct === 'number' && (
        <div className="w-full h-0.5 bg-[#262626] overflow-hidden">
          <div
            data-testid="integrity-toast-timer-bar"
            className="h-full bg-[#fbbf24]"
            style={{ width: `${Math.max(0, Math.min(100, timerPct))}%` }}
          />
        </div>
      )}
    </div>
  );
};
