import { expect, setDefaultTimeout, test } from "bun:test"
import "bun-match-svg"
import "graphics-debug/matcher"
import { defaultA08Params, defaultParams } from "../../../lib/default-params"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA08 } from "../../../lib/HighDensitySolverA08/HighDensitySolverA08"
import {
  findRouteGeometryViolations,
  findSameLayerIntersections,
  validateNoIntersections,
  validateRouteGeometry,
} from "../../fixtures/validateNoIntersections"
import cmn39 from "./cmn_39.json"

setDefaultTimeout(120_000)

const TEST_MAX_ITERATIONS = 100_000_000
const TEST_EFFORT = 10
const REQUIRED_TRACE_SPACING =
  (defaultA08Params.traceMargin ?? 0.15) +
  (defaultA08Params.traceThickness ?? 0.1)

let cachedA01Solver: HighDensitySolverA01 | null = null
let cachedA08Solver: HighDensitySolverA08 | null = null
let cachedTightInsetA08Solver: HighDensitySolverA08 | null = null

function getA01Solver() {
  if (cachedA01Solver) return cachedA01Solver

  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: cmn39,
    effort: TEST_EFFORT,
  })
  solver.MAX_ITERATIONS = TEST_MAX_ITERATIONS
  solver.solve()
  cachedA01Solver = solver
  return solver
}

function getA08Solver() {
  if (cachedA08Solver) return cachedA08Solver

  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints: cmn39,
    effort: TEST_EFFORT,
  })
  solver.MAX_ITERATIONS = TEST_MAX_ITERATIONS
  solver.solve()
  cachedA08Solver = solver
  return solver
}

function getTightInsetA08Solver() {
  if (cachedTightInsetA08Solver) return cachedTightInsetA08Solver

  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints: cmn39,
    effort: TEST_EFFORT,
    initialRectMarginMm: 1,
  })
  solver.MAX_ITERATIONS = TEST_MAX_ITERATIONS
  solver.solve()
  cachedTightInsetA08Solver = solver
  return solver
}

test("cmn_39 A08 snapshot", async () => {
  const solver = getA08Solver()
  const graphics = solver.visualize()

  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
})

test("cmn_39 A08 solves with breakout spreading before A01", () => {
  const solver = getA08Solver()
  const routes = solver.getOutput()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(routes.length).toBeGreaterThan(0)
  expect(solver.breakoutSolver?.stats?.shrinkCount).toBeGreaterThan(0)

  const sideStats = solver.breakoutSolver?.stats?.sides
  if (!sideStats) {
    throw new Error("A08 breakout stats are missing for cmn_39")
  }

  for (const side of ["right", "bottom"] as const) {
    expect(sideStats[side]?.solved).toBeTrue()
    expect(sideStats[side]?.idealSpacingSatisfied).toBeTrue()
    expect(sideStats[side]?.minSegmentDistance).toBeGreaterThanOrEqual(
      REQUIRED_TRACE_SPACING - 1e-6,
    )
  }

  const intersections = findSameLayerIntersections(routes)
  const violations = findRouteGeometryViolations(routes)

  if (intersections.length > 0) {
    console.log("Found intersections:")
    for (const ix of intersections) {
      console.log(
        `  ${ix.trace1} x ${ix.trace2} on z=${ix.z} at (${ix.point.x.toFixed(3)}, ${ix.point.y.toFixed(3)})`,
      )
    }
  }

  if (violations.length > 0) {
    console.log("Found route geometry violations:")
    for (const violation of violations) {
      console.log(
        `  ${violation.trace1} x ${violation.trace2} [${violation.type}] z=${violation.z ?? "all"} dist=${violation.distance.toFixed(3)} req=${violation.requiredDistance.toFixed(3)}`,
      )
    }
  }

  validateNoIntersections(routes)
  validateRouteGeometry(routes)
})

test("cmn_39 A08 can still fail in breakout after exhausting a 1mm inset shrink", () => {
  const solver = getTightInsetA08Solver()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.stage).toBe("A08_BreakoutSolver")
  expect(solver.error).toContain(
    "A08_BreakoutSolver could not shrink the inner rect any further",
  )
})

test("cmn_39 A08 starts with the breakout pipeline stage", () => {
  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints: cmn39,
    effort: TEST_EFFORT,
  })
  solver.MAX_ITERATIONS = TEST_MAX_ITERATIONS

  solver.step()
  expect(solver.stage).toBe("A08_BreakoutSolver")
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeFalse()
  expect(solver.breakoutSolver).not.toBeNull()
  expect(solver.breakoutSolver?.iterations).toBe(0)
  expect(solver.innerSolver).toBeNull()
  expect(solver.innerRect).toBeNull()

  solver.step()
  expect(solver.stage).toBe("A08_BreakoutSolver")
  expect(solver.breakoutSolver?.iterations).toBe(1)
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeFalse()
  expect(solver.innerRect).not.toBeNull()
  expect(solver.innerSolver).toBeNull()

  solver.step()
  expect(solver.stage).toBe("A08_BreakoutSolver")
  expect(solver.breakoutSolver?.iterations).toBe(2)
  expect(solver.innerSolver).toBeNull()
})

test("cmn_39 comparison logs A01 failing vs A08 solving", () => {
  const a01Solver = getA01Solver()
  const a08Solver = getA08Solver()

  console.log("A01", {
    solved: a01Solver.solved,
    failed: a01Solver.failed,
    error: a01Solver.error,
    iterations: a01Solver.iterations,
    routes: a01Solver.getOutput().length,
    gridStats: a01Solver.gridStats,
  })

  console.log("A08", {
    solved: a08Solver.solved,
    failed: a08Solver.failed,
    error: a08Solver.error,
    iterations: a08Solver.iterations,
    routes: a08Solver.getOutput().length,
    gridStats: a08Solver.gridStats,
    innerRect: a08Solver.innerRect,
    breakoutStats: a08Solver.breakoutSolver?.stats,
  })

  expect(a01Solver.solved).toBeFalse()
  expect(a01Solver.failed).toBeTrue()
  expect(a08Solver.solved).toBeTrue()
  expect(a08Solver.failed).toBeFalse()
  expect(a08Solver.iterations).toBeGreaterThan(0)
})

test("cmn_39 A08 default inner rect keeps breakout endpoints inside the inset", () => {
  const solver = getA08Solver()
  if (!solver.innerRect) {
    throw new Error("A08 did not compute an inner rect")
  }

  expect(solver.innerRect.width).toBeGreaterThan(0)
  expect(solver.innerRect.height).toBeGreaterThan(0)

  for (const route of solver.breakoutRoutes) {
    expect(route.assigned.x).toBeGreaterThanOrEqual(
      solver.innerRect.minX - 1e-6,
    )
    expect(route.assigned.x).toBeLessThanOrEqual(solver.innerRect.maxX + 1e-6)
    expect(route.assigned.y).toBeGreaterThanOrEqual(
      solver.innerRect.minY - 1e-6,
    )
    expect(route.assigned.y).toBeLessThanOrEqual(solver.innerRect.maxY + 1e-6)
  }
})
