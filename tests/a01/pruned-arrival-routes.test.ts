import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("pruned arrivals preserve unbudgeted search routes with fewer queue pops", () => {
  let originalIterations = 0
  let prunedIterations = 0
  for (const shuffleSeed of [0, 1, 2]) {
    const props = {
      nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
      cellSizeMm: 0.1,
      viaDiameter: 0.3,
      traceThickness: 0.1,
      traceMargin: 0.1,
      hyperParameters: { shuffleSeed },
    }
    const original = new HighDensitySolverA01(props)
    const pruned = new HighDensitySolverA01({
      ...props,
      skipDominatedCandidates: true,
    })
    for (const solver of [original, pruned]) {
      solver.setup()
      // This comparison isolates queue pruning from the deliberately changed
      // budget accounting. The production default retains the legacy mode.
      solver["baseSearchBudgetIters"] = Number.POSITIVE_INFINITY
      solver.solve()
      expect(solver.solved).toBe(true)
    }
    expect(pruned.getOutput()).toEqual(original.getOutput())
    expect(pruned["totalRipEvents"]).toBe(original["totalRipEvents"])
    originalIterations += original.iterations
    prunedIterations += pruned.iterations
  }
  expect(prunedIterations).toBeLessThan(originalIterations)
})
