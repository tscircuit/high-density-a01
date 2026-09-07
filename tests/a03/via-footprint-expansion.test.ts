import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA12 } from "../../lib/HighDensitySolverA12/HighDensitySolverA12"
import { findRouteGeometryViolations } from "../../lib/routeGeometryValidation"
import type { NodeWithPortPoints } from "../../lib/types"

test("mixed-grid via scans account for earlier routes on every destination layer", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "multilayer-via-footprints",
    center: { x: 0, y: 0 },
    width: 3,
    height: 3,
    availableZ: [0, 1, 2, 3],
    portPoints: [1, 2, 3].flatMap((z) => [
      { connectionName: `net-${z}`, x: -1.5, y: z - 2, z: 0 },
      { connectionName: `net-${z}`, x: 1.5, y: z - 2, z },
    ]),
  }
  for (const Solver of [HighDensitySolverA03, HighDensitySolverA12]) {
    for (const shuffleSeed of [0, 1, 2]) {
      const solver = new Solver({
        nodeWithPortPoints,
        viaDiameter: 0.3,
        viaMinDistFromBorder: 0.15,
        traceThickness: 0.1,
        traceMargin: 0.1,
        hyperParameters: { shuffleSeed },
      })
      solver.MAX_ITERATIONS = 100_000
      solver.solve()
      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      const routes = solver.getOutput()
      expect(routes).toHaveLength(3)
      expect(findRouteGeometryViolations(routes)).toEqual([])
      for (const route of routes) {
        expect(route.vias.length).toBeGreaterThan(0)
        const layers = [route.route[0]!.z, route.route.at(-1)!.z].sort()
        expect(layers).toEqual([0, Number(route.connectionName.slice(4))])
      }
    }
  }
})
