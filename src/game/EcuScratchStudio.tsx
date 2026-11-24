import React, { useState, useEffect } from 'react';
import type { ModularVehicleRig } from './vehicle.ts';
import {
  type EcuProgram,
  type EcuAction,
  type EcuEventRule,
  type EcuExpression,
  type SensorProperty,
  type CompareOp,
  type HardwarePort,
  type LedMatrixIcon,
  LED_PATTERNS,
  ECU_STARTER_TEMPLATES,
  serializeEcuProgramToJson,
  parseAndValidateEcuProgramJson,
  loadSavedEcuPrograms,
  saveEcuProgramToLibrary,
  deleteSavedEcuProgramFromLibrary,
} from './logicSystem.ts';

interface EcuScratchStudioProps {
  isOpen: boolean;
  onClose: () => void;
  rig: ModularVehicleRig | null;
  program?: EcuProgram;
  onSaveProgram: (program: EcuProgram) => void;
}

const LED_ICONS: LedMatrixIcon[] = [
  'HEART',
  'TARGET',
  'ARROW_UP',
  'ARROW_DOWN',
  'WARNING',
  'SKULL',
  'BAR_GRAPH',
  'OFF',
];

const SENSOR_PROPERTIES: Array<{ value: SensorProperty; label: string; defaultPort: string }> = [
  { value: 'distance', label: 'Distance (m)', defaultPort: 'DIST_1' },
  { value: 'pitch', label: 'IMU Pitch (°)', defaultPort: 'IMU_1' },
  { value: 'roll', label: 'IMU Roll (°)', defaultPort: 'IMU_1' },
  { value: 'speed', label: 'Speed (km/h)', defaultPort: 'SPEED_1' },
  { value: 'altitude', label: 'Altitude (m)', defaultPort: 'SPEED_1' },
  { value: 'target_distance', label: 'Radar Target Dist (m)', defaultPort: 'RADAR_1' },
  { value: 'target_angle', label: 'Radar Target Angle (°)', defaultPort: 'RADAR_1' },
];

const COMPARE_OPS: CompareOp[] = ['<', '<=', '==', '!=', '>=', '>'];

function cloneProgram(prog: EcuProgram): EcuProgram {
  return JSON.parse(JSON.stringify(prog));
}

function copyTextToClipboardWithFallback(text: string): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

export const EcuScratchStudio: React.FC<EcuScratchStudioProps> = ({
  isOpen,
  onClose,
  rig,
  program,
  onSaveProgram,
}) => {
  const [currentProg, setCurrentProg] = useState<EcuProgram>(() => {
    return program
      ? cloneProgram(program)
      : cloneProgram(ECU_STARTER_TEMPLATES.AUTO_BRAKE.program);
  });

  const [programNameInput, setProgramNameInput] = useState<string>(
    currentProg.name || 'Forward Collision Avoidance',
  );
  const [savedPrograms, setSavedPrograms] = useState<EcuProgram[]>(() =>
    loadSavedEcuPrograms(),
  );
  const [showLibraryDrawer, setShowLibraryDrawer] = useState<boolean>(false);
  const [jsonShareText, setJsonShareText] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);

  const [hardwarePorts, setHardwarePorts] = useState<HardwarePort[]>([]);
  const [selectedRuleIdx, setSelectedRuleIdx] = useState<number>(0);
  const [activeCategory, setActiveCategory] = useState<
    'EVENTS' | 'SENSORS' | 'LOGIC' | 'ACTUATORS'
  >('SENSORS');
  const [liveIcon, setLiveIcon] = useState<LedMatrixIcon>('OFF');
  const [missingPorts, setMissingPorts] = useState<string[]>([]);

  // Refresh hardware ports & live sensor data from rig
  useEffect(() => {
    if (!isOpen) return;
    setSavedPrograms(loadSavedEcuPrograms());
    if (!rig) return;

    const refreshNow = () => {
      const ports = rig.getHardwarePorts();
      setHardwarePorts([...ports]);
      if (rig.lastEcuOutput) {
        setLiveIcon(rig.lastEcuOutput.ledMatrixIcon || 'OFF');
        setMissingPorts([...(rig.lastEcuOutput.missingPorts || [])]);
      }
    };
    refreshNow();
    const interval = setInterval(refreshNow, 100);
    return () => clearInterval(interval);
  }, [isOpen, rig]);

  // Sync internal program when prop changes
  useEffect(() => {
    if (!isOpen) return;
    let initial: EcuProgram;
    if (program) {
      initial = cloneProgram(program);
    } else if (rig && rig.activeEcuId && rig.ecuPrograms[rig.activeEcuId]) {
      initial = cloneProgram(rig.ecuPrograms[rig.activeEcuId]);
    } else if (rig && Object.values(rig.ecuPrograms)[0]) {
      initial = cloneProgram(Object.values(rig.ecuPrograms)[0]);
    } else {
      initial = cloneProgram(ECU_STARTER_TEMPLATES.AUTO_BRAKE.program);
    }
    setCurrentProg(initial);
    setProgramNameInput(initial.name || 'Custom ECU Program');
    setJsonShareText(serializeEcuProgramToJson(initial));
    setSelectedRuleIdx(0);
  }, [program, rig, isOpen]);

  if (!isOpen) return null;

  const commitProgramChange = (nextProg: EcuProgram) => {
    setCurrentProg(nextProg);
    setJsonShareText(serializeEcuProgramToJson(nextProg));
    onSaveProgram(nextProg);
  };

  const currentRule =
    currentProg.rules[selectedRuleIdx] || currentProg.rules[0];

  const handleUpdateCurrentRule = (
    updater: (prev: EcuEventRule) => EcuEventRule,
  ) => {
    const updatedRules = [...currentProg.rules];
    const targetIdx = updatedRules[selectedRuleIdx] ? selectedRuleIdx : 0;
    if (updatedRules[targetIdx]) {
      updatedRules[targetIdx] = updater(updatedRules[targetIdx]);
    }
    commitProgramChange({ ...currentProg, rules: updatedRules });
  };

  const handleLoadTemplate = (key: keyof typeof ECU_STARTER_TEMPLATES) => {
    const tpl = cloneProgram(ECU_STARTER_TEMPLATES[key].program);
    setProgramNameInput(tpl.name);
    setSelectedRuleIdx(0);
    commitProgramChange(tpl);
    setStatusBanner({
      text: `LOADED TEMPLATE: "${tpl.name.toUpperCase()}"`,
      isError: false,
    });
  };

  const handleSaveToLibrary = () => {
    const cleanName =
      programNameInput.trim() || currentProg.name || 'Custom ECU Program';
    const progToSave: EcuProgram = {
      ...currentProg,
      name: cleanName,
    };
    const { saved, list } = saveEcuProgramToLibrary(progToSave, cleanName);
    setSavedPrograms(list);
    setProgramNameInput(saved.name);
    commitProgramChange(saved);
    setStatusBanner({
      text: `SAVED "${saved.name.toUpperCase()}" TO ECU LIBRARY (${list.length} SAVED)`,
      isError: false,
    });
  };

  const handleCopyCurrentJson = () => {
    const cleanName =
      programNameInput.trim() || currentProg.name || 'Custom ECU Program';
    const progToCopy: EcuProgram = {
      ...currentProg,
      name: cleanName,
    };
    const json = serializeEcuProgramToJson(progToCopy);
    setJsonShareText(json);
    copyTextToClipboardWithFallback(json);
    setStatusBanner({
      text: `COPIED "${cleanName.toUpperCase()}" ECU .JSON TO CLIPBOARD!`,
      isError: false,
    });
  };

  const handleCopySavedProgramJson = (savedProg: EcuProgram) => {
    const json = serializeEcuProgramToJson(savedProg);
    setJsonShareText(json);
    copyTextToClipboardWithFallback(json);
    setStatusBanner({
      text: `COPIED "${savedProg.name.toUpperCase()}" .JSON TO CLIPBOARD!`,
      isError: false,
    });
  };

  const handleLoadSavedProgram = (savedProg: EcuProgram) => {
    const cloned = cloneProgram(savedProg);
    setProgramNameInput(cloned.name);
    setSelectedRuleIdx(0);
    commitProgramChange(cloned);
    setStatusBanner({
      text: `LOADED "${cloned.name.toUpperCase()}" INTO ACTIVE ECU!`,
      isError: false,
    });
  };

  const handleDeleteSavedProgram = (id: string, name: string) => {
    const nextList = deleteSavedEcuProgramFromLibrary(id);
    setSavedPrograms(nextList);
    setStatusBanner({
      text: `DELETED "${name.toUpperCase()}" FROM ECU LIBRARY.`,
      isError: false,
    });
  };

  const handleImportFromJson = (alsoSaveToLibrary: boolean) => {
    const res = parseAndValidateEcuProgramJson(jsonShareText);
    if (!res.ok) {
      setStatusBanner({ text: res.error, isError: true });
      return;
    }
    const imported = res.program;
    setProgramNameInput(imported.name);
    setSelectedRuleIdx(0);
    if (alsoSaveToLibrary) {
      const { saved, list } = saveEcuProgramToLibrary(imported, imported.name);
      setSavedPrograms(list);
      commitProgramChange(saved);
      setStatusBanner({
        text: `IMPORTED & SAVED "${saved.name.toUpperCase()}" TO ECU LIBRARY!`,
        isError: false,
      });
    } else {
      commitProgramChange(imported);
      setStatusBanner({
        text: `IMPORTED "${imported.name.toUpperCase()}" FROM .JSON!`,
        isError: false,
      });
    }
  };

  const handleAddRule = (event: 'TICK' | 'KEY_DOWN', keyBinding?: string) => {
    const newRule: EcuEventRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      name:
        event === 'TICK'
          ? 'When Vehicle Tick (60Hz)'
          : `When Key [${keyBinding || 'Space'}] Pressed`,
      event,
      keyBinding,
      enabled: true,
      actions: [],
    };
    const nextProg = {
      ...currentProg,
      rules: [...currentProg.rules, newRule],
    };
    setSelectedRuleIdx(nextProg.rules.length - 1);
    commitProgramChange(nextProg);
  };

  const handleDuplicateRule = (idx: number) => {
    const src = currentProg.rules[idx];
    if (!src) return;
    const copy: EcuEventRule = {
      ...JSON.parse(JSON.stringify(src)),
      id: `rule_${Date.now()}_dup`,
      name: `${src.name} (Copy)`,
    };
    const nextRules = [...currentProg.rules];
    nextRules.splice(idx + 1, 0, copy);
    setSelectedRuleIdx(idx + 1);
    commitProgramChange({ ...currentProg, rules: nextRules });
  };

  const handleDeleteRule = (idx: number) => {
    if (currentProg.rules.length <= 1) return;
    const nextRules = currentProg.rules.filter((_, i) => i !== idx);
    setSelectedRuleIdx(Math.max(0, idx - 1));
    commitProgramChange({ ...currentProg, rules: nextRules });
  };

  const handleAddAction = (action: EcuAction) => {
    handleUpdateCurrentRule((prev) => ({
      ...prev,
      actions: [...prev.actions, JSON.parse(JSON.stringify(action))],
    }));
  };

  const handleMoveAction = (actIdx: number, dir: -1 | 1) => {
    handleUpdateCurrentRule((prev) => {
      const targetIdx = actIdx + dir;
      if (targetIdx < 0 || targetIdx >= prev.actions.length) return prev;
      const next = [...prev.actions];
      const [item] = next.splice(actIdx, 1);
      next.splice(targetIdx, 0, item);
      return { ...prev, actions: next };
    });
  };

  const handleDeleteAction = (actIdx: number) => {
    handleUpdateCurrentRule((prev) => ({
      ...prev,
      actions: prev.actions.filter((_, i) => i !== actIdx),
    }));
  };

  const handlePortHover = (portId: string | null) => {
    if (rig) {
      rig.setHoveredPort(portId);
    }
  };

  // Filter hardware ports for inputs and outputs
  const sensorPorts = hardwarePorts.filter((p) =>
    ['DIST', 'IMU', 'SPEED', 'RADAR'].includes(p.type),
  );
  const thrusterPorts = hardwarePorts.filter((p) => p.type === 'THRUSTER');
  const hingePorts = hardwarePorts.filter((p) => p.type === 'HINGE');
  const pistonPorts = hardwarePorts.filter((p) => p.type === 'PISTON');
  const weaponPorts = hardwarePorts.filter((p) => p.type === 'WEAPON');

  const availableSensorPortIds = Array.from(
    new Set([
      ...sensorPorts.map((p) => p.id),
      'DIST_1',
      'IMU_1',
      'SPEED_1',
      'RADAR_1',
    ]),
  );
  const availableThrusterPortIds = Array.from(
    new Set([
      'ALL_THRUSTERS',
      ...thrusterPorts.map((p) => p.id),
      'THRUSTER_1',
      'THRUSTER_FRONT',
      'THRUSTER_REAR',
    ]),
  );
  const availableHingePortIds = Array.from(
    new Set([...hingePorts.map((p) => p.id), 'HINGE_1', 'HINGE_2']),
  );
  const availablePistonPortIds = Array.from(
    new Set([...pistonPorts.map((p) => p.id), 'PISTON_1', 'PISTON_2']),
  );
  const availableWeaponPortIds = Array.from(
    new Set(['ALL_WEAPONS', ...weaponPorts.map((p) => p.id), 'WEAPON_1']),
  );

  const hasMissingHardware = missingPorts.length > 0;

  // Helper to add a quick sub-action inside an IF_THEN branch (thenActions or elseActions)
  const handleAddNestedBranchAction = (
    actIdx: number,
    branch: 'thenActions' | 'elseActions',
    subAction: EcuAction,
  ) => {
    handleUpdateCurrentRule((prev) => {
      const nextActions = [...prev.actions];
      const target = nextActions[actIdx];
      if (!target || target.kind !== 'IF_THEN') return prev;
      const existingList = target[branch] ? [...target[branch]!] : [];
      existingList.push(JSON.parse(JSON.stringify(subAction)));
      nextActions[actIdx] = {
        ...target,
        [branch]: existingList,
      };
      return { ...prev, actions: nextActions };
    });
  };

  const handleUpdateNestedBranchAction = (
    actIdx: number,
    branch: 'thenActions' | 'elseActions',
    subIdx: number,
    updater: (sub: EcuAction) => EcuAction,
  ) => {
    handleUpdateCurrentRule((prev) => {
      const nextActions = [...prev.actions];
      const target = nextActions[actIdx];
      if (!target || target.kind !== 'IF_THEN') return prev;
      const list = target[branch] ? [...target[branch]!] : [];
      if (!list[subIdx]) return prev;
      list[subIdx] = updater(list[subIdx]);
      nextActions[actIdx] = {
        ...target,
        [branch]: list,
      };
      return { ...prev, actions: nextActions };
    });
  };

  const handleRemoveNestedBranchAction = (
    actIdx: number,
    branch: 'thenActions' | 'elseActions',
    subIdx: number,
  ) => {
    handleUpdateCurrentRule((prev) => {
      const nextActions = [...prev.actions];
      const target = nextActions[actIdx];
      if (!target || target.kind !== 'IF_THEN') return prev;
      const list = (target[branch] || []).filter((_, i) => i !== subIdx);
      nextActions[actIdx] = {
        ...target,
        [branch]: list,
      };
      return { ...prev, actions: nextActions };
    });
  };

  return (
    <div
      data-testid="ecu-scratch-studio-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 select-none p-1 lg:p-5 touch-manipulation"
    >
      <div className="bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] flex flex-col w-[min(97vw,1152px)] h-[calc(100dvh-12px)] lg:h-[92vh] overflow-hidden text-[#e5e5e5]">
        {/* --- HEADER (Compact on Mobile/Landscape, Full on Laptop) --- */}
        <div className="bg-[#222222] px-2.5 lg:px-4 py-1.5 lg:py-2.5 border-b-2 border-[#444444] flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center space-x-2 lg:space-x-3 min-w-0">
            <div className="w-6 h-6 lg:w-8 lg:h-8 rounded-[2px] bg-[#fbbf24] border-2 border-[#444444] flex items-center justify-center font-mono-num font-black text-[#1a1a1a] text-[10px] lg:text-sm shrink-0">
              ECU
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h2 className="text-xs lg:text-base font-black tracking-wider text-[#e5e5e5] uppercase font-display truncate">
                  MICRO:BIT ECU LOGIC STUDIO
                </h2>
                <span className="hidden lg:inline-block text-[10px] font-mono-num px-2 py-0.5 rounded-[2px] bg-[#1a1a1a] text-[#fbbf24] border border-[#444444] uppercase">
                  60HZ HARDWARE BUS
                </span>
              </div>
              <p className="text-[9.5px] lg:text-[11px] text-[#a3a3a3] font-mono-num truncate">
                {currentProg.name} · {currentProg.rules.length} Rules ·{' '}
                {hardwarePorts.length} Active Ports
              </p>
            </div>
          </div>

          {/* Center Hardware Signal Health Badge (Laptop only) */}
          <div className="hidden lg:flex items-center space-x-2">
            {hasMissingHardware ? (
              <div className="flex items-center space-x-1.5 px-3 py-1 bg-[#dc2626] border-2 border-[#444444] rounded-[2px] text-[#e5e5e5] text-xs font-mono-num font-bold uppercase">
                <span>[NO HARDWARE SIGNAL]</span>
                <span className="text-[10px]">({missingPorts.join(', ')})</span>
              </div>
            ) : (
              <div className="flex items-center space-x-1 px-3 py-1 bg-[#1a1a1a] border-2 border-[#fbbf24] rounded-[2px] text-[#fbbf24] text-xs font-mono-num font-semibold uppercase">
                <span>ALL HARDWARE SIGNALS CONNECTED</span>
              </div>
            )}
          </div>

          {/* Right Live 5x5 LED Matrix Preview & Close */}
          <div className="flex items-center space-x-2 lg:space-x-3 shrink-0">
            <div className="hidden lg:flex flex-col items-center">
              <span className="text-[9px] font-mono-num text-[#a3a3a3] mb-0.5 uppercase tracking-wider">
                LIVE 5×5 LED
              </span>
              <div className="grid grid-cols-5 gap-0.5 p-1 bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px]">
                {(LED_PATTERNS[liveIcon] || LED_PATTERNS.OFF).map((val, idx) => (
                  <div
                    key={idx}
                    className={`w-1.5 h-1.5 rounded-[1px] ${
                      val === 1
                        ? liveIcon === 'ERROR_X'
                          ? 'bg-[#dc2626]'
                          : 'bg-[#fbbf24]'
                        : 'bg-[#333333]'
                    }`}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              data-testid="close-ecu-studio-btn"
              onClick={onClose}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              className="min-h-[32px] lg:min-h-[36px] px-2.5 lg:px-3 py-1 lg:py-1.5 bg-[#dc2626] hover:bg-red-700 active:bg-red-500 text-[#e5e5e5] rounded-[2px] border-2 border-[#444444] text-[11px] lg:text-xs font-display font-extrabold uppercase cursor-pointer transition-colors touch-manipulation shrink-0"
            >
              ✕ CLOSE
            </button>
          </div>
        </div>

        {/* --- SAVE ECU PROGRAM & JSON SHARE BAR (GARAGE-STYLE PERSISTENCE) --- */}
        <div className="bg-[#181818] px-2.5 lg:px-4 py-1.5 lg:py-2 border-b-2 border-[#444444] flex flex-wrap items-center justify-between gap-1.5 lg:gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
            <span className="text-[10px] font-mono-num font-bold uppercase text-[#fbbf24] whitespace-nowrap">
              ECU PROGRAM NAME:
            </span>
            <input
              type="text"
              data-testid="ecu-program-name-input"
              value={programNameInput}
              onChange={(e) => {
                const val = e.target.value;
                setProgramNameInput(val);
                commitProgramChange({ ...currentProg, name: val });
              }}
              placeholder="Enter ECU program name..."
              className="flex-1 min-w-[180px] max-w-xs bg-[#111111] border-2 border-[#444444] focus:border-[#facc15] rounded-[2px] px-2.5 py-1 text-xs text-[#e5e5e5] font-mono-num focus:outline-none"
            />
            <button
              type="button"
              data-testid="ecu-save-library-btn"
              onClick={handleSaveToLibrary}
              className="px-3 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-xs font-display font-extrabold uppercase cursor-pointer whitespace-nowrap"
              title="Save this ECU program to your persistent library (just like Garage vehicle blueprints)"
            >
              SAVE ECU PROGRAM
            </button>
            <button
              type="button"
              data-testid="ecu-copy-json-btn"
              onClick={handleCopyCurrentJson}
              className="px-3 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-xs font-display font-extrabold uppercase cursor-pointer whitespace-nowrap"
              title="Copy this ECU program's .json code to clipboard to share with friends"
            >
              COPY .JSON
            </button>
            <button
              type="button"
              data-testid="ecu-toggle-library-btn"
              onClick={() => {
                if (!showLibraryDrawer) {
                  setJsonShareText(serializeEcuProgramToJson(currentProg));
                }
                setShowLibraryDrawer((v) => !v);
              }}
              className={`px-3 py-1 border-2 border-[#444444] rounded-[2px] text-xs font-display font-extrabold uppercase cursor-pointer whitespace-nowrap ${
                showLibraryDrawer
                  ? 'bg-[#facc15] text-[#1a1a1a]'
                  : 'bg-[#262626] hover:bg-[#333333] text-[#fbbf24]'
              }`}
            >
              SAVED &amp; SHARE .JSON ({savedPrograms.length}){' '}
              {showLibraryDrawer ? '▴' : '▾'}
            </button>
          </div>

          {statusBanner && (
            <div
              data-testid="ecu-status-banner"
              className={`px-2.5 py-1 rounded-[2px] border-2 text-[11px] font-mono-num font-bold uppercase ${
                statusBanner.isError
                  ? 'bg-[#dc2626] text-[#e5e5e5] border-[#444444]'
                  : 'bg-[#141414] text-[#facc15] border-[#fbbf24]'
              }`}
            >
              {statusBanner.text}
            </div>
          )}
        </div>

        {/* --- COLLAPSIBLE SAVED ECU LIBRARY & JSON IMPORT/EXPORT DRAWER --- */}
        {showLibraryDrawer && (
          <div
            data-testid="ecu-library-drawer"
            className="bg-[#141414] border-b-2 border-[#fbbf24] p-3.5 shrink-0 max-h-[42vh] overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-4"
          >
            {/* Left Column: Saved Custom ECU Programs */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-display font-extrabold uppercase text-[#fbbf24]">
                  SAVED ECU PROGRAMS ({savedPrograms.length})
                </span>
                <span className="text-[10px] font-mono-num text-[#a3a3a3]">
                  Stored in browser library · Load onto any vehicle
                </span>
              </div>

              {savedPrograms.length === 0 ? (
                <div className="p-4 bg-[#1f1f1f] border-2 border-[#444444] rounded-[2px] text-xs font-mono-num text-[#a3a3a3] text-center">
                  No custom ECU programs saved yet. Name your script above and click{' '}
                  <strong className="text-[#fbbf24]">SAVE ECU PROGRAM</strong>!
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {savedPrograms.map((sp) => (
                    <div
                      key={sp.id}
                      data-testid={`ecu-saved-item-${sp.id}`}
                      className="p-2.5 bg-[#222222] border-2 border-[#444444] hover:border-[#facc15] rounded-[2px] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-display font-bold uppercase text-[#e5e5e5] truncate">
                          {sp.name}
                        </div>
                        <div className="text-[10px] font-mono-num text-[#a3a3a3]">
                          {sp.rules.length} Rule{sp.rules.length === 1 ? '' : 's'} ·{' '}
                          {sp.rules.reduce((sum, r) => sum + r.actions.length, 0)} Blocks
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          data-testid={`ecu-load-saved-${sp.id}`}
                          onClick={() => handleLoadSavedProgram(sp)}
                          className="px-2.5 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-extrabold uppercase cursor-pointer"
                        >
                          LOAD
                        </button>
                        <button
                          type="button"
                          data-testid={`ecu-copy-saved-${sp.id}`}
                          onClick={() => handleCopySavedProgramJson(sp)}
                          className="px-2.5 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                        >
                          COPY .JSON
                        </button>
                        <button
                          type="button"
                          data-testid={`ecu-delete-saved-${sp.id}`}
                          onClick={() => handleDeleteSavedProgram(sp.id, sp.name)}
                          className="px-2 py-1 bg-[#dc2626] hover:bg-red-700 text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                        >
                          DEL
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Copy / Paste Shareable ECU JSON */}
            <div className="space-y-2 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-xs font-display font-extrabold uppercase text-[#fbbf24]">
                  SHARE / IMPORT ECU .JSON CODE
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setJsonShareText(serializeEcuProgramToJson(currentProg))
                  }
                  className="text-[10px] font-mono-num text-[#a3a3a3] hover:text-[#e5e5e5] underline cursor-pointer uppercase"
                >
                  Refresh from current script
                </button>
              </div>
              <textarea
                data-testid="ecu-json-textarea"
                value={jsonShareText}
                onChange={(e) => setJsonShareText(e.target.value)}
                rows={5}
                placeholder='Paste shared ECU program JSON here (e.g. {"name":"My ECU","rules":[...]})...'
                className="w-full flex-1 bg-[#111111] border-2 border-[#444444] focus:border-[#facc15] rounded-[2px] p-2 text-[11px] font-mono-num text-[#e5e5e5] focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="ecu-import-json-btn"
                  onClick={() => handleImportFromJson(false)}
                  className="px-3 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-xs font-display font-extrabold uppercase cursor-pointer"
                >
                  LOAD FROM .JSON
                </button>
                <button
                  type="button"
                  data-testid="ecu-import-and-save-btn"
                  onClick={() => handleImportFromJson(true)}
                  className="px-3 py-1.5 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-xs font-display font-bold uppercase cursor-pointer"
                >
                  IMPORT &amp; SAVE TO LIBRARY
                </button>
                <button
                  type="button"
                  onClick={() => {
                    copyTextToClipboardWithFallback(jsonShareText);
                    setStatusBanner({
                      text: 'COPIED JSON TEXT BOX TO CLIPBOARD!',
                      isError: false,
                    });
                  }}
                  className="px-3 py-1.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] text-xs font-display font-bold uppercase cursor-pointer"
                >
                  COPY BOX
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- QUICK TEMPLATES & PRESETS BAR --- */}
        <div className="bg-[#1a1a1a] px-4 py-2 border-b-2 border-[#444444] flex items-center justify-between shrink-0 overflow-x-auto text-xs gap-3">
          <div className="flex items-center space-x-1.5 shrink-0">
            <span className="text-[#a3a3a3] text-[10px] font-mono-num uppercase font-bold mr-1">
              PRESETS:
            </span>
            <button
              type="button"
              onClick={() => handleLoadTemplate('AUTO_BRAKE')}
              className="px-2 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] rounded-[2px] border-2 border-[#444444] text-[11px] font-display font-bold uppercase cursor-pointer"
            >
              OBSTACLE AUTO-BRAKE
            </button>
            <button
              type="button"
              onClick={() => handleLoadTemplate('AUTO_HOVER')}
              className="px-2 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] rounded-[2px] border-2 border-[#444444] text-[11px] font-display font-bold uppercase cursor-pointer"
            >
              AUTO-HOVER GYRO
            </button>
            <button
              type="button"
              onClick={() => handleLoadTemplate('AUTO_TURRET')}
              className="px-2 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] rounded-[2px] border-2 border-[#444444] text-[11px] font-display font-bold uppercase cursor-pointer"
            >
              RADAR AUTO-TURRET
            </button>
            <button
              type="button"
              onClick={() => handleLoadTemplate('CRUISE_CONTROL')}
              className="px-2 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] rounded-[2px] border-2 border-[#444444] text-[11px] font-display font-bold uppercase cursor-pointer"
            >
              CRUISE 60 KM/H
            </button>
            <button
              type="button"
              onClick={() => handleLoadTemplate('ROLL_STABILIZER')}
              className="px-2 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] rounded-[2px] border-2 border-[#444444] text-[11px] font-display font-bold uppercase cursor-pointer"
            >
              ANTI-ROLL STEER
            </button>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleAddRule('TICK')}
              className="px-2.5 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] rounded-[2px] border-2 border-[#444444] text-[11px] font-bold font-display uppercase cursor-pointer"
            >
              + 60HZ TICK RULE
            </button>
            <button
              type="button"
              onClick={() => handleAddRule('KEY_DOWN', 'Space')}
              className="px-2.5 py-1 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] rounded-[2px] border-2 border-[#444444] text-[11px] font-bold font-display uppercase cursor-pointer"
            >
              + KEY PRESS RULE
            </button>
          </div>
        </div>

        {/* --- MAIN BODY: PALETTE (LEFT) + WORKSPACE (RIGHT) --- */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          {/* LEFT: HARDWARE-AWARE BLOCK PALETTE */}
          <div className="w-full md:w-72 lg:w-80 max-h-[34dvh] md:max-h-none bg-[#222222] border-b-2 md:border-b-0 md:border-r-2 border-[#444444] flex flex-col shrink-0">
            {/* Category tabs */}
            <div className="grid grid-cols-4 border-b-2 border-[#444444] text-center font-display text-[10px] font-bold uppercase">
              {(['EVENTS', 'SENSORS', 'LOGIC', 'ACTUATORS'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`py-2 cursor-pointer border-b-2 transition-colors ${
                    activeCategory === cat
                      ? 'border-[#facc15] text-[#1a1a1a] bg-[#facc15]'
                      : 'border-transparent text-[#e5e5e5] bg-[#6b7280] hover:bg-[#52525b]'
                  }`}
                >
                  {cat === 'ACTUATORS' ? 'ACTUATE' : cat}
                </button>
              ))}
            </div>

            {/* Blocks list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {activeCategory === 'EVENTS' && (
                <div className="space-y-2">
                  <span className="text-[10px] font-mono-num text-[#fbbf24] font-bold uppercase tracking-wider block">
                    EVENT HAT TRIGGERS
                  </span>
                  <div
                    onClick={() => handleAddRule('TICK')}
                    className="p-2.5 rounded-[2px] bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                  >
                    WHEN VEHICLE TICK (60HZ)
                  </div>
                  {(['Space', 'KeyF', 'KeyE', 'KeyX', 'KeyQ', 'ShiftLeft'] as const).map(
                    (key) => (
                      <div
                        key={key}
                        onClick={() => handleAddRule('KEY_DOWN', key)}
                        className="p-2 rounded-[2px] bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                      >
                        WHEN KEY [{key.toUpperCase()}] PRESSED
                      </div>
                    ),
                  )}
                </div>
              )}

              {activeCategory === 'SENSORS' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono-num text-[#fbbf24] font-bold uppercase tracking-wider">
                      PHYSICAL SENSOR INPUTS
                    </span>
                    <span className="text-[9px] font-mono-num text-[#a3a3a3]">
                      {sensorPorts.length} mounted
                    </span>
                  </div>

                  {sensorPorts.length === 0 ? (
                    <div className="p-3 bg-[#1a1a1a] border-2 border-[#dc2626] rounded-[2px] text-[#e5e5e5] text-xs font-mono-num space-y-2">
                      <strong className="text-[#dc2626] uppercase block">
                        NO PHYSICAL SENSORS INSTALLED
                      </strong>
                      <p className="text-[10px] text-[#a3a3a3]">
                        Mount Distance, IMU Gyro, Speedo, or Radar blocks in the Builder for live telemetry, or insert a sensor rule template below:
                      </p>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {SENSOR_PROPERTIES.map((sp) => (
                          <button
                            key={sp.value}
                            type="button"
                            onClick={() =>
                              handleAddAction({
                                kind: 'IF_THEN',
                                condition: {
                                  kind: 'COMPARE',
                                  op: '<',
                                  left: {
                                    kind: 'READ_SENSOR',
                                    portId: sp.defaultPort,
                                    property: sp.value,
                                  },
                                  right: { kind: 'NUMBER_CONST', value: 15 },
                                },
                                thenActions: [
                                  {
                                    kind: 'SET_THRUST',
                                    portId: 'ALL_THRUSTERS',
                                    thrustPercent: { kind: 'NUMBER_CONST', value: 100 },
                                  },
                                ],
                                elseActions: [],
                              })
                            }
                            className="px-2 py-1 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-display font-bold uppercase cursor-pointer"
                          >
                            + IF {sp.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    sensorPorts.map((port) => (
                      <div
                        key={port.id}
                        onMouseEnter={() => handlePortHover(port.id)}
                        onMouseLeave={() => handlePortHover(null)}
                        className={`p-2.5 rounded-[2px] border-2 text-xs font-mono-num transition-all ${
                          port.hasSignal
                            ? 'bg-[#1a1a1a] border-[#444444] text-[#e5e5e5] hover:border-[#fbbf24]'
                            : 'bg-[#1a1a1a] border-[#dc2626] text-[#e5e5e5]'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span>{port.tag}</span>
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded-[2px] border font-mono-num ${
                              port.hasSignal
                                ? 'bg-[#222222] text-[#fbbf24] border-[#444444]'
                                : 'bg-[#dc2626] text-[#e5e5e5] border-[#444444]'
                            }`}
                          >
                            {port.hasSignal
                              ? `LIVE: ${port.liveValue ?? 0}`
                              : '[NO SIGNAL]'}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {port.type === 'DIST' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleAddAction({
                                  kind: 'IF_THEN',
                                  condition: {
                                    kind: 'COMPARE',
                                    op: '<',
                                    left: {
                                      kind: 'READ_SENSOR',
                                      portId: port.id,
                                      property: 'distance',
                                    },
                                    right: { kind: 'NUMBER_CONST', value: 8 },
                                  },
                                  thenActions: [
                                    {
                                      kind: 'SET_THRUST',
                                      portId: 'ALL_THRUSTERS',
                                      thrustPercent: { kind: 'NUMBER_CONST', value: 0 },
                                    },
                                    { kind: 'SET_LED_MATRIX', icon: 'WARNING' },
                                  ],
                                  elseActions: [
                                    { kind: 'SET_LED_MATRIX', icon: 'ARROW_UP' },
                                  ],
                                })
                              }
                              className="px-1.5 py-0.5 rounded-[2px] bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer"
                            >
                              + IF DIST &lt; 8M AUTO-BRAKE
                            </button>
                          )}
                          {port.type === 'IMU' && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAddAction({
                                    kind: 'IF_THEN',
                                    condition: {
                                      kind: 'COMPARE',
                                      op: '>',
                                      left: {
                                        kind: 'READ_SENSOR',
                                        portId: port.id,
                                        property: 'pitch',
                                      },
                                      right: { kind: 'NUMBER_CONST', value: 3 },
                                    },
                                    thenActions: [
                                      {
                                        kind: 'SET_THRUST',
                                        portId:
                                          thrusterPorts[0]?.id || 'ALL_THRUSTERS',
                                        thrustPercent: {
                                          kind: 'NUMBER_CONST',
                                          value: 80,
                                        },
                                      },
                                      { kind: 'SET_LED_MATRIX', icon: 'ARROW_UP' },
                                    ],
                                    elseActions: [],
                                  })
                                }
                                className="px-1.5 py-0.5 rounded-[2px] bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer"
                              >
                                + IF PITCH &gt; 3° STABILIZE
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAddAction({
                                    kind: 'IF_THEN',
                                    condition: {
                                      kind: 'COMPARE',
                                      op: '>',
                                      left: {
                                        kind: 'READ_SENSOR',
                                        portId: port.id,
                                        property: 'roll',
                                      },
                                      right: { kind: 'NUMBER_CONST', value: 5 },
                                    },
                                    thenActions: [
                                      {
                                        kind: 'SET_HINGE',
                                        portId: hingePorts[0]?.id || 'HINGE_1',
                                        angleDeg: { kind: 'NUMBER_CONST', value: -20 },
                                      },
                                    ],
                                    elseActions: [],
                                  })
                                }
                                className="px-1.5 py-0.5 rounded-[2px] bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] border border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer"
                              >
                                + IF ROLL &gt; 5° COUNTER-STEER
                              </button>
                            </>
                          )}
                          {port.type === 'SPEED' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleAddAction({
                                  kind: 'IF_THEN',
                                  condition: {
                                    kind: 'COMPARE',
                                    op: '<',
                                    left: {
                                      kind: 'READ_SENSOR',
                                      portId: port.id,
                                      property: 'speed',
                                    },
                                    right: { kind: 'NUMBER_CONST', value: 60 },
                                  },
                                  thenActions: [
                                    {
                                      kind: 'SET_THRUST',
                                      portId: 'ALL_THRUSTERS',
                                      thrustPercent: { kind: 'NUMBER_CONST', value: 90 },
                                    },
                                  ],
                                  elseActions: [
                                    {
                                      kind: 'SET_THRUST',
                                      portId: 'ALL_THRUSTERS',
                                      thrustPercent: { kind: 'NUMBER_CONST', value: 0 },
                                    },
                                  ],
                                })
                              }
                              className="px-1.5 py-0.5 rounded-[2px] bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer"
                            >
                              + IF SPEED &lt; 60 CRUISE
                            </button>
                          )}
                          {port.type === 'RADAR' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleAddAction({
                                  kind: 'IF_THEN',
                                  condition: {
                                    kind: 'COMPARE',
                                    op: '<',
                                    left: {
                                      kind: 'READ_SENSOR',
                                      portId: port.id,
                                      property: 'target_distance',
                                    },
                                    right: { kind: 'NUMBER_CONST', value: 60 },
                                  },
                                  thenActions: [
                                    {
                                      kind: 'SET_HINGE',
                                      portId: hingePorts[0]?.id || 'HINGE_1',
                                      angleDeg: {
                                        kind: 'CLAMP',
                                        val: {
                                          kind: 'READ_SENSOR',
                                          portId: port.id,
                                          property: 'target_angle',
                                        },
                                        min: { kind: 'NUMBER_CONST', value: -45 },
                                        max: { kind: 'NUMBER_CONST', value: 45 },
                                      },
                                    },
                                    {
                                      kind: 'FIRE_WEAPON',
                                      portId: 'ALL_WEAPONS',
                                      fire: { kind: 'NUMBER_CONST', value: 1 },
                                    },
                                    { kind: 'SET_LED_MATRIX', icon: 'TARGET' },
                                  ],
                                  elseActions: [],
                                })
                              }
                              className="px-1.5 py-0.5 rounded-[2px] bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border border-[#444444] text-[10px] font-display font-bold uppercase cursor-pointer"
                            >
                              + IF RADAR LOCK TRACK &amp; FIRE
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeCategory === 'LOGIC' && (
                <div className="space-y-2">
                  <span className="text-[10px] font-mono-num text-[#fbbf24] font-bold uppercase tracking-wider block">
                    BRANCHING &amp; LED MATRIX
                  </span>
                  <div
                    onClick={() =>
                      handleAddAction({
                        kind: 'IF_THEN',
                        condition: {
                          kind: 'COMPARE',
                          op: '<',
                          left: {
                            kind: 'READ_SENSOR',
                            portId: sensorPorts[0]?.id || 'DIST_1',
                            property: 'distance',
                          },
                          right: { kind: 'NUMBER_CONST', value: 10 },
                        },
                        thenActions: [
                          {
                            kind: 'SET_THRUST',
                            portId: 'ALL_THRUSTERS',
                            thrustPercent: { kind: 'NUMBER_CONST', value: 0 },
                          },
                        ],
                        elseActions: [
                          {
                            kind: 'SET_THRUST',
                            portId: 'ALL_THRUSTERS',
                            thrustPercent: { kind: 'NUMBER_CONST', value: 80 },
                          },
                        ],
                      })
                    }
                    className="p-2.5 rounded-[2px] bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                  >
                    + IF [SENSOR COMPARE] THEN / ELSE
                  </div>
                  <div
                    onClick={() =>
                      handleAddAction({
                        kind: 'SET_LED_MATRIX',
                        icon: 'TARGET',
                      })
                    }
                    className="p-2.5 rounded-[2px] bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                  >
                    + SET 5×5 MICRO:BIT LED ICON
                  </div>
                </div>
              )}

              {activeCategory === 'ACTUATORS' && (
                <div className="space-y-2">
                  <span className="text-[10px] font-mono-num text-[#fbbf24] font-bold uppercase tracking-wider block">
                    ACTUATOR OUTPUT COMMANDS
                  </span>

                  <div
                    onMouseEnter={() => handlePortHover('ALL_THRUSTERS')}
                    onMouseLeave={() => handlePortHover(null)}
                    onClick={() =>
                      handleAddAction({
                        kind: 'SET_THRUST',
                        portId: 'ALL_THRUSTERS',
                        thrustPercent: { kind: 'NUMBER_CONST', value: 100 },
                      })
                    }
                    className="p-2 rounded-[2px] bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                  >
                    + SET [ALL THRUSTERS] THRUST 100%
                  </div>

                  <div
                    onClick={() =>
                      handleAddAction({
                        kind: 'SET_HINGE',
                        portId: hingePorts[0]?.id || 'HINGE_1',
                        angleDeg: { kind: 'NUMBER_CONST', value: 25 },
                      })
                    }
                    className="p-2 rounded-[2px] bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                  >
                    + SET [HINGE] ANGLE +25°
                  </div>

                  <div
                    onClick={() =>
                      handleAddAction({
                        kind: 'SET_PISTON',
                        portId: pistonPorts[0]?.id || 'PISTON_1',
                        extensionPercent: { kind: 'NUMBER_CONST', value: 100 },
                      })
                    }
                    className="p-2 rounded-[2px] bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                  >
                    + SET [PISTON] EXTEND 100%
                  </div>

                  <div
                    onMouseEnter={() => handlePortHover('ALL_WEAPONS')}
                    onMouseLeave={() => handlePortHover(null)}
                    onClick={() =>
                      handleAddAction({
                        kind: 'FIRE_WEAPON',
                        portId: 'ALL_WEAPONS',
                        fire: { kind: 'NUMBER_CONST', value: 1 },
                      })
                    }
                    className="p-2 rounded-[2px] bg-[#dc2626] hover:bg-red-700 text-[#e5e5e5] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                  >
                    + FIRE [ALL WEAPONS] SALVO
                  </div>

                  <div
                    onMouseEnter={() => handlePortHover('ALL_HEADLIGHTS')}
                    onMouseLeave={() => handlePortHover(null)}
                    onClick={() =>
                      handleAddAction({
                        kind: 'SET_HEADLIGHT',
                        portId: 'ALL_HEADLIGHTS',
                        on: { kind: 'NUMBER_CONST', value: 1 },
                      })
                    }
                    className="p-2 rounded-[2px] bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] font-display font-bold text-xs uppercase cursor-pointer border-2 border-[#444444]"
                  >
                    + SET [HEADLIGHTS] ON/OFF
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: SCRATCH BLOCK CANVAS & RULES STACK */}
          <div className="flex-1 flex flex-col bg-[#1a1a1a] overflow-hidden">
            {/* Rules Selector Tabs */}
            <div className="bg-[#222222] px-3 py-2 border-b-2 border-[#444444] flex items-center space-x-2 overflow-x-auto shrink-0">
              {currentProg.rules.map((rule, idx) => (
                <div
                  key={rule.id}
                  onClick={() => setSelectedRuleIdx(idx)}
                  className={`px-3 py-1.5 rounded-[2px] border-2 text-xs font-mono-num cursor-pointer flex items-center space-x-2 shrink-0 ${
                    selectedRuleIdx === idx
                      ? 'bg-[#facc15] text-[#1a1a1a] border-[#fbbf24] font-black'
                      : rule.enabled === false
                        ? 'bg-[#262626] text-[#737373] border-[#444444] line-through'
                        : 'bg-[#6b7280] text-[#e5e5e5] border-[#444444] hover:bg-[#52525b]'
                  }`}
                >
                  <span>
                    {rule.event === 'TICK'
                      ? `60HZ: ${rule.name}`
                      : `KEY [${rule.keyBinding || 'Space'}]: ${rule.name}`}
                  </span>
                  {currentProg.rules.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRule(idx);
                      }}
                      className="ml-1 text-[10px] hover:text-[#dc2626] font-bold"
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Active Rule Block Canvas */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {currentRule && (
                <div className="space-y-3">
                  {/* Hat Block */}
                  <div className="bg-[#fbbf24] text-[#1a1a1a] font-black text-xs sm:text-sm font-display uppercase px-3.5 py-2.5 rounded-[2px] border-2 border-[#444444] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>[EVENT]</span>
                      <input
                        type="text"
                        value={currentRule.name}
                        onChange={(e) =>
                          handleUpdateCurrentRule((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        className="bg-[#1a1a1a] text-[#fbbf24] border-2 border-[#444444] rounded-[2px] px-2 py-0.5 text-xs font-mono-num font-bold min-w-[190px]"
                      />
                      <select
                        value={currentRule.event}
                        onChange={(e) => {
                          const ev = e.target.value as 'TICK' | 'KEY_DOWN';
                          handleUpdateCurrentRule((prev) => ({
                            ...prev,
                            event: ev,
                            keyBinding:
                              ev === 'KEY_DOWN'
                                ? prev.keyBinding || 'Space'
                                : undefined,
                          }));
                        }}
                        className="bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] px-2 py-0.5 text-xs text-[#e5e5e5] font-mono-num font-bold"
                      >
                        <option value="TICK">60HZ TICK</option>
                        <option value="KEY_DOWN">KEY HELD</option>
                      </select>

                      {currentRule.event === 'KEY_DOWN' && (
                        <select
                          value={currentRule.keyBinding || 'Space'}
                          onChange={(e) =>
                            handleUpdateCurrentRule((prev) => ({
                              ...prev,
                              keyBinding: e.target.value,
                            }))
                          }
                          className="bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] px-1.5 py-0.5 text-xs text-[#fbbf24] font-mono-num font-bold"
                        >
                          <option value="Space">Space</option>
                          <option value="KeyF">F</option>
                          <option value="KeyE">E</option>
                          <option value="KeyX">X</option>
                          <option value="KeyQ">Q</option>
                          <option value="ShiftLeft">Shift</option>
                          <option value="KeyW">W</option>
                          <option value="KeyS">S</option>
                        </select>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateCurrentRule((prev) => ({
                            ...prev,
                            enabled: prev.enabled === false ? true : false,
                          }))
                        }
                        className={`px-2 py-0.5 rounded-[2px] border border-[#444444] text-[10px] font-mono-num font-bold cursor-pointer ${
                          currentRule.enabled === false
                            ? 'bg-[#dc2626] text-[#e5e5e5]'
                            : 'bg-[#1a1a1a] text-[#facc15]'
                        }`}
                      >
                        {currentRule.enabled === false ? 'RULE MUTED' : 'RULE ACTIVE'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicateRule(selectedRuleIdx)}
                        className="px-2 py-0.5 bg-[#1a1a1a] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[10px] font-mono-num font-bold cursor-pointer hover:text-[#fbbf24]"
                      >
                        DUPLICATE
                      </button>
                    </div>
                  </div>

                  {/* Actions Nest Canvas */}
                  <div className="ml-3 pl-4 border-l-4 border-[#fbbf24] space-y-3">
                    {currentRule.actions.length === 0 ? (
                      <div className="p-4 bg-[#222222] border-2 border-dashed border-[#444444] rounded-[2px] text-[#a3a3a3] text-xs font-mono-num text-center">
                        Click any Sensor, Logic, or Actuator block on the left to add it to this rule.
                      </div>
                    ) : (
                      currentRule.actions.map((act, actIdx) => (
                        <div
                          key={actIdx}
                          className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-3 relative group hover:border-[#fbbf24] transition-colors"
                        >
                          <div className="absolute top-2 right-2 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveAction(actIdx, -1)}
                              disabled={actIdx === 0}
                              className="px-1.5 py-0.5 bg-[#1a1a1a] text-[#e5e5e5] disabled:opacity-40 border border-[#444444] text-[10px] font-mono-num rounded-[2px] cursor-pointer"
                              title="Move block up"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveAction(actIdx, 1)}
                              disabled={actIdx === currentRule.actions.length - 1}
                              className="px-1.5 py-0.5 bg-[#1a1a1a] text-[#e5e5e5] disabled:opacity-40 border border-[#444444] text-[10px] font-mono-num rounded-[2px] cursor-pointer"
                              title="Move block down"
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAction(actIdx)}
                              className="bg-[#dc2626] text-[#e5e5e5] border border-[#444444] text-[10px] font-display font-bold uppercase px-1.5 py-0.5 rounded-[2px] cursor-pointer"
                            >
                              REMOVE
                            </button>
                          </div>

                          {/* Render IF_THEN with full condition & THEN/ELSE editors */}
                          {act.kind === 'IF_THEN' && (
                            <div className="space-y-2.5 text-xs font-mono-num pr-28">
                              <div className="flex flex-wrap items-center gap-1.5 text-[#fbbf24] font-bold">
                                <span>IF</span>
                                {act.condition.kind === 'COMPARE' ? (
                                  <div className="flex flex-wrap items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded-[2px] border-2 border-[#444444]">
                                    {/* Sensor Port Selector */}
                                    <select
                                      value={
                                        (act.condition.left as any)?.portId ||
                                        'DIST_1'
                                      }
                                      onChange={(e) => {
                                        const newPort = e.target.value;
                                        handleUpdateCurrentRule((prev) => {
                                          const nextActions = [...prev.actions];
                                          const targetAct = nextActions[actIdx] as any;
                                          if (targetAct?.condition) {
                                            targetAct.condition.left = {
                                              kind: 'READ_SENSOR',
                                              portId: newPort,
                                              property:
                                                targetAct.condition.left?.property ||
                                                'distance',
                                            };
                                          }
                                          return { ...prev, actions: nextActions };
                                        });
                                      }}
                                      className="bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1.5 py-0.5 text-[11px] font-bold"
                                    >
                                      {availableSensorPortIds.map((pid) => (
                                        <option key={pid} value={pid}>
                                          [{pid}]
                                        </option>
                                      ))}
                                    </select>

                                    {/* Sensor Property Selector */}
                                    <select
                                      value={
                                        (act.condition.left as any)?.property ||
                                        'distance'
                                      }
                                      onChange={(e) => {
                                        const newProp =
                                          e.target.value as SensorProperty;
                                        handleUpdateCurrentRule((prev) => {
                                          const nextActions = [...prev.actions];
                                          const targetAct = nextActions[actIdx] as any;
                                          if (targetAct?.condition) {
                                            targetAct.condition.left = {
                                              kind: 'READ_SENSOR',
                                              portId:
                                                targetAct.condition.left?.portId ||
                                                'DIST_1',
                                              property: newProp,
                                            };
                                          }
                                          return { ...prev, actions: nextActions };
                                        });
                                      }}
                                      className="bg-[#222222] text-[#e5e5e5] border border-[#444444] rounded-[2px] px-1.5 py-0.5 text-[11px]"
                                    >
                                      {SENSOR_PROPERTIES.map((sp) => (
                                        <option key={sp.value} value={sp.value}>
                                          {sp.label}
                                        </option>
                                      ))}
                                    </select>

                                    {/* Operator Selector */}
                                    <select
                                      value={act.condition.op}
                                      onChange={(e) => {
                                        const newOp = e.target.value as CompareOp;
                                        handleUpdateCurrentRule((prev) => {
                                          const nextActions = [...prev.actions];
                                          const targetAct = nextActions[actIdx] as any;
                                          if (targetAct?.condition)
                                            targetAct.condition.op = newOp;
                                          return { ...prev, actions: nextActions };
                                        });
                                      }}
                                      className="bg-[#222222] text-[#facc15] border border-[#444444] rounded-[2px] px-1.5 py-0.5 text-[11px] font-bold"
                                    >
                                      {COMPARE_OPS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>

                                    {/* Threshold Number */}
                                    <input
                                      type="number"
                                      value={
                                        (act.condition.right as any)?.value ?? 8
                                      }
                                      onChange={(e) => {
                                        const num = Number(e.target.value);
                                        handleUpdateCurrentRule((prev) => {
                                          const nextActions = [...prev.actions];
                                          const targetAct = nextActions[actIdx] as any;
                                          if (targetAct?.condition) {
                                            targetAct.condition.right = {
                                              kind: 'NUMBER_CONST',
                                              value: num,
                                            };
                                          }
                                          return { ...prev, actions: nextActions };
                                        });
                                      }}
                                      className="w-16 bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1.5 py-0.5 text-center font-bold"
                                    />
                                  </div>
                                ) : (
                                  <span>Condition</span>
                                )}
                                <span>THEN:</span>
                              </div>

                              {/* Nested THEN actions */}
                              <div className="ml-3 pl-3 border-l-2 border-[#fbbf24] space-y-1.5">
                                {act.thenActions.map((sub, sIdx) => (
                                  <div
                                    key={sIdx}
                                    className="p-1.5 bg-[#1a1a1a] rounded-[2px] border border-[#444444] text-[#e5e5e5] text-[11px] font-mono-num flex flex-wrap items-center justify-between gap-2"
                                  >
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {sub.kind === 'SET_THRUST' && (
                                        <>
                                          <span>SET THRUST</span>
                                          <select
                                            value={sub.portId}
                                            onChange={(e) =>
                                              handleUpdateNestedBranchAction(
                                                actIdx,
                                                'thenActions',
                                                sIdx,
                                                (old) => ({
                                                  ...(old as any),
                                                  portId: e.target.value,
                                                }),
                                              )
                                            }
                                            className="bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1 py-0.5 text-[10px]"
                                          >
                                            {availableThrusterPortIds.map((id) => (
                                              <option key={id} value={id}>
                                                {id}
                                              </option>
                                            ))}
                                          </select>
                                          <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={
                                              (sub.thrustPercent as any)?.value ?? 80
                                            }
                                            onChange={(e) =>
                                              handleUpdateNestedBranchAction(
                                                actIdx,
                                                'thenActions',
                                                sIdx,
                                                (old) => ({
                                                  ...(old as any),
                                                  thrustPercent: {
                                                    kind: 'NUMBER_CONST',
                                                    value: Number(e.target.value),
                                                  },
                                                }),
                                              )
                                            }
                                            className="w-14 bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1 text-center"
                                          />
                                          <span>%</span>
                                        </>
                                      )}
                                      {sub.kind === 'SET_HINGE' && (
                                        <>
                                          <span>SET HINGE</span>
                                          <select
                                            value={sub.portId}
                                            onChange={(e) =>
                                              handleUpdateNestedBranchAction(
                                                actIdx,
                                                'thenActions',
                                                sIdx,
                                                (old) => ({
                                                  ...(old as any),
                                                  portId: e.target.value,
                                                }),
                                              )
                                            }
                                            className="bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1 py-0.5 text-[10px]"
                                          >
                                            {availableHingePortIds.map((id) => (
                                              <option key={id} value={id}>
                                                {id}
                                              </option>
                                            ))}
                                          </select>
                                          <input
                                            type="number"
                                            min={-45}
                                            max={45}
                                            value={
                                              (sub.angleDeg as any)?.value ?? 0
                                            }
                                            onChange={(e) =>
                                              handleUpdateNestedBranchAction(
                                                actIdx,
                                                'thenActions',
                                                sIdx,
                                                (old) => ({
                                                  ...(old as any),
                                                  angleDeg: {
                                                    kind: 'NUMBER_CONST',
                                                    value: Number(e.target.value),
                                                  },
                                                }),
                                              )
                                            }
                                            className="w-14 bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1 text-center"
                                          />
                                          <span>°</span>
                                        </>
                                      )}
                                      {sub.kind === 'SET_PISTON' && (
                                        <span>
                                          SET [{sub.portId}] PISTON{' '}
                                          {(sub.extensionPercent as any)?.value ?? 100}%
                                        </span>
                                      )}
                                      {sub.kind === 'FIRE_WEAPON' && (
                                        <span className="text-[#dc2626] font-bold">
                                          FIRE [{sub.portId}]
                                        </span>
                                      )}
                                      {sub.kind === 'SET_HEADLIGHT' && (
                                        <span>
                                          HEADLIGHTS:{' '}
                                          {((sub.on as any)?.value ?? 1) > 0
                                            ? 'ON'
                                            : 'OFF'}
                                        </span>
                                      )}
                                      {sub.kind === 'SET_LED_MATRIX' && (
                                        <>
                                          <span>LED ICON:</span>
                                          <select
                                            value={sub.icon}
                                            onChange={(e) =>
                                              handleUpdateNestedBranchAction(
                                                actIdx,
                                                'thenActions',
                                                sIdx,
                                                (old) => ({
                                                  ...(old as any),
                                                  icon: e.target.value as LedMatrixIcon,
                                                }),
                                              )
                                            }
                                            className="bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1 py-0.5 text-[10px]"
                                          >
                                            {LED_ICONS.map((ic) => (
                                              <option key={ic} value={ic}>
                                                {ic}
                                              </option>
                                            ))}
                                          </select>
                                        </>
                                      )}
                                      {sub.kind === 'IF_THEN' && (
                                        <span>NESTED CONDITION BLOCK</span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRemoveNestedBranchAction(
                                          actIdx,
                                          'thenActions',
                                          sIdx,
                                        )
                                      }
                                      className="text-[10px] text-[#dc2626] hover:underline font-bold px-1 cursor-pointer"
                                    >
                                      X
                                    </button>
                                  </div>
                                ))}

                                {/* Add sub-action buttons for THEN */}
                                <div className="flex flex-wrap items-center gap-1 pt-1">
                                  <span className="text-[9px] text-[#a3a3a3] uppercase">
                                    + THEN:
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAddNestedBranchAction(
                                        actIdx,
                                        'thenActions',
                                        {
                                          kind: 'SET_THRUST',
                                          portId: 'ALL_THRUSTERS',
                                          thrustPercent: {
                                            kind: 'NUMBER_CONST',
                                            value: 100,
                                          },
                                        },
                                      )
                                    }
                                    className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9px] uppercase cursor-pointer"
                                  >
                                    + THRUST
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAddNestedBranchAction(
                                        actIdx,
                                        'thenActions',
                                        {
                                          kind: 'SET_HINGE',
                                          portId: 'HINGE_1',
                                          angleDeg: {
                                            kind: 'NUMBER_CONST',
                                            value: 20,
                                          },
                                        },
                                      )
                                    }
                                    className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9px] uppercase cursor-pointer"
                                  >
                                    + HINGE
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAddNestedBranchAction(
                                        actIdx,
                                        'thenActions',
                                        {
                                          kind: 'FIRE_WEAPON',
                                          portId: 'ALL_WEAPONS',
                                          fire: { kind: 'NUMBER_CONST', value: 1 },
                                        },
                                      )
                                    }
                                    className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#dc2626] border border-[#444444] rounded-[2px] text-[9px] uppercase cursor-pointer"
                                  >
                                    + FIRE
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAddNestedBranchAction(
                                        actIdx,
                                        'thenActions',
                                        {
                                          kind: 'SET_LED_MATRIX',
                                          icon: 'WARNING',
                                        },
                                      )
                                    }
                                    className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#fbbf24] border border-[#444444] rounded-[2px] text-[9px] uppercase cursor-pointer"
                                  >
                                    + LED
                                  </button>
                                </div>
                              </div>

                              {/* Nested ELSE actions */}
                              <div className="pt-1">
                                <span className="text-[10px] font-bold text-[#a3a3a3] uppercase">
                                  ELSE (WHEN FALSE):
                                </span>
                                <div className="ml-3 mt-1 pl-3 border-l-2 border-[#6b7280] space-y-1.5">
                                  {(act.elseActions || []).map((sub, sIdx) => (
                                    <div
                                      key={sIdx}
                                      className="p-1.5 bg-[#1a1a1a] rounded-[2px] border border-[#444444] text-[#e5e5e5] text-[11px] font-mono-num flex flex-wrap items-center justify-between gap-2"
                                    >
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {sub.kind === 'SET_THRUST' && (
                                          <>
                                            <span>SET THRUST [{sub.portId}]</span>
                                            <input
                                              type="number"
                                              min={0}
                                              max={100}
                                              value={
                                                (sub.thrustPercent as any)?.value ?? 0
                                              }
                                              onChange={(e) =>
                                                handleUpdateNestedBranchAction(
                                                  actIdx,
                                                  'elseActions',
                                                  sIdx,
                                                  (old) => ({
                                                    ...(old as any),
                                                    thrustPercent: {
                                                      kind: 'NUMBER_CONST',
                                                      value: Number(e.target.value),
                                                    },
                                                  }),
                                                )
                                              }
                                              className="w-14 bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1 text-center"
                                            />
                                            <span>%</span>
                                          </>
                                        )}
                                        {sub.kind === 'SET_HINGE' && (
                                          <>
                                            <span>SET HINGE [{sub.portId}]</span>
                                            <input
                                              type="number"
                                              min={-45}
                                              max={45}
                                              value={
                                                (sub.angleDeg as any)?.value ?? 0
                                              }
                                              onChange={(e) =>
                                                handleUpdateNestedBranchAction(
                                                  actIdx,
                                                  'elseActions',
                                                  sIdx,
                                                  (old) => ({
                                                    ...(old as any),
                                                    angleDeg: {
                                                      kind: 'NUMBER_CONST',
                                                      value: Number(e.target.value),
                                                    },
                                                  }),
                                                )
                                              }
                                              className="w-14 bg-[#222222] text-[#fbbf24] border border-[#444444] rounded-[2px] px-1 text-center"
                                            />
                                            <span>°</span>
                                          </>
                                        )}
                                        {sub.kind === 'SET_LED_MATRIX' && (
                                          <span>LED ICON: {sub.icon}</span>
                                        )}
                                        {sub.kind === 'FIRE_WEAPON' && (
                                          <span>FIRE [{sub.portId}]</span>
                                        )}
                                        {sub.kind === 'IF_THEN' && (
                                          <span>ELSE-IF CONDITION</span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleRemoveNestedBranchAction(
                                            actIdx,
                                            'elseActions',
                                            sIdx,
                                          )
                                        }
                                        className="text-[10px] text-[#dc2626] hover:underline font-bold px-1 cursor-pointer"
                                      >
                                        X
                                      </button>
                                    </div>
                                  ))}
                                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                    <span className="text-[9px] text-[#a3a3a3] uppercase">
                                      + ELSE:
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleAddNestedBranchAction(
                                          actIdx,
                                          'elseActions',
                                          {
                                            kind: 'SET_THRUST',
                                            portId: 'ALL_THRUSTERS',
                                            thrustPercent: {
                                              kind: 'NUMBER_CONST',
                                              value: 0,
                                            },
                                          },
                                        )
                                      }
                                      className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9px] uppercase cursor-pointer"
                                    >
                                      + THRUST
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleAddNestedBranchAction(
                                          actIdx,
                                          'elseActions',
                                          {
                                            kind: 'SET_HINGE',
                                            portId: 'HINGE_1',
                                            angleDeg: {
                                              kind: 'NUMBER_CONST',
                                              value: 0,
                                            },
                                          },
                                        )
                                      }
                                      className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border border-[#444444] rounded-[2px] text-[9px] uppercase cursor-pointer"
                                    >
                                      + HINGE
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleAddNestedBranchAction(
                                          actIdx,
                                          'elseActions',
                                          {
                                            kind: 'SET_LED_MATRIX',
                                            icon: 'ARROW_UP',
                                          },
                                        )
                                      }
                                      className="px-1.5 py-0.5 bg-[#262626] hover:bg-[#333333] text-[#fbbf24] border border-[#444444] rounded-[2px] text-[9px] uppercase cursor-pointer"
                                    >
                                      + LED
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {act.kind === 'SET_THRUST' && (
                            <div
                              onMouseEnter={() => handlePortHover(act.portId)}
                              onMouseLeave={() => handlePortHover(null)}
                              className="text-xs font-mono-num text-[#e5e5e5] font-bold flex flex-wrap items-center gap-2 pr-28"
                            >
                              <span>SET THRUST PORT:</span>
                              <select
                                value={act.portId}
                                onChange={(e) => {
                                  const nextPort = e.target.value;
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).portId = nextPort;
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="bg-[#1a1a1a] text-[#fbbf24] border border-[#444444] rounded-[2px] px-2 py-0.5"
                              >
                                {availableThrusterPortIds.map((id) => (
                                  <option key={id} value={id}>
                                    {id}
                                  </option>
                                ))}
                              </select>
                              <span>POWER:</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={(act.thrustPercent as any)?.value ?? 100}
                                onChange={(e) => {
                                  const num = Number(e.target.value);
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).thrustPercent = {
                                      kind: 'NUMBER_CONST',
                                      value: num,
                                    };
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="w-16 bg-[#1a1a1a] text-[#fbbf24] border border-[#444444] rounded-[2px] px-2 py-0.5 text-center"
                              />
                              <span>%</span>
                            </div>
                          )}

                          {act.kind === 'SET_HINGE' && (
                            <div
                              onMouseEnter={() => handlePortHover(act.portId)}
                              onMouseLeave={() => handlePortHover(null)}
                              className="text-xs font-mono-num text-[#e5e5e5] font-bold flex flex-wrap items-center gap-2 pr-28"
                            >
                              <span>SET HINGE:</span>
                              <select
                                value={act.portId}
                                onChange={(e) => {
                                  const nextPort = e.target.value;
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).portId = nextPort;
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="bg-[#1a1a1a] text-[#fbbf24] border border-[#444444] rounded-[2px] px-2 py-0.5"
                              >
                                {availableHingePortIds.map((id) => (
                                  <option key={id} value={id}>
                                    {id}
                                  </option>
                                ))}
                              </select>
                              <span>ANGLE:</span>
                              <input
                                type="number"
                                min={-45}
                                max={45}
                                value={(act.angleDeg as any)?.value ?? 0}
                                onChange={(e) => {
                                  const num = Number(e.target.value);
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).angleDeg = {
                                      kind: 'NUMBER_CONST',
                                      value: num,
                                    };
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="w-16 bg-[#1a1a1a] text-[#fbbf24] border border-[#444444] rounded-[2px] px-2 py-0.5 text-center"
                              />
                              <span>° (-45° to +45°)</span>
                            </div>
                          )}

                          {act.kind === 'SET_PISTON' && (
                            <div
                              onMouseEnter={() => handlePortHover(act.portId)}
                              onMouseLeave={() => handlePortHover(null)}
                              className="text-xs font-mono-num text-[#e5e5e5] font-bold flex flex-wrap items-center gap-2 pr-28"
                            >
                              <span>SET PISTON:</span>
                              <select
                                value={act.portId}
                                onChange={(e) => {
                                  const nextPort = e.target.value;
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).portId = nextPort;
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="bg-[#1a1a1a] text-[#fbbf24] border border-[#444444] rounded-[2px] px-2 py-0.5"
                              >
                                {availablePistonPortIds.map((id) => (
                                  <option key={id} value={id}>
                                    {id}
                                  </option>
                                ))}
                              </select>
                              <span>EXTEND:</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={(act.extensionPercent as any)?.value ?? 100}
                                onChange={(e) => {
                                  const num = Number(e.target.value);
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).extensionPercent = {
                                      kind: 'NUMBER_CONST',
                                      value: num,
                                    };
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="w-16 bg-[#1a1a1a] text-[#fbbf24] border border-[#444444] rounded-[2px] px-2 py-0.5 text-center"
                              />
                              <span>%</span>
                            </div>
                          )}

                          {act.kind === 'FIRE_WEAPON' && (
                            <div
                              onMouseEnter={() => handlePortHover(act.portId)}
                              onMouseLeave={() => handlePortHover(null)}
                              className="text-xs font-mono-num text-[#dc2626] font-bold flex items-center gap-2 pr-28"
                            >
                              <span>FIRE WEAPON PORT:</span>
                              <select
                                value={act.portId}
                                onChange={(e) => {
                                  const nextPort = e.target.value;
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).portId = nextPort;
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="bg-[#1a1a1a] text-[#e5e5e5] border border-[#444444] rounded-[2px] px-2 py-0.5"
                              >
                                {availableWeaponPortIds.map((id) => (
                                  <option key={id} value={id}>
                                    {id}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {act.kind === 'SET_HEADLIGHT' && (
                            <div
                              onMouseEnter={() => handlePortHover(act.portId)}
                              onMouseLeave={() => handlePortHover(null)}
                              className="text-xs font-mono-num text-[#fbbf24] font-bold flex items-center gap-2 pr-28"
                            >
                              <span>SET HEADLIGHT BEAM:</span>
                              <select
                                value={((act.on as any)?.value ?? 1) > 0 ? 1 : 0}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).on = {
                                      kind: 'NUMBER_CONST',
                                      value: val,
                                    };
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="bg-[#1a1a1a] text-[#e5e5e5] border border-[#444444] rounded-[2px] px-2 py-0.5"
                              >
                                <option value={1}>ON (HIGH BEAM)</option>
                                <option value={0}>OFF</option>
                              </select>
                            </div>
                          )}

                          {act.kind === 'SET_LED_MATRIX' && (
                            <div className="text-xs font-mono-num text-[#fbbf24] font-bold flex items-center space-x-3 pr-28">
                              <span>DISPLAY 5×5 LED ICON:</span>
                              <select
                                value={act.icon}
                                onChange={(e) => {
                                  const icon = e.target.value as LedMatrixIcon;
                                  handleUpdateCurrentRule((prev) => {
                                    const nextActions = [...prev.actions];
                                    (nextActions[actIdx] as any).icon = icon;
                                    return { ...prev, actions: nextActions };
                                  });
                                }}
                                className="bg-[#1a1a1a] text-[#e5e5e5] border border-[#444444] rounded-[2px] px-2 py-1 text-xs"
                              >
                                {LED_ICONS.map((ic) => (
                                  <option key={ic} value={ic}>
                                    {ic}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* --- FOOTER STATUS & SAVE BAR --- */}
        <div className="bg-[#222222] px-4 py-2.5 border-t-2 border-[#444444] flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs">
          <div className="flex items-center space-x-2 text-[#a3a3a3] font-mono-num text-[11px]">
            <span className="w-2 h-2 rounded-[1px] bg-[#fbbf24]"></span>
            <span>
              Micro:bit ECU Active · Saved Library ({savedPrograms.length}) · Synced over P2P
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleCopyCurrentJson}
              className="px-3 py-1.5 bg-[#6b7280] hover:bg-[#52525b] text-[#e5e5e5] font-display font-bold text-xs uppercase rounded-[2px] border-2 border-[#444444] cursor-pointer"
            >
              COPY ECU .JSON
            </button>
            <button
              type="button"
              onClick={handleSaveToLibrary}
              className="px-3 py-1.5 bg-[#262626] hover:bg-[#333333] text-[#fbbf24] font-display font-bold text-xs uppercase rounded-[2px] border-2 border-[#444444] cursor-pointer"
            >
              SAVE TO LIBRARY
            </button>
            <button
              type="button"
              data-testid="ecu-save-and-upload-btn"
              onClick={() => {
                onSaveProgram(currentProg);
                onClose();
              }}
              className="px-4 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] font-display font-extrabold text-xs uppercase rounded-[2px] border-2 border-[#444444] cursor-pointer transition-colors"
            >
              UPLOAD TO VEHICLE &amp; CLOSE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
