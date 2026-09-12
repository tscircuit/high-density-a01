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

test("A01 reuses numeric search storage while preserving its baseline route and rip-ups", () => {
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
  // Captured from the unoptimized 9a3a3d solver, including every route point.
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
    iterations: 3625,
    rips: 7,
    routeHash:
      "037cb669ef0f106257d7dfb02b43410a81f60e988777552e1e82189d9e6a5f6f",
  })
})
