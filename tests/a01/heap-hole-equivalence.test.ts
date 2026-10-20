import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { FrozenA01MinHeap } from "../fixtures/FrozenA01MinHeap"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

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

test("A01 hole sifts preserve the original heap for all Number priorities and reuse", (): void => {
  const actual = createHeap()
  const original = new FrozenA01MinHeap()
  const actualStorage = actual as unknown as HeapStorage
  const originalStorage = original as unknown as HeapStorage
  const writes = [0, 0]
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
    } else if (original.size > 0 && random % 4 === 0) {
      expect(actual.pop()).toBe(original.pop())
    } else {
      const priority = priorities[random % priorities.length]!
      const sequence = operation % 11 === 0 ? 0 : operation
      actual.push(priority, sequence, operation)
      original.push(priority, sequence, operation)
    }
    expect(actual.size).toBe(original.size)
    expect(actualStorage).toEqual(originalStorage)
  }
  while (original.size > 0) {
    expect(actual.pop()).toBe(original.pop())
    expect(actualStorage).toEqual(originalStorage)
  }
  expect(writes[0]).toBeLessThan(writes[1]! * 0.6)

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
})
