import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)
import "graphics-debug/matcher"
import { defaultParams } from "../../../lib/default-params"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import {
  findSameLayerIntersections,
  validateNoIntersections,
} from "../../fixtures/validateNoIntersections"
import sample004 from "./sample004.json"

function createSolver() {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: sample004.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 10_000_000
  solver.solve()
  return solver
}

test("sample004 solve", () => {
  const solver = createSolver()

  console.log(
    `solved=${solver.solved} failed=${solver.failed} iterations=${solver.iterations} error=${solver.error}`,
  )
  console.log(
    `routes=${solver.solvedConnectionsMap.size} unsolved=${solver.unsolvedConnections.length}`,
  )

  expect(solver.iterations).toBeGreaterThan(0)
  expect(solver.solved || solver.failed).toBeTrue()

  const graphics = solver.visualize()
  expect(graphics).toBeTruthy()

  const routes = solver.getOutput()
  const intersections = findSameLayerIntersections(routes)

  if (intersections.length > 0) {
    console.log("Found intersections:")
    for (const ix of intersections) {
      console.log(
        `  ${ix.trace1} x ${ix.trace2} on z=${ix.z} at (${ix.point.x.toFixed(3)}, ${ix.point.y.toFixed(3)})`,
      )
    }
  }

  validateNoIntersections(routes)
})
