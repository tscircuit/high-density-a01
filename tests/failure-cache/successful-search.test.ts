import { expect, test } from "bun:test"
import {
  HighDensitySolverA01,
  HighDensitySolverA03,
  HighDensitySolverFailureCache,
} from "../../lib"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("sharing a failure cache preserves successful routes and search work", () => {
  const props = {
    nodeWithPortPoints: viaOccupantCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    traceThickness: 0.1,
    traceMargin: 0.1,
    hyperParameters: { shuffleSeed: 1 },
  }
  const highDensitySolverFailureCache = new HighDensitySolverFailureCache()
  for (const Solver of [HighDensitySolverA01, HighDensitySolverA03]) {
    const reference = new Solver(props)
    reference.solve()
    expect(reference.solved).toBeTrue()

    for (let attempt = 0; attempt < 2; attempt++) {
      const solver = new Solver(props, highDensitySolverFailureCache)
      solver.solve()
      expect(solver.solved).toBeTrue()
      expect(solver.getOutput()).toEqual(reference.getOutput())
      expect(solver.iterations).toBe(reference.iterations)
      expect(solver.stats.failureCacheHit).not.toBeTrue()
    }
  }
})
