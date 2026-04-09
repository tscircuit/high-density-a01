import { expect, setDefaultTimeout, test } from "bun:test"
import { defaultA05Params } from "../../lib/default-params"
import { HighDensitySolverA05 } from "../../lib/HighDensitySolverA05/HighDensitySolverA05"
import { validateNoIntersections } from "../fixtures/validateNoIntersections"
import repro05 from "../repros/repro05/repro05.json"

setDefaultTimeout(120_000)

test("repro05 A05 solves and reflows routes to 16 total segments", () => {
  const input = Array.isArray(repro05) ? repro05[0] : repro05
  if (!input) {
    throw new Error("repro05 fixture is empty")
  }

  const solver = new HighDensitySolverA05({
    ...defaultA05Params,
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

  for (const route of routes) {
    expect(route.route.length - 1).toBe(16)
  }
})
