import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)

import "bun-match-svg"
import "graphics-debug/matcher"
import { defaultA03Params } from "../../../lib/default-params"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { findSameLayerIntersections } from "../../fixtures/validateNoIntersections"
import sample002 from "../../dataset01/sample002/sample002.json"

function createSolver() {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: sample002,
  })
  solver.MAX_ITERATIONS = 10_000_000
  solver.solve()
  return solver
}

test("A03 sample002 has no same-layer intersections", () => {
  const solver = createSolver()
  const graphics = solver.visualize()
  const intersections = findSameLayerIntersections(solver.getOutput()).map(
    ({ trace1, trace2, z, type, point }) => ({
      trace1,
      trace2,
      z,
      type,
      point: {
        x: Number(point.x.toFixed(6)),
        y: Number(point.y.toFixed(6)),
      },
    }),
  )

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(graphics).toMatchGraphicsSvg(import.meta.path)
  expect(intersections).toEqual([])
})
