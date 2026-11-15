import { expect, test } from "bun:test"
import { createObstacleSolvers } from "./fixtures/createObstacleSolvers"

test("only the connected net can use the extra layer covered by a pad", (): void => {
  const solvers = createObstacleSolvers(
    {
      capacityMeshNodeId: "crossing-over-ground-pad",
      center: { x: 0, y: 0 },
      width: 2.1,
      height: 2.1,
      availableZ: [0, 1],
      portPoints: [
        { x: -1, y: 0, z: 0, connectionName: "signal" },
        { x: 1, y: 0, z: 0, connectionName: "signal" },
        { x: 0, y: -1, z: 0, connectionName: "ground" },
        { x: 0, y: 1, z: 0, connectionName: "ground" },
      ],
    },
    [
      {
        center: { x: 0, y: 0 },
        width: 2.1,
        height: 2.1,
        zLayers: [1],
        connectedTo: ["ground-pad"],
      },
    ],
    {
      areIdsConnected: (a, b): boolean =>
        a === b || (a === "ground" && b === "ground-pad"),
    },
  )
  for (const solver of solvers) {
    solver.solve()
    expect(solver.solved).toBeTrue()
    const signal = solver
      .getOutput()
      .find((route) => route.connectionName === "signal")!
    const ground = solver
      .getOutput()
      .find((route) => route.connectionName === "ground")!
    expect(signal.vias).toHaveLength(0)
    expect(signal.route.every((point) => point.z === 0)).toBeTrue()
    expect(ground.vias.length).toBeGreaterThan(0)
    expect(ground.route.some((point) => point.z === 1)).toBeTrue()
  }
})
