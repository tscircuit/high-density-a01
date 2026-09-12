import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"

type SearchState = {
  nodePool: {
    cellIdx: Float64Array
    g: Float64Array
    ripped: unknown[]
    length: number
  }
  heap: { size: number; push(f: number, id: number): void }
  visitedStamp: Uint32Array
  stamp: number
  searchIterations: number
  stepOnce(): void
}

test("duplicate pops return before reading move costs or rip chains", () => {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: sample003,
  })
  solver.setup()
  const state = solver as unknown as SearchState
  state.stepOnce()
  expect(state.nodePool.length).toBe(1)
  const startCell = state.nodePool.cellIdx[0]!
  state.visitedStamp[startCell] = state.stamp
  const originalG = state.nodePool.g
  const originalRipped = state.nodePool.ripped
  state.nodePool.g = new Proxy(originalG, {
    get(target, key) {
      if (key === "0") throw new Error("Duplicate pop read g")
      return Reflect.get(target, key, target)
    },
  })
  state.nodePool.ripped = new Proxy(originalRipped, {
    get(target, key, receiver) {
      if (key === "0") throw new Error("Duplicate pop read its rip chain")
      return Reflect.get(target, key, receiver)
    },
  })
  state.stepOnce()
  expect(state.searchIterations).toBe(1)
  expect(state.heap.size).toBe(0)
  expect(state.nodePool.length).toBe(1)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  state.nodePool.g = originalG
  state.nodePool.ripped = originalRipped
  state.visitedStamp[startCell] = 0
  state.heap.push(0, 0)
  state.stepOnce()
  expect(state.searchIterations).toBe(2)
  expect(state.nodePool.length).toBeGreaterThan(1)
})
