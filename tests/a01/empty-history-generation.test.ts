import { expect, test } from "bun:test"
import { createEmptyHistoryPriorityFixture } from "../fixtures/create-empty-history-priority-fixture"

test("A01 invalidates empty-history priorities across searches and stamp wrap", (): void => {
  const { solver, targetIndex } = createEmptyHistoryPriorityFixture({
    targetLayer: 0,
    incumbentPriority: 2,
    successorCost: 3,
    heuristicCost: 0,
    rippedOwners: null,
  })
  const priorityBuffer = solver["emptyHistoryBestPriority"].buffer
  const stampBuffer = solver["emptyHistoryPriorityStamp"].buffer
  expect(solver["emptyHistoryBestPriority"].length).toBe(solver.gridStats.states)
  expect(solver["emptyHistoryPriorityStamp"].length).toBe(solver.gridStats.states)

  solver["heap"].clear()
  solver["nodePool"].length = 1
  solver["heap"].push(0, 0, 0)
  solver["seqCounter"] = 1
  solver["nextStamp"]()
  solver["visitedStamp"].fill(solver["stamp"])
  solver["visitedStamp"][solver.cols + 1] = 0
  solver["visitedStamp"][targetIndex] = 0
  solver.step()
  expect(solver["nodePool"].length).toBe(2)
  expect(solver["emptyHistoryBestPriority"][targetIndex]).toBe(3)

  solver["stamp"] = 0xffffffff
  solver["visitedStamp"].fill(0xffffffff)
  solver["emptyHistoryPriorityStamp"].fill(0xffffffff)
  solver["nextStamp"]()
  expect(solver["stamp"]).toBe(1)
  expect(solver["visitedStamp"].every((stamp) => stamp === 0)).toBeTrue()
  expect(solver["emptyHistoryPriorityStamp"].every((stamp) => stamp === 0)).toBeTrue()
  expect(solver["emptyHistoryBestPriority"].buffer).toBe(priorityBuffer)
  expect(solver["emptyHistoryPriorityStamp"].buffer).toBe(stampBuffer)
})
