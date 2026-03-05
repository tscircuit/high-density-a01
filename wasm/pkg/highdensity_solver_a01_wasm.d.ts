/* tslint:disable */
/* eslint-disable */

export class HighDensitySolverA01Wasm {
  free(): void
  [Symbol.dispose](): void
  error(): string | undefined
  get_output(): any
  get_state(): any
  is_failed(): boolean
  is_solved(): boolean
  constructor(props: any)
  /**
   * Run until solved/failed, or until `max_steps` (if provided).
   */
  run(max_steps?: number | null): void
  /**
   * Equivalent to TS `_setup()`.
   */
  setup(): void
  /**
   * Equivalent to TS `_step()`.
   */
  step(): void
}

/**
 * Convenience helper: run the entire solve in one call.
 */
export function solve_high_density_a01(props: any): any

export type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module

export interface InitOutput {
  readonly memory: WebAssembly.Memory
  readonly __wbg_highdensitysolvera01wasm_free: (a: number, b: number) => void
  readonly highdensitysolvera01wasm_error: (a: number) => [number, number]
  readonly highdensitysolvera01wasm_get_output: (
    a: number,
  ) => [number, number, number]
  readonly highdensitysolvera01wasm_get_state: (
    a: number,
  ) => [number, number, number]
  readonly highdensitysolvera01wasm_is_failed: (a: number) => number
  readonly highdensitysolvera01wasm_is_solved: (a: number) => number
  readonly highdensitysolvera01wasm_new: (a: any) => [number, number, number]
  readonly highdensitysolvera01wasm_run: (a: number, b: number) => void
  readonly highdensitysolvera01wasm_setup: (a: number) => void
  readonly highdensitysolvera01wasm_step: (a: number) => void
  readonly solve_high_density_a01: (a: any) => [number, number, number]
  readonly __wbindgen_malloc: (a: number, b: number) => number
  readonly __wbindgen_realloc: (
    a: number,
    b: number,
    c: number,
    d: number,
  ) => number
  readonly __wbindgen_exn_store: (a: number) => void
  readonly __externref_table_alloc: () => number
  readonly __wbindgen_externrefs: WebAssembly.Table
  readonly __wbindgen_free: (a: number, b: number, c: number) => void
  readonly __externref_table_dealloc: (a: number) => void
  readonly __wbindgen_start: () => void
}

export type SyncInitInput = BufferSource | WebAssembly.Module

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(
  module: { module: SyncInitInput } | SyncInitInput,
): InitOutput

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<InitOutput>
