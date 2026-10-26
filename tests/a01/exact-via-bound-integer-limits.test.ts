import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import {
  type A01HeuristicContext,
  frozenA01Heuristic,
} from "../fixtures/FrozenA01Heuristic"

test("the via identity retains binary64 values at wide integer grid limits", (): void => {
  const computeH = (
    HighDensitySolverA01.prototype as unknown as {
      computeH: typeof frozenA01Heuristic
    }
  ).computeH
  const boundary = 0x7fffffff
  const values = [0, 1, 2, boundary - 2, boundary - 1, boundary]
  let comparisons = 0
  for (const border of [0, 1, boundary, Number.POSITIVE_INFINITY]) {
    for (const cellSizeMm of [0.1, Number.MIN_VALUE, 1.0000000000000002]) {
      const context: A01HeuristicContext = {
        minViaRow: border,
        maxViaRow: boundary - border,
        minViaCol: border,
        maxViaCol: boundary - border,
        cellSizeMm,
        hyperParameters: { viaBaseCost: 0.1 },
        crossLayerSearch: true,
      }
      for (const row of values) {
        for (const col of values) {
          for (const toRow of values) {
            for (const toCol of values) {
              expect(
                Object.is(
                  computeH.call(context, 0, row, col, 1, toRow, toCol),
                  frozenA01Heuristic.call(context, 0, row, col, 1, toRow, toCol),
                ),
              ).toBe(true)
              comparisons++
            }
          }
        }
      }
    }
  }
  expect(comparisons).toBe(15_552)
})
