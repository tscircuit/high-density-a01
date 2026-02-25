import { test, expect, setDefaultTimeout } from "bun:test"

setDefaultTimeout(120_000)
import "bun-match-svg"
import "graphics-debug/matcher"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample001 from "./sample001.json"
import { findSameLayerIntersections, validateNoIntersections } from "../../fixtures/validateNoIntersections"

function createSolver() {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: sample001,
    cellSizeMm: 0.5,
    viaDiameter: 0.3,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

test("sample001 solve", async () => {
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
})

test("sample001 no same-layer intersections", () => {
  const solver = createSolver()
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
