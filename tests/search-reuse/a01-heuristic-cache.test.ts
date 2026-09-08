import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample002 from "../dataset01/sample002/sample002.json"
import sample003 from "../dataset01/sample003/sample003.json"
import prevNext from "../prev-next/prev-next.json"

type Heuristic = (
  z: number,
  row: number,
  col: number,
  toZ: number,
  toRow: number,
  toCol: number,
) => number

type IndexedWeightedHeuristic = (
  flatIdx: number,
  ...coordinates: Parameters<Heuristic>
) => number

type SearchState = {
  getCachedWeightedH: IndexedWeightedHeuristic
  computeH: Heuristic
  totalRipEvents: number
  activeConnId: number
  crossLayerSearch: boolean
  stamp: number
  nextStamp(): void
}

function getResult(solver: HighDensitySolverA01): object {
  return {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    rips: (solver as unknown as SearchState).totalRipEvents,
    routes: solver.getOutput(),
  }
}

test("A01 reuses exact heuristic values across duplicate nodes and invalidates on each search and stamp rollover", () => {
  let requests = 0
  let computations = 0
  for (const nodeWithPortPoints of [
    sample002,
    sample003,
    prevNext,
  ]) {
    const cached = new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints,
    })
    const reference = new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints,
    })
    const cachedState = cached as unknown as SearchState
    const referenceState = reference as unknown as SearchState
    const getCachedWeightedH = cachedState.getCachedWeightedH.bind(cached)
    const computeH = cachedState.computeH.bind(cached)
    cachedState.computeH = (...args): number => {
      computations++
      return computeH(...args)
    }
    cachedState.getCachedWeightedH = (flatIdx, ...coordinates): number => {
      requests++
      const [z, row, col] = coordinates
      if (flatIdx !== (z * cached.rows + row) * cached.cols + col) {
        throw new Error(
          "Heuristic cache index differs from the original expression",
        )
      }
      const value = getCachedWeightedH(flatIdx, ...coordinates)
      const originalValue =
        computeH(...coordinates) * cached.hyperParameters.greedyMultiplier
      if (!Object.is(value, originalValue)) {
        throw new Error(
          "Cached weighted heuristic differs from the original expression",
        )
      }
      return value
    }
    referenceState.getCachedWeightedH = (_flatIdx, ...coordinates): number =>
      referenceState.computeH(...coordinates) *
      reference.hyperParameters.greedyMultiplier
    cached.solve()
    reference.solve()
    expect(getResult(cached)).toEqual(getResult(reference))
  }
  expect(requests).toBeGreaterThan(computations)
  expect(computations).toBeGreaterThan(0)

  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: sample003,
  })
  solver.setup()
  const state = solver as unknown as SearchState
  state.activeConnId = 0
  state.crossLayerSearch = true
  state.nextStamp()
  const flatIdx = solver.cols + 1
  const previous = state.getCachedWeightedH(flatIdx, 0, 1, 1, 1, 2, 2)
  state.stamp = 0xffffffff
  solver.hyperParameters.greedyMultiplier = 2.25
  state.nextStamp()
  const current = state.getCachedWeightedH(flatIdx, 0, 1, 1, 1, 4, 4)
  expect(state.stamp).toBe(1)
  expect(current).toBe(
    state.computeH(0, 1, 1, 1, 4, 4) * solver.hyperParameters.greedyMultiplier,
  )
  expect(current).not.toBe(previous)
})
