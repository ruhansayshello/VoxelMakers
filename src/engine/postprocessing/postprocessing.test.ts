import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACESFilmicToneMapping,
  BufferGeometry,
  Color,
  CopyShader,
  DepthTexture,
  EffectComposer,
  Float32BufferAttribute,
  FullScreenQuad,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OutputPass,
  Pass,
  RenderPass,
  Scene,
  ShaderPass,
  SRGBColorSpace,
  WebGLRenderer,
  WebGLRenderTarget,
  type RenderCameraLike,
} from '../index';

interface CallRecord {
  fn: string;
  args: unknown[];
}

function createPostGL2Mock() {
  const calls: CallRecord[] = [];
  let nextId = 1;
  const programUniforms = new Map<object, Array<{ name: string; type: number; size: number }>>();
  const programAttribs = new Map<object, Array<{ name: string; type: number; size: number }>>();

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
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    SHORT: 0x1402,
    UNSIGNED_INT: 0x1405,
    INT: 0x1404,
    BYTE: 0x1400,
    UNSIGNED_BYTE: 0x1401,
    HALF_FLOAT: 0x140b,
    FLOAT_VEC2: 0x8b50,
    FLOAT_VEC3: 0x8b51,
    FLOAT_VEC4: 0x8b52,
    FLOAT_MAT2: 0x8b5a,
    FLOAT_MAT3: 0x8b5b,
    FLOAT_MAT4: 0x8b5c,
    SAMPLER_2D: 0x8b5e,
    TRIANGLES: 0x0004,
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
    FUNC_ADD: 0x8006,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1,
    ZERO: 0,
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
    REPEAT: 0x2901,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    RGBA16F: 0x881a,
    RGBA32F: 0x8814,
    RED: 0x1903,
    R8: 0x8229,
    DEPTH_COMPONENT: 0x1902,
    DEPTH_COMPONENT16: 0x81a5,
    DEPTH_COMPONENT24: 0x81a6,
    DEPTH_STENCIL: 0x84f9,
    DEPTH24_STENCIL8: 0x88f0,
    UNSIGNED_INT_24_8: 0x84fa,
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    RENDERBUFFER: 0x8d41,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_ATTACHMENT: 0x8d00,
    DEPTH_STENCIL_ATTACHMENT: 0x821a,
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

    getParameter: () => 4096,
    getExtension: () => null,
    getContextAttributes: () => ({ alpha: false, depth: true, stencil: true }),
    createShader: (type: number) => ({ _id: nextId++, type, source: '' }),
    shaderSource: (s: { source: string }, src: string) => {
      s.source = src;
    },
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader: () => {},
    createProgram: () => {
      const p = { _id: nextId++, shaders: [] as Array<{ source: string }> };
      record('createProgram');
      return p;
    },
    attachShader: (p: { shaders: Array<{ source: string }> }, s: { source: string }) => {
      p.shaders.push(s);
    },
    linkProgram: (p: { shaders: Array<{ source: string }> }) => {
      const src = p.shaders.map((s) => s.source).join('\n');
      const uniforms: Array<{ name: string; type: number; size: number }> = [
        { name: 'projectionMatrix', type: 0x8b5c, size: 1 },
        { name: 'modelViewMatrix', type: 0x8b5c, size: 1 },
      ];
      if (src.includes('uniform sampler2D tDiffuse')) uniforms.push({ name: 'tDiffuse', type: 0x8b5e, size: 1 });
      if (src.includes('uniform float uBloomStrength')) uniforms.push({ name: 'uBloomStrength', type: 0x1406, size: 1 });
      if (src.includes('uniform float uBloomThreshold')) uniforms.push({ name: 'uBloomThreshold', type: 0x1406, size: 1 });
      if (src.includes('uniform int uToneMapping')) uniforms.push({ name: 'uToneMapping', type: 0x1404, size: 1 });
      if (src.includes('uniform int uToSRGB')) uniforms.push({ name: 'uToSRGB', type: 0x1404, size: 1 });
      if (src.includes('uniform float toneMappingExposure')) uniforms.push({ name: 'toneMappingExposure', type: 0x1406, size: 1 });
      if (src.includes('uniform vec3 diffuse')) uniforms.push({ name: 'diffuse', type: 0x8b51, size: 1 });
      if (src.includes('uniform float opacity')) uniforms.push({ name: 'opacity', type: 0x1406, size: 1 });
      programUniforms.set(p, uniforms);

      const attribs: Array<{ name: string; type: number; size: number }> = [
        { name: 'position', type: 0x8b51, size: 1 },
      ];
      if (src.includes('attribute vec2 uv')) attribs.push({ name: 'uv', type: 0x8b50, size: 1 });
      programAttribs.set(p, attribs);
    },
    getProgramParameter: (p: object, pname: number) => {
      if (pname === 0x8b82) return true;
      if (pname === 0x8b86) return (programUniforms.get(p) ?? []).length;
      if (pname === 0x8b89) return (programAttribs.get(p) ?? []).length;
      return 0;
    },
    getProgramInfoLog: () => '',
    getActiveUniform: (p: object, i: number) => (programUniforms.get(p) ?? [])[i] ?? null,
    getUniformLocation: (_p: object, name: string) => ({ name }),
    getActiveAttrib: (p: object, i: number) => (programAttribs.get(p) ?? [])[i] ?? null,
    getAttribLocation: (p: object, name: string) => (programAttribs.get(p) ?? []).findIndex((a) => a.name === name),
    deleteProgram: (p: object) => record('deleteProgram', p),
    useProgram: (p: object | null) => record('useProgram', p),
    enable: (c: number) => record('enable', c),
    disable: (c: number) => record('disable', c),
    blendEquation: () => {},
    blendFunc: () => {},
    blendFuncSeparate: () => {},
    depthMask: () => {},
    depthFunc: () => {},
    colorMask: () => {},
    cullFace: () => {},
    frontFace: () => {},
    polygonOffset: () => {},
    lineWidth: () => {},
    viewport: (x: number, y: number, w: number, h: number) => record('viewport', x, y, w, h),
    scissor: () => {},
    clearColor: (r: number, g: number, b: number, a: number) => record('clearColor', r, g, b, a),
    clearDepth: () => {},
    clearStencil: () => {},
    clear: (bits: number) => record('clear', bits),
    activeTexture: (slot: number) => record('activeTexture', slot),
    createTexture: () => {
      const t = { _id: nextId++ };
      record('createTexture', t._id);
      return t;
    },
    bindTexture: (target: number, tex: object | null) => record('bindTexture', target, tex),
    deleteTexture: (t: object) => record('deleteTexture', t),
    pixelStorei: () => {},
    texParameteri: () => {},
    texImage2D: (...args: unknown[]) => record('texImage2D', ...args),
    generateMipmap: () => {},
    createFramebuffer: () => {
      const fb = { _id: nextId++ };
      record('createFramebuffer', fb._id);
      return fb;
    },
    bindFramebuffer: (target: number, fb: object | null) => record('bindFramebuffer', target, fb),
    framebufferTexture2D: (...args: unknown[]) => record('framebufferTexture2D', ...args),
    deleteFramebuffer: (fb: object) => record('deleteFramebuffer', fb),
    createRenderbuffer: () => {
      const rb = { _id: nextId++ };
      record('createRenderbuffer', rb._id);
      return rb;
    },
    bindRenderbuffer: () => {},
    renderbufferStorage: () => {},
    framebufferRenderbuffer: (...args: unknown[]) => record('framebufferRenderbuffer', ...args),
    deleteRenderbuffer: (rb: object) => record('deleteRenderbuffer', rb),
    blitFramebuffer: (...args: unknown[]) => record('blitFramebuffer', ...args),
    createBuffer: () => ({ _id: nextId++ }),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => {},
    deleteBuffer: () => {},
    createVertexArray: () => ({ _id: nextId++ }),
    bindVertexArray: () => {},
    deleteVertexArray: () => {},
    enableVertexAttribArray: () => {},
    disableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    vertexAttribIPointer: () => {},
    vertexAttribDivisor: () => {},
    uniform1f: (loc: { name: string }, v: number) => record('uniform1f', loc.name, v),
    uniform1i: (loc: { name: string }, v: number) => record('uniform1i', loc.name, v),
    uniform3f: (loc: { name: string }, r: number, g: number, b: number) => record('uniform3f', loc.name, r, g, b),
    uniformMatrix4fv: () => {},
    drawArrays: (mode: number, first: number, count: number) => record('drawArrays', mode, first, count),
    drawElements: (mode: number, count: number) => record('drawElements', mode, count),
  };

  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

function createCamera(): RenderCameraLike {
  const cam = new Object3D() as RenderCameraLike;
  cam.isCamera = true;
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse = cam.matrixWorld.clone().invert();
  cam.projectionMatrix = new Matrix4().makePerspective(-0.1, 0.1, 0.1, -0.1, 0.1, 100);
  return cam;
}

// Mirrors the game's HDR Bloom shader structure from src/game/graphicsPipeline.ts
const VoxelBloomShader = {
  name: 'VoxelBloomShader',
  uniforms: {
    tDiffuse: { value: null },
    uBloomStrength: { value: 0.85 },
    uBloomThreshold: { value: 0.65 },
  },
  vertexShader: `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float uBloomStrength;
uniform float uBloomThreshold;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float brightness = max(base.r, max(base.g, base.b));
  float contrib = max(0.0, brightness - uBloomThreshold) / max(brightness, 0.0001);
  vec3 bloomed = base.rgb + base.rgb * contrib * uBloomStrength;
  gl_FragColor = vec4(bloomed, base.a);
}`,
};

test('WebGLRenderTarget: properties, DepthTexture attachment, zero-realloc setSize & clone/dispose', () => {
  const { gl, calls } = createPostGL2Mock();
  const renderer = new WebGLRenderer({ context: gl });

  const depthTex = new DepthTexture(320, 180);
  const rt = new WebGLRenderTarget(320, 180, {
    depth: true,
    stencil: false,
    depthTexture: depthTex,
    samples: 0,
  });

  assert.equal(rt.isWebGLRenderTarget, true);
  assert.equal(rt.width, 320);
  assert.equal(rt.height, 180);
  assert.equal(rt.depth, true);
  assert.equal(rt.stencil, false);
  assert.equal(rt.depthTexture, depthTex);
  assert.equal(rt.samples, 0);

  // Binding creates 1 FBO + color tex + depth tex attached to DEPTH_ATTACHMENT
  renderer.setRenderTarget(rt);
  assert.equal(calls.filter((c) => c.fn === 'createFramebuffer').length, 1);
  assert.equal(
    calls.some((c) => c.fn === 'framebufferTexture2D' && c.args[1] === gl.DEPTH_ATTACHMENT),
    true,
  );

  // Calling setSize with identical dimensions does NOT dispose or reallocate
  let disposeCount = 0;
  rt.addEventListener('dispose', () => {
    disposeCount++;
  });
  rt.setSize(320, 180);
  assert.equal(disposeCount, 0);

  // Resizing to new dimensions disposes old GPU target so next bind reallocates cleanly
  rt.setSize(640, 360);
  assert.equal(disposeCount, 1);
  assert.equal(rt.width, 640);
  assert.equal(rt.height, 360);

  const cloned = rt.clone();
  assert.notEqual(cloned.texture, rt.texture);
  assert.equal(cloned.width, 640);
  assert.equal(cloned.height, 360);

  rt.dispose();
  cloned.dispose();
  renderer.dispose();
});

test('EffectComposer: RenderPass + Bloom ShaderPass + OutputPass pipeline, zero per-frame realloc, disabled-pass skip & blitFramebuffer', () => {
  const { gl, calls } = createPostGL2Mock();
  const renderer = new WebGLRenderer({ context: gl });
  renderer.setSize(640, 360);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.background = new Color(0x0b1220);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
  const brightMesh = new Mesh(geo, new MeshBasicMaterial({ color: 0xffdd44 }));
  scene.add(brightMesh);

  const camera = createCamera();

  const composer = new EffectComposer(renderer);
  const rt1Ref = composer.renderTarget1;
  const rt2Ref = composer.renderTarget2;

  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new ShaderPass(VoxelBloomShader);
  bloomPass.uniforms.uBloomStrength.value = 1.25;
  bloomPass.uniforms.uBloomThreshold.value = 0.55;

  // Add a toggleable pass that starts disabled and must NEVER be invoked
  let disabledRenderCalled = false;
  class SpyPass extends Pass {
    override render() {
      disabledRenderCalled = true;
    }
  }
  const skippedPass = new SpyPass();
  skippedPass.enabled = false;

  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(skippedPass);
  composer.addPass(outputPass);

  assert.equal(composer.getEnabledPasses().length, 3);
  assert.equal(composer.copyPass.uniforms.tDiffuse !== undefined, true);
  assert.equal(CopyShader.name, 'CopyShader');

  // --- Frame 1: allocates the 2 ping-pong FBOs once and renders RenderPass -> Bloom -> OutputPass ---
  calls.length = 0;
  composer.render(0.016);

  assert.equal(disabledRenderCalled, false, 'Disabled pass must not have render() called');

  // Verify Bloom shader uniforms were uploaded and readBuffer.texture wired through
  assert.equal(
    calls.some((c) => c.fn === 'uniform1f' && c.args[0] === 'uBloomStrength' && c.args[1] === 1.25),
    true,
    'Bloom strength uniform must be uploaded during bloom ShaderPass',
  );
  assert.equal(
    calls.some((c) => c.fn === 'uniform1f' && c.args[0] === 'uBloomThreshold' && c.args[1] === 0.55),
    true,
    'Bloom threshold uniform must be uploaded during bloom ShaderPass',
  );
  assert.equal(bloomPass.uniforms.tDiffuse.value, rt2Ref.texture);

  // Verify OutputPass received the bloomed buffer texture and rendered to screen (null FBO) with ACESFilmic + sRGB
  assert.equal(outputPass.uniforms.tDiffuse.value, rt1Ref.texture);
  assert.equal(outputPass.renderToScreen, true);
  assert.equal(
    calls.some((c) => c.fn === 'uniform1i' && c.args[0] === 'uToneMapping' && c.args[1] === 4),
    true,
    'OutputPass must apply ACESFilmic tone mapping',
  );
  assert.equal(
    calls.some((c) => c.fn === 'uniform1i' && c.args[0] === 'uToSRGB' && c.args[1] === 1),
    true,
    'OutputPass must convert output to sRGB',
  );

  // Verify 3 draw calls happened: scene triangle + bloom full-screen triangle + output full-screen triangle
  assert.equal(calls.filter((c) => c.fn === 'drawArrays').length, 3);

  // --- Frames 2, 3, 4: ZERO framebuffer or texture reallocations! ---
  calls.length = 0;
  composer.render(0.016);
  composer.render(0.016);
  composer.render(0.016);

  assert.equal(composer.renderTarget1, rt1Ref);
  assert.equal(composer.renderTarget2, rt2Ref);
  assert.equal(
    calls.filter((c) => c.fn === 'createFramebuffer').length,
    0,
    'Ping-pong FBOs must NEVER be reallocated after frame 1',
  );
  assert.equal(
    calls.filter((c) => c.fn === 'createTexture').length,
    0,
    'Ping-pong textures must NEVER be reallocated after frame 1',
  );
  assert.equal(
    calls.filter((c) => c.fn === 'createRenderbuffer').length,
    0,
    'Depth renderbuffers must NEVER be reallocated after frame 1',
  );

  // --- Verify gl.blitFramebuffer hardware presentation optimization ---
  calls.length = 0;
  const blitted = composer.presentToScreen();
  assert.equal(blitted, true);
  assert.equal(calls.filter((c) => c.fn === 'blitFramebuffer').length, 1);

  // Verify insertPass / removePass / FullScreenQuad standalone
  const fsq = new FullScreenQuad(bloomPass.material);
  assert.equal(fsq.geometry.getAttribute('position')!.count, 3);
  fsq.dispose();

  composer.removePass(skippedPass);
  assert.equal(composer.passes.length, 3);
  composer.insertPass(skippedPass, 1);
  assert.equal(composer.passes[1], skippedPass);

  composer.dispose();
  bloomPass.dispose();
  outputPass.dispose();
  renderer.dispose();
});
