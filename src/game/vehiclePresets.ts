import {
  MAT,
  type ModuleKind,
} from './constants.ts';

export interface PresetBoxDef {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  mat: number;
}

export interface PresetModuleDef {
  kind: ModuleKind;
  vx: number;
  vy: number;
  vz: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
}

export interface VehiclePresetDef {
  id: number;
  name: string;
  category:
    | 'Buggy'
    | 'Heavy Truck'
    | 'Speedboat'
    | 'Submarine'
    | 'Jet Bike'
    | 'Aircraft'
    | 'Starter';
  description: string;
  boxes: PresetBoxDef[];
  modules: PresetModuleDef[];
}

export const VEHICLE_PRESETS: VehiclePresetDef[] = [
  // --------------------------------------------------------------------------
  // Preset 0: 01. Baja Trophy Truck (Buggy)
  // --------------------------------------------------------------------------
  {
    id: 0,
    name: 'Baja Trophy Truck',
    category: 'Buggy',
    description: 'High-speed desert buggy with beveled tube chassis, independent long-travel double-wishbone suspension, V8 supercharger, roll cage cockpit, twin rally headlights, and rear dragon thrusters.',
    boxes: [
      // Lower main chassis tube frame rails
      { x1: 6, y1: 5, z1: 6, x2: 17, y2: 6, z2: 29, mat: MAT.ALLOY_BLUE },
      // Side step-bars & rock sliders
      { x1: 5, y1: 5, z1: 10, x2: 6, y2: 5, z2: 25, mat: MAT.ARMOR_SLATE },
      { x1: 17, y1: 5, z1: 10, x2: 18, y2: 5, z2: 25, mat: MAT.ARMOR_SLATE },
      // Raised mid-section cockpit tub & engine bay
      { x1: 7, y1: 7, z1: 10, x2: 16, y2: 8, z2: 25, mat: MAT.ALLOY_BLUE },
      // Interior cockpit hollow cavity for driver seating
      { x1: 9, y1: 7, z1: 12, x2: 14, y2: 9, z2: 22, mat: MAT.AIR },
      // Reinforced front bumper bull-bar & skidplate
      { x1: 5, y1: 5, z1: 29, x2: 18, y2: 8, z2: 31, mat: MAT.ARMOR_SLATE },
      // Rear bed chase rack & spoiler arch
      { x1: 7, y1: 8, z1: 7, x2: 16, y2: 9, z2: 9, mat: MAT.RAMP_ORANGE },
    ],
    modules: [
      // Driver cockpit with roll cage & telemetry screen
      { kind: 'COCKPIT', vx: 12, vy: 7, vz: 18 },
      // Front mounted supercharged V8 engine
      { kind: 'V8_ENGINE', vx: 12, vy: 7, vz: 26 },
      // Twin high-power rally headlights
      { kind: 'HEADLIGHT', vx: 7, vy: 8, vz: 31 },
      { kind: 'HEADLIGHT', vx: 16, vy: 8, vz: 31 },
      // Front Independent Suspension & Steerable All-Terrain Wheels
      { kind: 'SUSPENSION', vx: 5, vy: 6, vz: 25 },
      { kind: 'SUSPENSION', vx: 18, vy: 6, vz: 25 },
      { kind: 'STEERING_HINGE', vx: 6, vy: 5, vz: 25 },
      { kind: 'STEERING_HINGE', vx: 17, vy: 5, vz: 25 },
      { kind: 'WHEEL_STEER', vx: 5, vy: 5, vz: 25 },
      { kind: 'WHEEL_STEER', vx: 18, vy: 5, vz: 25 },
      // Rear High-Traction Drive Wheels
      { kind: 'SUSPENSION', vx: 5, vy: 6, vz: 10 },
      { kind: 'SUSPENSION', vx: 18, vy: 6, vz: 10 },
      { kind: 'WHEEL_DRIVE', vx: 5, vy: 5, vz: 10 },
      { kind: 'WHEEL_DRIVE', vx: 18, vy: 5, vz: 10 },
      // Dual Rear Dragon Thruster Boosters
      { kind: 'THRUSTER', vx: 9, vy: 7, vz: 6 },
      { kind: 'THRUSTER', vx: 14, vy: 7, vz: 6 },
      // Combat hardware
      { kind: 'PLASMA_CANNON', vx: 12, vy: 10, vz: 23 },
    ],
  },

  // --------------------------------------------------------------------------
  // Preset 1: 02. Heavy Siege Tank (Heavy Truck)
  // --------------------------------------------------------------------------
  {
    id: 1,
    name: 'Heavy Siege Tank',
    category: 'Heavy Truck',
    description: 'Armored multi-axle heavy combat rig with beveled composite armor skirts, 6-wheel heavy drive traction, twin V8 powerplants, armored cockpit module, and dual plasma turrets.',
    boxes: [
      // Heavy lower chassis hull & armor deck
      { x1: 4, y1: 5, z1: 4, x2: 19, y2: 8, z2: 31, mat: MAT.ARMOR_SLATE },
      // Side track armor guards & sponsons
      { x1: 3, y1: 6, z1: 6, x2: 4, y2: 8, z2: 30, mat: MAT.ARMOR_SLATE },
      { x1: 19, y1: 6, z1: 6, x2: 20, y2: 8, z2: 30, mat: MAT.ARMOR_SLATE },
      // Turret deck & armored superstructure
      { x1: 7, y1: 9, z1: 11, x2: 16, y2: 11, z2: 24, mat: MAT.ARMOR_SLATE },
      // Interior compartment hollow
      { x1: 9, y1: 9, z1: 14, x2: 14, y2: 11, z2: 20, mat: MAT.AIR },
      // Heavy frontal ramming prow & wedge armor
      { x1: 3, y1: 5, z1: 31, x2: 20, y2: 9, z2: 33, mat: MAT.ARMOR_SLATE },
    ],
    modules: [
      { kind: 'COCKPIT', vx: 12, vy: 9, vz: 17 },
      { kind: 'V8_ENGINE', vx: 9, vy: 9, vz: 9 },
      { kind: 'V8_ENGINE', vx: 14, vy: 9, vz: 9 },
      { kind: 'HEADLIGHT', vx: 6, vy: 9, vz: 33 },
      { kind: 'HEADLIGHT', vx: 17, vy: 9, vz: 33 },
      // 6-Wheel Heavy Traction Setup
      { kind: 'WHEEL_STEER', vx: 4, vy: 5, vz: 27 },
      { kind: 'WHEEL_STEER', vx: 19, vy: 5, vz: 27 },
      { kind: 'WHEEL_DRIVE', vx: 4, vy: 5, vz: 18 },
      { kind: 'WHEEL_DRIVE', vx: 19, vy: 5, vz: 18 },
      { kind: 'WHEEL_DRIVE', vx: 4, vy: 5, vz: 9 },
      { kind: 'WHEEL_DRIVE', vx: 19, vy: 5, vz: 9 },
      // Twin Armored Plasma Cannons
      { kind: 'PLASMA_CANNON', vx: 9, vy: 12, vz: 22 },
      { kind: 'PLASMA_CANNON', vx: 14, vy: 12, vz: 22 },
      // Rocket Thruster JATO Pods
      { kind: 'THRUSTER', vx: 8, vy: 7, vz: 4 },
      { kind: 'THRUSTER', vx: 15, vy: 7, vz: 4 },
    ],
  },

  // --------------------------------------------------------------------------
  // Preset 2: 03. Twin-Rotor VTOL Heli
  // --------------------------------------------------------------------------
  {
    id: 2,
    name: 'Twin-Rotor VTOL Heli',
    category: 'Aircraft',
    description: 'Dual-rotor tactical VTOL with streamlined fuselage, twin swashplate rotors, tubular skid landing gear, aerodynamic stub wings, and rocket thrusters.',
    boxes: [
      { x1: 8, y1: 5, z1: 9, x2: 15, y2: 6, z2: 26, mat: MAT.ALLOY_BLUE },
      { x1: 7, y1: 4, z1: 10, x2: 8, y2: 4, z2: 25, mat: MAT.ARMOR_SLATE },
      { x1: 15, y1: 4, z1: 10, x2: 16, y2: 4, z2: 25, mat: MAT.ARMOR_SLATE },
      { x1: 11, y1: 7, z1: 6, x2: 12, y2: 10, z2: 14, mat: MAT.ALLOY_BLUE },
    ],
    modules: [
      { kind: 'COCKPIT', vx: 12, vy: 7, vz: 20 },
      { kind: 'HEADLIGHT', vx: 12, vy: 6, vz: 26 },
      { kind: 'VTOL_ROTOR', vx: 12, vy: 11, vz: 22 },
      { kind: 'VTOL_ROTOR', vx: 12, vy: 11, vz: 11 },
      { kind: 'AERO_WING', vx: 6, vy: 7, vz: 17 },
      { kind: 'AERO_WING', vx: 17, vy: 7, vz: 17 },
      { kind: 'THRUSTER', vx: 9, vy: 7, vz: 9 },
      { kind: 'THRUSTER', vx: 14, vy: 7, vz: 9 },
      { kind: 'PLASMA_CANNON', vx: 9, vy: 6, vz: 26 },
      { kind: 'PLASMA_CANNON', vx: 14, vy: 6, vz: 26 },
      { kind: 'GYRO', vx: 12, vy: 7, vz: 16 },
    ],
  },

  // --------------------------------------------------------------------------
  // Preset 3: 04. Hydro-Foil Gunboat (Speedboat)
  // --------------------------------------------------------------------------
  {
    id: 3,
    name: 'Hydro-Foil Gunboat',
    category: 'Speedboat',
    description: 'Catamaran high-speed gunboat featuring twin hydrodynamic float pontoons, beveled keels, twin outboard marine motors with anti-cavitation plates and 3-blade curved propellers, water thrusters, and bow landing gear.',
    boxes: [
      // Twin catamaran flotation pontoons with beveled bow keels
      { x1: 4, y1: 4, z1: 5, x2: 7, y2: 7, z2: 30, mat: MAT.FLOAT_YELLOW },
      { x1: 16, y1: 4, z1: 5, x2: 19, y2: 7, z2: 30, mat: MAT.FLOAT_YELLOW },
      // Elevated center bridge deck
      { x1: 6, y1: 6, z1: 7, x2: 17, y2: 7, z2: 28, mat: MAT.ALLOY_BLUE },
      // Forward command deck & weapons mount
      { x1: 8, y1: 8, z1: 22, x2: 15, y2: 9, z2: 28, mat: MAT.ARMOR_SLATE },
    ],
    modules: [
      { kind: 'COCKPIT', vx: 12, vy: 8, vz: 17 },
      { kind: 'V8_ENGINE', vx: 12, vy: 8, vz: 11 },
      { kind: 'HEADLIGHT', vx: 9, vy: 9, vz: 28 },
      { kind: 'HEADLIGHT', vx: 14, vy: 9, vz: 28 },
      // Twin Outboard Marine Motors & 3-Blade Curved Propellers
      { kind: 'BOAT_OUTBOARD', vx: 6, vy: 5, vz: 5 },
      { kind: 'BOAT_OUTBOARD', vx: 17, vy: 5, vz: 5 },
      // Water Thruster Boosters
      { kind: 'THRUSTER', vx: 9, vy: 8, vz: 7 },
      { kind: 'THRUSTER', vx: 14, vy: 8, vz: 7 },
      // Forward Deck Plasma Turret
      { kind: 'PLASMA_CANNON', vx: 12, vy: 10, vz: 25 },
      // Amphibious beaching wheels
      { kind: 'WHEEL_STEER', vx: 4, vy: 4, vz: 24 },
      { kind: 'WHEEL_STEER', vx: 19, vy: 4, vz: 24 },
      { kind: 'WHEEL_DRIVE', vx: 4, vy: 4, vz: 10 },
      { kind: 'WHEEL_DRIVE', vx: 19, vy: 4, vz: 10 },
    ],
  },

  // --------------------------------------------------------------------------
  // Preset 4: 05. Delta-Wing Stunt Jet
  // --------------------------------------------------------------------------
  {
    id: 4,
    name: 'Delta-Wing Stunt Jet',
    category: 'Aircraft',
    description: 'Supersonic delta-wing fighter with swept wings, triple afterburning dragon thrusters with emissive cores, vertical stabilizer tailfin, and retractable tricycle landing gear.',
    boxes: [
      { x1: 9, y1: 5, z1: 6, x2: 14, y2: 6, z2: 30, mat: MAT.ALLOY_BLUE },
      { x1: 4, y1: 5, z1: 9, x2: 9, y2: 5, z2: 21, mat: MAT.ALLOY_BLUE },
      { x1: 14, y1: 5, z1: 9, x2: 19, y2: 5, z2: 21, mat: MAT.ALLOY_BLUE },
      { x1: 11, y1: 7, z1: 6, x2: 12, y2: 10, z2: 12, mat: MAT.ARMOR_SLATE },
    ],
    modules: [
      { kind: 'COCKPIT', vx: 12, vy: 7, vz: 21 },
      { kind: 'V8_ENGINE', vx: 12, vy: 7, vz: 15 },
      { kind: 'HEADLIGHT', vx: 12, vy: 6, vz: 30 },
      { kind: 'AERO_WING', vx: 4, vy: 6, vz: 15 },
      { kind: 'AERO_WING', vx: 19, vy: 6, vz: 15 },
      { kind: 'AERO_WING', vx: 8, vy: 6, vz: 24 },
      { kind: 'AERO_WING', vx: 15, vy: 6, vz: 24 },
      // Triple Dragon Jet Thrusters with Emissive Cores
      { kind: 'THRUSTER', vx: 9, vy: 7, vz: 6 },
      { kind: 'THRUSTER', vx: 12, vy: 7, vz: 6 },
      { kind: 'THRUSTER', vx: 14, vy: 7, vz: 6 },
      // Tricycle Landing Gear
      { kind: 'WHEEL_STEER', vx: 9, vy: 4, vz: 26 },
      { kind: 'WHEEL_STEER', vx: 14, vy: 4, vz: 26 },
      { kind: 'WHEEL_DRIVE', vx: 7, vy: 4, vz: 11 },
      { kind: 'WHEEL_DRIVE', vx: 16, vy: 4, vz: 11 },
      { kind: 'PLASMA_CANNON', vx: 12, vy: 7, vz: 28 },
      { kind: 'GYRO', vx: 12, vy: 7, vz: 18 },
    ],
  },

  // --------------------------------------------------------------------------
  // Preset 5: 06. 1-Voxel Scratch Builder Core
  // --------------------------------------------------------------------------
  {
    id: 5,
    name: 'Scratch Builder Core',
    category: 'Starter',
    description: 'Clean single voxel starter block for custom ground-up Trailmakers-style engineering.',
    boxes: [
      { x1: 12, y1: 6, z1: 18, x2: 12, y2: 6, z2: 18, mat: MAT.ALLOY_BLUE },
    ],
    modules: [],
  },

  // --------------------------------------------------------------------------
  // Preset 6: 07. Trailmakers Dirt Bike (Jet Bike)
  // --------------------------------------------------------------------------
  {
    id: 6,
    name: 'Trailmakers Dirt Bike',
    category: 'Jet Bike',
    description: 'True 2-wheel jet bike with motocross seat, handlebars, Dragon engine, front steerable fork with coilover suspension, rear swingarm with all-terrain drive wheel, rocket booster, and gyro stabilizer.',
    boxes: [
      // Central tubular bike spine & engine cradle
      { x1: 11, y1: 5, z1: 10, x2: 12, y2: 6, z2: 26, mat: MAT.ALLOY_BLUE },
      // Gas tank & fairing shroud
      { x1: 11, y1: 7, z1: 22, x2: 12, y2: 8, z2: 25, mat: MAT.RAMP_ORANGE },
    ],
    modules: [
      // Motocross Seat with Handlebars & digital readout
      { kind: 'SEAT_MOTO', vx: 12, vy: 7, vz: 17 },
      // Dragon Power Engine
      { kind: 'ENGINE_DRAGON', vx: 12, vy: 6, vz: 19 },
      // Front Rally Headlight
      { kind: 'HEADLIGHT', vx: 12, vy: 8, vz: 26 },
      // Front Fork: Steering Hinge + Coilover Suspension + Offroad Wheel
      { kind: 'STEERING_HINGE', vx: 12, vy: 7, vz: 26 },
      { kind: 'SUSPENSION', vx: 12, vy: 6, vz: 26 },
      { kind: 'WHEEL_DRIVE', vx: 12, vy: 5, vz: 26 },
      // Rear Swingarm: Coilover Suspension + Offroad Wheel
      { kind: 'SUSPENSION', vx: 12, vy: 6, vz: 10 },
      { kind: 'WHEEL_DRIVE', vx: 12, vy: 5, vz: 10 },
      // Gyro Stabilizer & Mini Rocket Booster
      { kind: 'GYRO', vx: 12, vy: 6, vz: 14 },
      { kind: 'THRUSTER_MINI', vx: 12, vy: 7, vz: 10 },
    ],
  },

  // --------------------------------------------------------------------------
  // Preset 7: 08. Nautilus Deep Submarine
  // --------------------------------------------------------------------------
  {
    id: 7,
    name: 'Nautilus Deep Submarine',
    category: 'Submarine',
    description: 'Deep-sea attack & exploration submarine with active BCD ballast tanks (Hold [Ctrl]/[C] to Dive, [Space] to Surface, Neutral underwater hover), diving chamber helm, twin marine propellers, hydroplane dive fins, and dual abyssal floodlights.',
    boxes: [
      // Pressure Hull Lower & Upper Keel
      { x1: 8, y1: 5, z1: 7, x2: 15, y2: 7, z2: 28, mat: MAT.RAMP_ORANGE },
      // Conning Tower Sail & Periscope Mast
      { x1: 10, y1: 8, z1: 15, x2: 13, y2: 10, z2: 21, mat: MAT.ARMOR_SLATE },
      // Forward Reinforced Glass Observation Dome
      { x1: 9, y1: 6, z1: 28, x2: 14, y2: 7, z2: 29, mat: MAT.GLASS_SOLID },
      // Side Ballast Pontoons
      { x1: 6, y1: 5, z1: 10, x2: 7, y2: 6, z2: 25, mat: MAT.STEEL },
      { x1: 16, y1: 5, z1: 10, x2: 17, y2: 6, z2: 25, mat: MAT.STEEL },
    ],
    modules: [
      // Pressurized Diving Chamber Seat
      { kind: 'SEAT_DIVING', vx: 12, vy: 8, vz: 22 },
      // Dual Active Ballast BCD Tanks (Ctrl/C = Flood & Dive, Space = Blow & Surface)
      { kind: 'BCD_TANK', vx: 7, vy: 7, vz: 18 },
      { kind: 'BCD_TANK', vx: 16, vy: 7, vz: 18 },
      // Marine Powerplant & Gyro Depth Stabilizer
      { kind: 'V8_ENGINE', vx: 12, vy: 8, vz: 13 },
      { kind: 'GYRO', vx: 12, vy: 8, vz: 17 },
      // Twin Stern Marine Screws + Hydro-Jet Thrusters
      { kind: 'BOAT_PROP', vx: 9, vy: 6, vz: 6 },
      { kind: 'BOAT_PROP', vx: 14, vy: 6, vz: 6 },
      { kind: 'THRUSTER', vx: 11, vy: 7, vz: 7 },
      { kind: 'THRUSTER', vx: 12, vy: 7, vz: 7 },
      // Bow & Stern Hydroplane Diving Fins + Powered Rudder
      { kind: 'AERO_WING', vx: 5, vy: 6, vz: 24 },
      { kind: 'AERO_WING', vx: 18, vy: 6, vz: 24 },
      { kind: 'TAILFIN_POWERED', vx: 12, vy: 9, vz: 8 },
      // Abyssal High-Lumen Floodlights & Deck Torpedo Cannon
      { kind: 'HEADLIGHT', vx: 9, vy: 7, vz: 29 },
      { kind: 'HEADLIGHT', vx: 14, vy: 7, vz: 29 },
      { kind: 'PLASMA_CANNON', vx: 12, vy: 8, vz: 26 },
      // Retractable Amphibian Crawler Wheels for Slipway Launch
      { kind: 'WHEEL_STEER', vx: 6, vy: 4, vz: 24 },
      { kind: 'WHEEL_STEER', vx: 17, vy: 4, vz: 24 },
      { kind: 'WHEEL_DRIVE', vx: 6, vy: 4, vz: 11 },
      { kind: 'WHEEL_DRIVE', vx: 17, vy: 4, vz: 11 },
    ],
  },
];
