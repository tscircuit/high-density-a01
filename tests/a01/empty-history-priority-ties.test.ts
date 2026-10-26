import { expect, test } from "bun:test"
import { createEmptyHistoryPriorityFixture } from "../fixtures/create-empty-history-priority-fixture"

test("A01 retains an earlier queued label when a lower g rounds to the same f", (): void => {
  for (const targetLayer of [0, 1]) {
    const { solver } = createEmptyHistoryPriorityFixture({
      targetLayer,
      incumbentPriority: 1e16,
      successorCost: 0.25,
      heuristicCost: 1e16,
      rippedOwners: null,
    })
    solver["nodePool"][1]!.g = 1
    solver.step()
    expect(solver["nodePool"].length).toBe(3)
    expect(solver["nodePool"][1]!.g).toBe(1)
    expect(solver["nodePool"][2]!.g).toBe(0.25)
    expect(solver["heap"].pop()).toBe(1)
    expect(solver["heap"].pop()).toBe(2)
  }
})
