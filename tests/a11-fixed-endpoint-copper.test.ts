import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import {
  getFixedEndpointCopperOverlapError,
  getRouteGeometryViolationError,
} from "../lib/routeGeometryValidation"
import type { NodeWithPortPoints } from "../lib/types"

test("A11 rejects unavoidable endpoint copper overlap before search", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "fixed-endpoint-copper",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -1, y: 0, z: 0 },
      { connectionName: "a", x: 1, y: 0, z: 0 },
      { connectionName: "b", x: -1, y: 0.1, z: 0 },
      { connectionName: "b", x: 1, y: 0.1, z: 0 },
    ],
  }
  const original = structuredClone(nodeWithPortPoints)
  const solver = new HighDensitySolverA11({
    nodeWithPortPoints,
    traceThickness: 0.15,
    traceMargin: 0.1,
    viaDiameter: 0.3,
  })
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.iterations).toBe(0)
  expect(solver.error).toContain("Fixed endpoint copper overlaps")
  expect(nodeWithPortPoints).toEqual(original)

  const routes = ["a", "b"].map((connectionName) => ({
    connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: nodeWithPortPoints.portPoints.filter(
      (point) => point.connectionName === connectionName,
    ),
    vias: [],
  }))
  expect(getRouteGeometryViolationError(routes)).not.toBeNull()

  const params = {
    portPoints: nodeWithPortPoints.portPoints,
    traceThickness: 0.15,
  }
  expect(
    getFixedEndpointCopperOverlapError({
      ...params,
      portPoints: params.portPoints.map((point) => ({
        ...point,
        rootConnectionName: "shared-net",
      })),
    }),
  ).toBeNull()
  expect(
    getFixedEndpointCopperOverlapError({
      ...params,
      portPoints: params.portPoints.map((point) => ({
        ...point,
        z: point.connectionName === "b" ? 1 : 0,
      })),
    }),
  ).toBeNull()
  for (const distance of [0.15, 0.15 - 0.0000005]) {
    expect(
      getFixedEndpointCopperOverlapError({
        ...params,
        portPoints: params.portPoints.map((point) => ({
          ...point,
          y: point.connectionName === "b" ? distance : 0,
        })),
      }),
    ).toBeNull()
  }
  expect(
    getFixedEndpointCopperOverlapError({
      ...params,
      portPoints: params.portPoints.slice(0, 3),
    }),
  ).toBeNull()
  expect(
    getFixedEndpointCopperOverlapError({
      ...params,
      portPoints: params.portPoints.map((point) => ({
        ...point,
        y: 0,
        portPointId: String(point.x),
      })),
    }),
  ).toBeNull()
})
