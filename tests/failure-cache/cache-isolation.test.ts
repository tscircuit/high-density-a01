import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverFailureCache } from "../../lib"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

test("failure results are shared only through the caller's cache", () => {
  const props = {
    nodeWithPortPoints: highDensityFailureCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  }
  const highDensitySolverFailureCache = new HighDensitySolverFailureCache()
  const original = new HighDensitySolverA01(
    props,
    highDensitySolverFailureCache,
  )
  original.MAX_ITERATIONS = 3
  original.solve()
  expect(original.failed).toBeTrue()

  for (const cache of [undefined, new HighDensitySolverFailureCache()]) {
    const independent = new HighDensitySolverA01(props, cache)
    independent.MAX_ITERATIONS = 3
    independent.step()
    expect(independent.failed).toBeFalse()
    expect(independent.stats.failureCacheHit).not.toBeTrue()
  }

  const retry = new HighDensitySolverA01(props, highDensitySolverFailureCache)
  retry.MAX_ITERATIONS = 3
  retry.step()
  expect(retry.failed).toBeTrue()
  expect(retry.stats.failureCacheHit).toBeTrue()
  expect(retry.error).toBe(original.error)
})
