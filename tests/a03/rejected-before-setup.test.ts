import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("a rejected A03 candidate remains failed without allocating its grid", (): void => {
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: {
      capacityMeshNodeId: "rejected-grid",
      center: { x: 0, y: 0 },
      width: 200,
      height: 200,
      availableZ: [0, 1],
      portPoints: [],
    },
    viaDiameter: 0.3,
  })
  solver.failed = true
  solver.error = "Candidate rejected by its owner"

  solver.step()
  expect(solver.gridStats.states).toBe(0)
  expect(solver.solvedConnectionsMap.size).toBe(0)
  expect(solver.getOutput()).toEqual([])
  expect(solver.visualize().lines).toHaveLength(0)
  expect(solver.iterations).toBe(0)
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe("Candidate rejected by its owner")
})
