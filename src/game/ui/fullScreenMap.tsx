import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { MULTIPLAYER_BADGE_COLORS } from '../multiplayer';
import { isWaterBasinArea, type MicroVoxelWorld } from '../world';
import type { ModularVehicleRig } from '../vehicle';
import type { TeleportNode } from '../gameModesEngine';
import {
  isMobileDevice,
  computeTacticalMapRenderRadiusChunks,
} from '../touchControls';

export type WaypointIconKind =
  | 'FLAG'
  | 'TARGET'
  | 'WRENCH'
  | 'HAZARD'
  | 'STAR'
  | 'ANCHOR'
  | 'RUNWAY'
  | 'CONSTRUCTION';

export interface CustomMapWaypoint {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  color: string;
  icon: WaypointIconKind;
  isConstructionMarker?: boolean;
  createdAt: number;
}

export interface MapExplosionCraterMarker {
  id: string;
  x: number;
  y: number;
  z: number;
  radiusMeters: number;
  label: string;
  timestamp: number;
}

export interface MapRoutePoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface MapNavigationMetrics {
  distance2DMeters: number;
  distance3DMeters: number;
  elevationDeltaMeters: number;
  slopeDegrees: number;
  bearingDegrees: number;
  cardinalDirection: string;
}

export interface MultiRouteLegSummary {
  fromIndex: number;
  toIndex: number;
  distance2DMeters: number;
  distance3DMeters: number;
  elevationDeltaMeters: number;
  bearingDegrees: number;
}

export interface MultiRouteSummary {
  legs: MultiRouteLegSummary[];
  totalDistance2DMeters: number;
  totalDistance3DMeters: number;
  netElevationDeltaMeters: number;
  totalClimbMeters: number;
  totalDescentMeters: number;
}

export type MapBiomeId =
  | 'PROVING_GROUNDS'
  | 'RED_ROCK_CANYON'
  | 'ALPINE_RIDGE'
  | 'EMERALD_FOREST'
  | 'COASTAL_BASIN';

export interface SampledMapTerrainPoint {
  elevationMeters: number;
  waterDepthMeters: number;
  isWater: boolean;
  isRiver: boolean;
  biome: MapBiomeId;
  hasForestCanopy: boolean;
  isRoad: boolean;
  isBridge: boolean;
  isTunnel: boolean;
}

export type MapInteractionTool =
  | 'PAN_SELECT'
  | 'ADD_WAYPOINT'
  | 'ADD_CONSTRUCTION'
  | 'LOG_CRATER'
  | 'RULER_AB'
  | 'DRAW_ROUTE';

export interface MapLayerVisibility {
  terrainLabels: boolean;
  waterDepth: boolean;
  roadsBridgesTunnels: boolean;
  vehiclesAndTrails: boolean;
  engineeringFeatures: boolean;
  navigationAndGrid: boolean;
}

export const WAYPOINT_COLOR_PALETTE: ReadonlyArray<{ label: string; hex: string }> = [
  { label: 'Hazard Yellow', hex: '#facc15' },
  { label: 'Radar Cyan', hex: '#38bdf8' },
  { label: 'Tactical Green', hex: '#22c55e' },
  { label: 'Target Red', hex: '#ef4444' },
  { label: 'Beacon Orange', hex: '#f97316' },
  { label: 'Blueprint Violet', hex: '#a855f7' },
  { label: 'Signal Pink', hex: '#ec4899' },
  { label: 'Pure White', hex: '#f8fafc' },
];

export const WAYPOINT_ICON_OPTIONS: ReadonlyArray<{
  id: WaypointIconKind;
  label: string;
  shortGlyph: string;
}> = [
  { id: 'FLAG', label: 'Flag', shortGlyph: '⚑' },
  { id: 'TARGET', label: 'Target', shortGlyph: '⊕' },
  { id: 'WRENCH', label: 'Repair', shortGlyph: '⬡' },
  { id: 'HAZARD', label: 'Hazard', shortGlyph: '▲' },
  { id: 'STAR', label: 'Landmark', shortGlyph: '★' },
  { id: 'ANCHOR', label: 'Marine', shortGlyph: '⚓' },
  { id: 'RUNWAY', label: 'Airfield', shortGlyph: '✈' },
  { id: 'CONSTRUCTION', label: 'Build Site', shortGlyph: '▣' },
];

const CUSTOM_WAYPOINTS_STORAGE_KEY = 'voxel_tactical_map_waypoints_v1';

const DEFAULT_CUSTOM_WAYPOINTS: CustomMapWaypoint[] = [
  {
    id: 'wp-airstrip-alpha',
    name: 'East Runway Threshold',
    x: 95,
    y: 4.5,
    z: -68,
    color: '#38bdf8',
    icon: 'RUNWAY',
    createdAt: 1,
  },
  {
    id: 'wp-canyon-outpost',
    name: 'Red-Rock Canyon Overlook',
    x: 112,
    y: 28.0,
    z: -115,
    color: '#f97316',
    icon: 'STAR',
    createdAt: 2,
  },
  {
    id: 'wp-hydro-dock',
    name: 'Deep Water Testing Pier',
    x: -98,
    y: 0.0,
    z: 84,
    color: '#22c55e',
    icon: 'ANCHOR',
    createdAt: 3,
  },
  {
    id: 'wp-bridge-site',
    name: 'North Gorge Construction Site',
    x: -44,
    y: 12.0,
    z: -92,
    color: '#facc15',
    icon: 'CONSTRUCTION',
    isConstructionMarker: true,
    createdAt: 4,
  },
];

export function loadCustomWaypoints(): CustomMapWaypoint[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [...DEFAULT_CUSTOM_WAYPOINTS];
  }
  try {
    const raw = window.localStorage.getItem(CUSTOM_WAYPOINTS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_CUSTOM_WAYPOINTS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_CUSTOM_WAYPOINTS];
    return parsed.filter(
      (item): item is CustomMapWaypoint =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.x === 'number' &&
        typeof item.z === 'number',
    );
  } catch {
    return [...DEFAULT_CUSTOM_WAYPOINTS];
  }
}

export function saveCustomWaypoints(waypoints: CustomMapWaypoint[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CUSTOM_WAYPOINTS_STORAGE_KEY, JSON.stringify(waypoints));
  } catch {
    // Ignore storage quota
  }
}

export function sampleTacticalMapTerrain(
  wx: number,
  wz: number,
  genMode: MicroVoxelWorld['worldGenMode'] = 'DEFAULT_PARK',
): SampledMapTerrainPoint {
  const distOrigin = Math.hypot(wx, wz);

  const riverCenterX = -78 + Math.sin(wz * 0.024) * 28 - wz * 0.12;
  const distToRiver = Math.abs(wx - riverCenterX);
  const isRiver = distToRiver < 11.5 && wz > -175 && wz < 135;

  const inBasinWater = isWaterBasinArea(wx, wz, genMode);
  const isLake = Math.hypot(wx + 125, wz - 95) < 58 || Math.hypot(wx - 135, wz + 115) < 42;
  const isWater = inBasinWater || isRiver || isLake;

  const isRiverBridge =
    distToRiver < 13.5 && (Math.abs(wz - 0) < 6.5 || Math.abs(wz + 76) < 6.5);
  const isCanyonBridge =
    Math.abs(wx - 78) < 18 && Math.abs(wz + 42) < 5.5;
  const isBridge = isRiverBridge || isCanyonBridge;

  const isTunnel =
    (Math.abs(wz + 132) < 6 && wx >= -35 && wx <= 48) ||
    (Math.abs(wx - 148) < 6 && wz >= -125 && wz <= -52);

  const onRingRoad = Math.abs(distOrigin - 54) < 4.5;
  const onEWArterial = Math.abs(wz) < 4.2 && wx > -185 && wx < 185;
  const onNSArterial = Math.abs(wx) < 4.2 && wz > -185 && wz < 185;
  const onTestOval =
    Math.abs(Math.hypot((wx - 118) * 0.75, wz - 72) - 36) < 4.8;
  const isRoad =
    !isWater || isBridge
      ? onRingRoad || onEWArterial || onNSArterial || onTestOval || isBridge
      : false;

  let biome: MapBiomeId = 'EMERALD_FOREST';
  if (isWater && !isBridge) {
    biome = 'COASTAL_BASIN';
  } else if (distOrigin < 64) {
    biome = 'PROVING_GROUNDS';
  } else if (wx > 38 && wz < -18) {
    biome = 'RED_ROCK_CANYON';
  } else if (wz < -78 || (wx < -70 && wz < -35)) {
    biome = 'ALPINE_RIDGE';
  } else if (wx < -45 && wz > 35) {
    biome = 'COASTAL_BASIN';
  }

  let elevationMeters = 0;
  let waterDepthMeters = 0;

  if (isWater && !isBridge) {
    const basinDist = Math.min(
      distToRiver,
      Math.hypot(wx + 125, wz - 95) * 0.35,
      Math.hypot(wx - 135, wz + 115) * 0.4,
    );
    waterDepthMeters = Math.max(
      1.2,
      Math.min(24.0, 3.5 + (14 - Math.min(14, basinDist)) * 1.15 + Math.sin(wx * 0.05 + wz * 0.05) * 2.2),
    );
    elevationMeters = -Number(waterDepthMeters.toFixed(1));
  } else if (distOrigin < 48) {
    elevationMeters = 2.0;
  } else {
    const ridgeWave =
      Math.sin(wx * 0.028) * Math.cos(wz * 0.028) * 14 +
      Math.sin((wx - wz) * 0.015) * 11;
    if (biome === 'ALPINE_RIDGE') {
      elevationMeters = Math.max(8, 22 + ridgeWave * 1.45 + Math.abs(wz + 70) * 0.16);
    } else if (biome === 'RED_ROCK_CANYON') {
      const rawMesa = 16 + ridgeWave * 1.15;
      elevationMeters = Math.round(rawMesa / 6) * 6;
    } else {
      elevationMeters = Math.max(1.5, 5.5 + ridgeWave * 0.55);
    }
    if (isBridge) {
      elevationMeters = Math.max(elevationMeters, 9.5);
    }
  }

  const canopyHash = Math.sin(wx * 0.19 + wz * 0.23) * Math.cos(wx * 0.13 - wz * 0.17);
  const hasForestCanopy =
    !isWater &&
    !isRoad &&
    (biome === 'EMERALD_FOREST' || (biome === 'ALPINE_RIDGE' && elevationMeters < 28)) &&
    canopyHash > 0.48;

  return {
    elevationMeters: Number(elevationMeters.toFixed(1)),
    waterDepthMeters: Number(waterDepthMeters.toFixed(1)),
    isWater,
    isRiver,
    biome,
    hasForestCanopy,
    isRoad,
    isBridge,
    isTunnel,
  };
}

export function formatCompassCardinal(bearingDeg: number): string {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx];
}

export function computeNavigationMetrics(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): MapNavigationMetrics {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist2D = Math.hypot(dx, dz);
  const dist3D = Math.hypot(dx, dy, dz);
  const rawBearingRad = Math.atan2(dx, -dz);
  const bearingDegrees = Number((((rawBearingRad * 180) / Math.PI + 360) % 360).toFixed(1));
  const slopeDegrees =
    dist2D > 0.001 ? Number(((Math.atan2(dy, dist2D) * 180) / Math.PI).toFixed(1)) : 0;

  return {
    distance2DMeters: Number(dist2D.toFixed(1)),
    distance3DMeters: Number(dist3D.toFixed(1)),
    elevationDeltaMeters: Number(dy.toFixed(1)),
    slopeDegrees,
    bearingDegrees,
    cardinalDirection: formatCompassCardinal(bearingDegrees),
  };
}

export function computeMultiRouteSummary(points: ReadonlyArray<MapRoutePoint>): MultiRouteSummary {
  const legs: MultiRouteLegSummary[] = [];
  let total2D = 0;
  let total3D = 0;
  let totalClimb = 0;
  let totalDescent = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const metrics = computeNavigationMetrics(a, b);
    legs.push({
      fromIndex: i,
      toIndex: i + 1,
      distance2DMeters: metrics.distance2DMeters,
      distance3DMeters: metrics.distance3DMeters,
      elevationDeltaMeters: metrics.elevationDeltaMeters,
      bearingDegrees: metrics.bearingDegrees,
    });
    total2D += metrics.distance2DMeters;
    total3D += metrics.distance3DMeters;
    if (metrics.elevationDeltaMeters > 0) {
      totalClimb += metrics.elevationDeltaMeters;
    } else {
      totalDescent += Math.abs(metrics.elevationDeltaMeters);
    }
  }

  const netElevationDelta =
    points.length >= 2 ? Number((points[points.length - 1].y - points[0].y).toFixed(1)) : 0;

  return {
    legs,
    totalDistance2DMeters: Number(total2D.toFixed(1)),
    totalDistance3DMeters: Number(total3D.toFixed(1)),
    netElevationDeltaMeters: netElevationDelta,
    totalClimbMeters: Number(totalClimb.toFixed(1)),
    totalDescentMeters: Number(totalDescent.toFixed(1)),
  };
}

export function appendVehicleTrailPoint(
  existingTrail: ReadonlyArray<{ x: number; y: number; z: number }>,
  nextPos: { x: number; y: number; z: number },
  maxPoints = 48,
  minStepMeters = 1.8,
): Array<{ x: number; y: number; z: number }> {
  if (existingTrail.length > 0) {
    const last = existingTrail[existingTrail.length - 1];
    if (Math.hypot(nextPos.x - last.x, nextPos.z - last.z) < minStepMeters) {
      return [...existingTrail];
    }
  }
  const updated = [
    ...existingTrail,
    {
      x: Number(nextPos.x.toFixed(2)),
      y: Number(nextPos.y.toFixed(2)),
      z: Number(nextPos.z.toFixed(2)),
    },
  ];
  if (updated.length > maxPoints) {
    return updated.slice(updated.length - maxPoints);
  }
  return updated;
}

export interface FullScreenMapPlayerEntry {
  peerId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  yawRad: number;
  isLocal: boolean;
  isSeatedInVehicle: boolean;
  seatedVehicleId?: string | null;
}

export interface FullScreenMapProps {
  isOpen: boolean;
  onClose: () => void;
  world: MicroVoxelWorld | null;
  vehicles: ModularVehicleRig[];
  localVehicle: ModularVehicleRig | null;
  isSeatedInRig: boolean;
  localPlayerPos: { x: number; y: number; z: number };
  localPlayerYawRad: number;
  localPlayerName: string;
  localPlayerColor: string;
  remotePlayers: Array<{
    peerId: string;
    name: string;
    color: string;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    isDriving?: boolean;
    vehicleId?: string | null;
  }>;
  camera: THREE.PerspectiveCamera | null;
  tacticalCamState?: {
    x: number;
    z: number;
    altitude: number;
    isTopDown: boolean;
  };
  tacticalGridVisible?: boolean;
  onToggleGrid?: () => void;
  onPanTacticalMap?: (dxMeters: number, dzMeters: number) => void;
  onZoomTacticalMap?: (factor: number) => void;
  onSetTacticalMapAltitude?: (alt: number) => void;
  onSetTacticalMapTopDown?: (topDown: boolean) => void;
  onCenterTacticalMapOnPlayer?: () => void;
  onFocusTacticalMapOn?: (wx: number, wz: number) => void;
  teleportNodes?: TeleportNode[];
  teleportState?: unknown;
  maxTeleportNodes?: number;
  newBeaconNameInput?: string;
  onChangeBeaconNameInput?: (val: string) => void;
  onPlaceBeaconAtCoords?: (x: number, z: number, customLabel?: string) => void;
  onPlaceBeaconAtPlayer?: (customLabel?: string) => void;
  combatCooldownSec?: number;
  activeSpinupNodeId?: string | null;
  spinupProgress?: number;
  onTeleportToNode?: (nodeId: string) => void;
  onDeleteTeleportNode?: (nodeId: string) => void;
  onDropBeaconHere?: (name: string) => void;
  onRemoveBeacon?: (nodeId: string) => void;
}

const _projV3 = new THREE.Vector3();
const _fwdTmp = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _mouseNDCTmp = new THREE.Vector2();

function projectWorldToScreen(
  camera: THREE.Camera,
  wx: number,
  wy: number,
  wz: number,
  w: number,
  h: number,
): { sx: number; sy: number; visible: boolean } {
  _projV3.set(wx, wy, wz);
  _projV3.project(camera);
  const visible = _projV3.z < 1.0;
  const sx = (_projV3.x * 0.5 + 0.5) * w;
  const sy = (-_projV3.y * 0.5 + 0.5) * h;
  return { sx, sy, visible };
}

function drawWaypointSymbol(
  ctx: CanvasRenderingContext2D,
  icon: WaypointIconKind,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(-size * 0.7 + 2, -size * 0.7 + 2, size * 1.4, size * 1.4);

  ctx.fillStyle = '#18181b';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.fillRect(-size * 0.7, -size * 0.7, size * 1.4, size * 1.4);
  ctx.strokeRect(-size * 0.7, -size * 0.7, size * 1.4, size * 1.4);

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;

  switch (icon) {
    case 'FLAG': {
      ctx.beginPath();
      ctx.moveTo(-size * 0.3, size * 0.45);
      ctx.lineTo(-size * 0.3, -size * 0.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size * 0.3, -size * 0.45);
      ctx.lineTo(size * 0.45, -size * 0.2);
      ctx.lineTo(-size * 0.3, 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'TARGET': {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size * 0.52, 0);
      ctx.lineTo(size * 0.52, 0);
      ctx.moveTo(0, -size * 0.52);
      ctx.lineTo(0, size * 0.52);
      ctx.stroke();
      break;
    }
    case 'WRENCH': {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const rx = Math.cos(a) * size * 0.42;
        const ry = Math.sin(a) * size * 0.42;
        if (i === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'HAZARD': {
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.46);
      ctx.lineTo(size * 0.46, size * 0.42);
      ctx.lineTo(-size * 0.46, size * 0.42);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(-1, -size * 0.14, 2, size * 0.28);
      break;
    }
    case 'STAR': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? size * 0.46 : size * 0.2;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const sx = Math.cos(a) * r;
        const sy = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'ANCHOR': {
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.4);
      ctx.lineTo(0, size * 0.38);
      ctx.moveTo(-size * 0.35, -size * 0.12);
      ctx.lineTo(size * 0.35, -size * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.38, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    }
    case 'RUNWAY': {
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.45);
      ctx.lineTo(size * 0.42, size * 0.15);
      ctx.lineTo(0, 0);
      ctx.lineTo(-size * 0.42, size * 0.15);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'CONSTRUCTION': {
      ctx.strokeRect(-size * 0.38, -size * 0.38, size * 0.76, size * 0.76);
      ctx.beginPath();
      ctx.moveTo(-size * 0.38, -size * 0.38);
      ctx.lineTo(size * 0.38, size * 0.38);
      ctx.moveTo(size * 0.38, -size * 0.38);
      ctx.lineTo(-size * 0.38, size * 0.38);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

export const FullScreenMap: React.FC<FullScreenMapProps> = ({
  isOpen,
  onClose,
  world,
  vehicles,
  localVehicle,
  isSeatedInRig,
  localPlayerPos,
  localPlayerYawRad,
  localPlayerName,
  localPlayerColor,
  remotePlayers,
  camera,
  tacticalCamState,
  tacticalGridVisible,
  onToggleGrid,
  onPanTacticalMap,
  onZoomTacticalMap,
  onSetTacticalMapAltitude,
  onSetTacticalMapTopDown,
  onCenterTacticalMapOnPlayer,
  onFocusTacticalMapOn,
  teleportNodes = [],
  combatCooldownSec = 0,
  activeSpinupNodeId = null,
  spinupProgress = 0,
  onTeleportToNode,
  onDeleteTeleportNode,
  onPlaceBeaconAtPlayer,
  onDropBeaconHere,
  onRemoveBeacon,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridHeightCacheRef = useRef<Map<string, number>>(new Map());
  const touchPinchDistRef = useRef<number | null>(null);
  const lastCursorUpdateMsRef = useRef<number>(0);

  const [isMobileMap, setIsMobileMap] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isMobileDevice() || window.innerWidth < 900 || window.innerHeight < 540;
  });
  const isMobileMapRef = useRef<boolean>(isMobileMap);
  isMobileMapRef.current = isMobileMap;
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);

  useEffect(() => {
    const updateMobileMapMode = () => {
      if (typeof window === 'undefined') return;
      const compact =
        isMobileDevice() || window.innerWidth < 900 || window.innerHeight < 540;
      setIsMobileMap(compact);
    };
    window.addEventListener('resize', updateMobileMapMode);
    window.addEventListener('voxelmakers-touch-mode-change', updateMobileMapMode);
    return () => {
      window.removeEventListener('resize', updateMobileMapMode);
      window.removeEventListener('voxelmakers-touch-mode-change', updateMobileMapMode);
    };
  }, []);

  // Active interaction tool
  const [activeTool, setActiveTool] = useState<MapInteractionTool>('PAN_SELECT');
  const activeToolRef = useRef<MapInteractionTool>('PAN_SELECT');
  activeToolRef.current = activeTool;

  // Layer visibility toggles (minimal on mobile by default so the 2.5D terrain stays clean)
  const [layers, setLayers] = useState<MapLayerVisibility>(() => {
    const compact =
      typeof window !== 'undefined' &&
      (isMobileDevice() || window.innerWidth < 900 || window.innerHeight < 540);
    return {
      terrainLabels: !compact,
      waterDepth: false,
      roadsBridgesTunnels: false,
      vehiclesAndTrails: true,
      engineeringFeatures: !compact,
      navigationAndGrid: true,
    };
  });
  const layersRef = useRef<MapLayerVisibility>(layers);
  layersRef.current = layers;

  // Custom Waypoints state (persisted)
  const [customWaypoints, setCustomWaypoints] = useState<CustomMapWaypoint[]>(() =>
    loadCustomWaypoints(),
  );
  const customWaypointsRef = useRef<CustomMapWaypoint[]>(customWaypoints);
  customWaypointsRef.current = customWaypoints;

  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(
    () => customWaypoints[0]?.id ?? null,
  );
  const selectedWaypointIdRef = useRef<string | null>(selectedWaypointId);
  selectedWaypointIdRef.current = selectedWaypointId;

  // Waypoint creation / editing draft fields
  const [wpDraftName, setWpDraftName] = useState<string>('Tactical Marker');
  const [wpDraftColor, setWpDraftColor] = useState<string>('#facc15');
  const [wpDraftIcon, setWpDraftIcon] = useState<WaypointIconKind>('FLAG');

  // Explosion / Crater markers
  const [craterMarkers, setCraterMarkers] = useState<MapExplosionCraterMarker[]>([
    {
      id: 'crater-c4-east',
      x: 58,
      y: -1.5,
      z: 22,
      radiusMeters: 14,
      label: 'C4 Blast Crater #1',
      timestamp: 1,
    },
    {
      id: 'crater-ordnance-north',
      x: -28,
      y: 3.0,
      z: -56,
      radiusMeters: 18,
      label: 'Artillery Impact Zone',
      timestamp: 2,
    },
  ]);
  const craterMarkersRef = useRef<MapExplosionCraterMarker[]>(craterMarkers);
  craterMarkersRef.current = craterMarkers;

  // Distance Measurement Tool (Ruler A -> B)
  const [rulerPointA, setRulerPointA] = useState<{ x: number; y: number; z: number } | null>(null);
  const [rulerPointB, setRulerPointB] = useState<{ x: number; y: number; z: number } | null>(null);
  const rulerRef = useRef<{
    a: { x: number; y: number; z: number } | null;
    b: { x: number; y: number; z: number } | null;
  }>({ a: null, b: null });
  rulerRef.current = { a: rulerPointA, b: rulerPointB };

  // Multi-point Route Drawing Tool
  const [routePoints, setRoutePoints] = useState<MapRoutePoint[]>([
    { id: 'rt-1', label: 'Start Pad', x: 0, y: 2.0, z: 0 },
    { id: 'rt-2', label: 'Bridge Checkpoint', x: -64, y: 9.5, z: 0 },
    { id: 'rt-3', label: 'Hydro Basin', x: -98, y: 0.0, z: 84 },
  ]);
  const routePointsRef = useRef<MapRoutePoint[]>(routePoints);
  routePointsRef.current = routePoints;

  // Bounded vehicle history trails (ring buffer per vehicleId)
  const vehicleTrailsRef = useRef<Map<string, Array<{ x: number; y: number; z: number }>>>(
    new Map(),
  );

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState<
    'WAYPOINTS' | 'ROUTE_RULER' | 'LEGEND_LAYERS' | 'FAST_TRAVEL'
  >('WAYPOINTS');

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number }>({ clientX: 0, clientY: 0 });
  const hasDraggedRef = useRef(false);

  const [cursorWorldCoords, setCursorWorldCoords] = useState<{
    x: number;
    y: number;
    z: number;
    biome: MapBiomeId;
    waterDepth: number;
  } | null>(null);
  const [beaconNameInput, setBeaconNameInput] = useState('Forward Outpost');

  // Persist waypoints
  useEffect(() => {
    saveCustomWaypoints(customWaypoints);
  }, [customWaypoints]);

  const selectedWaypoint = useMemo(
    () => customWaypoints.find((w) => w.id === selectedWaypointId) ?? null,
    [customWaypoints, selectedWaypointId],
  );

  useEffect(() => {
    if (selectedWaypoint) {
      setWpDraftName(selectedWaypoint.name);
      setWpDraftColor(selectedWaypoint.color);
      setWpDraftIcon(selectedWaypoint.icon);
    }
  }, [selectedWaypoint]);

  // Record vehicle trails
  useEffect(() => {
    if (!vehicles || vehicles.length === 0) return;
    const map = vehicleTrailsRef.current;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const vid = v.vehicleId || `veh_${i}`;
      const prev = map.get(vid) ?? [];
      const next = appendVehicleTrailPoint(prev, {
        x: v.position.x,
        y: v.position.y,
        z: v.position.z,
      });
      if (next !== prev) {
        map.set(vid, next);
      }
    }
  }, [vehicles, localPlayerPos.x, localPlayerPos.z]);

  const activeWaypointMetrics = useMemo(() => {
    if (!selectedWaypoint) return null;
    return computeNavigationMetrics(localPlayerPos, selectedWaypoint);
  }, [localPlayerPos, selectedWaypoint]);

  const rulerMetrics = useMemo(() => {
    if (!rulerPointA || !rulerPointB) return null;
    return computeNavigationMetrics(rulerPointA, rulerPointB);
  }, [rulerPointA, rulerPointB]);

  const routeSummary = useMemo(() => computeMultiRouteSummary(routePoints), [routePoints]);

  const playerCompassDeg = useMemo(() => {
    let dirX = -Math.sin(localPlayerYawRad);
    let dirZ = -Math.cos(localPlayerYawRad);
    if (isSeatedInRig && localVehicle) {
      _fwdTmp.set(0, 0, 1).applyQuaternion(localVehicle.quaternion);
      dirX = _fwdTmp.x;
      dirZ = _fwdTmp.z;
    }
    const raw = (Math.atan2(dirX, -dirZ) * 180) / Math.PI;
    return Math.round((raw + 360) % 360);
  }, [isSeatedInRig, localPlayerYawRad, localVehicle]);

  // Raycast from screen mouse coords onto real 3D terrain
  const raycastScreenToTerrain = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !camera || !world) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const u = ((clientX - rect.left) / rect.width) * 2 - 1;
      const v = -(((clientY - rect.top) / rect.height) * 2 - 1);

      _mouseNDCTmp.set(u, v);
      _raycaster.setFromCamera(_mouseNDCTmp, camera);
      const ray = _raycaster.ray;

      // Fast O(1) non-allocating surface height probe (never creates 512KB chunks!)
      const sampleH = (wx: number, wz: number): number => {
        if (typeof (world as any).sampleSurfaceHeightFast === 'function') {
          return (world as any).sampleSurfaceHeightFast(wx, wz);
        }
        return world.probeGroundBelow(wx, 80, wz, 0.4).y;
      };

      const denom = Math.max(0.001, -ray.direction.y);
      let t = (camera.position.y - 0) / denom;
      let hitX = ray.origin.x + ray.direction.x * t;
      let hitZ = ray.origin.z + ray.direction.z * t;

      const y1 = sampleH(hitX, hitZ);
      t = (camera.position.y - y1) / denom;
      hitX = ray.origin.x + ray.direction.x * t;
      hitZ = ray.origin.z + ray.direction.z * t;
      const finalY = sampleH(hitX, hitZ);

      const genMode = world.worldGenMode || 'DEFAULT_PARK';
      const terrain = sampleTacticalMapTerrain(hitX, hitZ, genMode);

      return {
        x: Number(hitX.toFixed(1)),
        y: Number(finalY.toFixed(1)),
        z: Number(hitZ.toFixed(1)),
        terrain,
      };
    },
    [camera, world],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const factor = e.deltaY < 0 ? 0.82 : 1.22;
      onZoomTacticalMap?.(factor);
    },
    [onZoomTacticalMap],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.clientX;
        const dy = e.clientY - dragStartRef.current.clientY;
        if (Math.hypot(dx, dy) > 4) {
          hasDraggedRef.current = true;
        }

        const canvas = canvasRef.current;
        const alt = tacticalCamState?.altitude ?? 65;
        const rectHeight = canvas?.clientHeight ?? 600;
        const metersPerPx = (alt * 1.5) / rectHeight;

        onPanTacticalMap?.(-dx * metersPerPx, -dy * metersPerPx);
        dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
        return;
      }

      const nowMs = performance.now();
      if (nowMs - lastCursorUpdateMsRef.current < 100) {
        return;
      }
      lastCursorUpdateMsRef.current = nowMs;

      const hit = raycastScreenToTerrain(e.clientX, e.clientY);
      if (hit) {
        const rx = Math.round(hit.x);
        const rz = Math.round(hit.z);
        setCursorWorldCoords((prev) => {
          if (prev && prev.x === rx && prev.z === rz) return prev;
          return {
            x: rx,
            y: hit.y,
            z: rz,
            biome: hit.terrain.biome,
            waterDepth: hit.terrain.waterDepthMeters,
          };
        });
      }
    },
    [onPanTacticalMap, raycastScreenToTerrain, tacticalCamState?.altitude],
  );

  const executeMapPointClick = useCallback(
    (clientX: number, clientY: number) => {
      const hit = raycastScreenToTerrain(clientX, clientY);
      if (!hit) return;

      const tool = activeToolRef.current;
      if (tool === 'PAN_SELECT') {
        const pickRadiusMeters = 8.0;
        const clickedWp = customWaypointsRef.current.find(
          (w) => Math.hypot(w.x - hit.x, w.z - hit.z) <= pickRadiusMeters,
        );
        if (clickedWp) {
          setSelectedWaypointId(clickedWp.id);
          setSidebarTab('WAYPOINTS');
        }
        return;
      }

      if (tool === 'ADD_WAYPOINT' || tool === 'ADD_CONSTRUCTION') {
        const isConstruct = tool === 'ADD_CONSTRUCTION';
        const newWp: CustomMapWaypoint = {
          id: `wp-${Date.now()}`,
          name: isConstruct
            ? `Build Site #${customWaypointsRef.current.length + 1}`
            : wpDraftName.trim() || `Waypoint #${customWaypointsRef.current.length + 1}`,
          x: Math.round(hit.x),
          y: hit.y,
          z: Math.round(hit.z),
          color: isConstruct ? '#facc15' : wpDraftColor,
          icon: isConstruct ? 'CONSTRUCTION' : wpDraftIcon,
          isConstructionMarker: isConstruct,
          createdAt: Date.now(),
        };
        setCustomWaypoints((prev) => [...prev, newWp]);
        setSelectedWaypointId(newWp.id);
        setSidebarTab('WAYPOINTS');
        return;
      }

      if (tool === 'LOG_CRATER') {
        const newCrater: MapExplosionCraterMarker = {
          id: `crater-${Date.now()}`,
          x: Math.round(hit.x),
          y: hit.y,
          z: Math.round(hit.z),
          radiusMeters: 15,
          label: `Blast Crater (${Math.round(hit.x)}, ${Math.round(hit.z)})`,
          timestamp: Date.now(),
        };
        setCraterMarkers((prev) => [...prev, newCrater]);
        return;
      }

      if (tool === 'RULER_AB') {
        if (!rulerRef.current.a || (rulerRef.current.a && rulerRef.current.b)) {
          setRulerPointA({ x: hit.x, y: hit.y, z: hit.z });
          setRulerPointB(null);
        } else {
          setRulerPointB({ x: hit.x, y: hit.y, z: hit.z });
        }
        setSidebarTab('ROUTE_RULER');
        return;
      }

      if (tool === 'DRAW_ROUTE') {
        setRoutePoints((prev) => [
          ...prev,
          {
            id: `rt-${Date.now()}-${prev.length + 1}`,
            label: `Node ${prev.length + 1}`,
            x: Math.round(hit.x),
            y: hit.y,
            z: Math.round(hit.z),
          },
        ]);
        setSidebarTab('ROUTE_RULER');
      }
    },
    [raycastScreenToTerrain, wpDraftColor, wpDraftIcon, wpDraftName],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const wasDragging = isDraggingRef.current;
      const didDrag = hasDraggedRef.current;
      isDraggingRef.current = false;

      if (!wasDragging || didDrag || e.button !== 0) {
        return;
      }
      executeMapPointClick(e.clientX, e.clientY);
    },
    [executeMapPointClick],
  );

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchPinchDistRef.current = Math.hypot(dx, dy);
      hasDraggedRef.current = true;
      return;
    }
    if (e.touches.length === 1) {
      touchPinchDistRef.current = null;
      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = {
        clientX: e.touches[0].clientX,
        clientY: e.touches[0].clientY,
      };
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (touchPinchDistRef.current !== null && Math.abs(dist - touchPinchDistRef.current) > 4) {
          const factor = dist > touchPinchDistRef.current ? 0.94 : 1.06;
          onZoomTacticalMap?.(factor);
          touchPinchDistRef.current = dist;
        }
        hasDraggedRef.current = true;
        return;
      }
      if (e.touches.length === 1 && isDraggingRef.current) {
        const t = e.touches[0];
        const dx = t.clientX - dragStartRef.current.clientX;
        const dy = t.clientY - dragStartRef.current.clientY;
        if (Math.hypot(dx, dy) > 6) {
          hasDraggedRef.current = true;
        }
        const canvas = canvasRef.current;
        const alt = tacticalCamState?.altitude ?? 65;
        const rectHeight = canvas?.clientHeight ?? 600;
        const metersPerPx = (alt * 1.5) / rectHeight;
        onPanTacticalMap?.(-dx * metersPerPx, -dy * metersPerPx);
        dragStartRef.current = { clientX: t.clientX, clientY: t.clientY };
      }
    },
    [onPanTacticalMap, onZoomTacticalMap, tacticalCamState?.altitude],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      touchPinchDistRef.current = null;
      const wasDragging = isDraggingRef.current;
      const didDrag = hasDraggedRef.current;
      isDraggingRef.current = false;
      if (wasDragging && !didDrag && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        executeMapPointClick(t.clientX, t.clientY);
      }
    },
    [executeMapPointClick],
  );

  // 30 FPS HUD Overlay Render Loop projecting 3D World onto 2D Canvas
  useEffect(() => {
    if (!isOpen) return;

    let rafId = 0;
    let lastDrawTime = 0;
    const FRAME_INTERVAL_MS = 1000 / 30;

    const getCachedGroundY = (gx: number, gz: number): number => {
      if (!world) return 0;
      const key = `${gx},${gz}`;
      const cached = gridHeightCacheRef.current.get(key);
      if (cached !== undefined) return cached;
      if (gridHeightCacheRef.current.size > 800) {
        gridHeightCacheRef.current.clear();
      }
      const gy = Math.max(
        0,
        typeof (world as any).sampleSurfaceHeightFast === 'function'
          ? (world as any).sampleSurfaceHeightFast(gx, gz)
          : world.probeGroundBelow(gx, 60, gz, 0.8).y,
      );
      gridHeightCacheRef.current.set(key, gy);
      return gy;
    };

    const renderOverlayFrame = (now: number) => {
      rafId = window.requestAnimationFrame(renderOverlayFrame);
      if (now - lastDrawTime < FRAME_INTERVAL_MS) return;
      lastDrawTime = now;

      const canvas = canvasRef.current;
      if (!canvas || !camera) return;

      const rect = canvas.getBoundingClientRect();
      const w = Math.max(240, Math.floor(rect.width));
      const h = Math.max(200, Math.floor(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Transparent canvas overlay over the live 3D Three.js world
      ctx.clearRect(0, 0, w, h);

      const lyr = layersRef.current;
      const isCompact = isMobileMapRef.current;

      // 1. Grid Sector Coordinates along Canvas Edges
      if (lyr.navigationAndGrid) {
        ctx.save();
        const camX = tacticalCamState?.x ?? localPlayerPos.x;
        const camZ = tacticalCamState?.z ?? localPlayerPos.z;
        const alt = tacticalCamState?.altitude ?? 65;

        // Center reticle
        const cx = w * 0.5;
        const cy = h * 0.5;
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy);
        ctx.lineTo(cx + 10, cy);
        ctx.moveTo(cx, cy - 10);
        ctx.lineTo(cx, cy + 10);
        ctx.stroke();

        // Projected 32m / 64m terrain sector markers (using cached ground heights for 0-lag performance)
        if (camera && !isCompact) {
          const startX = Math.floor((camX - 160) / 32) * 32;
          const endX = Math.floor((camX + 160) / 32) * 32;
          const startZ = Math.floor((camZ - 160) / 32) * 32;
          const endZ = Math.floor((camZ + 160) / 32) * 32;

          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';

          for (let gx = startX; gx <= endX; gx += 32) {
            for (let gz = startZ; gz <= endZ; gz += 32) {
              const gy = getCachedGroundY(gx, gz);
              const { sx, sy, visible } = projectWorldToScreen(camera, gx, gy + 0.1, gz, w, h);
              if (!visible || sx < 20 || sx > w - 20 || sy < 30 || sy > h - 30) continue;

              const isMajor = gx % 64 === 0 && gz % 64 === 0;
              ctx.strokeStyle = isMajor ? 'rgba(250, 204, 21, 0.55)' : 'rgba(148, 163, 184, 0.25)';
              ctx.lineWidth = 1;

              // Draw tactical + tick
              const tickSize = isMajor ? 5 : 3;
              ctx.beginPath();
              ctx.moveTo(sx - tickSize, sy);
              ctx.lineTo(sx + tickSize, sy);
              ctx.moveTo(sx, sy - tickSize);
              ctx.lineTo(sx, sy + tickSize);
              ctx.stroke();

              if (isMajor && alt <= 120) {
                const colCode = String.fromCharCode(65 + Math.max(0, Math.min(7, Math.floor((gx + 256) / 64))));
                const rowNum = Math.max(1, Math.min(8, Math.floor((gz + 256) / 64) + 1));
                ctx.fillStyle = 'rgba(250, 204, 21, 0.6)';
                ctx.fillText(`[${colCode}-${rowNum}]`, sx, sy - 6);
              }
            }
          }
        }
        ctx.restore();
      }

      // 2. Water Depth & Hydro Basin Visualization Layer
      if (lyr.waterDepth) {
        const waterZones = [
          { x: -125, y: 0.2, z: 95, label: 'HYDRO BASIN (-6.5M DEEP)', rPx: 30 },
          { x: -95, y: 0.2, z: 118, label: 'DEEP TRENCH (-8.0M DEEP)', rPx: 22 },
          { x: -64, y: 0.2, z: 48, label: 'RIVER CHANNEL (-2.5M)', rPx: 18 },
        ];
        for (const wz of waterZones) {
          const { sx, sy, visible } = projectWorldToScreen(camera, wz.x, wz.y, wz.z, w, h);
          if (!visible) continue;
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
          ctx.fillStyle = 'rgba(14, 116, 144, 0.18)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(sx, sy, wz.rPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#7dd3fc';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(wz.label, sx, sy + 3);
          ctx.restore();
        }
      }

      // 3. Roads, Bridges & Tunnels Overlay Layer
      if (lyr.roadsBridgesTunnels) {
        const roadSegments: Array<{
          title: string;
          color: string;
          pts: Array<[number, number, number]>;
        }> = [
          {
            title: 'WEST SUSPENSION BRIDGE',
            color: '#fbbf24',
            pts: [
              [-40, 2.5, 0],
              [-64, 9.5, 0],
              [-88, 2.5, 0],
            ],
          },
          {
            title: 'PROVING GROUNDS RING ROAD',
            color: '#94a3b8',
            pts: [
              [-36, 2.2, -36],
              [36, 2.2, -36],
              [36, 2.2, 36],
              [-36, 2.2, 36],
              [-36, 2.2, -36],
            ],
          },
          {
            title: 'EAST AIRFIELD ACCESS ROAD',
            color: '#cbd5e1',
            pts: [
              [36, 2.2, -36],
              [65, 3.5, -68],
              [125, 4.5, -68],
            ],
          },
        ];
        for (const seg of roadSegments) {
          ctx.save();
          ctx.strokeStyle = seg.color;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          let started = false;
          let midSx = 0;
          let midSy = 0;
          const midIdx = Math.floor(seg.pts.length / 2);
          for (let i = 0; i < seg.pts.length; i++) {
            const [rx, ry, rz] = seg.pts[i];
            const p = projectWorldToScreen(camera, rx, ry, rz, w, h);
            if (!p.visible) continue;
            if (!started) {
              ctx.moveTo(p.sx, p.sy);
              started = true;
            } else {
              ctx.lineTo(p.sx, p.sy);
            }
            if (i === midIdx) {
              midSx = p.sx;
              midSy = p.sy;
            }
          }
          ctx.stroke();
          if (midSx > 0 && midSy > 0) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
            const tw = ctx.measureText(seg.title).width + 8;
            ctx.fillRect(midSx - tw * 0.5, midSy - 14, tw, 12);
            ctx.fillStyle = seg.color;
            ctx.font = 'bold 8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(seg.title, midSx, midSy - 5);
          }
          ctx.restore();
        }
      }

      // 4. Terrain Landmark Tags in 3D
      if (lyr.terrainLabels) {
        const landmarks = [
          { x: 0, y: 2, z: 0, title: 'PROVING GROUNDS', sub: 'FLAT TARMAC', color: '#94a3b8' },
          { x: 115, y: 28, z: -85, title: 'RED-ROCK CANYON', sub: 'STEPPED MESAS', color: '#fdba74' },
          { x: -115, y: 36, z: -115, title: 'ALPINE RIDGE', sub: 'HIGH PEAKS', color: '#cbd5e1' },
          { x: 110, y: 8, z: 110, title: 'EMERALD FOREST', sub: 'DENSE CANOPY', color: '#86efac' },
          { x: -125, y: -4, z: 95, title: 'COASTAL HYDRO BASIN', sub: 'DEEP WATER', color: '#7dd3fc' },
          { x: 95, y: 4.5, z: -68, title: 'RUNWAY 09/27', sub: 'AIRFIELD STRIP', color: '#38bdf8' },
          { x: 0, y: 4, z: 36, title: 'MEGA JUMP RAMP', sub: 'STUNT LAUNCH', color: '#fb923c' },
        ];

        for (const lm of landmarks) {
          const { sx, sy, visible } = projectWorldToScreen(camera, lm.x, lm.y, lm.z, w, h);
          if (!visible) continue;
          ctx.save();
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          const tw = Math.max(ctx.measureText(lm.title).width, ctx.measureText(lm.sub).width) + 10;
          ctx.fillStyle = 'rgba(9, 13, 22, 0.78)';
          ctx.fillRect(sx - tw * 0.5, sy - 10, tw, 22);
          ctx.fillStyle = lm.color;
          ctx.fillText(lm.title, sx, sy);
          ctx.font = '8px monospace';
          ctx.fillStyle = '#a3a3a3';
          ctx.fillText(lm.sub, sx, sy + 9);
          ctx.restore();
        }
      }

      // 5. Multi-point Route Lines in 3D
      if (lyr.navigationAndGrid && routePointsRef.current.length >= 2) {
        const pts = routePointsRef.current;
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.6;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < pts.length; i++) {
          const { sx, sy, visible } = projectWorldToScreen(camera, pts[i].x, pts[i].y, pts[i].z, w, h);
          if (!visible) continue;
          if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
          } else {
            ctx.lineTo(sx, sy);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        for (let i = 0; i < pts.length; i++) {
          const { sx, sy, visible } = projectWorldToScreen(camera, pts[i].x, pts[i].y, pts[i].z, w, h);
          if (!visible) continue;
          ctx.fillStyle = '#090d16';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.fillRect(sx - 7, sy - 7, 14, 14);
          ctx.strokeRect(sx - 7, sy - 7, 14, 14);
          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${i + 1}`, sx, sy + 3);
        }
        ctx.restore();
      }

      // 6. Ruler Measurement Line in 3D
      if (lyr.navigationAndGrid && rulerRef.current.a) {
        const ra = rulerRef.current.a;
        const pA = projectWorldToScreen(camera, ra.x, ra.y, ra.z, w, h);
        if (pA.visible) {
          ctx.save();
          ctx.fillStyle = '#facc15';
          ctx.fillRect(pA.sx - 6, pA.sy - 6, 12, 12);
          ctx.font = 'bold 9px monospace';
          ctx.fillText(`A (${ra.y}m)`, pA.sx + 14, pA.sy - 4);
          ctx.restore();
        }

        if (rulerRef.current.b) {
          const rb = rulerRef.current.b;
          const pB = projectWorldToScreen(camera, rb.x, rb.y, rb.z, w, h);
          if (pA.visible && pB.visible) {
            ctx.save();
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2.4;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(pA.sx, pA.sy);
            ctx.lineTo(pB.sx, pB.sy);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#facc15';
            ctx.fillRect(pB.sx - 6, pB.sy - 6, 12, 12);

            const m = computeNavigationMetrics(ra, rb);
            const mx = (pA.sx + pB.sx) * 0.5;
            const my = (pA.sy + pB.sy) * 0.5;
            const dSign = m.elevationDeltaMeters >= 0 ? '+' : '';
            const label = `RULER: ${m.distance2DMeters}m · ΔY ${dSign}${m.elevationDeltaMeters}m · ${m.bearingDegrees}°`;
            ctx.font = 'bold 9px monospace';
            const tw = ctx.measureText(label).width + 10;
            ctx.fillStyle = '#18181b';
            ctx.strokeStyle = '#facc15';
            ctx.fillRect(mx - tw * 0.5, my - 12, tw, 16);
            ctx.strokeRect(mx - tw * 0.5, my - 12, tw, 16);
            ctx.fillStyle = '#facc15';
            ctx.textAlign = 'center';
            ctx.fillText(label, mx, my - 1);
            ctx.restore();
          }
        }
      }

      // 7. Engineering Features: Runways, Test Tracks, Landing Zones, Recovery Stations & Blast Craters
      if (lyr.engineeringFeatures) {
        // Draw Runway 09/27 Centerline Strip
        const rStart = projectWorldToScreen(camera, 65, 4.5, -68, w, h);
        const rEnd = projectWorldToScreen(camera, 125, 4.5, -68, w, h);
        if (rStart.visible && rEnd.visible) {
          ctx.save();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(rStart.sx, rStart.sy);
          ctx.lineTo(rEnd.sx, rEnd.sy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        const engStations = [
          { x: 24, y: 2.2, z: -18, badge: '[H] VTOL LANDING ZONE', color: '#4ade80' },
          { x: -18, y: 2.2, z: -14, badge: '[R] RECOVERY & REPAIR STATION', color: '#facc15' },
          { x: 0, y: 2.2, z: -55, badge: '[T] HIGH-SPEED TEST TRACK', color: '#fb923c' },
          { x: -115, y: 0.5, z: 90, badge: '[W] MARINE BUOYANCY TEST BASIN', color: '#38bdf8' },
        ];
        for (const st of engStations) {
          const p = projectWorldToScreen(camera, st.x, st.y, st.z, w, h);
          if (!p.visible) continue;
          ctx.save();
          ctx.strokeStyle = st.color;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.lineWidth = 1.8;
          ctx.strokeRect(p.sx - 8, p.sy - 8, 16, 16);
          ctx.font = 'bold 8px monospace';
          ctx.fillStyle = st.color;
          ctx.textAlign = 'center';
          ctx.fillText(st.badge, p.sx, p.sy - 12);
          ctx.restore();
        }

        for (const crater of craterMarkersRef.current) {
          const { sx, sy, visible } = projectWorldToScreen(camera, crater.x, crater.y, crater.z, w, h);
          if (!visible) continue;
          ctx.save();
          ctx.fillStyle = 'rgba(220, 38, 38, 0.2)';
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, 22, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fca5a5';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`✸ ${crater.label}`, sx, sy + 32);
          ctx.restore();
        }
      }

      // 8. Custom Waypoints in 3D & Fast-Travel Beacons
      const activeWpId = selectedWaypointIdRef.current;
      for (const wp of customWaypointsRef.current) {
        const { sx, sy, visible } = projectWorldToScreen(camera, wp.x, wp.y, wp.z, w, h);
        if (!visible) continue;
        const isSelected = wp.id === activeWpId;

        if (isSelected && lyr.navigationAndGrid) {
          const pPlayer = projectWorldToScreen(
            camera,
            localPlayerPos.x,
            localPlayerPos.y,
            localPlayerPos.z,
            w,
            h,
          );
          if (pPlayer.visible) {
            ctx.save();
            ctx.strokeStyle = wp.color;
            ctx.lineWidth = 2.4;
            ctx.setLineDash([8, 5]);
            ctx.beginPath();
            ctx.moveTo(pPlayer.sx, pPlayer.sy);
            ctx.lineTo(sx, sy);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx - 14, sy - 14, 28, 28);
        }

        drawWaypointSymbol(ctx, wp.icon, sx, sy, 11, wp.color);

        ctx.save();
        ctx.font = isSelected ? 'bold 10px monospace' : '9px monospace';
        ctx.textAlign = 'center';
        const label = `${wp.name} (${wp.y >= 0 ? '+' : ''}${wp.y}m)`;
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = 'rgba(9, 13, 22, 0.85)';
        ctx.fillRect(sx - tw * 0.5, sy + 12, tw, 13);
        ctx.fillStyle = wp.color;
        ctx.fillText(label, sx, sy + 22);
        ctx.restore();
      }

      for (const node of teleportNodes) {
        const p = projectWorldToScreen(camera, node.x, node.y, node.z, w, h);
        if (!p.visible) continue;
        ctx.save();
        ctx.strokeStyle = '#a855f7';
        ctx.fillStyle = 'rgba(88, 28, 135, 0.65)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e9d5ff';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`⚡ ${node.name}`, p.sx, p.sy - 11);
        ctx.restore();
      }

      // 9. Active 3D Vehicles, Trails, Player Indicator & Remote Players
      if (lyr.vehiclesAndTrails) {
        // Draw Vehicle Trails
        vehicleTrailsRef.current.forEach((trail) => {
          if (trail.length < 2) return;
          ctx.save();
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < trail.length; i++) {
            const pt = trail[i];
            const p = projectWorldToScreen(camera, pt.x, pt.y + 0.2, pt.z, w, h);
            if (!p.visible) continue;
            if (!started) {
              ctx.moveTo(p.sx, p.sy);
              started = true;
            } else {
              ctx.lineTo(p.sx, p.sy);
            }
          }
          ctx.stroke();
          ctx.restore();
        });

        for (let i = 0; i < vehicles.length; i++) {
          const veh = vehicles[i];
          const isLocal = veh === localVehicle;
          const { sx, sy, visible } = projectWorldToScreen(
            camera,
            veh.position.x,
            veh.position.y,
            veh.position.z,
            w,
            h,
          );
          if (!visible) continue;

          const paintHex =
            typeof veh.getPrimaryPaintColorHex === 'function'
              ? veh.getPrimaryPaintColorHex()
              : '#38bdf8';

          // 2.5D Tactical Brackets + Heading Arrow over real vehicle
          ctx.save();
          ctx.strokeStyle = isLocal ? '#facc15' : paintHex;
          ctx.lineWidth = isLocal ? 2.6 : 1.8;
          ctx.strokeRect(sx - 14, sy - 14, 28, 28);

          // Draw Vehicle Heading Vector
          _fwdTmp.set(0, 0, 1).applyQuaternion(veh.quaternion);
          const pHead = projectWorldToScreen(
            camera,
            veh.position.x + _fwdTmp.x * 6,
            veh.position.y,
            veh.position.z + _fwdTmp.z * 6,
            w,
            h,
          );
          if (pHead.visible) {
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(pHead.sx, pHead.sy);
            ctx.stroke();
          }

          // Altitude Badge
          const altMeters = Number(veh.position.y.toFixed(1));
          const altBadge = `ALT ${altMeters}m`;
          ctx.font = 'bold 8px monospace';
          const bw = ctx.measureText(altBadge).width + 8;
          ctx.fillStyle = altMeters > 8 ? '#0284c7' : '#18181b';
          ctx.strokeStyle = '#38bdf8';
          ctx.fillRect(sx + 16, sy - 6, bw, 13);
          ctx.strokeRect(sx + 16, sy - 6, bw, 13);
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'left';
          ctx.fillText(altBadge, sx + 20, sy + 3);

          if (isLocal) {
            ctx.fillStyle = '#facc15';
            ctx.textAlign = 'center';
            ctx.fillText(localPlayerName || 'LOCAL VEHICLE', sx, sy - 18);
          }
          ctx.restore();
        }

        // Draw On-Foot Player Marker & Heading when walking
        if (!isSeatedInRig) {
          const pWalk = projectWorldToScreen(
            camera,
            localPlayerPos.x,
            localPlayerPos.y,
            localPlayerPos.z,
            w,
            h,
          );
          if (pWalk.visible) {
            ctx.save();
            ctx.fillStyle = localPlayerColor || '#facc15';
            ctx.strokeStyle = '#18181b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pWalk.sx, pWalk.sy, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#facc15';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${localPlayerName || 'PILOT'} (ON FOOT)`, pWalk.sx, pWalk.sy - 10);
            ctx.restore();
          }
        }

        // Draw Remote Multiplayer Peers
        for (const rp of remotePlayers) {
          if (rp.x === undefined || rp.z === undefined) continue;
          const pRem = projectWorldToScreen(camera, rp.x, rp.y ?? 2, rp.z, w, h);
          if (!pRem.visible) continue;
          ctx.save();
          ctx.fillStyle = rp.color || '#38bdf8';
          ctx.strokeStyle = '#090d16';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pRem.sx, pRem.sy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = rp.color || '#38bdf8';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(rp.name, pRem.sx, pRem.sy - 10);
          ctx.restore();
        }
      }

      // 10. Compass Rose & 11. Scale Bar (Desktop only — hidden on mobile so floating corner controls stay minimal)
      if (!isCompact) {
        ctx.save();
        const compCx = w - 46;
        const compCy = 46;
        const compR = 26;
        ctx.fillStyle = 'rgba(18, 20, 24, 0.9)';
        ctx.strokeStyle = '#444444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(compCx, compCy, compR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('N', compCx, compCy - compR + 9);
        ctx.fillStyle = '#a3a3a3';
        ctx.fillText('S', compCx, compCy + compR - 3);
        ctx.fillText('E', compCx + compR - 6, compCy + 3);
        ctx.fillText('W', compCx - compR + 6, compCy + 3);
        ctx.restore();

        const alt = tacticalCamState?.altitude ?? 65;
        const scaleMeters = alt > 140 ? 100 : alt > 60 ? 50 : 25;
        const barPx = Math.max(50, Math.min(160, (scaleMeters / alt) * 120));
        ctx.save();
        ctx.fillStyle = 'rgba(18, 20, 24, 0.88)';
        ctx.strokeStyle = '#444444';
        ctx.lineWidth = 1.5;
        ctx.fillRect(14, h - 38, barPx + 20, 26);
        ctx.strokeRect(14, h - 38, barPx + 20, 26);

        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(22, h - 19);
        ctx.lineTo(22 + barPx, h - 19);
        ctx.moveTo(22, h - 24);
        ctx.lineTo(22, h - 14);
        ctx.moveTo(22 + barPx, h - 24);
        ctx.lineTo(22 + barPx, h - 14);
        ctx.stroke();
        ctx.fillStyle = '#e5e5e5';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`SCALE: ${scaleMeters}M`, 22, h - 26);
        ctx.restore();
      }
    };

    rafId = window.requestAnimationFrame(renderOverlayFrame);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [
    isOpen,
    camera,
    world,
    tacticalCamState,
    localPlayerPos,
    vehicles,
    localVehicle,
    localPlayerName,
    localPlayerColor,
    isSeatedInRig,
    remotePlayers,
    teleportNodes,
  ]);

  if (!isOpen) return null;

  const isTopDown = tacticalCamState?.isTopDown ?? false;
  const currentAlt = Math.round(tacticalCamState?.altitude ?? 65);
  const mapRenderRadiusChunks =
    world?.activeMapRenderRadiusChunks ??
    computeTacticalMapRenderRadiusChunks(
      currentAlt,
      world?.customRenderDistance ?? 4,
      isTopDown,
      typeof window !== 'undefined' && window.innerHeight > 0
        ? window.innerWidth / window.innerHeight
        : 1.78,
    );
  const mapRenderRadiusMeters = mapRenderRadiusChunks * 16;

  // Shared Tactical Panel Content (used in collapsible floating drawer on Mobile and right sidebar on Desktop)
  const renderTacticalSidebarContent = () => (
    <>
      {/* Sidebar Tabs */}
      <div className="grid grid-cols-4 border-b-2 border-[#444444] bg-[#242424] shrink-0">
        {(
          [
            { id: 'WAYPOINTS', label: 'WAYPOINTS' },
            { id: 'FAST_TRAVEL', label: 'BEACONS' },
            { id: 'ROUTE_RULER', label: 'ROUTE' },
            { id: 'LEGEND_LAYERS', label: 'LAYERS' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`map-sidebar-tab-${tab.id}`}
            onClick={() => setSidebarTab(tab.id)}
            className={`py-2 text-[10px] font-display font-bold uppercase border-r border-[#444444] last:border-r-0 cursor-pointer ${
              sidebarTab === tab.id
                ? 'bg-[#fbbf24] text-[#1a1a1a]'
                : 'bg-[#242424] text-[#e5e5e5] hover:bg-[#333333]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quick Zoom Presets inside mobile drawer for easy 1-tap access */}
      {isMobileMap && (
        <div className="grid grid-cols-4 gap-1 border-b border-[#444444] bg-[#1e1e1e] p-1.5 shrink-0">
          {[
            { label: 'REGIONAL', short: '180M', alt: 180 },
            { label: 'TACTICAL', short: '90M', alt: 90 },
            { label: 'AREA', short: '45M', alt: 45 },
            { label: 'CLOSE 2.5D', short: '22M', alt: 22 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              data-testid={`map-zoom-preset-${preset.label}`}
              onClick={() => onSetTacticalMapAltitude?.(preset.alt)}
              className="rounded-[2px] border border-[#444444] bg-[#262626] active:bg-[#fbbf24] active:text-[#1a1a1a] py-1 text-[9px] font-mono-num font-bold text-[#e5e5e5] cursor-pointer"
            >
              {preset.short}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2.5">
        {/* TAB 1: WAYPOINTS */}
        {sidebarTab === 'WAYPOINTS' && (
          <div data-testid="map-waypoints-panel" className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-display font-bold uppercase text-[#fbbf24]">
                WAYPOINTS ({customWaypoints.length})
              </span>
              <button
                type="button"
                data-testid="map-add-waypoint-at-player-btn"
                onClick={() => {
                  const newWp: CustomMapWaypoint = {
                    id: `wp-${Date.now()}`,
                    name: wpDraftName.trim() || `Waypoint #${customWaypoints.length + 1}`,
                    x: Math.round(localPlayerPos.x),
                    y: Number(localPlayerPos.y.toFixed(1)),
                    z: Math.round(localPlayerPos.z),
                    color: wpDraftColor,
                    icon: wpDraftIcon,
                    createdAt: Date.now(),
                  };
                  setCustomWaypoints((prev) => [...prev, newWp]);
                  setSelectedWaypointId(newWp.id);
                }}
                className="rounded-[2px] border-2 border-[#444444] bg-[#fbbf24] px-2 py-0.5 text-[10px] font-display font-bold uppercase text-[#1a1a1a] cursor-pointer"
              >
                + MARK PLAYER
              </button>
            </div>

            <div className="rounded-[2px] border-2 border-[#444444] bg-[#242424] p-2 flex flex-col gap-2">
              <input
                type="text"
                data-testid="map-waypoint-name-input"
                value={wpDraftName}
                onChange={(e) => {
                  const val = e.target.value;
                  setWpDraftName(val);
                  if (selectedWaypointId) {
                    setCustomWaypoints((prev) =>
                      prev.map((w) =>
                        w.id === selectedWaypointId ? { ...w, name: val } : w,
                      ),
                    );
                  }
                }}
                placeholder="WAYPOINT NAME..."
                className="w-full rounded-[2px] border-2 border-[#444444] bg-[#1a1a1a] px-2 py-1 text-xs font-mono-num text-[#e5e5e5]"
              />

              {/* Color Swatches */}
              <div className="flex items-center gap-1.5">
                {WAYPOINT_COLOR_PALETTE.map((sw) => (
                  <button
                    key={sw.hex}
                    type="button"
                    onClick={() => {
                      setWpDraftColor(sw.hex);
                      if (selectedWaypointId) {
                        setCustomWaypoints((prev) =>
                          prev.map((w) =>
                            w.id === selectedWaypointId ? { ...w, color: sw.hex } : w,
                          ),
                        );
                      }
                    }}
                    style={{ backgroundColor: sw.hex }}
                    className={`h-4 w-4 rounded-[2px] border cursor-pointer ${
                      wpDraftColor === sw.hex ? 'border-white scale-110' : 'border-[#444444]'
                    }`}
                    title={sw.label}
                  />
                ))}
              </div>

              {/* Icon Glyphs */}
              <div className="grid grid-cols-4 gap-1">
                {WAYPOINT_ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic.id}
                    type="button"
                    onClick={() => {
                      setWpDraftIcon(ic.id);
                      if (selectedWaypointId) {
                        setCustomWaypoints((prev) =>
                          prev.map((w) =>
                            w.id === selectedWaypointId ? { ...w, icon: ic.id } : w,
                          ),
                        );
                      }
                    }}
                    className={`rounded-[2px] border border-[#444444] px-1 py-0.5 text-[9px] font-mono-num font-bold uppercase cursor-pointer ${
                      wpDraftIcon === ic.id
                        ? 'bg-[#facc15] text-[#1a1a1a]'
                        : 'bg-[#1a1a1a] text-[#e5e5e5]'
                    }`}
                  >
                    {ic.shortGlyph} {ic.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Waypoints List */}
            <div className="flex flex-col gap-1.5">
              {customWaypoints.map((wp) => {
                const isSel = wp.id === selectedWaypointId;
                const nav = computeNavigationMetrics(localPlayerPos, wp);
                const iconMeta =
                  WAYPOINT_ICON_OPTIONS.find((i) => i.id === wp.icon) ??
                  WAYPOINT_ICON_OPTIONS[0];
                return (
                  <div
                    key={wp.id}
                    data-testid={`map-waypoint-row-${wp.id}`}
                    onClick={() => {
                      setSelectedWaypointId(wp.id);
                      onFocusTacticalMapOn?.(wp.x, wp.z);
                      if (isMobileMap) setMobileDrawerOpen(false);
                    }}
                    className={`flex items-center justify-between gap-1.5 rounded-[2px] border-2 px-2 py-1.5 cursor-pointer ${
                      isSel
                        ? 'border-[#facc15] bg-[#2a2a2a]'
                        : 'border-[#444444] bg-[#222222] hover:bg-[#292929]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block px-1 text-[10px] font-bold text-[#090d16]"
                          style={{ backgroundColor: wp.color }}
                        >
                          {iconMeta.shortGlyph}
                        </span>
                        <span className="truncate text-xs font-display font-bold uppercase text-[#e5e5e5]">
                          {wp.name}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                        ({wp.x}m, {wp.z}m) · {nav.distance2DMeters}m · ΔY{' '}
                        {nav.elevationDeltaMeters >= 0 ? '+' : ''}
                        {nav.elevationDeltaMeters}m
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`map-delete-waypoint-${wp.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCustomWaypoints((prev) => prev.filter((item) => item.id !== wp.id));
                        if (selectedWaypointId === wp.id) setSelectedWaypointId(null);
                      }}
                      className="rounded-[2px] border border-[#444444] bg-[#dc2626] px-1.5 py-0.5 text-[10px] font-mono-num text-[#e5e5e5] cursor-pointer"
                    >
                      DEL
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: ROUTE / RULER */}
        {sidebarTab === 'ROUTE_RULER' && (
          <div data-testid="map-route-ruler-panel" className="flex flex-col gap-2.5">
            <div className="rounded-[2px] border-2 border-[#444444] bg-[#242424] p-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-display font-bold uppercase text-[#fbbf24]">
                  DISTANCE RULER [A → B]
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRulerPointA(null);
                    setRulerPointB(null);
                  }}
                  className="rounded-[2px] border border-[#444444] bg-[#6b7280] px-1.5 py-0.5 text-[10px] font-mono-num text-[#e5e5e5] cursor-pointer"
                >
                  CLEAR
                </button>
              </div>
              {rulerMetrics && rulerPointA && rulerPointB ? (
                <div className="text-[11px] font-mono-num text-[#e5e5e5] flex flex-col gap-0.5">
                  <div>
                    2D DIST: <strong className="text-[#facc15]">{rulerMetrics.distance2DMeters}m</strong> · 3D:{' '}
                    <strong>{rulerMetrics.distance3DMeters}m</strong>
                  </div>
                  <div>
                    ELEV ΔY: <strong className="text-[#38bdf8]">{rulerMetrics.elevationDeltaMeters}m</strong> ({rulerMetrics.slopeDegrees}° SLOPE)
                  </div>
                </div>
              ) : (
                <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                  Tap two points on the 3D terrain in RULER mode.
                </div>
              )}
            </div>

            <div className="rounded-[2px] border-2 border-[#444444] bg-[#242424] p-2 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-display font-bold uppercase text-[#38bdf8]">
                  MULTI-POINT ROUTE ({routePoints.length})
                </span>
                <button
                  type="button"
                  data-testid="map-clear-route-btn"
                  onClick={() => setRoutePoints([])}
                  className="rounded-[2px] border border-[#444444] bg-[#dc2626] px-1.5 py-0.5 text-[10px] font-mono-num text-[#e5e5e5] cursor-pointer"
                >
                  CLEAR
                </button>
              </div>
              <div
                data-testid="map-route-summary-box"
                className="rounded-[2px] border border-[#444444] bg-[#1a1a1a] p-2 text-[11px] font-mono-num text-[#e5e5e5]"
              >
                <div>
                  TOTAL 2D: <strong className="text-[#fbbf24]">{routeSummary.totalDistance2DMeters}m</strong> · 3D:{' '}
                  <strong>{routeSummary.totalDistance3DMeters}m</strong>
                </div>
                <div>
                  NET ΔY: {routeSummary.netElevationDeltaMeters}m (▲+{routeSummary.totalClimbMeters}m / ▼-{routeSummary.totalDescentMeters}m)
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LAYERS */}
        {sidebarTab === 'LEGEND_LAYERS' && (
          <div data-testid="map-legend-layers-panel" className="flex flex-col gap-2">
            <div className="text-xs font-display font-bold uppercase text-[#fbbf24]">
              TACTICAL OVERLAY LAYERS
            </div>
            {(
              [
                { key: 'vehiclesAndTrails', label: '3D Vehicles & Altitude Badges' },
                { key: 'navigationAndGrid', label: 'Sector Grid, Route & Ruler' },
                { key: 'terrainLabels', label: 'Landmark & Biome Labels' },
                { key: 'engineeringFeatures', label: 'Runways & Craters' },
                { key: 'roadsBridgesTunnels', label: 'Road & Bridge Overlays' },
                { key: 'waterDepth', label: 'Water Depth & Basin Tags' },
              ] as const
            ).map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between rounded-[2px] border border-[#444444] bg-[#242424] px-2 py-1.5 text-xs font-mono-num text-[#e5e5e5] cursor-pointer"
              >
                <span>{item.label}</span>
                <input
                  type="checkbox"
                  checked={layers[item.key]}
                  onChange={(e) =>
                    setLayers((prev) => ({ ...prev, [item.key]: e.target.checked }))
                  }
                  className="accent-[#fbbf24]"
                />
              </label>
            ))}
          </div>
        )}

        {/* TAB 4: FAST-TRAVEL BEACONS */}
        {sidebarTab === 'FAST_TRAVEL' && (
          <div className="flex flex-col gap-2">
            <div
              data-testid="teleport-beacon-count-badge"
              className="text-xs font-display font-bold uppercase tracking-wider text-[#fbbf24]"
            >
              FAST-TRAVEL BEACONS ({teleportNodes.length})
            </div>
            {combatCooldownSec > 0 && (
              <div className="rounded-[2px] border-2 border-[#dc2626] bg-[#dc2626]/20 px-2 py-1 text-[11px] font-mono-num text-[#e5e5e5]">
                COMBAT LOCK: {combatCooldownSec.toFixed(1)}S
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {teleportNodes.map((node) => {
                const isSpinning = activeSpinupNodeId === node.id;
                return (
                  <div
                    key={node.id}
                    data-testid={`teleport-node-row-${node.id}`}
                    onClick={() => {
                      onFocusTacticalMapOn?.(node.x, node.z);
                      if (isMobileMap) setMobileDrawerOpen(false);
                    }}
                    className="flex items-center justify-between gap-1.5 rounded-[2px] border-2 border-[#444444] bg-[#262626] hover:bg-[#2f2f2f] px-2.5 py-1.5 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-display font-bold uppercase text-[#e5e5e5]">
                        {node.name}
                      </div>
                      <div className="text-[10px] font-mono-num text-[#e5e5e5]/80">
                        ({Math.round(node.x)}M, {Math.round(node.z)}M)
                      </div>
                    </div>
                    {onTeleportToNode && (
                      <button
                        type="button"
                        data-testid={`teleport-to-node-${node.id}`}
                        disabled={combatCooldownSec > 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTeleportToNode(node.id);
                        }}
                        className="rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] px-2 py-1 text-[11px] font-display font-bold text-[#1a1a1a] disabled:opacity-40 cursor-pointer"
                      >
                        {isSpinning ? `${Math.round(spinupProgress * 100)}%` : 'WARP'}
                      </button>
                    )}
                    {(onRemoveBeacon || onDeleteTeleportNode) && (
                      <button
                        type="button"
                        data-testid={`delete-teleport-node-${node.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          (onRemoveBeacon ?? onDeleteTeleportNode)?.(node.id);
                        }}
                        className="rounded-[2px] bg-[#dc2626] border-2 border-[#444444] px-1.5 py-1 text-[10px] font-mono-num text-[#e5e5e5] cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {(onDropBeaconHere || onPlaceBeaconAtPlayer) && (
              <div className="border-t-2 border-[#444444] pt-2 flex flex-col gap-1.5">
                <input
                  type="text"
                  value={beaconNameInput}
                  onChange={(e) => setBeaconNameInput(e.target.value)}
                  placeholder="BEACON NAME..."
                  className="w-full rounded-[2px] border-2 border-[#444444] bg-[#262626] px-2 py-1 text-xs font-mono-num text-[#e5e5e5]"
                />
                <button
                  type="button"
                  data-testid="place-beacon-at-player-btn"
                  onClick={() =>
                    (onDropBeaconHere ?? onPlaceBeaconAtPlayer)?.(beaconNameInput)
                  }
                  className="w-full rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] px-2.5 py-1.5 text-xs font-display font-bold uppercase text-[#1a1a1a] cursor-pointer"
                >
                  + DROP BEACON AT CURRENT POS
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  // ===========================================================================
  // MINIMAL MOBILE TACTICAL MAP HUD (Matches MobileTouchControls aesthetic)
  // ===========================================================================
  if (isMobileMap) {
    return (
      <div
        data-testid="fullscreen-map-overlay"
        className="fixed inset-0 z-[90] pointer-events-none select-none overflow-hidden"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Full-Screen Transparent Raycasting & HUD Canvas Overlay */}
        <canvas
          ref={canvasRef}
          data-testid="fullscreen-map-canvas"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
          className="absolute inset-0 w-full h-full pointer-events-auto cursor-crosshair block touch-none"
        />

        {/* Minimal Top Corner Bar */}
        <div className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between gap-1.5 pointer-events-none">
          {/* Top-Left: Compact Coords + Dynamic Render Distance Pill */}
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-[2px] border-2 border-[#444444] bg-[#1a1a1a]/90 px-2 py-1 shadow-md">
            <span className="inline-block h-2 w-2 bg-[#fbbf24]" />
            <span
              data-testid="map-player-coords-readout"
              className="text-[10px] font-mono-num font-bold text-[#e5e5e5]"
            >
              X:{Math.round(localPlayerPos.x)} Z:{Math.round(localPlayerPos.z)}
            </span>
            <span className="text-[10px] font-mono-num text-[#fbbf24]">
              ALT {currentAlt}m
            </span>
            <span
              data-testid="map-render-distance-readout"
              className="hidden sm:inline text-[9px] font-mono-num text-[#a3a3a3]"
            >
              · RAD {mapRenderRadiusMeters}m
            </span>
            {selectedWaypoint && activeWaypointMetrics && (
              <span
                data-testid="map-active-waypoint-hud"
                className="border-l border-[#444444] pl-1.5 text-[10px] font-mono-num font-bold text-[#fbbf24] truncate max-w-[110px]"
              >
                → {activeWaypointMetrics.distance2DMeters}m {activeWaypointMetrics.cardinalDirection}
              </span>
            )}
          </div>

          {/* Top-Right: Minimal Action Buttons (2.5D, Grid, Waypoints Drawer, Close) */}
          <div className="pointer-events-auto flex items-center gap-1">
            <button
              type="button"
              data-testid="map-toggle-25d-btn"
              onClick={() => onSetTacticalMapTopDown?.(!isTopDown)}
              className={`h-8 px-2 rounded-[2px] border-2 border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer ${
                !isTopDown
                  ? 'bg-[#fbbf24] text-[#1a1a1a]'
                  : 'bg-[#1a1a1a]/90 text-[#e5e5e5]'
              }`}
            >
              {!isTopDown ? '2.5D' : '2D'}
            </button>

            <button
              type="button"
              data-testid="map-toggle-grid-btn"
              onClick={() => {
                onToggleGrid?.();
                setLayers((prev) => ({
                  ...prev,
                  navigationAndGrid: !prev.navigationAndGrid,
                }));
              }}
              className={`h-8 px-2 rounded-[2px] border-2 border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer ${
                (tacticalGridVisible ?? layers.navigationAndGrid)
                  ? 'bg-[#fbbf24] text-[#1a1a1a]'
                  : 'bg-[#1a1a1a]/90 text-[#a3a3a3]'
              }`}
            >
              GRID
            </button>

            <button
              type="button"
              data-testid="mobile-map-drawer-btn"
              onClick={() => setMobileDrawerOpen((v) => !v)}
              className={`h-8 px-2.5 rounded-[2px] border-2 border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer ${
                mobileDrawerOpen
                  ? 'bg-[#fbbf24] text-[#1a1a1a]'
                  : 'bg-[#1a1a1a]/90 text-[#e5e5e5]'
              }`}
            >
              PANEL {mobileDrawerOpen ? '▴' : '▾'}
            </button>

            <button
              type="button"
              data-testid="close-fullscreen-map-btn"
              onClick={onClose}
              className="h-8 px-2.5 rounded-[2px] border-2 border-[#444444] bg-[#dc2626] active:bg-[#b91c1c] text-[10px] font-display font-bold uppercase text-[#e5e5e5] cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Collapsible Mobile Tactical Drawer (Waypoints, Beacons, Route, Layers) */}
        {mobileDrawerOpen && (
          <div
            data-testid="mobile-map-drawer-panel"
            className="pointer-events-auto absolute top-12 right-2 z-30 w-[min(92vw,320px)] max-h-[calc(100dvh-96px)] flex flex-col rounded-[2px] border-2 border-[#444444] bg-[#1a1a1a]/95 shadow-2xl overflow-hidden"
          >
            {renderTacticalSidebarContent()}
          </div>
        )}

        {/* Minimal Bottom Corner Controls */}
        <div className="absolute bottom-2.5 left-2 right-2 z-20 flex items-end justify-between gap-1.5 pointer-events-none">
          {/* Bottom-Left: Compact Tool Strip */}
          <div className="pointer-events-auto flex items-center gap-1 rounded-[2px] border-2 border-[#444444] bg-[#1a1a1a]/90 p-1 shadow-md">
            {(
              [
                { id: 'PAN_SELECT', label: 'PAN' },
                { id: 'ADD_WAYPOINT', label: '+WP' },
                { id: 'RULER_AB', label: 'RULER' },
                { id: 'DRAW_ROUTE', label: 'ROUTE' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`map-tool-btn-${t.id}`}
                onClick={() => setActiveTool(t.id)}
                className={`h-7 px-2 rounded-[2px] border border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer ${
                  activeTool === t.id
                    ? 'bg-[#fbbf24] text-[#1a1a1a]'
                    : 'bg-[#262626] text-[#e5e5e5]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Bottom-Right: Compact Center + Zoom Controls */}
          <div className="pointer-events-auto flex items-center gap-1">
            <button
              type="button"
              data-testid="map-center-player-btn"
              onClick={() => onCenterTacticalMapOnPlayer?.()}
              className="h-8 px-2.5 rounded-[2px] border-2 border-[#444444] bg-[#1a1a1a]/90 active:bg-[#fbbf24] active:text-[#1a1a1a] text-[10px] font-display font-bold uppercase text-[#e5e5e5] cursor-pointer shadow-md"
            >
              CENTER
            </button>
            <button
              type="button"
              data-testid="map-zoom-out-btn"
              onClick={() => onZoomTacticalMap?.(1.25)}
              className="h-8 w-8 rounded-[2px] border-2 border-[#444444] bg-[#1a1a1a]/90 active:bg-[#333333] text-sm font-mono-num font-bold text-[#fbbf24] cursor-pointer shadow-md"
            >
              −
            </button>
            <button
              type="button"
              data-testid="map-zoom-in-btn"
              onClick={() => onZoomTacticalMap?.(0.8)}
              className="h-8 w-8 rounded-[2px] border-2 border-[#444444] bg-[#1a1a1a]/90 active:bg-[#333333] text-sm font-mono-num font-bold text-[#fbbf24] cursor-pointer shadow-md"
            >
              +
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // DESKTOP TACTICAL MAP HUD
  // ===========================================================================
  return (
    <div
      data-testid="fullscreen-map-overlay"
      className="fixed inset-0 z-[90] pointer-events-none select-none flex flex-col justify-between"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* =====================================================================
          TOP BAR: 2.5D REAL WORLD CAMERA CONTROLS & STATUS
          ===================================================================== */}
      <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#444444] bg-[#1a1a1a]/95 px-3 py-2 shadow-lg">
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-2.5 w-2.5 bg-[#fbbf24] animate-pulse" />
          <h2 className="text-xs sm:text-sm font-display font-bold tracking-wider uppercase text-[#fbbf24]">
            2.5D REAL WORLD TACTICAL CAMERA [F]
          </h2>
          <span
            data-testid="map-player-coords-readout"
            className="rounded-[2px] border border-[#444444] bg-[#141414] px-2 py-0.5 text-[11px] font-mono-num text-[#e5e5e5]"
          >
            PLAYER X:{Math.round(localPlayerPos.x)}m Y:{localPlayerPos.y.toFixed(1)}m Z:
            {Math.round(localPlayerPos.z)}m · HDG {playerCompassDeg}°{' '}
            {formatCompassCardinal(playerCompassDeg)}
          </span>
          <span
            data-testid="map-render-distance-readout"
            className="rounded-[2px] border border-[#444444] bg-[#141414] px-2 py-0.5 text-[11px] font-mono-num text-[#fbbf24]"
          >
            ALT {currentAlt}m · RAD {mapRenderRadiusMeters}m ({mapRenderRadiusChunks} CHUNKS)
          </span>
        </div>

        {/* Real 3D Camera Zoom Presets & View Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono-num uppercase text-[#a3a3a3]">
            ALTITUDE:
          </span>
          {[
            { label: 'REGIONAL', alt: 180 },
            { label: 'TACTICAL', alt: 90 },
            { label: 'AREA', alt: 45 },
            { label: 'CLOSE 2.5D', alt: 22 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              data-testid={`map-zoom-preset-${preset.label}`}
              onClick={() => onSetTacticalMapAltitude?.(preset.alt)}
              className="rounded-[2px] border-2 border-[#444444] bg-[#262626] hover:bg-[#333333] px-2 py-0.5 text-[10px] font-mono-num font-bold text-[#e5e5e5] cursor-pointer"
            >
              {preset.label} ({preset.alt}M)
            </button>
          ))}

          <button
            type="button"
            data-testid="map-zoom-in-btn"
            onClick={() => onZoomTacticalMap?.(0.8)}
            className="rounded-[2px] border-2 border-[#444444] bg-[#262626] hover:bg-[#333333] px-2 py-0.5 text-[11px] font-mono-num font-bold text-[#fbbf24] cursor-pointer"
          >
            ZOOM +
          </button>
          <button
            type="button"
            data-testid="map-zoom-out-btn"
            onClick={() => onZoomTacticalMap?.(1.25)}
            className="rounded-[2px] border-2 border-[#444444] bg-[#262626] hover:bg-[#333333] px-2 py-0.5 text-[11px] font-mono-num font-bold text-[#fbbf24] cursor-pointer"
          >
            ZOOM -
          </button>

          <button
            type="button"
            data-testid="map-toggle-25d-btn"
            onClick={() => onSetTacticalMapTopDown?.(!isTopDown)}
            className={`rounded-[2px] border-2 border-[#444444] px-2.5 py-0.5 text-[10px] font-mono-num font-bold uppercase cursor-pointer ${
              !isTopDown
                ? 'bg-[#fbbf24] text-[#1a1a1a]'
                : 'bg-[#262626] text-[#e5e5e5]'
            }`}
          >
            {!isTopDown ? 'VIEW: 2.5D PERSPECTIVE' : 'VIEW: TOP-DOWN'}
          </button>

          <button
            type="button"
            data-testid="map-toggle-grid-btn"
            onClick={() => {
              onToggleGrid?.();
              setLayers((prev) => ({
                ...prev,
                navigationAndGrid: !prev.navigationAndGrid,
              }));
            }}
            className={`rounded-[2px] border-2 border-[#444444] px-2.5 py-0.5 text-[10px] font-mono-num font-bold uppercase cursor-pointer ${
              (tacticalGridVisible ?? layers.navigationAndGrid)
                ? 'bg-[#fbbf24] text-[#1a1a1a]'
                : 'bg-[#262626] text-[#a3a3a3]'
            }`}
          >
            GRID: {(tacticalGridVisible ?? layers.navigationAndGrid) ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            data-testid="map-center-player-btn"
            onClick={() => onCenterTacticalMapOnPlayer?.()}
            className="rounded-[2px] border-2 border-[#444444] bg-[#6b7280] hover:bg-[#52525b] px-2 py-0.5 text-[10px] font-mono-num font-bold uppercase text-[#e5e5e5] cursor-pointer"
          >
            CENTER ON PLAYER
          </button>

          <button
            type="button"
            data-testid="close-fullscreen-map-btn"
            onClick={onClose}
            className="rounded-[2px] border-2 border-[#444444] bg-[#dc2626] hover:bg-[#b91c1c] px-3 py-1 text-xs font-display font-bold uppercase text-[#e5e5e5] cursor-pointer"
          >
            CLOSE [F / ESC]
          </button>
        </div>
      </div>

      {/* =====================================================================
          MIDDLE WORKSPACE: TRANSPARENT 3D CANVAS + RIGHT HUD SIDEBAR
          ===================================================================== */}
      <div className="relative flex-1 min-h-0 flex justify-end overflow-hidden">
        {/* Full-Screen Transparent Raycasting & HUD Canvas Overlay */}
        <canvas
          ref={canvasRef}
          data-testid="fullscreen-map-canvas"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
          className="absolute inset-0 w-full h-full pointer-events-auto cursor-crosshair block touch-none"
        />

        {/* Secondary Tool Bar (Floating Left) */}
        <div className="pointer-events-auto absolute top-3 left-3 z-10 flex flex-col gap-1.5 rounded-[2px] border-2 border-[#444444] bg-[#1a1a1a]/95 p-2 shadow-xl">
          <span className="text-[10px] font-mono-num uppercase text-[#a3a3a3]">
            INTERACTION TOOL:
          </span>
          {(
            [
              { id: 'PAN_SELECT', label: 'PAN & SELECT' },
              { id: 'ADD_WAYPOINT', label: '+ WAYPOINT' },
              { id: 'ADD_CONSTRUCTION', label: '+ BUILD SITE' },
              { id: 'RULER_AB', label: 'RULER [A→B]' },
              { id: 'DRAW_ROUTE', label: 'DRAW ROUTE' },
              { id: 'LOG_CRATER', label: '+ BLAST CRATER' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`map-tool-btn-${t.id}`}
              onClick={() => setActiveTool(t.id)}
              className={`rounded-[2px] border-2 border-[#444444] px-2 py-1 text-[10px] font-mono-num font-bold uppercase cursor-pointer text-left ${
                activeTool === t.id
                  ? 'bg-[#facc15] text-[#1a1a1a]'
                  : 'bg-[#262626] text-[#e5e5e5] hover:bg-[#333333]'
              }`}
            >
              {t.label}
            </button>
          ))}

          {/* Active Waypoint HUD */}
          {selectedWaypoint && activeWaypointMetrics && (
            <div
              data-testid="map-active-waypoint-hud"
              className="mt-1 border-t border-[#444444] pt-1.5 flex flex-col gap-0.5 text-[10px] font-mono-num"
            >
              <div className="font-bold text-[#fbbf24] truncate">
                NAV → {selectedWaypoint.name}:
              </div>
              <div className="text-[#e5e5e5]">
                DIST {activeWaypointMetrics.distance2DMeters}m (3D{' '}
                {activeWaypointMetrics.distance3DMeters}m)
              </div>
              <div className="text-[#38bdf8]">
                BRG {activeWaypointMetrics.bearingDegrees}°{' '}
                {activeWaypointMetrics.cardinalDirection}
              </div>
              <div
                className={
                  activeWaypointMetrics.elevationDeltaMeters >= 0
                    ? 'text-[#22c55e]'
                    : 'text-[#f97316]'
                }
              >
                ΔY {activeWaypointMetrics.elevationDeltaMeters >= 0 ? '+' : ''}
                {activeWaypointMetrics.elevationDeltaMeters}m
              </div>
            </div>
          )}
        </div>

        {/* Right Tactical Sidebar */}
        <div className="pointer-events-auto relative z-10 w-80 shrink-0 border-l-2 border-[#444444] bg-[#1a1a1a]/95 flex flex-col min-h-0 shadow-2xl">
          {renderTacticalSidebarContent()}
        </div>
      </div>

      {/* =====================================================================
          BOTTOM BAR: 3D CURSOR REAL-TIME TERRAIN TELEMETRY (X, Y, Z)
          ===================================================================== */}
      <div className="pointer-events-auto flex flex-wrap items-center justify-between border-t-2 border-[#444444] bg-[#1a1a1a]/95 px-3 py-1 text-[11px] font-mono-num text-[#e5e5e5] shadow-lg">
        <div className="flex items-center gap-2">
          <span>CONTROLS: WASD / DRAG TO PAN CAMERA · SCROLL TO ZOOM</span>
          <span className="text-[#a3a3a3]">· CLICK 3D TERRAIN TO PLACE WAYPOINTS</span>
        </div>
        <div data-testid="map-cursor-telemetry-bar" className="flex items-center gap-2">
          {cursorWorldCoords ? (
            <>
              <span data-testid="map-cursor-xyz" className="text-[#fbbf24] font-bold">
                CURSOR X:{cursorWorldCoords.x}m Y:{cursorWorldCoords.y}m Z:{cursorWorldCoords.z}m
              </span>
              <span className="text-[#38bdf8]">{cursorWorldCoords.biome}</span>
              {cursorWorldCoords.waterDepth > 0 && (
                <span className="text-[#7dd3fc]">
                  DEPTH: {cursorWorldCoords.waterDepth}m
                </span>
              )}
            </>
          ) : (
            <span className="text-[#a3a3a3]">HOVER CURSOR OVER 3D WORLD FOR (X,Y,Z)</span>
          )}
        </div>
      </div>
    </div>
  );
};
