import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import {
  type A01HeuristicContext,
  frozenA01Heuristic,
} from "../fixtures/FrozenA01Heuristic"

test("A01 setup retains control values for empty and nonfinite via margins", (): void => {
  let comparisons = 0
  for (const cellSizeMm of [0.1, 0.07, Math.PI / 100]) {
    for (const viaMinDistFromBorder of [
      -1,
      0,
      0.15,
      1,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]) {
      const solver = new HighDensitySolverA01({
        nodeWithPortPoints: {
          capacityMeshNodeId: "exact-via-bound-setup",
          center: { x: 0, y: 0 },
          width: 0.8,
          height: 0.8,
          availableZ: [0, 1],
          portPoints: [
            { connectionName: "signal", x: -0.4, y: -0.4, z: 0 },
            { connectionName: "signal", x: 0.4, y: 0.4, z: 1 },
          ],
        },
        cellSizeMm,
        viaDiameter: 0.1,
        viaMinDistFromBorder,
      })
      solver.setup()
      const state = solver as unknown as A01HeuristicContext & {
        rows: number
        cols: number
        crossLayerSearch: boolean
        computeH: typeof frozenA01Heuristic
      }
      expect(Number.isSafeInteger(state.rows)).toBe(true)
      expect(Number.isSafeInteger(state.cols)).toBe(true)
      state.crossLayerSearch = true
      for (const row of [0, state.rows - 1]) {
        for (const col of [0, state.cols - 1]) {
          for (const toRow of [0, state.rows - 1]) {
            for (const toCol of [0, state.cols - 1]) {
              expect(
                Object.is(
                  state.computeH(0, row, col, 1, toRow, toCol),
                  frozenA01Heuristic.call(state, 0, row, col, 1, toRow, toCol),
                ),
              ).toBe(true)
              comparisons++
            }
          }
        }
      }
    }
  }
  expect(comparisons).toBe(288)
})
