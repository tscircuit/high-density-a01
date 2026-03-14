import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)
import "bun-match-svg"
import "graphics-debug/matcher"
import { defaultA02Params } from "../../../lib/default-params"
import { HighDensitySolverA02 } from "../../../lib/HighDensitySolverA02/HighDensitySolverA02"
import repro02 from "./repro02.json"

function createSolver() {
  const solver = new HighDensitySolverA02({
    ...defaultA02Params,
    nodeWithPortPoints: repro02.nodeWithPortPoints,
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

test("repro02 snapshot", async () => {
  const solver = createSolver()

  const graphics = solver.visualize()

  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.iterations).toBeGreaterThan(0)
})
