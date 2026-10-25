import { expect, test } from "bun:test"
import { createA03Heap } from "../fixtures/createA03Heap"
import { SwapTypedMinHeap } from "../fixtures/SwapTypedMinHeap"
import {
  afterColor,
  beforeColor,
  expectPerformanceSvg,
  performanceCanvas,
  visualMetric,
  visualPanel,
  visualText,
} from "../fixtures/performanceVisual"

type Heap = ReturnType<typeof createA03Heap> | SwapTypedMinHeap
type HeapStorage = {
  f: Float64Array
  seq: Uint32Array
  id: Int32Array
  ensureCapacity: (size: number) => void
}

function countWrites(heap: Heap): Uint32Array {
  const storage = heap as unknown as HeapStorage
  storage.ensureCapacity(8_192)
  const writes = new Uint32Array(8_192)
  for (const field of ["f", "seq", "id"] as const) {
    const counted = new Proxy(storage[field], {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
      set(target, property, value): boolean {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          writes[Number(property)]!++
        }
        return Reflect.set(target, property, value, target)
      },
    })
    Object.defineProperty(storage, field, { value: counted, writable: true })
  }
  return writes
}

function observeInsertion(heap: Heap) {
  for (const [sequence, priority] of [1, 5, 3, 9, 7, 8, 6].entries()) {
    heap.push(priority, sequence, priority)
  }
  const storage = heap as unknown as HeapStorage
  const initial = Array.from(storage.f.subarray(0, heap.size))
  const writes = countWrites(heap)
  heap.push(0, heap.size, 0)
  const result = {
    initial,
    final: Array.from(storage.f.subarray(0, heap.size)),
    sequences: Array.from(storage.seq.subarray(0, heap.size)),
    ids: Array.from(storage.id.subarray(0, heap.size)),
    writes: Array.from(writes.subarray(0, heap.size)),
    pops: [] as number[],
  }
  while (heap.size > 0) result.pops.push(heap.pop())
  return result
}

test("A03 hole sifts reduce typed-array writes while preserving every pop", async (): Promise<void> => {
  const actual = createA03Heap()
  const reference = new SwapTypedMinHeap()
  const actualWrites = countWrites(actual)
  const referenceWrites = countWrites(reference)
  for (let index = 4_096; index > 0; index--) {
    actual.push(index, index, index)
    reference.push(index, index, index)
  }
  while (reference.size > 0) expect(actual.pop()).toBe(reference.pop())
  expect(actual.size).toBe(0)
  const beforeTotal = referenceWrites.reduce((sum, writes) => sum + writes, 0)
  const afterTotal = actualWrites.reduce((sum, writes) => sum + writes, 0)
  expect(afterTotal).toBeGreaterThan(0)
  expect(afterTotal).toBeLessThan(beforeTotal * 0.55)
  const before = observeInsertion(new SwapTypedMinHeap())
  const after = observeInsertion(createA03Heap())
  for (const field of [
    "initial",
    "final",
    "sequences",
    "ids",
    "pops",
  ] as const) {
    expect(after[field]).toEqual(before[field])
  }
  expect(after.pops).toEqual([...after.final].sort((a, b) => a - b))
  const insertionTotals = [before, after].map((observed) =>
    observed.writes.reduce((sum, writes) => sum + writes, 0),
  )
  expect(insertionTotals[1]).toBeLessThan(insertionTotals[0]!)
  const graphics = performanceCanvas(
    "A03 heap: shift parents once, then place the held entry",
    `Measured push(0) into [${before.initial.join(", ")}]. Both heaps and all pops remain identical.`,
  )
  for (const [index, observed] of [before, after].entries()) {
    const left = index === 0 ? 24 : 624
    const color = index === 0 ? beforeColor : afterColor
    visualPanel(
      graphics,
      left,
      index === 0 ? "Before: swap each level" : "After: copy each parent once",
      `Insertion: ${insertionTotals[index]} writes across priority, sequence and ID arrays.`,
      color,
    )
    for (const [x, label] of [
      [20, "Slot"],
      [130, "Priority before → after"],
      [430, "Writes"],
    ] as const)
      visualText(graphics, left + x, 194, label, 15)
    for (const [slot, priority] of observed.final.entries()) {
      const y = 224 + slot * 27
      visualText(graphics, left + 20, y, String(slot))
      visualText(
        graphics,
        left + 130,
        y,
        `${observed.initial[slot] ?? "new"} → ${priority}`,
      )
      visualText(
        graphics,
        left + 430,
        y,
        String(observed.writes[slot]),
        16,
        color,
      )
    }
    visualText(
      graphics,
      left + 20,
      473,
      `Pops: ${observed.pops.join(", ")}`,
      16,
    )
  }
  visualMetric(
    graphics,
    "Full queue workload: 4,096 pushes and 4,096 pops",
    beforeTotal,
    afterTotal,
    "Every pop matches the original heap. Table and totals count actual indexed typed-array writes.",
  )
  await expectPerformanceSvg(graphics, import.meta.path)
})
