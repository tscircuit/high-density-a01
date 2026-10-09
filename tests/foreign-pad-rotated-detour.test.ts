import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { createObstacleSolvers } from "./fixtures/createObstacleSolvers"

test("traces detour around foreign rotated pads with clearance", (): void => {
  const pad = {
    center: { x: 0, y: 0 },
    width: 1,
    height: 0.3,
    zLayers: [0],
    connectedTo: ["foreign"],
    ccwRotationDegrees: 45,
  }
  const solvers = createObstacleSolvers(
    {
      capacityMeshNodeId: "rotated-pad-detour",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      availableZ: [0],
      portPoints: [
        { x: -1.5, y: 0, z: 0, connectionName: "signal" },
        { x: 1.5, y: 0, z: 0, connectionName: "signal" },
      ],
    },
    [pad],
  )
  for (const solver of solvers) {
    solver.solve()
    expect(solver.solved).toBeTrue()
    const route = solver.getOutput()[0]!
    expect(route.route.some((point) => Math.abs(point.y) > 0.15)).toBeTrue()
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!
      const b = route.route[i]!
      const distance = segmentToBoxMinDistance(
        { x: (a.x + a.y) / Math.SQRT2, y: (a.y - a.x) / Math.SQRT2 },
        { x: (b.x + b.y) / Math.SQRT2, y: (b.y - b.x) / Math.SQRT2 },
        pad,
      )
      expect(distance).toBeGreaterThanOrEqual(0.15 - 1e-9)
    }
  }
})
