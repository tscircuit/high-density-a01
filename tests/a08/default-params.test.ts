import { expect, test } from "bun:test"
import {
  defaultA08Params,
  getDefaultA08BreakoutBoundaryMarginMm,
} from "../../lib/default-params"
import {
  HighDensitySolverA08,
  HighDensitySolverA08BreakoutSolver,
} from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import type { NodeWithPortPoints } from "../../lib/types"

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "a08-defaults",
  center: { x: 0, y: 0 },
  width: 10,
  height: 10,
  availableZ: [0, 1],
  portPoints: [],
}

test("A08 normalizes omitted parameters from defaultA08Params", () => {
  const solver = new HighDensitySolverA08({
    nodeWithPortPoints,
  } as any)

  expect(solver.getConstructorParams()[0]).toMatchObject(defaultA08Params)
})

test("A08 breakout solver defaults stay aligned with defaultA08Params", () => {
  const solver = new HighDensitySolverA08BreakoutSolver({
    nodeWithPortPoints,
  })

  expect(solver.cellSizeMm).toBe(defaultA08Params.cellSizeMm)
  expect(solver.traceMargin).toBe(defaultA08Params.traceMargin)
  expect(solver.traceThickness).toBe(defaultA08Params.traceThickness)
  expect(solver.effort).toBe(defaultA08Params.effort)
  expect(solver.initialRectMarginMm).toBe(defaultA08Params.initialRectMarginMm)
  expect(solver.rectShrinkStepMm).toBe(defaultA08Params.rectShrinkStepMm)
  expect(solver.breakoutTraceMarginMm).toBe(
    defaultA08Params.breakoutTraceMarginMm,
  )
  expect(solver.breakoutBoundaryMarginMm).toBe(
    getDefaultA08BreakoutBoundaryMarginMm({}),
  )
  expect(solver.breakoutSegmentCount).toBe(
    defaultA08Params.breakoutSegmentCount,
  )
  expect(solver.breakoutMaxIterationsPerRect).toBe(
    defaultA08Params.breakoutMaxIterationsPerRect,
  )
  expect(solver.breakoutForceStepSize).toBe(
    defaultA08Params.breakoutForceStepSize,
  )
  expect(solver.breakoutRepulsionStrength).toBe(
    defaultA08Params.breakoutRepulsionStrength,
  )
  expect(solver.breakoutSmoothingStrength).toBe(
    defaultA08Params.breakoutSmoothingStrength,
  )
  expect(solver.breakoutAttractionStrength).toBe(
    defaultA08Params.breakoutAttractionStrength,
  )
  expect(solver.innerPortSpreadFactor).toBe(
    defaultA08Params.innerPortSpreadFactor,
  )
})

test("A08 breakout boundary margin stays derived from an overridden trace margin", () => {
  const breakoutTraceMarginMm = 0.24
  const solver = new HighDensitySolverA08BreakoutSolver({
    nodeWithPortPoints,
    breakoutTraceMarginMm,
  })

  expect(solver.breakoutTraceMarginMm).toBe(breakoutTraceMarginMm)
  expect(solver.breakoutBoundaryMarginMm).toBe(
    getDefaultA08BreakoutBoundaryMarginMm({ breakoutTraceMarginMm }),
  )
})
