import { expect, test } from "bun:test"
import {
  getA01FineGridCellSizeMm,
  HighDensitySolverA01FineGrid,
} from "../../../lib/HighDensitySolverA01FineGrid/HighDensitySolverA01FineGrid"
import { findRouteGeometryViolations } from "../../fixtures/validateNoIntersections"
import cmn279 from "./cmn279.json"

test("fine-grid cell size follows the smallest copper feature", () => {
  expect(
    getA01FineGridCellSizeMm({
      nodeWithPortPoints: cmn279,
      viaDiameter: 0.3,
      traceMargin: 0.15,
      traceThickness: 0.04,
    }),
  ).toBe(0.02)
  expect(() =>
    getA01FineGridCellSizeMm({
      nodeWithPortPoints: cmn279,
      viaDiameter: 0,
    }),
  ).toThrow("Fine-grid copper dimensions must be positive")
})

test("fine-grid A01 solves SRJ18 cmn_279 at native size with valid via clearance", () => {
  const solver = new HighDensitySolverA01FineGrid({
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
  expect(solver.cellSizeMm).toBeCloseTo(0.05, 12)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(routes).toHaveLength(4)
  expect(routes.reduce((count, route) => count + route.vias.length, 0)).toBe(2)
  expect(findRouteGeometryViolations(routes)).toEqual([])
})
