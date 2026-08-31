import { expect, test } from "bun:test"
import { HighDensitySolverA13 } from "../../../lib/HighDensitySolverA13/HighDensitySolverA13"
import type { NodeWithPortPoints } from "../../../lib/types"
import { findRouteGeometryViolations } from "../../fixtures/validateNoIntersections"
import node from "./sample004-topology_merge_298.json"

function createSolver() {
  const solver = new HighDensitySolverA13({
    nodeWithPortPoints: structuredClone(node) as NodeWithPortPoints,
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0.15,
    traceMargin: 0.1,
    traceThickness: 0.1,
    effort: 1,
    hyperParameters: { shuffleSeed: 0 },
  })
  solver.MAX_ITERATIONS = 100_000
  solver.solve()
  return solver
}

test("A13 breaks the topology_merge_298 rip cycle at native bounds", () => {
  const first = createSolver()
  const second = createSolver()
  const routes = first.getOutput()
  const uniquePhysicalPairKeys = new Set(
    node.portPointsInPairs.map((portPointPair) => {
      const start = portPointPair[0]
      const end = portPointPair[1]
      if (!start || !end) {
        throw new Error("HD30 regression fixture contains an incomplete pair")
      }
      const endpointKeys = [start, end]
        .map((point) => `${point.x},${point.y},${point.z}`)
        .sort()
      return `${start.rootConnectionName}|${endpointKeys.join("|")}`
    }),
  )
  const routedPhysicalPairKeys = new Set(
    routes.map((route) => {
      const endpointKeys = [route.route[0]!, route.route.at(-1)!]
        .map((point) => `${point.x},${point.y},${point.z}`)
        .sort()
      return `${route.rootConnectionName ?? route.connectionName}|${endpointKeys.join("|")}`
    }),
  )

  expect(first.getSolverName()).toBe("HighDensitySolverA13")
  expect(first.solved).toBeTrue()
  expect(first.failed).toBeFalse()
  expect(first.iterations).toBeLessThan(10_000)
  // mst13 and mst14 describe the same physical segment on the same root net.
  expect(uniquePhysicalPairKeys.size).toBe(6)
  expect(routes).toHaveLength(uniquePhysicalPairKeys.size)
  expect(routedPhysicalPairKeys).toEqual(uniquePhysicalPairKeys)
  expect(findRouteGeometryViolations(routes)).toEqual([])
  expect(second.getOutput()).toEqual(routes)
  expect(first.nodeWithPortPoints.width).toBe(node.width)
  expect(first.nodeWithPortPoints.height).toBe(node.height)
})
