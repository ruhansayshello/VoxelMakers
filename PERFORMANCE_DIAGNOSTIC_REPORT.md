# Comprehensive Performance Diagnostic Report (Post-Phase 3c + Adaptive FPS Cap Audit)

**Date:** 2026-11-22  
**Test Environment:** `http://localhost:3000/?autostart=1`, `1280×720`, `PENTIUM` default preset (`resolutionScale: 0.6`, `usePotatoShader: true`, post-FX disabled) + `MEDIUM` comparison (`SSAO + Bloom + 1024px Dynamic Shadows`, `voxelDrawDistance: 5`), headless Chromium (`Google SwiftShader` software WebGL + 200ms headless yield timer), stationary idle + driving (`KeyW`) + 30-frame instrumented `stepFrame` trace.  
**Scope:** Post-Phase 3c SoA verification, Adaptive Frame Rate Cap verification, root-cause diagnosis of the **60 FPS ceiling when set to `Uncapped`**, and root-cause diagnosis of **ongoing FPS drops / frame spikes**.

> **Environment Caveat:** Because headless Chromium uses SwiftShader software WebGL plus the app's 200ms headless yield timer, aggregate `FPS (3.8–6.2)` and `Frame Time (161–265 ms)` reflect headless pacing and software rasterization. All **per-frame JS CPU timings (`stepFrame`, `render`, `vwStep`, `worldUpd`, `Meshing`, `HUD`, `Draw Calls`, `Triangles`, `WebGLPrograms` misses)** are real main-thread CPU measurements.

---

## 1. Before vs. After Phase 3c Summary (Live Capture)

| Metric | Pre-Phase 3c (2026-11-21) | Post-Phase 3c (`PENTIUM`, Idle/Drive) | `MEDIUM` Preset (Post-3c) | Status |
|---|---|---|---|---|
| **Steady `Render` JS submission (normal frame)** | `9.86 – 16.54 ms` | **`1.68 – 4.37 ms`** *(spikes `21.6 – 41.8 ms`)* | `12.8 – 87.4 ms` *(416 ms switch)* | **~3–4× faster steady-state**, spikes remain |
| **`WebGLPrograms.getParameters()` misses** | `377 / frame` *(326 GLSL concats)* | **`0 / frame`** *(100% cache hit)* | `35` on preset switch, then `0` | **FIXED** |
| **Terrain Chunk Batching (`renderChunkBatch`)** | Not wired (`27` chunk calls) | **Wired (`25` chunks → 1 batch)** | Wired (`49` chunks → 1 batch) | **FIXED** *(rebuild stalls remain on camera/chunk change)* |
| **Total Draw Calls / Frame** | `373 – 377` | **`351`** (`347` GL draws) | **`359`** (`358` scene) | **STILL HIGH** (`339` tiny `Group::Mesh` unmerged) |
| **Triangles / Frame** | `184,670 – 185,566` | `191,514` (`482,066` total scene) | `301,804` (`49` chunks) | High on `MEDIUM+` |
| **`VoxelWorld.integratePhysics`** | `0.009 – 0.010 ms` | **`0.008 – 0.013 ms`** | `0.017 ms` | Fast (flat SoA) |
| **`vehicle.updatePhysics` (`vehPhys`)** | `1.24 – 2.77 ms` | **`0.88 – 1.07 ms`** | `6.13 ms` *(catch-up burst)* | **~2× faster** (`SoAVector3View` removed) |
| **`resolveCollisions`** | `0.495 – 0.726 ms` | **`0.39 – 0.47 ms`** | `4.58 ms` *(catch-up burst)* | Faster steady-state |
| **`world.updateChunksAndVisibility` (`WorldUpd`)** | `1.64 – 3.72 ms` | **`0.04 – 0.40 ms` steady** *(avg `8.2 ms` w/ streaming)* | `9.60 ms` | Fast when idle, spikes on streaming |
| **Event Queue Lengths (`VoxelWorld`)** | Leaking (`83` vis, `40` sleep) | **`0` across all 5 queues** | **`0` across all 5 queues** | **FIXED** |
| **Memory (`usedJSHeapSize`)** | `117.3 MB` | `110.6 – 117.3 MB` | `117.3 MB` | Stable |
| **Adaptive Frame Rate Cap** | None | **`AUTO` (`LOW` → `30 FPS`), 60Hz fixed physics** | **`AUTO` (`LOW` → `30 FPS`)** | **IMPLEMENTED & VERIFIED** |

---

## 2. Why It STILL Does Not Go Above 60 FPS Even When Set to `Uncapped`

A full audit of the frame loop (`src/App.tsx`, `src/game/frameRateCap.ts`, `src/game/frameGovernor.ts`, `src/engine/perf/PerfProfiler.ts`, and `src/engine/renderers/WebGLRenderer.ts`) confirms **there is NO hidden 60 FPS code clamp** when `Frame Rate Cap = Uncapped`:
- `resolveTargetFps('UNCAPPED', tier)` returns `0`.
- `computeFrameCapTargetMs(0)` returns `0`, and `shouldRenderCappedFrame()` immediately returns `true`.
- `currentFps` in `src/App.tsx:7255` clamps at `240` (not `60`), and `PerfProfiler` has no FPS ceiling.

Instead, the 60 FPS ceiling under `Uncapped` comes from **two real browser/hardware causes**:

### 2a. Browser `requestAnimationFrame` VSync Hard Lock *(Primary Cause)*
- `src/App.tsx:8500` schedules every frame via `window.requestAnimationFrame(animate)`.
- By W3C HTML specification, **`requestAnimationFrame` is strictly locked to the browser compositor's VSync signal** — JavaScript inside `requestAnimationFrame` physically **cannot** run faster than the active compositor refresh rate:
  1. **60Hz Display / OS Setting:** Any 60Hz laptop panel, 60Hz monitor, or high-refresh monitor left at 60Hz in Windows/macOS/Linux display settings caps `rAF` at **60.0 Hz (`16.67 ms`)**.
  2. **Android High-Refresh-Rate Throttling (e.g., MediaTek Dimensity 6300 / 90Hz–120Hz phones):** Android SurfaceFlinger and Chrome's Adaptive Refresh Rate heuristic frequently **downsample WebGL `<canvas>` pages to 60Hz** unless high refresh rate is forced globally in OS Display settings.
  3. **Safari / Battery Saver / Low Power Mode:** macOS/iOS Safari defaults `rAF` to 60Hz (`Prefer Page Rendering Updates near 60fps`), and Chrome throttles `rAF` to 60Hz (or 30Hz) in battery saver mode.
  4. **Embedded Iframe Preview:** When running inside a preview iframe, `rAF` inherits the host browser tab's VSync cadence.
- *Important Architectural Note:* Replacing `requestAnimationFrame` with `setTimeout(0)` or `MessageChannel` to "bypass" VSync does **not** actually present >60 visible frames on a 60Hz screen — it only burns CPU/GPU rendering invisible backbuffer frames that the compositor drops, causing thermal throttling and input lag. True >60 FPS requires a `90Hz / 120Hz / 144Hz` display **with OS + browser VSync running at that rate**, plus frame times `< 8.33 ms` (120Hz) or `< 6.94 ms` (144Hz).

### 2b. VSync Divisor Drop on 120Hz / 144Hz Displays *(Secondary Cause)*
- Even on a genuine `120Hz` display (`8.33 ms` total CPU + GPU budget), **351–359 draw calls/frame** plus periodic **`21–42 ms` render stalls** and **`MEDIUM` post-FX** (`12.8–87.4 ms`) routinely exceed `8.33 ms`.
- Whenever a frame misses one 120Hz VSync deadline (`> 8.33 ms`), double-buffered WebGL presentation drops straight to the next integer divisor: **`120 / 2 = 60 FPS`** (or `144 / 2 = 72 FPS`).

---

## 3. Why There Are Still FPS Drops (5 Verified Root Causes of Frame Spikes)

Live 16-frame and 30-frame instrumented captures of `stepFrame()` exposed exact spike patterns even while sitting completely idle:

```text
Idle 15 frames (ms):  [5.34, 6.95, 6.16, 5.45, 56.77*, 13.35, 6.72, 9.54, 73.98*, 10.40, 7.00, 6.32, 7.17, 64.92*, 4.44]
Drive 20 frames (ms): [2.55, 2.73, 1.61, 1.54,  3.94,   7.09, 8.76, 70.63*, 7.06,  4.94, 4.65, 4.33, 3.92,  4.74,  4.44, 5.05, 6.29, 50.88*, 5.81, 7.85]
MEDIUM 6 frames (ms): [416.10*, 77.80*, 87.40*, 17.21, 81.86*, 12.83]
```

### Culprit #1 (BIGGEST): `351–359` Unmerged Draw Calls/Frame — `339` Tiny `Group::Mesh[ShaderMaterial]` Meshes
Live traversal of the active scene (`471` visible renderables, `482,066` total scene tris, `351` draw calls submitted after frustum culling):

| Scene Category | Visible Meshes | Triangles | Avg Tris / Mesh |
|---|---|---|---|
| **`Group::Mesh[ShaderMaterial]`** *(vehicles, wheels, 20 `voxelEntities`, arena hazards)* | **339** | `85,516` | **252** |
| **`Group::Mesh[MeshBasicMaterial]`** *(markers / lights / UI decals)* | **30** | `2,978` | **99** |
| **`Scene::Mesh[ShaderMaterial]`** *(25 terrain chunks batched + sky)* | **26** | `345,280` | `13,280` *(batched to 1 draw)* |
| **`Scene::Mesh[MeshBasicMaterial]`** *(21 blob shadows / markers)* | **21** | `42` | **2** |
| **`Group::Mesh[MeshStandardMaterial]`** | **20** | `3,260` | **163** |
| `Mesh::Mesh[ShaderMaterial]` | 9 | `164` | 18 |
| `Group::tp_ring[MeshBasicMaterial]` | 5 | `1,920` | 384 |
| `Scene::Mesh[MeshPhongMaterial]` *(water/translucent chunks)* | 5 | `24,576` | 4,915 |
| `InstancedMesh` (all 4 combined) | 4 | `17,824` | 4,456 |
| Other (`FlameMesh`, character parts, helpers) | 12 | `506` | 42 |
| **TOTAL** | **471 visible (`351` drawn)** | **`191,514` drawn** | — |

- Even though `renderChunkBatch()` successfully collapsed 25 terrain chunks into 1 draw call, **`339` tiny (~252-tri) `Group::Mesh[ShaderMaterial]` meshes** plus **`51` tiny `MeshBasicMaterial`/`MeshStandardMaterial` meshes** still issue **`347–351` WebGL draw calls every frame**.
- Every draw call still incurs `WebGLBindingStates` attribute checks, matrix uniform uploads, and ANGLE/WebGL2 driver validation — saturating the driver command ring buffer and triggering periodic **`21–42 ms` render stalls** (`i=1: 41.82 ms`, `i=7: 40.11 ms`, `i=15: 34.81 ms`, `i=25: 30.82 ms`).

### Culprit #2: Full-Terrain VBO Rebuild & Re-Upload Inside `renderChunkBatch()` (`src/engine/renderers/WebGLRenderer.ts:1501–1560`)
- `renderChunkBatch()` caches the merged terrain `BufferGeometry` **only** while the exact ordered array of frustum-visible chunks (`_chunkBatchCachedChunks`) and their revisions are 100% identical.
- **Any time the camera rotates/moves enough for even 1 terrain chunk to enter or leave the frustum, or 1 chunk finishes meshing**, `cacheHit` becomes `false` and `renderChunkBatch()` copies and re-uploads **ALL 25–49 chunks (`191k–345k` triangles, multi-MB typed arrays)** into a single monolithic VBO via `gl.bufferData` on the main thread!
- That produces sudden **`60–185 ms` `Render slow` spikes** while turning the camera or driving (`console.warn`: `Render slow: 68.13 ms`, `107.35 ms`, `185.83 ms`, `664.94 ms`).

### Culprit #3: Main-Thread React HUD Re-Render & GC Spikes (`other = 47.90 ms`!)
- On frame 11 of our 16-frame isolated trace, `stepFrame` took **`51.65 ms`** while `render = 3.51 ms`, `worldUpd = 0.23 ms`, `phys = 0.01 ms` — leaving **`47.90 ms` in `other`**.
- Primary sources inside `stepFrame` outside physics/render/world:
  1. **`syncHudNow()` (`src/App.tsx:4880–5010`)**: Calls `setHud(...)` every `180 ms` (~5.5×/sec) on the monolithic **19,690-line `App` React component**, forcing React to reconcile the entire top-level component tree on the main thread during gameplay.
  2. **Transient per-frame allocations triggering V8 GC pauses**: `WebGLUniforms.flattenArray()` (`new Float32Array`), `Object.keys()` inside `WebGLBindingStates`, `frameDeltasMs.shift()` (`O(n)` shift on a 60-element array every frame), and React virtual-DOM diff objects every `180 ms`.

### Culprit #4: Main-Thread Chunk Streaming & Meshing Spikes (`Meshing slow: 2.1 – 60.0 ms`, Startup `471 ms`)
- Even with dedicated Web Workers (`workerRttMs = 521–652 ms`), `applyWorkerPayloadToChunk()` and synchronous top-surface chunk generation (`getOrCreateChunkTopSurfaceOnly` / `rebuildChunkTopSurfaceOnly` in `src/game/world.ts:7033–7080`) spike to **`3–12 ms`** routinely and **`52–60 ms`** when driving into new chunks or changing render distance.
- In non-`crossOriginIsolated` hosting (standard iframes without COOP/COEP headers), `src/game/meshWorkerPool.ts:309–348` falls back to copying **~1.3 MB `Uint8Array` per chunk** on the main thread per worker dispatch.

### Culprit #5: Multi-Substep Physics Catch-Up Bursts & `MEDIUM+` Post-FX Overhead
- **Catch-up burst amplification:** After any `30–60 ms` render/meshing stall, `VoxelWorld.step(rawDt, { maxSubsteps: 4 })` executes `2–4` fixed 60Hz substeps back-to-back in the very next frame, turning normal `0.88–1.56 ms` physics into **`5.84 – 12.21 ms`** (`65.17 ms` spike under collision), compounding the stutter.
- **`MEDIUM` preset shader compile + post-FX stall:** Switching to `MEDIUM` triggered **`35` synchronous WebGL shader compilations (`416.1 ms` freeze)**, increased visible chunks from `25` → `49` (`301,804` tris), and enabled full-resolution `COMPOSITE_POST_FRAGMENT_SHADER` (SSAO + Bloom) + 1024px PCFSoft shadow pass — pushing frames to **`77–87 ms`** on low-end GPUs.

---

## 4. `console.warn` Spike Log (Live Post-Phase 3c Session)

During a 19-second live session (`0` errors, `14–19` warnings):
- **Startup:** `Meshing slow: 471.46 ms`, `Physics slow: 108.69–189.15 ms`, `Render slow: 437.32–577.15 ms`.
- **Steady/Driving:**
  - `Render slow (> 8 ms)`: `20.4 ms`, `25.55 ms`, `34.39 ms`, `49.79 ms`, `60.07–69.50 ms`, `107.35–185.83 ms`, `664.94 ms` *(chunk batch rebuild / shader upload)*; `766.81–1031.75 ms` *(on `MEDIUM` preset switch)*.
  - `Meshing slow (> 2 ms)`: `2.13–8.27 ms` routine, spikes `11.87 ms`, `52.18–60.00 ms`.
  - `Physics slow (> 4 ms)`: `5.42 ms`, `12.28 ms`, `65.17 ms` *(post-stall catch-up bursts)*.

---

## 5. Adaptive Frame Rate Cap Verification Summary

Verified via 9 automated unit tests (`src/game/frameRateCap.test.ts` — **9/9 passing**) and live Playwright verification (`verify_fps_cap_ui.png`):
- **Hardware Tier Auto-Detection:**
  - `LOW` (`30 FPS`): Pentium, Celeron, Intel HD/UHD 600–610, SwiftShader/software GPU, `≤ 2` CPU cores, or `< 4GB` RAM on mobile/integrated hardware.
  - `MEDIUM` (`60 FPS`): Mid-range desktop iGPUs (Intel Iris Xe, AMD Radeon iGPU) and mid-range mobile (e.g., MediaTek Dimensity 6300 / Mali-G57 MC2, Adreno 6xx).
  - `HIGH` (`144 FPS`): Discrete GPUs (NVIDIA GeForce/RTX/GTX/Quadro, AMD Radeon RX/Pro, Intel Arc A/B, Apple M-series) and flagship mobile (`Adreno 7xx/8xx`, `Immortalis`, `Mali-G715/720`, `Apple A15+` with `8GB+` RAM).
- **Default & Persistence:** Defaults to **`AUTO`** (never `UNCAPPED`) across all presets and fresh loads; persists manual overrides (`Auto (recommended)`, `30`, `60`, `120`, `144`, `Uncapped`) in `localStorage`.
- **60Hz Fixed Physics Invariance:** Confirmed `VoxelWorld.step` executes exact 60Hz fixed steps (`2× 1/60s` substeps per `30 FPS` render frame) with identical gravity trajectory to 60 FPS, and `FrameGovernor` respects `targetFpsCap` so steady 30 FPS does not trigger false slow-motion (`timeScale = 1.0`).

---

## 6. Prioritized Fix Roadmap to Eliminate FPS Drops & Unlock 120–144 FPS (on High-Hz Displays)

1. **Fix `renderChunkBatch()` Frustum-Change Thrashing (Eliminates `60–185 ms` camera-turn spikes):**
   - Stop rebuilding one giant merged VBO whenever 1 chunk enters/leaves the camera frustum. Instead, keep per-chunk GPU buffers (only 25–49 draw calls with cached programs + cached VAOs — ~`0.3 ms` CPU) **or** use `gl.multiDrawElements` / fixed slot sub-buffer updates (`gl.bufferSubData` only for dirty chunks, never copying all 25 chunks on camera rotation).
2. **Merge / Instance the `339` Tiny `Group::Mesh[ShaderMaterial]` Meshes & `21` Blob Shadows (Drops Draw Calls from `351` → `< 60`):**
   - Merge static voxel modules per vehicle/entity into a single `BufferGeometry`, instance repeated wheels/props/hazards, and batch the 21 blob-shadow quads into 1 `InstancedMesh`. This cuts CPU draw-call overhead by **~5×** and stops ANGLE command-queue stalls (`21–42 ms`).
3. **Isolate HUD State Out of Monolithic `App.tsx` (Eliminates `47.9 ms` periodic `other` spikes):**
   - Move `hud` state updates (`syncHudNow`) into a small memoized `<HudOverlay />` component (or direct `ref.textContent` updates like `fpsBadgeRef`) so `180 ms` HUD ticks never re-render the 19,690-line `App` tree.
4. **Cap Per-Frame Worker Buffer Uploads & Pre-Warm Shaders:**
   - Limit `applyWorkerPayloadToChunk` to **1 chunk per frame** with an explicit `<= 2 ms` budget, and pre-compile `MEDIUM` shader variants asynchronously (`KHR_parallel_shader_compile` / spread across idle frames) to eliminate `416 ms` preset-switch freezes.
5. **To Exceed 60 FPS on Capable Hardware (`120 / 144 / Uncapped`):**
   - Ensure the physical display & OS are set to `120Hz`/`144Hz` (and Android/Chrome Adaptive Refresh Rate is not forcing 60Hz), keep total CPU+GPU frame time `< 8.33 ms` via fixes #1–#3 above, and select `Auto (HIGH = 144 FPS)` or `120` / `144` / `Uncapped` in Graphics Settings.
