import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"

test("preserves both terminals when a route occupies one grid cell", () => {
  const start = { x: 0, y: 0, z: 0, connectionName: "net" }
  const end = { x: 0.05, y: 0, z: 0, connectionName: "net" }
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "single-cell",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      portPoints: [start, end],
    },
    cellSizeMm: 0.3,
    viaDiameter: 0.3,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const [route] = solver.getOutput()
  if (!route) throw new Error("Missing solved route")
  expect(route.route).toEqual([start, end])
})
