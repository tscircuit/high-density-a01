import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"

test("preserves opposite boundary terminals in thin routing regions", (): void => {
  for (const horizontal of [false, true]) {
    const start = {
      x: horizontal ? -0.08 : 0,
      y: horizontal ? 0 : -0.08,
      z: 0,
      connectionName: "net",
    }
    const end = { ...start, x: -start.x, y: -start.y }
    const solver = new HighDensitySolverA01({
      nodeWithPortPoints: {
        capacityMeshNodeId: "thin-region",
        center: { x: 0, y: 0 },
        width: horizontal ? 0.16 : 0.4,
        height: horizontal ? 0.4 : 0.16,
        availableZ: [0, 1],
        portPoints: [start, end],
      },
      cellSizeMm: 0.1,
      viaDiameter: 0.2,
    })
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const [route] = solver.getOutput()
    if (!route) throw new Error("Missing solved route")
    expect(route.route[0]).toEqual(start)
    expect(route.route.at(-1)).toEqual(end)
  }
})
