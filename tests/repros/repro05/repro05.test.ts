import { expect, test } from "bun:test"
import { defaultParams } from "../../../lib/default-params"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { defaultA03Params } from "../../../lib/default-params"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import repro05 from "./repro05.json"

test("repro05 A03 stops when it exceeds MAX_RIPS", () => {
  const input = Array.isArray(repro05) ? repro05[0] : repro05
  if (!input) {
    throw new Error("repro05 fixture is empty")
  }

  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    ...input,
    nodeWithPortPoints: input.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  console.log("A03 iterations used", solver.iterations)
  expect(solver.error).toContain("MAX_RIPS")
})

test("repro05 A01 stops when it exceeds MAX_RIPS", () => {
  const input = Array.isArray(repro05) ? repro05[0] : repro05
  if (!input) {
    throw new Error("repro05 fixture is empty")
  }

  const solver = new HighDensitySolverA01({
    ...defaultParams,
    cellSizeMm: input.highResolutionCellSize ?? defaultParams.cellSizeMm,
    traceMargin: input.traceMargin ?? defaultParams.traceMargin,
    traceThickness: input.traceThickness ?? defaultParams.traceThickness,
    viaDiameter: input.viaDiameter ?? defaultParams.viaDiameter,
    viaMinDistFromBorder:
      input.viaMinDistFromBorder ?? defaultParams.viaMinDistFromBorder,
    nodeWithPortPoints: input.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  console.log("A01 iterations used", solver.iterations)
  expect(solver.error).toContain("MAX_RIPS")
})
