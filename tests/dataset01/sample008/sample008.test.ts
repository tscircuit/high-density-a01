import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)
import "graphics-debug/matcher"
import { defaultA08Params } from "../../../lib/default-params"
import { HighDensitySolverA08 } from "../../../lib/HighDensitySolverA08/HighDensitySolverA08"
import {
  findRouteGeometryViolations,
  findSameLayerIntersections,
  validateNoIntersections,
  validateRouteGeometry,
} from "../../fixtures/validateNoIntersections"
import sample008 from "./sample008.json"

function createSolver() {
  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints: sample008,
    effort: 10,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solve()
  return solver
}

test("sample008 A08 solve", () => {
  const solver = createSolver()

  console.log(
    `solved=${solver.solved} failed=${solver.failed} iterations=${solver.iterations} error=${solver.error}`,
  )
  console.log(
    `routes=${solver.getOutput().length} breakoutShrinkCount=${solver.breakoutSolver?.stats?.shrinkCount ?? 0}`,
  )

  expect(solver.iterations).toBeGreaterThan(0)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.getOutput()).toHaveLength(10)

  const graphics = solver.visualize()
  expect(graphics).toBeTruthy()

  const routes = solver.getOutput()
  const intersections = findSameLayerIntersections(routes)
  const violations = findRouteGeometryViolations(routes)

  if (intersections.length > 0) {
    console.log("Found intersections:")
    for (const ix of intersections) {
      console.log(
        `  ${ix.trace1} x ${ix.trace2} on z=${ix.z} at (${ix.point.x.toFixed(3)}, ${ix.point.y.toFixed(3)})`,
      )
    }
  }

  if (violations.length > 0) {
    console.log("Found route geometry violations:")
    for (const violation of violations) {
      console.log(
        `  ${violation.trace1} x ${violation.trace2} [${violation.type}] z=${violation.z ?? "all"} dist=${violation.distance.toFixed(3)} req=${violation.requiredDistance.toFixed(3)}`,
      )
    }
  }

  validateNoIntersections(routes)
  validateRouteGeometry(routes)
})
