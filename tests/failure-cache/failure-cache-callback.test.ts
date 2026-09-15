import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverFailureCache } from "../../lib"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

test("a penalty callback always performs a fresh search", () => {
  const cache = new HighDensitySolverFailureCache()
  const params = {
    nodeWithPortPoints: highDensityFailureCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    stepMultiplier: 1,
    initialPenaltyFn: (): number => 0,
  }
  const original = new HighDensitySolverA01(params, cache)
  original.MAX_ITERATIONS = 3
  original.solve()
  expect(original.failed).toBeTrue()

  const repeated = new HighDensitySolverA01(params, cache)
  repeated.MAX_ITERATIONS = 3
  repeated.step()
  expect(repeated.failed).toBeFalse()
  expect(repeated.stats.failureCacheHit).not.toBeTrue()
  expect(cache.hits).toBe(0)
})
