import { expect, setDefaultTimeout, test } from "bun:test"
import { defaultA08Params, defaultParams } from "../../../lib/default-params"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA08 } from "../../../lib/HighDensitySolverA08/HighDensitySolverA08"
import cmn39 from "./cmn_39.json"

setDefaultTimeout(120_000)

const TEST_MAX_ITERATIONS = 100_000_000
const TEST_EFFORT = 10

let cachedA01Solver: HighDensitySolverA01 | null = null
let cachedA08Solver: HighDensitySolverA08 | null = null

function pointToRectDistance(
  point: { x: number; y: number },
  rect: { minX: number; maxX: number; minY: number; maxY: number },
) {
  const dx =
    point.x < rect.minX
      ? rect.minX - point.x
      : point.x > rect.maxX
        ? point.x - rect.maxX
        : 0
  const dy =
    point.y < rect.minY
      ? rect.minY - point.y
      : point.y > rect.maxY
        ? point.y - rect.maxY
        : 0
  return Math.hypot(dx, dy)
}

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

test("cmn_39 A08 exact inset fails without fallback", () => {
  const solver = getA08Solver()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.stage).toBe("A08_BreakoutSolver")
  expect(solver.error).toContain("A08_BreakoutSolver")
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

test("cmn_39 A08 inner rect maintains 1mm clearance", () => {
  const solver = getA08Solver()
  if (!solver.innerRect) {
    throw new Error("A08 did not compute an inner rect")
  }

  expect(solver.innerRect.width).toBeGreaterThan(0)
  expect(solver.innerRect.height).toBeGreaterThan(0)

  for (const portPoint of cmn39.portPoints) {
    expect(
      pointToRectDistance(portPoint, solver.innerRect),
    ).toBeGreaterThanOrEqual(0.999)
  }
})

test("cmn_39 comparison logs A01 vs A08", () => {
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
  })

  expect(a08Solver.iterations).toBeGreaterThan(0)
})
