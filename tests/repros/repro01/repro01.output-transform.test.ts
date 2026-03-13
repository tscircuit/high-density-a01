import { expect, test } from "bun:test"
import { defaultA02Params } from "../../../lib/default-params"
import { HighDensitySolverA02 } from "../../../lib/HighDensitySolverA02/HighDensitySolverA02"
import repro01 from "./repro01.json"

test("A02 getOutput applies grid-to-bounds transform to solved routes", () => {
  const solver = new HighDensitySolverA02({
    ...defaultA02Params,
    nodeWithPortPoints: repro01.nodeWithPortPoints,
  })
  solver.setup()

  const internal = solver as any
  const cells = internal.cells as Array<{
    id: number
    centerX: number
    centerY: number
  }>

  let minCenterX = Infinity
  let maxCenterX = -Infinity
  let minCenterY = Infinity
  let maxCenterY = -Infinity

  for (const cell of cells) {
    if (cell.centerX < minCenterX) minCenterX = cell.centerX
    if (cell.centerX > maxCenterX) maxCenterX = cell.centerX
    if (cell.centerY < minCenterY) minCenterY = cell.centerY
    if (cell.centerY > maxCenterY) maxCenterY = cell.centerY
  }

  const startCell = cells.find(
    (cell) => cell.centerX === minCenterX && cell.centerY === minCenterY,
  )
  const endCell = cells.find(
    (cell) => cell.centerX === maxCenterX && cell.centerY === maxCenterY,
  )

  expect(startCell).toBeDefined()
  expect(endCell).toBeDefined()

  internal.solvedRoutes = [
    {
      connId: 0,
      states: Int32Array.from([startCell!.id, endCell!.id]),
      viaCellIds: Int32Array.from([startCell!.id, endCell!.id]),
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
