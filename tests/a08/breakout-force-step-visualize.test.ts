import { expect, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA08Params } from "../../lib/default-params"
import { HighDensitySolverA08BreakoutSolver } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import type { NodeWithPortPoints } from "../../lib/types"

const dataset02 = dataset02Json as Dataset02Sample[]
const TRACE_COLORS = [
  "rgba(255,0,0,0.85)",
  "rgba(0,0,255,0.85)",
  "rgba(255,165,0,0.85)",
  "rgba(0,128,0,0.85)",
]

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

function getTwoLayerRightSideNodeWithPortPoints(): NodeWithPortPoints {
  return {
    capacityMeshNodeId: "breakout-force-colors",
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
  const expectedRouteColors = new Set(
    solver.breakoutRoutes.map(
      (route) => TRACE_COLORS[route.route[0]!.z] ?? "rgba(128,128,128,0.85)",
    ),
  )
  const actualRouteColors = new Set(
    (visualization.lines ?? []).map(
      (line) => line.strokeColor ?? "rgba(128,128,128,0.85)",
    ),
  )
  for (const color of expectedRouteColors) {
    expect(actualRouteColors.has(color)).toBeTrue()
  }
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
  expect((visualization.lines ?? []).length).toBeGreaterThan(
    solver.breakoutRoutes.length,
  )
  const expectedRouteColors = new Set(
    solver.breakoutRoutes.map(
      (route) => TRACE_COLORS[route.route[0]!.z] ?? "rgba(128,128,128,0.85)",
    ),
  )
  const routeLineColors = new Set(
    (visualization.lines ?? [])
      .slice(0, solver.breakoutRoutes.length)
      .map((line) => line.strokeColor ?? "rgba(128,128,128,0.85)"),
  )
  for (const color of expectedRouteColors) {
    expect(routeLineColors.has(color)).toBeTrue()
  }
  expect(
    (visualization.points ?? []).some((point) =>
      (point.label ?? "").includes(" mid Δ="),
    ),
  ).toBeTrue()
})

test("A08 breakout visualize colors route segments by layer during force improvement", () => {
  const solver = new HighDensitySolverA08BreakoutSolver({
    ...defaultA08Params,
    nodeWithPortPoints: getTwoLayerRightSideNodeWithPortPoints(),
    effort: 10,
  })

  solver.setup()
  solver.step()

  const visualization = solver.visualize()
  const expectedRouteColors = new Set(
    solver.breakoutRoutes.map(
      (route) => TRACE_COLORS[route.route[0]!.z] ?? "rgba(128,128,128,0.85)",
    ),
  )
  expect(expectedRouteColors.size).toBe(2)

  const routeLineColors = new Set(
    (visualization.lines ?? [])
      .slice(0, solver.breakoutRoutes.length)
      .map((line) => line.strokeColor ?? "rgba(128,128,128,0.85)"),
  )
  for (const color of expectedRouteColors) {
    expect(routeLineColors.has(color)).toBeTrue()
  }
})
