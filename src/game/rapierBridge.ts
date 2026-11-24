import { CustomRigidBody } from './physics/customRigidBody.ts';

/**
 * Legacy compatibility re-export for RapierVehicleBodyBridge.
 * Rapier3D WASM has been completely removed in favor of the custom voxel-tuned physics engine.
 */
export function ensureRapierInitialized(): Promise<void> {
  return Promise.resolve();
}

export { CustomRigidBody as RapierVehicleBodyBridge };
