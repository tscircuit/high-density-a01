import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)

import "bun-match-svg"
import "graphics-debug/matcher"
import { hgProblems } from "../../../../high-density-dataset-z04/hg-problem/index.ts"
import { defaultA02Params } from "../../../lib/default-params"
import { HighDensitySolverA02 } from "../../../lib/HighDensitySolverA02/HighDensitySolverA02"
import { findRouteGeometryViolations } from "../../fixtures/validateNoIntersections"

test("A02 z04 problem 2 has no route geometry violations", async () => {
  const entry = hgProblems[1]
  if (!entry) throw new Error("Missing Z04 problem 2")

  const solver = new HighDensitySolverA02({
    ...defaultA02Params,
    nodeWithPortPoints: entry.data,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  const graphics = solver.visualize()
  const violations = findRouteGeometryViolations(solver.getOutput())

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
  expect(violations).toEqual([])
})
