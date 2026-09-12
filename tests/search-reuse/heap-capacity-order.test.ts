import { expect, test } from "bun:test"
import { defaultA03Params, defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import prevNext from "../prev-next/prev-next.json"

type Heap = {
  push(f: number, id: number): void
  pop(): number
  clear(): void
  size: number
}

type Entry = { f: number; id: number }

function compareEntries(a: Entry, b: Entry): number {
  return a.f === b.f ? a.id - b.id : a.f - b.f
}

test("search heaps preserve priority and sequence order across growth, reuse, and layer solvers", () => {
  for (const solver of [
    new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints: prevNext,
    }),
    new HighDensitySolverA03({
      ...defaultA03Params,
      nodeWithPortPoints: prevNext,
    }),
  ]) {
    solver.setup()
    const heap = (solver as unknown as { heap: Heap }).heap
    let entries: Entry[] = []
    for (let id = 0; id < 4096; id++) {
      const f = id % 503 === 0 ? Infinity : (id * 97) % 31
      // Near the top of the nonnegative Int32 node-index range, still ordered
      // exactly as their allocation sequence when priorities are equal.
      const nodeId = 0x7fffffff - 6144 + id
      heap.push(f, nodeId)
      entries.push({ f, id: nodeId })
    }
    entries.sort(compareEntries)
    expect(heap.size).toBe(4096)
    for (const entry of entries.slice(0, 2048))
      expect(heap.pop()).toBe(entry.id)
    entries = entries.slice(2048)
    for (let id = 4096; id < 6144; id++) {
      const f = (id * 53) % 31
      const nodeId = 0x7fffffff - 6144 + id
      heap.push(f, nodeId)
      entries.push({ f, id: nodeId })
    }
    entries.sort(compareEntries)
    for (const entry of entries) expect(heap.pop()).toBe(entry.id)
    expect(heap.size).toBe(0)
    heap.push(100, 1)
    heap.clear()
    heap.push(0, 2)
    expect(heap.pop()).toBe(2)
    expect(heap.size).toBe(0)
  }
})
