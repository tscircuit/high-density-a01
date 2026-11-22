import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"

test("A01 drops via landings when restoring off-grid terminals", async (): Promise<void> => {
  for (const startZ of [0, 1]) {
    const start = { x: 0.12, y: 0.12, z: startZ, connectionName: "link" }
    const end = { x: 0.12, y: 0.13, z: 1 - startZ, connectionName: "link" }
    const solver = new HighDensitySolverA01({
      nodeWithPortPoints: {
        capacityMeshNodeId: "terminal-via",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        availableZ: [0, 1],
        portPoints: [start, end],
      },
      cellSizeMm: 0.1,
      viaDiameter: 0.2,
      traceThickness: 0.1,
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
    expect(landingLayers).toEqual([])

    if (startZ === 0) {
      await expect(
        getSvgFromGraphicsObject(solver.visualize(), {
          backgroundColor: "white",
        }),
      ).toMatchSvgSnapshot(import.meta.path)
    }
  }
})
