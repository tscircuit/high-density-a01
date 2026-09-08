import { expect, test } from "bun:test"
import { defaultA03Params, defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints } from "../../lib/types"
import { LegacyDuplicateHeap } from "./legacy-duplicate-heap"
import sample003 from "../dataset01/sample003/sample003.json"
import sample007 from "../dataset01/sample007/sample007.json"

type SearchState = {
  nodePool: { push(...args: unknown[]): number; length: number }
  heap: {
    push(f: number, id: number): void
    clear(): void
  }
  totalRipEvents: number
}

const solvers = [
  {
    name: "A01",
    create: (nodeWithPortPoints: NodeWithPortPoints) =>
      new HighDensitySolverA01({ ...defaultParams, nodeWithPortPoints }),
  },
  {
    name: "A03",
    create: (nodeWithPortPoints: NodeWithPortPoints) =>
      new HighDensitySolverA03({ ...defaultA03Params, nodeWithPortPoints }),
  },
]

for (const { name, create } of solvers) {
  for (const [fixtureName, nodeWithPortPoints] of [
    ["solved", sample003],
    ["failed", sample007.nodeWithPortPoints],
  ] as const) {
    test(`${name} node indices match insertion order across ${fixtureName} searches and rip-ups`, () => {
      const solver = create(nodeWithPortPoints)
      solver.setup()
      const state = solver as unknown as SearchState
      // A01 now has an independent arrival sequence when pruning candidates.
      // Retain the original invariant here for its legacy duplicate mode.
      if (name === "A01")
        state.heap = new LegacyDuplicateHeap(state.nodePool as any)
      const { heap, nodePool } = state
      const allocate = nodePool.push.bind(nodePool)
      const enqueue = heap.push.bind(heap)
      const clear = heap.clear.bind(heap)
      let pendingNode: number | null = null
      let nextSequence = 0
      let totalEnqueued = 0
      let resets = 0

      nodePool.push = (...args): number => {
        if (pendingNode !== null) {
          throw new Error(
            "A node was allocated without enqueuing the previous node",
          )
        }
        pendingNode = allocate(...args)
        return pendingNode
      }
      heap.push = (f, id): void => {
        if (
          id !== nextSequence ||
          id !== pendingNode ||
          id !== nodePool.length - 1
        ) {
          throw new Error("Heap node index differs from the insertion sequence")
        }
        if (id < 0 || id > 0x7fffffff) {
          throw new Error(
            "Node index is outside the existing Int32 pool domain",
          )
        }
        pendingNode = null
        nextSequence++
        totalEnqueued++
        enqueue(f, id)
      }
      heap.clear = (): void => {
        if (pendingNode !== null)
          throw new Error("Heap cleared with an unqueued node")
        clear()
        nextSequence = 0
        resets++
      }
      solver.solve()

      expect(pendingNode).toBeNull()
      expect(totalEnqueued).toBeGreaterThan(1000)
      expect(resets).toBeGreaterThan(1)
      expect(state.totalRipEvents).toBeGreaterThan(0)
      expect(solver.solved).toBe(fixtureName === "solved")
      expect(solver.failed).toBe(fixtureName === "failed")
    })
  }
}
