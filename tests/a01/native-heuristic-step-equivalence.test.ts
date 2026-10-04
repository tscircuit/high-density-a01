import { expect, test } from "bun:test"
import { isDeepStrictEqual } from "node:util"
import largeNode from "../../fixtures/srj18/cmn_4__sub_2_0.json"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { NodeWithPortPoints } from "../../lib/types"
import { FrozenHighDensitySolverA01 } from "../fixtures/frozen-a01-object-node-pool-solver"
import smallNode from "../repros/srj18-sample002-cmn279/cmn279.json"

function fullOriginalState(solver: any): Record<string, unknown> {
  const state: Record<string, unknown> = {}
  for (const name of Object.getOwnPropertyNames(solver)) {
    if (name === "heuristicCache") continue
    const value = solver[name]
    state[name] = name === "heap" ? { ...value } : value
  }
  state.output = solver.getOutput()
  state.activeConnection = solver.activeConnection
  state.openSet = solver.openSet
  state.gridStats = solver.gridStats
  return state
}

test("ordinary A01 matches all original default public steps in six frozen fixture prefixes", () => {
  let publicStepsCompared = 0
  let cachedStepsObserved = 0
  for (const node of [largeNode, smallNode]) {
    for (const shuffleSeed of [0, 1, 5]) {
      const props = {
        nodeWithPortPoints: node as NodeWithPortPoints,
        cellSizeMm: 0.1,
        viaDiameter: 0.3,
        viaMinDistFromBorder: 0.15,
        traceMargin: 0.1,
        traceThickness: 0.15,
        effort: 1,
        hyperParameters: { shuffleSeed },
      }
      const actual: any = new HighDensitySolverA01(structuredClone(props))
      const reference: any = new FrozenHighDensitySolverA01(structuredClone(props))
      for (let step = 0; step < 5000 && !reference.solved && !reference.failed; step++) {
        // The production portfolio reads this mutable debug map for fitness.
        actual.solvedConnectionsMap
        reference.solvedConnectionsMap
        actual.step()
        reference.step()
        publicStepsCompared++
        if (actual.heuristicCache) cachedStepsObserved++
        expect(isDeepStrictEqual(fullOriginalState(actual), fullOriginalState(reference))).toBeTrue()
      }
      expect(actual.solved).toBe(reference.solved)
      expect(actual.failed).toBe(reference.failed)
      expect(actual.error).toBe(reference.error)
      expect(actual.getOutput()).toEqual(reference.getOutput())
      actual.releaseHeuristicCache()
    }
  }
  expect(publicStepsCompared).toBe(30_000)
  expect(cachedStepsObserved).toBe(0)
})


test("batched cached A01 preserves all original state over 30000 native expansions", () => {
  let publicStepsCompared = 0
  let cachedStepsObserved = 0
  for (const node of [largeNode, smallNode]) {
    for (const shuffleSeed of [0, 1, 5]) {
      const props = {
        nodeWithPortPoints: node as NodeWithPortPoints,
        cellSizeMm: 0.1,
        viaDiameter: 0.3,
        viaMinDistFromBorder: 0.15,
        traceMargin: 0.1,
        traceThickness: 0.15,
        effort: 1,
        stepMultiplier: 1000,
        hyperParameters: { shuffleSeed },
      }
      const actual: any = new HighDensitySolverA01(structuredClone(props))
      const reference: any = new FrozenHighDensitySolverA01(structuredClone(props))
      for (let index = 0; index < 5; index++) {
        actual.solvedConnectionsMap
        reference.solvedConnectionsMap
        actual.step()
        reference.step()
        publicStepsCompared++
        if (actual.heuristicCache) cachedStepsObserved++
        expect(isDeepStrictEqual(fullOriginalState(actual), fullOriginalState(reference))).toBeTrue()
      }
      expect(actual.solved).toBe(reference.solved)
      expect(actual.failed).toBe(reference.failed)
      expect(actual.error).toBe(reference.error)
      expect(actual.getOutput()).toEqual(reference.getOutput())
      actual.releaseHeuristicCache()
    }
  }
  expect(publicStepsCompared).toBe(30)
  expect(cachedStepsObserved).toBe(30)
})
