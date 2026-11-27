import * as THREE from 'three';
import {
  MAT,
  MAT_INFO,
  BUILD_SLOTS,
  OBJECT_STUDIO_SLOTS,
  type BuildSlotItem,
  type ModuleKind,
} from './constants.ts';
import {
  createDetailedModuleMesh,
  getMachinedMetalMat,
  getEmissiveNeonMat,
} from './models.ts';
import type { ActiveModule } from './vehicle.ts';

export interface HotbarPreviewSlotTarget {
  el: HTMLElement | null;
  itemKey: string;
  isHovered?: boolean;
  isSelected?: boolean;
}

const _tmpClearColor = new THREE.Color();
const _scrollParentCache = new WeakMap<HTMLElement, HTMLElement | null>();
const _scrollRectCache = new Map<HTMLElement, DOMRect>();
const _slotRectCache = new WeakMap<
  HTMLElement,
  {
    rect: DOMRect;
    ts: number;
    scrollTop: number;
    scrollLeft: number;
    canvasW: number;
    canvasH: number;
  }
>();

interface ResolvedPreviewSlot {
  itemKey: string;
  left: number;
  bottom: number;
  width: number;
  height: number;
  scissorLeft: number;
  scissorBottom: number;
  scissorWidth: number;
  scissorHeight: number;
}
const _resolvedSlotsScratch: ResolvedPreviewSlot[] = [];
const _resolvedSlotsPool: ResolvedPreviewSlot[] = [];

/**
 * High-performance, zero-lag 3D rotating preview renderer for the Build Mode hotbar/inventory.
 *
 * CRITICAL PERFORMANCE DESIGN:
 * - Uses a SINGLE shared Three.js WebGLRenderer via scissor testing (`renderer.setScissorTest(true)`).
 * - Never spawns multiple WebGLRenderers or per-slot canvases.
 * - Renders all on-screen hotbar slots in <0.5ms batch per frame.
 * - When Build Mode is closed, consumes 0 GPU cycles.
 */
export class BuildPreviewRenderer {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  private itemMeshes: Map<string, THREE.Group> = new Map();
  private rotationSpeeds: Map<string, number> = new Map();
  private slotItemLookup: Map<string, BuildSlotItem> = new Map();

  // Reusable scratch variables to avoid GC allocations during the 60fps render loop
  private originalViewport = new THREE.Vector4();
  private originalScissor = new THREE.Vector4();
  private readonly cameraDir = new THREE.Vector3(0, 0.65, 2.05).normalize();

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.name = 'BuildPreviewScene';

    // 20-degree downward isometric perspective camera
    this.camera = new THREE.PerspectiveCamera(38, 1.0, 0.1, 50);
    this.camera.position.set(0, 0.65, 2.05);
    this.camera.lookAt(0, 0, 0);

    // Dedicated studio lighting for crisp mechanical depth and specular highlights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    const mainDirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    mainDirLight.position.set(3, 4.5, 3.5);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    rimLight.position.set(-3, -1.5, -2.5);

    this.scene.add(ambientLight, mainDirLight, rimLight);

    // Index default build slots & object studio slots
    for (const slot of BUILD_SLOTS) {
      const key = this.getItemKey(slot);
      this.slotItemLookup.set(key, slot);
    }
    for (const slot of OBJECT_STUDIO_SLOTS) {
      const key = this.getItemKey(slot);
      if (!this.slotItemLookup.has(key)) {
        this.slotItemLookup.set(key, slot);
      }
    }
  }

  /**
   * Generates a stable unique key for a slot item.
   */
  public getItemKey(item: BuildSlotItem): string {
    if (item.type === 'voxel' && item.mat !== undefined) {
      return `vox_${item.mat}`;
    }
    if (item.type === 'module' && item.kind) {
      return `mod_${item.kind}`;
    }
    return `slot_${item.slot}`;
  }

  /**
   * Pre-generates 3D models for all slots so the first frame of Build Mode opens instantly with 0 lag.
   */
  public prewarm(slots: BuildSlotItem[] = BUILD_SLOTS): void {
    for (const slot of slots) {
      const key = this.getItemKey(slot);
      this.slotItemLookup.set(key, slot);
      this.getOrCreatePreviewMesh(key, slot);
    }
  }

  public registerSlotItems(slots: BuildSlotItem[]): void {
    for (const slot of slots) {
      const key = this.getItemKey(slot);
      this.slotItemLookup.set(key, slot);
    }
  }

  /**
   * Retrieves or builds the 3D stylized low-poly model for a given item key,
   * centered strictly at (0, 0, 0) with its Box3 bounding sphere radius computed
   * so the camera auto-fits every part to ~75% of the preview slot.
   */
  public getOrCreatePreviewMesh(key: string, item?: BuildSlotItem): THREE.Group {
    if (item) {
      this.slotItemLookup.set(key, item);
    }
    let group = this.itemMeshes.get(key);
    if (group) return group;

    let slotItem = item || this.slotItemLookup.get(key);
    if (!slotItem && key.startsWith('vox_')) {
      const parsedMat = parseInt(key.slice(4), 10);
      const info = !isNaN(parsedMat) ? MAT_INFO[parsedMat] : undefined;
      if (!isNaN(parsedMat)) {
        const hexColor = info ? info.color : 0x38bdf8;
        slotItem = {
          slot: 0,
          key: '',
          type: 'voxel',
          name: info ? info.name : `Voxel #${parsedMat}`,
          tag: 'VOXEL',
          category: 'CHASSIS',
          mat: parsedMat,
          massKg: info ? info.mass : 10,
          powerCores: 0,
          color: `#${hexColor.toString(16).padStart(6, '0')}`,
        };
      }
    } else if (!slotItem && key.startsWith('mod_')) {
      const parsedKind = key.slice(4) as ModuleKind;
      slotItem = {
        slot: 0,
        key: '',
        type: 'module',
        name: parsedKind,
        tag: 'MODULE',
        category: 'PROPULSION',
        kind: parsedKind,
        massKg: 10,
        powerCores: 1,
        color: '#38bdf8',
      };
    }
    group = new THREE.Group();
    group.name = `Preview_${key}`;

    if (slotItem?.type === 'voxel' && slotItem.mat !== undefined) {
      // 3D Beveled Voxel Cube Preview with Edge Accents
      const fallbackHex = slotItem.color
        ? parseInt(slotItem.color.replace('#', ''), 16) || 0x38bdf8
        : 0x38bdf8;
      const matSpec = MAT_INFO[slotItem.mat] || {
        color: fallbackHex,
        emissive: false,
      };
      const boxGeo = new THREE.BoxGeometry(0.84, 0.84, 0.84);
      const boxMat = matSpec.emissive
        ? getEmissiveNeonMat(matSpec.color, 2.0)
        : getMachinedMetalMat(matSpec.color, 0.35, 0.65);

      const cube = new THREE.Mesh(boxGeo, boxMat);
      const edgeGeo = new THREE.EdgesGeometry(boxGeo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.32,
      });
      const edges = new THREE.LineSegments(edgeGeo, edgeMat);
      group.add(cube, edges);

      const bbox = new THREE.Box3().setFromObject(group);
      const sphere = new THREE.Sphere();
      bbox.getBoundingSphere(sphere);
      group.userData.boundingRadius = Math.max(sphere.radius, 0.35);
    } else if (slotItem?.type === 'module' && slotItem.kind) {
      // High-Detail Stylized Mechanical Module Model (vx = 12 centers wheel assemblies on symmetry axis)
      const mockMod: ActiveModule = {
        kind: slotItem.kind as ModuleKind,
        vx: 12,
        vy: 0,
        vz: 0,
        yawIdx: 0,
        pitchIdx: 0,
        rollIdx: 0,
        mesh: null,
        wheelMesh: null,
        spinMesh: null,
        lastCompression: 0,
      };

      const detailedMesh = createDetailedModuleMesh(mockMod, false);
      if (slotItem.kind === 'PARACHUTE_AIRBRAKE' && mockMod.spinMesh) {
        mockMod.spinMesh.scale.set(0.85, 0.72, 0.85);
        mockMod.spinMesh.updateMatrix();
      } else if (slotItem.kind === 'PISTON' && mockMod.spinMesh) {
        mockMod.spinMesh.position.y = -0.32;
        mockMod.spinMesh.updateMatrix();
      } else if (slotItem.kind === 'OUTRIGGER_JACK' && mockMod.spinMesh) {
        mockMod.spinMesh.position.y = -0.25;
        mockMod.spinMesh.updateMatrix();
      }
      detailedMesh.traverse((child) => {
        child.frustumCulled = false;
      });
      detailedMesh.updateMatrixWorld(true);

      // Compute exact bounding box and center geometry cleanly around (0, 0, 0)
      const bbox = new THREE.Box3().setFromObject(detailedMesh);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      detailedMesh.position.sub(center);
      detailedMesh.updateMatrix();
      detailedMesh.updateMatrixWorld(true);

      const centeredBox = new THREE.Box3().setFromObject(detailedMesh);
      const sphere = new THREE.Sphere();
      centeredBox.getBoundingSphere(sphere);

      group.add(detailedMesh);
      group.userData.boundingRadius = Math.max(
        Number.isFinite(sphere.radius) ? sphere.radius : 0.65,
        0.25,
      );
    } else {
      // Fallback mechanical block
      const fallbackGeo = new THREE.BoxGeometry(0.84, 0.84, 0.84);
      const fallbackMat = getMachinedMetalMat(0x38bdf8, 0.4, 0.6);
      group.add(new THREE.Mesh(fallbackGeo, fallbackMat));
      group.userData.boundingRadius = 0.72;
    }

    group.visible = false;
    this.scene.add(group);
    this.itemMeshes.set(key, group);
    this.rotationSpeeds.set(key, 0.55);
    return group;
  }

  /**
   * High-Performance Scissor Render Loop.
   * Renders all visible hotbar slots on the shared WebGLRenderer using scissor testing.
   */
  public renderHotbarPreviews(
    renderer: THREE.WebGLRenderer,
    targets: HotbarPreviewSlotTarget[],
    _dt: number,
  ): void {
    if (!targets || targets.length === 0) return;

    const canvas = renderer.domElement;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return;

    // Scale by renderer canvas pixel ratio / buffer dimensions (strictly relative to canvas, never window.innerHeight).
    // In Three.js, renderer.setViewport and setScissor internally multiply by renderer.getPixelRatio(),
    // so we normalize by pr to ensure exact alignment with DOM client rects inside iframes or custom DPRs.
    const pr = (typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1) || 1;
    const scaleX = (canvas.width / canvasRect.width) / pr;
    const scaleY = (canvas.height / canvasRect.height) / pr;

    // Cache current viewport, scissor, and clear color state
    const originalScissorTest = renderer.getScissorTest();
    renderer.getViewport(this.originalViewport);
    renderer.getScissor(this.originalScissor);
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(_tmpClearColor);
    const originalClearAlpha = renderer.getClearAlpha();

    renderer.autoClear = false;
    renderer.setScissorTest(true);

    // Calm, slow showcase turn (~1 full rotation every 11 seconds), independent of frame rate or slot count
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const spinAngle = nowMs * 0.00055;
    const halfFovRad = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const tanHalfFov = Math.tan(halfFovRad);
    _scrollRectCache.clear();
    _resolvedSlotsScratch.length = 0;

    // PASS 1: Batch all DOM layout reads (getBoundingClientRect) BEFORE issuing any WebGL state changes
    // to prevent interleaved DOM-read / WebGL-write layout thrashing across 35+ slots per frame.
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const el = target.el;
      if (!el) continue;

      // Check if slot has a scroll container ancestor (cached in WeakMap so closest() is not called 35x per frame)
      let scrollParent = _scrollParentCache.get(el);
      if (scrollParent === undefined) {
        scrollParent = (el.closest('[data-catalog-scroll-container="true"]') ||
          el.closest('[data-ui-scroll="true"]')) as HTMLElement | null;
        _scrollParentCache.set(el, scrollParent);
      }

      const curScrollTop = scrollParent ? scrollParent.scrollTop || 0 : 0;
      const curScrollLeft = scrollParent ? scrollParent.scrollLeft || 0 : 0;
      let cachedEntry = _slotRectCache.get(el);
      let rect: DOMRect;
      if (
        cachedEntry &&
        cachedEntry.rect.width > 0 &&
        cachedEntry.rect.height > 0 &&
        nowMs > 0 &&
        nowMs - cachedEntry.ts < 32 &&
        cachedEntry.scrollTop === curScrollTop &&
        cachedEntry.scrollLeft === curScrollLeft &&
        cachedEntry.canvasW === canvasRect.width &&
        cachedEntry.canvasH === canvasRect.height
      ) {
        rect = cachedEntry.rect;
      } else {
        rect = el.getBoundingClientRect();
        if (nowMs > 0 && rect.width > 0 && rect.height > 0) {
          if (!cachedEntry) {
            cachedEntry = {
              rect,
              ts: nowMs,
              scrollTop: curScrollTop,
              scrollLeft: curScrollLeft,
              canvasW: canvasRect.width,
              canvasH: canvasRect.height,
            };
            _slotRectCache.set(el, cachedEntry);
          } else {
            cachedEntry.rect = rect;
            cachedEntry.ts = nowMs;
            cachedEntry.scrollTop = curScrollTop;
            cachedEntry.scrollLeft = curScrollLeft;
            cachedEntry.canvasW = canvasRect.width;
            cachedEntry.canvasH = canvasRect.height;
          }
        }
      }

      // Determine bounding clipping rectangle (canvas + scroll container if present)
      let clipLeft = canvasRect.left;
      let clipRight = canvasRect.right;
      let clipTop = canvasRect.top;
      let clipBottom = canvasRect.bottom;

      if (scrollParent) {
        let sRect = _scrollRectCache.get(scrollParent);
        if (!sRect) {
          sRect = scrollParent.getBoundingClientRect();
          _scrollRectCache.set(scrollParent, sRect);
        }
        clipLeft = Math.max(clipLeft, sRect.left);
        clipRight = Math.min(clipRight, sRect.right);
        clipTop = Math.max(clipTop, sRect.top);
        clipBottom = Math.min(clipBottom, sRect.bottom);
      }

      // Skip offscreen or hidden slots (e.g., scrolled outside view or collapsed)
      if (
        rect.bottom <= clipTop ||
        rect.top >= clipBottom ||
        rect.right <= clipLeft ||
        rect.left >= clipRight ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }

      // Relative coordinates inside the canvas (never use window.innerHeight!)
      const relLeft = rect.left - canvasRect.left;
      const relBottom = canvasRect.bottom - rect.bottom;

      const left = Math.round(relLeft * scaleX);
      const bottom = Math.round(relBottom * scaleY);
      const width = Math.round(rect.width * scaleX);
      const height = Math.round(rect.height * scaleY);

      if (width <= 0 || height <= 0) continue;

      // Scissor bounds clipped strictly to visible scroll container area to avoid drifting behind/over other UI panels
      const visibleLeft = Math.max(rect.left, clipLeft);
      const visibleRight = Math.min(rect.right, clipRight);
      const visibleTop = Math.max(rect.top, clipTop);
      const visibleBottom = Math.min(rect.bottom, clipBottom);

      const scissorRelLeft = visibleLeft - canvasRect.left;
      const scissorRelBottom = canvasRect.bottom - visibleBottom;
      const scissorLeft = Math.round(scissorRelLeft * scaleX);
      const scissorBottom = Math.round(scissorRelBottom * scaleY);
      const scissorWidth = Math.round((visibleRight - visibleLeft) * scaleX);
      const scissorHeight = Math.round((visibleBottom - visibleTop) * scaleY);

      if (scissorWidth <= 0 || scissorHeight <= 0) continue;

      const slotIdx = _resolvedSlotsScratch.length;
      let resolved = _resolvedSlotsPool[slotIdx];
      if (!resolved) {
        resolved = {
          itemKey: target.itemKey,
          left,
          bottom,
          width,
          height,
          scissorLeft,
          scissorBottom,
          scissorWidth,
          scissorHeight,
        };
        _resolvedSlotsPool[slotIdx] = resolved;
      } else {
        resolved.itemKey = target.itemKey;
        resolved.left = left;
        resolved.bottom = bottom;
        resolved.width = width;
        resolved.height = height;
        resolved.scissorLeft = scissorLeft;
        resolved.scissorBottom = scissorBottom;
        resolved.scissorWidth = scissorWidth;
        resolved.scissorHeight = scissorHeight;
      }
      _resolvedSlotsScratch.push(resolved);
    }

    // PASS 2: Issue pure WebGL scissor/viewport render calls without touching the DOM
    for (let i = 0; i < _resolvedSlotsScratch.length; i++) {
      const slot = _resolvedSlotsScratch[i];
      const {
        left,
        bottom,
        width,
        height,
        scissorLeft,
        scissorBottom,
        scissorWidth,
        scissorHeight,
      } = slot;

      renderer.setViewport(left, bottom, width, height);
      renderer.setScissor(scissorLeft, scissorBottom, scissorWidth, scissorHeight);

      const previewMesh = this.getOrCreatePreviewMesh(slot.itemKey);
      if (!previewMesh) continue;

      // Set rotation using elapsed time so it is always a calm, slow showcase turn
      previewMesh.rotation.set(0.22, spinAngle, 0);

      // Auto-fit camera distance based on the model's Box3 bounding sphere radius so all parts fill ~75% of the slot
      const radius = (previewMesh.userData.boundingRadius as number) || 0.72;
      const fitDist = (radius / 0.75) / tanHalfFov;
      this.camera.position.copy(this.cameraDir).multiplyScalar(fitDist);
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(0, 0, 0);

      // Show only this mesh for the current scissor slot
      previewMesh.visible = true;

      // Clear color and depth inside this slot's scissor box with transparent background (alpha = 0)
      // so the 3D rotating model renders directly in front of the UI cards
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(this.scene, this.camera);

      previewMesh.visible = false;
    }

    // Restore default camera & renderer state
    this.camera.position.set(0, 0.65, 2.05);
    this.camera.aspect = 1.0;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 0);

    renderer.setScissorTest(originalScissorTest);
    renderer.setViewport(this.originalViewport);
    renderer.setScissor(this.originalScissor);
    renderer.setClearColor(_tmpClearColor, originalClearAlpha);
    renderer.autoClear = prevAutoClear;
  }

  public dispose(): void {
    for (const group of this.itemMeshes.values()) {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry && !child.geometry.userData?.isSharedPrimitive) {
          child.geometry.dispose();
        }
      });
      this.scene.remove(group);
    }
    this.itemMeshes.clear();
    this.rotationSpeeds.clear();
    this.slotItemLookup.clear();
  }
}

// Global shared singleton for the application
let _sharedBuildPreviewRenderer: BuildPreviewRenderer | null = null;

export function getSharedBuildPreviewRenderer(): BuildPreviewRenderer {
  if (!_sharedBuildPreviewRenderer) {
    _sharedBuildPreviewRenderer = new BuildPreviewRenderer();
    // Prewarm default build slots
    if (typeof window !== 'undefined') {
      _sharedBuildPreviewRenderer.prewarm();
    }
  }
  return _sharedBuildPreviewRenderer;
}
