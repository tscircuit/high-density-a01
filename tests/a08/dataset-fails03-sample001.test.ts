import { expect, test } from "bun:test"
import { datasetFails03Entries } from "../../fixtures/dataset-fails03/dataset-fails03"
import { defaultA08Params } from "../../lib/default-params"
import { HighDensitySolverA08 } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"

test("A08 shrinks dataset-fails03 sample 1 until breakout trace spacing clears the real trace keepout", () => {
  const sample = datasetFails03Entries[0]
  if (!sample) {
    throw new Error("dataset-fails03 sample 1 is missing")
  }

  const requiredTraceSpacing =
    (defaultA08Params.traceMargin ?? 0.15) +
    (defaultA08Params.traceThickness ?? 0.1)

  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints: sample.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 10_000_000
  solver.solveUntilStage("A01")

  expect(solver.stage).toBe("A01")
  expect(solver.failed).toBeFalse()
  expect(solver.breakoutSolver).not.toBeNull()
  expect(solver.breakoutSolver!.stats?.shrinkCount).toBeGreaterThan(0)

  const sideStats = solver.breakoutSolver!.stats?.sides
  if (!sideStats) {
    throw new Error(
      "A08 breakout stats are missing for dataset-fails03 sample 1",
    )
  }

  for (const side of ["left", "right", "bottom", "top"] as const) {
    const minSegmentDistance = sideStats[side]?.minSegmentDistance
    if (minSegmentDistance === null || minSegmentDistance === undefined) {
      continue
    }

    expect(minSegmentDistance).toBeGreaterThanOrEqual(
      requiredTraceSpacing - 1e-6,
    )
  }
})
