import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)
import "bun-match-svg"
import "graphics-debug/matcher"
import { defaultA02Params } from "../../../lib/default-params"
import { HighDensitySolverA02 } from "../../../lib/HighDensitySolverA02/HighDensitySolverA02"
import { validateNoIntersections } from "../../fixtures/validateNoIntersections"
import repro01 from "./repro01.json"

function createSolver() {
  const solver = new HighDensitySolverA02({
    ...defaultA02Params,
    nodeWithPortPoints: repro01.nodeWithPortPoints,
    enableDeferredConflictRepair: true,
    maxDeferredRepairPasses: 48,
    edgePenaltyStrength: 0.2,
    hyperParameters: {
      ripCost: 1,
      greedyMultiplier: 1.2,
    },
  })
  solver.MAX_ITERATIONS = 20_000_000
  solver.solve()
  return solver
}

test("repro01 snapshot", async () => {
  const solver = createSolver()

  const graphics = solver.visualize()
  validateNoIntersections(solver.getOutput())

  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
  expect(solver.iterations).toBeGreaterThan(0)
  expect(solver.solved).toBeTrue()
})
