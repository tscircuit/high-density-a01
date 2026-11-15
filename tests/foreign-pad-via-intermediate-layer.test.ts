import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { createObstacleSolvers } from "./fixtures/createObstacleSolvers"

test("vias avoid pads on layers between noncontiguous routing layers", (): void => {
  const pad = {
    center: { x: 0, y: 0 },
    width: 0.8,
    height: 0.8,
    zLayers: [1, 2],
    connectedTo: ["foreign"],
  }
  const solvers = createObstacleSolvers(
    {
      capacityMeshNodeId: "intermediate-layer-pad",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      availableZ: [0, 3],
      portPoints: [
        { x: -1.5, y: 0, z: 0, connectionName: "signal" },
        { x: 1.5, y: 0, z: 3, connectionName: "signal" },
      ],
    },
    [pad],
  )
  for (const solver of solvers) {
    solver.solve()
    expect(solver.solved).toBeTrue()
    const route = solver.getOutput()[0]!
    expect(route.vias.length).toBeGreaterThan(0)
    for (const via of route.vias) {
      expect(segmentToBoxMinDistance(via, via, pad)).toBeGreaterThanOrEqual(
        0.25 - 1e-9,
      )
    }
  }
})
