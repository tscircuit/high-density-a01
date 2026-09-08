import { a03SearchWasmBase64 } from "./a03SearchWasmBytes"
import {
  decodeNativeA03Snapshot,
  type NativeA03Snapshot,
} from "./decodeNativeA03Snapshot"
import {
  decodeNativeA03DistanceSnapshot,
  type NativeA03DistanceSnapshot,
  type NativeA03DistanceTable,
} from "./decodeNativeA03DistanceSnapshot"
import { decodeNativeA03Materialization } from "./decodeNativeA03Materialization"
import { restoreNativeA03DistanceViews } from "./restoreNativeA03DistanceViews"

export type NativeA03Costs = {
  viaBaseCost: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  greedyMultiplier: number
  penaltyCap: number
}

export type NativeA03Graph = {
  planeSize: number
  layers: number
  cellCenterX: Float64Array
  cellCenterY: Float64Array
  neighborOffset: Int32Array
  neighborIds: Int32Array
  neighborCosts: Float32Array
  viaAllowed: Uint8Array
}

export type NativeA03Owners = {
  usedCells: Int32Array
  portOwners: Int32Array
  sharedOffsets: Int32Array
  sharedIds: Int32Array
  penalties: Float64Array
  rootOverlap: Uint8Array
}

export type NativeA03Start = NativeA03Costs & {
  stamp: number
  activeConnId: number
  startZ: number
  startCellId: number
  endZ: number
  endCellId: number
  startF: number
  clearStamps: boolean
}

export type NativeA03Host = {
  getFootprint(cellId: number): Int32Array
}

type KernelExports = {
  memory: WebAssembly.Memory
  a03_abi_version(): number
  a03_setup(
    plane: number,
    layers: number,
    edges: number,
    shared: number,
    owners: number,
  ): number
  a03_resize_shared(length: number): void
  a03_pointer(kind: number): number
  a03_length(kind: number): number
  a03_validate_inputs(): number
  a03_validate_graph(): number
  a03_begin(
    stamp: number,
    active: number,
    startZ: number,
    startCell: number,
    endZ: number,
    endCell: number,
    startF: number,
    clearStamps: number,
    via: number,
    rip: number,
    traceRip: number,
    viaRip: number,
    greedy: number,
    cap: number,
  ): number
  a03_advance(
    via: number,
    rip: number,
    traceRip: number,
    viaRip: number,
    greedy: number,
    cap: number,
  ): number
  a03_advance_many(
    limit: number,
    via: number,
    rip: number,
    traceRip: number,
    viaRip: number,
    greedy: number,
    cap: number,
  ): number
  a03_advance_guarded(
    via: number,
    rip: number,
    traceRip: number,
    viaRip: number,
    greedy: number,
    cap: number,
  ): number
  a03_advance_many_guarded(
    limit: number,
    via: number,
    rip: number,
    traceRip: number,
    viaRip: number,
    greedy: number,
    cap: number,
  ): number
  a03_publish_state(): void
  a03_collect_goal(): void
  a03_export_snapshot(): void
  a03_export_materialization(): void
  a03_seed_distance(
    goal: number,
    cell: number,
    dx: number,
    dy: number,
    distance: number,
  ): number
  a03_export_distance_cache(): void
  a03_export_distance_views(): void
  a03_clear(): void
}

type OwnerContext = {
  owner: NativeA03Host | null
  exports: KernelExports | null
}
type InstanceEntry = { exports: KernelExports; context: OwnerContext }
type NumericArray =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | Uint8Array

const NativeUint8Array = Uint8Array
const NativeUint32Array = Uint32Array
const NativeInt32Array = Int32Array
const NativeFloat32Array = Float32Array
const NativeFloat64Array = Float64Array
const NativeDataView = DataView
const nativeArrayBufferPrototype = ArrayBuffer.prototype
const nativeIsView = ArrayBuffer.isView
const nativeGetPrototype = Object.getPrototypeOf
const nativeOwnDescriptor = Object.getOwnPropertyDescriptor
const nativeIsInteger = Number.isInteger
const nativeIsSafeInteger = Number.isSafeInteger
const nativeArrayPop = Array.prototype.pop
const nativeArrayPush = Array.prototype.push
const nativeBufferSize = nativeOwnDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!
const nativeMemoryBuffer =
  typeof WebAssembly === "undefined"
    ? undefined
    : nativeOwnDescriptor(WebAssembly.Memory.prototype, "buffer")!.get!

const MAX_NATIVE_CELLS = 1_048_576
const MAX_IDLE_INSTANCES = 4
const MAX_IDLE_MEMORY_BYTES = 32 * 1024 * 1024
const idleInstances: InstanceEntry[] = []
const nativeHypot = Math.hypot
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const typedArraySet = typedArrayPrototype.set
const typedArrayLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
)!.get!
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)!.get!
const apply = Reflect.apply
let compiledModule: WebAssembly.Module | null | undefined

function kernelBuffer(exports: KernelExports): ArrayBuffer {
  if (!nativeMemoryBuffer) throw new Error("WebAssembly memory is unavailable")
  return apply(nativeMemoryBuffer, exports.memory, []) as ArrayBuffer
}

function hasArrayShape(
  value: NumericArray,
  prototype: object,
  length: number,
): boolean {
  if (
    !nativeIsView(value) ||
    nativeGetPrototype(value) !== prototype ||
    nativeOwnDescriptor(value, "length") !== undefined
  )
    return false
  if (apply(typedArrayLength, value, []) !== length) return false
  const buffer = apply(typedArrayBuffer, value, []) as ArrayBuffer
  if (nativeGetPrototype(buffer) !== nativeArrayBufferPrototype) return false
  if (length === 0) {
    // A detached zero-length input must select JS before a copying operation.
    try {
      new NativeDataView(buffer, 0, 0)
    } catch {
      return false
    }
  }
  return true
}

export function canRunNativeA03Graph(graph: NativeA03Graph): boolean {
  const cells = graph.planeSize * graph.layers
  if (
    !nativeIsInteger(graph.planeSize) ||
    graph.planeSize <= 0 ||
    !nativeIsInteger(graph.layers) ||
    graph.layers <= 0 ||
    !nativeIsSafeInteger(cells) ||
    cells > MAX_NATIVE_CELLS ||
    !nativeIsView(graph.neighborIds) ||
    nativeGetPrototype(graph.neighborIds) !== NativeInt32Array.prototype
  )
    return false
  const edges = apply(typedArrayLength, graph.neighborIds, []) as number
  return (
    hasArrayShape(
      graph.cellCenterX,
      NativeFloat64Array.prototype,
      graph.planeSize,
    ) &&
    hasArrayShape(
      graph.cellCenterY,
      NativeFloat64Array.prototype,
      graph.planeSize,
    ) &&
    hasArrayShape(
      graph.neighborOffset,
      NativeInt32Array.prototype,
      graph.planeSize + 1,
    ) &&
    hasArrayShape(graph.neighborIds, NativeInt32Array.prototype, edges) &&
    hasArrayShape(graph.neighborCosts, NativeFloat32Array.prototype, edges) &&
    hasArrayShape(graph.viaAllowed, NativeUint8Array.prototype, graph.planeSize)
  )
}

function hasOwnerShape(
  graph: NativeA03Graph,
  owners: NativeA03Owners,
): boolean {
  const cells = graph.planeSize * graph.layers
  if (
    !nativeIsView(owners.sharedIds) ||
    !nativeIsView(owners.rootOverlap) ||
    nativeGetPrototype(owners.sharedIds) !== NativeInt32Array.prototype ||
    nativeGetPrototype(owners.rootOverlap) !== NativeUint8Array.prototype
  )
    return false
  const sharedCount = apply(typedArrayLength, owners.sharedIds, []) as number
  const ownerCount = apply(typedArrayLength, owners.rootOverlap, []) as number
  return (
    hasArrayShape(owners.usedCells, NativeInt32Array.prototype, cells) &&
    hasArrayShape(owners.portOwners, NativeInt32Array.prototype, cells) &&
    hasArrayShape(
      owners.sharedOffsets,
      NativeInt32Array.prototype,
      cells + 1,
    ) &&
    hasArrayShape(owners.sharedIds, NativeInt32Array.prototype, sharedCount) &&
    hasArrayShape(
      owners.penalties,
      NativeFloat64Array.prototype,
      graph.planeSize,
    ) &&
    hasArrayShape(owners.rootOverlap, NativeUint8Array.prototype, ownerCount)
  )
}

/** Optional exact graph-search backend. Ordinary TS owns scheduling and finalization. */
export class NativeA03SearchKernel {
  private entry: InstanceEntry | null
  private state = new NativeUint32Array(0)
  private executing = false
  private planeSize: number
  private layers: number

  static create(
    graph: NativeA03Graph,
    owners: NativeA03Owners,
    host: NativeA03Host,
  ): NativeA03SearchKernel | null {
    if (!canRunNativeA03Graph(graph) || !hasOwnerShape(graph, owners))
      return null
    if (compiledModule === undefined) {
      try {
        const bytes = Uint8Array.from(atob(a03SearchWasmBase64), (char) =>
          char.charCodeAt(0),
        )
        compiledModule = new WebAssembly.Module(bytes)
      } catch {
        compiledModule = null
      }
    }
    if (!compiledModule) return null
    let entry = apply(nativeArrayPop, idleInstances, []) as
      | InstanceEntry
      | undefined
    if (!entry) {
      const context: OwnerContext = { owner: null, exports: null }
      let instance: WebAssembly.Instance
      try {
        instance = new WebAssembly.Instance(compiledModule, {
          a03_host: {
            hypot: nativeHypot,
            footprint(
              cell: number,
              destination: number,
              capacity: number,
            ): number {
              if (!context.owner || !context.exports)
                throw new Error("Released native A03 host")
              const cells = context.owner.getFootprint(cell)
              if (cells.length > capacity)
                throw new Error(
                  "Native A03 footprint exceeds transfer capacity",
                )
              const target = new NativeInt32Array(
                kernelBuffer(context.exports),
                destination,
                capacity,
              )
              apply(typedArraySet, target, [cells])
              return cells.length
            },
          },
        })
      } catch {
        return null
      }
      const exports = instance.exports as unknown as KernelExports
      if (exports.a03_abi_version() !== 1)
        throw new Error("Unsupported native A03 ABI")
      context.exports = exports
      entry = { exports, context }
    }
    entry.context.owner = host
    const kernel = new NativeA03SearchKernel(entry, graph)
    try {
      if (
        !entry.exports.a03_setup(
          graph.planeSize,
          graph.layers,
          graph.neighborIds.length,
          owners.sharedIds.length,
          owners.rootOverlap.length,
        )
      ) {
        kernel.release()
        return null
      }
      kernel.copyGraph(graph)
      kernel.copyOwners(owners)
      if (!entry.exports.a03_validate_inputs()) {
        kernel.release()
        return null
      }
      kernel.refreshState()
      return kernel
    } catch (error) {
      entry.context.owner = null
      throw error
    }
  }

  private constructor(entry: InstanceEntry, graph: NativeA03Graph) {
    this.entry = entry
    this.planeSize = graph.planeSize
    this.layers = graph.layers
  }

  private get exports(): KernelExports {
    if (!this.entry)
      throw new Error("Native A03 search kernel has been released")
    return this.entry.exports
  }

  private assertIdle(): void {
    if (this.executing)
      throw new Error("Native A03 search cannot reenter itself")
  }

  private refreshState(): void {
    const exports = this.exports
    this.state = new NativeUint32Array(
      kernelBuffer(exports),
      exports.a03_pointer(30),
      8,
    )
  }

  private write(kind: number, source: NumericArray): void {
    const exports = this.exports
    const length = apply(typedArrayLength, source, []) as number
    if (exports.a03_length(kind) !== length)
      throw new Error("Native A03 input length mismatch")
    const pointer = exports.a03_pointer(kind)
    const buffer = kernelBuffer(exports)
    const prototype = nativeGetPrototype(source)
    let target: NumericArray
    if (prototype === NativeFloat64Array.prototype)
      target = new NativeFloat64Array(buffer, pointer, length)
    else if (prototype === NativeFloat32Array.prototype)
      target = new NativeFloat32Array(buffer, pointer, length)
    else if (prototype === NativeInt32Array.prototype)
      target = new NativeInt32Array(buffer, pointer, length)
    else if (prototype === NativeUint32Array.prototype)
      target = new NativeUint32Array(buffer, pointer, length)
    else target = new NativeUint8Array(buffer, pointer, length)
    apply(typedArraySet, target, [source])
  }

  copyGraph(graph: NativeA03Graph): void {
    this.assertIdle()
    this.write(1, graph.cellCenterX)
    this.write(2, graph.cellCenterY)
    this.write(3, graph.neighborOffset)
    this.write(4, graph.neighborIds)
    this.write(5, graph.neighborCosts)
    this.write(6, graph.viaAllowed)
  }

  canCopyGraph(graph: NativeA03Graph): boolean {
    this.assertIdle()
    return (
      canRunNativeA03Graph(graph) &&
      graph.planeSize === this.planeSize &&
      graph.layers === this.layers &&
      apply(typedArrayLength, graph.neighborIds, []) ===
        this.exports.a03_length(4)
    )
  }

  copyOwners(owners: NativeA03Owners): void {
    this.assertIdle()
    if (this.exports.a03_length(10) !== owners.sharedIds.length)
      this.exports.a03_resize_shared(owners.sharedIds.length)
    this.write(7, owners.usedCells)
    this.write(8, owners.portOwners)
    this.write(9, owners.sharedOffsets)
    this.write(10, owners.sharedIds)
    this.write(11, owners.penalties)
    this.write(12, owners.rootOverlap)
  }

  validateInputs(): boolean {
    this.assertIdle()
    return this.exports.a03_validate_inputs() === 1
  }

  validateGraph(): boolean {
    this.assertIdle()
    return this.exports.a03_validate_graph() === 1
  }

  begin(start: NativeA03Start): boolean {
    this.assertIdle()
    const result = this.exports.a03_begin(
      start.stamp,
      start.activeConnId,
      start.startZ,
      start.startCellId,
      start.endZ,
      start.endCellId,
      start.startF,
      start.clearStamps ? 1 : 0,
      start.viaBaseCost,
      start.ripCost,
      start.ripTracePenalty,
      start.ripViaPenalty,
      start.greedyMultiplier,
      start.penaltyCap,
    )
    this.refreshState()
    return result === 1
  }

  advance(costs: NativeA03Costs): number {
    return this.runAdvance(0, costs, false)
  }
  advanceMany(limit: number, costs: NativeA03Costs): number {
    return this.runAdvance(limit, costs, true)
  }

  advanceGuarded(costs: NativeA03Costs): number {
    return this.runAdvance(0, costs, false, true)
  }

  advanceManyGuarded(limit: number, costs: NativeA03Costs): number {
    return this.runAdvance(limit, costs, true, true)
  }

  private runAdvance(
    limit: number,
    costs: NativeA03Costs,
    batch: boolean,
    guarded = false,
  ): number {
    if (this.executing)
      throw new Error("Native A03 search cannot reenter itself")
    const exports = this.exports
    this.executing = true
    try {
      const ordinary = guarded
        ? exports.a03_advance_guarded
        : exports.a03_advance
      const many = guarded
        ? exports.a03_advance_many_guarded
        : exports.a03_advance_many
      const result = batch
        ? many(
            limit,
            costs.viaBaseCost,
            costs.ripCost,
            costs.ripTracePenalty,
            costs.ripViaPenalty,
            costs.greedyMultiplier,
            costs.penaltyCap,
          )
        : ordinary(
            costs.viaBaseCost,
            costs.ripCost,
            costs.ripTracePenalty,
            costs.ripViaPenalty,
            costs.greedyMultiplier,
            costs.penaltyCap,
          )
      this.refreshState()
      return result
    } catch (error) {
      // JS import exceptions expose the partial heap in the original A03.
      exports.a03_publish_state()
      this.refreshState()
      throw error
    } finally {
      this.executing = false
    }
  }

  get heapSize(): number {
    return this.state[1]!
  }
  get lastStatus(): number {
    return this.state[0]!
  }
  get goalNodeId(): number {
    return this.state[2]! | 0
  }
  get lastAttempts(): number {
    return this.state[3]!
  }
  get lastCompleted(): number {
    return this.state[4]!
  }

  snapshot(): NativeA03Snapshot {
    this.assertIdle()
    const exports = this.exports
    exports.a03_export_snapshot()
    this.refreshState()
    return decodeNativeA03Snapshot(
      kernelBuffer(exports),
      exports.a03_pointer(40),
      exports.a03_length(40),
    )
  }

  materializationSnapshot(): NativeA03Snapshot {
    this.assertIdle()
    const exports = this.exports
    exports.a03_export_materialization()
    this.refreshState()
    return decodeNativeA03Materialization(
      kernelBuffer(exports),
      exports.a03_pointer(42),
      exports.a03_length(42),
    )
  }

  seedDistance(
    goal: number,
    cell: number,
    dx: number,
    dy: number,
    distance: number,
  ): boolean {
    this.assertIdle()
    const result = this.exports.a03_seed_distance(goal, cell, dx, dy, distance)
    this.refreshState()
    return result === 1
  }

  distanceSnapshot(): NativeA03DistanceSnapshot {
    this.assertIdle()
    const exports = this.exports
    exports.a03_export_distance_cache()
    this.refreshState()
    return decodeNativeA03DistanceSnapshot(
      kernelBuffer(exports),
      exports.a03_pointer(41),
      exports.a03_length(41),
    )
  }

  restoreDistanceCache(target: Map<number, NativeA03DistanceTable>): {
    capacity: number
    slots: number
  } {
    this.assertIdle()
    const exports = this.exports
    exports.a03_export_distance_views()
    this.refreshState()
    return restoreNativeA03DistanceViews(
      kernelBuffer(exports),
      exports.a03_pointer(43),
      exports.a03_length(43),
      target,
    )
  }

  copyVisitedFlatTo(target: Uint32Array): void {
    this.assertIdle()
    const exports = this.exports
    const source = new NativeUint32Array(
      kernelBuffer(exports),
      exports.a03_pointer(21),
      exports.a03_length(21),
    )
    apply(typedArraySet, target, [source])
  }

  release(): void {
    const entry = this.entry
    if (!entry) return
    if (this.executing)
      throw new Error("Cannot release an executing native A03 search")
    this.entry = null
    this.state = new NativeUint32Array(0)
    entry.context.owner = null
    entry.exports.a03_clear()
    if (
      idleInstances.length < MAX_IDLE_INSTANCES &&
      apply(nativeBufferSize, kernelBuffer(entry.exports), []) <=
        MAX_IDLE_MEMORY_BYTES
    )
      apply(nativeArrayPush, idleInstances, [entry])
  }
}
