import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  BUILD_SLOTS,
  OBJECT_STUDIO_SLOTS,
  PLAY_SLOTS,
  PLACEMENT_MODES,
  MAT,
  MAT_INFO,
  type BuildSlotItem,
  type PlaySlotItem,
  type WorldEditToolKind,
} from './constants';
import { PREBUILT_OBJECTS } from './worldObjects';
import { MAP_HAZARD_PRESETS } from './mapHazards';
import { VOXEL_ENTITY_PRESETS } from './voxelEntities';
import {
  isMobileDevice,
  getMobileDriveScheme,
  setMobileDriveScheme,
  setTouchModeOverride,
  computeAnalogTouchDriveInput,
  computeAnalogSliderSteer,
  triggerTouchHaptic,
  computeTouchOrbitCameraState,
  shouldShowMobileCenterReticle,
  type MobileDriveControlScheme,
} from './touchControls';
import {
  type HudCustomSettings,
  DEFAULT_HUD_CUSTOM_SETTINGS,
  getWidgetState,
  getWidgetTransformStyle,
} from './ui/hudCustomization';

interface MobileTouchControlsProps {
  sim: any;
  isBuildMode: boolean;
  isWorldEditMode?: boolean;
  isSeatedInRig: boolean;
  active: boolean;
  speedKmh?: number;
  integrityPct?: number;
  onOpenGarage?: () => void;
  onOpenPause?: () => void;
  onOpenEcu?: () => void;
  onOpenMap?: () => void;
  onOpenWorldGen?: () => void;
  onOpenModStudio?: () => void;
  onOpenAiFleet?: () => void;
  registerPreviewSlot?: (itemKey: string, el: HTMLElement | null) => void;
  getItemPreviewKey?: (item: BuildSlotItem) => string;
  showTopBar?: boolean;
  topBarScale?: number;
  controlsScale?: number;
  showLeftControls?: boolean;
  showRightControls?: boolean;
  topBarStyle?: React.CSSProperties;
  leftControlsStyle?: React.CSSProperties;
  rightControlsStyle?: React.CSSProperties;
  hudCustom?: HudCustomSettings;
  onOpenHudEditor?: () => void;
  onPopupStateChange?: (isOpen: boolean) => void;
}

type MobileBuildCategory =
  | 'ALL'
  | 'BLOCKS'
  | 'SEATS'
  | 'ENGINES'
  | 'WHEELS'
  | 'MECH'
  | 'AERO'
  | 'WEAPONS'
  | 'LOGIC';

const MOBILE_CATEGORIES: Array<{ id: MobileBuildCategory; label: string }> = [
  { id: 'ALL', label: 'ALL' },
  { id: 'BLOCKS', label: 'BLOCKS' },
  { id: 'SEATS', label: 'SEATS' },
  { id: 'ENGINES', label: 'ENGINES' },
  { id: 'WHEELS', label: 'WHEELS' },
  { id: 'MECH', label: 'MECH' },
  { id: 'AERO', label: 'AERO' },
  { id: 'WEAPONS', label: 'WEAPONS' },
  { id: 'LOGIC', label: 'LOGIC' },
];

const WORLD_EDIT_TOOLS: Array<{ id: WorldEditToolKind; label: string }> = [
  { id: 'PLACE_PROP', label: 'PROPS' },
  { id: 'PLACE_OBJECT', label: 'STAMP' },
  { id: 'SPAWN_MAP_HAZARD', label: 'HAZARD' },
  { id: 'SPAWN_VOXEL_ENTITY', label: 'ENTITY' },
  { id: 'TERRA_RAISE', label: 'RAISE' },
  { id: 'TERRA_LOWER', label: 'LOWER' },
  { id: 'TERRA_FLATTEN', label: 'FLAT' },
  { id: 'TERRA_RAMP', label: 'RAMP' },
  { id: 'TERRA_PAINT', label: 'PAINT' },
];

const MOBILE_TERRA_MATERIALS: Array<{ mat: number; name: string }> = [
  { mat: MAT.GRASS, name: 'GRASS' },
  { mat: MAT.ASPHALT, name: 'ASPHALT' },
  { mat: MAT.SAND, name: 'SAND' },
  { mat: MAT.ROCK, name: 'ROCK' },
  { mat: MAT.CONCRETE, name: 'CONCRETE' },
  { mat: MAT.RAMP_ORANGE, name: 'STUNT' },
  { mat: MAT.ICE_SLICK, name: 'ICE' },
  { mat: MAT.MAGMA_CORE, name: 'MAGMA' },
  { mat: MAT.WATER_VOX, name: 'WATER' },
];

const MOBILE_PROP_MATERIALS: Array<{ mat: number; name: string }> = [
  { mat: MAT.RAMP_ORANGE, name: 'STUNT' },
  { mat: MAT.STEEL, name: 'STEEL' },
  { mat: MAT.CONCRETE, name: 'CONC' },
  { mat: MAT.BRICK, name: 'BRICK' },
  { mat: MAT.WOOD, name: 'WOOD' },
  { mat: MAT.C4_EXPLOSIVE, name: 'C4 TNT' },
  { mat: MAT.FLOAT_YELLOW, name: 'FLOAT' },
  { mat: MAT.NEON_CYAN, name: 'NEON' },
  { mat: MAT.CHROME_SILVER, name: 'CHROME' },
  { mat: MAT.MAGMA_CORE, name: 'MAGMA' },
];

const PLACEMENT_MODE_SHORT_LABELS: Record<string, string> = {
  SINGLE: '1×1 SINGLE',
  BOX_DRAG: 'RECT BOX',
  LINE_DRAG: 'LINE DRAG',
  BEAM_6: '6-BEAM',
  WALL_3X3: '3×3 WALL',
  RAMP_3X3: '5×5 RAMP',
  CONTINUOUS: 'CONTINUOUS',
  PAINT_REPLACE: 'PAINT MODE',
};

export const MobileTouchControls: React.FC<MobileTouchControlsProps> = ({
  sim,
  isBuildMode,
  isWorldEditMode = false,
  isSeatedInRig,
  active,
  speedKmh = 0,
  integrityPct = 100,
  onOpenGarage,
  onOpenPause,
  onOpenEcu,
  onOpenMap,
  onOpenWorldGen,
  onOpenModStudio,
  onOpenAiFleet,
  registerPreviewSlot,
  getItemPreviewKey,
  showTopBar = true,
  topBarScale = 1.0,
  controlsScale = 1.0,
  showLeftControls = true,
  showRightControls = true,
  topBarStyle,
  leftControlsStyle,
  rightControlsStyle,
  hudCustom = DEFAULT_HUD_CUSTOM_SETTINGS,
  onOpenHudEditor,
  onPopupStateChange,
}) => {
  const [isTouch, setIsTouch] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<MobileBuildCategory>('ALL');
  const [activeSlot, setActiveSlot] = useState<number>(1);
  const [recentBuildSlots, setRecentBuildSlots] = useState<number[]>([1, 2, 13, 18]);
  const [canEnterVehicle, setCanEnterVehicle] = useState(false);
  const [driveScheme, setDriveScheme] = useState<MobileDriveControlScheme>(() =>
    getMobileDriveScheme(),
  );
  const [cruiseLocked, setCruiseLocked] = useState(false);
  const [tapToPlaceMode, setTapToPlaceMode] = useState(false);
  const [buildFlyStickEnabled, setBuildFlyStickEnabled] = useState(false);
  const [steerSliderVal, setSteerSliderVal] = useState(0); // [-1..1] visual indicator

  // Consolidated Popup & Drawer States (All closed at rest for 70%+ viewport visibility!)
  const [menuPopupOpen, setMenuPopupOpen] = useState(false);
  const [placementDropdownOpen, setPlacementDropdownOpen] = useState(false);
  const [editPopupOpen, setEditPopupOpen] = useState(false);
  const [partsDrawerOpen, setPartsDrawerOpen] = useState(false);
  const [worldCatalogOpen, setWorldCatalogOpen] = useState(false);
  const [driveActionsPopupOpen, setDriveActionsPopupOpen] = useState(false);

  useEffect(() => {
    const anyPopup =
      menuPopupOpen ||
      placementDropdownOpen ||
      editPopupOpen ||
      driveActionsPopupOpen ||
      worldCatalogOpen;
    onPopupStateChange?.(anyPopup);
  }, [
    menuPopupOpen,
    placementDropdownOpen,
    editPopupOpen,
    driveActionsPopupOpen,
    worldCatalogOpen,
    onPopupStateChange,
  ]);

  const [rigCapabilities, setRigCapabilities] = useState({
    hasCannons: false,
    hasMelee: false,
    hasPistons: false,
    hasWinch: false,
    hasGyro: false,
    hasFlight: false,
    hasSubmarine: false,
    pistonExtended: false,
    winchActive: false,
    gyroEnabled: true,
    mirrorMode: false,
    showForcesOverlay: false,
    isObjectStudioMode: false,
    objectStudioMat: MAT.RAMP_ORANGE as number,
    undoCount: 0,
    placementMode: 'SINGLE',
    worldEditTool: 'PLACE_OBJECT' as WorldEditToolKind,
    terraBrushRadius: 8,
    terraPaintMat: MAT.GRASS as number,
    selectedObjectId: 'stunt_ramp_kicker',
    selectedMapHazardId: 'SPINNING_SAW',
    selectedVoxelEntityId: 'EXPLOSIVE_CRATE',
    propPhysicsMode: 'DYNAMIC',
  });

  // Floating + Anchored Joystick State
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickOrigin, setJoystickOrigin] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fixedJoystickPadRef = useRef<HTMLDivElement | null>(null);
  const [stickOffset, setStickOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const leftTouchId = useRef<number | null>(null);
  const leftPointerActiveRef = useRef(false);

  // Right Camera Drag + 2-Finger Pinch Zoom Tracking
  const rightTouchId = useRef<number | null>(null);
  const rightLastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rightStartPos = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
  const lastRightTapTimeRef = useRef<number>(0);
  const steerBarRef = useRef<HTMLDivElement | null>(null);
  const steerBarTouchIdRef = useRef<number | null>(null);
  const steerBarPointerActiveRef = useRef<boolean>(false);
  const pedalThrottleRef = useRef<number>(0);
  const pinchDistRef = useRef<number | null>(null);
  const cameraDeltaAccumulator = useRef<{ dx: number; dy: number; pinchDelta: number }>({
    dx: 0,
    dy: 0,
    pinchDelta: 0,
  });
  const cameraRafId = useRef<number | null>(null);

  // Detect mobile device or manual Touch UI override
  useEffect(() => {
    const check = () => {
      setIsTouch(isMobileDevice());
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('voxelmakers-touch-mode-change', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('voxelmakers-touch-mode-change', check);
    };
  }, []);

  // Auto-focus camera on vehicle when entering Build Mode and close transient popups
  useEffect(() => {
    setMenuPopupOpen(false);
    setPlacementDropdownOpen(false);
    setEditPopupOpen(false);
    setPartsDrawerOpen(false);
    setWorldCatalogOpen(false);
    setDriveActionsPopupOpen(false);
    if (isBuildMode && sim?.focusBuildCamera) {
      sim.focusBuildCamera();
    }
  }, [isBuildMode, isWorldEditMode, isSeatedInRig, sim]);

  // Poll vehicle capabilities & active slot at low frequency (8Hz)
  useEffect(() => {
    if (!active || !isTouch) return;
    const interval = setInterval(() => {
      if (sim) {
        if (typeof sim.selectedSlot === 'number') {
          setActiveSlot(sim.selectedSlot);
        }
        if (typeof sim.canEnterVehicle === 'function') {
          setCanEnterVehicle(sim.canEnterVehicle());
        } else if (!isSeatedInRig && !isBuildMode && typeof sim.getClosestCreation === 'function') {
          const closest = sim.getClosestCreation(sim.camFreePos);
          setCanEnterVehicle(Boolean(closest && closest.dist <= 8.5 && closest.rig?.hasIntactSeat?.()));
        }
        const rig = sim.getActiveRig?.() || sim.rig;
        if (rig) {
          const hasSub = Array.isArray(rig.modules)
            ? rig.modules.some((m: any) => m.kind === 'BCD_TANK' || m.kind === 'SEAT_DIVING')
            : false;
          const hasMelee = Array.isArray(rig.modules)
            ? rig.modules.some((m: any) => m.kind === 'WEAPON_MELEE' && (m.health ?? 1) > 0)
            : false;
          const nextCaps = {
            hasCannons: (rig.cannonCount || 0) > 0,
            hasMelee,
            hasPistons: (rig.pistonCount || 0) > 0,
            hasWinch: (rig.winchCount || 0) > 0,
            hasGyro: (rig.gyroCount || 0) > 0,
            hasFlight:
              (rig.vtolCount || 0) > 0 ||
              (rig.wingCount || 0) > 0 ||
              (rig.propCount || 0) > 0,
            hasSubmarine: hasSub,
            pistonExtended: Boolean(rig.pistonExtended),
            winchActive: Boolean(rig.winchActive),
            gyroEnabled: Boolean(rig.gyroEnabled),
            mirrorMode: Boolean(rig.mirrorMode ?? sim.mirrorMode),
            showForcesOverlay: Boolean(rig.showForcesOverlay),
            isObjectStudioMode: Boolean(sim.isObjectStudioMode),
            objectStudioMat: sim.objectStudioMat || MAT.RAMP_ORANGE,
            undoCount: Array.isArray(rig.undoStack)
              ? rig.undoStack.length
              : Array.isArray(sim.undoStack)
                ? sim.undoStack.length
                : 0,
            placementMode: sim.placementMode || 'SINGLE',
            worldEditTool: sim.worldEditTool || 'PLACE_OBJECT',
            terraBrushRadius: sim.terraBrushRadius || 8,
            terraPaintMat: sim.terraPaintMat || MAT.GRASS,
            selectedObjectId: sim.selectedObjectId || 'stunt_ramp_kicker',
            selectedMapHazardId: sim.selectedMapHazardId || 'SPINNING_SAW',
            selectedVoxelEntityId: sim.selectedVoxelEntityId || 'EXPLOSIVE_CRATE',
            propPhysicsMode: sim.propPhysicsMode || 'DYNAMIC',
          };
          setRigCapabilities((prev) => {
            for (const k of Object.keys(nextCaps) as Array<keyof typeof nextCaps>) {
              if (prev[k] !== nextCaps[k]) {
                return nextCaps;
              }
            }
            return prev;
          });
        }
      }
    }, 125);
    return () => clearInterval(interval);
  }, [sim, active, isTouch, isSeatedInRig, isBuildMode]);

  // Reset analog inputs when leaving driving mode or when controls become inactive (e.g. modal opened)
  useEffect(() => {
    if (!active) {
      setMenuPopupOpen(false);
      setPlacementDropdownOpen(false);
      setEditPopupOpen(false);
      setPartsDrawerOpen(false);
      setWorldCatalogOpen(false);
      setDriveActionsPopupOpen(false);
      setJoystickActive(false);
      setStickOffset({ x: 0, y: 0 });
      leftTouchId.current = null;
      rightTouchId.current = null;
    }
    if (!active || !isSeatedInRig || isBuildMode || isWorldEditMode) {
      setCruiseLocked(false);
      setSteerSliderVal(0);
      pedalThrottleRef.current = 0;
      const rig = sim?.getActiveRig?.() || sim?.rig;
      if (rig) {
        rig.touchSteerInput = 0;
        rig.touchThrottleInput = 0;
        rig.touchPitchInput = 0;
      }
    }
  }, [sim, active, isSeatedInRig, isBuildMode, isWorldEditMode]);

  // RequestAnimationFrame camera update loop with true 3D spherical orbit in Build Mode + Pinch-to-Zoom
  const flushCameraDelta = useCallback(() => {
    if (!sim) {
      cameraDeltaAccumulator.current = { dx: 0, dy: 0, pinchDelta: 0 };
      cameraRafId.current = null;
      return;
    }

    const { dx, dy, pinchDelta } = cameraDeltaAccumulator.current;
    if (dx !== 0 || dy !== 0 || pinchDelta !== 0) {
      cameraDeltaAccumulator.current = { dx: 0, dy: 0, pinchDelta: 0 };
      const sensitivity = 0.0055;

      if (sim.isBuildMode) {
        const nextOrbit = computeTouchOrbitCameraState(
          sim.buildOrbitPivot,
          sim.camYaw,
          sim.camPitch,
          sim.buildOrbitDist,
          dx,
          dy,
          pinchDelta,
          sensitivity,
        );
        sim.camYaw = nextOrbit.camYaw;
        sim.camPitch = nextOrbit.camPitch;
        sim.buildOrbitDist = nextOrbit.buildOrbitDist;
        sim.camFreePos.set(
          nextOrbit.camFreePos.x,
          nextOrbit.camFreePos.y,
          nextOrbit.camFreePos.z,
        );
      } else if (sim.isWorldEditMode) {
        sim.camYaw -= dx * sensitivity;
        sim.camPitch = Math.max(
          -1.42,
          Math.min(1.42, sim.camPitch - dy * sensitivity),
        );
        if (pinchDelta !== 0 && sim.camera) {
          const fwd = sim.camera.getWorldDirection(sim.camFreePos.clone().set(0, 0, -1));
          sim.camFreePos.addScaledVector(fwd, -pinchDelta * 1.2);
        }
      } else if (!sim.isSeatedInRig) {
        const walkYawSens = 0.0068;
        const walkPitchSens = 0.0052;
        sim.camYaw -= dx * walkYawSens;
        sim.camPitch = Math.max(
          -1.18,
          Math.min(0.95, sim.camPitch - dy * walkPitchSens),
        );
      } else {
        sim.driveYawOffset -= dx * sensitivity;
        sim.drivePitchOffset = Math.max(
          -0.2,
          Math.min(1.25, sim.drivePitchOffset + dy * sensitivity * 0.9),
        );
        if (pinchDelta !== 0) {
          sim.driveOrbitDist = Math.max(
            4.5,
            Math.min(28.0, (sim.driveOrbitDist || 9.4) + pinchDelta),
          );
        }
        sim.lastMouseMoveTime = performance.now();
      }
    }
    cameraRafId.current = null;
  }, [sim]);

  const scheduleCameraUpdate = useCallback(() => {
    if (cameraRafId.current === null) {
      cameraRafId.current = requestAnimationFrame(flushCameraDelta);
    }
  }, [flushCameraDelta]);

  useEffect(() => {
    return () => {
      if (cameraRafId.current !== null) {
        cancelAnimationFrame(cameraRafId.current);
        cameraRafId.current = null;
      }
    };
  }, []);

  // If not on mobile/touch, return null immediately with 0 DOM footprint
  if (!active || !isTouch) return null;

  const setSimKey = (key: string, val: boolean) => {
    if (sim && sim.keys) {
      sim.keys[key] = val;
    }
  };

  const setAnalogSteer = (val: number) => {
    setSteerSliderVal(val);
    const rig = sim?.getActiveRig?.() || sim?.rig;
    if (rig) {
      rig.touchSteerInput = val;
    }
    if (sim && sim.keys) {
      sim.keys['KeyA'] = val > 0.14;
      sim.keys['KeyD'] = val < -0.14;
    }
  };

  const setAnalogThrottle = (val: number) => {
    const rig = sim?.getActiveRig?.() || sim?.rig;
    if (rig) {
      rig.touchThrottleInput = val;
    }
    if (sim && sim.keys) {
      sim.keys['KeyW'] = val > 0.14;
      sim.keys['KeyS'] = val < -0.14;
    }
  };

  const setAnalogPitch = (val: number) => {
    const rig = sim?.getActiveRig?.() || sim?.rig;
    if (rig) {
      rig.touchPitchInput = val;
    }
    if (sim && sim.keys) {
      sim.keys['KeyI'] = val > 0.14;
      sim.keys['KeyK'] = val < -0.14;
    }
  };

  const toggleScheme = () => {
    const next: MobileDriveControlScheme =
      driveScheme === 'PEDALS_STEER' ? 'JOYSTICK' : 'PEDALS_STEER';
    setDriveScheme(next);
    setMobileDriveScheme(next);
    setAnalogSteer(0);
    setAnalogThrottle(0);
    setCruiseLocked(false);
    setSimKey('KeyW', false);
    setSimKey('KeyS', false);
    setSimKey('KeyA', false);
    setSimKey('KeyD', false);
  };

  const closeAllPopups = () => {
    setMenuPopupOpen(false);
    setPlacementDropdownOpen(false);
    setEditPopupOpen(false);
    setPartsDrawerOpen(false);
    setWorldCatalogOpen(false);
    setDriveActionsPopupOpen(false);
  };

  // Filter build items for the slide-up 35% height parts drawer
  const getFilteredBuildSlots = (): BuildSlotItem[] => {
    const list = BUILD_SLOTS;
    switch (selectedCategory) {
      case 'BLOCKS':
        return list.filter(
          (i) => i.type === 'voxel' || i.category === 'CHASSIS' || i.category === 'COSMETICS',
        );
      case 'SEATS':
        return list.filter((i) => i.category === 'SEATS');
      case 'ENGINES':
        return list.filter((i) => i.category === 'PROPULSION');
      case 'WHEELS':
        return list.filter((i) => i.category === 'WHEELS');
      case 'MECH':
        return list.filter((i) => i.category === 'MECHANICAL');
      case 'AERO':
        return list.filter((i) => i.category === 'AERODYNAMICS');
      case 'WEAPONS':
        return list.filter((i) => i.category === 'WEAPONS');
      case 'LOGIC':
        return list.filter((i) => i.category === 'LOGIC');
      default:
        return list;
    }
  };

  // ==========================================
  // LEFT VIRTUAL JOYSTICK HANDLERS (TOUCH + POINTER)
  // ==========================================
  const applyJoystickVector = (clientX: number, clientY: number) => {
    const origin = joystickOriginRef.current;
    const dx = clientX - origin.x;
    const dy = clientY - origin.y;
    const rect = fixedJoystickPadRef.current?.getBoundingClientRect();
    const maxRadius = rect && rect.width > 10 ? Math.max(24, rect.width * 0.46) : 46;

    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);

    const normX = dist > 2 ? (Math.cos(angle) * clampedDist) / maxRadius : 0;
    const normY = dist > 2 ? (Math.sin(angle) * clampedDist) / maxRadius : 0;

    setStickOffset({ x: normX * 28, y: normY * 28 });

    if (isSeatedInRig && !isBuildMode && !isWorldEditMode) {
      const analog = computeAnalogTouchDriveInput(normX, normY, 0.14);
      setAnalogSteer(analog.steer);
      if (!cruiseLocked && pedalThrottleRef.current === 0) {
        setAnalogThrottle(analog.throttle);
      }
    } else if (sim && sim.keys) {
      const deadzone = 0.2;
      sim.keys['KeyW'] = normY < -deadzone;
      sim.keys['KeyS'] = normY > deadzone;
      sim.keys['KeyA'] = normX < -deadzone;
      sim.keys['KeyD'] = normX > deadzone;
    }
  };

  const beginJoystickAt = (clientX: number, clientY: number) => {
    let originX = clientX;
    let originY = clientY;
    if (fixedJoystickPadRef.current) {
      const rect = fixedJoystickPadRef.current.getBoundingClientRect();
      if (rect.width > 4 && rect.height > 4) {
        originX = rect.left + rect.width * 0.5;
        originY = rect.top + rect.height * 0.5;
      }
    }
    joystickOriginRef.current = { x: originX, y: originY };
    setJoystickOrigin({ x: originX, y: originY });
    setJoystickActive(true);
    applyJoystickVector(clientX, clientY);
  };

  const releaseJoystick = () => {
    leftTouchId.current = null;
    leftPointerActiveRef.current = false;
    setJoystickActive(false);
    setStickOffset({ x: 0, y: 0 });
    setAnalogSteer(0);
    if (!cruiseLocked && pedalThrottleRef.current === 0) {
      setAnalogThrottle(0);
    }
    if (sim && sim.keys) {
      if (pedalThrottleRef.current === 0 && !cruiseLocked) {
        sim.keys['KeyW'] = false;
        sim.keys['KeyS'] = false;
      }
      sim.keys['KeyA'] = false;
      sim.keys['KeyD'] = false;
    }
  };

  const handleLeftTouchZoneStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (leftTouchId.current !== null) return;
    const touch = e.changedTouches[0];
    leftTouchId.current = touch.identifier;
    beginJoystickAt(touch.clientX, touch.clientY);
  };

  const handleLeftTouchZoneMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === leftTouchId.current) {
        applyJoystickVector(touch.clientX, touch.clientY);
        break;
      }
    }
  };

  const handleLeftTouchZoneEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === leftTouchId.current) {
        releaseJoystick();
        break;
      }
    }
  };

  const handleLeftPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    leftPointerActiveRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    beginJoystickAt(e.clientX, e.clientY);
  };

  const handleLeftPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || !leftPointerActiveRef.current) return;
    e.preventDefault();
    applyJoystickVector(e.clientX, e.clientY);
  };

  const handleLeftPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || !leftPointerActiveRef.current) return;
    e.preventDefault();
    releaseJoystick();
  };

  // ==========================================
  // RIGHT CAMERA ORBIT + PINCH ZOOM + TAP-TO-PLACE HANDLERS
  // ==========================================
  const handleRightTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (menuPopupOpen || placementDropdownOpen || editPopupOpen || driveActionsPopupOpen) {
      closeAllPopups();
    }
    if (e.targetTouches.length >= 2) {
      const t0 = e.targetTouches[0];
      const t1 = e.targetTouches[1];
      pinchDistRef.current = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      return;
    }
    if (rightTouchId.current !== null) return;
    const touch = e.changedTouches[0];
    if (!touch || touch.identifier === leftTouchId.current) return;
    rightTouchId.current = touch.identifier;
    rightLastPos.current = { x: touch.clientX, y: touch.clientY };
    rightStartPos.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: performance.now(),
    };
  };

  const handleRightTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.targetTouches.length >= 2) {
      const t0 = e.targetTouches[0];
      const t1 = e.targetTouches[1];
      const curDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (pinchDistRef.current !== null) {
        const deltaPx = pinchDistRef.current - curDist;
        cameraDeltaAccumulator.current.pinchDelta += deltaPx * 0.045;
        scheduleCameraUpdate();
      }
      pinchDistRef.current = curDist;
      return;
    }

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === rightTouchId.current) {
        const dx = touch.clientX - rightLastPos.current.x;
        const dy = touch.clientY - rightLastPos.current.y;
        rightLastPos.current = { x: touch.clientX, y: touch.clientY };

        cameraDeltaAccumulator.current.dx += dx;
        cameraDeltaAccumulator.current.dy += dy;
        scheduleCameraUpdate();
        break;
      }
    }
  };

  const handleRightTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.targetTouches.length < 2) {
      pinchDistRef.current = null;
    }
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === rightTouchId.current) {
        rightTouchId.current = null;
        const moveDist = Math.hypot(
          touch.clientX - rightStartPos.current.x,
          touch.clientY - rightStartPos.current.y,
        );
        const elapsed = performance.now() - rightStartPos.current.time;
        if (moveDist < 12 && elapsed < 280) {
          const nowMs = performance.now();
          const isDoubleTap = nowMs - lastRightTapTimeRef.current < 320;
          lastRightTapTimeRef.current = nowMs;

          if (tapToPlaceMode && (isBuildMode || isWorldEditMode)) {
            triggerTouchHaptic(8);
            if (typeof sim?.triggerPrimaryActionAt === 'function') {
              sim.triggerPrimaryActionAt(touch.clientX, touch.clientY);
            } else {
              sim?.triggerPrimaryAction?.();
            }
          } else if (isDoubleTap && isSeatedInRig && !isBuildMode && !isWorldEditMode) {
            triggerTouchHaptic(12);
            if (sim) {
              sim.driveYawOffset = 0;
              sim.drivePitchOffset = 0.28;
            }
          }
        }
        break;
      }
    }
  };

  const handleRightPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    if (menuPopupOpen || placementDropdownOpen || editPopupOpen || driveActionsPopupOpen) {
      closeAllPopups();
    }
    rightTouchId.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic PointerEvents
    }
    rightLastPos.current = { x: e.clientX, y: e.clientY };
    rightStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      time: performance.now(),
    };
  };

  const handleRightPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || rightTouchId.current !== e.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - rightLastPos.current.x;
    const dy = e.clientY - rightLastPos.current.y;
    rightLastPos.current = { x: e.clientX, y: e.clientY };
    cameraDeltaAccumulator.current.dx += dx;
    cameraDeltaAccumulator.current.dy += dy;
    scheduleCameraUpdate();
  };

  const handleRightPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || rightTouchId.current !== e.pointerId) return;
    e.preventDefault();
    const now = performance.now();
    const elapsed = now - rightStartPos.current.time;
    const movedDist = Math.hypot(
      e.clientX - rightStartPos.current.x,
      e.clientY - rightStartPos.current.y,
    );
    rightTouchId.current = null;

    if (elapsed < 260 && movedDist < 14) {
      if (now - lastRightTapTimeRef.current < 320 && (isBuildMode || isWorldEditMode)) {
        lastRightTapTimeRef.current = 0;
        sim?.focusBuildCamera?.();
        return;
      }
      lastRightTapTimeRef.current = now;
      if (tapToPlaceMode && (isBuildMode || isWorldEditMode)) {
        if (typeof sim?.triggerPrimaryActionAt === 'function') {
          sim.triggerPrimaryActionAt(e.clientX, e.clientY);
        } else {
          sim?.triggerPrimaryAction?.();
        }
      }
    }
  };

  const isDrivingNow = isSeatedInRig && !isBuildMode && !isWorldEditMode;
  const usePedalsLayout = isDrivingNow && driveScheme === 'PEDALS_STEER';
  const showVirtualJoystick =
    !usePedalsLayout && (!isBuildMode || buildFlyStickEnabled);

  const currentPlacementLabel =
    PLACEMENT_MODE_SHORT_LABELS[rigCapabilities.placementMode] ||
    PLACEMENT_MODES.find((p) => p.id === rigCapabilities.placementMode)?.label?.replace(
      /\s*\(.*\)/,
      '',
    ) ||
    '1×1 SINGLE';

  const currentSelectedPart =
    BUILD_SLOTS.find((item) => item.slot === activeSlot) || BUILD_SLOTS[0];

  const showReticle = shouldShowMobileCenterReticle(
    isBuildMode,
    isWorldEditMode,
    isSeatedInRig,
    tapToPlaceMode,
  );

  return (
    <div
      id="mobile-controls-root"
      data-testid="mobile-controls-root"
      className="fixed inset-0 pointer-events-none select-none touch-none overflow-hidden"
      style={{
        WebkitUserSelect: 'none',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* ============================================================== */}
      {/* 1. TOP BAR: CONSOLIDATED TO 3 BUTTONS (BUILD/DRIVE, MENU, PAUSE) */}
      {/* ============================================================== */}
      <div
        data-testid="mobile-top-bar"
        className={`absolute top-2 left-2.5 right-2.5 flex items-center justify-between gap-1.5 pointer-events-none ${
          menuPopupOpen ? 'z-[85]' : 'z-50'
        }`}
      >
        {/* Button 1: BUILD / DRIVE / WORLD EDIT / PROP STUDIO Toggle */}
        {showTopBar && getWidgetState(hudCustom, 'top-bar').visible ? (
          <div
            data-hud-widget="top-bar"
            data-hud-label="BUILD / DRIVE BTN"
            style={
              getWidgetTransformStyle(hudCustom, 'top-bar', undefined, 'top left') ??
              topBarStyle
            }
            className="flex items-center gap-1.5 pointer-events-auto min-w-0"
          >
          {rigCapabilities.isObjectStudioMode ? (
            <>
              <button
                type="button"
                data-testid="mobile-save-prop-btn"
                onClick={() => {
                  closeAllPopups();
                  setPartsDrawerOpen(false);
                  sim?.saveObjectStudioToWorldEditor?.();
                }}
                className="min-h-[36px] px-2.5 py-1 rounded-[2px] bg-[#22c55e] border-2 border-[#444444] text-[#1a1a1a] text-[11px] font-display font-extrabold tracking-wider uppercase flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <span>SAVE PROP</span>
              </button>
              <button
                type="button"
                data-testid="mobile-exit-prop-btn"
                onClick={() => {
                  closeAllPopups();
                  setPartsDrawerOpen(false);
                  sim?.toggleObjectStudioMode?.(false);
                }}
                className="min-h-[36px] px-2 py-1 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] text-[11px] font-display font-extrabold uppercase whitespace-nowrap shrink-0"
              >
                <span>EXIT</span>
              </button>
            </>
          ) : isWorldEditMode ? (
            <>
              <button
                type="button"
                data-testid="mobile-exit-world-edit-btn"
                onClick={() => {
                  closeAllPopups();
                  sim?.toggleWorldEditMode?.(false);
                }}
                className="min-h-[36px] px-2.5 py-1 rounded-[2px] hazard-stripe-border bg-[#facc15] text-[#1a1a1a] text-[11px] font-display font-extrabold tracking-wider uppercase flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <span>DONE EDIT</span>
              </button>
              <button
                type="button"
                data-testid="mobile-build-toggle-btn"
                onClick={() => {
                  closeAllPopups();
                  setPartsDrawerOpen(false);
                  sim?.toggleHoverBuildMode();
                }}
                className="min-h-[36px] px-2 py-1 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] text-[11px] font-display font-extrabold uppercase whitespace-nowrap shrink-0"
              >
                <span>BUILD</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="mobile-build-toggle-btn"
              aria-label={isBuildMode ? 'Switch to Drive Mode' : 'Switch to Build Mode'}
              onClick={() => {
                closeAllPopups();
                setPartsDrawerOpen(false);
                sim?.toggleHoverBuildMode();
              }}
              className={`min-h-[36px] px-3 py-1 rounded-[2px] hazard-stripe-border text-[11px] font-display font-extrabold tracking-wider uppercase flex items-center gap-1 whitespace-nowrap shrink-0 ${
                isBuildMode
                  ? 'bg-[#facc15] text-[#1a1a1a]'
                  : 'bg-[#fbbf24] text-[#1a1a1a]'
              }`}
            >
              <span>{isBuildMode ? 'DRIVE' : 'BUILD'}</span>
            </button>
          )}
        </div>
        ) : (
          <div />
        )}

        {/* Horizontal Top Bar Build Quick Strip (Between DRIVE and MENU in Build Mode) */}
        {showTopBar &&
          isBuildMode &&
          getWidgetState(hudCustom, 'mobile-build-strip').visible && (
          <div
            data-testid="mobile-build-quick-strip"
            data-hud-widget="mobile-build-strip"
            data-hud-label="BUILD TOP BAR"
            style={getWidgetTransformStyle(
              hudCustom,
              'mobile-build-strip',
              undefined,
              'top center',
            )}
            className="flex items-center gap-1 overflow-x-auto no-scrollbar pointer-events-auto bg-[#1a1a1a]/95 border-2 border-[#444444] rounded-[2px] px-1 py-0.5 shadow-lg max-w-[calc(100vw-185px)]"
          >
            <button
              type="button"
              data-testid="mobile-quick-undo-btn"
              onClick={() => sim?.undoBuildStep?.()}
              className="px-2 py-1 rounded-[2px] bg-[#dc2626] hover:bg-[#b91c1c] active:bg-[#991b1b] border border-[#444444] text-[#e5e5e5] text-[9.5px] font-display font-extrabold uppercase text-center cursor-pointer select-none leading-tight shrink-0"
            >
              UNDO
            </button>
            <button
              type="button"
              data-testid="mobile-quick-sym-btn"
              onClick={() => {
                sim?.toggleMirrorMode?.();
                setRigCapabilities((r) => ({ ...r, mirrorMode: !r.mirrorMode }));
              }}
              className={`px-2 py-1 rounded-[2px] border border-[#444444] text-[9.5px] font-display font-extrabold uppercase text-center cursor-pointer select-none leading-tight transition shrink-0 ${
                rigCapabilities.mirrorMode
                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                  : 'bg-[#262626] text-[#e5e5e5]'
              }`}
            >
              SYM
            </button>
            <button
              type="button"
              data-testid="mobile-quick-roty-btn"
              onClick={() =>
                sim?.rotatePartY ? sim.rotatePartY() : sim?.rotatePartAxis?.('yaw')
              }
              className="px-2 py-1 rounded-[2px] bg-[#262626] hover:bg-[#333333] active:bg-[#404040] border border-[#444444] text-[#fbbf24] text-[9.5px] font-mono-num font-bold uppercase text-center cursor-pointer select-none leading-tight shrink-0"
            >
              ROT Y
            </button>
            <button
              type="button"
              data-testid="mobile-quick-rotx-btn"
              onClick={() =>
                sim?.rotatePartX ? sim.rotatePartX() : sim?.rotatePartAxis?.('pitch')
              }
              className="px-2 py-1 rounded-[2px] bg-[#262626] hover:bg-[#333333] active:bg-[#404040] border border-[#444444] text-[#fbbf24] text-[9.5px] font-mono-num font-bold uppercase text-center cursor-pointer select-none leading-tight shrink-0"
            >
              ROT X
            </button>
            <button
              type="button"
              data-testid="mobile-quick-rotz-btn"
              onClick={() =>
                sim?.rotatePartZ ? sim.rotatePartZ() : sim?.rotatePartAxis?.('roll')
              }
              className="px-2 py-1 rounded-[2px] bg-[#262626] hover:bg-[#333333] active:bg-[#404040] border border-[#444444] text-[#fbbf24] text-[9.5px] font-mono-num font-bold uppercase text-center cursor-pointer select-none leading-tight shrink-0"
            >
              ROT Z
            </button>
            <button
              type="button"
              data-testid="mobile-quick-tap-btn"
              onClick={() => setTapToPlaceMode((v) => !v)}
              className={`px-2 py-1 rounded-[2px] border border-[#444444] text-[9.5px] font-display font-extrabold uppercase text-center cursor-pointer select-none leading-tight transition shrink-0 ${
                tapToPlaceMode
                  ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                  : 'bg-[#262626] text-[#e5e5e5]'
              }`}
            >
              TAP
            </button>
          </div>
        )}

        {/* Buttons 2 & 3: Consolidated Menu Button + Hazard-Striped Pause Button */}
        {getWidgetState(hudCustom, 'mobile-top-right').visible && (
        <div
          data-hud-widget="mobile-top-right"
          data-hud-label="MENU & PAUSE"
          style={getWidgetTransformStyle(
            hudCustom,
            'mobile-top-right',
            undefined,
            'top right',
          )}
          className="relative flex items-center gap-1.5 pointer-events-auto shrink-0"
        >
          {showTopBar && (
          <button
            type="button"
            data-testid="mobile-menu-btn"
            aria-label="Open tools and settings menu"
            aria-expanded={menuPopupOpen}
            onClick={() => {
              const next = !menuPopupOpen;
              closeAllPopups();
              setMenuPopupOpen(next);
            }}
            className={`min-h-[38px] px-3 py-1.5 rounded-[2px] border-2 border-[#444444] text-xs font-display font-bold uppercase flex items-center gap-1 whitespace-nowrap shrink-0 ${
              menuPopupOpen
                ? 'bg-[#facc15] text-[#1a1a1a]'
                : 'bg-[#6b7280] text-[#e5e5e5]'
            }`}
          >
            <span>MENU {menuPopupOpen ? '▴' : '▾'}</span>
          </button>
          )}

          <button
            type="button"
            data-testid="mobile-pause-btn"
            onClick={() => {
              closeAllPopups();
              if (onOpenPause) onOpenPause();
              else sim?.pauseGame?.();
            }}
            aria-label="Pause game"
            className="min-w-[44px] h-[38px] px-2 bg-[#1a1a1a] hazard-stripe-border text-[#fbbf24] font-display font-extrabold text-[11px] rounded-[2px] flex items-center justify-center shrink-0 uppercase"
          >
            PAUSE
          </button>
        </div>
        )}
      </div>

      {/* Consolidated Top Menu Popup: Fixed Centered Landscape-Safe Sheet with Backdrop (Rendered outside transformed widget container so it always opens in the center of the window!) */}
      {menuPopupOpen && (
        <>
          <div
            onClick={() => setMenuPopupOpen(false)}
            className="fixed inset-0 bg-black/55 z-[88] pointer-events-auto"
          />
          <div
            data-testid="mobile-menu-popup"
            className="fixed inset-x-2.5 top-1/2 -translate-y-1/2 mx-auto w-[min(94vw,460px)] max-h-[calc(100dvh-20px)] overflow-y-auto overscroll-contain touch-pan-y bg-[#1a1a1a]/98 border-2 border-[#fbbf24] rounded-[2px] p-2 grid grid-cols-3 gap-1.5 z-[95] shadow-2xl pointer-events-auto"
          >
                <div className="col-span-3 flex items-center justify-between border-b border-[#383838] pb-1 mb-0.5">
                  <span className="text-[10px] font-display font-extrabold text-[#fbbf24] uppercase tracking-wider">
                    QUICK MENU &amp; STUDIOS
                  </span>
                  <button
                    type="button"
                    onClick={() => setMenuPopupOpen(false)}
                    className="px-2 py-0.5 bg-[#dc2626] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase"
                  >
                    ✕ CLOSE
                  </button>
                </div>

                {onOpenGarage && (
                  <button
                    type="button"
                    data-testid="mobile-garage-btn"
                    onClick={() => {
                      setMenuPopupOpen(false);
                      onOpenGarage();
                    }}
                    className="col-span-2 w-full px-2.5 py-2 rounded-[2px] bg-[#262626] border-2 border-[#fbbf24] text-[#fbbf24] text-left text-[10.5px] font-display font-extrabold uppercase flex items-center justify-between"
                  >
                    <span>CHOOSE VEHICLE / GARAGE</span>
                    <span className="text-[9px] font-mono-num">14 RIGS</span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="mobile-menu-repair-btn"
                  onClick={() => {
                    setMenuPopupOpen(false);
                    sim?.flipSummonRig?.();
                  }}
                  className="w-full px-2 py-2 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] text-[#1a1a1a] text-left text-[10.5px] font-display font-extrabold uppercase flex items-center justify-between"
                >
                  <span>REPAIR</span>
                  <span className="text-[9px] font-mono-num">FIX</span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-prev-rig-btn"
                  onClick={() => {
                    const total = 14;
                    const curr = typeof sim?.currentPreset === 'number' ? sim.currentPreset : 0;
                    sim?.selectPreset?.((curr - 1 + total) % total);
                  }}
                  className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                >
                  <span>◀ PREV RIG</span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-next-rig-btn"
                  onClick={() => {
                    const total = 14;
                    const curr = typeof sim?.currentPreset === 'number' ? sim.currentPreset : 0;
                    sim?.selectPreset?.((curr + 1) % total);
                  }}
                  className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                >
                  <span>NEXT RIG ▶</span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-upright-btn"
                  onClick={() => {
                    setMenuPopupOpen(false);
                    sim?.callAndUprightRig();
                  }}
                  className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                >
                  <span>UPRIGHT</span>
                  <span className="text-[8.5px] font-mono-num text-[#fbbf24]">CALL</span>
                </button>

                {onOpenMap && (
                  <button
                    type="button"
                    data-testid="mobile-open-map-btn"
                    onClick={() => {
                      setMenuPopupOpen(false);
                      onOpenMap();
                    }}
                    className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                  >
                    <span>WORLD MAP</span>
                    <span className="text-[8.5px] font-mono-num">MAP</span>
                  </button>
                )}

                {onOpenWorldGen && (
                  <button
                    type="button"
                    data-testid="mobile-open-worldgen-btn"
                    onClick={() => {
                      setMenuPopupOpen(false);
                      onOpenWorldGen();
                    }}
                    className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#4ade80] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                  >
                    <span>WORLD SAVE</span>
                    <span className="text-[8.5px] font-mono-num">BIOME</span>
                  </button>
                )}

                {onOpenModStudio && (
                  <button
                    type="button"
                    data-testid="mobile-open-modstudio-btn"
                    onClick={() => {
                      setMenuPopupOpen(false);
                      onOpenModStudio();
                    }}
                    className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#facc15] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                  >
                    <span>MODS/MODES</span>
                    <span className="text-[8.5px] font-mono-num">FX</span>
                  </button>
                )}

                {onOpenAiFleet && (
                  <button
                    type="button"
                    data-testid="mobile-open-aifleet-btn"
                    onClick={() => {
                      setMenuPopupOpen(false);
                      onOpenAiFleet();
                    }}
                    className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#4ade80] text-[#4ade80] text-left text-[10px] font-display font-extrabold uppercase flex items-center justify-between"
                  >
                    <span>AI PILOTS</span>
                    <span className="text-[8.5px] font-mono-num">BOTS</span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="mobile-world-edit-toggle-btn"
                  onClick={() => {
                    setMenuPopupOpen(false);
                    sim?.toggleWorldEditMode();
                  }}
                  className={`w-full px-2 py-1.5 rounded-[2px] border-2 border-[#444444] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between ${
                    isWorldEditMode
                      ? 'bg-[#facc15] text-[#1a1a1a]'
                      : 'bg-[#262626] text-[#e5e5e5]'
                  }`}
                >
                  <span>TERRAFORM</span>
                  <span className="text-[8.5px] font-mono-num">{isWorldEditMode ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-cycle-cam-btn"
                  onClick={() => {
                    if (isBuildMode) {
                      sim?.cycleBuildCameraAngle?.();
                    } else {
                      sim?.cycleCameraMode?.();
                    }
                    setMenuPopupOpen(false);
                  }}
                  className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                >
                  <span>CAMERA</span>
                  <span className="text-[8.5px] font-mono-num">VIEW</span>
                </button>

                {(isBuildMode || isWorldEditMode) && (
                  <>
                    <button
                      type="button"
                      data-testid="mobile-focus-pivot-btn"
                      onClick={() => {
                        sim?.focusBuildCamera?.();
                        setMenuPopupOpen(false);
                      }}
                      className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                    >
                      <span>FOCUS RIG</span>
                      <span className="text-[8.5px] font-mono-num">CTR</span>
                    </button>

                    <button
                      type="button"
                      data-testid="mobile-tap-mode-toggle-btn"
                      onClick={() => {
                        setTapToPlaceMode((v) => !v);
                      }}
                      className={`w-full px-2 py-1.5 rounded-[2px] border-2 border-[#444444] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between ${
                        tapToPlaceMode
                          ? 'bg-[#facc15] text-[#1a1a1a]'
                          : 'bg-[#262626] text-[#e5e5e5]'
                      }`}
                    >
                      <span>TAP PLACE</span>
                      <span className="text-[8.5px] font-mono-num">
                        {tapToPlaceMode ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    <button
                      type="button"
                      data-testid="mobile-fly-stick-toggle-btn"
                      onClick={() => setBuildFlyStickEnabled((v) => !v)}
                      className={`w-full px-2 py-1.5 rounded-[2px] border-2 border-[#444444] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between ${
                        buildFlyStickEnabled
                          ? 'bg-[#facc15] text-[#1a1a1a]'
                          : 'bg-[#262626] text-[#e5e5e5]'
                      }`}
                    >
                      <span>FLY STICK</span>
                      <span className="text-[8.5px] font-mono-num">
                        {buildFlyStickEnabled ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </>
                )}

                {isDrivingNow && (
                  <button
                    type="button"
                    data-testid="mobile-scheme-toggle-btn"
                    onClick={() => {
                      toggleScheme();
                      setMenuPopupOpen(false);
                    }}
                    className="w-full px-2 py-1.5 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                  >
                    <span>STEER</span>
                    <span className="text-[8.5px] font-mono-num">
                      {driveScheme === 'PEDALS_STEER' ? 'PEDALS' : 'STICK'}
                    </span>
                  </button>
                )}

                {onOpenHudEditor && (
                  <button
                    type="button"
                    data-testid="mobile-menu-hud-editor-btn"
                    onClick={() => {
                      setMenuPopupOpen(false);
                      onOpenHudEditor();
                    }}
                    className="w-full px-2 py-1.5 rounded-[2px] bg-[#38bdf8] border-2 border-[#090d16] text-[#090d16] text-left text-[10px] font-display font-black uppercase flex items-center justify-between"
                  >
                    <span>⊞ EDIT HUD</span>
                    <span className="text-[8.5px] font-mono-num">LAYOUT</span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="mobile-hide-touch-ui-btn"
                  onClick={() => {
                    setMenuPopupOpen(false);
                    setTouchModeOverride('OFF');
                  }}
                  className="w-full px-2 py-1.5 rounded-[2px] bg-[#6b7280] border-2 border-[#444444] text-[#e5e5e5] text-left text-[10px] font-display font-bold uppercase flex items-center justify-between"
                >
                  <span>LAPTOP UI</span>
                  <span className="text-[8.5px] font-mono-num">MODE</span>
                </button>
              </div>
            </>
          )}

      {/* ============================================================== */}
      {/* 2. RETICLE: HIDDEN IN BUILD MODE WITH TAP PLACE OFF            */}
      {/* ============================================================== */}
      {showReticle && (
        <div
          data-testid="mobile-center-reticle"
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="relative w-7 h-7 flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-[#fbbf24] border border-[#1a1a1a]" />
            <div className="absolute top-0 w-2.5 h-[2px] bg-[#fbbf24] -translate-y-1.5" />
            <div className="absolute bottom-0 w-2.5 h-[2px] bg-[#fbbf24] translate-y-1.5" />
            <div className="absolute left-0 h-2.5 w-[2px] bg-[#fbbf24] -translate-x-1.5" />
            <div className="absolute right-0 h-2.5 w-[2px] bg-[#fbbf24] translate-x-1.5" />
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. LEFT CONTROLS: 2 CAMERA BUTTONS IN BUILD, STEERING IN DRIVE */}
      {/* ============================================================== */}
      {!showLeftControls || !getWidgetState(hudCustom, 'mobile-left-controls').visible ? null : usePedalsLayout ? (
        <div
          data-testid="mobile-left-steering-cluster"
          data-hud-widget="mobile-left-controls"
          data-hud-label="LEFT STEER / STICK"
          style={
            getWidgetTransformStyle(
              hudCustom,
              'mobile-left-controls',
              undefined,
              'bottom left',
            ) ?? leftControlsStyle
          }
          className="absolute left-2.5 bottom-4 flex flex-col gap-2 pointer-events-auto z-30"
        >
          {(rigCapabilities.hasFlight || rigCapabilities.hasSubmarine) && (
            <div className="flex items-center gap-1 bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-1">
              <button
                type="button"
                data-testid="mobile-flight-pitch-up"
                onTouchStart={(e) => {
                  e.preventDefault();
                  setAnalogPitch(1);
                  if (rigCapabilities.hasSubmarine) setSimKey('Space', true);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  setAnalogPitch(0);
                  if (rigCapabilities.hasSubmarine) setSimKey('Space', false);
                }}
                onMouseDown={() => {
                  setAnalogPitch(1);
                  if (rigCapabilities.hasSubmarine) setSimKey('Space', true);
                }}
                onMouseUp={() => {
                  setAnalogPitch(0);
                  if (rigCapabilities.hasSubmarine) setSimKey('Space', false);
                }}
                onMouseLeave={() => {
                  setAnalogPitch(0);
                  if (rigCapabilities.hasSubmarine) setSimKey('Space', false);
                }}
                className="px-2 py-1.5 rounded-[2px] bg-[#262626] active:bg-[#facc15] active:text-[#1a1a1a] text-[#e5e5e5] font-mono-num font-bold text-[9.5px] border-2 border-[#444444]"
              >
                {rigCapabilities.hasSubmarine ? 'SURF ▲' : 'PITCH UP'}
              </button>
              <button
                type="button"
                data-testid="mobile-flight-pitch-down"
                onTouchStart={(e) => {
                  e.preventDefault();
                  setAnalogPitch(-1);
                  if (rigCapabilities.hasSubmarine) setSimKey('ControlLeft', true);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  setAnalogPitch(0);
                  if (rigCapabilities.hasSubmarine) setSimKey('ControlLeft', false);
                }}
                onMouseDown={() => {
                  setAnalogPitch(-1);
                  if (rigCapabilities.hasSubmarine) setSimKey('ControlLeft', true);
                }}
                onMouseUp={() => {
                  setAnalogPitch(0);
                  if (rigCapabilities.hasSubmarine) setSimKey('ControlLeft', false);
                }}
                onMouseLeave={() => {
                  setAnalogPitch(0);
                  if (rigCapabilities.hasSubmarine) setSimKey('ControlLeft', false);
                }}
                className="px-2 py-1.5 rounded-[2px] bg-[#262626] active:bg-[#facc15] active:text-[#1a1a1a] text-[#e5e5e5] font-mono-num font-bold text-[9.5px] border-2 border-[#444444]"
              >
                {rigCapabilities.hasSubmarine ? 'DIVE ▼' : 'PITCH DN'}
              </button>
            </div>
          )}

          {/* Compact Left / Right Steering Buttons + Smooth Analog Touch Bar */}
          <div className="bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-1.5 flex flex-col gap-1.5">
            <div
              ref={steerBarRef}
              data-testid="mobile-analog-steer-bar"
              onTouchStart={(e) => {
                e.preventDefault();
                const touch = e.changedTouches[0];
                if (!touch || !steerBarRef.current) return;
                steerBarTouchIdRef.current = touch.identifier;
                const rect = steerBarRef.current.getBoundingClientRect();
                setAnalogSteer(computeAnalogSliderSteer(touch.clientX, rect.left, rect.width));
                triggerTouchHaptic(6);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                if (!steerBarRef.current) return;
                for (let i = 0; i < e.changedTouches.length; i++) {
                  const t = e.changedTouches[i];
                  if (t.identifier === steerBarTouchIdRef.current) {
                    const rect = steerBarRef.current.getBoundingClientRect();
                    setAnalogSteer(computeAnalogSliderSteer(t.clientX, rect.left, rect.width));
                    break;
                  }
                }
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                for (let i = 0; i < e.changedTouches.length; i++) {
                  if (e.changedTouches[i].identifier === steerBarTouchIdRef.current) {
                    steerBarTouchIdRef.current = null;
                    setAnalogSteer(0);
                    break;
                  }
                }
              }}
              onTouchCancel={(e) => {
                e.preventDefault();
                steerBarTouchIdRef.current = null;
                setAnalogSteer(0);
              }}
              onPointerDown={(e) => {
                if (e.pointerType === 'touch' || !steerBarRef.current) return;
                steerBarPointerActiveRef.current = true;
                e.currentTarget.setPointerCapture?.(e.pointerId);
                const rect = steerBarRef.current.getBoundingClientRect();
                setAnalogSteer(computeAnalogSliderSteer(e.clientX, rect.left, rect.width));
              }}
              onPointerMove={(e) => {
                if (e.pointerType === 'touch' || !steerBarPointerActiveRef.current || !steerBarRef.current) return;
                const rect = steerBarRef.current.getBoundingClientRect();
                setAnalogSteer(computeAnalogSliderSteer(e.clientX, rect.left, rect.width));
              }}
              onPointerUp={(e) => {
                if (e.pointerType === 'touch' || !steerBarPointerActiveRef.current) return;
                steerBarPointerActiveRef.current = false;
                setAnalogSteer(0);
              }}
              onPointerCancel={(e) => {
                if (e.pointerType === 'touch') return;
                steerBarPointerActiveRef.current = false;
                setAnalogSteer(0);
              }}
              className="relative h-5 w-full rounded-[2px] bg-[#262626] border-2 border-[#444444] flex items-center justify-center overflow-hidden cursor-ew-resize"
            >
              <div className="w-[2px] h-full bg-[#6b7280]" />
              <div
                className="absolute top-0.5 bottom-0.5 w-5 rounded-[2px] bg-[#fbbf24] border border-[#1a1a1a] transition-transform duration-75"
                style={{
                  transform: `translateX(${-steerSliderVal * 38}px)`,
                }}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="mobile-steer-left-btn"
                onTouchStart={(e) => {
                  e.preventDefault();
                  triggerTouchHaptic(8);
                  setAnalogSteer(1.0);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  setAnalogSteer(0);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  setAnalogSteer(0);
                }}
                onMouseDown={() => setAnalogSteer(1.0)}
                onMouseUp={() => setAnalogSteer(0)}
                className={`w-14 h-14 rounded-[2px] border-2 border-[#444444] font-display font-black text-base flex flex-col items-center justify-center ${
                  steerSliderVal > 0.2
                    ? 'bg-[#facc15] text-[#1a1a1a]'
                    : 'bg-[#262626] text-[#e5e5e5]'
                }`}
              >
                <span>◀</span>
                <span className="text-[8.5px] font-mono-num tracking-wider">LEFT</span>
              </button>

              <button
                type="button"
                data-testid="mobile-steer-right-btn"
                onTouchStart={(e) => {
                  e.preventDefault();
                  triggerTouchHaptic(8);
                  setAnalogSteer(-1.0);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  setAnalogSteer(0);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  setAnalogSteer(0);
                }}
                onMouseDown={() => setAnalogSteer(-1.0)}
                onMouseUp={() => setAnalogSteer(0)}
                className={`w-14 h-14 rounded-[2px] border-2 border-[#444444] font-display font-black text-base flex flex-col items-center justify-center ${
                  steerSliderVal < -0.2
                    ? 'bg-[#facc15] text-[#1a1a1a]'
                    : 'bg-[#262626] text-[#e5e5e5]'
                }`}
              >
                <span>▶</span>
                <span className="text-[8.5px] font-mono-num tracking-wider">RIGHT</span>
              </button>
            </div>
          </div>
        </div>
      ) : showVirtualJoystick ? (
        <div
          data-hud-widget="mobile-left-controls"
          data-hud-label="LEFT STEER / STICK"
          style={
            getWidgetTransformStyle(
              hudCustom,
              'mobile-left-controls',
              undefined,
              'bottom left',
            ) ?? leftControlsStyle
          }
          className="absolute left-3.5 bottom-5 w-24 h-24 z-20 pointer-events-auto"
        >
          <div
            data-testid="mobile-left-drag-zone"
            onTouchStart={handleLeftTouchZoneStart}
            onTouchMove={handleLeftTouchZoneMove}
            onTouchEnd={handleLeftTouchZoneEnd}
            onTouchCancel={handleLeftTouchZoneEnd}
            onPointerDown={handleLeftPointerDown}
            onPointerMove={handleLeftPointerMove}
            onPointerUp={handleLeftPointerUp}
            onPointerCancel={handleLeftPointerUp}
            className="absolute -inset-4 pointer-events-auto z-20"
          />

          <div
            ref={fixedJoystickPadRef}
            data-testid="mobile-virtual-joystick-pad"
            className="pointer-events-none z-20 relative w-24 h-24"
          >
            <div
              className={`w-24 h-24 rounded-[2px] bg-[#1a1a1a]/90 border-2 ${
                joystickActive ? 'border-[#facc15]' : 'border-[#444444]'
              } relative flex items-center justify-center`}
            >
              <span className="absolute top-1 text-[8px] font-mono-num font-black text-[#e5e5e5]">
                ▲
              </span>
              <span className="absolute bottom-1 text-[8px] font-mono-num font-black text-[#e5e5e5]">
                ▼
              </span>
              <span className="absolute left-1.5 text-[8px] font-mono-num font-black text-[#e5e5e5]">
                ◀
              </span>
              <span className="absolute right-1.5 text-[8px] font-mono-num font-black text-[#e5e5e5]">
                ▶
              </span>

              <div
                className="w-10 h-10 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] flex items-center justify-center text-[#1a1a1a] text-[8.5px] font-display font-black tracking-tight"
                style={{
                  transform: `translate(${stickOffset.x}px, ${stickOffset.y}px)`,
                }}
              >
                {isDrivingNow ? 'STEER' : isBuildMode ? 'FLY' : 'MOVE'}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Requirement 4: Left Side Camera Elevation in Build Mode (Consolidated to 2 Buttons: UP & DOWN) */}
      {(isBuildMode || isWorldEditMode) &&
        getWidgetState(hudCustom, 'mobile-cam-elev').visible && (
        <div
          data-hud-widget="mobile-cam-elev"
          data-hud-label="CAM UP / DOWN"
          style={getWidgetTransformStyle(
            hudCustom,
            'mobile-cam-elev',
            undefined,
            'bottom left',
          )}
          className={`absolute left-2.5 ${
            showVirtualJoystick ? 'bottom-48' : 'bottom-16'
          } flex flex-col gap-2 pointer-events-auto z-30`}
        >
          <button
            type="button"
            data-testid="mobile-cam-up-btn"
            aria-label="Move camera up"
            onTouchStart={(e) => {
              e.preventDefault();
              setSimKey('Space', true);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              setSimKey('Space', false);
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              setSimKey('Space', false);
            }}
            onMouseDown={() => setSimKey('Space', true)}
            onMouseUp={() => setSimKey('Space', false)}
            onMouseLeave={() => setSimKey('Space', false)}
            onClick={() => {
              if (sim?.camFreePos) {
                sim.camFreePos.y += 0.6;
                if (sim.buildOrbitPivot) sim.buildOrbitPivot.y += 0.6;
              }
            }}
            className="w-11 h-11 rounded-[2px] bg-[#1a1a1a] active:bg-[#fbbf24] active:text-[#1a1a1a] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] flex flex-col items-center justify-center uppercase"
          >
            <span>▲</span>
            <span>UP</span>
          </button>
          <button
            type="button"
            data-testid="mobile-cam-down-btn"
            aria-label="Move camera down"
            onTouchStart={(e) => {
              e.preventDefault();
              setSimKey('KeyQ', true);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              setSimKey('KeyQ', false);
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              setSimKey('KeyQ', false);
            }}
            onMouseDown={() => setSimKey('KeyQ', true)}
            onMouseUp={() => setSimKey('KeyQ', false)}
            onMouseLeave={() => setSimKey('KeyQ', false)}
            onClick={() => {
              if (sim?.camFreePos) {
                const nextY = Math.max(1.0, sim.camFreePos.y - 0.6);
                const dy = nextY - sim.camFreePos.y;
                sim.camFreePos.y = nextY;
                if (sim.buildOrbitPivot) sim.buildOrbitPivot.y += dy;
              }
            }}
            className="w-11 h-11 rounded-[2px] bg-[#1a1a1a] active:bg-[#fbbf24] active:text-[#1a1a1a] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] flex flex-col items-center justify-center uppercase"
          >
            <span>▼</span>
            <span>DOWN</span>
          </button>
        </div>
      )}

      {/* Full-Viewport Camera Look & Pinch-Zoom Zone */}
      <div
        data-testid="mobile-right-camera-zone"
        onTouchStart={handleRightTouchStart}
        onTouchMove={handleRightTouchMove}
        onTouchEnd={handleRightTouchEnd}
        onTouchCancel={handleRightTouchEnd}
        onPointerDown={handleRightPointerDown}
        onPointerMove={handleRightPointerMove}
        onPointerUp={handleRightPointerUp}
        onPointerCancel={handleRightPointerUp}
        className="absolute left-0 right-0 bottom-14 top-12 pointer-events-auto z-10"
      />

      {/* ============================================================== */}
      {/* 4. RIGHT ACTION CLUSTERS (BUILD, WORLD EDIT, DRIVING, WALKING) */}
      {/* ============================================================== */}
      <div
        data-testid="mobile-right-action-cluster"
        data-hud-widget="mobile-right-controls"
        data-hud-label={
          isBuildMode
            ? 'BUILD PLACE & EDIT'
            : isWorldEditMode
              ? 'TERRAFORM ACTIONS'
              : isSeatedInRig
                ? 'RIGHT PEDALS & TOOLS'
                : 'WALK ACTIONS'
        }
        style={
          getWidgetTransformStyle(
            hudCustom,
            'mobile-right-controls',
            undefined,
            'bottom right',
          ) ?? rightControlsStyle
        }
        className={`${
          showRightControls && getWidgetState(hudCustom, 'mobile-right-controls').visible
            ? 'flex'
            : 'hidden'
        } absolute right-2.5 bottom-4 flex-col items-end gap-2 pointer-events-none z-40`}
      >
        {isBuildMode ? (
          /* ----------------- BUILD MODE RIGHT CLUSTER ----------------- */
          <div className="flex flex-col gap-1.5 items-end">
            {/* Row A: Placement Mode Single Dropdown Button + "EDIT ▾" Popup Button */}
            <div className="relative flex items-center gap-1.5 pointer-events-auto">
              {/* Requirement 2: Single Placement Mode Dropdown Button ("1×1 SINGLE ▾") */}
              <div className="relative">
                <button
                  type="button"
                  data-testid="mobile-placement-mode-dropdown-btn"
                  aria-label="Select placement mode"
                  aria-expanded={placementDropdownOpen}
                  onClick={() => {
                    const next = !placementDropdownOpen;
                    closeAllPopups();
                    setPlacementDropdownOpen(next);
                  }}
                  className={`min-h-[36px] px-2.5 py-1.5 rounded-[2px] border-2 border-[#444444] text-[11px] font-mono-num font-bold uppercase flex items-center gap-1 whitespace-nowrap ${
                    placementDropdownOpen
                      ? 'bg-[#facc15] text-[#1a1a1a]'
                      : 'bg-[#1a1a1a] text-[#fbbf24]'
                  }`}
                >
                  <span>{currentPlacementLabel}</span>
                  <span>{placementDropdownOpen ? '▴' : '▾'}</span>
                </button>
              </div>

              {/* Requirement 3: Consolidated "EDIT" Button (ROT Y, ROT X, ROT Z, MIRROR, UNDO) */}
              <div className="relative">
                <button
                  type="button"
                  data-testid="mobile-edit-tools-btn"
                  aria-label="Open rotate, mirror, and undo tools"
                  aria-expanded={editPopupOpen}
                  onClick={() => {
                    const next = !editPopupOpen;
                    closeAllPopups();
                    setEditPopupOpen(next);
                  }}
                  className={`min-h-[36px] px-2.5 py-1.5 rounded-[2px] border-2 border-[#444444] text-[11px] font-display font-bold uppercase flex items-center gap-1 whitespace-nowrap ${
                    editPopupOpen
                      ? 'bg-[#facc15] text-[#1a1a1a]'
                      : 'bg-[#6b7280] text-[#e5e5e5]'
                  }`}
                >
                  <span>EDIT</span>
                  <span>{editPopupOpen ? '▴' : '▾'}</span>
                </button>
              </div>
            </div>

            {/* Row B: Primary Placement Action Buttons (Warning Red DELETE + Hazard Yellow PLACE) */}
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                type="button"
                data-testid="mobile-delete-block-btn"
                onClick={() =>
                  sim?.triggerSecondaryAction
                    ? sim.triggerSecondaryAction()
                    : sim?.deleteSelectedObject?.()
                }
                className="w-14 h-13 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-lg leading-none">−</span>
                <span className="text-[9px] tracking-wider uppercase font-bold">DELETE</span>
              </button>

              <button
                type="button"
                data-testid="mobile-place-block-btn"
                onClick={() =>
                  sim?.triggerPrimaryAction
                    ? sim.triggerPrimaryAction()
                    : sim?.placeBlock?.()
                }
                className="w-15 h-13 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] text-[#1a1a1a] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-xl leading-none">+</span>
                <span className="text-[9.5px] tracking-wider uppercase font-extrabold">PLACE</span>
              </button>
            </div>
          </div>
        ) : isWorldEditMode ? (
          /* ----------------- WORLD EDIT MODE ACTION CLUSTER ----------------- */
          <div className="flex flex-col gap-1.5 items-end pointer-events-auto">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="mobile-world-rotate-btn"
                onClick={() => sim?.rotatePartAxis?.('yaw')}
                className="min-h-[34px] px-2 py-1 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] text-[10px] font-mono-num font-extrabold uppercase"
              >
                ROT Y
              </button>
              <button
                type="button"
                data-testid="mobile-world-rotate-x-btn"
                onClick={() => sim?.rotatePartAxis?.('pitch')}
                className="min-h-[34px] px-2 py-1 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] text-[10px] font-mono-num font-extrabold uppercase"
              >
                ROT X
              </button>
              <button
                type="button"
                data-testid="mobile-world-rotate-z-btn"
                onClick={() => sim?.rotatePartAxis?.('roll')}
                className="min-h-[34px] px-2 py-1 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] text-[10px] font-mono-num font-extrabold uppercase"
              >
                ROT Z
              </button>
              <button
                type="button"
                data-testid="mobile-world-catalog-btn"
                onClick={() => {
                  const next = !worldCatalogOpen;
                  closeAllPopups();
                  setWorldCatalogOpen(next);
                }}
                className={`min-h-[34px] px-2.5 py-1 rounded-[2px] border-2 border-[#444444] text-[10.5px] font-display font-extrabold uppercase ${
                  worldCatalogOpen
                    ? 'bg-[#facc15] text-[#1a1a1a]'
                    : 'bg-[#1a1a1a] text-[#fbbf24]'
                }`}
              >
                ITEMS {worldCatalogOpen ? '▴' : '▾'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="mobile-world-carve-btn"
                onClick={() => sim?.triggerSecondaryAction?.()}
                className="w-14 h-13 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-sm leading-none">−</span>
                <span className="text-[9px] uppercase font-bold mt-0.5">CARVE</span>
              </button>
              <button
                type="button"
                data-testid="mobile-world-apply-btn"
                onClick={() => sim?.triggerPrimaryAction?.()}
                className="w-15 h-13 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] text-[#1a1a1a] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-sm leading-none">+</span>
                <span className="text-[9.5px] uppercase font-extrabold mt-0.5">APPLY</span>
              </button>
            </div>
          </div>
        ) : isSeatedInRig ? (
          /* ----------------- DRIVING MODE ACTION CLUSTER (CLEAN & USABLE) ----------------- */
          <div className="flex flex-col gap-2 items-end pointer-events-auto">
            {/* Compact Secondary Row: FIRE (when armed), BOOST, DRIFT/LIFT, and Consolidated "TOOLS ▾" */}
            <div className="relative flex items-center gap-1.5">
              {(rigCapabilities.hasCannons || rigCapabilities.hasMelee) && (
                <button
                  type="button"
                  data-testid="mobile-drive-fire-btn"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    const ar = sim?.getActiveRig?.();
                    ar?.fireCannons?.();
                    ar?.applyMeleeCombatStep?.(sim?.getAllPhysicsRigs?.() || [], true);
                    setSimKey('KeyF', true);
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    setSimKey('KeyF', false);
                  }}
                  onClick={() => {
                    const ar = sim?.getActiveRig?.();
                    ar?.fireCannons?.();
                    ar?.applyMeleeCombatStep?.(sim?.getAllPhysicsRigs?.() || [], true);
                  }}
                  className="w-12 h-11 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
                >
                  <span className="text-[8.5px] tracking-wider uppercase font-extrabold">
                    {rigCapabilities.hasCannons ? 'FIRE' : 'SLASH'}
                  </span>
                </button>
              )}

              <button
                type="button"
                data-testid="mobile-drive-boost-btn"
                onTouchStart={(e) => {
                  e.preventDefault();
                  setSimKey('ShiftLeft', true);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  setSimKey('ShiftLeft', false);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  setSimKey('ShiftLeft', false);
                }}
                onMouseDown={() => setSimKey('ShiftLeft', true)}
                onMouseUp={() => setSimKey('ShiftLeft', false)}
                onMouseLeave={() => setSimKey('ShiftLeft', false)}
                className="w-12 h-11 rounded-[2px] bg-[#dc2626] active:bg-[#facc15] active:text-[#1a1a1a] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-[8.5px] tracking-wider uppercase">BOOST</span>
              </button>

              <button
                type="button"
                data-testid="mobile-drive-brake-btn"
                onTouchStart={(e) => {
                  e.preventDefault();
                  setSimKey('Space', true);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  setSimKey('Space', false);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  setSimKey('Space', false);
                }}
                onMouseDown={() => setSimKey('Space', true)}
                onMouseUp={() => setSimKey('Space', false)}
                onMouseLeave={() => setSimKey('Space', false)}
                className="w-12 h-11 rounded-[2px] bg-[#fbbf24] active:bg-[#facc15] border-2 border-[#444444] text-[#1a1a1a] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-[8.5px] tracking-wider uppercase">
                  {rigCapabilities.hasFlight ? 'LIFT' : 'DRIFT'}
                </span>
              </button>

              <button
                type="button"
                data-testid="mobile-drive-actions-btn"
                aria-label="Open vehicle gadgets and actions"
                aria-expanded={driveActionsPopupOpen}
                onClick={() => {
                  const next = !driveActionsPopupOpen;
                  closeAllPopups();
                  setDriveActionsPopupOpen(next);
                }}
                className={`h-11 px-3 min-w-[68px] rounded-[2px] border-2 border-[#444444] font-display font-extrabold text-[11px] uppercase flex items-center justify-center whitespace-nowrap ${
                  driveActionsPopupOpen
                    ? 'bg-[#facc15] text-[#1a1a1a]'
                    : 'bg-[#6b7280] text-[#e5e5e5]'
                }`}
              >
                <span>TOOLS {driveActionsPopupOpen ? '▴' : '▾'}</span>
              </button>
            </div>

            {/* Primary Driving Pedals: REV / BRK + GAS */}
            <div className="flex items-end gap-2">
              <button
                type="button"
                data-testid="mobile-pedal-reverse-btn"
                onTouchStart={(e) => {
                  e.preventDefault();
                  setCruiseLocked(false);
                  pedalThrottleRef.current = -1.0;
                  setAnalogThrottle(-1.0);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  pedalThrottleRef.current = 0;
                  setAnalogThrottle(0);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  pedalThrottleRef.current = 0;
                  setAnalogThrottle(0);
                }}
                onMouseDown={() => {
                  setCruiseLocked(false);
                  pedalThrottleRef.current = -1.0;
                  setAnalogThrottle(-1.0);
                }}
                onMouseUp={() => {
                  pedalThrottleRef.current = 0;
                  setAnalogThrottle(0);
                }}
                onMouseLeave={() => {
                  if (pedalThrottleRef.current < 0) {
                    pedalThrottleRef.current = 0;
                    setAnalogThrottle(0);
                  }
                }}
                className="w-15 h-15 rounded-[2px] bg-[#6b7280] active:bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-base leading-none">▼</span>
                <span className="text-[9px] font-mono-num font-extrabold mt-0.5">REV/BRK</span>
              </button>

              <button
                type="button"
                data-testid="mobile-pedal-gas-btn"
                onTouchStart={(e) => {
                  e.preventDefault();
                  pedalThrottleRef.current = 1.0;
                  setAnalogThrottle(1.0);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  pedalThrottleRef.current = 0;
                  if (!cruiseLocked) setAnalogThrottle(0);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  pedalThrottleRef.current = 0;
                  if (!cruiseLocked) setAnalogThrottle(0);
                }}
                onMouseDown={() => {
                  pedalThrottleRef.current = 1.0;
                  setAnalogThrottle(1.0);
                }}
                onMouseUp={() => {
                  pedalThrottleRef.current = 0;
                  if (!cruiseLocked) setAnalogThrottle(0);
                }}
                onMouseLeave={() => {
                  if (pedalThrottleRef.current > 0) {
                    pedalThrottleRef.current = 0;
                    if (!cruiseLocked) setAnalogThrottle(0);
                  }
                }}
                className="w-18 h-18 rounded-[2px] bg-[#fbbf24] active:bg-[#facc15] border-2 border-[#444444] text-[#1a1a1a] font-display font-black text-sm flex flex-col items-center justify-center uppercase"
              >
                <span className="text-xl leading-none">▲</span>
                <span className="text-[11px] font-mono-num font-extrabold tracking-wider mt-0.5">
                  GAS
                </span>
              </button>
            </div>
          </div>
        ) : (
          /* ----------------- ON-FOOT (WALK) MODE ACTION CLUSTER ----------------- */
          <div className="flex flex-col gap-2 items-end pointer-events-auto">
            {/* Top Row: TOOLS ▾ (with Repair Vehicle) + ENTER RIG */}
            <div className="relative flex items-center gap-1.5">
              <button
                type="button"
                data-testid="mobile-drive-actions-btn"
                aria-label="Open player and vehicle tools"
                aria-expanded={driveActionsPopupOpen}
                onClick={() => {
                  const next = !driveActionsPopupOpen;
                  closeAllPopups();
                  setDriveActionsPopupOpen(next);
                }}
                className={`min-h-[38px] px-3 py-1.5 rounded-[2px] border-2 border-[#444444] font-display font-extrabold text-xs uppercase flex items-center justify-center whitespace-nowrap ${
                  driveActionsPopupOpen
                    ? 'bg-[#facc15] text-[#1a1a1a]'
                    : 'bg-[#6b7280] text-[#e5e5e5]'
                }`}
              >
                <span>TOOLS {driveActionsPopupOpen ? '▴' : '▾'}</span>
              </button>

              <button
                type="button"
                data-testid="mobile-walk-enter-btn"
                onClick={() => {
                  closeAllPopups();
                  sim?.toggleEnterExitRig?.();
                }}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-[2px] border-2 border-[#444444] font-display font-black text-xs flex items-center gap-1.5 uppercase whitespace-nowrap ${
                  canEnterVehicle
                    ? 'bg-[#fbbf24] text-[#1a1a1a]'
                    : 'bg-[#1a1a1a] text-[#e5e5e5]'
                }`}
              >
                <span>{canEnterVehicle ? 'ENTER RIG' : 'VEHICLE'}</span>
              </button>
            </div>

            {/* Bottom Row: Compact Horizontal Action Row (DET, USE, JUMP) */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="mobile-walk-secondary-btn"
                onClick={() =>
                  sim?.triggerSecondaryAction
                    ? sim.triggerSecondaryAction()
                    : setSimKey('KeyF', true)
                }
                className="w-13 h-13 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-[8.5px] tracking-wider uppercase font-bold">DET</span>
              </button>

              <button
                type="button"
                data-testid="mobile-walk-primary-btn"
                onClick={() =>
                  sim?.triggerPrimaryAction
                    ? sim.triggerPrimaryAction()
                    : setSimKey('KeyF', true)
                }
                className="w-14 h-13 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] text-[#1a1a1a] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-[9px] tracking-wider uppercase font-extrabold">USE</span>
              </button>

              <button
                type="button"
                data-testid="mobile-walk-jump-btn"
                onTouchStart={(e) => {
                  e.preventDefault();
                  setSimKey('Space', true);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  setSimKey('Space', false);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  setSimKey('Space', false);
                }}
                onMouseDown={() => setSimKey('Space', true)}
                onMouseUp={() => setSimKey('Space', false)}
                onMouseLeave={() => setSimKey('Space', false)}
                className="w-13 h-13 rounded-[2px] bg-[#6b7280] active:bg-[#fbbf24] active:text-[#1a1a1a] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex flex-col items-center justify-center uppercase"
              >
                <span className="text-sm leading-none">▲</span>
                <span className="text-[8.5px] uppercase font-bold">JUMP</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Root-Level Popups for Placement Mode, Edit Tools, and Vehicle/Walk Tools (Rendered outside transformed widget containers so opening a popup never shifts or teleports the buttons!) */}
      {isBuildMode && placementDropdownOpen && (
        <>
          <div
            onClick={() => setPlacementDropdownOpen(false)}
            className="fixed inset-0 bg-black/55 z-[88] pointer-events-auto"
          />
          <div
            data-testid="mobile-placement-mode-dropdown"
            className="fixed inset-x-2.5 top-1/2 -translate-y-1/2 mx-auto w-[min(94vw,440px)] max-h-[calc(100dvh-20px)] overflow-y-auto overscroll-contain touch-pan-y bg-[#1a1a1a]/98 border-2 border-[#fbbf24] rounded-[2px] p-2 grid grid-cols-3 gap-1.5 z-[95] shadow-2xl pointer-events-auto"
          >
            <div className="col-span-3 flex items-center justify-between border-b border-[#383838] pb-1 mb-0.5">
              <span className="text-[10px] font-display font-extrabold text-[#fbbf24] uppercase tracking-wider">
                SELECT PLACEMENT BRUSH
              </span>
              <button
                type="button"
                onClick={() => setPlacementDropdownOpen(false)}
                className="px-2 py-0.5 bg-[#dc2626] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase"
              >
                ✕ CLOSE
              </button>
            </div>
            {PLACEMENT_MODES.map((pm) => {
              const isActive = rigCapabilities.placementMode === pm.id;
              const shortLabel =
                PLACEMENT_MODE_SHORT_LABELS[pm.id] ||
                pm.label.replace(/\s*\(.*\)/, '').toUpperCase();
              return (
                <button
                  key={pm.id}
                  type="button"
                  data-testid={`mobile-place-mode-${pm.id}`}
                  onClick={() => {
                    sim?.setPlacementMode?.(pm.id);
                    setRigCapabilities((r) => ({ ...r, placementMode: pm.id }));
                    setPlacementDropdownOpen(false);
                  }}
                  className={`w-full px-2 py-2 rounded-[2px] border border-[#444444] text-left text-[10.5px] font-mono-num font-bold uppercase flex items-center justify-between ${
                    isActive
                      ? 'bg-[#facc15] text-[#1a1a1a]'
                      : 'bg-[#262626] text-[#e5e5e5]'
                  }`}
                >
                  <span className="truncate">{shortLabel}</span>
                  {isActive && <span className="text-[9px] ml-1">ON</span>}
                </button>
              );
            })}
            {onOpenEcu && (
              <button
                type="button"
                data-testid="mobile-open-ecu-btn"
                onClick={() => {
                  setPlacementDropdownOpen(false);
                  onOpenEcu();
                }}
                className="col-span-3 w-full px-2.5 py-2 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] text-[#1a1a1a] text-left text-xs font-mono-num font-extrabold uppercase flex items-center justify-between"
              >
                <span>MICRO:BIT ECU LOGIC STUDIO</span>
                <span>OPEN</span>
              </button>
            )}
          </div>
        </>
      )}

      {isBuildMode && editPopupOpen && (
        <>
          <div
            onClick={() => setEditPopupOpen(false)}
            className="fixed inset-0 bg-black/55 z-[88] pointer-events-auto"
          />
          <div
            data-testid="mobile-edit-tools-popup"
            className="fixed inset-x-2.5 top-1/2 -translate-y-1/2 mx-auto w-[min(94vw,420px)] max-h-[calc(100dvh-20px)] overflow-y-auto overscroll-contain touch-pan-y bg-[#1a1a1a]/98 border-2 border-[#fbbf24] rounded-[2px] p-2 flex flex-col gap-1.5 z-[95] shadow-2xl pointer-events-auto"
          >
            <div className="flex items-center justify-between border-b border-[#383838] pb-1">
              <span className="text-[10px] font-display font-extrabold text-[#fbbf24] uppercase tracking-wider">
                BUILD EDIT &amp; SYMMETRY TOOLS
              </span>
              <button
                type="button"
                onClick={() => setEditPopupOpen(false)}
                className="px-2 py-0.5 bg-[#dc2626] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase"
              >
                ✕ CLOSE
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                data-testid="mobile-rot-y-btn"
                onClick={() =>
                  sim?.rotatePartY ? sim.rotatePartY() : sim?.rotatePartAxis?.('yaw')
                }
                className="h-10 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex items-center justify-center gap-1 uppercase"
              >
                <span className="text-[9.5px] text-[#fbbf24]">ROT Y</span>
                <span className="text-[10.5px] font-mono-num">90°</span>
              </button>

              <button
                type="button"
                data-testid="mobile-rot-x-btn"
                onClick={() =>
                  sim?.rotatePartX ? sim.rotatePartX() : sim?.rotatePartAxis?.('pitch')
                }
                className="h-10 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex items-center justify-center gap-1 uppercase"
              >
                <span className="text-[9.5px] text-[#fbbf24]">ROT X</span>
                <span className="text-[10.5px] font-mono-num">90°</span>
              </button>

              <button
                type="button"
                data-testid="mobile-rot-z-btn"
                onClick={() =>
                  sim?.rotatePartZ ? sim.rotatePartZ() : sim?.rotatePartAxis?.('roll')
                }
                className="h-10 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-display font-black text-xs flex items-center justify-center gap-1 uppercase"
              >
                <span className="text-[9.5px] text-[#fbbf24]">ROT Z</span>
                <span className="text-[10.5px] font-mono-num">90°</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                data-testid="mobile-mirror-btn"
                onClick={() => {
                  sim?.toggleMirrorMode?.();
                  setRigCapabilities((r) => ({ ...r, mirrorMode: !r.mirrorMode }));
                }}
                className={`h-10 rounded-[2px] border-2 border-[#444444] font-display font-bold text-xs flex items-center justify-center gap-1 uppercase ${
                  rigCapabilities.mirrorMode
                    ? 'bg-[#facc15] text-[#1a1a1a]'
                    : 'bg-[#262626] text-[#e5e5e5]'
                }`}
              >
                <span className="text-[10px]">MIRROR</span>
              </button>

              <button
                type="button"
                data-testid="mobile-undo-btn"
                onClick={() => sim?.undoBuildStep?.()}
                className="h-10 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] font-display font-bold text-xs flex items-center justify-center gap-1 uppercase"
              >
                <span className="text-[10px]">UNDO</span>
              </button>

              <button
                type="button"
                data-testid="mobile-forces-toggle-btn"
                onClick={() => {
                  sim?.toggleForcesOverlay?.();
                  setRigCapabilities((r) => ({
                    ...r,
                    showForcesOverlay: !r.showForcesOverlay,
                  }));
                }}
                className={`h-10 rounded-[2px] border-2 border-[#444444] font-display font-bold text-xs flex items-center justify-center gap-1 uppercase ${
                  rigCapabilities.showForcesOverlay
                    ? 'bg-[#facc15] text-[#1a1a1a]'
                    : 'bg-[#262626] text-[#e5e5e5]'
                }`}
              >
                <span className="text-[10px]">CoM / CoT</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-testid="mobile-prop-studio-btn"
                onClick={() => {
                  setEditPopupOpen(false);
                  if (rigCapabilities.isObjectStudioMode) {
                    sim?.saveObjectStudioToWorldEditor?.();
                  } else {
                    sim?.toggleObjectStudioMode?.(true);
                  }
                }}
                className="h-9 rounded-[2px] bg-[#22c55e] border-2 border-[#444444] text-[#1a1a1a] font-display font-extrabold text-[10.5px] flex items-center justify-center gap-1 uppercase"
              >
                <span>
                  {rigCapabilities.isObjectStudioMode ? 'SAVE PROP' : '+ MAKE PROP'}
                </span>
              </button>

              <button
                type="button"
                data-testid="mobile-1block-core-btn"
                onClick={() => {
                  setEditPopupOpen(false);
                  sim?.startVehicleFromSingleVoxel?.();
                }}
                className="h-9 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] font-display font-bold text-[10px] flex items-center justify-center gap-1 uppercase"
              >
                <span>1-VOXEL CORE</span>
              </button>
            </div>
          </div>
        </>
      )}

      {!isBuildMode && !isWorldEditMode && isSeatedInRig && driveActionsPopupOpen && (
        <>
          <div
            onClick={() => setDriveActionsPopupOpen(false)}
            className="fixed inset-0 bg-black/55 z-[88] pointer-events-auto"
          />
          <div
            data-testid="mobile-drive-actions-popup"
            className="fixed inset-x-2.5 top-1/2 -translate-y-1/2 mx-auto w-[min(94vw,460px)] max-h-[calc(100dvh-20px)] overflow-y-auto overscroll-contain touch-pan-y bg-[#1a1a1a]/98 border-2 border-[#fbbf24] rounded-[2px] p-2 grid grid-cols-4 gap-1.5 z-[95] shadow-2xl pointer-events-auto"
          >
            <div className="col-span-4 flex items-center justify-between border-b border-[#383838] pb-1 mb-0.5">
              <span className="text-[10px] font-display font-extrabold text-[#fbbf24] uppercase tracking-wider">
                VEHICLE TOOLS &amp; ARENA PROPS
              </span>
              <button
                type="button"
                onClick={() => setDriveActionsPopupOpen(false)}
                className="px-2 py-0.5 bg-[#dc2626] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase"
              >
                ✕ CLOSE
              </button>
            </div>

            <button
              type="button"
              data-testid="mobile-drive-repair-btn"
              onClick={() => {
                sim?.flipSummonRig?.();
                setDriveActionsPopupOpen(false);
              }}
              className="px-2 py-2 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] text-[#1a1a1a] font-mono-num font-extrabold text-[10px] text-center uppercase"
            >
              REPAIR
            </button>

            <button
              type="button"
              data-testid="mobile-drive-upright-btn"
              onClick={() => {
                sim?.callAndUprightRig?.();
                setDriveActionsPopupOpen(false);
              }}
              className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] text-center uppercase"
            >
              UPRIGHT
            </button>

            <button
              type="button"
              data-testid="mobile-cruise-lock-btn"
              onClick={() => {
                const next = !cruiseLocked;
                setCruiseLocked(next);
                setAnalogThrottle(next ? 1.0 : 0);
                setDriveActionsPopupOpen(false);
              }}
              className={`px-2 py-2 rounded-[2px] border-2 border-[#444444] font-mono-num font-bold text-[10px] text-center uppercase ${
                cruiseLocked
                  ? 'bg-[#facc15] text-[#1a1a1a]'
                  : 'bg-[#262626] text-[#e5e5e5]'
              }`}
            >
              CRUISE {cruiseLocked ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              data-testid="mobile-drive-lights-btn"
              onClick={() => {
                sim?.getActiveRig?.()?.toggleHeadlights?.();
                setDriveActionsPopupOpen(false);
              }}
              className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] text-center uppercase"
            >
              LIGHTS
            </button>

            {rigCapabilities.hasGyro && (
              <button
                type="button"
                data-testid="mobile-drive-gyro-btn"
                onClick={() => {
                  const r = sim?.getActiveRig?.();
                  if (r) {
                    if (typeof r.toggleGyro === 'function') {
                      r.toggleGyro();
                    } else if ((r.gyroCount || 0) > 0) {
                      r.gyroEnabled = !r.gyroEnabled;
                    }
                  }
                  setDriveActionsPopupOpen(false);
                }}
                className={`px-2 py-2 rounded-[2px] border-2 border-[#444444] font-mono-num font-bold text-[10px] text-center uppercase ${
                  rigCapabilities.gyroEnabled
                    ? 'bg-[#facc15] text-[#1a1a1a]'
                    : 'bg-[#262626] text-[#e5e5e5]'
                }`}
              >
                GYRO
              </button>
            )}

            {rigCapabilities.hasPistons && (
              <button
                type="button"
                data-testid="mobile-drive-piston-btn"
                onClick={() => {
                  sim?.getActiveRig?.()?.togglePistons?.();
                  setDriveActionsPopupOpen(false);
                }}
                className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] font-mono-num font-bold text-[10px] text-center uppercase"
              >
                PISTONS
              </button>
            )}

            {rigCapabilities.hasWinch && (
              <button
                type="button"
                data-testid="mobile-drive-winch-btn"
                onClick={() => {
                  if (sim?.camera) {
                    const dir = sim.camera.getWorldDirection(sim.camFreePos.clone());
                    sim.getActiveRig?.()?.toggleWinch?.(sim.camera.position, dir);
                  }
                  setDriveActionsPopupOpen(false);
                }}
                className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] text-center uppercase"
              >
                WINCH
              </button>
            )}

            {!rigCapabilities.hasCannons && !rigCapabilities.hasMelee && (
              <button
                type="button"
                data-testid="mobile-drive-fire-btn"
                onClick={() => {
                  const ar = sim?.getActiveRig?.();
                  ar?.fireCannons?.();
                  ar?.applyMeleeCombatStep?.(sim?.getAllPhysicsRigs?.() || [], true);
                  setDriveActionsPopupOpen(false);
                }}
                className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] text-center uppercase"
              >
                FIRE
              </button>
            )}

            <button
              type="button"
              data-testid="mobile-exit-vehicle-btn"
              onClick={() => {
                setDriveActionsPopupOpen(false);
                sim?.toggleEnterExitRig?.();
              }}
              className="col-span-2 px-2 py-2 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] text-center uppercase"
            >
              EXIT VEHICLE
            </button>

            <div className="col-span-4 border-t border-[#444444] pt-1.5 mt-0.5 grid grid-cols-3 gap-1">
              <button
                type="button"
                data-testid="mobile-spawn-entity-cone"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('TRAFFIC_CONE');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#fb923c] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + CONE
              </button>
              <button
                type="button"
                data-testid="mobile-spawn-entity-crate"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('WOOD_CRATE');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#fbbf24] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + CRATE
              </button>
              <button
                type="button"
                data-testid="mobile-spawn-entity-barrel"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('EXPLOSIVE_BARREL');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#ef4444] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + C4 DRUM
              </button>
              <button
                type="button"
                data-testid="mobile-spawn-entity-ball"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('STUNT_BALL');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#38bdf8] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + BALL
              </button>
              <button
                type="button"
                data-testid="mobile-spawn-entity-pin"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('BOWLING_PIN');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + PIN
              </button>
              <button
                type="button"
                data-testid="mobile-reset-entities-btn"
                onClick={() => {
                  sim?.resetArenaVoxelEntities?.();
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#6b7280] border border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                RESET PROPS
              </button>
            </div>
          </div>
        </>
      )}

      {!isBuildMode && !isWorldEditMode && !isSeatedInRig && driveActionsPopupOpen && (
        <>
          <div
            onClick={() => setDriveActionsPopupOpen(false)}
            className="fixed inset-0 bg-black/55 z-[88] pointer-events-auto"
          />
          <div
            data-testid="mobile-drive-actions-popup"
            className="fixed inset-x-2.5 top-1/2 -translate-y-1/2 mx-auto w-[min(94vw,460px)] max-h-[calc(100dvh-20px)] overflow-y-auto overscroll-contain touch-pan-y bg-[#1a1a1a]/98 border-2 border-[#fbbf24] rounded-[2px] p-2 grid grid-cols-3 gap-1.5 z-[95] shadow-2xl pointer-events-auto"
          >
            <div className="col-span-3 flex items-center justify-between border-b border-[#383838] pb-1 mb-0.5">
              <span className="text-[10px] font-display font-extrabold text-[#fbbf24] uppercase tracking-wider">
                ON-FOOT &amp; VEHICLE TOOLS
              </span>
              <button
                type="button"
                onClick={() => setDriveActionsPopupOpen(false)}
                className="px-2 py-0.5 bg-[#dc2626] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase"
              >
                ✕ CLOSE
              </button>
            </div>

            <button
              type="button"
              data-testid="mobile-drive-repair-btn"
              onClick={() => {
                sim?.flipSummonRig?.();
                setDriveActionsPopupOpen(false);
              }}
              className="px-2.5 py-2 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] text-[#1a1a1a] font-display font-extrabold text-[10.5px] text-center uppercase"
            >
              REPAIR RIG
            </button>

            <button
              type="button"
              data-testid="mobile-drive-upright-btn"
              onClick={() => {
                sim?.callAndUprightRig?.();
                setDriveActionsPopupOpen(false);
              }}
              className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] text-center uppercase"
            >
              UPRIGHT / CALL
            </button>

            <button
              type="button"
              data-testid="mobile-walk-tools-enter-btn"
              onClick={() => {
                setDriveActionsPopupOpen(false);
                sim?.toggleEnterExitRig?.();
              }}
              className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] font-mono-num font-bold text-[10px] text-center uppercase"
            >
              ENTER RIG
            </button>

            <button
              type="button"
              data-testid="mobile-drive-lights-btn"
              onClick={() => {
                sim?.getActiveRig?.()?.toggleHeadlights?.();
                setDriveActionsPopupOpen(false);
              }}
              className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] text-center uppercase"
            >
              RIG LIGHTS
            </button>

            <button
              type="button"
              data-testid="mobile-walk-tools-cam-btn"
              onClick={() => {
                sim?.cycleCameraMode?.();
                setDriveActionsPopupOpen(false);
              }}
              className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[10px] text-center uppercase"
            >
              CAMERA VIEW
            </button>

            {onOpenGarage && (
              <button
                type="button"
                data-testid="mobile-walk-tools-garage-btn"
                onClick={() => {
                  setDriveActionsPopupOpen(false);
                  onOpenGarage();
                }}
                className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] font-mono-num font-bold text-[10px] text-center uppercase"
              >
                GARAGE
              </button>
            )}

            {onOpenMap && (
              <button
                type="button"
                data-testid="mobile-walk-tools-map-btn"
                onClick={() => {
                  setDriveActionsPopupOpen(false);
                  onOpenMap();
                }}
                className="px-2 py-2 rounded-[2px] bg-[#262626] border-2 border-[#444444] text-[#fbbf24] font-mono-num font-bold text-[10px] text-center uppercase"
              >
                WORLD MAP
              </button>
            )}

            <div className="col-span-3 border-t border-[#444444] pt-1.5 mt-0.5 grid grid-cols-3 gap-1">
              <button
                type="button"
                data-testid="mobile-walk-spawn-cone"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('TRAFFIC_CONE');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#fb923c] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + CONE
              </button>
              <button
                type="button"
                data-testid="mobile-walk-spawn-crate"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('WOOD_CRATE');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#fbbf24] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + CRATE
              </button>
              <button
                type="button"
                data-testid="mobile-walk-spawn-barrel"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('EXPLOSIVE_BARREL');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#ef4444] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + C4 DRUM
              </button>
              <button
                type="button"
                data-testid="mobile-walk-spawn-ball"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('STUNT_BALL');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#38bdf8] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + BALL
              </button>
              <button
                type="button"
                data-testid="mobile-walk-spawn-pin"
                onClick={() => {
                  sim?.spawnVoxelEntityAt?.('BOWLING_PIN');
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#262626] border border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                + PIN
              </button>
              <button
                type="button"
                data-testid="mobile-walk-reset-entities"
                onClick={() => {
                  sim?.resetArenaVoxelEntities?.();
                  setDriveActionsPopupOpen(false);
                }}
                className="px-1.5 py-1.5 rounded-[2px] bg-[#6b7280] border border-[#444444] text-[#e5e5e5] font-mono-num font-bold text-[9.5px] text-center uppercase"
              >
                RESET PROPS
              </button>
            </div>
          </div>
        </>
      )}

      {/* ============================================================== */}
      {/* 5. REQUIREMENT 5: COLLAPSIBLE PARTS DRAWER (HIDDEN BY DEFAULT) */}
      {/* ============================================================== */}
      {isBuildMode && partsDrawerOpen && (
        <>
          {/* Dimmed 3D Viewport Backdrop when Parts Drawer is open (tap outside to close) */}
          <div
            data-testid="mobile-parts-drawer-backdrop"
            onClick={() => setPartsDrawerOpen(false)}
            className="fixed inset-0 bg-black/60 pointer-events-auto z-40"
          />

          {/* Slide-Up 35% Screen Height Parts Drawer */}
          <div
            data-testid="mobile-parts-drawer"
            className="fixed bottom-0 left-0 right-0 h-[35vh] min-h-[195px] max-h-[245px] bg-[#1a1a1a] border-t-2 border-[#444444] rounded-none p-2.5 flex flex-col gap-2 pointer-events-auto z-50"
          >
            {/* Drawer Header + Category Tabs (or Prop Material Swatches in Object Studio) + Close Button */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 flex-1">
                {rigCapabilities.isObjectStudioMode
                  ? MOBILE_PROP_MATERIALS.map((pm) => {
                      const hex =
                        '#' + ((MAT_INFO[pm.mat]?.color ?? 0xffffff) >>> 0).toString(16).padStart(6, '0');
                      const isMatSel = rigCapabilities.objectStudioMat === pm.mat;
                      return (
                        <button
                          key={pm.mat}
                          type="button"
                          onClick={() => {
                            sim?.setObjectStudioMat?.(pm.mat);
                            setRigCapabilities((r) => ({ ...r, objectStudioMat: pm.mat }));
                          }}
                          className={`px-2 py-1 rounded-[2px] border-2 text-[10px] font-display font-black whitespace-nowrap uppercase flex items-center gap-1 ${
                            isMatSel
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                              : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-[1px] border border-[#1a1a1a]"
                            style={{ backgroundColor: hex }}
                          />
                          <span>{pm.name}</span>
                        </button>
                      );
                    })
                  : MOBILE_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        data-testid={`mobile-cat-${cat.id.toLowerCase()}`}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`px-2.5 py-1 rounded-[2px] border-2 border-[#444444] text-[10px] font-display font-black whitespace-nowrap uppercase flex items-center gap-1 ${
                          selectedCategory === cat.id
                            ? 'bg-[#facc15] text-[#1a1a1a]'
                            : 'bg-[#262626] text-[#e5e5e5]'
                        }`}
                      >
                        <span>{cat.label}</span>
                      </button>
                    ))}
              </div>
              <button
                type="button"
                data-testid="mobile-parts-drawer-close-btn"
                aria-label="Close parts drawer"
                onClick={() => setPartsDrawerOpen(false)}
                className="px-2.5 py-1 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] text-xs font-mono-num font-bold shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Parts Grid / Strip with 3D Spinning Block Previews */}
            <div
              data-testid="mobile-build-parts-scroll"
              data-catalog-scroll-container="true"
              data-ui-scroll="true"
              className="flex-1 min-h-0 grid grid-cols-4 sm:grid-cols-6 gap-2 overflow-y-auto pr-1 content-start"
            >
              {(rigCapabilities.isObjectStudioMode
                ? OBJECT_STUDIO_SLOTS
                : getFilteredBuildSlots()
              ).map((item) => {
                const isSelected = activeSlot === item.slot;
                const itemKey = getItemPreviewKey
                  ? getItemPreviewKey(item)
                  : `${rigCapabilities.isObjectStudioMode ? 'studio' : 'build'}_${item.slot}_${item.name}`;
                return (
                  <button
                    key={item.slot}
                    type="button"
                    data-testid={`mobile-part-slot-${item.slot}`}
                    onClick={() => {
                      setActiveSlot(item.slot);
                      setRecentBuildSlots((prev) => {
                        const filtered = prev.filter((s) => s !== item.slot);
                        return [item.slot, ...filtered].slice(0, 4);
                      });
                      sim?.selectSlot?.(item.slot);
                      setPartsDrawerOpen(false);
                    }}
                    className={`relative h-[74px] min-h-[74px] rounded-[2px] flex flex-col items-center justify-between p-1 border-2 overflow-hidden ${
                      isSelected
                        ? 'border-[#facc15] bg-[#2a2a2a] text-[#e5e5e5]'
                        : 'border-[#444444] bg-[#222222] text-[#e5e5e5]'
                    }`}
                  >
                    <div className="relative w-full flex items-center justify-center h-[48px] shrink-0">
                      <span
                        className="absolute top-0 left-0 px-1 py-0.5 rounded-[2px] bg-[#141414] border border-[#444444] text-[7.5px] font-mono-num font-bold leading-none z-10"
                        style={{ color: item.color }}
                      >
                        #{item.slot}
                      </span>
                      <span className="absolute top-0 right-0 text-[7.5px] font-mono-num font-bold text-[#a3a3a3] leading-none z-10">
                        {item.massKg}kg
                      </span>
                      <div
                        ref={(node) => {
                          registerPreviewSlot?.(itemKey, node);
                        }}
                        data-preview-slot={itemKey}
                        className="w-[46px] h-[46px] shrink-0 flex items-center justify-center relative z-10 bg-transparent"
                      />
                    </div>
                    <span
                      className={`text-[8.5px] font-display font-bold uppercase truncate max-w-full text-center leading-tight border-t border-[#444444] w-full pt-0.5 ${
                        isSelected ? 'text-[#facc15]' : 'text-[#e5e5e5]'
                      }`}
                    >
                      {item.name.replace(/(Standard|Heavy|Light|Offroad|Go-Kart)\s*/g, '')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ============================================================== */}
      {/* 5A-2. MOBILE BUILD QUICK RECENT PARTS HOTBAR (4 SLOTS + 3D PREVIEWS) */}
      {/* ============================================================== */}
      {isBuildMode &&
        !partsDrawerOpen &&
        !menuPopupOpen &&
        !placementDropdownOpen &&
        !editPopupOpen &&
        getWidgetState(hudCustom, 'mobile-recent-hotbar').visible && (
        <div
          data-testid="mobile-quick-recent-hotbar"
          data-hud-widget="mobile-recent-hotbar"
          data-hud-label="QUICK PARTS HOTBAR"
          style={getWidgetTransformStyle(
            hudCustom,
            'mobile-recent-hotbar',
            undefined,
            'bottom center',
            true,
          )}
          className="fixed bottom-14 left-1/2 flex items-center gap-1.5 bg-[#1a1a1a]/95 border-2 border-[#444444] rounded-[2px] p-1 pointer-events-auto z-30"
        >
          {recentBuildSlots.map((slotNum) => {
            const slotPool = rigCapabilities.isObjectStudioMode
              ? OBJECT_STUDIO_SLOTS
              : BUILD_SLOTS;
            const item = slotPool.find((s) => s.slot === slotNum) || slotPool[0];
            if (!item) return null;
            const isSel = activeSlot === item.slot;
            const itemKey = getItemPreviewKey
              ? getItemPreviewKey(item)
              : `hotbar_${item.slot}_${item.name}`;
            return (
              <button
                key={item.slot}
                type="button"
                data-testid={`mobile-quick-slot-${item.slot}`}
                onClick={() => {
                  setActiveSlot(item.slot);
                  sim?.selectSlot?.(item.slot);
                }}
                className={`relative w-[56px] h-[54px] rounded-[2px] flex flex-col items-center justify-between p-0.5 border-2 overflow-hidden ${
                  isSel
                    ? 'border-[#facc15] bg-[#2a2a2a]'
                    : 'border-[#444444] bg-[#222222]'
                }`}
              >
                <div
                  ref={(node) => {
                    registerPreviewSlot?.(itemKey, node);
                  }}
                  data-preview-slot={itemKey}
                  className="w-[36px] h-[36px] shrink-0 flex items-center justify-center relative z-10 bg-transparent"
                />
                <span className="text-[7.5px] font-display font-bold uppercase truncate w-full text-center text-[#e5e5e5] leading-none">
                  {item.name.replace(/(Standard|Heavy|Light|Offroad|Go-Kart)\s*/g, '')}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ============================================================== */}
      {/* 5B. MOBILE WORLD EDIT CATALOG DRAWER (OBJECTS / HAZARDS / TERRA) */}
      {/* ============================================================== */}
      {isWorldEditMode && worldCatalogOpen && (
        <>
          <div
            data-testid="mobile-world-catalog-backdrop"
            onClick={() => setWorldCatalogOpen(false)}
            className="fixed inset-0 bg-black/60 pointer-events-auto z-40"
          />
          <div
            data-testid="mobile-world-catalog-drawer"
            className="fixed bottom-0 left-0 right-0 h-[42vh] min-h-[210px] max-h-[290px] bg-[#1a1a1a] border-t-2 border-[#fbbf24] p-2.5 flex flex-col gap-2 pointer-events-auto z-50"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#333333] pb-1.5">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <span className="text-[11px] font-display font-extrabold text-[#fbbf24] uppercase whitespace-nowrap">
                  {rigCapabilities.worldEditTool === 'SPAWN_MAP_HAZARD'
                    ? 'SPINNING HAZARDS'
                    : rigCapabilities.worldEditTool === 'SPAWN_VOXEL_ENTITY'
                      ? 'VOXEL ENTITIES'
                      : rigCapabilities.worldEditTool === 'PLACE_OBJECT' ||
                          rigCapabilities.worldEditTool === 'PLACE_PROP'
                        ? 'PREFABS & PROPS'
                        : 'TERRAFORM BRUSH & PAINT'}
                </span>
                {(rigCapabilities.worldEditTool === 'PLACE_OBJECT' ||
                  rigCapabilities.worldEditTool === 'PLACE_PROP') && (
                  <>
                    <button
                      type="button"
                      onClick={() => sim?.togglePropPhysicsMode?.()}
                      className={`px-2 py-0.5 rounded-[2px] border text-[9.5px] font-mono-num font-bold uppercase whitespace-nowrap ${
                        rigCapabilities.propPhysicsMode === 'DYNAMIC'
                          ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#e5e5e5]'
                          : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                      }`}
                    >
                      {rigCapabilities.propPhysicsMode === 'DYNAMIC' ? '6-DOF DYNAMIC' : 'STATIC STAMP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        sim?.spawnCurrentPropInFront?.();
                        setWorldCatalogOpen(false);
                      }}
                      className="px-2 py-0.5 rounded-[2px] bg-[#22c55e] text-[#1a1a1a] border border-[#444444] text-[9.5px] font-display font-extrabold uppercase whitespace-nowrap"
                    >
                      + DROP IN FRONT
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWorldCatalogOpen(false);
                        sim?.toggleObjectStudioMode?.(true);
                      }}
                      className="px-2 py-0.5 rounded-[2px] bg-[#fbbf24] text-[#1a1a1a] border border-[#444444] text-[9.5px] font-display font-extrabold uppercase whitespace-nowrap"
                    >
                      + MAKE PROP
                    </button>
                  </>
                )}
                {rigCapabilities.worldEditTool === 'SPAWN_MAP_HAZARD' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        sim?.spawnMapHazardAt?.(rigCapabilities.selectedMapHazardId);
                        setWorldCatalogOpen(false);
                      }}
                      className="px-2 py-0.5 rounded-[2px] bg-[#22c55e] text-[#1a1a1a] border border-[#444444] text-[9.5px] font-display font-extrabold uppercase whitespace-nowrap"
                    >
                      + PLACE IN FRONT
                    </button>
                    <button
                      type="button"
                      onClick={() => sim?.resetArenaMapHazards?.()}
                      className="px-2 py-0.5 rounded-[2px] bg-[#262626] text-[#e5e5e5] border border-[#444444] text-[9.5px] font-display font-bold uppercase whitespace-nowrap"
                    >
                      RESET
                    </button>
                  </>
                )}
                {rigCapabilities.worldEditTool === 'SPAWN_VOXEL_ENTITY' && (
                  <button
                    type="button"
                    onClick={() => {
                      sim?.spawnVoxelEntityAt?.(rigCapabilities.selectedVoxelEntityId);
                      setWorldCatalogOpen(false);
                    }}
                    className="px-2 py-0.5 rounded-[2px] bg-[#22c55e] text-[#1a1a1a] border border-[#444444] text-[9.5px] font-display font-extrabold uppercase whitespace-nowrap"
                  >
                    + DROP IN FRONT
                  </button>
                )}
              </div>
              <button
                type="button"
                data-testid="mobile-world-catalog-close-btn"
                onClick={() => setWorldCatalogOpen(false)}
                className="px-2.5 py-1 rounded-[2px] bg-[#dc2626] border-2 border-[#444444] text-[#e5e5e5] text-xs font-mono-num font-bold shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              {rigCapabilities.worldEditTool === 'SPAWN_MAP_HAZARD' ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {MAP_HAZARD_PRESETS.map((haz) => {
                    const isSel = rigCapabilities.selectedMapHazardId === haz.id;
                    return (
                      <button
                        key={haz.id}
                        type="button"
                        onClick={() => {
                          sim?.selectMapHazardPreset?.(haz.id);
                          setRigCapabilities((r) => ({ ...r, selectedMapHazardId: haz.id }));
                          setWorldCatalogOpen(false);
                        }}
                        className={`p-2 rounded-[2px] border-2 text-left ${
                          isSel
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        <div className="text-[10.5px] font-display font-extrabold uppercase truncate">
                          {haz.name}
                        </div>
                        <div className="text-[9px] font-mono-num opacity-80 truncate">
                          {haz.category} · {haz.rpm} RPM
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : rigCapabilities.worldEditTool === 'SPAWN_VOXEL_ENTITY' ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {VOXEL_ENTITY_PRESETS.map((ent) => {
                    const isSel = rigCapabilities.selectedVoxelEntityId === ent.id;
                    return (
                      <button
                        key={ent.id}
                        type="button"
                        onClick={() => {
                          sim?.selectVoxelEntityPreset?.(ent.id);
                          setRigCapabilities((r) => ({ ...r, selectedVoxelEntityId: ent.id }));
                          setWorldCatalogOpen(false);
                        }}
                        className={`p-2 rounded-[2px] border-2 text-left ${
                          isSel
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        <div className="text-[10.5px] font-display font-extrabold uppercase truncate">
                          {ent.name}
                        </div>
                        <div className="text-[9px] font-mono-num opacity-80 truncate">
                          {ent.category}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : rigCapabilities.worldEditTool === 'PLACE_OBJECT' ||
                rigCapabilities.worldEditTool === 'PLACE_PROP' ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {(sim?.allPlaceableObjects || PREBUILT_OBJECTS).map((obj: any) => {
                    const isSel = rigCapabilities.selectedObjectId === obj.id;
                    return (
                      <button
                        key={obj.id}
                        type="button"
                        onClick={() => {
                          sim?.selectPlaceableObject?.(obj.id);
                          setRigCapabilities((r) => ({ ...r, selectedObjectId: obj.id }));
                          setWorldCatalogOpen(false);
                        }}
                        className={`p-2 rounded-[2px] border-2 text-left ${
                          isSel
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        <div className="text-[10.5px] font-display font-extrabold uppercase truncate">
                          {obj.name}
                        </div>
                        <div className="text-[9px] font-mono-num opacity-80">
                          {obj.category} · {obj.sizeX}×{obj.sizeZ}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono-num font-bold text-[#a3a3a3] uppercase">
                      BRUSH SIZE:
                    </span>
                    {[4, 8, 12, 16].map((rad) => (
                      <button
                        key={rad}
                        type="button"
                        onClick={() => {
                          sim?.setTerraBrushRadius?.(rad);
                          setRigCapabilities((r) => ({ ...r, terraBrushRadius: rad }));
                        }}
                        className={`px-2.5 py-1 rounded-[2px] border-2 text-[10px] font-mono-num font-bold ${
                          rigCapabilities.terraBrushRadius === rad
                            ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                            : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                        }`}
                      >
                        R:{rad}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {MOBILE_TERRA_MATERIALS.map((tm) => {
                      const hex =
                        '#' + ((MAT_INFO[tm.mat]?.color ?? 0xffffff) >>> 0).toString(16).padStart(6, '0');
                      const isSel = rigCapabilities.terraPaintMat === tm.mat;
                      return (
                        <button
                          key={tm.mat}
                          type="button"
                          onClick={() => {
                            sim?.setTerraPaintMat?.(tm.mat);
                            setRigCapabilities((r) => ({ ...r, terraPaintMat: tm.mat }));
                            setWorldCatalogOpen(false);
                          }}
                          className={`p-1.5 rounded-[2px] border-2 flex items-center gap-1.5 ${
                            isSel
                              ? 'bg-[#facc15] text-[#1a1a1a] border-[#e5e5e5]'
                              : 'bg-[#262626] text-[#e5e5e5] border-[#444444]'
                          }`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-[2px] border border-[#1a1a1a] shrink-0"
                            style={{ backgroundColor: hex }}
                          />
                          <span className="text-[10px] font-display font-bold uppercase truncate">
                            {tm.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Bottom Bar at Rest: 1 "PARTS ▾" Button in Build Mode, or World Edit / Walk Bar */}
      {(isBuildMode || isWorldEditMode || !isSeatedInRig) &&
        getWidgetState(
          hudCustom,
          isBuildMode
            ? 'mobile-parts-bar'
            : isWorldEditMode
              ? 'mobile-world-bar'
              : 'mobile-walk-bar',
        ).visible && (
      <div
        data-hud-widget={
          isBuildMode
            ? 'mobile-parts-bar'
            : isWorldEditMode
              ? 'mobile-world-bar'
              : 'mobile-walk-bar'
        }
        data-hud-label={
          isBuildMode
            ? 'PARTS DRAWER BTN'
            : isWorldEditMode
              ? 'WORLD EDIT TOOLS'
              : 'ON-FOOT TOOLS BAR'
        }
        style={getWidgetTransformStyle(
          hudCustom,
          isBuildMode
            ? 'mobile-parts-bar'
            : isWorldEditMode
              ? 'mobile-world-bar'
              : 'mobile-walk-bar',
          undefined,
          'bottom center',
          true,
        )}
        className="fixed bottom-2 left-1/2 w-fit max-w-[calc(100vw-16px)] flex flex-col items-center pointer-events-none z-30"
      >
        {isBuildMode ? (
          !partsDrawerOpen && (
            <button
              type="button"
              data-testid="mobile-parts-drawer-toggle-btn"
              aria-label="Open parts catalog drawer"
              aria-expanded={partsDrawerOpen}
              onClick={() => {
                closeAllPopups();
                setPartsDrawerOpen(true);
              }}
              className="min-h-[38px] px-4 py-1.5 rounded-[2px] bg-[#1a1a1a] border-2 border-[#444444] text-[#e5e5e5] font-display font-extrabold text-xs uppercase flex items-center gap-2 pointer-events-auto"
            >
              <span
                className="w-3.5 h-3.5 rounded-[2px] border border-[#e5e5e5] shrink-0"
                style={{ backgroundColor: currentSelectedPart.color }}
              />
              <span className="truncate max-w-[120px] text-[#fbbf24]">
                {currentSelectedPart.name.replace(/(Standard|Heavy|Light)\s*/g, '')}
              </span>
              <span>{rigCapabilities.isObjectStudioMode ? 'SHAPES ▾' : 'PARTS ▾'}</span>
            </button>
          )
        ) : isWorldEditMode ? (
          !worldCatalogOpen && (
            <div
              data-testid="mobile-world-edit-bar"
              className="w-full max-w-xl bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-1.5 flex items-center justify-between gap-1 overflow-x-auto no-scrollbar pointer-events-auto"
            >
              <div className="flex items-center gap-1">
                {WORLD_EDIT_TOOLS.map((t) => {
                  const activeTool = rigCapabilities.worldEditTool === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      data-testid={`mobile-world-tool-${t.id}`}
                      onClick={() => {
                        sim?.setWorldEditTool?.(t.id);
                        setRigCapabilities((r) => ({ ...r, worldEditTool: t.id }));
                        if (
                          t.id === 'PLACE_OBJECT' ||
                          t.id === 'PLACE_PROP' ||
                          t.id === 'SPAWN_MAP_HAZARD' ||
                          t.id === 'SPAWN_VOXEL_ENTITY' ||
                          t.id === 'TERRA_PAINT'
                        ) {
                          setWorldCatalogOpen(true);
                        }
                      }}
                      className={`px-2 py-1 rounded-[2px] text-[10px] font-mono-num font-bold whitespace-nowrap uppercase border-2 border-[#444444] ${
                        activeTool
                          ? 'bg-[#facc15] text-[#1a1a1a]'
                          : 'bg-[#262626] text-[#e5e5e5]'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        ) : !isSeatedInRig ? (
          <div
            data-testid="mobile-tool-carousel"
            className="bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] p-1 flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[min(56vw,430px)] pointer-events-auto touch-pan-x"
          >
            {PLAY_SLOTS.map((tool: PlaySlotItem) => {
              const isSelected = activeSlot === tool.slot;
              const shortLabel = tool.name
                .replace(/FIELD WELDER \(BLOCK 1x1\)/i, 'WELDER')
                .replace(/SLEDGEHAMMER/i, 'HAMMER')
                .replace(/C4 CHARGE/i, 'C4')
                .replace(/PLASMA GUN/i, 'PLASMA')
                .replace(/(Heavy|Sticky|Handheld|Light)\s*/g, '')
                .replace(/\s+\d+x\d+/g, '');
              return (
                <button
                  key={tool.slot}
                  type="button"
                  data-testid={`mobile-tool-slot-${tool.slot}`}
                  onClick={() => {
                    setActiveSlot(tool.slot);
                    sim?.selectSlot?.(tool.slot);
                  }}
                  className={`flex-shrink-0 px-2 py-1.5 rounded-[2px] border-2 border-[#444444] flex items-center gap-1 ${
                    isSelected
                      ? 'bg-[#facc15] text-[#1a1a1a] font-black'
                      : 'bg-[#262626] text-[#e5e5e5] font-bold'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-[2px] inline-block flex-shrink-0"
                    style={{ backgroundColor: tool.color }}
                  />
                  <span className="text-[10px] font-display">[{tool.slot}]</span>
                  <span className="text-[9.5px] font-display uppercase tracking-tight whitespace-nowrap">
                    {shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      )}
    </div>
  );
};
