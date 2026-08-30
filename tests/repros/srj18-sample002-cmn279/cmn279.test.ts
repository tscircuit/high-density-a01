import { expect, test } from "bun:test"
import {
  getA11CellSizeMm,
  HighDensitySolverA11,
} from "../../../lib/HighDensitySolverA11/HighDensitySolverA11"
import { findRouteGeometryViolations } from "../../fixtures/validateNoIntersections"
import cmn279 from "./cmn279.json"

test("A11 cell size follows the smallest copper feature", () => {
  expect(
    getA11CellSizeMm({
      nodeWithPortPoints: cmn279,
      viaDiameter: 0.3,
      traceMargin: 0.15,
      traceThickness: 0.04,
    }),
  ).toBe(0.02)
  expect(() =>
    getA11CellSizeMm({
      nodeWithPortPoints: cmn279,
      viaDiameter: 0,
    }),
  ).toThrow("A11 copper dimensions must be positive")
})

test("A11 solves SRJ18 cmn_279 at native size with valid via clearance", () => {
  const solver = new HighDensitySolverA11({
    nodeWithPortPoints: cmn279,
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0.15,
    traceMargin: 0.1,
    traceThickness: 0.1,
    effort: 1,
    hyperParameters: { shuffleSeed: 0 },
  })

  solver.solve()

  const routes = solver.getOutput()
  expect(solver.getSolverName()).toBe("HighDensitySolverA11")
  expect(solver.cellSizeMm).toBeCloseTo(0.05, 12)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(routes).toHaveLength(4)
  expect(routes.reduce((count, route) => count + route.vias.length, 0)).toBe(2)
  expect(findRouteGeometryViolations(routes)).toEqual([])
})
