export interface DispatchEvent {
  type: string;
  target?: unknown;
  [key: string]: unknown;
}

export type EventListener<TEvent extends DispatchEvent = DispatchEvent> = (event: TEvent) => void;

export class EventDispatcher {
  private _listeners?: Record<string, EventListener[]>;

  addEventListener(type: string, listener: EventListener): void {
    if (this._listeners === undefined) {
      this._listeners = {};
    }

    let bucket = this._listeners[type];
    if (bucket === undefined) {
      bucket = [];
      this._listeners[type] = bucket;
    }

    if (bucket.indexOf(listener) === -1) {
      bucket.push(listener);
    }
  }

  hasEventListener(type: string, listener: EventListener): boolean {
    if (this._listeners === undefined) return false;
    const bucket = this._listeners[type];
    return bucket !== undefined && bucket.indexOf(listener) !== -1;
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (this._listeners === undefined) return;
    const bucket = this._listeners[type];
    if (bucket === undefined) return;

    const idx = bucket.indexOf(listener);
    if (idx !== -1) {
      bucket.splice(idx, 1);
    }
  }

  dispatchEvent(event: DispatchEvent): void {
    if (this._listeners === undefined) return;
    const bucket = this._listeners[event.type];
    if (bucket === undefined || bucket.length === 0) return;

    event.target = this;
    const snapshot = bucket.slice(0);

    for (let i = 0; i < snapshot.length; i++) {
      snapshot[i].call(this, event);
    }

    event.target = null;
  }
}
