import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import {
  findSameLayerIntersections,
  getSameLayerIntersectionError,
} from "../lib/routeGeometryValidation"
import type { HighDensityIntraNodeRoute } from "../lib/types"

const intersectingRoutes: HighDensityIntraNodeRoute[] = [
  {
    connectionName: "net_a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
    ],
    vias: [],
  },
  {
    connectionName: "net_b",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  },
]

test("same-layer intersection validator ignores shared root nets", () => {
  const sameRootRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "clk_branch_0",
      rootConnectionName: "clk",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "clk_branch_1",
      rootConnectionName: "clk",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]

  expect(findSameLayerIntersections(sameRootRoutes)).toHaveLength(0)
  expect(getSameLayerIntersectionError(sameRootRoutes)).toBeNull()
})

test("A01 fails when final output contains same-layer intersections", () => {
  class InvalidOutputA01Solver extends HighDensitySolverA01 {
    override getOutput(): HighDensityIntraNodeRoute[] {
      return intersectingRoutes
    }
  }

  const solver = new InvalidOutputA01Solver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "validation-harness",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      portPoints: [],
      availableZ: [0],
    },
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    traceThickness: 0.1,
    traceMargin: 0.15,
  })

  solver.solve()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("A01 output validation failed")
  expect(solver.error).toContain("same-layer intersection")
})
