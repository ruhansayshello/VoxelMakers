export function createWebGLShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error('WebGLShader: failed to allocate shader object.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  return shader;
}

export function formatShaderLog(source: string, log: string): string {
  const lines = source.split('\n');
  const numbered = lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');
  return `${log}\n---\n${numbered}`;
}
