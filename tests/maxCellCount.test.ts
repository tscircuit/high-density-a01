import { expect, setDefaultTimeout, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA08 } from "../lib/HighDensitySolverA08/HighDensitySolverA08"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA08Params, defaultParams } from "../lib/default-params"
import sample001 from "./dataset01/sample001/sample001.json"

setDefaultTimeout(120_000)

const dataset02 = dataset02Json as Dataset02Sample[]

function advanceIntoA01(solver: HighDensitySolverA08) {
  solver.solveUntilStage("A01")
  solver.step()
  solver.step()
}

test("fails during setup when required cells exceed maxCellCount", () => {
  const cellSizeMm = 0.5
  const rows = Math.floor(sample001.height / cellSizeMm)
  const cols = Math.floor(sample001.width / cellSizeMm)
  const layers = new Set(sample001.portPoints.map((pp) => pp.z)).size
  const totalCells = rows * cols * layers

  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: sample001,
    cellSizeMm,
    maxCellCount: totalCells - 1,
  })

  solver.solve()

  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  expect(solver.error).toContain(
    `Cell count ${totalCells} exceeds maxCellCount ${totalCells - 1}`,
  )
  expect((solver as any).usedCellsFlat).toBeUndefined()
  expect((solver as any).portOwnerFlat).toBeUndefined()
  expect((solver as any).usedDiagFlat).toBeUndefined()
  expect((solver as any).visitedStamp).toBeUndefined()
})

test("A08 shrinks the inner rect until the derived A01 grid fits maxCellCount", () => {
  const sample = dataset02[9]
  if (!sample) {
    throw new Error("dataset02 sample010 is missing")
  }

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: "dataset02-10",
      availableZ: [0, 1],
    },
  )

  const baselineSolver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints,
    effort: 10,
  })
  baselineSolver.MAX_ITERATIONS = 100_000_000
  advanceIntoA01(baselineSolver)

  expect(baselineSolver.stage).toBe("A01")
  expect(baselineSolver.failed).toBeFalse()
  expect(baselineSolver.innerRect).not.toBeNull()
  expect(baselineSolver.innerSolver).not.toBeNull()
  expect(baselineSolver.innerSolver!.failed).toBeFalse()

  const baselineCellCount = baselineSolver.innerSolver!.gridStats.states
  const maxCellCount = baselineCellCount - 1

  const cappedSolver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints,
    effort: 10,
    maxCellCount,
  })
  cappedSolver.MAX_ITERATIONS = 100_000_000
  advanceIntoA01(cappedSolver)

  expect(cappedSolver.stage).toBe("A01")
  expect(cappedSolver.failed).toBeFalse()
  expect(cappedSolver.innerRect).not.toBeNull()
  expect(cappedSolver.innerSolver).not.toBeNull()
  expect(cappedSolver.innerSolver!.failed).toBeFalse()

  const cappedCellCount = cappedSolver.innerSolver!.gridStats.states

  expect(cappedCellCount).toBeLessThanOrEqual(maxCellCount)
  expect(cappedCellCount).toBeLessThan(baselineCellCount)
  expect(
    cappedSolver.innerRect!.width < baselineSolver.innerRect!.width ||
      cappedSolver.innerRect!.height < baselineSolver.innerRect!.height,
  ).toBeTrue()
})
