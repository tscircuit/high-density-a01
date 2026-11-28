import { expect, test } from "bun:test"
import "graphics-debug/matcher"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 stores large route footprints without exceeding the argument limit", (): void => {
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: {
      capacityMeshNodeId: "fine-grid-corridor",
      center: { x: 0, y: 0 },
      width: 12,
      height: 1,
      availableZ: [0],
      portPoints: [
        { x: -6, y: 0, z: 0, connectionName: "signal" },
        { x: 6, y: 0, z: 0, connectionName: "signal" },
      ],
    },
    traceThickness: 0.08,
    traceMargin: 0.14,
    viaDiameter: 0.35,
    highResolutionCellSize: 0.005,
    highResolutionCellThickness: 32,
    lowResolutionCellSize: 0.005,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  const [route] = solver.getOutput()
  expect(route!.route[0]).toEqual(solver.nodeWithPortPoints.portPoints[0])
  expect(route!.route.at(-1)).toEqual(solver.nodeWithPortPoints.portPoints[1])
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
