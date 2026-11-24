/**
 * Per-vehicle tuning profiles for the 7 VoxelMakers vehicle presets.
 * Maps vehicleId / preset index to archetype tuning parameters so that
 * preset vehicles do not share a single one-size-fits-all configuration.
 */

export interface VehicleTuningProfile {
  presetIndex: number;
  name: string;
  archetype: 'truck' | 'tank' | 'heli' | 'boat' | 'jet' | 'core' | 'bike';
  linearDamping: number;
  angularDamping: number;
  suspensionStiffnessScale: number;
  suspensionDampingScale: number;
  forwardFrictionScale: number;
  lateralFrictionScale: number;
  groundSpringScale: number;
  massScale: number;
  rollStabilityTorque: number;
}

export const VEHICLE_TUNING_PROFILES: Record<number, VehicleTuningProfile> = {
  0: {
    presetIndex: 0,
    name: 'Baja Trophy Truck',
    archetype: 'truck',
    linearDamping: 0.02,
    angularDamping: 0.08,
    suspensionStiffnessScale: 1.0,
    suspensionDampingScale: 1.0,
    forwardFrictionScale: 1.0,
    lateralFrictionScale: 1.15,
    groundSpringScale: 1.0,
    massScale: 1.0,
    rollStabilityTorque: 480,
  },
  1: {
    presetIndex: 1,
    name: 'Heavy Siege Tank',
    archetype: 'tank',
    linearDamping: 0.035,
    angularDamping: 0.14,
    suspensionStiffnessScale: 1.35,
    suspensionDampingScale: 1.25,
    forwardFrictionScale: 1.15,
    lateralFrictionScale: 1.25,
    groundSpringScale: 1.3,
    massScale: 1.35,
    rollStabilityTorque: 950,
  },
  2: {
    presetIndex: 2,
    name: 'Twin-Rotor VTOL Heli',
    archetype: 'heli',
    linearDamping: 0.025,
    angularDamping: 0.12,
    suspensionStiffnessScale: 0.85,
    suspensionDampingScale: 0.95,
    forwardFrictionScale: 0.9,
    lateralFrictionScale: 0.95,
    groundSpringScale: 0.9,
    massScale: 0.85,
    rollStabilityTorque: 620,
  },
  3: {
    presetIndex: 3,
    name: 'Hydro-Foil Gunboat',
    archetype: 'boat',
    linearDamping: 0.018,
    angularDamping: 0.09,
    suspensionStiffnessScale: 0.9,
    suspensionDampingScale: 0.9,
    forwardFrictionScale: 0.75,
    lateralFrictionScale: 1.1,
    groundSpringScale: 0.95,
    massScale: 0.9,
    rollStabilityTorque: 700,
  },
  4: {
    presetIndex: 4,
    name: 'Delta-Wing Stunt Jet',
    archetype: 'jet',
    linearDamping: 0.012,
    angularDamping: 0.07,
    suspensionStiffnessScale: 0.95,
    suspensionDampingScale: 1.0,
    forwardFrictionScale: 0.85,
    lateralFrictionScale: 1.1,
    groundSpringScale: 0.95,
    massScale: 0.85,
    rollStabilityTorque: 420,
  },
  5: {
    presetIndex: 5,
    name: '1-Voxel Scratch Core',
    archetype: 'core',
    linearDamping: 0.02,
    angularDamping: 0.08,
    suspensionStiffnessScale: 1.0,
    suspensionDampingScale: 1.0,
    forwardFrictionScale: 1.0,
    lateralFrictionScale: 1.0,
    groundSpringScale: 1.0,
    massScale: 1.0,
    rollStabilityTorque: 350,
  },
  6: {
    presetIndex: 6,
    name: 'Trailmakers Dirt Bike',
    archetype: 'bike',
    linearDamping: 0.018,
    angularDamping: 0.1,
    suspensionStiffnessScale: 1.1,
    suspensionDampingScale: 1.05,
    forwardFrictionScale: 1.05,
    lateralFrictionScale: 1.25,
    groundSpringScale: 1.05,
    massScale: 0.9,
    rollStabilityTorque: 1150,
  },
};

const VEHICLE_ID_TO_PRESET = new Map<string, number>();

export function registerVehicleTuningPreset(
  vehicleId: string,
  presetIndex: number,
): void {
  VEHICLE_ID_TO_PRESET.set(vehicleId, presetIndex);
}

export function getVehicleTuningProfile(
  vehicleIdOrPreset?: string | number,
): VehicleTuningProfile {
  if (typeof vehicleIdOrPreset === 'number') {
    return (
      VEHICLE_TUNING_PROFILES[vehicleIdOrPreset] || VEHICLE_TUNING_PROFILES[0]
    );
  }
  if (typeof vehicleIdOrPreset === 'string') {
    const mapped = VEHICLE_ID_TO_PRESET.get(vehicleIdOrPreset);
    if (mapped !== undefined && VEHICLE_TUNING_PROFILES[mapped]) {
      return VEHICLE_TUNING_PROFILES[mapped];
    }
  }
  return VEHICLE_TUNING_PROFILES[0];
}
