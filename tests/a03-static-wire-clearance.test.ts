import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { StaticRouteSegment } from "../lib/types"

test("A03 checks exact terminal connectors and rejects a blocked single-cell shortcut", () => {
  const node = {
    capacityMeshNodeId: "guided-wire",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { x: -1, y: 0.03141, z: 0, connectionName: "wire" },
      { x: 1, y: 0.02718, z: 0, connectionName: "wire" },
    ],
  }
  const calls: StaticRouteSegment[] = []
  const validator = (segment: StaticRouteSegment): boolean => {
    calls.push(structuredClone(segment))
    const { start, end } = segment
    if (Math.min(start.x, end.x) > 0.25 || Math.max(start.x, end.x) < -0.25)
      return true
    // A horizontal obstacle strip leaves corridors above and below it.
    return Math.min(start.y, end.y) > 0.3 || Math.max(start.y, end.y) < -0.3
  }
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: node,
    viaDiameter: 0.3,
    highResolutionCellSize: 0.1,
    staticSegmentValidator: validator,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const route = solver.getOutput()[0]!.route
  expect(route[0]).toEqual(node.portPoints[0])
  expect(route.at(-1)).toEqual(node.portPoints[1])
  expect(
    calls.some(
      (segment) =>
        segment.start.x === node.portPoints[0]!.x &&
        segment.start.y === node.portPoints[0]!.y,
    ),
  ).toBe(true)
  expect(
    calls.some(
      (segment) =>
        segment.end.x === node.portPoints[1]!.x &&
        segment.end.y === node.portPoints[1]!.y,
    ),
  ).toBe(true)
  for (let i = 1; i < route.length; i++) {
    expect(
      validator({
        connectionName: "wire",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        start: route[i - 1]!,
        end: route[i]!,
      }),
    ).toBe(true)
  }
  const tiny = new HighDensitySolverA03({
    nodeWithPortPoints: {
      ...node,
      width: 0.02,
      height: 0.02,
      portPoints: [
        { ...node.portPoints[0]!, x: -0.009, y: 0 },
        { ...node.portPoints[1]!, x: 0.009, y: 0 },
      ],
    },
    viaDiameter: 0.3,
    highResolutionCellSize: 0.1,
    staticSegmentValidator: () => false,
  })
  tiny.solve()
  expect(tiny.solved).toBe(false)
  expect(tiny.failed).toBe(true)
  expect(tiny.getOutput()).toEqual([])
})
