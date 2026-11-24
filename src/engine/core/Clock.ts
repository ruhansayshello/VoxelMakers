function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class Clock {
  autoStart: boolean;
  startTime = 0;
  oldTime = 0;
  elapsedTime = 0;
  running = false;

  constructor(autoStart = true) {
    this.autoStart = autoStart;
  }

  start(): void {
    this.startTime = nowMs();
    this.oldTime = this.startTime;
    this.elapsedTime = 0;
    this.running = true;
  }

  stop(): void {
    this.getElapsedTime();
    this.running = false;
    this.autoStart = false;
  }

  getElapsedTime(): number {
    this.getDelta();
    return this.elapsedTime;
  }

  getDelta(): number {
    let diff = 0;

    if (this.autoStart && !this.running) {
      this.start();
      return 0;
    }

    if (this.running) {
      const current = nowMs();
      diff = (current - this.oldTime) / 1000;
      this.oldTime = current;
      this.elapsedTime += diff;
    }

    return diff;
  }
}
