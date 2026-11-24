/**
 * onnxruntime-web's WebAssembly runtime served from our own origin.
 *
 * transformers.js otherwise loads it from cdn.jsdelivr.net, which the production
 * Content-Security-Policy (script-src 'self') refuses, so on-device AI (Whisper, background
 * removal) would only work in development. Vite copies these files into the build with a
 * content hash, so they are cached like any other asset.
 */
import asyncifyMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import asyncifyWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import plainMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import plainWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

/** Same rule transformers.js uses: Safari before 26 without WebGPU can't run the asyncify build. */
export function needsPlainOrtBuild(userAgent: string, hasWebGpu: boolean): boolean {
  if (hasWebGpu) return false;
  const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(userAgent);
  const version = Number(/Version\/(\d+)/.exec(userAgent)?.[1] ?? 'NaN');
  return safari && Number.isFinite(version) && version < 26;
}

interface OnnxEnvLike {
  backends?: { onnx?: { wasm?: { wasmPaths?: unknown } } };
  useWasmCache?: boolean;
}

/** Points transformers.js at the self-hosted runtime. Call after importing it, before `pipeline()`. */
export function useLocalOrt(env: OnnxEnvLike): void {
  const wasm = env.backends?.onnx?.wasm;
  if (!wasm || typeof navigator === 'undefined') return;
  // With its WASM cache on, transformers.js re-serves the runtime script from a blob: URL, which
  // the production CSP (script-src 'self') refuses: "no available backend found". Our runtime is
  // a hashed same-origin asset the browser already caches, so the extra cache adds nothing.
  env.useWasmCache = false;
  const plain = needsPlainOrtBuild(navigator.userAgent, 'gpu' in navigator);
  wasm.wasmPaths = plain ? { mjs: plainMjs, wasm: plainWasm } : { mjs: asyncifyMjs, wasm: asyncifyWasm };
}
