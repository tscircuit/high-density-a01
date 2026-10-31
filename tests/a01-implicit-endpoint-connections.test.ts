import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"

test("keeps implicit fixed-route anchors separate from ordinary route endpoints", (): void => {
  const start = { x: -0.08, y: 0, z: 0, connectionName: "fixed" }
  const end = { ...start, x: 0.08 }
  const wireStart = { ...start, z: 1, connectionName: "wire" }
  const wireEnd = { ...end, z: 1, connectionName: "wire" }
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "shared-cell",
      center: { x: 0, y: 0 },
      width: 0.16,
      height: 0.4,
      availableZ: [0, 1],
      portPoints: [start, end, wireStart, wireEnd],
    },
    cellSizeMm: 0.1,
    viaDiameter: 0.2,
    implicitEndpointConnectionNames: ["fixed"],
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routes = solver.getOutput()
  expect(routes.find((route) => route.connectionName === "fixed")?.route).toEqual([
    start,
  ])
  expect(routes.find((route) => route.connectionName === "wire")?.route).toEqual([
    wireStart,
    wireEnd,
  ])
})
