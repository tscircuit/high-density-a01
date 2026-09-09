import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { OrderedOwnerRows } from "../../lib/HighDensitySolverA03/OrderedOwnerRows"

test("ordered via occupants match dense geometry at region seams and numeric edges", () => {
  for (const [width, height, layers] of [
    [1.6, 1.2, 2],
    [0.2, 0.1, 2],
    [2.4, 1.6, 4],
  ]) {
    const solver: any = new HighDensitySolverA03({
      ...defaultA03Params,
      highResolutionCellSize: 0.1,
      highResolutionCellThickness: 2,
      lowResolutionCellSize: 0.3,
      nodeWithPortPoints: {
        capacityMeshNodeId: "owner-run-test",
        center: { x: 0, y: 0 },
        width: width!,
        height: height!,
        availableZ: Array.from({ length: layers! }, (_, z) => z),
        portPoints: [],
      },
    })
    solver.setup()
    expect(solver.failed).toBe(false)
    solver.connIdToRootNet = ["same", "one", "same", "three"]
    for (const region of solver.regions) {
      for (let row = 0; row < region.rows; row++) {
        for (let col = 0; col < region.cols; col++) {
          const cell = region.offset + row * region.cols + col
          for (let z = 0; z < solver.layers; z++) {
            const flat = z * solver.planeSize + cell
            const pattern = (Math.floor(col / 3) + row + z) % 6
            solver.usedCellsFlat[flat] = [-1, 0, 1, 2, -1, 3][pattern]
            solver.sharedCellsFlat[flat] = [
              undefined,
              [3, 1],
              [1, 3],
              [],
              [2],
              [0, 2],
            ][pattern]
          }
        }
      }
    }
    const rebuild = () =>
      new OrderedOwnerRows(
        solver.regions,
        solver.planeSize,
        solver.layers,
        solver.usedCellsFlat,
        solver.sharedCellsFlat,
      )
    let index = rebuild()
    const check = (cell: number, active: number) => {
      solver.orderedOwnerRows = null
      solver.fillViaOccupants(cell, active)
      const expected = solver._viaOccs.slice()
      solver.orderedOwnerRows = index
      solver.fillViaOccupants(cell, active)
      expect(solver._viaOccs).toEqual(expected)
    }
    for (const radius of [
      0,
      -0,
      Number.MIN_VALUE,
      0.05,
      0.15,
      0.35,
      -0.15,
      Infinity,
      NaN,
    ]) {
      solver.viaKeepoutRadius = radius
      for (let cell = 0; cell < solver.planeSize; cell++) {
        check(cell, cell % 4)
      }
    }
    solver.viaKeepoutRadius = 0.15
    const x = solver.cellCenterX[0],
      y = solver.cellCenterY[0]
    for (const cx of [
      -Infinity,
      -Number.MAX_VALUE,
      -0,
      0,
      Number.MIN_VALUE,
      Infinity,
      NaN,
    ]) {
      solver.cellCenterX[0] = cx
      check(0, 0)
    }
    solver.cellCenterX[0] = x
    for (const cy of [-Infinity, -0, Infinity, NaN]) {
      solver.cellCenterY[0] = cy
      check(0, 1)
    }
    solver.cellCenterY[0] = y
    // Exact side contacts and either adjacent floating-point neighborhood.
    for (const region of solver.regions) {
      if (!region.rows || !region.cols) continue
      const cell = region.offset + region.cols - 1
      solver.viaKeepoutRadius = 0.125
      solver.cellCenterY[0] = solver.cellCenterY[cell]
      for (const shift of [0, -Number.EPSILON, Number.EPSILON]) {
        solver.cellCenterX[0] = solver.cellMaxX[cell] + 0.125 + shift
        check(0, 0)
      }
    }
    solver.cellCenterX[0] = x
    solver.cellCenterY[0] = y
    solver.viaKeepoutRadius = 0.15
    // A primary removal promotes the last shared owner, changing encounter order.
    solver.usedCellsFlat[0] = 0
    solver.sharedCellsFlat[0] = [1, 3]
    solver.removeOccupant(0, 0)
    expect(solver.usedCellsFlat[0]).toBe(3)
    expect(solver.sharedCellsFlat[0]).toEqual([1])
    index = rebuild()
    for (let cell = 0; cell < solver.planeSize; cell++) check(cell, 2)
  }
})
