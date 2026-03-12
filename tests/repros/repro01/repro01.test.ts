import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)
import "bun-match-svg"
import "graphics-debug/matcher"
import { defaultParams } from "../../../lib/default-params"
import { HighDensitySolverA02 } from "../../../lib/HighDensitySolverA02/HighDensitySolverA02"
import repro01 from "./repro01.json"

function createSolver() {
  const solver = new HighDensitySolverA02({
    outerGridCellSize: 0.1,
    outerGridCellThickness: 10,
    innerGridCellSize: 0.4,
    ...defaultParams,
    nodeWithPortPoints: repro01.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 10_000_000
  solver.solve()
  return solver
}

test("repro01 snapshot", async () => {
  const solver = createSolver()

  console.log(
    `solved=${solver.solved} failed=${solver.failed} iterations=${solver.iterations} error=${solver.error}`,
  )
  console.log(
    `routes=${solver.solvedConnectionsMap.size} unsolved=${solver.unsolvedConnections.length}`,
  )
  if (solver.activeConnection) {
    console.log(`stuck on: ${solver.activeConnection.connectionName}`, {
      start: solver.activeConnection.start,
      end: solver.activeConnection.end,
      openSetSize: solver.openSet.length,
    })
  }

  const graphics = solver.visualize()

  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
  expect(solver.iterations).toBeGreaterThan(0)
})
