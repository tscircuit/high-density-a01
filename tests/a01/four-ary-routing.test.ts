import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { getLogicalA01Heap } from "../fixtures/fourAryHeapTestUtils"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("four-ary A01 preserves every routing step, rip, priority and output", (): void => {
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
      const actual = new HighDensitySolverA01({
        ...structuredClone(props),
        enableFourAryHeap: true,
      })
      const original = new HighDensitySolverA01(structuredClone(props))
      actual.setup()
      original.setup()
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
        expect(getLogicalA01Heap(actual["heap"])).toEqual(
          getLogicalA01Heap(original["heap"]),
        )
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
