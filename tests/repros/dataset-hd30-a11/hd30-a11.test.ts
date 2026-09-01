import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "../../../lib/HighDensitySolverA11/HighDensitySolverA11"
import type { NodeWithPortPoints } from "../../../lib/types"
import { findRouteGeometryViolations } from "../../fixtures/validateNoIntersections"
import cmn279 from "./sample002-cmn_279.json"
import cmn36 from "./sample002-cmn_36.json"
import cmn117 from "./sample004-cmn_117.json"
import cmn345Sub02 from "./sample007-cmn_345__sub_0_2.json"
import cmn345Sub00 from "./sample007-cmn_345__sub_0_0.json"
import cmn447 from "./sample008-cmn_447.json"
import cmn438 from "./sample008-cmn_438.json"

const cases: Array<{
  id: string
  nodeWithPortPoints: NodeWithPortPoints
  expectedRouteCount: number
}> = [
  {
    id: "sample002-cmn_279",
    nodeWithPortPoints: cmn279,
    expectedRouteCount: 4,
  },
  {
    id: "sample004-cmn_117",
    nodeWithPortPoints: cmn117,
    expectedRouteCount: 2,
  },
  {
    id: "sample007-cmn_345__sub_0_2",
    nodeWithPortPoints: cmn345Sub02,
    expectedRouteCount: 2,
  },
  {
    id: "sample007-cmn_345__sub_0_0",
    nodeWithPortPoints: cmn345Sub00,
    expectedRouteCount: 2,
  },
  {
    id: "sample008-cmn_447",
    nodeWithPortPoints: cmn447,
    expectedRouteCount: 6,
  },
  {
    id: "sample008-cmn_438",
    nodeWithPortPoints: cmn438,
    expectedRouteCount: 3,
  },
]

function isSamePoint(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
) {
  return left.x === right.x && left.y === right.y && left.z === right.z
}

for (const testCase of cases) {
  test(`A11 solves ${testCase.id} at native bounds`, () => {
    const originalNode = structuredClone(testCase.nodeWithPortPoints)
    const solver = new HighDensitySolverA11({
      nodeWithPortPoints: testCase.nodeWithPortPoints,
      viaDiameter: 0.3,
      viaMinDistFromBorder: 0.15,
      traceMargin: 0.1,
      traceThickness: 0.1,
      effort: 1,
      hyperParameters: { shuffleSeed: 0 },
    })
    solver.MAX_ITERATIONS = 100_000

    solver.solve()

    const routes = solver.getOutput()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.cellSizeMm).toBeCloseTo(0.05, 12)
    expect(solver.iterations).toBeLessThan(10_000)
    expect(routes).toHaveLength(testCase.expectedRouteCount)
    expect(findRouteGeometryViolations(routes)).toEqual([])
    expect(testCase.nodeWithPortPoints).toEqual(originalNode)
    expect(solver.nodeWithPortPoints.width).toBe(originalNode.width)
    expect(solver.nodeWithPortPoints.height).toBe(originalNode.height)

    for (const route of routes) {
      const matchingPorts = originalNode.portPoints.filter(
        (portPoint) => portPoint.connectionName === route.connectionName,
      )
      expect(
        matchingPorts.some((portPoint) =>
          isSamePoint(portPoint, route.route[0]!),
        ),
      ).toBeTrue()
      expect(
        matchingPorts.some((portPoint) =>
          isSamePoint(portPoint, route.route[route.route.length - 1]!),
        ),
      ).toBeTrue()
    }
  })
}

test("A11 routes the shortest connections first to avoid blocking cmn_36", () => {
  const originalNode = structuredClone(cmn36) as NodeWithPortPoints
  const solver = new HighDensitySolverA11({
    nodeWithPortPoints: structuredClone(originalNode),
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0.15,
    traceMargin: 0.1,
    traceThickness: 0.1,
    effort: 1,
    hyperParameters: { shuffleSeed: 0 },
  })
  solver.MAX_ITERATIONS = 100_000

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.iterations).toBeLessThan(100_000)
  expect(solver.getOutput()).toHaveLength(14)
  expect(findRouteGeometryViolations(solver.getOutput())).toEqual([])
  expect(solver.nodeWithPortPoints.width).toBe(originalNode.width)
  expect(solver.nodeWithPortPoints.height).toBe(originalNode.height)
})
