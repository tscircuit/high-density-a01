import { expect, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA08Params } from "../../lib/default-params"
import { HighDensitySolverA08 } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"

const dataset02 = dataset02Json as Dataset02Sample[]

test("A08 sample018 shrinks the tight left-side breakouts until they clear the configured breakout spacing", () => {
  const sample = dataset02[17]
  if (!sample) {
    throw new Error("dataset02 sample018 is missing")
  }

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: "dataset02-18",
      availableZ: [0, 1],
    },
  )

  const requiredTraceSpacing =
    (defaultA08Params.traceThickness ?? 0.1) +
    (defaultA08Params.breakoutTraceMarginMm ?? 0.1) / 2

  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints,
    effort: 10,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solveUntilStage("A01")

  expect(solver.stage).toBe("A01")
  expect(solver.failed).toBeFalse()
  expect(solver.breakoutSolver).not.toBeNull()
  expect(solver.breakoutSolver!.stats?.shrinkCount).toBeGreaterThan(0)

  const leftStats = solver.breakoutSolver!.stats?.sides.left
  expect(leftStats?.solved).toBeTrue()
  expect(leftStats?.idealSpacingSatisfied).toBeFalse()
  expect(leftStats?.minSegmentDistance).toBeGreaterThanOrEqual(
    requiredTraceSpacing - 1e-6,
  )
})
