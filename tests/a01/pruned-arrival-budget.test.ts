import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("pruned search respects its retained-candidate budget and round-trips the option", () => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    skipDominatedCandidates: true,
  })
  const copy = new HighDensitySolverA01(...solver.getConstructorParams())
  expect(copy.skipDominatedCandidates).toBe(true)
  solver.setup()
  solver.MAX_ITERATIONS = 10
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.iterations).toBe(10)
  expect(solver.error).toContain("ran out of iterations")
})
