import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"
import { LegacyDuplicateHeap } from "./legacy-duplicate-heap"

function makeHeap() {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: sample003,
  })
  solver.setup()
  const state = solver as any
  return {
    heap: new state.heap.constructor(state.nodePool, 8192),
    pool: state.nodePool,
  }
}

test("indexed queue preserves complete replacements, rounded ties, immutable parents, growth and reuse", () => {
  const { heap, pool } = makeHeap()
  heap.beginSearch(true)
  const earlierRip = { id: 7, prev: null }
  const laterRip = { id: 9, prev: earlierRip }
  heap.enqueue(10, 0, 5, -1, earlierRip)
  heap.enqueue(10, 0, 4, -1, laterRip)
  expect(pool.length).toBe(1)
  heap.enqueue(10, 1, 6, 0, earlierRip)
  heap.enqueue(5, 0, 3, -1, laterRip)
  expect(pool.length).toBe(3)
  expect(heap.size).toBe(2)
  expect(heap.pop()).toBe(2)
  expect(pool.g[2]).toBe(3)
  expect(pool.ripped[2]).toBe(laterRip)
  expect(heap.pop()).toBe(1)
  // Replacing pending node 0 must not mutate any previously stored parent.
  expect(pool.parentIdx[1]).toBe(0)
  expect(pool.g[0]).toBe(5)
  expect(pool.ripped[0]).toBe(earlierRip)

  heap.beginSearch(true)
  pool.clear()
  const rounded = 2 ** 54
  expect(rounded + 1).toBe(rounded + 2)
  heap.enqueue(rounded + 2, 0, 2, -1, earlierRip)
  heap.enqueue(rounded + 1, 0, 1, -1, laterRip)
  heap.enqueue(rounded, 1, 0, -1, null)
  expect(heap.pop()).toBe(0)
  expect(pool.g[0]).toBe(2)
  expect(heap.pop()).toBe(1)

  for (let reuse = 0; reuse < 3; reuse++) {
    heap.beginSearch(true)
    pool.clear()
    const expected = [] as Array<{ id: number; f: number; sequence: number }>
    const best = new Map<number, { id: number; f: number; sequence: number }>()
    let sequence = 0
    for (let cell = 0; cell < 3000; cell++) {
      for (const f of [100 + (cell % 13), 200, cell % 17, cell % 17]) {
        const before = pool.length
        heap.enqueue(f, cell, sequence, -1, null)
        if (pool.length > before) best.set(cell, { id: before, f, sequence })
        sequence++
      }
    }
    expected.push(...best.values())
    expected.sort((a, b) => a.f - b.f || a.sequence - b.sequence)
    expect(heap.nextSequence).toBe(sequence)
    expect(heap.size).toBe(3000)
    expect(pool.length).toBe(6000)
    for (const entry of expected) expect(heap.pop()).toBe(entry.id)
    expect(heap.size).toBe(0)
    heap.enqueue(1, 0, 0, -1, null)
    heap.enqueue(1, 1, 0, -1, null)
    // Clear live positions before resetting pool IDs.
  }
  heap.beginSearch(true)
  pool.clear()
  heap.enqueue(0, 1, 0, -1, null)
  expect(heap.pop()).toBe(0)
  heap.beginSearch(true)
  pool.clear()
  heap.nextSequence = 0x100000000
  heap.enqueue(2, 2, 0, -1, null)
  heap.enqueue(2, 3, 0, -1, null)
  expect(heap.sequence[0]).toBe(0x100000000)
  expect([heap.pop(), heap.pop()]).toEqual([0, 1])
  heap.beginSearch(true)
  expect(heap.nextSequence).toBe(0)
})

test("ordered infinities and signed-zero ties retain the first payload; NaN mode matches legacy heap", () => {
  const { heap, pool } = makeHeap()
  heap.beginSearch(true)
  heap.enqueue(Infinity, 0, 1, -1, null)
  heap.enqueue(Infinity, 0, 0, -1, null)
  heap.enqueue(-0, 1, 2, -1, null)
  heap.enqueue(+0, 1, 1, -1, null)
  heap.enqueue(+0, 2, 0, -1, null)
  expect(pool.length).toBe(3)
  expect([heap.pop(), heap.pop(), heap.pop()]).toEqual([1, 2, 0])

  for (const priorities of [
    [NaN, 1, 0, NaN, Infinity, -Infinity, -0, +0],
    [Infinity, NaN, Infinity, 1, NaN, -1, NaN],
    [0, -0, +0, Infinity, Infinity, -Infinity, -Infinity],
  ]) {
    heap.beginSearch(false)
    pool.clear()
    const { pool: referencePool } = makeHeap()
    const reference = new LegacyDuplicateHeap(referencePool)
    for (const f of priorities) {
      heap.enqueue(f, 0, 0, -1, null)
      reference.enqueue(f, 0, 0, -1, null)
    }
    expect(pool.length).toBe(priorities.length)
    while (reference.size) expect(heap.pop()).toBe(reference.pop())
  }
})
