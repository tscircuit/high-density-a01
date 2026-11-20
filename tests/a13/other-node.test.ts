import { expect, test } from "bun:test"
import { HighDensitySolverA13, findRouteGeometryViolations } from "../../lib"
import node from "../dataset01/sample008/sample008.json"

test("routes another existing ten-connection node at its original dimensions", () => {
  const solver = new HighDensitySolverA13({ nodeWithPortPoints: node })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toHaveLength(10)
  expect(
    findRouteGeometryViolations(
      solver.getOutput().map((r) => ({
        ...r,
        traceThickness: r.traceThickness + 0.1,
        viaDiameter: r.viaDiameter + 0.1,
      })),
    ),
  ).toEqual([])
})
