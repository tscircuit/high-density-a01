import { expect, test } from "bun:test"
import { BaseSolver } from "@tscircuit/solver-utils"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A01 releases terminal search records while preserving native state", (): void => {
  let releasedRecords = 0
  let comparedSteps = 0
  for (const outcome of [
    "solved",
    "iteration-limit",
    "extended-limit",
    "empty-open-set",
    "convergence-limit",
    "rip-limit",
    "exception",
    "setup-limit",
  ] as const) {
    const props = {
      nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
      cellSizeMm: 0.1,
      viaDiameter: 0.3,
      traceThickness: 0.1,
      traceMargin: 0.1,
      hyperParameters: { shuffleSeed: 1 },
      maxCellCount: outcome === "setup-limit" ? 0 : undefined,
    }
    const actual = new HighDensitySolverA01(structuredClone(props))
    const original = new HighDensitySolverA01(structuredClone(props))
    original.step = BaseSolver.prototype.step
    actual.setup()
    original.setup()
    for (const solver of [actual, original]) {
      if (outcome === "iteration-limit" || outcome === "extended-limit") {
        solver.MAX_ITERATIONS = 64
      }
      if (outcome === "extended-limit") {
        solver._step = function (): void {
          HighDensitySolverA01.prototype._step.call(this)
          if (this.iterations === 64) this.MAX_ITERATIONS = 128
        }
      }
      if (outcome === "convergence-limit") solver["baseSearchBudgetIters"] = 0
      if (outcome === "rip-limit") solver.MAX_RIPS = 0
      if (outcome === "exception") {
        solver["computeMoveCostAndRips"] = (): never => {
          throw new Error("forced native search failure")
        }
      }
    }
    while (!original.solved && !original.failed) {
      if (outcome === "empty-open-set" && original.iterations === 1) {
        actual["heap"].clear()
        original["heap"].clear()
      }
      if (outcome === "exception" && original.iterations === 1) {
        expect(() => actual.step()).toThrow("forced native search failure")
        expect(() => original.step()).toThrow("forced native search failure")
      } else {
        actual.step()
        original.step()
      }
      for (const key of [
        "solved",
        "failed",
        "error",
        "iterations",
        "progress",
        "activeConnection",
        "openSet",
        "gridStats",
        "activeConnSeg",
        "activeConnId",
        "searchIterations",
        "seqCounter",
      ] as const) {
        expect(actual[key]).toEqual(original[key])
      }
      if (!original.solved && !original.failed) {
        expect(actual["nodePool"]).toEqual(original["nodePool"])
      }
      comparedSteps++
    }
    expect(actual.solved).toBe(outcome === "solved")
    expect(actual.failed).toBe(outcome !== "solved")
    expect(actual.getOutput()).toEqual(original.getOutput())
    expect(actual.visualize()).toEqual(original.visualize())
    expect(actual.stats).toEqual(original.stats)
    for (const key of [
      "penalty2d",
      "usedCellsFlat",
      "usedDiagFlat",
      "visitedStamp",
      "ripCount",
      "totalRipEvents",
    ] as const) {
      expect(actual[key]).toEqual(original[key])
    }
    if (original["nodePool"]) {
      releasedRecords += original["nodePool"].length
      expect(actual["nodePool"]).toHaveLength(0)
      expect(actual["_moveRipped"]).toBeNull()
    }
    const terminalIterations = actual.iterations
    actual.step()
    actual.setup()
    expect(actual.iterations).toBe(terminalIterations)
    expect(actual.getOutput()).toEqual(original.getOutput())
  }
  expect(releasedRecords).toBeGreaterThan(100)
  expect(comparedSteps).toBeGreaterThan(1_000)
})
