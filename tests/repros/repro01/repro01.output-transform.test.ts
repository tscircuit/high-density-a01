import { expect, test } from "bun:test"
import { defaultA03Params } from "../../../lib/default-params"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import repro01 from "./repro01.json"

test("A03 getOutput preserves physical grid coordinates and exact endpoints", () => {
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

  const middleCellId = Math.floor(cellCenterX.length / 2)
  internal.solvedRoutes = [
    {
      connId: 0,
      states: Int32Array.from([startCellId, middleCellId, endCellId]),
      viaCellIds: Int32Array.from([startCellId, endCellId]),
      startPoint: { x: internal.boundsMinX, y: internal.boundsMinY, z: 0 },
      endPoint: { x: internal.boundsMaxX, y: internal.boundsMaxY, z: 0 },
    },
  ]

  const [route] = solver.getOutput()

  expect(route).toBeDefined()
  expect(route!.route).toEqual([
    { x: internal.boundsMinX, y: internal.boundsMinY, z: 0 },
    {
      x: cellCenterX[middleCellId],
      y: cellCenterY[middleCellId],
      z: 0,
    },
    { x: internal.boundsMaxX, y: internal.boundsMaxY, z: 0 },
  ])
  expect(route!.vias).toEqual([
    { x: minCenterX, y: minCenterY },
    { x: maxCenterX, y: maxCenterY },
  ])
})

test("A03 getOutput preserves exact user-provided route endpoints", () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: repro01.nodeWithPortPoints,
  })
  solver.setup()

  const internal = solver as any
  const startCellId = 0
  const endCellId = internal.cellCenterX.length - 1
  const startPoint = { x: -0.237, y: -0.191, z: 0 }
  const endPoint = { x: 0.243, y: 0.217, z: 1 }

  internal.solvedRoutes = [
    {
      connId: 0,
      states: Int32Array.from([
        startCellId,
        Math.floor(internal.planeSize / 2),
        internal.planeSize + endCellId,
      ]),
      viaCellIds: Int32Array.from([endCellId]),
      startPoint,
      endPoint,
    },
  ]

  const [route] = solver.getOutput()

  expect(route).toBeDefined()
  expect(route!.route[0]).toEqual(startPoint)
  expect(route!.route[route!.route.length - 1]).toEqual(endPoint)
})
