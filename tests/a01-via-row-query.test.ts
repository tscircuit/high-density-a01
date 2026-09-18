import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { defaultParams } from "../lib/default-params"

test("row queries retain layer/row/column owner order and dense remains default", () => {
  for (const layerCount of [2, 4]) {
    const nodeWithPortPoints = {
      capacityMeshNodeId: "row-query",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: Array.from({ length: layerCount }, (_, z) => ({
        x: 0,
        y: 0,
        z,
        connectionName: `net${z}`,
      })),
    }
    const props = { ...defaultParams, nodeWithPortPoints }
    const dense = new HighDensitySolverA01(props) as any
    dense.setup()
    expect(dense.viaOccupantQuery).toBe("dense")
    expect(dense.occupiedRows).toBeNull()
    expect(dense.getConstructorParams()[0].viaOccupantQuery).toBe("dense")
    const s = new HighDensitySolverA01({
      ...props,
      viaOccupantQuery: "row-runs",
    }) as any
    s.setup()
    expect(s.layers).toBe(layerCount)
    expect(s.occupiedRows).not.toBeNull()
    expect(s.getConstructorParams()[0].viaOccupantQuery).toBe("row-runs")
    s.connIdToRootNet = ["a", "a", "b", "c", "d"]
    s.overlapFriendlyRootNets = new Set(["a"])
    // Explicitly seed both representations for this query-only unit control.
    for (let cell = 0; cell < s.usedCellsFlat.length; cell++) {
      const owner = (Math.imul(cell + 3, 31) % 7) - 1
      const value = owner > 4 ? -1 : owner
      s.usedCellsFlat[cell] = value
      s.occupiedRows.set(cell, value)
    }
    for (let row = -2; row <= s.rows + 1; row++) {
      for (let col = -2; col <= s.cols + 1; col++) {
        for (let active = 0; active < 5; active++) {
          s.fillViaOccupantsDense(row, col, active)
          const expected = s._viaOccs.slice()
          s.fillViaOccupants(row, col, active)
          expect(s._viaOccs).toEqual(expected)
        }
      }
    }
    const oldIndex = s.occupiedRows
    s._setup()
    expect(s.occupiedRows).not.toBe(oldIndex)
    expect(s.occupiedRows.rows.every((r: unknown) => r === undefined)).toBe(
      true,
    )
    s.viaOccupantQuery = "dense"
    s._setup()
    expect(s.occupiedRows).toBeNull()
    expect(s.viaOccupantScanRows).toEqual([])
  }
})
