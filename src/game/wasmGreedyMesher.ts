/**
 * WebAssembly 2D Greedy Mask Merger Kernel (`wasmGreedyMesher.ts`)
 *
 * Compiles and instantiates an inline WebAssembly module with linear memory
 * that executes the hot O(U * V) 2D greedy rectangle expansion + mask clearing
 * inner loop in native WASM machine code.
 *
 * For each non-zero cell in `mask[dimsU * dimsV]`, WASM finds the maximal
 * `(w, h)` rectangle with identical packed material/color/windings code `c`,
 * zeroes out the merged cells in-place in linear memory, and writes a 5-int32
 * quad descriptor `(i, j, w, h, c)` into the output buffer in linear memory.
 */

export interface WasmGreedyKernelExports {
  memory: WebAssembly.Memory;
  mergeMask2D: (
    dimsU: number,
    dimsV: number,
    maskByteOffset: number,
    quadsOutByteOffset: number,
    maxQuads: number,
  ) => number;
}

function encodeULEB128(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function encodeSLEB128(value: number): number[] {
  const out: number[] = [];
  let v = value | 0;
  let more = true;
  while (more) {
    let byte = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    out.push(byte);
  }
  return out;
}

function section(id: number, payload: number[]): number[] {
  return [id, ...encodeULEB128(payload.length), ...payload];
}

function buildWasmGreedyMesherBytes(): Uint8Array {
  const I32 = 0x7f;
  // Local indices for mergeMask2D:
  // Params:
  // 0: dimsU (i32)
  // 1: dimsV (i32)
  // 2: maskOff (i32)
  // 3: outOff (i32)
  // 4: maxQuads (i32)
  // Locals:
  // 5: j (i32)
  // 6: i (i32)
  // 7: idx (i32)
  // 8: c (i32)
  // 9: w (i32)
  // 10: h (i32)
  // 11: k (i32)
  // 12: done (i32)
  // 13: dy (i32)
  // 14: dx (i32)
  // 15: rBase (i32)
  // 16: quadCount (i32)
  // 17: qAddr (i32)

  const localget = (idx: number) => [0x20, ...encodeULEB128(idx)];
  const localset = (idx: number) => [0x21, ...encodeULEB128(idx)];
  const localtee = (idx: number) => [0x22, ...encodeULEB128(idx)];
  const i32const = (val: number) => [0x41, ...encodeSLEB128(val)];
  const i32load = (offset = 0) => [0x28, 0x02, ...encodeULEB128(offset)];
  const i32store = (offset = 0) => [0x36, 0x02, ...encodeULEB128(offset)];

  const EQZ = 0x45;
  const EQ = 0x46;
  const NE = 0x47;
  const LT_S = 0x48;
  const GE_S = 0x4e;
  const ADD = 0x6a;
  const MUL = 0x6c;
  const SHL = 0x74;
  const BLOCK = 0x02;
  const LOOP = 0x03;
  const IF = 0x04;
  const ELSE = 0x05;
  const END = 0x0b;
  const BR = 0x0c;
  const BR_IF = 0x0d;
  const VOID = 0x40;

  const codeBody: number[] = [
    // 1 local declaration group: 13 x i32
    0x01,
    13,
    I32,

    // quadCount = 0; j = 0;
    ...i32const(0),
    ...localset(16),
    ...i32const(0),
    ...localset(5),

    // Outer loop over j = 0 .. dimsV - 1
    BLOCK,
    VOID,
    LOOP,
    VOID,
    // if (j >= dimsV) break
    ...localget(5),
    ...localget(1),
    GE_S,
    BR_IF,
    1,

    // i = 0
    ...i32const(0),
    ...localset(6),

    // Inner loop over i = 0 .. dimsU - 1
    BLOCK,
    VOID,
    LOOP,
    VOID,
    // if (i >= dimsU) break
    ...localget(6),
    ...localget(0),
    GE_S,
    BR_IF,
    1,

    // idx = i + j * dimsU
    ...localget(6),
    ...localget(5),
    ...localget(0),
    MUL,
    ADD,
    ...localtee(7),

    // c = i32.load(maskOff + (idx << 2))
    ...i32const(2),
    SHL,
    ...localget(2),
    ADD,
    ...i32load(0),
    ...localtee(8),

    // if (c != 0)
    ...i32const(0),
    NE,
    IF,
    VOID,

    // w = 1
    ...i32const(1),
    ...localset(9),

    // Width expansion loop: while (i + w < dimsU && mask[idx + w] == c) w++
    BLOCK,
    VOID,
    LOOP,
    VOID,
    ...localget(6),
    ...localget(9),
    ADD,
    ...localget(0),
    GE_S,
    BR_IF,
    1,

    ...localget(7),
    ...localget(9),
    ADD,
    ...i32const(2),
    SHL,
    ...localget(2),
    ADD,
    ...i32load(0),
    ...localget(8),
    NE,
    BR_IF,
    1,

    ...localget(9),
    ...i32const(1),
    ADD,
    ...localset(9),
    BR,
    0,
    END,
    END,

    // h = 1; done = 0
    ...i32const(1),
    ...localset(10),
    ...i32const(0),
    ...localset(12),

    // Height expansion loop: while (j + h < dimsV)
    BLOCK,
    VOID,
    LOOP,
    VOID,
    ...localget(5),
    ...localget(10),
    ADD,
    ...localget(1),
    GE_S,
    BR_IF,
    1,

    // k = 0; rBase = idx + h * dimsU
    ...i32const(0),
    ...localset(11),
    ...localget(7),
    ...localget(10),
    ...localget(0),
    MUL,
    ADD,
    ...localset(15),

    // Row verification loop: for (k = 0; k < w; k++)
    BLOCK,
    VOID,
    LOOP,
    VOID,
    ...localget(11),
    ...localget(9),
    GE_S,
    BR_IF,
    1,

    ...localget(15),
    ...localget(11),
    ADD,
    ...i32const(2),
    SHL,
    ...localget(2),
    ADD,
    ...i32load(0),
    ...localget(8),
    NE,
    IF,
    VOID,
    ...i32const(1),
    ...localset(12),
    BR,
    2,
    END,

    ...localget(11),
    ...i32const(1),
    ADD,
    ...localset(11),
    BR,
    0,
    END,
    END,

    // if (done != 0) break height loop
    ...localget(12),
    BR_IF,
    1,

    // h++
    ...localget(10),
    ...i32const(1),
    ADD,
    ...localset(10),
    BR,
    0,
    END,
    END,

    // Zero out merged rectangle in mask: for (dy = 0; dy < h; dy++)
    ...i32const(0),
    ...localset(13),
    BLOCK,
    VOID,
    LOOP,
    VOID,
    ...localget(13),
    ...localget(10),
    GE_S,
    BR_IF,
    1,

    // rBase = idx + dy * dimsU; dx = 0
    ...localget(7),
    ...localget(13),
    ...localget(0),
    MUL,
    ADD,
    ...localset(15),
    ...i32const(0),
    ...localset(14),

    BLOCK,
    VOID,
    LOOP,
    VOID,
    ...localget(14),
    ...localget(9),
    GE_S,
    BR_IF,
    1,

    // mask[rBase + dx] = 0
    ...localget(15),
    ...localget(14),
    ADD,
    ...i32const(2),
    SHL,
    ...localget(2),
    ADD,
    ...i32const(0),
    ...i32store(0),

    ...localget(14),
    ...i32const(1),
    ADD,
    ...localset(14),
    BR,
    0,
    END,
    END,

    ...localget(13),
    ...i32const(1),
    ADD,
    ...localset(13),
    BR,
    0,
    END,
    END,

    // Emit quad (i, j, w, h, c) if quadCount < maxQuads
    ...localget(16),
    ...localget(4),
    LT_S,
    IF,
    VOID,
    // qAddr = outOff + quadCount * 20
    ...localget(3),
    ...localget(16),
    ...i32const(20),
    MUL,
    ADD,
    ...localtee(17),
    ...localget(6),
    ...i32store(0),

    ...localget(17),
    ...localget(5),
    ...i32store(4),

    ...localget(17),
    ...localget(9),
    ...i32store(8),

    ...localget(17),
    ...localget(10),
    ...i32store(12),

    ...localget(17),
    ...localget(8),
    ...i32store(16),

    ...localget(16),
    ...i32const(1),
    ADD,
    ...localset(16),
    END,

    // i = i + w
    ...localget(6),
    ...localget(9),
    ADD,
    ...localset(6),

    ELSE,
    // i = i + 1
    ...localget(6),
    ...i32const(1),
    ADD,
    ...localset(6),
    END,

    BR,
    0,
    END,
    END,

    // j = j + 1
    ...localget(5),
    ...i32const(1),
    ADD,
    ...localset(5),
    BR,
    0,
    END,
    END,

    // return quadCount
    ...localget(16),
    END,
  ];

  // Type section: 1 function type (i32, i32, i32, i32, i32) -> (i32)
  const typeSection = section(1, [
    1,
    0x60,
    5,
    I32,
    I32,
    I32,
    I32,
    I32,
    1,
    I32,
  ]);

  // Function section: 1 function of type 0
  const funcSection = section(3, [1, 0]);

  // Memory section: 1 memory, min 16 pages (1MB), max 64 pages (4MB)
  const memSection = section(5, [1, 0x01, 16, 64]);

  // Export section: export "memory" (mem 0) and "mergeMask2D" (func 0)
  const strMemory = Array.from(new TextEncoder().encode('memory'));
  const strMerge = Array.from(new TextEncoder().encode('mergeMask2D'));
  const exportSection = section(7, [
    2,
    strMemory.length,
    ...strMemory,
    0x02,
    0,
    strMerge.length,
    ...strMerge,
    0x00,
    0,
  ]);

  // Code section
  const funcBodyWithLen = [...encodeULEB128(codeBody.length), ...codeBody];
  const codeSection = section(10, [1, ...funcBodyWithLen]);

  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d, // \0asm
    0x01,
    0x00,
    0x00,
    0x00, // version 1
    ...typeSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
  ]);
}

let _wasmExports: WasmGreedyKernelExports | null = null;
let _wasmMaskView: Int32Array | null = null;
let _wasmQuadsView: Int32Array | null = null;

/** Byte offset of the 2D mask inside WASM linear memory (aligned to 64 bytes) */
export const WASM_MASK_BYTE_OFFSET = 64;
/** Capacity for up to 64 * 320 = 20,480 mask cells (81,920 bytes) */
export const WASM_MAX_MASK_CELLS = 65536;
/** Byte offset of the output quad buffer inside WASM linear memory */
export const WASM_QUADS_BYTE_OFFSET = WASM_MASK_BYTE_OFFSET + WASM_MAX_MASK_CELLS * 4;
/** Maximum quads per 2D slice (65,536 quads * 20 bytes = ~320KB) */
export const WASM_MAX_QUADS_PER_SLICE = 32768;

export function getWasmGreedyKernel(): {
  exports: WasmGreedyKernelExports;
  maskView: Int32Array;
  quadsView: Int32Array;
} | null {
  if (_wasmExports && _wasmMaskView && _wasmQuadsView) {
    return {
      exports: _wasmExports,
      maskView: _wasmMaskView,
      quadsView: _wasmQuadsView,
    };
  }
  try {
    const bytes = buildWasmGreedyMesherBytes();
    const mod = new WebAssembly.Module(bytes as BufferSource);
    const inst = new WebAssembly.Instance(mod, {});
    _wasmExports = inst.exports as unknown as WasmGreedyKernelExports;
    _wasmMaskView = new Int32Array(
      _wasmExports.memory.buffer,
      WASM_MASK_BYTE_OFFSET,
      WASM_MAX_MASK_CELLS,
    );
    _wasmQuadsView = new Int32Array(
      _wasmExports.memory.buffer,
      WASM_QUADS_BYTE_OFFSET,
      WASM_MAX_QUADS_PER_SLICE * 5,
    );
    return {
      exports: _wasmExports,
      maskView: _wasmMaskView,
      quadsView: _wasmQuadsView,
    };
  } catch {
    return null;
  }
}
