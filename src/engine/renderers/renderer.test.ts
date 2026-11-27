import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CullFaceBack,
  CullFaceFront,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  GLSL3,
  InstancedBufferAttribute,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  NoBlending,
  NormalBlending,
  Object3D,
  PerspectiveCamera,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type RenderCameraLike,
  type RenderTargetLike,
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

  const record = (fn: string, ...args: unknown[]) => {
    calls.push({ fn, args });
  };

  const gl = {
    // Constants
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ACTIVE_UNIFORMS: 0x8b86,
    ACTIVE_ATTRIBUTES: 0x8b89,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
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
    LINE_LOOP: 0x0002,
    LINE_STRIP: 0x0003,
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
    NEVER: 0x0200,
    LESS: 0x0201,
    EQUAL: 0x0202,
    LEQUAL: 0x0203,
    GREATER: 0x0204,
    NOTEQUAL: 0x0205,
    GEQUAL: 0x0206,
    ALWAYS: 0x0207,
    FUNC_ADD: 0x8006,
    FUNC_SUBTRACT: 0x800a,
    FUNC_REVERSE_SUBTRACT: 0x800b,
    MIN: 0x8007,
    MAX: 0x8008,
    ZERO: 0,
    ONE: 1,
    SRC_COLOR: 0x0300,
    ONE_MINUS_SRC_COLOR: 0x0301,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    DST_ALPHA: 0x0304,
    ONE_MINUS_DST_ALPHA: 0x0305,
    DST_COLOR: 0x0306,
    ONE_MINUS_DST_COLOR: 0x0307,
    SRC_ALPHA_SATURATE: 0x0308,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    STENCIL_BUFFER_BIT: 0x0400,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    TEXTURE_3D: 0x806f,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_WRAP_R: 0x8072,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    REPEAT: 0x2901,
    CLAMP_TO_EDGE: 0x812f,
    MIRRORED_REPEAT: 0x8370,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    RGBA16F: 0x881a,
    RGBA32F: 0x8814,
    RED: 0x1903,
    R8: 0x8229,
    HALF_FLOAT: 0x140b,
    FRAMEBUFFER: 0x8d40,
    RENDERBUFFER: 0x8d41,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_ATTACHMENT: 0x8d00,
    DEPTH_STENCIL_ATTACHMENT: 0x821a,
    DEPTH_COMPONENT16: 0x81a5,
    DEPTH24_STENCIL8: 0x88f0,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNPACK_ALIGNMENT: 0x0cf5,
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
    getExtension(name: string) {
      if (name === 'WEBGL_lose_context') {
        return {
          loseContext: () => record('loseContext'),
          restoreContext: () => record('restoreContext'),
        };
      }
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
      record('shaderSource');
    },
    compileShader(shader: object) {
      record('compileShader', shader);
    },
    getShaderParameter(_s: object, pname: number) {
      return pname === 0x8b81 ? true : null;
    },
    getShaderInfoLog() {
      return '';
    },
    deleteShader(shader: object) {
      record('deleteShader', shader);
    },
    createProgram() {
      const p = { _id: nextId++, shaders: [] as Array<{ source: string }> };
      record('createProgram');
      return p;
    },
    attachShader(program: { shaders: Array<{ source: string }> }, shader: { source: string }) {
      program.shaders.push(shader);
      record('attachShader');
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
        { name: 'diffuse', type: 0x8b51, size: 1 },
        { name: 'opacity', type: 0x1406, size: 1 },
        { name: 'toneMappingExposure', type: 0x1406, size: 1 },
      ];
      if (combined.includes('uniform vec3 fogColor')) {
        uniforms.push({ name: 'fogColor', type: 0x8b51, size: 1 });
        if (combined.includes('fogDensity')) {
          uniforms.push({ name: 'fogDensity', type: 0x1406, size: 1 });
        }
      }
      if (combined.includes('uniform DirectionalLight directionalLights')) {
        uniforms.push(
          { name: 'directionalLights[0].direction', type: 0x8b51, size: 1 },
          { name: 'directionalLights[0].color', type: 0x8b51, size: 1 },
        );
      }
      if (combined.includes('uniform float uTime')) {
        uniforms.push({ name: 'uTime', type: 0x1406, size: 1 });
      }
      if (combined.includes('uniform float uCurrentTime')) {
        uniforms.push({ name: 'uCurrentTime', type: 0x1406, size: 1 });
      }
      if (combined.includes('uniform float uWaveTime')) {
        uniforms.push({ name: 'uWaveTime', type: 0x1406, size: 1 });
      }
      if (combined.includes('uniform float uWavesEnabled')) {
        uniforms.push({ name: 'uWavesEnabled', type: 0x1406, size: 1 });
      }
      if (combined.includes('uniform vec3 uSunDir')) {
        uniforms.push({ name: 'uSunDir', type: 0x8b51, size: 1 });
      }
      if (combined.includes('uniform mat4 uReflViewProj')) {
        uniforms.push({ name: 'uReflViewProj', type: 0x8b5c, size: 1 });
      }
      if (combined.includes('uniform sampler2D uPlanarTex')) {
        uniforms.push({ name: 'uPlanarTex', type: 0x8b5e, size: 1 });
      }
      if (combined.includes('uniform sampler2D map')) {
        uniforms.push({ name: 'map', type: 0x8b5e, size: 1 });
      }
      programUniforms.set(program, uniforms);

      const attribs: Array<{ name: string; type: number; size: number }> = [
        { name: 'position', type: 0x8b51, size: 1 },
      ];
      if (combined.includes('attribute vec3 normal') || combined.includes('in vec3 normal')) {
        attribs.push({ name: 'normal', type: 0x8b51, size: 1 });
      }
      if (combined.includes('attribute vec3 color') || combined.includes('in vec3 color')) {
        attribs.push({ name: 'color', type: 0x8b51, size: 1 });
      }
      if (combined.includes('attribute vec3 offset')) {
        attribs.push({ name: 'offset', type: 0x8b51, size: 1 });
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
    deleteProgram(program: object) {
      record('deleteProgram', program);
    },
    useProgram(program: object | null) {
      record('useProgram', program);
    },
    enable(cap: number) {
      record('enable', cap);
    },
    disable(cap: number) {
      record('disable', cap);
    },
    blendEquation(mode: number) {
      record('blendEquation', mode);
    },
    blendEquationSeparate(rgb: number, a: number) {
      record('blendEquationSeparate', rgb, a);
    },
    blendFunc(s: number, d: number) {
      record('blendFunc', s, d);
    },
    blendFuncSeparate(sr: number, dr: number, sa: number, da: number) {
      record('blendFuncSeparate', sr, dr, sa, da);
    },
    depthMask(flag: boolean) {
      record('depthMask', flag);
    },
    depthFunc(func: number) {
      record('depthFunc', func);
    },
    colorMask(r: boolean, g: boolean, b: boolean, a: boolean) {
      record('colorMask', r, g, b, a);
    },
    cullFace(mode: number) {
      record('cullFace', mode);
    },
    frontFace(mode: number) {
      record('frontFace', mode);
    },
    polygonOffset(f: number, u: number) {
      record('polygonOffset', f, u);
    },
    lineWidth(w: number) {
      record('lineWidth', w);
    },
    viewport(x: number, y: number, w: number, h: number) {
      record('viewport', x, y, w, h);
    },
    scissor(x: number, y: number, w: number, h: number) {
      record('scissor', x, y, w, h);
    },
    clearColor(r: number, g: number, b: number, a: number) {
      record('clearColor', r, g, b, a);
    },
    clearDepth(d: number) {
      record('clearDepth', d);
    },
    clearStencil(s: number) {
      record('clearStencil', s);
    },
    clear(bits: number) {
      record('clear', bits);
    },
    activeTexture(slot: number) {
      record('activeTexture', slot);
    },
    createTexture() {
      const t = { _id: nextId++ };
      record('createTexture');
      return t;
    },
    bindTexture(target: number, tex: object | null) {
      record('bindTexture', target, tex);
    },
    deleteTexture(tex: object) {
      record('deleteTexture', tex);
    },
    pixelStorei(pname: number, param: number) {
      record('pixelStorei', pname, param);
    },
    texParameteri(target: number, pname: number, param: number) {
      record('texParameteri', target, pname, param);
    },
    texImage2D(...args: unknown[]) {
      record('texImage2D', ...args);
    },
    texSubImage2D(...args: unknown[]) {
      record('texSubImage2D', ...args);
    },
    copyTexSubImage2D(...args: unknown[]) {
      record('copyTexSubImage2D', ...args);
    },
    generateMipmap(target: number) {
      record('generateMipmap', target);
    },
    createFramebuffer() {
      const fb = { _id: nextId++ };
      record('createFramebuffer');
      return fb;
    },
    bindFramebuffer(target: number, fb: object | null) {
      record('bindFramebuffer', target, fb);
    },
    framebufferTexture2D(...args: unknown[]) {
      record('framebufferTexture2D', ...args);
    },
    deleteFramebuffer(fb: object) {
      record('deleteFramebuffer', fb);
    },
    createRenderbuffer() {
      const rb = { _id: nextId++ };
      record('createRenderbuffer');
      return rb;
    },
    bindRenderbuffer(target: number, rb: object | null) {
      record('bindRenderbuffer', target, rb);
    },
    renderbufferStorage(...args: unknown[]) {
      record('renderbufferStorage', ...args);
    },
    framebufferRenderbuffer(...args: unknown[]) {
      record('framebufferRenderbuffer', ...args);
    },
    deleteRenderbuffer(rb: object) {
      record('deleteRenderbuffer', rb);
    },
    readPixels(...args: unknown[]) {
      record('readPixels', ...args);
    },
    createBuffer() {
      const b = { _id: nextId++ };
      record('createBuffer');
      return b;
    },
    bindBuffer(target: number, buf: object | null) {
      record('bindBuffer', target, buf);
    },
    bufferData(target: number, data: ArrayBufferView, usage: number) {
      record('bufferData', target, data.byteLength, usage);
    },
    bufferSubData(target: number, byteOffset: number, data: ArrayBufferView) {
      record('bufferSubData', target, byteOffset, data.byteLength);
    },
    deleteBuffer(buf: object) {
      record('deleteBuffer', buf);
    },
    createVertexArray() {
      const vao = { _id: nextId++ };
      record('createVertexArray');
      return vao;
    },
    bindVertexArray(vao: object | null) {
      record('bindVertexArray', vao);
    },
    deleteVertexArray(vao: object) {
      record('deleteVertexArray', vao);
    },
    enableVertexAttribArray(loc: number) {
      record('enableVertexAttribArray', loc);
    },
    disableVertexAttribArray(loc: number) {
      record('disableVertexAttribArray', loc);
    },
    vertexAttribPointer(...args: unknown[]) {
      record('vertexAttribPointer', ...args);
    },
    vertexAttribIPointer(...args: unknown[]) {
      record('vertexAttribIPointer', ...args);
    },
    vertexAttribDivisor(loc: number, divisor: number) {
      record('vertexAttribDivisor', loc, divisor);
    },
    uniform1f(loc: object, v: number) {
      record('uniform1f', loc, v);
    },
    uniform1i(loc: object, v: number) {
      record('uniform1i', loc, v);
    },
    uniform1ui(loc: object, v: number) {
      record('uniform1ui', loc, v);
    },
    uniform2f(loc: object, x: number, y: number) {
      record('uniform2f', loc, x, y);
    },
    uniform3f(loc: object, x: number, y: number, z: number) {
      record('uniform3f', loc, x, y, z);
    },
    uniform4f(loc: object, x: number, y: number, z: number, w: number) {
      record('uniform4f', loc, x, y, z, w);
    },
    uniformMatrix3fv(loc: object, transpose: boolean, elems: Float32Array) {
      record('uniformMatrix3fv', loc, transpose, elems.length);
    },
    uniformMatrix4fv(loc: object, transpose: boolean, elems: Float32Array) {
      record('uniformMatrix4fv', loc, transpose, elems.length);
    },
    drawArrays(mode: number, first: number, count: number) {
      record('drawArrays', mode, first, count);
    },
    drawArraysInstanced(mode: number, first: number, count: number, primcount: number) {
      record('drawArraysInstanced', mode, first, count, primcount);
    },
    drawElements(mode: number, count: number, type: number, offset: number) {
      record('drawElements', mode, count, type, offset);
    },
    drawElementsInstanced(mode: number, count: number, type: number, offset: number, primcount: number) {
      record('drawElementsInstanced', mode, count, type, offset, primcount);
    },
  };

  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

function createTestCamera(pos = new Vector3(0, 0, 10)): RenderCameraLike {
  const cam = new Object3D() as RenderCameraLike;
  cam.isCamera = true;
  cam.position.copy(pos);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse = cam.matrixWorld.clone().invert();
  // Perspective projection (fov ~60deg, aspect 1, near 0.1, far 100)
  cam.projectionMatrix = new Matrix4().makePerspective(-0.0577, 0.0577, 0.0577, -0.0577, 0.1, 100);
  return cam;
}

test('WebGLState: suppresses redundant GL calls across program, blend, depth, cull, viewport, scissor', () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl });
  calls.length = 0;

  const state = renderer.state;
  const fakeProg = {} as WebGLProgram;

  assert.equal(state.useProgram(fakeProg), true);
  assert.equal(state.useProgram(fakeProg), false);
  assert.equal(calls.filter((c) => c.fn === 'useProgram').length, 1);

  state.setDepthTest(true);
  state.setDepthTest(true);
  assert.equal(calls.filter((c) => c.fn === 'enable' && c.args[0] === gl.DEPTH_TEST).length, 1);

  state.setDepthWrite(false);
  state.setDepthWrite(false);
  assert.equal(calls.filter((c) => c.fn === 'depthMask').length, 1);

  state.setBlendMode(NormalBlending);
  state.setBlendMode(NormalBlending);
  state.setBlendMode(AdditiveBlending);
  state.setBlendMode(NoBlending);
  assert.equal(calls.filter((c) => c.fn === 'blendFuncSeparate').length, 1);
  assert.equal(calls.filter((c) => c.fn === 'blendFunc').length, 1);

  state.setCullFace(CullFaceBack);
  state.setCullFace(CullFaceBack);
  state.setCullFace(CullFaceFront);
  assert.equal(calls.filter((c) => c.fn === 'cullFace').length, 2);

  state.setFrontFace(gl.CW);
  state.setFrontFace(gl.CW);
  assert.equal(calls.filter((c) => c.fn === 'frontFace').length, 1);

  state.setViewport(10, 20, 100, 200);
  state.setViewport(10, 20, 100, 200);
  assert.equal(calls.filter((c) => c.fn === 'viewport').length, 1);

  state.setScissor(5, 5, 50, 50);
  state.setScissor(5, 5, 50, 50);
  state.setScissorTest(true);
  state.setScissorTest(true);
  assert.equal(calls.filter((c) => c.fn === 'scissor').length, 1);

  state.reset();
  assert.equal(state.currentProgram, null);
  assert.equal(state.currentDepthTest, null);
  renderer.dispose();
});

test('WebGLRenderer: sizing, pixelRatio, viewport, scissor, clearColor, and clear methods', () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl });

  assert.equal(renderer.capabilities.isWebGL2, true);
  assert.equal(renderer.capabilities.maxTextureSize, 8192);
  assert.equal(renderer.outputColorSpace, SRGBColorSpace);
  assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(renderer.xr.enabled, false);

  renderer.setPixelRatio(2);
  renderer.setSize(640, 360);
  assert.equal(renderer.getPixelRatio(), 2);

  const sz = renderer.getSize(new Vector2());
  assert.deepEqual(sz.toArray(), [640, 360]);

  const dbSz = renderer.getDrawingBufferSize(new Vector2());
  assert.deepEqual(dbSz.toArray(), [1280, 720]);
  assert.equal(renderer.domElement.width, 1280);
  assert.equal(renderer.domElement.height, 720);

  // Viewport & Scissor scaling by pixelRatio
  renderer.setViewport(10, 20, 300, 200);
  const vp = renderer.getViewport(new Vector4());
  assert.deepEqual(vp.toArray(), [10, 20, 300, 200]);
  const curVp = renderer.getCurrentViewport(new Vector4());
  assert.deepEqual(curVp.toArray(), [20, 40, 600, 400]);

  renderer.setScissor(new Vector4(5, 10, 100, 80));
  renderer.setScissorTest(true);
  assert.equal(renderer.getScissorTest(), true);
  assert.deepEqual(renderer.getScissor(new Vector4()).toArray(), [5, 10, 100, 80]);

  // Clear color / alpha & individual clears
  renderer.setClearColor(0x336699, 0.5);
  assert.equal(renderer.getClearColor(new Color()).getHex(), 0x336699);
  assert.equal(renderer.getClearAlpha(), 0.5);

  calls.length = 0;
  renderer.clearColor();
  renderer.clearDepth();
  renderer.clearStencil();
  const clearCalls = calls.filter((c) => c.fn === 'clear').map((c) => c.args[0]);
  assert.deepEqual(clearCalls, [gl.COLOR_BUFFER_BIT, gl.DEPTH_BUFFER_BIT, gl.STENCIL_BUFFER_BIT]);

  renderer.dispose();
});

test('WebGLRenderer: render(scene, camera), frustum culling, opaque/transparent ordering, lights & VAO caching', () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new Scene();
  scene.background = new Color(0x6ab4e8);
  scene.fog = new FogExp2(0x6ab4e8, 0.003);

  // Add a directional light
  const sun = new Object3D() as Object3D & {
    isLight: boolean;
    isDirectionalLight: boolean;
    color: Color;
    intensity: number;
  };
  sun.isLight = true;
  sun.isDirectionalLight = true;
  sun.color = new Color(0xffffff);
  sun.intensity = 1.2;
  sun.position.set(10, 20, 10);
  scene.add(sun);

  const quadGeo = new BufferGeometry();
  quadGeo.setAttribute(
    'position',
    new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  quadGeo.setAttribute(
    'normal',
    new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  quadGeo.setIndex([0, 1, 2, 0, 2, 3]);

  const opaqueMat = new MeshLambertMaterial({ color: 0x44aa55 });
  const transMat = new MeshBasicMaterial({ color: 0x3399ff, transparent: true, opacity: 0.5, side: DoubleSide });

  const opaqueMesh = new Mesh(quadGeo, opaqueMat);
  opaqueMesh.position.set(0, 0, 0);

  const transMesh = new Mesh(quadGeo, transMat);
  transMesh.position.set(0, 0, 2);

  // Mesh behind camera -> should be frustum culled!
  const behindMesh = new Mesh(quadGeo, opaqueMat);
  behindMesh.position.set(0, 0, 50);

  scene.add(opaqueMesh, transMesh, behindMesh);
  const camera = createTestCamera(new Vector3(0, 0, 10));

  renderer.render(scene, camera);

  // 2 visible meshes (opaque + transparent), behindMesh culled!
  assert.equal(renderer.info.render.calls, 2);
  assert.equal(renderer.info.render.triangles, 4); // 2 triangles * 2 meshes
  assert.equal(renderer.info.render.frame, 1);
  assert.equal(renderer.info.memory.geometries, 1);
  assert.equal(renderer.info.programs.length, 2);

  // Check draw order: opaque (depthWrite=true, no blend) before transparent (blend enabled)
  const vaoCountAfterFrame1 = calls.filter((c) => c.fn === 'createVertexArray').length;
  assert.equal(vaoCountAfterFrame1, 2); // 1 per (geometry, program) pair

  // Frame 2: VAO and programs are reused -> zero new VAOs or programs created!
  calls.length = 0;
  renderer.render(scene, camera);
  assert.equal(calls.filter((c) => c.fn === 'createVertexArray').length, 0);
  assert.equal(calls.filter((c) => c.fn === 'createProgram').length, 0);
  assert.equal(calls.filter((c) => c.fn === 'vertexAttribPointer').length, 0);
  assert.equal(renderer.info.render.calls, 2);
  assert.equal(renderer.info.render.frame, 2);

  // Partial voxel buffer update uses bufferSubData with exact byte offset
  const posAttr = quadGeo.getAttribute('position')!;
  posAttr.updateSubRange([0, 0, 0], 3);
  calls.length = 0;
  renderer.render(scene, camera);
  const subCalls = calls.filter((c) => c.fn === 'bufferSubData');
  assert.equal(subCalls.length, 1);
  assert.equal(subCalls[0].args[1], 3 * 4); // offset 3 floats = 12 bytes
  assert.equal(subCalls[0].args[2], 3 * 4); // 3 floats = 12 bytes

  // Disposing geometry cleans up VBOs and decrements memory.geometries
  quadGeo.dispose();
  assert.equal(renderer.info.memory.geometries, 0);

  renderer.dispose();
});

test('WebGLRenderer: ShaderMaterial (GLSL3), LineBasicMaterial, PointsMaterial, InstancedBufferAttribute & compile()', async () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl });
  const scene = new Scene();
  const camera = createTestCamera();

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geo.setAttribute('offset', new InstancedBufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0]), 3, false, 1));

  const shaderMat = new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: { uTime: { value: 2.5 } },
    vertexShader: `attribute vec3 offset;
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + offset, 1.0); }`,
    fragmentShader: `uniform float uTime;
out vec4 outColor;
void main() { outColor = vec4(uTime, 0.0, 0.0, 1.0); }`,
    side: BackSide,
  });

  const mesh = new Mesh(geo, shaderMat);
  scene.add(mesh);

  // Pre-compile shaders synchronously and via compileAsync
  const compiledSet = renderer.compile(scene, camera);
  assert.equal(compiledSet.has(shaderMat), true);
  assert.equal(renderer.info.programs.length, 1);

  const asyncResult = await renderer.compileAsync(scene, camera);
  assert.equal(asyncResult, scene);

  calls.length = 0;
  renderer.render(scene, camera);

  assert.equal(calls.some((c) => c.fn === 'uniform1f' && c.args[1] === 2.5), true);
  assert.equal(calls.some((c) => c.fn === 'vertexAttribDivisor' && c.args[1] === 1), true);

  // Also test LineBasicMaterial and PointsMaterial draw modes
  const lineObj = new Object3D() as Object3D & {
    isLine: boolean;
    geometry: BufferGeometry;
    material: LineBasicMaterial;
  };
  lineObj.isLine = true;
  lineObj.geometry = geo;
  lineObj.material = new LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });

  const ptsObj = new Object3D() as Object3D & {
    isPoints: boolean;
    geometry: BufferGeometry;
    material: PointsMaterial;
  };
  ptsObj.isPoints = true;
  ptsObj.geometry = geo;
  ptsObj.material = new PointsMaterial({ color: 0xffff00, size: 5 });

  renderer.renderBufferDirect(camera, scene, geo, lineObj.material, lineObj, null);
  renderer.renderBufferDirect(camera, scene, geo, ptsObj.material, ptsObj, null);

  assert.equal(calls.some((c) => c.fn === 'drawArrays' && c.args[0] === gl.LINE_STRIP), true);
  assert.equal(calls.some((c) => c.fn === 'drawArrays' && c.args[0] === gl.POINTS), true);

  renderer.dispose();
});

test('WebGLRenderer: render targets, readRenderTargetPixels, copyFramebufferToTexture & renderChunkBatch', () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl });

  const rt: RenderTargetLike = {
    isWebGLRenderTarget: true,
    width: 256,
    height: 128,
    texture: { isTexture: true, width: 256, height: 128 },
    depthBuffer: true,
    stencilBuffer: false,
  };

  assert.equal(renderer.getRenderTarget(), null);
  renderer.setRenderTarget(rt);
  assert.equal(renderer.getRenderTarget(), rt);
  assert.equal(calls.some((c) => c.fn === 'createFramebuffer'), true);
  assert.equal(calls.some((c) => c.fn === 'framebufferTexture2D'), true);
  assert.equal(calls.some((c) => c.fn === 'framebufferRenderbuffer'), true);

  const pixels = new Uint8Array(4 * 16);
  renderer.readRenderTargetPixels(rt, 0, 0, 4, 4, pixels);
  assert.equal(calls.some((c) => c.fn === 'readPixels' && c.args[2] === 4 && c.args[3] === 4), true);

  renderer.clearTarget(rt, true, true, false);
  renderer.setRenderTarget(null);
  assert.equal(renderer.getRenderTarget(), null);

  // copyFramebufferToTexture & copyTextureToTexture
  const texA = { isTexture: true, isDataTexture: true, width: 4, height: 4, image: { data: new Uint8Array(64), width: 4, height: 4 } };
  const texB = { isTexture: true, width: 4, height: 4 };
  renderer.copyFramebufferToTexture(new Vector2(0, 0), texB);
  renderer.copyTextureToTexture(new Vector2(0, 0), texA, texB);
  assert.equal(calls.some((c) => c.fn === 'copyTexSubImage2D'), true);
  assert.equal(calls.some((c) => c.fn === 'texSubImage2D'), true);

  // Voxel chunk batch rendering skips off-screen chunks
  const scene = new Scene();
  const camera = createTestCamera(new Vector3(0, 0, 10));
  const chunkGeo = BufferGeometry.createVoxelChunkGeometry({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    boundsMin: { x: 0, y: 0, z: 0 },
    boundsMax: { x: 1, y: 1, z: 1 },
    dynamic: true,
  });
  const chunkMat = new MeshBasicMaterial({ color: 0x88cc44 });
  const visibleChunk = new Mesh(chunkGeo, chunkMat);
  visibleChunk.updateMatrixWorld(true);
  const culledChunk = new Mesh(chunkGeo, chunkMat);
  culledChunk.position.set(500, 0, 0);
  culledChunk.updateMatrixWorld(true);

  const count = renderer.renderChunkBatch([visibleChunk as never, culledChunk as never], camera, scene);
  assert.equal(count, 1);

  // Context loss guard & restore
  renderer.forceContextLoss();
  assert.equal(renderer.renderChunkBatch([visibleChunk as never], camera, scene), 0);
  renderer.forceContextRestore();
  assert.equal(renderer.renderChunkBatch([visibleChunk as never], camera, scene), 1);

  renderer.resetGLState();
  renderer.dispose();
  assert.equal(renderer.info.programs.length, 0);
  assert.equal(renderer.info.memory.textures, 0);
});

test('WebGLRenderer.renderChunkBatch: zero buffer re-uploads for unchanged chunks on frustum changes', () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl });
  const scene = new Scene();
  const camera = createTestCamera(new Vector3(0, 0, 10));
  const chunkMat = new MeshBasicMaterial({ color: 0x88cc44 });

  const makeChunk = (offsetX: number) => {
    const geo = BufferGeometry.createVoxelChunkGeometry({
      positions: new Float32Array([offsetX, 0, 0, offsetX + 1, 0, 0, offsetX + 1, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
      indices: new Uint16Array([0, 1, 2]),
      boundsMin: { x: offsetX, y: 0, z: 0 },
      boundsMax: { x: offsetX + 1, y: 1, z: 0 },
      dynamic: true,
    });
    const m = new Mesh(geo, chunkMat);
    m.updateMatrixWorld(true);
    return m;
  };

  const chunkA = makeChunk(0);
  const chunkB = makeChunk(2);
  const chunkC = makeChunk(-2);

  // Frame 1: upload chunkA + chunkB
  assert.equal(renderer.renderChunkBatch([chunkA as never, chunkB as never], camera, scene, true), 2);
  // Frame 2: upload chunkC alongside chunkA + chunkB
  assert.equal(renderer.renderChunkBatch([chunkA as never, chunkB as never, chunkC as never], camera, scene, true), 3);

  // Frame 3: simulate camera turning so chunkC leaves frustum (chunkA + chunkB remain)
  calls.length = 0;
  assert.equal(renderer.renderChunkBatch([chunkA as never, chunkB as never], camera, scene, true), 2);
  const bufferUploadsOnFrustumChange = calls.filter((c) => c.fn === 'bufferData' || c.fn === 'bufferSubData').length;
  const drawCallsOnFrame3 = calls.filter((c) => c.fn === 'drawElements').length;
  const useProgramCallsOnFrame3 = calls.filter((c) => c.fn === 'useProgram').length;

  assert.equal(bufferUploadsOnFrustumChange, 0, 'Unchanged chunks must NOT re-upload VBOs when another chunk leaves frustum');
  assert.equal(drawCallsOnFrame3, 2, 'Both visible chunks should be drawn directly from their own VAOs');
  assert.ok(useProgramCallsOnFrame3 <= 1, 'Shared shader program should not be rebound per chunk');

  renderer.dispose();
});

test('onBeforeCompile resolves Three.js #include chunks and uploads custom uniforms per frame', () => {
  const { gl, calls } = createMockWebGL2Context();
  const compiledSources: string[] = [];
  const origShaderSource = gl.shaderSource.bind(gl);
  gl.shaderSource = (shader: { source: string }, source: string) => {
    compiledSources.push(source);
    origShaderSource(shader, source);
  };

  const renderer = new WebGLRenderer({ context: gl });
  const scene = new Scene();
  const camera = createTestCamera(new Vector3(0, 5, 10));

  const mat = new MeshPhongMaterial({
    color: 0x0060d0,
    vertexColors: true,
    transparent: true,
    opacity: 0.94,
    side: DoubleSide,
  });

  const waveUniforms = {
    uWaveTime: { value: 1.25 },
    uWavesEnabled: { value: 1.0 },
    uSunDir: { value: new Vector3(0.4, 0.7, 0.5).normalize() },
    uReflViewProj: { value: new Matrix4() },
    uPlanarTex: { value: null as unknown },
  };
  mat.customProgramCacheKey = () => 'gerstner_ocean_test_v1';
  let onBeforeCompileCalls = 0;

  mat.onBeforeCompile = (shaderObj) => {
    const shader = shaderObj as {
      uniforms: Record<string, { value: unknown }>;
      vertexShader: string;
      fragmentShader: string;
    };
    onBeforeCompileCalls++;
    shader.uniforms.uWaveTime = waveUniforms.uWaveTime;
    shader.uniforms.uWavesEnabled = waveUniforms.uWavesEnabled;
    shader.uniforms.uSunDir = waveUniforms.uSunDir;
    shader.uniforms.uReflViewProj = waveUniforms.uReflViewProj;
    shader.uniforms.uPlanarTex = waveUniforms.uPlanarTex;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWaveTime;\nuniform float uWavesEnabled;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n#ifdef USE_COLOR\nobjectNormal = normalize(vec3(0.0, 1.0, 0.0));\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uWaveTime) * uWavesEnabled;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWaveTime;\nuniform vec3 uSunDir;\nuniform mat4 uReflViewProj;\nuniform sampler2D uPlanarTex;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nvec3 V = normalize(cameraPosition);\nvec3 N = normalize(uSunDir);\ngl_FragColor.rgb += N * 0.0 + V * 0.0 + (uReflViewProj * vec4(0.0)).rgb + texture2D(uPlanarTex, vec2(0.5)).rgb * 0.0;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= (0.9 + 0.1 * sin(uWaveTime));');
  };

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array([0, 14, 0, 1, 14, 0, 0, 14, 1]), 3));
  geo.setAttribute('normal', new Float32BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  geo.setAttribute('color', new Float32BufferAttribute(new Float32Array([0, 0.4, 0.9, 0, 0.4, 0.9, 0, 0.4, 0.9]), 3));
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  renderer.render(scene, camera);

  assert.equal(onBeforeCompileCalls, 1);
  assert.equal(compiledSources.length, 2);
  const [vertSrc, fragSrc] = compiledSources;
  assert.equal(vertSrc.includes('#include'), false, 'Vertex shader must have zero unresolved #include directives');
  assert.equal(fragSrc.includes('#include'), false, 'Fragment shader must have zero unresolved #include directives');
  assert.equal(vertSrc.includes('#define USE_COLOR'), true, 'Vertex shader must emit #define USE_COLOR when vertexColors is enabled');
  assert.equal(vertSrc.includes('vec3 objectNormal = vec3(normal);'), true);
  assert.equal(vertSrc.includes('vec3 transformed = vec3(position);'), true);
  assert.equal(vertSrc.includes('transformed.y += sin(uWaveTime) * uWavesEnabled;'), true);
  assert.equal(fragSrc.includes('uniform vec3 cameraPosition;'), true, 'Fragment shader must declare cameraPosition');
  assert.equal(fragSrc.includes('uniform float uWaveTime;'), true);

  // Verify initial custom uniform upload
  const waveTimeUpload1 = calls.find(
    (c) => c.fn === 'uniform1f' && (c.args[0] as { name?: string })?.name === 'uWaveTime' && c.args[1] === 1.25,
  );
  assert.ok(waveTimeUpload1, 'uWaveTime should be uploaded on frame 1');

  const sunDirUpload = calls.find(
    (c) => c.fn === 'uniform3f' && (c.args[0] as { name?: string })?.name === 'uSunDir',
  );
  assert.ok(sunDirUpload, 'uSunDir should be uploaded on frame 1');

  // Verify null sampler explicitly unbinds TEXTURE_2D (no feedback loop)
  const nullTexUnbind = calls.find((c) => c.fn === 'bindTexture' && c.args[0] === gl.TEXTURE_2D && c.args[1] === null);
  assert.ok(nullTexUnbind, 'null uPlanarTex should explicitly unbind TEXTURE_2D');

  // Advance uWaveTime on frame 2 and verify updated value uploads without recompiling program
  waveUniforms.uWaveTime.value = 2.75;
  renderer.render(scene, camera);
  assert.equal(onBeforeCompileCalls, 1, 'Program must remain cached across frames');
  const waveTimeUpload2 = calls.find(
    (c) => c.fn === 'uniform1f' && (c.args[0] as { name?: string })?.name === 'uWaveTime' && c.args[1] === 2.75,
  );
  assert.ok(waveTimeUpload2, 'Updated uWaveTime must upload on frame 2');

  renderer.dispose();
});

test('WebGLRenderer: material.wireframe=true renders via gl.LINES with gl.lineWidth(1.0) and respects 12-edge wireframeIndex', () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl });
  const scene = new Scene();
  const camera = createTestCamera(new Vector3(0, 0, 5));

  const geo = new BufferGeometry();
  geo.setAttribute(
    'position',
    new Float32BufferAttribute(
      new Float32Array([
        0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
        0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
      ]),
      3,
    ),
  );
  // 12 edges = 24 indices
  geo.userData.wireframeIndex = new BufferAttribute(
    new Uint16Array([
      0, 1, 1, 2, 2, 3, 3, 0,
      4, 5, 5, 6, 6, 7, 7, 4,
      0, 4, 1, 5, 2, 6, 3, 7,
    ]),
    1,
  );
  geo.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const wireMat = new MeshBasicMaterial({ color: 0x00ffff, wireframe: true });
  const mesh = new Mesh(geo, wireMat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  renderer.render(scene, camera);

  const lineWidthCall = calls.find((c) => c.fn === 'lineWidth' && c.args[0] === 1.0);
  assert.ok(lineWidthCall, 'Wireframe draw must explicitly set gl.lineWidth(1.0)');

  const drawLinesCall = calls.find(
    (c) => c.fn === 'drawElements' && c.args[0] === gl.LINES && c.args[1] === 24,
  );
  assert.ok(drawLinesCall, 'Wireframe cube must draw 24 indices (12 edges) using gl.LINES');

  const triangleDrawCall = calls.find(
    (c) => c.fn === 'drawElements' && c.args[0] === gl.TRIANGLES,
  );
  assert.equal(triangleDrawCall, undefined, 'Wireframe mesh must NOT draw with gl.TRIANGLES');

  renderer.dispose();
});

test('WebGLRenderer: compiles USE_AO and USE_SPAWN_POP shader defines and uploads uCurrentTime', () => {
  const { gl, calls } = createMockWebGL2Context();
  const compiledSources: string[] = [];
  const origShaderSource = gl.shaderSource.bind(gl);
  gl.shaderSource = (shader: { source: string }, source: string) => {
    compiledSources.push(source);
    origShaderSource(shader, source);
  };

  const renderer = new WebGLRenderer({ context: gl });
  renderer.currentTime = 4.5;
  const scene = new Scene();
  const camera = createTestCamera(new Vector3(0, 0, 5));

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geo.setAttribute('normal', new Float32BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geo.setAttribute('color', new Float32BufferAttribute(new Float32Array([0.2, 0.8, 0.2, 0.2, 0.8, 0.2, 0.2, 0.8, 0.2]), 3));
  geo.setAttribute('ao', new Float32BufferAttribute(new Float32Array([0.7, 0.88, 1.0]), 1));
  geo.setAttribute('spawnTime', new Float32BufferAttribute(new Float32Array([4.45, 4.45, 4.45]), 1));
  geo.setAttribute('voxelCenter', new Float32BufferAttribute(new Float32Array([0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0]), 3));

  const mat = new MeshLambertMaterial({ vertexColors: true });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  renderer.render(scene, camera);

  assert.equal(compiledSources.length, 2);
  const [vertSrc, fragSrc] = compiledSources;
  assert.equal(vertSrc.includes('#define USE_AO'), true);
  assert.equal(vertSrc.includes('#define USE_SPAWN_POP'), true);
  assert.equal(fragSrc.includes('#define USE_AO'), true);
  assert.equal(fragSrc.includes('diffuseColor.rgb *= vAo;'), true);

  const timeUpload = calls.find(
    (c) => c.fn === 'uniform1f' && (c.args[0] as { name?: string })?.name === 'uCurrentTime' && c.args[1] === 4.5,
  );
  assert.ok(timeUpload, 'uCurrentTime uniform must upload renderer.currentTime');

  renderer.dispose();
});

test('Phase 3c Fix 2 & Fix #1: per-material program cache hits & zero-reupload shared-state terrain chunk batching', () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl });
  const scene = new Scene();
  const camera = createTestCamera(new Vector3(0, 0, 10));

  const sharedMat = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
  });

  for (let c = 0; c < 4; c++) {
    const geo = new BufferGeometry();
    const ox = c * 2;
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array([ox, 0, 0, ox + 1, 0, 0, ox, 1, 0]), 3));
    geo.setAttribute('normal', new Float32BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    geo.setAttribute('color', new Float32BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3));
    geo.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
    geo.userData.activeVertCount = 3;
    geo.userData.chunkGeoRevision = 1;
    const mesh = new Mesh(geo, sharedMat);
    (mesh as unknown as { isTerrainChunk?: boolean }).isTerrainChunk = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  const programs = (renderer as unknown as { _programs: { getParameters: (...a: unknown[]) => unknown; getProgramCacheKey: (...a: unknown[]) => string } })._programs;
  let getParamsCalls = 0;
  let getKeyCalls = 0;
  const origGetParams = programs.getParameters.bind(programs);
  const origGetKey = programs.getProgramCacheKey.bind(programs);
  programs.getParameters = (...args: unknown[]) => {
    getParamsCalls++;
    return origGetParams(...args);
  };
  programs.getProgramCacheKey = (...args: unknown[]) => {
    getKeyCalls++;
    return origGetKey(...args);
  };

  // Frame 1: compiles once and draws 4 terrain chunks using shared program/uniforms + per-chunk VAOs
  renderer.render(scene, camera);
  assert.equal(renderer.info.render.calls, 4, '4 terrain chunks render directly from their own persistent VAOs');
  assert.equal(renderer.info.render.triangles, 4, 'Chunk batch must preserve all 4 triangles');
  assert.equal(getParamsCalls, 1, 'Warmup frame should compute program parameters once');
  assert.equal(getKeyCalls, 1, 'Warmup frame should compute program cache key once');

  // Frames 2..5: 100% per-material program cache hit and ZERO buffer re-uploads
  calls.length = 0;
  for (let f = 0; f < 4; f++) {
    renderer.render(scene, camera);
    assert.equal(renderer.info.render.calls, 4);
    assert.equal(renderer.info.render.triangles, 4);
  }
  assert.equal(getParamsCalls, 1, 'Cached material must skip getParameters on subsequent frames');
  assert.equal(getKeyCalls, 1, 'Cached material must skip getProgramCacheKey (GLSL concat) on subsequent frames');
  assert.equal(
    calls.filter((c) => c.fn === 'bufferData' || c.fn === 'bufferSubData').length,
    0,
    'Steady frames must trigger zero GPU buffer uploads',
  );

  // Invalidating material version triggers a single cache miss, then hits again
  sharedMat.needsUpdate = true;
  renderer.render(scene, camera);
  assert.equal(getParamsCalls, 2);
  renderer.render(scene, camera);
  assert.equal(getParamsCalls, 2);

  renderer.dispose();
});

test('WebGLRenderer renders Scale-Space Multi-Pass bands farthest-to-nearest with DEPTH clears and BigInt RTE offsets at 10^34 m', () => {
  const { gl, calls } = createMockWebGL2Context();
  const renderer = new WebGLRenderer({ context: gl, logarithmicDepthBuffer: true });
  renderer.setSize(640, 360);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 640 / 360, 0.25, 65536);
  camera.position.set(120, 20, -40);
  camera.lookAt(120, 20, -140);
  camera.updateMatrixWorld();

  // Place camera at a huge BigInt macro-sector (~10^34 m from world zero)
  const cosmicSector = 10_000_000_000_000_000_000_000_000_000_000n;
  renderer.cameraBigSector = {
    sectorX: cosmicSector,
    sectorZ: cosmicSector,
    localX: 120,
    localY: 20,
    localZ: -40,
  };

  const makeTri = () => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    geo.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    return geo;
  };

  const drawSequence: string[] = [];
  const makeTrackedMat = (label: string) => {
    const mat = new MeshBasicMaterial({ color: 0x33aa55 });
    mat.onBeforeRender = () => {
      drawSequence.push(label);
    };
    return mat;
  };

  const skyDome = new Mesh(makeTri(), makeTrackedMat('SKY'));
  skyDome.frustumCulled = false;
  skyDome.userData.isSkyDome = true;
  scene.add(skyDome);

  const localMesh = new Mesh(makeTri(), makeTrackedMat('BAND0'));
  localMesh.frustumCulled = false;
  scene.add(localMesh);

  const band1Scale = 1n << 12n;
  const band1Mesh = new Mesh(makeTri(), makeTrackedMat('BAND1'));
  band1Mesh.frustumCulled = false;
  band1Mesh.userData.scaleBand = 1;
  band1Mesh.userData.bandScaleMetersBig = band1Scale;
  band1Mesh.userData.worldOriginBigInt = {
    x: cosmicSector * 1024n + band1Scale * 100n,
    y: 0n,
    z: cosmicSector * 1024n - band1Scale * 250n,
  };
  scene.add(band1Mesh);

  const band9Scale = 1n << 108n;
  const band9Mesh = new Mesh(makeTri(), makeTrackedMat('BAND9'));
  band9Mesh.frustumCulled = false;
  band9Mesh.userData.scaleBand = 9;
  band9Mesh.userData.bandScaleMetersBig = band9Scale;
  band9Mesh.userData.worldOriginBigInt = {
    x: cosmicSector * 1024n + band9Scale * 512n,
    y: 0n,
    z: cosmicSector * 1024n - band9Scale * 1024n,
  };
  scene.add(band9Mesh);

  calls.length = 0;
  renderer.render(scene, camera);

  // 1. Verify exact render order: SkyDome -> Farthest Band (9) -> Nearer Band (1) -> Local Band (0)
  assert.deepEqual(drawSequence, ['SKY', 'BAND9', 'BAND1', 'BAND0']);

  // 2. Verify gl.clear(gl.DEPTH_BUFFER_BIT) was invoked between the cosmic scale bands!
  const depthOnlyClears = calls.filter(
    (c) => c.fn === 'clear' && c.args[0] === gl.DEPTH_BUFFER_BIT,
  );
  assert.equal(
    depthOnlyClears.length,
    2,
    `Expected 2 depth-only clears (after Band 9 and after Band 1), got ${depthOnlyClears.length}`,
  );

  // 3. Verify EVERY uploaded uniformMatrix4fv (including Band 9 at 10^34 m) is finite and Float32-safe!
  const mat4Calls = calls.filter((c) => c.fn === 'uniformMatrix4fv');
  assert.ok(mat4Calls.length > 0);
  for (const call of mat4Calls) {
    const arr = call.args[2] as Float32Array | number[];
    for (let i = 0; i < arr.length; i++) {
      assert.ok(Number.isFinite(arr[i]), `Uploaded matrix entry ${arr[i]} must be finite`);
      assert.ok(Math.abs(arr[i]) < 1e7, `Uploaded matrix entry ${arr[i]} must stay safely bounded in Float32`);
    }
  }

  renderer.dispose();
});



