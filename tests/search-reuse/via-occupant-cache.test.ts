import { afterAll, describe, expect, test } from "bun:test"
import { defaultA03Params, defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints } from "../../lib/types"
import sample002 from "../dataset01/sample002/sample002.json"
import sample003 from "../dataset01/sample003/sample003.json"
import sample007 from "../dataset01/sample007/sample007.json"
import prevNext from "../prev-next/prev-next.json"
import repro03 from "../repros/repro03/repro03.json"
import repro05 from "../repros/repro05/repro05.json"

type Solver = HighDensitySolverA01 | HighDensitySolverA03

type SearchState = {
  viaOccupantsByCell: Map<number, number[]>
  _viaOccs: number[]
  nextStamp(): void
  finalizeRoute(nodeIndex: number): void
  ripTrace(connectionId: number): void
  getViaOccupants(...args: number[]): number[]
  totalRipEvents: number
}

class ObservedCache extends Map<number, number[]> {
  hits = 0
  misses = 0
  writes = 0

  constructor(
    private enabled: boolean,
    private scratch: number[],
  ) {
    super()
  }

  override get(key: number): number[] | undefined {
    const value = super.get(key)
    if (value) this.hits++
    else this.misses++
    return value
  }

  override set(key: number, value: number[]): this {
    if (value === this.scratch) {
      throw new Error("Mutable via scratch was retained in the occupant cache")
    }
    this.writes++
    if (this.enabled) super.set(key, value)
    return this
  }
}

function observeSearches(
  solver: Solver,
  enabled: boolean,
  forceMemo = false,
): {
  cache: ObservedCache
  finalizedInvalidations: number
  rippedInvalidations: number
} {
  const state = solver as unknown as SearchState
  const cache = new ObservedCache(enabled, state._viaOccs)
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
      throw new Error(
        "Occupant cache was read before the new search cleared it",
      )
    }
    if (forceMemo) {
      // Reference behavior before the two-layer bypass: memoize every query.
      const key =
        solver instanceof HighDensitySolverA01
          ? args[0]! * solver.cols + args[1]!
          : args[0]!
      const cached = cache.get(key)
      if (cached) return cached
      // The old memo stored an independent array for each cell.
      const occupants = getViaOccupants(...args).slice()
      cache.set(key, occupants)
      return occupants
    }
    const occupants = getViaOccupants(...args)
    if (solver.layers <= 2 && occupants !== state._viaOccs) {
      throw new Error("Uncached via queries did not reuse their scratch array")
    }
    return occupants
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

const fixtures = [
  ["sample002", sample002],
  ["sample003", sample003],
  ["sample007", sample007.nodeWithPortPoints],
  ["prev-next", prevNext],
  ["repro03", repro03.nodeWithPortPoints],
  ["repro05", repro05[0]!.nodeWithPortPoints],
] as const

const solvers = [
  {
    name: "A01",
    create: (nodeWithPortPoints: NodeWithPortPoints) =>
      new HighDensitySolverA01({ ...defaultParams, nodeWithPortPoints }),
  },
  {
    name: "A03",
    create: (nodeWithPortPoints: NodeWithPortPoints) =>
      new HighDensitySolverA03({ ...defaultA03Params, nodeWithPortPoints }),
  },
]

for (const { name, create } of solvers) {
  describe(name, () => {
    let hits = 0
    let finalizedInvalidations = 0
    let rippedInvalidations = 0

    for (const [fixtureName, nodeWithPortPoints] of fixtures) {
      test(`caches via occupants without changing ${fixtureName} routes or search`, () => {
        const cached = create(nodeWithPortPoints)
        const reference = create(nodeWithPortPoints)
        cached.setup()
        reference.setup()
        const shouldCache = cached.layers > 2
        const observed = observeSearches(cached, true)
        const referenceStats = observeSearches(
          reference,
          !shouldCache,
          !shouldCache,
        )
        cached.solve()
        reference.solve()

        expect(getResult(cached)).toEqual(getResult(reference))
        expect(observed.cache.size).toBe(0)
        if (!shouldCache) {
          expect(observed.cache.hits).toBe(0)
          expect(observed.cache.misses).toBe(0)
          expect(observed.cache.writes).toBe(0)
          // The reference confirms the visited-state invariant: two-layer
          // searches never reuse a memoized occupant list.
          expect(referenceStats.cache.hits).toBe(0)
          if (cached.layers === 2) {
            expect(referenceStats.cache.misses).toBeGreaterThan(0)
          }
        }
        hits += observed.cache.hits
        finalizedInvalidations += observed.finalizedInvalidations
        rippedInvalidations += observed.rippedInvalidations
      })
    }

    afterAll(() => {
      expect(hits).toBeGreaterThan(0)
      expect(finalizedInvalidations).toBeGreaterThan(0)
      expect(rippedInvalidations).toBeGreaterThan(0)
    })
  })
}
