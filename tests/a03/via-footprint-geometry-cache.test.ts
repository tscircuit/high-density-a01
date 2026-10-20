import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 lifetime footprints match all grid-cell intersections", (): void => {
  for (const dimensions of [
    { width: 4, height: 4 },
    { width: 3.7, height: 2.3 },
    { width: 0.5, height: 0.75 },
  ]) {
    const solver = new HighDensitySolverA03({
      nodeWithPortPoints: {
        capacityMeshNodeId: "via-footprint-geometry",
        center: { x: 0.3, y: -0.2 },
        ...dimensions,
        availableZ: [3, 7],
        portPoints: [],
      },
      highResolutionCellSize: 0.25,
      lowResolutionCellSize: 0.5,
      highResolutionCellThickness: 2,
      viaDiameter: 0.3,
      traceThickness: 0.12,
      traceMargin: 0.1,
    })
    solver.setup()
    expect(solver.failed).toBeFalse()
    expect(solver["viaFootprintCellIds"].filter(Boolean)).toHaveLength(0)
    const radius = solver["viaKeepoutRadius"]
    for (let cellId = 0; cellId < solver.planeSize; cellId++) {
      const cx = solver.cellCenterX[cellId]!
      const cy = solver.cellCenterY[cellId]!
      const expected: number[] = []
      for (let candidateId = 0; candidateId < solver.planeSize; candidateId++) {
        const qx = Math.max(
          solver.cellMinX[candidateId]!,
          Math.min(solver.cellMaxX[candidateId]!, cx),
        )
        const qy = Math.max(
          solver.cellMinY[candidateId]!,
          Math.min(solver.cellMaxY[candidateId]!, cy),
        )
        const dx = cx - qx
        const dy = cy - qy
        if (dx * dx + dy * dy <= radius * radius) expected.push(candidateId)
      }
      const footprint = solver["getViaFootprintCellIds"](cellId)
      expect(Array.from(footprint)).toEqual(expected)
      expect(solver["getViaFootprintCellIds"](cellId)).toBe(footprint)
    }
  }
})
