import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { StaticRouteSegment } from "../lib/types"

test("A03 validates its emitted via landing when exact terminals replace grid points", () => {
  const terminal = { x: 10.01234, y: 20.02345, connectionName: "stacked" }
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "off-grid-stacked-terminals",
      center: { x: 10, y: 20 },
      width: 2.2,
      height: 2.4,
      availableZ: [0, 7],
      portPoints: [{ ...terminal, z: 0 }, { ...terminal, z: 7 }],
    },
    viaDiameter: 0.3,
    traceThickness: 0.1,
    highResolutionCellSize: 0.1,
  }
  const viaChecks: StaticRouteSegment[] = []
  const guided = new HighDensitySolverA03({
    ...params,
    staticSegmentValidator: (segment) => {
      if (segment.start.z === segment.end.z) return true
      viaChecks.push(segment)
      return (
        segment.start.x === terminal.x &&
        segment.start.y === terminal.y &&
        segment.end.x === terminal.x &&
        segment.end.y === terminal.y
      )
    },
  })
  guided.solve()
  expect(guided.failed).toBe(true)
  expect(guided.getOutput()).toEqual([])
  expect(
    viaChecks.some(
      ({ start }) => start.x === terminal.x && start.y === terminal.y,
    ),
  ).toBe(true)
  expect(
    viaChecks.some(
      ({ start }) => start.x !== terminal.x || start.y !== terminal.y,
    ),
  ).toBe(true)

  const legacy = new HighDensitySolverA03(params)
  legacy.solve()
  expect(legacy.solved).toBe(true)
  const [route] = legacy.getOutput()
  expect(route!.route[0]).toEqual(params.nodeWithPortPoints.portPoints[0])
  expect(route!.route.at(-1)).toEqual(params.nodeWithPortPoints.portPoints[1])
  expect(route!.vias).toHaveLength(1)
  expect(route!.vias[0]).not.toEqual({ x: terminal.x, y: terminal.y })
})
