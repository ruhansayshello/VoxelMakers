import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BufferGeometry,
  ChunkBatchRenderer,
  Color,
  createVoxelPotatoMaterial,
  Float32BufferAttribute,
  GPUChunkCuller,
  Int8BufferAttribute,
  Matrix4,
  Object3D,
  Scene,
  setVoxelMaterialPaletteEntry,
  Sphere,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
  Vector4,
  VOXEL_MAT_DEFAULT,
  VOXEL_MAT_GLASS,
  VOXEL_MAT_GRASS,
  VOXEL_MAT_METAL,
  VOXEL_MAT_PALETTE_SIZE,
  VOXEL_MAT_STONE,
  VOXEL_POTATO_FRAGMENT_SHADER,
  VOXEL_POTATO_VERTEX_SHADER,
  WebGLRenderer,
  type BatchableChunk,
  type RenderCameraLike,
} from '../index';

interface GLCallRecord {
  fn: string;
  args: unknown[];
}

function createMockWebGL2Context() {
  const calls: GLCallRecord[] = [];
  let nextId = 1;
  const programUniforms = new Map<object, Array<{ name: string; type: number; size: number }>>();
  const programAttribs = new Map<object, Array<{ name: string; type: number; size: number }>>();

  // Transform feedback simulation state for GPUChunkCuller
  let uploadedSpheres = new Float32Array(0);
  let uploadedPlanes = new Float32Array(24);
  let tfResult = new Float32Array(0);
  let tfActive = false;

  const record = (fn: string, ...args: unknown[]) => {
    calls.push({ fn, args });
  };

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ACTIVE_UNIFORMS: 0x8b86,
    ACTIVE_ATTRIBUTES: 0x8b89,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    TRANSFORM_FEEDBACK: 0x8e22,
    TRANSFORM_FEEDBACK_BUFFER: 0x8c8e,
    SEPARATE_ATTRIBS: 0x8c8d,
    RASTERIZER_DISCARD: 0x8c89,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    DYNAMIC_READ: 0x88e9,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    SHORT: 0x1402,
    UNSIGNED_INT: 0x1405,
    INT: 0x1404,
    BYTE: 0x1400,
    UNSIGNED_BYTE: 0x1401,
    FLOAT_VEC2: 0x8b50,
    FLOAT_VEC3: 0x8b51,
    FLOAT_VEC4: 0x8b52,
    FLOAT_MAT2: 0x8b5a,
    FLOAT_MAT3: 0x8b5b,
    FLOAT_MAT4: 0x8b5c,
    SAMPLER_2D: 0x8b5e,
    TRIANGLES: 0x0004,
    LINES: 0x0001,
    POINTS: 0x0000,
    BLEND: 0x0be2,
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    SCISSOR_TEST: 0x0c11,
    POLYGON_OFFSET_FILL: 0x8037,
    BACK: 0x0405,
    FRONT: 0x0404,
    FRONT_AND_BACK: 0x0408,
    CW: 0x0900,
    CCW: 0x0901,
    LEQUAL: 0x0203,
    LESS: 0x0201,
    FUNC_ADD: 0x8006,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    STENCIL_BUFFER_BIT: 0x0400,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    CLAMP_TO_EDGE: 0x812f,
    LINEAR: 0x2601,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    FRAMEBUFFER: 0x8d40,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_CUBE_MAP_TEXTURE_SIZE: 0x851c,
    MAX_VERTEX_ATTRIBS: 0x8869,
    MAX_VERTEX_UNIFORM_VECTORS: 0x8dfb,
    MAX_VARYING_VECTORS: 0x8dfc,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd,
    MAX_SAMPLES: 0x8d57,

    getParameter(pname: number) {
      if (pname === 0x0d33) return 8192;
      if (pname === 0x8869) return 16;
      if (pname === 0x8872) return 16;
      return 32;
    },
    getExtension() {
      return null;
    },
    getContextAttributes() {
      return { alpha: false, depth: true, stencil: true, antialias: false };
    },
    createShader(type: number) {
      const s = { _id: nextId++, type, source: '' };
      record('createShader', type);
      return s;
    },
    shaderSource(shader: { source: string }, source: string) {
      shader.source = source;
    },
    compileShader() {
      record('compileShader');
    },
    getShaderParameter(_s: object, pname: number) {
      return pname === 0x8b81 ? true : null;
    },
    getShaderInfoLog() {
      return '';
    },
    deleteShader() {},
    createProgram() {
      const p = { _id: nextId++, shaders: [] as Array<{ source: string }> };
      record('createProgram');
      return p;
    },
    attachShader(program: { shaders: Array<{ source: string }> }, shader: { source: string }) {
      program.shaders.push(shader);
    },
    transformFeedbackVaryings(program: object, varyings: string[], bufferMode: number) {
      record('transformFeedbackVaryings', program, varyings, bufferMode);
    },
    linkProgram(program: { shaders: Array<{ source: string }> }) {
      record('linkProgram');
      const combined = program.shaders.map((s) => s.source).join('\n');
      const uniforms: Array<{ name: string; type: number; size: number }> = [
        { name: 'projectionMatrix', type: 0x8b5c, size: 1 },
        { name: 'viewMatrix', type: 0x8b5c, size: 1 },
        { name: 'modelMatrix', type: 0x8b5c, size: 1 },
        { name: 'modelViewMatrix', type: 0x8b5c, size: 1 },
        { name: 'normalMatrix', type: 0x8b5b, size: 1 },
        { name: 'cameraPosition', type: 0x8b51, size: 1 },
      ];
      if (combined.includes('uMatColors')) {
        uniforms.push(
          { name: 'uMatColors[0]', type: 0x8b51, size: VOXEL_MAT_PALETTE_SIZE },
          { name: 'uMatProps[0]', type: 0x8b52, size: VOXEL_MAT_PALETTE_SIZE },
          { name: 'uLightDir', type: 0x8b51, size: 1 },
          { name: 'uSunTint', type: 0x8b51, size: 1 },
          { name: 'uShadowTint', type: 0x8b51, size: 1 },
          { name: 'uRimColor', type: 0x8b51, size: 1 },
          { name: 'uRimIntensity', type: 0x1406, size: 1 },
          { name: 'uFogEnabled', type: 0x1406, size: 1 },
          { name: 'uFogColor', type: 0x8b51, size: 1 },
          { name: 'uFogNear', type: 0x1406, size: 1 },
          { name: 'uFogFar', type: 0x1406, size: 1 },
          { name: 'uEnableGpuLod', type: 0x1406, size: 1 },
          { name: 'uLodDistances', type: 0x8b50, size: 1 },
        );
      }
      programUniforms.set(program, uniforms);

      const attribs: Array<{ name: string; type: number; size: number }> = [
        { name: 'position', type: 0x8b51, size: 1 },
        { name: 'normal', type: 0x8b51, size: 1 },
        { name: 'color', type: 0x8b51, size: 1 },
      ];
      if (combined.includes('voxelMaterial')) {
        attribs.push({ name: 'voxelMaterial', type: 0x1406, size: 1 });
      }
      if (combined.includes('lodLevel')) {
        attribs.push({ name: 'lodLevel', type: 0x1406, size: 1 });
      }
      programAttribs.set(program, attribs);
    },
    getProgramParameter(program: object, pname: number) {
      if (pname === 0x8b82) return true;
      if (pname === 0x8b86) return (programUniforms.get(program) ?? []).length;
      if (pname === 0x8b89) return (programAttribs.get(program) ?? []).length;
      return 0;
    },
    getProgramInfoLog() {
      return '';
    },
    getActiveUniform(program: object, idx: number) {
      return (programUniforms.get(program) ?? [])[idx] ?? null;
    },
    getUniformLocation(_program: object, name: string) {
      return { name };
    },
    getActiveAttrib(program: object, idx: number) {
      return (programAttribs.get(program) ?? [])[idx] ?? null;
    },
    getAttribLocation(program: object, name: string) {
      const list = programAttribs.get(program) ?? [];
      return list.findIndex((a) => a.name === name);
    },
    deleteProgram() {},
    useProgram(program: object | null) {
      record('useProgram', program);
    },
    enable(cap: number) {
      record('enable', cap);
    },
    disable(cap: number) {
      record('disable', cap);
    },
    blendEquation() {},
    blendEquationSeparate() {},
    blendFunc() {},
    blendFuncSeparate() {},
    depthMask() {},
    depthFunc() {},
    colorMask() {},
    cullFace() {},
    frontFace() {},
    polygonOffset() {},
    lineWidth() {},
    viewport() {},
    scissor() {},
    clearColor() {},
    clearDepth() {},
    clearStencil() {},
    clear() {},
    createBuffer() {
      const b = { _id: nextId++ };
      record('createBuffer', b._id);
      return b;
    },
    deleteBuffer(b: object) {
      record('deleteBuffer', b);
    },
    bindBuffer(target: number, buffer: object | null) {
      record('bindBuffer', target, buffer);
    },
    bindBufferBase(target: number, index: number, buffer: object | null) {
      record('bindBufferBase', target, index, buffer);
    },
    bufferData(target: number, dataOrSize: ArrayBufferView | number, usage: number) {
      record('bufferData', target, usage);
    },
    bufferSubData(target: number, offset: number, data: ArrayBufferView) {
      record('bufferSubData', target, offset, data.byteLength);
      if (target === 0x8892 && data instanceof Float32Array) {
        uploadedSpheres = new Float32Array(data);
      }
    },
    createVertexArray() {
      const vao = { _id: nextId++ };
      record('createVertexArray', vao._id);
      return vao;
    },
    deleteVertexArray(vao: object) {
      record('deleteVertexArray', vao);
    },
    bindVertexArray(vao: object | null) {
      record('bindVertexArray', vao);
    },
    enableVertexAttribArray() {},
    disableVertexAttribArray() {},
    vertexAttribPointer() {},
    vertexAttribDivisor() {},
    createTransformFeedback() {
      const tf = { _id: nextId++ };
      record('createTransformFeedback', tf._id);
      return tf;
    },
    deleteTransformFeedback(tf: object) {
      record('deleteTransformFeedback', tf);
    },
    bindTransformFeedback(target: number, tf: object | null) {
      record('bindTransformFeedback', target, tf);
    },
    beginTransformFeedback(mode: number) {
      tfActive = true;
      record('beginTransformFeedback', mode);
    },
    endTransformFeedback() {
      tfActive = false;
      record('endTransformFeedback');
    },
    getBufferSubData(target: number, _offset: number, dst: Float32Array) {
      record('getBufferSubData', target, dst.length);
      dst.set(tfResult.subarray(0, dst.length));
    },
    drawArrays(mode: number, first: number, count: number) {
      record('drawArrays', mode, first, count);
      if (tfActive && mode === 0x0000) {
        // Execute the exact same frustum sphere shader math as TF_CULL_VERTEX_SHADER
        tfResult = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const sx = uploadedSpheres[i * 4];
          const sy = uploadedSpheres[i * 4 + 1];
          const sz = uploadedSpheres[i * 4 + 2];
          const sr = uploadedSpheres[i * 4 + 3];
          let vis = 1.0;
          for (let p = 0; p < 6; p++) {
            const nx = uploadedPlanes[p * 4];
            const ny = uploadedPlanes[p * 4 + 1];
            const nz = uploadedPlanes[p * 4 + 2];
            const c = uploadedPlanes[p * 4 + 3];
            if (nx * sx + ny * sy + nz * sz + c < -sr) {
              vis = 0.0;
            }
          }
          tfResult[i] = vis;
        }
      }
    },
    drawElements(mode: number, count: number, type: number, offset: number) {
      record('drawElements', mode, count, type, offset);
    },
    drawArraysInstanced() {},
    drawElementsInstanced() {},
    uniform1f(loc: { name: string }, v: number) {
      record('uniform1f', loc?.name, v);
    },
    uniform1i(loc: { name: string }, v: number) {
      record('uniform1i', loc?.name, v);
    },
    uniform2f(loc: { name: string }, x: number, y: number) {
      record('uniform2f', loc?.name, x, y);
    },
    uniform2fv(loc: { name: string }, v: Float32Array | number[]) {
      record('uniform2fv', loc?.name, v.length);
    },
    uniform3f(loc: { name: string }, x: number, y: number, z: number) {
      record('uniform3f', loc?.name, x, y, z);
    },
    uniform3fv(loc: { name: string }, v: Float32Array | number[]) {
      record('uniform3fv', loc?.name, v.length);
    },
    uniform4f(loc: { name: string }, x: number, y: number, z: number, w: number) {
      record('uniform4f', loc?.name, x, y, z, w);
    },
    uniform4fv(loc: { name: string }, v: Float32Array | number[]) {
      record('uniform4fv', loc?.name, v.length);
      if (loc?.name === 'uFrustumPlanes[0]') {
        uploadedPlanes = new Float32Array(v);
      }
    },
    uniformMatrix3fv(loc: { name: string }) {
      record('uniformMatrix3fv', loc?.name);
    },
    uniformMatrix4fv(loc: { name: string }) {
      record('uniformMatrix4fv', loc?.name);
    },
    bindFramebuffer() {},
    activeTexture() {},
    bindTexture() {},
  };

  const canvas = {
    width: 800,
    height: 600,
    style: { width: '', height: '' },
    getContext(kind: string) {
      return kind === 'webgl2' ? gl : null;
    },
  };

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    canvas: canvas as unknown as HTMLCanvasElement,
    calls,
  };
}

function createCameraLookingNegZ(): RenderCameraLike {
  const cam = new Object3D() as RenderCameraLike;
  cam.position.set(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse = new Matrix4().copy(cam.matrixWorld).invert();
  cam.projectionMatrix = new Matrix4().makePerspective(-1, 1, 1, -1, 1, 600);
  return cam;
}

/** Creates a lightweight indexed voxel quad chunk (4 verts, 6 indices). */
function createMockChunk(
  id: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  matId: number = VOXEL_MAT_GRASS,
  lodLevel = 0,
): BatchableChunk {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      new Float32Array([
        0, 0, 0,
        2, 0, 0,
        2, 2, 0,
        0, 2, 0,
      ]),
      3,
    ),
  );
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute(
      new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
      ]),
      3,
    ),
  );
  geometry.setAttribute(
    'color',
    new Float32BufferAttribute(
      new Float32Array([
        1, 1, 1,
        0.9, 0.9, 0.9,
        0.8, 0.8, 0.8,
        1, 1, 1,
      ]),
      3,
    ),
  );
  geometry.setAttribute(
    'voxelMaterial',
    new Int8BufferAttribute(new Int8Array([matId, matId, matId, matId]), 1),
  );
  geometry.setAttribute(
    'lodLevel',
    new Int8BufferAttribute(new Int8Array([lodLevel, lodLevel, lodLevel, lodLevel]), 1),
  );
  geometry.setIndex(new Uint16BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geometry.computeBoundingSphere();

  return {
    id,
    geometry,
    position: { x: worldX, y: worldY, z: worldZ },
    boundingSphere: new Sphere(new Vector3(worldX + 1, worldY + 1, worldZ), 2),
    visible: true,
    defaultMaterialId: matId,
    lodLevel,
  };
}

test('ChunkBatchRenderer merges 200 visible chunks into ONE draw call and caches across unchanged frames', () => {
  const { canvas, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ canvas });
  const scene = new Scene();
  const camera = createCameraLookingNegZ();

  const batch = new ChunkBatchRenderer({ maxVertexCount: 4096, maxIndexCount: 8192 });

  // 200 chunks in front of camera (inside frustum, z from -20 to -418)
  const visibleExpected: BatchableChunk[] = [];
  for (let i = 0; i < 200; i++) {
    const col = (i % 10) - 4.5;
    const row = Math.floor(i / 10);
    const chunk = createMockChunk(i, col * 3, 0, -25 - row * 12, (i % 6) + 1, i % 3);
    visibleExpected.push(chunk);
    batch.addChunk(chunk);
  }

  // 20 chunks behind camera (z = +50..+150 -> frustum culled)
  for (let i = 0; i < 20; i++) {
    batch.addChunk(createMockChunk(200 + i, 0, 0, 50 + i * 5, VOXEL_MAT_STONE, 0));
  }

  assert.equal(batch.chunks.length, 220);
  assert.equal(batch.dirty, true);

  // Frame 1: culls 20 off-screen chunks, merges 200 visible chunks, issues 1 draw call
  renderer.info.reset();
  const visibleCount1 = batch.update(null, camera, renderer, scene);

  assert.equal(visibleCount1, 200);
  assert.equal(batch.visibleChunks.length, 200);
  assert.equal(batch.mergedVertexCount, 200 * 4);
  assert.equal(batch.mergedIndexCount, 200 * 6);
  assert.equal(batch.mergedGeometry.drawRange.start, 0);
  assert.equal(batch.mergedGeometry.drawRange.count, 200 * 6);
  assert.equal(batch.mergeCount, 1);
  assert.equal(batch.dirty, false);
  assert.equal(batch.drawCallsLastFrame, 1);
  assert.equal(renderer.info.render.calls, 1);

  // Verify drawElements was called exactly ONCE for all 200 chunks (1200 indices)
  const drawCallsFrame1 = calls.filter((c) => c.fn === 'drawElements');
  assert.equal(drawCallsFrame1.length, 1);
  assert.equal(drawCallsFrame1[0].args[1], 200 * 6);

  // Verify baked world position & offset indices for chunk #5
  const posArr = batch.mergedGeometry.attributes.position.array;
  const idxArr = batch.mergedGeometry.index!.array;
  const matArr = batch.mergedGeometry.attributes.voxelMaterial.array;
  const lodArr = batch.mergedGeometry.attributes.lodLevel.array;

  const chunk5 = visibleExpected[5];
  const vBase5 = 5 * 4;
  assert.equal(posArr[vBase5 * 3], chunk5.position!.x);
  assert.equal(posArr[vBase5 * 3 + 1], chunk5.position!.y);
  assert.equal(posArr[vBase5 * 3 + 2], chunk5.position!.z);
  assert.equal(posArr[(vBase5 + 1) * 3], chunk5.position!.x + 2);

  // Chunk 5 indices must be offset by vBase5 = 20 -> [20, 21, 22, 20, 22, 23]
  const iBase5 = 5 * 6;
  assert.deepEqual(
    Array.from(idxArr.subarray(iBase5, iBase5 + 6)),
    [20, 21, 22, 20, 22, 23],
  );
  assert.equal(matArr[vBase5], (5 % 6) + 1);
  assert.equal(lodArr[vBase5], 5 % 3);

  // Snapshot GPU allocations after Frame 1
  const buffersAfterFrame1 = calls.filter((c) => c.fn === 'createBuffer').length;
  const vaosAfterFrame1 = calls.filter((c) => c.fn === 'createVertexArray').length;

  // Frame 2 & Frame 3: unchanged camera and chunks -> ZERO re-merges, ZERO new VBOs/VAOs, 1 draw call
  renderer.info.reset();
  batch.update(null, camera, renderer, scene);
  assert.equal(batch.mergeCount, 1);
  assert.equal(renderer.info.render.calls, 1);

  renderer.info.reset();
  batch.update(null, camera, renderer, scene);
  assert.equal(batch.mergeCount, 1);
  assert.equal(renderer.info.render.calls, 1);

  assert.equal(calls.filter((c) => c.fn === 'createBuffer').length, buffersAfterFrame1);
  assert.equal(calls.filter((c) => c.fn === 'createVertexArray').length, vaosAfterFrame1);

  // Frame 4: markDirty (e.g. voxel block destroyed inside a chunk) -> triggers re-merge
  batch.markDirty();
  renderer.info.reset();
  batch.update(null, camera, renderer, scene);
  assert.equal(batch.mergeCount, 2);
  assert.equal(batch.dirty, false);
  assert.equal(renderer.info.render.calls, 1);

  // Frame 5: remove a visible chunk -> triggers re-merge with 199 chunks
  const removed = batch.removeChunk(visibleExpected[0]);
  assert.equal(removed, true);
  renderer.info.reset();
  batch.update(null, camera, renderer, scene);
  assert.equal(batch.visibleChunks.length, 199);
  assert.equal(batch.mergedVertexCount, 199 * 4);
  assert.equal(batch.mergedIndexCount, 199 * 6);
  assert.equal(batch.mergeCount, 3);
  assert.equal(renderer.info.render.calls, 1);

  batch.dispose();
  renderer.dispose();
});

test('VoxelPotatoShader configures 7-material uniform palette, vertex attributes, and GPU LOD uniforms', () => {
  const material = createVoxelPotatoMaterial({
    enableGpuLod: true,
    lodDistances: new Vector2(80, 180),
    fogEnabled: true,
    fogNear: 60,
    fogFar: 320,
  });

  assert.equal(material.isVoxelMaterial, true);
  assert.equal(material.vertexColors, true);
  assert.equal(material.uniforms.uEnableGpuLod.value, 1.0);
  assert.equal((material.uniforms.uLodDistances.value as Vector2).x, 80);
  assert.equal((material.uniforms.uLodDistances.value as Vector2).y, 180);

  const colors = material.uniforms.uMatColors.value as Color[];
  const props = material.uniforms.uMatProps.value as Vector4[];
  assert.equal(colors.length, VOXEL_MAT_PALETTE_SIZE);
  assert.equal(props.length, VOXEL_MAT_PALETTE_SIZE);

  // Default glass entry has translucent alpha < 1.0 and metal has high hardness
  assert.ok(props[VOXEL_MAT_METAL].x > 0.9);
  assert.ok(props[VOXEL_MAT_GLASS].w < 1.0);
  assert.equal(props[VOXEL_MAT_DEFAULT].w, 1.0);

  // Mutate palette entry via helper
  material.uniformsNeedUpdate = false;
  setVoxelMaterialPaletteEntry(material, VOXEL_MAT_GRASS, 0x33cc55, 0.35, 0.85, 1.2, 1.0);
  assert.equal(material.uniformsNeedUpdate, true);
  assert.equal(colors[VOXEL_MAT_GRASS].getHex(), 0x33cc55);
  assert.equal(props[VOXEL_MAT_GRASS].x, 0.35);
  assert.equal(props[VOXEL_MAT_GRASS].y, 0.85);
  assert.equal(props[VOXEL_MAT_GRASS].z, 1.2);

  // Verify shader source includes material palette lookup and GPU LOD vertex culling
  assert.ok(VOXEL_POTATO_VERTEX_SHADER.includes('attribute float voxelMaterial'));
  assert.ok(VOXEL_POTATO_VERTEX_SHADER.includes('attribute float lodLevel'));
  assert.ok(VOXEL_POTATO_VERTEX_SHADER.includes('uEnableGpuLod'));
  assert.ok(VOXEL_POTATO_FRAGMENT_SHADER.includes('uMatColors[7]'));
  assert.ok(VOXEL_POTATO_FRAGMENT_SHADER.includes('uMatProps[7]'));

  material.dispose();
});

test('GPUChunkCuller evaluates chunk visibility via WebGL2 Transform Feedback and matches CPU fallback', () => {
  const { gl, calls } = createMockWebGL2Context();
  const camera = createCameraLookingNegZ();

  const spheres: Sphere[] = [
    new Sphere(new Vector3(0, 0, -30), 8),   // clearly inside frustum
    new Sphere(new Vector3(5, -2, -120), 8), // clearly inside frustum
    new Sphere(new Vector3(0, 0, 40), 8),    // behind camera -> culled
    new Sphere(new Vector3(500, 0, -20), 4), // far outside right plane -> culled
  ];

  // GPU Transform Feedback path
  const gpuCuller = new GPUChunkCuller(gl, 64);
  assert.equal(gpuCuller.isGPUActive, true);
  const gpuVis = gpuCuller.cullSpheres(spheres, camera);
  assert.deepEqual(Array.from(gpuVis), [1, 1, 0, 0]);

  // Verify transform feedback GL calls were issued
  assert.ok(calls.some((c) => c.fn === 'transformFeedbackVaryings'));
  assert.ok(calls.some((c) => c.fn === 'beginTransformFeedback'));
  assert.ok(calls.some((c) => c.fn === 'endTransformFeedback'));
  assert.ok(calls.some((c) => c.fn === 'getBufferSubData'));

  // Automatic CPU fallback path (gl = null)
  const cpuCuller = new GPUChunkCuller(null, 64);
  assert.equal(cpuCuller.isGPUActive, false);
  const cpuVis = cpuCuller.cullSpheres(spheres, camera);
  assert.deepEqual(Array.from(cpuVis), [1, 1, 0, 0]);

  gpuCuller.dispose();
  cpuCuller.dispose();
});
