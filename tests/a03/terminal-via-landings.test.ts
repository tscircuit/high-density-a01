import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 keeps via landings when restoring off-grid terminals", (): void => {
  for (const startZ of [0, 1]) {
    const start = { x: 0.01, y: 0.02, z: startZ, connectionName: "net" }
    const end = { x: 0.02, y: 0.03, z: 1 - startZ, connectionName: "net" }
    const solver = new HighDensitySolverA03({
      nodeWithPortPoints: {
        capacityMeshNodeId: "terminal-via",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        availableZ: [0, 1],
        portPoints: [start, end],
      },
      highResolutionCellSize: 0.1,
      viaDiameter: 0.2,
      traceThickness: 0.1,
      traceMargin: 0.05,
      viaMinDistFromBorder: 0.1,
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    const route = solver.getOutput()[0]!
    expect(route.route[0]).toMatchObject(start)
    expect(route.route.at(-1)).toMatchObject(end)
    expect(route.vias).toHaveLength(1)
    const via = route.vias[0]!
    const landingLayers = route.route
      .filter((point) => Math.hypot(point.x - via.x, point.y - via.y) < 1e-9)
      .map((point) => point.z)
    expect(landingLayers).toContain(0)
    expect(landingLayers).toContain(1)
  }
})
