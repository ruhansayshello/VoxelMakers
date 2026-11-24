import { ProceduralAudio } from './audio.ts';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private sharedNoiseBuffer: AudioBuffer | null = null;
  private lastToneTime = 0;
  private lastNoiseTime = 0;
  public muted = false;

  init(): void {
    if (this.muted || typeof window === 'undefined') return;
    if (!this.ctx) {
      const existingProcCtx = ProceduralAudio.getContext();
      if (existingProcCtx) {
        this.ctx = existingProcCtx;
      } else {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
    }
    if (this.ctx && !this.sharedNoiseBuffer) {
      try {
        const len = Math.floor(this.ctx.sampleRate * 0.6);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        this.sharedNoiseBuffer = buf;
      } catch {
        // Ignore buffer allocation failure
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    ProceduralAudio.init(this.ctx);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    ProceduralAudio.setMuted(this.muted);
    if (this.ctx) {
      if (this.muted && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      } else if (!this.muted && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }
    return this.muted;
  }

  private jitter(freq: number): number {
    return freq * (0.94 + Math.random() * 0.12);
  }

  tone(
    f1: number,
    f2: number,
    dur = 0.06,
    vol = 0.12,
    type: OscillatorType = 'triangle',
  ): void {
    if (this.muted || !this.ctx) return;
    const nowPerf = performance.now();
    if (nowPerf - this.lastToneTime < 22) return;
    this.lastToneTime = nowPerf;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(this.jitter(f1), now);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(18, this.jitter(f2)),
        now + dur,
      );
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.002, now + dur);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + dur);
    } catch {
      // Ignore audio context errors when uninitialized
    }
  }

  noise(dur = 0.22, vol = 0.24, freq = 380): void {
    if (this.muted || !this.ctx) return;
    const nowPerf = performance.now();
    if (nowPerf - this.lastNoiseTime < 28) return;
    this.lastNoiseTime = nowPerf;
    try {
      const now = this.ctx.currentTime;
      if (!this.sharedNoiseBuffer) {
        this.init();
      }
      if (!this.sharedNoiseBuffer) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.sharedNoiseBuffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.002, now + dur);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.ctx.destination);
      src.start(now);
      src.stop(now + Math.min(dur, 0.58));
    } catch {
      // Ignore audio errors
    }
  }

  snap(): void {
    this.tone(420, 740, 0.055, 0.11, 'sine');
  }

  remove(): void {
    this.tone(280, 130, 0.065, 0.11, 'triangle');
  }

  hover(): void {
    this.tone(240, 520, 0.16, 0.12, 'sine');
  }

  cannon(kind: 'PLASMA' | 'ROCKET' | 'MINIGUN' | 'BOMB' = 'PLASMA'): void {
    ProceduralAudio.playWeaponBlast(kind);
  }

  public fusePlayCount = 0;
  public explodePlayCount = 0;

  fuse(): void {
    this.fusePlayCount++;
    this.noise(0.16, 0.14, 1850);
    this.tone(820, 1380, 0.14, 0.09, 'sawtooth');
  }

  explode(): void {
    this.explodePlayCount++;
    ProceduralAudio.playWeaponBlast('BOMB');
    ProceduralAudio.triggerDistantDebrisRumble(0.9);
    this.noise(0.48, 0.34, 260);
    this.tone(95, 24, 0.42, 0.28, 'sawtooth');
  }

  skid(): void {
    this.noise(0.08, 0.04, 950);
  }

  boost(): void {
    this.noise(0.11, 0.08, 680);
    this.tone(180, 320, 0.09, 0.06, 'sawtooth');
  }

  telegraph(): void {
    this.tone(620, 880, 0.18, 0.09, 'square');
  }

  victory(): void {
    this.tone(440, 660, 0.14, 0.15, 'triangle');
    setTimeout(() => this.tone(660, 880, 0.22, 0.16, 'triangle'), 120);
  }

  clank(impulseForce = 8.0): void {
    ProceduralAudio.playCollisionClang(impulseForce);
    if (impulseForce > 10.0) {
      ProceduralAudio.triggerDistantDebrisRumble(Math.min(0.65, impulseForce / 30));
    }
  }

  boom(): void {
    this.explode();
  }

  waterSplash(intensity = 0.6): void {
    const clamped = Math.max(0.15, Math.min(1.0, intensity));
    this.noise(0.28, 0.16 * clamped, 540);
    this.tone(190, 95, 0.18, 0.08 * clamped, 'sine');
  }

  countermeasurePop(): void {
    this.noise(0.18, 0.22, 1280);
    this.tone(720, 260, 0.14, 0.15, 'sawtooth');
  }

  magnetPulse(repel = false): void {
    if (repel) {
      this.tone(180, 640, 0.16, 0.15, 'sawtooth');
    } else {
      this.tone(420, 210, 0.14, 0.12, 'sine');
    }
  }

  parachuteDeploy(): void {
    this.noise(0.24, 0.2, 620);
    this.tone(310, 140, 0.18, 0.11, 'triangle');
  }

  updateSurfaceSkidAudio(
    maxSlipRatio: number,
    isHardSurface: boolean,
    speedKmh: number,
    isSeatedAndActive: boolean,
  ): void {
    ProceduralAudio.updateSurfaceSkidAudio(
      maxSlipRatio,
      isHardSurface,
      speedKmh,
      isSeatedAndActive,
    );
  }

  updateAmbientAudio(dt: number, playerSpeed: number, altitude = 12): void {
    ProceduralAudio.updateAmbientAudio(dt, playerSpeed, altitude);
  }
}

export const SoundFX = new SoundEngine();



