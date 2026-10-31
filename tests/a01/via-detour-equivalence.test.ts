import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("one clamped detour equals both original detours for all grid endpoints", () => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: viaOccupantCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  })
  solver.setup()
  solver["crossLayerSearch"] = true
  for (const [min, max] of [
    [0, 10],
    [3, 7],
    [5, 5],
    [7, 3],
  ]) {
    solver["minViaRow"] = solver["minViaCol"] = min!
    solver["maxViaRow"] = solver["maxViaCol"] = max!
    for (let row = 0; row <= 10; row++) {
      for (let col = 0; col <= 10; col++) {
        for (let toRow = 0; toRow <= 10; toRow++) {
          for (let toCol = 0; toCol <= 10; toCol++) {
            const vr1 = Math.max(min!, Math.min(max!, row))
            const vc1 = Math.max(min!, Math.min(max!, col))
            const vr2 = Math.max(min!, Math.min(max!, toRow))
            const vc2 = Math.max(min!, Math.min(max!, toCol))
            const via1 =
              Math.abs(row - vr1) +
              Math.abs(col - vc1) +
              Math.abs(vr1 - toRow) +
              Math.abs(vc1 - toCol)
            const via2 =
              Math.abs(row - vr2) +
              Math.abs(col - vc2) +
              Math.abs(vr2 - toRow) +
              Math.abs(vc2 - toCol)
            const manhattan = Math.abs(row - toRow) + Math.abs(col - toCol)
            const expected =
              Math.max(Math.min(via1, via2), manhattan) * solver.cellSizeMm +
              solver.hyperParameters.viaBaseCost
            expect(solver["computeH"](0, row, col, 1, toRow, toCol)).toBe(
              expected,
            )
          }
        }
      }
    }
  }
})
