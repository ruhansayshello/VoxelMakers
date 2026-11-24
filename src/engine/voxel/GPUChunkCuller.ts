import { Frustum, Matrix4, type Sphere } from '../math';
import { createWebGLShader } from '../renderers/webgl/WebGLShader';
import type { RenderCameraLike } from '../renderers/WebGLRenderer';

const TF_CULL_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSphere;
uniform vec4 uFrustumPlanes[6];
out float vVisible;

void main() {
  float vis = 1.0;
  for (int i = 0; i < 6; i++) {
    vec4 p = uFrustumPlanes[i];
    if (dot(p.xyz, aSphere.xyz) + p.w < -aSphere.w) {
      vis = 0.0;
    }
  }
  vVisible = vis;
}`;

const TF_CULL_FRAGMENT_SHADER = `#version 300 es
precision lowp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.0);
}`;

const _projScreen = new Matrix4();
const _frustum = new Frustum();

/**
 * WebGL2 Transform Feedback GPU frustum culler for chunk bounding spheres.
 * Evaluates all chunk spheres against the 6 camera frustum planes in parallel
 * on the GPU, with automatic CPU Frustum.cullChunkArray fallback when WebGL2
 * transform feedback APIs are unavailable.
 */
export class GPUChunkCuller {
  readonly maxChunks: number;
  readonly isGPUActive: boolean;

  private gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private tf: WebGLTransformFeedback | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private sphereBuffer: WebGLBuffer | null = null;
  private resultBuffer: WebGLBuffer | null = null;
  private planesLocation: WebGLUniformLocation | null = null;

  private sphereUpload: Float32Array;
  private visibilityOut: Float32Array;
  private planeData = new Float32Array(24);

  constructor(gl: WebGL2RenderingContext | null, maxChunks = 512) {
    this.gl = gl;
    this.maxChunks = Math.max(1, maxChunks);
    this.sphereUpload = new Float32Array(this.maxChunks * 4);
    this.visibilityOut = new Float32Array(this.maxChunks);

    this.isGPUActive = this.initTransformFeedback(gl);
  }

  private initTransformFeedback(gl: WebGL2RenderingContext | null): boolean {
    if (
      gl === null ||
      typeof gl.createTransformFeedback !== 'function' ||
      typeof gl.transformFeedbackVaryings !== 'function' ||
      typeof gl.getBufferSubData !== 'function'
    ) {
      return false;
    }

    try {
      const vs = createWebGLShader(gl, gl.VERTEX_SHADER, TF_CULL_VERTEX_SHADER);
      const fs = createWebGLShader(gl, gl.FRAGMENT_SHADER, TF_CULL_FRAGMENT_SHADER);
      const program = gl.createProgram();
      if (!program) return false;

      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.transformFeedbackVaryings(program, ['vVisible'], gl.SEPARATE_ATTRIBS);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return false;
      }

      const vao = gl.createVertexArray();
      const sphereBuffer = gl.createBuffer();
      const resultBuffer = gl.createBuffer();
      const tf = gl.createTransformFeedback();
      if (!vao || !sphereBuffer || !resultBuffer || !tf) {
        gl.deleteProgram(program);
        return false;
      }

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.sphereUpload.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, resultBuffer);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, this.visibilityOut.byteLength, gl.DYNAMIC_READ);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);

      this.program = program;
      this.vao = vao;
      this.sphereBuffer = sphereBuffer;
      this.resultBuffer = resultBuffer;
      this.tf = tf;
      this.planesLocation = gl.getUniformLocation(program, 'uFrustumPlanes[0]');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Evaluates visibility for each bounding sphere against the camera frustum.
   * Returns a Float32Array view (`1.0` = visible, `0.0` = culled) of length `spheres.length`.
   */
  cullSpheres(spheres: Sphere[], camera: RenderCameraLike): Float32Array {
    const count = Math.min(spheres.length, this.maxChunks);
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);

    if (!this.isGPUActive || !this.gl || !this.program || !this.tf || !this.vao) {
      // Fast CPU fallback using Frustum
      for (let i = 0; i < count; i++) {
        this.visibilityOut[i] = _frustum.intersectsSphere(spheres[i]) ? 1.0 : 0.0;
      }
      return this.visibilityOut.subarray(0, count);
    }

    const gl = this.gl;

    for (let i = 0; i < count; i++) {
      const s = spheres[i];
      const base = i * 4;
      this.sphereUpload[base] = s.center.x;
      this.sphereUpload[base + 1] = s.center.y;
      this.sphereUpload[base + 2] = s.center.z;
      this.sphereUpload[base + 3] = s.radius;
    }

    for (let p = 0; p < 6; p++) {
      const plane = _frustum.planes[p];
      const base = p * 4;
      this.planeData[base] = plane.normal.x;
      this.planeData[base + 1] = plane.normal.y;
      this.planeData[base + 2] = plane.normal.z;
      this.planeData[base + 3] = plane.constant;
    }

    gl.useProgram(this.program);
    if (this.planesLocation !== null) {
      gl.uniform4fv(this.planesLocation, this.planeData);
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sphereUpload.subarray(0, count * 4));

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.resultBuffer);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);

    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.visibilityOut.subarray(0, count));

    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    return this.visibilityOut.subarray(0, count);
  }

  dispose(): void {
    if (!this.gl) return;
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.sphereBuffer) this.gl.deleteBuffer(this.sphereBuffer);
    if (this.resultBuffer) this.gl.deleteBuffer(this.resultBuffer);
    if (this.tf) this.gl.deleteTransformFeedback(this.tf);
    this.program = null;
    this.vao = null;
    this.sphereBuffer = null;
    this.resultBuffer = null;
    this.tf = null;
  }
}
