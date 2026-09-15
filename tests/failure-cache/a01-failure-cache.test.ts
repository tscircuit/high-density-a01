import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverFailureCache } from "../../lib"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

test("A01 reuses an exact failed search and searches changed geometry", () => {
  const cache = new HighDensitySolverFailureCache()
  const params = {
    nodeWithPortPoints: highDensityFailureCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    stepMultiplier: 1,
  }
  const original = new HighDensitySolverA01(params, cache)
  original.MAX_ITERATIONS = 3
  original.solve()
  expect(original.failed).toBeTrue()

  const repeated = new HighDensitySolverA01(structuredClone(params), cache)
  repeated.MAX_ITERATIONS = 3
  repeated.step()
  expect(repeated.failed).toBeTrue()
  expect(repeated.error).toBe(original.error)
  expect(repeated.iterations).toBe(original.iterations)
  expect(repeated.stats.failureCacheHit).toBeTrue()

  const changed = new HighDensitySolverA01(
    {
      ...params,
      nodeWithPortPoints: { ...highDensityFailureCacheNode, width: 3.001 },
    },
    cache,
  )
  changed.MAX_ITERATIONS = 3
  changed.step()
  expect(changed.failed).toBeFalse()
  expect(changed.stats.failureCacheHit).not.toBeTrue()
})
