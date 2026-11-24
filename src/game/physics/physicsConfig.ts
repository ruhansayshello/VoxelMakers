import { MAT } from '../constants.ts';

/**
 * Voxel Material Physics Archetypes.
 * Designed to be extensible for v1.1 magic voxel types (HOVERVOXEL, MAGNETVOXEL, SPRINGVOXEL, EXPLOSIVEVOXEL).
 */
export enum MaterialType {
  DEFAULT = 'default',
  GRIPPY = 'grippy',
  SLIPPERY = 'slippery',
  BOUNCY = 'bouncy',
  CRUNCHY = 'crunchy',
  STICKY = 'sticky',
  // Deferred to v1.1 (kept in enum for extensibility)
  HOVERVOXEL = 'hovervoxel',
  MAGNETVOXEL = 'magnetvoxel',
  SPRINGVOXEL = 'springvoxel',
  EXPLOSIVEVOXEL = 'explosivevoxel',
}

export interface MaterialFrictionProfile {
  forwardFriction: number;
  lateralFriction: number;
  restitution: number;
  crunchiness: number;
   breaksOnImpact?: boolean;
  latchesOnContact?: boolean;
}

export interface PhysicsEngineConfig {
  /** Fixed physics integration step: 60 Hz (1 / 60 s) */
  fixedDt: number;
  /** Maximum frame delta accumulated before clamping to prevent spiral of death */
  maxAccumulatedDt: number;
  /** Maximum 60Hz steps executed per render frame to protect Pentium/Intel HD frame budget */
  maxStepsPerFrame: number;
  /** Default mass per voxel (kg) when not overridden by specific material table */
  defaultVoxelMassKg: number;
  /** Minimum total mass for any vehicle rigid body (kg) */
  minVehicleMassKg: number;
  /** Minimum principal moment of inertia component */
  minInertia: number;
  /** Default linear velocity damping per second */
  defaultLinearDamping: number;
  /** Default angular velocity damping per second */
  defaultAngularDamping: number;
  /** Live-tunable linear velocity damping alias */
  linearDamping: number;
  /** Live-tunable angular velocity damping alias */
  angularDamping: number;
  /** Maximum linear speed (m/s) */
  maxLinearSpeedMPS: number;
  /** Maximum angular speed (rad/s) */
  maxAngularSpeedRadPS: number;
  /** Velocity squared threshold below which sleep timer increments */
  sleepLinearVelSqThreshold: number;
  /** Angular velocity squared threshold below which sleep timer increments */
  sleepAngularVelSqThreshold: number;
  /** Seconds of stillness before rigid body enters sleep mode */
  sleepTimeThresholdSec: number;
  /** Collision point sampling targets by vehicle voxel count */
  collisionSampling: {
    smallVehicleMaxVoxels: number;
    mediumVehicleMaxVoxels: number;
    smallTargetPoints: number;
    mediumTargetPoints: number;
    largeTargetPoints: number;
    maxCollisionPoints: number;
    defaultCellSizeVoxels: number;
  };
  /** Ground collision spring-damper parameters */
  groundCollision: {
    springStiffnessPerPoint: number;
    damperCoefficientPerPoint: number;
    restLength: number;
    snapToRestPenetration: number;
    snapToRestSpeedMPS: number;
    recentCollisionWindowSec: number;
    idleRollingFrictionMultiplier: number;
    maxUpwardForceGravityMult: number;
    maxPenetrationMeters: number;
    positionCorrectionSlop: number;
    positionCorrectionPercent: number;
    crunchyImpactSpeedThreshold: number;
    stickyLatchSpeedThreshold: number;
    stickyAdhesionForce: number;
  };
  /** Small-object sleep parameters (BUG 2) */
  smallObjectSleepSpeedMPS: number;
  smallObjectSleepLinearVelSqThreshold: number;
  smallObjectSleepAngularVelSqThreshold: number;
  smallObjectSleepTimeThresholdSec: number;
  smallObjectMaxMassKg: number;
  /** World gravity vector (BUG 3) */
  gravity: {
    x: number;
    y: number;
    z: number;
  };
  /** Step 3a.1: Basic Gerstner wave buoyancy parameters */
  buoyancy: {
    waterDensityKgM3: number;
    gravityMPS2: number;
    waterDragCoefficient: number;
    nonBuoyantSinkScale: number;
  };
  /** Step 3a.2: Basic helicopter rotor physics parameters */
  rotor: {
    defaultPowerNewtons: number;
    reactionTorqueFactor: number;
    cyclicTiltMaxRad: number;
  };
  /** Step 3a.3: Basic jet physics parameters */
  jet: {
    defaultPowerNewtons: number;
  };
  /** Vehicle counts and active debris caps */
  limits: {
    defaultMaxVehicles: number;
    extendedMaxVehicles: number;
    maxActiveDebris: number;
  };
  /** Step 2.1: Spatial hash broadphase configuration */
  broadphase: {
    cellSizeMeters: number;
    aabbPaddingMeters: number;
  };
  /** Step 2.3: Vehicle-vehicle impulse & anisotropic friction configuration */
  collisionResponse: {
    damagePerImpulse: number;
    minDamageImpulseThreshold: number;
    headOnDamageMultiplier: number;
    glancingDamageMultiplier: number;
    crunchyDamageMultiplier: number;
    bouncyDamageMultiplier: number;
    defaultDamageMultiplier: number;
    stickyHoldingForce: number;
    stickyBreakDistanceMeters: number;
    maxPushOutMeters: number;
    baumgarteFactor: number;
    baumgarteSlopMeters: number;
    maxFramePositionCorrectionMeters: number;
    /** FIX 1: Deep penetration threshold (> 0.5m) that triggers hard ejection instead of spring-damper */
    hardEjectionPenetrationMeters: number;
    /** FIX 3: Penetration threshold (< 0.1m) below which ejection completes and normal damage resumes */
    hardEjectionClearPenetrationMeters: number;
    /** FIX 1: Full position correction factor (1.0) during hard ejection */
    hardEjectionCorrectionFactor: number;
    /** FIX 1: One-time outward bounce speed (5.0 m/s -> impulse = mass * 5 m/s) during hard ejection */
    hardEjectionBounceSpeedMPS: number;
  };
  /** Step 2.4: Per-voxel HP & destruction configuration */
  destruction: {
    defaultVoxelHp: number;
    armorVoxelHp: number;
    crunchyVoxelHp: number;
    screenShakeDurationSec: number;
    screenShakeMagnitude: number;
  };
  /** C4 chain-reaction & physics debris tuning constants */
  c4IgniteDelayMs: number;
  c4ExplosionRadius: number;
  c4DamageInRadius: number;
  c4VehicleImpulse: number;
  c4OtherVehicleImpulse: number;
  c4OtherVehicleRadius: number;
  c4ChainToAdjacentC4: boolean;
  c4: {
    c4IgniteDelayMs: number;
    c4ExplosionRadius: number;
    c4DamageInRadius: number;
    c4VehicleImpulse: number;
    c4OtherVehicleImpulse: number;
    c4OtherVehicleRadius: number;
    c4ChainToAdjacentC4: boolean;
    debrisSpeedMinMPS: number;
    debrisSpeedMaxMPS: number;
    fxParticleCountMin: number;
    fxParticleCountMax: number;
    screenShakeDurationSec: number;
    screenShakeMagnitude: number;
  };
  /** Step 2.5: 10-neighbor C-Simple structural integrity configuration */
  structuralIntegrity: {
    localCheckRadiusVoxels: number;
    fallOffDelayMinMs: number;
    fallOffDelayMaxMs: number;
    fallOffTintHex: number;
  };
  /** Step 2.6: InstancedMesh voxel debris rigid-body configuration */
  debris: {
    maxActiveDebris: number;
    debrisMassKg: number;
    gravityMPS2: number;
    linearDrag: number;
    outwardImpulseMin: number;
    outwardImpulseMax: number;
    sleepDelaySec: number;
    wakeRadiusMeters: number;
    staticFadeDelaySec: number;
    fadeDurationSec: number;
    convertToWorldVoxelOnStop: boolean;
    bounceRestitution: number;
    groundFriction: number;
  };
  /** Step 2.7: Hybrid sphere + voxel break-off wheel configuration */
  hybridWheels: {
    defaultVoxelsPerWheel: number;
    minRadiusScale: number;
    minGripScale: number;
    shotOutCornerDragFriction: number;
    slipRollingThreshold: number;
    /** FIX 2: Simultaneous wheel contact count (3+) indicating the wheel is inside a cavity */
    cavityContactThreshold: number;
    /** FIX 2: Rolling friction multiplier (5.0x) when a wheel has 3+ simultaneous contacts */
    cavityRollingFrictionMultiplier: number;
  };
  /** Step 2.8: Vehicle integrity HUD diagram configuration */
  integrityDiagram: {
    widthPx: number;
    heightPx: number;
    updateIntervalMs: number;
    defaultEnabled: boolean;
  };
  /** Human-like AI pilot imperfection & personality tuning constants */
  aiReactionDelayMs: number;
  aiLoseTrackLineOfSight: boolean;
  aiMistakeChance: number;
  aiPersonalityVariation: boolean;
  aiHesitationMs: number;
  /** Anisotropic friction & restitution table per MaterialType */
  materials: Record<MaterialType, MaterialFrictionProfile>;
}

export const PHYSICS_CONFIG: PhysicsEngineConfig = {
  fixedDt: 1 / 60,
  maxAccumulatedDt: 0.25,
  maxStepsPerFrame: 4,
  defaultVoxelMassKg: 1.0,
  minVehicleMassKg: 25,
  minInertia: 10,
  defaultLinearDamping: 0.02,
  defaultAngularDamping: 0.08,
  linearDamping: 0.02,
  angularDamping: 0.08,
  maxLinearSpeedMPS: 55.0,
  maxAngularSpeedRadPS: 4.5,
  sleepLinearVelSqThreshold: 0.001,
  sleepAngularVelSqThreshold: 0.001,
  sleepTimeThresholdSec: 1.0,
  // Small-object sleep thresholds (BUG 2): sleep when velocity < 0.1 m/s for 0.5s
  smallObjectSleepSpeedMPS: 0.1,
  smallObjectSleepLinearVelSqThreshold: 0.01, // (0.1 m/s)^2
  smallObjectSleepAngularVelSqThreshold: 0.0225, // (0.15 rad/s)^2
  smallObjectSleepTimeThresholdSec: 0.5,
  smallObjectMaxMassKg: 250,
  // Exact world gravity vector (BUG 3): (0, -9.81, 0)
  gravity: {
    x: 0,
    y: -9.81,
    z: 0,
  },
  buoyancy: {
    waterDensityKgM3: 1000,
    gravityMPS2: 9.81,
    waterDragCoefficient: 0.5,
    nonBuoyantSinkScale: 0.65,
  },
  rotor: {
    defaultPowerNewtons: 8000,
    reactionTorqueFactor: 0.3,
    cyclicTiltMaxRad: 0.32,
  },
  jet: {
    defaultPowerNewtons: 15000,
  },
  collisionSampling: {
    smallVehicleMaxVoxels: 100,
    mediumVehicleMaxVoxels: 300,
    smallTargetPoints: 16,
    mediumTargetPoints: 32,
    largeTargetPoints: 64,
    maxCollisionPoints: 64,
    defaultCellSizeVoxels: 2,
  },
  groundCollision: {
    // Reduced spring stiffness by 30% (14500 -> 10150) and increased damping by 50% (980 -> 1470)
    springStiffnessPerPoint: 10150,
    damperCoefficientPerPoint: 1470,
    restLength: 0,
    snapToRestPenetration: 0.01,
    snapToRestSpeedMPS: 0.05,
    recentCollisionWindowSec: 0.15,
    idleRollingFrictionMultiplier: 3.0,
    maxUpwardForceGravityMult: 1.5,
    maxPenetrationMeters: 0.65,
    positionCorrectionSlop: 0.008,
    positionCorrectionPercent: 0.35,
    crunchyImpactSpeedThreshold: 6.0,
    stickyLatchSpeedThreshold: 2.5,
    stickyAdhesionForce: 2800,
  },
  limits: {
    defaultMaxVehicles: 20,
    extendedMaxVehicles: 50,
    maxActiveDebris: 200,
  },
  broadphase: {
    cellSizeMeters: 16.0,
    aabbPaddingMeters: 0.35,
  },
  collisionResponse: {
    damagePerImpulse: 0.045,
    minDamageImpulseThreshold: 80.0,
    headOnDamageMultiplier: 1.2,
    glancingDamageMultiplier: 0.7,
    crunchyDamageMultiplier: 1.5,
    bouncyDamageMultiplier: 0.5,
    defaultDamageMultiplier: 1.0,
    stickyHoldingForce: 3200.0,
    stickyBreakDistanceMeters: 0.95,
    maxPushOutMeters: 0.5,
    baumgarteFactor: 0.8,
    baumgarteSlopMeters: 0.01,
    maxFramePositionCorrectionMeters: 0.5,
    hardEjectionPenetrationMeters: 0.5,
    hardEjectionClearPenetrationMeters: 0.1,
    hardEjectionCorrectionFactor: 1.0,
    hardEjectionBounceSpeedMPS: 5.0,
  },
  destruction: {
    defaultVoxelHp: 75,
    armorVoxelHp: 180,
    crunchyVoxelHp: 55,
    screenShakeDurationSec: 0.1,
    screenShakeMagnitude: 0.18,
  },
  c4IgniteDelayMs: 200,
  c4ExplosionRadius: 2.5,
  c4DamageInRadius: 80,
  c4VehicleImpulse: 5000,
  c4OtherVehicleImpulse: 3000,
  c4OtherVehicleRadius: 5.0,
  c4ChainToAdjacentC4: true,
  c4: {
    c4IgniteDelayMs: 200,
    c4ExplosionRadius: 2.5,
    c4DamageInRadius: 80,
    c4VehicleImpulse: 5000,
    c4OtherVehicleImpulse: 3000,
    c4OtherVehicleRadius: 5.0,
    c4ChainToAdjacentC4: true,
    debrisSpeedMinMPS: 10,
    debrisSpeedMaxMPS: 30,
    fxParticleCountMin: 8,
    fxParticleCountMax: 12,
    screenShakeDurationSec: 0.2,
    screenShakeMagnitude: 0.22,
  },
  structuralIntegrity: {
    localCheckRadiusVoxels: 5,
    fallOffDelayMinMs: 100,
    fallOffDelayMaxMs: 200,
    fallOffTintHex: 0xdc2626,
  },
  debris: {
    maxActiveDebris: 200,
    debrisMassKg: 1.0,
    gravityMPS2: 9.81,
    linearDrag: 0.35,
    outwardImpulseMin: 5.5,
    outwardImpulseMax: 14.5,
    sleepDelaySec: 0.5,
    wakeRadiusMeters: 2.2,
    staticFadeDelaySec: 5.0,
    fadeDurationSec: 1.0,
    convertToWorldVoxelOnStop: false,
    bounceRestitution: 0.32,
    groundFriction: 0.74,
  },
  hybridWheels: {
    defaultVoxelsPerWheel: 12,
    minRadiusScale: 0.55,
    minGripScale: 0.35,
    shotOutCornerDragFriction: 1.35,
    slipRollingThreshold: 0.25,
    cavityContactThreshold: 3,
    cavityRollingFrictionMultiplier: 5.0,
  },
  integrityDiagram: {
    widthPx: 120,
    heightPx: 80,
    updateIntervalMs: 200,
    defaultEnabled: true,
  },
  materials: {
    [MaterialType.DEFAULT]: {
      forwardFriction: 0.5,
      lateralFriction: 0.7,
      restitution: 0.1,
      crunchiness: 0.4,
    },
    [MaterialType.GRIPPY]: {
      forwardFriction: 0.9,
      lateralFriction: 0.95,
      restitution: 0.05,
      crunchiness: 0.15,
    },
    [MaterialType.SLIPPERY]: {
      forwardFriction: 0.1,
      lateralFriction: 0.1,
      restitution: 0.05,
      crunchiness: 0.2,
    },
    [MaterialType.BOUNCY]: {
      forwardFriction: 0.3,
      lateralFriction: 0.3,
      restitution: 0.7,
      crunchiness: 0.05,
    },
    [MaterialType.CRUNCHY]: {
      forwardFriction: 0.6,
      lateralFriction: 0.6,
      restitution: 0.2,
      crunchiness: 1.5,
      breaksOnImpact: true,
    },
    [MaterialType.STICKY]: {
      forwardFriction: 0.4,
      lateralFriction: 0.9,
      restitution: 0.0,
      crunchiness: 0.2,
      latchesOnContact: true,
    },
    // Deferred v1.1 magic voxel defaults
    [MaterialType.HOVERVOXEL]: {
      forwardFriction: 0.05,
      lateralFriction: 0.05,
      restitution: 0.2,
      crunchiness: 0.3,
    },
    [MaterialType.MAGNETVOXEL]: {
      forwardFriction: 0.6,
      lateralFriction: 0.85,
      restitution: 0.05,
      crunchiness: 0.2,
    },
    [MaterialType.SPRINGVOXEL]: {
      forwardFriction: 0.35,
      lateralFriction: 0.45,
      restitution: 0.85,
      crunchiness: 0.05,
    },
    [MaterialType.EXPLOSIVEVOXEL]: {
      forwardFriction: 0.6,
      lateralFriction: 0.6,
      restitution: 0.1,
      crunchiness: 2.0,
      breaksOnImpact: true,
    },
  },
  aiReactionDelayMs: 300,
  aiLoseTrackLineOfSight: true,
  aiMistakeChance: 0.20,
  aiPersonalityVariation: true,
  aiHesitationMs: 500,
};

/**
 * Maps a raw voxel material ID (MAT.*) to its corresponding physics MaterialType.
 */
export function mapVoxelMatToMaterialType(matId: number): MaterialType {
  const cleanMat = matId & 63;
  switch (cleanMat) {
    case MAT.ASPHALT:
    case MAT.ROAD_LINE:
    case MAT.RAMP_ORANGE:
    case MAT.PAINT_CARBON:
      return MaterialType.GRIPPY;
    case MAT.SAND:
    case MAT.WATER_VOX:
    case MAT.CHROME_SILVER:
      return MaterialType.SLIPPERY;
    case MAT.FLOAT_YELLOW:
    case MAT.GLOW_CRYSTAL:
      return MaterialType.BOUNCY;
    case MAT.GLASS_SOLID:
    case MAT.BRICK:
    case MAT.WOOD:
    case MAT.C4_EXPLOSIVE:
      return MaterialType.CRUNCHY;
    case MAT.GLOW_MAGMA:
    case MAT.PAINT_CAMO:
      return MaterialType.STICKY;
    default:
      return MaterialType.DEFAULT;
  }
}

export function getMaterialFrictionProfile(
  material: MaterialType,
): MaterialFrictionProfile {
  return (
    PHYSICS_CONFIG.materials[material] ||
    PHYSICS_CONFIG.materials[MaterialType.DEFAULT]
  );
}
