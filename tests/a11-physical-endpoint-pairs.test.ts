import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import { getRouteGeometryViolationError } from "../lib/routeGeometryValidation"
import type { NodeWithPortPoints } from "../lib/types"

class GridPairA11 extends HighDensitySolverA11 {
  protected override preservePhysicalEndpointPairs = false
}

test("A11 preserves distinct physical pairs and both endpoints within one cell", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "physical-endpoint-pairs",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { connectionName: "a", x: -1, y: 0, z: 0 },
      { connectionName: "a", x: 1, y: 0, z: 0 },
      { connectionName: "b", x: -1, y: 0.005, z: 0 },
      { connectionName: "b", x: 1, y: 0.005, z: 0 },
      { connectionName: "short", x: 0, y: 1, z: 0 },
      { connectionName: "short", x: 0.001, y: 1, z: 0 },
      { connectionName: "alias", x: -1, y: 0, z: 0 },
      { connectionName: "alias", x: 1, y: 0, z: 0 },
      { connectionName: "zero", x: -0.5, y: -1, z: 0 },
      { connectionName: "zero", x: -0.5, y: -1, z: 0 },
    ].map((point) => ({ ...point, rootConnectionName: "supply" })),
  }
  const props = {
    nodeWithPortPoints,
    traceThickness: 0.15,
    traceMargin: 0.1,
    viaDiameter: 0.3,
  }
  const gridPairs = new GridPairA11(props)
  gridPairs.solve()
  expect(
    gridPairs.getOutput().find((route) => route.connectionName === "b"),
  ).toBeUndefined()
  expect(
    gridPairs.getOutput().find((route) => route.connectionName === "short")
      ?.route,
  ).toHaveLength(1)

  const physicalPairs = new HighDensitySolverA11(props)
  physicalPairs.solve()
  expect(physicalPairs.solved).toBe(true)
  const routes = physicalPairs.getOutput()
  expect(routes).toHaveLength(3)
  expect(
    routes.find((route) => route.connectionName === "b")?.route.at(-1),
  ).toMatchObject({ x: 1, y: 0.005, z: 0 })
  expect(
    routes.find((route) => route.connectionName === "short")?.route,
  ).toMatchObject([
    { x: 0, y: 1, z: 0 },
    { x: 0.001, y: 1, z: 0 },
  ])
  expect(
    routes.some(
      (route) =>
        route.connectionName === "alias" || route.connectionName === "zero",
    ),
  ).toBe(false)
  expect(getRouteGeometryViolationError(routes)).toBeNull()
})
