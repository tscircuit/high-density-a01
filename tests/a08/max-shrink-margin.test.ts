import { expect, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA08Params } from "../../lib/default-params"
import {
  HighDensitySolverA08,
  HighDensitySolverA08BreakoutSolver,
} from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import { getNodeBounds } from "../../lib/HighDensitySolverA08/shared"
import type { NodeWithPortPoints } from "../../lib/types"

const dataset02 = dataset02Json as Dataset02Sample[]

test("A08 breakout shrink honors a partial maxShrinkMargin per side", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "a08-max-shrink-margin",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [],
  }

  const solver = new HighDensitySolverA08BreakoutSolver({
    ...defaultA08Params,
    nodeWithPortPoints,
    cellSizeMm: 1,
    rectShrinkStepMm: 0.1,
    maxShrinkMargin: 0.05,
    maxCellCount: 100,
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.innerRect).not.toBeNull()
  expect(solver.shrinkCount).toBe(1)
  expect(solver.innerRect!.width).toBeCloseTo(9.9, 6)
  expect(solver.innerRect!.height).toBeCloseTo(9.9, 6)
})

test("A08 advances to A01 after reaching maxShrinkMargin even if breakout checks stay unsolved", () => {
  const sample = dataset02[9]
  if (!sample) {
    throw new Error("dataset02 sample010 is missing")
  }

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: "dataset02-10-max-shrink-margin",
      availableZ: [0, 1],
    },
  )

  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints,
    effort: 10,
    initialRectMarginMm: 1,
    breakoutMaxIterationsPerRect: 1,
    maxShrinkMargin: 0,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solveUntilStage("A01")

  const outerBounds = getNodeBounds(nodeWithPortPoints)

  expect(solver.stage).toBe("A01")
  expect(solver.failed).toBeFalse()
  expect(solver.breakoutSolver).not.toBeNull()
  expect(solver.breakoutSolver!.stats?.shrinkCount).toBe(0)
  expect(solver.breakoutSolver!.stats?.unsolvedSides).toContain("bottom")
  expect(solver.innerRect).not.toBeNull()
  expect(solver.innerRect!.minX).toBeCloseTo(outerBounds.minX + 1, 6)
  expect(solver.innerRect!.maxX).toBeCloseTo(outerBounds.maxX - 1, 6)
  expect(solver.innerRect!.minY).toBeCloseTo(outerBounds.minY + 1, 6)
  expect(solver.innerRect!.maxY).toBeCloseTo(outerBounds.maxY - 1, 6)
})
