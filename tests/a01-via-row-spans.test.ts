import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { defaultParams } from "../lib/default-params"

test("row spans expand to the original circular offsets at rounding boundaries", () => {
  for (const ratio of [
    0,
    0.1,
    1,
    1 - 1e-10,
    1 + 1e-10,
    1 + 1e-8,
    2,
    2.5,
    9.9,
    16,
  ]) {
    const solver = new HighDensitySolverA01({
      ...defaultParams,
      viaDiameter: ratio * defaultParams.cellSizeMm * 2,
      viaOccupantQuery: "row-runs",
      nodeWithPortPoints: {
        capacityMeshNodeId: "span-control",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        availableZ: [0, 1],
        portPoints: [],
      },
    }) as any
    solver.setup()
    const rows: number[] = []
    const columns: number[] = []
    for (const span of solver.viaOccupantScanRows) {
      for (let col = span.firstColumn; col <= span.lastColumn; col++) {
        rows.push(span.row)
        columns.push(col)
      }
    }
    expect(rows).toEqual(Array.from(solver.viaOccupantScanOffsetsDr))
    expect(columns).toEqual(Array.from(solver.viaOccupantScanOffsetsDc))
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]! >= rows[i - 1]!).toBe(true)
      if (rows[i] === rows[i - 1]) {
        expect(columns[i]).toBe(columns[i - 1]! + 1)
      }
    }
  }
})
