/* tslint:disable */
/* eslint-disable */

export class HighDensitySolverA01Wasm {
  free(): void;
  [Symbol.dispose](): void;
  error(): string | undefined;
  get_output(): any;
  get_state(): any;
  is_failed(): boolean;
  is_solved(): boolean;
  constructor(props: any);
  run(max_steps?: number | null): void;
  setup(): void;
  step(): void;
}

export function solve_high_density_a01(props: any): any;

export type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

export function initSync(
  module: { module: SyncInitInput } | SyncInitInput,
): InitOutput;

export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<InitOutput>;
