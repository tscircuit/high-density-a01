import { expect, test } from "bun:test"
import { createEmptyHistoryPriorityFixture } from "../fixtures/create-empty-history-priority-fixture"

test("A01 never revives a closed cell using an earlier empty-history priority", (): void => {
  for (const targetLayer of [0, 1]) {
    const { solver, targetIndex } = createEmptyHistoryPriorityFixture({
      targetLayer,
      incumbentPriority: 2,
      successorCost: 1,
      heuristicCost: 0,
      rippedOwners: null,
    })
    solver["visitedStamp"][targetIndex] = solver["stamp"]
    let evaluatedMoves = 0
    solver["computeMoveCostAndRips"] = (): void => {
      evaluatedMoves++
    }
    solver.step()
    expect(evaluatedMoves).toBe(0)
    expect(solver["nodePool"].length).toBe(2)
    expect(solver["seqCounter"]).toBe(2)
    solver.step()
    expect(evaluatedMoves).toBe(0)
    expect(solver["emptyHistoryBestPriority"][targetIndex]).toBe(2)
    expect(solver["visitedStamp"][targetIndex]).toBe(solver["stamp"])
  }
})
