import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import { findRouteGeometryViolations } from "../lib/routeGeometryValidation"
import type { NodeWithPortPoints } from "../lib/types"

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
