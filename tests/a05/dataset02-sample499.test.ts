import { expect, setDefaultTimeout, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA05Params } from "../../lib/default-params"
import { HighDensitySolverA05 } from "../../lib/HighDensitySolverA05/HighDensitySolverA05"

setDefaultTimeout(120_000)

test("A05 default solves dataset02 sample 499", () => {
  const sample = (dataset02Json as Dataset02Sample[])[498]
  if (!sample) {
    throw new Error("dataset02 sample 499 is missing")
  }

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: "dataset02-499",
      availableZ: [0, 1],
    },
  )

  const solver = new HighDensitySolverA05({
    ...defaultA05Params,
    nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 10_000_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()
})
