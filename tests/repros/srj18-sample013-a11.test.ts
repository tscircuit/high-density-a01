import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "../../lib/HighDensitySolverA11/HighDensitySolverA11"
import { findRouteGeometryViolations } from "../../lib/routeGeometryValidation"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../../lib/types"
import cmn113 from "./srj18-sample013-cmn113.json"
import cmn129 from "./srj18-sample013-cmn129.json"

function getPhysicalPairKey(
  rootConnectionName: string,
  start: Pick<PortPoint, "x" | "y" | "z">,
  end: Pick<PortPoint, "x" | "y" | "z">,
): string {
  const endpoints = [start, end]
    .map((point) => `${point.x},${point.y},${point.z}`)
    .sort()
  return `${rootConnectionName}|${endpoints.join("|")}`
}

function expectExactPhysicalPairCoverage(
  node: NodeWithPortPoints,
  routes: HighDensityIntraNodeRoute[],
) {
  const expectedPairKeys = node.portPointsInPairs!.map(([start, end]) =>
    getPhysicalPairKey(
      start.rootConnectionName ?? start.connectionName,
      start,
      end,
    ),
  )
  const actualPairKeys = routes.map((route) =>
    getPhysicalPairKey(
      route.rootConnectionName ?? route.connectionName,
      route.route[0]!,
      route.route.at(-1)!,
    ),
  )

  expect(new Set(actualPairKeys)).toEqual(new Set(expectedPairKeys))
  expect(actualPairKeys).toHaveLength(new Set(expectedPairKeys).size)
}

for (const [name, fixture] of [
  ["cmn_113", cmn113],
  ["cmn_129", cmn129],
] as const) {
  test(`A11 solves branch-heavy ${name} at native bounds with exact geometry`, () => {
    const node = structuredClone(fixture) as NodeWithPortPoints
    const originalBounds = {
      center: structuredClone(node.center),
      width: node.width,
      height: node.height,
    }
    const solver = new HighDensitySolverA11({
      nodeWithPortPoints: node,
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
    expect(solver.iterations).toBeLessThanOrEqual(100_000)
    expect(findRouteGeometryViolations(routes)).toEqual([])
    expectExactPhysicalPairCoverage(node, routes)
    expect({
      center: node.center,
      width: node.width,
      height: node.height,
    }).toEqual(originalBounds)
  })
}
