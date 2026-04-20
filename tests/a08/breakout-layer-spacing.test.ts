import { expect, test } from "bun:test"
import { defaultA08Params } from "../../lib/default-params"
import { HighDensitySolverA08BreakoutSolver } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import type { NodeWithPortPoints } from "../../lib/types"

test("A08 breakout spaces inner-rect ports independently per layer", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "layer-spacing-repro",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [
      {
        connectionName: "right-z0-a",
        portPointId: "right-z0-a",
        x: 5,
        y: -4,
        z: 0,
      },
      {
        connectionName: "right-z0-b",
        portPointId: "right-z0-b",
        x: 5,
        y: 4,
        z: 0,
      },
      {
        connectionName: "right-z1-a",
        portPointId: "right-z1-a",
        x: 5,
        y: -4,
        z: 1,
      },
      {
        connectionName: "right-z1-b",
        portPointId: "right-z1-b",
        x: 5,
        y: 4,
        z: 1,
      },
    ],
  }

  const solver = new HighDensitySolverA08BreakoutSolver({
    ...defaultA08Params,
    nodeWithPortPoints,
    effort: 10,
  })
  solver.MAX_ITERATIONS = 10_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.innerRect).not.toBeNull()

  for (const route of solver.breakoutRoutes) {
    expect(route.route).toHaveLength(3)
  }

  const rightAssignments = solver.spreadAssignments
    .filter((assignment) => assignment.side === "right")
    .sort(
      (a, b) =>
        a.original.z - b.original.z ||
        a.original.y - b.original.y ||
        a.anchorKey.localeCompare(b.anchorKey),
    )

  expect(rightAssignments).toHaveLength(4)

  const z0AssignedYs = rightAssignments
    .filter((assignment) => assignment.original.z === 0)
    .map((assignment) => assignment.assigned.y)
    .sort((a, b) => a - b)
  const z1AssignedYs = rightAssignments
    .filter((assignment) => assignment.original.z === 1)
    .map((assignment) => assignment.assigned.y)
    .sort((a, b) => a - b)

  expect(z0AssignedYs).toHaveLength(2)
  expect(z1AssignedYs).toHaveLength(2)
  expect(z0AssignedYs[0]!).toBeCloseTo(z1AssignedYs[0]!, 6)
  expect(z0AssignedYs[1]!).toBeCloseTo(z1AssignedYs[1]!, 6)

  const breakoutBoundaryMarginMm =
    (defaultA08Params.breakoutTraceMarginMm ?? 0.1) / 2
  const idealTraceSpacing =
    (defaultA08Params.traceThickness ?? 0.1) +
    (defaultA08Params.breakoutTraceMarginMm ?? 0.1)
  const expectedGap =
    (solver.innerRect!.height - breakoutBoundaryMarginMm * 2) / 3

  expect(z0AssignedYs[1]! - z0AssignedYs[0]!).toBeCloseTo(expectedGap, 6)
  expect(z0AssignedYs[1]! - z0AssignedYs[0]!).toBeGreaterThan(idealTraceSpacing)
})
