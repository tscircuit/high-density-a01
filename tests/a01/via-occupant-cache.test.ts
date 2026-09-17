import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A01 cached via occupants preserve routing through shared nets and rips", () => {
  const props = {
    ...defaultParams,
    nodeWithPortPoints: viaOccupantCacheNode,
    cellSizeMm: 0.1,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
    hyperParameters: { shuffleSeed: 1 },
  }
  const cachedSolver = new HighDensitySolverA01(props)
  const uncachedSolver = new HighDensitySolverA01(props)
  cachedSolver.solve()
  while (!uncachedSolver.solved && !uncachedSolver.failed) {
    // Recompute occupants on every search step as an independent reference.
    uncachedSolver["viaOccupantsByCell"].clear()
    uncachedSolver.step()
  }

  expect(cachedSolver.solved).toBeTrue()
  expect(uncachedSolver.solved).toBeTrue()
  expect(cachedSolver["ripCount"].some((ripCount) => ripCount > 0)).toBeTrue()
  expect(cachedSolver["viaOccupantsByCell"].size).toBeGreaterThan(0)
  expect(cachedSolver.iterations).toBe(uncachedSolver.iterations)
  expect(cachedSolver.getOutput()).toEqual(uncachedSolver.getOutput())
})
