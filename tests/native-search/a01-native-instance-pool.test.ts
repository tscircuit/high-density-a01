import { expect, test } from "bun:test"
import {
  NativeA01SearchKernel,
  type NativeA01SearchInput,
} from "../../lib/native-search/NativeA01SearchKernel"

const inputFor = (rows = 1, cols = 1, layers = 1): NativeA01SearchInput => ({
  rows,
  cols,
  layers,
  startZ: 0,
  startRow: 0,
  startCol: 0,
  endZ: layers - 1,
  endRow: rows - 1,
  endCol: cols - 1,
  activeConnId: 0,
  minViaRow: 0,
  maxViaRow: rows - 1,
  minViaCol: 0,
  maxViaCol: cols - 1,
  stamp: 1,
  cellSizeMm: 0.1,
  viaBaseCost: 1,
  ripCost: 1,
  ripTracePenalty: 1,
  ripViaPenalty: 1,
  greedyMultiplier: 1,
  penaltyCap: 5,
  usedCells: new Int32Array(rows * cols * layers).fill(-1),
  portOwners: new Int32Array(rows * cols * layers).fill(-1),
  usedDiagonals: new Int32Array(layers * (rows - 1) * (cols - 1) * 2).fill(-1),
  penalties: new Float64Array(rows * cols),
  rootOverlap: new Uint8Array([1]),
  viaOffsetsDr: new Int32Array([0]),
  viaOffsetsDc: new Int32Array([0]),
})
const memoryOf = (kernel: NativeA01SearchKernel): WebAssembly.Memory =>
  (kernel as unknown as { exports: { memory: WebAssembly.Memory } }).exports
    .memory

test("released native instances are isolated, reset and retained within count and memory limits", () => {
  const input = inputFor()
  // Drain any prior tests' idle pool without relinquishing these owners yet.
  const held = Array.from(
    { length: 4 },
    () => NativeA01SearchKernel.create(input)!,
  )
  const original = Array.from(
    { length: 6 },
    () => NativeA01SearchKernel.create(input)!,
  )
  const originalMemories = new Set(original.map(memoryOf))
  for (const kernel of original) {
    kernel.begin(input)
    expect(kernel.advance(input.cellSizeMm, input, input.penaltyCap)).toBe(1)
    kernel.release()
    kernel.release()
  }
  const borrowed = Array.from(
    { length: 6 },
    () => NativeA01SearchKernel.create(input)!,
  )
  expect(
    borrowed.filter((kernel) => originalMemories.has(memoryOf(kernel))),
  ).toHaveLength(4)
  expect(new Set(borrowed.map(memoryOf)).size).toBe(6)
  for (const kernel of held)
    expect(borrowed.map(memoryOf)).not.toContain(memoryOf(kernel))

  const old = original[0]!
  const active = borrowed.find((kernel) =>
    originalMemories.has(memoryOf(kernel)),
  )!
  active.begin(input)
  const staleOperations = [
    (): void => old.begin(input),
    (): number => old.advance(input.cellSizeMm, input, input.penaltyCap),
    (): unknown => old.readGoal(),
    (): void => old.copyVisitedTo(new Uint32Array(1)),
    (): void => old.clear(),
  ]
  for (const operation of staleOperations)
    expect(operation).toThrow("has been released")
  old.release()
  expect(active.heapSize).toBe(1)
  expect(active.advance(input.cellSizeMm, input, input.penaltyCap)).toBe(1)

  // Full kernel_setup must reset stamps, dimensions, ownership and offsets.
  const reusedMemory = memoryOf(active)
  active.release()
  const changed = inputFor(3, 4, 4)
  const reset = NativeA01SearchKernel.create(changed)!
  expect(memoryOf(reset)).toBe(reusedMemory)
  const visited = new Uint32Array(48).fill(99)
  reset.copyVisitedTo(visited)
  expect([...visited]).toEqual(new Array(48).fill(0))
  reset.begin(changed)
  let status = 0
  for (let i = 0; status === 0 && i < 1000; i++)
    status = reset.advance(changed.cellSizeMm, changed, changed.penaltyCap)
  expect(status).toBe(1)
  const goal = reset.readGoal()
  expect(goal.cellIds[0]).toBe(0)
  expect(goal.cellIds[goal.cellIds.length - 1]).toBe(47)
  expect(goal.rippedIds).toHaveLength(0)

  // At the exact cap, reuse is allowed; one additional page excludes the instance.
  const memory = memoryOf(reset)
  memory.grow(512 - memory.buffer.byteLength / 65536)
  reset.release()
  const atLimit = NativeA01SearchKernel.create(input)!
  expect(memoryOf(atLimit)).toBe(memory)
  memory.grow(1)
  atLimit.release()
  const afterOversized = NativeA01SearchKernel.create(input)!
  expect(memoryOf(afterOversized)).not.toBe(memory)
  afterOversized.release()
  for (const kernel of [...held, ...borrowed]) kernel.release()
})
