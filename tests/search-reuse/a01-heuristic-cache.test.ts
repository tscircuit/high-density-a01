import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample002 from "../dataset01/sample002/sample002.json"
import sample003 from "../dataset01/sample003/sample003.json"
import sample007 from "../dataset01/sample007/sample007.json"
import prevNext from "../prev-next/prev-next.json"
import repro03 from "../repros/repro03/repro03.json"
import repro05 from "../repros/repro05/repro05.json"

type Heuristic = (
  z: number,
  row: number,
  col: number,
  toZ: number,
  toRow: number,
  toCol: number,
) => number

type SearchState = {
  getCachedH: Heuristic
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
    sample007.nodeWithPortPoints,
    prevNext,
    repro03.nodeWithPortPoints,
    repro05[0]!.nodeWithPortPoints,
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
    const getCachedH = cachedState.getCachedH.bind(cached)
    const computeH = cachedState.computeH.bind(cached)
    cachedState.computeH = (...args): number => {
      computations++
      return computeH(...args)
    }
    cachedState.getCachedH = (...args): number => {
      requests++
      const value = getCachedH(...args)
      if (!Object.is(value, computeH(...args))) {
        throw new Error("Cached heuristic differs from the original expression")
      }
      return value
    }
    referenceState.getCachedH = referenceState.computeH.bind(reference)
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
  const previous = state.getCachedH(0, 1, 1, 1, 2, 2)
  state.stamp = 0xffffffff
  state.nextStamp()
  const current = state.getCachedH(0, 1, 1, 1, 4, 4)
  expect(state.stamp).toBe(1)
  expect(current).toBe(state.computeH(0, 1, 1, 1, 4, 4))
  expect(current).not.toBe(previous)
})
