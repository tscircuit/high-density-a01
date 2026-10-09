import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import { getRouteGeometryViolationError } from "../lib/routeGeometryValidation"
import type { NodeWithPortPoints } from "../lib/types"

class SeparateBranchCopperSolver extends HighDensitySolverA11 {
  protected override shareSameNetCopper = false
}

test("A11 routes crossing branches of one net without ripping shared copper", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "shared-net-copper",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      {
        connectionName: "horizontal",
        rootConnectionName: "supply",
        x: -1,
        y: 0,
        z: 0,
      },
      {
        connectionName: "horizontal",
        rootConnectionName: "supply",
        x: 1,
        y: 0,
        z: 0,
      },
      {
        connectionName: "vertical",
        rootConnectionName: "supply",
        x: 0,
        y: -1,
        z: 0,
      },
      {
        connectionName: "vertical",
        rootConnectionName: "supply",
        x: 0,
        y: 1,
        z: 0,
      },
    ],
  }
  const originalNode = structuredClone(nodeWithPortPoints)
  const props = {
    nodeWithPortPoints,
    viaDiameter: 0.3,
    traceThickness: 0.1,
    traceMargin: 0.1,
  }
  const separateBranches = new SeparateBranchCopperSolver(props)
  separateBranches.solve()
  expect(separateBranches.failed).toBe(true)

  const sharedBranches = new HighDensitySolverA11(props)
  sharedBranches.solve()
  expect(sharedBranches.solved).toBe(true)
  expect(sharedBranches.failed).toBe(false)
  expect(sharedBranches.iterations).toBeLessThan(separateBranches.iterations)
  const routes = sharedBranches.getOutput()
  expect(routes).toHaveLength(2)
  expect(getRouteGeometryViolationError(routes)).toBeNull()
  for (const route of routes) {
    const ports = nodeWithPortPoints.portPoints.filter(
      (port) => port.connectionName === route.connectionName,
    )
    const endpoints = [route.route[0]!, route.route[route.route.length - 1]!]
    for (const port of ports) {
      expect(
        endpoints.some(
          (point) =>
            point.x === port.x && point.y === port.y && point.z === port.z,
        ),
      ).toBe(true)
    }
  }
  expect(nodeWithPortPoints).toEqual(originalNode)

  const differentNets = new HighDensitySolverA11({
    ...props,
    nodeWithPortPoints: {
      ...nodeWithPortPoints,
      portPoints: nodeWithPortPoints.portPoints.map((port) => ({
        ...port,
        rootConnectionName: port.connectionName,
      })),
    },
  })
  differentNets.solve()
  expect(differentNets.solved).toBe(false)
  expect(differentNets.failed).toBe(true)
})
