import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMobileDevice,
  checkIsMobileDevice,
  isMobilePopupLayout,
  computeAnalogTouchDriveInput,
  computeTouchOrbitCameraState,
  computeRenderDistanceTuning,
  computeTacticalMapRenderRadiusChunks,
  MOBILE_BUILD_QUICK_ACTIONS,
} from './touchControls.ts';
import {
  DEFAULT_HUD_CUSTOM_SETTINGS,
  getWidgetState,
  patchWidgetState,
  getWidgetTransformStyle,
  sanitizeHudCustomSettings,
  clampWidgetBoxToViewport,
  registerHudUiMode,
  getRegisteredHudUiModes,
  clearRegisteredHudUiModes,
} from './ui/hudCustomization.ts';

test('isMobileDevice returns false in default node/desktop environment', () => {
  assert.equal(isMobileDevice(), false);
});

test('isMobilePopupLayout differentiates mobile portrait, mobile landscape, and laptop screens', () => {
  // Laptop / Desktop (1440x900, 1280x720) -> false (laptop popup layout)
  assert.equal(
    isMobilePopupLayout({ isMobileHud: false, innerWidth: 1440, innerHeight: 900, override: 'AUTO' }),
    false,
  );
  assert.equal(
    isMobilePopupLayout({ isMobileHud: false, innerWidth: 1280, innerHeight: 720, override: 'AUTO' }),
    false,
  );
  // Mobile portrait (390x844) -> true (mobile popup layout)
  assert.equal(
    isMobilePopupLayout({ isMobileHud: false, innerWidth: 390, innerHeight: 844, override: 'AUTO' }),
    true,
  );
  // Mobile landscape (844x390) -> true (mobile popup layout)
  assert.equal(
    isMobilePopupLayout({ isMobileHud: false, innerWidth: 844, innerHeight: 390, override: 'AUTO' }),
    true,
  );
  // Touch HUD active -> true
  assert.equal(
    isMobilePopupLayout({ isMobileHud: true, innerWidth: 1024, innerHeight: 768, override: 'AUTO' }),
    true,
  );
});

test('checkIsMobileDevice returns true when mobile query param is supplied', () => {
  assert.equal(checkIsMobileDevice({ search: '?autostart=1&mobile=1' }), true);
  assert.equal(checkIsMobileDevice({ search: '?touch=1' }), true);
});

test('checkIsMobileDevice honors manual override ON and OFF', () => {
  assert.equal(
    checkIsMobileDevice({
      search: '',
      hasTouchStart: false,
      maxTouchPoints: 0,
      matchesCoarse: false,
      innerWidth: 1920,
      override: 'ON',
    }),
    true,
  );
  assert.equal(
    checkIsMobileDevice({
      search: '?mobile=1',
      hasTouchStart: true,
      maxTouchPoints: 5,
      matchesCoarse: true,
      innerWidth: 390,
      override: 'OFF',
    }),
    false,
  );
});

test('checkIsMobileDevice returns false when desktop query param is supplied', () => {
  assert.equal(
    checkIsMobileDevice({
      search: '?desktop=1',
      maxTouchPoints: 5,
      matchesCoarse: true,
      innerWidth: 390,
    }),
    false,
  );
});

test('checkIsMobileDevice returns false on desktop with fine mouse pointer and large viewport', () => {
  assert.equal(
    checkIsMobileDevice({
      search: '',
      hasTouchStart: false,
      maxTouchPoints: 0,
      matchesCoarse: false,
      innerWidth: 1920,
    }),
    false,
  );
});

test('checkIsMobileDevice returns false on desktop laptop with touchscreen but mouse pointer and large viewport', () => {
  assert.equal(
    checkIsMobileDevice({
      search: '',
      hasTouchStart: true,
      maxTouchPoints: 10,
      matchesCoarse: false,
      innerWidth: 1440,
    }),
    false,
  );
});

test('checkIsMobileDevice returns true on touch mobile phone with coarse pointer', () => {
  assert.equal(
    checkIsMobileDevice({
      search: '',
      hasTouchStart: true,
      maxTouchPoints: 5,
      matchesCoarse: true,
      innerWidth: 390,
    }),
    true,
  );
});

test('checkIsMobileDevice returns true on small touch screen device', () => {
  assert.equal(
    checkIsMobileDevice({
      search: '',
      hasTouchStart: true,
      maxTouchPoints: 1,
      matchesCoarse: false,
      innerWidth: 600,
    }),
    true,
  );
});

test('computeAnalogTouchDriveInput applies deadzone and proportional analog curve', () => {
  const idle = computeAnalogTouchDriveInput(0.08, -0.05, 0.16);
  assert.equal(idle.steer, 0);
  assert.equal(idle.throttle, 0);

  const halfRightGas = computeAnalogTouchDriveInput(0.58, -1.0, 0.16);
  assert.ok(halfRightGas.steer < -0.25 && halfRightGas.steer > -0.75);
  assert.equal(halfRightGas.throttle, 1);

  const fullLeftRev = computeAnalogTouchDriveInput(-1.0, 1.0, 0.16);
  assert.equal(fullLeftRev.steer, 1);
  assert.equal(fullLeftRev.throttle, -1);
});

test('computeTouchOrbitCameraState orbits camera around buildOrbitPivot and clamps zoom', () => {
  const pivot = { x: 0, y: 5, z: -4 };
  const state = computeTouchOrbitCameraState(pivot, 0, -0.2, 8.0, 120, 40, -2.0);
  assert.equal(state.buildOrbitDist, 6.0);
  const actualDist = Math.hypot(
    state.camFreePos.x - pivot.x,
    state.camFreePos.y - pivot.y,
    state.camFreePos.z - pivot.z,
  );
  assert.ok(Math.abs(actualDist - 6.0) < 1e-4);
});

test('computeRenderDistanceTuning scales LOD rings, cameraFar, and fog density with chunk radius', () => {
  const low = computeRenderDistanceTuning(2);
  const high = computeRenderDistanceTuning(8);
  assert.equal(low.clampedChunks, 2);
  assert.equal(high.clampedChunks, 8);
  assert.ok(high.lod0MaxMeters > low.lod0MaxMeters);
  assert.ok(high.cameraFar > low.cameraFar);
  assert.ok(high.baseFogDensity < low.baseFogDensity);
});

test('computeTacticalMapRenderRadiusChunks dynamically increases chunk render radius as map zooms out', () => {
  const closeZoom = computeTacticalMapRenderRadiusChunks(22, 4, false, 1.78);
  const midZoom = computeTacticalMapRenderRadiusChunks(65, 4, false, 1.78);
  const tacticalZoom = computeTacticalMapRenderRadiusChunks(90, 4, false, 1.78);
  const regionalZoom = computeTacticalMapRenderRadiusChunks(180, 4, false, 1.78);
  const maxZoom = computeTacticalMapRenderRadiusChunks(320, 4, false, 2.1);

  assert.ok(closeZoom >= 6);
  assert.ok(midZoom > closeZoom);
  assert.ok(tacticalZoom > midZoom);
  assert.ok(regionalZoom > tacticalZoom);
  assert.ok(maxZoom >= regionalZoom);
});

test('MOBILE_BUILD_QUICK_ACTIONS defines vertical toolbar items in correct order: undo, sym, rot, tap', () => {
  assert.deepEqual(MOBILE_BUILD_QUICK_ACTIONS, [
    'UNDO',
    'SYM',
    'ROT Y',
    'ROT X',
    'ROT Z',
    'TAP',
  ]);
});

test('Dynamic HUD widget state engine supports both built-in and arbitrary new data-hud-widget keys', () => {
  const base = sanitizeHudCustomSettings(DEFAULT_HUD_CUSTOM_SETTINGS);
  // Built-in widget state
  const speedo = getWidgetState(base, 'speedometer');
  assert.equal(speedo.visible, true);
  assert.equal(speedo.scale, 1.0);
  assert.equal(speedo.offsetXvw, 0);
  assert.equal(speedo.offsetYvh, 0);

  // Patching a built-in widget updates both widgets map and legacy top-level properties
  const updatedSpeedo = sanitizeHudCustomSettings({
    ...base,
    ...patchWidgetState(base, 'speedometer', { scale: 1.35, offsetXvw: -8.5, offsetYvh: 4.2 }),
  });
  assert.equal(updatedSpeedo.speedometerScale, 1.35);
  assert.equal(updatedSpeedo.offsets.speedometer.offsetXvw, -8.5);
  assert.equal(updatedSpeedo.offsets.speedometer.offsetYvh, 4.2);
  assert.equal(getWidgetState(updatedSpeedo, 'speedometer').scale, 1.35);

  // Patching a brand-new arbitrary widget key works dynamically without any schema rebuild
  const customId = 'custom-radar-minimap';
  const defaultCustom = getWidgetState(base, customId);
  assert.equal(defaultCustom.visible, true);
  assert.equal(defaultCustom.scale, 1.0);

  const updatedCustom = sanitizeHudCustomSettings({
    ...base,
    ...patchWidgetState(base, customId, { visible: false, scale: 0.75, offsetXvw: 12, offsetYvh: -6 }),
  });
  const afterCustom = getWidgetState(updatedCustom, customId);
  assert.equal(afterCustom.visible, false);
  assert.equal(afterCustom.scale, 0.75);
  assert.equal(afterCustom.offsetXvw, 12);
  assert.equal(afterCustom.offsetYvh, -6);

  const style = getWidgetTransformStyle(updatedCustom, customId, undefined, 'top right');
  assert.ok(style?.transform?.includes('translate(12vw, -6vh)'));
  assert.ok(style?.transform?.includes('scale(0.75)'));
  assert.equal(style?.transformOrigin, 'top right');

  // Verify no 140% (1.4) size limit — scales above 1.4 (e.g. 2.4x = 240%) are preserved
  const largeSpeedo = sanitizeHudCustomSettings({
    ...base,
    ...patchWidgetState(base, 'speedometer', { scale: 2.4 }),
  });
  assert.equal(largeSpeedo.speedometerScale, 2.4);
  assert.equal(getWidgetState(largeSpeedo, 'speedometer').scale, 2.4);

  // Verify clampWidgetBoxToViewport prevents clipping out of window bounds
  const clampedRightBottom = clampWidgetBoxToViewport({
    rect: { left: 740, top: 310, right: 880, bottom: 420, width: 140, height: 110 },
    currentScale: 2.0,
    currentOffsetXvw: 0,
    currentOffsetYvh: 0,
    viewportWidth: 844,
    viewportHeight: 390,
    marginPx: 4,
  });
  assert.equal(clampedRightBottom.changed, true);
  assert.ok(clampedRightBottom.offsetXvw < 0);
  assert.ok(clampedRightBottom.offsetYvh < 0);
});

test('Dynamic HUD UI mode registry registers, orders, switches, and cleans up arbitrary UI modes', () => {
  clearRegisteredHudUiModes();
  let currentMode = 'DRIVE';

  const unregisterDrive = registerHudUiMode({
    id: 'DRIVE',
    label: 'DRIVE UI',
    order: 10,
    isActive: () => currentMode === 'DRIVE',
    activate: () => {
      currentMode = 'DRIVE';
    },
  });
  const unregisterWalk = registerHudUiMode({
    id: 'WALK',
    label: 'WALK UI',
    order: 30,
    isActive: () => currentMode === 'WALK',
    activate: () => {
      currentMode = 'WALK';
    },
  });
  const unregisterBuild = registerHudUiMode({
    id: 'BUILD',
    label: 'BUILD UI',
    order: 20,
    isActive: () => currentMode === 'BUILD',
    activate: () => {
      currentMode = 'BUILD';
    },
  });

  const modes = getRegisteredHudUiModes();
  assert.deepEqual(
    modes.map((m) => m.id),
    ['DRIVE', 'BUILD', 'WALK'],
  );
  assert.equal(modes[0].isActive(), true);
  assert.equal(modes[1].isActive(), false);

  // Switch to BUILD mode dynamically via descriptor
  modes[1].activate();
  assert.equal(currentMode, 'BUILD');
  assert.equal(modes[0].isActive(), false);
  assert.equal(modes[1].isActive(), true);

  // Switch to WALK mode dynamically via descriptor
  modes[2].activate();
  assert.equal(currentMode, 'WALK');
  assert.equal(modes[2].isActive(), true);

  // Register a brand new custom UI mode on the fly without rebuilding editor
  const unregisterJetpack = registerHudUiMode({
    id: 'JETPACK',
    label: 'JETPACK UI',
    order: 40,
    isActive: () => currentMode === 'JETPACK',
    activate: () => {
      currentMode = 'JETPACK';
    },
  });
  assert.equal(getRegisteredHudUiModes().length, 4);

  unregisterJetpack();
  unregisterDrive();
  unregisterBuild();
  unregisterWalk();
  assert.equal(getRegisteredHudUiModes().length, 0);
});

test('Independent width (scaleX) and height (scaleY) resizing works for Walk Mode bars and Popups & Toasts', () => {
  const base = sanitizeHudCustomSettings(null);

  // Stretch Walk Mode bottom bar horizontally (scaleX = 1.6) and vertically (scaleY = 1.25)
  const walkBarPatched = sanitizeHudCustomSettings({
    ...base,
    ...patchWidgetState(base, 'mobile-walk-bar', {
      scaleX: 1.6,
      scaleY: 1.25,
      offsetXvw: -8,
      offsetYvh: -4,
    }),
  });
  const walkState = getWidgetState(walkBarPatched, 'mobile-walk-bar');
  assert.equal(walkState.scaleX, 1.6);
  assert.equal(walkState.scaleY, 1.25);
  assert.equal(walkState.offsetXvw, -8);
  assert.equal(walkState.offsetYvh, -4);

  const walkStyle = getWidgetTransformStyle(
    walkBarPatched,
    'mobile-walk-bar',
    undefined,
    'bottom center',
    true,
  );
  assert.ok(walkStyle?.transform?.includes('translateX(-50%)'));
  assert.ok(walkStyle?.transform?.includes('translate(-8vw, -4vh)'));
  assert.ok(walkStyle?.transform?.includes('scale(1.6, 1.25)'));

  // Stretch Popups & Toasts (toasts) width and height independently
  const toastsPatched = sanitizeHudCustomSettings({
    ...walkBarPatched,
    ...patchWidgetState(walkBarPatched, 'toasts', {
      scaleX: 1.85,
      scaleY: 1.35,
      offsetXvw: 10,
      offsetYvh: 14,
    }),
  });
  const toastState = getWidgetState(toastsPatched, 'toasts');
  assert.equal(toastState.scaleX, 1.85);
  assert.equal(toastState.scaleY, 1.35);
  const toastStyle = getWidgetTransformStyle(
    toastsPatched,
    'toasts',
    undefined,
    'top center',
    true,
  );
  assert.ok(toastStyle?.transform?.includes('translate(10vw, 14vh)'));
  assert.ok(toastStyle?.transform?.includes('scale(1.85, 1.35)'));
});

