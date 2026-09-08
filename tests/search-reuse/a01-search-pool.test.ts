import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"

type SearchState = {
  nodePool: {
    cellIdx: Float64Array
    g: Float64Array
    length: number
    ripped: Array<unknown>
  }
  totalRipEvents: number
}

test("A01 reuses numeric search storage while retaining deterministic shared-copper routes", () => {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: sample003,
  })
  solver.setup()
  const state = solver as unknown as SearchState
  const pool = state.nodePool
  solver.solve()

  expect(state.nodePool).toBe(pool)
  expect(pool.cellIdx).toBeInstanceOf(Float64Array)
  expect(pool.g).toBeInstanceOf(Float64Array)
  expect(pool.ripped.length).toBe(pool.length)
  // Captured after allowing all same-net routes to share copper.
  expect({
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    rips: state.totalRipEvents,
    routeHash: new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(solver.getOutput()))
      .digest("hex"),
  }).toEqual({
    solved: true,
    failed: false,
    error: null,
    iterations: 2907,
    rips: 2,
    routeHash:
      "80ce24403d2d827ffd5f173c7c6bf3f4a458321acd8efd6465fc3b859e9f663d",
  })
})
