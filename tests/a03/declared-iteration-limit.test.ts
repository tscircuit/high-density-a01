import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 retains a declared iteration cap through setup and reconstruction", (): void => {
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: {
      capacityMeshNodeId: "bounded-grid",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [
        { x: -2, y: -1, z: 0, connectionName: "a" },
        { x: 2, y: 1, z: 0, connectionName: "a" },
        { x: -2, y: 1, z: 0, connectionName: "b" },
        { x: 2, y: -1, z: 0, connectionName: "b" },
      ],
    },
    viaDiameter: 0.3,
    maxIterations: 1,
  })

  expect(solver.MAX_ITERATIONS).toBe(1)
  expect(solver.gridStats.states).toBe(0)
  const reconstructed = new HighDensitySolverA03(
    solver.getConstructorParams()[0],
  )
  expect(reconstructed.MAX_ITERATIONS).toBe(1)
  solver.setup()
  expect(solver.gridStats.states).toBeGreaterThan(0)
  expect(solver.MAX_ITERATIONS).toBe(1)
  expect(solver.getConstructorParams()[0].maxIterations).toBe(1)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.iterations).toBe(1)
  expect(solver.error).toContain("ran out of iterations")
})
