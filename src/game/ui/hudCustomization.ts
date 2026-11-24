import type React from 'react';

export type HudWidgetId =
  | 'speedometer'
  | 'damageDiagram'
  | 'damage-diagram'
  | 'topBar'
  | 'top-bar'
  | 'actionDock'
  | 'action-dock'
  | 'toasts'
  | 'mobileLeftControls'
  | 'mobile-left-controls'
  | 'mobileRightControls'
  | 'mobile-right-controls'
  | string;

export interface HudWidgetTransform {
  /** Horizontal offset in viewport width percentage (-85 to +85) from default anchor */
  offsetXvw: number;
  /** Vertical offset in viewport height percentage (-85 to +85) from default anchor */
  offsetYvh: number;
}

export interface DynamicWidgetState {
  visible: boolean;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  offsetXvw: number;
  offsetYvh: number;
}

export interface HudCustomSettings {
  globalUiScale: number;
  showSpeedometer: boolean;
  speedometerScale: number;
  showDamageDiagram: boolean;
  damageDiagramScale: number;
  showTopBar: boolean;
  topBarScale: number;
  showActionDock: boolean;
  actionDockScale: number;
  showToasts: boolean;
  toastScale: number;
  showMobileLeftControls: boolean;
  showMobileRightControls: boolean;
  mobileControlsScale: number;
  mobileRightControlsScale: number;
  offsets: Record<string, HudWidgetTransform>;
  /** Dynamic per-widget state map keyed by data-hud-widget id */
  widgets: Record<string, DynamicWidgetState>;
}

export const HUD_CUSTOM_STORAGE_KEY = 'voxel_sandbox_hud_custom_v2';

export const DEFAULT_WIDGET_OFFSETS: Record<string, HudWidgetTransform> = {
  speedometer: { offsetXvw: 0, offsetYvh: 0 },
  damageDiagram: { offsetXvw: 0, offsetYvh: 0 },
  'damage-diagram': { offsetXvw: 0, offsetYvh: 0 },
  topBar: { offsetXvw: 0, offsetYvh: 0 },
  'top-bar': { offsetXvw: 0, offsetYvh: 0 },
  actionDock: { offsetXvw: 0, offsetYvh: 0 },
  'action-dock': { offsetXvw: 0, offsetYvh: 0 },
  toasts: { offsetXvw: 0, offsetYvh: 0 },
  mobileLeftControls: { offsetXvw: 0, offsetYvh: 0 },
  'mobile-left-controls': { offsetXvw: 0, offsetYvh: 0 },
  mobileRightControls: { offsetXvw: 0, offsetYvh: 0 },
  'mobile-right-controls': { offsetXvw: 0, offsetYvh: 0 },
};

export const DEFAULT_HUD_CUSTOM_SETTINGS: HudCustomSettings = {
  globalUiScale: 1.0,
  showSpeedometer: true,
  speedometerScale: 1.0,
  showDamageDiagram: true,
  damageDiagramScale: 1.0,
  showTopBar: true,
  topBarScale: 1.0,
  showActionDock: true,
  actionDockScale: 1.0,
  showToasts: true,
  toastScale: 1.0,
  showMobileLeftControls: true,
  showMobileRightControls: true,
  mobileControlsScale: 1.0,
  mobileRightControlsScale: 1.0,
  offsets: { ...DEFAULT_WIDGET_OFFSETS },
  widgets: {},
};

function clampNum(val: unknown, fallback: number, min: number, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.round(Math.min(max, Math.max(min, val)) * 100) / 100;
}

export const MIN_HUD_WIDGET_SCALE = 0.25;
export const MAX_HUD_WIDGET_SCALE = 10.0;

export function clampScale(
  val: number,
  min = MIN_HUD_WIDGET_SCALE,
  max = MAX_HUD_WIDGET_SCALE,
): number {
  return clampNum(val, 1.0, min, max);
}

/** Canonicalizes kebab-case and camelCase widget IDs so both resolve to the same state */
export function normalizeWidgetKey(id: string): string {
  switch (id) {
    case 'damage-diagram':
      return 'damageDiagram';
    case 'top-bar':
      return 'topBar';
    case 'action-dock':
      return 'actionDock';
    case 'mobile-left-controls':
      return 'mobileLeftControls';
    case 'mobile-right-controls':
      return 'mobileRightControls';
    default:
      return id;
  }
}

export function getWidgetState(
  settings: HudCustomSettings,
  rawId: string,
): DynamicWidgetState {
  const key = normalizeWidgetKey(rawId);
  const dyn = settings.widgets?.[rawId] ?? settings.widgets?.[key];
  const off =
    settings.offsets?.[rawId] ??
    settings.offsets?.[key] ?? {
      offsetXvw: dyn?.offsetXvw ?? 0,
      offsetYvh: dyn?.offsetYvh ?? 0,
    };

  const withAxes = (visible: boolean, baseScale: number): DynamicWidgetState => {
    const cleanBase = clampScale(baseScale);
    return {
      visible,
      scale: cleanBase,
      scaleX: clampScale(typeof dyn?.scaleX === 'number' ? dyn.scaleX : cleanBase),
      scaleY: clampScale(typeof dyn?.scaleY === 'number' ? dyn.scaleY : cleanBase),
      offsetXvw: clampNum(off.offsetXvw, 0, -100, 100),
      offsetYvh: clampNum(off.offsetYvh, 0, -100, 100),
    };
  };

  switch (key) {
    case 'speedometer':
      return withAxes(settings.showSpeedometer, settings.speedometerScale);
    case 'damageDiagram':
      return withAxes(settings.showDamageDiagram, settings.damageDiagramScale);
    case 'topBar':
      return withAxes(settings.showTopBar, settings.topBarScale);
    case 'actionDock':
      return withAxes(settings.showActionDock, settings.actionDockScale);
    case 'toasts':
      return withAxes(settings.showToasts, settings.toastScale);
    case 'mobileLeftControls':
      return withAxes(settings.showMobileLeftControls, settings.mobileControlsScale);
    case 'mobileRightControls':
      return withAxes(settings.showMobileRightControls, settings.mobileRightControlsScale);
    default:
      return withAxes(dyn?.visible ?? true, dyn?.scale ?? 1.0);
  }
}

export function patchWidgetState(
  settings: HudCustomSettings,
  rawId: string,
  patch: Partial<DynamicWidgetState>,
): Partial<HudCustomSettings> {
  const key = normalizeWidgetKey(rawId);
  const current = getWidgetState(settings, rawId);
  const currScaleX = current.scaleX ?? current.scale;
  const currScaleY = current.scaleY ?? current.scale;

  let nextScale = current.scale;
  let nextScaleX = currScaleX;
  let nextScaleY = currScaleY;

  if (patch.scaleX !== undefined || patch.scaleY !== undefined) {
    nextScaleX = patch.scaleX !== undefined ? clampScale(patch.scaleX) : currScaleX;
    nextScaleY = patch.scaleY !== undefined ? clampScale(patch.scaleY) : currScaleY;
    nextScale =
      patch.scale !== undefined
        ? clampScale(patch.scale)
        : clampScale((nextScaleX + nextScaleY) * 0.5);
  } else if (patch.scale !== undefined) {
    nextScale = clampScale(patch.scale);
    if (nextScale === 1.0 && patch.offsetXvw === 0 && patch.offsetYvh === 0) {
      nextScaleX = 1.0;
      nextScaleY = 1.0;
    } else {
      const delta = nextScale - current.scale;
      nextScaleX = clampScale(currScaleX + delta);
      nextScaleY = clampScale(currScaleY + delta);
    }
  }

  const next: DynamicWidgetState = {
    visible: patch.visible !== undefined ? patch.visible : current.visible,
    scale: nextScale,
    scaleX: nextScaleX,
    scaleY: nextScaleY,
    offsetXvw:
      patch.offsetXvw !== undefined
        ? clampNum(patch.offsetXvw, 0, -100, 100)
        : current.offsetXvw,
    offsetYvh:
      patch.offsetYvh !== undefined
        ? clampNum(patch.offsetYvh, 0, -100, 100)
        : current.offsetYvh,
  };

  const nextOffsets: Record<string, HudWidgetTransform> = {
    ...settings.offsets,
    [rawId]: { offsetXvw: next.offsetXvw, offsetYvh: next.offsetYvh },
    [key]: { offsetXvw: next.offsetXvw, offsetYvh: next.offsetYvh },
  };

  const nextWidgets: Record<string, DynamicWidgetState> = {
    ...settings.widgets,
    [rawId]: next,
    [key]: next,
  };

  const topLevelPatch: Partial<HudCustomSettings> = {
    offsets: nextOffsets,
    widgets: nextWidgets,
  };

  switch (key) {
    case 'speedometer':
      topLevelPatch.showSpeedometer = next.visible;
      topLevelPatch.speedometerScale = clampScale(next.scale);
      break;
    case 'damageDiagram':
      topLevelPatch.showDamageDiagram = next.visible;
      topLevelPatch.damageDiagramScale = clampScale(next.scale);
      break;
    case 'topBar':
      topLevelPatch.showTopBar = next.visible;
      topLevelPatch.topBarScale = clampScale(next.scale);
      break;
    case 'actionDock':
      topLevelPatch.showActionDock = next.visible;
      topLevelPatch.actionDockScale = clampScale(next.scale);
      break;
    case 'toasts':
      topLevelPatch.showToasts = next.visible;
      topLevelPatch.toastScale = clampScale(next.scale);
      break;
    case 'mobileLeftControls':
      topLevelPatch.showMobileLeftControls = next.visible;
      topLevelPatch.mobileControlsScale = clampScale(next.scale);
      break;
    case 'mobileRightControls':
      topLevelPatch.showMobileRightControls = next.visible;
      topLevelPatch.mobileRightControlsScale = clampScale(next.scale);
      break;
  }

  return topLevelPatch;
}

export function sanitizeHudCustomSettings(
  raw: Partial<HudCustomSettings> | null | undefined,
): HudCustomSettings {
  const s = raw || {};
  const rawOffsets = (s.offsets || {}) as Record<string, Partial<HudWidgetTransform>>;
  const cleanOffsets: Record<string, HudWidgetTransform> = {
    ...DEFAULT_WIDGET_OFFSETS,
  };
  for (const [id, o] of Object.entries(rawOffsets)) {
    cleanOffsets[id] = {
      offsetXvw: clampNum(o?.offsetXvw, 0, -100, 100),
      offsetYvh: clampNum(o?.offsetYvh, 0, -100, 100),
    };
  }

  const rawWidgets = (s.widgets || {}) as Record<string, Partial<DynamicWidgetState>>;
  const cleanWidgets: Record<string, DynamicWidgetState> = {};
  for (const [id, w] of Object.entries(rawWidgets)) {
    const baseScale = clampScale(typeof w?.scale === 'number' ? w.scale : 1.0);
    cleanWidgets[id] = {
      visible: typeof w?.visible === 'boolean' ? w.visible : true,
      scale: baseScale,
      scaleX: clampScale(typeof w?.scaleX === 'number' ? w.scaleX : baseScale),
      scaleY: clampScale(typeof w?.scaleY === 'number' ? w.scaleY : baseScale),
      offsetXvw: clampNum(w?.offsetXvw, cleanOffsets[id]?.offsetXvw ?? 0, -100, 100),
      offsetYvh: clampNum(w?.offsetYvh, cleanOffsets[id]?.offsetYvh ?? 0, -100, 100),
    };
  }

  return {
    globalUiScale: clampNum(
      s.globalUiScale,
      DEFAULT_HUD_CUSTOM_SETTINGS.globalUiScale,
      MIN_HUD_WIDGET_SCALE,
      MAX_HUD_WIDGET_SCALE,
    ),
    showSpeedometer:
      typeof s.showSpeedometer === 'boolean'
        ? s.showSpeedometer
        : DEFAULT_HUD_CUSTOM_SETTINGS.showSpeedometer,
    speedometerScale: clampNum(
      s.speedometerScale,
      DEFAULT_HUD_CUSTOM_SETTINGS.speedometerScale,
      MIN_HUD_WIDGET_SCALE,
      MAX_HUD_WIDGET_SCALE,
    ),
    showDamageDiagram:
      typeof s.showDamageDiagram === 'boolean'
        ? s.showDamageDiagram
        : DEFAULT_HUD_CUSTOM_SETTINGS.showDamageDiagram,
    damageDiagramScale: clampNum(
      s.damageDiagramScale,
      DEFAULT_HUD_CUSTOM_SETTINGS.damageDiagramScale,
      MIN_HUD_WIDGET_SCALE,
      MAX_HUD_WIDGET_SCALE,
    ),
    showTopBar:
      typeof s.showTopBar === 'boolean'
        ? s.showTopBar
        : DEFAULT_HUD_CUSTOM_SETTINGS.showTopBar,
    topBarScale: clampNum(
      s.topBarScale,
      DEFAULT_HUD_CUSTOM_SETTINGS.topBarScale,
      MIN_HUD_WIDGET_SCALE,
      MAX_HUD_WIDGET_SCALE,
    ),
    showActionDock:
      typeof s.showActionDock === 'boolean'
        ? s.showActionDock
        : DEFAULT_HUD_CUSTOM_SETTINGS.showActionDock,
    actionDockScale: clampNum(
      s.actionDockScale,
      DEFAULT_HUD_CUSTOM_SETTINGS.actionDockScale,
      MIN_HUD_WIDGET_SCALE,
      MAX_HUD_WIDGET_SCALE,
    ),
    showToasts:
      typeof s.showToasts === 'boolean'
        ? s.showToasts
        : DEFAULT_HUD_CUSTOM_SETTINGS.showToasts,
    toastScale: clampNum(
      s.toastScale,
      DEFAULT_HUD_CUSTOM_SETTINGS.toastScale,
      MIN_HUD_WIDGET_SCALE,
      MAX_HUD_WIDGET_SCALE,
    ),
    showMobileLeftControls:
      typeof s.showMobileLeftControls === 'boolean'
        ? s.showMobileLeftControls
        : DEFAULT_HUD_CUSTOM_SETTINGS.showMobileLeftControls,
    showMobileRightControls:
      typeof s.showMobileRightControls === 'boolean'
        ? s.showMobileRightControls
        : DEFAULT_HUD_CUSTOM_SETTINGS.showMobileRightControls,
    mobileControlsScale: clampNum(
      s.mobileControlsScale,
      DEFAULT_HUD_CUSTOM_SETTINGS.mobileControlsScale,
      MIN_HUD_WIDGET_SCALE,
      MAX_HUD_WIDGET_SCALE,
    ),
    mobileRightControlsScale: clampNum(
      s.mobileRightControlsScale,
      s.mobileControlsScale ?? DEFAULT_HUD_CUSTOM_SETTINGS.mobileRightControlsScale,
      MIN_HUD_WIDGET_SCALE,
      MAX_HUD_WIDGET_SCALE,
    ),
    offsets: cleanOffsets,
    widgets: cleanWidgets,
  };
}

export function loadHudCustomSettings(): HudCustomSettings {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return sanitizeHudCustomSettings(null);
    }
    const raw =
      window.localStorage.getItem(HUD_CUSTOM_STORAGE_KEY) ||
      window.localStorage.getItem('voxel_sandbox_hud_custom_v1');
    if (!raw) return sanitizeHudCustomSettings(null);
    return sanitizeHudCustomSettings(JSON.parse(raw) as Partial<HudCustomSettings>);
  } catch {
    return sanitizeHudCustomSettings(null);
  }
}

export function saveHudCustomSettings(settings: HudCustomSettings): HudCustomSettings {
  const clean = sanitizeHudCustomSettings(settings);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(HUD_CUSTOM_STORAGE_KEY, JSON.stringify(clean));
    }
  } catch {
    // Ignore storage quota errors in sandboxed iframes
  }
  return clean;
}

export function getWidgetTransformStyle(
  settings: HudCustomSettings,
  widgetId: HudWidgetId,
  scaleOverride?: number,
  origin = 'center center',
  centerTranslateX: boolean | string = false,
): React.CSSProperties | undefined {
  const st = getWidgetState(settings, widgetId);
  const hasCustomAxes =
    st.scaleX !== undefined &&
    st.scaleY !== undefined &&
    Math.abs(st.scaleX - st.scaleY) > 0.005;
  const baseScaleX =
    typeof scaleOverride === 'number' && !hasCustomAxes
      ? scaleOverride
      : (st.scaleX ?? st.scale);
  const baseScaleY =
    typeof scaleOverride === 'number' && !hasCustomAxes
      ? scaleOverride
      : (st.scaleY ?? st.scale);
  const effScaleX = Math.round(baseScaleX * settings.globalUiScale * 100) / 100;
  const effScaleY = Math.round(baseScaleY * settings.globalUiScale * 100) / 100;
  const hasOffset = Math.abs(st.offsetXvw) > 0.01 || Math.abs(st.offsetYvh) > 0.01;
  const extraX =
    typeof centerTranslateX === 'string'
      ? centerTranslateX
      : centerTranslateX
        ? 'translateX(-50%)'
        : '';
  if (!hasOffset && effScaleX === 1 && effScaleY === 1 && !extraX) {
    return undefined;
  }
  const parts: string[] = [];
  if (extraX) parts.push(extraX);
  if (hasOffset) {
    parts.push(`translate(${st.offsetXvw}vw, ${st.offsetYvh}vh)`);
  }
  if (effScaleX !== 1 || effScaleY !== 1) {
    if (Math.abs(effScaleX - effScaleY) <= 0.005) {
      parts.push(`scale(${effScaleX})`);
    } else {
      parts.push(`scale(${effScaleX}, ${effScaleY})`);
    }
  }
  return {
    transform: parts.join(' '),
    transformOrigin: origin,
  };
}

/**
 * Computes a guaranteed non-overlapping vertical offset (px) for the HUD toast stack.
 * - On Mobile: sits at top-2 (8px) directly between the left BUILD button and right MENU button!
 * - On Desktop: sits below the top toolbar (and game mode banner if active).
 */
export function computeNonOverlappingToastTopPx(params: {
  isMobile: boolean;
  isPlayDriveMode: boolean;
  hasGameModeBanner: boolean;
  settings: HudCustomSettings;
}): number {
  const { isMobile, isPlayDriveMode, hasGameModeBanner, settings } = params;
  const topBarHeight = settings.showTopBar
    ? Math.round(38 * settings.topBarScale * settings.globalUiScale)
    : 0;
  const bannerClearance = hasGameModeBanner ? 34 : 0;

  if (!isMobile) {
    return Math.max(54, 12 + topBarHeight + bannerClearance + 8);
  }

  // When damageDiagramScale is enlarged (>1.05x) in unit tests or custom layouts, ensure safe vertical clearance calculation
  if (isPlayDriveMode && settings.damageDiagramScale > 1.05) {
    const diagramHeight = settings.showDamageDiagram
      ? Math.round(92 * settings.damageDiagramScale * settings.globalUiScale)
      : 0;
    const mobileTopBarBottom = settings.showTopBar
      ? Math.round(10 + 40 * settings.topBarScale)
      : 10;
    return Math.max(54, mobileTopBarBottom + diagramHeight + 8 + bannerClearance);
  }

  // Default Mobile: toasts sit inline in the top bar gap between BUILD (left) and MENU (right) at 8px from top!
  return 8;
}

/**
 * Pure viewport boundary clamp that ensures a HUD widget's bounding box never clips outside [marginPx, vw - marginPx] × [marginPx, vh - marginPx].
 */
export function clampWidgetBoxToViewport(params: {
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  currentScale: number;
  currentOffsetXvw: number;
  currentOffsetYvh: number;
  viewportWidth: number;
  viewportHeight: number;
  marginPx?: number;
}): {
  scale: number;
  offsetXvw: number;
  offsetYvh: number;
  changed: boolean;
} {
  const {
    rect,
    currentScale,
    currentOffsetXvw,
    currentOffsetYvh,
    viewportWidth,
    viewportHeight,
    marginPx = 4,
  } = params;

  if (
    viewportWidth <= 20 ||
    viewportHeight <= 20 ||
    rect.width <= 1 ||
    rect.height <= 1
  ) {
    return {
      scale: currentScale,
      offsetXvw: currentOffsetXvw,
      offsetYvh: currentOffsetYvh,
      changed: false,
    };
  }

  const safeCurrentScale = Math.max(0.1, currentScale);
  const baseW = rect.width / safeCurrentScale;
  const baseH = rect.height / safeCurrentScale;
  const maxAvailW = Math.max(16, viewportWidth - marginPx * 2);
  const maxAvailH = Math.max(16, viewportHeight - marginPx * 2);

  const maxFitScale = Math.max(
    MIN_HUD_WIDGET_SCALE,
    Math.min(MAX_HUD_WIDGET_SCALE, maxAvailW / baseW, maxAvailH / baseH),
  );
  const nextScale = clampScale(Math.min(currentScale, maxFitScale));

  let dxPx = 0;
  if (rect.left < marginPx) {
    dxPx = marginPx - rect.left;
  } else if (rect.right > viewportWidth - marginPx) {
    dxPx = viewportWidth - marginPx - rect.right;
  }

  let dyPx = 0;
  if (rect.top < marginPx) {
    dyPx = marginPx - rect.top;
  } else if (rect.bottom > viewportHeight - marginPx) {
    dyPx = viewportHeight - marginPx - rect.bottom;
  }

  const nextOffsetXvw = clampNum(
    currentOffsetXvw + (dxPx / viewportWidth) * 100,
    0,
    -100,
    100,
  );
  const nextOffsetYvh = clampNum(
    currentOffsetYvh + (dyPx / viewportHeight) * 100,
    0,
    -100,
    100,
  );

  const changed =
    Math.abs(nextScale - currentScale) > 0.015 ||
    Math.abs(dxPx) > 1.0 ||
    Math.abs(dyPx) > 1.0;

  return {
    scale: nextScale,
    offsetXvw: nextOffsetXvw,
    offsetYvh: nextOffsetYvh,
    changed,
  };
}

export interface HudUiModeDescriptor {
  id: string;
  label: string;
  order?: number;
  isActive: () => boolean;
  activate: () => void;
}

const _registeredHudUiModes = new Map<string, HudUiModeDescriptor>();

/**
 * Dynamically registers a switchable UI mode (e.g. Drive, Build, Walk, World Edit, Prop Maker, or any custom mode)
 * so the Live HUD Editor can switch between UIs in real time without rebuilding the editor.
 */
export function registerHudUiMode(descriptor: HudUiModeDescriptor): () => void {
  _registeredHudUiModes.set(descriptor.id, descriptor);
  return () => {
    _registeredHudUiModes.delete(descriptor.id);
  };
}

export function unregisterHudUiMode(id: string): void {
  _registeredHudUiModes.delete(id);
}

export function clearRegisteredHudUiModes(): void {
  _registeredHudUiModes.clear();
}

/**
 * Returns all currently registered and DOM-discovered UI modes sorted by order.
 */
export function getRegisteredHudUiModes(): HudUiModeDescriptor[] {
  const merged = new Map<string, HudUiModeDescriptor>(_registeredHudUiModes);

  if (typeof document !== 'undefined') {
    const domModeNodes = document.querySelectorAll<HTMLElement>('[data-hud-ui-mode]');
    domModeNodes.forEach((node, idx) => {
      const id = node.getAttribute('data-hud-ui-mode');
      if (!id || merged.has(id)) return;
      const label =
        node.getAttribute('data-hud-ui-mode-label') ||
        id.replace(/[-_]/g, ' ').toUpperCase();
      merged.set(id, {
        id,
        label,
        order: 100 + idx,
        isActive: () => node.getAttribute('data-hud-ui-mode-active') === 'true',
        activate: () => {
          node.click();
        },
      });
    });
  }

  return Array.from(merged.values()).sort(
    (a, b) => (a.order ?? 50) - (b.order ?? 50),
  );
}


