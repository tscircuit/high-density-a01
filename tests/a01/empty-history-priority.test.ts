import { expect, test } from "bun:test"
import { createEmptyHistoryPriorityFixture } from "../fixtures/create-empty-history-priority-fixture"

test("A01 screens only strictly worse computed priorities with an empty history", (): void => {
  for (const targetLayer of [0, 1]) {
    for (const scenario of [
      { incumbent: 2, cost: 3, heuristic: 0, history: null, admitted: false },
      { incumbent: 2, cost: 2, heuristic: 0, history: null, admitted: true },
      { incumbent: 2, cost: 1, heuristic: 0, history: null, admitted: true },
      {
        incumbent: 2,
        cost: 3,
        heuristic: 0,
        history: { id: 4, prev: { id: 3, prev: null } },
        admitted: true,
      },
      {
        incumbent: 2,
        cost: 3,
        heuristic: 0,
        history: { id: 3, prev: { id: 4, prev: null } },
        admitted: true,
      },
      {
        incumbent: 1e16,
        cost: 0.25,
        heuristic: 1e16,
        history: null,
        admitted: true,
      },
      {
        incumbent: 1e16,
        cost: 3,
        heuristic: 1e16,
        history: null,
        admitted: false,
      },
    ]) {
      const { solver, targetIndex } = createEmptyHistoryPriorityFixture({
        targetLayer,
        incumbentPriority: scenario.incumbent,
        successorCost: scenario.cost,
        heuristicCost: scenario.heuristic,
        rippedOwners: scenario.history,
      })
      solver.step()
      expect(solver["nodePool"].length).toBe(scenario.admitted ? 3 : 2)
      expect(solver["heap"].size).toBe(scenario.admitted ? 2 : 1)
      expect(solver["seqCounter"]).toBe(3)
      if (scenario.admitted) {
        expect(solver["nodePool"][2]!.ripped).toBe(scenario.history)
        expect(solver["nodePool"][2]!.parentIdx).toBe(0)
      }
      if (scenario.history === null && scenario.admitted) {
        expect(solver["emptyHistoryBestPriority"][targetIndex]).toBe(
          scenario.cost + scenario.heuristic,
        )
      }
    }
  }
})
