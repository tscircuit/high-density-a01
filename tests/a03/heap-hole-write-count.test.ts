import { expect, test } from "bun:test"
import type { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
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

type HeapStorage = {
  f: Float64Array
  seq: Uint32Array
  id: Int32Array
  ensureCapacity: (size: number) => void
}

type InsertionObservation = {
  priorities: number[]
  sequences: number[]
  ids: number[]
  writesBySlot: number[]
  moves: Array<{ from: number; to: number }>
  popPriorities: number[]
  popIds: number[]
}

function countWrites(
  heap: HighDensitySolverA03["heap"] | SwapTypedMinHeap,
  counter: { writes: number },
): void {
  const storage = heap as unknown as HeapStorage
  storage.ensureCapacity(8_192)
  for (const field of ["f", "seq", "id"] as const) {
    const array = storage[field]
    const counted = new Proxy(array, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
      set(target, property, value): boolean {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          counter.writes++
        }
        return Reflect.set(target, property, value, target)
      },
    })
    Object.defineProperty(storage, field, { value: counted, writable: true })
  }
}

function observeInsertion(
  heap: HighDensitySolverA03["heap"] | SwapTypedMinHeap,
): InsertionObservation {
  const priorities = [1, 5, 3, 9, 7, 8, 6]
  for (const [id, priority] of priorities.entries()) heap.push(priority, id, id)
  const storage = heap as unknown as HeapStorage
  const writesBySlot = new Int32Array(8)
  const moves: InsertionObservation["moves"] = []
  const locations = new Map(priorities.map((_, index) => [index, index]))
  let observingInsertion = true
  for (const field of ["f", "seq", "id"] as const) {
    const counted = new Proxy(storage[field], {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
      set(target, property, value): boolean {
        if (
          observingInsertion &&
          typeof property === "string" &&
          /^\d+$/.test(property)
        ) {
          const slot = Number(property)
          writesBySlot[slot]!++
          if (field === "id") {
            const from = locations.get(value)
            if (from !== undefined && from !== slot)
              moves.push({ from, to: slot })
            locations.set(value, slot)
          }
        }
        return Reflect.set(target, property, value, target)
      },
    })
    Object.defineProperty(storage, field, { value: counted, writable: true })
  }
  heap.push(0, 7, 7)
  observingInsertion = false
  const result: InsertionObservation = {
    priorities: Array.from(storage.f.subarray(0, 8)),
    sequences: Array.from(storage.seq.subarray(0, 8)),
    ids: Array.from(storage.id.subarray(0, 8)),
    writesBySlot: Array.from(writesBySlot),
    moves,
    popPriorities: [],
    popIds: [],
  }
  while (heap.size > 0) {
    result.popPriorities.push(storage.f[0]!)
    result.popIds.push(heap.pop())
  }
  return result
}

test("A03 hole sifts reduce indexed typed-array writes while preserving every pop", async (): Promise<void> => {
  const actual = createA03Heap()
  const reference = new SwapTypedMinHeap()
  const actualWork = { writes: 0 }
  const referenceWork = { writes: 0 }
  countWrites(actual, actualWork)
  countWrites(reference, referenceWork)
  for (let index = 4_096; index > 0; index--) {
    actual.push(index, index, index)
    reference.push(index, index, index)
  }
  while (reference.size > 0) {
    expect(actual.pop()).toBe(reference.pop())
  }
  expect(actualWork.writes).toBeGreaterThan(0)
  expect(actualWork.writes).toBeLessThan(referenceWork.writes * 0.55)
  const before = observeInsertion(new SwapTypedMinHeap())
  const after = observeInsertion(createA03Heap())
  for (const field of [
    "priorities",
    "sequences",
    "ids",
    "popPriorities",
    "popIds",
  ] as const) {
    expect(after[field]).toEqual(before[field])
  }
  expect(after.popPriorities).toEqual(
    [...after.priorities].sort((a, b) => a - b),
  )
  const insertionWrites = [before, after].map((observed) =>
    observed.writesBySlot.reduce((sum, writes) => sum + writes, 0),
  )
  expect(insertionWrites[1]).toBeLessThan(insertionWrites[0]!)
  expect({
    workload: { pushes: 4_096, pops: 4_096 },
    beforeSwapSifts: { typedArrayWrites: referenceWork.writes },
    afterHoleSifts: { typedArrayWrites: actualWork.writes },
    typedArrayWritesAvoided: referenceWork.writes - actualWork.writes,
    illustrativeInsertion: {
      initialPriorities: [1, 5, 3, 9, 7, 8, 6],
      insertedPriority: 0,
      identicalFinalPriorities: after.priorities,
      identicalPopPriorities: after.popPriorities,
      beforeWritesBySlot: before.writesBySlot,
      afterWritesBySlot: after.writesBySlot,
      beforeTotalWrites: insertionWrites[0],
      afterTotalWrites: insertionWrites[1],
    },
  }).toMatchSnapshot("same queue behavior with fewer typed heap writes")

  const graphics = performanceCanvas(
    "A03: write each moved typed entry once",
    "One measured insertion of priority 0. Both queues finish with the same priorities and pop order.",
  )
  const positions = [
    [276, 215],
    [140, 288],
    [410, 288],
    [72, 361],
    [208, 361],
    [344, 361],
    [480, 361],
    [44, 434],
  ] as const
  for (const [left, observed, title, color, total] of [
    [
      24,
      before,
      "Before: swap full typed entries",
      beforeColor,
      insertionWrites[0]!,
    ],
    [
      624,
      after,
      "After: shift parents into the hole",
      afterColor,
      insertionWrites[1]!,
    ],
  ] as const) {
    visualPanel(
      graphics,
      left,
      title,
      `Insertion: ${total} writes across f, seq and id.`,
      color,
    )
    for (let slot = 1; slot < positions.length; slot++) {
      const parent = positions[(slot - 1) >> 1]!
      const child = positions[slot]!
      graphics.lines.push({
        points: [
          { x: left + parent[0], y: parent[1] },
          { x: left + child[0], y: child[1] },
        ],
        strokeWidth: 1,
        strokeColor: "#cbd5e1",
      })
    }
    const drawnMoves = new Set<string>()
    for (const move of observed.moves) {
      const key = `${Math.min(move.from, move.to)}-${Math.max(move.from, move.to)}`
      if (drawnMoves.has(key)) continue
      drawnMoves.add(key)
      const from = positions[move.from]!
      const to = positions[move.to]!
      graphics.arrows.push({
        start: { x: left + from[0] - 35, y: from[1] + 18 },
        end: { x: left + to[0] - 35, y: to[1] - 18 },
        doubleSided: observed.moves.some(
          (other) => other.from === move.to && other.to === move.from,
        ),
        color,
      })
    }
    for (const [slot, [x, y]] of positions.entries()) {
      const writes = observed.writesBySlot[slot]!
      graphics.circles.push({
        center: { x: left + x, y },
        radius: 17,
        fill: slot === 0 ? "#dcfce7" : "white",
        stroke: writes > 0 ? color : "#cbd5e1",
      })
      visualText(
        graphics,
        left + x - 5,
        y,
        String(observed.priorities[slot]),
        17,
      )
      visualText(
        graphics,
        left + x - 32,
        y + 27,
        `s${slot}: ${writes} writes`,
        11,
        writes > 0 ? color : "#64748b",
      )
    }
    visualText(
      graphics,
      left + 20,
      487,
      `Pop priorities: ${observed.popPriorities.join(", ")}`,
      14,
    )
  }
  visualMetric(
    graphics,
    "Full queue workload: 4,096 pushes followed by 4,096 pops",
    referenceWork.writes,
    actualWork.writes,
    "Identical final heap and pop order. Slot labels and arrows come from actual typed-array writes.",
  )
  await expectPerformanceSvg(graphics, import.meta.path)
})
