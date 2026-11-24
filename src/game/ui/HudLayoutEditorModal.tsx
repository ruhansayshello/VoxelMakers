import React, { useEffect, useRef, useState } from 'react';
import {
  type HudCustomSettings,
  type HudUiModeDescriptor,
  MIN_HUD_WIDGET_SCALE,
  MAX_HUD_WIDGET_SCALE,
  clampScale,
  getRegisteredHudUiModes,
  getWidgetState,
  patchWidgetState,
} from './hudCustomization';

export interface HudLayoutEditorModalProps {
  open: boolean;
  isMobile: boolean;
  settings: HudCustomSettings;
  onUpdateSettings: (patch: Partial<HudCustomSettings>) => void;
  onResetSettings: () => void;
  onClose: () => void;
}

interface DiscoveredDomWidget {
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

interface WidgetRectSnapshot {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type DragMode =
  | {
      kind: 'move';
      widgetId: string;
      startX: number;
      startY: number;
      initialOffsetXvw: number;
      initialOffsetYvh: number;
      initialRect: WidgetRectSnapshot;
    }
  | {
      kind: 'resize';
      widgetId: string;
      handle: ResizeHandle;
      startX: number;
      startY: number;
      initialScaleX: number;
      initialScaleY: number;
      initialOffsetXvw: number;
      initialOffsetYvh: number;
      originXRatio: number;
      originYRatio: number;
      initialRect: WidgetRectSnapshot;
    }
  | {
      kind: 'panel';
      startX: number;
      startY: number;
      initialX: number;
      initialY: number;
    };

const FALLBACK_LABELS: Record<string, string> = {
  'top-bar': 'TOP BAR',
  'mobile-top-left': 'BUILD / DRIVE BTN',
  'mobile-build-strip': 'BUILD TOP BAR',
  'mobile-top-right': 'MENU & PAUSE',
  'desktop-top-right': 'AUDIO & PAUSE',
  toasts: 'POPUPS & TOASTS',
  'damage-diagram': 'DAMAGE HUD',
  speedometer: 'SPEEDOMETER',
  'action-dock': 'ACTION DOCK',
  'mobile-left-controls': 'LEFT STEER / STICK',
  'mobile-right-controls': 'RIGHT PEDALS & TOOLS',
  'mobile-right-build': 'BUILD PLACE & EDIT',
  'mobile-right-world': 'TERRAFORM ACTIONS',
  'mobile-right-walk': 'WALK ACTIONS',
  'mobile-parts-bar': 'PARTS BAR',
  'mobile-world-bar': 'WORLD EDIT TOOLS',
  'mobile-walk-bar': 'ON-FOOT TOOLS BAR',
  'mobile-recent-hotbar': 'QUICK PARTS HOTBAR',
  'mobile-cam-elev': 'CAM UP / DOWN',
  'build-spec-box': 'BUILD SPEC BOX',
  'build-top-toolbar': 'BUILD TOP TOOLS',
  'build-left-catalog': 'PART CATALOG',
  'build-right-inspector': 'MODULE INSPECTOR',
  'build-bottom-bar': 'BUILD BRUSH BAR',
  'world-editor-dock': 'WORLD EDITOR DOCK',
  'walk-tools-dock': 'ON-FOOT TOOLS DOCK',
};

function measureDomWidgetUnionRect(widgetId: string): WidgetRectSnapshot | null {
  if (typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll<HTMLElement>(
    `[data-hud-widget="${widgetId}"]`,
  );
  let minL = Infinity;
  let minT = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  nodes.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2) {
      minL = Math.min(minL, r.left);
      minT = Math.min(minT, r.top);
      maxR = Math.max(maxR, r.right);
      maxB = Math.max(maxB, r.bottom);
    }
  });
  if (!Number.isFinite(minL) || maxR <= minL || maxB <= minT) return null;
  return {
    left: minL,
    top: minT,
    right: maxR,
    bottom: maxB,
    width: maxR - minL,
    height: maxB - minT,
  };
}

function measureWidgetTransformOriginRatio(widgetId: string): { ox: number; oy: number } {
  if (typeof document === 'undefined') return { ox: 0.5, oy: 0.5 };
  const el = document.querySelector<HTMLElement>(`[data-hud-widget="${widgetId}"]`);
  if (!el) return { ox: 0.5, oy: 0.5 };
  const raw = (el.style.transformOrigin || '').toLowerCase();
  let ox = 0.5;
  let oy = 0.5;
  if (raw.includes('left')) ox = 0;
  else if (raw.includes('right')) ox = 1;
  if (raw.includes('top')) oy = 0;
  else if (raw.includes('bottom')) oy = 1;
  return { ox, oy };
}

function formatScaleBadge(scaleX: number, scaleY: number): string {
  const rx = Math.round(scaleX * 100);
  const ry = Math.round(scaleY * 100);
  return Math.abs(rx - ry) <= 1 ? `${rx}%` : `${rx}×${ry}%`;
}

export const HudLayoutEditorModal: React.FC<HudLayoutEditorModalProps> = ({
  open,
  isMobile,
  settings,
  onUpdateSettings,
  onResetSettings,
  onClose,
}) => {
  const [selectedId, setSelectedId] = useState<string>('speedometer');
  const [snapToGrid, setSnapToGrid] = useState<boolean>(false);
  const [panelState, setPanelState] = useState<'expanded' | 'minimized' | 'hidden'>('expanded');
  const [showWidgetChips, setShowWidgetChips] = useState<boolean>(false);
  const [panelOffset, setPanelOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [domWidgets, setDomWidgets] = useState<DiscoveredDomWidget[]>([]);
  const [uiModes, setUiModes] = useState<HudUiModeDescriptor[]>([]);
  const [activeUiModeId, setActiveUiModeId] = useState<string>('DRIVE');
  const knownLabelsByModeRef = useRef<Map<string, Map<string, string>>>(new Map());
  const dragStateRef = useRef<DragMode | null>(null);
  const settingsRef = useRef<HudCustomSettings>(settings);
  settingsRef.current = settings;
  const onUpdateSettingsRef = useRef(onUpdateSettings);
  onUpdateSettingsRef.current = onUpdateSettings;
  const snapToGridRef = useRef(snapToGrid);
  snapToGridRef.current = snapToGrid;

  const applyWidgetPatch = (
    widgetId: string,
    patch: {
      visible?: boolean;
      scale?: number;
      scaleX?: number;
      scaleY?: number;
      offsetXvw?: number;
      offsetYvh?: number;
    },
  ) => {
    const currentSettings = settingsRef.current;
    const vw = typeof window !== 'undefined' ? Math.max(320, window.innerWidth) : 1280;
    const vh = typeof window !== 'undefined' ? Math.max(240, window.innerHeight) : 720;
    const st = getWidgetState(currentSettings, widgetId);
    const liveRect = measureDomWidgetUnionRect(widgetId);

    if (liveRect && liveRect.width > 2 && liveRect.height > 2) {
      const currSX = Math.max(0.1, st.scaleX ?? st.scale);
      const currSY = Math.max(0.1, st.scaleY ?? st.scale);
      const baseW = liveRect.width / currSX;
      const baseH = liveRect.height / currSY;
      const maxFitX = Math.max(
        MIN_HUD_WIDGET_SCALE,
        Math.min(MAX_HUD_WIDGET_SCALE, (vw - 8) / Math.max(1, baseW)),
      );
      const maxFitY = Math.max(
        MIN_HUD_WIDGET_SCALE,
        Math.min(MAX_HUD_WIDGET_SCALE, (vh - 8) / Math.max(1, baseH)),
      );
      if (patch.scaleX !== undefined) {
        patch.scaleX = clampScale(patch.scaleX, MIN_HUD_WIDGET_SCALE, maxFitX);
      }
      if (patch.scaleY !== undefined) {
        patch.scaleY = clampScale(patch.scaleY, MIN_HUD_WIDGET_SCALE, maxFitY);
      }
      if (
        patch.scale !== undefined &&
        patch.scaleX === undefined &&
        patch.scaleY === undefined
      ) {
        const maxFitUniform = Math.min(maxFitX, maxFitY);
        patch.scale = clampScale(patch.scale, MIN_HUD_WIDGET_SCALE, maxFitUniform);
      }
    }

    onUpdateSettingsRef.current(patchWidgetState(currentSettings, widgetId, patch));
  };

  const handlePointerMoveGlobal = (clientX: number, clientY: number) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(240, window.innerHeight);
    const pad = 4;

    if (drag.kind === 'move') {
      const rawDxPx = clientX - drag.startX;
      const rawDyPx = clientY - drag.startY;
      const minDx = pad - drag.initialRect.left;
      const maxDx = vw - pad - drag.initialRect.right;
      const clampedDxPx =
        minDx <= maxDx
          ? Math.max(minDx, Math.min(maxDx, rawDxPx))
          : (minDx + maxDx) * 0.5;

      const minDy = pad - drag.initialRect.top;
      const maxDy = vh - pad - drag.initialRect.bottom;
      const clampedDyPx =
        minDy <= maxDy
          ? Math.max(minDy, Math.min(maxDy, rawDyPx))
          : (minDy + maxDy) * 0.5;

      const dxVw = (clampedDxPx / vw) * 100;
      const dyVh = (clampedDyPx / vh) * 100;
      const rawX = drag.initialOffsetXvw + dxVw;
      const rawY = drag.initialOffsetYvh + dyVh;
      const snap = snapToGridRef.current;
      const nextX = snap
        ? Math.round(rawX / 2) * 2
        : Math.round(rawX * 10) / 10;
      const nextY = snap
        ? Math.round(rawY / 2) * 2
        : Math.round(rawY * 10) / 10;
      applyWidgetPatch(drag.widgetId, {
        offsetXvw: Math.max(-100, Math.min(100, nextX)),
        offsetYvh: Math.max(-100, Math.min(100, nextY)),
      });
    } else if (drag.kind === 'resize') {
      const dx = clientX - drag.startX;
      const dy = clientY - drag.startY;
      const h = drag.handle;

      const signX =
        h === 'e' || h === 'ne' || h === 'se'
          ? 1
          : h === 'w' || h === 'nw' || h === 'sw'
            ? -1
            : 0;
      const signY =
        h === 's' || h === 'se' || h === 'sw'
          ? 1
          : h === 'n' || h === 'ne' || h === 'nw'
            ? -1
            : 0;

      const baseW = drag.initialRect.width / Math.max(0.1, drag.initialScaleX);
      const baseH = drag.initialRect.height / Math.max(0.1, drag.initialScaleY);

      const maxScaleX = Math.max(
        MIN_HUD_WIDGET_SCALE,
        Math.min(MAX_HUD_WIDGET_SCALE, (vw - pad * 2) / Math.max(1, baseW)),
      );
      const maxScaleY = Math.max(
        MIN_HUD_WIDGET_SCALE,
        Math.min(MAX_HUD_WIDGET_SCALE, (vh - pad * 2) / Math.max(1, baseH)),
      );

      let nextScaleX = drag.initialScaleX;
      let nextScaleY = drag.initialScaleY;

      if (signX !== 0) {
        const targetWidthPx = Math.max(18, drag.initialRect.width + dx * signX);
        nextScaleX = clampScale(
          targetWidthPx / Math.max(1, baseW),
          MIN_HUD_WIDGET_SCALE,
          maxScaleX,
        );
      }
      if (signY !== 0) {
        const targetHeightPx = Math.max(16, drag.initialRect.height + dy * signY);
        nextScaleY = clampScale(
          targetHeightPx / Math.max(1, baseH),
          MIN_HUD_WIDGET_SCALE,
          maxScaleY,
        );
      }

      const nextWidthPx = baseW * nextScaleX;
      const nextHeightPx = baseH * nextScaleY;
      const deltaW = nextWidthPx - drag.initialRect.width;
      const deltaH = nextHeightPx - drag.initialRect.height;

      let deltaXpx = 0;
      if (signX === 1) {
        deltaXpx = drag.originXRatio * deltaW;
      } else if (signX === -1) {
        deltaXpx = -(1 - drag.originXRatio) * deltaW;
      }

      let deltaYpx = 0;
      if (signY === 1) {
        deltaYpx = drag.originYRatio * deltaH;
      } else if (signY === -1) {
        deltaYpx = -(1 - drag.originYRatio) * deltaH;
      }

      const nextOffsetXvw = Math.max(
        -100,
        Math.min(
          100,
          Math.round((drag.initialOffsetXvw + (deltaXpx / vw) * 100) * 10) / 10,
        ),
      );
      const nextOffsetYvh = Math.max(
        -100,
        Math.min(
          100,
          Math.round((drag.initialOffsetYvh + (deltaYpx / vh) * 100) * 10) / 10,
        ),
      );

      applyWidgetPatch(drag.widgetId, {
        scaleX: nextScaleX,
        scaleY: nextScaleY,
        scale: clampScale((nextScaleX + nextScaleY) * 0.5),
        offsetXvw: nextOffsetXvw,
        offsetYvh: nextOffsetYvh,
      });
    } else if (drag.kind === 'panel') {
      const dx = clientX - drag.startX;
      const dy = clientY - drag.startY;
      const maxX = Math.max(40, vw * 0.44);
      const maxY = Math.max(30, vh * 0.44);
      setPanelOffset({
        x: Math.max(-maxX, Math.min(maxX, Math.round(drag.initialX + dx))),
        y: Math.max(-maxY, Math.min(maxY, Math.round(drag.initialY + dy))),
      });
    }
  };

  const handlePointerUpGlobal = () => {
    dragStateRef.current = null;
  };

  // Attach global window pointer/touch listeners so drags never drop even on fast movements
  useEffect(() => {
    if (!open) return;
    const onWinPointerMove = (e: PointerEvent) => {
      if (!dragStateRef.current) return;
      handlePointerMoveGlobal(e.clientX, e.clientY);
    };
    const onWinTouchMove = (e: TouchEvent) => {
      if (!dragStateRef.current || e.touches.length === 0) return;
      handlePointerMoveGlobal(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onWinUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener('pointermove', onWinPointerMove, { passive: true });
    window.addEventListener('pointerup', onWinUp, { passive: true });
    window.addEventListener('pointercancel', onWinUp, { passive: true });
    window.addEventListener('touchmove', onWinTouchMove, { passive: true });
    window.addEventListener('touchend', onWinUp, { passive: true });
    window.addEventListener('touchcancel', onWinUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onWinPointerMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
      window.removeEventListener('touchmove', onWinTouchMove);
      window.removeEventListener('touchend', onWinUp);
      window.removeEventListener('touchcancel', onWinUp);
    };
  }, [open]);

  // Continuously scan & measure all real DOM elements with [data-hud-widget] without destructively overwriting user drags
  useEffect(() => {
    if (!open) return;

    let rafId = 0;
    const scanDomWidgets = () => {
      const currentSettings = settingsRef.current;
      const modes = getRegisteredHudUiModes();
      const activeMode = modes.find((m) => {
        try {
          return m.isActive();
        } catch {
          return false;
        }
      });
      const modeKey = activeMode?.id || 'DEFAULT';
      setUiModes((prev) => (prev.length === modes.length ? prev : modes));
      setActiveUiModeId((prev) => (prev === modeKey ? prev : modeKey));

      let modeLabels = knownLabelsByModeRef.current.get(modeKey);
      if (!modeLabels) {
        modeLabels = new Map<string, string>();
        knownLabelsByModeRef.current.set(modeKey, modeLabels);
      }

      const nodes = document.querySelectorAll<HTMLElement>('[data-hud-widget]');
      const byId = new Map<string, DiscoveredDomWidget>();

      nodes.forEach((el) => {
        const id = el.getAttribute('data-hud-widget');
        if (!id) return;
        const label =
          el.getAttribute('data-hud-label') ||
          FALLBACK_LABELS[id] ||
          id.replace(/[-_]/g, ' ').toUpperCase();
        modeLabels!.set(id, label);

        const rect = el.getBoundingClientRect();
        const st = getWidgetState(currentSettings, id);
        const isOnScreen = rect.width >= 4 && rect.height >= 4 && st.visible;

        const existing = byId.get(id);
        if (!existing) {
          byId.set(id, {
            id,
            label,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            visible: isOnScreen,
          });
        } else if (isOnScreen) {
          const minL = Math.min(existing.left, rect.left);
          const minT = Math.min(existing.top, rect.top);
          const maxR = Math.max(
            existing.left + existing.width,
            rect.left + rect.width,
          );
          const maxB = Math.max(
            existing.top + existing.height,
            rect.top + rect.height,
          );
          byId.set(id, {
            id,
            label,
            left: minL,
            top: minT,
            width: maxR - minL,
            height: maxB - minT,
            visible: true,
          });
        }
      });

      // Include any widgets belonging to the CURRENT UI mode that were hidden by the user so they can be re-enabled
      for (const [id, label] of modeLabels.entries()) {
        if (!byId.has(id)) {
          const st = getWidgetState(currentSettings, id);
          if (!st.visible) {
            byId.set(id, {
              id,
              label,
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              visible: false,
            });
          }
        }
      }

      const list = Array.from(byId.values());
      setDomWidgets((prev) => {
        if (prev.length !== list.length) return list;
        for (let i = 0; i < list.length; i++) {
          const a = prev[i];
          const b = list[i];
          if (
            a.id !== b.id ||
            a.label !== b.label ||
            a.visible !== b.visible ||
            Math.abs(a.left - b.left) > 0.5 ||
            Math.abs(a.top - b.top) > 0.5 ||
            Math.abs(a.width - b.width) > 0.5 ||
            Math.abs(a.height - b.height) > 0.5
          ) {
            return list;
          }
        }
        return prev;
      });
      rafId = requestAnimationFrame(scanDomWidgets);
    };

    rafId = requestAnimationFrame(scanDomWidgets);
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  if (!open) return null;

  const activeWidget =
    domWidgets.find((w) => w.id === selectedId) ||
    domWidgets.find((w) => w.visible) ||
    domWidgets[0] || {
      id: 'speedometer',
      label: 'SPEEDOMETER',
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      visible: settings.showSpeedometer,
    };

  const activeState = getWidgetState(settings, activeWidget.id);
  const activeScaleX = activeState.scaleX ?? activeState.scale;
  const activeScaleY = activeState.scaleY ?? activeState.scale;

  const startMoveWidget = (e: React.PointerEvent, widgetId: string) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events without pointer capture
    }
    setSelectedId(widgetId);
    const st = getWidgetState(settings, widgetId);
    const fallbackW = domWidgets.find((w) => w.id === widgetId);
    const initialRect =
      measureDomWidgetUnionRect(widgetId) ||
      (fallbackW
        ? {
            left: fallbackW.left,
            top: fallbackW.top,
            right: fallbackW.left + fallbackW.width,
            bottom: fallbackW.top + fallbackW.height,
            width: fallbackW.width,
            height: fallbackW.height,
          }
        : {
            left: e.clientX - 30,
            top: e.clientY - 20,
            right: e.clientX + 30,
            bottom: e.clientY + 20,
            width: 60,
            height: 40,
          });
    dragStateRef.current = {
      kind: 'move',
      widgetId,
      startX: e.clientX,
      startY: e.clientY,
      initialOffsetXvw: st.offsetXvw,
      initialOffsetYvh: st.offsetYvh,
      initialRect,
    };
  };

  const startResizeWidget = (
    e: React.PointerEvent,
    widgetId: string,
    handle: ResizeHandle,
  ) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events without pointer capture
    }
    setSelectedId(widgetId);
    const st = getWidgetState(settings, widgetId);
    const fallbackW = domWidgets.find((w) => w.id === widgetId);
    const initialRect =
      measureDomWidgetUnionRect(widgetId) ||
      (fallbackW
        ? {
            left: fallbackW.left,
            top: fallbackW.top,
            right: fallbackW.left + fallbackW.width,
            bottom: fallbackW.top + fallbackW.height,
            width: fallbackW.width,
            height: fallbackW.height,
          }
        : {
            left: 0,
            top: 0,
            right: 80,
            bottom: 80,
            width: 80,
            height: 80,
          });
    const { ox, oy } = measureWidgetTransformOriginRatio(widgetId);
    dragStateRef.current = {
      kind: 'resize',
      widgetId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initialScaleX: st.scaleX ?? st.scale,
      initialScaleY: st.scaleY ?? st.scale,
      initialOffsetXvw: st.offsetXvw,
      initialOffsetYvh: st.offsetYvh,
      originXRatio: ox,
      originYRatio: oy,
      initialRect,
    };
  };

  const vwNow = typeof window !== 'undefined' ? Math.max(320, window.innerWidth) : 1280;
  const vhNow = typeof window !== 'undefined' ? Math.max(240, window.innerHeight) : 720;

  return (
    <div
      data-testid="hud-layout-editor-modal"
      onPointerMove={(e) => handlePointerMoveGlobal(e.clientX, e.clientY)}
      onPointerUp={handlePointerUpGlobal}
      onPointerCancel={handlePointerUpGlobal}
      className="fixed inset-0 z-[140] bg-[#090d16]/35 select-none touch-none overflow-hidden"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(56,189,248,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.09) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }}
    >
      {/* Subtle Center Crosshair Alignment Guides */}
      <div className="absolute inset-y-0 left-1/2 w-[1px] bg-[#38bdf8]/25 pointer-events-none" />
      <div className="absolute inset-x-0 top-1/2 h-[1px] bg-[#38bdf8]/25 pointer-events-none" />

      {/* Compact, Draggable, Minimizable & Hideable Floating HUD Studio Panel */}
      {panelState === 'hidden' ? (
        <div
          data-testid="hud-editor-restore-pill"
          style={{
            transform: `translate(calc(-50% + ${panelOffset.x}px), ${panelOffset.y}px)`,
          }}
          className="fixed bottom-2 left-1/2 z-[160] bg-[#14171f]/95 border border-[#38bdf8] rounded-[2px] px-1.5 py-0.5 shadow-xl flex items-center gap-1 pointer-events-auto"
        >
          <span
            onPointerDown={(e) => {
              e.stopPropagation();
              dragStateRef.current = {
                kind: 'panel',
                startX: e.clientX,
                startY: e.clientY,
                initialX: panelOffset.x,
                initialY: panelOffset.y,
              };
            }}
            className="px-1 py-0.5 text-[8px] font-mono-num font-bold text-[#94a3b8] cursor-move select-none"
            title="Drag pill"
          >
            ⠿
          </span>
          <button
            type="button"
            data-testid="hud-editor-show-panel-btn"
            onClick={() => setPanelState('expanded')}
            className="px-1.5 py-0.5 bg-[#38bdf8] text-[#090d16] rounded-[2px] font-display font-black text-[8.5px] uppercase cursor-pointer"
          >
            ⊞ SHOW EDITOR
          </button>
          <button
            type="button"
            data-testid="close-hud-editor-btn"
            onClick={onClose}
            className="px-1.5 py-0.5 bg-[#22c55e] text-[#090d16] rounded-[2px] font-display font-black text-[8.5px] uppercase cursor-pointer"
          >
            ✓ DONE
          </button>
        </div>
      ) : panelState === 'minimized' ? (
        <div
          data-testid="hud-layout-editor-toolbar"
          style={{
            transform: `translate(calc(-50% + ${panelOffset.x}px), calc(-50% + ${panelOffset.y}px))`,
          }}
          className="fixed top-1/2 left-1/2 z-[160] bg-[#14171f]/95 border border-[#38bdf8] rounded-[2px] px-2 py-1 shadow-xl flex flex-wrap items-center gap-1 pointer-events-auto max-w-[94vw]"
        >
          <span
            onPointerDown={(e) => {
              e.stopPropagation();
              dragStateRef.current = {
                kind: 'panel',
                startX: e.clientX,
                startY: e.clientY,
                initialX: panelOffset.x,
                initialY: panelOffset.y,
              };
            }}
            className="px-1 py-0.5 bg-[#38bdf8] text-[#090d16] font-display font-black text-[8px] rounded-[2px] uppercase cursor-move shrink-0"
            title="Drag to move editor bar"
          >
            ⠿ HUD
          </span>

          <span className="text-[8.5px] font-display font-extrabold text-[#facc15] uppercase truncate max-w-[110px]">
            {activeWidget.label} {formatScaleBadge(activeScaleX, activeScaleY)}
          </span>

          <button
            type="button"
            data-testid="hud-editor-shrink-btn"
            onClick={() =>
              applyWidgetPatch(activeWidget.id, { scale: activeState.scale - 0.1 })
            }
            className="px-1.5 py-0.5 bg-[#262626] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[8.5px] font-mono-num font-bold cursor-pointer"
          >
            −
          </button>
          <button
            type="button"
            data-testid="hud-editor-enlarge-btn"
            onClick={() =>
              applyWidgetPatch(activeWidget.id, { scale: activeState.scale + 0.1 })
            }
            className="px-1.5 py-0.5 bg-[#262626] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[8.5px] font-mono-num font-bold cursor-pointer"
          >
            +
          </button>

          <button
            type="button"
            data-testid="hud-editor-minimize-btn"
            onClick={() => setPanelState('expanded')}
            className="px-1.5 py-0.5 bg-[#1e293b] text-[#38bdf8] border border-[#38bdf8] rounded-[2px] font-display font-extrabold text-[8px] uppercase cursor-pointer"
          >
            ▼ EXPAND
          </button>
          <button
            type="button"
            data-testid="hud-editor-hide-panel-btn"
            onClick={() => setPanelState('hidden')}
            className="px-1.5 py-0.5 bg-[#1e293b] text-[#cbd5e1] border border-[#475569] rounded-[2px] font-display font-extrabold text-[8px] uppercase cursor-pointer"
          >
            HIDE
          </button>
          <button
            type="button"
            data-testid="close-hud-editor-btn"
            onClick={onClose}
            className="px-1.5 py-0.5 bg-[#22c55e] text-[#090d16] rounded-[2px] font-display font-black text-[8px] uppercase cursor-pointer"
          >
            ✓ DONE
          </button>
        </div>
      ) : (
        <div
          data-testid="hud-layout-editor-toolbar"
          style={{
            transform: `translate(calc(-50% + ${panelOffset.x}px), calc(-50% + ${panelOffset.y}px))`,
          }}
          className={`fixed top-1/2 left-1/2 z-[160] bg-[#14171f]/95 border border-[#38bdf8] rounded-[2px] shadow-2xl flex flex-col pointer-events-auto max-h-[calc(100dvh-16px)] overflow-y-auto ${
            isMobile
              ? 'w-[min(76vw,270px)] p-1.5 gap-1'
              : 'w-[min(86vw,330px)] p-2 gap-1.5'
          }`}
        >
          {/* Compact Draggable Header with Minimize, Hide, and Done */}
          <div
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              e.stopPropagation();
              dragStateRef.current = {
                kind: 'panel',
                startX: e.clientX,
                startY: e.clientY,
                initialX: panelOffset.x,
                initialY: panelOffset.y,
              };
            }}
            className="flex items-center justify-between gap-1 border-b border-[#334155] pb-1 cursor-move"
          >
            <div className="flex items-center gap-1 min-w-0">
              <span className="px-1 py-0.5 bg-[#38bdf8] text-[#090d16] font-display font-black text-[8px] rounded-[2px] uppercase shrink-0">
                ⠿ HUD EDITOR
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-testid="hud-editor-minimize-btn"
                onClick={() => setPanelState('minimized')}
                className="px-1.5 py-0.5 bg-[#1e293b] hover:bg-[#334155] text-[#e2e8f0] border border-[#475569] rounded-[2px] font-mono-num font-bold text-[8px] uppercase cursor-pointer"
                title="Minimize editor box to a compact bar"
              >
                − MIN
              </button>
              <button
                type="button"
                data-testid="hud-editor-hide-panel-btn"
                onClick={() => setPanelState('hidden')}
                className="px-1.5 py-0.5 bg-[#1e293b] hover:bg-[#334155] text-[#fbbf24] border border-[#475569] rounded-[2px] font-mono-num font-bold text-[8px] uppercase cursor-pointer"
                title="Hide editor box to see full screen"
              >
                HIDE
              </button>
              <button
                type="button"
                data-testid="close-hud-editor-btn"
                onClick={onClose}
                className="px-2 py-0.5 bg-[#22c55e] hover:bg-[#16a34a] text-[#090d16] border border-[#86efac] rounded-[2px] font-display font-black text-[8.5px] uppercase cursor-pointer"
              >
                ✓ DONE
              </button>
            </div>
          </div>

          {/* Single-Line Dynamic UI Mode Switcher */}
          {uiModes.length > 0 && (
            <div
              data-testid="hud-editor-mode-switcher"
              className="flex flex-wrap items-center gap-1 bg-[#0d1016] border border-[#334155] rounded-[2px] px-1 py-0.5"
            >
              <span className="text-[7.5px] font-mono-num font-bold text-[#94a3b8] uppercase shrink-0">
                MODE:
              </span>
              {uiModes.map((m) => {
                const isModeActive = m.id === activeUiModeId;
                const shortLabel = m.label
                  .replace(/\s*UI$/i, '')
                  .replace('WORLD / TERRA', 'TERRA')
                  .replace('PROP MAKER', 'PROP');
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`hud-editor-mode-${m.id}`}
                    onClick={() => {
                      m.activate();
                      setActiveUiModeId(m.id);
                    }}
                    className={`px-1 py-0.5 rounded-[2px] text-[7.5px] font-display font-extrabold uppercase whitespace-nowrap border cursor-pointer transition shrink-0 ${
                      isModeActive
                        ? 'bg-[#facc15] text-[#090d16] border-white'
                        : 'bg-[#1e293b] text-[#e2e8f0] border-[#475569] hover:border-[#38bdf8]'
                    }`}
                  >
                    {shortLabel}
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected Live DOM Element Controls (Compact 1-Row) */}
          <div className="bg-[#0d1016] border border-[#334155] rounded-[2px] p-1 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8] shrink-0" />
                <span className="text-[8.5px] font-display font-extrabold text-[#facc15] uppercase truncate">
                  {activeWidget.label}
                </span>
                <span
                  data-testid="hud-editor-active-scale-readout"
                  className="text-[8px] font-mono-num text-[#38bdf8] font-bold shrink-0"
                >
                  {formatScaleBadge(activeScaleX, activeScaleY)}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  data-testid="hud-editor-shrink-btn"
                  onClick={() =>
                    applyWidgetPatch(activeWidget.id, {
                      scale: activeState.scale - 0.1,
                    })
                  }
                  className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[8px] font-mono-num font-bold cursor-pointer"
                  title="Shrink selected UI element"
                >
                  −
                </button>
                <button
                  type="button"
                  data-testid="hud-editor-enlarge-btn"
                  onClick={() =>
                    applyWidgetPatch(activeWidget.id, {
                      scale: activeState.scale + 0.1,
                    })
                  }
                  className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[8px] font-mono-num font-bold cursor-pointer"
                  title="Enlarge selected UI element"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyWidgetPatch(activeWidget.id, {
                      offsetXvw: 0,
                      offsetYvh: 0,
                      scale: 1.0,
                      scaleX: 1.0,
                      scaleY: 1.0,
                    })
                  }
                  className="px-1 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#fbbf24] border border-[#444444] rounded-[2px] text-[7.5px] font-mono-num font-bold cursor-pointer uppercase"
                  title="Reset position & size"
                >
                  RST
                </button>
                <button
                  type="button"
                  data-testid={`hud-toggle-${activeWidget.id}-btn`}
                  onClick={() =>
                    applyWidgetPatch(activeWidget.id, {
                      visible: !activeState.visible,
                    })
                  }
                  className={`px-1 py-0.5 rounded-[2px] text-[7.5px] font-mono-num font-bold border cursor-pointer uppercase ${
                    activeState.visible
                      ? 'bg-[#22c55e] text-[#090d16] border-[#4ade80]'
                      : 'bg-[#dc2626] text-white border-[#f87171]'
                  }`}
                >
                  {activeState.visible ? 'SHOWN' : 'HIDDEN'}
                </button>
              </div>
            </div>

            {/* Collapsible Widget Chips Drawer (Keeps panel compact unless expanded or hidden widgets exist) */}
            {(showWidgetChips || domWidgets.some((w) => !getWidgetState(settings, w.id).visible)) && (
              <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[#1e293b]">
                {domWidgets.map((w) => {
                  const isSel = w.id === activeWidget.id;
                  const st = getWidgetState(settings, w.id);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      data-testid={`hud-select-chip-${w.id}`}
                      onClick={() => {
                        setSelectedId(w.id);
                        if (!st.visible) {
                          applyWidgetPatch(w.id, { visible: true });
                        }
                      }}
                      className={`px-1 py-0.5 rounded-[2px] text-[7.5px] font-mono-num font-bold uppercase border cursor-pointer transition flex items-center gap-0.5 ${
                        isSel
                          ? 'bg-[#38bdf8] text-[#090d16] border-white'
                          : st.visible
                            ? 'bg-[#1e293b] text-[#e2e8f0] border-[#475569]'
                            : 'bg-[#18181b] text-[#71717a] border-[#3f3f46] line-through'
                      }`}
                    >
                      <span>{w.label}</span>
                      {!st.visible && <span className="text-[#fbbf24] no-underline">+SHOW</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Compact Footer: Items List Toggle + Grid Snap + Reset All */}
          <div className="flex items-center justify-between gap-1 text-[8px] font-mono-num">
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="hud-editor-toggle-chips-btn"
                onClick={() => setShowWidgetChips((s) => !s)}
                className="px-1.5 py-0.5 rounded-[2px] bg-[#1e293b] text-[#e2e8f0] border border-[#334155] font-bold uppercase cursor-pointer"
              >
                ITEMS ({domWidgets.length}) {showWidgetChips ? '▴' : '▾'}
              </button>
              <button
                type="button"
                onClick={() => setSnapToGrid((s) => !s)}
                className={`px-1.5 py-0.5 rounded-[2px] border font-bold uppercase cursor-pointer ${
                  snapToGrid
                    ? 'bg-[#facc15] text-[#141414] border-white'
                    : 'bg-[#1e293b] text-[#94a3b8] border-[#334155]'
                }`}
              >
                SNAP: {snapToGrid ? 'ON' : 'OFF'}
              </button>
            </div>

            <button
              type="button"
              data-testid="reset-hud-custom-btn"
              onClick={onResetSettings}
              className="px-1.5 py-0.5 rounded-[2px] bg-[#262626] hover:border-[#fbbf24] text-[#fbbf24] border border-[#444444] font-bold uppercase cursor-pointer"
            >
              ↺ RESET ALL
            </button>
          </div>
        </div>
      )}

      {/* Live Bounding-Box Overlays Synced 1:1 to Real Rendered DOM Elements */}
      {domWidgets.map((w) => {
        if (!w.visible || w.width < 4 || w.height < 4) return null;
        const isSelected = w.id === activeWidget.id;
        const st = getWidgetState(settings, w.id);
        const sx = st.scaleX ?? st.scale;
        const sy = st.scaleY ?? st.scale;

        const boxLeft = Math.max(2, Math.min(vwNow - 10, Math.round(w.left - 2)));
        const boxTop = Math.max(2, Math.min(vhNow - 10, Math.round(w.top - 2)));
        const boxRight = Math.max(
          boxLeft + 8,
          Math.min(vwNow - 2, Math.round(w.left + w.width + 2)),
        );
        const boxBottom = Math.max(
          boxTop + 8,
          Math.min(vhNow - 2, Math.round(w.top + w.height + 2)),
        );
        const boxWidth = boxRight - boxLeft;
        const boxHeight = boxBottom - boxTop;

        const labelOnBottom = boxTop < 26;
        const alignPillRight = boxLeft + 140 > vwNow;

        const handles: { id: ResizeHandle; posClass: string }[] = [
          { id: 'nw', posClass: '-top-1.5 -left-1.5 cursor-nwse-resize' },
          { id: 'n', posClass: '-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize' },
          { id: 'ne', posClass: '-top-1.5 -right-1.5 cursor-nesw-resize' },
          { id: 'e', posClass: 'top-1/2 -translate-y-1/2 -right-1.5 cursor-ew-resize' },
          { id: 'se', posClass: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
          { id: 's', posClass: '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize' },
          { id: 'sw', posClass: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
          { id: 'w', posClass: 'top-1/2 -translate-y-1/2 -left-1.5 cursor-ew-resize' },
        ];

        return (
          <div
            key={w.id}
            data-testid={`hud-editor-widget-${w.id}`}
            onPointerDown={(e) => startMoveWidget(e, w.id)}
            style={{
              left: `${boxLeft}px`,
              top: `${boxTop}px`,
              width: `${boxWidth}px`,
              height: `${boxHeight}px`,
            }}
            className={`fixed cursor-move select-none touch-none rounded-[2px] ${
              isSelected
                ? 'z-[155] ring-2 ring-[#38bdf8] bg-[#38bdf8]/15'
                : 'z-[150] ring-1 ring-dashed ring-[#facc15]/85 hover:ring-[#38bdf8] bg-transparent'
            }`}
          >
            {/* Widget Tag: Selected widget gets full floating pill; unselected gets compact inside tag so neighbors never overlap */}
            {isSelected ? (
              <div
                className={`absolute ${
                  labelOnBottom ? '-bottom-5' : '-top-5'
                } ${
                  alignPillRight ? 'right-0' : 'left-0'
                } flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[8px] font-mono-num font-black uppercase whitespace-nowrap shadow-md bg-[#38bdf8] text-[#090d16] z-10`}
              >
                <span>{w.label}</span>
                <span>{formatScaleBadge(sx, sy)}</span>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    applyWidgetPatch(w.id, { visible: false });
                  }}
                  className="ml-0.5 px-1 bg-[#dc2626] text-white rounded-[1px] text-[7.5px] cursor-pointer"
                  title="Hide this UI element"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="absolute top-0 left-0 px-1 py-0 bg-[#090d16]/85 text-[#facc15] text-[7px] font-mono-num font-bold uppercase whitespace-nowrap pointer-events-none rounded-br-[2px] border-r border-b border-[#facc15]/40">
                {w.label}
              </div>
            )}

            {/* 8 Direct Width & Height Resize Handles (4 Corners + 4 Edges) */}
            {handles.map((h) => (
              <div
                key={h.id}
                data-testid={`hud-resize-handle-${w.id}-${h.id}`}
                onPointerDown={(e) => startResizeWidget(e, w.id, h.id)}
                className={`absolute ${h.posClass} rounded-[2px] border ${
                  isSelected
                    ? 'w-3.5 h-3.5 bg-[#facc15] border-[#090d16] border-2 shadow-md'
                    : 'w-2.5 h-2.5 bg-[#38bdf8]/90 border-[#090d16]'
                } pointer-events-auto`}
                title="Drag dot to change width & height directly"
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};
