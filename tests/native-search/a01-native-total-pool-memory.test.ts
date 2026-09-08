import { expect, test } from "bun:test"
import {
  NativeA01SearchKernel,
  type NativeA01SearchInput,
} from "../../lib/native-search/NativeA01SearchKernel"

const input: NativeA01SearchInput = {
  rows: 1,
  cols: 1,
  layers: 1,
  startZ: 0,
  startRow: 0,
  startCol: 0,
  endZ: 0,
  endRow: 0,
  endCol: 0,
  activeConnId: 0,
  minViaRow: 0,
  maxViaRow: 0,
  minViaCol: 0,
  maxViaCol: 0,
  stamp: 1,
  cellSizeMm: 0.1,
  viaBaseCost: 1,
  ripCost: 1,
  ripTracePenalty: 1,
  ripViaPenalty: 1,
  greedyMultiplier: 1,
  penaltyCap: 5,
  usedCells: new Int32Array([-1]),
  portOwners: new Int32Array([-1]),
  usedDiagonals: new Int32Array(0),
  penalties: new Float64Array(1),
  rootOverlap: new Uint8Array([1]),
  viaOffsetsDr: new Int32Array([0]),
  viaOffsetsDc: new Int32Array([0]),
}
const memoryOf = (kernel: NativeA01SearchKernel): WebAssembly.Memory =>
  (kernel as unknown as { exports: { memory: WebAssembly.Memory } }).exports
    .memory
const create = (): NativeA01SearchKernel => NativeA01SearchKernel.create(input)!
const growToMiB = (kernel: NativeA01SearchKernel, mib: number): void => {
  const memory = memoryOf(kernel)
  memory.grow((mib * 1024 * 1024 - memory.buffer.byteLength) / 65536)
}

test("idle memory stays at most 128 MiB across mixed-size returns, borrows and failed construction", () => {
  // No owner in this group may be reused while it is still active.
  const held = Array.from({ length: 32 }, create)
  const large = Array.from({ length: 5 }, create)
  for (const kernel of large) growToMiB(kernel, 32)
  const largeMemories = large.map(memoryOf)
  for (const kernel of large) {
    kernel.release()
    kernel.release()
  }
  // Four 32 MiB memories exactly fill the byte cap, although there are 28
  // unused count slots. The fifth eligible memory must be discarded.
  const borrowed = Array.from({ length: 5 }, create)
  expect(borrowed.slice(0, 4).map(memoryOf)).toEqual(
    largeMemories.slice(0, 4).reverse(),
  )
  expect(largeMemories).not.toContain(memoryOf(borrowed[4]!))
  for (const kernel of held)
    expect(borrowed.map(memoryOf)).not.toContain(memoryOf(kernel))

  const halves = [create(), create()]
  for (const kernel of halves) growToMiB(kernel, 16)
  const tiny = create()
  const tinyMemory = memoryOf(tiny)
  const mixed = [...borrowed.slice(0, 3), ...halves]
  const mixedMemories = mixed.map(memoryOf)
  for (const kernel of mixed) kernel.release()
  tiny.release()
  const mixedBorrowed = Array.from({ length: 6 }, create)
  expect(mixedBorrowed.slice(0, 5).map(memoryOf)).toEqual(
    [...mixedMemories].reverse(),
  )
  expect(memoryOf(mixedBorrowed[5]!)).not.toBe(tinyMemory)
  expect(
    mixedMemories.reduce((sum, memory) => sum + memory.buffer.byteLength, 0),
  ).toBe(128 * 1024 * 1024)

  // Borrowing must deduct the old byte count before setup. If construction
  // throws, the borrowed memory is no longer idle and must not count forever.
  const failedBorrow = mixedBorrowed[2]!
  const failedMemory = memoryOf(failedBorrow)
  expect(failedMemory.buffer.byteLength).toBe(32 * 1024 * 1024)
  failedBorrow.release()
  expect(() =>
    NativeA01SearchKernel.create({
      ...input,
      get rows(): number {
        throw new Error("input read failed")
      },
    }),
  ).toThrow("input read failed")
  const afterFailure = [borrowed[3]!, ...mixedBorrowed.slice(3, 5)]
  const extra = create()
  growToMiB(extra, 32)
  afterFailure.push(extra)
  const afterFailureMemories = afterFailure.map(memoryOf)
  for (const kernel of afterFailure) kernel.release()
  const finalBorrowed = Array.from({ length: 5 }, create)
  expect(finalBorrowed.slice(0, 4).map(memoryOf)).toEqual(
    [...afterFailureMemories].reverse(),
  )
  expect(finalBorrowed.map(memoryOf)).not.toContain(failedMemory)

  for (const kernel of [
    ...held,
    ...large,
    ...borrowed,
    ...halves,
    tiny,
    ...mixedBorrowed,
    extra,
    ...finalBorrowed,
  ])
    kernel.release()
})
