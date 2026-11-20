import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A03 cached via occupants preserve routing through shared nets and rips", () => {
  const props = {
    nodeWithPortPoints: viaOccupantCacheNode,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
    hyperParameters: { shuffleSeed: 1 },
  }
  const cachedSolver = new HighDensitySolverA03(props)
  const uncachedSolver = new HighDensitySolverA03(props)
  cachedSolver.solve()
  while (!uncachedSolver.solved && !uncachedSolver.failed) {
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
