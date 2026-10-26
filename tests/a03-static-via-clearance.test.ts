import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { StaticRouteSegment } from "../lib/types"

test("A03 checks physical via landings in emitted coordinates without changing the unguided policy", () => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "guided-via",
      center: { x: 10, y: 20 },
      width: 2.2,
      height: 2.4,
      availableZ: [0, 3, 7],
      portPoints: [
        {
          x: 8.9,
          y: 19.75321,
          z: 0,
          connectionName: "route",
          rootConnectionName: "owner",
        },
        {
          x: 11.1,
          y: 20.31234,
          z: 7,
          connectionName: "route",
          rootConnectionName: "owner",
        },
      ],
    },
    viaDiameter: 0.3,
    traceThickness: 0.1,
    highResolutionCellSize: 0.1,
    highResolutionCellThickness: 8,
    lowResolutionCellSize: 0.4,
  }
  const calls: StaticRouteSegment[] = []
  const validator = (segment: StaticRouteSegment): boolean => {
    calls.push(structuredClone(segment))
    return (
      segment.start.z === segment.end.z ||
      (segment.start.x === segment.end.x &&
        segment.start.y === segment.end.y &&
        segment.start.x >= 10.25)
    )
  }
  const guidedParams = { ...params, staticSegmentValidator: validator }
  const guided = new HighDensitySolverA03(guidedParams)
  guided.solve()
  expect(guided.solved).toBe(true)
  const routes = guided.getOutput()
  expect(routes).toHaveLength(1)
  expect(routes[0]!.vias.length).toBeGreaterThan(0)
  expect(routes[0]!.vias.every((via) => via.x >= 10.25)).toBe(true)
  expect(calls.some((segment) => segment.start.z !== segment.end.z)).toBe(true)
  expect(
    calls.every(
      (segment) =>
        segment.connectionName === "route" &&
        segment.rootConnectionName === "owner" &&
        segment.traceThickness === 0.1 &&
        segment.viaDiameter === 0.3,
    ),
  ).toBe(true)
  const route = routes[0]!.route
  expect(route[0]).toEqual(params.nodeWithPortPoints.portPoints[0])
  expect(route.at(-1)).toEqual(params.nodeWithPortPoints.portPoints[1])
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1]!
    const end = route[index]!
    expect(
      calls.some(
        (segment) =>
          segment.start.x === start.x &&
          segment.start.y === start.y &&
          segment.start.z === start.z &&
          segment.end.x === end.x &&
          segment.end.y === end.y &&
          segment.end.z === end.z,
      ),
    ).toBe(true)
  }
  const legacy = new HighDensitySolverA03(params)
  const explicitUndefined = new HighDensitySolverA03({
    ...params,
    staticSegmentValidator: undefined,
  })
  legacy.solve()
  explicitUndefined.solve()
  expect(legacy.getOutput()).toEqual(explicitUndefined.getOutput())
  expect(legacy.iterations).toBe(explicitUndefined.iterations)
  expect(guided.MAX_ITERATIONS).toBe(legacy.MAX_ITERATIONS)
})
