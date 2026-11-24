/**
 * Pure Procedural Web Audio Engine (`src/game/audio.ts`)
 * Zero-asset dynamic sound synthesis using the native Web Audio API (no external MP3/WAV files):
 * - Engine Sound: Monophonic oscillator with a low-pass filter linked to vehicle RPM/speed.
 *   Pitch scales dynamically with throttle (`50Hz` idle up to `320Hz` redline).
 * - Thruster Roar: Pink/white noise buffer passed through a bandpass filter with volume linked to active thruster output.
 * - Collision Clang: Short resonant metallic strike (`sine` burst with rapid exponential decay) scaled by impact impulse force.
 * - Weapon Blast: Dual-layer audio: instant high-frequency snap + low-end noise burst for plasma cannons and rockets.
 */

export interface EngineAudioParams {
  freqHz: number;
  lowpassCutoffHz: number;
  gain: number;
}

export interface ThrusterRoarParams {
  bandpassFreqHz: number;
  bandpassQ: number;
  gain: number;
}

export interface CollisionClangParams {
  primarySineHz: number;
  overtoneSineHz: number;
  decaySec: number;
  gain: number;
}

export interface WeaponBlastParams {
  snapStartHz: number;
  snapEndHz: number;
  snapDurSec: number;
  noiseLowpassHz: number;
  noiseDurSec: number;
  gain: number;
}

export interface AmbientWindDebrisParams {
  windBandpassHz: number;
  windBandpassQ: number;
  windGain: number;
  debrisLowpassHz: number;
  debrisGain: number;
}

/**
 * Pure helper: computes engine oscillator pitch (50Hz idle -> 320Hz redline),
 * low-pass filter cutoff, and gain from throttle [0..1] and speed (km/h).
 */
export function computeEngineAudioParams(
  throttleInput: number,
  speedKmh: number,
  isSeatedAndActive: boolean,
): EngineAudioParams {
  if (!isSeatedAndActive) {
    return { freqHz: 50, lowpassCutoffHz: 180, gain: 0 };
  }
  const absThrottle = Math.max(0, Math.min(1, Math.abs(throttleInput)));
  const speedRatio = Math.max(0, Math.min(1, Math.abs(speedKmh) / 140));
  const combinedLoad = Math.max(0, Math.min(1, absThrottle * 0.65 + speedRatio * 0.55));
  const freqHz = 50 + combinedLoad * (320 - 50);
  const lowpassCutoffHz = 220 + combinedLoad * 1450;
  const gain = 0.045 + combinedLoad * 0.085;
  return { freqHz, lowpassCutoffHz, gain };
}

/**
 * Pure helper: computes thruster bandpass filter frequency, Q, and output gain
 * from active thruster output [0..1].
 */
export function computeThrusterRoarParams(
  thrusterOutput: number,
  isBoosting = false,
): ThrusterRoarParams {
  const clamped = Math.max(0, Math.min(1, thrusterOutput));
  if (clamped <= 0.001) {
    return { bandpassFreqHz: 420, bandpassQ: 1.8, gain: 0 };
  }
  const boostFactor = isBoosting ? 1.25 : 1.0;
  const bandpassFreqHz = 380 + clamped * 920 * boostFactor;
  const bandpassQ = 1.4 + (1 - clamped) * 1.2;
  const gain = Math.min(0.24, (0.04 + clamped * 0.16) * boostFactor);
  return { bandpassFreqHz, bandpassQ, gain };
}

/**
 * Pure helper: computes resonant metallic sine strike parameters scaled by impact impulse force.
 */
export function computeCollisionClangParams(impulseForce: number): CollisionClangParams {
  const normForce = Math.max(0.05, Math.min(1.0, impulseForce / 25.0));
  const primarySineHz = 480 + (1 - normForce * 0.35) * 340;
  const overtoneSineHz = primarySineHz * 1.618;
  const decaySec = 0.09 + normForce * 0.24;
  const gain = Math.min(0.32, 0.05 + normForce * 0.25);
  return { primarySineHz, overtoneSineHz, decaySec, gain };
}

/**
 * Pure helper: computes dual-layer weapon blast parameters (high-freq snap + low-end noise burst).
 */
export function computeWeaponBlastParams(
  kind: 'PLASMA' | 'ROCKET' | 'MINIGUN' | 'BOMB' = 'PLASMA',
): WeaponBlastParams {
  switch (kind) {
    case 'ROCKET':
      return {
        snapStartHz: 920,
        snapEndHz: 110,
        snapDurSec: 0.14,
        noiseLowpassHz: 340,
        noiseDurSec: 0.38,
        gain: 0.26,
      };
    case 'MINIGUN':
      return {
        snapStartHz: 1450,
        snapEndHz: 260,
        snapDurSec: 0.045,
        noiseLowpassHz: 620,
        noiseDurSec: 0.07,
        gain: 0.15,
      };
    case 'BOMB':
      return {
        snapStartHz: 680,
        snapEndHz: 42,
        snapDurSec: 0.22,
        noiseLowpassHz: 210,
        noiseDurSec: 0.56,
        gain: 0.34,
      };
    case 'PLASMA':
    default:
      return {
        snapStartHz: 1280,
        snapEndHz: 140,
        snapDurSec: 0.11,
        noiseLowpassHz: 460,
        noiseDurSec: 0.24,
        gain: 0.22,
      };
  }
}

/**
 * Pure helper: computes continuous ambient wind (modulated by speed + altitude)
 * and distant debris low-frequency rumble parameters.
 */
export function computeAmbientWindDebrisParams(
  speedKmh: number,
  altitudeMeters = 12,
  debrisIntensity = 0,
): AmbientWindDebrisParams {
  const speedNorm = Math.max(0, Math.min(1, Math.abs(speedKmh) / 180));
  const altNorm = Math.max(0, Math.min(1, Math.max(0, altitudeMeters - 4) / 120));
  const windFactor = Math.min(1, 0.14 + speedNorm * 0.68 + altNorm * 0.32);
  const windBandpassHz = 240 + windFactor * 680;
  const windBandpassQ = 1.1 + (1 - windFactor) * 1.4;
  const windGain = 0.012 + windFactor * 0.065;

  const clampedDebris = Math.max(0, Math.min(1, debrisIntensity));
  const debrisLowpassHz = 85 + clampedDebris * 135;
  const debrisGain = clampedDebris * 0.14;

  return {
    windBandpassHz,
    windBandpassQ,
    windGain,
    debrisLowpassHz,
    debrisGain,
  };
}

export class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // Continuous Monophonic Engine Graph
  private engineOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Continuous Thruster Roar Graph
  private thrusterSource: AudioBufferSourceNode | null = null;
  private thrusterFilter: BiquadFilterNode | null = null;
  private thrusterGain: GainNode | null = null;

  // Continuous Ambient Wind + Distant Debris Graph
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private debrisSource: AudioBufferSourceNode | null = null;
  private debrisFilter: BiquadFilterNode | null = null;
  private debrisGain: GainNode | null = null;
  private distantDebrisEnvelope = 0;

  // Continuous Surface-Aware Tire Skid & Mechanical Hum Graph
  private skidSource: AudioBufferSourceNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;

  private lastClangMs = 0;
  private lastWeaponMs = 0;
  public muted = false;

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public init(existingCtx?: AudioContext | null): AudioContext | null {
    if (this.muted) return this.ctx;
    if (existingCtx && !this.ctx) {
      this.ctx = existingCtx;
    }
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
        } catch {
          return null;
        }
      }
    }
    if (!this.ctx) return null;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (!this.noiseBuffer) {
      this.noiseBuffer = this.createPinkWhiteNoiseBuffer(this.ctx, 1.5);
    }

    this.ensureContinuousNodes();
    return this.ctx;
  }

  private createPinkWhiteNoiseBuffer(
    ctx: AudioContext,
    durationSec: number,
  ): AudioBuffer | null {
    try {
      const length = Math.floor(ctx.sampleRate * durationSec);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      // Paul Kellet's pink/white hybrid noise filter for rich thruster & explosion texture
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
        output[i] = Math.max(-1, Math.min(1, pink * 0.65 + white * 0.35));
      }
      return buffer;
    } catch {
      return null;
    }
  }

  private ensureContinuousNodes(): void {
    if (!this.ctx) return;

    // 1. Monophonic Engine Oscillator -> Low-Pass Filter -> Gain
    if (!this.engineOsc) {
      try {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.value = 50;

        filter.type = 'lowpass';
        filter.frequency.value = 220;
        filter.Q.value = 2.4;

        gain.gain.value = 0;

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();

        this.engineOsc = osc;
        this.engineFilter = filter;
        this.engineGain = gain;
      } catch {
        // Ignore if context is blocked
      }
    }

    // 2. Looping Pink/White Noise -> Bandpass Filter -> Gain for Thruster Roar
    if (!this.thrusterSource && this.noiseBuffer) {
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 480;
        filter.Q.value = 1.6;

        const gain = this.ctx.createGain();
        gain.gain.value = 0;

        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        src.start();

        this.thrusterSource = src;
        this.thrusterFilter = filter;
        this.thrusterGain = gain;
      } catch {
        // Ignore if context is blocked
      }
    }

    // 3. Ambient Wind Layer + Distant Debris Rumble Layer
    if (!this.windSource && this.noiseBuffer) {
      try {
        const wSrc = this.ctx.createBufferSource();
        wSrc.buffer = this.noiseBuffer;
        wSrc.loop = true;

        const wFilter = this.ctx.createBiquadFilter();
        wFilter.type = 'bandpass';
        wFilter.frequency.value = 320;
        wFilter.Q.value = 1.8;

        const wGain = this.ctx.createGain();
        wGain.gain.value = 0.015;

        wSrc.connect(wFilter);
        wFilter.connect(wGain);
        wGain.connect(this.ctx.destination);
        wSrc.start();

        this.windSource = wSrc;
        this.windFilter = wFilter;
        this.windGain = wGain;
      } catch {
        // Ignore if context is blocked
      }
    }

    if (!this.debrisSource && this.noiseBuffer) {
      try {
        const dSrc = this.ctx.createBufferSource();
        dSrc.buffer = this.noiseBuffer;
        dSrc.loop = true;
        dSrc.playbackRate.value = 0.55;

        const dFilter = this.ctx.createBiquadFilter();
        dFilter.type = 'lowpass';
        dFilter.frequency.value = 110;
        dFilter.Q.value = 1.5;

        const dGain = this.ctx.createGain();
        dGain.gain.value = 0;

        dSrc.connect(dFilter);
        dFilter.connect(dGain);
        dGain.connect(this.ctx.destination);
        dSrc.start();

        this.debrisSource = dSrc;
        this.debrisFilter = dFilter;
        this.debrisGain = dGain;
      } catch {
        // Ignore if context is blocked
      }
    }

    // 4. Surface-Aware Tire Skid & Gravel Crunch Layer
    if (!this.skidSource && this.noiseBuffer) {
      try {
        const sSrc = this.ctx.createBufferSource();
        sSrc.buffer = this.noiseBuffer;
        sSrc.loop = true;

        const sFilter = this.ctx.createBiquadFilter();
        sFilter.type = 'bandpass';
        sFilter.frequency.value = 1150;
        sFilter.Q.value = 4.2;

        const sGain = this.ctx.createGain();
        sGain.gain.value = 0;

        sSrc.connect(sFilter);
        sFilter.connect(sGain);
        sGain.connect(this.ctx.destination);
        sSrc.start();

        this.skidSource = sSrc;
        this.skidFilter = sFilter;
        this.skidGain = sGain;
      } catch {
        // Ignore if context is blocked
      }
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.silenceContinuous();
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    } else if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public silenceContinuous(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.engineGain) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.04);
    }
    if (this.thrusterGain) {
      this.thrusterGain.gain.setTargetAtTime(0, now, 0.04);
    }
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(0, now, 0.05);
    }
    if (this.debrisGain) {
      this.debrisGain.gain.setTargetAtTime(0, now, 0.05);
    }
    if (this.skidGain) {
      this.skidGain.gain.setTargetAtTime(0, now, 0.04);
    }
  }

  /**
   * Updates surface-aware tire skid screech (high-Q resonant squeal on asphalt/rock vs. coarse low-Q rumble on sand/dirt/snow).
   */
  public updateSurfaceSkidAudio(
    maxSlipRatio: number,
    isHardSurface: boolean,
    speedKmh: number,
    isSeatedAndActive: boolean,
  ): void {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    this.ensureContinuousNodes();
    if (!this.skidFilter || !this.skidGain) return;

    const now = this.ctx.currentTime;
    if (!isSeatedAndActive || maxSlipRatio < 0.55 || Math.abs(speedKmh) < 8) {
      this.skidGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const slipIntensity = Math.min(1.0, (maxSlipRatio - 0.55) / 0.75);
    const speedFactor = Math.min(1.0, Math.abs(speedKmh) / 65);
    const targetFreq = isHardSurface
      ? 1180 + speedFactor * 420
      : 380 + speedFactor * 220;
    const targetQ = isHardSurface ? 5.8 : 1.6;
    const targetGain = slipIntensity * speedFactor * (isHardSurface ? 0.095 : 0.075);

    this.skidFilter.frequency.setTargetAtTime(targetFreq, now, 0.04);
    this.skidFilter.Q.setTargetAtTime(targetQ, now, 0.04);
    this.skidGain.gain.setTargetAtTime(targetGain, now, 0.04);
  }

  /**
   * Triggers a distant low-frequency debris rumble tail (e.g. from explosions, C4, or heavy structural impacts).
   */
  public triggerDistantDebrisRumble(intensity = 0.8): void {
    this.distantDebrisEnvelope = Math.min(
      1.0,
      Math.max(this.distantDebrisEnvelope, Math.max(0.05, Math.min(1.0, intensity))),
    );
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    this.ensureContinuousNodes();
    const now = this.ctx.currentTime;
    const amb = computeAmbientWindDebrisParams(0, 12, this.distantDebrisEnvelope);
    if (this.debrisFilter && this.debrisGain) {
      this.debrisFilter.frequency.setTargetAtTime(amb.debrisLowpassHz, now, 0.08);
      this.debrisGain.gain.setTargetAtTime(amb.debrisGain, now, 0.06);
      this.debrisGain.gain.setTargetAtTime(0, now + 0.25, 0.55);
    }
  }

  /**
   * Updates continuous Ambient Wind and Distant Debris audio layer every frame,
   * independent of vehicle occupancy so wind persists and decays naturally on foot.
   */
  public updateAmbientAudio(
    dt: number,
    playerSpeed: number,
    altitude = 12,
  ): void {
    this.distantDebrisEnvelope = Math.max(
      0,
      this.distantDebrisEnvelope - dt * 0.65,
    );
    if (this.muted || !this.ctx || this.ctx.state !== 'running') {
      return;
    }
    this.ensureContinuousNodes();
    const now = this.ctx.currentTime;
    const amb = computeAmbientWindDebrisParams(
      playerSpeed,
      altitude,
      this.distantDebrisEnvelope,
    );
    if (this.windFilter && this.windGain) {
      this.windFilter.frequency.setTargetAtTime(amb.windBandpassHz, now, 0.08);
      this.windFilter.Q.setTargetAtTime(amb.windBandpassQ, now, 0.08);
      this.windGain.gain.setTargetAtTime(amb.windGain, now, 0.08);
    }
    if (this.debrisFilter && this.debrisGain) {
      this.debrisFilter.frequency.setTargetAtTime(amb.debrisLowpassHz, now, 0.1);
      this.debrisGain.gain.setTargetAtTime(amb.debrisGain, now, 0.1);
    }
  }

  /**
   * Updates continuous Engine Sound (50Hz idle -> 320Hz redline) and Thruster Roar bandpass loop.
   */
  public updateVehicleAudio(
    throttleInput: number,
    speedKmh: number,
    thrusterOutput: number,
    isBoosting: boolean,
    isSeatedAndActive: boolean,
    _altitudeMeters = 12,
  ): void {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') {
      return;
    }
    this.ensureContinuousNodes();
    const now = this.ctx.currentTime;

    const eng = computeEngineAudioParams(throttleInput, speedKmh, isSeatedAndActive);
    if (this.engineOsc && this.engineFilter && this.engineGain) {
      this.engineOsc.frequency.setTargetAtTime(eng.freqHz, now, 0.05);
      this.engineFilter.frequency.setTargetAtTime(eng.lowpassCutoffHz, now, 0.05);
      this.engineGain.gain.setTargetAtTime(eng.gain, now, 0.06);
    }

    const thr = computeThrusterRoarParams(
      isSeatedAndActive ? thrusterOutput : 0,
      isBoosting,
    );
    if (this.thrusterFilter && this.thrusterGain) {
      this.thrusterFilter.frequency.setTargetAtTime(thr.bandpassFreqHz, now, 0.04);
      this.thrusterFilter.Q.setTargetAtTime(thr.bandpassQ, now, 0.04);
      this.thrusterGain.gain.setTargetAtTime(thr.gain, now, 0.05);
    }
  }

  /**
   * Short resonant metallic strike (`sine` burst with rapid exponential decay) scaled by impact impulse force.
   */
  public playCollisionClang(impulseForce = 8.0): void {
    if (this.muted) return;
    if (!this.ctx) this.init();
    if (!this.ctx) return;

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastClangMs < 40) return;
    this.lastClangMs = nowMs;

    const params = computeCollisionClangParams(impulseForce);
    try {
      const now = this.ctx.currentTime;

      // Primary resonant metallic sine
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(params.primarySineHz, now);
      osc1.frequency.exponentialRampToValueAtTime(
        Math.max(45, params.primarySineHz * 0.28),
        now + params.decaySec,
      );

      // Inharmonic metallic overtone sine
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(params.overtoneSineHz, now);
      osc2.frequency.exponentialRampToValueAtTime(
        Math.max(65, params.overtoneSineHz * 0.35),
        now + params.decaySec * 0.75,
      );

      gain.gain.setValueAtTime(params.gain, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + params.decaySec);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + params.decaySec);
      osc2.stop(now + params.decaySec);
    } catch {
      // Ignore Web Audio errors when uninitialized
    }
  }

  /**
   * Dual-layer weapon audio: instant high-frequency snap + low-end noise burst for plasma cannons and rockets.
   */
  public playWeaponBlast(
    kind: 'PLASMA' | 'ROCKET' | 'MINIGUN' | 'BOMB' = 'PLASMA',
  ): void {
    if (this.muted) return;
    if (!this.ctx) this.init();
    if (!this.ctx) return;

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const minInterval = kind === 'MINIGUN' ? 28 : 45;
    if (nowMs - this.lastWeaponMs < minInterval) return;
    this.lastWeaponMs = nowMs;

    const params = computeWeaponBlastParams(kind);
    try {
      const now = this.ctx.currentTime;

      // Layer 1: Instant High-Frequency Snap
      const snapOsc = this.ctx.createOscillator();
      const snapGain = this.ctx.createGain();
      snapOsc.type = 'sawtooth';
      snapOsc.frequency.setValueAtTime(params.snapStartHz, now);
      snapOsc.frequency.exponentialRampToValueAtTime(
        Math.max(24, params.snapEndHz),
        now + params.snapDurSec,
      );
      snapGain.gain.setValueAtTime(params.gain, now);
      snapGain.gain.exponentialRampToValueAtTime(0.001, now + params.snapDurSec);

      snapOsc.connect(snapGain);
      snapGain.connect(this.ctx.destination);
      snapOsc.start(now);
      snapOsc.stop(now + params.snapDurSec);

      // Layer 2: Low-End Noise Burst
      if (!this.noiseBuffer) {
        this.noiseBuffer = this.createPinkWhiteNoiseBuffer(this.ctx, 1.5);
      }
      if (this.noiseBuffer) {
        const noiseSrc = this.ctx.createBufferSource();
        noiseSrc.buffer = this.noiseBuffer;

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(params.noiseLowpassHz, now);
        lowpass.frequency.exponentialRampToValueAtTime(
          65,
          now + params.noiseDurSec,
        );

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(params.gain * 1.15, now);
        noiseGain.gain.exponentialRampToValueAtTime(
          0.001,
          now + params.noiseDurSec,
        );

        noiseSrc.connect(lowpass);
        lowpass.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        noiseSrc.start(now);
        noiseSrc.stop(now + Math.min(1.4, params.noiseDurSec));
      }
    } catch {
      // Ignore Web Audio errors when uninitialized
    }
  }
}

export const ProceduralAudio = new ProceduralAudioEngine();
