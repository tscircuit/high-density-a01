import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { ViaPlacement } from "../lib/types"
import {
  activeConnectionName,
  makeNativeViaSolver,
  nativeViaFamilies,
  physicalViaDiameter,
} from "./native-via-placement-fixture"

test("native via callbacks use emitted world coordinates, physical layers, diameter, and active owner", (): void => {
  for (const family of nativeViaFamilies) {
    const queries: Array<{ placement: ViaPlacement; connectionName: string }> = []
    const validator = (placement: ViaPlacement, connectionName: string): boolean => {
      queries.push({ placement: { ...placement }, connectionName })
      return true
    }
    const solver = makeNativeViaSolver(family, validator)
    solver.solve()

    expect(solver.solved).toBeTrue()
    expect(queries.length).toBeGreaterThan(0)
    expect(solver.getConstructorParams()[0].viaPlacementValidator).toBe(validator)
    const worldCenters: Array<{ x: number; y: number }> = []
    if (solver instanceof HighDensitySolverA01) {
      for (let row = 0; row < solver.rows; row++) {
        for (let col = 0; col < solver.cols; col++) {
          worldCenters.push({
            x: 8 + (col * 4) / (solver.cols - 1),
            y: -21.5 + (row * 3) / (solver.rows - 1),
          })
        }
      }
    } else {
      const minX = Math.min(...solver.cellCenterX)
      const maxX = Math.max(...solver.cellCenterX)
      const minY = Math.min(...solver.cellCenterY)
      const maxY = Math.max(...solver.cellCenterY)
      for (let cell = 0; cell < solver.planeSize; cell++) {
        worldCenters.push({
          x: 8 + ((solver.cellCenterX[cell]! - minX) * 4) / (maxX - minX),
          y: -21.5 + ((solver.cellCenterY[cell]! - minY) * 3) / (maxY - minY),
        })
      }
    }
    for (const { placement, connectionName } of queries) {
      expect(connectionName).toBe(activeConnectionName)
      expect(placement.viaDiameter).toBe(physicalViaDiameter)
      expect([placement.zStart, placement.zEnd].sort()).toEqual([2, 5])
      expect(worldCenters.some((point) =>
        Math.abs(point.x - placement.x) < 1e-9 &&
        Math.abs(point.y - placement.y) < 1e-9,
      )).toBeTrue()
    }
    for (const via of solver.getOutput().flatMap((route) => route.vias)) {
      expect(queries.some(({ placement }) =>
        Math.abs(placement.x - via.x) < 1e-9 &&
        Math.abs(placement.y - via.y) < 1e-9,
      )).toBeTrue()
    }
  }
})
