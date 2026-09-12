import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import sample002 from "../dataset01/sample002/sample002.json"

type SearchState = {
  visitedStamp: Uint32Array
  stamp: number
  planeSize: number
  totalRipEvents: number
  computeMoveCostAndRips(
    activeConn: number,
    toZ: number,
    toCellId: number,
    isVia: boolean,
    rippedHead: number,
    ripCount: number,
    lateralCost: number,
  ): void
}

test("A03 skips visited move costs while preserving its baseline route and search", () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: sample002,
  })
  const state = solver as unknown as SearchState
  const computeMoveCostAndRips = state.computeMoveCostAndRips.bind(solver)
  let moveCosts = 0
  let visitedMoveCosts = 0
  state.computeMoveCostAndRips = (...args): void => {
    moveCosts++
    const [, toZ, toCellId] = args
    if (state.visitedStamp[toZ * state.planeSize + toCellId] === state.stamp) {
      visitedMoveCosts++
    }
    computeMoveCostAndRips(...args)
  }
  solver.solve()

  expect(moveCosts).toBeGreaterThan(0)
  expect(visitedMoveCosts).toBe(0)
  // Captured from the unoptimized 9a3a3d solver, including every route point.
  // Expansion counts can differ across Bun versions/platforms even when the
  // route matches. The cache differential tests compare iterations
  // against the uncached solver on the same runtime.
  expect({
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    rips: state.totalRipEvents,
    routeHash: new Bun.CryptoHasher("sha256")
      .update(
        JSON.stringify(
          solver.getOutput().map(({ rootConnectionName, ...route }) => route),
        ),
      )
      .digest("hex"),
  }).toEqual({
    solved: true,
    failed: false,
    error: null,
    rips: 10,
    routeHash:
      "5d6fc696956c4e3bf450251daf4e59e20c3240a4cf4b0fefa51fe4d8749b71d3",
  })
})
