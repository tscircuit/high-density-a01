import { expect, test } from "bun:test"
import { getConnectionPortPointPairs } from "../../../lib/getConnectionPortPointPairs"
import { HighDensitySolverA12 } from "../../../lib/HighDensitySolverA12/HighDensitySolverA12"
import { findRouteGeometryViolations } from "../../../lib/routeGeometryValidation"
import type { NodeWithPortPoints } from "../../../lib/types"
import nodeWithPortPoints from "./node.json"

test("A12 reroutes around mixed-grid diagonal crossings at native bounds", () => {
  const solver = new HighDensitySolverA12({
    nodeWithPortPoints: nodeWithPortPoints as NodeWithPortPoints,
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0.15,
    traceMargin: 0.1,
    traceThickness: 0.1,
    effort: 1,
    hyperParameters: { shuffleSeed: 0 },
  })
  solver.MAX_ITERATIONS = 15_000

  solver.solve()

  const routes = solver.getOutput()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.iterations).toBeLessThan(6_000)
  expect(solver.lowResolutionCellSize).toBe(solver.highResolutionCellSize)
  expect(findRouteGeometryViolations(routes)).toEqual([])

  const expectedPhysicalPairs = new Set(
    [
      ...new Set(
        nodeWithPortPoints.portPoints.map((point) => point.connectionName),
      ),
    ]
      .flatMap((connectionName) =>
        getConnectionPortPointPairs(
          nodeWithPortPoints.portPoints.filter(
            (point) => point.connectionName === connectionName,
          ),
        ),
      )
      .map(([start, end]) =>
        [start, end]
          .map((point) => `${point.x},${point.y},${point.z}`)
          .sort()
          .join("|"),
      ),
  )
  const actualPhysicalPairs = routes.map((route) =>
    [route.route[0]!, route.route.at(-1)!]
      .map((point) => `${point.x},${point.y},${point.z}`)
      .sort()
      .join("|"),
  )
  expect(new Set(actualPhysicalPairs)).toEqual(expectedPhysicalPairs)
  expect(actualPhysicalPairs).toHaveLength(expectedPhysicalPairs.size)
})
