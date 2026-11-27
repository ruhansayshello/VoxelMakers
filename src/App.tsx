import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { perfProfiler } from './engine/perf/PerfProfiler';
import {
  VOXEL_SIZE,
  TOTAL_VX,
  TOTAL_VZ,
  WATER_LEVEL,
  SYMMETRY_CENTER_X,
  MAT,
  MAT_INFO,
  BUILD_SLOTS,
  BUILD_CATEGORY_META,
  BINDABLE_KEYS,
  PLAY_SLOTS,
  PRESET_NAMES,
  DIR_NAMES,
  AXIS_ROT_NAMES,
  CAMERA_MODES,
  PLACEMENT_MODES,
  OBJECT_STUDIO_SLOTS,
  WORLD_GEN_BIOMES,
  VEHICLE_SKINS,
  isWheelOrTireModuleKind,
  TIRE_TRACTION_PRESETS,
  type VehicleSkinId,
  type BuildCategory,
  type BuildSlotItem,
  type ModuleKind,
  type ModuleTuningConfig,
  type CameraViewMode,
  type BuildPlacementMode,
  type WorldGenMode,
  type WorldEditToolKind,
  type SerializedVehicleBlueprint,
} from './game/constants';
import {
  computePlacementVoxelCoords,
  computeFloodFillPaintCoords,
  computeFaceExtrudeCoords,
  isSameBuildObjectCoord,
  findAllSameBuildObjects,
  resolveShiftObjectSelection,
  mergeBuildObjectSelections,
  filterObjectsInScreenBox,
  computeAvatarAnimationPose,
  canPlayerMoveHorizontal,
  stepPlayerJetpackAndJump,
  type SelectableBuildObject,
  type RotationAxis,
} from './game/physicsMath';
import {
  PREBUILT_OBJECTS,
  generateProceduralHeightmapPreset,
  type VoxelObjectPrefab,
} from './game/worldObjects';
import { SoundFX } from './game/sound';
import { ProceduralAudio } from './game/audio';
import { MicroVoxelWorld, isWaterBasinArea, type MicroVoxelChunk } from './game/world';
import { TerrainEntity, terrainEntityManager } from './game/physics/terrainEntity';
import { VoxelFXSystem } from './game/fx';
import { ModularVehicleRig, type SubAssemblyPrefab } from './game/vehicle';
import {
  HULL_SHAPE_OPTIONS,
  HULL_STAMP_MODES,
  SYMMETRY_AXIS_OPTIONS,
  SYMMETRY_CENTER_Z,
  DEFAULT_HULL_SCALE_PX,
  MICRO_VOXEL_SIZE,
  MICRO_VOXEL_SUBDIV,
  clampHullScalePx,
  toggleHullStampScalePx,
  computeScaledAnchorOrigin,
  computeScaledHullPlacementCoords,
  computeMicroFaceExtrudeCoords,
  microBlockCenterMeters,
  type HullMicroShape,
  type SymmetryAxisMode,
} from './game/microHullBlocks';
import { isMicroVoxelDestructibleKind } from './game/microVoxelBlocks';
import {
  WorldArenaSystemsManager,
  type ArenaTrapKind,
  type WeatherDisasterMode,
  type AIBotBehaviorMode,
  type CustomTrackNodeKind,
  type CrashTelemetryReport,
} from './game/worldSystems';
import {
  VOXEL_ENTITY_PRESETS,
  createVoxelEntityRig,
  createCustomPropRig,
  buildPropTemplateVoxels,
  spawnDefaultArenaVoxelEntities,
  getVoxelEntityPresetSpec,
  type VoxelEntityPresetId,
  type PropTemplateKind,
} from './game/voxelEntities';
import {
  MAP_HAZARD_PRESETS,
  KinematicMapHazard,
  spawnMapHazardOnTerrain,
  spawnDefaultArenaMapHazards,
  stepMapHazardsPhysics,
  stepPlayerMapHazardsInteraction,
  raycastAllMapHazards,
  damageAllMapHazardsInRadius,
  type MapHazardPresetId,
} from './game/mapHazards';
import {
  captureCustomWorldSave,
  applyCustomWorldSaveToTerrain,
  loadSavedWorldsFromStorage,
  saveWorldToStorage,
  deleteSavedWorldFromStorage,
  exportWorldSaveJson,
  parseWorldSaveJson,
  type SerializedCustomWorldSave,
} from './game/worldSaveSystem';
import { packVoxelKey } from './game/physics/collisionPoints';
import { igniteC4Voxel, updateC4System } from './game/physics/c4System';
import {
  classifyEntityPhysicsLodTier,
  resetUnifiedEngineFrameTelemetry,
  unifiedEngineTelemetry,
} from './game/unifiedVoxelEngine';
import {
  computeSmartVehicleAIControls,
  getEligibleAIRigs,
  type TerrainProber,
} from './game/aiPilot';
import {
  AiFleetModal,
  AI_ROLES,
  AI_TEAMS,
  AI_PERSONALITIES,
} from './game/ui/aiFleetModal';
import { MobileTouchControls } from './game/MobileTouchControls';
import {
  isMobileDevice,
  isMobilePopupLayout,
  getTouchModeOverride,
  setTouchModeOverride,
  computeRenderDistanceTuning,
  type TouchModeOverride,
} from './game/touchControls';
import {
  CHUNK_SIZE_METERS_BIGINT,
  computeDynamicLodPlan,
  computeOpticalZoomTargetPoint,
  createBigSectorPosition,
  formatChunksBigInt,
  formatHorizonDistanceBigInt,
  MAX_LOD_SPACING,
  MAX_RENDER_DISTANCE_CHUNKS,
  MAX_RENDER_DISTANCE_CHUNKS_BIGINT,
  MIN_LOD_SPACING,
  MIN_RENDER_DISTANCE_CHUNKS,
  parseRenderDistanceInputToChunksBigInt,
  sanitizePositiveRenderDistanceBigInt,
  SLIDER_MAX_RENDER_DISTANCE_CHUNKS,
  type BigSectorPosition,
} from './game/distantHorizonMath';
import {
  createInitialFrameGovernorState,
  createDefaultFrameGovernorConfig,
  stepFrameGovernor,
  getStoredAutoSlowMo,
  setStoredAutoSlowMo,
  getStoredAntiFreezeWatchdog,
  setStoredAntiFreezeWatchdog,
  getStoredCrashSlowMo,
  setStoredCrashSlowMo,
  type FrameGovernorState,
  type FrameGovernorConfig,
  type FrameGovernorStepResult,
} from './game/frameGovernor';
import {
  GRAPHICS_PRESETS,
  getVoxelDrawDistanceBigInt,
  loadStoredGraphicsSettings,
  saveStoredGraphicsSettings,
  sanitizeGraphicsSettings,
  countActiveGraphicsFeatures,
  resolveVisualQualityTier,
  shouldUseRealisticWater,
  worldGenModeToShaderId,
  type GraphicsSettings,
  type GraphicsPresetId,
  type ShadowMapResolution,
  type PlanarReflectionResolution,
} from './game/graphicsSettings';
import {
  detectHardwareTier,
  resolveTargetFps,
  shouldRenderCappedFrame,
  parseFrameRateCapInput,
  formatFrameRateCapSummary,
  FRAME_RATE_CAP_OPTIONS,
  type HardwareTierDetectionResult,
} from './game/frameRateCap';
import { VoxelGraphicsPipeline } from './game/graphicsPipeline';
import {
  detectLowEndGpu,
  applyMeshMaterialPresetSwap,
  BlobShadowInstancedManager,
  disposeSharedPotatoShaderResources,
  BUILTIN_SHADER_PRESETS,
  loadCustomShaderPresets,
  saveCustomShaderPreset,
  deleteCustomShaderPreset,
  applyCustomShaderPresetToMaterials,
  getActiveCustomShaderPreset,
  restoreActiveCustomShaderPreset,
  type CustomShaderPreset,
} from './game/potatoShader';
import { disposeSharedModelCaches } from './game/models';
import {
  voxelizeGlbFile,
  voxelizeGlbSceneWithGpu,
  DEFAULT_GLB_RESOLUTION,
} from './game/glbVoxelizer';
import {
  getSharedBuildPreviewRenderer,
  type HotbarPreviewSlotTarget,
} from './game/buildPreviewRenderer';
import {
  P2PMultiplayerManager,
  MULTIPLAYER_BADGE_COLORS,
  createVoxelCharacterAvatar,
  applyAvatarPose,
  type MultiplayerLobbyUIState,
  type SpawnVehiclePacket,
  type ActiveRoomSummary,
} from './game/multiplayer';
import {
  updateCharacterAnimation,
  type CharacterEquippedTool,
} from './game/playerModel';
import {
  createPlayerRagdollState,
  activatePlayerRagdoll,
  deactivatePlayerRagdoll,
  stepPlayerRagdoll,
  applyRagdollToRig,
  resetRigFromRagdoll,
  beginRagdollGetUp,
  stepRagdollGetUp,
  type PlayerRagdollState,
} from './game/playerRagdoll';
import { EcuScratchStudio } from './game/EcuScratchStudio';
import {
  serializeEcuProgramToJson,
  saveEcuProgramToLibrary,
  ECU_STARTER_TEMPLATES,
} from './game/logicSystem';
import {
  ModRegistry,
  DEFAULT_CHECKPOINT_COURSE,
  type ModBlockBehavior,
} from './game/modRegistry';
import {
  MAX_TELEPORT_NODES,
  createInitialTeleportState,
  addTeleportNode,
  removeTeleportNode,
  recordCombatDamage,
  getCombatCooldownRemainingSec,
  initiateTeleportToNode,
  stepTeleportSpinup,
  saveLastBuildAutoSave,
  loadLastBuildAutoSave,
  clearLastBuildAutoSave,
  shouldPromptRestoreLastBuild,
  DEFAULT_DERBY_STRUCTURES,
  createInitialDestructionDerbyState,
  stepDestructionDerby,
  BUILDING_CHALLENGE_PROMPTS,
  evaluateBuildingChallengeResult,
  createInitialCtfState,
  stepCtfPlayerPosition,
  createInitialBuildBattleState,
  launchBuildBattleArena,
  createInitialSurvivalWavesState,
  stepSurvivalWaves,
  createInitialKingOfTheHillState,
  stepKingOfTheHill,
  createInitialStuntFreestyleState,
  stepStuntFreestyle,
  type TeleportSystemState,
  type LastBuildAutoSavePayload,
  type DestructionDerbyState,
  type BuildingChallengeEvaluation,
  type CtfMatchState,
  type BuildBattleState,
  type SurvivalWavesState,
  type KingOfTheHillState,
  type StuntFreestyleState,
} from './game/gameModesEngine';
import dat from 'dat.gui';
import { PHYSICS_CONFIG, VEHICLE_TUNING_PROFILES } from './game/physics';
import { FIXED_DT as PHYSICS_FIXED_DT } from './game/physics/integrator';
import { SpatialHashBroadphase } from './game/physics/broadphase';
import { stepAllVehicleCollisions } from './game/physics/vehicleVehicleCollision';
import { VehicleIntegrityDiagram } from './game/ui/vehicleIntegrityDiagram';
import { SpeedometerGauge } from './game/ui/SpeedometerGauge';
import {
  type HudCustomSettings,
  DEFAULT_HUD_CUSTOM_SETTINGS,
  loadHudCustomSettings,
  saveHudCustomSettings,
  clampWidgetBoxToViewport,
  getWidgetState,
  patchWidgetState,
  getWidgetTransformStyle,
  registerHudUiMode,
} from './game/ui/hudCustomization';
import { HudLayoutEditorModal } from './game/ui/HudLayoutEditorModal';
import { FullScreenMap } from './game/ui/fullScreenMap';
import {
  publishHudTelemetry,
  useHudTelemetry,
  LiveHudField,
  LiveCockpitHorizonSvg,
  type LiveHudTelemetry,
} from './game/ui/hudTelemetryStore';

const selectFpsFrameMs = (t: LiveHudTelemetry) =>
  `${t.fps} FPS · ${t.frameMs}ms${t.isSlowMoActive ? ` · ${Math.round(t.timeScale * 100)}%` : ''}`;
const selectFpsOnly = (t: LiveHudTelemetry) => `${t.fps} FPS`;
const selectRayTarget = (t: LiveHudTelemetry) => t.rayTarget;
const selectPitchDeg = (t: LiveHudTelemetry) => t.pitchDeg;
const selectRollDeg = (t: LiveHudTelemetry) => t.rollDeg;
const selectAltitude = (t: LiveHudTelemetry) => t.altitudeMeters;
const selectSpeedKmh = (t: LiveHudTelemetry) => t.speedKmh;
const selectEngineRpm = (t: LiveHudTelemetry) => t.engineRpm;
const selectHullPct = (t: LiveHudTelemetry) => t.structuralIntegrityPct;
const selectLodSummary = (t: LiveHudTelemetry) => t.lodSummary;
const selectTimeScalePct = (t: LiveHudTelemetry) => `${Math.round(t.timeScale * 100)}%`;

const LiveSpeedometerGauge = React.memo(function LiveSpeedometerGauge(
  props: Omit<React.ComponentProps<typeof SpeedometerGauge>, 'speedKmh'>,
) {
  const speedKmh = useHudTelemetry(selectSpeedKmh);
  return <SpeedometerGauge {...props} speedKmh={speedKmh} />;
});

const LiveMobileTouchControls = React.memo(function LiveMobileTouchControls(
  props: Omit<
    React.ComponentProps<typeof MobileTouchControls>,
    'speedKmh' | 'integrityPct'
  >,
) {
  const speedKmh = useHudTelemetry(selectSpeedKmh);
  const integrityPct = useHudTelemetry(selectHullPct);
  return (
    <MobileTouchControls
      {...props}
      speedKmh={speedKmh}
      integrityPct={integrityPct}
    />
  );
});

type GameScreenState = 'title' | 'playing' | 'paused';
type BuildCameraAngle = 'ORBIT_3D' | 'TOP' | 'SIDE' | 'FRONT';

const BUILD_CAM_LABELS: Record<BuildCameraAngle, string> = {
  ORBIT_3D: '3/4 Orbit',
  TOP: 'Top Blueprint',
  SIDE: 'Side Profile',
  FRONT: 'Front Elevation',
};

const STORAGE_KEY_BLUEPRINTS = 'voxelmakers_saved_blueprints_v1';
const STORAGE_KEY_CUSTOM_OBJECTS = 'voxelmakers_custom_objects_v1';
const STORAGE_KEY_GLB_MAPS = 'voxel_saved_glb_maps_v1';

interface SavedGlbMapRecord {
  id: string;
  name: string;
  createdAt: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  scaleFactor?: number;
  voxelCount: number;
  voxels: Array<[number, number, number, number, number?, number?, number?]>;
}

interface HudSnapshot {
  fps: number;
  frameMs: string;
  rayTarget: string;
  presetName: string;
  presetIndex: number;
  massKg: number;
  buoyancyRatio: string;
  voxelCount: number;
  moduleCount: number;
  powerCores: number;
  dimensionsMeters: string;
  statusLabel: string;
  speedKmh: number;
  engineRpm: number;
  altitudeMeters: string;
  pitchDeg: number;
  rollDeg: number;
  isBuildMode: boolean;
  isObjectStudioMode: boolean;
  isWorldEditMode: boolean;
  worldEditTool: WorldEditToolKind;
  worldGenMode: WorldGenMode;
  propPhysicsMode: 'DYNAMIC' | 'STATIC';
  selectedObjectId: string;
  selectedVoxelEntityId: VoxelEntityPresetId;
  voxelEntitiesCount: number;
  selectedMapHazardId: MapHazardPresetId;
  mapHazardsCount: number;
  terraBrushRadius: number;
  terraPaintMat: number;
  isSeatedInRig: boolean;
  isPointerLocked: boolean;
  mirrorMode: boolean;
  symmetryAxisMode: SymmetryAxisMode;
  xrayMode: boolean;
  eyedropperMode: boolean;
  showForces: boolean;
  partYawIndex: number;
  partPitchIndex: number;
  partRollIndex: number;
  caveAtmospherePct: number;
  placementMode: BuildPlacementMode;
  hullScalePx: number;
  boxDepthPx: number;
  hullShape: HullMicroShape;
  ghostSummary: {
    dimsLabel: string;
    count: number;
    massDeltaKg: number;
  };
  cameraMode: CameraViewMode;
  buildCameraAngle: BuildCameraAngle;
  selectedSlot: number;
  nearVehiclePrompt: boolean;
  voxelsDestroyed: number;
  detachedIslands: number;
  pistonExtended: boolean;
  winchActive: boolean;
  pistonCount: number;
  winchCount: number;
  gyroCount: number;
  thrusterCount: number;
  cannonCount: number;
  structuralIntegrityPct: number;
  damagedBlockCount: number;
  lodSummary: string;
  undoCount: number;
  redoCount: number;
  muted: boolean;
  gyroEnabled: boolean;
  headlightsOn: boolean;
  hasIntactSeat: boolean;
  creationsCount: number;
  activeCreationIdx: number;
  creationsList: Array<{
    name: string;
    massKg: number;
    blocks: number;
    powerCores: number;
    distMeters: number;
    isSeated: boolean;
  }>;
  hoveredModule: {
    kind: ModuleKind;
    vx: number;
    vy: number;
    vz: number;
    config?: ModuleTuningConfig;
  } | null;
  selectedBuildObject: SelectableBuildObject | null;
  selectedBuildObjects: SelectableBuildObject[];
  speedTrapMaxKmh: number;
  speedTrapLastKmh: number;
  maxAirtimeSec: string;
  currentAirtimeSec: string;
  timeScale: number;
  isSlowMoActive: boolean;
  slowMoReason: 'NONE' | 'AUTO_FPS' | 'MANUAL';
  watchdogProtecting: boolean;
  isZoomed: boolean;
  zoomMagnification: number;
  zoomFocusDistMeters: number;
}

function loadSavedBlueprintsFromStorage(): SerializedVehicleBlueprint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BLUEPRINTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadCustomObjectsFromStorage(): VoxelObjectPrefab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_OBJECTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSavedGlbMapsFromStorage(): SavedGlbMapRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GLB_MAPS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface AutoDismissToastProps {
  testId?: string;
  durationMs: number;
  accentColor: string;
  onDismiss: () => void;
  children: React.ReactNode;
  className?: string;
  isMobile?: boolean;
}

const AutoDismissToast: React.FC<AutoDismissToastProps> = ({
  testId,
  durationMs,
  accentColor,
  onDismiss,
  children,
  className = '',
  isMobile = false,
}) => {
  const [remainingPct, setRemainingPct] = useState(100);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const startMs = performance.now();
    const interval = window.setInterval(() => {
      const elapsed = performance.now() - startMs;
      const pct = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setRemainingPct(pct);
      if (elapsed >= durationMs) {
        window.clearInterval(interval);
        onDismissRef.current();
      }
    }, 50);
    return () => window.clearInterval(interval);
  }, [durationMs]);

  return (
    <div
      data-testid={testId}
      data-layout-mode={isMobile ? 'mobile' : 'laptop'}
      className={`bg-[#1a1a1a]/95 border-2 text-[#e5e5e5] rounded-[2px] shadow-2xl pointer-events-auto touch-manipulation relative overflow-hidden ${
        isMobile ? 'w-full px-2.5 pt-1 pb-1' : 'w-full px-3.5 pt-2.5 pb-2'
      } ${className}`}
      style={{ borderColor: accentColor }}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={`flex-1 min-w-0 font-mono-num ${
            isMobile ? 'text-[10.5px] leading-tight' : 'text-xs'
          }`}
        >
          {children}
        </div>
        <button
          type="button"
          onClick={() => onDismissRef.current()}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDismissRef.current();
          }}
          title="Dismiss notification"
          className={`${
            isMobile ? 'w-6 h-6 text-xs' : 'w-5 h-5 text-[11px]'
          } shrink-0 flex items-center justify-center bg-[#262626] hover:bg-[#dc2626] active:bg-[#dc2626] text-[#e5e5e5] border border-[#444444] rounded-[2px] font-bold leading-none cursor-pointer touch-manipulation`}
        >
          ×
        </button>
      </div>
      {/* Small Countdown Timer Bar */}
      <div
        className={`w-full bg-[#262626] rounded-[1px] overflow-hidden ${
          isMobile ? 'h-[3px] mt-1' : 'h-1 mt-1.5'
        }`}
      >
        <div
          data-testid={testId ? `${testId}-timer-bar` : undefined}
          className="h-full transition-all duration-75 ease-linear"
          style={{
            width: `${remainingPct}%`,
            backgroundColor: accentColor,
          }}
        />
      </div>
    </div>
  );
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const previewOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpsBadgeRef = useRef<HTMLSpanElement | null>(null);
  const perfOverlayRef = useRef<HTMLPreElement | null>(null);
  const marqueeBoxRef = useRef<HTMLDivElement | null>(null);
  const marqueeBadgeRef = useRef<HTMLSpanElement | null>(null);

  const initialAutoStart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [gameState, setGameState] = useState<GameScreenState>(
    initialAutoStart ? 'playing' : 'title',
  );
  const [spawnChunkReady, setSpawnChunkReady] = useState(false);
  const [initialLoadingPct, setInitialLoadingPct] = useState(25);
  const [initialLoadingStage, setInitialLoadingStage] = useState(
    'Initializing 0.25m Micro-Voxel Engine & Rigid-Body Physics...',
  );
  const [buildCategory, setBuildCategory] = useState<BuildCategory>('ALL');
  const [showGarageModal, setShowGarageModal] = useState(false);
  const [showWorldGenModal, setShowWorldGenModal] = useState(false);
  const [savedBlueprints, setSavedBlueprints] = useState<
    SerializedVehicleBlueprint[]
  >(() => loadSavedBlueprintsFromStorage());
  const [customObjects, setCustomObjects] = useState<VoxelObjectPrefab[]>(() =>
    loadCustomObjectsFromStorage(),
  );
  const [objectStudioName, setObjectStudioName] = useState('Custom Stunt Prop');
  const [rHoldProgress, setRHoldProgress] = useState(0);
  const rHoldStartTimeRef = useRef<number | null>(null);
  const rLongPressFiredRef = useRef<boolean>(false);
  const [propCategoryTab, setPropCategoryTab] = useState<
    'ALL' | 'PROPS' | 'STUNT' | 'HAZARD' | 'BUILDING' | 'CUSTOM'
  >('ALL');
  const [propMakerTemplate, setPropMakerTemplate] = useState<PropTemplateKind>('CRATE');
  const [worldGenFeedback, setWorldGenFeedback] = useState('');
  const [savedCustomWorlds, setSavedCustomWorlds] = useState<
    SerializedCustomWorldSave[]
  >(() => loadSavedWorldsFromStorage());
  const [customWorldNameInput, setCustomWorldNameInput] = useState(
    'My Shredder Stunt Park',
  );
  const [customWorldShareJson, setCustomWorldShareJson] = useState('');
  const [heightmapScaleY, setHeightmapScaleY] = useState(28);
  const [blueprintNameInput, setBlueprintNameInput] = useState('Custom TrailRig Mk1');
  const [shareCodeText, setShareCodeText] = useState('');
  const [garageFeedback, setGarageFeedback] = useState('');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const dockCollapsedRef = useRef(false);
  dockCollapsedRef.current = dockCollapsed;
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [recentBuildSlotIds, setRecentBuildSlotIds] = useState<number[]>([
    1, 2, 4, 5, 6, 8,
  ]);
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const previewRenderer = getSharedBuildPreviewRenderer();
  const slotElementsRef = useRef<Map<string, Set<HTMLElement>>>(new Map());
  const [hoveredSlotKey, setHoveredSlotKey] = useState<string | null>(null);
  const hoveredSlotKeyRef = useRef<string | null>(null);

  const handleSlotHover = useCallback((key: string | null) => {
    hoveredSlotKeyRef.current = key;
    setHoveredSlotKey(key);
  }, []);

  const [renderDistChunks, setRenderDistChunks] = useState(() =>
    isMobileDevice() ? 3 : 12,
  );
  const [customRenderDistInput, setCustomRenderDistInput] = useState(() =>
    String(isMobileDevice() ? 3 : 12),
  );
  const [resScale, setResScale] = useState(0.65);
  const [wavesQuality, setWavesQuality] = useState<'OFF' | 'LOW' | 'MEDIUM' | 'HIGH'>(
    () => loadStoredGraphicsSettings(isMobileDevice()).waveQuality || 'OFF',
  );
  const [camFov, setCamFov] = useState(68);
  const [shadowsEnabled, setShadowsEnabled] = useState(true);
  const [autoSlowMoEnabled, setAutoSlowMoEnabled] = useState(() =>
    getStoredAutoSlowMo(),
  );
  const [manualSlowMoActive, setManualSlowMoActive] = useState(false);
  const [antiFreezeWatchdogEnabled, setAntiFreezeWatchdogEnabled] = useState(() =>
    getStoredAntiFreezeWatchdog(),
  );
  const [maxVehiclesLimit, setMaxVehiclesLimit] = useState<number>(
    PHYSICS_CONFIG.limits.defaultMaxVehicles,
  );
  const maxVehiclesLimitRef = useRef<number>(
    PHYSICS_CONFIG.limits.defaultMaxVehicles,
  );
  maxVehiclesLimitRef.current = maxVehiclesLimit;
  const [isMobileHud, setIsMobileHud] = useState(() => isMobileDevice());
  const [isMobilePopup, setIsMobilePopup] = useState(() =>
    isMobilePopupLayout({ isMobileHud: isMobileDevice() }),
  );
  const [garageMobSection, setGarageMobSection] = useState<'ALL' | 'RIGS' | 'SAVED' | 'JSON'>('ALL');
  const [worldGenMobSection, setWorldGenMobSection] = useState<'ALL' | 'BIOMES' | 'HEIGHTMAP' | 'SAVELOAD'>('ALL');
  const [chooseMapMobSection, setChooseMapMobSection] = useState<'ALL' | 'MAPS' | 'IMPORT'>('ALL');
  const [touchOverrideState, setTouchOverrideState] = useState<TouchModeOverride>(
    () => getTouchModeOverride(),
  );
  useEffect(() => {
    const syncTouchState = () => {
      const mobileHud = isMobileDevice();
      setIsMobileHud(mobileHud);
      setIsMobilePopup(isMobilePopupLayout({ isMobileHud: mobileHud }));
      setTouchOverrideState(getTouchModeOverride());
    };
    window.addEventListener('resize', syncTouchState);
    window.addEventListener('voxelmakers-touch-mode-change', syncTouchState);
    return () => {
      window.removeEventListener('resize', syncTouchState);
      window.removeEventListener('voxelmakers-touch-mode-change', syncTouchState);
    };
  }, []);
  const [graphicsState, setGraphicsState] = useState<GraphicsSettings>(() =>
    loadStoredGraphicsSettings(isMobileDevice(), detectLowEndGpu()),
  );
  const [hardwareTierInfo, setHardwareTierInfo] = useState<HardwareTierDetectionResult>(() =>
    detectHardwareTier(null, { isMobile: isMobileDevice() }),
  );
  const [hudCustom, setHudCustom] = useState<HudCustomSettings>(() =>
    loadHudCustomSettings(),
  );
  const [showHudEditorModal, setShowHudEditorModal] = useState(false);
  const updateHudCustom = useCallback((patch: Partial<HudCustomSettings>) => {
    setHudCustom((prev) => saveHudCustomSettings({ ...prev, ...patch }));
  }, []);
  const resetHudCustom = useCallback(() => {
    setHudCustom(saveHudCustomSettings({ ...DEFAULT_HUD_CUSTOM_SETTINGS }));
  }, []);

  const [pauseTab, setPauseTab] = useState<'graphics' | 'settings' | 'creations' | 'controls'>('graphics');
  const [creationsCountState, setCreationsCountState] = useState(1);
  const [activeCreationIdxState, setActiveCreationIdxState] = useState(0);
  const [garageSpawnMode, setGarageSpawnMode] = useState<'replace' | 'spawn_new'>('replace');
  const [configRefreshTick, setConfigRefreshTick] = useState(0);
  const [listeningKeyTarget, setListeningKeyTarget] = useState<'posKey' | 'negKey' | null>(null);
  const [isVoxelizingGlb, setIsVoxelizingGlb] = useState(false);
  const [glbProgress, setGlbProgress] = useState<{ pct: number; stage: string }>({
    pct: 0,
    stage: '',
  });
  const [savedGlbMaps, setSavedGlbMaps] = useState<SavedGlbMapRecord[]>(() =>
    loadSavedGlbMapsFromStorage(),
  );
  const [glbScaleFactor, setGlbScaleFactor] = useState(1);
  const [glbTargetResolution, setGlbTargetResolution] = useState<number>(
    DEFAULT_GLB_RESOLUTION,
  );
  const [showChooseMapModal, setShowChooseMapModal] = useState(false);
  const [activeMapLabel, setActiveMapLabel] = useState(
    'Default Map (Stunt Park & Ocean)',
  );
  const [skinFeedback, setSkinFeedback] = useState('');
  const [showMultiplayerModal, setShowMultiplayerModal] = useState(false);
  const [showStudioDropdown, setShowStudioDropdown] = useState(false);
  const [showPropsPopover, setShowPropsPopover] = useState(false);
  const [showEcuModal, setShowEcuModal] = useState(false);
  const [showAiFleetModal, setShowAiFleetModal] = useState(false);
  const [showModStudioModal, setShowModStudioModal] = useState(false);
  const [modStudioTab, setModStudioTab] = useState<'MODES' | 'BLOCKS' | 'JSON'>('MODES');
  const [modStudioFeedback, setModStudioFeedback] = useState('');
  const [modPackJsonInput, setModPackJsonInput] = useState('');
  const [modPackNameInput, setModPackNameInput] = useState('Custom Internal Mod Pack');
  const [, setModRegistryTick] = useState(0);

  // Weather & Environment Presets, AI Patrol Convoy, Impact Slow-Mo, Turret Aim & Proving Grounds Missions
  const [weatherPreset, setWeatherPreset] = useState<
    'DAYLIGHT' | 'GOLDEN_SUNSET' | 'MIDNIGHT_NEON' | 'STORMY_OCEAN' | 'ARCTIC_ICE'
  >('DAYLIGHT');
  const weatherPresetRef = useRef(weatherPreset);
  weatherPresetRef.current = weatherPreset;

  const [aiTrafficEnabled, setAiTrafficEnabled] = useState(false);
  const aiTrafficEnabledRef = useRef(aiTrafficEnabled);
  aiTrafficEnabledRef.current = aiTrafficEnabled;

  const [impactSlowMoEnabled, setImpactSlowMoEnabled] = useState(() =>
    getStoredCrashSlowMo(),
  );
  const impactSlowMoEnabledRef = useRef(impactSlowMoEnabled);
  impactSlowMoEnabledRef.current = impactSlowMoEnabled;
  const toggleCrashSlowMo = useCallback((force?: boolean) => {
    setImpactSlowMoEnabled((prev) => {
      const next = typeof force === 'boolean' ? force : !prev;
      setStoredCrashSlowMo(next);
      return next;
    });
  }, []);

  const [turretCamAimEnabled, setTurretCamAimEnabled] = useState(true);
  const turretCamAimEnabledRef = useRef(turretCamAimEnabled);
  turretCamAimEnabledRef.current = turretCamAimEnabled;

  const [activeMissionId, setActiveMissionId] = useState<
    'NONE' | 'BRIDGE_CARGO' | 'CATAPULT_CHANNEL' | 'SUBMARINE_TRENCH'
  >('NONE');
  const activeMissionIdRef = useRef(activeMissionId);
  activeMissionIdRef.current = activeMissionId;
  const [missionProgressText, setMissionProgressText] = useState('');
  const [missionCompleted, setMissionCompleted] = useState(false);
  const missionCompletedRef = useRef(false);
  missionCompletedRef.current = missionCompleted;

  // 1. Fast-Travel Teleport Nodes & Map [F] State
  const [teleportState, setTeleportState] = useState<TeleportSystemState>(() =>
    createInitialTeleportState(),
  );
  const teleportStateRef = useRef<TeleportSystemState>(teleportState);
  teleportStateRef.current = teleportState;
  const [showFastTravelMap, setShowFastTravelMap] = useState(false);
  const showFastTravelMapRef = useRef(false);
  showFastTravelMapRef.current = showFastTravelMap;
  const [newBeaconNameInput, setNewBeaconNameInput] = useState('Custom Base Beacon');
  const fastTravelMapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 2. Screenshot Mode [F12] State (Hides all UI, freezes simulation, lets camera orbit)
  const [isScreenshotMode, setIsScreenshotMode] = useState(false);
  const isScreenshotModeRef = useRef(false);
  isScreenshotModeRef.current = isScreenshotMode;

  // 3. "Last Build" Auto-Save Recovery Prompt State
  const [pendingLastBuildRestore, setPendingLastBuildRestore] =
    useState<LastBuildAutoSavePayload | null>(() => {
      const loaded = loadLastBuildAutoSave();
      return shouldPromptRestoreLastBuild(loaded) ? loaded : null;
    });

  // 4. Six Game Modes Live State (Destruction Derby, Building Challenge, CTF, Build Battle, Survival Waves)
  const [derbyState, setDerbyState] = useState<DestructionDerbyState>(() =>
    createInitialDestructionDerbyState(0, 0),
  );
  const derbyStateRef = useRef<DestructionDerbyState>(derbyState);
  derbyStateRef.current = derbyState;

  const [buildingChallengePromptIdx, setBuildingChallengePromptIdx] = useState(0);
  const buildingChallengePromptIdxRef = useRef(0);
  buildingChallengePromptIdxRef.current = buildingChallengePromptIdx;
  const [buildingChallengeTimerSec, setBuildingChallengeTimerSec] = useState(300);
  const [buildingChallengeTesting, setBuildingChallengeTesting] = useState(false);
  const [buildingChallengeResult, setBuildingChallengeResult] = useState<{
    evalResult: BuildingChallengeEvaluation;
    photoDataUrl: string;
    promptTitle: string;
  } | null>(null);
  const buildingChallengeTestMetricsRef = useRef<{
    active: boolean;
    promptIdx: number;
    remainingSec: number;
    startPos: { x: number; z: number };
    peakSpeedKmh: number;
  }>({
    active: false,
    promptIdx: 0,
    remainingSec: 0,
    startPos: { x: 0, z: 0 },
    peakSpeedKmh: 0,
  });

  const [ctfState, setCtfState] = useState<CtfMatchState>(() =>
    createInitialCtfState('BLUE'),
  );
  const ctfStateRef = useRef<CtfMatchState>(ctfState);
  ctfStateRef.current = ctfState;

  const [buildBattleState, setBuildBattleState] = useState<BuildBattleState>(() =>
    createInitialBuildBattleState(0),
  );
  const buildBattleStateRef = useRef<BuildBattleState>(buildBattleState);
  buildBattleStateRef.current = buildBattleState;

  const [survivalState, setSurvivalState] = useState<SurvivalWavesState>(() =>
    createInitialSurvivalWavesState(),
  );
  const survivalStateRef = useRef<SurvivalWavesState>(survivalState);
  survivalStateRef.current = survivalState;

  const [kingOfHillState, setKingOfHillState] = useState<KingOfTheHillState>(() =>
    createInitialKingOfTheHillState(),
  );
  const kingOfHillStateRef = useRef<KingOfTheHillState>(kingOfHillState);
  kingOfHillStateRef.current = kingOfHillState;

  const [stuntFreestyleState, setStuntFreestyleState] = useState<StuntFreestyleState>(() =>
    createInitialStuntFreestyleState(0),
  );
  const stuntFreestyleStateRef = useRef<StuntFreestyleState>(stuntFreestyleState);
  stuntFreestyleStateRef.current = stuntFreestyleState;

  // Custom Shader Preset Studio State
  const [shaderPresets, setShaderPresets] = useState<CustomShaderPreset[]>(() =>
    loadCustomShaderPresets(),
  );
  const [editingShaderPreset, setEditingShaderPreset] = useState<CustomShaderPreset>(() =>
    restoreActiveCustomShaderPreset(),
  );
  const [customShaderNameInput, setCustomShaderNameInput] = useState('My Neon Cel Preset');
  const [shaderFeedback, setShaderFeedback] = useState('');
  const [showBeginnerGuide, setShowBeginnerGuide] = useState(true);
  const [quickSaveToast, setQuickSaveToast] = useState('');
  const [showTitleVehiclesDrawer, setShowTitleVehiclesDrawer] = useState(false);
  const [showTitleModesDrawer, setShowTitleModesDrawer] = useState(false);
  const [minimalHudMode, setMinimalHudMode] = useState(true);
  const [showBuildMoreTools, setShowBuildMoreTools] = useState(false);
  const [showSkinsPanel, setShowSkinsPanel] = useState(false);
  const [mobilePopupOpen, setMobilePopupOpen] = useState(false);

  const anyOverlayMenuOpen =
    gameState !== 'playing' ||
    showHudEditorModal ||
    showFastTravelMap ||
    showGarageModal ||
    showModStudioModal ||
    showAiFleetModal ||
    showWorldGenModal ||
    showChooseMapModal ||
    showMultiplayerModal ||
    showEcuModal ||
    showBuildMoreTools ||
    showStudioDropdown ||
    showPropsPopover ||
    mobilePopupOpen;
  const anyOverlayMenuOpenRef = useRef(false);
  anyOverlayMenuOpenRef.current = anyOverlayMenuOpen;

  // Builder Power Tools, World Arena Systems, Race Track & Cockpit HUD State
  const [savedSubAssemblies, setSavedSubAssemblies] = useState<SubAssemblyPrefab[]>([]);
  const [activeStampPrefab, setActiveStampPrefab] = useState<SubAssemblyPrefab | null>(null);
  const activeStampPrefabRef = useRef<SubAssemblyPrefab | null>(null);
  activeStampPrefabRef.current = activeStampPrefab;
  const [ghostBlueprintActive, setGhostBlueprintActive] = useState(false);
  const [showWiringLines, setShowWiringLines] = useState(false);
  const [weatherDisasterMode, setWeatherDisasterMode] = useState<WeatherDisasterMode>('CALM');
  const [aiBotBehavior, setAiBotBehavior] = useState<AIBotBehaviorMode>('OFF');
  const [targetDronesEnabled, setTargetDronesEnabled] = useState(false);
  const [lastCrashTelemetry, setLastCrashTelemetry] = useState<CrashTelemetryReport | null>(null);
  const [cockpitHudEnabled, setCockpitHudEnabled] = useState(true);

  // Custom Mod Block Creator Form State
  const [newModBlockName, setNewModBlockName] = useState('Quantum Thruster Block');
  const [newModBlockType, setNewModBlockType] = useState<'voxel' | 'module'>('voxel');
  const [newModBlockCategory, setNewModBlockCategory] =
    useState<Exclude<BuildCategory, 'ALL'>>('CHASSIS');
  const [newModBlockColor, setNewModBlockColor] = useState('#38bdf8');
  const [newModBlockMass, setNewModBlockMass] = useState(8);
  const [newModBlockBehavior, setNewModBlockBehavior] =
    useState<ModBlockBehavior>('ANTI_GRAV_HOVER');
  const [newModBlockHp, setNewModBlockHp] = useState(35000);
  const [newModBlockHoverForce, setNewModBlockHoverForce] = useState(35);
  const [newModBlockBounce, setNewModBlockBounce] = useState(2.4);
  const [newModModuleKind, setNewModModuleKind] = useState<ModuleKind>('JET_RAW');
  const [newModModuleStrength, setNewModModuleStrength] = useState(2.5);

  // Custom Game Mode Creator Form State
  const [newModeName, setNewModeName] = useState('Turbo Stunt Arena');
  const [newModeDesc, setNewModeDesc] = useState(
    'Custom gravity & engine overdrive rules.',
  );
  const [newModeGravity, setNewModeGravity] = useState(0.65);
  const [newModeEngineMult, setNewModeEngineMult] = useState(1.8);
  const [newModeThrusterMult, setNewModeThrusterMult] = useState(2.0);
  const [newModeExplosionMult, setNewModeExplosionMult] = useState(1.8);
  const [newModeIndestructible, setNewModeIndestructible] = useState(false);
  const [newModeCheckpoints, setNewModeCheckpoints] = useState(true);
  const [newModeDemolition, setNewModeDemolition] = useState(true);

  const [showIntegrityDiagram, setShowIntegrityDiagram] = useState<boolean>(
    PHYSICS_CONFIG.integrityDiagram.defaultEnabled,
  );
  const [joinRoomCodeInput, setJoinRoomCodeInput] = useState('');
  const [mpToast, setMpToast] = useState('');
  const [activeRooms, setActiveRooms] = useState<ActiveRoomSummary[]>([]);
  const [mpState, setMpState] = useState<MultiplayerLobbyUIState>({
    status: 'disconnected',
    role: 'none',
    roomCode: '',
    localPeerId: '',
    playerName: 'Pilot_01',
    playerColor: MULTIPLAYER_BADGE_COLORS[0],
    players: [],
    errorMessage: null,
  });

  const refreshActiveRooms = useCallback(async () => {
    const mp = simRef.current?.multiplayer;
    if (!mp) return;
    const rooms = await mp.fetchActiveRooms();
    setActiveRooms(rooms);
  }, []);

  useEffect(() => {
    if (!showMultiplayerModal) return;
    refreshActiveRooms();
    const id = window.setInterval(refreshActiveRooms, 2500);
    return () => window.clearInterval(id);
  }, [showMultiplayerModal, refreshActiveRooms]);

  const [hud, setHud] = useState<HudSnapshot>({
    fps: 60,
    frameMs: '16.6',
    rayTarget: 'Driving Rig',
    presetName: PRESET_NAMES[0],
    presetIndex: 0,
    massKg: 8090,
    buoyancyRatio: '1.0x',
    voxelCount: 780,
    moduleCount: 10,
    powerCores: 8,
    dimensionsMeters: '3.5m × 2.0m × 6.5m',
    statusLabel: 'GROUNDED (4W)',
    speedKmh: 0,
    engineRpm: 850,
    altitudeMeters: '1.8m',
    pitchDeg: 0,
    rollDeg: 0,
    isBuildMode: false,
    isObjectStudioMode: false,
    isWorldEditMode: false,
    worldEditTool: 'PLACE_OBJECT',
    worldGenMode: 'DEFAULT_PARK',
    propPhysicsMode: 'DYNAMIC',
    selectedObjectId: PREBUILT_OBJECTS[0].id,
    selectedVoxelEntityId: 'TRAFFIC_CONE',
    voxelEntitiesCount: 16,
    selectedMapHazardId: 'SAW_BLADE_VERTICAL',
    mapHazardsCount: 4,
    terraBrushRadius: 8,
    terraPaintMat: MAT.GRASS,
    isSeatedInRig: true,
    isPointerLocked: false,
    mirrorMode: true,
    symmetryAxisMode: 'X',
    xrayMode: false,
    eyedropperMode: false,
    showForces: true,
    partYawIndex: 0,
    partPitchIndex: 0,
    partRollIndex: 0,
    caveAtmospherePct: 0,
    placementMode: 'SINGLE',
    hullScalePx: DEFAULT_HULL_SCALE_PX,
    boxDepthPx: 1,
    hullShape: 'CUBE',
    ghostSummary: { dimsLabel: '', count: 0, massDeltaKg: 0 },
    cameraMode: 'CHASE',
    buildCameraAngle: 'ORBIT_3D',
    selectedSlot: 1,
    nearVehiclePrompt: false,
    voxelsDestroyed: 0,
    detachedIslands: 0,
    pistonExtended: false,
    winchActive: false,
    pistonCount: 0,
    winchCount: 0,
    gyroCount: 0,
    thrusterCount: 2,
    cannonCount: 1,
    structuralIntegrityPct: 100,
    damagedBlockCount: 0,
    lodSummary: 'L0:25 L1:24 L2:32 · 8 CORES',
    undoCount: 0,
    redoCount: 0,
    muted: false,
    gyroEnabled: false,
    headlightsOn: false,
    hasIntactSeat: true,
    creationsCount: 1,
    activeCreationIdx: 0,
    creationsList: [],
    hoveredModule: null,
    selectedBuildObject: null,
    selectedBuildObjects: [],
    speedTrapMaxKmh: 0,
    speedTrapLastKmh: 0,
    maxAirtimeSec: '0.0',
    currentAirtimeSec: '0.0',
    timeScale: 1.0,
    isSlowMoActive: false,
    slowMoReason: 'NONE',
    watchdogProtecting: false,
    isZoomed: false,
    zoomMagnification: 4,
    zoomFocusDistMeters: 0,
  });

  const dismissedCrashTimestampRef = useRef<number>(0);
  const [seatAlertDismissed, setSeatAlertDismissed] = useState(false);
  const [nearVehicleToastDismissed, setNearVehicleToastDismissed] = useState(false);

  useEffect(() => {
    if (hud.hasIntactSeat) {
      setSeatAlertDismissed(false);
    }
  }, [hud.hasIntactSeat]);

  useEffect(() => {
    if (!hud.nearVehiclePrompt || hud.isSeatedInRig) {
      setNearVehicleToastDismissed(false);
    }
  }, [hud.nearVehiclePrompt, hud.isSeatedInRig]);

  const simRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    world: MicroVoxelWorld;
    fx: VoxelFXSystem;
    rig: ModularVehicleRig;
    activeVehicle: ModularVehicleRig | null;
    isWalking: boolean;
    playerCharacterMesh: THREE.Group;
    multiplayer: P2PMultiplayerManager;
    enterVehicle: (targetVehicle: ModularVehicleRig) => void;
    exitVehicle: () => void;
    updateCamera: (dt: number, now?: number) => void;
    creations: ModularVehicleRig[];
    voxelEntities: ModularVehicleRig[];
    selectedVoxelEntityId: VoxelEntityPresetId;
    mapHazards: KinematicMapHazard[];
    selectedMapHazardId: MapHazardPresetId;
    worldArenaSystems: WorldArenaSystemsManager;
    activeCreationIndex: number;
    getActiveRig: () => ModularVehicleRig;
    getAllPhysicsRigs: () => ModularVehicleRig[];
    getClosestCreation: (pos: THREE.Vector3) => { rig: ModularVehicleRig; index: number; dist: number };
    getClosestRigOrEntity: (pos: THREE.Vector3) => { rig: ModularVehicleRig; dist: number };
    spawnVoxelEntityAt: (
      presetId?: VoxelEntityPresetId,
      wx?: number,
      wz?: number,
      yawRad?: number,
      heightOffsetMeters?: number,
    ) => ModularVehicleRig;
    resetArenaVoxelEntities: () => void;
    clearVoxelEntities: () => void;
    selectVoxelEntityPreset: (presetId: VoxelEntityPresetId) => void;
    selectMapHazardPreset: (presetId: MapHazardPresetId) => void;
    spawnMapHazardAt: (
      presetId?: MapHazardPresetId,
      wx?: number,
      wz?: number,
      yawRad?: number,
      explicitWY?: number,
    ) => KinematicMapHazard;
    clearMapHazards: () => void;
    resetArenaMapHazards: () => void;
    saveCustomWorldSnapshot: (name: string) => SerializedCustomWorldSave;
    loadCustomWorldSnapshot: (save: SerializedCustomWorldSave) => void;
    spawnNewCreation: (presetIdx?: number, bp?: SerializedVehicleBlueprint) => ModularVehicleRig;
    duplicateActiveCreation: () => ModularVehicleRig;
    duplicateCreationAt: (idx: number) => ModularVehicleRig;
    deleteActiveCreation: () => boolean;
    deleteCreationAt: (idx: number) => boolean;
    driveCreationAt: (idx: number) => boolean;
    cycleActiveCreation: () => number;
    setActiveCreation: (idx: number) => void;
    setRenderDistance: (chunks: number | bigint | string, uncappedLod?: boolean) => void;
    setResolutionScale: (scale: number) => void;
    setWaveQuality: (q: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH') => void;
    setFov: (fov: number) => void;
    setShadows: (enabled: boolean) => void;
    graphicsSettings: GraphicsSettings;
    hardwareTierInfo: HardwareTierDetectionResult;
    getEffectiveTargetFps: () => number;
    graphicsPipeline: VoxelGraphicsPipeline;
    updateGraphicsSettings: (patch: Partial<GraphicsSettings>) => void;
    applyGraphicsPreset: (presetId: Exclude<GraphicsPresetId, 'CUSTOM'>) => void;
    frameGovernorState: FrameGovernorState;
    frameGovernorConfig: FrameGovernorConfig;
    lastGovernorStep: FrameGovernorStepResult | null;
    setAutoSlowMo: (enabled: boolean) => void;
    toggleManualSlowMo: (force?: boolean) => void;
    setAntiFreezeWatchdog: (enabled: boolean) => void;
    baseFov: number;
    baseFogDensity: number;
    isZoomed: boolean;
    zoomMagnification: number;
    zoomFocusDistMeters: number;
    zoomFocusCX: number;
    zoomFocusCZ: number;
    zKeyDownTimeMs: number;
    toggleZoom: (force?: boolean) => boolean;
    setZoomMagnification: (mag: number) => void;
    stepZoomMagnification: (dir: 1 | -1) => void;
    applyOpticalZoomAndTarget: (dt: number) => void;
    selectionWireframe: THREE.LineSegments;
    selectedObjectWireframe: THREE.LineSegments;
    tacticalMapCam: {
      x: number;
      z: number;
      targetX: number;
      targetZ: number;
      altitude: number;
      targetAltitude: number;
      isTopDown: boolean;
    };
    initTacticalMapCam: (playerPos?: { x: number; y: number; z: number }) => void;
    updateTacticalMapCamera: (dt: number, now?: number) => void;
    panTacticalMap: (dxMeters: number, dzMeters: number) => void;
    zoomTacticalMap: (factor: number) => void;
    setTacticalMapAltitude: (alt: number) => void;
    setTacticalMapTopDown: (topDown: boolean) => void;
    centerTacticalMapOnPlayer: () => void;
    focusTacticalMapOn: (wx: number, wz: number) => void;
    tacticalGridMesh: THREE.GridHelper;
    tacticalGridVisible: boolean;
    setTacticalGridVisible: (visible: boolean) => void;
    gameState: GameScreenState;
    isBuildMode: boolean;
    isObjectStudioMode: boolean;
    isWorldEditMode: boolean;
    worldEditTool: WorldEditToolKind;
    propPhysicsMode: 'DYNAMIC' | 'STATIC';
    selectedObjectId: string;
    terraBrushRadius: number;
    terraPaintMat: number;
    rampStartWorld: THREE.Vector3 | null;
    savedVehicleBeforeStudio: SerializedVehicleBlueprint | null;
    allPlaceableObjects: VoxelObjectPrefab[];
    isSeatedInRig: boolean;
    selectedSlot: number;
    placementMode: BuildPlacementMode;
    hullScalePx: number;
    boxDepthPx: number;
    hullShape: HullMicroShape;
    eyedropperMode: boolean;
    setHullScalePx: (px: number) => void;
    stepHullScale: (delta: number) => void;
    toggleHullStampMode: () => void;
    setBoxDepthPx: (depth: number) => void;
    stepBoxDepthPx: (delta: number) => void;
    setHullShape: (shape: HullMicroShape) => void;
    cycleHullShape: () => void;
    toggleEyedropperMode: (force?: boolean) => void;
    sampleHoveredObjectToBrush: () => boolean;
    toggleXrayMode: (force?: boolean) => boolean;
    setSymmetryAxisMode: (mode: SymmetryAxisMode) => void;
    cycleSymmetryAxisMode: () => SymmetryAxisMode;
    copySelectionToStamp: () => SubAssemblyPrefab | null;
    cameraMode: CameraViewMode;
    buildCameraAngle: BuildCameraAngle;
    isPointerLocked: boolean;
    camFreePos: THREE.Vector3;
    buildOrbitPivot: THREE.Vector3;
    buildOrbitDist: number;
    playerVelY: number;
    playerPeakAirY: number;
    playerKnockbackVel: THREE.Vector3;
    playerRagdoll: PlayerRagdollState;
    triggerPlayerRagdoll: (
      velX: number,
      velY: number,
      velZ: number,
      spinStrength?: number,
    ) => void;
    recoverFromRagdoll: (silent?: boolean) => void;
    camYaw: number;
    camPitch: number;
    driveYawOffset: number;
    drivePitchOffset: number;
    driveOrbitDist: number;
    lastMouseMoveTime: number;
    titleOrbitAngle: number;
    introSwoopProgress: number;
    keys: Record<string, boolean>;
    pointerNDC: THREE.Vector2;
    hasPointerMoved: boolean;
    isOrbitDragging: boolean;
    isLeftMouseDown: boolean;
    isRightMouseDown: boolean;
    dragStartVoxel: { vx: number; vy: number; vz: number } | null;
    dragStartMicro: { mx: number; my: number; mz: number } | null;
    lastPaintedKey: string;
    currentHit: {
      target: 'vehicle' | 'world';
      vx: number;
      vy: number;
      vz: number;
      mx?: number;
      my?: number;
      mz?: number;
      hitIsMicro?: boolean;
      mat: number;
      moduleHit?: {
        kind: ModuleKind;
        vx: number;
        vy: number;
        vz: number;
        yawIdx: number;
        pitchIdx?: number;
        rollIdx?: number;
        config?: ModuleTuningConfig;
      };
      normal: { x: number; y: number; z: number };
      worldPos?: THREE.Vector3;
      distance?: number;
    } | null;
    selectedBuildObject: SelectableBuildObject | null;
    selectedBuildObjects: SelectableBuildObject[];
    marqueeSelect: {
      startX: number;
      startY: number;
      curX: number;
      curY: number;
      additive: boolean;
      baseSelection: SelectableBuildObject[];
      clickedHitObj: SelectableBuildObject | null;
    } | null;
    setMultiSelection: (
      objs: SelectableBuildObject[],
      playSound?: boolean,
    ) => void;
    selectBuildObjectAt: (
      obj: SelectableBuildObject | null,
      shiftKey?: boolean,
    ) => void;
    selectAllSameAsCurrent: () => number;
    deleteSelectedObject: () => boolean;
    duplicateSelectedObject: () => boolean;
    rotateSelectedObject: (axis?: RotationAxis) => boolean;
    moveSelectedObject: (
      dx: number,
      dy: number,
      dz: number,
      skipUndoPush?: boolean,
    ) => boolean;
    nudgeSelectedObjectCameraRelative: (
      forwardStep: number,
      rightStep: number,
      upStep: number,
      skipUndoPush?: boolean,
    ) => boolean;
    rotateEntireVehicle: (axis: RotationAxis) => void;
    pickSelectedObjectToBrush: () => void;
    recolorSelectedVoxel: (newMat: number) => void;
    toggleHoverBuildMode: (forceState?: boolean) => void;
    toggleObjectStudioMode: (forceState?: boolean) => void;
    saveCustomObjectAndEquip: (name: string) => VoxelObjectPrefab;
    loadPrefabIntoObjectStudio: (prefab: VoxelObjectPrefab) => void;
    loadPropMakerTemplate: (template: PropTemplateKind) => void;
    saveCurrentBuildAsProp: (customName?: string, switchMode?: boolean) => VoxelObjectPrefab;
    testDriveAgainstCurrentProp: (customName?: string) => void;
    setPropPhysicsMode: (mode: 'DYNAMIC' | 'STATIC') => void;
    togglePropPhysicsMode: () => void;
    spawnCurrentPropInFront: () => void;
    resetPartRotation: () => void;
    toggleWorldEditMode: (forceState?: boolean) => void;
    setWorldEditTool: (tool: WorldEditToolKind) => void;
    selectPlaceableObject: (id: string) => void;
    setTerraPaintMat: (mat: number) => void;
    setTerraBrushRadius: (rad: number) => void;
    regenerateUnlimitedWorld: (
      mode: WorldGenMode,
      flatMat?: number,
      heightmap?: { width: number; height: number; heights: Uint8Array; scaleY: number } | null,
    ) => void;
    startVehicleFromSingleVoxel: () => void;
    focusBuildCamera: () => void;
    cycleBuildCameraAngle: () => void;
    cycleCameraMode: (mode?: CameraViewMode) => void;
    setPlacementMode: (mode: BuildPlacementMode) => void;
    cyclePlacementMode: () => void;
    toggleEnterExitRig: () => void;
    setUiMode: (modeId: 'DRIVE' | 'BUILD' | 'WALK' | 'WORLD_EDIT' | 'PROP_STUDIO') => void;
    callAndUprightRig: () => void;
    selectPreset: (idx: number) => void;
    selectSlot: (slot: number) => void;
    flipSummonRig: () => void;
    toggleMirrorMode: () => void;
    toggleForcesOverlay: () => void;
    rotatePartYaw: () => void;
    rotatePartAxis: (axis: RotationAxis) => void;
    undoBuildStep: () => boolean;
    redoBuildStep: () => boolean;
    requestCanvasPointerLock: () => void;
    saveCurrentVehicle: (customName: string) => SerializedVehicleBlueprint;
    loadSavedVehicle: (bp: SerializedVehicleBlueprint) => void;
    startGame: () => void;
    pauseGame: () => void;
    resumeGame: () => void;
    restartSandbox: () => void;
  } | null>(null);

  // Dynamically register all game UI modes for the HUD Layout Editor so switching UI modes works automatically
  useEffect(() => {
    const cleanups = [
      registerHudUiMode({
        id: 'DRIVE',
        label: 'DRIVE UI',
        order: 10,
        isActive: () => {
          const s = simRef.current;
          return !s || (!s.isBuildMode && !s.isWorldEditMode && s.isSeatedInRig);
        },
        activate: () => simRef.current?.setUiMode('DRIVE'),
      }),
      registerHudUiMode({
        id: 'BUILD',
        label: 'BUILD UI',
        order: 20,
        isActive: () => {
          const s = simRef.current;
          return Boolean(s && s.isBuildMode && !s.isObjectStudioMode);
        },
        activate: () => simRef.current?.setUiMode('BUILD'),
      }),
      registerHudUiMode({
        id: 'WALK',
        label: 'WALK UI',
        order: 30,
        isActive: () => {
          const s = simRef.current;
          return Boolean(s && !s.isBuildMode && !s.isWorldEditMode && !s.isSeatedInRig);
        },
        activate: () => simRef.current?.setUiMode('WALK'),
      }),
      registerHudUiMode({
        id: 'WORLD_EDIT',
        label: 'WORLD / TERRA UI',
        order: 40,
        isActive: () => {
          const s = simRef.current;
          return Boolean(s && !s.isBuildMode && s.isWorldEditMode);
        },
        activate: () => simRef.current?.setUiMode('WORLD_EDIT'),
      }),
      registerHudUiMode({
        id: 'PROP_STUDIO',
        label: 'PROP MAKER UI',
        order: 50,
        isActive: () => {
          const s = simRef.current;
          return Boolean(s && s.isBuildMode && s.isObjectStudioMode);
        },
        activate: () => simRef.current?.setUiMode('PROP_STUDIO'),
      }),
    ];
    return () => {
      for (const fn of cleanups) fn();
    };
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isHeadless =
      navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x5b9bd5);
    scene.fog = new THREE.Fog(0x5b9bd5, 108, 172);

    // Pooled InstancedMesh manager for ALL vehicle & voxel-entity blob shadows (1 draw call total)
    const blobShadowManager = new BlobShadowInstancedManager(32);
    scene.userData.blobShadowManager = blobShadowManager;
    scene.add(blobShadowManager.mesh);

    const camera = new THREE.PerspectiveCamera(
      68,
      window.innerWidth / window.innerHeight,
      0.35,
      420,
    );
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      precision: 'highp',
      logarithmicDepthBuffer: true,
      preserveDrawingBuffer: isHeadless,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 0.9;
    const isInIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(
      isHeadless ? 1 : Math.min(window.devicePixelRatio || 1, isInIframe ? 1.25 : 1.5),
    );
    renderer.shadowMap.enabled = !isHeadless;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Defer previewOverlayRenderer creation until build mode is opened to save startup time and VRAM
    let previewOverlayRenderer: THREE.WebGLRenderer | null = null;
    const pooledPreviewTargets: HotbarPreviewSlotTarget[] = [];
    const clearPreviewOverlay = () => {
      if (previewOverlayRenderer) {
        previewOverlayRenderer.setScissorTest(false);
        previewOverlayRenderer.setClearColor(0x000000, 0);
        previewOverlayRenderer.clear();
      }
      if (previewOverlayCanvasRef.current) {
        previewOverlayCanvasRef.current.style.visibility = 'hidden';
      }
    };

    const hemiLight = new THREE.HemisphereLight(0x87a8c8, 0x2d3b45, 0.68);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff4dc, 1.04);
    sunLight.position.set(45, 42, 55);
    sunLight.castShadow = !isHeadless;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.near = 1.0;
    sunLight.shadow.camera.far = 140.0;
    sunLight.shadow.camera.left = -28.0;
    sunLight.shadow.camera.right = 28.0;
    sunLight.shadow.camera.top = 28.0;
    sunLight.shadow.camera.bottom = -28.0;
    sunLight.shadow.bias = -0.0014;
    sunLight.shadow.normalBias = 0.115;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const fillLight = new THREE.DirectionalLight(0x6b8ead, 0.36);
    fillLight.position.set(-40, 25, -45);
    scene.add(fillLight);

    const isLowEndGpu = detectLowEndGpu(renderer);
    const detectedHardwareTier = detectHardwareTier(renderer, {
      isMobile: isMobileDevice(),
      isLowEndGpu,
    });
    setHardwareTierInfo(detectedHardwareTier);
    const initialGfx = loadStoredGraphicsSettings(
      isHeadless || isMobileDevice(),
      isLowEndGpu,
    );
    setGraphicsState(initialGfx);
    const initialDrawDistBig =
      isHeadless || isMobileDevice()
        ? isHeadless
          ? 2n
          : 3n
        : getVoxelDrawDistanceBigInt(initialGfx);
    const initialDrawDist =
      initialDrawDistBig > BigInt(MAX_RENDER_DISTANCE_CHUNKS)
        ? MAX_RENDER_DISTANCE_CHUNKS
        : Number(initialDrawDistBig);
    const world = new MicroVoxelWorld(
      scene,
      isHeadless,
      initialDrawDist,
      initialGfx.usePotatoShader,
      initialGfx.lodSpacing,
    );
    applyCustomShaderPresetToMaterials(restoreActiveCustomShaderPreset());
    world.setPotatoShaderMode(initialGfx.usePotatoShader);
    if (initialGfx.useCartoonShader) {
      world.setCartoonShaderMode(true);
    }
    world.setWaveQuality(initialGfx.waveQuality || 'OFF');
    world.fogEnabled = initialGfx.fog;
    const initCurvatureR = initialGfx.planetCurvatureEnabled ? 1_600_000 : 0;
    (renderer as unknown as { planetCurvatureRadius: number }).planetCurvatureRadius = initCurvatureR;
    world.planetCurvatureRadius = initCurvatureR;
    world.gpuOceanWaveUniforms.uRealisticWater.value = shouldUseRealisticWater(initialGfx) ? 1.0 : 0.0;
    world.gpuOceanWaveUniforms.uWorldGenMode.value = worldGenModeToShaderId(world.worldGenMode);
    const initialTuning = computeRenderDistanceTuning(
      initialDrawDistBig,
      isHeadless || isMobileDevice() ? false : initialGfx.uncappedChunkLod,
      initialGfx.lodSpacing,
    );
    world.setRenderDistanceChunks(
      initialTuning.clampedChunksBig,
      isHeadless || isMobileDevice() ? false : initialGfx.uncappedChunkLod,
      initialTuning.lodSpacing,
    );
    camera.near = initialTuning.cameraNear;
    camera.far = initialTuning.cameraFar;
    camera.updateProjectionMatrix();
    if (world.skyDome) {
      world.skyDome.scale.setScalar(initialTuning.skyDomeScale);
      world.skyDome.updateMatrix();
    }
    setRenderDistChunks(initialTuning.clampedChunks);
    setCustomRenderDistInput(initialTuning.clampedChunksBig.toString());
    const fx = new VoxelFXSystem(scene, world);
    fx.userParticleMultiplier = initialGfx.particleMultiplier;
    const graphicsPipeline = new VoxelGraphicsPipeline(
      renderer,
      scene,
      camera,
      sunLight,
    );
    graphicsPipeline.worldGenMode = world.worldGenMode;
    graphicsPipeline.applySettings(initialGfx, isHeadless);
    ModRegistry.attachScene(scene);
    const initialRig = new ModularVehicleRig(scene, world, fx);
    initialRig.assignNetworkIdentity('local', undefined, true);
    initialRig.summonTo(0, -2.0, 0);
    initialRig.setPotatoShaderMode(initialGfx.usePotatoShader);
    if (initialGfx.useCartoonShader) {
      initialRig.setCartoonShaderMode(true);
    }
    initialRig.setBlobShadowVisible(initialGfx.blobShadows);
    const creations: ModularVehicleRig[] = [initialRig];
    const applyEntityGfx = (ent: ModularVehicleRig) => {
      ent.setPotatoShaderMode(initialGfx.usePotatoShader);
      if (initialGfx.useCartoonShader) {
        ent.setCartoonShaderMode(true);
      }
      ent.setBlobShadowVisible(initialGfx.blobShadows);
    };
    const voxelEntities: ModularVehicleRig[] = spawnDefaultArenaVoxelEntities(
      scene,
      world,
      fx,
      applyEntityGfx,
    );
    const mapHazards: KinematicMapHazard[] = spawnDefaultArenaMapHazards(
      scene,
      world,
    );
    const worldArenaSystems = new WorldArenaSystemsManager(scene, world, fx);
    fx.mapHazards = mapHazards;
    fx.onCraterDamageHazards = (wx, wy, wz, radiusVoxels) => {
      damageAllMapHazardsInRadius(
        sim.mapHazards,
        wx,
        wy,
        wz,
        radiusVoxels,
        fx,
        false,
      );
      worldArenaSystems.onExplosionNearTraps(
        wx,
        wy,
        wz,
        radiusVoxels * VOXEL_SIZE + 1.5,
      );
    };
    fx.raycastAndDamageHazards = (
      prevPos,
      nextPos,
      craterRadius,
      forceExplode,
    ) => {
      _rayDirTmp.subVectors(nextPos, prevPos);
      const segLen = _rayDirTmp.length();
      if (segLen < 1e-4) return null;
      _rayDirTmp.divideScalar(segLen);
      const hit = raycastAllMapHazards(
        sim.mapHazards,
        prevPos,
        _rayDirTmp,
        segLen + 0.35,
      );
      if (!hit) return null;
      hit.hazard.damageAtWorldPoint(
        hit.worldPos.x,
        hit.worldPos.y,
        hit.worldPos.z,
        craterRadius,
        fx,
        forceExplode,
      );
      return { worldPos: hit.worldPos };
    };
    world.activeVehicle = initialRig;

    // Local Player 3D Character Avatar (tracked by camera when walking on foot)
    const playerCharacterMesh = createVoxelCharacterAvatar('#38bdf8');
    if (initialGfx.usePotatoShader || initialGfx.useCartoonShader) {
      const initMode = initialGfx.useCartoonShader ? 'CARTOON' : 'POTATO';
      playerCharacterMesh.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          applyMeshMaterialPresetSwap(ch, initMode);
        }
      });
    }
    playerCharacterMesh.visible = false;
    scene.add(playerCharacterMesh);

    const cameraTargetPivot = new THREE.Vector3().copy(initialRig.position);
    const cameraTargetQuat = new THREE.Quaternion().copy(initialRig.quaternion);
    const cameraLookAtTarget = new THREE.Vector3().copy(initialRig.position);
    const _camFwdTmp = new THREE.Vector3();
    const _camRightTmp = new THREE.Vector3();
    const _camMoveVecTmp = new THREE.Vector3();
    const _desiredCamPosTmp = new THREE.Vector3();
    const _eulerTmp1 = new THREE.Euler(0, 0, 0, 'YXZ');
    const _eulerTmp2 = new THREE.Euler(0, 0, 0, 'YXZ');
    const _rayOriginTmp = new THREE.Vector3();
    const _rayDirTmp = new THREE.Vector3();
    const _aiAimTargetTmp = new THREE.Vector3();
    const _derbyFwdTmp = new THREE.Vector3();
    const _convoyFwdTmp = new THREE.Vector3();
    const _convoyRightTmp = new THREE.Vector3();
    const _allPhysicsRigsScratch: ModularVehicleRig[] = [];

    const tmpBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    const edgeGeo = new THREE.EdgesGeometry(tmpBoxGeo);
    tmpBoxGeo.dispose();
    const selectionWireframe = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: 0xfacc15 }),
    );
    selectionWireframe.visible = false;
    scene.add(selectionWireframe);

    const selectedObjectWireframe = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x38bdf8 }),
    );
    selectedObjectWireframe.frustumCulled = false;
    selectedObjectWireframe.visible = false;
    scene.add(selectedObjectWireframe);

    const tacticalGridMesh = new THREE.GridHelper(512, 32, 0xfacc15, 0x475569);
    (tacticalGridMesh.material as THREE.LineBasicMaterial).transparent = true;
    (tacticalGridMesh.material as THREE.LineBasicMaterial).opacity = 0.45;
    (tacticalGridMesh.material as THREE.LineBasicMaterial).depthWrite = false;
    tacticalGridMesh.frustumCulled = false;
    tacticalGridMesh.visible = false;
    scene.add(tacticalGridMesh);

    let lastSelectedWireframeSig = '';
    const CUBE_EDGE_PAIRS: ReadonlyArray<[number, number, number, number, number, number]> = [
      [-1, -1, -1,  1, -1, -1],
      [ 1, -1, -1,  1, -1,  1],
      [ 1, -1,  1, -1, -1,  1],
      [-1, -1,  1, -1, -1, -1],
      [-1,  1, -1,  1,  1, -1],
      [ 1,  1, -1,  1,  1,  1],
      [ 1,  1,  1, -1,  1,  1],
      [-1,  1,  1, -1,  1, -1],
      [-1, -1, -1, -1,  1, -1],
      [ 1, -1, -1,  1,  1, -1],
      [ 1, -1,  1,  1,  1,  1],
      [-1, -1,  1, -1,  1,  1],
    ];

    function syncSelectedObjectsWireframe(items: SelectableBuildObject[]) {
      const curRig = sim.getActiveRig();
      if (!sim.isBuildMode || items.length === 0) {
        selectedObjectWireframe.visible = false;
        lastSelectedWireframeSig = '';
        return;
      }
      const sig = `${curRig.vehicleId}|${curRig.comLocal.x.toFixed(3)},${curRig.comLocal.y.toFixed(3)},${curRig.comLocal.z.toFixed(3)}|${items
        .map((o) => `${o.kind}:${o.vx},${o.vy},${o.vz}`)
        .join(';')}`;
      if (sig !== lastSelectedWireframeSig) {
        lastSelectedWireframeSig = sig;
        const posArr = new Float32Array(items.length * 72);
        let ptr = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const cx = (it.vx + 0.5) * VOXEL_SIZE - curRig.comLocal.x;
          const cy = (it.vy + 0.5) * VOXEL_SIZE - curRig.comLocal.y;
          const cz = (it.vz + 0.5) * VOXEL_SIZE - curRig.comLocal.z;
          const hs =
            (it.kind === 'module' ? VOXEL_SIZE * 2.15 : VOXEL_SIZE + 0.06) *
            0.5;
          for (let e = 0; e < 12; e++) {
            const edge = CUBE_EDGE_PAIRS[e];
            posArr[ptr++] = cx + edge[0] * hs;
            posArr[ptr++] = cy + edge[1] * hs;
            posArr[ptr++] = cz + edge[2] * hs;
            posArr[ptr++] = cx + edge[3] * hs;
            posArr[ptr++] = cy + edge[4] * hs;
            posArr[ptr++] = cz + edge[5] * hs;
          }
        }
        selectedObjectWireframe.geometry.dispose();
        const nextGeo = new THREE.BufferGeometry();
        nextGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        selectedObjectWireframe.geometry = nextGeo;
      }
      selectedObjectWireframe.scale.set(1, 1, 1);
      selectedObjectWireframe.position.copy(curRig.position);
      selectedObjectWireframe.quaternion.copy(curRig.quaternion);
      selectedObjectWireframe.visible = true;
    }

    function bindSeatBreakageToRig(targetRig: ModularVehicleRig) {
      targetRig.onSeatBroken = () => {
        if (sim.isSeatedInRig && sim.getActiveRig() === targetRig) {
          sim.exitVehicle();
          fx.spawnWeldSparks(
            targetRig.position.x,
            targetRig.position.y + 0.5,
            targetRig.position.z,
          );
          SoundFX.boom();
          syncHudNow();
        }
      };
    }

    // Deliberate high-tech initial loading stages for effect, WebGL shader pre-warming, and stable 60 FPS
    const loadingStages = [
      { pct: 35, stage: 'Building 0.25m Micro-Voxel Arena & Proving Grounds...' },
      { pct: 65, stage: 'Stamping Mega Stunt Ramp, 360° Loop, Half-Pipe & Arena...' },
      { pct: 88, stage: 'Pre-warming WebGL Shaders & Locking Pipeline...' },
      { pct: 100, stage: 'SYSTEMS OPTIMAL · 60 FPS LOCKED · READY TO LAUNCH' },
    ];
    let loadStep = 0;
    if (isHeadless) {
      setInitialLoadingPct(100);
      setInitialLoadingStage('SYSTEMS OPTIMAL · 60 FPS LOCKED · READY TO LAUNCH');
      setSpawnChunkReady(true);
    }
    const stageTimer = setInterval(() => {
      loadStep++;
      if (loadStep < loadingStages.length) {
        setInitialLoadingPct(loadingStages[loadStep].pct);
        setInitialLoadingStage(loadingStages[loadStep].stage);
        if (loadStep === 2 && !isHeadless && !isLowEndGpu) {
          try {
            renderer.compile(scene, camera);
          } catch {
            // Ignore headless errors
          }
        }
      } else {
        clearInterval(stageTimer);
        setInitialLoadingPct(100);
        setInitialLoadingStage('SYSTEMS OPTIMAL · 60 FPS LOCKED · READY TO LAUNCH');
        setSpawnChunkReady(true);
      }
    }, isHeadless ? 120 : 450);

    const sim = {
      scene,
      camera,
      renderer,
      world,
      fx,
      creations,
      voxelEntities,
      selectedVoxelEntityId: 'TRAFFIC_CONE' as VoxelEntityPresetId,
      mapHazards,
      selectedMapHazardId: 'SAW_BLADE_VERTICAL' as MapHazardPresetId,
      worldArenaSystems,
      activeCreationIndex: 0,
      activeVehicle: initialRig as ModularVehicleRig | null,
      isWalking: false,
      playerCharacterMesh,
      multiplayer: null as unknown as P2PMultiplayerManager,
      get rig(): ModularVehicleRig {
        return (
          this.activeVehicle ||
          this.creations[this.activeCreationIndex] ||
          this.creations[0]
        );
      },
      getActiveRig(): ModularVehicleRig {
        return (
          this.activeVehicle ||
          this.creations[this.activeCreationIndex] ||
          this.creations[0]
        );
      },
      enterVehicle(targetVehicle: ModularVehicleRig, seatIndex = 0): boolean {
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        if (!targetVehicle.hasIntactSeat()) {
          return false;
        }
        const seats = targetVehicle.getSeatModules();
        const targetSeat = seats[seatIndex] || seats[0];
        const actualSeatIdx = targetSeat ? seats.indexOf(targetSeat) : 0;
        if (
          targetSeat &&
          targetSeat.seatedPlayerId !== null &&
          targetSeat.seatedPlayerId !== undefined &&
          targetSeat.seatedPlayerId !== myPeerId &&
          targetSeat.seatedPlayerId !== 'local'
        ) {
          // Seat is already claimed by another player!
          return false;
        }

        // Release any seat we held in a previous vehicle before mounting the new seat
        if (this.activeVehicle && this.activeVehicle !== targetVehicle) {
          this.activeVehicle.releasePlayerSeats(myPeerId);
          this.activeVehicle.releasePlayerSeats('local');
          if (this.multiplayer) {
            this.multiplayer.broadcastSeatClaim(this.activeVehicle, 0, null);
          }
        }

        const claimedOk = targetVehicle.claimSeat(actualSeatIdx, myPeerId);
        if (!claimedOk) {
          return false;
        }

        const idx = this.creations.indexOf(targetVehicle);
        if (idx >= 0) {
          this.activeCreationIndex = idx;
          setActiveCreationIdxState(idx);
        }
        this.activeVehicle = targetVehicle;
        this.world.activeVehicle = targetVehicle;
        this.fx.rig = targetVehicle;
        this.isWalking = false;
        this.isSeatedInRig = true;
        this.recoverFromRagdoll(true);
        this.playerCharacterMesh.visible = false;
        this.driveYawOffset = 0;
        this.drivePitchOffset = 0.28;
        cameraTargetPivot.copy(targetVehicle.position);
        cameraTargetQuat.copy(targetVehicle.quaternion);
        if (this.multiplayer) {
          this.multiplayer.broadcastClaimVehicle(
            targetVehicle,
            true,
            actualSeatIdx,
          );
        }
        return true;
      },
      exitVehicle(): void {
        const prevVehicle = this.getActiveRig();
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        const seats = prevVehicle ? prevVehicle.getSeatModules() : [];
        const activeSeatMod =
          seats.find(
            (s) =>
              s.seatedPlayerId === myPeerId || s.seatedPlayerId === 'local',
          ) || seats[0];
        const seatWorldOrigin =
          prevVehicle && activeSeatMod
            ? prevVehicle.localVoxelToWorld(
                activeSeatMod.vx,
                activeSeatMod.vy,
                activeSeatMod.vz,
              )
            : prevVehicle.position.clone();

        if (prevVehicle) {
          prevVehicle.releasePlayerSeats(myPeerId);
          prevVehicle.releasePlayerSeats('local');
        }
        if (this.multiplayer && prevVehicle) {
          this.multiplayer.broadcastClaimVehicle(prevVehicle, false, 0);
        }
        this.activeVehicle = null;
        this.world.activeVehicle = null;
        this.isWalking = true;
        this.isSeatedInRig = false;
        this.selectedSlot = 1;
        const rigRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
          prevVehicle.quaternion,
        );
        const rigFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
          prevVehicle.quaternion,
        );
        // Dismount ~1.85m beside the seat so the player is cleanly outside the chassis
        // and within the 2.5m [E] interaction range of the seat
        const spawnPos = seatWorldOrigin
          .clone()
          .addScaledVector(rigRight, 1.85)
          .addScaledVector(rigFwd, -0.25);
        const ground = world.probeGroundBelow(
          spawnPos.x,
          Math.max(spawnPos.y, world.sampleSurfaceHeightFast(spawnPos.x, spawnPos.z)),
          spawnPos.z,
          1.5,
        );
        const groundY =
          ground.mat === MAT.WATER_VOX
            ? Math.max(WATER_LEVEL - 0.3, ground.y)
            : ground.y;
        this.camFreePos.set(spawnPos.x, groundY + 1.65, spawnPos.z);
        this.playerCharacterMesh.position.set(
          this.camFreePos.x,
          this.camFreePos.y - 1.65,
          this.camFreePos.z,
        );
        const aimPoint = seatWorldOrigin
          .clone()
          .add(new THREE.Vector3(0, 0.25, 0));
        const toRig = aimPoint.sub(this.camFreePos).normalize();
        this.camYaw = Math.atan2(-toRig.x, -toRig.z);
        this.camPitch = Math.asin(Math.max(-0.85, Math.min(0.85, toRig.y)));
        this.playerCharacterMesh.rotation.set(0, this.camYaw + Math.PI, 0);
        this.playerVelY = 0;
        this.playerPeakAirY = groundY;
        fx.speedLinesMesh.visible = false;
        // High-speed bailout (> 65 km/h) launches the micro-voxel pilot into a tumbling ragdoll!
        if (prevVehicle && prevVehicle.speedKmh > 65 && !this.isBuildMode) {
          const bailVx = prevVehicle.velocity.x * 0.72 + rigRight.x * 2.8;
          const bailVy = Math.max(3.6, prevVehicle.velocity.y * 0.5 + 3.8);
          const bailVz = prevVehicle.velocity.z * 0.72 + rigRight.z * 2.8;
          this.triggerPlayerRagdoll(bailVx, bailVy, bailVz, 2.2);
        } else {
          this.recoverFromRagdoll(true);
        }
      },
      triggerPlayerRagdoll(
        velX: number,
        velY: number,
        velZ: number,
        spinStrength = 1.8,
      ): void {
        if (this.isBuildMode || this.isWorldEditMode || this.isSeatedInRig) {
          return;
        }
        const eyeH = 1.65;
        const footY = this.camFreePos.y - eyeH;
        activatePlayerRagdoll(
          this.playerRagdoll,
          this.camFreePos.x,
          footY,
          this.camFreePos.z,
          this.camYaw + Math.PI,
          velX,
          velY,
          velZ,
          spinStrength,
          1 / 60,
        );
        this.isJetpacking = false;
        this.spaceHoldTime = 0;
        this.playerVelY = 0;
        this.playerKnockbackVel.set(0, 0, 0);
        this.playerCharacterMesh.visible = true;
        applyRagdollToRig(this.playerCharacterMesh, this.playerRagdoll);
      },
      recoverFromRagdoll(silent = false): void {
        if (this.playerRagdoll.active) {
          const px = this.playerRagdoll.pos[0];
          const py = this.playerRagdoll.pos[1];
          const pz = this.playerRagdoll.pos[2];
          const g = world.probeGroundBelow(px, py + 1.2, pz, 1.0);
          const safeGroundY =
            g.mat === MAT.WATER_VOX ? Math.max(WATER_LEVEL - 0.3, g.y) : g.y;
          if (!silent && !this.isBuildMode && !this.isWorldEditMode && !this.isSeatedInRig) {
            beginRagdollGetUp(
              this.playerRagdoll,
              this.playerCharacterMesh,
              px,
              safeGroundY,
              pz,
              this.camYaw + Math.PI,
              0.55,
            );
            this.playerVelY = 0;
            this.playerKnockbackVel.set(0, 0, 0);
            return;
          }
          deactivatePlayerRagdoll(this.playerRagdoll);
          resetRigFromRagdoll(this.playerCharacterMesh);
          this.playerCharacterMesh.position.set(px, safeGroundY, pz);
          this.playerCharacterMesh.rotation.set(0, this.camYaw + Math.PI, 0);
        } else if (this.playerRagdoll.isGettingUp) {
          const fx = this.playerRagdoll.getUpTargetFoot[0];
          const fy = this.playerRagdoll.getUpTargetFoot[1];
          const fz = this.playerRagdoll.getUpTargetFoot[2];
          deactivatePlayerRagdoll(this.playerRagdoll);
          resetRigFromRagdoll(this.playerCharacterMesh);
          this.playerCharacterMesh.position.set(fx, fy, fz);
          this.playerCharacterMesh.rotation.set(0, this.camYaw + Math.PI, 0);
          if (!silent && !this.isBuildMode && !this.isWorldEditMode && !this.isSeatedInRig) {
            this.camFreePos.set(fx, fy + 1.65, fz);
            this.playerVelY = 0;
            this.playerKnockbackVel.set(0, 0, 0);
          }
        } else {
          resetRigFromRagdoll(this.playerCharacterMesh);
        }
      },
      applyOpticalZoomAndTarget(dt: number): void {
        const baseFovVal = this.baseFov || 68;
        let desiredFov = baseFovVal;
        if (this.isZoomed && !this.isBuildMode) {
          desiredFov = Math.max(1e-7, baseFovVal / Math.max(1, this.zoomMagnification));
        } else if (!this.isBuildMode && !this.isWorldEditMode && !this.isWalking && this.isSeatedInRig && this.activeVehicle) {
          const boostFovAdd = this.activeVehicle.isBoostingNow ? 8 : 0;
          desiredFov =
            baseFovVal +
            Math.min(14, this.activeVehicle.speedKmh * 0.1) +
            boostFovAdd;
        }
        const fovSmooth = 1 - Math.exp(-16 * dt);
        if (Math.abs(camera.fov - desiredFov) > desiredFov * 1e-4) {
          camera.fov += (desiredFov - camera.fov) * fovSmooth;
          camera.updateProjectionMatrix();
        } else if (camera.fov !== desiredFov) {
          camera.fov = desiredFov;
          camera.updateProjectionMatrix();
        }

        if (this.isZoomed && !this.isBuildMode) {
          camera.getWorldDirection(_camFwdTmp);
          const zoomRes = computeOpticalZoomTargetPoint({
            eyeX: camera.position.x,
            eyeY: camera.position.y,
            eyeZ: camera.position.z,
            dirX: _camFwdTmp.x,
            dirY: _camFwdTmp.y,
            dirZ: _camFwdTmp.z,
            sampleSurfaceY: (wx, wz) => {
              const surfY = world.sampleSurfaceHeightFast(wx, wz);
              if (surfY < WATER_LEVEL && isWaterBasinArea(wx, wz, world.worldGenMode)) {
                return WATER_LEVEL;
              }
              return surfY;
            },
            maxDistanceMeters: Math.max(520, 140 * Math.max(1, this.zoomMagnification)),
          });
          world.zoomFocusWorld = { x: zoomRes.targetX, z: zoomRes.targetZ };
          this.zoomFocusDistMeters = Math.round(zoomRes.distanceMeters);
          this.zoomFocusCX = zoomRes.centerCX;
          this.zoomFocusCZ = zoomRes.centerCZ;
        } else {
          if (world.zoomFocusWorld !== null) {
            world.zoomFocusWorld = null;
          }
          this.zoomFocusDistMeters = 0;
        }
      },
      updateCamera(dt: number, now = performance.now()): void {
        const activeRig = this.getActiveRig();
        const shakeMag =
          fx.trauma * fx.trauma * 0.42 +
          (activeRig.isBoostingNow
            ? 0.035
            : Math.min(0.025, activeRig.speedKmh * 0.0002));
        const shakeX = (Math.random() - 0.5) * shakeMag;
        const shakeY = (Math.random() - 0.5) * shakeMag;

        // Dynamically resolve the camera target every frame (NEVER read from a static vehicles[0]):
        const targetTransform =
          this.isWalking || !this.activeVehicle
            ? this.playerCharacterMesh
            : this.activeVehicle.chassisMesh || this.activeVehicle.rootGroup;
        void targetTransform;

        if (this.isBuildMode) {
          if (this.isZoomed) {
            this.isZoomed = false;
            world.zoomFocusWorld = null;
            this.zoomFocusDistMeters = 0;
          }
          const flySpeed =
            (this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 16.0 : 8.5) *
            dt;

          camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
          const desiredBuildFov = this.baseFov || 68;
          if (Math.abs(camera.fov - desiredBuildFov) > 0.1) {
            camera.fov = desiredBuildFov;
            camera.updateProjectionMatrix();
          }

          camera.getWorldDirection(_camFwdTmp);
          _camRightTmp.set(
            Math.cos(this.camYaw),
            0,
            -Math.sin(this.camYaw),
          );

          const prevX = this.camFreePos.x;
          const prevY = this.camFreePos.y;
          const prevZ = this.camFreePos.z;

          if (this.keys['KeyW'])
            this.camFreePos.addScaledVector(_camFwdTmp, flySpeed);
          if (this.keys['KeyS'])
            this.camFreePos.addScaledVector(_camFwdTmp, -flySpeed);
          if (this.keys['KeyD'])
            this.camFreePos.addScaledVector(_camRightTmp, flySpeed);
          if (this.keys['KeyA'])
            this.camFreePos.addScaledVector(_camRightTmp, -flySpeed);
          if (this.keys['Space']) this.camFreePos.y += flySpeed;
          if (this.keys['ControlLeft'] || this.keys['KeyQ']) {
            this.camFreePos.y -= flySpeed;
          }

          if (this.camFreePos.y < 1.0) this.camFreePos.y = 1.0;

          // Keep buildOrbitPivot synchronized with free-fly movement so subsequent touch/mouse orbit doesn't snap back
          this.buildOrbitPivot.x += this.camFreePos.x - prevX;
          this.buildOrbitPivot.y += this.camFreePos.y - prevY;
          this.buildOrbitPivot.z += this.camFreePos.z - prevZ;

          camera.position.set(
            this.camFreePos.x + shakeX,
            this.camFreePos.y + shakeY,
            this.camFreePos.z,
          );
          return;
        }

        if (this.isWorldEditMode) {
          const flySpeed =
            (this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 28.0 : 14.0) *
            dt;
          camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
          camera.getWorldDirection(_camFwdTmp);
          _camRightTmp.set(
            Math.cos(this.camYaw),
            0,
            -Math.sin(this.camYaw),
          );

          if (this.keys['KeyW'])
            this.camFreePos.addScaledVector(_camFwdTmp, flySpeed);
          if (this.keys['KeyS'])
            this.camFreePos.addScaledVector(_camFwdTmp, -flySpeed);
          if (this.keys['KeyD'])
            this.camFreePos.addScaledVector(_camRightTmp, flySpeed);
          if (this.keys['KeyA'])
            this.camFreePos.addScaledVector(_camRightTmp, -flySpeed);
          if (this.keys['Space']) this.camFreePos.y += flySpeed;
          if (this.keys['ControlLeft'] || this.keys['KeyQ']) {
            this.camFreePos.y -= flySpeed;
          }
          const ground = world.probeGroundBelow(
            this.camFreePos.x,
            this.camFreePos.y,
            this.camFreePos.z,
            0.4,
          );
          if (this.camFreePos.y < ground.y + 1.2) {
            this.camFreePos.y = ground.y + 1.2;
          }
          camera.position.set(
            this.camFreePos.x + shakeX,
            this.camFreePos.y + shakeY,
            this.camFreePos.z,
          );
          camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
          this.applyOpticalZoomAndTarget(dt);
          return;
        }

        if (this.isWalking || !this.isSeatedInRig || !this.activeVehicle) {
          const isShiftHeld = Boolean(
            this.keys['ShiftLeft'] || this.keys['ShiftRight'],
          );
          const baseWalkSpeed =
            this.isJetpacking && isShiftHeld
              ? 28.0
              : isShiftHeld
                ? 11.5
                : this.isJetpacking
                  ? 8.8
                  : 6.8;
          const walkSpeed = baseWalkSpeed * dt;
          _camFwdTmp.set(
            -Math.sin(this.camYaw),
            0,
            -Math.cos(this.camYaw),
          );
          _camRightTmp.set(
            Math.cos(this.camYaw),
            0,
            -Math.sin(this.camYaw),
          );

          _camMoveVecTmp.set(0, 0, 0);
          if (this.keys['KeyW']) _camMoveVecTmp.addScaledVector(_camFwdTmp, walkSpeed);
          if (this.keys['KeyS']) _camMoveVecTmp.addScaledVector(_camFwdTmp, -walkSpeed);
          if (this.keys['KeyD']) _camMoveVecTmp.addScaledVector(_camRightTmp, walkSpeed);
          if (this.keys['KeyA']) _camMoveVecTmp.addScaledVector(_camRightTmp, -walkSpeed);
          const moveVec = _camMoveVecTmp;

          const eyeH = 1.65;
          const physDt = Math.min(dt, 0.033);
          const footY = this.camFreePos.y - eyeH;
          const maxStepUp = 0.45;
          const isSolidFn = (wx: number, wy: number, wz: number) => {
            if (world.isSolidAtWorld(wx, wy, wz)) return true;
            for (let i = 0; i < this.creations.length; i++) {
              const c = this.creations[i];
              if (c.inBuildMode) continue;
              if (c.getSolidVoxelMaterialAtWorld(wx, wy, wz, false) !== MAT.AIR) {
                return true;
              }
            }
            for (let i = 0; i < this.voxelEntities.length; i++) {
              const ent = this.voxelEntities[i];
              if (ent.voxelCount <= 0) continue;
              // Lightweight voxel entities (< 65 kg, e.g. traffic cones, bowling pins, stunt balls, wooden crates)
              // get kicked/pushed when the player walks into them rather(than acting like an immovable brick wall!
              if (ent.totalMass < 65) continue;
              if (ent.getSolidVoxelMaterialAtWorld(wx, wy, wz, false) !== MAT.AIR) {
                return true;
              }
            }
            for (let i = 0; i < this.mapHazards.length; i++) {
              const haz = this.mapHazards[i];
              if (haz.destroyed) continue;
              if (haz.getSolidVoxelMaterialAtWorld(wx, wy, wz) !== MAT.AIR) {
                return true;
              }
            }
            if (TerrainEntity.isSolidAtWorld(wx, wy, wz)) {
              return true;
            }
            return false;
          };

          const probeGroundAndVehicles = (
            wx: number,
            startY: number,
            wz: number,
            stepUp: number,
          ): { y: number; mat: number; vehicle: ModularVehicleRig | null } => {
            const wGnd = world.probeGroundBelow(wx, startY, wz, stepUp);
            let bestY = wGnd.y;
            let bestMat = wGnd.mat;
            let bestVeh: ModularVehicleRig | null = null;
            for (let i = 0; i < this.creations.length; i++) {
              const c = this.creations[i];
              if (c.inBuildMode) continue;
              const vHit = c.probeVoxelSurfaceBelow(wx, startY, wz, stepUp);
              if (vHit && vHit.y > bestY) {
                bestY = vHit.y;
                bestMat = vHit.mat;
                bestVeh = c;
              }
            }
            for (let i = 0; i < this.voxelEntities.length; i++) {
              const ent = this.voxelEntities[i];
              if (ent.voxelCount <= 0) continue;
              const vHit = ent.probeVoxelSurfaceBelow(wx, startY, wz, stepUp);
              if (vHit && vHit.y > bestY) {
                bestY = vHit.y;
                bestMat = vHit.mat;
                bestVeh = ent;
              }
            }
            for (let i = 0; i < this.mapHazards.length; i++) {
              const haz = this.mapHazards[i];
              if (haz.destroyed) continue;
              const hHit = haz.probeVoxelSurfaceBelow(wx, startY, wz, stepUp);
              if (hHit && hHit.y > bestY) {
                bestY = hHit.y;
                bestMat = hHit.mat;
                bestVeh = null;
              }
            }
            const tEntHit = TerrainEntity.probeSurfaceBelow(wx, startY, wz, stepUp);
            if (tEntHit && tEntHit.y > bestY) {
              bestY = tEntHit.y;
              bestMat = tEntHit.mat;
              bestVeh = null;
            }
            return { y: bestY, mat: bestMat, vehicle: bestVeh };
          };

          // Active on-demand 11-node Verlet ragdoll simulation (0ms when inactive)
          if (this.playerRagdoll.active) {
            const ragStep = stepPlayerRagdoll(this.playerRagdoll, physDt, {
              sampleGroundY: (wx, startY, wz) => {
                const probe = probeGroundAndVehicles(wx, startY, wz, 0.45);
                return probe.mat === MAT.WATER_VOX
                  ? Math.max(WATER_LEVEL - 0.3, probe.y)
                  : probe.y;
              },
              isSolid: isSolidFn,
            });
            applyRagdollToRig(this.playerCharacterMesh, this.playerRagdoll);
            this.camFreePos.set(
              ragStep.pelvisX,
              ragStep.pelvisY + 0.92,
              ragStep.pelvisZ,
            );

            // Allow manual stand-up with Space after 0.5s or automatic recovery once settled
            const manualRecover =
              this.playerRagdoll.elapsed >= 0.5 && Boolean(this.keys['Space']);
            if (ragStep.readyToRecover || manualRecover) {
              this.recoverFromRagdoll(false);
            }

            // Keep third-person camera safely tracking the tumbling ragdoll without clipping walls
            const desiredDist = 4.1;
            const headAnchorY = ragStep.pelvisY + 0.55;
            const backDirX = Math.sin(this.camYaw) * Math.cos(this.camPitch);
            const backDirY = -Math.sin(this.camPitch);
            const backDirZ = Math.cos(this.camYaw) * Math.cos(this.camPitch);
            let safeDist = desiredDist;
            for (let d = 0.3; d <= desiredDist; d += 0.25) {
              const testX = ragStep.pelvisX + backDirX * d;
              const testY = headAnchorY + backDirY * d;
              const testZ = ragStep.pelvisZ + backDirZ * d;
              if (world.isSolidAtWorld(testX, testY, testZ)) {
                safeDist = Math.max(0.75, d - 0.35);
                break;
              }
            }
            const camTargetX = ragStep.pelvisX + backDirX * safeDist;
            const camTargetY = headAnchorY + backDirY * safeDist;
            const camTargetZ = ragStep.pelvisZ + backDirZ * safeDist;
            const camGround = world.probeGroundBelow(
              camTargetX,
              camTargetY + 0.6,
              camTargetZ,
              0.5,
            );
            const liftedCamY =
              camGround.y <= headAnchorY + 0.4
                ? Math.max(camGround.y + 0.5, camTargetY)
                : camTargetY;
            camera.position.set(
              camTargetX + shakeX,
              liftedCamY + shakeY,
              camTargetZ,
            );
            camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
            return;
          }

          // Smooth 2-stage stand-up animation from lying ragdoll pose -> crouch push-up -> standing
          if (this.playerRagdoll.isGettingUp) {
            const getUpStep = stepRagdollGetUp(
              this.playerRagdoll,
              this.playerCharacterMesh,
              physDt,
            );
            if (getUpStep.completed) {
              const footX = this.playerRagdoll.getUpTargetFoot[0];
              const footY = this.playerRagdoll.getUpTargetFoot[1];
              const footZ = this.playerRagdoll.getUpTargetFoot[2];
              this.camFreePos.set(footX, footY + eyeH, footZ);
              this.playerVelY = 0;
              this.playerKnockbackVel.set(0, 0, 0);
              SoundFX.snap();
            } else {
              this.camFreePos.set(
                getUpStep.pelvisX,
                getUpStep.pelvisY + 0.93,
                getUpStep.pelvisZ,
              );
            }

            const desiredDist = 4.1;
            const headAnchorY = getUpStep.pelvisY + 0.58;
            const backDirX = Math.sin(this.camYaw) * Math.cos(this.camPitch);
            const backDirY = -Math.sin(this.camPitch);
            const backDirZ = Math.cos(this.camYaw) * Math.cos(this.camPitch);
            let safeDist = desiredDist;
            for (let d = 0.3; d <= desiredDist; d += 0.25) {
              const testX = getUpStep.pelvisX + backDirX * d;
              const testY = headAnchorY + backDirY * d;
              const testZ = getUpStep.pelvisZ + backDirZ * d;
              if (world.isSolidAtWorld(testX, testY, testZ)) {
                safeDist = Math.max(0.75, d - 0.35);
                break;
              }
            }
            const camTargetX = getUpStep.pelvisX + backDirX * safeDist;
            const camTargetY = headAnchorY + backDirY * safeDist;
            const camTargetZ = getUpStep.pelvisZ + backDirZ * safeDist;
            const camGround = world.probeGroundBelow(
              camTargetX,
              camTargetY + 0.6,
              camTargetZ,
              0.5,
            );
            const liftedCamY =
              camGround.y <= headAnchorY + 0.4
                ? Math.max(camGround.y + 0.5, camTargetY)
                : camTargetY;
            camera.position.set(
              camTargetX + shakeX,
              liftedCamY + shakeY,
              camTargetZ,
            );
            camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
            return;
          }

          // Step active Map Hazards against on-foot player (Conveyor Belt push, Launch Catapult fling, Spinning Blade knockback)
          if (this.mapHazards.length > 0) {
            const playerHazardState = {
              position: this.camFreePos,
              footY,
              velY: this.playerVelY,
              knockbackVel: this.playerKnockbackVel,
            };
            if (
              stepPlayerMapHazardsInteraction(
                this.mapHazards,
                playerHazardState,
                fx,
                physDt,
              )
            ) {
              this.playerVelY = playerHazardState.velY;
              const kbHoriz = Math.hypot(
                this.playerKnockbackVel.x,
                this.playerKnockbackVel.z,
              );
              if (kbHoriz > 14.0 || this.playerVelY > 12.5) {
                this.triggerPlayerRagdoll(
                  this.playerKnockbackVel.x,
                  Math.max(4.0, this.playerVelY),
                  this.playerKnockbackVel.z,
                  2.4,
                );
                return;
              }
            }
          }

          // Combine intentional walking movement with any active hazard knockback / conveyor / catapult velocity
          const kbStepX = this.playerKnockbackVel.x * physDt;
          const kbStepZ = this.playerKnockbackVel.z * physDt;
          if (this.playerKnockbackVel.lengthSq() > 1e-4) {
            const kbDamp = Math.max(0, 1.0 - 4.2 * physDt);
            this.playerKnockbackVel.multiplyScalar(kbDamp);
            if (this.playerKnockbackVel.lengthSq() < 0.01) {
              this.playerKnockbackVel.set(0, 0, 0);
            }
          }

          // Cylinder-aware horizontal wall collision on X and Z axes separately against both world terrain AND exact vehicle/hazard voxels
          // so walking straight into a voxel wall blocks horizontal movement while voxel ramps <= maxStepUp are climbed smoothly!
          const nextX = this.camFreePos.x + moveVec.x + kbStepX;
          const nextZ = this.camFreePos.z + moveVec.z + kbStepZ;
          if (
            canPlayerMoveHorizontal(
              isSolidFn,
              nextX,
              footY,
              this.camFreePos.z,
              0.28,
              maxStepUp,
            )
          ) {
            this.camFreePos.x = nextX;
          } else {
            this.playerKnockbackVel.x = 0;
          }
          if (
            canPlayerMoveHorizontal(
              isSolidFn,
              this.camFreePos.x,
              footY,
              nextZ,
              0.28,
              maxStepUp,
            )
          ) {
            this.camFreePos.z = nextZ;
          } else {
            this.playerKnockbackVel.z = 0;
          }
          TerrainEntity.resolvePlayerCollision(this.camFreePos, eyeH, 0.3);

          // On-foot player kick / push interaction with nearby Voxel Entities (cones, crates, bowling pins, stunt ball)
          if (moveVec.lengthSq() > 1e-6 && this.voxelEntities.length > 0) {
            for (let i = 0; i < this.voxelEntities.length; i++) {
              const ent = this.voxelEntities[i];
              if (ent.voxelCount <= 0) continue;
              const dx = ent.position.x - this.camFreePos.x;
              const dz = ent.position.z - this.camFreePos.z;
              const dy = ent.position.y - (footY + 0.55);
              const horizDist = Math.hypot(dx, dz);
              if (horizDist < 1.15 && Math.abs(dy) < 1.25 && horizDist > 0.01) {
                const invD = 1 / horizDist;
                const nx = dx * invD;
                const nz = dz * invD;
                const pushFactor = Math.min(1.8, 38.0 / Math.max(8.0, ent.totalMass));
                ent.rigidBody.wake();
                ent.velocity.x += nx * baseWalkSpeed * 0.42 * pushFactor;
                ent.velocity.z += nz * baseWalkSpeed * 0.42 * pushFactor;
                if (ent.totalMass < 35) {
                  ent.velocity.y = Math.max(ent.velocity.y, 1.4 * pushFactor);
                  ent.angularVelocity.x += -nz * 2.2 * pushFactor;
                  ent.angularVelocity.z += nx * 2.2 * pushFactor;
                }
                ent.rigidBody.velocity.copy(ent.velocity);
                ent.rigidBody.angularVelocity.copy(ent.angularVelocity);
              }
            }
          }

          // 5-point foot cylinder ground probe (center + 4 cardinal offsets at r = 0.22m) across both terrain and vehicle voxel surfaces.
          // Only allow cardinal probes to step up if the column above step height is clear (not a wall!).
          const gCenter = probeGroundAndVehicles(
            this.camFreePos.x,
            footY,
            this.camFreePos.z,
            maxStepUp,
          );
          let maxSolidGroundY = gCenter.y;
          let supportVehicle: ModularVehicleRig | null = gCenter.vehicle;
          const footOffsets: Array<[number, number]> = [
            [0.22, 0],
            [-0.22, 0],
            [0, -0.22],
            [0, 0.22],
          ];
          for (let fIdx = 0; fIdx < footOffsets.length; fIdx++) {
            const px = this.camFreePos.x + footOffsets[fIdx][0];
            const pz = this.camFreePos.z + footOffsets[fIdx][1];
            const blockedByWallAboveStep =
              isSolidFn(px, footY + maxStepUp + 0.08, pz) ||
              isSolidFn(px, footY + 1.1, pz);
            if (!blockedByWallAboveStep) {
              const gProbe = probeGroundAndVehicles(px, footY, pz, maxStepUp);
              if (gProbe.y > maxSolidGroundY) {
                maxSolidGroundY = gProbe.y;
                supportVehicle = gProbe.vehicle;
              }
            }
          }
          // If the player's feet become embedded inside newly placed blocks or steep terrain
          // so all 5 probes returned the bottom-of-world fallback (0.25), recover upward up to +2.0m
          // rather than dropping the player through the world!
          if (
            maxSolidGroundY <= 0.3 &&
            footY > 1.5 &&
            world.isSolidAtWorld(this.camFreePos.x, footY + 0.1, this.camFreePos.z)
          ) {
            const recoverGnd = world.probeGroundBelow(
              this.camFreePos.x,
              footY + 1.5,
              this.camFreePos.z,
              1.0,
            );
            if (recoverGnd.y > maxSolidGroundY) {
              maxSolidGroundY = recoverGnd.y;
            }
          }
          const groundY =
            gCenter.mat === MAT.WATER_VOX
              ? Math.max(WATER_LEVEL - 0.3, maxSolidGroundY)
              : maxSolidGroundY;

          // If standing on a moving vehicle's ramp or flatbed, carry the player with that vehicle's point velocity!
          if (supportVehicle && Math.abs(footY - groundY) <= maxStepUp + 0.15) {
            _desiredCamPosTmp.set(this.camFreePos.x, groundY, this.camFreePos.z);
            supportVehicle.rigidBody.velocityAtPoint(_desiredCamPosTmp, _camRightTmp);
            const carryX = _camRightTmp.x * physDt;
            const carryZ = _camRightTmp.z * physDt;
            if (Math.hypot(carryX, carryZ) > 1e-5) {
              this.camFreePos.x += carryX;
              this.camFreePos.z += carryZ;
            }
          }

          // Short press Space = jump; Long press Space (>= 0.18s) = working backpack jetpack thrust!
          // Holding Shift + Space ignites turbo afterburner flight for fast vertical climb (~34 m/s) & travel!
          const jetStep = stepPlayerJetpackAndJump({
            footY,
            groundY,
            playerVelY: this.playerVelY,
            spaceHeld: Boolean(this.keys['Space']),
            shiftHeld: isShiftHeld,
            spaceHoldTime: this.spaceHoldTime,
            dt: physDt,
          });
          this.playerVelY = jetStep.playerVelY;
          this.spaceHoldTime = jetStep.spaceHoldTime;
          this.isJetpacking = jetStep.isJetpacking;
          if (jetStep.didJump) {
            SoundFX.snap();
          }

          let nextCamY = this.camFreePos.y + this.playerVelY * physDt;

          if (this.playerVelY > 0) {
            const headClearance = 0.26;
            const headRadius = 0.22;
            let hitCeiling = false;
            let minCeilY = Infinity;
            const headOffsets: Array<[number, number]> = [
              [0, 0],
              [headRadius, 0],
              [-headRadius, 0],
              [0, headRadius],
              [0, -headRadius],
            ];
            for (let hIdx = 0; hIdx < headOffsets.length; hIdx++) {
              const hx = this.camFreePos.x + headOffsets[hIdx][0];
              const hz = this.camFreePos.z + headOffsets[hIdx][1];
              if (
                isSolidFn(hx, nextCamY + headClearance, hz) ||
                isSolidFn(hx, this.camFreePos.y + headClearance * 0.65, hz)
              ) {
                hitCeiling = true;
              }
              const ceilProbe = world.probeCeilingAbove(
                hx,
                this.camFreePos.y - 0.35,
                hz,
                Math.max(0.75, this.playerVelY * physDt + 0.55),
              );
              if (ceilProbe && ceilProbe.y < minCeilY) {
                minCeilY = ceilProbe.y;
              }
            }
            if (nextCamY + headClearance >= minCeilY) {
              hitCeiling = true;
              nextCamY = Math.min(this.camFreePos.y, minCeilY - headClearance);
            } else if (hitCeiling) {
              nextCamY = this.camFreePos.y;
            }
            if (hitCeiling) {
              this.playerVelY = -0.35;
            }
          }

          this.camFreePos.y = nextCamY;

          // Track highest airborne foot elevation so only genuinely high drops (>= 9m) trigger ragdoll
          const currentFootY = this.camFreePos.y - eyeH;
          if (this.isJetpacking || gCenter.mat === MAT.WATER_VOX) {
            this.playerPeakAirY = currentFootY;
          } else if (currentFootY > groundY + 0.18) {
            if (currentFootY > this.playerPeakAirY) {
              this.playerPeakAirY = currentFootY;
            }
          } else if (currentFootY >= groundY - 0.05) {
            this.playerPeakAirY = groundY;
          }

          if (this.camFreePos.y < groundY + eyeH) {
            const landingSpeed = -this.playerVelY;
            const fallDropMeters = Math.max(0, this.playerPeakAirY - groundY);
            this.camFreePos.y = groundY + eyeH;
            this.playerVelY = 0;
            this.playerPeakAirY = groundY;
            // Only high falls (>= 9.0m drop and > 21.5 m/s impact) trigger pilot ragdoll!
            if (
              fallDropMeters >= 9.0 &&
              landingSpeed > 21.5 &&
              !this.isJetpacking &&
              gCenter.mat !== MAT.WATER_VOX
            ) {
              SoundFX.clank();
              this.triggerPlayerRagdoll(
                (moveVec.x / Math.max(0.008, physDt)) * 0.65,
                Math.min(4.2, landingSpeed * 0.18),
                (moveVec.z / Math.max(0.008, physDt)) * 0.65,
                2.0,
              );
              return;
            }
          }

          // Emit twin backpack jetpack thruster exhaust particles & thruster audio when jetpacking
          if (this.isJetpacking) {
            this.jetpackSoundTimer += physDt;
            if (this.jetpackSoundTimer >= 0.09) {
              this.jetpackSoundTimer = 0;
              SoundFX.boost();
            }
            const charYaw = this.camYaw + Math.PI;
            const sinY = Math.sin(charYaw);
            const cosY = Math.cos(charYaw);
            const backOffsetX = -sinY * 0.22;
            const backOffsetZ = -cosY * 0.22;
            const rightX = cosY * 0.11;
            const rightZ = -sinY * 0.11;
            const nozzleWorldY = this.camFreePos.y - eyeH + 0.72;
            fx.spawnDebris(
              this.camFreePos.x + backOffsetX - rightX,
              nozzleWorldY,
              this.camFreePos.z + backOffsetZ - rightZ,
              Math.random() < 0.65 ? 0x38bdf8 : 0xfacc15,
              3.2,
              0.42,
            );
            fx.spawnDebris(
              this.camFreePos.x + backOffsetX + rightX,
              nozzleWorldY,
              this.camFreePos.z + backOffsetZ + rightZ,
              Math.random() < 0.65 ? 0x38bdf8 : 0xf97316,
              3.2,
              0.42,
            );
          } else {
            this.jetpackSoundTimer = 0.09;
          }

          // Keep playerCharacterMesh synced to walking transform and animate articulated limbs + handheld tools
          this.playerCharacterMesh.position.set(
            this.camFreePos.x,
            this.camFreePos.y - eyeH,
            this.camFreePos.z,
          );
          this.playerCharacterMesh.rotation.set(0, this.camYaw + Math.PI, 0);
          this.playerCharacterMesh.visible = this.cameraMode !== 'FIRST_PERSON';

          const isMoving = Math.hypot(moveVec.x, moveVec.z) > 0.001;
          const isJumping = Math.abs(this.playerVelY) > 0.5 || this.isJetpacking;
          const isSprinting = Boolean(this.keys['ShiftLeft']);
          const moveSpeed = isMoving ? baseWalkSpeed : 0;
          const activePlayTool = PLAY_SLOTS[this.selectedSlot - 1] || PLAY_SLOTS[0];
          const equippedTool: CharacterEquippedTool =
            activePlayTool?.kind === 'PLASMA_RIFLE'
              ? 'PLASMA_RIFLE'
              : activePlayTool?.kind === 'SLEDGE'
                ? 'SLEDGE'
                : activePlayTool?.kind === 'PIPE_BOMB'
                  ? 'PIPE_BOMB'
                  : 'WRENCH';

          const animPose = computeAvatarAnimationPose(
            now * 0.007,
            moveSpeed,
            false,
            false,
            !isJumping,
          );
          applyAvatarPose(this.playerCharacterMesh, animPose);
          updateCharacterAnimation(
            this.playerCharacterMesh,
            {
              walkSpeed: moveSpeed,
              isSprinting,
              isAirborne: isJumping,
              isJetpacking: this.isJetpacking,
              isSeated: false,
              steerAngle: 0,
              lookPitch: this.camPitch,
              lookYaw: 0,
              isBuildMode: false,
              equippedTool,
            },
            dt,
          );

          if (this.cameraMode !== 'FIRST_PERSON') {
            const desiredDist = 3.6;
            const headAnchorY = this.camFreePos.y + 0.38;
            const backDirX = Math.sin(this.camYaw) * Math.cos(this.camPitch);
            const backDirY = -Math.sin(this.camPitch);
            const backDirZ = Math.cos(this.camYaw) * Math.cos(this.camPitch);

            // Raycast from player head anchor toward desired third-person camera position so camera never clips inside craters or walls!
            let safeDist = desiredDist;
            for (let d = 0.25; d <= desiredDist; d += 0.2) {
              const testX = this.camFreePos.x + backDirX * d;
              const testY = headAnchorY + backDirY * d;
              const testZ = this.camFreePos.z + backDirZ * d;
              if (
                world.isSolidAtWorld(testX, testY, testZ) ||
                world.isSolidAtWorld(testX, testY + 0.18, testZ) ||
                world.isSolidAtWorld(testX, testY - 0.18, testZ)
              ) {
                safeDist = Math.max(0.55, d - 0.35);
                break;
              }
            }

            const camTargetX = this.camFreePos.x + backDirX * safeDist;
            const camTargetY = headAnchorY + backDirY * safeDist;
            const camTargetZ = this.camFreePos.z + backDirZ * safeDist;
            const camGround = world.probeGroundBelow(
              camTargetX,
              camTargetY,
              camTargetZ,
              0.5,
            );
            const liftedCamY =
              camGround.y <= headAnchorY + 0.35 &&
              !world.isSolidAtWorld(camTargetX, camGround.y + 0.45, camTargetZ)
                ? Math.max(camGround.y + 0.45, camTargetY)
                : camTargetY;
            camera.position.set(
              camTargetX + shakeX,
              liftedCamY + shakeY,
              camTargetZ,
            );
            camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
          } else {
            this.playerCharacterMesh.visible = false;
            camera.position.set(
              this.camFreePos.x + shakeX,
              this.camFreePos.y + shakeY,
              this.camFreePos.z,
            );
            camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
          }
          this.applyOpticalZoomAndTarget(dt);
          return;
        }

        // Seated in activeVehicle: pass isDriving: true so vehicle seats stay empty while driving
        updateCharacterAnimation(
          this.playerCharacterMesh,
          {
            walkSpeed: 0,
            isSprinting: false,
            isAirborne: false,
            isDriving: true,
            isSeated: true,
            steerAngle: this.activeVehicle.steerAngle,
            lookPitch: -this.drivePitchOffset * 0.35,
            lookYaw: this.driveYawOffset * 0.4,
            isBuildMode: false,
            equippedTool: 'NONE',
          },
          dt,
        );

        // Seated in activeVehicle: dynamically track this.activeVehicle!
        const targetVeh = this.activeVehicle;
        const dampFactor = 1 - Math.exp(-12.5 * dt);

        if (cameraTargetPivot.distanceToSquared(targetVeh.position) > 900) {
          cameraTargetPivot.copy(targetVeh.position);
          cameraTargetQuat.copy(targetVeh.quaternion);
        } else {
          cameraTargetPivot.lerp(
            targetVeh.position,
            Math.min(1, dampFactor * 1.35),
          );
          cameraTargetQuat.slerp(
            targetVeh.quaternion,
            Math.min(1, dampFactor * 1.35),
          );
        }

        if (this.cameraMode === 'FIRST_PERSON') {
          const pose = targetVeh.getCockpitCameraPose();
          camera.position.copy(pose.eye);
          camera.position.x += shakeX * 0.5;
          camera.position.y += shakeY * 0.5;
          camera.up.copy(pose.up);
          camera.lookAt(pose.target);
        } else if (this.cameraMode === 'ACTION_WHEEL') {
          const pose = targetVeh.getWheelActionCameraPose();
          camera.position.lerp(pose.eye, dampFactor);
          camera.position.x += shakeX;
          camera.position.y += shakeY;
          camera.up.set(0, 1, 0);
          camera.lookAt(pose.target);
        } else {
          // CHASE, TOP_DOWN, or FREE_ORBIT tracking targetVeh (activeVehicle)
          camera.up.set(0, 1, 0);
          const isDrivingInput =
            this.keys['KeyW'] ||
            this.keys['KeyS'] ||
            this.keys['KeyA'] ||
            this.keys['KeyD'];
          if (
            this.cameraMode === 'CHASE' &&
            isDrivingInput &&
            now - this.lastMouseMoveTime > 2200
          ) {
            this.driveYawOffset *= Math.exp(-3.2 * dt);
            this.drivePitchOffset +=
              (0.28 - this.drivePitchOffset) * Math.min(1, 2.5 * dt);
          }

          // Cinematic Far-to-Car Intro Camera Swoop (starts wide & high over the stunt arena and glides down to normal chase cam!)
          if (this.introSwoopProgress < 1.0) {
            this.introSwoopProgress = Math.min(
              1.0,
              this.introSwoopProgress + dt / 2.6,
            );
          }
          const swoopRem = Math.pow(1.0 - this.introSwoopProgress, 2.8);

          _eulerTmp1.setFromQuaternion(
            cameraTargetQuat,
            'YXZ',
          );
          const totalYaw =
            this.cameraMode === 'FREE_ORBIT'
              ? this.driveYawOffset
              : _eulerTmp1.y + this.driveYawOffset + swoopRem * 0.42;
          const basePitch =
            this.cameraMode === 'TOP_DOWN' ? 1.12 : this.drivePitchOffset;
          const pitch = basePitch + swoopRem * 0.36;
          const baseCamDist =
            this.cameraMode === 'TOP_DOWN'
              ? Math.max(16.0, this.driveOrbitDist)
              : this.driveOrbitDist;
          const camDist = baseCamDist + swoopRem * 28.0;

          const offsetX = -Math.sin(totalYaw) * Math.cos(pitch) * camDist;
          const offsetY = Math.sin(pitch) * camDist + 1.2 + swoopRem * 7.5;
          const offsetZ = -Math.cos(totalYaw) * Math.cos(pitch) * camDist;

          _desiredCamPosTmp.set(
            cameraTargetPivot.x + offsetX,
            cameraTargetPivot.y + offsetY,
            cameraTargetPivot.z + offsetZ,
          );
          const desiredCamPos = _desiredCamPosTmp;

          const floorAtCam = world.probeGroundBelow(
            desiredCamPos.x,
            desiredCamPos.y,
            desiredCamPos.z,
            1.2,
          );
          if (desiredCamPos.y < floorAtCam.y + 1.0) {
            desiredCamPos.y = floorAtCam.y + 1.0;
          }

          if (this.introSwoopProgress < 0.08 || camera.position.distanceToSquared(desiredCamPos) > 2500) {
            camera.position.copy(desiredCamPos);
          } else {
            camera.position.lerp(desiredCamPos, dampFactor);
          }
          camera.position.x += shakeX;
          camera.position.y += shakeY;

          const lookFwdDist = 2.4 + swoopRem * 4.5;
          const lookFwdX = Math.sin(_eulerTmp1.y) * lookFwdDist;
          const lookFwdZ = Math.cos(_eulerTmp1.y) * lookFwdDist;
          cameraLookAtTarget.set(
            cameraTargetPivot.x + lookFwdX,
            cameraTargetPivot.y + 0.85 + swoopRem * 1.4,
            cameraTargetPivot.z + lookFwdZ,
          );
          camera.lookAt(cameraLookAtTarget);
        }

        this.applyOpticalZoomAndTarget(dt);

        // Update 3D High-Speed Aerodynamic Wind Streaks on activeVehicle!
        fx.updateSpeedLines(
          dt,
          targetVeh.position,
          targetVeh.velocity,
          targetVeh.isBoostingNow,
        );
      },
      getAllPhysicsRigs(): ModularVehicleRig[] {
        if (this.voxelEntities.length === 0) return this.creations;
        _allPhysicsRigsScratch.length = 0;
        for (let i = 0; i < this.creations.length; i++) {
          _allPhysicsRigsScratch.push(this.creations[i]);
        }
        for (let i = 0; i < this.voxelEntities.length; i++) {
          _allPhysicsRigsScratch.push(this.voxelEntities[i]);
        }
        return _allPhysicsRigsScratch;
      },
      getClosestCreation(pos: THREE.Vector3) {
        let best = this.creations[0];
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < this.creations.length; i++) {
          const c = this.creations[i];
          const d = c.position.distanceTo(pos);
          if (d < bestDist) {
            bestDist = d;
            best = c;
            bestIdx = i;
          }
        }
        return { rig: best, index: bestIdx, dist: bestDist };
      },
      getClosestRigOrEntity(pos: THREE.Vector3) {
        let best = this.creations[0];
        let bestDist = Infinity;
        for (let i = 0; i < this.creations.length; i++) {
          const c = this.creations[i];
          const d = c.position.distanceTo(pos);
          if (d < bestDist) {
            bestDist = d;
            best = c;
          }
        }
        for (let i = 0; i < this.voxelEntities.length; i++) {
          const ent = this.voxelEntities[i];
          if (ent.voxelCount <= 0) continue;
          const d = ent.position.distanceTo(pos);
          if (d < bestDist) {
            bestDist = d;
            best = ent;
          }
        }
        return { rig: best, dist: bestDist };
      },
      selectVoxelEntityPreset(presetId: VoxelEntityPresetId) {
        SoundFX.snap();
        this.selectedVoxelEntityId = presetId;
        this.worldEditTool = 'SPAWN_VOXEL_ENTITY';
        syncHudNow();
      },
      spawnVoxelEntityAt(
        presetId?: VoxelEntityPresetId,
        wx?: number,
        wz?: number,
        yawRad?: number,
        heightOffsetMeters = 0.08,
      ): ModularVehicleRig {
        const chosenId = presetId || this.selectedVoxelEntityId || 'TRAFFIC_CONE';
        let targetX = wx;
        let targetZ = wz;
        let targetYaw = yawRad ?? 0;

        if (targetX === undefined || targetZ === undefined) {
          if (this.isSeatedInRig && this.activeVehicle) {
            const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
              this.activeVehicle.quaternion,
            );
            targetX = this.activeVehicle.position.x + fwd.x * 5.8;
            targetZ = this.activeVehicle.position.z + fwd.z * 5.8;
            targetYaw = Math.atan2(fwd.x, fwd.z);
          } else {
            const fwdX = -Math.sin(this.camYaw);
            const fwdZ = -Math.cos(this.camYaw);
            targetX = this.camFreePos.x + fwdX * 3.4;
            targetZ = this.camFreePos.z + fwdZ * 3.4;
            targetYaw = this.camYaw;
          }
        }

        // Cap active dynamic voxel entities at 200 so memory and broadphase remain ultra-fast
        if (this.voxelEntities.length >= 200) {
          const oldest = this.voxelEntities.shift();
          oldest?.dispose();
        }

        const ent = createVoxelEntityRig(
          scene,
          world,
          fx,
          chosenId,
          targetX,
          targetZ,
          targetYaw,
          heightOffsetMeters,
        );
        if (this.graphicsSettings.useCartoonShader) {
          ent.setCartoonShaderMode(true);
        } else {
          ent.setCartoonShaderMode(false);
          ent.setPotatoShaderMode(this.graphicsSettings.usePotatoShader);
        }
        ent.setBlobShadowVisible(this.graphicsSettings.blobShadows);
        this.voxelEntities.push(ent);
        fx.spawnWeldSparks(ent.position.x, ent.position.y + 0.35, ent.position.z);
        SoundFX.snap();
        syncHudNow();
        return ent;
      },
      clearVoxelEntities() {
        for (let i = 0; i < this.voxelEntities.length; i++) {
          this.voxelEntities[i].dispose();
        }
        this.voxelEntities.length = 0;
        SoundFX.remove();
        syncHudNow();
      },
      resetArenaVoxelEntities() {
        for (let i = 0; i < this.voxelEntities.length; i++) {
          this.voxelEntities[i].dispose();
        }
        this.voxelEntities.length = 0;
        const fresh = spawnDefaultArenaVoxelEntities(scene, world, fx, (ent) => {
          if (this.graphicsSettings.useCartoonShader) {
            ent.setCartoonShaderMode(true);
          } else {
            ent.setCartoonShaderMode(false);
            ent.setPotatoShaderMode(this.graphicsSettings.usePotatoShader);
          }
          ent.setBlobShadowVisible(this.graphicsSettings.blobShadows);
        });
        for (let i = 0; i < fresh.length; i++) {
          this.voxelEntities.push(fresh[i]);
        }
        SoundFX.snap();
        syncHudNow();
      },
      selectMapHazardPreset(presetId: MapHazardPresetId) {
        SoundFX.snap();
        this.selectedMapHazardId = presetId;
        this.worldEditTool = 'SPAWN_MAP_HAZARD';
        syncHudNow();
      },
      spawnMapHazardAt(
        presetId?: MapHazardPresetId,
        wx?: number,
        wz?: number,
        yawRad?: number,
        explicitWY?: number,
      ): KinematicMapHazard {
        const chosenId =
          presetId || this.selectedMapHazardId || 'SAW_BLADE_VERTICAL';
        let targetX = wx;
        let targetZ = wz;
        let targetYaw = yawRad ?? 0;

        if (targetX === undefined || targetZ === undefined) {
          if (this.isSeatedInRig && this.activeVehicle) {
            const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
              this.activeVehicle.quaternion,
            );
            targetX = this.activeVehicle.position.x + fwd.x * 6.5;
            targetZ = this.activeVehicle.position.z + fwd.z * 6.5;
            targetYaw = Math.atan2(fwd.x, fwd.z);
          } else {
            const fwdX = -Math.sin(this.camYaw);
            const fwdZ = -Math.cos(this.camYaw);
            targetX = this.camFreePos.x + fwdX * 4.5;
            targetZ = this.camFreePos.z + fwdZ * 4.5;
            targetYaw = this.camYaw;
          }
        }

        if (this.mapHazards.length >= 48) {
          const oldest = this.mapHazards.shift();
          oldest?.dispose(scene);
        }

        const haz = spawnMapHazardOnTerrain(
          scene,
          world,
          chosenId,
          targetX,
          targetZ,
          targetYaw,
          explicitWY,
        );
        this.mapHazards.push(haz);
        fx.spawnWeldSparks(
          haz.position.x,
          haz.position.y + 0.85,
          haz.position.z,
        );
        SoundFX.snap();
        syncHudNow();
        return haz;
      },
      clearMapHazards() {
        for (let i = 0; i < this.mapHazards.length; i++) {
          this.mapHazards[i].dispose(scene);
        }
        this.mapHazards.length = 0;
        SoundFX.remove();
        syncHudNow();
      },
      resetArenaMapHazards() {
        for (let i = 0; i < this.mapHazards.length; i++) {
          this.mapHazards[i].dispose(scene);
        }
        this.mapHazards.length = 0;
        const fresh = spawnDefaultArenaMapHazards(scene, world);
        for (let i = 0; i < fresh.length; i++) {
          this.mapHazards.push(fresh[i]);
        }
        SoundFX.snap();
        syncHudNow();
      },
      saveCustomWorldSnapshot(name: string): SerializedCustomWorldSave {
        const snapshot = captureCustomWorldSave(
          name,
          world,
          this.voxelEntities,
          this.mapHazards,
        );
        const updatedList = saveWorldToStorage(snapshot);
        setSavedCustomWorlds(updatedList);
        SoundFX.snap();
        syncHudNow();
        return snapshot;
      },
      loadCustomWorldSnapshot(save: SerializedCustomWorldSave) {
        SoundFX.hover();
        fx.reset();
        applyCustomWorldSaveToTerrain(save, world);

        // Restore saved dynamic props
        for (let i = 0; i < this.voxelEntities.length; i++) {
          this.voxelEntities[i].dispose();
        }
        this.voxelEntities.length = 0;
        if (Array.isArray(save.placedEntities)) {
          for (let i = 0; i < save.placedEntities.length; i++) {
            const pe = save.placedEntities[i];
            if (!pe || !pe.blueprint) continue;
            const presetId: VoxelEntityPresetId =
              (pe.presetId as VoxelEntityPresetId) || 'WOOD_CRATE';
            const ent = createVoxelEntityRig(
              scene,
              world,
              fx,
              presetId,
              pe.wx,
              pe.wz,
              0,
              0,
            );
            ent.importBlueprint(pe.blueprint);
            ent.position.set(pe.wx, pe.wy, pe.wz);
            ent.rigidBody.position.set(pe.wx, pe.wy, pe.wz);
            ent.quaternion.set(pe.qx, pe.qy, pe.qz, pe.qw);
            ent.rigidBody.quaternion.set(pe.qx, pe.qy, pe.qz, pe.qw);
            if (ent.propRigidBody) {
              ent.propRigidBody.position.set(pe.wx, pe.wy, pe.wz);
              ent.propRigidBody.quaternion.set(pe.qx, pe.qy, pe.qz, pe.qw);
            }
            if (this.graphicsSettings.useCartoonShader) {
              ent.setCartoonShaderMode(true);
            } else {
              ent.setCartoonShaderMode(false);
              ent.setPotatoShaderMode(this.graphicsSettings.usePotatoShader);
            }
            ent.setBlobShadowVisible(this.graphicsSettings.blobShadows);
            ent.syncVisualTransform();
            this.voxelEntities.push(ent);
          }
        }

        // Restore saved spinning map hazards
        for (let i = 0; i < this.mapHazards.length; i++) {
          this.mapHazards[i].dispose(scene);
        }
        this.mapHazards.length = 0;
        if (Array.isArray(save.placedHazards)) {
          for (let i = 0; i < save.placedHazards.length; i++) {
            const ph = save.placedHazards[i];
            if (!ph || !ph.presetId) continue;
            const haz = spawnMapHazardOnTerrain(
              scene,
              world,
              ph.presetId,
              ph.wx,
              ph.wz,
              ph.yawRad || 0,
              ph.wy,
            );
            this.mapHazards.push(haz);
          }
        }

        const curRig = this.getActiveRig();
        curRig.summonTo(0, -2.0, 0);
        setActiveMapLabel(`Custom World: ${save.name}`);
        syncHudNow();
      },
      getClosestOwnedCreation(pos: THREE.Vector3) {
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        let best = this.getActiveRig();
        let bestIdx = Math.max(0, this.creations.indexOf(best));
        let bestDist = Infinity;
        for (let i = 0; i < this.creations.length; i++) {
          const c = this.creations[i];
          const isOwnedOrLocal =
            c.isLocalOwner(myPeerId) || c.ownerPeerId === 'local';
          if (!isOwnedOrLocal || c.isAnySeatOccupiedByOther(myPeerId)) {
            continue;
          }
          const d = c.position.distanceTo(pos);
          if (d < bestDist) {
            bestDist = d;
            best = c;
            bestIdx = i;
          }
        }
        return { rig: best, index: bestIdx, dist: bestDist };
      },
      findClosestEnterableSeat(pos: THREE.Vector3, maxRangeMeters = 2.5): {
        rig: ModularVehicleRig;
        index: number;
        seatIndex: number;
        distance: number;
      } | null {
        let bestMatch: {
          rig: ModularVehicleRig;
          index: number;
          seatIndex: number;
          distance: number;
        } | null = null;
        for (let i = 0; i < this.creations.length; i++) {
          const c = this.creations[i];
          if (!c.hasIntactSeat()) continue;
          const found = c.findEmptySeatWithinRange(pos, maxRangeMeters);
          if (found && (!bestMatch || found.distMeters < bestMatch.distance)) {
            bestMatch = {
              rig: c,
              index: i,
              seatIndex: found.seatIndex,
              distance: found.distMeters,
            };
          }
        }
        return bestMatch;
      },
      spawnNewCreation(presetIdx = 0, bp?: SerializedVehicleBlueprint): ModularVehicleRig {
        if (this.creations.length >= maxVehiclesLimitRef.current) {
          SoundFX.clank();
          return this.getActiveRig();
        }
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        const cur = this.getActiveRig();
        const spawnX = cur.position.x + 8.0;
        const spawnZ = cur.position.z + 8.0;
        const newRig = new ModularVehicleRig(scene, world, fx);
        bindSeatBreakageToRig(newRig);
        newRig.assignNetworkIdentity(myPeerId, undefined, false);
        newRig.summonTo(spawnX, spawnZ, 0);
        if (bp) {
          newRig.importBlueprint(bp);
        } else {
          newRig.loadPreset(presetIdx);
        }
        // Automatically assign unique networkId, set ownerPeerId = myPeerId, and seat creator in seat 0
        newRig.assignNetworkIdentity(myPeerId, newRig.networkId, true);
        newRig.setPotatoShaderMode(this.graphicsSettings.usePotatoShader);
        if (this.graphicsSettings.useCartoonShader) {
          newRig.setCartoonShaderMode(true);
        }
        newRig.setBlobShadowVisible(this.graphicsSettings.blobShadows);
        this.creations.push(newRig);
        this.activeCreationIndex = this.creations.length - 1;
        if (!this.isBuildMode) {
          this.enterVehicle(newRig, 0);
        }
        setCreationsCountState(this.creations.length);
        setActiveCreationIdxState(this.activeCreationIndex);
        if (this.multiplayer) {
          this.multiplayer.broadcastSpawnVehicle(newRig);
          this.multiplayer.broadcastSeatClaim(newRig, 0, myPeerId);
        }
        SoundFX.snap();
        syncHudNow();
        return newRig;
      },
      duplicateCreationAt(idx: number): ModularVehicleRig {
        const src = this.creations[idx] || this.getActiveRig();
        const prevActive = this.activeVehicle || this.creations[this.activeCreationIndex] || null;
        const shouldStayInPrev = idx !== this.activeCreationIndex && prevActive !== null && prevActive !== src && this.isSeatedInRig;
        const bp = src.exportBlueprint(`${src.customBlueprintName || 'Vehicle'} (Copy)`);
        if (this.creations.length >= maxVehiclesLimitRef.current) {
          SoundFX.clank();
          return src;
        }
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        const spawnX = src.position.x + 8.0;
        const spawnZ = src.position.z + 8.0;
        const newRig = new ModularVehicleRig(scene, world, fx);
        bindSeatBreakageToRig(newRig);
        newRig.assignNetworkIdentity(myPeerId, undefined, false);
        newRig.summonTo(spawnX, spawnZ, 0);
        newRig.importBlueprint(bp);
        newRig.assignNetworkIdentity(myPeerId, newRig.networkId, !shouldStayInPrev);
        newRig.setPotatoShaderMode(this.graphicsSettings.usePotatoShader);
        if (this.graphicsSettings.useCartoonShader) {
          newRig.setCartoonShaderMode(true);
        }
        newRig.setBlobShadowVisible(this.graphicsSettings.blobShadows);
        this.creations.push(newRig);
        if (!shouldStayInPrev) {
          this.activeCreationIndex = this.creations.length - 1;
          if (!this.isBuildMode) {
            this.enterVehicle(newRig, 0);
          }
        }
        setCreationsCountState(this.creations.length);
        setActiveCreationIdxState(this.activeCreationIndex);
        if (this.multiplayer) {
          this.multiplayer.broadcastSpawnVehicle(newRig);
          if (!shouldStayInPrev) {
            this.multiplayer.broadcastSeatClaim(newRig, 0, myPeerId);
          }
        }
        SoundFX.snap();
        syncHudNow();
        return newRig;
      },
      duplicateActiveCreation(): ModularVehicleRig {
        return this.duplicateCreationAt(this.activeCreationIndex);
      },
      deleteCreationAt(idx: number): boolean {
        if (this.creations.length <= 1 || idx < 0 || idx >= this.creations.length) return false;
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        const toDelete = this.creations[idx];
        if (
          (!toDelete.isLocalOwner(myPeerId) && toDelete.ownerPeerId !== 'local') ||
          toDelete.isAnySeatOccupiedByOther(myPeerId)
        ) {
          return false;
        }
        const deletingCurrentActive =
          toDelete === this.activeVehicle || idx === this.activeCreationIndex;
        toDelete.dispose();
        this.creations.splice(idx, 1);

        if (deletingCurrentActive) {
          const nextIdx = Math.min(idx, this.creations.length - 1);
          this.activeCreationIndex = Math.max(0, nextIdx);
          const nextRig = this.creations[this.activeCreationIndex] || this.creations[0];
          if (
            this.isSeatedInRig &&
            nextRig &&
            nextRig.hasIntactSeat() &&
            !nextRig.isAnySeatOccupiedByOther(myPeerId)
          ) {
            this.enterVehicle(nextRig, 0);
          } else {
            this.activeVehicle = null;
            this.world.activeVehicle = null;
            this.isWalking = true;
            this.isSeatedInRig = false;
            this.playerCharacterMesh.visible = true;
          }
        } else if (idx < this.activeCreationIndex) {
          this.activeCreationIndex = Math.max(0, this.activeCreationIndex - 1);
        }

        setCreationsCountState(this.creations.length);
        setActiveCreationIdxState(this.activeCreationIndex);
        SoundFX.remove();
        syncHudNow();
        return true;
      },
      deleteActiveCreation(): boolean {
        const curIdx = this.activeVehicle
          ? Math.max(0, this.creations.indexOf(this.activeVehicle))
          : this.activeCreationIndex;
        return this.deleteCreationAt(curIdx);
      },
      driveCreationAt(idx: number): boolean {
        if (idx < 0 || idx >= this.creations.length) return false;
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        const targetRig = this.creations[idx];
        if (targetRig.isAnySeatOccupiedByOther(myPeerId)) {
          return false;
        }
        if (this.isBuildMode) {
          targetRig.setHoverBuildMode(false);
          this.isBuildMode = false;
        }
        targetRig.aiConfig.enabled = false;
        targetRig.aiThrottleInput = 0;
        targetRig.aiSteerInput = 0;
        targetRig.aiPitchInput = 0;
        targetRig.aiRollInput = 0;
        targetRig.aiCollectiveInput = 0;
        targetRig.aiBrakeInput = false;
        targetRig.aiConfig.statusLabel = 'HUMAN';
        this.activeCreationIndex = idx;

        const entered = targetRig.hasIntactSeat() && this.enterVehicle(targetRig, 0);
        if (!entered) {
          // Damaged / seat-less creation: move walking player right beside it so they can inspect or repair [R]
          this.activeVehicle = targetRig;
          this.world.activeVehicle = targetRig;
          this.fx.rig = targetRig;
          this.isWalking = true;
          this.isSeatedInRig = false;
          this.camFreePos.set(
            targetRig.position.x + 3.5,
            targetRig.position.y + 2.2,
            targetRig.position.z + 3.5,
          );
          this.playerCharacterMesh.position.set(
            this.camFreePos.x,
            this.camFreePos.y - 1.65,
            this.camFreePos.z,
          );
          this.playerCharacterMesh.visible = true;
        }
        setActiveCreationIdxState(idx);
        SoundFX.snap();
        syncHudNow();
        return true;
      },
      cycleActiveCreation(): number {
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        for (let step = 1; step <= this.creations.length; step++) {
          const candIdx = (this.activeCreationIndex + step) % this.creations.length;
          const candRig = this.creations[candIdx];
          if (candRig && !candRig.isAnySeatOccupiedByOther(myPeerId)) {
            this.activeCreationIndex = candIdx;
            if (this.isSeatedInRig) {
              this.enterVehicle(candRig, 0);
            }
            break;
          }
        }
        setActiveCreationIdxState(this.activeCreationIndex);
        SoundFX.snap();
        syncHudNow();
        return this.activeCreationIndex;
      },
      setActiveCreation(idx: number): void {
        if (idx >= 0 && idx < this.creations.length) {
          const myPeerId = this.multiplayer?.localPeerId || 'local';
          const targetRig = this.creations[idx];
          if (targetRig.isAnySeatOccupiedByOther(myPeerId)) {
            return;
          }
          this.activeCreationIndex = idx;
          if (this.isSeatedInRig) {
            this.enterVehicle(targetRig, 0);
          }
          setActiveCreationIdxState(idx);
          syncHudNow();
        }
      },
      graphicsSettings: initialGfx,
      hardwareTierInfo: detectedHardwareTier,
      getEffectiveTargetFps() {
        return resolveTargetFps(this.graphicsSettings.frameRateCap, this.hardwareTierInfo.tier);
      },
      graphicsPipeline,
      updateGraphicsSettings(patch: Partial<GraphicsSettings>) {
        const next = sanitizeGraphicsSettings(
          {
            ...this.graphicsSettings,
            ...patch,
            preset: patch.preset ?? 'CUSTOM',
          },
          this.graphicsSettings,
        );
        this.graphicsSettings = next;
        this.frameGovernorConfig.targetFpsCap = this.getEffectiveTargetFps();
        saveStoredGraphicsSettings(next);
        setGraphicsState(next);

        // Sync 15 graphics features to world, fx, camera, and WebGL pipeline
        const nextDrawBig = getVoxelDrawDistanceBigInt(next);
        const tuning = computeRenderDistanceTuning(
          nextDrawBig,
          next.uncappedChunkLod,
          next.lodSpacing,
        );
        world.setRenderDistanceChunks(
          tuning.clampedChunksBig,
          next.uncappedChunkLod,
          tuning.lodSpacing,
        );
        camera.near = tuning.cameraNear;
        camera.far = tuning.cameraFar;
        camera.updateProjectionMatrix();
        if (world.skyDome) {
          world.skyDome.scale.setScalar(tuning.skyDomeScale);
          world.skyDome.updateMatrix();
        }
        this.baseFogDensity = next.fog ? tuning.baseFogDensity : 0;
        world.fogEnabled = next.fog;
        const nextCurvatureR = next.planetCurvatureEnabled ? 1_600_000 : 0;
        (renderer as unknown as { planetCurvatureRadius: number }).planetCurvatureRadius = nextCurvatureR;
        world.planetCurvatureRadius = nextCurvatureR;
        world.gpuOceanWaveUniforms.uRealisticWater.value = shouldUseRealisticWater(next) ? 1.0 : 0.0;
        fx.userParticleMultiplier = next.particleMultiplier;
        world.setWaveQuality(next.waveQuality);
        if (next.useCartoonShader) {
          world.setCartoonShaderMode(true);
        } else {
          world.setCartoonShaderMode(false);
          world.setPotatoShaderMode(next.usePotatoShader);
        }
        for (let i = 0; i < this.creations.length; i++) {
          if (next.useCartoonShader) {
            this.creations[i].setCartoonShaderMode(true);
          } else {
            this.creations[i].setCartoonShaderMode(false);
            this.creations[i].setPotatoShaderMode(next.usePotatoShader);
          }
          this.creations[i].setBlobShadowVisible(next.blobShadows);
        }
        for (let i = 0; i < this.voxelEntities.length; i++) {
          if (next.useCartoonShader) {
            this.voxelEntities[i].setCartoonShaderMode(true);
          } else {
            this.voxelEntities[i].setCartoonShaderMode(false);
            this.voxelEntities[i].setPotatoShaderMode(next.usePotatoShader);
          }
          this.voxelEntities[i].setBlobShadowVisible(next.blobShadows);
        }
        if (this.playerCharacterMesh) {
          const targetMode = next.useCartoonShader
            ? 'CARTOON'
            : next.usePotatoShader
              ? 'POTATO'
              : 'PBR';
          this.playerCharacterMesh.traverse((ch) => {
            if (ch instanceof THREE.Mesh) {
              applyMeshMaterialPresetSwap(ch, targetMode);
            }
          });
        }
        this.graphicsPipeline.applySettings(next, isHeadless);

        setWavesQuality(next.waveQuality);
        setRenderDistChunks(tuning.clampedChunks);
        setCustomRenderDistInput(tuning.clampedChunksBig.toString());
        setResScale(next.resolutionScale);
        setShadowsEnabled(next.blobShadows);
        syncHudNow();
      },
      applyGraphicsPreset(presetId: Exclude<GraphicsPresetId, 'CUSTOM'>) {
        const presetConfig = GRAPHICS_PRESETS[presetId];
        if (!presetConfig) return;
        this.updateGraphicsSettings({
          ...presetConfig,
          voxelDrawDistanceBig: String(presetConfig.voxelDrawDistance),
          frameRateCap: this.graphicsSettings.frameRateCap,
          preset: presetId,
        });
        SoundFX.snap();
      },
      setRenderDistance(chunks: number | bigint | string, uncappedLod?: boolean) {
        const clampedBig = sanitizePositiveRenderDistanceBigInt(
          chunks,
          getVoxelDrawDistanceBigInt(this.graphicsSettings),
        );
        const clampedNum =
          clampedBig > BigInt(MAX_RENDER_DISTANCE_CHUNKS)
            ? MAX_RENDER_DISTANCE_CHUNKS
            : Number(clampedBig);
        this.updateGraphicsSettings({
          voxelDrawDistance: clampedNum,
          voxelDrawDistanceBig: clampedBig.toString(),
          uncappedChunkLod:
            typeof uncappedLod === 'boolean'
              ? uncappedLod
              : this.graphicsSettings.uncappedChunkLod,
        });
      },
      setLodSpacing(spacing: number) {
        this.updateGraphicsSettings({
          lodSpacing: spacing,
        });
      },
      setResolutionScale(scale: number) {
        const clamped = Math.max(0.5, Math.min(scale, 2.0));
        this.updateGraphicsSettings({
          resolutionScale: Number(clamped.toFixed(2)),
        });
      },
      setWaveQuality(q: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH') {
        this.updateGraphicsSettings({ waveQuality: q });
      },
      setFov(fov: number) {
        const clampedFov = Math.max(50, Math.min(100, Math.round(fov)));
        this.baseFov = clampedFov;
        camera.fov = clampedFov;
        camera.updateProjectionMatrix();
        setCamFov(clampedFov);
      },
      setShadows(enabled: boolean) {
        this.updateGraphicsSettings({
          blobShadows: enabled,
          dynamicShadows: enabled,
        });
      },
      frameGovernorState: createInitialFrameGovernorState(),
      frameGovernorConfig: {
        ...createDefaultFrameGovernorConfig(),
        targetFpsCap: resolveTargetFps(initialGfx.frameRateCap, detectedHardwareTier.tier),
      },
      lastGovernorStep: null as FrameGovernorStepResult | null,
      setAutoSlowMo(enabled: boolean) {
        this.frameGovernorConfig.autoSlowMoEnabled = enabled;
        setStoredAutoSlowMo(enabled);
        setAutoSlowMoEnabled(enabled);
        SoundFX.snap();
        syncHudNow();
      },
      toggleManualSlowMo(force?: boolean) {
        const next =
          force !== undefined
            ? force
            : !this.frameGovernorConfig.manualSlowMoActive;
        this.frameGovernorConfig.manualSlowMoActive = next;
        setManualSlowMoActive(next);
        SoundFX.snap();
        syncHudNow();
      },
      setAntiFreezeWatchdog(enabled: boolean) {
        this.frameGovernorConfig.antiFreezeWatchdogEnabled = enabled;
        setStoredAntiFreezeWatchdog(enabled);
        setAntiFreezeWatchdogEnabled(enabled);
        SoundFX.snap();
        syncHudNow();
      },
      baseFov: 68,
      isZoomed: false,
      zoomMagnification: 4 as number,
      zoomFocusDistMeters: 0,
      zoomFocusCX: 0,
      zoomFocusCZ: 0,
      zKeyDownTimeMs: 0,
      baseFogDensity: 0.0028,
      selectionWireframe,
      selectedObjectWireframe,
      gameState: (initialAutoStart ? 'playing' : 'title') as GameScreenState,
      isBuildMode: false,
      isObjectStudioMode: false,
      isWorldEditMode: false,
      worldEditTool: 'PLACE_OBJECT' as WorldEditToolKind,
      propPhysicsMode: 'DYNAMIC' as 'DYNAMIC' | 'STATIC',
      selectedObjectId: PREBUILT_OBJECTS[0].id,
      terraBrushRadius: 8,
      terraPaintMat: MAT.GRASS as number,
      rampStartWorld: null as THREE.Vector3 | null,
      savedVehicleBeforeStudio: null as SerializedVehicleBlueprint | null,
      allPlaceableObjects: [
        ...PREBUILT_OBJECTS,
        ...loadCustomObjectsFromStorage(),
      ] as VoxelObjectPrefab[],
      isSeatedInRig: true,
      selectedSlot: 1,
      placementMode: 'SINGLE' as BuildPlacementMode,
      hullScalePx: DEFAULT_HULL_SCALE_PX,
      boxDepthPx: 1,
      hullShape: 'CUBE' as HullMicroShape,
      eyedropperMode: false,
      cameraMode: 'CHASE' as CameraViewMode,
      buildCameraAngle: 'ORBIT_3D' as BuildCameraAngle,
      isPointerLocked: false,
      camFreePos: new THREE.Vector3(0, 5.5, -11),
      buildOrbitPivot: new THREE.Vector3(0, 5.2, -4),
      buildOrbitDist: 6.4,
      playerVelY: 0,
      playerPeakAirY: 3.85,
      playerKnockbackVel: new THREE.Vector3(),
      playerRagdoll: createPlayerRagdollState(),
      spaceHoldTime: 0,
      isJetpacking: false,
      jetpackSoundTimer: 0,
      camYaw: Math.PI,
      camPitch: -0.22,
      driveYawOffset: 0,
      drivePitchOffset: 0.28,
      driveOrbitDist: 9.4,
      lastMouseMoveTime: 0,
      titleOrbitAngle: 0.4,
      introSwoopProgress: 0.0,
      speedTrapMaxKmh: 0,
      speedTrapLastKmh: 0,
      maxAirtimeSec: 0,
      currentAirtimeSec: 0,
      keys: {} as Record<string, boolean>,
      pointerNDC: new THREE.Vector2(0, 0),
      hasPointerMoved: false,
      isOrbitDragging: false,
      isLeftMouseDown: false,
      isRightMouseDown: false,
      dragStartVoxel: null as { vx: number; vy: number; vz: number } | null,
      dragStartMicro: null as { mx: number; my: number; mz: number } | null,
      lastPaintedKey: '',
      currentHit: null as {
        target: 'vehicle' | 'world';
        vx: number;
        vy: number;
        vz: number;
        mx?: number;
        my?: number;
        mz?: number;
        hitIsMicro?: boolean;
        mat: number;
        moduleHit?: {
          kind: ModuleKind;
          vx: number;
          vy: number;
          vz: number;
          yawIdx: number;
          pitchIdx?: number;
          rollIdx?: number;
          config?: ModuleTuningConfig;
        };
        normal: { x: number; y: number; z: number };
        worldPos?: THREE.Vector3;
        distance?: number;
      } | null,
      selectedBuildObject: null as SelectableBuildObject | null,
      selectedBuildObjects: [] as SelectableBuildObject[],
      marqueeSelect: null as {
        startX: number;
        startY: number;
        curX: number;
        curY: number;
        additive: boolean;
        baseSelection: SelectableBuildObject[];
        clickedHitObj: SelectableBuildObject | null;
      } | null,

      tacticalMapCam: {
        x: 0,
        z: 0,
        targetX: 0,
        targetZ: 0,
        altitude: 65,
        targetAltitude: 65,
        isTopDown: false,
      },

      initTacticalMapCam(playerPos?: { x: number; y: number; z: number }) {
        const px =
          playerPos?.x ??
          (this.isSeatedInRig
            ? this.getActiveRig().position.x
            : this.camFreePos.x);
        const pz =
          playerPos?.z ??
          (this.isSeatedInRig
            ? this.getActiveRig().position.z
            : this.camFreePos.z);
        this.tacticalMapCam.x = px;
        this.tacticalMapCam.z = pz;
        this.tacticalMapCam.targetX = px;
        this.tacticalMapCam.targetZ = pz;
        this.tacticalMapCam.altitude = 65;
        this.tacticalMapCam.targetAltitude = 65;
      },

      panTacticalMap(dxMeters: number, dzMeters: number) {
        this.tacticalMapCam.targetX += dxMeters;
        this.tacticalMapCam.targetZ += dzMeters;
      },

      zoomTacticalMap(factor: number) {
        this.tacticalMapCam.targetAltitude = Math.max(
          16,
          Math.min(1_000_000_000, this.tacticalMapCam.targetAltitude * factor),
        );
      },

      setTacticalMapAltitude(alt: number) {
        this.tacticalMapCam.targetAltitude = Math.max(
          16,
          Math.min(1_000_000_000, alt),
        );
      },

      setTacticalMapTopDown(topDown: boolean) {
        this.tacticalMapCam.isTopDown = topDown;
      },

      centerTacticalMapOnPlayer() {
        const px = this.isSeatedInRig
          ? this.getActiveRig().position.x
          : this.camFreePos.x;
        const pz = this.isSeatedInRig
          ? this.getActiveRig().position.z
          : this.camFreePos.z;
        this.tacticalMapCam.targetX = px;
        this.tacticalMapCam.targetZ = pz;
      },

      focusTacticalMapOn(wx: number, wz: number) {
        this.tacticalMapCam.targetX = wx;
        this.tacticalMapCam.targetZ = wz;
      },

      updateTacticalMapCamera(dt: number) {
        const requiredFar = Math.max(4800, this.tacticalMapCam.altitude * 14);
        if (Math.abs(camera.far - requiredFar) > requiredFar * 0.05) {
          camera.far = requiredFar;
          camera.near = Math.max(0.5, Math.min(50, this.tacticalMapCam.altitude * 0.002));
          camera.updateProjectionMatrix();
        }
        const speed =
          (this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 130.0 : 60.0) *
          Math.max(0.35, this.tacticalMapCam.altitude / 65.0);
        if (this.keys['KeyW'] || this.keys['ArrowUp'])
          this.tacticalMapCam.targetZ -= speed * dt;
        if (this.keys['KeyS'] || this.keys['ArrowDown'])
          this.tacticalMapCam.targetZ += speed * dt;
        if (this.keys['KeyA'] || this.keys['ArrowLeft'])
          this.tacticalMapCam.targetX -= speed * dt;
        if (this.keys['KeyD'] || this.keys['ArrowRight'])
          this.tacticalMapCam.targetX += speed * dt;

        const lerpRate = 1.0 - Math.exp(-14 * dt);
        this.tacticalMapCam.x +=
          (this.tacticalMapCam.targetX - this.tacticalMapCam.x) * lerpRate;
        this.tacticalMapCam.z +=
          (this.tacticalMapCam.targetZ - this.tacticalMapCam.z) * lerpRate;
        this.tacticalMapCam.altitude +=
          (this.tacticalMapCam.targetAltitude - this.tacticalMapCam.altitude) *
          lerpRate;

        const fastSurfY = world.sampleSurfaceHeightFast(
          this.tacticalMapCam.x,
          this.tacticalMapCam.z,
        );
        const groundY = Math.max(0, fastSurfY);
        const alt = this.tacticalMapCam.altitude;
        const isTopDown = this.tacticalMapCam.isTopDown;

        const tiltRad = isTopDown ? 1.55 : 1.22;
        const camOffsetY = alt;
        const camOffsetZ = isTopDown ? 0.01 : alt * Math.cos(tiltRad) * 0.95;

        camera.position.set(
          this.tacticalMapCam.x,
          groundY + camOffsetY,
          this.tacticalMapCam.z + camOffsetZ,
        );
        camera.lookAt(this.tacticalMapCam.x, groundY, this.tacticalMapCam.z);
        camera.updateMatrixWorld();

        const gridScale = Math.max(1, Math.ceil(alt / 90));
        const gridSpacing = 32 * gridScale;
        const snappedGridX = Math.round(this.tacticalMapCam.x / gridSpacing) * gridSpacing;
        const snappedGridZ = Math.round(this.tacticalMapCam.z / gridSpacing) * gridSpacing;
        tacticalGridMesh.scale.set(gridScale, 1, gridScale);
        tacticalGridMesh.position.set(snappedGridX, groundY + 0.12, snappedGridZ);
        tacticalGridMesh.visible = this.tacticalGridVisible;
      },

      tacticalGridMesh,
      tacticalGridVisible: true,
      setTacticalGridVisible(visible: boolean) {
        this.tacticalGridVisible = visible;
        this.tacticalGridMesh.visible = visible;
      },

      setMultiSelection(objs: SelectableBuildObject[], playSound = true) {
        const cleaned = objs.map((o) => ({
          ...o,
          config: o.config ? { ...o.config } : undefined,
        }));
        this.selectedBuildObjects = cleaned;
        this.selectedBuildObject =
          cleaned.length > 0 ? cleaned[cleaned.length - 1] : null;
        syncSelectedObjectsWireframe(cleaned);
        if (playSound) {
          SoundFX.snap();
        }
        syncHudNow();
      },

      selectBuildObjectAt(
        obj: SelectableBuildObject | null,
        shiftKey = false,
      ) {
        if (!obj) {
          this.setMultiSelection([], true);
          return;
        }
        const curRig = this.getActiveRig();
        if (shiftKey) {
          const allVehicleObjs = curRig.getAllSelectableBuildObjects();
          const nextSel = resolveShiftObjectSelection(
            this.selectedBuildObjects,
            obj,
            allVehicleObjs,
          );
          this.setMultiSelection(nextSel, true);
          return;
        }
        this.setMultiSelection([obj], true);
      },

      selectAllSameAsCurrent(): number {
        if (this.selectedBuildObjects.length === 0) return 0;
        const curRig = this.getActiveRig();
        const allVehicleObjs = curRig.getAllSelectableBuildObjects();
        let combined: SelectableBuildObject[] = [];
        for (const sel of this.selectedBuildObjects) {
          const matches = findAllSameBuildObjects(sel, allVehicleObjs);
          combined = mergeBuildObjectSelections(combined, matches);
        }
        this.setMultiSelection(combined, true);
        return combined.length;
      },

      deleteSelectedObject(): boolean {
        if (this.selectedBuildObjects.length === 0) return false;
        const curRig = this.getActiveRig();
        curRig.pushUndoSnapshot();
        for (const sel of this.selectedBuildObjects) {
          if (sel.kind === 'module') {
            curRig.removeModuleAt(sel.vx, sel.vy, sel.vz);
          } else {
            const oldMat = curRig.getVoxel(sel.vx, sel.vy, sel.vz);
            const oldInfo = MAT_INFO[oldMat & 63];
            const wp = curRig.localVoxelToWorld(sel.vx, sel.vy, sel.vz);
            curRig.setVoxel(sel.vx, sel.vy, sel.vz, MAT.AIR);
            fx.spawnEditPopOut(wp.x, wp.y, wp.z, oldInfo?.color ?? 0x94a3b8);
          }
        }
        if (curRig.voxelMap.size === 0 && curRig.modules.length === 0) {
          curRig.setVoxel(12, 6, 18, MAT.ALLOY_BLUE);
        }
        this.selectedBuildObjects = [];
        this.selectedBuildObject = null;
        syncSelectedObjectsWireframe([]);
        SoundFX.remove();
        curRig.rebuildVehicleGeometry();
        if (!this.isObjectStudioMode) {
          saveLastBuildAutoSave(
            curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
          );
        }
        updateRaycastTarget();
        syncHudNow();
        return true;
      },

      duplicateSelectedObject(): boolean {
        if (this.selectedBuildObjects.length === 0) return false;
        const curRig = this.getActiveRig();
        curRig.pushUndoSnapshot();
        const duplicated = curRig.duplicateSelectionGroup(
          this.selectedBuildObjects,
        );
        if (duplicated.length > 0) {
          const last = duplicated[duplicated.length - 1];
          if (last.kind === 'module' && last.moduleKind) {
            const slotMeta = BUILD_SLOTS.find(
              (s) => s.kind === last.moduleKind,
            );
            if (slotMeta) this.selectedSlot = slotMeta.slot;
            curRig.partYawIndex = last.yawIdx || 0;
          } else if (last.kind === 'voxel' && last.mat) {
            const slotMeta = BUILD_SLOTS.find(
              (s) => s.type === 'voxel' && s.mat === last.mat,
            );
            if (slotMeta) this.selectedSlot = slotMeta.slot;
          }
          const wp = curRig.localVoxelToWorld(last.vx, last.vy, last.vz);
          SoundFX.snap();
          fx.spawnWeldSparks(wp.x, wp.y, wp.z);
          this.setMultiSelection(duplicated, false);
          if (!this.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          syncHudNow();
          return true;
        }
        return false;
      },

      rotateSelectedObject(axis: RotationAxis = 'yaw'): boolean {
        if (this.selectedBuildObjects.length === 0) return false;
        const curRig = this.getActiveRig();
        curRig.pushUndoSnapshot();
        const nextSelection = curRig.rotateSelectionGroupOnAxis(
          this.selectedBuildObjects,
          axis,
          1,
        );
        if (nextSelection.length > 0) {
          const last = nextSelection[nextSelection.length - 1];
          if (last.kind === 'module') {
            curRig.partYawIndex = last.yawIdx || 0;
            curRig.partPitchIndex = last.pitchIdx || 0;
            curRig.partRollIndex = last.rollIdx || 0;
          }
          this.setMultiSelection(nextSelection, true);
          if (!this.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          return true;
        }
        return false;
      },

      moveSelectedObject(
        dx: number,
        dy: number,
        dz: number,
        skipUndoPush = false,
      ): boolean {
        if (this.selectedBuildObjects.length === 0) return false;
        if (dx === 0 && dy === 0 && dz === 0) return false;
        const curRig = this.getActiveRig();
        // Verify bounds before pushing undo snapshot
        for (let i = 0; i < this.selectedBuildObjects.length; i++) {
          const it = this.selectedBuildObjects[i];
          const nx = it.vx + dx;
          const ny = it.vy + dy;
          const nz = it.vz + dz;
          if (ny < 1 || !curRig.inBounds(nx, ny, nz)) {
            return false;
          }
        }
        if (!skipUndoPush) {
          curRig.pushUndoSnapshot();
        }
        const nextSelection = curRig.translateSelectionGroup(
          this.selectedBuildObjects,
          dx,
          dy,
          dz,
        );
        if (nextSelection.length > 0) {
          this.setMultiSelection(nextSelection, true);
          if (!this.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          syncHudNow();
          return true;
        }
        return false;
      },

      nudgeSelectedObjectCameraRelative(
        forwardStep: number,
        rightStep: number,
        upStep: number,
        skipUndoPush = false,
      ): boolean {
        if (this.selectedBuildObjects.length === 0) return false;
        const curRig = this.getActiveRig();
        const invRigQuat = curRig.quaternion.clone().invert();
        const worldFwd = new THREE.Vector3(
          -Math.sin(this.camYaw),
          0,
          -Math.cos(this.camYaw),
        )
          .applyQuaternion(invRigQuat)
          .normalize();
        const worldRight = new THREE.Vector3(
          Math.cos(this.camYaw),
          0,
          -Math.sin(this.camYaw),
        )
          .applyQuaternion(invRigQuat)
          .normalize();

        let fwdX = 0;
        let fwdZ = 0;
        if (Math.abs(worldFwd.x) >= Math.abs(worldFwd.z)) {
          fwdX = worldFwd.x >= 0 ? 1 : -1;
        } else {
          fwdZ = worldFwd.z >= 0 ? 1 : -1;
        }

        let rgtX = 0;
        let rgtZ = 0;
        if (Math.abs(worldRight.x) >= Math.abs(worldRight.z)) {
          rgtX = worldRight.x >= 0 ? 1 : -1;
        } else {
          rgtZ = worldRight.z >= 0 ? 1 : -1;
        }

        const dx = forwardStep * fwdX + rightStep * rgtX;
        const dy = upStep;
        const dz = forwardStep * fwdZ + rightStep * rgtZ;
        return this.moveSelectedObject(dx, dy, dz, skipUndoPush);
      },

      rotateEntireVehicle(axis: RotationAxis = 'yaw') {
        const curRig = this.getActiveRig();
        curRig.pushUndoSnapshot();
        curRig.rotateEntireVehicle90(axis, 1);
        SoundFX.snap();
        if (!this.isObjectStudioMode) {
          saveLastBuildAutoSave(
            curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
          );
        }
        updateRaycastTarget();
        syncHudNow();
      },

      pickSelectedObjectToBrush() {
        const sel = this.selectedBuildObject;
        if (!sel) return;
        const curRig = this.getActiveRig();
        if (sel.kind === 'module' && sel.moduleKind) {
          const slotMeta = BUILD_SLOTS.find((s) => s.kind === sel.moduleKind);
          if (slotMeta) this.selectedSlot = slotMeta.slot;
          const mod = curRig.getModuleAt(sel.vx, sel.vy, sel.vz);
          if (mod) {
            curRig.partYawIndex = mod.yawIdx || 0;
            curRig.partPitchIndex = mod.pitchIdx || 0;
            curRig.partRollIndex = mod.rollIdx || 0;
            if (mod.config) {
              curRig.setKindDefaultConfig(mod.kind, mod.config);
            }
          }
        } else if (sel.kind === 'voxel' && sel.mat) {
          const slotMeta = BUILD_SLOTS.find(
            (s) => s.type === 'voxel' && s.mat === sel.mat,
          );
          if (slotMeta) this.selectedSlot = slotMeta.slot;
        }
        SoundFX.snap();
        syncHudNow();
      },

      recolorSelectedVoxel(newMat: number) {
        const voxTargets = this.selectedBuildObjects.filter(
          (o) => o.kind === 'voxel',
        );
        if (voxTargets.length === 0) return;
        const curRig = this.getActiveRig();
        curRig.pushUndoSnapshot();
        const nextSelection = this.selectedBuildObjects.map((sel) => {
          if (sel.kind !== 'voxel') return sel;
          curRig.setVoxel(sel.vx, sel.vy, sel.vz, newMat);
          return {
            ...sel,
            mat: newMat,
          };
        });
        curRig.rebuildVehicleGeometry();
        if (!this.isObjectStudioMode) {
          saveLastBuildAutoSave(
            curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
          );
        }
        this.setMultiSelection(nextSelection, true);
        updateRaycastTarget();
      },

      /**
       * Locks the mouse cursor ONLY in Driving / On-Foot mode (NEVER in Build Mode!).
       */
      requestCanvasPointerLock() {
        if (this.isBuildMode || this.isWorldEditMode || isMobileDevice()) return;
        try {
          renderer.domElement.focus?.();
          if (document.pointerLockElement !== renderer.domElement) {
            const p = renderer.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
            if (p && typeof p.catch === 'function') {
              p.catch(() => {});
            }
          }
        } catch {
          // Ignore pointer lock security errors
        }
      },

      toggleHoverBuildMode(forceState?: boolean) {
        SoundFX.hover();
        if (this.isObjectStudioMode && forceState === false) {
          this.toggleObjectStudioMode(false);
          return;
        }
        const nextBuild =
          typeof forceState === 'boolean' ? forceState : !this.isBuildMode;
        if (nextBuild) {
          // Build and repair work for whichever local/unoccupied creation you are closest to!
          const target = this.getClosestOwnedCreation(
            this.isSeatedInRig ? this.getActiveRig().position : this.camFreePos,
          );
          this.activeCreationIndex = target.index;
          setActiveCreationIdxState(target.index);
        }
        const activeRig = this.getActiveRig();
        this.isBuildMode = nextBuild;
        if (nextBuild) {
          this.recoverFromRagdoll(true);
          this.playerCharacterMesh.visible = false;
          this.isWorldEditMode = false;
        } else {
          this.selectedBuildObjects = [];
          this.selectedBuildObject = null;
          this.marqueeSelect = null;
          if (marqueeBoxRef.current) {
            marqueeBoxRef.current.style.display = 'none';
          }
          selectedObjectWireframe.visible = false;
          clearPreviewOverlay();
        }
        this.dragStartVoxel = null;
        this.isLeftMouseDown = false;
        this.isRightMouseDown = false;
        this.creations.forEach((c, idx) => {
          c.setHoverBuildMode(nextBuild && idx === this.activeCreationIndex);
        });

        if (nextBuild) {
          this.isSeatedInRig = false;
          // Always unlock the mouse in Build Mode so blocks can be selected and placed freely!
          if (document.pointerLockElement) {
            document.exitPointerLock?.();
          }
          this.isPointerLocked = false;
          fx.speedLinesMesh.visible = false;

          this.buildOrbitPivot.copy(activeRig.position);
          const spanMeters = Math.max(
            6.2,
            Math.max(activeRig.maxVX - activeRig.minVX, activeRig.maxVZ - activeRig.minVZ) * VOXEL_SIZE * 1.15,
          );
          this.buildOrbitDist = spanMeters;
          this.buildCameraAngle = 'ORBIT_3D';

          const rigFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
            activeRig.quaternion,
          );
          const rigRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
            activeRig.quaternion,
          );
          this.camFreePos
            .copy(activeRig.position)
            .addScaledVector(rigFwd, -spanMeters * 0.75)
            .addScaledVector(rigRight, spanMeters * 0.5)
            .add(new THREE.Vector3(0, spanMeters * 0.32, 0));

          const toRig = activeRig.position
            .clone()
            .sub(this.camFreePos)
            .normalize();
          this.camYaw = Math.atan2(-toRig.x, -toRig.z);
          this.camPitch = Math.asin(Math.max(-0.9, Math.min(0.9, toRig.y)));
          this.pointerNDC.set(0, 0);
          this.hasPointerMoved = false;
        } else {
          if (this.multiplayer) {
            this.multiplayer.broadcastSpawnVehicle(activeRig);
          }
          if (!activeRig.hasIntactSeat()) {
            this.exitVehicle();
            SoundFX.clank();
          } else {
            this.enterVehicle(activeRig);
            this.selectedSlot = Math.min(PLAY_SLOTS.length, this.selectedSlot);
            this.requestCanvasPointerLock();
          }
        }
        if (this.multiplayer) {
          this.multiplayer.buildStateSyncPacket();
        }
        syncHudNow();
      },

      toggleObjectStudioMode(forceState?: boolean) {
        SoundFX.hover();
        const nextStudio =
          typeof forceState === 'boolean'
            ? forceState
            : !this.isObjectStudioMode;
        if (nextStudio === this.isObjectStudioMode) return;
        const curRig = this.getActiveRig();

        if (nextStudio) {
          this.savedVehicleBeforeStudio = curRig.exportBlueprint(
            curRig.customBlueprintName || 'Active Rig Backup',
          );
          this.isObjectStudioMode = true;
          this.isWorldEditMode = false;
          this.isBuildMode = true;
          this.isSeatedInRig = false;
          this.recoverFromRagdoll(true);
          this.playerCharacterMesh.visible = false;
          this.selectedSlot = 1;
          this.dragStartVoxel = null;
          if (document.pointerLockElement) {
            document.exitPointerLock?.();
          }
          this.isPointerLocked = false;
          curRig.setHoverBuildMode(true);
          curRig.initObjectStudioPedestal();
          this.focusBuildCamera();
        } else {
          this.isObjectStudioMode = false;
          if (this.savedVehicleBeforeStudio) {
            curRig.importBlueprint(this.savedVehicleBeforeStudio);
            this.savedVehicleBeforeStudio = null;
          }
          this.toggleHoverBuildMode(false);
        }
        syncHudNow();
      },

      saveCustomObjectAndEquip(customName: string): VoxelObjectPrefab {
        SoundFX.snap();
        const curRig = this.getActiveRig();
        const prefab = curRig.exportAsPlaceableObjectPrefab(customName, 'CUSTOM');
        const existingCustom = loadCustomObjectsFromStorage();
        const updatedCustom = [
          prefab,
          ...existingCustom.filter((o) => o.name !== prefab.name),
        ].slice(0, 24);
        try {
          localStorage.setItem(
            STORAGE_KEY_CUSTOM_OBJECTS,
            JSON.stringify(updatedCustom),
          );
        } catch {
          // Ignore quota errors
        }
        setCustomObjects(updatedCustom);
        this.allPlaceableObjects = [...PREBUILT_OBJECTS, ...updatedCustom];

        // Restore player's vehicle and switch straight into World Editor Object Placement!
        if (this.savedVehicleBeforeStudio) {
          curRig.importBlueprint(this.savedVehicleBeforeStudio);
          this.savedVehicleBeforeStudio = null;
        }
        this.isObjectStudioMode = false;
        this.isBuildMode = false;
        curRig.setHoverBuildMode(false);
        this.selectedObjectId = prefab.id;
        this.worldEditTool = 'PLACE_OBJECT';
        this.toggleWorldEditMode(true);
        return prefab;
      },

      loadPrefabIntoObjectStudio(prefab: VoxelObjectPrefab) {
        if (!this.isObjectStudioMode) {
          this.toggleObjectStudioMode(true);
        }
        const curRig = this.getActiveRig();
        curRig.loadPlaceableObjectPrefabIntoStudio(prefab);
        this.focusBuildCamera();
        syncHudNow();
      },

      loadPropMakerTemplate(template: PropTemplateKind) {
        SoundFX.snap();
        if (!this.isObjectStudioMode) {
          this.toggleObjectStudioMode(true);
        }
        const curRig = this.getActiveRig();
        curRig.loadPropTemplate(template);
        this.focusBuildCamera();
        syncHudNow();
      },

      saveCurrentBuildAsProp(customName?: string, switchMode = false): VoxelObjectPrefab {
        SoundFX.snap();
        const curRig = this.getActiveRig();
        const propName = (customName || curRig.customBlueprintName || 'Custom Prop').trim();
        const prefab = curRig.exportAsPlaceableObjectPrefab(propName, 'CUSTOM');
        const existingCustom = loadCustomObjectsFromStorage();
        const updatedCustom = [
          prefab,
          ...existingCustom.filter((o) => o.name !== prefab.name),
        ].slice(0, 32);
        try {
          localStorage.setItem(STORAGE_KEY_CUSTOM_OBJECTS, JSON.stringify(updatedCustom));
        } catch {}
        setCustomObjects(updatedCustom);
        this.allPlaceableObjects = [...PREBUILT_OBJECTS, ...updatedCustom];
        this.selectedObjectId = prefab.id;
        if (switchMode) {
          if (this.savedVehicleBeforeStudio) {
            curRig.importBlueprint(this.savedVehicleBeforeStudio);
            this.savedVehicleBeforeStudio = null;
          }
          this.isObjectStudioMode = false;
          this.isBuildMode = false;
          curRig.setHoverBuildMode(false);
          this.worldEditTool = 'PLACE_PROP';
          this.toggleWorldEditMode(true);
        }
        syncHudNow();
        return prefab;
      },

      testDriveAgainstCurrentProp(customName?: string) {
        const prefab = this.saveCurrentBuildAsProp(customName || objectStudioName);
        if (this.savedVehicleBeforeStudio) {
          const curRig = this.getActiveRig();
          curRig.importBlueprint(this.savedVehicleBeforeStudio);
          this.savedVehicleBeforeStudio = null;
        }
        this.isObjectStudioMode = false;
        this.isBuildMode = false;
        const curRig = this.getActiveRig();
        curRig.setHoverBuildMode(false);
        this.enterVehicle(curRig);
        this.requestCanvasPointerLock();
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(curRig.quaternion);
        const spawnX = curRig.position.x + fwd.x * 8.5;
        const spawnZ = curRig.position.z + fwd.z * 8.5;
        const yawRad = Math.atan2(fwd.x, fwd.z);
        const ent = createCustomPropRig(
          scene,
          world,
          fx,
          prefab,
          spawnX,
          spawnZ,
          yawRad,
          0.12,
          true,
        );
        if (this.graphicsSettings.useCartoonShader) {
          ent.setCartoonShaderMode(true);
        } else {
          ent.setCartoonShaderMode(false);
          ent.setPotatoShaderMode(this.graphicsSettings.usePotatoShader);
        }
        ent.setBlobShadowVisible(this.graphicsSettings.blobShadows);
        this.voxelEntities.push(ent);
        fx.spawnWeldSparks(spawnX, ent.position.y + 0.5, spawnZ);
        SoundFX.snap();
        syncHudNow();
      },

      setPropPhysicsMode(mode: 'DYNAMIC' | 'STATIC') {
        SoundFX.snap();
        this.propPhysicsMode = mode;
        syncHudNow();
      },

      togglePropPhysicsMode() {
        SoundFX.hover();
        this.propPhysicsMode = this.propPhysicsMode === 'DYNAMIC' ? 'STATIC' : 'DYNAMIC';
        syncHudNow();
      },

      spawnCurrentPropInFront() {
        SoundFX.snap();
        const curRig = this.getActiveRig();
        const prefab =
          this.allPlaceableObjects.find(
            (o) => o.id === this.selectedObjectId,
          ) || PREBUILT_OBJECTS[0];

        let spawnX = 0;
        let spawnZ = 0;
        let targetYaw = 0;
        if (this.isSeatedInRig && this.activeVehicle) {
          const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
            this.activeVehicle.quaternion,
          );
          spawnX = this.activeVehicle.position.x + fwd.x * 6.5;
          spawnZ = this.activeVehicle.position.z + fwd.z * 6.5;
          targetYaw = Math.atan2(fwd.x, fwd.z);
        } else {
          const fwdX = -Math.sin(this.camYaw);
          const fwdZ = -Math.cos(this.camYaw);
          spawnX = this.camFreePos.x + fwdX * 5.0;
          spawnZ = this.camFreePos.z + fwdZ * 5.0;
          targetYaw = this.camYaw;
        }

        if (this.propPhysicsMode === 'DYNAMIC') {
          const ent = createCustomPropRig(
            scene,
            world,
            fx,
            prefab,
            spawnX,
            spawnZ,
            targetYaw,
            0.15,
            true,
          );
          if (this.graphicsSettings.useCartoonShader) {
            ent.setCartoonShaderMode(true);
          } else {
            ent.setCartoonShaderMode(false);
            ent.setPotatoShaderMode(this.graphicsSettings.usePotatoShader);
          }
          ent.setBlobShadowVisible(this.graphicsSettings.blobShadows);
          this.voxelEntities.push(ent);
          fx.spawnWeldSparks(spawnX, ent.position.y + 0.5, spawnZ);
        } else {
          const vx = Math.round(spawnX / VOXEL_SIZE);
          const vz = Math.round(spawnZ / VOXEL_SIZE);
          const groundY = world.sampleSurfaceHeightFast(spawnX, spawnZ);
          const vy = Math.round(groundY / VOXEL_SIZE) + 1;
          world.stampObjectPrefab(
            prefab,
            vx,
            vy,
            vz,
            curRig.partYawIndex,
            curRig.partPitchIndex,
            curRig.partRollIndex,
          );
          fx.spawnWeldSparks(spawnX, groundY + 0.5, spawnZ);
        }
        syncHudNow();
      },

      resetPartRotation() {
        const curRig = this.getActiveRig();
        curRig.partYawIndex = 0;
        curRig.partPitchIndex = 0;
        curRig.partRollIndex = 0;
        SoundFX.snap();
        syncHudNow();
      },

      toggleWorldEditMode(forceState?: boolean) {
        SoundFX.hover();
        const curRig = this.getActiveRig();
        if (this.isObjectStudioMode) {
          this.isObjectStudioMode = false;
          if (this.savedVehicleBeforeStudio) {
            curRig.importBlueprint(this.savedVehicleBeforeStudio);
            this.savedVehicleBeforeStudio = null;
          }
        }
        const nextWorldEdit =
          typeof forceState === 'boolean' ? forceState : !this.isWorldEditMode;
        this.isWorldEditMode = nextWorldEdit;
        this.rampStartWorld = null;
        this.hasPointerMoved = false;
        this.pointerNDC.set(0, 0);

        if (nextWorldEdit) {
          this.isBuildMode = false;
          this.recoverFromRagdoll(true);
          this.playerCharacterMesh.visible = false;
          curRig.setHoverBuildMode(false);
          if (document.pointerLockElement) {
            document.exitPointerLock?.();
          }
          this.isPointerLocked = false;
          if (this.isSeatedInRig) {
            this.isSeatedInRig = false;
            const spawnPos = curRig.position
              .clone()
              .add(new THREE.Vector3(0, 6.5, -10));
            this.camFreePos.copy(spawnPos);
            const toRig = curRig.position
              .clone()
              .sub(this.camFreePos)
              .normalize();
            this.camYaw = Math.atan2(-toRig.x, -toRig.z);
            this.camPitch = Math.asin(Math.max(-0.85, Math.min(0.85, toRig.y)));
          }
        } else {
          this.enterVehicle(curRig);
          this.requestCanvasPointerLock();
        }
        syncHudNow();
      },

      setWorldEditTool(tool: WorldEditToolKind) {
        SoundFX.snap();
        this.worldEditTool = tool;
        this.rampStartWorld = null;
        syncHudNow();
      },

      selectPlaceableObject(id: string) {
        SoundFX.snap();
        this.selectedObjectId = id;
        this.worldEditTool = 'PLACE_OBJECT';
        syncHudNow();
      },

      setTerraPaintMat(mat: number) {
        SoundFX.snap();
        this.terraPaintMat = mat;
        syncHudNow();
      },

      setTerraBrushRadius(rad: number) {
        SoundFX.snap();
        this.terraBrushRadius = Math.max(2, Math.min(18, rad));
        syncHudNow();
      },

      regenerateUnlimitedWorld(
        mode: WorldGenMode,
        flatMat: number = MAT.CONCRETE,
        heightmap: {
          width: number;
          height: number;
          heights: Uint8Array;
          scaleY: number;
        } | null = null,
      ) {
        SoundFX.hover();
        fx.reset();
        world.regenerateWorld(mode, flatMat, heightmap);
        const curRig = this.getActiveRig();
        curRig.summonTo(0, -2.0, 0);
        if (mode === 'DEFAULT_PARK' && heightmap === null) {
          this.resetArenaVoxelEntities();
          this.resetArenaMapHazards();
        } else {
          this.clearVoxelEntities();
          this.clearMapHazards();
        }
        this.multiplayer?.broadcastWorldMapSync(
          heightmap ? `Custom Heightmap (${mode})` : `Biome: ${mode}`,
        );
        syncHudNow();
      },

      startVehicleFromSingleVoxel() {
        SoundFX.hover();
        const curRig = this.getActiveRig();
        if (!this.isBuildMode) {
          this.isBuildMode = true;
          this.isSeatedInRig = false;
          curRig.setHoverBuildMode(true);
        }
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        this.isPointerLocked = false;
        this.dragStartVoxel = null;
        curRig.loadPreset(5); // Preset 5 = 1-Voxel Scratch Core at (12, 6, 18)
        curRig.mirrorMode = false;
        this.selectedSlot = 1;

        const singleVoxelWorld = curRig.localVoxelToWorld(12, 6, 18);
        this.buildOrbitPivot.copy(singleVoxelWorld);
        this.buildOrbitDist = 2.4;

        const rigBack = new THREE.Vector3(0, 0, -1).applyQuaternion(
          curRig.quaternion,
        );
        this.camFreePos
          .copy(singleVoxelWorld)
          .addScaledVector(rigBack, 2.2)
          .add(new THREE.Vector3(0, 0.5, 0));
        const toVox = singleVoxelWorld
          .clone()
          .sub(this.camFreePos)
          .normalize();
        this.camYaw = Math.atan2(-toVox.x, -toVox.z);
        this.camPitch = Math.asin(Math.max(-0.9, Math.min(0.9, toVox.y)));
        this.pointerNDC.set(0, 0);
        this.hasPointerMoved = false;
        syncHudNow();
      },

      focusBuildCamera() {
        if (!this.isBuildMode && !this.isWorldEditMode) return;
        SoundFX.snap();
        const curRig = this.getActiveRig();
        const targetPt = this.currentHit?.worldPos
          ? this.currentHit.worldPos.clone()
          : this.currentHit && this.isBuildMode
            ? curRig.localVoxelToWorld(
                this.currentHit.vx,
                this.currentHit.vy,
                this.currentHit.vz,
              )
            : curRig.position.clone();
        this.buildOrbitPivot.copy(targetPt);
        const backDir = new THREE.Vector3(
          Math.sin(this.camYaw) * Math.cos(this.camPitch),
          -Math.sin(this.camPitch),
          Math.cos(this.camYaw) * Math.cos(this.camPitch),
        ).normalize();
        this.camFreePos
          .copy(targetPt)
          .addScaledVector(backDir, this.buildOrbitDist);
        syncHudNow();
      },

      cycleBuildCameraAngle() {
        SoundFX.snap();
        const curRig = this.getActiveRig();
        const order: BuildCameraAngle[] = ['ORBIT_3D', 'TOP', 'SIDE', 'FRONT'];
        const nextIdx = (order.indexOf(this.buildCameraAngle) + 1) % order.length;
        this.buildCameraAngle = order[nextIdx];
        this.buildOrbitPivot.copy(curRig.position);

        const dist = Math.max(
          6.5,
          Math.max(curRig.maxVX - curRig.minVX, curRig.maxVZ - curRig.minVZ) * VOXEL_SIZE * 1.25,
        );
        this.buildOrbitDist = dist;

        const rigFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(curRig.quaternion);
        const rigRight = new THREE.Vector3(1, 0, 0).applyQuaternion(curRig.quaternion);

        if (this.buildCameraAngle === 'TOP') {
          this.camFreePos.copy(curRig.position).add(new THREE.Vector3(0, dist * 1.15, -0.2));
        } else if (this.buildCameraAngle === 'SIDE') {
          this.camFreePos.copy(curRig.position).addScaledVector(rigRight, dist);
        } else if (this.buildCameraAngle === 'FRONT') {
          this.camFreePos.copy(curRig.position).addScaledVector(rigFwd, dist).add(new THREE.Vector3(0, 0.8, 0));
        } else {
          this.camFreePos
            .copy(curRig.position)
            .addScaledVector(rigFwd, -dist * 0.75)
            .addScaledVector(rigRight, dist * 0.5)
            .add(new THREE.Vector3(0, dist * 0.35, 0));
        }

        const toRig = curRig.position.clone().sub(this.camFreePos).normalize();
        this.camYaw = Math.atan2(-toRig.x, -toRig.z);
        this.camPitch = Math.asin(Math.max(-1.42, Math.min(1.42, toRig.y)));
        syncHudNow();
      },

      cycleCameraMode(forceMode?: CameraViewMode) {
        if (this.isBuildMode) {
          this.cycleBuildCameraAngle();
          return;
        }
        SoundFX.snap();
        if (forceMode) {
          this.cameraMode = forceMode;
        } else {
          const idx = CAMERA_MODES.findIndex((c) => c.id === this.cameraMode);
          this.cameraMode = CAMERA_MODES[(idx + 1) % CAMERA_MODES.length].id;
        }
        this.driveYawOffset = 0;
        if (this.cameraMode === 'TOP_DOWN') {
          this.drivePitchOffset = 1.12;
          this.driveOrbitDist = 18.5;
        } else if (this.cameraMode === 'FREE_ORBIT') {
          this.drivePitchOffset = 0.35;
          this.driveOrbitDist = 11.5;
        } else {
          this.drivePitchOffset = 0.28;
          this.driveOrbitDist = 9.4;
        }
        syncHudNow();
      },

      toggleZoom(force?: boolean): boolean {
        if (this.isBuildMode) {
          this.isZoomed = false;
          world.zoomFocusWorld = null;
          this.zoomFocusDistMeters = 0;
          syncHudNow();
          return false;
        }
        const next = typeof force === 'boolean' ? force : !this.isZoomed;
        this.isZoomed = next;
        if (!next) {
          world.zoomFocusWorld = null;
          this.zoomFocusDistMeters = 0;
        } else {
          this.applyOpticalZoomAndTarget(0.016);
        }
        SoundFX.snap();
        syncHudNow();
        return next;
      },

      setZoomMagnification(mag: number): void {
        const sanitized = Math.max(1.25, Number(mag) || 4);
        this.zoomMagnification = sanitized;
        if (!this.isZoomed && !this.isBuildMode) {
          this.isZoomed = true;
        }
        if (this.isZoomed) {
          this.applyOpticalZoomAndTarget(0.016);
        }
        SoundFX.snap();
        syncHudNow();
      },

      stepZoomMagnification(dir: 1 | -1): void {
        const nextMag =
          dir > 0
            ? this.zoomMagnification * 2
            : Math.max(1.25, this.zoomMagnification / 2);
        const rounded =
          nextMag >= 2 ? Math.round(nextMag) : Number(nextMag.toFixed(2));
        if (rounded !== this.zoomMagnification) {
          this.zoomMagnification = rounded;
          if (this.isZoomed) {
            this.applyOpticalZoomAndTarget(0.016);
          }
          SoundFX.snap();
          syncHudNow();
        }
      },

      setPlacementMode(mode: BuildPlacementMode) {
        SoundFX.snap();
        this.placementMode = mode;
        this.dragStartVoxel = null;
        this.dragStartMicro = null;
        updateRaycastTarget();
        syncHudNow();
      },

      setHullScalePx(px: number) {
        const clamped = clampHullScalePx(px);
        if (this.hullScalePx === clamped) return;
        SoundFX.snap();
        this.hullScalePx = clamped;
        this.dragStartVoxel = null;
        this.dragStartMicro = null;
        updateRaycastTarget();
        syncHudNow();
      },

      stepHullScale(_delta: number) {
        this.setHullScalePx(toggleHullStampScalePx(this.hullScalePx));
      },

      toggleHullStampMode() {
        this.setHullScalePx(toggleHullStampScalePx(this.hullScalePx));
      },

      setBoxDepthPx(depth: number) {
        const clamped = Math.max(1, Math.min(8, Math.round(depth || 1)));
        if (this.boxDepthPx === clamped) return;
        SoundFX.snap();
        this.boxDepthPx = clamped;
        updateRaycastTarget();
        syncHudNow();
      },

      stepBoxDepthPx(delta: number) {
        this.setBoxDepthPx(this.boxDepthPx + (delta < 0 ? -1 : 1));
      },

      setHullShape(_shape: HullMicroShape) {
        // Pure 1px cube car hull voxels (no sculpted wedge/shape variants)
        this.hullShape = 'CUBE';
        updateRaycastTarget();
        syncHudNow();
      },

      cycleHullShape() {
        const idx = HULL_SHAPE_OPTIONS.findIndex((s) => s.id === this.hullShape);
        const next = HULL_SHAPE_OPTIONS[(idx + 1) % HULL_SHAPE_OPTIONS.length].id;
        this.setHullShape(next);
      },

      toggleEyedropperMode(force?: boolean) {
        const next = force !== undefined ? force : !this.eyedropperMode;
        this.eyedropperMode = next;
        SoundFX.snap();
        syncHudNow();
      },

      sampleHoveredObjectToBrush(): boolean {
        updateRaycastTarget();
        const hit = this.currentHit;
        const curRig = this.getActiveRig();
        if (!hit || hit.target !== 'vehicle') {
          if (this.selectedBuildObject) {
            this.pickSelectedObjectToBrush();
            this.eyedropperMode = false;
            syncHudNow();
            return true;
          }
          return false;
        }
        if (hit.moduleHit) {
          const slotMeta = BUILD_SLOTS.find((s) => s.kind === hit.moduleHit?.kind);
          if (slotMeta) {
            this.selectSlot(slotMeta.slot);
          }
          curRig.partYawIndex = hit.moduleHit.yawIdx || 0;
          curRig.partPitchIndex = hit.moduleHit.pitchIdx || 0;
          curRig.partRollIndex = hit.moduleHit.rollIdx || 0;
          if (hit.moduleHit.config) {
            curRig.setKindDefaultConfig(hit.moduleHit.kind, hit.moduleHit.config);
          }
        } else {
          const cleanMat = hit.mat & 63;
          const slotMeta = BUILD_SLOTS.find(
            (s) => s.type === 'voxel' && s.mat === cleanMat,
          );
          if (slotMeta) {
            this.selectSlot(slotMeta.slot);
          }
          if (hit.hitIsMicro && this.hullScalePx === 4) {
            this.hullScalePx = 1;
          } else if (!hit.hitIsMicro && this.hullScalePx < 4) {
            this.hullScalePx = 4;
          }
        }
        this.eyedropperMode = false;
        if (this.placementMode === 'CHISEL') {
          this.placementMode = 'SINGLE';
        }
        SoundFX.snap();
        updateRaycastTarget();
        syncHudNow();
        return true;
      },

      toggleXrayMode(force?: boolean): boolean {
        const curRig = this.getActiveRig();
        const next = curRig.setXrayMode(force);
        SoundFX.snap();
        updateRaycastTarget();
        syncHudNow();
        return next;
      },

      setSymmetryAxisMode(mode: SymmetryAxisMode) {
        const curRig = this.getActiveRig();
        curRig.setSymmetryAxisMode(mode);
        SoundFX.snap();
        updateRaycastTarget();
        syncHudNow();
      },

      cycleSymmetryAxisMode(): SymmetryAxisMode {
        const curRig = this.getActiveRig();
        const next = curRig.cycleSymmetryAxisMode();
        SoundFX.snap();
        updateRaycastTarget();
        syncHudNow();
        return next;
      },

      copySelectionToStamp(): SubAssemblyPrefab | null {
        const curRig = this.getActiveRig();
        if (this.selectedBuildObjects.length === 0) return null;
        const prefab = curRig.exportSubAssemblyPrefab(
          `Clip (${this.selectedBuildObjects.length})`,
          this.selectedBuildObjects,
        );
        if (prefab) {
          setSavedSubAssemblies((prev) => [prefab, ...prev.slice(0, 7)]);
          setActiveStampPrefab(prefab);
          SoundFX.snap();
          syncHudNow();
        }
        return prefab;
      },

      cyclePlacementMode() {
        const idx = PLACEMENT_MODES.findIndex((p) => p.id === this.placementMode);
        const next = PLACEMENT_MODES[(idx + 1) % PLACEMENT_MODES.length].id;
        this.setPlacementMode(next);
      },

      toggleEnterExitRig() {
        if (this.isBuildMode) {
          this.toggleHoverBuildMode(false);
          return;
        }
        if (this.isSeatedInRig) {
          this.exitVehicle();
          SoundFX.snap();
        } else {
          // On foot: another player can only enter an empty seat (seatedPlayerId === null)
          // by walking up and pressing [E] within 2.5m range!
          const candidate = this.findClosestEnterableSeat(this.camFreePos, 2.5);
          if (candidate && this.enterVehicle(candidate.rig, candidate.seatIndex)) {
            SoundFX.snap();
          } else {
            SoundFX.clank();
          }
        }
        this.requestCanvasPointerLock();
        syncHudNow();
      },

      setUiMode(modeId: 'DRIVE' | 'BUILD' | 'WALK' | 'WORLD_EDIT' | 'PROP_STUDIO') {
        if (modeId === 'BUILD') {
          if (this.isObjectStudioMode) this.toggleObjectStudioMode(false);
          if (!this.isBuildMode) this.toggleHoverBuildMode(true);
        } else if (modeId === 'PROP_STUDIO') {
          this.toggleObjectStudioMode(true);
        } else if (modeId === 'WORLD_EDIT') {
          if (this.isObjectStudioMode) this.toggleObjectStudioMode(false);
          if (this.isBuildMode) this.toggleHoverBuildMode(false);
          if (!this.isWorldEditMode) this.toggleWorldEditMode(true);
        } else if (modeId === 'WALK') {
          if (this.isObjectStudioMode) this.toggleObjectStudioMode(false);
          if (this.isBuildMode) this.toggleHoverBuildMode(false);
          if (this.isWorldEditMode) this.toggleWorldEditMode(false);
          if (this.isSeatedInRig) this.exitVehicle();
        } else if (modeId === 'DRIVE') {
          if (this.isObjectStudioMode) this.toggleObjectStudioMode(false);
          if (this.isBuildMode) this.toggleHoverBuildMode(false);
          if (this.isWorldEditMode) this.toggleWorldEditMode(false);
          if (!this.isSeatedInRig) {
            this.enterVehicle(this.getActiveRig());
          }
        }
        syncHudNow();
      },

      callAndUprightRig() {
        SoundFX.hover();
        const target = this.getClosestOwnedCreation(
          this.isSeatedInRig ? this.getActiveRig().position : this.camFreePos,
        );
        const fwd = new THREE.Vector3(
          -Math.sin(this.camYaw),
          0,
          -Math.cos(this.camYaw),
        );
        target.rig.callAndUprightTo(
          this.isSeatedInRig
            ? target.rig.position.x
            : this.camFreePos.x + fwd.x * 5.5,
          this.isSeatedInRig
            ? target.rig.position.z
            : this.camFreePos.z + fwd.z * 5.5,
          this.isSeatedInRig ? this.driveYawOffset : this.camYaw,
        );
        syncHudNow();
      },

      selectPreset(idx: number) {
        SoundFX.snap();
        if (idx === PRESET_NAMES.length - 1) {
          this.startVehicleFromSingleVoxel();
          return;
        }
        const myPeerId = this.multiplayer?.localPeerId || 'local';
        const curRig = this.getActiveRig();
        curRig.loadPreset(idx);
        if (
          (idx === 6 || idx === 7) &&
          world.worldGenMode === 'DEFAULT_PARK' &&
          curRig.position.x > -24
        ) {
          curRig.summonTo(-38, -10, Math.PI * 0.5);
        }
        curRig.assignNetworkIdentity(myPeerId, curRig.networkId, this.isSeatedInRig);
        if (this.multiplayer) {
          this.multiplayer.broadcastSpawnVehicle(curRig);
        }
        syncHudNow();
      },

      selectSlot(slot: number) {
        SoundFX.snap();
        this.selectedSlot = slot;
        setRecentBuildSlotIds((prev) => {
          const next = [slot, ...prev.filter((s) => s !== slot)];
          return next.slice(0, 6);
        });
        syncHudNow();
      },

      flipSummonRig() {
        SoundFX.hover();
        const target = this.getClosestOwnedCreation(
          this.isSeatedInRig ? this.getActiveRig().position : this.camFreePos,
        );
        target.rig.repairVehicle();
        const fwd = new THREE.Vector3(
          -Math.sin(this.camYaw),
          0,
          -Math.cos(this.camYaw),
        );
        target.rig.summonTo(
          this.isSeatedInRig
            ? target.rig.position.x
            : this.camFreePos.x + fwd.x * 6,
          this.isSeatedInRig
            ? target.rig.position.z
            : this.camFreePos.z + fwd.z * 6,
          this.isSeatedInRig ? 0 : this.camYaw,
        );
        if (this.multiplayer) {
          this.multiplayer.broadcastSpawnVehicle(target.rig);
        }
        syncHudNow();
      },

      toggleMirrorMode() {
        this.cycleSymmetryAxisMode();
      },

      toggleForcesOverlay() {
        const curRig = this.getActiveRig();
        curRig.toggleForcesOverlay();
        SoundFX.snap();
        syncHudNow();
      },

      rotatePartYaw() {
        this.rotatePartAxis('yaw');
      },

      rotatePartAxis(axis: RotationAxis) {
        const curRig = this.getActiveRig();
        if (axis === 'yaw') {
          curRig.partYawIndex = (curRig.partYawIndex + 1) & 3;
        } else if (axis === 'pitch') {
          curRig.partPitchIndex = (curRig.partPitchIndex + 1) & 3;
        } else {
          curRig.partRollIndex = (curRig.partRollIndex + 1) & 3;
        }
        SoundFX.snap();
        updateRaycastTarget();
        syncHudNow();
      },

      undoBuildStep(): boolean {
        const curRig = this.getActiveRig();
        const ok = curRig.undoBuildStep();
        if (ok) {
          SoundFX.remove();
          if (!this.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          syncHudNow();
        }
        return ok;
      },

      redoBuildStep(): boolean {
        const curRig = this.getActiveRig();
        const ok = curRig.redoBuildStep();
        if (ok) {
          SoundFX.snap();
          if (!this.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          syncHudNow();
        }
        return ok;
      },

      saveCurrentVehicle(customName: string): SerializedVehicleBlueprint {
        SoundFX.snap();
        const curRig = this.getActiveRig();
        const bp = curRig.exportBlueprint(customName);
        const existing = loadSavedBlueprintsFromStorage();
        const updated = [bp, ...existing.filter((b) => b.name !== bp.name)].slice(
          0,
          24,
        );
        try {
          localStorage.setItem(STORAGE_KEY_BLUEPRINTS, JSON.stringify(updated));
        } catch {
          // Ignore storage quota errors
        }
        setSavedBlueprints(updated);
        syncHudNow();
        return bp;
      },

      loadSavedVehicle(bp: SerializedVehicleBlueprint) {
        SoundFX.hover();
        const curRig = this.getActiveRig();
        curRig.importBlueprint(bp);
        if (this.isBuildMode) {
          this.focusBuildCamera();
        }
        if (this.multiplayer) {
          this.multiplayer.broadcastSpawnVehicle(curRig);
        }
        syncHudNow();
      },

      startGame() {
        SoundFX.init();
        SoundFX.hover();
        fx.reset();
        this.introSwoopProgress = 0.0;
        world.triggerArenaWireframeSweep();
        this.gameState = 'playing';
        document.body.dataset.state = 'playing';
        setGameState('playing');
        for (const k in this.keys) this.keys[k] = false;
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        if (!this.isBuildMode) {
          this.requestCanvasPointerLock();
        }
      },

      pauseGame() {
        this.gameState = 'paused';
        document.body.dataset.state = 'paused';
        setGameState('paused');
        for (const k in this.keys) this.keys[k] = false;
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
      },

      resumeGame() {
        SoundFX.init();
        this.gameState = 'playing';
        document.body.dataset.state = 'playing';
        setGameState('playing');
        for (const k in this.keys) this.keys[k] = false;
        if (!this.isBuildMode) {
          this.requestCanvasPointerLock();
        }
      },

      restartSandbox() {
        SoundFX.init();
        SoundFX.hover();
        fx.reset();
        this.isBuildMode = false;
        const curRig = this.getActiveRig();
        curRig.setHoverBuildMode(false);
        curRig.loadPreset(
          curRig.presetIndex === PRESET_NAMES.length - 1 ? 0 : curRig.presetIndex,
        );
        curRig.summonTo(0, -2.0, 0);
        this.enterVehicle(curRig);
        this.introSwoopProgress = 0.0;
        world.triggerArenaWireframeSweep();

        this.gameState = 'playing';
        document.body.dataset.state = 'playing';
        setGameState('playing');
        this.requestCanvasPointerLock();
        syncHudNow();
      },
    };

    bindSeatBreakageToRig(initialRig);

    const multiplayer = new P2PMultiplayerManager({
      scene,
      world,
      fx,
      getCreations: () => sim.creations,
      getActiveVehicle: () => sim.activeVehicle,
      getIsWalking: () => sim.isWalking || !sim.isSeatedInRig,
      getIsBuilding: () => sim.isBuildMode || sim.isObjectStudioMode,
      getLocalPlayerTransform: () => {
        if (!sim.isWalking && sim.isSeatedInRig && sim.activeVehicle) {
          return {
            pos: sim.activeVehicle.position,
            quat: sim.activeVehicle.quaternion,
          };
        }
        const q = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          sim.camYaw + Math.PI,
        );
        return {
          pos: new THREE.Vector3(
            sim.camFreePos.x,
            sim.camFreePos.y - 1.65,
            sim.camFreePos.z,
          ),
          quat: q,
        };
      },
      getLocalCharacterAnimState: () => {
        const isWalkingNow = sim.isWalking || !sim.isSeatedInRig;
        const isMovingNow =
          isWalkingNow &&
          Boolean(
            sim.keys['KeyW'] ||
              sim.keys['KeyS'] ||
              sim.keys['KeyA'] ||
              sim.keys['KeyD'],
          );
        const isSprintingNow = Boolean(sim.keys['ShiftLeft']);
        const walkSpeed = isMovingNow ? (isSprintingNow ? 11.5 : 6.8) : 0;
        const activePlayTool = PLAY_SLOTS[sim.selectedSlot - 1] || PLAY_SLOTS[0];
        const equippedTool: CharacterEquippedTool =
          sim.isBuildMode || sim.isObjectStudioMode
            ? 'WRENCH'
            : !isWalkingNow
              ? 'NONE'
              : activePlayTool?.kind === 'PLASMA_RIFLE'
                ? 'PLASMA_RIFLE'
                : activePlayTool?.kind === 'SLEDGE'
                  ? 'SLEDGE'
                  : activePlayTool?.kind === 'PIPE_BOMB'
                    ? 'PIPE_BOMB'
                    : 'WRENCH';
        const curVeh = sim.getActiveRig();
        return {
          lookPitch: sim.camPitch,
          walkSpeed,
          isAirborne:
            isWalkingNow && (Math.abs(sim.playerVelY) > 0.5 || sim.isJetpacking),
          isJetpacking: isWalkingNow && sim.isJetpacking,
          equippedTool,
          steerAngle: curVeh ? curVeh.steerAngle : 0,
        };
      },
      spawnRemoteVehicleRig: (packet: SpawnVehiclePacket) => {
        const remoteRig = new ModularVehicleRig(
          scene,
          world,
          fx,
          packet.ownerPeerId || 'remote',
          true,
        );
        bindSeatBreakageToRig(remoteRig);
        remoteRig.networkId = packet.vehicleId;
        remoteRig.ownerPeerId = packet.ownerPeerId;
        const hasBlocks =
          (packet.blueprint?.voxels && packet.blueprint.voxels.length > 0) ||
          (packet.blueprint?.modules && packet.blueprint.modules.length > 0);
        if (hasBlocks) {
          remoteRig.importBlueprint(packet.blueprint);
          remoteRig.rootGroup.userData.isPlaceholderBlueprint = false;
        } else {
          // Ensure remote vehicle is immediately visible while full blueprint packet is in flight
          remoteRig.loadPreset(0);
          remoteRig.rootGroup.userData.isPlaceholderBlueprint = true;
        }
        // Ensure local active rig remains bound to fx.rig
        fx.rig = sim.getActiveRig();
        // Lock the remote creator's seat so local player never auto-mounts a remote vehicle on spawn!
        if (packet.seatClaims && packet.seatClaims.length > 0) {
          for (const sc of packet.seatClaims) {
            remoteRig.claimSeat(sc.seatIndex, sc.peerId);
          }
        } else {
          remoteRig.claimSeat(0, packet.driverPeerId ?? packet.ownerPeerId);
        }
        remoteRig.isRemoteControlled = true;
        remoteRig.position.set(
          packet.spawnPos[0],
          packet.spawnPos[1],
          packet.spawnPos[2],
        );
        remoteRig.quaternion.set(
          packet.spawnQuat[0],
          packet.spawnQuat[1],
          packet.spawnQuat[2],
          packet.spawnQuat[3],
        );
        remoteRig.syncVisualTransform();
        remoteRig.setPotatoShaderMode(sim.graphicsSettings.usePotatoShader);
        remoteRig.setBlobShadowVisible(sim.graphicsSettings.blobShadows);
        sim.creations.push(remoteRig);
        setCreationsCountState(sim.creations.length);
        syncHudNow();
        return remoteRig;
      },
      onRemoteMapSynced: (mapLabel: string) => {
        setActiveMapLabel(mapLabel);
        setWorldGenFeedback(`Lobby map synced: ${mapLabel}!`);
      },
      onStateChange: (uiState) => {
        setMpState({ ...uiState });
      },
      onStatusToast: (msg) => {
        setMpToast(msg);
      },
    });
    sim.multiplayer = multiplayer;
    setMpState(multiplayer.getUIState());

    fx.onCraterCarved = (wx, wy, wz, radiusVoxels) => {
      multiplayer.broadcastVoxelEdit(
        'explosion',
        [wx, wy, wz],
        radiusVoxels,
        MAT.AIR,
      );
      const activeRig = sim.getActiveRig();
      const distToRig = Math.hypot(
        wx - activeRig.position.x,
        wy - activeRig.position.y,
        wz - activeRig.position.z,
      );
      if (distToRig <= radiusVoxels * VOXEL_SIZE + 8.5) {
        const nextTp = recordCombatDamage(teleportStateRef.current, Date.now());
        teleportStateRef.current = nextTp;
        setTeleportState(nextTp);
      }
      // Blast shockwave launches on-foot player into a micro-voxel ragdoll
      if (!sim.isBuildMode && !sim.isWorldEditMode && !sim.isSeatedInRig) {
        const px = sim.playerRagdoll.active
          ? sim.playerRagdoll.pos[0]
          : sim.camFreePos.x;
        const py = sim.playerRagdoll.active
          ? sim.playerRagdoll.pos[1]
          : sim.camFreePos.y - 0.9;
        const pz = sim.playerRagdoll.active
          ? sim.playerRagdoll.pos[2]
          : sim.camFreePos.z;
        const dx = px - wx;
        const dy = py - wy;
        const dz = pz - wz;
        const blastRange = radiusVoxels * VOXEL_SIZE + 5.2;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < blastRange) {
          const falloff = Math.max(0.25, 1.0 - dist / blastRange);
          const horiz = Math.hypot(dx, dz);
          const nx = horiz > 0.05 ? dx / horiz : Math.sin(sim.camYaw);
          const nz = horiz > 0.05 ? dz / horiz : Math.cos(sim.camYaw);
          const launchSpeed = (8.5 + radiusVoxels * 1.15) * falloff;
          sim.triggerPlayerRagdoll(
            nx * launchSpeed,
            Math.max(5.0, (6.5 + radiusVoxels * 0.75) * falloff),
            nz * launchSpeed,
            2.6 * falloff,
          );
        }
      }
    };

    simRef.current = sim;
    (sim as unknown as Record<string, unknown>).terrainEntityManager = terrainEntityManager;
    (sim as unknown as Record<string, unknown>).TerrainEntity = TerrainEntity;
    (window as unknown as Record<string, unknown>).__TERRASMASH_SIM__ = sim;

    // TEMPORARY dat.GUI for live physics tuning (hidden unless ?debug=1)
    const gui = new dat.GUI({ width: 300 });
    if (!window.location.search.includes('debug=1')) {
      gui.hide();
    }
    const physicsFolder = gui.addFolder('Physics');
    physicsFolder.add(PHYSICS_CONFIG, 'maxLinearSpeedMPS', 10, 200).step(1);
    physicsFolder.add(PHYSICS_CONFIG, 'maxAngularSpeedRadPS', 1, 20).step(0.1);
    physicsFolder.add(PHYSICS_CONFIG, 'defaultVoxelMassKg', 0.5, 5).step(0.1);
    physicsFolder.add(PHYSICS_CONFIG, 'linearDamping', 0, 0.5).step(0.01);
    physicsFolder.add(PHYSICS_CONFIG, 'angularDamping', 0, 0.5).step(0.01);
    physicsFolder.add(PHYSICS_CONFIG, 'minVehicleMassKg', 5, 200).step(5);
    physicsFolder.add(PHYSICS_CONFIG, 'minInertia', 1, 100).step(1);
    physicsFolder.add(PHYSICS_CONFIG, 'sleepTimeThresholdSec', 0.1, 3.0).step(0.1);
    physicsFolder.add(PHYSICS_CONFIG, 'smallObjectSleepSpeedMPS', 0.01, 0.5).step(0.01);
    physicsFolder.add(PHYSICS_CONFIG, 'smallObjectSleepTimeThresholdSec', 0.1, 2.0).step(0.1);
    physicsFolder.add(PHYSICS_CONFIG, 'c4IgniteDelayMs', 50, 1000).step(10);
    physicsFolder.add(PHYSICS_CONFIG, 'c4ExplosionRadius', 0.5, 8.0).step(0.25);
    physicsFolder.add(PHYSICS_CONFIG, 'c4DamageInRadius', 10, 300).step(5);
    physicsFolder.add(PHYSICS_CONFIG, 'c4VehicleImpulse', 500, 15000).step(250);
    physicsFolder.add(PHYSICS_CONFIG, 'c4OtherVehicleImpulse', 500, 15000).step(250);
    physicsFolder.add(PHYSICS_CONFIG, 'c4OtherVehicleRadius', 1.0, 15.0).step(0.5);
    physicsFolder.add(PHYSICS_CONFIG.groundCollision, 'springStiffnessPerPoint', 2000, 30000).step(250);
    physicsFolder.add(PHYSICS_CONFIG.groundCollision, 'damperCoefficientPerPoint', 200, 5000).step(50);
    physicsFolder.add(PHYSICS_CONFIG.groundCollision, 'idleRollingFrictionMultiplier', 1.0, 8.0).step(0.25);
    physicsFolder.add(PHYSICS_CONFIG.collisionResponse, 'baumgarteFactor', 0.1, 1.0).step(0.05);
    physicsFolder.add(PHYSICS_CONFIG.collisionResponse, 'maxFramePositionCorrectionMeters', 0.1, 1.5).step(0.05);
    physicsFolder.add(PHYSICS_CONFIG.buoyancy, 'waterDensityKgM3', 200, 2500).step(50);
    physicsFolder.add(PHYSICS_CONFIG.buoyancy, 'waterDragCoefficient', 0.05, 3.0).step(0.05);
    physicsFolder.add(PHYSICS_CONFIG.rotor, 'defaultPowerNewtons', 1000, 25000).step(500);
    physicsFolder.add(PHYSICS_CONFIG.rotor, 'reactionTorqueFactor', 0.0, 1.0).step(0.05);
    physicsFolder.add(PHYSICS_CONFIG.jet, 'defaultPowerNewtons', 2000, 40000).step(500);

    for (const [vehicleId, profile] of Object.entries(VEHICLE_TUNING_PROFILES)) {
      const folder = gui.addFolder(vehicleId);
      folder.add(profile, 'massScale', 0.1, 5).step(0.1);
      folder.add(profile, 'forwardFrictionScale', 0, 2).step(0.01);
      folder.add(profile, 'lateralFrictionScale', 0, 2).step(0.01);
      folder.add(profile, 'groundSpringScale', 0.1, 3).step(0.1);
      folder.add(profile, 'linearDamping', 0, 0.5).step(0.005);
      folder.add(profile, 'angularDamping', 0, 0.5).step(0.01);
      folder.add(profile, 'suspensionStiffnessScale', 0.2, 3.0).step(0.05);
      folder.add(profile, 'suspensionDampingScale', 0.2, 3.0).step(0.05);
      folder.add(profile, 'rollStabilityTorque', 50, 2500).step(25);
    }
    (window as unknown as Record<string, unknown>).__advanceTime = (
      ms: number,
    ) => {
      const steps = Math.max(1, Math.round(ms / 16.666));
      let t = performance.now();
      for (let s = 0; s < steps; s++) {
        t += 16.666;
        sim.updateCamera(0.0166, t);
        sim.multiplayer.updateInterpolation(0.0166, camera.position);
      }
      syncHudNow();
      renderer.render(scene, camera);
    };

    let currentCaveAtmosphere = 0;
    let lastStructuralHudKey = '';

    function syncHudNow() {
      const _tHud0 = performance.now();
      const curRig = sim.getActiveRig();
      const spanW = ((curRig.maxVX - curRig.minVX + 1) * VOXEL_SIZE).toFixed(1);
      const spanH = ((curRig.maxVY - curRig.minVY + 1) * VOXEL_SIZE).toFixed(1);
      const spanL = ((curRig.maxVZ - curRig.minVZ + 1) * VOXEL_SIZE).toFixed(1);

      const enterableSeatCandidate = !sim.isSeatedInRig
        ? sim.findClosestEnterableSeat(sim.camFreePos, 2.5)
        : null;

      const isOnFootHud = sim.isWalking || !sim.isSeatedInRig;
      const footAltMeters = Math.max(0, sim.camFreePos.y - 1.65 - WATER_LEVEL);
      const statusLabel = isOnFootHud
        ? sim.isJetpacking
          ? 'JETPACK THRUST'
          : 'ON FOOT'
        : curRig.statusLabel;
      const altitudeMeters = `${(isOnFootHud ? footAltMeters : curRig.altitudeMeters).toFixed(1)}m`;
      const caveAtmospherePct = Math.round(currentCaveAtmosphere * 100);
      const maxAirtimeSec = sim.maxAirtimeSec.toFixed(1);
      const currentAirtimeSec = sim.currentAirtimeSec.toFixed(1);
      const timeScale = sim.lastGovernorStep ? sim.lastGovernorStep.timeScale : 1.0;
      const isSlowMoActive = sim.lastGovernorStep
        ? sim.lastGovernorStep.isSlowMoActive
        : sim.frameGovernorConfig.manualSlowMoActive;
      const slowMoReason = sim.lastGovernorStep
        ? sim.lastGovernorStep.slowMoReason
        : sim.frameGovernorConfig.manualSlowMoActive
          ? 'MANUAL'
          : 'NONE';
      const watchdogProtecting = Boolean(
        sim.lastGovernorStep?.watchdog.isProtecting,
      );

      // Push high-frequency telemetry directly to isolated external store (zero root App re-render!)
      publishHudTelemetry({
        fps: currentFps,
        frameMs: currentFrameMs,
        rayTarget: currentRayLabel,
        statusLabel,
        speedKmh: curRig.speedKmh,
        engineRpm: curRig.engineRpm,
        altitudeMeters,
        pitchDeg: curRig.pitchDeg,
        rollDeg: curRig.rollDeg,
        caveAtmospherePct,
        voxelsDestroyed: fx.voxelsDestroyedCount,
        structuralIntegrityPct: curRig.structuralIntegrityPct,
        damagedBlockCount: curRig.damagedBlockCount,
        lodSummary: world.lodSummary,
        speedTrapMaxKmh: sim.speedTrapMaxKmh,
        speedTrapLastKmh: sim.speedTrapLastKmh,
        maxAirtimeSec,
        currentAirtimeSec,
        timeScale,
        isSlowMoActive,
        slowMoReason,
        watchdogProtecting,
      });

      // Only trigger a root React `setHud` reconciliation when structural UI state actually changed
      const presetName =
        curRig.customBlueprintName ||
        PRESET_NAMES[curRig.presetIndex] ||
        PRESET_NAMES[0];
      const massKg = Math.round(curRig.totalMass);
      const buoyancyRatio = `${(curRig.totalBuoyancy / curRig.totalMass).toFixed(1)}x`;
      const dimensionsMeters = `${spanW}m × ${spanH}m × ${spanL}m`;
      const nearVehiclePrompt =
        !sim.isBuildMode &&
        !sim.isWorldEditMode &&
        !sim.isSeatedInRig &&
        enterableSeatCandidate !== null;
      const gyroEnabled = curRig.gyroCount > 0 && curRig.gyroEnabled;
      const hasIntactSeat = curRig.hasIntactSeat();
      const hoveredModHit =
        sim.currentHit &&
        sim.currentHit.target === 'vehicle' &&
        'moduleHit' in sim.currentHit &&
        sim.currentHit.moduleHit
          ? sim.currentHit.moduleHit
          : null;
      const hoveredKey = hoveredModHit
        ? `${hoveredModHit.kind}:${hoveredModHit.vx},${hoveredModHit.vy},${hoveredModHit.vz}`
        : '';
      const selObj = sim.selectedBuildObject;
      const selObjKey = selObj
        ? `${selObj.kind}:${selObj.vx},${selObj.vy},${selObj.vz}`
        : '';
      const selObjs = sim.selectedBuildObjects;
      const selObjsKey =
        selObjs.length > 0
          ? `${selObjs.length}:${selObjs[0].vx},${selObjs[0].vy},${selObjs[0].vz}:${selObjs[selObjs.length - 1].vx},${selObjs[selObjs.length - 1].vy},${selObjs[selObjs.length - 1].vz}`
          : '0';

      const structuralKey =
        `${presetName}|${curRig.presetIndex}|${massKg}|${buoyancyRatio}|${curRig.voxelCount}|${curRig.modules.length}|${curRig.powerCores}|${dimensionsMeters}|` +
        `${sim.isBuildMode ? 1 : 0}${sim.isObjectStudioMode ? 1 : 0}${sim.isWorldEditMode ? 1 : 0}${sim.isSeatedInRig ? 1 : 0}${sim.isPointerLocked ? 1 : 0}${curRig.mirrorMode ? 1 : 0}${curRig.symmetryAxisMode}${curRig.xrayMode ? 1 : 0}${sim.eyedropperMode ? 1 : 0}${curRig.showForces ? 1 : 0}|` +
        `${sim.worldEditTool}|${world.worldGenMode}|${sim.selectedObjectId}|${sim.selectedVoxelEntityId}|${sim.voxelEntities.length}|${sim.selectedMapHazardId}|${sim.mapHazards.length}|${sim.terraBrushRadius}|${sim.terraPaintMat}|` +
        `${curRig.partYawIndex},${curRig.partPitchIndex},${curRig.partRollIndex}|${sim.propPhysicsMode}|${sim.placementMode}|${sim.hullScalePx}|${sim.boxDepthPx}|${curRig.lastGhostSummary.dimsLabel}:${curRig.lastGhostSummary.count}|${sim.cameraMode}|${sim.buildCameraAngle}|${sim.selectedSlot}|${nearVehiclePrompt ? 1 : 0}|` +
        `${curRig.detachedIslandsCount}|${curRig.pistonExtended ? 1 : 0}${curRig.winchActive ? 1 : 0}|${curRig.pistonCount},${curRig.winchCount},${curRig.gyroCount},${curRig.thrusterCount},${curRig.cannonCount}|` +
        `${curRig.undoStack.length},${curRig.redoStack.length}|${SoundFX.muted ? 1 : 0}${gyroEnabled ? 1 : 0}${curRig.headlightsOn ? 1 : 0}${hasIntactSeat ? 1 : 0}|${sim.creations.length},${sim.activeCreationIndex}|` +
        `${hoveredKey}|${selObjKey}|${selObjsKey}|${isSlowMoActive ? 1 : 0}:${slowMoReason}:${watchdogProtecting ? 1 : 0}|${sim.isZoomed ? 1 : 0}:${sim.zoomMagnification}:${Math.round(sim.zoomFocusDistMeters / 4)}`;

      if (structuralKey !== lastStructuralHudKey) {
        lastStructuralHudKey = structuralKey;
        const creationsList = sim.creations.map((c, idx) => ({
          name: c.customBlueprintName || PRESET_NAMES[c.presetIndex] || `Creation #${idx + 1}`,
          massKg: Math.round(c.totalMass),
          blocks: c.voxelCount + c.modules.length,
          powerCores: c.powerCores,
          distMeters: Math.round(
            c.position.distanceTo(sim.isSeatedInRig ? curRig.position : sim.camFreePos),
          ),
          isSeated: idx === sim.activeCreationIndex && sim.isSeatedInRig,
        }));

        setHud({
          fps: currentFps,
          frameMs: currentFrameMs,
          rayTarget: currentRayLabel,
          presetName,
          presetIndex: curRig.presetIndex,
          massKg,
          buoyancyRatio,
          voxelCount: curRig.voxelCount,
          moduleCount: curRig.modules.length,
          powerCores: curRig.powerCores,
          dimensionsMeters,
          statusLabel,
          speedKmh: curRig.speedKmh,
          engineRpm: curRig.engineRpm,
          altitudeMeters,
          pitchDeg: curRig.pitchDeg,
          rollDeg: curRig.rollDeg,
          isBuildMode: sim.isBuildMode,
          isObjectStudioMode: sim.isObjectStudioMode,
          isWorldEditMode: sim.isWorldEditMode,
          worldEditTool: sim.worldEditTool,
          worldGenMode: world.worldGenMode,
          selectedObjectId: sim.selectedObjectId,
          selectedVoxelEntityId: sim.selectedVoxelEntityId,
          voxelEntitiesCount: sim.voxelEntities.length,
          selectedMapHazardId: sim.selectedMapHazardId,
          mapHazardsCount: sim.mapHazards.length,
          terraBrushRadius: sim.terraBrushRadius,
          terraPaintMat: sim.terraPaintMat,
          isSeatedInRig: sim.isSeatedInRig,
          isPointerLocked: sim.isPointerLocked,
          mirrorMode: curRig.mirrorMode,
          symmetryAxisMode: curRig.symmetryAxisMode,
          xrayMode: curRig.xrayMode,
          eyedropperMode: sim.eyedropperMode,
          showForces: curRig.showForces,
          partYawIndex: curRig.partYawIndex,
          partPitchIndex: curRig.partPitchIndex,
          partRollIndex: curRig.partRollIndex,
          propPhysicsMode: sim.propPhysicsMode,
          caveAtmospherePct,
          placementMode: sim.placementMode,
          hullScalePx: sim.hullScalePx,
          boxDepthPx: sim.boxDepthPx,
          hullShape: sim.hullShape,
          ghostSummary: { ...curRig.lastGhostSummary },
          cameraMode: sim.cameraMode,
          buildCameraAngle: sim.buildCameraAngle,
          selectedSlot: sim.selectedSlot,
          nearVehiclePrompt,
          voxelsDestroyed: fx.voxelsDestroyedCount,
          detachedIslands: curRig.detachedIslandsCount,
          pistonExtended: curRig.pistonExtended,
          winchActive: curRig.winchActive,
          pistonCount: curRig.pistonCount,
          winchCount: curRig.winchCount,
          gyroCount: curRig.gyroCount,
          thrusterCount: curRig.thrusterCount,
          cannonCount: curRig.cannonCount,
          structuralIntegrityPct: curRig.structuralIntegrityPct,
          damagedBlockCount: curRig.damagedBlockCount,
          lodSummary: world.lodSummary,
          undoCount: curRig.undoStack.length,
          redoCount: curRig.redoStack.length,
          muted: SoundFX.muted,
          gyroEnabled,
          headlightsOn: curRig.headlightsOn,
          hasIntactSeat,
          creationsCount: sim.creations.length,
          activeCreationIdx: sim.activeCreationIndex,
          creationsList,
          hoveredModule: hoveredModHit
            ? {
                kind: hoveredModHit.kind,
                vx: hoveredModHit.vx,
                vy: hoveredModHit.vy,
                vz: hoveredModHit.vz,
                config: hoveredModHit.config,
              }
            : null,
          selectedBuildObject: selObj ? { ...selObj } : null,
          selectedBuildObjects: selObjs.map((o) => ({
            ...o,
            config: o.config ? { ...o.config } : undefined,
          })),
          speedTrapMaxKmh: sim.speedTrapMaxKmh,
          speedTrapLastKmh: sim.speedTrapLastKmh,
          maxAirtimeSec,
          currentAirtimeSec,
          timeScale,
          isSlowMoActive,
          slowMoReason,
          watchdogProtecting,
          isZoomed: sim.isZoomed,
          zoomMagnification: sim.zoomMagnification,
          zoomFocusDistMeters: sim.zoomFocusDistMeters,
        });
      }
      if (
        worldArenaSystems.lastCrashReport &&
        worldArenaSystems.lastCrashReport.timestampMs !==
          dismissedCrashTimestampRef.current &&
        Date.now() - worldArenaSystems.lastCrashReport.timestampMs < 4500
      ) {
        const rep = worldArenaSystems.lastCrashReport;
        setLastCrashTelemetry((prev) =>
          prev?.timestampMs === rep.timestampMs ? prev : rep,
        );
      } else {
        setLastCrashTelemetry((prev) => (prev === null ? null : null));
      }
      perfProfiler.recordHudUpdate(performance.now() - _tHud0);
    }
    (window as unknown as Record<string, unknown>).__VOXEL_SANDBOX__ = sim;
    (window as unknown as Record<string, unknown>).__VOXELIZE_GLB_SCENE__ = (
      gltfScene: THREE.Object3D,
      res = DEFAULT_GLB_RESOLUTION,
    ) => voxelizeGlbSceneWithGpu(gltfScene, res, renderer);
    (window as unknown as Record<string, unknown>).render_game_to_text = () => {
      const curRig = sim.getActiveRig();
      return JSON.stringify({
        mode: sim.isObjectStudioMode
          ? 'OBJECT_STUDIO'
          : sim.isWorldEditMode
            ? 'WORLD_EDITOR'
            : sim.isBuildMode
              ? 'BUILD_MODE'
              : sim.isSeatedInRig
                ? 'DRIVING_RIG'
                : 'ON_FOOT',
        activeVehicleId: sim.activeVehicle ? sim.activeVehicle.vehicleId : null,
        activeCreationIndex: sim.activeCreationIndex,
        creationsCount: sim.creations.length,
        voxelEntitiesCount: sim.voxelEntities.length,
        isWalking: sim.isWalking,
        worldGenMode: world.worldGenMode,
        totalAllocatedChunks: world.totalAllocatedChunks,
        lodSummary: world.lodSummary,
        lodNearChunks: world.lodNearChunks,
        lodMidChunks: world.lodMidChunks,
        lodFarChunks: world.lodFarChunks,
        voxelCount: curRig.voxelCount,
        microVoxelCount: curRig.microHull.size,
        hullScalePx: sim.hullScalePx,
        moduleCount: curRig.modules.length,
        structuralIntegrityPct: curRig.structuralIntegrityPct,
        damagedBlockCount: curRig.damagedBlockCount,
        detachedIslands: curRig.detachedIslandsCount,
        pistonCount: curRig.pistonCount,
        winchCount: curRig.winchCount,
        pistonExtended: curRig.pistonExtended,
        winchActive: curRig.winchActive,
        worldEditTool: sim.worldEditTool,
        selectedObjectId: sim.selectedObjectId,
        customObjectsCount: sim.allPlaceableObjects.length - PREBUILT_OBJECTS.length,
        selectedCount: sim.selectedBuildObjects.length,
        partYawIndex: curRig.partYawIndex,
        partPitchIndex: curRig.partPitchIndex,
        partRollIndex: curRig.partRollIndex,
        caveAtmospherePct: Math.round(currentCaveAtmosphere * 100),
        multiplayerStatus: sim.multiplayer.status,
        multiplayerRoomCode: sim.multiplayer.roomCode,
      });
    };

    const projTmp = new THREE.Vector3();
    function computeMarqueeSelectedObjects(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ): SelectableBuildObject[] {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return [];
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();

      const curRig = sim.getActiveRig();
      const allObjs = curRig.getAllSelectableBuildObjects();
      const candidates: Array<{
        obj: SelectableBuildObject;
        screenX: number;
        screenY: number;
        inFront: boolean;
      }> = [];

      for (let i = 0; i < allObjs.length; i++) {
        const obj = allObjs[i];
        const wp = curRig.localVoxelToWorld(obj.vx, obj.vy, obj.vz);
        projTmp.copy(wp).project(camera);
        const inFront = projTmp.z >= -1 && projTmp.z <= 1;
        const screenX = rect.left + (projTmp.x * 0.5 + 0.5) * rect.width;
        const screenY = rect.top + (-projTmp.y * 0.5 + 0.5) * rect.height;
        candidates.push({ obj, screenX, screenY, inFront });
      }

      return filterObjectsInScreenBox(candidates, x1, y1, x2, y2);
    }

    function updateMarqueeOverlayDOM() {
      const boxEl = marqueeBoxRef.current;
      if (!boxEl) return;
      const mq = sim.marqueeSelect;
      if (!mq || !sim.isBuildMode) {
        boxEl.style.display = 'none';
        return;
      }
      const w = Math.abs(mq.curX - mq.startX);
      const h = Math.abs(mq.curY - mq.startY);
      if (Math.hypot(w, h) < 5) {
        boxEl.style.display = 'none';
        return;
      }
      boxEl.style.display = 'block';
      boxEl.style.left = `${Math.min(mq.startX, mq.curX)}px`;
      boxEl.style.top = `${Math.min(mq.startY, mq.curY)}px`;
      boxEl.style.width = `${w}px`;
      boxEl.style.height = `${h}px`;
      if (marqueeBadgeRef.current) {
        marqueeBadgeRef.current.textContent = `BOX SELECT: ${sim.selectedBuildObjects.length}`;
      }
    }

    const raycasterTmp = new THREE.Raycaster();
    function updateRaycastTarget(): string {
      if (!sim.isBuildMode && !sim.isWorldEditMode && sim.isSeatedInRig) {
        sim.currentHit = null;
        selectionWireframe.visible = false;
        return 'Driving Rig';
      }
      const rayOrigin = _rayOriginTmp;
      const rayDir = _rayDirTmp;
      const curRig = sim.getActiveRig();

      if ((sim.isBuildMode || sim.isWorldEditMode) && sim.hasPointerMoved) {
        // Free mouse cursor raycasting in Build Mode & World Editor Mode!
        raycasterTmp.setFromCamera(sim.pointerNDC, camera);
        rayOrigin.copy(raycasterTmp.ray.origin);
        rayDir.copy(raycasterTmp.ray.direction);
      } else {
        rayOrigin.copy(camera.position);
        camera.getWorldDirection(rayDir);
        // In third-person Walking or World Edit Mode, advance rayOrigin along the camera sightline to the player's eye plane
        // so raycasts never hit obstacles behind the player's back and full tool reach extends in front of the player!
        if (!sim.isSeatedInRig && !sim.isBuildMode && sim.cameraMode !== 'FIRST_PERSON') {
          const dx = sim.camFreePos.x - camera.position.x;
          const dy = sim.camFreePos.y - camera.position.y;
          const dz = sim.camFreePos.z - camera.position.z;
          const forwardAdvance = Math.max(0, dx * rayDir.x + dy * rayDir.y + dz * rayDir.z);
          rayOrigin.addScaledVector(rayDir, forwardAdvance);
        }
      }

      if (sim.isBuildMode) {
        const activeSlots = sim.isObjectStudioMode
          ? OBJECT_STUDIO_SLOTS
          : BUILD_SLOTS;
        const isAreaDrag =
          (sim.placementMode === 'BOX_FILL' ||
            sim.placementMode === 'LINE_DRAG') &&
          sim.dragStartVoxel !== null;
        const slotItem = activeSlots[sim.selectedSlot - 1] || activeSlots[0];
        const useMicroRay =
          sim.hullScalePx !== 4 ||
          sim.hullShape !== 'CUBE' ||
          curRig.microHull.size > 0 ||
          curRig.xrayMode;
        const rawHit = isAreaDrag
          ? curRig.raycastBuildOrDragPlane(
              rayOrigin,
              rayDir,
              sim.dragStartVoxel,
              { x: 0, y: 0, z: 0 },
            )
          : useMicroRay
            ? curRig.raycastVehicleMicro(rayOrigin, rayDir, 65)
            : curRig.raycastVehicle(rayOrigin, rayDir, 65);
        const vHit = rawHit
          ? {
              ...rawHit,
              mx:
                'mx' in rawHit && typeof rawHit.mx === 'number'
                  ? rawHit.mx
                  : rawHit.vx * MICRO_VOXEL_SUBDIV,
              my:
                'my' in rawHit && typeof rawHit.my === 'number'
                  ? rawHit.my
                  : rawHit.vy * MICRO_VOXEL_SUBDIV,
              mz:
                'mz' in rawHit && typeof rawHit.mz === 'number'
                  ? rawHit.mz
                  : rawHit.vz * MICRO_VOXEL_SUBDIV,
              hitIsMicro:
                'hitIsMicro' in rawHit ? Boolean(rawHit.hitIsMicro) : false,
            }
          : null;
        if (sim.selectedBuildObjects.length > 0) {
          const validSelections = sim.selectedBuildObjects.filter((sel) => {
            if (sel.kind === 'module') {
              return Boolean(curRig.getModuleAt(sel.vx, sel.vy, sel.vz));
            }
            return curRig.getVoxel(sel.vx, sel.vy, sel.vz) !== MAT.AIR;
          });
          if (validSelections.length !== sim.selectedBuildObjects.length) {
            sim.selectedBuildObjects = validSelections;
            sim.selectedBuildObject =
              validSelections.length > 0
                ? validSelections[validSelections.length - 1]
                : null;
          }
          syncSelectedObjectsWireframe(validSelections);
        } else {
          selectedObjectWireframe.visible = false;
        }

        if (vHit) {
          sim.currentHit = vHit;
          const isScaledHull =
            !vHit.moduleHit &&
            (vHit.hitIsMicro || sim.hullScalePx !== 4 || sim.hullShape !== 'CUBE');
          if (isScaledHull) {
            const boxSizePx = vHit.hitIsMicro ? Math.min(sim.hullScalePx, 4) : sim.hullScalePx;
            const snapO = computeScaledAnchorOrigin(
              { mx: vHit.mx, my: vHit.my, mz: vHit.mz, normal: vHit.normal },
              boxSizePx,
              true,
            );
            const lc = microBlockCenterMeters(snapO.mx, snapO.my, snapO.mz, boxSizePx);
            const wp = new THREE.Vector3(lc.x, lc.y, lc.z)
              .applyQuaternion(curRig.quaternion)
              .add(curRig.position);
            const edgeM = boxSizePx * MICRO_VOXEL_SIZE + 0.012;
            selectionWireframe.scale.set(edgeM, edgeM, edgeM);
            selectionWireframe.position.copy(wp);
          } else {
            const wp = curRig.localVoxelToWorld(vHit.vx, vHit.vy, vHit.vz);
            selectionWireframe.scale.set(
              VOXEL_SIZE + 0.02,
              VOXEL_SIZE + 0.02,
              VOXEL_SIZE + 0.02,
            );
            selectionWireframe.position.copy(wp);
          }
          selectionWireframe.quaternion.copy(curRig.quaternion);
          selectionWireframe.visible = true;
          curRig.updateBuildGhost(
            vHit,
            slotItem,
            sim.placementMode,
            sim.dragStartVoxel,
            sim.hullScalePx,
            sim.dragStartMicro,
            'CUBE',
            sim.boxDepthPx,
          );
          if (sim.eyedropperMode) {
            if (vHit.moduleHit) {
              return `Eyedropper: Sample Module ${vHit.moduleHit.kind}`;
            }
            return `Eyedropper: Sample ${MAT_INFO[vHit.mat]?.name || 'Block'} (${vHit.hitIsMicro ? '1px' : '4px'})`;
          }
          if (sim.dragStartVoxel && sim.placementMode === 'BOX_FILL') {
            if (sim.dragStartMicro) {
              const s = sim.hullScalePx;
              const anchor = computeScaledAnchorOrigin(
                { mx: vHit.mx, my: vHit.my, mz: vHit.mz, normal: vHit.normal },
                s,
                false,
              );
              const sx = Math.abs(Math.round((anchor.mx - sim.dragStartMicro.mx) / s)) + 1;
              const sy = Math.abs(Math.round((anchor.my - sim.dragStartMicro.my) / s)) + 1;
              const sz = Math.abs(Math.round((anchor.mz - sim.dragStartMicro.mz) / s)) + 1;
              return `Box Fill (${s}px · Depth ${sim.boxDepthPx}px): ${sx}×${sy}×${sz}`;
            }
            const tx = vHit.vx + vHit.normal.x;
            const ty = vHit.vy + vHit.normal.y;
            const tz = vHit.vz + vHit.normal.z;
            const sx = Math.abs(tx - sim.dragStartVoxel.vx) + 1;
            const sy = Math.abs(ty - sim.dragStartVoxel.vy) + 1;
            const sz = Math.abs(tz - sim.dragStartVoxel.vz) + 1;
            return `Box Fill: ${sx}×${sy}×${sz} (${sx * sy * sz} blocks)`;
          }
          if (vHit.moduleHit) {
            return `Module: ${vHit.moduleHit.kind} (R-Click Select · Alt-Click Pick)`;
          }
          if (sim.placementMode === 'CHISEL') {
            return `Chisel (${sim.hullScalePx === 1 ? '1px Fine' : '4px Block'}) · L-Click Carve · R-Click Select`;
          }
          const stampModeLabel = sim.hullScalePx === 1 ? '1px Fine' : '4px Block (4×4×4)';
          return `Hull ${stampModeLabel} · L-Click Place · R-Click Carve`;
        } else {
          sim.currentHit = null;
          selectionWireframe.visible = false;
          curRig.updateBuildGhost(
            null,
            slotItem,
            sim.placementMode,
            null,
            sim.hullScalePx,
            null,
            'CUBE',
            sim.boxDepthPx,
          );
          return sim.isObjectStudioMode
            ? 'Aim at Pedestal to Sculpt Object'
            : 'Hover Vehicle · L-Click Place · R-Click Select';
        }
      } else if (sim.isWorldEditMode) {
        selectedObjectWireframe.visible = false;
        const wHit = world.raycastWorldVoxels(rayOrigin, rayDir, 125);
        if (wHit) {
          sim.currentHit = wHit;
          selectionWireframe.quaternion.identity();
          selectionWireframe.visible = true;
          if (sim.worldEditTool === 'PLACE_OBJECT' || sim.worldEditTool === 'PLACE_PROP') {
            const prefab =
              sim.allPlaceableObjects.find(
                (o) => o.id === sim.selectedObjectId,
              ) || PREBUILT_OBJECTS[0];
            const rot = curRig.partYawIndex & 3;
            const sx =
              (rot === 1 || rot === 3 ? prefab.sizeZ : prefab.sizeX) *
              VOXEL_SIZE;
            const sy = prefab.sizeY * VOXEL_SIZE;
            const sz =
              (rot === 1 || rot === 3 ? prefab.sizeX : prefab.sizeZ) *
              VOXEL_SIZE;
            selectionWireframe.scale.set(
              Math.max(0.5, sx),
              Math.max(0.5, sy),
              Math.max(0.5, sz),
            );
            selectionWireframe.position.set(
              wHit.worldPos.x,
              wHit.worldPos.y + sy * 0.5,
              wHit.worldPos.z,
            );
            const modeTag = sim.propPhysicsMode === 'DYNAMIC' ? 'Dynamic Prop' : 'Static Stamp';
            return `Place ${modeTag} "${prefab.name}" (${DIR_NAMES[rot]})`;
          } else if (sim.worldEditTool === 'SPAWN_VOXEL_ENTITY') {
            const spec = getVoxelEntityPresetSpec(sim.selectedVoxelEntityId);
            const rot = curRig.partYawIndex & 3;
            const sx =
              (rot === 1 || rot === 3 ? spec.sizeVoxels.z : spec.sizeVoxels.x) *
              VOXEL_SIZE;
            const sy = spec.sizeVoxels.y * VOXEL_SIZE;
            const sz =
              (rot === 1 || rot === 3 ? spec.sizeVoxels.x : spec.sizeVoxels.z) *
              VOXEL_SIZE;
            selectionWireframe.scale.set(
              Math.max(0.5, sx),
              Math.max(0.5, sy),
              Math.max(0.5, sz),
            );
            selectionWireframe.position.set(
              wHit.worldPos.x,
              wHit.worldPos.y + sy * 0.5,
              wHit.worldPos.z,
            );
            return `Spawn Voxel Entity "${spec.name}" (${DIR_NAMES[rot]})`;
          } else if (sim.worldEditTool === 'SPAWN_MAP_HAZARD') {
            const hazSpec =
              MAP_HAZARD_PRESETS.find((h) => h.id === sim.selectedMapHazardId) ||
              MAP_HAZARD_PRESETS[0];
            const rot = curRig.partYawIndex & 3;
            selectionWireframe.scale.set(3.2, 3.2, 3.2);
            selectionWireframe.position.set(
              wHit.worldPos.x,
              wHit.worldPos.y + 1.6,
              wHit.worldPos.z,
            );
            return `Place Spinning Hazard "${hazSpec.name}" (${DIR_NAMES[rot]})`;
          } else {
            const diam = sim.terraBrushRadius * 2 * VOXEL_SIZE;
            selectionWireframe.scale.set(diam, Math.max(1.0, diam * 0.6), diam);
            selectionWireframe.position.copy(wHit.worldPos);
            if (sim.worldEditTool === 'TERRA_RAMP' && sim.rampStartWorld) {
              return `Click Point B to Build Ramp`;
            }
            return `Terraform ${sim.worldEditTool} (R:${sim.terraBrushRadius})`;
          }
        } else {
          sim.currentHit = null;
          selectionWireframe.visible = false;
          return 'Aim at Terrain to Edit World';
        }
      } else if (!sim.isSeatedInRig) {
        // Walking Mode: Raycast ALL vehicles, voxel entities, and the world so players can inspect, smash, repair, or enter any creation!
        let vHit: ReturnType<ModularVehicleRig['raycastVehicle']> = null;
        let targetedRig = curRig;
        for (let i = 0; i < sim.creations.length; i++) {
          const c = sim.creations[i];
          const dx = c.position.x - rayOrigin.x;
          const dy = c.position.y - rayOrigin.y;
          const dz = c.position.z - rayOrigin.z;
          if (dx * dx + dy * dy + dz * dz > 32 * 32) continue;
          const hit = c.raycastVehicle(rayOrigin, rayDir, 22);
          if (hit && (!vHit || hit.distance < vHit.distance)) {
            vHit = hit;
            targetedRig = c;
          }
        }
        for (let i = 0; i < sim.voxelEntities.length; i++) {
          const ent = sim.voxelEntities[i];
          if (ent.voxelCount <= 0) continue;
          const dx = ent.position.x - rayOrigin.x;
          const dy = ent.position.y - rayOrigin.y;
          const dz = ent.position.z - rayOrigin.z;
          if (dx * dx + dy * dy + dz * dz > 28 * 28) continue;
          const hit = ent.raycastVehicle(rayOrigin, rayDir, 22);
          if (hit && (!vHit || hit.distance < vHit.distance)) {
            vHit = hit;
            targetedRig = ent;
          }
        }
        const hHit = raycastAllMapHazards(sim.mapHazards, rayOrigin, rayDir, 22);
        const wHit = world.raycastWorldVoxels(rayOrigin, rayDir, 22);
        const vDist = vHit?.distance ?? Infinity;
        const hDist = hHit?.distance ?? Infinity;
        const wDist = wHit?.distance ?? Infinity;

        if (vHit && vDist <= wDist && vDist <= hDist) {
          sim.currentHit = vHit;
          const wp = vHit.worldPos || targetedRig.localVoxelToWorld(vHit.vx, vHit.vy, vHit.vz);
          selectionWireframe.scale.set(
            VOXEL_SIZE + 0.03,
            VOXEL_SIZE + 0.03,
            VOXEL_SIZE + 0.03,
          );
          selectionWireframe.position.copy(wp);
          selectionWireframe.quaternion.copy(targetedRig.quaternion);
          selectionWireframe.visible = true;
          if (targetedRig.isVoxelEntity) {
            return `Voxel Entity: ${targetedRig.entityName || 'Prop'} (${MAT_INFO[vHit.mat]?.name || 'Block'})`;
          }
          const isSeat = vHit.moduleHit?.kind.startsWith('SEAT_') || vHit.moduleHit?.kind === 'COCKPIT';
          return vHit.moduleHit
            ? `${isSeat ? '[E] Enter ' : ''}Rig Module: ${vHit.moduleHit.kind}`
            : `Rig Hull (${MAT_INFO[vHit.mat]?.name || 'Block'})`;
        } else if (hHit && hDist <= wDist) {
          const hvCoord = world.worldToVoxelCoords(
            hHit.worldPos.x,
            hHit.worldPos.y,
            hHit.worldPos.z,
          );
          sim.currentHit = {
            target: 'world',
            vx: hvCoord.vx,
            vy: hvCoord.vy,
            vz: hvCoord.vz,
            mat: hHit.mat,
            normal: { x: 0, y: 1, z: 0 },
            worldPos: hHit.worldPos,
            distance: hHit.distance,
          };
          selectionWireframe.scale.set(
            VOXEL_SIZE + 0.03,
            VOXEL_SIZE + 0.03,
            VOXEL_SIZE + 0.03,
          );
          selectionWireframe.position.copy(hHit.worldPos);
          selectionWireframe.quaternion.identity();
          selectionWireframe.visible = true;
          return `Voxel Hazard: ${hHit.hazard.spec.name} · ${hHit.partLabel} (${MAT_INFO[hHit.mat]?.name || 'Block'})`;
        } else if (wHit) {
          sim.currentHit = wHit;
          selectionWireframe.scale.set(
            VOXEL_SIZE * 2,
            VOXEL_SIZE * 2,
            VOXEL_SIZE * 2,
          );
          selectionWireframe.position.copy(wHit.worldPos);
          selectionWireframe.quaternion.identity();
          selectionWireframe.visible = true;
          return MAT_INFO[wHit.mat]?.name || 'World Voxel';
        } else {
          sim.currentHit = null;
          selectionWireframe.visible = false;
          return 'Aim at Rig or World';
        }
      } else {
        sim.currentHit = null;
        selectionWireframe.visible = false;
        return 'Driving Rig';
      }
    }

    function resolvePaintSlotMaterial(slot: number): number {
      const activeSlots = sim.isObjectStudioMode
        ? OBJECT_STUDIO_SLOTS
        : BUILD_SLOTS;
      const item = activeSlots[slot - 1];
      if (item && item.mat) return item.mat;
      const colorMap: Record<number, number> = {
        4: MAT.FLOAT_YELLOW,
        5: MAT.RAMP_ORANGE,
        6: MAT.GRASS,
        7: MAT.C4_EXPLOSIVE,
        8: MAT.ALLOY_BLUE,
        9: MAT.ALLOY_BLUE,
        10: MAT.ARMOR_SLATE,
        11: MAT.GRASS,
        12: MAT.C4_EXPLOSIVE,
      };
      return colorMap[slot] || MAT.ALLOY_BLUE;
    }

    function extractHitSelectableObject(
      hit: NonNullable<typeof sim.currentHit>,
    ): SelectableBuildObject {
      const modHit = hit.moduleHit;
      if (modHit) {
        return {
          kind: 'module',
          vx: modHit.vx,
          vy: modHit.vy,
          vz: modHit.vz,
          moduleKind: modHit.kind,
          yawIdx: modHit.yawIdx,
          pitchIdx: modHit.pitchIdx || 0,
          rollIdx: modHit.rollIdx || 0,
          config: modHit.config ? { ...modHit.config } : undefined,
        };
      }
      return {
        kind: 'voxel',
        vx: hit.vx,
        vy: hit.vy,
        vz: hit.vz,
        mat: hit.mat,
      };
    }

    function applyBuildAction(
      isLeftClick: boolean,
      recordUndo = true,
      shiftKey = false,
    ) {
      updateRaycastTarget();
      if (!sim.currentHit || sim.currentHit.target !== 'vehicle') {
        if (!isLeftClick && !shiftKey && sim.selectedBuildObjects.length > 0) {
          sim.selectBuildObjectAt(null);
        }
        return;
      }
      if (isLeftClick && sim.eyedropperMode) {
        sim.sampleHoveredObjectToBrush();
        return;
      }
      const curRig = sim.getActiveRig();
      const activeSlots = sim.isObjectStudioMode
        ? OBJECT_STUDIO_SLOTS
        : BUILD_SLOTS;
      const item = activeSlots[sim.selectedSlot - 1];
      if (!item) return;

      // Dedicated CHISEL / CARVE mode on Left-Click OR Right-Click when sculpting with scaled/1px hull blocks
      if (
        (isLeftClick && sim.placementMode === 'CHISEL') ||
        (!isLeftClick &&
          !shiftKey &&
          !sim.currentHit.moduleHit &&
          (sim.hullScalePx !== 4 || sim.currentHit.hitIsMicro))
      ) {
        const hitMicro = {
          mx:
            typeof sim.currentHit.mx === 'number'
              ? sim.currentHit.mx
              : sim.currentHit.vx * MICRO_VOXEL_SUBDIV,
          my:
            typeof sim.currentHit.my === 'number'
              ? sim.currentHit.my
              : sim.currentHit.vy * MICRO_VOXEL_SUBDIV,
          mz:
            typeof sim.currentHit.mz === 'number'
              ? sim.currentHit.mz
              : sim.currentHit.vz * MICRO_VOXEL_SUBDIV,
          normal: sim.currentHit.normal,
        };
        const eraseCoords = computeScaledHullPlacementCoords(
          sim.placementMode === 'PLATE_3X3' ||
            sim.placementMode === 'PLATE_5X5' ||
            sim.placementMode === 'BOX_FILL' ||
            sim.placementMode === 'LINE_DRAG'
            ? sim.placementMode
            : 'CHISEL',
          hitMicro,
          sim.dragStartMicro,
          sim.hullScalePx,
          curRig.symmetryAxisMode,
          true,
          curRig.partYawIndex,
          curRig.partPitchIndex,
          curRig.partRollIndex,
          sim.boxDepthPx,
        );
        if (recordUndo) {
          curRig.pushUndoSnapshot();
        }
        let erasedTotal = 0;
        for (const pt of eraseCoords) {
          erasedTotal += curRig.eraseScaledHullBlock(pt.mx, pt.my, pt.mz, pt.sizePx);
        }
        if (erasedTotal > 0) {
          if (curRig.voxelMap.size === 0 && curRig.microHull.size === 0 && curRig.modules.length === 0) {
            curRig.setVoxel(12, 6, 18, MAT.ALLOY_BLUE);
          }
          const oldInfo = MAT_INFO[sim.currentHit.mat & 63];
          const wp =
            sim.currentHit.worldPos ||
            curRig.localVoxelToWorld(sim.currentHit.vx, sim.currentHit.vy, sim.currentHit.vz);
          fx.spawnEditPopOut(wp.x, wp.y, wp.z, oldInfo?.color ?? 0x94a3b8);
          SoundFX.remove();
          curRig.rebuildVehicleGeometry();
          if (!sim.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          syncHudNow();
        }
        return;
      }

      if (!isLeftClick) {
        const hitObj = extractHitSelectableObject(sim.currentHit);

        if (shiftKey) {
          sim.selectBuildObjectAt(hitObj, true);
          updateRaycastTarget();
          syncHudNow();
          return;
        }

        const isAlreadyInSelection = sim.selectedBuildObjects.some((o) =>
          isSameBuildObjectCoord(o, hitObj),
        );

        if (!isAlreadyInSelection) {
          sim.selectBuildObjectAt(hitObj, false);
          if (hitObj.kind === 'module' && hitObj.moduleKind === 'MICROBIT_ECU') {
            setShowEcuModal(true);
          }
          updateRaycastTarget();
          syncHudNow();
          return;
        }

        if (hitObj.kind === 'module' && hitObj.moduleKind === 'MICROBIT_ECU') {
          setShowEcuModal(true);
          return;
        }

        // Second Right-Click on an already-selected object -> Delete selected object(s)!
        sim.deleteSelectedObject();
      } else if (activeStampPrefabRef.current) {
        const nx = sim.currentHit.vx + sim.currentHit.normal.x;
        const ny = sim.currentHit.vy + sim.currentHit.normal.y;
        const nz = sim.currentHit.vz + sim.currentHit.normal.z;
        curRig.stampSubAssemblyPrefab(activeStampPrefabRef.current, nx, ny, nz);
        const wp = curRig.localVoxelToWorld(nx, ny, nz);
        SoundFX.snap();
        fx.spawnWeldSparks(wp.x, wp.y, wp.z);
        if (!sim.isObjectStudioMode) {
          saveLastBuildAutoSave(
            curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
          );
        }
        updateRaycastTarget();
        syncHudNow();
      } else if (sim.placementMode === 'FLOOD_PAINT') {
        const paintMat =
          item.type === 'voxel' && item.mat
            ? item.mat
            : resolvePaintSlotMaterial(sim.selectedSlot);
        const coords = computeFloodFillPaintCoords(
          sim.currentHit.vx,
          sim.currentHit.vy,
          sim.currentHit.vz,
          (vx: number, vy: number, vz: number) => curRig.getVoxel(vx, vy, vz),
          curRig.mirrorMode,
        );
        const validTargets = coords.filter(
          (pt) =>
            curRig.getVoxel(pt.vx, pt.vy, pt.vz) !== MAT.AIR &&
            curRig.getVoxel(pt.vx, pt.vy, pt.vz) !== paintMat,
        );
        if (validTargets.length === 0) return;
        if (recordUndo) {
          curRig.pushUndoSnapshot();
        }
        for (const pt of validTargets) {
          curRig.setVoxel(pt.vx, pt.vy, pt.vz, paintMat);
        }
        const wp = curRig.localVoxelToWorld(
          sim.currentHit.vx,
          sim.currentHit.vy,
          sim.currentHit.vz,
        );
        SoundFX.snap();
        fx.spawnWeldSparks(wp.x, wp.y, wp.z);
        curRig.rebuildVehicleGeometry();
        if (!sim.isObjectStudioMode) {
          saveLastBuildAutoSave(
            curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
          );
        }
        updateRaycastTarget();
        syncHudNow();
      } else if (sim.placementMode === 'FACE_EXTRUDE') {
        const hitMicro = {
          mx:
            typeof sim.currentHit.mx === 'number'
              ? sim.currentHit.mx
              : sim.currentHit.vx * MICRO_VOXEL_SUBDIV,
          my:
            typeof sim.currentHit.my === 'number'
              ? sim.currentHit.my
              : sim.currentHit.vy * MICRO_VOXEL_SUBDIV,
          mz:
            typeof sim.currentHit.mz === 'number'
              ? sim.currentHit.mz
              : sim.currentHit.vz * MICRO_VOXEL_SUBDIV,
          normal: sim.currentHit.normal,
        };
        const extrudeMat =
          (item.type === 'voxel' && item.mat) ||
          curRig.getMicroOrCoarseMat(hitMicro.mx, hitMicro.my, hitMicro.mz) ||
          MAT.ALLOY_BLUE;
        const depthLayers =
          sim.hullScalePx === 4 ? sim.boxDepthPx * MICRO_VOXEL_SUBDIV : sim.boxDepthPx;
        const microCoords = computeMicroFaceExtrudeCoords(
          hitMicro,
          (mx, my, mz) => curRig.getMicroOrCoarseMat(mx, my, mz),
          curRig.symmetryAxisMode,
          depthLayers,
          256,
        );
        if (microCoords.length === 0) return;
        if (recordUndo) {
          curRig.pushUndoSnapshot();
        }
        for (const pt of microCoords) {
          curRig.placeScaledHullBlock(pt.mx, pt.my, pt.mz, pt.sizePx, extrudeMat);
        }
        const wp =
          sim.currentHit.worldPos ||
          curRig.localVoxelToWorld(
            sim.currentHit.vx + sim.currentHit.normal.x,
            sim.currentHit.vy + sim.currentHit.normal.y,
            sim.currentHit.vz + sim.currentHit.normal.z,
          );
        SoundFX.snap();
        fx.spawnWeldSparks(wp.x, wp.y, wp.z);
        curRig.rebuildVehicleGeometry();
        if (!sim.isObjectStudioMode) {
          saveLastBuildAutoSave(
            curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
          );
        }
        updateRaycastTarget();
        syncHudNow();
      } else if (sim.placementMode === 'PAINT_TOOL') {
        // Paint Tool: Change the material/color of existing blocks without deleting them (scale-aware)!
        const paintMat = resolvePaintSlotMaterial(sim.selectedSlot);
        if (sim.hullScalePx !== 4 || sim.currentHit.hitIsMicro || curRig.symmetryAxisMode === 'Z' || curRig.symmetryAxisMode === 'XZ') {
          const hitMicro = {
            mx:
              typeof sim.currentHit.mx === 'number'
                ? sim.currentHit.mx
                : sim.currentHit.vx * MICRO_VOXEL_SUBDIV,
            my:
              typeof sim.currentHit.my === 'number'
                ? sim.currentHit.my
                : sim.currentHit.vy * MICRO_VOXEL_SUBDIV,
            mz:
              typeof sim.currentHit.mz === 'number'
                ? sim.currentHit.mz
                : sim.currentHit.vz * MICRO_VOXEL_SUBDIV,
            normal: sim.currentHit.normal,
          };
          const scaledTargets = computeScaledHullPlacementCoords(
            'PAINT_TOOL',
            hitMicro,
            null,
            sim.hullScalePx,
            curRig.symmetryAxisMode,
            false,
            curRig.partYawIndex,
            curRig.partPitchIndex,
            curRig.partRollIndex,
          );
          if (recordUndo) {
            curRig.pushUndoSnapshot();
          }
          let painted = 0;
          for (const pt of scaledTargets) {
            painted += curRig.paintScaledHullBlock(pt.mx, pt.my, pt.mz, pt.sizePx, paintMat);
          }
          if (painted === 0) return;
          const wp =
            sim.currentHit.worldPos ||
            curRig.localVoxelToWorld(sim.currentHit.vx, sim.currentHit.vy, sim.currentHit.vz);
          SoundFX.snap();
          fx.spawnWeldSparks(wp.x, wp.y, wp.z);
          curRig.rebuildVehicleGeometry();
          if (!sim.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          syncHudNow();
          return;
        }
        const coords = computePlacementVoxelCoords(
          'PAINT_TOOL',
          sim.currentHit,
          null,
          curRig.mirrorMode,
          false,
          curRig.partYawIndex,
          curRig.partPitchIndex,
          curRig.partRollIndex,
        );
        const validTargets = coords.filter(
          (pt) =>
            curRig.getVoxel(pt.vx, pt.vy, pt.vz) !== MAT.AIR &&
            curRig.getVoxel(pt.vx, pt.vy, pt.vz) !== paintMat,
        );
        if (validTargets.length === 0) return;

        if (recordUndo) {
          curRig.pushUndoSnapshot();
        }
        for (const pt of validTargets) {
          curRig.setVoxel(pt.vx, pt.vy, pt.vz, paintMat);
        }
        const wp = curRig.localVoxelToWorld(
          sim.currentHit.vx,
          sim.currentHit.vy,
          sim.currentHit.vz,
        );
        SoundFX.snap();
        fx.spawnWeldSparks(wp.x, wp.y, wp.z);
        curRig.rebuildVehicleGeometry();
        if (!sim.isObjectStudioMode) {
          saveLastBuildAutoSave(
            curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
          );
        }
        updateRaycastTarget();
        syncHudNow();
      } else {
        if (recordUndo) {
          curRig.pushUndoSnapshot();
        }
        const nx = sim.currentHit.vx + sim.currentHit.normal.x;
        const ny = sim.currentHit.vy + sim.currentHit.normal.y;
        const nz = sim.currentHit.vz + sim.currentHit.normal.z;
        const weldWorldPos =
          sim.currentHit.worldPos || curRig.localVoxelToWorld(nx, ny, nz);

        if (item.type === 'voxel' && item.mat) {
          if (
            sim.hullScalePx !== 4 ||
            sim.boxDepthPx > 1 ||
            sim.currentHit.hitIsMicro ||
            curRig.symmetryAxisMode === 'Z' ||
            curRig.symmetryAxisMode === 'XZ'
          ) {
            const hitMicro = {
              mx:
                typeof sim.currentHit.mx === 'number'
                  ? sim.currentHit.mx
                  : sim.currentHit.vx * MICRO_VOXEL_SUBDIV,
              my:
                typeof sim.currentHit.my === 'number'
                  ? sim.currentHit.my
                  : sim.currentHit.vy * MICRO_VOXEL_SUBDIV,
              mz:
                typeof sim.currentHit.mz === 'number'
                  ? sim.currentHit.mz
                  : sim.currentHit.vz * MICRO_VOXEL_SUBDIV,
              normal: sim.currentHit.normal,
            };
            const scaledCoords = computeScaledHullPlacementCoords(
              sim.placementMode,
              hitMicro,
              sim.dragStartMicro,
              sim.hullScalePx,
              curRig.symmetryAxisMode,
              false,
              curRig.partYawIndex,
              curRig.partPitchIndex,
              curRig.partRollIndex,
              sim.boxDepthPx,
            );
            for (const pt of scaledCoords) {
              curRig.placeScaledHullBlock(
                pt.mx,
                pt.my,
                pt.mz,
                pt.sizePx,
                item.mat,
              );
            }
          } else {
            const coords = computePlacementVoxelCoords(
              sim.placementMode,
              sim.currentHit,
              sim.dragStartVoxel,
              curRig.mirrorMode,
              false,
              curRig.partYawIndex,
              curRig.partPitchIndex,
              curRig.partRollIndex,
            );
            const spawnNowSec = performance.now() * 0.001;
            for (const pt of coords) {
              curRig.setVoxel(pt.vx, pt.vy, pt.vz, item.mat);
              curRig.markVoxelSpawnTime(pt.vx, pt.vy, pt.vz, spawnNowSec);
            }
          }
          SoundFX.snap();
          fx.spawnWeldSparks(weldWorldPos.x, weldWorldPos.y, weldWorldPos.z);
          curRig.rebuildVehicleGeometry();
          if (!sim.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          syncHudNow();
        } else if (item.type === 'module' && item.kind) {
          curRig.addModule(
            item.kind,
            nx,
            ny,
            nz,
            curRig.partYawIndex,
            undefined,
            curRig.partPitchIndex,
            curRig.partRollIndex,
          );
          const isCenterSeat =
            item.kind === 'COCKPIT' ||
            item.kind === 'SEAT_KART' ||
            item.kind === 'SEAT_MOTO' ||
            item.kind === 'SEAT_OPERATOR' ||
            item.kind === 'SEAT_ARMORED' ||
            item.kind === 'SEAT_DIVING' ||
            item.kind === 'SEAT_SPACE' ||
            item.kind === 'SEAT_SHIP_WHEEL';
          const symAxis = curRig.symmetryAxisMode;
          const mirrorX = symAxis === 'X' || symAxis === 'XZ';
          const mirrorZ = symAxis === 'Z' || symAxis === 'XZ';
          if (mirrorX && !isCenterSeat) {
            const mx = SYMMETRY_CENTER_X * 2 - 1 - nx;
            if (mx !== nx) {
              const mirrorYaw = (4 - (curRig.partYawIndex & 3)) & 3;
              const mirrorRoll = (4 - (curRig.partRollIndex & 3)) & 3;
              curRig.addModule(
                item.kind,
                mx,
                ny,
                nz,
                mirrorYaw,
                undefined,
                curRig.partPitchIndex,
                mirrorRoll,
              );
              if (mirrorZ) {
                const mz = SYMMETRY_CENTER_Z * 2 - 1 - nz;
                if (mz !== nz) {
                  curRig.addModule(
                    item.kind,
                    mx,
                    ny,
                    mz,
                    mirrorYaw,
                    undefined,
                    curRig.partPitchIndex,
                    mirrorRoll,
                  );
                }
              }
            }
          }
          if (mirrorZ && !isCenterSeat) {
            const mz = SYMMETRY_CENTER_Z * 2 - 1 - nz;
            if (mz !== nz) {
              curRig.addModule(
                item.kind,
                nx,
                ny,
                mz,
                curRig.partYawIndex,
                undefined,
                curRig.partPitchIndex,
                curRig.partRollIndex,
              );
            }
          }
          SoundFX.snap();
          fx.spawnWeldSparks(weldWorldPos.x, weldWorldPos.y, weldWorldPos.z);
          curRig.rebuildVehicleGeometry();
          if (!sim.isObjectStudioMode) {
            saveLastBuildAutoSave(
              curRig.exportBlueprint(curRig.customBlueprintName || 'Auto-Saved Rig'),
            );
          }
          updateRaycastTarget();
          syncHudNow();
        }
      }
    }

    function executePlayAction(isLeftClick: boolean) {
      const curRig = sim.getActiveRig();
      if (sim.isWorldEditMode) {
        updateRaycastTarget();
        if (!sim.currentHit || !sim.currentHit.worldPos) return;
        const wp = sim.currentHit.worldPos;

        if (sim.worldEditTool === 'PLACE_OBJECT' || sim.worldEditTool === 'PLACE_PROP') {
          if (isLeftClick) {
            const prefab =
              sim.allPlaceableObjects.find(
                (o) => o.id === sim.selectedObjectId,
              ) || PREBUILT_OBJECTS[0];
            if (prefab) {
              if (sim.propPhysicsMode === 'DYNAMIC') {
                const yawRad = (curRig.partYawIndex & 3) * (Math.PI * 0.5);
                const propRig = createCustomPropRig(
                  scene,
                  world,
                  fx,
                  prefab,
                  wp.x,
                  wp.z,
                  yawRad,
                  0.15,
                  true,
                );
                sim.voxelEntities.push(propRig);
                SoundFX.snap();
                fx.spawnWeldSparks(wp.x, wp.y + 0.5, wp.z);
              } else {
                world.stampObjectPrefab(
                  prefab,
                  sim.currentHit.vx,
                  sim.currentHit.vy + 1,
                  sim.currentHit.vz,
                  curRig.partYawIndex,
                  curRig.partPitchIndex,
                  curRig.partRollIndex,
                );
                sim.multiplayer?.broadcastVoxelEdit(
                  'prefab',
                  [wp.x, wp.y, wp.z],
                  0,
                  MAT.AIR,
                  undefined,
                  {
                    prefabData: {
                      prefab,
                      vx: sim.currentHit.vx,
                      vy: sim.currentHit.vy + 1,
                      vz: sim.currentHit.vz,
                      yawIdx: curRig.partYawIndex,
                      pitchIdx: curRig.partPitchIndex,
                      rollIdx: curRig.partRollIndex,
                    },
                  },
                );
                SoundFX.snap();
                fx.spawnWeldSparks(wp.x, wp.y + 0.5, wp.z);
              }
              updateRaycastTarget();
              syncHudNow();
            }
          } else {
            // Right-click in Place Object / Prop:
            // If near a voxel entity (within 3.5m), delete it; otherwise rotate yaw
            let bestEntIdx = -1;
            let bestEntDist = 3.5;
            for (let i = 0; i < sim.voxelEntities.length; i++) {
              const d = sim.voxelEntities[i].position.distanceTo(wp);
              if (d < bestEntDist) {
                bestEntDist = d;
                bestEntIdx = i;
              }
            }
            if (bestEntIdx >= 0) {
              const removed = sim.voxelEntities.splice(bestEntIdx, 1)[0];
              removed.dispose();
              SoundFX.remove();
              syncHudNow();
            } else {
              sim.rotatePartYaw();
            }
          }
          return;
        }

        if (sim.worldEditTool === 'SPAWN_VOXEL_ENTITY') {
          if (isLeftClick) {
            const yawRad = (curRig.partYawIndex & 3) * (Math.PI * 0.5);
            sim.spawnVoxelEntityAt(
              sim.selectedVoxelEntityId,
              wp.x,
              wp.z,
              yawRad,
              0.08,
            );
            updateRaycastTarget();
            syncHudNow();
          } else {
            // Right-click removes the closest voxel entity within 2.5m of the cursor, or rotates yaw
            let bestEntIdx = -1;
            let bestEntDist = 2.5;
            for (let i = 0; i < sim.voxelEntities.length; i++) {
              const d = sim.voxelEntities[i].position.distanceTo(wp);
              if (d < bestEntDist) {
                bestEntDist = d;
                bestEntIdx = i;
              }
            }
            if (bestEntIdx >= 0) {
              const removed = sim.voxelEntities.splice(bestEntIdx, 1)[0];
              removed.dispose();
              SoundFX.remove();
              syncHudNow();
            } else {
              sim.rotatePartYaw();
            }
          }
          return;
        }

        if (sim.worldEditTool === 'SPAWN_MAP_HAZARD') {
          if (isLeftClick) {
            const yawRad = (curRig.partYawIndex & 3) * (Math.PI * 0.5);
            sim.spawnMapHazardAt(
              sim.selectedMapHazardId,
              wp.x,
              wp.z,
              yawRad,
              wp.y,
            );
            updateRaycastTarget();
            syncHudNow();
          } else {
            // Right-click removes the closest spinning map hazard within 4.5m of the cursor, or rotates yaw
            let bestHazIdx = -1;
            let bestHazDist = 4.5;
            for (let i = 0; i < sim.mapHazards.length; i++) {
              const d = sim.mapHazards[i].position.distanceTo(wp);
              if (d < bestHazDist) {
                bestHazDist = d;
                bestHazIdx = i;
              }
            }
            if (bestHazIdx >= 0) {
              const removed = sim.mapHazards.splice(bestHazIdx, 1)[0];
              removed.dispose(scene);
              SoundFX.remove();
              syncHudNow();
            } else {
              sim.rotatePartYaw();
            }
          }
          return;
        }

        if (sim.worldEditTool === 'TERRA_RAMP') {
          if (isLeftClick) {
            if (!sim.rampStartWorld) {
              sim.rampStartWorld = wp.clone();
              SoundFX.snap();
              syncHudNow();
            } else {
              world.buildTerrainRamp(
                sim.rampStartWorld.x,
                sim.rampStartWorld.y,
                sim.rampStartWorld.z,
                wp.x,
                wp.y,
                wp.z,
                Math.max(4, sim.terraBrushRadius),
                sim.terraPaintMat,
              );
              sim.multiplayer?.broadcastVoxelEdit(
                'ramp',
                [wp.x, wp.y, wp.z],
                Math.max(4, sim.terraBrushRadius),
                sim.terraPaintMat,
                undefined,
                {
                  rampStartPos: [
                    sim.rampStartWorld.x,
                    sim.rampStartWorld.y,
                    sim.rampStartWorld.z,
                  ],
                },
              );
              sim.rampStartWorld = null;
              SoundFX.snap();
              fx.spawnWeldSparks(wp.x, wp.y, wp.z);
              updateRaycastTarget();
              syncHudNow();
            }
          } else {
            sim.rampStartWorld = null;
            SoundFX.remove();
            syncHudNow();
          }
          return;
        }

        const effectiveTool: WorldEditToolKind = isLeftClick
          ? sim.worldEditTool
          : 'TERRA_LOWER';
        world.applyTerraformBrush(
          wp.x,
          wp.y,
          wp.z,
          sim.terraBrushRadius,
          effectiveTool,
          sim.terraPaintMat,
        );
        sim.multiplayer?.broadcastVoxelEdit(
          'terraform',
          [wp.x, wp.y, wp.z],
          sim.terraBrushRadius,
          sim.terraPaintMat,
          undefined,
          {
            toolKind: effectiveTool,
          },
        );
        SoundFX.snap();
        fx.spawnWeldSparks(wp.x, wp.y, wp.z);
        updateRaycastTarget();
        syncHudNow();
        return;
      }

      if (sim.isSeatedInRig) {
        if (isLeftClick) {
          curRig.fireCannons();
          curRig.applyMeleeCombatStep(sim.getAllPhysicsRigs(), true, 'PLAYER');
        }
        return;
      }

      updateRaycastTarget();
      const tool = PLAY_SLOTS[sim.selectedSlot - 1] || PLAY_SLOTS[0];

      if (tool.kind === 'SLEDGE') {
        if (!isLeftClick) return;
        if (
          sim.currentHit &&
          (sim.currentHit.distance === undefined || sim.currentHit.distance <= 12.0)
        ) {
          const hitPos =
            sim.currentHit.worldPos ||
            curRig.localVoxelToWorld(
              sim.currentHit.vx,
              sim.currentHit.vy,
              sim.currentHit.vz,
            );
          if (sim.currentHit.target === 'vehicle') {
            const closestVeh = sim.getClosestRigOrEntity(hitPos).rig;
            const hitMat = closestVeh.getVoxel(
              sim.currentHit.vx,
              sim.currentHit.vy,
              sim.currentHit.vz,
            );
            if ((hitMat & 63) === MAT.C4_EXPLOSIVE) {
              // Ignite the exact C4 voxel hit at one end so the 200ms chain reaction ripples block-by-block!
              igniteC4Voxel(
                closestVeh,
                packVoxelKey(
                  sim.currentHit.vx,
                  sim.currentHit.vy,
                  sim.currentHit.vz,
                ),
              );
            } else {
              // Directly chip hit 1px micro-voxel modules (engine/wheel/weapon/etc.) before radial cratering
              if (sim.currentHit.moduleHit) {
                const activeMod = closestVeh.getModuleAt(
                  sim.currentHit.moduleHit.vx,
                  sim.currentHit.moduleHit.vy,
                  sim.currentHit.moduleHit.vz,
                );
                if (activeMod && isMicroVoxelDestructibleKind(activeMod.kind)) {
                  closestVeh.applyMicroVoxelModuleDamage(
                    activeMod,
                    (sim.currentHit.vx + 0.5) * VOXEL_SIZE,
                    (sim.currentHit.vy + 0.5) * VOXEL_SIZE,
                    (sim.currentHit.vz + 0.5) * VOXEL_SIZE,
                    0.34,
                  );
                }
              }
              closestVeh.carveVehicleCrater(hitPos.x, hitPos.y, hitPos.z, 4, 8.5);
              fx.carveWorldCrater(hitPos.x, hitPos.y, hitPos.z, 3, 0, false);
            }
          } else {
            const hitHazCount = damageAllMapHazardsInRadius(
              sim.mapHazards,
              hitPos.x,
              hitPos.y,
              hitPos.z,
              2.8,
              fx,
              false,
            );
            if (hitHazCount === 0) {
              fx.carveWorldCrater(hitPos.x, hitPos.y, hitPos.z, 5);
            }
          }
        } else {
          // Fallback melee ground/vehicle/hazard smash 2.2m directly in front of the player when looking forward at the horizon!
          const strikeX = sim.camFreePos.x - Math.sin(sim.camYaw) * 2.2;
          const strikeZ = sim.camFreePos.z - Math.cos(sim.camYaw) * 2.2;
          const ground = world.probeGroundBelow(strikeX, sim.camFreePos.y, strikeZ, 1.5);
          fx.carveWorldCrater(strikeX, ground.y, strikeZ, 5);
          damageAllMapHazardsInRadius(
            sim.mapHazards,
            strikeX,
            sim.camFreePos.y - 0.5,
            strikeZ,
            2.8,
            fx,
            false,
          );
        }
        updateRaycastTarget();
        syncHudNow();
      } else if (tool.kind === 'PIPE_BOMB') {
        if (isLeftClick) {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          const throwOrigin = sim.camFreePos.clone().addScaledVector(dir, 0.55);
          fx.throwBomb(throwOrigin, dir);
        } else {
          fx.detonateBombs();
          updateRaycastTarget();
          syncHudNow();
        }
      } else if (tool.kind === 'PLASMA_RIFLE' && isLeftClick) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const fireOrigin = sim.camFreePos.clone().addScaledVector(dir, 0.75);
        fx.firePlasmaShell(
          fireOrigin,
          dir,
          new THREE.Vector3(),
          true, // Direct collision & crater destruction against the vehicle!
        );
      } else if (tool.kind === 'LIGHT_BLOCK') {
        if (!sim.currentHit) {
          // Fallback downward ground raycast 2.6m in front of player when looking toward horizon
          const fbOrigin = new THREE.Vector3(
            sim.camFreePos.x - Math.sin(sim.camYaw) * 2.6,
            sim.camFreePos.y + 1.0,
            sim.camFreePos.z - Math.cos(sim.camYaw) * 2.6,
          );
          const fbDir = new THREE.Vector3(0, -1, 0);
          sim.currentHit = world.raycastWorldVoxels(fbOrigin, fbDir, 8);
        }
        if (!sim.currentHit) return;
        if (isLeftClick) {
          // Place ONLY Light Block (MAT.ALLOY_BLUE) in Walking Mode using the selected brush shape!
          const nx = sim.currentHit.vx + sim.currentHit.normal.x;
          const ny = sim.currentHit.vy + sim.currentHit.normal.y;
          const nz = sim.currentHit.vz + sim.currentHit.normal.z;
          const shape = tool.buildShape || 'SINGLE';

          // Determine cardinal forward & right vectors from player camera yaw
          const fwdX = -Math.sin(sim.camYaw);
          const fwdZ = -Math.cos(sim.camYaw);
          const isXMajor = Math.abs(fwdX) > Math.abs(fwdZ);
          const stepFwdX = isXMajor ? (fwdX >= 0 ? 1 : -1) : 0;
          const stepFwdZ = isXMajor ? 0 : fwdZ >= 0 ? 1 : -1;
          const stepRightX = -stepFwdZ;
          const stepRightZ = stepFwdX;

          const offsets: Array<{ dx: number; dy: number; dz: number }> = [];
          if (shape === 'WALL_5X4') {
            for (let w = -2; w <= 2; w++) {
              for (let h = 0; h < 4; h++) {
                offsets.push({
                  dx: stepRightX * w,
                  dy: h,
                  dz: stepRightZ * w,
                });
              }
            }
          } else if (shape === 'RAMP_4X4') {
            for (let s = 0; s < 4; s++) {
              for (let w = -1; w <= 2; w++) {
                offsets.push({
                  dx: stepFwdX * s + stepRightX * w,
                  dy: s,
                  dz: stepFwdZ * s + stepRightZ * w,
                });
                // Thicken ramp underside by 1 voxel so you can drive/walk smoothly up it
                if (s > 0) {
                  offsets.push({
                    dx: stepFwdX * s + stepRightX * w,
                    dy: s - 1,
                    dz: stepFwdZ * s + stepRightZ * w,
                  });
                }
              }
            }
          } else if (shape === 'FLOOR_5X5') {
            for (let rx = -2; rx <= 2; rx++) {
              for (let rz = -2; rz <= 2; rz++) {
                offsets.push({ dx: rx, dy: 0, dz: rz });
              }
            }
          } else if (shape === 'PILLAR_1X6') {
            for (let h = 0; h < 6; h++) {
              offsets.push({ dx: 0, dy: h, dz: 0 });
            }
          } else {
            offsets.push({ dx: 0, dy: 0, dz: 0 });
          }

          if (sim.currentHit.target === 'vehicle') {
            const targetVeh = sim.getClosestCreation(
              sim.currentHit.worldPos || camera.position,
            ).rig;
            for (const off of offsets) {
              targetVeh.setVoxel(
                nx + off.dx,
                ny + off.dy,
                nz + off.dz,
                MAT.ALLOY_BLUE,
              );
            }
            const wp = targetVeh.localVoxelToWorld(nx, ny, nz);
            SoundFX.snap();
            fx.spawnWeldSparks(wp.x, wp.y, wp.z);
            targetVeh.rebuildVehicleGeometry();
            sim.multiplayer.broadcastSpawnVehicle(targetVeh);
          } else if (sim.currentHit.target === 'world') {
            const touchedChunks = new Set<ReturnType<typeof world.getOrCreateChunk>>();
            for (const off of offsets) {
              const tvx = nx + off.dx;
              const tvy = ny + off.dy;
              const tvz = nz + off.dz;
              world.setVoxel(tvx, tvy, tvz, MAT.ALLOY_BLUE);
              const c = world.chunkMap.get(`${tvx >> 6},${tvz >> 6}`);
              if (c) touchedChunks.add(c);
              const bPos: [number, number, number] = [
                (tvx - TOTAL_VX / 2 + 0.5) * VOXEL_SIZE,
                (tvy + 0.5) * VOXEL_SIZE,
                (tvz - TOTAL_VZ / 2 + 0.5) * VOXEL_SIZE,
              ];
              sim.multiplayer.broadcastVoxelEdit('stamp', bPos, 0, MAT.ALLOY_BLUE);
            }
            const wp = new THREE.Vector3(
              (nx - TOTAL_VX / 2 + 0.5) * VOXEL_SIZE,
              (ny + 0.5) * VOXEL_SIZE,
              (nz - TOTAL_VZ / 2 + 0.5) * VOXEL_SIZE,
            );
            if (offsets.length <= 4) {
              touchedChunks.forEach((c) => world.rebuildChunkSync(c));
            } else {
              world.flushDirtyChunksImmediate(wp.x, wp.z, 6);
            }
            SoundFX.snap();
            fx.spawnWeldSparks(wp.x, wp.y, wp.z);
          }
          updateRaycastTarget();
          syncHudNow();
        } else {
          // Right-click with Light Block tool breaks/removes the targeted block (single block, radius <= 2 -> rebuildChunkSync!)
          if (sim.currentHit.target === 'vehicle') {
            const targetVeh = sim.getClosestCreation(
              sim.currentHit.worldPos || camera.position,
            ).rig;
            targetVeh.setVoxel(
              sim.currentHit.vx,
              sim.currentHit.vy,
              sim.currentHit.vz,
              MAT.AIR,
            );
            if (targetVeh.voxelMap.size === 0 && targetVeh.modules.length === 0) {
              targetVeh.setVoxel(12, 6, 18, MAT.ALLOY_BLUE);
            }
            SoundFX.remove();
            targetVeh.rebuildVehicleGeometry();
            sim.multiplayer.broadcastSpawnVehicle(targetVeh);
          } else if (sim.currentHit.target === 'world') {
            const hitVX = sim.currentHit.vx;
            const hitVY = sim.currentHit.vy;
            const hitVZ = sim.currentHit.vz;
            const hitMat = world.readEffectiveVoxelMat(hitVX, hitVY, hitVZ);
            if (hitMat !== MAT.AIR && hitMat !== MAT.WATER_VOX && hitMat !== MAT.BEDROCK) {
              const hitInfo = MAT_INFO[hitMat & 63];
              const hitWX = (hitVX - TOTAL_VX / 2 + 0.5) * VOXEL_SIZE;
              const hitWY = (hitVY + 0.5) * VOXEL_SIZE;
              const hitWZ = (hitVZ - TOTAL_VZ / 2 + 0.5) * VOXEL_SIZE;
              world.setVoxel(hitVX, hitVY, hitVZ, MAT.AIR);
              terrainEntityManager.spawnTerrainVoxelDebris(
                hitWX,
                hitWY,
                hitWZ,
                hitInfo ? hitInfo.color : 0x94a3b8,
                hitWX,
                hitWY - 0.15,
                hitWZ,
                scene,
              );
              const touchedChunks = new Set<MicroVoxelChunk>();
              const hitChunk = world.chunkMap.get(`${hitVX >> 6},${hitVZ >> 6}`);
              if (hitChunk) {
                touchedChunks.add(hitChunk);
              }
              world.collapseUnsupportedWorldVoxels(
                hitVX,
                hitVY,
                hitVZ,
                1,
                true,
                touchedChunks,
              );
              touchedChunks.forEach((c) => {
                world.rebuildChunkSync(c);
              });
              const bPos: [number, number, number] = [hitWX, hitWY, hitWZ];
              sim.multiplayer.broadcastVoxelEdit('stamp', bPos, 0, MAT.AIR);
              SoundFX.remove();
            }
          }
          updateRaycastTarget();
          syncHudNow();
        }
      }
    }

    // Touch & Mobile UI Helper Methods
    const handleMobileBuildPrimaryTap = () => {
      if (
        (sim.placementMode === 'BOX_FILL' || sim.placementMode === 'LINE_DRAG') &&
        sim.currentHit &&
        sim.currentHit.target === 'vehicle'
      ) {
        if (!sim.dragStartVoxel) {
          sim.dragStartVoxel = {
            vx: sim.currentHit.vx + sim.currentHit.normal.x,
            vy: sim.currentHit.vy + sim.currentHit.normal.y,
            vz: sim.currentHit.vz + sim.currentHit.normal.z,
          };
          SoundFX.snap();
          updateRaycastTarget();
          syncHudNow();
          return;
        }
        applyBuildAction(true, true);
        sim.dragStartVoxel = null;
        updateRaycastTarget();
        syncHudNow();
        return;
      }
      applyBuildAction(true, true);
    };

    (sim as any).triggerPrimaryAction = () => {
      sim.pointerNDC.set(0, 0);
      sim.hasPointerMoved = false;
      updateRaycastTarget();
      if (sim.isBuildMode) {
        handleMobileBuildPrimaryTap();
      } else {
        executePlayAction(true);
      }
    };

    (sim as any).triggerPrimaryActionAt = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        sim.pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        sim.pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      } else {
        sim.pointerNDC.set(0, 0);
      }
      sim.hasPointerMoved = true;
      updateRaycastTarget();
      if (sim.isBuildMode) {
        handleMobileBuildPrimaryTap();
      } else {
        executePlayAction(true);
      }
    };

    (sim as any).triggerSecondaryAction = () => {
      sim.pointerNDC.set(0, 0);
      sim.hasPointerMoved = false;
      updateRaycastTarget();
      if (sim.isBuildMode) {
        if (sim.dragStartVoxel) {
          sim.dragStartVoxel = null;
          SoundFX.remove();
          updateRaycastTarget();
          syncHudNow();
          return;
        }
        if (sim.selectedBuildObjects.length > 0) {
          sim.deleteSelectedObject();
        } else if (sim.currentHit && sim.currentHit.target === 'vehicle') {
          const hitObj = extractHitSelectableObject(sim.currentHit);
          sim.selectBuildObjectAt(hitObj, false);
          sim.deleteSelectedObject();
        }
      } else {
        executePlayAction(false);
      }
    };

    (sim as any).canEnterVehicle = (): boolean => {
      if (sim.isSeatedInRig || sim.isBuildMode) return false;
      const closest = sim.getClosestCreation(sim.camFreePos);
      return closest.dist <= 8.5 && closest.rig.hasIntactSeat();
    };

    (sim as any).rotatePartX = () => {
      if (sim.isBuildMode && sim.selectedBuildObjects.length > 0) {
        sim.rotateSelectedObject('pitch');
      } else {
        sim.rotatePartAxis('pitch');
      }
    };
    (sim as any).rotatePartY = () => {
      if (sim.isBuildMode && sim.selectedBuildObjects.length > 0) {
        sim.rotateSelectedObject('yaw');
      } else {
        sim.rotatePartAxis('yaw');
      }
    };
    (sim as any).rotatePartZ = () => {
      if (sim.isBuildMode && sim.selectedBuildObjects.length > 0) {
        sim.rotateSelectedObject('roll');
      } else {
        sim.rotatePartAxis('roll');
      }
    };
    (sim as any).placeBlock = (sim as any).triggerPrimaryAction;

    const onPointerLockChange = () => {
      sim.isPointerLocked = document.pointerLockElement === renderer.domElement;
      if ((sim.isBuildMode || sim.isWorldEditMode) && sim.isPointerLocked) {
        document.exitPointerLock?.();
        sim.isPointerLocked = false;
      }
      if (!sim.isPointerLocked) {
        for (const k in sim.keys) sim.keys[k] = false;
      }
      syncHudNow();
    };

    let rmbDownPos = { x: 0, y: 0 };
    let lastDragClientX = 0;
    let lastDragClientY = 0;

    const onMouseMove = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const isInsideMobileUi = Boolean(
        targetEl?.closest?.('#mobile-controls-root'),
      );
      if (!isInsideMobileUi && !isMobileDevice()) {
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          sim.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          sim.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          sim.hasPointerMoved = true;
        }
      }

      if (sim.isPointerLocked || sim.isOrbitDragging) {
        const moveX = sim.isPointerLocked
          ? e.movementX
          : e.movementX !== 0
            ? e.movementX
            : e.clientX - lastDragClientX;
        const moveY = sim.isPointerLocked
          ? e.movementY
          : e.movementY !== 0
            ? e.movementY
            : e.clientY - lastDragClientY;
        lastDragClientX = e.clientX;
        lastDragClientY = e.clientY;

        if (Math.abs(moveX) > 220 || Math.abs(moveY) > 220) {
          return;
        }
        sim.lastMouseMoveTime = performance.now();
        const zoomSens = sim.isZoomed
          ? Math.max(1e-8, camera.fov / (sim.baseFov || 68))
          : 1.0;
        sim.camYaw -= moveX * 0.0028 * zoomSens;
        sim.camPitch = Math.max(
          -1.45,
          Math.min(1.45, sim.camPitch - moveY * 0.0028 * zoomSens),
        );

        if (sim.isSeatedInRig && !sim.isBuildMode && !sim.isWorldEditMode) {
          sim.driveYawOffset -= moveX * 0.0028 * zoomSens;
          sim.drivePitchOffset = Math.max(
            -0.2,
            Math.min(1.25, sim.drivePitchOffset + moveY * 0.0024 * zoomSens),
          );
        }

        if (sim.isOrbitDragging && sim.isBuildMode) {
          const backDir = new THREE.Vector3(
            Math.sin(sim.camYaw) * Math.cos(sim.camPitch),
            -Math.sin(sim.camPitch),
            Math.cos(sim.camYaw) * Math.cos(sim.camPitch),
          ).normalize();
          sim.camFreePos
            .copy(sim.buildOrbitPivot)
            .addScaledVector(backDir, sim.buildOrbitDist);
        }
      } else {
        lastDragClientX = e.clientX;
        lastDragClientY = e.clientY;
      }

      // Continuous Terraform Sculpting / Painting while dragging LMB in World Edit Mode
      if (
        sim.isWorldEditMode &&
        sim.isLeftMouseDown &&
        !sim.isOrbitDragging &&
        (sim.worldEditTool === 'TERRA_RAISE' ||
          sim.worldEditTool === 'TERRA_LOWER' ||
          sim.worldEditTool === 'TERRA_FLATTEN' ||
          sim.worldEditTool === 'TERRA_PAINT')
      ) {
        updateRaycastTarget();
        if (sim.currentHit) {
          const terraKey = `${sim.currentHit.vx},${sim.currentHit.vy},${sim.currentHit.vz}`;
          if (terraKey !== sim.lastPaintedKey) {
            sim.lastPaintedKey = terraKey;
            executePlayAction(true);
          }
        }
        return;
      }

      // 2D Screen-Space Marquee Box Drag (dragging LMB from Point A to Point B on empty space or with Shift)
      if (sim.isBuildMode && sim.marqueeSelect && sim.isLeftMouseDown) {
        sim.marqueeSelect.curX = e.clientX;
        sim.marqueeSelect.curY = e.clientY;
        const dragDist = Math.hypot(
          sim.marqueeSelect.curX - sim.marqueeSelect.startX,
          sim.marqueeSelect.curY - sim.marqueeSelect.startY,
        );
        if (dragDist >= 5) {
          const enclosed = computeMarqueeSelectedObjects(
            sim.marqueeSelect.startX,
            sim.marqueeSelect.startY,
            sim.marqueeSelect.curX,
            sim.marqueeSelect.curY,
          );
          const nextSel = sim.marqueeSelect.additive
            ? mergeBuildObjectSelections(
                sim.marqueeSelect.baseSelection,
                enclosed,
              )
            : enclosed;
          sim.setMultiSelection(nextSel, false);
          updateMarqueeOverlayDOM();
        }
        return;
      }

      // Live Ghost Update while dragging a Box/Rect Fill or Line Drag in Build Mode
      if (
        sim.isBuildMode &&
        (sim.placementMode === 'BOX_FILL' || sim.placementMode === 'LINE_DRAG') &&
        sim.isLeftMouseDown &&
        sim.dragStartVoxel &&
        !sim.isOrbitDragging
      ) {
        updateRaycastTarget();
      }

      // Continuous Weld, Paint Tool, or Chisel Mode: weld, recolor, or carve blocks as you sweep the mouse while holding LMB!
      if (
        sim.isBuildMode &&
        (sim.placementMode === 'PAINT' ||
          sim.placementMode === 'PAINT_TOOL' ||
          sim.placementMode === 'CHISEL') &&
        sim.isLeftMouseDown &&
        !sim.isOrbitDragging
      ) {
        updateRaycastTarget();
        if (sim.currentHit) {
          const isInPlaceTarget =
            sim.placementMode === 'PAINT_TOOL' || sim.placementMode === 'CHISEL';
          const isMicroKey =
            sim.hullScalePx !== 4 ||
            sim.currentHit.hitIsMicro ||
            sim.placementMode === 'CHISEL';
          const paintKey = isMicroKey
            ? (() => {
                const origin = computeScaledAnchorOrigin(
                  {
                    mx:
                      typeof sim.currentHit.mx === 'number'
                        ? sim.currentHit.mx
                        : sim.currentHit.vx * MICRO_VOXEL_SUBDIV,
                    my:
                      typeof sim.currentHit.my === 'number'
                        ? sim.currentHit.my
                        : sim.currentHit.vy * MICRO_VOXEL_SUBDIV,
                    mz:
                      typeof sim.currentHit.mz === 'number'
                        ? sim.currentHit.mz
                        : sim.currentHit.vz * MICRO_VOXEL_SUBDIV,
                    normal: sim.currentHit.normal,
                  },
                  sim.hullScalePx,
                  isInPlaceTarget,
                );
                return `m:${sim.hullScalePx}:${origin.mx},${origin.my},${origin.mz}`;
              })()
            : isInPlaceTarget
              ? `${sim.currentHit.vx},${sim.currentHit.vy},${sim.currentHit.vz}`
              : `${sim.currentHit.vx + sim.currentHit.normal.x},${
                  sim.currentHit.vy + sim.currentHit.normal.y
                },${sim.currentHit.vz + sim.currentHit.normal.z}`;
          if (paintKey !== sim.lastPaintedKey) {
            sim.lastPaintedKey = paintKey;
            applyBuildAction(true, false);
          }
        }
      }
    };

    const onCanvasMouseDown = (e: MouseEvent) => {
      if (sim.gameState !== 'playing') return;
      SoundFX.init();
      lastDragClientX = e.clientX;
      lastDragClientY = e.clientY;

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        sim.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        sim.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        sim.hasPointerMoved = true;
      }

      if (isScreenshotModeRef.current) {
        sim.isOrbitDragging = true;
        return;
      }

      // Lock mouse ONLY in Driving or On-Foot mode (NEVER in Build Mode or World Editor Mode!)
      if (!sim.isPointerLocked && !sim.isBuildMode && !sim.isWorldEditMode && !showFastTravelMapRef.current) {
        sim.requestCanvasPointerLock();
      }

      if (e.button === 1) {
        sim.isOrbitDragging = true;
        return;
      }

      // World Edit Mode: Build-Mode-style mouse camera rotation on Right-Click drag + LMB action!
      if (sim.isWorldEditMode) {
        if (e.button === 2) {
          rmbDownPos = { x: e.clientX, y: e.clientY };
          sim.isRightMouseDown = true;
          sim.isOrbitDragging = true;
          return;
        }
        if (e.button === 0) {
          sim.isLeftMouseDown = true;
          updateRaycastTarget();
          if (sim.currentHit) {
            sim.lastPaintedKey = `${sim.currentHit.vx},${sim.currentHit.vy},${sim.currentHit.vz}`;
          }
          executePlayAction(true);
        }
        return;
      }

      if (sim.isBuildMode) {
        if (e.button === 2) {
          // In Trailmakers Build Mode: holding RMB orbits the camera, short-clicking RMB selects/deletes an object!
          rmbDownPos = { x: e.clientX, y: e.clientY };
          sim.isRightMouseDown = true;
          sim.isOrbitDragging = true;
          return;
        }

        if (e.button === 0) {
          updateRaycastTarget();

          // Alt + Left-Click OR Eyedropper mode: immediately sample hovered part/material/rotation/scale!
          if ((e.altKey || sim.eyedropperMode) && sim.currentHit && sim.currentHit.target === 'vehicle') {
            sim.sampleHoveredObjectToBrush();
            return;
          }

          sim.isLeftMouseDown = true;

          // 1. If clicking on empty space where blocks do not occupy, OR if holding Shift:
          //    Start a 2D Marquee Box Selection drag from Point A to Point B (or Shift-Click select on release)!
          const hitVehicle =
            sim.currentHit && sim.currentHit.target === 'vehicle';
          if (!hitVehicle || e.shiftKey) {
            sim.marqueeSelect = {
              startX: e.clientX,
              startY: e.clientY,
              curX: e.clientX,
              curY: e.clientY,
              additive: e.shiftKey,
              baseSelection: e.shiftKey ? [...sim.selectedBuildObjects] : [],
              clickedHitObj:
                hitVehicle && sim.currentHit
                  ? extractHitSelectableObject(sim.currentHit)
                  : null,
            };
            updateMarqueeOverlayDOM();
            return;
          }

          if (
            (sim.placementMode === 'BOX_FILL' ||
              sim.placementMode === 'LINE_DRAG') &&
            sim.currentHit
          ) {
            sim.dragStartVoxel = {
              vx: sim.currentHit.vx + sim.currentHit.normal.x,
              vy: sim.currentHit.vy + sim.currentHit.normal.y,
              vz: sim.currentHit.vz + sim.currentHit.normal.z,
            };
            sim.dragStartMicro = computeScaledAnchorOrigin(
              {
                mx:
                  typeof sim.currentHit.mx === 'number'
                    ? sim.currentHit.mx
                    : sim.currentHit.vx * MICRO_VOXEL_SUBDIV,
                my:
                  typeof sim.currentHit.my === 'number'
                    ? sim.currentHit.my
                    : sim.currentHit.vy * MICRO_VOXEL_SUBDIV,
                mz:
                  typeof sim.currentHit.mz === 'number'
                    ? sim.currentHit.mz
                    : sim.currentHit.vz * MICRO_VOXEL_SUBDIV,
                normal: sim.currentHit.normal,
              },
              sim.hullScalePx,
              false,
            );
            updateRaycastTarget();
            return;
          }
          if (sim.currentHit) {
            const isInPlace =
              sim.placementMode === 'PAINT_TOOL' || sim.placementMode === 'CHISEL';
            sim.lastPaintedKey =
              sim.hullScalePx !== 4 || sim.currentHit.hitIsMicro || sim.placementMode === 'CHISEL'
                ? `m:${sim.hullScalePx}:${sim.currentHit.mx ?? sim.currentHit.vx * 4},${sim.currentHit.my ?? sim.currentHit.vy * 4},${sim.currentHit.mz ?? sim.currentHit.vz * 4}`
                : isInPlace
                  ? `${sim.currentHit.vx},${sim.currentHit.vy},${sim.currentHit.vz}`
                  : `${sim.currentHit.vx + sim.currentHit.normal.x},${
                      sim.currentHit.vy + sim.currentHit.normal.y
                    },${sim.currentHit.vz + sim.currentHit.normal.z}`;
          }
          applyBuildAction(true, true);
        }
        return;
      }

      // Driving or On-Foot Mode
      if (e.button === 2 && sim.isSeatedInRig && !sim.isPointerLocked) {
        sim.isOrbitDragging = true;
        return;
      }

      if (e.button === 0) {
        executePlayAction(true);
      } else if (e.button === 2) {
        executePlayAction(false);
      }
    };

    const onWindowMouseUp = (e: MouseEvent) => {
      if (sim.isWorldEditMode) {
        if (e.button === 0) {
          sim.isLeftMouseDown = false;
        }
        if (e.button === 2 && sim.isRightMouseDown) {
          sim.isRightMouseDown = false;
          const moveDist = Math.hypot(
            e.clientX - rmbDownPos.x,
            e.clientY - rmbDownPos.y,
          );
          if (moveDist < 6) {
            executePlayAction(false);
          }
        }
      }
      if (sim.isBuildMode) {
        if (e.button === 0 && sim.isLeftMouseDown) {
          sim.isLeftMouseDown = false;
          if (sim.marqueeSelect) {
            const mq = sim.marqueeSelect;
            sim.marqueeSelect = null;
            updateMarqueeOverlayDOM();
            const dragDist = Math.hypot(
              e.clientX - mq.startX,
              e.clientY - mq.startY,
            );
            if (dragDist >= 5) {
              const enclosed = computeMarqueeSelectedObjects(
                mq.startX,
                mq.startY,
                e.clientX,
                e.clientY,
              );
              const nextSel = mq.additive
                ? mergeBuildObjectSelections(mq.baseSelection, enclosed)
                : enclosed;
              sim.setMultiSelection(nextSel, true);
              updateRaycastTarget();
            } else if (mq.clickedHitObj && mq.additive) {
              // Shift + Left-Click on a vehicle object:
              // - If nothing was selected -> selects ALL identical objects on the vehicle!
              // - If objects were already selected -> adds/toggles that object in the multi-selection!
              sim.selectBuildObjectAt(mq.clickedHitObj, true);
              updateRaycastTarget();
            } else if (!mq.additive && sim.selectedBuildObjects.length > 0) {
              // Short click on empty space without Shift -> deselects current selection
              sim.setMultiSelection([], true);
              updateRaycastTarget();
            }
            return;
          }
          if (
            (sim.placementMode === 'BOX_FILL' ||
              sim.placementMode === 'LINE_DRAG') &&
            sim.dragStartVoxel
          ) {
            applyBuildAction(true);
            sim.dragStartVoxel = null;
            sim.dragStartMicro = null;
            updateRaycastTarget();
          }
        }
        if (e.button === 2 && sim.isRightMouseDown) {
          sim.isRightMouseDown = false;
          const moveDist = Math.hypot(
            e.clientX - rmbDownPos.x,
            e.clientY - rmbDownPos.y,
          );
          if (moveDist < 6) {
            applyBuildAction(false, true, e.shiftKey);
          }
        }
      }
      sim.isOrbitDragging = false;
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onWheel = (e: WheelEvent) => {
      if (sim.gameState !== 'playing') return;
      if (showFastTravelMapRef.current) return;
      // Never zoom camera or cycle slots when scrolling inside UI panels or dropdowns!
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl &&
        (targetEl.closest('[data-ui-scroll="true"]') ||
          targetEl.closest('[data-testid="left-block-catalog"]') ||
          targetEl.closest('[data-testid="module-config-panel"]') ||
          targetEl.tagName === 'SELECT' ||
          targetEl.tagName === 'INPUT' ||
          targetEl.tagName === 'TEXTAREA')
      ) {
        return;
      }

      if (sim.isBuildMode && e.altKey) {
        e.preventDefault();
        sim.stepHullScale(e.deltaY < 0 ? 1 : -1);
        return;
      }

      if (sim.isZoomed && !sim.isBuildMode) {
        e.preventDefault();
        sim.stepZoomMagnification(e.deltaY < 0 ? 1 : -1);
        return;
      }

      if ((sim.isBuildMode || sim.isWorldEditMode) && !e.shiftKey) {
        const camForward = new THREE.Vector3();
        camera.getWorldDirection(camForward);
        const zoomStep = e.deltaY > 0 ? -1.15 : 1.15;
        sim.camFreePos.addScaledVector(camForward, zoomStep);
        sim.buildOrbitDist = Math.max(
          1.4,
          Math.min(65.0, sim.camFreePos.distanceTo(sim.buildOrbitPivot)),
        );
        return;
      }
      if (sim.isSeatedInRig && !e.shiftKey) {
        sim.driveOrbitDist = Math.max(
          4.5,
          Math.min(28.0, sim.driveOrbitDist + (e.deltaY > 0 ? 1.0 : -1.0)),
        );
        return;
      }
      const maxSlots = sim.isBuildMode
        ? sim.isObjectStudioMode
          ? OBJECT_STUDIO_SLOTS.length
          : BUILD_SLOTS.length
        : PLAY_SLOTS.length;
      sim.selectedSlot =
        ((sim.selectedSlot - 1 + (e.deltaY > 0 ? 1 : -1) + maxSlots) %
          maxSlots) +
        1;
      syncHudNow();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore global hotkeys while typing in inputs or dropdowns
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (sim.gameState === 'title') {
        if (e.code === 'KeyF') {
          e.preventDefault();
          SoundFX.snap();
          const next = !showFastTravelMapRef.current;
          if (next) sim.initTacticalMapCam();
          setShowFastTravelMap(next);
          return;
        }
        if (e.code === 'Escape' && showFastTravelMapRef.current) {
          e.preventDefault();
          setShowFastTravelMap(false);
          return;
        }
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          sim.startGame();
        }
        return;
      }

      if (e.code === 'F12') {
        e.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock?.();
        SoundFX.snap();
        setIsScreenshotMode((v) => !v);
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        if (isScreenshotModeRef.current) {
          setIsScreenshotMode(false);
          SoundFX.snap();
          return;
        }
        if (showFastTravelMapRef.current) {
          setShowFastTravelMap(false);
          return;
        }
        if (sim.isBuildMode && activeStampPrefabRef.current) {
          setActiveStampPrefab(null);
          SoundFX.snap();
          return;
        }
        if (sim.isBuildMode && sim.eyedropperMode) {
          sim.toggleEyedropperMode(false);
          return;
        }
        if (sim.isBuildMode && sim.selectedBuildObjects.length > 0) {
          sim.selectBuildObjectAt(null);
          return;
        }
        if (sim.gameState === 'playing') sim.pauseGame();
        else if (sim.gameState === 'paused') sim.resumeGame();
        return;
      }

      if (sim.gameState !== 'playing') return;

      if (
        sim.isBuildMode &&
        (e.code === 'Delete' || e.code === 'Backspace') &&
        sim.selectedBuildObjects.length > 0
      ) {
        e.preventDefault();
        sim.deleteSelectedObject();
        return;
      }

      // Build Mode Clipboard & Undo/Redo shortcuts (Ctrl+C, Ctrl+D, Ctrl+Y, Shift+Z)
      if (sim.isBuildMode) {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && sim.selectedBuildObjects.length > 0) {
          e.preventDefault();
          sim.copySelectionToStamp();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD' && sim.selectedBuildObjects.length > 0) {
          e.preventDefault();
          sim.duplicateSelectedObject();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
          e.preventDefault();
          sim.redoBuildStep();
          return;
        }
      }

      // Desktop Build Mode: Move / Nudge selected part or multi-selected items with Arrow Keys (X/Z) and U/J, [/], PgUp/PgDn, or Shift+Up/Down (Y Up/Down)!
      if (sim.isBuildMode && sim.selectedBuildObjects.length > 0) {
        if (e.code === 'ArrowUp') {
          e.preventDefault();
          if (e.shiftKey) {
            sim.nudgeSelectedObjectCameraRelative(0, 0, 1, e.repeat);
          } else {
            sim.nudgeSelectedObjectCameraRelative(1, 0, 0, e.repeat);
          }
          return;
        }
        if (e.code === 'ArrowDown') {
          e.preventDefault();
          if (e.shiftKey) {
            sim.nudgeSelectedObjectCameraRelative(0, 0, -1, e.repeat);
          } else {
            sim.nudgeSelectedObjectCameraRelative(-1, 0, 0, e.repeat);
          }
          return;
        }
        if (e.code === 'ArrowLeft') {
          e.preventDefault();
          sim.nudgeSelectedObjectCameraRelative(0, -1, 0, e.repeat);
          return;
        }
        if (e.code === 'ArrowRight') {
          e.preventDefault();
          sim.nudgeSelectedObjectCameraRelative(0, 1, 0, e.repeat);
          return;
        }
        if (
          e.code === 'PageUp' ||
          e.code === 'BracketRight' ||
          e.code === 'KeyU'
        ) {
          e.preventDefault();
          sim.nudgeSelectedObjectCameraRelative(0, 0, 1, e.repeat);
          return;
        }
        if (
          e.code === 'PageDown' ||
          e.code === 'BracketLeft' ||
          e.code === 'KeyJ'
        ) {
          e.preventDefault();
          sim.nudgeSelectedObjectCameraRelative(0, 0, -1, e.repeat);
          return;
        }
      }

      // Toggle Option B (1PX FINE vs 4PX BLOCK) via [ and ] in Build Mode, or Alt+[ / Alt+] to step Box/Extrude Depth (1..8px)
      if (sim.isBuildMode && sim.selectedBuildObjects.length === 0) {
        if (e.code === 'BracketLeft') {
          e.preventDefault();
          if (e.altKey) {
            sim.stepBoxDepthPx(-1);
          } else {
            sim.toggleHullStampMode();
          }
          return;
        }
        if (e.code === 'BracketRight') {
          e.preventDefault();
          if (e.altKey) {
            sim.stepBoxDepthPx(1);
          } else {
            sim.toggleHullStampMode();
          }
          return;
        }
      }

      const wasHeld = Boolean(sim.keys[e.code]);
      sim.keys[e.code] = true;

      if (wasHeld) return;

      const slotMap: Record<string, number> = {
        Digit1: 1,
        Digit2: 2,
        Digit3: 3,
        Digit4: 4,
        Digit5: 5,
        Digit6: 6,
        Digit7: 7,
        Digit8: 8,
        Digit9: 9,
        Digit0: 10,
        Minus: 11,
        Equal: 12,
      };
      if (slotMap[e.code]) {
        const s = slotMap[e.code];
        if (sim.isBuildMode || (!sim.isSeatedInRig && s <= PLAY_SLOTS.length)) {
          sim.selectSlot(s);
        }
      }

      if (e.code === 'KeyZ') {
        if (sim.isBuildMode) {
          e.preventDefault();
          if (e.shiftKey) {
            sim.redoBuildStep();
          } else {
            sim.undoBuildStep();
          }
          return;
        } else {
          e.preventDefault();
          sim.zKeyDownTimeMs = performance.now();
          sim.toggleZoom();
          return;
        }
      }
      if (e.code === 'KeyI' && sim.isBuildMode) {
        e.preventDefault();
        if (sim.currentHit && sim.currentHit.target === 'vehicle') {
          sim.sampleHoveredObjectToBrush();
        } else {
          sim.toggleEyedropperMode();
        }
        return;
      }
      if (e.code === 'KeyX' && sim.isBuildMode) {
        e.preventDefault();
        sim.toggleXrayMode();
        return;
      }
      if (e.code === 'Tab' && sim.isBuildMode) {
        e.preventDefault();
        setDockCollapsed((c) => !c);
        SoundFX.snap();
        return;
      }
      if (e.code === 'KeyB') sim.toggleHoverBuildMode();
      if (e.code === 'KeyE') sim.toggleEnterExitRig();
      if (e.code === 'Tab' && !sim.isBuildMode && !sim.isWorldEditMode && !sim.isObjectStudioMode) {
        e.preventDefault();
        setMinimalHudMode((m) => !m);
        SoundFX.snap();
        return;
      }
      if (e.code === 'KeyG') {
        const curRig = sim.getActiveRig();
        if (
          !sim.isBuildMode &&
          !sim.isWorldEditMode &&
          sim.isSeatedInRig &&
          !e.shiftKey &&
          (curRig.winchCount > 0 || curRig.winchActive)
        ) {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          curRig.toggleWinch(camera.position, dir);
          syncHudNow();
        } else if (!sim.isBuildMode && !sim.isWorldEditMode && !sim.isSeatedInRig) {
          // On-foot [G] toggles manual ragdoll flop / stand-up
          if (sim.playerRagdoll.active && sim.playerRagdoll.elapsed > 0.35) {
            sim.recoverFromRagdoll(false);
          } else if (!sim.playerRagdoll.active && !sim.playerRagdoll.isGettingUp) {
            const fwdX = -Math.sin(sim.camYaw);
            const fwdZ = -Math.cos(sim.camYaw);
            sim.triggerPlayerRagdoll(fwdX * 5.2, 4.4, fwdZ * 5.2, 2.2);
            SoundFX.clank();
          }
        }
      }
      if (e.code === 'KeyY') {
        if (sim.isBuildMode || sim.isWorldEditMode) {
          if (sim.isBuildMode && sim.selectedBuildObjects.length > 0) {
            sim.rotateSelectedObject('roll');
          } else {
            sim.rotatePartAxis('roll');
          }
        }
      }
      if (e.code === 'KeyT') {
        if (sim.isBuildMode || sim.isWorldEditMode) {
          if (sim.isBuildMode && sim.selectedBuildObjects.length > 0) {
            sim.rotateSelectedObject('pitch');
          } else {
            sim.rotatePartAxis('pitch');
          }
        }
      }
      // Dispatch custom or default keydown triggers for seated vehicle one-shot modules (Winch, Smoke/Flares, Magnet)
      if (!sim.isBuildMode && !sim.isWorldEditMode && sim.isSeatedInRig) {
        const curRig = sim.getActiveRig();
        const matchesModPosKey = (kind: string, defaultCode: string) =>
          curRig.modules.some(
            (m) =>
              m.kind === kind &&
              !m.config?.disabled &&
              (m.config?.posKey || defaultCode) === e.code,
          );
        const matchesModNegKey = (kind: string, defaultCode: string) =>
          curRig.modules.some(
            (m) =>
              m.kind === kind &&
              !m.config?.disabled &&
              (m.config?.negKey || defaultCode) === e.code,
          );
        if (matchesModPosKey('GRAPPLING_WINCH', 'KeyT')) {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          curRig.toggleWinch(camera.position, dir);
          syncHudNow();
        }
        if (matchesModPosKey('MAGNET_COUPLER', 'KeyK')) {
          curRig.toggleMagnetCoupler('ATTRACT');
          syncHudNow();
        } else if (matchesModNegKey('MAGNET_COUPLER', 'KeyL')) {
          curRig.toggleMagnetCoupler('REPEL');
          syncHudNow();
        }
        if (matchesModPosKey('SMOKE_FLARE', 'KeyI')) {
          curRig.deploySmokeAndFlares();
          syncHudNow();
        }
      }
      if (e.code === 'KeyF') {
        if (showFastTravelMapRef.current) {
          e.preventDefault();
          SoundFX.snap();
          setShowFastTravelMap(false);
          return;
        }
        if (sim.isBuildMode || sim.isWorldEditMode) {
          sim.focusBuildCamera();
        } else {
          const curRig = sim.getActiveRig();
          const vehicleUsesKeyF =
            !sim.isWalking &&
            sim.isSeatedInRig &&
            curRig.modules.some((m) => {
              if (m.config?.disabled) return false;
              const isWeapon =
                m.kind === 'PLASMA_CANNON' ||
                m.kind === 'WEAPON_MINIGUN' ||
                m.kind === 'WEAPON_ROCKET' ||
                m.kind === 'WEAPON_BOMB_BAY';
              const pKey = m.config?.posKey || (isWeapon ? 'KeyF' : '');
              const nKey = m.config?.negKey || '';
              return pKey === 'KeyF' || nKey === 'KeyF';
            });
          if (!vehicleUsesKeyF) {
            e.preventDefault();
            if (document.pointerLockElement) document.exitPointerLock?.();
            SoundFX.snap();
            sim.initTacticalMapCam();
            setShowFastTravelMap(true);
          }
        }
      }
      if (e.code === 'KeyC') sim.cycleCameraMode();
      if (e.code === 'KeyV') {
        if (sim.isBuildMode) {
          sim.cyclePlacementMode();
        } else {
          sim.toggleManualSlowMo();
        }
      }
      if (e.code === 'KeyO') {
        if (document.pointerLockElement) document.exitPointerLock?.();
        setShowGarageModal((v) => !v);
      }
      if (e.code === 'KeyM') {
        if (sim.isBuildMode) {
          sim.cycleSymmetryAxisMode();
        } else {
          if (document.pointerLockElement) document.exitPointerLock?.();
          setShowMultiplayerModal((v) => !v);
        }
      }
      if (e.code === 'KeyN' && sim.isBuildMode) {
        sim.toggleForcesOverlay();
      }
      if (e.code === 'KeyR') {
        if (sim.isBuildMode || sim.isWorldEditMode) {
          if (sim.isBuildMode && sim.selectedBuildObjects.length > 0) {
            sim.rotateSelectedObject('yaw');
          } else {
            sim.rotatePartAxis('yaw');
          }
        } else if (!sim.isSeatedInRig && sim.selectedSlot >= 4 && sim.selectedSlot <= 8) {
          // Field Welder & Builder: cycle stamp shape (1x1, Wall 5x4, Ramp 4x4, Floor 5x5, Pillar 1x6)
          const nextSlot = sim.selectedSlot >= 8 ? 4 : sim.selectedSlot + 1;
          sim.selectSlot(nextSlot);
          SoundFX.snap();
        } else {
          // Pressing R: start hold timer
          // Quick tap (<500ms) = call and upright vehicle without repairing
          // Long press (>=500ms) = fully repair vehicle + upright + summon
          rHoldStartTimeRef.current = performance.now();
          rLongPressFiredRef.current = false;
          setRHoldProgress(0.01);
        }
      }
      // Continuous & custom-bound modules (HEADLIGHT, GYRO, PISTON, PARACHUTE_AIRBRAKE, OUTRIGGER_JACK)
      // are evaluated per-module in vehicle.updatePhysics via evalModSignal() so custom keybinds and toggleMode work seamlessly.
      if (e.code === 'KeyP') sim.selectPreset(sim.getActiveRig().presetIndex + 1);
      if (e.code === 'F3') {
        e.preventDefault();
        const nextRad = world.cycleRadiusMode();
        sim.setRenderDistance(nextRad);
        syncHudNow();
      }
      if (e.code === 'F4') {
        e.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock?.();
        setModStudioFeedback('');
        setShowModStudioModal((v) => !v);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      sim.keys[e.code] = false;
      if (e.code === 'KeyZ' && !sim.isBuildMode) {
        if (
          sim.isZoomed &&
          sim.zKeyDownTimeMs > 0 &&
          performance.now() - sim.zKeyDownTimeMs > 280
        ) {
          sim.toggleZoom(false);
        }
        sim.zKeyDownTimeMs = 0;
      }
      if (e.code === 'KeyR') {
        if (rHoldStartTimeRef.current !== null) {
          const elapsed = performance.now() - rHoldStartTimeRef.current;
          if (!rLongPressFiredRef.current && elapsed < 500) {
            sim.callAndUprightRig();
          }
          rHoldStartTimeRef.current = null;
          rLongPressFiredRef.current = false;
          setRHoldProgress(0);
        }
      }
    };

    const clearAllInputs = () => {
      for (const k in sim.keys) sim.keys[k] = false;
      sim.isOrbitDragging = false;
      sim.isLeftMouseDown = false;
      sim.isRightMouseDown = false;
      sim.dragStartVoxel = null;
      rHoldStartTimeRef.current = null;
      rLongPressFiredRef.current = false;
      setRHoldProgress(0);
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      graphicsPipeline.resizeTargets(
        window.innerWidth,
        window.innerHeight,
        renderer.getPixelRatio(),
      );
      const pR: THREE.WebGLRenderer | null = previewOverlayRenderer;
      if (pR) {
        pR.setSize(window.innerWidth, window.innerHeight);
      }
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mousedown', onCanvasMouseDown);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearAllInputs);
    window.addEventListener('resize', onResize);

    let animId = 0;
    let lastTime = performance.now();
    let frames = 0;
    const vehicleBroadphase = new SpatialHashBroadphase();
    const FIXED_DT = PHYSICS_FIXED_DT; // 1 / 60 (60 Hz single-frame physics via VoxelWorld.step)
    const FRAME_DELTA_WINDOW = 60;
    const frameDeltasRing = new Float32Array(FRAME_DELTA_WINDOW);
    let frameDeltasIdx = 0;
    let frameDeltasCount = 0;
    let frameDeltasSum = 0;
    let currentFps = 60;
    let currentFrameMs = '16.6';
    let currentRayLabel = 'Driving Rig';
    let hudSyncAccum = 0;
    let caveSampleTick = 0;
    let cachedTargetCaveFactor = 0;
    let lastTrackedDamagedBlocks = 0;
    let challengeSecondAccum = 0;
    const emptyKeys: Record<string, boolean> = {};

    const surfaceSkyColor = new THREE.Color(0x5b9bd5);
    const caveSkyColor = new THREE.Color(0x070b14);
    const surfaceFogColor = new THREE.Color(0x6ab4e8);
    const caveFogColor = new THREE.Color(0x080f1d);
    const deepOceanFogColor = new THREE.Color(0x040e20);
    const underwaterCameraFogColor = new THREE.Color(0x0c4564);
    const surfaceHemiSky = new THREE.Color(0x87a8c8);
    const caveHemiSky = new THREE.Color(0x16253b);
    const surfaceHemiGround = new THREE.Color(0x2d3b45);
    const caveHemiGround = new THREE.Color(0x050911);

    let impactSlowMoRemainingSec = 0;
    let impactSlowMoCooldownSec = 0;
    const aiConvoyWaypoints = [
      { x: 22, z: 22 },
      { x: -18, z: 22 },
      { x: -18, z: -26 },
      { x: 22, z: -26 },
    ];
    let aiConvoyWaypointIdx = 0;
    let aiConvoySpawnCooldown = 0;
    let lastRHoldStep = -1;

    const aiTerrainProber: TerrainProber = {
      sampleGroundY: (wx, wy, wz) =>
        world.probeGroundBelow(wx, wy, wz, 14).y,
      isWaterAt: (wx, wy, wz) => world.isWaterAt(wx, wy, wz),
      hasLineOfSight: (ax, ay, az, bx, by, bz) => {
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 2.2) return true;
        _rayOriginTmp.set(ax, ay, az);
        _rayDirTmp.set(dx / dist, dy / dist, dz / dist);
        const hit = world.raycastWorldVoxels(
          _rayOriginTmp,
          _rayDirTmp,
          dist - 1.5,
          1.2,
        );
        return !hit || hit.distance >= dist - 1.5;
      },
      raycastObstacle: (ox, oy, oz, dx, dy, dz, maxDist) => {
        _rayOriginTmp.set(ox, oy, oz);
        _rayDirTmp.set(dx, dy, dz);
        let bestDist: number | null = null;
        const hit = world.raycastWorldVoxels(
          _rayOriginTmp,
          _rayDirTmp,
          maxDist,
          0.35,
        );
        if (hit && (hit.mat & 63) !== MAT.WATER_VOX) {
          bestDist = hit.distance;
        }
        if (fx.mapHazards.length > 0) {
          const hazLimit = bestDist !== null ? bestDist : maxDist;
          const hazHit = raycastAllMapHazards(
            fx.mapHazards,
            _rayOriginTmp,
            _rayDirTmp,
            hazLimit,
          );
          if (
            hazHit &&
            hazHit.distance >= 0.35 &&
            (bestDist === null || hazHit.distance < bestDist)
          ) {
            bestDist = hazHit.distance;
          }
        }
        const invDx = Math.abs(dx) > 1e-6 ? 1 / dx : 1e9;
        const invDy = Math.abs(dy) > 1e-6 ? 1 / dy : 1e9;
        const invDz = Math.abs(dz) > 1e-6 ? 1 / dz : 1e9;
        for (let rIdx = 0; rIdx < sim.creations.length; rIdx++) {
          const ent = sim.creations[rIdx];
          if (!ent || !ent.isVoxelEntity || ent.inBuildMode) continue;
          if (!ent.propRigidBody?.isStatic && ent.totalMass < 180) continue;
          const min = ent.aabbMin;
          const max = ent.aabbMax;
          if (oy < min.y - 0.1 || oy > max.y + 0.1) continue;
          const tx1 = (min.x - ox) * invDx;
          const tx2 = (max.x - ox) * invDx;
          const tz1 = (min.z - oz) * invDz;
          const tz2 = (max.z - oz) * invDz;
          const ty1 = (min.y - oy) * invDy;
          const ty2 = (max.y - oy) * invDy;
          const tmin = Math.max(
            Math.min(tx1, tx2),
            Math.min(ty1, ty2),
            Math.min(tz1, tz2),
          );
          const tmax = Math.min(
            Math.max(tx1, tx2),
            Math.max(ty1, ty2),
            Math.max(tz1, tz2),
          );
          if (tmax >= 0.35 && tmin <= tmax && tmin <= maxDist) {
            const d = Math.max(0.35, tmin);
            if (bestDist === null || d < bestDist) bestDist = d;
          }
        }
        return bestDist;
      },
    };

    let isDisposed = false;
    let softwareGlYieldTimer: ReturnType<typeof setTimeout> | null = null;
    let perfOverlayAccumSec = 0;
    const stepFrame = (now = performance.now()) => {
      perfProfiler.beginFrame();

      // Native VSync pacing without dropping 60Hz ticks that arrive at 15.8ms-15.95ms due to browser timer jitter
      const deltaMs = now - lastTime;
      if (deltaMs < 1.0) {
        return;
      }
      const rawDt = deltaMs / 1000;
      lastTime = now;

      // O(1) circular ring-buffer rolling-average FPS over 60-frame window (zero array shifting / allocation)
      if (frameDeltasCount < FRAME_DELTA_WINDOW) {
        frameDeltasRing[frameDeltasIdx] = deltaMs;
        frameDeltasSum += deltaMs;
        frameDeltasCount++;
      } else {
        frameDeltasSum -= frameDeltasRing[frameDeltasIdx];
        frameDeltasRing[frameDeltasIdx] = deltaMs;
        frameDeltasSum += deltaMs;
      }
      frameDeltasIdx = (frameDeltasIdx + 1) % FRAME_DELTA_WINDOW;
      const avgMs = frameDeltasSum / Math.max(1, frameDeltasCount);
      currentFps = Math.max(1, Math.min(240, Math.round(1000 / Math.max(0.001, avgMs))));
      currentFrameMs = avgMs.toFixed(1);

      const govStep = stepFrameGovernor(
        sim.frameGovernorState,
        rawDt,
        sim.frameGovernorConfig,
      );
      sim.lastGovernorStep = govStep;
      const dt = govStep.visualDt;
      frames++;

      const curRig = sim.getActiveRig();

      // Full-screen map [F] runs real 2.5D tactical world camera across the live 3D world
      // Takes priority over title/paused loops so opening the map stops all physics/gameplay and focuses 100% on fast chunk rendering
      if (showFastTravelMapRef.current && !teleportStateRef.current.activeSpinup) {
        ProceduralAudio.silenceContinuous();
        sim.updateTacticalMapCamera(dt);
        if (scene.background instanceof THREE.Color) {
          scene.background.setHex(0x16222f);
        }
        if (scene.fog instanceof THREE.FogExp2) {
          scene.fog.color.setHex(0x16222f);
          scene.fog.density = 0.00012;
        }
        // Map mode fast loading: stream top-visible-layer chunks within an 11ms budget for locked 60 FPS
        world.updateChunksAndVisibility(
          sim.tacticalMapCam.x,
          sim.tacticalMapCam.z,
          curRig.rawFaces,
          curRig.mergedQuads,
          camera,
          11.0,
          24,
          true,
        );
        renderer.render(scene, camera);
        return;
      }

      if (sim.tacticalGridMesh.visible) {
        sim.tacticalGridMesh.visible = false;
      }

      if (sim.gameState === 'title') {
        ProceduralAudio.silenceContinuous();
        sim.titleOrbitAngle += dt * 0.22;
        const radius = 24.5;
        camera.position.set(
          curRig.position.x + Math.sin(sim.titleOrbitAngle) * radius,
          curRig.position.y + 8.5 + Math.sin(sim.titleOrbitAngle * 1.4) * 1.2,
          curRig.position.z - Math.cos(sim.titleOrbitAngle) * radius,
        );
        camera.lookAt(
          curRig.position.x,
          curRig.position.y + 1.4,
          curRig.position.z + 5.0,
        );
        world.updateChunksAndVisibility(
          curRig.position.x,
          curRig.position.z,
          curRig.rawFaces,
          curRig.mergedQuads,
          camera,
          govStep.watchdog.chunkBudgetMs,
          govStep.watchdog.maxSyncChunkRebuilds,
        );
        (renderer as unknown as { cameraBigSector: BigSectorPosition }).cameraBigSector =
          createBigSectorPosition(camera.position.x, camera.position.y, camera.position.z);
        renderer.render(scene, camera);
        return;
      }

      if (sim.gameState === 'paused') {
        ProceduralAudio.silenceContinuous();
        clearPreviewOverlay();
        (renderer as unknown as { cameraBigSector: BigSectorPosition }).cameraBigSector =
          createBigSectorPosition(camera.position.x, camera.position.y, camera.position.z);
        renderer.render(scene, camera);
        return;
      }

      // Screenshot Mode [F12]: Freezes physics simulation, hides UI, and lets player orbit/zoom camera around their build
      if (isScreenshotModeRef.current) {
        ProceduralAudio.silenceContinuous();
        if (sim.keys['ArrowLeft'] || sim.keys['KeyA']) {
          sim.driveYawOffset += 1.6 * dt;
          sim.camYaw += 1.6 * dt;
        }
        if (sim.keys['ArrowRight'] || sim.keys['KeyD']) {
          sim.driveYawOffset -= 1.6 * dt;
          sim.camYaw -= 1.6 * dt;
        }
        if (sim.keys['ArrowUp'] || sim.keys['KeyW']) {
          sim.drivePitchOffset = Math.min(1.25, sim.drivePitchOffset + 1.1 * dt);
        }
        if (sim.keys['ArrowDown'] || sim.keys['KeyS']) {
          sim.drivePitchOffset = Math.max(-0.15, sim.drivePitchOffset - 1.1 * dt);
        }
        sim.updateCamera(dt, now);
        blobShadowManager.commit();
        (renderer as unknown as { cameraBigSector: BigSectorPosition }).cameraBigSector =
          createBigSectorPosition(camera.position.x, camera.position.y, camera.position.z);
        graphicsPipeline.render(
          sim.graphicsSettings,
          now * 0.001,
          curRig.position,
          0,
          0,
          isHeadless,
        );
        return;
      }

      // Hold [R] to fully repair vehicle accumulator
      if (rHoldStartTimeRef.current !== null && !rLongPressFiredRef.current) {
        const elapsed = now - rHoldStartTimeRef.current;
        const progress = Math.min(1.0, elapsed / 500);
        const stepQuant = Math.round(progress * 20);
        if (stepQuant !== lastRHoldStep) {
          lastRHoldStep = stepQuant;
          setRHoldProgress(progress);
        }
        if (progress >= 1.0) {
          rLongPressFiredRef.current = true;
          lastRHoldStep = -1;
          sim.flipSummonRig();
          setRHoldProgress(0);
        }
      } else if (lastRHoldStep !== -1) {
        lastRHoldStep = -1;
      }

      // Track vehicle combat damage for the 5-second Fast-Travel combat lock
      if (curRig.damagedBlockCount > lastTrackedDamagedBlocks) {
        const nextTp = recordCombatDamage(teleportStateRef.current, Date.now());
        teleportStateRef.current = nextTp;
        setTeleportState(nextTp);
      }
      lastTrackedDamagedBlocks = curRig.damagedBlockCount;

      // Step 1.0-second Teleport Engine Spinup (cancels if player moves or takes combat damage)
      if (teleportStateRef.current.activeSpinup) {
        const isMovingDuringSpinup = Boolean(
          sim.keys['KeyW'] ||
            sim.keys['KeyS'] ||
            sim.keys['KeyA'] ||
            sim.keys['KeyD'] ||
            Math.abs(curRig.speedKmh) > 6,
        );
        const curPos = sim.isSeatedInRig ? curRig.position : sim.camFreePos;
        const spinRes = stepTeleportSpinup(
          teleportStateRef.current,
          dt,
          { x: curPos.x, y: curPos.y, z: curPos.z },
          isMovingDuringSpinup,
        );
        teleportStateRef.current = spinRes.state;
        setTeleportState(spinRes.state);
        if (spinRes.cancelled) {
          SoundFX.clank();
        } else if (spinRes.completedNode) {
          const targetNode = spinRes.completedNode;
          if (sim.isSeatedInRig) {
            curRig.summonTo(targetNode.x, targetNode.z, 0);
            curRig.position.y = Math.max(curRig.position.y, targetNode.y + 1.2);
            curRig.syncVisualTransform();
          } else {
            sim.camFreePos.set(targetNode.x, targetNode.y + 1.8, targetNode.z);
          }
          fx.spawnWeldSparks(targetNode.x, targetNode.y + 1.2, targetNode.z);
          SoundFX.snap();
          setShowFastTravelMap(false);
        }
      }

      // Render 3D Teleport Beacon pillars in the world
      ModRegistry.syncTeleportBeacons3D(
        teleportStateRef.current.nodes,
        now * 0.001,
      );

      // Step Active Game Mode Systems (Destruction Derby, Building Challenge, CTF, Build Battle, Survival Waves)
      const activeModeId = ModRegistry.activeGameModeId;

      if (activeModeId === 'DESTRUCTION_DERBY') {
        if (!curRig.inBuildMode && curRig.speedKmh >= 16) {
          const fwd = _derbyFwdTmp
            .set(0, 0, 1)
            .applyQuaternion(curRig.quaternion);
          const ramX = curRig.position.x + fwd.x * 2.4;
          const ramY = curRig.position.y + 0.6;
          const ramZ = curRig.position.z + fwd.z * 2.4;
          if (world.isSolidAtWorld(ramX, ramY, ramZ)) {
            fx.carveWorldCrater(ramX, ramY, ramZ, 4, 0, true);
          }
        }
        const prevDerby = derbyStateRef.current;
        const nextDerby = stepDestructionDerby(
          prevDerby,
          dt,
          fx.voxelsDestroyedCount,
        );
        derbyStateRef.current = nextDerby;
        if (
          Math.ceil(nextDerby.remainingSec) !== Math.ceil(prevDerby.remainingSec) ||
          nextDerby.scoreVoxelsDestroyed !== prevDerby.scoreVoxelsDestroyed ||
          nextDerby.finished !== prevDerby.finished
        ) {
          setDerbyState(nextDerby);
        }
      } else if (activeModeId === 'BUILDING_CHALLENGE') {
        const testMetrics = buildingChallengeTestMetricsRef.current;
        if (testMetrics.active) {
          testMetrics.remainingSec -= dt;
          if (curRig.speedKmh > testMetrics.peakSpeedKmh) {
            testMetrics.peakSpeedKmh = curRig.speedKmh;
          }
          if (testMetrics.remainingSec <= 0) {
            testMetrics.active = false;
            setBuildingChallengeTesting(false);
            const promptDef =
              BUILDING_CHALLENGE_PROMPTS[testMetrics.promptIdx] ||
              BUILDING_CHALLENGE_PROMPTS[0];
            const distDriven = Math.hypot(
              curRig.position.x - testMetrics.startPos.x,
              curRig.position.z - testMetrics.startPos.z,
            );
            const evalRes = evaluateBuildingChallengeResult(promptDef.id, {
              totalBlocks: curRig.voxelCount + curRig.modules.length,
              hasIntactSeat: curRig.hasIntactSeat(),
              structuralIntegrityPct: curRig.structuralIntegrityPct,
              installedModuleKinds: curRig.modules.map((m) => m.kind),
              peakSpeedKmh: Math.max(testMetrics.peakSpeedKmh, curRig.speedKmh),
              distanceTravelledMeters: distDriven,
            });
            let snapshotUrl = '';
            try {
              renderer.render(scene, camera);
              snapshotUrl = renderer.domElement.toDataURL('image/jpeg', 0.72);
            } catch {
              snapshotUrl = '';
            }
            SoundFX.snap();
            setBuildingChallengeResult({
              evalResult: evalRes,
              photoDataUrl: snapshotUrl,
              promptTitle: promptDef.title,
            });
          }
        } else {
          challengeSecondAccum += dt;
          if (challengeSecondAccum >= 1.0) {
            challengeSecondAccum -= 1.0;
            setBuildingChallengeTimerSec((prev) => Math.max(0, prev - 1));
          }
        }
      } else if (activeModeId === 'CAPTURE_THE_FLAG') {
        const prevCtf = ctfStateRef.current;
        const ctfRes = stepCtfPlayerPosition(prevCtf, {
          x: curRig.position.x,
          y: curRig.position.y,
          z: curRig.position.z,
        });
        ctfStateRef.current = ctfRes.state;
        if (ctfRes.event !== 'NONE') {
          SoundFX.snap();
          setCtfState(ctfRes.state);
        }
        ModRegistry.syncCtfVisuals3D(ctfStateRef.current, curRig.position);
      } else if (activeModeId === 'BUILD_BATTLE') {
        const prevBb = buildBattleStateRef.current;
        if (prevBb.phase === 'BUILD') {
          const nextRemaining = Math.max(0, prevBb.buildRemainingSec - dt);
          if (nextRemaining <= 0) {
            const launched = launchBuildBattleArena(prevBb);
            buildBattleStateRef.current = launched;
            setBuildBattleState(launched);
            sim.toggleHoverBuildMode(false);
          } else {
            const updatedBb = { ...prevBb, buildRemainingSec: nextRemaining };
            buildBattleStateRef.current = updatedBb;
            if (Math.ceil(nextRemaining) !== Math.ceil(prevBb.buildRemainingSec)) {
              setBuildBattleState(updatedBb);
            }
          }
        } else if (prevBb.phase === 'ARENA_COMBAT') {
          const nextContenders = prevBb.contenders.map((c, idx) => {
            if (!c.isPlayer && c.alive) {
              const angle = now * 0.0012 + idx * 2.1;
              const nx = Math.cos(angle) * 14;
              const nz = 12 + Math.sin(angle) * 14;
              const distToPlayer = Math.hypot(nx - curRig.position.x, nz - curRig.position.z);
              const ramDmg = distToPlayer < 4.5 && curRig.speedKmh > 15 ? 38 * dt : 8 * dt;
              const nextHp = Math.max(0, c.hp - ramDmg);
              return {
                ...c,
                x: nx,
                z: nz,
                hp: nextHp,
                alive: nextHp > 0,
              };
            }
            if (c.isPlayer) {
              const alive = curRig.hasIntactSeat() && curRig.structuralIntegrityPct > 20;
              return {
                ...c,
                x: curRig.position.x,
                y: curRig.position.y,
                z: curRig.position.z,
                hp: curRig.structuralIntegrityPct,
                alive,
              };
            }
            return c;
          });
          const aliveList = nextContenders.filter((c) => c.alive);
          const nextPhase: BuildBattleState['phase'] =
            aliveList.length <= 1 ? 'VICTORY' : 'ARENA_COMBAT';
          const nextWinner =
            nextPhase === 'VICTORY'
              ? aliveList[0]?.name || 'Pilot_01 (You)'
              : null;
          const updatedBb: BuildBattleState = {
            ...prevBb,
            phase: nextPhase,
            combatElapsedSec: prevBb.combatElapsedSec + dt,
            contenders: nextContenders,
            winnerName: nextWinner,
          };
          buildBattleStateRef.current = updatedBb;
          if (nextPhase !== prevBb.phase || (frames & 7) === 0) {
            setBuildBattleState(updatedBb);
          }
        }
        ModRegistry.syncBuildBattleContenders3D(buildBattleStateRef.current);
      } else if (activeModeId === 'SURVIVAL_WAVES' || activeModeId === 'JUGGERNAUT_BOSS') {
        const prevSurv = survivalStateRef.current;
        const survRes = stepSurvivalWaves(
          prevSurv,
          dt,
          { x: curRig.position.x, y: curRig.position.y, z: curRig.position.z },
          curRig.speedKmh,
          curRig.structuralIntegrityPct,
          curRig.hasIntactSeat(),
        );
        survivalStateRef.current = survRes.state;
        if (survRes.playerHitCount > 0) {
          SoundFX.clank();
          const nextTp = recordCombatDamage(teleportStateRef.current, Date.now());
          teleportStateRef.current = nextTp;
          setTeleportState(nextTp);
        }
        if (survRes.waveCleared) {
          SoundFX.snap();
        }
        if (
          survRes.playerHitCount > 0 ||
          survRes.waveCleared ||
          survRes.state.isGameOver !== prevSurv.isGameOver ||
          survRes.state.enemies.length !== prevSurv.enemies.length ||
          (frames & 7) === 0
        ) {
          setSurvivalState(survRes.state);
        }
        ModRegistry.syncSurvivalEnemies3D(survivalStateRef.current);
      } else if (activeModeId === 'KING_OF_THE_HILL') {
        const prevKoth = kingOfHillStateRef.current;
        const nextKoth = stepKingOfTheHill(prevKoth, dt, {
          x: curRig.position.x,
          y: curRig.position.y,
          z: curRig.position.z,
        });
        kingOfHillStateRef.current = nextKoth;
        if (
          Math.floor(nextKoth.playerControlPct) !== Math.floor(prevKoth.playerControlPct) ||
          nextKoth.playerInZone !== prevKoth.playerInZone ||
          nextKoth.winner !== prevKoth.winner
        ) {
          setKingOfHillState(nextKoth);
        }
      } else if (activeModeId === 'STUNT_FREESTYLE') {
        const prevStunt = stuntFreestyleStateRef.current;
        const isAirborne = curRig.statusLabel.includes('AIR');
        const angSpd = curRig.angularVelocity.length();
        const nextStunt = stepStuntFreestyle(
          prevStunt,
          dt,
          isAirborne,
          curRig.speedKmh,
          angSpd,
        );
        stuntFreestyleStateRef.current = nextStunt;
        if (
          Math.ceil(nextStunt.remainingSec) !== Math.ceil(prevStunt.remainingSec) ||
          nextStunt.totalScore !== prevStunt.totalScore ||
          nextStunt.finished !== prevStunt.finished
        ) {
          setStuntFreestyleState(nextStunt);
        }
      } else {
        ModRegistry.syncCtfVisuals3D(null, curRig.position);
        ModRegistry.syncSurvivalEnemies3D(null);
        ModRegistry.syncBuildBattleContenders3D(null);
      }

      // Step 1.4: Fixed 60Hz physics timestep integrator with render interpolation
      if (!impactSlowMoEnabledRef.current) {
        impactSlowMoRemainingSec = 0;
        worldArenaSystems.slowMoRemainingSec = 0;
        worldArenaSystems.timeScale = 1.0;
      } else {
        if (impactSlowMoRemainingSec > 0) {
          impactSlowMoRemainingSec = Math.max(0, impactSlowMoRemainingSec - rawDt);
        }
      }
      if (impactSlowMoCooldownSec > 0) {
        impactSlowMoCooldownSec = Math.max(0, impactSlowMoCooldownSec - rawDt);
      }
      worldArenaSystems.autoSlowMoOnCrash = impactSlowMoEnabledRef.current;
      const crashCamScale = impactSlowMoEnabledRef.current
        ? Math.min(
            impactSlowMoRemainingSec > 0 ? 0.32 : 1.0,
            worldArenaSystems.timeScale,
          )
        : 1.0;
      const effectiveTimeScale =
        fx.hitstopTimer > 0 ? 0 : govStep.timeScale * crashCamScale;
      const effectiveSimDt =
        fx.hitstopTimer > 0 ? 0 : govStep.simDt * crashCamScale;
      const pairImpulseMap =
        ((sim as unknown as { _pairColMs?: Map<string, number> })._pairColMs ??=
          new Map<string, number>());

      // Apply Weather Preset grip & wave multiplier and Turret Camera-Aim setting
      const activeWeather = weatherPresetRef.current;
      const targetGrip =
        activeWeather === 'ARCTIC_ICE'
          ? 0.45
          : activeWeather === 'STORMY_OCEAN'
            ? 0.78
            : 1.0;
      const targetWaveMult =
        activeWeather === 'STORMY_OCEAN'
          ? 2.25
          : activeWeather === 'ARCTIC_ICE'
            ? 0.65
            : 1.0;
      world.setWeatherWaveMultiplier(targetWaveMult);
      for (let i = 0; i < sim.creations.length; i++) {
        sim.creations[i].weatherGripMult = targetGrip;
        sim.creations[i].turretCameraAimEnabled = turretCamAimEnabledRef.current;
      }

      // Autonomous AI Patrol / Convoy Rigs in the Proving Grounds
      if (aiTrafficEnabledRef.current && !sim.isBuildMode) {
        const existingAi = sim.creations.find((c) => c.networkId === 'ai-patrol-convoy-1');
        if (!existingAi || existingAi.voxelCount < 12) {
          aiConvoySpawnCooldown -= rawDt;
          if (aiConvoySpawnCooldown <= 0) {
            aiConvoySpawnCooldown = 10.0;
            if (existingAi) {
              const idx = sim.creations.indexOf(existingAi);
              if (idx > 0) {
                existingAi.dispose();
                sim.creations.splice(idx, 1);
                setCreationsCountState(sim.creations.length);
              }
            }
            const aiRig = new ModularVehicleRig(scene, world, fx);
            aiRig.loadPreset(0);
            aiRig.customBlueprintName = 'AI Patrol Convoy';
            aiRig.assignNetworkIdentity('ai-convoy', 'ai-patrol-convoy-1', false);
            aiRig.summonTo(22, 22, Math.PI);
            aiRig.setPotatoShaderMode(sim.graphicsSettings.usePotatoShader);
            if (sim.graphicsSettings.useCartoonShader) {
              aiRig.setCartoonShaderMode(true);
            }
            aiRig.setBlobShadowVisible(sim.graphicsSettings.blobShadows);
            sim.creations.push(aiRig);
            setCreationsCountState(sim.creations.length);
          }
        }
      } else {
        const existingAiIdx = sim.creations.findIndex((c) => c.networkId === 'ai-patrol-convoy-1');
        if (existingAiIdx > 0 && sim.activeCreationIndex !== existingAiIdx) {
          sim.creations[existingAiIdx].dispose();
          sim.creations.splice(existingAiIdx, 1);
          setCreationsCountState(sim.creations.length);
        }
      }

      const _tPhys0 = performance.now();
      const isLowEndPhysicsCap =
        sim.graphicsSettings.usePotatoShader ||
        sim.graphicsSettings.preset === 'PENTIUM';
      const physicsStepsThisFrame = world.voxelWorld.step(rawDt, {
        timeScale: effectiveTimeScale,
        maxSubsteps: isLowEndPhysicsCap
          ? rawDt > 0.032
            ? 1
            : Math.min(2, PHYSICS_CONFIG.maxStepsPerFrame)
          : PHYSICS_CONFIG.maxStepsPerFrame,
        drainEvents: true,
        onFixedStep: (stepDt) => {
          resetUnifiedEngineFrameTelemetry();
          const prevRigX = curRig.position.x;
          const prevRigZ = curRig.position.z;
          const observerWorldX = sim.isWalking ? sim.camFreePos.x : curRig.position.x;
          const observerWorldZ = sim.isWalking ? sim.camFreePos.z : curRig.position.z;
          const zoomFocusPt = sim.isZoomed ? world.zoomFocusWorld : null;
          const physTickCounter =
            (((sim as unknown as { _physLodTick?: number })._physLodTick =
              ((sim as unknown as { _physLodTick?: number })._physLodTick ?? 0) + 1));
          const activeFlarePos =
            fx.activeFlares.length > 0
              ? fx.activeFlares[fx.activeFlares.length - 1].pos
              : null;
          const allStepPhysicsRigs = sim.getAllPhysicsRigs();

          for (let i = 0; i < sim.creations.length; i++) {
            const c = sim.creations[i];
            const isCurrentActive =
              (!sim.isWalking && sim.activeVehicle === c) ||
              (sim.isBuildMode && i === sim.activeCreationIndex);
            const isLocalDriver =
              isCurrentActive &&
              !sim.isBuildMode &&
              sim.isSeatedInRig &&
              !c.isRemoteControlled;

            const vehLodDecision = classifyEntityPhysicsLodTier({
              entityX: c.position.x,
              entityZ: c.position.z,
              playerX: observerWorldX,
              playerZ: observerWorldZ,
              isActivePlayerEntity: isCurrentActive || isLocalDriver || c.isRemoteControlled,
              hasUrgentPhysicsActivity:
                c.ignitedC4Voxels.size > 0 ||
                c.fallingOffVoxels.size > 0 ||
                c.pendingPhysicsHullRebuild,
              isOpticalZoomActive: sim.isZoomed,
              zoomFocusX: zoomFocusPt ? zoomFocusPt.x : null,
              zoomFocusZ: zoomFocusPt ? zoomFocusPt.z : null,
            });

            if (vehLodDecision.tier === 'FULL_60HZ_LOD0') {
              unifiedEngineTelemetry.lod0PhysicsEntities++;
              if (vehLodDecision.promotedByOpticalZoom) {
                unifiedEngineTelemetry.lodZoomPromotedEntities++;
              }
            } else {
              unifiedEngineTelemetry.lodThrottledPhysicsEntities++;
              if (
                vehLodDecision.frameStride === 0 &&
                !c.aiConfig.enabled &&
                c.networkId !== 'ai-patrol-convoy-1' &&
                c.velocity.lengthSq() < 0.05
              ) {
                continue;
              }
              if (
                vehLodDecision.frameStride > 1 &&
                (physTickCounter + i) % vehLodDecision.frameStride !== 0
              ) {
                continue;
              }
            }
            const effectiveVehStepDt =
              vehLodDecision.frameStride > 1
                ? Math.min(0.05, stepDt * vehLodDecision.frameStride)
                : stepDt;

            let rigKeys = isLocalDriver ? sim.keys : emptyKeys;
            let rigActiveInput = isLocalDriver;
            let isAiPiloted = false;
            let aiMeleeStrike = false;

            if (!isLocalDriver && c.aiConfig.enabled && !c.inBuildMode && !c.isRemoteControlled) {
              const aiDecision = computeSmartVehicleAIControls(
                c,
                effectiveVehStepDt,
                allStepPhysicsRigs,
                sim.isSeatedInRig ? curRig : !curRig.aiConfig.enabled ? curRig : null,
                aiTerrainProber,
                activeFlarePos,
              );
              c.aiThrottleInput = aiDecision.throttle;
              c.aiSteerInput = aiDecision.steer;
              c.aiPitchInput = aiDecision.pitch;
              c.aiRollInput = aiDecision.roll;
              c.aiCollectiveInput = aiDecision.collective;
              c.aiBrakeInput = aiDecision.brake;
              c.gyroEnabled = aiDecision.enableGyro;
              if (c.pistonCount > 0) {
                c.pistonExtended = aiDecision.extendPistons;
              }
              c.aiConfig.statusLabel = aiDecision.statusLabel;
              c.aiConfig.activeStyleLabel = aiDecision.resolvedStyle;

              if (aiDecision.aimTargetWorld) {
                _aiAimTargetTmp.set(
                  aiDecision.aimTargetWorld.x,
                  aiDecision.aimTargetWorld.y,
                  aiDecision.aimTargetWorld.z,
                );
                c.aimTurretsAt(_aiAimTargetTmp, effectiveVehStepDt, true);
              }
              if (aiDecision.fireWeapons) {
                c.fireCannons();
              }
              if (aiDecision.selfRightImpulse) {
                c.callAndUprightTo(c.position.x, c.position.z);
              }
              if (aiDecision.detonateC4) {
                for (const [vk, mat] of c.voxelMap.entries()) {
                  if ((mat & 63) === MAT.C4_EXPLOSIVE) {
                    igniteC4Voxel(c, vk);
                    break;
                  }
                }
              }
              rigKeys = aiDecision.keys;
              rigActiveInput = false;
              isAiPiloted = true;
              aiMeleeStrike = aiDecision.triggerMeleeStrike;
            } else if (c.networkId === 'ai-patrol-convoy-1' && !isLocalDriver && aiTrafficEnabledRef.current) {
              const wp = aiConvoyWaypoints[aiConvoyWaypointIdx % aiConvoyWaypoints.length];
              const dx = wp.x - c.position.x;
              const dz = wp.z - c.position.z;
              const dist = Math.hypot(dx, dz);
              if (dist < 7.0) {
                aiConvoyWaypointIdx = (aiConvoyWaypointIdx + 1) % aiConvoyWaypoints.length;
              }
              const fwd = _convoyFwdTmp
                .set(0, 0, 1)
                .applyQuaternion(c.quaternion);
              const right = _convoyRightTmp
                .set(1, 0, 0)
                .applyQuaternion(c.quaternion);
              const toWpX = dx / Math.max(1, dist);
              const toWpZ = dz / Math.max(1, dist);
              const cross = right.x * toWpX + right.z * toWpZ;
              const dot = fwd.x * toWpX + fwd.z * toWpZ;
              rigKeys = {
                KeyW: dot > -0.25,
                KeyS: dot <= -0.25,
                KeyA: cross < -0.15,
                KeyD: cross > 0.15,
              };
              isAiPiloted = true;
            }
            const _tVehPhys0 = performance.now();
            c.updatePhysics(
              effectiveVehStepDt,
              rigKeys,
              rigActiveInput,
              isAiPiloted,
            );
            perfProfiler.recordVehiclePhysics(performance.now() - _tVehPhys0);
            if (!c.inBuildMode && (aiMeleeStrike || c.velocity.lengthSq() > 10.2)) {
              c.applyMeleeCombatStep(
                allStepPhysicsRigs,
                aiMeleeStrike,
                isAiPiloted ? c.aiConfig.team : 'PLAYER',
              );
            }

            // High-speed vehicle collision with Explosive Barrel Stashes
            if (!c.inBuildMode && c.speedKmh >= 15) {
              const hitBarrels = world.consumeTriggeredExplosiveBarrels(
                c.position.x,
                c.position.y,
                c.position.z,
                2.8,
              );
              const activeMode = ModRegistry.getActiveGameMode();
              const blastRad = Math.round(9 * activeMode.explosionMult);
              for (let bIdx = 0; bIdx < hitBarrels.length; bIdx++) {
                const hb = hitBarrels[bIdx];
                fx.carveWorldCrater(hb.wx, hb.wy, hb.wz, blastRad, 0, true);
                c.velocity.y += 9.5 * activeMode.explosionMult;
                if (activeMode.enableDemolitionScore) {
                  ModRegistry.demolitionScore += 250;
                }
              }
            }
          }

          // Step Dynamic Voxel Entities (physics cones, wooden crates, explosive barrels, stunt balls, barriers)
          for (let eIdx = 0; eIdx < sim.voxelEntities.length; eIdx++) {
            const ent = sim.voxelEntities[eIdx];
            if (ent.voxelCount <= 0) {
              ent.dispose();
              sim.voxelEntities.splice(eIdx, 1);
              eIdx--;
              continue;
            }
            const hasUrgentEntActivity =
              ent.fallingOffVoxels.size > 0 ||
              ent.ignitedC4Voxels.size > 0 ||
              ent.pendingPhysicsHullRebuild;
            if (
              ent.rigidBody.isSleeping &&
              !hasUrgentEntActivity &&
              ent.velocity.lengthSq() <= 0.001 &&
              ent.angularVelocity.lengthSq() <= 0.001
            ) {
              continue;
            }

            const entLodDecision = classifyEntityPhysicsLodTier({
              entityX: ent.position.x,
              entityZ: ent.position.z,
              playerX: observerWorldX,
              playerZ: observerWorldZ,
              isActivePlayerEntity: false,
              hasUrgentPhysicsActivity: hasUrgentEntActivity,
              isOpticalZoomActive: sim.isZoomed,
              zoomFocusX: zoomFocusPt ? zoomFocusPt.x : null,
              zoomFocusZ: zoomFocusPt ? zoomFocusPt.z : null,
            });

            if (entLodDecision.tier === 'FULL_60HZ_LOD0') {
              unifiedEngineTelemetry.lod0PhysicsEntities++;
              if (entLodDecision.promotedByOpticalZoom) {
                unifiedEngineTelemetry.lodZoomPromotedEntities++;
              }
            } else {
              unifiedEngineTelemetry.lodThrottledPhysicsEntities++;
              if (
                entLodDecision.frameStride === 0 &&
                ent.velocity.lengthSq() < 0.25
              ) {
                continue;
              }
              if (
                entLodDecision.frameStride > 1 &&
                (physTickCounter + eIdx) % entLodDecision.frameStride !== 0
              ) {
                continue;
              }
            }
            const effectiveEntStepDt =
              entLodDecision.frameStride > 1
                ? Math.min(0.05, stepDt * entLodDecision.frameStride)
                : stepDt;

            const _tEntPhys0 = performance.now();
            ent.updatePhysics(effectiveEntStepDt, emptyKeys, false);
            perfProfiler.recordVehiclePhysics(performance.now() - _tEntPhys0);
          }

          // Step Spinning Map Hazards (Saw Blades, Twin Industrial Shredders, Horizontal Reapers, Pendulum Blades)
          stepMapHazardsPhysics(
            sim.mapHazards,
            sim.creations,
            sim.voxelEntities,
            fx,
            stepDt,
          );

          const allPhysicsRigs = sim.getAllPhysicsRigs();

          // Tick Active Game Mode (Checkpoint Time Trial rings & Demolition Score)
          ModRegistry.tickGameMode(
            FIXED_DT,
            curRig.position,
            curRig.velocity,
            curRig.inBuildMode,
            () => {
              SoundFX.snap();
              syncHudNow();
            },
          );

          // Speed Trap Radar Gate crossing & Jump Airtime tracking
          if (!curRig.inBuildMode) {
            if (
              world.checkSpeedTrapCrossing(
                prevRigX,
                prevRigZ,
                curRig.position.x,
                curRig.position.z,
                curRig.position.y,
              )
            ) {
              sim.speedTrapLastKmh = curRig.speedKmh;
              if (curRig.speedKmh > sim.speedTrapMaxKmh) {
                sim.speedTrapMaxKmh = curRig.speedKmh;
              }
              SoundFX.snap();
            } else if (curRig.speedKmh > sim.speedTrapMaxKmh) {
              sim.speedTrapMaxKmh = curRig.speedKmh;
            }

            if (curRig.statusLabel === 'AIRBORNE' && curRig.speedKmh >= 10) {
              sim.currentAirtimeSec += FIXED_DT;
              if (sim.currentAirtimeSec > sim.maxAirtimeSec) {
                sim.maxAirtimeSec = sim.currentAirtimeSec;
              }
            } else {
              sim.currentAirtimeSec = 0;
            }
          }

          // Step C4 chain reactions across all vehicles AND Voxel Entities (e.g. Explosive C4 Barrels!)
          updateC4System(
            allPhysicsRigs,
            typeof performance !== 'undefined' ? performance.now() : Date.now(),
            fx.voxelDebrisSystem,
            (ev) => {
              sim.multiplayer?.broadcastC4Explosion(ev);
            },
          );

        },
        onResolveCollisions: () => {
          const allPhysicsRigs = sim.getAllPhysicsRigs();
          // Phase 2: Spatial Hash Broadphase (16m cells) + Per-Point vs Voxel-Grid Narrowphase + Per-Voxel HP Destruction
          // Runs across all vehicles AND Voxel Entities so vehicles collide with cones/crates/barrels and entities stack/collide!
          const _tColPass0 = performance.now();
          const phase2CollisionResults = stepAllVehicleCollisions(
            allPhysicsRigs,
            vehicleBroadphase,
            fx.voxelDebrisSystem,
          );
          perfProfiler.recordCollisionPass(performance.now() - _tColPass0);
          if (phase2CollisionResults.length > 0) {
            for (let rIdx = 0; rIdx < phase2CollisionResults.length; rIdx++) {
              const r = phase2CollisionResults[rIdx];
              if (r.contactCount > 0) {
                r.vehicleA.rigidBody.syncToVoxelWorld();
                r.vehicleB.rigidBody.syncToVoxelWorld();
              }
            }
            let totalVoxelHits = 0;
            let maxImpactImpulse = 0;
            let totalVoxelsDestroyed = 0;
            for (let rIdx = 0; rIdx < phase2CollisionResults.length; rIdx++) {
              const r = phase2CollisionResults[rIdx];
              totalVoxelHits += r.contactCount;
              if (r.maxImpulse > maxImpactImpulse) {
                maxImpactImpulse = r.maxImpulse;
              }
              totalVoxelsDestroyed += r.voxelsDestroyedOnA + r.voxelsDestroyedOnB;
            }
            if (totalVoxelHits > 0 && maxImpactImpulse > 220) {
              SoundFX.clank();
              fx.trauma = Math.min(
                0.65,
                fx.trauma + Math.min(0.25, maxImpactImpulse * 0.00015),
              );
              if (
                impactSlowMoEnabledRef.current &&
                impactSlowMoCooldownSec <= 0 &&
                totalVoxelsDestroyed >= 5 &&
                maxImpactImpulse > 360
              ) {
                impactSlowMoRemainingSec = 0.75;
                impactSlowMoCooldownSec = 4.0;
              }
            }
            if (
              totalVoxelsDestroyed > 0 &&
              sim.multiplayer &&
              sim.multiplayer.status === 'connected'
            ) {
              for (let vIdx = 0; vIdx < sim.creations.length; vIdx++) {
                const veh = sim.creations[vIdx];
                if (
                  veh.lastDamageImpactWorld &&
                  sim.multiplayer.hasLocalPhysicsAuthority(veh)
                ) {
                  sim.multiplayer.broadcastVehicleDamageCrater(
                    veh.networkId,
                    [
                      veh.lastDamageImpactWorld.x,
                      veh.lastDamageImpactWorld.y,
                      veh.lastDamageImpactWorld.z,
                    ],
                    0.55,
                  );
                  veh.lastDamageImpactWorld = null;
                }
              }
            }
          }
        },
      });
      const _tPhys1 = performance.now();

      // Update auxiliary visuals (shadows, headlights, AI badges) directly from VoxelWorld pose,
      // skipping unchanged/sleeping bodies completely (rootGroup reads VoxelWorld SoA directly in Object3D.updateMatrix).
      for (let i = 0; i < sim.creations.length; i++) {
        sim.creations[i].updateAuxiliaryVisuals();
      }
      for (let i = 0; i < sim.voxelEntities.length; i++) {
        const ent = sim.voxelEntities[i];
        if (!ent.rigidBody.isSleeping) {
          ent.updateAuxiliaryVisuals();
        }
      }

      // Update continuous Procedural Web Audio Engine (50Hz-320Hz engine + bandpass thruster roar)
      const isDrivingActive =
        !sim.isBuildMode &&
        !sim.isWorldEditMode &&
        !sim.isWalking &&
        sim.isSeatedInRig;
      const throttleInput = isDrivingActive
        ? (sim.keys['KeyW'] || sim.keys['ArrowUp'] ? 1 : 0) -
          (sim.keys['KeyS'] || sim.keys['ArrowDown'] ? 1 : 0)
        : 0;
      const thrusterOut =
        isDrivingActive &&
        curRig.thrusterCount > 0 &&
        (sim.keys['KeyW'] || sim.keys['ShiftLeft'])
          ? sim.keys['ShiftLeft']
            ? 1.0
            : 0.65
          : 0;
      ProceduralAudio.updateVehicleAudio(
        throttleInput,
        curRig.speedKmh,
        thrusterOut,
        curRig.isBoostingNow,
        isDrivingActive,
      );
      const ambientPlayerSpeedKmh = isDrivingActive
        ? curRig.speedKmh
        : Math.hypot(sim.playerVelY, sim.isWalking ? 24 : 0);
      const ambientAltitude = isDrivingActive
        ? curRig.position.y
        : sim.camFreePos.y;
      ProceduralAudio.updateAmbientAudio(
        dt,
        ambientPlayerSpeedKmh,
        ambientAltitude,
      );

      // Update camera controller target dynamically every frame (never static vehicles[0]!)
      sim.updateCamera(dt, now);

      // Aim vehicle weapon turrets toward camera crosshair target while driving
      if (
        !sim.isBuildMode &&
        !sim.isWorldEditMode &&
        sim.isSeatedInRig &&
        sim.activeVehicle &&
        turretCamAimEnabledRef.current &&
        (sim.activeVehicle.cannonCount > 0 ||
          sim.activeVehicle.modules.some((m) => m.kind === 'SERVO_SPIN'))
      ) {
        camera.getWorldDirection(_camFwdTmp);
        const wHit = world.raycastWorldVoxels(camera.position, _camFwdTmp, 95);
        const aimTarget = wHit
          ? wHit.worldPos
          : _desiredCamPosTmp.copy(camera.position).addScaledVector(_camFwdTmp, 65);
        sim.activeVehicle.aimTurretsAt(aimTarget, dt);
      }

      // Evaluate Active Proving Grounds Contraption & Delivery Mission
      if (activeMissionIdRef.current !== 'NONE' && !sim.isBuildMode) {
        const mId = activeMissionIdRef.current;
        if (mId === 'BRIDGE_CARGO') {
          const distToOutpost = Math.hypot(
            curRig.position.x - 76,
            curRig.position.z - 0,
          );
          if (
            distToOutpost <= 10.0 &&
            curRig.structuralIntegrityPct >= 70 &&
            !missionCompletedRef.current
          ) {
            missionCompletedRef.current = true;
            setMissionCompleted(true);
            SoundFX.snap();
            setMissionProgressText(
              `MISSION COMPLETE! Delivered intact rig (${curRig.structuralIntegrityPct}% hull) to East Canyon Outpost!`,
            );
          } else if (!missionCompletedRef.current && (frames & 7) === 0) {
            setMissionProgressText(
              `Objective: Cross East Suspension Bridge to (76, 0) with >=70% Hull · Dist: ${Math.round(distToOutpost)}m · Hull: ${curRig.structuralIntegrityPct}%`,
            );
          }
        } else if (mId === 'CATAPULT_CHANNEL') {
          const westDist = Math.max(0, Math.round(-curRig.position.x));
          if (curRig.position.x <= -95 && !missionCompletedRef.current) {
            missionCompletedRef.current = true;
            setMissionCompleted(true);
            SoundFX.snap();
            setMissionProgressText(
              `MISSION COMPLETE! Crossed West Ocean Channel past -95m!`,
            );
          } else if (!missionCompletedRef.current && (frames & 7) === 0) {
            setMissionProgressText(
              `Objective: Launch or Sail West past X = -95m across the Ocean · Current West Reach: ${westDist}m / 95m`,
            );
          }
        } else if (mId === 'SUBMARINE_TRENCH') {
          const depthBelowSea = WATER_LEVEL - curRig.position.y;
          if (depthBelowSea >= 9.0 && !missionCompletedRef.current) {
            missionCompletedRef.current = true;
            setMissionCompleted(true);
            SoundFX.snap();
            setMissionProgressText(
              `MISSION COMPLETE! Reached Abyssal Trench Depth (-${depthBelowSea.toFixed(1)}m below sea level)!`,
            );
          } else if (!missionCompletedRef.current && (frames & 7) === 0) {
            setMissionProgressText(
              `Objective: Dive below -9.0m in the Deep Ocean [Hold Ctrl/Q or DIVE ▼] · Current Depth: ${
                depthBelowSea > 0 ? `-${depthBelowSea.toFixed(1)}m` : 'Surface'
              }`,
            );
          }
        }
      }

      // Smooth 60fps P2P Multiplayer transform interpolation & floating 3D nameplates
      try {
        sim.multiplayer.updateInterpolation(dt, camera.position);
      } catch {
        // Guard render loop against any transient interpolation error
      }

      // Dynamic Weather Preset Palette + Subterranean Cave Atmosphere & Deep Ocean Fog Transition:
      const wPreset = weatherPresetRef.current;
      if (wPreset === 'GOLDEN_SUNSET') {
        surfaceSkyColor.setHex(0xd96b43);
        surfaceFogColor.setHex(0xe88554);
        surfaceHemiSky.setHex(0xfbbf24);
        surfaceHemiGround.setHex(0x3f231c);
      } else if (wPreset === 'MIDNIGHT_NEON') {
        surfaceSkyColor.setHex(0x090d1a);
        surfaceFogColor.setHex(0x0d1528);
        surfaceHemiSky.setHex(0x253b6e);
        surfaceHemiGround.setHex(0x070a14);
      } else if (wPreset === 'STORMY_OCEAN') {
        surfaceSkyColor.setHex(0x2c3b4d);
        surfaceFogColor.setHex(0x354759);
        surfaceHemiSky.setHex(0x526980);
        surfaceHemiGround.setHex(0x1b242e);
      } else if (wPreset === 'ARCTIC_ICE') {
        surfaceSkyColor.setHex(0x93c5fd);
        surfaceFogColor.setHex(0xbfdbfe);
        surfaceHemiSky.setHex(0xdbeafe);
        surfaceHemiGround.setHex(0x475569);
      } else {
        surfaceSkyColor.setHex(0x5b9bd5);
        surfaceFogColor.setHex(0x6ab4e8);
        surfaceHemiSky.setHex(0x87a8c8);
        surfaceHemiGround.setHex(0x2d3b45);
      }

      if (sim.isBuildMode) {
        cachedTargetCaveFactor = 0;
      } else if ((caveSampleTick++ & 3) === 0) {
        cachedTargetCaveFactor = world.evaluateCaveAtmosphereAt(
          camera.position.x,
          camera.position.y,
          camera.position.z,
        ).caveFactor;
      }
      const targetCaveFactor = cachedTargetCaveFactor;
      currentCaveAtmosphere +=
        (targetCaveFactor - currentCaveAtmosphere) * Math.min(1, 6.5 * dt);

      const deepOceanDist = world.getDeepOceanDistance(camera.position.x, camera.position.z);
      const deepOceanFogProgress = sim.isBuildMode ? 0 : Math.max(0, Math.min(1.0, deepOceanDist / 900.0));
      const isCamUnderwater =
        !sim.isBuildMode &&
        camera.position.y < WATER_LEVEL - 0.08 &&
        world.isWaterAt(
          camera.position.x,
          Math.min(camera.position.y + 0.05, WATER_LEVEL - 0.12),
          camera.position.z,
        );
      const underwaterDepthFactor = isCamUnderwater
        ? Math.max(0.45, Math.min(1.0, (WATER_LEVEL - camera.position.y) / 1.4))
        : 0;
      const weatherDarkMult = wPreset === 'MIDNIGHT_NEON' ? 0.58 : wPreset === 'STORMY_OCEAN' ? 0.25 : 0;
      const envDarkFactor = Math.max(currentCaveAtmosphere, deepOceanFogProgress * 0.75, weatherDarkMult);

      const visualTier = resolveVisualQualityTier(sim.graphicsSettings);
      const sunTierBoost = visualTier === 3 ? 1.24 : visualTier === 2 ? 1.14 : 1.04;
      const hemiTierScale = visualTier === 3 ? 0.62 : visualTier === 2 ? 0.65 : 0.68;
      const exposureBase = visualTier === 3 ? 0.96 : visualTier === 2 ? 0.93 : 0.9;

      hemiLight.intensity = hemiTierScale * (1 - envDarkFactor * 0.78);
      hemiLight.color.lerpColors(
        surfaceHemiSky,
        caveHemiSky,
        currentCaveAtmosphere,
      );
      hemiLight.groundColor.lerpColors(
        surfaceHemiGround,
        caveHemiGround,
        currentCaveAtmosphere,
      );
      sunLight.intensity = sunTierBoost * (1 - envDarkFactor * 0.92);
      fillLight.intensity = 0.36 * (1 - envDarkFactor * 0.82);
      renderer.toneMappingExposure = exposureBase - envDarkFactor * 0.34 - underwaterDepthFactor * 0.08;

      if (scene.background instanceof THREE.Color) {
        scene.background.lerpColors(
          surfaceSkyColor,
          caveSkyColor,
          currentCaveAtmosphere,
        );
        if (underwaterDepthFactor > 0) {
          scene.background.lerp(underwaterCameraFogColor, underwaterDepthFactor * 0.88);
        }
        if (deepOceanFogProgress > 0) {
          scene.background.lerp(deepOceanFogColor, deepOceanFogProgress * 0.85);
        }
      }
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.lerpColors(
          surfaceFogColor,
          caveFogColor,
          currentCaveAtmosphere,
        );
        if (underwaterDepthFactor > 0) {
          scene.fog.color.lerp(underwaterCameraFogColor, underwaterDepthFactor * 0.92);
        }
        if (deepOceanFogProgress > 0) {
          scene.fog.color.lerp(deepOceanFogColor, deepOceanFogProgress * 0.95);
        }
        scene.fog.density =
          (sim.baseFogDensity || 0.0028) +
          currentCaveAtmosphere * 0.015 +
          underwaterDepthFactor * 0.014 +
          deepOceanFogProgress * 0.022;
      } else if (scene.fog instanceof THREE.Fog) {
        scene.fog.color.lerpColors(
          surfaceFogColor,
          caveFogColor,
          currentCaveAtmosphere,
        );
        if (underwaterDepthFactor > 0) {
          scene.fog.color.lerp(underwaterCameraFogColor, underwaterDepthFactor * 0.88);
        }
        if (deepOceanFogProgress > 0) {
          scene.fog.color.lerp(deepOceanFogColor, deepOceanFogProgress * 0.85);
        }
      }
      if (
        world.skyDome &&
        world.skyDome.material instanceof THREE.ShaderMaterial &&
        world.skyDome.material.uniforms.uCaveFactor
      ) {
        world.skyDome.material.uniforms.uCaveFactor.value =
          Math.max(currentCaveAtmosphere, underwaterDepthFactor * 0.58);
      }

      const focusPos = showFastTravelMapRef.current
        ? camera.position
        : !sim.isWalking && sim.isSeatedInRig && sim.activeVehicle
          ? sim.activeVehicle.position
          : camera.position;

      // Tight directional shadow camera frustum tracking the active player/vehicle
      sunLight.position.set(focusPos.x + 45, focusPos.y + 42, focusPos.z + 55);
      sunLight.target.position.copy(focusPos);
      world.sunDirection
        .copy(sunLight.position)
        .sub(sunLight.target.position)
        .normalize();
      world.fogEnabled = sim.graphicsSettings.fog;

      if (
        sim.isBuildMode ||
        sim.isWorldEditMode ||
        sim.isObjectStudioMode ||
        (caveSampleTick & 7) === 0
      ) {
        currentRayLabel = updateRaycastTarget();
      }
      const fxDt = effectiveSimDt > 0 ? effectiveSimDt : dt * govStep.timeScale;
      const allFrameRigs = sim.getAllPhysicsRigs();
      fx.rigs = allFrameRigs;
      if (!sim.isBuildMode) {
        worldArenaSystems.update(
          dt,
          sim.isSeatedInRig ? curRig : null,
          allFrameRigs,
          focusPos,
          world.waterMesh,
        );
      }
      const _tDebris0 = performance.now();
      fx.update(
        fxDt,
        focusPos,
        govStep.watchdog.maxExplosionsThisFrame,
        govStep.watchdog.debrisSpawnMultiplier,
      );
      const _tDebris1 = performance.now();
      if (world.waveQuality !== 'OFF' && !govStep.watchdog.shouldSkipWaveUpdate) {
        world.updateWaterWaves(
          fxDt,
          allFrameRigs,
          (wx, wy, wz) => {
            fx.spawnDebris(wx, wy + 0.1, wz, 0xffffff, 2.8, 0.45);
          },
          camera,
        );
      } else {
        if (world.waveQuality !== 'OFF') {
          world.waveTime += fxDt;
        }
        world.gpuOceanWaveUniforms.uWaveTime.value = world.waveTime;
        world.gpuOceanWaveUniforms.uSunDir.value.copy(world.sunDirection);
      }

      const _tWorldUpd0 = performance.now();
      world.updateChunksAndVisibility(
        focusPos.x,
        focusPos.z,
        curRig.rawFaces,
        curRig.mergedQuads,
        camera,
        govStep.watchdog.chunkBudgetMs,
        govStep.watchdog.maxSyncChunkRebuilds,
      );
      const _tWorldUpd1 = performance.now();

      hudSyncAccum += dt;
      if (hudSyncAccum >= 0.18) {
        hudSyncAccum = 0;
        syncHudNow();
      }

      (renderer as any).currentTime = world.voxelWorld.getTime();
      (renderer as unknown as { cameraBigSector: BigSectorPosition }).cameraBigSector =
        createBigSectorPosition(camera.position.x, camera.position.y, camera.position.z);
      blobShadowManager.commit();
      const _tRender0 = performance.now();
      graphicsPipeline.render(
        sim.graphicsSettings,
        now * 0.001,
        focusPos,
        curRig.velocity.length(),
        fx.trauma,
        isHeadless,
        world.worldGenMode,
        world.gpuOceanWaveUniforms,
      );
      const _tRender1 = performance.now();

      perfProfiler.endFrame({
        frameDeltaMs: deltaMs,
        physicsTotalMs: _tPhys1 - _tPhys0,
        physicsSteps: physicsStepsThisFrame,
        renderMs: _tRender1 - _tRender0,
        worldUpdateMs: _tWorldUpd1 - _tWorldUpd0,
        debrisUpdateMs: _tDebris1 - _tDebris0,
        activeBodies: world.voxelWorld.countAwakeBodies(),
        totalBodies: world.voxelWorld.activeBodyCount,
        activeDebris: world.voxelWorld.activeDebrisCount,
        visibleChunks: world.voxelWorld.countVisibleChunks(),
        dirtyChunks: world.voxelWorld.countDirtyChunks(),
      });

      // Hide distant sleeping voxel entities on Pentium / Potato mode to cut draw calls
      if (isLowEndPhysicsCap && sim.voxelEntities.length > 0) {
        const cullDistSq = Math.pow(
          Math.max(38, sim.graphicsSettings.voxelDrawDistance * 16 * 0.85),
          2,
        );
        for (let i = 0; i < sim.voxelEntities.length; i++) {
          const ent = sim.voxelEntities[i];
          const dx = ent.position.x - focusPos.x;
          const dz = ent.position.z - focusPos.z;
          const farSleeping =
            dx * dx + dz * dz > cullDistSq && ent.rigidBody.isSleeping;
          ent.rootGroup.visible = !farSleeping;
        }
      }

      perfOverlayAccumSec += rawDt;
      if (perfOverlayAccumSec >= 0.35) {
        perfOverlayAccumSec = 0;
        if (perfOverlayRef.current) {
          perfOverlayRef.current.textContent = perfProfiler.formatOverlayText();
        }
        (window as unknown as Record<string, unknown>).__PERF_DIAGNOSTIC__ = {
          ...perfProfiler.getSnapshot(),
          eventQueueLengths: {
            explosionEvents: world.voxelWorld.explosionEvents.length,
            damageEvents: world.voxelWorld.damageEvents.length,
            voxelDestroyedEvents: world.voxelWorld.voxelDestroyedEvents.length,
            visibilityChangedEvents: world.voxelWorld.visibilityChangedEvents.length,
            bodySleepEvents: world.voxelWorld.bodySleepEvents.length,
          },
          usesSharedArrayBuffer: world.workerPool?.usesSharedArrayBuffer ?? null,
          totalAllocatedChunks: world.totalAllocatedChunks,
          creationsCount: sim.creations.length,
          voxelEntitiesCount: sim.voxelEntities.length,
          hardwareTier: sim.hardwareTierInfo.tier,
          hardwareTierReason: sim.hardwareTierInfo.reason,
          frameRateCap: sim.graphicsSettings.frameRateCap,
          effectiveTargetFps: sim.getEffectiveTargetFps(),
          unifiedEngineTelemetry: { ...unifiedEngineTelemetry },
        };
      }

      // High-performance 3D rotating preview sub-renderer for Build Mode hotbar/catalog (Desktop & Mobile)
      // Renders directly into previewOverlayCanvasRef (z-[60], in front of UI cards & mobile drawer, below menus & modals) with transparent background
      if (
        sim.isBuildMode &&
        !isScreenshotModeRef.current &&
        sim.gameState === 'playing' &&
        !anyOverlayMenuOpenRef.current
      ) {
        const overlayCanvas = previewOverlayCanvasRef.current;
        if (!previewOverlayRenderer && overlayCanvas) {
          try {
            const pR = new THREE.WebGLRenderer({
              canvas: overlayCanvas,
              alpha: true,
              antialias: false,
              precision: 'lowp',
              powerPreference: 'low-power',
            });
            pR.setSize(window.innerWidth, window.innerHeight);
            pR.setPixelRatio(
              isHeadless
                ? 1
                : Math.min(window.devicePixelRatio || 1, isInIframe ? 1.0 : 1.25),
            );
            previewOverlayRenderer = pR;
          } catch {
            // fallback if context creation fails
          }
        }

        pooledPreviewTargets.length = 0;
        const activeSlotObj = (sim.isObjectStudioMode ? OBJECT_STUDIO_SLOTS : BUILD_SLOTS).find(
          (s) => s.slot === sim.selectedSlot,
        );
        const selectedKey = activeSlotObj ? previewRenderer.getItemKey(activeSlotObj) : null;

        slotElementsRef.current.forEach((elSet, key) => {
          elSet.forEach((el) => {
            if (!el || !el.isConnected) {
              elSet.delete(el);
              return;
            }
            pooledPreviewTargets.push({
              el,
              itemKey: key,
              isHovered: hoveredSlotKeyRef.current === key,
              isSelected: selectedKey === key,
            });
          });
        });

        const overlayR: THREE.WebGLRenderer | null = previewOverlayRenderer;
        if (overlayR) {
          if (overlayCanvas) {
            overlayCanvas.style.visibility = 'visible';
          }
          overlayR.setScissorTest(false);
          overlayR.setClearColor(0x000000, 0);
          overlayR.clear();
          if (pooledPreviewTargets.length > 0) {
            previewRenderer.renderHotbarPreviews(overlayR, pooledPreviewTargets, dt);
          }
        } else if (pooledPreviewTargets.length > 0) {
          previewRenderer.renderHotbarPreviews(renderer, pooledPreviewTargets, dt);
        }
      } else {
        clearPreviewOverlay();
      }
    };

    if (isHeadless) {
      (window as any).__voxelTestSim = {
        sim,
        world,
        camera,
        graphicsPipeline,
        renderer,
        scene,
        stepNow: () => stepFrame(performance.now()),
        pauseRenderLoop: (paused: boolean) => {
          (window as any).__voxelTestPaused = paused;
        },
      };
    }

    const animate = (now = performance.now()) => {
      if (isDisposed) return;
      const targetFps = sim.getEffectiveTargetFps();
      if (!shouldRenderCappedFrame(now, lastTime, targetFps)) {
        animId = requestAnimationFrame(animate);
        return;
      }
      if (!(isHeadless && (window as any).__voxelTestPaused)) {
        stepFrame(now);
      }
      if (isHeadless) {
        softwareGlYieldTimer = setTimeout(() => {
          if (!isDisposed) animId = requestAnimationFrame(animate);
        }, 200);
      } else {
        animId = requestAnimationFrame(animate);
      }
    };

    animId = requestAnimationFrame(animate);

    return () => {
      isDisposed = true;
      if (isHeadless) {
        delete (window as any).__voxelTestSim;
        delete (window as any).__voxelTestPaused;
      }
      if (softwareGlYieldTimer !== null) {
        clearTimeout(softwareGlYieldTimer);
      }
      try {
        gui.destroy();
      } catch {
        // Ignore dat.GUI cleanup error
      }
      clearInterval(stageTimer);
      cancelAnimationFrame(animId);
      multiplayer.disconnect();
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mousedown', onCanvasMouseDown);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearAllInputs);
      window.removeEventListener('resize', onResize);
      for (const c of sim.creations) {
        c.dispose();
      }
      for (const ent of sim.voxelEntities) {
        ent.dispose();
      }
      for (const haz of sim.mapHazards) {
        haz.dispose(scene);
      }
      worldArenaSystems.dispose();
      fx.dispose();
      world.dispose();
      selectionWireframe.geometry.dispose();
      (selectionWireframe.material as THREE.Material).dispose();
      selectedObjectWireframe.geometry.dispose();
      (selectedObjectWireframe.material as THREE.Material).dispose();
      tacticalGridMesh.geometry.dispose();
      if (Array.isArray(tacticalGridMesh.material)) {
        tacticalGridMesh.material.forEach((m) => m.dispose());
      } else {
        (tacticalGridMesh.material as THREE.Material).dispose();
      }
      scene.remove(playerCharacterMesh);
      playerCharacterMesh.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      });
      previewRenderer.dispose();
      graphicsPipeline.dispose();
      scene.remove(blobShadowManager.mesh);
      blobShadowManager.dispose();
      delete scene.userData.blobShadowManager;
      disposeSharedModelCaches();
      disposeSharedPotatoShaderResources();
      (previewOverlayRenderer as THREE.WebGLRenderer | null)?.dispose();
      renderer.dispose();
    };
  }, [initialAutoStart]);

  const sim = simRef.current;
  const activeStudioOrBuildSlots = useMemo(
    () =>
      hud.isObjectStudioMode
        ? OBJECT_STUDIO_SLOTS
        : BUILD_SLOTS.filter((s) => {
            const matchCat = buildCategory === 'ALL' || s.category === buildCategory;
            const q = partSearchQuery.trim().toLowerCase();
            const matchSearch =
              !q ||
              s.name.toLowerCase().includes(q) ||
              s.tag.toLowerCase().includes(q) ||
              s.category.toLowerCase().includes(q);
            return matchCat && matchSearch;
          }),
    [hud.isObjectStudioMode, buildCategory, partSearchQuery],
  );

  const selectedBuildSlotItem =
    (hud.isObjectStudioMode
      ? OBJECT_STUDIO_SLOTS.find((s) => s.slot === hud.selectedSlot)
      : BUILD_SLOTS.find((s) => s.slot === hud.selectedSlot)) || BUILD_SLOTS[0];

  // Determine which object/module(s) are being configured in the Right-Side Inspector:
  // Priority 1: Selected object(s) on the vehicle (supports single & multi-select across mixed module types!)
  // Priority 2: Currently selected module slot in the Left Catalog (updates both default config & matching parts on rig)
  const selectedObjs = hud.selectedBuildObjects;
  const selectedCount = selectedObjs.length;
  const selectedModules = selectedObjs.filter((o) => o.kind === 'module');
  const selectedVoxels = selectedObjs.filter((o) => o.kind === 'voxel');

  const isPassiveModuleKind = (k?: ModuleKind) =>
    k === 'SUSPENSION' ||
    k === 'WEIGHT_BLOCK' ||
    k === 'PONTOON_LARGE' ||
    k === 'HINGE_TRAILER';

  // Prefer the last keybindable module in a multi-selection so mixed selections always expose keybind controls
  const primarySelectedModule =
    selectedModules.length > 0
      ? [...selectedModules]
          .reverse()
          .find((m) => m.moduleKind && !isPassiveModuleKind(m.moduleKind)) ||
        selectedModules[selectedModules.length - 1]
      : null;
  const primarySelectedVoxel =
    selectedVoxels.length > 0
      ? selectedVoxels[selectedVoxels.length - 1]
      : null;
  const selectedObj = hud.selectedBuildObject;

  const isConfiguringSelectedModule =
    !hud.isObjectStudioMode &&
    primarySelectedModule !== null &&
    Boolean(primarySelectedModule.moduleKind);
  const isConfiguringSelectedVoxel =
    !hud.isObjectStudioMode && primarySelectedVoxel !== null;

  const activeConfigModuleKind: ModuleKind | null = isConfiguringSelectedModule
    ? primarySelectedModule!.moduleKind!
    : !hud.isObjectStudioMode &&
        selectedBuildSlotItem.type === 'module' &&
        selectedBuildSlotItem.kind
      ? selectedBuildSlotItem.kind
      : null;

  const activeConfigSlotMeta = activeConfigModuleKind
    ? BUILD_SLOTS.find((s) => s.kind === activeConfigModuleKind)
    : null;

  const hasAnyKeybindableSelectedModule = selectedModules.some(
    (m) => m.moduleKind && !isPassiveModuleKind(m.moduleKind),
  );

  // Read live effective config for the selected module instance(s) OR default slot config on the active creation
  void configRefreshTick;
  const activeRigForInspector = sim ? sim.getActiveRig() : null;
  const activeModuleConfig: ModuleTuningConfig = (() => {
    if (
      isConfiguringSelectedModule &&
      activeRigForInspector &&
      primarySelectedModule
    ) {
      const liveMod = activeRigForInspector.getModuleAt(
        primarySelectedModule.vx,
        primarySelectedModule.vy,
        primarySelectedModule.vz,
      );
      if (liveMod?.config) {
        return {
          ...(activeConfigSlotMeta?.defaultConfig || {}),
          ...liveMod.config,
        };
      }
    }
    if (activeConfigModuleKind && activeRigForInspector) {
      return {
        ...(activeConfigSlotMeta?.defaultConfig || {}),
        ...activeRigForInspector.getEffectiveConfigForKind(
          activeConfigModuleKind,
        ),
      };
    }
    return activeConfigSlotMeta?.defaultConfig || {};
  })();

  const handleUpdateModuleConfig = useCallback(
    (patch: Partial<ModuleTuningConfig>) => {
      if (!sim) return;
      const targetRig = sim.getActiveRig();
      const curSelectedMods = sim.selectedBuildObjects.filter(
        (o) => o.kind === 'module',
      );
      if (!sim.isObjectStudioMode && curSelectedMods.length > 0) {
        // Apply strictly to ALL currently selected modules (even across multiple different part types!)
        const nextSelectedObjs = sim.selectedBuildObjects.map((sel) => {
          if (sel.kind !== 'module') return sel;
          const updated = targetRig.updateModuleConfig(
            sel.vx,
            sel.vy,
            sel.vz,
            patch,
          );
          if (updated) {
            return {
              ...sel,
              config: updated.config ? { ...updated.config } : undefined,
            };
          }
          return sel;
        });
        sim.setMultiSelection(nextSelectedObjs, false);
        setConfigRefreshTick((t) => t + 1);
        return;
      }
      if (!activeConfigModuleKind) return;
      // Update default config for newly placed modules of this kind AND sync any existing modules of this kind on the active rig
      targetRig.setKindDefaultConfig(activeConfigModuleKind, patch);
      for (const m of targetRig.modules) {
        if (m.kind === activeConfigModuleKind) {
          targetRig.updateModuleConfig(m.vx, m.vy, m.vz, patch);
        }
      }
      setConfigRefreshTick((t) => t + 1);
    },
    [sim, activeConfigModuleKind],
  );

  // Interactive "Press Any Key to Bind" listener in Build Mode
  useEffect(() => {
    if (!listeningKeyTarget) return;
    const onKeyDownCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setListeningKeyTarget(null);
        return;
      }
      const capturedCode =
        e.code === 'Backspace' || e.code === 'Delete' ? 'NONE' : e.code;
      handleUpdateModuleConfig({
        [listeningKeyTarget]: capturedCode,
      });
      SoundFX.snap();
      setListeningKeyTarget(null);
    };
    window.addEventListener('keydown', onKeyDownCapture, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKeyDownCapture, {
        capture: true,
      });
  }, [listeningKeyTarget, handleUpdateModuleConfig]);

  // Group all installed modules on the active rig by kind for 1-click selection & keybind overview (and live Driving HUD badges)
  const installedModuleGroups = (() => {
    if (!activeRigForInspector) return [];
    const map = new Map<
      ModuleKind,
      {
        kind: ModuleKind;
        name: string;
        count: number;
        posKey: string;
        negKey: string;
        objs: SelectableBuildObject[];
      }
    >();
    for (const m of activeRigForInspector.modules) {
      const slotMeta = BUILD_SLOTS.find((s) => s.kind === m.kind);
      const effCfg = {
        ...(slotMeta?.defaultConfig || {}),
        ...(m.config || {}),
      };
      const existing = map.get(m.kind);
      const selObj: SelectableBuildObject = {
        kind: 'module',
        vx: m.vx,
        vy: m.vy,
        vz: m.vz,
        moduleKind: m.kind,
        yawIdx: m.yawIdx,
        pitchIdx: m.pitchIdx || 0,
        rollIdx: m.rollIdx || 0,
        config: m.config ? { ...m.config } : undefined,
      };
      if (existing) {
        existing.count++;
        existing.objs.push(selObj);
      } else {
        map.set(m.kind, {
          kind: m.kind,
          name: slotMeta?.name || m.kind,
          count: 1,
          posKey: effCfg.posKey || 'NONE',
          negKey: effCfg.negKey || 'NONE',
          objs: [selObj],
        });
      }
    }
    return Array.from(map.values());
  })();

  // Active custom/default keybind badges for installed action modules in Driving HUD (excluding standard W/S/A/D seats/wheels/engines/hinges & X/T/Y toggles)
  const drivingActionModuleBadges = installedModuleGroups.filter((grp) => {
    if (isPassiveModuleKind(grp.kind)) return false;
    if (
      grp.kind === 'PISTON' ||
      grp.kind === 'GRAPPLING_WINCH' ||
      grp.kind === 'GYRO' ||
      grp.kind === 'GYRO_REACTION' ||
      grp.kind === 'HEADLIGHT' ||
      grp.kind.startsWith('SEAT')
    ) {
      return false;
    }
    const stdKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'NONE']);
    if (stdKeys.has(grp.posKey) && stdKeys.has(grp.negKey)) return false;
    return grp.posKey !== 'NONE';
  });

  const allPlaceableObjects = useMemo(
    () => [...PREBUILT_OBJECTS, ...customObjects],
    [customObjects],
  );

  const currentCameraLabel =
    CAMERA_MODES.find((c) => c.id === hud.cameraMode)?.label || 'Chase Cam';

  const handleDeleteSavedBlueprint = (id: string) => {
    const next = savedBlueprints.filter((b) => b.id !== id);
    setSavedBlueprints(next);
    try {
      localStorage.setItem(STORAGE_KEY_BLUEPRINTS, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const copyBlueprintJsonToClipboard = (jsonStr: string, label = 'Blueprint') => {
    setShareCodeText(jsonStr);
    const finishCopy = () => {
      SoundFX.snap();
      setGarageFeedback(`Copied "${label}" .json string to clipboard!`);
    };
    const fallbackCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = jsonStr;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        finishCopy();
      } catch {
        setGarageFeedback(`Generated "${label}" .json string below — select and press Ctrl+C.`);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonStr).then(finishCopy).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  };

  const handleImportShareCode = (spawnAsNew = false) => {
    try {
      const parsed = JSON.parse(shareCodeText.trim()) as SerializedVehicleBlueprint;
      if (!parsed || !Array.isArray(parsed.voxels) || !Array.isArray(parsed.modules)) {
        setGarageFeedback('Invalid blueprint JSON format.');
        return;
      }
      if (spawnAsNew) {
        sim?.spawnNewCreation(undefined, parsed);
        setGarageFeedback(`Spawned "${parsed.name || 'Imported Vehicle'}" from JSON!`);
      } else {
        sim?.loadSavedVehicle(parsed);
        setGarageFeedback(`Loaded "${parsed.name || 'Imported Vehicle'}" from JSON!`);
      }
      setShowGarageModal(false);
    } catch {
      setGarageFeedback('Could not parse Blueprint JSON string.');
    }
  };

  const handleProceduralHeightmap = (
    preset: 'CRATER_BASIN' | 'TWIN_PEAKS' | 'SPIRAL_CANYON' | 'ATOLL_RING',
  ) => {
    const hm = generateProceduralHeightmapPreset(preset, 128);
    sim?.regenerateUnlimitedWorld('CUSTOM_HEIGHTMAP', MAT.CONCRETE, {
      ...hm,
      scaleY: heightmapScaleY,
    });
    setWorldGenFeedback(
      `Generated Unlimited World from "${preset}" Heightmap (128×128 · Scale ${heightmapScaleY}v)!`,
    );
    setShowWorldGenModal(false);
  };

  const handleHeightmapImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(256, Math.max(32, img.width));
        const h = Math.min(256, Math.max(32, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h).data;
        const heights = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const r = imgData[i * 4];
          const g = imgData[i * 4 + 1];
          const b = imgData[i * 4 + 2];
          heights[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }
        sim?.regenerateUnlimitedWorld('CUSTOM_HEIGHTMAP', MAT.CONCRETE, {
          width: w,
          height: h,
          heights,
          scaleY: heightmapScaleY,
        });
        setWorldGenFeedback(
          `Imported Heightmap "${file.name}" (${w}×${h}px · Scale ${heightmapScaleY}v)!`,
        );
        setShowWorldGenModal(false);
      };
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const applyLoadedGlbMapToWorld = useCallback(
    (
      voxels: Array<[number, number, number, number, number?, number?, number?]>,
      sizeX: number,
      sizeY: number,
      sizeZ: number,
      mapName: string,
      scaleFactor?: number,
      voxelSolid?: Uint8Array,
      voxelRGB?: Uint8Array,
    ) => {
      const activeSim = simRef.current;
      if (!activeSim) return;
      const finalScale = scaleFactor ?? glbScaleFactor;
      activeSim.world.loadGlbMapAsWorld(
        voxels,
        sizeX,
        sizeY,
        sizeZ,
        finalScale,
        voxelSolid,
        voxelRGB,
      );
      const bestSpawn = activeSim.world.findBestGlbSpawnPosition();
      activeSim.clearVoxelEntities();
      activeSim.clearMapHazards();
      activeSim.creations.forEach((cr, idx) => {
        cr.position.set(bestSpawn.x + idx * 6.0, bestSpawn.y, bestSpawn.z);
        cr.velocity.set(0, 0, 0);
        cr.angularVelocity.set(0, 0, 0);
        cr.quaternion.identity();
        cr.syncVisualTransform();
      });
      SoundFX.snap();
      const mapLabel = `GLB World: ${mapName} (${finalScale}x)`;
      setActiveMapLabel(mapLabel);
      activeSim.multiplayer?.broadcastWorldMapSync(mapLabel);
      const widthM = Math.round(sizeX * finalScale * VOXEL_SIZE);
      setWorldGenFeedback(
        `Loaded GLB World "${mapName}" (${finalScale}x Scale · ${widthM}m wide island · Endless Deep Ocean active)!`,
      );
    },
    [glbScaleFactor],
  );

  const handleSelectDefaultMap = (autoStart = false) => {
    const activeSim = simRef.current;
    if (!activeSim) return;
    activeSim.regenerateUnlimitedWorld('DEFAULT_PARK', MAT.CONCRETE, null);
    setActiveMapLabel('Default Map (Stunt Park & Ocean)');
    setWorldGenFeedback('Switched to Default Map (Stunt Park & Ocean)!');
    setShowChooseMapModal(false);
    setShowWorldGenModal(false);
    if (autoStart) {
      activeSim.startGame();
    }
  };

  const handleLoadSavedGlbMap = (rec: SavedGlbMapRecord, autoStart = false) => {
    applyLoadedGlbMapToWorld(
      rec.voxels,
      rec.sizeX,
      rec.sizeY,
      rec.sizeZ,
      rec.name,
      rec.scaleFactor ?? glbScaleFactor,
    );
    setShowChooseMapModal(false);
    setShowWorldGenModal(false);
    if (autoStart) {
      simRef.current?.startGame();
    }
  };

  const handleDeleteSavedGlbMap = (id: string) => {
    const next = savedGlbMaps.filter((m) => m.id !== id);
    setSavedGlbMaps(next);
    try {
      localStorage.setItem(STORAGE_KEY_GLB_MAPS, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  };

  const handleGlbModelUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    launchFromStartMenu = true,
  ) => {
    const file = e.target.files?.[0];
    const activeSim = simRef.current;
    if (!file || !activeSim) return;
    setIsVoxelizingGlb(true);
    setGlbProgress({ pct: 5, stage: `Analyzing 3D geometry & UV textures for "${file.name}"...` });
    setWorldGenFeedback(`Voxelizing "${file.name}" (${glbTargetResolution}v 3D CT-Slicer · ${glbScaleFactor}x Scale)...`);
    try {
      const res = await voxelizeGlbFile(
        file,
        glbTargetResolution,
        activeSim.renderer,
        (pct, stage) => {
          setGlbProgress({ pct, stage });
          setWorldGenFeedback(`${stage} (${pct}% done · ${Math.max(0, 100 - pct)}% left)`);
        },
      );
      if (!res.voxels || res.voxels.length === 0) {
        throw new Error('No 3D mesh geometry found in uploaded file.');
      }
      const cleanName = file.name.replace(/\.(glb|gltf)$/i, '') || 'Custom 3D Island';
      const newRecord: SavedGlbMapRecord = {
        id: `glb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sizeX: res.sizeX,
        sizeY: res.sizeY,
        sizeZ: res.sizeZ,
        scaleFactor: glbScaleFactor,
        voxelCount: res.voxels.length,
        voxels: res.voxels,
      };
      // Save up to 6 custom GLB maps in state & localStorage (gracefully trimming if quota is tight)
      const nextMaps = [newRecord, ...savedGlbMaps.filter((m) => m.name !== cleanName)].slice(0, 6);
      setSavedGlbMaps(nextMaps);
      try {
        localStorage.setItem(STORAGE_KEY_GLB_MAPS, JSON.stringify(nextMaps));
      } catch {
        try {
          localStorage.setItem(STORAGE_KEY_GLB_MAPS, JSON.stringify([newRecord]));
        } catch {
          // Ignore storage quota limits for huge meshes
        }
      }

      applyLoadedGlbMapToWorld(
        res.voxels,
        res.sizeX,
        res.sizeY,
        res.sizeZ,
        cleanName,
        glbScaleFactor,
        res.voxelSolid,
        res.voxelRGB,
      );
      setShowChooseMapModal(false);
      setShowWorldGenModal(false);
      if (launchFromStartMenu) {
        simRef.current?.startGame();
      }
    } catch (err) {
      setWorldGenFeedback(
        `Failed to voxelize GLB/GLTF: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      setIsVoxelizingGlb(false);
      e.target.value = '';
    }
  };

  // =========================================================================
  // GAME MODES SETUP, TELEPORT NODES & BUILDING CHALLENGE AUTO-TEST HELPERS
  // =========================================================================
  const startBuildingChallengeAutoTest = (overridePromptIdx?: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const pIdx =
      overridePromptIdx !== undefined
        ? overridePromptIdx
        : buildingChallengePromptIdxRef.current;
    const prompt =
      BUILDING_CHALLENGE_PROMPTS[pIdx % BUILDING_CHALLENGE_PROMPTS.length];
    const rig = sim.getActiveRig();

    if (gameState !== 'playing') {
      sim.startGame();
    }
    if (sim.isBuildMode) {
      sim.toggleHoverBuildMode(false);
    }
    rig.repairVehicle();

    let startX = 0;
    let startZ = -12;
    if (prompt.id === 'DROP_50M') {
      startX = 0;
      startZ = 0;
      const groundH = sim.world.probeGroundBelow(startX, 40, startZ, 1.0).y;
      rig.position.set(startX, groundH + 52, startZ);
      rig.quaternion.identity();
      rig.velocity.set(0, -4, 0);
      rig.angularVelocity.set(0, 0, 0);
      rig.syncVisualTransform();
    } else {
      startX = 0;
      startZ = -18;
      const groundH = sim.world.probeGroundBelow(startX, 40, startZ, 1.0).y;
      rig.position.set(startX, groundH + 2.2, startZ);
      rig.quaternion.identity();
      const wheelCount = rig.modules.filter((m) =>
        m.kind.startsWith('WHEEL'),
      ).length;
      const testSpeedMps =
        prompt.id === 'FASTEST_NO_JETS'
          ? wheelCount > 0
            ? 15.5 + Math.min(8, wheelCount * 1.4)
            : 0
          : wheelCount > 0
            ? 12.0
            : 7.5;
      rig.velocity.set(0, 0, testSpeedMps);
      rig.angularVelocity.set(0, 0, 0);
      rig.syncVisualTransform();
    }

    buildingChallengeTestMetricsRef.current = {
      active: true,
      promptIdx: pIdx % BUILDING_CHALLENGE_PROMPTS.length,
      remainingSec: Math.min(1.2, prompt.testDurationSec),
      startPos: { x: startX, z: startZ },
      peakSpeedKmh: Math.abs(rig.velocity.z) * 3.6,
    };
    setBuildingChallengeTesting(true);
    setBuildingChallengeResult(null);
    SoundFX.hover();
  };

  const activateGameModeAndSetupWorld = (modeId: string) => {
    ModRegistry.setActiveGameMode(modeId);
    setModRegistryTick((t) => t + 1);
    const sim = simRef.current;

    if (modeId === 'CHECKPOINT_TIME_TRIAL') {
      if (sim && gameState === 'playing' && sim.isBuildMode) {
        sim.toggleHoverBuildMode(false);
      }
    } else if (modeId === 'DESTRUCTION_DERBY') {
      if (sim) {
        if (gameState === 'playing' && sim.isBuildMode) {
          sim.toggleHoverBuildMode(false);
        }
        for (const st of DEFAULT_DERBY_STRUCTURES) {
          const vx0 =
            Math.round(st.worldX / VOXEL_SIZE + TOTAL_VX / 2) -
            Math.floor(st.widthVx / 2);
          const vz0 =
            Math.round(st.worldZ / VOXEL_SIZE + TOTAL_VZ / 2) -
            Math.floor(st.depthVz / 2);
          sim.world.stampHollowBuilding(
            vx0,
            vz0,
            st.widthVx,
            st.depthVz,
            st.heightVy,
            st.primaryMat,
            st.accentMat,
          );
          sim.world.stampExplosiveBarrelStash(
            Math.round(st.worldX / VOXEL_SIZE + TOTAL_VX / 2),
            Math.round(st.worldZ / VOXEL_SIZE + TOTAL_VZ / 2),
            3,
            `derby_${st.id}`,
          );
        }
        const initialDerby = createInitialDestructionDerbyState(
          sim.fx.voxelsDestroyedCount,
          derbyStateRef.current.bestScoreVoxels,
        );
        derbyStateRef.current = initialDerby;
        setDerbyState(initialDerby);
      }
    } else if (modeId === 'BUILDING_CHALLENGE') {
      setBuildingChallengeTimerSec(300);
      buildingChallengeTestMetricsRef.current.active = false;
      setBuildingChallengeTesting(false);
      setBuildingChallengeResult(null);
      if (sim && gameState === 'playing' && !sim.isBuildMode) {
        sim.toggleHoverBuildMode(true);
      }
    } else if (modeId === 'CAPTURE_THE_FLAG') {
      if (sim && gameState === 'playing' && sim.isBuildMode) {
        sim.toggleHoverBuildMode(false);
      }
      const freshCtf = createInitialCtfState('BLUE');
      ctfStateRef.current = freshCtf;
      setCtfState(freshCtf);
    } else if (modeId === 'BUILD_BATTLE') {
      const freshBattle = createInitialBuildBattleState(0);
      buildBattleStateRef.current = freshBattle;
      setBuildBattleState(freshBattle);
    } else if (modeId === 'SURVIVAL_WAVES' || modeId === 'JUGGERNAUT_BOSS') {
      if (sim && gameState === 'playing' && sim.isBuildMode) {
        sim.toggleHoverBuildMode(false);
      }
      const rig = sim ? sim.getActiveRig() : null;
      const centerPos = rig
        ? { x: rig.position.x, y: rig.position.y, z: rig.position.z }
        : { x: 0, y: WATER_LEVEL + 2.0, z: 0 };
      const freshSurvival = createInitialSurvivalWavesState(
        centerPos,
        survivalStateRef.current.bestWave,
      );
      if (modeId === 'JUGGERNAUT_BOSS') {
        freshSurvival.wave = 5;
      }
      survivalStateRef.current = freshSurvival;
      setSurvivalState(freshSurvival);
    } else if (modeId === 'KING_OF_THE_HILL') {
      if (sim && gameState === 'playing' && sim.isBuildMode) {
        sim.toggleHoverBuildMode(false);
      }
      const freshKoth = createInitialKingOfTheHillState();
      kingOfHillStateRef.current = freshKoth;
      setKingOfHillState(freshKoth);
    } else if (modeId === 'STUNT_FREESTYLE') {
      if (sim && gameState === 'playing' && sim.isBuildMode) {
        sim.toggleHoverBuildMode(false);
      }
      const freshStunt = createInitialStuntFreestyleState(
        stuntFreestyleStateRef.current.bestScore,
      );
      stuntFreestyleStateRef.current = freshStunt;
      setStuntFreestyleState(freshStunt);
    } else if (modeId === 'SHREDDER_GAUNTLET') {
      if (sim) {
        if (gameState === 'playing' && sim.isBuildMode) {
          sim.toggleHoverBuildMode(false);
        }
        sim.resetArenaMapHazards();
        executeImmediateVehicleTeleport(-11.5, WATER_LEVEL + 1.8, 8.0);
      }
    }
  };

  const executeImmediateVehicleTeleport = (x: number, y: number, z: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const rig = sim.getActiveRig();
    const groundY = sim.world.probeGroundBelow(x, y + 30, z, 1.0).y;
    const safeY = Math.max(y + 1.5, groundY + 1.8);
    rig.summonTo(x, z, 0);
    rig.position.y = safeY;
    rig.velocity.set(0, 0, 0);
    rig.angularVelocity.set(0, 0, 0);
    rig.syncVisualTransform();
    if (!sim.isSeatedInRig) {
      sim.camFreePos.set(x + 2, safeY, z + 2);
      sim.playerVelY = 0;
    }
    sim.fx.spawnWeldSparks(x, safeY, z);
    SoundFX.snap();
  };

  const handlePlaceTeleportBeaconAtCoords = (
    x: number,
    z: number,
    customLabel?: string,
  ) => {
    const sim = simRef.current;
    const groundY = sim
      ? sim.world.probeGroundBelow(x, 45, z, 1.0).y
      : WATER_LEVEL + 1.8;
    const res = addTeleportNode(teleportStateRef.current, {
      name:
        customLabel || `Beacon #${teleportStateRef.current.nodes.length + 1}`,
      x,
      y: groundY,
      z,
    });
    teleportStateRef.current = res.state;
    setTeleportState(res.state);
    if (!res.added) {
      SoundFX.clank();
      return;
    }
    setNewBeaconNameInput('');
    SoundFX.snap();
  };

  const handlePlaceTeleportBeaconAtPlayer = () => {
    const sim = simRef.current;
    if (!sim) return;
    const pos = sim.isSeatedInRig
      ? sim.getActiveRig().position
      : sim.camFreePos;
    handlePlaceTeleportBeaconAtCoords(
      pos.x,
      pos.z,
      newBeaconNameInput.trim() || undefined,
    );
  };

  const handleRequestTeleportToNode = (nodeId: string) => {
    const sim = simRef.current;
    if (!sim) return;
    const pos = sim.isSeatedInRig
      ? sim.getActiveRig().position
      : sim.camFreePos;
    const res = initiateTeleportToNode(
      teleportStateRef.current,
      nodeId,
      { x: pos.x, y: pos.y, z: pos.z },
      Date.now(),
    );
    teleportStateRef.current = res.state;
    setTeleportState(res.state);

    const targetNode =
      res.targetNode ||
      teleportStateRef.current.nodes.find((n) => n.id === nodeId) ||
      null;
    if (targetNode) {
      executeImmediateVehicleTeleport(
        targetNode.x,
        targetNode.y,
        targetNode.z,
      );
      setShowFastTravelMap(false);
      return;
    }
    if (res.error) {
      SoundFX.clank();
      return;
    }
  };

  const handleDeleteTeleportNode = (nodeId: string) => {
    const next = removeTeleportNode(teleportStateRef.current, nodeId);
    teleportStateRef.current = next;
    setTeleportState(next);
    SoundFX.remove();
  };

  const renderIsometricTileIcon = (item: BuildSlotItem) => {
    const color = item.color;
    const cat = item.category;
    const k = item.kind;

    if (cat === 'COSMETICS' && item.type === 'module') {
      return (
        <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
          <polygon
            points="16,3 20,11 29,12 22,19 24,28 16,23 8,28 10,19 3,12 12,11"
            fill={color}
            stroke="#090d16"
            strokeWidth="1.5"
          />
          <circle cx="16" cy="16" r="3.5" fill="#ffffff" opacity="0.85" />
        </svg>
      );
    }

    if (cat === 'WHEELS') {
      if (k === 'SKI_SLIDER') {
        return (
          <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
            <path d="M4 22 L24 22 Q29 22 29 16" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
            <rect x="12" y="12" width="5" height="10" fill="#94a3b8" />
          </svg>
        );
      }
      return (
        <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
          <circle cx="16" cy="16" r="11" fill="#1e293b" stroke={color} strokeWidth="2.5" />
          <circle cx="16" cy="16" r="5" fill={color} />
          <line x1="16" y1="3" x2="16" y2="8" stroke="#94a3b8" strokeWidth="2" />
          <line x1="16" y1="24" x2="16" y2="29" stroke="#94a3b8" strokeWidth="2" />
          <line x1="3" y1="16" x2="8" y2="16" stroke="#94a3b8" strokeWidth="2" />
          <line x1="24" y1="16" x2="29" y2="16" stroke="#94a3b8" strokeWidth="2" />
        </svg>
      );
    }
    if (cat === 'PROPULSION') {
      if (k === 'VTOL_ROTOR' || k === 'PROP_AERO' || k === 'BOAT_PROP' || k === 'BOAT_OUTBOARD') {
        return (
          <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
            <rect x="3" y="14" width="26" height="4" rx="2" fill={color} />
            <rect x="14" y="3" width="4" height="26" rx="2" fill={color} opacity="0.8" />
            <circle cx="16" cy="16" r="4" fill="#facc15" />
          </svg>
        );
      }
      return (
        <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
          <polygon points="6,8 21,11 21,21 6,24" fill="#334155" stroke={color} strokeWidth="2" />
          <polygon points="21,12 30,9 26,16 30,23 21,20" fill="#facc15" />
          <circle cx="12" cy="16" r="3.2" fill={color} />
        </svg>
      );
    }
    if (cat === 'MECHANICAL') {
      if (k === 'SUSPENSION') {
        return (
          <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
            <rect x="9" y="4" width="14" height="4" rx="1" fill="#94a3b8" />
            <polyline points="10,8 22,12 10,16 22,20 10,24" fill="none" stroke={color} strokeWidth="2.5" />
            <rect x="9" y="24" width="14" height="4" rx="1" fill="#94a3b8" />
          </svg>
        );
      }
      if (k === 'GYRO' || k === 'GYRO_REACTION') {
        return (
          <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
            <ellipse cx="16" cy="16" rx="12" ry="6" fill="none" stroke={color} strokeWidth="2.2" />
            <ellipse cx="16" cy="16" rx="6" ry="12" fill="none" stroke="#facc15" strokeWidth="1.8" />
            <circle cx="16" cy="16" r="3.5" fill={color} />
          </svg>
        );
      }
      return (
        <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
          <rect x="4" y="11" width="11" height="10" rx="2" fill={color} stroke="#0f172a" strokeWidth="1.5" />
          <rect x="15" y="14" width="10" height="4" fill="#e2e8f0" />
          <rect x="24" y="10" width="4" height="12" rx="1" fill="#facc15" />
        </svg>
      );
    }
    if (cat === 'SEATS') {
      return (
        <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
          <path d="M8 7 L13 7 L14 20 L25 20 L25 25 L8 25 Z" fill={color} stroke="#090d16" strokeWidth="1.5" />
          <path d="M14 9 L24 14 L24 19 L14 19 Z" fill="#7dd3fc" opacity="0.75" />
        </svg>
      );
    }
    if (cat === 'AERODYNAMICS') {
      return (
        <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
          <polygon points="4,24 28,24 26,9 10,15" fill={color} stroke="#0f172a" strokeWidth="1.5" />
          <polyline points="4,24 10,15 26,9" fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.6" />
        </svg>
      );
    }
    if (cat === 'LOGIC') {
      return (
        <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
          <rect x="6" y="6" width="20" height="20" rx="3" fill="#0f172a" stroke={color} strokeWidth="2" />
          <circle cx="16" cy="16" r="4.5" fill={color} />
          <line x1="16" y1="2" x2="16" y2="6" stroke="#facc15" strokeWidth="2" />
          <line x1="26" y1="16" x2="30" y2="16" stroke="#facc15" strokeWidth="2" />
        </svg>
      );
    }
    if (cat === 'WEAPONS') {
      return (
        <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
          <rect x="5" y="12" width="13" height="10" rx="2" fill={color} stroke="#090d16" strokeWidth="1.5" />
          <rect x="18" y="14" width="11" height="5" fill="#94a3b8" />
          <circle cx="11" cy="17" r="2.5" fill="#facc15" />
        </svg>
      );
    }
    // Isometric 3D Voxel Block Cube (Chassis & Buoyancy)
    return (
      <svg width="24" height="24" viewBox="0 0 32 32" className="mx-auto">
        <polygon points="16,4 28,10 16,16 4,10" fill={color} stroke="#090d16" strokeWidth="1.4" />
        <polygon points="4,10 16,16 16,28 4,22" fill={color} opacity="0.82" stroke="#090d16" strokeWidth="1.4" />
        <polygon points="28,10 16,16 16,28 28,22" fill={color} opacity="0.62" stroke="#090d16" strokeWidth="1.4" />
      </svg>
    );
  };

  const toastTopOffsetPx = isMobilePopup || isMobileHud ? 8 : 54;

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#162231] select-none">
      {/* Isolated WebGL Canvas Mount */}
      <div
        ref={mountRef}
        data-testid="voxel-canvas-container"
        className="absolute inset-0 z-0 block"
      />

      {/* 3D Preview Models Overlay Canvas (Renders rotating 3D models in front of item cards, strictly below menus & modals) */}
      <canvas
        ref={previewOverlayCanvasRef}
        id="preview-overlay-canvas"
        data-testid="preview-overlay-canvas"
        style={{
          visibility:
            hud.isBuildMode && !isScreenshotMode && !anyOverlayMenuOpen
              ? 'visible'
              : 'hidden',
        }}
        className="fixed inset-0 pointer-events-none z-[60] w-full h-full"
      />

      {/* 2D Screen-Space Marquee Multi-Select Box Overlay (Point A -> Point B) */}
      <div
        ref={marqueeBoxRef}
        data-testid="marquee-selection-box"
        style={{ display: 'none' }}
        className="fixed z-30 pointer-events-none border-2 border-[#38bdf8] bg-[#38bdf8]/15 rounded-sm shadow-[0_0_18px_rgba(56,189,248,0.45)]"
      >
        <span
          ref={marqueeBadgeRef}
          className="absolute -top-5 left-0 bg-[#38bdf8] text-[#090d16] font-mono-num font-extrabold text-[9.5px] px-1.5 py-0.5 rounded-t whitespace-nowrap shadow"
        >
          BOX SELECT: 0
        </span>
      </div>

      {/* High-Tech Initial Loading Screen for Auto-Start / Direct Launch */}
      {initialAutoStart && !spawnChunkReady && (
        <div
          data-testid="autostart-loading-overlay"
          className="fixed inset-0 z-50 bg-[#1a1a1a] flex flex-col items-center justify-center p-6 text-[#e5e5e5]"
        >
          <div className="max-w-md w-full bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-6 text-center">
            <h1 className="text-2xl font-display font-black text-[#fbbf24] tracking-wider mb-2 uppercase">
              VOXELMAKERS
            </h1>
            <p className="text-xs text-[#e5e5e5] font-mono-num mb-4 uppercase">
              PROVING GROUNDS &amp; RIG PHYSICS SANDBOX
            </p>
            <div className="w-full h-2.5 bg-[#262626] rounded-[2px] overflow-hidden border-2 border-[#444444] mb-3">
              <div
                className="h-full bg-[#fbbf24] transition-all duration-300"
                style={{ width: `${initialLoadingPct}%` }}
              />
            </div>
            <p className="text-[11px] font-mono-num text-[#fbbf24] flex items-center justify-center gap-2 uppercase">
              <span className="w-3.5 h-3.5 border-2 border-[#fbbf24] border-t-transparent rounded-[2px] animate-spin shrink-0" />
              <span>{initialLoadingStage} ({initialLoadingPct}%)</span>
            </p>
          </div>
        </div>
      )}

      {/* =====================================================================
          1. INDUSTRIAL BLUEPRINT TITLE SCREEN OVERLAY
          ===================================================================== */}
      {gameState === 'title' && !showFastTravelMap && (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-between p-4 sm:p-7 pointer-events-auto overflow-y-auto"
          style={{
            background:
              'linear-gradient(90deg, rgba(26,26,26,0.95) 0%, rgba(26,26,26,0.68) 44%, rgba(26,26,26,0.12) 100%)',
          }}
        >
          {/* Left Streamlined Industrial Blueprint Panel */}
          <div className="max-w-md bg-[#1a1a1a]/95 border-2 border-[#444444] rounded-[2px] p-4 sm:p-5 shadow-2xl">
            {/* Top Header Badges */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="inline-block bg-[#fbbf24] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-[10px] tracking-widest px-2.5 py-0.5 uppercase">
                0.25M VOXEL SANDBOX
              </div>
              <button
                type="button"
                data-testid="title-touch-mode-toggle"
                onClick={() => {
                  const order: TouchModeOverride[] = ['AUTO', 'ON', 'OFF'];
                  const next =
                    order[(order.indexOf(touchOverrideState) + 1) % order.length];
                  setTouchModeOverride(next);
                }}
                className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer uppercase"
                title="Cycle Mobile Touch Controls (Auto / Force ON / Force OFF)"
              >
                TOUCH: {touchOverrideState}
              </button>
            </div>

            <svg
              viewBox="0 0 560 90"
              className="w-full max-w-[350px] h-auto mb-2"
              role="img"
              aria-label="VoxelMakers Micro-Voxel Engineering Sandbox"
            >
              <g transform="translate(4, 4)">
                <polygon
                  points="38,4 72,21 38,38 4,21"
                  fill="#fbbf24"
                  stroke="#1a1a1a"
                  strokeWidth="3"
                />
                <polygon
                  points="4,21 38,38 38,76 4,59"
                  fill="#6b7280"
                  stroke="#1a1a1a"
                  strokeWidth="3"
                />
                <polygon
                  points="72,21 38,38 38,76 72,59"
                  fill="#facc15"
                  stroke="#1a1a1a"
                  strokeWidth="3"
                />
                <circle
                  cx="38"
                  cy="38"
                  r="7"
                  fill="#e5e5e5"
                  stroke="#1a1a1a"
                  strokeWidth="2.5"
                />
              </g>
              <text
                x="90"
                y="48"
                fill="#e5e5e5"
                fontFamily="Space Grotesk, Chakra Petch, sans-serif"
                fontWeight="700"
                fontSize="44"
                letterSpacing="2"
              >
                VOXELMAKERS
              </text>
              <text
                x="92"
                y="72"
                fill="#fbbf24"
                fontFamily="JetBrains Mono, monospace"
                fontWeight="700"
                fontSize="12"
                letterSpacing="2"
              >
                BUILD RIGS · SHRED HAZARDS · TERRAFORM WORLDS
              </text>
            </svg>

            {/* Primary CTA Buttons Right Up Front */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                data-start="true"
                disabled={!spawnChunkReady}
                onClick={() => simRef.current?.startGame()}
                className={`py-2.5 px-4 font-display font-extrabold text-sm tracking-wider uppercase rounded-[2px] whitespace-nowrap flex items-center justify-center gap-2 ${
                  spawnChunkReady
                    ? 'bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] hazard-stripe-border cursor-pointer'
                    : 'bg-[#262626] text-[#6b7280] border-2 border-[#444444] cursor-not-allowed opacity-80'
                }`}
              >
                {!spawnChunkReady ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-[#fbbf24] border-t-transparent rounded-full animate-spin shrink-0" />
                    <span>LOADING ({initialLoadingPct}%)</span>
                  </>
                ) : (
                  <span>DRIVE [ENTER]</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  simRef.current?.startGame();
                  simRef.current?.toggleHoverBuildMode(true);
                }}
                className="py-2.5 px-4 bg-[#262626] hover:bg-[#333333] text-[#fbbf24] border-2 border-[#fbbf24] font-display font-extrabold text-sm tracking-wider uppercase rounded-[2px] cursor-pointer whitespace-nowrap"
              >
                BUILD RIG [B]
              </button>
            </div>

            {/* High-Tech Initial Loading Status Card */}
            {!spawnChunkReady && (
              <div
                data-testid="initial-loading-card"
                className="mb-3 bg-[#242424] border border-[#444444] rounded-[2px] p-2"
              >
                <div className="flex items-center justify-between text-[10px] font-mono-num mb-1">
                  <span className="text-[#fbbf24] font-bold flex items-center gap-1.5 truncate uppercase">
                    <span className="w-2.5 h-2.5 border-2 border-[#fbbf24] border-t-transparent rounded-full animate-spin shrink-0" />
                    {initialLoadingStage}
                  </span>
                  <span className="text-[#facc15] font-extrabold shrink-0 ml-2">
                    {initialLoadingPct}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#1a1a1a] rounded-[2px] overflow-hidden border border-[#444444]">
                  <div
                    className="h-full bg-[#fbbf24] transition-all duration-300"
                    style={{ width: `${initialLoadingPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Compact Vehicle Selector Row + Collapsible All-Rigs Drawer */}
            <div className="bg-[#242424] border border-[#444444] rounded-[2px] p-2.5 mb-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase tracking-wider">
                    VEHICLE ({hud.presetIndex + 1}/{PRESET_NAMES.length}) · {hud.massKg}KG · {hud.voxelCount + hud.moduleCount} BLK
                  </div>
                  <div className="text-xs font-display font-extrabold text-[#fbbf24] truncate uppercase">
                    {hud.presetName}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      simRef.current?.selectPreset(
                        (hud.presetIndex - 1 + PRESET_NAMES.length) %
                          PRESET_NAMES.length,
                      )
                    }
                    className="px-2 py-1 bg-[#1a1a1a] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[11px] font-mono-num font-bold cursor-pointer"
                    title="Previous Vehicle Preset"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      simRef.current?.selectPreset(
                        (hud.presetIndex + 1) % PRESET_NAMES.length,
                      )
                    }
                    className="px-2 py-1 bg-[#1a1a1a] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[11px] font-mono-num font-bold cursor-pointer"
                    title="Next Vehicle Preset [P]"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTitleVehiclesDrawer((v) => !v)}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowTitleVehiclesDrawer((v) => !v);
                    }}
                    className={`px-2.5 py-1 border rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer touch-manipulation ${
                      showTitleVehiclesDrawer
                        ? 'bg-[#dc2626] text-[#e5e5e5] border-[#444444]'
                        : 'bg-[#1a1a1a] hover:bg-[#333333] text-[#fbbf24] border-[#444444]'
                    }`}
                  >
                    {showTitleVehiclesDrawer ? '✕ CLOSE' : 'LIST ▾'}
                  </button>
                </div>
              </div>

              {showTitleVehiclesDrawer && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2 pt-2 border-t border-[#383838] max-h-[34dvh] overflow-y-auto overscroll-contain touch-pan-y pr-1">
                  {PRESET_NAMES.map((name, idx) => {
                    const isActive = hud.presetIndex === idx;
                    const isScratch = idx === PRESET_NAMES.length - 1;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          simRef.current?.selectPreset(idx);
                          setShowTitleVehiclesDrawer(false);
                        }}
                        className={`px-2 py-1.5 rounded-[2px] text-left text-[10.5px] font-display font-bold uppercase cursor-pointer truncate border touch-manipulation ${
                          isActive
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                            : isScratch
                            ? 'bg-[#dc2626] text-[#e5e5e5] border-[#444444]'
                            : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Compact Game Mode Selector Row + Collapsible Modes Drawer */}
            <div className="bg-[#242424] border border-[#444444] rounded-[2px] p-2.5 mb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase tracking-wider">
                    ACTIVE GAME MODE
                  </div>
                  <div className="text-xs font-display font-extrabold text-[#e5e5e5] truncate uppercase flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: ModRegistry.getActiveGameMode().badgeColor,
                      }}
                    />
                    <span>{ModRegistry.getActiveGameMode().name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowTitleModesDrawer((v) => !v)}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowTitleModesDrawer((v) => !v);
                    }}
                    className={`px-2.5 py-1 border rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer touch-manipulation ${
                      showTitleModesDrawer
                        ? 'bg-[#dc2626] text-[#e5e5e5] border-[#444444]'
                        : 'bg-[#1a1a1a] hover:bg-[#333333] text-[#fbbf24] border-[#444444]'
                    }`}
                  >
                    {showTitleModesDrawer ? '✕ CLOSE' : 'CHANGE MODE ▾'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowModStudioModal(true)}
                    className="px-2 py-1 bg-[#1a1a1a] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-mono-num font-bold uppercase cursor-pointer"
                    title="Open Custom Mods & Shader Studio [F4]"
                  >
                    MODS [F4]
                  </button>
                </div>
              </div>

              {showTitleModesDrawer && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2 pt-2 border-t border-[#383838] max-h-[34dvh] overflow-y-auto overscroll-contain touch-pan-y pr-1">
                  {ModRegistry.gameModes
                    .filter(
                      (gm) =>
                        gm.id === 'SANDBOX_FREEPLAY' ||
                        gm.id === 'CHECKPOINT_TIME_TRIAL' ||
                        gm.id === 'DESTRUCTION_DERBY' ||
                        gm.id === 'BUILDING_CHALLENGE' ||
                        gm.id === 'CAPTURE_THE_FLAG' ||
                        gm.id === 'BUILD_BATTLE' ||
                        gm.id === 'SURVIVAL_WAVES' ||
                        gm.id === 'KING_OF_THE_HILL' ||
                        gm.id === 'SHREDDER_GAUNTLET' ||
                        gm.id === 'STUNT_FREESTYLE' ||
                        gm.id === 'JUGGERNAUT_BOSS',
                    )
                    .map((gm) => {
                      const isActive = ModRegistry.activeGameModeId === gm.id;
                      return (
                        <button
                          key={gm.id}
                          type="button"
                          data-testid={`title-gamemode-${gm.id}`}
                          onClick={() => {
                            activateGameModeAndSetupWorld(gm.id);
                            setShowTitleModesDrawer(false);
                          }}
                          className={`px-2 py-1.5 rounded-[2px] text-left text-[10px] font-mono-num font-bold uppercase cursor-pointer truncate border touch-manipulation ${
                            isActive
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                              : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                          }`}
                        >
                          {gm.name}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Secondary Utility Row: World Saves, Map, Multiplayer, GLB Import */}
            <div className="pt-2.5 border-t border-[#444444] flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="open-choose-map-btn"
                  onClick={() => setShowChooseMapModal(true)}
                  className="px-2.5 py-1 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] font-display font-bold text-[10px] uppercase rounded-[2px] cursor-pointer whitespace-nowrap"
                >
                  MAPS ({savedGlbMaps.length + 1})
                </button>
                <button
                  type="button"
                  onClick={() => setShowWorldGenModal(true)}
                  className="px-2.5 py-1 bg-[#262626] hover:bg-[#333333] text-[#4ade80] border border-[#444444] font-display font-bold text-[10px] uppercase rounded-[2px] cursor-pointer whitespace-nowrap"
                >
                  SAVED WORLDS ({savedCustomWorlds.length})
                </button>
                <button
                  type="button"
                  data-testid="open-tactical-map-title-btn"
                  onClick={() => {
                    simRef.current?.initTacticalMapCam();
                    setShowFastTravelMap(true);
                  }}
                  className="px-2.5 py-1 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] font-display font-bold text-[10px] uppercase rounded-[2px] cursor-pointer whitespace-nowrap"
                >
                  MAP [F]
                </button>
                <button
                  type="button"
                  data-testid="title-open-multiplayer-btn"
                  onClick={() => {
                    simRef.current?.startGame();
                    setShowMultiplayerModal(true);
                  }}
                  className="px-2.5 py-1 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] font-display font-bold text-[10px] uppercase rounded-[2px] cursor-pointer whitespace-nowrap"
                >
                  MULTIPLAYER [M]
                </button>
              </div>

              <label
                data-testid="title-upload-glb-label"
                className={`px-2.5 py-1 border border-[#444444] ${
                  isVoxelizingGlb
                    ? 'bg-[#6b7280] text-[#e5e5e5]'
                    : 'bg-[#262626] hover:bg-[#333333] text-[#fbbf24]'
                } font-display font-bold text-[10px] uppercase rounded-[2px] cursor-pointer whitespace-nowrap shrink-0`}
              >
                {isVoxelizingGlb
                  ? `GLB (${glbProgress.pct}%)...`
                  : '+ .GLB MAP'}
                <input
                  data-testid="title-upload-glb-input"
                  type="file"
                  accept=".glb,.gltf"
                  disabled={isVoxelizingGlb}
                  onChange={(e) => handleGlbModelUpload(e, true)}
                  className="hidden"
                />
              </label>
            </div>

            {isVoxelizingGlb && (
              <div
                data-testid="title-glb-progress-container"
                className="mt-2 bg-[#242424] border border-[#444444] rounded-[2px] p-2"
              >
                <div className="flex items-center justify-between text-[9.5px] font-mono-num mb-1">
                  <span className="text-[#e5e5e5] font-bold truncate pr-2 uppercase">
                    {glbProgress.stage || 'Processing 3D mesh on GPU...'}
                  </span>
                  <span className="text-[#fbbf24] font-bold shrink-0">
                    {glbProgress.pct}% DONE
                  </span>
                </div>
                <div className="w-full h-2 bg-[#1a1a1a] rounded-[2px] overflow-hidden border border-[#444444]">
                  <div
                    data-testid="title-glb-progress-bar"
                    className="h-full bg-[#fbbf24] transition-all duration-150"
                    style={{ width: `${Math.max(4, Math.min(100, glbProgress.pct))}%` }}
                  />
                </div>
              </div>
            )}

            {worldGenFeedback && !isVoxelizingGlb && (
              <div className="text-[10px] font-mono-num text-[#facc15] mt-1.5">
                {worldGenFeedback}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          2. PLAYING HUD (Industrial Blueprint Theme · Sharp & Mechanical)
          ===================================================================== */}
      {(gameState === 'playing' || showHudEditorModal) && !isScreenshotMode && !showFastTravelMap && (
        <div className="fixed inset-0 pointer-events-none flex flex-col justify-between p-2.5">
          {/* Center Aim Reticle (Driving / On-Foot / World Editor) */}
          {!hud.isBuildMode && !isMobileHud && (
            <div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20"
              aria-hidden="true"
            >
              <svg width="22" height="22" viewBox="0 0 22 22">
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                  fill="none"
                  stroke={hud.isWorldEditMode ? '#fbbf24' : '#facc15'}
                  strokeWidth="1.6"
                  opacity="0.9"
                />
                <circle cx="11" cy="11" r="1.8" fill="#e5e5e5" />
              </svg>
            </div>
          )}

          {/* Hold [R] to Fully Repair Vehicle Progress Indicator */}
          {rHoldProgress > 0 && (
            <div
              data-testid="r-hold-repair-indicator"
              className="fixed top-[46%] left-1/2 -translate-x-1/2 z-50 bg-[#1a1a1a]/95 border-2 border-[#fbbf24] px-4 py-2.5 rounded-[2px] shadow-2xl flex flex-col items-center gap-1.5 min-w-[220px] pointer-events-none"
            >
              <div className="flex items-center justify-between w-full text-[11px] font-display font-extrabold uppercase text-[#fbbf24] tracking-wider">
                <span>REPAIRING RIG</span>
                <span>{Math.round(rHoldProgress * 100)}%</span>
              </div>
              <div className="w-full h-2.5 bg-[#2a2a2a] rounded-[2px] overflow-hidden border border-[#444444]">
                <div
                  className="h-full bg-[#fbbf24] transition-all duration-75"
                  style={{ width: `${Math.round(rHoldProgress * 100)}%` }}
                />
              </div>
              <div className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase tracking-wide">
                HOLD [R] FULL REPAIR · RELEASE TO CALL/UPRIGHT
              </div>
            </div>
          )}

          {/* =================================================================
              A. INDUSTRIAL BLUEPRINT BUILD MODE & OBJECT STUDIO HUD
              ================================================================= */}
          {hud.isBuildMode ? (
            isMobileHud ? null : (
            <>
              {/* TOP BAR: Compact Industrial Blueprint Telemetry + Action Strip */}
              <div className={`relative flex items-start justify-between gap-2 ${showBuildMoreTools ? 'z-[85]' : 'z-20'}`}>
                {/* Top-Left Compact Industrial Blueprint Spec Box */}
                <div
                  data-hud-widget="build-spec-box"
                  data-hud-label="BUILD SPEC BOX"
                  style={getWidgetTransformStyle(hudCustom, 'build-spec-box', undefined, 'top left')}
                  className={`bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-[#e5e5e5] pointer-events-auto flex flex-col gap-1 min-w-[235px] shrink-0 ${
                    getWidgetState(hudCustom, 'build-spec-box').visible ? '' : 'hidden'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 border-b-2 border-[#444444] bg-[#222222] -mx-2.5 -mt-1.5 px-2.5 py-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (hud.isObjectStudioMode) simRef.current?.toggleObjectStudioMode(false);
                        }}
                        className={`font-display font-extrabold text-[10px] px-2 py-0.5 rounded-[2px] uppercase cursor-pointer border ${
                          !hud.isObjectStudioMode
                            ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#262626] text-[#a3a3a3] border-[#444444] hover:text-[#e5e5e5]'
                        }`}
                      >
                        VEHICLE
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!hud.isObjectStudioMode) simRef.current?.toggleObjectStudioMode(true);
                        }}
                        className={`font-display font-extrabold text-[10px] px-2 py-0.5 rounded-[2px] uppercase cursor-pointer border ${
                          hud.isObjectStudioMode
                            ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#262626] text-[#a3a3a3] border-[#444444] hover:text-[#e5e5e5]'
                        }`}
                      >
                        PROP MAKER
                      </button>
                      <span
                        data-testid="active-preset-name"
                        className="text-xs font-display font-bold text-[#facc15] truncate max-w-[110px] uppercase ml-1"
                      >
                        {hud.isObjectStudioMode
                          ? objectStudioName || 'PROP STUDIO'
                          : hud.presetName}
                      </span>
                    </div>
                    <span
                      ref={fpsBadgeRef}
                      data-testid="fps-counter"
                      className="text-[10px] font-mono-num font-bold text-[#facc15] bg-[#1a1a1a] border-2 border-[#444444] px-1.5 py-0.5 rounded-[2px] min-w-[92px] text-center inline-block tabular-nums"
                    >
                      <LiveHudField select={selectFpsFrameMs} />
                    </span>
                  </div>

                  {/* Compact Single-Row Stats + Blueprint Actions */}
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono-num">
                    <div className="flex items-center gap-2">
                      <span className="text-[#a3a3a3]">
                        WT:{' '}
                        <strong data-testid="stat-mass" className="text-[#e5e5e5]">
                          {hud.massKg}kg
                        </strong>
                      </span>
                      <span className="text-[#a3a3a3]">
                        PWR:{' '}
                        <strong className="text-[#facc15]">
                          {hud.powerCores}
                        </strong>
                      </span>
                      <span className="text-[#a3a3a3]">
                        BLK:{' '}
                        <strong
                          data-testid="stat-parts"
                          className="text-[#fbbf24]"
                        >
                          {hud.voxelCount + hud.moduleCount}
                        </strong>
                      </span>
                    </div>
                    {!hud.isObjectStudioMode && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.currentTarget.blur();
                            simRef.current?.selectPreset(hud.presetIndex + 1);
                          }}
                          className="px-1.5 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                        >
                          RIG [P]
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="open-garage-btn"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            setBlueprintNameInput(hud.presetName);
                            setGarageFeedback('');
                            setShowGarageModal(true);
                          }}
                          className="px-1.5 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-[10px] cursor-pointer"
                        >
                          GARAGE [O]
                        </button>
                      </div>
                    )}
                  </div>

                  {/* CoM / CoL / CoT Force Vector Legend (Auto-hides 3D spheres when <12 blocks so voxels are never covered!) */}
                  {!hud.isObjectStudioMode && (
                    <div
                      data-testid="force-markers-status-bar"
                      className="flex items-center justify-between gap-2 text-[9px] font-mono-num bg-[#141414] px-2 py-0.5 rounded-[2px] border border-[#444444]"
                    >
                      {!hud.showForces ? (
                        <span className="text-[#a3a3a3]">
                          CoM / CoL / CoT MARKERS: OFF [N]
                        </span>
                      ) : hud.voxelCount + hud.moduleCount <
                        ModularVehicleRig.MIN_BLOCKS_FOR_FORCE_MARKERS ? (
                        <span className="text-[#fbbf24]">
                          CoM/CoT: AUTO-HIDDEN (&lt;12 BLK SO VOXELS STAY VISIBLE)
                        </span>
                      ) : (
                        <>
                          <span className="text-[#facc15]">CoM MASS</span>
                          <span className="text-[#38bdf8]">CoL LIFT</span>
                          <span className="text-[#f97316]">CoT THRUST</span>
                        </>
                      )}
                      <span className="text-[#a3a3a3] ml-auto">
                        {hud.dimensionsMeters}
                      </span>
                    </div>
                  )}
                </div>

                {/* Top-Right Streamlined Industrial Builder Action Bar */}
                <div
                  data-hud-widget="build-top-toolbar"
                  data-hud-label="BUILD TOP TOOLS"
                  style={getWidgetTransformStyle(hudCustom, 'build-top-toolbar', undefined, 'top right')}
                  className={`flex flex-col items-end gap-1 pointer-events-auto ${
                    getWidgetState(hudCustom, 'build-top-toolbar').visible ? '' : 'hidden'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-end gap-1 bg-[#1a1a1a] border-2 border-[#444444] p-1.5 rounded-[2px]">
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-build-btn"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.toggleHoverBuildMode(false);
                      }}
                      className="hazard-stripe-border bg-[#fbbf24] hover:bg-[#facc15] px-2.5 py-1 text-[#1a1a1a] rounded-[2px] font-display font-extrabold text-[11px] uppercase tracking-wide transition cursor-pointer whitespace-nowrap"
                    >
                      {hud.isObjectStudioMode
                        ? 'EXIT STUDIO'
                        : 'TEST DRIVE [B]'}
                    </button>

                    {!hud.isObjectStudioMode ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="scratch-build-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          simRef.current?.startVehicleFromSingleVoxel();
                        }}
                        className="px-2 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase transition cursor-pointer whitespace-nowrap"
                      >
                        1-VOXEL SCRATCH
                      </button>
                    ) : (
                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="test-drive-prop-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          simRef.current?.testDriveAgainstCurrentProp();
                        }}
                        className="px-2 py-1 bg-[#22c55e] hover:bg-[#16a34a] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase transition cursor-pointer whitespace-nowrap"
                      >
                        SPAWN &amp; DRIVE
                      </button>
                    )}

                    {/* Dedicated CoM / CoL / CoT Force Markers Toggle Button [N] */}
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-forces-btn"
                      title="Toggle Center of Mass (CoM), Center of Lift (CoL), and Center of Thrust (CoT) 3D markers [N] (Auto-hidden when <12 blocks)"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.toggleForcesOverlay();
                      }}
                      className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                        hud.showForces
                          ? hud.voxelCount + hud.moduleCount <
                            ModularVehicleRig.MIN_BLOCKS_FOR_FORCE_MARKERS
                            ? 'bg-[#262626] text-[#fbbf24] border-[#fbbf24]'
                            : 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                          : 'bg-[#262626] text-[#a3a3a3] border-[#444444]'
                      }`}
                    >
                      {hud.showForces
                        ? hud.voxelCount + hud.moduleCount <
                          ModularVehicleRig.MIN_BLOCKS_FOR_FORCE_MARKERS
                          ? 'CoM:AUTO(<12) [N]'
                          : 'CoM/CoT:ON [N]'
                        : 'CoM/CoT:OFF [N]'}
                    </button>

                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-symmetry-btn"
                      title="Cycle Multi-Axis Symmetry: Left-Right (X) · 4-Way Quad (X+Z) · Front-Back (Z) · Off [M]"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.cycleSymmetryAxisMode();
                      }}
                      className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                        hud.symmetryAxisMode !== 'OFF'
                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                          : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      SYM:{hud.symmetryAxisMode} [M]
                    </button>

                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-xray-btn"
                      title="Toggle X-Ray Hull Cutaway — makes outer hull walls translucent and lets raycasts pass through upper walls to place/select internal engines & seats [X]"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.toggleXrayMode();
                      }}
                      className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                        hud.xrayMode
                          ? 'bg-[#38bdf8] text-[#1a1a1a] border-[#e5e5e5]'
                          : 'bg-[#262626] text-[#a3a3a3] border-[#444444] hover:text-[#e5e5e5]'
                      }`}
                    >
                      X-RAY:{hud.xrayMode ? 'ON' : 'OFF'} [X]
                    </button>

                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-eyedropper-btn"
                      title="Eyedropper / Pipette — click any block or module on the vehicle to sample its material, 3D rotation, and scale [I or Alt+Click]"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.toggleEyedropperMode();
                      }}
                      className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                        hud.eyedropperMode
                          ? 'bg-[#22c55e] text-[#1a1a1a] border-[#e5e5e5]'
                          : 'bg-[#262626] text-[#a3a3a3] border-[#444444] hover:text-[#e5e5e5]'
                      }`}
                    >
                      PICK [I]
                    </button>

                    {(selectedBuildSlotItem.type === 'module' || selectedCount > 0) && (
                      <>
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="rotate-yaw-btn"
                          title="Rotate Y (Yaw) 90° [R]"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            if (selectedCount > 0) {
                              simRef.current?.rotateSelectedObject('yaw');
                            } else {
                              simRef.current?.rotatePartAxis('yaw');
                            }
                          }}
                          className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                        >
                          ROT Y:{DIR_NAMES[hud.partYawIndex]} [R]
                        </button>

                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="rotate-pitch-btn"
                          title="Rotate X (Pitch) 90° [T]"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            if (selectedCount > 0) {
                              simRef.current?.rotateSelectedObject('pitch');
                            } else {
                              simRef.current?.rotatePartAxis('pitch');
                            }
                          }}
                          className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                        >
                          ROT X:{AXIS_ROT_NAMES[hud.partPitchIndex]} [T]
                        </button>

                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="rotate-roll-btn"
                          title="Rotate Z (Roll) 90° [Y]"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            if (selectedCount > 0) {
                              simRef.current?.rotateSelectedObject('roll');
                            } else {
                              simRef.current?.rotatePartAxis('roll');
                            }
                          }}
                          className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                        >
                          ROT Z:{AXIS_ROT_NAMES[hud.partRollIndex]} [Y]
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="undo-build-btn"
                      disabled={hud.undoCount === 0}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.undoBuildStep();
                      }}
                      className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase transition whitespace-nowrap border-2 ${
                        hud.undoCount > 0
                          ? 'bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-[#444444] cursor-pointer'
                          : 'bg-[#262626] text-[#737373] border-[#444444] cursor-not-allowed'
                      }`}
                    >
                      UNDO({hud.undoCount}) [Z]
                    </button>

                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="redo-build-btn"
                      disabled={hud.redoCount === 0}
                      title="Redo Build Step [Shift+Z or Ctrl+Y]"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.redoBuildStep();
                      }}
                      className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase transition whitespace-nowrap border-2 ${
                        hud.redoCount > 0
                          ? 'bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-[#444444] cursor-pointer'
                          : 'bg-[#262626] text-[#737373] border-[#444444] cursor-not-allowed'
                      }`}
                    >
                      REDO({hud.redoCount}) [⇧Z]
                    </button>

                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-build-more-tools-btn"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        setShowBuildMoreTools((v) => !v);
                      }}
                      className={`px-2 py-1 rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer whitespace-nowrap border-2 ${
                        showBuildMoreTools
                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                          : 'bg-[#262626] hover:bg-[#333333] text-[#fbbf24] border-[#444444]'
                      }`}
                    >
                      TOOLS {showBuildMoreTools ? '▴' : '▾'}
                    </button>
                  </div>

                  {/* Collapsible Secondary Studio & View Tools Drawer */}
                  {showBuildMoreTools && (
                    <div className="relative z-[90] flex flex-wrap items-center justify-end gap-1 bg-[#1a1a1a]/95 border-2 border-[#fbbf24] p-1.5 rounded-[2px] shadow-xl">
                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="toggle-object-studio-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          simRef.current?.toggleObjectStudioMode();
                        }}
                        className={`px-2 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase transition cursor-pointer whitespace-nowrap border-2 ${
                          hud.isObjectStudioMode
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {hud.isObjectStudioMode ? 'VEHICLE BUILDER' : 'PROP MAKER'}
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="toggle-world-edit-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          simRef.current?.toggleWorldEditMode(true);
                        }}
                        className="px-2 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase transition cursor-pointer whitespace-nowrap"
                      >
                        WORLD EDIT
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="open-mod-studio-build-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          setModStudioFeedback('');
                          setShowModStudioModal(true);
                        }}
                        className="px-2 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase transition cursor-pointer whitespace-nowrap"
                      >
                        MODS [F4]
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="build-cam-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          simRef.current?.cycleBuildCameraAngle();
                        }}
                        className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        {BUILD_CAM_LABELS[hud.buildCameraAngle]} [C]
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setDockCollapsed((c) => !c)}
                        className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        {dockCollapsed ? 'SHOW CATALOG' : 'HIDE CATALOG'}
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="build-screenshot-mode-btn"
                        title="Screenshot Mode — Hides UI, freezes simulation & orbits camera [F12]"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          setIsScreenshotMode(true);
                          SoundFX.snap();
                        }}
                        className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        PHOTO [F12]
                      </button>

                      {/* New Builder Power Tools: Wiring Lines, Ghost Blueprint Reference, Sub-Assembly Stamp */}
                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="toggle-wiring-lines-btn"
                        title="Toggle 3D Quick-Wiring Connection Lines between Seats/Sensors and Actuators"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          const rig = simRef.current?.getActiveRig();
                          if (!rig) return;
                          const next = !rig.showWiringOverlay;
                          rig.showWiringOverlay = next;
                          rig.rebuildQuickWiringLines();
                          setShowWiringLines(next);
                          SoundFX.snap();
                        }}
                        className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                          showWiringLines
                            ? 'bg-[#38bdf8] text-[#090d16] border-[#e5e5e5]'
                            : 'bg-[#262626] hover:bg-[#333333] text-[#38bdf8] border-[#444444]'
                        }`}
                      >
                        WIRING: {showWiringLines ? 'ON' : 'OFF'}
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="toggle-ghost-blueprint-btn"
                        title="Project a translucent Ghost Reference Blueprint hologram for tracing or comparing builds"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          const rig = simRef.current?.getActiveRig();
                          if (!rig) return;
                          const next = !ghostBlueprintActive;
                          if (next) {
                            const refBp =
                              savedBlueprints[0] ||
                              rig.exportBlueprint('Reference Hologram');
                            rig.setGhostReferenceBlueprint(refBp);
                          } else {
                            rig.setGhostReferenceBlueprint(null);
                          }
                          setGhostBlueprintActive(next);
                          SoundFX.snap();
                        }}
                        className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                          ghostBlueprintActive
                            ? 'bg-[#38bdf8] text-[#090d16] border-[#e5e5e5]'
                            : 'bg-[#262626] hover:bg-[#333333] text-[#38bdf8] border-[#444444]'
                        }`}
                      >
                        GHOST REF: {ghostBlueprintActive ? 'ON' : 'OFF'}
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="save-subassembly-prefab-btn"
                        title="Save selected blocks/modules (or entire rig) as a reusable Sub-Assembly Stamp"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          const s = simRef.current;
                          if (!s) return;
                          const rig = s.getActiveRig();
                          const prefab = rig.exportSubAssemblyPrefab(
                            `SubAssembly #${savedSubAssemblies.length + 1}`,
                            s.selectedBuildObjects,
                          );
                          if (prefab) {
                            setSavedSubAssemblies((prev) => [prefab, ...prev.slice(0, 7)]);
                            setActiveStampPrefab(prefab);
                          }
                          SoundFX.snap();
                        }}
                        className="px-1.5 py-1 bg-[#22c55e] hover:bg-[#16a34a] text-[#090d16] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer whitespace-nowrap"
                      >
                        + SAVE SUB-ASSEMBLY
                      </button>

                      {savedSubAssemblies.length > 0 && (
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="toggle-stamp-subassembly-btn"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            setActiveStampPrefab((prev) =>
                              prev ? null : savedSubAssemblies[0],
                            );
                            SoundFX.snap();
                          }}
                          className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer whitespace-nowrap border-2 ${
                            activeStampPrefab
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                              : 'bg-[#262626] text-[#facc15] border-[#444444]'
                          }`}
                        >
                          {activeStampPrefab
                            ? `STAMPING: ${activeStampPrefab.name} (CLICK TO PLACE)`
                            : `ARM STAMP (${savedSubAssemblies[0].name})`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Build Mode Challenge / Build Battle Prompt Banner */}
              {(ModRegistry.activeGameModeId === 'BUILDING_CHALLENGE' ||
                ModRegistry.activeGameModeId === 'BUILD_BATTLE') && (
                <div
                  data-testid="build-mode-challenge-banner"
                  className="relative z-20 self-center mt-1 flex flex-wrap items-center gap-2.5 bg-[#1a1a1a] border-2 border-[#444444] px-3.5 py-1.5 rounded-[2px] pointer-events-auto text-xs font-mono-num"
                >
                  {ModRegistry.activeGameModeId === 'BUILDING_CHALLENGE' ? (
                    <>
                      <span className="px-2 py-0.5 bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] rounded-[2px] uppercase">
                        BUILDING CHALLENGE
                      </span>
                      <span className="text-[#facc15] font-bold">
                        {
                          BUILDING_CHALLENGE_PROMPTS[
                            buildingChallengePromptIdx %
                              BUILDING_CHALLENGE_PROMPTS.length
                          ].title
                        }
                      </span>
                      <span className="text-[#e5e5e5] font-bold">
                        TIME {Math.floor(buildingChallengeTimerSec / 60)}:
                        {String(
                          Math.floor(buildingChallengeTimerSec % 60),
                        ).padStart(2, '0')}
                      </span>
                      <button
                        type="button"
                        data-testid="cycle-building-challenge-prompt-btn"
                        onClick={() => {
                          const nextIdx =
                            (buildingChallengePromptIdx + 1) %
                            BUILDING_CHALLENGE_PROMPTS.length;
                          buildingChallengePromptIdxRef.current = nextIdx;
                          setBuildingChallengePromptIdx(nextIdx);
                          setBuildingChallengeTimerSec(300);
                        }}
                        className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                      >
                        NEXT PROMPT
                      </button>
                      <button
                        type="button"
                        data-testid="run-building-challenge-test-btn"
                        onClick={() => startBuildingChallengeAutoTest()}
                        className="px-2.5 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[10.5px] cursor-pointer"
                      >
                        AUTO-TEST BUILD NOW
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="px-2 py-0.5 bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] rounded-[2px] uppercase">
                        BUILD BATTLE ({buildBattleState.phase})
                      </span>
                      <span className="text-[#facc15] font-bold">
                        Prompt: {buildBattleState.prompt}
                      </span>
                      <span className="text-[#e5e5e5] font-bold">
                        TIME {Math.floor(buildBattleState.buildRemainingSec / 60)}:
                        {String(
                          Math.floor(buildBattleState.buildRemainingSec % 60),
                        ).padStart(2, '0')}
                      </span>
                      {buildBattleState.phase === 'BUILD' && (
                        <button
                          type="button"
                          data-testid="start-build-battle-arena-btn"
                          onClick={() => {
                            const started = launchBuildBattleArena(
                              buildBattleStateRef.current,
                              mpState.playerName || 'Pilot_01',
                            );
                            buildBattleStateRef.current = started;
                            setBuildBattleState(started);
                            if (simRef.current?.isBuildMode) {
                              simRef.current.toggleHoverBuildMode(false);
                            }
                          }}
                          className="px-2.5 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[10.5px] cursor-pointer"
                        >
                          SPAWN ARENA NOW
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* MIDDLE WORKSPACE: Left-Side Categorized Block Selector + Right-Side Selected Object & Keybind Inspector */}
              <div className="flex-1 min-h-0 flex items-stretch justify-between gap-3 my-1.5 overflow-hidden pointer-events-none">
                {/* LEFT SIDE: Collapsible Industrial Blueprint Categorized Block Selector */}
                {dockCollapsed && getWidgetState(hudCustom, 'build-left-catalog').visible ? (
                  <button
                    type="button"
                    data-testid="expand-left-catalog-btn"
                    onClick={() => setDockCollapsed(false)}
                    className="relative z-20 self-start bg-[#1a1a1a]/95 hover:bg-[#262626] border-2 border-[#fbbf24] text-[#fbbf24] px-2.5 py-1.5 rounded-[2px] font-display font-extrabold text-[10px] uppercase pointer-events-auto cursor-pointer shadow-lg flex items-center gap-1.5"
                    title="Expand Part Catalog [Tab]"
                  >
                    <span>▶ CATALOG ({activeStudioOrBuildSlots.length}) [TAB]</span>
                  </button>
                ) : null}
                {!dockCollapsed && getWidgetState(hudCustom, 'build-left-catalog').visible && (
                  <div
                    data-testid="left-block-catalog"
                    data-hud-widget="build-left-catalog"
                    data-hud-label="PART CATALOG"
                    data-ui-scroll="true"
                    style={getWidgetTransformStyle(hudCustom, 'build-left-catalog', undefined, 'top left')}
                    onWheel={(e) => e.stopPropagation()}
                    className="relative z-20 w-[320px] sm:w-[340px] h-full max-h-full min-h-0 flex flex-col bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-2 pointer-events-auto overflow-hidden"
                  >
                    {/* Header + Quick Search + Collapse Button */}
                    <div className="flex items-center justify-between gap-1.5 bg-[#222222] border-2 border-[#444444] rounded-[2px] px-2 py-1 mb-1.5 shrink-0">
                      <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] px-1.5 py-0.5 rounded-[2px] uppercase shrink-0">
                        {hud.isObjectStudioMode
                          ? 'STUDIO'
                          : `PARTS (${activeStudioOrBuildSlots.length})`}
                      </span>
                      {!hud.isObjectStudioMode && (
                        <input
                          type="text"
                          value={partSearchQuery}
                          onChange={(e) => setPartSearchQuery(e.target.value)}
                          placeholder={`SEARCH ${BUILD_SLOTS.length} PARTS...`}
                          className="flex-1 min-w-0 bg-[#141414] border-2 border-[#444444] focus:border-[#facc15] rounded-[2px] px-2 py-0.5 text-[10px] font-mono-num text-[#e5e5e5] focus:outline-none"
                        />
                      )}
                      <button
                        type="button"
                        data-testid="collapse-left-catalog-btn"
                        title="Collapse Part Catalog to maximize 3D viewport [Tab]"
                        onClick={() => setDockCollapsed(true)}
                        className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#3a3a3a] text-[#a3a3a3] hover:text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer shrink-0"
                      >
                        ◀ [TAB]
                      </button>
                    </div>

                    {/* Recent Parts Quick-Pick Strip (6 Slots) */}
                    {!hud.isObjectStudioMode && recentBuildSlotIds.length > 0 && (
                      <div
                        data-testid="recent-parts-strip"
                        className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-[#333333] shrink-0 overflow-x-auto"
                      >
                        <span className="text-[8.5px] font-display font-bold uppercase text-[#a3a3a3] shrink-0 mr-0.5">
                          RECENT:
                        </span>
                        {recentBuildSlotIds.slice(0, 6).map((rSlotId) => {
                          const rItem = BUILD_SLOTS[rSlotId - 1];
                          if (!rItem) return null;
                          const isCurrent = hud.selectedSlot === rItem.slot;
                          return (
                            <button
                              key={rItem.slot}
                              type="button"
                              tabIndex={-1}
                              data-testid={`recent-slot-${rItem.slot}`}
                              title={`Quick Equip: ${rItem.name}`}
                              onClick={(e) => {
                                e.currentTarget.blur();
                                sim?.selectSlot(rItem.slot);
                              }}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[8.5px] font-display font-bold uppercase cursor-pointer border truncate max-w-[82px] shrink-0 ${
                                isCurrent
                                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                  : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                              }`}
                            >
                              <span
                                className="w-2 h-2 rounded-[1px] shrink-0"
                                style={{ backgroundColor: rItem.color }}
                              />
                              <span className="truncate">{rItem.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Industrial Category Filter Tabs */}
                    {!hud.isObjectStudioMode && (
                      <div className="grid grid-cols-5 gap-1 pb-1.5 mb-1.5 border-b-2 border-[#444444] shrink-0">
                        {BUILD_CATEGORY_META.map((cat) => {
                          const isActive = buildCategory === cat.id;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              tabIndex={-1}
                              data-testid={`cat-tab-${cat.id}`}
                              title={cat.label}
                              onClick={(e) => {
                                e.currentTarget.blur();
                                setBuildCategory(cat.id);
                              }}
                              className={`px-1.5 py-1 rounded-[2px] text-[10px] font-display font-bold uppercase transition cursor-pointer truncate text-center border-2 ${
                                isActive
                                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                  : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                              }`}
                            >
                              {cat.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Scrollable Part Grid */}
                    <div
                      data-catalog-scroll-container="true"
                      data-ui-scroll="true"
                      onWheel={(e) => e.stopPropagation()}
                      className="flex-1 min-h-0 grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-[8px] overflow-y-auto max-h-[calc(100vh-260px)] pr-1 content-start"
                    >
                      {activeStudioOrBuildSlots.map((item) => {
                        const active = hud.selectedSlot === item.slot;
                        const itemKey = previewRenderer.getItemKey(item);
                        const isHovered = hoveredSlotKey === itemKey;
                        return (
                          <button
                            key={item.slot}
                            type="button"
                            tabIndex={-1}
                            data-testid={`build-slot-${item.slot}`}
                            title={`${item.name} — ${item.tag}`}
                            onMouseEnter={() => handleSlotHover(itemKey)}
                            onMouseLeave={() => {
                              if (hoveredSlotKeyRef.current === itemKey) {
                                handleSlotHover(null);
                              }
                            }}
                            onTouchStart={() => handleSlotHover(itemKey)}
                            onTouchEnd={() => {
                              if (hoveredSlotKeyRef.current === itemKey) {
                                handleSlotHover(null);
                              }
                            }}
                            onClick={(e) => {
                              e.currentTarget.blur();
                              sim?.selectSlot(item.slot);
                            }}
                            className={`relative flex flex-col items-center justify-between p-1.5 h-[112px] min-h-[112px] min-w-[96px] shrink-0 bg-[#222222] rounded-[2px] border-2 transition cursor-pointer overflow-hidden ${
                              active
                                ? 'border-[#facc15] bg-[#2a2a2a]'
                                : isHovered
                                ? 'border-[#fbbf24]'
                                : 'border-[#444444] hover:border-[#fbbf24]'
                            }`}
                          >
                            {/* Top Area: 64x64px 3D Spinning Model Viewport + Corner Badges */}
                            <div className="relative w-full flex items-center justify-center h-[64px] shrink-0">
                              <span
                                className="absolute top-0 left-0 px-1 py-0.5 rounded-[2px] bg-[#141414] border border-[#444444] text-[8px] font-mono-num font-bold leading-none z-10"
                                style={{ color: item.color }}
                              >
                                {item.key ? `[${item.key}]` : `#${item.slot}`}
                              </span>
                              <span className="absolute top-0 right-0 text-[8px] font-mono-num font-bold text-[#a3a3a3] leading-none z-10">
                                {item.massKg}kg
                              </span>

                              {/* Dedicated 64x64px 3D Scissor Viewport Target Container */}
                              <div
                                ref={(node) => {
                                  if (node) {
                                    let set = slotElementsRef.current.get(itemKey);
                                    if (!set) {
                                      set = new Set();
                                      slotElementsRef.current.set(itemKey, set);
                                    }
                                    set.add(node);
                                  }
                                }}
                                data-preview-slot={itemKey}
                                className="w-[64px] h-[64px] shrink-0 flex items-center justify-center relative z-10 bg-transparent"
                              />
                            </div>

                            {/* Bottom Area: Clean Non-Overlapping Part Name & Tag */}
                            <div className="w-full flex flex-col items-center justify-end shrink-0 pt-0.5 border-t border-[#444444] z-10">
                              <div className="w-full text-[9.5px] font-display font-bold text-[#e5e5e5] uppercase text-center truncate leading-tight">
                                {item.name}
                              </div>
                              <div className="w-full text-[8px] font-mono-num text-[#a3a3a3] text-center truncate leading-tight">
                                {item.tag}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* RIGHT SIDE: Collapsible Smart Build Mode Inspector (Auto-expands on selection; collapses to slim pill when idle) */}
                {!hud.isObjectStudioMode &&
                  getWidgetState(hudCustom, 'build-right-inspector').visible &&
                  selectedCount === 0 &&
                  inspectorCollapsed && (
                    <button
                      type="button"
                      data-testid="expand-right-inspector-btn"
                      onClick={() => setInspectorCollapsed(false)}
                      className="relative z-20 self-start ml-auto bg-[#1a1a1a]/95 hover:bg-[#262626] border-2 border-[#fbbf24] text-[#fbbf24] px-2.5 py-1.5 rounded-[2px] font-display font-extrabold text-[10px] uppercase pointer-events-auto cursor-pointer shadow-lg flex items-center gap-1.5"
                      title="Expand Rig Keybind Inspector, ECU & Skins Panel"
                    >
                      <span>◀ INSPECTOR &amp; SKINS ({hud.moduleCount})</span>
                    </button>
                  )}
                {!hud.isObjectStudioMode &&
                  getWidgetState(hudCustom, 'build-right-inspector').visible &&
                  (selectedCount > 0 || !inspectorCollapsed) && (
                    <div
                      data-testid="module-config-panel"
                      data-hud-widget="build-right-inspector"
                      data-hud-label="MODULE INSPECTOR"
                      data-ui-scroll="true"
                      style={getWidgetTransformStyle(hudCustom, 'build-right-inspector', undefined, 'top right')}
                      onWheel={(e) => e.stopPropagation()}
                      className={`relative z-20 w-[290px] sm:w-[310px] max-h-full min-h-0 overflow-y-auto bg-[#1a1a1a] border-2 ${
                        selectedCount > 0
                          ? 'border-[#facc15]'
                          : 'border-[#444444]'
                      } rounded-[2px] p-3 text-[#e5e5e5] pointer-events-auto ml-auto flex flex-col gap-2 self-start`}
                    >
                      {/* SELECTED OBJECT(S) HEADER & ACTION TOOLBAR */}
                      {selectedCount > 0 && selectedObj ? (
                        <div className="flex flex-col gap-1.5 border-b-2 border-[#444444] pb-2">
                          <div className="flex items-center justify-between gap-1">
                            <span
                              data-testid="selected-object-badge"
                              className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[9.5px] px-1.5 py-0.5 rounded-[2px] uppercase inline-block"
                            >
                              {selectedCount > 1
                                ? `MULTI-SELECTED (${selectedCount} OBJECTS)`
                                : `SELECTED ${
                                    selectedObj.kind === 'module'
                                      ? 'PART'
                                      : 'BLOCK'
                                  } (${selectedObj.vx},${selectedObj.vy},${selectedObj.vz})`}
                            </span>
                            <button
                              type="button"
                              data-testid="selected-deselect-btn"
                              onClick={() => sim?.selectBuildObjectAt(null)}
                              className="px-1.5 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer"
                            >
                              DESELECT [ESC]
                            </button>
                          </div>

                          <div className="text-xs font-display font-bold text-[#e5e5e5] uppercase flex items-center justify-between">
                            <span>
                              {selectedCount > 1
                                ? `${
                                    selectedModules.length > 0
                                      ? `${selectedModules.length} Part${
                                          selectedModules.length > 1 ? 's' : ''
                                        }`
                                      : ''
                                  }${
                                    selectedModules.length > 0 &&
                                    selectedVoxels.length > 0
                                      ? ' · '
                                      : ''
                                  }${
                                    selectedVoxels.length > 0
                                      ? `${selectedVoxels.length} Block${
                                          selectedVoxels.length > 1 ? 's' : ''
                                        }`
                                      : ''
                                  }`
                                : selectedObj.kind === 'module'
                                  ? activeConfigSlotMeta?.name ||
                                    selectedObj.moduleKind
                                  : MAT_INFO[
                                      selectedObj.mat || MAT.ALLOY_BLUE
                                    ]?.name || 'Chassis Voxel'}
                            </span>
                            {selectedCount === 1 &&
                              selectedObj.kind === 'module' && (
                                <span className="text-[9.5px] font-mono-num text-[#facc15]">
                                  Y:{AXIS_ROT_NAMES[(selectedObj.yawIdx || 0) & 3]}{' '}
                                  P:{AXIS_ROT_NAMES[(selectedObj.pitchIdx || 0) & 3]}{' '}
                                  R:{AXIS_ROT_NAMES[(selectedObj.rollIdx || 0) & 3]}
                                </span>
                              )}
                          </div>

                          {/* Filter to Parts Only or Blocks Only when box-selection contains both */}
                          {selectedModules.length > 0 &&
                            selectedVoxels.length > 0 && (
                              <div className="flex items-center gap-1 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    sim?.setMultiSelection(selectedModules, true)
                                  }
                                  className="flex-1 px-2 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer"
                                >
                                  KEEP ONLY {selectedModules.length} PART{selectedModules.length > 1 ? 'S' : ''}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    sim?.setMultiSelection(selectedVoxels, true)
                                  }
                                  className="flex-1 px-2 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer"
                                >
                                  KEEP ONLY {selectedVoxels.length} BLOCK{selectedVoxels.length > 1 ? 'S' : ''}
                                </button>
                              </div>
                            )}

                          {/* Action Buttons: Delete, Duplicate, Copy Stamp, Select All Same, Copy to Brush */}
                          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                            <button
                              type="button"
                              data-testid="selected-delete-btn"
                              onClick={() => sim?.deleteSelectedObject()}
                              className="px-2 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] font-display font-extrabold uppercase text-[10px] rounded-[2px] cursor-pointer flex items-center justify-center gap-1"
                            >
                              DELETE{selectedCount > 1 ? ` (${selectedCount})` : ''} [DEL]
                            </button>
                            <button
                              type="button"
                              data-testid="selected-duplicate-btn"
                              onClick={() => sim?.duplicateSelectedObject()}
                              className="px-2 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold uppercase text-[10px] rounded-[2px] cursor-pointer flex items-center justify-center gap-1"
                            >
                              + DUPLICATE [⌃D]
                            </button>
                            <button
                              type="button"
                              data-testid="selected-copy-stamp-btn"
                              onClick={() => sim?.copySelectionToStamp()}
                              className="col-span-2 px-2 py-1 bg-[#22c55e] hover:bg-[#16a34a] text-[#090d16] border-2 border-[#444444] font-display font-extrabold uppercase text-[10px] rounded-[2px] cursor-pointer flex items-center justify-center gap-1"
                            >
                              COPY AS STAMP PREFAB ({selectedCount}) [CTRL+C]
                            </button>
                            <button
                              type="button"
                              data-testid="selected-select-same-btn"
                              onClick={() => sim?.selectAllSameAsCurrent()}
                              className="px-2 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase text-[10px] rounded-[2px] cursor-pointer"
                            >
                              SELECT ALL SAME [SHIFT]
                            </button>
                            <button
                              type="button"
                              data-testid="selected-pick-btn"
                              onClick={() => sim?.pickSelectedObjectToBrush()}
                              className="px-2 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase text-[10px] rounded-[2px] cursor-pointer"
                            >
                              COPY TO BRUSH
                            </button>
                          </div>

                          {/* 3-Axis Rotation Controls for Selected Part(s) or Voxel Group */}
                          <div className="grid grid-cols-3 gap-1 pt-0.5">
                            <button
                              type="button"
                              data-testid="selected-rotate-btn"
                              onClick={() => sim?.rotateSelectedObject('yaw')}
                              className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase text-[9.5px] rounded-[2px] cursor-pointer text-center"
                            >
                              ROT Y 90° [R]
                            </button>
                            <button
                              type="button"
                              data-testid="selected-rotate-pitch-btn"
                              onClick={() => sim?.rotateSelectedObject('pitch')}
                              className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase text-[9.5px] rounded-[2px] cursor-pointer text-center"
                            >
                              ROT X 90° [T]
                            </button>
                            <button
                              type="button"
                              data-testid="selected-rotate-roll-btn"
                              onClick={() => sim?.rotateSelectedObject('roll')}
                              className="px-1.5 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase text-[9.5px] rounded-[2px] cursor-pointer text-center"
                            >
                              ROT Z 90° [Y]
                            </button>
                          </div>

                          {/* Desktop-Only 6-Way Move / Nudge Controls (Arrow Keys + U/J or PgUp/PgDn Up/Down) */}
                          <div className="flex flex-col gap-1 pt-1 border-t border-[#333333]">
                            <div className="flex items-center justify-between text-[8.5px] font-mono-num text-[#a3a3a3]">
                              <span className="text-[#facc15] font-bold uppercase">
                                MOVE SELECTION
                              </span>
                              <span>[ARROWS] X/Z · [U / J] UP/DN</span>
                            </div>
                            <div className="grid grid-cols-6 gap-1">
                              <button
                                type="button"
                                data-testid="selected-move-left-btn"
                                title="Move Selection Left [Left Arrow]"
                                onClick={() =>
                                  sim?.nudgeSelectedObjectCameraRelative(0, -1, 0)
                                }
                                className="px-1 py-1 bg-[#262626] hover:bg-[#3a3a3a] text-[#e5e5e5] border border-[#444444] font-mono-num font-bold text-[9.5px] rounded-[2px] cursor-pointer text-center"
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                data-testid="selected-move-fwd-btn"
                                title="Move Selection Forward [Up Arrow]"
                                onClick={() =>
                                  sim?.nudgeSelectedObjectCameraRelative(1, 0, 0)
                                }
                                className="px-1 py-1 bg-[#262626] hover:bg-[#3a3a3a] text-[#e5e5e5] border border-[#444444] font-mono-num font-bold text-[9.5px] rounded-[2px] cursor-pointer text-center"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                data-testid="selected-move-back-btn"
                                title="Move Selection Backward [Down Arrow]"
                                onClick={() =>
                                  sim?.nudgeSelectedObjectCameraRelative(-1, 0, 0)
                                }
                                className="px-1 py-1 bg-[#262626] hover:bg-[#3a3a3a] text-[#e5e5e5] border border-[#444444] font-mono-num font-bold text-[9.5px] rounded-[2px] cursor-pointer text-center"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                data-testid="selected-move-right-btn"
                                title="Move Selection Right [Right Arrow]"
                                onClick={() =>
                                  sim?.nudgeSelectedObjectCameraRelative(0, 1, 0)
                                }
                                className="px-1 py-1 bg-[#262626] hover:bg-[#3a3a3a] text-[#e5e5e5] border border-[#444444] font-mono-num font-bold text-[9.5px] rounded-[2px] cursor-pointer text-center"
                              >
                                →
                              </button>
                              <button
                                type="button"
                                data-testid="selected-move-up-btn"
                                title="Move Selection Up +Y [U / PgUp / ] / Shift+Up]"
                                onClick={() =>
                                  sim?.nudgeSelectedObjectCameraRelative(0, 0, 1)
                                }
                                className="px-1 py-1 bg-[#262626] hover:bg-[#3a3a3a] text-[#fbbf24] border border-[#444444] font-mono-num font-bold text-[9px] rounded-[2px] cursor-pointer text-center"
                              >
                                UP[U]
                              </button>
                              <button
                                type="button"
                                data-testid="selected-move-down-btn"
                                title="Move Selection Down -Y [J / PgDn / [ / Shift+Down]"
                                onClick={() =>
                                  sim?.nudgeSelectedObjectCameraRelative(0, 0, -1)
                                }
                                className="px-1 py-1 bg-[#262626] hover:bg-[#3a3a3a] text-[#fbbf24] border border-[#444444] font-mono-num font-bold text-[9px] rounded-[2px] cursor-pointer text-center"
                              >
                                DN[J]
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 border-b-2 border-[#444444] bg-[#222222] -mx-3 -mt-3 px-3 pt-2.5 pb-2">
                          <div className="flex items-center justify-between gap-1">
                            <div className="min-w-0">
                              <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[9px] px-1.5 py-0.5 rounded-[2px] uppercase inline-block mb-0.5">
                                {activeConfigSlotMeta
                                  ? 'PART TUNING & KEYBINDS'
                                  : 'RIG KEYBIND INSPECTOR'}
                              </span>
                              <div className="text-xs font-display font-bold text-[#e5e5e5] uppercase truncate">
                                {activeConfigSlotMeta?.name ||
                                  'CLICK ANY INSTALLED PART GROUP BELOW'}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {activeConfigSlotMeta && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (activeConfigSlotMeta?.defaultConfig) {
                                      handleUpdateModuleConfig({
                                        ...activeConfigSlotMeta.defaultConfig,
                                      });
                                    }
                                  }}
                                  className="px-1.5 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer"
                                >
                                  RESET
                                </button>
                              )}
                              <button
                                type="button"
                                data-testid="collapse-right-inspector-btn"
                                title="Collapse Rig Inspector to maximize 3D viewport"
                                onClick={() => setInspectorCollapsed(true)}
                                className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#3a3a3a] text-[#a3a3a3] hover:text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer"
                              >
                                HIDE ▶
                              </button>
                            </div>
                          </div>
                          <div className="text-[9px] font-mono-num text-[#a3a3a3] bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2 py-1">
                            <strong>Right-Click</strong> 1 part, <strong>Shift+Click</strong> to multi-select, <strong>Drag LMB on empty space</strong> to box-select, or click a part group below.
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowEcuModal(true)}
                            className="w-full mt-1.5 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] font-display font-extrabold uppercase rounded-[2px] text-[10px] cursor-pointer flex items-center justify-center border-2 border-[#444444]"
                          >
                            <span>CONFIGURE MICRO:BIT ECU (SCRATCH STUDIO)</span>
                          </button>
                        </div>
                      )}

                      {/* Micro:bit ECU Special Inspector Card */}
                      {activeConfigModuleKind === 'MICROBIT_ECU' && (
                        <div className="p-2.5 bg-[#222222] border-2 border-[#444444] rounded-[2px] space-y-2 text-xs font-mono">
                          <div className="flex items-center justify-between font-bold text-[#facc15]">
                            <span>MICRO:BIT V2/V3 ECU</span>
                            <span className="text-[9px] bg-[#141414] border border-[#444444] px-1.5 py-0.5 rounded-[2px] text-[#e5e5e5]">
                              PROGRAMMABLE
                            </span>
                          </div>
                          <p className="text-[10px] text-[#a3a3a3]">
                            5×5 LED Matrix &amp; Hardware-Gated Sensor Bus. Save custom ECU scripts &amp; copy/import .JSON to share.
                          </p>
                          <button
                            type="button"
                            data-testid="open-ecu-studio-btn"
                            onClick={() => setShowEcuModal(true)}
                            className="w-full py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-xs cursor-pointer transition-colors"
                          >
                            OPEN SCRATCH STUDIO VISUAL EDITOR
                          </button>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              data-testid="inspector-save-ecu-library-btn"
                              onClick={() => {
                                const r = simRef.current?.getActiveRig();
                                const activeProg =
                                  (r &&
                                    (r.ecuPrograms[r.activeEcuId || 'ECU_1'] ||
                                      Object.values(r.ecuPrograms)[0])) ||
                                  ECU_STARTER_TEMPLATES.AUTO_BRAKE.program;
                                const { saved } = saveEcuProgramToLibrary(
                                  activeProg,
                                  activeProg.name,
                                );
                                if (r) {
                                  const key = r.activeEcuId || 'ECU_1';
                                  r.ecuPrograms[key] = saved;
                                  r.saveIntactSnapshot();
                                }
                              }}
                              className="py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                            >
                              SAVE ECU SCRIPT
                            </button>
                            <button
                              type="button"
                              data-testid="inspector-copy-ecu-json-btn"
                              onClick={() => {
                                const r = simRef.current?.getActiveRig();
                                const activeProg =
                                  (r &&
                                    (r.ecuPrograms[r.activeEcuId || 'ECU_1'] ||
                                      Object.values(r.ecuPrograms)[0])) ||
                                  ECU_STARTER_TEMPLATES.AUTO_BRAKE.program;
                                const json = serializeEcuProgramToJson(activeProg);
                                copyBlueprintJsonToClipboard(
                                  json,
                                  activeProg.name || 'ECU Script',
                                );
                              }}
                              className="py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                            >
                              COPY ECU .JSON
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Selected Chassis Voxel Material Switcher */}
                      {isConfiguringSelectedVoxel && primarySelectedVoxel && (
                        <div className="text-[10px] font-mono-num space-y-1">
                          <span className="text-[#a3a3a3] block">
                            Change Material ({selectedVoxels.length} Block{selectedVoxels.length > 1 ? 's' : ''}):
                          </span>
                          <div className="grid grid-cols-2 gap-1">
                            {BUILD_SLOTS.filter((s) => s.type === 'voxel').map(
                              (voxSlot) => (
                                <button
                                  key={voxSlot.slot}
                                  type="button"
                                  onClick={() =>
                                    voxSlot.mat &&
                                    sim?.recolorSelectedVoxel(voxSlot.mat)
                                  }
                                  className={`px-2 py-1 rounded-[2px] text-[9.5px] font-display font-bold uppercase cursor-pointer border-2 text-left truncate ${
                                    primarySelectedVoxel.mat === voxSlot.mat
                                      ? 'bg-[#facc15] border-[#e5e5e5] text-[#1a1a1a]'
                                      : 'bg-[#262626] border-[#444444] text-[#e5e5e5] hover:border-[#fbbf24]'
                                  }`}
                                >
                                  {voxSlot.name}
                                </button>
                              ),
                            )}
                          </div>
                        </div>
                      )}

                      {/* Module Keybind & Mechanical Tuning Controls */}
                      {activeConfigModuleKind && activeConfigSlotMeta && (
                        <>
                          {selectedModules.length > 1 && (
                            <div className="bg-[#222222] border-2 border-[#facc15] rounded-[2px] px-2 py-1 text-[9.5px] font-mono-num text-[#facc15]">
                              Editing <strong>{selectedModules.length} selected parts</strong> simultaneously
                            </div>
                          )}

                          {/* Positive & Negative Key Inputs + 1-Click Press-Key Capture & Quick Presets */}
                          {(!isPassiveModuleKind(activeConfigModuleKind) ||
                            hasAnyKeybindableSelectedModule) && (
                            <div className="space-y-1.5 text-[10px] font-mono-num">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <div className="flex items-center justify-between mb-0.5">
                                    <label className="text-[#a3a3a3]">
                                      Activate / +Key:
                                    </label>
                                    <button
                                      type="button"
                                      data-testid="bind-capture-pos-btn"
                                      onClick={() =>
                                        setListeningKeyTarget(
                                          listeningKeyTarget === 'posKey'
                                            ? null
                                            : 'posKey',
                                        )
                                      }
                                      className={`px-1.5 py-0.2 rounded-[2px] text-[8.5px] font-display font-bold uppercase cursor-pointer border-2 ${
                                        listeningKeyTarget === 'posKey'
                                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5] animate-pulse'
                                          : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:bg-[#4b5563]'
                                      }`}
                                    >
                                      {listeningKeyTarget === 'posKey'
                                        ? 'PRESS KEY...'
                                        : 'BIND'}
                                    </button>
                                  </div>
                                  <select
                                    data-testid="config-pos-key"
                                    value={
                                      activeModuleConfig.posKey ||
                                      activeConfigSlotMeta.defaultConfig
                                        ?.posKey ||
                                      'KeyW'
                                    }
                                    onChange={(e) =>
                                      handleUpdateModuleConfig({
                                        posKey: e.target.value,
                                      })
                                    }
                                    className="w-full bg-[#141414] border-2 border-[#444444] rounded-[2px] px-1.5 py-1 text-[#e5e5e5] text-[10px] font-mono-num"
                                  >
                                    {BINDABLE_KEYS.map((k) => (
                                      <option key={k.code} value={k.code}>
                                        {k.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <div className="flex items-center justify-between mb-0.5">
                                    <label className="text-[#a3a3a3]">
                                      Reverse / -Key:
                                    </label>
                                    <button
                                      type="button"
                                      data-testid="bind-capture-neg-btn"
                                      onClick={() =>
                                        setListeningKeyTarget(
                                          listeningKeyTarget === 'negKey'
                                            ? null
                                            : 'negKey',
                                        )
                                      }
                                      className={`px-1.5 py-0.2 rounded-[2px] text-[8.5px] font-display font-bold uppercase cursor-pointer border-2 ${
                                        listeningKeyTarget === 'negKey'
                                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5] animate-pulse'
                                          : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:bg-[#4b5563]'
                                      }`}
                                    >
                                      {listeningKeyTarget === 'negKey'
                                        ? 'PRESS KEY...'
                                        : 'BIND'}
                                    </button>
                                  </div>
                                  <select
                                    data-testid="config-neg-key"
                                    value={
                                      activeModuleConfig.negKey ||
                                      activeConfigSlotMeta.defaultConfig
                                        ?.negKey ||
                                      'NONE'
                                    }
                                    onChange={(e) =>
                                      handleUpdateModuleConfig({
                                        negKey: e.target.value,
                                      })
                                    }
                                    className="w-full bg-[#141414] border-2 border-[#444444] rounded-[2px] px-1.5 py-1 text-[#e5e5e5] text-[10px] font-mono-num"
                                  >
                                    {BINDABLE_KEYS.map((k) => (
                                      <option key={k.code} value={k.code}>
                                        {k.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              {/* Quick 1-Click Keybind Pair Presets */}
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <span className="text-[9px] text-[#a3a3a3] mr-0.5">
                                  Quick Bind:
                                </span>
                                {[
                                  { label: 'W / S', posKey: 'KeyW', negKey: 'KeyS' },
                                  { label: 'D / A', posKey: 'KeyD', negKey: 'KeyA' },
                                  { label: 'Shift', posKey: 'ShiftLeft', negKey: 'NONE' },
                                  { label: 'W Only', posKey: 'KeyW', negKey: 'NONE' },
                                  { label: 'Space/Ctrl', posKey: 'Space', negKey: 'ControlLeft' },
                                  { label: 'UP / DN', posKey: 'ArrowUp', negKey: 'ArrowDown' },
                                ].map((preset) => (
                                  <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() =>
                                      handleUpdateModuleConfig({
                                        posKey: preset.posKey,
                                        negKey: preset.negKey,
                                      })
                                    }
                                    className="px-1.5 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] hover:border-[#facc15] rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer"
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>

                              {/* Toggle Mode (Same Key On/Off) vs Hold Mode */}
                              <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#2a2a2a]">
                                <span className="text-[9.5px] text-[#a3a3a3]">
                                  Activation Mode:
                                </span>
                                <div className="flex items-center gap-1">
                                  {(() => {
                                    const isToggle =
                                      activeModuleConfig.toggleMode ??
                                      activeConfigSlotMeta.defaultConfig?.toggleMode ??
                                      false;
                                    return (
                                      <>
                                        <button
                                          type="button"
                                          data-testid="config-mode-toggle-btn"
                                          onClick={() =>
                                            handleUpdateModuleConfig({
                                              toggleMode: true,
                                            })
                                          }
                                          className={`px-2 py-0.5 rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer border-2 ${
                                            isToggle
                                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                              : 'bg-[#2a2a2a] text-[#a3a3a3] border-[#444444] hover:text-[#e5e5e5]'
                                          }`}
                                        >
                                          Toggle (Same Key)
                                        </button>
                                        <button
                                          type="button"
                                          data-testid="config-mode-hold-btn"
                                          onClick={() =>
                                            handleUpdateModuleConfig({
                                              toggleMode: false,
                                            })
                                          }
                                          className={`px-2 py-0.5 rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer border-2 ${
                                            !isToggle
                                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                              : 'bg-[#2a2a2a] text-[#a3a3a3] border-[#444444] hover:text-[#e5e5e5]'
                                          }`}
                                        >
                                          Hold
                                        </button>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Suspension Stiffness & Damping Sliders */}
                          {activeConfigModuleKind === 'SUSPENSION' && (
                            <div className="space-y-1.5 text-[10px] font-mono-num">
                              <div>
                                <div className="flex justify-between text-[#a3a3a3]">
                                  <span>Spring Stiffness</span>
                                  <span className="text-[#facc15] font-bold">
                                    {(
                                      activeModuleConfig.stiffness ?? 1.0
                                    ).toFixed(2)}
                                    ×
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={0.3}
                                  max={2.5}
                                  step={0.1}
                                  value={activeModuleConfig.stiffness ?? 1.0}
                                  onChange={(e) =>
                                    handleUpdateModuleConfig({
                                      stiffness: Number(e.target.value),
                                    })
                                  }
                                  className="w-full accent-[#fbbf24] cursor-pointer"
                                />
                              </div>
                              <div>
                                <div className="flex justify-between text-[#a3a3a3]">
                                  <span>Shock Damping</span>
                                  <span className="text-[#facc15] font-bold">
                                    {(
                                      activeModuleConfig.damping ?? 1.0
                                    ).toFixed(2)}
                                    ×
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={0.3}
                                  max={2.5}
                                  step={0.1}
                                  value={activeModuleConfig.damping ?? 1.0}
                                  onChange={(e) =>
                                    handleUpdateModuleConfig({
                                      damping: Number(e.target.value),
                                    })
                                  }
                                  className="w-full accent-[#fbbf24] cursor-pointer"
                                />
                              </div>
                            </div>
                          )}

                          {/* Steering Hinge / Servo Angle & High-Speed Steering Help */}
                          {(activeConfigModuleKind === 'STEERING_HINGE' ||
                            activeConfigModuleKind === 'WHEEL_STEER' ||
                            activeConfigModuleKind === 'HINGE_LARGE' ||
                            activeConfigModuleKind === 'SERVO_SMALL' ||
                            activeConfigModuleKind === 'JOINT_MECH' ||
                            activeConfigModuleKind === 'TAILFIN_POWERED' ||
                            activeConfigModuleKind === 'SKI_SLIDER') && (
                            <div className="space-y-1.5 text-[10px] font-mono-num">
                              <div>
                                <div className="flex justify-between text-[#a3a3a3]">
                                  <span>Max Turn Angle</span>
                                  <span className="text-[#facc15] font-bold">
                                    {activeModuleConfig.maxAngleDeg ?? 35}°
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={5}
                                  max={90}
                                  step={5}
                                  value={activeModuleConfig.maxAngleDeg ?? 35}
                                  onChange={(e) =>
                                    handleUpdateModuleConfig({
                                      maxAngleDeg: Number(e.target.value),
                                    })
                                  }
                                  className="w-full accent-[#fbbf24] cursor-pointer"
                                />
                              </div>
                              {(activeConfigModuleKind === 'STEERING_HINGE' ||
                                activeConfigModuleKind === 'WHEEL_STEER') && (
                                <div>
                                  <div className="flex justify-between text-[#a3a3a3]">
                                    <span>Steering Help (Anti-Roll)</span>
                                    <span className="text-[#facc15] font-bold">
                                      {Math.round(
                                        (activeModuleConfig.steeringHelp ??
                                          0.6) * 100,
                                      )}
                                      %
                                    </span>
                                  </div>
                                  <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={
                                      activeModuleConfig.steeringHelp ?? 0.6
                                    }
                                    onChange={(e) =>
                                      handleUpdateModuleConfig({
                                        steeringHelp: Number(e.target.value),
                                      })
                                    }
                                    className="w-full accent-[#fbbf24] cursor-pointer"
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {/* Wheel / Tire Forward & Sideways Traction Tuning + Compound Presets */}
                          {isWheelOrTireModuleKind(activeConfigModuleKind) && (
                            <div
                              data-testid="wheel-traction-tuning-panel"
                              className="p-2 bg-[#141414] border-2 border-[#444444] rounded-[2px] space-y-2 text-[10px] font-mono-num"
                            >
                              <div className="flex items-center justify-between border-b border-[#333333] pb-1">
                                <span className="font-display font-extrabold text-[#fbbf24] uppercase tracking-wider">
                                  TIRE TRACTION &amp; GRIP BALANCE
                                </span>
                                <span className="text-[9px] text-[#a3a3a3]">
                                  FWD / SIDE
                                </span>
                              </div>

                              <div>
                                <div className="flex justify-between text-[#e5e5e5]">
                                  <span>Forward Traction (Launch/Brake)</span>
                                  <span
                                    data-testid="wheel-forward-traction-value"
                                    className="text-[#facc15] font-bold"
                                  >
                                    {(
                                      activeModuleConfig.forwardTraction ?? 1.0
                                    ).toFixed(2)}
                                    ×
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  data-testid="wheel-forward-traction-slider"
                                  min={0.1}
                                  max={3.0}
                                  step={0.05}
                                  value={
                                    activeModuleConfig.forwardTraction ?? 1.0
                                  }
                                  onChange={(e) =>
                                    handleUpdateModuleConfig({
                                      forwardTraction: Number(e.target.value),
                                    })
                                  }
                                  className="w-full accent-[#fbbf24] cursor-pointer"
                                />
                              </div>

                              <div>
                                <div className="flex justify-between text-[#e5e5e5]">
                                  <span>Sideways Traction (Corner/Drift)</span>
                                  <span
                                    data-testid="wheel-sideways-traction-value"
                                    className="text-[#facc15] font-bold"
                                  >
                                    {(
                                      activeModuleConfig.sidewaysTraction ?? 1.0
                                    ).toFixed(2)}
                                    ×
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  data-testid="wheel-sideways-traction-slider"
                                  min={0.1}
                                  max={3.0}
                                  step={0.05}
                                  value={
                                    activeModuleConfig.sidewaysTraction ?? 1.0
                                  }
                                  onChange={(e) =>
                                    handleUpdateModuleConfig({
                                      sidewaysTraction: Number(e.target.value),
                                    })
                                  }
                                  className="w-full accent-[#fbbf24] cursor-pointer"
                                />
                              </div>

                              {/* 1-Click Tire Compound Presets */}
                              <div className="pt-0.5">
                                <span className="text-[9px] text-[#a3a3a3] block mb-1 uppercase">
                                  Tire Compound Presets:
                                </span>
                                <div className="grid grid-cols-2 gap-1">
                                  {TIRE_TRACTION_PRESETS.map((tp) => {
                                    const isSelected =
                                      Math.abs(
                                        (activeModuleConfig.forwardTraction ??
                                          1.0) - tp.forwardTraction,
                                      ) < 0.03 &&
                                      Math.abs(
                                        (activeModuleConfig.sidewaysTraction ??
                                          1.0) - tp.sidewaysTraction,
                                      ) < 0.03;
                                    return (
                                      <button
                                        key={tp.id}
                                        type="button"
                                        data-testid={`tire-preset-${tp.id}`}
                                        title={tp.desc}
                                        onClick={() =>
                                          handleUpdateModuleConfig({
                                            forwardTraction: tp.forwardTraction,
                                            sidewaysTraction: tp.sidewaysTraction,
                                          })
                                        }
                                        className={`px-1.5 py-1 rounded-[2px] border text-[8.5px] font-display font-bold uppercase cursor-pointer flex items-center justify-between ${
                                          isSelected
                                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                            : 'bg-[#222222] hover:bg-[#333333] text-[#e5e5e5] border-[#444444]'
                                        }`}
                                      >
                                        <span className="truncate">{tp.label}</span>
                                        <span className="font-mono-num text-[8px] opacity-85 ml-1">
                                          {tp.forwardTraction}F/{tp.sidewaysTraction}S
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Power / Torque / Thrust Multiplier */}
                          {activeConfigModuleKind !== 'SUSPENSION' &&
                            activeConfigModuleKind !== 'LOGIC_GATE' &&
                            !activeConfigModuleKind.startsWith('SENSOR_') && (
                              <div className="text-[10px] font-mono-num">
                                <div className="flex justify-between text-[#a3a3a3]">
                                  <span>Output Power / Torque</span>
                                  <span className="text-[#facc15] font-bold">
                                    {(
                                      activeModuleConfig.strength ?? 1.0
                                    ).toFixed(2)}
                                    ×
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={0.2}
                                  max={2.5}
                                  step={0.1}
                                  value={activeModuleConfig.strength ?? 1.0}
                                  onChange={(e) =>
                                    handleUpdateModuleConfig({
                                      strength: Number(e.target.value),
                                    })
                                  }
                                  className="w-full accent-[#fbbf24] cursor-pointer"
                                />
                              </div>
                            )}

                          {/* Sensor Threshold & Logic Gate Mode */}
                          {activeConfigModuleKind.startsWith('SENSOR_') && (
                            <div className="text-[10px] font-mono-num">
                              <div className="flex justify-between text-[#a3a3a3]">
                                <span>Trigger Threshold</span>
                                <span className="text-[#facc15] font-bold">
                                  {activeModuleConfig.threshold ?? 15}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={2}
                                max={120}
                                step={2}
                                value={activeModuleConfig.threshold ?? 15}
                                onChange={(e) =>
                                  handleUpdateModuleConfig({
                                    threshold: Number(e.target.value),
                                  })
                                }
                                className="w-full accent-[#fbbf24] cursor-pointer"
                              />
                            </div>
                          )}

                          {activeConfigModuleKind === 'LOGIC_GATE' && (
                            <div className="text-[10px] font-mono-num">
                              <label className="block text-[#a3a3a3] mb-1">
                                Boolean Logic Gate Mode:
                              </label>
                              <div className="grid grid-cols-5 gap-1">
                                {(
                                  ['OR', 'AND', 'XOR', 'NAND', 'NOR'] as const
                                ).map((gt) => (
                                  <button
                                    key={gt}
                                    type="button"
                                    onClick={() =>
                                      handleUpdateModuleConfig({ gateType: gt })
                                    }
                                    className={`py-1 rounded-[2px] text-[9px] font-display font-bold uppercase cursor-pointer border-2 ${
                                      (activeModuleConfig.gateType ?? 'OR') ===
                                      gt
                                        ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                        : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                                    }`}
                                  >
                                    {gt}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Wireless / Logic Channel Bus (Ch 1..8) */}
                          <div className="flex items-center justify-between gap-2 pt-1 border-t-2 border-[#444444] text-[10px] font-mono-num">
                            <span className="text-[#a3a3a3]">
                              Logic Channel Bus:
                            </span>
                            <select
                              data-testid="config-logic-channel"
                              value={activeModuleConfig.channel ?? 0}
                              onChange={(e) =>
                                handleUpdateModuleConfig({
                                  channel: Number(e.target.value),
                                })
                              }
                              className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2 py-0.5 text-[#facc15] font-bold text-[10px]"
                            >
                              <option value={0}>Manual Key Only</option>
                              {[1, 2, 3, 4, 5, 6, 7, 8].map((ch) => (
                                <option key={ch} value={ch}>
                                  Channel {ch}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}

                      {/* LIVE RIG KEYBIND MAP: 1-Click Select & Rebind Any Installed Part Group on the Active Vehicle */}
                      {installedModuleGroups.length > 0 && (
                        <div className="pt-1.5 border-t-2 border-[#444444] space-y-1">
                          <div className="flex items-center justify-between text-[9.5px] font-mono-num">
                            <span className="text-[#facc15] font-display font-bold uppercase">
                              INSTALLED RIG PARTS ({activeRigForInspector?.modules.length || 0})
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const allMods = installedModuleGroups.flatMap(
                                  (g) => g.objs,
                                );
                                sim?.setMultiSelection(allMods, true);
                              }}
                              className="text-[8.5px] text-[#fbbf24] hover:underline cursor-pointer font-display font-bold uppercase"
                            >
                              SELECT ALL PARTS
                            </button>
                          </div>
                          <div className="max-h-28 overflow-y-auto space-y-1 pr-0.5">
                            {installedModuleGroups.map((grp) => {
                              const posLabel =
                                BINDABLE_KEYS.find((k) => k.code === grp.posKey)
                                  ?.label.split(' ')[0] || grp.posKey;
                              const negLabel =
                                grp.negKey !== 'NONE'
                                  ? BINDABLE_KEYS.find(
                                      (k) => k.code === grp.negKey,
                                    )?.label.split(' ')[0] || grp.negKey
                                  : null;
                              const isGroupSelected = grp.objs.every((o) =>
                                selectedModules.some(
                                  (s) =>
                                    s.vx === o.vx &&
                                    s.vy === o.vy &&
                                    s.vz === o.vz,
                                ),
                              );
                              return (
                                <button
                                  key={grp.kind}
                                  type="button"
                                  data-testid={`rig-group-${grp.kind}`}
                                  onClick={(e) => {
                                    if (e.shiftKey && selectedModules.length > 0) {
                                      const merged = mergeBuildObjectSelections(
                                        selectedObjs,
                                        grp.objs,
                                      );
                                      sim?.setMultiSelection(merged, true);
                                    } else {
                                      sim?.setMultiSelection(grp.objs, true);
                                    }
                                  }}
                                  className={`w-full flex items-center justify-between px-2 py-1 rounded-[2px] text-[9.5px] font-mono-num border-2 cursor-pointer transition ${
                                    isGroupSelected
                                      ? 'bg-[#facc15] border-[#e5e5e5] text-[#1a1a1a]'
                                      : 'bg-[#262626] border-[#444444] text-[#e5e5e5] hover:border-[#fbbf24]'
                                  }`}
                                >
                                  <span className="truncate font-bold">
                                    {grp.count}× {grp.name}
                                  </span>
                                  {!isPassiveModuleKind(grp.kind) && (
                                    <span className="shrink-0 ml-1 px-1.5 py-0.2 bg-[#141414] border border-[#444444] text-[#facc15] rounded-[2px] text-[8.5px] font-bold">
                                      {posLabel}
                                      {negLabel ? ` / ${negLabel}` : ''}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* VEHICLE SKINS, LIVERIES & BLOCK PAINT STUDIO (Collapsible to keep Inspector minimal!) */}
                      <div
                        data-testid="vehicle-skins-paint-panel"
                        className="pt-1.5 border-t-2 border-[#444444] space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[9.5px] font-mono-num">
                          <button
                            type="button"
                            onClick={() => setShowSkinsPanel((s) => !s)}
                            className="text-[#facc15] hover:text-[#fbbf24] font-display font-bold uppercase cursor-pointer flex items-center gap-1"
                          >
                            <span>SKINS &amp; PAINT {showSkinsPanel || selectedVoxels.length > 0 ? '▴' : '▾'}</span>
                          </button>
                          <button
                            type="button"
                            data-testid="paint-whole-hull-btn"
                            onClick={() => {
                              if (!sim) return;
                              const activeMat =
                                selectedBuildSlotItem.type === 'voxel' &&
                                selectedBuildSlotItem.mat
                                  ? selectedBuildSlotItem.mat
                                  : MAT.PAINT_CRIMSON;
                              const cnt = sim
                                .getActiveRig()
                                .paintAllChassisVoxels(
                                  activeMat,
                                  selectedVoxels,
                                );
                              setSkinFeedback(
                                `Painted ${cnt} block${cnt === 1 ? '' : 's'} with ${
                                  MAT_INFO[activeMat]?.name || 'Paint'
                                }!`,
                              );
                            }}
                            className="px-1.5 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[8.5px] font-display font-bold uppercase cursor-pointer"
                          >
                            {selectedVoxels.length > 0
                              ? `PAINT SELECTED (${selectedVoxels.length})`
                              : 'PAINT WHOLE HULL'}
                          </button>
                        </div>

                        {(showSkinsPanel || selectedVoxels.length > 0) && (
                          <>
                            {/* 8 One-Click Multi-Tone Vehicle Skins */}
                            <div className="grid grid-cols-2 gap-1">
                          {VEHICLE_SKINS.map((skin) => (
                            <button
                              key={skin.id}
                              type="button"
                              data-testid={`skin-btn-${skin.id}`}
                              title={skin.desc}
                              onClick={() => {
                                if (!sim) return;
                                const cnt = sim
                                  .getActiveRig()
                                  .applyVehicleSkin(skin.id as VehicleSkinId);
                                setSkinFeedback(
                                  `Applied "${skin.name}" skin (${cnt} blocks)!`,
                                );
                              }}
                              className="flex items-center gap-1.5 px-2 py-1 rounded-[2px] bg-[#262626] hover:bg-[#333333] border-2 border-[#444444] hover:border-[#facc15] text-left cursor-pointer transition"
                            >
                              <span
                                className="w-3 h-3 rounded-[2px] shrink-0 border border-[#e5e5e5]"
                                style={{ backgroundColor: skin.previewColors[0] }}
                              />
                              <span className="text-[9px] font-display font-bold text-[#e5e5e5] uppercase truncate">
                                {skin.name}
                              </span>
                            </button>
                          ))}
                        </div>

                        {/* 22-Color Quick Paint Swatch Bar */}
                        <div>
                          <div className="flex items-center justify-between text-[8.5px] font-mono-num text-[#a3a3a3] mb-1">
                            <span>
                              {selectedVoxels.length > 0
                                ? `Click Color to Paint ${selectedVoxels.length} Selected Block(s):`
                                : 'Click Color to Equip Paint Brush [V]:'}
                            </span>
                            {skinFeedback && (
                              <span className="text-[#facc15] truncate max-w-[130px]">
                                {skinFeedback}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-8 gap-1">
                            {BUILD_SLOTS.filter((s) => s.type === 'voxel').map(
                              (voxSlot) => {
                                const isSelectedSwatch =
                                  hud.selectedSlot === voxSlot.slot;
                                return (
                                  <button
                                    key={voxSlot.slot}
                                    type="button"
                                    data-testid={`paint-swatch-${voxSlot.mat}`}
                                    title={`${voxSlot.name} (${voxSlot.tag})`}
                                    onClick={() => {
                                      if (!sim || !voxSlot.mat) return;
                                      if (selectedVoxels.length > 0) {
                                        sim.recolorSelectedVoxel(voxSlot.mat);
                                        setSkinFeedback(
                                          `Painted ${selectedVoxels.length} block(s) ${voxSlot.name}`,
                                        );
                                      } else {
                                        sim.selectSlot(voxSlot.slot);
                                        sim.setPlacementMode('PAINT_TOOL');
                                        setSkinFeedback(
                                          `Paint Brush: ${voxSlot.name}`,
                                        );
                                      }
                                    }}
                                    className={`h-5 rounded-[2px] border-2 transition cursor-pointer ${
                                      isSelectedSwatch
                                        ? 'border-[#e5e5e5] scale-110'
                                        : 'border-[#444444] hover:border-[#e5e5e5]'
                                    }`}
                                    style={{ backgroundColor: voxSlot.color }}
                                  />
                                );
                              },
                            )}
                          </div>
                        </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
              </div>

              {/* BOTTOM THIN BRUSH SELECTION STRIP (+ Object Studio Bar when active) */}
              <div
                data-hud-widget="build-bottom-bar"
                data-hud-label={hud.isObjectStudioMode ? 'PROP MAKER BAR' : 'BUILD BRUSH BAR'}
                style={getWidgetTransformStyle(hudCustom, 'build-bottom-bar', undefined, 'bottom center')}
                className={`relative z-20 w-full max-w-5xl mx-auto flex flex-col gap-1.5 pointer-events-auto shrink-0 ${
                  getWidgetState(hudCustom, 'build-bottom-bar').visible ? '' : 'hidden'
                }`}
              >
                {/* IN-GAME PLACEABLE PROP MAKER STUDIO & TEMPLATE STRIP */}
                {hud.isObjectStudioMode ? (
                  <div
                    data-testid="prop-maker-studio-panel"
                    className="bg-[#1a1a1a] border-2 border-[#fbbf24] rounded-[2px] px-3 py-2 flex flex-col gap-1.5 shadow-xl"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#333333] pb-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[11px] px-2 py-0.5 rounded-[2px] uppercase">
                          PROP MAKER
                        </span>
                        <input
                          type="text"
                          data-testid="prop-maker-name-input"
                          value={objectStudioName}
                          onChange={(e) => setObjectStudioName(e.target.value)}
                          placeholder="Prop Name..."
                          className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2.5 py-1 text-xs font-mono-num text-[#e5e5e5] w-48 focus:outline-none focus:border-[#fbbf24]"
                        />
                        <button
                          type="button"
                          data-testid="save-prop-place-btn"
                          onClick={() => {
                            sim?.saveCurrentBuildAsProp(objectStudioName, true);
                          }}
                          className="px-3 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold uppercase text-xs rounded-[2px] cursor-pointer whitespace-nowrap shadow"
                        >
                          SAVE &amp; PLACE IN WORLD
                        </button>
                        <button
                          type="button"
                          data-testid="test-drive-prop-panel-btn"
                          onClick={() => {
                            sim?.testDriveAgainstCurrentProp();
                          }}
                          className="px-3 py-1 bg-[#22c55e] hover:bg-[#16a34a] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold uppercase text-xs rounded-[2px] cursor-pointer whitespace-nowrap shadow"
                        >
                          TEST DRIVE RIG
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            sim?.loadPropMakerTemplate('BLANK');
                          }}
                          className="px-2 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase text-[10px] rounded-[2px] cursor-pointer whitespace-nowrap"
                        >
                          CLEAR 5×5
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-mono-num text-[#a3a3a3]">
                        <span>PHYSICS:</span>
                        <button
                          type="button"
                          onClick={() => sim?.togglePropPhysicsMode()}
                          className={`px-2 py-0.5 rounded-[2px] font-display font-bold uppercase border-2 text-[10px] cursor-pointer ${
                            hud.propPhysicsMode === 'DYNAMIC'
                              ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#e5e5e5]'
                              : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                          }`}
                        >
                          {hud.propPhysicsMode === 'DYNAMIC' ? 'DYNAMIC (6-DOF)' : 'STATIC (TERRAIN)'}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-display font-bold uppercase text-[#fbbf24] mr-1">
                          QUICK TEMPLATES:
                        </span>
                        {(
                          [
                            { id: 'BLANK', label: 'BLANK 5×5' },
                            { id: 'CRATE', label: 'WOOD CRATE' },
                            { id: 'CONE', label: 'TRAFFIC CONE' },
                            { id: 'RAMP', label: 'STUNT RAMP' },
                            { id: 'BARRIER', label: 'JERSEY BARRIER' },
                            { id: 'BARREL', label: 'C4 BARREL' },
                          ] as Array<{ id: PropTemplateKind; label: string }>
                        ).map((tpl) => (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => {
                              sim?.loadPropMakerTemplate(tpl.id);
                              setObjectStudioName(`Custom ${tpl.label}`);
                            }}
                            className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] hover:text-[#fbbf24] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                          >
                            {tpl.label}
                          </button>
                        ))}
                      </div>

                      <span className="text-[10px] font-mono-num text-[#a3a3a3]">
                        L-Click = Place · R-Click = Delete · [Z] Undo
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* Active Sub-Assembly Stamp Banner (when Copy Stamp [Ctrl+C] or Arm Stamp is active) */}
                {activeStampPrefab && (
                  <div
                    data-testid="active-stamp-banner"
                    className="bg-[#1a1a1a]/95 border-2 border-[#22c55e] rounded-[2px] px-3 py-1 flex items-center justify-between gap-2 text-[10.5px] font-mono-num"
                  >
                    <div className="flex items-center gap-2">
                      <span className="bg-[#22c55e] text-[#090d16] font-display font-extrabold text-[10px] px-1.5 py-0.5 rounded-[2px] uppercase">
                        STAMP CLIPBOARD ACTIVE
                      </span>
                      <span className="text-[#e5e5e5] font-bold">
                        {activeStampPrefab.name} ({activeStampPrefab.voxels.length} blocks · {activeStampPrefab.modules.length} parts)
                      </span>
                      <span className="text-[#a3a3a3]">
                        Left-Click on vehicle to stamp sub-assembly
                      </span>
                    </div>
                    <button
                      type="button"
                      data-testid="cancel-stamp-prefab-btn"
                      onClick={() => setActiveStampPrefab(null)}
                      className="px-2 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border border-[#444444] rounded-[2px] font-display font-bold uppercase text-[9.5px] cursor-pointer"
                    >
                      CLEAR STAMP [ESC]
                    </button>
                  </div>
                )}

                {/* THIN BOTTOM 1PX SMART BRUSH & VOXEL STAMP DOCK (OPTION A + OPTION B) */}
                <div
                  data-testid="bottom-brush-strip"
                  className="bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] px-3 py-1.5 flex flex-col gap-1.5"
                >
                  {/* Row 1: Smart Volume Brushes [V] + Option B (1PX FINE / 4PX BLOCK [ ]) + Optional Box/Extrude Depth */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] px-1.5 py-0.5 rounded-[2px] uppercase mr-0.5">
                        BRUSH [V]
                      </span>
                      {PLACEMENT_MODES.map((pm) => {
                        const isActive = hud.placementMode === pm.id;
                        const isChisel = pm.id === 'CHISEL';
                        return (
                          <button
                            key={pm.id}
                            type="button"
                            tabIndex={-1}
                            data-testid={`place-mode-${pm.id}`}
                            onClick={(e) => {
                              e.currentTarget.blur();
                              sim?.setPlacementMode(pm.id);
                            }}
                            title={pm.desc}
                            className={`px-1.5 py-0.5 rounded-[2px] text-[9.5px] font-display font-bold uppercase transition cursor-pointer whitespace-nowrap border-2 ${
                              isActive
                                ? isChisel
                                  ? 'bg-[#ef4444] text-[#ffffff] border-[#e5e5e5]'
                                  : 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                : isChisel
                                  ? 'bg-[#262626] text-[#f87171] border-[#444444] hover:border-[#ef4444]'
                                  : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                            }`}
                          >
                            {pm.shortLabel}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5" data-testid="hull-stamp-mode-bar">
                      <span className="bg-[#38bdf8] text-[#1a1a1a] font-display font-extrabold text-[10px] px-1.5 py-0.5 rounded-[2px] uppercase">
                        VOXEL [ ]
                      </span>
                      {HULL_STAMP_MODES.map((mode) => {
                        const isActive =
                          mode.px === 1 ? hud.hullScalePx === 1 : hud.hullScalePx >= 4;
                        return (
                          <button
                            key={mode.px}
                            type="button"
                            tabIndex={-1}
                            data-testid={`hull-scale-${mode.px}`}
                            onClick={(e) => {
                              e.currentTarget.blur();
                              sim?.setHullScalePx(mode.px);
                            }}
                            title={mode.desc}
                            className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold transition cursor-pointer whitespace-nowrap border-2 ${
                              isActive
                                ? 'bg-[#38bdf8] text-[#1a1a1a] border-[#e5e5e5]'
                                : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:border-[#38bdf8]'
                            }`}
                          >
                            {mode.shortLabel}
                          </button>
                        );
                      })}

                      {(hud.placementMode === 'BOX_FILL' ||
                        hud.placementMode === 'FACE_EXTRUDE') && (
                        <div
                          className="flex items-center gap-1 ml-1 pl-1.5 border-l border-[#444444]"
                          data-testid="box-depth-bar"
                        >
                          <span className="text-[9.5px] font-display font-extrabold text-[#fbbf24] uppercase">
                            DEPTH:
                          </span>
                          <button
                            type="button"
                            tabIndex={-1}
                            data-testid="box-depth-dec"
                            title="Decrease Slab/Extrude Depth [Alt + []"
                            onClick={(e) => {
                              e.currentTarget.blur();
                              sim?.stepBoxDepthPx(-1);
                            }}
                            className="px-1.5 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold bg-[#262626] text-[#e5e5e5] border-2 border-[#444444] hover:border-[#fbbf24] cursor-pointer"
                          >
                            −
                          </button>
                          <span
                            data-testid="box-depth-value"
                            className="px-1.5 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold bg-[#262626] text-[#fbbf24] border border-[#444444]"
                          >
                            {hud.boxDepthPx}px
                          </span>
                          <button
                            type="button"
                            tabIndex={-1}
                            data-testid="box-depth-inc"
                            title="Increase Slab/Extrude Depth [Alt + ]]"
                            onClick={(e) => {
                              e.currentTarget.blur();
                              sim?.stepBoxDepthPx(1);
                            }}
                            className="px-1.5 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold bg-[#262626] text-[#e5e5e5] border-2 border-[#444444] hover:border-[#fbbf24] cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Active Part + Live Ghost Dimensions/Mass Badge + Aim Telemetry */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-num text-[#a3a3a3] border-t border-[#333333] pt-1">
                    <div className="flex items-center gap-2">
                      <span>
                        PART:{' '}
                        <strong style={{ color: selectedBuildSlotItem.color }}>
                          {selectedBuildSlotItem.name}
                        </strong>
                      </span>
                      {hud.ghostSummary && (
                        <span
                          data-testid="ghost-dimensions-badge"
                          className={`px-1.5 py-0.2 rounded-[2px] border font-bold ${
                            hud.placementMode === 'CHISEL' || hud.ghostSummary.massDeltaKg < 0
                              ? 'bg-[#2a1215] border-[#ef4444] text-[#f87171]'
                              : 'bg-[#14222e] border-[#38bdf8] text-[#38bdf8]'
                          }`}
                        >
                          GHOST: {hud.ghostSummary.dimsLabel} · {hud.ghostSummary.count} blk (
                          {hud.ghostSummary.massDeltaKg >= 0 ? '+' : ''}
                          {hud.ghostSummary.massDeltaKg}kg)
                        </span>
                      )}
                      {!hud.isObjectStudioMode && (
                        <button
                          type="button"
                          data-testid="export-as-prop-btn"
                          onClick={() => {
                            sim?.saveCurrentBuildAsProp(hud.presetName, false);
                          }}
                          className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#fbbf24] border border-[#444444] font-display font-bold uppercase text-[9.5px] rounded-[2px] cursor-pointer whitespace-nowrap"
                          title="Save current vehicle chassis as a placeable physics prop"
                        >
                          SAVE AS PROP
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span>
                        AIM:{' '}
                        <strong className="text-[#facc15]">
                          <LiveHudField select={selectRayTarget} />
                        </strong>
                      </span>
                      <span className="hidden lg:inline text-[#a3a3a3]">
                        · [Alt+Click] Pick · [X] X-Ray · [Tab] Hide Catalog
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
            )
          ) : (
            /* =================================================================
               B. INDUSTRIAL BLUEPRINT DRIVING, ON-FOOT & WORLD EDITOR HUD
               ================================================================= */
            <>
              {/* TOP ROW: Industrial Blueprint Quick Bar on Left + Audio/Pause on Right */}
              <div className={`relative flex items-center justify-between gap-2 ${showStudioDropdown ? 'z-[85]' : 'z-20'}`}>
                {!isMobileHud && hudCustom.showTopBar ? (
                  <div
                    data-testid="desktop-top-bar"
                    data-hud-widget="top-bar"
                    data-hud-label="TOP BAR"
                    style={getWidgetTransformStyle(
                      hudCustom,
                      'top-bar',
                      undefined,
                      'top left',
                    )}
                    className="flex flex-wrap items-center gap-1 bg-[#1a1a1a]/95 border-2 border-[#444444] px-1.5 py-0.5 rounded-[2px] pointer-events-auto"
                  >
                  {/* Industrial Hazard-Bordered [B] BUILD MODE Badge */}
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="toggle-build-btn"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      simRef.current?.toggleHoverBuildMode(true);
                    }}
                    className="hazard-stripe-border bg-[#fbbf24] hover:bg-[#facc15] px-2.5 py-1 text-[#1a1a1a] rounded-[2px] text-xs font-display font-extrabold uppercase tracking-wide cursor-pointer whitespace-nowrap"
                  >
                    BUILD [B]
                  </button>

                  {/* Live Top-Left FPS Badge */}
                  <span
                    ref={fpsBadgeRef}
                    data-testid="fps-counter"
                    className="text-[11px] font-mono-num font-bold text-[#facc15] bg-[#141414] border-2 border-[#444444] px-2 py-0.5 rounded-[2px] whitespace-nowrap min-w-[110px] text-center inline-block tabular-nums"
                  >
                    <LiveHudField select={selectFpsFrameMs} />
                  </span>

                  {/* Collapsible Studio & World Tools Dropdown */}
                  <div className="relative inline-block text-left">
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="studio-tools-dropdown-btn"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        setShowStudioDropdown((v) => !v);
                      }}
                      className={`px-2 py-0.5 rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 flex items-center gap-1 ${
                        hud.isWorldEditMode || hud.isObjectStudioMode
                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                          : 'bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      <span>WORLD &amp; STUDIOS [{showStudioDropdown ? '-' : '+'}]</span>
                      {hud.isWorldEditMode && (
                        <span className="w-1.5 h-1.5 rounded-[2px] bg-[#dc2626] animate-pulse" />
                      )}
                    </button>

                    {showStudioDropdown && (
                      <div
                        data-testid="studio-tools-menu"
                        className="absolute left-0 mt-1 w-56 max-w-[calc(100vw-20px)] max-h-[calc(100dvh-64px)] overflow-y-auto overscroll-contain bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-1.5 z-[90] flex flex-col gap-1 shadow-2xl"
                      >
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="toggle-world-edit-btn"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            setShowStudioDropdown(false);
                            simRef.current?.toggleWorldEditMode();
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-[2px] border-2 border-[#444444] text-xs font-display font-bold uppercase flex items-center justify-between cursor-pointer ${
                            hud.isWorldEditMode
                              ? 'bg-[#facc15] text-[#1a1a1a]'
                              : 'bg-[#262626] hover:bg-[#333333] text-[#e5e5e5]'
                          }`}
                        >
                          <span>{hud.isWorldEditMode ? 'WORLD EDITOR (ON)' : 'WORLD EDITOR'}</span>
                          <span className="text-[10px] font-mono-num text-[#fbbf24]">TERRA</span>
                        </button>

                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="toggle-object-studio-btn"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            setShowStudioDropdown(false);
                            simRef.current?.toggleObjectStudioMode(true);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-[2px] border-2 border-[#444444] bg-[#262626] hover:bg-[#333333] text-xs font-display font-bold uppercase text-[#e5e5e5] flex items-center justify-between cursor-pointer"
                        >
                          <span>PROP MAKER</span>
                          <span className="text-[10px] font-mono-num text-[#facc15]">STUDIO</span>
                        </button>

                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="open-world-gen-btn"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            setShowStudioDropdown(false);
                            if (document.pointerLockElement)
                              document.exitPointerLock?.();
                            setWorldGenFeedback('');
                            setShowWorldGenModal(true);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-[2px] border-2 border-[#444444] bg-[#262626] hover:bg-[#333333] text-xs font-display font-bold uppercase text-[#4ade80] flex items-center justify-between cursor-pointer"
                        >
                          <span>SAVE / LOAD WORLD</span>
                          <span className="text-[10px] font-mono-num text-[#e5e5e5]">BIOMES</span>
                        </button>

                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="open-mod-studio-btn"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            setShowStudioDropdown(false);
                            if (document.pointerLockElement)
                              document.exitPointerLock?.();
                            setModStudioFeedback('');
                            setShowModStudioModal(true);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-[2px] border-2 border-[#444444] bg-[#fbbf24] hover:bg-[#facc15] text-xs font-display font-bold uppercase text-[#1a1a1a] flex items-center justify-between cursor-pointer"
                        >
                          <span>MODS, MODES &amp; SHADERS</span>
                          <span className="text-[10px] font-mono-num text-[#1a1a1a]">[F4]</span>
                        </button>

                        {/* Quick Weather, AI Convoy, Crash Cam & Missions Controls */}
                        <div className="pt-1 mt-1 border-t border-[#383838] flex flex-col gap-1">
                          <div className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase px-1">
                            WEATHER &amp; SEA STATE
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {(
                              [
                                { id: 'DAYLIGHT', label: '☀ DAY' },
                                { id: 'GOLDEN_SUNSET', label: '🌅 SUNSET' },
                                { id: 'MIDNIGHT_NEON', label: '🌙 NIGHT' },
                                { id: 'STORMY_OCEAN', label: '🌊 STORM' },
                                { id: 'ARCTIC_ICE', label: '❄ ARCTIC' },
                              ] as const
                            ).map((wp) => (
                              <button
                                key={wp.id}
                                type="button"
                                data-testid={`weather-preset-${wp.id}`}
                                onClick={() => {
                                  SoundFX.snap();
                                  setWeatherPreset(wp.id);
                                  if (
                                    wp.id === 'STORMY_OCEAN' &&
                                    simRef.current &&
                                    simRef.current.world.waveQuality === 'OFF'
                                  ) {
                                    simRef.current.setWaveQuality('MEDIUM');
                                  }
                                }}
                                className={`px-1.5 py-1 rounded-[2px] text-[9.5px] font-display font-bold uppercase border cursor-pointer ${
                                  weatherPreset === wp.id
                                    ? 'bg-[#38bdf8] text-[#0f172a] border-[#e5e5e5]'
                                    : 'bg-[#222222] text-[#e5e5e5] border-[#444444]'
                                }`}
                              >
                                {wp.label}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-3 gap-1 mt-0.5">
                            <button
                              type="button"
                              data-testid="toggle-ai-convoy-btn"
                              onClick={() => {
                                SoundFX.snap();
                                setAiTrafficEnabled((v) => !v);
                              }}
                              className={`px-1.5 py-1 rounded-[2px] text-[9px] font-display font-bold uppercase border cursor-pointer ${
                                aiTrafficEnabled
                                  ? 'bg-[#4ade80] text-[#141414] border-[#e5e5e5]'
                                  : 'bg-[#222222] text-[#a3a3a3] border-[#444444]'
                              }`}
                            >
                              AI CONVOY: {aiTrafficEnabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              data-testid="toggle-crash-cam-btn"
                              onClick={() => {
                                SoundFX.snap();
                                toggleCrashSlowMo();
                              }}
                              className={`px-1.5 py-1 rounded-[2px] text-[9px] font-display font-bold uppercase border cursor-pointer ${
                                impactSlowMoEnabled
                                  ? 'bg-[#facc15] text-[#141414] border-[#e5e5e5]'
                                  : 'bg-[#222222] text-[#a3a3a3] border-[#444444]'
                              }`}
                            >
                              CRASH SLOW-MO: {impactSlowMoEnabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              data-testid="toggle-turret-aim-btn"
                              onClick={() => {
                                SoundFX.snap();
                                setTurretCamAimEnabled((v) => !v);
                              }}
                              className={`px-1.5 py-1 rounded-[2px] text-[9px] font-display font-bold uppercase border cursor-pointer ${
                                turretCamAimEnabled
                                  ? 'bg-[#fb923c] text-[#141414] border-[#e5e5e5]'
                                  : 'bg-[#222222] text-[#a3a3a3] border-[#444444]'
                              }`}
                            >
                              TURRET AIM: {turretCamAimEnabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          <div className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase px-1 mt-0.5">
                            PROVING GROUNDS MISSIONS
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {(
                              [
                                { id: 'NONE', label: 'FREE ROAM' },
                                { id: 'BRIDGE_CARGO', label: 'BRIDGE CARGO' },
                                { id: 'CATAPULT_CHANNEL', label: 'OCEAN LAUNCH' },
                                { id: 'SUBMARINE_TRENCH', label: 'ABYSSAL DIVE' },
                              ] as const
                            ).map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                data-testid={`mission-select-${m.id}`}
                                onClick={() => {
                                  SoundFX.snap();
                                  setActiveMissionId(m.id);
                                  setMissionCompleted(false);
                                  missionCompletedRef.current = false;
                                  setMissionProgressText('');
                                  if (m.id === 'SUBMARINE_TRENCH' && simRef.current) {
                                    simRef.current.selectPreset(7);
                                  }
                                }}
                                className={`px-1.5 py-1 rounded-[2px] text-[9px] font-display font-bold uppercase border cursor-pointer ${
                                  activeMissionId === m.id
                                    ? 'bg-[#facc15] text-[#141414] border-[#e5e5e5]'
                                    : 'bg-[#222222] text-[#e5e5e5] border-[#444444]'
                                }`}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>

                          {/* Dynamic Disasters, AI Bots, Arena Traps & Custom Race Track Builder */}
                          <div className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase px-1 mt-1 pt-1 border-t border-[#383838]">
                            DYNAMIC DISASTERS &amp; WEATHER
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            {(
                              [
                                { id: 'CALM', label: 'CALM' },
                                { id: 'WIND_GUSTS', label: '💨 GALE' },
                                { id: 'FLOOD_SURGE', label: '🌊 FLOOD' },
                                { id: 'METEOR_SHOWER', label: '☄ METEOR' },
                                { id: 'VORTEX_STORM', label: '🌪 VORTEX' },
                              ] as Array<{ id: WeatherDisasterMode; label: string }>
                            ).map((dm) => (
                              <button
                                key={dm.id}
                                type="button"
                                data-testid={`disaster-mode-${dm.id}`}
                                onClick={() => {
                                  SoundFX.snap();
                                  setWeatherDisasterMode(dm.id);
                                  if (simRef.current) {
                                    simRef.current.worldArenaSystems.disasterMode = dm.id;
                                  }
                                }}
                                className={`px-1 py-0.5 rounded-[2px] text-[8.5px] font-display font-bold uppercase border cursor-pointer ${
                                  weatherDisasterMode === dm.id
                                    ? 'bg-[#f97316] text-[#141414] border-[#e5e5e5]'
                                    : 'bg-[#222222] text-[#e5e5e5] border-[#444444]'
                                }`}
                              >
                                {dm.label}
                              </button>
                            ))}
                          </div>

                          <div className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase px-1 mt-0.5">
                            OFFLINE AI &amp; AERIAL DRONES
                          </div>
                          <button
                            type="button"
                            data-testid="studio-open-ai-fleet-btn"
                            onClick={() => {
                              SoundFX.snap();
                              setShowStudioDropdown(false);
                              if (document.pointerLockElement)
                                document.exitPointerLock?.();
                              setShowAiFleetModal(true);
                            }}
                            className="w-full px-2 py-1.5 rounded-[2px] text-[10px] font-display font-extrabold uppercase border-2 bg-[#22c55e] hover:bg-[#16a34a] text-[#141414] border-[#444444] cursor-pointer flex items-center justify-between"
                          >
                            <span>AI PILOTS &amp; COMBAT...</span>
                            <span className="text-[9px] font-mono-num">
                              {simRef.current?.creations?.filter((r) => r.aiConfig?.enabled).length ?? 0} ON
                            </span>
                          </button>
                          <button
                            type="button"
                            data-testid="toggle-target-drones-btn"
                            onClick={() => {
                              SoundFX.snap();
                              const next = !targetDronesEnabled;
                              setTargetDronesEnabled(next);
                              simRef.current?.worldArenaSystems.setTargetDronesEnabled(next);
                            }}
                            className={`w-full px-1.5 py-1 rounded-[2px] text-[9px] font-display font-bold uppercase border cursor-pointer ${
                              targetDronesEnabled
                                ? 'bg-[#38bdf8] text-[#090d16] border-[#e5e5e5]'
                                : 'bg-[#222222] text-[#e5e5e5] border-[#444444]'
                            }`}
                          >
                            AERIAL TARGET DRONES: {targetDronesEnabled ? 'ACTIVE (6)' : 'OFF'}
                          </button>

                          <div className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase px-1 mt-0.5">
                            SPAWN ARENA TRAPS &amp; RACE GATES
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {(
                              [
                                { id: 'PRESSURE_MINE', label: '+ MINE PLATE' },
                                { id: 'LASER_TRIPWIRE', label: '+ LASER WIRE' },
                                { id: 'CRUSHER_PRESS', label: '+ CRUSHER' },
                                { id: 'BOULDER_DISPENSER', label: '+ BOULDER' },
                                { id: 'FUEL_SILO', label: '+ FUEL SILO' },
                                { id: 'FRACTURE_PILLAR', label: '+ PILLAR' },
                              ] as Array<{ id: ArenaTrapKind; label: string }>
                            ).map((tr) => (
                              <button
                                key={tr.id}
                                type="button"
                                data-testid={`spawn-trap-${tr.id}`}
                                onClick={() => {
                                  const s = simRef.current;
                                  if (!s) return;
                                  const rig = s.getActiveRig();
                                  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
                                    rig.quaternion,
                                  );
                                  const wx = rig.position.x + fwd.x * 7.5;
                                  const wz = rig.position.z + fwd.z * 7.5;
                                  s.worldArenaSystems.spawnArenaTrap(
                                    tr.id,
                                    wx,
                                    wz,
                                    Math.atan2(fwd.x, fwd.z),
                                  );
                                }}
                                className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#fbbf24] border border-[#444444] rounded-[2px] text-[8.5px] font-display font-bold uppercase cursor-pointer"
                              >
                                {tr.label}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            {(
                              [
                                { id: 'START_FINISH_GATE', label: '+ START GATE' },
                                { id: 'CHECKPOINT_RING', label: '+ CHECKPOINT' },
                                { id: 'BOOST_PAD', label: '+ BOOST PAD' },
                              ] as Array<{ id: CustomTrackNodeKind; label: string }>
                            ).map((tn) => (
                              <button
                                key={tn.id}
                                type="button"
                                data-testid={`spawn-track-${tn.id}`}
                                onClick={() => {
                                  const s = simRef.current;
                                  if (!s) return;
                                  const rig = s.getActiveRig();
                                  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
                                    rig.quaternion,
                                  );
                                  const wx = rig.position.x + fwd.x * 8.0;
                                  const wz = rig.position.z + fwd.z * 8.0;
                                  s.worldArenaSystems.spawnTrackNode(
                                    tn.id,
                                    wx,
                                    wz,
                                    Math.atan2(fwd.x, fwd.z),
                                  );
                                }}
                                className="px-1 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#38bdf8] border border-[#444444] rounded-[2px] text-[8.5px] font-display font-bold uppercase cursor-pointer"
                              >
                                {tn.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="open-garage-btn"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      if (document.pointerLockElement)
                        document.exitPointerLock?.();
                      setBlueprintNameInput(hud.presetName);
                      setGarageFeedback('');
                      setShowGarageModal(true);
                    }}
                    className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#fbbf24] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                  >
                    GARAGE [O]
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="open-ai-fleet-btn"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      SoundFX.snap();
                      if (document.pointerLockElement)
                        document.exitPointerLock?.();
                      setShowAiFleetModal(true);
                    }}
                    className={`px-2 py-0.5 border-2 rounded-[2px] text-[11px] font-display font-extrabold uppercase cursor-pointer whitespace-nowrap ${
                      (simRef.current?.creations?.filter((r) => r.aiConfig?.enabled).length ?? 0) > 0
                        ? 'bg-[#22c55e] text-[#141414] border-[#e5e5e5]'
                        : 'bg-[#262626] hover:bg-[#333333] text-[#4ade80] border-[#444444]'
                    }`}
                  >
                    AI PILOTS
                    {(simRef.current?.creations?.filter((r) => r.aiConfig?.enabled).length ?? 0) > 0
                      ? ` (${simRef.current?.creations?.filter((r) => r.aiConfig?.enabled).length})`
                      : ''}
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="repair-rig-btn"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      sim?.flipSummonRig();
                    }}
                    className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                  >
                    REPAIR [R]
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="toggle-walk-btn"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      sim?.toggleEnterExitRig();
                    }}
                    className={`px-2 py-0.5 rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                      !hud.isSeatedInRig && !hud.hasIntactSeat
                        ? 'bg-[#dc2626] text-[#e5e5e5] border-[#444444]'
                        : 'bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-[#444444]'
                    }`}
                  >
                    {hud.isSeatedInRig
                      ? 'WALK [E]'
                      : hud.hasIntactSeat
                        ? 'DRIVE [E]'
                        : 'SEAT BROKEN [E]'}
                  </button>

                  {/* Optical Spyglass Zoom Toggle Button [Z] (Full LOD0 Focus) */}
                  {!hud.isBuildMode && (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-zoom-btn"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.toggleZoom();
                      }}
                      title="Toggle Optical Spyglass Zoom (Streams Full LOD0 at Target) [Z] — Scroll Wheel for 2× / 4× / 8×"
                      className={`px-2 py-0.5 rounded-[2px] text-[10.5px] font-mono-num font-bold uppercase cursor-pointer whitespace-nowrap border-2 transition ${
                        hud.isZoomed
                          ? 'bg-[#38bdf8] text-[#111827] border-[#e5e5e5]'
                          : 'bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      {hud.isZoomed
                        ? `ZOOM ${hud.zoomMagnification}× [Z]`
                        : 'ZOOM [Z]'}
                    </button>
                  )}

                  {hud.isZoomed && !hud.isBuildMode && (
                    <div
                      data-testid="optical-zoom-hud-badge"
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] bg-[#0c1928]/95 border-2 border-[#38bdf8] text-[10px] font-mono-num font-bold text-[#e0f2fe] whitespace-nowrap"
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="zoom-step-out-btn"
                        title="Decrease Zoom Magnification (÷2)"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          simRef.current?.stepZoomMagnification(-1);
                        }}
                        className="px-1 py-0 rounded-[1px] text-[10px] font-mono-num font-bold bg-[#1e293b] text-[#7dd3fc] hover:text-white cursor-pointer"
                      >
                        −
                      </button>
                      {([2, 4, 8, 32, 128] as const).map((mag) => (
                        <button
                          key={mag}
                          type="button"
                          tabIndex={-1}
                          data-testid={`zoom-mag-${mag}x-btn`}
                          onClick={(e) => {
                            e.currentTarget.blur();
                            simRef.current?.setZoomMagnification(mag);
                          }}
                          className={`px-1 py-0 rounded-[1px] text-[9.5px] font-mono-num font-bold cursor-pointer ${
                            hud.zoomMagnification === mag
                              ? 'bg-[#38bdf8] text-[#0c1928]'
                              : 'bg-transparent text-[#7dd3fc] hover:text-white'
                          }`}
                        >
                          {mag}×
                        </button>
                      ))}
                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="zoom-step-in-btn"
                        title="Increase Zoom Magnification (×2 — Unlimited!)"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          simRef.current?.stepZoomMagnification(1);
                        }}
                        className="px-1 py-0 rounded-[1px] text-[10px] font-mono-num font-bold bg-[#1e293b] text-[#7dd3fc] hover:text-white cursor-pointer"
                      >
                        +
                      </button>
                      <span className="text-[#38bdf8] mx-0.5">•</span>
                      <span>{hud.zoomFocusDistMeters}M</span>
                      <span className="text-[#34d399] ml-0.5">FULL LOD0</span>
                    </div>
                  )}

                  {/* Minimal / Full HUD Toggle Button [TAB] */}
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="toggle-minimal-hud-btn"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      setMinimalHudMode((m) => !m);
                    }}
                    title="Toggle Minimal HUD vs Expanded Utility Bar [Tab]"
                    className={`px-2 py-0.5 rounded-[2px] text-[10.5px] font-mono-num font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                      !minimalHudMode
                        ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                        : 'bg-[#141414] hover:bg-[#262626] text-[#a3a3a3] hover:text-[#e5e5e5] border-[#444444]'
                    }`}
                  >
                    {minimalHudMode ? 'MORE [TAB] ▸' : 'MINIMAL [TAB] ◂'}
                  </button>

                  {/* Secondary Utility Controls — Hidden in Minimal HUD Mode unless active */}
                  {(hud.isSlowMoActive || !minimalHudMode) && (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-slowmo-btn"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        simRef.current?.toggleManualSlowMo();
                      }}
                      title="Toggle Bullet-Time Slow-Motion [V]"
                      className={`px-2 py-0.5 rounded-[2px] text-[10.5px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 transition ${
                        hud.isSlowMoActive
                          ? hud.slowMoReason === 'AUTO_FPS'
                            ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#e5e5e5] animate-pulse'
                            : 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                          : 'bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      {hud.isSlowMoActive
                        ? `SLOW-MO ${Math.round(hud.timeScale * 100)}% [V]`
                        : '1.0X [V]'}
                    </button>
                  )}

                  {hud.watchdogProtecting && (
                    <span
                      data-testid="watchdog-protect-badge"
                      className="text-[10px] font-mono-num font-bold bg-[#dc2626] text-[#e5e5e5] border-2 border-[#444444] px-1.5 py-0.5 rounded-[2px] whitespace-nowrap"
                    >
                      ANTI-FREEZE
                    </span>
                  )}

                  {!minimalHudMode && (
                    <>
                      <span
                        data-testid="active-preset-name"
                        className="text-xs font-display font-bold text-[#facc15] uppercase px-1.5 border-r-2 border-[#444444] whitespace-nowrap"
                      >
                        {hud.presetName}
                      </span>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="cycle-camera-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          simRef.current?.cycleCameraMode();
                        }}
                        className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        CAM: {currentCameraLabel} [C]
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="open-multiplayer-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          if (document.pointerLockElement)
                            document.exitPointerLock?.();
                          setMpToast('');
                          setShowMultiplayerModal(true);
                        }}
                        className={`px-2 py-0.5 rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 flex items-center gap-1 ${
                          mpState.status === 'connected'
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {mpState.status === 'connected'
                          ? `MP (${mpState.players.length}) [M]`
                          : 'MP [M]'}
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          sim?.selectPreset(hud.presetIndex + 1);
                        }}
                        className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        RIG [P]
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="upright-rig-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          sim?.callAndUprightRig();
                        }}
                        className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        CALL [R]
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="toggle-headlights-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          const activeRig = sim?.getActiveRig();
                          if (activeRig) {
                            activeRig.toggleHeadlights();
                            setHud((h) => ({
                              ...h,
                              headlightsOn: Boolean(activeRig.headlightsOn),
                            }));
                          }
                        }}
                        className={`px-2 py-0.5 rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap border-2 ${
                          hud.headlightsOn
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        LIGHTS [H]
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="open-fast-travel-map-btn"
                        title="Open Fast-Travel Teleport Map [F]"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          setShowFastTravelMap((prev) => !prev);
                          SoundFX.snap();
                        }}
                        className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        MAP [F]
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="open-world-save-hud-btn"
                        title="Save, Load, or Export your Custom World"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          if (document.pointerLockElement)
                            document.exitPointerLock?.();
                          setWorldGenFeedback('');
                          setShowWorldGenModal(true);
                          SoundFX.snap();
                        }}
                        className="px-2 py-0.5 bg-[#22c55e] hover:bg-[#4ade80] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-extrabold uppercase cursor-pointer whitespace-nowrap"
                      >
                        SAVE WORLD
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="quick-save-world-hud-btn"
                        title="1-Click Instant Quick-Save of current World"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          if (!simRef.current) return;
                          const saved = simRef.current.saveCustomWorldSnapshot(
                            customWorldNameInput || 'Proving Grounds Save',
                          );
                          setQuickSaveToast(
                            `Saved "${saved.name}" (${saved.modifiedChunks.length} chunks, ${saved.placedHazards.length} hazards)!`,
                          );
                          window.setTimeout(() => setQuickSaveToast(''), 3200);
                          SoundFX.snap();
                        }}
                        className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        QUICK SAVE
                      </button>

                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="toggle-screenshot-mode-btn"
                        title="Screenshot Mode [F12]"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          setIsScreenshotMode(true);
                          SoundFX.snap();
                        }}
                        className="px-2 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                      >
                        PHOTO [F12]
                      </button>
                    </>
                  )}
                </div>
                ) : !isMobileHud ? (
                  <div />
                ) : null}

                {/* Top-Right Mute & Pause Buttons (Desktop only; Mobile uses consolidated Top Bar) */}
                {!isMobileHud && getWidgetState(hudCustom, 'desktop-top-right').visible && (
                <div
                  data-testid="desktop-top-right"
                  data-hud-widget="desktop-top-right"
                  data-hud-label="AUDIO & PAUSE"
                  style={getWidgetTransformStyle(
                    hudCustom,
                    'desktop-top-right',
                    undefined,
                    'top right',
                  )}
                  className="flex items-center gap-1.5 pointer-events-auto"
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={hud.muted ? 'Unmute audio' : 'Mute audio'}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      SoundFX.toggleMute();
                      setHud((h) => ({ ...h, muted: SoundFX.muted }));
                    }}
                    className="w-8 h-8 flex items-center justify-center bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] cursor-pointer"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      {!hud.muted ? (
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      ) : (
                        <line x1="23" y1="9" x2="17" y2="15" />
                      )}
                    </svg>
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Pause game"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      sim?.pauseGame();
                    }}
                    className="hazard-stripe-border bg-[#6b7280] hover:bg-[#4b5563] w-8 h-8 flex items-center justify-center text-[#e5e5e5] rounded-[2px] cursor-pointer"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  </button>
                </div>
                )}
              </div>

              {/* Active Game Mode Telemetry Banner (All 6 Game Modes + Custom Mods) */}
              {hudCustom.showToasts &&
                getWidgetState(hudCustom, 'toasts').visible &&
                (ModRegistry.activeGameModeId !== 'SANDBOX_FREEPLAY' ||
                  ModRegistry.getActiveGameMode().enableCheckpointRace ||
                  ModRegistry.getActiveGameMode().enableDemolitionScore) && (
                <div
                  data-testid="active-gamemode-hud-banner"
                  style={getWidgetTransformStyle(hudCustom, 'toasts', undefined, 'top center')}
                  className="self-center flex flex-wrap items-center gap-3 bg-[#1a1a1a] border-2 border-[#444444] px-3.5 py-1.5 rounded-[2px] pointer-events-auto text-xs font-mono-num"
                >
                  <span
                    className="px-2 py-0.5 rounded-[2px] font-display font-extrabold text-[10px] text-[#1a1a1a] uppercase"
                    style={{
                      backgroundColor: ModRegistry.getActiveGameMode().badgeColor,
                    }}
                  >
                    MODE: {ModRegistry.getActiveGameMode().name.toUpperCase()}
                  </span>

                  {/* 1. Time Trial */}
                  {ModRegistry.getActiveGameMode().enableCheckpointRace && (
                    <>
                      <span
                        data-testid="timetrial-checkpoint-progress"
                        className="text-[#facc15] font-bold"
                      >
                        CHECKPOINT {ModRegistry.currentCheckpointIndex + 1} /{' '}
                        {DEFAULT_CHECKPOINT_COURSE.length}
                      </span>
                      <span
                        data-testid="timetrial-lap-timer"
                        className="text-[#e5e5e5] font-bold"
                      >
                        TIME: {ModRegistry.raceTimerSec.toFixed(1)}s
                      </span>
                      {ModRegistry.bestLapSec !== null && (
                        <span
                          data-testid="timetrial-best-time"
                          className="text-[#fbbf24] font-bold"
                        >
                          BEST: {ModRegistry.bestLapSec.toFixed(2)}s
                        </span>
                      )}
                    </>
                  )}

                  {/* 2. Destruction Derby */}
                  {ModRegistry.activeGameModeId === 'DESTRUCTION_DERBY' && (
                    <>
                      <span
                        data-testid="derby-timer"
                        className="text-[#facc15] font-bold"
                      >
                        TIME {derbyState.remainingSec.toFixed(1)}s
                      </span>
                      <span
                        data-testid="derby-voxels-destroyed"
                        className="text-[#fbbf24] font-extrabold"
                      >
                        VOXELS DESTROYED: {derbyState.scoreVoxelsDestroyed}
                      </span>
                      <span className="text-[#e5e5e5] font-bold">
                        BEST: {derbyState.bestScoreVoxels}
                      </span>
                      {derbyState.finished && (
                        <span className="px-2 py-0.5 bg-[#fbbf24] text-[#1a1a1a] font-extrabold rounded-[2px]">
                          TIME UP! FINAL: {derbyState.scoreVoxelsDestroyed}
                        </span>
                      )}
                      <button
                        type="button"
                        data-testid="derby-restart-btn"
                        onClick={() =>
                          activateGameModeAndSetupWorld('DESTRUCTION_DERBY')
                        }
                        className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-[10px] cursor-pointer"
                      >
                        RESET 60S DERBY
                      </button>
                    </>
                  )}

                  {/* 3. Building Challenge */}
                  {ModRegistry.activeGameModeId === 'BUILDING_CHALLENGE' && (
                    <>
                      <span
                        data-testid="building-challenge-prompt-title"
                        className="text-[#facc15] font-bold"
                      >
                        {
                          BUILDING_CHALLENGE_PROMPTS[
                            buildingChallengePromptIdx %
                              BUILDING_CHALLENGE_PROMPTS.length
                          ].title
                        }
                      </span>
                      <span className="text-[#e5e5e5] font-bold">
                        {buildingChallengeTesting
                          ? 'AUTO-TESTING...'
                          : `TIME ${Math.floor(buildingChallengeTimerSec / 60)}:${String(Math.floor(buildingChallengeTimerSec % 60)).padStart(2, '0')}`}
                      </span>
                      <button
                        type="button"
                        data-testid="hud-cycle-challenge-prompt-btn"
                        onClick={() => {
                          const nextIdx =
                            (buildingChallengePromptIdx + 1) %
                            BUILDING_CHALLENGE_PROMPTS.length;
                          buildingChallengePromptIdxRef.current = nextIdx;
                          setBuildingChallengePromptIdx(nextIdx);
                        }}
                        className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                      >
                        NEXT PROMPT
                      </button>
                      <button
                        type="button"
                        data-testid="hud-run-challenge-test-btn"
                        onClick={() => startBuildingChallengeAutoTest()}
                        className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[10px] cursor-pointer"
                      >
                        AUTO-TEST NOW
                      </button>
                    </>
                  )}

                  {/* 4. Capture the Flag */}
                  {ModRegistry.activeGameModeId === 'CAPTURE_THE_FLAG' && (
                    <>
                      <span
                        data-testid="ctf-score-display"
                        className="font-extrabold text-[#e5e5e5]"
                      >
                        <span className="text-[#facc15]">
                          BLUE {ctfState.blueCaptures}
                        </span>{' '}
                        —{' '}
                        <span className="text-[#dc2626]">
                          RED {ctfState.redCaptures}
                        </span>{' '}
                        <span className="text-[#a3a3a3] text-[10px]">
                          (FIRST TO {ctfState.targetCaptures})
                        </span>
                      </span>
                      <span
                        data-testid="ctf-flag-status"
                        className={
                          ctfState.carrierOfRedFlag === 'LOCAL_PLAYER'
                            ? 'text-[#facc15] font-extrabold animate-pulse'
                            : 'text-[#e5e5e5]'
                        }
                      >
                        {ctfState.winnerTeam
                          ? `${ctfState.winnerTeam} TEAM WINS!`
                          : ctfState.carrierOfRedFlag === 'LOCAL_PLAYER'
                            ? 'CARRYING ENEMY FLAG -> RETURN TO BLUE BASE (Z = -42m)'
                            : 'STEAL RED FLAG AT NORTH BASE (Z = +54m)'}
                      </span>
                      {ctfState.winnerTeam && (
                        <button
                          type="button"
                          onClick={() =>
                            activateGameModeAndSetupWorld('CAPTURE_THE_FLAG')
                          }
                          className="px-2 py-0.5 bg-[#fbbf24] text-[#1a1a1a] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-[10px] cursor-pointer"
                        >
                          NEW MATCH
                        </button>
                      )}
                    </>
                  )}

                  {/* 5. Build Battle */}
                  {ModRegistry.activeGameModeId === 'BUILD_BATTLE' && (
                    <>
                      <span className="text-[#facc15] font-extrabold">
                        [{buildBattleState.phase}] {buildBattleState.prompt}
                      </span>
                      <span className="text-[#e5e5e5] font-bold">
                        TIME {Math.floor(buildBattleState.buildRemainingSec / 60)}:
                        {String(
                          Math.floor(buildBattleState.buildRemainingSec % 60),
                        ).padStart(2, '0')}
                      </span>
                      {buildBattleState.phase === 'BUILD' && (
                        <button
                          type="button"
                          data-testid="hud-start-build-battle-arena-btn"
                          onClick={() => {
                            const started = launchBuildBattleArena(
                              buildBattleStateRef.current,
                              mpState.playerName || 'Pilot_01',
                            );
                            buildBattleStateRef.current = started;
                            setBuildBattleState(started);
                          }}
                          className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[10px] cursor-pointer"
                        >
                          BATTLE ARENA NOW
                        </button>
                      )}
                      {buildBattleState.winnerName && (
                        <span
                          data-testid="build-battle-winner"
                          className="px-2 py-0.5 bg-[#fbbf24] text-[#1a1a1a] font-extrabold rounded-[2px]"
                        >
                          WINNER: {buildBattleState.winnerName}
                        </span>
                      )}
                    </>
                  )}

                  {/* 6. Survival Waves & 10. Juggernaut Boss Hunt */}
                  {(ModRegistry.activeGameModeId === 'SURVIVAL_WAVES' ||
                    ModRegistry.activeGameModeId === 'JUGGERNAUT_BOSS') && (
                    <>
                      <span
                        data-testid="survival-wave-number"
                        className="text-[#facc15] font-extrabold"
                      >
                        WAVE {survivalState.wave} (BEST: {survivalState.bestWave})
                      </span>
                      <span
                        data-testid="survival-enemies-count"
                        className="text-[#dc2626] font-bold"
                      >
                        CUBES: {survivalState.enemies.length}
                      </span>
                      <span
                        data-testid="survival-shield-hp"
                        className="text-[#e5e5e5] font-bold"
                      >
                        HULL: {Math.round(survivalState.playerShieldPct)}%
                      </span>
                      {survivalState.isGameOver && (
                        <span
                          data-testid="survival-gameover-badge"
                          className="px-2 py-0.5 bg-[#dc2626] text-[#e5e5e5] font-extrabold rounded-[2px] animate-pulse"
                        >
                          GAME OVER (WAVE {survivalState.wave})
                        </span>
                      )}
                      <button
                        type="button"
                        data-testid="survival-restart-btn"
                        onClick={() => {
                          simRef.current?.getActiveRig().repairVehicle();
                          activateGameModeAndSetupWorld(ModRegistry.activeGameModeId);
                        }}
                        className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-[10px] cursor-pointer"
                      >
                        {survivalState.isGameOver ? 'RETRY SURVIVAL' : 'RESET WAVE'}
                      </button>
                    </>
                  )}

                  {/* 7. King of the Hill */}
                  {ModRegistry.activeGameModeId === 'KING_OF_THE_HILL' && (
                    <>
                      <span className="text-[#facc15] font-extrabold">
                        CROWN CONTROL: {kingOfHillState.playerControlPct.toFixed(0)}%
                      </span>
                      <span className="text-[#e5e5e5] font-bold">
                        {kingOfHillState.winner === 'PLAYER'
                          ? '👑 YOU ARE KING OF THE HILL!'
                          : kingOfHillState.playerInZone
                            ? '⚡ HOLDING CROWN ZONE (+4.5%/s)'
                            : 'DRIVE TO CENTER HILL (X=0, Z=+12m)'}
                      </span>
                    </>
                  )}

                  {/* 9. Stunt Freestyle Jam */}
                  {ModRegistry.activeGameModeId === 'STUNT_FREESTYLE' && (
                    <>
                      <span className="text-[#facc15] font-extrabold">
                        STUNT SCORE: {stuntFreestyleState.totalScore} ({stuntFreestyleState.comboMultiplier.toFixed(1)}x)
                      </span>
                      <span className="text-[#e5e5e5] font-bold">
                        TIME: {stuntFreestyleState.remainingSec.toFixed(1)}s · {stuntFreestyleState.lastTrickBanner}
                      </span>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowModStudioModal(true)}
                    className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                  >
                    MODES [F4]
                  </button>
                </div>
              )}

              {/* Custom Race Track Live Lap & Ghost Replay Banner */}
              <div className="relative z-20 flex flex-col items-center gap-1.5 pointer-events-auto my-auto">
                {sim && sim.worldArenaSystems.trackNodes.length > 0 && !hud.isBuildMode && (
                  <div
                    data-testid="custom-track-race-banner"
                    className="bg-[#141414] border-2 border-[#38bdf8] text-[#e5e5e5] px-3 py-1 rounded-[2px] flex items-center gap-3 text-xs font-mono-num"
                  >
                    <span className="text-[#38bdf8] font-display font-extrabold uppercase">
                      CUSTOM TRACK ({sim.worldArenaSystems.trackNodes.length} NODES)
                    </span>
                    <span>
                      TIME:{' '}
                      <strong className="text-[#facc15]">
                        {sim.worldArenaSystems.currentLapTimeSec.toFixed(2)}s
                      </strong>
                    </span>
                    {sim.worldArenaSystems.bestLapTimeSec !== null && (
                      <span>
                        BEST (GHOST):{' '}
                        <strong className="text-[#4ade80]">
                          {sim.worldArenaSystems.bestLapTimeSec.toFixed(2)}s
                        </strong>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => sim.worldArenaSystems.clearTrackNodes()}
                      className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#dc2626] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9.5px] font-display font-bold uppercase cursor-pointer"
                    >
                      CLEAR TRACK
                    </button>
                  </div>
                )}
              </div>

              {/* 1st-Person Interactive Cockpit HUD Overlay */}
              {hud.cameraMode === 'FIRST_PERSON' &&
                hud.isSeatedInRig &&
                !hud.isBuildMode &&
                cockpitHudEnabled && (
                  <div
                    data-testid="first-person-cockpit-hud"
                    className="fixed inset-x-0 top-14 bottom-24 pointer-events-none z-20 flex flex-col justify-between items-center px-6"
                  >
                    {/* Top Digital Compass & Tactical Systems Bar */}
                    <div className="bg-[#090d16]/85 border border-[#38bdf8]/60 px-4 py-1 rounded-[2px] flex items-center gap-4 text-[10px] font-mono-num text-[#38bdf8] pointer-events-auto">
                      <span>COCKPIT HUD</span>
                      <span>PITCH: <LiveHudField select={selectPitchDeg} />°</span>
                      <span>ROLL: <LiveHudField select={selectRollDeg} />°</span>
                      <span>ALT: <LiveHudField select={selectAltitude} /></span>
                      <button
                        type="button"
                        onClick={() => setCockpitHudEnabled(false)}
                        className="px-1.5 py-0.2 bg-[#1e293b] text-[#94a3b8] hover:text-[#e5e5e5] border border-[#38bdf8]/40 rounded-[2px] text-[8.5px] cursor-pointer"
                      >
                        HIDE HUD
                      </button>
                    </div>

                    {/* Central Artificial Horizon & Aim Reticle */}
                    <div className="relative w-56 h-56 flex items-center justify-center">
                      <LiveCockpitHorizonSvg />
                    </div>

                    {/* Bottom Cockpit Tactical Readout Strip */}
                    <div className="bg-[#090d16]/85 border border-[#38bdf8]/60 px-4 py-1.5 rounded-[2px] flex flex-wrap items-center gap-3 text-[10px] font-mono-num text-[#e5e5e5]">
                      <span className="text-[#facc15] font-bold">
                        SPD <LiveHudField select={selectSpeedKmh} /> KM/H
                      </span>
                      <span className="text-[#38bdf8]">
                        RPM <LiveHudField select={selectEngineRpm} />
                      </span>
                      <span className="text-[#4ade80]">
                        HULL <LiveHudField select={selectHullPct} />%
                      </span>
                      {sim?.activeVehicle && sim.activeVehicle.magnetCouplerCount > 0 && (
                        <span className="px-1.5 py-0.2 bg-[#1e293b] border border-[#38bdf8] text-[#38bdf8] rounded-[2px]">
                          [K/L] MAGNET: {sim.activeVehicle.magnetCouplerMode}
                        </span>
                      )}
                      {sim?.activeVehicle && sim.activeVehicle.parachuteCount > 0 && (
                        <span className="px-1.5 py-0.2 bg-[#1e293b] border border-[#f97316] text-[#f97316] rounded-[2px]">
                          [U] CHUTE: {sim.activeVehicle.parachuteDeployed ? 'DEPLOYED' : 'STOWED'}
                        </span>
                      )}
                      {sim?.activeVehicle && sim.activeVehicle.outriggerCount > 0 && (
                        <span className="px-1.5 py-0.2 bg-[#1e293b] border border-[#facc15] text-[#facc15] rounded-[2px]">
                          [J] JACKS: {sim.activeVehicle.outriggersDeployed ? 'ANCHORED' : 'UP'}
                        </span>
                      )}
                      {sim?.activeVehicle && sim.activeVehicle.smokeFlareCount > 0 && (
                        <span className="px-1.5 py-0.2 bg-[#1e293b] border border-[#ef4444] text-[#ef4444] rounded-[2px]">
                          [I] FLARES READY
                        </span>
                      )}
                    </div>
                  </div>
                )}

              {/* BOTTOM ROW: Compact World Editor Dock OR Driving Actuators + Speedometer */}
              <div className={`relative flex items-end justify-between gap-3 ${showPropsPopover ? 'z-[85]' : 'z-20'}`}>
                {hud.isWorldEditMode && !isMobileHud ? (
                  <div
                    data-testid="world-editor-dock"
                    data-hud-widget="world-editor-dock"
                    data-hud-label="WORLD EDITOR DOCK"
                    style={getWidgetTransformStyle(hudCustom, 'world-editor-dock', undefined, 'bottom left')}
                    className={`flex flex-col gap-1.5 bg-[#1a1a1a] border-2 border-[#444444] px-3 py-2 rounded-[2px] pointer-events-auto max-w-2xl w-full ${
                      getWidgetState(hudCustom, 'world-editor-dock').visible ? '' : 'hidden'
                    }`}
                  >
                    {/* World Editor Tool Tabs + Collapse Toggle */}
                    <div className="flex flex-wrap items-center justify-between gap-1 border-b-2 border-[#444444] pb-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] px-1.5 py-0.5 rounded-[2px] uppercase mr-0.5">
                          TERRAFORM
                        </span>
                        {(
                          [
                            { id: 'PLACE_PROP', label: 'PLACE PROPS' },
                            { id: 'PLACE_OBJECT', label: 'WORLD STAMP' },
                            { id: 'SPAWN_VOXEL_ENTITY', label: 'PRESET ENTITY' },
                            { id: 'SPAWN_MAP_HAZARD', label: 'SPINNING HAZARDS' },
                            { id: 'TERRA_RAISE', label: 'RAISE' },
                            { id: 'TERRA_LOWER', label: 'LOWER' },
                            { id: 'TERRA_FLATTEN', label: 'FLATTEN' },
                            { id: 'TERRA_RAMP', label: 'RAMP A-B' },
                            { id: 'TERRA_PAINT', label: 'PAINT' },
                          ] as Array<{ id: WorldEditToolKind; label: string }>
                        ).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            data-testid={`world-tool-${t.id}`}
                            onClick={() => sim?.setWorldEditTool(t.id)}
                            className={`px-2 py-0.5 rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer transition whitespace-nowrap border-2 ${
                              hud.worldEditTool === t.id
                                ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid="world-dock-save-load-btn"
                          onClick={() => setShowWorldGenModal(true)}
                          className="px-2 py-0.5 bg-[#22c55e] hover:bg-[#16a34a] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer whitespace-nowrap"
                        >
                          SAVE / LOAD WORLD
                        </button>
                        <button
                          type="button"
                          onClick={() => sim?.toggleObjectStudioMode(true)}
                          className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer whitespace-nowrap"
                        >
                          + MAKE PROP
                        </button>
                        <button
                          type="button"
                          onClick={() => setDockCollapsed((c) => !c)}
                          className="px-1.5 py-0.5 bg-[#6b7280] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                        >
                          {dockCollapsed ? 'SHOW' : 'HIDE'}
                        </button>
                      </div>
                    </div>

                    {!dockCollapsed && (
                      <>
                        {hud.worldEditTool === 'PLACE_OBJECT' || hud.worldEditTool === 'PLACE_PROP' ? (
                          <div className="flex flex-col gap-1.5">
                            {/* Controls Sub-Bar: Categories, Physics Mode, Actions */}
                            <div className="flex flex-wrap items-center justify-between gap-1.5 bg-[#141414] px-2 py-1 rounded-[2px] border border-[#333333]">
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-[10px] font-display font-bold uppercase text-[#fbbf24] mr-0.5">
                                  CATEGORY:
                                </span>
                                {(
                                  [
                                    { id: 'ALL', label: 'ALL' },
                                    { id: 'PROPS', label: 'PHYSICS PROPS' },
                                    { id: 'STUNT', label: 'STUNTS' },
                                    { id: 'HAZARD', label: 'HAZARDS' },
                                    { id: 'BUILDING', label: 'STRUCTURES' },
                                    { id: 'CUSTOM', label: 'CUSTOM' },
                                  ] as const
                                ).map((cat) => (
                                  <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => setPropCategoryTab(cat.id)}
                                    className={`px-1.5 py-0.5 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer border ${
                                      propCategoryTab === cat.id
                                        ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#e5e5e5]'
                                        : 'bg-[#262626] text-[#a3a3a3] border-[#444444] hover:text-[#e5e5e5]'
                                    }`}
                                  >
                                    {cat.label}
                                  </button>
                                ))}
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  data-testid="toggle-prop-physics-mode-btn"
                                  onClick={() => sim?.togglePropPhysicsMode()}
                                  title="Toggle whether props are placed as full 6-DOF dynamic physics bodies or stamped into terrain"
                                  className={`px-2 py-0.5 rounded-[2px] text-[10px] font-display font-bold uppercase border-2 cursor-pointer ${
                                    hud.propPhysicsMode === 'DYNAMIC'
                                      ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#e5e5e5]'
                                      : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                                  }`}
                                >
                                  {hud.propPhysicsMode === 'DYNAMIC' ? 'MODE: 6-DOF DYNAMIC' : 'MODE: STATIC STAMP'}
                                </button>
                                <button
                                  type="button"
                                  data-testid="world-spawn-prop-front-btn"
                                  onClick={() => sim?.spawnCurrentPropInFront()}
                                  className="px-2 py-0.5 bg-[#22c55e] hover:bg-[#16a34a] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[10px] cursor-pointer"
                                >
                                  + DROP IN FRONT
                                </button>
                                <button
                                  type="button"
                                  onClick={() => sim?.clearVoxelEntities()}
                                  className="px-2 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-[10px] cursor-pointer"
                                >
                                  CLEAR PROPS
                                </button>
                              </div>
                            </div>

                            {/* Placeable Prefabs Grid */}
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 max-h-40 overflow-y-auto pr-1">
                              {allPlaceableObjects
                                .filter((obj) => {
                                  if (propCategoryTab === 'ALL') return true;
                                  if (propCategoryTab === 'PROPS') return obj.id.startsWith('prop_') || obj.tag === 'PROP';
                                  if (propCategoryTab === 'STUNT') return obj.category === 'STUNT';
                                  if (propCategoryTab === 'HAZARD') return obj.category === 'HAZARD';
                                  if (propCategoryTab === 'BUILDING') return obj.category === 'BUILDING';
                                  if (propCategoryTab === 'CUSTOM') return obj.category === 'CUSTOM' || !PREBUILT_OBJECTS.some((p) => p.id === obj.id);
                                  return true;
                                })
                                .map((obj) => {
                                  const isSelected = hud.selectedObjectId === obj.id;
                                  return (
                                    <button
                                      key={obj.id}
                                      type="button"
                                      data-testid={`placeable-object-${obj.id}`}
                                      onClick={() => sim?.selectPlaceableObject(obj.id)}
                                      className={`p-1.5 rounded-[2px] border-2 text-left transition cursor-pointer ${
                                        isSelected
                                          ? 'bg-[#2a2a2a] border-[#facc15]'
                                          : 'bg-[#222222] border-[#444444] hover:border-[#fbbf24]'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between text-[9px] font-mono-num font-bold">
                                        <span className="text-[#facc15] truncate max-w-[50px]">
                                          {obj.category}
                                        </span>
                                        <span className="text-[#a3a3a3]">
                                          {obj.sizeX}×{obj.sizeZ}
                                        </span>
                                      </div>
                                      <div className="text-[11px] font-display font-bold text-[#e5e5e5] uppercase truncate">
                                        {obj.name}
                                      </div>
                                    </button>
                                  );
                                })}
                            </div>

                            {/* Rotation & Placement Hint Strip */}
                            <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono-num text-[#a3a3a3] pt-0.5 border-t border-[#333333]">
                              <div className="flex items-center gap-1">
                                <span>ROTATION:</span>
                                <button
                                  type="button"
                                  onClick={() => sim?.rotatePartAxis('yaw')}
                                  className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9.5px] font-display font-bold"
                                >
                                  YAW ({DIR_NAMES[hud.partYawIndex]}) [R]
                                </button>
                                <button
                                  type="button"
                                  onClick={() => sim?.rotatePartAxis('pitch')}
                                  className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9.5px] font-display font-bold"
                                >
                                  PITCH ({AXIS_ROT_NAMES[hud.partPitchIndex]}) [T]
                                </button>
                                <button
                                  type="button"
                                  onClick={() => sim?.rotatePartAxis('roll')}
                                  className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9.5px] font-display font-bold"
                                >
                                  ROLL ({AXIS_ROT_NAMES[hud.partRollIndex]}) [Y]
                                </button>
                                <button
                                  type="button"
                                  onClick={() => sim?.resetPartRotation()}
                                  className="px-1.5 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9.5px] font-display font-bold"
                                >
                                  RESET
                                </button>
                              </div>
                              <span>
                                Left-Click = Place ({hud.propPhysicsMode === 'DYNAMIC' ? '6-DOF Physics Prop' : 'Static World Stamp'}) · Right-Click = Remove Prop
                              </span>
                            </div>
                          </div>
                        ) : hud.worldEditTool === 'SPAWN_VOXEL_ENTITY' ? (
                          <div className="flex flex-col gap-1.5">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                              {VOXEL_ENTITY_PRESETS.map((ent) => {
                                const isSelected =
                                  hud.selectedVoxelEntityId === ent.id;
                                return (
                                  <button
                                    key={ent.id}
                                    type="button"
                                    data-testid={`voxel-entity-preset-${ent.id}`}
                                    onClick={() =>
                                      sim?.selectVoxelEntityPreset(ent.id)
                                    }
                                    className={`p-1.5 rounded-[2px] border-2 text-left transition cursor-pointer ${
                                      isSelected
                                        ? 'bg-[#2a2a2a] border-[#facc15]'
                                        : 'bg-[#222222] border-[#444444] hover:border-[#fbbf24]'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between text-[9px] font-mono-num font-bold">
                                      <span style={{ color: ent.badgeColor }}>
                                        {ent.category}
                                      </span>
                                      <span className="text-[#a3a3a3]">
                                        {ent.sizeVoxels.x}×{ent.sizeVoxels.y}×{ent.sizeVoxels.z}
                                      </span>
                                    </div>
                                    <div className="text-[11px] font-display font-bold text-[#e5e5e5] uppercase truncate">
                                      {ent.name}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-num text-[#a3a3a3] pt-0.5">
                              <span>
                                Active Voxel Entities:{' '}
                                <strong className="text-[#fbbf24]">
                                  {hud.voxelEntitiesCount}
                                </strong>{' '}
                                (60Hz Physics · Non-Static · Non-Vehicle)
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  data-testid="world-spawn-entity-front-btn"
                                  onClick={() =>
                                    sim?.spawnVoxelEntityAt(
                                      hud.selectedVoxelEntityId,
                                    )
                                  }
                                  className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] font-display font-extrabold uppercase cursor-pointer"
                                >
                                  + DROP IN FRONT
                                </button>
                                <button
                                  type="button"
                                  data-testid="world-reset-entities-btn"
                                  onClick={() => sim?.resetArenaVoxelEntities()}
                                  className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-bold uppercase cursor-pointer"
                                >
                                  RESET PROPS
                                </button>
                                <button
                                  type="button"
                                  data-testid="world-clear-entities-btn"
                                  onClick={() => sim?.clearVoxelEntities()}
                                  className="px-2 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-bold uppercase cursor-pointer"
                                >
                                  CLEAR ALL
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : hud.worldEditTool === 'SPAWN_MAP_HAZARD' ? (
                          <div className="flex flex-col gap-1.5">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                              {MAP_HAZARD_PRESETS.map((haz) => {
                                const isSelected =
                                  hud.selectedMapHazardId === haz.id;
                                return (
                                  <button
                                    key={haz.id}
                                    type="button"
                                    data-testid={`map-hazard-preset-${haz.id}`}
                                    onClick={() =>
                                      sim?.selectMapHazardPreset(haz.id)
                                    }
                                    className={`p-1.5 rounded-[2px] border-2 text-left transition cursor-pointer ${
                                      isSelected
                                        ? 'bg-[#2a2a2a] border-[#facc15]'
                                        : 'bg-[#222222] border-[#444444] hover:border-[#fbbf24]'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between text-[9px] font-mono-num font-bold">
                                      <span style={{ color: haz.badgeColor }}>
                                        {haz.category}
                                      </span>
                                      <span className="text-[#a3a3a3]">
                                        {haz.rpm} RPM
                                      </span>
                                    </div>
                                    <div className="text-[11px] font-display font-bold text-[#e5e5e5] uppercase truncate">
                                      {haz.name}
                                    </div>
                                    <div className="text-[9.5px] text-[#a3a3a3] truncate">
                                      {haz.desc}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-num text-[#a3a3a3] pt-0.5">
                              <span>
                                Active Spinning Hazards:{' '}
                                <strong className="text-[#fbbf24]">
                                  {hud.mapHazardsCount}
                                </strong>{' '}
                                · Left-Click = Place · Right-Click = Remove / Rotate [R]
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  data-testid="world-spawn-hazard-front-btn"
                                  onClick={() =>
                                    sim?.spawnMapHazardAt(
                                      hud.selectedMapHazardId,
                                    )
                                  }
                                  className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] font-display font-extrabold uppercase cursor-pointer"
                                >
                                  + PLACE IN FRONT
                                </button>
                                <button
                                  type="button"
                                  data-testid="world-reset-hazards-btn"
                                  onClick={() => sim?.resetArenaMapHazards()}
                                  className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-bold uppercase cursor-pointer"
                                >
                                  RESET HAZARDS
                                </button>
                                <button
                                  type="button"
                                  data-testid="world-clear-hazards-btn"
                                  onClick={() => sim?.clearMapHazards()}
                                  className="px-2 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-bold uppercase cursor-pointer"
                                >
                                  CLEAR HAZARDS
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-mono-num text-[#a3a3a3]">
                                Radius:
                              </span>
                              {[4, 8, 12, 16].map((rad) => (
                                <button
                                  key={rad}
                                  type="button"
                                  onClick={() => sim?.setTerraBrushRadius(rad)}
                                  className={`px-2 py-0.5 rounded-[2px] text-[11px] font-mono-num font-bold cursor-pointer border-2 ${
                                    hud.terraBrushRadius === rad
                                      ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                      : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                                  }`}
                                >
                                  {rad}v
                                </button>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-[10px] font-mono-num text-[#a3a3a3]">
                                Paint:
                              </span>
                              {[
                                MAT.GRASS,
                                MAT.SAND,
                                MAT.DIRT,
                                MAT.ROCK,
                                MAT.ASPHALT,
                                MAT.CONCRETE,
                                MAT.CANYON_ORANGE,
                                MAT.C4_EXPLOSIVE,
                              ].map((matId) => (
                                <button
                                  key={matId}
                                  type="button"
                                  onClick={() => sim?.setTerraPaintMat(matId)}
                                  className={`px-2 py-0.5 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer border-2 ${
                                    hud.terraPaintMat === matId
                                      ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                      : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                                  }`}
                                >
                                  {MAT_INFO[matId]?.name || 'Voxel'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="text-[10px] font-mono-num text-[#a3a3a3] flex flex-wrap items-center justify-between pt-1 border-t-2 border-[#444444]">
                          <span>
                            TARGET:{' '}
                            <strong className="text-[#facc15]">
                              <LiveHudField select={selectRayTarget} />
                            </strong>
                          </span>
                          <span>
                            Hold R-Click Drag = Look/Orbit · Scroll = Zoom · WASD+Space/Q = Fly · L-Click = Apply · R-Click = Carve · [F] Focus
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ) : !hud.isSeatedInRig && !isMobileHud ? (
                  /* On-Foot Compact Hotbar */
                  <div
                    data-hud-widget="walk-tools-dock"
                    data-hud-label="ON-FOOT TOOLS DOCK"
                    style={getWidgetTransformStyle(hudCustom, 'walk-tools-dock', undefined, 'bottom left')}
                    className={`flex flex-col gap-1 pointer-events-auto max-w-[calc(100vw-16px)] ${
                      getWidgetState(hudCustom, 'walk-tools-dock').visible ? '' : 'hidden'
                    }`}
                  >
                    <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 bg-[#1a1a1a] border-2 border-[#444444] p-1.5 rounded-[2px] overflow-x-auto no-scrollbar">
                      {PLAY_SLOTS.slice(0, 3).map((item) => {
                        const active = hud.selectedSlot === item.slot;
                        return (
                          <button
                            key={item.slot}
                            type="button"
                            tabIndex={-1}
                            data-testid={`walk-slot-${item.slot}`}
                            onClick={(e) => {
                              e.currentTarget.blur();
                              sim?.selectSlot(item.slot);
                            }}
                            className={`flex-shrink-0 px-2.5 py-1 rounded-[2px] border-2 text-left transition cursor-pointer ${
                              active
                                ? 'bg-[#2a2a2a] border-[#facc15]'
                                : 'bg-[#222222] border-[#444444] hover:border-[#fbbf24]'
                            }`}
                          >
                            <div
                              className="text-[10px] font-display font-bold uppercase whitespace-nowrap"
                              style={{ color: item.color }}
                            >
                              [{item.key}] {item.name}
                            </div>
                            <div className="text-[9px] font-mono-num text-[#a3a3a3] whitespace-nowrap">
                              {item.tag}
                            </div>
                          </button>
                        );
                      })}

                      {/* Consolidated Slot [4]: Field Welder & Builder Tool with Shape Cycler */}
                      {(() => {
                        const isWelderActive = hud.selectedSlot >= 4 && hud.selectedSlot <= 8;
                        const activeWelderSlot = isWelderActive ? hud.selectedSlot : 4;
                        const currentWelderItem = PLAY_SLOTS.find((s) => s.slot === activeWelderSlot) || PLAY_SLOTS[3];
                        const welderShapes = [
                          { slot: 4, label: '1×1' },
                          { slot: 5, label: 'WALL' },
                          { slot: 6, label: 'RAMP' },
                          { slot: 7, label: 'FLOOR' },
                          { slot: 8, label: 'PILLAR' },
                        ];

                        return (
                          <div
                            className={`flex-shrink-0 px-2.5 py-1 rounded-[2px] border-2 text-left transition flex items-center gap-2 ${
                              isWelderActive
                                ? 'bg-[#2a2a2a] border-[#facc15]'
                                : 'bg-[#222222] border-[#444444] hover:border-[#fbbf24]'
                            }`}
                          >
                            <button
                              type="button"
                              tabIndex={-1}
                              data-testid="walk-slot-4"
                              onClick={(e) => {
                                e.currentTarget.blur();
                                if (isWelderActive) {
                                  const nextSlot = hud.selectedSlot >= 8 ? 4 : hud.selectedSlot + 1;
                                  sim?.selectSlot(nextSlot);
                                } else {
                                  sim?.selectSlot(4);
                                }
                              }}
                              className="cursor-pointer text-left"
                            >
                              <div className="text-[10px] font-display font-bold uppercase text-[#facc15]">
                                [4] FIELD WELDER &amp; BUILDER
                              </div>
                              <div className="text-[9px] font-mono-num text-[#e5e5e5]">
                                Shape: <span className="font-bold text-[#fbbf24]">{currentWelderItem.name.replace('Light ', '')}</span>
                                <span className="text-[#a3a3a3] ml-1">(R: Cycle)</span>
                              </div>
                            </button>

                            {/* Shape Selector Chips with direct data-testids for instant switching */}
                            <div className="flex items-center gap-1 border-l-2 border-[#444444] pl-2">
                              {welderShapes.map((ws) => (
                                <button
                                  key={ws.slot}
                                  type="button"
                                  tabIndex={-1}
                                  data-testid={`walk-slot-${ws.slot}`}
                                  onClick={(e) => {
                                    e.currentTarget.blur();
                                    sim?.selectSlot(ws.slot);
                                  }}
                                  className={`px-1.5 py-0.5 rounded-[2px] text-[9px] font-display font-bold uppercase transition cursor-pointer border-2 ${
                                    hud.selectedSlot === ws.slot
                                      ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                      : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                                  }`}
                                  title={`Switch shape to ${ws.label}`}
                                >
                                  {ws.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ) : !isMobileHud && hudCustom.showActionDock ? (
                  /* Driving Mode Context-Aware Minimal Gadget & Custom Module Keybind Strip */
                  (hud.pistonCount > 0 ||
                    hud.winchCount > 0 ||
                    hud.gyroCount > 0 ||
                    drivingActionModuleBadges.length > 0 ||
                    !minimalHudMode ||
                    showHudEditorModal) ? (
                    <div
                      data-testid="desktop-action-dock"
                      data-hud-widget="action-dock"
                      data-hud-label="ACTION DOCK"
                      style={getWidgetTransformStyle(
                        hudCustom,
                        'action-dock',
                        undefined,
                        'bottom left',
                      )}
                      className="hidden sm:flex flex-wrap items-center gap-1 text-[10px] font-mono-num text-[#e5e5e5] bg-[#1a1a1a]/90 px-1.5 py-1 rounded-[2px] border border-[#444444] pointer-events-auto"
                    >
                      {drivingActionModuleBadges.length > 0 && (
                        <div
                          data-testid="driving-module-keybind-badges"
                          className="flex flex-wrap items-center gap-1"
                        >
                          {drivingActionModuleBadges.map((grp) => {
                            const posLabel =
                              BINDABLE_KEYS.find((k) => k.code === grp.posKey)
                                ?.label.split(' ')[0] || grp.posKey;
                            const negLabel =
                              grp.negKey !== 'NONE'
                                ? BINDABLE_KEYS.find((k) => k.code === grp.negKey)
                                    ?.label.split(' ')[0] || grp.negKey
                                : null;
                            const isHeld =
                              Boolean(sim?.keys[grp.posKey]) ||
                              (grp.negKey !== 'NONE' && Boolean(sim?.keys[grp.negKey]));
                            return (
                              <span
                                key={grp.kind}
                                data-testid={`hud-keybind-badge-${grp.kind}`}
                                className={`px-2 py-0.5 rounded-[2px] font-display font-bold uppercase border-2 text-[10px] ${
                                  isHeld
                                    ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                    : 'bg-[#222222] text-[#e5e5e5] border-[#444444]'
                                }`}
                              >
                                <strong className={isHeld ? 'text-[#1a1a1a]' : 'text-[#fbbf24]'}>
                                  [{posLabel}
                                  {negLabel ? `/${negLabel}` : ''}]
                                </strong>{' '}
                                {grp.name}
                                {grp.count > 1 ? ` ×${grp.count}` : ''}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {sim?.activeVehicle?.hasSubmarineBallast && (
                        <span
                          data-testid="submarine-ballast-badge"
                          className={`px-2 py-0.5 rounded-[2px] font-display font-bold uppercase border-2 text-[10px] ${
                            sim.activeVehicle.submarineBallastTrim < -0.05
                              ? 'bg-[#0284c7] text-[#e5e5e5] border-[#38bdf8]'
                              : sim.activeVehicle.submarineBallastTrim > 0.05
                                ? 'bg-[#38bdf8] text-[#0f172a] border-[#e5e5e5]'
                                : 'bg-[#0f172a] text-[#38bdf8] border-[#0284c7]'
                          }`}
                        >
                          SUB BALLAST [SPACE/CTRL]:{' '}
                          {sim.activeVehicle.submarineBallastTrim < -0.05
                            ? 'FLOODING (DIVE ▼)'
                            : sim.activeVehicle.submarineBallastTrim > 0.05
                              ? 'BLOWING (SURF ▲)'
                              : 'NEUTRAL HOVER'}
                        </span>
                      )}
                      {activeMissionId !== 'NONE' && missionProgressText && (
                        <span
                          data-testid="active-mission-hud-banner"
                          className={`px-2 py-0.5 rounded-[2px] font-display font-bold uppercase border-2 text-[10px] ${
                            missionCompleted
                              ? 'bg-[#4ade80] text-[#141414] border-[#e5e5e5]'
                              : 'bg-[#1e293b] text-[#facc15] border-[#38bdf8]'
                          }`}
                        >
                          {missionProgressText}
                        </span>
                      )}
                      {hud.pistonCount > 0 && (
                        <button
                          type="button"
                          data-testid="toggle-pistons-btn"
                          onClick={() => {
                            sim?.getActiveRig().togglePistons();
                          }}
                          className={`px-2 py-0.5 rounded-[2px] font-display font-bold uppercase cursor-pointer border-2 ${
                            hud.pistonExtended
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                              : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:bg-[#333333]'
                          }`}
                        >
                          [X] PISTONS: {hud.pistonExtended ? 'EXT' : 'RET'}
                        </button>
                      )}
                      {hud.winchCount > 0 && (
                        <button
                          type="button"
                          data-testid="toggle-winch-btn"
                          onClick={() => {
                            if (sim) {
                              const dir = new THREE.Vector3();
                              sim.camera.getWorldDirection(dir);
                              sim.getActiveRig().toggleWinch(sim.camera.position, dir);
                            }
                          }}
                          className={`px-2 py-0.5 rounded-[2px] font-display font-bold uppercase cursor-pointer border-2 ${
                            hud.winchActive
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                              : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:bg-[#333333]'
                          }`}
                        >
                          [T] GRAPPLE: {hud.winchActive ? 'HOOKED' : 'READY'}
                        </button>
                      )}
                      {hud.gyroCount > 0 && (
                        <button
                          type="button"
                          data-testid="toggle-gyro-btn"
                          onClick={() => {
                            const activeRig = sim?.getActiveRig();
                            if (activeRig && activeRig.gyroCount > 0) {
                              const nextGyro = activeRig.toggleGyro();
                              setHud((h) => ({
                                ...h,
                                gyroEnabled: nextGyro,
                              }));
                            }
                          }}
                          className={`px-2 py-0.5 rounded-[2px] font-display font-bold uppercase cursor-pointer border-2 ${
                            hud.gyroEnabled
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                              : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:bg-[#333333]'
                          }`}
                        >
                          [Y] GYRO: {hud.gyroEnabled ? 'ON' : 'OFF'}
                        </button>
                      )}
                      {!minimalHudMode && (
                        <>
                          <button
                            type="button"
                            data-testid="dock-toggle-headlights-btn"
                            onClick={() => {
                              const activeRig = sim?.getActiveRig();
                              if (activeRig) {
                                activeRig.toggleHeadlights();
                                setHud((h) => ({
                                  ...h,
                                  headlightsOn: Boolean(activeRig.headlightsOn),
                                }));
                              }
                            }}
                            className={`px-2 py-0.5 rounded-[2px] font-display font-bold uppercase cursor-pointer border-2 ${
                              hud.headlightsOn
                                ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:bg-[#333333]'
                            }`}
                          >
                            [H] LIGHTS: {hud.headlightsOn ? 'ON' : 'OFF'}
                          </button>
                          <button
                            type="button"
                            data-testid="dock-upright-btn"
                            onClick={() => sim?.callAndUprightRig()}
                            className="px-2 py-0.5 rounded-[2px] font-display font-bold uppercase cursor-pointer border-2 bg-[#262626] text-[#e5e5e5] border-[#444444] hover:bg-[#333333]"
                          >
                            [R] UPRIGHT
                          </button>
                          <div className="relative">
                            <button
                              type="button"
                              data-testid="toggle-props-popover-btn"
                              aria-expanded={showPropsPopover}
                              onClick={() => setShowPropsPopover((p) => !p)}
                              className={`px-2 py-0.5 rounded-[2px] font-display font-extrabold uppercase cursor-pointer border-2 ${
                                showPropsPopover
                                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                                  : 'bg-[#fbbf24] text-[#1a1a1a] border-[#444444] hover:bg-[#facc15]'
                              }`}
                            >
                              PROPS ({hud.voxelEntitiesCount}) {showPropsPopover ? '▴' : '▾'}
                            </button>
                            {showPropsPopover && (
                              <div
                                data-testid="voxel-entities-popover"
                                className="absolute left-0 bottom-full mb-2 w-80 max-w-[calc(100vw-20px)] max-h-[calc(100dvh-64px)] overflow-y-auto overscroll-contain bg-[#1a1a1a] border-2 border-[#fbbf24] rounded-[2px] p-2.5 z-[90] shadow-2xl"
                              >
                                <div className="flex items-center justify-between border-b border-[#444444] pb-1.5 mb-2">
                                  <span className="text-[11px] font-display font-extrabold text-[#fbbf24] uppercase">
                                    VOXEL ENTITIES ({hud.voxelEntitiesCount} ACTIVE)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setShowPropsPopover(false)}
                                    className="text-[10px] font-mono-num text-[#a3a3a3] hover:text-[#e5e5e5] cursor-pointer"
                                  >
                                    CLOSE
                                  </button>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 mb-2">
                                  {VOXEL_ENTITY_PRESETS.map((ent) => (
                                    <button
                                      key={ent.id}
                                      type="button"
                                      data-testid={`spawn-entity-${ent.id}`}
                                      onClick={() => sim?.spawnVoxelEntityAt(ent.id)}
                                      className="px-2 py-1.5 rounded-[2px] bg-[#262626] hover:bg-[#333333] border border-[#444444] hover:border-[#fbbf24] text-left cursor-pointer transition"
                                    >
                                      <div
                                        className="text-[9.5px] font-mono-num font-bold uppercase"
                                        style={{ color: ent.badgeColor }}
                                      >
                                        + {ent.shortLabel}
                                      </div>
                                      <div className="text-[9px] text-[#a3a3a3] truncate">
                                        {ent.name}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                                <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-[#444444]">
                                  <button
                                    type="button"
                                    data-testid="reset-arena-entities-btn"
                                    onClick={() => sim?.resetArenaVoxelEntities()}
                                    className="flex-1 px-2 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                                  >
                                    RESET ARENA PROPS
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="clear-arena-entities-btn"
                                    onClick={() => sim?.clearVoxelEntities()}
                                    className="px-2 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                                  >
                                    CLEAR
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div />
                  )
                ) : (
                  <div />
                )}

                {/* PERMANENT DAMAGE DIAGRAM + COMPACT SPEEDOMETER-ONLY DIAL (Desktop bottom-right) */}
                {!isMobileHud && (
                  <div className="flex items-end gap-2 ml-auto pointer-events-none">
                    {showIntegrityDiagram && hudCustom.showDamageDiagram && !hud.isWorldEditMode && (
                      <div
                        data-hud-widget="damage-diagram"
                        data-hud-label="DAMAGE HUD"
                        style={getWidgetTransformStyle(
                          hudCustom,
                          'damage-diagram',
                          undefined,
                          'bottom right',
                        )}
                        className="pointer-events-auto"
                      >
                        <VehicleIntegrityDiagram
                          vehicle={sim?.getActiveRig() ?? null}
                          vehicleName={hud.presetName}
                          enabled={true}
                        />
                      </div>
                    )}

                    {hudCustom.showSpeedometer && !hud.isWorldEditMode && (
                      <div
                        data-hud-widget="speedometer"
                        data-hud-label="SPEEDOMETER"
                        style={getWidgetTransformStyle(
                          hudCustom,
                          'speedometer',
                          undefined,
                          'bottom right',
                        )}
                        className="pointer-events-auto"
                      >
                        <LiveSpeedometerGauge
                          scale={1}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* MOBILE PERMANENT COMPACT OCTAGONAL DAMAGE DIAGRAM & SPEEDOMETER PODS (Independent anchors so each pod can be dragged & resized separately) */}
                {isMobileHud && !hud.isWorldEditMode && (
                  <div
                    data-testid="mobile-play-telemetry-row"
                    className="pointer-events-none"
                  >
                    {showIntegrityDiagram && hudCustom.showDamageDiagram && (
                      <div
                        data-hud-widget="damage-diagram"
                        data-hud-label="DAMAGE HUD"
                        className="fixed right-[76px] z-30 pointer-events-auto"
                        style={{
                          top: `${hudCustom.showTopBar ? Math.round(8 + 38 * hudCustom.topBarScale * hudCustom.globalUiScale) : 8}px`,
                          ...(getWidgetTransformStyle(
                            hudCustom,
                            'damage-diagram',
                            undefined,
                            'top right',
                          ) ?? {}),
                        }}
                      >
                        <VehicleIntegrityDiagram
                          vehicle={sim?.getActiveRig() ?? null}
                          vehicleName={hud.presetName}
                          enabled={true}
                          compactMobile={true}
                        />
                      </div>
                    )}

                    {hudCustom.showSpeedometer && (
                      <div
                        data-hud-widget="speedometer"
                        data-hud-label="SPEEDOMETER"
                        className="fixed right-2.5 z-30 pointer-events-auto"
                        style={{
                          top: `${hudCustom.showTopBar ? Math.round(8 + 38 * hudCustom.topBarScale * hudCustom.globalUiScale) : 8}px`,
                          ...(getWidgetTransformStyle(
                            hudCustom,
                            'speedometer',
                            undefined,
                            'top right',
                          ) ?? {}),
                        }}
                      >
                        <LiveSpeedometerGauge
                          compactMobile={true}
                          scale={1}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* =====================================================================
          3. INDUSTRIAL BLUEPRINT GARAGE & VEHICLE CHOOSER MODAL
          ===================================================================== */}
      {showGarageModal && (
        <div
          data-testid="garage-modal-backdrop"
          data-layout-mode={isMobilePopup ? 'mobile' : 'laptop'}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowGarageModal(false);
          }}
          className={`fixed inset-0 z-[110] bg-[#141414]/90 flex items-center justify-center pointer-events-auto touch-manipulation ${
            isMobilePopup ? 'p-1.5' : 'p-4'
          }`}
        >
          <div
            className={`bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[#e5e5e5] overflow-y-auto overscroll-contain touch-pan-y flex flex-col ${
              isMobilePopup
                ? 'w-[min(96vw,540px)] max-h-[calc(100dvh-16px)] p-2.5 gap-2'
                : 'w-full max-w-3xl max-h-[90vh] p-5 gap-3'
            }`}
          >
            {/* Sticky Header so Close button is always visible on Mobile */}
            <div
              className={`sticky top-0 z-20 bg-[#1a1a1a] flex items-center justify-between gap-2 border-b-2 border-[#444444] ${
                isMobilePopup
                  ? '-mx-2.5 -mt-2.5 px-2.5 py-2'
                  : '-mx-5 -mt-5 px-5 py-3.5'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] px-2 py-0.5 rounded-[2px] uppercase tracking-wide shrink-0">
                  GARAGE
                </span>
                <h2
                  className={`font-display font-bold text-[#e5e5e5] uppercase tracking-wide truncate ${
                    isMobilePopup ? 'text-xs' : 'text-base'
                  }`}
                >
                  {isMobilePopup ? 'VEHICLES & BLUEPRINTS' : 'CHOOSE VEHICLE & BLUEPRINTS'}
                </h2>
              </div>
              <button
                type="button"
                data-testid="close-garage-modal-btn"
                onClick={() => setShowGarageModal(false)}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowGarageModal(false);
                }}
                className="min-h-[34px] px-3 py-1 bg-[#dc2626] hover:bg-[#b91c1c] active:bg-[#ef4444] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-xs uppercase transition cursor-pointer flex items-center gap-1 shrink-0 touch-manipulation"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Mobile 1-Tap Section Filter Tabs (Hidden on Laptop) */}
            {isMobilePopup && (
              <div className="grid grid-cols-4 gap-1 bg-[#141414] p-1 rounded-[2px] border border-[#444444]">
                {(
                  [
                    { id: 'ALL', label: 'ALL' },
                    { id: 'RIGS', label: `RIGS (${PRESET_NAMES.length})` },
                    { id: 'SAVED', label: `SAVED (${savedBlueprints.length})` },
                    { id: 'JSON', label: 'SAVE/.JSON' },
                  ] as const
                ).map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setGarageMobSection(sec.id)}
                    className={`py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer ${
                      garageMobSection === sec.id
                        ? 'bg-[#facc15] text-[#1a1a1a]'
                        : 'bg-[#222222] text-[#a3a3a3]'
                    }`}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
            )}

            {/* 1. Built-in Starter Blueprints */}
            {(!isMobilePopup || garageMobSection === 'ALL' || garageMobSection === 'RIGS') && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
                  <span className="text-xs font-display font-bold uppercase text-[#facc15] tracking-wide flex items-center gap-1.5">
                    1. CHOOSE VEHICLE ({PRESET_NAMES.length} RIGS)
                  </span>
                  <div className="flex items-center gap-1 bg-[#141414] p-0.5 rounded-[2px] border-2 border-[#444444]">
                    <button
                      type="button"
                      onClick={() => setGarageSpawnMode('replace')}
                      className={`px-2 py-0.5 text-[10px] font-display font-bold uppercase rounded-[2px] cursor-pointer transition ${
                        garageSpawnMode === 'replace'
                          ? 'bg-[#facc15] text-[#1a1a1a]'
                          : 'text-[#a3a3a3] hover:text-[#e5e5e5]'
                      }`}
                    >
                      REPLACE
                    </button>
                    <button
                      type="button"
                      onClick={() => setGarageSpawnMode('spawn_new')}
                      className={`px-2 py-0.5 text-[10px] font-display font-bold uppercase rounded-[2px] cursor-pointer transition ${
                        garageSpawnMode === 'spawn_new'
                          ? 'bg-[#facc15] text-[#1a1a1a]'
                          : 'text-[#a3a3a3] hover:text-[#e5e5e5]'
                      }`}
                    >
                      + SPAWN NEW
                    </button>
                  </div>
                </div>
                <div
                  className={`grid gap-1.5 ${
                    isMobilePopup
                      ? 'grid-cols-2 min-[460px]:grid-cols-3'
                      : 'grid-cols-3 gap-2'
                  }`}
                >
                  {PRESET_NAMES.map((name, idx) => {
                    const isActivePreset = hud.presetIndex === idx;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          if (garageSpawnMode === 'spawn_new') {
                            sim?.spawnNewCreation(idx);
                          } else {
                            sim?.selectPreset(idx);
                          }
                          setShowGarageModal(false);
                        }}
                        className={`px-2.5 py-2 border-2 rounded-[2px] text-left text-[11px] font-display font-bold uppercase cursor-pointer flex items-center justify-between transition group touch-manipulation ${
                          isActivePreset
                            ? 'bg-[#2a2a2a] border-[#facc15] text-[#facc15]'
                            : 'bg-[#222222] hover:bg-[#2a2a2a] border-[#444444] hover:border-[#facc15] text-[#e5e5e5]'
                        }`}
                      >
                        <span className="truncate group-hover:text-[#facc15] transition-colors">
                          {name}
                        </span>
                        {garageSpawnMode === 'spawn_new' ? (
                          <span className="text-[9.5px] bg-[#fbbf24] text-[#1a1a1a] px-1.5 py-0.5 rounded-[2px] font-mono-num ml-1 shrink-0">
                            +NEW
                          </span>
                        ) : isActivePreset ? (
                          <span className="text-[9px] bg-[#facc15] text-[#1a1a1a] px-1 py-0.2 rounded-[2px] font-mono-num ml-1 shrink-0">
                            ACTIVE
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. Saved Custom Blueprints List */}
            {(!isMobilePopup || garageMobSection === 'ALL' || garageMobSection === 'SAVED') && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-display font-bold uppercase text-[#e5e5e5] tracking-wide flex items-center gap-1.5">
                    2. YOUR SAVED VEHICLES ({savedBlueprints.length})
                  </span>
                  {savedBlueprints.length > 0 && !isMobilePopup && (
                    <span className="text-[10px] font-mono-num text-[#a3a3a3]">
                      Tap &quot;LOAD&quot; to replace or &quot;+ SPAWN&quot; to add to world
                    </span>
                  )}
                </div>

                {savedBlueprints.length === 0 ? (
                  <div className="text-xs text-[#a3a3a3] bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 text-center font-mono-num">
                    No custom blueprints saved yet — use &ldquo;SAVE BLUEPRINT&rdquo; below!
                  </div>
                ) : (
                  <div
                    className={`grid gap-2 overflow-y-auto pr-1 ${
                      isMobilePopup
                        ? 'grid-cols-1 min-[460px]:grid-cols-2 max-h-[160px]'
                        : 'grid-cols-2 max-h-[260px]'
                    }`}
                  >
                    {savedBlueprints.map((bp) => (
                      <div
                        key={bp.id}
                        className="bg-[#222222] border-2 border-[#444444] hover:border-[#facc15] rounded-[2px] p-2.5 flex flex-col justify-between gap-2 transition-all duration-200 group"
                      >
                        {/* Top Header Row */}
                        <div className="flex items-center justify-between gap-2">
                          <h3
                            className="text-xs font-display font-bold text-[#e5e5e5] uppercase group-hover:text-[#facc15] transition-colors truncate"
                            title={bp.name}
                          >
                            {bp.name}
                          </h3>
                          <span className="text-[9.5px] font-mono-num text-[#a3a3a3] shrink-0 bg-[#141414] px-1.5 py-0.5 rounded-[2px] border border-[#444444]">
                            {bp.blockCount} BLK · {bp.massKg}KG
                          </span>
                        </div>

                        {/* Action Buttons Toolbar */}
                        <div className="flex items-center gap-1.5 pt-1 border-t border-[#444444]">
                          <button
                            type="button"
                            onClick={() => {
                              sim?.loadSavedVehicle(bp);
                              setShowGarageModal(false);
                            }}
                            className="flex-1 px-2 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-xs transition cursor-pointer flex items-center justify-center"
                            title="Load into active creation workspace"
                          >
                            LOAD
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              sim?.spawnNewCreation(undefined, bp);
                              setShowGarageModal(false);
                            }}
                            className="flex-1 px-2 py-1.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-xs transition cursor-pointer flex items-center justify-center"
                            title="Spawn as a new vehicle in the world"
                          >
                            + SPAWN
                          </button>
                          <button
                            type="button"
                            data-testid={`copy-saved-blueprint-json-${bp.id}`}
                            onClick={() => {
                              copyBlueprintJsonToClipboard(JSON.stringify(bp), bp.name);
                            }}
                            className="px-2 py-1.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-xs transition cursor-pointer flex items-center justify-center"
                            title="Copy this saved vehicle's .json string to clipboard"
                          >
                            COPY
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedBlueprint(bp.id)}
                            className="px-2 py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold uppercase rounded-[2px] text-xs transition cursor-pointer flex items-center justify-center"
                            title="Delete Blueprint"
                          >
                            DEL
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3. Save Current Vehicle & 4. Export / Import Blueprint JSON */}
            {(!isMobilePopup || garageMobSection === 'ALL' || garageMobSection === 'JSON') && (
              <>
                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-display font-bold uppercase text-[#facc15] flex items-center gap-1.5">
                      3. SAVE CURRENT VEHICLE:
                    </span>
                    <span className="text-[10px] font-mono-num text-[#e5e5e5] bg-[#141414] px-2 py-0.5 rounded-[2px] border border-[#444444]">
                      {hud.voxelCount + hud.moduleCount} BLK · {hud.massKg} KG
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <input
                      type="text"
                      value={blueprintNameInput}
                      onChange={(e) => setBlueprintNameInput(e.target.value)}
                      placeholder="Enter vehicle blueprint name..."
                      className="flex-1 min-w-[140px] bg-[#141414] border-2 border-[#444444] focus:border-[#facc15] rounded-[2px] px-2.5 py-1.5 text-xs text-[#e5e5e5] font-mono-num focus:outline-none transition"
                    />
                    <button
                      type="button"
                      data-testid="confirm-save-blueprint-btn"
                      onClick={() => {
                        const bp = sim?.saveCurrentVehicle(blueprintNameInput);
                        if (bp) {
                          setShareCodeText(JSON.stringify(bp));
                          setGarageFeedback(`Saved "${bp.name}" to Garage!`);
                        }
                      }}
                      className="px-3 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer whitespace-nowrap transition"
                    >
                      SAVE BLUEPRINT
                    </button>
                    <button
                      type="button"
                      data-testid="copy-current-vehicle-json-btn"
                      onClick={() => {
                        if (sim) {
                          const bp = sim.rig.exportBlueprint(blueprintNameInput);
                          copyBlueprintJsonToClipboard(
                            JSON.stringify(bp),
                            bp.name || 'Current Vehicle',
                          );
                        }
                      }}
                      className="px-2.5 py-1.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer whitespace-nowrap transition"
                      title="Generate and copy the current vehicle's .json string to clipboard"
                    >
                      COPY .JSON
                    </button>
                  </div>
                  {garageFeedback && (
                    <div className="mt-2 text-xs font-mono-num text-[#facc15] flex items-center gap-1.5 bg-[#141414] border-2 border-[#facc15] rounded-[2px] px-2.5 py-1">
                      {garageFeedback}
                    </div>
                  )}
                </div>

                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-display font-bold uppercase text-[#e5e5e5] tracking-wide">
                      4. EXPORT / IMPORT .JSON BLUEPRINT
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (sim) {
                            const bp = sim.rig.exportBlueprint(blueprintNameInput);
                            setShareCodeText(JSON.stringify(bp));
                            setGarageFeedback('Generated shareable .json string below.');
                          }
                        }}
                        className="text-[10.5px] font-display font-bold uppercase text-[#e5e5e5] hover:text-[#facc15] hover:underline cursor-pointer"
                      >
                        GENERATE .JSON
                      </button>
                      <button
                        type="button"
                        data-testid="copy-share-json-header-btn"
                        onClick={() => {
                          if (shareCodeText.trim()) {
                            copyBlueprintJsonToClipboard(shareCodeText.trim(), 'Blueprint');
                          } else if (sim) {
                            const bp = sim.rig.exportBlueprint(blueprintNameInput);
                            copyBlueprintJsonToClipboard(
                              JSON.stringify(bp),
                              bp.name || 'Current Vehicle',
                            );
                          }
                        }}
                        className="text-[10.5px] font-display font-bold uppercase text-[#facc15] hover:underline cursor-pointer"
                      >
                        COPY .JSON
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <input
                      type="text"
                      data-testid="blueprint-json-input"
                      value={shareCodeText}
                      onChange={(e) => setShareCodeText(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      placeholder="Paste or generate vehicle .json string here..."
                      className="flex-1 min-w-[140px] bg-[#141414] border-2 border-[#444444] focus:border-[#facc15] rounded-[2px] px-2.5 py-1.5 text-[11px] font-mono-num text-[#e5e5e5] focus:outline-none transition"
                    />
                    <button
                      type="button"
                      data-testid="copy-blueprint-json-btn"
                      onClick={() => {
                        if (shareCodeText.trim()) {
                          copyBlueprintJsonToClipboard(shareCodeText.trim(), 'Blueprint');
                        } else if (sim) {
                          const bp = sim.rig.exportBlueprint(blueprintNameInput);
                          copyBlueprintJsonToClipboard(
                            JSON.stringify(bp),
                            bp.name || 'Current Vehicle',
                          );
                        }
                      }}
                      className="px-2.5 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-xs font-display font-bold uppercase cursor-pointer whitespace-nowrap transition"
                    >
                      COPY .JSON
                    </button>
                    <button
                      type="button"
                      data-testid="import-blueprint-json-btn"
                      onClick={() => handleImportShareCode(false)}
                      className="px-2.5 py-1.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-xs font-display font-bold uppercase cursor-pointer whitespace-nowrap transition"
                    >
                      LOAD .JSON
                    </button>
                    <button
                      type="button"
                      data-testid="spawn-blueprint-json-btn"
                      onClick={() => handleImportShareCode(true)}
                      className="px-2.5 py-1.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-xs font-display font-bold uppercase cursor-pointer whitespace-nowrap transition"
                    >
                      + SPAWN .JSON
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <AiFleetModal
        isOpen={showAiFleetModal}
        isMobilePopup={isMobilePopup}
        sim={simRef.current}
        activeCreationIdx={activeCreationIdxState}
        isSeatedInRig={hud.isSeatedInRig}
        savedBlueprints={savedBlueprints}
        onClose={() => setShowAiFleetModal(false)}
        onSyncHud={() => setConfigRefreshTick((t) => t + 1)}
      />

      {/* =====================================================================
          3B. INTERNAL MOD STUDIO MODAL (Custom Blocks, Game Modes & .JSON Packs)
          ===================================================================== */}
      {showModStudioModal && (
        <div
          data-testid="mod-studio-modal"
          data-layout-mode={isMobilePopup ? 'mobile' : 'laptop'}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModStudioModal(false);
          }}
          className={`fixed inset-0 z-[110] bg-[#141414]/90 flex items-center justify-center pointer-events-auto touch-manipulation ${
            isMobilePopup ? 'p-1.5' : 'p-4'
          }`}
        >
          <div
            className={`bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[#e5e5e5] overflow-y-auto overscroll-contain touch-pan-y ${
              isMobilePopup
                ? 'w-[min(96vw,540px)] max-h-[calc(100dvh-16px)] p-2.5'
                : 'w-full max-w-3xl max-h-[90vh] p-5'
            }`}
          >
            <div
              className={`sticky top-0 z-20 bg-[#1a1a1a] flex items-center justify-between gap-2 border-b-2 border-[#444444] mb-2.5 ${
                isMobilePopup
                  ? '-mx-2.5 -mt-2.5 px-2.5 py-2'
                  : '-mx-5 -mt-5 px-5 py-3.5'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] px-2 py-0.5 rounded-[2px] uppercase shrink-0">
                  MOD STUDIO
                </span>
                <h2
                  className={`font-display font-bold text-[#e5e5e5] uppercase tracking-wide truncate ${
                    isMobilePopup ? 'text-xs' : 'text-base'
                  }`}
                >
                  {isMobilePopup
                    ? 'MODES, BLOCKS & .JSON'
                    : 'CUSTOM BLOCKS, GAME MODES & .JSON PACKS'}
                </h2>
              </div>
              <button
                type="button"
                data-testid="close-mod-studio-btn"
                onClick={() => setShowModStudioModal(false)}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowModStudioModal(false);
                }}
                className="min-h-[34px] px-3 py-1 bg-[#dc2626] hover:bg-[#b91c1c] active:bg-[#ef4444] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-xs uppercase cursor-pointer shrink-0 touch-manipulation"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Sub-Tabs */}
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {(
                [
                  { id: 'MODES', label: isMobilePopup ? 'GAME MODES' : 'GAME MODES & RULES' },
                  { id: 'BLOCKS', label: isMobilePopup ? 'MOD BLOCKS' : 'MOD BLOCKS & MODULES' },
                  { id: 'JSON', label: isMobilePopup ? 'MOD .JSON' : 'EXPORT / COPY .JSON MOD PACK' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`mod-tab-${tab.id}`}
                  onClick={() => {
                    SoundFX.snap();
                    setModStudioTab(tab.id);
                  }}
                  className={`px-2 py-1.5 rounded-[2px] text-[11px] font-display font-extrabold uppercase cursor-pointer border-2 transition ${
                    modStudioTab === tab.id
                      ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                      : 'bg-[#262626] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {modStudioFeedback && (
              <div className="mb-3 px-3 py-2 bg-[#141414] border-2 border-[#facc15] rounded-[2px] text-xs font-mono-num text-[#facc15]">
                {modStudioFeedback}
              </div>
            )}

            {/* TAB 1: GAME MODES & CUSTOM MODE CREATOR */}
            {modStudioTab === 'MODES' && (
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-display font-bold uppercase text-[#facc15] mb-2">
                    1. SELECT ACTIVE GAME MODE ({ModRegistry.gameModes.length} AVAILABLE)
                  </div>
                  <div
                    className={`grid gap-2 ${
                      isMobilePopup
                        ? 'grid-cols-1 min-[460px]:grid-cols-2'
                        : 'grid-cols-2 gap-2.5'
                    }`}
                  >
                    {ModRegistry.gameModes.map((mode) => {
                      const isActive = ModRegistry.activeGameModeId === mode.id;
                      return (
                        <div
                          key={mode.id}
                          className={`p-2.5 rounded-[2px] border-2 flex flex-col justify-between gap-2 transition ${
                            isActive
                              ? 'bg-[#2a2a2a] border-[#facc15]'
                              : 'bg-[#222222] border-[#444444]'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="text-xs font-display font-extrabold uppercase"
                                style={{ color: mode.badgeColor }}
                              >
                                {mode.name}
                              </span>
                              {isActive && (
                                <span className="px-1.5 py-0.5 bg-[#fbbf24] text-[#1a1a1a] font-mono-num font-extrabold text-[9px] rounded-[2px]">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                            {!isMobilePopup && (
                              <div className="text-[11px] text-[#a3a3a3] mt-1">
                                {mode.description}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1.5 mt-1 text-[10px] font-mono-num text-[#a3a3a3]">
                              <span>Grav:{mode.gravityMult}x</span>
                              <span>·</span>
                              <span>Eng:{mode.enginePowerMult}x</span>
                              <span>·</span>
                              <span>Jet:{mode.thrusterPowerMult}x</span>
                              {mode.enableCheckpointRace && (
                                <span className="text-[#facc15]">· 6 GATES</span>
                              )}
                              {mode.indestructibleVehicles && (
                                <span className="text-[#e5e5e5]">· GOD HULL</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[#444444]">
                            <button
                              type="button"
                              data-testid={`activate-gamemode-${mode.id}`}
                              onClick={() => {
                                SoundFX.snap();
                                activateGameModeAndSetupWorld(mode.id);
                                setModStudioFeedback(`Activated Game Mode: "${mode.name}"!`);
                              }}
                              className={`px-3 py-1 rounded-[2px] border-2 border-[#444444] text-xs font-display font-extrabold uppercase cursor-pointer ${
                                isActive
                                  ? 'bg-[#facc15] text-[#1a1a1a]'
                                  : 'bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a]'
                              }`}
                            >
                              {isActive ? 'ACTIVE MODE' : 'PLAY MODE'}
                            </button>
                            {!mode.isBuiltIn && (
                              <button
                                type="button"
                                onClick={() => {
                                  ModRegistry.deleteCustomGameMode(mode.id);
                                  setModRegistryTick((t) => t + 1);
                                }}
                                className="px-2 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-xs font-display font-bold uppercase cursor-pointer"
                              >
                                DEL
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Create Custom Game Mode Form */}
                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3">
                  <div className="text-xs font-display font-bold uppercase text-[#facc15] mb-2">
                    2. CREATE NEW INTERNAL GAME MODE
                  </div>
                  <div className="grid grid-cols-1 min-[460px]:grid-cols-2 gap-2 mb-2">
                    <input
                      type="text"
                      value={newModeName}
                      onChange={(e) => setNewModeName(e.target.value)}
                      placeholder="Game Mode Name..."
                      className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-xs font-mono-num text-[#e5e5e5]"
                    />
                    <input
                      type="text"
                      value={newModeDesc}
                      onChange={(e) => setNewModeDesc(e.target.value)}
                      placeholder="Short description..."
                      className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-xs font-mono-num text-[#e5e5e5]"
                    />
                  </div>
                  <div className="grid grid-cols-2 min-[480px]:grid-cols-4 gap-2 text-[11px] font-mono-num mb-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[#a3a3a3]">
                        Gravity: <strong className="text-[#facc15]">{newModeGravity}x</strong>
                      </span>
                      <input
                        type="range"
                        min={0.15}
                        max={2.5}
                        step={0.05}
                        value={newModeGravity}
                        onChange={(e) => setNewModeGravity(Number(e.target.value))}
                        className="accent-[#fbbf24] cursor-pointer"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[#a3a3a3]">
                        Engine: <strong className="text-[#facc15]">{newModeEngineMult}x</strong>
                      </span>
                      <input
                        type="range"
                        min={0.5}
                        max={4.0}
                        step={0.1}
                        value={newModeEngineMult}
                        onChange={(e) => setNewModeEngineMult(Number(e.target.value))}
                        className="accent-[#fbbf24] cursor-pointer"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[#a3a3a3]">
                        Jet Thrust: <strong className="text-[#facc15]">{newModeThrusterMult}x</strong>
                      </span>
                      <input
                        type="range"
                        min={0.5}
                        max={4.0}
                        step={0.1}
                        value={newModeThrusterMult}
                        onChange={(e) => setNewModeThrusterMult(Number(e.target.value))}
                        className="accent-[#fbbf24] cursor-pointer"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[#a3a3a3]">
                        Explosions: <strong className="text-[#dc2626]">{newModeExplosionMult}x</strong>
                      </span>
                      <input
                        type="range"
                        min={0.5}
                        max={3.5}
                        step={0.1}
                        value={newModeExplosionMult}
                        onChange={(e) => setNewModeExplosionMult(Number(e.target.value))}
                        className="accent-[#dc2626] cursor-pointer"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono-num">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newModeCheckpoints}
                          onChange={(e) => setNewModeCheckpoints(e.target.checked)}
                        />
                        <span>CHECKPOINT RINGS</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newModeDemolition}
                          onChange={(e) => setNewModeDemolition(e.target.checked)}
                        />
                        <span>DEMOLITION SCORE</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newModeIndestructible}
                          onChange={(e) => setNewModeIndestructible(e.target.checked)}
                        />
                        <span>INDESTRUCTIBLE</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      data-testid="create-custom-gamemode-btn"
                      onClick={() => {
                        SoundFX.snap();
                        const created = ModRegistry.addCustomGameMode({
                          name: newModeName.trim() || 'Custom Mode',
                          description: newModeDesc.trim() || 'Custom internal game mode',
                          badgeColor: '#fbbf24',
                          gravityMult: newModeGravity,
                          enginePowerMult: newModeEngineMult,
                          thrusterPowerMult: newModeThrusterMult,
                          explosionMult: newModeExplosionMult,
                          indestructibleVehicles: newModeIndestructible,
                          enableCheckpointRace: newModeCheckpoints,
                          enableDemolitionScore: newModeDemolition,
                        });
                        setModRegistryTick((t) => t + 1);
                        setModStudioFeedback(`Created & activated mode "${created.name}"!`);
                      }}
                      className="px-4 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer"
                    >
                      + SAVE &amp; ACTIVATE MODE
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: CUSTOM BLOCKS & MODULES */}
            {modStudioTab === 'BLOCKS' && (
              <div className="space-y-3">
                {/* Create Custom Block / Module Form */}
                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3">
                  <div className="text-xs font-display font-bold uppercase text-[#facc15] mb-2">
                    1. CREATE NEW INTERNAL BLOCK OR OVERCLOCKED MODULE
                  </div>
                  <div className="grid grid-cols-1 min-[460px]:grid-cols-3 gap-2 mb-2.5 text-xs font-mono-num">
                    <input
                      type="text"
                      value={newModBlockName}
                      onChange={(e) => setNewModBlockName(e.target.value)}
                      placeholder="Block / Module Name..."
                      className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-[#e5e5e5]"
                    />
                    <select
                      value={newModBlockType}
                      onChange={(e) =>
                        setNewModBlockType(e.target.value as 'voxel' | 'module')
                      }
                      className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-[#e5e5e5]"
                    >
                      <option value="voxel">Voxel Hull / Special Block</option>
                      <option value="module">Functional Vehicle Module</option>
                    </select>
                    <select
                      value={newModBlockCategory}
                      onChange={(e) =>
                        setNewModBlockCategory(
                          e.target.value as Exclude<BuildCategory, 'ALL'>,
                        )
                      }
                      className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-[#e5e5e5]"
                    >
                      <option value="CHASSIS">Category: Hull &amp; Chassis</option>
                      <option value="PROPULSION">Category: Propulsion &amp; Jets</option>
                      <option value="WHEELS">Category: Wheels &amp; Traction</option>
                      <option value="MECHANICAL">Category: Mechanical</option>
                      <option value="BUOYANCY">Category: Buoyancy &amp; Hover</option>
                      <option value="WEAPONS">Category: Weapons</option>
                    </select>
                  </div>

                  {newModBlockType === 'voxel' ? (
                    <div className="grid grid-cols-2 min-[480px]:grid-cols-4 gap-2 mb-2.5 text-[11px] font-mono-num">
                      <label className="flex flex-col gap-1">
                        <span className="text-[#a3a3a3]">Special Behavior</span>
                        <select
                          value={newModBlockBehavior}
                          onChange={(e) =>
                            setNewModBlockBehavior(
                              e.target.value as ModBlockBehavior,
                            )
                          }
                          className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2 py-1 text-[#e5e5e5]"
                        >
                          <option value="ANTI_GRAV_HOVER">Anti-Grav Hover Lift</option>
                          <option value="SUPER_BOUNCE">Hyper-Bounce Pad</option>
                          <option value="STANDARD_ARMOR">Heavy Titan Armor</option>
                          <option value="EXPLOSIVE_C4">Explosive Detonator</option>
                          <option value="EMISSIVE_GLOW">Radiant Neon Block</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[#a3a3a3]">
                          Mass: <strong className="text-[#e5e5e5]">{newModBlockMass}kg</strong>
                        </span>
                        <input
                          type="range"
                          min={1}
                          max={60}
                          value={newModBlockMass}
                          onChange={(e) => setNewModBlockMass(Number(e.target.value))}
                          className="accent-[#fbbf24]"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[#a3a3a3]">
                          {newModBlockBehavior === 'ANTI_GRAV_HOVER'
                            ? `Hover Lift: ${newModBlockHoverForce}N`
                            : newModBlockBehavior === 'SUPER_BOUNCE'
                              ? `Bounce: ${newModBlockBounce}x`
                              : `Armor HP: ${Math.round(newModBlockHp / 1000)}k`}
                        </span>
                        {newModBlockBehavior === 'ANTI_GRAV_HOVER' ? (
                          <input
                            type="range"
                            min={10}
                            max={90}
                            value={newModBlockHoverForce}
                            onChange={(e) =>
                              setNewModBlockHoverForce(Number(e.target.value))
                            }
                            className="accent-[#fbbf24]"
                          />
                        ) : newModBlockBehavior === 'SUPER_BOUNCE' ? (
                          <input
                            type="range"
                            min={1.2}
                            max={3.5}
                            step={0.1}
                            value={newModBlockBounce}
                            onChange={(e) =>
                              setNewModBlockBounce(Number(e.target.value))
                            }
                            className="accent-[#fbbf24]"
                          />
                        ) : (
                          <input
                            type="range"
                            min={2000}
                            max={150000}
                            step={2000}
                            value={newModBlockHp}
                            onChange={(e) => setNewModBlockHp(Number(e.target.value))}
                            className="accent-[#fbbf24]"
                          />
                        )}
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[#a3a3a3]">Block Color</span>
                        <input
                          type="color"
                          value={newModBlockColor}
                          onChange={(e) => setNewModBlockColor(e.target.value)}
                          className="w-full h-7 bg-[#141414] border-2 border-[#444444] rounded-[2px] cursor-pointer"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 min-[480px]:grid-cols-4 gap-2 mb-2.5 text-[11px] font-mono-num">
                      <label className="flex flex-col gap-1">
                        <span className="text-[#a3a3a3]">Base Hardware Kind</span>
                        <select
                          value={newModModuleKind}
                          onChange={(e) =>
                            setNewModModuleKind(e.target.value as ModuleKind)
                          }
                          className="bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2 py-1 text-[#e5e5e5]"
                        >
                          <option value="JET_RAW">Afterburner Jet</option>
                          <option value="THRUSTER_ROCKET">Rocket Booster</option>
                          <option value="ENGINE_DRAGON">Dragon V12 Engine</option>
                          <option value="WHEEL_MONSTER">Monster Truck Wheel</option>
                          <option value="WHEEL_DRAG">Dragster Slick Wheel</option>
                          <option value="PLASMA_CANNON">Tank Plasma Cannon</option>
                          <option value="WEAPON_MINIGUN">Rotary Mini-Gun</option>
                          <option value="VTOL_ROTOR">VTOL Helicopter Rotor</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[#a3a3a3]">
                          Power Multiplier: <strong className="text-[#facc15]">{newModModuleStrength}x</strong>
                        </span>
                        <input
                          type="range"
                          min={0.8}
                          max={4.0}
                          step={0.1}
                          value={newModModuleStrength}
                          onChange={(e) =>
                            setNewModModuleStrength(Number(e.target.value))
                          }
                          className="accent-[#fbbf24]"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[#a3a3a3]">
                          Mass: <strong className="text-[#e5e5e5]">{newModBlockMass}kg</strong>
                        </span>
                        <input
                          type="range"
                          min={5}
                          max={120}
                          value={newModBlockMass}
                          onChange={(e) => setNewModBlockMass(Number(e.target.value))}
                          className="accent-[#fbbf24]"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[#a3a3a3]">Accent Trim Color</span>
                        <input
                          type="color"
                          value={newModBlockColor}
                          onChange={(e) => setNewModBlockColor(e.target.value)}
                          className="w-full h-7 bg-[#141414] border-2 border-[#444444] rounded-[2px] cursor-pointer"
                        />
                      </label>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      data-testid="create-custom-mod-block-btn"
                      onClick={() => {
                        SoundFX.snap();
                        const created = ModRegistry.addCustomModBlock({
                          name: newModBlockName.trim() || 'Custom Mod Block',
                          type: newModBlockType,
                          category: newModBlockCategory,
                          colorHex: newModBlockColor,
                          massKg: newModBlockMass,
                          powerCores: newModBlockType === 'module' ? 2 : 0,
                          behavior: newModBlockBehavior,
                          durabilityHp: newModBlockHp,
                          hoverForce: newModBlockHoverForce,
                          bounceMultiplier: newModBlockBounce,
                          moduleKind:
                            newModBlockType === 'module'
                              ? newModModuleKind
                              : undefined,
                          strengthMult: newModModuleStrength,
                        });
                        setModRegistryTick((t) => t + 1);
                        setModStudioFeedback(
                          `Added "${created.name}" to the Build Mode Catalog!`,
                        );
                      }}
                      className="px-4 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer"
                    >
                      + REGISTER BLOCK IN BUILD CATALOG
                    </button>
                  </div>
                </div>

                {/* Registered Mod Blocks List */}
                <div>
                  <div className="text-xs font-display font-bold uppercase text-[#e5e5e5] mb-2">
                    2. REGISTERED INTERNAL MOD BLOCKS ({ModRegistry.blocks.length})
                  </div>
                  <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-2">
                    {ModRegistry.blocks.map((blk) => (
                      <div
                        key={blk.id}
                        className="flex items-center justify-between bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2"
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span
                            className="w-4 h-4 rounded-[2px] shrink-0 border border-[#e5e5e5]"
                            style={{ backgroundColor: blk.colorHex }}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-display font-bold text-[#e5e5e5] uppercase truncate">
                              {blk.name}
                            </div>
                            <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                              {blk.category} · {blk.type.toUpperCase()} · {blk.massKg}kg
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              SoundFX.snap();
                              ModRegistry.toggleModBlock(blk.id);
                              setModRegistryTick((t) => t + 1);
                            }}
                            className={`px-2 py-1 rounded-[2px] border-2 border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer ${
                              blk.enabled
                                ? 'bg-[#facc15] text-[#1a1a1a]'
                                : 'bg-[#262626] text-[#a3a3a3]'
                            }`}
                          >
                            {blk.enabled ? 'ENABLED' : 'DISABLED'}
                          </button>
                          {!blk.isBuiltIn && (
                            <button
                              type="button"
                              onClick={() => {
                                ModRegistry.deleteCustomModBlock(blk.id);
                                setModRegistryTick((t) => t + 1);
                              }}
                              className="px-2 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                            >
                              DEL
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: EXPORT / COPY / IMPORT .JSON MOD PACK */}
            {modStudioTab === 'JSON' && (
              <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-display font-bold uppercase text-[#facc15]">
                    SHAREABLE .JSON INTERNAL MOD PACK (BLOCKS + GAME MODES)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const json = ModRegistry.exportModPackJson(modPackNameInput);
                        setModPackJsonInput(json);
                        setModStudioFeedback('Generated Mod Pack .json string below.');
                      }}
                      className="text-xs font-display font-bold uppercase text-[#e5e5e5] hover:text-[#facc15] hover:underline cursor-pointer"
                    >
                      GENERATE MOD .JSON
                    </button>
                    <button
                      type="button"
                      data-testid="copy-modpack-json-btn"
                      onClick={() => {
                        const json =
                          modPackJsonInput.trim() ||
                          ModRegistry.exportModPackJson(modPackNameInput);
                        setModPackJsonInput(json);
                        copyBlueprintJsonToClipboard(json, modPackNameInput);
                        setModStudioFeedback(
                          `Copied "${modPackNameInput}" .json string to clipboard!`,
                        );
                      }}
                      className="px-3 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-xs font-display font-bold uppercase cursor-pointer"
                    >
                      COPY MOD .JSON
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={modPackNameInput}
                    onChange={(e) => setModPackNameInput(e.target.value)}
                    placeholder="Mod Pack Name..."
                    className="w-full min-[480px]:w-48 bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-xs font-mono-num text-[#e5e5e5]"
                  />
                  <input
                    type="text"
                    data-testid="modpack-json-input"
                    value={modPackJsonInput}
                    onChange={(e) => setModPackJsonInput(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="Paste or generate Mod Pack .json string here..."
                    className="flex-1 min-w-[160px] bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-xs font-mono-num text-[#e5e5e5]"
                  />
                  <button
                    type="button"
                    data-testid="import-modpack-json-btn"
                    onClick={() => {
                      const res = ModRegistry.importModPackJson(modPackJsonInput);
                      setModRegistryTick((t) => t + 1);
                      setModStudioFeedback(res.message);
                      if (res.ok) SoundFX.snap();
                    }}
                    className="px-3.5 py-1.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-xs font-display font-bold uppercase cursor-pointer whitespace-nowrap"
                  >
                    IMPORT MOD .JSON
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          4. INDUSTRIAL UNLIMITED WORLD, BIOMES & HEIGHTMAP MODAL
          ===================================================================== */}
      {showWorldGenModal && (
        <div
          data-testid="world-gen-modal"
          data-layout-mode={isMobilePopup ? 'mobile' : 'laptop'}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowWorldGenModal(false);
          }}
          className={`fixed inset-0 z-[110] bg-[#141414]/90 flex items-center justify-center pointer-events-auto touch-manipulation ${
            isMobilePopup ? 'p-1.5' : 'p-4'
          }`}
        >
          <div
            className={`bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[#e5e5e5] overflow-y-auto overscroll-contain touch-pan-y ${
              isMobilePopup
                ? 'w-[min(96vw,540px)] max-h-[calc(100dvh-16px)] p-2.5'
                : 'w-full max-w-2xl max-h-[90vh] p-5'
            }`}
          >
            <div
              className={`sticky top-0 z-20 bg-[#1a1a1a] flex items-center justify-between gap-2 border-b-2 border-[#444444] mb-2.5 ${
                isMobilePopup
                  ? '-mx-2.5 -mt-2.5 px-2.5 py-2'
                  : '-mx-5 -mt-5 px-5 py-3.5'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] px-2 py-0.5 rounded-[2px] uppercase shrink-0">
                  WORLD STUDIO
                </span>
                <h2
                  className={`font-display font-bold text-[#e5e5e5] uppercase tracking-wide truncate ${
                    isMobilePopup ? 'text-xs' : 'text-base'
                  }`}
                >
                  {isMobilePopup ? 'BIOMES & SAVED WORLDS' : 'BIOMES, HEIGHTMAPS & SAVED WORLDS'}
                </h2>
              </div>
              <button
                type="button"
                data-testid="close-world-gen-modal-btn"
                onClick={() => setShowWorldGenModal(false)}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowWorldGenModal(false);
                }}
                className="min-h-[34px] px-3 py-1 bg-[#dc2626] hover:bg-[#b91c1c] active:bg-[#ef4444] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-xs uppercase cursor-pointer shrink-0 touch-manipulation"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Mobile 1-Tap Section Filter Bar */}
            {isMobilePopup && (
              <div className="grid grid-cols-4 gap-1 bg-[#141414] p-1 rounded-[2px] border border-[#444444] mb-2.5">
                {(
                  [
                    { id: 'ALL', label: 'ALL' },
                    { id: 'BIOMES', label: 'BIOMES' },
                    { id: 'HEIGHTMAP', label: 'HEIGHTMAP' },
                    { id: 'SAVELOAD', label: 'SAVE/LOAD' },
                  ] as const
                ).map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setWorldGenMobSection(sec.id)}
                    className={`py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer ${
                      worldGenMobSection === sec.id
                        ? 'bg-[#facc15] text-[#1a1a1a]'
                        : 'bg-[#222222] text-[#a3a3a3]'
                    }`}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
            )}

            {/* Section 1: Unlimited Biomes & Flat Baseplate */}
            {(!isMobilePopup ||
              worldGenMobSection === 'ALL' ||
              worldGenMobSection === 'BIOMES') && (
              <div className="mb-3">
                <div className="text-xs font-display font-bold uppercase text-[#facc15] mb-2">
                  1. SELECT UNLIMITED WORLD BIOME OR FLAT BASEPLATE
                </div>
                <div
                  className={`grid gap-2 ${
                    isMobilePopup
                      ? 'grid-cols-2 min-[480px]:grid-cols-3'
                      : 'grid-cols-2'
                  }`}
                >
                  {WORLD_GEN_BIOMES.map((b) => {
                    const active = hud.worldGenMode === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        data-testid={`biome-btn-${b.id}`}
                        onClick={() => {
                          sim?.regenerateUnlimitedWorld(b.id, MAT.CONCRETE, null);
                          setWorldGenFeedback(`Generated "${b.name}"!`);
                          setShowWorldGenModal(false);
                        }}
                        className={`p-2.5 rounded-[2px] border-2 text-left transition cursor-pointer ${
                          active
                            ? 'bg-[#2a2a2a] border-[#facc15]'
                            : 'bg-[#222222] border-[#444444] hover:border-[#fbbf24]'
                        }`}
                      >
                        <div
                          className="text-xs font-display font-bold uppercase truncate"
                          style={{ color: b.badgeColor }}
                        >
                          {b.name}
                        </div>
                        {!isMobilePopup && (
                          <div className="text-[11px] text-[#a3a3a3] mt-0.5">
                            {b.desc}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Flat Baseplate Material Quick Selector */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2">
                  <span className="text-[10.5px] font-mono-num text-[#a3a3a3]">
                    Flat Baseplate:
                  </span>
                  {[
                    { mat: MAT.CONCRETE, label: 'CONCRETE GRID' },
                    { mat: MAT.GRASS, label: 'GREEN GRASS' },
                    { mat: MAT.ASPHALT, label: 'TARMAC ASPHALT' },
                    { mat: MAT.SAND, label: 'DESERT SAND' },
                  ].map((opt) => (
                    <button
                      key={opt.mat}
                      type="button"
                      data-testid={`flat-baseplate-${opt.mat}`}
                      onClick={() => {
                        sim?.regenerateUnlimitedWorld(
                          'FLAT_BASEPLATE',
                          opt.mat,
                          null,
                        );
                        setShowWorldGenModal(false);
                      }}
                      className="px-2 py-1 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10.5px] font-display font-bold uppercase cursor-pointer"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Section 2: 2D Heightmap Importer & Procedural Heightmaps */}
            {(!isMobilePopup ||
              worldGenMobSection === 'ALL' ||
              worldGenMobSection === 'HEIGHTMAP') && (
              <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3 mb-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <div>
                    <div className="text-xs font-display font-bold uppercase text-[#facc15]">
                      2. IMPORT 2D HEIGHTMAP OR PROCEDURAL HEIGHTMAP
                    </div>
                    {!isMobilePopup && (
                      <div className="text-[11px] text-[#a3a3a3]">
                        Bright pixels = high peaks · Dark pixels = valleys &amp;
                        water basins
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono-num text-[#e5e5e5]">
                      Scale: {heightmapScaleY}v
                    </span>
                    <input
                      type="range"
                      min={12}
                      max={40}
                      value={heightmapScaleY}
                      onChange={(e) => setHeightmapScaleY(Number(e.target.value))}
                      className="w-24 accent-[#fbbf24] cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  <label className="px-3 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer whitespace-nowrap">
                    UPLOAD HEIGHTMAP (PNG/JPG)
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleHeightmapImageUpload}
                      className="hidden"
                    />
                  </label>
                  <span className="text-[11px] font-mono-num text-[#a3a3a3]">
                    Built-in presets:
                  </span>
                </div>

                <div className="grid grid-cols-2 min-[480px]:grid-cols-4 gap-1.5">
                  {(
                    [
                      { id: 'CRATER_BASIN', label: 'CRATER BASIN' },
                      { id: 'TWIN_PEAKS', label: 'TWIN PEAKS' },
                      { id: 'SPIRAL_CANYON', label: 'SPIRAL CANYON' },
                      { id: 'ATOLL_RING', label: 'ATOLL RING' },
                    ] as const
                  ).map((hm) => (
                    <button
                      key={hm.id}
                      type="button"
                      data-testid={`heightmap-preset-${hm.id}`}
                      onClick={() => handleProceduralHeightmap(hm.id)}
                      className="px-2.5 py-1.5 bg-[#141414] hover:bg-[#262626] border-2 border-[#444444] hover:border-[#facc15] text-[#e5e5e5] rounded-[2px] text-[11px] font-display font-bold uppercase cursor-pointer"
                    >
                      {hm.label}
                    </button>
                  ))}
                </div>
                {worldGenFeedback && (
                  <div className="mt-2 text-xs font-mono-num text-[#facc15]">
                    {worldGenFeedback}
                  </div>
                )}
              </div>
            )}

            {/* Section 3: Custom World Save / Load / Export / Import */}
            {(!isMobilePopup ||
              worldGenMobSection === 'ALL' ||
              worldGenMobSection === 'SAVELOAD') && (
              <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3 mb-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="text-xs font-display font-bold uppercase text-[#facc15]">
                      3. SAVE &amp; LOAD CUSTOM WORLDS
                    </div>
                    {!isMobilePopup && (
                      <div className="text-[11px] text-[#a3a3a3]">
                        Saves all RLE-compressed modified terrain chunks, dynamic props, and placed shredder hazards
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                  <input
                    type="text"
                    data-testid="custom-world-name-input"
                    value={customWorldNameInput}
                    onChange={(e) => setCustomWorldNameInput(e.target.value)}
                    placeholder="Enter custom world name..."
                    className="flex-1 min-w-[150px] bg-[#141414] border-2 border-[#444444] focus:border-[#fbbf24] rounded-[2px] px-2.5 py-1.5 text-xs font-mono-num text-[#e5e5e5] outline-none"
                  />
                  <button
                    type="button"
                    data-testid="save-custom-world-btn"
                    onClick={() => {
                      if (!simRef.current) return;
                      const saved = simRef.current.saveCustomWorldSnapshot(
                        customWorldNameInput,
                      );
                      const jsonStr = exportWorldSaveJson(saved);
                      setCustomWorldShareJson(jsonStr);
                      setWorldGenFeedback(
                        `Saved custom world "${saved.name}" (${saved.modifiedChunks.length} modified chunks, ${saved.placedEntities.length} props, ${saved.placedHazards.length} hazards)!`,
                      );
                    }}
                    className="px-3 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer whitespace-nowrap"
                  >
                    SAVE CURRENT WORLD
                  </button>
                </div>

                {savedCustomWorlds.length > 0 && (
                  <div className="mb-2.5 max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {savedCustomWorlds.map((sw) => (
                      <div
                        key={sw.id}
                        data-testid={`saved-custom-world-${sw.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 bg-[#141414] border border-[#3b3b3b] px-2.5 py-1.5 rounded-[2px]"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-display font-bold text-[#e5e5e5] truncate">
                            {sw.name}
                          </div>
                          <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                            {sw.worldGenMode} · {sw.modifiedChunks.length} Chunks ·{' '}
                            {sw.placedEntities?.length ?? 0} Props ·{' '}
                            {sw.placedHazards?.length ?? 0} Hazards
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`load-custom-world-${sw.id}`}
                            onClick={() => {
                              simRef.current?.loadCustomWorldSnapshot(sw);
                              setWorldGenFeedback(`Loaded "${sw.name}"!`);
                              setShowWorldGenModal(false);
                            }}
                            className="px-2.5 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer"
                          >
                            LOAD
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const j = exportWorldSaveJson(sw);
                              setCustomWorldShareJson(j);
                              if (navigator.clipboard?.writeText) {
                                navigator.clipboard.writeText(j).catch(() => {});
                              }
                              setWorldGenFeedback(
                                `Exported JSON for "${sw.name}" below!`,
                              );
                            }}
                            className="px-2 py-1 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                          >
                            JSON
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = deleteSavedWorldFromStorage(sw.id);
                              setSavedCustomWorlds(next);
                            }}
                            className="px-2 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                          >
                            DEL
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    data-testid="custom-world-json-input"
                    value={customWorldShareJson}
                    onChange={(e) => setCustomWorldShareJson(e.target.value)}
                    placeholder="Paste exported Custom World .json here to import..."
                    className="flex-1 min-w-[150px] bg-[#141414] border border-[#444444] rounded-[2px] px-2.5 py-1 text-[11px] font-mono-num text-[#e5e5e5] outline-none"
                  />
                  <button
                    type="button"
                    data-testid="import-custom-world-json-btn"
                    onClick={() => {
                      const parsed = parseWorldSaveJson(customWorldShareJson);
                      if (!parsed) {
                        setWorldGenFeedback('Invalid Custom World JSON format.');
                        return;
                      }
                      const next = saveWorldToStorage(parsed);
                      setSavedCustomWorlds(next);
                      simRef.current?.loadCustomWorldSnapshot(parsed);
                      setWorldGenFeedback(
                        `Imported & loaded "${parsed.name}"!`,
                      );
                      setShowWorldGenModal(false);
                    }}
                    className="px-3 py-1 bg-[#6b7280] hover:bg-[#fbbf24] text-[#e5e5e5] hover:text-[#1a1a1a] border border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer"
                  >
                    IMPORT &amp; LOAD JSON
                  </button>
                </div>
              </div>
            )}

            {/* Section 4: Quick Launch into World Editor or Object Studio */}
            <div className="grid grid-cols-1 min-[460px]:grid-cols-3 gap-1.5 pt-2 border-t-2 border-[#444444]">
              <button
                type="button"
                onClick={() => {
                  setShowWorldGenModal(false);
                  simRef.current?.toggleObjectStudioMode(true);
                }}
                className="px-2.5 py-2 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-extrabold text-[11px] uppercase rounded-[2px] cursor-pointer text-center"
              >
                {isMobilePopup ? 'OBJECT STUDIO' : 'OPEN PLACEABLE OBJECT STUDIO [J]'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowWorldGenModal(false);
                  setShowChooseMapModal(true);
                }}
                className="px-2.5 py-2 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-[11px] uppercase rounded-[2px] cursor-pointer text-center"
              >
                CHOOSE MAP / .GLB WORLD
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowWorldGenModal(false);
                  simRef.current?.toggleWorldEditMode(true);
                }}
                className="px-2.5 py-2 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border-2 border-[#444444] font-display font-extrabold text-[11px] uppercase rounded-[2px] cursor-pointer text-center"
              >
                {isMobilePopup ? 'WORLD TERRAFORM' : 'OPEN WORLD TERRAFORM & PLACER [K]'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          4B. CHOOSE MAP / .GLB WORLD SELECTOR MODAL (Default Map, Saved GLB Maps, Add New GLB)
          ===================================================================== */}
      {showChooseMapModal && (
        <div
          data-testid="choose-map-modal"
          data-layout-mode={isMobilePopup ? 'mobile' : 'laptop'}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowChooseMapModal(false);
          }}
          className={`fixed inset-0 z-[110] bg-black/90 flex items-center justify-center pointer-events-auto touch-manipulation ${
            isMobilePopup ? 'p-1.5' : 'p-4'
          }`}
        >
          <div
            className={`bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[#e5e5e5] overflow-y-auto overscroll-contain touch-pan-y ${
              isMobilePopup
                ? 'w-[min(96vw,540px)] max-h-[calc(100dvh-16px)] p-2.5'
                : 'w-full max-w-2xl max-h-[90vh] p-5'
            }`}
          >
            <div
              className={`sticky top-0 z-20 bg-[#1a1a1a] flex items-center justify-between gap-2 border-b-2 border-[#444444] mb-2.5 ${
                isMobilePopup
                  ? '-mx-2.5 -mt-2.5 px-2.5 py-2'
                  : '-mx-5 -mt-5 px-5 py-3.5'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="bg-[#fbbf24] text-[#1a1a1a] border border-[#444444] rounded-[2px] font-display font-extrabold text-[10px] px-2 py-0.5 uppercase tracking-wider shrink-0">
                  MAP SELECTOR
                </span>
                <h2
                  className={`font-display font-bold text-[#e5e5e5] uppercase tracking-wider truncate ${
                    isMobilePopup ? 'text-xs' : 'text-base'
                  }`}
                >
                  {isMobilePopup ? 'CHOOSE MAP OR .GLB' : 'CHOOSE WORLD MAP OR IMPORT 3D .GLB'}
                </h2>
              </div>
              <button
                type="button"
                data-testid="close-choose-map-modal-btn"
                onClick={() => setShowChooseMapModal(false)}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowChooseMapModal(false);
                }}
                className="min-h-[34px] px-3 py-1 bg-[#dc2626] hover:bg-red-700 active:bg-red-500 text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-xs uppercase cursor-pointer shrink-0 touch-manipulation"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Mobile 1-Tap Section Filter Bar */}
            {isMobilePopup && (
              <div className="grid grid-cols-3 gap-1 bg-[#141414] p-1 rounded-[2px] border border-[#444444] mb-2.5">
                {(
                  [
                    { id: 'ALL', label: 'ALL' },
                    { id: 'MAPS', label: `MAPS (${savedGlbMaps.length + 1})` },
                    { id: 'IMPORT', label: '+ IMPORT .GLB' },
                  ] as const
                ).map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setChooseMapMobSection(sec.id)}
                    className={`py-1 rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer ${
                      chooseMapMobSection === sec.id
                        ? 'bg-[#facc15] text-[#1a1a1a]'
                        : 'bg-[#222222] text-[#a3a3a3]'
                    }`}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
            )}

            {/* Live GPU Voxelization Percentage Progress Bar inside Choose Map UI */}
            {isVoxelizingGlb && (
              <div
                data-testid="choose-map-progress-container"
                className="mb-3 bg-[#222222] border-2 border-[#fbbf24] rounded-[2px] p-3"
              >
                <div className="flex items-center justify-between text-xs font-mono-num mb-1.5">
                  <span className="text-[#fbbf24] font-bold truncate pr-2">
                    {glbProgress.stage || 'Offscreen WebGL GPU Rasterization...'}
                  </span>
                  <span className="text-[#facc15] font-extrabold shrink-0">
                    {glbProgress.pct}% DONE · {Math.max(0, 100 - glbProgress.pct)}% LEFT
                  </span>
                </div>
                <div className="w-full h-3 bg-[#1a1a1a] rounded-[2px] overflow-hidden border-2 border-[#444444]">
                  <div
                    data-testid="choose-map-progress-bar"
                    className="h-full bg-[#fbbf24] transition-all duration-150"
                    style={{ width: `${Math.max(4, Math.min(100, glbProgress.pct))}%` }}
                  />
                </div>
              </div>
            )}

            {worldGenFeedback && !isVoxelizingGlb && (
              <div className="mb-3 px-3 py-2 bg-[#222222] border-2 border-[#444444] rounded-[2px] text-xs font-mono-num text-[#fbbf24]">
                {worldGenFeedback}
              </div>
            )}

            {/* Option 1 & 2: Default Map & Saved GLB Maps */}
            {(!isMobilePopup ||
              chooseMapMobSection === 'ALL' ||
              chooseMapMobSection === 'MAPS') && (
              <>
                <div className="mb-3">
                  <div className="text-xs font-mono-num font-bold text-[#fbbf24] mb-1.5 uppercase tracking-wider">
                    1. DEFAULT WORLD MAP
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[#222222] border-2 border-[#444444] hover:border-[#fbbf24] rounded-[2px] p-3 transition">
                    <div>
                      <div className="text-xs sm:text-sm font-display font-bold text-[#e5e5e5] uppercase">
                        Default Stunt Park &amp; Endless West Ocean
                      </div>
                      {!isMobilePopup && (
                        <div className="text-xs text-[#a3a3a3] mt-0.5">
                          Asphalt highways, stunt ramps, destructible watchtowers, subterranean caves, and open ocean
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      data-testid="choose-default-map-btn"
                      onClick={() => handleSelectDefaultMap(true)}
                      className="px-3.5 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer whitespace-nowrap"
                    >
                      PLAY DEFAULT MAP
                    </button>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="text-xs font-mono-num font-bold text-[#fbbf24] mb-1.5 uppercase tracking-wider">
                    2. SAVED .GLB / .GLTF MAPS ({savedGlbMaps.length})
                  </div>
                  {savedGlbMaps.length === 0 ? (
                    <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 text-xs text-[#a3a3a3] font-mono-num">
                      No imported .GLB maps yet — use section 3 below to import a 3D model!
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 max-h-44 overflow-y-auto pr-1">
                      {savedGlbMaps.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between gap-2.5 bg-[#222222] border-2 border-[#444444] hover:border-[#fbbf24] rounded-[2px] px-3 py-2 text-xs font-mono-num transition"
                        >
                          <div className="truncate">
                            <div className="text-[#e5e5e5] font-bold text-xs truncate">
                              {m.name}
                            </div>
                            <div className="text-[10.5px] text-[#a3a3a3] truncate">
                              {m.sizeX * (m.scaleFactor ?? 10)}×{m.sizeZ * (m.scaleFactor ?? 10)}v ·{' '}
                              {Math.round(m.sizeX * (m.scaleFactor ?? 10) * VOXEL_SIZE)}m ({m.scaleFactor ?? 10}x)
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleLoadSavedGlbMap(m, true)}
                              className="px-3 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold rounded-[2px] text-xs uppercase cursor-pointer whitespace-nowrap"
                            >
                              ENTER WORLD
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSavedGlbMap(m.id)}
                              className="px-2 py-1 bg-[#dc2626] hover:bg-red-700 text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-bold text-xs uppercase cursor-pointer"
                            >
                              DEL
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Option 3: Scale, Resolution & Upload New GLB */}
            {(!isMobilePopup ||
              chooseMapMobSection === 'ALL' ||
              chooseMapMobSection === 'IMPORT') && (
              <>
                <div className="mb-3 bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono-num font-bold text-[#fbbf24] tracking-wider uppercase">
                        WORLD SCALE FACTOR:
                      </span>
                      <span
                        data-testid="glb-scale-badge"
                        className="px-2 py-0.5 bg-[#1a1a1a] text-[#fbbf24] border-2 border-[#444444] font-mono-num font-extrabold text-xs rounded-[2px]"
                      >
                        {glbScaleFactor}x
                      </span>
                    </div>
                    <div className="text-[11px] font-mono-num text-[#e5e5e5]">
                      Width: ~<span className="text-[#fbbf24] font-bold">{Math.round(glbTargetResolution * glbScaleFactor * VOXEL_SIZE)}m</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 mb-2">
                    <span className="text-[10px] font-mono-num text-[#a3a3a3] shrink-0">1x</span>
                    <input
                      data-testid="glb-scale-slider"
                      type="range"
                      min={1}
                      max={100}
                      step={1}
                      value={glbScaleFactor}
                      onChange={(e) => setGlbScaleFactor(Number(e.target.value))}
                      className="flex-1 accent-[#fbbf24] h-2 bg-[#1a1a1a] rounded-[2px] cursor-pointer"
                    />
                    <span className="text-[10px] font-mono-num text-[#a3a3a3] shrink-0">100x</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-mono-num text-[#a3a3a3] mr-1 uppercase">PRESETS:</span>
                    {[1, 5, 10, 20, 50, 100].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        data-testid={`scale-preset-${preset}x`}
                        onClick={() => setGlbScaleFactor(preset)}
                        className={`px-2 py-0.5 text-[11px] font-mono-num font-extrabold rounded-[2px] border-2 cursor-pointer transition ${
                          glbScaleFactor === preset
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {preset}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-3 bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono-num font-bold text-[#fbbf24] tracking-wider uppercase">
                        GPU VOXEL RESOLUTION:
                      </span>
                      <span
                        data-testid="glb-res-badge"
                        className="px-2 py-0.5 bg-[#1a1a1a] text-[#fbbf24] border-2 border-[#444444] font-mono-num font-extrabold text-xs rounded-[2px]"
                      >
                        {glbTargetResolution}v
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { res: 128, label: '128V HIGH' },
                      { res: 192, label: '192V ULTRA' },
                      { res: 256, label: '256V EXTREME GPU (DEFAULT)' },
                    ].map((opt) => (
                      <button
                        key={opt.res}
                        type="button"
                        data-testid={`res-preset-${opt.res}v`}
                        onClick={() => setGlbTargetResolution(opt.res)}
                        className={`px-2.5 py-1 text-[11px] font-mono-num font-extrabold rounded-[2px] border-2 cursor-pointer transition ${
                          glbTargetResolution === opt.res
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div>
                      <div className="text-xs font-mono-num font-bold text-[#fbbf24] mb-0.5 uppercase">
                        3. + ADD NEW .GLB / .GLTF WORLD MAP
                      </div>
                      {!isMobilePopup && (
                        <div className="text-xs text-[#a3a3a3]">
                          Dual-Pass GPU Render-Target Voxelizer with 1:1 unlit diffuse RGB capture and 16-bit elevation at {glbTargetResolution}v resolution and {glbScaleFactor}x scale.
                        </div>
                      )}
                    </div>
                    <label
                      data-testid="choose-map-upload-glb-label"
                      className={`px-3.5 py-2 border-2 border-[#444444] rounded-[2px] ${
                        isVoxelizingGlb
                          ? 'bg-[#6b7280] text-[#e5e5e5]'
                          : 'bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a]'
                      } font-display font-extrabold text-xs uppercase cursor-pointer whitespace-nowrap shrink-0`}
                    >
                      {isVoxelizingGlb
                        ? `GPU VOXELIZING (${glbProgress.pct}%)...`
                        : `+ ADD NEW .GLB / .GLTF WORLD (${glbTargetResolution}V)`}
                      <input
                        data-testid="choose-map-upload-glb-input"
                        type="file"
                        accept=".glb,.gltf"
                        disabled={isVoxelizingGlb}
                        onChange={(e) => handleGlbModelUpload(e, true)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          5. TRAILMAKERS PAUSE & SETTINGS MODAL
          ===================================================================== */}
      {gameState === 'paused' && !showHudEditorModal && (
        <div
          data-testid="pause-modal-backdrop"
          data-layout-mode={isMobilePopup ? 'mobile' : 'laptop'}
          onClick={(e) => {
            if (e.target === e.currentTarget) sim?.resumeGame();
          }}
          className={`fixed inset-0 z-[110] bg-black/90 flex items-center justify-center pointer-events-auto touch-manipulation ${
            isMobilePopup ? 'p-1.5' : 'p-4'
          }`}
        >
          <div
            className={`bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[#e5e5e5] overflow-y-auto overscroll-contain touch-pan-y ${
              isMobilePopup
                ? 'w-[min(96vw,540px)] max-h-[calc(100dvh-16px)] p-2.5'
                : 'w-full max-w-2xl max-h-[90vh] p-5'
            }`}
          >
            {/* Sticky Header */}
            <div
              className={`sticky top-0 z-20 bg-[#1a1a1a] flex items-center justify-between gap-2 border-b-2 border-[#444444] mb-2.5 ${
                isMobilePopup
                  ? '-mx-2.5 -mt-2.5 px-2.5 py-2'
                  : '-mx-5 -mt-5 px-5 py-3.5'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="bg-[#fbbf24] text-[#1a1a1a] border border-[#444444] rounded-[2px] font-display font-extrabold text-[10px] px-2 py-0.5 uppercase tracking-wider shrink-0">
                  PAUSED
                </span>
                <h2
                  className={`font-display font-bold text-[#e5e5e5] uppercase tracking-wider truncate ${
                    isMobilePopup ? 'text-xs' : 'text-base'
                  }`}
                >
                  {isMobilePopup ? 'SETTINGS & GRAPHICS' : 'SANDBOX & GRAPHICS SUITE'}
                </h2>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  data-testid="open-hud-editor-btn"
                  onClick={() => setShowHudEditorModal(true)}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowHudEditorModal(true);
                  }}
                  className="min-h-[34px] px-2.5 py-1 bg-[#38bdf8] hover:bg-[#0ea5e9] active:bg-[#7dd3fc] text-[#090d16] border-2 border-[#090d16] font-display font-extrabold text-[11px] uppercase rounded-[2px] cursor-pointer shrink-0 touch-manipulation flex items-center gap-1"
                >
                  <span>⊞ EDIT HUD</span>
                </button>
                <span className="text-[10.5px] font-mono-num text-[#fbbf24] bg-[#222222] px-2 py-0.5 rounded-[2px] border border-[#444444]">
                  <LiveHudField select={selectFpsOnly} />
                </span>
                <button
                  type="button"
                  data-testid="close-pause-modal-btn"
                  onClick={() => sim?.resumeGame()}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    sim?.resumeGame();
                  }}
                  className="min-h-[34px] px-3 py-1 bg-[#dc2626] hover:bg-red-700 active:bg-red-500 text-[#e5e5e5] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer shrink-0 touch-manipulation"
                >
                  ✕ RESUME
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-[#222222] rounded-[2px] border-2 border-[#444444] mb-3">
              <button
                type="button"
                data-testid="pause-tab-graphics"
                onClick={() => setPauseTab('graphics')}
                className={`py-1.5 text-[10.5px] font-display font-bold uppercase tracking-wider rounded-[2px] border-2 transition cursor-pointer ${
                  pauseTab === 'graphics'
                    ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                    : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:bg-[#52525b]'
                }`}
              >
                {isMobilePopup ? 'GRAPHICS' : 'GRAPHICS (15 FX)'}
              </button>
              <button
                type="button"
                data-testid="pause-tab-settings"
                onClick={() => setPauseTab('settings')}
                className={`py-1.5 text-[10.5px] font-display font-bold uppercase tracking-wider rounded-[2px] border-2 transition cursor-pointer ${
                  pauseTab === 'settings'
                    ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                    : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:bg-[#52525b]'
                }`}
              >
                PERF &amp; SIM
              </button>
              <button
                type="button"
                data-testid="pause-tab-creations"
                onClick={() => {
                  if (sim) {
                    setCreationsCountState(sim.creations.length);
                    setActiveCreationIdxState(sim.activeCreationIndex);
                  }
                  setPauseTab('creations');
                }}
                className={`py-1.5 text-[10.5px] font-display font-bold uppercase tracking-wider rounded-[2px] border-2 transition cursor-pointer ${
                  pauseTab === 'creations'
                    ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                    : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:bg-[#52525b]'
                }`}
              >
                {isMobilePopup ? `RIGS (${creationsCountState})` : `CREATIONS (${creationsCountState})`}
              </button>
              <button
                type="button"
                data-testid="pause-tab-controls"
                onClick={() => setPauseTab('controls')}
                className={`py-1.5 text-[10.5px] font-display font-bold uppercase tracking-wider rounded-[2px] border-2 transition cursor-pointer ${
                  pauseTab === 'controls'
                    ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                    : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:bg-[#52525b]'
                }`}
              >
                {isMobilePopup ? 'CONTROLS' : 'KEYBINDS'}
              </button>
            </div>

            {/* TAB 0: DEDICATED 15-FEATURE GRAPHICS SUITE */}
            {pauseTab === 'graphics' && (
              <div
                data-testid="pause-graphics-tab-panel"
                className="space-y-3 mb-4"
              >
                {/* Master Graphics Quality Presets Bar */}
                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <div className="text-xs font-mono-num font-bold text-[#fbbf24] flex items-center gap-2">
                        <span>REAL-TIME WEBGL2 GRAPHICS &amp; POST-FX PIPELINE</span>
                        <span
                          data-testid="graphics-active-count-badge"
                          className="text-[10px] bg-[#1a1a1a] text-[#fbbf24] px-2 py-0.5 rounded-[2px] border border-[#444444]"
                        >
                          {countActiveGraphicsFeatures(graphicsState)} / 15 ACTIVE · {graphicsState.preset}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#a3a3a3]">
                        All 15 rendering, raymarching, reflection, anti-aliasing, and LOD features run live on the GPU
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    {(
                      [
                        { id: 'PENTIUM', label: 'POTATO', desc: '40+ FPS Cel+Rim · 0.65x' },
                        { id: 'CARTOON', label: 'CARTOON', desc: 'Comic Cel + Car Outline' },
                        { id: 'LOW', label: 'LOW', desc: 'Max FPS · 0.55x' },
                        { id: 'MEDIUM', label: 'MEDIUM', desc: 'Balanced · SSAO+Bloom' },
                        { id: 'HIGH', label: 'HIGH', desc: 'SSR · GodRays · TAA' },
                        { id: 'ULTRA', label: 'ULTRA', desc: 'All 15 FX · 1.25x SSAA' },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-testid={`graphics-preset-${p.id}`}
                        onClick={() => sim?.applyGraphicsPreset(p.id)}
                        className={`p-2 rounded-[2px] text-left transition cursor-pointer border-2 ${
                          graphicsState.preset === p.id
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24] font-bold'
                            : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                        }`}
                      >
                        <div className="text-[11px] font-display font-bold uppercase">{p.label}</div>
                        <div
                          className={`text-[9px] font-mono-num ${
                            graphicsState.preset === p.id ? 'text-[#1a1a1a]' : 'text-[#a3a3a3]'
                          }`}
                        >
                          {p.desc}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Adaptive Hardware-Tier Frame Rate Cap Control */}
                  <div
                    data-testid="gfx-card-fps-cap"
                    className="mt-2.5 bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-2.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-[11px] font-mono-num font-bold text-[#fbbf24] flex items-center gap-1.5 flex-wrap">
                        <span>FRAME RATE CAP</span>
                        <span
                          data-testid="gfx-fps-cap-badge"
                          className="text-[9px] bg-[#fbbf24] text-[#1a1a1a] px-1.5 py-0.5 rounded-[2px] border border-[#444444] font-bold uppercase"
                        >
                          {formatFrameRateCapSummary(graphicsState.frameRateCap, hardwareTierInfo.tier)}
                        </span>
                      </div>
                      <div className="text-[9px] text-[#a3a3a3]">
                        Detected tier: {hardwareTierInfo.tier} ({hardwareTierInfo.defaultFpsCap} FPS auto · {hardwareTierInfo.reason}) · Physics stays fixed at 60Hz
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="gfx-select-fps-cap"
                        className="text-[10px] font-mono-num font-bold text-[#e5e5e5] uppercase"
                      >
                        Frame Rate Cap
                      </label>
                      <select
                        id="gfx-select-fps-cap"
                        data-testid="gfx-select-fps-cap"
                        value={String(graphicsState.frameRateCap)}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            frameRateCap: parseFrameRateCapInput(e.target.value),
                            preset: graphicsState.preset,
                          })
                        }
                        className="bg-[#262626] text-[#fbbf24] text-[11px] font-mono-num font-bold px-2.5 py-1 rounded-[2px] border-2 border-[#555555] hover:border-[#fbbf24] focus:border-[#facc15] focus:outline-none cursor-pointer"
                      >
                        {FRAME_RATE_CAP_OPTIONS.map((opt) => (
                          <option
                            key={opt.selectValue}
                            value={opt.selectValue}
                            className="bg-[#1a1a1a] text-[#e5e5e5]"
                          >
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Dedicated Potato Mode & Cartoon Mode Shader Accelerator Bar */}
                  <div
                    data-testid="gfx-card-potato-shader"
                    className="mt-2.5 bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-2.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-[11px] font-mono-num font-bold text-[#fbbf24] flex items-center gap-1.5">
                        <span>CUSTOM GPU SHADER MODES (POTATO CEL+RIM &amp; CARTOON OUTLINE)</span>
                        {graphicsState.usePotatoShader && (
                          <span className="text-[9px] bg-[#fbbf24] text-[#1a1a1a] px-1.5 py-0.2 rounded-[2px] border border-[#444444] font-bold">
                            POTATO CEL+RIM ACTIVE
                          </span>
                        )}
                        {graphicsState.useCartoonShader && (
                          <span className="text-[9px] bg-[#facc15] text-[#1a1a1a] px-1.5 py-0.2 rounded-[2px] border border-[#444444] font-bold">
                            CARTOON + VEHICLE OUTLINE ACTIVE
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-[#a3a3a3]">
                        Potato (3-Band Cel + Rim) · Cartoon (4-Tone Comic Cel + Voxel Ink + GPU Vehicle Outline) · Voxel Ocean Waves
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="gfx-toggle-potato-shader"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            usePotatoShader: !graphicsState.usePotatoShader,
                            useCartoonShader: false,
                            usePBR: graphicsState.usePotatoShader,
                          })
                        }
                        className={`px-2.5 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.usePotatoShader
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                        }`}
                      >
                        POTATO SHADER: {graphicsState.usePotatoShader ? 'ON' : 'OFF'}
                      </button>
                      <button
                        type="button"
                        data-testid="gfx-toggle-cartoon-shader"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            useCartoonShader: !graphicsState.useCartoonShader,
                            usePotatoShader: false,
                            usePBR: graphicsState.useCartoonShader,
                          })
                        }
                        className={`px-2.5 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.useCartoonShader
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                        }`}
                      >
                        CARTOON + OUTLINE: {graphicsState.useCartoonShader ? 'ON' : 'OFF'}
                      </button>
                      <button
                        type="button"
                        data-testid="gfx-toggle-cheap-bloom"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            cheapBloom: !graphicsState.cheapBloom,
                          })
                        }
                        className={`px-2 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.cheapBloom
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                        }`}
                      >
                        1-PASS BLOOM: {graphicsState.cheapBloom ? 'ON' : 'OFF'}
                      </button>
                      <button
                        type="button"
                        data-testid="gfx-toggle-blob-shadows"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            blobShadows: !graphicsState.blobShadows,
                          })
                        }
                        className={`px-2 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.blobShadows
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        BLOB SHADOW: {graphicsState.blobShadows ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>

                  {/* CUSTOM SHADER PRESET STUDIO (6 Built-In Stylized Shaders + User Custom Preset Creator) */}
                  <div
                    data-testid="custom-shader-preset-studio"
                    className="mt-2.5 bg-[#1a1a1a] border-2 border-[#fbbf24] rounded-[2px] p-3 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-display font-extrabold text-[#facc15] uppercase">
                          🎨 CUSTOM SHADER PRESET STUDIO (REAL-TIME CEL, VOXEL INK &amp; SILHOUETTE TUNER)
                        </div>
                        <div className="text-[9px] font-mono-num text-[#a3a3a3]">
                          Active Shader Preset: <strong className="text-[#e5e5e5]">{editingShaderPreset.name}</strong>{' '}
                          <span className="text-[#fbbf24]">
                            ({graphicsState.useCartoonShader ? 'CARTOON ACTIVE' : graphicsState.usePotatoShader ? 'POTATO ACTIVE' : 'STANDARD PBR — TUNING AUTO-ENABLES STYLIZED SHADER'})
                          </span>
                        </div>
                      </div>
                      {shaderFeedback && (
                        <span className="text-[10px] font-mono-num font-bold text-[#4ade80]">
                          {shaderFeedback}
                        </span>
                      )}
                    </div>

                    {/* Preset Selector Pills */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {shaderPresets.map((sp) => {
                        const isSelected = editingShaderPreset.id === sp.id;
                        return (
                          <div
                            key={sp.id}
                            className={`min-w-0 flex items-center justify-between gap-1 px-2 py-1.5 rounded-[2px] border-2 ${
                              isSelected
                                ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5] font-bold'
                                : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                            }`}
                          >
                            <button
                              type="button"
                              data-testid={`shader-preset-btn-${sp.id}`}
                              onClick={() => {
                                setEditingShaderPreset({ ...sp });
                                applyCustomShaderPresetToMaterials(sp);
                                sim?.updateGraphicsSettings({
                                  useCartoonShader: sp.baseMode === 'CARTOON',
                                  usePotatoShader: sp.baseMode === 'POTATO',
                                  usePBR: false,
                                });
                                setShaderFeedback(`Applied "${sp.name}"!`);
                              }}
                              className="min-w-0 flex-1 text-left truncate text-[10px] font-display font-bold uppercase cursor-pointer"
                            >
                              {sp.name}
                            </button>
                            {!sp.isBuiltIn && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextList = deleteCustomShaderPreset(sp.id);
                                  setShaderPresets(nextList);
                                  setEditingShaderPreset({ ...BUILTIN_SHADER_PRESETS[0] });
                                  setShaderFeedback('Deleted custom shader preset.');
                                }}
                                className="shrink-0 px-1 bg-[#dc2626] text-[#e5e5e5] rounded-[2px] text-[9px] font-bold cursor-pointer"
                                title="Delete custom shader preset"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Real-Time Shader Uniform Sliders & Color Pickers */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono-num">
                      <label className="bg-[#242424] border border-[#444444] p-1.5 rounded-[2px] flex flex-col gap-1">
                        <span className="text-[#fbbf24] font-bold">
                          SATURATION: {editingShaderPreset.saturation.toFixed(2)}x
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={2.2}
                          step={0.05}
                          value={editingShaderPreset.saturation}
                          onChange={(e) => {
                            const next = {
                              ...editingShaderPreset,
                              saturation: Number(e.target.value),
                            };
                            setEditingShaderPreset(next);
                            applyCustomShaderPresetToMaterials(next);
                            if (!graphicsState.useCartoonShader && !graphicsState.usePotatoShader) {
                              sim?.updateGraphicsSettings({
                                useCartoonShader: next.baseMode === 'CARTOON',
                                usePotatoShader: next.baseMode === 'POTATO',
                                usePBR: false,
                              });
                            }
                          }}
                        />
                      </label>
                      <label className="bg-[#242424] border border-[#444444] p-1.5 rounded-[2px] flex flex-col gap-1">
                        <span className="text-[#fbbf24] font-bold">
                          CEL BANDS: {editingShaderPreset.celBands}
                        </span>
                        <input
                          type="range"
                          min={2}
                          max={6}
                          step={1}
                          value={editingShaderPreset.celBands}
                          onChange={(e) => {
                            const next = {
                              ...editingShaderPreset,
                              celBands: Number(e.target.value),
                            };
                            setEditingShaderPreset(next);
                            applyCustomShaderPresetToMaterials(next);
                            if (!graphicsState.useCartoonShader && !graphicsState.usePotatoShader) {
                              sim?.updateGraphicsSettings({
                                useCartoonShader: next.baseMode === 'CARTOON',
                                usePotatoShader: next.baseMode === 'POTATO',
                                usePBR: false,
                              });
                            }
                          }}
                        />
                      </label>
                      <label className="bg-[#242424] border border-[#444444] p-1.5 rounded-[2px] flex flex-col gap-1">
                        <span className="text-[#fbbf24] font-bold">
                          VOXEL INK: {Math.round(editingShaderPreset.voxelInkStrength * 100)}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={0.85}
                          step={0.02}
                          value={editingShaderPreset.voxelInkStrength}
                          onChange={(e) => {
                            const next = {
                              ...editingShaderPreset,
                              voxelInkStrength: Number(e.target.value),
                            };
                            setEditingShaderPreset(next);
                            applyCustomShaderPresetToMaterials(next);
                            if (!graphicsState.useCartoonShader && !graphicsState.usePotatoShader) {
                              sim?.updateGraphicsSettings({
                                useCartoonShader: next.baseMode === 'CARTOON',
                                usePotatoShader: next.baseMode === 'POTATO',
                                usePBR: false,
                              });
                            }
                          }}
                        />
                      </label>
                      <label className="bg-[#242424] border border-[#444444] p-1.5 rounded-[2px] flex flex-col gap-1">
                        <span className="text-[#fbbf24] font-bold">
                          OUTLINE: {(editingShaderPreset.outlineThickness * 100).toFixed(1)}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={0.09}
                          step={0.005}
                          value={editingShaderPreset.outlineThickness}
                          onChange={(e) => {
                            const next = {
                              ...editingShaderPreset,
                              outlineThickness: Number(e.target.value),
                            };
                            setEditingShaderPreset(next);
                            applyCustomShaderPresetToMaterials(next);
                            if (!graphicsState.useCartoonShader) {
                              sim?.updateGraphicsSettings({
                                useCartoonShader: true,
                                usePotatoShader: false,
                                usePBR: false,
                              });
                            }
                          }}
                        />
                      </label>
                    </div>

                    {/* Color Pickers + Save Custom Shader Preset Bar */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <label className="flex items-center gap-1 text-[10px] font-mono-num text-[#e5e5e5] bg-[#242424] border border-[#444444] px-2 py-1 rounded-[2px]">
                        <span>OUTLINE</span>
                        <input
                          type="color"
                          value={editingShaderPreset.outlineColorHex}
                          onChange={(e) => {
                            const next = {
                              ...editingShaderPreset,
                              outlineColorHex: e.target.value,
                            };
                            setEditingShaderPreset(next);
                            applyCustomShaderPresetToMaterials(next);
                            if (!graphicsState.useCartoonShader) {
                              sim?.updateGraphicsSettings({
                                useCartoonShader: true,
                                usePotatoShader: false,
                                usePBR: false,
                              });
                            }
                          }}
                          className="w-5 h-4 cursor-pointer bg-transparent border-0"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10px] font-mono-num text-[#e5e5e5] bg-[#242424] border border-[#444444] px-2 py-1 rounded-[2px]">
                        <span>RIM</span>
                        <input
                          type="color"
                          value={editingShaderPreset.rimColorHex}
                          onChange={(e) => {
                            const next = {
                              ...editingShaderPreset,
                              rimColorHex: e.target.value,
                            };
                            setEditingShaderPreset(next);
                            applyCustomShaderPresetToMaterials(next);
                            if (!graphicsState.useCartoonShader && !graphicsState.usePotatoShader) {
                              sim?.updateGraphicsSettings({
                                useCartoonShader: next.baseMode === 'CARTOON',
                                usePotatoShader: next.baseMode === 'POTATO',
                                usePBR: false,
                              });
                            }
                          }}
                          className="w-5 h-4 cursor-pointer bg-transparent border-0"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10px] font-mono-num text-[#e5e5e5] bg-[#242424] border border-[#444444] px-2 py-1 rounded-[2px]">
                        <span>SUN</span>
                        <input
                          type="color"
                          value={editingShaderPreset.sunTintHex}
                          onChange={(e) => {
                            const next = {
                              ...editingShaderPreset,
                              sunTintHex: e.target.value,
                            };
                            setEditingShaderPreset(next);
                            applyCustomShaderPresetToMaterials(next);
                            if (!graphicsState.useCartoonShader && !graphicsState.usePotatoShader) {
                              sim?.updateGraphicsSettings({
                                useCartoonShader: next.baseMode === 'CARTOON',
                                usePotatoShader: next.baseMode === 'POTATO',
                                usePBR: false,
                              });
                            }
                          }}
                          className="w-5 h-4 cursor-pointer bg-transparent border-0"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10px] font-mono-num text-[#e5e5e5] bg-[#242424] border border-[#444444] px-2 py-1 rounded-[2px]">
                        <span>SHADOW</span>
                        <input
                          type="color"
                          value={editingShaderPreset.shadowTintHex}
                          onChange={(e) => {
                            const next = {
                              ...editingShaderPreset,
                              shadowTintHex: e.target.value,
                            };
                            setEditingShaderPreset(next);
                            applyCustomShaderPresetToMaterials(next);
                            if (!graphicsState.useCartoonShader && !graphicsState.usePotatoShader) {
                              sim?.updateGraphicsSettings({
                                useCartoonShader: next.baseMode === 'CARTOON',
                                usePotatoShader: next.baseMode === 'POTATO',
                                usePBR: false,
                              });
                            }
                          }}
                          className="w-5 h-4 cursor-pointer bg-transparent border-0"
                        />
                      </label>

                      <input
                        type="text"
                        data-testid="custom-shader-name-input"
                        value={customShaderNameInput}
                        onChange={(e) => setCustomShaderNameInput(e.target.value)}
                        placeholder="Custom shader preset name..."
                        className="flex-1 min-w-[140px] bg-[#141414] border border-[#444444] rounded-[2px] px-2 py-1 text-[10px] font-mono-num text-[#e5e5e5]"
                      />
                      <button
                        type="button"
                        data-testid="save-custom-shader-preset-btn"
                        onClick={() => {
                          const saved = saveCustomShaderPreset({
                            ...editingShaderPreset,
                            id: undefined,
                            name: customShaderNameInput.trim() || 'Custom Shader Preset',
                            description: 'User-tuned custom cel & outline shader preset',
                          });
                          setShaderPresets(loadCustomShaderPresets());
                          setEditingShaderPreset(saved);
                          sim?.updateGraphicsSettings({
                            useCartoonShader: saved.baseMode === 'CARTOON',
                            usePotatoShader: saved.baseMode === 'POTATO',
                            usePBR: false,
                          });
                          setShaderFeedback(`Saved preset "${saved.name}"!`);
                        }}
                        className="px-2.5 py-1 bg-[#22c55e] hover:bg-[#4ade80] text-[#1a1a1a] border border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer whitespace-nowrap"
                      >
                        💾 SAVE SHADER PRESET
                      </button>
                    </div>
                  </div>
                </div>

                {/* 15 Graphics Features Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* 1. Dynamic Shadow Maps (PCFSoft) */}
                  <div
                    data-testid="gfx-card-shadows"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          1. Blob Shadows (Ground Contact)
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Custom Engine Sprite Shadows · {graphicsState.blobShadows ? 'Active' : 'Disabled'}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-shadows"
                        onClick={() => {
                          const nextVal = !graphicsState.blobShadows;
                          sim?.updateGraphicsSettings({
                            blobShadows: nextVal,
                            dynamicShadows: nextVal,
                          });
                        }}
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.blobShadows
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.blobShadows ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {([512, 1024, 2048, 4096] as ShadowMapResolution[]).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          data-testid={`gfx-shadow-res-${sz}`}
                          onClick={() =>
                            sim?.updateGraphicsSettings({
                              dynamicShadows: true,
                              shadowMapSize: sz,
                            })
                          }
                          className={`py-0.5 rounded-[2px] text-[9px] font-mono-num font-bold cursor-pointer border-2 ${
                            graphicsState.shadowMapSize === sz && graphicsState.dynamicShadows
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                              : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444]'
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-shadow-softness"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={graphicsState.shadowSoftness}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          dynamicShadows: true,
                          shadowSoftness: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                      title="Shadow Softness (PCFSoft Radius)"
                    />
                  </div>

                  {/* 2. Screen-Space Ambient Occlusion (SSAO) */}
                  <div
                    data-testid="gfx-card-ssao"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          2. Screen-Space Ambient Occlusion (SSAO)
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Intensity: {graphicsState.ssaoIntensity.toFixed(2)} · Radius: {graphicsState.ssaoRadius.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-ssao"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            ssaoEnabled: !graphicsState.ssaoEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.ssaoEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.ssaoEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="range"
                        data-testid="gfx-slider-ssao"
                        min={0.1}
                        max={2.0}
                        step={0.05}
                        value={graphicsState.ssaoIntensity}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            ssaoEnabled: true,
                            ssaoIntensity: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#fbbf24] cursor-pointer"
                        title="SSAO Intensity"
                      />
                      <input
                        type="range"
                        data-testid="gfx-slider-ssao-radius"
                        min={0.2}
                        max={2.0}
                        step={0.05}
                        value={graphicsState.ssaoRadius}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            ssaoEnabled: true,
                            ssaoRadius: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#fbbf24] cursor-pointer"
                        title="SSAO Sample Radius"
                      />
                    </div>
                  </div>

                  {/* 3. Screen-Space Reflections (SSR) */}
                  <div
                    data-testid="gfx-card-ssr"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          3. Screen-Space Reflections (SSR)
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Glossy hull &amp; water raymarch intensity: {graphicsState.ssrIntensity.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-ssr"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            ssrEnabled: !graphicsState.ssrEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.ssrEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.ssrEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-ssr"
                      min={0.1}
                      max={1.5}
                      step={0.05}
                      value={graphicsState.ssrIntensity}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          ssrEnabled: true,
                          ssrIntensity: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  {/* 4. HDR Bloom & Emissive Glow */}
                  <div
                    data-testid="gfx-card-bloom"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          4. HDR Bloom &amp; Emissive Glow
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Strength: {graphicsState.bloomStrength.toFixed(2)} · Threshold: {graphicsState.bloomThreshold.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-bloom"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            bloomEnabled: !graphicsState.bloomEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.bloomEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.bloomEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="range"
                        data-testid="gfx-slider-bloom"
                        min={0.1}
                        max={2.5}
                        step={0.05}
                        value={graphicsState.bloomStrength}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            bloomEnabled: true,
                            bloomStrength: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#fbbf24] cursor-pointer"
                        title="Bloom Glow Strength"
                      />
                      <input
                        type="range"
                        data-testid="gfx-slider-bloom-threshold"
                        min={0.3}
                        max={0.95}
                        step={0.02}
                        value={graphicsState.bloomThreshold}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            bloomEnabled: true,
                            bloomThreshold: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#fbbf24] cursor-pointer"
                        title="Bloom Luminance Threshold"
                      />
                    </div>
                  </div>

                  {/* 5. Resolution Scale / Super-Sampling (0.5x – 2.0x) */}
                  <div
                    data-testid="gfx-card-res-scale"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          5. Resolution Scale / Super-Sampling
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Internal Scale: {graphicsState.resolutionScale.toFixed(2)}x ({Math.round(graphicsState.resolutionScale * 100)}%)
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-[2px] text-[9px] font-mono-num font-bold bg-[#1a1a1a] text-[#fbbf24] border border-[#444444]">
                        {graphicsState.resolutionScale > 1.0 ? 'SSAA' : 'NATIVE/PERF'}
                      </span>
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-res-scale"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={graphicsState.resolutionScale}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          resolutionScale: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  {/* 6. Volumetric God Rays & Light Shafts */}
                  <div
                    data-testid="gfx-card-godrays"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          6. Volumetric God Rays &amp; Light Shafts
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Solar crepuscular shafts: {graphicsState.godRaysIntensity.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-godrays"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            godRaysEnabled: !graphicsState.godRaysEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.godRaysEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.godRaysEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-godrays"
                      min={0.1}
                      max={1.5}
                      step={0.05}
                      value={graphicsState.godRaysIntensity}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          godRaysEnabled: true,
                          godRaysIntensity: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  {/* 7. Motion Blur */}
                  <div
                    data-testid="gfx-card-motionblur"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          7. Motion Blur
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Per-pixel velocity reprojection blur: {graphicsState.motionBlurStrength.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-motionblur"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            motionBlurEnabled: !graphicsState.motionBlurEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.motionBlurEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.motionBlurEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-motionblur"
                      min={0.1}
                      max={1.5}
                      step={0.05}
                      value={graphicsState.motionBlurStrength}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          motionBlurEnabled: true,
                          motionBlurStrength: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  {/* 8. Depth of Field (Bokeh DOF) */}
                  <div
                    data-testid="gfx-card-dof"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          8. Depth of Field (Bokeh DOF)
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Focus: {graphicsState.dofFocusDistance}m · Aperture: {graphicsState.dofAperture.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-dof"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            dofEnabled: !graphicsState.dofEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.dofEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.dofEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="range"
                        data-testid="gfx-slider-dof-focus"
                        min={4}
                        max={160}
                        step={2}
                        value={graphicsState.dofFocusDistance}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            dofEnabled: true,
                            dofFocusDistance: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#fbbf24] cursor-pointer"
                        title="Focus Distance (m)"
                      />
                      <input
                        type="range"
                        data-testid="gfx-slider-dof-aperture"
                        min={0.1}
                        max={2.0}
                        step={0.05}
                        value={graphicsState.dofAperture}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            dofEnabled: true,
                            dofAperture: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#fbbf24] cursor-pointer"
                        title="Bokeh Aperture"
                      />
                    </div>
                  </div>

                  {/* 9. Volumetric Smoke & Dust Raymarching */}
                  <div
                    data-testid="gfx-card-volsmoke"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          9. Volumetric Smoke &amp; Dust Raymarching
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          3D FBM plume &amp; crater dust density: {graphicsState.volumetricSmokeDensity.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-volsmoke"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            volumetricSmokeEnabled: !graphicsState.volumetricSmokeEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.volumetricSmokeEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.volumetricSmokeEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-volsmoke"
                      min={0.1}
                      max={2.0}
                      step={0.05}
                      value={graphicsState.volumetricSmokeDensity}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          volumetricSmokeEnabled: true,
                          volumetricSmokeDensity: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  {/* 10. Screen-Space Contact Shadows */}
                  <div
                    data-testid="gfx-card-contactshadows"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          10. Screen-Space Contact Shadows
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Micro-voxel edge &amp; tire contact raymarch: {graphicsState.contactShadowsIntensity.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-contactshadows"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            contactShadowsEnabled: !graphicsState.contactShadowsEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.contactShadowsEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.contactShadowsEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-contactshadows"
                      min={0.1}
                      max={1.5}
                      step={0.05}
                      value={graphicsState.contactShadowsIntensity}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          contactShadowsEnabled: true,
                          contactShadowsIntensity: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  {/* 11. Temporal Anti-Aliasing (TAA) */}
                  <div
                    data-testid="gfx-card-taa"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          11. Temporal Anti-Aliasing (TAA)
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Halton jitter + history blend: {Math.round(graphicsState.taaBlendFactor * 100)}%
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-taa"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            taaEnabled: !graphicsState.taaEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.taaEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.taaEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-taa"
                      min={0.5}
                      max={0.94}
                      step={0.02}
                      value={graphicsState.taaBlendFactor}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          taaEnabled: true,
                          taaBlendFactor: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  {/* 12. Chromatic Aberration & Lens Distortion */}
                  <div
                    data-testid="gfx-card-chromatic"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          12. Chromatic Aberration &amp; Lens Distortion
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          CA: {graphicsState.chromaticAberrationIntensity.toFixed(2)} · Lens: {graphicsState.lensDistortion.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-chromatic"
                        onClick={() => {
                          const currentlyActive =
                            graphicsState.chromaticAberrationEnabled ||
                            Math.abs(graphicsState.lensDistortion) > 0.005;
                          sim?.updateGraphicsSettings(
                            currentlyActive
                              ? { chromaticAberrationEnabled: false, lensDistortion: 0 }
                              : { chromaticAberrationEnabled: true },
                          );
                        }}
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.chromaticAberrationEnabled ||
                          Math.abs(graphicsState.lensDistortion) > 0.005
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.chromaticAberrationEnabled ||
                        Math.abs(graphicsState.lensDistortion) > 0.005
                          ? 'ON'
                          : 'OFF'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="range"
                        data-testid="gfx-slider-chromatic"
                        min={0.0}
                        max={2.0}
                        step={0.05}
                        value={graphicsState.chromaticAberrationIntensity}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            chromaticAberrationEnabled: true,
                            chromaticAberrationIntensity: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#fbbf24] cursor-pointer"
                        title="RGB Chromatic Dispersion"
                      />
                      <input
                        type="range"
                        data-testid="gfx-slider-lens"
                        min={-0.4}
                        max={0.4}
                        step={0.02}
                        value={graphicsState.lensDistortion}
                        onChange={(e) =>
                          sim?.updateGraphicsSettings({
                            lensDistortion: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#fbbf24] cursor-pointer"
                        title="Barrel / Pincushion Lens Distortion"
                      />
                    </div>
                  </div>

                  {/* 13. Particle & Spark Count Multiplier */}
                  <div
                    data-testid="gfx-card-particles"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          13. Particle &amp; Spark Count Multiplier
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Debris, sparks &amp; tire smoke density: {graphicsState.particleMultiplier.toFixed(2)}x
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold bg-[#1a1a1a] text-[#fbbf24] border border-[#444444]">
                        {graphicsState.particleMultiplier.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      data-testid="gfx-slider-particles"
                      min={0.25}
                      max={3.0}
                      step={0.25}
                      value={graphicsState.particleMultiplier}
                      onChange={(e) =>
                        sim?.updateGraphicsSettings({
                          particleMultiplier: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  {/* 14. Real-Time Planar Mirror Reflections */}
                  <div
                    data-testid="gfx-card-planar"
                    className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono-num font-bold text-[#e5e5e5]">
                          14. Real-Time Planar Mirror Reflections
                        </div>
                        <div className="text-[9px] text-[#a3a3a3]">
                          Mirrored ocean camera pass ({graphicsState.planarReflectionResolution}p)
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="gfx-toggle-planar"
                        onClick={() =>
                          sim?.updateGraphicsSettings({
                            planarReflectionsEnabled:
                              !graphicsState.planarReflectionsEnabled,
                          })
                        }
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          graphicsState.planarReflectionsEnabled
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {graphicsState.planarReflectionsEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {([256, 512, 1024] as PlanarReflectionResolution[]).map((res) => (
                        <button
                          key={res}
                          type="button"
                          data-testid={`gfx-planar-res-${res}`}
                          onClick={() =>
                            sim?.updateGraphicsSettings({
                              planarReflectionsEnabled: true,
                              planarReflectionResolution: res,
                            })
                          }
                          className={`py-0.5 rounded-[2px] text-[9px] font-mono-num font-bold cursor-pointer border-2 ${
                            graphicsState.planarReflectionResolution === res &&
                            graphicsState.planarReflectionsEnabled
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                              : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444]'
                          }`}
                        >
                          {res}p
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 15. Voxel Draw Distance / Dynamic Distant Horizons LOD (up to 10^31 + 1 km) */}
                  {(() => {
                    const drawDistBig = getVoxelDrawDistanceBigInt(graphicsState);
                    const lodPlanPreview = computeDynamicLodPlan({
                      renderDistanceChunks: drawDistBig,
                      lodSpacing: graphicsState.lodSpacing,
                      uncappedChunkLod: graphicsState.uncappedChunkLod,
                      supportsHorizonTiles: true,
                    });
                    const radiusMetersBig = drawDistBig * CHUNK_SIZE_METERS_BIGINT;
                    const radiusLabel = formatHorizonDistanceBigInt(radiusMetersBig);
                    const chunksLabel = formatChunksBigInt(drawDistBig);
                    const commitCustomInput = () => {
                      const parsed = parseRenderDistanceInputToChunksBigInt(customRenderDistInput);
                      if (parsed === null) {
                        setCustomRenderDistInput(drawDistBig.toString());
                        return;
                      }
                      setCustomRenderDistInput(parsed.toString());
                      sim?.setRenderDistance(parsed);
                    };
                    return (
                      <div
                        data-testid="gfx-card-drawdist"
                        className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 space-y-2.5 sm:col-span-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-[11px] font-mono-num font-bold text-[#fbbf24]">
                              15. Voxel Draw Distance ({chunksLabel} Chunks · {radiusLabel} Radius) &amp; Dynamic Horizon LOD
                            </div>
                            <div className="text-[9px] text-[#a3a3a3]">
                              <LiveHudField select={selectLodSummary} /> · {lodPlanPreview.totalLodLayers} Active LOD Layers · {lodPlanPreview.activeScaleBands} Scale Band{lodPlanPreview.activeScaleBands > 1 ? 's' : ''} (LOD0 Bubble: ~{lodPlanPreview.realChunkRadiusMeters}m)
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              data-testid="gfx-toggle-fog"
                              onClick={() =>
                                sim?.updateGraphicsSettings({
                                  fog: !graphicsState.fog,
                                })
                              }
                              className={`px-2.5 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                                graphicsState.fog
                                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                                  : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                              }`}
                            >
                              DISTANCE FOG: {graphicsState.fog ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              data-testid="gfx-toggle-planet-curvature"
                              onClick={() =>
                                sim?.updateGraphicsSettings({
                                  planetCurvatureEnabled: !graphicsState.planetCurvatureEnabled,
                                })
                              }
                              className={`px-2.5 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                                graphicsState.planetCurvatureEnabled
                                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                                  : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                              }`}
                            >
                              PLANET CURVATURE: {graphicsState.planetCurvatureEnabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              data-testid="gfx-toggle-uncapped-lod"
                              onClick={() =>
                                sim?.updateGraphicsSettings({
                                  uncappedChunkLod: !graphicsState.uncappedChunkLod,
                                })
                              }
                              className={`px-2.5 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                                graphicsState.uncappedChunkLod
                                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                                  : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                              }`}
                            >
                              MAX LOD0 BUBBLE: {graphicsState.uncappedChunkLod ? 'ON' : 'OFF'}
                            </button>
                          </div>
                        </div>

                        {/* Slider (2..64) + Positive-Only BigInt Custom Input (chunks or "... km" up to 10^31 + 1 km) */}
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="range"
                            data-testid="gfx-slider-drawdist"
                            min={MIN_RENDER_DISTANCE_CHUNKS}
                            max={SLIDER_MAX_RENDER_DISTANCE_CHUNKS}
                            step={1}
                            value={Math.min(
                              SLIDER_MAX_RENDER_DISTANCE_CHUNKS,
                              graphicsState.voxelDrawDistance,
                            )}
                            onChange={(e) => {
                              const nextVal = Number(e.target.value);
                              setCustomRenderDistInput(String(nextVal));
                              sim?.setRenderDistance(nextVal);
                            }}
                            className="flex-1 min-w-[140px] accent-[#fbbf24] cursor-pointer"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[9px] font-mono-num text-[#a3a3a3] uppercase">
                              Custom (+):
                            </span>
                            <input
                              type="text"
                              data-testid="gfx-input-drawdist-custom"
                              aria-label="Custom Render Distance in Chunks or km"
                              value={customRenderDistInput}
                              onKeyDown={(e) => {
                                if (e.key === '-') {
                                  e.preventDefault();
                                } else if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitCustomInput();
                                }
                              }}
                              onChange={(e) => {
                                const clean = e.target.value.replace(/[^0-9a-zA-Z^.+ ]/g, '').slice(0, 42);
                                setCustomRenderDistInput(clean);
                              }}
                              onBlur={commitCustomInput}
                              placeholder="chunks or ... km (max 10^31 km)"
                              className="w-44 sm:w-56 px-1.5 py-0.5 text-[11px] font-mono-num font-bold text-[#fbbf24] bg-[#1a1a1a] border-2 border-[#444444] focus:border-[#fbbf24] rounded-[2px] outline-none text-right"
                            />
                            <button
                              type="button"
                              data-testid="gfx-apply-drawdist-custom"
                              onClick={commitCustomInput}
                              className="px-2 py-0.5 text-[10px] font-mono-num font-bold bg-[#1a1a1a] hover:border-[#fbbf24] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] cursor-pointer"
                            >
                              SET
                            </button>
                          </div>
                        </div>

                        {/* Quick Horizon Presets (up to 10^31 + 1 km!) */}
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                          {[
                            { c: 8n, id: '8', label: '8 (128m)' },
                            { c: 64n, id: '64', label: '64 (1 km)' },
                            { c: 512n, id: '512', label: '512 (8 km)' },
                            { c: 62500n, id: '62500', label: '62.5k (1,000 km)' },
                            { c: 62500000000000n, id: '1e12km', label: '10^12 km' },
                            { c: MAX_RENDER_DISTANCE_CHUNKS_BIGINT, id: '1e31km', label: '10^31 + 1 km' },
                          ].map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              data-testid={`gfx-drawdist-preset-${preset.id}`}
                              onClick={() => {
                                setCustomRenderDistInput(preset.c.toString());
                                sim?.setRenderDistance(preset.c);
                              }}
                              className={`py-1 px-1 rounded-[2px] text-[9px] font-mono-num font-bold transition cursor-pointer border-2 ${
                                drawDistBig === preset.c
                                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                                  : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>

                        {/* Configurable LOD Transition Spacing */}
                        <div className="pt-1.5 border-t border-[#333333]">
                          <div className="flex items-center justify-between text-[10px] font-mono-num mb-1">
                            <span className="text-[#e5e5e5] font-bold">
                              LOD TRANSITION SPACING: {graphicsState.lodSpacing.toFixed(2)}×
                            </span>
                            <span className="text-[#a3a3a3]">
                              LOD0: ~{lodPlanPreview.realChunkRadiusMeters}m · {lodPlanPreview.rings.length} Outer Mega-Tile Rings (Higher = sharper distant detail)
                            </span>
                          </div>
                          <input
                            type="range"
                            data-testid="gfx-slider-lod-spacing"
                            min={MIN_LOD_SPACING}
                            max={MAX_LOD_SPACING}
                            step={0.05}
                            value={graphicsState.lodSpacing}
                            onChange={(e) =>
                              sim?.updateGraphicsSettings({
                                lodSpacing: Number(e.target.value),
                              })
                            }
                            className="w-full accent-[#fbbf24] cursor-pointer"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* TAB 1: PERFORMANCE & SIMULATION */}
            {pauseTab === 'settings' && (
              <div className="space-y-4 mb-4">
                {/* 1-Click LOD & FPS Optimizer */}
                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <div className="text-xs font-mono-num font-bold text-[#fbbf24] flex items-center gap-1.5">
                        <span>3-TIER LOD PERFORMANCE ENGINE</span>
                        <span className="text-[10px] bg-[#1a1a1a] text-[#fbbf24] px-1.5 py-0.5 rounded-[2px] border border-[#444444] font-mono">60–120+ FPS</span>
                      </div>
                      <div className="text-[10px] text-[#a3a3a3]">
                        Automatically downsamples distant chunks &amp; culls hidden faces to eliminate 30 FPS drops
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        sim?.setRenderDistance(3);
                        sim?.setResolutionScale(0.55);
                        sim?.setWaveQuality('LOW');
                      }}
                      className="bg-[#1a1a1a] hover:border-[#fbbf24] border-2 border-[#444444] rounded-[2px] p-2 text-left transition cursor-pointer"
                    >
                      <div className="text-[11px] font-display font-bold text-[#e5e5e5] uppercase">ULTRA PERFORMANCE</div>
                      <div className="text-[9px] text-[#a3a3a3] font-mono-num">120+ FPS · Aggressive LOD</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        sim?.setRenderDistance(4);
                        sim?.setResolutionScale(0.65);
                        sim?.setWaveQuality('MEDIUM');
                      }}
                      className="bg-[#1a1a1a] hover:border-[#fbbf24] border-2 border-[#fbbf24] rounded-[2px] p-2 text-left transition cursor-pointer"
                    >
                      <div className="text-[11px] font-display font-bold text-[#fbbf24] uppercase">BALANCED (REC)</div>
                      <div className="text-[9px] text-[#a3a3a3] font-mono-num">60+ FPS · Smart 3-Tier LOD</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        sim?.setRenderDistance(6);
                        sim?.setResolutionScale(0.85);
                        sim?.setWaveQuality('HIGH');
                      }}
                      className="bg-[#1a1a1a] hover:border-[#fbbf24] border-2 border-[#444444] rounded-[2px] p-2 text-left transition cursor-pointer"
                    >
                      <div className="text-[11px] font-display font-bold text-[#e5e5e5] uppercase">HIGH FIDELITY</div>
                      <div className="text-[9px] text-[#a3a3a3] font-mono-num">60 FPS · Horizon LOD</div>
                    </button>
                  </div>
                </div>

                {/* 14 Vibrant Wave Colors & Shoreline Run-Up */}
                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-xs font-mono-num font-bold text-[#fbbf24] flex items-center gap-1.5">
                        <span>14 VIBRANT WAVE COLORS &amp; SHORELINE SURGE</span>
                        <span className="text-[9px] bg-[#1a1a1a] text-[#fbbf24] px-1.5 py-0.5 rounded-[2px] border border-[#444444] font-mono">REAL SWASH</span>
                      </div>
                      <div className="text-[10px] text-[#a3a3a3]">
                        Waves climb ON TOP of the beach/land like real ocean waves, with 480 floating surface particles
                      </div>
                    </div>
                    <span className="text-xs font-mono-num font-bold text-[#fbbf24] bg-[#1a1a1a] px-2 py-0.5 rounded-[2px] border-2 border-[#444444]">
                      {wavesQuality}
                    </span>
                  </div>

                  {/* 14 Vibrant Color Swatches Preview */}
                  <div className="bg-[#1a1a1a] rounded-[2px] p-2 border-2 border-[#444444] mb-2.5">
                    <div className="text-[10px] font-mono-num text-[#e5e5e5] mb-1.5 flex items-center justify-between">
                      <span>14 Distinct Vibrant Ocean Colors:</span>
                      <span className="text-[9px] text-[#fbbf24]">Micro-Voxels: 0.16m</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { color: '#ffffff', name: 'Whitecap Crest' },
                        { color: '#dcfce7', name: 'Pale Foam' },
                        { color: '#6ee7b7', name: 'Mint Seafoam' },
                        { color: '#22d3ee', name: 'Electric Aqua' },
                        { color: '#00e5ff', name: 'Aquamarine' },
                        { color: '#06b6d4', name: 'Lagoon Teal' },
                        { color: '#38bdf8', name: 'Sky Cerulean' },
                        { color: '#0284c7', name: 'Azure Blue' },
                        { color: '#2563eb', name: 'Ocean Cobalt' },
                        { color: '#1d4ed8', name: 'Ultramarine' },
                        { color: '#4338ca', name: 'Indigo Abyss' },
                        { color: '#1e1b4b', name: 'Midnight Trench' },
                        { color: '#10b981', name: 'Emerald Shore Wash' },
                        { color: '#facc15', name: 'Golden Sun Glint' },
                      ].map((c) => (
                        <div
                          key={c.name}
                          className="flex items-center gap-1 bg-[#222222] border border-[#444444] px-1.5 py-0.5 rounded-[2px] text-[9px]"
                          title={c.name}
                        >
                          <span className="w-2.5 h-2.5 rounded-[2px] inline-block shrink-0 border border-[#444444]" style={{ backgroundColor: c.color }} />
                          <span className="text-[#e5e5e5] font-mono-num">{c.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {(['OFF', 'LOW', 'MEDIUM', 'HIGH'] as const).map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => sim?.setWaveQuality(q)}
                        className={`py-1.5 px-2 rounded-[2px] border-2 text-xs font-mono-num font-bold transition cursor-pointer ${
                          wavesQuality === q
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] hover:bg-[#52525b] border-[#444444]'
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dynamic Distant Horizons Render Distance & LOD Spacing (up to 10^31 + 1 km) */}
                {(() => {
                  const settingsDrawBig = getVoxelDrawDistanceBigInt(graphicsState);
                  const settingsLodPlan = computeDynamicLodPlan({
                    renderDistanceChunks: settingsDrawBig,
                    lodSpacing: graphicsState.lodSpacing,
                    uncappedChunkLod: graphicsState.uncappedChunkLod,
                    supportsHorizonTiles: true,
                  });
                  const radiusMetersBig = settingsDrawBig * CHUNK_SIZE_METERS_BIGINT;
                  const diameterMetersBig = radiusMetersBig * 2n;
                  const radiusStr = formatHorizonDistanceBigInt(radiusMetersBig);
                  const spanStr = formatHorizonDistanceBigInt(diameterMetersBig);
                  const chunksStr = formatChunksBigInt(settingsDrawBig);
                  const commitSettingsCustomDist = () => {
                    const parsed = parseRenderDistanceInputToChunksBigInt(customRenderDistInput);
                    if (parsed === null) {
                      setCustomRenderDistInput(settingsDrawBig.toString());
                      return;
                    }
                    setCustomRenderDistInput(parsed.toString());
                    sim?.setRenderDistance(parsed);
                  };
                  return (
                    <div
                      data-testid="pause-render-distance-section"
                      className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-xs font-mono-num font-bold text-[#fbbf24]">
                            RENDER DISTANCE: {chunksStr} CHUNKS ({radiusStr} RADIUS)
                          </span>
                          <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                            Horizon Span: {spanStr} × {spanStr} · {settingsLodPlan.totalLodLayers} Dynamic LOD Layers · {settingsLodPlan.activeScaleBands} Scale Band{settingsLodPlan.activeScaleBands > 1 ? 's' : ''} [F3]
                          </div>
                        </div>
                        <span className="text-[10px] font-mono-num font-bold text-[#fbbf24] bg-[#1a1a1a] border border-[#444444] px-2 py-0.5 rounded-[2px]">
                          <LiveHudField select={selectLodSummary} />
                        </span>
                      </div>

                      {/* Slider (2..64) + Positive-Only BigInt Custom Input (chunks or "... km" up to 10^31 + 1 km) */}
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="range"
                          data-testid="render-distance-slider"
                          min={MIN_RENDER_DISTANCE_CHUNKS}
                          max={SLIDER_MAX_RENDER_DISTANCE_CHUNKS}
                          step={1}
                          value={Math.min(
                            SLIDER_MAX_RENDER_DISTANCE_CHUNKS,
                            renderDistChunks,
                          )}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setCustomRenderDistInput(String(val));
                            sim?.setRenderDistance(val);
                          }}
                          className="flex-1 min-w-[140px] accent-[#fbbf24] cursor-pointer"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] font-mono-num text-[#a3a3a3]">
                            Custom (+):
                          </span>
                          <input
                            type="text"
                            data-testid="render-distance-custom-input"
                            aria-label="Custom Render Distance Chunks or km"
                            value={customRenderDistInput}
                            onKeyDown={(e) => {
                              if (e.key === '-') {
                                e.preventDefault();
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                commitSettingsCustomDist();
                              }
                            }}
                            onChange={(e) => {
                              const clean = e.target.value.replace(/[^0-9a-zA-Z^.+ ]/g, '').slice(0, 42);
                              setCustomRenderDistInput(clean);
                            }}
                            onBlur={commitSettingsCustomDist}
                            placeholder="chunks or ... km (max 10^31 km)"
                            className="w-44 sm:w-56 px-1.5 py-0.5 text-xs font-mono-num font-bold text-[#fbbf24] bg-[#1a1a1a] border-2 border-[#444444] focus:border-[#fbbf24] rounded-[2px] outline-none text-right"
                          />
                          <button
                            type="button"
                            data-testid="render-distance-custom-apply"
                            onClick={commitSettingsCustomDist}
                            className="px-2 py-0.5 text-[10px] font-mono-num font-bold bg-[#1a1a1a] hover:border-[#fbbf24] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] cursor-pointer"
                          >
                            SET
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                        {[
                          { c: 8n, id: '8', label: '8 (128m)' },
                          { c: 64n, id: '64', label: '64 (1 km)' },
                          { c: 512n, id: '512', label: '512 (8 km)' },
                          { c: 62500n, id: '62500', label: '62.5k (1,000 km)' },
                          { c: 62500000000000n, id: '1e12km', label: '10^12 km' },
                          { c: MAX_RENDER_DISTANCE_CHUNKS_BIGINT, id: '1e31km', label: '10^31 + 1 km' },
                        ].map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            data-testid={`render-dist-preset-${preset.id}`}
                            onClick={() => {
                              setCustomRenderDistInput(preset.c.toString());
                              sim?.setRenderDistance(preset.c);
                            }}
                            className={`py-1 px-1 rounded-[2px] text-[9px] font-mono-num font-bold transition cursor-pointer border-2 ${
                              settingsDrawBig === preset.c
                                ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                                : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {/* LOD Transition Spacing Slider + Planet Curvature Toggle */}
                      <div className="pt-2 border-t border-[#333333] space-y-2">
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono-num mb-1">
                            <span className="font-bold text-[#fbbf24]">
                              LOD TRANSITION SPACING: {graphicsState.lodSpacing.toFixed(2)}×
                            </span>
                            <span className="text-[#a3a3a3]">
                              Crisp LOD0: ~{settingsLodPlan.realChunkRadiusMeters}m · {settingsLodPlan.rings.length} Horizon Rings
                            </span>
                          </div>
                          <input
                            type="range"
                            data-testid="lod-spacing-slider"
                            min={MIN_LOD_SPACING}
                            max={MAX_LOD_SPACING}
                            step={0.05}
                            value={graphicsState.lodSpacing}
                            onChange={(e) =>
                              sim?.updateGraphicsSettings({
                                lodSpacing: Number(e.target.value),
                              })
                            }
                            className="w-full accent-[#fbbf24] cursor-pointer"
                          />
                          <div className="flex justify-between text-[9px] font-mono-num text-[#888888]">
                            <span>0.5× (Tight / Fast)</span>
                            <span>1.0× (Balanced)</span>
                            <span>2.5× (Ultra Detail / High-End PC)</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#333333]">
                          <div>
                            <div className="text-[10px] font-mono-num font-bold text-[#e5e5e5]">
                              PLANET CURVATURE (HORIZON BEND)
                            </div>
                            <div className="text-[9px] font-mono-num text-[#a3a3a3]">
                              Curves distant continents gently over a 1,600 km planetary horizon
                            </div>
                          </div>
                          <button
                            type="button"
                            data-testid="settings-toggle-planet-curvature"
                            onClick={() =>
                              sim?.updateGraphicsSettings({
                                planetCurvatureEnabled: !graphicsState.planetCurvatureEnabled,
                              })
                            }
                            className={`px-3 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 shrink-0 ${
                              graphicsState.planetCurvatureEnabled
                                ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                                : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                            }`}
                          >
                            {graphicsState.planetCurvatureEnabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 3D Internal Resolution Scale & Dynamic Shadows */}
                <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-xs font-mono-num font-bold text-[#e5e5e5]">
                        3D RESOLUTION SCALE: {Math.round(resScale * 100)}% ({resScale.toFixed(2)}x)
                      </span>
                      <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                        Lower scale boosts GPU frame rate on integrated or mobile graphics
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="toggle-shadows-btn"
                      onClick={() => sim?.setShadows(!shadowsEnabled)}
                      className={`px-2.5 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                        shadowsEnabled
                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                          : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      SHADOWS: {shadowsEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  <input
                    type="range"
                    data-testid="resolution-scale-slider"
                    min={0.4}
                    max={1.25}
                    step={0.05}
                    value={resScale}
                    onChange={(e) => sim?.setResolutionScale(Number(e.target.value))}
                    className="w-full accent-[#fbbf24] cursor-pointer my-1.5"
                  />
                  <div className="grid grid-cols-5 gap-1.5 mt-1">
                    {[0.5, 0.65, 0.85, 1.0, 1.25].map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        onClick={() => sim?.setResolutionScale(sc)}
                        className={`py-1 px-1.5 rounded-[2px] text-[10px] font-mono-num font-bold transition cursor-pointer border-2 ${
                          Math.abs(resScale - sc) < 0.03
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#1a1a1a] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                        }`}
                      >
                        {Math.round(sc * 100)}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Camera FOV & Mobile Touch Controls Mode */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-mono-num font-bold text-[#e5e5e5]">
                        CAMERA FOV: {camFov}°
                      </span>
                      <button
                        type="button"
                        onClick={() => sim?.setFov(68)}
                        className="text-[10px] font-mono-num text-[#fbbf24] hover:underline cursor-pointer uppercase"
                      >
                        RESET (68°)
                      </button>
                    </div>
                    <input
                      type="range"
                      data-testid="camera-fov-slider"
                      min={50}
                      max={95}
                      step={1}
                      value={camFov}
                      onChange={(e) => sim?.setFov(Number(e.target.value))}
                      className="w-full accent-[#fbbf24] cursor-pointer"
                    />
                  </div>

                  <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3">
                    <div className="text-xs font-mono-num font-bold text-[#e5e5e5] mb-1.5 uppercase">
                      TOUCH CONTROLS UI MODE
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['AUTO', 'ON', 'OFF'] as TouchModeOverride[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          data-testid={`pause-touch-mode-${mode}`}
                          onClick={() => setTouchModeOverride(mode)}
                          className={`py-1.5 px-2 rounded-[2px] text-[10px] font-mono-num font-bold transition cursor-pointer border-2 ${
                            touchOverrideState === mode
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                              : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:border-[#fbbf24]'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 pt-2 border-t-2 border-[#444444] flex items-center justify-between">
                      <span className="text-[10px] font-mono-num font-bold text-[#e5e5e5] uppercase">
                        VEHICLE INTEGRITY DIAGRAM HUD
                      </span>
                      <button
                        type="button"
                        data-testid="toggle-integrity-diagram-btn"
                        onClick={() => {
                          const next = !hudCustom.showDamageDiagram;
                          setShowIntegrityDiagram(next);
                          updateHudCustom({ showDamageDiagram: next });
                        }}
                        className={`px-2.5 py-1 rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer border-2 ${
                          showIntegrityDiagram && hudCustom.showDamageDiagram
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                            : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        {showIntegrityDiagram && hudCustom.showDamageDiagram ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* INTERACTIVE IMAGE-EDITOR-STYLE HUD LAYOUT STUDIO LAUNCHER (Desktop + Mobile) */}
                <div
                  data-testid="pause-ui-customizer-section"
                  className="bg-[#222222] border-2 border-[#38bdf8] rounded-[2px] p-3.5 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-mono-num font-bold text-[#38bdf8] uppercase">
                        VISUAL HUD LAYOUT STUDIO (FREE MOVE &amp; CORNER RESIZE)
                      </span>
                      <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                        Select any HUD element to drag it anywhere on screen, resize via 4 corner handles like an image editor, or add/remove widgets
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="open-hud-editor-settings-btn"
                        onClick={() => setShowHudEditorModal(true)}
                        className="px-3 py-1.5 rounded-[2px] text-[10.5px] font-display font-extrabold bg-[#38bdf8] hover:bg-[#0ea5e9] text-[#090d16] border-2 border-[#e5e5e5] cursor-pointer uppercase whitespace-nowrap"
                      >
                        ⊞ OPEN VISUAL HUD EDITOR
                      </button>
                      <button
                        type="button"
                        data-testid="reset-hud-custom-btn"
                        onClick={resetHudCustom}
                        className="px-2.5 py-1.5 rounded-[2px] text-[10px] font-mono-num font-bold bg-[#1a1a1a] hover:border-[#fbbf24] text-[#fbbf24] border-2 border-[#444444] cursor-pointer uppercase whitespace-nowrap"
                      >
                        RESET UI
                      </button>
                    </div>
                  </div>

                  {/* Quick Widget Visibility Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {[
                      {
                        id: 'speedometer',
                        label: 'SPEEDOMETER',
                        visible: hudCustom.showSpeedometer,
                        scale: hudCustom.speedometerScale,
                        onToggle: () =>
                          updateHudCustom({ showSpeedometer: !hudCustom.showSpeedometer }),
                      },
                      {
                        id: 'damage-diagram',
                        label: 'DAMAGE HUD',
                        visible: hudCustom.showDamageDiagram,
                        scale: hudCustom.damageDiagramScale,
                        onToggle: () => {
                          const next = !hudCustom.showDamageDiagram;
                          setShowIntegrityDiagram(next);
                          updateHudCustom({ showDamageDiagram: next });
                        },
                      },
                      {
                        id: 'top-bar',
                        label: 'TOP BAR',
                        visible: hudCustom.showTopBar,
                        scale: hudCustom.topBarScale,
                        onToggle: () =>
                          updateHudCustom({ showTopBar: !hudCustom.showTopBar }),
                      },
                      {
                        id: 'action-dock',
                        label: 'ACTION DOCK',
                        visible: hudCustom.showActionDock,
                        scale: hudCustom.actionDockScale,
                        onToggle: () =>
                          updateHudCustom({ showActionDock: !hudCustom.showActionDock }),
                      },
                      {
                        id: 'toasts',
                        label: 'POPUPS',
                        visible: hudCustom.showToasts,
                        scale: hudCustom.toastScale,
                        onToggle: () =>
                          updateHudCustom({ showToasts: !hudCustom.showToasts }),
                      },
                    ].map((el) => (
                      <button
                        key={el.id}
                        type="button"
                        data-testid={`hud-toggle-${el.id}-btn`}
                        onClick={el.onToggle}
                        className={`px-2.5 py-1 rounded-[2px] text-[9.5px] font-mono-num font-bold border cursor-pointer uppercase flex items-center gap-1.5 ${
                          el.visible
                            ? 'bg-[#1a1a1a] text-[#4ade80] border-[#4ade80]'
                            : 'bg-[#1a1a1a] text-[#71717a] border-[#3f3f46] line-through'
                        }`}
                      >
                        <span>{el.label}</span>
                        <span className="text-[#fbbf24]">
                          {Math.round(el.scale * 100)}%
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Adaptive Low-FPS Slow-Motion & Anti-Freeze Watchdog Controls */}
                <div
                  data-testid="pause-slowmo-watchdog-section"
                  className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono-num font-bold text-[#fbbf24] uppercase">
                        ADAPTIVE LOW-FPS SLOW-MOTION &amp; ANTI-FREEZE GUARD
                      </span>
                      <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                        Smoothly dilates simulation time on heavy frames (zero stutter) &amp; time-slices chunk/crater jobs so the browser never freezes
                      </div>
                    </div>
                    <span className="text-[10px] font-mono-num font-bold bg-[#1a1a1a] text-[#fbbf24] border border-[#444444] px-2 py-0.5 rounded-[2px] whitespace-nowrap">
                      SPEED: <LiveHudField select={selectTimeScalePct} />
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <button
                      type="button"
                      data-testid="pause-crash-slowmo-toggle"
                      onClick={() => {
                        SoundFX.snap();
                        toggleCrashSlowMo();
                      }}
                      className={`py-2 px-2.5 rounded-[2px] text-[10px] font-mono-num font-bold transition cursor-pointer border-2 text-left ${
                        impactSlowMoEnabled
                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                          : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      <div>CRASH SLOW-MO: {impactSlowMoEnabled ? 'ON' : 'OFF'}</div>
                      <div className="text-[8.5px] opacity-80 font-normal">
                        Slows time on heavy impacts
                      </div>
                    </button>

                    <button
                      type="button"
                      data-testid="pause-auto-slowmo-toggle"
                      onClick={() => sim?.setAutoSlowMo(!autoSlowMoEnabled)}
                      className={`py-2 px-2.5 rounded-[2px] text-[10px] font-mono-num font-bold transition cursor-pointer border-2 text-left ${
                        autoSlowMoEnabled
                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                          : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      <div>AUTO SLOW-MO: {autoSlowMoEnabled ? 'ON' : 'OFF'}</div>
                      <div className="text-[8.5px] opacity-80 font-normal">
                        Engages &lt; 42 FPS (down to 28% speed)
                      </div>
                    </button>

                    <button
                      type="button"
                      data-testid="pause-manual-slowmo-toggle"
                      onClick={() => sim?.toggleManualSlowMo()}
                      className={`py-2 px-2.5 rounded-[2px] text-[10px] font-mono-num font-bold transition cursor-pointer border-2 text-left ${
                        manualSlowMoActive
                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                          : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      <div>BULLET-TIME [V]: {manualSlowMoActive ? 'ACTIVE' : 'OFF'}</div>
                      <div className="text-[8.5px] opacity-80 font-normal">
                        Manual 35% cinematic slow-mo
                      </div>
                    </button>

                    <button
                      type="button"
                      data-testid="pause-antifreeze-toggle"
                      onClick={() =>
                        sim?.setAntiFreezeWatchdog(!antiFreezeWatchdogEnabled)
                      }
                      className={`py-2 px-2.5 rounded-[2px] text-[10px] font-mono-num font-bold transition cursor-pointer border-2 text-left ${
                        antiFreezeWatchdogEnabled
                          ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24]'
                          : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      <div>
                        ANTI-FREEZE GUARD: {antiFreezeWatchdogEnabled ? 'ON' : 'OFF'}
                      </div>
                      <div className="text-[8.5px] opacity-80 font-normal">
                        Caps frame ms &amp; asyncs chunks
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: CREATIONS MANAGER */}
            {pauseTab === 'creations' && (
              <div
                data-testid="pause-creations-tab-panel"
                className="space-y-3 mb-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-num text-[#e5e5e5] bg-[#222222] p-2.5 rounded-[2px] border-2 border-[#444444]">
                  <span>
                    Active Vehicles:{' '}
                    <strong className="text-[#fbbf24]">
                      {(sim?.creations?.length ?? creationsCountState)} / {maxVehiclesLimit}
                    </strong>{' '}
                    (60Hz Custom Voxel Physics)
                  </span>
                  <button
                    type="button"
                    data-testid="toggle-max-vehicles-cap-btn"
                    onClick={() =>
                      setMaxVehiclesLimit((prev) =>
                        prev === PHYSICS_CONFIG.limits.defaultMaxVehicles
                          ? PHYSICS_CONFIG.limits.extendedMaxVehicles
                          : PHYSICS_CONFIG.limits.defaultMaxVehicles,
                      )
                    }
                    className="px-2.5 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-mono-num font-bold text-[10px] uppercase cursor-pointer shrink-0"
                  >
                    Cap: {maxVehiclesLimit} Vehicles (Click for {maxVehiclesLimit === 20 ? 50 : 20})
                  </button>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {sim?.creations?.map((cr, idx) => {
                    const isActive =
                      idx === activeCreationIdxState && hud.isSeatedInRig;
                    const isFocused = idx === activeCreationIdxState;
                    const hasSeat = cr.hasIntactSeat();
                    const cfg = cr.aiConfig;
                    const aiEnabled = Boolean(cfg?.enabled);
                    const personalityColor =
                      cfg?.personality === 'AGGRESSIVE'
                        ? 'bg-[#ef4444] text-[#f5f5f5]'
                        : cfg?.personality === 'CAUTIOUS'
                          ? 'bg-[#38bdf8] text-[#0f172a]'
                          : 'bg-[#facc15] text-[#141414]';
                    return (
                      <div
                        key={cr.vehicleId || idx}
                        data-testid={`creation-card-${idx}`}
                        className={`p-2.5 sm:p-3 rounded-[2px] border-2 transition ${
                          aiEnabled
                            ? 'bg-[#1f2923] border-[#22c55e]'
                            : isFocused
                              ? 'bg-[#2a2a2a] border-[#facc15]'
                              : 'bg-[#222222] border-[#444444]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-display font-bold text-[#e5e5e5] uppercase truncate">
                                #{idx + 1}: {cr.customBlueprintName || PRESET_NAMES[cr.presetIndex] || 'TrailRig'}
                              </span>
                              {isActive && (
                                <span className="text-[9.5px] font-mono-num font-extrabold bg-[#facc15] text-[#1a1a1a] border border-[#444444] px-1.5 py-0.5 rounded-[2px]">
                                  DRIVING
                                </span>
                              )}
                              {aiEnabled && (
                                <span className={`text-[9.5px] font-mono-num font-extrabold px-1.5 py-0.5 rounded-[2px] border border-[#444444] ${personalityColor}`}>
                                  AI · {cfg.personality}
                                </span>
                              )}
                              {!hasSeat && (
                                <span className="text-[9.5px] font-mono-num font-bold bg-[#dc2626] text-[#e5e5e5] px-1.5 py-0.5 rounded-[2px]">
                                  NO SEAT
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono-num text-[#a3a3a3] mt-0.5">
                              {cr.voxelCount} blocks · {Math.round(cr.totalMass)}kg · Pos: X:{Math.round(cr.position.x)}, Z:{Math.round(cr.position.z)}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              data-testid={`creation-ai-toggle-${idx}`}
                              onClick={() => {
                                SoundFX.snap();
                                if (!cfg) return;
                                const nextEnabled = !cfg.enabled;
                                cfg.enabled = nextEnabled;
                                if (nextEnabled) {
                                  cr.setHoverBuildMode(false);
                                  cr.isRemoteControlled = false;
                                  cfg.homeX = cr.position.x;
                                  cfg.homeZ = cr.position.z;
                                  cfg.statusLabel = isActive ? 'ARMED (EXIT TO RUN)' : 'ACTIVE';
                                  if (isActive && sim?.isSeatedInRig) {
                                    sim.toggleEnterExitRig();
                                  }
                                } else {
                                  cr.aiThrottleInput = 0;
                                  cr.aiSteerInput = 0;
                                  cr.aiPitchInput = 0;
                                  cr.aiRollInput = 0;
                                  cr.aiCollectiveInput = 0;
                                  cr.aiBrakeInput = false;
                                  cfg.statusLabel = 'HUMAN';
                                }
                                setConfigRefreshTick((t) => t + 1);
                              }}
                              className={`px-2 py-1 border-2 font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer ${
                                aiEnabled
                                  ? 'bg-[#22c55e] text-[#141414] border-[#f5f5f5]'
                                  : 'bg-[#333333] hover:bg-[#444444] text-[#fbbf24] border-[#555555]'
                              }`}
                            >
                              {aiEnabled ? 'AI: ON' : isActive ? 'HAND OVER AI' : 'ASSIGN AI'}
                            </button>
                            {!isActive && (
                              <button
                                type="button"
                                data-testid={`creation-drive-btn-${idx}`}
                                onClick={() => {
                                  SoundFX.snap();
                                  if (cfg) {
                                    cfg.enabled = false;
                                    cfg.statusLabel = 'HUMAN';
                                  }
                                  sim?.driveCreationAt(idx);
                                  sim?.resumeGame();
                                }}
                                className="px-2.5 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-bold text-xs uppercase rounded-[2px] cursor-pointer"
                              >
                                {hasSeat ? 'DRIVE' : 'FOCUS'}
                              </button>
                            )}
                            <button
                              type="button"
                              data-testid={`creation-clone-btn-${idx}`}
                              onClick={() => {
                                sim?.duplicateCreationAt(idx);
                              }}
                              className="px-2 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold text-xs uppercase rounded-[2px] cursor-pointer"
                              title="Clone this creation"
                            >
                              CLONE
                            </button>
                            {(sim?.creations?.length ?? creationsCountState) > 1 && (
                              <button
                                type="button"
                                data-testid={`creation-del-btn-${idx}`}
                                onClick={() => {
                                  sim?.deleteCreationAt(idx);
                                }}
                                className="px-2 py-1 bg-[#dc2626] hover:bg-red-700 text-[#e5e5e5] border-2 border-[#444444] font-display font-bold text-xs uppercase rounded-[2px] cursor-pointer"
                                title="Delete this creation from the world"
                              >
                                DEL
                              </button>
                            )}
                          </div>
                        </div>

                        {aiEnabled && cfg && (
                          <div
                            data-testid={`creation-ai-options-${idx}`}
                            className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-[#383838]"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase shrink-0 w-9">
                                TEAM
                              </span>
                              <div className="grid grid-cols-5 gap-1 flex-1 min-w-0">
                                {AI_TEAMS.map((t) => (
                                  <button
                                    key={t.id}
                                    type="button"
                                    data-testid={`creation-${idx}-team-${t.id}`}
                                    onClick={() => {
                                      SoundFX.snap();
                                      cfg.team = t.id;
                                      setConfigRefreshTick((n) => n + 1);
                                    }}
                                    className={`py-1 px-1 rounded-[2px] border text-[9px] font-display font-extrabold uppercase cursor-pointer text-center truncate ${
                                      cfg.team === t.id
                                        ? `${t.bg} ${t.text} border-[#f5f5f5]`
                                        : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
                                    }`}
                                  >
                                    {t.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase shrink-0 w-9">
                                ROLE
                              </span>
                              <div className="grid grid-cols-5 gap-1 flex-1 min-w-0">
                                {AI_ROLES.map((r) => (
                                  <button
                                    key={r.id}
                                    type="button"
                                    data-testid={`creation-${idx}-role-${r.id}`}
                                    onClick={() => {
                                      SoundFX.snap();
                                      cfg.role = r.id;
                                      if (r.id === 'GUARD') {
                                        cfg.team = 'PLAYER';
                                      }
                                      setConfigRefreshTick((n) => n + 1);
                                    }}
                                    className={`py-1 px-1 rounded-[2px] border text-[9px] font-display font-bold uppercase cursor-pointer text-center truncate ${
                                      cfg.role === r.id
                                        ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#f5f5f5]'
                                        : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
                                    }`}
                                  >
                                    {r.shortLabel}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 min-w-0 sm:col-span-2">
                              <span className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase shrink-0 w-9">
                                STYLE
                              </span>
                              <div className="grid grid-cols-3 gap-1 flex-1 min-w-0">
                                {AI_PERSONALITIES.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    data-testid={`creation-${idx}-personality-${p.id}`}
                                    onClick={() => {
                                      SoundFX.snap();
                                      cfg.personality = p.id;
                                      cfg.effectivePersonality =
                                        p.id === 'CAUTIOUS' ? 'CAUTIOUS' : 'AGGRESSIVE';
                                      setConfigRefreshTick((n) => n + 1);
                                    }}
                                    className={`py-1 px-1 rounded-[2px] border text-[9px] font-display font-extrabold uppercase cursor-pointer text-center truncate ${
                                      cfg.personality === p.id
                                        ? `${p.bg} ${p.text} border-[#f5f5f5]`
                                        : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
                                    }`}
                                  >
                                    {p.id}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    data-testid="creation-spawn-new-btn"
                    onClick={() => {
                      sim?.spawnNewCreation(0);
                    }}
                    className="py-2 px-2 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-bold text-xs uppercase rounded-[2px] cursor-pointer"
                  >
                    + SPAWN NEW CRUISER RIG
                  </button>
                  <button
                    type="button"
                    data-testid="creation-open-garage-btn"
                    onClick={() => {
                      setShowGarageModal(true);
                      sim?.resumeGame();
                    }}
                    className="py-2 px-2 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold text-xs uppercase rounded-[2px] cursor-pointer"
                  >
                    GARAGE BLUEPRINTS [O]
                  </button>
                  <button
                    type="button"
                    data-testid="pause-open-ai-fleet-btn"
                    onClick={() => {
                      sim?.resumeGame();
                      setShowAiFleetModal(true);
                    }}
                    className="py-2 px-2 bg-[#22c55e] hover:bg-[#16a34a] text-[#141414] border-2 border-[#444444] font-display font-extrabold text-xs uppercase rounded-[2px] cursor-pointer"
                  >
                    AI PILOTS &amp; COMBAT
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: KEYBINDS & CONTROLS */}
            {pauseTab === 'controls' && (
              <div className="space-y-2.5 mb-4 text-xs font-mono-num text-[#e5e5e5]">
                <div className="bg-[#222222] p-3 rounded-[2px] border-2 border-[#444444] space-y-1.5">
                  <div className="text-[11px] font-display font-bold text-[#fbbf24] mb-1 uppercase tracking-wider">
                    DRIVING &amp; FLIGHT CONTROLS
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Throttle &amp; Reverse</span>
                    <span className="text-[#e5e5e5] font-bold">[W] / [S]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Steer Wheels &amp; Yaw</span>
                    <span className="text-[#e5e5e5] font-bold">[A] / [D]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Aircraft Pitch &amp; Elevators</span>
                    <span className="text-[#e5e5e5] font-bold">[UP] / [DOWN] or [W] / [S]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Handbrake / Upward Thruster</span>
                    <span className="text-[#e5e5e5] font-bold">[SPACE]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Rocket Boost / Turbo</span>
                    <span className="text-[#e5e5e5] font-bold">[SHIFT]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Extend / Retract Pistons</span>
                    <span className="text-[#e5e5e5] font-bold">[X]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Grapple Winch Harpoon</span>
                    <span className="text-[#e5e5e5] font-bold">[T]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Auto-Upright / Flip Recovery</span>
                    <span className="text-[#e5e5e5] font-bold">[G]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Fire Plasma Cannons</span>
                    <span className="text-[#e5e5e5] font-bold">[LEFT CLICK]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Drop Sticky Bombs / Detonate</span>
                    <span className="text-[#e5e5e5] font-bold">[Q]</span>
                  </div>
                </div>

                <div className="bg-[#222222] p-3 rounded-[2px] border-2 border-[#444444] space-y-1.5">
                  <div className="text-[11px] font-display font-bold text-[#fbbf24] mb-1 uppercase tracking-wider">
                    WALKING &amp; BUILDING
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Toggle Build Mode</span>
                    <span className="text-[#fbbf24] font-bold">[B]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Enter / Exit Vehicle Seat</span>
                    <span className="text-[#e5e5e5] font-bold">[E]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Call Nearest Vehicle Upright</span>
                    <span className="text-[#e5e5e5] font-bold">[R]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Rotate Block / Module (Yaw &amp; Roll)</span>
                    <span className="text-[#e5e5e5] font-bold">[R] / [Y]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Undo Last Build Step</span>
                    <span className="text-[#e5e5e5] font-bold">[Z]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Toggle Mirror Symmetry</span>
                    <span className="text-[#e5e5e5] font-bold">[M]</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a3a3a3]">Object Studio &amp; World Editor</span>
                    <span className="text-[#e5e5e5] font-bold">[J] / [K]</span>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="flex flex-col gap-2 pt-2 border-t-2 border-[#444444]">
              <button
                type="button"
                onClick={() => sim?.resumeGame()}
                className="hazard-stripe-border bg-[#fbbf24] hover:bg-[#facc15] w-full py-2.5 text-[#1a1a1a] font-display font-extrabold text-sm uppercase tracking-wider rounded-[2px] cursor-pointer"
              >
                RESUME SANDBOX [ESC]
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    sim?.resumeGame();
                    sim?.toggleHoverBuildMode(true);
                  }}
                  className="hazard-stripe-border bg-[#6b7280] hover:bg-[#52525b] w-full py-2 text-[#e5e5e5] font-display font-bold text-xs uppercase tracking-wider rounded-[2px] cursor-pointer"
                >
                  OPEN BUILDER [B]
                </button>
                <button
                  type="button"
                  onClick={() => sim?.restartSandbox()}
                  className="w-full py-2 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] font-display font-bold text-xs uppercase tracking-wider rounded-[2px] cursor-pointer"
                >
                  RESET AT SPAWN
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          6. SERVERLESS P2P MULTIPLAYER LOBBY MODAL [M]
          ===================================================================== */}
      {showMultiplayerModal && (
        <div
          data-testid="multiplayer-modal"
          data-layout-mode={isMobilePopup ? 'mobile' : 'laptop'}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMultiplayerModal(false);
          }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-1.5 lg:p-4 pointer-events-auto touch-manipulation"
        >
          <div
            className={
              isMobilePopup
                ? 'bg-[#1a1a1a] border-2 border-[#fbbf24] rounded-[2px] p-2.5 w-[min(96vw,540px)] max-h-[calc(100dvh-16px)] overflow-y-auto overscroll-contain touch-pan-y text-[#e5e5e5] shadow-[0_8px_32px_rgba(0,0,0,0.9)]'
                : 'bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain touch-pan-y text-[#e5e5e5]'
            }
          >
            {/* Sticky Header */}
            <div
              className={
                isMobilePopup
                  ? 'sticky top-0 z-20 bg-[#1a1a1a] -mx-2.5 -mt-2.5 px-2.5 py-1.5 flex items-center justify-between gap-2 border-b-2 border-[#444444] mb-2'
                  : 'sticky top-0 z-20 bg-[#1a1a1a] -mx-6 -mt-6 px-6 py-3.5 flex items-center justify-between gap-2 border-b-2 border-[#444444] mb-3'
              }
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="bg-[#fbbf24] text-[#1a1a1a] border border-[#444444] font-display font-extrabold text-[9.5px] px-1.5 py-0.5 rounded-[2px] uppercase tracking-wider shrink-0">
                    WEBRTC P2P
                  </span>
                  <h2
                    className={
                      isMobilePopup
                        ? 'text-xs font-display font-extrabold uppercase tracking-wider text-[#e5e5e5] truncate'
                        : 'text-xl font-display font-extrabold uppercase tracking-wider text-[#e5e5e5] truncate'
                    }
                  >
                    MULTIPLAYER LOBBY
                  </h2>
                </div>
                {!isMobilePopup && (
                  <p className="text-[11px] font-mono-num text-[#a3a3a3] mt-0.5 truncate">
                    Serverless WebRTC DataChannels · 20Hz State Sync
                  </p>
                )}
              </div>
              <button
                type="button"
                data-testid="close-multiplayer-modal-btn"
                onClick={() => setShowMultiplayerModal(false)}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowMultiplayerModal(false);
                }}
                className="min-h-[32px] px-2.5 py-1 bg-[#dc2626] hover:bg-red-700 active:bg-red-500 text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[11px] font-display font-extrabold uppercase cursor-pointer shrink-0 touch-manipulation"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* 1. Player Profile: Name + Color Badge */}
            <div
              className={
                isMobilePopup
                  ? 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2 mb-2'
                  : 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5 mb-4'
              }
            >
              <div className="text-[9.5px] font-display font-bold text-[#fbbf24] uppercase tracking-wider mb-1.5">
                PLAYER PROFILE
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
                  <span
                    className="w-4 h-4 rounded-[2px] border-2 border-[#444444] shrink-0"
                    style={{ backgroundColor: mpState.playerColor }}
                  />
                  <input
                    type="text"
                    data-testid="mp-player-name-input"
                    maxLength={20}
                    value={mpState.playerName}
                    onChange={(e) =>
                      simRef.current?.multiplayer?.setProfile(
                        e.target.value,
                        mpState.playerColor,
                      )
                    }
                    placeholder="Enter callsign..."
                    className="w-full bg-[#1a1a1a] border-2 border-[#444444] focus:border-[#fbbf24] rounded-[2px] px-2.5 py-1 text-xs font-mono-num text-[#e5e5e5] outline-none"
                  />
                </div>
                <div className="flex items-center gap-1">
                  {[
                    '#38bdf8',
                    '#facc15',
                    '#4ade80',
                    '#f43f5e',
                    '#c084fc',
                    '#fb923c',
                  ].map((col) => (
                    <button
                      key={col}
                      type="button"
                      data-testid={`mp-color-${col}`}
                      onClick={() =>
                        simRef.current?.multiplayer?.setProfile(
                          mpState.playerName,
                          col,
                        )
                      }
                      style={{ backgroundColor: col }}
                      className={`w-5 h-5 rounded-[2px] cursor-pointer transition border-2 ${
                        mpState.playerColor === col
                          ? 'border-[#e5e5e5] scale-110'
                          : 'border-[#444444] opacity-75 hover:opacity-100'
                      }`}
                      title={`Select badge color ${col}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* 2. Host or Join Lobby Controls */}
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              {/* Host Lobby Card */}
              <div
                className={
                  isMobilePopup
                    ? 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2 flex flex-col justify-between'
                    : 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5 flex flex-col justify-between'
                }
              >
                <div>
                  <div className="text-[10px] font-display font-bold text-[#fbbf24] uppercase tracking-wider mb-1">
                    HOST LOBBY
                  </div>
                  {!isMobilePopup && (
                    <p className="text-[11px] text-[#a3a3a3] mb-3">
                      Create a room code and share it with friends to play together.
                    </p>
                  )}
                </div>

                {mpState.status === 'connected' && mpState.role === 'host' ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between bg-[#1a1a1a] border-2 border-[#fbbf24] rounded-[2px] px-2.5 py-1">
                      <span
                        data-testid="mp-room-code-display"
                        className="font-mono-num font-extrabold text-xs tracking-widest text-[#fbbf24]"
                      >
                        {mpState.roomCode}
                      </span>
                      <button
                        type="button"
                        data-testid="mp-copy-code-btn"
                        onClick={() => {
                          navigator.clipboard?.writeText(mpState.roomCode);
                          setMpToast(`Copied room code ${mpState.roomCode}!`);
                        }}
                        className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#52525b] text-[10px] font-mono-num text-[#e5e5e5] border border-[#444444] rounded-[2px] uppercase cursor-pointer"
                      >
                        COPY
                      </button>
                    </div>
                    <div className="text-[9.5px] font-mono-num text-[#fbbf24] uppercase">
                      HOSTING ACTIVE
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="mp-host-lobby-btn"
                    disabled={mpState.status === 'connecting'}
                    onClick={async () => {
                      setMpToast('');
                      try {
                        const code =
                          await simRef.current?.multiplayer?.hostLobby();
                        if (code) {
                          try {
                            await navigator.clipboard?.writeText(code);
                            setMpToast(
                              `Lobby ${code} hosted & copied to clipboard!`,
                            );
                          } catch {
                            setMpToast(`Lobby ${code} hosted!`);
                          }
                        }
                      } catch (err) {
                        setMpToast(
                          err instanceof Error
                            ? err.message
                            : 'Failed to host lobby',
                        );
                      }
                    }}
                    className="w-full py-1.5 bg-[#fbbf24] hover:bg-[#facc15] disabled:opacity-50 text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-[11px] uppercase tracking-wider rounded-[2px] cursor-pointer"
                  >
                    {mpState.status === 'connecting' && mpState.role === 'host'
                      ? 'STARTING...'
                      : 'HOST NEW LOBBY'}
                  </button>
                )}
              </div>

              {/* Join Lobby Card */}
              <div
                className={
                  isMobilePopup
                    ? 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2 flex flex-col justify-between'
                    : 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5 flex flex-col justify-between'
                }
              >
                <div>
                  <div className="text-[10px] font-display font-bold text-[#fbbf24] uppercase tracking-wider mb-1">
                    JOIN LOBBY
                  </div>
                  {!isMobilePopup && (
                    <p className="text-[11px] text-[#a3a3a3] mb-2">
                      Paste a friend&apos;s 6-character Room Code (e.g. VOX-849):
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    data-testid="mp-join-code-input"
                    value={joinRoomCodeInput}
                    onChange={(e) =>
                      setJoinRoomCodeInput(e.target.value.toUpperCase())
                    }
                    placeholder="VOX-849"
                    maxLength={10}
                    className="w-full bg-[#1a1a1a] border-2 border-[#444444] focus:border-[#fbbf24] rounded-[2px] px-2 py-1 text-xs font-mono-num font-bold tracking-wider text-[#e5e5e5] uppercase outline-none"
                  />
                  <button
                    type="button"
                    data-testid="mp-join-connect-btn"
                    disabled={
                      mpState.status === 'connecting' ||
                      !joinRoomCodeInput.trim()
                    }
                    onClick={async () => {
                      setMpToast('');
                      try {
                        await simRef.current?.multiplayer?.joinLobby(
                          joinRoomCodeInput,
                        );
                        setMpToast(`Connected to lobby ${joinRoomCodeInput}!`);
                      } catch (err) {
                        setMpToast(
                          err instanceof Error
                            ? err.message
                            : 'Failed to connect',
                        );
                      }
                    }}
                    className="px-2.5 py-1 bg-[#fbbf24] hover:bg-[#facc15] disabled:opacity-50 text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-[11px] uppercase rounded-[2px] cursor-pointer shrink-0"
                  >
                    JOIN
                  </button>
                </div>
              </div>
            </div>

            {/* Feedback / Error Banner */}
            {(mpToast || mpState.errorMessage) && (
              <div
                data-testid="mp-status-banner"
                className={`mb-2.5 px-2.5 py-1.5 rounded-[2px] border-2 text-[11px] font-mono-num ${
                  mpState.errorMessage
                    ? 'bg-[#dc2626] border-[#444444] text-[#e5e5e5]'
                    : 'bg-[#222222] border-[#fbbf24] text-[#fbbf24]'
                }`}
              >
                {mpState.errorMessage || mpToast}
              </div>
            )}

            {/* 2B. Live Server Lobbies (1-Click Join) */}
            <div
              className={
                isMobilePopup
                  ? 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2 mb-2'
                  : 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5 mb-4'
              }
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-display font-bold text-[#fbbf24] uppercase tracking-wider">
                  ACTIVE MULTIPLAYER ROOMS ({activeRooms.length})
                </span>
                <button
                  type="button"
                  data-testid="mp-refresh-rooms-btn"
                  onClick={() => refreshActiveRooms()}
                  className="text-[10px] font-mono-num text-[#fbbf24] hover:underline uppercase cursor-pointer"
                >
                  REFRESH
                </button>
              </div>
              {activeRooms.length === 0 ? (
                <div className="text-[10.5px] font-mono-num text-[#a3a3a3] py-1.5 text-center border-2 border-dashed border-[#444444] rounded-[2px]">
                  No open rooms on server yet — click &quot;HOST NEW LOBBY&quot; above!
                </div>
              ) : (
                <div
                  data-testid="mp-active-rooms-list"
                  className="space-y-1 max-h-24 overflow-y-auto pr-1"
                >
                  {activeRooms.map((rm) => {
                    const isCurrentRoom = mpState.roomCode === rm.roomCode;
                    return (
                      <div
                        key={rm.roomCode}
                        data-testid={`mp-active-room-${rm.roomCode}`}
                        className="flex items-center justify-between bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] px-2.5 py-1 text-xs font-mono-num"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#fbbf24]">
                            {rm.roomCode}
                          </span>
                          <span className="text-[#a3a3a3]">
                            Host: <strong className="text-[#e5e5e5]">{rm.hostName}</strong>
                          </span>
                          <span className="text-[10px] bg-[#222222] text-[#fbbf24] border border-[#444444] px-1.5 py-0.5 rounded-[2px]">
                            {rm.playerCount} {rm.playerCount === 1 ? 'PILOT' : 'PILOTS'}
                          </span>
                        </div>
                        {isCurrentRoom ? (
                          <span className="text-[10px] font-bold text-[#facc15]">
                            CONNECTED
                          </span>
                        ) : (
                          <button
                            type="button"
                            data-testid={`mp-quick-join-${rm.roomCode}`}
                            onClick={() => {
                              setJoinRoomCodeInput(rm.roomCode);
                              simRef.current?.multiplayer?.joinLobby(rm.roomCode);
                              setMpToast(`Joining lobby ${rm.roomCode}...`);
                            }}
                            className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-[10px] uppercase rounded-[2px] cursor-pointer"
                          >
                            JOIN ROOM
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 3. Connected Players List */}
            <div
              className={
                isMobilePopup
                  ? 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2 mb-2'
                  : 'bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3.5 mb-4'
              }
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-display font-bold text-[#e5e5e5] uppercase tracking-wider">
                  CONNECTED PLAYERS ({mpState.players.length})
                </span>
                {mpState.roomCode && (
                  <span className="text-[10px] font-mono-num text-[#fbbf24] font-bold">
                    ROOM: {mpState.roomCode}
                  </span>
                )}
              </div>

              {mpState.players.length === 0 ? (
                <div className="text-[10.5px] font-mono-num text-[#a3a3a3] py-2 text-center border-2 border-dashed border-[#444444] rounded-[2px]">
                  Not connected to a lobby yet. Host a room or enter a Room Code above!
                </div>
              ) : (
                <div
                  data-testid="mp-connected-players-list"
                  className="space-y-1 max-h-32 overflow-y-auto pr-1"
                >
                  {mpState.players.map((peer) => {
                    const isSelf = peer.peerId === mpState.localPeerId || peer.isLocal;
                    return (
                      <div
                        key={peer.peerId}
                        data-testid={`mp-peer-row-${peer.peerId}`}
                        className="flex items-center justify-between bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] px-2.5 py-1.5 text-xs font-mono-num"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-[2px] border border-[#444444] shrink-0"
                            style={{ backgroundColor: peer.color }}
                          />
                          <span className="font-bold text-[#e5e5e5]">
                            {peer.name}
                          </span>
                          {isSelf && (
                            <span className="text-[10px] bg-[#222222] text-[#fbbf24] border border-[#444444] px-1.5 py-0.5 rounded-[2px]">
                              YOU
                            </span>
                          )}
                          {peer.isHost && (
                            <span className="text-[10px] bg-[#facc15] text-[#1a1a1a] font-extrabold px-1.5 py-0.5 rounded-[2px]">
                              HOST
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <span
                            className={`text-[11px] font-bold uppercase ${
                              peer.mode === 'drive'
                                ? 'text-[#facc15]'
                                : 'text-[#e5e5e5]'
                            }`}
                          >
                            {peer.mode === 'drive' ? 'DRIVING' : 'ON FOOT'}
                          </span>
                          <span className="text-[11px] text-[#fbbf24] tabular-nums">
                            {isSelf ? '0 ms' : `${peer.pingMs} ms`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 4. Bottom Actions: Broadcast Active Vehicle + Map Sync + Disconnect */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t-2 border-[#444444]">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="mp-sync-vehicle-btn"
                  disabled={mpState.status !== 'connected'}
                  onClick={() => {
                    const activeRig = simRef.current?.getActiveRig();
                    if (activeRig && simRef.current?.multiplayer) {
                      simRef.current.multiplayer.broadcastSpawnVehicle(activeRig);
                      setMpToast('Synced active vehicle blueprint to all peers!');
                    }
                  }}
                  className="px-2.5 py-1.5 bg-[#6b7280] hover:bg-[#52525b] disabled:opacity-40 text-[#e5e5e5] border-2 border-[#444444] font-display font-bold text-[11px] uppercase rounded-[2px] cursor-pointer"
                >
                  SYNC MY RIG
                </button>
                <button
                  type="button"
                  data-testid="mp-sync-map-btn"
                  disabled={mpState.status !== 'connected'}
                  onClick={() => {
                    if (simRef.current?.multiplayer) {
                      simRef.current.multiplayer.broadcastWorldMapSync();
                      setMpToast(`Broadcasting active map ("${activeMapLabel}") to lobby!`);
                    }
                  }}
                  className="px-2.5 py-1.5 bg-[#6b7280] hover:bg-[#52525b] disabled:opacity-40 text-[#e5e5e5] border-2 border-[#444444] font-display font-bold text-[11px] uppercase rounded-[2px] cursor-pointer"
                >
                  SYNC MAP
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {mpState.status !== 'disconnected' && (
                  <button
                    type="button"
                    data-testid="mp-disconnect-btn"
                    onClick={() => {
                      simRef.current?.multiplayer?.disconnect();
                      setMpToast('Disconnected from lobby.');
                    }}
                    className="px-2.5 py-1.5 bg-[#dc2626] hover:bg-red-700 text-[#e5e5e5] border-2 border-[#444444] font-display font-bold text-[11px] uppercase rounded-[2px] cursor-pointer"
                  >
                    DISCONNECT
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowMultiplayerModal(false)}
                  className="px-3 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] font-display font-extrabold text-[11px] uppercase rounded-[2px] cursor-pointer"
                >
                  BACK TO GAME
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Micro:bit Scratch Studio Visual Modal */}
      <EcuScratchStudio
        isOpen={showEcuModal}
        onClose={() => {
          setShowEcuModal(false);
          const r = simRef.current?.getActiveRig();
          if (r) r.setHoveredPort(null);
        }}
        rig={simRef.current?.getActiveRig() || null}
        program={
          simRef.current?.getActiveRig()
            ? (simRef.current.getActiveRig().ecuPrograms[
                simRef.current.getActiveRig().activeEcuId || 'ECU_1'
              ] || Object.values(simRef.current.getActiveRig().ecuPrograms)[0])
            : undefined
        }
        onSaveProgram={(prog) => {
          const r = simRef.current?.getActiveRig();
          if (r) {
            const key = r.activeEcuId || 'ECU_1';
            r.ecuPrograms[key] = prog;
            r.saveIntactSnapshot();
          }
        }}
      />
      {/* =====================================================================
          UNIFIED NON-OVERLAPPING AUTO-EXPIRING TOAST & POPUP STACK
          - Controlled 1:1 by the 'toasts' (POPUPS & TOASTS) HUD widget
          ===================================================================== */}
      {!isScreenshotMode &&
        hudCustom.showToasts &&
        getWidgetState(hudCustom, 'toasts').visible && (
        <div
          data-testid="hud-toast-stack"
          data-hud-widget="toasts"
          data-hud-label="POPUPS & TOASTS"
          data-layout-mode={isMobilePopup ? 'mobile' : 'laptop'}
          style={{
            top: `${toastTopOffsetPx}px`,
            ...(getWidgetTransformStyle(
              hudCustom,
              'toasts',
              undefined,
              'top center',
              true,
            ) ?? {}),
          }}
          className={`fixed left-1/2 z-[95] flex flex-col items-stretch gap-1.5 ${
            isMobilePopup ? 'w-[250px]' : 'w-[310px]'
          } max-w-[calc(100vw-16px)] pointer-events-none`}
        >
          {/* Realistic Full-Size Popup Preview Card when HUD Editor is open so the edited box matches live toasts 1:1 */}
          {showHudEditorModal ? (
            <div
              data-testid="hud-editor-toast-placeholder"
              className="flex w-full bg-[#1a1a1a]/95 border-2 border-[#fbbf24] rounded-[2px] px-2.5 py-1.5 shadow-2xl items-center justify-between gap-2 min-h-[30px]"
            >
              <div className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden">
                <span className="px-1.5 py-0.5 bg-[#fbbf24] text-[#141414] font-display font-extrabold text-[8.5px] rounded-[2px] uppercase shrink-0">
                  POPUPS
                </span>
                <span className="text-[9.5px] font-mono-num text-[#e5e5e5] font-bold truncate">
                  ALERTS &amp; TOASTS ZONE
                </span>
              </div>
              <span className="w-4 h-4 shrink-0 flex items-center justify-center rounded-[2px] bg-[#262626] text-[#a3a3a3] border border-[#444444] text-[8.5px] font-mono-num font-bold">
                ✕
              </span>
            </div>
          ) : (
            <>
              {/* Teleport Engine Spinup Banner inside Popups & Toasts Stack */}
              {teleportState.activeSpinup && (
                <div
                  data-testid="teleport-spinup-banner"
                  className="w-full bg-[#1a1a1a] border-2 border-[#fbbf24] rounded-[2px] px-4 py-2 text-center pointer-events-none"
                >
                  <div className="text-[10.5px] font-display font-extrabold text-[#fbbf24] uppercase tracking-wider mb-1">
                    ENGINE TELEPORT SPINUP ({teleportState.activeSpinup.remainingSec.toFixed(1)}s) — HOLD STILL!
                  </div>
                  <div className="w-full h-2 bg-[#222222] rounded-[2px] overflow-hidden border border-[#444444] mb-1">
                    <div
                      className="h-full bg-[#fbbf24] transition-all duration-75"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((teleportState.activeSpinup.totalSec -
                              teleportState.activeSpinup.remainingSec) /
                              Math.max(0.01, teleportState.activeSpinup.totalSec)) *
                              100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="text-[9px] font-mono-num text-[#a3a3a3]">
                    Moving or taking combat damage will cancel fast travel
                  </div>
                </div>
              )}

              {/* 1. Post-Crash Impact Telemetry Toast */}
              {lastCrashTelemetry && gameState === 'playing' && !hud.isBuildMode && (
            <AutoDismissToast
              key={`crash-${lastCrashTelemetry.timestampMs}`}
              testId="crash-telemetry-card"
              durationMs={4500}
              accentColor="#f97316"
              isMobile={isMobilePopup}
              onDismiss={() => {
                dismissedCrashTimestampRef.current = lastCrashTelemetry.timestampMs;
                if (simRef.current) {
                  simRef.current.worldArenaSystems.lastCrashReport = null;
                }
                setLastCrashTelemetry(null);
              }}
            >
              {isMobilePopup ? (
                <div className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden">
                  <span className="px-1.5 py-0.5 bg-[#f97316] text-[#141414] font-display font-extrabold text-[9px] rounded-[2px] uppercase shrink-0">
                    CRASH
                  </span>
                  <span className="text-[10px]">
                    <strong className="text-[#facc15]">
                      {lastCrashTelemetry.peakSpeedKmh} KM/H
                    </strong>
                  </span>
                  <span className="text-[#52525b]">·</span>
                  <span className="text-[10px]">
                    <strong className="text-[#ef4444]">
                      {lastCrashTelemetry.peakGForce}G
                    </strong>
                  </span>
                  <span className="text-[#52525b]">·</span>
                  <span className="text-[10px]">
                    HULL{' '}
                    <strong className="text-[#38bdf8]">
                      {lastCrashTelemetry.hullIntegrityPct}%
                    </strong>
                  </span>
                  <span className="text-[#52525b]">·</span>
                  <span className="text-[10px]">
                    <strong className="text-[#fbbf24]">
                      -{lastCrashTelemetry.blocksDetached} BLK
                    </strong>
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-1.5 py-0.5 bg-[#f97316] text-[#141414] font-display font-extrabold text-[9.5px] rounded-[2px] uppercase">
                      IMPACT TELEMETRY
                    </span>
                    <span className="text-[10px] text-[#a3a3a3]">
                      STRUCTURAL SHOCK REPORT
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                    <span>
                      PEAK:{' '}
                      <strong className="text-[#facc15]">
                        {lastCrashTelemetry.peakSpeedKmh} KM/H
                      </strong>
                    </span>
                    <span>
                      G-LOAD:{' '}
                      <strong className="text-[#ef4444]">
                        {lastCrashTelemetry.peakGForce}G
                      </strong>
                    </span>
                    <span>
                      HULL:{' '}
                      <strong className="text-[#38bdf8]">
                        {lastCrashTelemetry.hullIntegrityPct}%
                      </strong>
                    </span>
                    <span>
                      DETACHED:{' '}
                      <strong className="text-[#fbbf24]">
                        {lastCrashTelemetry.blocksDetached} BLK
                      </strong>
                    </span>
                  </div>
                </div>
              )}
            </AutoDismissToast>
          )}

          {/* 2. Driver Seat Destroyed / Ejected Toast */}
          {gameState === 'playing' && !hud.hasIntactSeat && !seatAlertDismissed && (
            <AutoDismissToast
              testId="seat-destroyed-alert"
              durationMs={5500}
              accentColor="#dc2626"
              isMobile={isMobilePopup}
              onDismiss={() => setSeatAlertDismissed(true)}
            >
              <div
                className={
                  isMobilePopup
                    ? 'flex items-center justify-between gap-1.5'
                    : 'flex flex-col gap-1.5'
                }
              >
                <div className="flex items-center gap-1.5 font-bold min-w-0">
                  <span className="px-1.5 py-0.5 bg-[#dc2626] text-[#e5e5e5] font-display font-extrabold text-[9px] rounded-[2px] uppercase shrink-0">
                    SEAT DESTROYED
                  </span>
                  {!isMobilePopup && (
                    <span className="text-[11px] truncate">Ejected from vehicle!</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      simRef.current?.toggleHoverBuildMode(true);
                      setSeatAlertDismissed(true);
                    }}
                    className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[9.5px] cursor-pointer"
                  >
                    BUILD [B]
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      simRef.current?.flipSummonRig();
                      setSeatAlertDismissed(true);
                    }}
                    className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#4b5563] text-[#e5e5e5] border border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[9.5px] cursor-pointer"
                  >
                    REPAIR [R]
                  </button>
                </div>
              </div>
            </AutoDismissToast>
          )}

          {/* 3. Damage Diagram now renders permanently in non-overlapping corner slot */}

          {/* 4. "Last Build" Auto-Save / Crash Recovery Toast */}
          {pendingLastBuildRestore && (
            <AutoDismissToast
              testId="restore-last-build-modal"
              durationMs={7000}
              accentColor="#fbbf24"
              isMobile={isMobilePopup}
              onDismiss={() => {
                clearLastBuildAutoSave();
                setPendingLastBuildRestore(null);
              }}
            >
              <div
                className={
                  isMobilePopup
                    ? 'flex items-center justify-between gap-1.5'
                    : 'flex flex-col gap-1.5'
                }
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="px-1.5 py-0.5 bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[9px] rounded-[2px] uppercase shrink-0">
                    AUTO-SAVE
                  </span>
                  <span className="font-display font-extrabold text-[11px] uppercase text-[#e5e5e5] truncate">
                    Restore {pendingLastBuildRestore.blueprint.name || 'Last Rig'}?
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 shrink-0">
                  {!isMobilePopup && (
                    <span className="text-[10.5px] text-[#a3a3a3]">
                      {(pendingLastBuildRestore.blueprint.voxels?.length || 0) +
                        (pendingLastBuildRestore.blueprint.modules?.length || 0)}{' '}
                      blocks saved
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid="restore-last-build-no-btn"
                      onClick={() => {
                        clearLastBuildAutoSave();
                        setPendingLastBuildRestore(null);
                      }}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        clearLastBuildAutoSave();
                        setPendingLastBuildRestore(null);
                      }}
                      className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9.5px] font-display font-bold uppercase cursor-pointer touch-manipulation"
                    >
                      DISMISS
                    </button>
                    <button
                      type="button"
                      data-testid="restore-last-build-yes-btn"
                      onClick={() => {
                        const s = simRef.current;
                        if (s && pendingLastBuildRestore) {
                          s.loadSavedVehicle(pendingLastBuildRestore.blueprint);
                          SoundFX.snap();
                        }
                        setPendingLastBuildRestore(null);
                      }}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const s = simRef.current;
                        if (s && pendingLastBuildRestore) {
                          s.loadSavedVehicle(pendingLastBuildRestore.blueprint);
                          SoundFX.snap();
                        }
                        setPendingLastBuildRestore(null);
                      }}
                      className="px-2 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[9.5px] cursor-pointer touch-manipulation"
                    >
                      RESTORE
                    </button>
                  </div>
                </div>
              </div>
            </AutoDismissToast>
          )}

          {/* 5. Near-Vehicle Enter Prompt Toast */}
          {gameState === 'playing' &&
            !hud.isSeatedInRig &&
            hud.nearVehiclePrompt &&
            hud.hasIntactSeat &&
            !nearVehicleToastDismissed && (
              <AutoDismissToast
                testId="enter-vehicle-prompt"
                durationMs={4000}
                accentColor="#facc15"
                isMobile={isMobilePopup}
                onDismiss={() => setNearVehicleToastDismissed(true)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {isMobilePopup ? (
                      <>Tap to enter &amp; drive rig</>
                    ) : (
                      <>
                        Press <strong className="text-[#facc15]">[E]</strong> to enter &amp; drive rig
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      simRef.current?.toggleEnterExitRig();
                      setNearVehicleToastDismissed(true);
                    }}
                    className="px-2 py-0.5 bg-[#facc15] text-[#1a1a1a] font-display font-extrabold text-[10px] rounded-[2px] uppercase cursor-pointer shrink-0"
                  >
                    DRIVE [E]
                  </button>
                </div>
              </AutoDismissToast>
            )}

          {/* 6. Quick Save World Confirmation Toast */}
          {quickSaveToast && (
            <AutoDismissToast
              key={quickSaveToast}
              testId="quick-save-world-toast"
              durationMs={3200}
              accentColor="#22c55e"
              isMobile={isMobilePopup}
              onDismiss={() => setQuickSaveToast('')}
            >
              <div className="flex items-center gap-1.5 font-display font-bold text-[#4ade80]">
                <span>✓</span>
                <span className="truncate">{quickSaveToast}</span>
              </div>
            </AutoDismissToast>
          )}

          {/* 7. Beginner Proving Grounds Guide Toast */}
          {gameState === 'playing' &&
            showBeginnerGuide &&
            !hud.isBuildMode &&
            !hud.isWorldEditMode &&
            !hud.isObjectStudioMode &&
            ModRegistry.activeGameModeId === 'SANDBOX_FREEPLAY' && (
              <AutoDismissToast
                testId="beginner-proving-grounds-guide"
                durationMs={6000}
                accentColor="#fbbf24"
                isMobile={isMobilePopup}
                onDismiss={() => setShowBeginnerGuide(false)}
              >
                {isMobilePopup ? (
                  <div className="flex items-center gap-1.5 text-[10px] whitespace-nowrap overflow-hidden">
                    <span className="px-1.5 py-0.2 bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[9px] uppercase rounded-[2px] shrink-0">
                      ARENA
                    </span>
                    <span className="truncate">
                      Ahead: <strong className="text-[#4ade80]">Jump</strong> ·{' '}
                      <strong className="text-[#f97316]">Shredders</strong> ·{' '}
                      <strong className="text-[#38bdf8]">Loop</strong>
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 text-[10.5px]">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[9px] uppercase rounded-[2px]">
                        PROVING GROUNDS
                      </span>
                      <span className="text-[#a3a3a3]">Lanes ahead:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>
                        <strong className="text-[#4ade80]">[W]</strong> Jump &amp; Pins
                      </span>
                      <span>
                        <strong className="text-[#f97316]">[A]</strong> Shredders
                      </span>
                      <span>
                        <strong className="text-[#38bdf8]">[D]</strong> Loop-de-Loop
                      </span>
                    </div>
                  </div>
                )}
              </AutoDismissToast>
            )}

          {/* 8. Building Challenge Result Toast */}
          {buildingChallengeResult && (
            <AutoDismissToast
              testId="building-challenge-result-modal"
              durationMs={7500}
              accentColor={
                buildingChallengeResult.evalResult.passed ? '#fbbf24' : '#dc2626'
              }
              isMobile={isMobilePopup}
              onDismiss={() => setBuildingChallengeResult(null)}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    data-testid="building-challenge-verdict-badge"
                    className={`px-2 py-0.5 font-display font-extrabold text-[9.5px] uppercase rounded-[2px] ${
                      buildingChallengeResult.evalResult.passed
                        ? 'bg-[#fbbf24] text-[#1a1a1a]'
                        : 'bg-[#dc2626] text-[#e5e5e5]'
                    }`}
                  >
                    {buildingChallengeResult.evalResult.passed
                      ? 'CHALLENGE PASSED'
                      : 'CHALLENGE FAILED'}
                  </span>
                  <span className="text-[10px] font-mono-num text-[#fbbf24] font-bold">
                    {buildingChallengeResult.evalResult.metricsBadge}
                  </span>
                </div>
                <div className="font-display font-bold text-[11px] text-[#e5e5e5] uppercase truncate">
                  {buildingChallengeResult.promptTitle} —{' '}
                  {buildingChallengeResult.evalResult.headline}
                </div>
                {!isMobilePopup && (
                  <div className="text-[10.5px] text-[#a3a3a3]">
                    {buildingChallengeResult.evalResult.detail}
                  </div>
                )}
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx =
                        (buildingChallengePromptIdx + 1) %
                        BUILDING_CHALLENGE_PROMPTS.length;
                      buildingChallengePromptIdxRef.current = nextIdx;
                      setBuildingChallengePromptIdx(nextIdx);
                      setBuildingChallengeTimerSec(300);
                      setBuildingChallengeResult(null);
                      simRef.current?.toggleHoverBuildMode(true);
                    }}
                    className="px-2 py-0.5 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9.5px] font-display font-bold uppercase cursor-pointer"
                  >
                    NEXT PROMPT
                  </button>
                  <button
                    type="button"
                    data-testid="close-building-challenge-result-btn"
                    onClick={() => setBuildingChallengeResult(null)}
                    className="px-2.5 py-0.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border border-[#444444] font-display font-extrabold uppercase rounded-[2px] text-[9.5px] cursor-pointer"
                  >
                    DONE
                  </button>
                </div>
              </div>
            </AutoDismissToast>
          )}
            </>
          )}
        </div>
      )}

      {/* =====================================================================
          FULL-SCREEN MAP OVERLAY ([F] KEY)
          ===================================================================== */}
      {showFastTravelMap && !isScreenshotMode && (
        <FullScreenMap
          isOpen={showFastTravelMap}
          onClose={() => setShowFastTravelMap(false)}
          world={simRef.current?.world ?? null}
          vehicles={simRef.current?.creations ?? []}
          localVehicle={simRef.current?.getActiveRig() ?? null}
          isSeatedInRig={Boolean(simRef.current?.isSeatedInRig ?? hud.isSeatedInRig)}
          localPlayerPos={
            simRef.current
              ? simRef.current.isSeatedInRig
                ? {
                    x: simRef.current.getActiveRig().position.x,
                    y: simRef.current.getActiveRig().position.y,
                    z: simRef.current.getActiveRig().position.z,
                  }
                : {
                    x: simRef.current.playerCharacterMesh.position.x,
                    y: simRef.current.playerCharacterMesh.position.y,
                    z: simRef.current.playerCharacterMesh.position.z,
                  }
              : { x: 0, y: 0, z: 0 }
          }
          localPlayerYawRad={simRef.current?.camYaw ?? 0}
          localPlayerName={mpState.playerName}
          localPlayerColor={mpState.playerColor}
          remotePlayers={mpState.players}
          camera={simRef.current?.camera ?? null}
          tacticalCamState={simRef.current?.tacticalMapCam}
          tacticalGridVisible={simRef.current?.tacticalGridVisible ?? true}
          onToggleGrid={() => {
            if (simRef.current) {
              simRef.current.setTacticalGridVisible(!simRef.current.tacticalGridVisible);
            }
          }}
          onPanTacticalMap={(dx, dz) => simRef.current?.panTacticalMap(dx, dz)}
          onZoomTacticalMap={(factor) => simRef.current?.zoomTacticalMap(factor)}
          onSetTacticalMapAltitude={(alt) => simRef.current?.setTacticalMapAltitude(alt)}
          onSetTacticalMapTopDown={(td) => simRef.current?.setTacticalMapTopDown(td)}
          onCenterTacticalMapOnPlayer={() => simRef.current?.centerTacticalMapOnPlayer()}
          onFocusTacticalMapOn={(wx, wz) => simRef.current?.focusTacticalMapOn(wx, wz)}
          teleportNodes={teleportState.nodes}
          maxTeleportNodes={MAX_TELEPORT_NODES}
          combatCooldownSec={getCombatCooldownRemainingSec(teleportState, Date.now())}
          activeSpinupNodeId={teleportState.activeSpinup?.targetNodeId ?? null}
          spinupProgress={
            teleportState.activeSpinup
              ? 1 -
                teleportState.activeSpinup.remainingSec /
                  Math.max(0.01, teleportState.activeSpinup.totalSec)
              : 0
          }
          newBeaconNameInput={newBeaconNameInput}
          onChangeBeaconNameInput={setNewBeaconNameInput}
          onPlaceBeaconAtCoords={handlePlaceTeleportBeaconAtCoords}
          onPlaceBeaconAtPlayer={handlePlaceTeleportBeaconAtPlayer}
          onDropBeaconHere={(name) => {
            if (name) {
              const sim = simRef.current;
              const pos = sim
                ? sim.isSeatedInRig
                  ? sim.getActiveRig().position
                  : sim.camFreePos
                : { x: 0, z: 0 };
              handlePlaceTeleportBeaconAtCoords(pos.x, pos.z, name);
            } else {
              handlePlaceTeleportBeaconAtPlayer();
            }
          }}
          onTeleportToNode={handleRequestTeleportToNode}
          onTeleportToCoords={(x, y, z) => {
            executeImmediateVehicleTeleport(x, y, z);
            setShowFastTravelMap(false);
          }}
          onDeleteTeleportNode={handleDeleteTeleportNode}
          onRemoveBeacon={handleDeleteTeleportNode}
        />
      )}

      {/* Mobile Touch Controls Overlay (Automatically paused whenever any modal or map is open so touch events never block modal buttons!) */}
      <LiveMobileTouchControls
        sim={simRef.current}
        isBuildMode={hud.isBuildMode}
        isWorldEditMode={hud.isWorldEditMode}
        isSeatedInRig={hud.isSeatedInRig}
        active={
          (gameState === 'playing' || showHudEditorModal) &&
          !isScreenshotMode &&
          !showFastTravelMap &&
          !showGarageModal &&
          !showModStudioModal &&
          !showAiFleetModal &&
          !showWorldGenModal &&
          !showChooseMapModal &&
          !showMultiplayerModal &&
          !showEcuModal
        }
        onOpenGarage={() => {
          setBlueprintNameInput(hud.presetName);
          setGarageFeedback('');
          setShowGarageModal(true);
        }}
        onOpenPause={() => simRef.current?.pauseGame()}
        onOpenEcu={() => setShowEcuModal(true)}
        onOpenMap={() => {
          simRef.current?.initTacticalMapCam();
          setShowFastTravelMap(true);
        }}
        onOpenWorldGen={() => {
          setWorldGenFeedback('');
          setShowWorldGenModal(true);
        }}
        onOpenModStudio={() => {
          setModStudioFeedback('');
          setShowModStudioModal(true);
        }}
        onOpenAiFleet={() => setShowAiFleetModal(true)}
        onOpenHudEditor={() => setShowHudEditorModal(true)}
        onPopupStateChange={setMobilePopupOpen}
        hudCustom={hudCustom}
        registerPreviewSlot={(itemKey, el) => {
          if (el) {
            let set = slotElementsRef.current.get(itemKey);
            if (!set) {
              set = new Set();
              slotElementsRef.current.set(itemKey, set);
            }
            set.add(el);
          }
        }}
        getItemPreviewKey={(item) => previewRenderer.getItemKey(item)}
        showTopBar={hudCustom.showTopBar}
        topBarScale={hudCustom.topBarScale * hudCustom.globalUiScale}
        controlsScale={hudCustom.mobileControlsScale * hudCustom.globalUiScale}
        showLeftControls={hudCustom.showMobileLeftControls}
        showRightControls={hudCustom.showMobileRightControls}
        topBarStyle={getWidgetTransformStyle(
          hudCustom,
          'top-bar',
          undefined,
          'top left',
        )}
        leftControlsStyle={getWidgetTransformStyle(
          hudCustom,
          'mobile-left-controls',
          undefined,
          'bottom left',
        )}
        rightControlsStyle={getWidgetTransformStyle(
          hudCustom,
          'mobile-right-controls',
          undefined,
          'bottom right',
        )}
      />

      {/* Interactive Image-Editor-Style HUD Layout Studio Modal (Works on Mobile & Laptop) */}
      <HudLayoutEditorModal
        open={showHudEditorModal}
        isMobile={isMobilePopup || isMobileHud}
        settings={hudCustom}
        onUpdateSettings={updateHudCustom}
        onResetSettings={resetHudCustom}
        onClose={() => setShowHudEditorModal(false)}
      />

      {/* Real-Time Performance Diagnostic Overlay (only visible when ?debug=1 is passed) */}
      {typeof window !== 'undefined' && window.location.search.includes('debug=1') && (
        <pre
          ref={perfOverlayRef}
          data-testid="perf-profiler-overlay"
          className="fixed top-2 left-2 z-[9999] pointer-events-none select-none m-0 px-2.5 py-2 rounded bg-black/80 text-emerald-400 border border-white/15 font-mono text-[11px] leading-[1.35] whitespace-pre shadow-lg"
        >
          PERF PROFILER — waiting for frames...
        </pre>
      )}
    </div>
  );
}
