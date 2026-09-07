import { expect, test } from "bun:test"
import { defaultA03Params, defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import sample002 from "../dataset01/sample002/sample002.json"
import sample003 from "../dataset01/sample003/sample003.json"
import sample007 from "../dataset01/sample007/sample007.json"
import prevNext from "../prev-next/prev-next.json"
import repro03 from "../repros/repro03/repro03.json"
import repro05 from "../repros/repro05/repro05.json"

type Solver = HighDensitySolverA01 | HighDensitySolverA03

type SearchState = {
  viaOccupantsByCell: Map<number, number[]>
  nextStamp(): void
  finalizeRoute(nodeIndex: number): void
  ripTrace(connectionId: number): void
  getViaOccupants(...args: number[]): number[]
  totalRipEvents: number
}

class ObservedCache extends Map<number, number[]> {
  hits = 0
  misses = 0

  constructor(private enabled: boolean) {
    super()
  }

  override get(key: number): number[] | undefined {
    const value = super.get(key)
    if (value) this.hits++
    else this.misses++
    return value
  }

  override set(key: number, value: number[]): this {
    if (this.enabled) super.set(key, value)
    return this
  }
}

function observeSearches(solver: Solver, enabled: boolean): {
  cache: ObservedCache
  finalizedInvalidations: number
  rippedInvalidations: number
} {
  const state = solver as unknown as SearchState
  const cache = new ObservedCache(enabled)
  state.viaOccupantsByCell = cache
  const stats = { cache, finalizedInvalidations: 0, rippedInvalidations: 0 }
  let finalized = false
  let ripped = false
  const nextStamp = state.nextStamp.bind(solver)
  state.nextStamp = (): void => {
    nextStamp()
    expect(cache.size).toBe(0)
    if (finalized) stats.finalizedInvalidations++
    if (ripped) stats.rippedInvalidations++
    finalized = false
    ripped = false
  }
  const finalizeRoute = state.finalizeRoute.bind(solver)
  state.finalizeRoute = (nodeIndex: number): void => {
    finalizeRoute(nodeIndex)
    finalized = true
  }
  const ripTrace = state.ripTrace.bind(solver)
  state.ripTrace = (connectionId: number): void => {
    ripTrace(connectionId)
    ripped = true
  }
  const getViaOccupants = state.getViaOccupants.bind(solver)
  state.getViaOccupants = (...args: number[]): number[] => {
    if (finalized || ripped) {
      throw new Error("Occupant cache was read before the new search cleared it")
    }
    return getViaOccupants(...args)
  }
  return stats
}

function getResult(solver: Solver): object {
  return {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    rips: (solver as unknown as SearchState).totalRipEvents,
    routes: solver.getOutput(),
  }
}

test("A01 and A03 cache via occupants without changing routes across searches and rip-ups", () => {
  const fixtures = [
    sample002,
    sample003,
    sample007.nodeWithPortPoints,
    prevNext,
    repro03.nodeWithPortPoints,
    repro05[0]!.nodeWithPortPoints,
  ]
  for (const [SolverClass, params] of [
    [HighDensitySolverA01, defaultParams],
    [HighDensitySolverA03, defaultA03Params],
  ] as const) {
    let hits = 0
    let finalizedInvalidations = 0
    let rippedInvalidations = 0
    for (const nodeWithPortPoints of fixtures) {
      const cached = new SolverClass({ ...params, nodeWithPortPoints })
      const uncached = new SolverClass({ ...params, nodeWithPortPoints })
      const observed = observeSearches(cached, true)
      observeSearches(uncached, false)
      cached.solve()
      uncached.solve()

      expect(getResult(cached)).toEqual(getResult(uncached))
      expect(observed.cache.size).toBe(0)
      hits += observed.cache.hits
      finalizedInvalidations += observed.finalizedInvalidations
      rippedInvalidations += observed.rippedInvalidations
    }
    expect(hits).toBeGreaterThan(0)
    expect(finalizedInvalidations).toBeGreaterThan(0)
    expect(rippedInvalidations).toBeGreaterThan(0)
  }
})
