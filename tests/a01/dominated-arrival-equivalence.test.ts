import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("dominated arrivals preserve search budgets, rip decisions, and routes", (): void => {
  let avoidedNodes = 0
  for (const shuffleSeed of [0, 1, 2]) {
    const props = {
      nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
      cellSizeMm: 0.1,
      viaDiameter: 0.3,
      traceThickness: 0.1,
      traceMargin: 0.1,
      stepMultiplier: 1,
      hyperParameters: { shuffleSeed },
    }
    const actual = new HighDensitySolverA01(structuredClone(props))
    const reference = new HighDensitySolverA01(structuredClone(props))
    actual.setup()
    reference.setup()
    while (!reference.solved && !reference.failed) {
      // Disable arrival elision in the reference: every expansion creates the
      // original path-state objects. Each step expands at most one cell.
      reference["bestQueuedCost"].fill(Number.NaN)
      reference.step()
      actual.step()
      for (const key of [
        "solved",
        "failed",
        "iterations",
        "error",
        "searchIterations",
        "activeConnSeg",
        "unsolvedSegs",
        "solvedRoutes",
        "ripCount",
        "totalRipEvents",
        "penalty2d",
        "usedCellsFlat",
        "usedDiagFlat",
        "visitedStamp",
      ] as const) {
        expect(actual[key]).toEqual(reference[key])
      }
      avoidedNodes += reference["nodePool"].length - actual["nodePool"].length
    }
    expect(actual.solved).toBe(true)
    expect(actual.getOutput()).toEqual(reference.getOutput())
  }
  expect(avoidedNodes).toBeGreaterThan(0)
})
