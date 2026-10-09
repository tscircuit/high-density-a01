import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"

test("same-grid-cell endpoints cannot bypass foreign pad validation", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "same-cell-pad",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      portPoints: [
        { x: 0.01, y: 0.05, z: 0, connectionName: "signal" },
        { x: 0.09, y: 0.05, z: 0, connectionName: "signal" },
      ],
    },
    cellSizeMm: 0.2,
    highResolutionCellSize: 0.2,
    highResolutionCellThickness: 8,
    lowResolutionCellSize: 0.4,
    viaDiameter: 0.3,
    traceThickness: 0.01,
    traceMargin: 0.001,
    obstacles: [
      {
        center: { x: 0.05, y: 0.05 },
        width: 0.03,
        height: 0.03,
        zLayers: [0],
        connectedTo: ["foreign"],
      },
    ],
  }
  for (const solver of [
    new HighDensitySolverA01(params),
    new HighDensitySolverA03(params),
  ]) {
    solver.solve()
    expect(solver.solved).toBeFalse()
    expect(solver.failed).toBeTrue()
    expect(solver.error).toBe("Final route intersects a foreign obstacle")
  }
})
