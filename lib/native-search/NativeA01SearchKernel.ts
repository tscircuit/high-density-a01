import { a01SearchWasmBase64 } from "./a01SearchWasmBytes"

export type NativeA01Costs = {
  cellSizeMm: number
  viaBaseCost: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  greedyMultiplier: number
  penaltyCap: number
}
export type NativeA01SearchInput = NativeA01Costs & {
  rows: number
  cols: number
  layers: number
  startZ: number
  startRow: number
  startCol: number
  endZ: number
  endRow: number
  endCol: number
  activeConnId: number
  minViaRow: number
  maxViaRow: number
  minViaCol: number
  maxViaCol: number
  stamp: number
  usedCells: Int32Array
  portOwners: Int32Array
  usedDiagonals: Int32Array
  penalties: Float64Array
  rootOverlap: Uint8Array
  viaOffsetsDr: Int32Array
  viaOffsetsDc: Int32Array
}
type KernelExports = {
  memory: WebAssembly.Memory
  kernel_setup(
    rows: number,
    cols: number,
    layers: number,
    offsets: number,
    owners: number,
  ): void
  kernel_pointer(kind: number): number
  kernel_begin(
    stamp: number,
    cell: number,
    via: number,
    rip: number,
    trace: number,
    viaRip: number,
    greedy: number,
    cap: number,
  ): void
  kernel_advance(
    cell: number,
    via: number,
    rip: number,
    trace: number,
    viaRip: number,
    greedy: number,
    cap: number,
  ): number
  kernel_collect_goal(): void
  kernel_advance_many(
    limit: number,
    cell: number,
    via: number,
    rip: number,
    trace: number,
    viaRip: number,
    greedy: number,
    cap: number,
  ): number
  kernel_clear(): void
}

const MAX_NATIVE_CELLS = 1_048_576
const MAX_IDLE_INSTANCES = 4
const MAX_IDLE_MEMORY_BYTES = 32 * 1024 * 1024
// Only explicitly released owners enter this bounded idle pool. Live solvers
// are never registered here, so abandoning one still lets GC reclaim it.
const idleExports: KernelExports[] = []
const releasedBuffer = new ArrayBuffer(0)
const releasedState = new Uint32Array(releasedBuffer)
const throwReleased = (): never => {
  throw new Error("Native A01 search kernel has been released")
}
const releasedExports: KernelExports = Object.freeze({
  get memory(): WebAssembly.Memory {
    return throwReleased()
  },
  kernel_setup: throwReleased,
  kernel_pointer: throwReleased,
  kernel_begin: throwReleased,
  kernel_advance: throwReleased,
  kernel_collect_goal: throwReleased,
  kernel_clear: throwReleased,
})
let compiledModule: WebAssembly.Module | null | undefined

/** Select capability before starting a connection, never after a native pop. */
export function canRunNativeA01Search(input: NativeA01SearchInput): boolean {
  const { rows, cols, layers } = input
  const cells = rows * cols * layers
  if (
    !Number.isInteger(input.stamp) ||
    input.stamp < 1 ||
    input.stamp > 0xffff_ffff
  )
    return false
  if (
    ![rows, cols, layers].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    !Number.isSafeInteger(cells) ||
    cells > MAX_NATIVE_CELLS
  )
    return false
  for (const [value, bound] of [
    [input.startZ, layers],
    [input.endZ, layers],
    [input.startRow, rows],
    [input.endRow, rows],
    [input.startCol, cols],
    [input.endCol, cols],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value >= bound) return false
  }
  if (
    !Number.isInteger(input.activeConnId) ||
    input.activeConnId < 0 ||
    input.activeConnId >= input.rootOverlap.length
  )
    return false
  if (
    ![
      input.cellSizeMm,
      input.viaBaseCost,
      input.ripCost,
      input.ripTracePenalty,
      input.ripViaPenalty,
      input.greedyMultiplier,
      input.penaltyCap,
    ].every((value) => Number.isFinite(value) && value >= 0) ||
    input.cellSizeMm === 0
  )
    return false
  if (
    ![input.minViaRow, input.maxViaRow, input.minViaCol, input.maxViaCol].every(
      Number.isFinite,
    )
  )
    return false
  if (
    input.usedCells.length !== cells ||
    input.portOwners.length !== cells ||
    input.penalties.length !== rows * cols ||
    input.usedDiagonals.length !== layers * (rows - 1) * (cols - 1) * 2 ||
    input.viaOffsetsDr.length !== input.viaOffsetsDc.length
  )
    return false
  for (const penalty of input.penalties)
    if (!Number.isFinite(penalty) || penalty < 0) return false
  for (let i = 0; i < input.viaOffsetsDr.length; i++) {
    const dr = input.viaOffsetsDr[i]!,
      dc = input.viaOffsetsDc[i]!
    if (
      Math.abs(dr) + rows > 2_147_483_647 ||
      Math.abs(dc) + cols > 2_147_483_647 ||
      Math.abs(dr * cols) + Math.abs(dc) > 2_147_483_647
    )
      return false
  }
  return true
}

export class NativeA01SearchKernel {
  private exports: KernelExports
  private statePointer: number
  private state: Uint32Array
  private buffer: ArrayBufferLike
  private cells: number
  private currentHeapSize = 0

  static create(input: NativeA01SearchInput): NativeA01SearchKernel | null {
    // CSP/module availability is a capability decision made before search.
    // A runtime trap in an initialized kernel is never silently retried in JS.
    if (compiledModule === undefined) {
      try {
        const bytes = Uint8Array.from(atob(a01SearchWasmBase64), (char) =>
          char.charCodeAt(0),
        )
        compiledModule = new WebAssembly.Module(bytes)
      } catch {
        compiledModule = null
      }
    }
    if (!compiledModule) return null
    const pooled = idleExports.pop()
    if (pooled) return new NativeA01SearchKernel(pooled, input)
    let instance: WebAssembly.Instance
    try {
      instance = new WebAssembly.Instance(compiledModule)
    } catch {
      return null
    }
    return new NativeA01SearchKernel(
      instance.exports as unknown as KernelExports,
      input,
    )
  }

  private constructor(exports: KernelExports, input: NativeA01SearchInput) {
    this.exports = exports
    this.cells = input.rows * input.cols * input.layers
    exports.kernel_setup(
      input.rows,
      input.cols,
      input.layers,
      input.viaOffsetsDr.length,
      input.rootOverlap.length,
    )
    this.statePointer = exports.kernel_pointer(8)
    this.buffer = exports.memory.buffer
    this.state = new Uint32Array(this.buffer, this.statePointer, 5)
    // Port ownership and the ordered footprint offsets are immutable per solver.
    new Int32Array(
      this.buffer,
      exports.kernel_pointer(1),
      input.portOwners.length,
    ).set(input.portOwners)
    new Int32Array(
      this.buffer,
      exports.kernel_pointer(5),
      input.viaOffsetsDr.length,
    ).set(input.viaOffsetsDr)
    new Int32Array(
      this.buffer,
      exports.kernel_pointer(6),
      input.viaOffsetsDc.length,
    ).set(input.viaOffsetsDc)
  }

  get heapSize(): number {
    return this.currentHeapSize
  }

  get lastBatchAttempts(): number {
    return this.state[3]!
  }

  get lastBatchCompleted(): number {
    return this.state[4]!
  }

  begin(input: NativeA01SearchInput): void {
    const exports = this.exports
    const buffer = exports.memory.buffer
    new Int32Array(
      buffer,
      exports.kernel_pointer(0),
      input.usedCells.length,
    ).set(input.usedCells)
    new Int32Array(
      buffer,
      exports.kernel_pointer(2),
      input.usedDiagonals.length,
    ).set(input.usedDiagonals)
    new Float64Array(
      buffer,
      exports.kernel_pointer(3),
      input.penalties.length,
    ).set(input.penalties)
    new Uint8Array(
      buffer,
      exports.kernel_pointer(4),
      input.rootOverlap.length,
    ).set(input.rootOverlap)
    new Float64Array(buffer, exports.kernel_pointer(7), 11).set([
      input.startZ,
      input.startRow,
      input.startCol,
      input.endZ,
      input.endRow,
      input.endCol,
      input.activeConnId,
      input.minViaRow,
      input.maxViaRow,
      input.minViaCol,
      input.maxViaCol,
    ])
    exports.kernel_begin(
      input.stamp,
      input.cellSizeMm,
      input.viaBaseCost,
      input.ripCost,
      input.ripTracePenalty,
      input.ripViaPenalty,
      input.greedyMultiplier,
      input.penaltyCap,
    )
    this.refreshState()
  }

  advance(
    cellSizeMm: number,
    costs: Omit<NativeA01Costs, "cellSizeMm" | "penaltyCap">,
    penaltyCap: number,
  ): number {
    const status = this.exports.kernel_advance(
      cellSizeMm,
      costs.viaBaseCost,
      costs.ripCost,
      costs.ripTracePenalty,
      costs.ripViaPenalty,
      costs.greedyMultiplier,
      penaltyCap,
    )
    this.refreshState()
    return status
  }

  private refreshState(): void {
    const buffer = this.exports.memory.buffer
    if (buffer !== this.buffer) {
      this.buffer = buffer
      this.state = new Uint32Array(buffer, this.statePointer, 5)
    }
    this.currentHeapSize = this.state[0]!
  }

  advanceMany(
    limit: number,
    cellSizeMm: number,
    costs: Omit<NativeA01Costs, "cellSizeMm" | "penaltyCap">,
    penaltyCap: number,
  ): number {
    // A trap must expose the attempted call and the last completed heap view;
    // the solver then reproduces BaseSolver.step's increment-before-throw state.
    this.state[3] = 0
    this.state[4] = 0
    try {
      const completed = this.exports.kernel_advance_many(
        limit,
        cellSizeMm,
        costs.viaBaseCost,
        costs.ripCost,
        costs.ripTracePenalty,
        costs.ripViaPenalty,
        costs.greedyMultiplier,
        penaltyCap,
      )
      this.refreshState()
      return completed
    } catch (error) {
      this.refreshState()
      throw error
    }
  }

  readGoal(): { cellIds: Float64Array; rippedIds: Int32Array } {
    this.exports.kernel_collect_goal()
    this.refreshState()
    const cellIds = new Float64Array(
      this.buffer,
      this.exports.kernel_pointer(10),
      this.state[1]!,
    ).slice()
    const rippedIds = new Int32Array(
      this.buffer,
      this.exports.kernel_pointer(11),
      this.state[2]!,
    ).slice()
    return { cellIds, rippedIds }
  }

  copyVisitedTo(target: Uint32Array): void {
    // Read memory.buffer on demand: growing a pool can detach older JS views.
    target.set(
      new Uint32Array(
        this.exports.memory.buffer,
        this.exports.kernel_pointer(9),
        this.cells,
      ),
    )
  }

  clear(): void {
    this.exports.kernel_clear()
    this.refreshState()
  }

  /** Relinquish this owner; no further kernel operations are permitted. */
  release(): void {
    const exports = this.exports
    if (exports === releasedExports) return
    // Invalidate first, including views that would otherwise retain old memory.
    // A saved bridge cannot clear or advance a later borrower's search.
    this.exports = releasedExports
    this.buffer = releasedBuffer
    this.state = releasedState
    this.currentHeapSize = 0
    exports.kernel_clear()
    if (
      idleExports.length < MAX_IDLE_INSTANCES &&
      exports.memory.buffer.byteLength <= MAX_IDLE_MEMORY_BYTES
    ) {
      idleExports.push(exports)
    }
  }
}
