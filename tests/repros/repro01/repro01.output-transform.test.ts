import { expect, test } from "bun:test"
import { defaultA03Params } from "../../../lib/default-params"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import repro01 from "./repro01.json"

test("A03 getOutput applies grid-to-bounds transform to solved routes", () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: repro01.nodeWithPortPoints,
  })
  solver.setup()

  const internal = solver as any
  const cellCenterX = internal.cellCenterX as Float64Array
  const cellCenterY = internal.cellCenterY as Float64Array

  let minCenterX = Infinity
  let maxCenterX = -Infinity
  let minCenterY = Infinity
  let maxCenterY = -Infinity

  for (let cellId = 0; cellId < cellCenterX.length; cellId++) {
    const centerX = cellCenterX[cellId]!
    const centerY = cellCenterY[cellId]!
    if (centerX < minCenterX) minCenterX = centerX
    if (centerX > maxCenterX) maxCenterX = centerX
    if (centerY < minCenterY) minCenterY = centerY
    if (centerY > maxCenterY) maxCenterY = centerY
  }

  let startCellId = -1
  let endCellId = -1
  for (let cellId = 0; cellId < cellCenterX.length; cellId++) {
    if (
      cellCenterX[cellId] === minCenterX &&
      cellCenterY[cellId] === minCenterY
    ) {
      startCellId = cellId
    }
    if (
      cellCenterX[cellId] === maxCenterX &&
      cellCenterY[cellId] === maxCenterY
    ) {
      endCellId = cellId
    }
  }

  expect(startCellId).toBeGreaterThanOrEqual(0)
  expect(endCellId).toBeGreaterThanOrEqual(0)

  internal.solvedRoutes = [
    {
      connId: 0,
      states: Int32Array.from([startCellId, endCellId]),
      viaCellIds: Int32Array.from([startCellId, endCellId]),
    },
  ]

  const [route] = solver.getOutput()

  expect(route).toBeDefined()
  expect(route!.route[0]!.x).toBeCloseTo(internal.boundsMinX, 6)
  expect(route!.route[0]!.y).toBeCloseTo(internal.boundsMinY, 6)
  expect(route!.route[1]!.x).toBeCloseTo(internal.boundsMaxX, 6)
  expect(route!.route[1]!.y).toBeCloseTo(internal.boundsMaxY, 6)
  expect(route!.vias[0]!.x).toBeCloseTo(internal.boundsMinX, 6)
  expect(route!.vias[0]!.y).toBeCloseTo(internal.boundsMinY, 6)
  expect(route!.vias[1]!.x).toBeCloseTo(internal.boundsMaxX, 6)
  expect(route!.vias[1]!.y).toBeCloseTo(internal.boundsMaxY, 6)
})
