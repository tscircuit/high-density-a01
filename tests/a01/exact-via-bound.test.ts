import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import {
  type A01HeuristicContext,
  frozenA01Heuristic,
} from "../fixtures/FrozenA01Heuristic"

test("A01 retains the exact control heuristic over integer via-zone contexts", (): void => {
  const computeH = (
    HighDensitySolverA01.prototype as unknown as {
      computeH: typeof frozenA01Heuristic
    }
  ).computeH
  let comparisons = 0
  const zoneRanges = [
    [-2, 2],
    [0, 4],
    [2, 4],
    [4, 2],
  ] as const
  const layerContexts = [
    [0, 0, false],
    [0, 1, false],
    [0, 1, true],
  ] as const
  for (const [min, max] of zoneRanges) {
    for (const cellSizeMm of [0.1, 0.07, Math.PI / 100]) {
      for (const viaBaseCost of [0, 0.8]) {
        for (const [z, toZ, crossLayerSearch] of layerContexts) {
          const context: A01HeuristicContext = {
            minViaRow: min,
            maxViaRow: max,
            minViaCol: min + 1,
            maxViaCol: max - 1,
            cellSizeMm,
            hyperParameters: { viaBaseCost },
            crossLayerSearch,
          }
          for (let row = -2; row <= 8; row++) {
            for (let col = -2; col <= 8; col++) {
              for (let toRow = -2; toRow <= 8; toRow++) {
                for (let toCol = -2; toCol <= 8; toCol++) {
                  const actual = computeH.call(
                    context,
                    z,
                    row,
                    col,
                    toZ,
                    toRow,
                    toCol,
                  )
                  const expected = frozenA01Heuristic.call(
                    context,
                    z,
                    row,
                    col,
                    toZ,
                    toRow,
                    toCol,
                  )
                  if (!Object.is(actual, expected)) {
                    throw new Error(
                      `Different heuristic at ${row},${col} -> ${toRow},${toCol}`,
                    )
                  }
                  comparisons++
                }
              }
            }
          }
        }
      }
    }
  }
  expect(comparisons).toBe(1_054_152)
})
