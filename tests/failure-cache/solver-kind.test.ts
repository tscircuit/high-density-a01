import { expect, test } from "bun:test"
import {
  HighDensitySolverA01,
  HighDensitySolverA03,
  HighDensitySolverFailureCache,
} from "../../lib"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

test("A01 and A03 cannot reuse each other's failures for the same input", () => {
  const props = {
    nodeWithPortPoints: highDensityFailureCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  }
  const highDensitySolverFailureCache = new HighDensitySolverFailureCache()
  for (const Solver of [HighDensitySolverA01, HighDensitySolverA03]) {
    const original = new Solver(props, highDensitySolverFailureCache)
    original.MAX_ITERATIONS = 3
    original.step()
    expect(original.failed).toBeFalse()
    expect(original.stats.failureCacheHit).not.toBeTrue()
    original.solve()

    const retry = new Solver(props, highDensitySolverFailureCache)
    retry.MAX_ITERATIONS = 3
    retry.step()
    expect(retry.failed).toBeTrue()
    expect(retry.stats.failureCacheHit).toBeTrue()
    expect(retry.error).toBe(original.error)
  }
})
