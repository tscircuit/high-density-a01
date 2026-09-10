import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import { HighDensitySolverA12 } from "../lib/HighDensitySolverA12/HighDensitySolverA12"
import { findRouteGeometryViolations } from "../lib/routeGeometryValidation"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../lib/types"
import cmn113 from "./repros/srj18-sample013-cmn113.json"
import cmn129 from "./repros/srj18-sample013-cmn129.json"

function getPhysicalPairKey({
  rootConnectionName,
  start,
  end,
}: {
  rootConnectionName: string
  start: Pick<PortPoint, "x" | "y" | "z">
  end: Pick<PortPoint, "x" | "y" | "z">
}): string {
  const endpoints = [start, end]
    .map((point) => `${point.x},${point.y},${point.z}`)
    .sort()
  return `${rootConnectionName}|${endpoints.join("|")}`
}

function expectExactPhysicalPairCoverage(
  node: typeof cmn113,
  routes: HighDensityIntraNodeRoute[],
): void {
  const expectedPairKeys = node.portPointsInPairs.map(([start, end]) =>
    getPhysicalPairKey({
      rootConnectionName: start!.rootConnectionName ?? start!.connectionName,
      start: start!,
      end: end!,
    }),
  )
  const actualPairKeys = routes.map((route) =>
    getPhysicalPairKey({
      rootConnectionName: route.rootConnectionName ?? route.connectionName,
      start: route.route[0]!,
      end: route.route.at(-1)!,
    }),
  )

  expect(new Set(actualPairKeys)).toEqual(new Set(expectedPairKeys))
  expect(actualPairKeys).toHaveLength(new Set(expectedPairKeys).size)
}

test("A11 rejects outside input ports without moving ports or growing bounds", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "rounded-boundary",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "net", x: -1, y: 0, z: 0 },
      { connectionName: "net", x: 1 + 2e-7, y: 0, z: 0 },
    ],
  }
  const originalNode = structuredClone(node)
  const props = { nodeWithPortPoints: node, viaDiameter: 0.3 }
  for (const solver of [
    new HighDensitySolverA01({ ...props, cellSizeMm: 0.1 }),
    new HighDensitySolverA03(props),
    new HighDensitySolverA11(props),
  ]) {
    solver.solve()
    const isNative = solver instanceof HighDensitySolverA11
    expect(solver.solved).toBe(!isNative)
    expect(solver.failed).toBe(isNative)
    expect(node).toEqual(originalNode)
    if (isNative) {
      expect(solver.error).toContain("outside original node bounds")
      expect(solver.iterations).toBeLessThanOrEqual(1)
    }
  }
})

test("A11 preserves distinct physical pairs inside one grid cell", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "subcell-pairs",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0, 1],
    portPoints: [
      {
        connectionName: "a",
        rootConnectionName: "root",
        x: -0.237,
        y: -0.191,
        z: 0,
      },
      {
        connectionName: "a",
        rootConnectionName: "root",
        x: -0.236,
        y: -0.19,
        z: 0,
      },
      {
        connectionName: "b",
        rootConnectionName: "root",
        x: -0.238,
        y: -0.189,
        z: 0,
      },
      {
        connectionName: "b",
        rootConnectionName: "root",
        x: -0.234,
        y: -0.188,
        z: 0,
      },
      {
        connectionName: "alias-a",
        rootConnectionName: "root",
        x: -0.237,
        y: -0.191,
        z: 0,
      },
      {
        connectionName: "alias-a",
        rootConnectionName: "root",
        x: -0.236,
        y: -0.19,
        z: 0,
      },
    ],
  }
  const props = { nodeWithPortPoints, viaDiameter: 0.3 }
  for (const solver of [
    new HighDensitySolverA01({ ...props, cellSizeMm: 0.1 }),
    new HighDensitySolverA03(props),
    new HighDensitySolverA11(props),
  ]) {
    solver.MAX_ITERATIONS = 1_000
    solver.solve()
    expect(solver.solved).toBeTrue()
    const routes = solver.getOutput()
    const isNativeSolver = solver instanceof HighDensitySolverA11
    // Legacy solvers retain their existing grid-cell deduplication and shape.
    expect(routes).toHaveLength(isNativeSolver ? 2 : 1)
    expect(findRouteGeometryViolations(routes)).toEqual([])
    if (!isNativeSolver) continue
    const pairs = routes.map((route) =>
      route.route.map(({ x, y, z }) => [x, y, z]),
    )
    expect(pairs).toContainEqual([
      [-0.237, -0.191, 0],
      [-0.236, -0.19, 0],
    ])
    expect(pairs).toContainEqual([
      [-0.238, -0.189, 0],
      [-0.234, -0.188, 0],
    ])
    expect(
      routes.every((route) => route.rootConnectionName === "root"),
    ).toBeTrue()
  }
})

test("mixed-grid via scans account for earlier routes on every destination layer", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "multilayer-via-footprints",
    center: { x: 0, y: 0 },
    width: 3,
    height: 3,
    availableZ: [0, 1, 2, 3],
    portPoints: [1, 2, 3].flatMap((z) => [
      { connectionName: `net-${z}`, x: -1.5, y: z - 2, z: 0 },
      { connectionName: `net-${z}`, x: 1.5, y: z - 2, z },
    ]),
  }
  for (const Solver of [HighDensitySolverA03, HighDensitySolverA12]) {
    for (const shuffleSeed of [0, 1, 2]) {
      const solver = new Solver({
        nodeWithPortPoints,
        viaDiameter: 0.3,
        viaMinDistFromBorder: 0.15,
        traceThickness: 0.1,
        traceMargin: 0.1,
        hyperParameters: { shuffleSeed },
      })
      solver.MAX_ITERATIONS = 100_000
      solver.solve()
      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      const routes = solver.getOutput()
      expect(routes).toHaveLength(3)
      expect(findRouteGeometryViolations(routes)).toEqual([])
      for (const route of routes) {
        expect(route.vias.length).toBeGreaterThan(0)
        const layers = [route.route[0]!.z, route.route.at(-1)!.z].sort()
        expect(layers).toEqual([0, Number(route.connectionName.slice(4))])
      }
    }
  }
})

for (const [name, fixture] of [
  ["cmn_113", cmn113],
  ["cmn_129", cmn129],
] as const) {
  test(`A11 solves branch-heavy ${name} at native bounds with exact geometry`, () => {
    const node = structuredClone(fixture)
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
