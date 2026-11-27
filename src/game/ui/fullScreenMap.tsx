import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { isWaterBasinArea, type MicroVoxelWorld } from '../world';
import type { ModularVehicleRig } from '../vehicle';
import type { TeleportNode } from '../gameModesEngine';
import { isMobileDevice } from '../touchControls';

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
const SAVED_PATH_STORAGE_KEY = 'voxel_tactical_map_path_v1';

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

function loadSavedPathPoints(): MapRoutePoint[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(SAVED_PATH_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is MapRoutePoint =>
        p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number',
    );
  } catch {
    return [];
  }
}

function savePathPoints(points: MapRoutePoint[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SAVED_PATH_STORAGE_KEY, JSON.stringify(points));
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
  onTeleportToCoords?: (x: number, y: number, z: number) => void;
  onDeleteTeleportNode?: (nodeId: string) => void;
  onDropBeaconHere?: (name: string) => void;
  onRemoveBeacon?: (nodeId: string) => void;
}

const _projV3 = new THREE.Vector3();
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

interface UnifiedWaypointEntry {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  color: string;
  isCustom: boolean;
  nodeId?: string;
}

export const FullScreenMap: React.FC<FullScreenMapProps> = ({
  isOpen,
  onClose,
  world,
  localPlayerPos,
  localPlayerName,
  camera,
  tacticalCamState,
  onPanTacticalMap,
  onZoomTacticalMap,
  onSetTacticalMapAltitude,
  onCenterTacticalMapOnPlayer,
  teleportNodes = [],
  onTeleportToNode,
  onTeleportToCoords,
  onDeleteTeleportNode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const touchPinchDistRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number }>({ clientX: 0, clientY: 0 });
  const hasDraggedRef = useRef(false);

  const [isMobileMap, setIsMobileMap] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isMobileDevice() || window.innerWidth < 900 || window.innerHeight < 540;
  });

  useEffect(() => {
    const updateMobileMapMode = () => {
      if (typeof window === 'undefined') return;
      setIsMobileMap(
        isMobileDevice() || window.innerWidth < 900 || window.innerHeight < 540,
      );
    };
    window.addEventListener('resize', updateMobileMapMode);
    return () => window.removeEventListener('resize', updateMobileMapMode);
  }, []);

  // Only 3 clean interaction modes:
  // 'PAN_SELECT' (Click any waypoint to teleport)
  // 'ADD_WAYPOINT' (Click on map to add a waypoint)
  // 'DRAW_ROUTE' (Mark Path: click on map to add path points)
  const [activeTool, setActiveTool] = useState<MapInteractionTool>('PAN_SELECT');
  const activeToolRef = useRef<MapInteractionTool>('PAN_SELECT');
  activeToolRef.current = activeTool;

  const [customWaypoints, setCustomWaypoints] = useState<CustomMapWaypoint[]>(() =>
    loadCustomWaypoints(),
  );
  const customWaypointsRef = useRef<CustomMapWaypoint[]>(customWaypoints);
  customWaypointsRef.current = customWaypoints;

  const [wpDraftName, setWpDraftName] = useState<string>('');
  const [routePoints, setRoutePoints] = useState<MapRoutePoint[]>(() =>
    loadSavedPathPoints(),
  );
  const routePointsRef = useRef<MapRoutePoint[]>(routePoints);
  routePointsRef.current = routePoints;

  useEffect(() => {
    saveCustomWaypoints(customWaypoints);
  }, [customWaypoints]);

  useEffect(() => {
    savePathPoints(routePoints);
  }, [routePoints]);

  // Combine built-in teleport nodes and custom waypoints into a single Waypoints list
  const allWaypoints = useMemo<UnifiedWaypointEntry[]>(() => {
    const list: UnifiedWaypointEntry[] = [];
    for (const node of teleportNodes) {
      list.push({
        id: `node-${node.id}`,
        nodeId: node.id,
        name: node.name,
        x: Math.round(node.x),
        y: Number(node.y.toFixed(1)),
        z: Math.round(node.z),
        color: node.isPresetLandmark ? '#38bdf8' : '#22c55e',
        isCustom: !node.isPresetLandmark,
      });
    }
    for (const wp of customWaypoints) {
      list.push({
        id: wp.id,
        name: wp.name,
        x: Math.round(wp.x),
        y: Number(wp.y.toFixed(1)),
        z: Math.round(wp.z),
        color: wp.color || '#facc15',
        isCustom: true,
      });
    }
    return list;
  }, [teleportNodes, customWaypoints]);

  const allWaypointsRef = useRef<UnifiedWaypointEntry[]>(allWaypoints);
  allWaypointsRef.current = allWaypoints;

  const routeSummary = useMemo(() => computeMultiRouteSummary(routePoints), [routePoints]);

  const handleTeleportToWaypoint = useCallback(
    (wp: UnifiedWaypointEntry) => {
      if (onTeleportToCoords) {
        onTeleportToCoords(wp.x, wp.y, wp.z);
        return;
      }
      if (wp.nodeId && onTeleportToNode) {
        onTeleportToNode(wp.nodeId);
      }
    },
    [onTeleportToCoords, onTeleportToNode],
  );

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

      const sampleH = (wx: number, wz: number): number => {
        if (typeof (world as unknown as { sampleSurfaceHeightFast?: (x: number, z: number) => number }).sampleSurfaceHeightFast === 'function') {
          return (world as unknown as { sampleSurfaceHeightFast: (x: number, z: number) => number }).sampleSurfaceHeightFast(wx, wz);
        }
        return world.probeGroundBelow(wx, 80, wz, 0.4).y;
      };

      const denom = Math.max(0.0001, -ray.direction.y);
      let t = (camera.position.y - 0) / denom;
      let hitX = ray.origin.x + ray.direction.x * t;
      let hitZ = ray.origin.z + ray.direction.z * t;

      const y1 = sampleH(hitX, hitZ);
      t = (camera.position.y - y1) / denom;
      hitX = ray.origin.x + ray.direction.x * t;
      hitZ = ray.origin.z + ray.direction.z * t;
      const finalY = sampleH(hitX, hitZ);

      return {
        x: Number(hitX.toFixed(1)),
        y: Number(finalY.toFixed(1)),
        z: Number(hitZ.toFixed(1)),
      };
    },
    [camera, world],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const factor = e.deltaY < 0 ? 0.78 : 1.28;
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
      if (!isDraggingRef.current) return;
      const dx = e.clientX - dragStartRef.current.clientX;
      const dy = e.clientY - dragStartRef.current.clientY;
      if (Math.hypot(dx, dy) > 4) {
        hasDraggedRef.current = true;
      }
      const canvas = canvasRef.current;
      const alt = tacticalCamState?.altitude ?? 65;
      const rectHeight = canvas?.clientHeight ?? 600;
      const metersPerPx = (alt * 1.5) / Math.max(1, rectHeight);

      onPanTacticalMap?.(-dx * metersPerPx, -dy * metersPerPx);
      dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
    },
    [onPanTacticalMap, tacticalCamState?.altitude],
  );

  const executeMapPointClick = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (canvas && camera) {
        const rect = canvas.getBoundingClientRect();
        const clickSX = clientX - rect.left;
        const clickSY = clientY - rect.top;

        // Check if user clicked on a waypoint pin on screen -> Instant Teleport!
        if (activeToolRef.current === 'PAN_SELECT') {
          let bestWp: UnifiedWaypointEntry | null = null;
          let bestDistPx = 24;
          for (const wp of allWaypointsRef.current) {
            const proj = projectWorldToScreen(
              camera,
              wp.x,
              wp.y + 1.5,
              wp.z,
              rect.width,
              rect.height,
            );
            if (!proj.visible) continue;
            const dPx = Math.hypot(proj.sx - clickSX, proj.sy - clickSY);
            if (dPx <= bestDistPx) {
              bestDistPx = dPx;
              bestWp = wp;
            }
          }
          if (bestWp) {
            handleTeleportToWaypoint(bestWp);
            return;
          }
        }
      }

      const hit = raycastScreenToTerrain(clientX, clientY);
      if (!hit) return;

      const tool = activeToolRef.current;
      if (tool === 'ADD_WAYPOINT') {
        const newWp: CustomMapWaypoint = {
          id: `wp-${Date.now()}`,
          name:
            wpDraftName.trim() ||
            `Waypoint #${customWaypointsRef.current.length + 1}`,
          x: Math.round(hit.x),
          y: hit.y,
          z: Math.round(hit.z),
          color: '#facc15',
          icon: 'FLAG',
          createdAt: Date.now(),
        };
        setCustomWaypoints((prev) => [...prev, newWp]);
        setWpDraftName('');
        setActiveTool('PAN_SELECT');
        return;
      }

      if (tool === 'DRAW_ROUTE') {
        setRoutePoints((prev) => [
          ...prev,
          {
            id: `rt-${Date.now()}-${prev.length + 1}`,
            label: `P${prev.length + 1}`,
            x: Math.round(hit.x),
            y: hit.y,
            z: Math.round(hit.z),
          },
        ]);
      }
    },
    [camera, handleTeleportToWaypoint, raycastScreenToTerrain, wpDraftName],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const wasDragging = isDraggingRef.current;
      const didDrag = hasDraggedRef.current;
      isDraggingRef.current = false;
      if (!wasDragging || didDrag || e.button !== 0) return;
      executeMapPointClick(e.clientX, e.clientY);
    },
    [executeMapPointClick],
  );

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchPinchDistRef.current = Math.hypot(dx, dy);
      isDraggingRef.current = false;
      hasDraggedRef.current = true;
      return;
    }
    if (e.touches.length === 1) {
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
        if (touchPinchDistRef.current && touchPinchDistRef.current > 8 && dist > 8) {
          const ratio = touchPinchDistRef.current / dist;
          const clampedFactor = Math.max(0.75, Math.min(1.35, ratio));
          onZoomTacticalMap?.(clampedFactor);
        }
        touchPinchDistRef.current = dist;
        hasDraggedRef.current = true;
        return;
      }
      if (!isDraggingRef.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - dragStartRef.current.clientX;
      const dy = t.clientY - dragStartRef.current.clientY;
      if (Math.hypot(dx, dy) > 6) {
        hasDraggedRef.current = true;
      }
      const canvas = canvasRef.current;
      const alt = tacticalCamState?.altitude ?? 65;
      const rectHeight = canvas?.clientHeight ?? 600;
      const metersPerPx = (alt * 1.5) / Math.max(1, rectHeight);

      onPanTacticalMap?.(-dx * metersPerPx, -dy * metersPerPx);
      dragStartRef.current = { clientX: t.clientX, clientY: t.clientY };
    },
    [onPanTacticalMap, onZoomTacticalMap, tacticalCamState?.altitude],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length < 2) {
        touchPinchDistRef.current = null;
      }
      const wasDragging = isDraggingRef.current;
      const didDrag = hasDraggedRef.current;
      if (e.touches.length === 0) {
        isDraggingRef.current = false;
      }
      if (wasDragging && !didDrag && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        executeMapPointClick(t.clientX, t.clientY);
      }
    },
    [executeMapPointClick],
  );

  const handleAddWaypointAtPlayer = useCallback(() => {
    const newWp: CustomMapWaypoint = {
      id: `wp-${Date.now()}`,
      name:
        wpDraftName.trim() ||
        `Waypoint #${customWaypointsRef.current.length + 1}`,
      x: Math.round(localPlayerPos.x),
      y: Number(localPlayerPos.y.toFixed(1)),
      z: Math.round(localPlayerPos.z),
      color: '#facc15',
      icon: 'FLAG',
      createdAt: Date.now(),
    };
    setCustomWaypoints((prev) => [...prev, newWp]);
    setWpDraftName('');
  }, [localPlayerPos, wpDraftName]);

  const handleDeleteWaypointEntry = useCallback(
    (wp: UnifiedWaypointEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      if (wp.nodeId) {
        onDeleteTeleportNode?.(wp.nodeId);
      } else {
        setCustomWaypoints((prev) => prev.filter((item) => item.id !== wp.id));
      }
    },
    [onDeleteTeleportNode],
  );

  // Render clean 2D overlay canvas: ONLY Marked Path + Waypoint Pins + Player Position Dot
  useEffect(() => {
    if (!isOpen) return;
    let rafId = 0;

    const renderOverlay = () => {
      const canvas = canvasRef.current;
      if (canvas && camera) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          // 1. Draw Marked Path polyline & nodes
          const pts = routePointsRef.current;
          if (pts.length > 0) {
            const screenPts = pts.map((p) =>
              projectWorldToScreen(camera, p.x, p.y + 1.2, p.z, w, h),
            );
            if (screenPts.length >= 2) {
              ctx.save();
              ctx.strokeStyle = '#facc15';
              ctx.lineWidth = 3;
              ctx.setLineDash([8, 5]);
              ctx.beginPath();
              let started = false;
              for (let i = 0; i < screenPts.length; i++) {
                const sp = screenPts[i];
                if (!sp.visible) continue;
                if (!started) {
                  ctx.moveTo(sp.sx, sp.sy);
                  started = true;
                } else {
                  ctx.lineTo(sp.sx, sp.sy);
                }
              }
              ctx.stroke();
              ctx.restore();
            }

            for (let i = 0; i < screenPts.length; i++) {
              const sp = screenPts[i];
              if (!sp.visible) continue;
              ctx.fillStyle = '#141414';
              ctx.strokeStyle = '#facc15';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(sp.sx, sp.sy, 6, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();

              ctx.fillStyle = '#fef08a';
              ctx.font = 'bold 10px monospace';
              ctx.textAlign = 'center';
              ctx.fillText(`${i + 1}`, sp.sx, sp.sy - 10);
            }
          }

          // 2. Draw Waypoints (click any pin to teleport)
          for (const wp of allWaypointsRef.current) {
            const proj = projectWorldToScreen(camera, wp.x, wp.y + 1.5, wp.z, w, h);
            if (!proj.visible) continue;

            ctx.save();
            ctx.translate(proj.sx, proj.sy);

            // Pin box
            ctx.fillStyle = 'rgba(20, 20, 20, 0.92)';
            ctx.strokeStyle = wp.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = wp.color;
            ctx.beginPath();
            ctx.arc(0, 0, 4, 0, Math.PI * 2);
            ctx.fill();

            // Label pill
            ctx.font = 'bold 10px monospace';
            const labelText = wp.name;
            const tw = ctx.measureText(labelText).width;
            ctx.fillStyle = 'rgba(20, 20, 20, 0.88)';
            ctx.fillRect(-tw * 0.5 - 5, -26, tw + 10, 14);
            ctx.strokeStyle = wp.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(-tw * 0.5 - 5, -26, tw + 10, 14);

            ctx.fillStyle = '#f8fafc';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, 0, -19);
            ctx.restore();
          }

          // 3. Draw Local Player indicator
          const pProj = projectWorldToScreen(
            camera,
            localPlayerPos.x,
            localPlayerPos.y + 1.5,
            localPlayerPos.z,
            w,
            h,
          );
          if (pProj.visible) {
            ctx.save();
            ctx.translate(pProj.sx, pProj.sy);
            ctx.fillStyle = '#38bdf8';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = '#38bdf8';
            ctx.textAlign = 'center';
            ctx.fillText(localPlayerName || 'YOU', 0, 18);
            ctx.restore();
          }

          ctx.restore();
        }
      }
      rafId = window.requestAnimationFrame(renderOverlay);
    };

    rafId = window.requestAnimationFrame(renderOverlay);
    return () => window.cancelAnimationFrame(rafId);
  }, [isOpen, camera, localPlayerPos, localPlayerName]);

  if (!isOpen) return null;

  const altMeters = Math.round(tacticalCamState?.altitude ?? 65);
  const altLabel =
    altMeters >= 1000
      ? `${(altMeters / 1000).toFixed(1)} km`
      : `${altMeters} m`;
  const activeLodLayers = world?.activeTotalLodLayers ?? 1;

  return (
    <div
      data-testid="fullscreen-map-modal"
      className="fixed inset-0 z-[110] pointer-events-auto select-none overflow-hidden"
    >
      {/* Interactive 2D Overlay Canvas over live 3D World Map */}
      <canvas
        ref={canvasRef}
        data-testid="tactical-map-canvas"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`absolute inset-0 w-full h-full ${
          activeTool === 'PAN_SELECT' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
        }`}
      />

      {/* Top Bar: Clean Title, Mode Buttons (Waypoints / Mark Path), Zoom & Close */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-2 bg-[#141414]/95 border-2 border-[#444444] px-3 py-1.5 rounded-[2px] shadow-xl pointer-events-auto">
          <span className="text-xs font-display font-bold uppercase tracking-wider text-[#facc15]">
            WORLD MAP
          </span>
          <span className="text-[11px] font-mono-num text-[#a3a3a3]">
            ALT: <strong className="text-[#e5e5e5]">{altLabel}</strong> · LODs:{' '}
            <strong className="text-[#38bdf8]">{activeLodLayers}</strong>
          </span>
        </div>

        {/* Center Action Bar: Click to Teleport / Add Waypoint / Mark Path */}
        <div className="flex items-center gap-1.5 bg-[#141414]/95 border-2 border-[#444444] p-1 rounded-[2px] shadow-xl pointer-events-auto">
          <button
            type="button"
            data-testid="map-mode-teleport"
            onClick={() => setActiveTool('PAN_SELECT')}
            className={`px-2.5 py-1 text-[11px] font-display font-bold uppercase rounded-[2px] cursor-pointer transition-colors ${
              activeTool === 'PAN_SELECT'
                ? 'bg-[#38bdf8] text-[#090d16]'
                : 'bg-[#222222] text-[#d4d4d4] hover:bg-[#333333]'
            }`}
          >
            Waypoints (Click to TP)
          </button>
          <button
            type="button"
            data-testid="map-mode-add-waypoint"
            onClick={() =>
              setActiveTool((prev) =>
                prev === 'ADD_WAYPOINT' ? 'PAN_SELECT' : 'ADD_WAYPOINT',
              )
            }
            className={`px-2.5 py-1 text-[11px] font-display font-bold uppercase rounded-[2px] cursor-pointer transition-colors ${
              activeTool === 'ADD_WAYPOINT'
                ? 'bg-[#22c55e] text-[#090d16]'
                : 'bg-[#222222] text-[#d4d4d4] hover:bg-[#333333]'
            }`}
          >
            + Place Waypoint
          </button>
          <button
            type="button"
            data-testid="map-mode-mark-path"
            onClick={() =>
              setActiveTool((prev) =>
                prev === 'DRAW_ROUTE' ? 'PAN_SELECT' : 'DRAW_ROUTE',
              )
            }
            className={`px-2.5 py-1 text-[11px] font-display font-bold uppercase rounded-[2px] cursor-pointer transition-colors ${
              activeTool === 'DRAW_ROUTE'
                ? 'bg-[#facc15] text-[#090d16]'
                : 'bg-[#222222] text-[#d4d4d4] hover:bg-[#333333]'
            }`}
          >
            Mark Path
          </button>
        </div>

        {/* Zoom Controls (Unlimited Zoom-Out) & Close */}
        <div className="flex items-center gap-1.5 bg-[#141414]/95 border-2 border-[#444444] p-1 rounded-[2px] shadow-xl pointer-events-auto">
          <button
            type="button"
            title="Zoom In"
            onClick={() => onZoomTacticalMap?.(0.65)}
            className="px-2.5 py-1 bg-[#222222] hover:bg-[#333333] text-[#e5e5e5] text-xs font-mono-num font-bold rounded-[2px] cursor-pointer"
          >
            +
          </button>
          <button
            type="button"
            title="Zoom Out (Unlimited)"
            onClick={() => onZoomTacticalMap?.(1.6)}
            className="px-2.5 py-1 bg-[#222222] hover:bg-[#333333] text-[#e5e5e5] text-xs font-mono-num font-bold rounded-[2px] cursor-pointer"
          >
            −
          </button>
          <button
            type="button"
            title="Center on Player"
            onClick={() => {
              onCenterTacticalMapOnPlayer?.();
              onSetTacticalMapAltitude?.(90);
            }}
            className="px-2.5 py-1 bg-[#222222] hover:bg-[#333333] text-[#38bdf8] text-[11px] font-display font-bold uppercase rounded-[2px] cursor-pointer"
          >
            Center
          </button>
          <button
            type="button"
            data-testid="close-fullscreen-map-btn"
            onClick={onClose}
            className="px-3 py-1 bg-[#dc2626] hover:bg-[#ef4444] text-white text-[11px] font-display font-bold uppercase rounded-[2px] cursor-pointer"
          >
            Close [F]
          </button>
        </div>
      </div>

      {/* Compact Side Panel: Only Waypoints (Click to Teleport) & Mark Path Controls */}
      <div
        className={`absolute ${
          isMobileMap
            ? 'bottom-3 left-3 right-3 max-h-[46vh]'
            : 'top-16 left-3 w-72 max-h-[calc(100vh-5rem)]'
        } bg-[#141414]/95 border-2 border-[#444444] rounded-[2px] shadow-2xl flex flex-col overflow-hidden pointer-events-auto`}
      >
        {/* Waypoints Section */}
        <div className="p-2.5 border-b border-[#333333] flex items-center justify-between gap-2">
          <span className="text-[11px] font-display font-bold uppercase text-[#e5e5e5]">
            Waypoints (Click to Teleport)
          </span>
          <button
            type="button"
            onClick={handleAddWaypointAtPlayer}
            className="px-2 py-0.5 bg-[#22c55e] hover:bg-[#16a34a] text-[#090d16] text-[10px] font-display font-bold uppercase rounded-[2px] cursor-pointer"
          >
            + Drop Here
          </button>
        </div>

        {/* Optional Waypoint Name Input when adding */}
        <div className="px-2.5 py-1.5 border-b border-[#2a2a2a] flex items-center gap-1.5">
          <input
            type="text"
            value={wpDraftName}
            onChange={(e) => setWpDraftName(e.target.value)}
            placeholder="New waypoint name..."
            className="flex-1 min-w-0 bg-[#1f1f1f] border border-[#3a3a3a] px-2 py-1 text-[11px] text-[#e5e5e5] rounded-[2px] focus:outline-none focus:border-[#facc15]"
          />
        </div>

        {/* Waypoint List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#262626] max-h-60">
          {allWaypoints.map((wp) => (
            <div
              key={wp.id}
              data-testid={`waypoint-tp-item-${wp.id}`}
              onClick={() => handleTeleportToWaypoint(wp)}
              className="px-2.5 py-2 hover:bg-[#222222] active:bg-[#2a2a2a] flex items-center justify-between gap-2 cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: wp.color }}
                />
                <div className="min-w-0">
                  <div className="text-[11px] font-display font-bold text-[#e5e5e5] truncate group-hover:text-[#facc15]">
                    {wp.name}
                  </div>
                  <div className="text-[9.5px] font-mono-num text-[#9ca3af]">
                    ({wp.x}, {wp.z}) · Click to TP
                  </div>
                </div>
              </div>
              {wp.isCustom && (
                <button
                  type="button"
                  title="Remove Waypoint"
                  onClick={(e) => handleDeleteWaypointEntry(wp, e)}
                  className="w-5 h-5 flex items-center justify-center bg-[#262626] hover:bg-[#dc2626] text-[#a3a3a3] hover:text-white rounded-[2px] text-xs font-bold shrink-0 cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Mark Path Section */}
        <div className="p-2.5 border-t-2 border-[#333333] bg-[#1a1a1a] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-display font-bold uppercase text-[#facc15]">
              Mark Path ({routePoints.length} pts)
            </span>
            {routePoints.length >= 2 && (
              <span className="text-[10px] font-mono-num text-[#38bdf8]">
                {routeSummary.totalDistance2DMeters} m
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setActiveTool((prev) =>
                  prev === 'DRAW_ROUTE' ? 'PAN_SELECT' : 'DRAW_ROUTE',
                )
              }
              className={`flex-1 py-1 text-[10.5px] font-display font-bold uppercase rounded-[2px] cursor-pointer ${
                activeTool === 'DRAW_ROUTE'
                  ? 'bg-[#facc15] text-[#090d16]'
                  : 'bg-[#262626] text-[#e5e5e5] hover:bg-[#333333]'
              }`}
            >
              {activeTool === 'DRAW_ROUTE' ? 'Marking Path (Click Map)' : 'Start Marking'}
            </button>
            <button
              type="button"
              disabled={routePoints.length === 0}
              onClick={() => setRoutePoints((prev) => prev.slice(0, -1))}
              className="px-2 py-1 bg-[#262626] hover:bg-[#333333] disabled:opacity-40 text-[#e5e5e5] text-[10px] font-display font-bold uppercase rounded-[2px] cursor-pointer"
            >
              Undo
            </button>
            <button
              type="button"
              disabled={routePoints.length === 0}
              onClick={() => setRoutePoints([])}
              className="px-2 py-1 bg-[#262626] hover:bg-[#dc2626] disabled:opacity-40 text-[#e5e5e5] hover:text-white text-[10px] font-display font-bold uppercase rounded-[2px] cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
