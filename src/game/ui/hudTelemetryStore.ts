import React, { useSyncExternalStore } from 'react';

export interface LiveHudTelemetry {
  fps: number;
  frameMs: string;
  rayTarget: string;
  statusLabel: string;
  speedKmh: number;
  engineRpm: number;
  altitudeMeters: string;
  pitchDeg: number;
  rollDeg: number;
  caveAtmospherePct: number;
  voxelsDestroyed: number;
  structuralIntegrityPct: number;
  damagedBlockCount: number;
  lodSummary: string;
  speedTrapMaxKmh: number;
  speedTrapLastKmh: number;
  maxAirtimeSec: string;
  currentAirtimeSec: string;
  timeScale: number;
  isSlowMoActive: boolean;
  slowMoReason: string;
  watchdogProtecting: boolean;
}

export const DEFAULT_LIVE_HUD_TELEMETRY: LiveHudTelemetry = {
  fps: 60,
  frameMs: '16.7',
  rayTarget: 'WORLD TERRAIN',
  statusLabel: 'GROUNDED',
  speedKmh: 0,
  engineRpm: 850,
  altitudeMeters: '0.0m',
  pitchDeg: 0,
  rollDeg: 0,
  caveAtmospherePct: 0,
  voxelsDestroyed: 0,
  structuralIntegrityPct: 100,
  damagedBlockCount: 0,
  lodSummary: 'L0:0 L1:0 L2:0',
  speedTrapMaxKmh: 0,
  speedTrapLastKmh: 0,
  maxAirtimeSec: '0.0',
  currentAirtimeSec: '0.0',
  timeScale: 1.0,
  isSlowMoActive: false,
  slowMoReason: 'NONE',
  watchdogProtecting: false,
};

function shallowEqualTelemetry(
  a: LiveHudTelemetry,
  b: LiveHudTelemetry,
): boolean {
  return (
    a.fps === b.fps &&
    a.frameMs === b.frameMs &&
    a.rayTarget === b.rayTarget &&
    a.statusLabel === b.statusLabel &&
    a.speedKmh === b.speedKmh &&
    a.engineRpm === b.engineRpm &&
    a.altitudeMeters === b.altitudeMeters &&
    a.pitchDeg === b.pitchDeg &&
    a.rollDeg === b.rollDeg &&
    a.caveAtmospherePct === b.caveAtmospherePct &&
    a.voxelsDestroyed === b.voxelsDestroyed &&
    a.structuralIntegrityPct === b.structuralIntegrityPct &&
    a.damagedBlockCount === b.damagedBlockCount &&
    a.lodSummary === b.lodSummary &&
    a.speedTrapMaxKmh === b.speedTrapMaxKmh &&
    a.speedTrapLastKmh === b.speedTrapLastKmh &&
    a.maxAirtimeSec === b.maxAirtimeSec &&
    a.currentAirtimeSec === b.currentAirtimeSec &&
    a.timeScale === b.timeScale &&
    a.isSlowMoActive === b.isSlowMoActive &&
    a.slowMoReason === b.slowMoReason &&
    a.watchdogProtecting === b.watchdogProtecting
  );
}

/**
 * Isolated external pub/sub telemetry store for high-frequency game HUD counters
 * (FPS, speed, RPM, altitude, pitch/roll, LOD summary, raycast label, slow-mo state).
 *
 * Subscribing leaf components re-render independently via `useSyncExternalStore`
 * without triggering reconciliation of the root `App` component.
 */
export class HudTelemetryStore {
  private snapshot: LiveHudTelemetry;
  private listeners = new Set<() => void>();

  constructor(initial: Partial<LiveHudTelemetry> = {}) {
    this.snapshot = { ...DEFAULT_LIVE_HUD_TELEMETRY, ...initial };
  }

  public getSnapshot = (): LiveHudTelemetry => this.snapshot;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Publishes new telemetry fields. Returns true only when at least one field changed
   * and subscribers were notified.
   */
  public publish(next: LiveHudTelemetry): boolean {
    if (shallowEqualTelemetry(this.snapshot, next)) {
      return false;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
    return true;
  }

  public patch(partial: Partial<LiveHudTelemetry>): boolean {
    const merged: LiveHudTelemetry = { ...this.snapshot, ...partial };
    return this.publish(merged);
  }

  public reset(): void {
    this.publish({ ...DEFAULT_LIVE_HUD_TELEMETRY });
  }

  public get subscriberCount(): number {
    return this.listeners.size;
  }
}

export const hudTelemetryStore = new HudTelemetryStore();

export function publishHudTelemetry(next: LiveHudTelemetry): boolean {
  return hudTelemetryStore.publish(next);
}

export function getHudTelemetrySnapshot(): LiveHudTelemetry {
  return hudTelemetryStore.getSnapshot();
}

export function subscribeHudTelemetry(listener: () => void): () => void {
  return hudTelemetryStore.subscribe(listener);
}

export function useHudTelemetry<T>(selector: (t: LiveHudTelemetry) => T): T {
  return useSyncExternalStore(
    hudTelemetryStore.subscribe,
    () => selector(hudTelemetryStore.getSnapshot()),
    () => selector(DEFAULT_LIVE_HUD_TELEMETRY),
  );
}

export const LiveHudField = React.memo(function LiveHudField({
  select,
}: {
  select: (t: LiveHudTelemetry) => string | number;
}) {
  const value = useHudTelemetry(select);
  return React.createElement(React.Fragment, null, value);
});

export const LiveCockpitHorizonSvg = React.memo(function LiveCockpitHorizonSvg() {
  const pitchDeg = useHudTelemetry((t) => t.pitchDeg);
  const rollDeg = useHudTelemetry((t) => t.rollDeg);
  const translateY = 110 + Math.max(-40, Math.min(40, pitchDeg * 1.1));

  return React.createElement(
    'svg',
    {
      width: 220,
      height: 220,
      viewBox: '0 0 220 220',
      className: 'overflow-visible',
    },
    React.createElement('circle', {
      cx: 110,
      cy: 110,
      r: 82,
      fill: 'none',
      stroke: '#38bdf8',
      strokeWidth: 1.2,
      strokeDasharray: '6 4',
      opacity: 0.55,
    }),
    React.createElement(
      'g',
      { transform: `translate(110, ${translateY}) rotate(${-rollDeg})` },
      React.createElement('line', {
        x1: -52,
        y1: 0,
        x2: -16,
        y2: 0,
        stroke: '#4ade80',
        strokeWidth: 2,
      }),
      React.createElement('line', {
        x1: 16,
        y1: 0,
        x2: 52,
        y2: 0,
        stroke: '#4ade80',
        strokeWidth: 2,
      }),
      React.createElement('line', {
        x1: -28,
        y1: -18,
        x2: -12,
        y2: -18,
        stroke: '#4ade80',
        strokeWidth: 1.2,
        opacity: 0.7,
      }),
      React.createElement('line', {
        x1: 12,
        y1: -18,
        x2: 28,
        y2: -18,
        stroke: '#4ade80',
        strokeWidth: 1.2,
        opacity: 0.7,
      }),
      React.createElement('line', {
        x1: -28,
        y1: 18,
        x2: -12,
        y2: 18,
        stroke: '#4ade80',
        strokeWidth: 1.2,
        opacity: 0.7,
      }),
      React.createElement('line', {
        x1: 12,
        y1: 18,
        x2: 28,
        y2: 18,
        stroke: '#4ade80',
        strokeWidth: 1.2,
        opacity: 0.7,
      }),
    ),
    React.createElement('circle', {
      cx: 110,
      cy: 110,
      r: 4,
      fill: 'none',
      stroke: '#facc15',
      strokeWidth: 1.8,
    }),
  );
});
