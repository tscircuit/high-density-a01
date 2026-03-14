import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)
import "bun-match-svg"
import "graphics-debug/matcher"
import { defaultA03Params } from "../../../lib/default-params"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import repro02 from "./repro02.json"

function createSolver() {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: repro02.nodeWithPortPoints,
    hyperParameters: {
      ripCost: 1,
      greedyMultiplier: 1.2,
    },
  })
  solver.MAX_ITERATIONS = 20_000_000
  solver.solve()
  return solver
}

test.skip("repro02 snapshot", async () => {
  const solver = createSolver()

  const graphics = solver.visualize()

  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
  expect(solver.iterations).toBeGreaterThan(0)
})
