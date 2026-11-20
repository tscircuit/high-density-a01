import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 rejects a forbidden terminal wire on its actual copper layer", (): void => {
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: {
      capacityMeshNodeId: "terminal-landings",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { x: -0.23, y: -0.17, z: 0, connectionName: "signal" },
        { x: -0.21, y: -0.16, z: 1, connectionName: "signal" },
      ],
    },
    highResolutionCellSize: 0.1,
    highResolutionCellThickness: 8,
    lowResolutionCellSize: 0.4,
    traceThickness: 0.1,
    traceMargin: 0.05,
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0,
    staticSegmentValidator: (segment): boolean => {
      const isLayerZeroWire = segment.start.z === 0 && segment.end.z === 0
      const hasLength =
        segment.start.x !== segment.end.x || segment.start.y !== segment.end.y
      return !(isLayerZeroWire && hasLength)
    },
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
})
