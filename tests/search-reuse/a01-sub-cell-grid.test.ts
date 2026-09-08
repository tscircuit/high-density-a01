import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import baseline from "./a01-sub-cell-baseline.json"

test("flat search nodes preserve original routes and failures for sub-cell dimensions", () => {
  // Captured from 57bd9e9 before flat storage, including both start layers,
  // same- and cross-layer endpoints, zero rows/columns, and a one-cell grid.
  for (const expected of baseline) {
    const { width, height, startZ, endZ } = expected
    const solver = new HighDensitySolverA01({
      cellSizeMm: 0.1,
      viaDiameter: 0.3,
      nodeWithPortPoints: {
        capacityMeshNodeId: "sub-cell-region",
        center: { x: 0, y: 0 },
        width,
        height,
        availableZ: [0, 1],
        portPoints: [
          { x: -width / 2, y: 0, z: startZ, connectionName: "net1" },
          { x: width / 2, y: 0, z: endZ, connectionName: "net1" },
        ],
      },
    })
    solver.solve()
    expect({
      width,
      height,
      startZ,
      endZ,
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      iterations: solver.iterations,
      routeHash: new Bun.CryptoHasher("sha256")
        .update(JSON.stringify(solver.getOutput()))
        .digest("hex"),
    }).toEqual(expected)
  }
})
