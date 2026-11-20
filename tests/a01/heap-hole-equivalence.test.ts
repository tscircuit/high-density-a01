import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { FrozenA01MinHeap } from "../fixtures/FrozenA01MinHeap"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"
import {
  afterColor,
  beforeColor,
  expectPerformanceSvg,
  performanceCanvas,
  visualMetric,
  visualPanel,
  visualText,
} from "../fixtures/performanceVisual"

interface Heap {
  push: (f: number, seq: number, id: number) => void
  pop: () => number
  clear: () => void
  size: number
}
interface HeapStorage {
  f: number[]
  seq: number[]
  id: number[]
  n: number
}

const createHeap = (): Heap => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: viaOccupantCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  })
  solver.setup()
  return solver["heap"]
}

// Full backing-array comparisons and proxy write instrumentation exceed the
// default five-second limit on slower CI runners; retain the complete oracle.
test("A01 hole sifts preserve the original heap for all Number priorities and reuse", async (): Promise<void> => {
  const actual = createHeap()
  const original = new FrozenA01MinHeap()
  const actualStorage = actual as unknown as HeapStorage
  const originalStorage = original as unknown as HeapStorage
  const writes = [0, 0]
  const operations = { pushes: 0, pops: 0, clears: 0 }
  for (const [index, storage] of [actualStorage, originalStorage].entries()) {
    for (const name of ["f", "seq", "id"] as const) {
      storage[name] = new Proxy(storage[name], {
        set(target, key, value): boolean {
          if (typeof key === "string" && /^\d+$/.test(key)) writes[index]!++
          return Reflect.set(target, key, value)
        },
      })
    }
  }
  const priorities = [
    0,
    -0,
    1,
    -1,
    0.5,
    -0.5,
    Infinity,
    -Infinity,
    NaN,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
  ]
  let random = 731
  for (let operation = 0; operation < 12_000; operation++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    if (operation > 0 && operation % 971 === 0) {
      actual.clear()
      original.clear()
      operations.clears++
    } else if (original.size > 0 && random % 4 === 0) {
      expect(actual.pop()).toBe(original.pop())
      operations.pops++
    } else {
      const priority = priorities[random % priorities.length]!
      const sequence = operation % 11 === 0 ? 0 : operation
      actual.push(priority, sequence, operation)
      original.push(priority, sequence, operation)
      operations.pushes++
    }
    expect(actual.size).toBe(original.size)
    expect(actualStorage).toEqual(originalStorage)
  }
  while (original.size > 0) {
    expect(actual.pop()).toBe(original.pop())
    expect(actualStorage).toEqual(originalStorage)
    operations.pops++
  }
  expect(writes[0]).toBeLessThan(writes[1]! * 0.6)
  // Count actual indexed writes through proxies, rather than elapsed time.
  // The complete arrays and every pop above must still match the frozen heap.
  expect({
    workload: operations,
    beforeSwapSifts: { arrayWrites: writes[1] },
    afterHoleSifts: { arrayWrites: writes[0] },
    arrayWritesAvoided: writes[1]! - writes[0]!,
  }).toMatchSnapshot("same queue behavior with fewer heap array writes")

  const ordered = createHeap()
  const items: Array<{ f: number; seq: number; id: number }> = []
  for (let id = 0; id < 2_048; id++) {
    const item = { f: (id * 731) % 97, seq: id, id }
    items.push(item)
    ordered.push(item.f, item.seq, item.id)
  }
  for (const item of items.sort((a, b) => a.f - b.f || a.seq - b.seq)) {
    expect(ordered.pop()).toBe(item.id)
  }

  // A small real insertion makes the movement and write reduction visible.
  const demoActual = createHeap()
  const demoOriginal = new FrozenA01MinHeap()
  const demoStorage = [
    demoActual as unknown as HeapStorage,
    demoOriginal as unknown as HeapStorage,
  ]
  const slotWrites = [new Int32Array(8), new Int32Array(8)]
  for (const heap of [demoActual, demoOriginal]) {
    for (const [id, f] of [1, 5, 3, 9, 7, 8, 6].entries()) heap.push(f, id, id)
  }
  for (const [index, storage] of demoStorage.entries()) {
    for (const name of ["f", "seq", "id"] as const) {
      storage[name] = new Proxy(storage[name], {
        set(target, key, value): boolean {
          if (typeof key === "string" && /^\d+$/.test(key)) {
            slotWrites[index]![Number(key)]!++
          }
          return Reflect.set(target, key, value)
        },
      })
    }
  }
  demoActual.push(0, 7, 7)
  demoOriginal.push(0, 7, 7)
  expect(demoStorage[0]).toEqual(demoStorage[1])
  const demoWrites = slotWrites.map((counts) =>
    counts.reduce((sum, count) => sum + count, 0),
  )
  expect(demoWrites[0]).toBeLessThan(demoWrites[1]!)

  const graphics = performanceCanvas(
    "Move parents into the hole instead of swapping at every level",
    "One actual insertion of priority 0 into a seven-item heap. The final heap is identical; labels count writes to f, seq and id.",
  )
  const positions = [
    [276, 216],
    [145, 292],
    [407, 292],
    [80, 368],
    [210, 368],
    [342, 368],
    [472, 368],
    [52, 444],
  ] as const
  for (const [left, index, title, color] of [
    [24, 1, "Before: swap both entries at each level", beforeColor],
    [624, 0, "After: shift parents, then write the new item", afterColor],
  ] as const) {
    visualPanel(
      graphics,
      left,
      title,
      `This insertion: ${demoWrites[index]} indexed writes across three arrays.`,
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
    for (const slot of [7, 3, 1]) {
      const child = positions[slot]!
      const parent = positions[(slot - 1) >> 1]!
      graphics.arrows.push({
        start: { x: left + parent[0] - 14, y: parent[1] + 18 },
        end: { x: left + child[0] - 14, y: child[1] - 18 },
        doubleSided: index === 1,
        color,
      })
    }
    for (const [slot, [x, y]] of positions.entries()) {
      const count = slotWrites[index]![slot]!
      graphics.circles.push({
        center: { x: left + x, y },
        radius: 20,
        fill: slot === 0 ? "#dcfce7" : "white",
        stroke: count > 0 ? color : "#cbd5e1",
      })
      visualText(
        graphics,
        left + x - 5,
        y,
        String(demoStorage[index]!.f[slot]),
        17,
      )
      visualText(
        graphics,
        left + x - 28,
        y + 32,
        `slot ${slot}: ${count} writes`,
        11,
        count > 0 ? color : "#64748b",
      )
    }
    visualText(
      graphics,
      left + 140,
      482,
      index === 1
        ? "Double arrows: exchange both items."
        : "Single arrows: move each parent down once.",
      14,
      color,
    )
  }
  visualMetric(
    graphics,
    "Full parity workload: indexed writes to the heap arrays",
    writes[1]!,
    writes[0]!,
    "Every heap array, pop order, numeric edge case and complete routing replay still matches the original queue.",
  )
  await expectPerformanceSvg(graphics, import.meta.path)
}, 30_000)
