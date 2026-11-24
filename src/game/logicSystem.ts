/**
 * Micro:bit ECU Programmable Logic System & Scratch AST Engine
 *
 * CRITICAL GAMEPLAY BALANCE RULE (NO "MAGIC" TELEMETRY):
 * - The Micro:bit ECU cannot read any environmental or vehicle data on its own.
 * - Every input value in the Scratch block editor MUST come from a physical Sensor Module
 *   actually mounted on the vehicle's voxel grid and connected to the chassis.
 * - If a sensor block is not installed—or gets blown off/destroyed in combat (health <= 0)—
 *   its corresponding Scratch input block returns 0 / false (and displays [NO HARDWARE SIGNAL]).
 * - The Micro:bit LED screen flashes a red 'X' error pattern when a referenced hardware signal
 *   is missing or severed.
 */

import type { ModuleKind } from './constants.ts';

// ----------------------------------------------------------------------------
// 1. HARDWARE PORTS & HARDWARE GATING TYPES
// ----------------------------------------------------------------------------

export type EcuPortType =
  | 'DIST'
  | 'IMU'
  | 'SPEED'
  | 'RADAR'
  | 'THRUSTER'
  | 'HINGE'
  | 'PISTON'
  | 'WEAPON'
  | 'HEADLIGHT'
  | 'ECU';

export interface HardwarePort {
  id: string; // e.g. "DIST_1", "IMU_1", "THRUSTER_1"
  tag: string; // e.g. "DIST #1 (Front)", "IMU #1", "THRUSTER #1"
  type: EcuPortType;
  modIndex: number; // index in vehicle.modules
  kind: ModuleKind;
  vx: number;
  vy: number;
  vz: number;
  hasSignal: boolean; // true if physical module exists and health > 0
  liveValue?: number; // current reading for live builder / inspector HUD
}

export type LedMatrixIcon =
  | 'HEART'
  | 'TARGET'
  | 'ARROW_UP'
  | 'ARROW_DOWN'
  | 'WARNING'
  | 'SKULL'
  | 'BAR_GRAPH'
  | 'ERROR_X'
  | 'OFF';

/**
 * 5x5 Bitmap definitions for the Micro:bit LED matrix face.
 * Array of 25 numbers (0 = off, 1 = on).
 */
export const LED_PATTERNS: Record<LedMatrixIcon, number[]> = {
  HEART: [
    0, 1, 0, 1, 0,
    1, 1, 1, 1, 1,
    1, 1, 1, 1, 1,
    0, 1, 1, 1, 0,
    0, 0, 1, 0, 0,
  ],
  TARGET: [
    0, 0, 1, 0, 0,
    0, 1, 1, 1, 0,
    1, 1, 0, 1, 1,
    0, 1, 1, 1, 0,
    0, 0, 1, 0, 0,
  ],
  ARROW_UP: [
    0, 0, 1, 0, 0,
    0, 1, 1, 1, 0,
    1, 0, 1, 0, 1,
    0, 0, 1, 0, 0,
    0, 0, 1, 0, 0,
  ],
  ARROW_DOWN: [
    0, 0, 1, 0, 0,
    0, 0, 1, 0, 0,
    1, 0, 1, 0, 1,
    0, 1, 1, 1, 0,
    0, 0, 1, 0, 0,
  ],
  WARNING: [
    0, 0, 1, 0, 0,
    0, 1, 0, 1, 0,
    1, 0, 1, 0, 1,
    1, 0, 0, 0, 1,
    1, 1, 1, 1, 1,
  ],
  SKULL: [
    0, 1, 1, 1, 0,
    1, 0, 1, 0, 1,
    1, 1, 1, 1, 1,
    0, 1, 1, 1, 0,
    0, 1, 0, 1, 0,
  ],
  BAR_GRAPH: [
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
    0, 0, 1, 1, 0,
    0, 1, 1, 1, 0,
    1, 1, 1, 1, 1,
  ],
  ERROR_X: [
    1, 0, 0, 0, 1,
    0, 1, 0, 1, 0,
    0, 0, 1, 0, 0,
    0, 1, 0, 1, 0,
    1, 0, 0, 0, 1,
  ],
  OFF: [
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
  ],
};

// ----------------------------------------------------------------------------
// 2. SCRATCH AST DEFINITIONS
// ----------------------------------------------------------------------------

export type SensorProperty =
  | 'distance'
  | 'pitch'
  | 'roll'
  | 'speed'
  | 'altitude'
  | 'target_angle'
  | 'target_distance';

export type CompareOp = '<' | '<=' | '==' | '!=' | '>=' | '>';
export type LogicOp = 'AND' | 'OR';
export type MathOp = '+' | '-' | '*' | '/' | 'min' | 'max';

export interface ReadSensorExpr {
  kind: 'READ_SENSOR';
  portId: string;
  property: SensorProperty;
}

export interface NumberConstExpr {
  kind: 'NUMBER_CONST';
  value: number;
}

export interface CompareExpr {
  kind: 'COMPARE';
  op: CompareOp;
  left: EcuExpression;
  right: EcuExpression;
}

export interface LogicGateExpr {
  kind: 'LOGIC_GATE';
  op: LogicOp;
  left: EcuExpression;
  right: EcuExpression;
}

export interface LogicNotExpr {
  kind: 'LOGIC_NOT';
  expr: EcuExpression;
}

export interface MathOpExpr {
  kind: 'MATH_OP';
  op: MathOp;
  left: EcuExpression;
  right: EcuExpression;
}

export interface ClampExpr {
  kind: 'CLAMP';
  val: EcuExpression;
  min: EcuExpression;
  max: EcuExpression;
}

export type EcuExpression =
  | ReadSensorExpr
  | NumberConstExpr
  | CompareExpr
  | LogicGateExpr
  | LogicNotExpr
  | MathOpExpr
  | ClampExpr;

export interface IfThenAction {
  kind: 'IF_THEN';
  condition: EcuExpression;
  thenActions: EcuAction[];
  elseActions?: EcuAction[];
}

export interface SetThrustAction {
  kind: 'SET_THRUST';
  portId: string; // "THRUSTER_1" or "ALL_THRUSTERS"
  thrustPercent: EcuExpression; // 0..100
}

export interface SetHingeAction {
  kind: 'SET_HINGE';
  portId: string; // "HINGE_1"
  angleDeg: EcuExpression; // -45..+45
}

export interface SetPistonAction {
  kind: 'SET_PISTON';
  portId: string; // "PISTON_1"
  extensionPercent: EcuExpression; // 0..100
}

export interface FireWeaponAction {
  kind: 'FIRE_WEAPON';
  portId: string; // "WEAPON_1" or "ALL_WEAPONS"
  fire: EcuExpression; // >0 or true
}

export interface SetHeadlightAction {
  kind: 'SET_HEADLIGHT';
  portId: string; // "HEADLIGHT_1"
  on: EcuExpression; // >0 or true
}

export interface SetLedMatrixAction {
  kind: 'SET_LED_MATRIX';
  icon: LedMatrixIcon;
}

export type EcuAction =
  | IfThenAction
  | SetThrustAction
  | SetHingeAction
  | SetPistonAction
  | FireWeaponAction
  | SetHeadlightAction
  | SetLedMatrixAction;

export interface EcuEventRule {
  id: string;
  name: string;
  event: 'TICK' | 'KEY_DOWN';
  keyBinding?: string; // e.g. "Space", "KeyF", "KeyE", "KeyX"
  enabled?: boolean; // default true
  actions: EcuAction[];
}

export interface EcuProgram {
  id: string;
  name: string;
  enabled: boolean;
  createdAt?: string;
  rules: EcuEventRule[];
}

// ----------------------------------------------------------------------------
// 3. HARDWARE TELEMETRY & EXECUTION CONTEXT
// ----------------------------------------------------------------------------

export interface SensorTelemetryContext {
  // Keyed by portId, e.g. "DIST_1", "IMU_1"
  distances: Record<string, { distanceMeters: number; hasSignal: boolean }>;
  imus: Record<string, { pitchDeg: number; rollDeg: number; hasSignal: boolean }>;
  speedos: Record<string, { speedKmh: number; altitudeMeters: number; hasSignal: boolean }>;
  radars: Record<string, { targetAngleDeg: number; targetDistanceMeters: number; hasSignal: boolean }>;
  keys: Record<string, boolean>;
  dt: number;
}

export interface EcuOutputState {
  thrusters: Record<string, number>; // portId -> 0..1 thrust ratio
  hinges: Record<string, number>; // portId -> angle in degrees
  pistons: Record<string, number>; // portId -> 0..1 extension
  fireWeapons: Record<string, boolean>; // portId -> fire trigger
  headlights: Record<string, boolean>; // portId -> light state
  ledMatrixIcon: LedMatrixIcon;
  missingHardwareError: boolean;
  missingPorts: string[];
}

export function createDefaultEcuOutputState(): EcuOutputState {
  return {
    thrusters: {},
    hinges: {},
    pistons: {},
    fireWeapons: {},
    headlights: {},
    ledMatrixIcon: 'OFF',
    missingHardwareError: false,
    missingPorts: [],
  };
}

// ----------------------------------------------------------------------------
// 4. FAST 60Hz AST EVALUATION ENGINE (ZERO HEAP RE-ALLOCATION)
// ----------------------------------------------------------------------------

/**
 * Evaluates an EcuExpression in the current hardware context.
 * Returns { value: number, hasSignal: boolean }.
 * If the physical sensor is missing or damaged, hasSignal is false and value is 0.
 */
export function evaluateEcuExpression(
  expr: EcuExpression,
  ctx: SensorTelemetryContext,
  missingCollector?: string[],
): { value: number; hasSignal: boolean } {
  switch (expr.kind) {
    case 'NUMBER_CONST':
      return { value: Number(expr.value) || 0, hasSignal: true };

    case 'READ_SENSOR': {
      const portId = expr.portId;
      const prop = expr.property;

      if (prop === 'distance') {
        const item = ctx.distances[portId];
        if (!item || !item.hasSignal) {
          if (missingCollector && !missingCollector.includes(portId)) missingCollector.push(portId);
          return { value: 0, hasSignal: false };
        }
        return { value: item.distanceMeters, hasSignal: true };
      }

      if (prop === 'pitch' || prop === 'roll') {
        const item = ctx.imus[portId];
        if (!item || !item.hasSignal) {
          if (missingCollector && !missingCollector.includes(portId)) missingCollector.push(portId);
          return { value: 0, hasSignal: false };
        }
        return {
          value: prop === 'pitch' ? item.pitchDeg : item.rollDeg,
          hasSignal: true,
        };
      }

      if (prop === 'speed' || prop === 'altitude') {
        const item = ctx.speedos[portId];
        if (!item || !item.hasSignal) {
          if (missingCollector && !missingCollector.includes(portId)) missingCollector.push(portId);
          return { value: 0, hasSignal: false };
        }
        return {
          value: prop === 'speed' ? item.speedKmh : item.altitudeMeters,
          hasSignal: true,
        };
      }

      if (prop === 'target_angle' || prop === 'target_distance') {
        const item = ctx.radars[portId];
        if (!item || !item.hasSignal) {
          if (missingCollector && !missingCollector.includes(portId)) missingCollector.push(portId);
          return { value: 0, hasSignal: false };
        }
        return {
          value: prop === 'target_angle' ? item.targetAngleDeg : item.targetDistanceMeters,
          hasSignal: true,
        };
      }

      return { value: 0, hasSignal: false };
    }

    case 'COMPARE': {
      const l = evaluateEcuExpression(expr.left, ctx, missingCollector);
      const r = evaluateEcuExpression(expr.right, ctx, missingCollector);
      const hasSignal = l.hasSignal && r.hasSignal;
      if (!hasSignal) return { value: 0, hasSignal: false };

      let res = false;
      switch (expr.op) {
        case '<': res = l.value < r.value; break;
        case '<=': res = l.value <= r.value; break;
        case '==': res = Math.abs(l.value - r.value) < 1e-4; break;
        case '!=': res = Math.abs(l.value - r.value) >= 1e-4; break;
        case '>=': res = l.value >= r.value; break;
        case '>': res = l.value > r.value; break;
      }
      return { value: res ? 1 : 0, hasSignal: true };
    }

    case 'LOGIC_GATE': {
      const l = evaluateEcuExpression(expr.left, ctx, missingCollector);
      const r = evaluateEcuExpression(expr.right, ctx, missingCollector);
      const hasSignal = l.hasSignal && r.hasSignal;
      if (!hasSignal) return { value: 0, hasSignal: false };

      const lb = l.value > 0.5;
      const rb = r.value > 0.5;
      const res = expr.op === 'AND' ? (lb && rb) : (lb || rb);
      return { value: res ? 1 : 0, hasSignal: true };
    }

    case 'LOGIC_NOT': {
      const sub = evaluateEcuExpression(expr.expr, ctx, missingCollector);
      if (!sub.hasSignal) return { value: 0, hasSignal: false };
      return { value: sub.value > 0.5 ? 0 : 1, hasSignal: true };
    }

    case 'MATH_OP': {
      const l = evaluateEcuExpression(expr.left, ctx, missingCollector);
      const r = evaluateEcuExpression(expr.right, ctx, missingCollector);
      const hasSignal = l.hasSignal && r.hasSignal;
      if (!hasSignal) return { value: 0, hasSignal: false };

      let res = 0;
      switch (expr.op) {
        case '+': res = l.value + r.value; break;
        case '-': res = l.value - r.value; break;
        case '*': res = l.value * r.value; break;
        case '/': res = Math.abs(r.value) > 1e-5 ? l.value / r.value : 0; break;
        case 'min': res = Math.min(l.value, r.value); break;
        case 'max': res = Math.max(l.value, r.value); break;
      }
      return { value: isNaN(res) ? 0 : res, hasSignal: true };
    }

    case 'CLAMP': {
      const v = evaluateEcuExpression(expr.val, ctx, missingCollector);
      const min = evaluateEcuExpression(expr.min, ctx, missingCollector);
      const max = evaluateEcuExpression(expr.max, ctx, missingCollector);
      const hasSignal = v.hasSignal && min.hasSignal && max.hasSignal;
      if (!hasSignal) return { value: 0, hasSignal: false };

      const low = Math.min(min.value, max.value);
      const high = Math.max(min.value, max.value);
      const clamped = Math.max(low, Math.min(high, v.value));
      return { value: clamped, hasSignal: true };
    }

    default:
      return { value: 0, hasSignal: true };
  }
}

/**
 * Executes a list of action blocks in order, updating outputState.
 */
export function executeEcuActions(
  actions: EcuAction[],
  ctx: SensorTelemetryContext,
  outputState: EcuOutputState,
): void {
  for (const act of actions) {
    switch (act.kind) {
      case 'IF_THEN': {
        const cond = evaluateEcuExpression(act.condition, ctx, outputState.missingPorts);
        if (cond.hasSignal && cond.value > 0.5) {
          executeEcuActions(act.thenActions, ctx, outputState);
        } else if (act.elseActions && act.elseActions.length > 0) {
          executeEcuActions(act.elseActions, ctx, outputState);
        }
        break;
      }

      case 'SET_THRUST': {
        const evalThrust = evaluateEcuExpression(act.thrustPercent, ctx, outputState.missingPorts);
        const percent = Math.max(0, Math.min(100, evalThrust.value));
        outputState.thrusters[act.portId] = percent / 100;
        break;
      }

      case 'SET_HINGE': {
        const evalAngle = evaluateEcuExpression(act.angleDeg, ctx, outputState.missingPorts);
        const clampedAngle = Math.max(-45, Math.min(45, evalAngle.value));
        outputState.hinges[act.portId] = clampedAngle;
        break;
      }

      case 'SET_PISTON': {
        const evalExt = evaluateEcuExpression(act.extensionPercent, ctx, outputState.missingPorts);
        const percent = Math.max(0, Math.min(100, evalExt.value));
        outputState.pistons[act.portId] = percent / 100;
        break;
      }

      case 'FIRE_WEAPON': {
        const evalFire = evaluateEcuExpression(act.fire, ctx, outputState.missingPorts);
        outputState.fireWeapons[act.portId] = evalFire.value > 0.5;
        break;
      }

      case 'SET_HEADLIGHT': {
        const evalLight = evaluateEcuExpression(act.on, ctx, outputState.missingPorts);
        outputState.headlights[act.portId] = evalLight.value > 0.5;
        break;
      }

      case 'SET_LED_MATRIX': {
        outputState.ledMatrixIcon = act.icon;
        break;
      }
    }
  }
}

/**
 * Evaluates the full ECU Program:
 * - Checks each rule (TICK or active KEY_DOWN)
 * - Evaluates expressions with physical sensor hardware gating
 * - If any referenced sensor is missing or damaged, flags missingHardwareError and forces ERROR_X on the LED matrix
 */
export function evaluateEcuProgram(
  program: EcuProgram | undefined,
  ctx: SensorTelemetryContext,
): EcuOutputState {
  const output = createDefaultEcuOutputState();
  if (!program || !program.enabled || !program.rules) {
    return output;
  }

  for (const rule of program.rules) {
    if (rule.enabled === false) continue;
    if (rule.event === 'TICK') {
      executeEcuActions(rule.actions, ctx, output);
    } else if (rule.event === 'KEY_DOWN') {
      const code = rule.keyBinding;
      if (code && ctx.keys[code]) {
        executeEcuActions(rule.actions, ctx, output);
      }
    }
  }

  if (output.missingPorts.length > 0) {
    output.missingHardwareError = true;
    output.ledMatrixIcon = 'ERROR_X';
  }

  return output;
}

// ----------------------------------------------------------------------------
// 5. STARTER TEMPLATES
// ----------------------------------------------------------------------------

export const ECU_STARTER_TEMPLATES: Record<string, { name: string; desc: string; program: EcuProgram }> = {
  AUTO_HOVER: {
    name: 'Auto-Leveling Hover Stabilizer',
    desc: 'Uses IMU #1 pitch & roll to dynamically pulse thrusters and auto-level the craft.',
    program: {
      id: 'template_auto_hover',
      name: 'Auto-Leveling Hover',
      enabled: true,
      rules: [
        {
          id: 'rule_hover_tick',
          name: '60Hz Gyro Stabilization',
          event: 'TICK',
          actions: [
            {
              kind: 'IF_THEN',
              condition: {
                kind: 'COMPARE',
                op: '>',
                left: { kind: 'READ_SENSOR', portId: 'IMU_1', property: 'pitch' },
                right: { kind: 'NUMBER_CONST', value: 3 },
              },
              thenActions: [
                {
                  kind: 'SET_THRUST',
                  portId: 'THRUSTER_FRONT',
                  thrustPercent: {
                    kind: 'CLAMP',
                    val: {
                      kind: 'MATH_OP',
                      op: '*',
                      left: { kind: 'READ_SENSOR', portId: 'IMU_1', property: 'pitch' },
                      right: { kind: 'NUMBER_CONST', value: 4 },
                    },
                    min: { kind: 'NUMBER_CONST', value: 20 },
                    max: { kind: 'NUMBER_CONST', value: 100 },
                  },
                },
                { kind: 'SET_LED_MATRIX', icon: 'ARROW_DOWN' },
              ],
              elseActions: [
                {
                  kind: 'IF_THEN',
                  condition: {
                    kind: 'COMPARE',
                    op: '<',
                    left: { kind: 'READ_SENSOR', portId: 'IMU_1', property: 'pitch' },
                    right: { kind: 'NUMBER_CONST', value: -3 },
                  },
                  thenActions: [
                    {
                      kind: 'SET_THRUST',
                      portId: 'THRUSTER_REAR',
                      thrustPercent: {
                        kind: 'CLAMP',
                        val: {
                          kind: 'MATH_OP',
                          op: '*',
                          left: {
                            kind: 'MATH_OP',
                            op: '*',
                            left: { kind: 'READ_SENSOR', portId: 'IMU_1', property: 'pitch' },
                            right: { kind: 'NUMBER_CONST', value: -1 },
                          },
                          right: { kind: 'NUMBER_CONST', value: 4 },
                        },
                        min: { kind: 'NUMBER_CONST', value: 20 },
                        max: { kind: 'NUMBER_CONST', value: 100 },
                      },
                    },
                    { kind: 'SET_LED_MATRIX', icon: 'ARROW_UP' },
                  ],
                  elseActions: [
                    { kind: 'SET_LED_MATRIX', icon: 'TARGET' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  AUTO_BRAKE: {
    name: 'Obstacle Auto-Brake',
    desc: 'Uses Distance Sensor #1 forward optical raycast to cut throttle and reverse when obstacle < 8m.',
    program: {
      id: 'template_auto_brake',
      name: 'Forward Collision Avoidance',
      enabled: true,
      rules: [
        {
          id: 'rule_brake_tick',
          name: 'Forward Laser Proximity Radar',
          event: 'TICK',
          actions: [
            {
              kind: 'IF_THEN',
              condition: {
                kind: 'COMPARE',
                op: '<',
                left: { kind: 'READ_SENSOR', portId: 'DIST_1', property: 'distance' },
                right: { kind: 'NUMBER_CONST', value: 8 },
              },
              thenActions: [
                { kind: 'SET_THRUST', portId: 'ALL_THRUSTERS', thrustPercent: { kind: 'NUMBER_CONST', value: 0 } },
                { kind: 'SET_LED_MATRIX', icon: 'WARNING' },
              ],
              elseActions: [
                { kind: 'SET_LED_MATRIX', icon: 'ARROW_UP' },
              ],
            },
          ],
        },
      ],
    },
  },

  AUTO_TURRET: {
    name: 'Auto-Tracking Turret',
    desc: 'Uses Target Radar #1 to automatically aim Steering Hinge toward nearest enemy within 60m.',
    program: {
      id: 'template_auto_turret',
      name: 'Radar Guided Point Defense',
      enabled: true,
      rules: [
        {
          id: 'rule_turret_tick',
          name: 'Track & Fire on Radar Lock',
          event: 'TICK',
          actions: [
            {
              kind: 'IF_THEN',
              condition: {
                kind: 'COMPARE',
                op: '<',
                left: { kind: 'READ_SENSOR', portId: 'RADAR_1', property: 'target_distance' },
                right: { kind: 'NUMBER_CONST', value: 60 },
              },
              thenActions: [
                {
                  kind: 'SET_HINGE',
                  portId: 'HINGE_1',
                  angleDeg: {
                    kind: 'CLAMP',
                    val: { kind: 'READ_SENSOR', portId: 'RADAR_1', property: 'target_angle' },
                    min: { kind: 'NUMBER_CONST', value: -45 },
                    max: { kind: 'NUMBER_CONST', value: 45 },
                  },
                },
                {
                  kind: 'IF_THEN',
                  condition: {
                    kind: 'COMPARE',
                    op: '<=',
                    left: {
                      kind: 'CLAMP',
                      val: { kind: 'READ_SENSOR', portId: 'RADAR_1', property: 'target_angle' },
                      min: { kind: 'NUMBER_CONST', value: -15 },
                      max: { kind: 'NUMBER_CONST', value: 15 },
                    },
                    right: { kind: 'NUMBER_CONST', value: 15 },
                  },
                  thenActions: [
                    { kind: 'FIRE_WEAPON', portId: 'ALL_WEAPONS', fire: { kind: 'NUMBER_CONST', value: 1 } },
                    { kind: 'SET_LED_MATRIX', icon: 'TARGET' },
                  ],
                },
              ],
              elseActions: [
                { kind: 'SET_HINGE', portId: 'HINGE_1', angleDeg: { kind: 'NUMBER_CONST', value: 0 } },
                { kind: 'SET_LED_MATRIX', icon: 'HEART' },
              ],
            },
          ],
        },
      ],
    },
  },

  CRUISE_CONTROL: {
    name: 'Speedo Cruise Control (60 KM/H)',
    desc: 'Uses Speed Sensor #1 to maintain 60 km/h automatically by modulating thrusters.',
    program: {
      id: 'template_cruise_control',
      name: 'Speedo Cruise Control',
      enabled: true,
      rules: [
        {
          id: 'rule_cruise_tick',
          name: 'Hold 60 KM/H Speed Target',
          event: 'TICK',
          actions: [
            {
              kind: 'IF_THEN',
              condition: {
                kind: 'COMPARE',
                op: '<',
                left: { kind: 'READ_SENSOR', portId: 'SPEED_1', property: 'speed' },
                right: { kind: 'NUMBER_CONST', value: 60 },
              },
              thenActions: [
                {
                  kind: 'SET_THRUST',
                  portId: 'ALL_THRUSTERS',
                  thrustPercent: { kind: 'NUMBER_CONST', value: 85 },
                },
                { kind: 'SET_LED_MATRIX', icon: 'BAR_GRAPH' },
              ],
              elseActions: [
                {
                  kind: 'SET_THRUST',
                  portId: 'ALL_THRUSTERS',
                  thrustPercent: { kind: 'NUMBER_CONST', value: 15 },
                },
                { kind: 'SET_LED_MATRIX', icon: 'TARGET' },
              ],
            },
          ],
        },
      ],
    },
  },

  ROLL_STABILIZER: {
    name: 'Active Anti-Roll Steering',
    desc: 'Uses IMU #1 roll angle to counter-steer hinges when the vehicle tilts past 6 degrees.',
    program: {
      id: 'template_roll_stabilizer',
      name: 'Active Roll Counter-Steer',
      enabled: true,
      rules: [
        {
          id: 'rule_roll_tick',
          name: 'Counter-Steer on High Roll',
          event: 'TICK',
          actions: [
            {
              kind: 'IF_THEN',
              condition: {
                kind: 'COMPARE',
                op: '>',
                left: { kind: 'READ_SENSOR', portId: 'IMU_1', property: 'roll' },
                right: { kind: 'NUMBER_CONST', value: 6 },
              },
              thenActions: [
                {
                  kind: 'SET_HINGE',
                  portId: 'HINGE_1',
                  angleDeg: { kind: 'NUMBER_CONST', value: -25 },
                },
                { kind: 'SET_LED_MATRIX', icon: 'WARNING' },
              ],
              elseActions: [
                {
                  kind: 'SET_HINGE',
                  portId: 'HINGE_1',
                  angleDeg: { kind: 'NUMBER_CONST', value: 0 },
                },
                { kind: 'SET_LED_MATRIX', icon: 'ARROW_UP' },
              ],
            },
          ],
        },
      ],
    },
  },
};

// ----------------------------------------------------------------------------
// 6. ECU PROGRAM SAVE LIBRARY & JSON SERIALIZATION / SHARING
// ----------------------------------------------------------------------------

export const ECU_SAVED_PROGRAMS_STORAGE_KEY = 'terrasmash_saved_ecu_programs_v1';

/**
 * Serializes an EcuProgram into a clean, shareable JSON string.
 */
export function serializeEcuProgramToJson(program: EcuProgram): string {
  const payload: EcuProgram = {
    id: program.id || `ecu_${Date.now()}`,
    name: (program.name || 'Custom ECU Program').trim() || 'Custom ECU Program',
    enabled: program.enabled !== false,
    createdAt: program.createdAt || new Date().toISOString(),
    rules: Array.isArray(program.rules) ? program.rules : [],
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parses and validates an imported ECU Program JSON string.
 * Supports either a direct EcuProgram object or a vehicle blueprint containing ecuPrograms.
 */
export function parseAndValidateEcuProgramJson(
  rawJson: string,
): { ok: true; program: EcuProgram } | { ok: false; error: string } {
  const trimmed = (rawJson || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Paste a valid ECU Program JSON string first.' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'Invalid JSON syntax. Check for missing brackets or quotes.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'JSON root must be an ECU Program object.' };
  }

  // Also allow pasting a full vehicle blueprint JSON that contains ecuPrograms
  if (!Array.isArray(parsed.rules) && parsed.ecuPrograms && typeof parsed.ecuPrograms === 'object') {
    const firstProg = Object.values(parsed.ecuPrograms)[0];
    if (firstProg && typeof firstProg === 'object') {
      parsed = firstProg;
    }
  }

  if (!Array.isArray(parsed.rules)) {
    return { ok: false, error: 'Missing "rules" array in ECU Program JSON.' };
  }

  const sanitizedRules: EcuEventRule[] = [];
  for (let i = 0; i < parsed.rules.length; i++) {
    const r = parsed.rules[i];
    if (!r || typeof r !== 'object') continue;
    const event = r.event === 'KEY_DOWN' ? 'KEY_DOWN' : 'TICK';
    const actions = Array.isArray(r.actions) ? r.actions : [];
    sanitizedRules.push({
      id: typeof r.id === 'string' && r.id ? r.id : `rule_${Date.now()}_${i}`,
      name:
        typeof r.name === 'string' && r.name.trim()
          ? r.name.trim()
          : event === 'TICK'
            ? 'When Vehicle Tick (60Hz)'
            : `When Key [${r.keyBinding || 'Space'}] Pressed`,
      event,
      keyBinding: typeof r.keyBinding === 'string' ? r.keyBinding : undefined,
      enabled: r.enabled !== false,
      actions,
    });
  }

  if (sanitizedRules.length === 0) {
    sanitizedRules.push({
      id: `rule_${Date.now()}_0`,
      name: 'When Vehicle Tick (60Hz)',
      event: 'TICK',
      enabled: true,
      actions: [],
    });
  }

  const program: EcuProgram = {
    id:
      typeof parsed.id === 'string' && parsed.id.trim()
        ? parsed.id.trim()
        : `ecu_${Date.now()}`,
    name:
      typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim()
        : 'Imported ECU Program',
    enabled: parsed.enabled !== false,
    createdAt:
      typeof parsed.createdAt === 'string'
        ? parsed.createdAt
        : new Date().toISOString(),
    rules: sanitizedRules,
  };

  return { ok: true, program };
}

/**
 * Loads all user-saved ECU programs from storage (or window.localStorage).
 */
export function loadSavedEcuPrograms(
  storage?: Pick<Storage, 'getItem'> | null,
): EcuProgram[] {
  const store =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return [];
  try {
    const raw = store.getItem(ECU_SAVED_PROGRAMS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const valid: EcuProgram[] = [];
    for (const item of arr) {
      const check = parseAndValidateEcuProgramJson(JSON.stringify(item));
      if (check.ok) valid.push(check.program);
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * Saves an ECU program to the persistent library (replacing existing entry with same name or id, or prepending new).
 */
export function saveEcuProgramToLibrary(
  program: EcuProgram,
  customName?: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): { saved: EcuProgram; list: EcuProgram[] } {
  const store =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  const existing = loadSavedEcuPrograms(store);
  const cleanName =
    (customName ?? program.name ?? 'Custom ECU Program').trim() ||
    'Custom ECU Program';

  const cloned: EcuProgram = JSON.parse(JSON.stringify(program));
  const matchIdx = existing.findIndex(
    (p) => p.name.toLowerCase() === cleanName.toLowerCase(),
  );
  const saved: EcuProgram = {
    ...cloned,
    id:
      matchIdx >= 0
        ? existing[matchIdx].id
        : cloned.id && !cloned.id.startsWith('template_')
          ? cloned.id
          : `ecu_saved_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    enabled: cloned.enabled !== false,
    createdAt: new Date().toISOString(),
  };

  let nextList: EcuProgram[];
  if (matchIdx >= 0) {
    nextList = [...existing];
    nextList[matchIdx] = saved;
  } else {
    nextList = [saved, ...existing];
  }

  if (store) {
    try {
      store.setItem(ECU_SAVED_PROGRAMS_STORAGE_KEY, JSON.stringify(nextList));
    } catch {
      // Ignore storage quota errors
    }
  }

  return { saved, list: nextList };
}

/**
 * Deletes a saved ECU program by ID from the library.
 */
export function deleteSavedEcuProgramFromLibrary(
  programId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): EcuProgram[] {
  const store =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  const existing = loadSavedEcuPrograms(store);
  const nextList = existing.filter((p) => p.id !== programId);
  if (store) {
    try {
      store.setItem(ECU_SAVED_PROGRAMS_STORAGE_KEY, JSON.stringify(nextList));
    } catch {
      // Ignore storage errors
    }
  }
  return nextList;
}

