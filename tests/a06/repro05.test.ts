import { expect, setDefaultTimeout, test } from "bun:test"
import { defaultA06Params } from "../../lib/default-params"
import { HighDensitySolverA06 } from "../../lib/HighDensitySolverA06/HighDensitySolverA06"
import { validateNoIntersections } from "../../lib/routeGeometry"
import repro05 from "../repros/repro05/repro05.json"

setDefaultTimeout(120_000)

test("repro05 A06 solves with breakout and trunk phases", () => {
  const input = Array.isArray(repro05) ? repro05[0] : repro05
  if (!input) {
    throw new Error("repro05 fixture is empty")
  }

  const solver = new HighDensitySolverA06({
    ...defaultA06Params,
    ...input,
    nodeWithPortPoints: input.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()

  const routes = solver.getOutput()
  expect(routes.length).toBeGreaterThan(0)
  validateNoIntersections(routes)
})
