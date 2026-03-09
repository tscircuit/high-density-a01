import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { defaultParams } from "../lib/default-params"
import sample001 from "./dataset01/sample001/sample001.json"

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
