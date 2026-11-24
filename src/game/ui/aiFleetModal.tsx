import React, { useState } from 'react';
import {
  analyzeVehicleCapabilities,
  pickRandomAIPersonality,
  type VehicleAIRole,
  type VehicleAITeam,
  type VehicleAIPersonality,
} from '../aiPilot.ts';
import { PRESET_NAMES, type SerializedVehicleBlueprint } from '../constants.ts';
import type { ModularVehicleRig } from '../vehicle.ts';
import { SoundFX } from '../sound.ts';

export interface AiFleetModalProps {
  isOpen: boolean;
  isMobilePopup: boolean;
  sim: any;
  activeCreationIdx: number;
  isSeatedInRig: boolean;
  savedBlueprints: SerializedVehicleBlueprint[];
  onClose: () => void;
  onSyncHud: () => void;
}

export const AI_ROLES: Array<{ id: VehicleAIRole; label: string; shortLabel: string }> = [
  { id: 'AUTO', label: 'SMART AUTO (ADAPTIVE)', shortLabel: 'AUTO' },
  { id: 'MELEE', label: 'MELEE (BLADE BRAWLER)', shortLabel: 'MELEE' },
  { id: 'GUNNER', label: 'GUNNER (ORBIT FIRE)', shortLabel: 'GUNNER' },
  { id: 'RAMMER', label: 'RAMMER (FULL BOOST)', shortLabel: 'RAMMER' },
  { id: 'GUARD', label: 'ESCORT / GUARD (ALLY)', shortLabel: 'ESCORT' },
];

export const AI_TEAMS: Array<{
  id: VehicleAITeam;
  label: string;
  bg: string;
  text: string;
  border: string;
}> = [
  { id: 'PLAYER', label: 'ALLY', bg: 'bg-[#22c55e]', text: 'text-[#141414]', border: 'border-[#22c55e]' },
  { id: 'RED', label: 'RED', bg: 'bg-[#dc2626]', text: 'text-[#f5f5f5]', border: 'border-[#dc2626]' },
  { id: 'BLUE', label: 'BLUE', bg: 'bg-[#38bdf8]', text: 'text-[#0f172a]', border: 'border-[#38bdf8]' },
  { id: 'GREEN', label: 'GREEN', bg: 'bg-[#facc15]', text: 'text-[#141414]', border: 'border-[#facc15]' },
  { id: 'ROGUE', label: 'FFA', bg: 'bg-[#f97316]', text: 'text-[#141414]', border: 'border-[#f97316]' },
];

export const AI_PERSONALITIES: Array<{
  id: VehicleAIPersonality;
  label: string;
  shortLabel: string;
  bg: string;
  text: string;
  border: string;
}> = [
  { id: 'AGGRESSIVE', label: 'AGGRESSIVE (120% SPD · RAMS)', shortLabel: 'AGGR', bg: 'bg-[#ef4444]', text: 'text-[#f5f5f5]', border: 'border-[#ef4444]' },
  { id: 'CAUTIOUS', label: 'CAUTIOUS (80% SPD · DEFENSIVE)', shortLabel: 'CAU', bg: 'bg-[#38bdf8]', text: 'text-[#0f172a]', border: 'border-[#38bdf8]' },
  { id: 'MIXED', label: 'MIXED (SWITCHES 5-10S)', shortLabel: 'MIX', bg: 'bg-[#facc15]', text: 'text-[#141414]', border: 'border-[#facc15]' },
];

export const AiFleetModal: React.FC<AiFleetModalProps> = ({
  isOpen,
  isMobilePopup,
  sim,
  activeCreationIdx,
  isSeatedInRig,
  savedBlueprints,
  onClose,
  onSyncHud,
}) => {
  const [, setLocalTick] = useState(0);
  const [spawnPresetIdx, setSpawnPresetIdx] = useState(0);
  const [spawnTeam, setSpawnTeam] = useState<VehicleAITeam>('RED');
  const [spawnRole, setSpawnRole] = useState<VehicleAIRole>('AUTO');
  const [spawnPersonality, setSpawnPersonality] = useState<'RANDOM' | VehicleAIPersonality>('RANDOM');
  const [statusNote, setStatusNote] = useState('');

  if (!isOpen || !sim) return null;

  const creations: ModularVehicleRig[] = Array.isArray(sim.creations) ? sim.creations : [];
  const bump = () => {
    setLocalTick((t) => t + 1);
    onSyncHud();
  };

  const spawnAiFighter = (
    opts: {
      presetIdx?: number;
      bp?: SerializedVehicleBlueprint;
      team: VehicleAITeam;
      role: VehicleAIRole;
      personality: 'RANDOM' | VehicleAIPersonality;
      label: string;
    },
  ) => {
    SoundFX.snap();
    const prevIdx = sim.activeCreationIndex ?? 0;
    const anchorRig: ModularVehicleRig | undefined = creations[prevIdx] || sim.rig;
    const angle = Math.random() * Math.PI * 2;
    const dist = 16 + Math.random() * 8;
    const spawnX = (anchorRig ? anchorRig.position.x : 0) + Math.cos(angle) * dist;
    const spawnZ = (anchorRig ? anchorRig.position.z : 0) + Math.sin(angle) * dist;

    const newRig: ModularVehicleRig = opts.bp
      ? sim.spawnNewCreation(undefined, opts.bp)
      : sim.spawnNewCreation(opts.presetIdx ?? 0);

    const assignedPersonality: VehicleAIPersonality =
      opts.personality === 'RANDOM'
        ? pickRandomAIPersonality()
        : opts.personality;

    newRig.setHoverBuildMode(false);
    newRig.isRemoteControlled = false;
    newRig.summonTo(spawnX, spawnZ, Math.atan2(-Math.cos(angle), -Math.sin(angle)));
    newRig.aiConfig.enabled = true;
    newRig.aiConfig.role = opts.role;
    newRig.aiConfig.team = opts.team;
    newRig.aiConfig.personality = assignedPersonality;
    newRig.aiConfig.effectivePersonality =
      assignedPersonality === 'CAUTIOUS' ? 'CAUTIOUS' : 'AGGRESSIVE';
    newRig.aiConfig.homeX = spawnX;
    newRig.aiConfig.homeZ = spawnZ;
    newRig.aiConfig.statusLabel = 'READY';

    // Keep player seated in their own creation unless there was only 1
    if (creations.length > 1 && prevIdx >= 0 && prevIdx < sim.creations.length) {
      sim.setActiveCreation(prevIdx);
    }

    setStatusNote(
      `Spawned ${opts.label} on ${opts.team} (${opts.role} · ${assignedPersonality}) at (${Math.round(spawnX)}, ${Math.round(spawnZ)}).`,
    );
    bump();
  };

  const toggleAllAi = (enable: boolean) => {
    SoundFX.snap();
    let changed = 0;
    creations.forEach((cr, idx) => {
      const isPlayerInThis = isSeatedInRig && idx === activeCreationIdx;
      if (isPlayerInThis && enable) return;
      cr.aiConfig.enabled = enable;
      if (enable) {
        cr.aiConfig.homeX = cr.position.x;
        cr.aiConfig.homeZ = cr.position.z;
      } else {
        cr.aiThrottleInput = 0;
        cr.aiSteerInput = 0;
        cr.aiPitchInput = 0;
        cr.aiRollInput = 0;
        cr.aiCollectiveInput = 0;
        cr.aiBrakeInput = false;
        cr.aiConfig.statusLabel = 'HUMAN';
      }
      changed++;
    });
    setStatusNote(enable ? `Activated AI on ${changed} vehicle(s).` : 'Paused all AI pilots.');
    bump();
  };

  const activeAiCount = creations.filter((c) => c.aiConfig?.enabled).length;

  return (
    <div
      data-testid="ai-fleet-modal"
      data-layout-mode={isMobilePopup ? 'mobile' : 'laptop'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={`fixed inset-0 z-[115] bg-[#141414]/90 flex items-center justify-center pointer-events-auto touch-manipulation ${
        isMobilePopup ? 'p-1.5' : 'p-4'
      }`}
    >
      <div
        className={`bg-[#1a1a1a] border-2 border-[#444444] rounded-[2px] text-[#e5e5e5] overflow-y-auto overscroll-contain touch-pan-y shadow-2xl ${
          isMobilePopup
            ? 'w-[min(96vw,740px)] max-h-[calc(100dvh-14px)] p-2.5 sm:p-3'
            : 'w-full max-w-4xl max-h-[90vh] p-5'
        }`}
      >
        {/* Sticky Modal Header */}
        <div
          className={`sticky top-0 z-20 bg-[#1a1a1a] flex items-center justify-between gap-2 border-b-2 border-[#444444] mb-3 ${
            isMobilePopup ? '-mx-2.5 -mt-2.5 px-2.5 py-2' : '-mx-5 -mt-5 px-5 py-3.5'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="bg-[#fbbf24] text-[#1a1a1a] font-display font-extrabold text-[10px] px-2 py-0.5 rounded-[2px] uppercase shrink-0">
              AI PILOTS
            </span>
            <h2
              className={`font-display font-bold text-[#e5e5e5] uppercase tracking-wide truncate ${
                isMobilePopup ? 'text-xs' : 'text-base'
              }`}
            >
              {isMobilePopup
                ? `OFFLINE AI FLEET (${activeAiCount} ACTIVE)`
                : `OFFLINE AI PILOTS & COMBAT ARENA (${activeAiCount} ACTIVE / ${creations.length} RIGS)`}
            </h2>
          </div>
          <button
            type="button"
            data-testid="close-ai-fleet-btn"
            onClick={onClose}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="min-h-[34px] px-3 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-xs uppercase cursor-pointer shrink-0 touch-manipulation"
          >
            ✕ CLOSE
          </button>
        </div>

        {/* Info Banner + Bulk Actions */}
        <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-mono-num text-[#d4d4d4] leading-snug max-w-xl">
            Assign smart offline AI to <strong className="text-[#fbbf24]">any creation</strong> (even custom, wheel-less, seat-less, or battle-damaged rigs). Props remain purely lifeless physics objects.
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="ai-enable-others-btn"
              onClick={() => toggleAllAi(true)}
              className="px-2.5 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-[#141414] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-[10.5px] uppercase cursor-pointer"
            >
              ENGAGE ALL OTHERS
            </button>
            <button
              type="button"
              data-testid="ai-disable-all-btn"
              onClick={() => toggleAllAi(false)}
              className="px-2.5 py-1.5 bg-[#333333] hover:bg-[#444444] text-[#e5e5e5] border-2 border-[#555555] rounded-[2px] font-display font-bold text-[10.5px] uppercase cursor-pointer"
            >
              PAUSE ALL AI
            </button>
          </div>
        </div>

        {statusNote && (
          <div
            data-testid="ai-fleet-feedback"
            className="mb-3 px-2.5 py-1.5 bg-[#14261c] border-2 border-[#22c55e] rounded-[2px] text-[11px] font-mono-num text-[#86efac]"
          >
            {statusNote}
          </div>
        )}

        {/* Section 1: Quick Offline AI Fighter Spawner */}
        <div className="bg-[#222222] border-2 border-[#444444] rounded-[2px] p-2.5 mb-3">
          <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
            <span className="text-[11px] font-display font-extrabold text-[#fbbf24] uppercase tracking-wider">
              SPAWN AI OPPONENT OR WINGMAN (NO MULTIPLAYER NEEDED)
            </span>
          </div>

          <div
            className={`grid gap-2 mb-2 ${
              isMobilePopup ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-3'
            }`}
          >
            {/* Vehicle Preset Picker */}
            <label className="flex flex-col gap-1 text-[10px] font-mono-num text-[#a3a3a3] uppercase min-w-0">
              <span>Chassis / Creation</span>
              <select
                data-testid="ai-spawn-preset-select"
                value={spawnPresetIdx}
                onChange={(e) => setSpawnPresetIdx(Number(e.target.value))}
                className="w-full bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2 py-1.5 text-xs font-display font-bold text-[#e5e5e5] uppercase focus:border-[#fbbf24] focus:outline-none truncate"
              >
                {PRESET_NAMES.map((pName, i) => (
                  <option key={pName} value={i}>
                    #{i + 1} {pName}
                  </option>
                ))}
              </select>
            </label>

            {/* Role Picker */}
            <label className="flex flex-col gap-1 text-[10px] font-mono-num text-[#a3a3a3] uppercase min-w-0">
              <span>Combat Role</span>
              <select
                data-testid="ai-spawn-role-select"
                value={spawnRole}
                onChange={(e) => {
                  const nextRole = e.target.value as VehicleAIRole;
                  setSpawnRole(nextRole);
                  if (nextRole === 'GUARD') {
                    setSpawnTeam('PLAYER');
                  }
                }}
                className="w-full bg-[#141414] border-2 border-[#444444] rounded-[2px] px-2 py-1.5 text-xs font-display font-bold text-[#e5e5e5] uppercase focus:border-[#fbbf24] focus:outline-none truncate"
              >
                {AI_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Team Picker */}
            <div className="flex flex-col gap-1 text-[10px] font-mono-num text-[#a3a3a3] uppercase">
              <span>Team Faction</span>
              <div className="grid grid-cols-5 gap-1">
                {AI_TEAMS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={`ai-spawn-team-${t.id}`}
                    onClick={() => {
                      SoundFX.snap();
                      setSpawnTeam(t.id);
                    }}
                    className={`py-1.5 rounded-[2px] text-[10px] font-display font-extrabold uppercase border-2 cursor-pointer ${
                      spawnTeam === t.id
                        ? `${t.bg} ${t.text} border-[#f5f5f5]`
                        : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[10px] font-mono-num text-[#a3a3a3] uppercase mr-1">
              PERSONALITY:
            </span>
            <button
              type="button"
              data-testid="ai-spawn-personality-RANDOM"
              onClick={() => {
                SoundFX.snap();
                setSpawnPersonality('RANDOM');
              }}
              className={`px-2 py-1 rounded-[2px] text-[10px] font-display font-extrabold uppercase border-2 cursor-pointer ${
                spawnPersonality === 'RANDOM'
                  ? 'bg-[#e5e5e5] text-[#141414] border-[#f5f5f5]'
                  : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
              }`}
            >
              RANDOM
            </button>
            {AI_PERSONALITIES.map((p) => (
              <button
                key={p.id}
                type="button"
                data-testid={`ai-spawn-personality-${p.id}`}
                onClick={() => {
                  SoundFX.snap();
                  setSpawnPersonality(p.id);
                }}
                className={`px-2 py-1 rounded-[2px] text-[10px] font-display font-extrabold uppercase border-2 cursor-pointer ${
                  spawnPersonality === p.id
                    ? `${p.bg} ${p.text} border-[#f5f5f5]`
                    : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
                }`}
              >
                {p.id}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="ai-spawn-fighter-btn"
              onClick={() =>
                spawnAiFighter({
                  presetIdx: spawnPresetIdx,
                  team: spawnTeam,
                  role: spawnRole,
                  personality: spawnPersonality,
                  label: PRESET_NAMES[spawnPresetIdx] || 'AI Rig',
                })
              }
              className="px-3 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-xs uppercase cursor-pointer"
            >
              + SPAWN AI FIGHTER
            </button>

            <button
              type="button"
              data-testid="ai-clone-enemy-btn"
              onClick={() => {
                const activeRig = creations[activeCreationIdx] || sim.rig;
                if (!activeRig) return;
                const bp = activeRig.exportBlueprint(
                  `${activeRig.customBlueprintName || PRESET_NAMES[activeRig.presetIndex] || 'My Rig'} AI`,
                );
                const cloneTeam =
                  spawnRole === 'GUARD'
                    ? spawnTeam
                    : spawnTeam === 'PLAYER'
                      ? 'RED'
                      : spawnTeam;
                spawnAiFighter({
                  bp,
                  team: cloneTeam,
                  role: spawnRole,
                  personality: spawnPersonality,
                  label: bp.name || 'Cloned Rig',
                });
              }}
              className="px-3 py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] text-[#f5f5f5] border-2 border-[#444444] rounded-[2px] font-display font-extrabold text-xs uppercase cursor-pointer"
            >
              + CLONE MY RIG AS AI ({spawnRole === 'GUARD' ? spawnTeam : spawnTeam === 'PLAYER' ? 'RED' : spawnTeam})
            </button>

            {savedBlueprints.slice(0, isMobilePopup ? 2 : 4).map((bpItem) => (
              <button
                key={bpItem.id}
                type="button"
                onClick={() =>
                  spawnAiFighter({
                    bp: bpItem,
                    team: spawnTeam,
                    role: spawnRole,
                    personality: spawnPersonality,
                    label: bpItem.name,
                  })
                }
                className="px-2.5 py-1.5 bg-[#262626] hover:bg-[#333333] text-[#38bdf8] border-2 border-[#444444] rounded-[2px] font-display font-bold text-[10.5px] uppercase cursor-pointer truncate max-w-[180px]"
                title={`Spawn saved creation "${bpItem.name}" as AI`}
              >
                + AI: {bpItem.name}
              </button>
            ))}
          </div>
        </div>

        {/* Section 2: Active Creations & AI Assignments */}
        <div className="space-y-2">
          <div className="text-[11px] font-display font-extrabold text-[#e5e5e5] uppercase tracking-wider">
            WORLD CREATIONS ({creations.length}) — ASSIGN AI, ROLE &amp; TEAM
          </div>

          {creations.map((cr, idx) => {
            const isActive = idx === activeCreationIdx;
            const isPlayerDrivingThis = isActive && isSeatedInRig;
            const caps = analyzeVehicleCapabilities(cr);
            const cfg = cr.aiConfig;
            const rigTitle =
              cr.customBlueprintName ||
              PRESET_NAMES[cr.presetIndex] ||
              `Creation #${idx + 1}`;

            const locomotionChip = caps.canFly
              ? 'VTOL / FLIGHT'
              : caps.canDriveGround
                ? `${caps.intactDriveWheels} WHEEL${caps.intactDriveWheels > 1 ? 'S' : ''}${caps.isDamagedAsymmetric ? ' (ASYM)' : ''}`
                : caps.canThrustSkid
                  ? 'NO WHEELS -> THRUSTER SKID'
                  : caps.canSwim
                    ? 'BOAT'
                    : 'IMMOBILIZED';

            return (
              <div
                key={cr.vehicleId || idx}
                data-testid={`ai-rig-card-${idx}`}
                className={`p-2.5 rounded-[2px] border-2 ${
                  cfg.enabled
                    ? 'bg-[#1f2923] border-[#22c55e]'
                    : isActive
                      ? 'bg-[#26241d] border-[#fbbf24]'
                      : 'bg-[#222222] border-[#444444]'
                }`}
              >
                {/* Top Row: Name + Telemetry Chips + AI ON/OFF Toggle */}
                <div className={`flex flex-wrap items-center justify-between gap-2 ${cfg.enabled ? 'mb-2' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-display font-extrabold text-[#f5f5f5] uppercase">
                        #{idx + 1} {rigTitle}
                      </span>
                      {isPlayerDrivingThis && (
                        <span className="px-1.5 py-0.5 bg-[#fbbf24] text-[#1a1a1a] text-[9.5px] font-mono-num font-extrabold rounded-[2px] uppercase">
                          YOU (SEATED)
                        </span>
                      )}
                      {cfg.enabled && (
                        <>
                          <span className="px-1.5 py-0.5 bg-[#22c55e] text-[#141414] text-[9.5px] font-mono-num font-extrabold rounded-[2px] uppercase">
                            AI: {cfg.statusLabel}
                          </span>
                          {(() => {
                            const pMeta =
                              AI_PERSONALITIES.find((p) => p.id === cfg.personality) ||
                              AI_PERSONALITIES[0];
                            return (
                              <span
                                className={`px-1.5 py-0.5 ${pMeta.bg} ${pMeta.text} text-[9.5px] font-mono-num font-extrabold rounded-[2px] uppercase`}
                              >
                                {cfg.personality}
                              </span>
                            );
                          })()}
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] font-mono-num text-[#a3a3a3]">
                      <span>{cr.voxelCount} BLK</span>
                      <span>·</span>
                      <span>{cr.structuralIntegrityPct}% HULL</span>
                      <span>·</span>
                      <span className={caps.canDriveGround ? 'text-[#e5e5e5]' : 'text-[#fb923c]'}>
                        {locomotionChip}
                      </span>
                      {caps.meleeCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-[#facc15]">{caps.meleeCount} MELEE</span>
                        </>
                      )}
                      {caps.rangedCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-[#38bdf8]">{caps.rangedCount} GUNS</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      data-testid={`ai-toggle-rig-${idx}`}
                      onClick={() => {
                        SoundFX.snap();
                        const nextEnabled = !cfg.enabled;
                        cfg.enabled = nextEnabled;
                        if (nextEnabled) {
                          cr.setHoverBuildMode(false);
                          cr.isRemoteControlled = false;
                          cfg.homeX = cr.position.x;
                          cfg.homeZ = cr.position.z;
                          cfg.statusLabel = isPlayerDrivingThis ? 'ARMED (EXIT TO RUN)' : 'ACTIVE';
                          // If player turned AI on their own rig, let them either hop out or click drive another
                          if (isPlayerDrivingThis && sim.isSeatedInRig) {
                            sim.toggleEnterExitRig();
                          }
                        } else {
                          cr.aiThrottleInput = 0;
                          cr.aiSteerInput = 0;
                          cr.aiPitchInput = 0;
                          cr.aiRollInput = 0;
                          cr.aiCollectiveInput = 0;
                          cr.aiBrakeInput = false;
                          cfg.statusLabel = 'HUMAN';
                        }
                        bump();
                      }}
                      className={`px-3 py-1.5 rounded-[2px] border-2 font-display font-extrabold text-[11px] uppercase cursor-pointer ${
                        cfg.enabled
                          ? 'bg-[#22c55e] text-[#141414] border-[#f5f5f5]'
                          : 'bg-[#333333] hover:bg-[#444444] text-[#fbbf24] border-[#555555]'
                      }`}
                    >
                      {cfg.enabled ? 'AI: ON' : isPlayerDrivingThis ? 'HAND OVER TO AI' : 'ASSIGN AI'}
                    </button>

                    {!isPlayerDrivingThis && (
                      <button
                        type="button"
                        onClick={() => {
                          SoundFX.snap();
                          cfg.enabled = false;
                          cfg.statusLabel = 'HUMAN';
                          sim.setActiveCreation(idx);
                          if (!sim.isSeatedInRig && cr.hasIntactSeat()) {
                            sim.toggleEnterExitRig();
                          }
                          onClose();
                        }}
                        className="px-2 py-1.5 bg-[#fbbf24] hover:bg-[#facc15] text-[#1a1a1a] border-2 border-[#444444] rounded-[2px] font-display font-bold text-[10px] uppercase cursor-pointer"
                      >
                        DRIVE
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        SoundFX.snap();
                        cr.summonTo(cr.position.x, cr.position.z, 0);
                        bump();
                      }}
                      className="px-2 py-1.5 bg-[#262626] hover:bg-[#333333] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-bold text-[10px] uppercase cursor-pointer"
                      title="Repair this vehicle"
                    >
                      FIX
                    </button>

                    {creations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          SoundFX.remove();
                          sim.setActiveCreation(idx);
                          sim.deleteActiveCreation();
                          bump();
                        }}
                        className="px-2 py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] text-[#e5e5e5] border-2 border-[#444444] rounded-[2px] font-display font-bold text-[10px] uppercase cursor-pointer"
                        title="Remove creation"
                      >
                        DEL
                      </button>
                    )}
                  </div>
                </div>

                {/* Bottom Row: Team, Role & Style Controls (hidden until AI is activated) */}
                {cfg.enabled && (
                  <div
                    data-testid={`ai-rig-${idx}-options`}
                    className={`grid gap-2 pt-2 border-t border-[#383838] ${
                      isMobilePopup ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase shrink-0 w-9">
                        TEAM
                      </span>
                      <div className="grid grid-cols-5 gap-1 flex-1 min-w-0">
                        {AI_TEAMS.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            data-testid={`ai-rig-${idx}-team-${t.id}`}
                            onClick={() => {
                              SoundFX.snap();
                              cfg.team = t.id;
                              bump();
                            }}
                            className={`py-1 px-1 rounded-[2px] border text-[9px] font-display font-extrabold uppercase cursor-pointer text-center truncate ${
                              cfg.team === t.id
                                ? `${t.bg} ${t.text} border-[#f5f5f5]`
                                : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase shrink-0 w-9">
                        ROLE
                      </span>
                      <div className="grid grid-cols-5 gap-1 flex-1 min-w-0">
                        {AI_ROLES.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            data-testid={`ai-rig-${idx}-role-${r.id}`}
                            onClick={() => {
                              SoundFX.snap();
                              cfg.role = r.id;
                              if (r.id === 'GUARD') {
                                cfg.team = 'PLAYER';
                              }
                              bump();
                            }}
                            className={`py-1 px-1 rounded-[2px] border text-[9px] font-display font-bold uppercase cursor-pointer text-center truncate ${
                              cfg.role === r.id
                                ? 'bg-[#fbbf24] text-[#1a1a1a] border-[#f5f5f5]'
                                : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
                            }`}
                          >
                            {r.shortLabel}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className={`flex items-center gap-1.5 min-w-0 ${isMobilePopup ? 'sm:col-span-2' : 'col-span-2'}`}>
                      <span className="text-[9.5px] font-mono-num text-[#a3a3a3] uppercase shrink-0 w-9">
                        STYLE
                      </span>
                      <div className="grid grid-cols-3 gap-1 flex-1 min-w-0">
                        {AI_PERSONALITIES.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            data-testid={`ai-rig-${idx}-personality-${p.id}`}
                            onClick={() => {
                              SoundFX.snap();
                              cfg.personality = p.id;
                              cfg.effectivePersonality =
                                p.id === 'CAUTIOUS' ? 'CAUTIOUS' : 'AGGRESSIVE';
                              bump();
                            }}
                            className={`py-1 px-1 rounded-[2px] border text-[9px] font-display font-extrabold uppercase cursor-pointer text-center truncate ${
                              cfg.personality === p.id
                                ? `${p.bg} ${p.text} border-[#f5f5f5]`
                                : 'bg-[#141414] text-[#a3a3a3] border-[#444444]'
                            }`}
                          >
                            {p.id}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
