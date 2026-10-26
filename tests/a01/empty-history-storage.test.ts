import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A01 empty-history tables stay grid-bounded and respect the cell cap", (): void => {
  const props = {
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    enableEmptyHistoryOpenPruning: true,
  }
  const solver = new HighDensitySolverA01(props)
  solver.setup()
  const priorities = solver["emptyHistoryBestPriority"]
  const stamps = solver["emptyHistoryPriorityStamp"]
  expect(priorities.byteLength + stamps.byteLength).toBe(
    solver.gridStats.states * 12,
  )
  for (let setupCall = 0; setupCall < 100; setupCall++) solver.setup()
  expect(solver["emptyHistoryBestPriority"]).toBe(priorities)
  expect(solver["emptyHistoryPriorityStamp"]).toBe(stamps)

  const capped = new HighDensitySolverA01({ ...props, maxCellCount: 1 })
  capped.setup()
  expect(capped.failed).toBeTrue()
  expect(capped["emptyHistoryBestPriority"]).toBeUndefined()
  expect(capped["emptyHistoryPriorityStamp"]).toBeUndefined()
})
