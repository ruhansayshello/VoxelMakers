import * as THREE from 'three';
import { PHYSICS_CONFIG } from './physicsConfig.ts';

export const FIXED_DT = PHYSICS_CONFIG.fixedDt; // 1 / 60 (60 Hz physics)

export interface TransformSnapshot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/**
 * Fixed 60 Hz physics timestep integrator with render state interpolation (Step 1.4).
 *
 * - Physics steps at a deterministic FIXED_DT = 1/60 s (60 Hz)
 * - Compatible with frameGovernor.ts auto-slow-mo timeScale
 * - Stores previous and current physics states per vehicle and computes
 *   alpha = accumulator / FIXED_DT for smooth visual interpolation
 */
export class FixedTimestepIntegrator {
  public readonly fixedDt: number = FIXED_DT;
  public accumulator: number = 0;
  public alpha: number = 0;

  private prevStates = new Map<string, TransformSnapshot>();
  private currStates = new Map<string, TransformSnapshot>();
  private renderStates = new Map<string, TransformSnapshot>();

  /**
   * Captures a vehicle's transform into `prevPhysicsState` before a physics tick.
   */
  public recordPreviousState(
    id: string,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): void {
    let snap = this.prevStates.get(id);
    if (!snap) {
      snap = {
        position: position.clone(),
        quaternion: quaternion.clone(),
      };
      this.prevStates.set(id, snap);
    } else {
      snap.position.copy(position);
      snap.quaternion.copy(quaternion);
    }
  }

  /**
   * Captures a vehicle's transform into `currPhysicsState` after a physics tick.
   */
  public recordCurrentState(
    id: string,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): void {
    let snap = this.currStates.get(id);
    if (!snap) {
      snap = {
        position: position.clone(),
        quaternion: quaternion.clone(),
      };
      this.currStates.set(id, snap);
    } else {
      snap.position.copy(position);
      snap.quaternion.copy(quaternion);
    }
    if (!this.prevStates.has(id)) {
      this.recordPreviousState(id, position, quaternion);
    }
  }

  /**
   * Advances the physics accumulator by `realDt * timeScale`, running `stepPhysics(FIXED_DT)`
   * as many times as needed (clamped to `maxStepsPerFrame` to protect low-end CPUs),
   * and returns the render interpolation factor `alpha = accumulator / FIXED_DT` in [0, 1].
   */
  public update(
    realDt: number,
    timeScale: number,
    stepPhysics: (fixedDt: number) => void,
  ): { stepsExecuted: number; alpha: number } {
    const safeRealDt = Math.max(
      0,
      Math.min(PHYSICS_CONFIG.maxAccumulatedDt, realDt),
    );
    const safeTimeScale = Math.max(0.05, Math.min(2.0, timeScale));
    this.accumulator += safeRealDt * safeTimeScale;

    // Clamp accumulator to prevent spiral-of-death on heavy frames
    const maxAccum = this.fixedDt * PHYSICS_CONFIG.maxStepsPerFrame;
    if (this.accumulator > maxAccum) {
      this.accumulator = maxAccum;
    }

    let stepsExecuted = 0;
    while (
      this.accumulator >= this.fixedDt &&
      stepsExecuted < PHYSICS_CONFIG.maxStepsPerFrame
    ) {
      stepPhysics(this.fixedDt);
      this.accumulator -= this.fixedDt;
      stepsExecuted++;
    }

    this.alpha = Math.max(0, Math.min(1, this.accumulator / this.fixedDt));
    return { stepsExecuted, alpha: this.alpha };
  }

  /**
   * Computes `lerp(prevPhysicsState, currPhysicsState, alpha)` for position and
   * `slerp(prevPhysicsState, currPhysicsState, alpha)` for quaternion.
   */
  public getInterpolatedTransform(
    id: string,
    outPosition: THREE.Vector3,
    outQuaternion: THREE.Quaternion,
    alphaOverride?: number,
  ): boolean {
    const prev = this.prevStates.get(id);
    const curr = this.currStates.get(id);
    if (!prev || !curr) {
      return false;
    }
    const a = alphaOverride !== undefined ? alphaOverride : this.alpha;
    outPosition.lerpVectors(prev.position, curr.position, a);
    outQuaternion.slerpQuaternions(prev.quaternion, curr.quaternion, a);
    return true;
  }

  /**
   * Removes stored state for a despawned vehicle.
   */
  public removeVehicle(id: string): void {
    this.prevStates.delete(id);
    this.currStates.delete(id);
    this.renderStates.delete(id);
  }

  public reset(): void {
    this.accumulator = 0;
    this.alpha = 0;
    this.prevStates.clear();
    this.currStates.clear();
    this.renderStates.clear();
  }
}
