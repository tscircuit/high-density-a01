import { expect, setDefaultTimeout, test } from "bun:test"
import "bun-match-svg"
import "graphics-debug/matcher"
import { defaultA03Params } from "../../../lib/default-params"
import { defaultParams } from "../../../lib/default-params"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import repro05 from "./repro05.json"

setDefaultTimeout(120_000)

function getInput() {
  const input = Array.isArray(repro05) ? repro05[0] : repro05
  if (!input) {
    throw new Error("repro05 fixture is empty")
  }
  return input
}

function createA03Solver() {
  const input = getInput()
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    ...input,
    nodeWithPortPoints: input.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

test("repro05 snapshot", async () => {
  const solver = createA03Solver()
  const graphics = solver.visualize()

  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
  expect(solver.iterations).toBeGreaterThan(0)
  expect(solver.solved).toBeTrue()
})

test("repro05 A03 solves", () => {
  const solver = createA03Solver()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  console.log("A03 iterations used", solver.iterations)
  expect(solver.error).toBeNull()
})

test("repro05 A01 solves", () => {
  const input = getInput()

  const solver = new HighDensitySolverA01({
    ...defaultParams,
    cellSizeMm: input.highResolutionCellSize ?? defaultParams.cellSizeMm,
    traceMargin: input.traceMargin ?? defaultParams.traceMargin,
    traceThickness: input.traceThickness ?? defaultParams.traceThickness,
    viaDiameter: input.viaDiameter ?? defaultParams.viaDiameter,
    viaMinDistFromBorder:
      input.viaMinDistFromBorder ?? defaultParams.viaMinDistFromBorder,
    nodeWithPortPoints: input.nodeWithPortPoints,
    hyperParameters: input.hyperParameters,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  console.log("A01 iterations used", solver.iterations)
  expect(solver.error).toBeNull()
})
