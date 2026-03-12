import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)
import "bun-match-svg"
import "graphics-debug/matcher"
import { defaultA02V2Params } from "../../../lib/default-params"
import { HighDensitySolverA02_V2 } from "../../../lib/HighDensitySolverA02_V2/HighDensitySolverA02_V2"
import { validateNoIntersections } from "../../fixtures/validateNoIntersections"
import repro01 from "./repro01.json"

function createSolver() {
  const solver = new HighDensitySolverA02_V2({
    ...defaultA02V2Params,
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
