import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 accepts a grid via connected to exact terminals by legal wires", (): void => {
  const params = {
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
  }
  const reference = new HighDensitySolverA03(params)
  reference.solve()
  expect(reference.solved).toBe(true)
  const route = reference.getOutput()[0]!
  expect(route.vias).toHaveLength(1)
  const landing = route.vias[0]!
  const allowedPositions = [...params.nodeWithPortPoints.portPoints, landing]
  const solver = new HighDensitySolverA03({
    ...params,
    staticSegmentValidator: (segment): boolean => {
      if (segment.start.z !== segment.end.z) {
        const startAtLanding =
          segment.start.x === landing.x && segment.start.y === landing.y
        const endAtLanding =
          segment.end.x === landing.x && segment.end.y === landing.y
        return startAtLanding && endAtLanding
      }
      const startIsAllowed = allowedPositions.some(
        ({ x, y }) => x === segment.start.x && y === segment.start.y,
      )
      const endIsAllowed = allowedPositions.some(
        ({ x, y }) => x === segment.end.x && y === segment.end.y,
      )
      return startIsAllowed && endIsAllowed
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual(reference.getOutput())
})
