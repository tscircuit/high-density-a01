import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { frozenA01Heuristic } from "../fixtures/FrozenA01Heuristic"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A01's exact via bound preserves every routing step and rip", (): void => {
  let comparedSteps = 0
  let ripEvents = 0
  for (const stepMultiplier of [1, 37]) {
    for (const shuffleSeed of [0, 1, 2]) {
      const props = {
        nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
        cellSizeMm: 0.1,
        viaDiameter: 0.3,
        traceThickness: 0.1,
        traceMargin: 0.1,
        stepMultiplier,
        hyperParameters: { shuffleSeed },
      }
      const actual = new HighDensitySolverA01(structuredClone(props))
      const original = new HighDensitySolverA01(structuredClone(props))
      actual.setup()
      original.setup()
      original["computeH"] = frozenA01Heuristic
      while (!original.solved && !original.failed) {
        actual.step()
        original.step()
        for (const key of [
          "solved",
          "failed",
          "error",
          "iterations",
          "progress",
          "nodePool",
          "heap",
          "seqCounter",
          "activeConnSeg",
          "activeConnId",
          "searchIterations",
          "unsolvedSegs",
          "solvedRoutes",
          "ripCount",
          "totalRipEvents",
          "penalty2d",
          "usedCellsFlat",
          "usedDiagFlat",
          "visitedStamp",
        ] as const) {
          expect(actual[key]).toEqual(original[key])
        }
        comparedSteps++
      }
      expect(actual.solved).toBe(true)
      expect(actual.getOutput()).toEqual(original.getOutput())
      ripEvents += actual["totalRipEvents"]
    }
  }
  expect(comparedSteps).toBeGreaterThan(1_000)
  expect(ripEvents).toBeGreaterThan(0)
})
