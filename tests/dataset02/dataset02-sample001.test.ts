import { expect, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"

const dataset02 = dataset02Json as Dataset02Sample[]

test("dataset02 sample001 converts and runs", () => {
  const sample = dataset02[0]
  if (!sample) {
    throw new Error("dataset02 has no samples")
  }

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: "dataset02-sample001",
      availableZ: [0, 1],
    },
  )

  expect(nodeWithPortPoints.portPoints.length).toBe(
    sample.connections.length * 2,
  )

  const solver = new HighDensitySolverA01({
    nodeWithPortPoints,
    cellSizeMm: 0.5,
    viaDiameter: 0.4,
  })
  solver.MAX_ITERATIONS = 10_000_000
  solver.solve()

  expect(solver.iterations).toBeGreaterThan(0)
  expect(solver.solved || solver.failed).toBeTrue()

  const visualization = solver.visualize()
  expect(visualization).toBeTruthy()
})
