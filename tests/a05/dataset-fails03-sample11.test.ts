import { expect, setDefaultTimeout, test } from "bun:test"
import { datasetFails03Entries } from "../../fixtures/dataset-fails03/dataset-fails03"
import { defaultA05Params } from "../../lib/default-params"
import { HighDensitySolverA05 } from "../../lib/HighDensitySolverA05/HighDensitySolverA05"

setDefaultTimeout(120_000)

test("A05 solves dataset-fails03 sample 11", () => {
  const sample = datasetFails03Entries[10]
  if (!sample) {
    throw new Error("dataset-fails03 sample 11 is missing")
  }

  const solver = new HighDensitySolverA05({
    ...defaultA05Params,
    nodeWithPortPoints: sample.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 10_000_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()
})
