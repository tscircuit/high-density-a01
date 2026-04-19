import { expect, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA08Params } from "../../lib/default-params"
import { HighDensitySolverA08BreakoutSolver } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"

const dataset02 = dataset02Json as Dataset02Sample[]

function getSample18NodeWithPortPoints() {
  const sample = dataset02[17]
  if (!sample) {
    throw new Error("dataset02 sample018 is missing")
  }

  return convertDataset02SampleToNodeWithPortPoints(sample, {
    capacityMeshNodeId: "dataset02-18",
    availableZ: [0, 1],
  })
}

test("A08 breakout initializes the middle point at the straight-line midpoint", () => {
  const solver = new HighDensitySolverA08BreakoutSolver({
    ...defaultA08Params,
    nodeWithPortPoints: getSample18NodeWithPortPoints(),
    effort: 10,
  })

  solver.setup()

  expect(solver.innerRect).not.toBeNull()
  expect(solver.breakoutRoutes.length).toBeGreaterThan(0)

  for (const route of solver.breakoutRoutes) {
    expect(route.route).toHaveLength(3)
    expect(route.route[1]!.x).toBeCloseTo(
      (route.route[0]!.x + route.route[2]!.x) / 2,
      6,
    )
    expect(route.route[1]!.y).toBeCloseTo(
      (route.route[0]!.y + route.route[2]!.y) / 2,
      6,
    )
  }

  const visualization = solver.visualize()
  expect(visualization.arrows ?? []).toHaveLength(0)
  expect(visualization.circles ?? []).toHaveLength(0)
  expect(
    (visualization.lines ?? []).every((line) => line.strokeWidth === undefined),
  ).toBeTrue()
})

test("A08 breakout step runs one force iteration and visualizes midpoint forces", () => {
  const solver = new HighDensitySolverA08BreakoutSolver({
    ...defaultA08Params,
    nodeWithPortPoints: getSample18NodeWithPortPoints(),
    effort: 10,
  })

  solver.setup()
  solver.step()

  expect(solver.iterationsAtCurrentRect).toBe(1)
  expect(solver.lastForceIteration).not.toBeNull()
  expect(solver.lastForceIteration!.rectIteration).toBe(1)
  expect(solver.lastForceIteration!.side).toBe("left")
  expect(
    solver.lastForceIteration!.snapshots.some(
      (snapshot) =>
        Math.hypot(snapshot.appliedDelta.x, snapshot.appliedDelta.y) > 1e-6,
    ),
  ).toBeTrue()

  const visualization = solver.visualize()
  expect(visualization.arrows ?? []).toHaveLength(0)
  expect(visualization.circles ?? []).toHaveLength(0)
  expect(
    (visualization.lines ?? []).every((line) => line.strokeWidth === undefined),
  ).toBeTrue()
  expect(
    (visualization.lines ?? []).length,
  ).toBeGreaterThan(solver.breakoutRoutes.length)
  expect(
    (visualization.points ?? []).some((point) =>
      (point.label ?? "").includes(" mid Δ="),
    ),
  ).toBeTrue()
})
